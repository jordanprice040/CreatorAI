import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PortfolioStore, type CommandContext } from '@creator/db';
import { freshDatabase, hold, lockWaiters } from './pg-harness.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ADR-0098 review 1 M-1: expiring jobs is global, so two workers leasing at once must lock the
// jobs they touch in one order. Each worker here has a queued job that is already overdue.
test('two workers leasing while both have overdue queued jobs never deadlock', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new PortfolioStore(db.pool);
  const workers: { token: string; job: string }[] = [];
  const raw = await db.pool.connect();
  try {
    for (let i = 0; i < 2; i++) {
      const owner: CommandContext = { actorId: randomUUID() };
      await store.ensureActor({
        id: owner.actorId,
        kind: 'human',
        display_name: `Owner ${i}`,
      });
      const ws = await store.createWorkspace(owner, {
        name: `Workspace ${i}`,
        record_mode: 'fixture',
      });
      const token = randomBytes(32).toString('base64url');
      const device = randomUUID();
      await raw.query(
        `insert into desktop_devices (id, kind, owner_id, workspace_id, label, capabilities,
           token_hash, expires_at)
         values ($1, 'worker', $2, $3, 'worker', '["artifact.run"]', $4, now() + interval '1 hour')`,
        [device, owner.actorId, ws.id, sha(token)],
      );
      // A job needs a verified artifact behind it; only the lease is under test, so this one
      // session skips the foreign-key checks for the job row.
      await raw.query('set session_replication_role = replica');
      const job = randomUUID();
      await raw.query(
        `insert into desktop_jobs (id, device_id, workspace_id, owner_id, request_id, request_hash,
           artifact_id, product_id, manifest_sha256, archive_sha256, input, fence, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $6, $6, '{}', 0, now() - interval '1 minute')`,
        [
          job,
          device,
          ws.id,
          owner.actorId,
          randomUUID(),
          sha('x'),
          randomUUID(),
          randomUUID(),
        ],
      );
      await raw.query('set session_replication_role = origin');
      workers.push({ token, job });
    }
  } finally {
    raw.release();
  }
  const [a, b] = workers as [(typeof workers)[0], (typeof workers)[0]];
  // A helper holds A's job, so A's lease waits on it first and B's lease then waits on it
  // while expiring. The old lease locked its own job before expiring, so B held B's job and
  // A, once released, waited on it: a cycle.
  const release = await hold(
    db.pool,
    'select 1 from desktop_jobs where id = $1 for update',
    [a.job],
  );
  const leaseA = store.leaseDesktopJob(a.token);
  await lockWaiters(db.pool, 1);
  const leaseB = store.leaseDesktopJob(b.token);
  await lockWaiters(db.pool, 2);
  await release();
  const results = await Promise.allSettled([leaseA, leaseB]);
  for (const r of results)
    assert.equal(
      r.status,
      'fulfilled',
      String(r.status === 'rejected' && r.reason),
    );
  // Both jobs were overdue, so neither is leased; both are expired.
  assert.deepEqual(
    results.map((r) => r.status === 'fulfilled' && r.value),
    [null, null],
  );
  const { rows } = await db.pool.query(
    'select state from desktop_jobs where id = any($1::uuid[])',
    [[a.job, b.job]],
  );
  assert.deepEqual(
    rows.map((r) => r.state),
    ['expired', 'expired'],
  );
});

test('ADR-0098 re-review 2 M-2: pausing a device while another worker leases never deadlocks', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new PortfolioStore(db.pool);
  const raw = await db.pool.connect();
  const owner: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'W',
    record_mode: 'fixture',
  });
  const devs: { id: string; token: string }[] = [];
  for (let i = 0; i < 2; i++) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await raw.query(
      `insert into desktop_devices (id, kind, owner_id, workspace_id, label, capabilities, token_hash, expires_at)
       values ($1, 'worker', $2, $3, 'worker', '["artifact.run"]', $4, now() + interval '1 hour')`,
      [id, owner.actorId, ws.id, sha(token)],
    );
    devs.push({ id, token });
  }
  // Two overdue queued jobs on device A; the larger id is inserted first (scanned first).
  const ids = [randomUUID(), randomUUID()].sort();
  const [small, large] = ids as [string, string];
  await raw.query('set session_replication_role = replica');
  for (const job of [large, small])
    await raw.query(
      `insert into desktop_jobs (id, device_id, workspace_id, owner_id, request_id, request_hash,
         artifact_id, product_id, manifest_sha256, archive_sha256, input, fence, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $6, $6, '{}', 0, now() - interval '1 minute')`,
      [
        job,
        devs[0]!.id,
        ws.id,
        owner.actorId,
        randomUUID(),
        sha('x'),
        randomUUID(),
        randomUUID(),
      ],
    );
  await raw.query('set session_replication_role = origin');
  raw.release();
  const release = await hold(
    db.pool,
    'select 1 from desktop_jobs where id = $1 for update',
    [small],
  );
  const lease = store.leaseDesktopJob(devs[1]!.token);
  await lockWaiters(db.pool, 1);
  const pause = store.controlDesktop(owner, devs[0]!.id, { state: 'paused' });
  await lockWaiters(db.pool, 2);
  await release();
  const out = await Promise.allSettled([lease, pause]);
  const errs = out.flatMap((o) =>
    o.status === 'rejected' ? [String(o.reason)] : [],
  );
  assert.deepEqual(errs, []);
});
