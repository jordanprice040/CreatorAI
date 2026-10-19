# Creator Agent analysis

> **VERIFICATION FIXTURE: synthetic data, not empirical**

Data kind: `synthetic_verification_fixture`. Empirical: no. Analysis hash `9e8dec07b1ff063a09b6935ffb06b9c63ed05be9161b2259dad294a2cb1b8fbc`. Plan `analysis-plan/1` (Implementation default, not an owner decision; adopt or replace it in the protocol freeze.)

## Inputs (raw-data references)

- `FIXTURE.json` sha256 `a1000b3138940112fb46e0003285212a7df6b614ac40f7885c07d2729718baa4`
- `evaluation-package.json` sha256 `06c217d137c33d0d96286532e04aa406494e639c6ba5275376dd537c49a60e15`
- `private/assignment-key.json` sha256 `d4eb20ec98dc0eececda591f52d23feff8ac9c4f2e4c4fc557f4bc94a0db0303`

Package `316c4fdb9c513b8604776e54b0a6d3511a6590621fcc67d11dd942c864e4cce1`, schedule `e9be2ef4e303e4ebab2089b5d0903ca3e063534e01f8a61bb84504dbccd553fa`, freeze origin `adopted`.

## Totals

| assigned_slots | attempts | unscheduled_attempts | known_spend_usd | known_spend_unscheduled_usd | unknown_exposure_usd | in_flight_exposure_usd | accepted.implementation | accepted.decision | distinct_human_participants | reviewers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | 0.000000000 | 0 |   | 0 | 0 |

## Prespecified tables

### Completion by assigned condition

Source: flow (evaluation-package.json). CSV: `tables/completion.csv`.

| comparison | stratum | arm | assigned | blocked | deferred | missing | ran | submitted | failed | cancelled | needs_human | budget_exhausted | attempts | retries | infrastructure_failures | completion | completion_share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | decision | B | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | decision | C | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | A | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | B | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | C | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 | 0 |
| discovery | decision | D-open | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 |
| discovery | decision | D-structured | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 |

### Decision quality per reviewed slot

