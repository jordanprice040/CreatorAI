# Session handoff

## Completion runbook §2.1 — installed desktop studio (October 20, 2026)

Branch claude/project-thread-b82rw9 from main 54ce751; ADR-0041; no migration (next free: migration 25, ADR-0042). Guide: docs/DESKTOP_STUDIO.md. Evidence: tracking/evidence/desktop-2-1.

Works: per-user NSIS install; launch from Start starts the whole studio without terminals, pnpm, dev server or checkout. Tauri supervisor owns one bundled Node service (production UI 5173, API with in-process workflow worker 4310, previews 4320) and, in managed mode, an app-owned PostgreSQL 18 cluster in %LOCALAPPDATA%\com.creatoragent.studio, using owner-installed PostgreSQL 18 binaries (verified prerequisite, not bundled). External mode reuses an existing loopback server and never starts or stops it. Listener ownership is HMAC-verified per launch before the window opens; single instance per home; job object; bounded restarts (3/10 min) and health watchdog; graceful Quit stops service then database. First-run setup window: adopt the §1.2 studio (T17 backup → restore into the app cluster → full restore check before saving; source only read), external connection, or explicitly labelled new studio; failed setup removes only what it created. Owner-approved, backed-up migrations. DPAPI-protected database secret and persisted local-owner sign-in (per-launch code never shown; revalidated each launch; revoked on sign-out). Close = quit (default) or background with tray; launch-at-login off unless toggled (HKCU Run only). Remote studio UI has no native IPC; control commands scoped to the bundled window. Child gets a minimal environment, so no live provider/key can leak in.

