# F1/F2 repairs from the authentication follow-up review — November 4, 2026

Jordan authorized these repairs after the [follow-up review](CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md)
("please do so"). The same Claude thread that wrote that review made them, so the review's
independence does not cover these bytes. They need their own independent check. Candidate:
main `171430b` plus the uncommitted working tree. Nothing is committed. `.codex/config.toml` is
unchanged. See ADR-0068.

## Changes

- **F1** (`packages/db/src/connection-store.ts`, `#settlePlanRequest`): eligibility, quota and
  model-access observations from a settled request are applied only when the request's
  admitted `auth_generation` still equals the connection's. A result that ends after Disconnect
  or a replacement login is still recorded and counted on the request, but no longer changes the
  newer login's usage-limit, eligibility or verified-model state. A same-login refresh keeps the
  generation, so its observations still count. Legacy requests without a generation record
  their outcome only. The sign-in invalidation rule from ADR-0067 is unchanged and now reuses the
  same generation check.
- **F2** (tests only): `tests/src/plan-connections.test.ts` adds the stale-observation
  regression (old login's usage limit, old login's success, current login's limit as control)
  and a Codex relay regression (late 401 after Disconnect, after a new login, and on the current
  login). `tests/src/claude-code.test.ts` adds a Claude Code regression: an authentication
  failure after Disconnect, after Disconnect plus a new check, and on the current login.

## Verification

Portable Node 22.23.4, own disposable PostgreSQL 18.6 cluster on `127.0.0.1:55452` (removed
afterwards), fakes and loopback only. Logs are in ignored `.verification/f1f2-repair-2026-11-04/`.

| Check                                                                         | Result                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| New regressions (3 tests, 9 subtests)                                         | 12/12 pass                                                                               |
| Mutation: F1 fix disabled in the compiled store (then restored byte-for-byte) | F1 test fails (stale_limit, stale_success), control passes                               |
| `tsc -b`; web `tsc --noEmit`                                                  | exit 0; exit 0                                                                           |
| Full compiled suite, `CREATOR_PG_BIN` set                                     | **769 tests, 742 pass, 0 fail, 0 cancelled, 27 skipped**                                 |
| Current safety suite                                                          | 22/22                                                                                    |
| `prettier --check` (format:check set); `git diff --check`                     | pass; pass                                                                               |
| Review `races.mjs` R1–R9 rerun                                                | R4 now leaves the newer login's quota `unknown` with no blocker; other results unchanged |

The 27 skips are the same explicit opt-in gates as before. No web source changed, so the web
build and browser evidence were not repeated. No live provider call, installed-app change,
operational-database migration, release or outbound message.

## Remaining boundaries and next gate

Fixture/contract evidence only; no native, real-WSL, CI, live or activation acceptance. The
open items in the handoff (#77 L-1, #90 N-4, #128 N-6, #129 N-4) and review notes N1–N3 are
unchanged. Next eligible: a focused independent recheck of `#settlePlanRequest` and the three
new tests, then owner-authorized acceptance work, including a migration-41 rehearsal on a copy
of a real schema-40 database before any installed-app upgrade.
