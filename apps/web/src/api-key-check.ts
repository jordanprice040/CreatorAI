// P22: the "Test connection" check for the metered OpenAI API-key route on Models and
// connections. It sends one fixed, tiny request through the model broker under its own run,
// one model.generate grant and a small run budget drawn from an existing funded budget, so
// the owner's $20 runtime ceiling, spend limits and admission all apply exactly as for any
// paid call. This module has no imports so the tests load it directly.

export const CHECK_RUN_TITLE = 'API key connection check';
export const CHECK_PROMPT = 'Reply with exactly: ok';
/**
 * Room for a reasoning model to think briefly and still answer. At the documented
 * gpt-6-astra price ($50 per 1M output tokens) this bounds the output at $0.0128.
 */
export const CHECK_MAX_OUTPUT_TOKENS = 256;
/** The run budget the check draws: $0.05, well above the call's maximum exposure. */
export const CHECK_BUDGET_NANO = '50000000';
export const CHECK_TIMEOUT_MS = 60_000;
/** The grant ends soon after the one call; it is also revoked once the check finishes. */
export const CHECK_GRANT_MINUTES = 30;

type PricingLike = {
  id: string;
  created_at: string;
  body: { provider: string; model_id: string; basis: string };
};
type EnvelopeLike = {
  id: string;
  kind: string;
  status: string;
  run_id: string | null;
  available: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};
type Attempt = {
  provider: string;
  model_id: string;
  status: string;
  reserved: string;
  incurred: string | null;
  usage: { uncached_input_tokens: number; output_tokens: number } | null;
};
type ResultLike = {
  status: string;
  reason_code: string;
  explanation: string;
  attempts: Attempt[];
  output: { text: string } | null;
};

