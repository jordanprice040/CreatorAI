import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  type Binding,
  type ErrorCode,
  type Grant,
  type HumilityBody,
} from '@creator/contracts';
import {
  authConfig,
  canonicalHash,
  checkAnswer,
  evaluateAction,
  humilityGate,
  type AdmissionInput,
  type AnswerCheck,
} from '@creator/domain';
import { createApi } from '@creator/api';

const throwsCode = (code: ErrorCode, fn: () => unknown) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const NOW = Date.parse('2026-10-18T12:00:00Z');
const later = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const runId = randomUUID();
const target = {
  id: randomUUID(),
  version: 2,
  content_hash: canonicalHash('v2'),
  kind: 'idea',
};
const binding = (b: Partial<Binding> = {}): Binding => ({
  action_type: 'record.revise',
  run_id: runId,
  target,
  spec_hash: null,
  amount_nano_usd: null,
  data_class: 'synthetic',
  ...b,
});
const grant = (g: Partial<Grant> = {}): Grant => ({
  id: randomUUID(),
  workspace_id: randomUUID(),
  version: 1,
  scope: 'standing',
  status: 'active',
  run_id: null,
  action_types: ['record.revise'],
  target_kind: null,
  target: null,
  spec_hash: null,
  max_amount_nano_usd: null,
  allow_irreversible: false,
  allow_external_effects: false,
  data_classes: ['synthetic'],
  expires_at: later(24),
  decision_id: null,
  policy_version: 'oversight/1.0',
  rationale: 'Synthetic test grant',
  created_by: randomUUID(),
  created_at: new Date(NOW).toISOString(),
  revoked_at: null,
  revoke_reason: null,
  ...g,
});
const input = (i: Partial<AdmissionInput> = {}): AdmissionInput => ({
  mode: 'human_in_loop',
  runState: 'active',
  stageGates: [],
  binding: binding(),
  grants: [],
  initialGrants: [],
  assumptions: [],
  humility: null,
  flags: [],
  resolvedReasons: [],
  now: NOW,
  ...i,
});

test('a routine reversible action covered by a standing grant proceeds with no human input', () => {
  const v = evaluateAction(input({ grants: [grant()] }));
  assert.equal(v.verdict, 'allow');
  assert.deepEqual(v.reasons, []);
  // A routine, reversible, cheaply testable assumption is logged, not asked about.
  const a = evaluateAction(
    input({
      grants: [grant()],
      assumptions: [
        {
          id: 'a1',
          status: 'active',
          body: { status: 'unresolved', materiality: 'routine' },
        },
      ],
    }),
  );
  assert.equal(a.verdict, 'allow');
  assert.deepEqual(a.provisional_assumptions, ['a1']);
});

test('expired, revoked, changed-target and over-cap grants do not authorize', () => {
  for (const g of [
    grant({ expires_at: new Date(NOW).toISOString() }),
    grant({ status: 'revoked' }),
    grant({ run_id: randomUUID() }),
    grant({ data_classes: ['public'] }),
    grant({
      scope: 'once',
      run_id: runId,
      target: { ...target, content_hash: canonicalHash('v1') },
    }),
  ]) {
    const v = evaluateAction(input({ grants: [g] }));
    assert.equal(v.verdict, 'request_human');
    assert.deepEqual(v.reasons, ['outside_grant']);
    assert.equal(v.decision_kind, 'authorization');
  }
  // Unknown spend is not zero: an amount needs a configured cap that holds it.
  const paid = binding({
    action_type: 'tool.search_public',
    target: null,
    amount_nano_usd: '5',
  });
  const searchGrant = grant({ action_types: ['tool.search_public'] });
  assert.equal(
    evaluateAction(input({ binding: paid, grants: [searchGrant] })).verdict,
    'request_human',
  );
  assert.equal(
    evaluateAction(
      input({
        binding: paid,
        grants: [{ ...searchGrant, max_amount_nano_usd: '4' }],
      }),
    ).verdict,
    'request_human',
  );
  assert.equal(
    evaluateAction(
      input({
        binding: paid,
        grants: [{ ...searchGrant, max_amount_nano_usd: '5' }],
      }),
    ).verdict,
    'allow',
  );
});

test('human-only runs cannot call models, even for summaries and even with a grant', () => {
  for (const action_type of [
    'model.summarize',
    'model.generate',
    'model.embed',
  ] as const) {
    const v = evaluateAction(
      input({
        mode: 'human_only',
        binding: binding({ action_type, target: null }),
        grants: [grant({ action_types: [action_type] })],
      }),
    );
    assert.equal(v.verdict, 'deny');
    assert.equal(v.reason_code, 'human_only_model_denied');
  }
  // Ordinary non-generative tools still follow their grants.
  assert.equal(
    evaluateAction(input({ mode: 'human_only', grants: [grant()] })).verdict,
    'allow',
  );
});

