# Exact checklist v4 / observation proposal v2 independent review — October 24, 2026

Verdict: **supported design for the accepted M3 decision and the planned UI
observations; partial for the PR-01/SH-01 inspector contract; blocked for
execution.** Four separate answers:

| Question | Answer |
| --- | --- |
| Checklist v4 planned observations (A0, NI-00–NI-10, final Quit, ledger, retention) | **Supported** as design, with low clarity gaps (L-A, L-D, L-E) |
| Inspector contract ready for a bounded implementation | **Partial**: implementable as a fixture-tested reader once S1–S4 below are written into the implementation scope; concrete operational values stay pending inputs |
| An actual inspector exists | **No** (repository inventory found none; none was implemented here) |
| Operational/native execution executable | **No**: database port, pg_bin/pg_ctl identity, active-home and continuity attestations, workspace ID/current owner-editor role, inspector implementation + review and a concrete session scope are all missing |

This review grants no owner authority, no inspection or session scope, is not a
native pass, is not Jordan's human acceptance (H) and does not complete C54.
Full C54 remains partial.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review on Jordan's request
on 2026-10-24, reading `C:\dev\creator_agent` through the approved device folder.
This thread did **not** prepare checklist v4, proposal v2 or the scheduling decision
(Codex prepared them; the v4 revision receipt records `independent_review:false`
for its author). This thread also did not prepare v3, the first proposal, the
package or any helper.

Disclosures: a different Claude thread wrote the exact-v3 review (M1–M5, L1–L6)
whose findings v4 answers; other Claude threads reviewed v1 and helpers v2–v4. This
thread has none of their conversation context, but the same model family reviewed
earlier inputs and this review assesses responses to a Claude review. It is a
separate-session review, **not blinded** and not a different-model-family review.
Prior v3 review involvement is a disclosure, not authorship of v4.

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| Candidate (bound) | `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc` |
| Installation plan (bound) | `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1` |
| Checklist v4 | `a7a79ec4a03320620f403306179e80bf142e131bcef63a9c7af1fdaccd1244a3` |
| Observation proposal v2 | `f9b42bf6eed459af459c3726fd24a225c4e18a76dc9e4e85f602753f414cb520` |
| Scheduling decision (THEME-ACCEPTANCE-M3-2026-10-24) | `24a82ca8a2b1eddf82e5c4e472b99103b05c6686a4818813aef847854ff0f42b` |
| v4 revision receipt | `6de18ddd876f2ccb0d73438565322d6ffdd9e5433e9c5cc7b41b5ca6469b2f27` |
| v4 verify.mjs | `8cb53e168bd4ac1ec68a865582b1f9f8dae18f9b68d310ff4d92bfd7e440bc59` |
| Exact-v3 review report | `14757607db078f60bdfd6f8dbef6972b94ccb3f9df3d46e850d2a6d1c8cfbfcd` |
| Exact-v3 reviewer receipt | `0f10922396c3c440da84bd63992d84a5273b5c64573f2207bf4177bc6b4794c5` |
| Reviewed bundle studio.mjs | `9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88` |
| Reviewed bundle manifest (= installed manifest) | `5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6` |

The checklist, proposal and decision hashes equal the v4 revision receipt's
`input_sha256` values. The full input map is in
`tracking/evidence/theme-intent-acceptance-v4-review-2026-10-24/reviewer-receipt.json`.

## Checks actually executed (repository-only, read-only)

- Independently rehashed all 636 entries of the v4 revision receipt's
  `input_sha256`: 636 match, 0 mismatched, 0 missing.
- Ran the exact v4 `verify.mjs` bytes with **no arguments** (check-only), never
  `--record`. Because the script hard-codes `C:/dev/creator_agent`, it was run from
  the device's Linux shell in a scratch directory where that relative path is a
  symlink to the mounted repository; no script byte was changed. Output:
  `mode: check_only_no_writes`, 807 bindings checked, 0 mismatches, exit 0. The
  receipt's mtime, size and SHA-256 and the directory listing were identical before
  and after. No older receipt-writing verifier was run.
- Source inspection with the locators below. Paths embedded in receipts (installed
  program, studio home) were read as data and not followed.
