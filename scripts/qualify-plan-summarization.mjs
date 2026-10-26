// One explicitly authorized, frozen eight-case run. No automatic restart or retry.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  BenchmarkManifestSchema,
  PlanConnectionDetailSchema,
} from '../packages/contracts/dist/index.js';
import { canonicalHash, checkOutput } from '../packages/domain/dist/index.js';
import { ConnectionStore } from '../packages/db/dist/index.js';
import {
  DpapiVault,
  PlanConnectionService,
} from '../packages/broker/dist/index.js';

const root = new URL('../', import.meta.url);
const manifestPath = new URL(
  'config/connections/benchmarks/summarization-synthetic-v1.json',
  root,
);
const evidence = new URL('tracking/evidence/plan-summary-v1/', root);
const manifestBytes = await readFile(manifestPath);
const manifest = BenchmarkManifestSchema.parse(JSON.parse(manifestBytes));
assert.equal(manifest.fixture, false);
assert.equal(manifest.task_class, 'summarization');
assert.equal(manifest.data_class, 'synthetic');
assert.equal(manifest.cases.length, 8);
assert.equal(manifest.cases.filter((c) => c.split === 'held_out').length, 6);
for (const c of manifest.cases) {
  assert.equal(c.check.kind, 'exact_label');
  const text = c.check.label;
  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json), ['event', 'when', 'where', 'status']);
  const score = (t, ok = true) =>
    checkOutput(
      c.check,
      { text: t, json },
      { succeeded: ok, reason_code: 'test' },
    );
  assert.equal(score(text), 'accepted');
  assert.notEqual(score(text + ' Invented fact.'), 'accepted');
  assert.notEqual(
    score(text.replace(json.event, 'Incorrect event')),
    'accepted',
  );
  assert.notEqual(score(text.slice(1)), 'accepted');
  assert.notEqual(score(text, false), 'accepted');
}
const binding = {
  manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
  manifest_canonical_hash: canonicalHash(manifest),
  model_id: 'gpt-6-astra',
  max_new_requests: 8,
  min_held_out_cases: 6,
  floor: { numerator: 1, denominator: 1 },
  retries: 0,
};
await mkdir(evidence, { recursive: true });
const save = (name, value) =>
  writeFile(new URL(name, evidence), JSON.stringify(value, null, 2) + '\n');
