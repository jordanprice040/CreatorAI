# Observation classifier v2 and proposal v4.2 note independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **partial.** The v2 repair fixes all three prior Medium findings and L2
exactly as the prior review asked, and I reproduced the old defects and the
corrected outcomes myself. It still has one Medium false pass that v1 also had and
the prior review missed: an SH-01 window passes after the studio or its database
**restarts** following a stopped sample (M4). There are also three new Lows. Four
separate answers, none of which implies another:

| Question | Answer |
| --- | --- |
| Fixture classifier support | **Partial.** M1, M2, M3 and L2 repairs supported; not a complete v4/v4.2 classifier until M4 is repaired. |
| v4.2 contract-note support | **Supported with Lows.** Incident precedence, planned Quit, contradiction and show-event text match native source. L6 and L8 below; the note does not state the restart rule M4 needs. |
| Operational collector exists | **No.** Only the v2 test imports the module; verify.mjs reads it as text. No collector, adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, scope manifest, collector implementation and review, and a session decision are all pending. |

A fixture pass classifies injected data only. It is not observed shutdown, zero
dispatch, live scheduler state, launch authority or Jordan's human acceptance. The
accepted M3 exact-bundle scheduling decision (`24a82ca8…f42b`; studio.mjs
`9d5ddac3…`) is preserved and not reopened; review finding M3 below is a different
thing. Reader N1–N4 and classifier L1/L4 stay future adapter/collector work. Full
C54 remains partial; native acceptance and H remain unverified. This review grants
no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This thread
did **not** write classifier v2, its tests, the v2 repair report, the v4.2 note,
`verify.mjs`, `baseline-probes.json` or the repair receipt. The receipt records its
author as "Authored classifier-v2/tests/report/v4.2 note; not independent support",
and the project coordinator says Codex likely prepared the repair. The files are
untracked, so git cannot confirm authorship. v2 implements the next-step prompt
written by the separate Claude thread that wrote the prior classifier review. I have
none of that thread's context, but it is the same model family. This is a
**separate-session review, not blinded and not a different-model-family review.**

## Exact bindings

Every input was rehashed before any check. All 76 paths bound by the repair receipt
match (`76/76`, zero mismatches). The repair receipt itself, the prior review and
its receipt, and pre-update tracking are recorded here. The verifier's figure of 84
bindings counts paths across three overlapping maps; there are 76 distinct paths.
The full map is in
`tracking/evidence/theme-intent-observation-classifier-v2-review-2026-10-25/reviewer-receipt.json`.

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-observation-classifier-fixture-v2.mjs | `6c491f40c440a01a4e2da7b3a372cc02f0b7b478fc94d5fbdd193abd4cfa1530` |
| tests/theme-intent-observation-classifier-fixture-v2.test.mjs | `0fe7fa3d18582a72ac1185bf8665198f990e75dd3b77cb4be533997c92b6d2f2` |
| v2 repair report | `a991a1eccdbdb54f42e3f845b7deea5b73d63bae6c17292a1af3c6dde918de96` |
| v4.2 note | `f0cbfb9d8332866f16ed3fdede655df0ab2c0154d69cb2b9f7a6bc5b54fb911f` |
| tests.tap / baseline-probes.json / verify.mjs | `d180e2d9…a730` / `4b7dc40a…ebbe` / `686ee38b…52aa` |
| Repair receipt (not self-bound) | `3009a8ddef2b659f6351b113c6525403769927846cc3962dafe52c56f0ecfefa` |
| Frozen v1 module / tests | `adcd6a80…5842` / `a1b28b6a…1d9a` |
| Proposal v4 / v4.1 note / checklist v5 / M3 decision | `42f447f9…566d` / `486b6d66…cc45` / `6d27e128…3952` / `24a82ca8…f42b` |
| Prior review report / receipt | `b9e11322…fc86` / `6753a40c…63c2` |
| main.rs / home.rs / winsys.rs | `33d629aa…246c` / `a8bc8f23…223b` / `4881b525…95c6d4` |

