// --check is offline. --run requires an exact plan hash AND completed separate review.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
import { canonicalHash, checkOutput } from '../packages/domain/dist/index.js';
import {
  checkFollowup,
  assertRunnerReview,
  assertInstallation,
  assertInstalledFiles,
  assertConnectionReady,
  verifyHashes,
  FOLLOWUP_DIR,
} from './check-discovery-research-runner.mjs';
import {
  executeFollowup,
  FOLLOWUP_LIMITS,
} from './discovery-research-core.mjs';

const { plan, planBytes, frozen, manifests } = await checkFollowup();
const mode = process.argv[2];
if (mode === '--check') {
  console.log(
    JSON.stringify({
      state: 'prepared_only',
      cases: 6,
      controls: frozen.local_controls,
      execution_plan_hash: canonicalHash(plan),
      live_calls: 0,
    }),
  );
  process.exit(0);
}
assert.ok(
  ['--run', '--review-check', '--execution-check'].includes(mode),
  'Use --check, or the explicitly approved --run mode.',
);
const home = process.argv[3];
assert.equal(
  process.argv[4],
  canonicalHash(plan),
  'Exact executable-plan approval hash required; old approvals are not reusable.',
);
const reviewBytes = await readFile(process.argv[5]);
const review = JSON.parse(reviewBytes);
assertRunnerReview(review, plan, planBytes);
await verifyHashes(review.artifact_sha256);
if (mode === '--review-check') {
  console.log(
    'Static plan and separate review gates passed; no credentials or live calls.',
  );
  process.exit(0);
}
assert.equal(
  home,
  plan.studio_home,
  'StudioHome must match plan before secrets',
);
const installation = JSON.parse(await readFile(process.argv[6], 'utf8'));
assertInstallation(installation, plan);
await assertInstalledFiles(plan);
if (mode === '--execution-check') {
  console.log(
    'Static home/installation/review gates passed; no secrets or live calls.',
  );
  process.exit(0);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const write = (name, value) =>
  writeFile(FOLLOWUP_DIR + name, JSON.stringify(value, null, 2) + '\n');
const deadline = Date.now() + FOLLOWUP_LIMITS.max_wall_ms;
const abort = new AbortController();
const timer = setTimeout(
  () => abort.abort(new Error('Total qualification deadline')),
  FOLLOWUP_LIMITS.max_wall_ms,
);
const cancel = () => abort.abort(new Error('Owner cancellation'));
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
let pool,
  locked = false;
try {
  assert.equal(
    sha(await readFile(join(plan.install_dir, 'studio/bundle-manifest.json'))),
    plan.bundle_manifest_sha256,
  );
  assert.equal(
    sha(await readFile(join(plan.install_dir, 'creator-desktop.exe'))),
    plan.desktop_payload_sha256,
    'Installed packaged executable changed.',
  );
  const installed = JSON.parse(
    await readFile(
      join(plan.install_dir, 'studio/bundle-manifest.json'),
      'utf8',
    ),
  );
  for (const f of installed.files) {
    assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
    assert.equal(
      sha(await readFile(join(plan.install_dir, 'studio', f.path))),
      f.sha256,
      f.path,
    );
  }
  // stdin only: wrapper decrypts secrets under the authorized owner account.
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const secret = JSON.parse(raw);
  raw = '';
  const cfg = JSON.parse(await readFile(join(home, 'studio.json'), 'utf8'));
  assert.equal(cfg.database.mode, 'managed');
  let csrf;
  const api = async (path, body) => {
    assert.ok(
      !abort.signal.aborted && Date.now() < deadline,
      'Stopped before API operation.',
    );
    const r = await fetch('http://127.0.0.1:4310/api/' + path, {
      headers: {
        Cookie: `creator_session=${secret.session.token}`,
        ...(body
          ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
          : {}),
      },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(Math.min(15000, deadline - Date.now())),
      ]),
    });
    assert.ok(r.ok, `Studio API ${r.status}; stop without retry.`);
    return r.json();
  };
  const session = await api('auth/session');
  assert.equal(session.authenticated, true);
  csrf = session.csrf_token;
  const path = `workspaces/${plan.workspace_id}/plan-connections/${plan.connection_id}`;
  const detail = async (remaining) => {
    const { sign_in_attempt, ...rawDetail } = await api(path);
    const d = PlanConnectionDetailSchema.parse(rawDetail);
    assertConnectionReady(d, plan, remaining);
    return d;
  };
  const first = await detail(6);
  for (const manifest of manifests)
    assert.ok(
      !first.qualifications.some(
        (q) =>
          q.model_id === plan.model_id &&
          q.manifest_hash === canonicalHash(manifest),
      ),
      'Frozen followup already attempted.',
    );
  const require = createRequire(
    new URL('../packages/db/package.json', import.meta.url),
  );
  const { Pool } = require('pg');
  pool = new Pool({
    host: '127.0.0.1',
    port: cfg.database.port,
    database: cfg.database.name,
    user: cfg.database.user,
    password: secret.database_password,
    max: 2,
    statement_timeout: 15000,
    connectionTimeoutMillis: 15000,
  });
  delete secret.database_password;
  const { ConnectionStore } = await import('../packages/db/dist/index.js');
  const { DpapiVault, PlanConnectionService } =
    await import('../packages/broker/dist/index.js');
  const store = new ConnectionStore(pool);
  const service = new PlanConnectionService({
    store,
    vault: new DpapiVault(join(home, 'plan-credentials')),
  });
  const ctx = { actorId: session.actor_id, correlationId: randomUUID() };
  const idle = async () => {
    assert.equal(
      (await pool.query('select max(version)::int as n from schema_migrations'))
        .rows[0].n,
      plan.required_schema,
    );
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from workflow_tasks where state='leased'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from workflows where state not in ('succeeded','failed','cancelled')",
        )
      ).rows[0].n,
      0,
    );
  };
  await idle();
  // Concurrent read-only preflights may race; only one can acquire this lock.
  // No qualification creation/provider delivery occurs before exclusive admission.
  await writeFile(
    FOLLOWUP_DIR + 'run.lock',
    JSON.stringify({
      plan_hash: canonicalHash(plan),
      started_at: new Date().toISOString(),
    }) + '\n',
    { flag: 'wx' },
  );
  locked = true;
  await write('execution-intent.json', {
    plan_hash: canonicalHash(plan),
    review_sha256: sha(reviewBytes),
    started_at: new Date().toISOString(),
    max_new_requests: 6,
    retries: 0,
  });
  const decisions = [];
  const result = await executeFollowup({
    manifests,
    signal: abort.signal,
    journal: async (event) => {
      if (event.kind === 'intent')
        await write('last-dispatch-intent.json', event);
      if (event.kind === 'outcome') {
        await write('raw-results.json', event.results);
        await write('substantive-review.json', {
          state: 'required_not_performed',
          outputs: event.results.map((r) => ({
            case_id: r.case_id,
            request_id: r.request_id,
            output_hash: r.outcome.output_hash ?? null,
            reviewer: null,
            result: 'not_reviewed',
            findings: [],
          })),
        });
      }
      if (event.kind === 'decision') {
        decisions.push(event.decision);
        await write('decisions.json', decisions);
      }
    },
    adapter: {
      start: async (manifest, meta) => {
        const d = await detail(meta.remaining_requests);
        await idle();
        const q = await api(path + '/qualifications', {
          expected_version: d.connection.version,
          model_id: plan.model_id,
          manifest,
          min_held_out_cases: 4,
          floor: { numerator: 1, denominator: 1 },
        });
        const saved = await store.planQualificationManifest(
          ctx,
          plan.workspace_id,
          q.id,
        );
        assert.equal(saved.attempted_cases.length, 0);
        assert.equal(canonicalHash(saved.manifest), canonicalHash(manifest));
        return q.id;
      },
      invoke: async (manifest, c, qid, bounds) => {
        let signal = null;
        const outcome = await service.invoke(ctx, plan.workspace_id, {
          connection_id: plan.connection_id,
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
          ...bounds,
          timeout_ms: Math.max(
            1,
            Math.min(bounds.timeout_ms, deadline - Date.now()),
          ),
          score: (text, observation) => {
            let json = null;
            try {
              if (text !== null) json = JSON.parse(text);
            } catch {
              signal = 'schema_invalid';
              return signal;
            }
            signal = checkOutput(
              c.check,
              text === null ? null : { text, json },
              {
                succeeded: observation.kind === 'completed',
                reason_code:
                  observation.kind === 'completed'
                    ? 'ok'
                    : observation.reason_code,
              },
            );
            return signal;
          },
        });
        return { ...outcome, signal };
      },
      finish: (qid) =>
        store.finishPlanQualification(ctx, plan.workspace_id, qid),
    },
    // Count all preparation/API overhead against the original total deadline.
    deadlineAt: deadline,
  });
  await write('execution-outcome.json', {
    ...result,
    decisions,
    plan_hash: canonicalHash(plan),
    finished_at: new Date().toISOString(),
  });
} catch (e) {
  const stopped = {
    at: new Date().toISOString(),
    reason: e.message,
    no_retry: true,
    run_lock_acquired: locked,
  };
  if (locked) await write('stopped.json', stopped);
  else
    await writeFile(
      FOLLOWUP_DIR + `preflight-stopped-${randomUUID()}.json`,
      JSON.stringify(stopped, null, 2) + '\n',
      { flag: 'wx' },
    );
  throw e;
} finally {
  clearTimeout(timer);
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
  if (pool) await pool.end();
}
