import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AssessmentPacketSchema,
  ContractError,
  WorkflowDetailSchema,
  type AssessmentPacket,
  type AssessorOutput,
  type ErrorCode,
  type PlanConnection,
  type ScorecardBody,
  type SelectionReport,
  type StartAssessmentRequest,
  type WorkflowDetail,
} from '@creator/contracts';
import {
  ASSESSMENT_MARKER,
  DISCOVERY_SCENARIOS,
  assessmentFixtureAnswer,
  coordinateAssessment,
  assessmentRoleInput,
  checkAssessmentOutput,
  rubricsForKind,
} from '@creator/domain';
import {
  FixtureAdapter,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { ConnectionStore } from '@creator/db';
import { discoverySetup, owner } from './discovery-harness.js';
import { holdAudit, lockWaiters } from './pg-harness.js';

// P08 automatic assessments (ADR-0074): system ratings with evidence-linked rationales on the
// T05 workflow path, application-computed totals, people's edits that keep the original, and
// stale marking when the option, the problem or the evidence it read changes.

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;

class Recording implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  readonly inner = new FixtureAdapter();
  calls: AdapterRequest[] = [];
  override: ((req: AdapterRequest) => AdapterOutcome | null) | null = null;
  call(req: AdapterRequest, signal: AbortSignal) {
    this.calls.push(req);
    const o = this.override?.(req) ?? null;
    return o ? Promise.resolve(o) : this.inner.call(req, signal);
  }
  assessments() {
    return this.calls.filter((c) =>
      c.input[0]!.text.includes(ASSESSMENT_MARKER),
    ).length;
  }
}
const answer = (json: unknown): AdapterOutcome => ({
  kind: 'completed',
  response_id: 'scripted',
  text: JSON.stringify(json),
  vector: null,
  usage: usage(40, 30, {}),
  incomplete_reason: null,
});

