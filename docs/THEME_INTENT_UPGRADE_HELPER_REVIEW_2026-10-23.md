# Theme-intent upgrade helper: independent review, October 23 2026

**Verdict: blocked for the next preparation step (operational `before`).**
This review covers only the exact helper bytes listed below. It is not installation
approval, not an owner decision and not a `supported_exact_helper` receipt. Full C54
remains partial. The receipt in
`tracking/evidence/theme-intent-upgrade-helper-review-2026-10-23/reviewer-receipt.json`
uses status `blocked_changes_required`, so `reviewed()` in
`scripts/theme-intent-upgrade-core.mjs:31-39` rejects it by design.

Reviewer: separate U02 model reviewer. No involvement in implementing the helper, the
package or the theme-intent feature. Not blinded and not human acceptance.

Exact scope (hashes re-verified, all match the implementation receipt):

| File | SHA-256 |
| --- | --- |
| scripts/theme-intent-upgrade-core.mjs | 3583df84bcf081c679b354aaccedb32753f39e583c75f581790deae0ec1bdf5b |
| scripts/upgrade-theme-intent.mjs | c836d8d47ff8e43d917a7687d046e9064e3d7d097ab3b8b0806f3af7da0c8362 |
| scripts/upgrade-theme-intent.ps1 | b75e8ad37222ee42c35b53790684c2d3a88e927101ad5b0624cd6afb7d697965 |
| scripts/install-theme-intent.ps1 | 91b791f7dccc75144271c410fe275a19488ee281cbe44cd5e44e083e3cf20e47 |
| tests/theme-intent-upgrade.test.mjs | e1e2245b52b516c0f677b466393234782da3e2b1bb9bb3c3dcc5e03c1c77e99f |
| docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md | abcd07efa7205c7a936e27d069e728e914142dbdde2953e6231ef7c2beae579e |

Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`, plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.

## Findings (most severe first)

### H1. The helper cannot reach the managed database once the studio is fully quit

`upgrade-theme-intent.mjs:85-97` (`quit()`) refuses to continue while any
`creator-desktop.exe` exists. Then `:102-121` connects to the app-owned cluster at
`127.0.0.1:cfg.database.port` (managed mode is asserted at `:103`). But the desktop's
Quit stops that cluster: `apps/desktop/src-tauri/src/studio.rs:866-893` calls
`cluster.stop()` (`postgres.rs:180`, `pg_ctl stop -m fast`). The helper never starts or
stops the cluster, and the helper document never mentions it. The earlier
discovery-v2 helper avoided this by taking its backup while the app was still running
(`docs/DISCOVERY_SEMANTICS_V2_UPGRADE_PREPARATION_2026-10-22.md:16-23`).

- **Failure scenario:** the owner chooses Quit as instructed and runs `-Phase before`.
  `quit()` passes, the credential is decrypted, and the pool connection is refused.
  The same applies to `admit`, `migrate` and `after`. The only way to satisfy both
  conditions is an undocumented manual `pg_ctl start` against the app's data folder.
  The desktop would later reuse a cluster started that way (`postgres.rs:148-151`,
  `studio.rs:408-418`), but nothing records who started it or makes sure it is stopped
  between the helper's phases.
- **Effect:** fails closed, so nothing is damaged, but the next preparation step cannot
  run as designed. The 15-minute window (M2) makes manual workarounds fragile.
- **Fix required:** after `quit()` passes, the helper itself checks
  `pg_ctl status -D <studio_home>/postgres`. It refuses a foreign listener on the port,
  starts the cluster with the app's exact options (`-p <port> -c
  listen_addresses=127.0.0.1 -w`) and records that it did so. It stops the cluster in
  `finally` and writes a receipt line saying so. Exercise this with a disposable
  managed-layout home.

### H2. Credential copies and the full database dump go into an unconstrained, likely git-visible folder

`upgrade-theme-intent.mjs:141-166` copies `studio.json`, `secrets/` (including
`postgres.dpapi`), `plan-credentials/`, the full products tree, the whole program and
`database.dump` into `EvidenceDir`. `EvidenceDir` is any path (`:68-69`; the document
says only `<new-directory>`, `docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md:20`). The
project's convention is `tracking/evidence/...`, which `.gitignore` does not exclude
(only `.verification/` and one t18 path are ignored).

- **Failure scenario:** following the convention puts DPAPI blobs, OAuth/plan credential
  vault files and every record of the studio into an untracked, committable path in
  the repository. A later `git add tracking/evidence` publishes them. The database dump
  alone carries all records, including any stored tokens.
- **Fix required:** split the outputs. The sensitive copies (protected files, dump,
  products, program) go under `<studio_home>/backups/<new>` or the gitignored
  `.verification/`. Only hashes and manifests go in `tracking/evidence`. Resolve the
  directory and assert that it is outside the repository's tracked tree and outside the
  install, products and protected source folders. Reject a directory that is, or whose
  parents are, a reparse point.

### M1. `before` decrypts the credential and copies protected files without the independent-review gate

The review and approval gate runs only when `phase !== 'before'`
(`upgrade-theme-intent.mjs:74-83`). For `before`, the `--presecret` pass
(`upgrade-theme-intent.ps1:9-10`) checks only package identity and `quit()`. Then
`upgrade-theme-intent.ps1:13-16` decrypts the DPAPI secret, and the Node side reads
the operational database and copies credentials.

- **Failure scenario:** unreviewed or locally modified helper bytes take a full
  credential and database copy. The later `admit` hash check (`:81`) catches modified
  bytes only after the copy already exists. The plan's first precondition is that
  "pre-secret gates" are reviewed (`installation-plan.json`, preconditions[0]).
- **Fix required:** `before` should take a review-receipt argument and call `reviewed()`
  in the pre-secret pass, before DPAPI is read.

### M2. The 15-minute freshness check also blocks post-mutation steps, which can leave the upgrade with no way to verify it

Every non-`before` phase re-checks approval (`upgrade-theme-intent.mjs:76`), prepared
(`:82`) and backup (`:127`) freshness, and `migrate` also checks admission freshness
(`:208`). All of these count from timestamps taken before installation.

- **Failure scenario:** the installer finishes, or `migrate` succeeds, more than 15
  minutes after `backup.json.created_at`. Reasons include the owner reviewing
  `prepared.json`, writing the approval, a slow pre-migration dump, or a re-run after a
  transient `after` failure. `migrate` or `after` then refuses to run. A fresh `before`
  cannot replace them, because it requires schema 28 and the predecessor program. The
  schema-29 database is then left with no executable verification.
- **Fix required:** apply freshness only to admission. `migrate` binds to the admission
  record and the installer outcome, and `after` binds to the migration result. Post-
  mutation read-only verification must stay runnable at any age.

### M3. `install-theme-intent.ps1` resolves the installer path against the wrong directory

Line 11 calls `[IO.Path]::GetFullPath($plan.installer_path)`. Windows PowerShell 5.1
`Set-Location` does not change .NET's current directory. Probe output, run from
`%TEMP%`: PS location `C:\dev\creator_agent`, while `GetFullPath` gave
`C:\Users\jorda\AppData\Local\Temp\.verification\...`, which does not exist.

- **Failure scenario:** the owner starts the script from any folder other than the repo
  root. `admit` succeeds first (line 9), creating `installation.lock` and
  `admission.json`. Then `Get-FileHash` throws, the evidence directory is used up, and a
  new `before` is required. This fails closed but wastes the backup.
- **Fix required:** use `Join-Path (Split-Path -Parent $PSScriptRoot)
  $plan.installer_path` and `Resolve-Path -LiteralPath`. Verify the installer path and
  hash before running `admit`.

### M4. The coordinated rollback is documentation only; crash windows have no executable recovery

There is no restore script. The recovery steps are prose
(`docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md:83-99`), `restore_rehearsed:false`
is set (`upgrade-theme-intent.mjs:165`), and test 10 restores a two-table synthetic
database rather than the schema.

- **Crash windows:**
  - Between `installation.lock` and `admission.json` (`:194-200`), `admit` cannot re-run.
  - Between the installer finishing and `installer-outcome.json` being written
    (`install-theme-intent.ps1:13-14`), the program is already the target. A new
    `before` then fails the predecessor check.
  - After `migration.lock` with a failed child (`:209-242`).
- **What is unrecovered:** each of these windows needs a manual, unrehearsed recovery.
  The program copy does not restore the installer's HKCU uninstall and shortcut state.
- **Partly covered by this review:** the restore probe shows that the database part of
  `theme-intent-upgrade-backup/1` restores a real 114-table schema-28 structure
  exactly. That run had empty tables.
- **Fix required:** add a scripted, rehearsed recovery on a disposable managed-layout
  home. It restores the program, `studio.json`, secrets, plan credentials and an
  empty-target `pg_restore`, then runs the `state()` comparison against `before.json`.
  Define explicit recovery entry points for each lock state.

### M5. Tests do not exercise the real control flow, and two completion claims go beyond the evidence

No test runs `upgrade-theme-intent.mjs` in any phase except `--check`, and no test runs
`upgrade-theme-intent.ps1`. Untested:

- `quit()`, the `--presecret` gate, and the composition of `before`, `admit`, `migrate`
  and `after`;
- the locks, `installer-outcome.json` handling, migrate stdout parsing and exit-code
  handling.

Claims that go beyond the evidence:

- Test 9 fingerprints empty tables only.
- The document claims "installer denial before file/credential reads" (line 113), but
  test 8 checks only the missing `-InstallAndMigrateApproved` switch.

The candidate migrate probe in this review partly closes the gap. Run under the
helper's exact payload shape and parser, the real candidate `studio.mjs migrate`
returned `from 28 / to 29 / applied [29]`, its pre-migration dump hash checked out,
and `preserved()` passed. A second run was a no-op but created another backup.

- **Fix required:** make the home, install, DPAPI and plan paths injectable for tests
  only, with the operational defaults kept. Then run all phases end to end against a
  disposable managed-layout home and cluster, including the lock and crash-retry paths.

### Low and informational

- **L1. `before.json` is not bound to the dump snapshot.** `state()`
  (`core:178-266`) is a series of independent statements, not one snapshot, and runs
  before and after the dump (`upgrade-theme-intent.mjs:142,158,168`). The supported
  `createBackup` holds a dedicated snapshot connection and derives its counts from it
  (`packages/db/src/backup.ts:232-260`). Fix: run `state()` inside the exporting
  repeatable-read transaction on one dedicated client.
- **L2. Snapshot transaction on a pooled client.** `dumpSnapshot` runs
  `begin`/`pg_export_snapshot`/`rollback` through `pool.query` (`core:41-63`), so the
  transaction lives on a released pooled client that is subject to idle reaping. Use
  `pool.connect()`.
- **L3. Quiescence gaps.** Quiescence ignores `plan_qualifications.state='running'`.
  The `pg_stat_activity` count (`core:186`) includes autovacuum workers, so it can block
  without cause (fails closed). Filter on `backend_type='client backend'`.
- **L4. Weak handling of the installer outcome and the migrate child.**
  `installer-outcome.json` is trusted unhashed and is not ordered after admission
  (`upgrade-theme-intent.mjs:203-205`). The migrate child's stderr is discarded and the
  child has no timeout (`:223-237`).
- **L5. The helper-review binding covers only the four helper files.** The process that
  holds the secret imports `packages/domain/dist` and `packages/db/dist` at load, before
  any hash check (`upgrade-theme-intent.mjs:8`, `core:12-16`). `db/dist/migrations.js` is
  in `candidate.source_sha256`, but it is checked only after import, and `pg` is
  unbound. Fix: verify first, then use dynamic `import()`, and include these in
  `helper_sha256`.
- **L6. The implementation receipt's `format` field reads `"passed"`.**
  `record-preparation.mjs` sets the `format` key twice, so the second value wins.
- **L7. PowerShell 5 argument handling.** Probes confirmed three behaviours:
  - An empty `$ApprovalFile` is dropped. This is harmless for `before`, and other phases
    fail closed.
  - A quote inside the approval argument merges `--presecret` into it. Windows paths
    cannot contain `"`, so this fails closed.
  - Piped stdin is US-ASCII. The current password is random hex, so there is no effect.
  - `$LASTEXITCODE` checks are correctly placed.
