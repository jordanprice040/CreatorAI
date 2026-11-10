# Creator Agent implementation prompt runbook

November 5, 2026. Use with the [consolidated implementation plan](CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), which maps all 19 revisions, dependencies, existing backlog and completion gates. These prompts implement Creator Agent itself. P16 adds the separate product feature that generates implementation runbooks for projects created by Creator Agent.

## How to use this runbook

Start with P00. For each task paste the shared contract and that task's prompt into a coding session attached to `C:\dev\creator_agent`. Select one task or explicitly authorize a named sequence. A prompt number is not evidence that its prerequisites passed. P11 planning and P14 inventory can start after P00; P16 can precede larger builds. For large tasks, complete the design/contracts and one useful slice first, record the remaining slices, and continue only within the selected scope. Do not quietly count a design-only result as implemented.

**November 10 update:** P00–P10, P14, P16 and the first P15 slice are merged, P11 is prepared. Jordan's November 10 notes added P18–P22 (see the plan's November 10 section). Remaining order: P18 and P21 (can run in parallel), P22 when Jordan gives the live OK, P19, P12 once the search provider is chosen, P13, P20, later P15 slices, P17.

Original recommended sequence: P00→P01→P02→P03→P04→P05→P06→P07→P08→P09→P10→P12→P13→P14/P15→P17, with P11 staged early and P16 after P05/P08/P09. P14 inventory should inform product claims early; its full qualification follows exact recipes. B01–B08 retain wider planned work and are selected separately. This is sequencing guidance, not an instruction to launch multiple agents.

When adopted, place this file and its companion under `docs/` and link them from `docs/COMPLETION_RUNBOOK.md`; add a short planning-only handoff entry. Do not rewrite the historical runbooks or replace the current next eligible review with feature work.

## Shared contract — paste before the selected prompt

```text
Work in the actual Creator Agent repository at C:\dev\creator_agent. Read AGENTS.md,
PROJECT_CONTEXT.md, tracking/BUILD_STATUS.md, tracking/SESSION_HANDOFF.md, the selected
task in this runbook and its implementation-plan entry. Inspect the actual working
tree, relevant accepted owner decisions/ADRs, callers, schemas, routes, UI and tests.
Preserve unrelated changes, operational studio data and frozen historical evidence.
Current recorded source is schema 41 with uncommitted repairs; verify actual state.

Implement only the selected task and necessary prerequisites. Reuse existing modules,
PostgreSQL workflows, grants, budget broker and isolation. Finish the real UI/API/store
path, error/empty/access states, migrations and affected callers. Verify current official
documentation when changing external SDK/provider behavior. Avoid a new dependency or
framework when existing code suffices. Do not restart completed T/X milestones.

Complete reversible implementation and local/fixture checks without repeated permission
requests. Honor matching existing scoped approvals. Do not activate uncovered live calls,
spending, installs/upgrades, publication, accounts, GitHub mutations or messages. Prepare
the concrete artifact/configuration and unblocked checks before identifying a genuinely
missing external decision. Personal plan credentials must not serve other users.

Keep application code in charge of authority, exact budgets, quotas, policy admission,
state transitions and stop conditions. Keep evidence/inference, system/human assessments,
and fixture/contract/native/live/activation states separate. Preserve human-only denials,
frozen study conditions, historical failures, held-out material and immutable provenance.
Use disposable test databases/product roots; never test on the installed app's data home.

Run meaningful changed-behavior checks and required project checks; visible skips remain
unverified. Record the exact candidate and checks actually executed. Update BUILD_STATUS,
SESSION_HANDOFF and, where relevant, DECISIONS/INTEGRATIONS and current status with scope,
evidence, limitations and next eligible prompt. End with what changed, what works, checks,
remaining blockers and the next prompt; do not start another milestone automatically.
```

## P00 — Reconcile candidate, review closure and backlog

