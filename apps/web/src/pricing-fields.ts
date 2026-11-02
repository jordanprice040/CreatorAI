// Fields for adding documented pricing and recording a charge on Monitor › Budgets (audit
// item 4, piece 5). No imports, so the tests can load it without a browser and check its
// output against PricingSnapshotBodySchema, ReconcileRequestSchema and the domain's
// usageCost. The server parses every body again and works out the charge itself.

type Ratio = { numerator: number; denominator: number };
export type PricingBodyShape = {
  provider: string;
  model_id: string;
  basis: string;
  source_url: string | null;
  retrieved_at: string;
  rates: {
    input: string;
    cached_input: string;
    cache_write: string;
    output: string;
  };
  long_context: {
    above_input_tokens: number;
    input_multiplier: Ratio;
    output_multiplier: Ratio;
  } | null;
  tool_call_rates: Record<string, string>;
};

/** The same price from the same dated source: adding it again would only duplicate it. */
export function samePricing(a: PricingBodyShape, b: PricingBodyShape) {
  return (
    a.provider === b.provider &&
    a.model_id === b.model_id &&
    a.basis === b.basis &&
    a.source_url === b.source_url &&
    a.retrieved_at === b.retrieved_at &&
    sameValue(a.rates, b.rates) &&
    sameValue(a.long_context, b.long_context)
  );
}

/** Deep equality that ignores key order (review of PR #116, N-1). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) =>
      sameValue(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  );
}

/** "2x" or "1.5x" for a price multiplier. */
export function times(r: Ratio): string {
  return `${Number((r.numerator / r.denominator).toFixed(4))}x`;
}

/** The long-context surcharge in words, or '' when the price has none (review L-3). */
export function longContextText(lc: PricingBodyShape['long_context']): string {
  if (!lc) return '';
  return `Above ${lc.above_input_tokens.toLocaleString('en-US')} input tokens the whole request costs ${times(lc.input_multiplier)} for input and cache, ${times(lc.output_multiplier)} for output.`;
}

/** Evidence for "Confirm no charge": where the owner checked (review L-2). */
export function noChargeEvidence(
  where: string,
): { evidence: string } | { error: string } {
  const w = where.trim();
  if (!w) return { error: 'Say where you checked that there was no charge.' };
  // The stored note is capped at 1200 characters, prefix included.
  if (w.length > 1150)
    return { error: 'Keep where you checked to at most 1150 characters.' };
  return { evidence: `Owner checked for a charge and found none: ${w}` };
}

/** Exact dollars per million tokens from nano-USD per token (that is, nano / 1000). */
export function perMillion(nanoPerToken: string): string {
  const n = BigInt(nanoPerToken);
  const frac = (n % 1000n).toString().padStart(3, '0').replace(/0$/, '');
  return `$${n / 1000n}.${frac}`;
}

export type ChargeDraft = {
  uncached_input: string;
  cached_input: string;
  cache_write: string;
  output: string;
  reasoning: string;
  response_id: string;
  evidence: string;
};
export type ChargeBody = {
  outcome: 'charged';
  usage: {
    uncached_input_tokens: number;
    cached_input_tokens: number;
    cache_write_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    tool_calls: Record<string, number>;
  };
  provider_response_id: string | null;
  evidence: string;
};
export const emptyCharge = (): ChargeDraft => ({
  uncached_input: '',
  cached_input: '',
  cache_write: '',
  output: '',
  reasoning: '',
  response_id: '',
  evidence: '',
});

const NOTE = 1200;

/**
 * The charge to record, or the fields to fix. Every token count is typed by the owner from
 * the provider's own records; nothing is filled in. Empty counts other than input and
 * output mean zero.
 */
export function chargeToBody(
  d: ChargeDraft,
):
  | { body: ChargeBody; errors: null }
  | { body: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const count = (key: keyof ChargeDraft, required: boolean) => {
    const t = d[key].trim().replaceAll(',', '');
    if (!t) {
      if (required) errors[key] = 'Type the number, 0 if none.';
      return 0;
    }
    if (!/^\d{1,15}$/.test(t)) {
      errors[key] = 'A whole number of tokens.';
      return 0;
    }
    const v = Number(t);
    if (!Number.isSafeInteger(v)) errors[key] = 'That number is too large.';
    return v;
  };
  const usage = {
    uncached_input_tokens: count('uncached_input', true),
    cached_input_tokens: count('cached_input', false),
    cache_write_tokens: count('cache_write', false),
    output_tokens: count('output', true),
    reasoning_tokens: count('reasoning', false),
    tool_calls: {},
  };
  if (usage.reasoning_tokens > usage.output_tokens && !errors.reasoning)
    errors.reasoning = 'Reasoning tokens are part of output, so not more.';
  if (
    !Object.keys(errors).length &&
    usage.uncached_input_tokens +
      usage.cached_input_tokens +
      usage.cache_write_tokens +
      usage.output_tokens ===
      0
  )
    errors.output =
      'Every count is 0. If nothing was charged, use Confirm no charge.';
  const id = d.response_id.trim();
  if (id.length > 200) errors.response_id = 'Keep it under 200 characters.';
  const evidence = d.evidence.trim();
  if (!evidence)
    errors.evidence = 'Say where you found it, such as the usage export row.';
  else if (evidence.length > NOTE)
    errors.evidence = `Keep it under ${NOTE} characters (now ${evidence.length}).`;
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    body: {
      outcome: 'charged',
      usage,
      provider_response_id: id || null,
      evidence,
    },
    errors: null,
  };
}

const ceil = (v: bigint, r: Ratio | null) =>
  r === null
    ? v
    : (v * BigInt(r.numerator) + BigInt(r.denominator) - 1n) /
      BigInt(r.denominator);

/**
 * What the studio will charge, in nano-USD, for this usage on this pricing. Mirrors
 * usageCost in packages/domain/src/budget.ts (checked by a test); the server's figure is the
 * one recorded.
 */
export function chargePreview(p: PricingBodyShape, u: ChargeBody['usage']) {
  const input =
    u.uncached_input_tokens + u.cached_input_tokens + u.cache_write_tokens;
  const lc = p.long_context;
  const long = lc !== null && input > lc.above_input_tokens;
  return (
    ceil(
      BigInt(u.uncached_input_tokens) * BigInt(p.rates.input) +
        BigInt(u.cached_input_tokens) * BigInt(p.rates.cached_input) +
        BigInt(u.cache_write_tokens) * BigInt(p.rates.cache_write),
      long ? lc.input_multiplier : null,
    ) +
    ceil(
      BigInt(u.output_tokens) * BigInt(p.rates.output),
      long ? lc.output_multiplier : null,
    )
  ).toString();
}