test('autonomous runs defer as needs_human and use only their initial grant packet', () => {
  const g = grant();
  const v = evaluateAction(
    input({ mode: 'autonomous_within_scope', grants: [g], initialGrants: [] }),
  );
  assert.equal(v.verdict, 'defer');
  assert.equal(v.outcome, 'needs_human');
  assert.equal(v.decision_kind, null);
  // A grant revised after the run started (new version) is not the packet it was given.
  assert.equal(
    evaluateAction(
      input({
        mode: 'autonomous_within_scope',
        grants: [{ ...g, version: 2 }],
        initialGrants: [{ id: g.id, version: 1 }],
      }),
    ).verdict,
    'defer',
  );
  const ok = evaluateAction(
    input({
      mode: 'autonomous_within_scope',
      grants: [g],
      initialGrants: [{ id: g.id, version: 1 }],
    }),
  );
  assert.equal(ok.verdict, 'allow');
  const judgment = evaluateAction(
    input({
      mode: 'autonomous_within_scope',
      grants: [g],
      initialGrants: [{ id: g.id, version: 1 }],
      flags: ['stakeholder_conflict'],
    }),
  );
  assert.equal(judgment.verdict, 'defer');
  assert.deepEqual(judgment.reasons, ['stakeholder_conflict']);
});

test('stage gates need an approval of the exact action; flags only add reasons; owner-only actions never pass', () => {
  const gated = input({
    mode: 'supervised',
    stageGates: ['record.revise'],
    grants: [grant()],
  });
  assert.deepEqual(evaluateAction(gated).reasons, ['stage_gate']);
  const once = grant({
    scope: 'once',
    run_id: runId,
    target,
    decision_id: randomUUID(),
  });
  assert.equal(evaluateAction({ ...gated, grants: [once] }).verdict, 'allow');
  // A model flag cannot lift the authorization need, only add a value question first.
  const flagged = evaluateAction(
    input({ flags: ['outside_grant', 'source_disagreement'] }),
  );
  assert.equal(flagged.decision_kind, 'judgment');
  assert.deepEqual(flagged.reasons.sort(), [
    'outside_grant',
    'source_disagreement',
  ]);
  // An answered judgment clears only that judgment, never the authorization.
  const resolved = evaluateAction(
    input({
      flags: ['source_disagreement'],
      resolvedReasons: ['source_disagreement', 'outside_grant'],
    }),
  );
  assert.deepEqual(resolved.reasons, ['outside_grant']);
  for (const action_type of [
    'grant.create',
    'policy.change',
    'budget.increase',
  ] as const)
    assert.equal(
      evaluateAction(
        input({
          binding: binding({ action_type, target: null }),
          grants: [grant({ action_types: [action_type] })],
        }),
      ).reason_code,
      'owner_only_action',
    );
  assert.equal(
    evaluateAction(input({ runState: 'cancelled', grants: [grant()] }))
      .reason_code,
    'run_cancelled',
  );
});

const review = (b: Partial<HumilityBody> = {}): HumilityBody => {
  const c = (viable: boolean) => ({
    assessment: 'Synthetic comparison.',
    viable,
    evidence_refs: [{ id: randomUUID(), version: 1 }],
  });
  return {
    subject: { id: target.id, version: target.version },
    outcome_that_matters: 'Volunteers know their shifts.',
    whose_perspective: 'Volunteers and the coordinator.',
    evidence: {
      supported: ['Missed shifts reported'],
      inferred: [],
      disputed: [],
      unknown: ['Volume'],
    },
    comparisons: {
      software: c(true),
      existing_tool: c(true),
      process_change: c(true),
      human_led: c(false),
      hybrid: c(true),
      defer_decline: c(true),
    },
    software_part: 'Reminders.',
    human_part: 'Assigning shifts.',
    burden_risks: [],
    disconfirming_test: 'Run a paper roster for two weeks.',
    change_course_trigger: 'Paper roster removes the gaps.',
    ethical: { status: 'none_identified', note: 'No sensitive data.' },
    disposition: 'build',
    rationale: 'Existing tools lack the reminder link.',
    dissent: [],
    ...b,
  };
};
test('the humility gate blocks non-build dispositions and escalates unresolved ethics as judgment', () => {
  const r = (b: Partial<HumilityBody>) =>
    humilityGate(
      { id: randomUUID(), version: 1, status: 'active', body: review(b) },
      target,
    );
  assert.equal(r({}).build_admissible, true);
  for (const disposition of [
    'use_existing',
    'change_process',
    'human_led',
    'defer',
    'decline',
  ] as const)
    assert.equal(r({ disposition }).build_admissible, false);
  assert.equal(
    r({ subject: { id: target.id, version: 1 } }).build_admissible,
    false,
  );
  const ethics = r({
    ethical: { status: 'unresolved_serious', note: 'Consent unclear.' },
  });
  assert.equal(ethics.build_admissible, false);
  assert.equal(ethics.needs_judgment, true);
  const build = input({
    mode: 'supervised',
    stageGates: ['product.commit_build'],
    binding: binding({ action_type: 'product.commit_build' }),
    grants: [grant({ action_types: ['product.commit_build'] })],
  });
  assert.equal(evaluateAction(build).reason_code, 'humility_review_required');
  assert.equal(
    evaluateAction({ ...build, humility: r({ disposition: 'use_existing' }) })
      .reason_code,
    'humility_gate_failed',
  );
  assert.equal(
    evaluateAction({ ...build, humility: ethics }).decision_kind,
    'judgment',
  );
  // No numerical confidence field exists to stand in for the comparison.
  throwsCode('INVALID_CONTRACT', () =>
    humilityGate(
      {
        id: randomUUID(),
        version: 1,
        status: 'active',
        body: { ...review(), confidence: 0.9 },
      },
      target,
    ),
  );
});

