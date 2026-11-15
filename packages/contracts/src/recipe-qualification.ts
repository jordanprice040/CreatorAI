import { z, id, hash, timestamp } from './primitives.js';
import { BuildRecipeSchema, type RecipeQualification } from './web-recipe.js';

/**
 * ADR-0105 (B1): building qualified in the app, per connection. A recipe qualification is three
 * live builds of one frozen benchmark on one connection, model and pair of role prompts, run by
 * the studio in its own qualification harness (no catalog run, selection or spec). Only a record
 * with all attempts passing lifts a web build's "unqualified trial" label, and only for builds on
 * that same connection, model and both prompts.
 *
 * The in-app benchmarks are their own frozen versions (owner decision, November 14, 2026): the
 * same task, spec, cases and reference as the November 6 versions they copy, with pass bars the
 * studio checks itself. Frozen files are never edited; a change is a new version.
 */
export const RECIPE_BENCHMARK_IDS = [
  'p15-small-signup-v5',
  'p14-small-wordtally-v5',
  'p14-larger-ledgercheck-v5',
  'p14-xl-v1',
] as const;
export const RecipeBenchmarkIdSchema = z.enum(RECIPE_BENCHMARK_IDS);
export type RecipeBenchmarkId = z.infer<typeof RecipeBenchmarkIdSchema>;

/** Build limits each attempt runs with; equal to the frozen expectations (a test checks). */
export interface RecipeBenchmarkCaps {
  max_repairs: number;
  max_calls: number;
  max_output_tokens: number;
  timeout_ms: number;
}
export interface RecipeBenchmarkInfo {
  id: RecipeBenchmarkId;
  recipe: z.infer<typeof BuildRecipeSchema>;
  scale: 'small' | 'larger';
  /** What the person reads on Qualify. */
  label: string;
  /** The November 6 version whose task this one copies; null for a task written new (ADR-0114). */
  copied_from: string | null;
  attempts: number;
  caps: RecipeBenchmarkCaps;
  /** Plan requests a passing attempt usually takes (one builder and one reviewer request). */
  typical_requests: number;
  /** Extended cases run on the exported package after the build (0 for the web benchmark). */
  extended_cases: number;
  /** How long one attempt's build may run before it stops (the build plan's deadline). */
  attempt_deadline_ms: number;
  /**
   * ADR-0114: the smallest per-request input cap Start accepts beyond the first builder request
   * (`firstBuilderInputFloor`); 0 when that request is the only floor.
   */
  min_input_chars: number;
}
/** ADR-0105: one attempt's build stops after an hour (the v5 benchmarks). */
export const RECIPE_ATTEMPT_DEADLINE_MS = 60 * 60_000;
export const RECIPE_BENCHMARK_INFO: Readonly<
  Record<RecipeBenchmarkId, RecipeBenchmarkInfo>
