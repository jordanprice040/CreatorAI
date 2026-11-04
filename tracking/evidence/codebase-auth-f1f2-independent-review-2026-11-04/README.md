# F1/F2 repair independent review evidence

Independent recheck of the uncommitted F1/F2 repairs on `171430b`; see
[the review report](../../../docs/CODEBASE_AUTH_F1F2_INDEPENDENT_REVIEW_2026-11-04.md).

- `hashcheck.mjs`: reconciles the F1/F2 receipt and the follow-up receipt with current bytes.
- `mutate.mjs`: disables parts of the fix in the compiled `packages/db/dist/connection-store.js`,
  runs the given test files, then restores the exact bytes and checks the hash. Sources are never
  edited. `mutations-*.json` are its outputs.
- `races-r1-r9.log`: the earlier follow-up review's `races.mjs`, rerun unchanged on this candidate.

Run from the repository root after `tsc -b`, with Node 22.23.4+ and `CREATOR_TEST_DATABASE_URL`
pointing to a disposable PostgreSQL server. Full logs (suite, safety, focused, per-mutation, format)
are in ignored `.verification/auth-f1f2-review-2026-11-04/`. The PostgreSQL 18.6 cluster (port 55453) was deleted afterwards. Fixture/contract evidence only.
