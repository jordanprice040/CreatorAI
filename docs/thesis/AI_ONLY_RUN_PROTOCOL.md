# Thesis AI-only run: frozen protocol (v1)

Frozen November 19, 2026, before any run of any kind ([ADR-0133](../../tracking/DECISIONS.md)).
Owner scope decision: Jordan, November 19, 2026: an engineering thesis built on executed evidence,
plus one small, frozen, autonomous-only run on held-out tasks, reported as the AI arm alone.

This document fixes the tasks, held-out checks, success criteria, budget, route, model, schedule,
outcome coding and analysis of one small autonomous-only run **before any result exists**. It
authorizes nothing: the live run needs Jordan's typed OK in the thread that runs it, on his PC.
Nothing here is an empirical result.

The freeze is held by [`config/thesis-ai-run/PROTOCOL.json`](../../config/thesis-ai-run/PROTOCOL.json),
which names the SHA-256 of this file, of the analysis script and of every task's `FREEZE.json`.
`node scripts/ai-run-analysis.mjs verify` fails when any of these changes, or when any file a
task's `FREEZE.json` names (spec, expectations, cases, reference, scorer code) changes or a file is
added to a task folder; a test runs it. The anchor is
the SHA-256 of `PROTOCOL.json` itself, recorded in ADR-0133 with the commit that froze it. A change
after the freeze is a new protocol version (v2) with its reason, never an edit, and any run made
under v1 stays reported under v1.

## 1. What this run is, and what it is not

**It is** the AI arm (condition A of [the evaluation protocol](../../context/EVALUATION_PROTOCOL.md))
on the **implementation stratum only**: Creator Agent's bounded build path (builder, independent
reviewer, QA in the isolation worker, repair rounds) receives a frozen task specification and
works with **no human help after Start**. Six held-out tasks, written new for this run, are each
run once. Success is decided only by automated checks fixed in advance.

**It is not** a comparison. There is no human-in-the-loop or human-only arm, so no result of this
run may be stated as better, worse, faster or cheaper than people, or as an answer to RQ1. It does
not measure discovery, selection, or the decision-task stratum (those need independent human
ratings, which the thesis timeline does not allow), and it does not measure humility or
escalation behaviour. RQ1 to RQ3 stay unanswered in the thesis; this run adds one descriptive
measurement of the autonomous build stage.

Why only the build stage: in Creator Agent a software option always stops for a person at the
spec (ADR-0092, ADR-0099), and the study store refuses autopilots and live AI dispatch for study
runs. The specification is therefore given, exactly as the protocol gives every arm the same
frozen task packet. "Autonomous" here means: from a frozen spec to a verified, packaged program
with no person in the loop.

## 2. Relation to the earlier research decisions

The accepted October 20 direction ([RD1 to RD10](../../tracking/OWNER_DECISIONS_2026-10-20.md))
was written for the full three-arm study, which is not being run. For this run:

| Decision                          | How it applies here                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RD1, RD2 (questions and outcomes) | RD2's implementation outcome (frozen and held-out acceptance results) is this run's primary outcome. No RQ is answered                                                                                             |
| RD3 to RD5 (people)               | No participants and no human raters are involved. No committee or IRB ruling is claimed; whether any review applies is for the committee, which should be told what the thesis evaluation now is                   |
| RD6 (model and cap)               | Preferred model GPT-6 Astra; the $20 T15 cap is untouched because the route is the ChatGPT plan connection ($0 metered). See section 5                                                                             |
| RD7 (counts)                      | Replaced for this run by 6 implementation tasks, 1 attempt each (section 3)                                                                                                                                        |
| RD8 (final tasks)                 | Not NAE-derived: these are synthetic, low-risk CLI tasks written new for this run (section 3). Jordan approves them by approving the pull request that freezes them, before any run                                |
| RD9 (source snapshots)            | Not applicable: the tasks use no sources                                                                                                                                                                           |
| RD10 (retry)                      | Kept: an infrastructure fault before a verdict may be replaced once (the harness rule), and a task may be started once more after a record that reached no verdict (section 7). Every failure stays in the results |

## 3. Tasks

