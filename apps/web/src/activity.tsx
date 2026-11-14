import { useEffect, useState, type FormEvent } from 'react';
import { kindLabel } from './plain-words.js';
import { useViewMode } from './view-mode.js';
import { EventLine } from './event-line.js';
import {
  ActivityPageSchema,
  type ActivityEntry,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { Empty, Status, shortId, type View } from './ui.js';
import { useOnShow } from './page-active.js';
import { canOpen, useOpenSubject } from './destinations.js';

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
  const { standard } = useViewMode();
  const [draft, setDraft] = useState(q);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const action = focus;
  useEffect(() => setDraft(q), [q]);
  const opener = useOpenSubject(workspace.id, open);
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
        Every change you or the studio made, newest first. Lines name the kind
        of record and what happened to it, never the record&apos;s own text.
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
                <EventLine
                  summary={e.summary}
                  fixture={workspace.record_mode === 'fixture'}
                />{' '}
                <Subject
                  kind={e.subject_kind}
                  id={e.subject_id}
                  opener={opener}
                  eventKey={e.event_id}
                />
                {!standard && <small> · event #{e.sequence}</small>}
                {opener.notice?.key === e.event_id && (
                  <p className="small" role="status">
                    {opener.notice.text}
                  </p>
                )}
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

/**
 * The event's subject as a link to the result itself (the record, run, code version or
 * conversation), not to this event. Kinds no page shows stay plain text.
 */
function Subject({
  kind,
  id,
  opener,
  eventKey,
}: {
  kind: string;
  id: string;
  opener: ReturnType<typeof useOpenSubject>;
  eventKey: string;
}) {
  // P-8: the line already names the kind, so Standard offers only "Open" (and nothing for a
  // kind no page shows); Advanced names the kind with the record's short id.
  const { standard } = useViewMode();
  const label = `${kind.replace(/_/g, ' ')} ${shortId(id)}`;
  if (!canOpen(kind)) return standard ? null : <span>{label}</span>;
  const button = (
    <button
      className="text"
      aria-busy={opener.busy === eventKey}
      title={`Open this ${kindLabel(kind)}`}
      aria-label={standard ? `Open this ${kindLabel(kind)}` : undefined}
      onClick={() => void opener.openSubject(kind, id, eventKey)}
    >
      {standard ? 'Open' : label}
    </button>
  );
  return standard ? <>· {button}</> : button;
}
