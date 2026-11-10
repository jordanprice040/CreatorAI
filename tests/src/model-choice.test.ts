import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import {
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  ContractError,
  type ErrorCode,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { PlanConnectionService } from '@creator/broker';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { SUBSCRIBED, setFake, writeFakeClaude } from './claude-fake.js';

// ADR-0081 (P21): the current model beside the usage indicator. The server stores one choice
// per person and workspace, refuses a model that is not verified, moves a saved chat setting
// with it, and never touches work already started. Forms start from it (model-choice.ts).

const root = new URL('../../', import.meta.url);
const SETTINGS = JSON.parse(
  readFileSync(new URL('config/connections/claude-code.json', root), 'utf8'),
) as PlanConnection['settings'];
const M1 = 'claude-test-model';
const M2 = 'claude-test-model-2';
const owner: CommandContext = { actorId: randomUUID() };
const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    if (detail) assert.ok(detail.test([e.message, ...e.details].join(' | ')));
    return true;
  });

// --- The form rules (apps/web/src/model-choice.ts has no imports, so it loads directly) ---

type Route = {
  connection: string;
  model: string;
  fromChoice: boolean;
  choiceUnavailable: boolean;
  unqualified: string[];
  alternative: { connection: string; model: string } | null;
};
type Plan = {
  id: string;
  ready: boolean;
  models: { id: string; qualified: string[] }[];
};
type Mod = {
  preferredRoute(
    plans: Plan[],
    choice: { connection_id: string; model_id: string } | null,
    taskClasses: string[],
    fallback: { connection: string; model: string },
  ): Route;
  planBuilderDefault<
    B extends { kind: string; connection_id: string; model_id: string },
  >(
    builders: B[],
    choice: { connection_id: string; model_id: string } | null,
  ): { builder: B | undefined; fromChoice: boolean };
};
async function rules(): Promise<Mod> {
  const source = await readFile('apps/web/src/model-choice.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Mod;
  new Function('exports', code)(exports);
  return exports;
}

test('forms start from the current model; an unqualified one is kept, named and given a qualified alternative', async () => {
  const m = await rules();
  const plans: Plan[] = [
    {
      id: 'a',
      ready: true,
      models: [
        { id: 'fast', qualified: ['scoring'] },
        { id: 'strong', qualified: ['scoring', 'research_synthesis'] },
      ],
    },
    {
      id: 'b',
      ready: true,
      models: [{ id: 'other', qualified: ['research_synthesis'] }],
    },
    { id: 'c', ready: false, models: [{ id: 'down', qualified: ['scoring'] }] },
  ];
  const fallback = { connection: 'a', model: 'strong' };
  // No choice: the form's own default, never presented as the choice.
  assert.deepEqual(m.preferredRoute(plans, null, ['scoring'], fallback), {
    ...fallback,
    fromChoice: false,
    choiceUnavailable: false,
    unqualified: [],
    alternative: null,
  });
  // A qualified choice wins over the form's default.
  const ok = m.preferredRoute(
    plans,
    { connection_id: 'b', model_id: 'other' },
    ['research_synthesis'],
    fallback,
  );
  assert.equal(ok.connection, 'b');
  assert.equal(ok.model, 'other');
  assert.equal(ok.fromChoice, true);
  assert.deepEqual(ok.unqualified, []);
  assert.equal(ok.alternative, null);
  // An unqualified choice stays chosen (no quiet switch); the alternative comes from the same
  // connection first.
  const weak = m.preferredRoute(
    plans,
    { connection_id: 'a', model_id: 'fast' },
    ['research_synthesis'],
    fallback,
  );
  assert.equal(weak.model, 'fast');
  assert.deepEqual(weak.unqualified, ['research_synthesis']);
  assert.deepEqual(weak.alternative, { connection: 'a', model: 'strong' });
  // A connection that cannot run now is never offered as the alternative.
  const none = m.preferredRoute(
    plans,
    { connection_id: 'b', model_id: 'other' },
    ['scoring', 'research_synthesis', 'candidate_generation'],
    fallback,
  );
  assert.deepEqual(none.unqualified, ['scoring', 'candidate_generation']);
  assert.equal(none.alternative, null);
  // A choice no longer verified here: the fallback, flagged so the form can say so.
  const gone = m.preferredRoute(
    plans,
    { connection_id: 'a', model_id: 'retired' },
    ['scoring'],
    fallback,
  );
  assert.equal(gone.fromChoice, false);
  assert.equal(gone.choiceUnavailable, true);
  assert.equal(gone.model, 'strong');
});

test("Build's builder starts from the current model's plan roles, else the first plan-role builder", async () => {
  const m = await rules();
  const b = (
    key: string,
    kind: string,
    connection_id: string,
    model_id: string,
  ) => ({
    key,
    kind,
    connection_id,
    model_id,
  });
  const builders = [
    b('r1', 'roles', 'a', 'm1'),
    b('r2', 'roles', 'a', 'm2'),
    b('c2', 'codex', 'a', 'm2'),
  ];
  assert.deepEqual(m.planBuilderDefault(builders, null), {
    builder: builders[0],
    fromChoice: false,
  });
  // One switch changes the default builder.
  assert.deepEqual(
    m.planBuilderDefault(builders, { connection_id: 'a', model_id: 'm2' }),
    { builder: builders[1], fromChoice: true },
  );
  // A Codex-only match is not the plan-role default; the first plan-role builder is.
  assert.deepEqual(
    m.planBuilderDefault([builders[0]!, builders[2]!], {
      connection_id: 'a',
      model_id: 'm2',
    }),
    { builder: builders[0], fromChoice: false },
  );
  assert.deepEqual(
    m.planBuilderDefault([], { connection_id: 'a', model_id: 'm1' }),
    {
      builder: undefined,
      fromChoice: false,
    },
  );
});

// --- The stored choice (PostgreSQL; a fake `claude`, never a live call) ---

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const dir = mkdtempSync(join(tmpdir(), 'creator-model-choice-'));
  const config_dir = join(dir, 'config');
  setFake(config_dir, { status: SUBSCRIBED, text: 'An answer.' });
  const service = new PlanConnectionService({
    store,
    vault: null,
    claudeCode: {
      bin: writeFakeClaude(join(dir, 'bin')),
      config_dir,
      work_dir: join(config_dir, 'empty-workdir'),
    },
    claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Model choice',
    record_mode: 'fixture',
  });
  let conn = await store.createPlanConnection(owner, ws.id, {
    kind: 'claude_code',
    label: 'Claude Code on this computer',
    settings: {
      ...SETTINGS,
      allowed_data_classes: ['synthetic', 'public', 'private_approved'],
    },
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  await service.checkClaudeCode(owner, ws.id, conn.id);
  conn = await current();
  await store.attestPlanCredits(owner, ws.id, conn.id, {
    expected_version: conn.version,
    statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
    checked_on: '2026-11-10',
  });
  conn = await current();
  await store.acceptPlanCaps(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  for (const model of [M1, M2]) {
    conn = await current();
    const g = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
      expected_version: conn.version,
      model_id: model,
      path: 'responses',
      expires_in_minutes: 30,
    });
    await service.verifyModel(owner, ws.id, conn.id, {
      id: g.id,
      model_id: model,
    });
  }
  conn = await current();
  return { db, store, service, ws, conn };
}

test('model choice: owner only, verified models only, versioned and audited', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, conn } = s;
  const none = await store.modelChoice(owner, ws.id);
  assert.equal(none.version, 0);
  assert.equal(none.model_id, null);

  // A model that was never verified on the connection is refused with the reason.
  await rejects(
    'INVALID_CONTRACT',
    store.setModelChoice(owner, ws.id, {
      expected_version: 0,
      connection_id: conn.id,
      model_id: 'claude-never-verified',
    }),
    /not verified/,
  );
  // A connection from another workspace is not found here.
  const other = await store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'fixture',
  });
  await rejects(
    'NOT_FOUND',
    store.setModelChoice(owner, other.id, {
      expected_version: 0,
      connection_id: conn.id,
      model_id: M1,
    }),
  );
  // Plan connections are the owner's own: an editor cannot switch.
  const editor: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    store.setModelChoice(editor, ws.id, {
      expected_version: 0,
      connection_id: conn.id,
      model_id: M1,
    }),
  );

  const first = await store.setModelChoice(owner, ws.id, {
    expected_version: 0,
    connection_id: conn.id,
    model_id: M1,
  });
  assert.equal(first.choice.version, 1);
  assert.equal(first.choice.model_id, M1);
  // Chat was never set up, so nothing is created for it (its form starts from the choice).
  assert.equal(first.chat_updated, false);
  assert.equal((await store.chatSettings(owner, ws.id)).version, 0);
  // Stale version refused; the editor's own choice is separate and still empty.
  await rejects(
    'VERSION_CONFLICT',
    store.setModelChoice(owner, ws.id, {
      expected_version: 0,
      connection_id: conn.id,
      model_id: M2,
    }),
  );
  assert.equal((await store.modelChoice(editor, ws.id)).version, 0);
  assert.equal((await store.modelChoice(owner, ws.id)).model_id, M1);

  const audit = await s.db.pool.query(
    `select action, payload from audit_events
     where workspace_id = $1 and action = 'model_choice.changed'`,
    [ws.id],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].payload.model_id, M1);
  assert.equal(audit.rows[0].payload.previous, null);
});

