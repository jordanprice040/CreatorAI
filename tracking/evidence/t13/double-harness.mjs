// T13 browser harness for hosts WITHOUT the reviewed WSL2 worker (the Linux cloud container).
// It serves the real API, preview origin and built web app, but packages are built and
// "started" by the TEST DOUBLE in tests/dist/artifact-double.js: nothing is executed and the
// manifests say backend "test-double" (shown in the UI as "Not isolation evidence"). It proves
// UI, access, hashing and lease behaviour only. Real isolation is the WSL2 CLI gate.
// Usage (after `pnpm build` and `pnpm db:migrate` on an empty database):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=... node tracking/evidence/t13/double-harness.mjs
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { preview as vitePreview } from 'vite';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '../../../apps/api/dist/index.js';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ProductSupervisor,
} from '../../../packages/executor/dist/index.js';
import {
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_FEEDBACK,
  BUILD_FIXTURE_REVISION_CASES,
  BUILD_FIXTURE_REVISION_SPEC,
  BUILD_FIXTURE_SPEC,
  buildFixtureAnswer,
} from '../../../packages/domain/dist/index.js';
import { TestDoubleExecutor } from '../../../tests/dist/artifact-double.js';

const root = resolve('.verification/t13-browser');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(join(root, 'run-'));
const products = new ProductSupervisor(join(dir, 'products'));
const double = new TestDoubleExecutor(products);
const artifacts = new ArtifactSupervisor(products, double);
const api = createApi(process.env, { artifacts });
const { config, store } = api;
api.server.listen(config.api_port, config.host);
api.preview.listen(config.preview_port, config.host);
await Promise.all([once(api.server, 'listening'), once(api.preview, 'listening')]);
await api.ready();
const web = await vitePreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts' });
const origin = `http://${config.host}:${config.api_port}`;
const env = { ...process.env, CREATOR_API_URL: origin, CREATOR_SESSION_FILE: join(dir, 'session.json') };
const cli = async (...args) =>
  JSON.parse((await promisify(execFile)(process.execPath, ['apps/cli/dist/main.js', ...args], { env })).stdout);
await cli('login', process.env.CREATOR_DEV_LOGIN_CODE);
const seed = await cli('seed-selection');
const ws = seed.workspace.id, specId = seed.spec.id, ctx = { actorId: DEFAULT_OWNER_ACTOR_ID };
const freeze = async (version) => {
  const body = JSON.stringify({ spec: { id: specId, version }, justification: 'Synthetic T13 browser freeze', data_class: 'synthetic' });
  const r = await cli('spec-freeze', ws, seed.run, body);
  if (r.status === 'needs_human') {
    const d = await cli('decision', ws, r.admission.decision_id);
    await cli('answer', ws, d.id, d.coverage.coverage_hash, 'approve_once', 'Synthetic freeze');
    await cli('spec-freeze', ws, seed.run, body);
  }
};
const current = async () => {
  const status = await store.specStatus(ctx, ws, specId);
  const spec = (await store.getEntity(ctx, ws, specId)).entity.body;
  return {
    spec,
    binding: {
      workspace_id: ws, owner_id: DEFAULT_OWNER_ACTOR_ID, spec_id: specId,
      spec_version: status.spec.version, spec_hash: status.spec.content_hash,
      freeze_id: status.latest_freeze.id,
      tasks: spec.tasks.filter((x) => x.file_scope.length).map((x) => ({ key: x.key, hash: status.latest_freeze.task_hashes[x.key], file_scope: x.file_scope })),
    },
  };
};
const ports = {
  current,
  assertActive: async () => {},
  authorize: async () => ({ verdict: 'allow', test_double: true }),
  call: async (_run, r) => {
    const json = JSON.parse(buildFixtureAnswer(r.input));
    return { status: 'succeeded', reason_code: 'fixture', explanation: 'Test double port', logical_operation_id: r.logical_operation_id, attempts: [], output: { text: JSON.stringify(json), json, vector: null }, decision_id: null, fixture: true, replayed: false };
  },
};
const plan = (cases) => ({ format: 'build-plan/1', run_id: seed.run, envelope_id: seed.run, pricing_snapshot_id: seed.run, humility_review: { id: specId, version: 1 }, data_class: 'synthetic', max_repairs: 0, max_calls: 2, timeout_ms: 10000, max_output_tokens: 3000, deadline: new Date(Date.now() + 600000).toISOString(), cases });
const builds = new BuildSupervisor(products, double);
async function buildAndRegister(base, cases, lineage) {
  const { binding } = await current();
  const p = await products.create(binding, base);
  const task = await products.createTask(p.id, 'T1', p.initial_commit, binding);
  const b = await builds.run(p.id, task.id, p.initial_commit, plan(cases), ports);
  if (b.state !== 'verified_candidate') throw new Error(b.reason);
  const pkg = await artifacts.package(p.id, b.id, ports, lineage);
  const summary = await store.registerArtifact(ctx, ws, pkg.manifest, pkg.manifest_sha256);
  return { product: p, summary };
}
const before = await cli('spec', ws, specId);
const v1 = await cli('spec-revise', ws, specId, JSON.stringify({ expected_version: before.spec.version, title: 'Synthetic bounded checklist', content: BUILD_FIXTURE_SPEC, reason: 'Synthetic T13 browser walkthrough' }));
await freeze(v1.spec.version);
const first = await buildAndRegister(undefined, BUILD_FIXTURE_CASES);
const fb = await store.submitFeedback(ctx, ws, first.summary.id, { expected_manifest_sha256: first.summary.manifest_sha256, category: 'change_request', text: BUILD_FIXTURE_FEEDBACK });
const ok = await store.decideFeedback(ctx, ws, fb.id, { expected_version: fb.version, decision: 'accept', rationale: 'Synthetic acceptance' });
const revised = await store.reviseFromFeedback(ctx, ws, fb.id, { expected_version: ok.version, expected_spec_version: v1.spec.version, title: 'Synthetic checklist with plain list', content: BUILD_FIXTURE_REVISION_SPEC, reason: 'Accepted synthetic feedback' });
await freeze(revised.revision.version);
const opened = await artifacts.open(first.product.id, first.summary.id, first.summary.manifest_sha256);
const second = await buildAndRegister(
  { files: opened.files, lineage: { artifact_id: first.summary.id, manifest_sha256: first.summary.manifest_sha256, product_id: first.product.id, commit: first.summary.commit } },
  BUILD_FIXTURE_REVISION_CASES,
  { previous: { artifact_id: first.summary.id, manifest_sha256: first.summary.manifest_sha256 }, feedback_ids: [fb.id] },
);
const out = { ws, first: first.summary.id, second: second.summary.id, backend: 'test-double', products_root: products.root };
await writeFile('tracking/evidence/t13/browser-seed.json', JSON.stringify(out, null, 2) + '\n');
console.log(`READY ${JSON.stringify(out)}`);
const stop = async () => {
  await api.close();
  web.httpServer.closeAllConnections();
  await new Promise((r) => web.httpServer.close(r));
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
