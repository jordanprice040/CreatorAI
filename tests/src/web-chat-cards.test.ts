import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import {
  AnswerDecisionRequestSchema,
  CreateEntityRequestSchema,
  CreateEnvelopeRequestSchema,
  CreateStandingGrantRequestSchema,
  RegisterRunRequestSchema,
  StartDiscoveryRequestSchema,
  type z,
} from '@creator/contracts';

// ADR-0083 (P20): the rules behind Chat's cards. A card asks the form's questions one at a
// time, and once answered its plan is exactly the requests the form makes: every body here is
// checked against the server's own request schema, so a card cannot drift from its form.

type Value = string | string[];
type Question = {
  key: string;
  label: string;
  routine?: boolean;
  optional?: boolean;
  fallback?: Value;
};
type Step = {
  label: string;
  path: string;
  body: unknown;
  capture?: Record<string, string>;
};
type View = {
  questions: Question[];
  current: Question | null;
  missing: string[];
  steps: Step[];
  blockers: string[];
  subjects: { kind: string; id: string; version: number }[];
  title: string;
};
type Ctx = {
  ws: string;
  fixture: boolean;
  advanced: boolean;
  reviewer: string;
  now: number;
};
type Mod = {
  cardView: (
    kind: string,
    input: Record<string, unknown>,
    data: unknown,
    ctx: Ctx,
  ) => View;
  fill: (v: unknown, got: Record<string, unknown>) => unknown;
  pick: (v: unknown, path: string) => unknown;
  cardForStep: (
    view: string | null,
    f: { sources: number; scorecards: number },
  ) => string | null;
};

const src = new URL('../../apps/web/src/', import.meta.url);
const nodeRequire = createRequire(new URL('chat-cards.ts', src));
const loaded = new Map<string, unknown>();
/** Loads a web module with its sibling imports transpiled the same way. */
async function load(file: string): Promise<unknown> {
  if (loaded.has(file)) return loaded.get(file);
  const source = await readFile(new URL(file, src), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const siblings = new Map<string, unknown>();
  for (const m of code.matchAll(/require\("(\.\/[^"]+)\.js"\)/g))
    siblings.set(`${m[1]}.js`, await load(`${m[1]!.slice(2)}.ts`));
  const exports = {};
  new Function('require', 'exports', code)(
    (name: string) => siblings.get(name) ?? nodeRequire(name),
    exports,
  );
  loaded.set(file, exports);
  return exports;
}
const cards = () => load('chat-cards.ts') as Promise<Mod>;

const ws = randomUUID();
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  ws,
  fixture: true,
  advanced: false,
  reviewer: 'Jordan',
  now: Date.parse('2026-11-11T12:00:00Z'),
  ...over,
});
const ok = <T>(schema: z.ZodType<T>, body: unknown, what: string) => {
  const r = schema.safeParse(body);
  assert.ok(r.success, `${what}: ${JSON.stringify(r.error?.issues)}`);
};
/** Answers every question the card asks, in order, with the given values. */
function walk(
  m: Mod,
  kind: string,
  data: unknown,
  answers: Record<string, Value>,
  c = ctx(),
  start: Record<string, unknown> = { _op: randomUUID(), _opened: c.now },
) {
  const input: Record<string, unknown> = { ...start };
  const asked: string[] = [];
  for (let i = 0; i < 30; i++) {
    const v = m.cardView(kind, input, data, c);
    if (!v.current) return { view: v, asked, input };
    const q = v.current;
    assert.ok(Object.hasOwn(answers, q.key), `${kind} asked ${q.key}`);
    asked.push(q.key);
    input[q.key] = answers[q.key];
  }
  throw new Error('the card kept asking');
}

