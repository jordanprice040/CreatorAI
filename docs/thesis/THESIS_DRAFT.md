# Creator Agent: auditable discovery and bounded product development

Jordan Price · University of Florida, Computer Science · Working thesis draft 2 (November 19, 2026)

Draft 2 replaces draft 1 (October 18, 2026, source `3e9026f`), which is in the repository history. It describes main `b9270db` (November 19, 2026) and cites only recorded evidence: [E1–E9](EVIDENCE.md) are the October records, kept with their original scope, and [E10–E19](EVIDENCE.md) are the records made since. Defense: December 2, 2026. Submission: December 7, 2026.

## Abstract

Creator Agent is a local studio for evidence-backed problem discovery and bounded software development. Application code, not the model, holds authority, money, admission and verification. A model can propose; it cannot approve itself, raise its own budget or mark its own work verified. The studio runs as a local web app and a Windows desktop app over PostgreSQL. It records sources, claims, alternatives (including non-software and defer outcomes), human decisions, exact-money reservations, isolated builds, independent review and executed acceptance checks, each bound to the exact candidate.

This thesis is an engineering thesis built on executed evidence. Between November 6 and November 19, 2026, the system was exercised live, on the owner's computer and with the owner's typed approval for each run: model qualifications on frozen benchmarks with held-out cases, autopilot runs from web evidence to a stop for a person, a GitHub trial with a scoped token and one with a GitHub App, and an in-app update trial that deliberately installed a broken release. GPT-6 Astra on a ChatGPT plan connection qualified for the three discovery roles, for web discovery on the second benchmark version, and for the extra-large build benchmark `p14-xl-v1` (3 of 3 attempts, 11 held-out cases each, $0). Failures are reported with the passes: a failed first web-discovery benchmark, failed larger-build attempts, a Claude route that qualifies only for small builds, two failed update rollbacks before the fix, and autopilot runs that never chose an option on their own. One small frozen AI-only run is reported on its own in Section 6; its results are not in this draft yet. The three-condition comparison of autonomous, assisted and human-only work is proposed future work, so RQ1–RQ3 stay unanswered.

## 1. Problem and contribution

An AI studio can produce plausible ideas and working code without establishing that a problem matters, that its sources support its claims, or that software is the right response. It can also spend money, push code or change a user's computer without anyone having decided that it should. Creator Agent addresses both. It keeps the reasoning inspectable: alternatives and rejected options, evidence gaps, approvals, costs, exact candidate versions and executed checks are kept as records. And it keeps authority deterministic: what a model may do, with which connection, on which data and up to which limit, is decided by application code from the owner's recorded grants. [E6, E10](EVIDENCE.md)

The contribution is an implemented, working instrument and the executed evidence about it:

1. **An architecture that separates model proposals from authority.** Grants, budgets, run modes, caps and lifecycle transitions are enforced in code and database constraints, and are tested negatively (refusals, concurrency, crash and retry). [E5, E6, E10, E11](EVIDENCE.md)
2. **Qualification before use.** A model is admitted to a role only after it passes a frozen benchmark with held-out cases on that exact connection, model and role prompt. A changed prompt or benchmark voids the pass. [E12, E14, E15](EVIDENCE.md)
3. **Live evidence that the controls hold outside fixtures.** Qualifications, autopilot runs, GitHub trials and an update trial ran against real services and the owner's real computer, each with a recorded typed approval, and each trial records what failed. [E12–E17](EVIDENCE.md)

It is not evidence that autonomous product development matches or beats people, that the products built are useful, or that any discovered problem is worth solving. The scope includes Python command-line and static web products, private packages and previews, and a single-owner local deployment. Hosting, payments, marketing and outside users are outside the verified scope. A literature review and an institution-compliant bibliography are still to be written; this draft cites repository evidence and makes no external novelty claim.

## 2. Scope and questions

**Scope decision.** On November 19, 2026, after the defense date was confirmed, Jordan chose this scope: an engineering thesis on executed evidence (tests, live qualifications on held-out benchmarks, live trials), plus one small frozen AI-only run reported on its own, not as a comparison. The three-condition study becomes proposed future work. The decision is recorded in [tracking/DECISIONS.md](../../tracking/DECISIONS.md). Whether this scope is academically sufficient is the committee's call and is not recorded yet ([checklist](COMMITTEE_REVIEW.md)).

The thesis answers four engineering questions from executed evidence. It leaves the three research questions of the original proposal open.

