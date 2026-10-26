# Observation classifier v3 and proposal v4.3 note independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **pass for the fixture repair scope, with two Low findings.** v3 repairs
M4, L6 and L8 exactly as the classifier-v2 review asked, and its verifier implements
the L7 checks that review named. I reproduced the frozen v2 restart passes myself
and found no PR-01 or SH-01 false pass in v3. Two Lows remain. First, an uncertain
*sample-level* launch flag can still be downgraded to `unknown` by an earlier
rejection, which contradicts one sentence of the v4.3 note (L9). Second, the
hardened AST guard still has bypasses that do not use element access (L10). Four
separate answers, none of which implies another:

| Question | Answer |
| --- | --- |
| Fixture classifier support | **Supported with Lows.** M4, L6 and L8 repaired; M1–M3, L2, planned Quit, admission, key derivation, mapping, counts, binding stability and redaction unchanged and passing. L9 is a residual incident-routing gap, never a pass. |
| v4.3 contract-note support | **Supported with one Low.** Restart rule, launch precedence order and the single `at_ms` meaning with `closed_ms` match v3 and proposal v4. One sentence overstates what the core does for sample-level uncertainty (L9). |
| Operational collector exists | **No.** Only the v3 test file and my probes import the module; `verify.mjs` reads it as text. No collector, adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, a reviewed scope manifest, a collector and its review, and an operational session decision are all pending. |

A fixture classification is not observed shutdown, zero dispatch, live scheduler
state, launch authority or Jordan's human acceptance. The accepted M3 exact-bundle
scheduling decision (`24a82ca8…f42b`) is preserved and not reopened. Reader N1–N4
and classifier L1/L4 stay future adapter/collector work. Full C54 remains partial;
native acceptance and H remain unverified. This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This session
did **not** write classifier v3, its tests, the v3 repair report, the v4.3 note,
`verify.mjs`, `baseline-probes.json`, the three TAP files or the repair receipt. The
repair receipt records its author as "Authored classifier-v3/tests/report/v4.3 note;
not independent support", and the project coordinator says Codex likely prepared the
repair. The files are untracked, so git cannot confirm authorship. v3 implements the
next-step prompt written by the separate Claude thread that reviewed classifier v2.
I have none of that thread's context beyond its committed report and receipt, but it
is the same model family. This is a **separate-session review, not blinded and not a
different-model-family review.**

## Exact bindings

Every input was rehashed before any check by a reviewer script that reads bytes
only. All 88 paths bound by the v3 repair receipt match (`88/88`, zero mismatches).
The verifier's figure of **154** is bindings counted across three overlapping prior
maps (v2 review inputs, v2 review report, v2 repair inputs, minus three mutable
tracking files it excludes explicitly). Those 154 bindings cover **78 distinct prior
paths**; the other 10 receipt paths are the 9 new v3 files plus the v2 review receipt.
The full map is in
`tracking/evidence/theme-intent-observation-classifier-v3-review-2026-10-25/reviewer-receipt.json`.

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-observation-classifier-fixture-v3.mjs | `e894f036b5f05940f31a06a1d3fe5b587166f0a68b755dcdb7fdd3da8d586615` |
| tests/theme-intent-observation-classifier-fixture-v3.test.mjs | `78e39517dc36c4ee35c7f87ab0cdc0312848e8b56116b88c999039a31c174971` |
| v3 repair report | `f2b1acc68c55689030fb44eab4400704136c114752473c1e5f69728065988fb2` |
| v4.3 note | `57ea5ce91796a354a3551e3711b785207c80ef327ea0f7d562ab6919edf08dda` |
| verify.mjs | `c8a9a85078046771f72fed5b5dad935bfcf399ad63829e732571d88e3179d888` |
| baseline-probes.json | `fb2064f801088cf0852331f0030c1b9e7156f43d006c072e95940a50a10b1ae1` |
| tests-initial / second / final TAP | `3d53bf3f…888a` / `67b5de1d…e7c9` / `3aad352f…cc09` |
| Repair receipt (not self-bound) | `91cfd1eae82d96b427fba49b9c40901f28bc885ef3ad004303acd3e7b8fb4b94` |
| v2 review report / receipt | `e1664100…6baa` / `dee1533f…996d` |
| Frozen v2 / v1 module | `6c491f40…1530` / `adcd6a80…5842` |
| Proposal v4 / notes v4.1, v4.2 / checklist v5 / M3 decision | `42f447f9…566d` / `486b6d66…cc45`, `f0cbfb9d…911f` / `6d27e128…3952` / `24a82ca8…f42b` |
| main.rs / home.rs / winsys.rs | `33d629aa…246c` / `a8bc8f23…223b` / `4881b525…95c6d4` |

