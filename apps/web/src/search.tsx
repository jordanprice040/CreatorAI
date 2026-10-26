import { useEffect, useState, type FormEvent } from 'react';
import {
  SEARCH_TYPES,
  SearchResultSchema,
  StoredKindSchema,
  type SearchHit,
  type SearchType,
  type Workspace,
} from '@creator/contracts';
import { api, when, words } from './oversight.js';
import {
  Empty,
  SnippetText,
  Status,
  subjectTarget,
  useLoad,
  type View,
} from './ui.js';

const TYPE_LABEL: Record<SearchType, string> = {
  record: 'Records',
  passage: 'Source passages',
  decision: 'Decisions',
  activity: 'Activity',
  code_version: 'Code versions',
  model: 'Models',
  cost: 'Costs',
};

/** Where a hit opens: the view that owns its subject, if any page shows that kind. */
function target(h: SearchHit): [View, string] | null {
  if (h.type === 'decision') return ['decisions', h.id];
  if (h.type === 'passage')
    return ['evidence', `source:${h.subject?.id ?? ''}`];
  const s = h.subject ?? { id: h.id, kind: h.kind };
  return subjectTarget(s.kind, s.id);
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
  useEffect(() => setDraft(q), [q]);
  const result = useLoad(async () => {
    if (!q) return null;
    const p = new URLSearchParams({ q, types: types.join(','), limit: '20' });
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status);
    return api(SearchResultSchema, `workspaces/${workspace.id}/search?${p}`);
  }, [workspace.id, q, types.join(','), kind, status]);
  function submit(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim());
  }
  const r = result.data;
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
                {r.truncated ? ' · showing the first 20 of each' : ''}
                {r.fixture ? ' · fixture workspace' : ''}
                {Object.values(r.coverage).some(
                  (c) => c.excluded.redacted || c.excluded.unsupported_media,
                )
                  ? ` · not searchable: ${Object.values(r.coverage).reduce((n, c) => n + c.excluded.redacted, 0)} redacted, ${r.coverage.passage?.excluded.unsupported_media ?? 0} unreadable media`
                  : ''}
              </p>
              {r.hits.length === 0 && <Empty>No matches.</Empty>}
              {SEARCH_TYPES.filter((t) => r.hits.some((h) => h.type === t)).map(
                (t) => (
                  <div key={t}>
                    <h3>{TYPE_LABEL[t]}</h3>
                    <ul className="rows hits">
                      {r.hits
                        .filter((h) => h.type === t)
                        .map((h) => {
                          const to = target(h);
                          return (
                            <li key={`${h.type}-${h.id}`}>
                              <span className="kind">{words(h.kind)}</span>{' '}
                              {to ? (
                                <button
                                  className="text"
                                  onClick={() => open(to[0], to[1])}
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
                            </li>
                          );
                        })}
                    </ul>
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
