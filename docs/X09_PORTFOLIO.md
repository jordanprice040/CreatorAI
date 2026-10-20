# X09 portfolio scheduling and reviewed knowledge

Implemented October 19, 2026, on `codex/x09-portfolio`, based on local X08 commit
`64596ef` (whose upstream baseline was main `0dfc6e6`). The managed checkout keeps
its original directory name, `C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`.
The original X05 checkout and Claude's UI/UX work remain separate.

## What scheduling does

The **Portfolio** view (`#/portfolio?ws=<workspace-id>`), authenticated API and CLI
manage durable interval schedules. Supported operations are:

- Source refresh through the existing source broker and its current host/data/grant
  rules. A schedule pins the source reference/version/hash and URL identity. Later
  source content versions can change; changing/withdrawing the pinned URL requires
  a new schedule. Results name actual retrieval records and their outcomes.
- Product health by rehashing the registered private package through the existing
  artifact supervisor. A pass means **archive integrity**, not application uptime,
  functional re-execution, customer usefulness or production readiness.
- Bounded skeptic review through the existing durable workflow. A scheduled job's
  successful receipt means the workflow was created; inspect that workflow for
  review results, model usage and remaining decisions. It is not a build/QA pass.

Intervals are at least 60 seconds. Each pass starts at most the configured cap
(1–8). A workspace cooldown (15 seconds or longer) applies to manual and background
passes together. Missed intervals coalesce into one job and the next due time is
set from the current database clock; there is no backlog of catch-up slots. One
open job per schedule and unique schedule/slot identity prevent duplicate dispatch.
Capacity remains occupied by unknown jobs until reconciliation. All effects use
stable IDs and existing admission; paid exposure is reserved by the existing
broker, not estimated or granted by the scheduler.

Manual passes work with `portfolio/tick`. Optional API-process polling is enabled
only by `CREATOR_PORTFOLIO_SCHEDULER=on`; the default is **off**. Polling visits at
most 100 configured workspaces per pass, under the policy-recording human owner
whose current ownership is rechecked. It runs only while that API process runs.
It is not an OS scheduler or hosted uptime guarantee. The worker and enabled
adapters remain separately configured. Verification used manual passes and fixture
adapters; unattended polling and live external dispatch were not activated.

## Configure actual allocations and obligations

First use **Budgets** to allocate an active global envelope and a dedicated active
period child for maintenance. Parent/child accounting actually carves out that
authority and preserves the existing budget journal. Configure the portfolio with
both IDs, a maintenance reserve floor, capacity and backlog thresholds. Budget
identities remain fixed for that workspace policy; other settings use optimistic
versions. The scheduler never creates funding or changes financial enforcement.

Register a non-study, non-human-only run, its grants and bounded run budget before
using it in a schedule. Run lanes are immutable: `maintenance`, `improvement`,
`exploration`. A run belongs to at most one schedule; cancelling a schedule also
cancels its dedicated run. Improvement and exploration use separate run envelopes,
even if their parent period is shared. Unclassified runs are treated conservatively
as exploration. Maintenance calls must spend within the protected maintenance
subtree; other calls must spend outside it, under the configured root.

Executable controls apply in the shared admission and broker paths, including
manual model/build requests and workflow leasing, rather than only in the UI:

| Mode/obligation                                                      | Result                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `normal`                                                             | Eligible work proceeds within existing authority and resource limits             |
| `conserve`                                                           | Exploration stops; active capacity is halved, rounded down with a floor of one   |
| `maintenance_only`                                                   | Improvement and exploration stop                                                 |
| `paused`                                                             | No new portfolio-controlled dispatch; already dispatched effects remain recorded |
| Maintenance due, unresolved maintenance workflow or health attention | Non-maintenance work waits                                                       |
| Reserve availability below the configured floor                      | Non-maintenance work waits                                                       |
| Review backlog at threshold                                          | Exploration waits; improvement/remediation may proceed                           |
| Active jobs/workflows at capacity                                    | New work waits; older unfinished workflows keep their slots                      |

The reserve's available amount excludes allocated children, reserved exposure,
unknown outcomes and incurred usage. Child allocations therefore conservatively
reduce the remaining reserve until unspent authority is returned through existing
budget closure. Existing ancestor-overrun checks and payment/reinvestment controls
remain authoritative. A zero reserve floor is an explicit owner choice, not an
implicit unlimited budget. Host compute is unmetered, not assumed free.

Review backlog includes pending human decisions and submitted artifact feedback.
Inspect/submit/triage product feedback in the existing **Gallery**. The portfolio
shows those records and health observations. An owner can explicitly defer or
reopen one exact health observation with a reason. Deferral changes the obligation
to `owner_deferred`; it retains the failed job/report and never records a health
pass. A later check can raise attention again.

## Cancellation and uncertain outcomes

Cancellation is monotonic. It marks the schedule before cancelling its run, and
both states are checked before new dispatch. It cannot undo an already dispatched
source request or usage; reports preserve those observations. Existing workflows
use their normal cancellation and fencing behavior. There is no public release,
outreach, payment or credential operation in a portfolio schedule.

