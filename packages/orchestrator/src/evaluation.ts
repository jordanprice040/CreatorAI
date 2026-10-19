import { randomBytes, randomUUID } from 'node:crypto';
import { ContractError, type StudyInput } from '@creator/contracts';
import type { StudyStore, CommandContext } from '@creator/db';
import type { ModelBroker } from '@creator/broker';
import {
  BLOCKING_DECISIONS,
  EVALUATION_VERSION,
  PILOT_AUTONOMY,
  REVIEWER_RUBRIC,
  admitSlot,
  blindedPackets,
  buildSchedule,
  canonicalHash,
  flowTable,
  rehearsalFreeze,
  scanBlinding,
  type Admission,
  type AttemptRecord,
  type EvaluationAuthority,
  type EvaluationSchedule,
  type EvaluationTask,
  type FrozenProtocol,
  type ReviewItem,
  type ScheduleSlot,
} from '@creator/domain';
import { Worker } from './worker.js';

const SENTINELS = ['EVAL_OTHER_ARM_SENTINEL', 'EVAL_GRADER_SENTINEL'];
const SCRIPTED = 'Scripted rehearsal entry; not participant work.';
const REVIEWERS = ['reviewer-1', 'reviewer-2'];

function rehearsalTask(
  key: string,
  role: EvaluationTask['role'],
  stratum: 'decision' | 'implementation',
  problem: string,
  outcome: string,
): EvaluationTask {
  return {
    key,
    role,
    packet: {
      version: `eval-rehearsal-${key}/1`,
      stratum,
      problem,
      initial_resources: [
        {
          locator: `fixture://eval-rehearsal/${key}`,
          snapshot: `Synthetic note for ${key}; not a verified source.`,
        },
      ],
      outcome,
      structured_brief: {
        theme: `Fictional ${key}`,
        fields: ['operations', 'information design'],
        target_users: 'Fictional staff',
        context: null,
        measurable_problem: problem,
        outcome_measure: outcome,
        data_and_tools: ['Synthetic note'],
        time_limit: 'One hour',
        budget_limit: 'Synthetic fixture budget only',
        nae_seed: null,
        constraints: ['Synthetic rehearsal task; no empirical conclusions.'],
      },
      time_cap_seconds: stratum === 'implementation' ? 5400 : 3600,
    },
  };
}

/** Synthetic stand-ins in the frozen counts; never final tasks (RD8 picks those). */
export function rehearsalTasks(): EvaluationTask[] {
  const ask =
    'Recommend a response, alternatives considered and a validation plan.';
  return [
    rehearsalTask(
      'decision-1',
      'autonomy',
      'decision',
      'A fictional food pantry runs out of one staple every week.',
      ask,
    ),
    rehearsalTask(
      'decision-2',
      'autonomy',
      'decision',
      'A fictional choir loses sheet music between rehearsals.',
      ask,
    ),
    rehearsalTask(
      'decision-3',
      'autonomy',
      'decision',
      'A fictional garden club double-books its shared plots.',
      ask,
    ),
    rehearsalTask(
      'decision-4',
      'autonomy',
      'decision',
      'A fictional repair cafe cannot tell which repairs held up.',
      ask,
    ),
    rehearsalTask(
      'build-1',
      'autonomy',
      'implementation',
      'A fictional clinic needs a CLI that counts missed appointments per week.',
      'A tested Python CLI that meets the frozen acceptance cases.',
    ),
    rehearsalTask(
      'build-2',
      'autonomy',
      'implementation',
      'A fictional library needs a CLI that lists overdue items from a CSV.',
      'A tested Python CLI that meets the frozen acceptance cases.',
    ),
    rehearsalTask(
      'theme-1',
      'discovery',
      'decision',
      'Fictional tenants cannot tell when shared laundry machines are free.',
      'Propose up to three responses with evidence and uncertainty.',
    ),
    rehearsalTask(
      'theme-2',
      'discovery',
      'decision',
      'Fictional volunteers miss last-minute shift changes.',
      'Propose up to three responses with evidence and uncertainty.',
    ),
  ];
}

function studyFor(task: EvaluationTask, seed: string): StudyInput {
  return {
    ...PILOT_AUTONOMY,
    title: `Evaluation rehearsal: ${task.key}`,
    protocol: {
      version: `${EVALUATION_VERSION}-rehearsal`,
      text: 'Rehearsal of the frozen schedule on synthetic tasks. Plumbing only; not a final task.',
    },
    packet: task.packet,
    primary_outcomes: ['Not rated in the rehearsal'],
    assignment_seed: `${seed}:${task.key}`,
  };
}

