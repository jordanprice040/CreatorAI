import { z, id, hash, timestamp, version, nanoUsd } from './primitives.js';

// X07 payments, entitlements, revenue and reinvestment. Processor state is authoritative only
// when the backend retrieved it; webhook bodies and checkout redirects name objects, they never
// carry money or access. Live mode is not implemented: activating it is a separate owner decision.
export const PAYMENTS_POLICY_VERSION = 'payments/1.0' as const;

const label = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);
const envName = z
  .string()
  .regex(/^CREATOR_(?:STRIPE|PAYMENTS)_[A-Z0-9_]{1,60}$/);
/** Processor object ids (Stripe style: prefix_ then base62). */
export const processorId = z.string().regex(/^[a-z]{2,6}_[A-Za-z0-9_]{1,120}$/);
/** Opaque customer reference chosen by the studio; never an email or card detail. */
export const customerRef = z.string().regex(/^[A-Za-z0-9_.:-]{3,100}$/);
/** Whole minor units (US cents), as processors report them. */
export const cents = z.number().int().min(0).max(1e12);

export const PaymentProcessorKindSchema = z.enum(['fixture', 'stripe']);
export const RegisterPaymentConnectionRequestSchema = z
  .strictObject({
    label,
    processor: PaymentProcessorKindSchema,
    /** 'test' is processor test mode. There is no 'live': live activation is not built. */
    mode: z.enum(['fixture', 'test']),
    /** The processor account this connection must observe before it activates. */
    account_id: processorId,
    secret_key_env: envName.nullable(),
    webhook_secret_env: envName,
  })
  .superRefine((c, ctx) => {
    if ((c.processor === 'fixture') !== (c.mode === 'fixture'))
      ctx.addIssue({
        code: 'custom',
        message:
          'The fixture processor runs in fixture mode, and only it does.',
      });
    if ((c.processor === 'stripe') !== (c.secret_key_env !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'A Stripe connection names its test secret key variable.',
      });
  });
export type PaymentConnectionBody = z.infer<
  typeof RegisterPaymentConnectionRequestSchema
>;
export const PaymentConnectionSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  version,
  status: z.enum(['unverified', 'active', 'rejected', 'revoked']),
  body: RegisterPaymentConnectionRequestSchema,
  body_hash: hash,
  verification: z
    .strictObject({
      checked_at: timestamp,
      result: z.enum(['match', 'wrong_account', 'live_refused', 'refused']),
      observed_account: z.string().max(200).nullable(),
      reason: z.string().max(500),
    })
    .nullable(),
  status_reason: z.string().max(500).nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type PaymentConnection = z.infer<typeof PaymentConnectionSchema>;
export const RevokePaymentConnectionRequestSchema = z.strictObject({
  expected_version: version,
  reason: z.string().trim().min(1).max(500),
});

// ---- Offers and checkout --------------------------------------------------------------------

export const CreateOfferRequestSchema = z.strictObject({
  connection_id: id,
  /** The verified release a buyer is entitled to: one artifact manifest, by id and hash. */
  artifact_id: id,
  manifest_sha256: hash,
  label,
  /** Price in nano-USD; must be a whole number of cents. */
  price_nano_usd: nanoUsd,
});
export const OfferSchema = z.strictObject({
  id,
  workspace_id: id,
  connection_id: id,
  product_id: id,
  artifact_id: id,
  manifest_sha256: hash,
  label,
  price_nano_usd: nanoUsd,
  status: z.enum(['active', 'archived']),
  created_at: timestamp,
});
export type Offer = z.infer<typeof OfferSchema>;
const localUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((u) => !/[?#].*(?:paid|grant|entitle)/i.test(u), {
    message: 'Return URLs cannot carry access flags.',
  });
export const CreateCheckoutRequestSchema = z.strictObject({
  offer_id: id,
  customer_ref: customerRef,
  success_url: localUrl,
  cancel_url: localUrl,
});
export const CheckoutSchema = z.strictObject({
  id,
  offer_id: id,
  customer_ref: customerRef,
  state: z.enum(['open', 'failed']),
  processor_session_id: z.string().max(200).nullable(),
  url: z.string().max(2000).nullable(),
  reason: z.string().max(500).nullable(),
  created_at: timestamp,
});
export type Checkout = z.infer<typeof CheckoutSchema>;

// ---- Test buyer (simulated processor only) ---------------------------------------------------

/**
 * What a simulated buyer or the simulated processor does next. Only fixture connections take
 * these; each queues one signed-on-delivery event and changes nothing in the studio by itself.
 */
