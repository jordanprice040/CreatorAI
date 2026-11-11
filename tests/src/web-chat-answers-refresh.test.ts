import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { loadWeb } from './web-module.js';

// P26, walkthrough item 9: after a model is verified, the chat answers card offered it in its
// Model list while the form still held no model, so a save sent none until "Reset fields".
type Detail = {
  connection: { id: string };
  model_access: { model_id: string; access: string; path: string }[];
};
type Form = { connection_id: string; model_id: string; enabled: boolean };
type FormModule = {
  verifiedModels: (details: Detail[], id: string) => string[];
  matchOfferedChoice: (form: Form, details: Detail[]) => Form;
  savedModelNote: (
    saved: { connection_id: string | null; model_id: string | null } | null,
    form: Form,
    details: Detail[],
  ) => string;
};
const detail = (id: string, verified: string[]): Detail => ({
  connection: { id },
  model_access: [
    ...verified.map((model_id) => ({
      model_id,
      access: 'verified',
      path: 'responses',
    })),
    // A refused model, or one verified on another path, is never offered for chat.
    { model_id: 'refused-model', access: 'refused', path: 'responses' },
    { model_id: 'other-path', access: 'verified', path: 'codex' },
  ],
});

test('a model verified after the card loaded fills the empty Model field, and a pick stays', async () => {
  const f = (await loadWeb('chat-answers-form.ts')) as FormModule;
  const empty: Form = { connection_id: 'c1', model_id: '', enabled: false };

  // Before verification: nothing to fill, and the same form comes back (no re-render loop).
  const before = [detail('c1', [])];
  assert.equal(f.matchOfferedChoice(empty, before), empty);

  // The connections are read again after the verify write: the model is now in the form, so
  // the save body carries it.
  const after = [detail('c1', ['gpt-6-astra'])];
  assert.deepEqual(f.verifiedModels(after, 'c1'), ['gpt-6-astra']);
  assert.deepEqual(f.matchOfferedChoice(empty, after), {
    connection_id: 'c1',
    model_id: 'gpt-6-astra',
    enabled: false,
  });

  // A model the owner already picked stays when another one is verified later.
  const picked = { ...empty, model_id: 'gpt-6-astra' };
  const more = [detail('c1', ['claude-sonnet-5-5', 'gpt-6-astra'])];
  assert.equal(f.matchOfferedChoice(picked, more), picked);

  // A card read before any connection existed takes the first one once it shows.
  const none: Form = { connection_id: '', model_id: '', enabled: false };
  assert.deepEqual(f.matchOfferedChoice(none, [detail('c2', ['m2'])]), {
    connection_id: 'c2',
    model_id: 'm2',
    enabled: false,
  });

  // PR #170 review N-3: a saved model no longer verified (a recheck refused it) is not kept
  // behind a select that shows another one; the form takes what the select shows.
  const stale = { ...empty, model_id: 'refused-model', enabled: true };
  assert.deepEqual(f.matchOfferedChoice(stale, after), {
    connection_id: 'c1',
    model_id: 'gpt-6-astra',
    enabled: true,
  });
  // With no verified model left, the form holds none, matching "No verified model".
  assert.equal(
    f.matchOfferedChoice({ ...stale, model_id: 'gpt-6-astra' }, before)
      .model_id,
    '',
  );
  // A saved connection that is gone moves to the first one shown, with its model.
  assert.deepEqual(
    f.matchOfferedChoice({ ...stale, connection_id: 'gone' }, after),
    { connection_id: 'c1', model_id: 'gpt-6-astra', enabled: true },
  );
  // Before any connection is read, the form is left alone.
  assert.equal(f.matchOfferedChoice(stale, []), stale);
});