```text
Apply the shared contract. Execute P00 as a read/review/reconciliation task, not a feature
implementation. Establish the actual Git root, HEAD, dirty files and current schema. The
planning session could read C:\dev\creator_agent but Git status reported “must be run in a
work tree”; diagnose without resetting, moving or deleting the repository/user changes.

Independently recheck ADR-0068 F1/F2 (#settlePlanRequest and its three regression tests)
against the current candidate using U02. If you authored those repairs, produce an exact
review packet for a separate reviewer and do not call self-review independent. Recover
original details for #77 L-1 and #128 N-6; retain #90 N-4 and #129 N-4, the later review notes,
and any unresolved overrun/preview-host limit. Do not guess lost review details.

Reconcile the November 1 audit and pilot F findings against later ADRs and actual code.
Produce a compact issue/status/source table: open, fixed with evidence, acceptance-only,
superseded or detail missing. Confirm what remains of C54/X10, the pilot and native
acceptance. Preserve recorded historical test results as historical. Gate: truthful
candidate/backlog, F1/F2 disposition or named independent-review dependency, and P01 scope.
No operational migration, provider call, installation or new feature.
```

## P01 — Activity links and working Search reset

```text
Apply the shared contract. Execute P01 (R01/R06). Inspect Activity, the right sidebar,
subjectTarget, route parsing/navigation, Search and PageDrafts. Activity already has some
subject links; extend the common destination resolver rather than duplicating routing.
Completed work must open its actual result/run/artifact/version and focus the right item
from either surface. Distinguish result links from the event-detail view. Explain missing,
deleted or unauthorized targets without exposing private titles or creating dead links.

Reproduce Search reset with a submitted route query and changed filters. The current global
reset remounts the component while its route query remains. Clear route and local query,
type/kind/status/sort state coherently. Define Reset to defaults versus clearing the search;
preserve unrelated drafts and saved records. Do not use Reset as a data refresh control.

Check keyboard use, back/forward, cross-workspace access, archived targets, an in-flight
search finishing after reset and reopening the page. Gate: both activity surfaces navigate
correctly and reset stays reset after navigation/reload, within the documented URL policy.
```

## P02 — Newest-first sorting, pagination and fresh lists

```text
Apply the shared contract. Execute P02 (R07 and retained list findings). Add visible Sort by
to Search and the catalog/current Library, default Newest; use created time for Newest and
explicitly label Updated separately if offered. Add Oldest and useful supported options
such as Name or Relevance where meaningful. Do not silently revert to relevance for search.

Apply sort on the server before limits, with stable tie-breaking and sort-bound cursors;
define mixed-result ordering/grouping. Inspect capped stores for oldest-first truncation
and current fixes before changing them. Preserve a user's explicit selection when new rows
arrive; a fresh picker can default to newest. Persist sort consistently within workspace.
Reload lists on return and during active work without dropping form drafts.

Check cap+1 records, equal timestamps, multiple pages, inserts between pages, workspace
changes, filtering/reset and permission-safe counts. Gate: newest items remain reachable
at declared scale and displayed order matches backend paging. Coordinate the new file
library's contract so P05 inherits the same behavior.
```

## P03 — Chat that follows general requests

```text
Apply the shared contract. Execute P03 (R02). Inspect classifier routing, stored chat answers,
context builder/settings and ADR-0057. Add a clear General / This project / Selected context
policy using the smallest compatible UI. A broad request must be answered broadly, with no
automatic studio snapshot bias; explicit user scope takes precedence over inferred intent.
Keep CA navigation/action cards useful for actual project requests, but do not swallow a
normal sentence as a command. Record and show which context was sent and why.

General chat must work in an empty workspace. Keep answers advisory, preserve history and
retry idempotency, respect privacy/caps and forbid human-only study assistance. Do not add
unrestricted research/tools as a shortcut. If fresh external facts are required, offer the
research path honestly. Test broad brainstorming, a writing task, general software advice,
CA help, explicit project comparison and hostile instructions inside record text.
Gate: broad outputs are not constrained to CA's saved projects; selected context is
accurate/removable and no model response directly executes an action.
```

## P04 — Defaults, guided start and readable pages

```text
Apply the shared contract. Execute P04 (R10–R12). Walk first-use and returning-user paths.
Build Guided/Advanced presentations over the same workflow, with a minimal start containing
goal or Explore, desired output and optional constraints. Resolve routine inputs from visible
effective defaults and project presets. Show missing qualified route/access as a clear setup
step; defaults never create evidence, permission, qualification or budget increases.

Use a few task-shaped pages, one useful next action and concise summaries, with technical
detail behind disclosure. Preserve existing destinations/deep links and accessible errors.
Unify blocked-action explanations across chat, project and build. Complete Try when its
actual feedback/completion condition is met. Retain meaningful run labels, selectable newest
defaults and draft protection; inspect whether earlier pilot fixes already implement these.

Check narrow/wide layouts, keyboard navigation and readable status/empty/error states.
Gate: a new user can reach a useful output through the real app without CLI assembly or
filling routine technical fields. Record remaining usability findings for P17.
```

