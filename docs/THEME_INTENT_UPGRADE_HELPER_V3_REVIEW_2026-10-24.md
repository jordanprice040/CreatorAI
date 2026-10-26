# Theme-intent upgrade helper v3: independent review, October 24 2026

**Verdict: supported for the exact v3 helper bytes. The v3 helper may be used for the next
separately authorized operational preparation step (operational `before`).** Both v2
Medium findings (M1, M2) are resolved in the exact code and were reproduced as fixed with
abrupt external termination of the real CLI under the real PowerShell 5.1 wrapper. Five
Low or informational findings remain. None of them grants authority, repeats an effect or
strands the owner. They are recorded below for a later revision.

A `theme-intent-upgrade-independent-review/3` receipt with status `supported_exact_helper`
and the complete 145-entry `helper_sha256` map is in
`tracking/evidence/theme-intent-upgrade-helper-v3-review-2026-10-24/reviewer-receipt.json`.
It was validated with the helper's own operational `reviewCheck()` (`fixture=false`).

This review is not owner authorization. It does not authorize operational `before`,
installation, migration, recovery or stale-state release. Each of those still needs its own
exact owner decision. Native NSIS, registry, shortcut and installed-UI acceptance and an
operational schema-29 installation remain undemonstrated. Full C54 remains partial.

Reviewer: separate U02 model reviewer on Jordan's machine. It had no involvement in
implementing v1, v2, v3, the package or the feature (`prior_implementation_involvement:false`
is accurate). It is not blinded and it is not human acceptance.

## Reviewed identities

Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`, plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`
(`--check` exit 0: package, plan, package-review receipt, both installers and the extracted
payload re-verified).

| File | SHA-256 |
| --- | --- |
| scripts/theme-intent-upgrade-v3-core.mjs | 17b14d677351a23a5ae8d9e0fb685c3b7c5fdf71be197baf59fc151c88b60e85 |
| scripts/theme-intent-upgrade-v3.mjs | 45f2c7455018d194b0ea422696c8aca0bb220d3153599e366b293d1d5fb1420a |
| scripts/upgrade-theme-intent-v3.ps1 | a03779953df5f5e52dc49d94bca443e87d3bf26f25527e249ef33c8f1fe0da0d |
| scripts/install-theme-intent-v3.ps1 | 2f5be01dbae942675d7b96467862bb648db23047efcf4a90e15f434b65190d3a |
| scripts/recover-theme-intent-v3.ps1 | 994b68dbc1f4da8f91279b8c36b1c8c8effd52c409148ccf4a0d648130587ae1 |
| scripts/theme-intent-upgrade-v3-mutex.ps1 | 7a1ddc016f776a001f8cf332bf85c4999298b073e72e756b7ff1e8d04f820a1f |
| packages/db/dist/migrations.js | 967a75ddf58a281a2abcbd4bf131bc14678e5063eb44ce8fa925da1a730726fd |
| scripts/run-theme-intent-v3-tests.mjs | f944bc0215412bdd39d17f45d93ba1426a4be1d1145125d2cb436f11d8e99fa5 |
| tests/theme-intent-upgrade-v3.test.mjs | a97bcdf8eaf054addff42c1750590a95c1438f39b924bc69c45ddb04d8c39d44 |
| tests/theme-intent-upgrade-v3-guards.test.mjs | 8c6bc7485d70dc6a4f618e53960a13d9d2bd2150ac3e054ce1e7b9e6c2c85e56 |
| tests/fixtures/theme-intent-v3-installer.ps1 | 5334d128f7683038fcaf49e51e965b96fbc3924af40d2d26e92461cb06b6fb65 |
| docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md | d7d42544346271f963d47f1364ade7e8a7ff10f5f5ff2b6f6b3bae77d2c47abf |
| tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/repair-receipt.json | c9c9fe196950e7bd65207f3a87b9a34ae81e5862a3ddba1cd448e6c9bf2d3bbc |

The first seven rows plus the `pg` dependency closure are the 145 runtime bindings. Migration
29 only replaces the `entities_kind_check` constraint, so the table-hash preservation checks
at schema 29 are meaningful.

## Findings (most severe first)

No High or Medium findings.

### L1. `resume_phase` is not restricted to the documented set

`staleCheck()` only requires `a.resume_phase === req.phase`
(`scripts/theme-intent-upgrade-v3-core.mjs:687`). The CLI accepts a stale decision for
every phase (`scripts/theme-intent-upgrade-v3.mjs:196`, `:223`). The design document says
the field must be exactly `release`, `after`, `reconcile` or `recover`
(`docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md:52`).

- **Reproduced** (probe P4): after an external kill during `after`, a cleanup decision
  scoped to `admit` with `-Phase admit` stopped the owned cluster and retired the lease
  (`stale_release_receipts:1`), and then `admit` itself refused. No admission, installer
  or migration file changed.
