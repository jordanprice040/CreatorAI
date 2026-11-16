import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import {
  ContractError,
  NOTIFICATION_LINK_PATTERN,
  NotificationSchema,
  type BrokerCallRequest,
  type Notification,
} from '@creator/contracts';
import {
  ConnectionStore,
  NotificationStore,
  notify,
  notifySpendThresholds,
  skippedNotificationEvents,
  type CommandContext,
  type NotifyInput,
} from '@creator/db';
import { failingJobs } from '@creator/api';
import { freshDatabase } from './pg-harness.js';

// ADR-0116 (N1): notification records, their producers, the person-scoped reads and the claim.
// Numbers in test names are the plan's acceptance checks (NOTIFICATIONS_PLAN_2026-11-15 §11).

const owner: CommandContext = { actorId: randomUUID() };
const member: CommandContext = { actorId: randomUUID() };
const second: CommandContext = { actorId: randomUUID() };

/** A store that can write an audit event the way a producer does, and run a hook. */
class Harness extends ConnectionStore {
  emit(
    ctx: CommandContext,
    e: {
      workspaceId: string;
      action: string;
      subjectKind: string;
      subjectId: string;
      subjectVersion: number | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<string> {
    return this.tx((c) =>
      this.append(c, ctx, {
        contentHash: null,
        payload: {},
        ...e,
      }),
    );
  }
  hook<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.tx(fn);
  }
}

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new Harness(db.pool, { lateWindowMs: 0 });
  const inbox = new NotificationStore(db.pool);
  for (const [ctx, name] of [
    [owner, 'Owner'],
    [member, 'Member'],
    [second, 'Second'],
  ] as const)
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: name,
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Notifications',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, member.actorId, 'editor');
  const run = async (ctx: CommandContext, wsId: string) => {
    const r = await store.createEntity(ctx, wsId, {
      kind: 'run',
      title: 'Run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    return (
      await store.registerRun(ctx, wsId, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      })
    ).run_id;
  };
  /** A finished autopilot row, as the runner leaves it, started by `by`. */
  const autopilot = async (
    by: CommandContext,
    stop: string,
    outcome = 'needs_person',
    steps: Record<string, unknown>[] = [{ stop_kind: stop }],
  ) => {
    const id = randomUUID();
    await db.pool.query(
      `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
         policy_version, state, stage, outcome, explanation, steps, version, created_by, finished_at)
       values ($1,$2,$3,true,'{}',$4,array['Synthetic autopilot.'],'autopilot/1.0','finished',
         'select',$5,'Two options are tied.',$6,2,$7,clock_timestamp())`,
      [
        id,
        ws.id,
        await run(owner, ws.id),
        'a'.repeat(64),
        outcome,
        JSON.stringify(steps),
        by.actorId,
      ],
    );
    return id;
  };
  const finished = (
    id: string,
    version: number,
    outcome = 'needs_person',
    ctx: CommandContext = { ...owner, autopilot: { id } },
    extra: Record<string, unknown> = {},
  ) =>
    store.emit(ctx, {
      workspaceId: ws.id,
      action: 'autopilot.finished',
      subjectKind: 'autopilot',
      subjectId: id,
      subjectVersion: version,
      payload: { outcome, ...extra },
    });
  const all = async (ctx: CommandContext) =>
    (await inbox.notifications(ctx)).items;
  const rows = (sql: string, args: unknown[] = []) =>
    db.pool.query(sql, args).then((r) => r.rows as Record<string, unknown>[]);
  return { db, store, inbox, ws, run, autopilot, finished, all, rows };
}

const conflict = (p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === 'VERSION_CONFLICT',
  );

