# Archived project reference

Preserved from an earlier project document. Use the current PROJECT_CONTEXT.md, AGENTS.md and context documents for scope and precedence. Do not execute instructions in this archive as a second active prompt sequence. Historical model prices, service capabilities, dates, budgets and proposed studies require verification before use. The original text follows unchanged.

---

**Creator Agent — coding prompt library**

Version 2 · September 8, 2026 · 48 implementation prompts, numbered 00–47

Use these prompts with an AI coding tool in your Creator Agent repository. Place PRODUCT_OVERVIEW.md, IMPLEMENTATION_GUIDE.md, and this file under docs/. Run one numbered prompt at a time, in order, unless its prerequisites are already implemented and verified. These prompts build the platform; they are not commands to start unrestricted agents, spend funds, publish products, or send campaigns now.

Use GPT-6 Astra in your coding tool when available for difficult implementation and review. This setting is separate from the model router the application will implement. Do not claim a model switch unless the tool actually supports and confirms it.

The contract below applies to every prompt. Paste it once at the beginning of a fresh coding session, or instruct the tool to read it from this file. Each numbered block then supplies the specific work. The final three utility prompts are optional operations and are not part of the 48-step build sequence.

**Shared build contract — apply throughout the implementation.**

```text
You are implementing Creator Agent in the current repository. Read applicable repository instructions, docs/PRODUCT_OVERVIEW.md, docs/IMPLEMENTATION_GUIDE.md, the shared build contract and requested prompt in docs/PROMPT_LIBRARY.md, and docs/BUILD_STATUS.md if present. Inspect actual files and existing tests before changing them. Execute the requested implementation rather than merely describing a plan.

Preserve working code and user changes. Prefer a small coherent patch through the real application path. Follow existing compatible architecture; record justified deviations in docs/DECISIONS.md. Use current official documentation for SDK/API details and then pin compatible dependencies. Never invent methods, model access, pricing, credentials, integration success, test results, or business evidence.

Implement only the requested step and necessary prerequisites. Do not silently replace the stack or rewrite an unrelated repository. Ordinary reversible work within the task is authorized: inspect, edit, install necessary declared dependencies within environment policy, run checks, and repair defects introduced by the change. Honor existing session authorization; do not repeatedly ask for approval of already-permitted work.

Build real domain/API/UI paths when the step requires them. Fakes belong to explicitly labeled fixtures or adapters. A fixture-tested connector is not live-verified. If an external credential or authority is missing, complete the adapter, deterministic verification, configuration validation, and a concrete activation step; mark the live check unverified and continue unrelated authorized work. Never bypass an access control or use a broader credential to defeat a restriction.

All billable calls and external effects must pass the application policy and budget brokers as they become available. Never introduce a temporary production bypass. Public publication, real campaigns, purchases, account changes, and live charges require an existing matching grant or a final review of a concrete action. Building the integration does not activate those effects.

Preserve exact financial arithmetic, atomic budget conservation, source provenance, audit events, cancellation, isolation, and permission-scoped retrieval. Never weaken tests, acceptance criteria, privacy, or permission checks to make a gate pass. Use meaningful tests for the changed behavior, especially negative, concurrency, and crash cases where relevant. Do not add low-value tests that repeat implementation details.

When tools support subagents and independent work is useful, you may delegate bounded disjoint tasks. Assign file ownership, inputs, acceptance criteria, budget/time limits, and integration responsibility. Wait for results before claiming integrated completion. Do not create unbounded recursion or overlapping uncontrolled edits.

At the end, report: what now works; files/modules changed and why; exact checks actually run and their results; remaining limitations or external setup; and the next eligible prompt. Update docs/BUILD_STATUS.md with prompt ID, implemented/verified/partial/blocked status, evidence paths, and outstanding work. Distinguish implementation complete from live integration verified. Stop optional testing when the concrete gate is sufficiently verified.
```

The shared contract's delegation permission is for the coding tool running these prompts. The eventual product must separately implement its own bounded delegation policy.

| Range | Working checkpoint |
| --- | --- |
| 00–10 | A persistent, budgeted agent job visible in an authenticated catalog |
| 11–21 | Research through a tested downloadable prototype and feedback revision |
| 22–27 | Measured model routing and token optimization with rollback |
| 28–32 | Searchable lineage and managed private GitHub repositories |
| 33–34 | Windows desktop app with paired local workers |
| 35–38 | Reconciled revenue, checkout, reinvestment and budget-aware scheduling |
| 39–41 | Marketing workflows and reviewed reusable skills |
| 42–47 | Hosted operation, recovery, security, performance and bounded pilot |

Prompt 00 — inspect the repository and adopt the blueprint. Run first.

```text
Apply the shared build contract. Implement Prompt 00: repository intake and a concrete execution map.

Inspect repository status, instructions, package manifests, source, tests, CI, and documentation. Determine whether this is an empty/new Creator Agent repository or an existing agent project. If relevant prior agent code is actually present, identify reusable contracts, storage, approval, and worker capabilities from files. Do not assume remembered features exist and do not alter a senior-project repository merely because it is accessible.

Map the blueprint modules to actual paths. Preserve compatible working architecture. Record only material unresolved decisions; use the blueprint's personal-use, Windows-first, TypeScript defaults where reasonable. Keep the original blueprint documents intact and record deviations separately.

Create docs/ARCHITECTURE.md with boundaries and the first vertical slice; docs/BUILD_STATUS.md with prompts 00–47 and their real status; docs/DECISIONS.md; and docs/INTEGRATIONS.md identifying implementation, fixture, contract, live verification and activation separately. Inventory prerequisites without printing secret values. Identify available test/build commands and execute a small relevant baseline if code exists.

Exit when the repository has a practical path map, truthful baseline, and next-step prerequisites. Do not scaffold the whole application during this step or create remote repositories. Report evidence for any capability you mark already implemented.
```

Prompt 01 — create the minimal runnable workspace. Requires 00.

```text
Apply the shared build contract. Implement Prompt 01: a runnable TypeScript workspace with development services.

Use the adopted path map. Add apps/api and apps/web plus contracts/configuration infrastructure needed now; reserve later module paths in documentation without generating empty packages everywhere. Configure strict TypeScript, pnpm workspace references, formatting, linting, a test runner, and a reproducible lockfile. Select current supported dependency versions from official documentation and existing compatibility constraints.

Provide a local development command and persistent PostgreSQL/Temporal service configuration with explicit data volumes. Add API health/readiness endpoints and a minimal real web screen showing API connectivity. Define runtime-validated environment configuration, .env.example with names only, and ignore rules for secrets, generated artifacts, local databases, caches, and personal coding-tool state. Development shortcuts must fail configuration validation in hosted mode.

Add baseline CI for frozen dependency installation, static checks, tests and build; use least-privilege workflow permissions and trusted pinned actions where supported. Do not introduce deployment or secret-bearing workflows yet.

Verify a clean install/build and local API-to-web connectivity. Document exact Windows/WSL and Linux startup commands that match implemented scripts. Exit with a small functioning workspace and useful failure messages when required services are absent.
```

Prompt 02 — define contracts and lifecycle invariants. Requires 01.

```text
Apply the shared build contract. Implement Prompt 02 in packages/contracts and packages/domain or mapped equivalents.

Define runtime-validated IDs, version references, task/result contracts, product stages, execution states, error envelopes, event envelopes, and permission/resource references from the implementation guide. Keep product lifecycle separate from queued/running/reconciling/cancelled execution state. Use UTC timestamps and explicit expected versions. Serialize money as decimal strings backed by exact arithmetic, not JavaScript floating point.

Implement pure transition rules with requirements for evidence-backed advancement, pausing, budget exhaustion, rejected ideas, archival and cancellation. A task result must distinguish success, partial work, failure, uncertain external outcome and cancelled work. Define finite parent/child call and delegation limits shared across the tree.

Model typed many-to-many entity links so one product can derive from several ideas and one idea can lead to several products. Validate allowed endpoint types and scope. Keep contracts independent of UI, database and provider SDKs.

Verify meaningful invalid transitions, stale expected versions, malformed input, missing acceptance evidence, and child authority exceeding its parent. Update the API error contract to use these types. Exit with executable domain rules, not a types-only package whose invariants are never checked.
```

