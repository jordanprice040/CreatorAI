# Subscription-aware discovery dispatch — §2.19A first slice

October 20, 2026. Implemented in checkout; local contract/browser verified, not
installed or live-qualified for discovery. No provider/settings/grant activation.
Migration 27 is additive; operational studio has not been migrated by this work.

## Behavior

Submit offers ChatGPT plan vs API/fixture resource setup. Real workspaces default
to plan/public evidence; fixture workspaces retain API/fixture/synthetic defaults.
Subscription setup names a connection, verified model, accepted settings hash and
output-character bound, and requires no pricing snapshot or money envelope.
The form shows effective request, concurrency, time and output bounds, permission
scope and qualification blockers. Refresh run setup rereads current connection state.
The solution-budget field is labeled separately from run resources. Private provider
sharing remains an explicit choice and requires covering grants/connection settings.

The schema also accepts typed API resources and explicitly refuses local dispatch
until an Ollama adapter exists. Legacy request payloads remain valid without added
default fields, preserving frozen request hashes. Existing frozen study assignments
cannot silently switch to subscription discovery.

Required task classes are fixed by application code:

| Discovery role                | Required qualification |
| ----------------------------- | ---------------------- |
| Locator                       | research_synthesis     |
| Initial designer and revision | candidate_generation   |
| Skeptic                       | scoring                |

All three must be allowed and qualified for the selected connection/model. Access
verification or summarization qualification alone is insufficient. Specification
and code_build remain separately gated; this slice does not add their dispatch.
Current real connection settings/qualifications were not changed to make this pass.

## Admission and durability

The API's embedded worker and standalone worker use the same PlanConnectionService
bridge with protected vault configuration. They retain existing task leases,
coordinator, output/evidence validators, owner grants and run lifecycle. Admission
locks workflow/run/connection state, checks the live fencing token, pinned route and
settings hash, role, data class, connection/day/run/request bounds and total workflow
request count, then reserves one plan request atomically with action admission.
Subscription runs require one concurrent job and one provider attempt per logical
call. Known invalid outputs may create a separate bounded repair task under existing
workflow limits; uncertain outcomes never retry. There is no API-money fallback.
Request timeout is bounded by both connection/workflow caps and remaining wall time.
Plan responses use character limits; the legacy token-limit field is not represented
as an enforceable plan-token allowance.

Migration 27 allows nullable envelope/pricing only for subscription workflows, stores
immutable typed resource setup, and binds plan requests to workflow tasks with unique
logical/task IDs and a hash of exact rendered provider input. Completed workflow plan
responses are stored with their output hash for durable replay; ordinary direct-call
outputs remain hash-only. This adds bounded raw workflow output retention to the
existing studio database, subject to approved data use and studio backup/retention.
The data is not placed in credentials, logs or a generated product workspace.

Duplicate delivery reuses the recorded result or waits for its uncertain outcome;
changed input is refused. A crashed in-flight request remains held until an observed
result or explicit owner reconciliation; it is not assumed free or safe to resend.
Late recorded outputs can reconcile the existing task with source/output validation.
Cancellation/lost leases abort local requests; a cancellation during credential lookup
is checked again before provider dispatch. Post-dispatch cancellation conservatively
retains unknown outcome until reconciliation. Subscription usage appears separately
from API-money reservations in workflow details/UI.

## Verification and evidence

- TypeScript project build and web typecheck passed.
- Affected workflow/study/connection/API suites: 46/46 pass, no skips
  (`tracking/evidence/subscription-workflow/tests.tap`).
- Final focused admission/connection suite: 25/25 pass, no skips, including
  pre-dispatch cancellation and typed API coverage (`final-admission-tests.tap`).
- Seven isolated browser checks pass with all API traffic intercepted; no mutations,
  real studio data or provider calls. Script: scripts/verify-subscription-setup.playwright.js.
- Tests use disposable PostgreSQL and visibly synthetic outputs/fixture qualification
  rows. These prove integration and enforcement, not real model quality or entitlement.
