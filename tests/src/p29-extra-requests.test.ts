import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  PLAN_EXTRA_HOURS,
  PLAN_EXTRA_REQUESTS,
  PlanAdmissionRequestSchema,
  PlanConnectionDetailSchema,
  UsageSummarySchema,
  type PlanConnection,
  type PlanRefusal,
} from '@creator/contracts';
import { admissionRefusals, dailyCap, nextRequestAt } from '@creator/domain';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';
import { loadWeb } from './web-module.js';

// ADR-0094 (P29, walk item 6): when a connection's daily request cap is used up, the owner can
// add 20 requests for the next 24 hours, again each time it runs out. Only the window in use
// now is raised: the configured cap is unchanged, recorded usage is untouched, and the next
// window starts at the configured cap once the extra expires.

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];
const CAP = SETTINGS.caps.shared.max_model_requests_per_day;
const HOUR = 3_600_000;

const USAGE = {
  last_24h_requests: 0,
  last_24h_codex_builds: 0,
  extra_requests: 0,
  run_requests: 0,
  build_requests: 0,
  in_flight: 0,
  unresolved: 0,
};

const ready = () =>
  ({
    id: randomUUID(),
    kind: 'chatgpt_plan',
    settings: {
      ...SETTINGS,
      allowed_data_classes: ['synthetic'],
      allowed_task_classes: ['summarization'],
    },
    sign_in: { state: 'signed_in', plan_usage_granted: true },
    credits: { state: 'confirmed_off' },
    caps_accepted_at: new Date().toISOString(),
    eligibility: { state: 'eligible' },
    quota: { state: 'available' },
  }) as unknown as PlanConnection;

const codes = (c: PlanConnection, usage: typeof USAGE) =>
  admissionRefusals({
    connection: c,
    access: [],
    qualifications: [],
    grant: null,
    usage,
    now: new Date(),
    request: PlanAdmissionRequestSchema.parse({
      connection_id: c.id,
      logical_operation_id: randomUUID(),
      path: 'responses',
      purpose: 'task',
      model_id: 'm1',
      task_class: 'summarization',
      data_class: 'synthetic',
      run_id: null,
      build_id: null,
      grant_id: null,
      qualification_id: null,
      input_chars: 10,
    }),
  }).map((r) => r.code);

test('admission counts unexpired extra requests on top of the configured daily cap', () => {
  const c = ready();
  assert.equal(dailyCap(c.settings.caps, { extra_requests: 20 }), CAP + 20);
  const full = { ...USAGE, last_24h_requests: CAP };
  assert.ok(codes(c, full).includes('daily_cap_reached'));
  // With 20 extra, the same count is admitted, up to the configured cap plus 20.
  assert.ok(
    !codes(c, { ...full, extra_requests: 20 }).includes('daily_cap_reached'),
  );
  assert.ok(
    codes(c, {
      ...full,
      last_24h_requests: CAP + 20,
      extra_requests: 20,
    }).includes('daily_cap_reached'),
  );
  // Other caps keep their own code.
  assert.ok(!codes(c, USAGE).includes('daily_cap_reached'));
});

test('a used-up daily cap offers the extra-requests fix in place', async () => {
  type FixHere = {
    refusalFixes: (
      r: readonly PlanRefusal[],
      role: string,
      canQualify: (t: string) => boolean,
    ) => { kind: string; connection_id: string }[];
    fixLabel: (a: unknown) => string;
  };
  const m = (await loadWeb('fix-here.ts')) as FixHere;
  const id = randomUUID();
  const fixes = m.refusalFixes(
    [
      { code: 'daily_cap_reached', text: 'x', connection_id: id },
      { code: 'cap_reached', text: 'per run', connection_id: id },
    ],
    'plan',
    () => false,
  );
  assert.deepEqual(fixes, [{ kind: 'extra_requests', connection_id: id }]);
  assert.equal(
    m.fixLabel(fixes[0]),
    `Add ${PLAN_EXTRA_REQUESTS} requests for ${PLAN_EXTRA_HOURS} hours`,
  );
});

