import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIXTURE_LABEL,
  allBlockedFixture,
  analyze,
  mixedFixture,
  parseRatings,
  summarizeDifferences,
  weightedKappa,
  zeroAcceptedFixture,
  type AnalysisFixture,
} from '@creator/domain';
import { randomUUID } from 'node:crypto';
import { StudyStore } from '@creator/db';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import {
  runAnalysis,
  runEvaluationRehearsal,
  writeFixtureInput,
} from '@creator/orchestrator';
import { freshDatabase } from './pg-harness.js';

const input = (f: AnalysisFixture, change?: (f: AnalysisFixture) => void) => {
  const copy = structuredClone(f);
  change?.(copy);
  return {
    package: copy.package,
    key: copy.key,
    ratings: copy.ratings,
    exports: copy.exports,
    options: copy.options ?? undefined,
    fixture: copy.fixture,
    sources: [{ path: 'in-memory', sha256: '0'.repeat(64) }],
  };
};
const row = <T extends Record<string, unknown>>(
  rows: T[],
  match: Partial<T>,
) => {
  const r = rows.find((x) =>
    Object.entries(match).every(([k, v]) => x[k] === v),
  );
  assert.ok(r, `no row ${JSON.stringify(match)}`);
  return r;
};
const failing = (a: { reconciliation: { id: string; status: string }[] }) =>
  a.reconciliation.filter((c) => c.status === 'fail').map((c) => c.id);