test('model choice: a saved chat setting follows the switch; answers already given keep their model', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service, ws, conn } = s;
  await store.setChatSettings(owner, ws.id, {
    expected_version: 0,
    enabled: true,
    connection_id: conn.id,
    model_id: M1,
    include_snapshot: false,
    daily_limit: 7,
  });
  const chat = await store.createChat(owner, ws.id, {});
  const say = async (text: string) =>
    (
      await store.postChatMessage(owner, ws.id, chat.id, {
        client_id: randomUUID(),
        text,
      })
    ).message;
  const q1 = await say('Explain a scorecard in one line.');
  const a1 = await service.chatAnswer(owner, ws.id, chat.id, q1.id, {
    client_id: randomUUID(),
  });
  assert.equal(a1.state, 'completed', a1.reason ?? '');
  assert.equal(a1.model_id, M1);

  const out = await store.setModelChoice(owner, ws.id, {
    expected_version: 0,
    connection_id: conn.id,
    model_id: M2,
  });
  assert.equal(out.chat_updated, true);
  const chatNow = await store.chatSettings(owner, ws.id);
  assert.equal(chatNow.model_id, M2);
  assert.equal(chatNow.version, 2);
  // Only the route moved: on/off, snapshot and limit are the owner's as before.
  assert.equal(chatNow.enabled, true);
  assert.equal(chatNow.include_snapshot, false);
  assert.equal(chatNow.daily_limit, 7);
  const changes = await s.db.pool.query(
    `select payload from audit_events
     where workspace_id = $1 and action = 'chat.settings_changed' order by sequence`,
    [ws.id],
  );
  assert.equal(changes.rows.length, 2);
  assert.equal(changes.rows[1].payload.via, 'model_switch');

  // The answer given before the switch keeps the model it was asked on; the next uses M2.
  const before = (await store.chatDetail(owner, ws.id, chat.id)).answers;
  assert.deepEqual(
    before.map((a) => a.model_id),
    [M1],
  );
  const q2 = await say('And a spec?');
  const a2 = await service.chatAnswer(owner, ws.id, chat.id, q2.id, {
    client_id: randomUUID(),
  });
  assert.equal(a2.state, 'completed', a2.reason ?? '');
  assert.equal(a2.model_id, M2);

  // Switching to what chat already uses changes nothing there.
  const again = await store.setModelChoice(owner, ws.id, {
    expected_version: 1,
    connection_id: conn.id,
    model_id: M2,
  });
  assert.equal(again.chat_updated, false);
  assert.equal((await store.chatSettings(owner, ws.id)).version, 2);
});

