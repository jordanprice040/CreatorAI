// ADR-0094 (P29, walk item 6): when a connection's daily request cap is used up, the owner can
// add 20 requests for the next 24 hours, as often as it runs out (Jordan, November 11, 2026).
// The extra lasts as long as the rolling window, so only the window in use now is raised; the
// configured cap stays and is changed only in the connection's caps. The server decides: it
// refuses anyone but the owner, and refuses a press while the connection still has room.
import { useState } from 'react';
import {
  z,
  PLAN_EXTRA_HOURS,
  PLAN_EXTRA_REQUESTS,
  type PlanConnection,
  type PlanConnectionDetail,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { atText, extraConfirmText, extraLine } from './extra-requests-text.js';

export { extraConfirmText, extraLine };

/**
 * The owner's "Add 20 requests" press with its confirmation. `onDone` reads the page again;
 * the server's refusal (not the owner, room left, a stale version) shows beside the button.
 */
export function AddExtraRequests({
  path,
  csrf,
  version,
  configured,
  cap,
  onDone,
}: {
  /** The connection's API path, e.g. `workspaces/<ws>/plan-connections/<id>`. */
  path: string;
  csrf: string;
  version: number;
  configured: number;
  /** The cap in force now (configured plus any unexpired extra). */
  cap: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function add() {
    setBusy(true);
    setError('');
    try {
      await api(z.unknown(), `${path}/extra-requests`, {
        body: { expected_version: version, requests: PLAN_EXTRA_REQUESTS },
        csrf,
      });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="extra-requests">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Add {PLAN_EXTRA_REQUESTS} requests for {PLAN_EXTRA_HOURS} hours
        </button>
      ) : (
        <span className="extra-confirm">
          <span className="small">{extraConfirmText(configured, cap)}</span>
          <span className="extra-buttons">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void add()}
            >
              {busy ? 'Adding…' : `Add ${PLAN_EXTRA_REQUESTS} requests`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </span>
        </span>
      )}
      {error && (
        <span className="error small" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * On a connection's card in Models and connections: says when the daily cap is used up and
 * when the next request is possible (review L-3), shows extra requests in force, and offers the
 * press when the server says this person may add them (review L-1). Nothing when there is room
 * and no extra.
 */
export function DailyCapNotice({
  path,
  csrf,
  connection,
  usage,
  onDone,
}: {
  path: string;
  csrf: string;
  connection: PlanConnection;
  usage: PlanConnectionDetail['usage'];
  onDone: () => void;
}) {
  const configured = connection.settings.caps.shared.max_model_requests_per_day;
  const cap = configured + usage.extra_requests;
  const full = usage.last_24h_requests >= cap;
  const line = extraLine(usage.extras, configured);
  if (!full && !line) return null;
  const at = usage.next_frees_at
    ? `The next request is possible at ${atText(usage.next_frees_at)}`
    : 'New requests wait until older ones leave the 24-hour window';
  return (
    <div className={full ? 'extra-notice usage-alert' : 'extra-notice'}>
      {full && (
        <p className="small" role="status">
          This connection&apos;s daily cap is used up: {usage.last_24h_requests}{' '}
          of {cap} requests in the last 24 hours. {at}
          {usage.can_add_extra
            ? ', or add extra requests now.'
            : '; the workspace owner can add extra requests.'}
        </p>
      )}
      {line && <p className="small">{line}</p>}
      {full && usage.can_add_extra && csrf && (
        <AddExtraRequests
          path={path}
          csrf={csrf}
          version={connection.version}
          configured={configured}
          cap={cap}
          onDone={onDone}
        />
      )}
    </div>
  );
}
