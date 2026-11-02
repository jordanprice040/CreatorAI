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
  hasNoteDrafts: (actor: string) => boolean;
  clearOtherNoteDrafts: (actor: string) => void;
  trackNoteSave: <T>(p: Promise<T>) => Promise<T>;
  noteSavesSettled: (ms?: number) => Promise<void>;
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

test("a session starting in the tab removes only other people's drafts", async () => {
  const s = storage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = s;
  s.raw.set('unrelated', 'keep');
  const d = await load();
  d.writeNoteDraft('owner', 'ws1', { text: 'owner text', base_version: 1 });
  d.writeNoteDraft('own', 'ws1', { text: 'prefix twin', base_version: 1 });
  d.writeNoteDraft('member', 'ws2', { text: 'member text', base_version: 2 });
  assert.equal(d.hasNoteDrafts('owner'), true);
  assert.equal(d.hasNoteDrafts('ow'), false);
  // Review L-D: the owner signs in after a sign-out that was never confirmed.
  d.clearOtherNoteDrafts('owner');
  assert.equal(d.readNoteDraft('owner', 'ws1')?.text, 'owner text');
  assert.equal(d.readNoteDraft('own', 'ws1'), null);
  assert.equal(d.readNoteDraft('member', 'ws2'), null);
  assert.equal(d.hasNoteDrafts('member'), false);
  assert.deepEqual([...s.raw.keys()].sort(), [
    'creator.notes-draft.owner.ws1',
    'unrelated',
  ]);
  // Only the signed-in person's copies are written now.
  d.writeNoteDraft('member', 'ws1', { text: 'late', base_version: 0 });
  assert.equal(d.hasNoteDrafts('member'), false);
  d.writeNoteDraft('owner', 'ws1', null);
  assert.equal(d.hasNoteDrafts('owner'), false);
  // After sign-out, a save on closing the notepad cannot put a copy back.
  d.writeNoteDraft('owner', 'ws1', { text: 'pending', base_version: 1 });
  d.clearNoteDrafts();
  d.writeNoteDraft('owner', 'ws1', { text: 'pending', base_version: 1 });
  assert.equal(d.hasNoteDrafts('owner'), false);
  assert.deepEqual([...s.raw.keys()], ['unrelated']);
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

test('blocked storage still finds and removes in-memory drafts', async () => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = storage(true);
  const d = await load();
  d.writeNoteDraft('member', 'ws1', { text: 'm', base_version: 0 });
  assert.equal(d.hasNoteDrafts('member'), true);
  d.clearOtherNoteDrafts('owner');
  assert.equal(d.hasNoteDrafts('member'), false);
  assert.equal(d.readNoteDraft('member', 'ws1'), null);
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

test('sign-out can wait for a notes save in flight, and for at most the time given', async () => {
  // PR #110 L-F: the save started by blurring the field clears its copy before sign-out asks.
  const s = storage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = s;
  const d = await load();
  d.writeNoteDraft('owner', 'ws1', { text: 'a', base_version: 1, sent: 'a' });
  let land!: (v: string) => void;
  const save = d
    .trackNoteSave(new Promise<string>((r) => (land = r)))
    .then(() => d.writeNoteDraft('owner', 'ws1', null));
  const waited = d.noteSavesSettled();
  land('ok');
  await waited;
  // Checked before awaiting the save itself: its copy is already gone.
  assert.equal(d.hasNoteDrafts('owner'), false);
  await save;
  // Nothing in flight: returns at once. A save that never answers is waited for only `ms`.
  await d.noteSavesSettled();
  d.trackNoteSave(new Promise(() => undefined));
  const t = Date.now();
  await d.noteSavesSettled(30);
  assert.ok(Date.now() - t < 1000);
  // A failed save is not an error for sign-out.
  await assert.doesNotReject(
    Promise.all([
      d.trackNoteSave(Promise.reject(new Error('x'))).catch(() => undefined),
      d.noteSavesSettled(30),
    ]),
  );
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});
