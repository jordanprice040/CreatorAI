# Theme-intent current-work safety design — October 26, 2026

Status: repository-only design by Codex, not independently reviewed, implemented
or authorized for operation. Native acceptance blocked, original A0 blocked,
NI cases not-run, H unverified, full C54 partial. M3 is unchanged.

## Selected approach and present disposition

Select a standalone bounded **database-only current-work inspection**, conditional
on establishing producer exclusion and exact operational bindings. Reuse reviewed
predicate knowledge, not the upgrade helper's executable entry point. Do not
launch the desktop/service to inspect its work queue. The existing candidate and
historical installation evidence can remain intact with this approach.

Operational admission is presently **deferred**: port/configured tools/active-home
bindings, reviewed operational reader/collector, producer exclusion, a protected
database access path and its concrete grant do not yet exist or remain unresolved.
Jordan explicitly reports other-session/work-producer access as unknown. A clear
database snapshot would not resolve that uncertainty or establish continuous
exclusion. Do not implement multiple speculative alternatives or ask Jordan to
approve an unsupported launch. Review this design first.

If exclusion cannot be supported, do not execute this inspection as an acceptance
gate. Stop for a new bounded startup-control design or defer acceptance; neither
implementation nor installation of a changed candidate is selected here.

Governing documents: [amendment v2](THEME_INTENT_POST_LAUNCH_ACCEPTANCE_AMENDMENT_V2_2026-10-26.md),
its [independent review](THEME_INTENT_POST_LAUNCH_ACCEPTANCE_AMENDMENT_V2_REVIEW_2026-10-26.md),
[plan v5](THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md), and
[proposal v4](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2026-10-24.md)
with notes v4.1–v4.4. This is a proposed current-work safety supplement, not a
retroactive A0 pass, amended native-session grant or general operating policy.

## Exact candidate and source fidelity

Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`;
installation plan `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.
Primary executable-source evidence is the repository artifact
`.verification/theme-intent-artifacts-2026-10-23/studio/service/app/dist/studio.mjs`,
SHA-256 `9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88`.
Direct hashing matches the exact package reviewer map. Also directly matched
`apps/api/src/index.ts`, `apps/api/src/studio.ts` and
`packages/broker/src/plan-service.ts` to that map. No installed file was read.
Other current source is a navigation aid unless independently bound; the bundle
locators below refer to the hashed executable-source artifact, read as text only.
No import, module evaluation or service command was run.

### Automatic work and admission trace

