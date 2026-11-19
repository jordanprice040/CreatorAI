# Thesis draft 2 evidence (November 19, 2026)

Records made for `docs/thesis/` draft 2. Cloud container only: nothing ran on Jordan's PC, no real
database (installed app, dev studio) was touched, no model was called and nothing was spent.

## Full test run on main `b9270db` (E11)

TEST-RUN-PENDING

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