Six `python-build/1` tasks under `config/recipe-benchmarks/`, written new on November 19, 2026 for
this run and not copies of any earlier benchmark. Each folder holds `spec.json` (the spec content
exactly as the studio stores it), `expectations.json` (caps, pass bars, known failures),
`extended-cases.json`, a `reference/` solution that no role ever sees, and `FREEZE.json`.

| Order | Task                | Scale  | What it builds                                                                          | Studio cases (held out) | Extended held-out cases | Known failures caught |
| ----- | ------------------- | ------ | --------------------------------------------------------------------------------------- | ----------------------- | ----------------------- | --------------------- |
| 1     | `ai-run-loans-v1`   | larger | Library loans desk: lend, return, reserve, fines, holds; text or JSON (package `loans`) | 12 (7)                  | 23 + structure check    | 11                    |
| 2     | `ai-run-tickets-v1` | larger | Support ticket SLA checker in business minutes (package `sla`)                          | 12 (8)                  | 23 + structure check    | 12                    |
| 3     | `ai-run-fares-v1`   | larger | Transit fares with transfers, concessions, daily and weekly caps (package `fares`)      | 12 (8)                  | 24 + structure check    | 11                    |
| 4     | `ai-run-shifts-v1`  | small  | Shift coverage gaps in one day (one file)                                               | 13 (9)                  | 17                      | 8                     |
| 5     | `ai-run-grades-v1`  | small  | Weighted gradebook with exact half-up rounding (one file)                               | 14 (10)                 | 18                      | 9                     |
| 6     | `ai-run-recipe-v1`  | small  | Recipe scaler with exact fractions and unit conversion (one file)                       | 13 (9)                  | 18                      | 8                     |

The order is fixed by a mechanical rule, not chosen: ascending SHA-256 of the task id. Each attempt
is independent (no role keeps memory between builds), so order matters only for scheduling.

