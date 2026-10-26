# Disk cleanup manifest — October 24, 2026

Owner-authorized bounded cleanup of `C:\dev\creator_agent`. Explicit target list in
`cleanup.mjs`; per-target bytes, file/link counts and status in `dry-run-result.json`
and `execute-result.json`. No glob, `git clean`, or blanket delete of `.verification`
or `target`.

## Measured before (2026-10-24, file bytes, links not followed)

- `.verification`: ≈38.0 GiB (v2/v3/v4 helper fixture roots ≈5 GiB each)
- `apps/desktop/src-tauri/target/debug`: 6.22 GiB; `target/release`: 1.81 GiB
- C: free space before: 12,349,300,736 bytes

## Deleted (36.340 GiB of file bytes, 39,019,502,518 bytes)

Disposable synthetic test environments (each had the `TEST_ONLY` "synthetic helper
test" marker, no running process, no `postmaster.pid`, last write ≤ 2026-10-24 00:43;
no receipt, plan or review hashes any file inside them):

| Path (under `C:\dev\creator_agent\.verification\`) | GiB | Reason |
|---|---|---|
| theme-helper-v2-1792803661619 | 0.134 | superseded v2 run; failure text kept in tracked `e2e-first.tap` |
| theme-helper-v2-1792803740615 | 0.164 | superseded v2 run; failure text kept in tracked `e2e-second.tap` |
| theme-helper-v2-1792803815899 | 2.677 | superseded v2 run |
| theme-helper-v2-1792804436268 | 2.321 | superseded v2 run (interrupted, no summary) |
| theme-helper-v2-1792804947316 | 2.772 | superseded v2 run |
| theme-helper-v2-1792805317469 | 4.569 | superseded v2 run; path recorded in tracked `test-observations.json` |
| theme-helper-v2-1792808079636 | 4.569 | superseded v2 run |
| theme-helper-v3-1792809917958 | 5.175 | superseded v3 run; path recorded in tracked `test-observations.json` |
| theme-helper-v3-1792815865601 | 5.176 | superseded v3 run (latest v3) |
| theme-v2-review-probe-1792808608951 | 0.164 | finished v2 reviewer probe; result in tracked `probe-before-death.json` |
| theme-v3-review-probe-1792816685719 | 0.437 | finished v3 reviewer probe; result in tracked `probe-external-kill-run1.json` |
| theme-v3-review-probe-1792816827608 | 0.437 | finished v3 reviewer probe; result in tracked `probe-external-kill.json` |

Each v2/v3 root contained one `alias-home` junction pointing at its own `home`; the
walker removed the junction itself without traversing it.

Reproducible cargo build caches (under `apps\desktop\src-tauri\target\`): `debug\deps`
2.896, `debug\build` 0.533, `debug\incremental` 2.635, `debug\.fingerprint` 0.001,
`release\deps` 1.415, `release\build` 0.265, `release\.fingerprint` 0.000 GiB. Rebuilt
by `cargo build`/`tauri build`; nothing references them.

Consequence: `tracking/evidence/theme-intent-upgrade-helper-v{2,3}*/record-repair.mjs`
read the newest v2/v3 fixture root's `test-summary.json`, so those historical
recorders can no longer be re-run. Their receipts are already written and every
receipt artifact is a tracked repository file, so receipt hash verification is
unaffected.

## Preserved (protected dependencies)

- All `theme-helper-v4-*` and `theme-v4-guards-*` roots: v4 repair evidence
  (`first-e2e.tap`, `test-observations.json`, v4 `record-repair.mjs` reads the newest)
  and the v4 independent review's active run `theme-helper-v4-1792841376266`
  (PostgreSQL on 55455 was running during cleanup).
- Frozen candidate/plan inputs: `theme-intent-artifacts-2026-10-23` (setup.exe sha256
  3af2712c…834b re-verified), `theme-intent-nsis-payload`, `theme-intent-build.cmd`,
  `theme-intent-{desktop,mobile}.png`; predecessor `discovery-semantics-v2-artifacts`
  (setup.exe 57cc5d92…ed27 re-verified); `semantics-v2-prepackage`,
  `semantics-v2-nsis-payload` (package-review receipt).
- Rollback material: every `*-program-rollback`, `discovery-upgrade-rollback`,
  `discovery-v{2,3,4}-approved-installer.exe`.
- `target/{debug,release}` final outputs: `creator-desktop.exe`, `.pdb`, `.d`,
  `bundle/`, `nsis/`, `release/studio`. The release NSIS setup.exe equals the frozen
  candidate hash and is named by `scripts/prepare-theme-intent-package.mjs`; the debug
  exe is used by `tests/src/artifact-{api,cli}.test.ts` and desktop acceptance scripts.
- Everything else in `.verification` (small PG test clusters, logs, v2/v3 guard
  dirs, `.normalized-v3` files, audit/u02 dirs referenced by docs), `.creator`,
  `tracking/evidence`, `node_modules`, all uncommitted work including
  `.codex/config.toml`. The retired checkout was not accessed.

## Uncertain, not deleted

- Small PostgreSQL test clusters/logs (`*-pg`, `theme-helper-host-pg`, ≈0.7 GiB total):
  some named in handoffs; low value to reclaim.
- `audit-fixes` (0.23 GiB), referenced by audit docs/evidence.
- `node_modules`: reproducible but required for every check; out of scope.
