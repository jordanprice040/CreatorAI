import { z, id, hash, timestamp, counter, version } from './primitives.js';
import { DataClassSchema } from './oversight.js';
import {
  BenchmarkManifestSchema,
  RateSchema,
  TaskClassSchema,
} from './routing.js';

// §2.2/§2.4 model connections. A ChatGPT-plan connection uses Sign in with ChatGPT plan usage
// (one OAuth token) through two separate capabilities: direct Responses calls for general
// inference and Codex app-server for code_build. Sign-in, model access and task
// qualification are separate verified states; none implies another. Tokens never appear in
// these records: the database stores only a vault reference.
//
// A claude_code connection (ADR-0050) instead drives the unmodified Claude Code CLI that the
// owner installed and signed in to personally on this computer. The studio never sees,
// stores or forwards a Claude credential; it only reads `claude auth status`. Anthropic does
// not allow apps to offer Claude sign-in or hold Claude subscription tokens, so there is no
// sign-in flow for this kind. It has the direct path only (no Codex, no code_build).

export const CONNECTIONS_POLICY_VERSION = 'connections/1.0' as const;
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);
const label = z.string().trim().min(1).max(80);

export const PlanProviderSchema = z.enum(['chatgpt_plan', 'claude_code']);
export type PlanProvider = z.infer<typeof PlanProviderSchema>;

export const PlanPathSchema = z.enum(['responses', 'codex']);
export type PlanPath = z.infer<typeof PlanPathSchema>;
/** Task classes the direct Responses path may serve once qualified. */
export const PLAN_RESPONSES_TASK_CLASSES = [
  'research_synthesis',
  'candidate_generation',
  'scoring',
  'specification',
  'summarization',
  // T12 builder and reviewer roles as fresh direct requests (ADR-0048).
  'patch_build',
  'independent_review',
] as const;
export const PlanTaskClassSchema = TaskClassSchema.extract([
  ...PLAN_RESPONSES_TASK_CLASSES,
  'code_build',
]);
export type PlanTaskClass = z.infer<typeof PlanTaskClassSchema>;
export const pathForTaskClass = (t: PlanTaskClass): PlanPath =>
  t === 'code_build' ? 'codex' : 'responses';

/**
 * The longest timeout a JavaScript timer can wait (2^31 - 1 ms, about 24.8 days); a longer
 * delay fires at once. This is a technical bound, not an owner cap (ADR-0062), and the cap
 * maxima below are rounded down to the unit the Models form shows (seconds, minutes).
 */
export const TIMER_MAX_MS = 2_147_483_647;
export const PLAN_REQUEST_TIMEOUT_MAX_MS =
  Math.floor(TIMER_MAX_MS / 1000) * 1000;
export const PLAN_BUILD_TIMEOUT_MAX_MS =
  Math.floor(TIMER_MAX_MS / 60_000) * 60_000;

/**
 * How long a client waits for a request that holds one or more plan calls open, from the
 * connection's own timeout (ADR-0062: no fixed wait sized for the old maxima). Each call may
 * take the full timeout; the margin covers admission, settling and transport. Never above the
 * timer bound.
 */
export function planWaitMs(timeoutMs: number, calls = 1, marginMs = 60_000) {
  return Math.min(
    TIMER_MAX_MS,
    Math.max(1, Math.ceil(calls)) * Math.max(0, timeoutMs) + marginMs,
  );
}

/**
 * Studio-side caps, in units the studio can enforce itself. They are not OpenAI's limits: a
 * request can still be refused by the provider's own (shared) plan allowance.
 *
 * ADR-0062: the owner sets these with no upper limit (a bigger plan or an API budget may need
 * more). Only the minimums stay, plus the timer bound on the two timeouts; every change still
 * clears the caps acceptance and needs the owner.
 */
