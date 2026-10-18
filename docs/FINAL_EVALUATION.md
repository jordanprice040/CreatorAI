# T15 final evaluation and blinded rating package

October 18, 2026. Status: **machinery built and rehearsed; final evaluation not run.** The
protocol is not frozen (RD1-RD10 in docs/PILOT_AND_PROTOCOL.md are unanswered), so no final
run exists. Nothing here is an empirical result.

## What exists

| Part                     | Where                                           | What it does                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule                 | `buildSchedule` in domain/src/evaluation.ts     | Derives every run slot from the freeze and the owner's final tasks: 3 arms per autonomy task, the structured/open pair per discovery theme and repeat. Refuses wrong counts, reused pilot packets and a stale or tampered freeze.                  |
| Admission                | `admitSlot`                                     | Deterministic: each slot is admitted or `blocked` with reasons. Final runs never use the fixture model or scripted people.                                                                                                                         |
| Run ledger               | `flowTable`, `retryPermitted`                   | Every slot appears once as blocked, deferred, missing or its attempt states; retries (RD10: one, only for an infrastructure failure before any output) keep the failed attempt.                                                                    |
| Blinded reviewer packets | `blindedPackets`, `scanBlinding`                | One packet per reviewer, identical template, per-reviewer random order, codes from a secret kept only in the private key. Filename/template/id leaks fail; condition-like words inside a submission are flagged for owner review, never rewritten. |
| Runner                   | orchestrator/src/evaluation.ts, `pnpm evaluate` | `rehearsal` runs the schedule on synthetic tasks; `final` binds the adopted freeze and tasks into the audit log.                                                                                                                                   |

Source-support audits, executed functional checks and model self-ratings are separate
sections of the package. Self-ratings are never used as ratings.

## Commands (PowerShell)

```powershell
$env:CREATOR_DATABASE_URL = "postgres://..."
pnpm evaluate rehearsal .\eval-rehearsal
pnpm evaluate final <workspace-id> .\final-tasks.json .\eval-final
```

The output folder holds `evaluation-package.json`, `reviewers/reviewer-N/` (README, items,
`ratings.csv`) and `private/` (assignment key, raw study exports). Only `reviewers/` is ever
meant for reviewers, and only after the owner checks the flags. Nothing is sent anywhere.

## Rehearsal result

Labelled stand-in freeze (not an owner decision), 8 synthetic tasks in the frozen counts
(4 decision, 2 implementation, 2 discovery themes x 2 repeats), 26 slots, run one at a time
through the real study store, broker and workflow worker. Fixture AI; human entries scripted
and labelled `scripted_rehearsal`. 10 of 10 checks pass. States: 8 submitted, 12 failed (all
structured AI runs end `insufficient_evidence` on unverified packet sources, as in T14), 1
scripted cancellation, 1 deferral, 4 blocked (AI implementation slots, below). The fixture
open-ended output contains "Fixture", which the scan flags; a live model's output would need
the same owner review. Evidence: tracking/evidence/t15.

## Why the final evaluation cannot run yet

`pnpm evaluate final` refuses without an adopted freeze and lists RD1-RD10. With a freeze it
records the schedule and every slot is `blocked`, for these reasons:

1. **Protocol freeze** (RD1-RD10). RD5 needs a committee/IRB ruling.
2. **Final study records.** Study records are synthetic-only (`synthetic: true`), so no run
   can be recorded as real participant or final AI work. Building them depends on RD3
   (participants), RD5 (human-subjects), RD6 (model and cap) and RD9 (verified sources), so
   it waits for those answers.
3. **Live AI** (RD6). Live dispatch is disabled and no model id is verified
   (config/provider-availability.json).
4. **AI implementation runs.** The study path refuses AI implementation work outside the
   isolated T11/T12 worker. Connecting the builder to studies is needed before the
   implementation stratum's A and B arms can run.
5. **Reviewers** (RD4) are unnamed; packets are labelled reviewer-1 and reviewer-2.
