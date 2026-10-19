# Creator Agent: auditable discovery and bounded product development

Jordan Price · University of Florida, Computer Science · Working thesis draft

## Abstract

Creator Agent is a local control studio for evidence-backed problem discovery and bounded software development. It separates model proposals from deterministic authority, resource accounting and verification. A TypeScript application connects a catalog, versioned sources and claims, human decisions, durable workflows, isolated product execution and artifact provenance. The implemented evaluation and analysis paths preserve failures, missing ratings and uncertain billing. Executed synthetic checks support claims about these mechanisms; they do not establish solution usefulness or comparative superiority. A proposed study compares autonomous, human-assisted and human-only work, with a separate structured versus open-ended discovery comparison. The protocol remains unfrozen and participant outcomes and independent ratings are unavailable. This draft therefore reports engineering verification and explicitly leaves the research questions unanswered. [E1–E8](EVIDENCE.md)

## 1. Problem and contribution

An AI studio can produce plausible ideas and working code without establishing that a problem matters, that its sources support its claims, or that the chosen intervention is appropriate. Creator Agent addresses the inspectability of this process: alternatives and rejected options, evidence gaps, authority, costs, exact candidate versions and executed checks are retained as inspectable records. Its contribution at this stage is an implemented experimental and engineering instrument, not evidence that autonomous product development outperforms people. [E1–E5](EVIDENCE.md)

The scope includes a bounded offline Python CLI product path and private artifact delivery. Hosted operation, Windows desktop parity, revenue, marketing, comprehensive semantic search and qualified automatic model routing are outside the verified thesis scope. Potential social benefit and observed user impact are not measured by the study contracts. A literature review and institution-compliant bibliography remain to be developed; this draft cites repository evidence and makes no external novelty claim.

## 2. Questions and evidential status

| Question                                                                                                                                | Proposed evidence                                                                               | Current answer                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| RQ1: How do autonomous, assisted and human-only work differ in quality, evidence reliability, time, cost and human effort under limits? | Matched tasks, independent ratings, executed acceptance cases and reconciled resource records   | Unanswered: no final participant evaluation or ratings                                                                 |
| RQ2: Does structured discovery improve evidence support and usefulness over open-ended generation?                                      | Separate paired discovery study with matched model, sources, candidate counts and resource caps | Unanswered: fixture outputs cannot estimate this difference                                                            |
| RQ3: Does the system appropriately request human input, recommend existing/process solutions or defer, including intervention costs?    | Held-out challenge cases and human necessity coding                                             | Unanswered empirically; refusal and alternative paths are engineering checks only; necessity coding is not implemented |

The earlier discovery comparison and the October 8 autonomy comparison test different factors. Results from one must not be presented as results for the other. [E1, E2, E4](EVIDENCE.md)

## 3. Implemented architecture and workflow

React/Vite web and compiled CLI clients call an authenticated Node API. Runtime schemas and domain rules validate contracts; PostgreSQL stores scoped, versioned records, audit events and outbox/workflow state. Accepted ADR-0008 replaces the earlier Temporal proposal with PostgreSQL-backed durable workflows. Leases, fencing and heartbeats support at-least-once execution; unknown external outcomes require reconciliation rather than a claim of exactly-once effects. [E5, E6](EVIDENCE.md)

The research path records brief → source versions and passages → supported or disputed claims → problems and competing alternatives → rubric assessments → human or scoped selection → frozen specification and task. Existing software, process change, human-led action, hybrid action and deferral are legitimate outcomes. A link or a model confidence statement alone is not source support. Structured fixture runs with unverified packet snapshots stop with insufficient evidence; this refusal is observable behavior, not proof of general research quality. [E2, E3](EVIDENCE.md)

The software branch admits a task against scope, current grants, cancellation state and bounded exposure. The broker reserves exact-money maximum exposure before dispatch and retains unknown/in-flight liabilities. Child allocation conserves parent authority. A role cannot raise its own budget or approve itself. Bounded builder patches create local commits; fresh reviewer context and supervisor-executed acceptance checks bind to the exact spec/task/commit. Held-out cases are not exposed to the builder. Changed candidates invalidate affected evidence. [E5–E7](EVIDENCE.md)

