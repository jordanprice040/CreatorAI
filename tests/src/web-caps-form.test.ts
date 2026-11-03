import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  DataClassSchema,
  PlanSettingsSchema,
  PlanTaskClassSchema,
  PlanCapsSchema,
  planWaitMs,
  TIMER_MAX_MS,
  type PlanCaps,
} from '@creator/contracts';

type Field = {
  key: string;
  group: 'responses' | 'codex' | 'shared';
  name: string;
  scale: number;
  min: number;
  max: number | null;
};
type CapsFields = {
  CAP_FIELDS: readonly Field[];
  capFieldsFor: (kind: string) => Field[];
  capsToDraft: (caps: PlanCaps) => Record<string, string>;
  draftToCaps: (
    current: PlanCaps,
    draft: Record<string, string>,
    kind: string,
  ) =>
    | { caps: PlanCaps; errors: null }
    | { caps: null; errors: Record<string, string> };
  capChanges: (before: PlanCaps, after: PlanCaps, kind: string) => string[];
  DATA_CLASS_CHOICES: readonly Choice[];
  TASK_CLASS_CHOICES: readonly Choice[];
  taskChoicesFor: (kind: string) => Choice[];
  orderedClasses: (choices: readonly Choice[], ticked: string[]) => string[];
  classErrors: (
    data: string[],
    tasks: string[],
    kind: string,
  ) => Record<string, string>;
  classChanges: (
    before: { data: string[]; tasks: string[] },
    after: { data: string[]; tasks: string[] },
  ) => string[];
  classSummary: (data: string[], tasks: string[]) => string;
};
type Choice = { key: string; label: string; codexOnly: boolean };

// caps-fields.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<CapsFields> {
  const source = await readFile('apps/web/src/caps-fields.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as CapsFields;
  new Function('exports', code)(exports);
  return exports;
}

// The pilot's ChatGPT caps after the per-run cap was raised to 18 through the CLI.
const CAPS: PlanCaps = {
  responses: {
    max_requests_per_run: 18,
    request_timeout_ms: 120_000,
    max_output_chars: 40_000,
    max_input_chars: 60_000,
  },
  codex: {
    max_builds_per_day: 2,
    max_turns_per_build: 1,
    max_model_requests_per_build: 12,
    build_timeout_ms: 900_000,
  },
  shared: { max_model_requests_per_day: 40, max_in_flight: 1 },
};

const withValue = (caps: PlanCaps, f: Field, stored: number): PlanCaps => ({
  ...caps,
  [f.group]: { ...caps[f.group], [f.name]: stored },
});

test('every form range is exactly what PlanCapsSchema accepts', async () => {
  const { CAP_FIELDS } = await load();
  const shape = PlanCapsSchema.shape;
  const schemaKeys = Object.entries(shape).flatMap(([group, obj]) =>
    Object.keys(obj.shape)
      .filter((name) => name !== 'max_in_flight')
      .map((name) => `${group}.${name}`),
  );
  assert.deepEqual(CAP_FIELDS.map((f) => f.key).sort(), schemaKeys.sort());
  for (const f of CAP_FIELDS) {
    const ok = (n: number) =>
      PlanCapsSchema.safeParse(withValue(CAPS, f, n)).success;
    assert.ok(ok(f.min * f.scale), `${f.key} min`);
    // One display unit outside the range is refused by the server's schema too.
    assert.ok(!ok((f.min - 1) * f.scale) || f.min === 0, `${f.key} below`);
    assert.ok(!ok(f.min * f.scale - 1), `${f.key} just below`);
    if (f.max === null) {
      // ADR-0062: no upper limit; far above every old maximum is still accepted.
      assert.ok(ok(1_000_000_000 * f.scale), `${f.key} large`);
    } else {
      // Only the two timeouts keep a bound: the longest a JavaScript timer can wait.
      assert.match(f.key, /timeout_ms$/);
      assert.ok(ok(f.max * f.scale), `${f.key} max`);
      assert.ok(!ok(f.max * f.scale + 1), `${f.key} just above`);
      assert.ok(f.max * f.scale <= 2 ** 31 - 1, `${f.key} timer bound`);
      assert.ok(
        (f.max + 1) * f.scale > 2 ** 31 - 1,
        `${f.key} is the largest whole display unit`,
      );
    }
  }
  assert.deepEqual(
    CAP_FIELDS.filter((f) => f.max !== null)
      .map((f) => f.key)
      .sort(),
    ['codex.build_timeout_ms', 'responses.request_timeout_ms'],
  );
});

