# T15 final evaluation and blinded rating package

October 18, 2026. Status: **machinery, study-record gate and builder link built and rehearsed;
final evaluation not run.** The protocol is not frozen (RD1-RD10 in
docs/PILOT_AND_PROTOCOL.md are unanswered), so no final run exists. Nothing here is an
empirical result.

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
The output folder must be new or empty: `private/assignment-key.json` is the only copy of the
blinding key, so `pnpm evaluate` refuses a used folder instead of overwriting it.

## Rehearsal result

Labelled stand-in freeze (not an owner decision), 8 synthetic tasks in the frozen counts
(4 decision, 2 implementation, 2 discovery themes x 2 repeats), 26 slots, run one at a time
through the real study store, broker and workflow worker. Fixture AI; human entries scripted
and labelled `scripted_rehearsal`. 10 of 10 checks pass. States: 8 submitted, 12 failed (all
structured AI runs end `insufficient_evidence` on unverified packet sources, as in T14), 1
scripted cancellation, 1 deferral, 4 blocked (AI implementation slots, below). The fixture
open-ended output contains "Fixture", which the scan flags; a live model's output would need
the same owner review. Evidence: tracking/evidence/t15.

## Study records, the builder link and the T15 budget

`config/evaluation.json` keeps the owner's choices and the open items in one reviewed file:
model preference `gpt-6-astra` (verified id: none), live dispatch off, the **$20.00 total T15
cap** (`20000000000` nano-USD, no spend authorized), and participants (RD3), reviewers (RD4),
human-subjects review (RD5) and final-task selection (RD8) marked `unresolved`. The file
cannot decide anything; the gates below accept only answers recorded in the adopted freeze.

| Path                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final record gate    | A study with `synthetic: false` is created only in a real workspace, bound to the hash of the adopted freeze, with governance items whose choices equal the owner's freeze answers, the preserved `gpt-6-astra` preference with a verified id equal to the config and the study model, and the $20 ledger cap. Otherwise it is refused with every unmet condition listed. Final attempts get real-mode workspaces and no model grant; AI execution refuses with `LIVE_DISABLED`. Human-only work records normally. |
| Budget ledger        | Every governed study holds an attempt's whole frozen cap before any model work. Open attempts count at their cap; finished ones at settled cost plus in-flight or unknown reservations. Final records share one `t15-final` ledger capped at $20; synthetic ones use a per-workspace ledger. Refusals are durable `budget_refused` events.                                                                                                                                                                         |
| Implementation tasks | A study binds a frozen build task by spec id, version and hash, freeze id, task hash and the current humility review; all are re-read from the owner's records. Each attempt gets a pinned copy of the spec (same content hash) and review in its own workspace.                                                                                                                                                                                                                                                   |
| AI arms (A, B)       | `POST study-attempts/<id>/build` prepares the build plan from the frozen cases; `pnpm cli study-build <ws> <attempt>` runs the T12 builder in a fresh per-attempt product through the attempt's own admission, grant and broker; the server re-reads the local build record and writes build, code-artifact (file hashes), per-case test and finish events. Held-out cases appear only as key and pass/fail. A build after cancellation is kept as evidence, never submitted.                                      |
| Human-only arm (C)   | No builder or model path (`HUMAN_ONLY_DENIED`, recorded). `pnpm cli study-code <ws> <attempt> <files.json>` commits the participant's files to a per-attempt product and the server runs every frozen case, held-out included, in the product worker.                                                                                                                                                                                                                                                              |

Every case result names its execution backend. Only cases run in the reviewed WSL2 worker
count as isolation evidence; the labelled test double never does.

## Why the final evaluation cannot run yet

`pnpm evaluate final` refuses without an adopted freeze and lists RD1-RD10. With a freeze it
records the schedule and every slot is `blocked`, with the open items from
config/evaluation.json as reasons:

1. **Protocol freeze** (RD1-RD10). RD5 needs a committee/IRB ruling.
2. **Participants (RD3), reviewers (RD4), human-subjects review (RD5) and final tasks (RD8)**
   are unresolved. Final records are refused until the freeze answers them.
3. **Model (RD6).** No verified API model id for `gpt-6-astra`, and live dispatch is
   disabled. No spend is authorized against the $20 cap.
4. **Final build tasks.** Each final implementation task must be frozen as a spec with
   held-out cases and bound to its study before its A and B slots can run.
5. **Source snapshots (RD9)** still decide whether structured runs can verify packet sources.

## Commands for the new paths (PowerShell)

```powershell
$env:CREATOR_DATABASE_URL = "postgres://..."
pnpm db:migrate
pnpm cli study-build <workspace-id> <attempt-id>
pnpm cli study-code <workspace-id> <attempt-id> .\files.json
```

`files.json` is `{"files":[{"path":"src/main.py","content":"..."}]}`. Both commands use the
local product store (`.creator/products`) and, for real cases, the WSL2 worker.
