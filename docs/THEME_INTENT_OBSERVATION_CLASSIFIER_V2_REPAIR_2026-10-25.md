# Observation classifier v2 repair — October 25, 2026

Status: fixture-only repair implemented and verified; independent exact review
pending. User authorized the review's bounded next step. All classifier-v1 files,
its tests/report/v4.1 note, reader v2, proposal v4, checklist v5, M3 scheduling
decision and earlier receipts remain unchanged. No operational work occurred.

## Repair and input changes

New module: scripts/theme-intent-observation-classifier-fixture-v2.mjs.
New tests: tests/theme-intent-observation-classifier-fixture-v2.test.mjs.
The core still imports only deterministic node:crypto and consumes JSON-like
injected records. It performs no file/OS/environment/network/clock/object queries.

- M1: explicit launch flags are checked first by classifySample. classifyWindow
  scans every supplied array sample and the window flag before ANY other return,
  including malformed/over-cap/deadline/spacing/availability/activity paths. A known
  launch always returns blocked/LAUNCH_DURING_SAMPLING, never an unknown retry case.
- M2: SH-01 additionally requires running_state_recorded:true, planned_quit:true and
  a safe-integer quit_request_ms exactly equal to start_ms. Otherwise unknown with
  PLANNED_QUIT_NOT_ESTABLISHED. Two zero-count samples alone no longer pass.
- M3: pg_ctl_status0 with postgres_processes0 is a contradiction, checked across
  the whole sample array before sequence/activity returns. It makes either kind
  unknown/CONTRADICTORY_POSTGRES_OBSERVATION for that window. Explicit launch has
  higher priority. Noncontradictory SH-01 activity may still precede a stopped pair.
- L2: any LOCALAPPDATA component starting with onedrive (case insensitive) is
  unavailable, matching Home::check_home. Other admitted Rust vectors are unchanged.
- L3: a window-level launch_during_sampling:false and handles_closed:true are now
  required, alongside existing per-sample fields. See the v4.2 note for exact timing
  semantics and the show-event lifetime effect. Missing no-attempt attestation
  blocks; missing closure confirmation is unknown. No actual closure is observed.

The new v4.2 note is additive and names its precedence without editing frozen v4
or v4.1. Completion timestamps now mean after final handle closure; all closure
must fit the original window, not extend it. The future collector must supply and
bind these semantics. Explicit launch is always an incident even when other input
is bad. Unplanned exits require reconciliation; unknown preconditions grant nothing.

Outputs retain fixed fields and fixture:true. Map helpers remain fixed vocabulary
strings (review L1, future collector scope). Injected binding booleans/tokens and
folded counts are still not independently verified. Distinct per-target identity,
Local-namespace and unexpected-lease evidence (L1/L4) remain for that later scope.
Contradiction detection is the reviewed minimum predicate, not exhaustive OS-result
consistency. The core cannot validate assertions hidden inside folded fields.

## Executed checks

Windows Node fixture suite:15/15 test groups passed first run, zero failures/skips.
The inherited ten groups still pass with SH-01 valid preconditions supplied and the
old pg_ctl0/zero-process expectation corrected to contradiction. Five new groups
exercise M1 probe paths P1a/P1c–P1g, M2 P3, M3 P2, OneDrive P4 and whole-window
no-attempt/closure requirements. Positive controls still pass: proper planned Quit,
noncontradictory shutdown activity and deadline-bound stopped pairs.

Separate pure baseline probes reproduce the actual frozen v1 defects and show v2:
M1 unknown becomes launch incident; M2 pass becomes unknown planned-Quit missing;
M3 pass becomes unknown contradiction. Recorded JSON and final TAP/source hashes:
tracking/evidence/theme-intent-observation-classifier-v2-2026-10-25/.
No old tests/verifiers were rewritten or rerun to replace receipts. New verifier
checks preserved inputs, anchored exact TAP totals, and AST-based source import/
forbidden-dependency guards. These are supplemental guards, not a proof of arbitrary
JavaScript purity; exact independent code review is still required. Guard self-checks
reject dynamic import, require/global process, performance.now and a pass150 false
match. Verification compares only by default; --record creates exclusively once.

## Remaining scope and next eligible review prompt

In a separate uninvolved U02 session review classifier v2/tests, this report, the
v4.2 note and new repair receipt/check-only verifier against the exact prior review.
Declare involvement. Rehash repository inputs; run only pure fixture tests if
needed. Verify M1 precedence over every early return, M2 all SH-01 preconditions,
M3 contradiction persistence and launch priority, native OneDrive admission, L3
window/closure semantics, sampling boundaries, redaction and continued purity.
Assess AST/TAP guards as supplemental, not native evidence. Preserve frozen v1,
reader v2/proposal/checklist/M3 and all old receipts. Do not run --record or any
old receipt-writing verifier.

No operational config, environment, registry/process/port/mutex/event observation,
launch, SQL, helper/installer, provider/workflow call, activation, recovery, cleanup
or retired checkout. Produce exact-input report/receipt, per-area verdicts, actual
checks, limitations and smallest next bounded implementation prompt. Do not execute
that next task. No collector or real-config adapter exists; reader N1–N4 and
classifier L1/L4 remain future adapter/collector work. Active home, continuity,
workspace/current owner-editor, tools, reviewed manifest and concrete operational/
session grants remain pending. M3 scheduling decision unchanged. Full C54 partial;
native acceptance and Jordan H unverified. This author cannot independently support
these new implementation bytes.