## Checks actually executed (Windows 11, Node 22.21.0)

Executed by me, separately from anything recorded:

1. **Rehash**: 88/88 receipt-bound inputs match; 154 overlapping bindings over 78
   distinct prior paths recomputed independently from the two prior receipts.
2. **New verifier, check-only:** `node tracking/evidence/theme-intent-observation-classifier-v3-2026-10-25/verify.mjs`
   with no arguments, never `--record`. Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings_including_overlap":154,"prior_distinct_paths":78,"mismatches":0,"fixture_test_groups_passed":18,"fixture_test_groups_failed":0,"anchored_unique_TAP_totals":true,"AST_source_guard":true,"guard_negative_self_checks":16,"baseline_restart_defects_reproduced":3,"normal_shutdown_control":true,"uncertain_launch_regression":true}`,
   exit 0. The repair receipt hash was `91cfd1ea…4b94` before and after. No older
   verifier ran.
3. **Fixture tests:** `node --test tests/theme-intent-observation-classifier-fixture-v3.test.mjs`
   gave 18/18 pass, 0 fail, 0 cancelled, 0 skipped, exit 0.
4. **Reviewer probes:** 103 window fixtures (215 version outcomes across v1, v2 and v3)
   plus sample, key, mapping and redaction calls, from a scratchpad script that imports only those modules (no I/O, OS, clock or environment use).
   Results are quoted under each finding.
5. **Verifier-guard probes:** a verbatim copy of `purityGuard` (verify.mjs:14-30) run on
   source strings with the repository's `typescript` package. Parsing only; two
   bypass expressions were also evaluated in a bare `node -e` to confirm they reach
   the `Function` constructor (no file, OS or network access).
6. **Static reading** of v3 against v2 (`diff`), the v3 tests against the v2 tests,
   proposal v4:112-133 and the v4.3 note.

Read but not executed: the recorded TAP files (`tests-final.tap` 18/18,
`tests-second.tap` 17/18, `tests-initial.tap` 16/18) and `baseline-probes.json`.

No operational read, saved configuration, credentials, environment, registry,
process, port, mutex or event query, launch, sign-in, helper, installer, migration,
SQL, provider, workflow, recovery, cleanup or retired checkout. No receipt-embedded
operational path was followed (the verifier and my rehash read those files' bytes
for hashing only). Rust was not rebuilt or rerun.

## 1. M4 restart after a stopped sample: resolved

For `kind === 'SH-01'`, v3 scans every array element in order before any shape, cap,
closure, planned-Quit or deadline check and returns `blocked/RESTART_AFTER_STOPPED_SAMPLE`
for the first non-stopped sample after any stopped one (v3:121-129). Only the two
launch checks precede it.

| Probe (SH-01, otherwise valid) | v1 | v2 | v3 |
| --- | --- | --- | --- |
| R1 stopped, desktop process 1, stopped, stopped | pass | pass | blocked/RESTART |
| R2 stopped ×2, desktop mutex 1, stopped ×2 | pass | pass | blocked/RESTART |
| R3 stopped ×2, pg_ctl 0 with 2 postgres, stopped ×2 | pass | pass | blocked/RESTART |
| R4 control: activity ×2 before the first stopped sample | pass | pass | pass |

Later clean pairs never cure it: restart followed by 80 clean samples (R5) is v2
`pass`, v3 blocked. Every early-exit path I tried now yields the same block instead
of `unknown`: deadline overrun (R6), 92 samples over cap (R7), string `closed_ms`
(R8, v2 `pass`), `handles_closed:false` (R9), missing planned Quit (R10), a later
contradiction (R11), contradiction, unavailable, `null`, string, bad-count,
bad-spacing and other-binding samples after a stopped one (R12–R17, R21), and a
restart sample before `start_ms` (R20). An explicit launch after a restart still
reports `LAUNCH_DURING_SAMPLING` (R18). Mixed shutdown activity before the first
stopped sample still passes (R4b). A contradiction *before* any stopped sample stays
`unknown/CONTRADICTORY_POSTGRES_OBSERVATION` (R22), and a misspelled kind stays
`unknown/INVALID_WINDOW` (R19); neither passes. Treating unavailable or contradictory
later samples as restarts is conservative, as the v4.3 note says, not proof that a
restart occurred.