export const PlanCapsSchema = z.strictObject({
  responses: z.strictObject({
    max_requests_per_run: counter.min(1),
    request_timeout_ms: counter.min(5_000).max(PLAN_REQUEST_TIMEOUT_MAX_MS),
    /** Enforced client-side by ending the stream; the plan route rejects max_output_tokens. */
    max_output_chars: counter.min(500),
    max_input_chars: counter.min(500),
  }),
  codex: z.strictObject({
    max_builds_per_day: counter,
    max_turns_per_build: counter.min(1),
    max_model_requests_per_build: counter.min(1),
    build_timeout_ms: counter.min(60_000).max(PLAN_BUILD_TIMEOUT_MAX_MS),
  }),
  shared: z.strictObject({
    /** Rolling 24 hours, both paths together. */
    max_model_requests_per_day: counter.min(1),
    max_in_flight: z.literal(1),
  }),
});
export type PlanCaps = z.infer<typeof PlanCapsSchema>;

export const PlanTypeSchema = z.enum(['plus', 'pro', 'max', 'unknown']);
export const PlanSettingsSchema = z
  .strictObject({
    format: z.literal('chatgpt-plan-settings/1'),
    plan_type: PlanTypeSchema,
    /** Plus shares its five-hour allowance with every app, including personal Codex use. */
    shared_allowance_note: note,
    allowed_data_classes: z.array(DataClassSchema).min(1).max(3),
    allowed_task_classes: z.array(PlanTaskClassSchema).min(1).max(8),
    caps: PlanCapsSchema,
  })
  .superRefine((s, ctx) => {
    for (const [k, list] of [
      ['allowed_data_classes', s.allowed_data_classes],
      ['allowed_task_classes', s.allowed_task_classes],
    ] as const)
      if (new Set(list).size !== list.length)
        ctx.addIssue({ code: 'custom', message: `${k} has duplicates.` });
  });
export type PlanSettings = z.infer<typeof PlanSettingsSchema>;

export const CreatePlanConnectionRequestSchema = z.strictObject({
  kind: PlanProviderSchema.default('chatgpt_plan'),
  label,
  settings: PlanSettingsSchema,
});
export const UpdatePlanSettingsRequestSchema = z.strictObject({
  expected_version: version,
  settings: PlanSettingsSchema,
});
/** Owner accepts the exact caps now stored; any later settings change clears the acceptance. */
export const AcceptPlanCapsRequestSchema = z.strictObject({
  expected_version: version,
  settings_hash: hash,
});
/**
 * The studio cannot see per request whether ChatGPT credits were used after a plan limit, so
 * inference stays blocked until the owner records that credits are off for this app.
 */
export const CREDITS_OFF_STATEMENT =
  'I checked ChatGPT Settings > Usage: Creator Agent is not allowed to use credits after reaching plan limits.' as const;
/**
 * The Claude equivalent (ADR-0050): Pro and Max can buy extra usage after the plan limit, which
 * the studio cannot see per request either. The statement must match the connection's kind.
 */
export const CLAUDE_EXTRA_USAGE_OFF_STATEMENT =
  'I checked Claude Settings > Usage: extra usage (usage credits) is turned off, so Claude Code cannot spend money after reaching my plan limits.' as const;
/**
 * ADR-0050 review L-4: `--restricted`, which keeps user settings, hooks and plugins out of the
 * studio's runs, needs Claude Code 2.1.248 or later. Older versions are refused with a reason.
 */
export const CLAUDE_CODE_MIN_VERSION = '2.1.248' as const;
export function claudeCodeVersionSupported(version: string): boolean {
  const parse = (v: string) =>
    /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const have = parse(version);
  const need = parse(CLAUDE_CODE_MIN_VERSION)!;
  if (!have) return false;
  for (let i = 0; i < 3; i++)
    if (have[i] !== need[i]) return have[i]! > need[i]!;
  return true;
}
export const usageOffStatement = (kind: PlanProvider) =>
  kind === 'claude_code'
    ? CLAUDE_EXTRA_USAGE_OFF_STATEMENT
    : CREDITS_OFF_STATEMENT;
