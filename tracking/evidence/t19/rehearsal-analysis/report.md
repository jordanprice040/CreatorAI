# Creator Agent analysis

> **NOT EMPIRICAL: rehearsal or synthetic study records.**

Data kind: `not_empirical`. Empirical: no. Analysis hash `dc2be5fe0aa4cb413daaf2504bcb1048e2eae4756686c18b3ce0cffafd462714`. Plan `analysis-plan/1` (Implementation default, not an owner decision; adopt or replace it in the protocol freeze.)

## Inputs (raw-data references)

- `evaluation-package.json` sha256 `d68acf730adf049953793367b456bb10b3cac308b0747dbae47a36146ab69cd6`
- `private/assignment-key.json` sha256 `ae388eeb6e2c4568a41b8e4011c0d00e06f53200b8a6ff4b6328093fa1464fc6`
- `private/raw-exports/build-1.json` sha256 `0227b58b975a649729417a65004d3c9cf58af277a66c3d0627e32d8e7abe1806`
- `private/raw-exports/build-2.json` sha256 `29024eb3c88f3ade3b3ac16acc838a0f9e62f591492706b5809a449930db7299`
- `private/raw-exports/decision-1.json` sha256 `11788dc34f02b14b0696ad1f62fd2398bf35a6730e7c483c00c73e7f7e65de0a`
- `private/raw-exports/decision-2.json` sha256 `e37779c5abafcb110b935571e362c1b20b1407a1900d362b250afc3ba310fd81`
- `private/raw-exports/decision-3.json` sha256 `37327c51ae312f3540796ba2cda7c7b34e6f3785a5f2f07d634852779c23edb1`
- `private/raw-exports/decision-4.json` sha256 `5152effb0d09ff6917907ac3aa5c0f96e4ea43858a66a7552b776e0216ecf4f5`
- `private/raw-exports/theme-1.json` sha256 `8c258786ce6be3f2ccb4fb62c7f4bd3d135b8ba56f8d04b1abefc36775abc0d4`
- `private/raw-exports/theme-2.json` sha256 `1ccd8024c822c462b8526218a69ac698e11b7809fb1972fd2952c00cff776323`
- `reviewers/reviewer-1/ratings.csv` sha256 `6063440a13248a26d049c4546aa2a3e32a24ac08f991ba3c758c065dece54277`
- `reviewers/reviewer-2/ratings.csv` sha256 `0d8b0c36f8d5c7be7724f4b1083d378e6d93258fc7a6ad4dd16acc6e556a3011`

Package `a0c0a86b41c1ee8bee248366dd2c32dc06cecd6d6e7ca7c59274922d7aa73836`, schedule `b679c050fdda5a46bcdb0a21c142429258196a4ebe885a478b8cae56b3491546`, freeze origin `rehearsal`.

## Totals

| assigned_slots | attempts | unscheduled_attempts | known_spend_usd | known_spend_unscheduled_usd | unknown_exposure_usd | in_flight_exposure_usd | accepted.implementation | accepted.decision | distinct_human_participants | reviewers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 26 | 21 | 0 | 0.316390000 | 0.000000000 | 0.000000000 | 0.000000000 | 2 |   | 1 | 2 |

## Prespecified tables

### Completion by assigned condition

Source: flow (evaluation-package.json). CSV: `tables/completion.csv`.

| comparison | stratum | arm | assigned | blocked | deferred | missing | ran | submitted | failed | cancelled | needs_human | budget_exhausted | attempts | retries | infrastructure_failures | completion | completion_share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 4 | 0 | 0 | 0 | 4 | 0 | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0/4 | 0 |
| autonomy | decision | B | 4 | 0 | 0 | 0 | 4 | 0 | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0/4 | 0 |
| autonomy | decision | C | 4 | 0 | 0 | 0 | 4 | 3 | 0 | 1 | 0 | 0 | 4 | 0 | 0 | 3/4 | 0.75 |
| autonomy | implementation | A | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 |
| autonomy | implementation | B | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 |
| autonomy | implementation | C | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 2/2 | 1 |
| discovery | decision | D-open | 4 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 3/4 | 0.75 |
| discovery | decision | D-structured | 4 | 0 | 0 | 0 | 4 | 0 | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0/4 | 0 |

### Decision quality per reviewed slot