if (process.argv[2] === '--freeze') {
  // Refuse to replace an existing pre-result freeze.
  await writeFile(
    new URL('freeze.json', evidence),
    JSON.stringify(
      { frozen_at: new Date().toISOString(), ...binding, local_checks: 40 },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({ state: 'frozen', ...binding, local_checks: 40 }),
  );
  process.exit(0);
}
assert.equal(
  process.argv[2],
  '--run',
  'Use --freeze first, then --run <studio-home>; protected input is read from stdin.',
);
const frozen = JSON.parse(
  await readFile(new URL('freeze.json', evidence), 'utf8'),
);
for (const [k, v] of Object.entries(binding))
  assert.deepEqual(frozen[k], v, 'Frozen configuration changed');
// Exclusive lock deliberately remains after completion/failure: never auto-repeat.
await writeFile(new URL('run.lock', evidence), new Date().toISOString(), {
  flag: 'wx',
});
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
raw = '';
const home = process.argv[3];
assert.ok(home);
const cfg = JSON.parse(await readFile(join(home, 'studio.json'), 'utf8'));
assert.equal(cfg.database.mode, 'managed');
const headers = { Cookie: `creator_session=${input.session.token}` };
const base = 'http://127.0.0.1:4310/api';
async function api(path, body) {
  const r = await fetch(`${base}/${path}`, {
    headers: {
      ...headers,
      ...(body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': input.csrf }
        : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      `Local API ${r.status}: ${value.error?.message ?? 'failed'}`,
    );
  return value;
}
const session = await api('auth/session');
input.csrf = session.csrf_token;
const matches = [];
for (const ws of await api('workspaces')) {
  if (ws.record_mode !== 'real') continue;
  for (const c of await api(`workspaces/${ws.id}/plan-connections`)) {
    const { sign_in_attempt: _, ...body } = await api(
      `workspaces/${ws.id}/plan-connections/${c.id}`,
    );
    const d = PlanConnectionDetailSchema.parse(body);
    if (
      d.model_access.some(
        (a) =>
          a.model_id === binding.model_id &&
          a.path === 'responses' &&
          a.access === 'verified',
      )
    )
      matches.push({ ws, detail: d });
  }
}
assert.equal(
  matches.length,
  1,
  'Expected exactly one verified real connection',
);
const { ws, detail } = matches[0],
  c = detail.connection;
assert.deepEqual(detail.blockers, []);
assert.equal(detail.usage.in_flight, 0);
assert.equal(detail.usage.unresolved, 0);
assert.ok(
  c.settings.caps.shared.max_model_requests_per_day -
    detail.usage.last_24h_requests >=
    8,
);
assert.ok(
  !detail.qualifications.some(
    (q) => q.task_class === 'summarization' && q.model_id === binding.model_id,
  ),
  'Existing qualification requires review; do not rerun',
);
const intent = {
  ...binding,
  started_at: new Date().toISOString(),
  workspace_id: ws.id,
  connection_id: c.id,
  settings_hash: c.settings_hash,
  caps: c.settings.caps,
  requests_before: detail.usage.last_24h_requests,
  authorization:
    'Jordan requested preparation and execution of this next qualification step in the current chat; eight synthetic calls, no retries or paid fallback.',
};
await save('intent.json', intent);
const q = await api(
  `workspaces/${ws.id}/plan-connections/${c.id}/qualifications`,
  {
    expected_version: c.version,
    model_id: binding.model_id,
    manifest,
    min_held_out_cases: 6,
    floor: binding.floor,
  },
);
await save('qualification-created.json', q);
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: cfg.database.port,
  database: cfg.database.name,
  user: cfg.database.user,
  password: input.database_password,
  max: 2,
});
delete input.database_password;
const store = new ConnectionStore(pool);
const service = new PlanConnectionService({
  store,
  vault: new DpapiVault(join(home, 'plan-credentials')),
});
const ctx = { actorId: session.actor_id, correlationId: randomUUID() };
const results = [];
try {
  const saved = await store.planQualificationManifest(ctx, ws.id, q.id);
  assert.equal(canonicalHash(saved.manifest), binding.manifest_canonical_hash);
  assert.equal(saved.attempted_cases.length, 0);
  for (const item of manifest.cases) {
    console.log(
      JSON.stringify({
        case: item.case_id,
        state: 'dispatching',
        ordinal: results.length + 1,
        max: 8,
      }),
    );
    let signal = null;
    const result = await service.invoke(ctx, ws.id, {
      connection_id: c.id,
      purpose: 'qualification',
      model_id: binding.model_id,
      task_class: 'summarization',
      data_class: 'synthetic',
      run_id: null,
      qualification_id: q.id,
      qualification_case: { case_id: item.case_id, split: item.split },
      instructions: item.input
        .filter((m) => m.role === 'system')
        .map((m) => m.text)
        .join('\n\n'),
      input: item.input
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .join('\n\n'),
      score: (text, outcome) => {
        let json = null;
        try {
          if (text !== null) json = JSON.parse(text);
        } catch {
          signal = 'schema_invalid';
          return signal;
        }
        signal = checkOutput(
          item.check,
          text === null ? null : { text, json },
          {
            succeeded: outcome.kind === 'completed',
            reason_code:
              outcome.kind === 'completed' ? 'ok' : outcome.reason_code,
          },
        );
        return signal;
      },
    });
    // Retain returned synthetic output and provider outcome, never credentials or headers.
    results.push({
      case_id: item.case_id,
      split: item.split,
      signal,
      ...result,
    });
    await save('raw-results.json', results);
    console.log(
      JSON.stringify({
        case: item.case_id,
        state: result.outcome.kind,
        signal,
      }),
    );
    if (result.outcome.kind !== 'completed')
      throw new Error(
        `Stopped without retry: ${item.case_id}: ${result.outcome.reason_code}`,
      );
  }
  const final = await store.finishPlanQualification(ctx, ws.id, q.id);
  const receipt = {
    finished_at: new Date().toISOString(),
    qualification: final,
    attempted: results.length,
    completed: results.filter((r) => r.outcome.kind === 'completed').length,
    ...binding,
  };
  await save('result.json', receipt);
  console.log(JSON.stringify(receipt));
} catch (e) {
  await save('stopped.json', {
    at: new Date().toISOString(),
    qualification_id: q.id,
    attempted: results.length,
    message: e.message,
  });
  throw e;
} finally {
  await pool.end();
}