export const AttestCreditsRequestSchema = z.strictObject({
  expected_version: version,
  statement: z.union([
    z.literal(CREDITS_OFF_STATEMENT),
    z.literal(CLAUDE_EXTRA_USAGE_OFF_STATEMENT),
  ]),
  checked_on: z.iso.date(),
});
export const WithdrawCreditsRequestSchema = z.strictObject({
  expected_version: version,
  reason: note,
});

export const SignInStateSchema = z.enum([
  'not_signed_in',
  'signed_in',
  'reauthorization_required',
  'signed_out',
]);
export const EligibilityStateSchema = z.enum([
  'unknown',
  'eligible',
  'not_eligible',
  'temporarily_unavailable',
]);
export const QuotaStateSchema = z.enum([
  'unknown',
  'available',
  'exhausted',
  'unavailable',
]);
export const PlanConnectionSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  kind: PlanProviderSchema,
  label,
  version,
  settings: PlanSettingsSchema,
  settings_hash: hash,
  caps_accepted_at: timestamp.nullable(),
  ext_agent_host_id: short,
  sign_in: z.strictObject({
    state: SignInStateSchema,
    issued_client_id: short.nullable(),
    account_label: short.nullable(),
    scopes: z.array(short).max(20),
    plan_usage_granted: z.boolean(),
    verified_at: timestamp.nullable(),
    access_expires_at: timestamp.nullable(),
  }),
  credits: z.strictObject({
    state: z.enum(['unconfirmed', 'confirmed_off']),
    checked_on: z.iso.date().nullable(),
    confirmed_at: timestamp.nullable(),
    confirmed_by: id.nullable(),
  }),
  eligibility: z.strictObject({
    state: EligibilityStateSchema,
    reason_code: short.nullable(),
    upstream_request_id: short.nullable(),
    observed_at: timestamp.nullable(),
  }),
  quota: z.strictObject({
    state: QuotaStateSchema,
    reason_code: short.nullable(),
    observed_at: timestamp.nullable(),
  }),
  status_reason: note.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type PlanConnection = z.infer<typeof PlanConnectionSchema>;

/** One verified-access fact per (model, path). A catalog listing never creates one. */
export const PlanModelAccessSchema = z.strictObject({
  connection_id: id,
  model_id: short,
  path: PlanPathSchema,
  access: z.enum(['verified', 'refused']),
  reason_code: short.nullable(),
  request_id: id,
  verified_at: timestamp,
});
export type PlanModelAccess = z.infer<typeof PlanModelAccessSchema>;

/** One-shot approval, bound to initial model access or an explicit availability recheck. */
export const PlanCheckIntentSchema = z.enum([
  'model_access',
  'availability_recheck',
]);
export const CreateVerificationGrantRequestSchema = z
  .strictObject({
    expected_version: version,
    model_id: short,
    path: PlanPathSchema,
    expires_in_minutes: counter.min(1).max(60),
    intent: PlanCheckIntentSchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.intent === 'availability_recheck' && r.path !== 'responses')
      ctx.addIssue({
        code: 'custom',
        message: 'Availability rechecks use the Responses path.',
      });
  });
export const PlanVerificationGrantSchema = z.strictObject({
  id,
  connection_id: id,
  model_id: short,
  path: PlanPathSchema,
  max_requests: z.literal(1),
  used: counter.max(1),
  expires_at: timestamp,
  created_by: id,
  created_at: timestamp,
  intent: PlanCheckIntentSchema.optional(),
});
export type PlanVerificationGrant = z.infer<typeof PlanVerificationGrantSchema>;

