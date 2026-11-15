import {
  z,
  id,
  version,
  timestamp,
  counter,
  nanoUsd,
  hash,
} from './primitives.js';
import { AutopilotOutcomeSchema, AutopilotStageSchema } from './autopilot.js';
import { AutopilotStopKindSchema } from './autopilot-settings.js';

// ADR-0120 (F7): two autopilots side by side, read from their records. Nothing here is a model
// call, a score of its own or a verdict: it puts what each autopilot recorded next to the
// other's, so a person can see where they differed. It is not a study result (ADR-0120 says
// why: one problem, one try each, no frozen conditions or held-out judging).

/** Shown on every comparison, on the page and in the answer. */
export const RUN_COMPARISON_LABEL =
  'A comparison of two runs, not a study result.' as const;

/** At most this many options per side; the rest are counted, not listed. */
export const RUN_COMPARISON_MAX_OPTIONS = 12;
/** At most this many build packages per side. */
export const RUN_COMPARISON_MAX_BUILDS = 10;

export const RunComparisonRequestSchema = z.strictObject({
  a: id,
  b: id,
});

const title = z.string().max(500);

export const RunComparisonSideSchema = z.strictObject({
  autopilot: z.strictObject({
    id,
    run_id: id,
    fixture: z.boolean(),
    state: z.enum(['running', 'finished']),
    stage: AutopilotStageSchema,
    outcome: AutopilotOutcomeSchema.nullable(),
    explanation: z.string().max(1200),
    config_hash: hash,
    policy_version: z.string().max(40),
    /** How the model steps ran: an API envelope, a signed-in plan, or a local model. */
    route: z.enum(['api', 'subscription', 'local']),
    /** Model ids the records name (the route's own and those its calls were charged to). */
    models: z.array(z.string().max(200)).max(10),
    /** Started from the beginning, or part way at a recorded problem. */
    started_at_stage: z.enum(['start', 'assess', 'select']),
  }),
  problem: z.strictObject({ id, version, title }).nullable(),
  evidence: z.strictObject({
    /** Whether it searched the web first, and what that search found and kept. */
    searched_web: z.boolean(),
    leads: counter,
    pages_read: counter,
    claims_proposed: counter,
    claims_admitted: counter,
    /** Claims linked to the problem now (they can change after the autopilot ends). */
    problem_supports: counter,
    problem_contradicts: counter,
  }),
  options: z.strictObject({
    /** `selection`: the scores as recorded with its choice. `current`: no choice was recorded,
     * so these are the problem's scores as they are now. `none`: it never reached scoring. */
    scores_from: z.enum(['selection', 'current', 'none']),
    count: counter,
    ranked: z
      .array(
        z.strictObject({
          id,
          title,
          kind: z.string().max(40),
          rank: counter.min(1).nullable(),
          score: z.string().max(10).nullable(),
          disposition: z.string().max(40).nullable(),
        }),
      )
      .max(RUN_COMPARISON_MAX_OPTIONS),
  }),
  /** Every step that stopped, with what it asked of a person, in order. */
  stops: z
    .array(
      z.strictObject({
        stage: AutopilotStageSchema,
        attempt: counter.min(1),
        kind: AutopilotStopKindSchema.nullable(),
        note: z.string().max(1200),
        decision_id: id.nullable(),
        at: timestamp,
      }),
    )
    .max(60),
  choice: z
    .strictObject({
      id,
      title,
      kind: z.string().max(40),
      disposition: z.string().max(40).nullable(),
      /** Who recorded the choice: the autopilot itself, or a person under Decide. */
      by: z.enum(['autopilot', 'person', 'unknown']),
      rationale: z.string().max(4000).nullable(),
    })
    .nullable(),
  proposal: z.strictObject({ id, version, title }).nullable(),
  builds: z
    .array(
      z.strictObject({
        id,
        state: z.enum(['verified', 'failed', 'blocked']),
        current: z.boolean(),
        created_at: timestamp,
      }),
    )
    .max(RUN_COMPARISON_MAX_BUILDS),
  requests: z.strictObject({
    /** Calls or plan requests the autopilot kept for its steps (its own count). */
    used: counter,
    limit: counter,
    /** What its workflows record: API attempts and plan requests. */
    model_attempts: counter,
    plan_requests: counter,
  }),
  /** Money its workflows recorded. Plan requests carry no per-call charge. */
  money: z.strictObject({
    reserved: nanoUsd,
    incurred: nanoUsd,
    unknown: nanoUsd,
  }),
  time: z.strictObject({
    started_at: timestamp,
    finished_at: timestamp.nullable(),
    /** From start to finish (or to now while it runs). */
    elapsed_seconds: counter,
    /** Time its steps were working; the rest it was stopped or waiting. */
    working_seconds: counter,
  }),
});
export type RunComparisonSide = z.infer<typeof RunComparisonSideSchema>;

export const RunComparisonSchema = z.strictObject({
  label: z.literal(RUN_COMPARISON_LABEL),
  workspace_id: id,
  /** Both autopilots worked on the same recorded problem. */
  same_problem: z.boolean(),
  /** Plain-words cautions about reading the two columns against each other. */
  cautions: z.array(z.string().max(300)).max(8),
  a: RunComparisonSideSchema,
  b: RunComparisonSideSchema,
  read_at: timestamp,
});
export type RunComparison = z.infer<typeof RunComparisonSchema>;

/** Why two columns may not be like for like, from their records only. */
export function comparisonCautions(
  a: RunComparisonSide,
  b: RunComparisonSide,
): string[] {
  const out: string[] = [];
  if (!a.problem || !b.problem || a.problem.id !== b.problem.id)
    out.push(
      'They worked on different problems (or one never reached a problem), so their options and choices are not like for like.',
    );
  if (a.autopilot.fixture !== b.autopilot.fixture)
    out.push('One ran on fixture data and the other did not.');
  if (a.autopilot.route !== b.autopilot.route)
    out.push(
      'They used different model routes, so money and requests are counted differently.',
    );
  if (a.autopilot.state === 'running' || b.autopilot.state === 'running')
    out.push('One is still running; its column will change.');
  if (a.requests.limit !== b.requests.limit)
    out.push(
      `They had different request limits (${a.requests.limit} and ${b.requests.limit}).`,
    );
  if (a.autopilot.started_at_stage !== b.autopilot.started_at_stage)
    out.push('They entered the path at different steps.');
  if (
    a.options.scores_from === 'current' ||
    b.options.scores_from === 'current'
  )
    out.push(
      'Where no choice was recorded, the scores shown are the problem’s scores now, not when the autopilot stopped.',
    );
  return out;
}
