import { resolve } from 'node:path';
import { configuredDatabaseUrl, processEnvironment } from './config.js';
import { createBackup, restoreBackup, verifyRestore } from './backup.js';

const USAGE = `Usage:
  pnpm backup create <new-backup-dir>
  pnpm backup restore <backup-dir>     (into an empty CREATOR_DATABASE_URL and CREATOR_PRODUCTS_ROOT)
  pnpm backup verify                   (checks CREATOR_DATABASE_URL against CREATOR_PRODUCTS_ROOT)
Optional: CREATOR_PG_BIN names the folder holding pg_dump and pg_restore.`;

try {
  const [command, dir] = process.argv.slice(2);
  const env = processEnvironment();
  const url = configuredDatabaseUrl(env);
  if (!url)
    throw new Error('Set CREATOR_DATABASE_URL (or CREATOR_DATABASE_URL_FILE).');
  const productsRoot = resolve(
    env.CREATOR_PRODUCTS_ROOT ?? '.creator/products',
  );
  const pgBinDir = env.CREATOR_PG_BIN || undefined;
  let out: unknown;
  if (command === 'create' && dir)
    out = await createBackup({
      databaseUrl: url,
      productsRoot,
      outDir: resolve(dir),
      pgBinDir,
    });
  else if (command === 'restore' && dir)
    out = await restoreBackup({
      backupDir: resolve(dir),
      databaseUrl: url,
      productsRoot,
      pgBinDir,
    });
  else if (command === 'verify') out = await verifyRestore(url, productsRoot);
  else throw new Error(USAGE);
  console.log(JSON.stringify(out, null, 2));
  if (out && typeof out === 'object' && 'ok' in out && out.ok === false)
    process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backup failed.');
  process.exitCode = 1;
}
