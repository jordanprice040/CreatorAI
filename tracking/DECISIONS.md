# Decision log

## ADR-0036 — X09 bounded portfolio policy and reviewed task knowledge

October 19, 2026. Jordan authorized X09 after X08 and reported Claude's parallel
UI/UX work. X08 was hash-checked and preserved as local commit `64596ef`; X09 is
on `codex/x09-portfolio` in the same managed checkout. No push or changes to the
original dirty X05 checkout. Claude's shared styling remains separate.

Keep PostgreSQL scheduling beside the existing durable workflows and brokers;
do not introduce another scheduler service, paid adapter or credential path.
Migration 22 stores versioned owner policy, immutable run lanes and schedules,
deduplicated job intents, health and knowledge provenance. Source refresh uses
the existing source policy/admission; reviews create existing bounded workflows;
health rehashes exact artifact bytes and claims archive integrity only.

Reserve real maintenance authority in an existing period child of the configured
global envelope. Existing journal/ancestor accounting remains authoritative.
Improvement and exploration retain separate run allocations; non-maintenance
calls cannot spend the maintenance subtree. A depleted/expired reserve, due or
unfinished maintenance, unresolved health, review backlog, capacity and explicit
normal/conserve/maintenance_only/paused modes constrain shared dispatch. Study
attempts retain their frozen conditions and do not inherit portfolio changes.

Coalesce outage intervals into one current job; never enumerate missed slots.
Use a workspace cooldown, per-pass cap, one open job per schedule and stable
effect/idempotency IDs. Unknown outcomes occupy capacity and require read-only
reconciliation, not redispatch. Missing durable effect receipts fence delayed
dispatchers. Cancellation marks the schedule and cancels its dedicated run;
already-dispatched observations remain recorded. Optional API polling is off by
default and was not activated. Policy budget identities are fixed in this version;
budget rotation into different identities requires a new workspace.

Use bounded task guidance and artifact/source locators for reusable components,
lessons, prompts and skills. This is not an executable skill installer or a
system-policy loader. Proposals cannot change permissions, credentials, finance
or evaluation holdouts. Require executed structural renderer regressions bound
to the exact content hash, then human review and explicit activation. Regression
evidence records what was checked, not empirical output-quality gains. Rollback
selects a still-reviewed version using expected-head concurrency. Revocation and
stale provenance fence future workflow dispatch without changing immutable task
history. Workflow knowledge bindings retain exact candidate versions/hashes.

Owner feedback uses existing Gallery records; portfolio backlog counts those
unresolved submissions and pending decisions. An explicit hash/identity-bound
owner health deferral preserves the failed report as `owner_deferred`, never as
a successful check. No profit threshold or fixed production quota is introduced.

See docs/X09_PORTFOLIO.md and tracking/evidence/x09. The new Portfolio screen
requires only an import/view case in main.tsx and a view tuple in ui.tsx;
shared CSS and existing component props remain unchanged for Claude integration.

## ADR-0035 — X08 immutable campaigns and local fixture delivery

October 19, 2026. Jordan authorized X08 and stated that Claude is working on
UI/UX. Codex uses a separate managed checkout from current main `0dfc6e6`, branch
`codex/x08-marketing`. Original X05 edits and Claude's redesign remain separate.

Use deterministic templates over registered current verified artifact manifests
instead of a marketing model/provider. Closed factual claims name recorded package
checks, commit, execution ID, input hash and manifest hash; retain limitations and
synthetic labels. This provides inspectable evidence without introducing new paid
inference or claiming validated utility/demand. Arbitrary capability claims,
testimonials and customer/traffic counts are outside the draft contract. Audience
provenance and hypotheses are explicit owner assertions. A new draft, with its own
grant, is required after content/audience/experiment changes.

Migration 21 stores immutable campaign content and observations, human-owner
grants, workspace suppression, pre-adapter intents and native local receipts.
Grants bind the complete request/content hash, expiry and delivery cap. Reserve
one slot before dispatch, with no refund after uncertain/failed attempts. Monetary
adapter exposure is exactly zero because only a transactional local fixture sink
exists; host compute is unmetered. No live channel, paid-ad adapter, credentials,
real address, outbound message or public unsubscribe endpoint is implemented.

One workspace lock serializes admission, suppression, revocation/cancellation,
caps and local acceptance. A spec lock prevents candidate revisions/registration
from racing evidence checks. Unique campaign/recipient identity prevents retries
from creating another delivery. Unknown outcomes are reconciled through immutable
native receipts without resend. A missing receipt is definitive only for this
transactional local sink, never for an external service. Terminal state fences a
delayed dispatcher. All commands retain audit/outbox events.

Record synthetic feedback against an acknowledged fixture delivery and frozen
metric, with stable deduplicated event identity. Counts are fixture observations,
not market validation. Stop rules are explanatory; actual bounds are caps,
expiry, exact audience, once-per-recipient admission and cancellation. There is
no automatic experiment loop. Real distribution needs a separately implemented,
verified and authorized adapter; hosting/payment prerequisites remain applicable.

New UI is isolated in `marketing.tsx`; shared changes are one import/case in
`main.tsx` and one view tuple in `ui.tsx`. No shared CSS or public component prop
changes. See docs/X08_MARKETING.md and tracking/evidence/x08.

## ADR-0034 — X06/X07 audit repairs and conserved processor identity

October 19, 2026. Owner authorized audit, repairs and strong scoped improvements.
Migration 20 permanently reserves each Stripe account identity and allows only one
processor funding rail per connection. This prevents economic double counting;
revoking a connection does not authorize re-registering its old financial history.
Existing duplicates block migration pending reconciliation, rather than rewriting
immutable records. Multiple fixture connections remain independent simulations.

Processor reads now run under the workspace financial lock and a connection row
lock, followed by atomic snapshot/projection writes. This supersedes ADR-0033's
outside-transaction read choice: that choice admitted stale observation ordering.
Bounded HTTP timeouts limit lock exposure; model/action authority is unchanged.
Account binding is checked against the current credential for each operation.
Incomplete loss histories are refused; bounded pagination is deferred. Failed rail
refresh invalidates availability instead of relying on an older balance TTL.

Hosted build exclusions, owned product storage, PostgreSQL 18 backup client,
service limits/log rotation and correct nested-budget metrics are preparation,
not hosted activation. See docs/X06_X07_AUDIT.md for reproduction and limitations.

## ADR-0033 - X07 payments, entitlements and reinvestment: backend reads, economic keys, tranche-bounded budgets (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X07 (prerequisites T17 and integration infrastructure; X05 and X06 not required). Branch claude/x07-5zm23m from main 4fe3d33. Migration 19 and this ADR number leave migration 18 and ADR-0032 to X06, built in parallel and merged first; this branch merged main afterwards and orders 18 before 19. X07 stays partial: no live or test-mode processor call, account or credential exists.
- Processor: Stripe chosen as the default test-mode adapter (reversible; the owner has not named a processor). Webhook scheme checked against docs.stripe.com on October 19, 2026: `Stripe-Signature` with `t` and `v1` values, HMAC-SHA256 over `t.raw-body`, 5-minute tolerance. Only `sk_test_`/`rk_test_` keys are accepted; live keys are refused before any call. No API version is pinned. Rejected: trusting webhook bodies, live mode, wider credentials.
- Payment connections, and therefore all payment data, exist only in fixture workspaces. Test-mode money is not money, so it never funds real budget envelopes. A real workspace needs live activation, which is a separate owner decision and is not built.
- Authority comes from backend reads only: a verified event names an object, the service reads it from the processor outside any transaction, and the store records that snapshot. An unreadable processor makes the delivery fail with 503 (retry) and records nothing as money. The checkout return page is inert.
- Ledger: immutable double entry separate from the budget journal, keyed by economic transaction (`connection:object:charge|settle|refund|dispute|payout:id`). Reconciling a snapshot brings each key to the processor's state with an original or a balanced correction entry; a deferred trigger rejects unbalanced entries. Event ids are de-duplicated as well, but economic keys are what stop double counting.
- Entitlements are derived from the snapshot (exact price, USD, offer metadata) and bound to one artifact manifest by id and hash. Refund or lost dispute revokes for good; an open dispute suspends.
- Reinvestment: one tranche per settled payment with the policy's basis points frozen at settlement and a holdback (30 days with no policy). Allocation capacity is the least of eligible tranches, surplus after operating costs and earlier reinvestment, usable liquidity of fresh available funding rails minus reserve, open commitments, unspent reinvested authority and outstanding losses, and the period cap. Allocations hold a per-workspace advisory lock, consume tranches oldest first (partial use keeps the remainder) and fund a new root envelope journalled as `fund`. Seed funding, pending funds, payouts and forecasts never count.
- Later losses lower a tranche's cap (never raise it). Consumption above the new cap becomes a reinvestment loss: idle reinvested envelopes are closed newest first and their remainder reopened as a smaller successor; otherwise new allocations are frozen until the loss is reclaimed or repaid from new eligible earnings. Rejected: editing envelope caps (they are immutable by design since T04).
- Rollback: revert the commit and drop the migration-19 tables. The only change to existing code is `BudgetStore.journal` becoming protected and the API's store class moving one level up the chain.

## ADR-0032 - X06 explicit hosted mode, environment-labelled databases and build-bound verification

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X06; branch claude/x06-j2pz5g from main 4fe3d33 (X05 merged). Migration 18 (X05 used 16 and 17; X07 takes 19). Prerequisites: T17 (backup/restore, health) and X05 (paired workers, for hosted-to-local pairing). Checked on local PostgreSQL with hosted processes on loopback behind a stand-in proxy; no hosted environment, DNS, certificate, managed database, identity provider or alert channel exists, and no live verification is recorded.
- Hosted is an explicit mode (`CREATOR_DEPLOYMENT_MODE=hosted`) with environments `test`, `staging` and `live`; local stays the default and unchanged. Hosted startup refuses: missing build commit, non-https or path-bearing public origins, a preview host equal to or a parent/child of the web or API host (cookie isolation), a relative product root, a missing metrics token, development login or insecure cookies, a web origin that differs from the OIDC web origin, no database, and a non-loopback database without `sslmode=verify-full`. Rejected: inferring hosted from a non-loopback host (an accidental exposure would silently change the security model).
- Secrets: generic `NAME_FILE` loading for `CREATOR_*`/`OPENAI_*` variables (Docker secrets/systemd credentials), both forms refused; values never enter the configuration hash, logs or status. Rejected: a secrets service client (no provider chosen; files work with every host).
- Environment separation is enforced by the data, not by naming: `deployment_identity` labels each database; API and worker claim an unlabelled one and refuse another environment's. Restores keep the label; relabelling a restored copy is audited and relabelling into live is refused.
- Verification is owner-recorded, append-only and bound to commit, configuration hash and schema: a smoke report (read-only checks of the declared public target) plus the server's own readiness. Any change makes it `stale`. A passing live record needs a typed confirmation of the exact build, also enforced by a database check. Readiness never reports live as verified otherwise. Rejected: self-declared verification via environment variables (not evidence).
- Observability is pull-only: `/api/ready` (public, terse), `/api/ops/status` and Prometheus `/api/ops/metrics` (owner session or read-only scrape token), `/api/ops/uncertain`. Alerts are local rule evaluation with delivery fixed to `none`; sending alerts anywhere is an outbound integration needing its own decision. Unreachable local workers are reported and never fail readiness.
- Backups now dump inside an exported snapshot and record counts plus lineage fingerprint and exact budget totals from that snapshot; restore requires exact equality (pre-X06 backups keep the at-least count rule).
- Cleanup removes only expired sign-in material past `config/operations/retention.json` (unreferenced sessions, OIDC states, pairing challenges), dry run by default, audited when applied. Records, audit history, budgets and artifacts are never cleaned.
- `deploy/hosted/` is reviewable configuration (Dockerfile, Compose per environment, Caddy with separate preview host, env examples without secrets); validated with `docker compose config` and `pnpm ops config-check` only, never built or run.
- Rollback: revert the commit; drop `deployment_verifications`, `deployment_identity` and their triggers. Earlier backups remain restorable.