## P05 — Real file uploads, library, viewers and downloads

```text
Apply the shared contract. Execute P05 (R19; owner decisions #11–#16). Design the file object
and original/version/derivative/link contracts, then implement the smallest complete file
path: upload→scoped storage→newest-first library→inert view→download/export. Preserve source
bytes/hash, origin, size/type, owner/workspace, extracted text locators and versions. Add
bounded validation, storage limits and cancellation/retry without duplicate logical uploads.

Provide global drag/drop destination overlay, transfer tray and picker fallback without
navigating or discarding drafts. Bind workspace at drop time; a targeted drop stores once
and links to its intended record. Validate filenames, path traversal, spoofed types and
unsafe active content; viewers cannot execute uploaded code/HTML. No provider sharing or
accepted claim follows from upload. Support initial documented text/Markdown/JSON/CSV/code,
image and PDF viewing where safely available; label unsupported formats honestly.

Verify access before bytes/snippets/counts, original download fidelity, duplicate names,
large/unsupported/malformed input, workspace switch mid-transfer, delete/retention and
backup/restore. Gate: a real file completes the entire app path and original bytes round
trip. Queue richer editors/OCR/conversions/Trash details explicitly in B01, without losing
the minimal deletion and storage-management behavior needed for this release.
```

## P06 — Multiple private notes with Markdown

```text
Apply the shared contract. Execute P06 (R04). Extend ADR-0060's private per-person/workspace
notepad to named notes with create/switch/rename/archive, Markdown edit/preview and export.
Migrate the current note into an initial note without losing text, versions or draft safety
copies. Reuse P05's safe viewer where appropriate; notes remain private unless deliberately
exported/shared. Disable raw active HTML/script and constrain links/images in Markdown.

Retain version-safe autosave and explicit conflict recovery. Key drafts by person, workspace
and note. Cover typing during a save, switching/closing mid-save, reload, storage unavailable,
simultaneous tabs, failed saves and sign-out/account switch. Distinguish current note draft
behavior from broader durable draft work in B02. Gate: multiple notes survive round trips
and Markdown is readable without executing content or leaking another person's note.
```

## P07 — Preview until closed or stopped

```text
Apply the shared contract. Execute P07 (R03). Inspect PreviewSchema, StartPreviewRequest,
store, supervisor, tickets and UI. Add explicit Timed versus Until closed/stopped lifetime,
with compatible persistence/migration and visible state. Do not represent indefinite mode
as a fake far-future expiry. Define last-viewer close, multiple viewers, heartbeat expiry,
reconnect grace, sleep, crash and studio restart. Browser unload alone cannot prove closure.

Separate access-ticket expiry from preview/session lifetime and per-run resource/deadline
limits. Stop/revoke terminates admission immediately and reaps relevant processes; unknown
cleanup remains visible. Ticket renewal must recheck authority. Preserve all execution,
network, concurrency and financial limits; generated web support still requires P15.

Test timed expiry, a manual preview staying available beyond the old TTL while connected,
Stop, crashed browser cleanup, reconnect, multi-tab ownership, access revocation and restart.
Gate: both modes behave as documented, resource cleanup is verified and access cannot outlive
authorization. Update native/browser guidance without claiming larger web support.
```

## P08 — System scoring with human edits

```text
Apply the shared contract. Execute P08 (R13). Reuse the existing scoring/selection contracts
and anchored rubric. Add qualified system-generated criterion ratings and evidence-linked
rationales, with model/route, prompt/rubric/evidence versions and uncertainty. Code computes
totals/ranking; unknown does not become an average score. Distinguish software-opportunity
assessment from cross-option solution suitability; software influence cannot exclude a
better non-software response.

Show system and current human assessment clearly. Human edits preserve the original and
record actor/time/reason; material upstream changes mark affected assessments stale. Keep
ties, dissent, ethical/access gates and rank sensitivity visible. This task does not silently
enable unattended selection. Check missing evidence, conflicting assessments, score edits,
updated evidence, deterministic tie handling and unauthorized mutation. Gate: ideas receive
explainable system scores which the user can revise without losing provenance.
```

## P09 — Why non-software, and a useful proposal artifact

