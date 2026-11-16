import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ContractError,
  NOTIFICATION_EVENTS,
  NOTIFICATION_LINK_PATTERN,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesBodySchema,
  notificationMode,
  type AutopilotStopKind,
  type NotificationEventKey,
  type NotificationPreferencesBody,
} from '@creator/contracts';
import { spendingManagerId } from './spending-manager.js';

// ADR-0116 (N1): the producers of notifications. Two ways in, both idempotent:
//  (a) `consumeNotifications`, an outbox consumer, claims each audit event in `consumer_inbox`
//      first; a redelivered event does nothing at all;
//  (b) `notify`, called inside the transaction of a source with no audit event (spend
//      thresholds and refusals, recipe qualifications, queue ends, connection refusals). Its
//      `source_key` makes a repeated hook a no-op.
// No notification writes an audit event (high volume and personal, as notes in ADR-0060), and
// none calls a model, approves, continues or spends anything.

type Row = Record<string, unknown>;

export const NOTIFICATIONS_CONSUMER = 'notifications';

export interface NotifyInput {
  actorId: string;
  workspaceId: string | null;
  eventKey: NotificationEventKey;
  title: string;
  body: string;
  link: string;
  subjectKind: string;
  subjectId: string;
  /** One row per person and key: a different source with the same key raises `occurrences`. */
  dedupeKey: string;
  /** Why this row exists: an audit event id or a hook's stable key. Repeats are no-ops. */
  sourceKey: string;
  /** A queue's id: such a row is listed with its batch and never interrupts on its own. */
  batchId?: string | null;
  /** False keeps the row in the inbox only (for example a lower spend threshold). */
  interrupt?: boolean;
}

export type NotifyResult = { id: string; created: boolean } | null;

const cut = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

/** The person's saved preferences, else the defaults. */
export async function notificationPreferencesIn(
  c: PoolClient,
  actorId: string,
): Promise<{
  version: number;
  body: NotificationPreferencesBody;
  at: unknown;
}> {
  const { rows } = await c.query(
    'select version, body, updated_at from notification_preferences where actor_id = $1',
    [actorId],
  );
  const r = rows[0] as Row | undefined;
  if (!r)
    return { version: 0, body: DEFAULT_NOTIFICATION_PREFERENCES, at: null };
  const parsed = NotificationPreferencesBodySchema.safeParse(r.body);
  return {
    version: Number(r.version),
    body: parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFERENCES,
    at: r.updated_at,
  };
}

/**
 * Records one notification for one person, in the caller's transaction. Returns null when this
 * source was already recorded for the person (a replay or a repeated hook): nothing changes.
 */
export async function notify(
  c: PoolClient,
  n: NotifyInput,
): Promise<NotifyResult> {
  if (!NOTIFICATION_LINK_PATTERN.test(n.link))
    throw new ContractError(
      'INVALID_CONTRACT',
      'A notification links only to a place in the studio.',
    );
  // One holder per person and source, so two transactions repeating a hook cannot both count.
  await c.query('select pg_advisory_xact_lock($1, hashtext($2))', [
    4_310_116,
    `${n.actorId}|${n.sourceKey}`,
  ]);
  const seen = await c.query(
    'select 1 from notification_sources where actor_id = $1 and source_key = $2',
    [n.actorId, n.sourceKey],
  );
  if (seen.rowCount) return null;
  const prefs = await notificationPreferencesIn(c, n.actorId);
  const mode = notificationMode(prefs.body, n.eventKey);
  const muted =
    n.workspaceId !== null &&
    prefs.body.muted_workspaces.includes(n.workspaceId);
  const interrupts =
    mode !== 'inbox' && !n.batchId && n.interrupt !== false && !muted;
  const info = NOTIFICATION_EVENTS[n.eventKey];
  const { rows } = await c.query<{ id: string; created: boolean }>(
    `insert into notifications (id, actor_id, workspace_id, event_key, severity, mode, title,
       body, link, subject_kind, subject_id, dedupe_key, interrupt_state, batch_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (actor_id, dedupe_key) do update
       set occurrences = notifications.occurrences + 1, last_at = clock_timestamp()
     returning id, (xmax = 0) as created`,
    [
      randomUUID(),
      n.actorId,
      n.workspaceId,
      n.eventKey,
      info.severity,
      mode,
      cut(n.title, 140),
      cut(n.body, 400),
      n.link,
      n.subjectKind,
      n.subjectId,
      cut(n.dedupeKey, 200),
      interrupts ? 'pending' : 'none',
      n.batchId ?? null,
    ],
  );
  const row = rows[0]!;
  await c.query(
    `insert into notification_sources (notification_id, source_key, actor_id)
     values ($1, $2, $3)`,
    [row.id, n.sourceKey, n.actorId],
  );
  return { id: String(row.id), created: row.created === true };
}

