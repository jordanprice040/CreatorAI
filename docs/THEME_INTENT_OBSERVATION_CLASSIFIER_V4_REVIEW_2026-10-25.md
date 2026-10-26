# Observation classifier v4 and proposal v4.4 note independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **pass for the fixture repair scope, with one Low finding.** v4 implements
the v3 review's final repair prompt exactly: the only source change is the L9
sample-uncertainty pre-scan and keeping the sample's own incident reason in the loop.
I reproduced U7 against frozen v3 myself, found no new pass and no PR-01 or SH-01 false
pass, and confirmed every prior control. The new verifier closes every L10 mutant the
v3 review named, but its guard still accepts a string-literal destructuring key that
reaches `Function` and assignments that mutate the allowed intrinsics (L11). The
actual source uses neither. Four separate answers, none of which implies another:

| Question | Answer |
| --- | --- |
| Fixture classifier support | **Supported.** L9 resolved for U1–U7 and U10 and every earlier-rejection path I tried; the availability split, explicit-launch priority, M1–M4, L6, L8, timing, key, binding, count, redaction and planned-Quit controls are unchanged. |
| v4.4 note support | **Supported.** It accurately supersedes the v4.3 sentence, matches v4's precedence order, keeps the availability split, and claims no authority or operational evidence. |
| Operational collector exists | **No.** Only the v4 test file, `record-baseline.mjs` and my probes import the module; `verify.mjs` reads it as text. No collector, adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, a reviewed scope manifest, a collector and its review, and an operational session decision are all pending. |

A fixture classification is not observed shutdown, zero dispatch, live scheduler
state, launch authority or Jordan's human acceptance. The accepted M3 exact-bundle
scheduling decision is preserved and not reopened (its bytes rehash unchanged). Reader
N1–N4 and classifier L1/L4 stay future adapter/collector work. Full C54 remains
partial; native acceptance and H remain unverified. This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This session
did **not** write classifier v4, its tests, the v4 repair report, the v4.4 note,
`verify.mjs`, `record-baseline.mjs`, `baseline-probes.json`, `tests-final.tap` or the
repair receipt. The repair receipt records its author as "Authored
classifier-v4/tests/report/v4.4 note; not independent support", and the project
coordinator says Codex likely prepared the repair. The files are untracked, so git
cannot confirm authorship. v4 implements the prompt written by the separate Claude
thread that reviewed v3. I have none of that thread's context beyond its committed
report and receipt, but it is the same model family. This is a **separate-session
review, not blinded and not a different-model-family review.**

## Exact bindings

Every input was rehashed before any check by a reviewer script that reads bytes only.
All **101** paths bound by the v4 repair receipt match (`101/101`, zero mismatches).
The verifier's figure of **180** is bindings counted across three overlapping prior
maps (v3 review inputs, v3 review report, v3 repair inputs). Those 180 bindings cover
**92 distinct prior paths**, with no path bound to two different hashes. The other 9
receipt paths are the 8 new v4 files plus the v3 review receipt.

The verifier's mutable-tracking exclusion (`BUILD_STATUS.md`, `SESSION_HANDOFF.md`,
`DECISIONS.md`) is explicit in code but **excluded nothing** this time: none of the
three prior maps binds those files, and the receipt's `excluded_preupdate_tracking` is
`[]`. The tracking entries' phrase "historical mutable tracking excluded explicitly"
describes the mechanism, not an exclusion that occurred (I8).

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-observation-classifier-fixture-v4.mjs | `f82dc17b936ec89e430ed2ab64ffb56853981aa4731eff4e1585488742a474eb` |
| tests/theme-intent-observation-classifier-fixture-v4.test.mjs | `74399755d407bdacdfbb30f6a6e60aaf1791e6c273b67eba2e9e96a33c574c46` |
| v4 repair report | `63fc804aac4dfd8229f7dce6c83d39f9a6ae23c2ad391ca17dc53be766cb0e9e` |
| v4.4 note | `8e16285877661423961979d436661f5d4d1787832e24f0076163d6a4dac5b618` |
| verify.mjs | `6a805bb7d88258e49263cca6cd7286b76c01713956544040257741e601f57783` |
| record-baseline.mjs | `b3f9078a9cd8e3ce064e9b01ddb0b184767d6cfa69c29aadeb40656514c0b81c` |
| baseline-probes.json | `9fe470c63309df967b7ea77337aa53de27a83f3c2f6a160a75b60252b82a7045` |
| tests-final.tap | `a78ad1ff5471a56df157ee7a4394d0c2fb3ce6e1ea53b3c5a3c2dd47669c09c4` |
| Repair receipt (not self-bound) | `4e70e4007dc2b08834604e91246b69e4cd2601f3cdab539e23226d589bed7bd0` |
| v3 review report / receipt | `56b26ac8…a084` / `686cae4d…edd8` |
| Frozen v3 module / v4.3 note | `e894f036…6615` / `57ea5ce9…8dda` |

