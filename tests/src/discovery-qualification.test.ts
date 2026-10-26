import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '@creator/contracts';
import {
  canonicalHash,
  checkOutput,
  discoveryRoleInput,
} from '@creator/domain';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v1/',
  import.meta.url,
);
const controls = JSON.parse(
  readFileSync(new URL('author-controls.json', root), 'utf8'),
) as {
  task_class: string;
  case_id: string;
  gold: Record<string, any>;
  inputs: Parameters<typeof discoveryRoleInput>[3];
}[];
for (const taskClass of [
  'research_synthesis',
  'candidate_generation',
  'scoring',
]) {
  const manifest = BenchmarkManifestSchema.parse(
    JSON.parse(readFileSync(new URL(`${taskClass}.json`, root), 'utf8')),
  );
  test(`${taskClass}: historical v1 cases retain frozen transport and original schema/decision grading`, () => {
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          '../../tracking/evidence/discovery-qualification-prep/freeze.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const binding = frozen.files.find(
      (f: { task_class: string }) => f.task_class === taskClass,
    );
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`${taskClass}.json`, root)))
        .digest('hex'),
      binding.sha256,
    );
    assert.equal(
      manifest.cases.filter((c) => c.split === 'held_out').length,
      4,
    );
    for (const c of manifest.cases) {
      assert.equal(c.check.kind, 'discovery_contract');
      if (c.check.kind !== 'discovery_contract') throw new Error('wrong check');
      const control = controls.find(
        (x) => x.task_class === taskClass && x.case_id === c.case_id,
      )!;
      const rendered = discoveryRoleInput(
        c.check.task_kind,
        c.check.context,
        c.check.packet,
        control.inputs,
      );
      assert.equal(
        c.input[1]!.text,
        JSON.stringify(rendered.filter((m) => m.role === 'user')),
      );
      // v1 is historical evidence, deliberately ineligible for the revised production role.
      assert.notEqual(
        c.input[0]!.text,
        rendered
          .filter((m) => m.role === 'system')
          .map((m) => m.text)
          .join('\n'),
      );
      const score = (json: unknown, check = c.check) =>
        checkOutput(
          check,
          { text: JSON.stringify(json), json },
          { succeeded: true, reason_code: 'test' },
        );
      assert.equal(score(control.gold), 'accepted', c.case_id);
      for (const mutation of [
        {},
        { ...control.gold, fixture: true },
        { ...control.gold, extra: 'x' },
      ])
        assert.notEqual(score(mutation), 'accepted');
      const broken = structuredClone(c.check);
      broken.context.packet_hash = 'a'.repeat(64);
      assert.notEqual(score(control.gold, broken), 'accepted');
      // Mutate a valid enum/reference, leaving JSON and the production shape intact.
      const semantic = structuredClone(control.gold);
      if (c.check.task_kind === 'locate') {
        if (c.case_id === 'dev-transfer')
          semantic.cross_field.claim_refs = ['C1'];
        else if (c.case_id === 'held-existing-checklist')
          semantic.alternatives = [];
        else
          semantic.evidence_strength =
            semantic.evidence_strength === 'well_supported'
              ? 'insufficient'
              : 'well_supported';
      } else if (c.check.task_kind === 'skeptic')
        semantic.reviews[0].verdict = 'stands';
      else
        semantic.software_warranted.verdict =
          semantic.software_warranted.verdict === 'no' ||
          c.case_id === 'held-hybrid-uncertainty'
            ? 'yes'
            : 'no';
      assert.equal(score(semantic), 'acceptance_check_failed', c.case_id);
      const forged = structuredClone(control.gold);
      if (forged.claim_refs) forged.claim_refs = ['C99'];
      else if (forged.urgency) forged.urgency.claim_refs = ['C99'];
      else forged.reviews[0].findings[0].claim_refs = ['C99'];
      assert.notEqual(score(forged), 'accepted');
      assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
    }
  });
}