| Question                                                                                                                     | Evidence                                                                        | Current answer                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EQ1: Can authority, budgets and verification be held by application code while models do the proposing and the work?         | Contract, database and concurrency tests; live runs that stopped where required | Supported for the implemented paths (Sections 3 and 5.1); not a general safety proof                                                                                                    |
| EQ2: Can a model be admitted to a role only on executed, held-out evidence bound to its exact connection, model and prompt?  | Live qualification records on frozen benchmarks                                 | Supported: passes and failures recorded, and passes voided by prompt changes (Section 5.2)                                                                                              |
| EQ3: Does a bounded autopilot carry work from evidence to a decision and stop where a person must decide, within its limits? | Fixture walks and six live autopilots                                           | Partly: every live run stopped at a person, a limit or a refusal; one continued run ended in a proposal; no run chose an option by itself, and the autopilot never builds (Section 5.3) |
| EQ4: Do live external actions (GitHub, software updates) stay inside their grants, and do they fail safely?                  | Live trials with typed approval                                                 | Partly: GitHub actions stayed in scope; some steps untested. Updates failed safely twice, then passed (Section 5.4)                                                                     |
| RQ1: How do autonomous, assisted and human-only work differ in quality, evidence reliability, time, cost and human effort?   | Matched tasks, independent ratings                                              | Unanswered: future work (Section 7)                                                                                                                                                     |
| RQ2: Does structured discovery improve evidence support and usefulness over open-ended generation?                           | Paired discovery study                                                          | Unanswered: future work                                                                                                                                                                 |
| RQ3: Does the system appropriately ask for people, recommend existing or process solutions, or defer?                        | Held-out challenge cases with human coding                                      | Unanswered empirically; the live autopilot runs show the behavior occurring, not whether it was appropriate                                                                             |

The AI-only run (Section 6) describes one condition on frozen tasks. It cannot answer RQ1, because there is no matched human or assisted arm.

## 3. Implemented architecture and workflow

**Clients and storage.** A React/Vite web client, a compiled CLI and a Tauri Windows desktop app call an authenticated Node API. Runtime schemas and domain rules validate every contract. PostgreSQL (schema 79) stores scoped, versioned records, an audit chain and outbox/workflow state. Durable workflows run on PostgreSQL with leases, fencing and heartbeats (ADR-0008); external effects are at-least-once, and an unknown outcome is reconciled rather than assumed. The desktop app runs its own PostgreSQL and service, signs the owner in, and keeps secrets in the Windows protected store (DPAPI), never in the database. [E6, E10](EVIDENCE.md)

**Connections and qualification.** The studio reaches models through a ChatGPT plan connection, a Claude Code connection (local, unmodified `claude -p`), or an OpenAI API key. Each connection has owner-accepted caps (requests per day and per run, input and output size, time) and a list of allowed task classes. A model is admitted to a role on a connection only with a current qualification: a recorded pass on a frozen benchmark whose manifest hash, held-out cases and pass bar are fixed before the run, bound to that connection, model and role-prompt hash. Held-out answers that a person has opened void later prompt changes for those cases (ADR-0052). Discovery roles, web discovery, building and reviewing are qualified separately, in the app (ADR-0089, ADR-0086, ADR-0105). [E10, E12, E14](EVIDENCE.md)

**Discovery.** The research path records brief → source versions and passages → supported or disputed claims → problems and competing alternatives → rubric assessments → human or covered selection → frozen specification. Existing software, a process change, human-led action, a hybrid and deferral are legitimate outcomes, and a non-code choice ends in a proposal rather than a build (ADR-0101). "Search the web" (ADR-0086) uses the plan connection's own web search to find pages; the studio fetches them itself under its evidence-site policy and turns into draft claims only quotes it finds word for word on the stored page. A person accepts claims, unless an opt-in setting accepts quote-checked claims for one run. [E10, E12](EVIDENCE.md)

**Autopilot.** One bounded autopilot carries a run from evidence through exploration, brief, discovery, assessment and choice to a proposal (ADR-0092, ADR-0111). It runs under routine approvals that the owner grants for that run, with a call budget, an end time and the connection's caps. It stops whenever a person must decide: held claims, unknown ratings, ties, gates, caps, usage limits or refusals. The owner can opt in to planned fallbacks instead of some stops (ADR-0100) and choose how much is automated (ADR-0099). A software option still stops at the specification; the autopilot does not build. [E10, E13](EVIDENCE.md)