The full map is in
`tracking/evidence/theme-intent-observation-classifier-v4-review-2026-10-25/reviewer-receipt.json`.

## Checks actually executed (Windows 11, Node 22.21.0, TypeScript 5.9.3)

Executed by me, separately from anything recorded:

1. **Rehash:** 101/101 receipt-bound inputs match; 180 overlapping bindings over 92
   distinct prior paths recomputed independently from the two prior receipts.
2. **New verifier, check-only:** `node tracking/evidence/theme-intent-observation-classifier-v4-2026-10-25/verify.mjs`
   with no arguments, never `--record`. Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings_including_overlap":180,"prior_distinct_paths":92,"mismatches":0,"fixture_test_groups_passed":20,"fixture_test_groups_failed":0,"anchored_unique_TAP_totals":true,"AST_source_guard":true,"guard_negative_self_checks":28,"baseline_missing_closure_regression":true}`,
   exit 0. The repair receipt hash was `4e70e400…7bd0` before and after (identical
   bytes). No older verifier ran.
3. **Fixture tests:** `node --test tests/theme-intent-observation-classifier-fixture-v4.test.mjs`
   gave 20/20 pass, 0 fail, 0 cancelled, 0 skipped, exit 0.
4. **Reviewer probes:** 210 window fixtures run through both frozen v3 and v4, plus
   58 `classifySample` inputs compared across v3 and v4, plus key, mapping and
   redaction calls, from a scratchpad script that imports only those two modules (no
   I/O, OS, clock or environment use).
5. **Verifier-guard probes:** `purityGuard` sliced verbatim from the v4 `verify.mjs`
   text and run on 31 source strings with the repository's `typescript` package.
   Parsing only; two accepted expressions were also evaluated in a bare `node -e`
   to confirm their effect (no file, OS or network access).
6. **Static reading** of v4 against v3 (`diff`), the v4 tests against the v3 tests,
   the v4.3 and v4.4 notes and the v4 repair report.

Read but not executed: `tests-final.tap` (20/20) and `baseline-probes.json`.
`record-baseline.mjs` was **not** run because it writes evidence; my probe script
reproduces its exact input separately.

No operational read, saved configuration, credentials, environment, registry,
process, port, mutex or event query, launch, sign-in, helper, installer, migration,
SQL, provider, workflow, recovery, cleanup or retired checkout. Receipt-embedded
operational paths were read as bytes for hashing only. Rust was not rebuilt or rerun.

## 1. Implementation against the repair prompt: exact

`diff` v3→v4 shows two hunks and nothing else:

- v4:120-127 adds, right after the window-level `LAUNCH_NOT_EXCLUDED` check, a scan
  that returns `blocked/LAUNCH_NOT_EXCLUDED` when any element is one that
  `classifySample` itself reports as `LAUNCH_NOT_EXCLUDED`.
- v4:183 returns `blocked` with the sample's own `result.reason` in the loop, instead
  of the fixed `LAUNCH_DURING_SAMPLING`.

`desktopKey`, `mapOpenResult`, `mapRunValueResult` and `classifySample` are
byte-identical, and my 58 `classifySample` inputs (six flag values crossed with
availability, time, binding, contradiction, attestation, activity and count defects,
plus `null`, `undefined`, `{}` and a string) give identical output in v3 and v4.

## 2. L9 sample-level uncertainty: resolved

