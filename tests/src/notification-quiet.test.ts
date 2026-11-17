import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferencesBody,
} from '@creator/contracts';
import {
  ConnectionStore,
  NotificationStore,
  notify,
  type CommandContext,
} from '@creator/db';
import { freshDatabase } from './pg-harness.js';

// ADR-0130 (N2): quiet hours hold interruptions, the digest re-checks what still needs the
// person once they end, and "Send test" makes one interrupting row for the person asking.

const owner: CommandContext = { actorId: randomUUID() };
const member: CommandContext = { actorId: randomUUID() };

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
      this.append(c, ctx, { contentHash: null, payload: {}, ...e }),
    );
  }
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

/** Quiet hours from an hour ago to an hour from now, every day, in UTC. */
function quietNow(): NotificationPreferencesBody {
  const now = Date.now();
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quiet_hours: {
      enabled: true,
      start: hhmm(new Date(now - 3_600_000)),
      end: hhmm(new Date(now + 3_600_000)),
      tz: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6],
      urgent_override: false,
    },
  };
}

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new Harness(db.pool, { lateWindowMs: 0 });
  const inbox = new NotificationStore(db.pool);
  for (const [ctx, name] of [
    [owner, 'Owner'],
    [member, 'Member'],
  ] as const)
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: name,
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Quiet',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, member.actorId, 'owner');
  const run = async () => {
    const r = await store.createEntity(owner, ws.id, {
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
      await store.registerRun(owner, ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      })
    ).run_id;
  };
  /** An autopilot of `owner` that stopped at version 2 needing a person, and its event. */
  const stopped = async () => {
    const id = randomUUID();
    await db.pool.query(
      `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
         policy_version, state, stage, outcome, explanation, steps, version, created_by, finished_at)
       values ($1,$2,$3,true,'{}',$4,array['Synthetic autopilot.'],'autopilot/1.0','finished',
         'select','needs_person','Two options are tied.',$5,2,$6,clock_timestamp())`,
      [
        id,
        ws.id,
        await run(),
        'a'.repeat(64),
        JSON.stringify([{ stop_kind: 'tie' }]),
        owner.actorId,
      ],
    );
    await store.emit(
      { ...owner, autopilot: { id } },
      {
        workspaceId: ws.id,
        action: 'autopilot.finished',
        subjectKind: 'autopilot',
        subjectId: id,
        subjectVersion: 2,
        payload: { outcome: 'needs_person' },
      },
    );
    return id;
  };
  const rows = (sql: string, args: unknown[] = []) =>
    db.pool.query(sql, args).then((r) => r.rows as Record<string, unknown>[]);
  return { db, store, inbox, ws, stopped, rows, run };
}