- **L8. Locks are per evidence directory only.** Running two directories in parallel
  would need two separate owner approvals, which limits the risk.

## Confirmed sound

- Exact candidate, plan, package-review and source bindings are checked, as are all
  71 extracted and archived resources (`--check` re-run, exit 0).
- Approval binds the candidate, the plan, the hash of `prepared.json` and the
  28→29-only scope. Old grants are not accepted.
- The helper-review receipt must be non-self and must carry the exact helper hashes.
- `admit` compares the full current program against the verified rollback copy.
- Junctions are rejected inside and at the roots of hashed trees (probe). `child()`
  keeps manifest paths contained.
- Only `from 28 / to 29 / applied [29]` is accepted. Ledger names and checksums are
  compared against `migrations.js`, which is bound to the candidate.
- Migration 29 only widens the `entities_kind_check` constraint, so the full-table
  fingerprint comparison is a valid preservation check for 28→29.
- `--no-owner --no-privileges` matches the supported `preMigrationBackup`, and the
  database restore of a real schema-28 structure is exact (probe).

## Checks executed in this review

All of these ran on 2026-10-23 on Jordan's machine. None touched operational
configuration, credentials or the database, made provider calls, installed anything or
activated workflows. No implementation file was edited.

1. Implementation receipt hashes: all 16 artifact and 4 helper hashes match
   (`receipt-hash-verification.txt`).
