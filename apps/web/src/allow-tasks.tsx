import { useState } from 'react';
import type { PlanConnection } from '@creator/contracts';
import {
  TASK_CLASS_CHOICES,
  classChanges,
  orderedClasses,
  taskChoicesFor,
} from './caps-fields.js';

/**
 * ADR-0084 (P23, Decision A): one-click "allow" for a connection that does not allow every task
 * its kind can take. It is the owner's Change caps route with only the task list changed, and
 * it shows the same "Will change" summary first. When the caps were accepted before, the same
 * confirmation accepts them again (the version and `caps_accepted_at` move as with any change);
 * when they were not, they stay unaccepted. Nothing is sent before the person confirms, and
 * the server still refuses anyone but the owner and any task the connection kind cannot take.
 */
type Act = (
  path: string,
  body: unknown,
  timeoutMs?: number,
  local?: (error: string) => void,
) => Promise<unknown>;
type AllowConnection = Pick<
  PlanConnection,
  'id' | 'kind' | 'version' | 'settings' | 'caps_accepted_at'
>;

/**
 * The requests one allow press makes: the settings with `after` as the allowed tasks, then,
 * only when the caps were accepted before, accept-caps for the version and hash that save
 * returned. Errors go to `report`, which must outlive the button: saving reloads the page,
 * the task is then allowed and the button is gone before the second answer arrives (review of
 * PR #172, L-1). Resolves to whether every step succeeded.
 */
export async function allowTaskSequence(
  c: AllowConnection,
  after: readonly string[],
  act: Act,
  report: (error: string) => void,
): Promise<boolean> {
  return allowSequence(c, { tasks: after }, act, report);
}

/**
 * ADR-0087 (P27): the same for data classes or tasks or both (`after` replaces the list it
 * names; a list left out is kept). "Allow approved private data" uses this.
 */
export async function allowSequence(
  c: AllowConnection,
  after: { data?: readonly string[]; tasks?: readonly string[] },
  act: Act,
  report: (error: string) => void,
): Promise<boolean> {
  const p = `plan-connections/${c.id}`;
  const saved = (await act(
    `${p}/settings`,
    {
      expected_version: c.version,
      settings: {
        ...c.settings,
        ...(after.data ? { allowed_data_classes: [...after.data] } : {}),
        ...(after.tasks ? { allowed_task_classes: [...after.tasks] } : {}),
      },
    },
    undefined,
    report,
  )) as { version?: number; settings_hash?: string } | null;
  if (!saved?.version || !saved.settings_hash) return false;
  if (c.caps_accepted_at === null) return true;
  const ok = await act(
    `${p}/accept-caps`,
    { expected_version: saved.version, settings_hash: saved.settings_hash },
    undefined,
    (e) =>
      report(
        `${after.data ? 'The change was saved' : 'The tasks were allowed'}, but the caps were not accepted again, so model calls on this connection are blocked: ${e} Press "Accept these caps and allowed work" under Models and connections.`,
      ),
  );
  return Boolean(ok);
}

export function AllowTasks({
  connection: c,
  tasks,
  label,
  busy,
  act,
  onError,
}: {
  connection: AllowConnection;
  /** The tasks to add; ones the connection already allows or its kind cannot take are ignored. */
  tasks: readonly string[];
  label: string;
  busy: boolean;
  act: Act;
  /** Where a refusal is shown; it must outlive this button (see `allowTaskSequence`). */
  onError: (error: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const before = c.settings.allowed_task_classes;
  const after = orderedClasses(taskChoicesFor(c.kind), [...before, ...tasks]);
  const changes = classChanges(
    { data: c.settings.allowed_data_classes, tasks: before },
    { data: c.settings.allowed_data_classes, tasks: after },
  );
  if (changes.length === 0) return null;
  const accepted = c.caps_accepted_at !== null;
  async function allow() {
    onError('');
    setWorking(true);
    try {
      if (await allowTaskSequence(c, after, act, onError)) setOpen(false);
    } finally {
      setWorking(false);
    }
  }
  return (
    <span className="allow-tasks">
      {open ? (
        <span
          className="notice small"
          role="group"
          aria-label={label}
          // Inside the right-aligned details list, the summary still reads left to right.
          style={{ display: 'block', textAlign: 'left' }}
        >
          Will change: {changes.join('; ')}.{' '}
          {accepted
            ? 'Your caps stay the same and are accepted again with this change.'
            : 'The caps are still not accepted; accept them before anything runs.'}{' '}
          <button
            type="button"
            disabled={busy || working}
            onClick={() => void allow()}
          >
            {working ? 'Allowing…' : 'Allow'}
          </button>{' '}
          <button
            type="button"
            className="text"
            disabled={working}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      )}
    </span>
  );
}

/** A task class in words, as the Change caps form names it. */
export const taskLabel = (key: string) =>
  TASK_CLASS_CHOICES.find((x) => x.key === key)?.label ?? key;
