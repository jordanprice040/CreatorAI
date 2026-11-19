# Creator Agent evaluation protocol

Draft v1.0 • Proposed research design, not an approved study or executed experiment.

November 19, 2026: for the December thesis, Jordan chose to run only condition A on the implementation stratum, as one small frozen run reported alone ([AI-only run protocol](../docs/thesis/AI_ONLY_RUN_PROTOCOL.md), ADR-0133). The full design below stays proposed and unfrozen.

## Questions and priority

Preserve two comparisons: the October 8 autonomy comparison and the earlier structured-versus-open-ended discovery comparison. Build support for both; finalize primary outcomes, workload, reviewer availability, and sample size with Jordan/committee after a pilot.

The autonomy study is the proposed main comparison. The discovery baseline is a separate, smaller study or optional ablation. Do not expand into every combination of model, role count, structure, and human involvement unless the available time supports it.

## A. Three-arm comparison

| Condition | Substantive work | Human involvement | Tools |
| --- | --- | --- | --- |
| A: autonomous | Creator Agent researches, selects, plans, and solves within a frozen task envelope | Initial brief/configuration only; no task-specific help after start | Fixed approved model/tool configuration |
| B: human-in-the-loop | Same Creator Agent configuration plus recorded human decisions at fixed/dynamic gates | Actual input, timing, changes, and effort logged | Same AI model/tool access as A |
| C: human-only | Human researches, selects, plans, and solves | Human performs the work | Ordinary browser, editor, documentation, calculator and conventional tests; no generative AI, AI search summaries, or coding completion |

All receive the same problem packet, initial evidence/resources, task outcome, and declared time cap for a given problem. Standardize access to relevant data as far as practical. Log the remaining differences. The AI arms' provider spend caps apply to model/tool resources; the human arm's effort is measured in active minutes, not disguised as a token budget.

Use two task strata so the experiment does not force code on every problem:

1. **Decision tasks:** produce a source-backed problem assessment, alternatives, recommendation, and validation plan. Any appropriate response type can succeed.
2. **Implementation tasks:** selected bounded software tasks with a frozen outcome and functional acceptance criteria. All three arms receive the same task for each comparison. Report these separately from decision-task quality.

Build feasibility demonstrations chosen from discovery are a separate selected sample. A selected successful demo does not establish unbiased comparative performance on all ideas.

## Fairness and contamination

Use matched problems across conditions. A given problem has the same frozen packet and scoring standards in every arm. Do not expose later participants/agents to earlier outputs or hidden grader material.

Prefer independent participants for the same exact problem. If Jordan is the sole human participant, explicitly call it a single-participant exploratory case study. Randomizing order cannot remove knowledge learned from solving the same problem. Use matched variants/counterbalanced order where feasible, record prior familiarity and order, and clearly explain the tradeoff with exact same-problem comparability.

The person assisting condition B must not first inspect autonomous results, reference solutions, or hidden tests for that problem. Freeze initial briefs; extra domain information introduced during assistance is a logged intervention. Keep training/pilot tasks disjoint from final evaluation.

Conventional search may surface AI summaries. Specify whether to disable/avoid them and record deviations. A human-only UI cannot trigger automatic model summaries, graders shown to the participant, or hidden AI rewriting.

## Intervention and stopping rules

A runs without human task help. If an important unresolvable judgment/authorization is needed, record needs_human/deferred/blocked according to the predefined outcome taxonomy. Do not let an LLM simulate the human or silently move the result to B. If continued with help, create a linked assisted continuation and exclude it from the primary autonomous outcome while retaining the original A attempt.

B records each request and response: type, reason, trigger source, task stage, data presented, actual human input, active response minutes, wait time, resulting change, and whether it prevented/corrected a problem. Fixed gates and dynamic gates must be distinguished.

All conditions have wall-clock limits and bounded task scope. Report active AI execution, human active effort, and human waiting separately. Record cancellations, infrastructure failures, and budget exhaustion. Predetermine retry rules for external infrastructure failures; do not erase costly attempts.

## B. Discovery comparison

Compare structured AI discovery (search brief, evidence, independent alternatives, skeptic, rubric) with open-ended AI ideation. Match theme/problem packet, model version, tool availability, candidate count, and maximum resource envelope. Actual cost/time remain outcomes; comparable caps do not guarantee identical usage.

