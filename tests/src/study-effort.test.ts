import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { SYNTHETIC_STUDY } from '@creator/domain';
import { StudyStore, effortOverrun } from '@creator/db';
import { createApi } from '@creator/api';
import {
  STUDY_EFFORT_CLOCK_SLACK_MS,
  STUDY_EFFORT_REFUSAL,
  STUDY_EFFORT_TIMER_VERSION,
  StudyAttemptSchema,
  StudyEffortStepSchema,
  StudySummarySchema,
  z,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { loadWeb } from './web-module.js';

type Totals = {
  active_ms: number;
  wait_ms: number;
  idle_ms: number;
  away_ms: number;
};
type Clock = {
  edited(now: number): void;
  visibility(now: number, v: boolean): void;
  focus(now: number, f: boolean): void;
  requestStarted(now: number): void;
  requestEnded(now: number): void;
  totals(now: number): Totals;
};
type TimerModule = {
  EffortClock: new (
    now: number,
    s: { visible: boolean; focused: boolean },
    idleMs: number,
  ) => Clock;
  effortText(ms: number): string;
  afterRefusal(errorText: string, marker: string): 'stop' | 'keep';
  stepOnOpen(s: {
    timed: boolean;
    running: { attempt_id: string } | null;
    attemptId: string;
    parked: boolean;
  }): { kind: string };
};

test('effort clock: active needs a visible, focused page and a recent edit; waiting needs a request in flight', async () => {
  const { EffortClock, effortText } = (await loadWeb(
    'effort-timer.ts',
  )) as TimerModule;
  const c = new EffortClock(0, { visible: true, focused: true }, 1000);
  // On the page but no edit yet: idle (reading), not away.
  c.edited(500);
  // Active from the edit at 500 until the idle window ends at 1500, then idle again.
  assert.deepEqual(c.totals(2000), {
    active_ms: 1000,
    wait_ms: 0,
    idle_ms: 1000,
    away_ms: 0,
  });
  // A request in flight with no recent edit is waiting on the studio.
  c.requestStarted(2000);
  c.edited(2200); // typing while waiting is active, not waiting
  c.requestEnded(4000);
  assert.deepEqual(c.totals(4000), {
    active_ms: 2000,
    wait_ms: 1000,
    idle_ms: 1000,
    away_ms: 0,
  });
  // A hidden page is away, never active, even right after an edit.
  c.edited(4000);
  c.visibility(4100, false);
  assert.deepEqual(c.totals(5000), {
    active_ms: 2100,
    wait_ms: 1000,
    idle_ms: 1000,
    away_ms: 900,
  });
  // A visible page in a window without focus is away too.
  c.visibility(5000, true);
  c.focus(5000, false);
  c.edited(5000);
  assert.deepEqual(c.totals(5500), {
    active_ms: 2100,
    wait_ms: 1000,
    idle_ms: 1000,
    away_ms: 1400,
  });
  // Every millisecond lands in exactly one bucket.
  const t = c.totals(9000);
  assert.equal(t.active_ms + t.wait_ms + t.idle_ms + t.away_ms, 9000);
  // A clock that goes backwards adds nothing.
  assert.deepEqual(c.totals(100), t);
  assert.equal(effortText(65_000), '1 min 05 s');
  assert.equal(effortText(4_999), '4 s');
});

test('effortOverrun allows request latency and refuses totals longer than the step', () => {
  const e = { active_ms: 1000, wait_ms: 1000, idle_ms: 500, away_ms: 500 };
  assert.equal(effortOverrun(e, 3000), null);
  assert.equal(effortOverrun(e, 3000 - STUDY_EFFORT_CLOCK_SLACK_MS), null);
  assert.match(
    effortOverrun(e, 2999 - STUDY_EFFORT_CLOCK_SLACK_MS) ?? '',
    /longer than the step lasted/,
  );
});

const intervention = {
  type: 'judgment',
  gate: 'dynamic',
  reason: 'Missing stakeholder choice',
  trigger: 'uncertainty',
  stage: 'selection',
  data_shown: 'Frozen packet',
  human_input: 'Use a checklist',
  resulting_change: 'Prefer existing document',
  prevented_problem: 'unknown',
  human_active_minutes: 2,
  wait_seconds: 4,
};

test('timed intervention steps: not the autonomous condition, bound once to the intervention, checked against the studio clock, labelled synthetic in the export', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StudyStore(db.pool);
  const owner = { actorId: randomUUID() };
  const person = { actorId: randomUUID() };
  for (const actor of [owner, person])
    await store.ensureActor({
      id: actor.actorId,
      kind: 'human',
      display_name: 'Synthetic test actor',
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Synthetic study',
    record_mode: 'fixture',
  });
  const study = await store.createStudy(owner, ws.id, SYNTHETIC_STUDY);
  const assign = (condition: 'autonomous' | 'human_only' | 'human_in_loop') =>
    store.assignStudy(owner, ws.id, study.id, {
      manifest_hash: study.manifest_hash,
      participant_actor_id: person.actorId,
      participant_code: 'P01',
      prior_familiarity: 'Synthetic only',
      condition,
      discovery_method:
        condition === 'human_only' ? 'human_defined' : 'structured',
      continuation_of: null,
    });
  const a = await assign('autonomous');
  const b = await assign('human_in_loop');
  const c = await assign('human_only');

  // ADR-0129: the autonomous condition is not timed; the human-only one is (more below).
  await assert.rejects(store.startEffortStep(person, ws.id, a.id), {
    code: 'INVALID_TRANSITION',
  });
  assert.equal(
    (await store.startEffortStep(person, ws.id, c.id)).step,
    'attempt',
  );

  const step = await store.startEffortStep(person, ws.id, b.id);
  assert.equal(StudyEffortStepSchema.parse(step).measured, null);
  assert.equal(step.step, 'attempt');
  assert.equal(step.synthetic, true);
  const effort = (over: Partial<Totals> = {}, stepId = step.id) => ({
    step_id: stepId,
    timer_version: STUDY_EFFORT_TIMER_VERSION,
    active_ms: 0,
    wait_ms: 0,
    idle_ms: 0,
    away_ms: 0,
    ...over,
  });
  const entries = async () =>
    (await store.attemptEntries(person, ws.id, b.id)).filter(
      (e) => e.kind === 'interventions',
    ).length;

  // Totals longer than the step lasted on the studio clock are refused, and the intervention
  // is not saved without its timing.
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'interventions', {
      ...intervention,
      effort: effort({ active_ms: 60_000 }),
    }),
    { code: 'INVALID_CONTRACT' },
  );
  assert.equal(await entries(), 0);
  // Review M-2: the owner may act on the attempt but is not its participant, so the owner can
  // neither start a step on it nor send timing with an intervention.
  await assert.rejects(store.startEffortStep(owner, ws.id, b.id), {
    code: 'ACCESS_DENIED',
  });
  await assert.rejects(
    store.writeAttempt(owner, ws.id, b.id, 'interventions', {
      ...intervention,
      effort: effort(),
    }),
    { code: 'ACCESS_DENIED' },
  );
  assert.equal(await entries(), 0);
  // Review L-3: a step of the same person's other assisted attempt is not this attempt's.
  await store.writeAttempt(person, ws.id, a.id, 'finish', {
    status: 'needs_human',
    summary: 'Needs a person.',
    human_active_minutes: 0,
    human_wait_seconds: 0,
  });
  const continuation = await store.assignStudy(owner, ws.id, study.id, {
    manifest_hash: study.manifest_hash,
    participant_actor_id: person.actorId,
    participant_code: 'P01',
    prior_familiarity: 'Synthetic only',
    condition: 'human_in_loop',
    discovery_method: 'structured',
    continuation_of: a.id,
  });
  const elsewhere = await store.startEffortStep(person, ws.id, continuation.id);
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'interventions', {
      ...intervention,
      effort: effort({}, elsewhere.id),
    }),
    { code: 'NOT_FOUND' },
  );
  assert.equal(await entries(), 0);
  // Timing is never accepted on a text check or a deviation (ADR-0129 adds entries and the
  // finish, tested below).
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'deviations', {
      reason: 'x',
      impact: 'y',
      effort: effort(),
    }),
    { code: 'INVALID_CONTRACT' },
  );

  const saved = (await store.writeAttempt(
    person,
    ws.id,
    b.id,
    'interventions',
    {
      ...intervention,
      effort: effort({ active_ms: 1, idle_ms: 3, away_ms: 2 }),
    },
  )) as { id: string };
  // The event payload stays the frozen intervention fields; the timing is stored beside it.
  const payload = (await store.attemptEntries(person, ws.id, b.id)).find(
    (e) => e.id === saved.id,
  )!.payload as Record<string, unknown>;
  assert.equal('effort' in payload, false);
  // A step is measured once.
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'interventions', {
      ...intervention,
      effort: effort(),
    }),
    { code: 'INVALID_TRANSITION' },
  );
  // An intervention without timing still saves (API callers, older pages).
  await store.writeAttempt(person, ws.id, b.id, 'interventions', intervention);
  const unfinished = await store.startEffortStep(person, ws.id, b.id);

  const steps = await store.effortSteps(person, ws.id, b.id);
  assert.deepEqual(
    steps.map((s) => s.id),
    [step.id, unfinished.id],
  );
  const measured = steps[0]!.measured!;
  assert.equal(measured.event_id, saved.id);
  assert.equal(measured.ended_by, 'intervention');
  assert.deepEqual(
    [measured.active_ms, measured.wait_ms, measured.idle_ms, measured.away_ms],
    [1, 0, 3, 2],
  );
  assert.ok(measured.wall_ms >= 0);
  assert.equal(steps[1]!.measured, null);

  // Append-only.
  await assert.rejects(
    db.pool.query('update study_effort_measures set active_ms = 0'),
  );
  await assert.rejects(db.pool.query('delete from study_effort_steps'));

  const exported = await store.exportStudy(owner, ws.id, study.id);
  const attempt = (
    exported.attempts as unknown as {
      id: string;
      measured_effort: Record<string, unknown>;
    }[]
  ).find((x) => x.id === b.id)!;
  assert.equal(
    attempt.measured_effort.subject,
    'synthetic_operator_not_participant',
  );
  assert.equal(attempt.measured_effort.source, STUDY_EFFORT_TIMER_VERSION);
  assert.equal(attempt.measured_effort.timed_steps, 1);
  assert.equal(attempt.measured_effort.unfinished_steps, 1);
  assert.equal(attempt.measured_effort.intervention_idle_seconds, 0.003);
  assert.equal(attempt.measured_effort.intervention_away_seconds, 0.002);
  // The participant's reported minutes are kept separately and unchanged.
  const reported = (
    exported.attempts as unknown as {
      id: string;
      measurements: { intervention_active_minutes: number };
    }[]
  ).find((x) => x.id === b.id)!;
  assert.equal(reported.measurements.intervention_active_minutes, 4);

  // Review L-3: past the assignment's time cap, no step starts.
  const realNow = Date.now;
  Date.now = () =>
    realNow() + (SYNTHETIC_STUDY.packet.time_cap_seconds + 1) * 1000;
  try {
    await assert.rejects(store.startEffortStep(person, ws.id, b.id), {
      code: 'EXPIRED',
    });
  } finally {
    Date.now = realNow;
  }
  // A terminal attempt times no further steps.
  await store.writeAttempt(person, ws.id, b.id, 'finish', {
    status: 'cancelled',
    summary: 'Stopped.',
    human_active_minutes: 0,
    human_wait_seconds: 0,
  });
  await assert.rejects(store.startEffortStep(person, ws.id, b.id), {
    code: 'INVALID_TRANSITION',
  });
});

