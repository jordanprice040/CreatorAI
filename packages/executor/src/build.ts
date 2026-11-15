import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_ROLE_TASK_CLASSES,
  LEGACY_BUILDER_PROMPT,
  frozenBrowserCases,
  frozenCases,
  taskHashes,
} from '@creator/domain';
import {
  z,
  BUILD_APPROVAL_MAX_REPAIRS,
  BUILD_APPROVAL_MAX_REQUESTS,
  MAX_BUILD_CASES,
  SpecBodySchema,
  BrokerCallResultSchema,
  type BrokerCallRequest,
  type BrokerCallResult,
  type BuildRecipe,
  type SpecBody,
  taskRecipe,
  parseRoleAnswer,
  RoleAnswerWrappingSchema,
  type RoleAnswerWrapping,
} from '@creator/contracts';
import {
  checked,
  digest,
  id,
  hash,
  sha,
  changesSchema,
  isBrowserCase,
  qaCaseSchema,
  type Binding,
  type Changes,
  type Execution,
  type QaCase,
} from './contracts.js';
import {
  NoChangePatchError,
  PatchRefusedError,
  ProductSupervisor,
} from './products.js';
import { ExecutionSupervisor } from './execution.js';
import { canonical, fileAt, jsonWrite, readJson, withLock } from './files.js';
import { git, head, clean, safeTree } from './git.js';
import { readBuildProgress, type BuildProgress } from './build-progress.js';
import {
  ANSWER_RULES,
  RoundDraft,
  builderV2Schema,
  type BuilderV2Answer,
} from './builder-answer.js';

export const buildPlanSchema = z.strictObject({
  format: z.literal('build-plan/1'),
  run_id: id,
  envelope_id: id,
  pricing_snapshot_id: id,
  humility_review: z.strictObject({ id, version: z.number().int().positive() }),
  data_class: z.enum(['synthetic', 'public', 'private_approved']),
  // ADR-0109 (B4): owner caps, raised from 2 repair rounds and 6 requests.
  max_repairs: z.number().int().min(0).max(BUILD_APPROVAL_MAX_REPAIRS),
  max_calls: z.number().int().min(2).max(BUILD_APPROVAL_MAX_REQUESTS),
  // Up to 120 s only on the plan route (plan_roles); broker builds keep the 60 s bound.
  timeout_ms: z.number().int().min(100).max(120000),
  max_output_tokens: z.number().int().min(100).max(16000),
  deadline: z.iso.datetime(),
  cases: z.array(qaCaseSchema).min(1).max(MAX_BUILD_CASES),
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
  // ADR-0115: how a plan-route role answer may be wrapped. Absent means the plan route's
  // default, `invoke_lines_then_json_fence`; a frozen recipe benchmark names its own (v5:
  // `one_json_fence`, as it ran). Ignored on the broker route, which uses JSON output mode.
  answer_wrapping: RoleAnswerWrappingSchema.optional(),
});
/** ADR-0115: the plan route's answer form when a build plan names none. */
export const PLAN_ROUTE_ANSWER_WRAPPING: RoleAnswerWrapping =
  'invoke_lines_then_json_fence';
export type BuildPlan = z.infer<typeof buildPlanSchema>;
/** The builder/1 answer: one part, whole files. Frozen study builds keep it (ADR-0109). */
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
  /**
   * The build's one approval (ADR-0054): asked once, before the first round, and covering the
   * repair rounds and role requests within `scope`. Throws (or rejects) when not allowed.
   */
  authorize(plan: BuildPlan, scope: BuildApprovalScope): Promise<unknown>;
  /**
   * Frozen study builds (T15) keep the admission per round they were frozen with; ADR-0054
   * does not change a study condition.
   */
  perRoundAdmission?: boolean;
  /**
   * ADR-0109: frozen study builds keep the builder/1 prompt, packet and one-part answer they
   * were frozen with. Every other build uses builder/2 (parts and edits).
   */
  legacyBuilder?: boolean;
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
  /**
   * ADR-0109 review L-5: the plan connection's per-request input cap (instructions plus input),
   * read before the build starts; a later part that would not fit refuses its round.
   */
  planRoleInputCap?(target: { connection_id: string }): Promise<number>;
}
/** What one build approval covers (ADR-0054); the ports bind it to the product's frozen spec. */
export interface BuildApprovalScope {
  build_id: string;
  product_id: string;
  task_id: string;
  plan_hash: string;
  route: 'broker' | 'codex_plan' | 'plan_roles';
  connection_id: string | null;
  model_id: string | null;
  /** The plan's max_calls: role requests the approval covers. */
  request_limit: number;
  max_repairs: number;
  expires_at: string;
}
export const planRoleResultSchema = z.strictObject({
  request_id: z.string().max(80),
  status: z.enum(['succeeded', 'failed']),
  reason_code: z.string().max(200),
  text: z.string().nullable(),
  fixture: z.boolean(),
});
export type PlanRoleResult = z.infer<typeof planRoleResultSchema>;
/** The role prompts a build sends: builder/2, or builder/1 for a frozen study build. */
const promptsFor = (legacy: boolean | undefined) =>
  legacy
    ? { ...BUILD_ROLE_PROMPTS, builder: LEGACY_BUILDER_PROMPT }
    : BUILD_ROLE_PROMPTS;
