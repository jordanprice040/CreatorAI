# Creator Agent — project context

Version 3.0 • October 9, 2026 • Owner: Jordan Price, UF Computer Science

October 20 owner update: [accepted runbook decisions](tracking/OWNER_DECISIONS_2026-10-20.md)
are authoritative for desktop setup/close settings, model recommendations/routing,
file/UX priorities, user-adjustable spending, pilot scope, GitHub/distribution and
research direction. Read relevant entries before reopening choices. Accepted design
is distinct from implemented behavior and activation. The current $20 allowance
remains; authorized users must be able to change their own product ceiling in
Settings, including above $20. Agents cannot raise it.

## Purpose

Creator Agent is a personal AI product studio that discovers real problems, researches them, generates and compares possible responses, develops suitable software, tests it, and manages resulting work in a searchable, auditable catalog. The broader product includes website and Windows desktop access, GitHub management, model/task routing, token optimization, operating budgets, marketing, maintenance, and controlled reinvestment of verified earnings.

The thesis examines the quality and limitations of that process. Producing many ideas, adding more agents, passing tests, and earning money are different outcomes; none establishes the others. Improvement over baselines is a hypothesis to test, not a promised result.

## Established direction and latest feedback

| Source | Requirement carried forward |
| --- | --- |
| Earlier product discussions and September 8 plans | Multi-agent discovery-to-product system; web/desktop catalog; inspect/test/download; provenance; budgets; model and token efficiency; GitHub; marketing and reinvestment |
| Dorley meeting, September 14 | Give the locator a concrete search brief; explore intersections between fields; use NAE Grand Challenge themes as possible starting points; assess urgency and software influence; rank ideas with an explicit method |
| September 19 overview and September 29 committee guide | Evidence-based discovery, source quality, competing alternatives, scoring anchors, uncertainty, controlled comparisons, one bounded prototype, human oversight and a searchable record |
| September 29 proposed timeline | Weekly deliverables; committee check-ins approximately every two weeks; final feedback before defense; protect writing/evaluation time |
| Committee feedback reported October 8 | Compare autonomous AI, human-in-the-loop AI, and human-only work on the same problems; allow context-sensitive requests for human input/approval; support agent humility and non-code or human-led responses |

Chair: Emmanuel J. Dorley; internal member: Rong Zhang; external member: Duncan Purves. Committee membership is context, not an instruction to contact anyone.

## Research questions

RQ1: Under defined resource limits, how do fully autonomous Creator Agent, Creator Agent with human input, and human-only problem solving differ in solution quality, evidence reliability, time, cost, and human effort?

RQ2: Does structured discovery improve evidence support and usefulness compared with open-ended AI idea generation under comparable conditions?

RQ3: Does the system identify cases where it should ask a person, recommend an existing/non-software solution, or decline/defer, and what are the costs of appropriate and unnecessary intervention?

RQ1 implements the October 8 request and is owner-selected as primary; RQ2 is
secondary (October 20, RD1). Proposed counts are provisionally accepted under RD7;
committee agreement, feasibility and exact protocol freeze remain required.

## What the system must do

1. Accept a theme, problem, target group, constraints, permitted data/tools, and budget. The locator narrows broad themes into specific affected users and observable problems.
2. Collect accessible, credible sources with timestamps and precise supporting passages. Separate source claims from inferences; preserve conflicting evidence and inaccessible-source status.
3. Examine existing products and current workarounds before proposing new work. Deduplicate sources and ideas without treating syndicated copies as independent corroboration.
4. Produce materially different options, using cross-field methods where justified. Include custom software, existing software, non-software/process changes, human-led and hybrid options. Do not force an irrelevant alternative just to fill a quota; record why it does not apply.
5. Critique and rank with an anchored, versioned rubric. Keep evidence confidence and ethical concerns separate from aggregate scores. Preserve rejected options and reasons.
6. At uncertainty or value-sensitive decision points, explain the assumption, its consequence, available choices, and the specific human input needed. Apply the configured intervention policy.
7. Convert selected software work into a bounded specification and task DAG with explicit acceptance criteria. An autonomous run can select only within preauthorized scope; supervised mode requests selection where configured.
8. Develop in isolated product workspaces; independently review and execute tests; allow bounded repairs. A failed attempt produces useful artifacts and an honest failure record.
9. Expose private demos, source downloads, supported packages, versions, limitations, and feedback. Verify startup from the exported package.
10. Link sources → claims/problems → alternatives → decisions/specs → tasks → commits/tests → artifacts/releases → feedback/costs. Relationships are many-to-many and searchable in both directions.
11. Enforce global/run/task budgets, concurrency, deadlines, recursion, revisions, permissions, pause, cancel, and recovery in application code.
12. Support versioned experiments and human-only submissions without hidden model assistance, along with blinded reviewer exports and reproducible analysis.