test('the draft round-trips and only changed fields are reported', async () => {
  const { capsToDraft, draftToCaps, capChanges } = await load();
  const draft = capsToDraft(CAPS);
  assert.equal(draft['responses.request_timeout_ms'], '120');
  assert.equal(draft['codex.build_timeout_ms'], '15');
  const same = draftToCaps(CAPS, draft, 'chatgpt_plan');
  assert.deepEqual(same.caps, CAPS);
  assert.deepEqual(capChanges(CAPS, CAPS, 'chatgpt_plan'), []);

  const raised = draftToCaps(
    CAPS,
    {
      ...draft,
      'responses.max_requests_per_run': '24',
      'shared.max_model_requests_per_day': '60',
    },
    'chatgpt_plan',
  );
  assert.ok(raised.caps);
  assert.equal(raised.caps.responses.max_requests_per_run, 24);
  assert.equal(raised.caps.shared.max_model_requests_per_day, 60);
  assert.ok(PlanCapsSchema.safeParse(raised.caps).success);
  assert.deepEqual(capChanges(CAPS, raised.caps, 'chatgpt_plan'), [
    'Model requests a day: 40 → 60 requests',
    'Requests per run: 18 → 24 requests',
  ]);
  // The current caps object is never mutated.
  assert.equal(CAPS.responses.max_requests_per_run, 18);
});

test('out-of-range, fractional and empty entries are refused before sending', async () => {
  const { capsToDraft, draftToCaps } = await load();
  const draft = capsToDraft(CAPS);
  for (const bad of ['0', '2.5', '', '-3', '1e2', 'ten', '9007199254740993']) {
    const out = draftToCaps(
      CAPS,
      { ...draft, 'responses.max_requests_per_run': bad },
      'chatgpt_plan',
    );
    assert.equal(out.caps, null, bad);
    assert.match(
      out.errors!['responses.max_requests_per_run']!,
      /of 1 or more requests/,
    );
  }
  // ADR-0062: no maximum. Jordan's example: more Codex builds and requests a day than the
  // old 20 and 300, for a bigger plan or an API budget.
  const high = draftToCaps(
    CAPS,
    {
      ...draft,
      'codex.max_builds_per_day': '500',
      'shared.max_model_requests_per_day': '25,000',
      'responses.max_requests_per_run': '1000',
      'codex.max_turns_per_build': '12',
      'responses.max_output_chars': '2,000,000',
    },
    'chatgpt_plan',
  );
  assert.equal(high.errors, null);
  assert.equal(high.caps!.codex.max_builds_per_day, 500);
  assert.equal(high.caps!.shared.max_model_requests_per_day, 25_000);
  assert.ok(PlanCapsSchema.safeParse(high.caps).success);
  // The timeouts keep the timer bound: 35,791 minutes is the most, 35,792 is refused.
  const longest = draftToCaps(
    CAPS,
    { ...draft, 'codex.build_timeout_ms': '35,791' },
    'chatgpt_plan',
  );
  assert.ok(PlanCapsSchema.safeParse(longest.caps).success);
  const tooLong = draftToCaps(
    CAPS,
    { ...draft, 'codex.build_timeout_ms': '35792' },
    'chatgpt_plan',
  );
  assert.match(
    tooLong.errors!['codex.build_timeout_ms']!,
    /from 1 to 35,791 minutes/,
  );
  // Thousands separators are accepted for character counts.
  const big = draftToCaps(
    CAPS,
    { ...draft, 'responses.max_input_chars': '200,000' },
    'chatgpt_plan',
  );
  assert.equal(big.caps?.responses.max_input_chars, 200_000);
});

test('Claude Code connections never see or change Codex caps', async () => {
  const { capFieldsFor, capsToDraft, draftToCaps } = await load();
  const claude: PlanCaps = {
    ...CAPS,
    codex: { ...CAPS.codex, max_builds_per_day: 0 },
  };
  assert.ok(capFieldsFor('claude_code').every((f) => f.group !== 'codex'));
  assert.equal(capFieldsFor('chatgpt_plan').length, 9);
  // Even a tampered draft value for a hidden field is ignored: the server requires 0 builds.
  const out = draftToCaps(
    claude,
    { ...capsToDraft(claude), 'codex.max_builds_per_day': '5' },
    'claude_code',
  );
  assert.equal(out.caps?.codex.max_builds_per_day, 0);
});

