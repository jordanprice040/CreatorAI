import type { PoolClient } from 'pg';
import { fail, uuid } from './store.js';

// Audit L-9: workspace lists used to read `order by created_at limit N`, so once a workspace
// had more than N records the newest ones were the ones left out. Lists now read newest
// first, one page at a time: a page is at most `limit` records, and the next older page
// starts after the last record shown (`before` = that record's id). The response stays a
// plain array, so a page shorter than `limit` is the last one.

export type PageRequest = { before?: string | null; limit?: number | null };

/** The page asked for, checked: `before` is a record id, `limit` is 1..max (default max). */
export function readPage(
  req: PageRequest | undefined,
  max: number,
): { before: string | null; limit: number } {
  const limit = req?.limit ?? max;
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    throw fail('INVALID_CONTRACT', `limit must be 1–${max}.`);
  const before = req?.before ? uuid(req.before, 'INVALID_CONTRACT') : null;
  return { before, limit };
}

/**
 * Checks that `before` names a record of this workspace's `table`. A cursor that names no record
 * is refused, instead of quietly returning an empty page.
 */
export async function checkPageStart(
  c: PoolClient,
  table: PagedTable,
  ws: string,
  before: string | null,
): Promise<void> {
  if (!before) return;
  const { rowCount } = await c.query(
    `select 1 from ${table} where workspace_id = $1 and id = $2`,
    [ws, before],
  );
  if (!rowCount) throw fail('NOT_FOUND', 'The page cursor names no record.');
}

/** The tables whose lists are paged, and the time each is ordered by. */
export const PAGED = {
  budget_envelopes: 'created_at',
  payment_offers: 'created_at',
  entitlements: 'created_at',
  earnings_tranches: 'settled_at',
  reinvestment_allocations: 'created_at',
  marketing_campaigns: 'created_at',
  portfolio_schedules: 'created_at',
} as const;
export type PagedTable = keyof typeof PAGED;

/**
 * The SQL condition "older than the `before` record" for `alias`'s rows, with `$1` as the
 * workspace and `$<param>` as the cursor id (null for the first page). The cursor's time is
 * read in the database, so microsecond timestamps compare exactly (a JavaScript Date would
 * round them to milliseconds). Ties on time are broken by id, matching `newestOrder`.
 */
export function olderThan(table: PagedTable, param: number, alias = '') {
  const at = PAGED[table];
  const p = alias ? `${alias}.` : '';
  return `($${param}::uuid is null or (${p}${at}, ${p}id) < (select ${at}, id from ${table} where workspace_id = $1 and id = $${param}))`;
}
/** The matching order: newest first, ties by id. */
export function newestOrder(table: PagedTable, alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}${PAGED[table]} desc, ${p}id desc`;
}

/** Reads the page parameters from a request's query string. */
export function pageQuery(get: (k: string) => string | null | undefined) {
  const before = get('before');
  const limit = get('limit');
  const out: PageRequest = {};
  if (before) out.before = before;
  if (limit) {
    if (!/^[0-9]{1,4}$/.test(limit))
      throw fail('INVALID_CONTRACT', 'limit must be a whole number.');
    out.limit = Number(limit);
  }
  return out;
}
