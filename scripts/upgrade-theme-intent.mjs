// No default action. --check never reads operational configuration or credentials.
import assert from 'node:assert/strict';
import { mkdir, readFile, cp, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalHash } from '../packages/domain/dist/index.js';
import {
  CANDIDATE,
  PLAN,
  read,
  hash,
  save,
  child,
  files,
  copyVerified,
  program,
  fresh,
  approval,
  preserved,
  state,
  dumpSnapshot,
  helperHashes,
  reviewed,
} from './theme-intent-upgrade-core.mjs';

const phase = process.argv[2];
assert.ok(['--check', 'before', 'admit', 'migrate', 'after'].includes(phase));
const base = 'tracking/evidence/theme-intent-package-2026-10-23/';
const plan = await read(base + 'installation-plan.json'),
  candidate = await read(base + 'candidate-plan.json');
assert.equal(canonicalHash(plan), PLAN);
assert.equal(canonicalHash(candidate), CANDIDATE);
const review = await read(
  'tracking/evidence/theme-intent-package-review-2026-10-23/reviewer-receipt.json',
);
assert.equal(review.status, 'supported_exact_package_and_declarative_plan');
assert.equal(review.candidate_plan_hash, CANDIDATE);
assert.equal(review.installation_plan_hash, PLAN);
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
for (const [p, h] of Object.entries(candidate.source_sha256))
  assert.equal(await hash(p), h, p);
assert.equal(await hash(plan.installer_path), plan.installer_sha256);
assert.equal(
  await hash(plan.rollback.previous_installer_path),
  plan.rollback.previous_installer_sha256,
);
await program(candidate.extracted_payload_dir, plan, true);
assert.equal(
  await hash(candidate.archived_bundle_dir + '/bundle-manifest.json'),
  plan.expected_target_manifest_sha256,
);
for (const f of (
  await read(candidate.archived_bundle_dir + '/bundle-manifest.json')
).files)
  assert.equal(
    await hash(child(candidate.archived_bundle_dir, f.path)),
    f.sha256,
  );
if (phase === '--check') {
  console.log(
    'Exact package/plan/review and all runtime bytes verified; no operational access.',
  );
  process.exit(0);
}
const d = process.argv[3];
assert.ok(d, 'New evidence directory required');
const home = plan.studio_home,
  install = plan.target_install_dir;
// Admission is deliberately required before reading secrets for any mutation-related phase.
let auth;
if (phase !== 'before') {
  auth = await read(process.argv[4]);
  approval(auth, await hash(join(d, 'prepared.json')));
  await reviewed(auth.helper_review_path);
  const prepared = await read(join(d, 'prepared.json'));
  assert.equal(prepared.candidate_plan_hash, CANDIDATE);
  assert.equal(prepared.installation_plan_hash, PLAN);
  assert.deepEqual(prepared.helper_sha256, await helperHashes());
  fresh(prepared.prepared_at);
}
const run = promisify(execFile);
async function quit() {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'creator-desktop.exe' -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'studio[.]mjs|orchestrator|pilot-main')) }).Count",
    ],
    { windowsHide: true },
  );
  assert.equal(stdout.trim(), '0', 'Fully quit studio and workers first');
}
await quit();
if (process.argv.includes('--presecret')) {
  console.log('Pre-secret identity, approval and process gates passed.');
  process.exit(0);
}
const cfg = await read(join(home, 'studio.json'));
assert.equal(cfg.database.mode, 'managed');
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: cfg.database.port,
  database: cfg.database.name,
  user: cfg.database.user,
  password: secret.password,
  max: 1,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});
const snapshot = () =>
  state(pool, home, cfg.products_root, phase === 'after' ? 29 : 28);
