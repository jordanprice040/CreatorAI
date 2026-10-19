# Creator Agent analysis

> **VERIFICATION FIXTURE: synthetic data, not empirical**

Data kind: `synthetic_verification_fixture`. Empirical: no. Analysis hash `0f2ae193a3681301415cfbb54f96ed02925fdda10171591ee41cab9f640ec90b`. Plan `analysis-plan/1` (Implementation default, not an owner decision; adopt or replace it in the protocol freeze.)

## Inputs (raw-data references)

- `FIXTURE.json` sha256 `d025836606b1f6af218630efdb42d69a5b7cf312c7eb9f88171ce6703b124e21`
- `analysis-options.json` sha256 `541368469369b8e6136937b07ed5a035b882442ad06378a39593e8eb0b39ae6c`
- `evaluation-package.json` sha256 `5c8ce1b114f20ede15d3f502bca449f01f0768723e8f0f0fce9293bd3df15f85`
- `private/assignment-key.json` sha256 `89b522af498c24643a9dae42b718ae0c9fbbbb5357e496cbf1616ce7b7e709ff`
- `private/raw-exports/d1.json` sha256 `abc8e510f56995a8dc9a7ca2fefe3ac5915c2f0c34a09c869a16e0052797768c`
- `private/raw-exports/d2.json` sha256 `6897dd05ec708fcc0c97a122211f648af832ff866f6efaaa9fbcd69b9c9a36f8`
- `private/raw-exports/i1.json` sha256 `bdccd0c9e21d4018f29a983a89e20a144e5fe4cedae920064bfced3030819f0c`
- `private/raw-exports/t1.json` sha256 `20060c0c0b44fd9bbce620cdd24dde06b5ce95c6023787f38d2279ba08c55e7a`
- `reviewers/reviewer-1/ratings.csv` sha256 `ee146953c4e337ef17c172499d20183e363b950f2c329bcf55436a5f2cd426c3`
- `reviewers/reviewer-2/ratings.csv` sha256 `4628497b97fd8ac3ff1073cc708d79e3e73e8638924d14cf4fa7f4f030971438`

Package `bd936ccb37077f4ebcc2e0f485666ca2f93d8ab43be3fcaaa7f87baa27079d70`, schedule `56aadc714ed6c70f5ac9ceb51f6d798ca0f88a1675405c3826f15aa9a9497401`, freeze origin `rehearsal`.

## Totals

| assigned_slots | attempts | unscheduled_attempts | known_spend_usd | known_spend_unscheduled_usd | unknown_exposure_usd | in_flight_exposure_usd | accepted.implementation | accepted.decision | distinct_human_participants | reviewers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | 13 | 0 | 0.025000000 | 0.000000000 | 0.002500000 | 0.000000000 | 1 | 7 | 1 | 2 |

## Prespecified tables

### Completion by assigned condition

Source: flow (evaluation-package.json). CSV: `tables/completion.csv`.

| comparison | stratum | arm | assigned | blocked | deferred | missing | ran | submitted | failed | cancelled | needs_human | budget_exhausted | attempts | retries | infrastructure_failures | completion | completion_share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 2 | 0 | 0 | 0 | 2 | 1 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1/2 | 0.5 |
| autonomy | decision | B | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | 3 | 1 | 1 | 2/2 | 1 |
| autonomy | decision | C | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 2/2 | 1 |
| autonomy | implementation | A | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | B | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1/1 | 1 |
| autonomy | implementation | C | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1/1 | 1 |
| discovery | decision | D-open | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 2/2 | 1 |
| discovery | decision | D-structured | 2 | 0 | 0 | 0 | 2 | 1 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1/2 | 0.5 |

### Decision quality per reviewed slot

