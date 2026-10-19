# Code audit and product guide

October 18, 2026. Reviewed candidate: `015fe0586f0225c46de43239283968670579b5f2`.

What this repo does: Creator Agent is a local evidence and product studio. It records research, compares responses, applies human oversight and budgets, and can build and package a narrowly supported prototype in an isolated worker. This audit assumes one local owner with concurrent background tasks, not a public multi-user service.

## U03 follow-up: findings 3–5

Findings 3–5 were repaired on October 18, 2026. The README, local setup guide and
integration summary now present current implementation and limitations; earlier
versions remain in labelled history files. Maintenance jobs expose safe bounded
error codes and last success/failure through health, with deduplicated console
errors and recovery status. Actor lookup ignores old-workspace successes and
failures after effect cleanup. The original findings below remain as historical
diagnoses; all five now have repairs. Latest checks and remaining verification
limits are in tracking/BUILD_STATUS.md. Broader product/research gaps remain.

## U03 repair update

Findings 1–2 were repaired on October 18, 2026. The source adapter now stops
waiting for DNS on abort, removes its abort listener, and refuses to connect after
cancellation. The operating system lookup itself may still finish later. Failed
logout retains the signed-in UI and displays an accessible retry message; local
session state clears only after the server confirms success. Regression checks
cover stalled/late DNS and network/server logout failures followed by a successful
retry. The original audit below is retained as the diagnosis; findings 3–5 remained open at that point. See the latest tracking entry for complete verification results.

## Findings

### Must fix

1. **Source-fetch deadlines do not cover DNS resolution** (`packages/research/src/adapters.ts:82`; `packages/research/src/broker.ts:112–149`).
   - **What this is:** The source broker sets a deadline before fetching an approved page.
   - **Problem:** The adapter awaits DNS without observing the abort signal. An injected resolver that never settles remained pending after 200 ms despite a 20 ms abort; reproduced against compiled code without network access. The broker awaits that same promise.
   - **Fix:** Make the resolver wait abortable, remove its abort listener on settlement, and refuse an already-aborted request before resolving/connecting. Add a stalled-resolution test using the existing resolver seam.
   - **If we skip it:** A slow or stuck resolver can keep an HTTP request and retrieval pending beyond the advertised bound. A database stale sweep does not cancel that pending operation.

2. **Failed logout looks successful** (`apps/web/src/oversight.tsx:99–105`).
   - **What this is:** The browser asks the API to revoke its session and clear its cookie.
   - **Problem:** Every logout error is discarded, then the UI clears its session. If the API is unavailable before receiving the request, the valid cookie and server session survive; reloading after recovery can sign the owner back in.
   - **Fix:** Clear local session state only after confirmed logout; otherwise show the error and a retry. Verify the failure path with a rejected request and then a successful retry.
   - **If we skip it:** The owner can believe access ended when the session remains active.

### Should fix

3. **The entry-point documentation describes an obsolete product** (`README.md:3`; `docs/LOCAL_DEVELOPMENT.md`; `tracking/INTEGRATIONS.md`).
   - **What this is:** These files tell a new owner what exists and how to start it.
   - **Problem:** The README says persistence and research are absent. The development guide interleaves conflicting historical setup claims, including untested Windows PostgreSQL beneath newer Windows results. Integration notes also retain obsolete unimplemented claims.
   - **Fix:** Put one current setup/capability summary first, link historical notes separately, and reconcile it with the current build record. This guide supplies the requested current rundown without rewriting historical evidence.
   - **If we skip it:** Users miss working features and cannot reliably distinguish current limitations from old ones.

4. **Background maintenance failures disappear** (`apps/api/src/index.ts:259–268`).
   - **What this is:** A timer delivers catalog events and reconciles stale model calls and retrievals.
   - **Problem:** Repeated database failures in these jobs are swallowed with no job-specific signal. Search projections or stale reservations can fall behind without an explanation from this loop.
   - **Fix:** Record a bounded error and last-success time per maintenance job, and expose degraded status. Preserve retries and idempotence.
   - **If we skip it:** Troubleshooting stale search or held exposure depends on manual database inspection.

5. **Actor labels can come from the previously selected workspace** (`apps/web/src/ui.tsx:99–107`).
   - **What this is:** The UI loads names for actor IDs in the current workspace.
   - **Problem:** Switch from workspace A to B while A's request is pending. If A resolves last, it overwrites B's actor list because this effect has no cleanup guard. This is a display race, not evidence of an API permission bypass.
   - **Fix:** Ignore settled results after effect cleanup, as the adjacent `useLoad` already does, or abort the old request. Verify reversed response order.
   - **If we skip it:** Attribution can show stale names or abbreviated IDs until another reload.

