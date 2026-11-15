import { useEffect, useState } from 'react';
import {
  AutopilotSchema,
  z,
  type Autopilot,
  type SessionInfo,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { AUTOPILOTS_CHANGED } from './autopilot-routes.js';
import { continueLabel, waitingAutopilot } from './autopilot-waiting-rules.js';

/** Decide: the autopilot waiting on this problem, with its Continue right here. */
export function WaitingAutopilot({
  base,
  problemId,
  session,
  owner,
}: {
  base: string;
  problemId: string;
  session: SessionInfo;
  owner: boolean;
}) {
  const [list, setList] = useState<Autopilot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    const read = () =>
      void api(z.array(AutopilotSchema), `${base}/autopilots`)
        .then((xs) => live && setList(xs))
        .catch(() => live && setList([]));
    read();
    window.addEventListener(AUTOPILOTS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(AUTOPILOTS_CHANGED, read);
    };
  }, [base]);
  // PR #211 review 2 N-3: the card goes away at the autopilot's end time, also while Decide
  // stays open.
  const [now, setNow] = useState(() => Date.now());
  const a = waitingAutopilot(list, problemId, now);
  const ends = a ? Date.parse(a.config.limits.ends_at) : null;
  useEffect(() => {
    if (ends === null) return;
    const t = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, ends - Date.now()) + 1000, 2 ** 31 - 1),
    );
    return () => window.clearTimeout(t);
  }, [ends, now]);
  if (!a && !done) return null;
  async function go(x: Autopilot) {
    setBusy(true);
    setError('');
    try {
      await api(AutopilotSchema, `${base}/autopilots/${x.id}/continue`, {
        csrf: session.csrf_token,
        body: { expected_version: x.version },
      });
      setDone(
        'The autopilot is going on; follow it under Discover › Run it for me.',
      );
      window.dispatchEvent(new Event(AUTOPILOTS_CHANGED));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notice">
      {a ? (
        <>
          <p>
            An autopilot started {when(a.created_at)} is waiting on this
            problem: {a.explanation}
          </p>
          <p className="small">
            Confirm gates or choose above first; Continue then tries the step
            again with what you recorded.
          </p>
          {owner ? (
            <button disabled={busy} onClick={() => void go(a)}>
              {continueLabel(a)}
            </button>
          ) : (
            <p className="small">Only the workspace owner can continue it.</p>
          )}
        </>
      ) : null}
      {/* PR #211 review 2 N-2: only the result is announced, not every refresh. */}
      <p role="status" aria-live="polite">
        {done}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