interface Collected {
  slot: ScheduleSlot;
  attempt: Record<string, unknown> & { id: string; workspace_id: string };
  events: { kind: string; payload: Record<string, unknown> }[];
  context: unknown;
  human_source: AttemptRecord['human_source'];
}

/** Separate evidence: executed source/functional checks never mix with model self-ratings. */
function evidenceSections(
  collected: Collected[],
  tasks: Map<string, EvaluationTask>,
) {
  return {
    source_support_audits: collected
      .filter((c) => c.slot.discovery_method !== 'human_defined')
      .map((c) => ({
        slot_id: c.slot.slot_id,
        attempt_id: c.attempt.id,
        sources: tasks
          .get(c.slot.task_key)!
          .packet.initial_resources.map((r) => ({
            locator: r.locator,
            verified: false,
            basis:
              'Packet snapshot, not fetched through the source broker (RD9).',
          })),
        run_outcome:
          c.events.find((e) => e.kind === 'finished')?.payload.outcome ?? null,
      })),
    functional_checks: collected.flatMap((c) =>
      c.events
        .filter((e) => e.kind === 'tests')
        .map((e) => ({
          slot_id: c.slot.slot_id,
          attempt_id: c.attempt.id,
          ...e.payload,
        })),
    ),
    model_self_ratings: {
      used_as_ratings: false,
      records: [] as unknown[],
      note: 'No run produced a self-rating. Self-ratings are never used as reviewer ratings.',
    },
  };
}

function check(id: string, ok: boolean, detail: string) {
  return { id, status: ok ? ('pass' as const) : ('fail' as const), detail };
}