/**
 * ADR-0076: the scoped patch tool's rules, sent to the builder as packet data (not in the
 * qualified role prompt) so a builder can follow them, and repeated with any refusal.
 */
export const PATCH_RULES = [
  'Paths are relative, use / between segments and have at most 180 characters.',
  'Each segment uses only a-z, 0-9, _ and -, with dots only between non-empty parts. It starts with a letter or digit after optional leading underscores, so __init__.py is allowed. __pycache__ and Windows device names (con, prn, aux, nul, com0-9, lpt0-9) are refused.',
  'Every changed path must be a task.file_scope entry or lie beneath one, and each path appears once.',
  'expected_commit is the candidate commit. before_hash is the SHA-256 hex of the file content given in files, or null for a new file; content null deletes an existing file.',
  'All new content together is at most 512 KiB.',
] as const;
/** How studio QA runs each frozen case; build.ts runs exactly this command. */
export const QA_RUNTIME = {
  command: ['/usr/bin/python3', '-I', 'src/main.py', '<case args>'],
  working_directory: 'the product root',
  notes:
    'python3 -I ignores PYTHON* variables and user site-packages and does not put the script directory on sys.path, so src/main.py must add its own directory to sys.path before importing local modules. No network.',
} as const;
/**
 * ADR-0078: how studio QA runs each frozen browser case for static-web/1. Sent as packet data,
 * like QA_RUNTIME, so the qualified role prompts stay unchanged.
 */
export const WEB_QA_RUNTIME = {
  command: [
    'reviewed checker: serve site/ on a loopback-only HTTP server, open <case page> in headless Chrome 156, run the case steps',
  ],
  working_directory: 'the product root; only files under site/ are served',
  notes:
    'Plain HTML, CSS and JavaScript only: site/index.html is the entry page; file types .html .css .js .mjs .json .svg .txt .md; at most 60 files under site/. No packages, CDNs, build step or network: any request outside the site (from the page or a worker, including WebSockets; WebRTC is disabled), any service or shared worker, and any uncaught page error fails the case. A case stays on one document: a dialog (alert, confirm, prompt) or loading another document (a form submitted without preventDefault, a link to another page, a location change other than the hash) fails the case, so show messages in the page and handle submit in script. Opening a popup window (window.open) fails the case. After the last step the page runs 1 more second, and anything in that second counts too. Steps: click/check use a real mouse click on the one element the selector matches (it must be visible and enabled); fill clears the field and types the text; select sets an option by value; press sends a key to the focused element; goto changes location.hash; expect text compares whitespace-collapsed innerText (or a form field value) exactly; expect contains checks a substring; expect hidden passes when nothing matches or the match is not displayed; each expectation waits up to 3 s. A selector must match exactly one element (except expect count). Page scripts cannot see or change the checker. Storage such as localStorage starts empty in every case.',
} as const;
/** The runtime packet entry for a recipe. */
export const qaRuntimeOf = (recipe: BuildRecipe) =>
  recipe === 'static-web/1' ? WEB_QA_RUNTIME : QA_RUNTIME;
/** A refused submission's reason and contract details, bounded for the feedback packet. */
function refusalOf(reason: string, details: readonly string[]) {
  return {
    reason: reason.slice(0, 300),
    details: details.slice(0, 20).map((d) => d.slice(0, 300)),
  };
}
/** Role packet bound for metered broker builds, where nothing else bounds the input. */
export const BROKER_ROLE_CONTEXT_MAX = 20_000;
/**
 * Hard ceiling for plan-role builds (ADR-0053). The binding bound there is the connection's
 * owner-accepted per-request input cap, which plan admission enforces on instructions plus
 * input before anything is sent. This only stops a runaway packet; it equals the schema's
 * maximum for that cap.
 */
