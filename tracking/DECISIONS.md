# Decision log

## ADR-0005 — T02 PostgreSQL record store, audit chain and outbox

- Date: October 18, 2026. Status: accepted reversible implementation decision within the owner's request to start T02 (started from the project's setup card). Decision-maker: coding agent; owner review pending on the pull request.
- Storage: one PostgreSQL database through node-postgres `pg` 8.23.1 (published 2026-09-30) with `@types/pg` 8.23.1. Alternatives: an ORM/query builder (more dependency surface for a small schema), PGlite/embedded Postgres (no service needed, but single-connection and weaker concurrency evidence), SQLite (not the architecture's PostgreSQL direction). Raw SQL keeps integrity rules visible in one migration.
- Model: a generic `entities` table plus immutable `entity_versions`, with per-kind Zod bodies, rather than one table per kind. Reason: thirteen kinds share identity, scope, versioning, redaction and linking; integrity that matters (scope, kind, version endpoints, fixture separation, append-only history) is enforced with composite foreign keys, partial unique indexes and triggers. A SourceVersion is a source entity version. Revisit per-kind tables if queries need typed columns.
- Contracts: schema 1.0 extended additively with `idea` and `assessment` kinds, relations `assesses`, `part_of`, `authorizes`, new derived_from pairs (including `artifact:task` and `product:idea`), error codes `ACCESS_DENIED`, `DUPLICATE`, `IDEMPOTENCY_CONFLICT`, `STORAGE_UNAVAILABLE`, and health fields `persistent: boolean`, `storage`. No T01-valid task/result/link becomes invalid; the health response changed shape (T01 clients accepted only `persistent: false`).
- Audit: database-ordered sequence, server clock, hash chain under a global transaction advisory lock, outbox row in the same transaction, idempotent consumer inbox. Exactly-once is not claimed; delivery is at-least-once with idempotent projection.
- Access: workspaces with owner/editor/viewer membership checked on every repository call; non-members get NOT_FOUND. The HTTP API acts as one configured local owner (`CREATOR_OWNER_ACTOR_ID`) because authentication is T03.
- Rollback: drop the database (no production data exists) and remove `packages/db`; the fixture app runs without `CREATOR_DATABASE_URL`. Later schema changes use new migrations, never edits to migration 1.

## ADR-0004 — Claude Code access to the development tools

Date: October 18, 2026. Status: accepted at the owner's request in the project thread.

Mirror `.agents/skills` into `.claude/skills` as plain copies (Windows checkouts break Git symlinks) and keep both in step on updates. Add Matt Pocock's `grill-me`, `grilling` (its dependency) and `improve-codebase-architecture` at the already-pinned commit; the architecture skill's default `GLOSSARY.md`/`docs/adr/` paths yield to `tracking/DECISIONS.md` and canonical context. Configure the same two MCP servers in `.mcp.json` without machine-specific paths; per-machine browser differences go in environment variables or a local-scope override, not the shared file. Add a cloud-only SessionStart hook that runs `pnpm install`, synchronously so checks never race dependency install. Plugin lifecycle hooks remain uninstalled. No credentials are stored; Firecrawl account access goes through the claude.ai connector or an environment variable reference.

## ADR-0003 — Project-local development skills and MCP

Date: October 18, 2026. Status: accepted within the owner's explicit tool-installation request.

Install the requested upstream development tools in this Creator Agent checkout: 27 skills under `.agents/skills` and two project MCP entries under `.codex/config.toml`. Use pinned source commits and the system skill-installer helper; preserve upstream text and licenses. Keep global Codex configuration and the separate CIS4914 repository unchanged. AGENTS.md gains only a tooling pointer and clarification that current authorization, canonical paths and host rules take precedence over third-party defaults.

Choose the official keyless Firecrawl hosted endpoint for the initial connection: it has no credential prerequisite and exposes scrape/search/parse. It is a hosted service with a mutable version and rate limits, not local inference or a self-hosted crawler. Full account capabilities require a later explicit connection. Existing Firecrawl app tools remain distinct; no credentials were extracted or reused. Direct initialize/list-tools passed without data-tool calls.

Choose pinned Playwright MCP 0.0.83 using the installed Edge channel, headless and isolated, instead of attaching a personal profile. Direct protocol discovery and blank-page navigation/close passed. Its upstream dependency reports Playwright 1.64.0-alpha-1790635538000; do not describe it as a stable Playwright release. This is developer browser access, not T11 execution isolation. Project cwd is machine-specific and must be adjusted if moved.

Install Impeccable's skill plus its pinned 0.1.15 Windows engine after matching the published SHA256 sidecar. Keep the binary ignored by Git; engine-probe passed. Ponytail is installed as six skills, without global lifecycle hooks or importing session history. Select Matt Pocock's tdd, diagnosing-bugs, codebase-design, domain-modeling and writing-for-agents skills; the existing kit already supplies milestone orchestration, handoff and decision tracking. No automatic updater, native app, issue tracker, redesign, or later product milestone is introduced.

Consequences: skills are available at the next turn; new MCP entries may require restarting MCP in Codex. Direct handshake evidence does not claim current-chat tool exposure or successful paid operations. Source pins and hashes, limitations, verification and update/removal instructions are in [the tool guide](../docs/DEVELOPMENT_TOOLS.md) and [evidence](evidence/development-tools/install-manifest.json). T01 application source/dependencies remain unchanged; T02 remains next eligible.

## ADR-0001 — Empty repository and minimal local architecture

- Date: October 17, 2026 (America/New_York; evidence timestamps use UTC).
- Status: accepted as a reversible implementation default within authorized T00, not as owner approval of spending, study design, or external activation.
- Decision-maker/source: coding agent executing Jordan Price's T00 request and supplied repository URL; canonical kit v3.0, October 9, 2026.
- Repository: `https://github.com/jordanprice040/CreatorAI.git`.
- Local root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Evidence: [remote refs](evidence/t00/remote-refs.json), [local baseline](evidence/t00/local-baseline.json), [incoming kit hashes](evidence/t00/input-kit-hashes.json). The local kit contained no implementation; the successful remote query advertised no refs. Inaccessible/deleted history is not claimed inspected.

### Decision and rationale

Use the existing kit directory as the local CreatorAI working tree. Initialize an unborn `main` and configure `origin` to the supplied URL, preserving the existing files. There is no HEAD commit, tracked file or observed remote default branch. `main` is a reversible local default. No commit or push was performed.

Carry forward modular TypeScript/pnpm, React/Vite web UI, Node API and CLI, with application-owned contracts and domain enforcement. PostgreSQL remains the T02 persistence direction, Temporal the planned T05 backend, and isolated execution/filesystem artifacts/local Git the T11–T13 direction. OpenAI Agents SDK remains an adapter candidate; Tauri remains deferred to X05. None is installed application functionality. Verify current official documentation and pin compatible versions during the relevant implementation milestone; historical examples are not adopted API signatures.

Alternatives considered: reuse earlier agent code (none found in this workspace/advertised remote refs); use manual kit records alone (sufficient for intake, insufficient for executable lifecycle/contract acceptance); use a generic agent framework (possible adapter, cannot replace application-owned authority and study controls); scaffold the entire stack (deferred by T00 scope). The selected minimal path matches the kit without a stack deviation.

Consequences: T01 can implement fixture contracts and API/CLI/web paths without credentials or database/workflow services. Persistent records after restart belong to T02, policy/budgets to T03–T04, bounded durable roles to T05. No discovery, model inference, generated builds or empirical research results exist yet.

Affected requirements: C22, C26–C35 and C49–C50 guide this architecture; none is implemented by the ADR. Affected versions: kit v3.0 and T00/T01 prompts; no application commit, frozen protocol, provider config or pricing snapshot exists. Supersedes: none. Rollback: revise this ADR before a material stack change; local branch/remote can be changed without application data migration. Preserve the kit/evidence. If earlier Creator Agent code is supplied later, compare it before replacing compatible functionality.

### Actual path map

All paths are relative to the local root above.

| Actual path | Observed role |
| --- | --- |
| `.git/` | Created by T00: unborn main/origin, no commits or tracked files. |
| `AGENTS.md` | Canonical coding instructions, preserved. |
| `agent.md`, `CLAUDE.md` | Instruction entry points, preserved; incoming CLAUDE checksum differed from original kit manifest. |
| `PROJECT_CONTEXT.md`, `PROMPT_LIBRARY.md`, `README.md` | v3.0 vision, milestones/shared contract, kit guide; their uninspected-repository statements describe kit creation, superseded by this dated intake. |
| `context/` | 9 design, policy, requirements and reconciliation documents, not runtime code. |
| `agents/` | RUNTIME_CONTRACT.md and ROLE_PROMPTS.md; future runtime specifications, no executable agents. |
| `templates/` | 5 JSON examples/scenarios and IDEA_DOSSIER.md; not executable validators/tests. |
| `references/` | 4 archived historical Markdown documents, retained as references. |
| `tracking/` | Four status/decision/integration/handoff documents updated by T00. |
| `tracking/evidence/t00/` | Added input hashes, remote observation, PowerShell verifier, baseline output and final file hashes. Intake tooling only. |
| `PACKAGE_VALIDATION.md`, `SHA256SUMS.txt` | Historical kit validation/checksums preserved; not a checksum manifest for the edited working tree. |

Absent: apps/, packages/, src/, application tests, dependency manifests/lockfiles, .github/workflows/, container definitions, migrations, provider adapters and application build/start/test commands. Input inventory: 32 files including SHA256SUMS.txt. Reusable assets are specifications, prompts, templates and requirements; no reusable implemented functionality was found. No other personal repository was searched.

### Planned dependency/path map — not present yet

| Gate | Paths / dependency direction | Prerequisite and behavior |
| --- | --- | --- |
| T01 | `packages/contracts` → runtime validation library | Versioned executable schemas, decimal-string exact money and explicit errors. Select/pin library after compatibility review. |
| T01 | `packages/domain` → contracts | Lifecycle, containment and transition rules; no external effects. |
| T01 | `apps/api` → contracts/domain; `apps/cli` and `apps/web` → API | Thin health and validated fixture demonstration; React/Vite client. Clients do not own enforcement. Share schemas as needed. |
| T01 | Root pnpm workspace/scripts | Strict checks, compatible pinned dependencies, lockfile and documented install/build/test/dev commands. Tool presence is not compatibility evidence. |
| T02 | `packages/db` → contracts/domain + PostgreSQL | Migrations, persistence, audit/outbox; usable service unverified. |
| T03–T05 | policy/finance/providers and `apps/orchestrator` | Admission precedes provider/Temporal effects; verified SDKs, budgets, caps and grants required. |
| T11–T13 | `apps/worker`, artifacts/integrations | Isolated generated workspaces, exact Git/artifact evidence; no host-execution fallback. |
| X05 onward | `apps/desktop` and hosted extensions | Deferred; no empty packages created. |

Create only paths required by the authorized milestone. Smallest useful T01 slice: CLI/web → local API → runtime-validated fixture contract and deterministic lifecycle result, with health and invalid-input/transition checks. The persistent bounded-role slice in context/ARCHITECTURE.md spans T01–T05; T01 alone does not complete it.

### Instruction reconciliation and preservation

No remote instructions were available to merge. AGENTS.md is canonical; agent.md points to it and CLAUDE.md imports it. CLAUDE.md has escaped underscores in supplementary path text; use the actual PROJECT_CONTEXT.md and tracking/BUILD_STATUS.md paths stated in AGENTS.md. Preserve the incoming bytes rather than normalize an unexplained user change. Before edits, 30/31 original checksum entries matched; CLAUDE.md was the sole mismatch. Tracking edits intentionally make the historical checksum list stale; retain it and use separate dated input/final evidence.

Host rules/current user request take precedence, followed by recorded owner decisions and canonical context over archived references. Runtime role prompts are future product behavior, not coding-tool instructions. The separate CIS4914 repository was neither searched nor modified. No subagents were used.

### Remaining consequential choices

- T01: verify/pin compatible runtime, package manager, API/schema/test libraries using official documentation. No owner question blocks this routine local work.
- T02/T05/T11: verify local database/workflow/isolation deployment. psql, temporal and docker were not found on PATH; service availability elsewhere remains unknown.
- Before live models: verify preferred reference model's actual API identifier/access, capabilities, pricing, credentials, finite caps and scoped data/spend grant. GPT-6 Astra remains a historical preference, not verified availability; no substitution adopted.
- T14/final collection: owner/committee decisions on RQ priority, tasks, participants/raters, institutional requirements, sample size, limits and schedule remain unresolved. Synthetic/local work can proceed.
- Extensions: public GitHub writes/releases, hosting, payments, campaigns, reinvestment and external tracing require applicable configured authority. This URL/intake request is not product integration activation.

## ADR-0002 — T01 executable fixture boundary and dependency pins

- Date: October 17, 2026. Status: accepted reversible implementation decision within Jordan's explicit T01 request. Supersedes ADR-0001's absent-code inventory as current status; preserves its architecture and historical observation.
- Implemented: two shared packages (contracts/domain), three apps (Node HTTP API, compiled CLI, React/Vite web), and a tests workspace. Node's built-in HTTP/test APIs avoid an additional backend framework. Zod validates runtime inputs; TypeScript uses strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes and project references. Future db/policy/provider/orchestrator/worker/desktop packages remain absent.
- Pins: TypeScript 5.9.3, Zod 4.6.7, React/React DOM 19.3.1, Vite 8.3.4, Prettier 3.9.10, Node types 22.19.0, React types 19.3.0, pnpm 11.25.0. npm metadata verified available versions; selected TypeScript's stable 5.9 line rather than the newer major. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also supported/tested because the bundled pnpm runtime uses it. Package commands use the shell Node 22 here. Exact transitive resolution/integrity is in pnpm-lock.yaml. Official documentation sources and actual dependency roles are in docs/LOCAL_DEVELOPMENT.md.
- API: GET /api/health, POST /api/fixture and POST /api/validate. Loopback-only service/config, bounded JSON bodies and Host/origin checks. The web page and CLI use these real endpoints and validate responses. Hosted/live configuration fails; no paid/network provider exists. The historical model preference remains unverified in config/provider-availability.json.
- Schema 1.0 implements the kit's fields with UUID identities and SHA-256 version references; templates remain intentionally non-executable design examples. Canonical hashing sorts object keys by code-unit comparison, avoiding locale-dependent ordering. USD nano-units use canonical integer decimal strings (up to 30 digits) and BigInt comparisons; JSON never serializes money as floating point.
- Alternatives/consequences: a real model/database would exceed T01 scope and its prerequisites; using fixtures permits honest local verification now. A separate provider package is unnecessary for one deterministic fake, so it lives in domain/fixture.ts. The fixture's synthetic 2099 deadline is explicitly not a live allowance. Distinct successful decision execution and deferred/failed product outcomes are intentional. A build recommendation does not create an artifact or claim build-ready verification.
- Trust boundary: delegation validation checks a complete proposed allocation, not concurrent reservations. Lifecycle rules receive trusted current state/evidence; they do not let API callers advance arbitrary products or authenticate model-supplied evidence. Test/review evidence must bind candidate/spec/version and use a non-builder actor, but actual independent review is T12. No accounting, grant, persistence or isolation gate was weakened to pass T01.
- Verification: fresh source-only frozen install/build/check; 20 tests on Node 22 and 24; built-web proxy smoke and actual browser interactions. Exact candidate and logs: tracking/evidence/t01/. No real AI, research or study verification claimed.
- Affected requirements: partial foundations for C10–C16, C20–C23, C28–C29, C32, C35 and C49; see BUILD_STATUS.md. Kit v3.0 and draft research protocol unchanged. No protocol freeze, paid grant or owner study decision inferred.
- Rollback: replace/adjust these minimal packages and dependency pins with a recorded ADR. No persistent user data, real provider effect or deployment requires migration. Preserve incoming CLAUDE.md and historical T00 evidence. No separate senior-project repository was touched.

## Future entries

Use one entry per decision:

- Decision ID and date:
- Status: proposed / accepted / superseded / rejected:
- Decision-maker and source:
- Question and alternatives:
- Evidence and reason:
- Scope, consequences and affected requirement IDs:
- Affected code/spec/prompt/protocol versions:
- Migration or rollback plan:
- Supersedes / superseded by:

Proposed defaults are documented in context/DECISIONS_AND_OPEN_QUESTIONS.md. Do not silently convert them into accepted owner decisions.
