# Observation classifier and proposal v4.1 note independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **partial.** The pure classifier is correct on key admission, the native
join, open/Run mapping, strict count and attestation handling, spacing, binding,
staleness, deadlines and redaction, and I found no false-pass path for PR-01. Three
Medium findings stop it from fully implementing v4/v4.1: an attempted launch can be
downgraded from incident to unknown (M1), an SH-01 pass needs no recorded running
state or planned Quit (M2), and a contradictory SH-01 sample is treated as ordinary
shutdown activity and can be followed by a pass (M3). Four separate answers, none of
which implies another:

| Question | Answer |
| --- | --- |
| Classification-core support | **Partial.** Supported for the areas above; not supported as a complete v4/v4.1 classifier until M1–M3 are repaired. |
| v4.1 contract-note support | **Supported with Lows.** N6 disclosure matches winsys.rs:41-62; no-attempt and incident rules are right. L3 adds two omissions. |
| Operational collector exists | **No.** No collector, adapter or PR-01/SH-01 inspector exists; only the test imports the module. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, scope manifest, collector implementation and review, and a session decision are all pending. |

A fixture pass classifies injected data only. It is not observed shutdown, zero
dispatch, live scheduler state, launch authority or Jordan's human acceptance. The
accepted M3 exact-bundle decision (studio.mjs `9d5ddac3…`, scheduler fixed off) is
preserved and not reopened. Reader-side N1–N4 stay out of scope. Full C54 remains
partial; native acceptance and H remain unverified. This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This thread
did **not** write the classifier, its tests, the classifier report, the v4.1 note,
`verify.mjs` or the implementation receipt. The receipt records its author as
"Prepared classifier/tests/report/note; not independent support", and the project
coordinator says Codex likely prepared the material. The files are untracked, so git
cannot confirm authorship. The milestone implements the next-step prompt written by
a separate Claude thread in the reader-v2/proposal-v4 review; I have none of that
thread's context, but it is the same model family. This is a **separate-session
review, not blinded and not a different-model-family review**.

## Exact bindings

Every input was rehashed before any check. All inputs that the implementation receipt
binds matched it (`match` for 16 of 16). The prior review report matches its own
reviewer receipt. The full map, including pre-update tracking hashes, is in
`tracking/evidence/theme-intent-observation-classifier-review-2026-10-25/reviewer-receipt.json`.

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-observation-classifier-fixture.mjs | `adcd6a801edb604f74a955e57fbaf9ab4377abb264fef79ca3b46cca89505842` |
| tests/theme-intent-observation-classifier-fixture.test.mjs | `a1b28b6a2c2b135e3c2589cf3c7c1db0f2d31b8857a16f3548996ecd056b1d9a` |
| Classifier report | `f1b91df416e2faa44a97143e9720b5130dec7a2ee6882269b43da101d1b0ef1c` |
| v4.1 note | `486b6d66cc1e21c0300d993b540d547379b80a24f86c0e58a14e19aa8920cc45` |
| Implementation receipt (not self-bound) | `8167532c1e58e615e1ed8eaef0ae378eaf18825235cb267532423f4563bc8262` |
| tests.tap / verify.mjs | `c600173e…c184` / `d811d19f…4807` |
| Proposal v4 / checklist v5 / M3 decision | `42f447f9…566d` / `6d27e128…3952` / `24a82ca8…f42b` |
| Prior review report / receipt | `c703706e…864b` / `45145b70…571f` |
| main.rs / home.rs / winsys.rs | `33d629aa…246c` / `a8bc8f23…223b` / `4881b525…95c6d4` |

## Checks actually executed (Windows 11, Node 22.21.0)

1. **Rehash** of the 20 inputs above with a reviewer script in my scratchpad: 16/16
   receipt-bound files match; tracking files, the prior report and the implementation
   receipt itself are not bound by that receipt and are recorded here.
2. **New verifier, check-only:** `node tracking/evidence/theme-intent-observation-classifier-2026-10-25/verify.mjs`
   with no arguments, never `--record`. Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings":76,"mismatches":0,"fixture_test_groups_passed":10,"fixture_test_groups_failed":0,"no_OS_or_IO_dependency_source_guard":true}`,
   exit 0. It reads the author's TAP text and does not run tests. No older verifier ran.
3. **Fixture tests:** `node --test tests/theme-intent-observation-classifier-fixture.test.mjs`
   gave 10/10 pass, 0 fail, 0 skipped, exit 0. This is my own execution, separate
   from the recorded TAP.
4. **Reviewer probes:** pure calls into the exported functions from a scratchpad
   script that imports only the module and `node:crypto` (no I/O, OS or clock use).
   Results are quoted under each finding.
