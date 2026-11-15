// ADR-0109 (B4): the Build form's limits (repair rounds, requests and the time limit shown
// before approval) and the timeline's words for a round in parts. The server checks every
// limit again; these say what will be asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeb } from './web-module.js';

type Rules = Record<string, any>;

test('the Build form offers 0 to 5 repair rounds and up to 20 requests, defaults unchanged', async () => {
  const r = (await loadWeb('build-limits.ts')) as Rules;
  assert.deepEqual(r.REPAIR_OPTIONS, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(r.requestOptions(1), [4, 8, 10, 12, 16, 20]);
  assert.deepEqual(r.requestOptions(5), [12, 16, 20]);
  const limits = (repairs: number, requests: number | null, cases = 10) =>
    r.buildLimits({
      repairs,
      requests,
      cases,
      recipe: 'python-build/1',
      codexBuildTimeoutMs: 0,
      requestMs: 120000,
    });
  // The default: 1 repair round, 4 requests.
  assert.equal(limits(1, null).requests, 4);
  // A chosen limit below what the rounds need is raised to the default for them.
  assert.equal(limits(5, 8).requests, 12);
  assert.equal(limits(1, 20).requests, 20);
  // 20 requests at 2 minutes, 6 rounds of 30 cases at 40 s, plus 10 minutes: 170 minutes.
  const big = limits(5, 20, 30);
  assert.equal(big.minutes, 170);
  assert.equal(
    r.limitsText(big),
    'At most 20 model requests, 5 repair rounds after a failed check; 30 test cases run one after another each round; the build stops after 170 minutes',
  );
  assert.equal(
    r.limitsText(limits(0, null, 1)),
    'At most 2 model requests, 0 repair rounds after a failed check; 1 test case run one after another each round; the build stops after 30 minutes',
  );
  // Review N-2: a broker build's requests wait its own 30 s call timeout, not the plan's 120 s.
  const broker = r.buildLimits({
    repairs: 5,
    requests: 20,
    cases: 30,
    recipe: 'python-build/1',
    codexBuildTimeoutMs: 0,
    requestMs: 30000,
  });
  assert.equal(broker.minutes, 140);
  assert.equal(broker.requestMs, 30000);
});

test('the timeline says when a round came in parts', async () => {
  const r = (await loadWeb('build-progress-rules.ts')) as Rules;
  const round = {
    round: 0,
    builder: 'answered',
    parts: 3,
    refused: null,
    candidate: { files: ['src/a.py', 'src/b.py'], kept: false },
    reviewer: null,
    review: null,
    tests: { ran: 0, passed: 0, failed: 0, unfinished: 0 },
    failures: [],
  };
  const progress = {
    route: 'plan_roles',
    max_repairs: 1,
    max_calls: 8,
    cases: 3,
    held_out: 1,
    requests: 3,
    approved: true,
    rounds: [round],
    now: null,
  };
  const text = (p: unknown) => JSON.stringify(r.timeline(p, 'failed').groups);
  assert.match(
    text(progress),
    /Builder changed 2 files in 3 parts, applied together: src\/a\.py, src\/b\.py/,
  );
  assert.match(
    text({
      ...progress,
      rounds: [{ ...round, builder: 'writing', parts: 2, candidate: null }],
    }),
    /Builder is writing the code \(part 2\)/,
  );
  // A server before B4 sends no parts: one-part wording, as before.
  const { parts: _, ...old } = round;
  assert.match(
    text({ ...progress, rounds: [old] }),
    /Builder changed 2 files: /,
  );
});