// ---- Recipients ------------------------------------------------------------------------

/** Workspace owners who may act on policy (`isPolicyOwner`: a person, not a tester). */
async function policyOwners(c: PoolClient, ws: string): Promise<string[]> {
  const { rows } = await c.query<{ actor_id: string }>(
    `select m.actor_id from workspace_members m join actors a on a.id = m.actor_id
      where m.workspace_id = $1 and m.role = 'owner' and a.kind = 'human'
        and not exists (select 1 from tester_accounts t where t.actor_id = m.actor_id)
      order by m.actor_id`,
    [ws],
  );
  return rows.map((r) => String(r.actor_id));
}

/** A person who still belongs to the workspace (an agent or system actor never receives). */
async function memberPerson(
  c: PoolClient,
  ws: string,
  actorId: unknown,
): Promise<string | null> {
  if (typeof actorId !== 'string' || !actorId) return null;
  const { rows } = await c.query(
    `select 1 from workspace_members m join actors a on a.id = m.actor_id
      where m.workspace_id = $1 and m.actor_id = $2 and a.kind = 'human'`,
    [ws, actorId],
  );
  return rows.length ? actorId : null;
}

const link = (page: string, params: Record<string, string | null>) => {
  const q = Object.entries(params)
    .filter((e): e is [string, string] => !!e[1])
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return q ? `${page}?${q}` : page;
};

// ---- The outbox consumer ---------------------------------------------------------------

const LIMIT_STOPS: readonly AutopilotStopKind[] = [
  'run_cap',
  'daily_cap',
  'usage_limit',
  'call_limit',
  'end_time',
  'connection',
];

/** The stop in the autopilot page's own words, after "Autopilot stopped: ". */
export const AUTOPILOT_STOP_PHRASE: Record<AutopilotStopKind, string> = {
  thin_evidence: 'the evidence is too thin',
  unknown_ratings: 'ratings need your judgment',
  tie: 'a tie needs your choice',
  close_ranking: 'a close ranking needs your choice',
  not_advanceable: 'no option can advance',
  gate_blocked: 'a gate needs you',
  opportunity: 'the opportunity needs your judgment',
  model_ethics: 'an ethics check needs you',
  failed_step: 'a step failed',
  claims_held: 'web claims are held for you',
  person_choice: 'needs your choice',
  approval: 'needs an approval',
  paused: 'paused',
  run_cap: "the connection's per-run cap was reached",
  daily_cap: "the connection's daily cap was reached",
  usage_limit: "the plan's usage limit was reached",
  connection: 'the connection refused',
  call_limit: "the autopilot's call limit was reached",
  end_time: 'its end time passed',
  spec: 'the software spec needs you',
  other: 'needs you',
};

/** Which event an autopilot's end is, from its outcome and its last step's stop kind. */
export function autopilotEventKey(
  outcome: string,
  stop: AutopilotStopKind,
): NotificationEventKey {
  if (outcome === 'proposal') return 'autopilot.proposal';
  if (outcome === 'cancelled') return 'autopilot.cancelled';
  if (outcome === 'failed' || stop === 'failed_step') return 'autopilot.failed';
  if (outcome === 'limit_reached' || LIMIT_STOPS.includes(stop))
    return 'autopilot.limit';
  if (stop === 'claims_held') return 'claims.held';
  return 'autopilot.needs_you';
}