test('N2: quiet hours hold interruptions; the digest names only what still needs you, once', async (t) => {
  const s = await setup(t);
  if (!s) return;
  for (const ctx of [owner, member])
    await s.inbox.setNotificationPreferences(ctx, {
      expected_version: 0,
      body: quietNow(),
    });
  const still = await s.stopped();
  const continued = await s.stopped();
  // An approval asked by the member, already answered (no pending request) when quiet ends.
  await s.store.emit(member, {
    workspaceId: s.ws.id,
    action: 'decision.requested',
    subjectKind: 'decision',
    subjectId: randomUUID(),
    subjectVersion: 1,
    payload: { kind: 'approval', reason: 'Approve a synthetic step.' },
  });
  await s.store.drainOutbox();
  const held = await s.rows(
    `select actor_id, subject_kind, subject_id, interrupt_state from notifications order by first_at`,
  );
  assert.ok(held.length >= 3);
  assert.ok(
    held.every((r) => r.interrupt_state === 'held_quiet'),
    JSON.stringify(held),
  );
  // Nothing held can be shown as a toast or a Windows notification.
  assert.deepEqual(await s.inbox.pendingNotifications(owner), []);
  // The second autopilot is continued (running again at a later version).
  await s.db.pool.query(
    `update autopilots set state = 'running', outcome = null, finished_at = null, version = 3
      where id = $1`,
    [continued],
  );
  // The member leaves before quiet hours end: their item is withdrawn and never delivered.
  await s.store.removeMember(
    owner,
    s.ws.id,
    member.actorId,
    'Left the project.',
  );
  // While quiet hours last, nothing is released.
  assert.equal(await s.inbox.releaseQuietDigests(new Date()), 0);
  const after = new Date(Date.now() + 3 * 3_600_000);
  assert.equal(await s.inbox.releaseQuietDigests(after), 1);
  assert.equal(await s.inbox.releaseQuietDigests(after), 0); // once
  const owned = await s.rows(
    `select subject_kind, subject_id, interrupt_state, interrupted_via, title, link
       from notifications where actor_id = $1 order by first_at`,
    [owner.actorId],
  );
  const by = (id: string) => owned.find((r) => r.subject_id === id)!;
  assert.equal(by(still).interrupt_state, 'claimed');
  assert.equal(by(still).interrupted_via, 'digest');
  assert.equal(by(continued).interrupt_state, 'none');
  assert.equal(
    owned.find((r) => r.subject_kind === 'decision')!.interrupt_state,
    'none',
  );
  const digest = owned.find((r) => r.subject_kind === 'digest')!;
  assert.equal(digest.interrupt_state, 'pending');
  assert.match(String(digest.title), /1 item still needs you/);
  assert.equal(digest.link, '#/monitor/notifications?q=unread');
  // The digest interrupts once, like any other row.
  const [pending] = await s.inbox.pendingNotifications(owner);
  assert.equal(pending!.event_key, 'studio.digest');
  await s.inbox.claimNotification(owner, pending!.id, { via: 'toast' });
  await assert.rejects(
    s.inbox.claimNotification(owner, pending!.id, { via: 'windows' }),
    (e: unknown) => e instanceof ContractError && e.code === 'VERSION_CONFLICT',
  );
  const memberRows = await s.rows(
    `select withdrawn_at, interrupt_state, event_key from notifications where actor_id = $1`,
    [member.actorId],
  );
  assert.ok(memberRows.length >= 1);
  assert.ok(
    memberRows.every((r) => r.withdrawn_at && r.interrupt_state === 'none'),
  );
  assert.ok(memberRows.every((r) => r.event_key !== 'studio.digest'));
});

test('N2: the urgent override lets "needs you" through quiet hours; a mute holds nothing back for the digest', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const body = quietNow();
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: {
      ...body,
      quiet_hours: { ...body.quiet_hours, urgent_override: true },
    },
  });
  await s.stopped();
  await s.store.drainOutbox();
  const [n] = await s.inbox.pendingNotifications(owner);
  assert.equal(n?.event_key, 'autopilot.needs_you');
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 1,
    body: {
      ...body,
      quiet_hours: { ...body.quiet_hours, urgent_override: true },
      muted_workspaces: [s.ws.id],
    },
  });
  const muted = await s.stopped();
  await s.store.drainOutbox();
  const [m] = await s.rows(
    `select interrupt_state from notifications where actor_id = $1 and subject_id = $2`,
    [owner.actorId, muted],
  );
  assert.equal(m!.interrupt_state, 'none');
  assert.equal(
    await s.inbox.releaseQuietDigests(new Date(Date.now() + 3 * 3_600_000)),
    0,
  );
});

test('N2: "Send test" makes one interrupting row for the person asking, not one per click', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // Even with quiet hours on: the person asked for it.
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: quietNow(),
  });
  const a = await s.inbox.sendTestNotification(owner);
  const b = await s.inbox.sendTestNotification(owner);
  assert.equal(a.id, b.id);
  const [p] = await s.inbox.pendingNotifications(owner);
  assert.equal(p?.id, a.id);
  assert.equal(p?.event_key, 'studio.test');
  assert.equal(p?.link, '#/settings/notifications');
  assert.deepEqual(await s.inbox.pendingNotifications(member), []);
  await s.inbox.claimNotification(owner, a.id, { via: 'toast' });
  assert.equal((await s.inbox.recentNotifications(owner)).unread, 1);
});

