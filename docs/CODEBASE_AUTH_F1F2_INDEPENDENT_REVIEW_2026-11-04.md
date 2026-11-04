# Independent review of the F1/F2 authentication repairs — November 4, 2026

Reviewer: Claude (Anthropic), running on the owner's device, started by the project coordinator for
Jordan on November 4, 2026.

**Independence.** I did not write the [follow-up review](CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md)
that raised F1 and F2, the [repair report](CODEBASE_AUTH_F1F2_REPAIRS_2026-11-04.md), ADR-0068, its
receipt or its tests, and I took no part in the earlier audit, repairs or reviews. I reused one
earlier artifact, that review's `races.mjs` (R1–R9), as a regression probe. I did not treat it as
proof on its own: I added my own mutation runner and checked receipt hashes separately. This is a
model review plus local fixture/contract execution. It is not a human acceptance decision and not
native installation, real WSL, CI, live-provider or activation evidence. No fixes were made.

## Candidate and hash reconciliation

- Base `171430b639b4dbd4170292894444cf2c01f3f27b` plus the uncommitted working tree.
- Key bytes inspected: `packages/db/src/connection-store.ts` `4390a029…ad2b100`,
  `tests/src/plan-connections.test.ts` `4e182008…6762760a`, `tests/src/claude-code.test.ts`
  `a3a1a1bc…dca832`, `packages/broker/src/plan-service.ts` `e8fd3dd2…0381fb7` (unchanged since the
  follow-up), `packages/db/src/migrations.ts` `ebb3a263…b325be` (unchanged since the follow-up),
  compiled `packages/db/dist/connection-store.js` `ac03e656…dae9c838f`, F1/F2 `receipt.json`
  `20f44f25…bc3e3cf6`.
- **F1/F2 receipt:** 13/13 `file_hashes` and 8/8 `log_hashes` match current bytes and sizes.
- **Follow-up receipt:** 75/85 `file_hashes` and 53/53 `prior_unchanged_hashes` match. The 10 that
  differ are the 7 sources and documents the F1/F2 receipt lists plus 3 compiled outputs
  (`packages/db/dist/connection-store.js`, `tests/dist/plan-connections.test.js`,
  `tests/dist/claude-code.test.js`), as expected after a rebuild. Nothing else drifted.
- **Not covered by either receipt:** the F1/F2 receipt and its `make-receipt.mjs` (self), and
  `tracking/evidence/codebase-auth-followup-independent-review-2026-11-04/README.md`. That README
  is ordinary evidence prose and matches its review; it is simply unhashed.
