import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PlanCapsSchema, type PlanCaps } from '@creator/contracts';

type Field = {
  key: string;
  group: 'responses' | 'codex' | 'shared';
  name: string;
  scale: number;
  min: number;
  max: number;
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
};

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
    assert.ok(ok(f.max * f.scale), `${f.key} max`);
    // One display unit outside the range is refused by the server's schema too.
    assert.ok(!ok((f.min - 1) * f.scale) || f.min === 0, `${f.key} below`);
    assert.ok(!ok(f.min * f.scale - 1), `${f.key} just below`);
    assert.ok(!ok(f.max * f.scale + 1), `${f.key} just above`);
  }
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
  for (const bad of ['51', '0', '2.5', '', '-3', '1e2', 'ten']) {
    const out = draftToCaps(
      CAPS,
      { ...draft, 'responses.max_requests_per_run': bad },
      'chatgpt_plan',
    );
    assert.equal(out.caps, null, bad);
    assert.match(
      out.errors!['responses.max_requests_per_run']!,
      /from 1 to 50 requests/,
    );
  }
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
