import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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
    changeWorkspaceApiKeyModel: async () => assert.fail('not called'),
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
  // Review 1 L-1: a saved key this studio cannot open is not reported as in use.
  const noStore = await none.status(ctx, randomUUID());
  assert.equal(noStore.can_save, false);
  assert.equal(noStore.in_use, 'saved_unavailable');
  assert.match(noStore.note ?? '', /no protected store/);
  const missing = new ApiKeyService({
    store,
    vault: new MemoryVault(),
    environment: null,
  });
  const gone = await missing.status(ctx, randomUUID());
  assert.equal(gone.in_use, 'saved_unavailable');
  assert.match(gone.note ?? '', /cannot be opened on this computer/);
  // A vault that cannot unlock gives no adapter now, logs the reference (never the key) and
  // is asked again next time.
  const logged: string[] = [];
  let fail = true;
  const flaky = Object.assign(new MemoryVault(), {
    getApiKey: async () => {
      if (fail) throw new Error('locked');
      return KEY_1;
    },
  });
  let clock = 1_000_000;
  const retry = new ApiKeyService({
    store,
    vault: flaky,
    environment: null,
    log: (m) => logged.push(m),
    now: () => clock,
  });
  assert.equal(await retry.liveFor(ctx, randomUUID()), null);
  assert.equal(
    (await retry.status(ctx, randomUUID())).in_use,
    'saved_unavailable',
  );
  // Review 2 N-2: one unlock attempt and one log line per minute, not one per page load.
  assert.equal(logged.length, 1);
  assert.ok(logged[0]!.includes(ref) && !logged[0]!.includes(KEY_1));
  fail = false;
  assert.equal(await retry.liveFor(ctx, randomUUID()), null, 'still waiting');
  clock += 60_001;
  assert.equal((await retry.liveFor(ctx, randomUUID()))?.live, true);
  assert.equal((await retry.status(ctx, randomUUID())).in_use, 'saved');
});

test('re-review 3 N-1: callers waiting on one failing unlock share it and it is logged once', async () => {
  const ref = newApiKeyRef();
  let unlocks = 0;
  const vault = Object.assign(new MemoryVault(), {
    getApiKey: async () => {
      unlocks += 1;
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('locked');
    },
  });
  const store = {
    workspaceApiKey: async () => null,
    workspaceApiKeyRef: async () => ({
      credential_ref: ref,
      model_id: 'gpt-6-astra',
    }),
    saveWorkspaceApiKey: async () => assert.fail('not called'),
    removeWorkspaceApiKey: async () => assert.fail('not called'),
    changeWorkspaceApiKeyModel: async () => assert.fail('not called'),
  };
  const logged: string[] = [];
  const svc = new ApiKeyService({
    store,
    vault,
    environment: null,
    log: (m) => logged.push(m),
  });
  const ctx = { actorId: randomUUID() };
  const ws = randomUUID();
  const all = await Promise.all([1, 2, 3, 4].map(() => svc.liveFor(ctx, ws)));
  assert.deepEqual(all, [null, null, null, null]);
  assert.equal(unlocks, 1);
  assert.equal(logged.length, 1);
});

test('review 2 L-1: a damaged key file is never quoted in the log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-damaged-'));
  const vault = new FileDevVault(dir);
  const ref = newApiKeyRef();
  const file = join(
    dir,
    `${ref.slice('openai-api-key/'.length)}.api-key.secret`,
  );
  const ctx = { actorId: randomUUID() };
  const store = {
    workspaceApiKey: async () => null,
    workspaceApiKeyRef: async () => ({
      credential_ref: ref,
      model_id: 'gpt-6-astra',
    }),
    saveWorkspaceApiKey: async () => assert.fail('not called'),
    removeWorkspaceApiKey: async () => assert.fail('not called'),
    changeWorkspaceApiKeyModel: async () => assert.fail('not called'),
  };
  // Damaged plaintext the way a bad unseal or a hand edit could leave it: Node's own
  // JSON.parse message would quote the start of the key.
  for (const damaged of [
    KEY_1,
    `{"api_key":${KEY_1}}`,
    `{"api_key":"${KEY_1}`,
  ]) {
    await writeFile(file, damaged);
    const logged: string[] = [];
    const svc = new ApiKeyService({
      store,
      vault,
      environment: null,
      log: (m) => logged.push(m),
    });
    assert.equal(await svc.liveFor(ctx, randomUUID()), null);
    assert.equal(logged.length, 1);
    for (let i = 0; i + 6 <= KEY_1.length; i++)
      assert.ok(!logged[0]!.includes(KEY_1.slice(i, i + 6)), logged[0]);
    await assert.rejects(
      vault.getApiKey(ref),
      /^Error: A saved key is damaged\.$/,
    );
  }
});

