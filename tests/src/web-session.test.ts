import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { SessionInfo } from '@creator/contracts';

test('browser session retains sign-in on failed logout and clears it after confirmed retry', async () => {
  // Execute the actual browser hook with state slots; no DOM or new test dependency needed.
  const source = await readFile('apps/web/src/oversight.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const slots: unknown[] = [];
  // ADR-0060 review N-1: unsaved notes copies are cleared only by a confirmed sign-out.
  let cleared = 0;
  // ADR-0072: the transfer tray is emptied by the same confirmed sign-out.
  let transfersReset = 0;
  // PR #141 review L7: a session starting here drops other people's transfers too.
  const transfersKeptFor: string[] = [];
  // Review L-D/L-E: other people's copies go when a session starts; unsaved text asks first.
  let drafts = false;
  // PR #110 L-F: a notes save in flight lands (and clears the copy) before sign-out asks.
  let landing = false;
  let settledWaits = 0;
  let confirmAnswer = true;
  const confirms: string[] = [];
  const keptFor: string[] = [];
  let cursor = 0;
  const require = createRequire(
    new URL('../../apps/web/package.json', import.meta.url),
  );
  const hookRequire = (name: string) =>
    name === 'react'
      ? {
          useState: (initial: unknown) => {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [
              slots[index],
              (value: unknown) => {
                slots[index] = value;
              },
            ];
          },
          useEffect: () => undefined,
        }
      : name === './page-drafts.js'
        ? { usePageActive: () => true, useOnShow: () => undefined }
        : name === './labels.js' ||
            name === './routine-policy.js' ||
            name === './fold.js' ||
            name === './amounts.js' ||
            name === './plain-words.js' ||
            name === './view-mode.js'
          ? {}
          : name === './transfers.js'
            ? {
                resetTransfers: () => void transfersReset++,
                clearOtherTransfers: (actor: string) =>
                  void transfersKeptFor.push(actor),
              }
            : name === './note-drafts.js'
              ? {
                  clearNoteDrafts: () => void cleared++,
                  hasNoteDrafts: () => drafts,
                  noteSavesSettled: async () => {
                    settledWaits++;
                    if (landing) drafts = false;
                  },
                  clearOtherNoteDrafts: (actor: string) =>
                    void keptFor.push(actor),
                }
              : require(name);
  const window = {
    dispatchEvent: () => true,
    confirm: (text: string) => {
      confirms.push(text);
      return confirmAnswer;
    },
  };
  const signedIn: SessionInfo = {
    authenticated: true,
    actor_id: '00000000-0000-4000-8000-0000000000a1',
    display_name: 'Owner',
    method: 'dev_local',
    csrf_token: 'c'.repeat(43),
    expires_at: '2026-11-02T12:00:00.000Z',
  };
  let response: 'network' | 'server' | 'success' = 'network';
  const requests: { path: string; init: RequestInit }[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path === '/api/auth/dev-login')
      return new Response(JSON.stringify(signedIn), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    requests.push({ path, init });
    if (response === 'network') throw new TypeError('Network unavailable');
    return new Response(
      JSON.stringify(
        response === 'server'
          ? {
              error: {
                code: 'STORAGE_UNAVAILABLE',
                message: 'Database unavailable',
              },
            }
          : { signed_out: true },
      ),
      {
        status: response === 'server' ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };
  const exports: {
    useSession?: (persistent: boolean) => {
      session: SessionInfo | null;
      error: string;
      signIn: (code: string) => Promise<void>;
      signOut: () => Promise<void>;
    };
  } = {};
  new Function('require', 'exports', 'fetch', 'window', code)(
    hookRequire,
    exports,
    fetch,
    window,
  );
  const render = () => {
    cursor = 0;
    return exports.useSession!(false);
  };
  render();
  // A sign-in in this tab removes everyone else's notes copies (review L-D).
  await render().signIn('x'.repeat(32));
  assert.deepEqual(render().session, signedIn);
  assert.deepEqual(keptFor, [signedIn.actor_id]);
  assert.deepEqual(transfersKeptFor, [signedIn.actor_id]);
  const session = { actor_id: signedIn.actor_id, csrf_token: 'session-csrf' };
  slots[0] = session;
  // A save already on its way when Sign out is clicked is waited for; once it lands nothing is
  // unsaved, so no warning (PR #110 L-F). The logout request is still sent (network failure here).
  drafts = true;
  landing = true;
  await render().signOut();
  assert.equal(settledWaits, 1);
  assert.equal(confirms.length, 0);
  assert.equal(requests.length, 1);
  requests.length = 0;
  landing = false;
  // Unsaved notes text: declining the warning keeps the session and sends nothing (review L-E).
  drafts = true;
  confirmAnswer = false;
  await render().signOut();
  assert.equal(render().session, session);
  assert.equal(confirms.length, 1);
  assert.match(confirms[0]!, /not saved/);
  assert.equal(requests.length, 0);
  confirmAnswer = true;
  for (const failure of ['network', 'server'] as const) {
    response = failure;
    await render().signOut();
    assert.equal(render().session, session);
    assert.match(render().error, /Sign-out was not confirmed.*Try again/);
    assert.equal(cleared, 0);
    assert.equal(transfersReset, 0);
  }
  response = 'success';
  await render().signOut();
  assert.equal(render().session, null);
  assert.equal(render().error, '');
  assert.equal(cleared, 1);
  assert.equal(transfersReset, 1);
  assert.equal(requests.length, 3);
  // Each attempt asked once because unsaved text was there.
  assert.equal(confirms.length, 4);
  for (const request of requests) {
    assert.equal(request.path, '/api/auth/logout');
    assert.equal(request.init.method, 'POST');
    assert.equal(
      (request.init.headers as Record<string, string>)['X-CSRF-Token'],
      'session-csrf',
    );
  }
});