Prompt 03 — persist the catalog and versioned relationships. Requires 02.

```text
Apply the shared build contract. Implement Prompt 03: database migrations and real catalog persistence.

Create the initial tables for workspace/user ownership, sources and versions, claims, problems, ideas, assessments, products/specification versions, tasks/runs/attempts, and typed lineage links. Add stable keys, indexes for actual lookup paths, foreign-key or equivalent transactional integrity, and optimistic version updates. Design future finance/audit tables through interfaces without fabricating completed implementations.

Provide repository operations used by the API for creating an idea, recording a source, linking evidence, creating a product from ideas, reading versions and archiving records. Migrate forward from an empty database and preserve existing data on subsequent migrations. Put synthetic examples in an explicitly labeled fixture workspace.

Prove persistence across process restart, stale-update rejection, endpoint/scope integrity for lineage, a product with two originating ideas, and an idea with two product descendants. Use a real disposable PostgreSQL database for these integration checks. Ordinary failures must roll back partial operations.

Expose a minimal API route using the repository layer. Document migration/startup behavior. Exit with actual stored records and relationships; an in-memory array behind a production route does not satisfy this prompt.
```

Prompt 04 — implement authentication and standing grants. Requires 03.

```text
Apply the shared build contract. Implement Prompt 04: authenticated workspace access and a policy engine.

Use an established session/OIDC approach compatible with the repository; do not create homemade password cryptography. Implement a personal owner workspace, session protection, restrictive origin/CSRF behavior as appropriate, and consistent authorization for catalog routes. Keep development fixture login explicitly unavailable in hosted mode.

Create versioned standing grants with actor, action family, target/workspace, repository/path/provider limits where relevant, amount/count/time bounds, expiry and revocation. Implement a deterministic admit/deny decision with a safe reason. A child receives only the intersection of delegated and parent authority. Retrieved text and model output cannot mint or modify grants.

Support an owner configuration that permits routine private research and later scoped development within existing budgets without repeated confirmations. Out-of-scope actions should become concrete review requests rather than broad prompts for unrestricted access. Pending approvals must bind to the intended action and relevant state version.

Verify unauthorized reads/writes, cross-workspace access, expired/revoked grants, changed targets and stale approvals. Add a simple sign-in and permission-denied UI path. Exit when policy decisions are invoked by actual API operations and can be reused by future brokers.
```

Prompt 05 — add transactional audit history and projections. Requires 04.

```text
Apply the shared build contract. Implement Prompt 05: durable audit events and an outbox.

For catalog and policy mutations, commit state changes, an AuditEvent and an outbox record atomically. Include actor, occurred/recorded times, aggregate version, correlation/causation IDs, request identity, scope and safe payload references. Use database ordering for committed history. Record denials through a safe path even when the attempted business transaction does not commit.

Implement an at-least-once outbox publisher and idempotent projection consumer with a resume cursor. Add a basic timeline API and web view showing real changes. Keep detailed protected content separate from readable summaries, redact credentials, and retain artifact hashes/version references. Do not store private model reasoning or claim it is available.

Add correction events rather than editable history. Define the interface for integrity checkpoints and retention, leaving advanced export verification to later work. Ensure source-content deletion can remove payload/index access while preserving a non-sensitive tombstone.

Verify rollback leaves no orphan success event, duplicate deliveries do not duplicate projected events, restart resumes publication, and revoked access prevents history reads. Exit with traceable create/update/archive actions visible in the app, not only console logging.
```

Prompt 06 — implement exact money and balanced journals. Requires 05.

```text
Apply the shared build contract. Implement Prompt 06 in packages/finance and database migrations.

Implement exact USD money arithmetic using the guide's nano-unit representation and decimal-string JSON. Retain original provider currency/minor-unit values; reject unsupported currencies instead of silently converting them. Define conservative reservation rounding and separately recorded provider settlement values.

Implement balanced financial journal entries with immutable postings, unique source operation keys, reversals/corrections, and typed accounts for seed capital, liquid funds, pending receivables, provider credits, revenue, expenses, liabilities, refunds and transfers. Seed funding must never increase sales revenue.

Implement the separate budget journal for root and child envelopes. Transfers of authority conserve the parent's total. Provide owner-authorized seed allocation and a read-only report separating real balances from permission to spend. All journal mutations emit audit/outbox records in their transaction.

Test balancing, exact small token-cost amounts, overflow/input validation, duplicate posting, reversal, parent-child conservation and unsupported currency. Include a test in which a $100 parent delegates $20 and still authorizes at most $100 overall. Exit with persisted financial and budget state and a real API report. Do not introduce payments or live funding transfers.
```

Prompt 07 — enforce atomic reservations and resource limits. Requires 06.

```text
Apply the shared build contract. Implement Prompt 07: the shared admission and reservation service.

Before a job can incur cost, validate its grant, pricing snapshot, provider/tool capability, usable funding source, output/tool limits, task/day/month/studio envelopes, and concurrency. Reserve conservative maximum exposure in an atomic transaction. Track reserved, in_flight, reconciled, released and disputed states with unique operation IDs.

Implement actual-cost settlement, release of unused authority, expired unused reservations, and uncertain-outcome handling. A cancelled HTTP client must not release the exposure of an already-dispatched request until the outcome is reconciled. Separate incurred expense from paid expense and authoritative invoice reconciliation. Parent and child admission share the same root constraints.

Create a pricing interface supporting service tiers, context thresholds, cache categories, output and tool billing units without hard-coding provider-specific field meanings. Missing usage/pricing must remain unknown or block dispatch, never become zero. Provide reservation APIs and a basic budget-status view.

Use real concurrent database tests to race multiple reservations against one balance, verify child-budget conservation, and simulate a timeout followed by a late response. Exit when denied work demonstrably never reaches a fake external executor and uncertain exposure remains visible.
```

Prompt 08 — connect Astra through a metered model broker. Requires 07.

```text
Apply the shared build contract. Implement Prompt 08: a real OpenAI provider adapter and deterministic fake adapter behind one ModelBroker.

Verify the installed OpenAI/Agents SDK APIs and current gpt-6-astra capabilities from official documentation. Implement typed requests, schema-validated output, cancellation, rate-limit handling, provider request IDs, usage normalization, and retained provider state where supported. Configure service credentials only on the trusted backend. Verify access using a small existing-authorized live check if a key and spend grant are available; otherwise complete fixtures and report live access unverified.

All model requests must reserve budget through Prompt 07, then record attempt, route, prompt version, pricing snapshot, actual usage and outcome. Include billed reasoning in output accounting without charging it twice. Record tool charges separately when applicable. Failed calls count toward exposure/cost as supported by observed billing.

Implement one bounded agent role using the broker through the real installed SDK integration, and prove nested/tool calls cannot bypass policy. Keep full fake transcripts labeled synthetic. Tests should cover invalid output, unsupported setting, missing key, cancellation, unknown usage and late success after timeout.

Exit with one metered structured task returning a persisted artifact/result. Do not expose an unmetered SDK client to other modules.
```

Prompt 09 — make jobs durable and recoverable. Requires 08.

