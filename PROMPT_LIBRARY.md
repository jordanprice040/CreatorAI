# Creator Agent — implementation prompt library

Before executing X01/X02/X03/X04/X05 or completion-runbook work, read the relevant entries in [accepted owner decisions](tracking/OWNER_DECISIONS_2026-10-20.md). Settled choices supersede historical prompt defaults; implementation and activation remain separate.

Version 3.0 • October 9, 2026

Use one requested milestone per coding session, or an explicitly authorized sequence. These prompts build the application; they do not start an unrestricted autonomous business. Read AGENTS.md first. T00–T19 prioritize the thesis. X01–X10 retain the broader product. U01–U05 support continuity and review.

## Shared implementation contract

Every milestone below inherits this contract:

~~~text
Implement the requested milestone in the actual Creator Agent repository.
Read AGENTS.md, PROJECT_CONTEXT.md, relevant context documents, and current
tracking files. Inspect before editing; preserve user work and compatible
architecture. Complete the real application path and use current official
API documentation. Never invent availability, results, citations or revenue.

Use deterministic enforcement for authority, budgets, run conditions and
verification. Honor existing scoped approvals; do not repeatedly ask for
routine authorized work. Complete unblocked implementation and fixture
verification before reporting missing credentials or external authority.
Do not activate ungranted paid/external effects.

Run meaningful checks for the changed behavior and stop optional testing
once the gate is adequately verified. Record implementation, fixture,
contract, live and activation states separately. Update tracking files with
actual evidence, blockers, decisions and the next eligible prompt. Report
what works, what changed, what was checked, and the remaining limitations.
~~~

All current context rules apply even if a short prompt does not restate them. Legacy numbered prompts in references are archived detail, not another sequence to execute.

## Milestone index

| ID | Outcome | Prerequisites |
| --- | --- | --- |
| T00 | Repository intake and verified starting point | None |
| T01 | Minimal workspace, typed contracts, and lifecycle | T00 |
| T02 | Persistence, provenance, and durable audit | T01 |
| T03 | Human decisions, autonomy modes, and humility | T02 |
| T04 | Budgets and a metered model/tool broker | T03 |
| T05 | Durable bounded orchestration and recovery | T04 |
| T06 | Source ingestion, claim support, and research boundaries | T05 |
| T07 | Locator and competing response generation | T06 |
| T08 | Versioned scoring, selection, and frozen specifications | T07 |
| T09 | Usable catalog, decisions, search, and run monitor | T08 |
| T10 | Study runner and human-only workflow | T09 |
| T11 | Isolated execution and local product Git | T10 |
| T12 | Bounded builder, independent review, and QA | T11 |
| T13 | Verified artifacts, private preview, and feedback revision | T12 |
| T14 | Pilot, rubric calibration, and protocol freeze | T10 and T13 |
| T15 | Final evaluation and blinded rating package | T14 with adopted protocol |
| T16 | Reproducible analysis and limits | T15 and actual ratings/outcomes |
| T17 | Failure recovery, boundary checks, and requirements audit | T13; may run alongside preparation for T14–T16 |
| T18 | Thesis, committee review, and defense preparation | T16 and T17, or documented missing-data limits |
| T19 | Final thesis acceptance and reproducibility archive | T18 |
| X01 | Model registry and qualified automatic routing | T10 and measured task outcomes |
| X02 | Context selection, caching, compaction, and batches | X01 |
| X03 | Comprehensive search, lineage, and audit questions | T09 and T13 |
| X04 | Scoped GitHub management | T13 and policy/broker coverage |
| X05 | Windows desktop and paired local workers | T13 |
| X06 | Hosted operation and observability | T17; X05 only for hosted-to-local pairing |
| X07 | Payments, entitlements, revenue and reinvestment | T17 and required integration infrastructure |
| X08 | Evidence-backed marketing and measured feedback | T13; X06/X07 only where distribution/payment requires them |
| X09 | Portfolio scheduling, maintenance, and reusable knowledge | T13; X01/X07/X08 for their enabled features |
| X10 | Full-product acceptance and bounded owner pilot | Applicable X01–X09 gates |

## T00 — Repository intake and verified starting point

Prerequisites: None.

~~~text
Apply the shared implementation contract. Execute T00: Repository intake and verified starting point.

Read the canonical kit and inspect the actual repository, instructions, working tree, packages, source, tests, and CI. Determine whether this is an empty Creator Agent repository or an earlier local-agent project. Identify reusable functionality from actual code; do not infer that it exists from planning documents. Do not alter the separate senior-project repository.

