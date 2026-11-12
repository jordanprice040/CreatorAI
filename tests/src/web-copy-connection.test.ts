import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeb } from './web-module.js';

// ADR-0095 (P30): which workspaces "Copy to another workspace" offers, and what it says is left.
type Ws = { id: string; name: string; role: string; record_mode: string };
type Text = {
  copyTargets: (all: Ws[], from: Ws) => Ws[];
  noTargetText: (from: Ws) => string;
  copiedSteps: (
    kind: 'chatgpt_plan' | 'claude_code',
    target: string,
    label: string,
    chat: string,
    chatOn?: boolean,
  ) => string[];
  chatCopyNote: (
    here: {
      enabled: boolean;
      connection_id: string | null;
      model_id: string | null;
      include_snapshot: boolean;
    } | null,
    id: string,
  ) => string | null;
  copyRequestBody: (o: {
    connectionVersion: number;
    connectionId: string;
    target: string;
    label: string;
    ticked: boolean;
    here: {
      enabled: boolean;
      connection_id: string | null;
      model_id: string | null;
      include_snapshot: boolean;
      version: number;
    } | null;
  }) => Record<string, unknown>;
  afterCopyRefusal: (code: string | null) => {
    rereadChat: boolean;
    untick: boolean;
  };
};
const ws = (id: string, role = 'owner', record_mode = 'real'): Ws => ({
  id,
  name: id.toUpperCase(),
  role,
  record_mode,
});

test('copy offers only other workspaces the person owns, of the same record mode', async () => {
  const t = (await loadWeb('copy-connection-text.ts')) as Text;
  const here = ws('here');
  const all = [
    here,
    ws('z'),
    ws('a'),
    ws('edited', 'editor'),
    ws('viewed', 'viewer'),
    ws('fix', 'owner', 'fixture'),
  ];
  assert.deepEqual(
    t.copyTargets(all, here).map((w) => w.id),
    ['a', 'z'],
  );
  assert.deepEqual(
    t.copyTargets(all, ws('f', 'owner', 'fixture')).map((w) => w.id),
    ['fix'],
  );
  assert.match(t.noTargetText(here), /no other real workspace/);
});

test('after a copy the steps say what is not carried over', async () => {
  const t = (await loadWeb('copy-connection-text.ts')) as Text;
  const plan = t.copiedSteps('chatgpt_plan', 'B', 'Plan', 'copied').join(' ');
  assert.match(plan, /Sign in with ChatGPT there/);
  assert.match(plan, /Qualifications are not copied/);
  assert.match(plan, /Chat answers there now use this connection/);
  assert.match(plan, /off until you turn them on there/);
  const claude = t
    .copiedSteps('claude_code', 'B', 'Claude', 'target_has_own')
    .join(' ');
  assert.match(claude, /Check Claude Code/);
  assert.doesNotMatch(claude, /ChatGPT/);
  assert.match(claude, /left as it was/);
  assert.equal(
    t.copiedSteps('chatgpt_plan', 'B', 'Plan', 'not_requested').length,
    4,
  );
});

test('review 1 L-2: before Copy, the form says Chat answers will be on there and what they send', async () => {
  const t = (await loadWeb('copy-connection-text.ts')) as Text;
  const on = {
    enabled: true,
    connection_id: 'c1',
    model_id: 'gpt-x',
    include_snapshot: true,
  };
  assert.equal(t.chatCopyNote(null, 'c1'), null);
  assert.equal(t.chatCopyNote({ ...on, connection_id: 'c2' }, 'c1'), null);
  const note = t.chatCopyNote(on, 'c1')!;
  assert.match(note, /will be ON there/);
  assert.match(note, /gpt-x/);
  assert.match(note, /snapshot of that workspace's records/);
  assert.doesNotMatch(
    t.chatCopyNote({ ...on, include_snapshot: false }, 'c1')!,
    /snapshot/,
  );
  assert.match(t.chatCopyNote({ ...on, enabled: false }, 'c1')!, /off/);
  // Re-review N2-2: off with no model chosen says so.
  assert.match(
    t.chatCopyNote({ ...on, enabled: false, model_id: null }, 'c1')!,
    /no model chosen yet/,
  );
  assert.match(
    t.chatCopyNote({ ...on, enabled: false }, 'c1')!,
    /off, using the copy with gpt-x/,
  );
  assert.match(
    t.copiedSteps('chatgpt_plan', 'B', 'Plan', 'copied', true).join(' '),
    /Chat answers there are on/,
  );
  assert.match(
    t.copiedSteps('chatgpt_plan', 'B', 'Plan', 'copied', false).join(' '),
    /off until you turn them on/,
  );
});

test('re-review 3 N3-2/N3-3: the request names the Chat answers version only when ticked; a conflict re-reads and unticks', async () => {
  const t = (await loadWeb('copy-connection-text.ts')) as Text;
  const here = {
    enabled: true,
    connection_id: 'c1',
    model_id: 'm',
    include_snapshot: false,
    version: 4,
  };
  const base = {
    connectionVersion: 9,
    connectionId: 'c1',
    target: 'w2',
    label: '  Plan  ',
  };
  assert.deepEqual(t.copyRequestBody({ ...base, ticked: true, here }), {
    expected_version: 9,
    target_workspace_id: 'w2',
    label: 'Plan',
    chat_answers: true,
    chat_answers_version: 4,
  });
  for (const body of [
    t.copyRequestBody({ ...base, ticked: false, here }),
    t.copyRequestBody({
      ...base,
      ticked: true,
      here: { ...here, connection_id: 'c2' },
    }),
    t.copyRequestBody({ ...base, ticked: true, here: null }),
  ]) {
    assert.equal(body.chat_answers, false);
    assert.equal('chat_answers_version' in body, false);
  }
  assert.deepEqual(t.afterCopyRefusal('VERSION_CONFLICT'), {
    rereadChat: true,
    untick: true,
  });
  assert.deepEqual(t.afterCopyRefusal('DUPLICATE'), {
    rereadChat: false,
    untick: false,
  });
  assert.deepEqual(t.afterCopyRefusal(null), {
    rereadChat: false,
    untick: false,
  });
});
