import { randomUUID } from 'node:crypto';
import type { StudyStore, CommandContext } from '@creator/db';
import type { ModelBroker } from '@creator/broker';
import {
  PILOT_AUTONOMY,
  PILOT_DISCOVERY,
  PILOT_VERSION,
  PROPOSED_PROTOCOL,
  BLOCKING_DECISIONS,
  canonicalHash,
  classifyAttempt,
  estimateDesigns,
  instrumentationChecks,
  reviewerPacket,
  studyOrder,
  type PilotArm,
  type PilotAttempt,
} from '@creator/domain';
import { Worker } from './worker.js';

const SENTINELS = ['PILOT_OTHER_ARM_SENTINEL', 'PILOT_GRADER_SENTINEL'];
const REHEARSAL = 'Scripted rehearsal entry; not participant work.';

/**
 * Runs the T14 pilot rehearsal through the real study store, broker and workflow worker in a
 * new fixture workspace: one attempt per autonomy arm on one decision task, plus one
 * structured/open-ended discovery pair. Human entries are scripted and labelled; nothing in
 * the package is an empirical result.
 */
export async function runPilotRehearsal(
  store: StudyStore,
  broker: ModelBroker,
  owner: CommandContext,
) {
  const reviewer = randomUUID();
  await store.ensureActor({
    id: reviewer,
    kind: 'human',
    display_name: 'Pilot reviewer identity (rehearsal, no person)',
  });
  const ws = await store.createWorkspace(owner, {
    name: `T14 pilot rehearsal ${new Date().toISOString().slice(0, 10)}`,
    record_mode: 'fixture',
  });
  const autonomy = await store.createStudy(owner, ws.id, PILOT_AUTONOMY);
  const discovery = await store.createStudy(owner, ws.id, PILOT_DISCOVERY);
  await store.grantGrader(owner, ws.id, autonomy.id, { actor_id: reviewer });
  await store.graderMaterial({ actorId: reviewer }, ws.id, autonomy.id, {
    kind: 'hidden_test',
    content: SENTINELS[1]!,
  });

  const assign = (
    study: { id: string; manifest_hash: string },
    condition: 'autonomous' | 'human_in_loop' | 'human_only',
    method: 'structured' | 'open_ended' | 'human_defined',
    comparison: 'autonomy' | 'discovery',
  ) =>
    store.assignStudy(owner, ws.id, study.id, {
      manifest_hash: study.manifest_hash,
      comparison,
      participant_actor_id: owner.actorId,
      participant_code: 'rehearsal-operator',
      prior_familiarity:
        'Scripted rehearsal by the operator; not an independent participant.',
      condition,
      discovery_method: method,
      continuation_of: null,
    });
  const arms = new Map<string, PilotArm>();
  const ids: Record<string, string> = {};
  for (const condition of studyOrder(PILOT_AUTONOMY.assignment_seed)) {
    const a = await assign(
      autonomy,
      condition,
      condition === 'human_only' ? 'human_defined' : 'structured',
      'autonomy',
    );
    const arm =
      condition === 'autonomous'
        ? 'A'
        : condition === 'human_in_loop'
          ? 'B'
          : 'C';
    arms.set(a.id, arm);
    ids[arm] = a.id;
  }
  for (const method of ['structured', 'open_ended'] as const) {
    const a = await assign(discovery, 'autonomous', method, 'discovery');
    const arm = method === 'structured' ? 'D-structured' : 'D-open';
    arms.set(a.id, arm);
    ids[arm] = a.id;
  }

  // B: a fixed-gate intervention is logged before the assisted run proceeds.
  await store.writeAttempt(owner, ws.id, ids.B!, 'interventions', {
    type: 'judgment',
    gate: 'fixed',
    reason: 'Pilot fixed gate before selection',
    trigger: 'protocol gate',
    stage: 'selection',
    data_shown: 'Frozen packet only',
    human_input: REHEARSAL,
    resulting_change: 'None (rehearsal)',
    prevented_problem: 'unknown',
    human_active_minutes: 0,
    wait_seconds: 0,
  });
  await store.writeAttempt(owner, ws.id, ids.B!, 'artifacts', {
    kind: 'document',
    name: 'Assisted note',
    content: `Rehearsal text, no participant: ${SENTINELS[0]}`,
  });
  // C: helpers are refused, then a conventional submission and text check are recorded.
  for (const helper of ['model.generate', 'model.complete', 'discovery'])
    await store.writeAttempt(owner, ws.id, ids.C!, 'helpers', { helper });
  const doc = await store.writeAttempt(owner, ws.id, ids.C!, 'artifacts', {
    kind: 'document',
    name: 'Recommendation',
    content: `Rehearsal text, no participant: add an overnight return bin with a dated tag and a morning check against the sign-out sheet.`,
  });
  if (!('content_hash' in doc)) throw new Error('artifact not recorded');
  await store.writeAttempt(owner, ws.id, ids.C!, 'tests', {
    artifact_id: doc.id,
    artifact_hash: doc.content_hash,
    check: 'contains',
    expected: 'sign-out sheet',
  });
  await store.writeAttempt(owner, ws.id, ids.C!, 'finish', {
    status: 'submitted',
    summary: REHEARSAL,
    human_active_minutes: 0,
    human_wait_seconds: 0,
  });

  // AI arms run through the same execution path as T10: discovery workflow or one broker call.
  for (const arm of ['A', 'B', 'D-structured'] as const) {
    const p = await store.prepareStudyExecution(owner, ws.id, ids[arm]!);
    await store.startDiscovery(
      { ...owner, idempotencyKey: `study:${ids[arm]}:workflow` },
      p.attempt.workspace_id,
      p.attempt.run_id,
      p.request,
    );
  }
  const open = await store.prepareStudyExecution(owner, ws.id, ids['D-open']!);
  const result = await broker.call(
    owner,
    open.attempt.workspace_id,
    open.attempt.run_id,
    open.request,
  );
  await store.recordBaselineOutcome(owner, ws.id, ids['D-open']!, result);
  await new Worker(store, broker).settle();

  const studies = [autonomy, discovery];
  const exportsA = await Promise.all(
    studies.map((s) => store.exportStudy(owner, ws.id, s.id)),
  );
  const exportsB = await Promise.all(
    studies.map((s) => store.exportStudy(owner, ws.id, s.id)),
  );
  const attempts: PilotAttempt[] = [];
  const reviewItems = [];
  let maxInput = 0;
  for (const [i, ex] of exportsA.entries()) {
    const input = i === 0 ? PILOT_AUTONOMY : PILOT_DISCOVERY;
    for (const a of ex.attempts) {
      const events = (await store.attemptEntries(owner, ws.id, a.id)).map(
        (e) => ({ kind: String(e.kind), payload: e.payload }),
      );
      const ctx = await store.participantContext(owner, ws.id, a.id);
      for (const u of a.usage as { usage: { uncached_input_tokens: number } }[])
        maxInput = Math.max(maxInput, Number(u.usage.uncached_input_tokens));
      const arm = arms.get(a.id)!;
      attempts.push({
        arm,
        id: a.id,
        workspace_id: a.workspace_id,
        condition: a.condition,
        discovery_method: a.discovery_method,
        state: a.state,
        primary: a.primary,
        time_cap_seconds: input.packet.time_cap_seconds,
        finish: events.find((e) => e.kind === 'finished')?.payload ?? null,
        measurements: a.measurements,
        reservations: a.reservations.map((r) => ({ status: String(r.status) })),
        events,
        context: ctx.context,
        human_source:
          a.condition === 'autonomous' ? 'none' : 'scripted_rehearsal',
      });
      const artifact = events.find((e) => e.kind === 'artifacts');
      reviewItems.push({
        attempt_id: a.id,
        task: input.packet.version,
        text: artifact ? String(artifact.payload.content) : null,
      });
    }
  }
  const order: PilotArm[] = ['A', 'B', 'C', 'D-structured', 'D-open'];
  attempts.sort((x, y) => order.indexOf(x.arm) - order.indexOf(y.arm));
  const blind = reviewerPacket(reviewItems, `${PILOT_VERSION}:reviewer`);
  const checks = instrumentationChecks({
    attempts,
    sentinels: SENTINELS,
    export_hashes: exportsA.map((e, i) => [
      e.export_hash,
      exportsB[i]!.export_hash,
    ]),
    reviewer_packet: blind.packet,
    reviewer_key: blind.key,
  });
  const estimate = {
    basis:
      'Upper bounds from frozen caps priced at the documented gpt-6-astra Standard rates (unverified for the account); input tokens are the observed fixture maximum; human time assumes the full cap; reviewer minutes per item is an assumption.',
    assumptions: {
      max_calls: PILOT_AUTONOMY.config.max_calls,
      max_output_tokens: PILOT_AUTONOMY.config.max_output_tokens,
      observed_max_input_tokens: maxInput,
      time_cap_minutes: 60,
      implementation_time_cap_minutes: 90,
      reviewer_minutes_per_item: 15,
    },
    designs: [] as ReturnType<typeof estimateDesigns>,
  };
  estimate.designs = estimateDesigns(estimate.assumptions);
  const body = {
    schema_version: 'pilot-package/1',
    pilot_version: PILOT_VERSION,
    empirical_results: false,
    evidence_kind:
      'fixture AI arms and scripted human entries; instrumentation rehearsal only',
    not_run: [
      {
        what: 'Live AI pilot runs',
        reason:
          'Live dispatch is disabled; no verified model id or spending cap (RD6).',
      },
      {
        what: 'Human pilot participation (arms B and C)',
        reason:
          'No participant work and no human-subjects determination (RD3, RD5). Human entries are scripted.',
      },
      {
        what: 'Reviewer calibration',
        reason: 'No reviewers named yet (RD4).',
      },
    ],
    workspace_id: ws.id,
    studies: studies.map((s, i) => ({
      id: s.id,
      manifest_hash: s.manifest_hash,
      export_hash: exportsA[i]!.export_hash,
    })),
    flow: attempts.map((a) => ({
      arm: a.arm,
      attempt_id: a.id,
      condition: a.condition,
      discovery_method: a.discovery_method,
      primary: a.primary,
      state: a.state,
      outcome: a.finish?.outcome ?? a.finish?.status ?? null,
      human_source: a.human_source,
      classification: classifyAttempt(a),
      measurements: a.measurements,
    })),
    checks,
    estimate,
    proposed_protocol_hash: canonicalHash(PROPOSED_PROTOCOL),
    blocking_decisions: BLOCKING_DECISIONS.map((d) => d.id),
    exports: exportsA,
  };
  // Ids and timestamps differ per run; this digest covers what a re-run must reproduce.
  const reproducible = {
    manifests: body.studies.map((s) => s.manifest_hash),
    flow: body.flow.map((f) => ({
      arm: f.arm,
      state: f.state,
      outcome: f.outcome,
      class: f.classification.class,
      calls: f.measurements.calls,
      known_simulated_spend_nano_usd:
        f.measurements.known_simulated_spend_nano_usd,
    })),
    checks: checks.map((c) => [c.id, c.status]),
    estimate: estimate.designs,
    proposed_protocol_hash: body.proposed_protocol_hash,
  };
  return {
    package: {
      ...body,
      reproducible_digest: canonicalHash(reproducible),
      package_hash: canonicalHash(body),
    },
    reviewer_packet: blind.packet,
    reviewer_key: { private: true, codes: blind.key },
  };
}
