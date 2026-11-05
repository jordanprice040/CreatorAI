import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  type ErrorCode,
  type LibraryPage,
} from '@creator/contracts';
import { DISCOVERY_SCENARIOS } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// P01 (activity destinations) and P02 (server-side sort and paging for Search and Library).
// Records are made through the real store; their creation times are then rewritten with SQL
// (test seam) so pairs share one microsecond, which makes every page edge a tie that only the
// id can break.

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;

async function seeded(t: test.TestContext, n: number) {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return null;
  for (let i = 0; i < n; i++)
    await s.store.createEntity(owner, s.ws.id, {
      kind: 'idea',
      title: `Idea ${String(i).padStart(3, '0')} ${i % 2 ? 'beta' : 'Alpha'}`,
      body: { summary: `Seeded idea ${i}`, uncertainty: 'Untested' },
    });
  await s.db.pool.query(
    `with x as (select id, row_number() over (order by id) - 1 as g
                  from entities where workspace_id = $1)
     update entities e
        set created_at = now() - interval '1 day' + ((x.g / 2) * interval '1 microsecond'),
            updated_at = now() - interval '2 days' + ((x.g % 7) * interval '1 second')
       from x where e.id = x.id`,
    [s.ws.id],
  );
  /** The order the database itself gives, as the reference for every page walk. */
  const expected = async (order: string) =>
    (
      await s.db.pool.query<{ id: string }>(
        `select id from entities where workspace_id = $1 and kind = 'idea'
          order by ${order}`,
        [s.ws.id],
      )
    ).rows.map((r) => r.id);
  return { ...s, expected };
}