Create an actual path map and architecture ADR in tracking/DECISIONS.md. Reconcile any existing instructions with this kit and retain user changes. Record model/provider availability as unverified unless observed. Identify the smallest useful local vertical slice, real commands, missing prerequisites, and remaining consequential choices. Use reversible defaults for routine choices; do not demand answers to every open question before useful work.

Update tracking/BUILD_STATUS.md, tracking/INTEGRATIONS.md, and tracking/SESSION_HANDOFF.md. Run a small relevant baseline if code exists. Keep broader product features visible as deferred rather than deleting them.

Acceptance gate: A truthful inventory, dependency/path map, baseline evidence, and next step. No application-wide scaffolding, external provisioning, or guessed progress.
~~~


## T01 — Minimal workspace, typed contracts, and lifecycle

Prerequisites: T00.

~~~text
Apply the shared implementation contract. Execute T01: Minimal workspace, typed contracts, and lifecycle.

Using the adopted architecture, create the smallest runnable TypeScript workspace with API, CLI, and a thin React web page. Add strict type checking, lockfile, configuration validation, formatting, and relevant test commands. Use current official dependency documentation. Reserve later paths without creating empty packages everywhere.

Implement executable runtime validation for task/result, run configuration, source/claim, alternatives, assumptions, decision requests, costs, entity links, and experiment assignments. Use exact-money serialization. Keep product lifecycle, execution state, research condition, and discovery method separate. Include non-software, existing-tool, human-led, deferred, and failed outcomes.

Validate required limits before paid work, delegation containment, allowed transitions, expected versions, and outcome evidence. Define schema versions and error codes. Implement a deterministic fake provider for local demonstration, clearly labeled. Provide working CLI and web-to-API health paths and local startup instructions that match actual scripts.

Acceptance gate: A clean install/build and working health path, plus meaningful malformed-contract and invalid-transition checks. No claimed real AI or research capability.
~~~


## T02 — Persistence, provenance, and durable audit

Prerequisites: T01.

~~~text
Apply the shared implementation contract. Execute T02: Persistence, provenance, and durable audit.

Add persistent PostgreSQL storage, migrations, and initial repositories for sources/versions/claims, problems/alternatives/assessments, products/specs, tasks/runs, decisions/grants, and typed many-to-many links. Separate fixture data from real records. Use stable IDs, UTC timestamps, optimistic updates, access scopes, and transactional integrity.

Commit state mutations with audit events and an outbox. Include actor, causal/correlation IDs, relevant version/hash, and safe payload references. Implement idempotent projection updates and corrections rather than silently editing history. Preserve source deletion/redaction with non-sensitive tombstones.

Expose real creation/read/link/archive paths in API/CLI and a minimal history view. Persist source-to-idea-to-product and task-to-artifact relationships; do not reduce everything to a single parent ID. Keep actual source/large artifacts outside workflow history.

Acceptance gate: Records survive process restart; stale updates and cross-scope links fail; duplicate outbox delivery does not duplicate visible history. Demonstrate one product from two ideas and one idea with two descendants.
~~~


## T03 — Human decisions, autonomy modes, and humility

Prerequisites: T02.

~~~text
Apply the shared implementation contract. Execute T03: Human decisions, autonomy modes, and humility.

Implement context/HUMAN_OVERSIGHT.md through deterministic domain rules and a real decision API/UI. Use an established session/OIDC approach for the owner workspace with appropriate secure cookies, CSRF/origin protection and backend authorization; do not invent authentication cryptography. Development fixture authentication must fail validation in hosted mode. Distinguish clarification, judgment, authorization, and feedback. Create versioned standing grants, explicit actor/target/content/spec bindings, expiry/revocation, and durable decision requests.

Implement supervised, human-in-the-loop, autonomous-within-scope, and human-only paths. Run condition must not be a cosmetic UI label. Autonomous runs cannot obtain task-specific human help or self-approve; unresolvable decisions defer/stop. Human-only paths cannot call models, including hidden summaries. Covered routine actions proceed without repeated approval.

Add assumption records, reasons to request human input, and a pre-build humility gate comparing software, existing tools, process change, human-led action, hybrid action, and defer/decline. Require concise rationale/evidence without private reasoning. Add approve-once versus standing-policy distinctions and show exactly what a decision covers.

Acceptance gate: Test changed/expired approvals, cancellation, duplicate decisions, an autonomous needs-human outcome, human-only model denial, and a routine reversible action that proceeds without unnecessary interruption.
~~~


## T04 — Budgets and a metered model/tool broker

Prerequisites: T03.

~~~text
Apply the shared implementation contract. Execute T04: Budgets and a metered model/tool broker.

Implement exact resource accounting, owner-funded envelopes, atomic reservations, parent-child conservation, known/unknown exposure, and cost settlement. Record estimates separately from authoritative usage. Include retry, summary, search, embedding, tool and compute costs as applicable. Example caps are not live authorization.

