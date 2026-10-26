// Independent v4 review probe: the real PowerShell wrapper must refuse missing, flat-only,
// wrong-version, linked and malformed PGDATA layouts before it reads or decrypts DPAPI.
// Uses a disposable root under ignored .verification; starts no PostgreSQL.
import assert from 'node:assert/strict';
import { mkdir, writeFile, lstat, symlink, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  command,
  save,
  bindings,
  listening,
} from '../../../scripts/theme-intent-upgrade-v4-core.mjs';

const bin = 'C:/Program Files/PostgreSQL/18/bin';
const root = join(ROOT, '.verification', 'theme-v4-review-presecret-' + Date.now());
const home = join(root, 'home');
const port = 55456;
const exists = (p) =>
  lstat(p).then(
    () => true,
    () => false,
  );
await mkdir(root);
await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
for (const p of [join(home, 'secrets'), join(home, 'plan-credentials'), join(root, 'products')])
  await mkdir(p, { recursive: true });
// Not a DPAPI blob: reaching Unprotect is observable as a CryptographicException.
await writeFile(join(home, 'secrets/postgres.dpapi'), 'not-a-dpapi-blob');
await writeFile(
  join(home, 'studio.json'),
  JSON.stringify({
    database: { mode: 'managed', user: 'postgres', name: 'helper_presecret', port },
    pg_bin: bin,
    products_root: join(root, 'products'),
  }),
);
const context = join(root, 'context.json');
await save(context, {
  format: 'theme-intent-helper-test-layout/4',
  root,
  home,
  install: join(root, 'program'),
  installer: join(root, 'fixture-installer.ps1'),
});
const review = join(root, 'review.json');
await save(review, {
  format: 'theme-intent-helper-simulated-review/4',
  status: 'fixture_only',
  prior_implementation_involvement: false,
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256: await bindings(),
});
async function reset() {
  for (const p of ['postgres', 'pg-target']) await rm(join(home, p), { recursive: true, force: true });
  await rm(join(root, 'pg-target'), { recursive: true, force: true });
  await mkdir(join(home, 'postgres'));
}
async function run(name, phase, extra = []) {
  const id = 'probe-' + randomUUID().slice(0, 8);
  const e = join(root, 'evidence-' + id);
  const r = await command(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      join(ROOT, 'scripts/upgrade-theme-intent-v4.ps1'),
      '-Phase',
      phase,
      '-EvidenceDir',
      e,
      '-SessionId',
      id,
      '-ReviewFile',
      review,
      '-TestContext',
      context,
      ...extra,
    ],
    { allowFailure: true, timeout: 120000 },
  );
  const err = r.stderr;
  return {
    name,
    phase,
    exit_code: r.code,
    presecret_refusal: /Pre-secret review\/identity\/path\/decision checks failed/.test(err),
    reached_dpapi: /Unprotect|Cryptographic|ReadAllBytes/.test(err),
    error_line: (err.match(/^(AssertionError[^\r\n]*|Error: [^\r\n]*)/m) || [null])[0],
    expected_message: /Expected desktop postgres\/data directory/.test(err),
    nested_path_in_error: /postgres\\data/.test(err),
    evidence_created: await exists(e),
    lease_created: await exists(join(home, 'theme-intent-v4.lock')),
    backup_created: await exists(join(home, 'backups', 'theme-intent-v4-' + id)),
    listening: await listening(port),
  };
}
const results = [];
await reset();
await writeFile(join(home, 'postgres', 'PG_VERSION'), '18\n');
results.push(await run('missing nested, valid flat PG_VERSION', 'before'));
await reset();
await mkdir(join(home, 'postgres', 'data'));
await writeFile(join(home, 'postgres', 'data', 'PG_VERSION'), '17\n');
results.push(await run('nested PG_VERSION 17', 'before'));
await reset();
await mkdir(join(home, 'postgres', 'data'));
results.push(await run('nested directory without PG_VERSION', 'before'));
await reset();
await writeFile(join(home, 'postgres', 'data'), 'not a directory');
results.push(await run('nested data is a file', 'before'));
await reset();
await mkdir(join(root, 'pg-target'));
await writeFile(join(root, 'pg-target', 'PG_VERSION'), '18\n');
await symlink(join(root, 'pg-target'), join(home, 'postgres', 'data'), 'junction');
results.push(await run('nested data is a junction', 'before'));
await rm(join(home, 'postgres'), { recursive: true, force: true });
await rm(join(root, 'pg-target'), { recursive: true, force: true });
await mkdir(join(root, 'pg-target', 'data'), { recursive: true });
await writeFile(join(root, 'pg-target', 'data', 'PG_VERSION'), '18\n');
await symlink(join(root, 'pg-target'), join(home, 'postgres'), 'junction');
results.push(await run('postgres parent is a junction', 'before'));
await rm(join(home, 'postgres'), { recursive: true, force: true });
await reset();
await writeFile(join(home, 'postgres', 'PG_VERSION'), '18\n');
const stale = join(root, 'stale-dummy.json');
await save(stale, { format: 'not-a-decision' });
results.push(await run('release with missing nested layout', 'release', ['-StaleDecisionFile', stale]));
await reset();
await mkdir(join(home, 'postgres', 'data'));
await writeFile(join(home, 'postgres', 'data', 'PG_VERSION'), '18\n');
results.push(await run('control: valid nested layout reaches DPAPI', 'before'));
const negative = results.slice(0, -1);
for (const r of negative) {
  assert.notEqual(r.exit_code, 0, r.name);
  assert.ok(r.presecret_refusal, r.name);
  assert.ok(!r.reached_dpapi, r.name);
  assert.ok(!r.evidence_created && !r.lease_created && !r.backup_created && !r.listening, r.name);
}
const control = results.at(-1);
assert.notEqual(control.exit_code, 0);
assert.ok(!control.presecret_refusal && control.reached_dpapi, 'control must pass the gate and reach DPAPI');
assert.ok(!control.evidence_created && !control.lease_created && !control.backup_created);
const out = {
  format: 'theme-intent-v4-review-presecret-probe/1',
  at: new Date().toISOString(),
  root,
  port_never_listening: port,
  results,
  remaining_entries: (await readdir(root)).sort(),
};
await rm(root, { recursive: true, force: true });
out.root_removed = !(await exists(root));
console.log(JSON.stringify(out, null, 2));
