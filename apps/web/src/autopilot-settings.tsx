import { useEffect, useState } from 'react';
import {
  AUTOPILOT_SETTING_TEXT,
  AutopilotSettingsSchema,
  NOT_HANDS_OFF,
  handsOff,
  isHandsOff,
  handsOffMissing,
  type AutopilotSettingKey,
  type AutopilotSettingsValues,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { Status, useLoad } from './ui.js';
import { Explain, useSectionState } from './explain.js';

// ADR-0100: the owner's autopilot settings. Each switch lets an autopilot (Run it for me, Automate
// the rest, Automate selection) take a planned fallback instead of stopping for you at one kind
// of stop. Hands-off turns on every fallback except choosing past model-only ethics and accepting
// quote-checked web claims, which the owner turns on one by one.

/** Sent on `window` after the settings change, so a stopped card reads them again. */
export const AUTOPILOT_SETTINGS_CHANGED = 'creator:autopilot-settings-changed';

/**
 * The workspace's autopilot settings, read again when they change; null until read (or when they
 * cannot be read). Forms use it to size the run's approvals for a web search the settings allow.
 */
export function useAutopilotSettings(
  base: string,
): AutopilotSettingsValues | null {
  const [v, setV] = useState<AutopilotSettingsValues | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void api(AutopilotSettingsSchema, `${base}/autopilot-settings`)
        .then((s) => live && setV(s.values))
        .catch(() => live && setV(null));
    read();
    window.addEventListener(AUTOPILOT_SETTINGS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(AUTOPILOT_SETTINGS_CHANGED, read);
    };
  }, [base]);
  return v;
}

const SWITCHES: AutopilotSettingKey[] = [
  'gather_evidence',
  'choose_with_unknowns',
  'break_ties',
  'keep_close_leader',
  'next_candidate',
  'draft_proposal_sections',
  'close_unknown_plan_requests',
  'choose_model_ethics',
  'accept_quote_checked_claims',
];

/** The saved switches in a few words, for the closed Standard fold. */
export function settingsState(values: AutopilotSettingsValues): string {
  const on = SWITCHES.filter((k) => values[k] === true);
  if (on.length === 0) return 'All off: the autopilot stops for you';
  if (isHandsOff(values)) {
    const extra = on.filter((k) => NOT_HANDS_OFF.includes(k));
    return `Hands-off is on${extra.length ? `, and ${extra.map((k) => AUTOPILOT_SETTING_TEXT[k].label).join(', ')}` : ''}`;
  }
  return `On: ${on.map((k) => AUTOPILOT_SETTING_TEXT[k].label).join(', ')}`;
}

