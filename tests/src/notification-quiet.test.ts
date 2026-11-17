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
  return { db, store, inbox, ws, stopped, rows };
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