The two changed inherited expectations (test 7: stopped, unavailable, stopped was
`unknown`; stopped pair then activity was `pending`) now assert the restart reason.
That is the change the v2 review asked for and is stricter, not weaker.

**I4 (Info):** the restart scan follows array order, not `at_ms`. A restart supplied
out of order (R24: activity at 1000 listed before stopped at 0) returns
`unknown/UNSTABLE_OR_INVALID_SEQUENCE`, not the restart block. It can never pass
because the sequence loop rejects unordered times; the collector must emit samples in
query order.

## 2. Incident precedence: resolved for the window flag (L6); L9 remains for samples

Explicit `launch_during_sampling === true` on the window or any element is still the
first check (v3:109-113). Immediately after it, any object input whose window flag is
not exactly `false` returns `blocked/LAUNCH_NOT_EXCLUDED` (v3:114-119). I probed
`undefined`, `null`, `'false'` and `0` against a contradiction, invalid kind, 17
samples over the PR-01 cap, deadline overrun, missing `closed_ms` and a restart
sequence: all 24 are now `LAUNCH_NOT_EXCLUDED`, where v2 returned
`unknown/CONTRADICTORY…` or `unknown/INVALID_WINDOW` for the first three (N1 family).
`true` keeps `LAUNCH_DURING_SAMPLING` in all six. An empty array input is also
blocked; `null` and string inputs stay `unknown/INVALID_WINDOW` because they cannot
carry the attestation.

**L9 (Low): uncertain sample-level launch can still become `unknown`.** The v4.3
note says "a known or uncertain attempt cannot become a read-only re-observation case
merely because another field is invalid." That holds for explicit attempts and for
the window flag, not for a sample whose own flag is missing on an otherwise available
sample. That sample is still detected only inside the sequence loop (v3:174-176),
after the contradiction, shape, closure, handles, planned-Quit and deadline returns
and after any earlier bad sample. The v2 review kept the rule that such a sample is
an incident.

| Probe (PR-01, window flag `false`, one sample with flag `undefined`) | v2 | v3 |
| --- | --- | --- |
| U1 nothing else wrong | blocked/LAUNCH_DURING_SAMPLING | blocked/LAUNCH_DURING_SAMPLING |
| U2 deadline overrun | unknown/DEADLINE_EXCEEDED | unknown/DEADLINE_EXCEEDED |
| U3 after an unavailable sample | unknown/INCOMPLETE_OBSERVATION | same |
| U5 contradiction in another sample | unknown/CONTRADICTORY… | same |
| U6 over cap | unknown/INVALID_WINDOW | same |
| U7 `closed_ms` missing | **blocked**/LAUNCH_DURING_SAMPLING | **unknown**/INVALID_CLOSURE_TIMING |
| U10 `handles_closed:false` | unknown/HANDLES_NOT_CONFIRMED_CLOSED | same |

Most of this predates v3, but U7 is new: the added `closed_ms` gate sits ahead of the
loop and turns a v2 block into `unknown`. U1 also shows a label conflation. An
uncertain sample flag reports `LAUNCH_DURING_SAMPLING` (the explicit-attempt reason),
while the same uncertainty at window level reports `LAUNCH_NOT_EXCLUDED`. None of
these pass. *Fix:* right after the window-level check, return
`blocked/LAUNCH_NOT_EXCLUDED` if any element is one that `classifySample` itself
reports as `LAUNCH_NOT_EXCLUDED`, which keeps the accepted availability split, and
use that reason in the loop too.

## 3. L8 one timestamp meaning and separate closure: resolved

Every `at_ms` is now compared only to other `at_ms` values (v3:169-171). A window-level
`closed_ms` must be a safe non-negative integer equal to `now_ms` (v3:142-147), every
`at_ms` must be ≤ `now_ms` (v3:168), and the deadline uses `now_ms − start_ms`
(v3:158-160). So `last at_ms ≤ closed_ms = now_ms ≤ start_ms + bound` holds and closure
cannot extend the window.

