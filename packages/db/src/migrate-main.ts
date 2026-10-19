import pg from 'pg';
import { configuredDatabaseUrl, processEnvironment } from './config.js';
import { migrate } from './migrate.js';

try {
  const url = configuredDatabaseUrl(processEnvironment());
  if (!url)
    throw new Error('Set CREATOR_DATABASE_URL (or CREATOR_DATABASE_URL_FILE).');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const applied = await migrate(pool);
    console.log(
      applied.length
        ? `Applied migrations: ${applied.join(', ')}`
        : 'Database schema already current.',
    );
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
}
