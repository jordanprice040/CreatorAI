import { join } from 'node:path';
import { frozenCases } from '@creator/domain';
import {
  z,
  AdmissionSchema,
  BrokerCallResultSchema,
  SpecBodySchema,
  StudyAttemptSchema,
  StudyImplementationSchema,
  ConditionSchema,
} from '@creator/contracts';
import {
  bindingSchema,
  checked,
  digest,
  id,
  hash,
  sha,
  type Binding,
  type CliCase as QaCase,
} from './contracts.js';
import {
  BuildSupervisor,
  buildOutcomeSchema,
  buildPlanSchema,
  type BuildPorts,
} from './build.js';
import { ExecutionSupervisor } from './execution.js';
import { ProductSupervisor } from './products.js';
import { casePassed } from './artifacts.js';
import { readJson } from './files.js';

/** Owner-side HTTP call to the management API (the CLI's `call`, or a test's). */
export type StudyCall = (
  path: string,
  body?: unknown,
  timeoutMs?: number,
) => Promise<unknown>;

/** GET /study-attempts/<id>/build: the server's prepared, pinned build for one attempt. */
export const StudyBuildStateSchema = z.strictObject({
  attempt: StudyAttemptSchema,
  run: z.strictObject({ state: z.string(), condition: ConditionSchema }),
  implementation: StudyImplementationSchema,
  binding: bindingSchema,
  spec: SpecBodySchema,
  plan: buildPlanSchema,
  request_hash: hash,
});
export type StudyBuildState = z.infer<typeof StudyBuildStateSchema>;

const base = (ws: string, attempt: string) =>
  `workspaces/${encodeURIComponent(ws)}/study-attempts/${encodeURIComponent(attempt)}`;

/**
 * Build ports for a study attempt. Every check re-reads the server's state: the attempt must
 * still be open, its run active and not human-only, and the pinned spec unchanged. Admission
 * and model calls go to the attempt's own workspace, so no other arm's records are reachable.
 */
export function studyBuildPorts(
  call: StudyCall,
  ws: string,
  attemptId: string,
): BuildPorts {
  const read = async () =>
    checked(StudyBuildStateSchema, await call(`${base(ws, attemptId)}/build`));
  return {
    current: async () => {
      const s = await read();
      return { binding: s.binding, spec: s.spec };
    },
    assertActive: async (runId) => {
      const s = await read();
      if (s.attempt.state !== 'assigned')
        throw new Error(
          `Study attempt is ${s.attempt.state}; the build stops and its evidence is kept`,
        );
      if (
        runId !== s.attempt.run_id ||
        s.run.state !== 'active' ||
        s.run.condition === 'human_only'
      )
        throw new Error(
          'An active non-human-only study run is required for this build',
        );
    },
    // ADR-0054 leaves frozen study conditions as they were: one admission per round.
    perRoundAdmission: true,
    authorize: async (plan) => {
      const s = await read();
      const admission = checked(
        AdmissionSchema,
        await call(
          `workspaces/${s.attempt.workspace_id}/runs/${plan.run_id}/actions`,
          {
            action_type: 'product.commit_build',
            task_id: null,
            target: { id: s.binding.spec_id, version: s.binding.spec_version },
            spec_hash: s.binding.spec_hash,
            amount_nano_usd: null,
            data_class: plan.data_class,
            assumption_ids: [],
            humility_review: plan.humility_review,
            flags: [],
            justification: `T15 study attempt ${attemptId}: scoped builder patch and isolated acceptance execution for the pinned frozen task`,
          },
        ),
      );
      if (admission.verdict !== 'allow')
        throw new Error(
          `Build admission ${admission.outcome}; decision ${admission.decision_id ?? 'none'}`,
        );
      return admission;
    },
    call: async (runId, request) => {
      const s = await read();
      return checked(
        BrokerCallResultSchema,
        await call(
          `workspaces/${s.attempt.workspace_id}/runs/${runId}/model-calls`,
          request,
          request.timeout_ms + 5000,
        ),
      );
    },
  };
}

/** Prepares, builds in a fresh per-attempt product, then asks the server to record the result. */
export async function runStudyBuild(
  builds: BuildSupervisor,
  call: StudyCall,
  ws: string,
  attemptId: string,
  onStarted: (buildId: string) => void = () => {},
) {
  const prepared = checked(
    StudyBuildStateSchema,
    await call(`${base(ws, attemptId)}/build`, {}),
  );
  const products = builds.products;
  const product = await products.create(prepared.binding);
  const task = await products.createTask(
    product.id,
    prepared.implementation.task_key,
    product.initial_commit,
    prepared.binding,
  );
  const outcome = await builds.run(
    product.id,
    task.id,
    product.initial_commit,
    prepared.plan,
    studyBuildPorts(call, ws, attemptId),
    onStarted,
  );
  const recorded = await call(`${base(ws, attemptId)}/build-record`, {
    product_id: product.id,
    build_id: outcome.id,
  });
  return { product_id: product.id, task_id: task.id, outcome, recorded };
}