- Not done: application launch/sign-in, helper/installer/migration, SQL, credential
  or DPAPI access, `studio.json` read, registry/shortcut/process/port/mutex
  inspection, provider calls, workflow activation, acceptance records, recovery,
  cleanup, retired checkout access, test runs.

## Assessment of the v3 findings

### 1. M3/B1: scoped evidentiary decision — supported as faithfully implemented

The decision document, v4 (lines 79–85, 208–220) and proposal v2 (lines 8–26) say
the same thing: for this narrow UI-only session only, a fresh installed identity
matching the reviewed `studio.mjs` may satisfy the scheduler-**configuration** gate;
it is reported as "configuration fixed off by reviewed bytes, never observed live
scheduler state"; the worker remains on; continuity, A0 and the UI-only limits stay;
no inspection, launch or session authority follows; no startup-admission candidate
was selected. None of the three documents revives the old live-observation
requirement or claims prevention or zero dispatch.

Static bundle behavior re-verified on the reviewed bytes
(`.verification/theme-intent-artifacts-2026-10-23/studio/service/app/dist/studio.mjs`,
hash `9d5ddac3…`):

- `CREATOR_PORTFOLIO_SCHEDULER` occurs exactly twice in the bundle, both in
  `createApi`: `env.CREATOR_PORTFOLIO_SCHEDULER ?? "off"` (54654) and its validation
  (54655). `portfolio?.start()` runs only when that value is `"on"` (54730).
- There is one `createApi(` call (55713). Its argument is an object literal with
  database URL, products root, auth mode, login code, `CREATOR_DESKTOP_MANAGED`, plan
  vault dir and optional worker distro, and no scheduler key (55713–55721).
  `createApi` reads only its `env` parameter for this value.
- The worker is separate: `env.CREATOR_WORKER ?? "on"` (54685) and `worker?.start()`
  in `init()` (54695–54730; start at 54729), after actor ensures, broker/retrieval
  sweeps and outbox drain (54698–54728). This confirms the decision's "worker remains on".

Installed-match chain (historical): the installation completion receipt binds
`installed_manifest_sha256 = 5b38b43e…`; that manifest lists
`service/app/dist/studio.mjs` = `9d5ddac3…` (2,149,551 bytes); and the reviewed v4
helper hashed every one of the 71 installed files against that manifest at install
(`theme-intent-upgrade-v4-core.mjs:121-136`). So the bundle identity was confirmed
at 12:34Z. The **fresh** installed match the decision requires is still pending
PR-01, and v4 correctly makes a missing or mismatched identity a stop.

What the evidence establishes: for those exact bytes, nothing can turn the portfolio
scheduler on at startup. It does not establish live state, absence of worker
dispatch, continuity since 12:35:23Z, or that the installed file is unchanged now.
v4 and the decision say each of these. **Verdict: supported.**

### 2. M4: binding sources — partial (design reviewable; concrete values pending)

Supported: the correction that `installation-plan.json` names `studio_home`
(`C:/Users/jorda/AppData/Local/com.creatoragent.studio`) and `target_install_dir`.
The v3 review's "no repository receipt names a home root" was too broad. Also
supported: cluster = home + `postgres/data` (`home.rs:120-122`); studio ports from
`apps/api/src/studio.ts:32`; Run key/value from `winsys.rs:94-95`; lease names
`theme-intent-v{2,3,4}.lock` (`v2-core:577`, `v3-core:587`, `v4-core:598`).
Database port and pg_bin/pg_ctl are kept PENDING and never filled from defaults or
receipts. That is correct.

Gaps:

- **M-A (Medium) — the active-home override is not named.** The desktop resolves its
  home from `CREATOR_STUDIO_HOME` when set and non-empty, otherwise
  `%LOCALAPPDATA%\com.creatoragent.studio` (`main.rs:155-164`). It does not come from
  `studio.json`. Cluster, leases, mutexes and the desktop instance key all derive
  from that home, so a wrong home makes every PR-01/SH-01 check look at an inactive
  tree and report a false "stopped". Proposal v2 asks Jordan only to "disclose
  override/uncertainty". *Smallest fix:* name `CREATOR_STUDIO_HOME` in the manifest
  attestation. Require Jordan to state that it is unset in his user and machine
  environment and in every launch path (Start menu, desktop shortcut, Run value),
  and that `LOCALAPPDATA` resolves to the plan's parent. If he can't state this, the
  field stays pending.
