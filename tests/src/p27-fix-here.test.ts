import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  PlanAdmissionRequestSchema,
  PlanRefusalSchema,
  type PlanConnection,
  type PlanRefusal,
} from '@creator/contracts';
import {
  admissionBlockers,
  admissionRefusals,
  connectionBlockers,
  connectionRefusals,
} from '@creator/domain';
import { loadWeb } from './web-module.js';

// ADR-0087 (P27): plan refusals carry a stable code beside their words, and the app picks the
// fix it offers in place from that code (or from what the page already knows), never from the
// wording. Pure checks; the store's refusal is checked in subscription-workflow.test.ts.

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];

const connection = (over: Partial<PlanConnection> = {}) =>
  ({
    id: randomUUID(),
    kind: 'chatgpt_plan',
    settings: {
      ...SETTINGS,
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['summarization'],
    },
    sign_in: { state: 'signed_in', plan_usage_granted: true },
    credits: { state: 'confirmed_off' },
    caps_accepted_at: null,
    eligibility: { state: 'unknown' },
    quota: { state: 'unknown' },
    ...over,
  }) as unknown as PlanConnection;

const USAGE = {
  last_24h_requests: 0,
  last_24h_codex_builds: 0,
  run_requests: 0,
  build_requests: 0,
  in_flight: 0,
  unresolved: 0,
};

const taskRequest = (c: PlanConnection, over: Record<string, unknown> = {}) =>
  PlanAdmissionRequestSchema.parse({
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'task',
    model_id: 'm1',
    task_class: 'scoring',
    data_class: 'private_approved',
    run_id: null,
    build_id: null,
    grant_id: null,
    qualification_id: null,
    input_chars: 10,
    ...over,
  });

test('plan refusals carry codes and the facts their fix needs; the words are unchanged', () => {
  const c = connection();
  const conn = connectionRefusals(c);
  assert.deepEqual(
    conn.map((r) => [r.code, r.connection_id]),
    [['caps_not_accepted', c.id]],
  );
  assert.deepEqual(
    conn.map((r) => r.text),
    connectionBlockers(c),
  );
  const input = {
    connection: c,
    request: taskRequest(c),
    access: [
      {
        connection_id: c.id,
        model_id: 'm1',
        path: 'responses',
        access: 'verified',
      },
    ] as never,
    qualifications: [],
    grant: null,
    usage: USAGE,
    now: new Date(),
  };
  const refusals = admissionRefusals(input);
  // Same sentences, same order, as before: callers that read the words see no change.
  assert.deepEqual(
    refusals.map((r) => r.text),
    admissionBlockers(input),
  );
  const by = (code: string) => refusals.filter((r) => r.code === code);
  assert.equal(by('caps_not_accepted').length, 1);
  assert.deepEqual(
    by('data_class_not_allowed').map((r) => r.data_class),
    ['private_approved'],
  );
  assert.deepEqual(
    by('task_class_not_allowed').map((r) => [r.task_class, r.model_id]),
    [['scoring', 'm1']],
  );
  assert.deepEqual(
    by('not_qualified').map((r) => [r.task_class, r.model_id]),
    [['scoring', 'm1']],
  );
  // Every refusal names its connection and matches the contract the API sends.
  for (const r of refusals) {
    assert.equal(r.connection_id, c.id);
    assert.ok(PlanRefusalSchema.safeParse(r).success, JSON.stringify(r));
  }
  // An unverified model is coded as such; a full daily cap as a cap.
  const capped = admissionRefusals({
    ...input,
    access: [],
    usage: {
      ...USAGE,
      last_24h_requests: c.settings.caps.shared.max_model_requests_per_day,
    },
  });
  assert.ok(capped.some((r) => r.code === 'not_verified'));
  assert.ok(capped.some((r) => r.code === 'cap_reached'));
});

test('a ContractError keeps reasons beside its details', () => {
  const r: PlanRefusal = {
    code: 'caps_not_accepted',
    text: 'x',
    connection_id: randomUUID(),
  };
  const e = new ContractError('ACCESS_DENIED', 'Not ready.', ['x'], [r]);
  assert.deepEqual(e.reasons, [r]);
  assert.deepEqual(new ContractError('ACCESS_DENIED', 'No.').reasons, []);
});