const answer = (a: Partial<AnswerCheck> = {}): AnswerCheck => ({
  kind: 'authorization',
  status: 'pending',
  expiresAt: later(1),
  runState: 'active',
  options: [{ id: 'approve' }, { id: 'reject' }],
  coverageHash: 'h',
  coverageCurrent: true,
  standingOffered: true,
  responderKind: 'human',
  responderRole: 'owner',
  now: NOW,
  answer: {
    choice: 'approve_once',
    option_id: null,
    coverage_hash: 'h',
    standing_expires_at: null,
  },
  ...a,
});
test('answers: only owners who are people, only while current, and only the right kind of answer', () => {
  checkAnswer(answer());
  throwsCode('ACCESS_DENIED', () =>
    checkAnswer(answer({ responderKind: 'agent' })),
  );
  throwsCode('ACCESS_DENIED', () =>
    checkAnswer(answer({ responderRole: 'editor' })),
  );
  throwsCode('INVALID_TRANSITION', () =>
    checkAnswer(answer({ runState: 'cancelled' })),
  );
  throwsCode('EXPIRED', () =>
    checkAnswer(answer({ expiresAt: new Date(NOW).toISOString() })),
  );
  throwsCode('VERSION_CONFLICT', () =>
    checkAnswer(answer({ coverageCurrent: false })),
  );
  throwsCode('VERSION_CONFLICT', () =>
    checkAnswer(
      answer({ answer: { ...answer().answer, coverage_hash: 'old' } }),
    ),
  );
  // A spending or action grant does not answer a value question, and vice versa.
  throwsCode('INVALID_CONTRACT', () =>
    checkAnswer(answer({ kind: 'judgment' })),
  );
  throwsCode('INVALID_CONTRACT', () =>
    checkAnswer(
      answer({
        answer: {
          ...answer().answer,
          choice: 'choose_option',
          option_id: 'approve',
        },
      }),
    ),
  );
  throwsCode('INVALID_CONTRACT', () =>
    checkAnswer(
      answer({
        standingOffered: false,
        answer: {
          ...answer().answer,
          choice: 'approve_standing',
          standing_expires_at: later(24),
        },
      }),
    ),
  );
  checkAnswer(
    answer({
      answer: {
        ...answer().answer,
        choice: 'approve_standing',
        standing_expires_at: later(24),
      },
    }),
  );
  throwsCode('INVALID_CONTRACT', () =>
    checkAnswer(
      answer({
        answer: {
          ...answer().answer,
          choice: 'approve_standing',
          standing_expires_at: later(24 * 91),
        },
      }),
    ),
  );
});

test('development login fails validation in hosted mode; hosted deployment stays unavailable', () => {
  throwsCode('INVALID_CONFIG', () =>
    authConfig({
      CREATOR_DEPLOYMENT_MODE: 'hosted',
      CREATOR_AUTH_MODE: 'dev_local',
      CREATOR_COOKIE_SECURE: 'true',
    }),
  );
  assert.throws(
    () => createApi({ CREATOR_DEPLOYMENT_MODE: 'hosted' }),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_CONFIG' &&
      e.details.some((d) => d.includes('Development login')),
  );
  const oidc = {
    CREATOR_DEPLOYMENT_MODE: 'hosted',
    CREATOR_OIDC_ISSUER: 'https://id.example.org',
    CREATOR_OIDC_CLIENT_ID: 'creator',
    CREATOR_OIDC_REDIRECT_URI:
      'https://studio.example.org/api/auth/oidc/callback',
    CREATOR_OIDC_OWNER_SUBJECT: 'owner',
    CREATOR_WEB_ORIGIN: 'https://studio.example.org',
  };
  assert.equal(authConfig(oidc).mode, 'oidc');
  throwsCode('INVALID_CONFIG', () =>
    authConfig({ ...oidc, CREATOR_COOKIE_SECURE: 'false' }),
  );
  throwsCode('INVALID_CONFIG', () =>
    authConfig({ ...oidc, CREATOR_OIDC_ISSUER: 'http://id.example.org' }),
  );
  // Hosted operation itself is a later milestone, so the service config still refuses it.
  throwsCode('INVALID_CONFIG', () => createApi(oidc));
  throwsCode('INVALID_CONFIG', () =>
    authConfig({ CREATOR_DEV_LOGIN_CODE: 'short' }),
  );
});
