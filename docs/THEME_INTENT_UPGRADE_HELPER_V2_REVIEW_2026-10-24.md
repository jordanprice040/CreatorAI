# Theme-intent upgrade helper v2: independent review, October 24 2026

**Verdict: partial. The v2 helper is not yet supported for the next operational
preparation step (operational `before`).** All v1 blockers (H1, H2) and M1–M3, L1–L8 are
resolved in the exact code. M4 and M5 are largely resolved. But the process-death
handling that v2 claims leaves an owner who interrupts `before` (Ctrl+C, closed window,
power loss) with a running operational cluster and a stale lock, with no helper route out
and a document that forbids the only manual fix. A death after migration can only be
rolled back, never verified forward. These are new Medium findings; they need a small
v3 and a fresh exact review.

No `supported_exact_helper` receipt is issued. The receipt in
`tracking/evidence/theme-intent-upgrade-helper-v2-review-2026-10-24/reviewer-receipt.json`
has status `partial_changes_required`, so `reviewCheck()`
(`scripts/theme-intent-upgrade-v2-core.mjs:328`) rejects it by design. This review is not
installation approval or an owner decision. Full C54 remains partial.

Reviewer: separate U02 model reviewer, no involvement in implementing v1, v2, the package
or the feature (`prior_implementation_involvement:false` is accurate). Not blinded and not
human acceptance.

Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`, plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`. Exact reviewed bytes:

| File | SHA-256 |
| --- | --- |
| scripts/theme-intent-upgrade-v2-core.mjs | 923df047a604065285a0d8cc360977ed84f0a195a182f0f2a89db8d7aa0fb38a |
| scripts/theme-intent-upgrade-v2.mjs | 7c716fe1bc4458cf4ead464924fbc42b8a7d5a7ad462adb1cf315331f76e4322 |
| scripts/upgrade-theme-intent-v2.ps1 | 9cd6694af1e435244a9c8cdff0120ec457ef37ff5a38c8b521699b8abf83e706 |
| scripts/install-theme-intent-v2.ps1 | 7becedbb7596405c704db4e442d6134501c14a1a3c8df2a6e77ccaeb873e3ece |
| scripts/recover-theme-intent-v2.ps1 | 2999457ee30a7d79c7709c9802763771fc34cf8b2fe2bb483edc726bcb184c13 |
| packages/db/dist/migrations.js | 967a75ddf58a281a2abcbd4bf131bc14678e5063eb44ce8fa925da1a730726fd |
| tests/theme-intent-upgrade-v2.test.mjs | 0162a934329928de98139aa606940936cb1670110bdc0876665fd9d6b1d63988 |
| tests/theme-intent-upgrade-v2-guards.test.mjs | 5688b28a492c6e45fcf542d517a3c597fb70e599cdd1aadf83c14978f7d308c0 |
| tests/fixtures/theme-intent-v2-installer.ps1 | 5334d128f7683038fcaf49e51e965b96fbc3924af40d2d26e92461cb06b6fb65 |

The full 144-entry runtime map (helpers, migration module and the pg dependency closure)
re-emitted by `--bindings` is identical to the repair receipt's `helper_sha256`
(`bindings-rerun.json`).

## Findings (most severe first)

### M1. A process death during `before` strands the owner; the only fix is one the document forbids

Executed (fixture probe `probe-before-death.mjs`, synthetic home on port 55461): the CLI
was killed right after it wrote `cluster-started-*.json`. Afterwards:

- the disposable managed cluster was still listening and `theme-intent-v2.lock` remained;
- a fresh `before` with a new session failed with `EEXIST` on the lock
  (`theme-intent-upgrade-v2.mjs:197`, `core:576-588`); with the lock removed it would
  still fail because the cluster is running (`core:396-400`);
- `recover` with a stale-lock decision and `allow_stop_owned_cluster:true` failed with
  `ENOENT` on `backups/theme-intent-v2-<session>/protected/studio.json`
  (`theme-intent-upgrade-v2.mjs:69-73`), and would next need `prepared.json` (`:90`);
- `reconcile` failed with `ENOENT` on `prepared.json` (`:90`).

The only paths forward are deleting the lock and running `pg_ctl stop` by hand.
`docs/THEME_INTENT_UPGRADE_HELPER_V2_2026-10-23.md:142-149` says "do not erase locks
manually". Data is not at risk (`before` only reads the database), and the desktop
would reuse the leftover cluster (`postgres.rs:148`). But the helper is permanently
blocked for that studio home. Ctrl+C in the PowerShell window during a long backup, or
closing the window, is a likely way to hit this. The repair tests only cover hard
crashes after `prepared.json` exists.

**Fix required:** a bounded stale-state release that needs no `prepared.json`. It binds
the lock hash and the dead PID (the existing check at `:182-196`), stops only the exact
managed data directory, keeps the retired lock and partial evidence, and touches nothing
else. Exercise it with a kill during `before`.

