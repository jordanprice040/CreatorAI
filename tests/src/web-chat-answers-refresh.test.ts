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
  fillEmptyChoice: (form: Form, details: Detail[]) => Form;
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
  assert.equal(f.fillEmptyChoice(empty, before), empty);

  // The connections are read again after the verify write: the model is now in the form, so
  // the save body carries it.
  const after = [detail('c1', ['gpt-6-astra'])];
  assert.deepEqual(f.verifiedModels(after, 'c1'), ['gpt-6-astra']);
  assert.deepEqual(f.fillEmptyChoice(empty, after), {
    connection_id: 'c1',
    model_id: 'gpt-6-astra',
    enabled: false,
  });

  // A model the owner already picked stays when another one is verified later.
  const picked = { ...empty, model_id: 'gpt-6-astra' };
  const more = [detail('c1', ['claude-sonnet-5-5', 'gpt-6-astra'])];
  assert.equal(f.fillEmptyChoice(picked, more), picked);

  // A card read before any connection existed takes the first one once it shows.
  const none: Form = { connection_id: '', model_id: '', enabled: false };
  assert.deepEqual(f.fillEmptyChoice(none, [detail('c2', ['m2'])]), {
    connection_id: 'c2',
    model_id: 'm2',
    enabled: false,
  });
});

test('the chat answers card reads its connections again after any write here', async () => {
  // Verifying a model is a write (POST) that does not change the card's stamp; the card must
  // listen for writes and fill an empty choice from what it reads.
  const source = await readFile('apps/web/src/chat-answers.tsx', 'utf8');
  assert.match(
    source,
    /addEventListener\(STUDIO_CHANGED, changed\)[\s\S]*?removeEventListener\(STUDIO_CHANGED, changed\)/,
  );
  assert.match(source, /fillEmptyChoice\(f, details\)/);
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
  respond(ok());
  await running;
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

  // The usage button watches on the send as well as on the end.
  const usage = await readFile('apps/web/src/usage.tsx', 'utf8');
  assert.match(usage, /addEventListener\(STUDIO_WRITE_STARTED, changed\)/);
});