```text
Apply the shared build contract. Implement Prompt 09: Temporal orchestration of bounded agent jobs.

Use deterministic Workflow code and Activities for model calls, database operations and external effects. Add queued/admitted/running/waiting/reconciling/terminal states, durable logical operation IDs, separate attempts, deadlines, heartbeats, retry policies and cancellation. Store large content by artifact reference rather than expanding workflow history.

Checkpoint the bounded agent loop so a worker crash does not blindly restart an entire long session. Preserve the admitted model, context/prompt versions, grant and budget operation. Reconcile an uncertain provider action before repeating it; if outcome cannot be known, preserve exposure and a clear blocked state. Do not describe Temporal as making arbitrary external effects exactly once.

Implement worker leases/fencing and cancellation propagation. A stale worker must not complete a reassigned task. Restart the worker during a fixture operation, replay the workflow, and verify one logical result and no duplicate budget consumption. Test waiting for a dependency, operator pause/resume and exhausted budget.

Exit with durable job control through API operations. Add a runbook explaining the workflow service, worker processes, persistent volumes, and the difference between stopping dispatch and cancelling running work.
```

Prompt 10 — deliver the first usable vertical slice. Requires 09.

```text
Apply the shared build contract. Implement Prompt 10: the foundation checkpoint in the real UI.

Let an authenticated owner submit a theme or idea, assign a bounded analysis job, observe queued/running/completed or blocked states, read its structured result, and see budget reservation, actual usage and audit timeline. This early analysis must be labeled as an unresearched draft unless real source evidence was supplied; do not present it as completed market research.

Wire the existing API, database, policy, finance, model broker, workflow and UI end to end. Support refresh/restart, safe error display, pause/cancel, and a clear missing-configuration state. Use an explicit fixture mode for demonstrations; live mode must not silently fall back to synthetic output.

Run an end-to-end fixture from submission to stored result, including a worker restart and a budget-denied case. If live model access is already authorized, run one small capped real task and record its request/usage evidence separately. Fix integration defects before moving on.

Exit when a person can use this path from the browser without calling private helper functions manually. Update BUILD_STATUS with the foundation gate and unresolved external setup. This checkpoint should establish working plumbing, not merely attractive static cards.
```

Prompt 11 — build the shared catalog and product workspace UI. Requires 10.

```text
Apply the shared build contract. Implement Prompt 11 in apps/web, packages/ui and catalog APIs.

Create practical navigation for Ideas, Products, Work, History, Resources, Finances and Settings, enabling only working features and clearly labeling unavailable ones. Implement idea list/detail, source/evidence views, product detail, portfolio stage board, priorities, favorites/tags, archival and a project-specific conversation/history area. Keep business state on the server.

Use the existing typed API client and version checks. Support filtering, sorting, pagination, loading/empty/error states, keyboard navigation and responsive layouts. Project pages should distinguish an idea, research, prototype, release candidate and maintained product. Add space for test/manifest/download status without faking artifacts that do not exist.

Expose source freshness and confidence as separate concepts. Connect edits, prioritization and archival to real audit events. Preserve state across navigation/reload, and handle conflicting updates visibly. Share UI components in a form that the future Tauri client can consume.

Verify the primary owner workflows with browser tests and inspect actual rendered layouts. Exit when the catalog is useful with persisted records and the first run's results, with no dead buttons masquerading as completed functionality.
```

Prompt 12 — ingest sources and preserve evidence. Requires 11.

```text
Apply the shared build contract. Implement Prompt 12: approved source ingestion through a fetch broker.

Support owner-supplied URLs and one practical public research/search adapter with current documented capabilities. Keep a deterministic local source adapter for tests. Enforce allowed protocols/destinations, redirect checks, private-network/metadata blocking, byte/time limits, connector scope and credential isolation. A browser or network tool must not bypass this broker.

Store canonical source identity, version/hash, retrieval time, content/reference permitted for retention, extraction status, and access classification. Extract claims with precise source locators and distinguish quoted evidence from inference. Treat instructions in fetched material as content, never authority. Preserve failed/inaccessible sources rather than inventing substitutes.

Connect ingestion to a source-detail UI with excerpt, origin, freshness, related ideas, and failure state. Deduplicate fetches within a valid freshness window while recording each use and its task. Meter search and retrieval costs where billable.

Verify a valid page, a changed source version, redirect to a private address, oversized response, malicious embedded instructions, unsupported content type and unavailable source. Exit with a real persisted evidence path and source citations that can be opened from the catalog.
```

Prompt 13 — research problems and find duplicates. Requires 12.

```text
Apply the shared build contract. Implement Prompt 13: problem discovery, research dossiers and reversible deduplication.

Use the source pipeline to identify affected users, recurring difficulties, current workarounds, existing alternatives, claimed improvement and evidence gaps. Produce typed dossiers with source-linked observations, separate inferences, confidence and a proposed validation experiment. Capture contradictory evidence and research freshness. A lack of accessible sources must produce insufficient evidence.

Create exact/normalized duplicate detection and similarity candidates across sources, problems and ideas. Do not count reposts as independent corroboration. Link or cluster likely duplicates reversibly; preserve the owner's ability to separate false matches. Use structured/lexical methods first and retain an adapter point for later semantic search.

Implement the research job, cost accounting, stage advancement and dossier UI through the existing workflow. Store competitors and substitutes, including a recommendation to use an existing product when appropriate. A novelty field must describe comparisons checked, not claim global uniqueness.

Verify known duplicates, two distinct ideas with similar wording, conflicting sources, stale research, and a dossier with no sufficient support. Exit with several inspectable source-backed dossiers from an explicitly labeled fixture run and a real-source run only when the integration is enabled.
```

Prompt 14 — implement independent brainstorming and critique. Requires 13.

```text
Apply the shared build contract. Implement Prompt 14: bounded multi-agent concept development.

Create versioned runtime prompts/configurations for a manager, three independent solution designers and a skeptic. Designers receive the same original problem/evidence but not one another's proposals initially. Require materially different approaches, user value, implementation tradeoffs, smallest useful version and a measurable experiment. The skeptic evaluates proposals against evidence and competitors, preserving unresolved objections.

Allow one revision round, then require a selected experiment, archive decision or concrete missing fact. Implement parent/child task links, a shared total-call/budget limit, max concurrency/depth and cancellation propagation. Use the model broker for every role, including summaries. Agents cannot expand their grants or allocate beyond delegated funds.

Persist proposals, critique, rubric version, selection rationale and discarded alternatives. Add a comparison view and owner override with an audit event. Avoid endless group-chat loops; all jobs have typed outputs and stop conditions.

Verify that initial proposals are independent, all child costs roll up once, a failed child is visible, budget exhaustion stops further delegation, and cancellation stops the tree. Exit with one completed brainstorm visible as a traceable set of artifacts and a decision.
```

Prompt 15 — turn an idea into an executable product plan. Requires 14.

```text
Apply the shared build contract. Implement Prompt 15: specification, experiment and task planning.

Convert a selected concept into a versioned ProductSpecification with audience, user flows, supported platform, scope/non-goals, measurable acceptance criteria, data/interface contracts, resource assumptions and maintenance considerations. Define a small experiment before a full build when the key uncertainty is demand or technical feasibility.

Create a task dependency DAG with scoped file/component ownership, inputs, expected artifacts, completion checks and child budget envelopes. Detect cycles and tasks with missing dependencies. Choose one integration owner for shared interfaces. Parallelize only tasks that can progress independently. A new plan must not silently modify the accepted specification.

Add owner selection and plan-inspection UI, linking every task to its spec version and originating idea(s). Admission should estimate whether the planned work fits allowed budget/capacity and return a bounded alternative or pause when it cannot. Estimates remain labeled estimates.

Verify DAG cycles, stale specification revisions, conflicting ownership, insufficient funding, and an idea combining two sources of inspiration. Exit with a build-ready plan that a worker can consume without reconstructing requirements from an entire chat transcript.
```

Prompt 16 — implement the isolated execution supervisor. Requires 15.

