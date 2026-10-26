import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import { Store } from '@creator/db';
import { prepareThemeResearchPlan } from '@creator/domain';
import { ThemeIntentBodySchema, ContractError } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const body = {
  format: 'theme-intent/1' as const,
  theme: 'Research-team CSV quality checks',
  context: '',
  solution_constraints: '',
  questions: [],
  source_strategy: 'supplied_public_sources' as const,
  source_urls: [],
};
test('theme preparation needs no evidence or resource setup and cannot carry execution authority', () => {
  const plan = prepareThemeResearchPlan({
    id: randomUUID(),
    workspace_id: randomUUID(),
    version: 1,
    content_hash: 'a'.repeat(64),
    body,
  });
  assert.equal(plan.execution, 'not_authorized');
  assert.deepEqual(plan.preparation_limits, {
    provider_requests: 0,
    source_fetches: 0,
    new_metered_spend_nano_usd: '0',
  });
  assert.equal(plan.questions.length, 3);
  assert.equal(
    plan.native_search,
    'not_integrated_account_entitlement_unknown',
  );
  assert.equal(
    ThemeIntentBodySchema.safeParse({ ...body, grant: true }).success,
    false,
  );
  assert.equal(
    ThemeIntentBodySchema.safeParse({ ...body, theme: '  ' }).success,
    false,
  );
  for (const url of [
    'not-a-url',
    'http://example.org',
    'https://user:password@example.org',
  ])
    assert.equal(
      ThemeIntentBodySchema.safeParse({ ...body, source_urls: [url] }).success,
      false,
    );
});

test('theme drafts persist through real HTTP restart, reject stale/cross-workspace writes, and create no executable work', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  let api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  closeApi = () => api.close();
  const listen = async () => {
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    await api.ready();
    const addr = api.server.address();
    assert.ok(addr && typeof addr !== 'string');
    return `http://127.0.0.1:${addr.port}/api`;
  };
  let base = await listen();
  let auth = await login(base);
  const post = async (
    path: string,
    value: unknown,
    headers: Record<string, string> = auth.write,
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const wsResponse = await post('/workspaces', {
    name: 'Theme intake test',
    record_mode: 'real',
  });
  assert.equal(wsResponse.status, 201);
  const ws = (await wsResponse.json()) as { id: string };
  const path = `/workspaces/${ws.id}/entities`;
  const draft = {
    kind: 'theme_intent',
    title: body.theme,
    body: { format: body.format, theme: body.theme },
  };
  const deniedCsrf = await post(path, draft, auth.read);
  assert.equal(deniedCsrf.status, 403);
  const created = await post(path, draft, {
    ...auth.write,
    'Idempotency-Key': 'theme:bounded-create',
  });
  assert.equal(created.status, 201);
  const entity = (await created.json()) as {
    id: string;
    version: number;
    content_hash: string;
  };
  const replay = await post(path, draft, {
    ...auth.write,
    'Idempotency-Key': 'theme:bounded-create',
  });
  assert.equal(((await replay.json()) as { id: string }).id, entity.id);
  const planUrl = `${path}/${entity.id}/research-plan`;
  const firstPlan = await fetch(base + planUrl, { headers: auth.read });
  assert.equal(firstPlan.status, 200);
  const prepared = (await firstPlan.json()) as {
    intent: { content_hash: string };
    execution: string;
  };
  assert.equal(prepared.intent.content_hash, entity.content_hash);
  assert.equal(prepared.execution, 'not_authorized');
  const update = {
    expected_version: 1,
    title: body.theme,
    body: {
      ...body,
      context: 'Supplied sources must preserve row-level provenance.',
    },
    reason: 'Added context',
    corrects_version: null,
  };
  assert.equal(
    (await post(`${path}/${entity.id}/revisions`, update)).status,
    200,
  );
  assert.equal(
    (await post(`${path}/${entity.id}/revisions`, update)).status,
    409,
  );
  await api.close();
  api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  base = await listen();
  auth = await login(base);
  const restored = await fetch(
    base + path + '?kind=theme_intent&status=active',
    { headers: auth.read },
  );
  const list = (await restored.json()) as {
    id: string;
    version: number;
    body: { context: string };
  }[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, entity.id);
  assert.equal(list[0]!.version, 2);
  assert.equal(list[0]!.body.context, update.body.context);
  const rebound = (await (
    await fetch(base + planUrl, { headers: auth.read })
  ).json()) as { intent: { version: number; content_hash: string } };
  assert.equal(rebound.intent.version, 2);
  assert.notEqual(rebound.intent.content_hash, entity.content_hash);
  const store = new Store(db.pool);
  const outsider = { actorId: randomUUID() };
  const viewer = { actorId: randomUUID() };
  for (const ctx of [outsider, viewer])
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: 'Test reader',
    });
  const foreign = await store.createWorkspace(outsider, {
    name: 'Unshared draft workspace',
    record_mode: 'real',
  });
  assert.equal(
    (
      await fetch(
        `${base}/workspaces/${foreign.id}/entities/${entity.id}/research-plan`,
        { headers: auth.read },
      )
    ).status,
    404,
  );
  await db.pool.query(
    "insert into workspace_members(workspace_id,actor_id,role) values($1,$2,'viewer')",
    [ws.id, viewer.actorId],
  );
  await assert.rejects(
    store.createEntity(viewer, ws.id, draft),
    (e) => e instanceof ContractError && e.code === 'ACCESS_DENIED',
  );
  await assert.rejects(
    store.getEntity(outsider, ws.id, entity.id),
    (e) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
  const noAuthority = await post(path, {
    ...draft,
    body: { ...body, grant: true },
  });
  assert.equal(noAuthority.status, 400);
  for (const table of [
    'run_controls',
    'grants',
    'workflows',
    'plan_requests',
  ]) {
    const count: { rows: { n: number }[] } = await db.pool.query(
      `select count(*)::int as n from ${table}`,
    );
    assert.equal(count.rows[0]!.n, 0, table);
  }
  assert.equal(
    (
      await db.pool.query(
        "select count(*)::int as n from entities where kind in ('claim','search_brief','run')",
      )
    ).rows[0].n,
    0,
  );
});
