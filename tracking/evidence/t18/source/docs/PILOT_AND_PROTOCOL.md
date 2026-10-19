# T14 pilot rehearsal and proposed final protocol

October 18, 2026. Status: pilot rehearsal executed; final protocol **proposed, not adopted**.
Nothing in this document is an empirical result.

## What was and was not run

| Part                                    | State                                                              | Why                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Arm A, autonomous, decision task        | Run on the fixture model                                           | Live dispatch is disabled (`config/provider-availability.json`); no verified model id or cap |
| Arm B, human-in-the-loop                | Run on the fixture model with one scripted fixed-gate intervention | No participant; the intervention is a labelled rehearsal entry                               |
| Arm C, human-only                       | Scripted submission, helper denials and a conventional text check  | No participant and no human-subjects determination                                           |
| Discovery pair (structured, open-ended) | Run on the fixture model                                           | Same reason as A                                                                             |
| Live AI pilot                           | Not run                                                            | RD6                                                                                          |
| Human pilot participation               | Not run                                                            | RD3, RD5                                                                                     |
| Reviewer calibration                    | Not run                                                            | RD4                                                                                          |

Pilot tasks (`pilot-autonomy/1`, `pilot-discovery/1`) are fictional, low-risk and listed as
excluded from final tasks. No final task has been chosen (RD8).

## How to reproduce

```text
CREATOR_DATABASE_URL=... pnpm pilot <output-dir>
```

This creates a new fixture workspace owned by the local owner, runs all five attempts through
the T10 study store, broker and workflow worker, and writes `pilot-package.json`,
`reviewer-packet.json` and `reviewer-key.private.json`. It exits non-zero if any check fails.
Ids and timestamps change per run; `reproducible_digest` covers manifests, outcomes,
classifications, calls, simulated spend, check results and the estimate. Two runs on one
database and one run on a fresh database produced the same digest
(`29141363...e35ef`). Evidence: tracking/evidence/t14.

## Instrumentation results

16 checks pass, 1 warns and 0 fail:

- **Metrics:** all 5 attempts end in a terminal state with observed wall time, within cap;
  every AI arm records calls and simulated spend; autonomous attempts record zero human
  minutes.
- **Intervention timing:** B's intervention is logged before finish with wait and active
  time inside the attempt. **Warn:** when a workflow finishes an assisted attempt, the finish
  event leaves human totals empty, so assisted effort must be summed from intervention rows
  (`intervention_active_minutes` in the export). Analysis should use that field.
- **Source validation:** every structured run (A, B, D-structured) ends with
  `insufficient_evidence` after one call, because packet snapshots are unverified and are
  correctly not treated as supporting evidence. This means the structured arm **cannot
  succeed** on the current packet format. RD9 asks whether final packets get sources through
  the verified T06 source broker.
- **Contamination:** the open-ended context has no rubric or structured role prompt; no
  other-arm output or grader sentinel appears in any context; each attempt has its own
  workspace; human-only has 0 admitted model reservations and 3 recorded helper denials.
- **Reviewer materials:** the blinded packet has no condition terms, attempt ids or
  workspace ids; the private key maps every code to one attempt. Failed attempts appear as
  "No submitted output" rather than being dropped.
- **Export:** both study exports re-export to identical hashes.

Every attempt is classified. All five outcomes are substantive (task outcomes such as
`insufficient_evidence` or `submitted`); none is an instrumentation failure. The classifier
treats a non-terminal attempt, an unknown provider outcome or a failure with no task outcome
as instrumentation, and those stay in the flow table.

## Feasibility estimate

Upper bounds only: every AI call at its full 2,000-token output cap with the observed maximum
input (1,288 tokens), priced at the documented gpt-6-astra Standard rate ($10 / $50 per 1M
tokens, unverified for the account); human time at the full cap (60 min decision, 90 min
implementation); 15 reviewer minutes per item as an assumption until calibration measures it.