export const TestBuyerActionSchema = z.enum([
  'pay',
  'settle',
  'refund',
  'dispute',
  'dispute_won',
  'dispute_lost',
]);
export type TestBuyerAction = z.infer<typeof TestBuyerActionSchema>;
export const TestBuyerRequestSchema = z.strictObject({
  action: TestBuyerActionSchema,
});
/** How a queued event is delivered: correctly signed, signed with the wrong secret, or too old. */
export const TestDeliverySignatureSchema = z.enum([
  'valid',
  'wrong_secret',
  'expired',
]);
export const TestDeliverRequestSchema = z.strictObject({
  event_id: z.string().regex(/^evt_[A-Za-z0-9_]{1,120}$/),
  signature: TestDeliverySignatureSchema,
});
export const TestCheckoutStateSchema = z.strictObject({
  checkout_id: id,
  /** False when the API restarted: the in-memory simulated processor forgot this session. */
  available: z.boolean(),
  payment: z
    .strictObject({
      id: processorId,
      amount_cents: cents,
      settled: z.boolean(),
      refunded_cents: cents,
      dispute: z.enum(['none', 'open', 'won', 'lost']),
    })
    .nullable(),
  allowed: z.array(TestBuyerActionSchema),
  events: z.array(
    z.strictObject({
      id: z.string(),
      type: z.string(),
      action: TestBuyerActionSchema,
      queued_at: timestamp,
      deliveries: z.array(
        z.strictObject({
          at: timestamp,
          signature: TestDeliverySignatureSchema,
          http_status: z.number().int(),
          outcome: z.string().max(200),
        }),
      ),
    }),
  ),
});
export type TestCheckoutState = z.infer<typeof TestCheckoutStateSchema>;

// ---- Authoritative processor observations ---------------------------------------------------

export const BalanceTxnSchema = z
  .strictObject({
    id: processorId,
    amount: cents,
    fee: cents,
    net: z.number().int(),
    status: z.enum(['pending', 'available']),
    available_on: timestamp,
  })
  .refine(
    (b) => b.net === b.amount - b.fee,
    'Balance transaction net must equal amount minus fee.',
  );
export const PaymentSnapshotSchema = z.strictObject({
  id: processorId,
  livemode: z.boolean(),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount: cents,
  status: z.enum([
    'requires_payment',
    'processing',
    'succeeded',
    'canceled',
    'failed',
  ]),
  metadata: z.record(z.string().max(40), z.string().max(500)),
  charge: z
    .strictObject({ id: processorId, balance_transaction: BalanceTxnSchema })
    .nullable(),
  refunds: z
    .array(
      z.strictObject({
        id: processorId,
        amount: cents,
        status: z.enum(['pending', 'succeeded', 'failed', 'canceled']),
      }),
    )
    .max(100),
  disputes: z
    .array(
      z.strictObject({
        id: processorId,
        amount: cents,
        status: z.enum(['open', 'won', 'lost']),
        /** Signed sum of the dispute's balance transactions (withdrawal negative). */
        funds_amount: z.number().int(),
        funds_fee: cents,
      }),
    )
    .max(20),
});
export type PaymentSnapshot = z.infer<typeof PaymentSnapshotSchema>;
export const PayoutSnapshotSchema = z.strictObject({
  id: processorId,
  livemode: z.boolean(),
  currency: z.string().regex(/^[a-z]{3}$/),
  amount: cents,
  status: z.enum(['pending', 'in_transit', 'paid', 'failed', 'canceled']),
});
export type PayoutSnapshot = z.infer<typeof PayoutSnapshotSchema>;
export const BalanceSnapshotSchema = z.strictObject({
  livemode: z.boolean(),
  available_cents: z.number().int(),
  pending_cents: z.number().int(),
});
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;

// ---- Ledger -----------------------------------------------------------------------------------