test('N1 checks 1 and 3: a replayed or concurrently delivered event changes nothing', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const id = await s.autopilot(owner, 'tie');
  const event = await s.finished(id, 2);
  await s.store.drainOutbox();
  const [first] = await s.all(owner);
  assert.ok(first);
  NotificationSchema.parse(first);
  assert.equal(first.event_key, 'autopilot.needs_you');
  assert.equal(first.title, 'Autopilot stopped: a tie needs your choice');
  assert.equal(first.link, `#/autopilot/run?ws=${s.ws.id}&id=${id}`);
  assert.equal(first.interrupt_state, 'pending');
  // The claim is spent; a replay must not reset it or count again.
  await s.inbox.claimNotification(owner, first.id, { via: 'toast' });
  await s.store.drainOutbox();
  assert.equal(await s.store.deliver(event), false);
  assert.equal(await s.store.deliver(event), false);
  const [again] = await s.all(owner);
  assert.equal(again!.id, first.id);
  assert.equal(again!.occurrences, 1);
  assert.equal(again!.last_at, first.last_at);
  assert.equal(again!.interrupt_state, 'claimed');
  // Check 3: two deliveries and a drain of a new event at once give one row and one source.
  const other = await s.autopilot(owner, 'tie');
  const e2 = await s.finished(other, 2);
  await Promise.all([
    s.store.deliver(e2),
    s.store.deliver(e2),
    s.store.drainOutbox(),
  ]);
  const made = await s.rows(
    `select n.occurrences, (select count(*)::int from notification_sources x
        where x.notification_id = n.id) as sources
       from notifications n where n.subject_id = $1`,
    [other],
  );
  assert.deepEqual(made, [{ occurrences: 1, sources: 1 }]);
});

test('N1 checks 2 and 4: a repeated hook is a no-op; a distinct source counts without interrupting again', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const input = (source: string): NotifyInput => ({
    actorId: owner.actorId,
    workspaceId: s.ws.id,
    eventKey: 'connection.blocked',
    title: 'Connection stopped work: its sign-in expired',
    body: 'Sign in again in Models to continue.',
    link: `#/connections/models?ws=${s.ws.id}`,
    subjectKind: 'plan_connection',
    subjectId: 'c1',
    dedupeKey: 'conn:c1:sign_in:2026-11-16',
    sourceKey: source,
  });
  const first = await s.store.hook((c) => notify(c, input('planreq:1')));
  assert.equal(first?.created, true);
  // Separate transaction, then twice in one transaction.
  assert.equal(await s.store.hook((c) => notify(c, input('planreq:1'))), null);
  assert.deepEqual(
    await s.store.hook(async (c) => [
      await notify(c, input('planreq:1')),
      await notify(c, input('planreq:1')),
    ]),
    [null, null],
  );
  let [row] = await s.all(owner);
  assert.equal(row!.occurrences, 1);
  await s.inbox.claimNotification(owner, row!.id, { via: 'windows' });
  // Check 4: another refusal of the same kind on the same day.
  const second = await s.store.hook((c) => notify(c, input('planreq:2')));
  assert.deepEqual(second, { id: first!.id, created: false });
  [row] = await s.all(owner);
  assert.equal(row!.occurrences, 2);
  assert.equal(row!.interrupt_state, 'claimed');
  assert.equal(row!.interrupted_via, 'windows');
  // A link that would leave the studio is refused before anything is written.
  for (const link of [
    'https://example.org',
    'javascript:alert(1)',
    '#/x?ws=<b>',
  ]) {
    assert.ok(!NOTIFICATION_LINK_PATTERN.test(link));
    await assert.rejects(
      s.store.hook((c) => notify(c, { ...input(`bad:${link}`), link })),
      ContractError,
    );
  }
});

test('N1 check 5: an autopilot continued and stopped again gets a new row and one more interruption', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const id = await s.autopilot(owner, 'person_choice');
  await s.finished(id, 2);
  await s.store.drainOutbox();
  await s.rows(`update autopilots set version = 4 where id = $1`, [id]);
  await s.finished(id, 4);
  await s.store.drainOutbox();
  const items = await s.all(owner);
  assert.deepEqual(
    items.map((n) => [n.title, n.interrupt_state]),
    [
      ['Autopilot stopped again: needs your choice', 'pending'],
      // Review L-2: the older stop, never shown, can no longer pop up after the newer one.
      ['Autopilot stopped: needs your choice', 'none'],
    ],
  );
});

