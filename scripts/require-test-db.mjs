// `pnpm test` skips PostgreSQL suites visibly when no test server is configured;
// `pnpm test:db` refuses to run without one so a skipped gate cannot pass silently.
if (!process.env.CREATOR_TEST_DATABASE_URL) {
  console.error(
    'Set CREATOR_TEST_DATABASE_URL to a loopback PostgreSQL URL whose role may CREATE DATABASE.',
  );
  process.exit(1);
}
