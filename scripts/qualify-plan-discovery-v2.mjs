// Explicit execution only after a separately approved, hash-bound review packet.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  BenchmarkManifestSchema,
  PlanConnectionDetailSchema,
} from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  checkOutput,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
import { ConnectionStore } from '../packages/db/dist/index.js';
import {
  DpapiVault,
  PlanConnectionService,
} from '../packages/broker/dist/index.js';
const root = new URL('../', import.meta.url),
  dir = new URL('tracking/evidence/discovery-qualification-v2/', root);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const frozen = await read(
  'tracking/evidence/discovery-qualification-v2/freeze.json',
);
const manifests = [];
for (const f of frozen.files) {
  const bytes = await readFile(new URL(f.path, root));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    f.sha256,
    'Frozen manifest bytes changed.',
  );
  const manifest = BenchmarkManifestSchema.parse(JSON.parse(bytes));
  assert.equal(canonicalHash(manifest), f.canonical_hash);
  assert.equal(manifest.fixture, false);
  assert.equal(manifest.data_class, 'synthetic');
  assert.equal(manifest.cases.length, 6);
  manifests.push(manifest);
}
assert.equal(
  DISCOVERY_PROMPT_HASH,
  frozen.prompt_hash,
  'Production prompt changed; prepare a new version.',
);
assert.equal(
  createHash('sha256')
    .update(
      await readFile(
        new URL(
          'config/connections/benchmarks/discovery-synthetic-v2/author-controls.json',
          root,
        ),
      ),
    )
    .digest('hex'),
  frozen.controls_sha256,
);
assert.deepEqual(frozen.limits, {
  max_new_requests: 18,
  retries: 0,
  max_concurrency: 1,
  max_request_ms: 120000,
  max_wall_ms: 2160000,
  max_output_chars: 16000,
  max_input_chars: 24000,
  new_metered_spend_nano_usd: '0',
  settings_expansion: false,
});
if (process.argv[2] === '--check') {
  console.log(
    JSON.stringify({
      state: 'prepared_only',
      manifests: manifests.length,
      cases: manifests.reduce((n, m) => n + m.cases.length, 0),
      new_provider_calls: 0,
    }),
  );
  process.exit(0);
}
assert.equal(
  process.argv[2],
  '--run',
  'Use --check; execution requires --run <studio-home> <approved-execution-plan-hash>.',
);
const plan = await read(
  'tracking/evidence/discovery-qualification-v2/execution-plan.json',
);
assert.equal(
  process.argv[4],
  canonicalHash(plan),
  'Exact execution plan approval hash is required.',
);
assert.equal(plan.preparation_hash, canonicalHash(frozen));
assert.equal(plan.max_new_requests, 18);
assert.equal(plan.metered_spend_nano_usd, '0');
for (const [p, h] of Object.entries(plan.source_sha256))
  assert.equal(
    createHash('sha256')
      .update(await readFile(new URL(p, root)))
      .digest('hex'),
    h,
    `Candidate changed: ${p}`,
  );