Build one application-owned ModelBroker with fake and real provider adapters. Verify current official API/model capabilities; preserve the requested reference model if accessible, and disclose if it is not. Keep credentials only on the trusted backend and normalize disjoint billing fields without double-counting reasoning tokens.

Route every agent and nested model/tool request through admission. Reject missing limits/pricing without a defensible configured bound. Handle malformed outputs, cancellation, rate limits, and unknown response outcomes. Expose a useful budget/error view. Complete fixture and contract verification even when no key is present.

Acceptance gate: Concurrent reservations cannot overspend an envelope; a denied call never reaches the provider; late results reconcile without duplicate charge. A small live call occurs only under an actual existing spend grant.
~~~


## T05 — Durable bounded orchestration and recovery

Prerequisites: T04.

~~~text
Apply the shared implementation contract. Execute T05: Durable bounded orchestration and recovery.

Implement a finite coordinator around the domain contracts. Use the adopted durable workflow backend; for Temporal, verify installed APIs and keep external effects in Activities. Persist step checkpoints, logical operation IDs, attempts, parent-child relations, call/depth/concurrency limits, deadlines, and context versions.

Add dependency waits, waiting-human state, pause/cancel/resume, worker leases and fencing, outbox integration, and resource cleanup. An external timeout with unknown effect enters reconciliation rather than an automatic duplicate retry. A closed UI must not imply that the worker stopped.

Connect one bounded role to CLI and web submission, execution progress, structured result, audit, and usage. No endless agent debate; a coordinator must choose a permitted next step or terminate. Implement minimal task-specific context with immutable constraints and artifact references.

Acceptance gate: A run survives restart, duplicate delivery, and waiting for a decision; stale workers cannot commit; cancellation stops further delegation and preserves in-flight exposure.
~~~


## T06 — Source ingestion, claim support, and research boundaries

Prerequisites: T05.

~~~text
Apply the shared implementation contract. Execute T06: Source ingestion, claim support, and research boundaries.

Implement an approved source/search adapter and deterministic fixture adapter through a fetch/tool broker. Retain source URL/identity, version/hash, retrieval and publication dates where known, permitted excerpts, exact locators, extraction state, access classification, and failures.

Enforce protocol/destination/redirect/private-network restrictions, byte/time limits, credential isolation, and permitted retention. Distinguish a source's assertion, a quotation, supported observation, and inference. Record contrary evidence and source-origin clusters so reposts are not independent corroboration.

Connect claim-to-passage support and source freshness to the catalog. Explicitly label inaccessible or insufficient evidence; never create invented citations. Research text cannot change policy or invoke tools directly.

Acceptance gate: Demonstrate supporting and non-supporting real passages in fixtures, conflicting sources, changed versions, inaccessible pages, a private-address redirect, and malicious retrieved instructions without authority expansion.
~~~


## T07 — Locator and competing response generation

Prerequisites: T06.

~~~text
Apply the shared implementation contract. Execute T07: Locator and competing response generation.

Implement the locator using a search brief: theme, two fields to consider intersecting, target users, geography/context where relevant, measurable problem, data/tool availability, time, and budget. NAE Grand Challenge themes are optional seeds, not an excuse for overly broad projects.

Identify affected users, urgency/frequency, workarounds, alternatives, and a mechanism by which software could help. Create independent proposals that initially see the same evidence but not each other's answers. Include meaningful software, existing-tool, non-software/process, human-led, or hybrid alternatives; explain exclusions.

Run a bounded skeptic pass seeking counterevidence, duplicates, infeasible assumptions, novelty overclaims, and cheaper disconfirming tests. Allow at most the configured revision count. Preserve proposals and dissent; no forced minimum number of build recommendations when evidence is weak.

Acceptance gate: Fixture runs show cross-field reasoning, a known duplicate, a justified existing-tool/non-software choice, a software-suitable case, and insufficient evidence. Initial proposal context proves independence.
~~~


## T08 — Versioned scoring, selection, and frozen specifications

Prerequisites: T07.

~~~text
Apply the shared implementation contract. Execute T08: Versioned scoring, selection, and frozen specifications.

Implement context/SCORING_RUBRIC.md with evidence-linked anchors, equal proposed weights, missing-value handling, uncertainty, reviewer disagreement, and override history. Keep software-opportunity ranking separate from general solution suitability so non-code options are not penalized merely for lacking software influence.

Add deterministic score calculation, complete/incomplete display, optional bounds, and sensitivity reports. Ethics/access gates are separate from numeric ranking. Preserve why a candidate was rejected or deferred.