5. **String-only key recomputation:** independent SHA-256 of the joined roots gave
   `d8c7860557013e56` (admitted), `681853bc5104874f` (double trailing),
   `cf2a5fe779f2e38c` (mixed trailing), `b552bb84152dcde0` (forward-slash
   LOCALAPPDATA with Rust's backslash join) and `93553bda48f70dd2` (plan root). These
   match the Rust-executed vectors in the prior review (lines 196-201). I did not
   rebuild or rerun Rust.
6. **Static reading** of main.rs:153-163 and 485-500, home.rs:75-128 and
   winsys.rs:41-62 and 94-141 against the core.

No operational read, studio.json, credentials, registry, process, port, mutex or
event query, launch, sign-in, helper, installer, migration, SQL, provider, workflow,
recovery, cleanup or retired checkout. No receipt-embedded operational path was
followed.

## 1. Key admission, join and derivation: supported (L2)

Native: `studio_home` uses `CREATOR_STUDIO_HOME` when set and non-empty, otherwise
`PathBuf::from(LOCALAPPDATA).join("com.creatoragent.studio")` (main.rs:155-161).
`Home::key` is `sha256(root.to_string_lossy().to_lowercase())[..16]`
(home.rs:124-128). The core (classifier:4-35) requires `override_unset` and
`launch_paths_confirmed` to be exactly `true`, accepts only printable-ASCII,
drive-rooted, backslash-only strings of 512 characters or fewer with no empty, `.` or
`..` components and at most one trailing backslash, and appends a backslash only when
none is present. That is Rust's push rule restricted to v4's admitted spelling;
because input is ASCII, JavaScript `toLowerCase` equals Rust `to_lowercase`. The three
admitted vectors give `d8c78605…`, and the three Rust-executed alternatives plus
non-ASCII, relative, dot and empty-segment inputs return `unavailable` with no
`key16` (tests 1-2). Drive root `C:\` is refused (probe P4b), which is conservative.
The join emulation actually branches, so N5's tautology is resolved.

Native treats an empty `CREATOR_STUDIO_HOME` as unset (main.rs:157). An attestation
that treats empty as set fails closed, so this is informational.

**L2 (Low) — admits a home the native app refuses.** `Home::new` calls `check_home`,
which rejects any path component starting with `onedrive` (home.rs:76-89). The core
admits `C:\Users\x\OneDrive\Local` and returns key `89f7317d8d1bab41` (probe P4).
For that home the app fails before `single_instance` runs (main.rs:487-495), so the
key names objects that never exist. v4's admission rule has the same gap, so the core
matches v4. *Fix:* refuse any component beginning with `onedrive`, case-insensitive.

## 2. Open-result mapping: supported (part of L1)

`mapOpenResult` returns `present` for 0, `absent` for 2 only when `keyBound === true`,
and `unavailable` for everything else, including denied (5), wrong type (6), invalid
parameter (87), strings and undefined (test 3). This matches v4:83-88 and the native
object names in winsys.rs:42-43. `-0` maps to `present` (P7d), which is harmless.

## 3. Run-value mapping and continuity: supported

`mapRunValueResult` takes only a numeric existence status and consumes no type or
data: 0 is present, 2 is absent, everything else is unavailable (test 4). This is
correctly broader than the native reader, which asks for `RRF_RT_REG_SZ` only
(winsys.rs:126-141); a `REG_EXPAND_SZ` value that Windows would still launch counts
as present. `classifySample` requires `run_value` to be `absent` or `present` and
`run_history_reconciled === true` either way (classifier:76-80), so current absence
never removes the continuity requirement (v4:98-101).

## 4. Sample fields, counts, bindings and attestations: supported (L1, L4)

`available`, all six attestations and `run_history_reconciled` must be exactly
`true`. The eight counts must be non-negative safe integers. `pg_ctl_status` must be
0 or 3. `binding_sha256` must be 64 lowercase hex characters. Each of these is
mutated individually in test 5 to `unavailable`, never to zero or stopped, and
uppercase binding is refused (P7e). Outputs are fixed allowlists. I found no path
where a missing, malformed or unavailable field reaches `stopped`. The core cannot
see contradictions inside folded inputs (L1) or contradictions across fields (M3).

**L1 (Low) — map results are not connected to the sample.** `classifySample` never
calls `mapOpenResult` or `mapRunValueResult`; it accepts pre-folded counts and a
`key_bound` boolean that is not tied to any `desktopKey` result or `key16`. The
guarantees that unavailable never becomes zero and that not-found counts as absent
only with a bound key therefore depend entirely on a future adapter, which the
report admits (classifier report:50-53). The map outputs are also bare strings with
no `fixture` marker (P6). *Fix in the collector scope:* carry per-target coded
results in the sample and fold them inside the core, or bind `key16` into the
binding token's reviewed preimage.

**L4 (Low) — distinct v4 gates collapse into one boolean.** `identity_matches`
stands for installed-file hashes, PG_VERSION, reparse-point refusal, tool and image
identity, ambiguous shared-executable use (blocking under v4:80) and the M3 bundle
hash. v4's "unexpected additional theme-intent lease names" blocking boolean
(v4:91-92) and the same-session requirement for Local-namespace queries (v4:88-90)
have no field of their own. Nothing is lost for pass/fail if the adapter folds
correctly, but per-gate coded evidence (v4:103-105) is not representable.

## 5. Sampling windows: supported for PR-01; SH-01 has M2 and M3

Supported and probed: spacing of at least 1000 ms (999 is refused), strict ordering,
samples inside `[start_ms, now_ms]` (P7f), one identical binding token, the last
sample at `now_ms` (stale is refused), the bound checked before scanning (15001 is
`unknown`), sample caps of 16 and 91 that exactly fit 1 Hz windows (P7a, P7b), pass
at the exact deadline, no pass after the deadline, and empty or single-sample input
pending only before the deadline. Pass requires the final run of at least two
consecutive stopped samples; later activity resets it (SH-01 test, last case). PR-01
activity blocks immediately (P2b).

**M2 (Medium) — SH-01 pass has no planned-Quit or running-state precondition.**
Checklist v5:223-225 allows a planned Quit only after a recorded running state and
requires the Quit request to be recorded; v4:116-117 makes an unplanned exit an
incident. `classifyWindow` takes neither, and `start_ms` is an unbound number. Probe
P3: `SH-01` with two stopped samples at 0 and 1000 returns `pass`. A studio that had
already exited (crash or unplanned Quit) before the window would get a passing
SH-01 instead of an incident. *Repro:* `classifyWindow({kind:'SH-01',start_ms:0,now_ms:1000,samples:[s(0),s(1000)]})`.
*Fix:* SH-01 requires injected `running_state_recorded === true`,
`planned_quit === true` and `quit_request_ms === start_ms`; otherwise `unknown`
with a fixed reason (or `blocked` incident if unplanned is asserted).

**M3 (Medium) — a contradictory SH-01 sample can be followed by a pass.** v4:127
says contradiction is unknown/blocked, and v4:105-106 says contradictory results
block. The core treats any non-stopped sample as activity, which in SH-01 only
resets the stopped count. Probe P2: `pg_ctl_status: 0` with all counts zero, then two
stopped samples, returns `pass`. Here pg_ctl sees a live postmaster that the
scoped process count did not see, which is v4's ambiguous-image case (v4:80); the
later zero process counts are not trustworthy for that window. *Fix:* define a
reviewed contradiction predicate (at minimum `pg_ctl_status === 0` with
`postgres_processes === 0`) that makes the window terminally `unknown` for both
kinds, with tests.

## 6. Redaction and fixture labelling: supported (part of L1)

Every object output is `{fixture, status, reason}` or, for an admitted key,
`{fixture, status, key16}`; reasons are fixed strings. Sentinel passwords, cookies,
command lines and raw errors never appear (tests 9-10). `key16` is a 16-hex prefix of
a hash of a guessable profile path and is dictionary-reversible to a username; v4
permits emitting hashes, so this is informational. Map outputs lack the fixture
label (L1). Nothing writes evidence, so no output can be mistaken for a measured
receipt today.

## 7. N6 and the v4.1 note: note supported with L3; core has M1

The note's mechanism is correct against the source. `single_instance` calls
`CreateMutexW(None, true, Local\CreatorAgentStudio-{key})`; on `ERROR_ALREADY_EXISTS`
it closes, tries to signal the show event and returns `Second`
(winsys.rs:45-53), and main.rs:496 returns silently. Any foreign handle that keeps
the mutex alive makes a concurrent launch, including `--at-login`, exit with no UI.
The note correctly requires immediate closure, forbids wait, acquire, create,
release, set and reset, forbids holding handles across intervals, requires no launch
**attempt** for the whole window, includes quiet and at-login paths, treats observed,
reported, suspected or uncertain attempts as incidents with no silent retry, and
says object or process absence cannot prove that no attempt was suppressed.

One positive consequence is worth recording: `OpenMutexW` returns not-found only when
no handle to the object exists in that namespace. A stopped sample's absent mutex
therefore shows that, at that instant, no handle from the collector or anyone else in
that session was keeping the object alive. The suppression hazard sits in activity
samples, mainly during SH-01 shutdown, not after a pass because of the collector's
own earlier handles.

**L3 (Low) — two omissions in the N6 contract.** (a) `launch_during_sampling` is a
per-sample boolean. The note covers intervals and handle closure, but nothing in the
classifier input attests the period after the final sample's `at_ms` until its
handles close, and "for the relevant window" is not defined per sample. (b) The show
event is not discussed. A collector handle on `Local\CreatorAgentStudioShow-{key}`
keeps an auto-reset event alive. If an earlier Second launch signalled it, the next
First instance receives that existing signalled event from `CreateEventW` (the
already-exists case is not checked at winsys.rs:55) and `wait_for_show` returns
at once (main.rs:597), so even a quiet at-login launch can show its window. This is
a smaller effect than mutex suppression, but open-only on the event is also not
effect-free.

**M1 (Medium) — a launch incident can be downgraded to unknown.** The note
says an attempted launch must stop sampling, preserve evidence, invalidate the window
and block pending a separate reconciliation. Checklist v5:228-232 lets an unknown
SH-01 be followed by a later read-only re-observation under a new decision. The core
checks `launch_during_sampling` only after the sample passes availability and binding
checks, and only for samples reached after every earlier window check. Probes:
`launch_during_sampling: true` with `available: false` → sample `unavailable` (P1a);
after an unavailable sample → window `unknown` (P1c); in an overrun window →
`unknown/DEADLINE_EXCEEDED` (P1d); with a spacing violation → `unknown` (P1e); in an
over-cap window → `unknown/INVALID_WINDOW` (P1g); after PR-01 activity →
`blocked/PRELAUNCH_ACTIVITY`, not an incident (P1f). None of these is a pass, but each
removes the incident signal and routes to the re-observation path instead of
reconciliation. Test 8 covers only a well-formed second sample. *Fix:* scan every
supplied sample for `launch_during_sampling === true` (and any explicit window-level
launch flag) before every other window or sample rejection, and return
`blocked/LAUNCH_DURING_SAMPLING`. Keep missing or unknown as incident only on
otherwise available samples, as now.

## 8. Purity: supported (L5)

The module's only import is `node:crypto` for deterministic SHA-256
(classifier:2). It has no references to `process`, `Date`, `fs`, network, timers or
globals, and no CLI entry point. Hashing a supplied string is computation, not
observation. Tests use only `node:test` and assertions.

**L5 (Low) — weak verifier guards.** The verifier's purity regex (verify.mjs:19)
would miss `globalThis.process`, `require`, dynamic `import()` or `performance.now`.
Its TAP check (verify.mjs:16) matches `# pass 100` as well as `# pass 10`. Manual
inspection here supersedes both; a successor verifier should anchor the TAP lines and
parse imports.

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| M1 | Medium | Launch incident downgraded to unknown or blocked-by-activity | Open, core |
| M2 | Medium | SH-01 pass without recorded running state or planned Quit | Open, core |
| M3 | Medium | Contradictory SH-01 sample followed by pass | Open, core |
| L1 | Low | Map results not connected to samples; map outputs unlabeled | Open, collector scope |
| L2 | Low | Admits OneDrive-component homes the native app refuses | Open, core and v4 text |
| L3 | Low | N6: no post-final-sample attestation; show-event effect undisclosed | Open, note |
| L4 | Low | Distinct v4 gates folded into one boolean | Open, collector scope |
| L5 | Low | Verifier purity and TAP guards are weak | Open, successor verifier |
| N5 | (was Low) | Tautological key test | Resolved |
| N6 | (was Low) | Open-handle launch suppression undisclosed | Resolved as disclosure; L3 remains |

There are no High or Critical findings, and no false pass was found for PR-01.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Still pending:
the exact launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation,
database port, pg_bin with pg_ctl/postgres identity provenance, continuity since
the historical shutdown, workspace ID and current owner/editor role, a reviewed scope
manifest, a concrete operational grant and a bounded session decision. Reader N1–N4
remain for the adapter. R is separate and H is Jordan's alone.

## Smallest precise next eligible implementation prompt (not executed)

> Preserving classifier v1, its tests, report, the v4.1 note, reader v2, proposal v4,
> checklist v5, the M3 decision and all receipts byte for byte, add in new files a
> pure fixture classifier v2 and tests that: (M1) check every supplied sample for
> `launch_during_sampling === true` before any window, sequence, deadline, cap,
> availability or activity rejection and return `blocked/LAUNCH_DURING_SAMPLING`;
> (M2) require for SH-01 injected `running_state_recorded === true`,
> `planned_quit === true` and `quit_request_ms === start_ms`, otherwise `unknown`;
> (M3) treat `pg_ctl_status === 0` with `postgres_processes === 0` as a contradiction
> that makes either window terminally `unknown`; (L2) refuse a LOCALAPPDATA
> component beginning with `onedrive`, case-insensitive. Add a short v4.2 note
> covering M2/M3 and L3's two N6 omissions. Add regression tests that reproduce probes
> P1a, P1c-P1g, P2 and P3 and P4, and record a new check-only receipt with anchored
> TAP checks. No collector, OS, registry, process, mutex, event, config read or
> launch. Then commission a separate uninvolved review of those exact bytes. Full C54
> stays partial.

L1 and L4 belong in the future collector or adapter scope with N1–N4.
