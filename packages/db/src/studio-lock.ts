import pg from 'pg';

/**
 * ADR-0108: one studio per database. A studio launcher (`pnpm dev`, the installed studio
 * service) holds this session-level advisory lock for as long as it serves, so a second
 * studio on the same records is refused whatever ports either one uses: two studios would
 * run two in-process workflow workers. `pnpm worker`, migrations, backups and tests do not
 * take it. A lost connection releases the lock with it.
 */
export const STUDIO_LOCK_KEY = 4310108;
const APP_PREFIX = 'creator-agent-studio';

export type StudioLock = { release: () => Promise<void> };
export type StudioLockResult =
  { held: true; lock: StudioLock } | { held: false; message: string };

/** What a holder reports about itself; kept short (application_name is 63 bytes). */
export const studioLabel = (what: string) =>
  `${APP_PREFIX} ${what}`.slice(0, 63);

export async function takeStudioLock(
  url: string,
  label: string,
): Promise<StudioLockResult> {
  const client = new pg.Client({
    connectionString: url,
    application_name: studioLabel(label),
  });
  // A dropped connection must not crash the studio; the lock simply goes with it.
  client.on('error', () => undefined);
  await client.connect();
  try {
    const got = await client.query<{ ok: boolean }>(
      'select pg_try_advisory_lock($1) as ok',
      [STUDIO_LOCK_KEY],
    );
    if (got.rows[0]?.ok)
      return {
        held: true,
        lock: {
          release: async () => {
            await client
              .query('select pg_advisory_unlock($1)', [STUDIO_LOCK_KEY])
              .catch(() => undefined);
            await client.end().catch(() => undefined);
          },
        },
      };
    const who = await client
      .query<{ name: string | null }>(
        `select a.application_name as name
           from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where l.locktype = 'advisory' and l.granted
            and l.classid = 0 and l.objid = $1 and l.objsubid = 1
          limit 1`,
        [STUDIO_LOCK_KEY],
      )
      .then((r) => r.rows[0]?.name ?? null)
      .catch(() => null);
    await client.end().catch(() => undefined);
    const holder =
      who && who.startsWith(APP_PREFIX)
        ? ` (${who.slice(APP_PREFIX.length).trim()})`
        : '';
    return {
      held: false,
      message: `Another Creator Agent studio is already running on this database${holder}. Stop it first, or open that one: two studios on one database would run two workflow workers.`,
    };
  } catch (e) {
    await client.end().catch(() => undefined);
    throw e;
  }
}
