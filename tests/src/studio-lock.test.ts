import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { takeStudioLock } from '@creator/db';
import { freshDatabase } from './pg-harness.js';

// ADR-0108, review 1 M-1: one studio per database, whatever ports each one uses.

test('the studio lock admits one holder per database, names it, and frees on release', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const first = await takeStudioLock(db.url, 'pnpm dev, web port 5274');
  assert.ok(first.held);
  t.after(() => (first.held ? first.lock.release() : undefined));
  const second = await takeStudioLock(db.url, 'desktop app');
  assert.equal(second.held, false);
  assert.match(
    second.held ? '' : second.message,
    /^Another Creator Agent studio is already running on this database \(pnpm dev, web port 5274\)\./,
  );
  await first.lock.release();
  const third = await takeStudioLock(db.url, 'desktop app');
  assert.ok(third.held);
  await third.lock.release();
});

const freePort = async () => {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address() as { port: number };
  await new Promise((r) => s.close(r));
  return port;
};

/** Starts `scripts/dev.mjs` on its own ports and resolves with its output once it settles. */
function devStudio(url: string, ports: number[]) {
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    windowsHide: true,
    env: {
      ...process.env,
      CREATOR_DATABASE_URL: url,
      CREATOR_API_PORT: String(ports[0]),
      CREATOR_PREVIEW_PORT: String(ports[1]),
      CREATOR_WEB_PORT: String(ports[2]),
      CREATOR_WORKER: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  const exited = once(child, 'exit');
  return {
    child,
    output: () => out,
    exited,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
    },
  };
}

test('a second dev studio on the same database is refused even on other ports (review 1 M-1 repro)', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const a = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => a.stop());
  const until = Date.now() + 60000;
  while (!/Sign-in/.test(a.output()) && Date.now() < until) {
    assert.equal(a.child.exitCode, null, a.output());
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(a.output(), /Sign-in/);
  // Different ports for every piece: the earlier port probe alone let this one start.
  const b = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => b.stop());
  const [code] = await b.exited;
  assert.equal(code, 1);
  assert.match(
    b.output(),
    /Another Creator Agent studio is already running on this database \(pnpm dev, web port \d+, process \d+\)/,
  );
  // Once the first one stops, the database is free again.
  await a.stop();
  const c = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => c.stop());
  const until2 = Date.now() + 60000;
  while (!/Sign-in/.test(c.output()) && Date.now() < until2) {
    assert.equal(c.child.exitCode, null, c.output());
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(c.output(), /Sign-in/);
});
