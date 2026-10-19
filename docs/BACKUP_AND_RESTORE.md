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

## What this does not cover

- Taking a backup while work is running is safe for the database (pg_dump reads one
  snapshot), but product files are copied after the dump, so a package written in between
  appears in `products/` without a catalogue row. Stop workers first for a clean pair.
- No schedule, retention, encryption or off-machine copy. The backup holds everything the
  database holds (session and ticket hashes, private records, audit history); keep it as
  private as the database itself.
- Restoring into an older or newer code version is refused; restore with the matching commit.
- Redacted text is not in the database, so it is not in a backup either.