## Checks actually executed (Windows 11, Node 22.21.0)

1. **Rehash** with a reviewer script in my scratchpad that reads bytes only: 76/76
   receipt-bound inputs match. Tracking files differ from the receipt's recorded
   pre-update hashes, as expected after the author's tracking update.
2. **New verifier, check-only:** `node tracking/evidence/theme-intent-observation-classifier-v2-2026-10-25/verify.mjs`
   with no arguments, never `--record`. Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings":84,"mismatches":0,"fixture_test_groups_passed":15,"fixture_test_groups_failed":0,"anchored_TAP_totals":true,"AST_dependency_guard":true,"guard_negative_self_checks":7,"baseline_defects_reproduced":3}`,
   exit 0. The repair receipt hash was unchanged afterwards. It reads the author's
   recorded TAP and does not run tests. No older verifier ran.
3. **Fixture tests, my own execution:** `node --test tests/theme-intent-observation-classifier-fixture-v2.test.mjs`
   gave 15/15 pass, 0 fail, 0 skipped, exit 0. This is separate from the recorded TAP,
   which also shows 15/15.
4. **Reviewer probes:** pure calls into the v1 and v2 exports from scratchpad scripts
   that import only those modules (no I/O, OS, clock or environment use). Results
   are quoted under each finding.
5. **Verifier-guard probes:** a verbatim copy of `purityGuard` (verify.mjs:14-31) run on
   source strings using the repository's `typescript` package. Parsing only.
6. **Static reading** of home.rs:75-128, winsys.rs:41-67 and main.rs:155-163, 485-500
   and 590-600 against the core.

No operational read, saved configuration, credentials, environment, registry,
process, port, mutex or event query, launch, sign-in, helper, installer, migration,
SQL, provider, workflow, recovery, cleanup or retired checkout. No receipt-embedded
operational path was followed. Rust was not rebuilt or rerun.

## 1. M1 launch-incident precedence: resolved

`classifyWindow` first returns `blocked/LAUNCH_DURING_SAMPLING` when the window flag or
any array element has `launch_during_sampling === true` (v2:110-114), before the
contradiction scan and every shape, cap, time, spacing, binding, availability and
activity return. `classifySample` checks it before availability (v2:73-74). My probes
reproduce v1 and show v2 for each prior path:

| Probe | v1 | v2 |
| --- | --- | --- |
| P1a sample with launch and `available:false` | unavailable | incident |
| P1c after an unavailable sample | unknown/INCOMPLETE_OBSERVATION | blocked/LAUNCH_DURING_SAMPLING |
| P1d overrun window | unknown/DEADLINE_EXCEEDED | blocked/LAUNCH_DURING_SAMPLING |
| P1e spacing violation | unknown/UNSTABLE_OR_INVALID_SEQUENCE | blocked/LAUNCH_DURING_SAMPLING |
| P1f after PR-01 activity | blocked/PRELAUNCH_ACTIVITY | blocked/LAUNCH_DURING_SAMPLING |
| P1g over-cap window | unknown/INVALID_WINDOW | blocked/LAUNCH_DURING_SAMPLING |

Test 11 also covers a bad binding, invalid kind with negative start and a window with
`handles_closed:false`. The prior review's split is kept: an explicit `true` always
wins, while a missing or non-boolean sample flag is an incident only on an otherwise
available sample. Uncertain *window-level* exclusion is handled less strictly; see L6.

## 2. M2 planned-Quit preconditions: resolved

SH-01 now requires `running_state_recorded === true`, `planned_quit === true`, a safe
non-negative integer `quit_request_ms` and `quit_request_ms === start_ms`, otherwise
`unknown/PLANNED_QUIT_NOT_ESTABLISHED` (v2:131-138). Probe P3 (v1 pass) now returns that
reason. Truthy `1`, string `'true'`, `'0'`, `undefined` and a mismatched origin are
all refused (test 12; my N4 probes). `-0` equals `0` and passes, which is harmless. These
are injected booleans, not an independent running-state observation, as the note
says (v4.2:24-26). A caller can label a window `PR-01` and skip these preconditions
(I2); binding the kind to the scheduled step is collector scope.