/** Builds the package from the schedule, admissions and whatever actually ran. */
export function assemblePackage(input: {
  mode: 'final' | 'rehearsal';
  schedule: EvaluationSchedule;
  tasks: EvaluationTask[];
  admissions: Map<string, Admission>;
  deferred: Map<string, string>;
  collected: Collected[];
  exports: {
    key: string;
    first: { export_hash: string };
    second: { export_hash: string };
    body: unknown;
  }[];
  forbidden: string[];
  secret: string;
}) {
  const tasks = new Map(input.tasks.map((t) => [t.key, t]));
  const bySlot = new Map<string, AttemptRecord[]>();
  for (const c of input.collected) {
    const finish = c.events.find((e) => e.kind === 'finished')?.payload ?? null;
    const m = c.attempt.measurements as Record<string, unknown>;
    const list = bySlot.get(c.slot.slot_id) ?? [];
    list.push({
      attempt_id: c.attempt.id,
      state: String(c.attempt.state),
      finish,
      measurements: m,
      produced_output:
        c.events.some((e) => e.kind === 'artifacts') || Number(m.calls) > 0,
      human_source: c.human_source,
    });
    bySlot.set(c.slot.slot_id, list);
  }
  const flow = flowTable(
    input.schedule,
    input.admissions,
    bySlot,
    input.deferred,
  );

  const items: ReviewItem[] = [];
  for (const c of input.collected) {
    if (c.slot.stratum !== 'decision') continue;
    if (bySlot.get(c.slot.slot_id)!.at(-1)!.attempt_id !== c.attempt.id)
      continue;
    const task = tasks.get(c.slot.task_key)!;
    const docs = c.events.filter((e) => e.kind === 'artifacts');
    items.push({
      slot_id: c.slot.slot_id,
      attempt_id: c.attempt.id,
      task_key: c.slot.task_key,
      problem: task.packet.problem,
      outcome: task.packet.outcome,
      text: docs.length ? String(docs.at(-1)!.payload.content) : null,
    });
  }
  const blind = blindedPackets({
    items,
    reviewers: REVIEWERS,
    secret: input.secret,
  });
  const scan = scanBlinding(
    blind.files,
    input.forbidden,
    input.tasks.flatMap((t) => [t.packet.problem, t.packet.outcome]),
  );

  const terminal = new Set([
    'submitted',
    'failed',
    'cancelled',
    'needs_human',
    'budget_exhausted',
  ]);
  const notRun = flow.filter((f) =>
    ['blocked', 'deferred', 'missing'].includes(f.state),
  );
  const ran = flow.filter((f) => f.attempts.length);
  const checks = [
    check(
      'flow.every_slot_once',
      flow.length === input.schedule.slots.length &&
        new Set(flow.map((f) => f.slot_id)).size === flow.length,
      `${flow.length} scheduled slots, each listed once.`,
    ),
    check(
      'flow.truthful_terminal',
      ran.every((f) => terminal.has(f.state)) &&
        !flow.some((f) => f.state === 'missing'),
      `${ran.length} slots ran and ended in a terminal state; ${notRun.length} did not run and say why.`,
    ),
    check(
      'packets.identical_across_arms',
      input.collected.every(
        (c) =>
          (c.attempt.context_manifest as { packet_hash: string })
            .packet_hash === c.slot.task_hash,
      ),
      'Every attempt received exactly the scheduled packet for its task.',
    ),
    check(
      'versions.matched',
      new Set(
        input.exports.map((e) => {
          const h = (e.body as { manifest: { hashes: Record<string, string> } })
            .manifest.hashes;
          return canonicalHash([
            h.config,
            h.rubric,
            h.prompts,
            h.model_version,
            h.pricing_version,
          ]);
        }),
      ).size <= 1,
      'All task studies share one config, rubric, prompt, model and pricing version.',
    ),
    check(
      'contamination.no_cross_arm_or_grader_text',
      input.collected.every((c) =>
        SENTINELS.every((s) => !JSON.stringify(c.context).includes(s)),
      ),
      'No other-arm output or hidden grading material appears in any runtime context.',
    ),
    check(
      'contamination.human_only_no_model',
      input.collected
        .filter((c) => c.slot.condition === 'human_only')
        .every(
          (c) =>
            Number(
              (c.attempt.measurements as Record<string, unknown>).calls,
            ) === 0,
        ),
      'Human-only attempts recorded no admitted model call.',
    ),
    check(
      'contamination.separate_workspaces',
      new Set(input.collected.map((c) => c.attempt.workspace_id)).size ===
        input.collected.length,
      'Each attempt has its own workspace.',
    ),
    check(
      'reviewer.blinding',
      scan.failures.length === 0,
      scan.failures.length
        ? scan.failures.join(' ')
        : `${Object.keys(blind.files).length} reviewer files: no hidden metadata in filenames, templates or ids.`,
    ),
    check(
      'reviewer.key_complete',
      items.every((i) =>
        Object.values(blind.key.codes).some(
          (k) => k.attempt_id === i.attempt_id,
        ),
      ) && Object.keys(blind.key.codes).length === items.length,
      `The private key maps all ${items.length} reviewed items, one code each.`,
    ),
    check(
      'export.repeatable',
      input.exports.every((e) => e.first.export_hash === e.second.export_hash),
      `${input.exports.length} study exports re-exported to identical hashes.`,
    ),
  ];
  const body = {
    schema_version: 'evaluation-package/1',
    evaluation_version: EVALUATION_VERSION,
    mode: input.mode,
    empirical_results: false,
    evidence_kind:
      input.mode === 'rehearsal'
        ? 'Rehearsal: fixture AI arms and scripted human entries on synthetic tasks. Plumbing only.'
        : 'Final schedule. Runs that did not execute are listed with the reason.',
    freeze: {
      origin: input.schedule.freeze_origin,
      freeze_hash: input.schedule.freeze_hash,
    },
    schedule: input.schedule,
    flow,
    counts: Object.fromEntries(
      [...new Set(flow.map((f) => f.state))].map((s) => [
        s,
        flow.filter((f) => f.state === s).length,
      ]),
    ),
    ...evidenceSections(input.collected, tasks),
    reviewer_packets: {
      rubric: REVIEWER_RUBRIC.version,
      reviewers: REVIEWERS,
      items: items.length,
      owner_review_flags: scan.flags,
      sent: false,
      note: 'Packets are written to disk only. Nothing is sent to anyone without an explicit instruction.',
    },
    checks,
    raw_export_hashes: input.exports.map((e) => ({
      task_key: e.key,
      export_hash: e.first.export_hash,
    })),
  };
  const reproducible = {
    schedule_hash: input.schedule.schedule_hash,
    flow: flow.map((f) => [f.slot_id, f.state, f.outcome, f.attempts.length]),
    checks: checks.map((c) => [c.id, c.status]),
    reviewed_slots: items.map((i) => i.slot_id).sort(),
  };
  return {
    package: {
      ...body,
      reproducible_digest: canonicalHash(reproducible),
      package_hash: canonicalHash(body),
    },
    reviewer_files: blind.files,
    private_key: blind.key,
    raw_exports: input.exports.map((e) => ({ key: e.key, body: e.body })),
  };
}

/**
 * Executes the frozen schedule shape on synthetic tasks through the real study store, broker
 * and workflow worker, one run at a time. It uses a labelled rehearsal freeze, never the
 * owner's, and its output is never an evaluation result.
 */