## Thesis minimum and broader product

The proposed thesis minimum is T00–T19: discovery and scoring, configurable oversight, three-arm comparison support, a preserved open-ended baseline, a searchable application, auditable costs, one complete software prototype and feedback revision, fault/permission verification, evaluation results, and thesis/defense materials.

The broader requirements remain X01–X10: qualified automatic routing, deeper context optimization, comprehensive semantic/audit search, remote GitHub workflows, Windows desktop/local-worker controls, hosted operation, revenue/entitlements/reinvestment, authorized marketing, reusable knowledge, and portfolio maintenance.

Minimal token-aware context selection belongs in the thesis implementation. Learned routing, batch optimization, live revenue, and desktop parity are extensions. Local Git and basic searchable lineage are thesis essentials even when remote repository automation is deferred.

## Architecture direction

Carry forward a modular TypeScript/pnpm application, React/Vite UI, Node API, PostgreSQL records, durable workflows, isolated execution worker, local/filesystem artifact adapter, Git, and language-appropriate tests with browser verification. Tauri is the Windows desktop direction. Temporal is the earlier durable-workflow choice. OpenAI Agents SDK is an integration candidate behind application-owned adapters.

These are previously proposed choices, not evidence of installed code or currently valid SDK signatures. T00 inspects any existing agent repository. Preserve compatible implementation; record departures as decisions. Verify the present API surface and dependency compatibility before coding.

Start with one local control deployment, one authoritative database, and optional API model calls. Keep a path to hosted control with paired outbound local workers. This resolves the prior tension between local-first intent and a hosted-control proposal: local deployment comes first; hosted control is an explicit deployment mode. Offline multi-writer synchronization is deferred.

The earlier preferred reference model was GPT-6 Astra. Resolve the actual accessible API identifier and record its version during setup. Do not silently substitute another model. Runtime Auto routing later selects only approved, evaluated routes. No fixed prices or live spending allowances are authorized by this kit.

## Runtime roles

Coordinator/portfolio director; locator/problem researcher; market/evidence researcher; solution designers; skeptic/evaluator; human-judgment/ethics reviewer; planner/architect; builder; independent reviewer/QA; release/maintenance; marketing/feedback; optimizer; finance analyst.

These are finite roles, not a requirement for simultaneously running permanent agents. Prefer sequential execution initially and at most the configured concurrency. Deterministic code handles state, arithmetic, policy, pass/fail gates, and accounting.

## Design defaults, not owner approvals

Proposed defaults: one active product build; no more than three concurrent model jobs; three independently prompted initial concepts where the problem supports meaningful alternatives; one concept revision; at most two repair cycles; maximum delegation depth two; explicit total-call/time caps configured before live use; no automatic public release or live campaigns; reinvestment disabled. Budgets are unset until chosen. Unknown costs cannot be interpreted as free.

Use a readable interface with transparent stage labels and no fake actions. A dark theme is a reasonable optional default based on Jordan's earlier demo preference, not a confirmed Creator Agent requirement. Accessibility and useful information take priority.

## Research and ethical constraints

Measure functional correctness separately from usefulness and possible social benefit. Human-only work uses ordinary non-generative tools under the frozen protocol. Human-assisted work records interventions and actual effort. A blocked autonomous run stays in the assigned condition and denominator; it does not quietly become assisted.

Human input is particularly valuable for conflicting stakeholder interests, sensitive assumptions, uncertainty that changes the plan, and consequential ethical judgments. A non-software recommendation can be a successful decision. A blanket refusal or endless requests for approval is not humility; evaluate both missed and unnecessary escalations.

Freeze evaluation prompts, rubric, resource limits, data access, versions, and analysis rules after a pilot. Protect held-out tasks and grader notes. Do not invent participant consent, institutional approval, committee decisions, or results. Resolve applicable human-subject research requirements before recruiting study participants.

## Current status and boundaries

This kit was authored from project documents and reported feedback; the target application repository was not supplied or inspected. No feature is marked implemented. Earlier local-agent work may be reusable but must be verified from files.

The separate CIS4914 C++ market-data system is not Creator Agent. Its strategy engine, database choices, PRs, and November 19 presentation are not requirements or deadlines for this thesis.

A week-of-November-30 defense was a proposed timeline window, not a confirmed appointment. Applicable UF/CISE deadlines and defense timing require confirmation. Do not use an uncertain Monday-of-exam-week assumption to override an earlier official deadline.

## Detailed documents

See context/REQUIREMENTS.md for traceability, context/ARCHITECTURE.md for contracts, context/HUMAN_OVERSIGHT.md for action decisions, context/SCORING_RUBRIC.md for ranking, context/EVALUATION_PROTOCOL.md for comparisons, and context/DECISIONS_AND_OPEN_QUESTIONS.md for unresolved matters.
