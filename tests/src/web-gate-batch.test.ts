import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConfirmGatesRequest, RankedCandidate } from '@creator/contracts';
import { advanceOutlook } from '@creator/contracts';
import { loadWeb } from './web-module.js';

// UX pass P-4 (as Jordan revised it) and P-3: which options can advance, the one-step gate
// confirmation's request, and when the owner's approval shows where they acted.
type Batch = ReturnType<typeof advanceOutlook>;
type Option = { cand: RankedCandidate; outlook: Batch; gates: unknown[] };
type Mod = {
  gatesConfirmableNow(c: RankedCandidate): boolean;
  batchOptions(c: readonly RankedCandidate[]): Option[];
  tickedByDefault(o: Option): boolean;
  sharedNeeded(
    o: readonly Option[],
    ticked: ReadonlySet<string>,
    own: Record<string, Record<string, string> | undefined>,
  ): string[];
  batchRequest(
    o: readonly Option[],
    ticked: ReadonlySet<string>,
    shared: Record<string, string>,
    own: Record<string, Record<string, string> | undefined>,
  ): { request: ConfirmGatesRequest } | { missing: string };
  batchSummary(r: ConfirmGatesRequest): string;
};
type Rules = {
  inlineApprovable(
    d: { status: string; kind: string; coverage: { current: boolean } },
    owner: boolean,
  ): { ok: boolean; why?: string };
  decisionInReason(r: string | null): string | null;
};
type Routine = {
  assumptionsSummary(n: number): string;
  historySummary(
    s: readonly { current: boolean; created_at: string }[],
    when: (iso: string) => string,
  ): string;
};

const GATE =
  'An ethics or access question is unresolved (a gate, not a score). Access (automatic assessment): no pip.';
const ONLY =
  'Only the automatic assessment looked at ethics or access, and it can’t clear them; a person must confirm them (Confirm on the option, edit the assessment or score it).';
const HUMILITY = 'No humility review of this exact version.';

function cand(
  n: number,
  kind: string,
  blocked: RankedCandidate['gates']['blocked'],
  details: {
    gate: 'ethics' | 'access';
    state: string;
    by?: 'system' | 'person';
  }[],
  ethics: 'clear' | 'unresolved' | 'not_assessed' = 'unresolved',
): RankedCandidate {
  return {
    alternative: {
      id: `00000000-0000-4000-8000-00000000000${n}`,
      version: 1,
      kind,
      title: `Option ${n}`,
    },
    gates: {
      ethics_access: ethics,
      discovery: null,
      humility: 'missing',
      blocked,
      gate_details: details.map((d) => ({
        gate: d.gate,
        state: d.state,
        assessed: true,
        concerns: d.by
          ? [
              {
                scorecard: `sc${n}${d.gate}@1`,
                by: d.by,
                reviewer: d.by === 'person' ? 'Ana' : 'system',
                note: 'needs pip',
              },
            ]
          : [],
        confirmation: null,
        rule: 'owner',
      })),
    },
  } as unknown as RankedCandidate;
}

// Option 1 (use existing): only the gate blocks recommending it.
const one = cand(
  1,
  'use_existing',
  {
    select_for_build: [
      'A use existing response has no software to build; it cannot be made build-ready.',
      GATE,
    ],
    recommend_alternative: [GATE],
    proceed_to_validation: [GATE],
  },
  [
    { gate: 'ethics', state: 'not_assessed' },
    { gate: 'access', state: 'unresolved', by: 'system' },
  ],
);
// Option 2 (build): humility blocks build; validation still opens once the gate is confirmed.
const two = cand(
  2,
  'build',
  {
    select_for_build: [ONLY, HUMILITY],
    recommend_alternative: [
      'Custom software is selected for build or validation, not recommended as an alternative.',
      ONLY,
    ],
    proceed_to_validation: [ONLY],
  },
  [{ gate: 'ethics', state: 'not_assessed' }],
  'not_assessed',
);
// Option 3 (failed): nothing advancing is allowed; confirming changes nothing.
const three = cand(
  3,
  'failed',
  {
    select_for_build: [
      'A failed response has no software to build; it cannot be made build-ready.',
      GATE,
    ],
    recommend_alternative: [
      'A failed outcome is not a response to recommend.',
      GATE,
    ],
    proceed_to_validation: ['A failed outcome cannot be validated.', GATE],
  },
  [{ gate: 'access', state: 'unresolved', by: 'system' }],
);
// Option 4: humility blocks build, discovery blocks validation: never, even with the gate.
const four = cand(
  4,
  'build',
  {
    select_for_build: [GATE, HUMILITY],
    recommend_alternative: [
      'Custom software is selected for build or validation, not recommended as an alternative.',
      GATE,
    ],
    proceed_to_validation: [GATE, 'Discovery disposition: rejected.'],
  },
  [{ gate: 'ethics', state: 'not_assessed' }],
);
// Option 5: a person's own concern; the owner cannot confirm it away.
const five = cand(
  5,
  'use_existing',
  { recommend_alternative: [GATE], proceed_to_validation: [GATE] },
  [{ gate: 'access', state: 'unresolved', by: 'person' }],
);
// Option 6: clear and open now.
const six = cand(6, 'change_process', {}, [], 'clear');

