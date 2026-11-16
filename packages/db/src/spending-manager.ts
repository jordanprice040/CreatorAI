import type { PoolClient } from 'pg';

/**
 * ADR-0113 (S0): the one check for the studio spending manager. `BudgetStore` guards the
 * ceiling and limits with it, and N1 (ADR-0116) sends spending alerts only to the person it
 * accepts. Agents, system actors and tester accounts never qualify, even if the row names them.
 */
export async function isSpendingManagerIn(
  c: PoolClient,
  actorId: string,
): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>(
    `select exists(select 1 from studio_spending_manager s join actors a on a.id = s.actor_id
        where s.actor_id = $1 and a.kind = 'human'
          and not exists(select 1 from tester_accounts t where t.actor_id = a.id)) as ok`,
    [actorId],
  );
  return rows[0]?.ok === true;
}

/** The studio spending manager's actor id, when the recorded person still qualifies. */
export async function spendingManagerId(c: PoolClient): Promise<string | null> {
  const { rows } = await c.query<{ actor_id: string }>(
    'select actor_id from studio_spending_manager',
  );
  const id = rows[0]?.actor_id;
  return id && (await isSpendingManagerIn(c, id)) ? String(id) : null;
}
