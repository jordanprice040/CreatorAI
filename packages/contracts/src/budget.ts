import {
  z,
  id,
  hash,
  timestamp,
  counter,
  nanoUsd,
  version,
} from './primitives.js';
import { ActionTypeSchema, DataClassSchema } from './oversight.js';

// T04 budgets and the metered broker. Amounts are decimal-string nano-USD; a fixture
// workspace's amounts are simulated units, never money. Nothing here grants authority:
// grants (T03) authorize, envelopes bound exposure, and the broker enforces both.
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);
const ratio = z.strictObject({
  numerator: counter.min(1).max(1000),
  denominator: counter.min(1).max(1000),
});

export const BUDGET_POLICY_VERSION = 'budget/1.0' as const;
export const ProviderSchema = z.enum(['fixture', 'openai', 'brave']);
export type Provider = z.infer<typeof ProviderSchema>;
/** Actions the broker meters. Everything else is admitted (T03) but never dispatched here. */
export const MeteredActionSchema = ActionTypeSchema.extract([
  'model.generate',
  'model.summarize',
  'model.embed',
  'tool.search_public',
]);
export type MeteredAction = z.infer<typeof MeteredActionSchema>;

/**
 * Dated provider pricing. `documented` means copied from the provider's official page at
 * `retrieved_at`; it does not prove account access or the price actually billed.
 */
export const PricingSnapshotBodySchema = z
  .strictObject({
    provider: ProviderSchema,
    model_id: short,
    basis: z.enum(['fixture', 'documented']),
    source_url: z.url({ protocol: /^https$/ }).nullable(),
    retrieved_at: timestamp,
    unit: z.literal('nano_usd_per_token'),
    rates: z.strictObject({
      input: nanoUsd,
      cached_input: nanoUsd,
      cache_write: nanoUsd,
      output: nanoUsd,
    }),
    /** Whole-request surcharge above an input size, as the provider documents it. */
    long_context: z
      .strictObject({
        above_input_tokens: counter.min(1),
        input_multiplier: ratio,
        output_multiplier: ratio,
      })
      .nullable(),
    tool_call_rates: z.record(short, nanoUsd),
    context_window_tokens: counter.min(1),
    max_output_tokens: counter.min(1),
    supported_actions: z.array(MeteredActionSchema).min(1).max(4),
    notes: note,
  })
  .superRefine((p, ctx) => {
    if ((p.basis === 'fixture') !== (p.provider === 'fixture'))
      ctx.addIssue({
        code: 'custom',
        message: 'Fixture pricing is only for the fixture provider.',
      });
    if (p.basis === 'documented' && !p.source_url)
      ctx.addIssue({
        code: 'custom',
        message: 'Documented pricing needs its official source URL.',
      });
    if (p.max_output_tokens > p.context_window_tokens)
      ctx.addIssue({
        code: 'custom',
        message: 'Max output cannot exceed the context window.',
      });
  });
export type PricingSnapshotBody = z.infer<typeof PricingSnapshotBodySchema>;
export const PricingSnapshotSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  snapshot_hash: hash,
  body: PricingSnapshotBodySchema,
  created_by: id,
  created_at: timestamp,
});
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

export const EnvelopeKindSchema = z.enum(['global', 'period', 'run', 'task']);
export const CreateEnvelopeRequestSchema = z.strictObject({
  parent_id: id.nullable(),
  kind: EnvelopeKindSchema,
  run_id: id.nullable(),
  name: short,
  cap_nano_usd: nanoUsd,
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  max_in_flight: counter.min(1).max(32),
});
export const CloseEnvelopeRequestSchema = z.strictObject({
  expected_version: version,
  reason: short,
});
/**
 * Balances are disjoint: available = cap − allocated − reserved − unknown − incurred.
 * `allocated` is authority moved to child envelopes (their spending is not counted here
 * again); `rollup_incurred` adds descendants for reporting only.
 */
