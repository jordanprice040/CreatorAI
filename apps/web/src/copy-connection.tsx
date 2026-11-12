import { useState } from 'react';
import {
  z,
  CopyPlanConnectionResultSchema,
  WorkspaceSchema,
  type CopyPlanConnectionResult,
  type PlanConnection,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  copiedSteps,
  copyTargets,
  noTargetText,
} from './copy-connection-text.js';

/**
 * ADR-0095 (P30): copies a connection's caps and allowed work into another workspace the person
 * owns. The copy is new there: it is not signed in, has no verified models or qualifications,
 * and its caps wait to be accepted. Owner only; the server checks both workspaces.
 */
export function CopyConnection({
  workspace,
  session,
  connection,
  disabled,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
  connection: PlanConnection;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Workspace[] | null>(null);
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState(connection.label);
  const [chat, setChat] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{
    out: CopyPlanConnectionResult;
    target: string;
  } | null>(null);

  async function start() {
    setOpen(true);
    setDone(null);
    setError('');
    setLabel(connection.label);
    try {
      const list = copyTargets(
        await api(z.array(WorkspaceSchema), 'workspaces'),
        workspace,
      );
      setTargets(list);
      setTarget(list[0]?.id ?? '');
    } catch (e) {
      setError(message(e));
    }
  }
  async function copy() {
    if (!session || !target) return;
    setBusy(true);
    setError('');
    try {
      const out = await api(
        CopyPlanConnectionResultSchema,
        `workspaces/${workspace.id}/plan-connections/${connection.id}/copy`,
        {
          csrf: session.csrf_token,
          body: {
            expected_version: connection.version,
            target_workspace_id: target,
            label: label.trim(),
            chat_answers: chat,
          },
        },
      );
      setDone({
        out,
        target: targets?.find((w) => w.id === target)?.name ?? 'that workspace',
      });
      setOpen(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div role="status" className="copy-connection">
        <p>
          Copied "{done.out.connection.label}" to "{done.target}". Left to do
          there:
        </p>
        <ol>
          {copiedSteps(
            done.out.connection.kind,
            done.target,
            done.out.connection.label,
            done.out.chat_answers,
          ).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <button className="secondary" onClick={() => setDone(null)}>
          Close
        </button>
      </div>
    );
  if (!open)
    return (
      <button
        className="secondary"
        disabled={disabled || !session}
        onClick={() => void start()}
      >
        Copy to another workspace
      </button>
    );
  return (
    <form
      className="copy-connection"
      onSubmit={(e) => {
        e.preventDefault();
        void copy();
      }}
    >
      <fieldset>
        <legend>Copy to another workspace</legend>
        <p>
          Copies this connection's caps and allowed work. The copy starts signed
          out, with no verified models or qualifications, and its caps wait for
          you to accept them there. This connection is not changed.
        </p>
        {error && <p role="alert">{error}</p>}
        {targets === null && !error && <p role="status">Loading workspaces…</p>}
        {targets?.length === 0 && <p>{noTargetText(workspace)}</p>}
        {!!targets?.length && (
          <>
            <label htmlFor={`copy-to-${connection.id}`}>Workspace</label>
            <select
              id={`copy-to-${connection.id}`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {targets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <label htmlFor={`copy-name-${connection.id}`}>Name there</label>
            <input
              id={`copy-name-${connection.id}`}
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <label className="inline">
              <input
                type="checkbox"
                checked={chat}
                onChange={(e) => setChat(e.target.checked)}
              />{' '}
              Also copy the Chat answers setting, if Chat answers here use this
              connection and that workspace has none yet
            </label>
          </>
        )}
        <div className="actions">
          <button
            disabled={busy || !session || !target || !label.trim()}
            type="submit"
          >
            {busy ? 'Copying…' : 'Copy'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
