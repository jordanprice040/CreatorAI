import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditPlanSchema,
  SearchQuerySchema,
  type AuditPlan,
} from '@creator/contracts';
import {
  acceptModelPlan,
  auditCompilerInput,
  auditPlanFixtureAnswer,
  compileAuditQuestion,
  cosine,
  fixtureEmbedding,
  localTimestamp,
  questionWindow,
} from '@creator/domain';

const NOW = new Date('2026-10-19T02:30:00Z'); // still Oct 18 in New York
const opts = { tz: 'America/New_York', limit: 50, now: NOW };
const compiled = (q: string): AuditPlan => {
  const r = compileAuditQuestion(q, opts);
  assert.equal(r.status, 'compiled', JSON.stringify(r));
  return (r as { plan: AuditPlan }).plan;
};

test('questions compile to one plan from the closed list, with names and ids as parameters only', () => {
  const sources = compiled(
    'Which sources does product "Roster with reminders" come from?',
  );
  assert.deepEqual(
    {
      intent: sources.intent,
      ...('subject' in sources ? { s: sources.subject } : {}),
    },
    {
      intent: 'source_to_product',
      s: { title: 'Roster with reminders', kind: 'product' },
    },
  );
  assert.equal(
    (compiled('Which products use source 1a2b3c4d?') as { direction: string })
      .direction,
    'to_products',
  );
  assert.deepEqual(compiled('How much did run 1a2b3c4d cost?'), {
    version: 'audit-plan/1',
    limit: 50,
    intent: 'run_cost',
    run: { id: '1a2b3c4d' },
  });
  const both = compiled('What did products "A" and "B" cost together?');
  assert.equal(both.intent, 'subject_cost');
  assert.equal((both as { subjects: unknown[] }).subjects.length, 2);

  // Injected text never becomes part of a plan except as a bound id or title value.
  for (const q of [
    "How much did run 1a2b3c4d'; drop table entities; -- cost?",
    'How much did run 1a2b3c4d; update budget_reservations set incurred_nano = 0 cost?',
  ]) {
    const plan = compiled(q);
    assert.deepEqual(plan, {
      version: 'audit-plan/1',
      limit: 50,
      intent: 'run_cost',
      run: { id: '1a2b3c4d' },
    });
  }
  const quoted = compiled(
    'Which sources does product "x\'); delete from entities; --" come from?',
  );
  assert.deepEqual((quoted as { subject: unknown }).subject, {
    title: "x'); delete from entities; --",
    kind: 'product',
  });
  // An all-letter word is not read as an id prefix; questions outside the list are refused.
  assert.equal(
    compileAuditQuestion('tell me a joke', opts).status,
    'unsupported',
  );
  assert.equal(
    compileAuditQuestion('How much did it cost?', opts).status,
    'unsupported',
  );
});

test("time windows are calendar days in the asker's zone", () => {
  // 02:30 UTC on the 19th is the evening of the 18th in New York.
  assert.deepEqual(questionWindow('activity today', 'America/New_York', NOW), {
    from: '2026-10-18',
    to: '2026-10-18',
    tz: 'America/New_York',
  });
  assert.deepEqual(questionWindow('activity today', 'UTC', NOW), {
    from: '2026-10-19',
    to: '2026-10-19',
    tz: 'UTC',
  });
  assert.deepEqual(
    questionWindow('in the last 7 days', 'America/New_York', NOW),
    { from: '2026-10-12', to: '2026-10-18', tz: 'America/New_York' },
  );
  assert.deepEqual(
    questionWindow('between 2026-10-01 and 2026-10-05', 'UTC', NOW),
    { from: '2026-10-01', to: '2026-10-05', tz: 'UTC' },
  );
  // "since" includes the named day; "after" and "before" exclude it.
  assert.deepEqual(questionWindow('changes since 2026-10-05', 'UTC', NOW), {
    from: '2026-10-05',
    to: null,
    tz: 'UTC',
  });
  assert.deepEqual(questionWindow('changes after 2026-10-05', 'UTC', NOW), {
    from: '2026-10-06',
    to: null,
    tz: 'UTC',
  });
  assert.deepEqual(questionWindow('changes before 2026-10-05', 'UTC', NOW), {
    from: null,
    to: '2026-10-04',
    tz: 'UTC',
  });
  assert.equal(
    localTimestamp('2026-10-19T07:31:06.000Z', 'America/New_York'),
    '2026-10-19T03:31:06-04:00',
  );
  assert.equal(
    localTimestamp('2026-12-19T07:31:06.000Z', 'America/New_York'),
    '2026-12-19T02:31:06-05:00',
  );
  assert.equal(
    SearchQuerySchema.safeParse({
      q: '',
      types: ['record'],
      kind: null,
      status: null,
      limit: 5,
      tz: 'Mars/Olympus',
    }).success,
    false,
  );
  assert.equal(
    SearchQuerySchema.safeParse({
      q: '',
      types: ['record'],
      kind: null,
      status: null,
      limit: 5,
      from: '2026-10-05',
      to: '2026-10-01',
    }).success,
    false,
  );
});

test('a model-proposed plan is held to the strict schema: SQL, unknown intents and wide limits are refused', () => {
  const good = compiled('How much did run 1a2b3c4d cost?');
  assert.equal(acceptModelPlan(JSON.stringify(good)).status, 'compiled');
  for (const bad of [
    { ...good, sql: 'drop table entities' },
    { ...good, intent: 'raw_sql', query: 'select * from auth_sessions' },
    { ...good, limit: 100000 },
    { ...good, run: { id: "1a2b3c4d' or 1=1 --" } },
    'not json',
  ]) {
    const r = acceptModelPlan(
      typeof bad === 'string' ? bad : JSON.stringify(bad),
    );
    assert.equal(r.status, 'refused', JSON.stringify(bad));
  }
  assert.equal(
    acceptModelPlan('{"unsupported":"I cannot answer that"}').status,
    'unsupported',
  );
  // The fixture model answers with the rules compiler's plan, which the schema accepts.
  const answer = auditPlanFixtureAnswer(
    auditCompilerInput('How much did run 1a2b3c4d cost?', 'UTC', 20),
  );
  assert.ok(answer);
  assert.equal(AuditPlanSchema.parse(JSON.parse(answer)).intent, 'run_cost');
});

test('the fixture embedding is deterministic and ranks shared spellings above unrelated text', () => {
  const q = fixtureEmbedding('invoice reminders');
  assert.deepEqual(q, fixtureEmbedding('invoice reminders'));
  assert.equal(q.length, 64);
  assert.ok(
    cosine(q, fixtureEmbedding('reminder emails for unpaid invoices')) >
      cosine(q, fixtureEmbedding('parking spaces and lunch options')),
  );
  assert.equal(cosine([], []), 0);
});
