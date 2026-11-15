import {
  RECIPE_BENCHMARKS,
  isQualified,
  recipePasses,
  unqualifiedTrial,
  type PlanQualification,
  type RecipeAttempt,
  type RecipeBenchmarkOffers,
  type RecipeQualificationRecord,
} from '@creator/contracts';

// ADR-0105 (B1): the rules behind "Qualify building" on Models and the build qualification note
// on Build. The server decides every start and every request; these only explain them first.

export type RecipeOffer = RecipeBenchmarkOffers['benchmarks'][number];
export type RolePrompts = RecipeBenchmarkOffers['role_prompts'];

/** The newest record of a model on a benchmark, in the order the server lists them. */
export function latestRecord(
  records: readonly RecipeQualificationRecord[],
  model: string,
  benchmark: string,
): RecipeQualificationRecord | null {
  return (
    records
      .filter((r) => r.model_id === model && r.benchmark_id === benchmark)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/** Whether a record is for the prompts a build records today. */
export const onCurrentPrompts = (
  r: Pick<
    RecipeQualificationRecord,
    'builder_prompt_sha256' | 'reviewer_prompt_sha256'
  >,
  prompts: RolePrompts,
) =>
  r.builder_prompt_sha256 === prompts.builder_prompt_sha256 &&
  r.reviewer_prompt_sha256 === prompts.reviewer_prompt_sha256;

/**
 * Why a build qualification can't start now, in the server's words (startRecipeQualification):
 * the connection allows both roles and synthetic data, the model is verified and qualified for
 * both roles under their current prompts, the benchmark's freeze is intact, and nothing else is
 * running on the connection. Empty when it may start.
 */
export function startBlockers(input: {
  allowedTasks: readonly string[];
  allowedData: readonly string[];
  verified: readonly string[];
  qualifications: readonly PlanQualification[];
  records: readonly RecipeQualificationRecord[];
  model: string;
  offer: RecipeOffer;
}): string[] {
  const { model } = input;
  const out: string[] = [];
  if (!input.allowedTasks.includes('patch_build'))
    out.push("This connection doesn't allow the builder (patch_build).");
  if (!input.allowedTasks.includes('independent_review'))
    out.push(
      "This connection doesn't allow the reviewer (independent_review).",
    );
  if (!input.allowedData.includes('synthetic'))
    out.push(
      "This connection doesn't allow synthetic data, which the benchmarks use.",
    );
  if (!model || !input.verified.includes(model))
    out.push('Verify a model above first.');
  else {
    if (!isQualified(input.qualifications, model, 'patch_build'))
      out.push(
        `${model} isn't qualified as the builder yet: qualify it with t12-builder-v3 above.`,
      );
    if (!isQualified(input.qualifications, model, 'independent_review'))
      out.push(
        `${model} isn't qualified as the reviewer yet: qualify it with t12-reviewer-v3 above.`,
      );
  }
  if (input.offer.freeze_problems.length)
    out.push(
      `This benchmark can't run: ${input.offer.freeze_problems.join('; ')}.`,
    );
  if (input.records.some((r) => r.state === 'running'))
    out.push('A build qualification is already running on this connection.');
  return out;
}

/** What Start commits to, in plain words, before the person confirms it. */
export function startPacket(
  offer: RecipeOffer,
  model: string,
  fixture: boolean,
): string[] {
  const c = offer.caps;
  return [
    `${offer.attempts} builds of the frozen benchmark "${offer.label}" with ${model} as builder and reviewer. Every attempt must pass for the model to qualify; the first failed attempt ends it early.`,
    `Each build usually takes ${offer.typical_requests} plan requests and may take up to ${c.max_calls} (${c.max_repairs} repair round${c.max_repairs === 1 ? '' : 's'}). An attempt stopped by a sign-in, limit or outage is replaced once, so the most it can use is ${offer.max_requests} requests.`,
    fixture
      ? 'This is a fixture connection: the record is labelled fixture and says nothing about a real model.'
      : 'Plan requests are $0 on the plan and count against this connection’s daily cap. The data is synthetic.',
    `Pass bars: the build verifies (every frozen check passes and the reviewer approves) within ${c.max_calls} requests, and the exported package passes them again${offer.extended_cases ? `, plus ${offer.extended_cases} extended cases` : ''}${offer.scale === 'larger' ? ' and a structure check' : ''}.`,
    'It runs in the background on this computer, and you can leave the page. Stop ends it after the request in progress answers or reaches its time limit (at most 2 minutes); nothing more is sent.',
    'Keep other work off this connection until it ends (chat, the autopilot, model checks): the connection takes one request at a time, so a role request waits for another one, up to 4 minutes, and a longer wait ends the attempt without a verdict.',
  ];
}

const STATE_WORDS: Record<RecipeQualificationRecord['state'], string> = {
  running: 'running',
  qualified: 'qualified',
  not_qualified: 'not qualified',
  stopped: 'stopped',
};
const ATTEMPT_WORDS: Record<RecipeAttempt['state'], string> = {
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  invalid: 'no verdict',
};

/** One record's line: what ran, where it stands and when. */
export function recordLine(
  r: RecipeQualificationRecord,
  prompts: RolePrompts | null,
): string {
  const when = (r.finished_at ?? r.created_at).slice(0, 16).replace('T', ' ');
  const parts = [
    `${r.benchmark_id} on ${r.model_id}: ${STATE_WORDS[r.state]}`,
    r.state === 'running'
      ? `${r.passed} of ${r.attempts_needed} passed so far`
      : `${r.passed} of ${r.attempts_needed} attempts passed`,
    r.source === 'imported'
      ? `recorded before the app could run it (${when} UTC)`
      : `${when} UTC`,
  ];
  if (r.max_input_chars != null)
    parts.push(`input cap ${r.max_input_chars} characters`);
  if (r.fixture) parts.push('fixture, not evidence about a real model');
  // Review N-3 (ADR-0112): only a benchmark that can lift a label says it no longer does.
  if (
    prompts &&
    r.state === 'qualified' &&
    !onCurrentPrompts(r, prompts) &&
    (RECIPE_BENCHMARKS[r.recipe] ?? []).includes(r.benchmark_id)
  )
    parts.push('on older role prompts, so it no longer lifts the trial label');
  return parts.join(' · ');
}

/** One attempt's line. */
export function attemptLine(a: RecipeAttempt): string {
  const bits = [
    `Attempt ${a.slot}${a.replaces ? ' (replacement)' : ''}: ${ATTEMPT_WORDS[a.state]}`,
    `${a.requests} of ${a.request_limit} requests`,
  ];
  if (a.repairs != null)
    bits.push(`${a.repairs} repair round${a.repairs === 1 ? '' : 's'}`);
  if (a.result?.extended)
    bits.push(
      `extended ${a.result.extended.passed} of ${a.result.extended.total}`,
    );
  if (a.state !== 'running' && a.state !== 'passed' && a.reason)
    bits.push(a.reason);
  return bits.join(' · ');
}

/**
 * The Build page's note for a static web build on these roles: whether its package will be a
 * qualified build or an unqualified trial, and what would change it.
 */
export function webBuildNote(
  records: readonly RecipeQualificationRecord[],
  roles: { connection_id: string; model_id: string },
  prompts: RolePrompts | null,
): { qualified: boolean; text: string } {
  if (prompts) {
    const passes = recipePasses(records);
    if (!unqualifiedTrial('static-web/1', { ...roles, ...prompts }, passes)) {
      const r = records.find(
        (x) =>
          x.state === 'qualified' &&
          !x.fixture &&
          x.recipe === 'static-web/1' &&
          x.model_id === roles.model_id &&
          onCurrentPrompts(x, prompts),
      );
      return {
        qualified: true,
        text: `Web builds here are qualified: ${roles.model_id} passed ${r?.benchmark_id ?? 'the web benchmark'} on this connection with today's role prompts.`,
      };
    }
  }
  const running = records.find(
    (x) =>
      x.state === 'running' &&
      x.recipe === 'static-web/1' &&
      x.model_id === roles.model_id,
  );
  return {
    qualified: false,
    text: running
      ? `A web build qualification of ${roles.model_id} is running on this connection (${running.passed} of ${running.attempts_needed} passed so far); until it qualifies, web packages are unqualified trials.`
      : `Web packages built with ${roles.model_id} here are unqualified trials. Qualify building under Models and connections to lift the label.`,
  };
}

/** ADR-0112: whether larger Python packages built with these roles are qualified. */
export function largerPythonQualified(
  records: readonly RecipeQualificationRecord[],
  roles: { connection_id: string; model_id: string },
  prompts: RolePrompts | null,
): boolean {
  return (
    !!prompts &&
    !unqualifiedTrial(
      'python-build/1',
      { ...roles, ...prompts },
      recipePasses(records),
      'larger',
    )
  );
}

/**
 * ADR-0112 (review L-2): the Build page's note for a Python build whose package may be an
 * unqualified trial; null when it cannot be. `cases` is the task's frozen case count: more than 10
 * makes the package larger whatever files it has, otherwise only more than one Python file does.
 */
export function pythonBuildNote(
  route:
    | { kind: 'roles'; model_id: string; qualified: boolean }
    | { kind: 'codex' | 'broker' },
  cases: number,
): string | null {
  if (route.kind === 'roles' && route.qualified) return null;
  const when =
    cases > 10
      ? `This task froze ${cases} cases, so its package will be an unqualified trial`
      : 'If the package has more than one Python file, it will be labelled an unqualified trial';
  return route.kind === 'roles'
    ? `${when}: ${route.model_id} has not passed p14-larger-ledgercheck-v5 on this connection with today's role prompts. Qualify building under Models and connections to lift the label.`
    : `${when}: this route (${route.kind === 'codex' ? 'the Codex builder' : 'the pay-per-use broker'}) has no build qualification, so the label cannot be lifted here.`;
}