- **Impact:** cleanup-only. Every effect still needs its own bound decision chain, and no
  effect repeated. But the decision format promises a narrower scope than the code
  enforces. `migrate` is the one undocumented phase where this matters (see L2).
- **Repair:** either whitelist the four phases in `staleCheck()`, or document `migrate`
  (and only it) as a further resume phase together with the L2 fix.

### L2. The `migrate` continuation runs the migration effect without the confirmation switch

The explicit switch is enforced for `install` and `recover` on both the outer and inner
paths (`scripts/theme-intent-upgrade-v3.mjs:69-80`, `install-theme-intent-v3.ps1:13`,
`recover-theme-intent-v3.ps1:11`). `-Phase migrate` (`:568`) can run `studio.mjs migrate`
without `install_and_migrate_approved`. This is reachable after a death between the
installer outcome (`:551`) and the migration intent (`:356`).

- **Executed:** `-Phase migrate` without the switch after a completed install was refused
  only because the effect had already happened (`switch_gate_message:false`), not by the
  switch gate.
- **Impact:** ceremony, not an authority bypass. The run is bound to the original approval
  through `admission.json` (`:171-179`) and to a successful bound installer outcome
  (`:335-351`). `migration-intent.json` (`wx`) still prevents repetition. This is the v2
  L-a residual on the third effect path.
- **Repair:** require `install_and_migrate_approved` for `migrate` too, and document the
  `migrate` resume after that death window.

### L3. The mutex name is session-local and path-spelling sensitive

The guard uses `Local\CreatorAgentUpgradeV3-<sha(resolve(home).toLowerCase())>`
(`core:618-619`). Two helpers in different Windows logon sessions (for example SSH and
console), or the same home spelled with an 8.3 short name, get different mutexes.

- **Impact:** low. The hard-link lease (`core:586-615`) is still exclusive across sessions.
  The residual is a narrow race where one `release` could retire a fresh lease that
  another session's helper published between `staleCheck()` and `rename()`
  (`core:717-738`). This needs two concurrent owner-run helpers in different sessions.
