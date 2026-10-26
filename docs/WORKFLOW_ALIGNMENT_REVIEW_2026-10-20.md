# App, workflow and roadmap alignment review — October 20, 2026

Scope: read-only review of current checkout UI, API composition, workflow worker,
resource setup, accepted owner decisions, runbook and recorded evidence. No native
walkthrough, live inference, external search, tests or release acceptance executed.
Installed app parity is not inferred from checkout code. Existing changes preserved.
This report proposes planning changes; it does not add/authorize implementation scope.

## Overall assessment

The architecture and accepted direction align: local studio control, bounded work,
source-to-artifact provenance, alternatives including non-code outcomes, isolated
builds, owner decisions and separate research conditions. The main mismatch is the
ordinary user journey. Current screens expose research/developer setup while the
product direction expects a studio that takes a request and coordinates that work.
Many missing capabilities are already planned; avoid duplicating them as new systems.

## Prioritized findings and proposed runbook refinements

1. **Connect model setup to actual workflow execution (blocking useful plan-only discovery).**
   API composition constructs PlanConnectionService separately from ModelBroker;
   Worker consumes ModelBroker. Submit still requires pricing/envelope IDs. A signed-in
   plan connection and narrow summary qualification therefore do not establish a
   working plan-backed locator/designer/evaluator path. §2.19 correctly recognizes
   billing admission but should explicitly own the workflow dispatch bridge, per-role
   capability/qualification mapping and parity between embedded/standalone workers.
   Verify an entire bounded discovery through that bridge, not just direct calls.
   Evidence: apps/api/src/index.ts (plan service and broker composition),
   packages/orchestrator/src/worker.ts constructor, packages/orchestrator/src/main.ts,
   apps/web/src/submit.tsx request/readiness. Ollama remains explicitly unimplemented
   in apps/web/src/models.tsx; §2.3 is planned, not another usable route today.

2. **Make research collection an actual stage after submitting a theme.**
   Submit loads existing claims, requires selected evidence and a concrete measurable
   problem, two fields and outcome before discovery. Its documented behavior does not
   search the web. Evidence UI fetches a supplied URL in an existing run. Source search
   exists as a separate API; adapter documentation says activation/qualification is
   outstanding. Ordinary users must currently supply much of the research the studio
   is meant to do. §2.5/§2.17–§2.19 should share an explicit sequence: draft intent ->
   bounded research plan -> search/fetch -> supported claims -> concrete brief ->
   alternatives/scoring. Preserve a manual evidence-first path for expert/study use.
   Acceptance must begin with no existing claims and reach a supported comparison.
   Evidence: apps/web/src/submit.tsx, apps/web/src/evidence.tsx,
   apps/api/src/index.ts source-searches route, docs/RESEARCH_RETRIEVAL.md.

3. **Carry selections through build, package and revision inside the app.**
   Compare records a selection, but Gallery's empty state instructs artifact-package
   and accepted feedback instructs feedback-revise. These are concrete breaks in the
   self-contained desktop journey. Group 3 describes an outcome without assigning
   every remaining user-facing transition. Add stage-specific actions and prerequisite
   checks: prepare/review spec -> build/review/test -> package -> inspect/export ->
   feedback -> bounded revision. Show non-code completion equally clearly; no automatic
   build from a research request. Reuse current APIs and exact-version gates.
   Evidence: apps/web/src/compare.tsx; apps/web/src/gallery.tsx (empty state and feedback);
   runbook Group 3. Python CLI is the explicitly current product recipe: do not imply
   arbitrary websites/apps can be generated. Broader recipes need separate milestones.

4. **Align discovery limits and data sharing with selected workspace/route/pilot.**
   Submit uses fixed max_concurrency=2, max_calls=24 and max_wall_seconds=900;
   its request data_class is synthetic and its optional grant is synthetic-only,
   $2 maximum for 24 hours. Accepted pilot requires one model job and no new metered
   spend. These constants are not evidence of a backend bypass, but the visible setup
   is not derived from the user's actual route and pilot policy. Define one resolved
   run setup showing effective parent limits and data classification; public/private
   evidence needs correct sharing authority, not a synthetic label. Show the actual
   scope before dispatch, and test the real-workspace path under stricter pilot caps.
   Evidence: apps/web/src/submit.tsx LIMITS, request and grant creation; owner #14/#26/#31.

5. **Choose a viable evidence route for the zero-new-spend pilot.**
   The provisional search adapter needs separate pricing, grant and envelope; a GPT
   plan connection alone does not cover it. Group 4's $0 new metered spend must remain.
   §2.5/§2.19 should offer explicit supported choices: user-provided public sources,
   approved direct source fetching, or separately verified search access compatible
   with that ceiling. Do not promise autonomous web discovery until search coverage,
   terms, access and resource accounting pass. Show exactly which research operations
   remain available when search is unavailable. This does not require a new provider.
   Evidence: docs/RESEARCH_RETRIEVAL.md; runbook §2.5 and Groups 3/4; owner #26/#32.