test('only the owner adds extra requests, only when used up, and only the current window changes', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner: CommandContext = { actorId: randomUUID() };
  const editor: CommandContext = { actorId: randomUUID() };
  const viewer: CommandContext = { actorId: randomUUID() };
  const tester: CommandContext = { actorId: randomUUID() };
  for (const [a, n] of [
    [owner, 'owner'],
    [editor, 'editor'],
    [viewer, 'viewer'],
    [tester, 'tester'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind: 'human', display_name: n });
  const ws = await store.createWorkspace(owner, {
    name: 'Extra',
    record_mode: 'real',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await store.addMember(owner, ws.id, viewer.actorId, 'viewer');
  // Made an owner before it became a tester account (the route refuses a tester owner).
  await store.addMember(owner, ws.id, tester.actorId, 'owner');
  let conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const now = Date.now();
  const add = (agoMs: number) =>
    db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose,
         model_id, data_class, state, created_by, started_at)
       values ($1, $2, $3, 'responses', 'task', 'm', 'synthetic', 'completed', $4, $5)`,
      [
        randomUUID(),
        conn.id,
        randomUUID(),
        owner.actorId,
        new Date(now - agoMs),
      ],
    );
  const grant = (who: CommandContext, version = conn.version) =>
    store.grantExtraRequests(who, ws.id, conn.id, {
      expected_version: version,
      requests: PLAN_EXTRA_REQUESTS,
    });
  const refused = async (p: Promise<unknown>, code: string) => {
    await assert.rejects(
      p,
      (e: unknown) => e instanceof ContractError && e.code === code,
    );
  };
  const plan = async (who: CommandContext) => {
    const u = UsageSummarySchema.parse(await store.usageSummary(who, ws.id));
    return u.plans.find((x) => x.connection_id === conn.id)!;
  };
  const counted = (): Promise<number> =>
    db.pool
      .query('select count(*)::int as n from plan_extra_requests')
      .then((r) => (r.rows[0] as { n: number }).n);

  // With room left, nobody can add: extras are for a used-up cap.
  await add(2 * HOUR);
  await refused(grant(owner), 'INVALID_TRANSITION');
  assert.equal((await plan(owner)).daily.can_add_extra, false);

  // Used up (at the cap).
  for (let i = 1; i < CAP; i++) await add(1 * HOUR);
  const full = await plan(owner);
  assert.equal(full.daily.remaining, 0);
  assert.equal(full.daily.can_add_extra, true);
  assert.equal(full.connection_version, conn.version);
  assert.equal((await plan(viewer)).daily.can_add_extra, false);
  assert.equal((await plan(editor)).daily.can_add_extra, false);
  // Review L-3: the card's detail says when the next request is possible, as the panel does.
  const fullDetail = PlanConnectionDetailSchema.parse(
    await store.planConnectionDetail(owner, ws.id, conn.id),
  );
  assert.equal(fullDetail.usage.next_frees_at, full.daily.next_frees_at);
  assert.ok(fullDetail.usage.next_frees_at);
  assert.equal(fullDetail.usage.can_add_extra, true);
  assert.equal(
    (await store.planConnectionDetail(viewer, ws.id, conn.id)).usage
      .can_add_extra,
    false,
  );
  // Review L-1: a tester account holding the owner role is not offered the press, and the
  // server refuses it, as it does every policy change (ADR-0075).
  await db.pool.query(
    `insert into tester_accounts (actor_id, issuer, subject, workspace_role, expires_at, created_by)
     values ($1, 'https://issuer.example', 'tester', 'editor', now() + interval '1 day', $2)`,
    [tester.actorId, owner.actorId],
  );
  assert.equal((await plan(tester)).daily.can_add_extra, false);
  assert.equal(
    (await store.planConnectionDetail(tester, ws.id, conn.id)).usage
      .can_add_extra,
    false,
  );
  await refused(grant(tester), 'ACCESS_DENIED');

  // A viewer and an editor are refused; nothing is recorded.
  await refused(grant(viewer), 'ACCESS_DENIED');
  await refused(grant(editor), 'ACCESS_DENIED');
  // Only the decided amount is accepted.
  await refused(
    store.grantExtraRequests(owner, ws.id, conn.id, {
      expected_version: conn.version,
      requests: 1000,
    }),
    'INVALID_CONTRACT',
  );
  // A stale version is refused.
  await refused(grant(owner, conn.version + 5), 'VERSION_CONFLICT');
  assert.equal(await counted(), 0);

  // The owner adds 20: the connection's version moves on, its settings do not.
  const before = conn;
  conn = await grant(owner);
  assert.equal(conn.version, before.version + 1);
  assert.equal(conn.settings_hash, before.settings_hash);
  assert.equal(conn.settings.caps.shared.max_model_requests_per_day, CAP);
  const raised = await plan(owner);
  assert.equal(raised.daily.cap, CAP + PLAN_EXTRA_REQUESTS);
  assert.equal(raised.daily.configured_cap, CAP);
  assert.equal(raised.daily.extra, PLAN_EXTRA_REQUESTS);
  assert.equal(raised.daily.remaining, PLAN_EXTRA_REQUESTS);
  assert.equal(raised.daily.can_add_extra, false);
  assert.equal(raised.daily.extras.length, 1);
  const until = Date.parse(raised.daily.extras[0]!.expires_at);
  assert.ok(Math.abs(until - (now + PLAN_EXTRA_HOURS * HOUR)) < 60_000);
  const detail = PlanConnectionDetailSchema.parse(
    await store.planConnectionDetail(owner, ws.id, conn.id),
  );
  assert.equal(detail.usage.extra_requests, PLAN_EXTRA_REQUESTS);
  assert.deepEqual(detail.usage.extras, raised.daily.extras);
  // With room again there is no offer; the next-request time follows the panel's rule
  // (re-review 2 N-2).
  assert.equal(detail.usage.next_frees_at, raised.daily.next_frees_at);
  assert.equal(detail.usage.can_add_extra, false);
  // Admission, given the store's counts, admits again.
  assert.ok(
    !codes(ready(), {
      ...USAGE,
      last_24h_requests: detail.usage.last_24h_requests,
      extra_requests: detail.usage.extra_requests,
    }).includes('daily_cap_reached'),
  );
  // A second press while there is room is refused (no doubling by a double click).
  await refused(grant(owner), 'INVALID_TRANSITION');

  // Run out again: the owner can add 20 more, as often as it runs out.
  for (let i = 0; i < PLAN_EXTRA_REQUESTS; i++) await add(0);
  assert.equal((await plan(owner)).daily.can_add_extra, true);
  conn = await grant(owner);
  const again = await plan(owner);
  assert.equal(again.daily.extra, 2 * PLAN_EXTRA_REQUESTS);
  assert.equal(again.daily.cap, CAP + 2 * PLAN_EXTRA_REQUESTS);
  assert.equal(await counted(), 2);

  // Recorded usage is never rewritten, and grants are kept as made.
  const used = await db.pool.query(
    'select count(*)::int as n from plan_requests where connection_id = $1',
    [conn.id],
  );
  assert.equal((used.rows[0] as { n: number }).n, CAP + PLAN_EXTRA_REQUESTS);
  await assert.rejects(
    db.pool.query(
      `update plan_extra_requests set expires_at = expires_at + interval '1 day'`,
    ),
  );
  await assert.rejects(db.pool.query('delete from plan_extra_requests'));

  // The grant and its summary are on the connection's events and in the audit log.
  const ev = await db.pool.query(
    `select body from plan_connection_events
      where connection_id = $1 and kind = 'extra_requests_granted' order by created_at`,
    [conn.id],
  );
  assert.equal(ev.rows.length, 2);
  const body = (ev.rows[0] as { body: Record<string, unknown> }).body;
  assert.equal(body.configured_cap, CAP);
  assert.equal(body.cap_before, CAP);
  assert.equal(body.cap_now, CAP + PLAN_EXTRA_REQUESTS);
  assert.match(String(body.summary), /configured cap stays/);
  const audit = await db.pool.query(
    `select count(*)::int as n from audit_events where action = 'connection.extra_requests_granted'`,
  );
  assert.equal((audit.rows[0] as { n: number }).n, 2);
});

test('an expired extra stops counting and the next window starts at the configured cap', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Expired',
    record_mode: 'real',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  // An extra granted 25 hours ago has expired; one granted an hour ago still counts.
  const grantAt = async (agoHours: number) =>
    db.pool.query(
      `insert into plan_extra_requests (id, connection_id, requests, configured_cap,
         used_at_grant, settings_hash, connection_version, granted_by, granted_at, expires_at)
       values ($1,$2,20,$3,$3,$4,$5,$6,
         clock_timestamp() - make_interval(hours => $7),
         clock_timestamp() - make_interval(hours => $7) + interval '24 hours')`,
      [
        randomUUID(),
        conn.id,
        CAP,
        conn.settings_hash,
        conn.version,
        owner.actorId,
        agoHours,
      ],
    );
  await grantAt(25);
  const summary = async () =>
    UsageSummarySchema.parse(await store.usageSummary(owner, ws.id)).plans[0]!;
  let p = await summary();
  assert.equal(p.daily.cap, CAP);
  assert.equal(p.daily.extra, 0);
  assert.deepEqual(p.daily.extras, []);
  const d = await store.planConnectionDetail(owner, ws.id, conn.id);
  assert.equal(d.usage.extra_requests, 0);
  await grantAt(1);
  p = await summary();
  assert.equal(p.daily.cap, CAP + 20);
  assert.equal(p.daily.configured_cap, CAP);
});

test('the confirmation says what changes and what does not', async () => {
  const m = (await loadWeb('extra-requests-text.ts')) as {
    extraConfirmText: (configured: number, cap: number) => string;
    extraLine: (
      extras: { requests: number; expires_at: string }[],
      configured: number,
    ) => string | null;
  };
  const text = m.extraConfirmText(40, 60);
  assert.match(text, /Adds 20 requests .* next 24 hours \(60 → 80\)/);
  assert.match(text, /configured cap of 40 a day is not changed/);
  assert.match(text, /not API money/);
  assert.equal(m.extraLine([], 40), null);
  const soon = new Date(Date.now() + 2 * HOUR).toISOString();
  const late = new Date(Date.now() + 20 * HOUR).toISOString();
  assert.match(
    m.extraLine([{ requests: 20, expires_at: soon }], 40)!,
    /^Includes 20 extra requests until .*; after that the cap is 40 a day again\.$/,
  );
  // Review L-2: two extras are each named with their own expiry.
  assert.match(
    m.extraLine(
      [
        { requests: 20, expires_at: soon },
        { requests: 20, expires_at: late },
      ],
      40,
    )!,
    /^Includes 40 extra requests: 20 until .+ and 20 until .+; after the last expires the cap is 40 a day again\.$/,
  );
});

test('review L-2: the next request time counts an extra that expires before a request leaves', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const DAY = 24 * HOUR;
  // Below the cap: when the oldest request leaves.
  assert.equal(
    nextRequestAt([now - 5 * HOUR], 2, [], now),
    now - 5 * HOUR + DAY,
  );
  assert.equal(nextRequestAt([], 2, [], now), null);
  // Configured cap 2, no extra, 3 used: two must leave.
  const starts = [now - 20 * HOUR, now - 10 * HOUR, now - 1 * HOUR];
  assert.equal(nextRequestAt(starts, 2, [], now), starts[1]! + DAY);
  // With an extra of 1 expiring in an hour (cap 3 now, 2 after), the cap is used up; the first
  // leaving (in 4 h) is after the extra expired, so one leaving is not enough: two must leave.
  assert.equal(
    nextRequestAt(starts, 2, [{ requests: 1, expires_ms: now + HOUR }], now),
    starts[1]! + DAY,
  );
  // An extra that outlasts the first leaving: one leaving is enough.
  assert.equal(
    nextRequestAt(
      starts,
      2,
      [{ requests: 1, expires_ms: now + 8 * HOUR }],
      now,
    ),
    starts[0]! + DAY,
  );
  // Cap 0 and nothing extra: no leaving ever makes room.
  assert.equal(nextRequestAt([now - HOUR], 0, [], now), null);
});

test('re-review 2 N-1: every unexpired extra is listed; the contracts set no cap on how many', () => {
  const extras = Array.from({ length: 60 }, (_, i) => ({
    requests: PLAN_EXTRA_REQUESTS,
    expires_at: new Date(Date.UTC(2026, 10, 12, 0, i)).toISOString(),
  }));
  const detail = PlanConnectionDetailSchema.shape.usage.shape.extras;
  const summary =
    UsageSummarySchema.shape.plans.element.shape.daily.shape.extras;
  assert.ok(detail.safeParse(extras).success);
  assert.ok(summary.safeParse(extras).success);
});