async function onAutopilotFinished(c: PoolClient, e: Row) {
  const ws = String(e.workspace_id);
  const id = String(e.subject_id);
  const version = Number(e.subject_version);
  const { rows } = await c.query(
    'select created_by, steps, explanation, outcome from autopilots where workspace_id = $1 and id = $2',
    [ws, id],
  );
  const a = rows[0] as Row | undefined;
  if (!a) return;
  const payload = (e.payload ?? {}) as Row;
  const outcome = String(payload.outcome ?? a.outcome ?? '');
  const steps = Array.isArray(a.steps) ? (a.steps as Row[]) : [];
  const stop = (steps.at(-1)?.stop_kind ?? 'other') as AutopilotStopKind;
  const key = autopilotEventKey(outcome, stop);
  const starter = await memberPerson(c, ws, a.created_by);
  const to = link('#/autopilot/run', { ws, id });
  const dedupe = `autopilot:${id}:v${version}`;
  const explanation = String(a.explanation ?? '');
  const base = {
    workspaceId: ws,
    link: to,
    subjectKind: 'autopilot',
    subjectId: id,
    dedupeKey: dedupe,
    sourceKey: String(e.id),
  };
  // "Stopped again": an earlier stop of the same autopilot was already sent to this person.
  const again = async (actorId: string) =>
    (
      await c.query(
        `select 1 from notifications where actor_id = $1 and subject_kind = 'autopilot'
            and subject_id = $2 and dedupe_key <> $3 limit 1`,
        [actorId, id, dedupe],
      )
    ).rowCount
      ? 'Autopilot stopped again'
      : 'Autopilot stopped';
  if (key === 'autopilot.cancelled') {
    // Never a person's own action: only a cancel by another person is news to the starter
    // (a stop the runner records itself is not "someone else").
    const by = String(e.actor_id);
    const person = (
      await c.query(`select 1 from actors where id = $1 and kind = 'human'`, [
        by,
      ])
    ).rowCount;
    if (starter && person && by !== starter)
      await notify(c, {
        ...base,
        actorId: starter,
        eventKey: key,
        title: 'Your autopilot was cancelled by someone else',
        body: explanation,
      });
    return;
  }
  if (key === 'autopilot.proposal') {
    if (starter)
      await notify(c, {
        ...base,
        actorId: starter,
        eventKey: key,
        title: 'Autopilot finished: a proposal is ready',
        body: explanation,
      });
    return;
  }
  if (key === 'autopilot.limit' || key === 'autopilot.failed') {
    if (starter)
      await notify(c, {
        ...base,
        actorId: starter,
        eventKey: key,
        title: `${await again(starter)}: ${AUTOPILOT_STOP_PHRASE[stop]}`,
        body: explanation,
      });
    return;
  }
  // Blocked: whoever can resolve it (a workspace owner) gets the actionable alert; a starter
  // who cannot is told the run waits. One alert when they are the same person.
  const owners = await policyOwners(c, ws);
  for (const owner of owners)
    await notify(c, {
      ...base,
      actorId: owner,
      eventKey: key,
      title: `${await again(owner)}: ${AUTOPILOT_STOP_PHRASE[stop]}`,
      body: explanation,
    });
  if (starter && !owners.includes(starter))
    await notify(c, {
      ...base,
      actorId: starter,
      eventKey: 'autopilot.waiting',
      title: 'Your autopilot is waiting for the workspace owner',
      body: `It stopped because ${AUTOPILOT_STOP_PHRASE[stop]}. The workspace owner has been told.`,
    });
}

async function onDecisionRequested(c: PoolClient, e: Row) {
  const ws = String(e.workspace_id);
  const id = String(e.subject_id);
  const payload = (e.payload ?? {}) as Row;
  const kind = String(payload.kind ?? 'approval').replaceAll('_', ' ');
  for (const owner of await policyOwners(c, ws)) {
    if (owner === String(e.actor_id)) continue; // never your own request
    await notify(c, {
      actorId: owner,
      workspaceId: ws,
      eventKey: 'approval.asked',
      title: `Approval waiting: ${kind}`,
      body: String(payload.reason ?? ''),
      link: link('#/monitor/approvals', { ws, id }),
      subjectKind: 'decision',
      subjectId: id,
      dedupeKey: `decision:${id}:v${Number(e.subject_version ?? 1)}`,
      sourceKey: String(e.id),
    });
  }
}