test('the card says when the saved model is no longer verified and what a save would use', async () => {
  // PR #170 re-review RN-1: until the owner saves, chat keeps the refused saved model.
  const f = (await loadWeb('chat-answers-form.ts')) as FormModule;
  const details = [detail('c1', ['gpt-6-astra']), detail('c2', ['m2'])];
  const form: Form = {
    connection_id: 'c1',
    model_id: 'gpt-6-astra',
    enabled: true,
  };
  const note = f.savedModelNote(
    { connection_id: 'c1', model_id: 'refused-model' },
    form,
    details,
  );
  assert.match(note, /refused-model is no longer verified/);
  assert.match(note, /Save to use gpt-6-astra/);
  // A saved model still verified, nothing saved yet, or connections not read yet: no note.
  assert.equal(
    f.savedModelNote(
      { connection_id: 'c1', model_id: 'gpt-6-astra' },
      form,
      details,
    ),
    '',
  );
  assert.equal(
    f.savedModelNote({ connection_id: null, model_id: null }, form, details),
    '',
  );
  assert.equal(
    f.savedModelNote(
      { connection_id: 'c1', model_id: 'refused-model' },
      form,
      [],
    ),
    '',
  );
  // The owner has picked another connection: the note names no replacement.
  const other = f.savedModelNote(
    { connection_id: 'c1', model_id: 'refused-model' },
    { ...form, connection_id: 'c2', model_id: 'm2' },
    details,
  );
  assert.match(other, /until you save another/);
});

test('wiring check: the chat answers card listens for writes while shown', async () => {
  // A wiring check only, not a behaviour test (PR #170 review N-2): the card's behaviour is
  // covered by matchOfferedChoice above and the api() test below; this only guards that the
  // card still subscribes to writes, reads only while its page is shown, and applies the match.
  const source = await readFile('apps/web/src/chat-answers.tsx', 'utf8');
  assert.match(
    source,
    /addEventListener\(STUDIO_CHANGED, changed\)[\s\S]*?removeEventListener\(STUDIO_CHANGED, changed\)/,
  );
  assert.match(source, /if \(shown\.current\)/);
  // RN-2: a successful read clears an earlier read error; actions keep their own error.
  assert.match(source, /setDetails\(d\);\s*setReadError\(''\)/);
  assert.match(source, /matchOfferedChoice\(f, details\)/);
});

// P26, walkthrough item 13: a qualification run is one request lasting minutes, so the usage
// count must start its fast reads when a write is sent, not only after it ends.
test('a write is announced when it is sent, before its response arrives', async () => {
  const source = await readFile('apps/web/src/oversight.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const nodeRequire = createRequire(
    new URL('../../apps/web/package.json', import.meta.url),
  );
  const events: string[] = [];
  let respond: (r: Response) => void = () => undefined;
  const window = {
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
  const fetch = () =>
    new Promise<Response>((resolve) => {
      respond = resolve;
    });
  const exports = {} as {
    api: (
      schema: unknown,
      path: string,
      init?: { body?: unknown; quiet?: boolean },
    ) => Promise<unknown>;
    STUDIO_CHANGED: string;
    STUDIO_WRITE_STARTED: string;
    writeOpen: () => boolean;
  };
  new Function('require', 'exports', 'window', 'fetch', code)(
    (name: string) =>
      name.startsWith('./') || name.startsWith('react')
        ? new Proxy({}, { get: () => () => undefined })
        : nodeRequire(name),
    exports,
    window,
    fetch,
  );
  const { z } = nodeRequire(
    '@creator/contracts',
  ) as typeof import('@creator/contracts');
  const ok = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const running = exports.api(z.unknown(), 'workspaces/w/run', { body: {} });
  assert.deepEqual(events, [exports.STUDIO_WRITE_STARTED]);
  // PR #170 review L-1: the usage button keeps reading fast while this write is open.
  assert.equal(exports.writeOpen(), true);
  respond(ok());
  await running;
  assert.equal(exports.writeOpen(), false);
  assert.deepEqual(events, [
    exports.STUDIO_WRITE_STARTED,
    exports.STUDIO_CHANGED,
  ]);

  // A read, or a quiet write, announces nothing.
  events.length = 0;
  const read = exports.api(z.unknown(), 'workspaces/w/usage');
  respond(ok());
  await read;
  const quiet = exports.api(z.unknown(), 'workspaces/w/note', {
    body: {},
    quiet: true,
  });
  respond(ok());
  await quiet;
  assert.deepEqual(events, []);

  // Wiring check only: the usage button watches on the send as well as on the end.
  const usage = await readFile('apps/web/src/usage.tsx', 'utf8');
  assert.match(usage, /addEventListener\(STUDIO_WRITE_STARTED, changed\)/);
});
