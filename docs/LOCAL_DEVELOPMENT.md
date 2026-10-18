# Local development - T10 update

The sections below retain the historical setup notes. T10 adds a **synthetic-only study runner** through the API, CLI and Studies view. It is not an activated participant study. PostgreSQL 18 on native Windows is now exercised in an isolated loopback cluster; the earlier PostgreSQL 16 Linux evidence remains separate.

## Studies (T10)

Use a fixture workspace, sign in, and choose **Studies**. Create a synthetic three-arm study, inspect the frozen participant context, enter ordinary document/code/artifact text, run a conventional text check and submit or stop. The assisted arm has an intervention form. An autonomous `needs_human` stop can have a separately linked assisted continuation; the original outcome remains terminal. The optional open-ended baseline belongs to the separate discovery comparison.

```powershell
pnpm cli study-seed <workspace>
pnpm cli studies <workspace>
pnpm cli study <workspace> <study-id>
pnpm cli study-context <workspace> <attempt-id>
pnpm cli study-execute <workspace> <attempt-id>
pnpm cli study-create <workspace> <manifest.json>
pnpm cli study-assign <workspace> <study-id> <assignment.json>
pnpm cli study-write <workspace> <attempt-id> artifacts <entry.json>
pnpm cli study-write <workspace> <attempt-id> tests <test.json>
pnpm cli study-write <workspace> <attempt-id> interventions <intervention.json>
pnpm cli study-write <workspace> <attempt-id> deviations <deviation.json>
pnpm cli study-write <workspace> <attempt-id> finish <outcome.json>
pnpm cli study-export <workspace> <study-id> <new-output.json>
```

`study-create` consumes the strict `study/1` contract in `packages/contracts/src/study.ts`. The example is `SYNTHETIC_STUDY` in `packages/domain/src/study.ts`. Every manifest, packet, configuration, prompt, rubric, intervention policy and resource policy is hashed. Creating a revised study creates a new immutable study; it never overwrites a prior protocol. Assignments carry `comparison` (`autonomy` or `discovery`), condition, method, order, seed through the study, participant code, prior familiarity and the exact manifest hash. `synthetic` must be true, and real workspaces are refused.

An artifact entry is `{"kind":"document","name":"My response","content":"Verbatim text"}`. A conventional test is `{"artifact_id":"...","artifact_hash":"...","check":"contains","expected":"checklist"}`; `equals` and `json_valid` also work. These are executed string/JSON checks bound to the immutable entry. Arbitrary code execution and AI implementation-stratum execution await T11's isolated worker. No uploaded code runs on the studio host.

For `study-execute`, the application constructs the model input. Structured execution uses the existing T07 workflow/worker and its pinned role prompt. Open-ended execution uses one neutral prompt and the existing metered broker, without the structured brief, rubric or skeptic. Both share the frozen packet, model/pricing versions, candidate/resource caps and tool envelope. Only the pinned fixture provider and empty tool list are enabled. Initial text snapshots are unverified evidence: the structured runner deliberately stops for insufficient support instead of inventing source verification. Human-only execution is refused and logged. Synthetic grants and envelopes cannot fund a real provider.

Study records are outside general catalog search. Each attempt gets an isolated fixture workspace; participants receive only their assigned context and entries via the study endpoints, without catalog membership. The local UI runs as the coordinator/owner and the seed deliberately uses one synthetic operator, so it is not evidence of independent participants or an activated multi-user recruitment flow.

Private grader material uses separate authorization: `POST workspaces/<ws>/studies/<id>/graders` with `actor_id`, then `GET`/`POST .../grader-material` for that grader. A participant cannot be made a grader for the same study, nor a grader assigned as a participant. Workspace ownership alone never reveals hidden material. Exports include grader hashes; content is included only when the exporter also has grader authority, otherwise explicitly withheld. Grader-authorized reads provide the protected sidecar. No hidden tests or labels enter participant/model contexts.

The export is a repeatable-read snapshot with a hash verifiable after JSON serialization. It includes all assigned attempts (including unfinished, failed and assisted continuations), raw study events, decisions, artifact/test records, workflow results/task manifests, redacted context hashes, usage, reservations, audit events and deviations. Metrics distinguish fixture request duration, wall time, reported human activity/wait, intervention effort, simulated charges and held exposure. Active AI inference is zero in fixture mode; unreported human timing remains unknown. Do not add intervention minutes to reported total effort without checking what the total includes. No synthetic amount is real spend and a submission is not a verified-success rating.

To repeat the CLI/API acceptance check against a disposable fixture API, set `CREATOR_API_URL` and its `CREATOR_DEV_LOGIN_CODE`, build, then run `node scripts/verify-study.mjs`. It creates synthetic records and writes `.verification/t10-cli/` plus `tracking/evidence/t10/cli-acceptance.json`. Keep the session file private. `pnpm test:db` still requires `CREATOR_TEST_DATABASE_URL`; it refuses to substitute skipped database tests for a passing gate.

