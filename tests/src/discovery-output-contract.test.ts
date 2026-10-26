import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  LocatorOutputSchema,
  ProposalOutputSchema,
  SkepticOutputSchema,
  type DiscoveryTaskKind,
} from '@creator/contracts';
import {
  checkDiscoveryOutput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '@creator/domain';
import { currentDiscoveryQualificationFixture } from './discovery-contract-fixtures.js';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v2/',
  import.meta.url,
);
const controls = JSON.parse(
  readFileSync(new URL('author-controls.json', root), 'utf8'),
) as { case_id: string; gold: any }[];
const choices = [
  ['locate', 'research_synthesis', LocatorOutputSchema],
  ['propose', 'candidate_generation', ProposalOutputSchema],
  ['revise', 'candidate_generation', ProposalOutputSchema],
  ['skeptic', 'scoring', SkepticOutputSchema],
] as const;
function selected(kind: DiscoveryTaskKind, taskClass: string) {
  const c = currentDiscoveryQualificationFixture(taskClass).cases.find(
    (c) => c.check.kind === 'discovery_contract' && c.check.task_kind === kind,
  )!;
  if (c.check.kind !== 'discovery_contract') throw Error('wrong check');
  const text = c.input[0]!.text;
  const schema = JSON.parse(text.split('Output JSON Schema:\n')[1]!);
  return {
    c,
    text,
    schema,
    gold: structuredClone(controls.find((x) => x.case_id === c.case_id)!.gold),
  };
}
for (const [kind, taskClass, validator] of choices) {
  test(`${kind}: prompt includes strict complete schema and boundary mutations are rejected`, (t) => {
    const { text, schema, gold } = selected(kind, taskClass);
    assert.equal(DISCOVERY_ROLE_VERSION, 'r02-discovery/1.4');
    assert.ok(text.includes('complete result payload'));
    assert.ok(text.includes('do not return a generic TaskResult wrapper'));
    assert.ok(text.includes('Never discard consequential uncertainty'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.fixture, undefined);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
    );
    const objectRules = (s: any) => {
      if (s.type === 'object') {
        assert.equal(s.additionalProperties, false);
        for (const v of Object.values(s.properties)) objectRules(v);
      }
      if (s.items) objectRules(s.items);
      for (const v of s.anyOf ?? []) objectRules(v);
    };
    objectRules(schema);
    if (kind === 'locate') {
      gold.workarounds = [
        { description: 'Observed monitoring only.', claim_refs: ['C1'] },
      ];
      gold.alternatives = [
        { description: 'A bounded process hypothesis.', claim_refs: ['C3'] },
      ];
      gold.software_hypothesis = {
        hypothesis: 'A future experiment, not measured benefit.',
        measurable_outcome: 'Missing-item counts.',
        claim_refs: ['C1'],
      };
      assert.equal(schema.properties.affected_users.type, 'string');
      assert.equal(schema.properties.affected_users.maxLength, 300);
      assert.equal(schema.properties.gaps.maxItems, 8);
      assert.equal(schema.properties.workarounds.maxItems, 8);
      assert.equal(schema.properties.alternatives.maxItems, 8);
      const cross = schema.properties.cross_field.anyOf.find(
        (v: any) => v.type === 'object',
      );
      assert.equal(cross.properties.transferred_mechanism.minLength, 30);
      assert.equal(cross.properties.transferred_mechanism.maxLength, 800);
      assert.equal(schema.properties.problem_statement.maxLength, 1200);
      assert.equal(
        schema.properties.urgency.properties.claim_refs.maxItems,
        30,
      );
    } else if (kind === 'skeptic') {
      assert.equal(schema.properties.reviews.minItems, 1);
      assert.equal(schema.properties.reviews.maxItems, 5);
      assert.equal(
        schema.properties.reviews.items.properties.findings.maxItems,
        8,
      );
    } else {
      gold.novelty = 'No novelty established.';
      assert.equal(schema.properties.assumptions.maxItems, 6);
      assert.equal(schema.properties.title.maxLength, 200);
      assert.equal(schema.properties.mechanism.maxLength, 1200);
      if (kind === 'revise')
        assert.ok(text.includes('complete revised proposal'));
    }
    assert.equal(validator.safeParse(gold).success, true);
    const setAt = (value: any, path: (string | number)[], v: unknown) => {
      let p = value;
      for (const key of path.slice(0, -1)) p = p[key];
      p[path.at(-1)!] = v;
    };
    let mutations = 0;
    const reject = (path: (string | number)[], value: unknown) => {
      const bad = structuredClone(gold);
      setAt(bad, path, value);
      assert.equal(
        validator.safeParse(bad).success,
        false,
        `${kind}:${path.join('.')}`,
      );
      mutations++;
    };
    const walk = (s: any, v: any, path: (string | number)[]) => {
      if (v === null || v === undefined) return;
      if (s.anyOf) {
        const branch = s.anyOf.find(
          (b: any) => b.type === (Array.isArray(v) ? 'array' : typeof v),
        );
        if (branch) walk(branch, v, path);
        return;
      }
      if (s.type === 'object') {
        for (const [k, child] of Object.entries(s.properties))
          walk(child, v[k], [...path, k]);
      }
      if (s.type === 'string') {
        reject(path, []);
        if (s.minLength) reject(path, '');
        if (s.maxLength) reject(path, 'x'.repeat(s.maxLength + 1));
        if (s.enum) reject(path, '__not_an_allowed_value__');
        if (s.pattern) reject(path, 'INVALID_REF');
      }
      if (s.type === 'array') {
        reject(path, {});
        if (s.minItems) reject(path, []);
        if (s.maxItems !== undefined && v.length)
          reject(
            path,
            Array.from({ length: s.maxItems + 1 }, () => v[0]),
          );
        if (v.length) walk(s.items, v[0], [...path, 0]);
      }
    };
    walk(schema, gold, []);
    assert.ok(mutations > 20, `${kind} exercises nested boundary controls`);
    t.diagnostic(
      `${mutations} nested type/length/count/enum/reference boundary mutations rejected`,
    );
  });
}
test('relational checks remain deterministic beyond the generated JSON Schema', () => {
  const loc = selected('locate', 'research_synthesis');
  if (loc.c.check.kind !== 'discovery_contract') throw Error('wrong check');
  const both = structuredClone(loc.gold);
  both.cross_field_absent_reason = 'Also absent';
  assert.equal(LocatorOutputSchema.safeParse(both).success, false);
  const wrongField = structuredClone(loc.gold);
  wrongField.cross_field.to_field = 'invented field';
  assert.equal(
    checkDiscoveryOutput(
      'locate',
      wrongField,
      loc.c.check.packet,
      loc.c.check.context,
    ).ok,
    false,
  );
  for (const kind of ['propose', 'revise'] as const) {
    const s = selected(kind, 'candidate_generation');
    if (s.c.check.kind !== 'discovery_contract') throw Error('wrong check');
    s.gold.response_to_findings =
      kind === 'propose' ? 'Unrequested findings' : null;
    assert.equal(
      checkDiscoveryOutput(kind, s.gold, s.c.check.packet, s.c.check.context)
        .ok,
      false,
    );
  }
  const sk = selected('skeptic', 'scoring');
  if (sk.c.check.kind !== 'discovery_contract') throw Error('wrong check');
  sk.gold.reviews = sk.gold.reviews.slice(1);
  assert.equal(
    checkDiscoveryOutput(
      'skeptic',
      sk.gold,
      sk.c.check.packet,
      sk.c.check.context,
    ).ok,
    false,
  );
});
test('retained failed output is still invalid and historical evidence is unchanged', () => {
  const rows = JSON.parse(
    readFileSync(
      new URL(
        '../../tracking/evidence/discovery-v2-transport-repair/raw-results.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const raw = rows[0].outcome;
  assert.equal(
    createHash('sha256').update(raw.text).digest('hex'),
    '28f346c146e013f23ca0b0007b821ab882c49f170d1972fd7a661d322bd3f542',
  );
  const parsed = LocatorOutputSchema.safeParse(JSON.parse(raw.text));
  assert.equal(parsed.success, false);
  if (parsed.success) throw Error('must remain failed');
  assert.deepEqual(
    parsed.error.issues.map((i) => i.path.join('.')),
    ['affected_users', 'gaps'],
  );
  const old = JSON.parse(
    readFileSync(
      new URL(
        '../../tracking/evidence/discovery-qualification-v2/freeze.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.notEqual(old.prompt_hash, DISCOVERY_PROMPT_HASH);
});