test('N1 review L-1: a late drain reports the stop the event recorded, and nothing once the run was continued', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // Stopped on a tie at version 2 (one step), continued and stopped differently at version 4.
  const id = await s.autopilot(owner, 'tie', 'needs_person', [
    { stop_kind: 'tie', note: 'Two options tied at the first stop.' },
    { stop_kind: 'failed_step', note: 'A later step failed.' },
  ]);
  await s.rows(`update autopilots set version = 4 where id = $1`, [id]);
  await s.finished(id, 2, 'needs_person', undefined, { steps: 1 });
  // Another one continued and running again: its old stop needs nobody.
  const running = await s.autopilot(owner, 'tie');
  await s.rows(
    `update autopilots set version = 3, state = 'running', outcome = null, finished_at = null
      where id = $1`,
    [running],
  );
  await s.finished(running, 2, 'needs_person', undefined, { steps: 1 });
  await s.store.drainOutbox();
  const items = await s.all(owner);
  assert.deepEqual(
    items.map((n) => [n.subject_id, n.event_key, n.title, n.body]),
    [
      [
        id,
        'autopilot.needs_you',
        'Autopilot stopped: a tie needs your choice',
        'Two options tied at the first stop.',
      ],
    ],
  );
});

test('N1 review M-1: the owner who paused a run is not alerted by its stop; another owner is', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.store.addMember(owner, s.ws.id, second.actorId, 'owner');
  const workflow = randomUUID();
  await s.store.emit(owner, {
    workspaceId: s.ws.id,
    action: 'workflow.control',
    subjectKind: 'workflow',
    subjectId: workflow,
    subjectVersion: 2,
    payload: { control: 'pause', reason: 'Checking something.' },
  });
  // The member's run: the pausing owner hears nothing, the other owner is alerted and the
  // member is told it waits.
  const id = await s.autopilot(member, 'paused', 'needs_person', [
    { stop_kind: 'paused', child: { kind: 'workflow', id: workflow } },
  ]);
  await s.finished(id, 2, 'needs_person', { ...member, autopilot: { id } });
  await s.store.drainOutbox();
  assert.deepEqual(await s.all(owner), []);
  assert.deepEqual(
    (await s.all(second)).map((n) => [n.event_key, n.title]),
    [['autopilot.needs_you', 'Autopilot stopped: paused']],
  );
  assert.deepEqual(
    (await s.all(member)).map((n) => n.event_key),
    ['autopilot.waiting'],
  );
});

test('N1 review L-4: a malformed event is skipped without stalling the outbox', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // An artifact id that no in-app link may carry: notify refuses it.
  const bad = await s.store.emit(owner, {
    workspaceId: s.ws.id,
    action: 'artifact.registered',
    subjectKind: 'artifact',
    subjectId: randomUUID(),
    subjectVersion: 1,
    payload: { artifact_id: 'not a valid id' },
  });
  const id = await s.autopilot(owner, 'tie');
  await s.finished(id, 2);
  const skipped = skippedNotificationEvents();
  const warned: string[] = [];
  t.mock.method(console, 'warn', (line: string) => warned.push(line));
  await s.store.drainOutbox();
  assert.deepEqual(
    (await s.all(owner)).map((n) => n.subject_id),
    [id],
  );
  // Review R-2: the skip is counted and logged with the event, not dropped silently.
  assert.equal(skippedNotificationEvents(), skipped + 1);
  assert.deepEqual(warned, [
    `notifications: skipped event ${bad} (artifact.registered): INVALID_CONTRACT`,
  ]);
  const [state] = await s.rows(
    `select (select delivered_at from outbox where event_id = $1) is not null as delivered,
            exists (select 1 from consumer_inbox where consumer = 'notifications' and event_id = $1) as claimed,
            exists (select 1 from history_projection where event_id = $1) as history`,
    [bad],
  );
  assert.deepEqual(state, { delivered: true, claimed: true, history: true });
  const [left] = await s.rows(
    'select count(*)::int as n from outbox where delivered_at is null',
  );
  assert.equal(left!.n, 0);
});

