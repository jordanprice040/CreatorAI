import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CancelRunRequestSchema,
  CritiqueOutputSchema,
  DiscoveryTaskContextSchema,
  EvidencePacketSchema,
  ORCHESTRATION_POLICY_VERSION,
  RESPONSE_OUTCOME,
  StartWorkflowRequestSchema,
  StoredBodySchemas,
  SynthesisOutputSchema,
  TaskContextSchema,
  WorkflowControlRequestSchema,
  parse,
  type DiscoveryResult,
  type DiscoveryTaskContext,
  type DiscoveryTaskKind,
  type EvidencePacket,
  type LocatorOutput,
  type ProposalOutput,
  type Reservation,
  type ResponseType,
  type SkepticTaskContext,
  type TaskContext,
  type TaskKind,
  type TaskState,
  type Workflow,
  type WorkflowDetail,
  type WorkflowLimits,
  type WorkflowResult,
  type WorkflowTask,
  type z,
} from '@creator/contracts';
import {
  DISCOVERY_ROLE_VERSION,
  PROMPT_HASH,
  ROLE_VERSION,
  canonicalHash,
  catalogMatches,
  checkDiscoveryOutput,
  coordinate,
  coordinateDiscovery,
  disposeDiscovery,
  isTerminalTask,
  proposalLabel,
  type CoordinatorAction,
  type CoordinatorPlan,
  type DiscoveryInput,
} from '@creator/domain';
import {
  BudgetStore,
  RESERVATION_SELECT,
  toReservation,
} from './budget-store.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** The agent actor that runs workflow tasks. It is added to a workspace when a workflow starts. */
export const ORCHESTRATOR_ACTOR_ID = '00000000-0000-4000-8000-000000000003';
const WAKEUP_CONSUMER = 'workflow_wakeup';
const nullableIso = (v: unknown) =>
  v === null || v === undefined ? null : iso(v);

function toWorkflow(r: Row): Workflow {
  const context = r.context as Row;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    fixture: Boolean(r.fixture),
    version: Number(r.version),
    role: r.role as Workflow['role'],
    role_version: String(r.role_version),
    prompt_hash: String(r.prompt_hash),
    policy_version: String(r.policy_version),
    subject: { id: String(r.subject_id), version: Number(r.subject_version) },
    context_hash: String(r.context_hash),
    constraints: context.constraints as string[],
    perspectives: context.perspectives as string[],
    limits: r.limits as WorkflowLimits,
    envelope_id: String(r.envelope_id),
    pricing_snapshot_id: String(r.pricing_snapshot_id),
    data_class: r.data_class as Workflow['data_class'],
    state: r.state as Workflow['state'],
    reason: String(r.reason),
    control: r.control as Workflow['control'],
    steps: Number(r.steps),
    deadline_at: iso(r.deadline_at),
    result: (r.result as WorkflowResult | null) ?? null,
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    finished_at: nullableIso(r.finished_at),
  };
}
function toTask(r: Row): WorkflowTask {
  return {
    id: String(r.id),
    workflow_id: String(r.workflow_id),
    kind: r.kind as TaskKind,
    ordinal: Number(r.ordinal),
    round: Number(r.round ?? 0),
    repair: Number(r.repair),
    repair_of: r.repair_of === null ? null : String(r.repair_of),
    depth: Number(r.depth),
    logical_operation_id: String(r.logical_operation_id),
    state: r.state as TaskState,
    reason: String(r.reason),
    version: Number(r.version),
    deliveries: Number(r.deliveries),
    lease_owner: r.lease_owner === null ? null : String(r.lease_owner),
    lease_token: r.lease_token === null ? null : String(r.lease_token),
    lease_expires_at: nullableIso(r.lease_expires_at),
    decision_id: r.decision_id === null ? null : String(r.decision_id),
    context: r.context as TaskContext,
    context_hash: String(r.context_hash),
    output: r.output ?? null,
    output_hash: r.output_hash === null ? null : String(r.output_hash),
    created_at: iso(r.created_at),
    finished_at: nullableIso(r.finished_at),
  };
}

/** What a worker holds while it runs one task. The token fences its commit. */
export interface TaskLease {
  task: WorkflowTask;
  token: string;
  workspaceId: string;
  runId: string;
  workflowId: string;
  envelopeId: string;
  pricingSnapshotId: string;
  dataClass: Workflow['data_class'];
  limits: WorkflowLimits;
  /** Synthesis only: the critique outputs named in its context, verified by hash. */
  critiques: { perspective: string; output: unknown }[];
  /** Discovery tasks: the packet (verified by hash) and the inputs the context names. */
  discovery: { packet: EvidencePacket; inputs: DiscoveryInput[] } | null;
}
export type TaskOutcome =
  | { state: 'succeeded'; reason: string; output: unknown }
  | {
      state: 'failed' | 'needs_human' | 'reconciling' | 'cancelled';
      reason: string;
    }
  | { state: 'waiting_human'; reason: string; decisionId: string };

const DISCOVERY_KINDS: readonly TaskKind[] = [
  'locate',
  'propose',
  'skeptic',
  'revise',
];
export const isDiscoveryKind = (k: TaskKind): k is DiscoveryTaskKind =>
  DISCOVERY_KINDS.includes(k);
/** Discovery workflow context: the packet and the run's fixed choices. */
export interface DiscoveryWorkflowContext {
  packet: EvidencePacket;
  packet_hash: string;
  perspectives: ResponseType[];
  excluded: { perspective: ResponseType; reason: string }[];
  max_revisions: number;
  constraints: string[];
}

/**
 * Validates a role answer; anything else is a known, charged failure. Discovery answers are
 * also checked against the packet and the task's own context.
 */
