# Theme-intent upgrade helper v4: independent review, October 24 2026

**Verdict: supported for the exact v4 helper bytes. No further repair is required before a
separately owner-authorized operational `before`.** The repair makes every PostgreSQL path
use the desktop's real nested cluster (`home/postgres/data`). It adds a layout gate that
fails before DPAPI, and changes nothing else. Three new Low findings and the five deferred v3
Low findings remain. None of them grants authority, repeats an effect, adopts or moves data,
or strands the owner. The retained first-run `EPERM` is a host-level transient that this
review reproduced. The helper fails closed on it, and a second, separately approved recovery
completes from the state it leaves (L1).

A `theme-intent-upgrade-independent-review/4` receipt with status `supported_exact_helper`
and the complete 145-entry `helper_sha256` map is in
`tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24/reviewer-receipt.json`.
It was validated with the helper's own `reviewCheck(path, false)`. That call reads only the
receipt and the bound repository files, not operational state.

This review is not owner authorization. It does not authorize operational `before`,
installation, migration, recovery or stale-state release. A retry of `before` needs a new
session id and evidence directory and a current, exact owner decision.

Reviewer: separate U02 model reviewer on Jordan's machine. This session did not implement
v1–v4, the package or the feature, so `prior_implementation_involvement:false` is accurate.
It is the same model family as the implementer. It is not blinded and it is not human acceptance.

## Reviewed identities

Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`, plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`. `--check` exited 0:
the package, plan, package-review receipt, both installers and the extracted payload all
re-verified.

| File | SHA-256 |
| --- | --- |
| scripts/theme-intent-upgrade-v4-core.mjs | bd2e0105d1e5afbc284c32ebc05ad3464917ff5d83624db4a4b2650485e123c7 |
| scripts/theme-intent-upgrade-v4.mjs | 9d0d32dd9547556b866a68365f303883a066534404369984a53036c6a4700bca |
| scripts/upgrade-theme-intent-v4.ps1 | ec59d95d0f73070a7c946f24f933cde9e9d6c420d5965e9b64ea767a353982c9 |
| scripts/install-theme-intent-v4.ps1 | d707f87a0ea73612c6c676cd84eea2b6d8a3f514ba2ba28752a2afb4283f48de |
| scripts/recover-theme-intent-v4.ps1 | ff85569fde0c13afb8e8c5db623028304523f2c388f7e777640c6a58c2c55300 |
| scripts/theme-intent-upgrade-v4-mutex.ps1 | 7a1ddc016f776a001f8cf332bf85c4999298b073e72e756b7ff1e8d04f820a1f |
| packages/db/dist/migrations.js | 967a75ddf58a281a2abcbd4bf131bc14678e5063eb44ce8fa925da1a730726fd |
| scripts/run-theme-intent-v4-tests.mjs | 953109f7837608677fd50fe4f643cf853cdda5266cb817e18e36443a209052f6 |
| tests/theme-intent-upgrade-v4.test.mjs | 0a7314e8a9078a967aa616ec5eafbbb4490bd0bd8662fdb3cd8021f6a592da0c |
| tests/theme-intent-upgrade-v4-guards.test.mjs | ec0b8399fc070206e8cb24b9bd6d738961ea18608bf0aec541eb9e08c4777cb9 |
| tests/fixtures/theme-intent-v4-installer.ps1 | 5334d128f7683038fcaf49e51e965b96fbc3924af40d2d26e92461cb06b6fb65 |
| docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md | 362827ab3846d43c65af3b13082966556b81c59ddd0ecc9d07fe29c4d68f25dc |
| tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/repair-receipt.json | d08df8225de5a5300c572208b19bc5afcbd1e660b90300587000ca106574ec11 |
| apps/desktop/src-tauri/src/home.rs | a8bc8f23a4703b907a9dfde34e22c8f9fd4c18d2a25e9387004bde067875223b |
| apps/desktop/src-tauri/src/postgres.rs | 109615f43ac15fb8b7959844e09b6682c9f234e8b57b37456dd978386963b88b |
| apps/desktop/src-tauri/src/studio.rs | 31b0dac592aa42bcdfc43cbc75f663ff63d3e965aef36a285242b381e1f09fa7 |
| apps/desktop/src-tauri/src/main.rs | 33d629aa52b6b219e179514652903b9740cd1e91051a4157465eb813afa0246c |

