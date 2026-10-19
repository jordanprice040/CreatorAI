# Creator Agent analysis

> **VERIFICATION FIXTURE: synthetic data, not empirical**

Data kind: `synthetic_verification_fixture`. Empirical: no. Analysis hash `5413c3a7587a4202d92510838f2cdb4ec86863c4280a54d39504e839eb4f297e`. Plan `analysis-plan/1` (Implementation default, not an owner decision; adopt or replace it in the protocol freeze.)

## Inputs (raw-data references)

- `FIXTURE.json` sha256 `13230ca1424baa36c0dab60342e4edb4a8143e4daffb779db323eea48da14b40`
- `analysis-options.json` sha256 `541368469369b8e6136937b07ed5a035b882442ad06378a39593e8eb0b39ae6c`
- `evaluation-package.json` sha256 `8c56d78cba78bd11b4a098b429320cd2ccaaf3f676b710e17027757dc6d3dff1`
- `private/assignment-key.json` sha256 `86007049941a1b5ed6d9dfc75f65bb0bdaf88a58f68733ed167177658942034d`
- `private/raw-exports/d1.json` sha256 `f2f30517367628b5c43ee534876bcf9530c3cee2fbfff28539038c86240e6a49`
- `private/raw-exports/i1.json` sha256 `616882cd338dbf39aa669e8470f393e2c14b02b0fd319eb20e5ec133d88c5c41`
- `reviewers/reviewer-1/ratings.csv` sha256 `931fbf135b3361f50ff145ed342d8ad39cca891a0b7a4ed615d49e71f6843bd0`
- `reviewers/reviewer-2/ratings.csv` sha256 `479f17631ea0df98764d94012d8f0c9ceef7e78ab473c2c68b33c136357da591`

Package `64b06e68c5bde1e0e4bf202f060188f20151fff61ae856220344b0fe4c757e8d`, schedule `93972a7b170b52395d68dcc8012afb32bb616c99e50493cad44ffa338337f2c8`, freeze origin `rehearsal`.

## Totals

| assigned_slots | attempts | unscheduled_attempts | known_spend_usd | known_spend_unscheduled_usd | unknown_exposure_usd | in_flight_exposure_usd | accepted.implementation | accepted.decision | distinct_human_participants | reviewers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | 6 | 0 | 0.019000000 | 0.000000000 | 0.000000000 | 0.000000000 | 0 | 0 | 1 | 2 |

## Prespecified tables

### Completion by assigned condition

Source: flow (evaluation-package.json). CSV: `tables/completion.csv`.

| comparison | stratum | arm | assigned | blocked | deferred | missing | ran | submitted | failed | cancelled | needs_human | budget_exhausted | attempts | retries | infrastructure_failures | completion | completion_share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0/1 | 0 |
| autonomy | decision | B | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0/1 | 0 |
| autonomy | decision | C | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | A | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0/1 | 0 |
| autonomy | implementation | B | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1/1 | 1 |
| autonomy | implementation | C | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0/1 | 0 |

### Decision quality per reviewed slot