async function setup(t: test.TestContext, adapter: ModelAdapter) {
  const s = await discoverySetup(t, adapter);
  if (!s) return null;
  const envelope = (await s.store.listEnvelopes(owner, s.ws.id))[0]!;
  const pricing = (await s.store.listPricing(owner, s.ws.id))[0]!;
  const { detail, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const request = (
    version = problem.version,
    over: Partial<StartAssessmentRequest> = {},
  ): StartAssessmentRequest => ({
    problem: { id: problem.id, version },
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    limits: {
      // One task per batch of options (two here), each with one repair.
      max_children: 4,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 8,
      max_output_tokens: 8000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
    ...over,
  });
  const assess = async (
    over: Partial<StartAssessmentRequest> = {},
  ): Promise<WorkflowDetail> => {
    const runId = await s.run();
    const started = await s.store.startAssessment(
      owner,
      s.ws.id,
      runId,
      request(problem.version, over),
    );
    await s.worker.settle();
    return s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  };
  const report = () => s.store.selectionReport(owner, s.ws.id, problem.id);
  const cards = async () =>
    (await s.store.listEntities(owner, s.ws.id, {
      kind: 'scorecard',
    })) as { id: string; version: number; status: string; body: unknown }[];
  return { ...s, problem, seeded, request, assess, report, cards };
}
const rows = (r: SelectionReport) =>
  r.suitability.candidates.flatMap((c) =>
    c.scorecards.map((s) => ({ ...s, alt: c.alternative })),
  );

test('a fixture assessment writes one system scorecard per option and rubric; code ranks; gates stay with people', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  AssessmentPacketSchema.parse(preview.packet);
  assert.ok(preview.packet.claims.length >= 1, 'the problem has linked claims');
  assert.ok(preview.packet.notes.some((n) => /did not search the web/.test(n)));
  const detail = await s.assess({ preview_hash: preview.preview_hash });
  WorkflowDetailSchema.parse(detail);
  assert.equal(detail.workflow.state, 'succeeded', detail.workflow.reason);
  assert.equal(detail.workflow.role, 'r08_assessment');
  // One request per batch of options, as the preview said.
  assert.ok(
    preview.requests >= 2,
    'the fixture packet needs more than one request',
  );
  assert.equal(adapter.assessments(), preview.requests);
  const result = detail.workflow.result!.assessment!;
  const expected = preview.packet.options.reduce(
    (n, o) => n + rubricsForKind(o.kind).length,
    0,
  );
  assert.equal(result.scorecards.length, expected);
  // Every card carries its provenance and cites exact claim versions from the packet.
  const all = await s.cards();
  const system = all.filter((c) => (c.body as ScorecardBody).assessment);
  assert.equal(system.length, expected);
  for (const c of system) {
    const b = c.body as ScorecardBody;
    assert.equal(b.reviewer.kind, 'fixture');
    assert.equal(b.assessment!.workflow_id, detail.workflow.id);
    assert.equal(b.assessment!.packet_hash, result.packet_hash);
    assert.equal(b.assessment!.route, 'fixture');
    assert.equal(b.assessment!.model_id, 'fixture-model-v1');
    assert.equal(b.assessment!.problem.version, s.problem.version);
    for (const r of Object.values(b.ratings))
      for (const e of r.evidence_refs)
        assert.ok(
          preview.packet.claims.some(
            (x) => x.claim_id === e.id && x.version === e.version,
          ),
        );
  }
  // The report computes totals from the system cards; ethics stays unconfirmed.
  const report = await s.report();
  for (const c of report.suitability.candidates) {
    assert.equal(c.status, 'complete');
    assert.ok(c.score);
    assert.ok(c.scorecards.every((x) => x.system && !x.stale));
    assert.equal(c.gates.ethics_access, 'not_assessed');
    assert.ok(
      (c.gates.blocked.proceed_to_validation ?? []).some((r) =>
        /a person must confirm/.test(r),
      ),
    );
  }
  // Ties keep the same rank (the fixture gives every option the same ratings).
  const ranks = new Set(report.suitability.candidates.map((c) => c.rank));
  assert.equal(ranks.size, 1);

  // A second run replaces the earlier system cards (archived, kept in history).
  const again = await s.assess();
  assert.equal(again.workflow.state, 'succeeded');
  assert.equal(again.workflow.result!.assessment!.replaced.length, expected);
  const active = (await s.cards()).filter(
    (c) => c.status === 'active' && (c.body as ScorecardBody).assessment,
  );
  assert.equal(active.length, expected);
});

test('a person edits a system rating without losing it; only an assessment writes system cards', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  await s.assess();
  const r0 = await s.report();
  const target = rows(r0)[0]!;
  const sys = (await s.cards()).find((c) => c.id === target.id)!;
  const body = sys.body as ScorecardBody;

  // Model cards and provenance cannot be posted as a person.
  await rejects(
    'ACCESS_DENIED',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Forged system card',
      body: body as unknown as Record<string, unknown>,
    }),
  );
  const { assessment: _a, ...plain } = body;
  await rejects(
    'ACCESS_DENIED',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Model card by hand',
      body: { ...plain, reviewer: { kind: 'model', label: 'Me' } },
    }),
  );
  // The system card itself is not revised.
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviseScorecard(owner, s.ws.id, sys.id, {
      expected_version: sys.version,
      title: 'Changed',
      body: body as unknown as Record<string, unknown>,
      reason: 'Try to overwrite.',
    }),
  );

  // The edit: the person's own card, naming the system card, with one rating changed.
  const key = Object.keys(body.ratings)[0]!;
  const edited: ScorecardBody = {
    ...plain,
    reviewer: { kind: 'human', label: 'Owner' },
    ratings: {
      ...body.ratings,
      [key]: {
        ...body.ratings[key]!,
        rating: body.ratings[key]!.rating === 5 ? 4 : 5,
        rationale: 'I know this group; the need is sharper (test).',
      },
    },
    gates: {
      ethics: { status: 'clear', note: 'Checked with the clinic (test).' },
      access: { status: 'clear', note: 'Checked with the clinic (test).' },
    },
    edit_of: {
      scorecard: { id: sys.id, version: sys.version },
      reason: 'Owner knowledge of the affected group (test).',
    },
  };
  // An edit must keep the rubric and option.
  await rejects(
    'INVALID_CONTRACT',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Wrong subject',
      body: {
        ...edited,
        subject: rows(r0).find((x) => x.alt.id !== target.alt.id)!.alt,
      } as unknown as Record<string, unknown>,
    }),
  );
  const mine = await s.store.recordScorecard(owner, s.ws.id, {
    title: 'My edit',
    body: edited as unknown as Record<string, unknown>,
  });
  const r1 = await s.report();
  const sysRow = rows(r1).find((x) => x.id === sys.id)!;
  const myRow = rows(r1).find((x) => x.id === mine.id)!;
  assert.equal(sysRow.superseded_by, mine.id);
  assert.equal(myRow.edit_of, sys.id);
  assert.equal(myRow.system, false);
  // The original is unchanged and still listed; the person's card counts instead.
  const kept = (await s.cards()).find((c) => c.id === sys.id)!;
  assert.equal(kept.version, sys.version);
  assert.equal(kept.status, 'active');
  const cand = r1.suitability.candidates.find(
    (c) => c.alternative.id === target.alt.id,
  )!;
  assert.equal(
    cand.disagreements.length,
    0,
    'the replaced card is not counted',
  );
  assert.notEqual(
    cand.score?.display,
    r0.suitability.candidates.find((c) => c.alternative.id === target.alt.id)!
      .score?.display,
  );
  // Only a person can clear the gate: this option is now clear, the others are not.
  assert.equal(cand.gates.ethics_access, 'clear');

  // A newer assessment archives the system card; an edit of the old one is refused now.
  await s.assess();
  await rejects(
    'VERSION_CONFLICT',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Late edit',
      body: edited as unknown as Record<string, unknown>,
    }),
  );
});