- **Repair:** use `Global\` (or a per-user name) and canonicalize with `realpath` before
  hashing.

### L4. A post-migration death during the migration child stays rollback-only for acceptance

`reconcile` can record `forward_state_verified:true` for observed schema 29 with the target
program (`scripts/theme-intent-upgrade-v3.mjs:570-607`). `after` still requires
`migration-result.json` (`:426`). This is a deliberate refusal to forge child success, and
the document says so. A Ctrl+C in the console normally also kills the child mid-
transaction, which leaves schema 28. Informational. No repair required. If wanted, a
separately bound owner acceptance of a reconciliation receipt could close it.

### L5. Evidence and runner details

- `run-theme-intent-v3-tests.mjs` writes into the v3 repair evidence directory (`:13-16`).
  It does not bind the Node version, and the label is not part of the run receipt (TAP
  file names carry it). The `wx` writes make overwrite impossible.
- A desktop relaunch during a phase makes even a successful body report failure, and keeps
  the lease (probe P3: `prepared.json` written, CLI exit non-zero, lease retained). This is
  conservative and correct, but the owner then needs a cleanup decision.
- An abandoned `theme-intent-v3.lock.<uuid>.tmp` can remain in the studio home if the
  process dies between `open` and `link` (`core:597-608`). It is harmless.

## Status of the v2 findings and the review contract

| Item | Status | Evidence |
| --- | --- | --- |
| v2 M1 / contract 1: death during preparation | Resolved | `release` branch (`v3.mjs:104-128`) needs no `prepared.json`, credentials, Pool or SQL. The wrapper takes the `no_credentials` path and never reads DPAPI (`upgrade-theme-intent-v3.ps1:39-45`). P1: `taskkill /F` of the CLI after cluster start, then release with the DPAPI blob moved away. Exit 0, owned cluster stopped, lease retired into evidence, `credentials_read:false`. Suite tests 5–6 do the same with `process.exit`. |
| v2 M2 / contract 2: post-migration and verification death | Resolved | `after`/`reconcile` with a stale decision release first, then take a new lease (`v3.mjs:222-228`). P4: two external kills during `after`, then a resume with an `after`-scoped decision verified schema 29. Admission, installer intent and outcome, and migration intent and result hashes were unchanged. No recovery intent. Suite tests 12 and 20. |
| Contract 3: binding | Met (scope: L1) | The decision binds helper map, candidate, plan, fixture flag, owner text, session, home, data dir, evidence, config hash, context hash, lock hash, PID and token (`core:680-703`). A live PID is refused (`:705-712`, guard test). EPERM is rethrown, so it fails closed. Wrong lock hash, foreign tag (suite 5–6), untagged restart (P2) and a running desktop (P3) all refused with nothing stopped. |
| Contract 4: mutex and lease | Met (L3) | Guard polls owner PID and start time and releases on death or EOF (`mutex.ps1:14-21`). P1: after `taskkill /F`, a new guard acquired the mutex in 512 ms while the helper's PostgreSQL (with inherited handles) kept running. Abandoned-mutex handling is present. The lease is fsynced, then published with an exclusive hard link (`core:597-608`), and retained whenever cleanup is uncertain (`v3.mjs:801-807`). |
| Contract 5: cluster ownership | Met | Stop only when `pg_ctl status` is 0 and `postmaster.opts` carries the lease token (`core:431-434`, `:671-675`, `:723-735`). It quits first, and keeps the cluster and the lease when the desktop is back (P3). |
| Contract 6: confirmation gates | Met for install/recover (L2) | Outer and inner gates are present, and the guard tests pass. The exact owner decision files are still required (`v3.mjs:145-170`). |
| Contract 7: inherited protections | Sound | A normalized diff against v2 shows only the lease, guard, ownership and stale changes. Freshness, identity, preservation, rollback, redaction and quiescence code is unchanged and re-exercised by suite tests 3, 9, 14–24. |
| v2 L-b | Resolved | See contract 5. |
| v2 L-g | Resolved | Source-bound run receipts (below). |
| v2 L-h | Resolved | Atomic lease. |
| v2 L-c, L-d, L-e, L-f | Unchanged, documented limits | See below. |

## Checks executed in this review (Jordan's machine, October 24 2026)

None touched the operational configuration, credentials or database, the installed app, a
provider, workflows or the retired checkout. No real NSIS was run. No implementation file
was edited. Fixture homes were under ignored `.verification`, with synthetic SCRAM
credentials and real DPAPI. Evidence is in
`tracking/evidence/theme-intent-upgrade-helper-v3-review-2026-10-24/`.

1. **Hashes** (`verify-hashes.mjs`, `hash-verification.json`): 145 helper and 161 artifact
   hashes from the repair receipt matched, plus all 162 v2 artifact and 144 v2 helper
   hashes. 0 mismatches. `--bindings` re-emits exactly the receipt map.
2. **Historical run receipts:** `first-guards` and `first-e2e` exit 0, not timed out,
   `sources_unchanged:true`, TAP digests match, sources equal `first-sources-before.json`
   and the current files. TAP shows 8/8 and 25/25 (24 subtests plus the parent), 0 fail,
   skip, todo or cancelled.
3. `--check` exit 0. PowerShell 5.1.26100 parse of the five PS files: 0 errors.
4. **Bound suite rerun** with the new label `independent-review-20261024` (written by the
   runner beside the repair evidence, nothing overwritten): guards **8/8**, e2e **25/25**
   (803 s), exit 0, sources unchanged. TAP digests are `658d79ef…` (guards) and
   `9c309f4c…` (e2e). No listener in 55450–55499 afterwards.
5. **Independent probe** `probe-external-kill.mjs` on port 55463 (run 2 is the result;
   run 1 is retained, and its P4 kill raced a completed `after`). It ran P1–P4 as
   described above. The probe stopped its own untagged cluster. Afterwards nothing was
   listening and no helper, probe or fake-desktop process remained.

## Remaining limitations (not demonstrated by any fixture)

- **Host executable trust:** `node` from PATH, the configured `pg_bin`, PowerShell, taskkill
  and CIM are trusted. The JavaScript closure is bound.
- **Desktop coordination:** the desktop does not take the helper mutex. Quit is verified
  only at checkpoints, and a relaunch between checkpoints (for example during the migration
  child) is not prevented. The owner must keep the desktop and workers fully quit.
- **Interrupt specifics:** a real Ctrl+C or a closed console window (console-group signal
  delivery to the guard, the child and PostgreSQL) was not executed. `taskkill /F` and
  `process.exit` were.
- **Real NSIS:** target and predecessor installers and their exit codes were not executed.
- **Registry and shortcuts:** `/NS` skips shortcut creation. Replay does not restore
  missing or custom shortcuts.
- **Native UI acceptance:** not done.
- **Operational schema-29 installation:** not done, and operational-scale timing within the
  15-minute admission window is unverified.
- **Tracked evidence:** it can hold product and vault file names and hashes (v2 L-f).

## Next eligible step

No further repair is required before operational preparation. L1 and L2 are recommended
for any later helper revision (which would need a new exact review). The next step is an
owner-approved, separately authorized operational `before` with these exact bytes. A new
exact owner install/migration decision, installation, native acceptance and C54 completion
each remain later, separately authorized steps. This review created only this report and
its evidence directory, plus the runner's new labeled files. Tracking files were not edited.