Source: reviewers/*/ratings.csv via private/assignment-key.json. CSV: `tables/decision-quality.csv`.

| slot_id | attempt_id | task_key | arm | repeat | slot_state | reviewer_status.reviewer-1 | reviewer_status.reviewer-2 | complete_reviewers | quality | dimension_means.usefulness | dimension_means.feasibility | dimension_means.evidence_support | dimension_means.differentiation | dimension_means.appropriateness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f14a0f6b0f55117877ff8b6dcbc86ee2d9f0d2d7a1b764778589482aa0ec840a | 00000000-0000-4000-8000-000000000001 | d1 | A | 1 | submitted | complete | complete | 2 | 3.5 | 3.5 | 3.5 | 3.5 | 3.5 | 3.5 |
| 30af55f6e72f31fc8fe0ecbe531cae9a34158a22a14be27fae5f483b2aa3a41b | 00000000-0000-4000-8000-000000000002 | d1 | B | 1 | submitted | complete | complete | 2 | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 |
| fdb69e509003b22fe514b1db6f4071746455b51ddf09025673cbd20d81e4f126 | 00000000-0000-4000-8000-000000000003 | d1 | C | 1 | submitted | complete | complete | 2 | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 |
| 377ccb8c12b412b9ddbdb9e350a82fcab1ae1586781632f4adab3d82277d38ca | 00000000-0000-4000-8000-000000000004 | d2 | A | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| b5901f680480e06ea23bcce9dff8e4c58422c5b1b913b10eb328ce086efefd80 | 00000000-0000-4000-8000-000000000006 | d2 | B | 1 | submitted | complete | complete | 2 | 3.7 | 3.5 | 4 | 3.5 | 4 | 3.5 |
| 4f7f32a22e30824f4fdc04b9b162dd19be0d018852b9edf5002175b854c4cc60 | 00000000-0000-4000-8000-000000000007 | d2 | C | 1 | submitted | complete | partial | 1 | 3 | 3.5 | 3.5 | 3 | 3.5 | 3.5 |
| 685b02e43c9061539b6733b66adfa8f8c915d118ff31cfbb03efa47b264d1911 | 00000000-0000-4000-8000-00000000000b | t1 | D-open | 1 | submitted | complete | complete | 2 | 4 | 4 | 4 | 4 | 4 | 4 |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | 00000000-0000-4000-8000-00000000000d | t1 | D-open | 2 | submitted | complete | complete | 2 | 3 | 3 | 3 | 3 | 3 | 3 |
| 396921964830e826528e82f68f32743df81c9a4abec46228db864bf7484a9342 | 00000000-0000-4000-8000-00000000000a | t1 | D-structured | 1 | submitted | complete | complete | 2 | 3 | 3 | 3 | 3 | 3 | 3 |
| e20f086c92431a351966c7ce560611870a28d2fe448635abfcaa1b987d1815de | 00000000-0000-4000-8000-00000000000c | t1 | D-structured | 2 | failed | blank | blank | 0 |   |   |   |   |   |   |

### Functional completion (implementation stratum)

Source: functional_checks (evaluation-package.json). CSV: `tables/functional-completion.csv`.

| slot_id | task_key | arm | slot_state | cases | passed | held_out_cases | held_out_passed | pass_share | backends | accepted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 470395d0f588aae6e85e1beb1589f316bde93400b0b61d011db15b414377221e | i1 | A | blocked | 0 | 0 | 0 | 0 |   |   | false |
| e1ba5d9b664fcec839721e9d791d75d56dfe71ba03a2ce8b957639ec1f06119f | i1 | B | submitted | 3 | 3 | 1 | 1 | 1 | labelled-fixture | true |
| 2b97649954da992b34e4b601956224abd4081dfde74c93b155a28e715f252207 | i1 | C | submitted | 3 | 2 | 1 | 0 | 0.6667 | labelled-fixture | false |

### Task-level paired comparisons

Source: decision-quality and functional-completion tables. CSV: `tables/paired-comparisons.csv`.

| stratum | contrast | task_key | x | y | difference | excluded |
| --- | --- | --- | --- | --- | --- | --- |
| decision | B - A | d1 | 4.5 | 3.5 | 1 |   |
| decision | B - A | d2 | 3.7 |   |   | A failed, no value |
| decision | C - A | d1 | 2.5 | 3.5 | -1 |   |
| decision | C - A | d2 | 3 |   |   | A failed, no value |
| decision | C - B | d1 | 2.5 | 4.5 | -2 |   |
| decision | C - B | d2 | 3 | 3.7 | -0.7 |   |
| implementation | B - A | i1 | 1 |   |   | A blocked, no value |
| implementation | C - A | i1 | 0.6667 |   |   | A blocked, no value |
| implementation | C - B | i1 | 0.6667 | 1 | -0.3333 |   |

### Paired comparison summaries

Source: paired-comparisons table. CSV: `tables/paired-summaries.csv`.

| stratum | outcome | contrast | tasks | n_pairs | min | median | max | positive | zero | negative | interval | interval_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| decision | mean reviewer quality (1-5) | B - A | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |   | Not computed: 1 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - A | 2 | 1 | -1 | -1 | -1 | 0 | 0 | 1 |   | Not computed: 1 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - B | 2 | 2 | -2 | -1.35 | -0.7 | 0 | 0 | 2 |   | Not computed: 2 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | B - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - B | 1 | 1 | -0.3333 | -0.3333 | -0.3333 | 0 | 0 | 1 |   | Not computed: 1 task pair(s), below the plan minimum of 10. Report the range, not an interval. |

### Discovery comparison per theme

Source: decision-quality table. CSV: `tables/discovery-comparison.csv`.

| task_key | structured_mean | structured_repeats_rated | open_mean | open_repeats_rated | difference_open_minus_structured |
| --- | --- | --- | --- | --- | --- |
| t1 | 3 | 1/2 | 3.5 | 2/2 | 0.5 |

### Resources and cost per accepted outcome

Source: attempt measurements (flow, reconciled with private/raw-exports). CSV: `tables/resources.csv`.

| comparison | stratum | arm | attempts | calls | provider_retries | known_spend_nano_usd | known_spend_usd | unknown_exposure_usd | in_flight_exposure_usd | billing | accepted | cost_per_accepted_usd | cost_per_accepted_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 2 | 6 | 0 | 6000000 | 0.006000000 | 0.000000000 | 0.000000000 | complete | 1 | 0.006000000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| autonomy | decision | B | 3 | 6 | 0 | 6500000 | 0.006500000 | 0.000000000 | 0.000000000 | complete | 2 | 0.003250000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| autonomy | decision | C | 2 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 1 | 0.000000000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| autonomy | implementation | A | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | B | 1 | 3 | 0 | 6000000 | 0.006000000 | 0.000000000 | 0.000000000 | complete | 1 | 0.006000000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| autonomy | implementation | C | 1 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| discovery | decision | D-open | 2 | 6 | 0 | 4000000 | 0.004000000 | 0.000000000 | 0.000000000 | complete | 2 | 0.002000000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| discovery | decision | D-structured | 2 | 6 | 0 | 2500000 | 0.002500000 | 0.002500000 | 0.000000000 | incomplete: unknown or in-flight | 1 | 0.002500000 | Lower bound: some billing is unknown or still in flight. |

### Human effort and latency

Source: attempt measurements. CSV: `tables/human-effort-latency.csv`.

| comparison | stratum | arm | human_active_minutes | intervention_active_minutes | human_wait_seconds | human_time_missing | wall_seconds_median | wall_seconds_min | wall_seconds_max | wall_seconds_n | wall_seconds_missing | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0 | 0 | 250 | 200 | 300 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | B | 22 | 8 | 90 | 0 | 950 | 900 | 1000 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | C | 90 | 0 | 0 | 0 | 2700 | 2400 | 3000 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | A | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | B | 15 | 0 | 0 | 0 | 1800 | 1800 | 1800 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | C | 80 | 0 | 0 | 0 | 4800 | 4800 | 4800 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-open | 0 | 0 | 0 | 0 | 525 | 500 | 550 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-structured | 0 | 0 | 0 | 0 | 425 | 400 | 450 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |

### Interventions (assisted arm)

Source: raw_events kind interventions (private/raw-exports). CSV: `tables/interventions.csv`.

| comparison | stratum | arm | interventions | clarification | judgment | authorization | feedback | fixed_gate | dynamic_gate | prevented_problem_yes | prevented_problem_no | prevented_problem_unknown | active_minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | B | 2 | 1 | 1 | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 8 |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Evidence validity (source support audits)

Source: source_support_audits (evaluation-package.json). CSV: `tables/evidence-validity.csv`.

| comparison | stratum | arm | audited_attempts | sources | verified | unverified | attempts_with_unverified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 2 | 2 | 0 | 2 | 2 |
| autonomy | decision | B | 3 | 4 | 1 | 3 | 3 |
| autonomy | implementation | B | 1 | 1 | 0 | 1 | 1 |
| discovery | decision | D-open | 2 | 2 | 0 | 2 | 2 |
| discovery | decision | D-structured | 2 | 2 | 0 | 2 | 2 |

### Reviewer agreement

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-agreement.csv`.

| dimension | items_rated_by_both | weighted_kappa | kappa_note |
| --- | --- | --- | --- |
| usefulness | 8 | 0.3077 | Quadratic weights, 1-5 scale. |
| feasibility | 8 | 0.3469 | Quadratic weights, 1-5 scale. |
| evidence_support | 7 | 0.3333 | Quadratic weights, 1-5 scale. |
| differentiation | 8 | 0.3469 | Quadratic weights, 1-5 scale. |
| appropriateness | 8 | 0.3077 | Quadratic weights, 1-5 scale. |

### Reviewer disagreements of two points or more

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-disagreements.csv`.

| slot_id | task_key | arm | dimension | reviewer-1 | reviewer-2 |
| --- | --- | --- | --- | --- | --- |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | t1 | D-open | usefulness | 2 | 4 |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | t1 | D-open | feasibility | 2 | 4 |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | t1 | D-open | evidence_support | 2 | 4 |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | t1 | D-open | differentiation | 2 | 4 |
| 7f024654d7f867d23f53040142c68832e5fcda4adeb31ca75067b1a396323843 | t1 | D-open | appropriateness | 2 | 4 |

### Deviations and slots that did not run

Source: raw_events kind deviations; flow reasons. CSV: `tables/deviations.csv`.

| source | slot_id | task_key | arm | reason | impact |
| --- | --- | --- | --- | --- | --- |
| recorded deviation | fdb69e509003b22fe514b1db6f4071746455b51ddf09025673cbd20d81e4f126 | d1 | C | Fixture: a search page showed an AI summary. | Fixture deviation; recorded, not excluded. |
| slot blocked | 470395d0f588aae6e85e1beb1589f316bde93400b0b61d011db15b414377221e | i1 | A | Fixture: no frozen build task bound for the AI builder. | No outcome; kept in the assigned denominator. |

## Exploratory (not prespecified)

### EXPLORATORY: per-protocol completion

Source: flow. CSV: `tables/per-protocol-completion.csv`.

| comparison | stratum | arm | ran_without_only_infrastructure_failure | submitted | completion |
| --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 2 | 1 | 1/2 |
| autonomy | decision | B | 2 | 2 | 2/2 |
| autonomy | decision | C | 2 | 2 | 2/2 |
| autonomy | implementation | A | 0 | 0 | 0/0 |
| autonomy | implementation | B | 1 | 1 | 1/1 |
| autonomy | implementation | C | 1 | 1 | 1/1 |
| discovery | decision | D-open | 2 | 2 | 2/2 |
| discovery | decision | D-structured | 2 | 1 | 1/2 |

## Not measured

- Potential benefit: not measured by the current study contracts.
- Observed user impact: not measured by the current study contracts.

## Gaps

- Not empirical (synthetic_verification_fixture): no table here is a study finding.
- 3 reviewed item(s) lack complete ratings from every reviewer; no rating is imputed.
- Some billing is unknown or in flight: spend totals are lower bounds.
- 1 slot(s) blocked; they stay in the assigned denominators.
- Potential benefit and observed user impact are not measured by the current study contracts; they are reported as not measured, never inferred from quality ratings.
- Intervention necessity (necessary, missed, unnecessary) needs owner coding that the current contracts do not record; only the recorded intervention fields are summarised.

## Limitations

- 1 distinct human participant: human-arm results describe one person's repeated work, not human work in general, and repeated observations from that person are not independent.
- 3 autonomy task(s) and 1 discovery theme(s): no power calculation and no general comparative claim.
- One provider model serves every AI role, so its errors may be correlated across arms.
- Ideas inside one run are rated together as one item and are not counted as separate observations.

## Reconciliation checks

- PASS `slots.match_schedule`: 13 flow rows for 13 scheduled slots, each once.
- PASS `slots.groups_partition`: Every slot is counted in exactly one comparison/stratum/arm group.
- PASS `attempts.unique`: 13 attempts in the flow, none in two slots.
- PASS `attempts.in_one_export`: Every flow attempt appears in exactly one raw export, once.
- PASS `attempts.measurements_match_export`: Flow measurements equal the raw export for every attempt (spend, exposure, calls).
- PASS `spend.totals_reconcile`: Group sum 0.025000000 = flow sum 0.025000000; plus unscheduled 0.000000000 = export sum 0.025000000 USD.
- PASS `ratings.codes_valid`: 20 rating rows from 2 reviewer(s), each code known, mapped to a slot's last attempt and rated once per reviewer.
- PASS `functional.bound_to_flow`: 6 functional checks each bind an attempt of their slot.
- PASS `export.kind_consistent`: 4 export(s), 4 synthetic; data kind synthetic_verification_fixture.
- PASS `privacy.no_participant_metadata`: None of 4 private participant or key values appears in the output.

## Figures

- figures/decision-quality.svg
- figures/paired-differences.svg
- figures/resources.svg

> **VERIFICATION FIXTURE: synthetic data, not empirical**
