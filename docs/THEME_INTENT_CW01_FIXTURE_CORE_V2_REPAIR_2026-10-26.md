# CW-01 fixture-only core v2 repair — October 26, 2026

Prompt: U03 (repair a failed gate), repository-only. Jordan approved this repair
in the review thread ("make those fixes now") after the independent review
[`THEME_INTENT_CW01_FIXTURE_CORE_REVIEW_2026-10-26.md`](THEME_INTENT_CW01_FIXTURE_CORE_REVIEW_2026-10-26.md)
(`d4d05a86…2c04`, receipt `bf677643…e90d`). That review supported the SQL asset
and supported the core only in part, with Medium F1 and F2, Low F3 and
informational I-1 to I-5.

Written by Claude (Anthropic model family), the same session that wrote that
review. So the reviewer is now repairing its own findings, and an independent
re-review is required. **No passing verdict is self-issued.**

Completion means this fixture-only repair is verified locally, not that CW-01 is
operational. M3 is unchanged and not reopened. Original A0/native acceptance is
blocked, NI not-run, H unverified, full C54 partial, and the workspace-ID
alternative disabled.

## Approach: successor files; prior bytes preserved

The v1 core and tests are untracked, and the v1 receipt and review are bound to
their hashes. So the repair is a successor pair, and v1 is left byte-for-byte
unchanged (`b8b9eb5d…0662`, `5e0b615c…9dda`, verified after the repair). The
SQL asset `cw01-observer-sql/2` (`074561c3…89b2`) is unchanged.

| File                                                                                   | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/theme-intent-cw01-core-fixture-v2.mjs`                                        | `f72b9ea1cc37fbb20ad57efdca24cbd6bd2a007c39a1aa3d99602101fac0a1de` |
| `tests/theme-intent-cw01-core-fixture-v2.test.mjs`                                     | `3309e8103c2b6e964d78c8cca35b37fc4476415bc7daf2f46f95c8185c27624c` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/tests-final.tap`       | `1247b5bc67a5245be053a411fcc049745763840274c212eabaa15477990dd651` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/mutation-check.mjs`    | `3ffa3bf9798107ccc379370a0a7f72e3cf5338e00e47c5b188af96452f3906c1` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/mutation-results.json` | `964dd6de583300c58ba337c7c9010c24e8134f393662bccc2eec431dbfed1d61` |

This report's hash, the tracking before/after hashes and the preservation checks
are in `tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/repair-receipt.json`.

## Repairs

- **Versioning.** The core is now `cw01-fixture-core/2` and the receipt format
  `theme-intent-cw01-fixture-receipt/2`. Every history entry and receipt
  records the core version and request digest. `admitOperationalGate` also
  refuses receipt format `/1`.
- **F1: measured outcomes.** `start_outcome` and `stop_outcome` now pass the
  whole outcome, including the launch handle, through `measured()`. An asserted,
  unlabeled, wrong-adapter or wrong-manifest outcome goes to
  `start_unknown`/`stop_unknown`. Because pg_ctl `-w` exited 0, the start launch
  handle must carry an exit time. The chain's pg_ctl record must carry the same
  exit time (`PG_CTL_INSTANCE_MISMATCH`), and shell containment always uses that
  exit. A stop launch handle (pid and creation) is required.
- **F2: deadlines and freshness measured to the spawn.**
  - Start: the outcome needs a measured `observed_at_ms`, not before pg_ctl's
    exit and at most 90 s after start intent (`OUTER_DEADLINE_EXCEEDED` →
    `start_unknown`). The boolean flags are still required as well.
  - Pre-spawn evidence: preflight and job context now carry observation times.
    Preflight must fall at or after admission and at or before start intent;
    job context between admission and start intent. AutoRun (≤ 15 s), job
    context and preflight (each ≤ 15 s) are measured to pg_ctl's creation
    (`PRESPAWN_EVIDENCE_STALE`).
  - SQL: A needs `connected_at_ms`, at or after the ownership observation. A
    and B must finish within 30 s of A's connection (`SQL_TOTAL_EXCEEDED` →
    `sql_unknown`).
  - Stop: the revalidation must be timed between B and the stop intent. The
    stop pg_ctl must be created at or after the stop intent and at most 5 s
    after B. The stopped observation must fall after that spawn and within
    90 s of the stop intent.
  - These are the review's freshness determinations: 15 s and 5 s are kept, but
    are now measured to the spawn.
- **F3: request snapshot.** `newRun` takes a deep-frozen JSON copy of the request
  (non-serializable input becomes `null`, so admission is blocked). Its digest
  is recorded. Mutating the caller's object afterwards changes nothing. Refusals
  are frozen too (I-5).