Source: reviewers/*/ratings.csv via private/assignment-key.json. CSV: `tables/decision-quality.csv`.

| slot_id | attempt_id | task_key | arm | repeat | slot_state | reviewer_status.reviewer-1 | reviewer_status.reviewer-2 | complete_reviewers | quality | dimension_means.usefulness | dimension_means.feasibility | dimension_means.evidence_support | dimension_means.differentiation | dimension_means.appropriateness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 83b4862671914e07d5359a07e8eab576e92f09b53d02d3fdfc207dcf7378cfcc | 2c393395-6d50-4f2e-bfb4-2cd58c5a300d | decision-1 | A | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| ac0d20fd150fb936c60f08c392e436b1077b37e1402e65ba1cab0842e02ca590 | b8c17116-fc28-4bf2-b798-ddb445ef71ec | decision-1 | B | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| a6177766fecdbcb5ac1a5d0961f24ea1375cc5720f723d8f48eac7c8df5e6c4f | f398785f-ad5d-470e-b9a3-b1a7b59426de | decision-1 | C | 1 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| 89c54100ad55c7cdf7ad4cd288bd426d494fbfc11a94cad6c303888140844c9c | 9a78272c-db3b-4382-84cd-768d4bfe02ca | decision-2 | A | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| 89f1f96b320bd69f49450a010cf4e9d5d1886be73d1360ba8ac42380dc0a19b0 | b92c8f12-f039-41ef-b8a6-939f0c377339 | decision-2 | B | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| 92ef51ae7fa820d4e6d57319a3b25d3b475976e75677b9f414d86d3f81eff64c | 2f33a140-68e7-4292-88ed-a609bb0c7fd4 | decision-2 | C | 1 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| 9963b99f5cd9ce32c8e8fbec0202e2b5002b6a4751ac8e4640be6a763407321a | 7a5508bb-40d4-4024-8880-9cfa6d181a30 | decision-3 | A | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| e2e9861fe51f32b810dd99358c60e7c733e6e75a6aa4baf6c74f27db4e6767ef | 99cf7b86-9860-4cc1-909b-762981b92c48 | decision-3 | B | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| 5b49c84d4d8c8a1f70969d31b74d6a1666c6b4e85b57cb6ebd645afc1b4f944d | 88ecf032-b606-4274-972a-05d145fdae77 | decision-3 | C | 1 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| ec0a7ba345a05c0c02a356f7679f762ff3bf9aeb7d42e0d21b75e8c9338b4a93 | 6925775e-7108-428f-b1aa-c3d3fd3fb7f9 | decision-4 | A | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| e577f95d882882f4b7ad2c9a7090acf6dd1bcaee288a6c473ca02c0215535104 | 3efbb93f-4dd5-45f8-b4c3-58078cb5486d | decision-4 | B | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| 3c907a69ee1afd0f132a1d6012749322615ab4e292d6dc2a2f025836335efe41 | 6e891441-a0c5-4acc-9735-fd51aa1310ce | decision-4 | C | 1 | cancelled | blank | blank | 0 |   |   |   |   |   |   |
| 46b7353126b3aa894da7b2e245709a34a73c79e44596e1f6095dce1df761396c | c7f7382d-1996-4d26-9946-d48c15440705 | theme-1 | D-open | 1 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| cd91e930163e4ebba408bac213f6be270957a23b706dca43a6202881cb9afd75 | 253be24b-dbea-4c2d-99a3-1df5bc93fd05 | theme-1 | D-open | 2 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| f9eca68dbe686eaadb89b4177ae136a674ab35c2e505c7066ed45a36bbe15970 | 82fc7d20-1149-442c-9fd5-ca0b6f4b701a | theme-1 | D-structured | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| fac7ec160e3d2801d70403c39f37cc7eff372fa250687b86c41e4818b2fa6c45 | e0944aac-4e01-4363-a9d8-0967f6332a72 | theme-1 | D-structured | 2 | failed | blank | blank | 0 |   |   |   |   |   |   |
| 2496f1719bb3be88d0e76dfe9d9290eaaf1f933d5e6d2da280b436fccbe901d3 | c2c08de1-fc2b-441c-bc82-884b583412af | theme-2 | D-open | 1 | submitted | blank | blank | 0 |   |   |   |   |   |   |
| 27ded4054c82c2818c1fc4813b6defe5da41175bbac551d5ddcb92a7bfd8b796 | 4d36436a-57da-4a4f-af73-2e5bf7bf2c5d | theme-2 | D-structured | 1 | failed | blank | blank | 0 |   |   |   |   |   |   |
| b83cd9373e130d968904f8808d2d09f98bf5642f057a622a013e81ef2fda728f | 3ae4ea85-4c4f-4637-b1dd-baead2a8c1d7 | theme-2 | D-structured | 2 | failed | blank | blank | 0 |   |   |   |   |   |   |

### Functional completion (implementation stratum)

Source: functional_checks (evaluation-package.json). CSV: `tables/functional-completion.csv`.

| slot_id | task_key | arm | slot_state | cases | passed | held_out_cases | held_out_passed | pass_share | backends | accepted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aa2089854ba3dd3608fb09a02295a367e9d30b0afdfae3fd266957cbd1f422e3 | build-1 | B | blocked | 0 | 0 | 0 | 0 |   |   | false |
| adbbc8ee11a037adf2603e6c55112a1fd411d07169ab3fd0a3b60eac23459c4b | build-1 | A | blocked | 0 | 0 | 0 | 0 |   |   | false |
| 3177eb2c79a50a04b862cee862a4911959771134182de75bf5cf0031e0d64858 | build-1 | C | submitted | 1 | 1 | 0 | 0 | 1 | conventional-text-check/1 | true |
| a71be815d487888567c7df4e14fff9e9b5c25b6e5ec23c7d45bd4ed57ce96435 | build-2 | C | submitted | 1 | 1 | 0 | 0 | 1 | conventional-text-check/1 | true |
| b799276bbf312df9a7a36e3bf491ddd0fe1647f733416fc9e8cdf507789b5d80 | build-2 | A | blocked | 0 | 0 | 0 | 0 |   |   | false |
| 0535fb83a903c32fe2e1dda3d190c787ac09e9ffff2d1b4e8b2e1e0203859ae1 | build-2 | B | blocked | 0 | 0 | 0 | 0 |   |   | false |

### Task-level paired comparisons

Source: decision-quality and functional-completion tables. CSV: `tables/paired-comparisons.csv`.

| stratum | contrast | task_key | x | y | difference | excluded |
| --- | --- | --- | --- | --- | --- | --- |
| decision | B - A | decision-1 |   |   |   | B failed, no value; A failed, no value |
| decision | B - A | decision-2 |   |   |   | B failed, no value; A failed, no value |
| decision | B - A | decision-3 |   |   |   | B failed, no value; A failed, no value |
| decision | B - A | decision-4 |   |   |   | B failed, no value; A failed, no value |
| decision | C - A | decision-1 |   |   |   | C submitted, no value; A failed, no value |
| decision | C - A | decision-2 |   |   |   | C submitted, no value; A failed, no value |
| decision | C - A | decision-3 |   |   |   | C submitted, no value; A failed, no value |
| decision | C - A | decision-4 |   |   |   | C cancelled, no value; A failed, no value |
| decision | C - B | decision-1 |   |   |   | C submitted, no value; B failed, no value |
| decision | C - B | decision-2 |   |   |   | C submitted, no value; B failed, no value |
| decision | C - B | decision-3 |   |   |   | C submitted, no value; B failed, no value |
| decision | C - B | decision-4 |   |   |   | C cancelled, no value; B failed, no value |
| implementation | B - A | build-1 |   |   |   | B blocked, no value; A blocked, no value |
| implementation | B - A | build-2 |   |   |   | B blocked, no value; A blocked, no value |
| implementation | C - A | build-1 | 1 |   |   | A blocked, no value |
| implementation | C - A | build-2 | 1 |   |   | A blocked, no value |
| implementation | C - B | build-1 | 1 |   |   | B blocked, no value |
| implementation | C - B | build-2 | 1 |   |   | B blocked, no value |

### Paired comparison summaries

Source: paired-comparisons table. CSV: `tables/paired-summaries.csv`.

| stratum | outcome | contrast | tasks | n_pairs | min | median | max | positive | zero | negative | interval | interval_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| decision | mean reviewer quality (1-5) | B - A | 4 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - A | 4 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| decision | mean reviewer quality (1-5) | C - B | 4 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | B - A | 2 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - A | 2 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |
| implementation | share of frozen cases passed | C - B | 2 | 0 |   |   |   | 0 | 0 | 0 |   | Not computed: 0 task pair(s), below the plan minimum of 10. Report the range, not an interval. |

### Discovery comparison per theme

Source: decision-quality table. CSV: `tables/discovery-comparison.csv`.

| task_key | structured_mean | structured_repeats_rated | open_mean | open_repeats_rated | difference_open_minus_structured |
| --- | --- | --- | --- | --- | --- |
| theme-1 |   | 0/2 |   | 0/2 |   |
| theme-2 |   | 0/2 |   | 0/2 |   |

### Resources and cost per accepted outcome

Source: attempt measurements (flow, reconciled with private/raw-exports). CSV: `tables/resources.csv`.

| comparison | stratum | arm | attempts | calls | provider_retries | known_spend_nano_usd | known_spend_usd | unknown_exposure_usd | in_flight_exposure_usd | billing | accepted | cost_per_accepted_usd | cost_per_accepted_note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 4 | 4 | 0 | 101480000 | 0.101480000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | decision | B | 4 | 4 | 0 | 101480000 | 0.101480000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | decision | C | 4 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| autonomy | implementation | A | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 0 |   | Undefined: zero accepted outcomes. Total known spend stays visible. |
| autonomy | implementation | C | 2 | 0 | 0 | 0 | 0.000000000 | 0.000000000 | 0.000000000 | complete | 2 | 0.000000000 | Known spend over accepted outcomes (floor to 1 nano-USD). |
| discovery | decision | D-open | 3 | 3 | 0 | 12350000 | 0.012350000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |
| discovery | decision | D-structured | 4 | 4 | 0 | 101080000 | 0.101080000 | 0.000000000 | 0.000000000 | complete |   |   | Undefined: no acceptance rule for this stratum (analysis-options.json). |

### Human effort and latency

Source: attempt measurements. CSV: `tables/human-effort-latency.csv`.

| comparison | stratum | arm | human_active_minutes | intervention_active_minutes | human_wait_seconds | human_time_missing | wall_seconds_median | wall_seconds_min | wall_seconds_max | wall_seconds_n | wall_seconds_missing | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 0 | 0 | 0 | 0 | 0.7575 | 0.547 | 0.887 | 4 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | B | 0 | 0 | 0 | 4 | 0.66 | 0.65 | 0.738 | 4 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | decision | C | 0 | 0 | 0 | 0 | 0.436 | 0.245 | 0.73 | 4 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | A | 0 | 0 | 0 | 0 |   |   |   | 0 | 2 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | B | 0 | 0 | 0 | 0 |   |   |   | 0 | 2 | Human minutes are participant-reported; wall time is server-observed. |
| autonomy | implementation | C | 0 | 0 | 0 | 0 | 0.5805 | 0.241 | 0.92 | 2 | 0 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-open | 0 | 0 | 0 | 0 | 0.283 | 0.27 | 0.349 | 3 | 1 | Human minutes are participant-reported; wall time is server-observed. |
| discovery | decision | D-structured | 0 | 0 | 0 | 0 | 0.996 | 0.537 | 2.886 | 4 | 0 | Human minutes are participant-reported; wall time is server-observed. |

### Interventions (assisted arm)

Source: raw_events kind interventions (private/raw-exports). CSV: `tables/interventions.csv`.

| comparison | stratum | arm | interventions | clarification | judgment | authorization | feedback | fixed_gate | dynamic_gate | prevented_problem_yes | prevented_problem_no | prevented_problem_unknown | active_minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | B | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 0 |
| autonomy | implementation | B | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Evidence validity (source support audits)

Source: source_support_audits (evaluation-package.json). CSV: `tables/evidence-validity.csv`.

| comparison | stratum | arm | audited_attempts | sources | verified | unverified | attempts_with_unverified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 4 | 4 | 0 | 4 | 4 |
| autonomy | decision | B | 4 | 4 | 0 | 4 | 4 |
| discovery | decision | D-open | 3 | 3 | 0 | 3 | 3 |
| discovery | decision | D-structured | 4 | 4 | 0 | 4 | 4 |

### Reviewer agreement

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-agreement.csv`.

| dimension | items_rated_by_both | weighted_kappa | kappa_note |
| --- | --- | --- | --- |
| usefulness | 0 |   | No item rated by both reviewers. |
| feasibility | 0 |   | No item rated by both reviewers. |
| evidence_support | 0 |   | No item rated by both reviewers. |
| differentiation | 0 |   | No item rated by both reviewers. |
| appropriateness | 0 |   | No item rated by both reviewers. |

### Reviewer disagreements of two points or more

Source: reviewers/*/ratings.csv. CSV: `tables/reviewer-disagreements.csv`.