test('N1 check 6 and 7: one claim wins a race; inbox-only rows and toast-only rows on Windows are never claimed', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const id = await s.autopilot(owner, 'tie');
  await s.finished(id, 2);
  await s.store.drainOutbox();
  const [n] = await s.all(owner);
  const tries = await Promise.allSettled([
    s.inbox.claimNotification(owner, n!.id, { via: 'toast' }),
    s.inbox.claimNotification(owner, n!.id, { via: 'toast' }),
    s.inbox.claimNotification(owner, n!.id, { via: 'windows' }),
    s.inbox.claimNotification(owner, n!.id, { via: 'windows' }),
  ]);
  assert.equal(tries.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of tries.filter((r) => r.status === 'rejected'))
    assert.equal(
      ((r as PromiseRejectedResult).reason as ContractError).code,
      'VERSION_CONFLICT',
    );
  // Someone else cannot claim, read or even see it.
  await assert.rejects(
    s.inbox.claimNotification(member, n!.id, { via: 'toast' }),
    (e: unknown) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
  // Proposal ready is inbox-only by default; build ready is toast-only.
  const p = await s.autopilot(owner, 'other', 'proposal');
  await s.finished(p, 2, 'proposal');
  const artifact = randomUUID();
  await s.store.emit(owner, {
    workspaceId: s.ws.id,
    action: 'artifact.registered',
    subjectKind: 'artifact',
    subjectId: randomUUID(),
    subjectVersion: 1,
    payload: { artifact_id: artifact },
  });
  await s.store.drainOutbox();
  const items = await s.all(owner);
  const proposal = items.find((x) => x.event_key === 'autopilot.proposal')!;
  const build = items.find((x) => x.event_key === 'build.ready')!;
  assert.equal(proposal.interrupt_state, 'none');
  assert.equal(build.mode, 'toast_only');
  assert.equal(build.link, `#/projects/try?ws=${s.ws.id}&id=${artifact}`);
  await conflict(
    s.inbox.claimNotification(owner, proposal.id, { via: 'toast' }),
  );
  await conflict(
    s.inbox.claimNotification(owner, build.id, { via: 'windows' }),
  );
  assert.equal(
    (await s.inbox.claimNotification(owner, build.id, { via: 'toast' }))
      .interrupted_via,
    'toast',
  );
  // Pending lists only what may still interrupt.
  assert.deepEqual(await s.inbox.pendingNotifications(owner), []);
});

test('N1 check 10: own actions never notify; a member’s blocked run alerts the owner and tells the member it waits', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // The member's run is blocked: the owner can resolve it, the member is told it waits.
  const theirs = await s.autopilot(member, 'approval', 'needs_authority');
  await s.finished(theirs, 2, 'needs_authority', {
    ...member,
    autopilot: { id: theirs },
  });
  // The owner's own blocked run: one alert, not two.
  const mine = await s.autopilot(owner, 'approval', 'needs_authority');
  await s.finished(mine, 2, 'needs_authority');
  // The owner cancels their own run: nothing. The owner cancels the member's run: the member hears.
  const own = await s.autopilot(owner, 'other', 'cancelled');
  await s.finished(own, 2, 'cancelled', owner);
  const members = await s.autopilot(member, 'other', 'cancelled');
  await s.finished(members, 2, 'cancelled', owner);
  // An approval the owner asked for themselves is not news; one the member's work asked is.
  for (const by of [owner, member])
    await s.store.emit(by, {
      workspaceId: s.ws.id,
      action: 'decision.requested',
      subjectKind: 'decision',
      subjectId: randomUUID(),
      subjectVersion: 1,
      payload: {
        kind: 'approval',
        reason: `Asked by ${by === owner ? 'owner' : 'member'}.`,
      },
    });
  await s.store.drainOutbox();
  const o = await s.all(owner);
  const m = await s.all(member);
  assert.deepEqual(
    o.map((n) => [n.event_key, n.subject_id, n.body]).sort(),
    [
      [
        'approval.asked',
        o.find((n) => n.event_key === 'approval.asked')!.subject_id,
        'Asked by member.',
      ],
      ['autopilot.needs_you', mine, 'Two options are tied.'],
      ['autopilot.needs_you', theirs, 'Two options are tied.'],
    ].sort(),
  );
  assert.deepEqual(
    m.map((n) => [n.event_key, n.subject_id, n.interrupt_state]).sort(),
    [
      ['autopilot.cancelled', members, 'none'],
      ['autopilot.waiting', theirs, 'none'],
    ].sort(),
  );
});