type FixAction = Record<string, unknown> & { kind: string };
type FixHere = {
  refusalFixes(
    r: readonly PlanRefusal[],
    role: string,
    canQualify: (t: string) => boolean,
  ): FixAction[];
  missingTaskFixes(
    connection: string,
    model: string,
    missing: readonly string[],
    allowed: readonly string[],
    role: string,
    canQualify: (t: string) => boolean,
  ): FixAction[];
  fixLabel(a: FixAction): string;
};
type Defaults = {
  discoverSetupBlockers(input: Record<string, unknown>): {
    text: string;
    acts?: FixAction[];
  }[];
};

test('fixes come from the refusal codes: one allow-and-qualify per task, qualify only where the role has a benchmark', async () => {
  const m = (await loadWeb('fix-here.ts')) as FixHere;
  const c = randomUUID();
  const refusals: PlanRefusal[] = [
    { code: 'caps_not_accepted', text: 'a', connection_id: c },
    { code: 'caps_not_accepted', text: 'a again', connection_id: c },
    {
      code: 'data_class_not_allowed',
      text: 'b',
      connection_id: c,
      data_class: 'private_approved',
    },
    {
      code: 'task_class_not_allowed',
      text: 'c',
      connection_id: c,
      task_class: 'scoring',
      model_id: 'm1',
    },
    {
      code: 'not_qualified',
      text: 'd',
      connection_id: c,
      task_class: 'scoring',
      model_id: 'm1',
    },
    {
      code: 'not_qualified',
      text: 'e',
      connection_id: c,
      task_class: 'summarization',
      model_id: 'm1',
    },
    {
      code: 'not_qualified',
      text: 'f',
      connection_id: c,
      task_class: 'research_synthesis',
      model_id: 'm1',
    },
    // No connection named, or a refusal with no owner fix: nothing offered.
    { code: 'not_qualified', text: 'g', task_class: 'scoring', model_id: 'm1' },
    { code: 'sign_in', text: 'h', connection_id: c },
  ];
  const can = (t: string) => ['scoring', 'summarization'].includes(t);
  const fixes = m.refusalFixes(refusals, 'plan', can);
  assert.deepEqual(
    fixes.map((f) => [f.kind, m.fixLabel(f)]),
    [
      ['accept_caps', 'Review and accept caps'],
      ['allow_data', 'Allow approved private data on this connection'],
      ['allow_tasks', 'Allow and qualify'],
      ['qualify', 'Qualify now'],
    ],
  );
  assert.deepEqual(fixes[2]!.qualify, ['scoring']);
  assert.equal(fixes[3]!.task_class, 'summarization');
  assert.equal(fixes[3]!.role, 'plan');
  // Without a benchmark for the role, a not-allowed task is only allowed.
  const none = m.refusalFixes(refusals, 'discovery', () => false);
  assert.deepEqual(
    none.map((f) => m.fixLabel(f)),
    [
      'Review and accept caps',
      'Allow approved private data on this connection',
      'Allow this task',
    ],
  );
  // From what the page knows: allow the tasks not allowed, qualify the allowed ones.
  const missing = m.missingTaskFixes(
    c,
    'm1',
    ['research_synthesis', 'candidate_generation', 'scoring'],
    ['scoring'],
    'plan',
    can,
  );
  assert.deepEqual(
    missing.map((f) => [f.kind, m.fixLabel(f)]),
    [
      ['allow_tasks', 'Allow these tasks'],
      ['qualify', 'Qualify now'],
    ],
  );
  // No model yet: allow only.
  assert.deepEqual(
    m.missingTaskFixes(c, '', ['scoring'], [], 'plan', can).map(m.fixLabel),
    ['Allow this task'],
  );
});