> = {
  'p15-small-signup-v5': {
    id: 'p15-small-signup-v5',
    recipe: 'static-web/1',
    scale: 'small',
    label: 'Web page: a sign-up form (one page, 10 browser checks)',
    copied_from: 'p15-small-signup-v4',
    attempts: 3,
    caps: {
      max_repairs: 1,
      max_calls: 4,
      max_output_tokens: 8000,
      timeout_ms: 120000,
    },
    typical_requests: 2,
    extended_cases: 0,

    attempt_deadline_ms: RECIPE_ATTEMPT_DEADLINE_MS,
    min_input_chars: 0,
  },
  'p14-small-wordtally-v5': {
    id: 'p14-small-wordtally-v5',
    recipe: 'python-build/1',
    scale: 'small',
    label: 'Python program, small: a word counter (one file, 18 checks)',
    copied_from: 'p14-small-wordtally-v2',
    attempts: 3,
    caps: {
      max_repairs: 1,
      max_calls: 4,
      max_output_tokens: 4000,
      timeout_ms: 120000,
    },
    typical_requests: 2,
    extended_cases: 8,

    attempt_deadline_ms: RECIPE_ATTEMPT_DEADLINE_MS,
    min_input_chars: 0,
  },
  'p14-larger-ledgercheck-v5': {
    id: 'p14-larger-ledgercheck-v5',
    recipe: 'python-build/1',
    scale: 'larger',
    label:
      'Python program, larger: a spending checker (5 files, 31 checks and a structure check)',
    copied_from: 'p14-larger-ledgercheck-v4',
    attempts: 3,
    caps: {
      max_repairs: 2,
      max_calls: 6,
      max_output_tokens: 12000,
      timeout_ms: 120000,
    },
    typical_requests: 2,
    extended_cases: 21,
    attempt_deadline_ms: RECIPE_ATTEMPT_DEADLINE_MS,
    min_input_chars: 0,
  },
  // ADR-0114: the extra-large benchmark B4 (ADR-0109) named, a new task rather than a copy. It
  // measures builder/2 answering a round in parts, at the owner caps of ADR-0109.
  'p14-xl-v1': {
    id: 'p14-xl-v1',
    recipe: 'python-build/1',
    scale: 'larger',
    label:
      'Python program, extra large: a stock and order simulator (13 files, 53 checks and a structure check)',
    copied_from: null,
    attempts: 3,
    caps: {
      max_repairs: 3,
      max_calls: 20,
      max_output_tokens: 16000,
      timeout_ms: 120000,
    },
    typical_requests: 4,
    extended_cases: 28,
    attempt_deadline_ms: 2 * 60 * 60_000,
    min_input_chars: 120_000,
  },
};

/**
 * The most plan requests one qualification can use: every attempt at its request limit, and
 * each attempt replaced once after an infrastructure fault (expectations: "each attempt may be
 * replaced at most once").
 */
export function recipeQualificationMaxRequests(info: RecipeBenchmarkInfo) {
  return info.attempts * 2 * info.caps.max_calls;
}

/** What Qualify offers (GET recipe-benchmarks): each benchmark and the current role prompts. */
export const RecipeBenchmarkOffersSchema = z.strictObject({
  benchmarks: z.array(
    z.strictObject({
      id: RecipeBenchmarkIdSchema,
      recipe: BuildRecipeSchema,
      scale: z.enum(['small', 'larger']),
      label: z.string(),
      copied_from: z.string().nullable(),
      attempts: z.number().int().min(1),
      caps: z.strictObject({
        max_repairs: z.number().int().min(0),
        max_calls: z.number().int().min(2),
        max_output_tokens: z.number().int().min(1),
        timeout_ms: z.number().int().min(1),
      }),
      typical_requests: z.number().int().min(0),
      extended_cases: z.number().int().min(0),
      attempt_deadline_ms: z.number().int().min(1),
      min_input_chars: z.number().int().min(0),
      /** recipeQualificationMaxRequests: the most one qualification can use. */
      max_requests: z.number().int().min(0),
      /** Why the frozen files may not run now; empty when they may. */
      freeze_problems: z.array(z.string()),
    }),
  ),
  /** The prompts a build records today; a record on other prompts does not lift the label. */
  role_prompts: z.strictObject({
    builder_prompt_sha256: hash,
    reviewer_prompt_sha256: hash,
  }),
});
export type RecipeBenchmarkOffers = z.infer<typeof RecipeBenchmarkOffersSchema>;

export const RecipeQualificationStateSchema = z.enum([
  'running',
  'qualified',
  'not_qualified',
  'stopped',
]);
export type RecipeQualificationState = z.infer<
  typeof RecipeQualificationStateSchema
>;
export const RecipeAttemptStateSchema = z.enum([
  'running',
  'passed',
  'failed',
  'invalid',
]);

/** One pass bar of the frozen expectations, as the studio checked it on one attempt. */
export const RecipePassBarSchema = z.strictObject({
  key: z.enum([
    'build_verified',
    'requests_within_cap',
    'package_verified',
    'extended_cases',
    'structure',
  ]),
  passed: z.boolean(),
  detail: z.string().max(600),
});
export type RecipePassBar = z.infer<typeof RecipePassBarSchema>;

