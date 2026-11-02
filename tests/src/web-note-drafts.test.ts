import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ADR-0060 re-review N-1 and L-B: unsaved notes copies belong to one person, are cleared on
// sign-out, and still cover closing the notepad when session storage is blocked.
// note-drafts.ts has no imports, so it loads directly.
type Draft = { text: string; base_version: number; sent?: string };
type Drafts = {
  readNoteDraft: (actor: string, ws: string) => Draft | null;
  writeNoteDraft: (actor: string, ws: string, d: Draft | null) => void;
  clearNoteDrafts: () => void;
};
async function load(): Promise<Drafts> {
  const source = await readFile('apps/web/src/note-drafts.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Drafts;
  new Function('exports', code)(exports);
  return exports;
}
function storage(blocked = false) {
  const m = new Map<string, string>();
  const no = () => {
    throw new Error('blocked');
  };
  return {
    get length() {
      return blocked ? no() : m.size;
    },
    key: (i: number) => (blocked ? no() : ([...m.keys()][i] ?? null)),
    getItem: (k: string) => (blocked ? no() : (m.get(k) ?? null)),
    setItem: (k: string, v: string) => (blocked ? no() : void m.set(k, v)),
    removeItem: (k: string) => (blocked ? no() : void m.delete(k)),
    raw: m,
  };
}

test('notes drafts are per person and workspace and cleared on sign-out', async () => {
  const s = storage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = s;
  s.raw.set('unrelated', 'keep');
  const d = await load();
  d.writeNoteDraft('owner', 'ws1', { text: 'private', base_version: 3 });
  assert.deepEqual(d.readNoteDraft('owner', 'ws1'), {
    text: 'private',
    base_version: 3,
  });
  // Another person on the same tab and workspace sees nothing.
  assert.equal(d.readNoteDraft('member', 'ws1'), null);
  assert.equal(d.readNoteDraft('owner', 'ws2'), null);
  d.writeNoteDraft('owner', 'ws2', { text: 'x', base_version: 0, sent: 'y' });
  assert.equal(d.readNoteDraft('owner', 'ws2')?.sent, 'y');
  d.clearNoteDrafts();
  assert.equal(d.readNoteDraft('owner', 'ws1'), null);
  assert.equal(d.readNoteDraft('owner', 'ws2'), null);
  assert.deepEqual([...s.raw.keys()], ['unrelated']);
});

test('notes drafts fall back to memory when session storage is blocked', async () => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = storage(true);
  const d = await load();
  d.writeNoteDraft('owner', 'ws1', { text: 'kept', base_version: 1 });
  assert.equal(d.readNoteDraft('owner', 'ws1')?.text, 'kept');
  assert.equal(d.readNoteDraft('member', 'ws1'), null);
  d.clearNoteDrafts();
  assert.equal(d.readNoteDraft('owner', 'ws1'), null);
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});
