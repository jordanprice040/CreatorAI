import test from 'node:test';
import assert from 'node:assert/strict';
import { tiedNames } from '@creator/domain';
import { problemTitle } from '@creator/db';
import { loadWeb } from './web-module.js';

// Final UX pass P-8: the Standard view's words for stored history lines, ids and versions.
type Part = string | { nano: string };
type Words = {
  plainEvent: (summary: string) => Part[];
  actionLabel: (action: string) => string;
  codeLabel: (code: string) => string;
  kindLabel: (kind: string) => string;
  plainText: (text: string) => string;
  versionTag: (version: number, standard: boolean) => string;
  ACTION_LABEL: Record<string, string>;
};
type Labels = {
  runLabel: (
    run: { run_id: string; created_at: string; autonomy_mode: string },
    names: ReadonlyMap<string, string>,
    max?: number,
    id?: boolean,
  ) => string;
  plainUncertainty: (text: string, ids?: boolean) => string;
};
const words = () => loadWeb('plain-words.ts') as Promise<Words>;
const text = (parts: Part[]) =>
  parts.map((p) => (typeof p === 'string' ? p : `[${p.nano}]`)).join('');

test('history lines from the walk read as words, without versions or codes', async () => {
  const { plainEvent } = await words();
  // Lines copied from the fixture walk's Monitor › Activity (Standard).
  const cases: [string, string][] = [
    ['Created specification v1', 'Created spec'],
    ['Created humility_review v1', 'Created humility review'],
    ['Revised scorecard to v3', 'Revised scorecard'],
    [
      'Linked alternative v1 derived_from problem v1',
      'Linked option from problem',
    ],
    [
      'Linked scorecard v1 assesses alternative v1',
      'Linked scorecard assesses option',
    ],
    [
      'Linked problem v1 derived_from search_brief v1',
      'Linked problem from brief',
    ],
    [
      'Action spec.freeze: request_human (outside_grant)',
      'Freeze a spec: needs your approval (no approval covers it)',
    ],
    [
      'Action candidate.select: allow (covered)',
      'Record a selection: allowed (an approval covers it)',
    ],
    ['Answered decision: approve_once', 'Answered an approval: approved once'],
    ['Registered human_in_loop run', 'Registered a human-in-the-loop run'],
    ['Leased task to worker-87e9d53a (delivery 1)', 'Gave a task to a worker'],
    // Review 1 of #197, N-1: the article follows the phrase.
    [
      'Registered autonomous_within_scope run',
      'Registered an autonomous within scope run',
    ],
    [
      'Fetch fetched (new_version); new source version',
      'Fetched a new version of a source',
    ],
    ['Fetch blocked (private_address)', 'Fetch blocked (private address)'],
    [
      'Recorded supports evidence (source_assertion) for claim v1 from source v1',
      'Recorded supporting evidence for a claim (the source says so)',
    ],
    ['Created model grant v2', 'Created model approval'],
    ['Workflow finished: succeeded', 'Workflow finished: succeeded'],
    ['study.protocol_frozen', 'Study protocol frozen'],
    [
      'Changed the per-run and per-model spending limits (version 4)',
      'Changed the per-run and per-model spending limits',
    ],
  ];
  for (const [stored, shown] of cases)
    assert.equal(text(plainEvent(stored)), shown, stored);
  // Nothing left in the output looks like an id, a version or a code.
  for (const [stored] of cases)
    assert.doesNotMatch(
      text(plainEvent(stored)),
      /\bv\d+\b|\b[a-z]+_[a-z]+\b|[a-z]\.[a-z]/,
      stored,
    );
});

