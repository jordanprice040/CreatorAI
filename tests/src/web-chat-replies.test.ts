import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ADR-0055: the studio's chat replies are fixed rules over current facts. chat-replies.ts has
// no imports, so it loads directly.
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

type Action = { kind: string; view: string; label: string; value?: string };
type Reply = { text: string; actions: Action[] };
type Facts = {
  latest: boolean;
  step: { tone: string; text: string; view: string | null } | null;
  blocked: { label: string; text: string; view: string } | null;
  pending: number | null;
  model?: string | null;
};
type Mod = {
  chatReply: (
    intent: string,
    target: { url?: string; text?: string },
    message: string,
    f: Facts,
  ) => Reply;
};

const facts = (over: Partial<Facts> = {}): Facts => ({
  latest: true,
  step: { tone: 'next', text: 'Fund a discovery budget.', view: 'budgets' },
  blocked: null,
  pending: 0,
  ...over,
});

test('chat answers come from the same facts as the path, and older ones say they are stale', async () => {
  const { chatReply } = await load<Mod>('chat-replies.ts');
  const next = chatReply('next', {}, "what's next", facts());
  assert.equal(next.text, 'Next: Fund a discovery budget.');
  assert.deepEqual(
    next.actions.map((a) => [a.kind, a.view]),
    [
      ['open', 'budgets'],
      ['open', 'path'],
    ],
  );
  // While facts load, the reply says so instead of guessing.
  assert.match(
    chatReply('next', {}, 'next', facts({ step: null })).text,
    /Reading/,
  );
  // An earlier question of the same kind does not repeat a possibly old answer.
  const old = chatReply('next', {}, 'next', facts({ latest: false }));
  assert.match(old.text, /out of date/);
  assert.doesNotMatch(old.text, /Fund/);

  const blocked = chatReply(
    'why_blocked',
    {},
    'why',
    facts({
      step: { tone: 'blocked', text: 'Add pricing.', view: 'budgets' },
      blocked: { label: 'Build', text: 'Add pricing.', view: 'budgets' },
    }),
  );
  assert.equal(blocked.text, 'Build is blocked. Add pricing.');
  assert.equal(blocked.actions[0]!.view, 'budgets');
  assert.match(
    chatReply('why_blocked', {}, 'why', facts()).text,
    /Nothing on the main path is blocked/,
  );

  assert.equal(
    chatReply('approvals', {}, 'approvals?', facts({ pending: 2 })).text,
    '2 decisions wait for you. Approving permits exactly the action each one shows.',
  );
  assert.equal(
    chatReply('approvals', {}, 'approvals?', facts()).text,
    'Nothing is waiting for you.',
  );
});

test('chat cards only open a tab or fill in a form there', async () => {
  const { chatReply } = await load<Mod>('chat-replies.ts');
  const intents: [string, { url?: string; text?: string }][] = [
    ['next', {}],
    ['why_blocked', {}],
    ['approvals', {}],
    ['add_source', { url: 'https://example.org/a' }],
    ['save_idea', { text: 'a timer' }],
    ['save_idea', {}],
    ['start_discovery', { text: 'clinic no-shows' }],
    ['start_discovery', {}],
    ['note', {}],
  ];
  for (const [intent, target] of intents)
    for (const a of chatReply(intent, target, 'hello', facts()).actions) {
      assert.ok(a.kind === 'open' || a.kind === 'fill', intent);
      if (a.kind === 'fill')
        assert.ok(a.view === 'evidence' || a.view === 'submit', intent);
    }
  const source = chatReply(
    'add_source',
    { url: 'https://example.org/a' },
    '',
    facts(),
  );
  assert.deepEqual(
    [source.actions[0]!.view, source.actions[0]!.value],
    ['evidence', 'https://example.org/a'],
  );
  assert.match(source.text, /approved website/);
  const idea = chatReply('save_idea', { text: 'a timer' }, '', facts());
  assert.deepEqual(
    [idea.actions[0]!.view, idea.actions[0]!.value],
    ['submit', 'a timer'],
  );
  assert.match(idea.text, /Nothing has started/);
  assert.equal(chatReply('save_idea', {}, 'save', facts()).actions.length, 0);
});

test('a note says a plan answers it only when chat answers are on (ADR-0057)', async () => {
  const { chatReply } = await load<Mod>('chat-replies.ts');
  assert.match(
    chatReply('note', {}, 'hi', facts()).text,
    /can't answer in words/,
  );
  const on = chatReply('note', {}, 'hi', { ...facts(), model: 'gpt-6-astra' });
  assert.match(on.text, /gpt-6-astra is asked through your plan/);
  assert.doesNotMatch(on.text, /can't answer/);
  assert.equal(on.actions[0]!.label, 'Make this a brief');
});
