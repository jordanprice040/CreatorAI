import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_PROPOSAL_SECTIONS, PROPOSAL_SECTIONS } from '@creator/contracts';
import { loadWeb } from './web-module.js';

// P19 follow-up: what Standard folds on Decide and Proposals. A judgment the person must see
// (an override reason that matters, required sections, contrary evidence, assumptions, review
// marks) never stays folded; only routine values do.
type Gate = { override_needed: boolean; override_review: boolean };
type Mod = {
  runSource(runId: string, foundBy: string | null): string;
  overrideMatters(gate: Gate | null, override: string): boolean;
  overrideSummary(gate: Gate | null, override: string): string;
  decideRoutineSummary(run: {
    label: string;
    source: 'found' | 'other' | 'none';
  }): string;
  dispositionCounts(
    d: readonly string[],
    labels: Readonly<Record<string, string>>,
  ): string;
  FOLDED_PROPOSAL_SECTIONS: readonly string[];
  foldedSectionsSummary(states: readonly string[], blocked?: number): string;
  sectionCounts(s: readonly { required: boolean; state: string }[]): string;
  revisionReasonSummary(reason: string): string;
};
const load = () => loadWeb('decide-routine.ts') as Promise<Mod>;

test('the override fold opens when the reason matters and says why', async () => {
  const m = await load();
  const quiet = { override_needed: false, override_review: false };
  assert.equal(m.overrideMatters(quiet, ''), false);
  assert.equal(m.overrideMatters(quiet, '  '), false);
  // Typed but not needed: opens, so the "not recorded" note is seen beside it.
  assert.equal(m.overrideMatters(quiet, 'because'), true);
  assert.equal(
    m.overrideMatters({ ...quiet, override_needed: true }, ''),
    true,
  );
  assert.equal(
    m.overrideMatters({ ...quiet, override_review: true }, ''),
    true,
  );
  // Before the report loads nothing is known; opening then would leave it open for good.
  assert.equal(m.overrideMatters(null, ''), false);
  assert.equal(
    m.overrideSummary(quiet, ''),
    'Override reason: not needed for these choices',
  );
  assert.equal(
    m.overrideSummary({ ...quiet, override_needed: true }, ''),
    'Override reason: needed before you can record',
  );
  assert.equal(
    m.overrideSummary(quiet, 'because'),
    'Override reason: “because” (not needed, not recorded)',
  );
  assert.equal(
    m.overrideSummary({ ...quiet, override_review: true }, 'x'),
    'Override reason: review it',
  );
});

test('the Decide run summary names the run and where it came from', async () => {
  const m = await load();
  assert.equal(m.runSource('', 'r1'), 'none');
  assert.equal(m.runSource('r1', 'r1'), 'found');
  assert.equal(m.runSource('r2', 'r1'), 'other');
  assert.equal(m.runSource('r2', null), 'other');
  assert.equal(
    m.decideRoutineSummary({ label: 'Discover · r1', source: 'found' }),
    'Recorded under Discover · r1 (the run that found this problem)',
  );
  assert.equal(
    m.decideRoutineSummary({ label: 'Other · r2', source: 'other' }),
    'Recorded under Other · r2',
  );
  assert.equal(
    m.decideRoutineSummary({ label: '', source: 'none' }),
    'No active run to record under: start or resume one first',
  );
  assert.equal(
    m.dispositionCounts(['defer', '', 'reject', 'defer'], {
      defer: 'Defer',
      reject: 'Reject',
    }),
    '2 × Defer, 1 × Reject',
  );
  assert.equal(m.dispositionCounts(['', ''], {}), '');
});

test('folded proposal sections are optional and never contrary evidence or assumptions', async () => {
  const m = await load();
  for (const k of m.FOLDED_PROPOSAL_SECTIONS) {
    assert.ok((PROPOSAL_SECTIONS as readonly string[]).includes(k), k);
    assert.ok(!(CORE_PROPOSAL_SECTIONS as readonly string[]).includes(k), k);
  }
  assert.ok(!m.FOLDED_PROPOSAL_SECTIONS.includes('contrary_evidence'));
  assert.ok(!m.FOLDED_PROPOSAL_SECTIONS.includes('assumptions'));
  assert.equal(
    m.foldedSectionsSummary([
      'written',
      'unknown',
      'unknown',
      'not_applicable',
    ]),
    '4 more sections (optional): 1 written, 2 unknown yet, 1 not applicable',
  );
  assert.equal(
    m.foldedSectionsSummary(['written', 'unknown'], 1),
    '2 more sections (optional): 1 written, 1 unknown yet · 1 blocked',
  );
  assert.equal(
    m.sectionCounts([
      { required: true, state: 'written' },
      { required: true, state: 'unknown' },
      { required: false, state: 'written' },
      { required: false, state: 'not_applicable' },
    ]),
    '1 of 2 required written; 1 of 2 optional written, the rest marked unknown yet or not applicable',
  );
});

test('the revision reason summary shows what will be saved', async () => {
  const m = await load();
  assert.equal(
    m.revisionReasonSummary(' '),
    'What changed: “Edited” (default)',
  );
  assert.equal(m.revisionReasonSummary('Costs'), 'What changed: “Costs”');
});