test('history amounts become exact nano parts, so they show in cents with the exact value kept', async () => {
  const { plainEvent } = await words();
  // "Charged 0.05577 of 0.4285375 reserved" from the walk.
  assert.deepEqual(plainEvent('Charged 0.05577 of 0.4285375 reserved'), [
    'Charged ',
    { nano: '55770000' },
    ' of ',
    { nano: '428537500' },
    ' held',
  ]);
  assert.equal(
    text(
      plainEvent(
        'Changed the overall spending ceiling from $20.00 to $25.50 (version 2)',
      ),
    ),
    'Changed the overall spending ceiling from $[20000000000] to $[25500000000]',
  );
  assert.equal(
    text(plainEvent('Reserved 0.4285375 for model.generate attempt 1')),
    'Held [428537500] for model writing',
  );
  assert.equal(
    text(plainEvent('Funded workspace budget of 100.00 (simulated)')),
    'Funded workspace budget of [100000000000] (simulated)',
  );
});

test('every action type has a label, and codes and kinds read as words', async () => {
  const { ACTION_LABEL, actionLabel, codeLabel, kindLabel, plainText } =
    await words();
  const { ActionTypeSchema } = await import('@creator/contracts');
  for (const a of ActionTypeSchema.options)
    assert.ok(ACTION_LABEL[a], `no label for ${a}`);
  assert.equal(actionLabel('spec.freeze'), 'Freeze a spec');
  assert.equal(actionLabel('study.new_thing'), 'Study new thing');
  assert.equal(codeLabel('use_existing'), 'use an existing tool');
  assert.equal(codeLabel('some_new_code'), 'some new code');
  assert.equal(
    plainText('Allow tool.search_public on this run?'),
    'Allow search the web on this run?',
  );
  assert.equal(plainText('Version 2.5 stays'), 'Version 2.5 stays');
  // Review 1 of #197, L-3: Budgets › Recent calls reads a call's state as words.
  assert.equal(codeLabel('settled'), 'cost recorded');
  assert.equal(codeLabel('reconciled_no_charge'), 'confirmed no charge');
  assert.equal(kindLabel('alternative'), 'option');
  assert.equal(kindLabel('context_pack'), 'context pack');
});

test('Standard leaves out v1 and run ids; Advanced keeps them', async () => {
  const { versionTag } = await words();
  assert.equal(versionTag(1, true), '');
  assert.equal(versionTag(2, true), 'v2');
  assert.equal(versionTag(1, false), 'v1');
  const l = (await loadWeb('labels.ts')) as Labels;
  const run = {
    run_id: '9ea73968-0000-4000-8000-000000000001',
    created_at: '2026-11-14T11:11:00Z',
    autonomy_mode: 'human_in_loop',
  };
  const names = new Map([[run.run_id, 'Course e-book availability']]);
  assert.match(l.runLabel(run, names), / · 9ea73968$/);
  const plain = l.runLabel(run, names, 48, false);
  assert.match(plain, /^Course e-book availability · /);
  assert.doesNotMatch(plain, /9ea73968/);
  const stored =
    'Discovery run b58cc812-1111-4222-8333-444455556666 (fixture): locator rated the evidence well supported.';
  assert.match(
    l.plainUncertainty(stored),
    /Discovery run b58cc812 \(fixture\)/,
  );
  assert.equal(
    l.plainUncertainty(stored, false),
    'Discovery run (fixture): locator rated the evidence well supported.',
  );
});

test('N-2 and N-3: a problem title says its problem once, and a tie names at most three options', () => {
  assert.equal(
    problemTitle('Clinic no-shows.', 'Clinic no-shows.'),
    'Clinic no-shows.',
  );
  assert.equal(
    problemTitle('Rural clinic access.', 'Patients miss first appointments.'),
    'Rural clinic access: Patients miss first appointments.',
  );
  assert.equal(tiedNames(['A', 'B']), '“A” and “B”');
  assert.equal(tiedNames(['A', 'B', 'C']), '“A”, “B” and “C”');
  assert.equal(
    tiedNames(['A', 'B', 'C', 'D', 'E']),
    '“A”, “B”, “C” and 2 more',
  );
  const long = tiedNames(['x'.repeat(200)]);
  assert.ok(long.length <= 62, long);
});