Executed: tsc build and web typecheck; studio service protocol tests 7/7 against source and against the installed bundle (disposable PostgreSQL 18): new studio, serve, sign-in, record survives quit/relaunch, stale code refused, sign-out revocation, port conflict, unreachable DB, backed-up upgrade 23→24, adoption with untouched source. Rust 16 pass/1 ignored (DPAPI round trip, config, HMAC RFC 4231, URLs, copy). Release build and NSIS installer built and installed silently. Scripted installed-app run 17/17 PASS: read-only adoption of the real creator_studio (Jordan’s Creator Studio, audit chain ok) into an isolated acceptance home; cold launch running in ~2 s; health/UI/previews; one owned service child; duplicate launch hands off; service crash restarted; WM_CLOSE quit stops service and database; relaunch; supervisor crash leaves no orphan and database is reused; foreign listener on 5173 and missing PostgreSQL folder give actionable failures. Two earlier failed runs retained (verbatim `\\?\` resource path broke Node; harness path matching).

Limitations: screen control was declined, so setup-window clicks, menu sign-in, creating a record in the window, tray/background and login toggles, and Windows restart are NOT executed natively (service-level equivalents pass). The agent shell runs inside the Claude desktop package, whose AppData writes are virtualized, so its install landed in the package's LocalCache: Jordan must install from the setup .exe himself. Paired execution worker identity still in memory (ADR-0028). Unsigned local build; NSIS tools downloaded by the Tauri CLI with hash validation. Bundled Node is the build host's v22.21.0. §2.1 is not complete until Jordan's interactive acceptance passes. Next eligible after that: §2.2 (new request).


## Codex audit repairs — October 20, 2026

Use C:/dev/creator_agent going forward, per Jordan. Clean checkout updated to main 1cf6d63; this session's repair patch was moved from OneDrive to codex/audit-boundary-fixes without deleting the old copy. Audit PR #40 is merged. Read docs/AUDIT_FIXES_2026-10-20.md and ADR-0040. Migration 24; next free migration 25 and ADR-0041.

Four findings repaired. QA mount contains only argv/stdin; bridge rejects full/legacy records. Invalid payment signatures create no durable receipt. Processor reads release DB connections, then apply only the latest connection epoch under short financial locks; conflicting webhooks defer with 503. Batch parser limits bytes/lines/records; file IDs journal before use, deletion follows durable terminal reconciliation, and polls retry failed cleanup. Forty-eight-hour provider expiry bounds abandoned files; missing results retain unknown exposure.

Verified: full pnpm check 302 tests / 287 pass / 0 fail / 15 skips; typecheck/format clean. Real WSL QA secrecy 1/1; final context 18/18 and uppercase audit-chain case 1/1; final API/cleanup regressions 3/3. Build/smoke pass; readiness honestly not_ready (exit 3, no inconsistencies). Intermediate failed runs retained and explained in the repair report. Migrations 1–23 checksum-identical; only disposable databases migrated to 24.

No existing studio database migration, real provider call, spending, outreach or activation. Reverify old artifacts after bridge hash changes. The OneDrive copy still contains the unfinished patch and should not be used for further work. Next eligible: U02 candidate review; do not start another milestone automatically.


## Owner decisions 2026-10-20 (October 20, 2026)

Branch `claude/audit-full-qgjinb` from main `fc1e83f`; migration 23, ADR-0039. Next free
numbers: migration 24, ADR-0040. Read docs/OWNER_DECISIONS_2026-10-20.md. Raising the $20
runtime ceiling is a reviewed edit of config/spending.json with Jordan's recorded approval.
Jordan still has to run scripts/move-out-of-onedrive.ps1 on his machine; it has not run yet.

## Audit 2026-10-20 fixes (October 20, 2026)

Branch `claude/audit-full-qgjinb` from main `051a9bb`. Report in the project files at
audits/2026-10-20-codebase-audit.md. Next free numbers unchanged: migration 23, ADR-0039.
X08/X09 entries below were merged via PR #34 (local audit fixes via PR #35); ignore their
"uncommitted" wording. Before enabling `CREATOR_PORTFOLIO_SCHEDULER=on` or hosting, read
recommendations N1 and N4 in the report.

## X10 readiness, benchmark and pilot gate (October 19, 2026)

Branch `claude/x10-1y6bd6` (Claude Code) from main `a68e9f9`. Read docs/X10_ACCEPTANCE.md
and ADR-0038. Next free numbers: migration 23, ADR-0039.

Keep `config/readiness.json` current: when a milestone or owner action changes a state,
update the row and its evidence, then run `pnpm readiness` (exit 3 = honestly not ready,
2 = register inconsistent). The owner pilot starts only after Jordan fills
`config/owner-pilot.json` and `pnpm readiness pilot-check` passes; set `status: completed`
with evidence afterwards. Benchmark: `pnpm bench <dir>` with CREATOR_BENCH_DATABASE_URL
(creates and drops its own database). Release package: `node scripts/release-archive.mjs`.
The leftover conflict markers in tracking files on main were removed in this branch.


## Local audit fixes published for review — 2026-10-19

Preserves the original checkout while publishing its DNS cancellation, sign-out, stale actor request, and maintenance-health fixes with regression tests. Documentation cleanup and historical local tracking patches are retained. This PR is stacked on X08/X09; X10 is not started. Validation: typecheck, production build, formatting, and 15 focused regression tests passed. PostgreSQL/live activation was not rerun for this audit branch.


## X09 local portfolio acceptance (October 19, 2026)

Branch `codex/x09-portfolio`, parent local X08 commit `64596ef`, in managed
checkout `C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`. Directory
name intentionally unchanged. X08's recorded hashes were checked before the local
commit. No push; X09 is uncommitted. Original X05 dirty work and Claude's separate
UI/UX work preserved.

Read docs/X09_PORTFOLIO.md and ADR-0036. Migration 22 introduces portfolio
policy/lanes/schedules/jobs/health and reviewed versioned knowledge. Shared
admission, broker allocation checks and workflow leasing enforce reserve,
maintenance, backlog and conservation constraints. Stable intents coalesce missed
intervals and fence uncertain dispatchers. Source refresh uses the original source
broker; health uses exact package rehashing; scheduled review uses existing durable
workflows. Cancellation also cancels the schedule's dedicated run.

Knowledge is bounded task data with current provenance and permitted use. Propose,
execute structural regression, review the exact hash, activate and roll back.
Workflow/task bindings retain exact versions. Revocation or stale provenance
blocks queued dispatch; no policy, credential, finance or held-out mutation.
Source/skill truth and output-quality improvements are not inferred from the
structural regression.

Seven focused X09 checks passed without skips, including HTTP/CLI and negative
gates. Final full suite: 270 tests, 256 pass, 0 fail, 14 explicit native/WSL/inverse
backend skips; actual backup/restore passed. See evidence/x09/full-tests.log. Final typecheck,
build, format and whitespace checks passed. Actual isolated Edge verified the
new screen's scheduling, review/activation, pause/resume, cancellation and revoke
flows; 390px viewport has 390px document width. Browser evidence is retained.

Claude integration: add `portfolio.tsx`, merge its import/view case into redesigned
`main.tsx` and the `portfolio` view tuple into `ui.tsx`; preserve the earlier X08
wiring too. No shared CSS or existing public component prop changes. Scoped
tracking entries must be preserved alongside Claude's updates.

Optional polling defaults off (`CREATOR_PORTFOLIO_SCHEDULER=off`). Only manual
fixture passes were executed; no new live model/source integration, spending,
public deployment, outreach, account activation or pilot. Health is archive
integrity only; skills are passive reviewed guidance. Fixed policy budget IDs
require a new workspace for rotation. Existing studio databases were not migrated.
Next eligible: X10 on request, with inherited live/hosted readiness gaps explicit.

## X08 implemented and test-delivery acceptance verified (October 19, 2026)

Worktree: `C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`, branch
`codex/x08-marketing`, from merged main `0dfc6e6`. Changes are uncommitted. The
original X05 checkout and all pre-existing edits are preserved. Jordan reported
that Claude is working on UI/UX; no cross-chat message was sent.

Read docs/X08_MARKETING.md, ADR-0035 and the latest BUILD_STATUS entry. Campaign
content uses closed evidence-backed statements about recorded T13 package checks,
retains fixture labels/limitations, and binds exact audience/experiment/release
to a hash. API/CLI/screen provide human-owner grants, suppression, once-only local
fixture deliveries, reconciliation and measured synthetic feedback. Monetary
adapter exposure is zero; host compute is unmetered. Migration 21 applies only
to disposable test databases this turn.

Final focused checks: 23/23, no skips (X08 + X07 + storage). Broader run: 248 pass,
0 fail, 15 explicit skips (263 total), before final fixture-helper/UI/help edits;
see BUILD_STATUS for scope. Final build and browser flow passed. Narrow-screen
hash overflow repaired; observed final document width equals 390px viewport.
Evidence: tracking/evidence/x08. Initial test/fixture failures remain in logs.

Claude integration: keep the new `apps/web/src/marketing.tsx`; merge only its
import/switch case into redesigned `main.tsx` and the `marketing` view tuple into
`ui.tsx`. No shared CSS or component prop changes. Align the new screen with
Claude's tokens after merging. Backend changes remain in contracts/domain/db/API;
CLI commands are documented in help and docs/X08_MARKETING.md. Tracking additions
are scoped entries; preserve Claude's entries when integrating.

Limits: local fixture sink only; no real addresses, outbound adapter, paid ads,
public unsubscribe endpoint, hosted landing page or validated demand. Missing
native/WSL checks do not block this local test-delivery gate and were not counted
as passes. No paid call, real outreach, release, activation, commit or push.
Next eligible: X09 on owner request; do not advance automatically.

## UX/UI redesign (October 19, 2026)

Branch `claude/ux-ui-handoff-mfarlr` from main `0dfc6e6`; see docs/UX_UI.md and ADR-0037. The
handoff file itself lives only in the owner's local checkout and was read, not committed.

Touched shared web files: `index.html` (theme attribute, boot script), new `public/theme-boot.js`
and `src/theme.ts`, `src/main.tsx` (shell), `src/ui.tsx` (new exports `VIEW_GROUPS`, `viewLabel`,
`viewGroup`, `Icon`; `useRoute().go` gained an optional third `from` view argument), `src/style.css`
(rewritten on tokens; class names kept), `src/desktop.tsx`, `src/operations.tsx`, `src/study.tsx`.
Unchanged: view keys and labels, route hashes, component props, API calls and validation.

For Codex (X08): add new views to `VIEWS` and one `VIEW_GROUPS` group, and build them from the
classes listed in docs/UX_UI.md. If X08 also took ADR-0035, renumber this redesign's entry.

To rerun the browser evidence: start `tracking/evidence/ux-ui/harness.mjs` on an empty migrated
database, then `browser-acceptance.mjs` and `screens.mjs` (commands in docs/UX_UI.md).
Not done: native Tauri check on Windows. Next eligible: X08 (Codex) or the owner's review of this PR.


## X06/X07 audited and repaired (October 19, 2026)

Attached worktree: C:/Users/jorda/.codex/worktrees/x06-x07-audit/creator_agent,
branch codex/x06-x07-audit from merged main 8d44ace. Changes are uncommitted.
Original checkout remains on X05 with all existing local edits preserved.

Read docs/X06_X07_AUDIT.md and the latest BUILD_STATUS entry. ADR-0034 and migration
20 preserve unique Stripe account and processor funding identity. Financial reads
now share the projection transaction's lock, current account/revocation checks and
strict snapshot validation. Regression checks cover stale observations, incomplete
loss histories, currency/partial capture, fee deficits, account drift, rail outages
and nested-budget metrics. Hosted config preparation repairs are not activation.

Final focused PostgreSQL checks: 24/24, no skips. Broader audit suite: 242 pass,
0 fail, 14 skips (256 total), before the last fee-deficit repair; final focused run
covers that change. Final typecheck/build/format/whitespace and Compose config passed.
Evidence and hashes: tracking/evidence/x06-x07-audit. Disposable PostgreSQL 18.6 on
127.0.0.1:55439 stopped after verification; no existing database was migrated.

No Docker daemon, image build, real hosted staging/TLS/OIDC, Stripe API observation
or live commerce. Existing duplicate financial identities block migration pending
explicit reconciliation; do not edit immutable history to bypass it. No paid call,
public release, commit or push. Next eligible: X08 on request, or separately scoped
hosted staging verification. Do not treat the earlier milestone completion prose as
proof of production activation.

## X07 payments, entitlements and reinvestment (October 19, 2026)

Built on branch claude/x07-5zm23m from main 4fe3d33: migration 19, ADR-0033,
docs/PAYMENTS.md, evidence/x07. pnpm check: 243 tests, 230 pass, 0 fail, 13 opt-in
skips. Fixture processor and Stripe contract double only; no processor account, key or
call. Payment connections are confined to fixture workspaces; live mode is not built.
Open owner decisions: which processor (Stripe is a reversible default), whether and when
to activate live payments, and the reinvestment policy values (disabled by default).
Merged main with X06 (migration 18, ADR-0032) into this branch; schema version test
now expects 19.
Next eligible prompt: X08 on request.

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

## RD6 owner choice (October 18, 2026)

Jordan selected GPT-6 Astra with a $20 USD total T15 live budget. Recorded in
docs/PILOT_AND_PROTOCOL.md and tracking/DECISIONS.md. This is a total envelope,
including child work, retries, tools and reviews, not a per-run allowance. Actual
API identifier/access and pricing still need verification; runtime configuration
and the server proposal must reflect the choice before freezing. No code/config
changes, live calls, protocol freeze or tests were performed. Remaining research
decisions still block adoption; next eligible work is completing T14 prerequisites.

## Latest - T16 analysis pipeline, empirical analysis blocked (October 18, 2026)

Claude Code on claude/t16-analysis-95avhe from main 479dba4 (ADR-0023, no migration). T16 is
partial: the pipeline exists, nothing empirical was analyzed. Key code:
packages/domain/src/analysis.ts (`analyze`, `ANALYSIS_PLAN`, `parseRatings`,
`summarizeDifferences`, `weightedKappa`), analysis-report.ts (`renderAnalysis`: CSV, Markdown,
SVG), analysis-fixtures.ts (`mixed`, `zero-accepted`, `all-blocked`), and
packages/orchestrator/src/analysis-files.ts + analyze-main.ts (`pnpm analyze <dir> <out>`,
`pnpm analyze fixtures <out>`). Tests: tests/src/analysis.test.ts (hand-computed fixture
values, tampering, privacy, and a PostgreSQL test that analyzes a real T15 rehearsal package).
Inputs for real results and open items: docs/ANALYSIS.md. `ANALYSIS_PLAN` is an implementation
default to adopt or replace in the freeze; the decision acceptance rule (analysis-options.json)
and intervention-necessity coding have no owner decision yet. Next: the T15 freeze and final
runs, then reviewers' ratings, then `pnpm analyze` on the final folder.

## Latest - T15 prerequisites: final records, budget ledger, study builds (October 18, 2026)

Claude Code on claude/t15-hdrwqz (ADR-0022, migration 11). T15 stays partial: no freeze, no
final run, no live call. Key code: config/evaluation.json and
packages/domain/src/evaluation-config.ts (`finalRecordBlockers`, `evaluationReadiness`);
study-store.ts (gate in `createStudy`, pins in `assignStudy`, `holdBudget`, `freezeIn`);
packages/db/src/study-build-store.ts (`prepareStudyBuild`, `studyBuildState`,
`recordStudyBuild`, `recordStudyCodeCheck`); packages/executor/src/study-build.ts
(`studyBuildPorts`, `runStudyBuild`, `readStudyBuild`, `checkStudyCode`); broker build guard
in budget-store.ts; API `study-attempts/<id>/build|build-record|binding|code-check`; CLI
`study-build`, `study-code`. Tests: tests/src/study-build.test.ts (the WSL2 variant is opt-in
and not yet run on Jordan's machine). `store.evaluation` is a test seam for the gate; the file
is the only real source. Next: Jordan's RD answers and freeze, verified model id, final build
tasks; then run the WSL2 gate.

## Latest - T15 final evaluation machinery (October 18, 2026)

Claude Code on claude/t15-hdrwqz from main 3f3544a (ADR-0021, no migration). The protocol is
still not frozen, so T15 is partial: no final run exists. Key code:
packages/domain/src/evaluation.ts (`buildSchedule`, `admitSlot`, `flowTable`,
`retryPermitted`, `blindedPackets`, `scanBlinding`, `rehearsalFreeze`),
packages/orchestrator/src/evaluation.ts and evaluate-main.ts (`pnpm evaluate rehearsal <dir>`,
`pnpm evaluate final <ws> <tasks.json> <dir>`), `latestProtocolFreeze` and
`recordEvaluationSchedule` in study-store.ts, `latest_freeze` on GET `/protocol-freezes`.
Tests: tests/src/evaluation.test.ts. Report: docs/FINAL_EVALUATION.md. Before a real final
run: Jordan's RD1-RD10 answers and freeze, then non-synthetic study records (shape depends
on RD3/RD5/RD6/RD9), a verified live model, and builder-backed AI implementation runs. Next
eligible: finish T15 after the freeze; T16 needs actual ratings.

## Latest - T17 boundary checks and requirements audit (October 18, 2026)

Claude Code built T17 on claude/project-thread-k4si82 from main e46b2cf, in parallel with
T14 (ADR-0020; no migration). Report: tracking/evidence/t17/REQUIREMENTS_EVIDENCE.md. New:
`pnpm backup create|restore|verify` (packages/db/src/backup.ts, docs/BACKUP_AND_RESTORE.md)
with tests/src/restore.test.ts restoring the catalog and an artifact into a new database and
product store. Fixed audit items 4 (overrun now counts against ancestors, `ancestor_overrun`
in budget-store.ts), 5 (health derives live labels) and 7 (preview stdin decoded once); item
6 recorded in ADR-0020; workflow-store heartbeat SQL fixed (`t.version`; it had failed on every
call and the worker swallowed the error); item 7's export note was not a defect (each study attempt has its own
workspace). CI checks `pg_dump --version` before `pnpm test:db`. Real WSL2 gate on Jordan's Windows machine (reported by Jordan, October 18, 2026, on merge commit 38b3e46): `CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` 168 tests, 167 pass, 0 fail, 1 skip (the no-worker test, which always skips where the worker exists, so the restore test ran there). Next eligible: T15 after T14's adopted protocol, or T18 once T16 exists.

## Latest - T14 pilot rehearsal and proposed protocol (October 18, 2026)

Claude Code on claude/project-thread-ocgg8g from main e46b2cf (ADR-0019). Key code:
packages/domain/src/pilot.ts (pilot tasks, checks, classifier, reviewer packet, estimate,
`PROPOSED_PROTOCOL`, `BLOCKING_DECISIONS`, `freezeProtocol`), packages/orchestrator/src/pilot.ts
and pilot-main.ts (`pnpm pilot <dir>`), `freezeStudyProtocol` in study-store.ts, API
`/protocol-freezes`, CLI `protocol-proposal` / `protocol-freeze`. Report and decision list:
docs/PILOT_AND_PROTOCOL.md. Protocol is not frozen; next step is Jordan's answers to RD1-RD10
(several need the committee), then `protocol-freeze`. T15 needs an adopted protocol. T17 is
being built in parallel. The cloud test role needs `pg_signal_backend` for forced drops.

## Latest - audit fixes (October 18, 2026)

Codebase audit of T00-T13 found three items Jordan asked to fix (ADR-0018): spec-frozen
and held-out QA cases (packages/contracts/src/selection.ts, frozenCases in
packages/domain/src/selection.ts, packages/executor/src/build.ts), lowercase study ids
(packages/db/src/study-store.ts) and a PostgreSQL CI job. Cloud `pnpm test:db`: 148 pass,
0 fail, 10 WSL skips. Real WSL2 gate on Jordan's Windows machine: 157 pass, 0 fail, 1
expected skip. That machine has pnpm 12 on PATH; run tests through a terminal-local corepack
shim (`corepack enable --install-directory <dir> pnpm`, prepend to PATH). Next eligible milestone is still T14, on request.

## Latest - T13 verified artifacts, private preview and feedback (October 18, 2026)

Claude Code implemented T13 on claude/t13-8h288j from main 6fe5bab (T12 merged as
PR #14). See docs/ARTIFACTS_AND_PREVIEW.md for the owner workflow, ADR-0017 for the
design and tracking/evidence/t13 for executed checks.

Key code: packages/executor/src/{tar,artifacts}.ts and runPackage in execution.ts;
packages/db/src/artifact-store.ts and migration 10; apps/api/src/artifacts.ts
(management routes and the preview origin server); new CLI commands in
apps/cli/src/index.ts; apps/web/src/gallery.tsx. Revision fixtures are in
packages/domain/src/build-fixture.ts.

Done in the Linux cloud container: typecheck, format check, full suite with
PostgreSQL 16 (146 pass, 0 fail, 10 WSL-only skips) and a 13-step headless Chromium
walkthrough through double-harness.mjs and browser-acceptance.mjs. That harness
uses the labeled test double, which executes nothing.

Real-worker gate passed on Jordan's Windows machine the same day:
`CREATOR_TEST_ISOLATION=wsl2 CREATOR_RECORD_T13_EVIDENCE=true pnpm test:db` ran 156
tests, 155 passed, 0 failed, 1 expected skip (the no-worker test). Evidence is in
tracking/evidence/t13/cli-acceptance.json and wsl-gate.log. PR #15 merged at
b035d99. That machine has no global pnpm; the run used the pinned 11.25.0 through a
terminal-local corepack shim. The Docker test database was started and left
running; stop it with `docker compose --env-file .env.docker --profile test stop
db-test`. Next eligible milestone: T14, on a new request.

## PR publication and Claude Code handoff (October 18, 2026)

Owner requested a T12 PR and a handoff for Claude Code to start T13. GitHub
confirmed T11 merged as PR #13; main is 2ee0dca. T12 is being published on
codex/t12-bounded-builder with the preserved optional Docker database follow-up.
See [T13 Claude Code handoff](T13_CLAUDE_HANDOFF.md) for the authorized next task,
prerequisite branch, implementation boundaries and verification/machine state.
T12 source review remains pending; no merge or T13 implementation is claimed here.
The earlier session notes below describe their state before this publication.

## Latest - T12 bounded builder, fresh review and actual QA (October 18, 2026)

Implemented on the existing codex/t11-isolated-execution checkout, HEAD 2c14f9a.
The owner's explicit new T12 request authorized this work; T11 review/merge was
not inferred. Preexisting uncommitted Docker files and edits were preserved. No
staging, source commit, push or merge was performed in this T12 session.

Commands: `pnpm cli build-task <product> <task> <expected-commit> <plan.json>`;
`build-status <product> <build>`; product-status includes build IDs. See
docs/BOUNDED_BUILDER.md for exact prerequisites and plan. CLI -> authenticated API
checks current owner/frozen spec/run and exact-spec humility/build admission ->
metered broker builder -> T11 CAS patch/commit -> fresh reviewer -> supervisor
stdout/exit assertions in real clean WSL sandboxes -> task-specific candidate gate.
Grant versions/revocation/expiry and humility freshness are rechecked while running.
Consumed one-time authority covers its admitted operation without a second prompt.

Evidence in .creator/products/<id>/builds is immutable: intent/spec/prompts/plan,
context hashes, admissions/reservations/output, candidate commits, review, executed
commands and full execution/check results. Broker accounting stays in PostgreSQL.
Status rejects changed heads, dirty files or changed frozen specs. There is no
automatic recovery/replay; unfinished intents, unknown calls, locks and worker
leases require inspection. Failed commits and logs survive. Existing explicit
owner integration is separate, and a merge commit needs its own verification.

Checks: full Docker PostgreSQL 18.6 + real WSL gate **149/149, zero skipped**;
compiled authenticated CLI/API/broker acceptance and smoke. Final CLI authority
checks and standard check logs are recorded separately. Initial parallel-file
runs were 147/149 and 148/149: fixed an existing duplicate-delivery test's 200 ms
timing assumption and API/DB cleanup order; serialized test files to prevent
competing WSL lease/resource probes. Internal concurrency assertions remain.
Failure logs were preserved; no production gate was loosened.

Limits: fixed synthetic model roles, offline reviewed Python CLI, one independent
task and owner-authored exact stdout/exit checks. No browser/persistence/dependency
recipe, build catalog indexing, participant implementation path, live model,
real spend, public release, preview or artifact export. This is not independent
model reasoning or empirical validation. Shared-model correlated errors remain.
Local compute remains monetarily unmetered. See ADR-0016 and evidence/t12.

Next: T13 — Verified artifacts, private preview, and feedback revision, after
T11/T12 review and a new request. Do not advance automatically. Test database and
temporary API lifecycles are recorded in evidence; preserve the existing dev DB
and do not shut down the shared WSL VM or delete partial generated repositories.

## Latest - Docker follow-up (October 18, 2026)

Owner requested checking newly installed Docker and implementing it where useful.
Docker Desktop 4.95.0 / Engine 29.8.2 / Compose 5.6.0 connects via desktop-linux.
This session's stale PATH omitted the per-user CLI and credential helper; prepend
`$env:LOCALAPPDATA/Programs/DockerDesktop/resources/bin` in affected terminals.
No Docker MCP tools appeared in the chat catalogue; CLI and daemon were verified.

Added compose.yaml with digest-pinned official PostgreSQL 18.6 Bookworm, separate
dev/test named volumes and 127.0.0.1 ports 55433/55434, password authentication,
health checks, CPU/memory/PID limits and rotated logs. Generated a private password
in ignored .env.docker; do not overwrite it. See docs/DOCKER.md for commands to
load the password and set application/test URLs. Existing database data was not
migrated/imported or automatically selected by the app. Dev is running; test is
stopped. Both volumes persist; no automatic restart or Docker-socket mounts.

Executed all nine migrations, restart persistence, inspected port/resource limits,
and host-TCP correct/wrong-password checks. An initial in-container negative check
used the image's internal trust connection; a first host probe mistakenly retained
the URL's correct password over the separate pg option. The corrected probe changed
the URL itself and observed SQLSTATE 28P01. Full Docker-backed `pnpm test:db` with
`CREATOR_TEST_ISOLATION=wsl2`: **140 pass / 0 fail / 0 skip**. Logs and source hashes
are in tracking/evidence/docker. Prior T11 evidence remains historical and bound to
its original candidate; no executor code changed.

Standard `pnpm check` also passed (63 pass / 77 explicitly skipped without DB/WSL,
typecheck and formatting passed); Compose formatting checked separately. An initial
sandboxed check failed six localhost/hardlink checks due to host restrictions;
its log is retained, and the unsandboxed repeat passed without changing code.

Decision ADR-0015 uses Docker for conventional database infrastructure and retains
the verified WSL2/Bubblewrap sandbox. Docker disk storage is not quota bounded;
local compute cost is not monetarily metered. No live providers, remote deployment
or study activation. **Next eligible prompt remains T12**, after T11 owner
review/merge and a new request; this follow-up did not start it.

## Latest - T11 isolated execution and local product Git (October 18, 2026)

T11's reviewed-template gate is verified on `codex/t11-isolated-execution`, based on `5f9bb1bf71673b4c5aa27f418cbb2c842948266b` (T10 merged PR #12, confirmed before updating main). Exact staged source bytes are bound by [T11 verification](evidence/t11/verification.json) and its source manifest. Owner review/merge remains pending.

What works: `pnpm cli product-init/task/patch/build/integrate/status/cancel/reconcile` consumes actual authenticated current frozen T08 specs; creates separate product repositories and task branches/worktrees; enforces owner, exact base/head/preimage/spec/task hashes, portable file scopes and unlinked canonical paths; refuses stale/dirty work; and preserves real merge conflicts in separate review worktrees. Immutable local product/task/operation/execution records contain changed files, commits, hashes, bounded logs and observed environment. These files are distinct from the PostgreSQL audit/catalog and are not yet searchable there.

Real execution uses the existing Ubuntu WSL2 VM, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4. Only the reviewed Python stdlib template recipe is admitted. It has a cleared environment, non-root user, dropped capabilities/no new privileges, separate namespaces, read-only runtime/input/recipe/root/proc/dev, no personal/Windows/Git/D-Bus/daemon/credential mounts, no network, and bounded resources. Half one CPU, 256 MiB memory/no swap, 32 tasks, 20 s, work/tmp 16/1 MiB, file 8 MiB, input 100 files/512 KiB and logs 64 KiB. Missing isolation is blocked, never a host or fixture fallback.

Checks executed: frozen install; `CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` **140/140** on PostgreSQL 18.6; `pnpm check` **63 pass / 77 explicitly skipped** without DB/WSL; smoke; compiled authenticated CLI/API acceptance with freeze/admission and stale/auth denials. Real checks include secret/path/link/network denial, read-only mounts, privilege denial, actual disk/memory/process/output/runtime limits, detached-child cancellation, supervisor SIGKILL + expired lease reconciliation, cleanup, conflict preservation, and no silent redispatch. Final logs and synthetic CLI evidence are under tracking/evidence/t11/.

Review repairs: harden root/proc/dev mounts, verify committed blob bytes and manifest identity, bind recipe before dispatch, fence uncertain worker outcomes, serialize workers, require absent supervisor/expired lease/observed stopped unit for recovery. A transient Windows heartbeat-file write error is recorded separately; the bridge's actual expiry determines lease loss. Two older broker tests had timing assumptions that allowed admissions to settle after a fixed sleep; they now wait for all denied admissions before releasing their unchanged budget/concurrency gates. See self-review.md; no independent certification claimed.

Limits: owner CLI and a fixed offline conventional template only; no AI builder, independent QA, artifact download, persistent preview or human-study implementation integration. Recipe success is not a product acceptance verdict. Existing WSL2 VM, not a newly dedicated appliance; no syscall allowlist; privileged host users/manual simultaneous tampering are outside this local boundary. Local compute is bounded but not monetarily metered. Runtime integration is T12, artifact/preview T13, broader hostile-workload audit T17. Git-side interrupted operations require inspection; never reset/clean user work to resolve them.

Disposable acceptance used API 4315, PostgreSQL port 55432 and database creator_t11_acceptance; session files are ignored. Check process state before reusing those ports. The fixture API and PostgreSQL cluster are stopped after verification; the existing WSL distribution is not shut down because that could affect unrelated processes. Product repos remain in ignored .creator/products as inspectable synthetic fixtures. Unit cleanup was observed and temporary job inputs disposed for successful/failed/cancelled/lost executions.

**Next eligible prompt: T12 - Bounded builder, independent review, and QA**, after owner review/merge and a new request. T12 is not started.

## Latest - T10 study runner and human-only workflow (October 18, 2026)

T10's synthetic acceptance gate is verified on `codex/t10-study-runner`, based on `a9edf68f6fe3492a7dace8d0fbd5fd9de41989bb` (T09 merged PR #10, confirmed via GitHub before the local fast-forward). Source and verification hashes are in [T10 verification](evidence/t10/verification.json). Historical notes below remain historical.

What works: strict study/1 manifests with frozen problem/outcome/resource/config/prompt hashes; three-arm assignments with seed, order and prior familiarity; isolated attempt workspaces; participant context/entries and separate human grader access; human-only document/code/artifact entry and executed contains/equals/JSON tests on exact entry hashes; intervention and deviation capture; T07 structured execution and a neutral open-ended fixture baseline with comparable frozen caps; needs_human/failure/cancel outcomes preserved under the assigned condition, with separate assisted continuations excluded from primary outcomes; and a reproducible export containing all assignments, available raw events/results, costs/exposure, audit, decisions, artifacts/checks and redacted context manifests. Grader content is explicitly withheld without separate grader authority. See the Studies view, CLI study-* commands, docs/LOCAL_DEVELOPMENT.md's T10 section and ADR-0013.

Checks executed: frozen dependency install; pnpm test:db **130/130** against a disposable PostgreSQL **18.6** cluster on native Windows; pnpm check **59 pass / 71 explicitly skipped** without a database; pnpm smoke; node scripts/verify-study.mjs against the authenticated API; and project Playwright MCP/headless Edge desktop + 390px acceptance with screenshots, zero page errors and no horizontal overflow. Tests cover input changes, cross-participant/grader access, all human-only broker/helper/workflow paths with zero adapter calls, continuation exclusion, concurrent finish, stops denying further dispatch, late charged output retained as failure, HTTP errors and seed retry idempotency. The serialized export hash was recomputed. Evidence is in tracking/evidence/t10/.

Review repairs: late output cannot complete an expired assignment; stop and broker admission share the run lock; event/parent-lock ordering avoids terminal-event audit inversion; graders must be separate humans; malformed manifests return contract errors; seed retries preserve assignments; snapshots cannot be silently truncated in one arm; problem and outcome must match the shared packet. Windows formatting normalized line endings without changing unrelated source content; .gitattributes prevents recurrence. Earlier migrations, ADRs and protocol history were preserved.

Limits: synthetic fixtures only; no real participants, independent ratings, live provider invocation or spending. Institutional/recruitment/protocol choices remain unresolved. Human timing is reported effort; active AI inference is zero for fixtures. Supplied snapshots are unverified, so the structured fixture study stops with insufficient evidence. Code can be recorded and checked as text; arbitrary/AI implementation execution awaits T11 isolation. The seed uses one synthetic operator and does not establish participant independence. Windows checks used installed PostgreSQL 18.6, not a new PostgreSQL 16 run. Screen readers and comprehensive contrast checks were not performed.

The disposable demo used API 4314, web 5176, and .verification/t10-pg on loopback port 55432. Do not assume those processes are still running in a later chat. Session/database files are ignored. The saved synthetic-study-export.json contains labeled synthetic data, with no session credentials. A source manifest binds the candidate independently of tracking documentation.

**Next eligible prompt: T11 - Isolated execution and local product Git**, after owner review/merge and a new request. T11 is not started. Protocol adoption remains T14; empirical collection and analysis remain T15-T16.

## Latest — T09 usable catalog, decisions, search and run monitor (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t09-catalog-monitor-ml1t89` from `main` at bba9e9a (T08 merged as PR #9).

What works: `pnpm dev` (or the API plus `vite preview`) and the web page now cover the whole loop without the CLI: submit a theme and start a discovery run, watch it on the Monitor (pause, resume, cancel), read claims and passages, compare alternatives side by side and record a selection (with the supervised approval round in Decisions), then find it again in Search and Activity. The address keeps the view, workspace and selection across refresh. Budgets can be funded from the page. New CLI commands: `search`, `activity`, `overview`, `compare`; `lineage` takes a depth. See docs/LOCAL_DEVELOPMENT.md "Studio interface (T09)" and ADR-0012.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (58 pass, 64 skipped without DB), `pnpm test:db` (122/122), `pnpm smoke`, and the 12-step headless Chromium acceptance script on a freshly seeded database. Evidence: tracking/evidence/t09/.

Not done / limits: fixture model and reviewers only; lexical search (semantic search is X03); no products, tasks or artifacts exist yet, so those views show honest empty states and the Gallery is reserved; Windows, screen readers and measured contrast untested.

**Next eligible prompt: T10 — Study runner and human-only workflow.** Requires a new request.

## Latest — T08 versioned scoring, selection and frozen specifications (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t08-aq72aq` from `main` at df04354 (T07 merged as PR #8).

What works: with PostgreSQL configured, `pnpm cli seed-selection` runs the T07 discovery seed, scores the clinic no-show candidates with two fixture reviewers, records a selection (owner approval, one override), creates and freezes a specification and revises one task. Inspect with `pnpm cli report <workspace> <problem>`, `selections` and `spec`, or the web Scoring and selection panel. Record your own with `scorecard`, `select`, `spec-create`, `spec-revise` and `spec-freeze`. See docs/LOCAL_DEVELOPMENT.md "Scoring, selection and specs (T08)" and ADR-0011.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (57 pass, 60 skipped without DB), `pnpm test:db` (117/117), `pnpm smoke`, CLI seed run against the API, headless Chromium check of the panel. Evidence: tracking/evidence/t08/.

Not done / limits: fixture reviewers are fixed data, and no model assessor role writes scorecards yet; selection does not move a product into a build stage (T11–T12 consume frozen specs); rubrics are `proposed` until T14 calibration; no web form for selecting or freezing; Windows untested.

**Next eligible prompt: T09 — Usable catalog, decisions, search, and run monitor.** Requires a new request.

## Latest — T07 locator and competing response generation (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t07-locator-responses-nyj7cq` from `main` at 5a07713 (T06 merged as PR #7). Opened as a draft PR.

What works: with PostgreSQL configured, `pnpm cli seed-discovery` builds a fixture workspace and runs three discovery scenarios through the API (a software-suitable clinic case with a known duplicate, a food-bank case where an existing tool wins, and an insufficient-evidence case). Each run is a T05 workflow: locator, independent proposals per response type, skeptic, bounded revision, final skeptic, then problem and alternative records. Start your own with `pnpm cli discovery-start` (brief record + claims); inspect with `pnpm cli discovery <workflow> --wait` and `discovery-packet`, or the web Workflow runs panel. See docs/LOCAL_DEVELOPMENT.md "Discovery runs (T07)" and ADR-0010.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (52 pass, 52 skipped without DB), `pnpm test:db` (104/104), `pnpm smoke`, CLI seed run against the API, headless Chromium check of the panel. Evidence: tracking/evidence/t07/.

Not done / limits: fixture model only (the deterministic answers are rules over the packet, not reasoning); the locator works from claims already recorded through T06 and does not search or fetch; duplicate detection is word overlap; no web form to start a discovery run; scoring and selection belong to T08; Windows untested.

**Next eligible prompt: T08 — Versioned scoring, selection, and frozen specifications.** Requires a new request.

## Latest — T06 source ingestion, claim support and research boundaries (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t06-sources-claims-ogwzbb` from `main` at da976c7 (T05 merged as PR #6). Opened as a draft PR.

What works: with PostgreSQL configured, `pnpm cli seed-research` builds a fixture workspace that fetches the synthetic corpus through the source broker and records three claims with support; the web Sources and evidence panel and `pnpm cli source-fetch / sources / source / claim-support / claim-evidence` show and extend it. Fetches are `source.fetch` actions admitted against the run's grants; URLs, redirects and DNS answers are checked against the source policy. See docs/LOCAL_DEVELOPMENT.md "Sources and claim evidence (T06)" and ADR-0009.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (45 pass, 46 skipped without DB), `pnpm test:db` (91/91, three full runs), `pnpm smoke`, headless Chromium check of the panel (contested claim, blocked metadata-address fetch). Evidence: tracking/evidence/t06/.

Not done / limits: fixture corpus only; the HTTP adapter is tested against loopback servers, not real sites; no live search adapter (search stays the T04 fixture `tool.search_public` path); the T05 skeptic role does not fetch sources yet; instruction detection is a label, not a security boundary; origin clusters are fixed when a source is first recorded; adding support has no web form (CLI/API only); Windows untested.

T06 merged as PR #7; T07 followed (above).

## Latest — T05 durable bounded orchestration and recovery (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t05-t1b785` from `main` at f51530f (T04 merged as PR #5). Jordan chose PostgreSQL over a Temporal server for workflows (ADR-0008).

What works: with PostgreSQL configured, start a skeptic review of an idea or problem record for a registered run (web Workflow runs panel or `pnpm cli workflow-start`). The API's in-process worker (or `pnpm worker`) runs critique tasks per perspective and a synthesis through the T04 broker, checkpointing each step. Decisions pause it until answered; pause, resume and cancel are owner controls; it continues after restarts. See docs/LOCAL_DEVELOPMENT.md "Durable workflow runs (T05)".

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (37 pass, 35 skipped without DB), `pnpm test:db` (72/72, four full runs), workflow suites 5 more times, `pnpm smoke`, headless Chromium check of the panel. Evidence: tracking/evidence/t05/.

Not done / limits: fixture provider only (no live call); one role with a fixed plan, depth 1; Windows untested; CI still runs only `pnpm check`. ADR-0008 records the design and what was left out.

T05 merged as PR #6; T06 followed (above).

## Latest — T04 budgets and a metered model/tool broker (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t04-budgets-broker-px0108`, stacked on the T03 branch (`claude/t03-decisions-autonomy-5gpinz`, draft PR #4, not yet merged). Rebase onto `main` once #4 merges. Opened as a stacked draft PR.

What works: record a pricing snapshot, fund a budget, then send model or tool calls for a registered run through `POST …/runs/{run}/model-calls` (CLI `model-call`, or the web Budgets panel's fixture test call). Each attempt reserves its maximum exposure with the T03 admission, then settles from usage. Refusals, unknown outcomes and reconciliation are visible in `reservations`, history and the panel. See docs/LOCAL_DEVELOPMENT.md.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (33 pass, 28 skipped without DB), `pnpm test:db` (61/61), `pnpm smoke`, headless Chromium check of the panel. Evidence: tracking/evidence/t04/.

Not done / limits: no live call (no key, no spend grant); Windows untested; CI still runs only `pnpm check`. ADR-0007 records the design.

T04 merged as PR #5; T05 followed (above).

## Latest — T03 human decisions, autonomy modes and humility (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/t03-decisions-autonomy-5gpinz` from `main` at 2a2d028 (T02 merged as PR #3). Opened as a draft PR.

What works: with PostgreSQL configured, the API requires an owner session (printed login link/code in local development, or OIDC). Register a run with a mode, create standing grants, submit actions for admission, and answer the resulting decisions in the web Human decisions panel or the CLI (`pnpm cli login`, `admit`, `decisions`, `decision`, `answer`, `grants`, `run-cancel`, `humility-gate`). See docs/LOCAL_DEVELOPMENT.md.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` (29 pass, 18 skipped without DB), `pnpm test:db` (47/47), `pnpm smoke`, headless Chromium check. Evidence: tracking/evidence/t03/.

Not done / limits: no orchestrator calls admission yet (T05); no budget check (T04); real IdP and Windows untested; CI still runs only `pnpm check`. ADR-0006 records the design.

**Next eligible prompt: T04 — Budgets and a metered model/tool broker.** Requires a new request.

## Latest — T02 persistence, provenance and durable audit (October 18, 2026)

Done in a Claude Code cloud session on branch `claude/project-thread-lzo59n` of github.com/jordanprice040/CreatorAI (rebased onto `main` at e704196). Pushed with Jordan's go-ahead and opened as a draft PR for review.

What works: with `CREATOR_DATABASE_URL` set to a loopback PostgreSQL URL and `pnpm db:migrate` run, the API stores records, versions, typed links and audit history; `pnpm cli seed-lineage` builds a labeled fixture lineage (two ideas → one product, one idea → two products, task → artifact); the web page shows a read-only Records panel. Without a database the app behaves as T01 and record routes return 503.

Checks executed (Linux, Node 22.22.0, PostgreSQL 16.15): `pnpm check` without DB (21 pass, 8 skipped visibly), `pnpm test:db` (29/29), `pnpm smoke`, migration run twice, headless Chromium check. Evidence: tracking/evidence/t02/.

Not done / limits: no authentication; Windows PostgreSQL setup untested (see docs/LOCAL_DEVELOPMENT.md); Node 24 not re-run with the DB suites. The CI workflow runs `pnpm check`, where the PostgreSQL suites skip; it does not yet run `pnpm test:db`. ADR-0005 records the design.

**Next eligible prompt: T03 — Human decisions, autonomy modes, and humility.** Requires a new request.

## Claude Code tool setup — October 18, 2026

Owner approved making the development tools available to Claude Code. Copied `.agents/skills` to `.claude/skills` (30 skills; added Matt Pocock `grill-me`, `grilling`, `improve-codebase-architecture` to both at commit 49dd158). Added `.mcp.json` with the same Playwright and Firecrawl entries, and `.claude/settings.json` + `.claude/hooks/session-start.sh` (cloud only, `pnpm install`). `claude mcp list` reads both servers (pending per-user approval). Playwright stdio check passed in the cloud container with `PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium` and `PLAYWRIGHT_MCP_SANDBOX=false`; Firecrawl's host is blocked by the cloud network policy, so use the claude.ai Firecrawl connector there. Hook run, a Prettier check and `contracts.test.js` (9 pass) succeeded. Details: [DEVELOPMENT_TOOLS.md](../docs/DEVELOPMENT_TOOLS.md#claude-code), ADR-0004.

## CI workflow — October 18, 2026

Added `.github/workflows/ci.yml`: on every push and pull request, GitHub Actions installs with `pnpm install --frozen-lockfile` and runs `pnpm check` on Node 22 (version from `.node-version`, pnpm from `packageManager`). Locally on Node 22.22.0 the same two commands passed (20 tests, Prettier clean). The first Actions result is recorded on the PR that adds the workflow. Product status unchanged; next eligible prompt is still T02.

## Latest development-tool setup — October 18, 2026

Owner requested Emil Kowalski, Playwright MCP, Firecrawl MCP, Impeccable, Ponytail and selected Matt Pocock skills. Installed 27 project-local skills at pinned commits with original contents and licenses preserved. Added `.codex/config.toml` for `creator_playwright` and `creator_firecrawl`; existing global configuration remains unchanged. Impeccable Windows engine 0.1.15 was checked against its published SHA256 and its probe passed. No plugin hooks or automatic updaters installed.

Codex read both server configurations. Actual protocol checks passed: Playwright 25 tools plus isolated headless Edge navigation to about:blank and close; hosted Firecrawl 3.30.3 with three keyless tools. No Firecrawl search/scrape/parse, paid call, account signup, or application integration activation was performed. Newly configured MCP tools may need a restart in Codex Settings → MCP servers; skill discovery refreshes on the next turn. Current-chat exposure was not claimed from the direct handshake alone.

Read [DEVELOPMENT_TOOLS.md](../docs/DEVELOPMENT_TOOLS.md) for use, verification, and machine-specific cwd/browser setup. [Install manifest](evidence/development-tools/install-manifest.json) binds 104 exact upstream skill files; [MCP evidence](evidence/development-tools/mcp-verification.json) records executed checks. AGENTS.md gained a short tool pointer and precedence clarification; its existing instructions and CLAUDE.md were retained. Historical T01 manifests remain unchanged and describe the T01 snapshot, not the subsequent tooling/doc edits.

**Product status remains T01 complete; next eligible prompt is T02.** The earlier handoff below records T01 implementation and checks. No automatic milestone advancement.

Updated October 17, 2026 (America/New_York). **T01 verified complete; T02 not started.**

## Repository and candidate

- Root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Origin: `https://github.com/jordanprice040/CreatorAI.git`.
- Branch: unborn `main`; HEAD: none. Files remain untracked; no staging, commit or push. Do not mistake empty `git diff` output for no local work.
- Candidate: package 0.1.0 / executable schema 1.0. Exact file hashes are in [T01 final manifest](evidence/t01/final-files.sha256), with [verification details](evidence/t01/verification.json).
- Kit v3.0 and its T01/T02 prompts remain authoritative. Rubric/protocol documents remain drafts, not frozen study versions. Original AGENTS.md, CLAUDE.md, agent.md, templates, context and archived references preserved. README gained a local-development entry point; four tracking documents updated. Original kit/T00 manifests are historical and were not rewritten.

## What now works

Five implementation packages: contracts/domain and API/CLI/React web. Strict Zod runtime schemas validate task/result/run configuration, sources/claims, alternatives, assumptions, decisions, exact-money costs, typed links and experiment assignments. Domain functions check configuration binding, limits, delegation containment including sibling sums, transitions, expected versions and candidate evidence. Product stage, execution state, research condition and discovery method are distinct.

A visibly labeled deterministic fixture runs through web/CLI → HTTP API → domain and returns inspectable structured outcomes. Live dispatch and human-only provider calls are denied. Nonsoftware/existing-tool/human-led/hybrid/deferred/failed outcomes work. This is stateless: no research, real models, persistent catalog, generated software or study results.

Start from the root:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Web: http://127.0.0.1:5173. API: http://127.0.0.1:4310/api/health. In another terminal: `pnpm cli health` or `pnpm cli demo use_existing "Synthetic task"`. Full commands, configuration and trust limitations: [local guide](../docs/LOCAL_DEVELOPMENT.md).

The combined local demo was restarted on the final compiled candidate during this session (tool process session 3619). Do not assume it is still running in a later chat; inspect before starting another server. Ctrl+C stops both servers. No remote deployment or public service was started.

## Checks actually executed

- `scripts/verify-clean.ps1`: new source-only directory `.verification/t01-20261018-035503-421`, no initial node_modules; `pnpm install --frozen-lockfile --offline`, build and check passed. Offline reused the package cache; this is a fresh install directory, not a fresh network/cache environment. Clean log is retained in evidence/t01.
- `pnpm check` includes strict type checks, **20 passing contract/domain/HTTP/compiled-CLI tests** and formatting. Shell/application Node 22.21.0. A separate invocation of bundled Node 24.19.0 also passed all 20 tests; pnpm itself uses that bundled runtime. pnpm pinned 11.25.0.
- `pnpm smoke`: built page and preview proxy → API health/fixture POST passed on separate ports 4312/5175, then closed. This is HTTP evidence separate from browser rendering.
- Actual in-app browser: health connected; existing-tool, process-change and failed fixture dispositions; whitespace input disables submission. Final restarted candidate's process-change result captured in browser-state.txt and browser-fixture.png. No mobile-device or comprehensive accessibility certification claimed.
- Final manifest/checks verify candidate hashes, current links and preservation of original non-edited kit files. Git remains uncommitted; no CI run was made.

Resolved intermediate issues: restricted npm/pnpm cache access and localhost sockets required sandbox escalation; HTTP tests passed once loopback was permitted. A hostile-Host test initially used fetch, which normalized Host; switched to raw HTTP so the actual hostile header was exercised without weakening the gate. Initial formatting command ran before the docs directory existed; final formatting passed. During a demo restart, the old browser tab became a connection-error page; a fresh local tab verified the restarted app. This was not a completed browser unavailable-service test; CLI unavailability is covered by executed tests.

## Decisions, limits and next step

ADR-0002 records the installed versions, Node HTTP/test choice, fixture boundary and trust assumptions. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also tested. Official dependency sources are recorded in the local guide. Provider identifier/access/pricing remain unverified in config/provider-availability.json; no silent model substitution.

Domain checks are pure prerequisites, not an authenticated policy store, transactional reservation ledger, scheduler or independent reviewer. Path scopes are logical strings, not OS isolation. Validated evidence structure does not prove source truth or check execution. Persistence/auth/grants/budget broker/orchestration/isolation/research remain later milestones. No real credentials, paid calls, study runs or unknown external effects exist. X01–X10 remain deferred. The separate CIS4914 repository was neither inspected nor modified.

**Next eligible prompt: T02 — Persistence, provenance, and durable audit.** T01 prerequisite satisfied. Requires a new user request; do not advance automatically.

```text
Apply the shared implementation contract. Execute T02: Persistence, provenance, and durable audit.
```

Read the complete T02 prompt and current files first. Add actual PostgreSQL persistence, migrations, stable scoped entities/links, optimistic versions, transactional state/audit/outbox, idempotent projections, API/CLI/history paths, restart/stale/cross-scope/duplicate-delivery verification. PostgreSQL service/setup remains unverified; complete unrelated work before treating live service setup as a blocker. Preserve the T01 contracts or record necessary versioned migration. No owner question currently blocks beginning T02 inspection.

## X05 continuation — October 19, 2026

Owner requested an independent start alongside Claude Code X03/X04. Work is limited
to new apps/desktop files; prior dirty API/UI/contracts/research/docs/tests preserved.
X05 requires T13 only; reported X01/X02 source not available in this checkout.
See apps/desktop/README.md for commands, trust assumptions and remaining integration.

Implemented: Tauri shell source using existing default local web origin (no native
IPC), and executable source archive import/inspect CLI using shared T13 manifest
schema and existing executor path/tar validators. Cache bytes are bounded, hashed,
scoped, dated and rechecked; no launch or authority is granted by offline receipts.

Verified: installed TypeScript build passes; 3 focused tests pass on actual Windows,
including CLI readback, path spaces, junction rejection, concurrent imports and
negative integrity/identity/bounds checks. Final log: tracking/evidence/x05/artifact-cache-test.log.
Prettier and diff whitespace checks pass. Initial test fixture path error repaired;
sandbox junction restriction required an unrestricted test rerun. pnpm wrapper
stalled and was interrupted; direct installed Node CLIs worked.

Not verified: native Rust build/startup (cargo/rustc absent), MSVC/WebView2, full suite
or browser. No system install, account change, credentials, external mutation or
activation. Cargo.lock and installer/update work remain. Cache ownership assumptions
are documented; not a defense against owner-privileged concurrent path replacement.

Next eligible: continue X05 after coordinating shared API/database/UI edits with
X03/X04. Implement system-browser session handoff, durable single-use pairing,
revocable identities, outbound scoped/fenced leases and actual worker/native controls;
then execute Windows/native gates. X05 remains partial; do not start X06 automatically.