test('N1 check 11: removing a person before delivery withdraws their item; reads follow access', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.store.addMember(owner, s.ws.id, second.actorId, 'owner');
  await s.store.emit(member, {
    workspaceId: s.ws.id,
    action: 'decision.requested',
    subjectKind: 'decision',
    subjectId: randomUUID(),
    subjectVersion: 1,
    payload: { kind: 'approval', reason: 'Approve a synthetic step.' },
  });
  await s.store.drainOutbox();
  assert.equal((await s.inbox.pendingNotifications(second)).length, 1);
  const [n] = await s.all(second);
  await s.store.removeMember(
    owner,
    s.ws.id,
    second.actorId,
    'Left the project.',
  );
  assert.deepEqual(await s.inbox.pendingNotifications(second), []);
  assert.deepEqual(await s.all(second), []);
  assert.equal((await s.inbox.recentNotifications(second)).unread, 0);
  await assert.rejects(
    s.inbox.claimNotification(second, n!.id, { via: 'windows' }),
    (e: unknown) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
  const [row] = await s.rows(
    'select withdrawn_at, interrupt_state from notifications where id = $1',
    [n!.id],
  );
  assert.ok(row!.withdrawn_at);
  assert.equal(row!.interrupt_state, 'none');
});

test('N1: read, dismiss, read-all, paging, groups, preferences and mutes', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // Preferences: defaults, a versioned save, a stale save refused.
  const p0 = await s.inbox.notificationPreferences(owner);
  assert.equal(p0.version, 0);
  assert.equal(p0.body.quiet_hours.enabled, false);
  const body = {
    ...p0.body,
    events: { 'autopilot.needs_you': 'inbox' as const },
    muted_workspaces: [],
  };
  const p1 = await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body,
  });
  assert.equal(p1.version, 1);
  await conflict(
    s.inbox.setNotificationPreferences(owner, { expected_version: 0, body }),
  );
  // That event now goes to the inbox only.
  const a = await s.autopilot(owner, 'tie');
  await s.finished(a, 2);
  // A muted workspace never interrupts, whatever the event's mode.
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 1,
    body: { ...body, muted_workspaces: [s.ws.id] },
  });
  const b = await s.autopilot(owner, 'failed_step', 'failed');
  await s.finished(b, 2, 'failed');
  for (let i = 0; i < 55; i++)
    await s.store.hook((c) =>
      notify(c, {
        actorId: owner.actorId,
        workspaceId: s.ws.id,
        eventKey: 'workflow.finished',
        title: `Workflow ${i}`,
        body: '',
        link: `#/monitor/runs?ws=${s.ws.id}`,
        subjectKind: 'workflow',
        subjectId: `w${i}`,
        dedupeKey: `workflow:w${i}`,
        sourceKey: `test:${i}`,
      }),
    );
  await s.store.drainOutbox();
  const states = (await s.all(owner))
    .filter((n) => n.subject_kind === 'autopilot')
    .map((n) => [n.event_key, n.interrupt_state]);
  assert.deepEqual(states.sort(), [
    ['autopilot.failed', 'none'],
    ['autopilot.needs_you', 'none'],
  ]);
  const page1 = await s.inbox.notifications(owner);
  assert.equal(page1.items.length, 50);
  assert.ok(page1.next_cursor);
  const page2 = await s.inbox.notifications(owner, {
    cursor: page1.next_cursor,
  });
  assert.equal(page2.items.length, 7);
  assert.equal(page2.next_cursor, null);
  const ids = new Set([...page1.items, ...page2.items].map((n) => n.id));
  assert.equal(ids.size, 57);
  const runs = await s.inbox.notifications(owner, { group: 'runs' });
  assert.equal(runs.items.length, 50);
  assert.equal(
    (await s.inbox.notifications(owner, { group: 'spending' })).items.length,
    0,
  );
  const recent = await s.inbox.recentNotifications(owner);
  assert.equal(recent.unread, 57);
  assert.equal(recent.items.length, 20);
  // "Needs you" first in the bell.
  assert.equal(recent.items[0]!.event_key, 'autopilot.needs_you');
  const read = await s.inbox.readNotification(owner, recent.items[0]!.id);
  assert.ok(read.read_at);
  const gone = await s.inbox.dismissNotification(owner, recent.items[1]!.id);
  assert.ok(gone.dismissed_at && gone.read_at);
  assert.equal((await s.inbox.recentNotifications(owner)).unread, 55);
  assert.deepEqual(await s.inbox.readAllNotifications(owner), { read: 55 });
  assert.equal((await s.inbox.recentNotifications(owner)).unread, 0);
  assert.equal(
    (await s.inbox.notifications(owner, { unread: true })).items.length,
    0,
  );
  // Nobody else sees any of it.
  assert.deepEqual(await s.all(member), []);
});

