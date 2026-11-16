// ADR-0123 (F1): the words Settings › Backups shows for sizes, runs and the daily line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeb } from './web-module.js';

type Rules = Record<string, any>;

test('backup sizes, run lines and the daily line say what happened', async () => {
  const r = (await loadWeb('backups-text.ts')) as Rules;
  assert.equal(r.sizeText(512), '512 bytes');
  assert.equal(r.sizeText(2048), '2 KB');
  assert.equal(r.sizeText(5 * 1024 * 1024 + 300 * 1024), '5.3 MB');
  const run = (o: Record<string, unknown>) => ({
    id: '00000000-0000-4000-8000-000000000001',
    backup_name: 'daily-2026-11-16T09-00-00-000Z',
    started_at: '2026-11-16T09:00:00.000Z',
    finished_at: null,
    error: null,
    result: null,
    ...o,
  });
  assert.equal(
    r.runLine(run({ trigger: 'daily', status: 'running' })),
    'Backing up to daily-2026-11-16T09-00-00-000Z…',
  );
  assert.equal(
    r.runLine(
      run({
        trigger: 'daily',
        status: 'succeeded',
        result: { bytes: 4096, removed: ['a', 'b'] },
      }),
    ),
    'Daily backup of daily-2026-11-16T09-00-00-000Z: done, 4 KB; 2 older daily backup(s) removed',
  );
  assert.match(
    r.runLine(run({ trigger: 'restore', status: 'interrupted' })),
    /: interrupted$/,
  );
  const view = (daily: boolean, last: string | null) => ({
    settings: { daily_enabled: daily, keep_daily: 7 },
    last_daily_day: last,
  });
  assert.match(r.dailyText(view(false, null), '2026-11-16'), /^Off\./);
  assert.match(
    r.dailyText(view(true, '2026-11-16'), '2026-11-16'),
    /today's has been taken.*newest 7/,
  );
  assert.match(
    r.dailyText(view(true, '2026-11-15'), '2026-11-16'),
    /within about 10 minutes/,
  );
  // A restore database name the server accepts.
  const name = r.suggestDatabase('manual-2026-11-16T09-00-00-000Z');
  assert.match(name, /^[a-z][a-z0-9_]{0,62}$/);
  assert.equal(name, 'restored_manual_2026_11_16t09_00_00_000z');
});
