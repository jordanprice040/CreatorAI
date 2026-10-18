import { ContractError } from '@creator/contracts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Local deployment only: the database must be on loopback. Never log the returned URL. */
export function databaseUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ContractError('INVALID_CONFIG', 'Database URL is malformed.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !LOOPBACK.has(url.hostname) ||
    url.pathname.length < 2
  )
    throw new ContractError(
      'INVALID_CONFIG',
      'Local deployment requires a loopback postgresql:// URL with a database name.',
    );
  return raw;
}
