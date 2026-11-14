import { useEffect, useState } from 'react';
import {
  ConfirmGatesResultSchema,
  advanceOutlook,
  GateConfirmationSchema,
  capabilityLabel,
  type GateKind,
  type RankedCandidate,
  type SelectionDisposition,
  type SessionInfo,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import {
  batchNote,
  batchOptions,
  batchRequest,
  batchSummary,
  gateConfirmable,
  gatesConfirmableNow,
  sharedNeeded,
  tickedByDefault,
  type OwnReasons,
} from './gate-batch.js';
import { clip } from './ui.js';

type Detail = NonNullable<RankedCandidate['gates']['gate_details']>[number];

const GATE = { ethics: 'Ethics', access: 'Access' } as const;
const STATE: Record<Detail['state'], string> = {
  clear: 'clear',
  confirmed: 'confirmed by you',
  auto_cleared: 'cleared by your gate rule',
  unresolved: 'concern raised',
  not_assessed: 'needs your confirmation',
};

const ANSWER = {
  fail: 'failed',
  unknown: 'unknown',
  missing: 'not answered',
} as const;

/** What a person can do about one gate, in plain words (ADR-0090). */
export function gateGuidance(d: Detail): string | null {
  if (d.state === 'unresolved' && d.concerns.some((x) => x.by === 'person'))
    return 'A person raised this on their own scorecard; they resolve it by revising that scorecard.';
  if (d.state === 'unresolved')
    return d.gate === 'access'
      ? 'To resolve: say what the team can do in Settings › Team profile (tick it or run a built-in check), then assess again. If it is fine as it is, confirm it here.'
      : 'To resolve: check the concern against your evidence and add what answers it, then assess again. If it is fine as it is, confirm it here.';
  if (d.state === 'not_assessed' && d.assessed === false)
    return 'Nothing has assessed this yet. Assess the option or score it yourself first.';
  if (
    d.state === 'not_assessed' &&
    d.gate === 'access' &&
    d.rule === 'team_profile'
  )
    return 'Your gate rule clears access once the automatic assessment reads a team profile that answers at least one question. Answer one in Settings › Team profile and assess again, or confirm it here.';
  if (d.state === 'not_assessed' && d.rule === 'checklist') {
    const r = d.checklist;
    if (!r)
      return 'Your gate rule clears this once the automatic assessment answers your gate checklist and every item for this gate passes. Add an item for this gate in Settings › Team profile and assess again, or confirm it here.';
    if (r.failing.length)
      return 'Your gate checklist did not pass (the items are listed above). Add what answers them to your evidence or team profile and assess again, or confirm it here.';
    if (d.gate === 'access' && !r.needs.length)
      return 'The assessment named nothing this option needs, so the app had nothing to confirm in your team profile. Confirm it here if access is fine.';
    if (r.needs_missing.length)
      return 'Every item passed, but the app couldn’t confirm every needed capability in your team profile (listed above). Run its built-in check on this computer, or tick it in Settings › Team profile when no check can test it, then look again.';
  }
  if (d.state === 'not_assessed' && d.rule && d.rule !== 'owner')
    return 'Only the automatic assessment looked at this, and your gate rule doesn’t clear it. Confirm it here or score the option yourself.';
  if (d.state === 'not_assessed')
    return d.gate === 'access'
      ? 'Only the automatic assessment looked at this, and on its own it can’t clear a gate. Confirm it here, score the option yourself, or choose who clears gates in Settings › Team profile.'
      : 'Only the automatic assessment looked at this, and it can’t clear an ethics gate. Confirm it here, score the option yourself, or let the model’s word clear it in Settings › Team profile.';
  return null;
}

/**
 * Each gate of one option: its state, every concern with who raised it, what to do about it,
 * and the owner's one-click confirmation with a one-line reason.
 */
export function GateLines({
  cand,
  alternative,
  base,
  problemId,
  session,
  canConfirm,
  onOpenSettings,
  onDone,
}: {
  cand: RankedCandidate | undefined;
  alternative: { id: string; version: number };
  base: string;
  problemId: string;
  session: SessionInfo;
  canConfirm: boolean;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const details = cand?.gates.gate_details;
  const [open, setOpen] = useState<Detail['gate'] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Nothing to say when people's scorecards already cleared both gates.
  if (!details?.length || details.every((d) => d.state === 'clear'))
    return null;
  async function confirm(d: Detail) {
    setBusy(true);
    setError('');
    try {
      await api(
        GateConfirmationSchema,
        `${base}/problems/${problemId}/gate-confirmations`,
        {
          csrf: session.csrf_token,
          body: {
            alternative,
            gate: d.gate,
            reason: reason.trim(),
            concerns_seen: d.concerns.map((x) => x.scorecard),
          },
        },
      );
      setOpen(null);
      setReason('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') onDone();
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gate-lines">
      {details.map((d) => {
        const guidance = gateGuidance(d);
        const confirmable = canConfirm && gateConfirmable(d);
        return (
          <section key={d.gate} className="gate-line">
            <p className="small">
              <strong>{GATE[d.gate]}:</strong>{' '}
              <span
                className={`gate-${d.state === 'confirmed' || d.state === 'auto_cleared' ? 'clear' : d.state}`}
              >
                {d.state === 'auto_cleared'
                  ? d.confirmation?.rule_mode === 'model'
                    ? 'cleared on the model’s word (no person looked)'
                    : d.confirmation?.rule_mode === 'team_profile'
                      ? 'cleared by the model, from your team profile (no person looked)'
                      : d.confirmation?.rule_mode === 'checklist'
                        ? 'cleared by your gate checklist (no person looked)'
                        : STATE[d.state]
                  : STATE[d.state]}
              </span>
              {d.confirmation && (
                <>
                  {' '}
                  · {d.confirmation.reason}
                  {d.confirmation.by === 'owner' &&
                    ` (${when(d.confirmation.created_at)})`}
                </>
              )}
            </p>
            {d.concerns.length > 0 && (
              <ul className="small">
                {d.concerns.map((x) => (
                  <li key={x.scorecard}>
                    {x.by === 'system' ? 'Automatic assessment' : x.reviewer}:{' '}
                    {x.note}
                  </li>
                ))}
              </ul>
            )}
            {d.checklist &&
              (d.checklist.failing.length > 0 ||
                d.checklist.needs_missing.length > 0) && (
                <ul className="small checklist-misses">
                  {d.checklist.failing.map((f) => (
                    <li key={f.item}>
                      Checklist {f.item} {ANSWER[f.answer]}: {f.text} — {f.note}
                    </li>
                  ))}
                  {d.checklist.needs_missing.length > 0 && (
                    <li>
                      Needed, not confirmed in your team profile:{' '}
                      {d.checklist.needs_missing
                        .map(capabilityLabel)
                        .join(', ')}
                    </li>
                  )}
                </ul>
              )}
            {d.stale_confirmation && (
              <p className="small">
                Your earlier confirmation no longer counts:{' '}
                {d.stale_confirmation}
              </p>
            )}
            {guidance && d.state !== 'confirmed' && (
              <p className="small">
                {guidance}{' '}
                {d.gate === 'access' && d.state === 'unresolved' && (
                  <button className="text" onClick={onOpenSettings}>
                    Open the team profile
                  </button>
                )}
              </p>
            )}
            {confirmable &&
              (open === d.gate ? (
                <div className="actions">
                  <label htmlFor={`gate-reason-${alternative.id}-${d.gate}`}>
                    Why is {d.gate} fine for this option?
                  </label>
                  <input
                    id={`gate-reason-${alternative.id}-${d.gate}`}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void confirm(d)}
                  >
                    {busy ? 'Saving…' : 'Clear: I confirm'}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setOpen(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="secondary gate-confirm"
                  onClick={() => {
                    setOpen(d.gate);
                    setReason('');
                    setError('');
                  }}
                >
                  Clear {d.gate}: I confirm
                </button>
              ))}
          </section>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const OUTLOOK_WORD = {
  now: 'Can advance now',
  after_gates: 'Can advance once ethics and access are confirmed',
  never: 'Cannot advance yet, even with ethics and access confirmed',
} as const;

/**
 * UX pass P-4: first, which options can advance (build, validate or be recommended) and what
 * blocks the rest, in text; then, for the owner, one step to confirm ethics and access for the
 * options they tick, with one shared reason per gate and an optional reason of an option's own.
 */
export function AdvanceAndGates({
  cands,
  base,
  problemId,
  session,
  canConfirm,
  choiceLabel,
  onDone,
}: {
  cands: readonly RankedCandidate[];
  base: string;
  problemId: string;
  session: SessionInfo;
  canConfirm: boolean;
  choiceLabel: (d: SelectionDisposition) => string;
  onDone: () => void;
}) {
  const options = batchOptions(cands);
  const key = options
    .map(
      (o) =>
        `${o.cand.alternative.id}@${o.cand.alternative.version}:${o.gates.map((g) => `${g.gate}/${g.concerns.map((x) => x.scorecard).join(',')}`).join(';')}`,
    )
    .join('|');
  const [ticked, setTicked] = useState<Set<string>>(
    () =>
      new Set(
        options.filter(tickedByDefault).map((o) => o.cand.alternative.id),
      ),
  );
  const [shared, setShared] = useState<Partial<Record<GateKind, string>>>({});
  const [own, setOwn] = useState<Record<string, OwnReasons | undefined>>({});
  const [ownOpen, setOwnOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // A reloaded report with other options or concerns starts the ticks again from its defaults.
  useEffect(() => {
    setTicked(
      new Set(
        options.filter(tickedByDefault).map((o) => o.cand.alternative.id),
      ),
    );
    // Review N-2: own reasons typed for options still listed are kept.
    const still = new Set(options.map((o) => o.cand.alternative.id));
    setOwn((m) =>
      Object.fromEntries(Object.entries(m).filter(([id]) => still.has(id))),
    );
    setOwnOpen((s) => new Set([...s].filter((id) => still.has(id))));
  }, [key]);
  if (!cands.length) return null;
  const choices = (xs: readonly SelectionDisposition[]) =>
    xs.map(choiceLabel).join(', ');
  const built = batchRequest(options, ticked, shared, own);
  const needed = sharedNeeded(options, ticked, own);
  async function confirm() {
    if (!('request' in built)) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      const r = await api(
        ConfirmGatesResultSchema,
        `${base}/problems/${problemId}/gate-confirmations/batch`,
        { csrf: session.csrf_token, body: built.request },
      );
      setDone(
        `Recorded ${r.confirmations.length} gate confirmation${r.confirmations.length === 1 ? '' : 's'}.`,
      );
      setShared({});
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') onDone();
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };
  return (
    <section className="advance" aria-labelledby="advance-title">
      <h3 id="advance-title">Which options can advance</h3>
      <ul className="rows advance-list">
        {cands.map((c) => {
          const o = advanceOutlook(c);
          return (
            <li key={c.alternative.id}>
              <strong>{clip(c.alternative.title, 100)}</strong>{' '}
              <span className={`outlook outlook-${o.state}`}>
                {o.state === 'after_gates' && !gatesConfirmableNow(c)
                  ? 'Can advance once its ethics and access gates are resolved (see the option below)'
                  : OUTLOOK_WORD[o.state]}
              </span>
              {o.choices.length > 0 && <small> · {choices(o.choices)}</small>}
              {o.blocks.length > 0 && (
                <ul className="small">
                  {o.blocks.map((b) => (
                    <li key={b.reason}>
                      {b.reason}{' '}
                      <span className="muted">
                        Blocks: {choices(b.choices)}.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {canConfirm && options.length > 0 && (
        <form
          className="gate-batch"
          aria-labelledby="gate-batch-title"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <h4 id="gate-batch-title">
            Confirm ethics and access for the options I choose
          </h4>
          <p className="small">
            Give one reason per gate, read each option’s concerns, and tick the
            options you confirm. To give one option a different reason, open
            “Its own reason” under it. Options ticked for you are the ones this
            lets advance.
          </p>
          {needed.map((k) => (
            <div key={k}>
              <label htmlFor={`shared-${k}`}>
                Why is {k} fine for the ticked options? (shared reason)
              </label>
              <input
                id={`shared-${k}`}
                maxLength={300}
                value={shared[k] ?? ''}
                onChange={(e) =>
                  setShared((m) => ({ ...m, [k]: e.target.value }))
                }
              />
            </div>
          ))}
          <ul className="gate-batch-options">
            {options.map((o) => {
              const id = o.cand.alternative.id;
              const on = ticked.has(id);
              return (
                <li key={id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setTicked((t) => toggle(t, id, e.target.checked))
                      }
                    />
                    <span>
                      <strong>{clip(o.cand.alternative.title, 100)}</strong>
                      <small>
                        {' '}
                        · {o.gates.map((g) => GATE[g.gate]).join(' and ')}
                        {batchNote(o) && ` · ${batchNote(o)}`}
                      </small>
                    </span>
                  </label>
                  {o.gates.some((g) => g.concerns.length > 0) && (
                    <ul className="small">
                      {o.gates.flatMap((g) =>
                        g.concerns.map((x) => (
                          <li key={`${g.gate}-${x.scorecard}`}>
                            {GATE[g.gate]} concern from{' '}
                            {x.by === 'system'
                              ? 'the automatic assessment'
                              : x.reviewer}
                            : {clip(x.note, 240)}
                          </li>
                        )),
                      )}
                    </ul>
                  )}
                  {on && (
                    <button
                      type="button"
                      className="text"
                      aria-expanded={ownOpen.has(id)}
                      onClick={() => {
                        const opening = !ownOpen.has(id);
                        setOwnOpen((s) => toggle(s, id, opening));
                        if (!opening)
                          setOwn((m) => ({ ...m, [id]: undefined }));
                      }}
                    >
                      {ownOpen.has(id)
                        ? 'Use the shared reasons'
                        : 'Its own reason'}
                    </button>
                  )}
                  {on && ownOpen.has(id) && (
                    <div className="own-reasons">
                      {o.gates.map((g) => (
                        <div key={g.gate}>
                          <label htmlFor={`own-${id}-${g.gate}`}>
                            Own {g.gate} reason for this option (empty uses the
                            shared one)
                          </label>
                          <input
                            id={`own-${id}-${g.gate}`}
                            maxLength={300}
                            value={own[id]?.[g.gate] ?? ''}
                            onChange={(e) =>
                              setOwn((m) => ({
                                ...m,
                                [id]: { ...m[id], [g.gate]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="small" role="status">
            {'request' in built
              ? `What will happen: ${batchSummary(built.request)}`
              : built.missing}
          </p>
          <div className="actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !('request' in built)}
            >
              {busy
                ? 'Saving…'
                : 'request' in built
                  ? `Confirm ${built.request.items.length} gate${built.request.items.length === 1 ? '' : 's'}`
                  : 'Confirm'}
            </button>
          </div>
        </form>
      )}
      <div aria-live="polite">
        {done && <p className="notice ok">{done}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
