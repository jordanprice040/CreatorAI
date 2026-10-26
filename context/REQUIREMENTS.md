# Requirement traceability

Every row is planned, not implemented, at kit creation. The final column describes evidence to collect. Record actual status, candidate version and evidence in tracking/BUILD_STATUS.md; do not replace requirements with a count of completed prompts.

Core/Extension is the proposed delivery priority, not a claim of formal committee approval. C49 and C50 apply throughout.

| ID | Requirement | Origin | Priority | Milestones | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| C01 | Evidence-based discovery-to-product workflow | Earlier product/thesis | Core | T05–T13 | One source-backed problem reaches a verified, downloadable prototype with feedback revision. |
| C02 | Directed locator with affected users and constraints | Dorley Sep 14 | Core | T07 | Brief identifies user, observable problem, constraints and measurable outcome. |
| C03 | Cross-field ideation and optional NAE theme seeds | Dorley Sep 14 | Core | T07 | Proposal explains the transferred mechanism rather than merely naming fields. |
| C04 | Urgency and measurable software influence | Dorley Sep 14 | Core | T08 | Anchored urgency/influence assessments refer to evidence and explicit mechanism. |
| C05 | Source provenance and claim support | Thesis/research guide | Core | T06 | Source/version/locator supports each claim; inferences and inaccessible sources are labeled. |
| C06 | Independent corroboration and counterevidence | Earlier product/thesis | Core | T06–T07 | Syndicated sources count once and contradictory evidence is retained. |
| C07 | Competing concepts, critique and bounded revision | Earlier product | Core | T07 | Independent first proposals, skeptic findings and finite revision evidence persist. |
| C08 | Deduplication and existing alternatives | Earlier product | Core | T07 | Known duplicate is linked reversibly and comparison dates/coverage are visible. |
| C09 | Versioned rubric, uncertainty and override | Thesis guide | Core | T08 | Unknown is distinct from average; reproducible scores and original overridden ranking remain. |
| C10 | Non-code, existing-tool, human-led and hybrid options | Committee Oct 8 | Core | T03,T07–T08 | Appropriate non-software recommendation can succeed without being forced to build. |
| C11 | Assumptions and willingness to reconsider | Committee Oct 8 | Core | T03,T07 | Material assumptions, disconfirming evidence and decision-changing conditions are recorded. |
| C12 | Useful human clarification/judgment/approval | Committee Oct 8 | Core | T03 | Concrete request includes evidence, consequence, options, scope and what can continue. |
| C13 | Configurable autonomy with bounded auto-approval | Committee Oct 8 | Core | T03 | Only a current scoped policy permits actions; model self-approval fails. |
| C14 | Version-bound approvals and preserved dissent | Earlier oversight + Oct 8 | Core | T03 | Changed/expired requests cannot authorize action; prior input and overrides persist. |
| C15 | Autonomous / assisted / human-only comparisons | Committee Oct 8 | Core | T10,T14–T16 | Same-problem assignment and actual condition-specific assistance are traceable. |
| C16 | No hidden AI assistance in human-only condition | Operationalized Oct 8 | Core | T10 | Every model/helper path is denied for human-only participant work. |
| C17 | Structured/open-ended discovery comparison | Sep thesis documents | Core | T10,T14–T16 | Treatment distinction and matched caps/data/model configuration are frozen. |
| C18 | Reproducible protocol, failures and blinded ratings | Thesis guide | Core | T10,T14–T16 | No dropped unsuccessful runs; private assignment key, raw ratings and version hashes retained. |
| C19 | Measure intervention quality and human effort | Committee Oct 8 | Core | T10,T16 | Missed/needed/unnecessary intervention and active/wait time are reported separately. |
| C20 | Requirements, spec versions and task DAGs | Earlier product | Core | T08 | Frozen acceptance criteria, dependencies and conflict/cycle checks precede build. |
| C21 | Bounded specialist delegation | Earlier product | Core | T05,T07,T12 | Child scope/budget/call limits cannot exceed parent; cancellation propagates. |
| C22 | Persistent run state and crash recovery | Earlier implementation | Core | T05,T17 | Restart/replay/stale-worker cases preserve one logical outcome and exposure. |
| C23 | Independent review and executed QA | Earlier product/thesis | Core | T12 | Exact commit/spec plus actual test evidence determines readiness. |
| C24 | Tested artifacts, private demos and downloads | Earlier product | Core | T13 | Exported package starts cleanly and matches checksummed manifest. |
| C25 | Versioned feedback and iterative improvement | Earlier product | Core | T13 | One feedback request leads to a reverified version with linked costs. |
| C26 | Searchable database and many-to-many provenance | Earlier product/thesis | Core | T02,T09 | Source-to-product and reverse queries work with versions and access checks. |
| C27 | Observable audit with times, actors and costs | Earlier product/thesis | Core | T02,T04 | Intent/outcome, causal IDs, usage and concise rationale are queryable. |
| C28 | Exact budgets, reservations and financial separation | Earlier product | Core | T04 | Concurrent jobs conserve authority; unknown costs are not zero or fabricated cash. |
| C29 | Cancellation, finite attempts and partial results | Earlier product | Core | T05,T12,T17 | Stop prevents new effects and preserves partial output/in-flight accounting. |
| C30 | Restricted generated-code execution | Earlier product | Core | T11,T17 | Workspace/network/secret/daemon boundaries and process-tree cancellation are verified. |
| C31 | Privacy, credentials, source injection and retrieval access | Earlier product/thesis | Core | T03,T06,T09,T17 | Hostile content cannot expand grants; unauthorized snippets/exports are blocked. |
| C32 | Local-first usable development/control mode | Earlier user direction | Core | T01,T05,T17 | Local persistence works and API/tracing data flows are explicit. |
| C33 | Local Git and distinct generated-product repositories | Earlier product | Core | T11 | Task-to-commit lineage works without modifying unrelated repositories. |
| C34 | Basic task-specific context and token accounting | Earlier product | Core | T04–T05 | Required constraints and references are retained without sending all project documents. |
| C35 | Web catalog, decisions, run controls and usable states | Earlier product | Core | T09,T13 | Browser paths use real state with keyboard, error/empty and permission cases. |
| C36 | Thesis manuscript, demo, defense and reproducibility | Thesis documents | Core | T18–T19 | Claims match actual data and confirmed schedule; archive can be reproduced. |
| C37 | Model/task auto-selection with quality floor | Broader product | Extension | X01 | Route qualification, total cost, canary and rollback are demonstrated. |
| C38 | Advanced token optimization and reusable contexts | Broader product | Extension | X02 | Cache/compaction/batch quality and full overhead are measured. |
| C39 | Semantic search and natural-language audit questions | Broader product | Extension | X03 | Permission-safe evidence-linked read-only plans and no join inflation. |
| C40 | GitHub create/branch/PR/check/merge/release management | Broader product | Extension | X04 | Verified owner/scopes, private creation, exact reviewed head and safe reconciliation. |
| C41 | Windows desktop app and safe local launch | Broader product | Extension | X05 | Native tested behavior beyond shared browser UI. |
| C42 | Outbound worker pairing and truthful offline state | Broader product | Extension | X05 | One-time pairing, revocation, stale leases and read-only offline cache verified. |
| C43 | Hosted control and operational recovery | Broader product | Extension | X06 | Durable services, backup restoration, health and resource cleanup tested. |
| C44 | Payments, entitlements and reconciled revenue | Broader product | Extension | X07 | Backend verification and economic deduplication handle refunds/disputes/payouts. |
| C45 | Budgeted reinvestment from eligible usable earnings | Broader product | Extension | X07 | No duplicate tranche allocation, unfunded spend or treating seed funds as profit. |
| C46 | Marketing, launch drafts and authorized campaigns | Broader product | Extension | X08 | Substantiated versioned claims, audience grants, suppression and measured outcomes. |
| C47 | Scheduling, portfolio maintenance and conservation | Broader product | Extension | X09 | Backlog/budget obligations constrain discovery; schedules deduplicate after outage. |
| C48 | Reviewed reusable components, prompts and skills | Broader product | Extension | X09 | Provenance, qualified adoption and rollback; no self-expansion of authority. |
| C49 | Real-vs-fixture integration status | Earlier implementation | All | T00–T19,X01–X10 | Implementation, fixture, contract, live verification and activation reported separately. |
| C50 | Owner control without repeated unnecessary permission | Earlier direction + Oct 8 | All | T03,X01–X10 | Covered routine actions proceed; actual out-of-scope actions get concrete review. |
| C51 | Declared-scale performance and operating targets | Earlier implementation | Extension | X10 | Measured latency/throughput on stated hardware/data; no claimed targets without measurements. |

| C52 | Central studio chat for requests, source/prompt intake and linked research/comparisons | Owner Oct 20 | Extension | Runbook §2.17; T09/X03 reuse | Save-only requests do not dispatch; actions link to durable records/runs; citations, context permissions, idempotency and recovery verified. |
| C53 | Agent-led problem discovery without a user-supplied theme | Owner Oct 20 | Extension | Runbook §2.18; T06–T08/X09 reuse | Bounded manual exploration yields evidence-backed briefs or an honest empty result; aggregate limits and oversight enforced; frozen study conditions preserved. |

| C54 | Billing-aware simple theme intake and complete in-app workflow | Owner Oct 20 alignment review | Extension | Runbook §2.5A/§2.15/§2.19A, Group 3 | Real-workspace theme with no claims reaches cited comparison via qualified role routes; effective limits/data sharing and supported build/export/revision work without CLI assembly. |