const words = (s: string) => s.replaceAll('_', ' ');

async function onPlanQualificationDecided(c: PoolClient, e: Row) {
  const ws = String(e.workspace_id);
  const id = String(e.subject_id);
  const { rows } = await c.query(
    `select q.created_by, q.connection_id, q.task_class, q.model_id, q.state,
            (select i.queue_id from plan_qualification_queue_items i
              where i.qualification_id = q.id order by i.queue_id limit 1) as queue_id
       from plan_qualifications q where q.id = $1`,
    [id],
  );
  const q = rows[0] as Row | undefined;
  if (!q) return;
  const to = await memberPerson(c, ws, q.created_by);
  if (!to) return;
  const passed = ((e.payload ?? {}) as Row).qualified === true;
  const what = `${words(String(q.task_class))} on ${String(q.model_id)}`;
  await notify(c, {
    actorId: to,
    workspaceId: ws,
    eventKey: passed ? 'qualification.passed' : 'qualification.failures',
    title: passed ? `Qualified: ${what}` : `Qualification failed: ${what}`,
    body: '',
    link: link('#/connections/models', { ws, id: String(q.connection_id) }),
    subjectKind: 'plan_qualification',
    subjectId: id,
    dedupeKey: `qual:${id}`,
    sourceKey: String(e.id),
    // An attempt in a queue never interrupts on its own; the queue's summary does.
    batchId: q.queue_id ? String(q.queue_id) : null,
  });
}

async function onWorkflowFinished(c: PoolClient, e: Row) {
  const ws = String(e.workspace_id);
  const id = String(e.subject_id);
  const { rows } = await c.query(
    `select r.created_by from workflows w
       join run_controls r on r.workspace_id = w.workspace_id and r.run_id = w.run_id
      where w.workspace_id = $1 and w.id = $2`,
    [ws, id],
  );
  const to = await memberPerson(c, ws, rows[0]?.created_by);
  if (!to) return;
  const outcome = ((e.payload ?? {}) as Row).outcome;
  await notify(c, {
    actorId: to,
    workspaceId: ws,
    eventKey: 'workflow.finished',
    title: `Workflow finished${typeof outcome === 'string' ? `: ${words(outcome)}` : ''}`,
    body: '',
    link: link('#/monitor/runs', { ws, id }),
    subjectKind: 'workflow',
    subjectId: id,
    dedupeKey: `workflow:${id}`,
    sourceKey: String(e.id),
  });
}

async function onArtifactRegistered(c: PoolClient, e: Row) {
  const ws = String(e.workspace_id);
  const to = await memberPerson(c, ws, e.actor_id);
  if (!to) return;
  const payload = (e.payload ?? {}) as Row;
  const artifact =
    typeof payload.artifact_id === 'string'
      ? payload.artifact_id
      : String(e.subject_id);
  await notify(c, {
    actorId: to,
    workspaceId: ws,
    eventKey: 'build.ready',
    title: 'Build finished: ready to try',
    body: '',
    link: link('#/projects/try', { ws, id: artifact }),
    subjectKind: 'artifact',
    subjectId: artifact,
    dedupeKey: `artifact:${artifact}`,
    sourceKey: String(e.id),
  });
}