test('N1: stale interruptions expire into the inbox; retention keeps 90 days or the newest 1,000', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const id = await s.autopilot(owner, 'tie');
  await s.finished(id, 2);
  await s.store.drainOutbox();
  await s.rows(
    `update notifications set first_at = first_at - interval '11 minutes', last_at = last_at - interval '200 days'`,
  );
  assert.deepEqual(await s.inbox.pendingNotifications(owner), []);
  const swept = await s.inbox.sweepNotifications();
  assert.deepEqual(swept, { expired: 1, removed: 0 });
  const [n] = await s.all(owner);
  assert.equal(n!.interrupt_state, 'expired');
  await conflict(s.inbox.claimNotification(owner, n!.id, { via: 'toast' }));
  // Over 1,000 rows, the oldest beyond 90 days go; their sources go with them.
  await s.rows(
    `insert into notifications (id, actor_id, workspace_id, event_key, severity, mode, title,
       link, subject_kind, subject_id, dedupe_key, interrupt_state)
     select gen_random_uuid(), $1, $2, 'workflow.finished', 'info', 'inbox', 'Old', '#/monitor/runs',
       'workflow', 'w', 'old:' || g, 'none' from generate_series(1, 1000) g`,
    [owner.actorId, s.ws.id],
  );
  assert.deepEqual(await s.inbox.sweepNotifications(), {
    expired: 0,
    removed: 1,
  });
  const [{ n: left }] = (await s.rows(
    'select count(*)::int as n from notifications',
  )) as [{ n: number }];
  assert.equal(left, 1000);
});

// ---- Spending (checks 8, 9, 12a) ---------------------------------------------------------

const pricingFile = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../config/pricing/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
// "hello" with 100 output tokens at the documented gpt-6-astra rates (see budget.test.ts).
const EXPOSURE = 101n * 12_500n + 100n * 50_000n;

async function realCalls(
  s: NonNullable<Awaited<ReturnType<typeof setup>>>,
  ctx: CommandContext,
) {
  const ws = await s.store.createWorkspace(ctx, {
    name: 'Real spending',
    record_mode: 'real',
  });
  const pricing = await s.store.createPricing(
    ctx,
    ws.id,
    pricingFile('openai-gpt-6-astra'),
  );
  const envelope = await s.store.createEnvelope(ctx, ws.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Large budget',
    cap_nano_usd: String(EXPOSURE * 1000n),
    starts_at: null,
    ends_at: null,
    max_in_flight: 32,
  });
  const runId = await s.run(ctx, ws.id);
  await s.store.createStandingGrant(ctx, ws.id, {
    run_id: runId,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: '100000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    rationale: 'Notification test calls.',
  });
  const request = (): BrokerCallRequest => ({
    envelope_id: envelope.id,
    action_type: 'model.generate',
    task_id: null,
    logical_operation_id: randomUUID(),
    pricing_snapshot_id: pricing.id,
    data_class: 'synthetic',
    input: [{ role: 'user', text: 'hello' }],
    max_output_tokens: 100,
    output_format: 'text',
    tool: null,
    max_attempts: 1,
    timeout_ms: 5000,
    justification: 'Notification test call.',
  });
  return {
    ws,
    runId,
    call: () =>
      s.store.prepareAttempt(ctx, ws.id, runId, request(), {
        provider: 'openai',
        model_id: 'gpt-6-astra',
        adapterAvailable: true,
        requestHash: 'a'.repeat(64),
        attempt: 1,
        timeoutMs: 5000,
      }),
  };
}

