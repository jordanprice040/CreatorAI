# Creator Agent codebase audit — November 4, 2026

What this repo does: Creator Agent is a local evidence and product studio with a web UI,
Windows desktop shell, PostgreSQL catalog, controlled model connections, durable workflows,
and a constrained Python product build/package path. This audit assumes one local owner,
multiple workspaces and concurrent background activity, with hosted and commercial adapters
remaining separately configured and authorized.

Candidate: `171430b` (full identity recorded in the verification receipt). The pre-existing
change to `.codex/config.toml` was preserved. This is a risk-based whole-repository audit,
not a claim to have read every line or certified every integration. No application code,
dependency, runtime policy, frozen benchmark, installed application or studio data was changed.

## Must fix

1. **The supported runtime misses published security fixes (P1).**
   - **What this is:** `.node-version:1` and both stages of
     `deploy/hosted/Dockerfile:3` pin Node 22.21.0. `package.json:7` and setup guides accept it;
     `apps/desktop/build-studio.mjs:83` copies the builder's Node executable into the installer.
   - **Problem:** This audit actually ran on 22.21.0. The official October 21 release,
     22.23.4, fixes DNS, TLS, HTTP and Brotli vulnerabilities; builds made on the older
     runtime carry that older runtime into the desktop bundle. This establishes an outdated
     security baseline, not that every advisory is exploitable through this application.
   - **Fix:** Select a current patched supported 22.x or 24.x release, update runtime pins,
     engine floors and setup guidance together, rebuild, and verify the bundled executable's
     version/hash. Version the new candidate rather than changing historical package evidence.
   - **If we skip it:** Development, CI, hosted builds and newly packaged desktop releases
     continue accepting or distributing a runtime with known unfixed vulnerabilities.
   - **Evidence:** [Official Node security release](https://nodejs.org/en/blog/release/v22.23.4)
     and [October advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

2. **A pending browser sign-in can reverse Disconnect (P2).**
   - **What this is:** `packages/broker/src/plan-service.ts:273` starts a callback and later
     saves its credentials. `signOut` at line 522 deletes credentials and records sign-out.
   - **Problem:** On an already signed-in fixture connection, start “Sign in again,”
     disconnect, then finish that older browser flow. The real store changes from
     `signed_out` back to `signed_in`; sign-out does not invalidate the pending callback,
     and `recordPlanSignIn` does not bind completion to an active sign-in generation.
   - **Fix:** Invalidate pending attempts on disconnect and bind completion to a durable
     attempt/version checked under the connection lock. Fence credential publication too;
     test delayed callback and refresh completion against sign-out without weakening gates.
   - **If we skip it:** The owner can disconnect successfully and later regain a connected
     account without a new connection action after that disconnect.
   - **Evidence:** `.verification/audit-2026-11-04/signout-race.mjs` and its JSON log;
     real `ConnectionStore`, disposable PostgreSQL, `MemoryVault`, loopback fake OAuth only.

3. **Development startup falsely promises fixture-only operation (P2).**
   - **What this is:** `scripts/dev.mjs:4` passes the real environment to `createApi`.
     Its startup text at lines 29 and 42 nevertheless always says “Fixture API” and
     “Fixture provider only, no real AI.”
   - **Problem:** With `CREATOR_LIVE_PROVIDER=openai` and a key, the factory in
     `packages/broker/src/env.ts:9` constructs a live adapter. Development also exposes plan
     connections; the printed guarantee does not describe the configured system.
   - **Fix:** Print the actual configured adapter and connection availability, and distinguish
     configuration from an authorized dispatch. Reuse the health summary and test startup
     wording with fixture, configured-live and plan-capable settings without provider calls.
   - **If we skip it:** An owner can mistake a development process capable of authorized
     real inference for a guaranteed synthetic-only demonstration. Admission gates still apply.

## Should fix

4. **The normal Windows test gate fails on its fixtures and checkout path (P2).**
   - **What this is:** `tests/src/claude-fake.ts:81` writes an executable named `claude`
     using a Unix shebang. Claude adapter and chat tests spawn it directly.
   - **Problem:** Windows cannot execute that file as a native executable. Six adapter
     tests and ten database-backed chat/connection cases fail outside the sandbox for this
     reason; a terminal test also mistakes `creator_agent` in its fixture path for a leaked
     `CREATOR_` setting (`tests/src/terminal.test.ts:220`). CI runs Ubuntu jobs only.
   - **Fix:** Supply a Windows-compatible fake process entry point through a narrowly scoped
     test seam, retaining production refusal of shell shims. Run the supported Windows
     contract suite in CI alongside Linux, and check actual secret values/environment
     assignments rather than a path substring; keep real WSL/native acceptance distinct.
   - **If we skip it:** The primary supported platform has a persistently red gate, so new
     Windows regressions are hard to distinguish from known fixture failures.

5. **Standard checks omit standalone safety tests (P2).**
   - **What this is:** `package.json:15` tests `tests/dist/*.test.js`, compiled from
     `tests/src/**/*.ts`. Some standalone suites are explicitly imported into that route.
   - **Problem:** `tests/dev-artifact-retention.test.mjs` and the root theme-intent upgrade
     guard suites have no equivalent standard-script/CI invocation. The separately executed
     retention/v4 guard run found a failing guard assertion that normal `pnpm check` cannot see.
     That assertion meets a historical package-hash refusal before reaching its intended
     approval-switch check; it does not show an approval bypass.
   - **Fix:** Add named, documented gates for current standalone development safety tests.
     Separate frozen candidate replay from portable current guards so later source changes
     do not make a guard test exercise only an earlier identity refusal. Preserve frozen hashes.
   - **If we skip it:** Safety tooling can regress while the ordinary project gate stays green,
     and historical replay failures can be mistaken for current policy enforcement tests.

6. **Current entry-point documentation contradicts the implemented product (P2).**
   - **What this is:** `README.md:39` still lists desktop, hosted control and remote GitHub
     automation as broader work. `docs/CURRENT_STATUS.md:1` calls itself current but leads
     with October 23 preparation, and the linked October 18 product guide describes no installer.
   - **Problem:** Newer code and tracking include desktop startup/bundling, scoped GitHub,
     hosted deployment adapters, chat, owner-action forms and exploration (schema 40).
     “Not implemented,” “not activated” and “not verified on this installed candidate” are
     different states. The runbook also still lists already-shipped pilot UX work as future work.
   - **Fix:** Publish one dated current capability/evidence matrix and next-step summary,
     refresh README/setup/runbook links, and label old audits as historical. Preserve frozen
     evidence, dated owner decisions and original results instead of rewriting history.
   - **If we skip it:** Owners and coding agents repeatedly plan completed work or infer
     unsupported readiness from the wrong candidate's status.

7. **Models can show a stale-prompt qualification as qualified (P2, previously known).**
   - **What this is:** `packages/db/src/connection-store.ts:264` rejects build qualifications
     on older role prompts. `apps/web/src/qualification-results.tsx:45` displays their stored state.
   - **Problem:** Models at `apps/web/src/models.tsx:981` warns about a newer failed
     qualification but has no current-prompt eligibility flag. A historical pass can appear
     qualified even though the same connection is refused at build admission. The November 3
     handoff already records this as unfinished #75 L-1.
   - **Fix:** Return the current eligibility and reason from the existing server rule; label
     historical passes accordingly. Test an old-prompt pass against the displayed blocker.
   - **If we skip it:** The owner is told a model is ready while the build correctly refuses it.

## Nice to have

8. **Load secondary pages when opened (P3).**
   - **What this is:** `apps/web/src/main.tsx:13` eagerly imports the application's page
     modules, including study, payments, marketing and operations screens.
   - **Problem:** The fresh production build emits one 1,042.85 kB JavaScript chunk
     (290.82 kB gzip), and Vite flags it as large. Startup downloads and parses secondary
     features too; no actual user-perceived latency regression was measured in this audit.
   - **Fix:** Use page-level lazy imports for secondary screens, preserving page drafts,
     navigation and accessible loading/error behavior. Measure cold startup before and after.
   - **If we skip it:** Every startup keeps paying the transfer and parse cost of all pages.

9. **Keep the handoff small enough to read reliably (P3).**
   - **What this is:** `tracking/BUILD_STATUS.md` is 597,645 bytes and
     `tracking/SESSION_HANDOFF.md` is 545,281 bytes before this audit's entry.
   - **Problem:** Both repeat a long historical session narrative. Loading the required
     startup documents together exceeded tool output limits during this audit and hid content.
   - **Fix:** Keep a concise current handoff and index of immutable dated session records;
     move history with stable references. Use a dated evidence matrix for implementation,
     contract, live, native and activation state rather than another copied narrative.
   - **If we skip it:** Future sessions spend more context on obsolete state and can miss
     current blockers or accepted owner decisions despite reading the prescribed files.

## Suggested additions and order

These are recommendations, not newly authorized runtime integrations or a new milestone.

1. Repair findings 1–5 and rerun the affected gates before the final exact-candidate UX pass.
   Finish the existing owner-pilot/release acceptance work before expanding the product surface.
2. Prioritize the already requested owner file library and evidence uploads. Keep originals,
   hashes, extraction locators, explicit retention and review-before-claim-acceptance; compare
   a simple local import flow with a new connector before building the latter.
3. Implement the already planned evidence-gap-to-search/draft-claim flow only after its
   provider/configuration/grant decisions. Keep search snippets, fetched passages, proposed
   claims and owner-accepted evidence distinct. An existing browser/manual research workflow
   remains a useful baseline.
4. Finish the planned previewable, locally redacted diagnostics export for support and pilot
   failures. Include candidate/schema versions, bounded error codes and unresolved work;
   exclude credentials, raw chat, private source contents and participant keys by default.

## Verification and limits

| Check executed                                              | Result                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TypeScript project build and web typecheck                  | Passed                                                                              |
| Production web build                                        | Passed; large-chunk warning recorded in finding 8                                   |
| Repository formatting check                                 | Passed before audit documents were added; new report/evidence also formatted        |
| Windows Rust `cargo check --locked --offline`               | Passed; compilation only                                                            |
| Full suite with disposable PostgreSQL 18.6, outside sandbox | 744 tests: 700 passed, 17 failed, 27 skipped                                        |
| Standalone retention and v4 upgrade guards, outside sandbox | 19 tests: 18 passed, 1 failed                                                       |
| Disconnect race with real store and fake OAuth              | Reproduced, including already-signed-in → sign in again → disconnect → old callback |

The 17 full-suite failures are 16 Windows Claude-fixture failures plus the terminal
path/secret-regex false positive in finding 4. The standalone failure meets a stale historical
candidate hash before its intended guard assertion (finding 5). The suite is **not passing**.
`pnpm check` itself could not start because its launcher failed DNS when resolving the pinned
pnpm; the already installed compiler, test runner, Vite and Prettier were used directly.
The initial sandbox suite (457 pass, 32 fail, 251 skip) is diagnostic, superseded by the
outside-sandbox run for loopback/file behavior. All database work used a separate disposable
cluster and throwaway databases; no personal studio data or live inference was used.

Final command results and environment are recorded in
`tracking/evidence/codebase-audit-2026-11-04/receipt.json`.
Large logs and the executable sign-out reproduction are under
`.verification/audit-2026-11-04/` (ignored development evidence).

The review traced API authentication, connection admission/token lifecycle, budget arithmetic
and reservation paths, workflow leasing/cancellation, discovery/exploration packets, source
DNS/redirect enforcement, product filesystem/Git/archive boundaries, backup/restore, study
isolation/analysis, deployment configuration and primary UI navigation/qualification paths.
GitHub/payment/marketing/portfolio paths received targeted inspection and existing contract
tests, rather than a complete endpoint-by-endpoint manual review. Version-pinned dependencies
were inspected; Node and relevant Vite advisories were checked against official sources.
Vite 8.3.4 exceeds the 8.3.3 patch for the reviewed October 6 advisories; this is not a complete
transitive npm or Rust vulnerability scan.

Verdict: substantial safeguards and useful implemented workflows, with a reproducible
disconnect race, an outdated security baseline, misleading startup text and verification/docs
debt to repair before treating this candidate as release-ready.

Not checked: a fresh browser walkthrough, live model/provider behavior, personal account access, the installed application,
real WSL sandbox escape resistance, native installer/update execution, hosted deployment,
live GitHub mutations, payments or outbound campaigns, empirical study outcomes, comprehensive
penetration testing and load benchmarking. No live calls, release or milestone activation occurred.

Next eligible prompt: **U03 — Repair a failed gate**, bounded to this audit's prioritized
findings; then **U02 — Independent milestone review** of the changed candidate. Product C54
and full-product acceptance remain partial; this audit does not complete them.