- **L-B (Low) — the runtime allowlist source is misnamed.** Proposal v2 says to bind
  the allowlist "from historical installed resource map", but the completion receipt
  holds only `installed_runtime_files: 71` (a count). The actual per-file source is
  the reviewed bundle manifest `5b38b43e…` (which contains `node/node.exe` and
  `service/app/dist/studio.mjs`), verified per file at install by `v4-core:121-136`.
  *Fix:* name that manifest and hash as the allowlist source.

Is the owner-supplied manifest implementable without `studio.json`, credentials or
wider access? **As a contract, yes.** The reader takes the manifest as input, and
nothing in PR-01/SH-01 needs a secret. **As concrete values, not reliably.** The
only authoritative source for the database port and pg_bin is the saved
configuration (`home.rs:9-35`: `database.port`, `pg_bin`). Per that schema
(`deny_unknown_fields`), the file holds no secret fields. A reliable owner value
therefore means someone reads that file. Jordan could read it himself and transcribe
the values, which is an owner action under his own authority. Its currentness can be
checked against the historical `studio_config_sha256 = fedcbce7…` recorded in run-01
`before.json` and `verification-…json`, but only by hashing the file, which is also
a read. If Jordan can't supply the values reliably that way, a field-limited reader
(emitting only `database.mode`, `database.port`, `pg_bin` and hash-equality to
`fedcbce7…`) **would require its own separately selected and reviewed scope**.
Proposal v2 says this (lines 55–58). It is not introduced or granted here.

Design note (optional, not required): the port is used only for listener checks.
Attributing listeners by owning scoped process image instead of by port would remove
one pending field. pg_bin would still be needed for `pg_ctl status`.

### 3. M5: launch-at-login — supported, with one implementation constraint

PR-01 now reads only the existence of `HKCU\…\Run` value `Creator Agent Studio`. It
reads no command text and makes no write. It treats access denied as unavailable,
not absent. If the value is present, every Windows sign-in since the historical
shutdown is a possible quiet launch to reconcile. Current absence does not prove
historical absence, and unknown intervals block A0. These match `winsys.rs:94-140`
and `studio.rs:193`, `:456`. The rule is correctly conservative: a quiet run ended
by sign-out or shutdown leaves no running process, so a current stopped observation
cannot detect it, and only attestation covers it.

- **L-C (Low) — don't copy the app's own presence semantics.**
  `launch_at_login_present()` returns `RegGetValueW(..., RRF_RT_REG_SZ, ...).is_ok()`
  (`winsys.rs:126-140`). That treats access-denied and wrong-type values as absent.
  *Fix:* the inspector must query existence without a type restriction. It must map
  only `ERROR_FILE_NOT_FOUND` to absent, any other value type to present, and every
  other error to unavailable.

### 4. L1/L4: Quit and window closing — supported

v4 allows a planned Quit only from a recorded running state
(`running()` = phase `running`, `studio.rs:225-226`). It treats accidental or
startup Quit as an incident that needs SH-01 and reconciliation. It says the control
window hides when running and Quits otherwise (`main.rs:52-67`, verified). It says
the studio window backgrounds or Quits per saved `close_behavior` (`main.rs:117-135`,
verified) and that this preference must not change. It infers nothing from a visible
stopped state or exit success. This matches `quit()` (`studio.rs:866-893`): stopping
status, stop child, `pg_ctl` stop with errors only noted, then `app.exit(0)`.

- **L-D (Low):** `close_behavior` is unknown (it lives in `studio.json`). Closing
  the studio window can therefore be a Quit. *Fix:* add one tester instruction: do
  not close either window during the session; use only tray or menu Quit.

### 5. L2: leases and mutexes — supported, with one omission

