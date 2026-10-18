# T16 analysis pipeline

October 18, 2026. Status: **pipeline built and verified on labelled synthetic fixtures;
empirical analysis blocked.** No final evaluation has run, so there are no real ratings or
outcomes to analyze. Nothing in this document or in tracking/evidence/t16 is a study finding.

## What it does

`pnpm analyze` reads the folder a T15 evaluation run writes, after the reviewers have filled
in their `ratings.csv` files, and writes standalone tables and figures. It needs no database,
network or model. All logic is in `packages/domain/src/analysis.ts`; file handling is in
`packages/orchestrator/src/analysis-files.ts`.

| Output          | Contents                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `analysis.json` | Every table, the plan, the options, the input file hashes, gaps, limitations, reconciliation checks and an `analysis_hash` over all of it.                                                 |
| `report.md`     | The same tables in Markdown with the data label at the top and bottom, a source line per table, and separate sections for exploratory tables, not-measured outcomes, gaps and limitations. |
| `tables/*.csv`  | One CSV per table. The first column, `data_label`, repeats the label on every row so a copied file still says what it is.                                                                  |
| `figures/*.svg` | Decision quality by task and arm, task-level paired differences, and spend (known plus unknown exposure). Each figure has the label in a banner.                                           |

### Tables

- **Completion** by comparison, stratum and arm. Every assigned slot is in the denominator,
  including blocked, deferred, failed, cancelled, needs_human and budget_exhausted ones.
  Attempts, retries and infrastructure failures are counted separately.
- **Decision quality** per reviewed slot: each reviewer's mean of the five rubric dimensions
  when all five are present, then the mean over those reviewers. Partial and blank rows are
  reported as such and never imputed. The five dimension means stay visible.
- **Functional completion** for the implementation stratum: executed frozen cases (held-out
  included) passed by the last attempt, with the execution backend of each case.
- **Paired comparisons** per task (B-A, C-A, C-B) for each stratum, and the discovery
  comparison per theme (repeats averaged within the theme first). Each pair with a missing
  side is listed with the reason and excluded. Summaries are range, median and sign counts.
  A percentile bootstrap over tasks is computed only when there are at least 10 pairs; below
  that the table says it was not computed. No p-values and no power.
- **Resources**: calls, known spend, unknown and in-flight exposure in exact nano-USD and USD,
  over every attempt (failures and retries included). Cost per accepted outcome is undefined
  with zero accepted outcomes, undefined without an acceptance rule, and marked a lower bound
  when billing is incomplete. Total spend stays visible in all cases.
- **Human effort and latency**: participant-reported human minutes and waits, intervention
  minutes, and server-observed wall time of the last attempt, with missing counts.
- **Interventions**: the recorded intervention fields (type, gate, prevented problem, minutes).
- **Evidence validity**: verified and unverified sources from the source-support audits.
- **Reviewer agreement**: quadratic-weighted kappa per dimension when there are exactly two
  reviewers, plus every disagreement of two points or more.
- **Deviations**: recorded deviation events, and every blocked or deferred slot with its reason.
- **Exploratory**: per-protocol completion (slots that ran), kept apart from the prespecified
  tables.

Decision quality, functional completion, potential benefit and observed user impact stay
separate. The last two are not measured by the current study contracts and are reported as
not measured.

### Checks

The command exits non-zero when any check fails.

- Every scheduled slot appears once, and every slot falls in exactly one group.
- Every attempt is in one slot and in exactly one raw export; the flow's spend, exposure and
  calls equal the export's for each attempt.
- Spend totals reconcile three ways (group sum, flow sum, export sum) so a join that repeats an
  attempt cannot inflate them.
- Every rating code is in the private key, maps to the last attempt of its slot, and is rated
  once per reviewer. Ratings other than blank or 1-5 are refused.
- Participant codes, actor ids, familiarity notes and the blinding secret do not appear in any
  output.
- Two analyses of the same files hash identically.
- No table, figure or report uses inferential or superiority wording.

### Whether a result is empirical

The inputs decide, not a flag. Output is labelled `final_records` only when the package is a
`final` run under an `adopted` freeze, there is at least one raw export and none is synthetic,
and there is no `FIXTURE.json` marker. Anything else is labelled not empirical.

## Exact inputs needed to run it on real results

Run `pnpm evaluate final <workspace-id> <tasks.json> <dir>` (T15) after the freeze and the
final runs exist, have the reviewers fill in their files, then point `pnpm analyze` at `<dir>`.

| Path inside `<dir>`               | Written by                  | Needed for                                                                                                                                                   |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evaluation-package.json`         | `pnpm evaluate final` (T15) | Schedule, flow table with every attempt and its measurements, functional checks, source audits                                                               |
| `private/assignment-key.json`     | `pnpm evaluate final`       | Maps each reviewer code to its slot and attempt                                                                                                              |
| `private/raw-exports/<task>.json` | `pnpm evaluate final`       | Per-attempt measurements for reconciliation, interventions, deviations, participant ids (for counting only)                                                  |
| `reviewers/<name>/ratings.csv`    | Each reviewer, by hand      | Decision-stratum quality. Keep the header; blank means not rated; values are integers 1-5                                                                    |
| `analysis-options.json`           | Jordan (optional)           | Decision acceptance rule: `{"decision_min_mean_rating": 3.5, "basis": "<freeze decision ref>"}`; omit and cost per accepted decision outcome stays undefined |

Before the real run, these decisions are still open and change what the tables mean:

1. **Protocol freeze (RD1-RD10).** The primary outcomes (RD2), reviewers (RD4) and counts
   (RD7) must be adopted; the analysis plan in `ANALYSIS_PLAN` (domain/src/analysis.ts) is an
   implementation default to adopt or replace in the freeze.
2. **Decision acceptance rule.** No owner decision defines an accepted decision outcome yet.
3. **Reviewer ratings** from the people chosen under RD4, returned in the packet's
   `ratings.csv` format.
4. **Real, non-synthetic study records** with a verified model (RD6) and the WSL2 gate for
   study builds.
5. **Owner coding of intervention necessity** (necessary, missed, unnecessary) has no field in
   the current contracts; adding one is a separate change.

## Commands (PowerShell)

```powershell
pnpm analyze .\eval-final .\analysis-final
pnpm analyze fixtures .\analysis-fixtures
```

Write the output outside the evaluation folder; the command refuses to write inside it so
`private/` and `reviewers/` stay untouched. The output contains no participant metadata, but
it is still study material: share it only after your own review.

## Verification fixtures

`pnpm analyze fixtures <dir>` writes three labelled synthetic scenarios in the real file
layout and analyzes each from disk. The committed copy is in tracking/evidence/t16/fixtures.

| Scenario        | Covers                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mixed`         | Blank and partial ratings, a failed and a blocked run, a retry after an infrastructure failure, unknown billing, discovery repeats, one participant across human arms, interventions, a deviation |
| `zero-accepted` | No accepted outcome in any arm (needs_human, budget_exhausted, cancelled, failed, a build failing a held-out case)                                                                                |
| `all-blocked`   | Today's final-plan shape: every slot blocked, no attempts, no ratings, no exports                                                                                                                 |

tests/src/analysis.test.ts checks hand-computed values on these fixtures (slot quality,
pair differences, cost per accepted outcome, lower-bound billing, denominators), the
reconciliation and privacy checks under tampering, kappa and bootstrap values, label coverage
of every output file, and, with PostgreSQL, that a real T15 rehearsal package and its raw
exports pass every check unchanged.