A stale dispatcher becomes `unknown` and is never automatically retried. Explicit
reconciliation reads the source retrieval or workflow idempotency receipt without
resending. If no durable effect intent exists, the job is closed and a resumed
dispatcher is fenced from starting after that reconciliation. An in-flight source
receipt remains unknown until the existing retrieval lifecycle resolves it.
A lost package-health read has no effect receipt and is closed without claiming
the missing observation. A future scheduled read is a new observation.

## Reviewed reusable knowledge

Store a `component`, `lesson`, `prompt` or `skill` as versioned, bounded task guidance
with provenance references/locators, permitted lanes, data class, permitted use and
limitations. A component can point to an artifact/file; this feature does not
automatically install code. A skill is passive task guidance, not an executable
plugin, system prompt, filesystem `SKILL.md` or policy loader.

The flow is **propose → execute structural regression → human review of the exact
hash and regression record → activate**. Proposals and regression records retain
their original content. Activation uses the expected current version, and rollback
selects an earlier still-reviewed version. Revocation removes an active head and
fences future dispatch of queued workflows bound to that version.

The server's regression actually parses the bounded schema, validates current
provenance and renders guidance into a synthetic task. It checks that constraints
were added while permissions, budget, model and condition remained unchanged.
The persisted record binds the candidate hash, verifier version and before/after
hashes. These are **structural regression checks**, not independent empirical
evidence of better answers. Human review and task-level usefulness evaluation
remain separate.

To use active knowledge in a real review task, add `knowledge_keys` to the existing
workflow-start request or scheduled review request. The application resolves exact
reviewed versions, rechecks current provenance/permitted use and appends labelled
task data to constraints. Workflow/task hashes and immutable workflow/knowledge
bindings retain the selected versions. It does not change models, policy, tools,
credentials, permissions, budgets, acceptance criteria or finance. Promoting a new
head does not silently replace an existing task's pinned version; revoking its
bound version or changing source provenance blocks new dispatch.

Study attempts are excluded from changing portfolio controls and cannot consume
knowledge. Study workspaces and pinned study specifications cannot supply reusable
knowledge. Existing frozen protocols, held-out tests and human-only boundaries
remain enforced through the original study paths.

## API and CLI

All paths below are under `/api/workspaces/:ws`; mutation requires the existing
owner session/CSRF controls. Read access uses current workspace membership.

| Method/path                           | Action                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET `portfolio`                       | Policy, reserve/backlog/capacity, schedules, jobs, health, feedback and knowledge evidence |
| POST `portfolio/policy`               | Configure/update exact allocations, mode and limits with `expected_version`                |
| POST `portfolio/runs`                 | Assign an immutable run lane                                                               |
| POST `portfolio/tick`                 | One bounded pass; body `{}`                                                                |
| POST `portfolio/reconcile`            | `job_id`, `reason`; no redispatch                                                          |
| POST `portfolio/health`               | `artifact_id`, `expected_job_id`, `choice: defer/reopen`, `reason`                         |
| POST `portfolio-schedules`            | Create immutable scoped interval schedule                                                  |
| POST `portfolio-schedules/:id/cancel` | Cancel schedule and its dedicated run with `reason`                                        |
| POST `reusable-knowledge`             | Propose immutable candidate/version                                                        |
| POST `reusable-knowledge/:id/verify`  | Execute structural regression; body `{}`                                                   |
| POST `reusable-knowledge/:id/review`  | `body_hash`, `regression_id`, `reason`                                                     |
| POST `reusable-knowledge/activate`    | `candidate_id`, `expected_active_id` or null, `reason`; also rollback                      |
| POST `reusable-knowledge/:id/revoke`  | `reason`                                                                                   |

CLI: `portfolio`, `portfolio-command`, `portfolio-schedule`, `portfolio-cancel`,
`knowledge-propose`, `knowledge-command`, `knowledge-activate`. Run CLI help for
arguments. JSON/file payloads use the strict schemas in
`packages/contracts/src/portfolio.ts`. The screen provides an advanced reviewable
configuration editor; blank template IDs must be replaced with workspace records.

## Integration and limits

Migration 22 adds durable policy/lanes/schedules/jobs, health, immutable knowledge
versions/regressions and exact workflow bindings. No existing studio database was
migrated during development. X08 is preserved in local commit `64596ef`; X09 stays
separate. Claude integration requires only the new `portfolio.tsx` plus its import/
view case in `main.tsx` and view tuple in `ui.tsx`. Shared CSS and existing component
props are unchanged. Apply Claude's semantic theme when merging the workstreams.

See `tracking/evidence/x09` for executed tests and browser evidence. No live
provider/source activation, paid call, public deployment, outreach, account change
or automatic reinvestment was performed. Health is archive integrity only; source
refresh does not establish source truth; stored skills are bounded guidance;
quality gains, market demand and profitability are not claimed. No profit or fixed
production quota is required for useful maintenance or a justified defer decision.
