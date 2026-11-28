import { useEffect, useRef, useState } from 'react';
import {
  AUTO_RESUME_MAX_CHECKS,
  AutopilotSchema,
  AutopilotUsageCheckSchema,
  type Autopilot,
  type AutopilotConfig,
  type AutopilotUsageCheck,
  type SessionInfo,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';

// ADR-0124 (F2): before an autopilot starts, how many plan requests it needs beside what the
// connection has left (the server counts both the way the start check and admission do), and
// on a stopped card, whether it continues by itself after a usage limit, with a way to turn that
// off. Shown only for a plan connection; an API budget or local model has no such limit.

/** The usage check for the form's current draft; null while there is none or it failed. */
export function useUsageCheck(
  base: string,
  session: SessionInfo,
  config: AutopilotConfig | null,
  enabled: boolean,
  /** Read again when this changes (for example after an autopilot starts). */
  again: unknown,
): { check: AutopilotUsageCheck | null; error: string } {
  const [state, setState] = useState<{
    key: string;
    check: AutopilotUsageCheck | null;
    error: string;
  } | null>(null);
  const seq = useRef(0);
  const key = enabled && config ? JSON.stringify(config) : '';
  useEffect(() => {
    if (!key || !config) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api(AutopilotUsageCheckSchema, `${base}/autopilots/usage-check`, {
        csrf: session.csrf_token,
        body: { config },
        quiet: true,
      }).then(
        (check) => mine === seq.current && setState({ key, check, error: '' }),
        (e: unknown) =>
          mine === seq.current &&
          setState({ key, check: null, error: message(e) }),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [key, base, again]);
  return state?.key === key && key
    ? { check: state.check, error: state.error }
    : { check: null, error: '' };
}

/** "Needs about N requests; M left today", one line per connection, and what it cannot see. */
export function UsageCheckNote({
  check,
  error,
}: {
  check: AutopilotUsageCheck | null;
  error: string;
}) {
  if (error)
    return (
      <p className="small" role="note">
        The usage check could not be read: {error}
      </p>
    );
  if (!check || check.connections.length === 0) return null;
  const warn = check.connections.some((c) => c.fit !== 'fits');
  return (
    <div
      className={`small model-note${warn ? ' model-note-warn' : ''}`}
      role="note"
      aria-label="Usage check"
    >
      {check.connections.map((c) => (
        <p key={c.connection_id}>{c.line}</p>
      ))}
      <p>{check.note}</p>
    </div>
  );
}

/** The opt-in on the start form (plan connections only). */
export function ResumeChoice({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />{' '}
      If the plan's usage limit or the daily request cap stops it, continue
      automatically once the limit resets. Both limits are checked again after
      1, 2, then every 4 hours; the daily cap also needs room for the stopped
      step. At most {AUTO_RESUME_MAX_CHECKS} times, and only inside this run's
      approvals, call limit and end time.
    </label>
  );
}

/** On a card: where continuing by itself stands, and Turn off for the owner. */
export function AutoResumeStatus({
  a,
  base,
  session,
  owner,
  onDone,
}: {
  a: Autopilot;
  base: string;
  session: SessionInfo;
  owner: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = a.auto_resume;
  if (!r) return null;
  const stoppedOnLimit =
    a.state === 'finished' &&
    ['usage_limit', 'daily_cap'].includes(a.steps.at(-1)?.stop_kind ?? '');
  const text =
    r.state === 'waiting'
      ? `It continues by itself: it checks the ${a.steps.at(-1)?.stop_kind === 'daily_cap' ? "connection's daily request cap" : "plan's usage limit"} again ${r.next_check_at && Date.parse(r.next_check_at) > Date.now() ? `at ${when(r.next_check_at)}` : 'every minute until the connection has room for this step'} (automatic continue ${r.checks + 1} of ${r.max}).`
      : r.state === 'turned_off'
        ? `Continuing by itself after a usage limit was turned off${r.turned_off_at ? ` ${when(r.turned_off_at)}` : ''}.`
        : r.state === 'used_up'
          ? `It has continued by itself ${r.max} times, the most it may; continue it yourself.`
          : stoppedOnLimit
            ? 'It will not continue by itself: its next check would come after its end time, or it cannot continue.'
            : // Autopilot friction pass (November 28): read beside another kind of stop, the
              // plain "set to continue by itself" sounded as if this stop would pass by itself.
              a.state === 'finished'
              ? `It continues by itself only after a usage limit; this stop needs you${r.checks ? ` (${r.checks} of ${r.max} automatic continues used)` : ''}.`
              : `Set to continue by itself after a usage limit${r.checks ? ` (${r.checks} of ${r.max} used)` : ''}.`;
  const canTurnOff = owner && (r.state === 'waiting' || r.state === 'on');

  async function off() {
    setBusy(true);
    setError('');
    try {
      await api(AutopilotSchema, `${base}/autopilots/${a.id}/auto-resume`, {
        csrf: session.csrf_token,
        body: { expected_version: a.version },
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <div className="small">
      <p>{text}</p>
      {canTurnOff && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void off()}
        >
          Don't continue by itself
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