async function backups() {
  const b = await read(join(d, 'backup.json'));
  assert.equal(b.schema, 28);
  fresh(b.created_at);
  for (const [name, tree] of Object.entries(b.trees))
    assert.deepEqual(await files(join(d, name)), tree);
  assert.equal(await hash(join(d, 'database.dump')), b.dump_sha256);
  await run(
    join(cfg.pg_bin, 'pg_restore.exe'),
    ['--list', join(d, 'database.dump')],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  return b;
}
try {
  if (phase === 'before') {
    await program(install, plan);
    await mkdir(d); // Refuse reuse, partial attempts and accidental overwrite.
    const before = await snapshot();
    await save(join(d, 'before.json'), before);
    const trees = {
      program: await copyVerified(install, join(d, 'program')),
      products: await copyVerified(cfg.products_root, join(d, 'products')),
    };
    await mkdir(join(d, 'protected'));
    await cp(join(home, 'studio.json'), join(d, 'protected/studio.json'), {
      force: false,
      errorOnExist: true,
    });
    for (const name of ['secrets', 'plan-credentials'])
      await copyVerified(join(home, name), join(d, 'protected', name));
    trees.protected = await files(join(d, 'protected'));
    // Same PostgreSQL custom archive + TOC checks as supported preMigrationBackup.
    // Use a frozen read snapshot, and reject any state change before admitting installation.
    await dumpSnapshot(pool, cfg, secret.password, join(d, 'database.dump'));
    await save(join(d, 'backup.json'), {
      format: 'theme-intent-upgrade-backup/1',
      schema: 28,
      created_at: new Date().toISOString(),
      dump_sha256: await hash(join(d, 'database.dump')),
      trees,
      restore_rehearsed: false,
    });
    await backups();
    preserved(before, await snapshot(), 28);
    await quit();
    await save(join(d, 'prepared.json'), {
      format: 'theme-intent-upgrade-prepared/1',
      prepared_at: new Date().toISOString(),
      candidate_plan_hash: CANDIDATE,
      installation_plan_hash: PLAN,
      helper_sha256: await helperHashes(),
      before_sha256: await hash(join(d, 'before.json')),
      backup_sha256: await hash(join(d, 'backup.json')),
      installed: false,
      migrated: false,
      provider_calls: 0,
    });
  } else {
    const prepared = await read(join(d, 'prepared.json'));
    assert.equal(await hash(join(d, 'before.json')), prepared.before_sha256);
    assert.equal(await hash(join(d, 'backup.json')), prepared.backup_sha256);
    const verifiedBackup = await backups();
    const before = await read(join(d, 'before.json'));
    preserved(before, await snapshot(), phase === 'after' ? 29 : 28);
    await program(install, plan, phase !== 'admit');
    await quit();
    if (phase === 'admit') {
      assert.deepEqual(await files(install), verifiedBackup.trees.program);
      approval(auth, await hash(join(d, 'prepared.json')));
      const lock = await open(join(d, 'installation.lock'), 'wx');
      await lock.close();
      await save(join(d, 'admission.json'), {
        at: new Date().toISOString(),
        approval_sha256: await hash(process.argv[4]),
        prepared_sha256: await hash(join(d, 'prepared.json')),
      });
    } else if (phase === 'migrate') {
      approval(auth, await hash(join(d, 'prepared.json')));
      const outcome = await read(join(d, 'installer-outcome.json'));
      assert.equal(outcome.exit_code, 0);
      assert.equal(outcome.installer_sha256, plan.installer_sha256);
      const admission = await read(join(d, 'admission.json'));
      assert.equal(admission.approval_sha256, await hash(process.argv[4]));
      fresh(admission.at);
      const lock = await open(join(d, 'migration.lock'), 'wx');
      await lock.close();
      const payload = {
        protocol: 'creator-studio/1',
        database_url: `postgresql://${encodeURIComponent(cfg.database.user)}:${encodeURIComponent(secret.password)}@127.0.0.1:${cfg.database.port}/${encodeURIComponent(cfg.database.name)}`,
        products_root: cfg.products_root,
        backups_dir: join(home, 'backups'),
        pg_bin: cfg.pg_bin,
        web_root: null,
        owner_secret: null,
        login_code: null,
        worker_distro: null,
        source: null,
      };
      const proc = spawn(
        join(install, 'studio/node/node.exe'),
        [join(install, 'studio/service/app/dist/studio.mjs'), 'migrate'],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      let out = '';
      proc.stdout.on('data', (c) => {
        out += c;
      });
      proc.stderr.resume();
      proc.stdin.end(JSON.stringify(payload) + '\n');
      const code = await new Promise((ok, fail) => {
        proc.once('error', fail);
        proc.once('exit', ok);
      });
      assert.equal(
        code,
        0,
        'Migration failed; preserve lock and recover explicitly',
      );
      const result = out
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .find((e) => e.event === 'result')?.result;
      assert.equal(result.from, 28);
      assert.equal(result.to, 29);
      assert.deepEqual(result.applied, [29]);
      assert.equal(
        await hash(join(result.backup.dir, 'database.dump')),
        result.backup.database.sha256,
      );
      await save(join(d, 'migration-result.json'), result);
    } else {
      const result = await read(join(d, 'migration-result.json'));
      assert.equal(result.from, 28);
      assert.equal(result.to, 29);
      assert.deepEqual(result.applied, [29]);
      await save(join(d, 'after.json'), await snapshot());
      await save(join(d, 'verification.json'), {
        candidate_plan_hash: CANDIDATE,
        installation_plan_hash: PLAN,
        schema: 29,
        records_preserved: true,
        program_verified: true,
        provider_calls: 0,
        installed_ui_acceptance: false,
      });
    }
  }
  console.log(JSON.stringify({ phase, passed: true, provider_calls: 0 }));
} finally {
  delete secret.password;
  await pool.end();
}