test('review 1 L-2, N-5: a failed delete is reported and retried; a key changed elsewhere is forgotten', async () => {
  const ws = randomUUID();
  const ctx = { actorId: randomUUID() };
  let rec: { credential_ref: string; model_id: string } | null = null;
  let version = 0;
  const store = {
    workspaceApiKey: async () =>
      rec
        ? {
            model_id: rec.model_id,
            last_four: 'WXYZ',
            version,
            saved_at: new Date().toISOString(),
            saved_by: ctx.actorId,
          }
        : null,
    workspaceApiKeyRef: async () => rec,
    saveWorkspaceApiKey: async (
      _c: unknown,
      _w: string,
      k: { credential_ref: string; model_id: string },
    ) => {
      const replaced = rec?.credential_ref ?? null;
      rec = { credential_ref: k.credential_ref, model_id: k.model_id };
      version += 1;
      return {
        saved: (await store.workspaceApiKey())!,
        replaced_credential_ref: replaced,
      };
    },
    removeWorkspaceApiKey: async () => {
      const r = rec!.credential_ref;
      rec = null;
      return { credential_ref: r };
    },
    changeWorkspaceApiKeyModel: async () => assert.fail('not called'),
  };
  const inner = new MemoryVault();
  let locked = false;
  const vault = Object.assign(inner, {
    delete: async (ref: string) => {
      if (locked) throw new Error('file in use');
      await MemoryVault.prototype.delete.call(inner, ref);
    },
  });
  const logged: string[] = [];
  const svc = new ApiKeyService({
    store: store as never,
    vault,
    environment: null,
    log: (m) => logged.push(m),
  });
  const body = (k: string, v: number | null) => ({
    api_key: k,
    model_id: 'gpt-6-astra',
    expected_version: v,
  });
  let s = await svc.save(ctx, ws, body(KEY_1, null));
  assert.equal(s.unused_file_left, false);
  const first = await svc.liveFor(ctx, ws);
  assert.ok(first);
  // Another process replaces the key: the next call reads the new reference and the old
  // adapter is dropped from memory.
  const otherRef = newApiKeyRef();
  await inner.putApiKey(otherRef, KEY_2);
  const oldRef = rec!.credential_ref;
  rec = { credential_ref: otherRef, model_id: 'gpt-6-astra' };
  const second = await svc.liveFor(ctx, ws);
  assert.ok(second && second !== first);
  rec = { credential_ref: oldRef, model_id: 'gpt-6-astra' };
  assert.notEqual(
    await svc.liveFor(ctx, ws),
    first,
    'the old adapter was not kept',
  );
  rec = { credential_ref: otherRef, model_id: 'gpt-6-astra' };
  // Remove while the file is locked: the record goes, the page is told the file stayed.
  locked = true;
  s = await svc.remove(ctx, ws, { expected_version: version });
  assert.equal(s.in_use, 'none');
  assert.equal(s.unused_file_left, true);
  assert.match(s.note ?? '', /could not be deleted/);
  assert.ok(logged.some((m) => m.includes(otherRef)));
  assert.ok(!logged.some((m) => m.includes(KEY_2)));
  assert.equal(await inner.getApiKey(otherRef), KEY_2);
  // The next save retries the leftover delete.
  locked = false;
  s = await svc.save(ctx, ws, body(KEY_1, null));
  assert.equal(s.unused_file_left, false);
  assert.equal(await inner.getApiKey(otherRef), null);
  // Review 2 L-2: a studio with no key store does not claim it deleted the file.
  const noStore = new ApiKeyService({
    store: store as never,
    vault: null,
    environment: null,
    log: (m) => logged.push(m),
  });
  s = await noStore.remove(ctx, ws, { expected_version: version });
  assert.equal(s.in_use, 'none');
  assert.equal(s.unused_file_left, true);
  assert.match(s.note ?? '', /was not touched/);
  // Re-review 3 N-2: the missing store is said once.
  assert.equal(s.note!.match(/no protected store/g)?.length, 1);
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

  // Change model (review 1 N-6): the key stays, calls name the new model; an editor is refused.
  await assert.rejects(
    memberService.changeModel(editor, ws.id, {
      model_id: 'gpt-6-astra-mini',
      expected_version: 2,
    }),
    (e: { code?: string }) => e.code === 'ACCESS_DENIED',
  );
  status = await caller.post(`${w}/api-keys/openai/model`, {
    model_id: 'gpt-6-astra-mini',
    expected_version: 2,
  });
  assert.deepEqual(
    [status.saved.model_id, status.saved.last_four, status.saved.version],
    ['gpt-6-astra-mini', 'QRST', 3],
  );
  assert.equal((await files()).length, 1);
  const staleModel = await raw(`${w}/api-keys/openai/model`, {
    model_id: 'gpt-6-astra',
    expected_version: 2,
  });
  assert.equal(staleModel.body.error.code, 'VERSION_CONFLICT');
  status = await caller.post(`${w}/api-keys/openai/model`, {
    model_id: 'gpt-6-astra',
    expected_version: 3,
  });
  assert.equal(status.saved.version, 4);
  // Review 2 N-4: the same model again is not a change: same version, no audit row.
  status = await caller.post(`${w}/api-keys/openai/model`, {
    model_id: 'gpt-6-astra',
    expected_version: 4,
  });
  assert.equal(status.saved.version, 4);
  assert.equal((await check()).outcome?.kind, 'connected');
  assert.deepEqual(seen.at(-1), `Bearer ${KEY_2}`);

  // Remove: no entry, no record, and calls stop reaching OpenAI.
  const stale2 = await raw(`${w}/api-keys/openai/remove`, {
    expected_version: 1,
  });
  assert.equal(stale2.body.error.code, 'VERSION_CONFLICT');
  status = await caller.post(`${w}/api-keys/openai/remove`, {
    expected_version: 4,
  });
  assert.equal(status.in_use, 'none');
  assert.equal(status.unused_file_left, false);
  assert.equal(status.saved, null);
  assert.deepEqual(await files(), []);
  assert.notEqual((await check()).outcome?.kind, 'connected');
  assert.equal(seen.length, 3);

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
    [
      'api_key.saved:WXYZ',
      'api_key.replaced:QRST',
      'api_key.model_changed:QRST',
      'api_key.model_changed:QRST',
      'api_key.removed:QRST',
    ],
  );
});
