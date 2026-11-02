import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { HumilityBodySchema } from '@creator/contracts';
import { fixtureHumilityReview, humilityGate } from '@creator/domain';

type Draft = Record<string, any>;
type Fields = {
  OPTION_KEYS: readonly string[];
  emptyHumilityDraft: (p?: Record<string, string>) => Draft;
  draftFromBody: (b: unknown) => Draft;
  draftToBody: (
    d: Draft,
    subject: { id: string; version: number },
  ) =>
    | { body: any; errors: null }
    | { body: null; errors: Record<string, string> };
  gatePreview: (b: unknown) => string[];
};

// humility-fields.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<Fields> {
  const source = await readFile('apps/web/src/humility-fields.ts', 'utf8');
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

const subject = { id: '0b5e7a52-3c8e-4a9b-9a51-1f3d7c2e9a10', version: 3 };
const claim = { id: '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', version: 2 };

test('an earlier review round-trips, moved to the new subject version', async () => {
  const f = await load();
  const before = fixtureHumilityReview({ id: subject.id, version: 1 }, [claim]);
  const out = f.draftToBody(f.draftFromBody(before), subject);
  assert.equal(out.errors, null, JSON.stringify(out.errors));
  assert.deepEqual(out.body, { ...before, subject });
  assert.ok(HumilityBodySchema.safeParse(out.body).success);
});

test('nothing is pre-picked: viability, ethics and the recommendation are all asked for', async () => {
  const f = await load();
  const d = f.emptyHumilityDraft({ whose_perspective: 'Clinic staff' });
  assert.equal(d.whose_perspective, 'Clinic staff');
  const out = f.draftToBody(d, subject);
  assert.equal(out.body, null);
  for (const k of f.OPTION_KEYS)
    assert.ok(out.errors![`comparisons.${k}.viable`], k);
  assert.ok(out.errors!['ethical.status']);
  assert.ok(out.errors!.disposition);
});

test('the preview agrees with the server gate on what admits a build', async () => {
  const f = await load();
  const good = fixtureHumilityReview(subject, [claim]);
  const cases = [
    good,
    { ...good, disposition: 'hybrid' },
    {
      ...good,
      comparisons: {
        ...good.comparisons,
        software: { ...good.comparisons.software, viable: false },
      },
    },
    {
      ...good,
      evidence: { ...good.evidence, supported: [] },
      comparisons: Object.fromEntries(
        Object.entries(good.comparisons).map(([k, c]) => [
          k,
          { ...c, evidence_refs: [] },
        ]),
      ),
    },
    { ...good, ethical: { status: 'unresolved_serious', note: 'x' } },
  ];
  for (const body of cases) {
    const verdict = humilityGate(
      { id: subject.id, version: 1, status: 'active', body },
      subject,
    );
    const preview = f.gatePreview(body);
    assert.equal(preview.length === 0, verdict.build_admissible);
  }
});