The open-ended baseline may retain neutral safety, source-verification, and output-format rules, but do not give it the structured role/rubric workflow being tested. A neutral formatter can preserve supplied text for blinded review without adding evidence or improving weak answers.

The earlier proposal of two themes × three repeats × two conditions × three ideas (12 runs/36 ideas) is a historical starting suggestion, not a finalized design. Pilot one problem per arm and one discovery pair to estimate workload and instrument errors. Choose final counts before the final run; justify the sample and limits. Avoid using pilot performance to cherry-pick only favorable themes.

## Outcomes and evidence

| Outcome | Measurement | Caution |
| --- | --- | --- |
| Solution quality | Independent anchored human ratings of usefulness, feasibility, evidence, differentiation, appropriateness | Raters blinded to condition where practical; models are secondary judges |
| Evidence reliability | Sample or census of claims, source existence, locator accuracy, support, independence, freshness, contrary evidence | A real URL alone is not supporting evidence |
| Functional completion | Frozen acceptance criteria passed on the submitted version; important defect count | Tests need execution evidence and cannot be weakened by builders |
| Human judgment | Expert/owner-coded necessary interventions, missed needs, unnecessary requests, justified non-code choices | There is no universal objective ethics score |
| Resource efficiency | Known spend, unknown exposure, calls, retries, tools, active/wall time, human minutes | Include failures; do not assume zero human cost |
| Ranking quality | Agreement between system rank and independent reviewers | Use matched candidates and report ties/disagreements |
| Traceability | Required source/decision/spec/commit/test links present and correct | Completeness does not prove truth of source claims |

Primary outcome must be named before final collection. Proposed default: mean independent solution-quality rating per decision task; functional completion is primary for the implementation stratum. Keep dimensions visible instead of burying everything in one weighted index. Human labor may be monetized only as a clearly labeled sensitivity analysis using an explicit rate.

Cost per accepted outcome = all relevant condition costs, including failures, divided by accepted outcomes. If the denominator is zero, report undefined/no accepted outcomes and total cost; do not report $0 per success.

## Review and analysis

Where feasible use two or more independent reviewers, normalized submission format, randomized presentation order, and concealed condition/model identity. Redact revealing labels without removing substantive failures, uncertainty, or requests for human help. Keep a private assignment key.

Use rubric anchors and a calibration exercise on non-study examples. Retain individual ratings; report agreement using a statistic suitable for the scale/design plus the raw disagreements. Do not label multiple model instances as independent human reviewers.

Report task-level paired differences, distributions, completion rates, confidence/uncertainty intervals when justified, and cost/effort tradeoffs. Treat ideas nested within the same run and repeated measures by the same participant as dependent. Bootstrap or model at the actual independent unit where appropriate; do not inflate n by counting every rating or idea as independent.

For a small exploratory sample, emphasize descriptive evidence and limitations. Do not claim statistical power or general superiority without an adequate design. Prespecify missing-data handling, outcome coding for blocked runs, retry/deviation rules, and any formal statistical tests. Report every assigned run in a flow/count table and keep primary assigned-condition analysis distinct from exploratory per-protocol analysis.

## Humility challenge cases

Include low-risk, synthetic cases where (a) an existing tool is sufficient, (b) a process change is preferable, (c) evidence is missing, (d) stakeholder judgment is genuinely needed, (e) software is appropriate and the agent should proceed, and (f) a source contains malicious instructions.

Annotators specify expected dispositions and acceptable alternatives before the run. Measure unnecessary escalation as well as failure to escalate. Keep exact labels and reference answers out of runtime context. Case-suite success is not a finding about every real-world ethical situation.

## Freeze and export

Freeze protocol/task packet/prompt/rubric/config hashes, actual model and SDK versions, source snapshot references, pricing versions, tool access, resource caps, seeds if supported, condition assignments, intervention policy, and analysis version. Seeds do not guarantee provider reproducibility.

Export raw events, structured run results, redacted context manifests, human interventions, ratings, code/artifact/test manifests, costs/exposure, deviations, and reproducible analysis commands. Preserve private participant data separately. Confirm the applicable institutional review/recruitment requirements with the committee before collecting participant data; do not infer approval from this document.

Do not fabricate a result when a service or participant is unavailable. The application and analysis tools can be completed using labeled fixtures; empirical claims require actual study runs.