**Building.** A task freezes its specification and acceptance cases, some held out from the builder. The broker reserves the bounded maximum exposure in exact money before any paid call. A bounded builder writes patches into an isolated workspace; a fresh reviewer with its own context reviews the exact commit; the supervisor runs the acceptance cases in the WSL2/Bubblewrap execution worker, with repair rounds bounded by the task (builder/2 allows up to 30 cases, 5 repair rounds and 20 requests, ADR-0109). Packaging re-extracts the archive and runs the cases again on the delivered bytes. Specs can be drafted by a qualified model and checked by a person (ADR-0107). A larger Python build is labelled an unqualified trial unless its exact roles passed the larger benchmark (ADR-0112). [E7, E10, E14, E18](EVIDENCE.md)

**Money and oversight.** Exact-money reservations precede every paid call; the owner's $20 runtime ceiling and per-run and per-model limits are enforced by one studio spending manager (ADR-0113). Plan requests cost $0 but count against caps. Every live step recorded here ran on a plan or a scoped token and spent $0. [E10, E12–E15](EVIDENCE.md)

**External actions.** GitHub access is scoped to listed private repositories, branch prefixes and hourly limits, and each action needs a grant on a registered run (P22). The GitHub App setup (P32, ADR-0132) creates a private app from the studio, keeps its key in the protected vault, and gets a fresh installation token scoped per call. In-app updates (F4, ADR-0128) read a private release, keep an installer only when its size and SHA-256 match, take a verified backup, rehearse any database upgrade on a throwaway copy, and roll back to the earlier version if the new one does not start. [E16, E17](EVIDENCE.md)

**Study instruments.** Frozen-condition machinery, an effort timer for active and waiting time per intervention step (ADR-0122, ADR-0129), a side-by-side comparison of two autopilots labelled "not a study result" (ADR-0120), exports and a reproducible analysis pipeline exist for the future study. None has produced study data. [E4, E10](EVIDENCE.md)

## 4. Methods: executed engineering evidence

The evidence comes in five classes. Each is reported separately and none is a participant evaluation.

1. **Contract and domain tests** with no database.
2. **Database and API integration tests** on a throwaway PostgreSQL server, including refusals, concurrency, crash and restart recovery. The full suite was rerun for this draft (Section 5.1).
3. **Fixture walks**: the real UI and API driven by Playwright against a throwaway database with a fixture provider, $0, no model call. They show the paths work end to end; they say nothing about model behavior.
4. **Live qualifications**: a model answers a frozen benchmark through the real connection. The benchmark's manifest hash, cases, held-out set and pass bar are fixed and committed before the run; held-out cases are not shown to the builder; outcomes are graded by code (and, for builds, by running the cases in the isolated worker). A pass needs every attempt or every held-out case named by the manifest.
5. **Live trials**: an end-to-end action on the owner's real computer and accounts, with a written plan, a typed approval in the project thread, a backup first where data could change, and a record of every step, failure and clean-up.

Rules applied throughout: a pass is bound to its connection, model, prompt hashes and benchmark freeze; a changed candidate voids its evidence; a fixture or test double is never reported as live; and an unknown outcome stays unknown. Live steps ran on the owner's development studio, installed app or a separate trial studio, never on study data. All the live records cite their typed approval. [E10–E17](EVIDENCE.md)

## 5. Results: executed engineering evidence

### 5.1 Test suite

For this draft the full database suite ran on main `b9270db` in the cloud container (Linux, Node 22, PostgreSQL 16, a throwaway server): **1,527 tests, 1,490 passed, 32 skipped, 5 failed**. The 5 failures are the known PowerShell-wrapper tests, which need PowerShell and fail wherever it is not installed. The skips need prerequisites that are not in the container, such as the real WSL2 worker. The development-safety checks did not run after those failures. No Windows, Rust desktop or real-worker test ran. [E11](EVIDENCE.md)

