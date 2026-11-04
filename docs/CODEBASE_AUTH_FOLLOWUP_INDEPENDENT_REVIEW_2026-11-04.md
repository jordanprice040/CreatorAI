# Independent U02 review of the November 4 authentication follow-up

Reviewer: Claude (Anthropic), running on the owner's device at Jordan's request, November 4, 2026.

**Prior involvement and independence.** An earlier Claude thread in this project wrote
[the previous review](CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md), which raised M1, L1, L2
and L3, and its evidence (`races.mjs`, `browser.json`). The follow-up reuses that reproducer and
cites that `browser.json` as its L2 correction, so part of this review checks how evidence from a
Claude review is being used. I did not design, write or test the follow-up. Its report and receipt
do not name their author and the changes are uncommitted, so git cannot show who wrote them; the
project coordinator says the implementer was Codex. Because of that earlier involvement, I did
not treat the old reproducer as enough: I wrote a new one (R1–R9 below) covering paths the old
one and the implementer's tests do not. This is a model review plus local fixture/contract
execution. It is not native installation, real WSL, CI, live-provider or activation acceptance,
and it is not a human acceptance decision.

## Reviewed candidate and hash reconciliation

- Base commit `171430b639b4dbd4170292894444cf2c01f3f27b` (`git rev-parse HEAD`) plus the uncommitted
  working tree: 70 changed or untracked paths, not counting this review's own files. The SHA-256 list
  of those 70 files is in `.verification/auth-followup-review-2026-11-04/candidate-sha256.txt`
  (digest of that list `2b9aa033…acfd65`). Key files: `packages/db/src/connection-store.ts`
  `f42fe513…160d46`, `packages/broker/src/plan-service.ts` `e8fd3dd2…381fb7`,
  `packages/db/src/migrations.ts` `ebb3a263…1325be`, `tests/src/plan-connections.test.ts`
  `ee3b0dde…13f7bd50b`, follow-up `receipt.json` `90f1e2c9…8e8037`.
- **Follow-up receipt:** all 85 `file_hashes` and all 53 `prior_unchanged_hashes` entries match the
  current bytes and sizes (138/138). The only changed paths it does not list are the receipt itself
  and `.codex/config.toml`, which is unchanged from the receipt's recorded user-config hash
  (`d17c52fa…31946`, 497 bytes) and was not touched by this review.
- **Prior repair receipt** (`codebase-repairs-2026-11-04/receipt.json`, `63350cdd…a75980`, equal to the
  follow-up's `prior_receipt`): 53 of its 62 entries still match. The 9 that differ are exactly the
  follow-up's changed files (connection store, plan service, two test files, current status, build
  status, decisions, integrations, handoff). That is the expected result: the old receipt is bound to
  the earlier candidate, as the follow-up says.
- **Original evidence intact:** the audit, repair and earlier review reports and their evidence are
  covered by those hash lists and match. The earlier review's evidence files all have modification
  times at or before 04:15:45, before the follow-up report (04:57), so nothing was edited after that
  review. Migrations 1–40 are byte-identical to the baseline (`git diff HEAD` on `migrations.ts` adds
  only migration 41), so their checksums cannot have changed. `storage.test.ts`'s
  edited-history refusal still passes.

## Findings, most severe first

No Critical, High or Medium finding. I found no authority, budget or admission bypass and no
credential disclosure. The new generation and credential-reference columns are not exposed
through `toRequest`/`toConnection` (`connection-store.ts:240`).

### F1 — A stale request can still change a newer login's quota or eligibility (Low)

- **Where:** `packages/db/src/connection-store.ts:2516–2533`. Settlement writes `eligibility` and `quota`
  from any outcome, without the `currentCredential` check that now protects `sign_in`
  (`:2535`). Admission refuses on `quota.state === 'exhausted'` or
  `eligibility.state === 'not_eligible'` (`packages/domain/src/plan-admission.ts:54,58`).
- **Reproduction (R4, `races.mjs`):** a request is in flight, then the owner disconnects and signs
  in again. The old request's late `429 subscription_sharing_usage_limit_exceeded` arrives
  afterwards. Sign-in state is correctly kept (`signed_in`, v8). But quota changes from
  `unknown` to `exhausted` with no version change, and the new login is blocked with "The ChatGPT
  plan usage limit was reached". The reverse also follows from the code, though I did not run
  it: a stale success sets `eligible`/`available` over a newer `not_eligible`/`exhausted` reading.
