import { useEffect, useState, type FormEvent } from 'react';
import {
  SEARCH_TYPES,
  SearchResultSchema,
  SearchSortSchema,
  StoredKindSchema,
  type SearchHit,
  type SearchSort,
  type SearchType,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { Empty, SnippetText, Status, useLoad, type View } from './ui.js';
import { canOpen, useOpenSubject } from './destinations.js';
import { useListSort } from './list-sort.js';

const TYPE_LABEL: Record<SearchType, string> = {
  record: 'Records',
  passage: 'Source passages',
  decision: 'Decisions',
  activity: 'Activity',
  code_version: 'Code versions',
  model: 'Models',
  cost: 'Costs',
};

const SORT_LABEL: Record<SearchSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  relevance: 'Best match',
};
const SORTS = SearchSortSchema.options;
const PAGE = 20;

/**
 * What a hit opens. A passage opens at its source in Sources; everything else goes through
 * the shared destination check (P01), which also explains a target that is gone.
 */
function subjectOf(h: SearchHit): { kind: string; id: string } | null {
  if (h.type === 'decision') return { kind: 'decision', id: h.id };
  if (h.type === 'code_version') return { kind: 'code_version', id: h.id };
  return h.subject ?? null;
}

/**
 * Full-text, exact-id and filtered search across records, source passages, decisions and
 * activity. The server checks access before it builds any snippet or count.
 */