Verdict: Useful local engineering prototype with substantial safeguards. Fix the timeout and logout paths first, then consolidate setup and improve maintenance visibility. This is a selective audit, not certification that every boundary is safe. No application code was changed.

## What is built and functional

| Area                     | Available behavior                                                                                                                          | Boundary                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Local application        | TypeScript API/CLI, React web interface, loopback services and health                                                                       | No hosted service or desktop installer                                                           |
| Persistent catalog       | PostgreSQL records, immutable versions, typed relationships, audit history, migrations                                                      | Database configuration required                                                                  |
| Oversight                | Owner login, CSRF checks, scoped grants, exact decisions, cancellation, supervised/autonomous/human-only modes                              | Real identity-provider deployment unverified; logout issue above                                 |
| Budgets and model broker | Exact-money envelopes, child allocations, exposure reservations, usage settlement, idempotent operations and unknown-outcome reconciliation | Provider adapter exists; live inference/access and end-to-end paid operation unverified          |
| Durable tasks            | Database-backed workflow leases, bounded child tasks, retries/repairs, pause/cancel and recovery                                            | Not a general autonomous studio; consult recorded failure/recovery evidence                      |
| Evidence                 | Policy-controlled source fetch adapter, redirect/address checks, extraction, retained source/passages, claims/support and redaction         | Deliberate live-source configuration required; submitting a theme does not itself search the web |
| Discovery                | Versioned briefs, bounded specialist workflow, differing response types, skeptic/evidence checks                                            | Fixture results demonstrate plumbing, not real market validation                                 |
| Decisions and plans      | Anchored scoring, comparisons, selections, frozen specifications and task plans                                                             | Owner review and evidence quality still matter                                                   |
| Web workspace            | Monitor, theme submission, catalog, comparison, evidence, decisions, runs, budgets, scores/specs, search, activity, studies and gallery     | Some preparation/build operations remain CLI workflows                                           |
| Search                   | Lexical catalog retrieval, filters, snippets, lineage and activity with access checks                                                       | Comprehensive semantic/audit search remains an extension                                         |
| Generated products       | Separate Git repositories, scoped patches, bounded builder/reviewer and real WSL2 QA                                                        | Reviewed Python standard-library CLI recipe; no arbitrary web/persistent app synthesis           |
| Artifacts                | Exact-candidate source archives, hash verification, private worker preview, feedback and revised-version comparison                         | No public release or native installer; worker required for execution                             |
| Studies                  | Three-condition records, human-only separation, frozen manifests, interventions, protected grader material and exports                      | Synthetic rehearsal is implemented; final participant study is incomplete                        |
| Evaluation/analysis      | Schedule/retry accounting, blinded reviewer packets, reproducible tables/figures and missing-data handling                                  | No independent final ratings or empirical comparative findings                                   |
| Reproducibility          | Backup/restore tooling, thesis draft/demo documents, archive tooling and recorded checks                                                    | Engineering packaging does not imply committee acceptance                                        |

T00–T13 have implementation and milestone evidence in tracking. T14 has pilot/protocol preparation; unresolved research decisions prevent adoption. T15 and T16 have implemented machinery but incomplete empirical acceptance. T17 records boundary/recovery and requirements checks. T18 and T19 deliver a review packet/archive under explicit missing-data limits. None of these labels establishes full-product completion.

## How to use it

### Start the local application

Use the pinned pnpm 11.25.0 and the Node versions accepted in `package.json` (22.21+ within Node 22, or 24.19+ within Node 24).

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `http://127.0.0.1:5173`. With no database configured, this is a stateless fixture demonstration: choose a simulated response, run it, inspect the result. It does not save records or invoke a model.

For the saved product, configure a loopback PostgreSQL database first. Follow `docs/DOCKER.md` for the existing optional Docker setup, or use a local PostgreSQL installation. Set `CREATOR_DATABASE_URL` in the terminal that starts the API, then:

```powershell
pnpm db:migrate
pnpm dev
```

Use the one-run login link printed in the API terminal. For CLI access, build first and use `pnpm cli login <code>`. Keep local credentials/session files private. The frontend is on port 5173, API on 4310 and private previews on 4320 by default.

### Explore and run a bounded discovery

