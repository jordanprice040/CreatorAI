import { useEffect, useState } from 'react';
import {
  CHAT_CONTEXT_KINDS,
  CHAT_SELECTED_MAX,
  z,
  type ChatContext,
  type ChatScope,
} from '@creator/contracts';
import { api, message as errorText } from './oversight.js';

// ADR-0070: what a chat answer may use. The person picks the context before sending; the
// server applies it (an explicit choice wins over its own rules) and records what was sent.

export const SCOPE_LABEL: Record<ChatScope, string> = {
  auto: 'Automatic',
  general: 'General',
  project: 'My projects',
  selected: 'Selected records',
};
export const CONTEXT_LABEL: Record<ChatContext, string> = {
  general: 'General: no studio records',
  project: 'My projects: a short studio snapshot',
  selected: 'Selected records',
};
const SCOPE_HINT: Record<ChatScope, string> = {
  auto: 'Studio records are sent only when your message mentions them ("my ideas", "this project").',
  general:
    'Answered as a general question. No studio records are sent and the message is never treated as a studio command.',
  project:
    'A short studio snapshot is sent: names, states and counts of runs, ideas, specs, products and waiting approvals.',
  selected: `Only the records you pick are sent (up to ${CHAT_SELECTED_MAX}): title, state and their short summary.`,
};
const KIND_LABEL: Record<string, string> = {
  problem: 'Problem',
  idea: 'Idea',
  specification: 'Spec',
  product: 'Product',
  run: 'Run',
};

export type PickedRecord = { id: string; kind: string; title: string };

/** PR #136 review L5: titles only (`brief=1`), not every record body. */
const Listed = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    updated_at: z.string(),
  }),
);
const SHOWN_MAX = 30;

/** The context choice above the message box, with the record picker for Selected records. */
export function ChatContextPicker({
  workspaceId,
  scope,
  onScope,
  picked,
  onPicked,
  disabled,
  studioAllowed,
}: {
  workspaceId: string;
  scope: ChatScope;
  onScope: (s: ChatScope) => void;
  picked: PickedRecord[];
  onPicked: (r: PickedRecord[]) => void;
  disabled: boolean;
  /** The owner's chat setting allows studio records at all. */
  studioAllowed: boolean;
}) {
  const [records, setRecords] = useState<PickedRecord[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  // PR #136 review L5: the list is read again each time Selected records is chosen, and on
  // Refresh, so records made after Chat opened can be picked.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (scope !== 'selected') {
      setRecords(null);
      return;
    }
    let live = true;
    setError('');
    Promise.all(
      CHAT_CONTEXT_KINDS.map((k) =>
        api(
          Listed,
          `workspaces/${workspaceId}/entities?kind=${k}&status=active&brief=1`,
        ),
      ),
    )
      .then((lists) => {
        if (!live) return;
        setRecords(
          lists
            .flat()
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .map((e) => ({ id: e.id, kind: e.kind, title: e.title })),
        );
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [scope, workspaceId, reload]);

  const pickedIds = new Set(picked.map((p) => p.id));
  const q = filter.trim().toLowerCase();
  const matching = (records ?? [])
    .filter((r) => !pickedIds.has(r.id))
    .filter((r) => !q || r.title.toLowerCase().includes(q));
  const shown = matching.slice(0, SHOWN_MAX);
  const full = picked.length >= CHAT_SELECTED_MAX;

  return (
    <div className="chat-context">
      <label>
        Context{' '}
        <select
          value={scope}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as ChatScope;
            onScope(next);
            if (next !== 'selected') onPicked([]);
          }}
        >
          {(Object.keys(SCOPE_LABEL) as ChatScope[]).map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>{' '}
      <span className="small">{SCOPE_HINT[scope]}</span>
      {!studioAllowed && (scope === 'project' || scope === 'selected') && (
        <p className="small" role="status">
          Studio records are turned off for chat answers (Models and connections
          › Chat answers), so this context cannot be sent. Choose General or
          Automatic.
        </p>
      )}
      {scope === 'selected' && (
        <div className="chat-picked">
          {picked.length > 0 && (
            <ul className="chat-chips" aria-label="Picked records">
              {picked.map((p) => (
                <li key={p.id}>
                  {KIND_LABEL[p.kind] ?? p.kind}: {p.title}{' '}
                  <button
                    type="button"
                    className="text"
                    aria-label={`Remove ${p.title}`}
                    disabled={disabled}
                    onClick={() =>
                      onPicked(picked.filter((x) => x.id !== p.id))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {records === null && !error && (
            <p className="small" role="status">
              Loading records…
            </p>
          )}
          {records !== null && records.length === 0 && (
            <p className="small">
              This workspace has no problems, ideas, specs, products or runs
              yet. Choose General to ask anything.
            </p>
          )}
          {records !== null && records.length > 0 && (
            <details>
              <summary>
                {full
                  ? `Picked the most (${CHAT_SELECTED_MAX})`
                  : 'Pick records'}
              </summary>
              <input
                type="search"
                placeholder="Filter by title"
                aria-label="Filter records"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="chat-pick-list">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="text"
                      disabled={disabled || full}
                      onClick={() => onPicked([...picked, r])}
                    >
                      {KIND_LABEL[r.kind] ?? r.kind}: {r.title}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="small">
                {matching.length > SHOWN_MAX &&
                  `Showing the newest ${SHOWN_MAX} of ${matching.length}; type to filter. `}
                <button
                  type="button"
                  className="text"
                  onClick={() => setReload((n) => n + 1)}
                >
                  Refresh the list
                </button>
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
