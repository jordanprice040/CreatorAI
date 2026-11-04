# Authentication review follow-up — November 4, 2026

Candidate: main `171430b639b4dbd4170292894444cf2c01f3f27b` plus the uncommitted audit repairs and this authorized follow-up. The pre-existing `.codex/config.toml` change is outside scope and preserved. This addresses M1 and L1–L3 in [Claude's independent review](CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md); that review is evidence about the earlier candidate, not independent approval of these repairs.

## Changes

- **M1:** migration 41 adds a private connection login generation and request generation/credential snapshots. Dispatch binds the actual credential after refresh and refuses an admission that crossed into a replacement login. A late authentication failure changes sign-in state only when generation, credential reference and current signed-in state match, and increments the connection version when it applies. Disconnected, newer-login and newer-refresh states survive stale failures. Request outcomes and daily counts remain intact.
- **L1:** browser completion checks login generation rather than the whole settings version. Confirming credits, editing settings, accepting caps or refreshing the same login no longer cancels an otherwise valid sign-in. Sign-in/out and recorded Claude status observations advance generation. Completion removes the actual replaced credential, including one created by an intervening refresh. Cross-service callbacks and refresh still preserve Disconnect/newer logins.
- **L2:** the original browser receipt described an earlier build. The additive [browser binding correction](../tracking/evidence/codebase-auth-followup-2026-11-04/browser-binding-correction.json) points to Claude's executed production-browser walk and the matching fresh build assets. No new browser walk or independent approval is claimed. UI sources did not change in this follow-up; server changes have separate contract evidence.
- **L3:** the current handoff again lists #77 L-1, #90 N-4, #128 N-6 and #129 N-4 as open. Missing original detail for two items is explicit; none is silently closed. #75 L-1 remains repaired by current-prompt qualification labels.

The new generation and credential reference are internal database/service metadata, not credentials or new public permissions. ChatGPT direct dispatch, Claude Code and Codex admission use the binding. Existing eligibility/quota observations retain their prior behavior; this repair specifically fences authentication invalidation. No automatic retry, allowance reset, new authority or provider route is added. See ADR-0067.

## Verification

All provider interactions used fakes/loopback fixtures on disposable PostgreSQL 18.6 at port 55449, with portable Node 22.23.4. The operational database, installed studio, system Node and historical bundle were not changed.

Current final results and hashes are recorded in [the follow-up receipt](../tracking/evidence/codebase-auth-followup-2026-11-04/receipt.json). Full database suite: **757 tests, 730 pass, 27 explicit skips, zero failures or cancellations**. Current safety suite: **22/22 pass**. TypeScript project build, web typecheck, production build, formatting and `git diff --check` pass. The web large-chunk warning remains. The focused post-fix run passed 11/11; the final full suite additionally covers the migration, replacement-admission and newer-refresh cases. The pre-fix diagnostic retains seven failing regressions rather than replacing them with successful results.

New regressions exercise late 401 after Disconnect, replacement login and newer refresh; current-credential 401 after admission-time refresh; generation-less legacy requests; replacement-login refusal before dispatch; unrelated browser-time credits/settings/cap changes; and refresh during browser sign-in with credential cleanup. The migration check reconstructs a v40 layout with an existing signed-in connection and pending request, reapplies migration 41, verifies preserved rows/counts, and refuses to invent a legacy auth binding. Existing migration checksum verification also runs; this is synthetic migration evidence, not native upgrade acceptance.

Claude's unchanged six-scenario `races.mjs` reproducer now records: old callback after Disconnect stays signed out; late 401 preserves signed-out v7 and newer signed-in v8; credits and refresh during browser sign-in both complete; two concurrent refreshes make one token request. The new tests also require a genuinely current failed credential to enter reauthorization-required and increment version.

Original audit, repair, independent-review reports/receipts, frozen upgrade sources, document archives and browser evidence remain unchanged. The old repair receipt intentionally does not bind to the newly changed server bytes. This follow-up adds its own hashes and logs. The schema-40 staged bundle remains historical and must not be presented as a schema-41 release.

## Remaining boundaries and next gate

No live model call, native install, real WSL build, CI execution, paid activation, release or study was performed. Existing explicit test skips and the web large-chunk warning remain visible. C54 and full-product acceptance remain partial. Reviewer notes N1–N4 remain observations rather than new completed work (vault orphan cleanup, stronger terminal sentinel, unexecuted/unpinned Windows CI and reload after a rejected lazy import).

Next eligible: **U02 independent review of the exact follow-up candidate**, concentrating on migration 41, login/request credential binding, callback cleanup and the new regressions. Then only the remaining authorized acceptance work; no automatic milestone or installation follows.