test('P02 Library sorts on the server before the limit and pages with bound cursors', async (t) => {
  const s = await seeded(t, 205);
  if (!s) return;
  const walk = async (sort: string, limit = 100) => {
    const ids: string[] = [];
    let after: string | undefined;
    let pages = 0;
    for (;;) {
      const page: LibraryPage = await s.store.library(owner, s.ws.id, {
        kind: 'idea',
        sort,
        limit,
        ...(after ? { after } : {}),
      });
      pages++;
      assert.equal(page.total, 205, 'the total is the same on every page');
      assert.equal(page.sort, sort);
      ids.push(...page.entities.map((e) => e.id));
      if (!page.next) break;
      after = page.next;
    }
    return { ids, pages };
  };
  // Newest by creation, ties broken by id; cap + 1 and several pages.
  const newest = await walk('newest');
  assert.equal(newest.pages, 3);
  assert.equal(new Set(newest.ids).size, 205, 'no row repeats across pages');
  assert.deepEqual(
    newest.ids,
    await s.expected('created_at desc, id::text desc'),
  );
  assert.deepEqual(
    (await walk('oldest', 2)).ids,
    await s.expected('created_at asc, id::text asc'),
  );
  assert.deepEqual(
    (await walk('updated', 64)).ids,
    await s.expected('updated_at desc, id::text desc'),
  );
  assert.deepEqual(
    (await walk('name', 50)).ids,
    await s.expected('lower(title) asc, id::text asc'),
  );
  // The default is newest, and the newest record is on the first page.
  const first = await s.store.library(owner, s.ws.id, { kind: 'idea' });
  assert.equal(first.sort, 'newest');
  assert.equal(first.entities[0]!.id, newest.ids[0]);
  assert.equal(first.entities.length, 100);

  // A record added between pages is newer than the cursor: no repeat, no gap.
  const page1 = await s.store.library(owner, s.ws.id, {
    kind: 'idea',
    limit: 100,
  });
  const late = await s.store.createEntity(owner, s.ws.id, {
    kind: 'idea',
    title: 'Late idea',
    body: { summary: 'Added while paging', uncertainty: 'Untested' },
  });
  const page2 = await s.store.library(owner, s.ws.id, {
    kind: 'idea',
    limit: 100,
    after: page1.next!,
  });
  assert.deepEqual(
    page2.entities.map((e) => e.id),
    newest.ids.slice(100, 200),
  );
  assert.equal(page2.total, 206);
  const fresh = await s.store.library(owner, s.ws.id, { kind: 'idea' });
  assert.equal(fresh.entities[0]!.id, late.id, 'a reload shows it first');

  // A cursor only continues the order and filters it was made under.
  await rejects(
    'INVALID_CONTRACT',
    s.store.library(owner, s.ws.id, {
      kind: 'idea',
      sort: 'oldest',
      after: page1.next!,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.library(owner, s.ws.id, { kind: 'problem', after: page1.next! }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.library(owner, s.ws.id, { kind: 'idea', after: 'not-a-cursor' }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.library(owner, s.ws.id, { sort: 'random' }),
  );
  // Non-members learn nothing, not even the count.
  const stranger = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await rejects('NOT_FOUND', s.store.library(stranger, s.ws.id));
});

test('P02 Search reads newest first by creation, pages each type and says which order it used', async (t) => {
  const s = await seeded(t, 21);
  if (!s) return;
  const base = {
    q: 'seeded',
    types: ['record'],
    kind: 'idea',
    status: null,
    limit: 20,
  };
  const r = await s.store.search(owner, s.ws.id, base);
  assert.equal(r.order, 'newest');
  assert.equal(r.counts.record, 21);
  assert.equal(r.hits.length, 20);
  assert.equal(r.truncated, true);
  const all = await s.expected('created_at desc, id::text desc');
  assert.deepEqual(
    r.hits.map((h) => h.id),
    all.slice(0, 20),
  );
  // The time shown is creation time, the time the list is ordered by.
  const times = r.hits.map((h) => h.occurred_at);
  assert.deepEqual(times, [...times].sort().reverse());
  // Cap + 1: the second page holds exactly the one left, and says there is no more.
  const more = await s.store.search(owner, s.ws.id, {
    ...base,
    after: r.next.record,
  });
  assert.deepEqual(
    more.hits.map((h) => h.id),
    all.slice(20),
  );
  assert.equal(more.next.record, undefined);
  assert.equal(more.counts.record, 21);
  // Oldest is the reverse; relevance on words ranks, and an id search cannot rank.
  const oldest = await s.store.search(owner, s.ws.id, {
    ...base,
    sort: 'oldest',
  });
  assert.deepEqual(
    oldest.hits.map((h) => h.id),
    [...all].reverse().slice(0, 20),
  );
  const ranked = await s.store.search(owner, s.ws.id, {
    ...base,
    sort: 'relevance',
  });
  assert.equal(ranked.order, 'relevance');
  const ranked2 = await s.store.search(owner, s.ws.id, {
    ...base,
    sort: 'relevance',
    after: ranked.next.record,
  });
  assert.equal(
    new Set([...ranked.hits, ...ranked2.hits].map((h) => h.id)).size,
    21,
  );
  const byId = await s.store.search(owner, s.ws.id, {
    ...base,
    q: all[0]!,
    sort: 'relevance',
  });
  assert.equal(byId.mode, 'id');
  assert.equal(byId.order, 'newest', 'the result says relevance was not used');
  // A cursor continues one type, under its own sort and words only.
  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, {
      ...base,
      types: ['record', 'activity'],
      after: r.next.record,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, {
      ...base,
      sort: 'oldest',
      after: r.next.record,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, {
      ...base,
      q: 'idea',
      after: r.next.record,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, {
      ...base,
      types: ['activity'],
      after: r.next.record,
    }),
  );
});

test('P01 destinations follow a subject to what a page shows, and never leak other workspaces', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { detail } = await s.discover(software);
  const workflow = detail.workflow.id;
  const dest = (kind: string, id: string) =>
    s.store.destination(owner, s.ws.id, kind, id);

  assert.deepEqual(await dest('workflow', workflow), {
    state: 'available',
    focus: { kind: 'workflow', id: workflow },
  });
  // A finished task opens its workflow on Runs.
  const task = (
    await s.db.pool.query<{ id: string }>(
      'select id from workflow_tasks where workspace_id = $1 and workflow_id = $2 limit 1',
      [s.ws.id, workflow],
    )
  ).rows[0]!.id;
  assert.deepEqual(await dest('workflow_task', task), {
    state: 'available',
    focus: { kind: 'workflow', id: workflow },
  });
  // A record opens itself; archived and redacted say so.
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  assert.deepEqual(await dest('problem', problem.id), {
    state: 'available',
    focus: { kind: 'problem', id: problem.id },
  });
  const idea = await s.store.createEntity(owner, s.ws.id, {
    kind: 'idea',
    title: 'To archive',
    body: { summary: 'Archived later', uncertainty: 'Untested' },
  });
  await s.store.archiveEntity(owner, s.ws.id, idea.id, {
    expected_version: 1,
    reason: 'Duplicate',
  });
  assert.equal((await dest('idea', idea.id)).state, 'archived');

  // Gone, never existed, or in another workspace: all read the same.
  const other = await s.store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'fixture',
  });
  const elsewhere = await s.store.createEntity(owner, other.id, {
    kind: 'idea',
    title: 'Private elsewhere',
    body: { summary: 'Not here', uncertainty: 'Untested' },
  });
  const gone = { state: 'missing', focus: null };
  assert.deepEqual(await dest('idea', elsewhere.id), gone);
  assert.deepEqual(await dest('idea', randomUUID()), gone);
  assert.deepEqual(await dest('workflow', randomUUID()), gone);
  assert.deepEqual(await dest('workflow_task', randomUUID()), gone);
  assert.deepEqual(await dest('chat_conversation', randomUUID()), gone);
  assert.deepEqual(await dest('preview', randomUUID()), gone);
  assert.deepEqual(await dest('decision', randomUUID()), gone);
  // Kinds no page lists open their page; odd names are not looked up anywhere.
  assert.deepEqual(await dest('plan_connection', randomUUID()), {
    state: 'unchecked',
    focus: null,
  });
  assert.deepEqual(await dest('constructor', randomUUID()), {
    state: 'unchecked',
    focus: null,
  });
  await rejects('INVALID_CONTRACT', dest('Workflow;drop', workflow));
  // A malformed id reads like any id that is not here.
  await rejects('NOT_FOUND', dest('workflow', 'not-an-id'));
  const stranger = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await rejects(
    'NOT_FOUND',
    s.store.destination(stranger, s.ws.id, 'workflow', workflow),
  );
});

test('P01/P02 HTTP: Library pages and destinations are served to members, with the default sort', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  try {
    await api.ready();
    const auth = await login(origin);
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(`${origin}/${path}`, {
        ...(body === undefined
          ? { headers: auth.read }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...auth.write },
              body: JSON.stringify(body),
            }),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    const ws = (
      await call('workspaces', { name: 'HTTP', record_mode: 'fixture' })
    ).body.id as string;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await call(`workspaces/${ws}/entities`, {
            kind: 'idea',
            title: `Idea ${i}`,
            body: { summary: 'HTTP', uncertainty: 'Untested' },
          })
        ).body.id,
      );
    const page = await call(`workspaces/${ws}/library?limit=2`);
    assert.equal(page.status, 200);
    assert.equal(page.body.sort, 'newest');
    assert.equal(page.body.total, 3);
    assert.deepEqual(
      page.body.entities.map((e: { id: string }) => e.id),
      [ids[2], ids[1]],
    );
    const rest = await call(
      `workspaces/${ws}/library?limit=2&after=${page.body.next}`,
    );
    assert.deepEqual(
      rest.body.entities.map((e: { id: string }) => e.id),
      [ids[0]],
    );
    assert.equal(rest.body.next, null);
    const sorted = await call(`workspaces/${ws}/search?q=HTTP&sort=oldest`);
    assert.equal(sorted.status, 200);
    assert.equal(sorted.body.order, 'oldest');
    const d = await call(`workspaces/${ws}/destination?kind=idea&id=${ids[0]}`);
    assert.equal(d.status, 200);
    assert.deepEqual(d.body, {
      state: 'available',
      focus: { kind: 'idea', id: ids[0] },
    });
    const gone = await call(
      `workspaces/${ws}/destination?kind=chat_conversation&id=${randomUUID()}`,
    );
    assert.deepEqual(gone.body, { state: 'missing', focus: null });
    const bad = await call(`workspaces/${ws}/library?sort=random`);
    assert.equal(bad.status, 400);
  } finally {
    await api.close();
  }
});
