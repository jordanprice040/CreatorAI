import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Activity dots: a tab shows a dot when something finished there while the person was on
// another tab, and the dot clears when that tab is opened. activity-marks.ts has only type
// imports, so it loads directly.
async function load<T>(file: string) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}

type Marks = Partial<Record<string, readonly string[]>>;
type Marking = {
  runsMark: (
    w: { id: string; state: string; finished_at: string | null }[],
  ) => string[];
  decisionsMark: (d: { id: string; status: string }[]) => string[];
  buildMark: (
    p: {
      product: { id: string };
      builds: { started_at: string; state: string }[];
    }[],
    artifacts: { id: string }[],
  ) => string[];
  updateSeen: (marks: Marks, seen: Marks, here: string | null) => Marks;
  unseenViews: (marks: Marks, seen: Marks, here: string | null) => string[];
  mergeSeen: (
    stored: Record<string, Marks>,
    ws: string,
    changed: Marks,
  ) => Record<string, Marks>;
  marksFor: (
    ws: string,
    polled: { ws: string; marks: Marks } | null,
    build: { ws: string; keys: string[] } | undefined,
  ) => Marks;
  dotText: (views: string[], unseen: string[]) => string;
};
const m = await load<Marking>('activity-marks.ts');

const T = '2026-11-02T08:00:00Z';
/** Is there a dot on `view` when it was last seen with `seen` and now reads `now`? */
const dot = (view: string, seen: readonly string[], now: readonly string[]) =>
  m.unseenViews({ [view]: now }, { [view]: seen }, 'chat').includes(view);

test('a run that starts is not news; one that finishes is', () => {
  const before = m.runsMark([{ id: 'a', state: 'succeeded', finished_at: T }]);
  const started = m.runsMark([
    { id: 'b', state: 'running', finished_at: null },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  assert.equal(dot('runs', before, started), false);
  const finished = m.runsMark([
    { id: 'b', state: 'failed', finished_at: T },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  assert.equal(dot('runs', before, finished), true);
});

test('an old run falling off the end of the capped list is not news (review L-2)', () => {
  const before = m.runsMark([
    { id: 'old', state: 'succeeded', finished_at: T },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  // A new run starts and pushes the oldest finished one out of the newest-100 list.
  const after = m.runsMark([
    { id: 'new', state: 'running', finished_at: null },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  assert.equal(dot('runs', before, after), false);
});

test('an approval that is asked for or answered is news', () => {
  const one = m.decisionsMark([{ id: 'd1', status: 'pending' }]);
  assert.equal(dot('decisions', [], one), true);
  assert.equal(
    dot('decisions', one, m.decisionsMark([{ id: 'd1', status: 'answered' }])),
    true,
  );
});

test('a build ending or a package made is news; a restart is not (review M-2)', () => {
  const product = (builds: { started_at: string; state: string }[]) => [
    { product: { id: 'p' }, builds },
  ];
  const none = m.buildMark(product([]), []);
  const running = m.buildMark(
    product([{ started_at: T, state: 'running' }]),
    [],
  );
  assert.equal(dot('build', none, running), false);
  const failed = m.buildMark(product([{ started_at: T, state: 'failed' }]), []);
  assert.equal(dot('build', running, failed), true);
  // After an API restart the in-memory failure reads as interrupted: the same build, no dot.
  const restarted = m.buildMark(
    product([{ started_at: T, state: 'interrupted' }]),
    [],
  );
  assert.equal(dot('build', failed, restarted), false);
  // A package made is a new artifact; forgetting the in-memory package job is not news.
  const packaged = m.buildMark(
    product([{ started_at: T, state: 'verified_candidate' }]),
    [{ id: 'art-1' }],
  );
  assert.equal(dot('build', restarted, packaged), true);
  assert.equal(dot('build', packaged, packaged), false);
});

test('first sight is not news, a change elsewhere is, and opening the tab clears it', () => {
  // A studio opened for the first time: every tab takes its keys without a dot.
  const first = { runs: ['r1'], decisions: ['d1'] };
  let seen = m.updateSeen(first, {}, 'chat');
  assert.deepEqual(seen, first);
  assert.deepEqual(m.unseenViews(first, seen, 'chat'), []);
  // A run finishes while the person is in Chat: Runs gets a dot, and keeps it.
  const later = { runs: ['r1', 'r2'], decisions: ['d1'] };
  assert.equal(m.updateSeen(later, seen, 'chat'), seen, 'nothing to store');
  assert.deepEqual(m.unseenViews(later, seen, 'chat'), ['runs']);
  // Opening Runs clears it, and it stays clear after leaving again.
  assert.deepEqual(m.unseenViews(later, seen, 'runs'), []);
  seen = m.updateSeen(later, seen, 'runs');
  assert.deepEqual(m.unseenViews(later, seen, 'chat'), []);
});

test('a tab whose list could not be read has no dot and keeps what was seen', () => {
  const seen = { runs: ['r1'] };
  assert.deepEqual(m.unseenViews({}, seen, 'chat'), []);
  assert.equal(m.updateSeen({}, seen, 'runs'), seen);
});

test("a workspace switch never takes the previous workspace's lists as the new one's (review M-1)", () => {
  // One render after switching from A to B, the lists held are still A's.
  const polled = { ws: 'A', marks: { decisions: ['d1', 'd2'] } };
  const build = { ws: 'A', keys: ['b1'] };
  assert.deepEqual(m.marksFor('B', polled, build), {});
  assert.deepEqual(
    m.updateSeen(m.marksFor('B', polled, build), {}, 'chat'),
    {},
  );
  // B's own (empty) lists arrive: first sight, no dot.
  const own = m.marksFor('B', { ws: 'B', marks: { decisions: [] } }, build);
  const seen = m.updateSeen(own, {}, 'chat');
  assert.deepEqual(m.unseenViews(own, seen, 'chat'), []);
  assert.deepEqual(m.marksFor('A', polled, build), {
    decisions: ['d1', 'd2'],
    build: ['b1'],
  });
});

test('a second window writing later does not undo what the first one cleared (review L-1)', () => {
  // Window A cleared Approvals; the store has it. Window B then takes in Runs only.
  const stored = { W: { decisions: ['d1', 'd2'], runs: ['r1'] } };
  const merged = m.mergeSeen(stored, 'W', { runs: ['r1', 'r2'] });
  assert.deepEqual(merged.W, { decisions: ['d1', 'd2'], runs: ['r1', 'r2'] });
});

test('a page or tab dot names only its own news', () => {
  assert.equal(m.dotText(['overview', 'runs'], ['chat']), '');
  assert.equal(
    m.dotText(['decisions', 'runs'], ['runs', 'decisions', 'build']),
    'A run finished; An approval was asked for or answered',
  );
  assert.match(m.dotText(['chat'], ['chat']), /answer or error/);
});