1. For a repeatable first tour, run `pnpm cli seed-lineage`, `pnpm cli seed-discovery`, or `pnpm cli seed-selection` while signed in. These create labelled synthetic demonstrations; they are not real discoveries. Run `pnpm cli workspaces` to find their workspace IDs.
2. Select that workspace in the web application. Inspect Monitor and Catalog, then Evidence to see source/claim relationships. Search and Activity expose provenance and recorded actions.
3. In Submit a theme, specify users, measurable problem, constraints and evidence already recorded in the workspace. A registered run, compatible pricing, funded envelope and sufficient scoped authority are required. The submission screen is not an automatic internet search engine.
4. Watch Runs. Resolve covered human questions in Decisions; inspect Budgets for charges, held exposure and refusal reasons. Autonomous work stops when it needs uncovered human authority. Fixture charges are simulated.
5. Use Compare and decide and Scores and specs to review alternatives, record the selection and freeze a bounded plan. Existing-tool, process, human-led, hybrid and defer outcomes are valid results.

For manual record creation, source ingestion, run/grant/budget setup and detailed CLI arguments, use `docs/LOCAL_DEVELOPMENT.md` and `pnpm cli help`. Historical examples contain IDs/expiry dates that must be replaced with actual current values.

### Build, download and revise the supported prototype

Follow `docs/ISOLATED_EXECUTION.md`, then `docs/BOUNDED_BUILDER.md`. A current frozen spec, reviewed worker, product/task repository, explicit acceptance cases, run authority and funded model envelope are prerequisites. The template fixture can exercise the checklist example without live inference. Do not expect arbitrary applications from it.

After a verified task candidate, use `pnpm cli artifact-package <product> <build>`. Gallery lets you inspect integrity, download source, start a private preview and submit feedback. Accepted feedback creates a revised spec and another build/package; it does not overwrite the original. Full command sequence: `docs/ARTIFACTS_AND_PREVIEW.md`.

### Rehearse research tooling

Studies provides synthetic study records. `pnpm evaluate rehearsal <new-output-folder>` exercises evaluation plumbing against a configured database; `pnpm analyze fixtures <output-folder>` exercises analysis using labelled synthetic inputs. See `docs/FINAL_EVALUATION.md` and `docs/ANALYSIS.md` before using real exported data. Keep private assignment keys/raw exports separate from reviewer packets. Synthetic output must never be presented as findings.

## Remaining work

All five findings have now been repaired with focused regression checks and updated documentation. Re-run the full disposable PostgreSQL plus WSL isolation suite on the final changed candidate; ordinary checks with skips are insufficient for those gates. The historical T19 full suite had one recovery timeout failure followed by a passing focused lease-aware repair, not a later full green run.

For the thesis: settle remaining participant/reviewer/task and human-subject decisions, confirm academic dates, adopt/freeze protocol and analysis rules, verify the selected model's actual API access/pricing and bounded runtime configuration, run the final study, obtain independent ratings, analyze real outcomes and revise the thesis for committee acceptance. The recorded model preference and $20 total T15 cap do not prove live configuration or spending activation. RQ1–RQ3 remain unanswered.

For the broader product: X01 qualified model routing; X02 deeper context/caching/batch optimization; X03 comprehensive semantic and audit search; X04 scoped remote GitHub; X05 Tauri desktop and paired workers; X06 hosted operation; X07 payments/entitlements/reinvestment; X08 authorized marketing; X09 portfolio scheduling/maintenance/reusable knowledge; X10 full-product acceptance and owner pilot. These remain deferred, not automatically authorized next steps.

Next eligible prompt: U03 for the concrete audit defects; alternatively an owner-selected remaining T14 research prerequisite. No next milestone was started.

## Verification and scope

Read the current project context, U02 review instructions, build/handoff records, setup/integration docs, package scripts, API/auth paths, research adapter/broker, representative filesystem/worker/catalog code, UI data/session paths and test definitions. Reviewed existing evidence without treating historical tests as newly executed.

Executed a no-network stalled-DNS reproduction and the compiled HTTP API tests outside sandbox restrictions (3 pass). Typecheck passed in the initial check invocation. Its test phase reported 87 pass, 7 fail, 93 skipped; loopback HTTP and hardlink operations encountered sandbox restrictions. The three API tests passed when rerun with those restrictions lifted. The unrestricted rerun of pnpm check passed: 94 pass, 0 fail, 93 skips, with typecheck and formatting passing. Log: .verification/audit-check.log (local, ignored). This rerun preceded final report formatting; the report was separately formatted afterward.

Not checked: exhaustive line-by-line review, new browser interaction/accessibility testing, real identity provider, live paid model/source requests, configured database integration suite, fresh WSL execution, dependency advisory scan or load benchmark. No credentials or external services were activated. Claims about these features above describe code and recorded milestone evidence, not new live certification.