```text
Apply the shared build contract. Implement Prompt 16: a real restricted execution environment in apps/worker.

Create a reviewed job recipe for the initial web-tool template. The trusted supervisor provisions disposable containers inside a dedicated VM or equivalent isolation, with a non-root user, CPU/memory/disk/time limits, narrow workspace mounts, allowed dependency-network access and output capture. Do not mount the host container socket, personal files or studio credentials into generated-code environments.

Implement job leases/fencing, process-tree cancellation, heartbeat, health and resource cleanup. Validate requested commands and paths through typed recipe/tool contracts. Resolve symlinks and canonical paths before checking containment. Deny private network/cloud metadata access from untrusted workloads according to the worker profile. Preserve logs as protected artifacts with redaction.

Run a harmless fixture build and demonstrate that workspace escape, secret reads, prohibited networking and excessive resource consumption are blocked. Verify cancellation terminates child processes and releases the environment without losing the audit trail. If isolation tooling is unavailable locally, complete implementation and deterministic checks, then report the native isolation gate unverified; never substitute unrestricted host execution.

Exit with a trusted supervisor capable of running one real recipe under enforced limits.
```

Prompt 17 — manage local Git workspaces and integration. Requires 16.

```text
Apply the shared build contract. Implement Prompt 17: local source control for generated products.

Initialize a separate local product repository from a reviewed, versioned template. Record its identity and studio/product binding. Create task branches and isolated worktrees or clones; enforce allowed file scopes, base commit and one integration owner. Keep the studio repository distinct from generated source.

Implement read/search/diff/apply-patch/commit operations through validated worker tools. Reject path traversal, stale bases, unrelated dirty changes and accidental access to other repositories. Preserve user edits; do not use destructive reset as automatic conflict resolution. Record task-to-commit and changed-file links in the audit catalog.

Support merging compatible task changes into an integration branch and reporting conflicts as structured blockers. Generate reproducible commit metadata and retain the actual actor/source of automation without impersonating an unconfigured human identity. Remote GitHub operations come later.

Verify two disjoint task branches, a conflicting edit, a stale patch, untracked user content, and a repository path with spaces. Exit with inspectable product commits and lineage visible from tasks. A mocked Git API alone does not satisfy the local repository gate.
```

Prompt 18 — implement the bounded development loop. Requires 17.

```text
Apply the shared build contract. Implement Prompt 18: a development worker that turns one planned task into working code.

Create a versioned developer role prompt and tool set using the model broker, scoped Git workspace and execution supervisor. Supply the relevant spec, interfaces, file map and assigned acceptance criteria. The loop can inspect, edit, build and run task checks, then submit a typed result with commit/artifact references and blockers.

Enforce total calls, tokens/output limits, time, delegated budget and repair count. Every model/tool call and changed file must link to the task. A worker must not alter the studio policy, credentials, financial journal or acceptance criteria. Missing dependencies and invalid assumptions produce a structured request for replanning, not arbitrary scope expansion.

Implement a small deterministic task fixture with known requirements and an enabled live model path for the same recipe. Handle test failure, malformed patches, cancellation, context limit and a crash after a commit. Preserve partial code and spending evidence on failure.

Exit with a small generated feature that builds in the isolated environment and is committed, while remaining pending independent verification. Do not mark a product ready based on the developer's own report.
```

Prompt 19 — add independent review and executed QA. Requires 18.

```text
Apply the shared build contract. Implement Prompt 19: a release-blocking review and QA pipeline.

Create separate reviewer and QA configurations. The reviewer receives the frozen specification and exact candidate diff; QA receives the clean build and user tasks. Use appropriate unit/integration checks and Playwright for browser flows. Store real command results, browser traces/screenshots where helpful, environment identity and tested commit. Treat generated test files as code until executed.

Define prototype-ready gates covering startup, core workflow, persistence where applicable, key error/empty states, relevant security checks and usable packaging prerequisites. Store serious findings with reproduction steps and links. The builder cannot approve its own release or silently weaken acceptance criteria.

Implement at most two repair cycles by default, rerunning affected checks after each new candidate. Changed code/spec invalidates affected approvals. Report unresolved failures and exhausted budget clearly. Native desktop verification must later supplement browser tests.

Verify a correct fixture app, a deliberately broken core workflow, a failing export/startup case, a changed commit after review, and a reviewer reporting success without evidence. Exit when only the exact passing candidate can advance and failed products remain visibly blocked.
```

Prompt 20 — publish private previews and downloadable artifacts. Requires 19.

```text
Apply the shared build contract. Implement Prompt 20: artifact packaging and the private product gallery.

Create a BuildManifest containing product/spec/task/repository identities, exact commit, template/toolchain/lockfile versions, artifact checksums, build/start commands, test reports, requirements and known limitations. Package source and the supported runnable output from the verified candidate. Store them through real filesystem/object-storage adapters with authorization and retention metadata.

Create private previews on an origin separate from the management app, with test data, owner access, resource leases, readiness/health, idle expiry and explicit stop. Starting a preview must pass resource admission. Resume only a supported manifest recipe. Keep source download, runnable demo and native installer as distinct availability types.

Wire gallery actions to real artifacts and preview state. Validate artifact hashes on retrieval and prevent stale or unverified versions from replacing the passing candidate. Check access again when downloads start rather than trusting a cached UI grant.

Verify clean extraction/startup from the exported package, an expired preview, revoked access, a checksum mismatch and a failed readiness check. Exit when the owner can open the working prototype and download the exact tested source from its product page.
```

Prompt 21 — close the feedback and revision loop. Requires 20.

```text
Apply the shared build contract. Implement Prompt 21: the first complete product-studio checkpoint.

Let the owner record a bug, rating or requested change on an exact product version, including reproduction steps and attachments where supported. Convert accepted feedback into a versioned specification change and scoped tasks. Preserve the original product and link the revision, tasks, costs, commits, review and new artifacts.

Complete an end-to-end scenario from evidence-backed problem through independent concepts, selected plan, development, QA, private preview and source download. Then submit feedback, implement one revision, reverify it and compare versions. Ensure totals include both initial development and revision without double-counting shared calls.

Provide clear owner controls to accept, archive, pause and request another experiment. Keep partial and failed work inspectable. Demonstration fixtures must be labeled and isolated from live business records.

Run the whole scenario using deterministic sources/models to establish repeatability, and a small capped live-model trial only if already configured and authorized. Repair integration failures before marking the checkpoint complete. Exit with a product the owner can genuinely test, revise and trace, not a set of independently passing modules.
```

Prompt 22 — establish evaluation and cost-per-success baselines. Requires 21.

```text
Apply the shared build contract. Implement Prompt 22: an evaluation harness before automatic routing.

Define representative task classes for extraction, research, brainstorming, planning, bounded coding, debugging, review and audit questions. Create labeled fixtures and a held-out set with executable acceptance checks. Include duplicate ideas, weak evidence, broken apps, malicious retrieved instructions and expensive failed attempts. Keep benchmark labels outside context used by agents optimizing prompts.

Record model/configuration, dataset/version, pass/fail and serious findings, actual total cost including failed calls/repair/review/tools, latency, interventions and escalation. Distinguish unavailable usage from zero and estimates from reconciled charges. Use Astra as the initial reference where available; fake-provider tests validate the harness without pretending to benchmark model intelligence.

Add paired-comparison reports and uncertainty/sample-size reporting. Freeze evaluation criteria before comparing candidate routes. Preserve failed/abandoned tasks in denominators. Introduce a capped evaluation budget and no-side-effect mode for shadow runs.

Verify that a cheaper failed route can cost more per success than the baseline and that hidden labels cannot leak into prompts. Exit with reproducible commands, versioned result artifacts and a truthful baseline readiness report. Do not enable model selection based on unmeasured assumptions.
```

Prompt 23 — build the model and pricing registry. Requires 22.