- **Consequence:** this is the same kind of stale result overriding a newer login that M1 fixed for
  sign-in state. When the quota is wrongly marked exhausted, requests are refused (safe), and the
  owner clears it with "Usage has reset". When the account is wrongly marked eligible, requests are
  allowed that OpenAI will refuse ($0 on the plan path). The follow-up report and ADR-0067 say
  plainly that eligibility and quota keep their earlier behavior, so this was a stated scope
  limit, not something hidden. It pre-dates the follow-up, and observations also carry over to a
  new login without any race, because `recordPlanSignIn` does not reset them.
- **Smallest fix (not applied):** apply `eligibility`/`quota` only when `currentCredential`
  holds, or at least when `auth_generation` matches, and add R4 as a regression.

### F2 — The new binding has no regression on the Codex relay or Claude Code paths (Low, test coverage)

- **Where:** `plan-service.ts:912–1010` (`codexAdmission`, which binds at `:951`) and `:830` (Claude
  Code binding `null`). No test calls `codexAdmission`. No Claude Code test covers a late failure
  after Disconnect or a recorded status check. The new tests cover only ChatGPT direct calls.
- **What I checked by reading the code:** both paths reach the same `bindPlanRequestCredential` and
  `#settlePlanRequest` SQL that R1–R3 and R9 exercise. On a bind failure, Codex settles `rejected`
  and returns no token. Claude Code connections never have a credential reference, so for them
  only the generation fences a stale result. That generation advances on Disconnect and on every
  owner "Check Claude Code" (`connection-store.ts:1515`). A `claude auth login` run outside the
  studio is not seen until the next check. The existing Claude Code test that a pre-dispatch
  non-subscription status sets `reauthorization_required` still passes.
- **Consequence:** I see no defect in either path, but nothing would catch a future regression in
  them. **Fix:** one relay test (late 401 after Disconnect and after a new login) and one Claude
  Code test (late `authentication_failed` after Disconnect).

### Notes (no action required)

- **N1 lock order.** `bindPlanRequestCredential` (`:2414`) locks the request row, then the connection,
  the same order as settlement. Owner reconciliation locks in the reverse order (`:1360`). It is still
  protected by the live-request set and the at-least-45-minute stale point, and binding happens
  within seconds of admission. Requests run by a separate worker process are covered only by the time
  rule, as ADR-0064 already says. R9 (16 concurrent rounds of a 401, Disconnect and a new sign-in
  across two services) saw no deadlock, no error and no unsettled request.
- **N2 spurious refusal.** If another process refreshes the same login between `accessToken` and the
  bind, the bind refuses with "The login changed before dispatch". This fails closed (nothing is sent,
  the request is counted as `rejected`) and needs a cross-process race inside a single request. With
  `max_in_flight` at 1 it is unlikely.
- **N3 earlier notes.** N1–N4 from the previous review (vault orphan on crash, terminal sentinel,
  unexecuted Windows CI, reload after a failed lazy chunk) are unchanged and still listed as open.
- **Migration test realism.** The v40 reconstruction drops the new columns from a v41 database. That
  keeps rows and counts but is not a real v40 dump. It is synthetic upgrade evidence, as the report
  says.

## Dispositions

| Item             | Disposition                                                              | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**           | **Resolved** for sign-in state. F1 and F2 are adjacent, not regressions. | Admission records the generation and reference while holding the connection lock (`:2373`). The bind refuses a changed generation, a non-signed-in state or a different reference (`:2414`). Settlement invalidates only a matching, signed-in generation and reference, and bumps the version (`:2535–2543`). R1: a current-credential 401 gives `reauthorization_required`, v5→6. R2: an old admission held before the bind across Disconnect and a new login is refused (`unauthenticated`, 0 responses sent, new login v8 unchanged, request recorded `rejected`). R3: a late 401 after a same-login refresh A→B leaves `signed_in` v6. The old reproducer's late 401 after Disconnect stays `signed_out` v7, and after a new login stays `signed_in` v8. R9: an old-login 401 never invalidated a newer login (10/10). The 6/16 rounds that ended in `reauthorization_required` were all requests admitted under the final login, so the current credential was correctly invalidated. Request rows settle and stay counted. |
| **L1**           | **Resolved**                                                             | Completion checks the generation (`connection-store.ts:1455`), not the whole version. R7: credits, a settings edit and cap acceptance during a first sign-in → `completed`, 1 vault entry. R8: a refresh A→B during "Sign in again" → completed; A and B both removed; only the new credential remains. R5: Disconnect during the code exchange → refused, `signed_out`, its own candidate removed (0 vault entries). R6: two services, two successful callbacks → first completes, second refused, 1 vault entry (the current one).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Migration 41** | **Resolved** (synthetic evidence only)                                   | Three `alter table … add column` statements: the connection generation is `not null default 0`, and the request generation and reference are nullable. These keep existing rows and need no backfill. A legacy request with no binding cannot pass `currentCredential` or the bind. History checksums are unchanged. The implementer's v40→41 test and the storage checksum test pass in my run. No real schema-40 database was upgraded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **L2**           | **Resolved**                                                             | `browser-binding-correction.json` gives the earlier review's `browser.json` hash (`6d999e08…`, verified), sets `new_browser_walk_executed: false` and keeps the original receipt. My fresh web build produced `index-CnE4waY8.js` `e1d4101a…` and `models-7yCgyMjJ.js` `5a4a51a1…`, byte-equal to the correction and to that walk's asset names. The web sources match the earlier receipt's hashes (unchanged since the walk). The cited build log hash matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **L3**           | **Resolved**                                                             | `tracking/SESSION_HANDOFF.md` lists #77 L-1, #90 N-4, #128 N-6 and #129 N-4 as open. It says the original detail for #77 L-1 and #128 N-6 is not recovered. The #90 N-4 and #129 N-4 descriptions match the history (lines 663 and 94). `BUILD_STATUS.md` points to the handoff list. Status documents keep source implementation, synthetic checks, pending independent review, native acceptance and live activation separate, and none claims acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Checks actually executed