test('model choice API: read and switch through the route; unknown and unverified are refused', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'GET' ? auth.read : auth.write),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await call('POST', 'workspaces', { name: 'Route', record_mode: 'fixture' })
  ).body.id as string;
  const read = await call('GET', `workspaces/${ws}/model-choice`);
  assert.equal(read.status, 200);
  assert.equal(read.body.version, 0);
  // Extra fields are refused by the strict request contract.
  const extra = await call('POST', `workspaces/${ws}/model-choice`, {
    expected_version: 0,
    connection_id: randomUUID(),
    model_id: 'm',
    apply_to_runs: true,
  });
  assert.equal(extra.status, 400);
  const unknown = await call('POST', `workspaces/${ws}/model-choice`, {
    expected_version: 0,
    connection_id: randomUUID(),
    model_id: 'm',
  });
  assert.equal(unknown.status, 404);
  const conn = await call('POST', `workspaces/${ws}/plan-connections`, {
    kind: 'claude_code',
    label: 'Claude Code',
    settings: SETTINGS,
  });
  assert.equal(conn.status, 201, JSON.stringify(conn.body));
  const unverified = await call('POST', `workspaces/${ws}/model-choice`, {
    expected_version: 0,
    connection_id: conn.body.id,
    model_id: 'claude-not-verified',
  });
  assert.equal(unverified.status, 400);
  assert.match(unverified.body.error.message, /not verified/);
  // Without a CSRF token the switch is refused.
  const noCsrf = await fetch(`${base}/workspaces/${ws}/model-choice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.read },
    body: JSON.stringify({
      expected_version: 0,
      connection_id: conn.body.id,
      model_id: 'x',
    }),
  });
  assert.equal(noCsrf.status, 403);
});