export const RecipeAttemptResultSchema = z.strictObject({
  bars: z.array(RecipePassBarSchema).max(10),
  build_reason: z.string().max(4000).nullable(),
  /** The package the attempt produced, when it got that far. */
  manifest_sha256: hash.nullable(),
  archive_sha256: hash.nullable(),
  extended: z
    .strictObject({
      passed: z.number().int().min(0),
      total: z.number().int().min(0),
      failed: z.array(z.string().max(20)).max(50),
    })
    .nullable(),
  wall_ms: z.number().int().min(0).nullable(),
});
export type RecipeAttemptResult = z.infer<typeof RecipeAttemptResultSchema>;

export const RecipeAttemptSchema = z.strictObject({
  id,
  slot: z.number().int().min(1).max(10),
  /** Set on a replacement: the invalid attempt it replaces. */
  replaces: id.nullable(),
  state: RecipeAttemptStateSchema,
  reason: z.string().max(4000).nullable(),
  product_id: id.nullable(),
  build_id: id.nullable(),
  request_limit: z.number().int().min(2),
  /** Plan requests admitted for this attempt. */
  requests: z.number().int().min(0),
  repairs: z.number().int().min(0).nullable(),
  result: RecipeAttemptResultSchema.nullable(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type RecipeAttempt = z.infer<typeof RecipeAttemptSchema>;

export const RecipeQualificationRecordSchema = z.strictObject({
  id,
  workspace_id: id,
  connection_id: id,
  recipe: BuildRecipeSchema,
  benchmark_id: z.string().min(1).max(80),
  model_id: z.string().min(1).max(200),
  builder_prompt_sha256: hash,
  reviewer_prompt_sha256: hash,
  /** SHA-256 of the benchmark's FREEZE.json when it started. */
  freeze_sha256: hash,
  /**
   * Third review L-1 and review 4 N-1: the connection's per-request input cap recorded at Start,
   * which the pass and no-verdict rules read; null on an imported record.
   */
  max_input_chars: z.number().int().min(1).nullable(),
  /** `imported`: a pass recorded before the studio could run these (the November 6 one). */
  source: z.enum(['in_app', 'imported']),
  /** Run on a fixture connection: says nothing about a real model. */
  fixture: z.boolean(),
  state: RecipeQualificationStateSchema,
  attempts_needed: z.number().int().min(1).max(10),
  passed: z.number().int().min(0),
  reason: z.string().max(4000).nullable(),
  /** Where the evidence of an imported record lives (a path in the repository). */
  evidence: z.string().max(300).nullable(),
  attempts: z.array(RecipeAttemptSchema),
  /** True while this studio process works on it. */
  executing: z.boolean(),
  version: z.number().int().min(1),
  created_by: id,
  created_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type RecipeQualificationRecord = z.infer<
  typeof RecipeQualificationRecordSchema
>;
export const RecipeQualificationListSchema = z.array(
  RecipeQualificationRecordSchema,
);

export const StartRecipeQualificationRequestSchema = z.strictObject({
  benchmark_id: RecipeBenchmarkIdSchema,
  model_id: z.string().trim().min(1).max(200),
});
/**
 * Review 1 L-3: Stop needs no version. A running qualification's version moves at every attempt,
 * and Stop has no edit to protect; the state check makes it idempotent. A version sent by an older
 * page is accepted and ignored.
 */
export const StopRecipeQualificationRequestSchema = z.strictObject({
  expected_version: z.number().int().min(1).optional(),
});

/** A qualified record in the shape `unqualifiedTrial` matches builds against. */
export function recipePasses(
  records: readonly RecipeQualificationRecord[],
): RecipeQualification[] {
  return records
    .filter((r) => r.state === 'qualified' && !r.fixture)
    .map((r) => ({
      recipe: r.recipe,
      benchmark_id: r.benchmark_id,
      connection_id: r.connection_id,
      model_id: r.model_id,
      builder_prompt_sha256: r.builder_prompt_sha256,
      reviewer_prompt_sha256: r.reviewer_prompt_sha256,
    }));
}