- `.codex/config.toml` differs from HEAD (the owner's pre-existing change) and still equals the
  recorded hash `d17c52fa…31946` (497 bytes). I did not touch it.

## Findings, most severe first

No Critical, High, Medium or Low finding. F1 and F2 are resolved. I found no authority, budget or
admission bypass and no change to counting.

### N1 — The "same-login refresh still counts" branch has no regression (Note, test coverage)

ADR-0068 says observations from a request still apply when the same login was refreshed while it
ran. The code does that: `sameLogin` compares only `auth_generation`
(`connection-store.ts:2519`), and `recordPlanAccessRefresh` does not advance it. But when I added a
credential-reference match to `sameLogin` (mutation `f1_requires_same_ref`), every test in
`plan-connections` and `claude-code` still passed. A future change that dropped quota or
eligibility observations after a refresh would go unnoticed. The case is narrow: it needs a refresh
by another request or process while one request is in flight, and `max_in_flight` is 1. Failing
here would leave the connection open for a request the provider then refuses ($0 on the plan path).
**Possible test:** settle a usage-limit 429 after a refresh A→B on the same login and expect
`quota.state = 'exhausted'`.

### N2 — A stale verification still reports "verified" to its caller (Note)

When a verification request ends after Disconnect or a new login, settlement correctly skips
`plan_model_access` (`connection-store.ts:2562`). Two things still say "verified": the
`model_verified` event (`:2580`, unchanged by design, per ADR-0068), and the response
`verifyModel` returns (`plan-service.ts:1230`, `verified: outcome === 'completed'`). The stored
state is correct, and admission reads the stored state. Only the immediate response and the audit
line may suggest the new login is verified. This happens only for verification that spans a
Disconnect plus a new sign-in, or a "Check Claude Code" mid-request.

### N3 — On Claude Code, "Check Claude Code" mid-request drops that request's observations (Note)

Every recorded Claude Code status check advances the generation (`connection-store.ts:1545`). So a
check made while a request is in flight makes that request "another login" for settlement. Its
quota or eligibility result, or its model verification, is recorded on the request only, even when
the CLI login did not change. This fails safe (nothing is wrongly granted or blocked) and follows
ADR-0067's choice to treat a check as a login boundary. It is worth one sentence in the ADR.

### N4 — The new relay and Claude Code tests check the settlement side, not bind-time refusal (Note)

In both new tests, Disconnect happens after the request is already bound. A mutation that makes
`bindPlanRequestCredential` do nothing passes all three new tests. It is caught by the older
ChatGPT-direct tests (`admission cannot dispatch under a replacement login`, `late authentication
failures … current_after_refresh`). The relay calls the same store method and settles `rejected`
with no token when it throws (`plan-service.ts:951–970`), so I see no defect. It is still a gap in
path-specific coverage. F2 asked for the settlement-side tests, and those are present.

## F1 — Settlement binds account observations to the login generation: **Resolved**

`#settlePlanRequest` (`connection-store.ts:2464–2601`):

- `sameLogin` requires a non-null request `auth_generation` equal to the connection's, read under
  `for update` on the request and then the connection. That is the same lock order as
  `bindPlanRequestCredential` (`:2414`). Both bigint values are compared as strings.
- Eligibility, quota and `plan_model_access` are written only when `sameLogin` holds. Sign-in
  invalidation additionally requires the same credential reference and `signed_in` (`:2544`), so
  ADR-0067's rule is unchanged in effect and now derived from the same check.
- The request row update (state, reason, tokens, hashes, output) does not depend on `sameLogin`, so
  outcomes are always recorded. Usage counts come from `plan_requests` rows (`:3089–3094`, day,
  run, build, in-flight and unresolved counts), so they stay correct. The new test asserts
  `last_24h_requests = 1` and the old outcome (`completed` or `rejected`) after a stale settlement.
- Legacy requests (null generation, from schema 40) record their outcome only. That is stricter
  than before for quota and eligibility, and is stated in ADR-0068.

Mutations on the compiled store (restored byte-for-byte, hash re-checked after each run):

| Mutation                               | New F1 test result                                  |
| -------------------------------------- | --------------------------------------------------- |
| All three gates removed (`f1_all`)     | `stale_limit`, `stale_success` fail; control passes |
| Quota gate only                        | `stale_limit`, `stale_success` fail                 |
| Eligibility gate only                  | `stale_success` fails                               |
| Model-access gate only                 | `stale_success` fails                               |
| `sameLogin` forced false (`f1_never`)  | `current_limit` and 14 other existing tests fail    |
| `sameLogin` also requires the same ref | nothing fails (N1)                                  |

Each gate is killed independently, and the control proves the fix is not "never apply".

## F2 — Codex relay and Claude Code regressions: **Resolved**

- **Codex relay** (`plan-connections.test.ts:1581`) goes through the real `codexAdmission` (admit,
  token, bind), then Disconnect, or Disconnect and a new sign-in, then a late 401 through
  `relay.settle`. It expects the sign-in state and version unchanged, and on the current login
  `reauthorization_required` with version +1. The setup inserts a verified model-access row and a
  qualification row directly. The test labels that as test-only plumbing, and it is used only to
  pass admission.
- **Claude Code** (`claude-code.test.ts:600`) wraps the store in a proxy that runs Disconnect (and
  "Check Claude Code") right after the real bind. It then drives a real `verifyModel` with the
  `auth_retry` fixture.

| Mutation                                               | Result                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Sign-in invalidation unconditional (pre-ADR-0067)      | relay `disconnect`, `new_login`; Claude `disconnect`, `checked_again` fail                   |
| Invalidation checks state only (no generation, no ref) | relay `new_login`; Claude `checked_again` fail                                               |
| Invalidation checks ref and state, no generation       | Claude `checked_again` fails (ref is null for Claude Code, so only the generation fences it) |
| Bind made a no-op                                      | new tests pass; older ChatGPT tests fail (N4)                                                |

The tests are meaningful: each fails when its own guard is removed, and the `current` scenarios
fail when the guard is too broad.

## Regressions: M1, L1, migration 41

- **M1:** `plan-service.ts` and the bind, admission and refresh code are byte-identical to the
  follow-up review's candidate. The only store change is in settlement, and it is covered above.
  R1–R9 rerun: R1, R2, R3 and R5–R9 give the same results as the follow-up review's log. R4 (stale
  quota after a new login) now leaves quota `unknown` with no blocker, which is the intended F1
  change. R9 had 16 rounds, no errors, nothing left unsettled, and 0 cases of an old login
  invalidating a newer one.