### M2. After a process death post-migration, the only helper route is a full rollback

Every non-recover phase refuses a running cluster (`core:388-400`, `recoverOwned` is true
only for `recover`, `theme-intent-upgrade-v2.mjs:722`). The lock can only be retired by
`recover` (`:182`). Test 16 (`hard-crash-after-migration-intent`) confirms that
`reconcile` then fails.

- **Failure scenario:** the owner presses Ctrl+C while the in-process `after()` runs
  (`:520`) after a successful schema-29 migration and `migration-result.json`. `after`
  and `reconcile` cannot run. The only route is coordinated recovery to schema 28,
  including predecessor-installer replay and config relocation, for an upgrade that
  actually succeeded.
- **Fix required:** let `reconcile` and `after` retire a proven stale lock and stop a
  leftover cluster on the exact data directory under the same binding rules. Test a kill
  after the migration result.

### Low and informational

- **L-a. The confirmation switches can be bypassed.** `upgrade-theme-intent-v2.ps1:2`
  accepts `-Phase install` and `-Phase recover` directly, without
  `-InstallAndMigrateApproved` or `-CoordinatedRecoveryApproved`. Real authority still
  comes from the exact owner decision file, so this is ceremony, not an authority
  bypass. The guard test only exercises the two outer wrappers.
- **L-b. Cleanup can stop a cluster the helper did not start.** `managed()`'s `finally`
  stops whenever `pg_ctl status` is 0 (`core:431-436`), even when `start` failed. The
  desktop does not honor the helper lock, so a desktop relaunch mid-run would share the
  helper's cluster and then lose it. This needs owner misuse (Quit is a precondition).
- **L-c. Some runtime pieces are unbound.** `node` comes from PATH (`ps1:29,40`). The
  PostgreSQL tools come from the configured `pg_bin` (owner-chosen, external to the
  install). PowerShell and taskkill are system tools. The JavaScript dependency closure
  is bound.
- **L-d. The freshness window is consumed by re-verification.** `backup.created_at` is
  stamped before `verifyBackup()` and the second observation (`:472-477`). `admit()`
  re-hashes everything before it checks freshness (`:266-277`). Large program or products
  trees can exhaust 15 minutes. This fails closed, and a new session is required.
- **L-e. Predecessor replay with `/NS` does not create shortcuts.** In the generated
  Tauri script, `/NS` sets `NoShortcutMode` and skips Start-menu and desktop shortcut
  creation (`apps/desktop/src-tauri/target/release/nsis/x64/installer.nsi:483,1101,1130`;
  build time matches the pinned target installer). So "restore normal shortcut
  integration" is overstated. Existing shortcuts keep pointing at the same
  `creator-desktop.exe` path, and the registry is rewritten with the same 0.1.0 values.
  Both installers are 0.1.0, so `ALLOWDOWNGRADES "false"` (`:54,527-545`) does not
  abort replay. This is inferred from the current template, not executed. It is a native
  acceptance gap, not a blocker for `before`.
- **L-f. Tracked evidence includes file names.** `before.json` under `tracking/evidence`
  holds product and plan-credential file names and hashes (`core:557-562`). It contains
  no secret bytes. Vault files are named by reference ID (`plan-vault.ts:40`).
- **L-g. Repair TAPs are not bound to helper hashes.** `record-repair.mjs` checks only
  counts. This review's rerun against the exact bytes closes that gap.
- **L-h. The lock is written non-atomically.** It is created with `wx` and then written
  (`core:578-587`). A death between those two steps leaves an empty lock that recovery
  cannot parse. The window is negligible.

## Status of the v1 findings (traced in code)