## 3. M3 contradiction: resolved

Any sample with `pg_ctl_status === 0` and `postgres_processes === 0` makes either kind
`unknown/CONTRADICTORY_POSTGRES_OBSERVATION` before sequence, availability and
activity returns (v2:115-116). Probe P2 (v1 pass) now returns that reason. It also
holds for a contradictory sample that is unavailable or before `start_ms`, which is
conservative, and an explicit launch keeps priority in both orders (probe P1h and
test 13). A string `'0'` status is not a contradiction but is still unavailable.
Noncontradictory shutdown activity followed by a stopped pair still passes, as
intended. This is the reviewed minimum predicate, as v4.2:32-33 says.

## 4. L2 OneDrive admission: resolved

Native `check_home` lowercases each path component with `to_ascii_lowercase` and
refuses any that starts with `onedrive` (home.rs:80-87); `Home::new` calls it before
anything else (home.rs:97-98), and main.rs calls `single_instance` only after
`studio_home` succeeds (main.rs:491-495). v2 refuses the same components with
JavaScript `toLowerCase` (v2:23-29), which is equivalent because admission accepts only
printable ASCII. `C:\Users\x\OneDrive\Local`, `…\OneDrive - Personal\Local`,
`C:\onedrive` and `C:\OneDrive\` go from `bound` in v1 to `unavailable` in v2. `MyOneDrive`
and `One Drive` stay bound, which matches native. The three admitted spellings still
give `d8c7860557013e56`, the Rust-executed vector.

## 5. L3 window attestation, closure and show event: note supported (L6, L8)

v2 requires window-level `launch_during_sampling === false` (else `blocked`) and
`handles_closed === true` (else `unknown`) before any pass (v2:127-130), and the
deadline check still uses the original 15 s and 90 s bounds. Because v4.2:41-45 defines
`now_ms` as completion after final closure and v2 requires `now_ms − start_ms ≤ bound`,
closure cannot extend the window. These are injected flags and times only. Nothing in
the core observes closure, and the note says so.

The show-event caveat is correct against source. `single_instance` creates an
auto-reset event with `CreateEventW(None, false, false, …)` and does not check
`ERROR_ALREADY_EXISTS` after it (winsys.rs:55-56). A Second launch signals that event
(winsys.rs:49-51). The show thread starts for every First instance and shows the
window on a signal (main.rs:590-598), so a surviving signalled event can make a quiet
at-login launch visible. The note's rules (close immediately, no create, wait, set or
reset, no handles held between samples, no attempt allowed, uncertain attempts are
incidents) cover both the mutex and the event.

**L6 (Low): uncertain window exclusion can be reported as unknown.** v4.2:39-40 says
"Missing/uncertain window exclusion blocks." v2 checks a contradiction and the window
shape first, so `launch_during_sampling: undefined` at window level with a
contradictory sample returns `unknown/CONTRADICTORY_POSTGRES_OBSERVATION`, and with an
invalid kind or over-cap array returns `unknown/INVALID_WINDOW` (probes N1). It is
never a pass, but it routes an uncertain launch to the re-observation path rather than
to reconciliation, which is the same class of problem as M1. *Fix:* for an object
input, return `blocked/LAUNCH_NOT_EXCLUDED` right after the explicit-launch scan when
the window flag is not exactly `false`.

**L8 (Low): `at_ms` has two meanings.** v4.2:42-44 makes the *last* sample's `at_ms` the
completion time after its handles close, while v4 leaves earlier samples' `at_ms` as the
sample instant. The ≥1000 ms spacing check (v2:151) therefore compares a query instant
with a completion instant, so the last two OS queries can be less than a second
apart and still pass. *Fix:* in a v4.3 note, give every sample one `at_ms` meaning
(for example query start) and add a separate window `closed_ms`, with
`last at_ms ≤ closed_ms = now_ms ≤ start_ms + bound`.

## 6. Sampling, positive controls, redaction and purity: supported except M4

Unchanged and reprobed: spacing, ordering, one binding token, last sample at
`now_ms`, caps of 16 and 91, pass at the exact deadline and no pass after it. Positive
controls pass: a PR-01 stopped pair, an SH-01 activity-then-pair, and SH-01 at
89–90 s. PR-01 activity blocks.

**M4 (Medium): an SH-01 window passes after a restart.** Once a complete stopped
sample shows no desktop, service or postgres process, listener, lease or mutex, any
later activity means something started again. v4:116-117 makes an unplanned
startup an incident, v4:133 says "A restart invalidates prior stopped evidence," and
v4.2:55-56 forbids any launch attempt during the window. v2, like v1, resets only the
stopped count on activity (v2:162), so a new pair after the restart passes:

| Probe (SH-01, valid preconditions and window attestations) | v1 | v2 |
| --- | --- | --- |
| R1 stopped, desktop process 1, stopped, stopped | pass | pass |
| R2 stopped, stopped, desktop mutex 1, stopped, stopped | pass | pass |
| R3 stopped, stopped, pg_ctl 0 with 2 postgres processes, stopped, stopped | pass | pass |
| R4 control: activity only before the first stopped sample | pass | pass |

*Repro:* `classifyWindow({kind:'SH-01',start_ms:0,now_ms:3000,launch_during_sampling:false,handles_closed:true,running_state_recorded:true,planned_quit:true,quit_request_ms:0,samples:[s(0),s(1000,{desktop_processes:1}),s(2000),s(3000)]})`
returns `pass`. Here the core accepts observed data that contradicts the injected
no-launch attestation. The prior review accepted "later activity resets it" as
restart invalidation; I read v4:133 together with the v4.2 no-attempt rule as making
this an incident. *Fix:* in SH-01, any non-stopped sample after any stopped sample
returns `blocked` with a fixed reason such as `RESTART_AFTER_STOPPED_SAMPLE`, with
explicit launch keeping priority. The existing test 7 case (pair, then activity,
`pending`) should become that incident.

Redaction holds: injected `password`, `raw_error`, `reason`, `status:'pass'` and
`fixture:false` fields never reach outputs, which stay fixed `{fixture, status,
reason}` or `{fixture, status, key16}` objects. Map helpers still return bare
strings (L1, collector scope).

Purity holds by inspection. The only import is `createHash` from `node:crypto`
(v2:2). A search of the module finds no `process`, `Date`, `Math`, `Reflect`,
`import.meta`, computed member access, `new`, `async` or `eval`; the only
`process` matches are field-name strings. Hashing a supplied string is computation,
not observation. No CLI entry point exists.

**I1 (Info):** the window loop has no branch for a sample status of `contradiction`
(v2:155-162). It is unreachable with JSON data because the pre-scan catches it, but
with a getter that changes value between reads the window returns `pending` (probe
N8). The note already requires JSON-like records; the collector should pass plain
data, for example after a JSON round trip.

**I3 (Info):** nothing requires the first sample near `start_ms`. An SH-01 pass with
samples only at 89 s and 90 s is allowed, as v4 permits, so contradictions or
restarts in unobserved time rely only on the injected window attestation. The
collector should sample from the start.

## 7. Regression evidence: supported

`baseline-probes.json` records v1 and v2 outcomes for M1, M2 and M3. My independent
probes give the same values (M1 v1 `unknown/INCOMPLETE_OBSERVATION`, M2 and M3 v1
`pass`, and the v2 reasons). The inherited ten test groups still pass. The two changed
expectations are justified. First, SH-01 cases now supply valid preconditions.
Second, the old pg_ctl 0 zero-process expectation is now a contradiction instead of
activity. Neither weakens an acceptance criterion. Frozen v1 bytes and the old
receipts are unchanged (rehash).

## 8. New verifier: supported as a supplemental guard (L7)

Confirmed by reading and running: no-argument mode compares a recomputed value to
the saved receipt and writes nothing; `--record` uses `wx` (create once). TAP totals
are anchored with `^# name n\r?$` and self-checked against `# pass 150`. Imports
are parsed with the TypeScript AST and must be exactly `{ createHash }` from
`node:crypto`. The six source mutants plus the TAP mutant are rejected. The verifier
does not execute tests and does not bind the TAP to a source hash beyond recording
both. This resolves the prior L5 in substance.

