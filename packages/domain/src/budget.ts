import {
  ContractError,
  type BrokerCallRequest,
  type Exposure,
  type PricingSnapshotBody,
  type Usage,
} from '@creator/contracts';

// Pure money arithmetic for the broker. BigInt only; ratios round up so an estimate or a
// charge is never understated by rounding.
const big = (v: string | number) => BigInt(v);
function ceilRatio(
  amount: bigint,
  r: { numerator: number; denominator: number } | null,
) {
  if (!r) return amount;
  const n = amount * big(r.numerator);
  const d = big(r.denominator);
  return (n + d - 1n) / d;
}
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Framing allowance per message and per request, on top of the byte bound. */
const MESSAGE_OVERHEAD_TOKENS = 32;
const REQUEST_OVERHEAD_TOKENS = 64;

/**
 * Upper bound of input tokens for UTF-8 text. Byte-level BPE tokenizers emit at least one
 * byte per token, so text tokens ≤ bytes; framing gets a fixed allowance. Text only: image
 * or file inputs would need their own bound and are not accepted by the broker.
 */
export function maxInputTokens(input: BrokerCallRequest['input']): number {
  return input.reduce(
    (n, m) => n + Buffer.byteLength(m.text, 'utf8') + MESSAGE_OVERHEAD_TOKENS,
    REQUEST_OVERHEAD_TOKENS,
  );
}

const missing = (m: string) => new ContractError('PRICING_MISSING', m);

/**
 * Maximum exposure of one attempt under a pricing snapshot. Input is priced at the highest
 * input rate (a cache write can cost more than plain input) and the long-context surcharge
 * applies whenever the bound could cross it. Throws instead of returning zero for anything
 * the snapshot does not price.
 */
export function maxExposure(
  pricing: PricingSnapshotBody,
  req: BrokerCallRequest,
): Exposure {
  if (!pricing.supported_actions.includes(req.action_type))
    throw missing(
      `Pricing for ${pricing.model_id} does not cover ${req.action_type}.`,
    );
  const tools: Record<string, number> = {};
  let toolCost = 0n;
  if (req.tool !== null) {
    const rate = pricing.tool_call_rates[req.tool];
    if (rate === undefined)
      throw missing(`No configured price for tool ${req.tool}.`);
    tools[req.tool] = 1;
    toolCost = big(rate);
  }
  const isModel = req.action_type !== 'tool.search_public';
  const inTokens = isModel ? maxInputTokens(req.input) : 0;
  const outTokens =
    req.action_type.startsWith('model.') && req.action_type !== 'model.embed'
      ? req.max_output_tokens
      : 0;
  if (outTokens > pricing.max_output_tokens)
    throw new ContractError(
      'LIMIT_EXCEEDED',
      `max_output_tokens exceeds the model's ${pricing.max_output_tokens}.`,
    );
  if (inTokens + outTokens > pricing.context_window_tokens)
    throw new ContractError(
      'LIMIT_EXCEEDED',
      'Request bound exceeds the model context window.',
    );
  const lc = pricing.long_context;
  const long = lc !== null && inTokens > lc.above_input_tokens;
  const r = pricing.rates;
  const inRate = max(
    max(big(r.input), big(r.cache_write)),
    big(r.cached_input),
  );
  const amount =
    ceilRatio(big(inTokens) * inRate, long ? lc.input_multiplier : null) +
    ceilRatio(
      big(outTokens) * big(r.output),
      long ? lc.output_multiplier : null,
    ) +
    toolCost;
  return {
    max_input_tokens: inTokens,
    max_output_tokens: outTokens,
    max_tool_calls: tools,
    long_context: long,
    amount: amount.toString(),
    method: 'utf8_bytes_upper_bound/1',
  };
}

/** Authoritative charge for reported usage. Unpriced categories throw; they are not free. */
export function usageCost(pricing: PricingSnapshotBody, usage: Usage): string {
  const r = pricing.rates;
  const input =
    usage.uncached_input_tokens +
    usage.cached_input_tokens +
    usage.cache_write_tokens;
  if (usage.reasoning_tokens > usage.output_tokens)
    throw new ContractError(
      'INVALID_CONTRACT',
      'Reasoning tokens must be a subset of output tokens.',
    );
  const lc = pricing.long_context;
  const long = lc !== null && input > lc.above_input_tokens;
  let tools = 0n;
  for (const [name, count] of Object.entries(usage.tool_calls)) {
    if (count === 0) continue;
    const rate = pricing.tool_call_rates[name];
    if (rate === undefined)
      throw missing(`Usage reports unpriced tool ${name}.`);
    tools += big(rate) * big(count);
  }
  return (
    ceilRatio(
      big(usage.uncached_input_tokens) * big(r.input) +
        big(usage.cached_input_tokens) * big(r.cached_input) +
        big(usage.cache_write_tokens) * big(r.cache_write),
      long ? lc.input_multiplier : null,
    ) +
    ceilRatio(
      big(usage.output_tokens) * big(r.output),
      long ? lc.output_multiplier : null,
    ) +
    tools
  ).toString();
}

export interface Balances {
  cap: string;
  allocated: string;
  reserved: string;
  unknown: string;
  incurred: string;
}
/** Authority still available to reserve. Never negative: an overrun envelope has none. */
export function availableOf(b: Balances): string {
  const v =
    big(b.cap) -
    big(b.allocated) -
    big(b.reserved) -
    big(b.unknown) -
    big(b.incurred);
  return (v > 0n ? v : 0n).toString();
}