| Path in exact bundle (one-based lines)                                                                                                                              | Observed source behavior                                                                                                                                                 | Required safety coverage                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serveStudio`, 55682; `createApi` call around 55715                                                                                                                 | Checks database/schema then passes a literal environment to API. It does not set worker off; merely setting an inherited shell variable is not a reviewed native control | No desktop/service startup during inspection. Schema readiness is not queue readiness. Do not invent an environment workaround                                                                 |
| Worker/scheduler selection, 54654–54691                                                                                                                             | Portfolio scheduler defaults off; workflow worker defaults on                                                                                                            | M3 remains configuration evidence only. Scheduler-off does not exclude workflow execution                                                                                                      |
| API `init`, 54695–54730                                                                                                                                             | Schema check, operations/environment and actor setup, broker/retrieval recovery, outbox drain, then worker/scheduler start                                               | Distinguish startup bookkeeping from dispatch. New inspection must not call API init or any mutating store method                                                                              |
| API relay and `ensureReady`, 54734–54755                                                                                                                            | Retry initialization on a later request after failure; recurring outbox relay plus periodic recovery                                                                     | No health/readiness request as an inspection shortcut. Safety must cover retries and later ticks, not only initial startup                                                                     |
| Worker `tick`, 46140 onward                                                                                                                                         | Sweep expired leases, wake decisions, reconcile unknown tasks, coordinate all unfinished workflows, then claim and execute tasks                                         | Reject all unfinished workflows and nonterminal tasks, including paused/waiting/reconciling states, not just runnable tasks                                                                    |
| `claimTasks`, 28703 onward                                                                                                                                          | Selects unfinished run-controlled workflows with queued tasks; applies portfolio gate, concurrency, leases and fencing                                                   | A valid preexisting workflow can run without a new UI click. Fencing/concurrency are not proof of no eligible work                                                                             |
| Outbox `drainOutbox`, 25784; workflow `consume`, 28867                                                                                                              | Projects undelivered events and wakes waiting tasks for answered/closed decisions                                                                                        | Require no undelivered outbox events in addition to no unfinished workflows/tasks. This is stricter than the historical helper's count list and must be reviewed, not called an inherited gate |
| Broker `sweepStale`, 27916; retrieval `sweepRetrievals`, 29442                                                                                                      | Lost in-flight money exposure becomes unknown; stale retrievals are closed as interrupted                                                                                | Never use a sweep to make inspection counts zero. Unknown exposure stays blocking and retained                                                                                                 |
| Plan `invoke`, 45806; `admitPlanRequest`, 41325                                                                                                                     | Admission precedes token access/transport; workflow lease/scope, connection/settings, role and resource admission bind requests; prior outcomes can replay               | Checks support bounded permitted execution, not the claim this acceptance session permits existing work. Require no live/unknown plan requests or running qualifications                       |
| Model broker call / `prepareAttempt` (source `packages/broker/src/broker.ts:202`, `packages/db/src/budget-store.ts:802`; bundle corresponding compiled definitions) | Reservation/admission precedes adapter dispatch; cancellation and uncertain outcomes preserve exposure                                                                   | Do not equate an available budget or historical grant with this no-dispatch session's authority. No in-flight/unknown reservations admitted                                                    |
| Portfolio `tick`, 54397; preview request handling, 53610–53667; source-fetch POST around 55060                                                                      | Portfolio may fetch/execute when explicitly enabled; preview execution is a request path, not a constructor start; source fetch has its own POST route                   | Keep M3 off identity, no preview/source/model/action clicks and no unrelated authenticated producers. Presence of a function in a bundle does not prove automatic invocation                   |

This trace establishes why source-only clearance fails; it is not a new exhaustive
audit of every provider or an assertion of a permission bypass. Database startup
also differs from application startup: native `studio.rs:400` starts/reuses the
managed cluster and loads the database secret before spawning serve. The proposed
inspection must bypass serve entirely through a separately reviewed narrow path.
No existing generic helper is approved for that purpose by this document.

## Concrete inspection contract for separate review

Call the future capability CW-01. It is a new inspector, not PR-01 or SH-01 and not
an option to run `state()` from the upgrade helper. The helper combines quiescence
assertions with broader hashes/config/backup/migration machinery; reuse only
reviewed query definitions after adaptation to exact schema29.

### Admission and binding

Require a versioned exact manifest naming active home/literal desktop key,
installation/resource map, managed cluster `postgres/data`, current configured
database/port, tool paths/hashes/version provenance, exact SQL list/hash, actor and
protected credential access mechanism. Port and pg_bin cannot come from defaults,
PATH or the unbound PostgreSQL18 candidates. Missing fields block. Settle reader
N1–N4 and collector L1/L4 in their separate reviewed implementations.

Before cluster access, reviewed PR-01 must establish stopped state and exact
identities, with full v4.1–v4.4 handle/launch exclusion semantics. Any active or
ambiguous cluster blocks this stopped-cluster design; do not connect to an already
running cluster, adopt it or stop someone else's cluster. No studio service/API,
worker, preview, provider transport or migration may start with the inspector.

Producer exclusion must cover all sessions/users, standalone workers/helpers,
scheduled/quiet launches and other clients that could reach this home/database,
from preflight through later approved native session completion. Exact-target
metadata/process observations and a knowledgeable operator attestation may support
a threat-bounded claim, but a Local namespace mutex or a cooperative inspector
lock does not enforce exclusion against unrelated clients. Unknown access remains
blocking. If review requires enforcement, no new exclusion mechanism is assumed;
design a separate control or defer. No broad account enumeration is proposed.

### Predicates: one consistent all-workspace snapshot

Proposed transaction: fixed schema29 query allowlist, repeatable-read read-only,
no user expressions or arbitrary SQL, no store initialization/repair function.
Reject wrong migration version/checksum or unknown tables/states. Exact statements
must be independently reviewed before implementation. Emit named integer counts
and availability, not rows, prompts, titles, credentials or raw database responses.
Every required count below must be zero; absent/failed queries are unavailable.

| Relation / predicate                                                          | Reason                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Other client backends for the target database, excluding only this connection | Detect concurrent clients at observation time; does not prove absence between observations or future access             |
| `workflows`: `finished_at IS NULL` OR state not in succeeded/failed/cancelled | Match actual worker enumeration as well as state labels; include paused/waiting work and inconsistent terminal metadata |
| `workflow_tasks`: state not in succeeded/failed/cancelled                     | Include dependency waits, queued, leased, waiting-human and reconciling tasks                                           |
| `outbox`: `delivered_at IS NULL`                                              | Exclude deferred projection/wakeup; never drain to pass                                                                 |
| `plan_requests`: state not in completed/failed/rejected/reconciled            | Exclude in-flight and unknown subscription outcomes                                                                     |
| `plan_qualifications`: state running                                          | No qualification work in progress                                                                                       |
| `budget_reservations`: status in in_flight/unknown                            | Exclude unresolved paid exposure without relabeling it zero                                                             |
| `source_retrievals`: state in_flight                                          | Exclude unfinished retrieval and automatic recovery effects                                                             |
| `context_batches`: status submitting/submitted/unknown                        | Exclude pending or uncertain external batches                                                                           |
| `github_operations`: state dispatched/unknown                                 | Exclude unresolved repository operations                                                                                |
| `marketing_deliveries`: state dispatching/unknown                             | Exclude unresolved outbound delivery                                                                                    |
| `portfolio_jobs`: state dispatching/unknown                                   | Exclude unresolved portfolio work                                                                                       |
| `desktop_jobs`: state not in completed/cancelled/expired                      | Include queued/leased/running/reconciling worker jobs                                                                   |
| `artifact_previews`: state starting/ready                                     | Exclude existing live preview execution surfaces                                                                        |

These adapt the 13 historical `state()` assertions in
`scripts/theme-intent-upgrade-v4-core.mjs:520` and add unfinished-workflow identity
and undelivered-outbox predicates from actual consumers. Review must verify the
exact schema29 enum set and that no automatic startup consumer has been omitted.
No whole-database equality, historical no-dispatch or source-content truth claim.
Completed historical work may remain; its contents need not be exposed or compared.

### Effects, bounds, outputs and invalidation

Propose one owned managed-cluster start, one SQL connection/transaction and one
owned normal cluster stop. Start/stop may write PID/WAL/checkpoint/log files;
PostgreSQL startup recovery/background maintenance can write storage even when
application queries are read-only. Protected database authentication is credential
use. Neither is covered by a field-inspection grant. Review cluster configuration
and startup hooks/extension behavior as a prerequisite; unknown executable startup
behavior blocks. Do not describe the whole operation as effect-free or a purely
read-only operational action.

Proposed caps for exact implementation review: start deadline 90s, SQL phase 30s
total with 2s statement/lock limits, stop deadline 90s, one attempt, at most one
connection. Abort SQL on timeout; retain unavailable outcomes. Only normal stop of
a cluster this run proved it started may be attempted once; no force/immediate
stop, kill, recovery, retry or cleanup. If start ownership or stop is uncertain,
preserve evidence and stop for a scoped follow-up; never try to manufacture a pass.
Bounds are proposed, not measured implementation behavior. Local compute/storage
effects are unmetered/unknown cost, not free; no metered provider call is admitted.

Receipt in one new exclusive evidence directory: candidate/manifest/SQL/inspector
hashes, coded identity/ownership/availability, query start/end, schema binding,
named counts, transaction read-only/rollback result, start/stop intent and outcomes,
producer-exclusion basis and any gaps. Do not emit config, connection strings,
secrets, server error text, data rows, other account names or command lines. No
password on a process command line or copied credential; no plan-vault read.

Validity is causal, not a timestamp grace period: the SQL snapshot describes its
transaction interval only. A clean result can support a later session only with
documented unbroken producer exclusion and unchanged candidate/config/cluster
identity through the separately approved launch. Bind CW-01 receipt into a fresh
PR-01 after owned stop and before that launch. Any unknown gap, launch attempt,
identity change, client/producer access or relevant mutation invalidates prospective
use. All-session producer exclusion remains necessary during native testing;
expected local auth/theme-draft bookkeeping does not authorize new work. Do not
claim locks survive rollback/stop or that PR-01 refreshes the SQL snapshot. If
exclusion cannot be maintained across stop/relaunch, defer rather than assign an
arbitrary TTL or rerun until counts happen to be zero.

## Alternatives and authority

Existing helper execution is rejected: broader backup/migration/credential effects
are unnecessary. UI inspection is too late for initial worker startup. Owner
recollection/process-only inspection cannot see queued database work. Exact-source
admission checks cannot establish current absence of work or current matching
authority. A changed candidate with effective startup admission may be necessary
if exclusion is impossible, but a worker-off toggle alone leaves initialization,
recovery/outbox and other producers; it is not selected as an automatic fallback.
Human-led evidence gathering and deferral remain valid outcomes.

| Work                                                                              | Present authority / missing prerequisite                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This repository-only design, static text/hash checks and tracking                 | Authorized and completed; no safety implementation or operational result claimed                                                                        |
| Existing items 1–6 field inspection                                               | Prior scoped authority retained; required adapter review and exact bindings still apply; no operational execution this session                          |
| CW-01 design review                                                               | Next eligible repository-only step; independent reviewer required before capability implementation                                                      |
| Reader/collector/CW-01 implementation                                             | Separate bounded milestone after supported design and implementable exact scope; not authorized automatically by this design                            |
| Cluster start/stop, protected database authentication, schema/count SQL           | New explicit exact capability/manifest grant required after implementation/review; not covered by items 1–6 or “continue” for this repository-only task |
| Native launch/sign-in/writes, workspace-ID alternative, provider/workflow actions | Still blocked; no session grant, no enabled identity alternative, no dispatch authority                                                                 |

No owner decision is requested to approve missing facts or an unsafe launch.
After design review, resolve concrete missing bindings/exclusion evidence and
present only the actual capability/scope decision. The reported top-left Quit
around 00:15 EDT and no-problems report remain owner evidence, not SH-01 or a
complete continuity timeline. Workspace name/role remain reported, exact ID unknown.

## Verification and next eligible prompt

Executed only repository reads/searches, direct SHA-256 comparisons, author-document
format/link/whitespace checks and input-preservation hashing. The evidence receipt
records exact inputs and limitations. No tests, historical verifiers, live OS/config
reads, service commands, SQL, secret access, launch/sign-in, helper/migration,
activation or retired-checkout access. Initial source searches included a missing
review-receipt path and nonexistent retrieval filename; corrected to the actual
package-review receipt and research-store. No result from those failed searches
supports a claim. No independent review of this design is claimed.

Next eligible prompt: independently review this exact repository-only design and
its receipt against the exact bundle, schema29, helper predicates, amendment v2
and proposal v4 plus v4.1–v4.4. Assess predicate completeness, protected access,
cluster ownership/startup effects, producer exclusion and stop/relaunch validity.
Support the conditional inspection path, require a bounded repair, or defer it;
do not turn unresolved exclusion into permission or require speculative controls
without identifying the concrete insufficiency. No implementation, operational
checks, tests/verifiers or native session. Preserve all prior evidence and inputs.
