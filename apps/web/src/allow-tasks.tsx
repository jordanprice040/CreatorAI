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
export function AllowTasks({
  connection: c,
  tasks,
  label,
  busy,
  act,
}: {
  connection: Pick<
    PlanConnection,
    'id' | 'kind' | 'version' | 'settings' | 'caps_accepted_at'
  >;
  /** The tasks to add; ones the connection already allows or its kind cannot take are ignored. */
  tasks: readonly string[];
  label: string;
  busy: boolean;
  act: (
    path: string,
    body: unknown,
    timeoutMs?: number,
    local?: (error: string) => void,
  ) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const before = c.settings.allowed_task_classes;
  const after = orderedClasses(taskChoicesFor(c.kind), [...before, ...tasks]);
  const changes = classChanges(
    { data: c.settings.allowed_data_classes, tasks: before },
    { data: c.settings.allowed_data_classes, tasks: after },
  );
  if (changes.length === 0) return null;
  const accepted = c.caps_accepted_at !== null;
  const p = `plan-connections/${c.id}`;
  async function allow() {
    setError('');
    setWorking(true);
    try {
      const saved = (await act(
        `${p}/settings`,
        {
          expected_version: c.version,
          settings: { ...c.settings, allowed_task_classes: after },
        },
        undefined,
        setError,
      )) as { version?: number; settings_hash?: string } | null;
      if (!saved?.version || !saved.settings_hash) return;
      if (accepted) {
        const ok = await act(
          `${p}/accept-caps`,
          {
            expected_version: saved.version,
            settings_hash: saved.settings_hash,
          },
          undefined,
          setError,
        );
        if (!ok) return;
      }
      setOpen(false);
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
            onClick={() => {
              setOpen(false);
              setError('');
            }}
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
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </span>
  );
}

/** A task class in words, as the Change caps form names it. */
export const taskLabel = (key: string) =>
  TASK_CLASS_CHOICES.find((x) => x.key === key)?.label ?? key;