```text
Apply the shared contract. Execute P09 (R08/R09). Explain why the selected response is an
existing tool, process, human-led, hybrid or software solution, referring to evidence and
constraints. When non-code wins, show software-assisted alternatives and the specific new
evidence/conditions that would make them preferable. Do not force or mislabel code merely
to satisfy a build goal. Resolve current software-only/hybrid humility behavior explicitly.

Implement a versioned non-code deliverable through the artifact/library path: background,
problem/users, objectives, cited evidence/contrary evidence, methods/step-by-step procedure,
materials/resources, roles, timeline, cost estimates/unknowns, testing/evaluation criteria,
ethics/risks, limitations, decision-changing assumptions, next tasks and references. Mark
unknown sections rather than inventing research results, approvals or stakeholder input.
Markdown is the initial canonical export; use only qualified richer conversions.

Review completeness, citation fidelity, feasibility and access against the exact artifact.
Gate: a non-code choice finishes with a usable downloadable proposal/process package and
feedback/revision support, while real-world execution and efficacy remain unverified.
```

## P10 — Approve routine steps for me

```text
Apply the shared contract. Execute P10 (R05). Design and implement a versioned project/run
policy UI over existing oversight: routine research/fetch, evidence admission, assessment,
selection, spec freeze, isolated build/review/repair and private package permissions, with
data/domain/output scope, money/quota/call/time limits and stop conditions. Explain one
up-front policy summary. Code admits actions from a matching policy; the model never acts
as the owner or manufactures approve-once records. Reuse existing covering grants.

Preserve immutable run/study conditions. An existing supervised run cannot become autonomous
by a settings toggle. Define safe new-run setup, material policy changes, revocation and
out-of-scope escalation. Distinguish policy-admitted claim evidence from model drafts and
human acceptance. New scope does not inherit publication/payment/account authority.

Check covered multi-stage work with zero redundant approvals, version changes, uncovered
actions, serious unresolved judgments, human-only denial, concurrent caps and cancel races.
Gate: routine authorized steps advance automatically with inspectable decisions; a missing
grant/qualification, unknown outcome or exhausted cap pauses honestly and preserves work.
```

## P11 — Committee staging preparation and deployment

```text
Apply the shared contract. Execute P11 (R14). The new committee-testing request gives hosted
staging a concrete purpose. Read X06/hosted/OIDC/worker code and accepted #44–#46. Produce a
small current official-source costed comparison suitable for this stateful API, PostgreSQL,
durable file storage and workers; choose no provider merely because a frontend deploy tool
exists. Prepare exact configuration, infrastructure/CI scripts, synthetic seed/reset data,
test accounts/roles, quotas, retention, diagnostics, backup/restore and shutdown procedure.

Do all unblocked local/staging-contract work before requesting unset provider/account/region/
IdP/model-access/cap decisions. Committee users cannot use Jordan's personal consumer plan
sessions. Use eligible own-user or explicitly authorized server routes; label sample/read-only
fallback honestly. Initial review may exclude builds. Full build testing needs a qualified
hosted isolated worker or explicitly paired authorized worker; no remote Windows-terminal
exposure. Keep personal operational data, commerce, campaigns and public signup out of scope.

After the exact deployment configuration and required authority are available, deploy the
reviewed candidate and verify HTTPS/OIDC, cross-account denial, persistence/restart, storage,
preview-host isolation, quotas, restore and external smoke/readiness. Produce URL, tester
instructions, supported/unsupported feature list and rollback/reset runbook. Do not send
invitations. Gate: verified private URL, or deploy-ready package plus precisely named missing
external inputs; never report the latter as a hosted app.
```

## P12 — Broad online Explore and evidence-gap research

```text
Apply the shared contract. Execute P12 (R15 and earlier evidence-gap searches). Extend the
existing broker and ADR-0065 workflow so Explore can begin with no theme or recorded claims.
Use broad public-interest/domain/cross-field seeds and optional user interests/exclusions;
existing projects inform deduplication, not the entire search horizon. Select/verify a runtime
search provider at its gate using current terms, price, coverage and eligible credentials.
Coding-tool web access is not automatically a Creator Agent runtime integration.

Implement bounded query→results→approved fetch→immutable passage→quoted claim draft→validation
and admission. Include gap-to-query follow-ups, provenance, source-age/quality, independent
corroboration, contradictory evidence, JS/low-text warnings, dedup and query privacy. Preserve
SSRF/redirect protection and defend against source instructions. Supervised users review
draft claims; only a matching P10 policy can enable deterministic unattended admission.

Check an empty workspace, diverse topics, exclusions, no useful sources, invented/mismatched
quotes, syndicated copies, provider failure, cancellation and aggregate exposure. Gate: online
Explore yields auditable supported problems or an honest empty/blocked result without manual
claim entry. Qualify the changed explorer role rather than silently inheriting old locator
evidence. Keep original frozen study paths reproducible.
```