test('advanceOutlook says which options advance now, once the gate is confirmed, or not even then', () => {
  assert.deepEqual(advanceOutlook(one), {
    state: 'after_gates',
    choices: ['proceed_to_validation', 'recommend_alternative'],
    blocks: [],
  });
  assert.deepEqual(advanceOutlook(two).choices, ['proceed_to_validation']);
  assert.equal(advanceOutlook(two).state, 'after_gates');
  // Nothing advancing is allowed for a failed outcome: its kind's own reasons say why.
  assert.deepEqual(advanceOutlook(three), {
    state: 'never',
    choices: [],
    blocks: [
      {
        reason:
          'A failed response has no software to build; it cannot be made build-ready.',
        choices: ['select_for_build'],
      },
      {
        reason: 'A failed outcome cannot be validated.',
        choices: ['proceed_to_validation'],
      },
      {
        reason: 'A failed outcome is not a response to recommend.',
        choices: ['recommend_alternative'],
      },
    ],
  });
  // The gate's own text is left out; each other reason is listed once with what it blocks.
  assert.deepEqual(advanceOutlook(four), {
    state: 'never',
    choices: [],
    blocks: [
      { reason: HUMILITY, choices: ['select_for_build'] },
      {
        reason: 'Discovery disposition: rejected.',
        choices: ['proceed_to_validation'],
      },
    ],
  });
  assert.equal(advanceOutlook(six).state, 'now');
  assert.deepEqual(advanceOutlook(six).choices, [
    'proceed_to_validation',
    'recommend_alternative',
  ]);
});

test('the one-step form lists confirmable gates, ticks only options it lets advance, and builds the request', async () => {
  const m = (await loadWeb('gate-batch.ts')) as Mod;
  // A person's own concern is theirs to revise, so option 5 cannot be cleared here.
  assert.deepEqual(
    [one, five, six].map((c) => m.gatesConfirmableNow(c)),
    [true, false, true],
  );
  const opts = m.batchOptions([four, one, two, three, five, six]);
  // A person's concern (5) and a clear option (6) are not offered; the ones it helps come first.
  assert.deepEqual(
    opts.map((o) => o.cand.alternative.title),
    ['Option 1', 'Option 2', 'Option 4', 'Option 3'],
  );
  const ticked = new Set(
    opts.filter(m.tickedByDefault).map((o) => o.cand.alternative.id),
  );
  assert.deepEqual([...ticked], [one.alternative.id, two.alternative.id]);
  assert.deepEqual(m.sharedNeeded(opts, ticked, {}), ['ethics', 'access']);
  assert.deepEqual(m.batchRequest(opts, new Set(), {}, {}), {
    missing: 'Tick at least one option.',
  });
  assert.match(
    (
      m.batchRequest(opts, ticked, { ethics: 'Public data only.' }, {}) as {
        missing: string;
      }
    ).missing,
    /shared access reason/,
  );
  // Option 1 gets its own access reason, so no shared access reason is needed.
  const own = {
    [one.alternative.id]: { access: 'Runs on the shared server.' },
  };
  assert.deepEqual(m.sharedNeeded(opts, ticked, own), ['ethics']);
  const built = m.batchRequest(
    opts,
    ticked,
    { ethics: 'Public data only.', access: 'unused' },
    own,
  ) as { request: ConfirmGatesRequest };
  assert.deepEqual(built.request, {
    shared: { ethics: 'Public data only.', access: null },
    items: [
      {
        alternative: { id: one.alternative.id, version: 1 },
        gate: 'ethics',
        concerns_seen: [],
        reason: null,
      },
      {
        alternative: { id: one.alternative.id, version: 1 },
        gate: 'access',
        concerns_seen: ['sc1access@1'],
        reason: 'Runs on the shared server.',
      },
      {
        alternative: { id: two.alternative.id, version: 1 },
        gate: 'ethics',
        concerns_seen: [],
        reason: null,
      },
    ],
  });
  assert.equal(
    m.batchSummary(built.request),
    '3 gate confirmations for 2 options, 2 with a shared reason and 1 with the option’s own. Each is recorded as your decision on that option and gate.',
  );
  // A too-short own reason is named, not silently replaced by the shared one.
  assert.match(
    (
      m.batchRequest(
        opts,
        ticked,
        { ethics: 'Public data only.' },
        {
          [one.alternative.id]: { access: 'ok' },
        },
      ) as { missing: string }
    ).missing,
    /own access reason for “Option 1”/,
  );
});

test('the owner’s approval shows where they acted only when they can give it there', async () => {
  const r = (await loadWeb('inline-approval-rules.ts')) as Rules;
  const pending = {
    status: 'pending',
    kind: 'authorization',
    coverage: { current: true },
  };
  assert.deepEqual(r.inlineApprovable(pending, true), { ok: true });
  assert.equal(r.inlineApprovable(pending, false).ok, false);
  assert.equal(
    r.inlineApprovable({ ...pending, kind: 'choice' }, true).ok,
    false,
  );
  assert.equal(
    r.inlineApprovable({ ...pending, coverage: { current: false } }, true).ok,
    false,
  );
  assert.match(
    r.inlineApprovable({ ...pending, status: 'answered' }, true).why!,
    /answered/,
  );
  const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
  assert.equal(
    r.decisionInReason(`Error: Build admission needs_human; decision ${id}`),
    id,
  );
  assert.equal(
    r.decisionInReason('Build admission denied; decision none'),
    null,
  );
  assert.equal(r.decisionInReason(null), null);
});

test('Decide folds its assumptions and selection history under one line each', async () => {
  const m = (await loadWeb('decide-routine.ts')) as Routine;
  assert.equal(
    m.assumptionsSummary(0),
    'Assumptions for this run: none recorded',
  );
  assert.equal(m.assumptionsSummary(3), 'Assumptions for this run: 3 recorded');
  const when = (iso: string) => iso.slice(0, 10);
  assert.equal(
    m.historySummary([], when),
    'Selection history: none recorded yet',
  );
  assert.equal(
    m.historySummary(
      [
        { current: true, created_at: '2026-11-14T10:00:00Z' },
        { current: false, created_at: '2026-11-13T10:00:00Z' },
      ],
      when,
    ),
    'Selection history: 2 selections, current from 2026-11-14',
  );
});