_No rows._

### Deviations and slots that did not run

Source: raw_events kind deviations; flow reasons. CSV: `tables/deviations.csv`.

| source | slot_id | task_key | arm | reason | impact |
| --- | --- | --- | --- | --- | --- |
| slot blocked | aa2089854ba3dd3608fb09a02295a367e9d30b0afdfae3fd266957cbd1f422e3 | build-1 | B | AI implementation runs need a study bound to a frozen build task (spec, freeze, held-out cases) for the isolated builder; these tasks have none. | No outcome; kept in the assigned denominator. |
| slot blocked | adbbc8ee11a037adf2603e6c55112a1fd411d07169ab3fd0a3b60eac23459c4b | build-1 | A | AI implementation runs need a study bound to a frozen build task (spec, freeze, held-out cases) for the isolated builder; these tasks have none. | No outcome; kept in the assigned denominator. |
| slot blocked | b799276bbf312df9a7a36e3bf491ddd0fe1647f733416fc9e8cdf507789b5d80 | build-2 | A | AI implementation runs need a study bound to a frozen build task (spec, freeze, held-out cases) for the isolated builder; these tasks have none. | No outcome; kept in the assigned denominator. |
| slot blocked | 0535fb83a903c32fe2e1dda3d190c787ac09e9ffff2d1b4e8b2e1e0203859ae1 | build-2 | B | AI implementation runs need a study bound to a frozen build task (spec, freeze, held-out cases) for the isolated builder; these tasks have none. | No outcome; kept in the assigned denominator. |
| slot deferred | 337c96a08e87cfbc7f214a3b6f36f0730b9596a7b557bf6fb349605994c46161 | theme-2 | D-open | Rehearsal deferral to exercise the ledger. | No outcome; kept in the assigned denominator. |