/** Debits positive, credits negative; each entry sums to zero. */
export const LedgerAccountSchema = z.enum([
  'processor_pending',
  'processor_available',
  'bank',
  'revenue',
  'processing_fees',
  'refunds',
  'dispute_losses',
  'dispute_fees',
  'owner_funding',
]);
export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;
export const signedNano = z.string().regex(/^-?(0|[1-9][0-9]{0,29})$/);
export const LedgerEntrySchema = z.strictObject({
  id,
  economic_key: z.string().max(300),
  revision: version,
  kind: z.enum(['original', 'correction']),
  memo: z.string().max(500),
  postings: z.array(
    z.strictObject({ account: LedgerAccountSchema, amount_nano: signedNano }),
  ),
  created_at: timestamp,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const RecordOwnerFundingRequestSchema = z.strictObject({
  amount_nano_usd: nanoUsd,
  evidence: note,
});

export const EntitlementSchema = z.strictObject({
  id,
  offer_id: id,
  payment_id: processorId,
  customer_ref: customerRef,
  product_id: id,
  artifact_id: id,
  manifest_sha256: hash,
  status: z.enum(['active', 'suspended', 'revoked']),
  reason: z.string().max(500),
  version,
  updated_at: timestamp,
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

// ---- Reinvestment ----------------------------------------------------------------------------

export const SetReinvestmentPolicyRequestSchema = z.strictObject({
  enabled: z.boolean(),
  /** Share of each settled payment's retained earnings that may become budget, in basis points. */
  eligible_bps: z.number().int().min(0).max(10_000),
  /** Days after settlement before earnings count, to cover the refund and dispute window. */
  holdback_days: z.number().int().min(0).max(365),
  period_days: z.number().int().min(1).max(366),
  period_cap_nano_usd: nanoUsd,
  min_reserve_nano_usd: nanoUsd,
  rationale: note,
});
export const ReinvestmentPolicySchema =
  SetReinvestmentPolicyRequestSchema.extend({
    version,
    anchor_at: timestamp,
    created_at: timestamp,
  });
export type ReinvestmentPolicy = z.infer<typeof ReinvestmentPolicySchema>;
export const RegisterRailRequestSchema = z
  .strictObject({
    label,
    kind: z.enum(['processor_balance', 'owner_attested']),
    connection_id: id.nullable(),
  })
  .superRefine((r, ctx) => {
    if ((r.kind === 'processor_balance') !== (r.connection_id !== null))
      ctx.addIssue({
        code: 'custom',
        message:
          'A processor-balance rail names its connection, and only it does.',
      });
  });
export const AttestRailRequestSchema = z.strictObject({
  available_nano_usd: nanoUsd,
  evidence: note,
});
export const SetRailStatusRequestSchema = z.strictObject({
  status: z.enum(['available', 'unavailable']),
  reason: note,
});
export const CommitmentRequestSchema = z.strictObject({
  kind: z.enum(['reserve', 'liability', 'tax']),
  label,
  amount_nano_usd: nanoUsd,
});
export const AllocateRequestSchema = z.strictObject({
  amount_nano_usd: nanoUsd,
  /** Take what the bounds allow (at least one nano-USD) instead of refusing the shortfall. */
  allow_partial: z.boolean(),
  envelope_name: label,
  max_in_flight: z.number().int().min(1).max(32),
  /**
   * `portfolio` makes the new envelope usable by this workspace's portfolio runs (outside the
   * protected maintenance reserve). Omitted means a standalone budget. Nothing allocates
   * automatically: earnings stay unallocated capacity until the owner asks (2026-10-20).
   */
  target: z.enum(['standalone', 'portfolio']).optional(),
});
export const AllocationSchema = z.strictObject({
  id,
  amount_nano_usd: nanoUsd,
  requested_nano_usd: nanoUsd,
  envelope_id: id,
  // Responses stored before 2026-10-20 have no target; they were all standalone.
  target: z.enum(['standalone', 'portfolio']).default('standalone'),
  policy_version: version,
  period_start: timestamp,
  uses: z.array(z.strictObject({ tranche_id: id, amount_nano_usd: nanoUsd })),
  created_at: timestamp,
});
export type Allocation = z.infer<typeof AllocationSchema>;
/** Each bound is computed separately; capacity is the least of them. */
export const CapacitySchema = z.strictObject({
  enabled: z.boolean(),
  frozen: z.boolean(),
  policy_version: version.nullable(),
  eligible_tranches_nano: nanoUsd,
  surplus_nano: signedNano,
  usable_liquidity_nano: signedNano,
  period_remaining_nano: nanoUsd,
  outstanding_losses_nano: nanoUsd,
  capacity_nano: nanoUsd,
  binding: z.string().max(80),
  parts: z.strictObject({
    retained_earnings_nano: signedNano,
    costs_outside_reinvestment_nano: nanoUsd,
    allocated_net_nano: nanoUsd,
    rails_available_nano: nanoUsd,
    unavailable_rails: z.array(z.string().max(200)),
    min_reserve_nano: nanoUsd,
    commitments_nano: nanoUsd,
    unspent_reinvested_nano: nanoUsd,
  }),
});
export type Capacity = z.infer<typeof CapacitySchema>;
