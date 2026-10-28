import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_ROLE_TASK_CLASSES,
  frozenCases,
  taskHashes,
} from '@creator/domain';
import {
  z,
  SpecBodySchema,
  BrokerCallResultSchema,
  type BrokerCallRequest,
  type BrokerCallResult,
  type SpecBody,
} from '@creator/contracts';
import {
  checked,
  digest,
  id,
  hash,
  sha,
  changesSchema,
  qaCaseSchema,
  type Binding,
  type Execution,
  type QaCase,
} from './contracts.js';
import { ProductSupervisor } from './products.js';
import { ExecutionSupervisor } from './execution.js';
import { canonical, fileAt, jsonWrite, readJson, withLock } from './files.js';
import { git, head, clean, safeTree } from './git.js';

export const buildPlanSchema = z.strictObject({
  format: z.literal('build-plan/1'),
  run_id: id,
  envelope_id: id,
  pricing_snapshot_id: id,
  humility_review: z.strictObject({ id, version: z.number().int().positive() }),
  data_class: z.enum(['synthetic', 'public', 'private_approved']),
  max_repairs: z.number().int().min(0).max(2),
  max_calls: z.number().int().min(2).max(6),
  // Up to 120 s only on the plan route (plan_roles); broker builds keep the 60 s bound.
  timeout_ms: z.number().int().min(100).max(120000),
  max_output_tokens: z.number().int().min(100).max(16000),
  deadline: z.iso.datetime(),
  cases: z.array(qaCaseSchema).min(1).max(10),
  // ADR-0042: present means the ChatGPT-plan Codex builder on that connection; absent means
  // the broker builder, so existing plan hashes are unchanged.
  codex_plan_builder: z
    .strictObject({ connection_id: id, model_id: z.string().min(1).max(120) })
    .optional(),
  // ADR-0048: present means builder and reviewer are fresh direct requests on that ChatGPT-plan
  // connection (no dollar broker); absent leaves existing plan hashes and the broker path as is.
  plan_roles: z
    .strictObject({ connection_id: id, model_id: z.string().min(1).max(120) })
    .optional(),
});
export type BuildPlan = z.infer<typeof buildPlanSchema>;
export const builderSchema = z.strictObject({
  summary: z.string().max(2000),
  submission: changesSchema.nullable(),
  blocker: z.string().max(2000).nullable(),
});
export const reviewSchema = z.strictObject({
  candidate: sha,
  spec_hash: hash,
  task_hash: hash,
  verdict: z.enum(['approve', 'changes_requested', 'blocked']),
  findings: z.array(z.string().min(1).max(2000)).max(20),
});
export const buildOutcomeSchema = z.strictObject({
  id,
  product_id: id,
  task_id: id,
  plan_hash: hash,
  spec_hash: hash,
  commit: sha,
  state: z.enum(['verified_candidate', 'checkpoint']),
  reason: z.string().max(4000),
  calls: z.number().int(),
  repairs: z.number().int(),
  fixture: z.boolean(),
  finished_at: z.iso.datetime(),
});
export type BuildOutcome = z.infer<typeof buildOutcomeSchema>;

/** Trusted owner-side ports. Models receive packets only; never these capabilities. */
export interface BuildPorts {
  current(): Promise<{ binding: Binding; spec: SpecBody }>;
  assertActive(runId: string): Promise<void>;
  authorize(plan: BuildPlan): Promise<unknown>;
  call(runId: string, request: BrokerCallRequest): Promise<BrokerCallResult>;
  /** ChatGPT-plan Codex builder (ADR-0042). Review and QA still use the paths above. */
  codexBuilder?(
    target: {
      connection_id: string;
      model_id: string;
      build_id: string;
      run_id: string;
      data_class: BuildPlan['data_class'];
    },
    packet: {
      candidate: string;
      files: { path: string; hash: string; content: string }[];
      task: { file_scope: string[] };
      [k: string]: unknown;
    },
  ): Promise<unknown>;
  /** One fresh plan Responses request for a build role (ADR-0048); the studio admits it. */
  planRole?(
    target: {
      connection_id: string;
      model_id: string;
      build_id: string;
      run_id: string;
      data_class: BuildPlan['data_class'];
      role: keyof typeof BUILD_ROLE_PROMPTS;
    },
    request: {
      input: string;
      timeout_ms: number;
      logical_operation_id: string;
    },
  ): Promise<PlanRoleResult>;
  /** Why the plan roles would be refused now (empty: both admissible); sends nothing. */
  planRolesReady?(target: {
    connection_id: string;
    model_id: string;
    run_id: string;
    data_class: BuildPlan['data_class'];
  }): Promise<string[]>;
}
export const planRoleResultSchema = z.strictObject({
  request_id: z.string().max(80),
  status: z.enum(['succeeded', 'failed']),
  reason_code: z.string().max(200),
  text: z.string().nullable(),
  fixture: z.boolean(),
});
export type PlanRoleResult = z.infer<typeof planRoleResultSchema>;
const PROMPTS = BUILD_ROLE_PROMPTS;

