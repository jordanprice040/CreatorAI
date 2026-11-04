# Migration 41 trial on a copy of the installed schema-40 database (November 4, 2026)

Jordan approved this trial in the project thread ("I approve the trial upgrade"). The installed app
was not running, and its files, database and credentials were not changed.

## What was done

1. Cold copy of the installed app's PostgreSQL 18 cluster (`com.creatoragent.studio\postgres`,
   1,944 files, 75.4 MB) and `studio.json` to
   `C:\CreatorAgentBackups\installed-pre-mig41-trial-20261104-083410`. Source and copy SHA-256
   lists are identical (`source-hashes.txt` there). Credentials, secrets and browser data were not
   copied.
2. A scratch copy of that cluster was started on `127.0.0.1:55442`, with loopback-only trust
   authentication in the copy's `pg_hba.conf`. Before migrating, I took a `pg_dump` from the
   scratch copy into the backup folder (`database.dump`, sha256 `8162abc5…4d9a2259`, 125
   table-data entries) and recorded exact row counts.
3. Ran `packages/db/dist/migrate-main.js` from commit `a10331f` (PR #132) with portable Node
   22.23.4: `Applied migrations: 41` (`migrate.log`). The runner verifies the stored checksums of
   migrations 1–40, and none was refused. A second run printed `Database schema already current.`
4. Compared exact row counts of all 125 tables before and after (`before-after.diff`).

## Result

- Schema 40 → 41. Still 125 tables. Every table's row count is unchanged except
  `schema_migrations` (40 → 41).
- Both workspaces are present: Jordan's Creator Studio and Testing.
- Both plan connections are preserved, with the same version, sign-in, quota and eligibility:
  ChatGPT plan (v48) and Claude Code (v12), both `signed_in` / `available` / `eligible`. Both get
  `auth_generation = 0`.
- 131 plan requests: 125 completed, 4 failed and 2 reconciled. All keep their state. None has a
  generation or credential reference (legacy), so none can invalidate a login.
- New columns (`columns.txt`): `plan_connections.auth_generation bigint not null default 0`, plus
  nullable `plan_requests.auth_generation` and `credential_ref`.

## Limits

This database had no `in_flight` or `unknown` requests, so the legacy pending-request case was
covered only by the synthetic test. The trial checked the database only. It did not run the new
build against it, run the installer, or test the app's own "Back up and upgrade". Afterwards the
scratch cluster was stopped and deleted. The cold copy and dump are kept in
`C:\CreatorAgentBackups`.