## P13 — Complete bounded unattended project workflow

```text
Apply the shared contract. Execute P13 (R16). Compose existing durable workflows into one
campaign: evidence search/admission→problems→distinct responses→system suitability scores→
eligible selection→non-code proposal OR frozen software spec/task DAG→isolated build→
independent review/QA→private artifact/download. Use P10's up-front scope and optional P04
presets; let users tweak outputs/constraints before starting. Start with a qualified existing
software recipe, then integrate later recipes. No blind “highest number wins.”

Persist each stage's exact inputs/versions and idempotency keys. Propagate total budget,
quota/deadline/repair limits through children. Implement retry of one failed eligible step
and recovery without duplicating searches, builds or unknown provider effects. Reuse current
workflow/outbox/leases. Return explicit outcomes: software artifact, proposal, insufficient
evidence, no eligible option, needs authority, limit reached, failed or cancelled.

Verify software and non-code paths, empty research, tie/unknown ratings, invalid spec, QA
failure, crash/replay, quota exhaustion, revocation and cancellation with partial output.
Gate: supported runs finish privately without manual intermediate approvals, and blocked
runs say why. Schedules/commerce/publication are separate features, not implied here.
```

## P14 — Capability matrix and declared-scale qualification

```text
Apply the shared contract. Execute P14 (R17) first as an inventory, then as separately scoped
qualification runs. Read actual executor recipes/build/package/terminal/QA contracts and
dated evidence. Publish a matrix for Python CLI, interactive CLI, static/generated frontend,
API service, database-backed web, multi-module repository, data pipeline, native desktop,
mobile and other proposed families: implemented, fixture-tested, real-isolation-tested,
clean-export-started, live-role-qualified, unsupported, with precise prerequisites/limits.
Do not infer generated web support from studio-written preview pages.

Define small and larger representative tasks, acceptance checks, dependency/network/runtime
limits and held-out failures before runs. Measure startup/export, resource use, multi-file
changes, tests, reviews, repair/recovery and quality at declared scale. Larger means tested
requirements/integration complexity, not only line count. Do not invent a universal maximum.

Run local fixtures first; prepare exact real isolation/model-call qualification packets where
authority is missing. Gate: honest documented capability/support policy and evidence matrix,
plus a prioritized P15 recipe sequence. Mark unexecuted rows unverified.
```

## P15 — Expand software recipes and larger-project execution

```text
Apply the shared contract. Execute one named P15 recipe slice from the P14 matrix; begin with
generated frontend, then API/data-backed web, then larger multi-module checkpointed projects.
Do not attempt all product families in one change. Add frozen runtime/dependency/entrypoint
and acceptance contracts, isolated dependency acquisition/build/execution, independent review,
tests, resource/network policy, clean package/export startup and explicit platform limits.

Generated web previews use a separate cookie host and isolated worker, not arbitrary HTML/JS
on the studio's cookie host or on the Windows host. Service/data recipes need scoped ephemeral
data, port/network controls, persistence/export policy and cleanup. Larger jobs use bounded
task DAGs, versioned checkpoints, integration checks and targeted repairs with conserved
project budgets; they cannot remove limits to finish. Reuse current Git/artifact lineage.

Check hostile build scripts, dependency failure, startup/readiness, restart, process-tree
Stop, secret/network separation and independently extracted startup. Gate: exact recipe works
through real app and export, P14 matrix is updated from executed evidence, and unsupported
families remain explicit. Fold qualified recipes into P13 only after this gate.
```

## P16 — Export a project's implementation prompt runbook