- **L1:** sign-in completion code is unchanged. R5–R8 are unchanged, and the browser sign-in tests
  pass in the full run.
- **Migration 41:** `migrations.ts` is unchanged since the follow-up review (hash matches). ADR-0068
  adds no migration. The storage checksum and v40→41 tests pass in the full run.

## Checks actually executed

Portable Node v22.23.4 (`.verification/repairs-2026-11-04/runtime/node.exe`). I used my own
disposable PostgreSQL 18.6 cluster (`C:\pgsql18\pgsql\bin`, initdb'd in this review's ignored
`.verification/auth-f1f2-review-2026-11-04/`, `127.0.0.1:55453`), stopped and deleted afterwards.
`CREATOR_PG_BIN=C:\pgsql18\pgsql\bin`. Reviewer ports `CREATOR_API_PORT=4330`,
`CREATOR_PREVIEW_PORT=4340` and `CREATOR_WEB_PORT=5183` were set for the suite. Fakes and loopback
only.

| Check                                                                         | Result                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Hash reconciliation (`hashcheck.mjs`)                                         | As above: 13/13, 8/8, 75/85 (10 expected), 53/53                                     |
| `tsc -b`                                                                      | exit 0                                                                               |
| New regressions, unmutated                                                    | 12/12 pass (3 tests, 9 subtests)                                                     |
| Mutation runs (`mutate.mjs`, 10 mutations)                                    | As tabled; compiled store restored, `ac03e656…` re-verified                          |
| Full compiled suite, `CREATOR_PG_BIN` set                                     | **769 tests, 742 pass, 0 fail, 0 cancelled, 27 skipped** (827 s), matching the claim |
| Current safety suite (`test:dev-safety` file list)                            | **22/22 pass**                                                                       |
| Earlier review's `races.mjs` R1–R9                                            | As above; no harness errors                                                          |
| `prettier --check` (format:check set, before this report); `git diff --check` | pass; pass                                                                           |

The 27 skips are the same explicit opt-in gates as before (pinned Codex binary, real WSL2 and
isolation, Linux pseudo-terminal, real Claude CLI). They are not counted as passes. Not run: web
typecheck, web build and browser walk (no web source changed since the follow-up review), Windows
`cargo check`, CI, real WSL, native install or upgrade, live ChatGPT or Claude, and the historical
v4 replay. The studio database, the installed app, credentials, `.codex/config.toml` and the
personal browser profile were not touched. No live provider, GitHub, payment or outbound call was
made. I added only this report, `tracking/evidence/codebase-auth-f1f2-independent-review-2026-11-04/`,
and ignored logs.

## Verdict and readiness

**Pass.** F1 and F2 are resolved on this exact candidate. M1, L1, L2, L3 and migration 41 show no
regression. The claimed 769/742/27/0 and 22/22 results reproduce, and the receipt hashes match.
N1–N4 are optional notes and do not block. The next gate is owner-authorized acceptance work,
starting with a migration-41 rehearsal on a copy of a real schema-40 database before any
installed-app upgrade. Everything here is fixture/contract evidence. This review does not mark the
product complete and does not authorize installation, release or activation.

## Addendum: committing the candidate (after the review)

Jordan then asked for the candidate to be committed. Git would have normalized one receipt-bound
file, `tracking/evidence/codebase-audit-2026-11-04/signout-race.log` (CRLF), to LF in the
repository. So `.gitattributes` gains one `-text whitespace=cr-at-eol` line for it, next to the
other November 4 byte-bound entries. This is the only byte change since this review. It makes
`.gitattributes` differ from the follow-up receipt (`2bb269d6…eb685b`, 10,570 bytes → `1ddf6e12…24e78a0`,
10,658 bytes). Every committed blob was checked against its working-tree bytes (0 mismatches).
`.codex/config.toml` was left out of the commit.