**U7 reproduction.** The exact `record-baseline.mjs` input (PR-01, window flag
`false`, `closed_ms` absent, samples at 0 and 1000, the second with flag `undefined`)
gives v3 `unknown/INVALID_CLOSURE_TIMING` and v4 `blocked/LAUNCH_NOT_EXCLUDED`. That
matches `baseline-probes.json`.

For each sample flag value `undefined`, `null`, `'false'`, `0`, `'true'` and `1`
(PR-01, window flag `false`, the uncertain sample otherwise available):

| Probe | v3 | v4 |
| --- | --- | --- |
| U1 nothing else wrong | blocked/LAUNCH_DURING_SAMPLING | blocked/LAUNCH_NOT_EXCLUDED |
| U2 deadline overrun | unknown/DEADLINE_EXCEEDED | blocked/LAUNCH_NOT_EXCLUDED |
| U3 after an unavailable sample | unknown/INCOMPLETE_OBSERVATION | blocked/LAUNCH_NOT_EXCLUDED |
| U4 after an activity sample | blocked/PRELAUNCH_ACTIVITY | blocked/LAUNCH_NOT_EXCLUDED |
| U5 contradiction in another sample | unknown/CONTRADICTORY… | blocked/LAUNCH_NOT_EXCLUDED |
| U6 over cap (18 samples) | unknown/INVALID_WINDOW | blocked/LAUNCH_NOT_EXCLUDED |
| U7 `closed_ms` missing, `null` or 999 | unknown/INVALID_CLOSURE_TIMING | blocked/LAUNCH_NOT_EXCLUDED |
| U10 `handles_closed:false` | unknown/HANDLES_NOT_CONFIRMED_CLOSED | blocked/LAUNCH_NOT_EXCLUDED |
| Invalid kind; earlier sample with bad `at_ms` | unknown/INVALID_WINDOW, unknown/UNSTABLE… | blocked/LAUNCH_NOT_EXCLUDED |
| Unordered, binding change, 999 ms spacing | unknown/UNSTABLE… | blocked/LAUNCH_NOT_EXCLUDED |
| SH-01 planned Quit false (stopped sample, then the uncertain one) | blocked/RESTART_AFTER_STOPPED_SAMPLE | blocked/LAUNCH_NOT_EXCLUDED |
| SH-01 restart before or after the uncertain sample | blocked/RESTART_AFTER_STOPPED_SAMPLE | blocked/LAUNCH_NOT_EXCLUDED |

Every row gives the same result for all six flag values. The label conflation is fixed:
sample-level and window-level uncertainty now share `LAUNCH_NOT_EXCLUDED`.

**Explicit launch keeps priority.** `true` on the window or on any element still
returns `LAUNCH_DURING_SAMPLING` with an uncertain sample present, alongside a
contradiction, missing `closed_ms`, an uncertain window flag, 20 samples over cap, a
malformed sample object, or after an SH-01 restart.

**Availability split unchanged.** When the uncertain sample is also unavailable, has a
fractional or negative time, a malformed binding or is itself contradictory,
`classifySample` reports `INCOMPLETE_OBSERVATION` or `CONTRADICTORY…` exactly as in v3,
the pre-scan does not fire, and the window returns the same `unknown` reason in v3 and
v4. None passes. When the uncertain sample instead has a missing attestation, a bad
count or SH-01 activity, `classifySample` reaches the launch check first, as it did in
v3, so v4 now reports `LAUNCH_NOT_EXCLUDED` (v3 `LAUNCH_DURING_SAMPLING` or
`RESTART…`). That ordering is `classifySample`'s own and is unchanged.

**INVALID_WINDOW with window flag `false`.** Invalid kind, string `samples`,
`now_ms < start_ms`, fractional `start_ms`, 17 PR-01 samples and 92 SH-01 samples
each return `unknown/INVALID_WINDOW`; the new test asserts the first two by reason
(closes I5).

## 3. Prior repairs and unchanged surfaces: supported

Identical results in v3 and v4 for every non-uncertain probe:

- **Passes:** only the PR-01 control, the SH-01 shutdown control, 91 SH-01 samples at
  the cap, PR-01 at exactly 15000 ms and R4 (activity before the first stopped sample)
  pass, in both versions. No v3 non-pass became a v4 pass.
