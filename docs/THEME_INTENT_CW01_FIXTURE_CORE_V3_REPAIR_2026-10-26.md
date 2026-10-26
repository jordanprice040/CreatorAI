# CW-01 fixture-only core v3 repair — October 26, 2026

Prompt: U03 (repair), repository-only, under Jordan's approved fix-and-review
loop in the review thread. It answers the independent re-review
[`THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md`](THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md)
(`8f4b3efb…84aa`, receipt `c8f6b30d…1744`). That review supported v2 as a
fixture-only slice and listed three Low conditions, R-1 to R-3.

Written by Claude (Anthropic model family), the session that wrote the v1 review
and the v2 repair. **No passing verdict is self-issued**; an independent
re-review is pending. Completion means this fixture-only repair is verified
locally, not that CW-01 is operational. M3 is unchanged and not reopened.
Original A0/native acceptance is blocked, NI not-run, H unverified, full C54
partial, and the workspace-ID alternative disabled.

## Files (successors; v1 and v2 byte-unchanged)

| File                                                                                   | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/theme-intent-cw01-core-fixture-v3.mjs`                                        | `4f61cbaf0f32c10f6d7d78917cc091e0ecefb7e19339bb262482f9ff7e815aa2` |
| `tests/theme-intent-cw01-core-fixture-v3.test.mjs`                                     | `ecb7e95df0da7376d1e5eb6e07da07280f2154a4dbd98da371d09c289861c37c` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v3-2026-10-26/tests-final.tap`       | `2780a4cd388ac98a7a3fbc5694e537c07de83ed9c1d0a0555dd75e33744bada1` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v3-2026-10-26/mutation-check.mjs`    | `1cce51f83c3e695436c7792c2168a0b5f14caf81662f7ffb3858ca8ba449d233` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v3-2026-10-26/mutation-results.json` | `1ad776fe13140e5473a5bb39cc4e5cb6154a50bee6b36f6245053a70ecc6e39b` |

The receipt (`repair-receipt.json` in the same folder) records this report's
hash, the tracking before/after hashes and the preservation checks. The core is
now `cw01-fixture-core/3` and its receipts use format
`theme-intent-cw01-fixture-receipt/3`. `admitOperationalGate` also refuses
formats `/1` and `/2`. The SQL asset `cw01-observer-sql/2` (`074561c3…89b2`)
is unchanged, and the v2 I-1 erratum still applies.

## Repairs

- **R-1: attestation bound to the spawn.** The start intent records the
  attestation's `affirmed_at_ms`. At `start_outcome`, pg_ctl's measured creation
  may be at most **120 s** after it (`PRESPAWN_EVIDENCE_STALE` →
  `ownership_unavailable`). The existing admission-to-start-intent window still
  applies.
  - **The 120 s value is this repair's choice, for Jordan to confirm.** It is
    far tighter than the previously unbounded window. It leaves a person time to
    read and affirm six items and then start, matching the design's "immediately
    before W1".
  - It is longer than the 15 s machine-evidence bounds, because a human
    affirmation is slower than an automated read. A shorter or longer value is
    a one-constant change.
- **R-2: stop completion is the handle exit.** The stop launch handle must
  carry a measured `exit_ft` at or after its creation (`LAUNCH_HANDLE_UNBOUND`).
  The stopped observation must fall at or after that exit, not merely after the
  spawn. This mirrors start.
- **R-3: deep-frozen SQL evidence.** `sql_A` and `sql_B` store
  `snapshot(e)`, a deep-frozen JSON copy, in the context instead of the caller's
  object. Mutating the caller's A or B after acceptance no longer changes the
  SQL-phase, pre-stop or stop checks, so history digests match what was decided.

## Checks actually executed

- `node --test tests/theme-intent-cw01-core-fixture-v3.test.mjs` (Node 22.21.0):
  **24 tests, 24 pass, 0 fail** (TAP in `tests-final.tap`).
  - The 21 v2 tests are carried forward. One fixture changed: the
    "stop spawn more than 5 s after B" case now moves the stop exit along with
    the creation, because R-2 rejects an exit before creation.
  - Three new tests: R-1 (exactly 120 s accepted, 120.001 s refused); R-2
    (missing, null or pre-creation stop exit; stopped state observed before the
    exit); and R-3 (mutating A's connection time and backend PID, and B's
    observation time, after acceptance changes nothing; the stored copies are
    frozen).
- Mutation check (`mutation-check.mjs`, run from a copy in session scratch;
  isolated work copies stayed outside the repository and were removed):
  **unmutated baseline passes; 33/33 mutants killed.** These are the 28 v2
  mutants plus 5 for R-1, R-2 (two) and R-3 (two).
- Prettier `--check` on the two new `.mjs` files: clean.
- The v1 and v2 core and tests, the SQL asset, every earlier CW-01 report and
  receipt, and the 18 frozen inputs: hashes unchanged.

Not run: the SQL asset or any SQL, credentials, operational
config/environment/registry/process/port/object/pidfile reads, cluster/app
start/stop, launch, sign-in, helpers/install/migration/recovery, activation or
dispatch, unrelated tests or verifiers, `pnpm` scripts, and the retired OneDrive
checkout.

## Remaining limitations

- The 120 s attestation bound needs Jordan's confirmation. The 15 s pre-spawn
  bound was confirmed by the v2 re-review.
- Everything the v2 repair and re-review left open still applies. Fixture
  evidence is hand-built. Clock-discontinuity handling belongs to the adapters.
  Post-read races stay with the attestation. The core is not a boundary against
  its own caller beyond the copies it now keeps.
- The operational blockers are unchanged: reader N1–N4, collector L1/L4, the
  process-metadata, pidfile and registry adapters, the protected credential,
  real manifest bindings, grants, Jordan's attestation, and W2 comparison.
- The author also wrote the earlier review and repair.

## Next independent-review prompt

> Independently review the CW-01 fixture core v3 repair against
> docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REPAIR_2026-10-26.md and its receipt
> (tracking/evidence/theme-intent-cw01-fixture-core-v3-2026-10-26/repair-receipt.json),
> and the v2 re-review it answers
> (docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md, 8f4b3efb…84aa).
> Check that R-1 to R-3 are fixed in scripts/theme-intent-cw01-core-fixture-v3.mjs
> and its test without false passes or regressions against v2. Check that v1/v2
> files, the SQL asset and the frozen inputs are byte-unchanged. Assess the 120 s
> attestation bound. Run only `node --test tests/theme-intent-cw01-core-fixture-v3.test.mjs`
> and the v3 mutation check from an isolated copy. No SQL, credentials,
> operational reads, cluster/app actions, launch or sign-in, and no retired
> OneDrive checkout. Report fixture-slice support separately from operational
> readiness, update tracking additively, then stop.