test('Standard uses routine defaults without asking; Advanced asks them, filled in', async () => {
  const m = await cards();
  const data = { budgets: 0, fixturePricing: false, pricingBody: { x: 1 } };
  const standard = walk(m, 'fund_budget', data, {});
  assert.deepEqual(standard.asked, []);
  assert.deepEqual(standard.view.blockers, []);
  assert.equal(standard.view.steps.length, 2);
  const [budget, pricing] = standard.view.steps;
  ok(CreateEnvelopeRequestSchema, budget!.body, 'budget');
  assert.equal(budget!.path, `workspaces/${ws}/budgets`);
  assert.equal(
    (budget!.body as { cap_nano_usd: string }).cap_nano_usd,
    '100000000000',
  );
  assert.equal(pricing!.path, `workspaces/${ws}/pricing`);

  const advanced = walk(
    m,
    'fund_budget',
    { ...data, fixturePricing: true },
    { name: 'Clinic budget', cap: '2.5' },
    ctx({ advanced: true }),
  );
  assert.deepEqual(advanced.asked, ['name', 'cap']);
  assert.equal(advanced.view.steps.length, 1, 'pricing already there');
  assert.equal(
    (advanced.view.steps[0]!.body as { cap_nano_usd: string }).cap_nano_usd,
    '2500000000',
  );
  // A cap that is not a number is named, and nothing would be sent.
  const bad = m.cardView('fund_budget', { name: 'x', cap: 'ten' }, data, ctx());
  assert.equal(bad.steps.length, 0);
  assert.match(bad.blockers.join(' '), /number/);
});

test('a model hint only prefills; the question is still asked and still needed', async () => {
  const m = await cards();
  const data = {
    claims: [{ id: randomUUID(), version: 2, title: 'Waits are long' }],
    route: {
      kind: 'api',
      envelope: randomUUID(),
      pricing: randomUUID(),
      label: 'fixture',
    },
    routeBlockers: [],
  };
  const v = m.cardView(
    'start_discovery',
    { hint_text: 'rural clinic waits', _op: randomUUID() },
    data,
    ctx(),
  );
  assert.equal(v.current?.key, 'theme');
  assert.equal(v.current?.fallback, 'rural clinic waits');
  assert.ok(v.missing.includes('Theme'));
  assert.equal(v.steps.length, 0, 'nothing to send until answered');
});

test('a discovery card sends exactly the Discover form requests, bound to the claims it cites', async () => {
  const m = await cards();
  const claim = { id: randomUUID(), version: 2, title: 'Waits are long' };
  const data = {
    claims: [claim],
    route: {
      kind: 'api',
      envelope: randomUUID(),
      pricing: randomUUID(),
      label: 'fixture',
    },
    routeBlockers: [],
  };
  const { view, asked } = walk(m, 'start_discovery', data, {
    theme: 'rural clinic waits',
    target_users: 'Rural patients',
    measurable_problem: 'Median wait over 30 days',
    outcome_measure: 'Median wait',
    field_a: 'Clinic scheduling',
    field_b: 'Airline overbooking',
    claims: [claim.id],
    roles: ['problem'],
    context: '',
  });
  assert.ok(!asked.includes('oversight'), 'routine in Standard');
  assert.deepEqual(view.blockers, []);
  assert.deepEqual(view.subjects, [
    { kind: 'entity', id: claim.id, version: 2, label: 'Waits are long' },
  ]);
  const got = {
    brief: randomUUID(),
    brief_version: 1,
    run_record: randomUUID(),
    run: randomUUID(),
  };
  const [brief, run, oversee, grant, start] = view.steps.map((s) => ({
    ...s,
    path: m.fill(s.path, got) as string,
    body: m.fill(s.body, got),
  }));
  ok(CreateEntityRequestSchema, brief!.body, 'brief');
  ok(CreateEntityRequestSchema, run!.body, 'run record');
  ok(RegisterRunRequestSchema, oversee!.body, 'run');
  ok(CreateStandingGrantRequestSchema, grant!.body, 'grant');
  ok(StartDiscoveryRequestSchema, start!.body, 'discovery');
  assert.equal(start!.path, `workspaces/${ws}/runs/${got.run}/discoveries`);
  // A whole placeholder keeps the value's own type.
  assert.deepEqual((start!.body as { brief: unknown }).brief, {
    id: got.brief,
    version: 1,
  });
  // The grant is limited to model calls, a day, and the fixture data class.
  const g = grant!.body as {
    action_types: string[];
    expires_at: string;
    allow_irreversible: boolean;
  };
  assert.deepEqual(g.action_types, ['model.generate', 'model.summarize']);
  assert.equal(g.expires_at, '2026-11-12T12:00:00.000Z');
  assert.equal(g.allow_irreversible, false);

  // The same fields twice, or no route, are named before anything could be sent.
  const same = m.cardView(
    'start_discovery',
    { field_a: 'Scheduling', field_b: ' scheduling ' },
    data,
    ctx(),
  );
  assert.ok(same.blockers.includes('Name two different fields.'));
  const none = m.cardView(
    'start_discovery',
    {},
    { ...data, claims: [] },
    ctx(),
  );
  assert.match(none.blockers.join(' '), /No claim is recorded/);
});

