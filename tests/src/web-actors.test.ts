import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

/** The page map module, which has no imports: modules that import it get the real one. */
function pagesModule(): unknown {
  const code = ts.transpileModule(
    readFileSync('apps/web/src/pages.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function('exports', code)(exports);
  return exports;
}
import type { ActorSummary } from '@creator/contracts';

test('workspace actor labels ignore old responses and old failures after switching or unmount', async () => {
  for (const oldFailure of [false, true]) {
    const source = await readFile('apps/web/src/ui.tsx', 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const require = createRequire(
      new URL('../../apps/web/package.json', import.meta.url),
    );
    let actors: ActorSummary[] = [];
    let effect: (() => (() => void) | undefined) | undefined;
    const pending: {
      path: string;
      resolve: (actors: ActorSummary[]) => void;
      reject: (error: Error) => void;
    }[] = [];
    const hookRequire = (name: string) =>
      name === 'react'
        ? {
            useState: () => [
              actors,
              (next: ActorSummary[]) => {
                actors = next;
              },
            ],
            useEffect: (next: typeof effect) => {
              effect = next;
            },
          }
        : name === './oversight.js'
          ? {
              api: (_schema: unknown, path: string) =>
                new Promise<ActorSummary[]>((resolve, reject) => {
                  pending.push({ path, resolve, reject });
                }),
            }
          : name === './pages.js'
            ? pagesModule()
            : name === './labels.js'
              ? {}
              : require(name);
    const exports: {
      useActors?: (workspace: string) => (id: string) => string;
    } = {};
    new Function('require', 'exports', code)(hookRequire, exports);
    const id = '00000000-0000-4000-8000-000000000001';
    const actor = (name: string): ActorSummary => ({
      id,
      kind: 'human',
      display_name: name,
    });
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    exports.useActors!('A');
    const cleanupA = effect!();
    cleanupA!();
    exports.useActors!('B');
    const cleanupB = effect!();
    assert.deepEqual(
      pending.map((request) => request.path),
      ['workspaces/A/actors', 'workspaces/B/actors'],
    );
    pending[1]!.resolve([actor('Current owner')]);
    await settle();
    if (oldFailure) pending[0]!.reject(new Error('Old workspace unavailable'));
    else pending[0]!.resolve([actor('Old owner')]);
    await settle();
    assert.equal(exports.useActors!('B')(id), 'Current owner');
    cleanupB!();
    exports.useActors!('C');
    const cleanupC = effect!();
    cleanupC!();
    pending[2]!.resolve([actor('Unmounted owner')]);
    await settle();
    assert.deepEqual(actors, []);
  }
});
