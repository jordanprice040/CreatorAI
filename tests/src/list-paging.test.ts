import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { ContractError } from '@creator/contracts';
import { PortfolioStore, type CommandContext } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { verifiedRelease } from './payments-harness.js';
import { portfolioFixture } from './portfolio-harness.js';

// Audit L-9: these lists used to read `order by created_at limit N`, so the newest records were
// the ones dropped once a workspace had more than N. Each list is seeded with N + 1 rows here
// (test seam: rows are inserted with SQL straight into the tables, since making hundreds of
// offers, sales and payouts through the real flows would only slow the suite; the rows meet
// every table constraint). Times step by one microsecond and come in tied pairs, so the
// cursor must compare exact database timestamps and break ties by id.

const owner: CommandContext = { actorId: DEFAULT_OWNER_ACTOR_ID };

test('L-9 capped lists read newest first and page with a cursor at cap + 1', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  try {
    await api.ready();
    const auth = await login(origin + '/api');
    const get = async (path: string) => {
      const r = await fetch(`${origin}/api/${path}`, { headers: auth.read });
      return { status: r.status, body: (await r.json()) as any };
    };
    const made = async (name: string) => {
      const r = await fetch(`${origin}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth.write },
        body: JSON.stringify({ name, record_mode: 'fixture' }),
      });
      return ((await r.json()) as { id: string }).id;
    };
    const ws = await made('L-9 paging');
    const other = await made('L-9 other workspace');
    const store = api.store!;
    const pool = db.pool;
    const actor = DEFAULT_OWNER_ACTOR_ID;

    // The few real records the seeded rows point at.
    const conn = await store.registerPaymentConnection(owner, ws, {
      label: 'Fixture processor',
      processor: 'fixture',
      mode: 'fixture',
      account_id: 'acct_fixture0001',
      secret_key_env: null,
      webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
    });
    const release = await verifiedRelease(store, pool, ws, owner);
    await pool.query(
      `insert into reinvestment_policies (workspace_id, version, body, anchor_at, created_by)
       values ($1, 1, '{}', now(), $2)`,
      [ws, actor],
    );
    // `at(g)`: pairs share a microsecond, so ties are broken by id at the page edge too.
    const at = `now() - interval '1 day' + ((g / 2) * interval '1 microsecond')`;
    const seed = async (sql: string, n: number, extra: unknown[] = []) =>
      pool.query(sql.replaceAll('$AT', at), [ws, actor, n, ...extra]);

    await seed(
      `insert into budget_envelopes (id, workspace_id, fixture, kind, name, status, cap_nano,
         max_in_flight, created_by, created_at)
       select gen_random_uuid(), $1, true, 'global', 'Budget ' || g, 'active', 0, 1, $2, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      201,
    );
    const envelope = (
      await pool.query<{ id: string }>(
        'select id from budget_envelopes where workspace_id = $1 limit 1',
        [ws],
      )
    ).rows[0]!.id;
    await seed(
      `insert into payment_offers (id, workspace_id, connection_id, product_id, artifact_id,
         manifest_sha256, label, price_nano, status, created_by, created_at)
       select gen_random_uuid(), $1, $4, $5, $6, $7, 'Offer ' || g, 10000000, 'active', $2, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      201,
      [
        conn.id,
        release.product_id,
        release.artifact_id,
        release.manifest_sha256,
      ],
    );
    const offer = (
      await pool.query<{ id: string }>(
        'select id from payment_offers where workspace_id = $1 limit 1',
        [ws],
      )
    ).rows[0]!.id;
    await seed(
      `insert into entitlements (id, workspace_id, offer_id, connection_id, payment_id,
         customer_ref, product_id, artifact_id, manifest_sha256, status, reason, version,
         created_at, updated_at)
       select gen_random_uuid(), $1, $4, $5, 'pay-' || g, 'cust-' || g, $6, $7, $8, 'active',
         'Seeded.', 1, $AT, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      501,
      [
        offer,
        conn.id,
        release.product_id,
        release.artifact_id,
        release.manifest_sha256,
      ],
    );
    await seed(
      `insert into earnings_tranches (id, workspace_id, connection_id, payment_id, bps,
         earned_nano, cap_nano, settled_at, eligible_at)
       select gen_random_uuid(), $1, $4, 'pay-' || g, 5000, 0, 0, $AT, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      501,
      [conn.id],
    );
    await seed(
      `insert into reinvestment_allocations (id, workspace_id, policy_version, period_start,
         requested_nano, amount_nano, envelope_id, capacity, created_by, created_at)
       select gen_random_uuid(), $1, 1, now(), 1, 1, $4, '{}', $2, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      201,
      [envelope],
    );
    await seed(
      `insert into marketing_campaigns (id, workspace_id, artifact_id, request, content,
         content_hash, created_by, created_at)
       select gen_random_uuid(), $1, $4, '{}', '{"label": "Campaign"}', repeat('a', 64), $2, $AT
       from generate_series(0, $3 - 1) g where $2::uuid is not null`,
      201,
      [release.artifact_id],
    );

    const lists = [
      ['budgets', 'budget_envelopes', 'created_at', 200],
      ['payment-offers', 'payment_offers', 'created_at', 200],
      ['entitlements', 'entitlements', 'created_at', 500],
      ['reinvestment/tranches', 'earnings_tranches', 'settled_at', 500],
      [
        'reinvestment/allocations',
        'reinvestment_allocations',
        'created_at',
        200,
      ],
      ['marketing-campaigns', 'marketing_campaigns', 'created_at', 200],
    ] as const;
    for (const [path, table, column, cap] of lists) {
      const base = `workspaces/${ws}/${path}`;
      const all = (
        await pool.query<{ id: string }>(
          `select id from ${table} where workspace_id = $1 order by ${column} desc, id desc`,
          [ws],
        )
      ).rows.map((r) => r.id);
      assert.equal(all.length, cap + 1, path);
      // First page: the newest `cap`, newest first; only the oldest is left for page two.
      const first = await get(base);
      assert.equal(first.status, 200, path);
      assert.deepEqual(
        first.body.map((r: { id: string }) => r.id),
        all.slice(0, cap),
        `${path}: the first page is the newest ${cap}, newest first`,
      );
      const second = await get(`${base}?before=${all[cap - 1]}`);
      assert.deepEqual(
        second.body.map((r: { id: string }) => r.id),
        [all[cap]],
        `${path}: the next page holds only the oldest record`,
      );
      assert.deepEqual((await get(`${base}?before=${all[cap]}`)).body, []);
      // Smaller pages walk the whole list once, in order, across tied timestamps.
      const walked: string[] = [];
      let before = '';
      for (;;) {
        const page = await get(
          `${base}?limit=7${before ? `&before=${before}` : ''}`,
        );
        assert.equal(page.status, 200, path);
        walked.push(...page.body.map((r: { id: string }) => r.id));
        if (page.body.length < 7) break;
        before = page.body[page.body.length - 1].id;
      }
      assert.deepEqual(walked, all, `${path}: pages of 7 walk every record`);
      // Bad page requests are refused, not answered with a quietly wrong page.
      for (const q of ['limit=0', `limit=${cap + 1}`, 'limit=-1', 'before=x'])
        assert.equal((await get(`${base}?${q}`)).status, 400, `${path} ${q}`);
      assert.equal(
        (await get(`${base}?before=${randomUUID()}`)).status,
        404,
        `${path}: a cursor naming no record`,
      );
      // A cursor from another workspace names no record here.
      assert.equal(
        (await get(`workspaces/${other}/${path}?before=${all[0]}`)).status,
        404,
        `${path}: a cursor from another workspace`,
      );
    }
    // Filters still apply within a page.
    const own = await get(
      `workspaces/${ws}/entitlements?customer_ref=cust-3&limit=5`,
    );
    assert.deepEqual(
      own.body.map((r: { customer_ref: string }) => r.customer_ref),
      ['cust-3'],
    );
    // PR #125 review L-2: one offer reads by id (a checkout whose offer is past the loaded
    // pages); an unknown id is 404 and another workspace's offer is not readable here.
    const offers = (await get(`workspaces/${ws}/payment-offers?limit=1`)).body;
    const oldest = (
      await pool.query<{ id: string }>(
        'select id from payment_offers where workspace_id = $1 order by created_at, id limit 1',
        [ws],
      )
    ).rows[0]!.id;
    const one = await get(`workspaces/${ws}/payment-offers/${oldest}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.id, oldest);
    assert.notEqual(offers[0].id, oldest);
    assert.equal(
      (await get(`workspaces/${ws}/payment-offers/${randomUUID()}`)).status,
      404,
    );
    assert.equal(
      (await get(`workspaces/${other}/payment-offers/${oldest}`)).status,
      404,
    );
  } finally {
    await api.close();
  }
});

test('L-9 portfolio schedules: the view lists the newest first and older ones page by cursor', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new PortfolioStore(db.pool);
  const ctx = { actorId: randomUUID() };
  const s = await portfolioFixture(store, db.pool, ctx);
  const made: string[] = [];
  for (const lane of ['maintenance', 'maintenance', 'maintenance'] as const) {
    const run = await s.run(lane);
    const schedule = await store.createPortfolioSchedule(ctx, s.ws, {
      label: `Refresh ${made.length}`,
      run_id: run.id,
      lane,
      interval_seconds: 60,
      first_due_at: s.due(),
      operation: {
        kind: 'source_refresh',
        source_id: s.source.id,
        source_version: s.source.version,
        source_hash: s.source.content_hash,
      },
    });
    made.push(schedule.id);
  }
  const newest = [...made].reverse();
  const view = await store.inspectPortfolio(ctx, s.ws);
  assert.deepEqual(
    view.schedules.map((r) => (r as { id: string }).id),
    newest,
  );
  const ids = async (page: { before?: string; limit?: number }) =>
    (await store.listPortfolioSchedules(ctx, s.ws, page)).map(
      (r) => (r as { id: string }).id,
    );
  assert.deepEqual(await ids({ limit: 2 }), newest.slice(0, 2));
  assert.deepEqual(await ids({ limit: 2, before: newest[1]! }), [newest[2]]);
  assert.deepEqual(await ids({ before: newest[2]! }), []);
  await assert.rejects(
    store.listPortfolioSchedules(ctx, s.ws, { before: randomUUID() }),
    (e: unknown) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
  await assert.rejects(
    store.listPortfolioSchedules(ctx, s.ws, { limit: 201 }),
    (e: unknown) => e instanceof ContractError && e.code === 'INVALID_CONTRACT',
  );
});

// The web list helpers (apps/web/src/older-pages.ts) have no imports, so they load here.
type OlderPages = {
  withOlder: <T extends { id: string }>(first: T[], older: T[]) => T[];
  mayHaveOlder: (lastPageLength: number, pageSize: number) => boolean;
  olderPath: (path: string, last: { id: string }) => string;
  rereadOlder: <T extends { id: string }>(
    fetchPage: (before: string) => Promise<T[]>,
    first: T[],
    shownBeyond: number,
    pageSize: number,
  ) => Promise<{ rows: T[]; lastLength: number | null }>;
};
async function olderPages(): Promise<OlderPages> {
  const source = await readFile('apps/web/src/older-pages.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as OlderPages;
  new Function('exports', code)(exports);
  return exports;
}

test('L-9 web: "Show older" keeps a record a refresh pushed out of the first page', async () => {
  const { withOlder, mayHaveOlder, olderPath } = await olderPages();
  const r = (id: string) => ({ id });
  // Shown: first page [c, b] then an older page [a]. A new record d arrives: the first page
  // is now [d, c], and b, pushed out of it, must still show, in order, once.
  const shown = withOlder([r('c'), r('b')], [r('a')]);
  assert.deepEqual(
    withOlder([r('d'), r('c')], shown).map((x) => x.id),
    ['d', 'c', 'b', 'a'],
  );
  assert.equal(mayHaveOlder(200, 200), true);
  assert.equal(mayHaveOlder(199, 200), false);
  assert.equal(mayHaveOlder(0, 200), false);
  assert.equal(
    olderPath('workspaces/w/budgets', r('x')),
    'workspaces/w/budgets?before=x',
  );
  assert.equal(
    olderPath('workspaces/w/entitlements?offer_id=o', r('x')),
    'workspaces/w/entitlements?offer_id=o&before=x',
  );
});

test('PR #125 review L-1: older pages shown are read again after the first page is', async () => {
  const { rereadOlder, withOlder } = await olderPages();
  type R = { id: string; state: string };
  // Server list, newest first, pages of 2: e d | c b | a. "c" was closed since it was shown.
  let rows: R[] = ['e', 'd', 'c', 'b', 'a'].map((id) => ({
    id,
    state: id === 'c' ? 'closed' : 'active',
  }));
  const asked: string[] = [];
  const fetchPage = async (before: string) => {
    asked.push(before);
    const i = rows.findIndex((r) => r.id === before);
    return rows.slice(i + 1, i + 3);
  };
  // Three were shown past the first page (c, b, a): two pages are read again, in order.
  const again = await rereadOlder(fetchPage, rows.slice(0, 2), 3, 2);
  assert.deepEqual(asked, ['d', 'b']);
  assert.deepEqual(
    again.rows.map((r) => `${r.id}:${r.state}`),
    ['c:closed', 'b:active', 'a:active'],
  );
  assert.equal(again.lastLength, 1);
  // Only one page had been shown (c, b): one page is read again, and more may follow.
  asked.length = 0;
  const one = await rereadOlder(fetchPage, rows.slice(0, 2), 2, 2);
  assert.deepEqual(asked, ['d']);
  assert.equal(one.lastLength, 2);
  // A new record "f" pushes "d" out of the first page: "d" is read again with the older ones.
  rows = [{ id: 'f', state: 'active' }, ...rows];
  const pushed = await rereadOlder(fetchPage, rows.slice(0, 2), 3, 2);
  assert.deepEqual(
    withOlder(rows.slice(0, 2), pushed.rows).map((r) => r.id),
    ['f', 'e', 'd', 'c', 'b', 'a'],
  );
  // A first page that is no longer full means nothing older exists: nothing is read.
  asked.length = 0;
  const short = await rereadOlder(fetchPage, rows.slice(0, 1), 3, 2);
  assert.deepEqual(asked, []);
  assert.deepEqual(short, { rows: [], lastLength: null });
});