```text
Apply the shared build contract. Implement Prompt 23: a versioned registry of permitted models and costs.

Represent provider/model identity, actual API model/version, capabilities, supported tools/modalities, context/output constraints, reasoning options, data policy, account availability, service tiers, pricing effective dates/source and qualification by task class. Seed Astra and any currently verified Sol/Terra/Luna candidates from official documentation; do not assume all named models are accessible to this account.

Extend the OpenAI adapter to select qualified configured models through the same budget broker. Add a provider-neutral contract so future backends can be introduced without changing domain logic. An unavailable second provider is not required merely to demonstrate abstraction. Preserve an Astra-only option and manual per-project override.

Implement immutable pricing snapshots with disjoint token-charge buckets, context premiums, cache-write treatment where relevant and tool fees. Missing or expired prices block new uncertain spend until policy supplies a conservative bound. Old runs retain their original price basis.

Verify unsupported tools/settings, unavailable models, a price update during a run, long-context costing and no silent provider fallback. Exit with a real registry UI/API and tested model selection through the existing metered execution path.
```

Prompt 24 — implement qualified automatic model routing. Requires 23.

```text
Apply the shared build contract. Implement Prompt 24: automatic routing constrained by measured quality.

Select a route using task class, required tools, data policy, context size, latency, available budget, account capability and qualification evidence. Minimize expected total cost to an accepted result, including retries and review. Start with versioned rules, not an untrained learning algorithm. Sparse evidence uses the validated baseline or pauses if that route is unaffordable.

Implement finite escalation based on objective failure, invalid output, missing required evidence or documented ambiguity. Record the decision, candidate exclusions, policy version, estimate, selected model and final outcome. Do not use self-reported confidence as the sole quality gate or silently lower acceptance criteria.

Add shadow comparisons with external effects disabled, then a small budgeted canary. Promotion must satisfy the owner-configured quality margin, sample/uncertainty requirements, must-pass cases and cost criteria. Implement automatic rollback and manual freeze. All experiments use a separate capped envelope.

Verify a low-cost successful route, a cheap route whose repairs erase savings, an unavailable model, insufficient evidence, a privacy exclusion and rollback after regression. Exit with Auto and Astra-only modes working on real jobs and route explanations visible in history. Do not claim measured savings from simulated model results.
```

Prompt 25 — build task-specific context packs. Requires 24.

```text
Apply the shared build contract. Implement Prompt 25: context selection and token budgeting.

Create ContextPack manifests containing the exact task/specification version, immutable constraints, necessary unresolved findings, relevant evidence excerpts, interface contracts, changed files, allowed tools and handoff summary. Store every selected source/commit/path/version and the reason it was included. Retrieve narrow excerpts before whole files and process large tool output in code, retaining a full protected artifact reference.

Preserve budget/permission constraints, acceptance criteria and necessary contradictory evidence. Define a deterministic priority policy when context approaches its cap; if required context cannot fit, split/replan or use a qualified larger route rather than silently removing requirements. Agents receive relevant project memory, not unrelated personal or workspace data.

Add incremental indexing by content/commit hash and scoped repository search. Reuse relevant prior failures and components with provenance. Record estimated and actual context usage, selection overhead, truncation and omitted optional sources.

Verify a large repository fixture, stale excerpts, permission changes, a requirement hidden in an older decision, and an oversized tool result. Compare task correctness and total cost against an unoptimized baseline. Exit with context packs used by real agent jobs and inspectable through their audit record.
```

Prompt 26 — add caching, compaction and asynchronous batches. Requires 25.

```text
Apply the shared build contract. Implement Prompt 26 using the current installed provider APIs.

Arrange stable prompt prefixes where useful and capture actual cache usage/charges. Do not pad prompts just to meet a cache threshold. Keep provider prompt caching separate from application result caching. Result keys must include scope, model/prompt/tool versions, inputs, source freshness and relevant policy; permission/source changes invalidate results. Never cache the success of a mutation as authority to perform it again.

Implement supported provider compaction behind an adapter, preserving its returned context window correctly. Keep readable authoritative project state and evidence separate from opaque provider state. Include compaction calls in budget/usage accounting and verify required constraints survive context optimization.

Implement a limited batch path for independent, non-urgent supported requests with per-item IDs, reservations, deadlines, partial results, validation and cancellation accounting. Interactive tool loops continue through the normal runner. No savings percentage is assumed in code; use the effective pricing registry.

Verify cache isolation/invalidation, a cache miss, compaction overhead, a batch partial failure, a late billed result after cancellation and a stale source. Exit with all three optimizations feature-configurable, metered, and regression-tested through actual broker paths.
```

Prompt 27 — make optimization performance visible. Requires 26.

```text
Apply the shared build contract. Implement Prompt 27: optimization dashboard and qualification checkpoint.

Show route policy/version, selected model, task class, accepted outcomes, serious failures, latency, input/cached/output/reasoning usage, tool calls, retries, context/compaction overhead and total cost. Attribute costs to projects and to separate evaluation work. Add drill-through to source calls, context manifests and acceptance results.

Compare equivalent workloads and include failures/abandonments. Separate measured spending, reconciled charges, estimated uncached counterfactuals and statistically uncertain comparisons. A token reduction with worse outcomes is not a successful optimization. Expose Auto/Astra-only/project overrides, canary status, freeze and rollback through authorized UI actions.

Run the defined regression benchmark before allowing a new routing/context policy to activate. Use fake data only in a labeled demo workspace; real savings claims require real captured usage and adequate comparison evidence. Verify sample-size/uncertainty display and missing-usage behavior.

Exit when the owner can explain why a task used its model, what the whole attempt cost, whether it passed, and how to revert the policy. Record which task classes are qualified and which remain on baseline. This is the efficiency checkpoint.
```

Prompt 28 — implement comprehensive lexical and filtered search. Requires 27.

```text
Apply the shared build contract. Implement Prompt 28: permission-scoped search across the studio.

Index authorized idea text, evidence, specifications, task summaries, decisions, audit summaries, artifact text and repository code snapshots by exact entity/version. Support IDs, names, URLs, tags, status, dates/timezone, agent/model, repository/path/commit, resource type and cost ranges. Add pagination, stable ordering, saved filters and relevant snippets.

Track indexed_at, source_version, coverage, supported extraction type and tombstones. Use PostgreSQL full-text search and useful exact/fuzzy indexes first. Do not label unsupported binary contents searchable. Exclude secrets and inappropriate vendored/generated noise; expose a clear search-scope control for code.

Enforce access before snippets, aggregation and result delivery, not only after ranking. Reindex changed sources and delete/redact stale payload entries. Database roles and pooling must not leak one workspace's authorization into another.

Verify exact commit lookup, date boundaries, a stale index, deleted evidence, access revoked after indexing, unauthorized hidden titles/counts and a cost filter over shared resources. Exit with real search available from the app and measured behavior on a declared-size fixture dataset.
```

Prompt 29 — add semantic discovery, audit questions and lineage. Requires 28.

```text
Apply the shared build contract. Implement Prompt 29: relationship-aware search and evidence-grounded audit answers.

Add a metered embedding adapter and vector index with scope, model/version and freshness metadata. Combine semantic candidates with exact/lexical results while enforcing access before retrieval and answer generation. Provide a reindex path when embedding versions change.

Implement a constrained QueryPlan for natural-language audit questions: entity types, typed filters, relation traversal, metrics, time window/timezone, order and limits. A trusted compiler executes parameterized read-only queries with timeouts. The model cannot supply arbitrary SQL, commands or mutations. Answers cite record IDs and disclose missing coverage or stale indexing.

Build bounded lineage and timeline views for sources-to-ideas-to-products, tasks-to-commits-to-artifacts, and costs/revenue-to-budget allocations. Many-to-many joins must not multiply costs. Add permission-safe JSON/CSV export with a schema/manifest and integrity checkpoint verification.

Verify two ideas feeding one product, one component reused by two products, a natural-language injection attempt, unsupported query, revoked access, and a shared cost counted once in studio totals. Exit when an owner can ask what happened, where, when, why and at what cost, then open the supporting records.
```

