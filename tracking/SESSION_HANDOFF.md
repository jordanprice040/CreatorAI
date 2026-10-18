# Session handoff

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
