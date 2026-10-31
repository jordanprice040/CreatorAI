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
        ? { usePageActive: () => true }
        : require(name);
  let response: 'network' | 'server' | 'success' = 'network';
  const requests: { path: string; init: RequestInit }[] = [];
  const fetch = async (path: string, init: RequestInit) => {
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
      signOut: () => Promise<void>;
    };
  } = {};
  new Function('require', 'exports', 'fetch', code)(
    hookRequire,
    exports,
    fetch,
  );
  const render = () => {
    cursor = 0;
    return exports.useSession!(false);
  };
  render();
  const session = { csrf_token: 'session-csrf' };
  slots[0] = session;
  for (const failure of ['network', 'server'] as const) {
    response = failure;
    await render().signOut();
    assert.equal(render().session, session);
    assert.match(render().error, /Sign-out was not confirmed.*Try again/);
  }
  response = 'success';
  await render().signOut();
  assert.equal(render().session, null);
  assert.equal(render().error, '');
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.path, '/api/auth/logout');
    assert.equal(request.init.method, 'POST');
    assert.equal(
      (request.init.headers as Record<string, string>)['X-CSRF-Token'],
      'session-csrf',
    );
  }
});