test('changed evidence, problem or option marks system assessments stale', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  await s.assess();
  const before = await s.report();
  assert.ok(rows(before).every((x) => !x.stale));
  // Retracting support for a claim the assessor read changes its evidence.
  const claimId = s.seeded.evidence[0]!.claim_id;
  const ev = await s.store.claimEvidence(owner, s.ws.id, claimId, 180);
  const row = ev.rows.find((r) => r.freshness !== 'retracted')!;
  await s.store.retractClaimSupport(owner, s.ws.id, row.support.id, {
    reason: 'Misread passage (test).',
  });
  const after = await s.report();
  const stale = rows(after).filter((x) => x.system && x.stale);
  assert.ok(stale.length >= 1);
  assert.ok(
    stale.every((x) =>
      x.stale_reasons!.some((r) => /evidence for claim .* changed/.test(r)),
    ),
  );
  // Stale cards do not count, so the options are unscored again.
  assert.ok(after.suitability.candidates.every((c) => c.status === 'unscored'));
  assert.notEqual(after.report_hash, before.report_hash);

  // A revised problem: a start must name its current version, and the old cards say why.
  const p = (await s.store.getEntity(owner, s.ws.id, s.problem.id)).entity;
  await s.store.reviseEntity(owner, s.ws.id, s.problem.id, {
    expected_version: p.version,
    title: p.title,
    body: { ...p.body, uncertainty: 'Revised after review (test).' },
    reason: 'Clarified (test).',
    corrects_version: null,
  });
  const runId = await s.run();
  await rejects(
    'VERSION_CONFLICT',
    s.store.startAssessment(owner, s.ws.id, runId, s.request(p.version)),
  );
  const revised = await s.report();
  assert.ok(
    rows(revised)
      .filter((x) => x.system)
      .every((x) =>
        x.stale_reasons!.some((r) => /Assessed the problem at version/.test(r)),
      ),
  );
});

test('the assessor answer is checked against the packet; a bad answer is repaired, then fails without cards', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  const packet: AssessmentPacket = preview.packet;
  const good = JSON.parse(
    assessmentFixtureAnswer(assessmentRoleInput(packet))!,
  ) as AssessorOutput;
  assert.ok(checkAssessmentOutput(good, packet).ok);
  const bad = (f: (o: AssessorOutput) => void) => {
    const o = structuredClone(good);
    f(o);
    return checkAssessmentOutput(o, packet);
  };
  const first = good.assessments[0]!;
  const k = Object.keys(first.ratings)[0]!;
  assert.match(
    (
      bad((o) => (o.assessments[0]!.ratings[k]!.claim_refs = ['C99'])) as {
        problem: string;
      }
    ).problem,
    /C99, not in the packet/,
  );
  assert.match(
    (bad((o) => o.assessments.pop()) as { problem: string }).problem,
    /does not assess/,
  );
  assert.match(
    (
      bad((o) => {
        o.assessments[0]!.ratings[k]!.rating = 4;
        o.assessments[0]!.ratings[k]!.claim_refs = [];
      }) as { problem: string }
    ).problem,
    /no cited claim/,
  );
  assert.match(
    (
      bad((o) => o.assessments.push(structuredClone(first))) as {
        problem: string;
      }
    ).problem,
    /twice/,
  );
  assert.match(
    (bad((o) => delete o.assessments[0]!.ratings[k]) as { problem: string })
      .problem,
    /does not rate exactly/,
  );
  // Unknown is allowed and stays unknown: no score, no average.
  const unknown = structuredClone(good);
  for (const a of unknown.assessments)
    for (const r of Object.values(a.ratings)) {
      r.rating = null;
      r.claim_refs = [];
    }
  assert.ok(checkAssessmentOutput(unknown, packet).ok);

  // Twice invalid: one repair, then a failed workflow and no scorecards.
  adapter.override = (req) =>
    req.input[0]!.text.includes(ASSESSMENT_MARKER)
      ? answer({ ...good, assessments: [] })
      : null;
  const failed = await s.assess({ preview_hash: preview.preview_hash });
  assert.equal(failed.workflow.state, 'failed');
  assert.equal(adapter.assessments(), 2);
  assert.equal(failed.workflow.result!.assessment!.scorecards.length, 0);
  assert.equal((await s.cards()).length, 0);

  // Unknown answers are recorded as unknown: incomplete, never averaged.
  // Each request carries only its own batch of options, so answer for those.
  adapter.override = (req) => {
    if (!req.input[0]!.text.includes(ASSESSMENT_MARKER)) return null;
    const text = req.input[1]!.text;
    const asked = AssessmentPacketSchema.parse(
      JSON.parse(text.slice(text.indexOf('{'))),
    ).options.map((o) => o.ref);
    return answer({
      ...unknown,
      assessments: unknown.assessments.filter((a) => asked.includes(a.option)),
    });
  };
  const done = await s.assess();
  assert.equal(done.workflow.state, 'succeeded');
  const r = await s.report();
  for (const c of r.suitability.candidates) {
    assert.equal(c.status, 'incomplete');
    assert.equal(c.score, null);
    assert.equal(c.range!.lower.display, '0.0');
    assert.equal(c.range!.upper.display, '100.0');
  }
});