| Probe (PR-01 unless noted) | v2 | v3 |
| --- | --- | --- |
| T1 queries at 0 and 1000, closed 1200 | unknown/STALE_LAST_SAMPLE | pass |
| T2 queries 999 ms apart | unknown/UNSTABLE… | unknown/UNSTABLE… |
| T3 `closed_ms` missing, `null`, `'1000'`, −1, 999, 1001 | **pass** (field ignored) | unknown/INVALID_CLOSURE_TIMING |
| T3 fractional or 2^53 times | unknown/INVALID_WINDOW | same |
| T4 queries 13000/14000, closed 15000 | unknown/STALE_LAST_SAMPLE | pass |
| T5 closed 15001 | unknown/DEADLINE_EXCEEDED | same |
| T6 / T7 SH-01 last query 90000 closed 90000 / closed 90001 | pass / unknown | pass / unknown/DEADLINE_EXCEEDED |
| T8 a query after `closed_ms` | unknown/UNSTABLE… | same |
| T9 / T10 `start_ms` 5000, closed 20000 / 20001 | unknown / unknown | pass / unknown/DEADLINE_EXCEEDED |
| T11 query before `start_ms` | unknown/UNSTABLE… | same |

The post-loop check `previous.at_ms > input.closed_ms` (v3:184-185) is unreachable
after v3:168 and harmless (I6). `closed_ms`, `now_ms`, `handles_closed` and the
launch flags are injected attestations; the core observes no clock, no handle and no
interval between queries. It cannot detect overlapping batches, and the note says so.

## 4. Prior repairs and unchanged surfaces: supported

`desktopKey`, `mapOpenResult`, `mapRunValueResult` and `classifySample` are
behaviourally unchanged; the only `classifySample` edit replaces computed field lookups
with static ones (diff v2→v3:49-102). Probes:

- **M1:** P1c, P1d, P1g are v1 `unknown`, v2 and v3 `blocked/LAUNCH_DURING_SAMPLING`.
- **M2:** P3 is v1 `pass`, v2 and v3 `unknown/PLANNED_QUIT_NOT_ESTABLISHED`; truthy
  `1`, `'true'`, origin 1 and `'0'` are all refused.
- **M3:** P2 is v1 `blocked/PRELAUNCH_ACTIVITY`, v2 and v3
  `unknown/CONTRADICTORY_POSTGRES_OBSERVATION`, including before `start_ms`.
- **Admission and key:** the three admitted spellings give `d8c7860557013e56`;
  OneDrive components, double backslash and forward slash are `UNADMITTED_KEY`;
  missing attestations are `UNATTESTED_KEY`. `MyOneDrive` stays bound, as native.
- **Open/Run mapping:** 0 present, 2 absent, others unavailable; open needs
  `keyBound === true`.
- **Counts:** string, negative, fractional, NaN, missing counts and pg_ctl `'3'` or 4
  are `unavailable`; missing Run value or non-boolean reconciliation are
  `CONTINUITY_UNRESOLVED`.
- **Binding stability, PR-01 activity, one sample, empty:** unknown, blocked, pending,
  pending.
- **Redaction:** injected `password`, `raw_error`, `reason`, `status` and `fixture`
  fields never reach the output, which stays `{fixture:true,status,reason}`.
- **Fixture labelling:** every output carries `fixture: true`; the module header and
  receipt say no OS observation or authority.

Inherited-test changes are justified. Besides the M4 expectations, the default helper
adds `closed_ms`, one manual SH-01 fixture adds it, `STALE_LAST_SAMPLE` becomes
`INVALID_CLOSURE_TIMING`, and test 9's malformed *objects* now expect `blocked`
because they lack the window flag (L6). None weakens a gate. **I5 (Info):** after that
test 9 change, no v3 test asserts `INVALID_WINDOW` by reason for a window whose launch
flag is `false`. My probes R19 and T3 show it still works.

## 5. L7 verifier: requested checks present; L10 remains

`purityGuard` now rejects every `ElementAccessExpression` (including `?.[]`) and
`MetaProperty`, plus the identifiers `Math`, `crypto`, `Reflect`, `Proxy` and
`constructor` with the earlier list (verify.mjs:18-26). It admits the actual source,
whose only free globals are `Number`, `Array` and the imported `createHash`. The 14
source mutants and two TAP mutants (`# pass 180`, a duplicated `# pass 18`) are
rejected; totals use `^# name n\r?$` with exactly one match. No-argument mode
compares and writes nothing; `--record` uses `wx`. The verifier reads the recorded TAP
and does not run tests.

**L10 (Low): the hardened guard still has bypasses that do not use element access.**
My verbatim copy of `purityGuard` accepts all of these:

- `const {['constr'+'uctor']:F}=()=>0; F('return 1')()`, a computed key in a
  destructuring pattern. I confirmed it reaches `Function` at runtime.