## ADR-0031 - verified editor exports and explicit Windows activation

October 19, 2026: the native editor action initially launched no visible document,
confirmed by the owner. Direct AppData cache paths produced Notepad path errors;
the internal Windows cause is unconfirmed. Export only the last receipt-verified
manifest to a unique Downloads/Creator Agent source directory, verify those bytes
again, then activate fixed packaged Windows Notepad through
IApplicationActivationManager.ActivateApplication with a quoted UTF-16 path.
Pin the Windows API crate to 0.62.2. No arbitrary editor/program command, file
association fallback, source extraction or generated execution. Missing packaged
Notepad produces a visible failure. Export edits do not change the dated cache.
Ancestor reparse checks retain the existing owner-controlled filesystem
assumption; no protection against concurrent owner-privileged replacement claimed.
Final native screenshot showed the exact selected manifest; stale Notepad UIA
document text was not accepted as evidence. Rust tests verify cache preservation,
fresh copies and changed-source refusal. This supersedes prior pending editor
acceptance only for the observed local Windows host.

## ADR-0030 - explicit local NSIS packaging and manual rollback

October 19, 2026: pin Tauri CLI 2.12.3 and opt-in NSIS packaging for the existing
local-client shell. Current-user installation, existing WebView2, no hosted service
or worker installation. Refuse silent downgrades; explicit rollback is uninstall
and reinstall of a prior client, not rollback of authoritative data/schema.
Automatic updater/artifact signing remains disabled without configured keys and
release authority. Acceptance installs only a separately named/identified debug
fixture in a checked workspace directory, no shortcuts, and uninstalls it. Real
Windows WebView startup is observed after install/upgrade/rollback. Production
signing, rendered UI/editor and other supported-host claims require their own
acceptance. Default Cargo configuration keeps bundling disabled.

## ADR-0029 - scoped local paired execution

October 19, 2026: X05 reuses the reviewed execution supervisor. New explicit pairing
is required for artifact.run; owner jobs pin catalog manifest/archive and current
recipe/policy/bridge hashes. The local product root is owner configuration, never
job input. Admission is awaited after durable local intent and before dispatch.
One attempt per request; 10-second leases; 20-second/256 MiB/no-network limits;
one unresolved job per workspace, three globally, twenty hourly. Local compute
billing stays unknown. Expiry after start is reconciling, never queued again.
Reconciliation binds an independently observed stopped local outcome hash;
worker claims cannot verify QA. Presence pairing grants controls without execution.
Remote artifact synchronization, automatic retry, background installation, updater
activation and hosted pairing are outside this local implementation.

## ADR-0026 - X03 search, lineage and audit questions (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X03; branch claude/x03-s7po1x from main d2c8ef1. Migration 14. X03 is fixture-verified: no real embedding model is verified, so real workspaces refuse semantic search; no live call and no spend.
- Lexical search (T09) gains `code_version` (artifact commits and manifests), `model` (models called, exact totals) and `cost` (broker reservations with amounts), local-date filters read in an IANA zone, per-hit local time, and per-type coverage (searchable, redacted, no text, unsupported or oversized media) with activity freshness. The search transaction is read-only after the membership check. Rejected: a separate search engine (PostgreSQL full text over the same rows keeps one access path and no copy of redacted text).
- Natural-language audit questions compile into one plan from a closed list of intents with typed parameters; each intent has fixed, parameterized SQL in the application. The local rules compiler is free and deterministic; a model compiler is one metered broker call whose JSON must pass the same strict schema (any extra key such as `sql`, or an unknown intent, is refused before anything runs). Plans run in a read-only transaction with a 5 s statement timeout and limits of at most 200 rows. Rejected: text-to-SQL with a read-only role (model SQL could still read across workspaces or leak redacted history through joins; the prompt forbids executing model SQL).
- Permissions come before snippets and aggregation: every read checks membership first, so a removed member (new `removeMember`, audited `member.removed`, last owner kept) gets `NOT_FOUND` from search, saved queries, questions, semantic search, lineage and export verification. Saved queries store a request, not a permission, and run under the caller's current access.
- Semantic search embeds only candidates from an access-safe lexical stage (never redacted text), one `model.embed` broker call per text with a derived logical operation id, so a repeat replays without paying. Embedding models allowed per workspace mode are dated config (config/search/semantic-models.json); none is listed for real workspaces. Embeddings are not stored. Rejected: a persisted vector index (it would keep derived copies of text that redaction must then chase).
- Costs are summed once per reservation over a distinct set of runs (runs `part_of` a subject or its descendants, plus runs that froze specs for its builds), so a run shared by two products appears in each product's row but once in the combined total. Unknown charges are reported apart from incurred ones.
- Lineage graphs are bounded (depth 1-8, at most 500 nodes) with truncation flags; redacted records are tombstones; sources show whether their media was readable. Exports carry the SHA-256 of the canonical graph; verification reports tampering, missing records, version changes, redactions since export (and whether the export still holds the redacted title) and retracted links.
- Rollback: revert the commit and drop the migration-14 table, function and index; no existing table changes.

## Owner research decision - RD6 model preference and T15 budget

- Date: October 18, 2026. Jordan selected GPT-6 Astra and a $20 USD total live
  budget for T15. Includes child work, retries, tools and reviews; not per run.
- Actual accessible API identifier, pricing and budget enforcement must be
  verified/configured before dispatch. No model availability is asserted and no
  alternative model is authorized by this choice.
- Recorded in docs/PILOT_AND_PROTOCOL.md. Remaining protocol gates still apply;
  this documentation update did not freeze the protocol or activate live calls.