test('assessments are owner actions and refuse problems without options', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  const lone = await s.store.createEntity(owner, s.ws.id, {
    kind: 'problem',
    title: 'A problem with no options',
    body: {
      statement: 'Nothing derived yet.',
      affected_group: 'Nobody yet',
      uncertainty: 'Test.',
    },
  });
  await rejects(
    'INVALID_TRANSITION',
    s.store.previewAssessment(owner, s.ws.id, lone.id),
    /no options/,
  );
  const stranger = { actorId: '00000000-0000-4000-8000-0000000000aa' };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  const runId = await s.run();
  await assert.rejects(
    s.store.startAssessment(stranger, s.ws.id, runId, s.request()),
  ); // Too few tasks or calls for the batches the packet needs is refused up front.
  const tight = s.request();
  await rejects(
    'INVALID_CONTRACT',
    s.store.startAssessment(owner, s.ws.id, runId, {
      ...tight,
      limits: { ...tight.limits, max_children: 1, max_calls: 2 },
    }),
    /takes \d+ requests/,
  );
});

test('review fixes: an unlinked claim marks assessments stale; edits move on to a newer assessment; old evidence versions are refused', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  await s.assess();
  const r0 = await s.report();
  assert.ok(rows(r0).every((x) => !x.stale));

  // M-3: a person's edit of the first assessment moves on to replace a newer one.
  const target = rows(r0)[0]!;
  const sys1 = (await s.cards()).find((c) => c.id === target.id)!;
  const b1 = sys1.body as ScorecardBody;
  const { assessment: _a, ...plain } = b1;
  const edit = (of: { id: string; version: number }): ScorecardBody => ({
    ...plain,
    reviewer: { kind: 'human', label: 'Owner' },
    gates: {
      ethics: { status: 'clear', note: 'Checked (test).' },
      access: { status: 'clear', note: 'Checked (test).' },
    },
    edit_of: {
      scorecard: { id: of.id, version: of.version },
      reason: 'Owner knowledge (test).',
    },
  });
  const mine = await s.store.recordScorecard(owner, s.ws.id, {
    title: 'My edit',
    body: edit(sys1) as unknown as Record<string, unknown>,
  });
  // While the first assessment is current, the card cannot drop or move its edit_of.
  await rejects(
    'INVALID_CONTRACT',
    s.store.reviseScorecard(owner, s.ws.id, mine.id, {
      expected_version: mine.version,
      title: 'Drop',
      body: { ...edit(sys1), edit_of: undefined } as unknown as Record<
        string,
        unknown
      >,
      reason: 'Drop it (test).',
    }),
  );
  await s.assess();
  const sys2 = (await s.cards()).find(
    (c) =>
      c.status === 'active' &&
      (c.body as ScorecardBody).assessment &&
      (c.body as ScorecardBody).subject.id === b1.subject.id &&
      (c.body as ScorecardBody).rubric === b1.rubric,
  )!;
  assert.notEqual(sys2.id, sys1.id);
  let r1 = await s.report();
  assert.equal(rows(r1).find((x) => x.id === sys2.id)!.superseded_by, null);
  const moved = await s.store.reviseScorecard(owner, s.ws.id, mine.id, {
    expected_version: mine.version,
    title: 'My edit',
    body: edit(sys2) as unknown as Record<string, unknown>,
    reason: 'Edit the newer assessment (test).',
  });
  r1 = await s.report();
  assert.equal(rows(r1).find((x) => x.id === sys2.id)!.superseded_by, mine.id);
  assert.equal(rows(r1).find((x) => x.id === mine.id)!.edit_of, sys2.id);
  // Now it replaces a current assessment, so it cannot move back to the archived one.
  await rejects(
    'INVALID_CONTRACT',
    s.store.reviseScorecard(owner, s.ws.id, mine.id, {
      expected_version: moved.version,
      title: 'Back',
      body: edit(sys1) as unknown as Record<string, unknown>,
      reason: 'Back (test).',
    }),
  );

  // L-1: a new rating must cite the current, active version of its evidence.
  const ref = Object.values(b1.ratings).find((r) => r.evidence_refs.length)!
    .evidence_refs[0]!;
  const claim = (await s.store.getEntity(owner, s.ws.id, ref.id)).entity;
  await s.store.reviseEntity(owner, s.ws.id, ref.id, {
    expected_version: claim.version,
    title: `${claim.title} (revised)`,
    body: claim.body,
    reason: 'Wording (test).',
    corrects_version: null,
  });
  const other = rows(r1).find((x) => x.alt.id !== target.alt.id && x.system)!;
  const otherBody = (await s.cards()).find((c) => c.id === other.id)!
    .body as ScorecardBody;
  const { assessment: _b, ...otherPlain } = otherBody;
  await rejects(
    'VERSION_CONFLICT',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Cites an old version',
      body: {
        ...otherPlain,
        reviewer: { kind: 'human', label: 'Owner' },
      } as unknown as Record<string, unknown>,
    }),
    /now version/,
  );

  // M-1: a claim unlinked from the problem marks the assessment stale.
  await s.assess();
  assert.ok(rows(await s.report()).every((x) => !x.system || !x.stale));
  const pool = s.db.pool;
  const link = (
    await pool.query<{ id: string }>(
      `select id from entity_links where workspace_id = $1 and to_id = $2
         and from_kind = 'claim' and relation = 'supports' and retracted_at is null
       order by created_at limit 1`,
      [s.ws.id, s.problem.id],
    )
  ).rows[0]!;
  await s.store.retractLink(owner, s.ws.id, link.id, {
    reason: 'Not about this problem (test).',
  });
  const r2 = await s.report();
  const sys = rows(r2).filter((x) => x.system);
  assert.ok(sys.length > 0);
  assert.ok(
    sys.every((x) =>
      x.stale_reasons!.some((r) =>
        /linked to the problem or its options changed/.test(r),
      ),
    ),
  );
});