```text
Apply the shared contract. Execute P16 (R18), the Creator Agent product feature. From a saved
selection/spec, export a self-contained package for a separate coding model: README, purpose,
constraints, accepted decisions, approved source/evidence excerpts, frozen requirements and
acceptance checks, supported stack/recipe, task DAG, ordered copy-and-paste prompts, validation
commands, failure/recovery instructions, assumptions and explicit remaining decisions.

Each prompt names prerequisites, scope, expected artifacts and a completion gate. Include a
shared project contract, setup, implementation slices, review/repair and export/verification.
Bind versions/hashes and distinguish proposed choices from owner decisions. Support honest
non-code action runbooks too. Remove credentials, private paths and context not authorized for
export; do not bundle private grader/held-out labels. Markdown plus a manifest/archive is
enough initially; do not depend on Creator Agent's database after export.

Validate schemas and links, then have a separately scoped implementation consume only one
synthetic exported bundle in a clean workspace. If independent execution is unavailable,
record the gap rather than claiming it. Gate: downloadable, readable standalone prompts
with reproducible acceptance criteria and no missing hidden CA-only context.
```

## P17 — Final UX, native/hosted acceptance and release packet

```text
Apply the shared contract. Execute P17 for a named release scope and exact candidate. Read
the current acceptance/runbook/pilot and completed P-task receipts. Walk novice/returning
journeys: setup, general chat, guided discovery, evidence/files, scoring/edit, non-code
proposal, covered unattended software build, preview/Stop, notes, source/download, external
runbook, failure/recovery and role boundaries. Exercise selected hosted capabilities from a
separate browser account. Repair reproducible defects, then repeat affected checks.

Reconcile C01–C54 and X10 evidence; do not mark hosted/live/research rows passed from fixtures.
Reconcile actual owner-pilot dates/interventions/outcomes without fabricating missing logs.
Prepare exact native artifact/backup/migration plan; rehearse on an authorized copy of a real
schema-40 database before any installed upgrade. Preserve theme-intent historical artifacts
and observational limits. Installation/release actions require matching existing authority.

Gate: independent exact-candidate review and meaningful executed acceptance, known limitations,
source/artifact hashes, migration/rollback evidence and next release decision. Provide a
committee user guide with supported features and test scenarios. Do not call the whole
product or thesis complete because the selected release passed.
```

## P18 — Collapsible options and shorter pages

```text
Apply the shared contract. Execute P18 (R20, part of R12) from the November 10 section of
the implementation plan. On Projects › Decide, Scores and specs, Proposals and Monitor ›
Approvals, show each option, criterion or policy as a one-line summary (title, status,
total, gates, what needs attention) that expands on click, with expand all / collapse all.
Open by default only the item that needs the person's attention. Keep open state while
the page stays open; do not change data, routes, gates or scoring. Use native
<details>/<summary> or buttons with aria-expanded; keyboard and screen-reader use must work.
A blocked action's reasons must never be hidden inside a closed item.
Check with a browser walk on a throwaway database: page height before and after, keyboard
toggling, an item with a blocker, and an empty list. Gate: Decide and Scores show the
collapsed list in about one screen and every detail is still one click away.
```

## P19 — Standard and Advanced across the app

```text
Apply the shared contract. Execute P19 (R21, rest of R10–R12) after P18. Extend ADR-0071's
Guided/Advanced idea app-wide: one Standard/Advanced choice per person (decide and record
whether it is stored server-side so it follows the person across devices). Standard folds
routine fields behind visible effective defaults on spec, scorecard, humility, evidence and
build forms, shows "What will happen" before each start, and hides rarely used pages
(Launch, Maintain, Study, Workers) from navigation without removing their routes. Add a
first-run path from an empty workspace to one useful output, with one next action per step.
Defaults and presets never add evidence, grants, qualifications, higher caps or a private
data class. Check a new-user walk in Standard from an empty workspace to a scored option and
a proposal or build request without Advanced or the CLI, plus Advanced parity (every field
still reachable). Gate: that walk passes and no server gate changed.
```

## P20 — Do the whole process from Chat

```text
Apply the shared contract. Execute P20 (R22) after P10 and P19; the full unattended branch
needs P13. Jordan approved this change on November 10; write an ADR amending ADR-0057/0070, which keep chat
advice only. Design: the chat model may propose the next step as an action card (start
discovery with this theme, accept these claims, decide, freeze spec, build, export runbook),
filled from the conversation. The card shows exactly what will be sent and is submitted
through the same server route as the form; the person's click is the approval, or a matching
P10 routine policy admits it. A model never acts as the owner, mints grants or raises caps.
Guided mode asks the questions the form would ask, one at a time, and says what it still needs.
Check: a full walk from an empty workspace to a decision and a proposal or build using only
Chat; refused, uncovered, study-run and human-only actions are refused with the same reasons
as the forms; a stale card (record changed) is refused. Gate: that walk passes on a throwaway
database and the audit trail shows who approved each step.
```