## Exploratory (not prespecified)

### EXPLORATORY: per-protocol completion

Source: flow. CSV: `tables/per-protocol-completion.csv`.

| comparison | stratum | arm | ran_without_only_infrastructure_failure | submitted | completion |
| --- | --- | --- | --- | --- | --- |
| autonomy | decision | A | 4 | 0 | 0/4 |
| autonomy | decision | B | 4 | 0 | 0/4 |
| autonomy | decision | C | 4 | 3 | 3/4 |
| autonomy | implementation | A | 0 | 0 | 0/0 |
| autonomy | implementation | B | 0 | 0 | 0/0 |
| autonomy | implementation | C | 2 | 2 | 2/2 |
| discovery | decision | D-open | 3 | 3 | 3/3 |
| discovery | decision | D-structured | 4 | 0 | 0/4 |

## Not measured

- Potential benefit: not measured by the current study contracts.
- Observed user impact: not measured by the current study contracts.

## Gaps

- Not empirical (not_empirical): no table here is a study finding.
- 19 reviewed item(s) lack complete ratings from every reviewer; no rating is imputed.
- No decision acceptance rule: cost per accepted decision outcome is undefined.
- 4 slot(s) blocked; they stay in the assigned denominators.
- Potential benefit and observed user impact are not measured by the current study contracts; they are reported as not measured, never inferred from quality ratings.
- Intervention necessity (necessary, missed, unnecessary) needs owner coding that the current contracts do not record; only the recorded intervention fields are summarised.

