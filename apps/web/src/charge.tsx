import { useState, type FormEvent } from 'react';
import {
  ReservationSchema,
  type PricingSnapshot,
  type Reservation,
  type SessionInfo,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { money } from './budgets.js';
import {
  chargePreview,
  chargeToBody,
  emptyCharge,
  type ChargeDraft,
} from './pricing-fields.js';

const COUNTS: { key: keyof ChargeDraft; label: string; hint?: string }[] = [
  { key: 'uncached_input', label: 'Input tokens (not cached)' },
  { key: 'cached_input', label: 'Cached input tokens', hint: 'blank = 0' },
  { key: 'cache_write', label: 'Cache-write tokens', hint: 'blank = 0' },
  { key: 'output', label: 'Output tokens' },
  {
    key: 'reasoning',
    label: 'Of which reasoning',
    hint: 'blank = 0; not priced separately',
  },
];

/**
 * "Record a charge" for a call whose outcome is unknown: the owner types the usage from the
 * provider's own records (usage export or dashboard) and the studio settles the call at its
 * pricing snapshot. Posts to the existing reservations/{id}/reconcile route; only the owner
 * can, and only once.
 */
export function RecordCharge({
  base,
  session,
  reservation: r,
  pricing,
  done,
  cancel,
}: {
  base: string;
  session: SessionInfo;
  reservation: Reservation;
  /** The call's own pricing snapshot, when it is in the workspace list. */
  pricing: PricingSnapshot | undefined;
  done: () => void;
  cancel: () => void;
}) {
  const [d, setD] = useState<ChargeDraft>(emptyCharge);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const out = chargeToBody(d);
  const preview =
    out.body && pricing ? chargePreview(pricing.body, out.body.usage) : null;
  const over = preview !== null && BigInt(preview) > BigInt(r.reserved);
  const id = (k: string) => `rc-${r.id}-${k}`;
  /** Edits a field and clears its error, so a fixed field stops showing one. */
  const edit = (k: keyof ChargeDraft, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => {
      const { [k]: _, ...rest } = x;
      return rest;
    });
  };
  const aria = (k: string) =>
    errors[k]
      ? { 'aria-invalid': true, 'aria-describedby': `${id(k)}-error` }
      : {};
  const err = (k: string) =>
    errors[k] ? (
      <span id={`${id(k)}-error`} className="error">
        {errors[k]}
      </span>
    ) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const o = chargeToBody(d);
    if (!o.body) {
      setErrors(o.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(ReservationSchema, `${base}/reservations/${r.id}/reconcile`, {
        csrf: session.csrf_token,
        body: o.body,
      });
      done();
    } catch (x) {
      setError(message(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="charge-form"
      onSubmit={(e) => void submit(e)}
      aria-label="Record a charge"
    >
      <p className="small">
        Copy the usage for this call from {r.provider}'s own records (usage
        export or dashboard). The studio works out the charge from the call's
        pricing and settles it; this can't be undone.
      </p>
      <div className="charge-grid">
        {COUNTS.map((c) => (
          <div key={c.key}>
            <label htmlFor={id(c.key)}>
              {c.label}
              {c.hint && <small> ({c.hint})</small>}
            </label>
            <input
              id={id(c.key)}
              inputMode="numeric"
              value={d[c.key]}
              {...aria(c.key)}
              onChange={(e) => edit(c.key, e.target.value)}
            />
            {err(c.key)}
          </div>
        ))}
      </div>
      <label htmlFor={id('response_id')}>
        Provider response id <small>(optional)</small>
      </label>
      <input
        id={id('response_id')}
        value={d.response_id}
        {...aria('response_id')}
        onChange={(e) => edit('response_id', e.target.value)}
      />
      {err('response_id')}
      <label htmlFor={id('evidence')}>Where you found it</label>
      <textarea
        id={id('evidence')}
        rows={2}
        value={d.evidence}
        {...aria('evidence')}
        onChange={(e) => edit('evidence', e.target.value)}
      />
      {err('evidence')}
      {preview !== null && (
        <p className={over ? 'notice' : 'small'} role="status">
          The studio will charge about {money(preview, r.fixture)} (
          {money(r.reserved, r.fixture)} was held).
          {over &&
            ' That is more than was held: check the numbers; if they are right, the budget may go over its cap.'}
        </p>
      )}
      {out.body && !pricing && (
        <p className="small" role="status">
          This call's pricing isn't in the list here, so there is no preview;
          the studio still works out the charge.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Record this charge
        </button>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