- **M4 / restart:** R1–R3, R5 (restart then 80 clean samples), restart then
  unavailable, contradiction or `null`, and restart with missing `closed_ms` all stay
  `blocked/RESTART_AFTER_STOPPED_SAMPLE`; restart then explicit launch stays
  `LAUNCH_DURING_SAMPLING`; the unordered restart stays `unknown/UNSTABLE…` (I4).
- **L6:** window flag `undefined`, `'false'` and an empty array stay
  `blocked/LAUNCH_NOT_EXCLUDED`; `null` and string inputs stay `unknown/INVALID_WINDOW`.
- **L8 timing and deadline:** `closed_ms` ≠ `now_ms`, string or missing →
  `INVALID_CLOSURE_TIMING`; 15001 ms PR-01 and 90001 ms SH-01 → `DEADLINE_EXCEEDED`.
- **M2 planned Quit:** request origin 1, `planned_quit:1`, running state unrecorded →
  `PLANNED_QUIT_NOT_ESTABLISHED`. `handles_closed` undefined →
  `HANDLES_NOT_CONFIRMED_CLOSED`.
- **M3:** contradiction in PR-01, including before `start_ms`, and before the first
  stopped SH-01 sample → `unknown/CONTRADICTORY_POSTGRES_OBSERVATION`.
- **Key and mapping:** both admitted spellings give `d8c7860557013e56`; OneDrive,
  double backslash and forward slash are `UNADMITTED_KEY`; missing attestations are
  `UNATTESTED_KEY`; open/Run mapping is 0 present, 2 absent, others or unbound
  unavailable.
- **Redaction:** injected `password`, `raw_error`, `reason` and `status` never reach
  the output, which stays `{fixture:true,status,reason}`.

**Inherited tests.** The v4 test file differs from v3 only in its import path and two
appended groups; no inherited line changed, so no assertion was weakened. Test 8
asserts only `status` for an `undefined` sample flag, which is why the U1 relabel did
not need an inherited edit. The new groups cover U1–U7/U10 for four flag values,
explicit-launch priority, the same-sample availability split and `INVALID_WINDOW` by
reason.

**I7 (Info):** the loop's `incident` branch (v4:183) is unreachable for ordinary data,
because both incident reasons are now caught before the loop. It is harmless defence in
depth. **I9 (Info):** no test asserts that sample uncertainty outranks an SH-01
restart; my probes show it does, as the v4.4 note states.

## 4. L10 verifier guard: requested checks present; L11 remains

The v4 guard builds a TypeScript program with `noLib`, admits identifiers whose symbol
is declared in the source plus the free names `Number`, `Array` and `createHash`, rejects
`ComputedPropertyName`, `ElementAccessExpression`, `new`, `MetaProperty`, dynamic import,
re-exports and the identifiers `constructor`, `__proto__` and `prototype`, and requires
exactly one `import {createHash} from 'node:crypto'`. It admits the actual v4 source.

My verbatim copy rejects every L10 mutant from the v3 review and these extra cases:
scope leakage from an inner `const Intl`, a free name in shorthand (`{Intl}`), a default
parameter, a binding-element source (`{now:n}=Date`), `globalThis`, `eval`, `arguments`,
`undefined`, a block-scoped `function console`, a JSDoc typedef named `console`,
`export * from`, `Number.constructor`, `createHash(...).constructor`,
`Array.prototype.x`, and a unicode-escaped `constructor` identifier. Local bindings
that shadow a global name (`const Math=1`, `class Intl{}`, `catch(console)`) are
correctly treated as local.

**L11 (Low): the allowlist guard still accepts two impure forms.**

- `const {'constructor':F}=()=>0; F('return 1')()` uses a *string-literal* property name
  in a destructuring pattern. It is neither computed nor an identifier, so the guard
  accepts it. In bare `node -e` it gives `F === Function` and returns the function
  body's value.
- `Number.isSafeInteger=()=>true;` and `Array.isArray=()=>false;` assign to properties
  of allowed intrinsics. The guard accepts both, and in a bare module
  `Number.isSafeInteger(0.5)` then returns `true`. Such a line would mutate shared global
  state and could silently disable the classifier's own time gate.