The first seven rows plus the `pg` dependency closure are the 145 runtime bindings. The
non-script bindings (`migrations.js` and the whole `pg` closure) are identical to v3's.

## Review contract

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Native layout fidelity | Met | `Home::pg_data` is `root/postgres/data` (`home.rs:120-122`). It has been unchanged since it was added in `efe6627` (2026-10-20; `git log -L`), before the predecessor package. Every desktop `Cluster` takes `data: self.home.pg_data()` (`studio.rs:394`, `:975`), and `pg_ctl`/`initdb` use `-D self.data` (`postgres.rs:115-117`, `:141`, `:163`, `:189`). `exists()` keys on `data/PG_VERSION` (`postgres.rs:96-98`). The home root is `CREATOR_STUDIO_HOME`, or `%LOCALAPPDATA%\com.creatoragent.studio` (`main.rs:155-163`), which matches the plan's `studio_home`. The failed operational attempt independently observed version 18 at `postgres/data` (`attempt-result.json`, historical). |
| 2 | Path coverage | Met | A normalized diff against frozen v3 (version strings mapped) differs only in `dataPath`/`verifyDataLayout` (`core:382-394`), `managed` (`core:396`), `ownedCluster` (`core:684`), the stale `data_dir` binding (`core:701`), `releaseStale` (`core:730`) and the CLI gate (`v4.mjs:92`). Coordinated recovery runs inside `managed()`, so it uses the same nested cluster. No other `postgres` path exists in v4 (grep). The four PS files are byte-identical to v3 after the `v3→v4` mapping. |
| 3 | Pre-secret failure | Met | The gate runs after the package, layout, review, quit and path checks and the config read. It runs before the presecret exit and the wrapper's `ReadAllBytes`/`Unprotect` (`v4.mjs:83-92`, `upgrade-theme-intent-v4.ps1:35-49`). Probe P1 (below) used the real wrapper with a valid synthetic config. It refused 7 bad layouts before DPAPI, and a valid-layout control reached `Unprotect`. |
| 4 | No unsafe additions | Met | No discovery, flat fallback, adoption, relocation, `initdb` or operational write was added (diff). `verifyDataLayout` only `lstat`s and reads `PG_VERSION`. |
| 5 | Inherited protections | Intact | The diff shows the candidate/predecessor checks, review, owner decisions, quiescence, snapshot, backup verification, preservation, freshness, effect `wx` files and rollback code are unchanged from v3. The bound rerun re-exercised them. |
| 6 | Version isolation | Met (L2) | Review, decision, prepared, backup and admission formats are all `/4`. The lease is `theme-intent-v4.lock`, the backup prefix is `theme-intent-v4-` and the mutex is `…UpgradeV4-`. No stale `/3`, `v3` or `V3` string remains (grep). v4 can neither read nor retire an older lease. It also does not refuse when one exists (L2). |
| 7 | Fixture coverage | Met | The e2e suite runs `initdb` at a literal `home/postgres/data` (test `:354-363`). `ctl()` and the stale `data_dir` are spelled independently of `dataPath` (`:44-61`, `:266`). The suite exercises: populated `before`; two interrupted-preparation deaths with nested-`postmaster.opts` ownership refusal and release without DPAPI; forward schema-29 install/verify; `after`-death resume; populated coordinated schema-28 recovery; six crash windows; three child failures; and interrupted protected recovery. |

## Findings (most severe first)

No High or Medium findings.

### L1. Transient directory-rename refusals can stop coordinated recovery midway; recoverable, undocumented

Recovery performs plain directory renames right after fresh writes:
`rename(l.install, quarantine)` (`scripts/theme-intent-upgrade-v4.mjs:723`),
`rename(l.install, generated)` right after the predecessor installer (`:735`),
`rename(replacement, l.install)` (`:736`) and the protected-directory moves (`:739`). The
retained first-run failure is `:735` (`first-e2e.tap:224-226`). It happened in the second
recovery of the interrupted-protected-recovery scenario (test `:866-869`).