export const EnvelopeSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  version,
  parent_id: id.nullable(),
  kind: EnvelopeKindSchema,
  run_id: id.nullable(),
  name: short,
  status: z.enum(['active', 'closed', 'overrun']),
  cap: nanoUsd,
  allocated: nanoUsd,
  reserved: nanoUsd,
  unknown: nanoUsd,
  incurred: nanoUsd,
  available: nanoUsd,
  rollup_incurred: nanoUsd,
  rollup_unknown: nanoUsd,
  in_flight: counter,
  max_in_flight: counter,
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  created_by: id,
  created_at: timestamp,
  closed_at: timestamp.nullable(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Usage in disjoint billing categories. Reasoning tokens are already inside output. */
export const UsageSchema = z.strictObject({
  uncached_input_tokens: counter,
  cached_input_tokens: counter,
  cache_write_tokens: counter,
  output_tokens: counter,
  /** Informational subset of output_tokens; never priced separately. */
  reasoning_tokens: counter,
  tool_calls: z.record(short, counter),
});
export type Usage = z.infer<typeof UsageSchema>;
export const ExposureSchema = z.strictObject({
  max_input_tokens: counter,
  max_output_tokens: counter,
  max_tool_calls: z.record(short, counter),
  long_context: z.boolean(),
  amount: nanoUsd,
  method: z.literal('utf8_bytes_upper_bound/1'),
});
export type Exposure = z.infer<typeof ExposureSchema>;

const message = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  text: z.string().min(1).max(20000),
});
export const BrokerCallRequestSchema = z
  .strictObject({
    envelope_id: id,
    action_type: MeteredActionSchema,
    task_id: id.nullable(),
    /** Stable identity of the logical operation; a repeat never dispatches twice. */
    logical_operation_id: id,
    pricing_snapshot_id: id,
    data_class: DataClassSchema,
    input: z.array(message).min(1).max(20),
    max_output_tokens: counter.min(1).max(200000),
    output_format: z.enum(['text', 'json']),
    tool: short.nullable(),
    max_attempts: counter.min(1).max(3),
    timeout_ms: counter.min(100).max(600000),
    justification: note,
  })
  .superRefine((r, ctx) => {
    if ((r.action_type === 'tool.search_public') !== (r.tool !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'Name a tool exactly when the action is a tool call.',
      });
  });
export type BrokerCallRequest = z.infer<typeof BrokerCallRequestSchema>;

export const ReservationStatusSchema = z.enum([
  'denied',
  'in_flight',
  'settled',
  'released',
  'unknown',
]);
export const ReservationSchema = z.strictObject({
  id,
  workspace_id: id,
  envelope_id: id,
  run_id: id,
  task_id: id.nullable(),
  logical_operation_id: id,
  attempt: counter.min(1),
  action_type: MeteredActionSchema,
  provider: ProviderSchema,
  model_id: short,
  pricing_snapshot_id: id.nullable(),
  admission_id: id.nullable(),
  decision_id: id.nullable(),
  status: ReservationStatusSchema,
  reason_code: short,
  explanation: z.string().max(1200),
  /** Estimate of maximum exposure, held while in flight or unknown. Not usage. */
  reserved: nanoUsd,
  exposure: ExposureSchema.nullable(),
  /** Authoritative charge, only once settled. */
  incurred: nanoUsd.nullable(),
  usage: UsageSchema.nullable(),
  usage_source: z
    .enum([
      'provider_response',
      'late_provider_response',
      'owner_reconciliation',
      'fixture',
    ])
    .nullable(),
  provider_response_id: z.string().max(200).nullable(),
  fixture: z.boolean(),
  created_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const BrokerCallResultSchema = z.strictObject({
  status: z.enum([
    'succeeded',
    'failed',
    'denied',
    'needs_human',
    'in_flight',
    'unknown',
    'cancelled',
  ]),
  reason_code: short,
  explanation: z.string().max(1200),
  logical_operation_id: id,
  attempts: z.array(ReservationSchema).max(4),
  output: z
    .strictObject({
      text: z.string().max(200000),
      json: z.unknown().nullable(),
      vector: z.array(z.number()).max(4096).nullable(),
    })
    .nullable(),
  decision_id: id.nullable(),
  fixture: z.boolean(),
  replayed: z.boolean(),
});
export type BrokerCallResult = z.infer<typeof BrokerCallResultSchema>;

/** Owner reconciliation of an unknown outcome, from the provider's own records. */
export const ReconcileRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('charged'),
    usage: UsageSchema,
    provider_response_id: z.string().trim().min(1).max(200).nullable(),
    evidence: note,
  }),
  z.strictObject({ outcome: z.literal('no_charge'), evidence: note }),
]);
export const BrokerStatusSchema = z.strictObject({
  fixture_adapter: z.literal('deterministic-fixture-broker-v1'),
  live: z.strictObject({
    openai: z.enum(['not_configured', 'configured_unverified']),
  }),
  note: z.string(),
});

