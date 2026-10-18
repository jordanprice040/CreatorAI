# Candidate assessment and ranking rubric

Version 1.0 — proposed starting rubric; pilot, revise, and freeze before evaluation.

Use a 1–5 ordinal rating with written evidence for each criterion. Scores 2 and 4 are intermediate anchors. Use unknown when evidence is missing; unknown is not a neutral score. Confidence is a separate categorical judgment with rationale, not a probability.

| Criterion | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Urgency/severity | Minor or weakly supported inconvenience | Repeated consequential difficulty for an identified group | Strong corroboration of frequent or severe impact within the defined scope |
| Potential benefit | Unclear outcome or marginal plausible improvement | Specific plausible outcome with an assessable measure | Substantial plausible improvement with strong mechanism/evidence and a validation plan |
| Software influence | Main constraint is outside software's control | Software can materially help one part, with dependencies | A clear mechanism directly improves the target outcome and can be measured |
| Feasibility | Required resources/data/skills unavailable | Bounded prototype possible; important risks remain | Resources and data are accessible and critical feasibility risks have been tested or strongly supported |
| Differentiation | Existing alternatives address the need similarly | A specific incremental advantage or underserved use case | Clearly supported meaningful difference against the alternatives actually examined |
| Evidence quality | Unsupported assertions or poor sources | Credible relevant evidence with some corroboration/gaps | Multiple independent, directly relevant sources, contrary evidence considered, traceable support |

Initial weights are equal (1/6). For fully scored software candidates:

score_0_to_100 = 100 × sum(weight_i × (rating_i − 1) / 4)

These are transparent prioritization scores, not validated probabilities, expected revenue, or measured impact. Do not display more than one decimal. Keep the unrounded values for reproducible ranking.

## Missing values, ties, and robustness

Do not silently renormalize weights around unknown criteria. Show an incomplete assessment. For an optional score interval, substitute 1 and 5 at missing positions to show a lower/upper bound, label it explicitly, and avoid presenting a midpoint as observed.

Show overlapping score ranges as unresolved. A pilot may define a material tie band; until then do not invent a rigid tie threshold. Sensitivity-check whether reasonable weight changes alter the shortlist and preserve that report.

Reviewer disagreements are retained, not overwritten by a model's consensus. An owner override preserves the original ranking, reason, actor, and timestamp. Do not select a candidate solely because the aggregate is highest.

## Avoid software-selection bias

Software influence is appropriate when prioritizing problems for a software prototype. It must not mechanically disqualify a better non-software response to the same problem.

For cross-option selection, use a separate **solution-suitability rubric**. The following are proposed anchors to calibrate during the pilot; 2 and 4 are intermediate. Use equal weights initially and the same missing-value rules. Unresolved ethical/access issues remain gates. Record software influence descriptively for every option but exclude it from this cross-option total.

| Suitability dimension | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Problem fit | Does not address the observed cause | Addresses an important part of the need | Directly addresses the central observed need for the specified users |
| Expected outcome | No credible improvement mechanism | Plausible improvement and measurable criterion | Strongly supported improvement mechanism and a feasible validation path |
| Feasibility/resource burden | Requires unavailable resources or unjustified effort | Achievable with known gaps and bounded effort | Available resources and a proportionate, well-supported path |
| Evidence support | Critical premises unsupported | Relevant support with stated gaps | Independent relevant support and contrary evidence addressed |
| Maintenance burden | Ongoing obligations cannot be supported | Manageable obligations with a plausible owner | Low/proportionate obligations with an explicit sustainable owner/process |
| Stakeholder acceptability | Known serious unresolved conflict or exclusion | Relevant stakeholders considered; validation still needed | Strong evidence of contextual fit and affected-user input, with residual limits stated |

The study's human quality rubric is separate again: usefulness/problem fit, feasibility, evidence reliability, originality/differentiation, and appropriateness of the proposed response. A recommendation to adopt an existing tool can score highly on appropriateness without claiming originality. Use the corresponding anchors above for fit, feasibility and evidence; use the opportunity rubric's differentiation anchors for originality. For appropriateness, 1 means the response type is unjustified or ignores important constraints; 3 means it is plausible but overlooks a meaningful alternative; 5 means the response type is well justified against relevant alternatives and respects known human-judgment limits. Freeze this mapping before final ratings and show each dimension separately.

## Evidence and selection checks

Every assessed candidate identifies target users, current workaround, sources supporting the problem, contrary evidence, alternatives checked with dates, measurable outcome, assumptions, proposed validation, and maintenance implications.

No universal claim of uniqueness; say what sources and competitors were checked. A potential benefit remains a hypothesis until evaluated with relevant users/outcomes. Count repeated copies of a source once for corroboration.

Final disposition: proceed to validation, select for build within authority, recommend an existing/non-software/human-led solution, research further, defer, or reject. Capture reasons and what would reverse the decision.