export function validateOutput(
  kind: TaskKind,
  json: unknown,
  discovery?: { packet: EvidencePacket; context: TaskContext },
) {
  if (isDiscoveryKind(kind)) {
    if (
      !discovery ||
      discovery.context.context_version !== 'discovery-context/1'
    )
      return null;
    const checked = checkDiscoveryOutput(
      kind,
      json,
      discovery.packet,
      discovery.context,
    );
    return checked.ok ? checked.output : null;
  }
  const schema =
    kind === 'critique' ? CritiqueOutputSchema : SynthesisOutputSchema;
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** How a discovery task's output is labelled when another task reads it. */
export function discoveryLabel(
  t: Pick<WorkflowTask, 'kind' | 'ordinal' | 'round'>,
  perspectives: ResponseType[],
): string {
  if (t.kind === 'locate') return 'locator';
  if (t.kind === 'skeptic') return `skeptic pass ${t.round + 1}`;
  return `${proposalLabel(t.ordinal)} ${perspectives[t.ordinal] ?? ''}${t.kind === 'revise' ? ` revision ${t.round}` : ''}`.trim();
}

/**
 * Context for a new discovery task: the packet by hash and exactly the inputs the coordinator
 * named, by output hash. A skeptic also gets the catalog entries application code found
 * similar to each proposal.
 */
function discoveryTaskContext(
  d: DiscoveryWorkflowContext,
  a: Extract<CoordinatorAction, { type: 'delegate' }>,
  tasks: WorkflowTask[],
): DiscoveryTaskContext {
  const inputs = (a.inputs ?? []).map((id) => {
    const t = tasks.find((x) => x.id === id);
    if (!t?.output_hash || !isDiscoveryKind(t.kind))
      throw fail(
        'EVIDENCE_MISMATCH',
        'A discovery input is not a finished task.',
      );
    return { task: t, kind: t.kind };
  });
  const designer = a.kind === 'propose' || a.kind === 'revise';
  return parse(DiscoveryTaskContextSchema, {
    context_version: 'discovery-context/1',
    role_version: DISCOVERY_ROLE_VERSION,
    packet_hash: d.packet_hash,
    perspective: designer ? (d.perspectives[a.ordinal] ?? null) : null,
    proposal: designer ? proposalLabel(a.ordinal) : null,
    round: a.round ?? 0,
    inputs: inputs.map(({ task, kind }) => ({
      task_id: task.id,
      output_hash: task.output_hash,
      kind,
      label: discoveryLabel(task, d.perspectives),
    })),
    catalog_matches:
      a.kind === 'skeptic'
        ? inputs.flatMap(({ task }) =>
            catalogMatches(task.output as ProposalOutput, d.packet.catalog)
              .slice(0, 3)
              .map((m) => ({
                proposal: proposalLabel(task.ordinal),
                catalog: m.entry.ref,
                similarity: m.similarity,
              })),
          )
        : [],
  });
}

/**
 * Durable workflows (migration 4): a coordinator per run, tasks with leases and fencing
 * tokens, and wake-ups from decisions through the outbox. Lock order is always workflow row,
 * then task rows, then (inside the broker) run control and envelope.
 */
export class WorkflowStore extends BudgetStore {
  // ---- Start and read ----------------------------------------------------------------

  /** Audit a blocked study/human-only workflow before throwing, so rollback cannot erase it. */
  protected async studyWorkflowGate(
    ctx: CommandContext,
    ws: string,
    runId: string,
    requestHash: string | null,
  ) {
    const reason = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const run = await this.lockRun(c, ws, runId);
      const study = await c.query(
        `select a.id,e.request_hash from study_attempts a left join study_execution_requests e on e.attempt_id=a.id where a.workspace_id=$1 and a.run_id=$2`,
        [ws, runId],
      );
      const blocked =
        run.autonomy_mode === 'human_only'
          ? 'HUMAN_ONLY_DENIED'
          : study.rowCount &&
              (!requestHash || study.rows[0].request_hash !== requestHash)
            ? 'SCOPE_EXCEEDED'
            : null;
      if (blocked)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'study.workflow_denied',
          subjectKind: 'run',
          subjectId: runId,
          subjectVersion: null,
          contentHash: null,
          payload: { reason: blocked },
        });
      return blocked;
    });
    if (reason)
      throw fail(
        reason,
        'This workflow is outside the assigned study context.',
      );
  }

  async startWorkflow(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(StartWorkflowRequestSchema, raw);
    await this.studyWorkflowGate(ctx, ws, runId, null);
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'workflow.start', runId, req },
      async (c) => {
        await portfolioEffectFence(c, ws, runId, ctx.idempotencyKey);
        const s = await this.subjectVersion(c, ws, req.subject);
        const subject = {
          id: req.subject.id.toLowerCase(),
          version: req.subject.version,
          kind: String(s.kind),
          content_hash: String(s.content_hash),
          title: String(s.title).slice(0, 500),
          excerpt: JSON.stringify(s.body ?? null).slice(0, 4000),
        };
        const knowledge = await activeKnowledgeConstraints(
          c,
          ws,
          runId,
          req.knowledge_keys ?? [],
          req.data_class,
        );
        const context = {
          subject,
          constraints: [...req.constraints, ...knowledge],
          perspectives: req.perspectives,
        };
        const workflowId = await this.insertWorkflow(c, ctx, ws, runId, {
          role: req.role,
          roleVersion: ROLE_VERSION,
          promptHash: PROMPT_HASH,
          subject: req.subject,
          context,
          limits: req.limits,
          envelopeId: req.envelope_id,
          pricingSnapshotId: req.pricing_snapshot_id,
          dataClass: req.data_class,
          audit: { perspectives: req.perspectives.length },
        });
        await bindWorkflowKnowledge(
          c,
          ws,
          workflowId,
          req.knowledge_keys ?? [],
        );
        await this.insertTask(c, ctx, ws, workflowId, {
          kind: 'synthesis',
          ordinal: 0,
          repair: 0,
          repairOf: null,
          state: 'waiting_dependency',
          context: this.taskContext(context, null, []),
        });
        await this.coordinateIn(c, ctx, ws, workflowId);
        return workflowId;
      },
    );
    return this.getWorkflow(ctx, ws, id);
  }

  /** The pinned record version a workflow starts from; redacted records cannot be used. */
  protected async subjectVersion(
    c: PoolClient,
    ws: string,
    ref: { id: string; version: number },
  ): Promise<Row> {
    const sub = await c.query(
      `select e.kind, v.title, v.body, v.content_hash, v.status
         from entity_versions v join entities e on e.id = v.entity_id
        where v.workspace_id = $1 and v.entity_id = $2 and v.version = $3`,
      [ws, ref.id.toLowerCase(), ref.version],
    );
    const s = sub.rows[0] as Row | undefined;
    if (!s) throw fail('NOT_FOUND', 'Subject record version not found.');
    if (s.status === 'redacted')
      throw fail('NOT_FOUND', 'A redacted record cannot be reviewed.');
    return s;
  }

  /**
   * Checks the run, envelope and pricing, then writes the workflow row, the worker's editor
   * membership and the start event, all in the caller's transaction.
   */
  protected async insertWorkflow(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    w: {
      role: Workflow['role'];
      roleVersion: string;
      promptHash: string;
      subject: { id: string; version: number };
      context: Record<string, unknown>;
      limits: WorkflowLimits;
      envelopeId: string;
      pricingSnapshotId: string;
      dataClass: Workflow['data_class'];
      audit: Row;
    },
  ): Promise<string> {
    await this.requireOwner(c, ws, ctx.actorId);
    await c.query(
      `insert into actors (id, kind, display_name) values ($1, 'agent', 'Workflow worker')
       on conflict do nothing`,
      [ORCHESTRATOR_ACTOR_ID],
    );
    const run = await this.lockRun(c, ws, runId);
    if (run.state !== 'active')
      throw fail('INVALID_TRANSITION', 'The run is cancelled.');
    if (run.autonomy_mode === 'human_only')
      throw fail(
        'HUMAN_ONLY_DENIED',
        'A human-only run cannot start a model role.',
      );
    const assigned = await c.query(
      'select a.id,a.created_at,s.manifest from study_attempts a join studies s on s.id=a.study_id where a.workspace_id=$1 and a.run_id=$2',
      [ws, runId],
    );
    if (assigned.rows[0]) {
      const a = assigned.rows[0];
      const finished = await c.query(
        "select 1 from study_events where attempt_id=$1 and kind='finished'",
        [a.id],
      );
      if (
        finished.rowCount ||
        Date.now() >
          new Date(a.created_at).getTime() +
            a.manifest.packet.time_cap_seconds * 1000
      )
        throw fail(
          'INVALID_TRANSITION',
          'The study assignment is terminal or expired.',
        );
    }
    const live = await c.query(
      'select 1 from workflows where workspace_id = $1 and run_id = $2 and finished_at is null',
      [ws, runId],
    );
    if (live.rowCount)
      throw fail('DUPLICATE', 'This run already has a live workflow.');
    const env = await c.query(
      `select status, run_id from budget_envelopes where workspace_id = $1 and id = $2`,
      [ws, w.envelopeId.toLowerCase()],
    );
    const e = env.rows[0] as Row | undefined;
    if (!e) throw fail('NOT_FOUND', 'Budget envelope not found.');
    if (e.status !== 'active' || (e.run_id !== null && e.run_id !== runId))
      throw fail(
        'SCOPE_EXCEEDED',
        'Use an active envelope that is workspace-wide or belongs to this run.',
      );
    const price = await c.query(
      'select 1 from pricing_snapshots where workspace_id = $1 and id = $2',
      [ws, w.pricingSnapshotId.toLowerCase()],
    );
    if (!price.rowCount)
      throw fail('PRICING_MISSING', 'Pricing snapshot not found.');
    const fixture = (
      await c.query<{ fixture: boolean }>(
        'select fixture from workspaces where id = $1',
        [ws],
      )
    ).rows[0]?.fixture;
    const workflowId = randomUUID();
    const contextHash = canonicalHash(w.context);
    await c.query(
      `insert into workflows (id, workspace_id, fixture, run_id, role, role_version,
         prompt_hash, policy_version, subject_id, subject_version, context, context_hash,
         limits, envelope_id, pricing_snapshot_id, data_class, state, reason, deadline_at,
         created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'queued','started',
         now() + make_interval(secs => $17::double precision), $18)`,
      [
        workflowId,
        ws,
        fixture,
        runId,
        w.role,
        w.roleVersion,
        w.promptHash,
        ORCHESTRATION_POLICY_VERSION,
        w.subject.id.toLowerCase(),
        w.subject.version,
        JSON.stringify(w.context),
        contextHash,
        JSON.stringify(w.limits),
        w.envelopeId.toLowerCase(),
        w.pricingSnapshotId.toLowerCase(),
        w.dataClass,
        w.limits.max_wall_seconds,
        ctx.actorId,
      ],
    );
    // The agent that runs tasks acts in this workspace only as an editor: it can submit
    // actions for admission, never answer decisions or change grants.
    const member = await c.query(
      `insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, 'editor')
       on conflict do nothing`,
      [ws, ORCHESTRATOR_ACTOR_ID],
    );
    if (member.rowCount)
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'member.added',
        subjectKind: 'actor',
        subjectId: ORCHESTRATOR_ACTOR_ID,
        subjectVersion: null,
        contentHash: null,
        payload: { role: 'editor' },
      });
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'workflow.started',
      subjectKind: 'workflow',
      subjectId: workflowId,
      subjectVersion: 1,
      contentHash: contextHash,
      payload: {
        role: w.role,
        role_version: w.roleVersion,
        prompt_hash: w.promptHash,
        limits: w.limits,
        ...w.audit,
      },
      relatedIds: [runId, w.subject.id.toLowerCase()],
    });
    return workflowId;
  }

  private taskContext(
    wf: { subject: SkepticTaskContext['subject']; constraints: string[] },
    perspective: string | null,
    inputs: SkepticTaskContext['inputs'],
  ): TaskContext {
    return parse(TaskContextSchema, {
      context_version: 'skeptic-context/1',
      role_version: ROLE_VERSION,
      subject: wf.subject,
      constraints: wf.constraints,
      perspective,
      inputs,
    });
  }

  protected async insertTask(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    workflowId: string,
    t: {
      kind: TaskKind;
      ordinal: number;
      round?: number;
      repair: number;
      repairOf: string | null;
      state: 'queued' | 'waiting_dependency';
      context: TaskContext;
    },
  ) {
    const id = randomUUID();
    await c.query(
      `insert into workflow_tasks (id, workspace_id, workflow_id, kind, ordinal, round, repair,
         repair_of, depth, logical_operation_id, state, reason, context, context_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13)`,
      [
        id,
        ws,
        workflowId,
        t.kind,
        t.ordinal,
        t.round ?? 0,
        t.repair,
        t.repairOf,
        randomUUID(),
        t.state,
        t.repair ? 'repair' : 'delegated',
        JSON.stringify(t.context),
        canonicalHash(t.context),
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'workflow.delegated',
      subjectKind: 'workflow_task',
      subjectId: id,
      subjectVersion: 1,
      contentHash: canonicalHash(t.context),
      payload: {
        kind: t.kind,
        ordinal: t.ordinal,
        round: t.round ?? 0,
        repair: t.repair,
      },
      relatedIds: [workflowId],
    });
    return id;
  }

  async listWorkflows(
    ctx: CommandContext,
    ws: string,
    filter: { runId?: string } = {},
  ): Promise<Workflow[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from workflows where workspace_id = $1 and ($2::uuid is null or run_id = $2)
         order by created_at desc limit 100`,
        [ws, filter.runId ? uuid(filter.runId) : null],
      );
      return rows.map((r: Row) => toWorkflow(r));
    });
  }

  async getWorkflow(
    ctx: CommandContext,
    ws: string,
    workflowId: string,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const w = await c.query(
        'select * from workflows where workspace_id = $1 and id = $2',
        [ws, workflowId],
      );
      if (!w.rows[0]) throw fail('NOT_FOUND', 'Workflow not found.');
      const tasks = (
        await c.query(
          'select * from workflow_tasks where workflow_id = $1 order by kind, ordinal, round, repair',
          [workflowId],
        )
      ).rows.map((r: Row) => toTask(r));
      const reservations = (
        await c.query(
          `${RESERVATION_SELECT} where r.workspace_id = $1 and r.logical_operation_id = any($2::uuid[])
           order by r.created_at, r.attempt`,
          [ws, tasks.map((t) => t.logical_operation_id)],
        )
      ).rows.map((r: Row) => toReservation(r));
      return {
        workflow: toWorkflow(w.rows[0] as Row),
        tasks,
        usage: usageOf(reservations),
        reservations,
      };
    });
  }

  // ---- Coordinator --------------------------------------------------------------------

  private async lockWorkflow(c: PoolClient, workflowId: string) {
    const { rows } = await c.query(
      'select * from workflows where id = $1 for update',
      [workflowId],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workflow not found.');
    return toWorkflow(rows[0] as Row);
  }

  /**
   * One coordinator step inside the caller's transaction, under the workflow row lock: read
   * durable state, choose (domain `coordinate`), apply, and record. Returns whether it changed.
   */
  protected async coordinateIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    workflowId: string,
  ): Promise<boolean> {
    const wf = await this.lockWorkflow(c, workflowId);
    if (wf.finished_at) return false;
    const tasks = (
      await c.query(
        'select * from workflow_tasks where workflow_id = $1 for update',
        [workflowId],
      )
    ).rows.map((r: Row) => toTask(r));
    const now = new Date(
      (await c.query<{ now: Date }>('select now() as now')).rows[0]?.now ??
        Date.now(),
    );
    const ctxRow = (
      await c.query('select context from workflows where id = $1', [workflowId])
    ).rows[0]?.context as Row;
    const discovery =
      wf.role === 'r02_discovery'
        ? (ctxRow as unknown as DiscoveryWorkflowContext)
        : null;
    const view = {
      state: wf.state,
      control: wf.control,
      limits: wf.limits,
      perspectives: wf.perspectives,
      deadline_at: wf.deadline_at,
      steps: wf.steps,
      tasks,
      now,
    };
    const plan: CoordinatorPlan = discovery
      ? coordinateDiscovery({
          ...view,
          perspectives: discovery.perspectives,
          max_revisions: discovery.max_revisions,
          sufficient: discovery.packet.sufficiency.verdict === 'sufficient',
        })
      : coordinate(view);
    const skepticRow = ctxRow as unknown as {
      subject: SkepticTaskContext['subject'];
      constraints: string[];
      perspectives: string[];
    };
    for (const a of plan.actions) {
      if (a.type === 'delegate') {
        const prior = a.repair_of
          ? tasks.find((t) => t.id === a.repair_of)
          : undefined;
        await this.insertTask(c, ctx, ws, workflowId, {
          kind: a.kind,
          ordinal: a.ordinal,
          round: a.round ?? 0,
          repair: a.repair,
          repairOf: a.repair_of,
          state: 'queued',
          context:
            prior?.context ??
            (discovery
              ? discoveryTaskContext(discovery, a, tasks)
              : this.taskContext(
                  skepticRow,
                  skepticRow.perspectives[a.ordinal] ?? null,
                  [],
                )),
        });
      } else if (a.type === 'release_synthesis') {
        const inputs = skepticRow.perspectives.flatMap((p, i) => {
          const t = tasks
            .filter(
              (x) =>
                x.kind === 'critique' &&
                x.ordinal === i &&
                x.state === 'succeeded',
            )
            .sort((x, y) => y.repair - x.repair)[0];
          return t?.output_hash
            ? [{ task_id: t.id, output_hash: t.output_hash, perspective: p }]
            : [];
        });
        const context = this.taskContext(skepticRow, null, inputs);
        await this.setTask(
          c,
          ctx,
          ws,
          a.task_id,
          'queued',
          'dependencies_met',
          {
            context,
          },
        );
      } else {
        for (const t of tasks) {
          if (isTerminalTask(t.state) || t.state === 'leased') continue;
          await this.setTask(c, ctx, ws, t.id, 'cancelled', a.reason);
          // Cleanup: a question nobody needs answered any more is closed, not left pending.
          if (t.state === 'waiting_human' && t.decision_id) {
            const closed = await c.query<{ version: number }>(
              `update decision_requests set status = 'cancelled', closed_reason = 'workflow_stopped',
                 version = version + 1
               where id = $1 and status = 'pending' returning version`,
              [t.decision_id],
            );
            if (closed.rowCount)
              await this.append(c, ctx, {
                workspaceId: ws,
                action: 'decision.closed',
                subjectKind: 'decision',
                subjectId: t.decision_id,
                subjectVersion: closed.rows[0]?.version ?? null,
                contentHash: null,
                payload: { status: 'cancelled', reason: 'workflow_stopped' },
                relatedIds: [wf.run_id],
              });
          }
        }
      }
    }
    const changed =
      plan.actions.length > 0 ||
      plan.state !== wf.state ||
      plan.reason !== wf.reason ||
      plan.terminal !== null;
    if (!changed) return false;
    let result: WorkflowResult | null = null;
    if (plan.terminal) {
      const final = (
        await c.query('select * from workflow_tasks where workflow_id = $1', [
          workflowId,
        ])
      ).rows.map((r: Row) => toTask(r));
      if (discovery) {
        const disposition = disposeDiscovery({
          packet: discovery.packet,
          packet_hash: discovery.packet_hash,
          perspectives: discovery.perspectives,
          excluded: discovery.excluded,
          tasks: final.flatMap((t) =>
            t.context.context_version === 'discovery-context/1'
              ? [{ ...t, context: t.context }]
              : [],
          ),
          stopped_insufficient:
            plan.terminal.outcome === 'insufficient_evidence',
        });
        const catalog_records =
          plan.terminal.state === 'succeeded'
            ? await this.recordDiscovery(
                c,
                ws,
                wf,
                discovery,
                final,
                disposition,
              )
            : { problem: null, alternatives: [] };
        result = {
          outcome: plan.terminal.outcome,
          explanation: plan.terminal.explanation,
          synthesis: null,
          critiques: [],
          fixture: wf.fixture,
          discovery: { ...disposition, catalog_records },
        };
      } else {
        const synthesis = final
          .filter((t) => t.kind === 'synthesis' && t.state === 'succeeded')
          .sort((x, y) => y.repair - x.repair)[0];
        result = {
          outcome: plan.terminal.outcome,
          explanation: plan.terminal.explanation,
          synthesis: synthesis
            ? (validateOutput(
                'synthesis',
                synthesis.output,
              ) as WorkflowResult['synthesis'])
            : null,
          critiques: wf.perspectives.map((p, i) => {
            const t = final
              .filter((x) => x.kind === 'critique' && x.ordinal === i)
              .sort((x, y) => y.repair - x.repair)[0];
            return {
              task_id: t?.id ?? workflowId,
              perspective: p,
              state: t?.state ?? 'cancelled',
              output_hash: t?.output_hash ?? null,
            };
          }),
          fixture: wf.fixture,
        };
      }
    }
    await c.query(
      `update workflows set state = $2, reason = $3, steps = steps + 1, version = version + 1,
         updated_at = now(), result = $4,
         finished_at = case when $4::jsonb is null then null else now() end
       where id = $1`,
      [
        workflowId,
        plan.terminal?.state ?? plan.state,
        plan.reason,
        result ? JSON.stringify(result) : null,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: result ? 'workflow.finished' : 'workflow.state',
      subjectKind: 'workflow',
      subjectId: workflowId,
      subjectVersion: wf.version + 1,
      contentHash: result ? canonicalHash(result) : null,
      payload: result
        ? { outcome: result.outcome, state: plan.terminal?.state }
        : { state: plan.state, reason: plan.reason },
      relatedIds: [wf.run_id],
    });
    if (result) {
      const linked = await c.query(
        'select * from study_attempts where workspace_id=$1 and run_id=$2',
        [ws, wf.run_id],
      );
      const a = linked.rows[0];
      if (a) {
        const study = await c.query(
          'select manifest from studies where id=$1',
          [a.study_id],
        );
        const expired =
          Date.now() >
          new Date(a.created_at).getTime() +
            study.rows[0].manifest.packet.time_cap_seconds * 1000;
        const payload = {
          status: expired
            ? 'failed'
            : result.outcome === 'needs_human'
              ? 'needs_human'
              : plan.terminal?.state === 'succeeded' &&
                  result.outcome !== 'insufficient_evidence'
                ? 'submitted'
                : 'failed',
          summary: result.explanation,
          workflow_id: workflowId,
          outcome: expired ? 'deadline_exceeded' : result.outcome,
          wall_seconds: (Date.now() - new Date(a.created_at).getTime()) / 1000,
          human_active_minutes:
            a.assignment.condition === 'autonomous' ? 0 : null,
          human_wait_seconds:
            a.assignment.condition === 'autonomous' ? 0 : null,
          measurement_source: 'fixture_workflow',
          condition: a.assignment.condition,
          primary: a.assignment.continuation_of === null,
        };
        await c.query(
          "insert into study_events(id,study_id,attempt_id,actor_id,kind,payload,content_hash) values($1,$2,$3,$4,'finished',$5,$6) on conflict do nothing",
          [
            randomUUID(),
            a.study_id,
            a.id,
            ctx.actorId,
            payload,
            canonicalHash(payload),
          ],
        );
      }
    }
    return true;
  }

  private async setTask(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    taskId: string,
    state: TaskState,
    reason: string,
    extra: { context?: TaskContext; output?: unknown } = {},
  ) {
    const terminal = isTerminalTask(state);
    const { rows } = await c.query(
      `update workflow_tasks set state = $2, reason = $3, version = version + 1,
         updated_at = now(), lease_owner = null, lease_expires_at = null,
         context = coalesce($4, context), context_hash = coalesce($5, context_hash),
         output = coalesce($6, output), output_hash = coalesce($7, output_hash),
         finished_at = case when $8::boolean then now() else null end
       where id = $1 returning workflow_id, version`,
      [
        taskId,
        state,
        reason,
        extra.context ? JSON.stringify(extra.context) : null,
        extra.context ? canonicalHash(extra.context) : null,
        extra.output === undefined ? null : JSON.stringify(extra.output),
        extra.output === undefined ? null : canonicalHash(extra.output),
        terminal,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'task.completed',
      subjectKind: 'workflow_task',
      subjectId: taskId,
      subjectVersion: Number(rows[0]?.version),
      contentHash: null,
      payload: { state, reason },
      relatedIds: [String(rows[0]?.workflow_id)],
    });
  }

  /** A discovery workflow's fixed context, with its packet checked against the bound hash. */
  protected async discoveryContextOf(
    c: PoolClient,
    workflowId: string,
  ): Promise<DiscoveryWorkflowContext> {
    const { rows } = await c.query(
      `select context from workflows where id = $1 and role = 'r02_discovery'`,
      [workflowId],
    );
    const d = rows[0]?.context as DiscoveryWorkflowContext | undefined;
    if (!d) throw fail('NOT_FOUND', 'Discovery workflow not found.');
    const packet = parse(EvidencePacketSchema, d.packet);
    if (canonicalHash(packet) !== d.packet_hash)
      throw fail('EVIDENCE_MISMATCH', 'The evidence packet changed.');
    return { ...d, packet };
  }

  /**
   * Writes a finished discovery run into the catalog as the workflow agent: the locator's
   * problem (derived from the brief, supported by the packet's usable problem claims) and one
   * alternative per proposal, whatever its disposition, so later runs can find duplicates and
   * dissent stays attached to the proposal it concerns.
   */
  private async recordDiscovery(
    c: PoolClient,
    ws: string,
    wf: Workflow,
    d: DiscoveryWorkflowContext,
    tasks: WorkflowTask[],
    result: Omit<DiscoveryResult, 'catalog_records'>,
  ): Promise<DiscoveryResult['catalog_records']> {
    const agent: CommandContext = { actorId: ORCHESTRATOR_ACTOR_ID };
    const clip = (v: string, n: number) =>
      v.length > n ? `${v.slice(0, n - 1)}…` : v;
    const locate = tasks.find((t) => t.id === result.locator?.task_id);
    const out = locate?.output as LocatorOutput | undefined;
    if (!out) return { problem: null, alternatives: [] };
    const link = async (
      relation: 'derived_from' | 'supports',
      from: { id: string; kind: string; version: number },
      to: { id: string; kind: string; version: number },
      rationale: string,
    ) => {
      const linkId = randomUUID();
      await c.query(
        `insert into entity_links (id, workspace_id, relation, from_id, from_kind, from_version,
           to_id, to_kind, to_version, rationale, asserted_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
        [
          linkId,
          ws,
          relation,
          from.id,
          from.kind,
          from.version,
          to.id,
          to.kind,
          to.version,
          clip(rationale, 500),
          agent.actorId,
        ],
      );
      await this.append(c, agent, {
        workspaceId: ws,
        action: 'link.created',
        subjectKind: 'link',
        subjectId: linkId,
        subjectVersion: null,
        contentHash: null,
        payload: {
          relation,
          from_kind: from.kind,
          from_version: from.version,
          to_kind: to.kind,
          to_version: to.version,
        },
        relatedIds: [from.id, to.id],
      });
    };
    const create = async (
      kind: 'problem' | 'alternative',
      title: string,
      body: Record<string, unknown>,
    ) =>
      this.insertEntity(
        c,
        agent,
        ws,
        kind,
        clip(title, 500),
        (StoredBodySchemas[kind] as z.ZodType).parse(body) as Record<
          string,
          unknown
        >,
      );
    const problem = await create(
      'problem',
      `${d.packet.brief.title}: ${out.observable_problem}`,
      {
        statement: clip(out.problem_statement, 2000),
        affected_group: clip(out.affected_users, 500),
        uncertainty: clip(
          `Discovery run ${wf.id} (${wf.fixture ? 'fixture' : 'real'}): locator rated the evidence ${out.evidence_strength.replace('_', ' ')}; packet ${d.packet.sufficiency.verdict}. ${d.packet.sufficiency.reasons.join(' ')}`,
          2000,
        ),
      },
    );
    const ref = (e: { id: string; kind: string; version: number }) => ({
      id: e.id,
      kind: e.kind,
      version: e.version,
    });
    await link(
      'derived_from',
      ref(problem),
      {
        id: d.packet.brief.id,
        kind: 'search_brief',
        version: d.packet.brief.version,
      },
      `Narrowed from this search brief by discovery run ${wf.id}.`,
    );
    for (const claim of d.packet.claims)
      if (
        claim.bears_on.includes('problem') &&
        (claim.status === 'supported' || claim.status === 'contested')
      )
        await link(
          'supports',
          { id: claim.claim_id, kind: 'claim', version: claim.version },
          ref(problem),
          `Packet ${claim.ref}, evidence ${claim.status} when the run started.`,
        );
    const alternatives: DiscoveryResult['catalog_records']['alternatives'] = [];
    for (const p of result.proposals) {
      const t = tasks.find((x) => x.id === p.task_id);
      const o = t?.output as ProposalOutput | undefined;
      if (!o) continue;
      const alt = await create('alternative', o.title, {
        kind: RESPONSE_OUTCOME[p.perspective],
        rationale: clip(
          `${o.mechanism} Software warranted: ${o.software_warranted.verdict}. ${o.software_warranted.reason}`,
          2000,
        ),
        tradeoffs: [
          `Feasibility: ${o.feasibility}`,
          `Maintenance: ${o.maintenance}`,
          ...o.assumptions.map((a) => `Assumes: ${a.statement}`),
        ].map((x) => clip(x, 500)),
        uncertainty: clip(
          `Disposition: ${p.disposition}. ${p.reasons.join(' ')}${p.dissent.length ? ` Dissent: ${p.dissent.join(' | ')}` : ''}`,
          2000,
        ),
      });
      await link(
        'derived_from',
        ref(alt),
        ref(problem),
        `${p.proposal} (${p.perspective}) from discovery run ${wf.id}.`,
      );
      alternatives.push({
        proposal: p.proposal,
        id: alt.id,
        version: alt.version,
      });
    }
    return {
      problem: { id: problem.id, version: problem.version },
      alternatives,
    };
  }

  /** Runs one coordinator step for a workflow (worker ticks, deadlines, owner controls). */
  async coordinateWorkflow(ctx: CommandContext, workflowId: string) {
    ctx = normalize(ctx);
    workflowId = uuid(workflowId);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        'select workspace_id from workflows where id = $1',
        [workflowId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Workflow not found.');
      const ws = String(rows[0].workspace_id);
      await this.role(c, ws, ctx.actorId, true);
      return this.coordinateIn(c, ctx, ws, workflowId);
    });
  }
  async liveWorkflowIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      'select id from workflows where finished_at is null order by created_at',
    );
    return rows.map((r) => r.id);
  }

  // ---- Owner control ------------------------------------------------------------------

  /**
   * Pause stops new dispatch; cancel also stops delegation and asks running workers to stop
   * their calls, whose exposure stays held. Resume continues from the durable state.
   */
  async controlWorkflow(
    ctx: CommandContext,
    ws: string,
    workflowId: string,
    control: 'pause' | 'resume' | 'cancel',
    raw: unknown,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    const req = parse(WorkflowControlRequestSchema, raw);
    await this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const wf = await this.lockWorkflow(c, workflowId);
      if (wf.workspace_id !== ws)
        throw fail('NOT_FOUND', 'Workflow not found.');
      if (wf.version !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The workflow changed; reload it.');
      if (wf.finished_at)
        throw fail('INVALID_TRANSITION', 'The workflow has finished.');
      const next = control === 'resume' ? 'run' : control;
      if (wf.control === 'cancel')
        throw fail('INVALID_TRANSITION', 'A cancelled workflow cannot change.');
      await c.query(
        `update workflows set control = $2, version = version + 1, updated_at = now() where id = $1`,
        [workflowId, next],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'workflow.control',
        subjectKind: 'workflow',
        subjectId: workflowId,
        subjectVersion: wf.version + 1,
        contentHash: null,
        payload: { control, reason: req.reason },
        relatedIds: [wf.run_id],
      });
      await this.coordinateIn(c, ctx, ws, workflowId);
    });
    return this.getWorkflow(ctx, ws, workflowId);
  }

  /** Cancelling a run (T03) also cancels its live workflow in the same request. */
  override async cancelRun(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ) {
    const run = await super.cancelRun(ctx, ws, runId, raw);
    const req = parse(CancelRunRequestSchema, raw);
    const { rows } = await this.pool.query<{ id: string; version: number }>(
      `select id, version from workflows where workspace_id = $1 and run_id = $2
         and finished_at is null and control <> 'cancel'`,
      [run.workspace_id, run.run_id],
    );
    for (const w of rows)
      await this.controlWorkflow(ctx, run.workspace_id, w.id, 'cancel', {
        expected_version: w.version,
        reason: req.reason,
      });
    return run;
  }

  // ---- Leases -------------------------------------------------------------------------

  /**
   * Leases up to `max` runnable tasks to one worker, respecting each workflow's concurrency.
   * Workflows are locked with SKIP LOCKED, so two workers never lease the same task, and every
   * lease takes a fresh fencing token.
   */
  async claimTasks(
    ctx: CommandContext,
    workerId: string,
    max: number,
    leaseMs: number,
  ): Promise<TaskLease[]> {
    ctx = normalize(ctx);
    if (max <= 0) return [];
    return this.tx(async (c) => {
      const { rows: wfs } = await c.query(
        `select w.* from workflows w
          where w.finished_at is null and w.control = 'run'
            and exists (select 1 from workflow_tasks t where t.workflow_id = w.id and t.state = 'queued')
          order by w.created_at for update skip locked`,
      );
      const leases: TaskLease[] = [];
      for (const raw of wfs) {
        if (leases.length >= max) break;
        const wf = toWorkflow(raw as Row);
        if (
          await portfolioActionGate(
            c,
            wf.workspace_id,
            wf.run_id,
            'model.generate',
          )
        )
          continue;
        const { rows: busy } = await c.query<{ n: string }>(
          `select count(*) as n from workflow_tasks where workflow_id = $1 and state = 'leased'`,
          [wf.id],
        );
        const room = Math.min(
          wf.limits.max_concurrency - Number(busy[0]?.n ?? 0),
          max - leases.length,
        );
        if (room <= 0) continue;
        const { rows } = await c.query(
          `update workflow_tasks set state = 'leased', lease_owner = $2,
             lease_token = nextval('workflow_lease_tokens'),
             lease_expires_at = now() + make_interval(secs => $3::double precision / 1000),
             deliveries = deliveries + 1, version = version + 1, updated_at = now(),
             reason = 'leased'
           where id in (select id from workflow_tasks where workflow_id = $1 and state = 'queued'
                        order by created_at, ordinal limit $4)
           returning *`,
          [wf.id, workerId, leaseMs, room],
        );
        for (const r of rows) {
          const task = toTask(r as Row);
          await this.append(c, ctx, {
            workspaceId: wf.workspace_id,
            action: 'task.leased',
            subjectKind: 'workflow_task',
            subjectId: task.id,
            subjectVersion: task.version,
            contentHash: task.context_hash,
            payload: {
              worker: workerId,
              delivery: task.deliveries,
              lease_token: task.lease_token,
            },
            relatedIds: [wf.id],
          });
          const critiques = [];
          let discovery: TaskLease['discovery'] = null;
          const output = async (taskId: string, hash: string) => {
            const { rows: src } = await c.query(
              'select output, output_hash from workflow_tasks where id = $1 and workflow_id = $2',
              [taskId, wf.id],
            );
            if (src[0]?.output_hash !== hash)
              throw fail('EVIDENCE_MISMATCH', 'A task input changed.');
            return src[0]?.output as unknown;
          };
          if (task.context.context_version === 'discovery-context/1') {
            const d = await this.discoveryContextOf(c, wf.id);
            if (d.packet_hash !== task.context.packet_hash)
              throw fail('EVIDENCE_MISMATCH', 'The evidence packet changed.');
            const inputs: DiscoveryInput[] = [];
            for (const input of task.context.inputs)
              inputs.push({
                label: input.label,
                kind: input.kind,
                output: await output(input.task_id, input.output_hash),
              });
            discovery = { packet: d.packet, inputs };
          } else
            for (const input of task.context.inputs)
              critiques.push({
                perspective: input.perspective,
                output: await output(input.task_id, input.output_hash),
              });
          leases.push({
            task,
            token: String(task.lease_token),
            workspaceId: wf.workspace_id,
            runId: wf.run_id,
            workflowId: wf.id,
            envelopeId: wf.envelope_id,
            pricingSnapshotId: wf.pricing_snapshot_id,
            dataClass: wf.data_class,
            limits: wf.limits,
            critiques,
            discovery,
          });
        }
      }
      return leases;
    });
  }

  /** Extends a lease the worker still holds; reports whether the owner asked to cancel. */
  async heartbeat(
    taskId: string,
    token: string,
    leaseMs: number,
  ): Promise<{ held: boolean; cancel: boolean }> {
    const { rows } = await this.pool.query<{ control: string }>(
      // "t.version": workflows also has a version column, and an ambiguous reference made every
      // heartbeat fail (and the worker swallowed it), so leases were never extended.
      `update workflow_tasks t set lease_expires_at = now() + make_interval(secs => $3::double precision / 1000),
         version = t.version + 1
       from workflows w
       where t.id = $1 and t.lease_token = $2 and t.state = 'leased' and w.id = t.workflow_id
       returning w.control`,
      [uuid(taskId), token, leaseMs],
    );
    return {
      held: rows.length === 1,
      cancel: rows[0]?.control === 'cancel',
    };
  }

  /**
   * Commits a task outcome only for the current lease holder (fencing). A worker whose lease
   * expired and was re-leased gets LEASE_LOST and nothing it did is committed here; any
   * provider call it made is still recorded by the broker under the task's logical operation.
   */
  async commitTask(
    ctx: CommandContext,
    taskId: string,
    token: string,
    outcome: TaskOutcome,
  ): Promise<WorkflowTask> {
    ctx = normalize(ctx);
    taskId = uuid(taskId);
    return this.tx(async (c) => {
      const peek = await c.query(
        'select workspace_id, workflow_id from workflow_tasks where id = $1',
        [taskId],
      );
      const p = peek.rows[0] as Row | undefined;
      if (!p) throw fail('NOT_FOUND', 'Task not found.');
      const ws = String(p.workspace_id);
      await this.role(c, ws, ctx.actorId, true);
      await this.lockWorkflow(c, String(p.workflow_id));
      const held = await c.query(
        `select 1 from workflow_tasks where id = $1 and state = 'leased' and lease_token = $2 for update`,
        [taskId, token],
      );
      if (!held.rowCount)
        throw fail(
          'LEASE_LOST',
          'This worker no longer holds the task; its result was not committed.',
        );
      if (outcome.state === 'waiting_human')
        await c.query(
          `update workflow_tasks set decision_id = $2, version = version + 1 where id = $1`,
          [taskId, outcome.decisionId],
        );
      await this.setTask(
        c,
        ctx,
        ws,
        taskId,
        outcome.state,
        outcome.reason,
        outcome.state === 'succeeded' ? { output: outcome.output } : {},
      );
      await this.coordinateIn(c, ctx, ws, String(p.workflow_id));
      return toTask(
        (await c.query('select * from workflow_tasks where id = $1', [taskId]))
          .rows[0] as Row,
      );
    });
  }

  /**
   * Requeues tasks whose worker stopped renewing its lease. The fencing token stays, so the
   * lost worker still cannot commit; the next lease replays the logical operation through
   * the broker, which never dispatches it twice. Cancelled workflows cancel instead.
   */
  async sweepLeases(ctx: CommandContext): Promise<number> {
    ctx = normalize(ctx);
    const { rows } = await this.pool.query<{ id: string; workflow_id: string }>(
      `select id, workflow_id from workflow_tasks where state = 'leased' and lease_expires_at < now()`,
    );
    let n = 0;
    for (const r of rows)
      n += await this.tx(async (c) => {
        const wf = await this.lockWorkflow(c, r.workflow_id);
        const { rows: t } = await c.query(
          `select * from workflow_tasks where id = $1 and state = 'leased' and lease_expires_at < now() for update`,
          [r.id],
        );
        const task = t[0] as Row | undefined;
        if (!task) return 0;
        const state = wf.control === 'cancel' ? 'cancelled' : 'queued';
        await c.query(
          `update workflow_tasks set state = $2, reason = 'lease_expired', lease_owner = null,
             lease_expires_at = null, version = version + 1, updated_at = now(),
             finished_at = case when $2 = 'cancelled' then now() else null end
           where id = $1`,
          [r.id, state],
        );
        await this.append(c, ctx, {
          workspaceId: wf.workspace_id,
          action: 'task.lease_expired',
          subjectKind: 'workflow_task',
          subjectId: r.id,
          subjectVersion: Number(task.version) + 1,
          contentHash: null,
          payload: { worker: String(task.lease_owner), state },
          relatedIds: [wf.id],
        });
        await this.coordinateIn(c, ctx, wf.workspace_id, wf.id);
        return 1;
      });
    return n;
  }

  // ---- Decisions and unknown outcomes --------------------------------------------------

  /** Outbox consumer: an answered or closed decision wakes the task waiting on it. */
  protected override async consume(c: PoolClient, event: Row): Promise<void> {
    if (
      event.action !== 'decision.answered' &&
      event.action !== 'decision.closed'
    )
      return;
    const claim = await c.query(
      'insert into consumer_inbox (consumer, event_id) values ($1, $2) on conflict do nothing',
      [WAKEUP_CONSUMER, event.id],
    );
    if (!claim.rowCount) return;
    await this.wakeIn(
      c,
      { actorId: ORCHESTRATOR_ACTOR_ID },
      String(event.subject_id),
    );
  }

  /** Same wake-up by polling, for a decision closed before its task recorded the wait. */
  async wakeWaiting(ctx: CommandContext): Promise<number> {
    ctx = normalize(ctx);
    const { rows } = await this.pool.query<{ decision_id: string }>(
      `select distinct t.decision_id from workflow_tasks t join decision_requests d on d.id = t.decision_id
        where t.state = 'waiting_human' and d.status <> 'pending'`,
    );
    let n = 0;
    for (const r of rows)
      n += await this.tx((c) => this.wakeIn(c, ctx, r.decision_id));
    return n;
  }

  private async wakeIn(c: PoolClient, ctx: CommandContext, decisionId: string) {
    const { rows: d } = await c.query(
      'select status, response from decision_requests where id = $1',
      [decisionId],
    );
    const decision = d[0] as Row | undefined;
    if (!decision || decision.status === 'pending') return 0;
    const { rows: waiting } = await c.query<{
      id: string;
      workflow_id: string;
    }>(
      `select id, workflow_id from workflow_tasks where decision_id = $1 and state = 'waiting_human'`,
      [decisionId],
    );
    const choice = (decision.response as Row | null)?.choice;
    const approved =
      decision.status === 'answered' &&
      (choice === 'approve_once' || choice === 'approve_standing');
    for (const t of waiting) {
      const wf = await this.lockWorkflow(c, t.workflow_id);
      const { rows } = await c.query(
        `update workflow_tasks set state = $2, reason = $3, version = version + 1,
           updated_at = now(), finished_at = case when $2 = 'failed' then now() else null end
         where id = $1 and state = 'waiting_human' returning version`,
        [
          t.id,
          approved ? 'queued' : 'failed',
          approved ? 'decision_approved' : 'human_declined',
        ],
      );
      if (!rows.length) continue;
      await this.append(c, ctx, {
        workspaceId: wf.workspace_id,
        action: 'task.woken',
        subjectKind: 'workflow_task',
        subjectId: t.id,
        subjectVersion: Number(rows[0]?.version),
        contentHash: null,
        payload: {
          state: approved ? 'queued' : 'failed',
          decision_id: decisionId,
        },
        relatedIds: [wf.id, decisionId],
      });
      await this.coordinateIn(c, ctx, wf.workspace_id, wf.id);
    }
    return waiting.length;
  }

  /**
   * A task whose call had an unknown outcome waits here, never auto-retried. A late provider
   * answer recorded by the broker completes it; owner reconciliation without an answer ends
   * it as failed with its exposure accounted for.
   */
  async reconcileTasks(ctx: CommandContext): Promise<number> {
    ctx = normalize(ctx);
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from workflow_tasks where state = 'reconciling'`,
    );
    let n = 0;
    for (const r of rows)
      n += await this.tx(async (c) => {
        const { rows: tr } = await c.query(
          'select workflow_id from workflow_tasks where id = $1',
          [r.id],
        );
        const wf = await this.lockWorkflow(c, String(tr[0]?.workflow_id));
        const { rows: t } = await c.query(
          `select * from workflow_tasks where id = $1 and state = 'reconciling' for update`,
          [r.id],
        );
        if (!t[0]) return 0;
        const task = toTask(t[0] as Row);
        const { rows: att } = await c.query(
          `${RESERVATION_SELECT} where r.logical_operation_id = $1 and r.status <> 'denied'
           order by r.attempt desc limit 1`,
          [task.logical_operation_id],
        );
        const a = att[0] as Row | undefined;
        if (!a || a.status === 'in_flight' || a.status === 'unknown') return 0;
        const stored = (a.result ?? {}) as {
          status?: string;
          reason_code?: string;
          output?: { json?: unknown };
        };
        let outcome: TaskOutcome;
        if (a.status === 'settled' && stored.status === 'succeeded') {
          const output = validateOutput(
            task.kind,
            stored.output?.json,
            isDiscoveryKind(task.kind)
              ? {
                  packet: (await this.discoveryContextOf(c, wf.id)).packet,
                  context: task.context,
                }
              : undefined,
          );
          outcome = output
            ? { state: 'succeeded', reason: 'late_result', output }
            : { state: 'failed', reason: 'invalid_output' };
        } else if (a.status === 'settled' && stored.status === 'failed')
          outcome = { state: 'failed', reason: stored.reason_code ?? 'failed' };
        else
          outcome = {
            state: 'failed',
            reason: 'outcome_reconciled_without_result',
          };
        await this.setTask(
          c,
          ctx,
          wf.workspace_id,
          task.id,
          outcome.state,
          outcome.reason,
          outcome.state === 'succeeded' ? { output: outcome.output } : {},
        );
        await this.coordinateIn(c, ctx, wf.workspace_id, wf.id);
        return 1;
      });
    return n;
  }
}

function usageOf(reservations: Reservation[]) {
  let reserved = 0n;
  let incurred = 0n;
  let unknown = 0n;
  let inFlight = 0;
  for (const r of reservations) {
    if (r.status === 'in_flight') {
      reserved += BigInt(r.reserved);
      inFlight += 1;
    }
    if (r.status === 'unknown') unknown += BigInt(r.reserved);
    if (r.incurred) incurred += BigInt(r.incurred);
  }
  return {
    attempts: reservations.filter((r) => r.status !== 'denied').length,
    reserved: String(reserved),
    incurred: String(incurred),
    unknown: String(unknown),
    in_flight: inFlight,
  };
}
import {
  portfolioActionGate,
  portfolioEffectFence,
} from './portfolio-gates.js';
import {
  activeKnowledgeConstraints,
  bindWorkflowKnowledge,
} from './knowledge-context.js';