Generated products use the reviewed WSL2/Bubblewrap/systemd execution worker with constrained resources and filesystem/network boundaries. Product execution is separate from the management API. Packaging re-extracts the source archive and re-runs acceptance cases on delivered bytes. Private previews use a separate origin, one-time access tickets and expiring/revocable leases. Feedback on an exact version creates a revised spec and candidate. A source archive is not a native installer. Test doubles execute nothing and are never isolation evidence. [E6, E7](EVIDENCE.md)

## 4. Methods: executed engineering verification

Verification has four evidence classes: pure contract/domain tests, database/API integration checks, synthetic fixture rehearsals and real-worker checks. None is participant evaluation. Historical records identify their own candidate and environment; a passing earlier worker run does not verify later study-build changes. This T18 session built upstream snapshot 3e9026f and ran the T16 analysis tests and three fixture scenarios locally; exact output and counts are recorded in E8. No live model or database study was run in T18. [E5–E8](EVIDENCE.md)

The T15 rehearsal assigns 26 slots across eight synthetic tasks. It reports 10 passing checks, eight submissions, twelve failures from insufficient evidence, one scripted cancellation, one deferral and four blocked AI implementation slots. Human entries are scripted, and the stand-in freeze is not an adopted owner protocol. These are instrumentation observations only. Later study-build tests implement the builder link but do not retroactively turn those blocked slots into completed runs. [E3](EVIDENCE.md)

## 5. Proposed comparative methods — unfrozen

Condition A supplies only the initial brief/configuration and permits no task-specific human help after start. Condition B uses the same AI configuration with recorded human decisions, reasons, active effort and waits. Condition C uses ordinary non-generative tools with model/helper paths denied. All conditions receive comparable frozen task packets and acceptance criteria. Decision and implementation strata are analyzed separately. Autonomous needs-human outcomes stay in their assigned denominator; any assisted continuation is separately linked. [E1–E3](EVIDENCE.md)

The current proposal is four decision and two implementation tasks across three arms, plus two discovery themes with two repeats per method. Counts, primary outcomes, people, tasks and final source access remain subject to owner/committee decisions. The proposal suggests a single-participant exploratory case study with matched variants and two independent blinded reviewers. These are proposals, not recruited people. Reviewers would calibrate on non-study examples and receive randomized coded packets without the private assignment key. [E2, E3](EVIDENCE.md)

Before final collection, adopt or replace the implemented analysis plan. Its defaults average five complete rubric dimensions per reviewer, retain incomplete ratings without imputation, pair arms at task level and average discovery repeats within themes. Every assigned slot stays in completion denominators. All attempts, including permitted retries and failures, contribute resources; cost per accepted outcome is undefined at zero accepted outcomes or without an acceptance rule. Unknown billing makes known-spend ratios lower bounds. Weighted kappa applies to exactly two reviewers; raw disagreements remain visible. The implemented bootstrap requires at least ten task pairs, exceeding the proposed per-stratum counts, so the current small design would not yield those intervals. [E4](EVIDENCE.md)

## 6. Results

T19 addendum: a fresh extraction of the same upstream source ran 187 database/real-worker tests: 185 passed, one expected no-worker case skipped, and the process-restart recovery check failed at its polling deadline. The original test passed alone; inspection found its 20-second polling window shorter than a possible 30-second outstanding lease. A lease-aware test-only repair passed the focused check. The extended real-worker artifact recorder also passed, retaining original/revised package bytes and same-workspace provenance/search/cost results. The complete suite was not rerun after those test-only overlays; no all-green 187-test result is claimed. The newer study-build worker gate passed in the full run. See [T19 verification and diagnosis](../../tracking/evidence/t19/verification.json) and [recovery evidence](../../tracking/evidence/t19/RECOVERY_DIAGNOSIS.md). Historical rows below retain their original versions and limits.