For selected software, create a versioned spec with audience, user flows, scope/non-goals, data/contracts, measurable acceptance checks, risks, maintenance requirements, and a scoped task DAG. Validate cycles and ownership conflicts. Selection uses the current run policy: human gate where configured; preauthorized autonomous selection otherwise. Never force a non-code recommendation into build-ready.

Acceptance gate: Score arithmetic/unknowns are reproducible; human overrides retain original scores; a high score cannot bypass an unresolved gate; spec changes invalidate affected task/approval versions.
~~~


## T09 — Usable catalog, decisions, search, and run monitor

Prerequisites: T08.

~~~text
Apply the shared implementation contract. Execute T09: Usable catalog, decisions, search, and run monitor.

Deliver a real interface for theme submission, idea/problem/alternative comparison, source passages, assumptions, scores, human decisions, product stages, tasks, costs, and activity. Use existing API/domain paths and preserve state after refresh. Build basic full-text/exact-ID/filter search and bounded lineage traversal now.

Provide pause/cancel and visible waiting/blocked states, actor/timestamp explanations, source freshness, incomplete evidence, and proper loading/empty/error behavior. Respect permissions before snippets and aggregates. Expose fixture mode explicitly.

Show actual available actions only. Reserved gallery areas must not pretend downloads or previews exist. Reuse components for the future desktop shell. Use accessible contrast, keyboard operation, responsive layout, and meaningful labels; dark appearance may be a default but is not a gate by itself.

Acceptance gate: Browser checks exercise submit → inspect evidence → compare → decide → search history, plus budget denial and permission revocation. Inspect the rendered UI and repair consequential defects.
~~~


## T10 — Study runner and human-only workflow

Prerequisites: T09.

~~~text
Apply the shared implementation contract. Execute T10: Study runner and human-only workflow.

Implement context/EVALUATION_PROTOCOL.md before final experiments. Create versioned task packets, protocol/config manifests, assignment and condition isolation, frozen artifact hashes, raw metrics, intervention capture, and deviation tracking.

Support autonomous, human-in-the-loop, and human-only submissions for the same problem packet. A human-only workspace allows ordinary document/code/artifact entry and conventional test execution but no generative helper calls. Keep reviewer labels/hidden tests outside all participant and agent contexts.

Implement structured and open-ended AI discovery as separately versioned workflows with comparable caps and neutral output formats. The baseline must not accidentally inherit the structured role/rubric treatment. Track active effort, wait and wall time, total usage/exposure, failures, and assigned condition. Include needs-human stops without relabeling them as successful autonomous completion.

Acceptance gate: Synthetic runs validate isolation, no hidden human-only model calls, condition-stable failures, intervention logs, and complete export. Synthetic data must not appear as empirical results.
~~~


## T11 — Isolated execution and local product Git

Prerequisites: T10.

~~~text
Apply the shared implementation contract. Execute T11: Isolated execution and local product Git.

Implement a trusted supervisor for a reviewed generated-product template in a disposable, resource-limited environment. Enforce non-root execution, canonical workspace/file scopes, narrow mounts, network policy, process-tree cancellation, leases, and cleanup. Do not expose personal files, management credentials, cloud metadata, or the host container daemon.

Create separate local product repositories, task branches/worktrees, exact base commits, scope checks, and one integration owner. Preserve user edits and surface merge conflicts; no destructive resets as conflict resolution. All commands use typed tool arguments and trusted recipes.

Record tasks, changed files, commits, logs, and environment identity. A missing isolation capability is a concrete blocked verification, not permission to run generated code on the unrestricted host.

Acceptance gate: A harmless template builds in the real constrained environment; path/symlink escape, secret reads and forbidden network fail; cancellation terminates child processes; conflicts/stale patches preserve work.
~~~


## T12 — Bounded builder, independent review, and QA

Prerequisites: T11.

~~~text
Apply the shared implementation contract. Execute T12: Bounded builder, independent review, and QA.

Connect planner tasks to the builder role and scoped tools. Give only the frozen spec, relevant interfaces/evidence, file map and task contract. Bound calls, time, budget and repairs. Commit submitted work and preserve partial code on failure.

Add an independent reviewer with fresh task context and QA execution against the exact candidate. The reviewer has no authority to relax acceptance criteria. QA verifies core flows, important errors, persistence where required, and relevant security boundaries; use browser tests for web behavior.

Persist executed commands/results and useful traces. A builder's success summary is not a test result. Changed commits or specs invalidate affected evidence. Repair at most the configured two cycles before a clear checkpoint. Role separation does not eliminate correlated model errors.

Acceptance gate: One small task reaches verified candidate status; deliberately broken behavior, unsupported success claims and changed reviewed commits fail. Tests are actually executed on recorded versions.
~~~


## T13 — Verified artifacts, private preview, and feedback revision