test('review L-2: an older assessment finishing late never replaces a newer one', async (t) => {
  // The call for the packet at the older problem version waits until the newer one is done.
  let v1 = 0;
  let release!: () => void;
  const newerDone = new Promise<void>((r) => (release = r));
  const adapter = new Recording();
  const inner = adapter.call.bind(adapter);
  adapter.call = async (req, signal) => {
    if (req.input[0]?.text.includes(ASSESSMENT_MARKER)) {
      const text = req.input[1]!.text;
      const packet = JSON.parse(
        text.slice(text.indexOf('\n') + 1),
      ) as AssessmentPacket;
      if (packet.problem.version === v1) {
        await newerDone;
        await new Promise((r) => setTimeout(r, 300));
        return inner(req, signal);
      }
      const out = await inner(req, signal);
      setTimeout(release, 50);
      return out;
    }
    return inner(req, signal);
  };
  const s = await setup(t, adapter);
  if (!s) return;
  v1 = s.problem.version;
  const older = await s.store.startAssessment(
    owner,
    s.ws.id,
    await s.run(),
    s.request(v1),
  );
  const p = (await s.store.getEntity(owner, s.ws.id, s.problem.id)).entity;
  await s.store.reviseEntity(owner, s.ws.id, s.problem.id, {
    expected_version: p.version,
    title: p.title,
    body: { ...p.body, uncertainty: 'Revised (test).' },
    reason: 'Clarified (test).',
    corrects_version: null,
  });
  const newer = await s.store.startAssessment(
    owner,
    s.ws.id,
    await s.run(),
    s.request(v1 + 1),
  );
  await s.worker.settle();
  const late = await s.store.getWorkflow(owner, s.ws.id, older.workflow.id);
  const fresh = await s.store.getWorkflow(owner, s.ws.id, newer.workflow.id);
  assert.equal(late.workflow.state, 'succeeded', late.workflow.reason);
  assert.equal(fresh.workflow.state, 'succeeded', fresh.workflow.reason);
  assert.equal(late.workflow.result!.assessment!.scorecards.length, 0);
  assert.ok(
    late.workflow.result!.assessment!.notes.some((n) =>
      /A newer assessment already rates/.test(n),
    ),
  );
  const active = (await s.cards()).filter(
    (c) => c.status === 'active' && (c.body as ScorecardBody).assessment,
  );
  assert.ok(active.length > 0);
  assert.ok(
    active.every(
      (c) =>
        (c.body as ScorecardBody).assessment!.workflow_id === newer.workflow.id,
    ),
  );
});