test("Discover's setup blockers attach fixes by code and by what is missing, not by wording", async () => {
  const m = (await loadWeb('discover-defaults.ts')) as Defaults;
  const id = randomUUID();
  const base = {
    route: 'subscription',
    connectionError: '',
    dataClass: 'private_approved',
    model: 'm1',
    unqualified: ['research_synthesis', 'scoring'],
    envelopes: 0,
    usableEnvelopes: 0,
    pricing: 0,
    fixture: false,
    canQualify: (t: string) => t === 'scoring',
  };
  const out = m.discoverSetupBlockers({
    ...base,
    plan: {
      id,
      // Reworded on purpose: the fix still follows the code.
      blockers: ['Caps are waiting for you.', 'Sign in again.'],
      refusals: [
        { code: 'caps_not_accepted', text: 'Caps are waiting for you.' },
        { code: 'sign_in', text: 'Sign in again.' },
      ],
      allowedDataClasses: ['public'],
      allowedTaskClasses: ['scoring'],
    },
  });
  assert.deepEqual(
    out.map((b) => (b.acts ?? []).map((a) => a.kind)),
    [['accept_caps'], [], ['allow_data'], ['allow_tasks'], ['qualify']],
  );
  assert.equal(out[2]!.acts![0]!.data_class, 'private_approved');
  assert.deepEqual(out[3]!.acts![0]!.tasks, ['research_synthesis']);
  assert.equal(out[4]!.acts![0]!.task_class, 'scoring');
  // Without the connection id there is nothing to fix in place.
  const bare = m.discoverSetupBlockers({
    ...base,
    plan: {
      blockers: [],
      allowedDataClasses: ['public'],
      allowedTaskClasses: ['scoring'],
    },
  });
  assert.ok(bare.every((b) => !b.acts));
});

