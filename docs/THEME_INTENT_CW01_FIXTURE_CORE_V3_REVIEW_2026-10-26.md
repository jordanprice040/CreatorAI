# CW-01 fixture core v3 repair independent re-review — October 26, 2026

Prompt: U02 (independent review), repository-only, per the re-review prompt at the
end of `docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REPAIR_2026-10-26.md`
(`f9bb8839…8597`) and its receipt `repair-receipt.json` (`70611ecf…3886`). The
repair answers `docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md`
(`8f4b3efb…84aa`). Reviewed code: core
`scripts/theme-intent-cw01-core-fixture-v3.mjs` (`4f61cbaf…5aa2`) and tests
`tests/theme-intent-cw01-core-fixture-v3.test.mjs` (`ecb7e95d…c37c`).

## Verdicts

- **Fixture core v3 and tests: SUPPORTED as a fixture-only slice.** R-1, R-2
  and R-3 are fixed as the v2 re-review specified them. I found no false pass in
  the named cases and no regression against v2. One new Low (L-1) and two
  informational notes are below. None reopens F1–F3 or R-1–R-3.
- **v1/v2 files, SQL asset and frozen inputs: byte-unchanged.** All 34
  preserved hashes and the 5 new-file hashes in the repair receipt match (39/39).
- **120 s attestation bound: acceptable as a ceiling; Jordan must confirm it.**
  Reasoning below. I do not treat it as confirmed by this review.
- **Fixture-to-operational promotion: none.** `admitOperationalGate` never
  admits and now also refuses receipt formats `/1` and `/2`.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0/native acceptance is blocked, NI
  not-run, H unverified, full C54 partial, and the workspace-ID alternative is
  disabled.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed files. Another Claude session wrote the v1 review, the v2 repair and
this v3 repair; a different earlier Claude session wrote the v2 re-review. This
is the same model family and was not blinded. No external review service.