- **Reproduced, host-level:** probe P3 repeated the shape "mkdir, fresh payload copy,
  immediate rename" with no handle held by the probe. With `node:fs.cp`, 3 of 20 first
  attempts were refused with `EPERM`, and each one succeeded within 65 ms. With the
  PowerShell fixture installer, 0 of 20 were refused. Windows Defender real-time protection
  reports enabled on this host. That is context only. No process was identified as holding
  a handle, so no cause is attributed.
- **Failure handling, reproduced deterministically:** probe P2 had a test-owned process
  hold one copied file open during the `:735` rename. That produced the identical
  `EPERM … rename … .theme-intent-installer-<id>` at `v4.mjs:735`. The helper stopped with
  "Helper stopped; preserve intents/evidence". It stopped its owned cluster and released its
  lease, with no `phase-left-owned-lock` marker. `studio.json` and `secrets` were unchanged.
  The quarantined directory held the exact target program. The verified replacement was
  kept. The install directory held predecessor-installer output, and one restored database
  was left unused. A second recovery with a new approved `decision_id` then succeeded from
  that state. It restored schema 28 with the seeded entity, verified the predecessor
  program, put the secrets back, and pointed the config at the restored database. Nothing
  was left listening and no lease remained.
- **Impact:** low. The behavior is conservative: it fails closed, repeats no effect, loses no
  data, and is recoverable. But until a second owner-approved recovery runs, the studio is
  unusable: the predecessor program runs against the original (possibly schema-29) database.
  In the protected-move variant, `secrets` is missing as well. The v4 document calls the
  cause unconfirmed but does not describe this state or how to resume. It never affects
  `before`, which performs no directory rename. The likelihood after a real NSIS predecessor
  install is unmeasured.
- **Repair (later revision or runbook):** document that any recovery failure is resumed with
  a new exact recovery decision, and list the leftover siblings it leaves. Optionally add a
  bounded filesystem-only retry (for example up to 2 s on `EPERM`/`EACCES`/`EBUSY`) for these
  directory renames. That is a different thing from retrying an effect.

### L2. v4 ignores older-version leases and mutexes on the same studio home

v4 checks only `theme-intent-v4.lock` (`core:598`, `:689`) and `Local\CreatorAgentUpgradeV4-…`
(`core:629-630`). An interrupted v2 or v3 run's `theme-intent-v2.lock`/`theme-intent-v3.lock`
(`v2-core:577`, `v3-core:587`) does not stop a v4 run, and a v3 and a v4 helper could run
at the same time.

- **Impact:** low. v4 cannot consume or retire older authority, and its own preconditions
  still refuse most foreign partial states: a running cluster (`core:401-405`), a schema
  other than 28, or a non-predecessor program. `attempt-result.json` records
  `lease_remaining:false` for the only operational v3 attempt.
- **Repair:** refuse `before` when any `theme-intent*.lock` other than the v4 lease exists,
  and require an explicit owner cleanup decision for it under that version's helper.

### L3. The real-wrapper layout regression asserts the reached check loosely

`assert.match(r.stderr, /postgres.*data/s)` (`tests/theme-intent-upgrade-v4.test.mjs:423`)
matches any later `data` after any `postgres`. It does not pin the `verifyDataLayout`
`ENOENT` on `postgres\data`. Probe P1 independently confirmed the exact error, so coverage
holds. **Repair:** match the `lstat` path or the gate message.

### Deferred v3 findings