export function Search({
  workspace,
  q,
  setQ,
  open,
}: {
  workspace: Workspace;
  q: string;
  setQ: (q: string) => void;
  open: (view: View, id?: string) => void;
}) {
  const [draft, setDraft] = useState(q);
  const [types, setTypes] = useState<SearchType[]>([...SEARCH_TYPES]);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const { sort, set: setSort } = useListSort(
    'search',
    workspace.id,
    SORTS,
    'newest',
  );
  useEffect(() => setDraft(q), [q]);
  const params = (t: SearchType[]) => {
    const p = new URLSearchParams({ q, types: t.join(','), limit: `${PAGE}` });
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status);
    if (sort !== 'newest') p.set('sort', sort);
    return p;
  };
  const queryKey = [workspace.id, q, types.join(','), kind, status, sort].join(
    '|',
  );
  const result = useLoad(async () => {
    if (!q) return null;
    return api(
      SearchResultSchema,
      `workspaces/${workspace.id}/search?${params(types)}`,
    );
  }, [queryKey]);
  // P02: later pages of one type, read with that type's cursor and appended under it.
  const [more, setMore] = useState<{
    key: string;
    hits: SearchHit[];
    /** Per type, the cursor after its last loaded page; null once that type is done. */
    next: Partial<Record<SearchType, string | null>>;
  }>({ key: '', hits: [], next: {} });
  const [moreBusy, setMoreBusy] = useState<SearchType | null>(null);
  // Review L1: an error belongs to the result it was loading more of; new words, sort or
  // filters start a new result, so an old error is not shown above it.
  const [moreError, setMoreError] = useState({ key: '', text: '' });
  const resultKey = `${queryKey}|${result.data?.freshness.as_of ?? ''}`;
  const extra =
    more.key === resultKey ? more : { key: resultKey, hits: [], next: {} };
  async function loadMore(t: SearchType, after: string) {
    setMoreBusy(t);
    setMoreError({ key: '', text: '' });
    try {
      const p = params([t]);
      p.set('after', after);
      const page = await api(
        SearchResultSchema,
        `workspaces/${workspace.id}/search?${p}`,
      );
      setMore((m) => {
        const base =
          m.key === resultKey ? m : { key: resultKey, hits: [], next: {} };
        const next = { ...base.next, [t]: page.next[t] ?? null };
        return { key: resultKey, hits: [...base.hits, ...page.hits], next };
      });
    } catch (e) {
      setMoreError({ key: resultKey, text: message(e) });
    } finally {
      setMoreBusy(null);
    }
  }
  const opener = useOpenSubject(workspace.id, open);
  function submit(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim());
  }
  const r = result.data;
  /** The cursor for a type's next page: from its last loaded page, else the first. */
  const nextOf = (t: SearchType) =>
    t in extra.next ? extra.next[t] : r?.next[t];
  const hitsOf = (t: SearchType) =>
    [...(r?.hits ?? []), ...extra.hits].filter((h) => h.type === t);
  return (
    <section className="panel" aria-labelledby="search-title">
      <h2 id="search-title">Search</h2>
      <p>
        Words search record text, source passages, decision questions, the
        activity history, artifact commits, models used and cost records. A full
        id, or its first 8 characters as shown across the page, finds that exact
        item. Redacted text is gone and cannot be found.
      </p>
      <form className="searchbar" role="search" onSubmit={submit}>
        <label htmlFor="q" className="inline">
          Search
        </label>
        <input
          id="q"
          type="search"
          maxLength={200}
          value={draft}
          placeholder="no-show reminders, 23 percent, or an id"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="secondary strong" type="submit">
          Search
        </button>
      </form>
      <div className="filters" role="group" aria-label="Filters">
        {SEARCH_TYPES.map((t) => (
          <label key={t} className="chip">
            <input
              type="checkbox"
              checked={types.includes(t)}
              disabled={types.length === 1 && types.includes(t)}
              onChange={() =>
                setTypes((x) =>
                  x.includes(t) ? x.filter((y) => y !== t) : [...x, t],
                )
              }
            />
            {TYPE_LABEL[t]}
          </label>
        ))}
      </div>
      <div className="filters">
        <label htmlFor="s-sort" className="inline">
          Sort by
        </label>
        <select
          id="s-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SearchSort)}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
        <label htmlFor="s-kind" className="inline">
          Record kind
        </label>
        <select
          id="s-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Any</option>
          {StoredKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {words(k)}
            </option>
          ))}
        </select>
        <label htmlFor="s-status" className="inline">
          Record status
        </label>
        <select
          id="s-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="redacted">Redacted</option>
        </select>
      </div>
      {!q ? (
        <Empty>Type words or an id and press Search.</Empty>
      ) : (
        <Status
          loading={result.loading}
          error={result.error}
          retry={result.reload}
        >
          {r && (
            <>
              <p className="small" role="status">
                {r.mode === 'id' ? 'Id search' : 'Text search'} ·{' '}
                {Object.entries(r.counts)
                  .map(
                    ([t, n]) =>
                      `${n} ${TYPE_LABEL[t as SearchType].toLowerCase()}`,
                  )
                  .join(' · ')}
                {' · '}
                {r.order === 'relevance'
                  ? 'best match first (records, passages, decisions and activity; other types newest first)'
                  : `${SORT_LABEL[r.order].toLowerCase()} first`}
                {r.order !== sort
                  ? ' (best match needs words, so this search is newest first)'
                  : ''}
                {' · each type in its own group'}
                {r.fixture ? ' · fixture workspace' : ''}
                {Object.values(r.coverage).some(
                  (c) => c.excluded.redacted || c.excluded.unsupported_media,
                )
                  ? ` · not searchable: ${Object.values(r.coverage).reduce((n, c) => n + c.excluded.redacted, 0)} redacted, ${r.coverage.passage?.excluded.unsupported_media ?? 0} unreadable media`
                  : ''}
              </p>
              {r.hits.length === 0 && <Empty>No matches.</Empty>}
              {moreError.key === resultKey && moreError.text && (
                <p className="error small" role="alert">
                  {moreError.text}
                </p>
              )}
              {SEARCH_TYPES.filter((t) => r.hits.some((h) => h.type === t)).map(
                (t) => (
                  <div key={t}>
                    <h3>
                      {TYPE_LABEL[t]}{' '}
                      <small>
                        ({hitsOf(t).length} of {r.counts[t] ?? 0})
                      </small>
                    </h3>
                    <ul className="rows hits">
                      {hitsOf(t).map((h) => {
                        const subject = subjectOf(h);
                        const key = `${h.type}-${h.id}`;
                        return (
                          <li key={key}>
                            <span className="kind">{words(h.kind)}</span>{' '}
                            {h.type === 'passage' && subject ? (
                              <button
                                className="text"
                                onClick={() =>
                                  open('evidence', `source:${subject.id}`)
                                }
                              >
                                {h.title}
                              </button>
                            ) : subject && canOpen(subject.kind) ? (
                              <button
                                className="text"
                                aria-busy={opener.busy === key}
                                onClick={() =>
                                  void opener.openSubject(
                                    subject.kind,
                                    subject.id,
                                    key,
                                  )
                                }
                              >
                                {h.title}
                              </button>
                            ) : (
                              <span>{h.title}</span>
                            )}
                            <small>
                              {' '}
                              · {words(h.status)}
                              {h.version ? ` · v${h.version}` : ''} ·{' '}
                              {when(h.occurred_at)}
                              {h.match !== 'text'
                                ? ` · matched ${words(h.match)}`
                                : ''}
                              {h.amounts
                                ? ` · incurred ${h.amounts.incurred} nano-USD${h.amounts.unknown !== '0' ? `, ${h.amounts.unknown} unknown` : ''}${h.amounts.fixture ? ' (simulated)' : ''}`
                                : ''}
                            </small>
                            <div>
                              <SnippetText snippet={h.snippet} />
                            </div>
                            {opener.notice?.key === key && (
                              <p className="small" role="status">
                                {opener.notice.text}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {nextOf(t) && (
                      <button
                        className="secondary"
                        disabled={moreBusy !== null}
                        onClick={() => void loadMore(t, nextOf(t)!)}
                      >
                        {moreBusy === t
                          ? 'Loading…'
                          : `More ${TYPE_LABEL[t].toLowerCase()}`}
                      </button>
                    )}
                  </div>
                ),
              )}
            </>
          )}
        </Status>
      )}
    </section>
  );
}
