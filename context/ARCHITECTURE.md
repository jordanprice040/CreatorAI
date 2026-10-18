# Architecture and application contracts

Proposed implementation design. Preserve compatible existing code after T00; no directory listed here is claimed to exist yet. Earlier detail is in references/IMPLEMENTATION_GUIDE_2026-09-08.md. Current oversight and experiment requirements take precedence.

## Boundaries

| Component | Responsibility | Must not own |
| --- | --- | --- |
| Web/CLI/desktop clients | Submit intentions, inspect records, review decisions, download/test products | Provider secrets, authoritative budget arithmetic, arbitrary worker commands |
| Management API | Authentication, scoped commands, queries, subscriptions | Generated-code execution |
| Domain and policy layer | Transitions, scope/grants, mode and intervention rules | Model-supplied permission decisions |
| Workflow runner | Durable scheduling, waits, bounded attempts, cancellation | Untracked external effects |
| Model/tool brokers | Admission, context/data boundaries, metering, tool enforcement | Unmetered fallback paths |
| Execution supervisor | Disposable product workspaces, leases, tests, quotas | Portfolio credentials or arbitrary personal filesystem access |
| Database/audit/search | Versioned facts, many-to-many links, projections, corrections | Source code as the only record of experiments |
| Artifact/Git services | Exact commits, manifests, evidence, exports, preview recipes | Unversioned ready-status claims |

Proposed paths: apps/api, apps/web, apps/cli, apps/orchestrator, apps/worker, later apps/desktop; packages/contracts, domain, db, policy, providers, agents, finance, context, evals, search, artifacts, integrations, ui. Create a package only when an implementation needs it. T00 records an actual path map.

## Smallest useful path

CLI or web submission → validated run contract → atomic resource admission → one bounded role → structured result and usage → persistent catalog/audit → visible result after restart. Expand into evidence discovery and one generated product only after this works.

A local deployment uses local authoritative records and artifacts. API model requests disclose the approved context to the configured provider. A later hosted deployment moves control services deliberately, shares one authority between web and desktop, and uses outbound authenticated worker pairing. Local machine sleep stops local execution; hosting a website does not keep that worker running.

## Entity and provenance design

All owned records have stable IDs, workspace/access scope, and immutable version or optimistic update version. Store UTC event/retrieval timestamps, original source dates, and timezone intent for schedules. Sequence committed events using a database order, not worker clock order.

| Group | Required records |
| --- | --- |
| Evidence | Source, SourceVersion, Claim, EvidenceLink, retrieval attempt, independent-origin cluster |
| Discovery | SearchBrief, Problem, Alternative, Idea, Assessment, RubricVersion, Assumption |
| Human decisions | DecisionRequest, HumanIntervention, StandingGrant, PolicyVersion, dissent/override |
| Product | Product, SpecificationVersion, Task, TaskDependency, feedback, maintenance plan |
| Execution | Run, Attempt, AgentConfig, PromptVersion, ContextPack, ModelCall, ToolCall, worker lease |
| Delivery | Repository, commit/PR, BuildManifest, Artifact, TestRun, Review, Preview, Release |
| Resources | PricingSnapshot, UsageRecord, BudgetEnvelope, Reservation, financial and budget journals |
| Research | StudyProtocol, TaskPacketVersion, Assignment, ExperimentRun, participant code, rating, deviation, analysis version |
| Later commerce | RevenueEvent, settlement, entitlement, profit tranche, allocation, campaign |

Typed links include supports, contradicts, derived_from, uses, implements, verifies, supersedes, forks, reuses, funded_by, and released_as. Preserve version endpoints and the origin of each assertion. Support one idea leading to multiple products and products combining multiple ideas. Prevent cross-scope links and impossible endpoint types.

Example queries that must work: “Which sources support this feature?”, “What changed after this human intervention?”, “Which commit did these tests execute?”, “Which projects reused this component?”, “How much did failed attempts cost?”, “Which earnings funded this envelope?” The final question applies only after commerce exists.

## Task and result contracts

TaskContract fields: schema_version; task/run/project/spec IDs; role and experiment condition; goal/non-goals; input references and hashes; allowed tools/data/output destinations; workspace/file scope; dependencies; acceptance criteria; output schema; grant/policy IDs; model policy; budget envelope; call/token/output/deadline/concurrency/child/depth/repair limits; idempotency key; cancellation/lease identity.

TaskResult fields: task/attempt/config identity; status; summary; artifact/commit references; evidence and claim links; unresolved assumptions; alternatives/recommendation; human-decision request if any; actual known usage and unknown exposure; checks actually executed; blockers; next permitted action.

