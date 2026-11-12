import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { createApi } from '@creator/api';
import {
  ApiKeyService,
  FileDevVault,
  MemoryVault,
  newApiKeyRef,
  newCredentialRef,
  type ModelAdapter,
} from '@creator/broker';
import { ConnectionStore } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0093 (P28): a workspace's own OpenAI API key in Models and connections. Saved, used by a
// paid call, replaced and removed through the real API against a loopback Responses server;
// never in a response, the database or the audit log; owner-only; never in fixture workspaces.

const KEY_1 = 'sk-test-first-0123456789abcdefWXYZ';
const KEY_2 = 'sk-test-second-0123456789abcdefQRST';

test('vault: API keys and plan sign-ins are separate kinds of entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-vault-'));
  for (const vault of [new MemoryVault(), new FileDevVault(dir)]) {
    const key = newApiKeyRef();
    await vault.putApiKey(key, KEY_1);
    assert.equal(await vault.getApiKey(key), KEY_1);
    // A key reference never opens as a plan sign-in, nor the other way round.
    await assert.rejects(vault.get(key), /Invalid credential reference/);
    await assert.rejects(
      vault.getApiKey(newCredentialRef()),
      /Invalid credential reference/,
    );
    await assert.rejects(vault.putApiKey('openai-api-key/../x', KEY_1));
    await vault.delete(key);
    assert.equal(await vault.getApiKey(key), null);
  }
  assert.deepEqual(await readdir(dir), []);
});

