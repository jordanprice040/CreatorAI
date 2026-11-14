// ADR-0105 (B1): the rules behind "Qualify building" and the Build page's web note. The server
// decides each start; these say why first, in its words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  PlanQualification,
  RecipeBenchmarkOffers,
  RecipeQualificationRecord,
} from '@creator/contracts';
import { loadWeb } from './web-module.js';

type Offer = RecipeBenchmarkOffers['benchmarks'][number];
const m = (await loadWeb('build-qualification.ts')) as {
  startBlockers: (i: {
    allowedTasks: readonly string[];
    allowedData: readonly string[];
    verified: readonly string[];
    qualifications: readonly PlanQualification[];
    records: readonly RecipeQualificationRecord[];
    model: string;
    offer: Offer;
  }) => string[];
  startPacket: (o: Offer, model: string, fixture: boolean) => string[];
  webBuildNote: (
    r: readonly RecipeQualificationRecord[],
    roles: { connection_id: string; model_id: string },
    prompts: RecipeBenchmarkOffers['role_prompts'] | null,
  ) => { qualified: boolean; text: string };
  recordLine: (
    r: RecipeQualificationRecord,
    p: RecipeBenchmarkOffers['role_prompts'] | null,
  ) => string;
};

const prompts = {
  builder_prompt_sha256: 'b'.repeat(64),
  reviewer_prompt_sha256: 'c'.repeat(64),
};
const conn = randomUUID();
const offer: Offer = {
  id: 'p15-small-signup-v5',
  recipe: 'static-web/1',
  scale: 'small',
  label: 'Web page: a sign-up form',
  copied_from: 'p15-small-signup-v4',
  attempts: 3,
  caps: {
    max_repairs: 1,
    max_calls: 4,
    max_output_tokens: 8000,
    timeout_ms: 120000,
  },
  typical_requests: 2,
  extended_cases: 0,
  max_requests: 24,
  freeze_problems: [],
};
const role = (task_class: string): PlanQualification =>
  ({
    id: randomUUID(),
    connection_id: conn,
    model_id: 'm',
    task_class,
    state: 'qualified',
    prompt_current: true,
    created_at: '2026-11-14T00:00:00.000Z',
    decided_at: '2026-11-14T00:00:00.000Z',
  }) as unknown as PlanQualification;
const record = (
  over: Partial<RecipeQualificationRecord> = {},
): RecipeQualificationRecord => ({
  id: randomUUID(),
  workspace_id: randomUUID(),
  connection_id: conn,
  recipe: 'static-web/1',
  benchmark_id: 'p15-small-signup-v5',
  model_id: 'm',
  ...prompts,
  freeze_sha256: 'd'.repeat(64),
  source: 'in_app',
  fixture: false,
  state: 'qualified',
  attempts_needed: 3,
  passed: 3,
  reason: null,
  evidence: null,
  attempts: [],
  executing: false,
  version: 5,
  created_by: randomUUID(),
  created_at: '2026-11-14T10:00:00.000Z',
  finished_at: '2026-11-14T10:20:00.000Z',
  ...over,
});
const input = {
  allowedTasks: ['patch_build', 'independent_review'],
  allowedData: ['synthetic'],
  verified: ['m'],
  qualifications: [role('patch_build'), role('independent_review')],
  records: [] as RecipeQualificationRecord[],
  model: 'm',
  offer,
};

test('a build qualification may start only with both roles qualified, the freeze intact and nothing running', () => {
  assert.deepEqual(m.startBlockers(input), []);
  assert.match(
    m
      .startBlockers({ ...input, qualifications: [role('patch_build')] })
      .join(' '),
    /isn't qualified as the reviewer yet: qualify it with t12-reviewer-v2/,
  );
  assert.match(
    m
      .startBlockers({
        ...input,
        qualifications: [
          { ...role('patch_build'), prompt_current: false },
          role('independent_review'),
        ],
      })
      .join(' '),
    /isn't qualified as the builder/,
  );
  assert.match(
    m.startBlockers({ ...input, verified: [] }).join(' '),
    /Verify a model/,
  );
  assert.match(
    m.startBlockers({ ...input, allowedTasks: ['patch_build'] }).join(' '),
    /doesn't allow the reviewer/,
  );
  assert.match(
    m
      .startBlockers({
        ...input,
        offer: { ...offer, freeze_problems: ['x changed'] },
      })
      .join(' '),
    /can't run: x changed/,
  );
  assert.match(
    m
      .startBlockers({
        ...input,
        records: [record({ state: 'running', passed: 0 })],
      })
      .join(' '),
    /already running/,
  );
});

test('the start packet states the attempts, the request bound and the cost before anything is sent', () => {
  const real = m.startPacket(offer, 'm', false).join(' ');
  assert.match(real, /3 builds/);
  assert.match(real, /up to 4 \(1 repair round\)/);
  assert.match(real, /most it can use is 24 requests/);
  assert.match(real, /\$0 on the plan/);
  assert.match(m.startPacket(offer, 'm', true).join(' '), /fixture/);
});

test("the Build note says qualified only for a non-fixture pass on these roles and today's prompts", () => {
  const roles = { connection_id: conn, model_id: 'm' };
  assert.equal(m.webBuildNote([record()], roles, prompts).qualified, true);
  for (const r of [
    record({ fixture: true }),
    record({ state: 'not_qualified', passed: 1 }),
    record({ model_id: 'other' }),
    record({ builder_prompt_sha256: 'e'.repeat(64) }),
  ])
    assert.equal(m.webBuildNote([r], roles, prompts).qualified, false);
  assert.equal(m.webBuildNote([record()], roles, null).qualified, false);
  assert.match(
    m.webBuildNote([record({ state: 'running', passed: 1 })], roles, prompts)
      .text,
    /running .*1 of 3 passed so far/,
  );
  assert.match(
    m.recordLine(record({ reviewer_prompt_sha256: 'e'.repeat(64) }), prompts),
    /older role prompts/,
  );
  assert.match(
    m.recordLine(record({ source: 'imported' }), prompts),
    /recorded before the app/,
  );
});
