import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ADR-0101 (UX pass P-5): which model drafts the Proposals page offers, and the default
// "What changed" line. The rules module has no imports, so it loads directly.
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

type Section = { state: string; text: string; draft?: { id: string } };
type Rules = {
  draftOffers: (
    drafts: unknown[],
    sections: Record<string, Section>,
    dismissed: Set<string>,
  ) => Record<string, { draft: string; value: { state: string } }>;
  newlyDrafted: (
    before: Record<string, Section>,
    now: Record<string, Section>,
  ) => string[];
  draftReason: (labels: string[]) => string;
  draftEdited: (
    key: string,
    section: Section & { draft?: { id: string; edited?: boolean } },
    drafts: unknown[],
  ) => boolean;
};

const record = (
  id: string,
  values: Record<string, unknown>,
  state = 'completed',
) => ({
  id,
  state,
  model_id: 'm',
  created_at: '2026-11-14T00:00:00Z',
  values,
});
const unknown: Section = { state: 'unknown', text: '' };
const written = (text: string, draft?: string): Section => ({
  state: 'written',
  text,
  ...(draft ? { draft: { id: draft } } : {}),
});

test('a section is offered its newest completed draft while it is still unknown', async () => {
  const { draftOffers } = await load<Rules>('proposal-draft-rules.ts');
  const drafts = [
    record('new', { methods: { state: 'written', text: 'newer' } }, 'failed'),
    record('mid', { methods: { state: 'written', text: 'mid' } }),
    record('old', {
      methods: { state: 'written', text: 'old' },
      roles: { state: 'unknown', text: 'who is on staff' },
      objectives: { state: 'written', text: 'x' },
    }),
  ];
  const offers = draftOffers(
    drafts,
    { methods: unknown, roles: unknown, objectives: written('mine') },
    new Set(),
  );
  // The failed draft offers nothing; the newest completed one wins for methods.
  assert.equal(offers.methods?.draft, 'mid');
  // A "could not draft" note is offered too, so the person sees why.
  assert.equal(offers.roles?.value.state, 'unknown');
  // A section the person wrote is offered nothing.
  assert.equal(offers.objectives, undefined);
  // Dismissing a draft for a section falls back to an older draft, then to nothing.
  const less = draftOffers(
    drafts,
    { methods: unknown },
    new Set(['mid:methods']),
  );
  assert.equal(less.methods?.draft, 'old');
  assert.deepEqual(
    draftOffers(
      drafts,
      { methods: unknown },
      new Set(['mid:methods', 'old:methods']),
    ),
    {},
  );
});

test('the default "What changed" names the sections that newly use a draft', async () => {
  const { newlyDrafted, draftReason } = await load<Rules>(
    'proposal-draft-rules.ts',
  );
  const before = {
    methods: written('a', 'd1'),
    roles: unknown,
    timeline: unknown,
  };
  const now = {
    methods: written('a, edited', 'd1'),
    roles: written('b', 'd2'),
    timeline: written('typed'),
  };
  assert.deepEqual(newlyDrafted(before, now), ['roles']);
  assert.equal(draftReason([]), 'Edited');
  assert.equal(
    draftReason(['Roles', 'Methods']),
    'Used model drafts: Roles, Methods',
  );
  assert.ok(
    draftReason(Array(80).fill('Methods and step-by-step')).length <= 300,
  );
});

test('review 1 N-1: the page says "edited" as soon as a used draft’s text changes, as the studio will on save', async () => {
  const { draftEdited } = await load<Rules>('proposal-draft-rules.ts');
  const drafts = [
    record('d1', { methods: { state: 'written', text: 'Step one.' } }),
  ];
  assert.equal(
    draftEdited('methods', written(' Step one. ', 'd1'), drafts),
    false,
  );
  assert.equal(
    draftEdited('methods', written('Step one, then two.', 'd1'), drafts),
    true,
  );
  // A draft no longer listed keeps the saved mark's own flag.
  assert.equal(
    draftEdited(
      'methods',
      { ...written('x'), draft: { id: 'gone', edited: true } },
      drafts,
    ),
    true,
  );
});