### Executed software evidence

| Artifact/environment                | Observed result                                                                                     | Scope of inference                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| T13 CLI acceptance, real WSL worker | Exact package/revision records; revoked 403, expired 410, tampered download 400, stale revision 409 | Specific synthetic product and boundary behavior            |
| T17 cloud record                    | 162 tests: 152 pass, 0 fail, 10 skip                                                                | Historical suite; skips require real worker                 |
| T15 study-build cloud record        | 178 tests: 167 pass, 0 fail, 11 skip                                                                | Later study machinery; real study-build worker gate skipped |
| T16 cloud test log                  | 187 tests: 176 pass, 0 fail, 11 skip                                                                | Pipeline/integration suite at that snapshot                 |
| T18 local snapshot                  | See E8 for executed analysis tests and 3 fixture reruns                                             | Reproducibility of synthetic analysis; no live study        |

These counts concern different snapshots and environments and must not be summed into a single success rate. T17's handoff also records an owner-reported real-worker run at 38b3e46 (167 pass, one expected skip); it is a reported historical observation and does not cover the later study-build gate. [E5–E8](EVIDENCE.md)

### Empirical results — unavailable

| Outcome                                    | A           | B           | C           | Structured vs open-ended  |
| ------------------------------------------ | ----------- | ----------- | ----------- | ------------------------- |
| Independent solution quality               | Unavailable | Unavailable | Unavailable | Unavailable               |
| Evidence reliability                       | Unavailable | Unavailable | Unavailable | Unavailable               |
| Final functional completion                | Unavailable | Unavailable | Unavailable | Not the discovery outcome |
| Actual comparative spend/time/effort       | Unavailable | Unavailable | Unavailable | Unavailable               |
| Necessary/missed/unnecessary interventions | Unavailable | Unavailable | Unavailable | Unavailable               |

Unavailable does not mean zero, a null effect or failed participants. No final study is evidenced. Synthetic fixture numbers and simulated costs must not populate this table. There is no effect estimate, significance result, observed reviewer agreement or superiority conclusion.

## 7. Ethics, oversight and limitations

Local control does not mean offline inference: approved API context would leave the machine. No inference provider access or external tracing should be inferred from documentation alone. Participant recruitment and reviewer involvement await a recorded applicable committee/IRB determination; consent, retention, access and redaction procedures must be resolved before collection. Private assignment keys and raw participant records are not committee packet attachments by default. The $20 total T15 preference is recorded, while execution configuration still has spend_authorized false and live dispatch disabled; this draft changes neither. [E2–E4](EVIDENCE.md)

Selected successful demonstrations have selection bias and cannot estimate completion rates on arbitrary problems. Fixed synthetic roles do not establish reasoning ability. Multiple roles using one model have correlated errors and are not independent reviewers. One human repeatedly solving related tasks creates learning and carryover effects; counterbalancing cannot erase prior knowledge. Small task counts, one provider, narrow Python recipes, uncalibrated ratings and unresolved sampling restrict generalization. Hashes prove byte identity under stated trust assumptions, not source truth, beneficial impact or comprehensive security. [E1–E7](EVIDENCE.md)

Non-code choices can be successful decisions; counting only builds would bias the study against appropriate humility. Conversely, always deferring can avoid errors while failing to help. Appropriate intervention requires context-sensitive human coding, which remains a contract gap. Functional correctness, usefulness and social benefit remain distinct outcomes.

## 8. Discussion and remaining work

The artifact demonstrates that authority and verification can be represented independently of model assertions in a bounded prototype. The test evidence supports specific enforcement paths, not universal safety. RQ1–RQ3 remain unanswered. Committee review must decide whether this engineering contribution with explicit missing-data limits is academically sufficient, or whether final participant evaluation is required. Neither acceptance nor an academic schedule is inferred here. Exact remaining decisions, repairs and drafting work are listed in the committee checklist.