**L7 (Low): the AST guard has bypasses.** My copy of `purityGuard` accepts
`(()=>0)['constr'+'uctor'](…)()` and a template-literal `` [`constructor`] ``, both of which
reach the `Function` constructor, plus `Math.random()`, global `crypto.randomUUID()`,
`Reflect` and `import.meta.url`. None appears in the actual source (§6), so this does
not affect today's verdict. A successor verifier should reject any computed element
access and the `Math`, `crypto`, `Reflect` and `Proxy` identifiers and `import.meta`.

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| M4 | Medium | SH-01 passes after restart following a stopped sample (also in v1) | Open, core and note |
| L6 | Low | Uncertain window-level exclusion returned as unknown on contradiction/invalid-window paths | Open, core |
| L7 | Low | Verifier AST guard bypasses (computed constructor, Math, crypto, Reflect, import.meta) | Open, successor verifier |
| L8 | Low | Last sample `at_ms` redefined as completion; spacing compares mixed instants | Open, note and collector |
| L1, L4 | Low | Carried from prior review | Future collector scope |
| I1, I2, I3 | Info | Getter-only contradiction branch; caller-chosen kind; no prompt first sample | Collector scope |
| M1, M2, M3, L2 | (were Medium/Low) | Prior findings | Resolved |
| L3 | (was Low) | Post-final-sample attestation and show-event disclosure | Resolved; L6/L8 remain |
| L5 | (was Low) | Weak verifier guards | Resolved in substance; L7 remains |

