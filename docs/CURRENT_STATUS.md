# Current implementation and verification — November 22, 2026

Creator Agent is an implemented local web/Windows evidence and product studio. This page
describes main `7f75907` (PR #257, November 22), which includes every merged PR through #257.
Database schema: **80** (migrations 42, 71, 75, 76 and 77 are unused; 76 stays reserved for
later F11 slices; the next free migration is 81 and the next ADR is 0136). Runtime baseline:
Node **22.23.4+ within 22.x**, or **24.22.2+ within 24.x**; pnpm **11.25.0**.

**Release 0.1.9** is the first real release. Its installer includes PostgreSQL 18 (ADR-0135),
so a tester installs nothing else; it passed a clean-machine check in Windows Sandbox and is
published as `v0.1.9` on the private releases repository (which the in-app updater reads) and
on this repository's releases page. It is unsigned: by owner decision (November 22) it goes,
with its SHA-256 hash, only to close friends, and a code-signing certificate comes before
anyone wider. Tester steps are in the [tester guide](TESTER_GUIDE.md).

On Jordan's PC: the installed app is still the **trial build 0.1.8** (schema 79) from the F4
live trial and can now update itself to 0.1.9. The dev studio runs from main `ae6c42e1` at
schema 79 and needs migration 80 before it runs current main.

Package-by-package state, the latest checks and the open items are in
[build status](../tracking/BUILD_STATUS.md); each change has its decision in
[decisions](../tracking/DECISIONS.md). The [capability matrix](CAPABILITY_MATRIX_2026-11-05.md)
lists what kinds of product can be built. Earlier versions of this page (main `561cb09`,
November 19, `8a92da1`, November 16, and `e08e0a4`, November 6) are in the repository history.

## What the studio does now

- **Pages.** Chat, Projects (Path, Discover, Decide, Proposals, Scores and specs, Build, Try,
  Launch), Autopilot, Sources, Monitor, Models and connections, and Settings. Standard view
  folds routine settings, keeps explanations to one line with the full text a click away,
  folds long summaries and sections closed, and shows amounts in cents; it hides only Launch,
  Runs, Workers and Study (Library is listed). Advanced view lists every tab and shows exact
  amounts and ids (ADR-0103, ADR-0104, November 22 owner decision). The theme is dark by
  default.
- **Evidence.** Approved-site fetching with private-address and redirect checks, immutable
  passages and claims a person accepts. **Search the web** (ADR-0086) finds new pages through
  a qualified plan connection's own web search; the studio fetches them itself and turns only
  quotes it can find on the page into draft claims. An uploaded text document (text, Markdown,
  CSV, JSON or code) becomes a source with **Use as evidence**, and its passages are cited and
  checked the same way (ADR-0134). Claim tags such as "C1" in run results, Explore and Decide
  link to the claim and preview it.
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
  code (ADR-0106); files can be dropped anywhere on the page, in the browser and in the
  installed app.
- **Money.** Exact-money reservations before every paid call, the $20 overall runtime ceiling,
  per-run and per-model limits, and reconciliation of unknown outcomes. One studio spending
  manager owns the studio-wide ceiling, limits and spend views; owning a workspace grants
  none of it (ADR-0113).
- **Everyday tools (feature ideas F1–F13).** Backups and restore in Settings (ADR-0123), a
  usage check before an autopilot and continuing after a usage limit (ADR-0124), a project
  report export (ADR-0117), a support report (ADR-0118), the command palette (ADR-0119),
  comparing two runs (ADR-0120), Monitor › Storage with a confirmed cleanup (ADR-0121), the
  study effort timer (ADR-0122, ADR-0129), starting a similar project (ADR-0125), source
  freshness on Decide (ADR-0126) and term help in the Standard view.
- **Notifications.** An inbox (N1, ADR-0116), the bell, toasts and quiet hours (N2, ADR-0130),
  and Windows notifications from the installed app (N3, ADR-0131).
- **GitHub App (P32, ADR-0132).** Create and install a private GitHub App from Models and
  connections; its key stays in the protected vault on this computer, never in the database.
- **In-app updates (F4, ADR-0128).** The installed app's status window checks a private
  release repository, keeps an installer only when its size and SHA-256 match, takes a
  verified backup, rehearses any database upgrade on a throwaway copy, and rolls back to the
  earlier version (restoring the backup when needed) if the new one does not start. The
  installer's "Already Installed" page defaults to "Do not uninstall".
- **Local models, first slice (F11, ADR-0127).** An Ollama adapter for a loopback-only model,
  pinned by name and digest. Design only: no local route is wired in yet.

## Capability and evidence matrix

| Area                           | Implemented in source                                                                                                                                                               | Verification and remaining boundary                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local studio                   | React UI, API/CLI, PostgreSQL records, Windows desktop/service, protected sign-in, Standard and Advanced views, notifications, tester installer with PostgreSQL included (ADR-0135) | Contract checks and fixture browser walks; the installed app runs on Jordan's PC; the 0.1.9 installer passed a clean-machine install in Windows Sandbox (November 22); N3 Windows notifications not yet seen on Windows (check 13) and `cargo test` not yet run on Windows; a real file drag into the installed app not yet tried                                                |
| Connections and chat           | ChatGPT plan, Claude Code, OpenAI API key, daily caps and extra requests, Chat answers                                                                                              | Dated live qualifications apply only to their recorded connection, model and role prompt                                                                                                                                                                                                                                                                                         |
| Budgets and permissions        | Exact-money reservations, runtime/run/model ceilings, one studio spending manager, scoped grants, routine approvals, pause/cancel, reconciliation                                   | Database and concurrency checks; owner limits stay authoritative                                                                                                                                                                                                                                                                                                                 |
| Discovery and evidence         | Theme drafts, Explore for me, Search the web with checked quotes, uploaded documents as evidence (ADR-0134), claim tag links, automatic assessments, gate checklist                 | Live discovery and web search ran on the dev studio at $0 on the plan connection; reused qualification is not an independent exploration benchmark. Uploads as evidence checked on a throwaway database only (schema 80 is not yet on the dev studio or installed app)                                                                                                           |
| Autopilot                      | Durable bounded runs, automation levels, opt-in fallbacks, its own page                                                                                                             | Fixture walks and six live autopilots on the dev studio (three first runs and three reruns, November 14–15), each with Jordan's typed OK                                                                                                                                                                                                                                         |
| Build and delivery             | Frozen and model-drafted specs, isolated Python CLI and static web builds, builder/2, review, QA, packages, Try                                                                     | GPT-6 Astra qualified as builder on the installed app; the Claude route is qualified for small builds only; larger builds carry a trial label until a pass. GPT-6 Astra passed the larger `p14-xl-v1` benchmark 3/3 on November 17 ($0); its evidence is committed (`tracking/evidence/p14-xl-v1-live-qualify-2026-11-17/`), and by owner decision the pass lifts no trial label |
| Search and operations          | Catalog, lineage, semantic and audit search, backups, health and recovery                                                                                                           | Implementation and contract evidence; health is configuration, not live verification                                                                                                                                                                                                                                                                                             |
| Installed-app updates          | Private-release check, hash-checked download, backup, upgrade rehearsal, rollback, "Do not uninstall" installer default (F4, ADR-0128)                                              | Live trial on Jordan's PC passed on rerun 2 (November 19): a broken 0.1.7 rolled back on the first attempt, and a forced Windows restart during the 0.1.8 update ended `update_confirmed`. The first real release, 0.1.9, is published (November 22); the in-app update from 0.1.8 to 0.1.9 has not been run yet                                                                 |
| Local models                   | Ollama adapter, loopback only, pinned by name and digest (F11 slice 1, ADR-0127); defaults confirmed November 17                                                                    | Fake-server tests only; no hardware check, model download or local route yet                                                                                                                                                                                                                                                                                                     |
| GitHub                         | Scoped private-repository/branch/PR/check adapters and UI; GitHub App created and installed from the studio (P32, ADR-0132)                                                         | Live trial November 17 (dev studio worktree, throwaway database, $0): app created and installed, connection verified, branch and issue passed. Push, pull request and checks untested; repository creation got a 403 whose cause is unproven. The installed app does not turn live GitHub on                                                                                     |
| Hosted, commerce and marketing | Deployment/OIDC, test-mode payment/entitlement/funding and campaign adapters with fixture paths                                                                                     | Not activated; live payments and hosting are separate owner decisions after the app work                                                                                                                                                                                                                                                                                         |
| Studies and thesis             | Frozen-condition machinery, exports and reproducible analysis                                                                                                                       | Thesis draft 2 (November 19) reports executed engineering evidence; the three-arm study is future work; the AI-only run has no results yet; committee acceptance remains open                                                                                                                                                                                                    |

## Start and verify

Follow [local development](LOCAL_DEVELOPMENT.md), then use [the product guide](CODE_AUDIT_AND_PRODUCT_GUIDE.md).
`pnpm check` runs compilation, the regular tests, current development safety checks and formatting.
`pnpm test:db` requires an explicitly configured disposable test server; visible skips do not
establish database or real-isolation acceptance. In the cloud container five PowerShell-wrapper
tests fail because PowerShell is not installed there. Frozen helper replay is a separate
`pnpm test:historical-upgrade` gate requiring its original candidate/package.

Next (November 22): the thesis AI-only run (ADR-0133), which needs Jordan's typed OK by
November 27; then the loose ends that need Jordan's PC or his typed OK (the in-app update to
0.1.9 and a real file drag; the P32 live rerun for repository creation, push, pull request and
checks; N3 check 13 and `cargo test` on Windows; F11 slice 2, a read-only hardware and Ollama
check). Owner rules for every installer or update change: the installer defaults to "Do
not uninstall", and an update never restarts the PC by itself (if one ever needs a restart, the
app asks first and offers a later option). The thesis defense is **December 2, 2026** and
submission **December 7, 2026** (Jordan, November 19); see the
[roadmap](../context/ROADMAP.md). See [build status](../tracking/BUILD_STATUS.md). Do not
automatically begin additions, a pilot, installation or release.

## Historical status

The pre-repair page is preserved byte-for-byte in
[the pre-repair status history](CURRENT_STATUS_HISTORY_2026-11-04.md). The November 4
[audit](CODEBASE_AUDIT_2026-11-04.md), [repair report](CODEBASE_REPAIRS_2026-11-04.md) and
[follow-up report](CODEBASE_AUTH_FOLLOWUP_2026-11-04.md) keep their original findings. Dates, package identities, failures
and original acceptance limits there remain historical evidence.
