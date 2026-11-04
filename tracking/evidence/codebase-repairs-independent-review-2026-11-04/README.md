# November 4 repair review evidence (U02)

Independent review of the uncommitted repairs on `171430b`; see
[the review report](../../../docs/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md).

- `races.mjs` / `races.log`: fixture-only sign-in, Disconnect and refresh scenarios against the
  real `ConnectionStore` on a disposable PostgreSQL database (`CREATOR_TEST_DATABASE_URL`),
  `MemoryVault` and the loopback fake OAuth server. Run from the repository root after `tsc -b`.
- `browser-stack.mjs`: throwaway fixture database and production UI on review ports
  5183/4330/4340, worker off, no live provider. Touch `.verification/review-2026-11-04/stop-browser`
  to close it and drop its database.
- `browser.json`, `models-390.png`: observations from the walk on the current build.

Full logs are in ignored `.verification/review-2026-11-04/`. The disposable PostgreSQL 18.6
cluster (port 55447) was deleted afterwards. This evidence is fixture/contract/compilation
only; it is not CI, real WSL, native installation, live or activation evidence.