All of v2–v4 leases are named. The V3/V4 mutexes are derived as
`'Local\\CreatorAgentUpgradeV{3,4}-' + sha(resolve(home).toLowerCase())` (full
64-hex, `v3-core:619`, `v4-core:630`, verified). No v2 mutex exists (grep confirmed)
and none is invented. The v1 helper's `installation.lock` and `migration.lock` sit
in its evidence directory, not the home (`upgrade-theme-intent.mjs:194`, `:209`), so
leaving them out is correct. Unavailable semantics, observation without acquisition
or creation, and the Local-namespace/current-session limit with owner attestation
are stated.

- **L-E (Low) — the desktop single-instance objects are omitted.** The desktop
  holds `Local\CreatorAgentStudio-<key>` and `Local\CreatorAgentStudioShow-<key>`
  while running, where key = first 16 hex of
  `sha256(root.to_string_lossy().to_lowercase())` with no `resolve()`
  (`home.rs:124-128`, `winsys.rs:41-60`, `main.rs:495`). This is a direct,
  non-acquiring "desktop alive" signal for PR-01/SH-01. *Fix:* add it to the mutex
  list with its exact derivation.
- **S-note (implementation constraint):** the helpers' mutex scripts use
  `New-Object Threading.Mutex($false,$Name)`, which **creates** the object
  (`theme-intent-upgrade-v{3,4}-mutex.ps1:5`). The inspector must use an open-only
  call (`OpenMutexW` with `SYNCHRONIZE`, or `Mutex.TryOpenExisting`), close the
  handle at once, and map not-found to absent, access-denied to unavailable.

### 6. L3: SH-01 bound and later re-observation — supported

90 s from the Quit request, at most 1 Hz, two stopped samples ≥1 s apart. Each needs
valid `pg_ctl` status 3 and no scoped listener, process, lease or mutex. Native 20 s
and 60 s grace periods are context only. There is no second Quit, kill, recovery or
deadline extension. Timeout, contradiction or inaccessibility means unknown. A later
read-only re-observation needs a new scoped decision and directory. It preserves the
initial unknown, never passes the original case retroactively, and grants no launch.
A restart invalidates earlier stopped evidence. This answers v3-L3 without
improvisation. It is consistent with `postgres.rs` stop timing (stop can finish after
the deadline).

### 7. L5/L6: integration and check-only verification — supported, two residuals

- L6 resolved: the only write path is `--record` with `{flag:'wx'}` (exclusive
  create, so it cannot replace an existing receipt). The default path compares and
  prints. Executed evidence above confirms no write. The two mutable tracking files
  are skipped explicitly, and `mutable_tracking_preupdate_hashes_excluded: true` is
  recorded. They are not treated as matches. Exactly 2 entries are skipped, both from
  the exact-v3 reviewer receipt.
- **L-F (Low):** the receipt records only a boolean, not the excluded paths. *Fix:*
  list `tracking/BUILD_STATUS.md` and `tracking/SESSION_HANDOFF.md` with their
  recorded pre-update hashes in the next receipt.
- L5 mostly resolved: historical installation is folded into the body (lines 22–28),
  and the exact-bundle paragraph is in the body (79–85). **L-G (Low):** line 208
  reads "Historical v2 prerequisite wording retained below is superseded by the v3
  reconciliation. ## V4 observation gates…". No v2 wording follows, and the heading
  is glued to the sentence, so it does not render as a heading. *Fix:* delete the
  sentence and put the heading on its own line.

### 8. A0, NI cases and session limits

- **A0 historical preservation: supported.** Receipts rehash. The reviewed helper's
  successful `after` asserts zero non-terminal plan requests, workflows, tasks,
  in-flight or unknown reservations, retrievals, batches and desktop jobs
  (`v4-core:520-532`).