Prompt 30 — connect GitHub with correct token capabilities. Requires 29.

```text
Apply the shared build contract. Implement Prompt 30: GitHub connection and a credential-isolating broker.

Verify current official GitHub authentication and endpoint requirements. Support a personal-account provisioning path using an authorized GitHub App user access token or suitable fine-grained PAT for POST /user/repos. Routine supported repository operations use narrowly scoped installation tokens. Do not assume installation tokens support that personal-create endpoint.

Verify the actual authenticated owner and installation IDs. Keep credentials, refresh tokens and app keys in protected backend storage. Implement scope discovery, expiry/refresh, revocation, safe health checks and capability readiness. Selected-repository installations may require an explicit scope update after new repository creation; make that state visible instead of broadening access automatically.

Add owner/prefix/count/rate-limited standing grants and a connection UI explaining the exact enabled operations. Do not touch existing personal or school repositories outside scope. Public visibility, deletion, transfer, collaborators and workflow-policy changes are separate capabilities.

Use fixture/contract tests for both authorization paths, wrong owner, expired token, denied repository and revocation. A live check may inspect an already-authorized account but must not create a repository merely to test authentication. Exit with truthful connector readiness and no tokens exposed to agents, logs or generated products.
```

Prompt 31 — implement autonomous private repository lifecycle. Requires 30.

```text
Apply the shared build contract. Implement Prompt 31: create and manage product repositories within standing grants.

Add broker operations to create a private personal repository, initialize an approved template, bind its immutable GitHub ID to a product, create issues and branches, and push scoped task changes. Explicitly set private=true. Use the correct provisioning credential path, then verify installation access before routine management. Preserve local work when a scope update is required.

Enforce permitted owner/prefix, count and creation-rate limits, target identity and task/product lineage. Provision through a durable logical operation ID. If the response is uncertain, reconcile the requested name and stored binding; never create a random suffixed duplicate or adopt an unrelated existing repository. Handle name conflicts and rename events safely.

Connect repository status and URLs to product pages and audit history. Default branches are not a worker's unrestricted write target. Keep destructive/visibility operations unavailable unless separately granted.

Verify wrong-owner rejection, default privacy, duplicate retries, uncertain creation, scope mismatch, name collision and interrupted push. If a matching standing grant permits a live disposable repository, perform one bounded smoke test; otherwise mark live creation unverified without blocking adapter completion. Exit with a working private-repository path.
```

Prompt 32 — manage pull requests, checks and exact-head merges. Requires 31.

```text
Apply the shared build contract. Implement Prompt 32: verified GitHub collaboration and releases.

Create PRs from task/integration branches with concise changes, acceptance evidence and studio links. Ingest GitHub webhooks with raw-body signature verification and delivery deduplication. Fetch/check native state when delivery is delayed or out of order. Link issues, commits, PRs, check runs and release artifacts to product history.

Implement merge admission requiring the exact reviewed head SHA, expected base, required passing checks, allowed grant and matching verified manifest. A changed head or unknown required check blocks the merge. Apply branch protection where the account plan permits; distinguish platform enforcement from the studio's own broker gate.

Use trusted reviewed CI templates and minimal workflow permissions. Generated or fork code must not receive production secrets or gain authority by editing workflow files. Workflow changes require the separate capability. Prepare draft releases from verified manifests; publication uses the existing release policy.

Verify stale head after review, failing/missing checks, duplicate webhook, revoked installation, rate limit and uncertain merge. Exit with the entire issue/branch/PR/check/merge trail visible in the studio. Run external mutations only where an existing scoped grant permits them.
```

Prompt 33 — build the Windows desktop client. Requires 32.

```text
Apply the shared build contract. Implement Prompt 33: the Tauri desktop application using shared UI.

Reuse packages/ui and the typed API client for catalog, product pages, search, history and finances. Add system-browser authentication, OS-protected credential storage, scoped downloads, opening source in an editor, notifications and worker-status controls. Do not expose a general shell command to the webview.

Keep the hosted database authoritative. A read-only offline cache must show its age and cannot claim current budget or running status. Implement clear online/offline/session-expired states. Native product launch actions should use the manifest recipe and an available worker, not execute arbitrary downloaded commands directly.

Configure narrow Tauri capabilities and safe external URL handling. Prepare a Windows development installer, labeled unsigned if signing is unavailable. Provide native build requirements and a separate distribution-signing path; do not fabricate successful native checks in a Linux-only environment.

Verify shared UI behavior plus native path handling, downloads, authentication redirect, expired session and denied native capabilities. On Windows, test a clean launch and installation when the environment supports it. Exit with a usable desktop client and a precise distinction between browser-tested and native-verified functionality.
```

Prompt 34 — pair local workers and launch products safely. Requires 33.

```text
Apply the shared build contract. Implement Prompt 34: device pairing and local execution control.

Use a short-lived one-time pairing challenge approved by the signed-in owner, device identity, revocable credentials and declared worker capabilities. The worker initiates an outbound authenticated connection and claims scoped leases. The website must not expose an unauthenticated shell endpoint on the owner's computer.

Add heartbeats, online/offline state, reconnect, fencing, revocation, capability matching and resource availability. Hosted assignments cannot select arbitrary local paths or exceed the paired workspace. Show queued work when the machine is asleep. Closing the desktop window and stopping its background worker must be distinct configurable actions.

Implement download checksum verification, supported manifest launch inside the worker environment, readiness, stop and cleanup from both interfaces. Record local execution results, resources and event times with source/received timestamps. Reject results from stale revoked devices.

Verify pairing replay, wrong owner, revoked device, offline queue, reconnect during a job, stale lease and product hash mismatch. Exit when a product selected in the website can be run by the paired online worker and inspected from the desktop without giving generated code access to studio secrets.
```

Prompt 35 — ingest and reconcile revenue records. Requires 34.

```text
Apply the shared build contract. Implement Prompt 35: Stripe revenue ingestion in test mode plus deterministic fixtures.

Verify current Stripe event and balance APIs. Receive webhooks using raw-body signature verification, persist before acknowledgment, deduplicate deliveries and reconcile authoritative object state asynchronously. Separate event identity from economic transaction identity so payment, charge, invoice, balance and payout events cannot count the same money repeatedly.

Map payments, fees, refunds, disputes, pending/available funds, settlements and payouts into balanced journal entries. Payout is a transfer, seed capital is not revenue, and pending receipts do not increase spendable budgets. Preserve provider/account/test-live identity and original currency units. Unsupported currencies remain excluded with a clear reason.

Add product/transaction attribution, reconciliation status, unknown exposure and a finance timeline. Record usable funding-rail status separately from processor availability. Provide periodic reconciliation and manual operator adjustments with evidence. A success page or agent report cannot create revenue.

Verify duplicate and out-of-order events, invoice/charge double counting, payout, partial refund, dispute, late fee and unavailable funds. Exit with accurate test-mode reports and live readiness configuration. Do not activate real payments or reinvestment in this step.
```

Prompt 36 — add checkout and verified customer entitlements. Requires 35.