test('a problem derived from a claim reads that claim as support, in the packet and on Compare', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  const pool = s.db.pool;
  // Leave only the derived_from route: unlink every claim → problem link, then derive.
  const links = (
    await pool.query<{ id: string; from_id: string }>(
      `select id, from_id from entity_links where workspace_id = $1 and to_id = $2
         and from_kind = 'claim' and retracted_at is null`,
      [s.ws.id, s.problem.id],
    )
  ).rows;
  assert.ok(links.length > 0);
  for (const l of links)
    await s.store.retractLink(owner, s.ws.id, l.id, { reason: 'Test.' });
  assert.equal(
    (await s.store.previewAssessment(owner, s.ws.id, s.problem.id)).packet
      .claims.length,
    0,
  );
  const claim = (await s.store.getEntity(owner, s.ws.id, links[0]!.from_id))
    .entity;
  const problem = (await s.store.getEntity(owner, s.ws.id, s.problem.id))
    .entity;
  await s.store.createLink(owner, s.ws.id, {
    relation: 'derived_from',
    from: { id: problem.id, version: problem.version },
    to: { id: claim.id, version: claim.version },
    rationale: 'Drafted from this claim (test).',
  });
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.deepEqual(
    preview.packet.claims.map((c) => [c.claim_id, c.relation]),
    [[claim.id, 'supports']],
  );
  const cmp = await s.store.comparison(owner, s.ws.id, s.problem.id);
  assert.ok(cmp.claims.some((c) => c.evidence.claim.id === claim.id));
});

test('review N-5: one batch succeeds and another fails after its repair, so nothing is written', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.ok(preview.requests >= 2);
  const before = (await s.cards()).length;
  // The batch holding O1 answers well; every other batch answers with something unusable.
  adapter.override = (req) => {
    if (!req.input[0]!.text.includes(ASSESSMENT_MARKER)) return null;
    const text = req.input[1]!.text;
    const refs = AssessmentPacketSchema.parse(
      JSON.parse(text.slice(text.indexOf('{'))),
    ).options.map((o) => o.ref);
    return refs.includes('O1') ? null : answer({ bad: true });
  };
  const failed = await s.assess({ preview_hash: preview.preview_hash });
  assert.equal(failed.workflow.state, 'failed');
  assert.match(failed.workflow.result!.explanation, /for part 2 of \d+/);
  // The first batch succeeded, the second failed and was repaired once, then failed again.
  const states = failed.tasks.map((x) => `${x.ordinal}/${x.repair}:${x.state}`);
  assert.ok(states.includes('0/0:succeeded'), states.join(' '));
  assert.ok(states.includes('1/1:failed'), states.join(' '));
  assert.equal(failed.workflow.result!.assessment!.scorecards.length, 0);
  assert.equal((await s.cards()).length, before);
});

test('review L-7: a batch that fails for good stops its sibling tasks', () => {
  const limits = {
    max_children: 4,
    max_concurrency: 2,
    max_depth: 1,
    max_attempts: 1,
    max_repairs: 1,
    max_calls: 8,
    max_output_tokens: 8000,
    call_timeout_ms: 5000,
    max_wall_seconds: 600,
  } as const;
  const view = (sibling: 'queued' | 'leased' | 'cancelled') => ({
    state: 'running' as const,
    control: 'run' as const,
    limits,
    perspectives: [],
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
    steps: 3,
    now: new Date(),
    tasks: [
      {
        id: 'a',
        kind: 'assess' as const,
        ordinal: 0,
        repair: 0,
        state: 'failed' as const,
        reason: 'invalid_output',
      },
      {
        id: 'b',
        kind: 'assess' as const,
        ordinal: 0,
        repair: 1,
        state: 'failed' as const,
        reason: 'invalid_output',
      },
      {
        id: 'c',
        kind: 'assess' as const,
        ordinal: 1,
        repair: 0,
        state: sibling,
        reason: sibling === 'cancelled' ? 'failed' : '',
      },
    ],
  });
  // A queued sibling is cancelled and the workflow ends failed.
  const queued = coordinateAssessment(view('queued'), 2);
  assert.deepEqual(queued.actions, [{ type: 'cancel_open', reason: 'failed' }]);
  assert.equal(queued.state, 'failed');
  assert.match(queued.terminal!.explanation, /part 1 of 2 \(invalid_output\)/);
  // A leased sibling is waited for: no new work, no terminal state yet.
  const leased = coordinateAssessment(view('leased'), 2);
  assert.deepEqual(leased.actions, []);
  assert.equal(leased.state, 'running');
  assert.equal(leased.terminal, null);
  // Once it is cancelled, the real failure is still the one named.
  const done = coordinateAssessment(view('cancelled'), 2);
  assert.equal(done.state, 'failed');
  assert.match(done.terminal!.explanation, /part 1 of 2 \(invalid_output\)/);
});

