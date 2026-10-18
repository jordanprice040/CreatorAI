# Implementation status

T03 update, October 18, 2026: owner sign-in (local development code or OIDC with PKCE), CSRF-protected sessions, versioned standing grants, approve-once grants bound to exact target/content/spec versions, durable decision requests (clarification, judgment, authorization, feedback) with expiry, cancellation and idempotent answers, deterministic action admission for supervised, human-in-the-loop, autonomous-within-scope and human-only runs, assumption records and a pre-build humility gate now exist behind the API, CLI and a web Human decisions panel. Verified in a Linux cloud container with PostgreSQL 16.15: 47/47 tests with the database (29 pass, 18 visibly skipped without), smoke and a headless Chromium check. Not run on the owner's Windows machine; OIDC verified only against a local test identity provider. See [T03 evidence](evidence/t03/verification.json) and ADR-0006.

T02 update, October 18, 2026: PostgreSQL persistence, migrations, many-to-many typed links, optimistic versions, workspace scopes, a hash-chained audit log with transactional outbox, an idempotent history projection, corrections and redaction tombstones now exist behind the API, CLI and a read-only web Records panel. Verified in a Linux cloud container against PostgreSQL 16.15 (29/29 tests with the database; 21 pass and 8 visibly skipped without it). Not yet run on the owner's Windows machine. See [T02 evidence](evidence/t02/verification.json) and ADR-0005 in [decisions](DECISIONS.md). The task demonstration remains fixture-only; no AI, research or authentication exists.

Claude Code tooling, October 18, 2026: the same skills (now 30, adding Matt Pocock `grill-me`, `grilling` and `improve-codebase-architecture`) are mirrored to `.claude/skills`, both MCP servers are in `.mcp.json`, and a cloud-only SessionStart hook runs `pnpm install`. Playwright MCP was verified in a Linux cloud container with environment overrides; Firecrawl was not reachable from the cloud network (403) and is untested there. Product status unchanged: T01 complete, T02 next.