Prerequisites: T12.

~~~text
Apply the shared implementation contract. Execute T13: Verified artifacts, private preview, and feedback revision.

Create a build manifest with exact repository/commit/spec/template/toolchain/lockfile versions, artifact hashes, startup requirements, test evidence, and limitations. Package source and supported runtime output; re-extract and start the exported package in a clean environment.

Add private previews using separate-origin isolation, owner access, resource leases, readiness, expiry and stop. Wire real gallery actions to verified manifests, rechecking access at download/start time. Source archive, runnable demo and native installer are distinct availability labels.

Record feedback on an exact version; convert accepted feedback into a versioned spec revision and tasks. Preserve old artifacts and link the new commit/tests/costs. Complete one feedback-driven revision. Public publication remains a distinct authorized action.

Acceptance gate: The owner can inspect a tested preview, download and start the exact artifact, submit feedback, and compare a reverified revision. Hash mismatch, expired preview, revoked access, and stale version checks work.
~~~


## T14 — Pilot, rubric calibration, and protocol freeze

Prerequisites: T10 and T13.

~~~text
Apply the shared implementation contract. Execute T14: Pilot, rubric calibration, and protocol freeze.

Prepare one small pilot task per autonomy condition and one structured/open-ended discovery pair using the protocol. Run live pilot work only within approved model/data/budget boundaries; human task participation requires actual available participants and applicable review decisions.

Verify metrics, intervention timing, source validation, condition contamination controls, and reviewer materials. Estimate effort/cost to choose feasible final counts. Distinguish instrumentation failures from substantive task failures and retain both.

Write a pilot report and concrete proposed final protocol: primary outcome, task strata, counts, participant/reviewer plan, resource limits, model/prompt/rubric versions, missing-data and stop rules, analysis, and limitations. Keep final tasks separate. Freeze the adopted protocol/hash only after the owner has settled the consequential research decisions; complete preparation before asking for those decisions.

Acceptance gate: A reproducible pilot package, justified feasible design, and either an adopted freeze manifest or a precise list of blocking research decisions. No invented participants, ratings, approvals, or results.
~~~


## T15 — Final evaluation and blinded rating package

Prerequisites: T14 with adopted protocol.

~~~text
Apply the shared implementation contract. Execute T15: Final evaluation and blinded rating package.

Execute the frozen assignment schedule within available authorization and resources. Preserve identical task packets across matched conditions, isolation of outputs and hidden grading material, exact versions, caps, and actual human involvement. Do not alter prompts midway to rescue a condition.

Retain every assigned run and its failure/deferred/cancelled/blocked state. Keep infrastructure retries and protocol deviations according to the predefined rules. Record source-support audits and functional checks separately from model self-ratings.

Produce consistently formatted, randomized, condition-blinded reviewer packets where practical, a private assignment key, and raw exports. Do not send materials to others without an actual instruction to send. Human-only and human-assisted runs require real human work; simulation can test plumbing only.

Acceptance gate: All available planned runs have truthful outcomes and evidence, with missing runs explicit. Reviewer packets are ready and graders cannot see hidden condition metadata through filenames or templates.
~~~


## T16 — Reproducible analysis and limits

Prerequisites: T15 and actual ratings/outcomes.

~~~text
Apply the shared implementation contract. Execute T16: Reproducible analysis and limits.

Analyze the frozen primary outcomes, task-level paired comparisons, completion, evidence validity, intervention quality, cost, latency and human effort. Account for related ideas within runs and repeated observations from one participant. Choose uncertainty summaries appropriate to the actual sample; do not invent power.

Include all assigned runs in the primary accounting. Report missing ratings, unknown billing, infrastructure failures and deviations. Keep decision quality, functional completion, potential benefit and observed user impact separate. If accepted outcomes are zero, cost per accepted outcome is undefined and total cost remains visible.

Generate reproducible analysis scripts and standalone tables/figures with raw-data references. Separate prespecified findings from exploratory observations; protect private participant metadata. Discuss single-participant or small-sample limitations where applicable.

Acceptance gate: Analysis reproduces from exports, totals reconcile without join multiplication, and each claim has data support. Missing empirical data yields a ready analysis pipeline and explicit gaps, not synthetic findings.
~~~


## T17 — Failure recovery, boundary checks, and requirements audit

Prerequisites: T13; may run alongside preparation for T14–T16.

~~~text
Apply the shared implementation contract. Execute T17: Failure recovery, boundary checks, and requirements audit.

Run the concrete system checks in templates/ACCEPTANCE_SCENARIOS.json and context/REQUIREMENTS.md. Prioritize unresolved risks: concurrent budgets, child inheritance, unknown external outcome, crash/replay, source injection, stale approval, worker escape, human-only leakage, benchmark contamination, and artifact/commit mismatch.