export const PlanPurposeSchema = z.enum([
  'verification',
  'availability_recheck',
  'qualification',
  'task',
  'codex_build',
  /** ADR-0057: one studio chat answer, admitted under the owner's chat setting. */
  'chat',
]);
export const PlanAdmissionRequestSchema = z
  .strictObject({
    connection_id: id,
    logical_operation_id: id,
    path: PlanPathSchema,
    purpose: PlanPurposeSchema,
    model_id: short,
    task_class: PlanTaskClassSchema.nullable(),
    data_class: DataClassSchema,
    run_id: id.nullable(),
    /** Codex: every upstream model request of one build carries the build id. */
    build_id: id.nullable(),
    grant_id: id.nullable(),
    qualification_id: id.nullable(),
    input_chars: counter,
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (
      (r.purpose === 'verification' || r.purpose === 'availability_recheck') !==
      (r.grant_id !== null)
    )
      issue(
        'A model-access or availability check names its one-shot grant, and only those checks do.',
      );
    if (
      r.purpose === 'availability_recheck' &&
      (r.path !== 'responses' ||
        r.data_class !== 'synthetic' ||
        r.task_class !== null ||
        r.run_id !== null ||
        r.build_id !== null)
    )
      issue(
        'Availability rechecks are synthetic Responses checks, not task or build dispatch.',
      );
    if ((r.purpose === 'qualification') !== (r.qualification_id !== null))
      issue(
        'A qualification request names its qualification run, and only it does.',
      );
    // ADR-0054: a T12 build-role request names the build whose one approval covers it.
    const buildRole =
      r.purpose === 'task' &&
      (r.task_class === 'patch_build' || r.task_class === 'independent_review');
    if ((r.purpose === 'codex_build' || buildRole) !== (r.build_id !== null))
      issue(
        'A Codex build or T12 build-role request names its build, and only those do.',
      );
    if ((r.purpose === 'codex_build') !== (r.path === 'codex'))
      issue('Only Codex builds use the Codex path.');
    if (r.purpose === 'task' && r.task_class === null)
      issue('A task request names its task class.');
    if (
      r.purpose === 'chat' &&
      (r.path !== 'responses' ||
        r.task_class !== null ||
        r.run_id !== null ||
        r.data_class !== 'private_approved')
    )
      issue(
        "A chat answer is a direct request with the owner's private text, outside any run or task class.",
      );
    if (r.task_class && pathForTaskClass(r.task_class) !== r.path)
      issue('This task class belongs to the other path.');
  });
export type PlanAdmissionRequest = z.infer<typeof PlanAdmissionRequestSchema>;

export const PlanRequestStateSchema = z.enum([
  'in_flight',
  'completed',
  'failed',
  'rejected',
  'unknown',
  'reconciled',
]);
export const PlanRequestSchema = z.strictObject({
  id,
  connection_id: id,
  logical_operation_id: id,
  path: PlanPathSchema,
  purpose: PlanPurposeSchema,
  model_id: short,
  task_class: PlanTaskClassSchema.nullable(),
  data_class: DataClassSchema,
  run_id: id.nullable(),
  build_id: id.nullable(),
  state: PlanRequestStateSchema,
  reason_code: short.nullable(),
  upstream_request_id: short.nullable(),
  /** Observed only; null when the stream did not report it, never assumed zero. */
  output_tokens: counter.nullable(),
  output_chars: counter.nullable(),
  output_hash: hash.nullable(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/** How a finished plan request ended, as observed by the adapter or relay. */
export const PlanSettlementSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('completed'),
    upstream_request_id: short.nullable(),
    output_tokens: counter.nullable(),
    output_chars: counter,
    output_hash: hash,
  }),
  z.strictObject({
    state: z.enum(['failed', 'rejected', 'unknown']),
    reason_code: short,
    upstream_request_id: short.nullable(),
    output_chars: counter.nullable(),
  }),
]);
export type PlanSettlement = z.infer<typeof PlanSettlementSchema>;
export const ReconcilePlanRequestSchema = z.strictObject({
  expected_version: version,
  outcome: z.enum(['did_not_run', 'ran']),
  note,
});

/**
 * Qualification gate: absolute held-out pass rate against a frozen route-benchmark/1 manifest.
 * It is not baseline-relative; the owner's reference model is not reachable on this route.
 */
