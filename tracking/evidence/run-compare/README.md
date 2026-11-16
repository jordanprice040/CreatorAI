# Compare two runs (F7, ADR-0120): browser walk

`walk.mjs` ran in the cloud container on November 15, 2026 against a throwaway PostgreSQL 16 database (`run_compare_walk`), the review ports (5183/4330/4340, via `../owner-actions/stack.mjs`), fixture provider only: no model call, $0. It seeds `seed-discovery`, starts two autopilots at assessment of the same problem with request limits 80 and 60 (both stop at the fixture's tie), then opens Autopilot › Compare runs.

`walk.txt`: 12/12 checks pass (label in the answer and on the page, same problem, the tab, default pair older on the left, the request-limit caution, the Requests row, the stop at the choice, Swap, the address keeping the pair, no sideways scroll at 390 px, no page errors).

- `01-compare-runs.png`: desktop, 1280 px wide.
- `02-phone.png`: 390 px wide.

The first run of the walk found the right column clipped (the ranking table keeps its third column on one line); `run-compare.css` now lets both columns wrap and fixes the column widths.
