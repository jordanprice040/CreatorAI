import test from 'node:test';
import assert from 'node:assert/strict';
import type { Autopilot } from '@creator/contracts';
import { loadWeb } from './web-module.js';

type Rules = {
  waitingAutopilot(
    autopilots: readonly Autopilot[],
    problemId: string,
    now?: number,
  ): Autopilot | null;
  continueLabel(a: Pick<Autopilot, 'stage'>): string;
};

const NOW = Date.parse('2026-11-15T10:00:00.000Z');

function autopilot(
  id: string,
  over: { problem?: string; created?: string; ends?: string; state?: string },
): Autopilot {
  return {
    id,
    state: over.state ?? 'finished',
    outcome: 'needs_person',
    stage: 'select',
    created_at: over.created ?? '2026-11-15T09:00:00.000Z',
    config: { limits: { ends_at: over.ends ?? '2026-11-15T12:00:00.000Z' } },
    steps: [
      {
        stage: 'select',
        state: 'stopped',
        problem: { id: over.problem ?? 'p1', version: 1 },
      },
    ],
  } as unknown as Autopilot;
}

// Live rerun 3: Decide names the autopilot waiting on the problem, never an expired or
// unrelated one, and picks the newest when several could continue.
test('Decide offers Continue only for the newest live autopilot on that problem', async () => {
  const r = (await loadWeb('autopilot-waiting-rules.ts')) as Rules;
  const old = autopilot('old', { created: '2026-11-15T08:00:00.000Z' });
  const newest = autopilot('new', { created: '2026-11-15T09:30:00.000Z' });
  const expired = autopilot('expired', {
    created: '2026-11-15T09:50:00.000Z',
    ends: '2026-11-15T09:59:00.000Z',
  });
  const other = autopilot('other', {
    created: '2026-11-15T09:55:00.000Z',
    problem: 'p2',
  });
  const running = autopilot('running', {
    created: '2026-11-15T09:58:00.000Z',
    state: 'running',
  });
  assert.equal(
    r.waitingAutopilot([old, expired, newest, other], 'p1', NOW)?.id,
    'new',
  );
  // Review 2 N-1: while one is running on this problem, none offers Continue; one running on
  // another problem does not matter.
  assert.equal(r.waitingAutopilot([old, newest, running], 'p1', NOW), null);
  const elsewhere = autopilot('elsewhere', { state: 'running', problem: 'p2' });
  assert.equal(r.waitingAutopilot([newest, elsewhere], 'p1', NOW)?.id, 'new');
  // The end time is read at the time given, so a later check hides it.
  assert.equal(
    r.waitingAutopilot([newest], 'p1', Date.parse('2026-11-15T12:00:00.000Z')),
    null,
  );
  assert.equal(r.waitingAutopilot([expired, other], 'p1', NOW), null);
  assert.equal(r.waitingAutopilot([], 'p1', NOW), null);
  assert.equal(
    r.continueLabel(newest),
    'Continue the autopilot from choose an option',
  );
});