// fix-buttons.tsx with its siblings transpiled the way the web app builds them; React and the
// bundled benchmark files load from the web app's own folder. A sibling with no stub here is
// loaded from its .ts or .tsx source, so a new import (such as P34's qualification-role) needs no
// edit (P34 re-review M-A).
async function loadButtons() {
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const ts = (await import('typescript')).default;
  const web = createRequire(
    new URL('../../apps/web/src/fix-buttons.tsx', import.meta.url),
  );
  const compile = async (
    file: string,
    stubs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const code = ts.transpileModule(
      await readFile(`apps/web/src/${file}`, 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const siblings = new Map<string, unknown>();
    for (const m of code.matchAll(/require\("\.\/([^"]+)\.js"\)/g)) {
      const name = `./${m[1]}.js`;
      if (name in stubs) continue;
      if (existsSync(`apps/web/src/${m[1]}.ts`))
        siblings.set(name, await loadWeb(`${m[1]}.ts`));
      // A .tsx sibling is compiled the same way, with no stubs (third review N-3).
      else if (existsSync(`apps/web/src/${m[1]}.tsx`))
        siblings.set(name, await compile(`${m[1]}.tsx`, {}));
    }
    const exports = {} as Record<string, unknown>;
    new Function('require', 'exports', code)(
      (n: string) =>
        n in stubs ? stubs[n] : siblings.has(n) ? siblings.get(n) : web(n),
      exports,
    );
    return exports;
  };
  const words = (s: string) => s.replaceAll('_', ' ');
  // What `GET plan-benchmarks` answers (P34 #175); none until a test sets it.
  const offers: { served: { benchmarks: unknown[] } | null } = {
    served: null,
  };
  const oversight = {
    words,
    api: async (_s: unknown, path: string) => {
      if (!path.endsWith('/plan-benchmarks')) return {};
      if (!offers.served) throw new Error('404');
      return offers.served;
    },
    message: String,
  };
  const caps = await loadWeb('caps-fields.ts');
  const fixHere = await loadWeb('fix-here.ts');
  const qualify = await compile('qualify.tsx', {
    './oversight.js': oversight,
    './allow-tasks.js': { AllowTasks: () => null },
  });
  const mod = await compile('fix-buttons.tsx', {
    './oversight.js': oversight,
    './qualify.js': qualify,
    './caps-fields.js': caps,
    './fix-here.js': fixHere,
    './allow-tasks.js': { allowSequence: async () => true },
  });
  return {
    offers,
    mod: mod as {
      canQualifyFor(role: string): (t: string) => boolean;
      confirmText(a: FixAction, d: unknown): string;
      FixButtons(p: unknown): unknown;
    },
    react: web('react') as {
      createElement: (t: unknown, p: unknown) => unknown;
    },
    server: web('react-dom/server') as {
      renderToStaticMarkup: (e: unknown) => string;
    },
  };
}

test('each route qualifies only on its own benchmark; the confirmation says what the press does', async () => {
  const { mod, react, server } = await loadButtons();
  // Discovery and Explore for me count only discovery benchmarks (none bundled yet, P34), so a
  // scoring qualification on the assessment benchmark is never offered there.
  assert.equal(mod.canQualifyFor('discovery')('scoring'), false);
  assert.equal(mod.canQualifyFor('discovery')('research_synthesis'), false);
  assert.equal(mod.canQualifyFor('assessment')('scoring'), true);
  assert.equal(mod.canQualifyFor('plan')('specification'), true);
  assert.equal(mod.canQualifyFor('plan')('patch_build'), true);
  assert.equal(mod.canQualifyFor('plan')('scoring'), false);
  // P12's web-discovery benchmark (research synthesis) qualifies no fix's route (third review N-1).
  assert.equal(mod.canQualifyFor('plan')('research_synthesis'), false);

  const c = connection({
    settings: {
      ...SETTINGS,
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['scoring'],
    },
  } as Partial<PlanConnection>);
  const detail = (over: Partial<PlanConnection> = {}) => ({
    connection: { ...c, ...over },
    model_access: [
      {
        connection_id: c.id,
        model_id: 'm1',
        path: 'responses',
        access: 'verified',
      },
    ],
    qualifications: [],
  });
  const caps = mod.confirmText(
    { kind: 'accept_caps', connection_id: c.id },
    detail(),
  );
  assert.match(caps, /^Caps: \d+ requests a day · \d+ per run/);
  assert.match(caps, /Allowed: Synthetic \(made-up\) data, Public data/);
  assert.match(
    mod.confirmText(
      {
        kind: 'allow_data',
        connection_id: c.id,
        data_class: 'private_approved',
      },
      detail(),
    ),
    /^Will change: Allows approved private data\. The caps are still not accepted/,
  );
  const accepted = { caps_accepted_at: '2026-11-11T10:00:00.000Z' };
  assert.match(
    mod.confirmText(
      {
        kind: 'qualify',
        connection_id: c.id,
        model_id: 'm1',
        task_class: 'scoring',
        role: 'assessment',
      },
      detail(accepted),
    ),
    /^Qualifying m1 for scoring runs assessment-synthetic-v1: up to \d+ plan requests, .* Pass bar: all \d+ held-out cases\.$/,
  );
  assert.match(
    mod.confirmText(
      {
        kind: 'qualify',
        connection_id: c.id,
        model_id: 'm1',
        task_class: 'scoring',
        role: 'assessment',
      },
      detail(),
    ),
    /not accepted yet; accept them first/,
  );
  // A benchmark no longer offered says so, rather than an empty panel (fourth review L-1).
  assert.equal(
    mod.confirmText(
      {
        kind: 'qualify',
        connection_id: c.id,
        model_id: 'm1',
        task_class: 'scoring',
        role: 'discovery',
      },
      detail(accepted),
    ),
    'The app no longer offers a benchmark for scoring; reload the page.',
  );
  // Only the owner sees a fix; the buttons are drawn from the actions, not from any text.
  const acts = [{ kind: 'accept_caps', connection_id: c.id }];
  const fix = { base: 'workspaces/w', csrf: 't', owner: false };
  assert.equal(
    server.renderToStaticMarkup(
      react.createElement(mod.FixButtons, { acts, fix }),
    ),
    '',
  );
  assert.match(
    server.renderToStaticMarkup(
      react.createElement(mod.FixButtons, {
        acts,
        fix: { ...fix, owner: true },
      }),
    ),
    />Review and accept caps</,
  );
});

test('review M-2: the app hashes a bundled benchmark as the server does, and a started run of another benchmark blocks the press', async () => {
  const { canonicalHash } = await import('@creator/domain');
  const { BenchmarkManifestSchema } = await import('@creator/contracts');
  const m = (await loadWeb('fix-here.ts')) as {
    manifestHash(x: unknown): Promise<string>;
    startedFor(
      q: readonly unknown[],
      model: string,
      task: string,
      hash: string,
    ): { kind: string; id?: string };
  };
  const dir = new URL('../../config/connections/benchmarks/', import.meta.url);
  for (const f of [
    'assessment-synthetic-v1.json',
    'specification-synthetic-v1.json',
    't12-reviewer-v2.json',
  ]) {
    const manifest = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    // The server records canonicalHash of the parsed manifest (startPlanQualification).
    assert.equal(
      await m.manifestHash(manifest),
      canonicalHash(BenchmarkManifestSchema.parse(manifest)),
      f,
    );
  }
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const row = (over: Record<string, unknown>) => ({
    id: randomUUID(),
    state: 'running',
    model_id: 'm1',
    task_class: 'scoring',
    manifest_hash: a,
    ...over,
  });
  const same = row({});
  assert.deepEqual(m.startedFor([same], 'm1', 'scoring', a), {
    kind: 'same',
    id: same.id,
    hash: a,
  });
  assert.equal(m.startedFor([same], 'm1', 'scoring', b).kind, 'other');
  // Decided runs, other models and other tasks are not started runs of this one.
  assert.equal(
    m.startedFor(
      [
        row({ state: 'failed', manifest_hash: b }),
        row({ model_id: 'm2', manifest_hash: b }),
        row({ task_class: 'summarization', manifest_hash: b }),
      ],
      'm1',
      'scoring',
      a,
    ).kind,
    'none',
  );
});

test('review N-2, N-3: an unverified model still gets the allow; a fixture connection is never offered a qualification', async () => {
  const { mod } = (await loadButtons()) as unknown as {
    mod: {
      routeFixes(input: Record<string, unknown>): FixAction[];
      qualifierFor(role: string, c: unknown): (t: string) => boolean;
      confirmText(a: FixAction, d: unknown): string;
    };
  };
  const c = connection({
    settings: {
      ...SETTINGS,
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['summarization'],
    },
  } as Partial<PlanConnection>);
  const route = (over: Partial<PlanConnection>, model: string) =>
    mod.routeFixes({
      plan: { connection: { ...c, ...over }, refusals: [] },
      dataClass: 'public',
      model,
      missing: ['scoring', 'summarization'],
      role: 'assessment',
    });
  // A real connection with a verified model: allow and qualify scoring.
  assert.deepEqual(
    route({ fixture: false } as Partial<PlanConnection>, 'm1').map((a) => [
      a.kind,
      a.kind === 'allow_tasks' ? a.qualify : [],
    ]),
    [['allow_tasks', ['scoring']]],
  );
  // No verified model: the task is still allowed here, nothing is qualified.
  assert.deepEqual(
    route({ fixture: false } as Partial<PlanConnection>, '').map((a) => [
      a.kind,
      a.kind === 'allow_tasks' ? [a.model_id, a.qualify] : [],
    ]),
    [['allow_tasks', [null, []]]],
  );
  // A fixture connection: allow only, never qualify.
  assert.deepEqual(
    route({ fixture: true } as Partial<PlanConnection>, 'm1').map((a) => [
      a.kind,
      a.kind === 'allow_tasks' ? a.qualify : [],
    ]),
    [['allow_tasks', []]],
  );
  assert.equal(
    mod.qualifierFor('plan', { fixture: true })('specification'),
    false,
  );
  assert.equal(
    mod.qualifierFor('plan', { fixture: false })('specification'),
    true,
  );
  const verified = [
    {
      connection_id: c.id,
      model_id: 'm1',
      path: 'responses',
      access: 'verified',
    },
  ];
  const accepted = '2026-11-11T10:00:00.000Z';
  assert.equal(
    mod.confirmText(
      {
        kind: 'qualify',
        connection_id: c.id,
        model_id: 'm1',
        task_class: 'summarization',
        role: 'plan',
      },
      {
        connection: { ...c, fixture: true, caps_accepted_at: accepted },
        model_access: verified,
        qualifications: [],
      },
    ),
    'A fixture connection is not qualified in the app.',
  );
  // Several tasks: the confirmation says they stop at the first that does not pass (L-2).
  assert.match(
    mod.confirmText(
      {
        kind: 'allow_tasks',
        connection_id: c.id,
        model_id: 'm1',
        tasks: ['specification', 'patch_build'],
        qualify: ['specification', 'patch_build'],
        role: 'plan',
      },
      {
        connection: { ...c, fixture: false, caps_accepted_at: accepted },
        model_access: verified,
        qualifications: [],
      },
    ),
    /stopping at the first that does not pass/,
  );
});

test('P34 re-review L-A: an assessment Qualify now never runs a started scoring qualification of another role', async () => {
  const m = (await loadWeb('fix-here.ts')) as {
    manifestHash(x: unknown): Promise<string>;
    startedFor(
      q: readonly unknown[],
      model: string,
      task: string,
      hash: string,
    ): { kind: string };
  };
  const dir = new URL('../../config/connections/benchmarks/', import.meta.url);
  const assessment = await m.manifestHash(
    JSON.parse(
      readFileSync(new URL('assessment-synthetic-v1.json', dir), 'utf8'),
    ),
  );
  // A started discovery scoring run (the skeptic benchmark) has its own manifest hash; a
  // stand-in hash is enough, since the role is read from the benchmark the hash names.
  const discovery = 'd'.repeat(64);
  const running = (hash: string) => [
    {
      id: randomUUID(),
      state: 'running',
      model_id: 'gpt-6-astra',
      task_class: 'scoring',
      manifest_hash: hash,
    },
  ];
  assert.equal(
    m.startedFor(running(discovery), 'gpt-6-astra', 'scoring', assessment).kind,
    'other',
  );
  assert.equal(
    m.startedFor(running(assessment), 'gpt-6-astra', 'scoring', assessment)
      .kind,
    'same',
  );
});

test('P34 handover: discovery fixes qualify on the benchmarks the server offers, started by name', async () => {
  const { mod, offers } = (await loadButtons()) as unknown as {
    offers: { served: { benchmarks: unknown[] } | null };
    mod: {
      loadOffers(base: string, fresh?: boolean): Promise<void>;
      canQualifyFor(role: string): (t: string) => boolean;
      benchmarkFor(
        t: string,
        role: string,
      ):
        | {
            name: string;
            hash(): Promise<string>;
            start(v: number, m: string): unknown;
          }
        | undefined;
      roleOf(m: unknown): string | null;
    };
  };
  // A studio without the route (main before #175) offers no discovery benchmark, and a
  // failed first read is not kept: the next page's read tries again (fifth review L-1).
  await mod.loadOffers('workspaces/w');
  assert.equal(mod.canQualifyFor('discovery')('candidate_generation'), false);
  const hash = 'c'.repeat(64);
  offers.served = {
    benchmarks: [
      {
        name: 'plan-discovery-semantics-v2-candidate_generation',
        task_class: 'candidate_generation',
        manifest_hash: hash,
        data_class: 'synthetic',
        development: 2,
        held_out: 4,
      },
      {
        name: 'plan-discovery-semantics-v2-scoring',
        task_class: 'scoring',
        manifest_hash: 'e'.repeat(64),
        data_class: 'synthetic',
        development: 2,
        held_out: 4,
      },
    ],
  };
  await mod.loadOffers('workspaces/w');
  assert.equal(mod.canQualifyFor('discovery')('candidate_generation'), true);
  const b = mod.benchmarkFor('candidate_generation', 'discovery')!;
  assert.equal(await b.hash(), hash);
  assert.deepEqual(b.start(7, 'gpt-6-astra'), {
    expected_version: 7,
    model_id: 'gpt-6-astra',
    benchmark: 'plan-discovery-semantics-v2-candidate_generation',
  });
  // A failed re-read keeps the list read before (fourth review L-1).
  const kept = offers.served;
  offers.served = null;
  await mod.loadOffers('workspaces/w', true);
  assert.equal(mod.canQualifyFor('discovery')('candidate_generation'), true);
  offers.served = kept;
  // Scoring keeps one benchmark per route: discovery's skeptic and the bundled assessment one.
  assert.equal(
    mod.benchmarkFor('scoring', 'discovery')!.name,
    'plan-discovery-semantics-v2-scoring',
  );
  assert.equal(
    mod.benchmarkFor('scoring', 'assessment')!.name,
    'assessment-synthetic-v1',
  );
  // The role of a bundled benchmark is read from every case, as P34's manifestRole does.
  const kinds = (...k: string[]) => ({
    cases: k.map((kind) => ({ check: { kind } })),
  });
  assert.equal(mod.roleOf(kinds('assessment_contract')), 'assessment');
  assert.equal(
    mod.roleOf(kinds('discovery_contract', 'discovery_contract')),
    'discovery',
  );
  assert.equal(
    mod.roleOf(kinds('web_scout_contract', 'web_reader_contract')),
    null,
  );
  assert.equal(mod.roleOf(kinds('exact_label')), 'plan');
  assert.equal(mod.roleOf(kinds('web_scout_contract', 'exact_label')), 'plan');
  // P12's bundled web-discovery benchmark is never a fix's research synthesis benchmark.
  assert.equal(mod.benchmarkFor('research_synthesis', 'plan'), undefined);
});