```text
Apply the shared build contract. Implement Prompt 36: a complete test-mode purchase flow for one verified product.

Use hosted Stripe Checkout with server-owned product, price and release mappings. Start with a paid downloadable product. The backend creates purchase/session records and issues entitlements only from verified processor state. Never trust a browser success redirect, client-supplied price or agent-generated payment claim.

Provide a customer receipt/access page and authorized artifact retrieval linked to the purchased verified release. Keep studio-owner authentication separate from customer access. Implement expiration/revocation as appropriate, failed/pending payment states, refund handling, and support links. Define subscription entitlement interfaces, and implement subscription lifecycle only if the initial product recipe includes hosted paid access; clearly state coverage.

Feed economic events through Prompt 35's reconciliation, not a second revenue counter. Preserve campaign/product attribution without leaking customer data into agent context. Live mode requires completed merchant/account configuration and a matching activation grant; ordinary CI and development remain test mode.

Verify forged success redirects, altered prices, duplicate completion events, pending payment, refunded purchase, unauthorized download and exact-release entitlement. Exit with one test purchase that grants the right download exactly once and appears once in financial history.
```

Prompt 37 — implement controlled automatic reinvestment. Requires 36.

```text
Apply the shared build contract. Implement Prompt 37: the deterministic reinvestment engine from the implementation guide.

Create immutable ProfitTranches from reconciled closed-period records after costs, shared allocations, carried losses and configured protected provisions. Preserve each input, policy version and its original eligible surplus. Compute the tranche's maximum reinvestment amount once using its configured rate, then subtract previously allocated/voided capacity; never reapply the percentage to the original profit on every scheduler tick.

Limit each new envelope by unused tranche capacity, remaining period cap and verified liquid headroom through an eligible spending rail. Commit allocation, consumed capacity, journals and audit events atomically. Budget delegation cannot mint cash. Processor funds unavailable to the relevant provider must not fund its jobs.

Implement enable/pause/inspect controls and a standing policy with rate, absolute cap, reserve floor, target envelope split and expiry. Agents can propose explanations but cannot alter enforcement or invent revenue. Later refunds/fees reclaim unused allocations where possible, carry deficits and freeze expansion.

Test concurrent/repeated ticks, seed contributions, $550 at 40% with $150 headroom leaving only $70 tranche capacity, refunds after spending, policy changes and inaccessible funds. Exit with a fully simulated earnings-to-new-task path and live reinvestment inactive unless separately authorized after its gates pass.
```

Prompt 38 — add portfolio scheduling and conservation modes. Requires 37.

```text
Apply the shared build contract. Implement Prompt 38: scheduled operation constrained by money and maintenance capacity.

Support bounded schedules for source refresh, discovery, research, evaluations, maintenance and reinvestment checks. Persist timezone/UTC intent, occurrence identity, deduplication and catch-up rules. After an outage, avoid launching an unbounded backlog of missed occurrences. Every scheduled job passes the same grants, reservations and concurrency controls as a manual job.

Implement normal, conserve, maintenance_only and paused modes based on available budget, unknown exposure, worker capacity, review backlog and existing support obligations. Conserve reduces optional exploration and concurrency; maintenance_only uses a protected permitted allocation; paused starts no new paid work. Operator Stop cannot be overridden by revenue goals.

Allow configurable allocations between new ideas and existing product refinement, plus a capped exploratory queue. Prioritization includes usefulness, evidence, maintenance burden and owner preference rather than token output or short-term revenue alone. Show why work is selected or deferred.

Verify a budget transition, unpaid obligation, offline worker, repeated schedule tick, outage catch-up, protected maintenance task and explicit cancellation. Exit with a small simulated operating day that conserves funds and produces a readable work/finance timeline.
```

Prompt 39 — generate evidence-backed marketing experiments. Requires 38.

```text
Apply the shared build contract. Implement Prompt 39: marketing drafts and experiment planning.

Create a marketing role that reads the exact verified release, supported capabilities, audience research and known limitations. Generate positioning, landing-page copy, a demonstration script, screenshots from the actual product where possible, distribution hypotheses and a measurable experiment. Draft claims must link to product evidence; never fabricate testimonials, traction, users or benchmarks.

Persist Campaign records with product/release, content version, evidence, target audience provenance, proposed channel, recipients if applicable, metric, spending allowance and schedule. Add review/edit/compare UI, preserving history and invalidating prior approval when material content or scope changes.

Build the landing-page artifact through an existing template and private preview so the owner can review it concretely. Keep delivery separate; this step must not send emails, publish posts or purchase advertisements. Synthetic audience fixtures cannot appear as real leads.

Verify an unsupported performance claim, changed release, missing evidence, edited campaign and budget estimate. Exit with a real previewable launch package, a clear experiment definition and a linked review decision ready for the delivery integration.
```

Prompt 40 — deliver permitted campaigns and track outcomes. Requires 39.

```text
Apply the shared build contract. Implement Prompt 40: campaign execution through scoped adapters.

Implement landing-page publication through the release adapter and an optional Resend email adapter using current official APIs. Provide a deterministic fake transport and explicit test-recipient mode. Real sending requires configured account/domain plus a matching action or standing campaign grant covering content version/family, audience/recipients, cadence and cap. Do not treat connector credentials as blanket permission to message people.

Enforce suppression/unsubscribe records, deduplication, native operation IDs, time windows and resource reservations before each delivery. Material scope changes require a concrete new review. If the provider outcome is uncertain, reconcile before retrying; do not duplicate sends. Do not implement paid ads as a fake enabled button: leave them disabled until an actual provider, funding rail and verified limits exist.

Record permitted visits, conversions, purchases and feedback with attribution uncertainty and appropriate customer-data access. Connect expenses and observed results to the campaign/product. No invented marketing outcomes.

Verify replay, suppression, changed content, revoked grant, timeout, exhausted cap and a failed provider response. Exit with a full fixture campaign and a real adapter ready for authorized activation; no unsolicited live messages during implementation.
```

Prompt 41 — manage reusable components and agent-created skills. Requires 40.

```text
Apply the shared build contract. Implement Prompt 41: reviewed reuse and procedural improvement.

Create a registry of versioned product templates, reusable components, role prompts and skills. Store source/provenance, applicable license/use constraints, input/output/tool requirements, content hash, evaluation results and adoption history. Search these resources before a new build and link reuse to resulting products and shared cost allocation.

Allow agents to propose a new skill or modification after observing repeated work or failures. Build and evaluate the proposal in an isolated workspace against held-out cases. Activation is governed by an owner-approved improvement policy; the candidate cannot write its own passing label or bypass review. Keep rollback to the last qualified version.

Runtime finance enforcement, credential handling, permissions and deployment policy require trusted review outside ordinary self-improvement. Skills may request narrower tools but cannot expand a grant. Instructions fetched from a repository remain untrusted until processed through the registry policy.

Verify a useful reusable component, incompatible version, missing provenance, malicious skill instruction, evaluation regression and rollback. Exit when one proposed procedural improvement is evaluated and either safely adopted or rejected with evidence, and its later uses are searchable.
```

Prompt 42 — prepare hosted deployment and operational runbooks. Requires 41.

```text
Apply the shared build contract. Implement Prompt 42: a reproducible hosted reference deployment.

Create reviewed deployment configuration for the API/web app, persistent PostgreSQL, persistent Temporal service/workers, artifact storage and separate preview origin. Use the project's chosen container/hosting approach with TLS, authenticated private administration, validated configuration and separate generated-code worker environments. Do not expose a temporary development database or unrestricted worker service publicly.

Separate fixture/test, staging and live secrets/data. Provide migrations, readiness/health, queue and webhook monitoring, cost/exposure metrics, search lag and stale-preview cleanup. Implement artifact/log retention and a resource reaper. Store no credentials or signing keys in repositories, manifests or agent context.

Add backup/restore procedures for the catalog, journals, artifacts, required workflow state and configuration. Include a Windows signing/update configuration path with unsigned-development behavior clearly labeled. Document actual prerequisites, cost drivers, start/stop commands and rollback.

Run local/staging validation and prepare the exact deployment plan/artifact. Perform a live deployment only if the current session already authorizes that target and cost; otherwise finish the reviewable configuration and mark activation pending. Exit with a reproducible operational package and truthful readiness evidence.
```