Earlier counts are for different snapshots and environments and must not be summed: October 18 (T19, `3e9026f`): 187 tests, 185 pass, 1 fail (a recovery timing check, repaired and passed alone), 1 expected skip [E9](EVIDENCE.md); November 17 (checked for the #240 change): 1,526 tests, 1,489 pass, 32 skipped, the same 5 PowerShell-wrapper failures [E10](EVIDENCE.md). GitHub Actions is unavailable for billing reasons, so changes were checked this way in the cloud on Linux before merging. The Rust desktop tests have not run on Windows since F4 and N3 landed.

### 5.2 Live qualifications on frozen benchmarks

All runs used GPT-6 Astra on a ChatGPT plan connection unless stated, cost $0, and had Jordan's typed approval.

| Date (2026) | Role or benchmark                                                                                        | Result                                                                                                                                              | Evidence |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Nov 6       | `p14-small-wordtally-v2` (Python CLI)                                                                    | Qualified 3/3                                                                                                                                       | E14      |
| Nov 6       | `p14-larger-ledgercheck-v2`, `-v3`                                                                       | v2 not qualified 0/3; v3 stopped after attempt 1 (reviewer packet over the 24,000-character input cap)                                              | E14      |
| Nov 6       | `p14-larger-ledgercheck-v4`                                                                              | Qualified 3/3 after the owner raised the input cap to 60,000                                                                                        | E14      |
| Nov 6       | `p15-small-signup-v4` (static web)                                                                       | Qualified 3/3; private preview checked by the owner on one product                                                                                  | E14      |
| Nov 11      | Discovery: research synthesis, candidate generation, scoring                                             | Each qualified: practice 2/2, held out 4/4; 18 requests                                                                                             | E12      |
| Nov 11      | Web discovery `web-discovery-v1`                                                                         | **Failed**: practice 2/3, held out 5/7; all three failures were over-long fields the prompt did not state                                           | E12      |
| Nov 11      | Web discovery `web-discovery-v2`                                                                         | Qualified, held out 7/7; one live discovery then proposed 8 quote-checked claims from 5 pages, left for the owner                                   | E12      |
| Nov 14–15   | `p14-repair-v1` (benchmark built to need repairs)                                                        | Verified 3/3, but no attempt needed a repair, so the live repair path was not observed                                                              | E14, E18 |
| Nov 15      | Installed app, builder/1: `p15-small-signup-v5`, `p14-larger-ledgercheck-v5`                             | Both qualified 3/3 (later voided by the builder/2 prompt)                                                                                           | E14      |
| Nov 15      | Installed app, Claude (`claude-sonnet-5-5`, Claude Code), builder/1                                      | **Failed** at the builder role: 2 held-out answers wrapped in a code fence                                                                          | E14      |
| Nov 15      | Rerun after builder/2 and ADR-0110: GPT-6 Astra builder; Claude builder, reviewer, `p15-small-signup-v5` | All qualified (held out 3/3 for each role; 3/3 attempts for the web benchmark)                                                                      | E14      |
| Nov 15      | Claude `p14-larger-ledgercheck-v5`                                                                       | **Not qualified**: attempt 1 failed on a stray tool-call preamble. Owner kept the strict check; the Claude route is qualified for small builds only | E14      |
| Nov 17      | GPT-6 Astra builder requalification (`t12-builder-v3`, dev studio)                                       | Qualified, held out 3/3                                                                                                                             | E15      |
| Nov 17      | `p14-xl-v1` (11-module Python CLI, 25 cases of which 11 held out, 37 extended)                           | **Qualified 3/3**: each attempt 2 of 20 requests, 0 repairs, 25/25 frozen, 37/37 extended, structure ok, about 2.5 minutes; 10 requests in all      | E15      |

Observations. Passes are narrow: each binds to one connection, model and prompt pair, and the November 15 builder/1 passes stopped counting as soon as the builder prompt changed. Two failures came from answer format, not program logic (web-discovery-v1 field lengths, Claude's code fence and preamble); the studio refused them rather than repairing the answer, and the owner chose to keep the strict check. The `p14-xl-v1` pass is the largest build qualified, but by owner decision it lifts no trial label, and its benchmark was written by the same project that built the studio. The repair benchmark did not exercise the repair path live, because every first draft passed.

### 5.3 Autopilot runs

Fixture walks showed the Autopilot page, automation levels and settings working end to end (22 of 22 checks on the page walk). Six live autopilots on the development studio (three first runs and three reruns), with GPT-6 Astra on the plan connection, used web evidence. [E13](EVIDENCE.md)

| Date (UTC) | Run                                 | Where it stopped and why                                                                                                       | Requests  |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Nov 14     | Three first runs (main `5809f09`)   | Not enough evidence at explore; per-run cap of 10 at assess; unknown ratings at choose                                         | 13        |
| Nov 14     | Rerun, schema 63                    | Held claims for review; after Allow, discovery refused a "too large" packet in a busy workspace                                | 5         |
| Nov 15     | Rerun, main `9172584`               | Assess, choose and two gather rounds; out of autopilot calls after 18 real requests (worst-case reservations); nothing chosen  | 18        |
| Nov 15     | Rerun, main `42dce84` (#205)        | Four assess–choose–gather rounds, each stopped on unknown ratings; the ChatGPT account's own usage limit then refused assess   | 26        |
| Nov 15     | Same autopilot continued (typed OK) | Ended with a proposal: "Human-led handoff diagnosis before selecting an intervention", recommending a non-software alternative | 28 in all |

Observations. Every live run stopped where a person, a limit or a refusal required, and the routine approvals ended with the autopilot. Each run also found defects that fixture walks had not (cap sizing, packet size in a busy workspace, reservations held after use, a raw database error, cut-off notes, a retried usage-limit refusal), and each was fixed in a reviewed change; the next rerun confirmed the earlier fixes live. The autopilot never chose an option by itself: with thin public evidence the assessor left feasibility, maintenance burden or stakeholder acceptability unknown, and further evidence gathering did not settle them. Unscoped web searches drifted across topics, and runs took problems nobody had picked. The one completed run recommended a human-led alternative rather than software. These are observations of one system on one owner's account, not rates.

The primary records of these runs (screenshots, run records and notes) are on Jordan's PC and not yet committed; the thesis cites the run reports written at the time, copied into the repository with their hashes. **Needed:** commit the P13 evidence folders from the PC (listed in E13).

### 5.4 Live trials of external actions

| Date (2026) | Trial                                    | Result                                                                                                                                                                                                                                           | Evidence |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Nov 10      | GitHub with a fine-grained token (P22)   | Connect and verify matched the owner; two pushes, a branch and a pull request on one private test repository succeeded under a time-limited grant; check runs were not readable with that token; nothing merged; connection revoked after        | E16      |
| Nov 17      | GitHub App created from the studio (P32) | GitHub accepted the manifest; the app was installed on one selected repository; the connection verified; branch and issue creation passed. Push, pull request and checks were not tested. Repository creation got a 403 whose cause is unsettled | E16      |
| Nov 17      | In-app update, part 1 (F4)               | A deliberately broken release failed its database rehearsal and the real database was not changed; but putting the earlier files back failed (`rollback_failed`), and the earlier version ran from its saved copy                                | E17      |
| Nov 18–19   | In-app update, part 2                    | After a fix, the rollback failed again after 3 minutes of retries. Cause found: two processes had the install folder as their working folder                                                                                                     | E17      |
| Nov 19      | In-app update, rerun 2                   | **Passed**: a broken 0.1.7 rolled back on the first attempt with the same data; a forced Windows restart during the 0.1.8 update ended `update_confirmed`; the installer preselected "Do not uninstall"                                          | E17      |

Observations. The GitHub actions stayed within the listed repository, prefixes and grant, and the trials record what was not tested. The update trials show the value of the design's safety order: in both failed trials the database rehearsal had already refused the broken upgrade, so the owner's data was never at risk, and the failure was in restoring program files. The forced restart came from the trial's own watcher, not the app; the owner then ruled that an update must never restart the computer by itself.

### 5.5 Negative and missing results

Kept in view, not discarded: failed qualifications (web-discovery-v1; larger-build v2 and v3; Claude builder/1 and the larger Claude build); a repair path never observed live; autopilot runs that never chose on their own; GitHub push, pull request and checks through the App untested, and repository creation unsettled; two failed rollbacks before the fix; Windows notifications (N3) and the Rust tests not yet run on Windows; no real (non-trial) release shipped through the updater.

## 6. AI-only frozen run (placeholder)

> **PLACEHOLDER — no results yet.** This section will report one small frozen AI-only run on held-out tasks, designed in a separate piece of work. Until its protocol is frozen and the run is executed with the owner's typed approval, nothing here is a result. Do not fill this section from fixture runs, pilot outputs or the qualifications above.
>
> To be filled from the frozen protocol and its records:
>
> - Protocol: frozen commit and hash, freeze date, tasks and held-out cases, model, connection and role prompts, caps and stop rules, success criteria fixed before the run.
> - Execution: dates, requests, spend (expected $0 on a plan connection, recorded either way), stops for a person and refusals.
> - Results: per-task outcomes, including failures and blocked tasks, with executed acceptance checks.
> - Limits: one model, one owner's account, no matched human or assisted arm, so no comparison and no RQ1 answer.
>
> Evidence ID reserved: [E19](EVIDENCE.md).

## 7. Proposed comparative study (future work)

The original design compares three conditions. In condition A, the AI receives only the initial brief and configuration. In condition B, the same AI configuration works with recorded human decisions, reasons, active effort and waits. In condition C, a person uses ordinary non-generative tools. All conditions receive comparable frozen task packets and acceptance criteria; decision and implementation strata are analyzed separately; autonomous needs-human outcomes stay in their assigned denominator. A separate study compares structured with open-ended discovery. The owner's October 20 decisions RD1–RD10 set the provisional design: four decision and two implementation tasks across three arms, a single-participant case study with matched variants, two independent blinded reviewers, a recorded institutional determination before any collection, GPT-6 Astra with a $20 cap, and one infrastructure retry only before any output. [E1–E4, E10](EVIDENCE.md)

None of this has run. The protocol was never frozen, no participant or reviewer is recorded, and no institutional determination is recorded. The implemented analysis plan (complete-dimension averages, no imputation, task-level pairing, every assigned slot in the denominators, undefined cost per accepted outcome at zero accepted outcomes, weighted kappa for exactly two reviewers, a bootstrap that needs at least ten task pairs) remains a proposal. The bootstrap minimum exceeds the proposed per-stratum counts, so the current small design would not yield those intervals. The run-comparison page and the effort timer are instruments for this study, not study results.

### Empirical results of the comparative study — unavailable

| Outcome                                    | A           | B           | C           | Structured vs open-ended  |
| ------------------------------------------ | ----------- | ----------- | ----------- | ------------------------- |
| Independent solution quality               | Unavailable | Unavailable | Unavailable | Unavailable               |
| Evidence reliability                       | Unavailable | Unavailable | Unavailable | Unavailable               |
| Final functional completion                | Unavailable | Unavailable | Unavailable | Not the discovery outcome |
| Actual comparative spend/time/effort       | Unavailable | Unavailable | Unavailable | Unavailable               |
| Necessary/missed/unnecessary interventions | Unavailable | Unavailable | Unavailable | Unavailable               |

Unavailable does not mean zero, a null effect or failed participants. The AI-only run in Section 6 must not populate column A of this table: it uses different tasks, and condition A is defined relative to matched B and C arms.

## 8. Ethics, oversight and limitations

Local control does not mean offline inference: approved context leaves the computer for the model provider. No participant, reviewer or institutional determination is recorded, and none is implied; any future collection waits for one. The live runs used synthetic or public data and the owner's own accounts, and the owner typed an approval for each. The $20 runtime ceiling was not raised and no live step spent money.

Limits on what the evidence supports. All live evidence comes from one owner, one Windows computer, mostly one model (GPT-6 Astra) on one ChatGPT plan, and a second route (Claude through Claude Code) for builds. Benchmarks were written by the same project that built the studio; held-out cases protect against tuning to the cases but not against the author's view of what matters. Qualification passes are small samples (three attempts, four to eleven held-out cases) and bind to one prompt version. Selected successful demonstrations have selection bias and estimate no completion rate. Several roles using one model have correlated errors and are not independent reviewers. Fixture walks show paths, not model behavior. Hashes prove byte identity under stated trust assumptions, not source truth, beneficial impact or comprehensive security. The desktop app's Windows-only code has fewer executed checks than the rest. Functional correctness, usefulness and social benefit remain distinct outcomes, and only the first is measured.

Non-code choices can be successful decisions; the one completed live autopilot recommended a human-led alternative. Counting only builds would bias any later study against appropriate humility. Conversely, always deferring can avoid errors while failing to help, and the live runs stopped often. Whether those stops were necessary needs the human coding that RQ3 calls for.

## 9. Discussion and remaining work

The artifact shows that authority, money and verification can be held by application code in a working studio while models do the proposing and the work, and that the controls held in live runs against real services and the owner's real computer. The evidence supports specific enforcement paths and specific qualified roles, not universal safety or general program synthesis. The strongest live results are the discovery and build qualifications on frozen held-out benchmarks (including `p14-xl-v1`) and the update trial that failed safely twice before passing. The weakest are autonomy itself (no live autopilot chose on its own) and the untested GitHub steps.

Remaining before submission: the AI-only run (Section 6); committing the PC-only autopilot evidence (E13); a source-checked related-work chapter; the committee's view on sufficiency; formatting to university rules; and a defense rehearsal ([checklist](COMMITTEE_REVIEW.md)). RQ1–RQ3 remain for the proposed study.