async function onWebDiscoveryDone(c: PoolClient, e: Row) {
  // An autopilot's own discovery is reported by the autopilot's stop (claims_held).
  if (((e.payload ?? {}) as Row).autopilot) return;
  const ws = String(e.workspace_id);
  const id = String(e.subject_id);
  const { rows } = await c.query(
    `select d.created_by, (select count(*)::int from web_discovery_claims k
        where k.discovery_id = d.id and k.decision = 'pending') as held
       from web_discoveries d where d.workspace_id = $1 and d.id = $2`,
    [ws, id],
  );
  const d = rows[0] as Row | undefined;
  const held = Number(d?.held ?? 0);
  if (!d || held === 0) return;
  const to = await memberPerson(c, ws, d.created_by);
  if (!to) return;
  await notify(c, {
    actorId: to,
    workspaceId: ws,
    eventKey: 'claims.held',
    title: `${held} web claim${held === 1 ? ' is' : 's are'} held for you`,
    body: 'Claims checked only by their quotes wait for your decision before they are used.',
    link: link('#/projects/discover', { ws, id }),
    subjectKind: 'web_discovery',
    subjectId: id,
    dedupeKey: `claims:${id}`,
    sourceKey: String(e.id),
  });
}

const CONSUMED = new Set([
  'autopilot.finished',
  'decision.requested',
  'connection.qualification_decided',
  'workflow.finished',
  'artifact.registered',
  'web_discovery.done',
  'connection.qualification_queue_done',
  'connection.qualification_queue_stopped',
]);

/**
 * The notifications outbox consumer, run for every event a drain or `deliver` projects. It
 * claims the event first: if the claim exists (a replay, a second drain, `deliver` again), it
 * does nothing at all: no update, no occurrence change, no claim reset.
 */
export async function consumeNotifications(c: PoolClient, e: Row) {
  if (!CONSUMED.has(String(e.action)) || !e.workspace_id) return;
  const claim = await c.query(
    'insert into consumer_inbox (consumer, event_id) values ($1, $2) on conflict do nothing',
    [NOTIFICATIONS_CONSUMER, e.id],
  );
  if (!claim.rowCount) return;
  switch (e.action) {
    case 'autopilot.finished':
      return onAutopilotFinished(c, e);
    case 'decision.requested':
      return onDecisionRequested(c, e);
    case 'connection.qualification_decided':
      return onPlanQualificationDecided(c, e);
    case 'workflow.finished':
      return onWorkflowFinished(c, e);
    case 'artifact.registered':
      return onArtifactRegistered(c, e);
    case 'web_discovery.done':
      return onWebDiscoveryDone(c, e);
    case 'connection.qualification_queue_done':
    case 'connection.qualification_queue_stopped': {
      const { rows } = await c.query(
        'select id, created_by from plan_qualification_queues where id = $1',
        [e.subject_id],
      );
      const q = rows[0] as Row | undefined;
      if (q)
        await notifyQueueEnd(
          c,
          {
            id: String(q.id),
            workspace_id: String(e.workspace_id),
            created_by: String(q.created_by),
          },
          e.action === 'connection.qualification_queue_done'
            ? 'done'
            : 'stopped',
        );
      return;
    }
  }
}

// ---- Hooks for sources with no audit event --------------------------------------------

