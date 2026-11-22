import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Claim tags ("C1", "C2" …) in discovery, exploration and assessment text link to the claim
// under Sources and preview it on hover or focus; a tag the packet does not hold stays text.

type RefClaim = { claim_id: string; statement: string; status: string };
type Part = string | { ref: string; claim: RefClaim };
type Rules = {
  hasClaimTag(text: string): boolean;
  splitClaimRefs(text: string, refs: Map<string, RefClaim> | null): Part[];
  previewText(statement: string, max?: number): string;
};

const web = createRequire(
  new URL('../../apps/web/src/claim-ref.tsx', import.meta.url),
);

/** A web module compiled for Node; `stubs` stand in for its sibling imports. */
async function compile<T>(file: string, stubs: Record<string, unknown> = {}) {
  const code = ts.transpileModule(
    await readFile(`apps/web/src/${file}`, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {} as T;
  new Function('require', 'exports', code)(
    (n: string) => (n in stubs ? stubs[n] : web(n)),
    exports,
  );
  return exports;
}

const C3: RefClaim = {
  claim_id: '33333333-3333-4333-8333-333333333333',
  statement: 'Clinic staff re-key intake forms by hand every morning.',
  status: 'supported',
};
const C12: RefClaim = {
  claim_id: '12121212-1212-4212-8212-121212121212',
  statement: 'Two vendors already sell intake form scanning.',
  status: 'needs_recheck',
};
const refs = new Map([
  ['C3', C3],
  ['C12', C12],
]);

test('tags the packet holds become links; everything else stays as written', async () => {
  const r = await compile<Rules>('claim-refs.ts');
  assert.deepEqual(
    r.splitClaimRefs('Cites C3, whose evidence is weak.', refs),
    ['Cites ', { ref: 'C3', claim: C3 }, ', whose evidence is weak.'],
  );
  assert.deepEqual(r.splitClaimRefs('C3 and C12 (C3).', refs), [
    { ref: 'C3', claim: C3 },
    ' and ',
    { ref: 'C12', claim: C12 },
    ' (',
    { ref: 'C3', claim: C3 },
    ').',
  ]);
  // Not in the packet, part of a longer word or code, or no packet read yet: plain text.
  for (const text of ['C4 is unknown.', 'ABC3 C3x C-3 C30 C1', 'C03'])
    assert.deepEqual(r.splitClaimRefs(text, refs), [text], text);
  // Checking a text for tags first (as the page does) leaves the split unchanged.
  const text = 'An existing tool already covers the need (C3): yes.';
  assert.equal(r.hasClaimTag(text), true);
  assert.deepEqual(r.splitClaimRefs(text, refs), [
    'An existing tool already covers the need (',
    { ref: 'C3', claim: C3 },
    '): yes.',
  ]);
  // A discovery run's draft tag, in any case and with any dash, is not this packet's claim.
  for (const text of [
    'draft-C3',
    'Draft–C3',
    'DRAFT—C3',
    'see draft-C3 and draft–C12',
  ])
    assert.deepEqual(r.splitClaimRefs(text, refs), [text], text);
  assert.deepEqual(r.splitClaimRefs('draft-C3 and C3', refs), [
    'draft-C3 and ',
    { ref: 'C3', claim: C3 },
  ]);
  // Both ends of a range link, whatever the dash.
  for (const dash of ['-', '–', '—'])
    assert.deepEqual(r.splitClaimRefs(`C3${dash}C12`, refs), [
      { ref: 'C3', claim: C3 },
      dash,
      { ref: 'C12', claim: C12 },
    ]);
  assert.deepEqual(r.splitClaimRefs('Cites C3.', null), ['Cites C3.']);
  assert.deepEqual(r.splitClaimRefs('Cites C3.', new Map()), ['Cites C3.']);
});

test('the packet is read only when the text has something shaped like a tag', async () => {
  const r = await compile<Rules>('claim-refs.ts');
  assert.equal(r.hasClaimTag('Claim C3 is supported.'), true);
  assert.equal(r.hasClaimTag('C99'), true);
  // Repeated calls give the same answer (a global pattern keeps no state between texts).
  assert.equal(r.hasClaimTag('C1'), true);
  assert.equal(r.hasClaimTag('C1'), true);
  for (const text of ['No claims cited.', 'C0', 'MC3', 'C3PO', 'c3', ''])
    assert.equal(r.hasClaimTag(text), false, text);
});

test('a preview keeps whole words and stays short', async () => {
  const r = await compile<Rules>('claim-refs.ts');
  assert.equal(r.previewText('  A  short\nclaim. '), 'A short claim.');
  const long = 'word '.repeat(100).trim();
  const p = r.previewText(long, 50);
  assert.ok(p.length <= 50, p);
  assert.ok(p.endsWith('word…'), p);
});

test('a tag renders as a link to its claim under Sources, described by the claim', async () => {
  const server = web('react-dom/server') as {
    renderToStaticMarkup: (e: unknown) => string;
  };
  const { createElement } = web('react') as {
    createElement: (c: unknown, p: unknown, ...k: unknown[]) => unknown;
  };
  const rules = await compile<Rules>('claim-refs.ts');
  const mod = await compile<{ ClaimText: unknown }>('claim-ref.tsx', {
    './claim-refs.js': rules,
    './terms.js': await compile('terms.ts'),
    './pages.js': {
      routeHash: (r: { view: string; ws: string; id: string }) =>
        `#/${r.view}?ws=${r.ws}&id=${encodeURIComponent(r.id)}`,
    },
    './oversight.js': { api: () => Promise.reject(new Error('not read')) },
    '@creator/contracts': web('@creator/contracts'),
    './claim-ref.css': {},
  });
  const render = (text: string, map: Map<string, RefClaim> | null) =>
    server.renderToStaticMarkup(
      createElement(mod.ClaimText, { ws: 'w1', text, refs: map }),
    );
  assert.equal(render('Cites C3.', null), 'Cites C3.');
  const html = render('Cites C3; C4 is not in the packet.', refs);
  assert.match(
    html,
    new RegExp(
      `<a class="claim-ref" href="#/evidence\\?ws=w1&amp;id=claim%3A${C3.claim_id}" aria-describedby="([^"]+)-claim \\1-status">C3</a>`,
    ),
  );
  const [claimId, statusId] = /aria-describedby="([^"]+)"/
    .exec(html)![1]!
    .split(' ');
  // A screen reader hears the statement and its status; the status is as this run read it.
  assert.ok(html.includes(`<span id="${claimId}">${C3.statement}</span>`));
  assert.ok(
    html.includes(
      `<span id="${statusId}">supported when this run read it</span>`,
    ),
    html,
  );
  // The preview is closed until hover or focus.
  assert.match(html, /role="tooltip" class="claim-ref-tip" hidden=""/);
  assert.match(html, /<span aria-hidden="true">Claim C3 · <\/span>/);
  assert.ok(html.includes('; C4 is not in the packet.'), html);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
});