const home = process.argv[3];
assert.ok(home);
const installedManifest = await readFile(
  join(plan.install_dir, 'studio/bundle-manifest.json'),
);
assert.equal(
  createHash('sha256').update(installedManifest).digest('hex'),
  plan.bundle_manifest_sha256,
  'Install the reviewed candidate first.',
);
const save = (name, data) =>
  writeFile(new URL(name, dir), JSON.stringify(data, null, 2) + '\n');
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const secret = JSON.parse(raw);
raw = '';
const cfg = JSON.parse(await readFile(join(home, 'studio.json'), 'utf8'));
assert.equal(cfg.database.mode, 'managed');
let csrf = '';
const base = 'http://127.0.0.1:4310/api';
async function api(path, body) {
  const r = await fetch(`${base}/${path}`, {
    headers: {
      Cookie: `creator_session=${secret.session.token}`,
      ...(body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
        : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert.ok(r.ok, `Studio API ${r.status}: ${data.error?.message ?? 'failed'}`);
  return data;
}
const session = await api('auth/session');
assert.equal(session.authenticated, true);
csrf = session.csrf_token;
const { sign_in_attempt: _, ...detailRaw } = await api(
  `workspaces/${plan.workspace_id}/plan-connections/${plan.connection_id}`,
);
const detail = PlanConnectionDetailSchema.parse(detailRaw),
  conn = detail.connection;
assert.equal(conn.fixture, false);
assert.equal(
  conn.settings_hash,
  plan.proposed_settings_hash,
  'Saved settings differ from the reviewed existing settings; stop for review.',
);
assert.deepEqual(detail.blockers, []);
assert.equal(detail.usage.in_flight, 0);
assert.equal(detail.usage.unresolved, 0);
assert.ok(
  conn.settings.caps.shared.max_model_requests_per_day -
    detail.usage.last_24h_requests >=
    18,
  'Insufficient remaining studio daily allowance.',
);
for (const m of manifests)
  assert.ok(
    !detail.qualifications.some(
      (q) =>
        q.task_class === m.task_class &&
        q.model_id === plan.model_id &&
        q.manifest_hash === canonicalHash(m),
    ),
    'This frozen v2 manifest was already attempted; do not repeat as fresh evidence.',
  );
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: cfg.database.port,
  database: cfg.database.name,
  user: cfg.database.user,
  password: secret.database_password,
  max: 2,
});
delete secret.database_password;
const store = new ConnectionStore(pool),
  service = new PlanConnectionService({
    store,
    vault: new DpapiVault(join(home, 'plan-credentials')),
  });
const ctx = { actorId: session.actor_id, correlationId: randomUUID() },
  results = [],
  decisions = [];
let attempted = 0,
  qid = null;
const deadline = Date.now() + frozen.limits.max_wall_ms;
try {
  await pool
    .query('select 1 from schema_migrations where version=27')
    .then((r) => assert.equal(r.rowCount, 1, 'Migration 27 is required.'));
  await writeFile(new URL('run.lock', dir), new Date().toISOString(), {
    flag: 'wx',
  });
  await save('execution-intent.json', {
    approved_plan_hash: canonicalHash(plan),
    started_at: new Date().toISOString(),
    workspace_id: conn.workspace_id,
    connection_id: conn.id,
    model_id: plan.model_id,
    max_new_requests: 18,
    retries: 0,
  });
  for (const manifest of manifests) {
    assert.ok(Date.now() < deadline, 'Total qualification wall limit reached.');
    const { sign_in_attempt: __, ...currentRaw } = await api(
      `workspaces/${plan.workspace_id}/plan-connections/${conn.id}`,
    );
    const current = PlanConnectionDetailSchema.parse(currentRaw);
    const q = await api(
      `workspaces/${plan.workspace_id}/plan-connections/${conn.id}/qualifications`,
      {
        expected_version: current.connection.version,
        model_id: plan.model_id,
        manifest,
        min_held_out_cases: 4,
        floor: { numerator: 1, denominator: 1 },
      },
    );
    qid = q.id;
    const saved = await store.planQualificationManifest(
      ctx,
      plan.workspace_id,
      qid,
    );
    assert.equal(saved.attempted_cases.length, 0);
    assert.equal(canonicalHash(saved.manifest), canonicalHash(manifest));
    for (const c of manifest.cases) {
      assert.ok(
        attempted < 18 && Date.now() < deadline,
        'Frozen request/wall limit reached.',
      );
      attempted++;
      let signal = null;
      const result = await service.invoke(ctx, plan.workspace_id, {
        connection_id: conn.id,
        purpose: 'qualification',
        model_id: plan.model_id,
        task_class: manifest.task_class,
        data_class: 'synthetic',
        run_id: null,
        qualification_id: qid,
        qualification_case: { case_id: c.case_id, split: c.split },
        instructions: c.input
          .filter((m) => m.role === 'system')
          .map((m) => m.text)
          .join('\n\n'),
        input: c.input
          .filter((m) => m.role === 'user')
          .map((m) => m.text)
          .join('\n\n'),
        timeout_ms: Math.max(1, Math.min(120000, deadline - Date.now())),
        max_output_chars: 16000,
        score: (text, outcome) => {
          let json = null;
          try {
            if (text !== null) json = JSON.parse(text);
          } catch {
            signal = 'schema_invalid';
            return signal;
          }
          signal = checkOutput(c.check, text === null ? null : { text, json }, {
            succeeded: outcome.kind === 'completed',
            reason_code:
              outcome.kind === 'completed' ? 'ok' : outcome.reason_code,
          });
          return signal;
        },
      });
      results.push({
        task_class: manifest.task_class,
        case_id: c.case_id,
        split: c.split,
        signal,
        ...result,
      });
      await save('raw-results.json', results);
      await save('substantive-review.json', {
        state: 'required_not_performed',
        qualification_scope: 'automated_operational_contract_only',
        outputs: results.map((r) => ({
          case_id: r.case_id,
          request_id: r.request_id,
          output_hash:
            r.outcome.kind === 'completed' ? r.outcome.output_hash : null,
          reviewer: null,
          result: 'not_reviewed',
          findings: [],
        })),
      });
      console.log(
        JSON.stringify({
          case_id: c.case_id,
          task_class: manifest.task_class,
          attempted,
          max: 18,
          outcome: result.outcome.kind,
          signal,
        }),
      );
      if (result.outcome.kind !== 'completed' || signal !== 'accepted') {
        if (result.outcome.kind !== 'unknown')
          decisions.push(
            await store.finishPlanQualification(ctx, plan.workspace_id, qid),
          );
        throw new Error(
          'Qualification stopped at first unsuccessful case; no retry or other task class started.',
        );
      }
    }
    const decision = await store.finishPlanQualification(
      ctx,
      plan.workspace_id,
      qid,
    );
    decisions.push(decision);
    await save('decisions.json', decisions);
    assert.equal(decision.state, 'qualified');
  }
  await save('result.json', {
    substantive_review: 'required_not_performed',
    operational_contract_only: true,
    finished_at: new Date().toISOString(),
    attempted,
    decisions,
    execution_plan_hash: canonicalHash(plan),
  });
} catch (e) {
  await save('stopped.json', {
    at: new Date().toISOString(),
    attempted,
    qualification_id: qid,
    message: e.message,
  });
  throw e;
} finally {
  await pool.end();
}
