import { useState } from 'react';
import type { PlanConnection, PlanOpenRequest } from '@creator/contracts';
import { when } from './oversight.js';

// ADR-0064: plan requests whose outcome the studio never recorded, with the owner's way to close
// them in the app (before, only `pnpm cli plan-reconcile`). While one is open no other request
// can start on the connection, chat answers included. The server decides whether a request can
// be closed; this only shows its answer and sends the owner's choice.

const PURPOSE: Record<PlanOpenRequest['request']['purpose'], string> = {
  verification: 'Model check',
  availability_recheck: 'Availability recheck',
  qualification: 'Qualification question',
  task: 'Workflow task',
  codex_build: 'Codex build request',
  chat: 'Chat answer',
};

export function OpenRequests({
  connection,
  open,
  owner,
  busy,
  act,
}: {
  connection: PlanConnection;
  open: PlanOpenRequest[];
  owner: boolean;
  busy: boolean;
  act: (
    path: string,
    body: unknown,
    timeoutMs?: number,
    local?: (error: string) => void,
  ) => Promise<unknown>;
}) {
  if (!open.length) return null;
  const limit = connection.settings.caps.shared.max_model_requests_per_day;
  return (
    <div className="open-requests">
      <h4>Requests without a recorded outcome</h4>
      <p>
        No other request can start on this connection, chat answers included,
        until {open.length === 1 ? 'this one is closed' : 'these are closed'}.
        Closing one only records what you know about it. It still counts as one
        of the {limit} requests a day on this connection, and whatever it used
        on your plan stays used.
      </p>
      <ul>
        {open.map((o) => (
          <li key={o.request.id}>
            <OpenRequest
              o={o}
              connection={connection}
              owner={owner}
              busy={busy}
              act={act}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenRequest({
  o,
  connection,
  owner,
  busy,
  act,
}: {
  o: PlanOpenRequest;
  connection: PlanConnection;
  owner: boolean;
  busy: boolean;
  act: (
    path: string,
    body: unknown,
    timeoutMs?: number,
    local?: (error: string) => void,
  ) => Promise<unknown>;
}) {
  const r = o.request;
  const [outcome, setOutcome] = useState<'ran' | 'did_not_run'>('ran');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sawOutput = (r.output_chars ?? 0) > 0;
  const id = `open-request-${r.id}`;
  const status =
    r.state === 'unknown'
      ? `Outcome unknown${r.reason_code ? ` (${r.reason_code})` : ''}. The studio could not tell whether ${r.model_id} answered.`
      : o.waiting
        ? 'Running. The studio is still waiting on it.'
        : o.closable
          ? 'Still marked as running, but well past its time limit: the studio most likely stopped during it.'
          : `Running, or the studio stopped during it. If nothing finishes it, it can be closed after ${when(o.closable_after!)}.`;
  return (
    <>
      <p>
        <strong>{PURPOSE[r.purpose]}</strong> · {r.model_id} · started{' '}
        <time dateTime={r.started_at}>{when(r.started_at)}</time>
      </p>
      <p className="small">{status}</p>
      {owner && o.closable && (
        <details className="open-request-close">
          <summary>Close this request…</summary>
          <fieldset aria-describedby={`${id}-help`}>
            <legend>What happened to it?</legend>
            <p id={`${id}-help`} className="small">
              Pick what you know; it is kept with the request as a record. If
              you cannot tell, choose that it may have run, so the record never
              says it did not run when it might have.
            </p>
            <label>
              <input
                type="radio"
                name={`${id}-outcome`}
                checked={outcome === 'ran'}
                onChange={() => setOutcome('ran')}
              />{' '}
              It ran, or I cannot tell
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-outcome`}
                checked={outcome === 'did_not_run'}
                disabled={sawOutput}
                onChange={() => setOutcome('did_not_run')}
              />{' '}
              It did not run (I checked, for example on the plan's usage page)
            </label>
            {sawOutput && (
              <p className="small">
                Part of an answer arrived, so it cannot be recorded as not run.
              </p>
            )}
            <label>
              Note (what you checked)
              <input
                value={note}
                maxLength={1200}
                placeholder="e.g. The app was closed while it was asking."
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              disabled={busy || sending || !note.trim()}
              onClick={async () => {
                setSending(true);
                setError('');
                try {
                  await act(
                    `plan-connections/${connection.id}/reconcile`,
                    {
                      request_id: r.id,
                      expected_version: connection.version,
                      outcome,
                      note: note.trim(),
                    },
                    undefined,
                    setError,
                  );
                } finally {
                  setSending(false);
                }
              }}
            >
              Close this request
            </button>
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </details>
      )}
      {!owner && o.closable && (
        <p className="small">Only the workspace owner can close it.</p>
      )}
    </>
  );
}