test('P25: the preview sizes requests to the chosen plan connection input cap, and refuses with the cap to raise', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  const connections = new ConnectionStore(s.db.pool);
  const settings = JSON.parse(
    readFileSync(
      new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
      'utf8',
    ),
  ) as PlanConnection['settings'];
  const make = (label: string, cap: number) =>
    connections.createPlanConnection(owner, s.ws.id, {
      kind: 'chatgpt_plan',
      label,
      settings: {
        ...settings,
        caps: {
          ...settings.caps,
          responses: { ...settings.caps.responses, max_input_chars: cap },
        },
      },
    });
  const wide = await make('Wide', 200_000);
  const preview = await s.store.previewAssessment(
    owner,
    s.ws.id,
    s.problem.id,
    wide.id,
  );
  assert.equal(preview.limit, 200_000);
  assert.equal(preview.request_chars.length, preview.requests);
  assert.ok(preview.request_chars.every((n) => n <= 200_000));
  assert.equal(preview.claims_left_out, 0);
  assert.equal(preview.claims_over_max, 0);
  assert.equal(preview.cap_for_all, null);
  const narrow = await make('Narrow', 7_000);
  await rejects(
    'BODY_TOO_LARGE',
    s.store.previewAssessment(owner, s.ws.id, s.problem.id, narrow.id),
    /7,000 per request.*Change caps/,
  );
  // Starting on the narrow connection is refused the same way, before anything is queued.
  const runId = await s.run();
  await rejects(
    'BODY_TOO_LARGE',
    s.store.startAssessment(
      owner,
      s.ws.id,
      runId,
      s.request(s.problem.version, {
        resource_setup: {
          kind: 'subscription',
          connection_id: narrow.id,
          model_id: 'gpt-test',
          settings_hash: narrow.settings_hash,
          max_output_chars: 16_000,
        },
      }),
    ),
    /Change caps/,
  );
  const workflows = await s.store.listWorkflows(owner, s.ws.id);
  assert.ok(!workflows.some((w) => w.run_id === runId));
});

test('ADR-0091 re-review 2 N-5: a run output cap below the connection cap sizes the start to the smaller one', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  const connections = new ConnectionStore(s.db.pool);
  const settings = JSON.parse(
    readFileSync(
      new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
      'utf8',
    ),
  ) as PlanConnection['settings'];
  const conn = await connections.createPlanConnection(owner, s.ws.id, {
    kind: 'chatgpt_plan',
    label: 'Wide answers',
    settings: {
      ...settings,
      caps: {
        ...settings.caps,
        responses: {
          ...settings.caps.responses,
          max_input_chars: 200_000,
          max_output_chars: 16_000,
        },
      },
    },
  });
  const preview = await s.store.previewAssessment(
    owner,
    s.ws.id,
    s.problem.id,
    conn.id,
  );
  // One assessment per request at a 5,000-character answer cap: more requests than the
  // preview sized to the connection's 16,000, so a one-task limit is refused with that count.
  const runId = await s.run();
  const refused = await s.store
    .startAssessment(
      owner,
      s.ws.id,
      runId,
      s.request(s.problem.version, {
        resource_setup: {
          kind: 'subscription',
          connection_id: conn.id,
          model_id: 'gpt-test',
          settings_hash: conn.settings_hash,
          max_output_chars: 5_000,
        },
        limits: { ...s.request().limits, max_children: 1 },
      }),
    )
    .then(
      () => null,
      (e: unknown) => (e instanceof ContractError ? e.message : String(e)),
    );
  const taken = Number(/takes (\d+) requests/.exec(refused ?? '')?.[1]);
  assert.ok(taken > preview.requests, `${refused} vs ${preview.requests}`);
});

test('ADR-0091: a claim linked to an option is read for that option, and linking one marks the assessment stale', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  await s.assess();
  assert.ok(rows(await s.report()).every((x) => !x.stale));
  const before = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.ok(before.option_coverage.every((c) => c.linked === 0));
  // Move one problem claim onto the second option only.
  const link = (
    await s.db.pool.query<{ id: string; from_id: string }>(
      `select id, from_id from entity_links where workspace_id = $1 and to_id = $2
         and from_kind = 'claim' and retracted_at is null order by from_id limit 1`,
      [s.ws.id, s.problem.id],
    )
  ).rows[0]!;
  await s.store.retractLink(owner, s.ws.id, link.id, { reason: 'Test.' });
  const claim = (await s.store.getEntity(owner, s.ws.id, link.from_id)).entity;
  const target = before.packet.options[1]!;
  const alt = (await s.store.getEntity(owner, s.ws.id, target.alternative_id))
    .entity;
  await s.store.createLink(owner, s.ws.id, {
    relation: 'supports',
    from: { id: claim.id, version: claim.version },
    to: { id: alt.id, version: alt.version },
    rationale: 'Evidence about this option (test).',
  });
  const after = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  const read = after.packet.claims.find((c) => c.claim_id === claim.id);
  assert.ok(read, 'the option claim is in the packet');
  assert.deepEqual(read.options, [target.ref]);
  assert.equal(read.relation, 'supports');
  assert.equal(after.packet.claims.length, before.packet.claims.length);
  assert.deepEqual(
    after.option_coverage.map((c) => [c.ref, c.linked, c.read]),
    after.packet.options.map((o) =>
      o.ref === target.ref ? [o.ref, 1, 1] : [o.ref, 0, 0],
    ),
  );
  // The earlier assessment did not read it as option evidence: stale (the set changed when
  // the problem link was retracted, and stays changed with the option link).
  const r = await s.report();
  assert.ok(
    rows(r)
      .filter((x) => x.system)
      .every((x) => x.stale && /linked/.test(x.stale_reason ?? '')),
  );
  // A fresh assessment reads it and is current.
  const wf = await s.assess();
  assert.equal(wf.workflow.state, 'succeeded');
  const r2 = await s.report();
  assert.ok(rows(r2).filter((x) => x.system && !x.stale).length > 0);
  // An option claim on an archived option is not read.
  await s.store.archiveEntity(owner, s.ws.id, alt.id, {
    expected_version: alt.version,
    reason: 'Drop this option (test).',
  });
  const gone = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.ok(!gone.packet.claims.some((c) => c.claim_id === claim.id));
});