Templates are examples, not executable validation. T01 creates and tests runtime schemas. Reject incomplete contracts before dispatch. A child can receive only a subset of its parent's authority and resource allocation.

## Three distinct state dimensions

**Product lifecycle:** captured → researched → alternatives_compared → experiment_ready or build_ready → building → verifying → ready_to_try → iterating or release_candidate → released → maintained/archived. Legitimate terminal discovery outcomes include existing_solution_recommended, nonsoftware_recommended, human_led_recommended, deferred, and rejected.

**Execution state:** queued, admitted, running, waiting_dependency, waiting_human, paused_budget, paused_operator, reconciling, succeeded, failed, cancelled. Keep outcome reasons distinct. “Waiting for approval” is not permission.

**Research condition:** autonomous, human_in_loop, human_only. Store discovery method separately: structured, open_ended, or human_defined. Neither is the product's global autonomy setting.

Only domain code can advance a stage after checking evidence and expected versions. Human-only execution cannot access model or generative helper paths. Autonomous human-needed outcomes terminate or defer according to the frozen protocol; a later assisted continuation becomes a separately linked run.

## Durable execution and external effects

If using Temporal, put model/network/database/external effects in Activities; keep Workflows deterministic. Verify the installed SDK before using API names. Store large results by artifact reference. Bound retries and checkpoint individual steps rather than replaying a whole expensive session.

Persist intent before dispatch and observed outcome afterwards. Use stable logical operation IDs across attempts, provider idempotency where supported, and reconciliation after unknown results. Exactly-once arbitrary external effects are not assumed.

Use atomic state + audit + outbox commits, idempotent consumers, expiring worker leases, fencing tokens, heartbeats, optimistic concurrency, and process-tree cancellation. Pause stops new dispatch; cancel also requests termination. Calls already in flight may still incur cost.

## Resource and finance enforcement

Maintain separate financial reality and permission-to-spend journals. Use exact integer/decimal arithmetic, decimal-string JSON, and currency/unit metadata; the prior internal nano-USD convention is a valid proposed starting point. Do not use floating-point currency math.

Atomically reserve bounded maximum exposure across global, period, run, and child envelopes before any billable action. Track allocated, available, reserved, in-flight, incurred, reconciled, and unknown amounts separately. Include search, embeddings, retries, summaries, tools, sandbox leases, storage, and enabled campaigns. Parent-to-child transfers conserve authority; reports must not double-count them.

Provider usage fields must map to disjoint billing categories. Reasoning tokens may already be included in billed output: verify the provider's definition instead of adding them twice. Missing pricing/usage blocks unsupported dispatch or holds a conservative exposure estimate; it is never zero.

The first thesis build needs owner-funded budgets and cost reconciliation, not live commerce. Later revenue records use verified economic events, balanced corrections, usable funding rails, reserves, liabilities, and one-time allocation of each profit tranche. Pending receipts and seed funding are not sales surplus. Reinvestment is a budget allocation, not an automatic bank transfer.

## Isolation, privacy, and security

Generated code runs in a disposable, non-root environment with CPU/memory/disk/time limits, narrow canonicalized paths/mounts, restricted network, synthetic test data, no host daemon socket, no personal profile, and no studio secrets. A dedicated worker VM or equivalent boundary supplements containers. If isolation is unavailable, report the gate blocked; do not silently execute untrusted code on the host.

Fetch brokers enforce protocols, byte/time caps, redirect checks, private-address/cloud-metadata blocking, and connector scope. Validate DNS/resolution at connection boundaries rather than trusting an initial URL string. Treat fetched instructions as untrusted evidence.

Previews use a separate origin and explicit owner access, expiry, readiness, and resource leases. Never serve untrusted app scripts in the management origin. Downloads identify exact version, checksum, requirements, and whether they are source archives, runnable packages, or native installers.

Authorize retrieval before snippets, counts, reranking, aggregates, downloads, and answer generation. Secrets and sensitive study records stay out of searchable summaries and external traces. Append corrections; preserve non-sensitive tombstones when protected payloads are removed. A hash chain is tamper-evident only under stated trust assumptions.

## Verification contract

Review/QA refer to a frozen spec and candidate commit. Store executed command, environment, result, timestamps, and artifact paths. Builder reports alone cannot set ready status. New commits/specs invalidate affected checks and approvals. Re-extract and start the exported package in a clean environment.

One initial concept revision and two repair cycles are proposed defaults. Bound all loops by actual resource limits. Declare implementation, fixture verification, contract verification, live verification, and activation independently.
