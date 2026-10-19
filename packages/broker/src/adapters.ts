import { createHash } from 'node:crypto';
import { discoveryFixtureAnswer, buildFixtureAnswer } from '@creator/domain';
import type {
  BrokerCallRequest,
  MeteredAction,
  Provider,
  Usage,
} from '@creator/contracts';

/** What an adapter receives: only the call itself, never credentials, grants or budgets. */
export interface AdapterRequest {
  action: MeteredAction;
  model_id: string;
  input: BrokerCallRequest['input'];
  max_output_tokens: number;
  output_format: 'text' | 'json';
  tool: string | null;
}
/**
 * `rejected` means the provider definitively did not process the request (nothing billed);
 * `unknown` means it may have. Adapters return these instead of throwing; a throw is treated
 * as unknown.
 */
export type AdapterOutcome =
  | {
      kind: 'completed';
      response_id: string | null;
      text: string;
      vector: number[] | null;
      usage: Usage;
      incomplete_reason: string | null;
    }
  | {
      kind: 'rejected';
      reason_code:
        'rate_limited' | 'invalid_request' | 'auth_failed' | 'unsupported';
      retry_after_ms: number | null;
      message: string;
    }
  | {
      kind: 'unknown';
      reason_code: 'provider_error' | 'network_error' | 'malformed_response';
      message: string;
    };

export interface ModelAdapter {
  readonly provider: Provider;
  readonly model_id: string;
  /** True only for adapters that can spend real money. */
  readonly live: boolean;
  call(req: AdapterRequest, signal: AbortSignal): Promise<AdapterOutcome>;
}

export const FIXTURE_MODEL_ID = 'fixture-model-v1';
const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Deterministic local adapter: no network, no keys, no money. Usage is computed from the
 * input so the accounting path is exercised with simulated amounts.
 */
export class FixtureAdapter implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly live = false;
  calls = 0;
  /**
   * `failEvery` makes a simulated model deliberately unreliable (X01): about one in that
   * many inputs, chosen by input hash, gets output that fails validation.
   */
  constructor(
    readonly model_id: string = FIXTURE_MODEL_ID,
    private readonly behaviour: { failEvery?: number } = {},
  ) {}
  call(req: AdapterRequest, signal: AbortSignal): Promise<AdapterOutcome> {
    this.calls += 1;
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    const joined = req.input.map((m) => m.text).join('\n');
    const bytes = Buffer.byteLength(joined, 'utf8');
    const h = digest(joined);
    const input = Math.ceil(bytes / 4) + 8 * req.input.length;
    const every = this.behaviour.failEvery;
    if (every && req.action.startsWith('model.') && h[0]! % every === 0)
      return Promise.resolve({
        kind: 'completed',
        response_id: `fixture-unreliable-${h.toString('hex').slice(0, 12)}`,
        text: 'Simulated unreliable fixture output: not the requested format',
        vector: null,
        usage: usage(input, Math.min(req.max_output_tokens, 12), {}),
        incomplete_reason: null,
      });
    if (req.action === 'tool.search_public')
      return Promise.resolve({
        kind: 'completed',
        response_id: `fixture-search-${h.toString('hex').slice(0, 12)}`,
        text: JSON.stringify({
          fixture: true,
          results: [
            { title: 'Synthetic result A', url: 'https://example.invalid/a' },
            { title: 'Synthetic result B', url: 'https://example.invalid/b' },
          ],
        }),
        vector: null,
        usage: usage(0, 0, { [req.tool ?? 'search_public']: 1 }),
        incomplete_reason: null,
      });
    if (req.action === 'model.embed')
      return Promise.resolve({
        kind: 'completed',
        response_id: `fixture-embed-${h.toString('hex').slice(0, 12)}`,
        text: '',
        vector: [...h.subarray(0, 8)].map((b) => b / 255),
        usage: usage(input, 0, {}),
        incomplete_reason: null,
      });
    // Discovery roles get deterministic, rule-based answers derived from the packet they were
    // given (labelled fixture), so fixture runs exercise the whole discovery pipeline.
    let scripted: string | null = null;
    try {
      scripted =
        buildFixtureAnswer(req.input) ?? discoveryFixtureAnswer(req.input);
    } catch {
      scripted = null;
    }
    if (scripted)
      return Promise.resolve({
        kind: 'completed',
        response_id: `fixture-${h.toString('hex').slice(0, 12)}`,
        text: scripted,
        vector: null,
        usage: usage(
          input,
          Math.min(req.max_output_tokens, Math.ceil(scripted.length / 4)),
          {},
        ),
        incomplete_reason:
          Math.ceil(scripted.length / 4) > req.max_output_tokens
            ? 'max_output_tokens'
            : null,
      });
    const out = Math.min(req.max_output_tokens, 24);
    const summary = `Fixture ${req.action} over ${bytes} input bytes.`;
    return Promise.resolve({
      kind: 'completed',
      response_id: `fixture-${h.toString('hex').slice(0, 12)}`,
      text:
        req.output_format === 'json'
          ? JSON.stringify({ fixture: true, summary })
          : summary,
      vector: null,
      usage: usage(input, out, {}),
      incomplete_reason: null,
    });
  }
}
/** The fixture models named in config/routing/model-registry.fixture.json. */
export function fixtureRouteAdapters(): FixtureAdapter[] {
  return [
    new FixtureAdapter(),
    new FixtureAdapter('fixture-economy-v1'),
    new FixtureAdapter('fixture-bargain-v1', { failEvery: 2 }),
  ];
}
export const usage = (
  input: number,
  output: number,
  tool_calls: Record<string, number>,
): Usage => ({
  uncached_input_tokens: input,
  cached_input_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: output,
  reasoning_tokens: 0,
  tool_calls,
});