test('ADR-0091 review L-4: an option link alone marks the assessment stale, and one added after the preview stops the start', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  await s.assess();
  assert.ok(rows(await s.report()).every((x) => !x.system || !x.stale));
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  // Keep the claim's problem link and also link it to an option: the problem's claim set is
  // the same, so only the claim:option key can mark the assessment stale.
  const claimId = preview.packet.claims[0]!.claim_id;
  const claim = (await s.store.getEntity(owner, s.ws.id, claimId)).entity;
  const target = preview.packet.options[0]!;
  const alt = (await s.store.getEntity(owner, s.ws.id, target.alternative_id))
    .entity;
  await s.store.createLink(owner, s.ws.id, {
    relation: 'supports',
    from: { id: claim.id, version: claim.version },
    to: { id: alt.id, version: alt.version },
    rationale: 'Also about this option (test).',
  });
  const sys = rows(await s.report()).filter((x) => x.system);
  assert.ok(sys.length > 0);
  assert.ok(
    sys.every(
      (x) =>
        x.stale &&
        // Review 2 L-2: only option claims differ, which an upgrade also causes, so the
        // reason must not claim a link changed.
        x.stale_reasons!.some(
          (r) =>
            /did not read claims now linked to the options/.test(r) &&
            /studio was upgraded/.test(r),
        ),
    ),
  );
  const after = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  const read = after.packet.claims.find((c) => c.claim_id === claim.id)!;
  assert.deepEqual(read.options, [target.ref]);
  assert.equal(after.problem_claims_read, preview.problem_claims_read);
  // The preview read before the option link no longer matches what a start would send.
  const runId = await s.run();
  await rejects(
    'VERSION_CONFLICT',
    s.store.startAssessment(owner, s.ws.id, runId, {
      ...s.request(),
      preview_hash: preview.preview_hash,
    }),
    /changed since the preview/,
  );
});

test('ADR-0098 re-review 3 L-3: an assessment finishing while a person archives one of its options never deadlocks', async (t) => {
  const s = await setup(t, new FixtureAdapter());
  if (!s) return;
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  const opt = preview.packet.options[0]!;
  // Park the commit of the last assessor task until the audit lock is held.
  const store = s.store as unknown as {
    commitTask: (...a: unknown[]) => Promise<unknown>;
  };
  const real = store.commitTask.bind(store);
  let succeeded = 0;
  let parked!: () => void;
  const reached = new Promise<void>((r) => (parked = r));
  let go!: () => void;
  const gate = new Promise<void>((r) => (go = r));
  let commit: Promise<unknown> | null = null;
  store.commitTask = (...a: unknown[]) => {
    const outcome = a[3] as { state: string };
    if (outcome.state === 'succeeded') succeeded += 1;
    if (succeeded === preview.requests && !commit) {
      commit = (async () => {
        parked();
        await gate;
        return real(...a);
      })();
      return commit;
    }
    return real(...a);
  };
  const runId = await s.run();
  await s.store.startAssessment(owner, s.ws.id, runId, s.request());
  // No heartbeat waits on the task row while the commit holds it.
  (s.worker as unknown as { stallHeartbeats: boolean }).stallHeartbeats = true;
  const settled = s.worker.settle();
  await reached;
  const release = await holdAudit(s.db.pool);
  go();
  // The commit locks run and workflow (and, with the fix, the options) and waits for the audit lock.
  await lockWaiters(s.db.pool, 1);
  const archive = s.store.archiveEntity(owner, s.ws.id, opt.alternative_id, {
    expected_version: opt.version,
    reason: 'Drop this option (test).',
  });
  await lockWaiters(s.db.pool, 2);
  await release();
  const [c, a] = await Promise.allSettled([commit!, archive]);
  await settled;
  for (const x of [c, a])
    assert.ok(
      !(x.status === 'rejected' && /deadlock/i.test(String(x.reason))),
      String(x.status === 'rejected' && x.reason),
    );
});