- `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(()=>0),'constr'+'uctor').value(…)()`,
  also confirmed to reach `Function`.
- `Intl.DateTimeFormat('en',{timeStyle:'full'}).format()` reads the clock, and
  `Intl.DateTimeFormat().resolvedOptions().timeZone` reads the environment.
- `console.log`, `Object.defineProperty(Object.prototype, …)`, `structuredClone`,
  `WebAssembly`, `Atomics` and `Promise`.

None appears in the actual source, so today's verdict is unaffected. The note and
report already say AST checks are supplemental, not proof that arbitrary JavaScript
is pure. *Fix:* a successor guard can allowlist free identifiers (for example
`Number`, `Array`, `createHash`) instead of a denylist, and reject `ComputedPropertyName`.

## 6. Baseline regression evidence: supported

My probes reproduce every value in `baseline-probes.json`: R1–R3 v2 `pass` → v3
`blocked/RESTART_AFTER_STOPPED_SAMPLE`, R4 `pass` in both, and N1 v2
`unknown/CONTRADICTORY_POSTGRES_OBSERVATION` → v3 `blocked/LAUNCH_NOT_EXCLUDED`. The
retained attempts match the report. `tests-initial.tap` failed tests 7 and 12 (16/18),
`tests-second.tap` still failed test 7 (17/18), and `tests-final.tap` is 18/18. The
module hash is the same one I tested, so the report's statement that the core did not
change between attempts is consistent, though not provable from TAP alone. Frozen v1
and v2 bytes and all prior receipts are unchanged (rehash).

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| L9 | Low | Uncertain sample-level launch downgraded to `unknown` by earlier rejections (one new path via `closed_ms`); reason conflated with explicit launch; v4.3 sentence overstates | Open, core and note |
| L10 | Low | Guard bypasses without element access (computed destructuring, descriptor `Function`, `Intl` clock and environment, `console`, prototype mutation) | Open, successor verifier |
| L1, L4 | Low | Carried | Future collector scope |
| I1–I3 | Info | Carried (getter contradiction branch, caller-chosen kind, no prompt first sample) | Collector scope |
| I4 | Info | Restart scan uses array order; unordered restart returns `unknown`, never pass | Collector must emit in order |
| I5 | Info | No test asserts `INVALID_WINDOW` by reason with launch flag `false` | Probes confirm behaviour |
| I6 | Info | Unreachable post-loop closure check | Harmless |
| M4, L6, L8 | (were Medium/Low) | Restart, window launch precedence, timestamp meaning | **Resolved** |
| L7 | (was Low) | Requested guard checks | **Resolved as specified**; L10 remains |
| M1, M2, M3, L2 | (resolved earlier) | Prior repairs | Still resolved |

No Critical, High or Medium findings. No PR-01 or SH-01 false pass found.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Still pending:
the exact launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation,
database port, pg_bin with pg_ctl/postgres identity provenance, continuity since the
historical shutdown, workspace ID and current owner/editor role, a reviewed scope
manifest, a concrete operational grant and a bounded session decision. Reader N1–N4
and classifier L1/L4 remain for the adapter and collector. R is separate and H is
Jordan's alone.

## Smallest precise next eligible implementation prompt (not executed)

> Preserving classifiers v1–v3, their tests, reports, TAP, receipts and verifiers,
> notes v4.1–v4.3, reader v2, proposal v4, checklist v5 and the M3 decision byte for
> byte, add in new files a pure fixture classifier v4 and tests that differ from v3
> only in this: (L9) right after the window-level `LAUNCH_NOT_EXCLUDED` check, return
> `blocked/LAUNCH_NOT_EXCLUDED` when any element is one `classifySample` reports as
> `LAUNCH_NOT_EXCLUDED`, and use that reason instead of `LAUNCH_DURING_SAMPLING` for
> such a sample in the loop. Add regression tests for probes U1–U7 and U10 (including
> missing `closed_ms`) and an `INVALID_WINDOW` reason assertion with the launch flag
> `false`. Add a short v4.4 note correcting the v4.3 sentence on uncertain attempts.
> Record a new check-only receipt whose verifier (L10) allowlists free identifiers
> (`Number`, `Array`, `createHash`), rejects `ComputedPropertyName`, and self-tests the
> L10 mutants. No collector, OS, registry, process, mutex, event, config read or launch.
> Then commission a separate uninvolved review of those exact bytes. Full C54 stays
> partial.
