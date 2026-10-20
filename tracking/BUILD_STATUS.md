# Implementation status

## Audit 2026-10-20 (full product, T00–X10) fixes (October 20, 2026)

Branch claude/audit-full-qgjinb from main 051a9bb; no migration, no ADR. Report: project
file audits/2026-10-20-codebase-audit.md. Two contained fixes. X09 portfolio capacity:
each run counted every other unfinished workflow as active, so two runs over capacity
waited on each other and nothing leased; now only older unfinished workflows count, so the
oldest work proceeds and newer work waits (docs/X09_PORTFOLIO.md). X03 audit questions:
"after DATE" now excludes that day, like "before DATE" (docs/SEARCH_AND_AUDIT.md).

Executed (cloud Linux, PostgreSQL 16): pnpm check on main: 280 tests, 267 pass, 0 fail,
13 WSL2/native skips. With the fixes: 281 tests, 268 pass, 0 fail, 13 skips; format clean (tracking/evidence/audit-2026-10-20/check.log).
The new capacity test fails on the previous code (0 leases). `pnpm readiness`: NOT READY,
register consistent, 36 rows open, unchanged. `pnpm audit --prod` clean.

Note on older entries below: X08 and X09 were merged to main through PR #34, and the local
audit fixes through PR #35. Their "uncommitted / not pushed" wording describes the moment
they were written. Open recommendations (owner judgment): see the report (hosted rate
limits, reinvestment vs portfolio root, processor read inside a transaction, silent
scheduler errors, plus the still-open 10-19 items R1–R6). No live call, no spend; the
protocol freeze and study decisions untouched.

## X10 — full-product acceptance and readiness (October 19, 2026)

Claude Code, branch `claude/x10-1y6bd6` from main `a68e9f9`; ADR-0038, no migration,
docs/X10_ACCEPTANCE.md. Also removed leftover merge-conflict marker lines from the three
tracking files on main (both sides kept).

Works: `pnpm readiness` checks `config/readiness.json` (C01–C51 plus 15 integrations, six
separately recorded states each) against REQUIREMENTS.md and evidence on disk; verdict is
**NOT READY** with 36 rows open (no live model/source call, study unfrozen, GitHub/hosted/
payments/OIDC/outreach not live, paid ads/alerts/signed updates not built, C42 offline cache
unverified). `pnpm readiness pilot-check` refuses the owner pilot: every owner choice in
`config/owner-pilot.json` is empty and no account is live-verified and activated. The pilot
was not run. `pnpm bench` seeded 10,000 ideas / 100,000 audit events through the real store
in a disposable database and timed the HTTP API (p95: text search 410 ms, lineage 13 ms, cost
21 ms, event display 13 ms; synthetic workload, one client, cloud container). The first run
found lineage/cost at ~650 ms p95; the lineage walk now uses indexed per-hop lookups.
`scripts/release-archive.mjs` builds/verifies/extracts a commit-bound tar.

Executed: see tracking/evidence/x10 (bench runs, readiness report, full-suite log, release
validation). Limits: register is hand-maintained; no concurrent load, browser or Windows
measurement; nothing live, deployed, spent or sent. Next eligible: owner decisions listed in
the readiness report (pilot choices, model verification, RD1–RD10); no automatic milestone.


## Local audit fixes published for review — 2026-10-19

Preserves the original checkout while publishing its DNS cancellation, sign-out, stale actor request, and maintenance-health fixes with regression tests. Documentation cleanup and historical local tracking patches are retained. This PR is stacked on X08/X09; X10 is not started. Validation: typecheck, production build, formatting, and 15 focused regression tests passed. PostgreSQL/live activation was not rerun for this audit branch.


## X09 — portfolio scheduling and reviewed knowledge (October 19, 2026)

Implemented on `codex/x09-portfolio`, layered on local X08 commit `64596ef`.
Managed checkout remains `C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`.
X08 was hash-checked before committing; nothing was pushed. Original X05 dirty
checkout and Claude's parallel UI/UX work preserved. X09 changes are uncommitted.

Works through owner API, compiled CLI and the new Portfolio screen: separate
maintenance/improvement/exploration lanes; real maintenance budget allocation
checks; normal/conserve/maintenance_only/paused modes; review/feedback backlog,
capacity, reserve and health gates in shared admission/workflow/broker paths;
deduplicated interval jobs that coalesce missed periods; source refresh, private
archive health and bounded review workflows; cancellation and receipt-based
reconciliation without resend. Owner health deferral retains failure evidence.

Versioned components/lessons/prompts/skills retain provenance, permitted use and
executed structural regression evidence. Human review binds the exact hash;
activation/rollback uses expected-head concurrency. Reviewed guidance actually
enriches bounded workflow/task constraints without changing authority. Revocation
or stale provenance blocks new queued dispatch. Study attempts, human-only paths
and held-out material remain separate. Migration 22; ADR-0036;
docs/X09_PORTFOLIO.md.

Executed on Windows, Node 22.21.0 and dedicated disposable PostgreSQL 18.6:

- Focused X09 acceptance: **7 pass, 0 fail, 0 skip**, including actual HTTP/CSRF/
  compiled CLI, source broker, concurrent scheduling, low-fund/lane protection,
  backlog/health/modes, restart reconciliation, knowledge review/rollback/revoke.
  Initial fixture/schema/grant failures are retained and repaired, not bypassed.
- Final broader PostgreSQL suite: **270 tests, 256 pass, 0 fail, 14 explicit
  skips** (`full-tests.log`). Native/WSL opt-in and inverse-backend cases remain
  skipped; actual PostgreSQL backup/restore ran with installed client tools.
- Final TypeScript/web typecheck, production build, repository format check and
  diff whitespace passed. Vite retains its nonfatal >500 kB bundle warning.
- Actual isolated Edge: source scheduling pass, knowledge regression/review/
  activation, pause/resume, schedule cancellation and knowledge revocation.
  Desktop/narrow screenshots and accessibility snapshots retained; viewport and
  document widths both 390px in the observed narrow layout, with no alerts.

Limits: optional background polling implemented but off/unactivated; no live
model/source call, paid dispatch, public release, account change or real customer
validation. Health is archive integrity, not runtime uptime. Reusable skills are
bounded task guidance, not executable plugins; regression evidence is structural,
not measured quality gains. Budget identity rotation needs a new workspace in
this version. No existing studio database migrated. Next eligible prompt:
**X10 — Full-product acceptance and bounded owner pilot**, on request; inherited
hosted/live/operational gaps still apply and no pilot was started.

## X08 — campaign review and measured fixture feedback (October 19, 2026)

Implemented on `codex/x08-marketing` in the managed checkout
`C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`, from current merged
main `0dfc6e6`. Original X05 dirty checkout preserved. Claude owns the parallel
UI/UX redesign; X08 changes only its new screen plus small navigation wiring.

Works through authenticated API, compiled CLI and Campaigns screen: immutable
positioning/landing drafts, recorded demonstrations, pricing/channel hypotheses,
exact artifact/manifest/check evidence and audience provenance; hash-bound human
owner grants with zero adapter spend, caps and expiry; durable intent/native
fixture receipt, suppression/opt-out, deduplication, unknown-outcome reconciliation,
revocation/cancellation and distinct synthetic feedback counts. Changed content,
audience or experiment requires a fresh draft/grant. Stale evidence refuses sends.
Migration 21; ADR-0035; docs/X08_MARKETING.md.

Executed on Windows, Node 22.21.0 and disposable PostgreSQL 18.6:

- Final focused X08 HTTP/CLI/domain/DB plus X07/storage checks: **23 pass, 0 fail,
  0 skip** (`final-focused.log`). Earlier focused run: 13/13.
- Broader suite: **248 pass, 0 fail, 15 explicit skips, 263 tests**
  (`full-tests.log`). Skips include native/WSL opt-in gates, one inverse-backend
  case and unconfigured pg_dump discovery. This run began before final UI hash
  wrapping, CLI help and fixture-helper repairs; final focused checks cover the
  final helper, while final build/browser checks cover the final new UI.
- TypeScript/web typecheck and production build passed; Vite retains the
  nonfatal >500 kB bundle warning. Formatting/whitespace checks recorded alongside
  final source hashes in tracking/evidence/x08.
- Actual isolated Edge: signed-in Campaigns, draft/grant, simulated unknown,
  reconcile without resend, feedback and suppression; final snapshot and desktop/
  narrow screenshots retained. Final 390px viewport/document widths both 390px
  with the content hash and delivery history visible. No native acceptance claim.

Initial fixture failures retained and fixed without weakening immutability or
acceptance gates. Fixture records explicitly declare no real execution or customer
validation. Test-delivery acceptance is met; external delivery, paid ads, hosted
landing pages, real customer/demand research and live commerce remain unavailable
or unverified. No real outreach, paid call, release, account activation, commit or
push. Existing studio databases were not migrated. Next eligible prompt: **X09 —
portfolio scheduling, maintenance, and reusable knowledge**, only on request.

## UX/UI redesign: dark-default studio shell (October 19, 2026)