const newest = <T extends { created_at: string }>(xs: T[]) =>
  [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

/** The newest documented price for the model the API process is configured with. */
export function pickPricing<T extends PricingLike>(
  pricing: T[],
  modelId: string | null,
): T | null {
  if (!modelId) return null;
  return newest(
    pricing.filter(
      (p) =>
        p.body.provider === 'openai' &&
        p.body.model_id === modelId &&
        p.body.basis === 'documented',
    ),
  );
}

/**
 * An active budget not tied to a run that can lend the check's run budget: a global budget,
 * or a period budget whose window is open now. The newest one wins.
 */
export function pickFunding<T extends EnvelopeLike>(
  envelopes: T[],
  now: number,
  need: string = CHECK_BUDGET_NANO,
): T | null {
  return newest(
    envelopes.filter(
      (e) =>
        e.status === 'active' &&
        e.run_id === null &&
        (e.kind === 'global' ||
          (e.kind === 'period' &&
            e.starts_at !== null &&
            e.ends_at !== null &&
            Date.parse(e.starts_at) <= now &&
            now < Date.parse(e.ends_at))) &&
        BigInt(e.available) >= BigInt(need),
    ),
  );
}

/** Why the check cannot run yet, in the order the owner would fix them. Empty means ready. */
export function checkBlockers(s: {
  owner: boolean;
  fixture: boolean;
  live: 'not_configured' | 'configured_unverified';
  modelId: string | null;
  pricing: PricingLike | null;
  funding: EnvelopeLike | null;
}): string[] {
  if (!s.owner) return ['Only the workspace owner can run this check.'];
  if (s.fixture)
    return [
      'This is a fixture workspace: the API key route is never called from one. Open a real workspace.',
    ];
  if (s.live === 'not_configured')
    return [
      'The API process has no OpenAI key. Start the studio with CREATOR_LIVE_PROVIDER=openai and OPENAI_API_KEY set in that window (docs/LIVE_CONNECTION_CHECKS.md).',
    ];
  const out: string[] = [];
  if (!s.pricing)
    out.push(
      `No documented price for ${s.modelId ?? 'the configured model'} in this workspace yet. Add it below or on Monitor › Budgets.`,
    );
  if (!s.funding)
    out.push(
      'No active budget has $0.05 available to lend the check. Fund one on Monitor › Budgets (it still counts inside your overall ceiling).',
    );
  return out;
}

/** The one broker request the check sends. */
export function checkRequest(
  envelopeId: string,
  pricingId: string,
  operationId: string,
) {
  return {
    envelope_id: envelopeId,
    action_type: 'model.generate' as const,
    task_id: null,
    logical_operation_id: operationId,
    pricing_snapshot_id: pricingId,
    data_class: 'synthetic' as const,
    input: [{ role: 'user' as const, text: CHECK_PROMPT }],
    max_output_tokens: CHECK_MAX_OUTPUT_TOKENS,
    output_format: 'text' as const,
    tool: null,
    max_attempts: 1,
    timeout_ms: CHECK_TIMEOUT_MS,
    justification:
      'Owner connection check of the OpenAI API key route from Models and connections.',
  };
}

/** The grant for the check's run: model.generate only, synthetic data, the run budget's cap. */
export function checkGrant(runId: string, now: number) {
  return {
    run_id: runId,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: CHECK_BUDGET_NANO,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(now + CHECK_GRANT_MINUTES * 60_000).toISOString(),
    rationale:
      'One connection check of the OpenAI API key route, approved on Models and connections.',
  };
}

const sum = (xs: (string | null)[]) =>
  xs.reduce((a, x) => a + BigInt(x ?? '0'), 0n).toString();

export type CheckOutcome = {
  /** connected: the provider answered; refused: it answered with an error; not_sent: the
   * studio stopped it first; unknown: no usable answer, so it may have been charged. */
  kind: 'connected' | 'refused' | 'not_sent' | 'unknown';
  headline: string;
  model: string | null;
  incurred: string;
  reserved: string;
  reply: string | null;
};

/** A plain reading of the broker's result. Nothing here is a verification by itself. */
export function describeResult(r: ResultLike): CheckOutcome {
  const sent = r.attempts.filter((a) => a.status !== 'denied');
  const last = r.attempts.at(-1) ?? null;
  const model = last ? `${last.provider}/${last.model_id}` : null;
  const incurred = sum(sent.map((a) => a.incurred));
  const reserved = sum(sent.map((a) => a.reserved));
  const reply = r.output ? r.output.text : null;
  const base = { model, incurred, reserved, reply };
  if (r.status === 'succeeded') {
    const text = (reply ?? '').trim();
    const exact = /^ok[.!]?$/i.test(text);
    return {
      ...base,
      kind: 'connected',
      headline: exact
        ? `Connected: ${model ?? 'the model'} answered “ok”.`
        : text
          ? `Connected: ${model ?? 'the model'} answered, though not with exactly “ok”.`
          : `Connected: ${model ?? 'the model'} answered with no text (its output limit may have gone to reasoning).`,
    };
  }
  if (r.status === 'denied' || r.status === 'needs_human')
    return {
      ...base,
      kind: 'not_sent',
      headline: `Not sent (${r.reason_code}): ${r.explanation}`,
    };
  if (r.status === 'failed')
    return {
      ...base,
      kind: 'refused',
      headline: `The provider refused the call (${r.reason_code}): ${r.explanation}`,
    };
  return {
    ...base,
    kind: 'unknown',
    headline: `Outcome unknown (${r.reason_code}): ${r.explanation} It may have been charged; reconcile it on Monitor › Budgets before any other paid call.`,
  };
}

type ReservationLike = Attempt & {
  id: string;
  run_id: string;
  reason_code: string;
  fixture: boolean;
  created_at: string;
};
/** Earlier checks, newest first: real reservations made under a check's own run. */
export function recentChecks<T extends ReservationLike>(
  reservations: T[],
  names: ReadonlyMap<string, string>,
  max = 5,
): T[] {
  return reservations
    .filter(
      (r) =>
        !r.fixture && (names.get(r.run_id) ?? '').startsWith(CHECK_RUN_TITLE),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, max);
}