const NANO_PER_USD = 1_000_000_000n;
/** Whole dollars, rounded down ("$19" for $19.50), as the plan's wording reads. */
export function dollarsDown(nano: bigint): string {
  return `$${(nano < 0n ? 0n : nano) / NANO_PER_USD}`;
}
/** The ceiling as configured: whole dollars, or dollars and cents. */
export function dollarsExact(nano: bigint): string {
  const cents = nano / 10_000_000n;
  return cents % 100n === 0n
    ? `$${cents / 100n}`
    : `$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export const SPEND_THRESHOLDS = [50, 80, 95, 100] as const;

/**
 * Spend warnings (§5): every threshold of the current ceiling version that exposure (settled
 * cost plus held reservations) has reached gets one inbox row for the spending manager, once
 * per ceiling version. Of the rows this call creates, only the highest interrupts, and 50%
 * never does. A new ceiling version re-arms them all. These are warnings; "work stopped" is
 * said only by a refusal.
 */
export async function notifySpendThresholds(
  c: PoolClient,
  e: { ceiling_nano_usd: string; exposure_nano_usd: string; version: number },
): Promise<NotificationEventKey[]> {
  const ceiling = BigInt(e.ceiling_nano_usd);
  const exposure = BigInt(e.exposure_nano_usd);
  if (ceiling <= 0n) return [];
  const manager = await spendingManagerId(c);
  if (!manager) return [];
  const reached = SPEND_THRESHOLDS.filter(
    (n) => exposure * 100n >= ceiling * BigInt(n),
  );
  const fresh: number[] = [];
  for (const n of reached) {
    const seen = await c.query(
      'select 1 from notification_sources where actor_id = $1 and source_key = $2',
      [manager, `spend:${e.version}:${n}`],
    );
    if (!seen.rowCount) fresh.push(n);
  }
  const top = Math.max(...fresh);
  const made: NotificationEventKey[] = [];
  const of = `${dollarsDown(exposure)} of ${dollarsExact(ceiling)} spent or reserved`;
  for (const n of fresh) {
    const key = `spend.${n}` as NotificationEventKey;
    const body =
      n === 100
        ? `${of}. New paid work will be refused until spending settles or the ceiling is raised.`
        : n === 95
          ? `${of}. New paid work may soon be refused.`
          : `${of} (${n}%).`;
    const out = await notify(c, {
      actorId: manager,
      workspaceId: null,
      eventKey: key,
      title: `Spending at ${n}% of the studio ceiling`,
      body,
      link: '#/settings/general',
      subjectKind: 'runtime_ceiling',
      subjectId: `v${e.version}`,
      dedupeKey: `spend:${e.version}:${n}`,
      sourceKey: `spend:${e.version}:${n}`,
      interrupt: n === top && n !== 50,
    });
    if (out?.created) made.push(key);
  }
  return made;
}

/**
 * A ceiling or limit refused a paid dispatch (ADR-0113's refusal record). The spending manager
 * gets the actionable alert with the details; the run's starter, when someone else, is told
 * only that the run waits, with no amounts. One alert when they are the same person.
 */
export async function notifySpendRefusal(
  c: PoolClient,
  r: {
    refusalId: string;
    ws: string;
    runId: string;
    reasonCode: string;
    explanation: string;
  },
) {
  const manager = await spendingManagerId(c);
  const { rows } = await c.query(
    'select created_by from run_controls where workspace_id = $1 and run_id = $2',
    [r.ws, r.runId],
  );
  const starter = await memberPerson(c, r.ws, rows[0]?.created_by);
  const why = words(r.reasonCode.replace(/^runtime_/, ''));
  if (manager)
    await notify(c, {
      actorId: manager,
      workspaceId: null,
      eventKey: 'spend.refused',
      title: `Work stopped: a paid dispatch was refused (${why})`,
      body: r.explanation,
      link: '#/settings/general',
      subjectKind: 'run',
      subjectId: r.runId,
      dedupeKey: `refused:${r.runId}:${r.reasonCode}`,
      sourceKey: `refusal:${r.refusalId}`,
    });
  if (starter && starter !== manager)
    await notify(c, {
      actorId: starter,
      workspaceId: r.ws,
      eventKey: 'spend.waiting',
      title: 'Your run is waiting on the spending limit',
      body: 'The studio spending manager has been told.',
      link: link('#/monitor/runs', { ws: r.ws, id: r.runId }),
      subjectKind: 'run',
      subjectId: r.runId,
      dedupeKey: `waiting:${r.runId}:${r.reasonCode}`,
      sourceKey: `refusal:${r.refusalId}`,
    });
}

/** A build (recipe) qualification ended by the runner: passed, failed or could not finish. */
export async function notifyRecipeQualification(c: PoolClient, id: string) {
  const { rows } = await c.query(
    `select workspace_id, connection_id, benchmark_id, model_id, state, created_by
       from recipe_qualifications where id = $1`,
    [id],
  );
  const q = rows[0] as Row | undefined;
  if (!q || q.state === 'running') return;
  const ws = String(q.workspace_id);
  const to = await memberPerson(c, ws, q.created_by);
  if (!to) return;
  const passed = q.state === 'qualified';
  const what = `building (${String(q.benchmark_id)}) on ${String(q.model_id)}`;
  await notify(c, {
    actorId: to,
    workspaceId: ws,
    eventKey: passed ? 'qualification.passed' : 'qualification.failures',
    title: passed ? `Qualified: ${what}` : `Qualification failed: ${what}`,
    body:
      q.state === 'stopped'
        ? 'It stopped before a verdict; the reason is on the qualification.'
        : '',
    link: link('#/connections/models', { ws, id: String(q.connection_id) }),
    subjectKind: 'recipe_qualification',
    subjectId: id,
    dedupeKey: `recipe:${id}`,
    sourceKey: `recipe:${id}:finished`,
  });
}

/**
 * A qualification queue ended. Failures send one summary ("2 of 5 qualifications failed"); a
 * queue that finished cleanly goes to the inbox. A cancelled queue was the person's own action,
 * so it sends nothing (its audit action is not consumed).
 */
async function notifyQueueEnd(
  c: PoolClient,
  q: { id: string; workspace_id: string; created_by: string },
  state: 'done' | 'stopped',
) {
  const to = await memberPerson(c, q.workspace_id, q.created_by);
  if (!to) return;
  const { rows } = await c.query<{ state: string }>(
    'select state from plan_qualification_queue_items where queue_id = $1',
    [q.id],
  );
  const total = rows.length;
  const failed = rows.filter((r) => r.state === 'failed').length;
  const stopped = rows.filter((r) => r.state === 'stopped').length;
  const qualified = rows.filter((r) => r.state === 'qualified').length;
  const base = {
    actorId: to,
    workspaceId: q.workspace_id,
    link: link('#/connections/models', { ws: q.workspace_id }),
    subjectKind: 'qualification_queue',
    subjectId: q.id,
    sourceKey: `queue:${q.id}:end`,
  };
  if (failed + stopped > 0)
    await notify(c, {
      ...base,
      eventKey: 'qualification.failures',
      title: stopped
        ? `${failed + stopped} of ${total} qualifications failed or did not finish`
        : `${failed} of ${total} qualifications failed`,
      body: `${qualified} qualified.`,
      dedupeKey: `qualfail:${q.id}`,
    });
  else if (state === 'done')
    await notify(c, {
      ...base,
      eventKey: 'qualification.queue_done',
      title: `Qualification queue completed: ${qualified} of ${total} qualified`,
      body: '',
      dedupeKey: `queue:${q.id}`,
    });
}

/**
 * A plan connection refused a request for its own reason (the plan's usage limit, or its
 * sign-in expired). Whoever can restore it (the workspace's owners) is told once a day per kind.
 */
export async function notifyConnectionBlocked(
  c: PoolClient,
  r: {
    connectionId: string;
    ws: string;
    requestId: string;
    kind: 'usage_limit' | 'sign_in';
  },
) {
  const day = new Date().toISOString().slice(0, 10);
  for (const owner of await policyOwners(c, r.ws))
    await notify(c, {
      actorId: owner,
      workspaceId: r.ws,
      eventKey: 'connection.blocked',
      title:
        r.kind === 'sign_in'
          ? 'Connection stopped work: its sign-in expired'
          : "Connection stopped work: the plan's usage limit was reached",
      body:
        r.kind === 'sign_in'
          ? 'Sign in again in Models to continue.'
          : 'Requests on this connection are refused until the limit resets.',
      link: link('#/connections/models', { ws: r.ws, id: r.connectionId }),
      subjectKind: 'plan_connection',
      subjectId: r.connectionId,
      dedupeKey: `conn:${r.connectionId}:${r.kind}:${day}`,
      sourceKey: `planreq:${r.requestId}:${r.kind}`,
    });
}

/** A background job has been failing for more than ten minutes (Advanced view only). */
export async function notifyMaintenanceFailing(
  c: PoolClient,
  r: { actorId: string; job: string; code: string; hour: string },
) {
  await notify(c, {
    actorId: r.actorId,
    workspaceId: null,
    eventKey: 'studio.maintenance',
    title: `Background job failing: ${words(r.job)}`,
    body: `It has failed for more than ten minutes (${r.code}). It is retried by itself.`,
    link: '#/monitor/workers',
    subjectKind: 'maintenance',
    subjectId: r.job,
    dedupeKey: `maint:${r.job}:${r.hour}`,
    sourceKey: `maint:${r.job}:${r.hour}`,
  });
}