No High or Critical findings. No PR-01 false pass found.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Still pending:
the exact launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation,
database port, pg_bin with pg_ctl/postgres identity provenance, continuity since the
historical shutdown, workspace ID and current owner/editor role, a reviewed scope
manifest, a concrete operational grant and a bounded session decision. Reader N1–N4
and classifier L1/L4 remain for the adapter and collector. R is separate and H is
Jordan's alone.

## Smallest precise next eligible implementation prompt (not executed)

> Preserving classifier v1 and v2, their tests, reports, receipts and verifiers, the
> v4.1 and v4.2 notes, reader v2, proposal v4, checklist v5 and the M3 decision byte for
> byte, add in new files a pure fixture classifier v3 and tests that: (M4) in SH-01,
> return `blocked/RESTART_AFTER_STOPPED_SAMPLE` for any non-stopped sample after any
> stopped sample, with explicit launch keeping priority; (L6) for an object input,
> return `blocked/LAUNCH_NOT_EXCLUDED` right after the explicit-launch scan when the
> window-level flag is not exactly `false`. Add a short v4.3 note stating the restart
> rule and one `at_ms` meaning for every sample plus a separate `closed_ms` bounded by
> the original deadline (L8), and apply that field in v3. Add regression tests
> reproducing probes R1–R3 and N1. Record a new check-only receipt whose verifier also
> rejects computed element access and the `Math`, `crypto`, `Reflect` and `Proxy`
> identifiers and `import.meta` (L7). No collector, OS, registry, process, mutex, event,
> config read or launch. Then commission a separate uninvolved review of those exact
> bytes. Full C54 stays partial.