const spendRows = (items: Notification[]) =>
  items
    .filter((n) => n.group === 'spending')
    .map((n) => [n.event_key, n.interrupt_state])
    .sort();

test('N1 checks 8, 9 and 12a: spend warnings go to the spending manager only, the highest crossing interrupts, and refusals tell the starter no amounts', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // The owner made the first workspace, so they are the studio spending manager (ADR-0113).
  s.store.spending = {
    ...s.store.spending,
    ceiling_nano_usd: String(EXPOSURE * 10n),
    effective_from: new Date(Date.now() - 60_000).toISOString(),
  };
  const mine = await realCalls(s, owner);
  for (let i = 0; i < 4; i++)
    assert.equal((await mine.call()).kind, 'reserved');
  assert.deepEqual(spendRows(await s.all(owner)), []);
  await mine.call(); // 5 of 10: 50%, inbox only
  assert.deepEqual(spendRows(await s.all(owner)), [['spend.50', 'none']]);
  for (let i = 0; i < 3; i++) await mine.call(); // 8 of 10: 80% interrupts
  assert.deepEqual(spendRows(await s.all(owner)), [
    ['spend.50', 'none'],
    ['spend.80', 'pending'],
  ]);
  // A second person who owns another workspace is not the manager: no spend rows at all.
  const theirs = await realCalls(s, second);
  await theirs.call(); // 9 of 10
  await theirs.call(); // 10 of 10: 95% and 100% at once; only 100% interrupts
  const items = await s.all(owner);
  assert.deepEqual(spendRows(items), [
    ['spend.100', 'pending'],
    ['spend.50', 'none'],
    ['spend.80', 'pending'],
    ['spend.95', 'none'],
  ]);
  const top = items.find((n) => n.event_key === 'spend.100')!;
  assert.equal(top.workspace_id, null);
  assert.ok(!/stopped/i.test(top.title + top.body));
  // The ceiling refuses the second person's run: they hear it waits, with no amounts.
  assert.equal((await theirs.call()).kind, 'denied');
  await s.store.drainOutbox();
  const b = await s.all(second);
  assert.deepEqual(
    b.map((n) => [n.event_key, n.title, n.body]),
    [
      [
        'spend.waiting',
        'Your run is waiting on the spending limit',
        'The studio spending manager has been told.',
      ],
    ],
  );
  const refused = (await s.all(owner)).filter(
    (n) => n.event_key === 'spend.refused',
  );
  assert.equal(refused.length, 1);
  assert.match(refused[0]!.title, /^Work stopped: a paid dispatch was refused/);
  assert.match(refused[0]!.body, /nano-USD left/);
  // The same reason on the same run again counts, without a second alert.
  await theirs.call();
  const again = (await s.all(owner)).filter(
    (n) => n.event_key === 'spend.refused',
  );
  assert.equal(again[0]!.occurrences, 2);
  assert.equal((await s.all(second))[0]!.occurrences, 2);
  // The manager's own refused run is one alert, not a waiting notice as well.
  assert.equal((await mine.call()).kind, 'denied');
  const own = await s.all(owner);
  assert.equal(own.filter((n) => n.event_key === 'spend.refused').length, 2);
  assert.ok(!own.some((n) => n.event_key === 'spend.waiting'));
  // Check 9: a new ceiling version re-arms the thresholds against the new amount.
  await s.store.setRuntimeCeiling(owner, {
    expected_version: 0,
    ceiling_nano_usd: String(EXPOSURE * 20n),
    reason: 'Raised for a notification test.',
  });
  await mine.call(); // 11 of 20: 50% of the new version
  const v1 = (await s.all(owner)).filter((n) => n.subject_id === 'v1');
  assert.deepEqual(
    v1.map((n) => [n.event_key, n.interrupt_state]),
    [['spend.50', 'none']],
  );
});