| Design            | Tasks (decision + impl.) | Discovery runs | Assigned runs | Max AI exposure | Participant hours | Reviewer hours   |
| ----------------- | ------------------------ | -------------- | ------------- | --------------- | ----------------- | ---------------- |
| minimal           | 2 + 1                    | 2              | 11            | $6.32           | 7                 | 2.8 (1 reviewer) |
| proposed          | 4 + 2                    | 8              | 26            | $15.80          | 14                | 13 (2 reviewers) |
| historical-12-run | 4 + 2                    | 12             | 30            | $18.96          | 14                | 15 (2 reviewers) |

Participant hours assume one person does both B and C on every task. AI cost is unlikely to
be the constraint; participant and reviewer time are.

## Proposed final protocol

The full proposal is `PROPOSED_PROTOCOL` in packages/domain/src/pilot.ts (hash
`f160ccd1...eb95d`), also returned by `pnpm cli protocol-proposal <workspace>`. In short:

- **Questions:** RQ1 (three arms) primary; RQ2 (discovery) a smaller secondary study.
- **Primary outcomes:** mean independent anchored quality rating per decision task;
  frozen and held-out acceptance cases passed for implementation tasks.
- **Strata and counts:** 4 decision + 2 implementation tasks × 3 arms, 2 discovery themes × 2
  repeats, plus the six humility challenge cases. Pilot tasks excluded.
- **People:** single-participant case study (Jordan) with matched task variants; two
  independent blinded reviewers; rubric calibration on non-study examples.
- **Limits:** 7 calls, 2,000 output tokens per call, no retries, 3 candidates per AI run;
  60/90 minute caps; one run at a time; total live cap unset until RD6.
- **Missing data and stops:** every assigned run stays in its condition; autonomous
  `needs_human` may get a linked assisted continuation outside the primary A outcome; one
  retry only for an infrastructure failure before any output.
- **Analysis:** paired task-level differences per stratum, descriptive, bootstrap over tasks
  only where justified; weighted kappa or Krippendorff's alpha plus raw disagreements; cost
  per accepted outcome including failures.
- **Limitations:** one participant, small counts, one provider model, fixture-only pilot,
  assumed reviewer time.

## Blocking research decisions

The protocol is not frozen. Each needs an owner (and where noted, committee) answer:

| Id                    | Decision                                                               | Recommended                            |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| RD1-priority          | Is RQ1 primary and RQ2 secondary?                                      | Yes                                    |
| RD2-primary-outcome   | Confirm the two primary outcomes                                       | Confirm                                |
| RD3-participants      | Who does human-only and assisted work; how is familiarity handled?     | Jordan, case study, matched variants   |
| RD4-reviewers         | Who rates, how many, blinded?                                          | Two independent blinded reviewers      |
| RD5-human-subjects    | Committee/IRB determination for participants and reviewers             | Obtain and record it                   |
| RD6-model-and-cap     | Verified model id and total live cap for T15                           | gpt-6-astra once verified, with a cap  |
| RD7-design-counts     | Which design and caps                                                  | proposed                               |
| RD8-final-tasks       | Final domains and tasks, chosen without looking at pilot performance   | Owner picks low-risk NAE-derived tasks |
| RD9-source-snapshots  | Verify packet sources through the source broker before freezing?       | Yes                                    |
| RD10-retry-and-search | One infrastructure retry; avoid search AI summaries in human-only work | Adopt both                             |

## Freezing

When the decisions are made, the owner writes `decisions.json`:

```json
{
  "proposal_hash": "<from protocol-proposal>",
  "decisions": [{ "id": "RD1-priority", "choice": "...", "rationale": "..." }]
}
```

and runs `pnpm cli protocol-freeze <workspace> decisions.json freeze.json` while signed in.
The API freezes only the server's own proposal, only for the signed-in human workspace
owner, only when the hash matches and every decision has a non-deferred answer. The freeze
manifest and its hash are written to the hash-chained audit log (`study.protocol_frozen`).
A missing or "pending" answer returns 409 with the list of open decision ids. If a decision
changes the proposal (for example a different design), the proposal is edited first, which
changes its hash, and the decisions are recorded against the new hash.
