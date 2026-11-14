import { useEffect, useState } from 'react';
import {
  AutopilotSchema,
  AutopilotSettingsSchema,
  type Autopilot,
  type SessionInfo,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { AUTOPILOT_SETTINGS_CHANGED } from './autopilot-settings.js';

// ADR-0100: "Allow this from now on and continue" on a stopped autopilot. One request turns on the
// owner's setting that covers this kind of stop and continues the autopilot; the server refuses it
// if either changed since they were read. The other next steps are shown by the card's own text.

export function AllowAndContinue({
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
  // Review 1 N-3: the settings version this card was shown with, so the server refuses the
  // request if someone changed the settings since.
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void api(AutopilotSettingsSchema, `${base}/autopilot-settings`)
        .then((s) => live && setSeen(s.version))
        .catch(() => live && setSeen(null));
    read();
    // Settings saved on this page are shown at once, so the card reads them again.
    window.addEventListener(AUTOPILOT_SETTINGS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(AUTOPILOT_SETTINGS_CHANGED, read);
    };
  }, [base, a.version]);
  const allow = a.next?.find((n) => n.kind === 'allow_and_continue');
  if (!allow?.setting || a.state !== 'finished') return null;

  async function go() {
    if (!allow?.setting || seen === null) return;
    setBusy(true);
    setError('');
    try {
      await api(AutopilotSchema, `${base}/autopilots/${a.id}/allow`, {
        csrf: session.csrf_token,
        body: {
          expected_version: a.version,
          settings_version: seen,
          setting: allow.setting,
        },
      });
      window.dispatchEvent(new Event(AUTOPILOT_SETTINGS_CHANGED));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <div className="small">
      {owner ? (
        <button
          type="button"
          className="secondary"
          disabled={busy || seen === null}
          onClick={() => void go()}
        >
          {busy ? 'Allowing…' : allow.label}
        </button>
      ) : (
        <p>The workspace owner can allow this kind of stop to continue.</p>
      )}{' '}
      {allow.detail}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