export const PLAN_ROLE_CONTEXT_MAX = 200_000;
/**
 * The task files a broker build may send (unchanged). ADR-0109: plan-role and Codex builds are
 * bounded by the role packet ceiling above and, on the plan route, the connection's input cap.
 */
export const BROKER_FILES_MAX = 14_000;

/** One QA case passed: this exact commit ran to completion with the frozen output and exit. */
export function qaPassed(execution: Execution, commit: string, c: QaCase) {
  const bound =
    execution.commit === commit &&
    ['succeeded', 'failed'].includes(execution.state) &&
    execution.reason === null &&
    execution.environment.acceptance_hash === digest(JSON.stringify(c));
  if (!bound) return false;
  if (!isBrowserCase(c))
    return execution.exit_code === c.exit_code && execution.log === c.stdout;
  // ADR-0078: the reviewed checker's one result line, for every frozen step, on the web recipe.
  const r = browserResult(execution.log);
  return (
    execution.recipe === 'static-web/1' &&
    execution.exit_code === 0 &&
    r !== null &&
    r.passed &&
    r.steps.length === c.steps.length &&
    r.steps.every((s, i) => s.passed && s.index === i) &&
    !r.page_errors.length &&
    !r.outbound.length &&
    !r.unsupported.length
  );
}
export const browserResultSchema = z.object({
  format: z.literal('browser-qa/1'),
  passed: z.boolean(),
  reason: z.string().nullable(),
  steps: z.array(
    z.strictObject({
      index: z.number().int(),
      passed: z.boolean(),
      detail: z.string(),
    }),
  ),
  page_errors: z.array(z.string()),
  outbound: z.array(z.string()),
  /** Review N-b: popups and service or shared workers, which static-web/1 does not support. */
  unsupported: z.array(z.string()),
});
export type BrowserResult = z.infer<typeof browserResultSchema>;
/** The checker's result from an execution log, or null when the log is not exactly one. */
export function browserResult(log: string): BrowserResult | null {
  try {
    const r = browserResultSchema.safeParse(JSON.parse(log));
    return r.success && log.trim().split('\n').length === 1 ? r.data : null;
  } catch {
    return null;
  }
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
    const legacy = ports.legacyBuilder === true;
    const PROMPTS = promptsFor(legacy);
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
      const recipe: BuildRecipe = p.recipe ?? 'python-build/1';
      // ADR-0078: the frozen checks choose the recipe, and the product was made for it.
      if (!acceptance.length || taskRecipe(spec, assigned.key) !== recipe)
        throw new Error(
          recipe === 'static-web/1'
            ? 'QA plan must cover every assigned browser check with browser cases frozen in the spec; this product was made for static-web/1'
            : 'QA plan must cover every assigned automated acceptance check with cases frozen in the spec; browser/manual/metric checks require another recipe',
        );
      // The executable cases are part of the frozen task hash; a build cannot choose its own.
      const frozen: { held_out: boolean }[] =
        recipe === 'static-web/1'
          ? frozenBrowserCases(spec, assigned.acceptance)
          : frozenCases(spec, assigned.acceptance);
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
        acceptance: acceptance.map(
          ({ cases: _, browser_cases: __, ...a }) => a,
        ),
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
        const filesMax =
          plan.plan_roles || plan.codex_plan_builder
            ? PLAN_ROLE_CONTEXT_MAX
            : BROKER_FILES_MAX;
        if (Buffer.byteLength(JSON.stringify(map)) > filesMax)
          throw new Error(
            'Task file context exceeds bounded packet; narrow task',
          );
        return map;
      };
      // ADR-0109: each call's intent names its round, and a builder call its part of the round.
      const invoke = async (
        role: keyof typeof BUILD_ROLE_PROMPTS,
        data: unknown,
        at: { round: number; part?: number },
      ) => {
        await active();
        if (calls >= plan.max_calls) throw new Error('Build call cap reached');
        if (Date.parse(plan.deadline) - Date.now() < 100)
          throw new Error('Build deadline reached');
        const text = JSON.stringify(data);
        const bound = plan.plan_roles
          ? PLAN_ROLE_CONTEXT_MAX
          : BROKER_ROLE_CONTEXT_MAX;
        if (text.length > bound)
          throw new Error(
            `Role context exceeds bounded packet (${text.length} > ${bound} characters)`,
          );
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
            ...at,
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
          // ADR-0110: one code fence around the whole answer is accepted; ADR-0115: by default
          // also a few leading invented tool-call lines before it, nothing else. The raw text
          // stays in the plan request, and the form is recorded beside the call.
          const wrapping = plan.answer_wrapping ?? PLAN_ROUTE_ANSWER_WRAPPING;
          const answer = parseRoleAnswer(r.text, wrapping);
          if (answer.fenced)
            await jsonWrite(join(dir, `call-${calls}-answer-form.json`), {
              wrapping: answer.dropped_invoke_lines
                ? 'invoke_lines_then_json_fence'
                : 'one_json_fence',
              ...(answer.dropped_invoke_lines
                ? { dropped_invoke_lines: answer.dropped_invoke_lines }
                : {}),
            });
          return answer.json;
        }
        await jsonWrite(join(dir, `call-${calls}-intent.json`), {
          role,
          ...at,
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
      let lastRefusal: string | null = null;
      // The newest review and QA feedback, kept through later refused rounds (PR #146 M-1).
      let lastReview: unknown = null;
      // Candidates this build has sent to review and QA.
      const judged = new Set<string>();
      /** The plan connection's input cap, read before the builder is sent (review L-5). */
      let inputCap: number | null = null;
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
          inputCap = ports.planRoleInputCap
            ? await ports.planRoleInputCap(plan.plan_roles)
            : null;
          await jsonWrite(join(dir, 'plan-roles-preflight.json'), {
            blockers,
            input_cap: inputCap,
          });
          if (blockers.length)
            throw new Error(`Plan roles are not ready: ${blockers.join(' ')}`);
        }
        const scope: BuildApprovalScope = {
          build_id: buildId,
          product_id: product,
          task_id: taskId,
          plan_hash: digest(JSON.stringify(plan)),
          route: plan.plan_roles
            ? 'plan_roles'
            : plan.codex_plan_builder
              ? 'codex_plan'
              : 'broker',
          connection_id: plan.plan_roles?.connection_id ?? null,
          model_id: plan.plan_roles?.model_id ?? null,
          request_limit: plan.max_calls,
          max_repairs: plan.max_repairs,
          expires_at: plan.deadline,
        };
        rounds: for (let cycle = 0; cycle <= plan.max_repairs; cycle++) {
          repairs = cycle;
          await active();
          // ADR-0054: one approval per build, asked before the first round. Later rounds rely
          // on it; active() re-checks its grant, the humility review and the run every step.
          if (cycle === 0 || ports.perRoundAdmission)
            await jsonWrite(
              join(dir, `admission-${cycle}.json`),
              await ports.authorize(plan, scope),
            );
          await active();
          // ADR-0076: a submission the patch contract or scoped tool refuses changes nothing; the
          // reason goes back to the builder as feedback and the round counts as a repair.
          const refuse = async (reason: string, details: readonly string[]) => {
            const refusal = refusalOf(reason, details);
            await jsonWrite(join(dir, `refused-${cycle}.json`), refusal);
            lastRefusal = refusal.reason;
            // patch_rules already travel in every builder packet. The earlier review stays, so a
            // last round still knows why the previous candidate was rejected.
            feedback =
              lastReview === null
                ? { refused_patch: refusal }
                : { refused_patch: refusal, previous_review: lastReview };
          };
          const current = await files();
          // ADR-0109: a builder/2 round may come in parts. Nothing is applied until its last
          // part; a crash or a refused part leaves the candidate exactly as it was.
          const draft = new RoundDraft(current);
          let patch: Changes;
          for (let part = 1; ; part++) {
            await active();
            // One request always stays for this round's reviewer.
            const further = Math.max(0, plan.max_calls - calls - 2);
            const builderPacket = {
              ...packet,
              candidate: commit,
              // Review L-2: a path an earlier part changed travels once, in round.staged.
              files: current.filter((f) => !draft.has(f.path)),
              patch_rules: PATCH_RULES,
              qa_runtime: qaRuntimeOf(recipe),
              ...(legacy
                ? {}
                : {
                    answer_rules: ANSWER_RULES,
                    round: {
                      part,
                      further_parts_allowed: plan.codex_plan_builder
                        ? 0
                        : further,
                      staged: draft.view(),
                    },
                  }),
              feedback,
            };
            let answer: unknown;
            if (plan.codex_plan_builder) {
              if (!ports.codexBuilder)
                throw new Error('Codex plan builder is not configured');
              // Full audit L-11: the Codex packet gets the same runaway ceiling as plan roles,
              // not just the API's 1 MiB body allowance.
              const codexPacket = {
                ...builderPacket,
                allowed_tools: ['apply_patch in the task workspace'],
              };
              const codexText = JSON.stringify(codexPacket);
              if (codexText.length > PLAN_ROLE_CONTEXT_MAX)
                throw new Error(
                  `Codex builder context exceeds bounded packet (${codexText.length} > ${PLAN_ROLE_CONTEXT_MAX} characters)`,
                );
              await jsonWrite(join(dir, `codex-${cycle}-intent.json`), {
                candidate: commit,
                context_hash: digest(codexText),
              });
              answer = await ports.codexBuilder(
                {
                  ...plan.codex_plan_builder,
                  build_id: buildId,
                  run_id: plan.run_id,
                  data_class: plan.data_class,
                },
                codexPacket,
              );
              await jsonWrite(join(dir, `codex-${cycle}-outcome.json`), answer);
              await active();
            } else {
              // Review L-2: a later part whose packet no longer fits the role-packet bound is
              // the round's size, not a fault: the round is refused with advice and nothing
              // from it is applied. (A first part that does not fit stops the build as before:
              // the task's own files are too large.) Review L-5: on the plan route the
              // connection's input cap, which counts the builder prompt too, binds when smaller.
              const ceiling = plan.plan_roles
                ? PLAN_ROLE_CONTEXT_MAX
                : BROKER_ROLE_CONTEXT_MAX;
              const room =
                inputCap === null
                  ? ceiling
                  : Math.min(ceiling, inputCap - PROMPTS.builder.length);
              const size = JSON.stringify(builderPacket).length;
              if (part > 1 && size > room) {
                await refuse(
                  room < ceiling
                    ? `Part ${part} of this round would send ${size} characters, more than the connection's input limit leaves after the builder prompt (${room} of ${inputCap}), so none of the round was applied`
                    : `Part ${part} of this round would send ${size} characters, more than a request may carry (${room}), so none of the round was applied`,
                  [
                    'Change fewer or smaller files per round, use edits instead of whole files, or finish in fewer parts.',
                  ],
                );
                continue rounds;
              }
              answer = await invoke('builder', builderPacket, {
                round: cycle,
                part,
              });
            }
            const admitted = (
              legacy ? builderSchema : builderV2Schema
            ).safeParse(answer);
            if (
              !admitted.success &&
              admitted.error.issues.every((i) => i.path[0] === 'submission')
            ) {
              await refuse(
                'The submission does not satisfy the patch contract',
                admitted.error.issues.map(
                  (i) => `${i.path.join('.')}: ${i.message}`,
                ),
              );
              continue rounds;
            }
            // Any other malformed answer is not a patch; it stops the build as before.
            // A builder/1 answer is a one-part builder/2 answer without edits.
            const built: BuilderV2Answer = legacy
              ? checked(builderSchema, answer)
              : checked(builderV2Schema, answer);
            if (!built.submission)
              throw new Error(
                `Builder blocked: ${built.blocker ?? 'no submitted patch'}`,
              );
            if (built.submission.expected_commit !== commit) {
              await refuse('Builder submitted stale commit', [
                `submission.expected_commit must equal the candidate ${commit}`,
              ]);
              continue rounds;
            }
            try {
              draft.add(built.submission.changes);
            } catch (e) {
              if (!(e instanceof PatchRefusedError)) throw e;
              await refuse(
                part > 1
                  ? `Part ${part} of this round was refused, so none of the round was applied: ${e.message}`
                  : e.message,
                [],
              );
              continue rounds;
            }
            const complete =
              !('complete' in built.submission) ||
              built.submission.complete !== false;
            await jsonWrite(join(dir, `part-${cycle}-${part}.json`), {
              part,
              complete,
              changes: built.submission.changes.map((c) => ({
                path: c.path,
                before_hash: c.before_hash,
                ...('edits' in c
                  ? { edits: c.edits.length }
                  : {
                      after_hash: c.content === null ? null : digest(c.content),
                    }),
              })),
            });
            if (complete) {
              patch = { expected_commit: commit, changes: draft.changes() };
              break;
            }
            if (plan.codex_plan_builder || further <= 0) {
              await refuse(
                plan.codex_plan_builder
                  ? 'The Codex builder answers a round in one part; complete false is refused'
                  : 'The builder asked for another part, but no request is left for one this round, so none of the round was applied',
                [
                  'Send the whole change in one answer when round.further_parts_allowed is 0, using edits to keep it short.',
                ],
              );
              continue rounds;
            }
          }
          await active();
          let submitted: { commit: string; changed_files: string[] };
          try {
            // A round whose parts change nothing is the empty patch the tool refuses.
            if (!patch.changes.length) throw new NoChangePatchError();
            submitted = await this.products.apply(
              product,
              taskId,
              patch,
              p.binding,
            );
          } catch (e) {
            if (!(e instanceof PatchRefusedError)) throw e;
            // P-1: a build resumed from an earlier build's candidate, whose builder submits the
            // candidate's own content, keeps that candidate. This build then reviews and tests it
            // afresh; a candidate this build already judged still refuses the empty patch.
            if (
              !(e instanceof NoChangePatchError) ||
              commit === task.base_commit ||
              judged.has(commit)
            ) {
              await refuse(e.message, []);
              continue;
            }
            submitted = { commit, changed_files: [] };
          }
          lastRefusal = null;
          commit = submitted.commit;
          judged.add(commit);
          // PR #194 N-2: a carried-over candidate (no files changed) says so in its record.
          await jsonWrite(
            join(dir, `candidate-${cycle}.json`),
            submitted.changed_files.length === 0
              ? { ...submitted, kept: true }
              : submitted,
          );
          // Deliberately excludes builder summaries, prior reviews and QA results.
          const review = checked(
            reviewSchema,
            await invoke(
              'reviewer',
              {
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
              },
              { round: cycle },
            ),
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
            // P-1: a case the worker could not carry out (blocked, lost, cleanup pending) judged
            // nothing about the code. It stops the build with the worker's reason instead of
            // spending a repair round on a candidate no test has run (as plan qualification does).
            if (!['succeeded', 'failed'].includes(execution.state)) {
              // PR #194 N-2: the build folder names the execution that did not finish.
              await jsonWrite(join(dir, `qa-${cycle}-${index}.json`), {
                command: isBrowserCase(c)
                  ? ['browser-qa/1', c.page]
                  : ['/usr/bin/python3', '-I', 'src/main.py', ...c.args],
                check: heldOut(index)
                  ? { check_key: c.check_key, held_out: true }
                  : c,
                execution,
                passed: false,
                unfinished: true,
              });
              await active();
              // PR #194 L-1: a run left unresolved holds the worker until Recover settles it;
              // building again first would spend an approval and two requests on that lock.
              throw new Error(
                `The worker did not finish check ${c.check_key} (${execution.state}${
                  execution.reason ? `: ${execution.reason}` : ''
                }; execution ${execution.id}). The candidate is kept; ${
                  execution.state === 'cleanup_required'
                    ? 'Recover this product first, then build again.'
                    : 'build again once the worker runs.'
                }`,
              );
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
              command: isBrowserCase(c)
                ? ['browser-qa/1', c.page]
                : ['/usr/bin/python3', '-I', 'src/main.py', ...c.args],
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
          feedback = lastReview = { review, checks };
          if (review.verdict === 'blocked')
            throw new Error('Reviewer blocked candidate');
        }
        throw new Error(
          lastRefusal
            ? `Repair limit reached; the last patch was refused: ${lastRefusal}`
            : 'Repair limit reached; partial commits and evidence preserved',
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
  /**
   * B3: the build folder as the Build page shows it. Held-out flags come from the frozen spec in
   * the build's own intent, so a failed held-out case is never shown in full.
   */
  async progress(
    product: string,
    build: string,
    running: boolean,
  ): Promise<BuildProgress> {
    const dir = this.dir(product, build);
    const intent = (await readJson(join(dir, 'intent.json'))) as {
      task_id: string;
      spec: SpecBody;
    };
    const p = await this.products.product(product);
    const task = await this.products.task(product, intent.task_id);
    const spec = checked(SpecBodySchema, intent.spec);
    const keys = spec.tasks.find((t) => t.key === task.key)?.acceptance ?? [];
    const frozen: { held_out: boolean }[] =
      p.recipe === 'static-web/1'
        ? frozenBrowserCases(spec, keys)
        : frozenCases(spec, keys);
    return readBuildProgress({
      dir,
      heldOut: frozen.map((c) => c.held_out),
      running,
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