## ADR-0027 - X04 scoped GitHub management: verified owner, intent journal, exact-head merges (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X04 if it neither depends on nor conflicts with X03 (it does neither: prerequisites T13 and policy/broker coverage). Branch claude/x04-gm7n32 from main d2c8ef1. Migration 15 and this ADR number leave 14 and ADR-0026 to X03, built in parallel; whichever merges second renumbers if needed. X04 stays partial: no live GitHub call, credential or repository exists.
- Auth checked against docs.github.com on October 19, 2026 (REST API version 2026-03-10): per-endpoint permissions in docs/GITHUB.md. Two credential kinds, each a reference to an API-process environment variable: a GitHub App installation (recommended; tokens minted per call for one repository and that endpoint's permissions, one-hour expiry) and a fine-grained token with an owner-recorded expiry. Fine-grained tokens cannot call the Checks API, so their merge gate sees commit statuses only and refuses merges whose required checks are check runs. Rejected: classic tokens (all repositories), and any fallback to another credential or to an environment-chosen API host.
- A connection names the owner by immutable id and type; it activates only when the credential's account matches. Repositories are tracked by immutable GitHub id and owner id (names follow renames); another owner or public visibility quarantines a repository permanently. Existing repositories are outside scope unless listed by id; a listed repository that is public is quarantined, not used.
- Four action types (github.repo_create, github.write, github.workflow_change, github.merge), all external effects, admitted per operation with the operation's intent hash as spec_hash, so an approve-once covers exactly that change. Workflow-file pushes are their own action type. Rejected: entity records per operation (would need an entities kind change likely to collide with X03).
- Every mutation is journalled before the call (dispatched), settled once (succeeded, failed, unknown), and unknown outcomes are reconciled by reading GitHub, never by repeating the call; the same intent and any repository creation are refused while unknown. A database trigger enforces the state machine.
- Merges need the live head to equal the reviewed head, an approving review of that head by someone who did not push it, and every connection-required check succeeding on that head; the merge call carries the sha so GitHub refuses a moved head. No required checks means no merges.
- Webhooks are verified (X-Hub-Signature-256, constant-time), recorded, deduplicated by delivery id and only ever remove access. Live use needs CREATOR_GITHUB=live plus grants; fixture and live connections are confined to fixture and real workspaces.
- Store placement: GitHubStore sits between ArtifactStore and RoutingStore so the top of the store chain (which X03 extends) is unchanged.
- Rollback: revert the commit and drop the migration-15 tables; no existing table changes. The four new action types only appear in grants that name them.

## ADR-0025 - X02 context packs, result cache, compaction and batches (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X02; branch claude/x02-b3wzes from main c738369. Migration 13. X02 stays partial: every capability for a real model is `documented`, so only fixture workspaces exercise caching, batches and provider features.
- Context packs are immutable and hashed. The application derives the authority item from the run's active grants (it grants nothing); callers may pin only constraints, objections and acceptance criteria. Pins and the authority item render first so the provider-cacheable prefix is stable. Missing, removed or over-class pins, pins over budget, and required facts absent from the selection refuse the pack. Rejected: letting a model choose what to keep (survival must be checked by code).
- Every compaction (extractive, model, provider) passes the same check: each pin verbatim and every required fact present, or the result is recorded as rejected with what was lost. Model compaction is one broker call whose recorded request hash must equal the request the store rebuilds. Provider compaction is refused unless the capability is usable here, and as `output_unverifiable` when the provider's output is opaque (OpenAI documents an encrypted compaction item) while pins or facts must survive.
- Two caches, kept apart: provider prompt caching is measured only from provider (or fixture) usage records; the application's result cache stores the recorded answer of a settled, succeeded call of a metered read-only action. Keys include workspace, project, data class, action, tool, model, pricing hash, input and pack hashes, output limits and policy version. Entries record dependency hashes; a changed dependency invalidates for everyone, a caller's max age only for that caller; answers built on already-stale packs are not stored. Every hit re-runs admission under current grants and run state; study runs never read the cache. Rejected: caching any non-metered or mutating action (the contract has no such action type, so an external mutation cannot become a stored permission).
- Handoffs carry their pack's pins and required facts forward. The summary is reused only while its source entries are unchanged; facts that no longer hold refuse the next pack rather than disappearing.
- Capabilities are a versioned config per model and feature (`fixture`, `documented`, `verified`, `unsupported`, with source and evidence). Real workspaces use only `verified`, fixture workspaces only `fixture`. A batch capability names its own batch price snapshot (gpt-6-astra: 50% of Standard, from the official model page) and a batch must use exactly that price.
- Batches reserve every item before submission (all or nothing) and hold reservations for the completion window. Per-item request errors and documented expiry release; anything uncertain is `unknown`; a later result settles late exactly once. Batch status is derived from item reservations, not the provider status alone.
- Evaluations compare a baseline and candidate pack on questions with checks fixed at creation; total cost adds the compaction calls that produced the candidate. A quality drop beyond `max_regression` reports `not_claimed_quality_drop` before any cost claim; fixture results are `not_claimed_fixture`.
- Rollback: revert the commit and drop the migration-13 tables; no existing table changes.

## ADR-0024 - X01 model registry, route policies and held-out promotion gate (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X01; branch claude/x01-qfktko from main 8c09748. Migration 12. X01 stays partial: its prerequisite "measured task outcomes" does not exist yet, so every qualification is fixture evidence.
- The registry is a versioned config file (config/routing/model-registry*.json) registered per workspace; each entry stores the canonical hash of its pricing file, so a decision's pricing hash proves which price it used. Real registries hold only `documented`/`verified` models and fixture registries only fixture models. Only `verified` (accessible API id plus evidence) routes in a real workspace; gpt-6-astra is `documented`, so real routing is refused until verification is recorded as a new registry version. Rejected: probing the provider for availability at decision time (a live call nobody authorized).
- Policies: fixed (never substituted), auto (best held-out accepted rate, then cost), economy (lowest cost per accepted result at or above a floor, otherwise the reference baseline), each versioned per workspace or project. The owner's reference model is always the baseline and the only model qualified without a promotion.
- Promotion is the only path to qualification: criteria are fixed and hashed at creation; the store scores held-out benchmark cases from the broker's own reservations (callers cannot submit results); then shadow (never served), a deterministic capped canary (at most 1/4), and owner advancement that cannot override a failing gate. Canary or post-promotion outcomes below the floor roll back automatically; owners can roll back any active promotion. Rejected: model self-confidence or self-reported success as a gate (the outcome contract has no confidence field).
- Cost per accepted result includes failed attempts, review, repair and tool operations named on the outcome (same run only), divided by accepted results; unknown exposure is reported separately. Savings are `measured` only in a real workspace with fully known costs; fixture evidence is `not_claimed_fixture`.
- Escalation requires a recorded objective failure, happens once per decision, and goes to the reference baseline; if the baseline failed it is refused for a person to decide.
- Routing is opt-in per call (decide, then call under the decision). Existing workflow, study and builder paths keep their frozen models, so T15 study configuration is unaffected.
- Rollback: revert the commit and drop the migration-12 tables; no existing table changes.

## ADR-0023 - T16 analysis pipeline over T15 exports, verified on synthetic fixtures only

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to build T16 with empirical data collection deferred; branch claude/t16-analysis-95avhe from main 479dba4. No migration. Empirical T16 stays blocked.
- Inputs are only the files a T15 run writes (evaluation-package.json, private/assignment-key.json, private/raw-exports) plus reviewers' ratings.csv and an optional analysis-options.json. The analysis is pure (domain) and needs no database, so it reproduces from exports; each input file's SHA-256 is recorded and two runs must hash identically. Rejected: reading the database directly (results would depend on live state rather than the frozen package).
- Empirical status is derived, never asserted: `final_records` only for a final package under an adopted freeze with non-synthetic exports and no FIXTURE.json. Fixture outputs carry the label in every CSV row, figure banner and report.
- `ANALYSIS_PLAN` is an implementation default (task as unit; last attempt per slot for outcomes, every attempt for resources; complete reviewer rows only, no imputation; discovery repeats averaged within theme; range/median/sign counts always, bootstrap over tasks only with 10 or more pairs; quadratic-weighted kappa for two reviewers). It is not an owner decision and should be adopted or replaced in the freeze.
- No decision acceptance rule exists, so cost per accepted decision outcome stays undefined until Jordan supplies one (`decision_min_mean_rating` with its basis). Implementation acceptance is submitted with every executed frozen case passed. Zero accepted means undefined cost per accepted outcome with total spend shown; unknown or in-flight billing marks it a lower bound.
- Reconciliation checks fail the run when an attempt appears in two slots or exports, when flow and export measurements disagree, or when group, flow and export spend totals differ. Privacy check fails when a participant code, actor id, familiarity note or the blinding secret appears in output. Not measured: potential benefit, observed user impact, intervention necessity coding.
- Rollback: revert the commit; nothing persistent changes.

## ADR-0022 - T15 prerequisites: final-record gate, study budget ledger and builder-backed study attempts

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to complete T15's prerequisites without running the study or freezing the protocol; branch claude/t15-hdrwqz on top of ADR-0021. Migration 11. T15 stays partial.
- Owner choices recorded, not decided here: `config/evaluation.json` keeps the owner's `gpt-6-astra` preference (verified id null, live dispatch off) and Jordan's $20.00 total T15 cap (stated October 18, 2026; no spend authorized). Participants (RD3), reviewers (RD4), human-subjects review (RD5) and final tasks (RD8) are `unresolved`. RD6 must still be answered in the freeze; the gate requires the study cap to equal the $20 config cap.
- Final records: `synthetic` is now a boolean. `synthetic: false` passes only `finalRecordBlockers` (domain): real workspace, adopted freeze hash, every governance choice equal to the owner's freeze answer, preserved model preference with a verified id equal to the config and study model, $20 ledger cap. Final attempts get real-mode workspaces and no model grant; AI execution and builds refuse with `LIVE_DISABLED`. Rejected: accepting governance values from the request alone (would let a caller choose decisions the owner never answered).
- Budget: `study_budget_holds` holds each attempt's full frozen cap under an advisory lock before any model work. Open attempts count at cap; finished ones at settled plus in-flight/unknown reservations. Final records share one `t15-final` ledger; synthetic ones are per workspace, so fixture units never consume the real cap.
- Builder link: studies bind a frozen build task by exact spec, freeze, task hash and current humility review (re-read at creation and assignment). Each attempt pins a same-hash copy of the spec and a review rebound to it (`study_attempt_pins`), so admission, grants and products stay in the attempt's own workspace. A/B arms build with the unchanged T12 BuildSupervisor through `studyBuildPorts`; the broker admits only builder/reviewer calls under the prepared plan's envelope and caps. The API records results only from its own re-read of the local build record (`readStudyBuild`), one build per attempt. C arms have no builder; their code is checked server-side against every frozen case. Held-out cases leave the server only as key and pass/fail.
- Evidence states: every case result names its backend; only the reviewed WSL2 backend sets `isolation_evidence`. The cloud tests use the labelled test double.
- Rollback: revert the commit; migration 11 is additive (three objects).

## ADR-0021 - T15 frozen schedule, deterministic admission, run ledger and blinded packets

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T15 request; branch claude/t15-hdrwqz from main 3f3544a. No migration. The protocol is not frozen, so no final run exists.
- Schedule: built only from a freeze manifest (rebuilt from the `study.protocol_frozen` audit event against the proposal in code; a changed proposal is a VERSION_CONFLICT) and the owner's final tasks in the frozen counts. Slot ids hash the freeze, packet and arm; the order (one run at a time) comes from a seed derived from the freeze hash. The planned schedule hash goes to the audit log (`evaluation.schedule_planned`).
- Admission is domain code: final slots need non-synthetic study records, verified live AI (RD6) and, for AI implementation work, the isolated builder. None exists, so today every final slot is `blocked` with its reasons. Fixture output and scripted people are admitted only in rehearsal mode. Rejected: building non-synthetic study records now, because their shape depends on RD3, RD5, RD6 and RD9.
- Ledger: every slot is listed once (blocked, deferred, missing, or attempt states); a blocked slot with an attempt is an error; RD10's single infrastructure retry keeps the failed attempt.
- Reviewer packets: identical template, per-reviewer order, codes from a per-package secret kept in the private key. A scan fails on filename, template or id leaks and flags condition-like words inside submissions for owner review instead of rewriting them. Implementation outcomes are functional checks, not reviewer items. Packets are written to disk only.
- Rehearsal: `pnpm evaluate rehearsal` runs the frozen counts on 8 synthetic tasks with a labelled stand-in freeze; 10/10 checks pass.
- Rollback: revert the commit.

## ADR-0020 - T17 local backup/restore, overrun propagation and boundary audit

- Date: October 18, 2026. Status: implemented by Claude Code for T17 (branch claude/project-thread-k4si82 from main e46b2cf). Follows ADR-0019 (T14, built in parallel). No migration.
- Backup: `pnpm backup create|restore|verify` (packages/db/src/backup.ts) pairs a `pg_dump --format=custom` archive with a byte copy of the product store under one SHA-256 manifest. Restore re-hashes everything first, needs an empty database and products folder and the same schema version, then verifies the audit chain and every artifact's manifest and package hash. Alternatives rejected: a JSON export through the API (would have to re-implement immutable tables, identity columns and the hash chain); a database-only backup (artifact rows would point at missing bytes). Not covered: schedules, retention, encryption, hosted operation (C43/X06).
- Budget overrun: when actual charges pass a child's cap, the excess now counts against every ancestor. New reservations anywhere under an ancestor whose rollup passed its cap are denied (`ancestor_overrun`) and new carve-outs under it fail. Computed from current rows at admission; a settle that overruns concurrently with another admission is not serialized against it (overrun already means the provider exceeded the exposure bound, so this guard stops further spending rather than restoring an exact cap).
- Heartbeat: `WorkflowStore.heartbeat` referenced an ambiguous `version` column, so every lease extension failed and the worker ignored the error; a task whose call outlasted one lease was redelivered and parked in reconciling. Fixed to `t.version`; covered by a test that holds a call for three lease lengths.
- Health: `/api/health` derives `data_mode`, `live_enabled` and a `live` block from the configured adapters; `live_configured` means configured, not verified.
- Preview origin (audit item 6, recorded rather than changed): browsers do not scope cookies by port, so the management session cookie is also sent to the preview port. Accepted because previews render only `textContent`, the cookie is HttpOnly, the preview server ignores it and the API rejects the preview origin. Serving generated web content on the preview origin requires a distinct host name first.
- Rollback: revert the commit. Restored databases are ordinary databases.

## ADR-0019 - T14 pilot rehearsal, proposal freeze gate and open research decisions

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T14 request; branch claude/project-thread-ocgg8g from main e46b2cf. No live provider, participant, reviewer or adopted protocol.
- Pilot: `pnpm pilot <dir>` runs one fictional decision task through arms A, B and C and one structured/open-ended pair through the existing T10 store, broker and worker in a new fixture workspace. AI arms use the fixture adapter (live dispatch disabled); B and C human entries are scripted and labelled `scripted_rehearsal`. Pilot tasks are listed as excluded from final tasks. Rejected: skipping the human arms entirely, which would leave their instrumentation unchecked.
- Checks and classification are deterministic domain code (packages/domain/src/pilot.ts) over the real exports and contexts: metrics, intervention timing, source validation, contamination, reviewer blinding and export repeatability; each attempt is classed instrumentation or substantive and kept. A `reproducible_digest` excludes ids and timestamps.
- Findings carried into the proposal: structured runs end `insufficient_evidence` on unverified packet snapshots (RD9), and workflow-finished assisted attempts leave human totals empty, so analysis sums intervention rows. Not changed in code: the first is correct behaviour; the second is an analysis rule.
- Freeze: the API freezes only the server's `PROPOSED_PROTOCOL`, for the signed-in human workspace owner, when every one of 10 blocking decisions has a non-deferred answer recorded against the exact proposal hash. The manifest goes to the hash-chained audit log; no migration (avoids colliding with parallel T17 work). Rejected: a file-only freeze, which any process could write without an owner session.
- Rollback: revert the commit; no schema change.

## ADR-0018 - Audit fixes: frozen and held-out QA cases, case-insensitive study ids, database CI

- Date: October 18, 2026. Status: implemented by Claude Code after Jordan's codebase audit (report: /mnt/project-files/audits/2026-10-18-codebase-audit.md) and his request to fix findings 1-3. Branch claude/project-thread-mccbs5 from main c162376.
- QA cases: spec acceptance checks gain optional `cases` (args, stdin, stdout, exit_code, held_out). They sit inside the T08 task hash, so a freeze fixes them. T12 requires every assigned automated check to carry cases, the plan's `cases` to equal them exactly (spec order, no held_out), and at least one held-out case per task. Held-out inputs/outputs are removed from builder and reviewer packets and from repair feedback (only the check key and pass/fail remain). Existing specs without cases stay valid but cannot be built. Supersedes the per-build plan cases in ADR-0016. Alternative rejected: keeping plan cases and only recording plan_hash; that detects but does not prevent a weaker case set.
- Study ids: assignment stores participant and continuation ids in lowercase; grader grants normalize the actor id and compare lower(); attempt access compares lowercase. A mixed-case assignment previously let a participant become a grader and read hidden material.
- CI: a second job runs `pnpm test:db` against a postgres:16 service with throwaway credentials. WSL2 isolation tests still skip there and remain a manual Windows gate.
- Rollback: revert the commit. No migration; stored rows are unaffected (existing assignments were already lowercase in all recorded runs).

## ADR-0017 - T13 immutable manifests, separate preview origin and feedback revisions

- Date: October 18, 2026. Status: implemented within Jordan's explicit T13 request by Claude Code; owner review and the real WSL2 gate pending. Branch claude/t13-8h288j from main 6fe5bab (T12 merged as PR #14). No T14, live provider, real spend or public release.
- Package only a current T12 verified_candidate. Archive committed blobs as a deterministic ustar (sorted, 0644, mtime 0), written once. Re-read and strictly re-extract it, then re-run every owner acceptance case through the existing T11 worker from those bytes. A package case passes only with exact stdout/exit and an input hash equal to the build QA input hash. The immutable manifest.json binds exact repository, spec/freeze/task, template, toolchain, dependency (stdlib only, no lockfile), archive/file hashes, startup, tests, settled cost, lineage and limitations. Failed re-runs keep the archive but no demo; missing worker gives blocked, never a host run.
- Bytes stay in the local product store (T11 boundary); migration 10 adds an immutable PostgreSQL manifest index with an 'artifact' entity linked to the spec, plus mutable preview leases and feedback rows. Registration re-hashes from disk and refuses stale spec versions/hashes, mismatched freeze/task hashes, unknown lineage and, in real workspaces, non-reviewed backends. Downloads and preview starts name the expected manifest hash and re-hash manifest and archive at that moment.
- Preview: a studio-owned HTTP origin on its own port (default 4320). One-time ticket exchanged for an HttpOnly SameSite=Strict path-scoped cookie; strict CSP, no framing/referrer; Origin-checked JSON run requests; each run rechecks owner, state, expiry, run cap and manifest hash before the worker starts the exact archive. Two live previews per workspace, TTL 1-60 min, 1-20 runs. Same host, different port is not cookie isolation, so the origin serves only studio-authored pages and never generated HTML/JS; generated web previews need a separate host and a reviewed web recipe (not implemented). The runnable demo is a CLI runner because T12 supports only the Python CLI recipe. Native installer is always unavailable.
- Feedback binds to one manifest hash. Accept/decline is owner-versioned. Revision reuses the T08 spec revision path in the same transaction and marks the feedback revised; a revision product repo starts from the verified package bytes with recorded base lineage; the new package records previous artifact and feedback ids. Comparison reports spec versions, changed task hashes, per-case package results, file changes, cost and feedback. Old artifacts are never removed.
- Test double (tests/src/artifact-double.ts) executes nothing, labels its backend test-double, adds a "not isolation evidence" limitation, shows notices in gallery and preview page, and is refused by real workspaces. It is used only by tests and the browser harness so packaging, leases, UI and feedback bookkeeping can be checked where WSL2 is absent. It is not evidence for the acceptance gate's isolation part.
- HTTP mapping: management API adds LIMIT_EXCEEDED 429 and keeps existing EVIDENCE_MISMATCH 400 / EXPIRED 409 to avoid changing earlier contracts; the preview origin uses its own map (ACCESS_DENIED 403, EXPIRED 410, LIMIT_EXCEEDED 429, EVIDENCE_MISMATCH 409).
- Alternatives: storing archives in PostgreSQL duplicates the local product boundary; serving packages through the management origin mixes product and studio trust; trusting build QA without a re-extracted run would not prove the delivered bytes start; a host-run fallback violates isolation. Rejected.
- Rollback: stop the preview listener and remove the T13 routes/CLI commands; leave migration 10 tables, product stores, manifests and archives intact (they are append-only evidence). Earlier T00-T12 behavior is unchanged apart from the shared reviseSpec helper refactor, covered by the existing selection tests.

## ADR-0016 - T12 finite local builder and task-candidate gate

- Date: October 18, 2026. Status: implemented within the owner's explicit T12 request; review pending. Built on local T11 commit 2c14f9a without merging or staging the owner's Docker follow-up. This new request does not imply that T11 owner review/merge occurred.
- Reuse the existing broker and T11 scoped Git/WSL worker. The owner CLI supplies authenticated current frozen spec/task bindings, run checks, exact-spec humility review and product.commit_build admission. No new SDK, service, model identifier, external authority, migration or live grant. Add only the existing domain workspace dependency for frozen task hashes.
- Bound one independent Python task with immutable spec/prompt/plan hashes, at most six broker calls, one attempt per call, two repairs, finite deadline/output/context and ten clean-sandbox cases. Tools are structured scoped CAS submissions. Fresh review sees candidate files/diff and frozen task context without builder claims. Supervisor-executed exact stdout/exit assertions, clean approve/no-findings review and current commit/spec jointly determine task-specific verified_candidate. Model summaries cannot supply test evidence.
- Extend the trusted recipe with typed argv/stdin from a supervisor-owned read-only acceptance file outside generated files. T11 isolation/cleanup remain enforced. Browser/manual/metric checks, persisted-state scenarios and dependency integration require another reviewed recipe; fail explicitly. A task gate does not certify a merge or whole product.
- Alternatives: unrestricted shells/generated tests let the builder control its evidence; rejected. Replacing WSL or adding a scheduler duplicates infrastructure; previews belong to T13. Fixed Python fixture roles exercise this gate without model reasoning or empirical validation. Fresh role context does not remove correlated model errors.
- Local immutable build records bind command/execution identity and broker reservation IDs. They inherit T11's owner-controlled filesystem boundary and are not catalog-indexed. Unknown/late paid outcomes stay in the broker. Crashes preserve intents/locks for inspection without automatic replay or destructive repair. Existing explicit owner integration commands do not promote a catalog product automatically.
- Full-suite checks exposed two prior timing/teardown races: hold the duplicate fixture response until all three duplicate deliveries return (same assertions), and close the budget API worker before dropping its DB. Another parallel-file run observed a T11 worker uncertainty fence during its cancellation test. Serialize test files to avoid competing real WSL resource/lease probes; within-test concurrency checks remain intact. Failed logs are retained. No production admission, budget or isolation gate was weakened.
- Verification source/results are in tracking/evidence/t12; usage is in docs/BOUNDED_BUILDER.md. Rollback removes optional T12 runner/fixture/acceptance input while preserving product repositories, failed commits, build evidence and broker ledger. No database migration is needed. No public release, participant activation, live model or real spend occurred.

## ADR-0015 - Optional Docker PostgreSQL; retain reviewed WSL execution

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's request to check newly installed Docker and implement it where suitable. No next milestone authorized.
- Docker Desktop now connects through its Linux engine. Add optional Compose PostgreSQL development/test services using the official 18.6 Bookworm image pinned by registry digest. Separate named volumes and localhost ports 55433/55434 avoid the existing native cluster and distinguish test data. No existing records imported or silently selected.
- Alternative: continue native PostgreSQL (still supported); Docker makes local database setup reproducible. Replacing the verified WSL2/Bubblewrap generated-code worker would duplicate working isolation and require full backend lifecycle/resource/recovery verification. Keep that worker and the host API/CLI/web development workflow. Neither a broader container deployment nor a Docker MCP configuration change is needed for this scope.
- Password required, generated into ignored .env.docker; no tracked credentials. Application URLs remain explicit per-terminal choices. Official image initializes a local development superuser; production role separation is outside this local setup. CPU/memory/PIDs/logs bounded, persistent database disk not quota bounded, no automatic restart, no personal-directory or daemon-socket mounts. No live model/provider activation or paid dispatch. Local compute costs remain unmetered.
- Executed: actual CLI/daemon and Compose connection; official image pull; Compose validation and healthy startup; nine migrations; persistence through restart; inspected localhost bindings and resource limits; authenticated Windows TCP read and wrong-password SQLSTATE 28P01; full Docker-backed database + real WSL gate 140/140, no skips. See tracking/evidence/docker and docs/DOCKER.md. A stale process PATH required a process-local Docker bin prepend for the CLI credential helper. No Docker MCP tool appeared in this chat; a selector connection alone is not tool verification.
- Configuration follows official Docker Compose service/networking and docker-library PostgreSQL documentation checked October 18, 2026 (links in docs/DOCKER.md). PostgreSQL 18 volume target is /var/lib/postgresql. Affects local persistence/verification infrastructure; application contracts, migrations, executor policy, research prompts and frozen protocols unchanged.
- Rollback: stop/remove this Compose project's containers while preserving volumes and .env.docker; return to the existing native PostgreSQL URL. Do not use down -v or rotate the password file as an automatic repair. Prior ADR-0014 remains applicable to generated-code execution; its historical absence-of-Docker observation is superseded only by this installation check.

## ADR-0014 - T11 local product Git and WSL2 namespace worker

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's T11 request; owner review pending. Base 5f9bb1bf71673b4c5aa27f418cbb2c842948266b is T10 merged PR #12. Branch codex/t11-isolated-execution. No next milestone authorized.
- Use the existing Windows Git/Node management host, WSL2 Ubuntu, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4 for one reviewed dependency-free checklist template. Windows had no Docker/Podman runtime; actual non-root namespace and resource-control probes passed. No installation, Docker socket, paid service or host fallback was introduced. The existing WSL2 VM supplements user/mount/PID/network namespaces; this is not a newly dedicated VM appliance and is scoped to the reviewed template. Broader hostile workload hardening remains T17.
- New @creator/executor provides strict local management contracts, canonical path/file scopes, separate repos, exact task bases, typed CAS changes, immutable intents/outcomes, one integration owner and exclusive file locks. Conflicting merges remain in a separate review worktree; integration and task checkouts survive. No destructive resets/clean, shell command inputs, generated hooks or wider-credential fallback.
- The owner CLI consumes the actual authenticated T08 frozen spec and rechecks its active version, hashes and owner role before mutation/dispatch. Local provenance binds workspace/spec/freeze/task identities and Git commits. Keep these local files distinct from PostgreSQL audit/catalog records; T11 needs no schema migration and does not claim searchable product/task catalog records. T12's runtime can consume these local interfaces; it must enforce its own run/action admission and exact-candidate independent QA. This owner-facing CLI cannot be exposed directly as a model tool or remote HTTP command runner.
- The reviewed trusted bridge uses cleared environment and fixed absolute commands. Generated code sees read-only runtime/input/recipe, a read-only root/proc/dev, bounded disposable work/tmp, no home/Windows mounts/studio credentials/Git metadata/D-Bus/daemon, no network, UID/GID 1000, no capabilities or new privileges. Fixed cgroup limits: 256 MiB/no swap, 32 tasks, half one CPU and 20 s. Work/tmp limits are 16/1 MiB, per-file 8 MiB, captured output 64 KiB. Exact policy, recipe, bridge, input, binary hashes and observed controls are recorded. A successful conventional recipe is not an acceptance verdict.
- Worker leases renew every 750 ms with a five-second expiry. Cancellation stops the whole systemd cgroup; a hard runtime cap remains if the supervisor dies. One worker is admitted per studio products root. Dead locks are never automatically stolen; explicit reconciliation requires absent owner process, expired lease and observed stopped unit. Uncertain dispatch retains a fence; no retry/reclassification as successful. Git-side partial operations remain inspectable and require preserving user edits in manual recovery.
- Alternatives: unrestricted host Python/Node would violate isolation and was excluded; a fake backend cannot verify the acceptance gate; installing a new Docker runtime would duplicate already available working capabilities; cloud workers add credentials/cost/activation outside T11; hand-managed files cannot enforce frozen scope and provenance. Fixed Python stdlib keeps the first real recipe bounded without package-network exceptions.
- Local compute bounds are enforced, but host electricity/compute dollars are not metered or treated as free API inference. No provider/model/pricing configuration changed and no live call was made. No builders, independent QA, persistent preview, artifact download, participants or public release activated.
- Official references checked 2026-10-18: https://github.com/containers/bubblewrap/blob/main/README.md (policy is the caller's responsibility, namespaces/new-session/no socket mount); https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html (cgroup limits); https://git-scm.com/docs/git-worktree (separate task/review worktrees). Installed help and executed boundary tests, rather than generic docs alone, establish this host's capability.
- Review repairs: read-only root/dev/proc; compare exact committed blob bytes; reject corrupt task/product manifests; bind recipe before execution; retain a dispatch fence for uncertain cleanup; refuse concurrent workers; verify recovery only after the recorded process is absent. Two pre-existing broker concurrency tests used fixed 300 ms delays; under full-suite load they released pending admissions early. They now wait for the five budget/two concurrency denials before releasing the unchanged gates, retaining all assertions. Transient Windows lease-file write errors are counted; actual lease expiry is determined by the bridge, not by a single failed write.
- Rollback: leave local evidence/repos intact, stop any active unit, disable the product CLI entry points. Existing studio migrations and T00-T10 behavior remain compatible. Full instructions, limits and threat model are in docs/ISOLATED_EXECUTION.md; actual executed checks are in evidence/t11/verification.json.

## ADR-0013 - T10 immutable synthetic studies and separate participant/grader access

- Date: October 18, 2026. Status: accepted reversible implementation within Jordan's T10 request. T09 prerequisite verified as merged PR #10 at a9edf68; branch codex/t10-study-runner. The downloaded handover informed scope and was checked against canonical documents and actual code; it was not authority to activate live services or recruit people.
- Migration 9 adds append-only studies, assignments, execution requests, events and private grader materials. Assignment workspaces are separate; participant reads use the assigned actor rather than general workspace membership. Grader permissions are separate from catalog roles, mutually exclusive with participation for a study, and serialized with assignments. Study/hidden content is not indexed by catalog search. The coordinator remains trusted; synthetic seeds use one operator and cannot establish empirical independence.
- Artifact/config/prompt/protocol hashes freeze each study version. Three-arm autonomy and structured/open-ended discovery are separate assignment comparisons. Order is deterministically derived from the recorded seed; prior familiarity remains explicit. A needs_human original is terminal; assisted continuations have a separate identity and are excluded from that original primary comparison. A partial unique index permits exactly one terminal event under concurrency.
- Reuse the T07 structured worker and T04 broker. The baseline is a distinct versioned neutral prompt, one bounded broker operation, verbatim output formatting, no structured brief/rubric/skeptic. Admission checks the frozen request, fixture provider/model, deadline, envelope and call cap; generic workflows and caller-added baseline context are refused. Structured inputs are hash-checked before and during creation, and arbitrary catalog entries are omitted. Snapshot text is not independent source validation; synthetic structured runs stop for insufficient evidence. No new provider SDK or dependency.
- Human-only work can store document/code/artifact text and run conventional contains/equals/JSON checks bound to exact artifact hashes. Every broker helper is denied, including broker-backed search; conventional source browsing is a separate path. Workflow denials commit audit evidence before throwing. Untrusted code is never executed by the management host; implementation execution waits for T11 isolation.
- Study events and API authentication use existing transaction/audit/session machinery. Export uses a stable PostgreSQL repeatable-read snapshot, explicit raw records and post-serialization hashing. Money sums use integer nano-units without join multiplication; unknown and in-flight exposure stay separate. Human timing is reported; automatic fixture completion does not assert observed human activity. Grader content is explicitly withheld without grader authority, with content hashes retained for a protected sidecar.
- Alternatives: spreadsheets/manual records remain useful for protocol design but cannot enforce model/context boundaries; a second workflow engine would duplicate T05; generic searchable entities would expose hidden grader data; pretending fixtures are empirical work is excluded. This implements testable research plumbing, not protocol adoption or recruitment.
- Verification details are in evidence/t10/verification.json. Native Windows uses the already installed PostgreSQL 18 test binaries, not the handover's PostgreSQL 16 environment; no claim of a new PostgreSQL 16 test. A local LF checkout policy resolves the CRLF-only formatting failure observed on Windows. Earlier migrations/ADRs/protocol history remain unchanged.
- Official PostgreSQL 18 references checked October 18: https://www.postgresql.org/docs/18/transaction-iso.html and https://www.postgresql.org/docs/18/indexes-partial.html. Read-only export uses snapshot consistency; write invariants use row locks and a unique partial index.
- Review hardening: manual stops share the broker run lock; study events take the audit lock before insertion; no-key-update parent locks avoid foreign-key/audit inversion. Late outputs retain artifacts and charges but fail the original assignment deadline. Grader principals are human-only. Seed commands have distinct repeatable keys. Equal problem/outcome fields and bounded snapshots prevent arm-specific information loss.
- Rollback: additive migration 9 can remain unused if the study routes are disabled; do not delete study/audit evidence. A future live/participant implementation needs a new authorized configuration, verified adapters, protocol and recruitment decisions. T11 is the next milestone; it is not started here.


## ADR-0012 — T09 studio interface, PostgreSQL text search and address-kept state

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T09. Decision-maker: coding agent; owner review pending on the pull request.
- Interface: one React shell with a workspace picker and a list of views instead of stacked panels. State that should survive refresh (view, workspace, selected record, query, activity filter) lives in the hash address `#/view?ws=&id=&q=`; everything else is re-read from the API, so nothing is cached in browser storage. Views take plain props and call `api`, so a future desktop shell can host them unchanged. No new UI dependency.
- Search: PostgreSQL full text (`websearch_to_tsquery('english')`, plus a title substring match) over record titles and string values in bodies, source passage excerpts, decision request text and audit summaries, with GIN indexes (migration 8). Snippets come from `ts_headline` with control-character markers split into segments, so the page never renders HTML from the database. A full UUID or 8+ hex prefix switches to exact id search. Membership is resolved first; a non-member gets NOT_FOUND before any query runs. Redaction already nulls bodies, titles and excerpts, so redacted text cannot match.
- Comparison: one read route assembles the problem, its brief, claims linked to it with T06 evidence, alternatives derived from it with humility review and scorecard count, the discovery workflow and run, and run-level assumptions (assumptions may only be `part_of` a run, per the T02 link rules). Scores and gates still come from the T08 report; the page does not compute them.
- Actions: the page shows only actions the API exposes for the role and lets the server decide admission; a supervised selection returns `needs_human`, the page links to the decision and resubmits after approval. The submit form registers a run and, if asked, a 24-hour standing model grant capped per call, visible and revocable in Decisions.
- Alternatives considered: a client router library (rejected: hash state is enough and adds no dependency); a separate search engine (rejected: X03 owns semantic and audit questions; PostgreSQL covers lexical search with the existing access path); storing view state in localStorage (rejected: not shareable and survives sign-out).
- Not done: semantic search, graph view of lineage, product/task/gallery content (T11–T13), measured accessibility audit. Rollback: migration 8 only adds indexes; removing `catalog-store.ts`, `catalog.ts` contracts and the new routes restores T08 server behaviour.

## ADR-0011 — T08 computed selection reports, admitted selection and per-task spec freezes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T08. Decision-maker: coding agent; owner review pending on the pull request.
- Scores are computed, not stored: reviewers write `scorecard` records (a new kind) and the report is a pure function of the current alternative versions, their current scorecards, the T07 dispositions and the latest humility reviews. The report hash binds a selection to exactly what the owner saw; a changed card, alternative or gate changes the hash and the selection is refused (`VERSION_CONFLICT`).
- Arithmetic: score = 100·Σwᵢ(rᵢ−1)/(4Σw) as an exact BigInt fraction, shown to one decimal rounded half up. Unknown ratings are never averaged away: the candidate has no score, only bounds with unknowns at 1 and 5. Several reviewers are combined by the mean of their complete cards and differences are listed; ties share a rank; overlapping ranges are marked unresolved. Weights are equal integers; sensitivity reruns with each weight at 0 and at 2. Two rubrics (`opportunity-rubric/1.0`, `suitability-rubric/1.0`) keep the software opportunity ranking separate from cross-option suitability; both are `proposed` until calibration.
- Gates beside scores: ethics/access (from current cards: clear, unresolved, not assessed), the T07 disposition, the T03 humility gate for build and hybrid, and kind rules (`select_for_build` only for build or hybrid; `recommend_alternative` only for non-code or hybrid responses). No score can clear a gate. Advancing a candidate over a higher-ranked non-advanced one is an override that needs a reason; the full original report is stored with the selection.
- Authorization: new action type `candidate.select` (target = problem version, spec hash = hash of report hash, dispositions and override reason) is admitted through T03 inside the write transaction and added to the supervised default stage gates beside `spec.freeze`. Autonomous runs are recorded only under a covering grant, otherwise deferred.
- Storage (migration 7): append-only `selections` (newest is current; a later one replaces, never edits) and `spec_freezes` (unique per spec version, bound to the selection). `spec/1` bodies and scorecards are written only through the selection store; the generic record path refuses them.
- Task hashes: each task's hash covers its definition, its acceptance checks and their flows, the shared scope, non-goals and data contracts, and its dependencies' hashes, so a change propagates to dependants but not to unrelated tasks. A revision reports tasks as frozen, changed, added or unfrozen, plus removed ones; freezing again needs a new admitted decision. Freezing also re-checks the selection, the alternative version and the gates at that moment.
- Alternatives considered: storing model-written scores (rejected: not reproducible); floating-point means (rejected: ties and displays drift); renormalising around unknowns (rejected by C09); one spec-wide hash (rejected: cannot say which tasks a change affects).
- Not done: no model assessor role writes scorecards (fixture reviewers only); selection does not change a product lifecycle stage; no web form for selecting or freezing; Windows untested. Rollback: migration 7 adds two tables and widens one check constraint; removing `selection-store.ts`, the selection contracts and routes restores T07 behaviour once no `scorecard` rows or `spec/1` bodies exist.

## ADR-0010 — T07 discovery runs on the workflow engine with a hashed evidence packet

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T07. Decision-maker: coding agent; owner review pending on the pull request.
- Engine: discovery is a second role (`r02_discovery`, `r02-discovery/1.0`) on the T05 workflow tables rather than a new runner, so leases, fencing, replay through the T04 broker, budgets, decisions and owner controls apply unchanged. Migration 6 adds the `search_brief` kind, the discovery task kinds (locate, propose, skeptic, revise) and a revision `round` in the task's logical slot. The plan is a pure function (`coordinateDiscovery`) next to the T05 `coordinate`, sharing its guards and settlement.
- Evidence packet: built by the application from T06 claim evidence and the active catalog at start, size-capped, hashed and stored in the workflow's immutable context. Task contexts carry only the packet hash, their assignment and input task ids with output hashes; the worker renders packet and inputs as untrusted data with no authority. Independence of first proposals is checked from the stored contexts (same packet, only the locator as input) and recorded in the result.
- Deterministic gates in code: packet sufficiency (current supported or contested problem evidence), output validation against the packet (refs must exist, cross-field answers must name both fields and explain a mechanism in other words, perspectives must match, the skeptic covers each proposal once), duplicate detection by word overlap against catalog titles and summaries, per-type evidence checks (software needs usable data and tool-gap evidence; an existing-tool recommendation needs existing-tool evidence) and final dispositions. Model outputs that fail validation are repaired within `max_repairs`; they are never accepted.
- Alternatives considered: letting the model choose the plan or delegate (rejected: T05 keeps depth 1 and code-owned plans); embedding-based duplicate detection (needs a provider and a model version to pin; word overlap is transparent and enough for the gate); one call producing all proposals (cannot prove independence).
- Not done: the locator does not run searches or fetches itself; no live model run; semantic duplicates beyond word overlap are missed; scoring and selection are T08. Rollback: migration 6 rebuilds three check constraints and one unique key; removing `discovery-store.ts`, the discovery domain modules and routes restores T06 behaviour once no `r02_discovery` rows exist.

## ADR-0009 — T06 source broker, passages and claim support

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T06. Decision-maker: coding agent; owner review pending on the pull request.
- Broker: one application path (`SourceBroker`, `packages/research`) from a run to a page. Order: URL policy check, then T03 admission of a new `source.fetch` action type (reversible, no model, no external effect) and an in-flight retrieval row in one transaction, then the fetch outside any transaction, then one outcome transaction. The URL hash fills the binding's spec-hash slot, so an approve-once grant covers exactly one URL; standing grants cover the run. Idempotency is the logical operation id plus a request hash; in-flight rows past their deadline are swept to `failed/interrupted`. A real workspace without a live adapter is denied (`live_fetch_not_configured`); fixtures are never substituted.
- Network policy (`source-policy/1.0`, hashed into each retrieval): HTTPS on 443 only, approved hosts (exact or `*.` suffix, each `excerpts` or `hash_only`), no credentials in URLs, private/loopback/link-local/CGNAT/reserved/multicast addresses refused including IPv4-mapped and NAT64 forms (`net.BlockList`), DNS answers checked and the socket connected to the checked address, redirects followed manually with each target re-checked, byte/time/redirect/content-type/per-run limits, identity encoding only, no cookies, no shared agent.
- Records: `research_sources` (one per final URL key, tied to a `source` entity whose versions are the source versions; a new version only when content hash or access changes), append-only `source_retrievals`, `source_passages` (text offsets in extracted text, hashes, bounded excerpt or null), `claim_support` (retract-only). Excerpts and quotes are nulled by a trigger when a source is redacted. The generic record API refuses to forge broker facts (`retrieval` in a source body) or revise broker-managed sources.
- Evidence: supports/contradicts require a quote found verbatim in the stored excerpt and bind to the current claim and source versions; each row also creates or reuses a typed `supports`/`contradicts` link. Assessment is a pure domain function: rows whose claim changed or whose source changed, disappeared or is older than `max_age_days` stop counting; reposts count once by origin cluster (same normalized main text, or canonical link); inaccessible sources are labelled, never support.
- Dependency: `htmlparser2` 12.0.0 (streaming tokenizer, no DOM, no script execution) instead of a full DOM (jsdom: much larger, executes nothing by default but more surface) or regex parsing (fragile offsets).
- Retrieved text: wrapped as `untrusted_evidence/1` with `authority: none` when handed onward; no code path reads page text to decide permissions, policy, budgets or further fetches. The instruction-like regex is a label for people, not a boundary.
- Not done: live search adapter, readability-grade extraction, PDF/non-HTML parsing, re-clustering after later fetches, robots.txt handling, T05 roles calling the broker. Rollback: migration 5 is additive; removing `research-store.ts`, `packages/research` and the routes restores T05 behaviour.

## ADR-0008 — T05 durable orchestration on PostgreSQL instead of Temporal

- Date: October 18, 2026. Status: accepted. Decision-maker: Jordan, on a decision card in the T05 project thread ("Run T05's durable workflows on your PostgreSQL instead of a Temporal server?" → PostgreSQL). This deviates from the earlier proposed stack (ADR-0001, PROJECT_CONTEXT.md), which named Temporal as the T05 backend.
- Reason: Temporal needs a separate server next to the app on the owner's Windows PC; PostgreSQL is already required and installed, and T02's transactional audit + outbox already give atomic state, history and at-least-once delivery. The guarantees T05 asks for (step checkpoints, logical operation ids, leases with fencing, restart recovery, waiting on decisions, pause/cancel) are a few tables and row locks, testable in this repository. Alternatives: Temporal (more infrastructure, SDK determinism rules, a second source of truth beside the audit log), pg-boss/Graphile Worker (queue only; leases/fencing and the coordinator would still be ours).
- Design: migration 4 adds `workflows` (bound context, limits, control, state, result; identity and context immutable, terminal final, one live workflow per run) and `workflow_tasks` (one logical operation each, depth 1, lease owner/token/expiry from `workflow_lease_tokens`, decision link, output and hash). The coordinator is a pure domain function (`coordinate`) applied under the workflow row lock; lock order is workflow → tasks → (broker) run → envelope. Commits are fenced on (state = leased, token). Expired leases requeue (or cancel); the next lease replays the logical operation through the T04 broker, which never dispatches twice. An answered/closed decision wakes its task through a new idempotent outbox consumer (`workflow_wakeup`), with a polling fallback. Unknown outcomes wait in `reconciling`; repairs only follow known bad answers, within `max_repairs` and `max_calls`.
- Role: R05 skeptic critiques a pinned record version per perspective, then a synthesis; task context carries immutable constraints, the subject by id/version/content hash and a bounded excerpt, and synthesis inputs by task id and output hash. Prompt text and version are hashed (`prompt_hash`). The worker runs as a dedicated agent actor, added as a workspace editor when a workflow starts; it cannot start, steer or approve.
- Not done: no Temporal, no multi-role planning or model-chosen delegation, no deeper child trees (depth fixed at 1), no per-workflow child budget envelope (calls draw on the chosen envelope under T04 limits), no owner "retry with a new operation" for a reconciled task. Rollback: migration 4 is additive; removing `workflow-store.ts`, `packages/orchestrator` and the routes restores T04 behaviour.

## ADR-0007 — T04 budget envelopes, reservations and the model broker

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T04. Decision-maker: coding agent; owner review pending on the pull request. Stacked on ADR-0006 (T03), not yet merged.
- Accounting: permission-to-spend envelopes with carve-out allocation (a child's cap moves into the parent's `allocated`, and closing returns only the unspent remainder) rather than reserving on every ancestor. Reason: one row lock per reservation, no double counting, and conservation is a single inequality the database can check. Rollups are computed for reporting. Financial reality is a separate append-only `usage_records` table, one row per attempt.
- Exposure: reserve the maximum, not an estimate. Input tokens are bounded by UTF-8 bytes (byte-level BPE emits at least one byte per token) plus a fixed framing allowance, priced at the highest input rate; output at `max_output_tokens`; the documented long-context surcharge applies when the bound could cross its threshold. Text input only.
- Outcomes: provider refusals that are documented as unprocessed (429, 401/403, other 4xx) release the reservation; anything that may have been processed (timeout, 5xx, network loss, cancellation in flight, malformed or unpriced usage) holds the full reservation as `unknown` until a late answer settles it or the owner reconciles it. In-flight attempts past deadline + late window become `unknown` on restart. A settled attempt cannot be charged again.
- Order: run state, pricing/exposure, envelope checks, then T03 admission with the bound amount, then reservation, in one transaction (OversightStore admission refactored into `admitIn` for this). A failed budget check therefore never consumes an approve-once grant.
- Provider: the owner's reference model `gpt-6-astra` is documented in OpenAI's official model catalog with Standard pricing $10 / $1 cached / $12.50 cache write / $50 output per 1M tokens (long context above 272K input: 2x input, 1.5x output). Adapter uses `fetch` against POST /v1/responses instead of the `openai` SDK to avoid a dependency for one endpoint; revisit when streaming, tools or embeddings are needed. Live dispatch requires explicit `CREATOR_LIVE_PROVIDER=openai` plus a key; a key is not authorization.
- Alternatives considered: hierarchical reservation on each ancestor (more locks, harder reports); estimate-based reservation (can overspend); treating 5xx as unbilled (unknown is not zero).
- Rollback: migration 3 is additive; removing `packages/broker`, `budget-store.ts` and the routes restores T03 behaviour.

## ADR-0006 — T03 owner sessions, decision requests, grants and run modes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T03. Decision-maker: coding agent; owner review pending on the pull request.
- Authentication: opaque 256-bit random session tokens (stored as SHA-256) in an `HttpOnly; SameSite=Strict` cookie, `Secure` and `__Host-` prefixed when hosted, plus a per-session synchronizer CSRF token on every state-changing request and the existing Host/Origin checks. Login is either a local development code (constant-time compared, 5-failure lockout) or OIDC authorization code + PKCE through `openid-client` 6.8.8 (published 2026-09-05; `jose` 6.2.12 only as a test dependency for a local test IdP). No custom token or signature cryptography. Development login fails `authConfig` validation in hosted mode; hosted deployment is still refused overall (X06). Alternatives: a session library/framework (more surface for one owner), signed stateless cookies (revocation harder), passkeys (no established server library in the stack yet). Health, fixture and validate routes stay unauthenticated because they are stateless and loopback-only.
- Authority model: decision requests and grants live in dedicated tables (migration 2), not the generic record store, which now refuses `decision`/`grant` kinds. Approve-once creates a single-use grant bound to action type, run, target id/version/content hash, spec hash and amount; standing grants are versioned policy (create/revise/revoke by a human owner only, expiry ≤ 90 days). Standing approval is not offered for irreversible, external or stage-gated actions. Answers must echo the coverage hash the person saw; a changed target supersedes the request.
- Action effects come from a code registry (`ACTION_REGISTRY`), not the caller, so a caller cannot declare a model call model-free. Admission order follows HUMAN_OVERSIGHT.md; model flags can only add reasons. Value questions (judgment/clarification) are asked before authorization, and a judgment answer never authorizes.
- Modes: run mode is fixed at registration and must match the run record's research condition. Supervised asks at stage gates (default spec.freeze, product.commit_build, release.publish) and needs approve-once there; human-in-the-loop asks at release.publish and dynamic reasons; autonomous uses only its initial grant packet at recorded versions, cannot create decision requests, and defers as `needs_human`; human-only denies every model action type regardless of grants.
- Humility gate: `humility_review` records compare software, existing tool, process change, human-led, hybrid and defer/decline with evidence refs; `product.commit_build` requires a passing review of the exact subject version; an unresolved serious ethical problem becomes a judgment request. Assumptions are `assumption` records; routine reversible ones with a cheap test are logged as provisional.
- Not done: no budget reservation (T04), no orchestrator calling admission (T05; today the owner calls it through API/CLI), no agent actor sessions, no real IdP verified. Rollback: migration 2 is additive; dropping it and `oversight-store.ts` restores T02 behaviour except the auth requirement on record routes.

## ADR-0005 — T02 PostgreSQL record store, audit chain and outbox

- Date: October 18, 2026. Status: accepted reversible implementation decision within the owner's request to start T02 (started from the project's setup card). Decision-maker: coding agent; owner review pending on the pull request.
- Storage: one PostgreSQL database through node-postgres `pg` 8.23.1 (published 2026-09-30) with `@types/pg` 8.23.1. Alternatives: an ORM/query builder (more dependency surface for a small schema), PGlite/embedded Postgres (no service needed, but single-connection and weaker concurrency evidence), SQLite (not the architecture's PostgreSQL direction). Raw SQL keeps integrity rules visible in one migration.
- Model: a generic `entities` table plus immutable `entity_versions`, with per-kind Zod bodies, rather than one table per kind. Reason: thirteen kinds share identity, scope, versioning, redaction and linking; integrity that matters (scope, kind, version endpoints, fixture separation, append-only history) is enforced with composite foreign keys, partial unique indexes and triggers. A SourceVersion is a source entity version. Revisit per-kind tables if queries need typed columns.
- Contracts: schema 1.0 extended additively with `idea` and `assessment` kinds, relations `assesses`, `part_of`, `authorizes`, new derived_from pairs (including `artifact:task` and `product:idea`), error codes `ACCESS_DENIED`, `DUPLICATE`, `IDEMPOTENCY_CONFLICT`, `STORAGE_UNAVAILABLE`, and health fields `persistent: boolean`, `storage`. No T01-valid task/result/link becomes invalid; the health response changed shape (T01 clients accepted only `persistent: false`).
- Audit: database-ordered sequence, server clock, hash chain under a global transaction advisory lock, outbox row in the same transaction, idempotent consumer inbox. Exactly-once is not claimed; delivery is at-least-once with idempotent projection.
- Access: workspaces with owner/editor/viewer membership checked on every repository call; non-members get NOT_FOUND. The HTTP API acts as one configured local owner (`CREATOR_OWNER_ACTOR_ID`) because authentication is T03.
- Rollback: drop the database (no production data exists) and remove `packages/db`; the fixture app runs without `CREATOR_DATABASE_URL`. Later schema changes use new migrations, never edits to migration 1.

## ADR-0004 — Claude Code access to the development tools

Date: October 18, 2026. Status: accepted at the owner's request in the project thread.

Mirror `.agents/skills` into `.claude/skills` as plain copies (Windows checkouts break Git symlinks) and keep both in step on updates. Add Matt Pocock's `grill-me`, `grilling` (its dependency) and `improve-codebase-architecture` at the already-pinned commit; the architecture skill's default `GLOSSARY.md`/`docs/adr/` paths yield to `tracking/DECISIONS.md` and canonical context. Configure the same two MCP servers in `.mcp.json` without machine-specific paths; per-machine browser differences go in environment variables or a local-scope override, not the shared file. Add a cloud-only SessionStart hook that runs `pnpm install`, synchronously so checks never race dependency install. Plugin lifecycle hooks remain uninstalled. No credentials are stored; Firecrawl account access goes through the claude.ai connector or an environment variable reference.

## ADR-0003 — Project-local development skills and MCP

Date: October 18, 2026. Status: accepted within the owner's explicit tool-installation request.

Install the requested upstream development tools in this Creator Agent checkout: 27 skills under `.agents/skills` and two project MCP entries under `.codex/config.toml`. Use pinned source commits and the system skill-installer helper; preserve upstream text and licenses. Keep global Codex configuration and the separate CIS4914 repository unchanged. AGENTS.md gains only a tooling pointer and clarification that current authorization, canonical paths and host rules take precedence over third-party defaults.

Choose the official keyless Firecrawl hosted endpoint for the initial connection: it has no credential prerequisite and exposes scrape/search/parse. It is a hosted service with a mutable version and rate limits, not local inference or a self-hosted crawler. Full account capabilities require a later explicit connection. Existing Firecrawl app tools remain distinct; no credentials were extracted or reused. Direct initialize/list-tools passed without data-tool calls.

Choose pinned Playwright MCP 0.0.83 using the installed Edge channel, headless and isolated, instead of attaching a personal profile. Direct protocol discovery and blank-page navigation/close passed. Its upstream dependency reports Playwright 1.64.0-alpha-1790635538000; do not describe it as a stable Playwright release. This is developer browser access, not T11 execution isolation. Project cwd is machine-specific and must be adjusted if moved.

Install Impeccable's skill plus its pinned 0.1.15 Windows engine after matching the published SHA256 sidecar. Keep the binary ignored by Git; engine-probe passed. Ponytail is installed as six skills, without global lifecycle hooks or importing session history. Select Matt Pocock's tdd, diagnosing-bugs, codebase-design, domain-modeling and writing-for-agents skills; the existing kit already supplies milestone orchestration, handoff and decision tracking. No automatic updater, native app, issue tracker, redesign, or later product milestone is introduced.

Consequences: skills are available at the next turn; new MCP entries may require restarting MCP in Codex. Direct handshake evidence does not claim current-chat tool exposure or successful paid operations. Source pins and hashes, limitations, verification and update/removal instructions are in [the tool guide](../docs/DEVELOPMENT_TOOLS.md) and [evidence](evidence/development-tools/install-manifest.json). T01 application source/dependencies remain unchanged; T02 remains next eligible.

## ADR-0001 — Empty repository and minimal local architecture

- Date: October 17, 2026 (America/New_York; evidence timestamps use UTC).
- Status: accepted as a reversible implementation default within authorized T00, not as owner approval of spending, study design, or external activation.
- Decision-maker/source: coding agent executing Jordan Price's T00 request and supplied repository URL; canonical kit v3.0, October 9, 2026.
- Repository: `https://github.com/jordanprice040/CreatorAI.git`.
- Local root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Evidence: [remote refs](evidence/t00/remote-refs.json), [local baseline](evidence/t00/local-baseline.json), [incoming kit hashes](evidence/t00/input-kit-hashes.json). The local kit contained no implementation; the successful remote query advertised no refs. Inaccessible/deleted history is not claimed inspected.

### Decision and rationale

Use the existing kit directory as the local CreatorAI working tree. Initialize an unborn `main` and configure `origin` to the supplied URL, preserving the existing files. There is no HEAD commit, tracked file or observed remote default branch. `main` is a reversible local default. No commit or push was performed.

Carry forward modular TypeScript/pnpm, React/Vite web UI, Node API and CLI, with application-owned contracts and domain enforcement. PostgreSQL remains the T02 persistence direction, Temporal the planned T05 backend, and isolated execution/filesystem artifacts/local Git the T11–T13 direction. OpenAI Agents SDK remains an adapter candidate; Tauri remains deferred to X05. None is installed application functionality. Verify current official documentation and pin compatible versions during the relevant implementation milestone; historical examples are not adopted API signatures.

Alternatives considered: reuse earlier agent code (none found in this workspace/advertised remote refs); use manual kit records alone (sufficient for intake, insufficient for executable lifecycle/contract acceptance); use a generic agent framework (possible adapter, cannot replace application-owned authority and study controls); scaffold the entire stack (deferred by T00 scope). The selected minimal path matches the kit without a stack deviation.

Consequences: T01 can implement fixture contracts and API/CLI/web paths without credentials or database/workflow services. Persistent records after restart belong to T02, policy/budgets to T03–T04, bounded durable roles to T05. No discovery, model inference, generated builds or empirical research results exist yet.

Affected requirements: C22, C26–C35 and C49–C50 guide this architecture; none is implemented by the ADR. Affected versions: kit v3.0 and T00/T01 prompts; no application commit, frozen protocol, provider config or pricing snapshot exists. Supersedes: none. Rollback: revise this ADR before a material stack change; local branch/remote can be changed without application data migration. Preserve the kit/evidence. If earlier Creator Agent code is supplied later, compare it before replacing compatible functionality.

### Actual path map

All paths are relative to the local root above.

| Actual path | Observed role |
| --- | --- |
| `.git/` | Created by T00: unborn main/origin, no commits or tracked files. |
| `AGENTS.md` | Canonical coding instructions, preserved. |
| `agent.md`, `CLAUDE.md` | Instruction entry points, preserved; incoming CLAUDE checksum differed from original kit manifest. |
| `PROJECT_CONTEXT.md`, `PROMPT_LIBRARY.md`, `README.md` | v3.0 vision, milestones/shared contract, kit guide; their uninspected-repository statements describe kit creation, superseded by this dated intake. |
| `context/` | 9 design, policy, requirements and reconciliation documents, not runtime code. |
| `agents/` | RUNTIME_CONTRACT.md and ROLE_PROMPTS.md; future runtime specifications, no executable agents. |
| `templates/` | 5 JSON examples/scenarios and IDEA_DOSSIER.md; not executable validators/tests. |
| `references/` | 4 archived historical Markdown documents, retained as references. |
| `tracking/` | Four status/decision/integration/handoff documents updated by T00. |
| `tracking/evidence/t00/` | Added input hashes, remote observation, PowerShell verifier, baseline output and final file hashes. Intake tooling only. |
| `PACKAGE_VALIDATION.md`, `SHA256SUMS.txt` | Historical kit validation/checksums preserved; not a checksum manifest for the edited working tree. |

Absent: apps/, packages/, src/, application tests, dependency manifests/lockfiles, .github/workflows/, container definitions, migrations, provider adapters and application build/start/test commands. Input inventory: 32 files including SHA256SUMS.txt. Reusable assets are specifications, prompts, templates and requirements; no reusable implemented functionality was found. No other personal repository was searched.

### Planned dependency/path map — not present yet

| Gate | Paths / dependency direction | Prerequisite and behavior |
| --- | --- | --- |
| T01 | `packages/contracts` → runtime validation library | Versioned executable schemas, decimal-string exact money and explicit errors. Select/pin library after compatibility review. |
| T01 | `packages/domain` → contracts | Lifecycle, containment and transition rules; no external effects. |
| T01 | `apps/api` → contracts/domain; `apps/cli` and `apps/web` → API | Thin health and validated fixture demonstration; React/Vite client. Clients do not own enforcement. Share schemas as needed. |
| T01 | Root pnpm workspace/scripts | Strict checks, compatible pinned dependencies, lockfile and documented install/build/test/dev commands. Tool presence is not compatibility evidence. |
| T02 | `packages/db` → contracts/domain + PostgreSQL | Migrations, persistence, audit/outbox; usable service unverified. |
| T03–T05 | policy/finance/providers and `apps/orchestrator` | Admission precedes provider/Temporal effects; verified SDKs, budgets, caps and grants required. |
| T11–T13 | `apps/worker`, artifacts/integrations | Isolated generated workspaces, exact Git/artifact evidence; no host-execution fallback. |
| X05 onward | `apps/desktop` and hosted extensions | Deferred; no empty packages created. |

Create only paths required by the authorized milestone. Smallest useful T01 slice: CLI/web → local API → runtime-validated fixture contract and deterministic lifecycle result, with health and invalid-input/transition checks. The persistent bounded-role slice in context/ARCHITECTURE.md spans T01–T05; T01 alone does not complete it.

### Instruction reconciliation and preservation

No remote instructions were available to merge. AGENTS.md is canonical; agent.md points to it and CLAUDE.md imports it. CLAUDE.md has escaped underscores in supplementary path text; use the actual PROJECT_CONTEXT.md and tracking/BUILD_STATUS.md paths stated in AGENTS.md. Preserve the incoming bytes rather than normalize an unexplained user change. Before edits, 30/31 original checksum entries matched; CLAUDE.md was the sole mismatch. Tracking edits intentionally make the historical checksum list stale; retain it and use separate dated input/final evidence.

Host rules/current user request take precedence, followed by recorded owner decisions and canonical context over archived references. Runtime role prompts are future product behavior, not coding-tool instructions. The separate CIS4914 repository was neither searched nor modified. No subagents were used.

### Remaining consequential choices

- T01: verify/pin compatible runtime, package manager, API/schema/test libraries using official documentation. No owner question blocks this routine local work.
- T02/T05/T11: verify local database/workflow/isolation deployment. psql, temporal and docker were not found on PATH; service availability elsewhere remains unknown.
- Before live models: verify preferred reference model's actual API identifier/access, capabilities, pricing, credentials, finite caps and scoped data/spend grant. GPT-6 Astra remains a historical preference, not verified availability; no substitution adopted.
- T14/final collection: owner/committee decisions on RQ priority, tasks, participants/raters, institutional requirements, sample size, limits and schedule remain unresolved. Synthetic/local work can proceed.
- Extensions: public GitHub writes/releases, hosting, payments, campaigns, reinvestment and external tracing require applicable configured authority. This URL/intake request is not product integration activation.

## ADR-0002 — T01 executable fixture boundary and dependency pins

- Date: October 17, 2026. Status: accepted reversible implementation decision within Jordan's explicit T01 request. Supersedes ADR-0001's absent-code inventory as current status; preserves its architecture and historical observation.
- Implemented: two shared packages (contracts/domain), three apps (Node HTTP API, compiled CLI, React/Vite web), and a tests workspace. Node's built-in HTTP/test APIs avoid an additional backend framework. Zod validates runtime inputs; TypeScript uses strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes and project references. Future db/policy/provider/orchestrator/worker/desktop packages remain absent.
- Pins: TypeScript 5.9.3, Zod 4.6.7, React/React DOM 19.3.1, Vite 8.3.4, Prettier 3.9.10, Node types 22.19.0, React types 19.3.0, pnpm 11.25.0. npm metadata verified available versions; selected TypeScript's stable 5.9 line rather than the newer major. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also supported/tested because the bundled pnpm runtime uses it. Package commands use the shell Node 22 here. Exact transitive resolution/integrity is in pnpm-lock.yaml. Official documentation sources and actual dependency roles are in docs/LOCAL_DEVELOPMENT.md.
- API: GET /api/health, POST /api/fixture and POST /api/validate. Loopback-only service/config, bounded JSON bodies and Host/origin checks. The web page and CLI use these real endpoints and validate responses. Hosted/live configuration fails; no paid/network provider exists. The historical model preference remains unverified in config/provider-availability.json.
- Schema 1.0 implements the kit's fields with UUID identities and SHA-256 version references; templates remain intentionally non-executable design examples. Canonical hashing sorts object keys by code-unit comparison, avoiding locale-dependent ordering. USD nano-units use canonical integer decimal strings (up to 30 digits) and BigInt comparisons; JSON never serializes money as floating point.
- Alternatives/consequences: a real model/database would exceed T01 scope and its prerequisites; using fixtures permits honest local verification now. A separate provider package is unnecessary for one deterministic fake, so it lives in domain/fixture.ts. The fixture's synthetic 2099 deadline is explicitly not a live allowance. Distinct successful decision execution and deferred/failed product outcomes are intentional. A build recommendation does not create an artifact or claim build-ready verification.
- Trust boundary: delegation validation checks a complete proposed allocation, not concurrent reservations. Lifecycle rules receive trusted current state/evidence; they do not let API callers advance arbitrary products or authenticate model-supplied evidence. Test/review evidence must bind candidate/spec/version and use a non-builder actor, but actual independent review is T12. No accounting, grant, persistence or isolation gate was weakened to pass T01.
- Verification: fresh source-only frozen install/build/check; 20 tests on Node 22 and 24; built-web proxy smoke and actual browser interactions. Exact candidate and logs: tracking/evidence/t01/. No real AI, research or study verification claimed.
- Affected requirements: partial foundations for C10–C16, C20–C23, C28–C29, C32, C35 and C49; see BUILD_STATUS.md. Kit v3.0 and draft research protocol unchanged. No protocol freeze, paid grant or owner study decision inferred.
- Rollback: replace/adjust these minimal packages and dependency pins with a recorded ADR. No persistent user data, real provider effect or deployment requires migration. Preserve incoming CLAUDE.md and historical T00 evidence. No separate senior-project repository was touched.

## Future entries

Use one entry per decision:

- Decision ID and date:
- Status: proposed / accepted / superseded / rejected:
- Decision-maker and source:
- Question and alternatives:
- Evidence and reason:
- Scope, consequences and affected requirement IDs:
- Affected code/spec/prompt/protocol versions:
- Migration or rollback plan:
- Supersedes / superseded by:

Proposed defaults are documented in context/DECISIONS_AND_OPEN_QUESTIONS.md. Do not silently convert them into accepted owner decisions.

## T18 drafting boundary — October 18, 2026

Owner explicitly authorized T18 using documented missing-data allowance, with no
sending. Draft from upstream 3e9026f and actual verification artifacts; keep T15
final evaluation/T16 empirical analysis incomplete, comparative protocol proposed
and unfrozen, empirical results unavailable and all research questions unanswered.
Preserve local edits and prior RD6 preference/cap without enabling dispatch.
Committee checklist records missing decisions and unconfirmed dates. This is a
scope record for drafting, not a research freeze, academic approval or stack ADR.

## T19 acceptance boundary and reproducibility overlays — October 18, 2026

User authorized T19 after the T18 missing-data packet. Preserve source 3e9026f
without merging over local changes; archive fixed-commit bytes plus explicit local
doc/script/test overlays. Tests may optionally preserve synthetic product packages
and same-workspace provenance/search/cost evidence. No runtime policy is changed.
The restart integration wait now accounts for observed killed-worker lease expiry
before its bounded completion window; runtime leases and no-duplicate assertions
are unchanged. Retain the original 185-pass/1-fail/1-skip full log and focused
checks rather than claiming a green whole-suite rerun. Committee acceptance,
participant evaluation, protocol freeze and academic schedule remain unresolved.
No live activation, release or sending follows from creating a local archive.

## X05 implementation boundary — October 19, 2026

Owner authorized starting independent X05 work alongside Claude Code X03/X04.
Keep this pass in new apps/desktop files; reuse T13 manifest schema and executor
canonical-path/ustar validators. Initial Tauri source uses existing loopback web
origin and same-origin API proxy, with no native command/plugin/IPC grants. This
avoids duplicating catalog authority or adding a credential-bearing native bridge.
Offline artifact cache stores exact bytes plus local import date; every inspection
re-hashes, and receipts grant no permission. No extraction or host execution.
Alternative retained: existing browser plus authenticated Gallery downloads already
works; desktop convenience does not justify weakening isolation/authentication.
Full system-browser handoff and paired-worker control require coordinated shared
API/database edits, not a process-local identity map or trusted model decision.
Tauri 2.12.4 and tauri-build 2.7.3 were checked on official docs.rs on this date;
capability/configuration/prerequisite references are in apps/desktop/README.md.
Native toolchain absent; transitive lock/build/native acceptance still pending.

## ADR-0028 — X05 local desktop sign-in, source cache and presence pairing

October 19, 2026. Owner confirmed Rust/Cargo installation and that X03/X04 were
finished, authorizing shared integration. Fast-forwarded to origin/main ddf7bcf;
restored local audit/X05 changes from a retained recoverable stash. Tracking-only
conflicts retain both sets of records. No new commit or push was made.

Use a Tauri 2.12.4 Windows shell over the existing loopback shared UI/API. No
remote-origin native IPC grants. Rust menu actions own browser opening, authenticated
source download and opening only the downloaded manifest in Notepad. Preview
window requests can open only the exact separate-origin T13 ticket URL in the
system browser; other navigation/new-window origins are denied. No source extraction
or generated-code execution occurs on the desktop host. Raw manifest export is an
owner-only, hash-bound addition to T13; original bytes are rehashed before sending.
Native and Node caches are dated read-only snapshots, not authority or synchronization.

Migration 16 follows X04's 15. Five-minute one-time challenges bind to SHA-256 of a
256-bit native/client proof. Browser approval uses existing session/CSRF, binds the
approving session and, for workers, requires current human workspace ownership.
Claiming is transactional and verifies that approval has not expired/revoked.
Desktop claims issue separate revocable HttpOnly sessions; worker claims issue
hashed, expiring, revocable identities scoped to one workspace. No token/proof in
URLs, audit events or device lists. Worker client credentials remain in memory;
restarting requires re-pairing. Declared capability is not infrastructure evidence.

Presence heartbeats use 30-second scoped leases and controls invalidate the fence.
Paired workers cannot dispatch work, read artifacts with their bearer token, call a
model or consume a budget. This is an explicit partial X05 boundary. Reject a
process-local identity map, copying a browser cookie to a worker, or wiring an
arbitrary shell command to a worker lease. Actual paired execution must integrate
existing isolation and admission/accounting, with its own acceptance evidence.
Closing a window is separate from stopping a worker. Shutdown is a request until
observed; revocation denies future polls immediately, and is not proof of OS exit.

The importer/native filesystem boundary assumes an owner-controlled cache outside
product execution workspaces. Ancestor symlink/reparse checks do not protect against
concurrent replacement by another owner-privileged process. No installer/updater,
background service, external tracing, hosted deployment or live integration activated.

Native source download and startup were executed on Windows with fixture inputs;
HTTP/PostgreSQL pairing/session checks are separate from native interactive browser
approval, which remains unverified. The imported X04 Git contract used POSIX mkdir
and an invalid Windows file URL; replaced its test setup with Node mkdirSync,
pathToFileURL and platform-appropriate Git environment, retaining every assertion.
Generated Cargo target/schema files are excluded from Git/Prettier. Dependency
versions and commands are in apps/desktop/README.md; exact results in evidence/x05.