export const StartPlanQualificationRequestSchema = z.strictObject({
  expected_version: version,
  model_id: short,
  manifest: BenchmarkManifestSchema,
  min_held_out_cases: counter.min(3).max(200),
  floor: RateSchema,
});
export const PlanQualificationSchema = z.strictObject({
  id,
  connection_id: id,
  model_id: short,
  task_class: PlanTaskClassSchema,
  manifest_hash: hash,
  min_held_out_cases: counter,
  floor: RateSchema,
  state: z.enum(['running', 'qualified', 'failed', 'abandoned']),
  development: z.strictObject({ passed: counter, total: counter }),
  held_out: z.strictObject({ passed: counter, total: counter }),
  reason: note.nullable(),
  created_by: id,
  created_at: timestamp,
  decided_at: timestamp.nullable(),
  /** Derived by the server from the exact current role prompt; historical grades stay intact. */
  prompt_current: z.boolean().optional(),
  /** ADR-0074 review L-4: a scoring qualification that admits automatic assessments. */
  admits_assessment: z.boolean().optional(),
  /**
   * ADR-0084 (P23): on a started qualification, whether this studio is running its cases now.
   * Read from the server, so a page that was left or reloaded shows a running Run as running.
   */
  executing: z.boolean().optional(),
});
export type PlanQualification = z.infer<typeof PlanQualificationSchema>;
/**
 * PR #75 review L-2: the newest decided qualification of a model for a task class is the one
 * that counts. A later failure withdraws an earlier pass; a later pass restores it. Running
 * and abandoned rows decide nothing. Callers pass only rows that may admit work (build roles
 * under the current prompts, ADR-0049).
 */
export function latestDecided(
  qualifications: readonly PlanQualification[],
  model_id: string,
  task_class: string,
): PlanQualification | null {
  let out: PlanQualification | null = null;
  for (const q of qualifications) {
    if (q.prompt_current === false) continue;
    if (q.model_id !== model_id || q.task_class !== task_class) continue;
    if (q.state !== 'qualified' && q.state !== 'failed') continue;
    const t = Date.parse(q.decided_at ?? q.created_at);
    const best = out ? Date.parse(out.decided_at ?? out.created_at) : -Infinity;
    if (t > best || (t === best && q.created_at > out!.created_at)) out = q;
  }
  return out;
}
export const isQualified = (
  qualifications: readonly PlanQualification[],
  model_id: string,
  task_class: string,
) => latestDecided(qualifications, model_id, task_class)?.state === 'qualified';

/**
 * One benchmark case of a qualification as it was graded (F10): the stored answer (synthetic or
 * public data only, ADR-0049), the grader's signal and, for a non-pass, where it failed. A case
 * that never ran has no request and is shown as not run.
 */
export const PlanQualificationCaseResultSchema = z.strictObject({
  case_id: short,
  split: z.enum(['development', 'held_out']),
  request_id: id.nullable(),
  state: PlanRequestStateSchema.nullable(),
  signal: short.nullable(),
  reason: z.string().max(1200).nullable(),
  output_chars: counter.nullable(),
  answer: z.string().nullable(),
  started_at: timestamp.nullable(),
});
export type PlanQualificationCaseResult = z.infer<
  typeof PlanQualificationCaseResultSchema
>;
export const PlanQualificationResultsSchema = z.strictObject({
  qualification: PlanQualificationSchema,
  manifest_name: short.nullable(),
  cases: z.array(PlanQualificationCaseResultSchema),
});
export type PlanQualificationResults = z.infer<
  typeof PlanQualificationResultsSchema
>;

/**
 * ADR-0064: the words every admission refusal caused by an open plan request ends with. The
 * chat page shows its "Open Models and connections" button when a refusal contains them.
 */
export const PLAN_RECONCILE_HINT = 'reconcile it in Models and connections';

/**
 * ADR-0064: a request whose outcome the studio never recorded, as shown to the owner. While it
 * is open no other request can start on the connection (one at a time), so the owner can close
 * it from the app. `closable_after` is when an in-flight one counts as left behind by a stopped
 * studio; an `unknown` one can be closed at once. Closing never removes it from usage counts.
 */