## Limitations

- 1 distinct human participant: human-arm results describe one person's repeated work, not human work in general, and repeated observations from that person are not independent.
- 6 autonomy task(s) and 2 discovery theme(s): no power calculation and no general comparative claim.
- One provider model serves every AI role, so its errors may be correlated across arms.
- Ideas inside one run are rated together as one item and are not counted as separate observations.

## Reconciliation checks

- PASS `slots.match_schedule`: 26 flow rows for 26 scheduled slots, each once.
- PASS `slots.groups_partition`: Every slot is counted in exactly one comparison/stratum/arm group.
- PASS `attempts.unique`: 21 attempts in the flow, none in two slots.
- PASS `attempts.in_one_export`: Every flow attempt appears in exactly one raw export, once.
- PASS `attempts.measurements_match_export`: Flow measurements equal the raw export for every attempt (spend, exposure, calls).
- PASS `spend.totals_reconcile`: Group sum 0.316390000 = flow sum 0.316390000; plus unscheduled 0.000000000 = export sum 0.316390000 USD.
- PASS `ratings.codes_valid`: 38 rating rows from 2 reviewer(s), each code known, mapped to a slot's last attempt and rated once per reviewer.
- PASS `functional.bound_to_flow`: 5 functional checks each bind an attempt of their slot.
- PASS `export.kind_consistent`: 8 export(s), 8 synthetic; data kind not_empirical.
- PASS `privacy.no_participant_metadata`: None of 4 private participant or key values appears in the output.

## Figures

- figures/decision-quality.svg
- figures/paired-differences.svg
- figures/resources.svg

> **NOT EMPIRICAL: rehearsal or synthetic study records.**
