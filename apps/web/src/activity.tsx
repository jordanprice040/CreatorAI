import { useEffect, useState, type FormEvent } from 'react';
import {
  ActivityPageSchema,
  type ActivityEntry,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import {
  Empty,
  Status,
  eventText,
  shortId,
  subjectTarget,
  type View,
} from './ui.js';
import { useOnShow } from './page-active.js';

const ACTIONS = [
  ['', 'Everything'],
  ['entity.', 'Records'],
  ['link.', 'Links'],
  ['decision.', 'Decisions'],
  ['grant.', 'Permissions'],
  ['run.', 'Runs'],
  ['workflow.', 'Workflows'],
  ['budget.', 'Budgets and calls'],
  ['budget.denied', 'Refused calls'],
  ['source.', 'Sources'],
  ['selection.', 'Selections'],
  ['spec.', 'Specifications'],
  ['auth.', 'Sign-ins'],
] as const;

/** The audit history in words: who did what, when, and to which record. Newest first. */
export function Activity({
  workspace,
  q,
  setQ,
  focus,
  open,
}: {
  workspace: Workspace;
  q: string;
  setQ: (q: string) => void;
  /** An action prefix filter, kept in the address. */
  focus: string;
  open: (view: View, id?: string, q?: string) => void;
}) {
  const [draft, setDraft] = useState(q);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const action = focus;
  useEffect(() => setDraft(q), [q]);
  async function load(before?: string) {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ limit: '50' });
      if (q) p.set('q', q);
      if (action) p.set('action', action);
      if (before) p.set('before', before);
      const page = await api(
        ActivityPageSchema,
        `workspaces/${workspace.id}/activity?${p}`,
      );
      setEntries((e) => (before ? [...e, ...page.entries] : page.entries));
      setNext(page.next_before);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [workspace.id, q, action]);
  useOnShow(() => void load());
  function submit(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim());
  }
  return (
    <section className="panel" aria-labelledby="act-title">
      <h2 id="act-title">Activity</h2>
      <p>
        Every change is an audit event with the person or service that made it.
        Summaries name kinds, versions and relations, never record text.
      </p>
      <form className="searchbar" role="search" onSubmit={submit}>
        <label htmlFor="aq" className="inline">
          Find
        </label>
        <input
          id="aq"
          type="search"
          maxLength={200}
          value={draft}
          placeholder="answered, selection, denied…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <label htmlFor="aact" className="inline">
          Show
        </label>
        <select
          id="aact"
          value={action}
          onChange={(e) => open('activity', e.target.value, q)}
        >
          {ACTIONS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button className="secondary strong" type="submit">
          Filter
        </button>
      </form>
      <Status
        loading={loading && entries.length === 0}
        error={error}
        retry={() => void load()}
      >
        {entries.length === 0 ? (
          <Empty>No activity matches.</Empty>
        ) : (
          <ol className="rows history">
            {entries.map((e) => (
              <li key={e.event_id}>
                <time dateTime={e.occurred_at}>{when(e.occurred_at)}</time> ·{' '}
                <strong>
                  {e.actor.display_name}
                  {e.actor.kind === 'human' ? '' : ` (${e.actor.kind})`}
                </strong>{' '}
                {eventText(e.summary)}{' '}
                <Subject kind={e.subject_kind} id={e.subject_id} open={open} />
                <small> · #{e.sequence}</small>
              </li>
            ))}
          </ol>
        )}
        {next && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load(next)}
          >
            Older activity
          </button>
        )}
      </Status>
    </section>
  );
}

function Subject({
  kind,
  id,
  open,
}: {
  kind: string;
  id: string;
  open: (view: View, id?: string) => void;
}) {
  const target = subjectTarget(kind, id);
  const label = `${kind} ${shortId(id)}`;
  return target ? (
    <button className="text" onClick={() => open(target[0], target[1])}>
      {label}
    </button>
  ) : (
    <span>{label}</span>
  );
}