/**
 * The owner's overall ceiling on real runtime spending across every workspace (ADR-0043).
 * `config/spending.json` holds the reviewed starting value; each change made in Settings is
 * a new immutable version by a signed-in person, never by an agent or worker.
 */
export const RuntimeCeilingChangeSchema = z.strictObject({
  version: counter.min(1),
  ceiling_nano_usd: nanoUsd,
  previous_nano_usd: nanoUsd,
  reason: note,
  actor_id: id,
  created_at: timestamp,
});
export type RuntimeCeilingChange = z.infer<typeof RuntimeCeilingChangeSchema>;
export const RuntimeCeilingSchema = z.strictObject({
  /** The ceiling in force: the latest change, else the configured value. */
  ceiling_nano_usd: nanoUsd,
  source: z.enum(['config', 'settings']),
  /** 0 until the first change; a change must name the version it replaces. */
  version: counter,
  configured_nano_usd: nanoUsd,
  /** Spending counts from this time (the configured start), whatever the ceiling's version. */
  counted_since: timestamp,
  /** Settled cost plus held in-flight and unknown exposure, and open study holds. */
  exposure_nano_usd: nanoUsd,
  unknown_calls: counter,
  history: z.array(RuntimeCeilingChangeSchema).max(50),
});
export type RuntimeCeiling = z.infer<typeof RuntimeCeilingSchema>;
export const SetRuntimeCeilingRequestSchema = z.strictObject({
  expected_version: counter,
  /** At most 15 whole-dollar digits (under a quadrillion dollars), as Settings accepts. */
  ceiling_nano_usd: nanoUsd.regex(/^(0|[1-9][0-9]{0,23})$/),
  reason: note,
});
export type SetRuntimeCeilingRequest = z.infer<
  typeof SetRuntimeCeilingRequestSchema
>;

/**
 * Narrower limits under the overall ceiling (ADR-0044): one per-run limit and per-model
 * limits, each counted over real (non-fixture) paid calls since the ceiling's start date.
 * None are set until the owner sets them; with none, only the overall ceiling applies. A
 * limit can never be set above the ceiling in force, and the ceiling always still applies.
 */
const limitNano = nanoUsd.regex(/^(0|[1-9][0-9]{0,23})$/);
const modelKey = {
  provider: ProviderSchema.exclude(['fixture']),
  model_id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
};
export const ModelSpendLimitSchema = z.strictObject({
  ...modelKey,
  limit_nano_usd: limitNano,
});
export type ModelSpendLimit = z.infer<typeof ModelSpendLimitSchema>;
export const SpendLimitsSchema = z.strictObject({
  /** The most any one run may spend; null means only the overall ceiling bounds a run. */
  per_run_nano_usd: limitNano.nullable(),
  per_model: z.array(ModelSpendLimitSchema).max(50),
});
export type SpendLimits = z.infer<typeof SpendLimitsSchema>;
export const SpendLimitChangeSchema = z.strictObject({
  version: counter.min(1),
  limits: SpendLimitsSchema,
  previous: SpendLimitsSchema,
  reason: note,
  actor_id: id,
  created_at: timestamp,
});
export type SpendLimitChange = z.infer<typeof SpendLimitChangeSchema>;
export const SpendLimitsViewSchema = z.strictObject({
  /** 0 until the first change; a change must name the version it replaces. */
  version: counter,
  limits: SpendLimitsSchema,
  /** The overall ceiling in force; it still applies on top of every narrower limit. */
  ceiling_nano_usd: nanoUsd,
  counted_since: timestamp,
  /** Models with a limit, a real pricing snapshot or counted spending, with what counts. */
  models: z
    .array(
      z.strictObject({
        ...modelKey,
        limit_nano_usd: limitNano.nullable(),
        exposure_nano_usd: nanoUsd,
      }),
    )
    .max(200),
  /** The real runs with the most counted spending, highest first. */
  top_runs: z
    .array(
      z.strictObject({
        workspace_id: id,
        run_id: id,
        exposure_nano_usd: nanoUsd,
      }),
    )
    .max(10),
  history: z.array(SpendLimitChangeSchema).max(50),
});
export type SpendLimitsView = z.infer<typeof SpendLimitsViewSchema>;
export const SetSpendLimitsRequestSchema = z.strictObject({
  expected_version: counter,
  limits: SpendLimitsSchema,
  reason: note,
});
export type SetSpendLimitsRequest = z.infer<typeof SetSpendLimitsRequestSchema>;