**How they were made.** The tasks, specs, cases and references were written by the coding agent
(Claude, in this project's cloud thread) on November 19. Every expected output was produced by
the reference solution and checked by hand against the spec text. For each task, a list of
plausible mistakes (59 in all) was written down, each as an exact edit of the reference, and a
test proves that every one of them fails at least one named case. The same test runs every
reference against all its cases with `python3 -I`, and the structure bar passes each larger
reference.

**Difficulty was chosen knowing earlier results.** GPT-6 Astra on this route has passed earlier
small, larger and extra-large build benchmarks 3 of 3 each (November 6 and 17; the November 6
passes were under the earlier builder/1 prompt). Not every earlier result on this route was a
pass: on November 6 the larger `p14-larger-ledgercheck-v2` ended 0 of 3 (the studio then refused
the package's `__init__.py` path) and its v3 re-cut failed (the reviewer packet was over the
connection's then 24,000-character input cap). Both causes were on the studio side and were fixed
afterwards (`tracking/evidence/p14-benchmarks/`). These tasks were deliberately
set at the small and larger scales those benchmarks cover, with rules that are stated but easy to
miss (exact rounding, boundaries, ordering, precedence of refusals). They were not tuned against
any model output: no model has seen them. A high completion rate is the expected result, and the
thesis says so, together with the earlier failures.

**Held-out discipline.** Held-out studio cases run in QA but are never shown to the builder or the
reviewer (the studio's rule). Extended cases are never entered into the studio; they run only on
the exported package after the build. Runtime roles never see this repository. A coding agent
that edits the studio could see these files, which is why no coding agent may change the build
roles, the prompts or these folders between the freeze and the end of the run (section 8).

## 4. Pass bars (success criteria)

A task is **completed** when its single attempt meets every frozen pass bar in its
`expectations.json`, checked by the studio itself:

1. The build reaches `verified_candidate`: QA passes every frozen studio case, held-out ones
   included, in the isolation worker, and the independent reviewer approves with no findings.
2. Requests used are at most the task's `max_calls` (6 small, 8 larger).
3. The exported package is verified: every frozen case re-run on the extracted archive in the
   isolation worker.
4. Every extended case passes on the exported package, with exact output and exit status.
5. Larger tasks only: the package structure check (`packages/executor/src/recipe-structure.ts`)
   passes for the named package and modules.

Caps per attempt: small `max_repairs` 2, `max_calls` 6, 8,000 output tokens, 1-hour deadline;
larger `max_repairs` 2, `max_calls` 8, 16,000 output tokens, 2-hour deadline; 120 s per request;
synthetic data; the plan route's answer form `invoke_lines_then_json_fence` (ADR-0115), as for
`p14-xl-v1`.

## 5. Route, model and budget

- **Where:** the dev studio on Jordan's PC (worktree `C:\dev\creator_agent_mainrun`, database
  `creator_studio`), upgraded to a main commit that contains this freeze. Never the installed
  app's data. The WSL2 isolation worker.
- **How:** Models › the ChatGPT plan connection › **Qualify building**, one task at a time. The
  studio's qualification harness runs the attempt (ADR-0105): its own product store, no catalog
  run, selection or spec, the frozen caps, the current builder and reviewer prompts. A record with
  `attempts_needed` 1 is the task's result; "qualified" means completed. These records lift no
  build label (the tasks are not in `RECIPE_BENCHMARKS`).
- **Model:** `gpt-6-astra`, the identifier the studio recorded for this connection in the
  November 17 qualifications. The run uses the same identifier for all six tasks. If the
  connection no longer offers it, or the studio records another model, the run stops and the
  protocol is revised; there is no substitute model. No other model detail is claimed.
- **Role prompts:** the builder and reviewer prompts current at the freeze, whose SHA-256 values
  `PROTOCOL.json` names (the same pair the November 17 `p14-xl-v1` record ran on). Every record must
  carry exactly these; a studio whose prompts differ cannot run v1.
- **Prerequisite:** GPT-6 Astra must be qualified as builder and reviewer under those prompts
  (Start refuses otherwise). If a requalification is needed, it is run
  first, on the existing qualification benchmarks, and is reported as setup, not as a result.
  If it fails, the run is not executed and the thesis says so.
- **Budget:** $0 metered. The plan route makes no budget reservation; the $20 T15 cap and the $20
  studio ceiling are untouched, and no metered route, API key or fallback may be used. The $0
  holds only while the ChatGPT account cannot buy usage beyond the plan, so plan credits and
  extra usage must be confirmed off before the run (section 6, step 3); if they are on, the run
  does not start. Requests: one record is at most 2 x `max_calls` including one replaced attempt
  (12 small, 16 larger), 84 for the six tasks; with the one allowed restart per task the worst
  case is 168 plan requests, spread over days by the daily cap. Typical use is about 2 per task.
  The connection's input cap must be at least 60,000 characters (Start enforces it); its daily
  cap is 100 and per-run cap 30 (qualification requests belong to no run). A task is started only
  when the connection has at least that task's maximum left today; otherwise it waits for the
  next day.

## 6. Procedure

1. Jordan gives a typed OK for this run in the thread that runs it. Nothing starts without it.
2. Back up `creator_studio`, upgrade the dev studio to the freezing commit (or later main, if
   `node scripts/ai-run-analysis.mjs verify` still passes there and Qualify building shows the
   frozen role-prompt hashes), and run `verify`. Record the commit, schema and verify output.
3. Check the connection: verified, build roles and synthetic data allowed, input cap at least
   60,000, no request with an unknown outcome, no other request running. Confirm on the ChatGPT
   account that plan credits and extra usage are off, and record how it was checked and when; if
   they are on or cannot be confirmed, stop. Record the connection id and the window opening
   (the time the freeze merged into main, from `git log -1 --format=%cI` on that merge commit).
   Do not use the connection for anything else until the run ends.
4. For each task in the order of section 3: Start with model `gpt-6-astra`, wait for the record
   to finish, save its JSON (the record the studio returns) as `recipe-qualification-<id>.json`.
   Do not stop a running attempt except for an outside emergency, which is a deviation.
5. After the sixth record, read the plan requests and budget reservations made since the run
   started from the database (as in the p14-xl evidence) and save them.
6. Save every record of the six task benchmarks the studio holds, not a selection, and run
   `node scripts/ai-run-analysis.mjs analyze <dir> --opened <window opening> --connection <id>`
   (and again with `--markdown`). Commit the records, the step 2 and 3 notes and both outputs to
   `tracking/evidence/thesis-ai-run-<date>/`.

Nobody starts these six benchmarks except in this run, on any studio or connection (they appear
under Qualify building everywhere, the installed app included). A record made anyway is reported
as a deviation, never as a result.

Window: from the merge of this freeze into main until the end of **November 27, 2026** anywhere
on Earth (UTC-12, so 2026-11-28 11:59:59 UTC). Tasks with no record started in the window are
`not_run`, and the thesis reports the run as incomplete with those tasks named.

## 7. Outcome coding (frozen; implemented in `scripts/ai-run-analysis.mjs`)

Records of the six tasks started outside the window or on a connection other than the recorded
run connection are not part of the run: each is reported as a deviation and not scored. The
remaining records are checked. A record for another benchmark, on a fixture connection, not run in
the app, with a different freeze hash, more than one attempt, a missing input cap or one under
60,000, another model, role prompts other than the frozen pair (or two pairs across the run), or
still running is a protocol problem, and nothing is scored until it is resolved.

Per task, records are taken in start order and only the first two count: the first start and the
one allowed restart. A record is **decided** when one of its attempts passed or failed (a verdict
on the roles' work). The first decided record among those two is the task's result:

- `completed`: the record is qualified (its one attempt met every bar).
- `not_completed`: it is not qualified. The first failed bar and the build reason are reported.
- `no_verdict`: records exist but none was decided (each stopped on an infrastructure fault).
- `not_run`: no record.

A record without a verdict may be followed by one restart of that task. A third record (a second
restart), or any record started after the decided one, is a deviation: it is reported and ignored
for the outcome, even if it passed. A failed attempt is never re-run to replace it.

**Primary outcome:** the number of the six tasks `completed`, with the small and larger counts
beside it. `no_verdict` and `not_run` count as not completed (every assigned task stays in the
denominator); a count over decided tasks only may be shown beside it, labelled as such.

**Secondary (descriptive):** per task the outcome, first failed bar, requests, repair rounds,
wall time and extended cases passed; in total the requests, repair rounds, build minutes, plan
requests and dollars from the database, and extended held-out cases passed over all packages.

## 8. Analysis and what the thesis may claim

Descriptive only. Six tasks are not a sample from any population, so no significance test,
interval or general success rate is reported. Repeated or extra attempts are not added, and no
task is dropped after the results.

The thesis may say, with the counts filled in: "On six build tasks written and frozen before any
run, Creator Agent's autonomous build path on the ChatGPT plan route with GPT-6 Astra completed k
of 6 (s of 3 small, l of 3 larger), using R plan requests and $0 metered, judged only by
automated checks that included held-out cases." It must also say: the tasks were written by one
author (an AI coding agent) at difficulty levels where this route had passed before; one attempt
per task; one model and route; the reviewer is a model; nothing about people, discovery, or
comparison is measured.

It may not claim that the system builds software reliably in general, that it outperforms or
matches people, or anything about usefulness to real users.

Between the freeze and the end of the run, no change may be made to the build roles, their
prompts, the qualification harness, the scorer, these task folders or the analysis script. If
one is unavoidable (for example a studio defect that blocks every attempt), the run stops, the
change and its reason are recorded, and a v2 protocol is frozen before continuing; v1 records
stay reported.

## 9. Threats to validity

- **One author, one model family writing the tasks.** The task author is a Claude model; the
  builder and reviewer are GPT-6 Astra. Ambiguities in a spec would hurt the model under test;
  the hand check and known-failure tests reduce but do not remove this.
- **Known difficulty.** Tasks sit at scales the route has passed; this measures whether that holds
  on new tasks, not where the limit is.
- **Single attempts.** Model output varies between runs; one attempt per task gives no per-task
  reliability estimate.
- **Model reviewer.** Pass bar 1 includes a model reviewer's approval, so a correct program can
  still fail on a reviewer finding. That is reported as such (first failed bar).
- **Provider drift.** The plan route's model can change without notice; the record's model id and
  dates are what the thesis cites.
- **Synthetic tasks.** Small, deterministic, standard-library CLIs, far from real products.