Prompt 43 — verify security and permission boundaries. Requires 42.

```text
Apply the shared build contract. Implement Prompt 43: a focused security review and remediation pass.

Trace actual paths from user input, retrieved content, model tool calls, generated code, search and webhooks to privileged operations. Test forged/expired grants, source prompt injection, private-network fetch redirects, filesystem/symlink escapes, worker credential exposure, preview-to-dashboard access, SQL/query-plan injection, cross-workspace retrieval, stale downloads and secrets in traces/logs.

Review GitHub token scope, personal provisioning, workflow modification authority, untrusted CI code and exact-head merge gating. Review checkout entitlements, webhook signatures, financial posting authority and campaign recipient/content scope. Confirm every billable path, including subagents, embeddings, batches and compaction, reaches resource admission.

Use local synthetic targets and disposable controlled environments. Do not attack third-party systems. Fix concrete findings and add narrowly useful regression checks. Keep source evidence and reproduction steps for unresolved findings; do not mark them fixed merely because an AI reviewer says so.

Exit with a threat-boundary report tied to files and executed evidence, no unresolved critical issues in supported flows, and a clear list of any unverified environment-specific controls. Do not lower functionality tests or disable protections to pass this gate.
```

Prompt 44 — verify crash recovery and financial conservation. Requires 43.

```text
Apply the shared build contract. Implement Prompt 44: targeted failure-injection verification.

Inject process crashes at the boundaries before an external call, after external success but before persistence, after journal commit but before event publication, and during worker reassignment. Exercise duplicate/out-of-order GitHub and payment events, lost provider responses, rate limits, expired tokens, batch partial results and cancellation with in-flight cost.

Verify reconciliation prevents duplicate logical effects where supported and shows unknown outcomes where certainty is impossible. Financial/budget journals must remain balanced, conserved and attributable. Race many reservations and reinvestment ticks against one limited balance. Verify a refund after allocation freezes or adjusts future work without erasing history.

Replay active workflow versions, restart outbox/search consumers and run an actual restore drill into a disposable environment. Verify record counts, lineage, artifact references and financial totals after restoration. Confirm resource cleanup removes orphaned compute and stale workers cannot publish results.

Fix the observed failures. Exit with deterministic regression evidence and a recovery runbook stating the actual remaining limits. Do not claim exactly-once provider execution or perfect restoration based solely on mocked successful responses.
```

Prompt 45 — measure scale, cost and interface performance. Requires 44.

```text
Apply the shared build contract. Implement Prompt 45: performance measurement against declared workloads.

Create a representative synthetic catalog with approximately 10,000 ideas and 100,000 events, including many-to-many lineage, artifacts, costs and search scopes. Record environment/hardware, dataset/version, configuration, concurrency and p50/p95/p99 results. Measure catalog/search, bounded lineage traversal, finance aggregation, event lag and artifact/preview startup separately.

Use the implementation guide's targets as goals to evaluate, not claims already achieved. Inspect query plans and remove concrete N+1 calls, unbounded joins, duplicated fetches or oversized event payloads. Preserve authorization and correct shared-cost totals. Add appropriate limits/pagination rather than loading the entire graph into the browser.

Run the routing/context benchmark and compare total cost per accepted task with the Astra baseline, including failures, repair, evaluations and optimization overhead. Separate fixture performance from live model performance and state sample uncertainty. Do not claim savings from counterfactual estimates alone.

Exit with reproducible performance commands, measured reports, targeted fixes and any unmet targets explicitly recorded. Stop broad optimization once the remaining bottlenecks and acceptance risks are sufficiently understood.
```

Prompt 46 — run complete product acceptance and close gaps. Requires 45.

```text
Apply the shared build contract. Implement Prompt 46: the full acceptance checkpoint.

Execute the supported end-to-end scenario: theme -> cited research -> independent concepts -> selected spec -> reserved budget -> isolated code -> independent review/tests -> private preview/download -> owner feedback -> verified revision. Trace every cost and artifact to its originating work. Ask the audit interface what changed, where, when, why and what it cost, checking answers against records.

Exercise configured private GitHub creation/PR/check flow, Windows client/paired worker, qualified model routing and rollback. Run a test purchase, reconcile it once, form an eligible profit tranche and allocate only usable permitted funds to one bounded next task. Prepare a marketing campaign and execute only its fixture/test transport unless live delivery was explicitly authorized.

Compare every product-overview requirement with actual implementation and evidence. Classify gaps as missing, partial, fixture-only, contract-tested, live-verified or activated. Repair in-scope integration gaps and update the status/decision/integration documents. Do not report external or native success that the environment cannot verify.

Exit with an acceptance report, exact version/manifests, reproducible commands and a concrete list of configuration steps remaining for the owner. The existence of 48 completed-looking status rows is not acceptance evidence.
```

Prompt 47 — prepare and run a bounded owner pilot. Requires 46.

```text
Apply the shared build contract. Implement Prompt 47: operational handoff and the initial pilot configuration.

Prepare a concrete pilot using owner-selected research themes, the documented budget envelope, three concurrent model jobs, one active build, finite repair cycles, private repositories and explicit release/campaign/reinvestment policies. Show actual connected providers, usable funding rails, current pricing, allowed targets, reserve settings, unknown exposure and Stop behavior before activation.

Use existing matching authorization when present. Otherwise prepare every configuration and reviewable artifact first, then identify only the specific live activation decision that remains. Never interpret running this coding prompt as permission to make unspecified purchases, send campaigns, change account access or charge customers.

For an authorized pilot, execute a small capped workload and record actual costs, quality, interventions, failures and useful outcomes. Verify pause/cancel, daily summary in the app, resource cleanup, source freshness and maintenance scheduling. Keep marketing and reinvestment separately activatable so one missing integration does not disable the working studio.

Create docs/OPERATIONS.md with startup/shutdown, backups, recovery, credential rotation, budget changes, model-policy rollback, repository management, release, refund handling and archival. Exit with a working pilot or a fully prepared activation package, plus evidence-based next priorities. Do not claim profitability or continuous reliability from one demonstration.
```

Use this optional prompt to resume a fresh coding session at the correct point.

```text
Read the shared build contract in docs/PROMPT_LIBRARY.md, the overview, implementation guide, BUILD_STATUS and actual repository state. Identify the earliest unmet prerequisite for the next intended prompt. Verify prior completion from files and targeted evidence; do not repeat completed work without a concrete reason. Continue the next eligible bounded prompt through implementation and verification. Preserve user changes and session authorization. If a live integration is unavailable, complete independent work and report its exact readiness state. Update BUILD_STATUS before ending.
```

Use this optional prompt when a gate fails.

```text
Apply the shared build contract. Investigate the failed gate described below using actual logs, current code and the relevant acceptance criteria. Reproduce the smallest meaningful failure, identify the root cause, and implement a focused repair. Preserve the intended feature, security boundaries and budget invariants; do not delete assertions, replace real paths with fixtures, or mark the failure acceptable merely to proceed. Run the relevant regression and affected integration path, then update BUILD_STATUS with evidence and remaining limitations. Failure details: paste the actual error, command and relevant context after this prompt.
```

Use this optional prompt to review a completed milestone before expanding scope.

```text
Review the current milestone against PRODUCT_OVERVIEW, IMPLEMENTATION_GUIDE and its numbered prompts. Inspect the real API/UI/worker paths and supporting checks. Focus on disconnected scaffolding, missing authorization or metering, fabricated integration readiness, cost double-counting, stale verification, unbounded retries, secret exposure, and state lost on restart. Report only actionable findings with file references, impact and reproduction or supporting evidence. If requested to fix the milestone, make bounded repairs and reverify; otherwise remain read-only. Separate observed defects from unverified risks and implementation suggestions.
```
