import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPreviewServer } from '@creator/api';
import { specGuide } from '@creator/db';
import { BUILD_FIXTURE_SPEC } from '@creator/domain';
import type { SpecBody } from '@creator/contracts';

// PR #94 review Lows: the preview page's "How to use it" (flows of a many-task spec, a page
// without a guide, examples whose arguments do not fit one per line) and the terminal panel's
// "Use these arguments".

const spec = (over: Partial<SpecBody> = {}): SpecBody =>
  ({
    ...BUILD_FIXTURE_SPEC,
    format: 'spec/1',
    alternative: { id: '00000000-0000-4000-8000-000000000001', version: 1 },
    selection_id: '00000000-0000-4000-8000-000000000002',
    ...over,
  }) as SpecBody;

test('a task whose checks name no flow shows only flows no other task claims', () => {
  const base = spec();
  const tasks = [
    { ...base.tasks[0]!, key: 'T1', acceptance: ['A1'] },
    { ...base.tasks[0]!, key: 'T2', acceptance: ['A2'] },
    { ...base.tasks[0]!, key: 'T3', acceptance: ['A3'] },
  ];
  const s = spec({
    user_flows: [
      ...base.user_flows,
      { key: 'F3', name: 'Shared notes', steps: ['Read the notes'] },
    ],
    acceptance_checks: [
      ...base.acceptance_checks,
      { ...base.acceptance_checks[0]!, key: 'A3', flow: null },
    ],
    tasks,
  });
  // Its own flow when a check names one.
  assert.deepEqual(
    specGuide(s, 'T1')!.flows.map((f) => f.key),
    ['F1'],
  );
  // T3's check names none: F1 and F2 belong to T1 and T2, so only F3 is shown.
  assert.deepEqual(
    specGuide(s, 'T3')!.flows.map((f) => f.key),
    ['F3'],
  );
  // A one-task spec with no flow on its checks still shows every flow.
  const single = spec({
    acceptance_checks: base.acceptance_checks.map((a) => ({
      ...a,
      flow: null,
    })),
    tasks: [{ ...base.tasks[0]!, key: 'T1', acceptance: ['A1', 'A2'] }],
  });
  assert.deepEqual(
    specGuide(single, 'T1')!.flows.map((f) => f.key),
    ['F1', 'F2'],
  );
  assert.equal(specGuide(s, 'T9'), null);
});

type Guide = NonNullable<ReturnType<typeof specGuide>>;
async function previewPage(guide: Guide | null) {
  const id = '11111111-2222-4333-8444-555555555555';
  const store = {
    openPreview: async () => 'sess',
    previewAccess: async () => ({
      preview: {
        manifest_sha256: 'ab'.repeat(32),
        expires_at: '2026-11-01T00:00:00Z',
        runs_used: 0,
        max_runs: 10,
      },
      record: {
        manifest: {
          id: 'a05e1ae5-0000-4000-8000-000000000000',
          repository: { commit: 'a05e1ae526aa' },
          spec: { version: 2 },
          toolchain: { backend: 'wsl2-bwrap-systemd' },
          startup: { command: ['python3', '-I', 'src/main.py'] },
        },
      },
      guide,
    }),
  };
  const srv = createPreviewServer(store as never, {} as never);
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  try {
    const origin = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const page = await fetch(`${origin}/preview/${id}`, {
      headers: { Cookie: `creator_preview_${id.replaceAll('-', '')}=sess` },
    });
    assert.equal(page.status, 200);
    const script = await (
      await fetch(`${origin}/preview-assets/preview.js`)
    ).text();
    const style = await (
      await fetch(`${origin}/preview-assets/preview.css`)
    ).text();
    return { html: await page.text(), script, style };
  } finally {
    srv.close();
  }
}