test('N1 check 8: one reservation from $15 to $19.50 of $20 records 80% and 95%; only 95% interrupts', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const at = (usd: number) => ({
    ceiling_nano_usd: String(20n * 1_000_000_000n),
    exposure_nano_usd: String(BigInt(Math.round(usd * 100)) * 10_000_000n),
    version: 3,
  });
  assert.deepEqual(
    await s.store.hook((c) => notifySpendThresholds(c, at(15))),
    ['spend.50'],
  );
  assert.deepEqual(
    await s.store.hook((c) => notifySpendThresholds(c, at(19.5))),
    ['spend.80', 'spend.95'],
  );
  const rows = (await s.all(owner)).filter((n) => n.group === 'spending');
  const by = (k: string) => rows.find((n) => n.event_key === k)!;
  assert.equal(by('spend.80').interrupt_state, 'none');
  assert.equal(by('spend.80').body, '$19 of $20 spent or reserved (80%).');
  assert.equal(by('spend.95').interrupt_state, 'pending');
  assert.equal(
    by('spend.95').body,
    '$19 of $20 spent or reserved. New paid work may soon be refused.',
  );
  assert.ok(rows.every((n) => !/stopped/i.test(n.title + n.body)));
  // Within one ceiling version, falling below and rising again does not interrupt again.
  assert.deepEqual(
    await s.store.hook((c) => notifySpendThresholds(c, at(10))),
    [],
  );
  assert.deepEqual(
    await s.store.hook((c) => notifySpendThresholds(c, at(19.6))),
    [],
  );
});

test('N1: a web discovery that holds claims tells its starter; an autopilot’s own discovery does not', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // A done discovery with no claims sends nothing (and needs no rows to say so).
  await s.store.emit(owner, {
    workspaceId: s.ws.id,
    action: 'web_discovery.done',
    subjectKind: 'web_discovery',
    subjectId: randomUUID(),
    subjectVersion: 3,
  });
  const id = randomUUID();
  await s.store.emit(
    { ...owner, autopilot: { id } },
    {
      workspaceId: s.ws.id,
      action: 'web_discovery.done',
      subjectKind: 'web_discovery',
      subjectId: randomUUID(),
      subjectVersion: 3,
    },
  );
  await s.store.drainOutbox();
  assert.deepEqual(await s.all(owner), []);
});

test('N1: a background job failing for more than ten minutes is named once an hour', async (t) => {
  const now = Date.parse('2026-11-16T07:00:00.000Z');
  const jobs = {
    outbox: {
      last_success_at: '2026-11-16T06:55:00.000Z',
      last_failure_at: '2026-11-16T06:59:00.000Z',
      error_code: 'X',
    },
    notifications: {
      last_success_at: '2026-11-16T06:40:00.000Z',
      last_failure_at: '2026-11-16T06:59:00.000Z',
      error_code: 'STORAGE_UNAVAILABLE',
    },
    broker_recovery: {
      last_success_at: null,
      last_failure_at: '2026-11-16T06:59:00.000Z',
      error_code: 'Y',
    },
  };
  assert.deepEqual(failingJobs(jobs, now - 5 * 60_000, now), [
    { job: 'notifications', code: 'STORAGE_UNAVAILABLE' },
  ]);
  const s = await setup(t);
  if (!s) return;
  const at = new Date(now);
  await s.inbox.notifyMaintenance(owner.actorId, 'notifications', 'X', at);
  await s.inbox.notifyMaintenance(owner.actorId, 'notifications', 'X', at);
  const items = await s.all(owner);
  assert.deepEqual(
    items.map((n) => [n.event_key, n.link, n.occurrences]),
    [['studio.maintenance', '#/monitor/workers', 1]],
  );
});