export async function runEvaluationRehearsal(
  store: StudyStore,
  broker: ModelBroker,
  owner: CommandContext,
  options: { seed?: string; secret?: string } = {},
) {
  const seed = options.seed ?? 'eval-rehearsal-seed-1';
  const tasks = rehearsalTasks();
  const freeze = rehearsalFreeze();
  const schedule = buildSchedule(freeze, tasks, seed);
  const authority: EvaluationAuthority = {
    mode: 'rehearsal',
    live_ai: { enabled: false, verified_model_id: null },
    final_study_records: false,
    ai_implementation: false,
  };
  const admissions = new Map(
    schedule.slots.map((s) => [s.slot_id, admitSlot(s, authority)]),
  );
  // Exercises the deferral path: the owner may defer a slot; it stays in the table.
  const deferred = new Map<string, string>();
  const lastOpen = schedule.slots.filter((s) => s.arm === 'D-open').at(-1)!;
  deferred.set(lastOpen.slot_id, 'Rehearsal deferral to exercise the ledger.');

  const reviewer = randomUUID();
  await store.ensureActor({
    id: reviewer,
    kind: 'human',
    display_name: 'Evaluation reviewer identity (rehearsal, no person)',
  });
  const ws = await store.createWorkspace(owner, {
    name: `T15 evaluation rehearsal ${new Date().toISOString().slice(0, 10)}`,
    record_mode: 'fixture',
  });
  const studies = new Map<string, { id: string; manifest_hash: string }>();
  for (const t of tasks) {
    const s = await store.createStudy(owner, ws.id, studyFor(t, seed));
    await store.grantGrader(owner, ws.id, s.id, { actor_id: reviewer });
    await store.graderMaterial({ actorId: reviewer }, ws.id, s.id, {
      kind: 'hidden_test',
      content: SENTINELS[1]!,
    });
    studies.set(t.key, s);
  }
  const slotOf = new Map<string, ScheduleSlot>();
  const sourceOf = new Map<string, AttemptRecord['human_source']>();
  // Scripted cancellation on one human-only slot exercises the cancelled path.
  const cancelSlot = schedule.slots.find(
    (s) => s.arm === 'C' && s.task_key === 'decision-4',
  )!.slot_id;
  const worker = new Worker(store, broker);
  for (const slot of schedule.slots) {
    const admission = admissions.get(slot.slot_id)!;
    if (!admission.admitted || deferred.has(slot.slot_id)) continue;
    const study = studies.get(slot.task_key)!;
    const a = await store.assignStudy(owner, ws.id, study.id, {
      manifest_hash: study.manifest_hash,
      comparison: slot.comparison,
      participant_actor_id: owner.actorId,
      participant_code: 'rehearsal-operator',
      prior_familiarity:
        'Scripted rehearsal by the operator; not an independent participant.',
      condition: slot.condition,
      discovery_method: slot.discovery_method,
      continuation_of: null,
    });
    slotOf.set(a.id, slot);
    sourceOf.set(a.id, admission.human ?? 'none');
    if (slot.arm === 'B') {
      await store.writeAttempt(owner, ws.id, a.id, 'interventions', {
        type: 'judgment',
        gate: 'fixed',
        reason: 'Frozen fixed gate before selection',
        trigger: 'protocol gate',
        stage: 'selection',
        data_shown: 'Frozen packet only',
        human_input: SCRIPTED,
        resulting_change: 'None (rehearsal)',
        prevented_problem: 'unknown',
        human_active_minutes: 0,
        wait_seconds: 0,
      });
      await store.writeAttempt(owner, ws.id, a.id, 'artifacts', {
        kind: 'document',
        name: 'Assisted note',
        content: `Rehearsal text, no participant: ${SENTINELS[0]}`,
      });
    }
    if (slot.arm === 'C') {
      for (const helper of ['model.generate', 'model.complete', 'discovery'])
        await store.writeAttempt(owner, ws.id, a.id, 'helpers', { helper });
      if (slot.slot_id === cancelSlot) {
        await store.writeAttempt(owner, ws.id, a.id, 'finish', {
          status: 'cancelled',
          summary: `${SCRIPTED} Rehearsal cancellation.`,
          human_active_minutes: 0,
          human_wait_seconds: 0,
        });
        continue;
      }
      const impl = slot.stratum === 'implementation';
      const doc = await store.writeAttempt(owner, ws.id, a.id, 'artifacts', {
        kind: impl ? 'code' : 'document',
        name: impl ? 'cli.py' : 'Recommendation',
        content: impl
          ? 'print("rehearsal: counts by week")'
          : 'Rehearsal text, no participant: keep a dated paper log and review it weekly.',
      });
      if (!('content_hash' in doc)) throw new Error('artifact not recorded');
      await store.writeAttempt(owner, ws.id, a.id, 'tests', {
        artifact_id: doc.id,
        artifact_hash: doc.content_hash,
        check: 'contains',
        expected: impl ? 'counts' : 'log',
      });
      await store.writeAttempt(owner, ws.id, a.id, 'finish', {
        status: 'submitted',
        summary: SCRIPTED,
        human_active_minutes: 0,
        human_wait_seconds: 0,
      });
      continue;
    }
    const p = await store.prepareStudyExecution(owner, ws.id, a.id);
    if (slot.discovery_method === 'open_ended') {
      const result = await broker.call(
        owner,
        p.attempt.workspace_id,
        p.attempt.run_id,
        p.request,
      );
      await store.recordBaselineOutcome(owner, ws.id, a.id, result);
    } else {
      await store.startDiscovery(
        { ...owner, idempotencyKey: `study:${a.id}:workflow` },
        p.attempt.workspace_id,
        p.attempt.run_id,
        p.request,
      );
      // One run at a time: settle this run before the next slot starts.
      await worker.settle();
    }
  }

  const collected: Collected[] = [];
  const exports = [];
  for (const t of tasks) {
    const s = studies.get(t.key)!;
    const first = await store.exportStudy(owner, ws.id, s.id);
    const second = await store.exportStudy(owner, ws.id, s.id);
    exports.push({ key: t.key, first, second, body: first });
    for (const attempt of first.attempts) {
      const events = (await store.attemptEntries(owner, ws.id, attempt.id)).map(
        (e) => ({
          kind: String(e.kind),
          payload: e.payload as Record<string, unknown>,
        }),
      );
      const ctx = await store.participantContext(owner, ws.id, attempt.id);
      collected.push({
        slot: slotOf.get(attempt.id)!,
        attempt: attempt as unknown as Collected['attempt'],
        events,
        context: ctx.context,
        human_source: sourceOf.get(attempt.id)!,
      });
    }
  }
  collected.sort((x, y) => x.slot.sequence - y.slot.sequence);
  const forbidden = [
    ws.id,
    ...collected.flatMap((c) => [
      c.attempt.id,
      c.attempt.workspace_id,
      String(c.attempt.run_id),
      c.slot.slot_id,
    ]),
    ...[...studies.values()].map((s) => s.id),
    'rehearsal-operator',
    PILOT_AUTONOMY.config.model_version,
  ];
  return {
    workspace_id: ws.id,
    ...assemblePackage({
      mode: 'rehearsal',
      schedule,
      tasks,
      admissions,
      deferred,
      collected,
      exports,
      forbidden,
      secret: options.secret ?? randomBytes(16).toString('hex'),
    }),
  };
}