6. **Make first use and readiness task-oriented.**
   NewWorkspace defaults to fixture, and empty workspace text points to a seeded CLI
   demonstration. Monitor is a run dashboard; navigation exposes 18 peer views across
   five groups. These are legitimate diagnostic surfaces but insufficient guidance
   for a new real user. Add a short setup checklist showing real vs demo, connection,
   task readiness, sources, limits and a first useful action. Provide a reason and a
   direct repair destination when blocked. Keep Studies/Campaigns/advanced operations
   available without requiring them for ordinary research. Tie this to §2.1/§2.14/
   §2.15/§2.17, rather than redesigning navigation in isolation.
   Evidence: apps/web/src/main.tsx NewWorkspace/empty state; ui.tsx VIEWS/VIEW_GROUPS;
   overview.tsx. This is a source-based usability finding, not an observed user trial.

7. **Finish owner resource controls, not only money-envelope forms.**
   Accepted #10 requires adjustable overall/provider/model/project/task ceilings.
   Budgets currently presents funding/envelope operations and Models presents plan
   caps; those are different concepts. Define where users choose overall defaults,
   route-specific limits and effective run exposure; don't make them understand an
   accounting envelope to start a plan-only run. §2.2/§2.10/§2.19 should share that
   settings contract. Preserve user authority to raise their ceiling explicitly and
   all parent enforcement. Existing ledger safeguards remain necessary.
   Evidence: apps/web/src/budgets.tsx, models.tsx; accepted #10; runbook §2.19.

8. **Reconcile current status and delivery order before choosing more feature work.**
   PROJECT_CONTEXT still says no repository was inspected/no feature implemented.
   Readiness config is dated October 19 and says no live model call has been made.
   Historical tracking sections still say sign-in/WSL installation are outstanding,
   superseded by newer entries. Runbook §2.15 and footer still select §2.1/§2.2 while
   §2.17–§2.19 add different dependencies. Preserve history but label superseded
   statements and publish a concise current status/dependency table: implemented,
   installed, qualified for which task, live verified, blocked, next bounded prompt.
   Do not upgrade discovery readiness from summary evidence. Include C52/C53 and
   §2.19 coverage explicitly without pretending any are complete.
   Evidence: PROJECT_CONTEXT current status; config/readiness.json; BUILD_STATUS and
   SESSION_HANDOFF; runbook §2.15/footer. Blank pilot config is correctly not activated,
   but its owner-selected defaults can be prepared separately from dates/activation.

9. **Protect a small useful release from roadmap expansion.**
   §2.15's first useful release includes broad file/routing/navigation work, while
   central chat and simple plan-backed research are later additions. Reorder by
   dependencies and the accepted dependable-core priority: current status/readiness
   -> qualified connection/workflow bridge + limits -> simple research/evidence intake
   -> cited comparison/decision -> one supported build/export/feedback path -> bounded
   owner walkthrough/pilot. Chat can begin with a narrow intake slice; theme-free
   exploration follows reliable research. Retain richer editors/maps/conversions,
   hosted mode, commerce and campaigns as explicit later scope. Confirm that release
   cut with the owner rather than silently removing accepted requirements.
   Evidence: accepted #20/#22–#32/#44–#52; runbook §2.15/§2.17–§2.19 and Groups 3–5.

## Already aligned; retain

- Evidence confidence, counterevidence, alternative responses and version-bound
  decisions are core product behavior, not optional future polish.
- Non-code/defer outcomes remain valid; a separate software-path check verifies builder.
- Source ingestion does not mean provider sharing or verified evidence.
- Public release, messaging, commerce, wider access and schedules retain scoped gates.
- Operational pilot/model qualification do not substitute for frozen thesis evidence.
- Current request does not justify stack changes or another orchestration framework.

## Proposed next planning action

Amend existing §2.5/§2.15/§2.17–§2.19 and Group 3 with findings 1–9, rather than
adding nine disconnected milestones. First implementation candidate is §2.19's
workflow/resource bridge plus simplest theme-to-evidence intake, with declared
qualification prerequisites. No runtime or runbook changes made by this review.


## Accepted workflow-alignment planning — October 20, 2026

Owner accepted all nine findings and native plan search/Agent Reach comparison
for later implementation. Runbook impact map covers §2.5A native search first,
selective upstream comparison, §2.10 shared resource settings, §2.14 onboarding,
§2.15 status reconciliation/delivery order, §2.17 research handoff, §2.19A role
workflow dispatch/worker parity/effective limits/data sharing and Group 3 in-app
spec/build/package/revision. These are plans, not implemented/activated features.
Official plan docs permit web search subject to model/account/workspace policy;
current app integration/qualification is missing. Agent Reach remains a candidate,
not an installed dependency or replacement provider. No spending, schedule or study
changes. Next eligible prompt: §2.15 current-status reconciliation, then explicitly
select a bounded dependency-complete implementation slice. Documentation checks
only; no runtime tests/live calls. Existing unrelated changes preserved.

Search clarification supersedes any implication in finding 5 that plan-backed
search cannot work. Reference checked October 20:
https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
A subscription still does not cover unrelated search-provider charges. The original
review's proposal/not-added state is superseded by this accepted planning update.
