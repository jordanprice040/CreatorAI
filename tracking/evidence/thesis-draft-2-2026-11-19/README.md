# Thesis draft 2 evidence (November 19, 2026)

Records made for `docs/thesis/` draft 2. Cloud container only: nothing ran on Jordan's PC, no real
database (installed app, dev studio) was touched, no model was called and nothing was spent.

## Full test run on main `b9270db` (E11)

Run on November 19, 2026, 01:47–02:09 UTC, in the cloud container on main
`b9270db1ee90e7178744935a343e6cf3dbeab538` (before this PR's documentation changes; none of them is read by a
test). Node 22.23.5, pnpm 11.25.0, PostgreSQL 16.15 on loopback with a throwaway role that may create
databases; the tests created and dropped their own databases. Command:
`CREATOR_TEST_DATABASE_URL=postgres://…@127.0.0.1:5432/postgres corepack pnpm test:db`.

Result ([test-db.log](test-db.log), SHA-256 `4f2002bd159f378ad0ba3de3647e9f1a63925b925553fa50f6c2bdc59024e3b0`): **1,527 tests, 1,490 pass, 5 fail,
32 skipped**, 0 cancelled, in 1,254 s. The 5 failures are the known PowerShell-wrapper tests (441, 459, 889,
893, 988: "real PowerShell wrapper rejects wrong home…" and "actual wrapper refuses old combined approval…"),
which need PowerShell, not installed in the container. Because `pnpm test` stopped on those failures,
`pnpm test:dev-safety` did not run. The skips are tests whose prerequisites are absent here (for example the
real WSL2 worker on Windows). No Windows, Rust desktop or real-worker test ran.

## Live autopilot reports (E13)

`autopilot-live-reports/` holds byte-for-byte copies of the four run reports written at the time of the
live autopilot runs on Jordan's dev studio (project files, `reviews/`), copied on November 19, 2026. They
are the thesis's committed record of those runs until the primary records on Jordan's PC are committed
(named in `docs/thesis/EVIDENCE.md`, E13). They are in `.prettierignore` so their bytes stay unchanged.

| File                                       | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| LIVE_AUTOPILOT_FINDINGS_2026-11-14.md      | `11a2c933054fa1a8c527498a4aea991a3da9e721bd06be6a05808f1ac4c4b80c` |
| LIVE_AUTOPILOT_RERUN_SCHEMA63_2026-11-14.md | `d0343a94f530eadc9e61593f026c7fa3cce7d1a273442eacf82b67b79fe14a84` |
| LIVE_AUTOPILOT_RERUN_MAIN_2026-11-15.md    | `fed395c4334f8be12abcb89ee0b41ae7a6a28cadb2de575223178d7887d76af0` |
| LIVE_AUTOPILOT_RERUN_205_2026-11-15.md     | `2d548769bb0bcfd2cfab253a558d0b7a28c28c790cfaaa40aa7161160daed4d0` |

These are reports, not raw run records. The continued run of autopilot `e8b36bd9`, which ended in a
proposal, is recorded in `tracking/BUILD_STATUS.md` (November 15 update, autopilot fixes from the third
live rerun), not in these files.
