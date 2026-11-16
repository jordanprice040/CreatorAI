# Current implementation and verification — November 15, 2026

Creator Agent is an implemented local web/Windows evidence and product studio. This page
describes main `f5728aa` (PR #211, November 15); it does not describe a freshly installed
release. Database schema: **68**. Runtime baseline: Node **22.23.4+ within 22.x**, or
**24.22.2+ within 24.x**; pnpm **11.25.0**. The installed app on Jordan's PC was upgraded on
November 15 to `fdc7ce0` (schema 68: main with the PR #212 Windows build fix).

Package-by-package state, the latest checks and the open items are in
[build status](../tracking/BUILD_STATUS.md); each change has its decision in
[decisions](../tracking/DECISIONS.md). The [capability matrix](CAPABILITY_MATRIX_2026-11-05.md)
lists what kinds of product can be built. The previous version of this page (main `e08e0a4`,
November 6) is in the repository history.

## What the studio does now

- **Pages.** Chat, Projects (Path, Discover, Decide, Proposals, Scores and specs, Build, Try,
  Launch), Autopilot, Sources, Monitor, Models and connections, and Settings. Standard view
  folds routine settings and shows amounts in cents; Advanced view lists every tab and shows
  exact amounts and ids (ADR-0103, ADR-0104). The theme is dark by default.
- **Evidence.** Approved-site fetching with private-address and redirect checks, immutable
  passages and claims a person accepts. **Search the web** (ADR-0086) finds new pages through
  a qualified plan connection's own web search; the studio fetches them itself and turns only
  quotes it can find on the page into draft claims.
- **Discovery.** Theme drafts, explicit evidence packets, Explore for me from recorded claims,
  discovery progress on Discover and Decide, and the discovery roles qualified in the app on
  server-chosen benchmarks (ADR-0089).
- **Decide.** Alternatives compared on the same evidence, assessments that read each option's
  own claims (ADR-0091), the owner's gate checklist (ADR-0097), approvals in place (ADR-0102),
  and selections with an override reason. A non-code choice goes to a proposal (ADR-0101).
- **Autopilot and automation.** One bounded run from evidence to a proposal that stops where a
  person must decide (ADR-0092), its own page (ADR-0111), automation levels (ADR-0099) and
  opt-in autopilot settings for planned fallbacks (ADR-0100).
- **Building.** Frozen specs, specs drafted by a qualified model and checked by a person
  (ADR-0107), isolated builds for the Python CLI and `static-web/1` recipes, room for bigger
  programs (builder/2, ADR-0109), independent review and QA, packages and Try. Building is
  qualified per connection in the app (ADR-0105); larger Python builds are labelled
  unqualified trials until their roles pass the larger benchmark (ADR-0112).
- **Connections.** ChatGPT plan and Claude Code connections with daily caps, extra requests
  when a cap runs out (ADR-0094), a workspace's own OpenAI API key in the desktop app
  (ADR-0093), copying a connection's settings to another workspace (ADR-0095), and Chat
  answers and card fill-ins from a plan (ADR-0096).
- **Files.** Workspace files with inert viewers for PDF, Word, Excel, PowerPoint, ZIP and
  code (ADR-0106).
- **Money.** Exact-money reservations before every paid call, the $20 overall runtime ceiling,
  per-run and per-model limits, and reconciliation of unknown outcomes.

## Capability and evidence matrix

| Area                           | Implemented in source                                                                                                | Verification and remaining boundary                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local studio                   | React UI, API/CLI, PostgreSQL records, Windows desktop/service, protected sign-in, Standard and Advanced views       | Contract checks and fixture browser walks; the installed app runs on Jordan's PC; fresh native installation acceptance is separate                         |
| Connections and chat           | ChatGPT plan, Claude Code, OpenAI API key, daily caps and extra requests, Chat answers                               | Dated live qualifications apply only to their recorded connection, model and role prompt                                                                   |
| Budgets and permissions        | Exact-money reservations, runtime/run/model ceilings, scoped grants, routine approvals, pause/cancel, reconciliation | Database and concurrency checks; owner limits stay authoritative                                                                                           |
| Discovery and evidence         | Theme drafts, Explore for me, Search the web with checked quotes, automatic assessments, gate checklist              | Live discovery and web search ran on the dev studio at $0 on the plan connection; reused qualification is not an independent exploration benchmark         |
| Autopilot                      | Durable bounded runs, automation levels, opt-in fallbacks, its own page                                              | Fixture walks and three live reruns on the dev studio, each with Jordan's typed OK                                                                         |
| Build and delivery             | Frozen and model-drafted specs, isolated Python CLI and static web builds, builder/2, review, QA, packages, Try      | GPT-6 Astra qualified as builder on the installed app; the Claude route is qualified for small builds only; larger builds carry a trial label until a pass |
| Search and operations          | Catalog, lineage, semantic and audit search, backups, health and recovery                                            | Implementation and contract evidence; health is configuration, not live verification                                                                       |
| GitHub                         | Scoped private-repository/branch/PR/check adapters and UI                                                            | No live repository verification or change; the GitHub App (P32) comes after the UX pass                                                                    |
| Hosted, commerce and marketing | Deployment/OIDC, test-mode payment/entitlement/funding and campaign adapters with fixture paths                      | Not activated; live payments and hosting are separate owner decisions after the app work                                                                   |
| Studies and thesis             | Frozen-condition machinery, exports and reproducible analysis                                                        | Final participants, independent ratings, empirical conclusions and committee acceptance remain incomplete                                                  |

## Start and verify

Follow [local development](LOCAL_DEVELOPMENT.md), then use [the product guide](CODE_AUDIT_AND_PRODUCT_GUIDE.md).
`pnpm check` runs compilation, the regular tests, current development safety checks and formatting.
`pnpm test:db` requires an explicitly configured disposable test server; visible skips do not
establish database or real-isolation acceptance. In the cloud container five PowerShell-wrapper
tests fail because PowerShell is not installed there. Frozen helper replay is a separate
`pnpm test:historical-upgrade` gate requiring its original candidate/package.

Next (November 16): after this UX pass, the open PRs for the studio spending manager (S0) and the
larger benchmark freeze (the Claude groundwork, ADR-0115, merged as #216), then the notifications inbox, toasts and Windows
notifications (N1–N3), then the GitHub App (P32). See [build status](../tracking/BUILD_STATUS.md).
Do not automatically begin additions, a pilot, installation or release.

## Historical status

The pre-repair page is preserved byte-for-byte in
[the pre-repair status history](CURRENT_STATUS_HISTORY_2026-11-04.md). The November 4
[audit](CODEBASE_AUDIT_2026-11-04.md), [repair report](CODEBASE_REPAIRS_2026-11-04.md) and
[follow-up report](CODEBASE_AUTH_FOLLOWUP_2026-11-04.md) keep their original findings. Dates, package identities, failures
and original acceptance limits there remain historical evidence.
