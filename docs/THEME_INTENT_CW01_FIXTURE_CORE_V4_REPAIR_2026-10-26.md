# CW-01 fixture-only core v4 repair — October 26, 2026

Prompt: U03 (repair), repository-only, under Jordan's approved fix-and-review
loop. It answers the independent re-review
[`THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md`](THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md)
(`04bc626f…dc55`, receipt `a90162c5…7e7d`). That review supported v3 as a
fixture-only slice, found one new Low (L-1) and noted I-1 and I-2.

Written by Claude (Anthropic model family), the same session as the earlier
review and repairs. **No passing verdict is self-issued**; an independent
re-review is pending. Completion means this fixture-only repair is verified
locally, not that CW-01 is operational. M3 is unchanged and not reopened.
Original A0/native acceptance is blocked, NI not-run, H unverified, full C54
partial, and the workspace-ID alternative disabled.

## Files (successors; v1–v3 byte-unchanged)

| File                                                                                   | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/theme-intent-cw01-core-fixture-v4.mjs`                                        | `ce3c4ad7c66d4f15bd695519f1db05940142f5e57a372b52c4781b1abf2507bb` |
| `tests/theme-intent-cw01-core-fixture-v4.test.mjs`                                     | `666ce597daea82ca236df32833624a70fdc6262a75da410a1ec3311d4fe77149` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v4-2026-10-26/tests-final.tap`       | `7382604a90186cb9c4927b29b6dc3ca366dd40a5abdbc3d1407bf37db9c98569` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v4-2026-10-26/mutation-check.mjs`    | `7a00ff62e5b7155de4d5d9b3f65795e45d6f2e738ff81f1c8801d120cd247c22` |
| `tracking/evidence/theme-intent-cw01-fixture-core-v4-2026-10-26/mutation-results.json` | `b74a3ab35efed156a825f4503e1303ebc2e0a88284bfe3ad7e52d2909234156c` |

The receipt (`repair-receipt.json` in the same folder) records this report's
hash, the tracking before/after hashes and the preservation checks. The core is
now `cw01-fixture-core/4` with receipt format `theme-intent-cw01-fixture-receipt/4`.
`admitOperationalGate` refuses formats `/1` to `/3` too. The SQL asset
`cw01-observer-sql/2` is unchanged, and the v2 I-1 erratum still applies.

## Repairs

- **L-1: copy first, then validate.** `step` now makes one deep-frozen JSON copy
  of the incoming evidence before anything else. That copy is what the handler
  checks, what the history digests and what the context stores. The v3
  per-handler copies for SQL A and B are now redundant and were removed.
  - A `toJSON` method or a later mutation can no longer separate the checked
    values from the kept ones. The digest of the stored copy equals the history
    digest.
- **I-1:** a test pins that B (and its nested arrays) is held frozen.
- **I-2:** evidence that is not plain JSON (for example a BigInt field) becomes
  `null`. It fails closed in the handler (`EVIDENCE_MISSING` for SQL A) instead
  of throwing, and a test covers this.
- **Attestation bound:** unchanged at **120 s**, still pending Jordan's
  confirmation. The v3 re-review found it acceptable as a ceiling and noted that
  30–60 s would also be reasonable.

## Checks actually executed

- `node --test tests/theme-intent-cw01-core-fixture-v4.test.mjs` (Node 22.21.0):
  **26 tests, 26 pass, 0 fail.** All 24 v3 tests are carried forward unchanged,
  apart from the file paths. Two tests are new:
  - L-1: a `toJSON` that swaps A's times is checked and stored as the copy, and
    the digest matches. A B whose `toJSON` hides a stale time is refused
    `STALE_B_EVIDENCE`.
  - I-1/I-2: B is held frozen, and BigInt evidence fails closed without throwing.
- Mutation check, run from a copy in session scratch; isolated copies outside
  the repository were removed: **unmutated baseline passes; 33/33 mutants
  killed.**
  - The two v3 R-3 mutants targeted per-handler copies that no longer exist.
    They are replaced by `l1_copy_first` (no step copy) and `l1_copy_frozen`
    (copy not frozen), and both are killed.
  - Every other v1–v3 mutant is carried forward and killed.
- Prettier `--check` on the two new `.mjs` files: clean.
- The v1–v3 core and tests, the SQL asset, every earlier CW-01 report, review and
  receipt, and the 18 frozen inputs: hashes unchanged.

Not run: the SQL asset or any SQL, credentials, operational
config/environment/registry/process/port/object/pidfile reads, cluster/app
start/stop, launch, sign-in, helpers/install/migration/recovery, activation or
dispatch, unrelated tests or verifiers, `pnpm` scripts, and the retired OneDrive
checkout.

## Remaining limitations

- The 120 s attestation bound still needs Jordan's confirmation.
- Accessor (getter) properties are resolved once, at copy time, so all checks
  see a single value. The copy cannot detect that a caller supplied a getter.
  The core still trusts its caller to be the reviewed adapter.
- All earlier limitations and the operational blockers still apply: reader
  N1–N4, collector L1/L4, the process-metadata, pidfile and registry adapters,
  the protected credential, real manifest bindings, grants, Jordan's
  attestation, and W2 comparison.
- The author also wrote the earlier review and repairs.

## Next independent-review prompt

> Independently review the CW-01 fixture core v4 repair against
> docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REPAIR_2026-10-26.md and its receipt
> (tracking/evidence/theme-intent-cw01-fixture-core-v4-2026-10-26/repair-receipt.json),
> and the v3 re-review it answers
> (docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md, 04bc626f…dc55).
> Check that L-1, I-1 and I-2 are fixed in scripts/theme-intent-cw01-core-fixture-v4.mjs
> and its test without false passes or regressions against v3. Check that v1–v3
> files, the SQL asset and the frozen inputs are byte-unchanged. Run only
> `node --test tests/theme-intent-cw01-core-fixture-v4.test.mjs` and the v4
> mutation check from an isolated copy; probes of the pure module from an
> isolated scratch copy are fine. No SQL, credentials, operational reads,
> cluster/app actions, launch or sign-in, and no retired OneDrive checkout.
> Report fixture-slice support separately from operational readiness, update
> tracking additively, then stop.
