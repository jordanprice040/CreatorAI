import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '@creator/contracts';
import {
  canonicalHash,
  checkOutput,
  checkDiscoveryOutput,
  discoveryRoleInput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '@creator/domain';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v2/',
  import.meta.url,
);
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const controls = read('author-controls.json') as {
  task_class: string;
  case_id: string;
  gold: any;
  negative: any;
  inputs: Parameters<typeof discoveryRoleInput>[3];
  manual_review: { required: boolean; result: string };
}[];
const freeze = JSON.parse(
  readFileSync(
    new URL(
      '../../tracking/evidence/discovery-qualification-v2/freeze.json',
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
  test(`historical v2 ${taskClass}: frozen transport and original decision controls remain intact`, () => {
    const bytes = readFileSync(new URL(`${taskClass}.json`, root));
    const manifest = BenchmarkManifestSchema.parse(
      JSON.parse(bytes.toString()),
    );
    const binding = freeze.files.find(
      (f: { task_class: string }) => f.task_class === taskClass,
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      binding.sha256,
    );
    assert.equal(canonicalHash(manifest), binding.canonical_hash);
    assert.equal(freeze.role_version, 'r02-discovery/1.1');
    assert.notEqual(freeze.role_version, DISCOVERY_ROLE_VERSION);
    assert.notEqual(freeze.prompt_hash, DISCOVERY_PROMPT_HASH);
    assert.equal(
      manifest.cases.filter((c) => c.split === 'development').length,
      2,
    );
    assert.equal(
      manifest.cases.filter((c) => c.split === 'held_out').length,
      4,
    );
    for (const c of manifest.cases) {
      if (c.check.kind !== 'discovery_contract')
        throw new Error('Expected production discovery contract');
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
      assert.equal(c.check.context.role_version, freeze.role_version);
      assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
      const score = (json: unknown, check = c.check) =>
        checkOutput(
          check,
          { text: JSON.stringify(json), json },
          { succeeded: true, reason_code: 'local_test' },
        );
      assert.equal(score(control.gold), 'accepted', c.case_id);
      // This mutation retains the output schema; it tests a consequential decision, not JSON shape.
      assert.equal(
        checkDiscoveryOutput(
          c.check.task_kind,
          control.negative,
          c.check.packet,
          c.check.context,
        ).ok,
        true,
        c.case_id,
      );
      assert.equal(
        score(control.negative),
        'acceptance_check_failed',
        c.case_id,
      );
      const wrongPacket = structuredClone(c.check);
      wrongPacket.context.packet_hash = '0'.repeat(64);
      assert.equal(score(control.gold, wrongPacket), 'acceptance_check_failed');
      for (const invalid of [
        {},
        { ...control.gold, extra: true },
        { ...control.gold, fixture: true },
      ])
        assert.notEqual(score(invalid), 'accepted');
      assert.equal(control.manual_review.required, true);
      assert.equal(control.manual_review.result, 'not_reviewed');
    }
  });
}
test('v2 anchors reject unsupported confidence but allow corroboration within explicitly simulated scope', () => {
  const manifest = BenchmarkManifestSchema.parse(
    read('research_synthesis.json'),
  );
  const strengths = manifest.cases.map(
    (c) =>
      controls.find((x) => x.case_id === c.case_id)!.gold.evidence_strength,
  );
  for (const c of manifest.cases) {
    if (c.check.kind !== 'discovery_contract')
      throw new Error('wrong contract');
    const expected =
      c.case_id === 'loc-dev-rumor' || c.case_id === 'loc-held-expired'
        ? 'insufficient'
        : 'sufficient';
    assert.equal(c.check.packet.sufficiency.verdict, expected, c.case_id);
  }
  assert.deepEqual(strengths, [
    'exploratory',
    'insufficient',
    'exploratory',
    'well_supported',
    'insufficient',
    'exploratory',
  ]);
  const prompt = manifest.cases[0]!.input[0]!.text;
  for (const anchor of [
    'Packet sufficiency only permits investigation',
    'Repeated logs from one author',
    'does not establish real-world need',
    'not confidence that a proposed intervention works',
  ])
    assert.ok(prompt.includes(anchor));
});
test('substantive review remains necessary: schema-valid invented narrative is not certified by enum/reference checks', () => {
  const c = BenchmarkManifestSchema.parse(read('research_synthesis.json'))
    .cases[0]!;
  const gold = structuredClone(
    controls.find((x) => x.case_id === c.case_id)!.gold,
  );
  gold.problem_statement =
    'A real-world trial proved that this solution eliminated every missing charger.';
  // Honest limitation: do not represent this automated acceptance as factual entailment.
  assert.equal(
    checkOutput(
      c.check,
      { text: JSON.stringify(gold), json: gold },
      { succeeded: true, reason_code: 'local_test' },
    ),
    'accepted',
  );
  assert.equal(freeze.manual_review_required, true);
});
