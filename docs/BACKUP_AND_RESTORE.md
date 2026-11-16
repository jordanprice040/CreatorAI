# Backup and restore (T17)

Creator Agent keeps its state in two places: the PostgreSQL records database and the local
product store (`CREATOR_PRODUCTS_ROOT`, default `.creator/products`), which holds each
generated product's Git repositories, packaged artifacts (`source.tar`) and manifests. The
database only indexes artifacts by hash, so a useful backup needs both, taken together.

## Make a backup

```powershell
$env:CREATOR_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/creator_dev'
$env:CREATOR_PRODUCTS_ROOT = 'C:\path\to\.creator\products'   # optional; this is the default
pnpm backup create backups\2026-11-01
```

This writes a new folder (it refuses an existing one) with:

- `database.dump`, a `pg_dump --format=custom` archive (no owners or privileges);
- `products/`, a byte copy of the product store (links and special files are refused);
- `backup-manifest.json`, the schema version, the dump's SHA-256 and the SHA-256 and size of
  every product file, plus row counts for the main tables and (since X06) lineage and budget
  totals. The dump runs inside an exported snapshot and the counts and totals are read from
  that same snapshot, so they describe exactly what is in the dump.

`pg_dump` and `pg_restore` must be at least as new as the server. They come with any
PostgreSQL installation; set `CREATOR_PG_BIN` to their folder if they are not on `PATH` (for
example `C:\Program Files\PostgreSQL\18\bin`). With the Docker database from
[DOCKER.md](DOCKER.md), use a PostgreSQL 18 client. The password is passed to the tools
through `PGPASSWORD`, never on the command line, and is never printed.

## Restore

Create a new, empty database and choose an empty products folder, then:

```powershell
psql -U postgres -c "create database creator_restored owner creator"
$env:CREATOR_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/creator_restored'
$env:CREATOR_PRODUCTS_ROOT = 'C:\path\to\restored-products'
pnpm backup restore backups\2026-11-01
```

Before writing anything, restore re-hashes the dump and every product file and refuses the
backup if any hash, size or file list differs, if its schema version is not the one this code
expects, or if the target database or products folder is not empty. It then runs
`pg_restore --single-transaction --exit-on-error`, copies the product files and verifies the
result, including exact row counts, the lineage fingerprint and the budget totals (see
[HOSTED_OPERATION.md](HOSTED_OPERATION.md)). Point the API at the restored database and
products folder to use it. The restored database keeps its environment label.

## Verify

`pnpm backup verify` checks the current `CREATOR_DATABASE_URL` against
`CREATOR_PRODUCTS_ROOT`: the schema is current, the audit hash chain recomputes, and every
catalogued artifact has its `manifest.json` and `source.tar` with the recorded hashes. It exits
non-zero and names the artifact and the problem when something is missing or changed. Restore
runs the same check and also requires at least the backed-up row counts.

## In the app: Settings › Backups (ADR-0123)

The studio owner (the person recorded as studio spending manager) can do the same from
**Settings › Backups**, with no PowerShell or environment variables:

- **Back up now** writes the same backup as `pnpm backup create`, named `manual-<time>`, into
  the backups folder (the installed app's own `backups` folder by default; a development
  studio uses `CREATOR_BACKUPS_DIR`, default `.creator/backups`, and `CREATOR_PG_BIN`).
- **Daily backup**: on by default while the app runs, at most once per UTC day across
  restarts, keeping the newest 7 (`daily-<time>`). Only daily backups are ever removed.
- **Check** re-hashes every file of a backup against its manifest.
- **Restore…** restores into a new database on the same server and a new folder, after the
  same hash checks and with the same verification as `pnpm backup restore`. The studio in
  use is not changed. To use the copy, start a studio with `CREATOR_DATABASE_URL` and
  `CREATOR_PRODUCTS_ROOT` pointing at it; the desktop app cannot switch to it yet.

Every backup, check and restore is recorded with its outcome, one at a time. ChatGPT and
Claude sign-ins are stored outside the database and products folder, so they are not in a
backup; sign in again after a restore.

**Before an upgrade** the installed app now takes this full backup (database and product
files) at the schema it is at, in `pre-upgrade-v<from>-<time>`, re-hashes it and lists the
dump, before migrating. Only the app version that made it can restore it. Older upgrade
backups (`pre-migrate-…`, database only) are listed too; restore those by hand with
`pg_restore`.

## What this does not cover

- Taking a backup while work is running is safe for the database (pg_dump reads one
  snapshot), but product files are copied after the dump, so a package written in between
  appears in `products/` without a catalogue row. Stop workers first for a clean pair.
- No encryption or off-machine copy (the daily backup and its retention are in Settings). The backup holds everything the
  database holds (session and ticket hashes, private records, audit history); keep it as
  private as the database itself.
- Restoring into an older or newer code version is refused; restore with the matching commit.
- Redacted text is not in the database, so it is not in a backup either.