Executed (Node 22.21.0): SHA-256 hashing of every file bound in the repair
receipt; `node --test tests/theme-intent-cw01-core-fixture-v3.test.mjs`; the
recorded v3 mutation check, run from a copy in my session scratch directory so
its work copies stayed outside the repository; and reviewer-only probes and
nine extra edge mutants, all on scratch copies (scripts and outputs saved in
this review's evidence folder). Not done: SQL, credentials, operational
config/environment/registry/process/port/object/pidfile reads, cluster/app
actions, launch, sign-in, `pnpm` scripts, Prettier, unrelated tests or
verifiers, and the retired OneDrive checkout.

## Binding and execution checks

- New files: the core, tests, `tests-final.tap`, `mutation-check.mjs` and
  `mutation-results.json` all match the receipt.
- Preserved: v1 and v2 cores and tests, v2 TAP/mutation evidence, the SQL asset
  (`074561c3…89b2`), every earlier CW-01 report and receipt, the design chain
  and its snapshots, AGENTS.md, PROJECT_CONTEXT.md, PROMPT_LIBRARY.md and the
  collector/current-work design documents. 0 mismatches.
- `tracking/BUILD_STATUS.md` and `tracking/SESSION_HANDOFF.md` matched the
  receipt's `after` hashes before my edit.
- Tests: **24 tests, 24 pass, 0 fail** (`tests-rerun.tap`).
- Mutation check: baseline pass, **33/33 killed**. My output is byte-identical
  to the recorded `mutation-results.json` (`1ad776fe…e39b`).
- The code diff from v2 is narrow: version strings and the prior-format list,
  one new limit, the attestation time carried into `ctx`, one freshness clause,
  two `snapshot(e)` calls and the stop-handle exit checks. Nothing else changed.

## R-1 — fixed

- `start_intent` records `attestation_affirmed_at_ms`, and `start_outcome`
  refuses `spawn − affirmed_at_ms > 120000` as `PRESPAWN_EVIDENCE_STALE`
  (`ownership_unavailable`). The lower side is already closed:
  `checkAttestation` keeps `admitted ≤ affirmed ≤ start intent`, and the spawn
  must follow start intent (`PG_CTL_BEFORE_INTENT`), so the difference is never
  negative. A probe with affirmation after start intent is `ATTESTATION_NOT_FRESH`.
- The test pins both edges (exactly 120 s accepted, 120.001 s refused). My extra
  mutants moving the limit to 120001 or 119999 ms, or dropping the `ctx` field,
  are all killed.

### The 120 s value

The v2 re-review asked for a stated limit of "a few minutes" or so, since a
human affirmation is slower than a machine read. 120 s satisfies that and is a
large tightening over the previously unbounded window. One correction to the
repair's rationale: `affirmed_at_ms` is the moment of affirmation, so the time a
person spends reading the six items falls before it, not inside the window. The
window covers affirmation → preflight/job/AutoRun reads → start intent → pg_ctl
spawn. Preflight, job and AutoRun must themselves be ≤ 15 s before the spawn,
so in a flow where the affirmation is the last human step, a much shorter value
(for example 30–60 s) would also work. A longer value only makes sense if the
operator affirms, then does something else by hand before start. Either way,
the choice is Jordan's: **confirm 120 s, or name a different value.** Changing
it is one constant and the two boundary values in the R-1 test.

## R-2 — fixed

- `stop_outcome` now requires a measured `launch.exit_ft` at or after
  `creation_ft` (`LAUNCH_HANDLE_UNBOUND` → `stop_unknown`), and the stopped
  observation must be at or after that exit, not just after the spawn.
- The test covers a null exit, a missing exit, an exit before creation, and a
  stopped observation between spawn and exit. Extra mutants reverting to the v2
  spawn ordering or dropping only the order check are killed. Dropping only the
  null check survives, but it is behaviourally equivalent: JavaScript compares
  `null < creation` as `0n < creation`, which is true, so the same refusal
  results.
- Start already had the matching order through `checkProcessChain`
  (`pcExit < pcStart` → `PG_CTL_INSTANCE_MISMATCH`); a probe confirmed it.
- The carried-forward v2 test that moved the stop spawn now moves the exit too.
  That change is required by R-2 and does not weaken the original assertion.
- The ordering failure is reported as `OUTER_DEADLINE_EXCEEDED`, as at start.
  The terminal state is right; the reason code is a little broad (cosmetic).

## R-3 — fixed for plain data

- `sql_A` and `sql_B` store `snapshot(e)`, a deep-frozen JSON copy. The R-3 test
  shows that mutating the caller's A (connection time, backend PID) and B
  (observation time) after acceptance does not change later checks, and that
  `ctx.sqlA` is frozen. An extra mutant storing a shallow copy of A is killed.

### L-1 — Low: the evidence is checked before it is copied

The handlers check the caller's object, then copy it with
`JSON.parse(JSON.stringify(e))`. For plain data the copy equals what was
checked. For an evidence object with its own `toJSON` method, the stored copy
can differ from the checked values. My probe (`probes.mjs`, recorded in
`probes-output.txt`) gives A a `toJSON` that reports `connected_at_ms` as
T+40000, then submits B at T+50000. Without `toJSON` this is
`sql_unknown/SQL_TOTAL_EXCEEDED` (37.5 s from the real connection); with it, B
is accepted. The history digest uses `canonical`, which ignores `toJSON`, so it
records the checked values while `ctx` holds different ones. This is exactly
what R-3 meant to prevent.

This needs a caller that deliberately builds such an object, and v2 allowed the
same outcome more simply by mutation, so it is not a regression. It is the
caller-is-not-a-boundary residual (v2 I-5) in a narrower form. Repair, if
wanted: copy first, then check and digest the copy (as `newRun` already does for
the request), or reject evidence that has a `toJSON` or accessor property. A
getter probe that returns different values on each read failed closed
(`ownership_unavailable`), because the checks read the field more than once.

### Informational

- **I-1: B's frozen copy is not pinned by a test.** A mutant that stores an
  unfrozen JSON copy of B survives; the test asserts freezing only for A. The
  code does freeze B, so behaviour is correct today. A one-line
  `Object.isFrozen(run.ctx.sqlB)` assertion would pin it.
- **I-2: non-JSON evidence throws.** Evidence with a BigInt field makes `step`
  throw `TypeError` (from the history digest), rather than return a terminal
  state. v2 behaves the same, so this is pre-existing. It fails closed, since no
  new run is returned, but adapters should not rely on it.

## Regressions and false passes

- **False passes in the named cases:** none. R-1 to R-3 behave as specified for
  plain fixture evidence.
- **Regressions against v2:** none found. 21 carried tests pass, and the single
  changed fixture is the required R-2 adjustment. All 28 v2 mutants are still
  killed.
- **Promotion:** refused for v1, v2 and v3 receipt formats and for relabeled
  receipts. No receipt names an authority.

## Status of authority

This re-review is repository-only. It grants no SQL execution, credential use,
registry, pidfile or process read, cluster start or stop, launch, sign-in,
adapter implementation or native-session authority, and requests no
activation. Operational blockers are unchanged: reader N1–N4, collector L1/L4,
the process-metadata, pidfile and registry adapters, the protected credential,
real manifest bindings, grants, Jordan's attestation, and W2 comparison.

## Decision for Jordan and next step

1. **Jordan: confirm the 120 s attestation-to-spawn bound, or give another
   value.** (This review finds 120 s acceptable; 30–60 s would also work if
   affirmation is the last human step before start.)
2. Then either a narrow v4 repair of L-1 (copy-then-check) and I-1 (one
   assertion), with a narrow re-review; or accept v3 as the supported fixture
   slice and carry L-1 and I-2 as stated conditions into the adapter design and
   review. M3 stays closed either way.