- **L-A (Low):** v4 line 70 ("A0 must establish no eligible non-terminal
  workflows/tasks … at the pre-launch observation") can be read as asking for a fresh
  observation that the plan forbids (no SQL). *Fix:* say this is the historical
  helper assertion at 12:34:49Z plus continuity attestation, and that PR-01 does not
  refresh it.
- **A0 continuity to first launch: blocked** (attestation, Run value, active home,
  fresh identity all pending).
- NI-00, NI-04, final Quit + SH-01: supported design; blocked on SH-01/PR-01
  implementation and scope.
- NI-01: partial. Existing workspace ID and current owner/editor role are pending
  Jordan. The plan allows only local desktop sign-in and stops for provider or plan
  sign-in.
- NI-02, NI-03, NI-05 to NI-09: supported design, carried from the exact-v2 review.
  Their UI source inputs are within the 636 rehashed bindings. UI logic was not
  re-derived here.
- NI-10: partial by design. UI-only, with whole-database equality, raw hashes and
  exhaustive zero dispatch expressly unverified.
- Bounded local auth and launch count (initial launch, one NI-04 relaunch, final
  Quit): supported design; decision pending.
- A v1→v2 / B v1 retained by default; no archive or delete path: supported.
- R-01/R-02: unverified; separate scope supported. H: unverified; Jordan's own dated
  statement only.

## Per-gate verdicts

| Gate | Verdict |
| --- | --- |
| M3 scheduling-configuration decision implementation | Supported (static bytes verified; fresh match pending) |
| A0 historical schema29 preservation | Supported (historical) |
| A0 continuity to first launch | Blocked (attestations, Run value, active home, fresh identity) |
| I-01 | Supported, historical |
| R-01/R-02 | Unverified; separate scope |
| PR-01 contract | Partial (M-A, L-B, L-C, L-E; port/pg_bin pending) |
| SH-01 contract | Supported design; partial until M-A/L-E folded in; not implemented |
| NI-00 | Supported design; blocked |
| NI-01 | Partial (workspace/role pending) |
| NI-02, NI-03, NI-05–NI-09 | Supported design (carried) |
| NI-04 | Supported design; blocked on SH-01 |
| NI-10 | Partial by design |
| Final Quit + SH-01 | Supported design; blocked |
| Local auth/launch count | Supported design; decision pending |
| Retention A v1–2 / B v1 | Supported |
| v4 check-only verifier | Supported (no writes observed) |
| H | Unverified |
| Full C54 | Partial |

## Prioritized smallest fixes (for a v5/proposal v3 or the implementation scope)

1. **S1 (M-A):** name `CREATOR_STUDIO_HOME` and the `%LOCALAPPDATA%` derivation in the
   active-home attestation.
2. **S2 (L-E):** add the desktop `Local\CreatorAgentStudio-<key16>` and `…Show-<key16>`
   objects with their exact Rust derivation.
3. **S3 (L-C, S-note):** specify open-only mutex calls and type-agnostic Run-value
   existence with not-found/denied/other mapping.
4. **S4 (L-B):** name bundle manifest `5b38b43e…` as the runtime allowlist source.
5. L-A, L-D, L-F, L-G wording/receipt fixes.

S1–S4 can be written into a bounded implementation scope without another owner
choice between scheduling options.

## Limitations

No operational observation was made, so current installed identity, active home,
cluster, listeners, processes, leases, mutexes and the Run value are unknown.
Native behavior claims come from repository source, not executed binaries, and
`studio.rs` is outside the candidate source map. UI-case verdicts are carried. The
bundle and manifest were verified in the repository `.verification` copy, not the
installed copy.

## Precise next eligible prompt

> Jordan decides whether to supply the nonsecret inspection-scope manifest values.
> These are: active-home attestation naming `CREATOR_STUDIO_HOME` unset and the
> `%LOCALAPPDATA%` derivation; database port; absolute pg_bin with pg_ctl.exe and
> postgres.exe hash/version provenance; existing workspace ID and current
> owner/editor role. Values must come from his own knowledge or his own reading.
> Otherwise he explicitly selects a separately scoped field-limited reader. Then,
> preserving v4, proposal v2, the decision and all receipts, prepare a bounded
> fixture-only PR-01/SH-01 inspector implementation that folds in S1–S4. It needs
> open-only mutex and type-agnostic Run-value checks, exclusive evidence directories,
> and negative tests for unavailable, denied, reparse-point, mismatch and timeout
> cases. Then commission a separate uninvolved review of that exact implementation.
> No operational read, launch, sign-in or acceptance session until that review
> passes and Jordan grants a concrete session scope.
