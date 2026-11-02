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

type Marks = Partial<Record<string, string>>;
type Marking = {
  runsMark: (
    w: { id: string; state: string; finished_at: string | null }[],
  ) => string;
  decisionsMark: (d: { id: string; status: string }[]) => string;
  buildMark: (
    p: {
      product: { id: string };
      builds: {
        started_at: string;
        state: string;
        package: { state: string } | null;
      }[];
    }[],
  ) => string;
  updateSeen: (marks: Marks, seen: Marks, here: string | null) => Marks;
  unseenViews: (marks: Marks, seen: Marks, here: string | null) => string[];
  dotText: (views: string[], unseen: string[]) => string;
};
const m = await load<Marking>('activity-marks.ts');

const T = '2026-11-02T08:00:00Z';

test('a run that starts is not news; one that finishes is', () => {
  const before = m.runsMark([{ id: 'a', state: 'succeeded', finished_at: T }]);
  const started = m.runsMark([
    { id: 'b', state: 'running', finished_at: null },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  assert.equal(started, before);
  const finished = m.runsMark([
    { id: 'b', state: 'failed', finished_at: T },
    { id: 'a', state: 'succeeded', finished_at: T },
  ]);
  assert.notEqual(finished, before);
  // Order of the list does not matter.
  assert.equal(
    m.runsMark([
      { id: 'a', state: 'succeeded', finished_at: T },
      { id: 'b', state: 'failed', finished_at: T },
    ]),
    finished,
  );
});

test('an approval that is asked for or answered moves the Approvals mark', () => {
  const one = m.decisionsMark([{ id: 'd1', status: 'pending' }]);
  assert.notEqual(m.decisionsMark([]), one);
  assert.notEqual(m.decisionsMark([{ id: 'd1', status: 'answered' }]), one);
});

test('a build or package ending moves the Build mark; starting one does not', () => {
  const product = (
    builds: {
      started_at: string;
      state: string;
      package: { state: string } | null;
    }[],
  ) => [{ product: { id: 'p' }, builds }];
  const none = m.buildMark(product([]));
  const running = m.buildMark(
    product([{ started_at: T, state: 'running', package: null }]),
  );
  assert.equal(running, none);
  const verified = m.buildMark(
    product([{ started_at: T, state: 'verified_candidate', package: null }]),
  );
  assert.notEqual(verified, none);
  const packaging = m.buildMark(
    product([
      {
        started_at: T,
        state: 'verified_candidate',
        package: { state: 'running' },
      },
    ]),
  );
  assert.equal(packaging, verified);
  const packaged = m.buildMark(
    product([
      {
        started_at: T,
        state: 'verified_candidate',
        package: { state: 'done' },
      },
    ]),
  );
  assert.notEqual(packaged, verified);
});

test('first sight is not news, a change elsewhere is, and opening the tab clears it', () => {
  // A studio opened for the first time: every tab takes its mark without a dot.
  let seen = m.updateSeen({ runs: 'r1', decisions: 'd1' }, {}, 'chat');
  assert.deepEqual(seen, { runs: 'r1', decisions: 'd1' });
  assert.deepEqual(
    m.unseenViews({ runs: 'r1', decisions: 'd1' }, seen, 'chat'),
    [],
  );
  // A run finishes while the person is in Chat: Runs gets a dot, and keeps it.
  const later = { runs: 'r2', decisions: 'd1' };
  assert.equal(m.updateSeen(later, seen, 'chat'), seen, 'nothing to store');
  assert.deepEqual(m.unseenViews(later, seen, 'chat'), ['runs']);
  // Opening Runs clears it, and it stays clear after leaving again.
  assert.deepEqual(m.unseenViews(later, seen, 'runs'), []);
  seen = m.updateSeen(later, seen, 'runs');
  assert.deepEqual(m.unseenViews(later, seen, 'chat'), []);
});

test('a tab whose list could not be read has no dot and keeps what was seen', () => {
  const seen = { runs: 'r1' };
  assert.deepEqual(m.unseenViews({}, seen, 'chat'), []);
  assert.equal(m.updateSeen({}, seen, 'runs'), seen);
});

test('a page or tab dot names only its own news', () => {
  assert.equal(m.dotText(['overview', 'runs'], ['chat']), '');
  assert.equal(
    m.dotText(['decisions', 'runs'], ['runs', 'decisions', 'build']),
    'A run finished; An approval was asked for or answered',
  );
});