Verify backups and one restoration of catalog/artifact references. Check cancellation/reaping, data redaction and search permissions, protected logs, and actual Windows/WSL startup constraints. Resolve consequential integration gaps through real user paths.

Update each requirement's implementation/evidence status and deferred extension boundary. Do not claim a complete product because isolated module checks passed. Broaden testing only to address a concrete remaining risk.

Acceptance gate: A requirements-to-evidence report with critical blockers fixed or honestly recorded, and a working restored core path. No misleading live-integration or production-ready labels.
~~~


## T18 — Thesis, committee review, and defense preparation

Prerequisites: T16 and T17, or documented missing-data limits.

~~~text
Apply the shared implementation contract. Execute T18: Thesis, committee review, and defense preparation.

Prepare an evidence-backed thesis outline/draft, methods description, results tables, limitations, architecture/workflow explanation, ethics and human-oversight discussion, and a demo script. Link claims to actual protocol and result artifacts; no invented empirical results or citations.

Explain what the system can and cannot establish, including the distinct discovery and autonomy comparisons, selection bias in demos, correlated agents, small samples, and non-code successes. Produce a concrete committee feedback checklist and revision log.

Use the confirmed academic deadline and defense schedule, not an assumed exam-week date. If not confirmed, mark timing unresolved and prepare materials without claiming a deadline. Create a recorded/fixture-labeled demo backup and reproducible setup instructions.

Acceptance gate: A reviewable thesis/defense packet whose factual claims match the implementation and study, plus exact remaining changes. Drafting an email does not send it.
~~~


## T19 — Final thesis acceptance and reproducibility archive

Prerequisites: T18.

~~~text
Apply the shared implementation contract. Execute T19: Final thesis acceptance and reproducibility archive.

Walk through the full thesis demonstration: theme → evidence → alternatives → assessment → human or preauthorized decision → bounded plan → implementation → independent QA → private preview/download → feedback revision → search of provenance and cost.

Show a legitimate non-code/deferred example and the three study conditions with truthful data. Confirm all empirical claims, known limitations, dependency/config versions, setup instructions, backup demo, exports and applicable privacy handling.

Package source, lockfiles, manifests, prompts/rubrics, redacted study data, analysis, figures, decision log and requirements evidence. Keep secrets and private participant keys out. Mark advanced product features deferred or separately implemented, with no accidental claim of full product parity.

Acceptance gate: A clean reproducibility attempt succeeds where testable; final archive identifies exact versions, data exclusions, unresolved limitations, and what the thesis actually delivered.
~~~


## X01 — Model registry and qualified automatic routing

Prerequisites: T10 and measured task outcomes.

~~~text
Apply the shared implementation contract. Execute X01: Model registry and qualified automatic routing.

Implement a versioned capability/pricing/availability registry and fixed, Auto, Economy-with-quality-floor, and per-project route policies. Preserve the preferred reference model as a baseline; verify actual accessible IDs.
Select only routes qualified for task class, tools, privacy, context, latency and quality. Include failed attempts, review, repair and tools in cost per accepted result. Add a held-out benchmark, objective escalation, shadow evaluation, capped canary, promotion criteria and rollback. Never use self-confidence as the sole gate or claim savings from fixtures.

Acceptance gate: Real decisions identify policy/model/price versions; unsupported or privacy-incompatible routes fail; a cheap-but-unreliable route is not promoted; rollback works.
~~~


## X02 — Context selection, caching, compaction, and batches

Prerequisites: X01.

~~~text
Apply the shared implementation contract. Execute X02: Context selection, caching, compaction, and batches.

Expand task-specific context packs, provenance manifests, incremental source/code indexing, reusable handoffs and duplicate research reuse. Required constraints, objections, acceptance criteria and authority survive compaction.
Separate provider prompt caching from result caching; scope/version/freshness keys prevent leaks and stale answers. Never cache an external mutation as a new permission. Capability-check provider compaction and noninteractive batch requests; meter all overhead, partial failures and late results. Compare quality and total cost, not just token counts.

Acceptance gate: Representative task quality is maintained, required facts survive, cache permissions invalidate correctly, and measured overhead/savings have traceable usage.
~~~


## X03 — Comprehensive search, lineage, and audit questions

Prerequisites: T09 and T13.

~~~text
Apply the shared implementation contract. Execute X03: Comprehensive search, lineage, and audit questions.

Extend lexical search across evidence, specs, tasks, decisions, code versions, artifacts, models and resource/cost records with filters, saved queries, coverage/freshness and timezone handling. Add metered semantic search after access-safe lexical retrieval.
Natural-language audit questions compile into constrained, parameterized, read-only query plans with limits; never execute model SQL. Enforce permissions before snippets and aggregation. Build bounded lineage views and export integrity checks. Preserve redaction/tombstones and unsupported-media status. Count shared expenses once across many-to-many joins.

