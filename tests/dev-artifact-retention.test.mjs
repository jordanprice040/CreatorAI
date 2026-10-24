import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROOT,
  MARKER,
  LOCK,
  applyCleanup,
  assertSafeRoot,
  createOwnedRun,
  planCleanup,
} from '../scripts/dev-artifact-retention.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLI = join(ROOT, 'scripts/dev-artifact-retention.mjs');

// Every test gets a disposable verification root and a fake repo whose
// tracking/docs folders form the evidence reference corpus.
async function sandbox(t) {
  const base = await mkdtemp(join(tmpdir(), 'creator-retention-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'verification');
  const repoRoot = join(base, 'repo');
  await mkdir(root);
  await mkdir(join(repoRoot, 'tracking'), { recursive: true });
  await mkdir(join(repoRoot, 'docs'));
  const opts = { root, repoRoot };
  const run = async (prefix = 'demo') => {
    const r = await createOwnedRun({
      root,
      prefix,
      owner: 'retention-test',
      repoRoot,
    });
    await writeFile(join(r.dir, 'payload.txt'), 'synthetic');
    return r;
  };
  return { base, root, repoRoot, opts, run };
}

// Moves a run's timestamps into the past without touching anything else.
async function age(dir, ms) {
  const file = join(dir, MARKER);
  const m = JSON.parse(await readFile(file, 'utf8'));
  const shift = (v) => (v ? new Date(Date.parse(v) - ms).toISOString() : v);
  await writeFile(
    file,
    JSON.stringify({
      ...m,
      createdAt: shift(m.createdAt),
      heartbeatAt: shift(m.heartbeatAt),
      finishedAt: shift(m.finishedAt),
    }),
  );
}

const byName = (plan) =>
  Object.fromEntries(plan.entries.map((e) => [e.name, e]));

function deadPid() {
  const child = spawnSync(process.execPath, ['-e', '0']);
  return child.pid;
}

test('unmarked, foreign-marked, linked and file entries are never touched', async (t) => {
  const { base, root, opts } = await sandbox(t);
  const outside = join(base, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'operational');
  await mkdir(join(root, 'theme-helper-v4-1792840348382'));
  await writeFile(
    join(root, 'theme-helper-v4-1792840348382', 'context.json'),
    '{}',
  );
  await writeFile(join(root, 'loose.log'), 'x');
  await symlink(outside, join(root, 'linked-run'), 'junction');
  // A real marker copied into another directory does not grant ownership.
  const owned = await createOwnedRun({
    root,
    prefix: 'demo',
    owner: 't',
    repoRoot: opts.repoRoot,
  });
  await owned.finish('passed');
  await mkdir(join(root, 'copied-run'));
  await writeFile(
    join(root, 'copied-run', MARKER),
    await readFile(join(owned.dir, MARKER)),
  );

  const result = await applyCleanup({ ...opts, at: Date.now() + 365 * DAY });
  const e = byName(result);
  assert.equal(e['theme-helper-v4-1792840348382'].reason, 'unmarked');
  assert.equal(e['loose.log'].reason, 'not-directory');
  assert.equal(e['linked-run'].reason, 'link');
  assert.equal(e['copied-run'].reason, 'marker-names-other-directory');
  assert.equal(e[owned.runId].reason, 'passed-latest');
  assert.ok(result.entries.every((x) => x.action === 'keep'));
  assert.equal(
    await readFile(join(outside, 'keep.txt'), 'utf8'),
    'operational',
  );
  assert.ok(
    existsSync(join(root, 'theme-helper-v4-1792840348382', 'context.json')),
  );
});

test('active runs are kept while alive; abandoned ones follow failure retention', async (t) => {
  const { root, opts, run } = await sandbox(t);
  const alive = await run();
  await age(alive.dir, 30 * DAY); // stale heartbeat, but this process is alive
  const abandoned = await run();
  const file = join(abandoned.dir, MARKER);
  const m = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...m, pid: deadPid() }));
  await age(abandoned.dir, 2 * DAY);
  const fresh = await run();
  await writeFile(
    join(fresh.dir, MARKER),
    JSON.stringify({
      ...JSON.parse(await readFile(join(fresh.dir, MARKER), 'utf8')),
      pid: deadPid(),
    }),
  );

  let e = byName(await planCleanup(opts));
  assert.equal(e[alive.runId].reason, 'active');
  assert.equal(e[fresh.runId].reason, 'active'); // recent heartbeat
  assert.equal(e[abandoned.runId].reason, 'failed-diagnostics-latest');

  // Far past every window, only the abandoned-but-not-latest run could go;
  // the live run stays regardless of age.
  const later = Date.now() + 60 * DAY;
  const result = await applyCleanup({
    ...opts,
    at: later,
    policy: { ...policyNoLatest },
  });
  e = byName(result);
  assert.equal(e[alive.runId].reason, 'active');
  assert.equal(e[abandoned.runId].action, 'deleted');
  assert.ok(existsSync(alive.dir));
  assert.ok(!existsSync(abandoned.dir));
  assert.ok(
    (await readdir(root)).every((n) => !n.startsWith('.creator-dev-deleting-')),
  );
});

const policyNoLatest = {
  passedRetentionHours: 24,
  failedRetentionDays: 14,
  keepLatestPassed: 0,
  keepLatestFailed: 0,
  staleActiveHours: 24,
};

