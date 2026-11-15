import assert from 'node:assert/strict';
import {
  PROPOSAL_SECTIONS,
  type ProposalBody,
  type SelectRequest,
  type SelectionReport,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  fixtureHumilityReview,
  fixtureScorecards,
} from '@creator/domain';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  type PlanConnection,
} from '@creator/contracts';
import type { ConnectionStore } from '@creator/db';
import type { PlanConnectionService } from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';
import { SUBSCRIBED, setFake, writeFakeClaude } from './claude-fake.js';

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/claude-code.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];
export const FAKE_MODEL = 'claude-test-model';

// Shared by the proposal suites: a clinic discovery with a recorded non-code selection.

export const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
export type Setup = NonNullable<Awaited<ReturnType<typeof discoverySetup>>>;

/** Clinic discovery, fixture scores, a humility review of the build, and a non-code selection. */
export async function nonCodeSelected(s: Setup) {
  const { detail, runId, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
  const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const alts = first.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await s.store.recordScorecard(owner, s.ws.id, card);
  const build = alts.find((a) => a.kind === 'build')!;
  const hybrid = alts.find((a) => a.kind === 'hybrid')!;
  const tool = alts.find((a) => a.kind === 'use_existing')!;
  const human = alts.find((a) => a.kind === 'human_led')!;
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req: SelectRequest = {
    problem: { id: report.problem.id, version: report.problem.version },
    report_hash: report.report_hash,
    dispositions: dispositions(report),
    override_reason:
      'The reminder tool fits better now; the build waits for evidence (test).',
    rationale: 'Recommend the existing reminder tool; no new software now.',
    shortlist_size: 3,
    data_class: 'synthetic',
  };
  const asked = await s.store.select(owner, s.ws.id, runId, req);
  if (asked.status === 'needs_human') {
    const d = await s.store.getDecision(
      owner,
      s.ws.id,
      asked.admission.decision_id!,
    );
    await s.store.answerDecision(owner, s.ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Approved for this exact version (test).',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
  }
  const done =
    asked.status === 'recorded'
      ? asked
      : await s.store.select(owner, s.ws.id, runId, req);
  assert.equal(done.status, 'recorded', done.admission.explanation);
  return {
    runId,
    problem,
    evidence,
    build,
    hybrid,
    tool,
    human,
    selection: done.selection!,
  };
}
export function dispositions(
  report: SelectionReport,
): SelectRequest['dispositions'] {
  return report.suitability.candidates.map((c) => {
    const alternative = {
      id: c.alternative.id,
      version: c.alternative.version,
    };
    switch (c.alternative.kind) {
      case 'use_existing':
        return {
          alternative,
          disposition: 'recommend_alternative' as const,
          reasons: ['Highest suitability; reminders can be turned on now.'],
          reverse_if: 'Reminders are already configured at every clinic.',
        };
      case 'build':
      case 'hybrid':
        return {
          alternative,
          disposition: 'research_further' as const,
          reasons: ['Not preferable to the existing tool yet.'],
          reverse_if: 'Prediction quality is shown on clinic data.',
        };
      case 'human_led':
        return {
          alternative,
          disposition: 'defer' as const,
          reasons: ['No coordinator time this quarter.'],
          reverse_if: 'A coordinator is funded.',
        };
      default:
        return {
          alternative,
          disposition: 'reject' as const,
          reasons: ['Lower suitability.'],
          reverse_if: 'It proves distinct.',
        };
    }
  });
}
export const filled = (body: ProposalBody): ProposalBody => {
  const sections = structuredClone(body.sections);
  for (const k of PROPOSAL_SECTIONS)
    if (sections[k].state === 'unknown' && k !== 'contrary_evidence')
      sections[k] = {
        state: 'written',
        text: `Written ${k} for the test.`,
        claims: [],
      };
  return { ...body, sections };
};

// A checked Claude Code connection on a fake `claude`, for model drafts (ADR-0101).
export function fakeHost(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'creator-draft-'));
  const bin = writeFakeClaude(join(dir, 'bin'));
  const config_dir = join(dir, 'config');
  setFake(config_dir, { status: SUBSCRIBED, text });
  return { bin, config_dir, work_dir: join(config_dir, 'empty-workdir') };
}

/** A checked Claude Code connection with a verified model, allowed private data. */
export async function connect(
  store: ConnectionStore,
  ws: string,
  service: PlanConnectionService,
) {
  let conn = await store.createPlanConnection(owner, ws, {
    kind: 'claude_code',
    label: 'Claude Code on this computer',
    settings: SETTINGS,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws, conn.id)).connection;
  await service.checkClaudeCode(owner, ws, conn.id);
  conn = await current();
  await store.attestPlanCredits(owner, ws, conn.id, {
    expected_version: conn.version,
    statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
    checked_on: '2026-11-01',
  });
  conn = await current();
  await store.acceptPlanCaps(owner, ws, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  conn = await current();
  const g = await store.createPlanVerificationGrant(owner, ws, conn.id, {
    expected_version: conn.version,
    model_id: FAKE_MODEL,
    path: 'responses',
    expires_in_minutes: 30,
  });
  await service.verifyModel(owner, ws, conn.id, {
    id: g.id,
    model_id: FAKE_MODEL,
  });
  conn = await current();
  await store.updatePlanSettings(owner, ws, conn.id, {
    expected_version: conn.version,
    settings: {
      ...conn.settings,
      allowed_data_classes: [
        ...conn.settings.allowed_data_classes,
        'private_approved',
      ],
    },
  });
  conn = await current();
  await store.acceptPlanCaps(owner, ws, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  return conn;
}
