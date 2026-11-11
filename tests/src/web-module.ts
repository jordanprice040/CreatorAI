import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Loads a web module (apps/web/src) for a Node test, with its sibling imports transpiled the
// same way and package imports resolved as the web app resolves them.
const src = new URL('../../apps/web/src/', import.meta.url);
const nodeRequire = createRequire(new URL('index.ts', src));
const loaded = new Map<string, unknown>();
export async function loadWeb(file: string): Promise<unknown> {
  if (loaded.has(file)) return loaded.get(file);
  const source = await readFile(new URL(file, src), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const siblings = new Map<string, unknown>();
  for (const m of code.matchAll(/require\("(\.\/[^"]+)\.js"\)/g))
    siblings.set(`${m[1]}.js`, await loadWeb(`${m[1]!.slice(2)}.ts`));
  const exports = {};
  new Function('require', 'exports', code)(
    (name: string) => siblings.get(name) ?? nodeRequire(name),
    exports,
  );
  loaded.set(file, exports);
  return exports;
}