## P21 — Quick model switch beside the usage indicator

```text
Apply the shared contract. Execute P21 (R23). Add a model picker beside the usage indicator
that sets the person's current connection and model for the workspace. Chat, Discover,
Assess, Build and qualification forms default to it unless changed on the form. Offer only
verified models; when the chosen model is not qualified for a task, the form says so and
offers the qualified alternative instead of silently switching. A run that already started
keeps its recorded route. Decide where the choice is stored (a migration if server-side;
allocate the number from main). Check: one switch changes the default on every listed form;
an unqualified task is refused with a reason; a running run is unchanged. Gate: browser walk
plus tests for the default resolution and refusal.
```

## P22 — Live connection checks: API and GitHub

```text
Apply the shared contract. Execute P22 (R24, R25). Jordan approved the live API and GitHub tests
on November 10; stay inside the steps below. API: confirm whether Models and connections has a check for the
metered OpenAI API-key route; if not, add a "Test connection" that sends one smallest request
through the broker with a covering grant, a funded envelope and the owner's $20 runtime
ceiling. Run it once live, and run the existing check for each plan route; record date,
model, cost and result. GitHub: run the B04 scoped live trial on one new private
creator-agent- test repository (connect, create a branch, push, open a PR, read checks),
with no merge unless Jordan approves the exact head. Record both in INTEGRATIONS.md as live
evidence, including any failure. Gate: dated live records; no credential written to the repo
or logs.
```

## B01 — Extended file workflows

```text
Apply the shared contract. Select one B01 slice after P05/P06: bounded local OCR; inert
text/Markdown/code/JSON/CSV editing; one named conversion pair; 30-day Trash/permanent deletion;
or permission-safe related-files/provenance navigation. Preserve originals, source hashes,
versions and exact locators; show OCR uncertainty/conversion loss. No automatic cloud OCR or
provider sharing. Verify fidelity, malformed/large input, save conflicts, derivative/index
deletion, retention/backup limits and restore. Gate: documented format/operation matrix and
an executed round trip for this slice. Rich office/image editors and broad graph remain later.
```

## B02 — Durable drafts, setup recovery and everyday controls

```text
Apply the shared contract. Select one B02 slice: durable workspace/view/form recovery;
full studio Restore in first-run setup; command palette/remappable shortcuts; or in-app and
optional OS notifications. Read owner decisions #1/#17–#19 and later recovery clarifications.
Persist drafts across reload/restart and sign-out only under the retention policy, hidden
until the same owner has current access. Never restore credentials or another user's content.
Preserve failed submissions; expose deliberate discard/expiry and Start at Home. Studio
restore is not product-archive import. Check changed/revoked access and simultaneous sessions.
For shortcuts/notifications verify native/browser conflicts, privacy, dedup and destination
links. Gate: actual durable/access/lifecycle evidence for the named slice.
```

## B03 — Local models, routing and context efficiency

```text
Apply the shared contract. Select one B03 slice from X01/X02: hardware/Ollama inspection and
qualification; role-specific route qualification; permitted fallback; or measured context/
cache/compaction/batch optimization. Reuse adapters and accepted Economy/Quality/Local-only/
fixed-route settings. Prepare exact model/tag/license/size and a reviewable download only
when needed; do not download automatically. Inspect current specification-qualification
draft before treating it as run. Compare quality and full overhead at bounded task scales.
Maintain privacy, role/version qualification and known-cost admission. On quota exhaustion,
use an already authorized qualified route or pause; paid fallback stays off unless configured.
Gate: measured quality/cost/context retention, rollback and honest unverified route labels.
```

## B04 — GitHub verification and Windows distribution

```text
Apply the shared contract. Select one B04 slice: scoped live GitHub trial; native lifecycle/
worker checks; signed packaging/updater preparation; or previewable redacted diagnostics.
Reuse X04/X05 and owner #33–#43. Prepare an exact private creator-agent- test-repository plan
with account, immutable target IDs, branch/head/checks and caps before uncovered mutations.
PR preparation is not merge authority. No arbitrary universal three-repository cap.
For distribution, evaluate current signing eligibility/cost at the gate, preserve private
source unless chosen otherwise, verify update authenticity/rollback, and prepare the exact
candidate and destination. Check setup/restore/tray/Quit/startup-opt-in, native worker/offline
states and real upgrade backup/rehearsal. Automatic telemetry stays off. Gate: named-slice
evidence and reviewable release packet; public release/contacts/license decisions stay explicit.
```