test('passed runs expire after the window but the latest per prefix is kept', async (t) => {
  const { opts, run } = await sandbox(t);
  const old = await run();
  await old.finish('passed');
  await age(old.dir, 3 * DAY);
  const recent = await run();
  await recent.finish('passed');
  await age(recent.dir, 2 * HOUR);
  const latest = await run();
  await latest.finish('passed');
  const other = await run('other');
  await other.finish('passed');
  await age(other.dir, 10 * DAY);

  const dry = byName(await planCleanup(opts));
  assert.equal(dry[old.runId].action, 'delete');
  assert.equal(dry[recent.runId].reason, 'passed-within-retention');
  assert.equal(dry[latest.runId].reason, 'passed-latest');
  assert.equal(dry[other.runId].reason, 'passed-latest');
  assert.ok(existsSync(old.dir), 'planning alone deletes nothing');

  const applied = byName(await applyCleanup(opts));
  assert.equal(
    applied[old.runId].action,
    'deleted',
    JSON.stringify(applied[old.runId]),
  );
  assert.ok(!existsSync(old.dir));
  for (const r of [recent, latest, other]) assert.ok(existsSync(r.dir));
});

test('failed diagnostics are kept for the retention window and the latest two', async (t) => {
  const { opts, run } = await sandbox(t);
  const runs = [];
  for (const ageDays of [40, 30, 20, 5]) {
    const r = await run();
    await r.finish('failed');
    await age(r.dir, ageDays * DAY);
    runs.push(r);
  }
  const e = byName(await applyCleanup(opts));
  assert.equal(e[runs[3].runId].reason, 'failed-diagnostics-latest');
  assert.equal(e[runs[2].runId].reason, 'failed-diagnostics-latest');
  assert.equal(e[runs[1].runId].action, 'deleted');
  assert.equal(e[runs[0].runId].action, 'deleted');

  const r = await run();
  await r.finish('failed');
  await age(r.dir, 3 * DAY);
  const within = byName(await planCleanup({ ...opts, policy: policyNoLatest }));
  assert.equal(within[r.runId].reason, 'failed-diagnostics-within-retention');
});

test('protected, evidence-referenced and link-containing runs are kept', async (t) => {
  const { base, repoRoot, opts, run } = await sandbox(t);
  const recovery = await run();
  await recovery.finish('failed');
  await recovery.protect('recovery material for interrupted install');
  const cited = await run();
  await cited.finish('passed');
  await writeFile(
    join(repoRoot, 'tracking', 'receipt.json'),
    JSON.stringify({
      evidence: `.verification/${cited.runId}/test-summary.json`,
    }),
  );
  const target = join(base, 'linked-target');
  await mkdir(target);
  await writeFile(join(target, 'secret.txt'), 'outside');
  const linked = await run();
  await mkdir(join(linked.dir, 'nested'));
  await symlink(target, join(linked.dir, 'nested', 'escape'), 'junction');
  await linked.finish('passed');
  for (const r of [recovery, cited, linked]) await age(r.dir, 90 * DAY);

  const e = byName(await applyCleanup({ ...opts, policy: policyNoLatest }));
  assert.equal(e[recovery.runId].reason, 'protected');
  assert.equal(e[cited.runId].reason, 'referenced-evidence');
  assert.equal(e[linked.runId].action, 'keep');
  assert.equal(e[linked.runId].reason, 'contains-link');
  for (const r of [recovery, cited, linked]) assert.ok(existsSync(r.dir));
  assert.equal(await readFile(join(target, 'secret.txt'), 'utf8'), 'outside');
});

test('cleanup refuses while another cleanup holds the lock', async (t) => {
  const { root, opts, run } = await sandbox(t);
  const r = await run();
  await r.finish('passed');
  await age(r.dir, 10 * DAY);
  await writeFile(join(root, LOCK), '{}');
  await assert.rejects(
    applyCleanup({ ...opts, policy: policyNoLatest }),
    /Cleanup lock held/,
  );
  assert.ok(existsSync(r.dir));
});

test('broad, linked, relative and operational roots are refused', async (t) => {
  const { base, repoRoot } = await sandbox(t);
  const real = join(base, 'real');
  await mkdir(real);
  await symlink(real, join(base, 'alias'), 'junction');
  for (const root of [
    ROOT,
    homedir(),
    tmpdir(),
    join(ROOT, '..'),
    join(base, 'alias'),
  ])
    await assert.rejects(assertSafeRoot(root), /Refusing/, root);
  await assert.rejects(assertSafeRoot('.verification'), /absolute/);
  await assert.rejects(
    assertSafeRoot(repoRoot, { repoRoot }),
    /Refusing broad root/,
  );
  if (process.env.APPDATA)
    await assert.rejects(
      assertSafeRoot(process.env.APPDATA),
      /Refusing root inside APPDATA/,
    );
  await assert.rejects(
    createOwnedRun({ root: real, prefix: '../x', owner: 't' }),
    /prefix/,
  );
});

test('the CLI is a dry run unless --apply is given', async (t) => {
  const { root, run } = await sandbox(t);
  const r = await run();
  await r.finish('passed');
  await age(r.dir, 10 * DAY);
  const extra = await run();
  await extra.finish('passed');
  const dry = JSON.parse(
    execFileSync(process.execPath, [CLI, '--root', root], { encoding: 'utf8' }),
  );
  assert.equal(dry.mode, 'dry-run');
  assert.equal(byName(dry)[r.runId].action, 'delete');
  assert.ok(existsSync(r.dir));
  const out = JSON.parse(
    execFileSync(process.execPath, [CLI, '--root', root, '--apply'], {
      encoding: 'utf8',
    }),
  );
  assert.equal(out.mode, 'apply');
  assert.equal(byName(out)[r.runId].action, 'deleted');
  assert.ok(!existsSync(r.dir));
  assert.ok(existsSync(extra.dir));
});
