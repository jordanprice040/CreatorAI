# CW-01 fixture core v2 repair independent re-review — October 26, 2026

Prompt: U02 (independent review), repository-only, per the re-review prompt at the
end of `docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REPAIR_2026-10-26.md`
(`2f765ae4…a810`) and its receipt `repair-receipt.json` (`77bd6755…f8b8`). The
repair answers `docs/THEME_INTENT_CW01_FIXTURE_CORE_REVIEW_2026-10-26.md`
(`d4d05a86…2c04`). Governing design chain: `7aaa898c…7252`, `7619804d…f196`,
`0462b516…bb81`, `d7628032…de58`. Reviewed code: core
`scripts/theme-intent-cw01-core-fixture-v2.mjs` (`f72b9ea1…a1de`) and tests
`tests/theme-intent-cw01-core-fixture-v2.test.mjs` (`3309e810…624c`).

## Verdicts

- **Fixture core v2 and tests: SUPPORTED as a fixture-only slice, with three Low
  conditions (R-1 to R-3) to carry forward or repair narrowly.** F1, F2 (as the
  prior review specified it) and F3 are fixed. I found no false pass in the
  cases the prior review named and no regression against v1. The Low items are
  gaps next to the repaired areas, not reopenings of F1–F3.
- **v1 files, SQL asset and frozen inputs: byte-unchanged.** All 25 preserved
  hashes and the 5 new-file hashes in the repair receipt match.
- **I-1 erratum: accurate.** The asset header (line 15) says "A02/B01"; the
  markers `@A02 … params=actor` and `@B02 … params=actor` are the actor-bound
  statements, and `@B01` is `BEGIN`.
- **15 s pre-spawn bound for preflight and job context: confirmed** (reasoning
  below).
- **Fixture-to-operational promotion: none.** `admitOperationalGate` never
  admits and now also refuses receipt format `/1`.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0/native acceptance is blocked, NI
  not-run, H unverified, full C54 partial, and the workspace-ID alternative is
  disabled.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed files. Another Claude session wrote both the prior review and this
repair, and earlier Claude sessions wrote the v1 core and the design reviews.
This is the same model family and was not blinded. No external review service.

Executed: SHA-256 hashing of every file bound in the repair receipt;
`node --test tests/theme-intent-cw01-core-fixture-v2.test.mjs` (Node 22.21.0);
and the recorded v2 mutation check, run from a copy in my session scratch
directory so that its isolated work copies stayed outside the repository. All
other probes were by static reading of the core and its tests. Not done: SQL,
credentials, operational config/environment/registry/process/port/pidfile
reads, cluster/app actions, launch, sign-in, `pnpm` scripts, Prettier, unrelated
tests or verifiers, and the retired OneDrive checkout.

## Binding and execution checks

- New files: the core, tests, `tests-final.tap`, `mutation-check.mjs` and
  `mutation-results.json` all match the receipt.
- Preserved: v1 core and tests, the SQL asset, the v1 implementation report and
  receipt, the prior review and receipt, the four design-chain documents and
  their receipts/snapshots, AGENTS.md, PROJECT_CONTEXT.md, PROMPT_LIBRARY.md and
  the collector/current-work design documents. 0 mismatches.
- `tracking/BUILD_STATUS.md` and `tracking/SESSION_HANDOFF.md` matched the
  receipt's `after` hashes before my edit.