## B05 — Commerce, reinvestment and marketing

```text
Apply the shared contract. Select one B05 slice using existing X07/X08 code: test-mode
payment qualification; entitlement/refund/dispute reconciliation; finance-policy design;
evidence-backed launch drafts; or a separately authorized message/campaign test. Do not
activate live commerce/reinvestment/campaigns by default. Pricing follows measured value and
support costs. Money conservation uses reconciled eligible earnings, reserves and holdbacks;
seed funds and duplicated payouts are not profit. Marketing claims need source/version
support, opt-in audience, suppression/unsubscribe and exact recipient/content/cap/date scope.
Gate: fixture/test outcomes and exact live-readiness gaps; no fabricated revenue or messages.
```

## B06 — Portfolio, schedules and reusable knowledge

```text
Apply the shared contract. Select one B06 slice from existing X09/X03: scheduler activation
readiness; maintenance/backlog prioritization; reusable components/prompts/skills; or improved
semantic/audit/relationship search. Preserve manual start until relevant restart/dedup/cancel
checks pass. Schedules conserve aggregate budgets and maintenance obligations before new
discovery. Reusable material retains provenance, independent checks, adoption versions and
rollback; retrieved/generated content cannot expand authority. Search is permission-safe
before snippets/counts and distinguishes similarity from provenance. Gate: exact-slice
checks including outage/replay, stale knowledge, access revocation and resource conservation.
```

## B07 — Historical theme-intent native acceptance

```text
Apply the shared contract. Execute only the current next eligible repository-bound task in
the theme-intent acceptance chain. Read the latest reconciliation/amendment/design reviews,
CW-01 K1–K3 and current handoff before selecting v5 helper/core, collector, PR-01/SH-01
inspection or attestation preparation. Preserve all frozen candidates/helpers/packages and
prior failed/unverified observations; M3 is settled. Do not regenerate old proof or claim
prelaunch continuity retrospectively. Reuse existing matching authority and identify only
actually uncovered operational actions. Gate: exact-version independent review/readiness
evidence for the selected task, with native/user acceptance still separate where unexecuted.
```

## B08 — Thesis governance, evaluation and final archive

```text
Apply the shared contract. Resume only the selected research task from RD1–RD10/T14–T19:
protocol/governance preparation, frozen collection, independent ratings, analysis, writing or
archive. Product functionality and committee app testing do not themselves adopt a study.
Keep RQ1 primary, RQ2 secondary and single-participant limits; actual RD5 determination,
reviewer identities/calibration, final independent tasks, source snapshots/model/caps and
protocol freeze remain required before applicable collection. $20 T15 counts within the
current overall owner ceiling. Preserve all failures, condition assignment, held-out labels,
human effort and one-infrastructure-retry rule; no hidden AI in human-only work.
Prepare all independent documentation/tooling before naming missing external inputs. Use
actual ratings/outcomes for T16 and thesis claims, never fixture rehearsal. Gate: exact
selected research output and honest missing-data limits; no invented IRB ruling, recruitment,
deadline, committee approval or empirical result. Confirm academic dates when scheduling.
```

## Pause, recovery and review prompts

Use these when a selected task needs continuity; they do not grant new scope.

```text
Resume selected task [ID] from tracking/SESSION_HANDOFF.md and its exact evidence. Inspect
the current candidate and changes since the receipt. Revalidate affected prerequisites only;
do not rerun paid/unknown effects. Complete remaining authorized work, preserve partial
results and report the precise blocker if external authority is still missing.
```

```text
Perform U02 independent review of task [ID] on candidate [identity/hashes]. Compare its
acceptance gate to actual UI/API/store/worker behavior, changed callers, migrations and
executed evidence. Check regressions, authority/privacy, recovery and version binding.
Use disposable data. Do not author repairs in the independent-review report. Return concrete
findings with reproduction, severity and exact candidate binding, then a pass/conditional/
blocked disposition. Self-review does not establish independent review.
```

```text
Repair the accepted review findings for task [ID] only. Reproduce each current defect,
fix the common cause and affected callers, run focused regression checks and required
checks, update evidence/status and provide the exact candidate for independent recheck.
Do not close an unrecovered historical finding by assumption or start the next feature.
```
