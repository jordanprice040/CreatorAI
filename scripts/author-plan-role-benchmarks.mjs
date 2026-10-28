// Offline authoring of the T12 plan-role qualification benchmarks (ADR-0048). It runs the real
// BuildSupervisor on synthetic checklist tasks with a recording plan-role port, so every case
// carries the exact packet T12 sends. It never dispatches a model; scripted answers stand in
// only to reach the reviewer packet. Expected checks are fixed here before any result.
// Usage: pnpm build:code && node scripts/author-plan-role-benchmarks.mjs <out-dir>
import { mkdir, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_SOURCE,
  BUILD_FIXTURE_REVISION_SPEC,
  BUILD_FIXTURE_REVISION_SOURCE,
  BUILD_ROLE_PROMPTS,
  frozenCases,
  taskHashes,
} from '../packages/domain/dist/index.js';
import {
  BuildSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  digest,
} from '../packages/executor/dist/index.js';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';

const out = process.argv[2];
if (!out) throw new Error('usage: author-plan-role-benchmarks.mjs <out-dir>');

const ITEMS = '["inspect", "build", "review", "verify"]';
const flagSpec = (key, name, flag, statement, stdout, heldOut) => ({
  ...BUILD_FIXTURE_SPEC,
  user_flows: [
    ...BUILD_FIXTURE_SPEC.user_flows,
    { key: 'F3', name, steps: [`Run with ${flag}`, 'Read the printed line'] },
  ],
  acceptance_checks: [
    ...BUILD_FIXTURE_SPEC.acceptance_checks,
    {
      key: 'A3',
      flow: 'F3',
      statement,
      measure: 'Exact stdout and zero exit',
      method: 'automated_test',
      cases: [
        { args: [flag], stdin: '', stdout, exit_code: 0, held_out: heldOut },
      ],
    },
  ],
  tasks: [
    {
      ...BUILD_FIXTURE_SPEC.tasks[0],
      acceptance: ['A1', 'A2', 'A3'],
      deliverable: `Committed checklist with a ${flag} mode`,
    },
  ],
  _key: key,
});
const flagSource = (flag, expr) =>
  `import json\nimport sys\nITEMS = ${ITEMS}\nif sys.argv[1:] == ["${flag}"]:\n    print(${expr})\n    sys.exit(0)\nif len(sys.argv) > 1:\n    print("invalid input")\n    sys.exit(2)\nprint(json.dumps({"template": "checklist/1", "items": ITEMS}))\n`;

const V = {
  base: { spec: BUILD_FIXTURE_SPEC },
  plain: { spec: BUILD_FIXTURE_REVISION_SPEC },
  count: {
    spec: flagSpec(
      'count',
      'Count steps',
      '--count',
      'Print the number of checklist steps with --count',
      '4\n',
      false,
    ),
  },
  last: {
    spec: flagSpec(
      'last',
      'Last step',
      '--last',
      'Print only the last checklist step with --last',
      'verify\n',
      true,
    ),
  },
};
for (const v of Object.values(V)) delete v.spec._key;

/** Runs T12 up to the reviewer and returns the exact builder and reviewer packets. */
async function packets(root, spec, source) {
  const body = {
    ...structuredClone(spec),
    format: 'spec/1',
    alternative: { id: randomUUID(), version: 1 },
    selection_id: randomUUID(),
  };
  const binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest(JSON.stringify(body)),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHashes(body).T1, file_scope: ['src'] }],
  };
  const products = new ProductSupervisor(join(root, randomUUID()));
  const product = await products.create(binding);
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  const builds = new BuildSupervisor(
    products,
    new ExecutionSupervisor(products),
  );
  const seen = {};
  const cases = frozenCases(body, body.tasks[0].acceptance).map(
    ({ held_out: _, ...c }) => c,
  );
  const result = await builds.run(
    product.id,
    task.id,
    product.initial_commit,
    {
      format: 'build-plan/1',
      run_id: randomUUID(),
      envelope_id: randomUUID(),
      pricing_snapshot_id: randomUUID(),
      humility_review: { id: randomUUID(), version: 1 },
      data_class: 'synthetic',
      max_repairs: 0,
      max_calls: 2,
      timeout_ms: 120000,
      max_output_tokens: 3000,
      deadline: new Date(Date.now() + 600000).toISOString(),
      cases,
      plan_roles: { connection_id: randomUUID(), model_id: 'authoring' },
    },
    {
      current: async () => ({ binding, spec: body }),
      assertActive: async () => {},
      authorize: async () => ({ verdict: 'allow', fixture: true }),
      call: async () => {
        throw new Error('authoring never uses the broker');
      },
      planRole: async (target, request) => {
        seen[target.role] = request.input;
        if (target.role === 'reviewer')
          throw new Error('authoring stops before review and QA');
        const p = JSON.parse(request.input);
        const main = p.files.find((f) => f.path === 'src/main.py');
        return {
          request_id: randomUUID(),
          status: 'succeeded',
          reason_code: 'ok',
          fixture: true,
          text: JSON.stringify({
            summary: 'authoring candidate',
            submission: {
              expected_commit: p.candidate,
              changes: [
                {
                  path: 'src/main.py',
                  before_hash: main.hash,
                  content: source,
                },
              ],
            },
            blocker: null,
          }),
        };
      },
    },
  );
  if (!seen.builder || !seen.reviewer)
    throw new Error(`packets not captured: ${result.reason}`);
  return {
    builder: seen.builder,
    reviewer: seen.reviewer,
    allCases: cases,
  };
}