All with portable Node v22.23.4 (`.verification/repairs-2026-11-04/runtime/node.exe`) on my own
disposable PostgreSQL 18.6 cluster at `127.0.0.1:55451` (initdb in this review's `.verification`
folder). Logs are in ignored `.verification/auth-followup-review-2026-11-04/`.

| Check                                                                                                       | Result                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Receipt/prior-receipt/correction/user-config hash reconciliation (`hashcheck.mjs`)                          | Follow-up 138/138 match; prior receipt 53/62, the 9 differences are exactly the follow-up's files |
| `tsc -b`                                                                                                    | exit 0                                                                                            |
| Web `tsc --noEmit`; `vite build`                                                                            | exit 0; assets identical to the L2 correction; large-chunk warning remains                        |
| `prettier --check` (format:check set, before this report); `git diff --check`                               | Pass; pass                                                                                        |
| Full compiled suite, `CREATOR_PG_BIN=C:\pgsql18\pgsql\bin`                                                  | **757 tests, 730 pass, 0 fail, 0 cancelled, 27 skipped** (805 s), matching the claim exactly      |
| Current safety suite (`test:dev-safety` file list)                                                          | **22/22 pass**                                                                                    |
| Earlier review's `races.mjs`, unchanged                                                                     | All six results as the follow-up claims (see M1/L1 rows)                                          |
| This review's `races.mjs` R1–R9 (`tracking/evidence/codebase-auth-followup-independent-review-2026-11-04/`) | Results above; F1 reproduced; no harness errors                                                   |

The 27 skips are the same explicit opt-in gates as before (pinned Codex binary, real WSL2 and
isolation, a Linux pseudo-terminal, the real Claude CLI). They are not counted as passes. Not run:
the pnpm launcher (I ran the same commands directly), Windows `cargo check` (no Rust changed),
a browser walk (no UI source changed), CI, real WSL, native install or upgrade, live ChatGPT or
Claude, and the historical v4 replay. After the run I stopped my cluster and deleted its data
directory. The studio database (`creator_studio`, port 55433), the installed app, credentials and
the personal browser profile were not touched. No live provider, GitHub, payment or outbound call
was made. No source or earlier evidence was changed. This review adds only this report and the
new evidence folder.

## Remaining risks and readiness

- F1 (stale quota/eligibility across logins) and F2 (no Codex/Claude Code regression for the
  binding) are open Lows. Neither blocks the next gate, and both are small to repair.
- Everything here is fixture/contract evidence on synthetic databases. Migration 41 has not been
  applied to a real schema-40 studio. The staged schema-40 bundle is historical and must not be
  shipped as schema 41.
- Concurrency was tested within one Node process with two service instances and real PostgreSQL
  locking. A separate worker process was not run.

**Verdict: Pass with Lows.** M1, L1, L2 and L3 are resolved on this exact candidate. The
claimed 757/730/27/0 and 22/22 results reproduce, the hashes reconcile, and I found no
actionable defect at Medium or above. The candidate is ready for the next acceptance gate, which
is owner-authorized acceptance work. That should include a migration-41 upgrade rehearsal on a copy
of a real schema-40 database before any installed-app upgrade. F1 and F2 can go in a small U03 now or
be recorded as open items. This review does not mark the product complete and does not authorize
installation, release or activation.
