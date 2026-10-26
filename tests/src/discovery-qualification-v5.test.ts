import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '@creator/contracts';
import {
  canonicalHash,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
  discoveryRoleInput,
  checkDiscoveryOutput,
  checkOutput,
} from '@creator/domain';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v5/',
  import.meta.url,
);
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const controls = read('author-controls.json') as {
  case_id: string;
  gold: any;
  negative: any;
  manual_negative: any;
  inputs: Parameters<typeof discoveryRoleInput>[3];
  manual_review: { required: boolean; checks: string[]; result: string };
}[];
const freeze = JSON.parse(
  readFileSync(
    new URL(
      '../../tracking/evidence/discovery-qualification-v5/freeze.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
for (const taskClass of [
  'research_synthesis',
  'candidate_generation',
  'scoring',
]) {
  test(`v5 ${taskClass}: exact production inputs, frozen grades and disclosed semantic limits`, () => {
    const bytes = readFileSync(new URL(`${taskClass}.json`, root));
    const manifest = BenchmarkManifestSchema.parse(
      JSON.parse(bytes.toString()),
    );
    const file = freeze.files.find(
      (x: { task_class: string }) => x.task_class === taskClass,
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(canonicalHash(manifest), file.canonical_hash);
    assert.equal(
      freeze.prompt_hash,
      '024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77',
    );
    assert.equal(freeze.role_version, 'r02-discovery/1.3');
    assert.notEqual(freeze.prompt_hash, DISCOVERY_PROMPT_HASH);
    assert.notEqual(freeze.role_version, DISCOVERY_ROLE_VERSION);
    assert.equal(manifest.fixture, false);
    assert.equal(
      manifest.cases.filter((c) => c.split === 'development').length,
      2,
    );
    assert.equal(
      manifest.cases.filter((c) => c.split === 'held_out').length,
      4,
    );
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          expected_version: 8,
          model_id: 'gpt-6-astra',
          manifest,
          min_held_out_cases: 4,
          floor: { numerator: 1, denominator: 1 },
        }),
      ) <=
        128 * 1024,
    );
    for (const c of manifest.cases) {
      if (c.check.kind !== 'discovery_contract') throw Error('wrong check');
      const control = controls.find((x) => x.case_id === c.case_id)!;
      const rendered = discoveryRoleInput(
        c.check.task_kind,
        c.check.context,
        c.check.packet,
        control.inputs,
      );
      assert.notEqual(
        c.input[0]!.text,
        rendered
          .filter((m) => m.role === 'system')
          .map((m) => m.text)
          .join('\n'),
      );
      assert.equal(
        c.input[1]!.text,
        JSON.stringify(rendered.filter((m) => m.role === 'user')),
      );
      assert.ok(c.input.reduce((n, m) => n + m.text.length, 0) <= 24000);
      assert.ok(
        !c.input.some(
          (m) =>
            m.text.includes('prospective_checks') ||
            m.text.includes('manual_review'),
        ),
      );
      assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
      assert.deepEqual(
        c.check.context.inputs.map((i) => i.output_hash),
        control.inputs.map((i) => canonicalHash(i.output)),
      );
      const score = (json: unknown) =>
        checkOutput(
          c.check,
          { text: JSON.stringify(json), json },
          { succeeded: true, reason_code: 'local_control' },
        );
      assert.equal(score(control.gold), 'accepted', c.case_id);
      assert.equal(
        checkDiscoveryOutput(
          c.check.task_kind,
          control.negative,
          c.check.packet,
          c.check.context,
        ).ok,
        true,
      );
      assert.equal(score(control.negative), 'acceptance_check_failed');
      assert.notEqual(score({ ...control.gold, fixture: true }), 'accepted');
      assert.notEqual(score({ ...control.gold, extra: 'wrapper' }), 'accepted');
      assert.equal(
        score(control.manual_negative),
        'accepted',
        'demonstrate the semantic blind spot, not factual correctness',
      );
      assert.equal(control.manual_review.required, true);
      assert.equal(control.manual_review.result, 'not_reviewed');
      assert.ok(control.manual_review.checks.length >= 3);
    }
  });
}
test('v5 covers revision, five-way review and fresh cases without rewriting historical evidence', () => {
  const candidates = BenchmarkManifestSchema.parse(
    read('candidate_generation.json'),
  );
  const revision = candidates.cases.find(
    (c) =>
      c.check.kind === 'discovery_contract' && c.check.task_kind === 'revise',
  )!;
  assert.ok(revision);
  const revised = controls.find((c) => c.case_id === revision.case_id)!;
  assert.equal(revised.inputs.filter((i) => i.kind === 'skeptic').length, 1);
  assert.equal(
    (revised.inputs.find((i) => i.kind === 'skeptic')!.output as any).reviews[0]
      .findings.length,
    2,
  );
  const sk = BenchmarkManifestSchema.parse(read('scoring.json')).cases[0]!;
  if (sk.check.kind !== 'discovery_contract') throw Error('wrong check');
  assert.equal(sk.check.context.inputs.length, 5);
  const names = new Set(controls.map((c) => c.case_id));
  assert.equal(names.size, 18);
  for (const version of [1, 2, 3, 4]) {
    for (const taskClass of [
      'research_synthesis',
      'candidate_generation',
      'scoring',
    ]) {
      const old = JSON.parse(
        readFileSync(
          new URL(
            `../../config/connections/benchmarks/discovery-synthetic-v${version}/${taskClass}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      assert.ok(
        old.cases.every((c: { case_id: string }) => !names.has(c.case_id)),
      );
    }
  }
  const frozenControls = readFileSync(new URL('author-controls.json', root));
  assert.equal(
    createHash('sha256').update(frozenControls).digest('hex'),
    freeze.controls_sha256,
  );
});
