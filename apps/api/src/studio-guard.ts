import { readFileSync } from 'node:fs';
import { databaseUrl, takeStudioLock, type StudioLock } from '@creator/db';
import { resolveSecretFiles } from '@creator/domain';

export type StudioGuard =
  { ok: true; lock: StudioLock | null } | { ok: false; message: string };

/**
 * ADR-0108: the one-studio-per-database lock for a development launcher (`pnpm dev`,
 * `pnpm dev:api`). Reads the database URL the way `createApi` does, including
 * CREATOR_DATABASE_URL_FILE (review 2 L-4), and turns a malformed URL or an unreachable
 * database into a message instead of a stack trace (review 2 N-1). No database configured:
 * nothing to guard. A hosted deployment does not take it.
 */
export async function guardStudio(
  rawEnv: Record<string, string | undefined>,
  label: string,
  onLost: (message: string) => void,
): Promise<StudioGuard> {
  let url: string | null;
  try {
    const env = resolveSecretFiles(rawEnv, (p) => readFileSync(p, 'utf8')).env;
    if (env.CREATOR_DEPLOYMENT_MODE === 'hosted')
      return { ok: true, lock: null };
    url = databaseUrl(env.CREATOR_DATABASE_URL);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (!url) return { ok: true, lock: null };
  try {
    const taken = await takeStudioLock(url, label, {
      onLost,
      onNote: (note) => console.warn(note),
    });
    return taken.held
      ? { ok: true, lock: taken.lock }
      : { ok: false, message: taken.message };
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach the database to check that no other studio uses it (${e instanceof Error ? e.message : 'no answer'}). Start the database, then run this again.`,
    };
  }
}