test('N2 review M-1, L-1, L-2: the digest follows mutes and choices made since, says "need you" only of rows that do, and drops a run that got going again', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const body = quietNow();
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body,
  });
  const second = await s.store.createWorkspace(owner, {
    name: 'Muted later',
    record_mode: 'fixture',
  });
  const hook = (n: Parameters<typeof notify>[1]) =>
    s.db.pool.connect().then(async (c) => {
      try {
        await c.query('begin');
        const r = await notify(c, n);
        await c.query('commit');
        return r;
      } finally {
        c.release();
      }
    });
  const base = (ws: string, key: string) => ({
    actorId: owner.actorId,
    workspaceId: ws,
    title: `Held ${key}`,
    body: '',
    link: `#/monitor/runs?ws=${ws}`,
    dedupeKey: key,
    sourceKey: key,
  });
  // Held: a failed step in a workspace muted later; a failed step in a workspace kept;
  // a refused run that is still stopped; a refused run that got a paid dispatch since.
  await hook({
    ...base(second.id, 'a'),
    eventKey: 'autopilot.failed',
    subjectKind: 'workflow',
    subjectId: 'w1',
  });
  await hook({
    ...base(s.ws.id, 'b'),
    eventKey: 'autopilot.failed',
    subjectKind: 'workflow',
    subjectId: 'w2',
  });
  const stuck = await s.run();
  const moving = await s.run();
  await hook({
    ...base(s.ws.id, 'c'),
    eventKey: 'autopilot.limit',
    subjectKind: 'run',
    subjectId: stuck,
  });
  await hook({
    ...base(s.ws.id, 'd'),
    eventKey: 'autopilot.limit',
    subjectKind: 'run',
    subjectId: moving,
  });
  // Build ready is toast only: never held for the digest (L-1).
  const built = await hook({
    ...base(s.ws.id, 'e'),
    eventKey: 'build.ready',
    subjectKind: 'artifact',
    subjectId: 'a1',
  });
  const states = await s.rows(
    `select dedupe_key, interrupt_state from notifications where actor_id = $1 order by dedupe_key`,
    [owner.actorId],
  );
  assert.deepEqual(
    states.map((r) => r.interrupt_state),
    ['held_quiet', 'held_quiet', 'held_quiet', 'held_quiet', 'none'],
  );
  assert.ok(built);
  // A paid dispatch was admitted for "moving" after it was held (L-2).
  const envelope = randomUUID();
  await s.db.pool.query(
    `insert into budget_envelopes (id, workspace_id, fixture, kind, name, status, cap_nano,
       max_in_flight, created_by) values ($1,$2,true,'global','Walk budget','active',0,1,$3)`,
    [envelope, s.ws.id, owner.actorId],
  );
  await s.db.pool.query(
    `update notifications set last_at = last_at - interval '1 minute' where dedupe_key = 'd'`,
  );
  await s.db.pool.query(
    `insert into budget_reservations (id, workspace_id, fixture, envelope_id, run_id,
       logical_operation_id, attempt, request_hash, action_type, provider, model_id, status,
       reason_code, explanation, reserved_nano, created_by)
     values ($1,$2,true,$3,$4,$1,1,$5,'model.generate','fixture','fixture','in_flight','ok',
       'A paid dispatch after the refusal.',0,$6)`,
    [randomUUID(), s.ws.id, envelope, moving, 'b'.repeat(64), owner.actorId],
  );
  // After holding: mute the second workspace (M-1).
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 1,
    body: { ...body, muted_workspaces: [second.id] },
  });
  assert.equal(
    await s.inbox.releaseQuietDigests(new Date(Date.now() + 3 * 3_600_000)),
    1,
  );
  const after = await s.rows(
    `select dedupe_key, interrupt_state, interrupted_via, title, severity from notifications
      where actor_id = $1 order by dedupe_key`,
    [owner.actorId],
  );
  const by = (k: string) => after.find((r) => r.dedupe_key === k)!;
  assert.equal(by('a').interrupt_state, 'none'); // muted since
  assert.equal(by('b').interrupted_via, 'digest');
  assert.equal(by('c').interrupted_via, 'digest');
  assert.equal(by('d').interrupt_state, 'none'); // got going again
  const digest = after.find((r) => String(r.dedupe_key).startsWith('digest:'))!;
  // Only warnings left: "to look at", not "need you".
  assert.match(
    String(digest.title),
    /While quiet hours were on: \d items to look at$/,
  );
  assert.equal(digest.severity, 'warning');
});

