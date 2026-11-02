import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import {
  PricingSnapshotBodySchema,
  ReconcileRequestSchema,
} from '@creator/contracts';
import { usageCost } from '@creator/domain';

type Draft = Record<string, string>;
type Fields = {
  emptyCharge: () => Draft;
  chargeToBody: (
    d: Draft,
  ) =>
    | { body: any; errors: null }
    | { body: null; errors: Record<string, string> };
  chargePreview: (p: unknown, u: unknown) => string;
  samePricing: (a: unknown, b: unknown) => boolean;
  perMillion: (n: string) => string;
};

// pricing-fields.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<Fields> {
  const source = await readFile('apps/web/src/pricing-fields.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Fields;
  new Function('exports', code)(exports);
  return exports;
}
const json = async (f: string) => JSON.parse(await readFile(f, 'utf8'));

test('the app offers every documented standard price in config/pricing, each valid', async () => {
  const src = await readFile('apps/web/src/pricing-bundle.ts', 'utf8');
  const bundled = [
    ...src.matchAll(/from '\.\.\/\.\.\/\.\.\/config\/pricing\/([^']+)'/g),
  ].map((m) => m[1]!);
  const documented: string[] = [];
  for (const f of await readdir('config/pricing')) {
    const body = PricingSnapshotBodySchema.parse(
      await json(`config/pricing/${f}`),
    );
    // Batch prices are created by the context batch path itself, never added by hand.
    if (body.basis === 'documented' && !f.endsWith('-batch.json'))
      documented.push(f);
  }
  assert.ok(documented.length >= 1);
  assert.deepEqual(bundled.sort(), documented.sort());
});

test('a typed charge parses as a reconcile request; empty or bad counts are caught', async () => {
  const f = await load();
  const empty = f.chargeToBody(f.emptyCharge());
  assert.equal(empty.body, null);
  assert.deepEqual(Object.keys(empty.errors!).sort(), [
    'evidence',
    'output',
    'uncached_input',
  ]);

  const ok = f.chargeToBody({
    ...f.emptyCharge(),
    uncached_input: '1,200',
    output: '300',
    reasoning: '',
    response_id: '  resp_abc ',
    evidence: 'Usage export row 2026-11-02 10:14 UTC.',
  });
  assert.ok(ok.body);
  const req = ReconcileRequestSchema.parse(ok.body);
  assert.deepEqual(req, {
    outcome: 'charged',
    usage: {
      uncached_input_tokens: 1200,
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 300,
      reasoning_tokens: 0,
      tool_calls: {},
    },
    provider_response_id: 'resp_abc',
    evidence: 'Usage export row 2026-11-02 10:14 UTC.',
  });

  const bad = f.chargeToBody({
    ...f.emptyCharge(),
    uncached_input: '-5',
    output: '10',
    reasoning: '11',
    evidence: 'x',
  });
  assert.deepEqual(Object.keys(bad.errors ?? {}).sort(), [
    'reasoning',
    'uncached_input',
  ]);
  // All zero is not a charge: that is "Confirm no charge".
  const zero = f.chargeToBody({
    ...f.emptyCharge(),
    uncached_input: '0',
    output: '0',
    evidence: 'x',
  });
  assert.match(zero.errors?.output ?? '', /no charge/);
});

test('the charge preview matches the studio charge, including long context', async () => {
  const f = await load();
  const astra = PricingSnapshotBodySchema.parse(
    await json('config/pricing/openai-gpt-6-astra.json'),
  );
  const fixture = PricingSnapshotBodySchema.parse(
    await json('config/pricing/fixture-model-v1.json'),
  );
  const usages = [
    [1, 1, 0, 0, 0],
    [1200, 0, 0, 300, 50],
    [100_000, 50_000, 20_000, 9_999, 0],
    [272_001, 0, 0, 7, 0],
    [200_000, 60_000, 12_001, 33_333, 1],
  ].map(([u, c, w, o, r]) => ({
    uncached_input_tokens: u!,
    cached_input_tokens: c!,
    cache_write_tokens: w!,
    output_tokens: o!,
    reasoning_tokens: r!,
    tool_calls: {},
  }));
  for (const p of [astra, fixture])
    for (const u of usages)
      assert.equal(f.chargePreview(p, u), usageCost(p, u), JSON.stringify(u));
});

test('pricing identity and per-million display', async () => {
  const f = await load();
  const astra = await json('config/pricing/openai-gpt-6-astra.json');
  const batch = await json('config/pricing/openai-gpt-6-astra-batch.json');
  assert.ok(f.samePricing(astra, structuredClone(astra)));
  assert.ok(!f.samePricing(astra, batch));
  assert.ok(
    !f.samePricing(astra, { ...astra, retrieved_at: '2026-12-01T00:00:00Z' }),
  );
  assert.equal(f.perMillion(astra.rates.input), '$10.00');
  assert.equal(f.perMillion(astra.rates.cached_input), '$1.00');
  assert.equal(f.perMillion(astra.rates.cache_write), '$12.50');
  assert.equal(f.perMillion('3'), '$0.003');
  assert.equal(f.perMillion('250'), '$0.25');
  assert.equal(f.perMillion('12345'), '$12.345');
});