- Tests: **21 tests, 21 pass, 0 fail** (TAP in this review's evidence folder).
- Mutation check: baseline pass, **28/28 killed**. My output is byte-identical to
  the recorded `mutation-results.json` (`964dd6de…1d61`).

## F1 — fixed

- `start_outcome` and `stop_outcome` pass the whole outcome through
  `measured()`. Because `launch` is nested in that measured envelope, an
  asserted, unlabeled, wrong-adapter or wrong-manifest outcome or launch goes to
  `start_unknown`/`stop_unknown`.
- A start launch handle without a PID, creation or exit time is
  `LAUNCH_HANDLE_UNBOUND`. `checkProcessChain` requires the chain's pg_ctl PID,
  creation **and** exit time to equal the launch handle's, so a measured chain
  from another pg_ctl instance can no longer be paired with a copied handle.
- Shell containment now always uses the measured pg_ctl exit.
- Tests and the `f1_start_measured`, `f1_stop_measured` and
  `f1_launch_exit_match` mutants cover these.

## F2 — fixed as specified

- Start: the outcome needs `observed_at_ms` at or after pg_ctl's exit and within
  90 s of start intent; the flags are still required as well. pg_ctl's creation
  must follow start intent.
- Pre-spawn freshness is measured to the measured pg_ctl creation: AutoRun's
  oldest hive, job context and preflight are each ≤ 15 s older than the spawn
  (`PRESPAWN_EVIDENCE_STALE`). Preflight must be at or after admission and at or
  before start intent; job context between admission and start intent.
- SQL: A's connection follows the ownership observation; A and B each finish
  within 30 s of A's connection.
- Stop: the revalidation is timed between B and stop intent; stop intent is
  ≤ 5 s after B; the stop pg_ctl is created at or after stop intent and ≤ 5 s
  after B; the stopped observation follows that spawn and is within 90 s of stop
  intent.
- Each bound has a killing mutant. The FILETIME-to-millisecond comparison
  treats both clocks as one domain; the repair report states this as a
  limitation, and wall/monotonic pairing stays an adapter concern.

## F3 — fixed

`newRun` holds a deep-frozen JSON copy of the request. Non-serializable input
becomes `null` and is blocked at admission. `request_sha256` and `core_version`
appear in every history entry and in the receipt. Refusals are frozen. The
`f3_snapshot` mutant is killed.

## I-2 and I-3

- I-2: the fidelity test now splits the asset by marker, drops the six added
  statements, reverts M1 and requires exact ordered equality with the design's
  SQL lines.
- I-3: `CONIN$` and `CONOUT$` (with any extension) are refused as reserved.

## 15 s pre-spawn bound for preflight and job context — confirmed

Keep 15 s, measured to the spawn as implemented. The preflight facts (no
running cluster, pidfile, listener or lease) are also defended by pg_ctl and
the postmaster lock: a cluster that appears in the window makes the start fail
or produce a chain that does not match, which is `start_unknown` or
`ownership_unavailable`, never a pass. Job membership belongs to the launching
context and only changes if something assigns it to a job. Matching AutoRun's
15 s keeps one pre-spawn window inside the 90 s outer deadline. As with AutoRun,
this narrows the race but does not remove it; the residual stays with the owner
attestation.

## Findings

### R-1 — Low: the attestation is not bounded to the spawn

Locator: `checkAttestation` requires `admitted_at_ms ≤ affirmed_at_ms ≤
start_intent_at_ms`, but nothing bounds start intent − admission or spawn −
affirmation. The design (I3) asks for an "affirmative timestamp immediately
before W1". As written, an attestation affirmed right after admission is
accepted however long the run waits before preflight, start intent and spawn.
The prior review named the attestation window in F2's consequence but left it
out of its repair list, so this is a residual, not a regression. Repair: bound
spawn − `affirmed_at_ms` by a stated limit and add a negative test and a
mutant. A human affirmation needs more than 15 s, so the limit is a value
choice (for example a few minutes). Record it as the repair's choice, as with
the 15 s pre-spawn bound.

### R-2 — Low: the stop launch handle need not show an exit

Locator: `stop_outcome` requires the stop launch PID and creation but not an
exit time. The stopped observation is ordered after the stop spawn, not after
pg_ctl's exit. The design (L2) says completion is pg_ctl's process-handle
exit/status. A measured outcome reporting `pg_ctl_exit: 0` with no launch exit
time is accepted. Repair: require a measured `launch.exit_ft` at or after
creation, and the stopped observation at or after that exit, mirroring start.

### R-3 — Low: accepted SQL evidence is held by reference

Locator: the `sql_A` and `sql_B` handlers store the caller's evidence objects in
`ctx` (`{ sqlA: e }`, `{ sqlB: e }`). `step` freezes `ctx` only shallowly. A
caller that mutates A after `sql_A` (for example, `connected_at_ms` or
`observed_at_ms`) changes the `sql_B` checks. A caller that mutates B's
`observed_at_ms` changes the 5 s stop checks. History still records the
original digest, so the receipt would not reflect the values decided on. This
is the F3 pattern applied to evidence rather than the request, and the core is
still not a boundary against its own caller (I-5). Repair: store a frozen copy
of the accepted fields, or reuse `snapshot` on evidence.

### Informational

- The 80 s pg_ctl `-t` is still checked as a configuration value and a
  `timed_out` flag. Only the 90 s outer deadline is measured. This is acceptable
  because the outer bound is the binding one.
- The disconnect event carries no time. It is bounded indirectly because stop
  intent must fall within 5 s of B.

## Assessment by requested probe

- **False passes against F1–F3:** none found for the cases the prior review
  named. R-1 to R-3 are adjacent gaps.
- **Regressions against v1:** none found. The 18 carried-over tests pass with
  measured fixtures. The one changed expectation (a launch without an exit is
  now `LAUNCH_HANDLE_UNBOUND`) is the intended F1 tightening. All 12 v1 mutants
  are still killed.
- **Promotion:** refused for v1 and v2 receipt formats and for relabeled
  receipts. No receipt names an authority.

## Status of authority

This re-review is repository-only. It grants no SQL execution, credential use,
registry, pidfile or process read, cluster start or stop, launch, sign-in,
adapter implementation or native-session authority, and requests no
attestation. M3 is not reopened. Nothing starts automatically.

## Next options

1. A narrow v3 repair of R-1 to R-3 (successor files, v2 preserved), then a
   narrow re-review. R-1 needs a stated attestation bound.
2. Accept v2 as the supported fixture slice and carry R-1 to R-3 as stated
   conditions into the later adapter design and review.