test('N2 review M-1: an "Inbox only" choice made after a row was held keeps it out of the digest', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const body = quietNow();
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body,
  });
  await s.stopped();
  await s.store.drainOutbox();
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 1,
    body: { ...body, events: { 'autopilot.needs_you': 'inbox' } },
  });
  assert.equal(
    await s.inbox.releaseQuietDigests(new Date(Date.now() + 3 * 3_600_000)),
    0,
  );
  const [row] = await s.rows(
    `select interrupt_state from notifications where actor_id = $1`,
    [owner.actorId],
  );
  assert.equal(row!.interrupt_state, 'none');
});

test('N2 review L-5: the pending list is the newest rows, so a backlog never hides a new one', async (t) => {
  const s = await setup(t);
  if (!s) return;
  for (let i = 0; i < 55; i++)
    await s.db.pool.query(
      `insert into notifications (id, actor_id, workspace_id, event_key, severity, mode, title, link,
         subject_kind, subject_id, dedupe_key, interrupt_state, first_at, last_at)
       values ($1,$2,$3,'autopilot.failed','warning','interrupt',$4,$5,'workflow',$4,$4,'pending',
         clock_timestamp() - make_interval(secs => $6), clock_timestamp() - make_interval(secs => $6))`,
      [
        randomUUID(),
        owner.actorId,
        s.ws.id,
        `old${i}`,
        `#/monitor/runs?ws=${s.ws.id}`,
        120 + i,
      ],
    );
  const fresh = await s.inbox.sendTestNotification(owner);
  const pending = await s.inbox.pendingNotifications(owner);
  assert.equal(pending.length, 50);
  assert.equal(pending[0]!.id, fresh.id);
});

test('N2 review 2: an expired sign-in held in quiet hours is left out of the digest once signed in again', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: quietNow(),
  });
  const connection = async (label: string) => {
    const id = randomUUID();
    await s.db.pool.query(
      `insert into plan_connections (id, workspace_id, fixture, version, label, settings,
         settings_hash, ext_agent_host_id, sign_in, credits, eligibility, quota, created_by)
       values ($1,$2,true,1,$3,'{}',$4,$5,'{"state":"expired"}','{}','{}','{}',$6)`,
      [
        id,
        s.ws.id,
        label,
        'c'.repeat(64),
        `urn:uuid:${randomUUID()}`,
        owner.actorId,
      ],
    );
    return id;
  };
  const back = await connection('Signed in again');
  const still = await connection('Still expired');
  const day = new Date().toISOString().slice(0, 10);
  for (const id of [back, still]) {
    const c = await s.db.pool.connect();
    try {
      await c.query('begin');
      await notify(c, {
        actorId: owner.actorId,
        workspaceId: s.ws.id,
        eventKey: 'connection.blocked',
        title: 'Connection stopped work: its sign-in expired',
        body: '',
        link: `#/connections/models?ws=${s.ws.id}`,
        subjectKind: 'plan_connection',
        subjectId: id,
        dedupeKey: `conn:${id}:sign_in:${day}`,
        sourceKey: `planreq:${randomUUID()}:sign_in`,
      });
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  assert.deepEqual(
    (
      await s.rows(
        `select interrupt_state from notifications where actor_id = $1`,
        [owner.actorId],
      )
    ).map((r) => r.interrupt_state),
    ['held_quiet', 'held_quiet'],
  );
  await s.db.pool.query(
    `update plan_connections set sign_in = '{"state":"signed_in"}' where id = $1`,
    [back],
  );
  assert.equal(
    await s.inbox.releaseQuietDigests(new Date(Date.now() + 3 * 3_600_000)),
    1,
  );
  const after = await s.rows(
    `select subject_id, interrupt_state, interrupted_via, title from notifications
      where actor_id = $1`,
    [owner.actorId],
  );
  const of = (id: string) => after.find((r) => r.subject_id === id)!;
  assert.equal(of(back).interrupt_state, 'none');
  assert.equal(of(still).interrupted_via, 'digest');
  const digest = after.find(
    (r) => r.subject_id !== back && r.subject_id !== still,
  )!;
  assert.match(String(digest.title), /While quiet hours were on: 1 item/);
});