Protocol adoption, institutional review, recruitment, final counts and independent ratings remain T14-T16 work. No live AI or paid service was activated. Migration 9 and ADR-0013 describe the boundaries. The LF checkout policy in `.gitattributes` prevents Windows CRLF conversion from making Prettier reject otherwise identical files.

---

# Local development — T06

Creator Agent has a local API, CLI and React page. The task demonstration still uses the **deterministic fixture provider** and is not saved. Since T02, records (sources, claims, problems, ideas, alternatives, assessments, products, specifications, runs, tasks, decisions, grants, artifacts), typed many-to-many links and an audit history persist in **PostgreSQL** when `CREATOR_DATABASE_URL` is set. Without it the app still starts, reports `persistent: false`, and record routes return `503 STORAGE_UNAVAILABLE`. Nothing here researches problems, invokes AI, builds generated products, or runs studies.

## Start

From the repository root with Node 22.21.0 (the `.node-version` baseline) or Node 24.19.0 and pnpm 11.25.0:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the local page](http://127.0.0.1:5173). The API health endpoint is [on port 4310](http://127.0.0.1:4310/api/health). `pnpm dev` builds the backend, starts both servers and prints their addresses. Ctrl+C stops them. Web edits hot reload; restart after contracts/domain/API edits. The API binds only to loopback. No provider key, Docker, or Temporal service is needed; PostgreSQL is needed only for saved records.

## Saved records (PostgreSQL)

Verified with PostgreSQL 16.15 on Linux. Any PostgreSQL 16+ on the same machine should work; a Windows installation has not been tested yet. The database must be on loopback (`127.0.0.1`, `localhost` or `[::1]`).

```powershell
# once, as the PostgreSQL superuser (choose your own local password)
psql -U postgres -c "create role creator login createdb password 'local-dev-password'"
psql -U postgres -c "create database creator_dev owner creator"

$env:CREATOR_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/creator_dev'
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` applies pending migrations under an advisory lock and refuses a database whose applied migration differs from the code. The API checks the schema at startup and serves records only when it is current; it re-checks on the next request after you migrate. In another terminal (same `CREATOR_DATABASE_URL` is not needed; the CLI talks to the API):

```powershell
pnpm cli seed-lineage          # labeled fixture workspace: two ideas → one product, one idea → two products, task → artifact
pnpm cli workspaces
pnpm cli list <workspace-id> idea
pnpm cli show <workspace-id> <record-id>
pnpm cli lineage <workspace-id> <record-id> upstream
pnpm cli history <workspace-id> [record-id]
pnpm cli create <workspace-id> idea "Shared roster" '{"summary":"One roster","uncertainty":"Untested"}'
pnpm cli revise <workspace-id> <record-id> <expected-version> "Shared roster" '{"summary":"…","uncertainty":"…"}' "Reason"
pnpm cli link <workspace-id> derived_from <product-id>@1 <idea-id>@1 "Rationale"
pnpm cli archive <workspace-id> <record-id> <expected-version> "Reason"
```

The web page shows a read-only Records panel: workspace records, each record's versions, incoming/outgoing links and history.

In a second terminal:

```powershell
pnpm cli health
pnpm cli demo use_existing "Compare a shared checklist with custom software"
pnpm cli demo change_process "Clarify responsibility for a recurring task"
pnpm cli demo failed "Show a synthetic failed attempt"
```

The CLI calls the API; it never substitutes an offline result when the API is unavailable. Failures return a nonzero exit code. Run `pnpm build` before invoking the compiled CLI directly.

Separate terminals are also supported: `pnpm dev:api` and `pnpm dev:web` after a build. Do not start these alongside `pnpm dev` on the same ports.

## Sign-in and human decisions (T03)

Records, decisions, grants and runs need an owner session (PostgreSQL required). Two sign-in modes exist:

- **Local development (default).** The API prints a one-run login link (`http://127.0.0.1:5173/#login=<code>`) and code at startup, or uses `CREATOR_DEV_LOGIN_CODE` (32+ URL-safe characters) if set. Open the link, or run `pnpm cli login <code>`. This mode fails configuration in hosted mode.
- **OIDC.** Set `CREATOR_OIDC_ISSUER`, `CREATOR_OIDC_CLIENT_ID`, optional `CREATOR_OIDC_CLIENT_SECRET`, `CREATOR_OIDC_REDIRECT_URI` (for the web page: `http://127.0.0.1:5173/api/auth/oidc/callback`) and `CREATOR_OIDC_OWNER_SUBJECT` (the `sub` claim allowed in). Authorization code + PKCE through `openid-client` 6.8.8. Plain-http issuers are accepted only on loopback. Verified only against a local test identity provider, not a real one.

Sessions are opaque tokens in an `HttpOnly; SameSite=Strict` cookie (stored hashed, 12 hours by default, `CREATOR_SESSION_HOURS`); every state-changing request must send the session's `X-CSRF-Token`, and foreign origins are refused. The CLI keeps its session in `.creator/cli-session.json` (git-ignored; override with `CREATOR_SESSION_FILE`).

```powershell
pnpm cli login <code>
pnpm cli run-register <workspace> <run-id>@1 supervised     # or human_in_loop, autonomous_within_scope [grant-id@version ...], human_only
pnpm cli grant-create <workspace> '{"run_id":null,"action_types":["record.revise"],"target_kind":null,"max_amount_nano_usd":null,"allow_irreversible":false,"allow_external_effects":false,"data_classes":["synthetic"],"expires_at":"2026-11-01T00:00:00Z","rationale":"Routine edits"}'
pnpm cli admit <workspace> <run-id> '<action-json>'           # allow / request_human / deny / defer, recorded
pnpm cli decisions <workspace> pending
pnpm cli decision <workspace> <decision-id>                   # shows exactly what it covers and its coverage_hash
pnpm cli answer <workspace> <decision-id> <coverage-hash> approve_once "Reason"
pnpm cli answer <workspace> <decision-id> <coverage-hash> choose_option proceed "Reason"
pnpm cli run-cancel <workspace> <run-id> "Reason"
pnpm cli humility-gate <workspace> <review-id>
```

The web page shows the same decisions in a Human decisions panel: the concise request, what an approval covers (action, target version, content/spec hash, amount, expiry), approve once versus a previewed standing policy, option answers for judgment questions, standing policies with Revoke, and runs with Stop.

## Budgets and metered model calls (T04)

Every model or metered tool call goes through one broker (`packages/broker`). For each attempt it commits, in one transaction, the T03 admission and a reservation of the call's **maximum** exposure against a budget envelope; only then does an adapter see the request. Afterwards the provider's reported usage settles the charge and releases the rest. Anything short of "allowed and funded" is recorded as a denial and nothing is sent.

- **Pricing.** An owner records a dated pricing snapshot per workspace. `config/pricing/fixture-model-v1.json` holds simulated units for fixture workspaces; `config/pricing/openai-gpt-6-astra.json` copies the official GPT-6 Astra page (retrieved 2026-10-18). Calls without a matching snapshot are denied, never priced at zero.
- **Exposure bound.** Input tokens ≤ UTF-8 bytes + framing allowance, priced at the highest input rate (cache writes), plus `max_output_tokens` at the output rate, with the documented long-context surcharge when the bound could cross it.
- **Envelopes.** `global` (owner-funded), `period` (with a window), `run` and `task`. A child is carved out of its parent (`allocated`), so spending is never counted twice; `rollup_incurred` adds children for reporting. Each envelope also limits calls in flight. Only a signed-in human owner can fund, allocate or close; closing returns only the unspent remainder.
- **Outcomes.** `settled` (charged from usage, once), `released` (provider refused before processing: rate limit, auth, invalid request), `unknown` (timeout, 5xx, network loss, cancellation in flight, unpriced usage). Unknown exposure stays held until a late answer settles it or the owner reconciles it from provider records. A restarted API turns attempts left in flight past their deadline into `unknown`.

```powershell
pnpm cli pricing-add <workspace> config/pricing/fixture-model-v1.json
pnpm cli budget-create <workspace> '{"parent_id":null,"kind":"global","run_id":null,"name":"Owner budget","cap_nano_usd":"50000000","starts_at":null,"ends_at":null,"max_in_flight":3}'
pnpm cli model-call <workspace> <run-id> '{"envelope_id":"…","action_type":"model.generate","task_id":null,"logical_operation_id":"<new uuid>","pricing_snapshot_id":"…","data_class":"synthetic","input":[{"role":"user","text":"Hello"}],"max_output_tokens":100,"output_format":"text","tool":null,"max_attempts":1,"timeout_ms":30000,"justification":"Why"}'
pnpm cli budgets <workspace>
pnpm cli reservations <workspace> [envelope-id]
pnpm cli reconcile <workspace> <reservation-id> '{"outcome":"no_charge","evidence":"Provider usage page shows no request"}'
pnpm cli broker-status
```

The run also needs a grant covering the action with an amount cap at least the exposure (or a person approves the exact amount). Repeating a `logical_operation_id` returns the stored outcome without calling the provider again. The web page shows a Budgets panel with balances, recent calls, refusal reasons and a fixture test call.

**Live calls.** A real workspace is denied (`live_provider_not_configured`) unless the API runs with `CREATOR_LIVE_PROVIDER=openai` and `OPENAI_API_KEY` (optional `CREATOR_OPENAI_MODEL`, default `gpt-6-astra`). The key stays in the API process. It is not permission to spend: the call still needs documented pricing, a covering grant and a funded envelope. No live call has been made or verified.

## Durable workflow runs (T05)

A workflow is one finite run of one bounded role (R05 skeptic) for a registered run. The coordinator is deterministic code, not a model: it critiques a pinned record version from each perspective (as child tasks, at most `max_concurrency` at a time), then combines the results in a synthesis task once every critique has finished. It always picks a permitted next step or stops; there is no open-ended debate. All state is in PostgreSQL (migration 4), so it survives restarts.

- **Where it runs.** The API process runs a worker whenever a database is configured. `CREATOR_WORKER=off` turns that off; `pnpm worker` runs the same loop as a separate process (several may run). The web page and CLI only read and steer durable state: closing the page or exiting the CLI does not stop a workflow. Only Cancel does.
- **Checkpoints and leases.** Each task has its own logical operation id. A worker leases a task with a fresh fencing token and renews it while the call runs. If the worker dies, the lease expires and another worker takes the task; the old worker's commit is refused (`LEASE_LOST`). Replaying the logical operation through the broker never calls the provider twice.
- **Waiting for people.** If admission asks for a decision, the task waits (`waiting_human`) and the workflow shows it. Answering the decision (web Human decisions panel or `pnpm cli answer`) wakes the task through the outbox; approval re-sends the same call, anything else stops the workflow. Autonomous runs never ask: they stop as `needs_human`.
- **Unknown outcomes.** A timeout or lost answer puts the task in `reconciling`; it is never retried automatically. A late provider answer completes it; owner reconciliation without an answer ends it as failed. A malformed answer (known and charged) gets at most `max_repairs` new calls, within `max_calls`.
- **Pause and cancel.** Pause stops new dispatch; work already sent finishes. Cancel also stops delegation, cancels queued work, closes pending questions, and aborts calls in flight, whose exposure stays held as `unknown` until reconciled. Cancelling the run (T03) cancels its workflow too. Human-only runs cannot start a model role.

```powershell
pnpm cli workflow-start <workspace> <run-id> '{"role":"r05_skeptic","subject":{"id":"<idea-id>","version":1},"constraints":["Synthetic data only."],"perspectives":["evidence","existing tools"],"envelope_id":"…","pricing_snapshot_id":"…","data_class":"synthetic","limits":{"max_children":4,"max_concurrency":2,"max_depth":1,"max_attempts":1,"max_repairs":1,"max_calls":10,"max_output_tokens":600,"call_timeout_ms":60000,"max_wall_seconds":1800}}'
pnpm cli workflows <workspace> [run-id]
pnpm cli workflow <workspace> <workflow-id> --wait
pnpm cli workflow-pause <workspace> <workflow-id> <expected-version> <reason>
pnpm cli workflow-resume <workspace> <workflow-id> <expected-version> <reason>
pnpm cli workflow-cancel <workspace> <workflow-id> <expected-version> <reason>
pnpm worker
```

The run needs a covering grant (or a person approves each call), an active budget and a pricing snapshot, exactly as for T04 calls. The web page has a Workflow runs panel: start a skeptic review on an idea or problem record, watch each step, its deliveries and usage, and pause, resume or cancel. In a fixture workspace the deterministic adapter answers, so critiques are placeholders.

## Sources and claim evidence (T06)

Runs fetch web pages only through the API's source broker (`packages/research`). Each fetch is a `source.fetch` action: the URL is checked against the source policy, admitted against the run's grants (T03) and recorded as in flight in one transaction; only then is the page requested. Every redirect target is checked again, DNS answers are checked at connection time and the socket connects to the checked address. Private, loopback, link-local and reserved addresses, non-HTTPS URLs, other ports, URLs with credentials and hosts not on the approved list are refused and recorded as `blocked`. Byte and time limits, allowed content types and a per-run fetch limit apply. No cookies or credentials are sent.

- **What is kept.** Each source keeps its URL, final URL, content hash, retrieval and publication dates, the retrieval state (fetched, inaccessible, removed, blocked, failed, too large, unsupported type, denied) and its passages: exact text offsets, a hash, and a bounded excerpt. Hosts with `hash_only` retention keep hashes and offsets but no text. A changed page becomes a new source version; an unchanged one only records the check.
- **Claims and support.** Support links a passage to the current claim version as supports, contradicts or does not support, typed as source assertion, quotation, observation or our inference. Supports and contradicts must quote text that occurs in the stored excerpt (`EVIDENCE_MISMATCH` otherwise). An inaccessible source can be recorded as such, never as support. The claim's evidence status (supported, contested, contradicted, inferred, needs recheck, inaccessible, insufficient) counts reposts of one story once (origin clusters by matching text or canonical link) and stops counting rows whose source or claim changed, was removed or is older than `max_age_days` (default 180).
- **Retrieved text has no authority.** Page text is stored and shown as evidence only. Text that looks like instructions is labelled; it cannot change grants, policy, budgets or what is fetched next.

```powershell
pnpm cli seed-research
pnpm cli source-status
pnpm cli source-fetch <workspace> <run-id> https://wire.fixture.test/stories/clinic-waits
pnpm cli sources <workspace>
pnpm cli source <workspace> <source-id>
pnpm cli retrievals <workspace> [run-id]
pnpm cli claim-support <workspace> <claim-id> '{"evidence":"passage","claim_version":1,"passage_id":"…","stance":"supports","support_type":"quotation","quote":"exact words from the passage","rationale":"…"}'
pnpm cli claim-evidence <workspace> <claim-id> [max-age-days]
pnpm cli support-retract <workspace> <support-id> <reason>
```

`seed-research` creates a fixture workspace with a run, a grant, fetches of the synthetic corpus (a report and its corrected version, a wire story with a repost and a copy, a contradicting survey, a paywalled page, a page that disappears, a redirect to a metadata address and a forum page with injected instructions) and three claims. The web page has a Sources and evidence panel showing sources, passages, recent fetches and each claim's evidence, with a fetch form.

**Live fetching.** Fixture workspaces read only the synthetic `.fixture.test` corpus. A real workspace is denied (`live_fetch_not_configured`) unless the API runs with `CREATOR_SOURCE_FETCH=live` and `CREATOR_SOURCE_HOSTS` (and optionally `CREATOR_SOURCE_HASH_ONLY_HOSTS`). The run still needs a covering `source.fetch` grant; approve-once covers exactly one URL. Live fetching has not been verified against a real site. There is no live search adapter yet.

## Discovery runs (T07)

A discovery run narrows a search brief into a located problem and competing responses. It is a T05 workflow (same leases, broker, budgets, pause/resume/cancel) with a different role and plan:

1. **Brief.** A `search_brief` record: theme, two different fields to borrow from, target users, context, measurable problem, outcome measure, data and tools, time and budget limits, constraints and an optional NAE Grand Challenge seed (it must be narrowed; the theme cannot just repeat it).
2. **Evidence packet.** At start the API reads each chosen claim's current T06 evidence (status, quoted passages) and the matching catalog records, computes a sufficiency verdict and binds the packet to the workflow by hash. It never changes afterwards; `discovery-packet` shows it. A claim revised while the packet was built fails the start (`VERSION_CONFLICT`).
3. **Locator.** Affected users, urgency, the current workaround, alternatives, gaps and the cross-field mechanism (or why none was found). If the packet has no current support for the problem the run stops here with `insufficient_evidence`.
4. **Independent proposals.** One per response type you list (software, existing tool, process change, human-led, hybrid). Every type is either proposed or excluded with your reason, and at least one non-software type is proposed. First proposals receive only the packet, their assignment and the locator's answer, never each other's; the result records that proof.
5. **Skeptic and revision.** The skeptic reviews every proposal; proposals asked to revise are revised up to `max_revisions` (0–2), then reviewed again. Objections that remain are kept as dissent.
6. **Dispositions and records.** Code, not the model, decides each disposition: duplicate of a catalog record, rejected, not recommended (for example software when an existing tool already covers the need), insufficient evidence or candidate. The run writes a problem record (derived from the brief, supported by the problem claims) and one alternative per proposal.

```powershell
pnpm cli seed-discovery
pnpm cli discovery-start <workspace> <run-id> '{"brief":{"id":"…","version":1},"evidence":[{"claim_id":"…","bears_on":["problem"]}],"perspectives":["software","existing_tool","process_change"],"excluded":[{"perspective":"human_led","reason":"…"},{"perspective":"hybrid","reason":"…"}],"max_revisions":1,"envelope_id":"…","pricing_snapshot_id":"…","data_class":"synthetic","limits":{…}}'
pnpm cli discovery <workspace> <workflow-id> --wait
pnpm cli discovery-packet <workspace> <workflow-id>
```

`seed-discovery` creates a fixture workspace and runs three scenarios: rural clinic no-shows (cross-field overbooking mechanism, a known duplicate in the catalog, one revision), food bank shifts (an existing tool wins and software is not recommended; two types excluded with reasons) and course e-books (evidence only from an inaccessible page, so nothing is proposed). Results appear in the web Workflow runs panel. Starting a discovery run has no web form yet.

**Fixture only.** In fixture workspaces the deterministic adapter answers discovery tasks with fixed rules over the packet; that shows the flow and the checks, not real reasoning. A real workspace needs the T04 live provider conditions. The locator does not search or fetch; it works from claims already recorded through T06.

## Scoring, selection and specs (T08)

Scores rank the candidates a discovery run produced; selection and freezing are admitted actions with a human decision under the supervised defaults.

1. **Scorecards.** A `scorecard` record rates one current alternative version against a versioned rubric (`opportunity-rubric/1.0` for software opportunity, `suitability-rubric/1.0` for every response type). Each criterion gets 1–5 with at least one claim or source reference and a rationale, or `null` for unknown. A card also records the reviewer, confidence, the ethics and access gates and the checks done (including which existing alternatives were checked and when). A card for an old alternative version is stale and is listed but not counted.
2. **Report.** `report` computes both rankings from the current cards: score = 100·Σw(r−1)/(4Σw) with equal weights, kept as an exact fraction and shown to one decimal. A candidate with any unknown rating has no score, only bounds (unknowns at 1 and at 5). Several reviewers are averaged and their differences listed; candidates whose ranges overlap are marked unresolved; ties share a rank. Sensitivity tries each weight removed and doubled and reports whether the shortlist changes. Ethics/access, the T07 disposition and the T03 humility review are gates beside the score, not part of it.
3. **Selection.** `select` names the report hash it was made on and gives every candidate a disposition (select for build, proceed to validation, recommend an alternative, research further, defer, reject) with reasons and what would reverse it. Code refuses a selection on a changed report, through a closed gate, or `select_for_build` for a non-code response. Advancing a candidate over a higher-ranked one needs an override reason; the original ranking is stored with it. The action `candidate.select` is admitted against the run policy (supervised: a human decision).
4. **Specification.** `spec-create` writes a `spec/1` specification for the alternative the current selection chose for build: audience, flows, scope, non-goals, data contracts, measurable acceptance checks, risks, maintenance and a task graph. Validation rejects cycles, unknown references, checks no task delivers and parallel tasks that own overlapping paths. `spec-freeze` is the admitted `spec.freeze` action; it records a hash per task. After `spec-revise`, `spec` shows which tasks are still frozen and which changed, and the earlier freeze no longer covers the changed ones.

```powershell
pnpm cli seed-selection
pnpm cli report <workspace> <problem-id>
pnpm cli select <workspace> <run-id> '{"problem":{"id":"…","version":1},"report_hash":"…","dispositions":[…],"override_reason":null,"rationale":"…","data_class":"synthetic"}'
pnpm cli spec <workspace> <spec-id>
```

`seed-selection` runs `seed-discovery`, scores the clinic no-show candidates with two fixture reviewers (one disagreement, one unknown rating), records a selection with one override after an owner approval, creates and freezes a specification and revises one task. The web Scoring and selection panel shows the result read-only.

**Fixture only.** Fixture reviewers are fixed data written to show the arithmetic, gates and overrides; they are not judgments. No model assessor role exists yet, and selecting does not move a product into a build stage.

## Studio interface (T09)

Open the web page (`pnpm dev`, or the API with `pnpm --filter @creator/web build` and `vite preview`) and sign in with the development link. Pick a workspace at the top; the address keeps the view, workspace, selected record and search, so refreshing or sharing the link returns to the same place.

- **Monitor**: decisions waiting for you, workflows in progress with Pause, Resume and Cancel, recently finished runs, record counts, product stages, spend (charged, in flight, held unknown, refused calls) and the latest activity. It refreshes itself while work runs. Closing the page stops nothing.
- **Submit a theme**: writes a versioned `search_brief`, attaches recorded claims with what each bears on, keeps or excludes each response type (an exclusion needs a reason), then registers a run (or reuses a free one) and starts a discovery run. The optional model permission is a 24-hour standing grant capped per call, revocable under Decisions.
- **Compare and decide**: one problem with its brief, claims, passages and their freshness, the run's assumptions, and every alternative side by side with scores, gates, humility review, discovery disposition and dissent. The selection form disables choices a gate blocks. Under supervised defaults the server asks for a decision first; approve it in Decisions and submit again.
- **Search**: words search record text, source passages, decision questions and activity; a full id or its first 8 characters finds that exact item. Filters narrow by result type, record kind and status. **Activity**: every audit event with who made it, filterable by action and paged.
- **Gallery** is reserved: nothing has been built, so it shows no preview or download.

```powershell
pnpm cli search <workspace> "no-show" [record,passage,decision,activity] [kind] [status]
pnpm cli activity <workspace> [words] [action-prefix]
pnpm cli overview <workspace>
pnpm cli compare <workspace> <problem-id>
pnpm cli lineage <workspace> <record-id> [upstream|downstream] [depth 1-8]
```

Browser acceptance check (needs Playwright with Chromium; not a project dependency): seed with `pnpm cli seed-selection`, serve the built page with `vite preview`, then run `node tracking/evidence/t09/browser-acceptance.mjs <playwright module> <chromium>` with `T09_WS`, `T09_PROBLEM`, `T09_RUN` and `CREATOR_DEV_LOGIN_CODE` set. It writes screenshots and a JSON result next to itself.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm format:check
pnpm smoke
```

`pnpm check` combines type checks, tests and formatting. Without `CREATOR_TEST_DATABASE_URL`, the PostgreSQL suites are reported as **skipped** with that reason. `pnpm test:db` refuses to start without it, so run it to exercise the storage gate:

```powershell
$env:CREATOR_TEST_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/postgres'
pnpm test:db
```

Each storage test creates, migrates and force-drops its own `creator_test_*` database, so the role needs `CREATEDB`. Point it at a local development server, never at a database whose contents matter. `pnpm format` formats only application/tooling/docs paths, preserving original kit documents. `pnpm smoke` builds and starts temporary API/Vite-preview servers, checks the built page and its API proxy, then closes them. Stop `pnpm dev` first, or choose unused ports. Unit/HTTP/CLI tests use ephemeral API ports and may run while the demo is open. Browser verification is recorded separately from HTTP smoke checks.

Restricted runners may require permission for dependency-cache symlinks and loopback sockets. A sandbox `EACCES` connecting to localhost is not a successful HTTP check. No credentials or broader access are a fallback.

## Configuration

Environment variables are read explicitly; no `.env` loader is installed.

| Variable                         | Default / accepted value                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CREATOR_HOST`                   | `127.0.0.1` only                                                                               |
| `CREATOR_API_PORT`               | `4310`; integer 1024–65535                                                                     |
| `CREATOR_WEB_PORT`               | `5173`; integer 1024–65535, different from API port                                            |
| `CREATOR_DEPLOYMENT_MODE`        | `local` only                                                                                   |
| `CREATOR_DATA_MODE`              | `fixture` only                                                                                 |
| `CREATOR_PROVIDER`               | `fixture` only                                                                                 |
| `CREATOR_LIVE_ENABLED`           | `false` only                                                                                   |
| `CREATOR_API_URL`                | CLI only; default `http://127.0.0.1:4310`; loopback HTTP origin without credentials/path/query |
| `CREATOR_DATABASE_URL`           | Unset (no persistence) or a loopback `postgresql://` URL; never logged                         |
| `CREATOR_OWNER_ACTOR_ID`         | UUID the local API acts as; default `00000000-0000-4000-8000-000000000001`                     |
| `CREATOR_LIVE_PROVIDER`          | `none` (default) or `openai`; live adapter only with `OPENAI_API_KEY`                          |
| `OPENAI_API_KEY`                 | API process only; never logged, stored or returned                                             |
| `CREATOR_OPENAI_MODEL`           | Live model id; default `gpt-6-astra`                                                           |
| `CREATOR_WORKER`                 | `on` (default) runs the workflow worker inside the API; `off` leaves it to `pnpm worker`       |
| `CREATOR_WORKER_POLL_MS`         | Worker poll interval; default `1000`                                                           |
| `CREATOR_SOURCE_FETCH`           | `off` (default) or `live`; live web fetching for real workspaces through the source broker     |
| `CREATOR_SOURCE_HOSTS`           | Comma-separated approved hosts (`example.org` or `*.example.org`); excerpts kept               |
| `CREATOR_SOURCE_HASH_ONLY_HOSTS` | Approved hosts whose text is not kept (hashes and offsets only)                                |
| `CREATOR_TEST_DATABASE_URL`      | Tests only; loopback server where the role may create databases                                |

For example, set `$env:CREATOR_API_PORT = '4311'` and `$env:CREATOR_WEB_PORT = '5174'` before `pnpm dev`. Set `$env:CREATOR_API_URL = 'http://127.0.0.1:4311'` in the CLI terminal. Invalid settings fail startup. `CREATOR_PROVIDER`/`CREATOR_LIVE_ENABLED` still describe the stateless T01 fixture route. Metered live calls go only through the broker under the T04 conditions above; provider status is recorded in `config/provider-availability.json`.

## Actual paths and boundaries

| Path                         | Responsibility                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/`    | Strict Zod schemas, inferred types, schema 1.0 and stable error codes                                                             |
| `packages/domain/src/`       | Pure admission prerequisites, delegation containment, version/evidence-bound transitions, result checks and deterministic fixture |
| `packages/db/src/`           | PostgreSQL migrations, schema gate, record/link repository, audit hash chain, outbox relay and history projection                 |
| `packages/broker/src/`       | Model/tool broker, deterministic fixture adapter and OpenAI Responses adapter                                                     |
| `packages/research/src/`     | Source broker, URL/network policy per hop, HTTP and fixture adapters, HTML passage extraction                                     |
| `packages/orchestrator/src/` | Workflow worker loop (leases, heartbeats, broker calls, fenced commits) and the standalone `pnpm worker` entry                    |
| `apps/api/src/`              | Node HTTP routes, configuration, size/Host/origin checks and errors                                                               |
| `apps/cli/src/`              | HTTP client and response validation                                                                                               |
| `apps/web/src/`              | React form, actual API health, explicit synthetic outcomes, accessible error/empty states                                         |
| `tests/src/`                 | Contract, domain, real HTTP and compiled CLI checks                                                                               |
| `scripts/`                   | Local combined startup and built-page proxy smoke                                                                                 |

GET `/api/health` reports fixture provider status plus `persistent` and `storage` (`postgresql`, `not_configured`, `unavailable`).

Record routes, all under `/api/workspaces`: `GET`/`POST /api/workspaces`; `GET`/`POST …/{ws}/entities` (`?kind=&status=`); `GET …/{ws}/entities/{id}` (current record, every version, incoming and outgoing links); `POST …/entities/{id}/revisions` (`expected_version`, `title`, `body`, `reason`, `corrects_version`); `POST …/entities/{id}/archive`; `POST …/entities/{id}/redact` (owner only); `GET …/entities/{id}/lineage?direction=upstream|downstream`; `POST …/{ws}/links` (`relation`, `from: {id, version}`, `to: {id, version}`, `rationale`); `POST …/links/{id}/retract`; `GET …/{ws}/history?subject=`. Optional headers: `Idempotency-Key` (replays one create/link, 409 if reused for a different request), `X-Correlation-Id` and `X-Causation-Id` (UUIDs recorded on audit events). Stale `expected_version` returns `409 VERSION_CONFLICT`; a link across workspaces returns `403 SCOPE_EXCEEDED`; unknown or non-member workspaces return 404.

The API acts as one configured local owner. There is **no authentication yet** (T03); the loopback Host/Origin checks are the only boundary. The repository still enforces membership and roles for every call, which tests exercise with several actors. POST `/api/fixture` accepts `{ "goal": "Synthetic task", "outcome": "use_existing" }`. Other outcomes: `build`, `change_process`, `human_led`, `hybrid`, `investigate`, `defer`, `decline`, `failed`.

POST `/api/validate` accepts `{ "kind": "task", "value": { ... } }`; kinds are `task`, `result`, `run_config`, `source`, `claim`, `alternative`, `assumption`, `decision`, `cost`, `link`, `assignment`. This checks structure, not authority or evidentiary truth. Errors return `{ "error": { "code", "message", "details" } }`. Requests are limited to 64 KiB and JSON content type. Unknown fields/schema versions fail.

The fixture uses deterministic IDs/hashes and a synthetic 2099 deadline, not an operating grant. Simulated lifecycle evidence has `fixture: true`; it never stands in for executed product tests. Same input produces the same result, fixture runs are not saved, and reload clears that view. Money serializes as integer decimal strings in nano-USD; unknown exposure remains a distinct tagged value.

Delegation checks a proposed complete sibling allocation, including exact aggregate cost/calls/tokens and scope containment. It does not schedule children or atomically reserve resources. Transition functions require trusted current state and trusted evidence supplied by the application; schemas do not authenticate actors or establish that a source/check is true. There is no endpoint accepting arbitrary lifecycle advancement. Persistence now exists (T02); authorization, budgets, orchestration and review remain T03–T05/T12 work. Product stage and run/task state are stored at their initial values and generic revisions cannot change them; only domain transitions will.

## Dependency sources

Consulted October 17, 2026; exact direct pins and transitive integrity are in the manifests/lockfile. Selected TypeScript 5.9.3 deliberately rather than the registry's newer major. Runtime dependencies: Zod 4.6.7, React/React DOM 19.3.1; Vite 8.3.4, Prettier 3.9.10 and types are build tooling.

- [pnpm workspaces](https://pnpm.io/workspaces) and [settings](https://pnpm.io/settings): explicit workspace dependencies and engine settings.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html): strict compile checks, plus unchecked-index and exact-optional checks in this project.
- [Zod API](https://zod.dev/api) and [basic parsing](https://zod.dev/basics): strict objects, refinements and safeParse.
- [Vite guide](https://vite.dev/guide/) and [server options](https://vite.dev/config/server-options): build, loopback host, strict ports and API proxy. Current Vite documents Node 20.19+ or 22.12+ compatibility; this project's tested baselines are narrower.
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot): browser mounting.
- [Node 22.21 test runner](https://nodejs.org/download/release/v22.21.0/docs/api/test.html) and [HTTP](https://nodejs.org/download/release/v22.21.0/docs/api/http.html): actual installed baseline APIs.
- [Prettier CLI](https://prettier.io/docs/cli): write/check formatting.

T02 adds `pg` 8.23.1 (node-postgres; runtime) and `@types/pg` 8.23.1. Consulted October 18, 2026: [node-postgres transactions](https://node-postgres.com/features/transactions) (every statement of a transaction on one checked-out client, never `pool.query`) and [pooling](https://node-postgres.com/features/pooling) (always release clients; handle idle-client `error` events). PostgreSQL features used (advisory locks, `FOR UPDATE SKIP LOCKED`, PL/pgSQL triggers, composite foreign keys, partial unique indexes) were verified by the executed test suite against PostgreSQL 16.15, not by a separate documentation review.

No provider SDK was added. No CI run, hosted deployment or real research capability is implied by local checks.

T06 adds `htmlparser2` 12.0.0 (published 2026-03-20 per the npm registry; runtime, in `packages/research`) for streaming HTML tokenizing without a DOM or script execution. Node's built-in `net.BlockList`, `dns.lookup` and `https.request` (connecting to the checked IP with the original host as TLS server name) provide the address checks.

## Isolated local products (T11)

See [the execution guide](ISOLATED_EXECUTION.md) for the reviewed WSL2 worker,
owner CLI commands, scoped patches, conflict preservation, leases and recovery.
This is conventional local execution of the reviewed Python template; model-driven
building and independent review/QA remain T12.