test('an approval card answers one waiting decision with its coverage; a changed target is refused here too', async () => {
  const m = await cards();
  const d = {
    id: randomUUID(),
    version: 1,
    question: 'Allow fetching clinic.example?',
    reason: 'grant missing',
    covers: 'source fetch, public data',
    current: true,
    coverage_hash: 'a'.repeat(64),
    recommendation: null,
  };
  const opened = Date.parse('2026-11-11T11:58:00Z');
  const { view, asked } = walk(
    m,
    'answer_decision',
    { decisions: [d] },
    { decision: d.id, choice: 'approve_once', rationale: 'Public page.' },
    ctx(),
    { _op: randomUUID(), _opened: opened },
  );
  assert.deepEqual(asked, ['decision', 'choice', 'rationale']);
  assert.equal(view.steps.length, 1);
  ok(AnswerDecisionRequestSchema, view.steps[0]!.body, 'answer');
  assert.equal(
    view.steps[0]!.path,
    `workspaces/${ws}/decisions/${d.id}/answer`,
  );
  assert.equal(
    (view.steps[0]!.body as { time_spent_ms: number }).time_spent_ms,
    120_000,
  );
  assert.ok(view.subjects.some((s) => s.kind === 'decision' && s.id === d.id));
  const changed = m.cardView(
    'answer_decision',
    { decision: d.id, choice: 'approve_once', rationale: 'x' },
    { decisions: [{ ...d, current: false }] },
    ctx(),
  );
  assert.match(changed.blockers.join(' '), /a new request is needed/);
  const nothing = m.cardView('answer_decision', {}, { decisions: [] }, ctx());
  assert.deepEqual(nothing.blockers, ['Nothing is waiting for you.']);
});

test('filling and picking response fields, and the card for the next step', async () => {
  const m = await cards();
  assert.deepEqual(
    m.fill(
      { a: '{x}', b: 'runs/{x}/go', c: ['{y}'], d: '{missing}' },
      {
        x: 7,
        y: null,
      },
    ),
    { a: 7, b: 'runs/7/go', c: [null], d: '{missing}' },
  );
  assert.equal(m.pick({ workflow: { id: 'w' } }, 'workflow.id'), 'w');
  assert.equal(m.pick({ workflow: null }, 'workflow.id'), undefined);
  const f = { sources: 0, scorecards: 0 };
  assert.equal(m.cardForStep('evidence', f), 'fetch_source');
  assert.equal(m.cardForStep('evidence', { ...f, sources: 1 }), 'cite_claim');
  assert.equal(m.cardForStep('budgets', f), 'fund_budget');
  assert.equal(m.cardForStep('submit', f), 'start_discovery');
  assert.equal(m.cardForStep('compare', f), 'score_option');
  assert.equal(
    m.cardForStep('compare', { ...f, scorecards: 2 }),
    'record_choice',
  );
  assert.equal(m.cardForStep('decisions', f), 'answer_decision');
  // Freezing and building are done on their own tabs for now.
  assert.equal(m.cardForStep('scores', f), null);
  assert.equal(m.cardForStep('build', f), null);
});