- **I-2:** the fidelity test is ordered and per statement. It drops the six
  added statements, reverts M1, and requires exact equality with the
  original's 70 lines.
- **I-3:** `CONIN$` and `CONOUT$` (with any extension) are reserved device names.
- **I-1 (erratum, asset unchanged):** the SQL asset's header comment says
  "A02/B01" take the actor parameter. It should say **A02/B02**. The marker
  lines (`@B02 … params=actor`) are correct and are what adapters must bind.
  A later successor asset can fix the comment.
- **I-4 (wording):** the postmaster's creation must precede the end of the
  pidfile's start second. Creation precedes the pidfile write, so this is a
  one-sided bound.

## Checks actually executed

- `node --test tests/theme-intent-cw01-core-fixture-v2.test.mjs` (Node 22.21.0):
  **21 tests, 21 pass, 0 fail** (TAP in `tests-final.tap`). The 18 carried-over
  tests use updated fixtures with measured outcomes and times. The one test
  whose expectation changed is the launch handle without an exit: it now
  expects `LAUNCH_HANDLE_UNBOUND` instead of a pass. Three new tests cover F1
  (asserted, unlabeled and wrong-adapter/manifest start and stop outcomes; exit
  mismatch; missing launch), F2 (hour-late spawn with "on time" flags; missing
  observation time; AutoRun, preflight and job stale at the spawn; job after
  intent; SQL 30 s total; A connecting before ownership; untimed or misordered
  revalidation; late or early stop spawn; late stopped observation) and F3
  (mutation after admission, digests, frozen refusals, v1-format receipts).
- Mutation check (`mutation-check.mjs`, run from a copy in session scratch; its
  isolated work copies stayed outside the repository and were removed). It now
  first requires the **unmutated baseline to pass**. Result: baseline pass, and
  **28/28 mutants killed** (the 12 v1 mutants plus 16 for F1–F3 and I-3).
  - The baseline step caught a real defect during the repair. The copied
    purity test still read the v1 core, so every mutant looked killed. It now
    reads v2.
  - One mutant (job time after intent) first survived. A test was added for it.
- Prettier `--check` on the two new `.mjs` files: clean.
- v1 core/tests, the SQL asset, both prior reports and receipts and the 18
  frozen inputs: hashes unchanged.

Not run: the SQL asset or any SQL, credentials, operational
config/environment/registry/process/port/object/pidfile reads, cluster/app
start/stop, launch, sign-in, helpers/install/migration/recovery, activation or
dispatch, unrelated tests or verifiers, `pnpm` scripts, and the retired OneDrive
checkout.

## Remaining limitations

- Fixture evidence is hand-built. Times are fixture numbers, and FILETIME and
  millisecond clocks are compared directly. Clock-discontinuity detection and
  wall/monotonic pairing remain adapter concerns.
- The 15 s pre-spawn bound for preflight and job context is this repair's choice
  (matching AutoRun), not a design value. The re-review should confirm or change
  it.
- The registry, preflight and other observations can still change after they
  are read. That residual race stays with the owner attestation.
- Every v1 limitation and blocker still applies: reader N1–N4, collector L1/L4,
  the process-metadata, pidfile and registry adapters, the protected credential,
  real manifest bindings, grants, Jordan's attestation, and W2 comparison.
- The author also wrote the review whose findings this repairs.

## Next independent-review prompt

> Independently review the CW-01 fixture core v2 repair against
> docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REPAIR_2026-10-26.md and its receipt
> (tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/repair-receipt.json),
> the review it answers (docs/THEME_INTENT_CW01_FIXTURE_CORE_REVIEW_2026-10-26.md,
> d4d05a86…2c04) and the governing CW-01 design chain (7aaa898c…7252,
> 7619804d…f196, 0462b516…bb81, d7628032…de58). Check that F1, F2 and F3 are
> fixed in scripts/theme-intent-cw01-core-fixture-v2.mjs and its test without
> false passes or regressions against v1. Check that v1 files, the SQL asset and
> the frozen inputs are byte-unchanged, and that the I-1 erratum is accurate.
> Confirm or change the 15 s pre-spawn bound for preflight/job context. Run only
> `node --test tests/theme-intent-cw01-core-fixture-v2.test.mjs` and the v2
> mutation check from an isolated copy. No SQL, credentials, operational reads,
> cluster/app actions, launch or sign-in, and no retired OneDrive checkout.
> Report fixture-slice support separately from operational readiness, update
> tracking additively, then stop.