test('effort-steps HTTP route starts and lists steps for the human attempts, not the autonomous one', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const post = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
  const ws = z
    .object({ id: z.string() })
    .parse(
      await (
        await post('workspaces', { name: 'Timer HTTP', record_mode: 'fixture' })
      ).json(),
    );
  const root = `workspaces/${ws.id}`;
  const seed = z
    .object({
      study: StudySummarySchema,
      attempts: z.array(StudyAttemptSchema),
    })
    .parse(await (await post(`${root}/studies/seed`, {})).json());
  const b = seed.attempts.find((a) => a.condition === 'human_in_loop')!;
  const c = seed.attempts.find((a) => a.condition === 'human_only')!;
  const autonomous = seed.attempts.find((x) => x.condition === 'autonomous')!;
  assert.equal(
    (await post(`${root}/study-attempts/${autonomous.id}/effort-steps`, {}))
      .status,
    409,
  );
  // ADR-0129: the human-only attempt is timed too.
  assert.equal(
    (await post(`${root}/study-attempts/${c.id}/effort-steps`, {})).status,
    201,
  );
  // Review N-2: starting a step takes no input.
  const extra = await post(`${root}/study-attempts/${b.id}/effort-steps`, {
    anything: 'x',
  });
  assert.equal(extra.status, 400);
  const started = await post(`${root}/study-attempts/${b.id}/effort-steps`, {});
  assert.equal(started.status, 201);
  const step = StudyEffortStepSchema.parse(await started.json());
  const saved = await post(`${root}/study-attempts/${b.id}/interventions`, {
    ...intervention,
    effort: {
      step_id: step.id,
      timer_version: STUDY_EFFORT_TIMER_VERSION,
      active_ms: 0,
      wait_ms: 0,
      idle_ms: 0,
      away_ms: 0,
    },
  });
  assert.equal(saved.status, 201);
  const listed = z.array(StudyEffortStepSchema).parse(
    await (
      await fetch(`${base}/${root}/study-attempts/${b.id}/effort-steps`, {
        headers: auth.read,
      })
    ).json(),
  );
  assert.equal(listed.length, 1);
  assert.notEqual(listed[0]!.measured, null);
  const unauthenticated = await fetch(
    `${base}/${root}/study-attempts/${b.id}/effort-steps`,
  );
  assert.equal(unauthenticated.status, 401);
});

