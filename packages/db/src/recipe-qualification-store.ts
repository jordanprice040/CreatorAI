import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  RecipeAttemptResultSchema,
  type RecipeAttempt,
  type RecipeAttemptResult,
  type RecipeQualificationRecord,
} from '@creator/contracts';
import { fail, iso, uuid, type Row } from './store.js';

// ADR-0105 (B1): build (recipe) qualification records. The rows and the attempt rules live
// here; ConnectionStore wraps them with its owner, connection and admission checks.

/** What the next step of a running qualification is, decided under its row lock. */
export type NextRecipeAttempt =
  | {
      kind: 'attempt';
      attempt_id: string;
      slot: number;
      replaces: string | null;
    }
  /** The connection can't take an attempt's requests yet (another request is running). */
  | { kind: 'wait'; reason: string }
  | { kind: 'end' };

/**
 * Review 1 M-1: whether the connection can take an attempt's requests now, checked before an
 * attempt or a replacement is created, so a refusal at admission does not spend one. `stop`
 * needs the owner (an earlier request with an unknown outcome, the daily cap); `wait` passes by
 * itself (another request running now).
 */
export type RecipeRoom =
  | { kind: 'ok' }
  | { kind: 'wait'; reason: string }
  | { kind: 'stop'; reason: string };

/** How long a waiting qualification waits before the runner looks again. */
const RECIPE_WAIT_MS = 15_000;

const nullableIso = (v: unknown) => (v == null ? null : iso(v));

export function toAttempt(r: Row, requests: number): RecipeAttempt {
  return {
    id: String(r.id),
    slot: Number(r.slot),
    replaces: r.replaces == null ? null : String(r.replaces),
    state: r.state as RecipeAttempt['state'],
    reason: r.reason == null ? null : String(r.reason),
    product_id: r.product_id == null ? null : String(r.product_id),
    build_id: r.build_id == null ? null : String(r.build_id),
    request_limit: Number(r.request_limit),
    requests,
    repairs: r.repairs == null ? null : Number(r.repairs),
    result: r.result == null ? null : RecipeAttemptResultSchema.parse(r.result),
    started_at: iso(r.started_at),
    finished_at: nullableIso(r.finished_at),
  };
}

export function toRecipeQualification(
  r: Row,
  attempts: RecipeAttempt[],
): RecipeQualificationRecord {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    connection_id: String(r.connection_id),
    recipe: r.recipe as RecipeQualificationRecord['recipe'],
    benchmark_id: String(r.benchmark_id),
    model_id: String(r.model_id),
    builder_prompt_sha256: String(r.builder_prompt_sha256),
    reviewer_prompt_sha256: String(r.reviewer_prompt_sha256),
    freeze_sha256: String(r.freeze_sha256),
    max_input_chars:
      r.max_input_chars == null ? null : Number(r.max_input_chars),
    source: r.source as RecipeQualificationRecord['source'],
    fixture: Boolean(r.fixture),
    state: r.state as RecipeQualificationRecord['state'],
    attempts_needed: Number(r.attempts_needed),
    passed: Number(r.passed),
    reason: r.reason == null ? null : String(r.reason),
    evidence: r.evidence == null ? null : String(r.evidence),
    attempts,
    executing:
      r.state === 'running' &&
      r.lease_until != null &&
      new Date(String(r.lease_until)).getTime() > Date.now(),
    version: Number(r.version),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    finished_at: nullableIso(r.finished_at),
  };
}

/** The records of these qualification rows, with their attempts and request counts. */
export async function recipeRecords(
  c: PoolClient,
  rows: Row[],
): Promise<RecipeQualificationRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const attempts = (
    await c.query(
      `select a.*, (select count(*)::int from plan_requests p where p.recipe_attempt_id = a.id) as requests
         from recipe_qualification_attempts a where a.qualification_id = any($1::uuid[])
        order by a.started_at, a.slot`,
      [ids],
    )
  ).rows as Row[];
  return rows.map((r) =>
    toRecipeQualification(
      r,
      attempts
        .filter((a) => String(a.qualification_id) === String(r.id))
        .map((a) => toAttempt(a, Number(a.requests))),
    ),
  );
}

/** A running qualification this holder leases, locked for the caller's transaction. */
async function heldRow(
  c: PoolClient,
  id: string,
  holder: string,
): Promise<Row | null> {
  const r = (
    await c.query(
      'select * from recipe_qualifications where id = $1 for update',
      [uuid(id)],
    )
  ).rows[0] as Row | undefined;
  if (!r || r.state !== 'running' || r.lease_holder !== holder) return null;
  return r;
}

async function finishQualification(
  c: PoolClient,
  id: string,
  state: 'qualified' | 'not_qualified' | 'stopped',
  passed: number,
  reason: string,
) {
  await c.query(
    `update recipe_qualifications set state = $2, passed = $3, reason = $4,
       finished_at = clock_timestamp(), lease_holder = null, lease_until = null,
       version = version + 1 where id = $1`,
    [id, state, passed, reason.slice(0, 4000)],
  );
}

/**
 * The next step of a running qualification (expectations: three attempts, each replaced at most
 * once after an infrastructure fault; fewer than all passing is not qualified). An attempt left
 * running by a process that lost the lease ended without a verdict, so it is invalid. The first
 * failed attempt ends the qualification: it can no longer pass, and further attempts would only
 * spend requests.
 */
