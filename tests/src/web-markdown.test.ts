import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Chat shows model answers as Markdown. markdown.ts has no imports, so it loads directly; the
// view only maps this tree to React elements, so the tree is where safety is decided.
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

type Node = { t: string; [k: string]: unknown };
type Mod = {
  parseMarkdown: (s: string) => Node[];
  inline: (s: string) => Node[];
  safeHref: (s: string) => string | null;
};
const mod = load<Mod>('markdown.ts');

const links = (tree: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const n = v as Node;
      if (n.t === 'link') out.push(n.href as string);
      Object.values(n).forEach(walk);
    }
  };
  walk(tree);
  return out;
};

test('the answer from the screenshot renders headings, bold and a list', async () => {
  const { parseMarkdown } = await mod;
  const tree = parseMarkdown(
    [
      '**Creator Agent is a personal product studio:** a workspace for turning a problem',
      'into a product.',
      '',
      '### Its purpose',
      'To make product exploration more structured:',
      '- Identify a specific problem and who experiences it.',
      '- Gather evidence rather than rely only on assumptions.',
      '',
      '### How to use it',
      '1. Open **Sources**.',
      '2. Run a discovery.',
    ].join('\n'),
  );
  assert.deepEqual(
    tree.map((b) => b.t),
    ['para', 'heading', 'para', 'list', 'heading', 'list'],
  );
  const first = tree[0]!.c as Node[];
  assert.equal(first[0]!.t, 'strong');
  assert.equal(first[2]!.t, 'br');
  assert.equal(tree[1]!.level, 3);
  // A paragraph followed directly by a list (no blank line) still starts the list.
  assert.equal((tree[3]!.items as unknown[]).length, 2);
  assert.equal(tree[5]!.ordered, true);
  assert.equal(tree[5]!.start, 1);
});

test('raw HTML stays text and only absolute web or mail links are kept', async () => {
  const { parseMarkdown, safeHref } = await mod;
  const tree = parseMarkdown(
    '<script>alert(1)</script> <img src=x onerror=alert(1)>\n' +
      '[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c](data:text/html,x) ' +
      '[d](/relative) [e](vbscript:x) [f](https://example.com/a_(b)) <mailto:x@y.z> ' +
      'see https://example.org/x.',
  );
  assert.deepEqual(links(tree), [
    'https://example.com/a_(b)',
    'mailto:x@y.z',
    'https://example.org/x',
  ]);
  const text = JSON.stringify(tree);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  // The refused links keep their label as plain text.
  assert.equal(safeHref('java\nscript:alert(1)'), null);
  assert.equal(safeHref('https://'), null);
  assert.equal(safeHref(' https://ok.example '), 'https://ok.example/');
});

test('code keeps its characters and marks inside code are not formatting', async () => {
  const { parseMarkdown, inline } = await mod;
  const tree = parseMarkdown('```py\nx = 2 * 3 * 4\n<b>\n```\nafter');
  assert.deepEqual(tree[0], { t: 'code', lang: 'py', v: 'x = 2 * 3 * 4\n<b>' });
  assert.equal(tree[1]!.t, 'para');
  assert.deepEqual(inline('use `a **b** c` now'), [
    { t: 'text', v: 'use ' },
    { t: 'code', v: 'a **b** c' },
    { t: 'text', v: ' now' },
  ]);
  // An unclosed fence runs to the end instead of losing text.
  assert.deepEqual(parseMarkdown('```\nopen'), [
    { t: 'code', lang: '', v: 'open' },
  ]);
});

test('unmatched or intraword marks stay literal', async () => {
  const { inline } = await mod;
  assert.deepEqual(inline('2 * 3 = 6 and snake_case_name'), [
    { t: 'text', v: '2 * 3 = 6 and snake_case_name' },
  ]);
  assert.deepEqual(inline('\\*not em\\*'), [{ t: 'text', v: '*not em*' }]);
  assert.deepEqual(inline('**bold *and em***'), [
    {
      t: 'strong',
      c: [
        { t: 'text', v: 'bold ' },
        { t: 'em', c: [{ t: 'text', v: 'and em' }] },
      ],
    },
  ]);
});

test('nested lists, quotes, tables and rules', async () => {
  const { parseMarkdown } = await mod;
  const tree = parseMarkdown(
    [
      '- one',
      '  - inner',
      '- two',
      '',
      '> quoted **text**',
      '',
      '---',
      '',
      '| Name | Cost |',
      '| :--- | ---: |',
      '| a \\| b | $0 |',
    ].join('\n'),
  );
  assert.deepEqual(
    tree.map((b) => b.t),
    ['list', 'quote', 'rule', 'table'],
  );
  const items = tree[0]!.items as Node[][];
  assert.equal(items.length, 2);
  assert.deepEqual(
    items[0]!.map((b) => b.t),
    ['para', 'list'],
  );
  assert.deepEqual(tree[3]!.align, ['left', 'right']);
  const rows = tree[3]!.rows as Node[][][];
  assert.deepEqual(rows[0]![0], [{ t: 'text', v: 'a | b' }]);
});

test('deep nesting and very long answers stay bounded', async () => {
  const { parseMarkdown } = await mod;
  const deep = parseMarkdown('>'.repeat(5000) + ' x');
  let depth = 0;
  let node: Node | undefined = deep[0];
  while (node?.t === 'quote') {
    depth++;
    node = (node.c as Node[])[0];
  }
  assert.ok(depth <= 8);
  const stars = parseMarkdown('*'.repeat(20000) + 'x');
  assert.ok(Array.isArray(stars));
});