- Early sandbox loopback tests failed EACCES; outside-sandbox attempt hit an unavailable
  old test listener. A fresh disposable cluster on 55580 then ran the checks. Early
  test setup used a stale connection version and lease mutation without incrementing
  its version; corrected without weakening production checks. Evidence records final
  results, not those setup failures as app defects.

## Remaining boundaries and next prompt

No native rebuild/install, real studio migration, live qualification/search call,
Agent Reach installation, settings expansion, paid fallback or pilot activation.
C54 is partial; it also requires simple draft intake/research and complete in-app
build/export/revision. Submit still needs a concrete brief and existing claims;
API/fixture setup still exposes its legacy envelope/pricing selectors. Local inference,
resource settings beyond these accepted connection caps and pilot gate reconciliation
remain planned. The pilot's manual-schedules/task-readiness gate mismatch is unchanged.

Next eligible: prepare a bounded, versioned qualification plan for the three discovery
role classes and current connection settings, with frozen synthetic cases, costs/quota,
held-out criteria and exact owner-required settings changes. Do not dispatch it or
expand allowed task classes without matching authority. Qualify native search and
implement theme-to-evidence collection separately afterward; do not promote current
summary evidence into discovery readiness.

October 20 follow-up: production-role qualification checks and a backup-tested native
migration candidate are now prepared in [the qualification review packet](DISCOVERY_QUALIFICATION_PLAN.md).
The workflow gate requires current production prompt/role evidence and designer
revision coverage. No live qualification, studio upgrade or installation occurred.

Latest execution supersedes preparation status above: [approved upgrade and stopped
qualification](DISCOVERY_QUALIFICATION_RESULT.md). Candidate installed, schema27 and
three permissions saved; one live development request failed its frozen evidence-
strength assertion. Discovery stays unqualified; no held-out attempts or retries.

October20 follow-up: [evidence-strength review and fresh-case v2 design](DISCOVERY_QUALIFICATION_RUBRIC_REVIEW.md)
completed offline. Original failure remains; next is production-bound rubric/manifest
preparation and controls, not automatic live dispatch.

October20 §2.19A follow-up: [rubric1.1 and executable v2 qualification packet](DISCOVERY_QUALIFICATION_V2.md)
prepared.18 frozen fresh cases/108 scorer controls;44 affected checks passed. Native
installer prepared, not installed. Source/prompt binding rejects historical v1
qualification for the revised candidate. Original failed result remains; no new
provider calls. Next eligible is exact v2 packet approval/execution, preserving
current caps/settings and all failed outcomes. C54 remains partial.

October20 §2.19A execution: [v2 installed / HTTP413 transport repair](DISCOVERY_V2_TRANSPORT_REPAIR.md).
Zero model calls or new qualifications: creation payload exceeded API64KiB cap.
Scoped128KiB qualification-ingress repair built and4 HTTP/API checks pass; current
installed v2 unchanged. Same frozen cases retained. Next is exact repair packet
approval/install/execution, not a benchmark retry or workflow/pilot launch.

October20 §2.19A latest: [repair installed / live v2 schema failure](DISCOVERY_V2_LIVE_RESULT.md).
Ingress fixed and real qualification started; first request failed type/array-length
constraints. Stop-on-first-failure honored, no retries/held-out cases. Next eligible
is full role output-contract/type/limit audit and a versioned prospective qualification
proposal. Preserve all outcomes/locks; discovery remains unqualified and C54 partial.

October20 §2.19A follow-up: [complete discovery output-contract audit/revision](DISCOVERY_OUTPUT_CONTRACT_AUDIT.md).
Role1.2 includes validator-derived schemas for all4 task kinds and explicit payload
serialization.52 local tests/189 boundary controls pass; no live calls or installation.
Next eligible is fresh v3 packet/manifest/control authoring and concrete candidate
preparation. Preserve all failed results and locks; discovery remains unqualified.

October20 §2.19A preparation: [fresh v3 frozen manifests and candidate](DISCOVERY_QUALIFICATION_V3.md)
complete.18 packets/144 scorer assertions,56 affected checks pass; actual HTTP sizes
within current limits. Installer/source/execution hashes prepared, no new live calls
or install. Next eligible exact packet approval/install/execution; preserve failed
history and require separate substantive review. C54 partial, discovery unqualified.