2. `node scripts/upgrade-theme-intent.mjs --check` exited 0 (`check-rerun.txt`).
3. Windows PowerShell 5.1.26100 parse of both scripts: 0 errors.
4. PowerShell 5 argument, stdin-encoding and working-directory probes
   (`ps5-*-probe.txt`).
5. Junction and path-containment probe on scratch folders.
6. A disposable PostgreSQL 18 cluster, created with `initdb` in the session scratchpad
   at 127.0.0.1:55451 with trust auth and synthetic data only. On it:
   - the official test file, 10/10 pass (`tests-review-rerun.tap`);
   - the candidate migrate probe (real `.verification/theme-intent-nsis-payload`
     `studio.mjs migrate`);
   - the schema-28 dump and restore probe;
   - the state-vocabulary probe.

   The cluster was stopped with `pg_ctl stop -m fast`, and nothing was listening on
   55451 afterwards.

## Historical evidence inspected (not re-run)

- `tests.tap` (EACCES) and `tests-host.tap` (ETIMEDOUT, port 55449), each 7/8.
- `tests-executed.tap` 8/8 and `tests-expanded.tap` 10/10.
- `tests-shutdown-orchestration.tap` 8/10, with ECONNREFUSED on tests 9 and 10.
- `tests-reviewed.tap` 10/10. Its test names match the current test file, and the
  failures are honestly retained.
- The static preflight and parse texts.
- The frozen package documents, plan, candidate and package-review receipt. The
  older discovery-v2 helpers and their preparation and result documents were used for
  comparison.

## Next eligible step

Repair H1, H2, M1-M5 (L1, L3 and L5 are recommended) in a new helper revision with new
hashes. Then run a fresh independent exact-helper review. Fresh operational backup,
a new exact owner installation and migration decision, and installation all remain
later, separately authorized steps.
