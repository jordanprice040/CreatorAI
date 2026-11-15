import pg from 'pg';

/**
 * ADR-0108: one studio per database. A studio launcher (`pnpm dev`, `pnpm dev:api`, the
 * installed studio service) holds this session-level advisory lock for as long as it serves,
 * so a second studio on the same records is refused whatever ports either one uses: two
 * studios would run two in-process workflow workers. `pnpm worker`, migrations, backups and
 * tests do not take it. The lock lives on its own connection; when that connection drops
 * (a database or Docker restart), the holder takes the lock again as soon as the database is
 * back, and stops if another studio took it meanwhile (review 2 L-1).
 */
export const STUDIO_LOCK_KEY = 4310108;
const APP_PREFIX = 'creator-agent-studio';
/** A half-up database fails the start instead of hanging it (review 2 N-2). */
export const STUDIO_LOCK_CONNECT_MS = 10_000;
const RETRY_MS = [1000, 2000, 5000, 10_000];

export type StudioLock = { release: () => Promise<void> };
export type StudioLockResult =
  { held: true; lock: StudioLock } | { held: false; message: string };
export type StudioLockOptions = {
  /** Another studio took the lock while this one's connection was down: stop serving. */
  onLost?: (message: string) => void;
  /** Progress while the lock connection is down and when it is held again. */
  onNote?: (note: string) => void;
  connectMs?: number;
  /** Test seam: the waits between attempts to take the lock again. */
  retryMs?: readonly number[];
};

/** What a holder reports about itself; kept short (application_name is 63 bytes). */
export const studioLabel = (what: string) =>
  `${APP_PREFIX} ${what}`.slice(0, 63);

const refusal = (holder: string | null) =>
  `Another Creator Agent studio is already running on this database${
    holder && holder.startsWith(APP_PREFIX)
      ? ` (${holder.slice(APP_PREFIX.length).trim()})`
      : ''
  }. Stop it first, or open that one: two studios on one database would run two workflow workers.`;

type Attempt =
  { held: true; client: pg.Client } | { held: false; message: string };

async function attempt(
  url: string,
  label: string,
  connectMs: number,
): Promise<Attempt> {
  const client = new pg.Client({
    connectionString: url,
    application_name: studioLabel(label),
    connectionTimeoutMillis: connectMs,
  });
  // A dropped connection must not crash the studio; the 'end' handler takes over.
  client.on('error', () => undefined);
  await client.connect();
  try {
    const got = await client.query<{ ok: boolean }>(
      'select pg_try_advisory_lock($1) as ok',
      [STUDIO_LOCK_KEY],
    );
    if (got.rows[0]?.ok) return { held: true, client };
    // Advisory locks are per database, but pg_locks lists the whole server (review 2 L-2).
    const who = await client
      .query<{ name: string | null }>(
        `select a.application_name as name
           from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where l.locktype = 'advisory' and l.granted
            and l.database = (select oid from pg_database where datname = current_database())
            and l.classid = 0 and l.objid = $1 and l.objsubid = 1
          limit 1`,
        [STUDIO_LOCK_KEY],
      )
      .then((r) => r.rows[0]?.name ?? null)
      .catch(() => null);
    await client.end().catch(() => undefined);
    return { held: false, message: refusal(who) };
  } catch (e) {
    await client.end().catch(() => undefined);
    throw e;
  }
}

/**
 * Takes the studio lock for `url`. Throws when the database can't be reached (within
 * `connectMs`); resolves `held: false` with a message naming the holder when another studio
 * has it.
 */
export async function takeStudioLock(
  url: string,
  label: string,
  options: StudioLockOptions = {},
): Promise<StudioLockResult> {
  const connectMs = options.connectMs ?? STUDIO_LOCK_CONNECT_MS;
  const retryMs = options.retryMs ?? RETRY_MS;
  const first = await attempt(url, label, connectMs);
  if (!first.held) return first;
  let client: pg.Client | null = first.client;
  let released = false;
  let timer: NodeJS.Timeout | null = null;

  const retake = async (n: number) => {
    timer = null;
    if (released) return;
    try {
      const again = await attempt(url, label, connectMs);
      if (released) {
        if (again.held) await again.client.end().catch(() => undefined);
        return;
      }
      if (!again.held) {
        released = true;
        options.onLost?.(
          `The studio lost its database connection, and meanwhile another studio started on this database. ${again.message}`,
        );
        return;
      }
      watch(again.client);
      options.onNote?.('Studio lock held again after the database came back.');
    } catch {
      const wait = retryMs[Math.min(n, retryMs.length - 1)] ?? 10_000;
      timer = setTimeout(() => void retake(n + 1), wait);
      timer.unref();
    }
  };
  const watch = (c: pg.Client) => {
    client = c;
    c.once('end', () => {
      if (released || client !== c) return;
      client = null;
      options.onNote?.(
        'The studio lock connection dropped; taking the lock again when the database is back.',
      );
      void retake(0);
    });
  };
  watch(first.client);

  return {
    held: true,
    lock: {
      release: async () => {
        released = true;
        if (timer) clearTimeout(timer);
        const c = client;
        client = null;
        if (!c) return;
        await c
          .query('select pg_advisory_unlock($1)', [STUDIO_LOCK_KEY])
          .catch(() => undefined);
        await c.end().catch(() => undefined);
      },
    },
  };
}