test('ADR-0129: human-only steps end at a saved entry, the finish ends the last step, and the export summarises them', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StudyStore(db.pool);
  const owner = { actorId: randomUUID() };
  const person = { actorId: randomUUID() };
  for (const actor of [owner, person])
    await store.ensureActor({
      id: actor.actorId,
      kind: 'human',
      display_name: 'Synthetic test actor',
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Synthetic study',
    record_mode: 'fixture',
  });
  const study = await store.createStudy(owner, ws.id, SYNTHETIC_STUDY);
  const assign = (condition: 'autonomous' | 'human_only' | 'human_in_loop') =>
    store.assignStudy(owner, ws.id, study.id, {
      manifest_hash: study.manifest_hash,
      participant_actor_id: person.actorId,
      participant_code: 'P01',
      prior_familiarity: 'Synthetic only',
      condition,
      discovery_method:
        condition === 'human_only' ? 'human_defined' : 'structured',
      continuation_of: null,
    });
  const a = await assign('autonomous');
  const b = await assign('human_in_loop');
  const c = await assign('human_only');
  const effort = (stepId: string, over: Partial<Totals> = {}) => ({
    step_id: stepId,
    timer_version: STUDY_EFFORT_TIMER_VERSION,
    active_ms: 0,
    wait_ms: 0,
    idle_ms: 0,
    away_ms: 0,
    ...over,
  });
  const entry = { kind: 'document', name: 'Work', content: 'A checklist' };

  // Human-only: the first step is ended by a saved entry, the next one by the finish.
  const first = await store.startEffortStep(person, ws.id, c.id);
  const saved = (await store.writeAttempt(person, ws.id, c.id, 'artifacts', {
    ...entry,
    effort: effort(first.id, { active_ms: 4, idle_ms: 1 }),
  })) as { id: string };
  const second = await store.startEffortStep(person, ws.id, c.id);
  // The owner may finish a participant's attempt but never with timing (review M-2 of #221),
  // and nothing is recorded when that is refused.
  const finish = {
    status: 'submitted',
    summary: 'Submitted.',
    human_active_minutes: 3,
    human_wait_seconds: 0,
  };
  await assert.rejects(
    store.writeAttempt(owner, ws.id, c.id, 'finish', {
      ...finish,
      effort: effort(second.id),
    }),
    { code: 'ACCESS_DENIED' },
  );
  // Totals longer than the step lasted refuse the finish too; the attempt stays assigned.
  await assert.rejects(
    store.writeAttempt(person, ws.id, c.id, 'finish', {
      ...finish,
      effort: effort(second.id, { active_ms: 60_000 }),
    }),
    { code: 'INVALID_CONTRACT' },
  );
  // Review M-1: a refusal about the timing names itself, and one about the record does not, so
  // the page keeps the step on the latter. Here a submit before any entry is refused for the
  // record; the same step then still ends at the entry and the later finish.
  const cOnly = await assign('human_only');
  const open = await store.startEffortStep(person, ws.id, cOnly.id);
  await assert.rejects(
    store.writeAttempt(person, ws.id, cOnly.id, 'finish', {
      ...finish,
      effort: effort(open.id),
    }),
    (e: Error) =>
      /needs an artifact/.test(e.message) &&
      !e.message.includes(STUDY_EFFORT_REFUSAL),
  );
  await store.writeAttempt(person, ws.id, cOnly.id, 'artifacts', {
    ...entry,
    effort: effort(open.id),
  });
  assert.equal(
    (await store.effortSteps(person, ws.id, cOnly.id))[0]!.measured?.ended_by,
    'entry',
  );
  await assert.rejects(
    store.writeAttempt(person, ws.id, c.id, 'finish', {
      ...finish,
      effort: effort(second.id, { active_ms: 60_000 }),
    }),
    (e: Error) => e.message.endsWith(STUDY_EFFORT_REFUSAL),
  );
  const finished = (await store.writeAttempt(person, ws.id, c.id, 'finish', {
    ...finish,
    effort: effort(second.id, { active_ms: 2, wait_ms: 3 }),
  })) as { id: string };
  const entries = await store.attemptEntries(person, ws.id, c.id);
  const payload = entries.find((e) => e.id === finished.id)!.payload as Record<
    string,
    unknown
  >;
  // The finish payload keeps its frozen fields and reported source; timing is stored beside it.
  assert.equal('effort' in payload, false);
  assert.equal(
    payload.measurement_source,
    'participant_report_except_wall_clock',
  );
  assert.equal(
    'effort' in
      (entries.find((e) => e.id === saved.id)!.payload as Record<
        string,
        unknown
      >),
    false,
  );
  const cSteps = await store.effortSteps(person, ws.id, c.id);
  assert.deepEqual(
    cSteps.map((s) => [s.step, s.measured?.ended_by, s.measured?.event_id]),
    [
      ['attempt', 'entry', saved.id],
      ['attempt', 'finish', finished.id],
    ],
  );

  // A step started at the intervention form under ADR-0122 is ended only by an intervention.
  const legacy = randomUUID();
  await db.pool.query(
    "insert into study_effort_steps(id,study_id,attempt_id,actor_id,step) values($1,$2,$3,$4,'intervention')",
    [legacy, study.id, b.id, person.actorId],
  );
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'artifacts', {
      ...entry,
      effort: effort(legacy),
    }),
    { code: 'INVALID_TRANSITION' },
  );
  assert.equal(
    (await store.attemptEntries(person, ws.id, b.id)).filter(
      (e) => e.kind === 'artifacts',
    ).length,
    0,
  );
  await store.writeAttempt(person, ws.id, b.id, 'interventions', {
    ...intervention,
    effort: effort(legacy, { active_ms: 7 }),
  });
  // Assisted: an entry ends a step too, and stopping ends the last one; one step is left open.
  const s1 = await store.startEffortStep(person, ws.id, b.id);
  await store.writeAttempt(person, ws.id, b.id, 'artifacts', {
    ...entry,
    effort: effort(s1.id, { idle_ms: 5 }),
  });
  await store.startEffortStep(person, ws.id, b.id); // left open (a reload, say)
  const s3 = await store.startEffortStep(person, ws.id, b.id);
  await store.writeAttempt(person, ws.id, b.id, 'finish', {
    status: 'cancelled',
    summary: 'Stopped.',
    human_active_minutes: 0,
    human_wait_seconds: 0,
    effort: effort(s3.id, { away_ms: 6 }),
  });
  // A measure names only the three known ends.
  await assert.rejects(
    db.pool.query(
      "insert into study_effort_measures(step_id,attempt_id,event_id,ended_by,timer_version,active_ms,wait_ms,idle_ms,away_ms,wall_ms) values($1,$2,$3,'other','study-effort-timer/1',0,0,0,0,0)",
      [randomUUID(), b.id, randomUUID()],
    ),
  );

  const exported = await store.exportStudy(owner, ws.id, study.id);
  const measured = (id: string) =>
    (
      exported.attempts as unknown as {
        id: string;
        measured_effort: Record<string, unknown> & {
          by_end: Record<string, Record<string, number>>;
        };
      }[]
    ).find((x) => x.id === id)!.measured_effort;
  const mc = measured(c.id);
  assert.equal(mc.condition_timed, true);
  assert.equal(mc.timed_steps, 2);
  assert.equal(mc.unfinished_steps, 0);
  assert.equal(mc.finish_timed, true);
  assert.equal(mc.complete, true);
  assert.equal(mc.active_seconds, 0.006);
  assert.equal(mc.wait_seconds, 0.003);
  assert.equal(mc.idle_seconds, 0.001);
  assert.equal(mc.intervention_active_seconds, 0);
  assert.deepEqual(mc.by_end.entry, {
    steps: 1,
    active_seconds: 0.004,
    wait_seconds: 0,
    idle_seconds: 0.001,
    away_seconds: 0,
  });
  assert.equal(mc.by_end.finish!.active_seconds, 0.002);
  const mb = measured(b.id);
  assert.equal(mb.timed_steps, 3);
  assert.equal(mb.unfinished_steps, 1);
  assert.equal(mb.finish_timed, true);
  assert.equal(mb.complete, false);
  assert.equal(mb.intervention_active_seconds, 0.007);
  assert.equal(mb.by_end.finish!.away_seconds, 0.006);
  const ma = measured(a.id);
  assert.equal(ma.condition_timed, false);
  assert.equal(ma.timed_steps, 0);
  assert.equal(ma.complete, false);
});