Neither appears in the reviewed source, so today's verdict is unaffected. This is a
supplemental source guard, not a general purity proof; the v4.4 note and repair
report say exactly that. *Fix:* reject string-literal property names equal to
`constructor`, `__proto__` or `prototype` in every property-name position (or any
string-literal key in a binding pattern), and reject assignment, compound assignment,
`delete` and `++`/`--` whose target's root is a non-local identifier.

Also accepted but harmless: `this` inside a function (undefined in a module), getters
on local objects, and `with` (a syntax error when the module loads; the guard only
checks parse diagnostics).

## 5. v4.4 note: supported

The note says explicit launch anywhere wins; then the uncertain window flag; then any
sample `classifySample` reports as `LAUNCH_NOT_EXCLUDED`, before restart,
contradiction, shape, cap, closure, planned-Quit, deadline or sequence rejection. That
is v4's order (v4:109-127), confirmed by the probes above. Its statement that
same-sample availability, time, binding or contradiction failures "need not be
classified as launch uncertainty" and "still cannot pass" matches section 2. It
supersedes only the v4.3 sentence "a known or uncertain attempt cannot become a
read-only re-observation case…" and leaves the rest of v4.3 in force. It says
uncertainty is not proof of an attempted launch, that no collector exists, that inputs
must be ordinary data rather than hostile getters, and that the guard is supplemental.
It grants no authority, claims no operational evidence and leaves M3, native
acceptance, H and full C54 where they were. Its guard description is accurate; it does
not claim the guard is complete, so L11 does not make it wrong.

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| L11 | Low | Guard accepts string-literal `constructor` destructuring (reaches `Function`) and mutation of allowed intrinsics | Open, successor verifier; source clean |
| L1, L4 | Low | Carried | Future collector scope |
| I1–I4 | Info | Carried (getter contradiction branch, caller-chosen kind, no prompt first sample, array-order restart scan) | Collector scope |
| I6 | Info | Unreachable post-loop closure check (v4:191) | Harmless |
| I7 | Info | Loop `incident` branch unreachable for ordinary data | Harmless |
| I8 | Info | Mutable-tracking exclusion excluded nothing; tracking wording describes the mechanism | Wording only |
| I9 | Info | No test for uncertainty outranking an SH-01 restart | Probes confirm behaviour |
| L9 | (was Low) | Sample-level uncertainty and label | **Resolved** |
| L10 | (was Low) | Named guard bypasses | **Resolved as specified**; L11 remains |
| I5 | (was Info) | `INVALID_WINDOW` reason test | **Resolved** |
| M1–M4, L2, L6, L8 | (resolved earlier) | Prior repairs | Still resolved |

No Critical, High or Medium findings. No PR-01 or SH-01 false pass found.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Still pending:
the exact launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation,
database port, pg_bin with pg_ctl/postgres identity provenance, continuity since the
historical shutdown, workspace ID and current owner/editor role, a reviewed scope
manifest, a concrete operational grant and a bounded session decision. Reader N1–N4
and classifier L1/L4 remain for the adapter and collector. R is separate and H is
Jordan's alone.

## Smallest precise next eligible prompt (not executed)

L11 does not affect the reviewed source, so the classifier needs no further repair
for fixture scope. The smallest next step is verifier-only:

> Preserving classifiers v1–v4, their tests, reports, TAP, receipts and verifiers,
> notes v4.1–v4.4, reader v2, proposal v4, checklist v5 and the M3 decision byte for
> byte, add in a new evidence directory a check-only verifier that applies the v4
> `purityGuard` plus two rules (L11): reject string-literal property names equal to
> `constructor`, `__proto__` or `prototype` in any property-name position, and reject
> assignment, compound assignment, `delete` and `++`/`--` whose target's root is a
> non-local identifier. Self-test the two L11 mutants and keep every v4 mutant. Run it
> against the unchanged classifier-v4 bytes, record a new receipt with `wx`, and then
> commission a separate uninvolved review of those exact bytes. No collector, OS,
> registry, process, mutex, event, config read or launch. Full C54 stays partial.

Alternatively, Jordan may accept L11 as a documented limitation of a supplemental
guard and move to the owner attestations the collector needs; that choice is Jordan's.
