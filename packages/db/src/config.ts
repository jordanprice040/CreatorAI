import { readFileSync } from 'node:fs';
import { ContractError } from '@creator/contracts';
import { resolveSecretFiles } from '@creator/domain';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/**
 * Local deployment: the database must be on loopback. Hosted deployment (X06) may use a
 * managed database elsewhere, but only over TLS with the server certificate verified
 * (`sslmode=verify-full`). Never log the returned URL.
 */
export function databaseUrl(
  raw: string | undefined,
  mode: 'local' | 'hosted' = 'local',
): string | null {
  if (raw === undefined || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ContractError('INVALID_CONFIG', 'Database URL is malformed.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname.length < 2
  )
    throw new ContractError(
      'INVALID_CONFIG',
      'The database URL must be postgresql:// with a database name.',
    );
  if (LOOPBACK.has(url.hostname)) return raw;
  if (mode === 'local')
    throw new ContractError(
      'INVALID_CONFIG',
      'Local deployment requires a loopback postgresql:// URL with a database name.',
    );
  if (url.searchParams.get('sslmode') !== 'verify-full')
    throw new ContractError(
      'INVALID_CONFIG',
      'A hosted database off this machine needs sslmode=verify-full in its URL.',
    );
  return raw;
}

/** Process environment with `NAME_FILE` secrets loaded (X06). */
export function processEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return resolveSecretFiles(env, (p) => readFileSync(p, 'utf8')).env;
}
/** The configured database URL under the configured deployment mode's rules. */
export function configuredDatabaseUrl(
  env: Record<string, string | undefined>,
): string | null {
  return databaseUrl(
    env.CREATOR_DATABASE_URL,
    env.CREATOR_DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'local',
  );
}