test('ADR-0129 review: the page keeps the step on a record refusal and keeps or continues a step when an attempt opens', async () => {
  const { afterRefusal, stepOnOpen } = (await loadWeb(
    'effort-timer.ts',
  )) as TimerModule;
  // M-1: only a refusal about the timing stops the timer.
  assert.equal(
    afterRefusal(
      'A submission needs an artifact; submitted is not independently verified success.',
      STUDY_EFFORT_REFUSAL,
    ),
    'keep',
  );
  assert.equal(
    afterRefusal(
      'The assignment time cap has elapsed; record a failed or cancelled outcome.',
      STUDY_EFFORT_REFUSAL,
    ),
    'keep',
  );
  assert.equal(
    afterRefusal(
      `The measured time (9 ms) is longer than the step lasted on the studio clock (1 ms). ${STUDY_EFFORT_REFUSAL}`,
      STUDY_EFFORT_REFUSAL,
    ),
    'stop',
  );
  // M-2, M-3: opening the attempt being timed keeps its step; coming back to one the page left
  // resumes its kept clock; after a reload (no kept clock) a new step starts; nobody else is
  // timed.
  const open = (o: Partial<Parameters<TimerModule['stepOnOpen']>[0]>) =>
    stepOnOpen({
      timed: true,
      running: null,
      attemptId: 'att',
      parked: false,
      ...o,
    }).kind;
  assert.equal(open({ timed: false, parked: true }), 'none');
  assert.equal(open({}), 'start');
  assert.equal(open({ running: { attempt_id: 'att' } }), 'keep');
  assert.equal(
    open({ running: { attempt_id: 'other' }, parked: true }),
    'resume',
  );
  assert.equal(open({ running: { attempt_id: 'other' } }), 'start');
  // M-3: a clock kept while the person was on another attempt counts that time as away, so the
  // step's totals still cover all of it.
  const { EffortClock } = (await loadWeb('effort-timer.ts')) as TimerModule;
  const kept = new EffortClock(0, { visible: true, focused: true }, 60_000);
  kept.edited(0);
  kept.visibility(6_000, false); // left for another attempt after 6 s of typing
  kept.visibility(10_000, true); // came back
  const t = kept.totals(12_000);
  assert.deepEqual(t, {
    active_ms: 8_000,
    wait_ms: 0,
    idle_ms: 0,
    away_ms: 4_000,
  });
});
