# Search, lineage and audit questions (X03)

X03 widens the T09 search, adds saved queries, a metered semantic stage, natural-language
audit questions and bounded lineage graphs with exports that can be re-checked. Every
read checks workspace membership before it touches content, so a non-member (or a
member who was removed) gets `NOT_FOUND` and learns no snippet, count or total.

Status: implemented and verified in fixture workspaces only. No live call was made and
nothing was spent. No real embedding model is verified, so real workspaces refuse
semantic search (lexical search and questions work everywhere). The fixture embedding is
hashed character trigrams: it exercises metering, ranking and access checks but has no
understanding of meaning, and no relevance claim is made from it.

## Pieces

| Piece           | Where                                                        | What it does                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lexical search  | `GET …/search`                                               | Records, source passages, decisions and activity (T09), plus `code_version` (artifact commits and manifests), `model` (models called, with exact totals) and `cost` (broker reservations with amounts). Filters: kind, status, `from`/`to` local dates read in `tz`. Each hit carries `occurred_local` with its UTC offset.   |
| Coverage        | `coverage`, `freshness` in every search result               | Per type: how many items are searchable, how many are excluded (redacted, passages without text, unsupported or oversized media), and the newest change. `freshness.activity_pending` counts audit events not yet in the activity history.                                                                                    |
| Saved queries   | `saved_queries` (migration 14)                               | A named search or rules-compiled question. The body is a request, never query text; it is validated again and run with the caller's current access each time. Only archiving changes a saved query.                                                                                                                           |
| Semantic search | `POST …/semantic-search`                                     | First an access-safe lexical stage (text matches, then recent readable items; never redacted text), then one metered `model.embed` broker call per text and cosine ranking. Embedding models allowed per workspace mode live in `config/search/semantic-models.json`. A repeated `operation_id` replays without paying again. |
| Audit questions | `POST …/audit-questions`                                     | The question compiles into one plan from a closed list (`source_to_product`, `lineage`, `run_cost`, `subject_cost`, `decisions`, `activity`, `redactions`, `model_usage`) with typed parameters. Compiler `rules` is local and free; compiler `model` is one metered call whose JSON must pass the same strict schema.        |
| Plans           | `POST …/audit-plans`                                         | Runs a plan given directly (for example one copied from an earlier answer) under the same schema and transaction.                                                                                                                                                                                                             |
| Lineage graph   | `GET …/entities/:id/lineage-graph`                           | Nodes and active links upstream, downstream or both, bounded by depth (1–8) and node count (≤ 500), with `truncated` flags. Redacted records are tombstones (no title); sources show whether their latest retrieval had readable media.                                                                                       |
| Export / verify | `GET …/entities/:id/lineage-export`, `POST …/lineage-verify` | An export is the graph plus the SHA-256 of its canonical JSON. Verification re-checks the hash, then every node and link against the workspace now: missing, version changed, redacted since (and whether the export still holds the redacted title), retracted or missing links.                                             |
| Membership      | `POST …/members`, `POST …/members/:actor/remove`             | Owners add and remove members; removal is audited (`member.removed`), and the last owner cannot be removed.                                                                                                                                                                                                                   |

## Rules the code enforces

- **Never model SQL.** A plan is a JSON object with an `intent` from the closed list and
  typed parameters (ids or id prefixes, exact titles, local dates, a zone name, limits).
  The strict schema refuses any other key, so a plan carrying `sql` or an unknown intent
  is rejected before anything runs. Each intent has fixed SQL in `SearchStore`; plan
  values are bound parameters only.
- **Read-only, bounded.** Plans run in a transaction set `read only` with a 5-second
  statement timeout, after the membership check. PostgreSQL itself refuses a write there
  (error 25006); the acceptance test proves it. Row limits are at most 200.
- **Permissions before snippets and aggregation.** Search, coverage, freshness, semantic
  candidates, questions, lineage, exports and verification all check membership first.
  Embedding is spending: a viewer may search and ask, but only editors and owners can
  start metered calls (the broker's reservation requires write access).
- **Redaction holds everywhere.** Redaction removes a record's title and body (T02), so
  text search cannot match it; semantic candidates skip redacted records and passages;
  titles in questions match only readable records; lineage and question answers show
  redacted records as tombstones (id, kind, version, hash) without titles; a lineage
  export made before a redaction is flagged `contains_redacted_text` on verification so
  that copy can be destroyed.
- **Shared expenses count once.** Cost answers sum `budget_reservations` directly over a
  distinct set of runs. A subject's runs are those `part_of` it or its descendants, plus
  the runs that froze specs for its verified builds. When several subjects share a run,
  each subject's row includes it, the combined total counts its charges once, and
  `shared_runs` says how many runs were shared. Unknown (held) charges are reported
  separately; fixture amounts are simulated units, never money.
- **Time zones.** `from`/`to` are calendar days in the asker's zone (validated by the
  runtime and by PostgreSQL); phrases such as "today" or "last 7 days" are read in that
  zone. Stored times stay UTC.

## Commands

```powershell
pnpm cli search <workspace> "roster" record,cost,model --tz America/New_York --from 2026-10-01
pnpm cli ask <workspace> "Which sources does product ""Roster with reminders"" come from?" America/New_York
pnpm cli ask <workspace> "How much did run 1a2b3c4d cost?"
pnpm cli ask <workspace> "What did products ""A"" and ""B"" cost together?"
pnpm cli ask-model <workspace> question.json
pnpm cli audit-plan <workspace> plan.json
pnpm cli search-semantic <workspace> semantic.json
pnpm cli saved-query-save <workspace> "Roster records" search search.json
pnpm cli saved-query-run <workspace> <saved-query-id>
pnpm cli lineage-graph <workspace> <id> both 4 100
pnpm cli lineage-export <workspace> <id> lineage.json both
pnpm cli lineage-verify <workspace> lineage.json
pnpm cli member-remove <workspace> <actor-id> Study ended
```

In Windows PowerShell 5, a double quote inside a double-quoted argument is written `""`.
`lineage-export` refuses to overwrite an existing file.

Questions the rules compiler understands (ids may be the first 8+ characters; titles go
in double quotes):

- Which sources does product "Name" come from? / Which products use source 1a2b3c4d?
- Show the upstream (or downstream) lineage of idea "Name".
- How much did run 1a2b3c4d cost? / What did products "A" and "B" cost together?
- Which decisions are pending for run 1a2b3c4d?
- Who changed product 1a2b3c4d in the last 7 days? (today, yesterday, since, before,
  on, between … and … also work)
- What was redacted since 2026-10-01?
- Model usage for fixture-model-v1 last 30 days.

Anything else is answered `unsupported` with these examples; an ambiguous or unknown
name is answered `needs_subject` with readable candidates.

## Limits

- Verified only in fixture workspaces (cloud Linux, PostgreSQL 16). No real embedding
  model, no live compile call, no relevance or quality claim for semantic ranking.
- Embeddings are not stored: each semantic search pays for its candidates again (a
  replay of the same `operation_id` does not). There is no vector index, so the pool is
  at most 40 candidates.
- Access is workspace-level (owner, editor, viewer). There is no per-record access
  control inside a workspace, so "permissions before snippets" means membership first.
- The web page shows the new search types, amounts and coverage, but saved queries,
  questions, semantic search and lineage graphs are API and CLI only.
- The rules compiler is pattern-based and English-only; the model compiler is wired and
  metered but verified only with the fixture model.
- Lineage export verification checks the workspace as it is now; it cannot prove what
  the workspace looked like at export time beyond the export's own hash.