export interface StudyCheck {
  check_key: string;
  held_out: boolean;
  passed: boolean;
  execution_id: string | null;
  backend: string | null;
}
const backendOf = (e: { environment: Record<string, unknown> }) =>
  typeof e.environment.backend === 'string' ? e.environment.backend : null;
/** Held-out cases leave this function as key and pass/fail only. */
const redact = (
  c: QaCase & { held_out: boolean },
  passed: boolean,
  execution: { id: string; environment: Record<string, unknown> } | null,
): StudyCheck => ({
  check_key: c.check_key,
  held_out: c.held_out,
  passed,
  execution_id: execution?.id ?? null,
  backend: execution ? backendOf(execution) : null,
});

/**
 * Re-reads a local build record for the server: intent, outcome, final review, executed QA and
 * the candidate's committed file hashes. Never trusts a caller-supplied summary.
 */
export async function readStudyBuild(
  products: ProductSupervisor,
  productId: string,
  buildId: string,
) {
  const dir = join(
    products.dir(checked(id, productId)),
    'builds',
    checked(id, buildId),
  );
  const intent = (await readJson(join(dir, 'intent.json'))) as {
    id: string;
    product_id: string;
    task_id: string;
    plan: unknown;
    spec: unknown;
  };
  const plan = checked(buildPlanSchema, intent.plan);
  const spec = checked(SpecBodySchema, intent.spec);
  const outcome = checked(
    buildOutcomeSchema,
    await readJson(join(dir, 'outcome.json')),
  );
  if (
    intent.id !== buildId ||
    outcome.id !== buildId ||
    outcome.product_id !== productId ||
    outcome.task_id !== intent.task_id ||
    outcome.plan_hash !== digest(JSON.stringify(intent.plan))
  )
    throw new Error('Build record binding mismatch');
  const task = await products.task(productId, outcome.task_id);
  const specTask = spec.tasks.find((t) => t.key === task.key);
  if (!specTask) throw new Error('Build task absent from its spec');
  const cases = frozenCases(spec, specTask.acceptance);
  const optional = async (name: string) => {
    try {
      return (await readJson(join(dir, name))) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const review = await optional(`review-${outcome.repairs}.json`);
  const checks: StudyCheck[] = [];
  for (const [index, c] of cases.entries()) {
    const qa = await optional(`qa-${outcome.repairs}-${index}.json`);
    if (!qa) continue;
    const execution = qa.execution as {
      id: string;
      environment: Record<string, unknown>;
    };
    checks.push(redact(c, qa.passed === true, execution));
  }
  const files =
    outcome.state === 'verified_candidate'
      ? (await products.committedFiles(productId, task.id, outcome.commit)).map(
          (f) => ({ path: f.path, sha256: digest(f.content) }),
        )
      : [];
  return {
    plan,
    outcome,
    task,
    review: review
      ? {
          verdict: String(review.verdict),
          findings: Array.isArray(review.findings) ? review.findings.length : 0,
        }
      : null,
    checks,
    files,
  };
}

/**
 * Runs every frozen case, held-out ones included, against a participant's committed task
 * candidate in the product worker. Only key and pass/fail of held-out cases are returned.
 */
export async function checkStudyCode(
  products: ProductSupervisor,
  executor: ExecutionSupervisor,
  binding: Binding,
  cases: (QaCase & { held_out: boolean })[],
  productId: string,
  taskId: string,
  commit: string,
) {
  checked(sha, commit);
  const p = await products.product(productId);
  products.assertBinding(p, binding);
  const files = (await products.committedFiles(productId, taskId, commit)).map(
    (f) => ({ path: f.path, sha256: digest(f.content) }),
  );
  const checks: StudyCheck[] = [];
  for (const c of cases) {
    const { held_out: _, ...qa } = c;
    const e = await executor.run(
      productId,
      taskId,
      commit,
      binding,
      () => {},
      qa,
    );
    checks.push(
      redact(
        c,
        e.commit === commit &&
          casePassed(e, qa) &&
          e.environment.acceptance_hash === digest(JSON.stringify(qa)),
        e,
      ),
    );
  }
  return { files, checks };
}