Source: reviewers/*/ratings.csv via private/assignment-key.json. CSV: `tables/decision-quality.csv`.

_No rows._

### Functional completion (implementation stratum)

Source: functional_checks (evaluation-package.json). CSV: `tables/functional-completion.csv`.

| slot_id | task_key | arm | slot_state | cases | passed | held_out_cases | held_out_passed | pass_share | backends | accepted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4e30469f25100df27435b3abaacbbb14e98064f3cacedfaf86b170bbb4bd95e4 | i1 | A | blocked | 0 | 0 | 0 | 0 |   |   | false |
| 6392828cde872d3d3a572b208a96c17aac416888463352ac088e0e66f8d3d23a | i1 | B | blocked | 0 | 0 | 0 | 0 |   |   | false |
| ba3058f2bca7a774893c81fc4d33781ddeec7463b325c5b0b98345bfc7c6c688 | i1 | C | blocked | 0 | 0 | 0 | 0 |   |   | false |

### Task-level paired comparisons

Source: decision-quality and functional-completion tables. CSV: `tables/paired-comparisons.csv`.

| stratum | contrast | task_key | x | y | difference | excluded |
| --- | --- | --- | --- | --- | --- | --- |
| decision | B - A | d1 |   |   |   | B blocked, no value; A blocked, no value |
| decision | C - A | d1 |   |   |   | C blocked, no value; A blocked, no value |
| decision | C - B | d1 |   |   |   | C blocked, no value; B blocked, no value |
| implementation | B - A | i1 |   |   |   | B blocked, no value; A blocked, no value |
| implementation | C - A | i1 |   |   |   | C blocked, no value; A blocked, no value |
| implementation | C - B | i1 |   |   |   | C blocked, no value; B blocked, no value |

### Paired comparison summaries

Source: paired-comparisons table. CSV: `tables/paired-summaries.csv`.

| stratum | outcome | contrast | tasks | n_pairs | min | median | max | positive | zero | negative | interval | interval_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| decision | mean reviewer quality (1-5) | B - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - B | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | B - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - A | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - B | 1 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |

### Discovery comparison per theme

Source: decision-quality table. CSV: `tables/discovery-comparison.csv`.

| task_key | structured_mean | structured_repeats_rated | open_mean | open_repeats_rated | difference_open_minus_structured |
| --- | --- | --- | --- | --- | --- |
| t1 |   | 0/2 |   | 0/2 |   |

### Resources and cost per accepted outcome

Source: attempt measurements (flow, reconciled with private/raw-exports). CSV: `tables/resources.csv`.

| comparison | stratum | arm | attempts | calls | provider_retries | known_spend_nano_usd | known_spend_usd | unknown_exposure_usd | in_flight_exposure_usd | billing | accepted | cost_per_accepted_usd | cost_per_accepted_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | decision | B | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | decision | C | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | implementation | A | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | C | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| discovery | decision | D-open | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| discovery | decision | D-structured | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |

### Human effort and latency

Source: attempt measurements. CSV: `tables/human-effort-latency.csv`.

| comparison | stratum | arm | human_active_minutes | intervention_active_minutes | human_wait_seconds | human_time_missing | wall_seconds_median | wall_seconds_min | wall_seconds_max | wall_seconds_n | wall_seconds_missing | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | B | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | C | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | A | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | B | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | C | 0 | 0 | 0 | 0 |   |   |   | 0 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-open | 0 | 0 | 0 | 0 |   |   |   | 0 | 2 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-structured | 0 | 0 | 0 | 0 |   |   |   | 0 | 2 | Human minutes are participant-reported; wall time is server-observed. |

### Interventions (assisted arm)

Source: raw_events kind interventions (private/raw-exports). CSV: `tables/interventions.csv`.

| comparison | stratum | arm | interventions | clarification | judgment | authorization | feedback | fixed_gate | dynamic_gate | prevented_problem_yes | prevented_problem_no | prevented_problem_unknown | active_minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Evidence validity (source support audits)

Source: source_support_audits (evaluation-package.json). CSV: `tables/evidence-validity.csv`.

_No rows._

### Reviewer agreement

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-agreement.csv`.

_No rows._

### Reviewer disagreements of two points or more

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-disagreements.csv`.

_No rows._

### Deviations and slots that did not run

Source: raw_events kind deviations; flow reasons. CSV: `tables/deviations.csv`.

| source | slot_id | task_key | arm | reason | impact |
| --- | --- | --- | --- | --- | --- |
| slot blocked | ae0571632f75ff782127880958a7a406355f37e7ba2a0054fc0530e1d9a51549 | d1 | A | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 688865aa6b65542e7ba072eefe2c481542c412181dc15ed0c44130c4a7b8b1ad | d1 | B | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 54a05bb96df0bc730666f4101488585a1677cf45d77b08d04c90f24ef287b8cc | d1 | C | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 4e30469f25100df27435b3abaacbbb14e98064f3cacedfaf86b170bbb4bd95e4 | i1 | A | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 6392828cde872d3d3a572b208a96c17aac416888463352ac088e0e66f8d3d23a | i1 | B | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | ba3058f2bca7a774893c81fc4d33781ddeec7463b325c5b0b98345bfc7c6c688 | i1 | C | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | d0de04a15403163e8c71143f45aa7eede7aa4129edae4bb883ec10209e3f2369 | t1 | D-structured | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | b631d9a437eb214daf95af632066e481c4cf614111bedc65276c31fb60d743a9 | t1 | D-open | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 20bfa3b4b050b8679e2b6133dc2ca8b4a9cf8ef1bd3902409dc470b8c514b1ad | t1 | D-structured | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |
| slot blocked | 5c3e08c9dc39161737b7eba39941762a71804aa24e2137928c9fd4dea2159888 | t1 | D-open | Fixture: no adopted protocol freeze (RD1-RD10). Fixture: no verified model id and live dispatch disabled (RD6). | No outcome; kept in the assigned denominator. |

## Exploratory (not prespecified)

### EXPLORATORY: per-protocol completion

Source: flow. CSV: `tables/per-protocol-completion.csv`.

| comparison | stratum | arm | ran_without_only_infrastructure_failure | submitted | completion |
| --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0/0 |
| autonomy | decision | B | 0 | 0 | 0/0 |
| autonomy | decision | C | 0 | 0 | 0/0 |
| autonomy | implementation | A | 0 | 0 | 0/0 |
| autonomy | implementation | B | 0 | 0 | 0/0 |
| autonomy | implementation | C | 0 | 0 | 0/0 |
| discovery | decision | D-open | 0 | 0 | 0/0 |
| discovery | decision | D-structured | 0 | 0 | 0/0 |

## Not measured

- Potential benefit: not measured by the current study contracts.
- Observed user impact: not measured by the current study contracts.

## Gaps

- Not empirical (synthetic_verification_fixture): no table here is a study finding.
- No reviewer ratings supplied: decision quality is missing for every slot.
- No decision acceptance rule: cost per accepted decision outcome is undefined.
- 10 slot(s) blocked; they stay in the assigned denominators.
- Potential benefit and observed user impact are not measured by the current study contracts; they are reported as not measured, never inferred from quality ratings.
- Intervention necessity (necessary, missed, unnecessary) needs owner coding that the current contracts do not record; only the recorded intervention fields are summarised.

## Limitations

- 0 distinct human participant: human-arm results describe one person's repeated work, not human work in general, and repeated observations from that person are not independent.
- 2 autonomy task(s) and 1 discovery theme(s): no power calculation and no general comparative claim.
- One provider model serves every AI role, so its errors may be correlated across arms.
- Ideas inside one run are rated together as one item and are not counted as separate observations.

## Reconciliation checks

- PASS `slots.match_schedule`: 10 flow rows for 10 scheduled slots, each once.
- PASS `slots.groups_partition`: Every slot is counted in exactly one comparison/stratum/arm group.
- PASS `attempts.unique`: 0 attempts in the flow, none in two slots.
- PASS `attempts.in_one_export`: Every flow attempt appears in exactly one raw export, once.
- PASS `attempts.measurements_match_export`: Flow measurements equal the raw export for every attempt (spend, exposure, calls).
- PASS `spend.totals_reconcile`: Group sum 0.000000000 = flow sum 0.000000000; plus unscheduled 0.000000000 = export sum 0.000000000 USD.
- PASS `ratings.codes_valid`: 0 rating rows from 0 reviewer(s), each code known, mapped to a slot's last attempt and rated once per reviewer.
- PASS `functional.bound_to_flow`: 0 functional checks each bind an attempt of their slot.
- PASS `export.kind_consistent`: 0 export(s), 0 synthetic; data kind synthetic_verification_fixture.
- PASS `privacy.no_participant_metadata`: None of 1 private participant or key values appears in the output.

## Figures

- figures/decision-quality.svg
- figures/paired-differences.svg
- figures/resources.svg

> **VERIFICATION FIXTURE: synthetic data, not empirical**