Acceptance gate: Source-to-product and cost-to-run questions return supporting records; injected queries cannot mutate; revoked access and deleted evidence cannot leak through search.
~~~


## X04 — Scoped GitHub management

Prerequisites: T13 and policy/broker coverage.

~~~text
Apply the shared implementation contract. Execute X04: Scoped GitHub management.

Verify current endpoint-specific GitHub auth from official docs. Implement credential-isolated private repository provisioning and routine issue/branch/push/PR/check operations with verified owner, immutable repository ID, prefix/count/rate limits and explicit private visibility.
Handle selected-repository scope, token expiry/revocation and uncertain creation/merge through reconciliation without broader credentials. Merge only the exact reviewed head with matching passing checks. Webhooks must be verified/deduplicated. Generated workflow changes and production secrets remain separately controlled. Existing personal/school repos stay outside scope unless included.

Acceptance gate: Fixture and contract checks cover wrong owner, stale head, missing checks, uncertain effects and revocation. Live mutations require a matching grant; incomplete setup preserves local work.
~~~


## X05 — Windows desktop and paired local workers

Prerequisites: T13.

~~~text
Apply the shared implementation contract. Execute X05: Windows desktop and paired local workers.

Build the Tauri desktop shell using shared UI/contracts. Add system-browser sign-in, scoped native operations, source download/editor opening, artifact hash verification, isolated local launch, and worker controls.
Pair devices with short-lived one-time challenges, revocable identity, outbound connections, declared capability and scoped leases. Distinguish desktop window closure from background worker shutdown. Offline cache is read-only and dated; no claimed multi-writer sync. Test Windows paths/spaces/symlinks, worker revocation and native startup/update behavior on actual supported infrastructure.

Acceptance gate: Web and Windows desktop share authoritative records; pairing, download and launch are verified natively. Browser-only evidence does not establish native completion.
~~~


## X06 — Hosted operation and observability

Prerequisites: T17; X05 only for hosted-to-local pairing.

~~~text
Apply the shared implementation contract. Execute X06: Hosted operation and observability.

Implement an explicit hosted-control deployment with durable database/workflow/artifact storage, authenticated access, secrets management, migrations, health/readiness, monitoring, restricted previews and resource cleanup. Maintain local deployment support.
Separate test/staging/live environments. Provide backup/restore and uncertain-action reconciliation runbooks, queue/worker/budget/index/webhook metrics, retention, dependency updates and rollback. Validate restored lineage and resource totals. Public deployment and external alerts require their matching authority; prepare reviewable configuration first.

Acceptance gate: Restore/recovery and staging smoke checks work with declared targets; local-worker unavailability is accurately shown; no live production status without an actual authorized verification.
~~~


## X07 — Payments, entitlements, revenue and reinvestment

Prerequisites: T17 and required integration infrastructure.

~~~text
Apply the shared implementation contract. Execute X07: Payments, entitlements, revenue and reinvestment.

Implement fixtures and test-mode payments before live use. Verify signed events and authoritative backend payment state; deduplicate underlying economic transactions, not only webhook IDs. Support fees, refunds, disputes, settlements/payouts and entitlements bound to product/release. A redirect cannot grant access.
Use balanced immutable financial corrections and a distinct budget journal. Allocate only verified policy-eligible surplus bounded by usable liquidity, disjoint commitments/reserves/unspent envelopes, and a period cap. Consume each earnings tranche once under concurrency; partial allocations preserve remaining capacity. Seed funding, pending funds, forecasts and processor payouts are not new earned profit. Handle later losses by reclaiming unused derived budgets or freezing expansion.

Acceptance gate: Duplicate/out-of-order payments, partial allocations, refunds after reinvestment and unavailable funding rails cannot create money or excess authority. Live activation remains a separate owner decision.
~~~


## X08 — Evidence-backed marketing and measured feedback

Prerequisites: T13; X06/X07 only where distribution/payment requires them.

~~~text
Apply the shared implementation contract. Execute X08: Evidence-backed marketing and measured feedback.

Generate positioning, landing-page drafts, demonstrations and pricing/channel experiments from verified capabilities. Record content version, audience provenance, product/release, substantiated claims, outcome metric, budget and grant. No fabricated testimonials, usage, traffic or demand.
Implement optional delivery adapters in test mode with exact content/audience scope, suppression/opt-out, deduplication, native IDs and unknown-outcome reconciliation. Honor already-authorized campaigns without requesting every covered send again. Changed claims/targets outside the grant require a concrete new decision. Paid ads stay disabled without a real supported adapter and enforceable caps.