test('a preview without a usage guide says so and offers no example button', async () => {
  const { html, style } = await previewPage(null);
  assert.match(html, /<h2>How to use it<\/h2>/);
  assert.match(
    html,
    /spec version this package was built from is not available/,
  );
  assert.doesNotMatch(
    html,
    /data-example|What it does|Examples? from the spec/,
  );
  // No placeholder either: there is no example to suggest.
  assert.doesNotMatch(html, /placeholder=/);
  // Placeholders have their own colour in both schemes (dark contrast Low).
  assert.match(
    style,
    /textarea::placeholder,input::placeholder\{color:#6b6b66/,
  );
  assert.match(
    style,
    /prefers-color-scheme:dark\)\{[^@]*textarea::placeholder,input::placeholder\{color:#a8a8a2/,
  );
});

/** A minimal stand-in DOM for the preview script: just the elements it touches. */
function runScript(html: string, script: string) {
  const el = (id: string) => ({
    id,
    value: '',
    textContent: '',
    className: '',
  });
  const nodes = {
    run: null as unknown,
    out: el('out'),
    meta: el('meta'),
    'args-note': el('args-note'),
    args: el('args'),
    stdin: el('stdin'),
  };
  const listeners: Record<string, (e: unknown) => unknown> = {};
  const submit = { disabled: false, focus() {} };
  nodes.run = {
    addEventListener: (_k: string, f: (e: unknown) => unknown) =>
      (listeners.submit = f),
    querySelector: () => submit,
  };
  const buttons = [
    ...html.matchAll(/data-args="([^"]*)" data-stdin="([^"]*)"/g),
  ].map((m) => {
    const unescape = (v: string) =>
      v
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
    const b = {
      dataset: { args: unescape(m[1]!), stdin: unescape(m[2]!) },
      click: () => {},
      addEventListener: (_k: string, f: () => void) => (b.click = f),
    };
    return b;
  });
  const sent: { args: string[]; stdin: string }[] = [];
  const document = {
    getElementById: (id: keyof typeof nodes) => nodes[id],
    querySelectorAll: () => buttons,
  };
  const fetch = async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        stdout: 'ok',
        exit_code: 0,
        state: 'completed',
        runs_used: 1,
        max_runs: 10,
      }),
    };
  };
  new Function('document', 'fetch', 'location', script)(document, fetch, {
    pathname: '/preview/x',
  });
  return {
    nodes: nodes as unknown as Record<
      string,
      { value: string; textContent: string }
    >,
    buttons,
    sent,
    submit: () => listeners.submit!({ preventDefault() {} }),
  };
}

test('"Use this example" sends empty and multi-line arguments exactly until the box is edited', async () => {
  const guide: Guide = {
    flows: [],
    examples: [
      {
        check_key: 'A1',
        statement: 'Empty and two-line arguments',
        args: ['--name', '', 'two\nlines'],
        stdin: 'a\r\nb\n',
        stdout: 'ok\n',
        exit_code: 0,
      },
    ],
    more_examples: 0,
    held_out_hidden: false,
  };
  const { html, script } = await previewPage(guide);
  const page = runScript(html, script);
  page.buttons[0]!.click();
  assert.match(
    page.nodes['args-note']!.textContent,
    /empty or multi-line argument/,
  );
  await page.submit();
  assert.deepEqual(page.sent[0], {
    args: ['--name', '', 'two\nlines'],
    stdin: 'a\r\nb\n',
  });
  // Edited: the lines are read again, one argument per non-empty line.
  page.nodes.args!.value = '--name\nx';
  await page.submit();
  assert.deepEqual(page.sent[1]!.args, ['--name', 'x']);
  assert.equal(page.sent[1]!.stdin, 'a\r\nb\n');
});

test("the terminal panel keeps an example's exact arguments while its box is unchanged", async () => {
  const source = await readFile('apps/web/src/terminal-args.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const m = {} as {
    argsToSend: (
      text: string,
      example: { args: string[]; text: string } | null,
    ) => string[];
    needsExactArgs: (args: string[]) => boolean;
  };
  new Function('exports', code)(m);
  const args = ['--fps', '', 'a\nb'];
  const example = { args, text: args.join('\n') };
  assert.deepEqual(m.argsToSend(example.text, example), args);
  assert.deepEqual(m.argsToSend('--fps\n\n60', example), ['--fps', '60']);
  assert.deepEqual(m.argsToSend('--fps\n60', null), ['--fps', '60']);
  assert.equal(m.needsExactArgs(args), true);
  assert.equal(m.needsExactArgs(['--fps', '60']), false);
});
