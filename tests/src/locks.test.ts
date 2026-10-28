import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockHolder, withLock } from '@creator/executor';

// ADR-0046 Recover: who holds a product-store lock. Recover releases only 'dead' locks.
test('lock holders: own locks by live token, others by liveness and boot, empty locks by age', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-locks-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lock = join(dir, 'supervisor.lock');
  const now = Date.now();

  // While this process holds it, its own lock is held; afterwards it is gone.
  await withLock(dir, async () => {
    const raw = await readFile(lock, 'utf8');
    assert.equal(lockHolder(raw, now), process.pid);
  });
  await assert.rejects(readFile(lock), /ENOENT/);

  // This process's number with a token it does not hold: stale, whatever the time says.
  const own = JSON.stringify({
    pid: process.pid,
    token: 'not-held',
    at: new Date().toISOString(),
  });
  assert.equal(lockHolder(own, now), 'dead');

  // Another live process: held, unless the lock is from before this boot.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  t.after(() => child.kill());
  const live = (at: string) =>
    JSON.stringify({ pid: child.pid, token: 'x', at });
  assert.equal(lockHolder(live(new Date().toISOString()), now), child.pid);
  assert.equal(lockHolder(live('2000-01-01T00:00:00Z'), now), 'dead');

  // Empty: being written while fresh, a crash once older than a minute.
  assert.equal(lockHolder('', now), 'writing');
  assert.equal(lockHolder('', now - 120_000), 'dead');

  // A holder whose lock was released and retaken by someone else leaves the new lock alone.
  await withLock(dir, async () => {
    await writeFile(lock, JSON.stringify({ pid: child.pid, token: 'other' }));
  });
  assert.match(await readFile(lock, 'utf8'), /other/);
});

// #69 review M-1: a same-process Recover must never judge a lock this process is taking or
// releasing as stale. A poller acts like Recover (judge, then rename if dead) throughout
// many lock lifetimes; it must never release one, and no lock holder may fail.
test('a lock this process is taking or releasing is never judged stale', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-locks-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lock = join(dir, 'supervisor.lock');
  let stolen = 0;
  for (let i = 0; i < 200; i++) {
    let done = false;
    const holder = withLock(dir, async () => {
      await new Promise((r) => setImmediate(r));
    }).finally(() => {
      done = true;
    });
    while (!done) {
      const raw = await readFile(lock, 'utf8').catch(() => null);
      if (raw !== null) {
        const st = await stat(lock).catch(() => null);
        // Like Recover, act only if the lock is unchanged since it was judged: a lock released
        // between the read and the judgement is gone, not stolen.
        if (
          st &&
          lockHolder(raw, st.mtimeMs) === 'dead' &&
          (await readFile(lock, 'utf8').catch(() => null)) === raw
        ) {
          stolen++;
          await rename(lock, `${lock}.dead-${i}`).catch(() => {});
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    await holder;
  }
  assert.equal(stolen, 0);
});