test('mixed fixture: hand-computed quality, pairs, retries, unknown billing and denominators', () => {
  const a = analyze(input(mixedFixture()));
  assert.equal(a.data_kind, 'synthetic_verification_fixture');
  assert.equal(a.empirical, false);
  assert.equal(a.label, FIXTURE_LABEL);
  assert.deepEqual(failing(a), []);
  const q = a.prespecified.decision_quality;
  // d2 B: reviewer-1 mean (3+4+3+4+3)/5 = 3.4, reviewer-2 = 4, slot = 3.7; the retry is rated.
  assert.equal(row(q, { task_key: 'd2', arm: 'B' }).quality, 3.7);
  // d2 C: reviewer-2 left one dimension blank, so only reviewer-1's complete row counts.
  const c = row(q, { task_key: 'd2', arm: 'C' });
  assert.equal(c.quality, 3);
  assert.equal(c.complete_reviewers, 1);
  assert.equal(c.dimension_means.usefulness, 3.5);
  assert.equal(c.dimension_means.evidence_support, 3);
  // A failed run with no output stays unrated, never imputed.
  assert.equal(row(q, { task_key: 'd2', arm: 'A' }).quality, null);

  const pairs = a.prespecified.paired_comparisons;
  const ba = row(pairs, { stratum: 'decision', contrast: 'B - A' });
  assert.equal(ba.n_pairs, 1);
  assert.equal(ba.median, 1);
  assert.equal(
    ba.rows.find((r) => r.task_key === 'd2')!.excluded,
    'A failed, no value',
  );
  const cb = row(pairs, { stratum: 'decision', contrast: 'C - B' });
  assert.deepEqual(
    [cb.n_pairs, cb.min, cb.median, cb.max],
    [2, -2, -1.35, -0.7],
  );
  assert.equal(cb.interval, null);
  assert.match(cb.interval_note, /below the plan minimum/);
  const impl = row(pairs, { stratum: 'implementation', contrast: 'C - B' });
  assert.equal(impl.median, -0.3333);

  // Discovery: repeats are averaged within the theme first; one structured repeat is unrated.
  const d = a.prespecified.discovery_comparison.rows[0]!;
  assert.deepEqual(
    [
      d.structured_mean,
      d.structured_repeats_rated,
      d.open_mean,
      d.difference_open_minus_structured,
    ],
    [3, '1/2', 3.5, 0.5],
  );

  const comp = a.prespecified.completion;
  const b = row(comp, { stratum: 'decision', arm: 'B' });
  assert.deepEqual(
    [
      b.assigned,
      b.attempts,
      b.retries,
      b.infrastructure_failures,
      b.completion,
    ],
    [2, 3, 1, 1, '2/2'],
  );
  // A blocked slot stays in the assigned denominator.
  assert.equal(
    row(comp, { stratum: 'implementation', arm: 'A' }).completion,
    '0/1',
  );

  const res = a.prespecified.resources;
  const rb = row(res, {
    comparison: 'autonomy',
    stratum: 'decision',
    arm: 'B',
  });
  assert.equal(rb.known_spend_usd, '0.006500000');
  assert.equal(rb.accepted, 2);
  assert.equal(rb.cost_per_accepted_usd, '0.003250000');
  const ds = row(res, { arm: 'D-structured' });
  assert.equal(ds.unknown_exposure_usd, '0.002500000');
  assert.match(ds.cost_per_accepted_note, /Lower bound/);
  assert.equal(
    row(res, { stratum: 'implementation', arm: 'C' }).cost_per_accepted_usd,
    null,
  );
  assert.equal(a.totals.known_spend_usd, '0.025000000');
  assert.equal(a.totals.unknown_exposure_usd, '0.002500000');
  assert.deepEqual(a.totals.accepted, { implementation: 1, decision: 7 });
  assert.equal(a.totals.distinct_human_participants, 1);
  assert.ok(a.limitations.some((l) => /one person's repeated work/.test(l)));

  const effort = row(a.prespecified.human_effort_and_latency, {
    stratum: 'decision',
    arm: 'B',
  });
  assert.deepEqual(
    [
      effort.human_active_minutes,
      effort.intervention_active_minutes,
      effort.human_wait_seconds,
      effort.wall_seconds_median,
    ],
    [22, 8, 90, 950],
  );
  const iv = row(a.prespecified.interventions, {
    stratum: 'decision',
    arm: 'B',
  });
  assert.deepEqual(
    [iv.interventions, iv.prevented_problem_yes, iv.prevented_problem_unknown],
    [2, 1, 1],
  );
  assert.equal(a.deviations.length, 2);
  assert.equal(a.prespecified.reviewer_agreement.disagreements.length, 5);
});

test('zero accepted outcomes leave cost per accepted outcome undefined and total spend visible', () => {
  const a = analyze(input(zeroAcceptedFixture()));
  assert.deepEqual(failing(a), []);
  assert.deepEqual(a.totals.accepted, { implementation: 0, decision: 0 });
  assert.equal(a.totals.known_spend_usd, '0.019000000');
  for (const r of a.prespecified.resources) {
    assert.equal(r.accepted, 0);
    assert.equal(r.cost_per_accepted_usd, null);
    assert.match(r.cost_per_accepted_note, /zero accepted outcomes/);
  }
  assert.equal(
    row(a.prespecified.functional_completion, { arm: 'B' }).accepted,
    false,
  );
});

test('an all-blocked final-shaped package yields explicit gaps, and only real final records are empirical', () => {
  const a = analyze(input(allBlockedFixture()));
  assert.equal(a.empirical, false);
  assert.equal(a.data_kind, 'synthetic_verification_fixture');
  assert.deepEqual(failing(a), []);
  assert.equal(a.deviations.length, 10);
  assert.ok(a.gaps.some((g) => /No reviewer ratings/.test(g)));
  assert.ok(a.gaps.some((g) => /No decision acceptance rule/.test(g)));
  assert.equal(
    a.prespecified.resources.every(
      (r) => r.accepted === 0 || r.accepted === null,
    ),
    true,
  );
  // Without the marker it is still not empirical: nothing ran, so there are no final records.
  const bare = analyze({ ...input(allBlockedFixture()), fixture: undefined });
  assert.equal(bare.data_kind, 'not_empirical');
  // A package claiming final mode with synthetic exports fails reconciliation.
  const claimed = analyze({
    ...input(mixedFixture(), (f) => {
      (f.package as { mode: string }).mode = 'final';
    }),
    fixture: undefined,
  });
  assert.equal(claimed.empirical, false);
  assert.deepEqual(failing(claimed), ['export.kind_consistent']);
});

test('totals reconcile without join multiplication and flow measurements must match the exports', () => {
  const doubled = analyze(
    input(mixedFixture(), (f) => {
      const first = f.exports[0]!.body.attempts![0]!;
      f.exports[1]!.body.attempts!.push(first);
    }),
  );
  assert.ok(failing(doubled).includes('attempts.in_one_export'));
  assert.ok(failing(doubled).includes('spend.totals_reconcile'));
  const tampered = analyze(
    input(mixedFixture(), (f) => {
      // Replace (not mutate) so the export keeps its own copy of the measurements.
      const a = (
        f.package.flow[0] as {
          attempts: { measurements: Record<string, unknown> }[];
        }
      ).attempts[0]!;
      a.measurements = {
        ...a.measurements,
        known_simulated_spend_nano_usd: '9',
      };
    }),
  );
  assert.ok(failing(tampered).includes('attempts.measurements_match_export'));
});

test('ratings: blanks are missing, anything else must be 1-5 and each code rated once', () => {
  const header =
    'item,code,usefulness,feasibility,evidence_support,differentiation,appropriateness,notes';
  const rows = parseRatings(
    'r',
    `${header}\n01,abc,1,2,,4,5,"note, with comma"\n`,
  );
  assert.deepEqual(rows[0]!.values, {
    usefulness: 1,
    feasibility: 2,
    evidence_support: null,
    differentiation: 4,
    appropriateness: 5,
  });
  assert.equal(rows[0]!.has_note, true);
  assert.throws(
    () => parseRatings('r', `${header}\n01,abc,6,2,3,4,5,\n`),
    /invalid ratings/,
  );
  assert.throws(() => parseRatings('r', `item,code,score\n`), /header/);
  const dup = analyze(
    input(mixedFixture(), (f) => {
      const r = f.ratings[0]!;
      const lines = r.csv.trimEnd().split('\n');
      r.csv = [...lines, lines[1]!, '99,unknowncode,,,,,,'].join('\n') + '\n';
    }),
  );
  const detail = dup.reconciliation.find(
    (c) => c.id === 'ratings.codes_valid',
  )!;
  assert.equal(detail.status, 'fail');
  assert.match(detail.detail, /rated twice/);
  assert.match(detail.detail, /unknown code unknowncode/);
});

test('private participant metadata never reaches the output', () => {
  const leaked = analyze(
    input(mixedFixture(), (f) => {
      const ev = f.exports[0]!.body.raw_events!.find(
        (e) => e.kind === 'deviations',
      )!;
      (ev.payload as Record<string, unknown>).reason =
        'Participant FIXTURE-P01 used a search summary.';
    }),
  );
  assert.deepEqual(failing(leaked), ['privacy.no_participant_metadata']);
});

test('kappa and the bootstrap give hand-checked values and refuse small samples', () => {
  assert.equal(
    weightedKappa([
      [1, 1],
      [2, 2],
      [3, 3],
    ]),
    1,
  );
  // Observed 1/16, expected 0.5/16 under quadratic weights: kappa = -1.
  assert.equal(
    weightedKappa([
      [1, 2],
      [2, 1],
    ]),
    -1,
  );
  assert.equal(
    weightedKappa([
      [3, 3],
      [3, 3],
    ]),
    null,
  );
  const flat = summarizeDifferences(Array(12).fill(1), 'ab12cd34');
  assert.deepEqual(flat.interval, { level: 0.95, low: 1, high: 1 });
  const spread = Array.from({ length: 12 }, (_, i) => i - 5);
  assert.deepEqual(
    summarizeDifferences(spread, 'ab12cd34'),
    summarizeDifferences(spread, 'ab12cd34'),
  );
  const iv = summarizeDifferences(spread, 'ab12cd34').interval!;
  assert.ok(iv.low! < 0.5 && iv.high! > 0.5 && iv.low! >= -5 && iv.high! <= 6);
  assert.equal(summarizeDifferences([1, 2, 3], 'ab12cd34').interval, null);
});

test('the pipeline reproduces from files and every standalone output carries the fixture label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'creator-analysis-'));
  try {
    writeFixtureInput(join(dir, 'input'), mixedFixture());
    const first = runAnalysis(join(dir, 'input'), join(dir, 'out'));
    const second = runAnalysis(join(dir, 'input'), join(dir, 'out2'));
    assert.equal(first.analysis.analysis_hash, second.analysis.analysis_hash);
    assert.deepEqual(
      first.checks.filter((c) => c.status === 'fail'),
      [],
    );
    assert.ok(
      first.analysis.inputs.files.some(
        (f) => f.path === 'private/raw-exports/d1.json',
      ),
    );
    for (const name of readdirSync(join(dir, 'out', 'tables'))) {
      const lines = readFileSync(join(dir, 'out', 'tables', name), 'utf8')
        .trim()
        .split('\n');
      assert.equal(lines[0]!.split(',')[0], 'data_label');
      for (const l of lines.slice(1))
        assert.ok(l.startsWith(`"${FIXTURE_LABEL}",`), `${name}: ${l}`);
    }
    for (const name of readdirSync(join(dir, 'out', 'figures')))
      assert.ok(
        readFileSync(join(dir, 'out', 'figures', name), 'utf8').includes(
          FIXTURE_LABEL,
        ),
      );
    const report = readFileSync(join(dir, 'out', 'report.md'), 'utf8');
    assert.ok(
      report.startsWith(`# Creator Agent analysis\n\n> **${FIXTURE_LABEL}**`),
    );
    assert.throws(
      () => runAnalysis(join(dir, 'input'), join(dir, 'input', 'analysis')),
      /outside the evaluation folder/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the analysis reads a real T15 rehearsal package, key and raw exports unchanged', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StudyStore(db.pool);
  const owner = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Analysis test owner',
  });
  const broker = new ModelBroker(store, {
    fixture: new FixtureAdapter(),
    live: null,
  });
  const r = await runEvaluationRehearsal(store, broker, owner, {
    secret: 'analysis-test-secret-7f3a',
  });
  // Labelled synthetic ratings: reviewer-1 rates every item 3, reviewer-2 leaves them blank.
  const ratings = Object.entries(r.reviewer_files)
    .filter(([path]) => path.endsWith('ratings.csv'))
    .map(([path, csv]) => ({
      reviewer: path.split('/')[1]!,
      csv: path.includes('reviewer-1')
        ? csv.replace(/^(\d+,[0-9a-f]+),,,,,,$/gm, '$1,3,3,3,3,3,')
        : csv,
    }));
  const a = analyze({
    package: r.package,
    key: r.private_key,
    exports: r.raw_exports,
    ratings,
    sources: [{ path: 'in-memory rehearsal', sha256: '0'.repeat(64) }],
  });
  assert.deepEqual(failing(a), []);
  assert.equal(a.data_kind, 'not_empirical');
  assert.equal(a.totals.assigned_slots, 26);
  const flowAttempts = r.package.flow.reduce(
    (n, f) => n + f.attempts.length,
    0,
  );
  assert.equal(a.totals.attempts, flowAttempts);
  const exported = r.raw_exports
    .flatMap(
      (e) =>
        (
          e.body as {
            attempts: {
              measurements: { known_simulated_spend_nano_usd: string };
            }[];
          }
        ).attempts,
    )
    .reduce(
      (n, x) => n + BigInt(x.measurements.known_simulated_spend_nano_usd),
      0n,
    );
  assert.equal(BigInt(a.totals.known_spend_usd.replace('.', '')), exported);
  const rated = a.prespecified.decision_quality;
  assert.ok(rated.length > 0);
  assert.ok(rated.every((x) => x.quality === 3 && x.complete_reviewers === 1));
  assert.equal(
    a.prespecified.completion.reduce((n, x) => n + x.blocked, 0),
    r.package.counts.blocked,
  );
});