/**
 * Final mode: binds the owner's adopted freeze and final tasks to a recorded schedule and
 * admits each slot against real authority. Today no slot can run, and the package says why
 * for every one. Without an adopted freeze it refuses and names the open decisions.
 */
export async function planFinalEvaluation(
  store: StudyStore,
  owner: CommandContext,
  ws: string,
  tasks: EvaluationTask[],
  authority: Omit<EvaluationAuthority, 'mode'>,
) {
  const freeze: FrozenProtocol | null = await store.latestProtocolFreeze(
    owner,
    ws,
  );
  if (!freeze)
    throw new ContractError(
      'INVALID_TRANSITION',
      'No adopted protocol freeze in this workspace. Answer the research decisions and run protocol-freeze first.',
      BLOCKING_DECISIONS.map((d) => d.id),
    );
  const seed = canonicalHash({
    freeze: freeze.freeze_hash,
    purpose: 'final-assignment-order',
  });
  const schedule = buildSchedule(freeze, tasks, seed);
  await store.recordEvaluationSchedule(owner, ws, schedule);
  const full = { ...authority, mode: 'final' as const };
  const admissions = new Map(
    schedule.slots.map((s) => [s.slot_id, admitSlot(s, full)]),
  );
  if ([...admissions.values()].some((a) => a.admitted))
    throw new ContractError(
      'INVALID_TRANSITION',
      'A final slot was admitted, but final execution is not implemented; refusing to record it as missing.',
    );
  return assemblePackage({
    mode: 'final',
    schedule,
    tasks,
    admissions,
    deferred: new Map(),
    collected: [],
    exports: [],
    forbidden: [ws],
    secret: randomBytes(16).toString('hex'),
  });
}