Claude Code, branch `claude/ux-ui-handoff-mfarlr` from main `0dfc6e6` (PR #32 included), from the
owner's handoff. Scope: `apps/web` only (also the desktop view). ADR-0037, docs/UX_UI.md. No
migration, API, contract, dependency or lockfile change. X08 (Codex) status is not affected or
claimed by this entry.

What now works (checked in headless Chromium against a fixture workspace):

- Dark theme on first paint for a fresh install with a light OS theme (checked with the app script
  held back); saved light choice survives reload; toggle back to dark.
- Semantic colour tokens for both themes; every text/status token is at least 4.5:1 on every
  surface (computed in the browser).
- Grouped sidebar navigation, breadcrumb, view-named document title, connection status in words,
  fixture-mode banner; drawer navigation at phone width (Escape/backdrop/link close it).
- All 15 views restyled through shared classes; Desktop and Operations show worker and check
  states as labelled badges (an unreachable synthetic worker shows "unreachable: not reporting").
- Fixed: a view's late focus request after the user left it pulled them back (Runs → Budgets).
  Fixed: the skip link rewrote the route hash; it now focuses the content.

Evidence: tracking/evidence/ux-ui (verification.json with source hashes, browser-acceptance.json
22/22 steps, before/after/check screenshots). `pnpm typecheck`, `pnpm format:check` and `pnpm test`
on PostgreSQL 16: 257 tests, 244 pass, 0 fail, 13 skips. `pnpm build` passes.

Limits: browser only; native Tauri/WebView2, screen reader and Windows high contrast not observed.
No dialogs exist to check. Fixture data and the T13 test double only.


## X06/X07 independent audit and repairs (October 19, 2026)

Audited merged main `8d44ace` in the attached worktree on `codex/x06-x07-audit`.
Original X05 checkout and its pre-existing local edits preserved. See
docs/X06_X07_AUDIT.md for findings, reproduction, fixes and limits; ADR-0034.

Repaired processor/account and rail double counting (migration 20), stale concurrent
observations, partial loss histories, credential account drift, non-USD posting,
partial-capture access, inconsistent balance arithmetic, low-sale fee deficits and
fresh-rail outage handling. Repaired omitted child-budget metrics and malformed
signed JSON handling. Hosted preparation now excludes private/generated build
inputs, owns fresh product storage, uses PostgreSQL 18 clients and bounds service
CPU/memory/processes/logs. No existing studio database migrated.

Executed on Windows with disposable PostgreSQL 18.6:

- Final exact-source focused X06/X07 checks: 24 pass, 0 fail, 0 skip, including
  API/CLI, concurrency and actual dump/restore. `final-focused-tests.log`.
- Broader suite during audit: 256 tests, 242 pass, 0 fail, 14 explicit skips.
  `full-tests.log`; completed before the final fee-deficit repair, subsequently
  covered by the final focused checks. This is not a final full-suite rerun.
- Final TypeScript/web typecheck, production build, Prettier and whitespace passed.
  Vite retains its nonfatal >500 kB bundle warning. Hosted Compose config validated
  with example-only environment values, without building or starting containers.
- Evidence in tracking/evidence/x06-x07-audit, with source/config hashes. Initial
  disconnected database attempt failed; subsequent database lifecycle stayed within
  each test session. The final test database was stopped.

Status remains partial: Docker daemon unavailable, so no image/fresh-volume startup,
actual hosted TLS/OIDC/staging verification or external monitoring. X07 remains
fixture/contract only, USD only, no observed Stripe call or live commerce. Migration
20 refuses pre-existing duplicate identities for explicit reconciliation; no silent
financial-history rewrite. No paid call, release, activation, commit or push.
Next eligible prompt: X08 on owner request; no automatic milestone advance.

## X07 — payments, entitlements, revenue and reinvestment (October 19, 2026)

Branch claude/x07-5zm23m from main 4fe3d33 (X05 merged); migration 19 (main with X06's
migration 18 merged in); ADR-0033; docs/PAYMENTS.md. Partial: implemented and verified with a
labelled fixture processor and a Stripe contract double only. No processor account,
credential or call; live payments are not built and need a separate owner decision.

What works: processor connections (fixture or Stripe test mode, fixture workspaces only;
live keys refused) verified against the configured account; offers bound to one verified
artifact manifest by id and hash; checkout sessions that grant nothing; an inert return
page; signed webhooks (Stripe-Signature, 5-minute tolerance) that only name objects, with
the payment or payout then read from the processor (503 and nothing recorded if it cannot
be read); an immutable double-entry ledger keyed by economic transaction with balanced
corrections (deferred balance trigger); fees, refunds, disputes (open, won, lost),
settlements and payouts; entitlements derived from verified payment state; owner seed
funding as non-earnings; reinvestment policy, tranches per settled payment, funding rails
(processor balance or owner attestation, with expiry), commitments, allocations bounded
by eligible tranches, surplus, usable liquidity and the period cap under a per-workspace
lock, partial allocations, and loss handling that reclaims idle reinvested envelopes or
freezes new allocations. API routes, webhook endpoint and CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL passed:
typecheck, 243 tests, 230 pass, 0 fail, 13 skips (opt-in WSL2/native gates), format clean
(tracking/evidence/x07/check.log). Baseline on main before X07: 234 tests, 221 pass, 13
skips. New tests: payments-domain (5), payments (3 DB acceptance incl. Stripe contract
double), payments-api (1 API + CLI); storage test updated for migration 19. Acceptance on
fixtures: forged, stale, live-mode and unsigned deliveries refused; processor outage
defers; duplicate event ids and distinct events about one charge post nothing new;
refund-before-settlement order converges; redirect grants nothing; refund revokes, open
dispute suspends, won dispute restores with a correction entry; payout failure reversed;
seed, pending and payouts add no capacity; unavailable or stale rails give zero capacity;
10 racing allocations consume exactly the tranche (3 won); refund after reinvestment
reclaims idle envelopes and freezes while a busy one holds authority. Mutation check:
with economic-key correction disabled the duplicate/out-of-order test fails
(evidence/x07/mutation-economic-key.log).

Limits: no live mode; no Stripe call observed (API version not pinned); no web UI; USD
only; no taxes, subscriptions or customer accounts; fixture processor state is in API
memory. Next eligible: X08 on request (X06 merged into this branch).

## X06 — hosted operation and observability (October 19, 2026)

Implemented by Claude Code on branch claude/x06-j2pz5g from main 4fe3d33.
Migration 18, ADR-0032, docs/HOSTED_OPERATION.md. Status: implemented and checked
locally; **no hosted environment exists and nothing was deployed or activated.**

What now works (checked):

- Explicit hosted mode (test/staging/live) with refusals for unsafe configs: non-https
  or path origins, preview host sharing or nesting the studio host, no build commit,
  relative product root, missing metrics token, dev login, remote DB without
  sslmode=verify-full. `NAME_FILE` secrets. `pnpm ops config-check`.
- Environment-labelled databases: API and worker refuse another environment's database;
  audited relabel of restored copies; relabel into live refused.
- `/api/ready` (503 when not ready), `/api/ops/status`, Prometheus `/api/ops/metrics`
  (owner session or read-only scrape token), `/api/ops/uncertain`; queue, worker,
  local-worker availability, budget, index, webhook and uncertain-outcome metrics;
  local alert rules (delivery fixed to none); web Operations view; Desktop view shows
  unreachable workers.
- Owner-recorded verification bound to commit + config hash + schema (stale on change);
  passing live record needs typed confirmation, also enforced in the database.
  `pnpm ops smoke` read-only smoke check of a declared target.
- Backups dump inside an exported snapshot with lineage fingerprint and exact budget
  totals; restore requires exact match. Cleanup of expired sign-in material (dry run
  default, audited). Hosted-to-local worker pairing (explicit, https only).
- deploy/hosted (Dockerfile, Compose, Caddy, env examples): `docker compose config` and
  `pnpm ops config-check` pass; images never built (no Docker daemon in the cloud).

Evidence: full PostgreSQL suite in the cloud container, 242 tests, 229 pass, 0 fail,
13 WSL2 opt-in skips (storage schema test re-run separately after bumping to 18). New
tests/src/operations.test.ts: 8 tests (hosted staging rehearsal through a stand-in proxy,
live confirmation, environment separation, cleanup, worker availability). restore.test
extended (totals, forged totals refused). Browser check of the Operations view against
a local API showed a synthetic unreachable worker and its info alert.

Limitations: no real hosted target, TLS, managed DB, OIDC provider, scraper or alert
channel; staging smoke only against loopback hosted processes; hosted desktop (Tauri)
sign-in not covered; product files still copied after the dump. Next eligible prompt:
X07 (in progress in its own thread) or X08; a real staging deployment is an owner decision.

## X05 local Windows acceptance passed (October 19, 2026)

Final release native menus and rendered shared UI passed local acceptance.
Sign-in invoked the OS browser handler; approval used the disposable fixture HTTP
owner seam, not personal login or live OIDC. Native Gallery download rehashed the
source. The original editor action failed visibly (owner confirmed); repaired
behavior exports a rehashed copy to Downloads and activates packaged Notepad.
The actual screenshot showed the selected artifact/workspace. Notepad UIA text
was stale from an older tab and was not used as passing evidence.

Native job 5c1b397f-fc07-4f95-8463-d7a9275089c2 completed through the real
outbound CLI and offline WSL sandbox. Native UI and shared owner API agreed on
the exact artifact/manifest and succeeded/exit 0 report (worker_report_only).
Visible pause/resume/shutdown changed states; explicit shutdown exited CLI 0.
Earlier native window-close observation left the separate worker polling.
Rust final tests: 4 passed, 0 failed, 1 explicit editor-probe opt-in ignored;
actual final editor menu was observed separately. Final release/NSIS rebuilt.
Previous real native/WSL tests (2 pass), paired fault tests (3 pass), Windows
cache tests (3 pass) and installer fixture lifecycle evidence remain scoped to
their recorded candidates; no acceptance assertions were weakened. Earlier full
suite: 223 passed, 0 failed, 14 opt-in skips. Fixture hold harness is skipped,
not an automated acceptance pass. Final typechecks/format/whitespace recorded
with source and release hashes in tracking/evidence/x05.

See apps/desktop/INTERACTIVE_ACCEPTANCE.md and native-ui-acceptance.json.
Local Windows acceptance is complete; production signing, signed automatic
updates, live OIDC and other hosts remain unverified/disabled. No paid call,
public release, account activation, commit or push. Existing dirty work retained.
Next eligible prompt: X06 — hosted operation and observability; not started.
Earlier continuation entries below are historical evidence, superseded here.

## X05 acceptance attempt - native Computer Use stopped (October 19, 2026)

Supported @oai/sky Computer Use was available; earlier claims that no native path
was available were too broad. Actual release window rendered the shared UI and
native menu. Sign-in menu opened the local approval page through the OS browser
handler and displayed comparison code 538F1524. No user authentication dialog
was automated. Opera access initially timed out; owner approved access. Subsequent
capture required restoring its minimized window, then the helper stopped the
turn because it could not determine the current browser URL confidently enough
to enforce policy. No further UI input issued. Acceptance remains open; editor,
authenticated native navigation and visible job checks not completed this attempt.
Disposable fixture shutdown requested; test fixture mode is explicitly skipped,
not counted as an automated acceptance pass. No personal Notepad documents edited.

## X05 continuation - actual worker faults and local installer lifecycle (October 19, 2026)

Real paired lifecycle acceptance passed 3/3 with no skips (paired-lifecycle-final.log).
A dedicated synthetic artifact explicitly declares its long-lived test path and
passes real package QA. Tests observe the detached child in Linux /proc before
revocation or killing the actual outbound CLI. Revocation cancels parent/child,
records inactive cleanup and exits the revoked worker. Crash leaves no report;
actual lease expiry yields reconciling, blocks new work and never redispatches.
Owner API reconciliation binds the stopped local outcome hash. Synthetic review
is labelled fixture, not independent review or empirical validation.

Pinned Tauri CLI 2.12.3; added opt-in NSIS current-user bundle configuration with
no WebView installation, no automatic updater and downgrade refusal. Separate
acceptance identity/version installers verified native startup after baseline,
upgrade and explicit uninstall/reinstall rollback. Silent downgrade refused with
unchanged executable. Fixture uninstalled. See windows-installer-acceptance.json
and windows-installer-final.log; unsigned debug fixtures, not production signing.
Earlier failures retained: signal-killed test-child cleanup awaited a second close;
first installer upgrade returned 2; two subsequent runs passed after adding an
executable-write-access barrier. Final lock observations were zero, so its cause
is not confirmed.
No acceptance assertions weakened. Release-mode unsigned NSIS build passed
(windows-release-bundle.log); fixture install lifecycle used debug builds. Orphan disposable DB from interrupted first
run matched to retained fixture product before removal. Default bundling remains
off; production local bundle requires explicit configuration. No paid call,
public release, signing key, account integration, automatic update, commit or push.

Native functional gates now cover pairing/sign-in, source download, real paired
launch, window/worker separation, active-process revocation and crash reconciliation.
Local manual installer/update/rollback gates passed on this observed host.
Interactive native UI/editor/default-browser-handler checks (apps/desktop/INTERACTIVE_ACCEPTANCE.md) and live OIDC/signing
remain unverified. Other Windows hosts/architectures are unverified. Next eligible
work: finish X05 interactive acceptance; X06 not started. Earlier suite evidence
(223 pass, 0 fail, 14 opt-in skips) remains for the prior runtime candidate; this
continuation changes tests, packaging configuration/dependency and probe selection.
Final TypeScript project/web checks, Rust tests 3/3, formatting and whitespace
checks passed. Source hashes: lifecycle-candidate-sha256.json. Release executable
and installer hashes/signature status: windows-release-artifacts.json.

## X05 continuation - bounded paired jobs and native handoff (October 19, 2026)

Migration 17 adds owner/API/UI/native paths for exact artifact jobs on explicitly
execution-capable paired workers. Code enforces immutable idempotency, one-time
leases, pre-dispatch admission, artifact/profile binding, fixed offline sandbox
limits, bounded concurrency/rate and cancellation/fencing. Reports remain
`worker_report_only`, with full evidence retained locally. Unknown outcomes block
new workspace jobs until explicit observed-stop reconciliation. Existing presence
pairings gain no authority. No paid call, deployment, account activation, commit or
push. Existing audit edits preserved.

Native queue -> outbound CLI -> reviewed WSL2/bubblewrap/systemd execution passed
(2/2, no skips; native-paired-wsl-final.log): exact archive/output, inactive cleanup,
worker alive after window exit, then explicit shutdown exits worker. Underlying
real detached-child cancellation and killed-supervisor reconciliation passed 2/2
(real-worker-stop-reconcile.log). Native browser approval in isolated Edge
authenticated the Windows WebView using ordinary and Secure cookies, with separate
browser/desktop sessions (native-signin*.json). Fixture identity; no live OIDC or
personal browser-handler claim. Corrected debug instrumentation; prior failure
recorded in native-signin-probe-diagnosis.md. Windows cache checks passed 3/3 after
sandbox junction creation denial required an unchanged elevated rerun. Rust 3/3,
TypeScript project/web checks and production web build passed. Vite retains its
nonfatal bundle-size warning.

X05 remains partial: interactive native UI/editor/default-browser acceptance,
paired running revocation/crash reconciliation and installer/update/rollback
checks remain. Bundling and updater activation disabled. Next eligible prompt:
continue X05; X06 is not started. Integrated PostgreSQL suite: 237 tests, 223 passed, 0 failed, 14 explicit opt-in
skips (paired-integrated-tests.log). Real native/WSL gates ran separately as above.
Formatting and diff whitespace checks passed. Current source hashes are in
paired-candidate-sha256.json; earlier evidence is retained for its prior candidate.

## X05 — native build, sign-in and paired presence controls (October 19, 2026)

Owner installed Rust/Cargo and confirmed X03/X04 finished. Verified Rust/Cargo 1.99.1,
Windows MSVC toolchain, Visual Studio 18 C++ Build Tools and WebView2 155.0.4283.62.
Fast-forwarded this checkout to origin/main ddf7bcf (X01–X04); restored all local
audit/X05 edits from a retained stash, retaining both sides of tracking conflicts.
No new commit, push, paid call, hosted deployment or account activation.

Tauri shell now builds and starts natively; missing Windows icon fixed and Cargo
lockfile retained. Native menus implement proof-bound system-browser sign-in,
authenticated selected-artifact source download with exact manifest/archive hashes,
and opening only the last downloaded manifest in Notepad. Private preview tickets
open only on T13's separate origin in the system browser; no generated source is
extracted/executed on the desktop. No native IPC granted to remote web content.
Raw manifest export added to existing owner/hash-bound artifact routes.

Migration 16 and shared contracts/API/UI implement durable five-minute one-time
challenges, session-bound browser approval, separate revocable desktop sessions,
hashed/revocable/expiring workspace worker identities, scoped 30-second presence
leases and control fences. Shared Desktop and workers view offers refresh and
pause/resume/shutdown/revoke. Outbound worker CLI holds its token in memory only.
Presence-only leases grant no dispatch, artifact-read, model or budget authority.
Window close, shutdown request, lease expiry and observed process exit are distinct.

Executed: TypeScript project/web checks and production web build; locked Cargo
check/build and 3 Rust tests; 3 Windows Node cache tests; 11 focused DB/HTTP/storage
checks; actual Windows WebView startup and authenticated native source download
(2 fixture-backed checks; manifest/archive hash readback). Imported X04 Git test
failed on POSIX mkdir/file URL assumptions, repaired with Node portable setup;
all 4 Git/REST domain checks then passed unchanged assertions. Initial integrated
run preserved as failed evidence (221 pass, 1 fail, 13 skips).
Final integrated PostgreSQL suite: 236 tests, 222 pass, 0 fail, 14 explicit native/WSL opt-in skips (final-integrated-tests.log).
Formatting and diff whitespace checks passed. Final runtime source hashes are in
tracking/evidence/x05/candidate-sha256.json; logs are in that evidence folder.

X05 remains PARTIAL. Native browser approval/editor interaction, OIDC secure-cookie
path, actual bounded job dispatch to paired workers, native-to-real-worker launch
and revocation, and installer/signed-update acceptance remain unverified/incomplete.
Native download fixture used test-double execution; it is not isolation evidence.
No installer/updater or background service activated. Next eligible: continue X05;
no automatic X06. Commands and trust assumptions: apps/desktop/README.md.

## X04 — scoped GitHub management (October 19, 2026)

Branch claude/x04-gm7n32 from main d2c8ef1; migration 15 (after X03's 14,
merged in); ADR-0027; docs/GITHUB.md. Partial: implemented and verified against a
deterministic fixture GitHub and loopback contract tests only. No live GitHub call, no
credential configured, no repository created on github.com.

What works: connections naming one owner by immutable id, one credential reference
(GitHub App installation or fine-grained token, by environment variable name only), limits
and required checks; owner verification before anything else runs; managed repositories
by immutable id (renames followed; another owner or public visibility quarantines);
existing repositories only when listed by id; an operation journal (intent before call,
settled once, unknown until reconciled by reading GitHub); four admitted action types
(github.repo_create, github.write, github.workflow_change, github.merge) with the intent
hash as spec_hash; prefix, repository-count, hourly-change and open-PR limits; pushes of
exact local commits without force from the same workspace's product only; exact-head
merges (live head = reviewed head, independent approving review, every required check
succeeding on that head, sha sent to GitHub); verified, deduplicated webhooks that only
remove access; live off unless CREATOR_GITHUB=live. REST adapter on API version
2026-03-10 with per-call installation tokens scoped to one repository and the
endpoint's permissions. API routes, a webhook endpoint and `github-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 221 tests, 210 pass, 0 fail, 11 skips (real WSL2 gates, opt-in); format
check then flagged only docs/GITHUB.md (written during the run), which was reformatted
and re-checked clean (tracking/evidence/x04/check.log, format-recheck.log). New tests:
github (4 DB acceptance), github-domain (4: rules, two REST contracts, Git push
contract), github-api (1 API + CLI); storage test updated for migration 15.
Acceptance gate on fixtures: wrong owner stays unverified and sends nothing; stale base,
stale head (before and during merge, 409), missing/pending/failed checks, missing or
self-review all refused; unknown creation, push and merge reconciled from GitHub with no
retry while unknown; GitHub 401, owner revoke, recorded token expiry, lost repository
scope and a publicized repository all stop calls; live off and missing grants send
nothing in a real workspace. The stale-head check was confirmed to fail when its rule is
disabled. After merging X03 from main (61aa2d8), pnpm check passed again: 228 tests,
217 pass, 0 fail, 11 skips, format clean (evidence/x04/merge-x03-check.log). No WSL2
run needed.

Limits: no live verification (needs an owner-created GitHub App or fine-grained token,
CREATOR_GITHUB=live and grants); the API binds to loopback, so live webhooks need a
local forwarder; no releases, repository settings, secrets or branch protection; issue
and PR reconciliation match by title or head branch; no web UI. Next eligible: X05 on
request, or remaining T15/T16 work once the protocol is frozen.

## X03 — search, lineage and audit questions (October 19, 2026)

Branch claude/x03-s7po1x from main d2c8ef1; migration 14; ADR-0026; docs/SEARCH_AND_AUDIT.md.
Partial: implemented and verified in fixture workspaces only. No live call, no spend.
No real embedding model is verified, so real workspaces refuse semantic search; the
fixture embedding (character trigrams) supports no relevance claim.

What works: lexical search now also covers code versions (artifact commits and
manifests), models called and cost records (reservations with amounts), with local-date
filters in an IANA zone, per-hit local time, per-type coverage (searchable, redacted, no
text, unsupported or oversized media) and activity freshness; saved searches and saved
questions that re-run under the caller's current access; semantic search as an
access-safe lexical stage plus one metered `model.embed` broker call per text, replayed
without paying for a repeated operation id; natural-language audit questions compiled
into one of eight fixed read-only plans (rules compiler, or a metered model compiler whose
JSON must pass the strict schema), run in a read-only transaction with a 5 s timeout;
source-to-product, lineage, run cost, subject cost (shared runs counted once), decisions,
activity, redactions and model usage answers with their supporting record ids; bounded
lineage graphs with truncation flags, tombstones and source media status; lineage
exports with a canonical SHA-256 and verification (tamper, missing, version change,
redacted since, retracted links); owner-only member removal (audited). API routes and
CLI commands (`search --from/--to/--tz`, `search-semantic`, `saved-query-*`, `ask`,
`ask-model`, `audit-plan`, `lineage-graph`, `lineage-export`, `lineage-verify`,
`member-add`, `member-remove`); the web search page shows the new types, amounts and
coverage.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 219 tests, 208 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check clean (tracking/evidence/x03/check.log). New tests: search-domain (4),
search (2 DB acceptance), search-api (1 API + CLI); artifact-api now also finds a verified
build by commit prefix; storage test updated for migration 14.
Acceptance gate on fixtures: "Which sources does product … come from?" and "Which
products use source …?" return the sources, claims and link ids on the path; "How much
did run … cost?" equals the settled reservations and lists their reservation and usage
ids; two products sharing a run total once (shared_runs 1) while each product's row
includes it; injected questions (`'; drop table …`, quoted SQL in titles) compile only
to bound ids or titles, a plan with `sql` or a bad zone is refused, a write inside the
plan transaction fails with PostgreSQL 25006, and entities and the audit chain are
unchanged; after removal, viewer, editor and outsider get NOT_FOUND from search,
questions, semantic search, saved queries, lineage, export and verify; after redaction,
the source no longer matches text or semantic search, appears only as a tombstone in
answers and graphs, cannot be named by title, and an earlier export is flagged
`contains_redacted_text`. No WSL2 run needed.

Limits: no real embedding model or live compile call verified; embeddings are not stored
(each new search pays again; pool at most 40); access is workspace-level only; saved
queries, questions, semantic search and lineage graphs have no web UI; the rules compiler
is English and pattern-based. Next eligible: X04 on request (being built in parallel), or
remaining T15/T16 work once the protocol is frozen.

## Audit 2026-10-19 (T14–X02) fixes (October 19, 2026)

Branch claude/audit-x02-iois7j from main 6ffb0e6; no migration, no ADR. Report:
project file audits/2026-10-19-codebase-audit.md. Three contained fixes: `parseRatings`
reads ratings.csv as RFC 4180 records (quoted notes with line breaks no longer break
`pnpm analyze`); `context-index` skips symbolic links and junctions (nothing outside the
named folder is indexed, no ELOOP crash); `pnpm evaluate` and `pnpm pilot` refuse a
non-empty output folder so the only copy of the blinding key is never overwritten.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 212 tests, 201 pass, 0 fail, 11 skips (real WSL2 gates); format check
clean (tracking/evidence/audit-2026-10-19/check.log). The new link and multi-line-note
checks fail on the previous code. evaluate/pilot reruns into a used folder exit 2;
scripts/t19-rehearsal.mjs still passes on rerun.

Open recommendations (owner judgment): working folder inside OneDrive syncs private study
files, backups and the CLI session; the $20 ledger covers study attempts only; OpenAI batch
files are never deleted; study export repeats the workspace audit log per attempt; backups
are unencrypted. No live call, no spend; the protocol freeze and study decisions untouched.

## X02 — context selection, caching, compaction and batches (October 19, 2026)

Branch claude/x02-b3wzes from main c738369; migration 13; ADR-0025; docs/CONTEXT_AND_CACHING.md.
Partial: implemented and verified in fixture workspaces only. No live call, no spend;
gpt-6-astra's prompt caching, batch and compaction stay `documented`, so real
workspaces refuse them until verified. No savings are claimed.

What works: incremental index of code/note/source corpora and workspace records
(version bump on change, explicit and snapshot removals); immutable context packs with
application-derived authority, pinned constraints/objections/acceptance criteria and
required facts, per-item provenance and exclusion reasons; extractive, model (metered)
and provider compaction, each verified to keep pins verbatim and every required fact;
reusable handoffs that go stale when a source changes; a result cache separate from
provider prompt caching, keyed by scope and version, invalidated by dependency
changes, re-admitted on every hit (revoked grant refuses), never read by study runs;
capability registry per model and feature; batches with all-or-nothing reservation at
the batch price, per-item settlement, expiry release, unknown-then-late settlement;
quality-and-total-cost evaluations including compaction overhead; a usage report whose
figures list their reservation and operation ids. Broker ContextService, fixture and
OpenAI batch adapters, API routes and `context-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 212 tests, 201 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check clean (tracking/evidence/x02/check.log). New tests: context-domain (7,
incl. the OpenAI batch loopback contract), context (6 DB acceptance), context-api (1
API + CLI); storage test updated for migration 13.
Acceptance gate on fixtures: model-compacted pack answers 2/2 questions like the full
pack (quality maintained, compaction overhead counted) while a starved pack fails
(`not_claimed_quality_drop`); pins, authority and facts survive extractive and model
compaction, a lossy compactor is rejected naming the lost facts, opaque provider
compaction is refused; cache hits, dependency invalidation, revoked-grant refusal and
workspace isolation verified; usage figures trace to reservations and source
operations. No WSL2 run needed.

Limits: no live verification of the OpenAI batch adapter or of prompt caching; no
provider compaction adapter; packs and caching are opt-in per call and not yet used by
workflow, study or builder paths; no web UI; the quality check uses a small synthetic
question set. Next eligible: X03 on request, or remaining T15/T16 work once the
protocol is frozen.

## X01 — model registry and qualified routing (October 19, 2026)

Branch claude/x01-qfktko from main 8c09748; migration 12; ADR-0024; docs/MODEL_ROUTING.md.
Partial: implemented and verified in fixture workspaces only. The prerequisite
"measured task outcomes" does not exist (T15 not run), so no real model is qualified
beyond the reference baseline and no quality or savings claim is made.

What works: versioned registry (config/routing) with pricing hashes; fixed/auto/economy
route policies per workspace or project; immutable route decisions naming policy,
registry and pricing versions and every candidate's reason; hard-constraint refusal
(availability, action, task class, tools, data class, context, latency); held-out
benchmark scored by the store from broker reservations; shadow, capped deterministic
canary, owner advancement that cannot override a failing gate; automatic rollback on
canary/post-promotion outcomes below the floor and owner rollback; objective-only
escalation to the baseline; cost per accepted result including failed, review, repair
and tool operations; broker callRouted/callModel; API routes and `route-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 198 tests, 187 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check then flagged only docs/MODEL_ROUTING.md, which was reformatted and
re-checked clean (tracking/evidence/x01/check.log, format-recheck.log). New tests:
routing-domain (8), routing (2 DB acceptance), routing-api (1 API + CLI).
Acceptance gate on fixtures: decisions carry policy/model/price versions; privacy-
incompatible, unsupported, unverified and unqualified fixed routes are refused and
recorded; the cheap-but-unreliable fixture model (4/8 held-out) is rejected though
cheaper; promotion of the reliable fixture model, automatic and manual rollback back
to the baseline all verified. No live call, no spend, no WSL2 run needed.

Limits: gpt-6-astra stays `documented`, so real workspaces cannot route until an
accessible id is verified; routing is opt-in per call and not yet used by workflow,
study or builder paths; no web UI; fixture models and benchmark are synthetic.
Next eligible: X02 on request (prerequisite X01 now implemented), or remaining T15/T16
work once the protocol is frozen.

## PR publication validation (October 18, 2026)

Owner requested a PR for all pending work. Branch: codex/t18-t19-thesis-archive.
Integrated origin/main at 3e9026f while retaining the T15/T16 and T18/T19 tracking
records. Includes the RD6 owner update, thesis packet, reproducibility archive,
optional acceptance recorder, lease-aware recovery test and existing T17 log.
Generated T18 fixture private assignment keys/raw exports remain local and ignored;
credentials, ignored verification directories and product stores are excluded.
Evidence paths preserve original bytes through Git; archive checksum and all twelve
T18 copied-source hashes verified against committed blobs.

Executed on integrated candidate: pnpm check passed (94 pass, 0 fail, 93 skips because
database/real-isolation gates are not configured in this invocation), including
typecheck and format check. Log: tracking/evidence/t19/pr-publication-check.log.
No DB/WSL rerun in the publication step; prior T19 full-run failure and focused
repair checks remain explicitly recorded. No empirical study, protocol adoption,
committee acceptance or application activation is implied. PR publication is now
authorized; the earlier no-push entries describe their historical milestone runs.

## T19 — reproducibility archive and conditional acceptance (October 18, 2026)

Prepared docs/thesis/T19_ACCEPTANCE.md and tracking/evidence/t19/WALKTHROUGH.md.
Source is fixed upstream 3e9026f with separately hashed documentation/scripts and
two test-only overlays; local HEAD 38b3e46 and prior owner edits are preserved.
No source merge, commit, push, public release, contact, paid call or recruitment.

Fresh cached install succeeded. Full PostgreSQL 18.6 + real WSL suite: 187 tests,
185 pass, 1 fail, 1 expected no-worker skip. The process-restart recovery test
observed running at its polling deadline. Original focused test passed; inspection
found its 20-second wait shorter than a possible 30-second killed-worker lease.
Test-only lease-aware deadline repair passed the focused integration; all success
and exact-call assertions remain. Full suite was not repeated after test-only
changes. Failed log and diagnosis are retained, not relabelled as green.
Latest study-build WSL gate passed. Typecheck and built web/proxy/API smoke passed.

The optional artifact acceptance recorder passed with the real worker, preserving
original/revised generated package bytes, manifests, same-workspace lineage/search
and incurred-budget inspection. The fixture CLI explicitly replaces the discovered
clinic spec with the reviewed checklist template; no arbitrary synthesis or clinic
validation claim. Fresh A/B/C + discovery rehearsal: 26 slots, 10 evaluation and
12 analysis checks pass; no independent ratings and data remains not_empirical.
Private keys/raw exports stay in ignored verification directories.

Archive tooling: scripts/t19-archive.mjs verifies upstream Git blob identities,
per-file SHA256, exclusions, extraction and tamper refusal. scripts/t19-rehearsal.mjs
recreates synthetic study/analysis on its own disposable database. Final archive
readback and extracted install/build smoke are recorded externally in
tracking/evidence/t19/release-validation.json after construction. Distribution
files are creator-agent-t19.tar and its .sha256 sidecar in that evidence directory.

T19 packages the engineering thesis under the retained missing-data limits; it does
not establish academic acceptance. T15 final participant evaluation and T16
empirical analysis remain incomplete; comparative protocol proposed/unfrozen,
RQ1–RQ3 unanswered, academic dates/committee decisions unconfirmed. Next eligible
work is an owner-selected remaining committee/research acceptance item; no automatic
X milestone. Existing DB services left as found; test harnesses close their temporary
processes/databases. See verification.json for exact checks and limitations.

## T18 — review packet under documented missing-data allowance (October 18, 2026)

Prepared docs/thesis/README.md, THESIS_DRAFT.md, EVIDENCE.md,
COMMITTEE_REVIEW.md and DEMONSTRATION.md. Reviewable engineering draft with
architecture, methods, executed software results, unavailable empirical tables,
limitations, RQ1–RQ3 unanswered, concrete decisions/revisions and fixture backup.
No committee response, approved academic schedule or final empirical result claimed.

Fetched origin/main 3e9026f (T15/T16 merged) and inspected/built an archive at
.verification/t18-source. Local HEAD remains 38b3e46; existing edits preserved,
no merge/commit/push. T15 final evaluation and T16 empirical analysis remain partial;
only their machinery and fixture checks are implemented. T18 uses its explicit
missing-data route, not a retrospective protocol adoption.

Executed on Node 22.21.0: pinned pnpm 11.25.0 cached install (required sandbox
escalation for package-store access), TypeScript build, analysis tests 8 pass,
0 fail, 1 DB skip; three synthetic analysis scenarios, 12 checks pass each.
Logs, rerun outputs, source copies and hashes: tracking/evidence/t18.
Initial sandbox install and a later sandbox Corepack version probe failed on
store/network access; the escalated cached install and subsequent build succeeded.
No database, live model, paid call, participant evaluation, full product demo,
recruitment, sending or publication in T18. Historical WSL checks are not a latest
study-build gate. No source runtime or study policy changed.

Next eligible prompt: T19 on a new request, retaining missing-data limits; final
academic acceptance and empirical completion cannot be claimed. Empirical path:
record RD decisions/IRB determination and dates, adopt protocol/analysis rules,
verify model/pricing/runtime allowance and latest study worker, execute final runs,
obtain independent ratings, then analyze. Full clean reproducibility is T19 work.

October 18, 2026 owner research decision: RD6 now records GPT-6 Astra and a
$20 USD total T15 live budget in docs/PILOT_AND_PROTOCOL.md. API identifier/access,
pricing and enforced runtime configuration remain unverified. Documentation-only
update; no live calls, adopted freeze or evaluation run. Next eligible: resolve
remaining T14 decisions and verification prerequisites before freezing, then T15.

T16 implementation update, October 18, 2026 (Claude Code, branch claude/t16-analysis-95avhe from
main 479dba4; ADR-0023; no migration): **analysis pipeline built; empirical T16 blocked.** No
final run, rating or outcome exists, so nothing was analyzed for real and no finding, power or
comparative result is reported. Added `pnpm analyze <evaluation-dir> <out-dir>`: reads the T15
package, private key, raw study exports and reviewers' ratings.csv; writes analysis.json,
report.md, CSV tables and SVG figures (completion over all assigned slots, decision quality
without imputation, functional completion, task-level paired and per-theme discovery
comparisons, exact-money resources with undefined or lower-bound cost per accepted outcome,
human effort and latency, interventions, evidence validity, two-reviewer kappa and
disagreements, deviations, exploratory per-protocol completion). Checks: slot/attempt/export
reconciliation without join multiplication, rating-code validity, privacy, identical reruns
and no comparative wording. Empirical status is derived from the inputs. Verified on three
labelled synthetic fixtures (`pnpm analyze fixtures`, outputs in tracking/evidence/t16/fixtures)
and on a real T15 rehearsal package. Cloud `pnpm test:db`: **187 tests, 176 pass, 0 fail, 11
WSL skips** (tracking/evidence/t16/test-db.log). Real-data inputs: docs/ANALYSIS.md.

T15 prerequisites update, October 18, 2026 (Claude Code, branch claude/t15-hdrwqz on top of
ADR-0021; ADR-0022; migration 11): **T15 still partial; protocol not frozen, no final run, no
live call or spend.** Added `config/evaluation.json` (owner preference `gpt-6-astra`
unverified, live off, $20.00 total T15 cap, RD3/RD4/RD5/RD8 unresolved); a final-record gate
that creates non-synthetic studies only when the adopted freeze answers every governance item,
the verified model matches config and the cap is $20 (today it refuses, listing each unmet
condition); a study budget ledger that holds each attempt's full cap before model work; and
builder-backed implementation attempts (A/B through the T12 builder in per-attempt products,
C refused the builder with its code checked server-side against every frozen case). Verified
on labelled synthetic records with the test double: exact spec/task/file hashes, condition
isolation, human-only denial, budget refusal, cancellation retention, mismatch refusals,
held-out cases kept out of role packets and records. Cloud `pnpm test:db`: **178 tests, 167
pass, 0 fail, 11 WSL skips** (one new opt-in WSL2 study-build test, not yet run on Jordan's
machine). Evidence: tracking/evidence/t15/study-build-tests.log.

T15 update, October 18, 2026 (Claude Code, branch claude/t15-hdrwqz from main 3f3544a;
ADR-0021; no migration): **final evaluation not run, because the protocol is not frozen.** Built the
final-evaluation machinery: schedule from the adopted freeze and owner tasks, deterministic
slot admission, a run ledger where every slot is listed (blocked, deferred, missing, or
attempt states, with RD10 retries kept), and blinded per-reviewer packets with a leak scan, a
private key and raw exports (`pnpm evaluate rehearsal|final`, docs/FINAL_EVALUATION.md).
Rehearsal on 8 synthetic tasks (26 slots, fixture AI, scripted labelled humans): 10/10 checks
pass. `pnpm evaluate final` refuses without a freeze and lists RD1-RD10; with a freeze every
slot is blocked (synthetic-only study records, no verified live model, AI implementation not
wired to studies). Cloud `pnpm test:db`: **174 tests, 164 pass, 0 fail, 10 WSL skips**.
Evidence: tracking/evidence/t15.

T17 update, October 18, 2026 (Claude Code, branch claude/project-thread-k4si82 from main
e46b2cf; ADR-0020; built in parallel with T14): requirements-to-evidence report for C01–C51,
S01–S18 and the T17 priority risks in tracking/evidence/t17/REQUIREMENTS_EVIDENCE.md. New
local backup/restore (`pnpm backup`, docs/BACKUP_AND_RESTORE.md): a restored database and
product store pass the audit chain, artifact hash, catalog search, lineage and exact-byte
download checks through the real API, and tampering is refused. Fixed: a child overrun now
counts against every ancestor; `/api/health` reports configured live adapters; preview stdin
survives split UTF-8; workflow lease heartbeats work (an ambiguous SQL column had made every
heartbeat fail silently, so long calls were redelivered). Cloud `pnpm test:db`: 162 tests,
152 pass, 0 fail, 10 WSL skips; after merging T14, 168 tests, 158 pass, 0 fail, 10 WSL skips.
Real WSL2 gate on Jordan's Windows machine (reported by Jordan, October 18, 2026, on merge commit 38b3e46): `CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` 168 tests, 167 pass, 0 fail, 1 skip (the no-worker test, which always skips where the worker exists, so the restore test ran there). No critical blocker found; not production-ready or live.

T14 update, October 18, 2026 (Claude Code, branch claude/project-thread-ocgg8g from main
e46b2cf; ADR-0019): `pnpm pilot <dir>` runs a pilot rehearsal (arms A, B, C on one fictional
decision task plus one structured/open-ended pair) through the real study path, with fixture
AI and scripted, labelled human entries. Checks: 16 pass, 1 warn, 0 fail; reproducible digest
stable across databases. Blinded reviewer packet, feasibility estimate, pilot report and
proposed final protocol in docs/PILOT_AND_PROTOCOL.md. The owner-only freeze route refuses
until 10 research decisions (RD1-RD10) are answered; **protocol not adopted**. Cloud
`pnpm test:db` **164 tests, 154 pass, 0 fail, 10 WSL skips**. No live model, participant,
reviewer or empirical result. Evidence: tracking/evidence/t14.

Audit fixes, October 18, 2026 (Claude Code, branch claude/project-thread-mccbs5 from
main c162376; ADR-0018): build QA cases are now frozen in the spec and checked against the
plan, with at least one held-out case no role sees; study participant ids compare
case-insensitively so a participant can no longer be granted grader access; CI runs the
PostgreSQL suites. Cloud check: typecheck, format, `pnpm test:db` **158 tests, 148 pass, 0
fail, 10 WSL skips**; GitHub CI (including the new database job) green. Real WSL2 gate on
Jordan's Windows machine (reported by Jordan, October 18, 2026): `CREATOR_TEST_ISOLATION=wsl2
pnpm test:db` **158 tests, 157 pass, 0 fail, 1 skip** (the no-worker test). Remaining
audit items (parent envelope overrun, health labels, preview cookie scope, small fixes) are
in /mnt/project-files/audits/2026-10-18-codebase-audit.md; T17 (above) fixes 4, 5 and 7
and records 6.

T13 update, October 18, 2026 (Claude Code, branch claude/t13-8h288j from main at
6fe5bab, T12 merged as PR #14): a T12 verified candidate now packages into a
deterministic source archive and an immutable `build-manifest/1` binding repo,
commit, spec/freeze/task hashes, template, toolchain, dependency statement, archive
and file hashes, startup requirements, build QA and exported-package results, cost,
lineage and limitations. The archive is re-read, re-extracted and every acceptance
case re-run from those bytes; matching input hashes prove the tested bytes ran.
Migration 10 indexes manifests, private previews and feedback. A separate preview
origin with one-time tickets, owner rechecks, leases, readiness, expiry, stop and
revoke runs the exact package; downloads recheck access and hash. Accepted feedback
on one exact version becomes a new spec version, a revision repo starts from the
package bytes, and versions compare by spec, tasks, tests, files, cost and feedback.
Source archive, runnable demo and native installer are separate labels.

Verified in the Linux cloud container (PostgreSQL 16): typecheck, format, full test
suite **146 pass, 0 fail, 10 skipped** (every skip needs the reviewed WSL2 worker),
and a 13-step headless Chromium walkthrough of gallery, download, compare, preview
origin, ticket reuse, cross-origin, revoke and feedback. That walkthrough used the
visibly labeled test double, which runs nothing and is **not isolation evidence**.

Real-worker gate, October 18, 2026, on Jordan's Windows machine (WSL2
`wsl2-bwrap-systemd` worker, Docker test PostgreSQL): `pnpm test:db` with
`CREATOR_TEST_ISOLATION=wsl2` ran **156 tests, 155 passed, 0 failed, 1 skipped**
(the skip is the no-worker test, which only runs where the worker is absent). The
compiled CLI flow packaged a verified artifact, re-ran it in the worker, ran a
preview, completed one feedback-driven revision (spec v3 to v4, new verified
package with A3) and refused revoked (403), expired (410), tampered download (400)
and stale feedback revision (409). Evidence: tracking/evidence/t13/cli-acceptance.json
and wsl-gate.log. PR #15 merged at b035d99. See ADR-0017,
docs/ARTIFACTS_AND_PREVIEW.md and tracking/evidence/t13. No live provider, public
release or T14 work.

T12 update, October 18, 2026: the bounded local Python task path now connects
authenticated current frozen T08 tasks to build admission and exact-spec humility
review, the existing metered broker, scoped committed T11 patches, fresh reviewer
context and actually executed WSL QA. Immutable plans/prompts/contexts, broker
traces, commits, reviews, commands and execution identities are retained. Only
supervisor code can mark the exact task candidate verified. Broken behavior,
unsupported success claims, stale reviewed commits/specs, scope expansion,
cancelled/human-only runs and zero budgets fail; two-repair exhaustion preserves
partial code. **149/149 database + real-isolation checks passed, no skips** after
serializing test files; earlier failed logs remain. See ADR-0016,
docs/BOUNDED_BUILDER.md and evidence/t12. The final authority-freshness guard has
separate compiled CLI verification in that evidence directory.

This is fixed synthetic builder/reviewer verification for the reviewed offline
Python template, not independent model-quality evidence or a whole-product
readiness claim. Browser/persistence recipes, dependent-task integration, build
catalog indexing, participant implementation execution, previews and delivery
remain unavailable. No live provider, real spend, public release or study
activation. T11 and T12 were later merged (PRs #13 and #14) and T13 is done.

| Requirement | T12 verified scope                                                                                                                | Remaining limitation                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C21, C29    | Finite broker calls, bounded context/output/deadline, typed scoped tools, two repairs, cancellation and preserved partial commits | One independent builder task; crash intents require inspection, no automatic continuation |
| C23         | Fresh review plus real normal/error assertions bound to exact commit/spec/task/plan                                               | Fixed synthetic roles; stdout/exit CLI recipe only, no browser/persistence verification   |
| C27, C34    | Immutable prompt/context/command/output traces and broker reservation IDs                                                         | Local build records are not yet searchable in the catalog                                 |

Docker follow-up, October 18, 2026: CLI/daemon connection verified (Docker Desktop
4.95.0, Engine 29.8.2, Compose 5.6.0, desktop-linux). Optional digest-pinned
PostgreSQL 18.6 Compose development/test services now work on distinct loopback
ports and named volumes. All nine migrations applied, restart persistence and host
TCP password rejection checked; **140/140 tests passed, zero skipped**, including
real WSL isolation. Development DB remains running on 55433; test container on
55434 is stopped. Credentials are in ignored `.env.docker`; application URLs are
opt-in per terminal. No Docker MCP tool was exposed; direct CLI connection is
verified. Generated-code execution remains the T11 WSL worker. See ADR-0015,
docs/DOCKER.md and evidence/docker. T12 is not started; its review/merge and new
request prerequisites remain.

T11 update, October 18, 2026: verified local owner CLI and reviewed Python template execution on Windows + the existing Ubuntu WSL2 VM (Bubblewrap 0.11.1, systemd 259, Python 3.14.4). Separate Git repositories/task/review worktrees bind exact frozen T08 spec/task hashes; typed CAS changes enforce portable file scopes, reject linked paths and stale heads, preserve edits and conflicts, and serialize one integration owner. Generated code runs offline/non-root with narrow read-only mounts and bounded CPU/memory/processes/disk/time/output. Worker leases, process-tree cancellation, uncertain-dispatch fencing, crash reconciliation and cleanup were exercised. **140/140** database + real-isolation checks pass; standard check **63 pass / 77 explicitly skipped**, smoke and authenticated compiled CLI acceptance pass. ADR-0014, docs/ISOLATED_EXECUTION.md and evidence/t11 bind the exact source. No model builder, independent QA, persistent preview, participant implementation execution or public release. T10 is merged as PR #12 at 5f9bb1b; T12 is next after T11 review/merge and a new request.

T10 update, October 18, 2026: verified synthetic study runner on native Windows, Node 22.21.0 and PostgreSQL 18.6. Migration 9 and ADR-0013 add immutable protocol/task/config manifests and hashes, seeded order and condition assignments, isolated attempt workspaces, human-only verbatim document/code/artifact entry with conventional bound text checks, separate human grader authorization, intervention/deviation records, structured T07 execution and a versioned open-ended broker baseline, condition-stable outcomes and excluded assisted continuations, metrics and a repeatable hashed export. Database gate: 130/130; non-database check: 59 pass, 71 explicitly skipped; smoke, compiled CLI/API and headless Edge acceptance passed. No live model, real spend, recruitment or empirical results. Unverified snapshots stop structured execution; arbitrary code and AI implementation execution wait for T11. See [T10 evidence](evidence/t10/verification.json), [review](evidence/t10/review.md) and the [local guide](../docs/LOCAL_DEVELOPMENT.md).

| Requirement | T10 status                                             | Evidence and remaining gate                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C15         | partial, synthetic workflow verified                   | Three-arm matched packet/hash, seed/order/familiarity, separate discovery comparison, condition-stable failures, intervention metrics and available-record export; actual participant work, adopted design and independent outcomes remain T14-T16 |
| C16         | verified for implemented fixture/broker/workflow paths | Every model/broker action, seven study helper paths and both workflow starts refused for human-only work, zero adapter calls; hidden grader and cross-participant contexts denied; external human tool use is not empirically verified             |

T09 update, October 18, 2026: the web page is now a usable studio over the existing API (migration 8, ADR-0012). One workspace picker and a view list replace the stacked panels; the address (`#/view?ws=&id=&q=`) keeps the view, workspace, selected record and query across refresh. Views: Monitor (waiting decisions, workflows in progress with Pause/Resume/Cancel, recently finished, catalog counts, product stages, charged/in-flight/unknown spend and refused calls, latest activity; refreshes itself while work runs), Submit a theme (versioned search brief, claims with what each bears on, response types with exclusion reasons, a new or existing run with an optional revocable 24-hour model permission, then the T07 discovery run), Catalog, Compare and decide (the problem, its brief and claims with passages, freshness and counted status, run assumptions, alternatives side by side with suitability and opportunity scores, gates, humility review, discovery disposition and dissent, then a selection form whose blocked choices are disabled and which handles the supervised approval round), Evidence, Decisions (who asked and when, who answered), Runs, Budgets (now with a Fund a budget form), Scores and specs, Search, Activity and a reserved Gallery that says no preview or download exists. New server routes: `search` (full text over record text, source passages, decision questions and activity summaries via PostgreSQL text search with highlighted snippets; exact UUID or 8+ hex prefix; kind and status filters), `activity` (actor names, action filter, paging), `actors`, `overview`, `problems/{id}/comparison`, and `lineage?depth=1..8`. Membership is checked before any snippet or count; redacted text and redacted sources' passages are not searchable. Fixture workspaces carry a FIXTURE MODE banner. Verified in a Linux cloud container with PostgreSQL 16.15: 122/122 tests with the database (58 pass, 64 visibly skipped without), smoke, and a 12-step headless Chromium acceptance run from a freshly seeded database (submit → evidence → compare → decide with approval → search and activity, budget denial, permission revocation, reserved gallery, keyboard skip link, no overflow at 390 px). C35 is partial (fixture-verified); C26 search is partial; C31 snippet access is partial. See [T09 evidence](evidence/t09/verification.json).

T08 update, October 18, 2026: versioned scoring, selection and frozen specifications now exist (migration 7, ADR-0011). Reviewers record `scorecard` records against two versioned rubrics with equal integer weights: `opportunity-rubric/1.0` ranks software opportunities (urgency, benefit, software influence, feasibility, differentiation, evidence quality) and `suitability-rubric/1.0` compares every response type, software or not. Every rating cites claim or source versions or is explicitly unknown; cards also record confidence, ethics and access gates and which existing alternatives were checked and when. The selection report is computed, never stored as a model claim: exact rational scores (shown to one decimal), no score for a candidate with an unknown rating (bounds instead), the mean of several reviewers with their disagreements listed, shared ranks on ties, overlapping ranges marked unresolved, and a sensitivity report for each weight removed or doubled. Ethics/access, the T07 disposition and the T03 humility review are gates beside the score. A selection (new admitted action `candidate.select`, now a supervised default stage gate) must name the current report hash and give every candidate a disposition with reasons and a reversal condition; code refuses gated candidates and `select_for_build` for a non-code response, and an override of a higher-ranked candidate needs a reason, with the original ranking stored. A `spec/1` specification for the selected build candidate covers audience, flows, scope, non-goals, data contracts, measurable acceptance checks, risks, maintenance and a task DAG checked for cycles, unknown references, uncovered checks and parallel file-ownership conflicts. Freezing is the admitted `spec.freeze` action and records a hash per task; a later revision shows which tasks are still covered by the freeze and which changed. API routes, CLI commands (`scorecard`, `report`, `select`, `selections`, `spec-create`, `spec`, `spec-revise`, `spec-freeze`, `seed-selection`) and a read-only web Scoring and selection panel. Fixture reviewers only. Verified in a Linux cloud container with PostgreSQL 16.15: 117/117 tests with the database (57 pass, 60 visibly skipped without), smoke, a CLI seed run against the API and a headless Chromium check. C09 and C20 are now partial (fixture-verified); C04 and C10 selection-side are partial. See [T08 evidence](evidence/t08/verification.json).

T07 update, October 18, 2026: discovery runs now locate a problem and generate competing responses on the T05 workflow engine (migration 6, ADR-0010). A run starts from a `search_brief` record (theme, two distinct fields, target users, context, measurable problem and outcome measure, data and tools, time and budget limits, optional NAE Grand Challenge seed that must be narrowed) plus chosen T06 claims tagged with what they bear on. The application builds one evidence packet (claims with their current T06 status and quoted passages, matching catalog records, a deterministic sufficiency verdict), binds it by hash, and runs: a locator (affected users, urgency, workaround, alternatives, the transferred cross-field mechanism, or a reason none was found), then one independent proposal per response type (software, existing tool, process change, human-led, hybrid; every type is either run or excluded with a reason), a skeptic pass, revisions up to a configured cap (0–2) and a final skeptic pass. First proposals see the packet and the locator only; their task contexts carry hashes, and the result records the proof. Insufficient problem evidence stops after the locator. Outputs are checked in code (refs must exist in the packet, cross-field answers must explain a mechanism beyond naming the fields, the skeptic must review every proposal) and repaired within limits. Dispositions are deterministic: duplicate of a catalog record (word overlap), rejected, not recommended (including software when an existing tool covers the need), insufficient evidence, or candidate; unresolved objections stay as dissent. Finished runs write a problem record and one alternative per proposal with typed links. API routes, CLI commands (`discovery-start`, `discovery`, `discovery-packet`, `seed-discovery`) and discovery results in the web Workflow runs panel. Fixture model only; the locator does not search the web itself. Verified in a Linux cloud container with PostgreSQL 16.15: 104/104 tests with the database (52 pass, 52 visibly skipped without), smoke, a CLI seed run against the API and a headless Chromium check. Requirements C02, C03 and C07 are now partial (fixture-verified; live model behaviour unverified); C10 discovery-side options are partial. See [T07 evidence](evidence/t07/verification.json).

T06 update, October 18, 2026: runs now fetch web pages only through an application source broker (migration 5, ADR-0009). Each fetch is a `source.fetch` action admitted against the run's grants (approve-once covers one URL) after a URL policy check; every redirect hop and DNS answer is re-checked, private/loopback/link-local/metadata addresses, non-HTTPS, other ports, credentials in URLs and unapproved hosts are refused, and byte, time, type and per-run limits apply with no cookies or credentials sent. Sources keep URL, final URL, content hash, retrieval and publication dates, retrieval state, retention class and passages with exact text offsets, hashes and bounded excerpts (none under hash-only retention); a changed page is a new version. Claim support binds a quoted passage (verified verbatim) to exact claim and source versions as supports/contradicts/does-not-support, typed as source assertion, quotation, observation or inference; inaccessible sources are labelled, never counted. Evidence status counts reposts of one origin once, stops counting changed, removed or stale rows, and names gaps. Retrieved text is stored as data with no authority. API routes, CLI commands and a web Sources and evidence panel. Fixture adapter only; the live HTTP adapter is tested against loopback servers, not real sites, and there is no live search adapter. Verified in a Linux cloud container with PostgreSQL 16.15: 91/91 tests with the database in three full runs (45 pass, 46 visibly skipped without), smoke and a headless Chromium check. See [T06 evidence](evidence/t06/verification.json).

T05 update, October 18, 2026: durable bounded orchestration now runs on PostgreSQL (migration 4; Jordan chose this over a Temporal server, ADR-0008). A deterministic coordinator runs one bounded role (R05 skeptic) for a registered run: per-perspective critique tasks within concurrency, call, repair, depth and deadline limits, then a synthesis once its dependencies finish. Tasks are checkpointed with logical operation ids, leased to workers with fencing tokens and heartbeats, woken from decisions through an idempotent outbox consumer, and never auto-retried after an unknown outcome. Pause, resume and cancel are owner controls; cancel stops delegation and keeps in-flight exposure held. A worker runs inside the API (or `pnpm worker`), with API routes, CLI commands and a web Workflow runs panel. Verified in a Linux cloud container with PostgreSQL 16.15: 72/72 tests with the database (37 pass, 35 visibly skipped without), a real killed-process restart, smoke and a headless Chromium check. See [T05 evidence](evidence/t05/verification.json).

T04 update, October 18, 2026: an application-owned model/tool broker now meters every model and metered tool call. Owner-funded budget envelopes (global, period, run, task) with carve-out child allocation, dated pricing snapshots, atomic reservation of maximum exposure committed together with T03 admission, settlement from authoritative usage (one charge per attempt), release for definitive provider refusals, held unknown exposure for timeouts/5xx/cancellation with late-result settlement and owner reconciliation, a deterministic fixture adapter and an OpenAI Responses adapter for `gpt-6-astra` (documented by OpenAI; account access unverified, no live call made). API routes, CLI commands and a web Budgets panel. Verified in a Linux cloud container with PostgreSQL 16.15: 61/61 tests with the database (33 pass, 28 visibly skipped without), smoke and a headless Chromium check. See [T04 evidence](evidence/t04/verification.json) and ADR-0007.

T03 update, October 18, 2026: owner sign-in (local development code or OIDC with PKCE), CSRF-protected sessions, versioned standing grants, approve-once grants bound to exact target/content/spec versions, durable decision requests (clarification, judgment, authorization, feedback) with expiry, cancellation and idempotent answers, deterministic action admission for supervised, human-in-the-loop, autonomous-within-scope and human-only runs, assumption records and a pre-build humility gate now exist behind the API, CLI and a web Human decisions panel. Verified in a Linux cloud container with PostgreSQL 16.15: 47/47 tests with the database (29 pass, 18 visibly skipped without), smoke and a headless Chromium check. Not run on the owner's Windows machine; OIDC verified only against a local test identity provider. See [T03 evidence](evidence/t03/verification.json) and ADR-0006.

T02 update, October 18, 2026: PostgreSQL persistence, migrations, many-to-many typed links, optimistic versions, workspace scopes, a hash-chained audit log with transactional outbox, an idempotent history projection, corrections and redaction tombstones now exist behind the API, CLI and a read-only web Records panel. Verified in a Linux cloud container against PostgreSQL 16.15 (29/29 tests with the database; 21 pass and 8 visibly skipped without it). Not yet run on the owner's Windows machine. See [T02 evidence](evidence/t02/verification.json) and ADR-0005 in [decisions](DECISIONS.md). The task demonstration remains fixture-only; no AI, research or authentication exists.

Claude Code tooling, October 18, 2026: the same skills (now 30, adding Matt Pocock `grill-me`, `grilling` and `improve-codebase-architecture`) are mirrored to `.claude/skills`, both MCP servers are in `.mcp.json`, and a cloud-only SessionStart hook runs `pnpm install`. Playwright MCP was verified in a Linux cloud container with environment overrides; Firecrawl was not reachable from the cloud network (403) and is untested there. Product status unchanged: T01 complete, T02 next.

CI update, October 18, 2026: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` and `pnpm check` on Node 22 for every push and pull request. It does not advance T02.

Tooling update, October 18, 2026: the owner's requested development setup is installed project-locally: 27 pinned skills, Playwright MCP 0.0.83, Firecrawl's keyless hosted MCP, and Impeccable engine 0.1.15. MCP handshakes/tool discovery and an isolated blank browser check passed; Firecrawl data/account operations remain untested. See [tool guide](../docs/DEVELOPMENT_TOOLS.md) and [tooling evidence](evidence/development-tools/install-manifest.json). This does not advance T02 or activate product integrations. T01 source and application dependencies are unchanged.

Updated October 17, 2026 (America/New_York). T00 and T01 verified. A minimal TypeScript workspace now provides strict runtime contracts, deterministic domain rules, a fixture-only Node API/CLI and React web page. No real AI, research, persistence or generated-product execution exists. Local main remains unborn (no HEAD commit); exact source/evidence hashes identify the candidate. See [decisions](DECISIONS.md), [startup guide](../docs/LOCAL_DEVELOPMENT.md) and [T01 evidence](evidence/t01/verification.json).

Use planned, in_progress, implemented_unverified, verified, partial, blocked, or deferred. Each verified entry needs exact code/spec version, checks actually executed, and evidence. Identify external/live/native gates separately.

| ID  | Milestone                                                  | Status                                                                                                                      | Code/version and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Remaining work                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00 | Repository intake and verified starting point              | verified                                                                                                                    | Historical T00 snapshot in evidence/t00; ADR-0001                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Intake complete; T01 subsequently implemented                                                                                                                                                                                                                                           |
| T01 | Minimal workspace, typed contracts, and lifecycle          | verified                                                                                                                    | Package 0.1.0, schema 1.0; evidence/t01/final-files.sha256; clean install/build/check, 20 passing tests on Node 22 and 24, HTTP smoke and browser checks                                                                                                                                                                                                                                                                                                                                                                                                                      | Superseded as current status by T02                                                                                                                                                                                                                                                     |
| T02 | Persistence, provenance, and durable audit                 | verified (cloud Linux, PostgreSQL 16.15), merged PR #3                                                                      | Migration 1; evidence/t02/verification.json; 29/29 tests incl. real process restart, stale/concurrent writes, cross-scope links, duplicate outbox delivery and two-ideas/two-descendants lineage; browser check of Records panel                                                                                                                                                                                                                                                                                                                                              | Windows PostgreSQL setup untested; authentication added in T03                                                                                                                                                                                                                          |
| T03 | Human decisions, autonomy modes, and humility              | verified (cloud Linux, PostgreSQL 16.15)                                                                                    | Branch claude/t03-decisions-autonomy-5gpinz; migration 2; evidence/t03/verification.json; 47/47 tests incl. changed/expired approvals, cancellation, duplicate and concurrent answers, autonomous needs_human, human-only model denial, routine action without interruption, OIDC PKCE and CSRF                                                                                                                                                                                                                                                                               | Merged (PR #4); Windows and real IdP untested                                                                                                                                                                                                                                           |
| T04 | Budgets and a metered model/tool broker                    | verified (cloud Linux, PostgreSQL 16.15; fixture and contract only)                                                         | Branch claude/t04-budgets-broker-px0108 stacked on T03; migration 3; evidence/t04/verification.json; 61/61 tests incl. 8 concurrent calls against a 3-call envelope, denied calls with zero adapter calls, late result settled once, duplicate deliveries dispatching once, rate-limit retry, cancellation, lost worker, overrun                                                                                                                                                                                                                                              | Merged (PR #5); live call needs a key, a spend grant and an owner request; Windows untested                                                                                                                                                                                             |
| T05 | Durable bounded orchestration and recovery                 | verified (cloud Linux, PostgreSQL 16.15; fixture only)                                                                      | Branch claude/t05-t1b785 from main at f51530f; migration 4; ADR-0008 (PostgreSQL instead of Temporal); evidence/t05/verification.json; 72/72 tests incl. restart with killed worker and API processes, duplicate task delivery and duplicate outbox wake-up, waiting on two decisions, stale-worker commit refused, cancellation with held exposure, autonomous needs_human, bounded repair, pause/resume                                                                                                                                                                     | Merged (PR #6); Windows untested; CI still runs only `pnpm check`                                                                                                                                                                                                                       |
| T06 | Source ingestion, claim support, and research boundaries   | verified (cloud Linux, PostgreSQL 16.15; fixture and loopback contract only)                                                | Branch claude/t06-sources-claims-ogwzbb from main at da976c7; migration 5; ADR-0009; evidence/t06/verification.json; 91/91 tests incl. supporting and non-supporting passages, fabricated quotes refused, repost cluster vs independent contrary source, changed version invalidating support, 403 and 410 pages, redirects to 169.254.169.254 / an intranet address / http, injected instructions with no grant/decision/policy/fetch change, byte/time/type/hash-only limits, approve-once per URL, no fixture fallback, concurrent fetch, sweep of lost fetches, redaction | Owner review; no live search adapter; live fetch unverified against real sites; T05 workflow roles do not call the broker yet; Windows untested; merged as PR #7                                                                                                                        |
| T07 | Locator and competing response generation                  | verified (cloud Linux, PostgreSQL 16.15; fixture model only)                                                                | Branch claude/t07-locator-responses-nyj7cq from main at 5a07713; migration 6; ADR-0010; evidence/t07/verification.json; 104/104 tests incl. cross-field locator, a known duplicate, software not recommended when an existing tool fits, a software-suitable candidate after one revision, insufficient evidence stopping after the locator, proposal independence from provider inputs, repairs of out-of-packet refs and names-only mechanisms, revision cap 0 with dissent, changed claim versions                                                                         | Owner review; no live model run; locator does not search; duplicate detection is word overlap; starting a discovery run has no web form (API/CLI); Windows untested; next eligible T08                                                                                                  |
| T08 | Versioned scoring, selection, and frozen specifications    | verified (cloud Linux, PostgreSQL 16.15; fixture reviewers only)                                                            | Branch claude/t08-aq72aq from main at df04354; migration 7; ADR-0011; evidence/t08/verification.json; 117/117 tests incl. exact scores, unknowns kept as bounds, ties and reviewer disagreement, sensitivity, override with original ranking retained, gates that no score clears, no build-ready non-code response, a gate closing after selection stops the freeze, spec revision invalidating changed tasks and the earlier approval, cycles and ownership conflicts, replaced selections, autonomous runs with and without a grant                                        | Owner review; no model assessor role; selecting does not move a product stage; selecting and freezing have no web form (API/CLI); Windows untested; next eligible T09                                                                                                                   |
| T09 | Usable catalog, decisions, search, and run monitor         | verified (cloud Linux, PostgreSQL 16.15; fixture workspace in headless Chromium)                                            | Branch claude/t09-catalog-monitor-ml1t89 from main at bba9e9a; migration 8; ADR-0012; evidence/t09/verification.json; 122/122 tests incl. search permissions before snippets and counts, redaction, id and prefix search, activity paging and validation, comparison assumptions; 12-step browser acceptance run with screenshots                                                                                                                                                                                                                                             | Owner review; fixture model and reviewers only; search is lexical (no semantic search, X03); lineage traversal bounded at 8 hops with no graph view; no product stages exist yet so stage and task views show empty states; Windows and real screen readers untested; next eligible T10 |
| T10 | Study runner and human-only workflow                       | verified (Windows, PostgreSQL 18.6; synthetic only)                                                                         | Branch codex/t10-study-runner from a9edf68 (T09 merged PR #10); migration 9; ADR-0013; evidence/t10/verification.json; 130/130 DB tests, check, smoke, CLI/API export and headless Edge acceptance                                                                                                                                                                                                                                                                                                                                                                            | Merged PR #12 at 5f9bb1b; no empirical study or live AI; study-arm implementation integration remains separate from the T11 owner CLI                                                                                                                                                   |
| T11 | Isolated execution and local product Git                   | verified (Windows + WSL2; reviewed synthetic template)                                                                      | Branch codex/t11-isolated-execution from 5f9bb1b; ADR-0014; evidence/t11/verification.json and source manifest; 140/140 DB + real isolation, check, smoke, CLI/API admission                                                                                                                                                                                                                                                                                                                                                                                                  | Owner review/merge; fixed offline Python recipe; no model builder/independent QA, catalog indexing, dedicated appliance or persistent preview; T12 next on request                                                                                                                      |
| T12 | Bounded builder, independent review, and QA                | verified (Windows + WSL2; fixed synthetic roles)                                                                            | Branch codex/t12-bounded-builder; ADR-0016; evidence/t12; 149/149 DB + real isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Merged PR #14 at 6fe5bab                                                                                                                                                                                                                                                                |
| T13 | Verified artifacts, private preview, and feedback revision | verified (Windows + WSL2; synthetic fixture roles)                                                                          | Branch claude/t13-8h288j from 6fe5bab; migration 10; ADR-0017; evidence/t13; real WSL2 gate 155 pass / 1 expected skip; cloud 146 pass / 10 WSL skips; 13-step browser walkthrough                                                                                                                                                                                                                                                                                                                                                                                            | Merged PR #15 at b035d99; CLI-only runnable demo, no native installer, web-app preview or public release; next eligible T14 on request                                                                                                                                                  |
| T14 | Pilot, rubric calibration, and protocol freeze             | partial (cloud Linux, PostgreSQL 16; fixture pilot rehearsal, protocol proposed not adopted)                                | Branch claude/project-thread-ocgg8g from e46b2cf; ADR-0019; evidence/t14; 154 pass / 10 WSL skips; pilot 16 pass, 1 warn                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Owner research decisions RD1-RD10, then freeze; live AI pilot, human pilot and reviewer calibration not run                                                                                                                                                                             |
| T15 | Final evaluation and blinded rating package                | partial (cloud Linux, PostgreSQL 16; machinery, rehearsal, final-record gate, budget ledger and study builds; no final run) | Branch claude/t15-hdrwqz from 3f3544a; ADR-0021, ADR-0022; migration 11; evidence/t15; 167 pass / 11 WSL skips; rehearsal 10/10 checks                                                                                                                                                                                                                                                                                                                                                                                                                                        | Protocol freeze (RD1-RD10) with participants, reviewers, IRB and final tasks answered; verified live model id and spend authorization (RD6); final build tasks frozen with held-out cases; WSL2 gate for study builds                                                                   |
| T16 | Reproducible analysis and limits                           | partial (pipeline only; empirical blocked)                                                                                  | Branch claude/t16-analysis-95avhe; ADR-0023; `pnpm analyze`; docs/ANALYSIS.md; evidence/t16 (3 synthetic fixtures, real rehearsal package, 187 tests / 176 pass / 11 WSL skips)                                                                                                                                                                                                                                                                                                                                                                                               | Real T15 final runs under an adopted freeze, reviewer ratings (RD4), a decision acceptance rule, owner coding of intervention necessity                                                                                                                                                 |
| T17 | Failure recovery, boundary checks, and requirements audit  | verified (cloud Linux, PostgreSQL 16.15; Jordan's Windows/WSL2 gate 167 pass, 1 expected skip)                              | Branch claude/project-thread-k4si82 from e46b2cf; ADR-0020; evidence/t17 (requirements-to-evidence report, verification.json); backup → restore → real API on the restored copy; audit items 4, 5 and 7 and a silent workflow heartbeat failure fixed with reproduced failures                                                                                                                                                                                                                                                                                                | `pnpm backup` CLI not run by hand on Windows; overrun guard not serialized against a concurrent settle; no member-removal path; no live end-to-end run                                                                                                                                  |
| T18 | Thesis, committee review, and defense preparation          | planned                                                                                                                     | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T16 and T17, or documented missing-data limits                                                                                                                                                                                                                                          |
| T19 | Final thesis acceptance and reproducibility archive        | planned                                                                                                                     | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T18                                                                                                                                                                                                                                                                                     |
| X01 | Model registry and qualified automatic routing             | partial (cloud Linux, PostgreSQL 16; fixture-verified routing machinery)                                                    | Branch claude/x01-qfktko from 8c09748; migration 12; ADR-0024; docs/MODEL_ROUTING.md; evidence/x01; 198 tests / 187 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                       | Measured task outcomes (T15) to qualify real models; verified gpt-6-astra id; routing used by workflow/study/builder paths; web UI                                                                                                                                                      |
| X02 | Context selection, caching, compaction, and batches        | partial (cloud Linux, PostgreSQL 16; fixture-verified)                                                                      | Branch claude/x02-b3wzes from c738369; migration 13; ADR-0025; docs/CONTEXT_AND_CACHING.md; evidence/x02; 212 tests / 201 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                 | Live verification of gpt-6-astra prompt caching and batch (owner-authorized call); provider compaction adapter; packs/cache used by workflow, study and builder paths; web UI                                                                                                           |
| X03 | Comprehensive search, lineage, and audit questions         | partial (cloud Linux, PostgreSQL 16; fixture-verified)                                                                      | Branch claude/x03-s7po1x from d2c8ef1; migration 14; ADR-0026; docs/SEARCH_AND_AUDIT.md; evidence/x03; 219 tests / 208 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verified real embedding model (owner decision, accessible id, pricing, data-class approval); live model compile check; web UI for questions, saved queries and lineage graphs; per-record access control if ever needed                                                                 |
| X04 | Scoped GitHub management                                   | partial (cloud Linux, PostgreSQL 16; fixture GitHub and loopback contracts)                                                 | Branch claude/x04-gm7n32 from d2c8ef1; migration 15; ADR-0027; docs/GITHUB.md; evidence/x04; 221 tests / 210 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                              | Owner-created GitHub App or fine-grained token, CREATOR_GITHUB=live, grants and a live verification; webhook forwarder; releases and settings; web UI                                                                                                                                   |
| X05 | Windows desktop and paired local workers                   | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13                                                                                                                                                                                                                                                                                     |
| X06 | Hosted operation and observability                         | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T17; X05 only for hosted-to-local pairing                                                                                                                                                                                                                                               |
| X07 | Payments, entitlements, revenue and reinvestment           | partial (cloud Linux, PostgreSQL 16; fixture processor and Stripe contract double)                                          | Branch claude/x07-5zm23m from 4fe3d33; migration 19; ADR-0033; docs/PAYMENTS.md; evidence/x07                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner choice of processor and live activation; a Stripe test account and keys for a real test-mode check; webhook forwarder; web UI                                                                                                                                                     |
| X08 | Evidence-backed marketing and measured feedback            | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13; X06/X07 only where distribution/payment requires them                                                                                                                                                                                                                              |
| X09 | Portfolio scheduling, maintenance, and reusable knowledge  | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13; X01/X07/X08 for their enabled features                                                                                                                                                                                                                                             |
| X10 | Full-product acceptance and bounded owner pilot            | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Applicable X01–X09 gates                                                                                                                                                                                                                                                                |

Requirement-level evidence: the T17 audit lists every C01–C51 status with evidence in [evidence/t17/REQUIREMENTS_EVIDENCE.md](evidence/t17/REQUIREMENTS_EVIDENCE.md). No requirement is pre-marked complete.

## T00 checks and limitations

- `git ls-remote --symref https://github.com/jordanprice040/CreatorAI.git`: exit 0, no advertised refs at 2026-10-18T03:26:37Z (October 17 locally). [Saved result](evidence/t00/remote-refs.json).
- Initial Git status/remote checks failed because this was not a Git working tree. `git init -b main` and local `git remote add origin ...` subsequently succeeded. No staging, commit, push or remote provisioning. Config writing required sandbox escalation.
- Initial restricted remote lookup failed with `getaddrinfo() thread failed to start`; approved retry succeeded. No application defect is inferred from that sandbox failure.
- `& ./tracking/evidence/t00/verify-starting-point.ps1` succeeded: inventoried files, Git state, tools, absent manifests/application paths; all five template JSON files parsed. Parsing is not runtime-schema validation.
- Before edits, 30/31 original manifest entries matched; CLAUDE.md differed and was preserved. [Input hashes](evidence/t00/input-kit-hashes.json) distinguish existing bytes from T00 changes. [Final hashes](evidence/t00/final-files.sha256) identify the completed uncommitted candidate, excluding that manifest itself and .git/.
- Version commands succeeded: Git 2.45.1.windows.1, Node v22.21.0, pnpm 11.25.0, npm 10.9.4, Python 3.13.0, gh 2.98.0. PowerShell 7.6.6. These are observations, not a tested application dependency combination.
- Docker, psql and Temporal CLIs were not on PATH. No endpoint, provider account, credential, pricing, CI run or deployment was tested. No application build/test/start command exists, so an application baseline is not applicable.

T00 acceptance covered inventory, path/dependency ADR, baseline evidence and next step only. Its evidence remains historical and unchanged. No paid calls, generated products, research trials or external activation occurred.

## T01 acceptance and evidence

- Actual paths: packages/contracts, packages/domain, apps/api, apps/cli, apps/web, tests, scripts, config and docs. No empty future packages. Direct dependencies pinned and pnpm-lock.yaml checked in the working tree (not yet Git committed). Strict TypeScript, configuration validation and formatting commands work.
- Runtime schema 1.0 covers task/result, run config, source/claim, alternative, assumption, decision request, cost, entity links and experiment assignment. Invalid/unknown fields and versions fail. Decimal-string nano-USD preserves exact amounts; unknown costs are distinct.
- Pure domain checks reject stale versions/candidate evidence, invalid transitions, unsafe child allocations/paths and mismatched results. Product lifecycle, execution state, research condition and discovery method are distinct. Nonsoftware/existing-tool/human-led/hybrid/deferred/failed dispositions are supported.
- Provider admission rejects missing caps, expired scope, human-only dispatch and all live requests. The deterministic fixture has no network/tools/paid route. Structural live configuration validation is not authorization; real grants, atomic reservations and services remain later milestones.
- Fresh source-only directory: frozen offline-cache install, build, typecheck, 20 contract/domain/HTTP/CLI tests and formatting all passed. [Clean log](evidence/t01/clean-verification.log). Separate Node 24.19.0 execution: [20 passing tests](evidence/t01/node24-tests.log). Main baseline uses Node 22.21.0; pnpm 11.25.0 itself uses bundled Node 24.19.0 on this machine.
- Built-web preview → API proxy health and fixture POST passed: [smoke log](evidence/t01/smoke.log). Browser verified visible health, existing-tool/process-change/failure outcomes and whitespace-input disablement; final process-change result captured in [state](evidence/t01/browser-state.txt) and [screenshot](evidence/t01/browser-fixture.png).
- Honest limitations: no persistence/audit outbox, authentication/grant store, atomic budget broker, workflow engine, worker isolation, genuine evidence verification, independent review service or study execution. Pure rules consume trusted state/evidence; accepting a schema does not authenticate an actor or prove a claim. No CI/remote deployment verification was performed.

| Requirement | Current status | T01 evidence / remaining gate                                                                                                                        |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| C10–C11     | partial        | Non-code outcomes and assumption/disconfirmation contracts; real humility/discovery gates remain T03/T07–T08                                         |
| C13–C16     | partial        | Separate mode/condition schemas, scope checks and human-only provider denial; authenticated grants/study runner remain T03/T10                       |
| C20–C23     | partial        | Version/spec/result binding, delegation validation, lifecycle evidence requirements; no task scheduler, persistence or independent reviewer yet      |
| C28–C29     | partial        | Exact-money/sibling allocation checks, finite limits and terminal cancellation transitions; atomic reservation/cancellation execution remain T04–T05 |
| C32         | partial        | Usable local API/CLI/web fixture; persistent usable control remains T02/T05/T17                                                                      |
| C35         | partial        | Thin real health/fixture UI with empty/error states; full catalog/controls remain T09                                                                |
| C49         | partial        | Visible fixture labels and separate implementation/contract/live status; real adapters remain unverified                                             |

T02–T19 remain planned; X01–X10 remain deferred. No full requirement or product completion is inferred from the T01 gate. Next: T02 only after a new request. (T02 since completed; see below.)

## T02 acceptance and evidence

- New package `packages/db` (node-postgres `pg` 8.23.1): one immutable migration (checksum-verified, advisory-locked), a startup schema gate, and a `Store` repository. Tables: actors, workspaces/members (owner/editor/viewer), entities with immutable `entity_versions`, typed `entity_links` bound to exact endpoint versions, `audit_events` (database-sequenced, hash-chained), `outbox`, `consumer_inbox`, `history_projection`, `command_receipts`.
- Stored kinds: source, claim, problem, idea, alternative, assessment, product, specification, run, task, decision, grant, artifact. Bodies are strict Zod schemas capped at 16 KiB; artifacts and sources hold URIs and hashes, not content. Product stage and run/task state are stored at their initial value and generic revisions cannot move them.
- Fixture separation: a workspace is `fixture` or `real`; a composite foreign key keeps fixture records out of real workspaces. Cross-workspace links fail in code (`SCOPE_EXCEEDED`) and in the schema.
- Every mutation commits record + version + audit event + outbox row in one transaction. Audit payloads carry ids, kinds, versions, hashes and enums only. Corrections append a version that names the corrected one; links are retracted, not deleted; triggers reject edits/deletes of audit events and versions except redaction, which blanks titles/bodies/reasons and leaves identity, versions, hashes, links and audit intact.
- API record routes, CLI commands (`workspaces`, `create`, `show`, `list`, `revise`, `archive`, `link`, `lineage`, `history`, `seed-lineage`) and a read-only web Records panel. Lineage walks typed links by provenance direction (many-to-many, not parent IDs).
- Checks executed: see [verification.json](evidence/t02/verification.json), [with-database log](evidence/t02/test-db.log), [without-database log](evidence/t02/check-without-db.log), [browser screenshot](evidence/t02/browser-records.png).
- Limitations: no authentication (API acts as one configured local owner; repository role checks are real but the actor is asserted); global advisory lock serializes writes for the hash chain (fine locally, revisit for hosted use); hash chain is tamper-evident only against parties who do not also rewrite later hashes (the table owner can); content hashes of redacted records remain and could be guessed for very short bodies; no search beyond lineage/history; Windows PostgreSQL path untested; schema 1.0 extended additively (ADR-0005).

| Requirement | Current status | T02 evidence / remaining gate                                                                        |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| C32         | partial        | Records persist across real API restart; usable control/orchestration remains T05/T17                |
| C20–C23     | partial        | Version-bound links and optimistic versions persist; scheduler and independent review remain T05/T12 |

## T03 acceptance and evidence

- Sessions: `/api/auth/dev-login`, `/api/auth/oidc/login|callback`, `/api/auth/session`, `/api/auth/logout`. Record, decision, grant and run routes resolve the actor from the session; 401 without one, 403 `CSRF_DENIED` without the session's token, 403 for foreign origins. OIDC attempts are single use and admit only `CREATOR_OIDC_OWNER_SUBJECT`.
- Decisions and grants: migration 2 tables `run_controls`, `grants`/`grant_versions`, `decision_requests`, `action_admissions`, `auth_sessions`, `oidc_logins`, all audited through the T02 hash chain; run controls, grant versions, decisions and admissions reject deletes (and edits where immutable).
- Acceptance cases executed (tests/src/oversight*.test.ts, auth-api.test.ts): changed target supersedes an open approval and denies stale-version actions; expired requests and grants stop authorizing; cancellation closes pending decisions, revokes run grants and denies later actions; duplicate requests return the open one, identical answers replay, conflicting and concurrent answers have one winner; autonomous runs defer as `needs_human`, cannot request help and ignore later grants; human-only runs are denied model calls despite a grant; a covered routine reversible action proceeds three times with no decision; agents cannot answer or create grants; build commitment needs the humility gate, then an ethics judgment, then an exact approval.
- Browser: sign-in via login link, pending judgment and authorization cards, standing-policy preview, approve once, answered view, no horizontal overflow at 390 px ([log](evidence/t03/browser-check.log), [screenshot](evidence/t03/browser-decisions.png)).
- Limitations: admission is called by the owner via API/CLI until T05 adds an orchestrator; no budget exposure check (T04); single owner (no editor/agent sessions); OIDC verified with a local test provider only; Windows untested; schema 1.0 extended additively (new kinds `assumption`, `humility_review`, error codes `UNAUTHENTICATED`, `CSRF_DENIED`).

| Requirement | Current status | T03 evidence / remaining gate                                                                           |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| C10–C11     | partial        | Humility gate and assumption records enforced at build commitment; discovery-side use remains T07–T08   |
| C13–C16     | partial        | Authenticated owner, versioned grants, mode enforcement and decision requests; study runner remains T10 |

## T04 acceptance and evidence

- New package `packages/broker`: `ModelBroker`, `FixtureAdapter` (no network, simulated units) and `OpenAIAdapter` (POST /v1/responses via `fetch`, `store: false`, key held only in the API process). `packages/domain/src/budget.ts` holds exact BigInt pricing: exposure bound (UTF-8 bytes + framing at the highest input rate, max output at the output rate, documented long-context surcharge) and usage cost in disjoint categories (uncached, cached, cache-write input; output including reasoning, never added twice; per-call tools).
- Migration 3: `pricing_snapshots` (immutable), `budget_envelopes` (cap/allocated/reserved/unknown/incurred, a check constraint that rejects overspend, immutable identity and cap), `budget_reservations` (one row per attempt or denial; legal transitions enforced by trigger; unique dispatched attempt per logical operation), `usage_records` (unique per attempt: no duplicate charge), `budget_journal` (every balance movement; tests re-derive balances from it).
- Admission order follows HUMAN_OVERSIGHT.md: non-delegable run state, pricing and exposure, envelope scope/window/concurrency/balance, then T03 grants/mode/stage gates with the bound amount, then the reservation, all in one transaction. A denial records a reason and reserves nothing; a needs-human outcome creates an authorization decision for the exact amount.
- Acceptance gate, executed: concurrent reservations cannot overspend (8 parallel calls, room for 3: 3 dispatched, 5 `budget_exceeded`; the database also refuses a direct overspend); a denied call never reaches the provider (human-only, cancelled, missing pricing, unpriced tool, budget, envelope scope, expired period, no grant, autonomous without grant, model limit, real workspace without live adapter: adapter calls 0); late results reconcile without duplicate charge (timeout → unknown held → late answer settles once; repeated late delivery changes nothing; replay returns stored output without a second call). Also: rate-limit release and retry, malformed output charged, provider error held then owner-reconciled, cancellation in flight keeps exposure, lost worker becomes unknown, child conservation and rollup without double counting, overrun recorded honestly and then blocking.
- Live: no call. `gpt-6-astra` id, pricing and Responses usage semantics were read from OpenAI's official pages on 2026-10-18; no key exists in this environment and no spend grant was requested. The adapter is contract-tested against a loopback server.
- Limitations: retries under an approve-once grant need a fresh approval (the grant is single-use); only text input is bounded (no images/files); OpenAI embeddings and tool calls are not implemented (refused before dispatch); compute/sandbox costs belong to T11; reconciliation of unknown outcomes is manual; the broker is called by the owner via API/CLI/web until T05 adds an orchestrator.

| Requirement | Current status                      | T04 evidence / remaining gate                                                                                                                                                                                        |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C27         | partial                             | Reservation, settlement and denial events with amounts and reason codes in the audit chain and history; X03 adds per-run and per-subject cost questions with supporting reservation and usage ids (fixture-verified) |
| C28         | partial (fixture/contract verified) | Atomic reservations, carve-out conservation, unknown ≠ zero, journal re-derivation; live billing reconciliation unverified                                                                                           |
| C34         | partial                             | Token bounds and accounting per call; task-specific context selection remains T05                                                                                                                                    |

## T09 acceptance and evidence

- Interface: `apps/web/src/main.tsx` shell with skip link, labelled view navigation (`aria-current`), workspace picker and FIXTURE MODE banner; shared pieces in `ui.tsx` (routing, `useLoad`, loading/empty/error states, actor names, snippets) take plain props so a desktop shell can reuse them. Each view only offers actions the API supports for the current role; viewers see read-only text.
- Server: `packages/db/src/catalog-store.ts` (search, activity, actors, overview, comparison), contracts in `packages/contracts/src/catalog.ts`, migration 8 GIN text-search indexes. Search and activity drain the audit outbox first so a just-made change is findable.
- Acceptance gate, executed in headless Chromium against `vite preview` and the API on a database seeded with `pnpm cli seed-selection` ([script](evidence/t09/browser-acceptance.mjs), [results](evidence/t09/browser-acceptance.json), screenshots 01–17): submit a theme with two claims and a new human-in-the-loop run → the run finishes on the server and shows on the Monitor after reload → open the claim's passages from Compare → five alternatives side by side → record a selection, which the supervised gate turns into a decision; approve it in Decisions, submit again, recorded and still shown after reload → search “no-show” (highlighted record, passage and activity hits), an 8-character id prefix, the activity log filtered to selections and “Answered decision” → a 0.000001 budget refuses a call before sending (`budget_exceeded`) → revoking the run's standing model permission makes the next call `needs_human (outside_grant)` and shows “Revoked standing grant” in Activity → the Gallery has no download or preview control → no horizontal overflow at 390 px on Monitor or Compare. No console errors.
- Defects found by inspecting screenshots and repaired: raw validation messages shown before any input, the navigation centred vertically, a problem picker overflowing phone width, the Monitor not updating while a workflow ran, activity and search links for grants that opened a failing page, a missing workflow id in the run detail, old numbered panel labels and a favicon 404.
- Database tests (`tests/src/catalog.test.ts`): non-members get NOT_FOUND for search, activity, overview, actors and comparison; viewers can search; another workspace's records are never counted; redaction removes text from search; a redacted source drops its passages; actor names, paging, action filter and validation; overview counts and a cancelled run; comparison includes run-level assumptions.
- Limitations: lexical search only; snippets come from PostgreSQL `ts_headline`; lineage depth is capped at 8 and shown as a list; product stages, tasks and artifacts are empty until T11–T13; Windows, real assistive technology and contrast measurement tools were not run (colours were chosen against WCAG AA by hand, not measured).

| Requirement | Current status             | T09 evidence / remaining gate                                                                                                                                                                                                                                                    |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C26         | partial                    | Full-text, exact-id and filtered search with bounded lineage; X03 adds code-version, model and cost search, source-to-product questions, lineage graphs and verified exports (fixture-verified; semantic search refused in real workspaces until an embedding model is verified) |
| C31         | partial                    | Membership checked before snippets and aggregates (search, coverage, questions, semantic candidates, lineage, exports); redacted text unsearchable and tombstoned; lineage exports flag redactions since export; member removal verified (fixture)                               |
| C35         | partial (fixture-verified) | Browser paths over real state with keyboard, empty/error and permission cases; product, task and gallery views wait for T11–T13                                                                                                                                                  |

## T11 acceptance and evidence

- Actual owner path: CLI authenticates to existing HTTP API, checks workspace owner and current active frozen T08 specification/body/content/task hashes, then manages a separate local product repo and real constrained worker. No generic remote command endpoint or generated-code host execution was added. Studio schema remains 9. The local provenance store is not the PostgreSQL audit chain or web catalog.
- Real worker checks: harmless compilation/entry point; non-root/no capabilities/no new privileges; secret/home/Windows/daemon/D-Bus/Git/symlink escape and writes to input/root/dev denied; metadata/public/loopback network denied with a different network namespace; observed CPU/memory/swap/task/runtime controls; actual disk/memory/process/output/runtime limits; cancellation of a detached signal-ignoring child; killed supervisor, lease expiry and explicit no-redispatch reconciliation; missing distribution blocked with no fallback. Snapshot workspaces are disposed only after observed unit cleanup.
- Real Git checks: separate repos/worktrees, exact bases, scoped CAS writes, traversal/reserved-name/alternate-stream/link rejection, dirty and stale work preserved, one owner, non-destructive conflict workspace, and immutable task/commit/file lineage. One worker per products root, exclusive locks never stolen by elapsed time, durable uncertain-dispatch fence.
- Tests: 140/140 with PostgreSQL 18.6 + opt-in WSL2; pnpm check 63 pass/77 explicitly skipped without DB/isolation; frozen install, smoke and scripts/verify-executor.mjs pass. Evidence includes final logs, synthetic CLI result, source manifest and self-review repairs. No browser/UI claim is made for this CLI-only addition.
- Limits: fixed reviewed Python stdlib recipe in existing WSL2, not a newly dedicated worker appliance; no seccomp allowlist; local owner-controlled evidence not yet catalog indexed; manual inspection for Git-side crash recovery; costs not monetarily metered; success is conventional build completion rather than independent acceptance. T12 adds runtime builder/review/QA; T13 adds artifact/private preview paths; T17 audits broader workloads.

| Requirement | Current status                                     | T11 evidence / remaining gate                                                                                                           |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C30         | partial (real reviewed-template boundary verified) | Namespace, mount, network, resource, lease, tree-cancellation and cleanup gates passed; broader-hostile-workload audit T17              |
| C33         | verified local owner path                          | Separate repo/task/review worktrees, frozen task-to-commit lineage and preserved conflicts; catalog/runtime integration remains T12–T13 |

## X05 — independent desktop first slice (October 19, 2026)

Owner authorized starting X05 while Claude Code works on X03/X04. Prompt-library
prerequisite is T13 only. Owner reports X01/X02 complete; their source is not in
this checkout, and their acceptance was not reverified. Existing dirty changes
were preserved. All application changes are new files under apps/desktop; no API,
database, shared contract/UI, package manifest or lockfile edits were made.

Added a Tauri 2 shell source displaying the existing local shared web UI/API proxy
at the default port, with same-origin navigation restriction and no native IPC
commands/plugins/capabilities. Direct Rust dependencies pinned from official docs.
Native build/startup is unverified: cargo/rustc absent; MSVC/WebView2 not checked;
Cargo.lock, packaging and updater verification remain outstanding.

Added executable local source-archive import/inspection CLI. Shared T13 manifest
schema, separately supplied workspace/artifact/manifest hash, bounded archive
hash/size and per-file inventory are checked. Reuses strict executor ustar/path
validation. Unique pending-to-published entries, synced writes, dated read-only
receipts, concurrent import isolation and re-read tamper detection are implemented.
Cache receipts grant no authority, do not promote blocked/fixture manifests and
require online revalidation. No extraction, editor/launch or worker dispatch.

Executed node node_modules/typescript/bin/tsc -b successfully. Final focused Windows
suite: 3 tests pass, 0 fail/skip, including real CLI inspect, spaces, concurrent
imports, wrong identity/hash/inventory, tampering, oversized input and junction
rejection. Evidence: tracking/evidence/x05/artifact-cache-test.log. Initial fixture
used uppercase filename refused by the existing portable-path contract; fixed the
fixture. Sandbox junction creation was denied; authorized unrestricted rerun passed.
Prettier checked desktop JS/JSON/Markdown; git diff --check passed. The pnpm wrapper
stalled without output and was interrupted; installed Node CLIs performed build
and formatting directly. No full-suite, browser or native Tauri gate was run.

X05 is PARTIAL, not accepted. System-browser session handoff, durable paired device
identity/challenges, outbound scoped worker leases, revoke/pause/shutdown, native
source download/editor opening/isolated launch and installer/update acceptance
remain. Those API/database/shared UI changes are intentionally pending coordination
with X03/X04. Next eligible prompt: continue X05, not X06.