export function AutopilotSettingsPanel({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const base = `workspaces/${workspace.id}`;
  const ctx = useLoad(
    () => api(AutopilotSettingsSchema, `${base}/autopilot-settings`),
    [workspace.id],
  );
  const s = ctx.data;
  const [draft, setDraft] = useState<AutopilotSettingsValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(s?.values ?? null), [s?.version, s?.values]);
  useEffect(() => {
    const again = () => ctx.refresh();
    window.addEventListener(AUTOPILOT_SETTINGS_CHANGED, again);
    return () => window.removeEventListener(AUTOPILOT_SETTINGS_CHANGED, again);
  }, [ctx]);
  const changed =
    !!s && !!draft && JSON.stringify(s.values) !== JSON.stringify(draft);
  // Review 1 of #255, M-2: the closed fold in Standard says which fallbacks are on.
  useSectionState(s ? settingsState(s.values) : null);

  async function save(values: AutopilotSettingsValues) {
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      await api(AutopilotSettingsSchema, `${base}/autopilot-settings`, {
        csrf: session.csrf_token,
        body: { expected_version: s.version, values },
      });
      window.dispatchEvent(new Event(AUTOPILOT_SETTINGS_CHANGED));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      ctx.refresh();
    }
  }

  return (
    <div className="notice" aria-labelledby="ap-settings-title">
      <p id="ap-settings-title">
        <strong>When the autopilot would stop</strong>
      </p>
      <Explain short="Let the autopilot take a fallback instead of stopping. All off by default.">
        Each switch lets an autopilot take a planned fallback instead of
        stopping for you. All are off until you turn them on. None approves a
        step, raises a budget or a connection cap, or clears a gate; each choice
        it makes this way says which setting allowed it.
      </Explain>
      <Status
        loading={ctx.loading}
        error={ctx.error}
        stale={ctx.stale}
        retry={ctx.reload}
      >
        {s && draft && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save(draft);
            }}
          >
            <p className="small" aria-live="polite">
              {isHandsOff(s.values)
                ? 'Hands-off is on: the autopilot recovers by itself wherever a setting allows.'
                : `Hands-off is off.${
                    // Only when part of it is on, e.g. Hands-off saved before a switch joined it.
                    handsOffMissing(s.values).length <
                    Object.keys(s.values).length - NOT_HANDS_OFF.length
                      ? ` Not on yet: ${handsOffMissing(s.values)
                          .map((k) => AUTOPILOT_SETTING_TEXT[k].label)
                          .join(', ')}.`
                      : ''
                  }`}
              {s.updated_at ? ` Last changed ${when(s.updated_at)}.` : ''}
            </p>
            {/* Autopilot friction pass (November 28): Hands-off on, web searches still stopped
                for their claims, and the owner took Hands-off to cover them. */}
            {isHandsOff(s.values) && !s.values.accept_quote_checked_claims && (
              <p className="small model-note model-note-warn" role="note">
                Web searches still stop for you to read the claims they find:
                Hands-off leaves “
                {AUTOPILOT_SETTING_TEXT.accept_quote_checked_claims.label}” to
                you. Turn it on below if the autopilot may use them as checked
                by their quotes only.
              </p>
            )}
            <StillStops />
            {s.can_change && !isHandsOff(draft) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(handsOff(draft))}
              >
                Turn on Hands-off
              </button>
            )}
            {SWITCHES.map((k) => (
              <label key={k} className="routine-choice">
                <input
                  type="checkbox"
                  disabled={!s.can_change || busy}
                  checked={draft[k] as boolean}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [k]: e.target.checked,
                      ...(k === 'gather_evidence' &&
                      e.target.checked &&
                      draft.max_extra_searches === 0
                        ? { max_extra_searches: 1 }
                        : {}),
                    })
                  }
                />
                <span>
                  <strong>{AUTOPILOT_SETTING_TEXT[k].label}</strong>
                  {NOT_HANDS_OFF.includes(k) ? ' (not part of Hands-off)' : ''}
                  <span className="small">
                    {' '}
                    {AUTOPILOT_SETTING_TEXT[k].text}
                  </span>
                </span>
              </label>
            ))}
            <div className="two">
              <div>
                <label htmlFor="ap-searches">
                  {AUTOPILOT_SETTING_TEXT.max_extra_searches.label}
                </label>
                <input
                  id="ap-searches"
                  type="number"
                  min={0}
                  max={3}
                  disabled={!s.can_change || busy || !draft.gather_evidence}
                  value={draft.max_extra_searches}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      max_extra_searches: Math.max(
                        0,
                        Math.min(3, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
                <p className="small">
                  {AUTOPILOT_SETTING_TEXT.max_extra_searches.text}
                </p>
              </div>
              <div>
                <label htmlFor="ap-retries">
                  {AUTOPILOT_SETTING_TEXT.retry_failed.label} (times)
                </label>
                <input
                  id="ap-retries"
                  type="number"
                  min={0}
                  max={2}
                  disabled={!s.can_change || busy}
                  value={draft.retry_failed}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      retry_failed: Math.max(
                        0,
                        Math.min(2, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
                <p className="small">
                  {AUTOPILOT_SETTING_TEXT.retry_failed.text}
                </p>
              </div>
            </div>
            {s.can_change ? (
              <button type="submit" disabled={busy || !changed}>
                {busy ? 'Saving…' : 'Save autopilot settings'}
              </button>
            ) : (
              <p className="small">
                Only the workspace owner can change these.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </Status>
    </div>
  );
}

/**
 * Autopilot friction pass (November 28): what no setting here removes, so "fully automatic"
 * means what it says. These are the studio's fixed safety rules, not switches.
 */
/** The runner's AUTO_CLOSE_MAX (apps/api), said in words here. */
const AUTO_CLOSE_LIMIT = 3;

export function StillStops() {
  return (
    <details className="small">
      <summary>What still stops it, whatever these say</summary>
      <ul>
        <li>
          A paid request whose outcome is unknown, a plan request that may still
          be running, and plan requests once “Close unknown plan requests” has
          closed them {AUTO_CLOSE_LIMIT} times in one autopilot (or always, with
          that setting off): close them under Models and connections › Requests
          without a recorded outcome. No request starts on that connection until
          then.
        </li>
        <li>
          Limits: the connection’s per-run and daily request caps, the plan’s
          own usage limit (it can continue by itself after that one if you chose
          so at the start), the autopilot’s call limit and end time, and your
          spending ceiling.
        </li>
        <li>
          Steps its run’s routine approvals do not cover. Routine approvals let
          steps start without asking; these settings decide what happens when a
          step’s result needs a judgment. Hands-off running needs both.
        </li>
        <li>
          Publishing, sending messages, payments, GitHub, account or access
          changes and raising budgets: never automatic.
        </li>
        <li>
          Value questions, a flagged ethical concern, and writing or freezing a
          software spec.
        </li>
      </ul>
    </details>
  );
}
