import { useEffect, useState, type FormEvent } from 'react';
import { Money } from './money.js';
import {
  SpendLimitsViewSchema,
  type SessionInfo,
  type SpendLimits,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { usePageActive } from './page-drafts.js';
import { money } from './budgets.js';
import { usdToNano } from './amounts.js';
import { Status, useLoad } from './ui.js';
import { Explain, useSectionState } from './explain.js';

type Provider = SpendLimits['per_model'][number]['provider'];
const PROVIDERS: Provider[] = ['openai', 'brave'];
const label = (provider: string, model: string) => `${provider}/${model}`;
const dollars = (nano: string | null) =>
  nano === null ? 'no limit' : money(nano, false);

/**
 * One line per difference between two limit sets, in plain words, plus whether any of them
 * allows more spending (a new limit only narrows; removing or raising one widens).
 */
export function limitChanges(
  before: SpendLimits,
  after: SpendLimits,
): { lines: string[]; widens: boolean } {
  const lines: string[] = [];
  let widens = false;
  const step = (name: string, from: string | null, to: string | null) => {
    if (from === to) return;
    lines.push(`${name}: ${dollars(from)} → ${dollars(to)}`);
    if (to === null || (from !== null && BigInt(to) > BigInt(from)))
      widens = true;
  };
  step('Per run', before.per_run_nano_usd, after.per_run_nano_usd);
  const keys = new Set(
    [...before.per_model, ...after.per_model].map((m) =>
      label(m.provider, m.model_id),
    ),
  );
  for (const key of Array.from(keys).sort()) {
    const find = (s: SpendLimits) =>
      s.per_model.find((m) => label(m.provider, m.model_id) === key)
        ?.limit_nano_usd ?? null;
    step(key, find(before), find(after));
  }
  return { lines, widens };
}

interface Draft {
  perRun: string;
  models: { provider: Provider; model_id: string; amount: string }[];
}
const nanoToText = (nano: string | null) =>
  nano === null ? '' : money(nano, false).slice(1);

/**
 * Optional per-run and per-model limits under the overall ceiling (ADR-0044). None are set
 * until the owner sets them. The server enforces them on every real paid call; this page
 * only shows them and records the owner's changes.
 */
export function SpendingLimits({ session }: { session: SessionInfo }) {
  const data = useLoad(
    () => api(SpendLimitsViewSchema, 'settings/spending-limits'),
    [],
  );
  const v = data.data;
  // Review 1 of #255, M-2: the closed fold in Standard says whether any limit is set.
  useSectionState(
    v
      ? v.limits.per_run_nano_usd === null && v.limits.per_model.length === 0
        ? 'No limits set'
        : [
            v.limits.per_run_nano_usd !== null
              ? `Per run ${dollars(v.limits.per_run_nano_usd)}`
              : '',
            v.limits.per_model.length > 0
              ? `${v.limits.per_model.length} model limit${v.limits.per_model.length === 1 ? '' : 's'}`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
      : null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  /** The version and limits the person reviewed; reloads pause while it is open. */
  const [snap, setSnap] = useState<{
    version: number;
    limits: SpendLimits;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = usePageActive();
  useEffect(() => {
    if (active && !draft) data.reload();
  }, [active]);
  useEffect(() => {
    if (!active || draft) return;
    const on = () => data.reload();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [active, draft]);

  function edit() {
    if (!v) return;
    setError('');
    setNotice('');
    setReason('');
    setDraft({
      perRun: nanoToText(v.limits.per_run_nano_usd),
      models: v.models.map((m) => ({
        provider: m.provider,
        model_id: m.model_id,
        amount: nanoToText(m.limit_nano_usd),
      })),
    });
  }

  // The draft as limits, or the first problem with it. Blank means no limit.
  let proposed: SpendLimits | null = null;
  let problem = '';
  let need = '';
  let unmatched: string[] = [];
  if (draft && v) {
    const ceiling = BigInt(v.ceiling_nano_usd);
    const parse = (name: string, text: string) => {
      if (!text.trim()) return null;
      const nano = usdToNano(text);
      if (nano === null) {
        problem ||= `${name}: enter an amount like 5 or 2.50, or leave it blank for no limit.`;
        return null;
      }
      if (BigInt(nano) > ceiling)
        problem ||= `${name} is above the overall ceiling of ${money(v.ceiling_nano_usd, false)}. Lower it to that or less, or raise the ceiling first.`;
      return nano;
    };
    const perRun = parse('Per run', draft.perRun);
    const perModel: SpendLimits['per_model'] = [];
    const seen = new Set<string>();
    for (const m of draft.models) {
      const id = m.model_id.trim();
      if (!id && !m.amount.trim()) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
        problem ||= `Model "${id}": use the provider's model id, like gpt-6-astra.`;
        continue;
      }
      const key = label(m.provider, id);
      if (seen.has(key)) problem ||= `${key} is listed twice.`;
      seen.add(key);
      const nano = parse(key, m.amount);
      if (nano !== null)
        perModel.push({
          provider: m.provider,
          model_id: id,
          limit_nano_usd: nano,
        });
    }
    proposed = { per_run_nano_usd: perRun, per_model: perModel };
    if (!problem && !reason.trim()) need = 'Add a reason to review the change.';
    // A limit only applies to calls with exactly this provider and model id.
    unmatched = perModel
      .map((m) => label(m.provider, m.model_id))
      .filter(
        (key) =>
          !v.models.some(
            (m) => m.known && label(m.provider, m.model_id) === key,
          ),
      );
  }
  const diff =
    v && proposed ? limitChanges(snap?.limits ?? v.limits, proposed) : null;

  function review(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (v && diff?.lines.length && !problem && reason.trim())
      setSnap({ version: v.version, limits: v.limits });
  }
  async function confirm() {
    if (!snap || !proposed) return;
    setBusy(true);
    setError('');
    try {
      await api(SpendLimitsViewSchema, 'settings/spending-limits', {
        csrf: session.csrf_token,
        body: {
          expected_version: snap.version,
          limits: proposed,
          reason: reason.trim(),
        },
      });
      setNotice('Limits saved. They apply to the next paid call.');
      setDraft(null);
      setSnap(null);
      setReason('');
      data.reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        data.reload();
        setError(
          'The limits changed elsewhere while you were deciding. Your edits are kept and the changes listed are now against the latest limits; review them again, or cancel to see the latest.',
        );
      } else setError(message(err));
      setSnap(null);
    } finally {
      setBusy(false);
    }
  }
  const setModel = (i: number, patch: Partial<Draft['models'][number]>) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)),
        },
    );
  const reviewing = snap !== null;
  const aboveCeiling = (nano: string) =>
    v !== null && BigInt(nano) > BigInt(v.ceiling_nano_usd);

  return (
    <>
      <h3>Per-run and per-model limits</h3>
      <Explain short="Optional limits per run and per model." className="">
        Optional limits under the overall ceiling. None are set until you set
        them; until then the overall ceiling is the only limit. A real paid call
        is refused if it would take one run, or one model across every
        workspace, past its limit. The overall ceiling always applies as well,
        and no limit can be set above it. They count the same real calls since{' '}
        {v ? when(v.counted_since) : 'the ceiling started'}; fixture work and
        ChatGPT-plan use are not money and are not counted.
      </Explain>
      <Status
        loading={data.loading && !v}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      >
        {v && !draft && (
          <>
            <dl className="facts ceiling">
              <dt>Per run</dt>
              <dd>
                {v.limits.per_run_nano_usd === null ? (
                  <>
                    No limit <small>the overall ceiling applies</small>
                  </>
                ) : (
                  <>
                    <strong>{money(v.limits.per_run_nano_usd, false)}</strong>
                    {aboveCeiling(v.limits.per_run_nano_usd) && (
                      <small> above the ceiling, so the ceiling applies</small>
                    )}
                  </>
                )}
                {v.top_runs[0] && (
                  <small>
                    {' '}
                    · highest run so far{' '}
                    <Money
                      nano={v.top_runs[0].exposure_nano_usd}
                      fixture={false}
                    />
                  </small>
                )}
              </dd>
            </dl>
            {v.models.length === 0 ? (
              <p className="small">
                No real model has pricing or spending yet. You can still add a
                limit for one.
              </p>
            ) : (
              <table className="tests limits">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Limit</th>
                    <th scope="col">Used or held</th>
                  </tr>
                </thead>
                <tbody>
                  {v.models.map((m) => (
                    <tr key={label(m.provider, m.model_id)}>
                      <td>
                        {label(m.provider, m.model_id)}
                        {!m.known && (
                          <small>
                            {' '}
                            no pricing or calls use this id yet; check the
                            spelling
                          </small>
                        )}
                      </td>
                      <td>
                        {m.limit_nano_usd === null ? (
                          <small>no limit</small>
                        ) : (
                          <>
                            {money(m.limit_nano_usd, false)}
                            {aboveCeiling(m.limit_nano_usd) && (
                              <small>
                                {' '}
                                above the ceiling, so the ceiling applies
                              </small>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        <Money nano={m.exposure_nano_usd} fixture={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {v.recent_refusals.length > 0 && (
              <details className="refusals">
                <summary>
                  Latest calls refused by the ceiling or a limit (
                  {v.recent_refusals.length})
                </summary>
                <ul className="small">
                  {v.recent_refusals.map((r) => (
                    <li key={r.reservation_id}>
                      {when(r.created_at)} ·{' '}
                      {r.provider && r.model_id
                        ? `${label(r.provider, r.model_id)} · `
                        : ''}
                      {r.explanation}{' '}
                      <small>
                        {r.workspace_name}
                        {r.study_attempt_id
                          ? ' · final study attempt'
                          : ` · run ${r.run_id.slice(0, 8)}`}
                      </small>
                    </li>
                  ))}
                </ul>
                <p className="small">
                  The person whose run was refused sees only that it is waiting
                  on the studio spending limit, without these amounts.
                </p>
              </details>
            )}
            <div className="actions">
              <button className="secondary" type="button" onClick={edit}>
                Change limits
              </button>
            </div>
          </>
        )}
        {v && draft && (
          <form className="ceiling-form" onSubmit={review}>
            <label htmlFor="limit-run">Per run (US dollars)</label>
            <input
              id="limit-run"
              inputMode="decimal"
              placeholder="No limit"
              value={draft.perRun}
              disabled={reviewing}
              onChange={(e) => setDraft({ ...draft, perRun: e.target.value })}
            />
            <fieldset className="limits" disabled={reviewing}>
              <legend>Per model (US dollars, blank for no limit)</legend>
              {draft.models.map((m, i) => (
                <div className="limit-row" key={i}>
                  <select
                    aria-label="Provider"
                    value={m.provider}
                    onChange={(e) =>
                      setModel(i, { provider: e.target.value as Provider })
                    }
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    aria-label="Model id"
                    placeholder="gpt-6-astra"
                    value={m.model_id}
                    onChange={(e) => setModel(i, { model_id: e.target.value })}
                  />
                  <input
                    aria-label={`Limit for ${m.model_id || 'this model'}`}
                    inputMode="decimal"
                    placeholder="No limit"
                    value={m.amount}
                    onChange={(e) => setModel(i, { amount: e.target.value })}
                  />
                  <button
                    className="text"
                    type="button"
                    aria-label={`Remove ${m.model_id || 'this model'}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        models: draft.models.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="text"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    models: [
                      ...draft.models,
                      { provider: 'openai', model_id: '', amount: '' },
                    ],
                  })
                }
              >
                Add a model
              </button>
            </fieldset>
            {problem && <p className="error">{problem}</p>}
            {!problem && diff && diff.lines.length === 0 && (
              <p className="small">No changes yet.</p>
            )}
            {unmatched.length > 0 && (
              <p className="small">
                No pricing or spending is recorded yet for{' '}
                {unmatched.join(', ')}. A limit applies only to calls with
                exactly that provider and model id, so check the spelling.
              </p>
            )}
            <label htmlFor="limits-reason">Why</label>
            <textarea
              id="limits-reason"
              rows={2}
              maxLength={1200}
              value={reason}
              disabled={reviewing}
              onChange={(e) => setReason(e.target.value)}
            />
            {!reviewing ? (
              <div className="actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  className="secondary strong"
                  type="submit"
                  disabled={!!problem || !diff?.lines.length || !reason.trim()}
                >
                  Review changes
                </button>
                {need && diff?.lines.length ? <small> {need}</small> : null}
              </div>
            ) : (
              <div className="notice" role="group" aria-label="Confirm">
                <ul className="rows">
                  {diff!.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p>
                  {diff!.widens
                    ? 'This allows more real money to be spent by a run or a model, still within the overall ceiling.'
                    : 'This only narrows what may be spent.'}{' '}
                  The change and your reason are recorded.
                </p>
                <div className="actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setSnap(null)}
                  >
                    Back
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void confirm()}
                  >
                    {busy ? 'Saving…' : 'Save limits'}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
        <div aria-live="polite">
          {notice && <p className="notice ok">{notice}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        {v && v.history.length > 0 && (
          <>
            <h4>Limit changes</h4>
            <ol className="rows">
              {v.history.map((h) => (
                <li key={h.version}>
                  v{h.version} ·{' '}
                  {limitChanges(h.previous, h.limits).lines.join('; ') ||
                    'no difference'}
                  <small>
                    {' '}
                    · {when(h.created_at)} · {h.reason}
                  </small>
                </li>
              ))}
            </ol>
          </>
        )}
      </Status>
    </>
  );
}