const parent = resolve('.verification/plan-role-authoring');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'run-'));
try {
  const message = (role, text) => [
    { role: 'system', text: BUILD_ROLE_PROMPTS[role] },
    { role: 'user', text },
  ];
  // Builder: the patch is graded on every frozen case, held-out ones included, as QA does.
  const builderCases = [];
  for (const [id, split, key] of [
    ['bd-01', 'development', 'plain'],
    ['bd-02', 'held_out', 'base'],
    ['bd-03', 'held_out', 'count'],
    ['bd-04', 'held_out', 'last'],
  ]) {
    const p = await packets(root, V[key].spec, BUILD_FIXTURE_SOURCE);
    builderCases.push({
      case_id: id,
      split,
      input: message('builder', p.builder),
      output_format: 'json',
      max_output_tokens: 3000,
      check: {
        kind: 'patch_cases',
        file_scope: ['src'],
        cases: p.allCases.map(
          ({ check_key, args, stdin, stdout, exit_code }) => ({
            check_key,
            args,
            stdin,
            stdout,
            exit_code,
          }),
        ),
      },
    });
  }
  // Reviewer: correct candidates must be approved with no findings; each defective one
  // breaks an acceptance statement the reviewer can read, so changes are required.
  const reviewerCases = [];
  for (const [id, split, key, source, verdict] of [
    ['rv-01', 'development', 'plain', BUILD_FIXTURE_REVISION_SOURCE, 'approve'],
    [
      'rv-02',
      'held_out',
      'base',
      BUILD_FIXTURE_SOURCE.replace('sys.exit(2)', 'sys.exit(1)'),
      'changes_requested',
    ],
    [
      'rv-03',
      'held_out',
      'count',
      flagSource('--count', 'len(ITEMS)'),
      'approve',
    ],
    [
      'rv-04',
      'held_out',
      'last',
      flagSource('--last', 'ITEMS[-2]'),
      'changes_requested',
    ],
  ]) {
    const p = await packets(root, V[key].spec, source);
    const r = JSON.parse(p.reviewer);
    reviewerCases.push({
      case_id: id,
      split,
      input: message('reviewer', p.reviewer),
      output_format: 'json',
      max_output_tokens: 3000,
      check: {
        kind: 'review_verdict',
        verdict,
        candidate: r.candidate,
        spec_hash: r.spec_hash,
        task_hash: r.task_hash,
      },
    });
  }
  const provenance = (what) =>
    `Synthetic checklist tasks authored offline on ${new Date().toISOString().slice(0, 10)} by scripts/author-plan-role-benchmarks.mjs for ADR-0048. ${what} Packets are the exact T12 packets; expected checks were fixed before any model result. Measures only these synthetic tasks, not general coding or review quality.`;
  const manifests = {
    't12-builder-v1.json': {
      format: 'route-benchmark/1',
      name: 't12-builder-v1',
      fixture: false,
      task_class: 'patch_build',
      data_class: 'synthetic',
      cases: builderCases,
      provenance: provenance(
        'Each answer is applied to the reviewed template and every frozen case runs in the WSL worker.',
      ),
    },
    't12-reviewer-v1.json': {
      format: 'route-benchmark/1',
      name: 't12-reviewer-v1',
      fixture: false,
      task_class: 'independent_review',
      data_class: 'synthetic',
      cases: reviewerCases,
      provenance: provenance(
        'Two candidates are correct (approve with no findings) and two break a stated acceptance check (changes requested).',
      ),
    },
  };
  await mkdir(out, { recursive: true });
  for (const [name, m] of Object.entries(manifests)) {
    BenchmarkManifestSchema.parse(m);
    const file = join(out, name);
    // Frozen once written: never overwrite an authored benchmark.
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`${file} exists; benchmarks are frozen once written`);
    await writeFile(file, `${JSON.stringify(m, null, 2)}\n`, { flag: 'wx' });
    console.log(`${file} ${digest(JSON.stringify(m))}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
