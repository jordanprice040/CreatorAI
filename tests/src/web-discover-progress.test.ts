import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeb } from './web-module.js';

// Final UX pass P-6 and P-7 (ADR-0103): Discover's one-panel-at-a-time rules and the plain-words
// discovery progress shown on Discover and Decide instead of Monitor › Runs.

type Choice = { key: string };
type Panels = {
  PANEL_CHOICES: Choice[];
  panelsFor(standard: boolean, open?: string): Choice[];
  firstPanel(saved: string | null, standard: boolean): string;
  isPanel(v: string | undefined): boolean;
};
type Line = {
  tone: string;
  text: string;
  next: string | null;
  problemId: string | null;
};
type Rules = {
  KEEP_FINISHED_MS: number;
  discoveryLine(wf: unknown, tasks: unknown[] | null): Line;
  shownDiscoveries(
    list: unknown[],
    now: number,
    hidden: ReadonlySet<string>,
    keep?: string,
  ): { id: string }[];
};

const T0 = Date.parse('2026-11-14T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
function wf(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    role: 'r02_discovery',
    state: 'running',
    control: 'run',
    reason: 'running',
    result: null,
    created_at: iso(T0),
    finished_at: null,
    ...over,
  };
}
const task = (kind: string, state: string, round = 0) => ({
  kind,
  state,
  round,
});
function discovery(over: Record<string, unknown> = {}) {
  return {
    outcome: 'candidates',
    sufficiency: { verdict: 'sufficient', reasons: [] },
    catalog_records: {
      problem: { id: 'p1', version: 1 },
      alternatives: [
        { proposal: 'P1', id: 'a1', version: 1 },
        { proposal: 'P2', id: 'a2', version: 1 },
      ],
    },
    ...over,
  };
}
const finished = (over: Record<string, unknown>) =>
  wf({ state: 'succeeded', finished_at: iso(T0 + 60_000), ...over });

test('Discover lists its start choices with the theme draft in Advanced only', async () => {
  const p = (await loadWeb('discover-panels.ts')) as Panels;
  const keys = (cs: Choice[]) => cs.map((c) => c.key);
  assert.deepEqual(keys(p.panelsFor(true)), [
    'explore',
    'web',
    'claims',
    'autopilot',
    'automation',
  ]);
  assert.deepEqual(keys(p.panelsFor(false)), keys(p.PANEL_CHOICES));
  // The open panel stays listed, so Standard can still close it by picking another.
  assert.ok(keys(p.panelsFor(true, 'theme')).includes('theme'));
  // A remembered panel opens first only while it is listed.
  assert.equal(p.firstPanel('web', true), 'web');
  assert.equal(p.firstPanel('theme', true), 'explore');
  assert.equal(p.firstPanel('theme', false), 'theme');
  assert.equal(p.firstPanel('gone', false), 'explore');
  assert.equal(p.firstPanel(null, true), 'explore');
  assert.equal(p.isPanel('claims'), true);
  assert.equal(p.isPanel(undefined), false);
});

test('a live discovery says what it is doing in plain words', async () => {
  const r = (await loadWeb('discovery-progress-rules.ts')) as Rules;
  assert.match(
    r.discoveryLine(wf(), [task('locate', 'leased')]).text,
    /locate the problem/,
  );
  const proposing = r.discoveryLine(wf(), [
    task('locate', 'succeeded'),
    task('propose', 'succeeded'),
    task('propose', 'leased'),
    task('propose', 'queued'),
  ]);
  assert.equal(proposing.tone, 'running');
  assert.match(proposing.text, /1 of 3 done/);
  assert.match(
    r.discoveryLine(wf(), [task('skeptic', 'leased')]).text,
    /skeptic is checking/,
  );
  assert.match(
    r.discoveryLine(wf(), [
      task('skeptic', 'succeeded'),
      task('revise', 'queued', 1),
    ]).text,
    /Revising/,
  );
  const waiting = r.discoveryLine(wf(), [task('propose', 'waiting_human')]);
  assert.equal(waiting.tone, 'waiting');
  assert.equal(waiting.next, 'approvals');
  const paused = r.discoveryLine(wf({ control: 'pause' }), []);
  assert.equal(paused.next, 'resume');
  assert.match(r.discoveryLine(wf({ control: 'cancel' }), []).text, /Stopping/);
  assert.equal(r.discoveryLine(wf(), null).text, 'Running.');
  // No internal step codes or task kinds leak into the line.
  for (const l of [proposing, waiting, paused])
    assert.doesNotMatch(l.text, /_|r02|leased|waiting_human/);
});

test('a finished discovery says what to do next and where', async () => {
  const r = (await loadWeb('discovery-progress-rules.ts')) as Rules;
  const ok = r.discoveryLine(
    finished({
      result: {
        outcome: 'succeeded',
        explanation: 'x',
        discovery: discovery(),
      },
    }),
    null,
  );
  assert.equal(ok.tone, 'done');
  assert.equal(ok.next, 'decide');
  assert.equal(ok.problemId, 'p1');
  assert.match(ok.text, /2 options to compare/);

  const thin = r.discoveryLine(
    finished({
      result: {
        outcome: 'insufficient_evidence',
        explanation: 'x',
        discovery: discovery({
          outcome: 'insufficient_evidence',
          sufficiency: {
            verdict: 'insufficient',
            reasons: ['Only one claim supports the mechanism'],
          },
          catalog_records: { problem: null, alternatives: [] },
        }),
      },
    }),
    null,
  );
  assert.equal(thin.tone, 'stopped');
  assert.equal(thin.next, 'evidence');
  assert.match(thin.text, /Only one claim supports the mechanism\./);

  const none = r.discoveryLine(
    finished({
      result: {
        outcome: 'succeeded',
        explanation: 'x',
        discovery: discovery({ outcome: 'no_candidates' }),
      },
    }),
    null,
  );
  assert.equal(none.next, 'decide');

  const failed = r.discoveryLine(
    wf({
      state: 'failed',
      reason: 'deadline_exceeded',
      finished_at: iso(T0 + 1),
    }),
    null,
  );
  assert.equal(failed.tone, 'stopped');
  assert.match(failed.text, /deadline exceeded\./);
  assert.equal(
    r.discoveryLine(wf({ state: 'cancelled', finished_at: iso(T0 + 1) }), null)
      .tone,
    'stopped',
  );
});

test('the list keeps live discoveries and the last day of finished ones', async () => {
  const r = (await loadWeb('discovery-progress-rules.ts')) as Rules;
  const now = T0 + r.KEEP_FINISHED_MS + 120_000;
  const list = [
    wf({ id: 'live', created_at: iso(T0) }),
    finished({ id: 'old', created_at: iso(T0 - 1), finished_at: iso(T0) }),
    finished({
      id: 'recent',
      created_at: iso(T0 + 5),
      finished_at: iso(now - 1000),
    }),
    finished({
      id: 'hidden',
      created_at: iso(T0 + 6),
      finished_at: iso(now - 1000),
    }),
    wf({ id: 'explore', role: 'r01_exploration' }),
  ];
  const ids = (k?: string) =>
    r.shownDiscoveries(list, now, new Set(['hidden']), k).map((w) => w.id);
  assert.deepEqual(ids(), ['recent', 'live']);
  // The one just started stays listed even when hidden or old.
  assert.deepEqual(ids('old'), ['recent', 'live', 'old']);
});