test('the studio’s own key wins over a saved one; a failed unlock is not remembered', async () => {
  const env = {
    provider: 'openai',
    model_id: 'gpt-6-astra',
    live: true,
  } as unknown as ModelAdapter;
  const ref = newApiKeyRef();
  const vault = new MemoryVault();
  await vault.putApiKey(ref, KEY_1);
  const saved = {
    model_id: 'gpt-6-astra',
    last_four: 'WXYZ',
    version: 1,
    saved_at: new Date().toISOString(),
    saved_by: randomUUID(),
  };
  const store = {
    workspaceApiKey: async () => saved,
    workspaceApiKeyRef: async () => ({
      credential_ref: ref,
      model_id: 'gpt-6-astra',
    }),
    saveWorkspaceApiKey: async () => assert.fail('not called'),
    removeWorkspaceApiKey: async () => assert.fail('not called'),
  };
  const ctx = { actorId: randomUUID() };
  const both = new ApiKeyService({ store, vault, environment: env });
  assert.equal(await both.liveFor(ctx, randomUUID()), env);
  const s = await both.status(ctx, randomUUID());
  assert.equal(s.in_use, 'environment');
  assert.match(s.note ?? '', /used instead of the saved one \(…WXYZ\)/);
  const own = new ApiKeyService({ store, vault, environment: null });
  const adapter = await own.liveFor(ctx, randomUUID());
  assert.equal(adapter?.live, true);
  assert.equal(adapter?.model_id, 'gpt-6-astra');
  assert.ok(!JSON.stringify(adapter).includes(KEY_1));
  assert.equal((await own.status(ctx, randomUUID())).in_use, 'saved');
  // No vault: nothing to read, and saving says why.
  const none = new ApiKeyService({ store, vault: null, environment: null });
  assert.equal(await none.liveFor(ctx, randomUUID()), null);
  assert.equal((await none.status(ctx, randomUUID())).can_save, false);
  // A vault that cannot unlock gives no adapter now and is asked again next time.
  let fail = true;
  const flaky = Object.assign(new MemoryVault(), {
    getApiKey: async () => {
      if (fail) throw new Error('locked');
      return KEY_1;
    },
  });
  const retry = new ApiKeyService({
    store,
    vault: flaky,
    environment: null,
  });
  assert.equal(await retry.liveFor(ctx, randomUUID()), null);
  fail = false;
  assert.equal((await retry.liveFor(ctx, randomUUID()))?.live, true);
});

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
type Caller = {
  post: (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
  get: (path: string) => Promise<any>;
};
type Mod = {
  keyProblem: (raw: string) => string | null;
  pickPricing: (p: any[], m: string | null) => any;
  pickFunding: (e: any[], now: number) => any;
  runCheck: (
    c: Caller,
    base: string,
    ids: { pricingId: string; fundingId: string; operationId: string },
    stamp: string,
    now: () => number,
  ) => Promise<{
    outcome: { kind: string } | null;
    error: string | null;
  }>;
};

test('the panel refuses a malformed key without repeating it', async () => {
  const m = await load<Mod>('api-key-check.ts');
  assert.equal(m.keyProblem(KEY_1), null);
  assert.equal(m.keyProblem(` ${KEY_1}\n`), null);
  for (const bad of [
    'sk-short',
    'sk-test with space-0123456789',
    'é'.repeat(30),
  ]) {
    const why = m.keyProblem(bad);
    assert.ok(why && !why.includes(bad));
  }
  assert.match(m.keyProblem('  ')!, /Paste/);
  assert.match(m.keyProblem('sk-test with space-0123456789')!, /space/);
});

test('API key in Models and connections: save, use, replace, remove; never shown or stored in the database', async (t) => {
  const m = await load<Mod>('api-key-check.ts');
  const seen: (string | undefined)[] = [];
  const openai = createServer((req, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_check',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'ok' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 20, total_tokens: 32 },
        }),
      );
    });
  });
  openai.listen(0, '127.0.0.1');
  await once(openai, 'listening');
  t.after(() => {
    openai.closeAllConnections();
    return new Promise<void>((r) => openai.close(() => r()));
  });
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const vaultDir = await mkdtemp(join(tmpdir(), 'creator-key-vault-'));
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_PLAN_VAULT_DIR: vaultDir,
    CREATOR_PLAN_VAULT: 'file-dev',
    CREATOR_OPENAI_BASE_URL: `http://127.0.0.1:${(openai.address() as { port: number }).port}/v1`,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const raw = async (path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      ...(body === undefined
        ? { headers: auth.read }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth.write },
            body: JSON.stringify(body),
          }),
    });
    const text = await r.text();
    for (const k of [KEY_1, KEY_2, 'with space'])
      assert.ok(!text.includes(k), `a response repeated the key: ${text}`);
    return { status: r.status, body: JSON.parse(text) };
  };
  const caller: Caller = {
    async post(path, body) {
      const r = await raw(path, body);
      if (r.status >= 400)
        throw Object.assign(new Error(r.body.error?.message ?? 'error'), {
          code: r.body.error?.code ?? 'ERROR',
        });
      return r.body;
    },
    async get(path) {
      return (await raw(path)).body;
    },
  };
  const ws = await caller.post('workspaces', {
    name: 'P28',
    record_mode: 'real',
  });
  const fixture = await caller.post('workspaces', {
    name: 'P28 fixture',
    record_mode: 'fixture',
  });
  const w = `workspaces/${ws.id}`;
  const files = async () => readdir(vaultDir).catch(() => [] as string[]);

  let status = await caller.get(`${w}/api-keys/openai`);
  assert.equal(status.in_use, 'none');
  assert.equal(status.saved, null);
  assert.equal(status.can_save, true);

  // A paid check before any key: nothing reaches OpenAI.
  await caller.post(
    `${w}/pricing`,
    JSON.parse(
      await readFile('config/pricing/openai-gpt-6-astra.json', 'utf8'),
    ),
  );
  await caller.post(`${w}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 4,
  });
  const price = m.pickPricing(await caller.get(`${w}/pricing`), 'gpt-6-astra');
  const funding = m.pickFunding(await caller.get(`${w}/budgets`), Date.now());
  const check = () =>
    m.runCheck(
      caller,
      w,
      {
        pricingId: price.id,
        fundingId: funding.id,
        operationId: randomUUID(),
      },
      'test',
      Date.now,
    );
  const before = await check();
  assert.notEqual(before.outcome?.kind, 'connected');
  assert.equal(seen.length, 0);

  // Refusals store nothing: a malformed key, a stale version, a fixture workspace.
  const bad = await raw(`${w}/api-keys/openai`, {
    api_key: 'sk-test with space-0123456789',
    model_id: 'gpt-6-astra',
    expected_version: null,
  });
  assert.equal(bad.status, 400);
  const stale = await raw(`${w}/api-keys/openai`, {
    api_key: KEY_1,
    model_id: 'gpt-6-astra',
    expected_version: 1,
  });
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  const fx = await raw(`workspaces/${fixture.id}/api-keys/openai`, {
    api_key: KEY_1,
    model_id: 'gpt-6-astra',
    expected_version: null,
  });
  assert.equal(fx.body.error.code, 'INVALID_TRANSITION');
  assert.deepEqual(await files(), []);

  // Only the owner, signed in as a person, changes the key; a member sees the last four.
  const store = new ConnectionStore(db.pool);
  const owner = {
    actorId: (
      await db.pool.query(
        `select actor_id from workspace_members where workspace_id = $1 and role = 'owner'`,
        [ws.id],
      )
    ).rows[0].actor_id as string,
  };
  const editor = { actorId: randomUUID() };
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'Editor',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  const memberService = new ApiKeyService({
    store,
    vault: new FileDevVault(vaultDir),
    environment: null,
  });
  await assert.rejects(
    memberService.save(editor, ws.id, {
      api_key: KEY_1,
      model_id: 'gpt-6-astra',
      expected_version: null,
    }),
    (e: { code?: string }) => e.code === 'ACCESS_DENIED',
  );
  assert.deepEqual(await files(), [], 'a refused save leaves no vault entry');

  // Save: two first saves at once, one wins and the other leaves no vault entry. The response
  // names the last four; the key works for a paid call.
  const firstSaves = await Promise.all(
    [0, 1].map(() =>
      raw(`${w}/api-keys/openai`, {
        api_key: ` ${KEY_1} `,
        model_id: 'gpt-6-astra',
        expected_version: null,
      }),
    ),
  );
  assert.deepEqual(firstSaves.map((r) => r.status).sort(), [200, 409]);
  status = firstSaves.find((r) => r.status === 200)!.body;
  assert.equal(status.in_use, 'saved');
  assert.equal(status.model_id, 'gpt-6-astra');
  assert.deepEqual(
    { last_four: status.saved.last_four, version: status.saved.version },
    { last_four: 'WXYZ', version: 1 },
  );
  assert.equal((await files()).length, 1);
  assert.equal(
    (await memberService.status(editor, ws.id)).saved?.last_four,
    'WXYZ',
  );
  await assert.rejects(
    memberService.remove(editor, ws.id, { expected_version: 1 }),
    (e: { code?: string }) => e.code === 'ACCESS_DENIED',
  );
  const first = await check();
  assert.equal(first.error, null);
  assert.equal(first.outcome?.kind, 'connected');
  assert.deepEqual(seen, [`Bearer ${KEY_1}`]);

  // Replace: the old entry goes, the next call uses the new key; a stale replace is refused.
  status = await caller.post(`${w}/api-keys/openai`, {
    api_key: KEY_2,
    model_id: 'gpt-6-astra',
    expected_version: 1,
  });
  assert.equal(status.saved.last_four, 'QRST');
  assert.equal(status.saved.version, 2);
  assert.equal((await files()).length, 1);
  const again = await raw(`${w}/api-keys/openai`, {
    api_key: KEY_1,
    model_id: 'gpt-6-astra',
    expected_version: 1,
  });
  assert.equal(again.body.error.code, 'VERSION_CONFLICT');
  assert.equal((await files()).length, 1);
  assert.equal((await check()).outcome?.kind, 'connected');
  assert.deepEqual(seen, [`Bearer ${KEY_1}`, `Bearer ${KEY_2}`]);

  // Remove: no entry, no record, and calls stop reaching OpenAI.
  const stale2 = await raw(`${w}/api-keys/openai/remove`, {
    expected_version: 1,
  });
  assert.equal(stale2.body.error.code, 'VERSION_CONFLICT');
  status = await caller.post(`${w}/api-keys/openai/remove`, {
    expected_version: 2,
  });
  assert.equal(status.in_use, 'none');
  assert.equal(status.saved, null);
  assert.deepEqual(await files(), []);
  assert.notEqual((await check()).outcome?.kind, 'connected');
  assert.equal(seen.length, 2);

  // The database and the audit log hold the last four only, and record each change.
  const dump = await db.pool.query(
    `select (select coalesce(string_agg(t::text, ' '), '') from audit_events t) as audit,
            (select coalesce(string_agg(k::text, ' '), '') from workspace_api_keys k) as keys`,
  );
  for (const k of [KEY_1, KEY_2]) {
    assert.ok(!dump.rows[0].audit.includes(k));
    assert.ok(!dump.rows[0].audit.includes(k.slice(0, -4)));
  }
  const actions = await db.pool.query(
    `select action, payload->>'last_four' as four from audit_events
      where action like 'api_key.%' order by sequence`,
  );
  assert.deepEqual(
    actions.rows.map((r) => `${r.action}:${r.four}`),
    ['api_key.saved:WXYZ', 'api_key.replaced:QRST', 'api_key.removed:QRST'],
  );
});