/** One QA case passed: this exact commit ran to completion with the frozen output and exit. */
export function qaPassed(execution: Execution, commit: string, c: QaCase) {
  return (
    execution.commit === commit &&
    ['succeeded', 'failed'].includes(execution.state) &&
    execution.reason === null &&
    execution.exit_code === c.exit_code &&
    execution.log === c.stdout &&
    execution.environment.acceptance_hash === digest(JSON.stringify(c))
  );
}

/** Finite local task runner. A crash leaves immutable intent/checkpoints; never redispatch on read. */
export class BuildSupervisor {
  constructor(
    readonly products: ProductSupervisor,
    readonly executor: ExecutionSupervisor,
  ) {}
  private dir(product: string, build: string) {
    return join(this.products.dir(product), 'builds', checked(id, build));
  }
  async status(
    product: string,
    build: string,
    ports: BuildPorts,
  ): Promise<BuildOutcome> {
    const { binding } = await ports.current();
    this.products.assertBinding(await this.products.product(product), binding);
    const dir = this.dir(product, build);
    const intent = (await readJson(join(dir, 'intent.json'))) as {
      task_id: string;
      plan: BuildPlan;
    };
    const result = checked(
      buildOutcomeSchema,
      await readJson(join(dir, 'outcome.json')),
    );
    if (
      result.id !== build ||
      result.product_id !== product ||
      result.task_id !== intent.task_id ||
      result.plan_hash !== digest(JSON.stringify(intent.plan)) ||
      result.spec_hash !== binding.spec_hash
    )
      throw new Error('Build record binding mismatch');
    await ports.assertActive(intent.plan.run_id);
    const tree = this.products.worktree(product, result.task_id);
    await safeTree(tree);
    await clean(tree);
    if ((await head(tree)) !== result.commit)
      throw new Error('Changed candidate invalidates review and QA');
    return result;
  }
  async run(
    product: string,
    taskId: string,
    expected: string,
    raw: unknown,
    ports: BuildPorts,
    onStarted: (buildId: string) => void = () => {},
  ): Promise<BuildOutcome> {
    const plan = checked(buildPlanSchema, raw);
    checked(sha, expected);
    if (plan.plan_roles && plan.codex_plan_builder)
      throw new Error(
        'A build uses the plan roles or the Codex builder, not both',
      );
    if (!plan.plan_roles && plan.timeout_ms > 60000)
      throw new Error('Broker builds allow at most a 60 s call timeout');
    const p = await this.products.product(product);
    const task = await this.products.task(product, taskId);
    // Separate lock from Git mutations and worker lease; excludes concurrent builds of this product.
    const builds = join(this.products.dir(product), 'builds');
    await canonical(builds, true);
    await mkdir(builds, { recursive: true });
    return withLock(builds, async () => {
      const buildId = randomUUID(),
        dir = this.dir(product, buildId);
      let commit = expected,
        calls = 0,
        repairs = 0,
        fixture = false;
      const active = async () => {
        if (Date.now() >= Date.parse(plan.deadline))
          throw new Error('Build deadline reached');
        await ports.assertActive(plan.run_id);
        const current = await ports.current();
        this.products.assertBinding(p, current.binding);
        return checked(SpecBodySchema, current.spec);
      };
      const spec = await active();
      const assigned = spec.tasks.find((t) => t.key === task.key);
      if (
        !assigned ||
        assigned.role !== 'builder' ||
        assigned.depends_on.length
      )
        throw new Error(
          'Reviewed Python builder requires an independent builder task; dependency integration is not supported',
        );
      const acceptance = spec.acceptance_checks.filter((a) =>
        assigned.acceptance.includes(a.key),
      );
      if (
        !acceptance.length ||
        acceptance.some((a) => a.method !== 'automated_test' || !a.cases)
      )
        throw new Error(
          'QA plan must cover every assigned automated acceptance check with cases frozen in the spec; browser/manual/metric checks require another recipe',
        );
      // The executable cases are part of the frozen task hash; a build cannot choose its own.
      const frozen = frozenCases(spec, assigned.acceptance);
      if (
        JSON.stringify(frozen.map(({ held_out: _, ...c }) => c)) !==
        JSON.stringify(plan.cases)
      )
        throw new Error(
          'QA plan cases must equal the cases frozen in the spec for this task',
        );
      if (!frozen.some((c) => c.held_out))
        throw new Error(
          'The frozen task needs at least one held-out case that no role sees',
        );
      const heldOut = (index: number) => frozen[index]!.held_out;
      if (
        JSON.stringify(assigned.file_scope) !== JSON.stringify(task.file_scope)
      )
        throw new Error('Task scope mismatch');
      if (taskHashes(spec)[assigned.key] !== task.spec_task_hash)
        throw new Error('Frozen task hash mismatch');
      const classification = { synthetic: 0, public: 1, private_approved: 2 };
      if (
        spec.data_contracts.some(
          (c) => classification[c.data_class] > classification[plan.data_class],
        )
      )
        throw new Error(
          'Build data classification does not cover frozen data contracts',
        );
      const tree = this.products.worktree(product, taskId);
      await safeTree(tree);
      await clean(tree);
      if ((await head(tree)) !== expected)
        throw new Error('Stale build candidate');
      await mkdir(dir);
      await jsonWrite(join(dir, 'intent.json'), {
        id: buildId,
        product_id: product,
        task_id: taskId,
        binding: p.binding,
        plan,
        expected,
        spec,
        prompts: PROMPTS,
        prompt_hash: digest(JSON.stringify(PROMPTS)),
        started_at: new Date().toISOString(),
      });
      onStarted(buildId);
      const packet = {
        format: 'build-task/1',
        spec_hash: p.binding.spec_hash,
        task_hash: task.spec_task_hash,
        spec_id: p.binding.spec_id,
        spec_version: p.binding.spec_version,
        task_id: taskId,
        run_id: plan.run_id,
        allowed_tools: ['scoped CAS patch submission'],
        limits: {
          max_calls: plan.max_calls,
          max_repairs: plan.max_repairs,
          deadline: plan.deadline,
          max_output_tokens: plan.max_output_tokens,
        },
        audience: spec.audience,
        problem: spec.problem_statement,
        non_goals: spec.non_goals,
        scope: spec.scope,
        data_contracts: spec.data_contracts,
        risks: spec.risks,
        maintenance: spec.maintenance,
        flows: spec.user_flows.filter((f) =>
          acceptance.some((a) => a.flow === f.key),
        ),
        task: assigned,
        // Expected outputs of held-out cases never enter a role packet.
        acceptance: acceptance.map(({ cases: _, ...a }) => a),
        cases: plan.cases.filter((_, i) => !heldOut(i)),
        held_out_cases: plan.cases.filter((_, i) => heldOut(i)).length,
      };
      const files = async () => {
        await safeTree(tree);
        await clean(tree);
        if ((await head(tree)) !== commit)
          throw new Error('Changed candidate during build');
        const names = (
          await git(tree, ['ls-tree', '-r', '--name-only', commit])
        )
          .split('\n')
          .filter(Boolean);
        const map: { path: string; hash: string; content: string }[] = [];
        for (const name of names) {
          const content = await readFile(await fileAt(tree, name), 'utf8');
          map.push({ path: name, hash: digest(content), content });
        }
        if (Buffer.byteLength(JSON.stringify(map)) > 14000)
          throw new Error(
            'Task file context exceeds bounded packet; narrow task',
          );
        return map;
      };
      const invoke = async (role: keyof typeof PROMPTS, data: unknown) => {
        await active();
        if (calls >= plan.max_calls) throw new Error('Build call cap reached');
        if (Date.parse(plan.deadline) - Date.now() < 100)
          throw new Error('Build deadline reached');
        const text = JSON.stringify(data);
        if (text.length > 20000)
          throw new Error('Role context exceeds bounded packet');
        const request: BrokerCallRequest = {
          envelope_id: plan.envelope_id,
          pricing_snapshot_id: plan.pricing_snapshot_id,
          action_type: 'model.generate',
          task_id: null,
          logical_operation_id: randomUUID(),
          data_class: plan.data_class,
          input: [
            { role: 'system', text: PROMPTS[role] },
            { role: 'user', text },
          ],
          max_output_tokens: plan.max_output_tokens,
          output_format: 'json',
          tool: null,
          max_attempts: 1,
          timeout_ms: Math.min(
            plan.timeout_ms,
            Math.max(100, Date.parse(plan.deadline) - Date.now()),
          ),
          justification: `T12 ${role} ${buildId} task ${taskId}`,
        };
        calls++;
        if (plan.plan_roles) {
          if (!ports.planRole)
            throw new Error('Plan role route is not configured');
          const call = {
            input: text,
            timeout_ms: request.timeout_ms,
            logical_operation_id: request.logical_operation_id,
          };
          await jsonWrite(join(dir, `call-${calls}-intent.json`), {
            role,
            route: 'chatgpt_plan_responses',
            target: plan.plan_roles,
            task_class: BUILD_ROLE_TASK_CLASSES[role],
            instructions: PROMPTS[role],
            logical_operation_id: call.logical_operation_id,
            timeout_ms: call.timeout_ms,
            context_hash: digest(text),
          });
          const r = checked(
            planRoleResultSchema,
            await ports.planRole(
              {
                ...plan.plan_roles,
                build_id: buildId,
                run_id: plan.run_id,
                data_class: plan.data_class,
                role,
              },
              call,
            ),
          );
          await jsonWrite(join(dir, `call-${calls}-outcome.json`), r);
          fixture ||= r.fixture;
          await active();
          if (r.status !== 'succeeded' || r.text === null)
            throw new Error(`Role stopped: ${r.status} ${r.reason_code}`);
          return JSON.parse(r.text) as unknown;
        }
        await jsonWrite(join(dir, `call-${calls}-intent.json`), {
          role,
          request,
          context_hash: digest(text),
        });
        const result = checked(
          BrokerCallResultSchema,
          await ports.call(plan.run_id, request),
        );
        await jsonWrite(join(dir, `call-${calls}-outcome.json`), result);
        fixture ||= result.fixture;
        await active();
        if (result.status !== 'succeeded' || !result.output)
          throw new Error(
            `Role stopped: ${result.status} ${result.reason_code}`,
          );
        return result.output.json ?? JSON.parse(result.output.text);
      };
      let feedback: unknown = null;
      try {
        if (plan.plan_roles) {
          // Both roles must be admissible before the grant is used or the builder is sent.
          if (!ports.planRole || !ports.planRolesReady)
            throw new Error('Plan role route is not configured');
          const blockers = await ports.planRolesReady({
            ...plan.plan_roles,
            run_id: plan.run_id,
            data_class: plan.data_class,
          });
          await jsonWrite(join(dir, 'plan-roles-preflight.json'), { blockers });
          if (blockers.length)
            throw new Error(`Plan roles are not ready: ${blockers.join(' ')}`);
        }
        for (let cycle = 0; cycle <= plan.max_repairs; cycle++) {
          repairs = cycle;
          await active();
          await jsonWrite(
            join(dir, `admission-${cycle}.json`),
            await ports.authorize(plan),
          );
          await active();
          const builderPacket = {
            ...packet,
            candidate: commit,
            files: await files(),
            feedback,
          };
          let built: z.infer<typeof builderSchema>;
          if (plan.codex_plan_builder) {
            if (!ports.codexBuilder)
              throw new Error('Codex plan builder is not configured');
            await jsonWrite(join(dir, `codex-${cycle}-intent.json`), {
              candidate: commit,
              context_hash: digest(JSON.stringify(builderPacket)),
            });
            built = checked(
              builderSchema,
              await ports.codexBuilder(
                {
                  ...plan.codex_plan_builder,
                  build_id: buildId,
                  run_id: plan.run_id,
                  data_class: plan.data_class,
                },
                {
                  ...builderPacket,
                  allowed_tools: ['apply_patch in the task workspace'],
                },
              ),
            );
            await jsonWrite(join(dir, `codex-${cycle}-outcome.json`), built);
            await active();
          } else
            built = checked(
              builderSchema,
              await invoke('builder', builderPacket),
            );
          if (!built.submission)
            throw new Error(
              `Builder blocked: ${built.blocker ?? 'no submitted patch'}`,
            );
          if (built.submission.expected_commit !== commit)
            throw new Error('Builder submitted stale commit');
          await active();
          const submitted = await this.products.apply(
            product,
            taskId,
            built.submission,
            p.binding,
          );
          commit = submitted.commit;
          await jsonWrite(join(dir, `candidate-${cycle}.json`), submitted);
          // Deliberately excludes builder summaries, prior reviews and QA results.
          const review = checked(
            reviewSchema,
            await invoke('reviewer', {
              ...packet,
              candidate: commit,
              files: await files(),
              diff: await git(tree, [
                'diff',
                '--no-ext-diff',
                '--no-textconv',
                `${task.base_commit}..${commit}`,
                '--',
              ]),
            }),
          );
          if (
            review.candidate !== commit ||
            review.spec_hash !== p.binding.spec_hash ||
            review.task_hash !== task.spec_task_hash
          )
            throw new Error(
              'Review is not bound to the candidate and frozen task',
            );
          await jsonWrite(join(dir, `review-${cycle}.json`), review);
          const checks: unknown[] = [];
          let passed = true;
          for (const [index, c] of plan.cases.entries()) {
            await active();
            let executionId: string | null = null,
              stopping = false;
            const monitor = setInterval(() => {
              if (stopping || !executionId) return;
              stopping = true;
              active()
                .catch(() =>
                  this.executor.cancel(
                    product,
                    executionId!,
                    p.binding.owner_id,
                  ),
                )
                .catch(() => {})
                .finally(() => {
                  stopping = false;
                });
            }, 500);
            let execution;
            try {
              execution = await this.executor.run(
                product,
                taskId,
                commit,
                p.binding,
                (value) => {
                  executionId = value;
                },
                c,
              );
            } finally {
              clearInterval(monitor);
              while (stopping) await new Promise((r) => setTimeout(r, 10));
            }
            const ok = qaPassed(execution, commit, c);
            // Repair feedback names a failed held-out case but not its inputs or expected output.
            checks.push({
              check: heldOut(index)
                ? { check_key: c.check_key, held_out: true }
                : c,
              execution_id: execution.id,
              passed: ok,
            });
            passed &&= ok;
            await jsonWrite(join(dir, `qa-${cycle}-${index}.json`), {
              command: ['/usr/bin/python3', '-I', 'src/main.py', ...c.args],
              check: c,
              execution,
              passed: ok,
            });
            await active();
          }
          await files();
          await active();
          if (
            passed &&
            review.verdict === 'approve' &&
            review.findings.length === 0
          ) {
            const result: BuildOutcome = {
              id: buildId,
              product_id: product,
              task_id: taskId,
              plan_hash: digest(JSON.stringify(plan)),
              spec_hash: p.binding.spec_hash,
              commit,
              state: 'verified_candidate',
              reason:
                'Fresh review and executed acceptance cases passed for this exact task candidate',
              calls,
              repairs,
              fixture,
              finished_at: new Date().toISOString(),
            };
            await jsonWrite(join(dir, 'outcome.json'), result);
            return result;
          }
          feedback = { review, checks };
          if (review.verdict === 'blocked')
            throw new Error('Reviewer blocked candidate');
        }
        throw new Error(
          'Repair limit reached; partial commits and evidence preserved',
        );
      } catch (e) {
        const result: BuildOutcome = {
          id: buildId,
          product_id: product,
          task_id: taskId,
          plan_hash: digest(JSON.stringify(plan)),
          spec_hash: p.binding.spec_hash,
          commit,
          state: 'checkpoint',
          reason: String(e).slice(0, 4000),
          calls,
          repairs,
          fixture,
          finished_at: new Date().toISOString(),
        };
        await jsonWrite(join(dir, 'outcome.json'), result);
        return result;
      }
    });
  }
  async list(product: string): Promise<string[]> {
    try {
      return (await readdir(join(this.products.dir(product), 'builds'))).filter(
        (n) => id.safeParse(n).success,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
}
