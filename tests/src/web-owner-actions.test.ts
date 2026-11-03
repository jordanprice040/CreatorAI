import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  ArchiveEntityRequestSchema,
  CloseEnvelopeRequestSchema,
  RetractSupportRequestSchema,
  StoredKindSchema,
} from '@creator/contracts';

type OwnerActions = {
  REASON_MAX: { budget: number; archive: number; retract: number };
  reasonCheck: (
    raw: string,
    max: number,
  ) => { reason: string } | { error: string };
  budgetCloseBlocker: (e: {
    status: string;
    reserved: string;
    unknown: string;
    allocated: string;
  }) => string | null;
  ARCHIVABLE_KINDS: readonly string[];
  canArchive: (e: { kind: string; status: string }, role: string) => boolean;
  archiveWarning: (kind: string) => string;
  STALE_CODES: readonly string[];
};

// owner-actions.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<OwnerActions> {
  const source = await readFile('apps/web/src/owner-actions.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as OwnerActions;
  new Function('exports', code)(exports);
  return exports;
}

test('reason limits are exactly what the server schemas accept', async () => {
  const { REASON_MAX, reasonCheck } = await load();
  const cases = [
    [
      REASON_MAX.budget,
      (r: string) => ({ expected_version: 1, reason: r }),
      CloseEnvelopeRequestSchema,
    ],
    [
      REASON_MAX.archive,
      (r: string) => ({ expected_version: 1, reason: r }),
      ArchiveEntityRequestSchema,
    ],
    [
      REASON_MAX.retract,
      (r: string) => ({ reason: r }),
      RetractSupportRequestSchema,
    ],
  ] as const;
  for (const [max, body, schema] of cases) {
    const atMax = 'x'.repeat(max);
    assert.ok(schema.safeParse(body(atMax)).success, `${max} accepted`);
    assert.ok(!schema.safeParse(body(`${atMax}x`)).success, `${max}+1 refused`);
    assert.deepEqual(reasonCheck(`  ${atMax}  `, max), { reason: atMax });
    assert.ok('error' in reasonCheck(`${atMax}x`, max));
  }
  // Blank or spaces-only reasons are refused before anything is sent, as the server would.
  assert.ok('error' in reasonCheck('   ', 200));
  assert.ok(
    !CloseEnvelopeRequestSchema.safeParse({
      expected_version: 1,
      reason: '   ',
    }).success,
  );
});

test('a budget can be closed only with nothing held, mirroring closeEnvelope', async () => {
  const { budgetCloseBlocker } = await load();
  const free = {
    status: 'active',
    reserved: '0',
    unknown: '0',
    allocated: '0',
  };
  assert.equal(budgetCloseBlocker(free), null);
  // An overrun budget with nothing held can be closed too (the server only refuses closed).
  assert.equal(budgetCloseBlocker({ ...free, status: 'overrun' }), null);
  assert.match(
    budgetCloseBlocker({ ...free, status: 'closed' })!,
    /already closed/,
  );
  assert.match(budgetCloseBlocker({ ...free, reserved: '5' })!, /in flight/);
  assert.match(
    budgetCloseBlocker({ ...free, unknown: '1' })!,
    /unknown outcome/,
  );
  assert.match(
    budgetCloseBlocker({ ...free, allocated: '1000000000' })!,
    /child budget/,
  );
  const all = budgetCloseBlocker({
    status: 'active',
    reserved: '1',
    unknown: '1',
    allocated: '1',
  })!;
  assert.match(all, /in flight.*unknown.*child/);
});

test('the Library offers archiving only for hand-curated active records to members who can edit', async () => {
  const { ARCHIVABLE_KINDS, canArchive } = await load();
  for (const k of ARCHIVABLE_KINDS)
    assert.ok(StoredKindSchema.options.includes(k as never), k);
  assert.ok(canArchive({ kind: 'problem', status: 'active' }, 'owner'));
  assert.ok(canArchive({ kind: 'idea', status: 'active' }, 'editor'));
  assert.ok(!canArchive({ kind: 'problem', status: 'active' }, 'viewer'));
  assert.ok(!canArchive({ kind: 'problem', status: 'archived' }, 'owner'));
  assert.ok(!canArchive({ kind: 'problem', status: 'redacted' }, 'owner'));
  // Records with their own lifecycle are changed on their own pages, never archived here.
  for (const k of [
    'specification',
    'run',
    'product',
    'artifact',
    'decision',
    'grant',
    'source',
    'claim',
    'scorecard',
    'humility_review',
  ])
    assert.ok(!canArchive({ kind: k, status: 'active' }, 'owner'), k);
});

test('archiving a problem or option warns that its Decide and Build path stops', async () => {
  const { archiveWarning, STALE_CODES } = await load();
  assert.match(archiveWarning('problem'), /Decide stops/);
  assert.match(
    archiveWarning('alternative'),
    /selecting it and writing its spec/,
  );
  for (const k of ['idea', 'assumption', 'search_brief', 'theme_intent'])
    assert.equal(archiveWarning(k), '', k);
  // The refusals that mean the record on screen is out of date and is read again (review L-3).
  assert.deepEqual([...STALE_CODES].sort(), [
    'INVALID_TRANSITION',
    'VERSION_CONFLICT',
  ]);
});