type SiteList = {
  parseSiteList: (text: string) => { hosts: string[]; invalid: string[] };
  siteChanges: (
    before: { mode: string; hosts: readonly string[] },
    after: { mode: string; hosts: readonly string[] },
  ) => string[];
};
async function siteList(): Promise<SiteList> {
  const source = await readFile('apps/web/src/site-list.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as SiteList;
  new Function('exports', code)(exports);
  return exports;
}

test('the evidence websites box keeps host names only and flags IPs, ports and sign-ins', async () => {
  const { parseSiteList, siteChanges } = await siteList();
  const out = parseSiteList(
    'https://www.speedrun.com/games/x?y=1\n*.NIH.gov, tasvideos.org/\n\nwww.speedrun.com\n192.168.1.1 https://a.org:8443/ https://me@b.org/ localhost',
  );
  assert.deepEqual(out.hosts, [
    'www.speedrun.com',
    '*.nih.gov',
    'tasvideos.org',
  ]);
  assert.deepEqual(out.invalid, [
    '192.168.1.1',
    'https://a.org:8443/',
    'https://me@b.org/',
    'localhost',
  ]);
  // Every accepted entry also passes the server's schema.
  const { EvidenceSiteHostSchema } = await import('@creator/contracts');
  for (const h of out.hosts)
    assert.ok(EvidenceSiteHostSchema.safeParse(h).success, h);
  assert.deepEqual(
    siteChanges(
      { mode: 'listed', hosts: ['a.org', 'b.org'] },
      { mode: 'any_public', hosts: ['b.org', 'c.org'] },
    ),
    ['Turn on "Any public website"', 'Add c.org', 'Remove a.org'],
  );
  assert.deepEqual(
    siteChanges(
      { mode: 'listed', hosts: ['a.org'] },
      { mode: 'listed', hosts: ['a.org'] },
    ),
    [],
  );
});

test('allowed-work choices are exactly the classes plan settings accept', async () => {
  // Full audit 2026-11-02: data and task classes can now be changed in the app.
  const m = await load();
  assert.deepEqual(
    m.DATA_CLASS_CHOICES.map((x) => x.key),
    [...DataClassSchema.options],
  );
  assert.deepEqual(
    m.TASK_CLASS_CHOICES.map((x) => x.key).sort(),
    [...PlanTaskClassSchema.options].sort(),
  );
  // Claude Code has no Codex path; ChatGPT plans can take every class.
  assert.ok(
    !m.taskChoicesFor('claude_code').some((x) => x.key === 'code_build'),
  );
  assert.equal(
    m.taskChoicesFor('chatgpt_plan').length,
    m.TASK_CLASS_CHOICES.length,
  );
  // Ticked order does not matter, and a class the kind can't take is dropped.
  assert.deepEqual(
    m.orderedClasses(m.taskChoicesFor('claude_code'), [
      'code_build',
      'summarization',
      'scoring',
    ]),
    ['scoring', 'summarization'],
  );
  // What is saved parses as plan settings.
  const settings = {
    format: 'chatgpt-plan-settings/1',
    plan_type: 'plus',
    shared_allowance_note: 'Shared with personal use.',
    allowed_data_classes: m.orderedClasses(m.DATA_CLASS_CHOICES, [
      'private_approved',
      'synthetic',
    ]),
    allowed_task_classes: m.orderedClasses(m.TASK_CLASS_CHOICES, [
      'patch_build',
      'specification',
    ]),
    caps: CAPS,
  };
  assert.equal(PlanSettingsSchema.safeParse(settings).success, true);
});

test('allowed work needs at least one class each, and changes are said in words', async () => {
  const m = await load();
  assert.deepEqual(m.classErrors(['public'], ['scoring'], 'chatgpt_plan'), {});
  assert.deepEqual(
    Object.keys(m.classErrors([], ['code_build'], 'claude_code')).sort(),
    ['data', 'tasks'],
  );
  assert.deepEqual(
    m.classChanges(
      { data: ['synthetic', 'public'], tasks: ['summarization'] },
      { data: ['synthetic', 'private_approved'], tasks: ['summarization'] },
    ),
    ['No longer allows public data', 'Allows approved private data'],
  );
  assert.deepEqual(
    m.classChanges(
      { data: ['public'], tasks: ['summarization', 'scoring'] },
      { data: ['public'], tasks: ['scoring', 'summarization'] },
    ),
    [],
  );
  assert.equal(
    m.classSummary(['synthetic', 'public'], ['specification']),
    'Synthetic (made-up) data, Public data · tasks: Specification writing',
  );
});

test('client waits follow the connection timeout, per call, under the timer bound', () => {
  // PR #123 re-review M-1 and L-1: no wait sized for the old 300 s / 30-minute maxima.
  assert.equal(planWaitMs(120_000), 180_000);
  assert.equal(
    planWaitMs(60 * 60_000, 1, 120_000),
    62 * 60_000,
    'one-hour build',
  );
  assert.equal(
    planWaitMs(15 * 60_000, 6),
    91 * 60_000,
    '6 cases at 15 minutes',
  );
  assert.equal(planWaitMs(120_000, 0), 180_000, 'at least one call');
  assert.equal(planWaitMs(2_147_460_000, 1, 120_000), TIMER_MAX_MS);
  assert.equal(planWaitMs(2_000_000_000, 8), TIMER_MAX_MS);
});