v3 L1 (unrestricted `resume_phase`), L2 (`migrate` continuation without the switch), L3
(`Local\` and path-spelled mutex), L4 (death in the migration child is rollback-only) and L5
(runner and evidence details) are present unchanged at the corresponding v4 lines. The
layout repair does not interact with any of them, so none becomes a blocker. They are still
recommended for a later revision.

## Retained first-run failures

- **Layout regression setup:** the first TAP shows the new test failing at the `studio.json`
  read (`first-e2e.tap:17-21`, `v4.mjs:86`). That is before the layout gate. The first and
  verified run receipts differ only in `tests/theme-intent-upgrade-v4.test.mjs`. All 145
  runtime bindings are equal between them, so only the test changed. The current test writes
  `studio.json` before the subtests (`:406`).
- **Recovery `EPERM`:** see L1. It is reproducible as a host transient, and the helper
  handles it conservatively. It is now documented by this review. It was neither caused nor
  masked by runtime changes.

## Checks executed in this review (Jordan's machine, October 24 2026)

None of these touched the operational configuration, credentials, database or backups, the
installed app, a provider, workflows or the retired checkout. No NSIS was run and no
implementation file was edited. Fixture roots were under ignored `.verification`, with
synthetic SCRAM and real CurrentUser DPAPI. Evidence is in
`tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24/`. Node is v22.21.0.

1. **Hashes** (`verify-hashes.mjs` → `hash-verification.json`): all of these matched with 0
   mismatches: the 145 v4 helper and 168 v4 artifact hashes, the 161 v3 and 162 v2 artifact
   hashes, the 145 v3 and 144 v2 helper hashes, and the 22 v3-review artifact hashes. The
   helper map is a subset of the artifact map. `--bindings` re-emits exactly the receipt
   map, in the same key order.
2. `--check` exit 0. A PowerShell 5.1.26100 parse of the five PS files found 0 errors.
3. **Bound rerun** `node scripts/run-theme-intent-v4-tests.mjs independent-review-v4-20261024`:
   guards **11/11**, e2e **26/26** (25 scenarios plus the parent, 573 s), with 0
   fail/skip/todo/cancelled, exit 0, no timeout and sources unchanged. TAP digests are
   `c111bdaa…c23cd` (guards) and `be4dddad…50573` (e2e). Run receipts are `7728bdcd…5149`
   and `a43216e3…4628`. All 19 observations were recorded, with `listening_after:false`.
   The runner's fixture root `.verification/theme-helper-v4-1792841376266` is retained, as
   in prior runs.
4. **P1 pre-secret layout** (`probe-presecret-layout.*`): the real wrapper ran with a valid
   synthetic config and a non-DPAPI blob. Each of these was refused with "Pre-secret …
   failed": missing nested data with a valid flat `PG_VERSION`; `PG_VERSION` 17; a missing
   `PG_VERSION`; `data` as a file; `data` as a junction; `postgres` as a junction; and a
   `release` with missing nested data, which was refused before the decision was parsed.
   None reached `ReadAllBytes`/`Unprotect`, and none created evidence, a lease or a backup.
   Port 55456 never listened. The control (valid nested layout) passed the gate and failed
   only at `Unprotect`. The root was removed.
5. **P2 recovery rename refusal** (`probe-recovery-rename-refusal.*`, port 55457): a full
   fixture before/admit/install (schema 29), then the induced `:735` refusal, then a second
   recovery. The results are under L1. Nothing was listening afterwards, and the root was
   removed.
6. **P3 copy/rename race** (`probe-copy-rename-race.*`): see L1. The root was removed.
7. Afterwards there was no listener on 55450–55499 and no probe process. Unrelated
   PostgreSQL services were left untouched.

Inspected historical evidence (not re-executed): the `first-*` and `verified-*` run receipts
and TAP files (exit 0/0 verified; first e2e exit 1 with 23/26), `first-failure-analysis.json`,
`layout-review-inputs.json`, `test-observations.json`, and the operational
`attempt-result.json`.

## Remaining limitations

- Real NSIS, registry and shortcut behavior, and installed UI acceptance are unverified.
  `/NS` skips shortcut creation.
- Host executables (node on PATH, `pg_bin`, PowerShell, taskkill, CIM) are trusted. The
  desktop does not take the helper mutex and must stay fully quit.
- Operational-scale timing inside the 15-minute freshness window is unverified.
- A `CREATOR_STUDIO_HOME` override would move the desktop home away from the plan's
  `studio_home`. The failed attempt observed the plan home's nested cluster.
- No fresh operational backup exists from the failed v3 attempt.
- Full C54 remains partial.

## Next eligible step

No further repair is required. Operational `before` is eligible with these exact v4 bytes,
subject to a new, valid owner authorization that names a new session and evidence directory.
L1 (documenting the recovery-failure resume) is recommended before any operational recovery
is attempted. Installation and migration, native acceptance and C54 completion each remain
separate, later authorized steps. This review created only this report and its evidence
directory, plus the runner's new labeled files. Tracking files were not edited.
