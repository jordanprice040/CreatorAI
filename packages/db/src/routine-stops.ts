import type { PoolClient } from 'pg';

/**
 * ADR-0079: why a routine approval policy's stop condition holds now (null: none does). Used
 * when a step is admitted and, for a build the policy admitted, before each of its requests.
 */
export async function routineStopReason(
  c: PoolClient,
  p: {
    workspace_id: string;
    run_id: string;
    stop_on: readonly string[];
    confirmed_at: string | Date;
  },
): Promise<string | null> {
  if (p.stop_on.includes('person_rejects')) {
    const { rowCount } = await c.query(
      `select 1 from decision_requests where workspace_id = $1 and run_id = $2
         and status = 'answered' and response->>'choice' = 'reject'
         and (response->>'responded_at')::timestamptz > $3 limit 1`,
      [p.workspace_id, p.run_id, p.confirmed_at],
    );
    if (rowCount)
      return 'A person rejected a decision in this run after the policy was confirmed, so it stopped. Confirm the policy again to continue.';
  }
  if (p.stop_on.includes('unknown_outcome')) {
    const { rowCount } = await c.query(
      `select 1 from budget_reservations where workspace_id = $1 and run_id = $2
         and status = 'unknown' limit 1`,
      [p.workspace_id, p.run_id],
    );
    if (rowCount)
      return 'A paid call in this run has an unknown outcome that is not reconciled yet.';
  }
  return null;
}