export async function nextRecipeAttempt(
  c: PoolClient,
  id: string,
  holder: string,
  requestLimit: number,
  room: (
    connectionId: string,
    /** The input cap recorded at Start and the fewest characters Start accepted. */
    recordedInputCap: { max: number; min: number } | null,
  ) => Promise<RecipeRoom> = async () => ({
    kind: 'ok',
  }),
): Promise<NextRecipeAttempt> {
  const q = await heldRow(c, id, holder);
  if (!q) return { kind: 'end' };
  await c.query(
    `update recipe_qualification_attempts set state = 'invalid', finished_at = clock_timestamp(),
       reason = 'The studio stopped during this attempt, before a verdict; nothing was re-sent.'
     where qualification_id = $1 and state = 'running'`,
    [q.id],
  );
  const attempts = (
    await c.query(
      'select * from recipe_qualification_attempts where qualification_id = $1 order by started_at',
      [q.id],
    )
  ).rows as Row[];
  const needed = Number(q.attempts_needed);
  let passed = 0;
  for (let slot = 1; slot <= needed; slot++) {
    const chain = attempts.filter((a) => Number(a.slot) === slot);
    const last = chain.at(-1);
    if (last?.state === 'passed') {
      passed++;
      continue;
    }
    if (last?.state === 'failed') {
      await finishQualification(
        c,
        String(q.id),
        'not_qualified',
        passed,
        `Attempt ${slot} failed: ${String(last.reason ?? 'no reason recorded')} ${passed} of ${needed} attempts passed; the rest were not run, because the qualification can no longer pass.`,
      );
      return { kind: 'end' };
    }
    if (last?.state === 'invalid' && last.replaces != null) {
      await finishQualification(
        c,
        String(q.id),
        'stopped',
        passed,
        `Attempt ${slot} stopped twice before a verdict (the frozen rules allow one replacement): ${String(last.reason ?? '')}`,
      );
      return { kind: 'end' };
    }
    const free = await room(
      String(q.connection_id),
      q.max_input_chars == null
        ? null
        : { max: Number(q.max_input_chars), min: Number(q.min_input_chars) },
    );
    if (free.kind === 'stop') {
      await finishQualification(
        c,
        String(q.id),
        'stopped',
        passed,
        `Stopped before attempt ${slot}${last ? ' (its replacement)' : ''}, which was not started: ${free.reason}`,
      );
      return { kind: 'end' };
    }
    if (free.kind === 'wait') {
      // Looked at again after a short wait; the lease stays with this holder until then. The
      // version moves only when the reason shown changes.
      await c.query(
        `update recipe_qualifications set reason = $2,
           lease_until = clock_timestamp() + make_interval(secs => $3::double precision / 1000),
           version = version + case when reason is distinct from $2 then 1 else 0 end
         where id = $1`,
        [q.id, free.reason.slice(0, 4000), RECIPE_WAIT_MS],
      );
      return { kind: 'wait', reason: free.reason };
    }
    const attemptId = randomUUID();
    const replaces = last ? String(last.id) : null;
    await c.query(
      `insert into recipe_qualification_attempts (id, qualification_id, slot, replaces, state,
         request_limit) values ($1,$2,$3,$4,'running',$5)`,
      [attemptId, q.id, slot, replaces, requestLimit],
    );
    await c.query(
      'update recipe_qualifications set reason = null, version = version + 1 where id = $1',
      [q.id],
    );
    return { kind: 'attempt', attempt_id: attemptId, slot, replaces };
  }
  await finishQualification(
    c,
    String(q.id),
    'qualified',
    needed,
    `${needed} of ${needed} attempts met every pass bar.`,
  );
  return { kind: 'end' };
}

/** The running attempt of a qualification this holder leases, locked; null when it ended. */
export async function heldAttempt(
  c: PoolClient,
  attemptId: string,
  holder: string,
): Promise<Row | null> {
  const a = (
    await c.query(
      'select qualification_id from recipe_qualification_attempts where id = $1',
      [uuid(attemptId)],
    )
  ).rows[0] as Row | undefined;
  if (!a) return null;
  // Lock order: the qualification, then its attempt (as nextRecipeAttempt and Stop do).
  const q = await heldRow(c, String(a.qualification_id), holder);
  if (!q) return null;
  const row = (
    await c.query(
      'select * from recipe_qualification_attempts where id = $1 for update',
      [uuid(attemptId)],
    )
  ).rows[0] as Row;
  return row.state === 'running' ? row : null;
}

export async function finishRecipeAttempt(
  c: PoolClient,
  attemptId: string,
  holder: string,
  out: {
    state: 'passed' | 'failed' | 'invalid';
    reason: string;
    repairs: number | null;
    result: RecipeAttemptResult | null;
  },
): Promise<boolean> {
  const row = await heldAttempt(c, attemptId, holder);
  if (!row) return false;
  const result = out.result
    ? RecipeAttemptResultSchema.parse(out.result)
    : null;
  await c.query(
    `update recipe_qualification_attempts set state = $2, reason = $3, repairs = $4, result = $5,
       finished_at = clock_timestamp() where id = $1`,
    [row.id, out.state, out.reason.slice(0, 4000), out.repairs, result],
  );
  return true;
}

/** Refused when the record is not this workspace's; used by every owner command. */
export async function lockRecipeQualification(
  c: PoolClient,
  ws: string,
  id: string,
): Promise<Row> {
  const r = (
    await c.query(
      'select * from recipe_qualifications where id = $1 and workspace_id = $2 for update',
      [uuid(id), uuid(ws)],
    )
  ).rows[0] as Row | undefined;
  if (!r) throw fail('NOT_FOUND', 'Build qualification not found.');
  return r;
}
