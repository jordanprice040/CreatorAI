import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// P18: collapsible options. The open-state rules have no imports, so they load directly.
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
type Mod = {
  foldIsOpen: (
    chosen: Record<string, boolean>,
    id: string,
    attention: readonly string[],
  ) => boolean;
  chooseAll: (
    chosen: Record<string, boolean>,
    ids: readonly string[],
    open: boolean,
  ) => Record<string, boolean>;
  firstNeeding: (
    ids: readonly string[],
    needs: (id: string) => boolean,
  ) => string[];
  nameList: (names: readonly string[], max?: number) => string;
};

test('only the first item that needs the person opens by default', async () => {
  const { firstNeeding, foldIsOpen } = await load<Mod>('fold-state.ts');
  const ids = ['a', 'b', 'c'];
  const attention = firstNeeding(ids, (id) => id !== 'a');
  assert.deepEqual(attention, ['b']);
  assert.deepEqual(
    ids.map((id) => foldIsOpen({}, id, attention)),
    [false, true, false],
  );
  // Nothing to act on: everything is a summary.
  assert.deepEqual(
    firstNeeding(ids, () => false),
    [],
  );
  assert.deepEqual(
    firstNeeding([], () => true),
    [],
  );
});

test("the person's own choice wins over the default, both ways", async () => {
  const { foldIsOpen } = await load<Mod>('fold-state.ts');
  assert.equal(foldIsOpen({ b: false }, 'b', ['b']), false);
  assert.equal(foldIsOpen({ a: true }, 'a', ['b']), true);
  // An item opened by the person stays open after it stops needing attention.
  assert.equal(foldIsOpen({ b: true }, 'b', []), true);
});

test('expand all and collapse all set only the listed items', async () => {
  const { chooseAll, foldIsOpen } = await load<Mod>('fold-state.ts');
  const before = { x: true };
  const closed = chooseAll(before, ['a', 'b'], false);
  assert.deepEqual(closed, { x: true, a: false, b: false });
  assert.deepEqual(before, { x: true }, 'the earlier state is not changed');
  // Collapse all closes the attention item too.
  assert.equal(foldIsOpen(closed, 'a', ['a']), false);
  const opened = chooseAll(closed, ['a', 'b'], true);
  assert.equal(foldIsOpen(opened, 'b', []), true);
});

test('blocked actions name the items they wait on', async () => {
  const { nameList } = await load<Mod>('fold-state.ts');
  assert.equal(nameList([]), '');
  assert.equal(nameList(['A']), 'A');
  assert.equal(nameList(['A', 'B']), 'A and B');
  assert.equal(nameList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(nameList(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more');
});