Acceptance gate: A complete reviewable campaign and test delivery path exists; claims trace to evidence and retries/suppression prevent duplicate or disallowed sends. No unrequested real outreach.
~~~


## X09 — Portfolio scheduling, maintenance, and reusable knowledge

Prerequisites: T13; X01/X07/X08 for their enabled features.

~~~text
Apply the shared implementation contract. Execute X09: Portfolio scheduling, maintenance, and reusable knowledge.

Add budget/capacity/review-backlog-aware scheduling, maintenance reservations, source refresh, product health, owner feedback, and conservation modes: normal, conserve, maintenance_only, paused. Avoid catch-up storms after outages. Cancellation overrides scheduled work.
Keep existing-product improvements and exploratory discovery allocations distinct. Store reusable components/lessons/prompts/skills with provenance, permitted use, version and regression evidence. Proposals cannot silently modify policy, credentials, evaluation holdouts or finance enforcement. New skills require review and rollback. Do not require profit or fixed production quotas to call the process useful.

Acceptance gate: Maintenance obligations can slow new builds; schedules deduplicate; low funds preserve configured reserves; reviewed reusable knowledge improves tasks without widening authority.
~~~


## X10 — Full-product acceptance and bounded owner pilot

Prerequisites: Applicable X01–X09 gates.

~~~text
Apply the shared implementation contract. Execute X10: Full-product acceptance and bounded owner pilot.

Audit every broader requirement and integration state. Measure catalog/search, bounded lineage, cost aggregation and event lag on a declared workload (the earlier proposal was 10,000 ideas and 100,000 events). Record hardware/configuration and p50/p95/p99. Treat earlier two-second p95 search and five-second event-display goals as provisional targets, not achieved facts. Preserve authorization and correct totals while addressing measured bottlenecks. Execute a bounded personal-studio pilot with the chosen budget, schedules, enabled accounts, supported platforms and explicit stop rules. Demonstrate discovery, independent alternatives, feedback revision, web/desktop catalog, routing explanation, provenance, remote repository history and measured costs.
Exercise commerce/marketing only if separately activated; otherwise show honest test-mode or deferred status. Include failures, cleanup, backup restoration, maintenance burden and real owner effort. Verify the exact archived release and document each unsupported capability.

Acceptance gate: A truthful full-product readiness report and reproducibility package; no blanket completion claim while required live/native paths remain unverified.
~~~


## U01 — Resume in a new coding conversation

~~~text
Read AGENTS.md, PROJECT_CONTEXT.md, tracking/BUILD_STATUS.md, tracking/SESSION_HANDOFF.md, and the requested milestone. Inspect actual git status/diff, relevant files, latest decisions, and existing test evidence. Reconcile stale handoff claims against code. State the verified current point and execute the next requested eligible step; preserve all user changes. Do not rerun expensive completed work without a concrete reason. Update the handoff before ending.
~~~


## U02 — Independent milestone review

~~~text
Review the requested milestone against its exact acceptance gate, context/REQUIREMENTS.md and the candidate commit/spec. Inspect real implementation and executed evidence. Prioritize missing behavior, authority/resource bypass, incorrect provenance, condition leakage, stale verification and user-visible failures. State severity, reproduction and evidence for findings. Do not confuse more code or tests with correctness. Report pass/partial/blocked and necessary fixes; do not change acceptance criteria to grant a pass.
~~~


## U03 — Repair a failed gate

~~~text
Read the specific failing evidence, intended behavior and current diff. Reproduce the failure where practical, identify its cause, implement the smallest coherent fix through the real path, and run the necessary checks. Preserve contracts, policy and frozen research criteria. If the failure reveals a specification issue, propose a versioned change with consequences instead of weakening a test silently. Bound retries and retain costs/partial work.
~~~


## U04 — Incorporate committee or owner feedback

~~~text
Read the supplied feedback alongside PROJECT_CONTEXT.md, requirements, decisions, protocol and current implementation status. Classify each item as a confirmed requirement, suggestion, question or conflict. Produce a concise impact map, then update the authorized context/prompts/requirements and affected plan. Preserve old decisions and protocol versions. If data collection already began, record deviations or create a new experiment version; do not rewrite the historical condition definitions.
~~~


## U05 — Prepare an action for final review

~~~text
Prepare the concrete release/campaign/account change or new spending policy requested by the owner. Resolve the exact target, content/artifact version, scope, costs, tests, rollback and existing grants. Complete reversible preparation and show the reviewable result. If a matching valid grant already authorizes execution, act within it and record evidence; otherwise request only the missing specific authority. Do not treat this prompt itself as permission to publish, send, purchase or expand access.
~~~