export const PlanOpenRequestSchema = z.strictObject({
  request: PlanRequestSchema,
  /** The owner can close (reconcile) it now. */
  closable: z.boolean(),
  /** This studio process is still waiting on it, so it cannot be closed yet. */
  waiting: z.boolean(),
  /** An in-flight request can be closed after this time; null when not in flight. */
  closable_after: timestamp.nullable(),
});
export type PlanOpenRequest = z.infer<typeof PlanOpenRequestSchema>;

/**
 * ADR-0087 (P27): a stable code beside each plan refusal's words, so the app can offer the fix
 * for that refusal in place without matching its wording. Only four codes have an owner fix
 * the app offers (caps not accepted, data class or task class not allowed, not qualified);
 * the others name the refusal so a later fix can attach to it.
 */
export const PlanRefusalCodeSchema = z.enum([
  'sign_in',
  'credits_not_off',
  'caps_not_accepted',
  'not_eligible',
  'quota_exhausted',
  'wrong_path',
  'data_class_not_allowed',
  'task_class_not_allowed',
  'request_open',
  'cap_reached',
  'not_verified',
  'not_qualified',
  'grant',
  'chat_setting',
  'other',
]);
export type PlanRefusalCode = z.infer<typeof PlanRefusalCodeSchema>;
export const PlanRefusalSchema = z.strictObject({
  code: PlanRefusalCodeSchema,
  text: note,
  connection_id: id.optional(),
  model_id: short.optional(),
  task_class: PlanTaskClassSchema.optional(),
  data_class: DataClassSchema.optional(),
});
export type PlanRefusal = z.infer<typeof PlanRefusalSchema>;

export const PlanConnectionDetailSchema = z.strictObject({
  connection: PlanConnectionSchema,
  model_access: z.array(PlanModelAccessSchema),
  qualifications: z.array(PlanQualificationSchema),
  grants: z.array(PlanVerificationGrantSchema),
  usage: z.strictObject({
    last_24h_requests: counter,
    last_24h_codex_builds: counter,
    in_flight: counter,
    unresolved: counter,
  }),
  /** ADR-0064: in-flight or unknown requests, oldest first. */
  open_requests: z.array(PlanOpenRequestSchema),
  /**
   * P22 review L-6: the latest finished availability recheck per model and path. A recheck never
   * changes `model_access`, so this is where the page shows when one ran and how it ended.
   */
  last_rechecks: z.array(
    z.strictObject({
      model_id: short,
      path: PlanPathSchema,
      request_id: id,
      state: z.string().max(40),
      reason_code: short.nullable(),
      finished_at: timestamp,
    }),
  ),
  /** Every reason inference would be refused right now, in plain words. Empty means ready. */
  blockers: z.array(note),
  /** ADR-0087: the same refusals as `blockers`, in the same order, each with its code. */
  refusals: z.array(PlanRefusalSchema).optional(),
});
export type PlanConnectionDetail = z.infer<typeof PlanConnectionDetailSchema>;

/**
 * ADR-0081 (P21): the person's current plan connection and model in a workspace, set from the
 * picker beside the usage indicator. Forms start from it; a form may still choose another
 * route, and a run keeps the route recorded when it started. Version 0 means never chosen.
 */
export const ModelChoiceSchema = z.strictObject({
  workspace_id: id,
  connection_id: id.nullable(),
  model_id: short.nullable(),
  version: z.number().int().min(0),
  updated_at: timestamp.nullable(),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const SetModelChoiceRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  connection_id: id,
  model_id: short,
});

/** What a switch changed: the choice, and the chat setting when the owner's chat followed. */
export const ModelChoiceResultSchema = z.strictObject({
  choice: ModelChoiceSchema,
  /** True when the workspace's chat-answer setting now uses the same connection and model. */
  chat_updated: z.boolean(),
});
export type ModelChoiceResult = z.infer<typeof ModelChoiceResultSchema>;
