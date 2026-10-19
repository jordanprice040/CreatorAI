import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenance } from '@creator/api';

test('maintenance reports safe failures, bounds logs, shares overlapping work and recovers', async () => {
  const logs: string[] = [];
  const maintenance = createMaintenance(true, (message) => logs.push(message));
  const failure = Object.assign(new Error('postgres://private:secret@host'), {
    code: 'ECONNREFUSED',
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      maintenance.run('outbox', async () => {
        throw failure;
      }),
      /private/,
    );
  }
  assert.equal(logs.length, 1);
  const failed = maintenance.snapshot();
  assert.equal(failed.degraded, true);
  assert.equal(failed.jobs.outbox.error_code, 'ECONNREFUSED');
  assert.ok(failed.jobs.outbox.last_failure_at);
  assert.equal(failed.jobs.outbox.last_success_at, null);
  assert.ok(!JSON.stringify({ failed, logs }).includes('secret'));
  let finish!: () => void;
  let calls = 0;
  const pending = maintenance.run(
    'outbox',
    () =>
      new Promise<void>((resolve) => {
        calls++;
        finish = resolve;
      }),
  );
  const duplicate = maintenance.run('outbox', async () => {
    calls++;
  });
  assert.equal(pending, duplicate);
  await Promise.resolve();
  finish();
  await pending;
  assert.equal(calls, 1);
  assert.equal(maintenance.snapshot().degraded, false);
  assert.ok(maintenance.snapshot().jobs.outbox.last_success_at);
  assert.equal(
    failed.jobs.outbox.last_success_at,
    null,
    'snapshots are detached',
  );
  await assert.rejects(
    maintenance.run('broker_recovery', async () => {
      throw new Error('secret');
    }),
  );
  assert.equal(
    maintenance.snapshot().jobs.broker_recovery.error_code,
    'MAINTENANCE_FAILED',
  );
  await maintenance.run('outbox', async () => undefined);
  assert.equal(
    maintenance.snapshot().degraded,
    true,
    'another failed job stays degraded',
  );
  await maintenance.run('broker_recovery', async () => undefined);
  assert.equal(maintenance.snapshot().degraded, false);
  await assert.rejects(
    maintenance.run('outbox', async () => {
      throw failure;
    }),
  );
  assert.equal(logs.length, 3, 'same error is logged again after recovery');
  assert.equal(createMaintenance(false).snapshot().enabled, false);
});