CI update, October 18, 2026: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` and `pnpm check` on Node 22 for every push and pull request. It does not advance T02.

Tooling update, October 18, 2026: the owner's requested development setup is installed project-locally: 27 pinned skills, Playwright MCP 0.0.83, Firecrawl's keyless hosted MCP, and Impeccable engine 0.1.15. MCP handshakes/tool discovery and an isolated blank browser check passed; Firecrawl data/account operations remain untested. See [tool guide](../docs/DEVELOPMENT_TOOLS.md) and [tooling evidence](evidence/development-tools/install-manifest.json). This does not advance T02 or activate product integrations. T01 source and application dependencies are unchanged.

Updated October 17, 2026 (America/New_York). T00 and T01 verified. A minimal TypeScript workspace now provides strict runtime contracts, deterministic domain rules, a fixture-only Node API/CLI and React web page. No real AI, research, persistence or generated-product execution exists. Local main remains unborn (no HEAD commit); exact source/evidence hashes identify the candidate. See [decisions](DECISIONS.md), [startup guide](../docs/LOCAL_DEVELOPMENT.md) and [T01 evidence](evidence/t01/verification.json).

Use planned, in_progress, implemented_unverified, verified, partial, blocked, or deferred. Each verified entry needs exact code/spec version, checks actually executed, and evidence. Identify external/live/native gates separately.

| ID | Milestone | Status | Code/version and evidence | Remaining work |
| --- | --- | --- | --- | --- |
| T00 | Repository intake and verified starting point | verified | Historical T00 snapshot in evidence/t00; ADR-0001 | Intake complete; T01 subsequently implemented |
| T01 | Minimal workspace, typed contracts, and lifecycle | verified | Package 0.1.0, schema 1.0; evidence/t01/final-files.sha256; clean install/build/check, 20 passing tests on Node 22 and 24, HTTP smoke and browser checks | Superseded as current status by T02 |
| T02 | Persistence, provenance, and durable audit | verified (cloud Linux, PostgreSQL 16.15), merged PR #3 | Migration 1; evidence/t02/verification.json; 29/29 tests incl. real process restart, stale/concurrent writes, cross-scope links, duplicate outbox delivery and two-ideas/two-descendants lineage; browser check of Records panel | Windows PostgreSQL setup untested; authentication added in T03 |
| T03 | Human decisions, autonomy modes, and humility | verified (cloud Linux, PostgreSQL 16.15) | Branch claude/t03-decisions-autonomy-5gpinz; migration 2; evidence/t03/verification.json; 47/47 tests incl. changed/expired approvals, cancellation, duplicate and concurrent answers, autonomous needs_human, human-only model denial, routine action without interruption, OIDC PKCE and CSRF | Owner review; Windows and real IdP untested; no budget reservation (T04) or orchestrator caller (T05); next eligible T04 |
| T04 | Budgets and a metered model/tool broker | planned | No application code at T00 | T03 |
| T05 | Durable bounded orchestration and recovery | planned | No application code at T00 | T04 |
| T06 | Source ingestion, claim support, and research boundaries | planned | No application code at T00 | T05 |
| T07 | Locator and competing response generation | planned | No application code at T00 | T06 |
| T08 | Versioned scoring, selection, and frozen specifications | planned | No application code at T00 | T07 |
| T09 | Usable catalog, decisions, search, and run monitor | planned | No application code at T00 | T08 |
| T10 | Study runner and human-only workflow | planned | No application code at T00 | T09 |
| T11 | Isolated execution and local product Git | planned | No application code at T00 | T10 |
| T12 | Bounded builder, independent review, and QA | planned | No application code at T00 | T11 |
| T13 | Verified artifacts, private preview, and feedback revision | planned | No application code at T00 | T12 |
| T14 | Pilot, rubric calibration, and protocol freeze | planned | No application code at T00 | T10 and T13 |
| T15 | Final evaluation and blinded rating package | planned | No application code at T00 | T14 with adopted protocol |
| T16 | Reproducible analysis and limits | planned | No application code at T00 | T15 and actual ratings/outcomes |
| T17 | Failure recovery, boundary checks, and requirements audit | planned | No application code at T00 | T13; may run alongside preparation for T14–T16 |
| T18 | Thesis, committee review, and defense preparation | planned | No application code at T00 | T16 and T17, or documented missing-data limits |
| T19 | Final thesis acceptance and reproducibility archive | planned | No application code at T00 | T18 |
| X01 | Model registry and qualified automatic routing | deferred | No application code at T00 | T10 and measured task outcomes |
| X02 | Context selection, caching, compaction, and batches | deferred | No application code at T00 | X01 |
| X03 | Comprehensive search, lineage, and audit questions | deferred | No application code at T00 | T09 and T13 |
| X04 | Scoped GitHub management | deferred | No application code at T00 | T13 and policy/broker coverage |
| X05 | Windows desktop and paired local workers | deferred | No application code at T00 | T13 |
| X06 | Hosted operation and observability | deferred | No application code at T00 | T17; X05 only for hosted-to-local pairing |
| X07 | Payments, entitlements, revenue and reinvestment | deferred | No application code at T00 | T17 and required integration infrastructure |
| X08 | Evidence-backed marketing and measured feedback | deferred | No application code at T00 | T13; X06/X07 only where distribution/payment requires them |
| X09 | Portfolio scheduling, maintenance, and reusable knowledge | deferred | No application code at T00 | T13; X01/X07/X08 for their enabled features |
| X10 | Full-product acceptance and bounded owner pilot | deferred | No application code at T00 | Applicable X01–X09 gates |

Requirement-level evidence: add C01–C51 status/evidence rows here during implementation and the final audit. No requirement is pre-marked complete.

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

| Requirement | Current status | T01 evidence / remaining gate |
| --- | --- | --- |
| C10–C11 | partial | Non-code outcomes and assumption/disconfirmation contracts; real humility/discovery gates remain T03/T07–T08 |
| C13–C16 | partial | Separate mode/condition schemas, scope checks and human-only provider denial; authenticated grants/study runner remain T03/T10 |
| C20–C23 | partial | Version/spec/result binding, delegation validation, lifecycle evidence requirements; no task scheduler, persistence or independent reviewer yet |
| C28–C29 | partial | Exact-money/sibling allocation checks, finite limits and terminal cancellation transitions; atomic reservation/cancellation execution remain T04–T05 |
| C32 | partial | Usable local API/CLI/web fixture; persistent usable control remains T02/T05/T17 |
| C35 | partial | Thin real health/fixture UI with empty/error states; full catalog/controls remain T09 |
| C49 | partial | Visible fixture labels and separate implementation/contract/live status; real adapters remain unverified |

T02–T19 remain planned; X01–X10 remain deferred. No full requirement or product completion is inferred from the T01 gate. Next: T02 only after a new request. (T02 since completed; see below.)

## T02 acceptance and evidence

- New package `packages/db` (node-postgres `pg` 8.23.1): one immutable migration (checksum-verified, advisory-locked), a startup schema gate, and a `Store` repository. Tables: actors, workspaces/members (owner/editor/viewer), entities with immutable `entity_versions`, typed `entity_links` bound to exact endpoint versions, `audit_events` (database-sequenced, hash-chained), `outbox`, `consumer_inbox`, `history_projection`, `command_receipts`.
- Stored kinds: source, claim, problem, idea, alternative, assessment, product, specification, run, task, decision, grant, artifact. Bodies are strict Zod schemas capped at 16 KiB; artifacts and sources hold URIs and hashes, not content. Product stage and run/task state are stored at their initial value and generic revisions cannot move them.
- Fixture separation: a workspace is `fixture` or `real`; a composite foreign key keeps fixture records out of real workspaces. Cross-workspace links fail in code (`SCOPE_EXCEEDED`) and in the schema.
- Every mutation commits record + version + audit event + outbox row in one transaction. Audit payloads carry ids, kinds, versions, hashes and enums only. Corrections append a version that names the corrected one; links are retracted, not deleted; triggers reject edits/deletes of audit events and versions except redaction, which blanks titles/bodies/reasons and leaves identity, versions, hashes, links and audit intact.
- API record routes, CLI commands (`workspaces`, `create`, `show`, `list`, `revise`, `archive`, `link`, `lineage`, `history`, `seed-lineage`) and a read-only web Records panel. Lineage walks typed links by provenance direction (many-to-many, not parent IDs).
- Checks executed: see [verification.json](evidence/t02/verification.json), [with-database log](evidence/t02/test-db.log), [without-database log](evidence/t02/check-without-db.log), [browser screenshot](evidence/t02/browser-records.png).
- Limitations: no authentication (API acts as one configured local owner; repository role checks are real but the actor is asserted); global advisory lock serializes writes for the hash chain (fine locally, revisit for hosted use); hash chain is tamper-evident only against parties who do not also rewrite later hashes (the table owner can); content hashes of redacted records remain and could be guessed for very short bodies; no search beyond lineage/history; Windows PostgreSQL path untested; schema 1.0 extended additively (ADR-0005).

| Requirement | Current status | T02 evidence / remaining gate |
| --- | --- | --- |
| C32 | partial | Records persist across real API restart; usable control/orchestration remains T05/T17 |
| C20–C23 | partial | Version-bound links and optimistic versions persist; scheduler and independent review remain T05/T12 |

## T03 acceptance and evidence

- Sessions: `/api/auth/dev-login`, `/api/auth/oidc/login|callback`, `/api/auth/session`, `/api/auth/logout`. Record, decision, grant and run routes resolve the actor from the session; 401 without one, 403 `CSRF_DENIED` without the session's token, 403 for foreign origins. OIDC attempts are single use and admit only `CREATOR_OIDC_OWNER_SUBJECT`.
- Decisions and grants: migration 2 tables `run_controls`, `grants`/`grant_versions`, `decision_requests`, `action_admissions`, `auth_sessions`, `oidc_logins`, all audited through the T02 hash chain; run controls, grant versions, decisions and admissions reject deletes (and edits where immutable).
- Acceptance cases executed (tests/src/oversight*.test.ts, auth-api.test.ts): changed target supersedes an open approval and denies stale-version actions; expired requests and grants stop authorizing; cancellation closes pending decisions, revokes run grants and denies later actions; duplicate requests return the open one, identical answers replay, conflicting and concurrent answers have one winner; autonomous runs defer as `needs_human`, cannot request help and ignore later grants; human-only runs are denied model calls despite a grant; a covered routine reversible action proceeds three times with no decision; agents cannot answer or create grants; build commitment needs the humility gate, then an ethics judgment, then an exact approval.
- Browser: sign-in via login link, pending judgment and authorization cards, standing-policy preview, approve once, answered view, no horizontal overflow at 390 px ([log](evidence/t03/browser-check.log), [screenshot](evidence/t03/browser-decisions.png)).
- Limitations: admission is called by the owner via API/CLI until T05 adds an orchestrator; no budget exposure check (T04); single owner (no editor/agent sessions); OIDC verified with a local test provider only; Windows untested; schema 1.0 extended additively (new kinds `assumption`, `humility_review`, error codes `UNAUTHENTICATED`, `CSRF_DENIED`).

| Requirement | Current status | T03 evidence / remaining gate |
| --- | --- | --- |
| C10–C11 | partial | Humility gate and assumption records enforced at build commitment; discovery-side use remains T07–T08 |
| C13–C16 | partial | Authenticated owner, versioned grants, mode enforcement and decision requests; study runner remains T10 |