Source: reviewers/*/ratings.csv via private/assignment-key.json. CSV: `tables/decision-quality.csv`.

| slot_id | attempt_id | task_key | arm | repeat | slot_state | reviewer_status.reviewer-1 | reviewer_status.reviewer-2 | complete_reviewers | quality | dimension_means.usefulness | dimension_means.feasibility | dimension_means.evidence_support | dimension_means.differentiation | dimension_means.appropriateness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7ba099bd81857306223c8a78aa0da4e7cedb4346d51e6ca7d8fd04b4f1941457 | 00000000-0000-4000-8000-000000000001 | d1 | A | 1 | needs_human | complete | complete | 2 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 |
| 24878948f8c5d96b6d0c6a8dd7dc22c93b5f6c33dac5df8d46aeabffd62cd02f | 00000000-0000-4000-8000-000000000002 | d1 | B | 1 | budget_exhausted | blank | blank | 0 |   |   |   |   |   |   |
| 01ae2fb7a50f6b328093c93bff8c390097998c857436e1c9ebfb5a5a1e0f14cf | 00000000-0000-4000-8000-000000000003 | d1 | C | 1 | cancelled | blank | blank | 0 |   |   |   |   |   |   |

### Functional completion (implementation stratum)

Source: functional_checks (evaluation-package.json). CSV: `tables/functional-completion.csv`.

| slot_id | task_key | arm | slot_state | cases | passed | held_out_cases | held_out_passed | pass_share | backends | accepted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0f0aaa0b41df8efd9e635f9490d73cf26f2faf26ed1c3ea1fcc013995fcdc2cd | i1 | A | failed | 0 | 0 | 0 | 0 |   |   | false |
| 4377a58d8246aa6f97f794cc1053c1b4bd8d591e40ed26fa5f0fc668b58657d5 | i1 | B | submitted | 2 | 1 | 1 | 0 | 0.5 | labelled-fixture | false |
| 87bd50ad9590a97d4ab4edb525e01ab251e671387bff4c32c2bcc575a20d0139 | i1 | C | failed | 0 | 0 | 0 | 0 |   |   | false |

### Task-level paired comparisons

Source: decision-quality and functional-completion tables. CSV: `tables/paired-comparisons.csv`.

| stratum | contrast | task_key | x | y | difference | excluded |
| --- | --- | --- | --- | --- | --- | --- |
| decision | B - A | d1 |   | 1.5 |   | B budget_exhausted, no value |
| decision | C - A | d1 |   | 1.5 |   | C cancelled, no value |
| decision | C - B | d1 |   |   |   | C cancelled, no value; B budget_exhausted, no value |
| implementation | B - A | i1 | 0.5 |   |   | A failed, no value |
| implementation | C - A | i1 |   |   |   | C failed, no value; A failed, no value |
| implementation | C - B | i1 |   | 0.5 |   | C failed, no value |

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

_No rows._

### Resources and cost per accepted outcome

Source: attempt measurements (flow, reconciled with private/raw-exports). CSV: `tables/resources.csv`.

| comparison | stratum | arm | attempts | calls | provider_retries | known_spend_nano_usd | known_spend_usd | unknown_exposure_usd | in_flight_exposure_usd | billing | accepted | cost_per_accepted_usd | cost_per_accepted_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 1 | 3 | 0 | 3000000 | 0.003000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | decision | B | 1 | 3 | 0 | 7000000 | 0.007000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | decision | C | 1 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | A | 1 | 3 | 0 | 5000000 | 0.005000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | B | 1 | 3 | 0 | 4000000 | 0.004000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | C | 1 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |

### Human effort and latency

Source: attempt measurements. CSV: `tables/human-effort-latency.csv`.

| comparison | stratum | arm | human_active_minutes | intervention_active_minutes | human_wait_seconds | human_time_missing | wall_seconds_median | wall_seconds_min | wall_seconds_max | wall_seconds_n | wall_seconds_missing | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | B | 30 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | C | 20 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | A | 0 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | B | 30 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | C | 90 | 0 | 0 | 0 | 600 | 600 | 600 | 1 | 0 | Human minutes are participant-reported; wall time is server-observed. |

### Interventions (assisted arm)

Source: raw_events kind interventions (private/raw-exports). CSV: `tables/interventions.csv`.

| comparison | stratum | arm | interventions | clarification | judgment | authorization | feedback | fixed_gate | dynamic_gate | prevented_problem_yes | prevented_problem_no | prevented_problem_unknown | active_minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Evidence validity (source support audits)

Source: source_support_audits (evaluation-package.json). CSV: `tables/evidence-validity.csv`.

| comparison | stratum | arm | audited_attempts | sources | verified | unverified | attempts_with_unverified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 1 | 1 | 0 | 1 | 1 |
| autonomy | decision | B | 1 | 1 | 0 | 1 | 1 |
| autonomy | implementation | A | 1 | 1 | 0 | 1 | 1 |
| autonomy | implementation | B | 1 | 1 | 0 | 1 | 1 |

### Reviewer agreement

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-agreement.csv`.

| dimension | items_rated_by_both | weighted_kappa | kappa_note |
| --- | --- | --- | --- |
| usefulness | 1 | 0 | Quadratic weights, 1-5 scale. |
| feasibility | 1 | 0 | Quadratic weights, 1-5 scale. |
| evidence_support | 1 | 0 | Quadratic weights, 1-5 scale. |
| differentiation | 1 | 0 | Quadratic weights, 1-5 scale. |
| appropriateness | 1 | 0 | Quadratic weights, 1-5 scale. |

### Reviewer disagreements of two points or more

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-disagreements.csv`.

_No rows._

### Deviations and slots that did not run

Source: raw_events kind deviations; flow reasons. CSV: `tables/deviations.csv`.

_No rows._

## Exploratory (not prespecified)

### EXPLORATORY: per-protocol completion

Source: flow. CSV: `tables/per-protocol-completion.csv`.

| comparison | stratum | arm | ran_without_only_infrastructure_failure | submitted | completion |
| --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 1 | 0 | 0/1 |
| autonomy | decision | B | 1 | 0 | 0/1 |
| autonomy | decision | C | 1 | 0 | 0/1 |
| autonomy | implementation | A | 1 | 0 | 0/1 |
| autonomy | implementation | B | 1 | 1 | 1/1 |
| autonomy | implementation | C | 1 | 0 | 0/1 |

## Not measured

- Potential benefit: not measured by the current study contracts.
- Observed user impact: not measured by the current study contracts.

## Gaps

- Not empirical (synthetic_verification_fixture): no table here is a study finding.
- 2 reviewed item(s) lack complete ratings from every reviewer; no rating is imputed.
- Potential benefit and observed user impact are not measured by the current study contracts; they are reported as not measured, never inferred from quality ratings.
- Intervention necessity (necessary, missed, unnecessary) needs owner coding that the current contracts do not record; only the recorded intervention fields are summarised.

## Limitations

- 1 distinct human participant: human-arm results describe one person's repeated work, not human work in general, and repeated observations from that person are not independent.
- 2 autonomy task(s) and 0 discovery theme(s): no power calculation and no general comparative claim.
- One provider model serves every AI role, so its errors may be correlated across arms.
- Ideas inside one run are rated together as one item and are not counted as separate observations.

## Reconciliation checks

- PASS `slots.match_schedule`: 6 flow rows for 6 scheduled slots, each once.
- PASS `slots.groups_partition`: Every slot is counted in exactly one comparison/stratum/arm group.
- PASS `attempts.unique`: 6 attempts in the flow, none in two slots.
- PASS `attempts.in_one_export`: Every flow attempt appears in exactly one raw export, once.
- PASS `attempts.measurements_match_export`: Flow measurements equal the raw export for every attempt (spend, exposure, calls).
- PASS `spend.totals_reconcile`: Group sum 0.019000000 = flow sum 0.019000000; plus unscheduled 0.000000000 = export sum 0.019000000 USD.
- PASS `ratings.codes_valid`: 6 rating rows from 2 reviewer(s), each code known, mapped to a slot's last attempt and rated once per reviewer.
- PASS `functional.bound_to_flow`: 2 functional checks each bind an attempt of their slot.
- PASS `export.kind_consistent`: 2 export(s), 2 synthetic; data kind synthetic_verification_fixture.
- PASS `privacy.no_participant_metadata`: None of 4 private participant or key values appears in the output.

## Figures

- figures/decision-quality.svg
- figures/paired-differences.svg
- figures/resources.svg

> **VERIFICATION FIXTURE: synthetic data, not empirical**
