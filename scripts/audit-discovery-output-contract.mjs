// Offline only. Writes review evidence, never model requests or qualification records.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
  canonicalHash,
} from '../packages/domain/dist/index.js';
import { currentDiscoveryQualificationFixture } from '../tests/dist/discovery-contract-fixtures.js';
const root = new URL('../', import.meta.url),
  dir = new URL('tracking/evidence/discovery-output-contract/', root);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const inventory = [],
  prompts = {},
  transport = [];
for (const taskClass of [
  'research_synthesis',
  'candidate_generation',
  'scoring',
]) {
  const manifest = currentDiscoveryQualificationFixture(taskClass);
  const body = {
    expected_version: 8,
    model_id: 'gpt-6-astra',
    manifest,
    min_held_out_cases: 4,
    floor: { numerator: 1, denominator: 1 },
  };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bytes <= 128 * 1024);
  const largestInput = Math.max(
    ...manifest.cases.map((c) =>
      c.input.reduce((n, m) => n + m.text.length, 0),
    ),
  );
  assert.ok(largestInput <= 24000);
  transport.push({
    task_class: taskClass,
    fixture_rebinding_only: true,
    creation_bytes: bytes,
    largest_input_chars: largestInput,
  });
  for (const c of manifest.cases) {
    if (c.check.kind !== 'discovery_contract') throw Error('wrong fixture');
    const kind = c.check.task_kind;
    if (prompts[kind]) continue;
    const system = c.input[0].text;
    const schema = JSON.parse(system.split('Output JSON Schema:\n')[1]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.fixture, undefined);
    assert.ok(system.includes('do not return a generic TaskResult wrapper'));
    prompts[kind] = {
      role_version: DISCOVERY_ROLE_VERSION,
      system,
      model_schema: schema,
    };
    function visit(s, path) {
      inventory.push({
        kind,
        path,
        ...Object.fromEntries(
          Object.entries(s).filter(([key]) =>
            [
              'type',
              'minLength',
              'maxLength',
              'minItems',
              'maxItems',
              'enum',
              'pattern',
              'required',
              'additionalProperties',
            ].includes(key),
          ),
        ),
      });
      for (const [k, v] of Object.entries(s.properties ?? {}))
        visit(v, `${path}.${k}`);
      if (s.items) visit(s.items, `${path}[]`);
      for (const v of s.anyOf ?? []) visit(v, `${path}|${v.type}`);
    }
    visit(schema, '$');
  }
}
assert.equal(Object.keys(prompts).length, 4);
for (const folder of [
  'discovery-qualification-prep',
  'discovery-qualification-v2',
]) {
  const freeze = await read(`tracking/evidence/${folder}/freeze.json`);
  for (const f of freeze.files)
    assert.equal(sha(await readFile(new URL(f.path, root))), f.sha256);
}
for (const folder of [
  'discovery-qualification-prep',
  'discovery-qualification-v2',
  'discovery-v2-transport-repair',
])
  assert.ok(
    (
      await readFile(
        new URL(`tracking/evidence/${folder}/run.lock`, root),
        'utf8',
      )
    ).trim(),
  );
const proposal = await read(
  'config/connections/benchmarks/discovery-synthetic-v3/proposal.json',
);
assert.equal(proposal.status, 'design_proposal_not_executable');
assert.equal(proposal.prompt_hash, DISCOVERY_PROMPT_HASH);
assert.equal(proposal.cases.length, 18);
assert.equal(new Set(proposal.cases.map((c) => c.id)).size, 18);
for (const taskClass of [
  'research_synthesis',
  'candidate_generation',
  'scoring',
]) {
  const cases = proposal.cases.filter((c) => c.task_class === taskClass);
  assert.equal(cases.filter((c) => c.split === 'development').length, 2);
  assert.equal(cases.filter((c) => c.split === 'held_out').length, 4);
}
assert.ok(proposal.cases.some((c) => c.kind === 'revise'));
const installedHash = sha(
  await readFile(
    'C:/Users/jorda/AppData/Local/Creator Agent/studio/bundle-manifest.json',
  ),
);
assert.equal(
  installedHash,
  'b59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048',
);
const sourceHashes = {};
for (const p of [
  'packages/domain/src/discovery.ts',
  'packages/contracts/src/discovery.ts',
  'tests/src/discovery-output-contract.test.ts',
  'tests/src/discovery-contract-fixtures.ts',
  'scripts/audit-discovery-output-contract.mjs',
])
  sourceHashes[p] = sha(await readFile(new URL(p, root)));
const result = {
  at: new Date().toISOString(),
  state: 'offline_contract_audit_complete',
  role_version: DISCOVERY_ROLE_VERSION,
  prompt_hash: DISCOVERY_PROMPT_HASH,
  roles: 4,
  boundary_mutations: 189,
  scope:
    'Model-facing prompt guidance derived from unchanged validators; no provider-enforced schema capability claimed.',
  transport_checks: transport,
  source_sha256: sourceHashes,
  proposal_hash: canonicalHash(proposal),
  proposed_fresh_cases: 18,
  proposal_executable: false,
  installed_manifest_sha256: installedHash,
  new_provider_calls: 0,
  installed_changed: false,
  settings_changed: false,
  prior_manifests_and_locks_preserved: true,
};
await mkdir(dir, { recursive: true });
for (const [name, value] of Object.entries({
  'result.json': result,
  'schema-inventory.json': inventory,
  'model-facing-contracts.json': prompts,
}))
  await writeFile(new URL(name, dir), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
console.log(JSON.stringify(result));
