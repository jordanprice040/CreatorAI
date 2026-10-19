# Context packs, caching, compaction and batches (X02)

X02 decides what a model call is shown, reuses earlier work where that is safe, and
meters everything it costs. Every model call still goes through the T04 broker
(admission, reservation, settlement). Nothing here can grant authority: a cached
answer, a handoff or a compacted pack is context, never permission.

Status: implemented and verified in fixture workspaces only. No live call was made and
nothing was spent. gpt-6-astra's prompt caching, batch and compaction features are
recorded as `documented` (from the official pages, retrieved October 19, 2026), so a
real workspace refuses to use them until they are verified. Savings are never claimed
from fixture runs.

## Pieces

| Piece        | Where                                                                 | What it does                                                                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Index        | `context_index_entries` (per workspace, corpus and key)               | Incremental: an unchanged item is not rewritten; a changed one gets a new version and hash; removed items are marked `removed`. Corpora are code, notes, sources, or workspace records (`indexRecords`, keyed `kind:id`).                                                                                             |
| Context pack | `context_packs` (immutable)                                           | A task-specific selection under a token budget. Authority (the run's live grants, derived by the application), then pinned constraints, acceptance criteria and objections, then ranked items. Each item keeps its source, version, hash and locator; every exclusion has a reason (`token_budget`, `not_relevant`…). |
| Compaction   | `context_compactions` (immutable)                                     | `extractive` (deterministic sentence selection, no call), `model` (one metered summarize call) or `provider` (capability-checked). Every result must keep each pin verbatim and every required fact, or it is rejected.                                                                                               |
| Handoff      | `context_handoffs` (immutable)                                        | A summary from one task for the next, carrying the pack's pins and required facts. Reused only while its source entries are unchanged; otherwise excluded as `handoff_stale`.                                                                                                                                         |
| Result cache | `context_cache_entries`, `context_events`                             | Stores the answer of a settled, succeeded read-only call, keyed by scope and version. A hit is served only after admission allows the action again.                                                                                                                                                                   |
| Capabilities | `config/context/provider-capabilities*.json` → `context_capabilities` | Per model and feature (`prompt_caching`, `batch`, `provider_compaction`): `fixture`, `documented`, `verified` or `unsupported`, with source and evidence. Batch entries name their own batch price.                                                                                                                   |
| Batch        | `context_batches`, `context_batch_items`                              | Noninteractive requests. Every item is admitted and reserved before submission (all or nothing); results settle per item; missing results stay unknown until a late result or reconciliation.                                                                                                                         |
| Evaluation   | `context_evaluations`                                                 | Baseline pack against candidate pack on the same questions with checks fixed before results. Reports accepted rate, call cost, overhead (compaction) and total cost per accepted answer.                                                                                                                              |
| Usage        | `GET …/context-usage`                                                 | Provider prompt-cache tokens, result-cache hits and avoided cost, compaction overhead, batch item outcomes, evaluations; each figure lists the reservation or operation ids it came from.                                                                                                                             |

## Rules the code enforces

- **Required context survives.** Pins (constraint, objection, acceptance criterion) and
  the application's authority item are rendered first and must come back verbatim from
  any compaction. Required facts must appear in the pack and in any compaction result.
  A pin that is missing, removed or above the pack's data class refuses the pack, as
  does a required fact that is not in the selection or pins that do not fit the budget.
  Agents cannot pin `authority`; the authority item is derived from active grants.
- **Two caches, kept apart.** Provider prompt caching is a provider billing feature:
  the stable prefix (preamble plus authority and pins) is rendered first and identically,
  and the usage the provider reports (cached and cache-write tokens) is priced by the
  snapshot. The result cache is the application's: it skips a call entirely.
- **Cache keys** cover workspace, project, data class, action, tool, provider and model,
  pricing hash, rendered input hash, pack hash, output format and limit, and policy
  version. Another workspace or project never sees an entry.
- **Freshness.** Each entry records its dependencies (the pack's index entries and any
  declared extra ones, with their hashes and record versions). A changed or removed
  dependency invalidates the entry for everyone; a caller's `max_age_seconds` only
  stops that caller from using an older entry. An answer built on a pack whose sources
  have already changed is not stored.
- **No stored permission.** Only metered read-only actions can be cached (the contract
  rejects anything else, so an external mutation can never be cached). Each hit runs
  admission again under the run's current grants and state; a revoked grant, a stopped
  run or human-only mode refuses the hit. Study runs never read the cache.
- **Results are bound to requests.** Compaction and evaluation results are read from
  the broker's own reservations and accepted only when the recorded request hash equals
  the request the store rebuilds; a caller cannot supply results.
- **Provider compaction** is refused unless the capability is usable here, and refused
  as `output_unverifiable` when the provider's output is opaque (OpenAI documents its
  compaction item as encrypted) while pins or required facts must survive.
- **Batches.** The model needs a usable `batch` capability, the request must use the
  batch price that capability names, items are bounded (32), and an operation id cannot
  be reused. Reservations are held for the completion window. A per-item request error
  or a documented expiry releases that item (not charged); anything uncertain stays
  `unknown`. A later poll settles a held item as late, exactly once.
- **Quality and total cost.** An evaluation counts accepted answers by fixed checks and
  adds the compaction calls that produced the candidate pack to its cost. A quality drop
  beyond `max_regression` reports `not_claimed_quality_drop` whatever the cost; savings
  are `measured` only in a real workspace with fully known costs.

## Commands (PowerShell, from the repository root, API running)

```powershell
$ws = '<workspace-id>'
pnpm cli context-capabilities-add $ws config/context/provider-capabilities.fixture.json
pnpm cli pricing-add $ws config/pricing/fixture-context-v1.json
pnpm cli context-index $ws repo code synthetic C:\path\to\folder
pnpm cli context-index-records $ws records synthetic problem,claim,source
pnpm cli context-pack $ws pack-request.json
pnpm cli context-compact $ws <pack-id> compact-request.json
pnpm cli context-call $ws call-request.json
pnpm cli context-batch $ws batch-request.json
pnpm cli context-batch-poll $ws <batch-id>
pnpm cli context-eval-create $ws evaluation-request.json
pnpm cli context-eval-run $ws <evaluation-id>
pnpm cli context-usage $ws <run-id>
```

`context-index` skips `node_modules`, `.git`, `dist`, `build`, `coverage` and `.env*`
files, splits files over 12,000 characters into chunks, sends the folder in requests
under the API's 64 KiB limit, and removes keys that are no longer in the folder.

## Fixture models

`fixture-context-v1` simulates provider prompt caching (a repeated leading pair of
messages of 256+ tokens is read as cached input) and fixture batches
(`config/pricing/fixture-context-v1-batch.json`, half the synchronous fixture rates).
`fixture-lossy-v1` has a compactor that drops required facts, so the survival check
can be shown rejecting it. Their rates are simulated units, not money.

## Not done

- No live call: the OpenAI batch adapter is checked only against a loopback contract
  test, and gpt-6-astra stays `documented` until Jordan authorizes a verification call.
- No adapter performs provider-side compaction; with OpenAI's opaque output it would
  be refused anyway whenever pins or facts must survive.
- Workflow, study and builder paths still build their own frozen context; packs and
  caching are opt-in per call. No web UI.
- Representative quality is shown on a small synthetic question set, not on real tasks.