| Finding | Status | Evidence |
| --- | --- | --- |
| H1 | Resolved | `managed()` checks `pg_ctl status` (exit 3 required), refuses a listener, starts with the desktop's exact `-p <port> -c listen_addresses=127.0.0.1` options (`core:411-422`, `postgres.rs:166-167`) and stops in `finally` with receipts. E2E 3–5, guard 4. Death handling: see M1/M2. |
| H2 | Resolved | Sensitive bytes go only to `<home>/backups/theme-intent-v2-<session>` (`core:336`). Both it and the evidence are new (`:152-153,177,439`), the backup is outside the repo unless under ignored `.verification` (`core:352-355`), and outside install/protected/products (`core:345-351`, `:79-82`). Ancestors are checked for junctions (`core:67-80`, e2e 2). Evidence is hashes/metadata only. The app has no pruning of `backups/`. |
| M1 | Resolved | `reviewCheck()` runs in both the pre-secret and main passes before DPAPI (`:66`, `ps1:29-36`). It binds 144 entries before `loadDatabase()` dynamically imports migrations/pg (`:175`). Built-ins only before that. `NODE_PG_FORCE_NATIVE` refused. |
| M2 | Resolved | Freshness only in admit/install (`:116-121,275-277`). `migrate` binds admission → intent → outcome (`:300-314`). `after` binds the migration chain without expiry (`:386-418`). E2E 20 (fixture clock). |
| M3 | Resolved | Installer resolved from `ROOT` and hashed before admission (`:495-498`). PS paths resolved against the PS location (`ps1:20-24`). E2E 8 runs from another cwd. |
| M4 | Largely resolved | Executable recovery with empty-target `pg_restore --single-transaction`, full schema-28 comparison, retained failed program/protected trees, an old database never dropped, refusal of changed source data (e2e 11–19). Gaps: M1/M2 and the native NSIS replay (L-e). |
| M5 | Resolved for the fixture boundary | Actual PS5 wrapper, real DPAPI, populated synthetic schema 28, real candidate `studio.mjs migrate`. Installer is a marked fixture. |
| L1/L2 | Resolved | One checked-out client and one repeatable-read read-only transaction for `state()` and the exported dump snapshot (`core:456-488`). |
| L3 | Resolved | `plan_qualifications='running'` and `backend_type='client backend'` (`core:500-502`). The quiescence list was checked against all state/status columns of migrations 1–29. |
| L4 | Resolved | Outcome binds the admission/intent hashes and ordering. Child has a timeout with `taskkill /T /F`, redacted stderr and a stdout hash (`core:144-210`, `:349-361`). E2E 17–19. |
| L5 | Resolved | See M1. Residual: L-c. |
| L6 | Resolved | The new receipt has no duplicate keys. |
| L7 | Resolved | JSON/UTF-8 request file, `GetUnresolvedProviderPathFromPSPath`. PS 5.1.26100 parse: 0 errors. |
| L8 | Resolved | One lock per studio home (`core:576`). E2E 10, guard 3. |

**Fixture seams.** Every seam (`test_context`, `test_clock_ms`, `hold_lock_ms`,
`fail_at`, `child_fixture`, the installer adapter, the simulated review format) is active
only when `layout()` accepts a context. That requires the context inside ignored
`.verification` with the `TEST_ONLY` marker, link-free contained paths, fixture ports
55450–55499 and `helper_` database names (`core:295-319`, `:83-87`). Operational
`reviewCheck()` rejects the fixture format (e2e 2). No seam reaches operational paths
or authority.

## Checks executed in this review (October 23–24 2026, Jordan's machine)

None touched operational configuration, credentials or the database, installed, migrated
or recovered anything, made provider calls, ran either real NSIS installer, or activated
workflows. No implementation file was edited. Evidence is in
`tracking/evidence/theme-intent-upgrade-helper-v2-review-2026-10-24/`.

1. All 306 repair-receipt hashes (144 helper + 162 artifact) match, 0 mismatches
   (`receipt-hash-verification.txt`).
2. `--bindings` matches the receipt map exactly (`bindings-rerun.json`), and `--check`
   exits 0 (`check-rerun.txt`).
3. Windows PowerShell 5.1.26100 parse of the four PS files: 0 errors (`ps5-parse.txt`).
4. Guard suite: 5/5 passed (`guards-review-rerun.tap`).
5. End-to-end suite: **21/21 passed** (20 scenarios plus the parent, 514 s), with the
   disposable listener on 55452 stopped afterwards (`e2e-review-rerun.tap`). This
   reproduces `e2e-verified.tap`. It used real DPAPI with synthetic credentials and the
   real candidate migrate child. Installers were fixtures.
6. Process-death probe for M1 (`probe-before-death.mjs`, `probe-before-death.json`): a
   disposable SCRAM cluster on 55461 with synthetic data. The probe cluster was stopped
   and nothing was left listening.

## Inspected evidence (not re-run)

- `e2e-first.tap` (inherited-handle wait), `e2e-second.tap` (pg_dump SCRAM failure from
  the earlier non-ASCII test password), `e2e-third.tap` 14/14 on an earlier development
  candidate, `e2e-expanded.tap` (interrupted at 14), and `e2e-final.tap` 16 passed with
  child scenarios 17–20 failing. All failures are retained and consistent with the
  repair document. Helper bytes per run cannot be proven, which is why item 5 was re-run.
- `e2e-verified.tap` 21/21 and `guards-final.tap` 5/5 match the claims.
- The generated NSIS template, desktop `postgres.rs`/`home.rs` config validation, and
  `packages/db/src/backup.ts` (no retention pruning).

## Native gaps (not established by any evidence)

Real target/predecessor NSIS behavior, standard and custom registry/shortcut state, the
installed desktop UI, and operational-scale timing of hashing and copying.

## Next eligible step

A U03 repair of M1 and M2 (L-a and L-b recommended) in a new helper revision with new
hashes. Then a fresh independent exact-helper review. Operational `before`, a new exact
owner install/migration decision, and installation each remain later, separately
authorized steps. This review created only this report and its evidence directory;
the tracking files were not edited.
