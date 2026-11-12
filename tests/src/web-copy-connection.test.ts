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
  ) => string[];
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
