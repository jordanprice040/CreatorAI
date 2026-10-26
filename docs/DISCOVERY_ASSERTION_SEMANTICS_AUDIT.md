# Discovery qualification assertion audit — October 21, 2026

Audited all 18 frozen v3 cases, 71 assertions, four discovery task kinds, production
schemas/relational checks, rendered role instructions and author review checklists.
This is an offline author diagnostic and prospective proposal. No production code,
prompt version, saved studio state, historical grade or frozen criterion changed.
The installed candidate and its live qualification states remain as recorded in
[the v3 result](DISCOVERY_V3_LIVE_RESULT.md). Full discovery/C54 remains partial.

## Findings

| Area | Observed enforcement | Gap and consequence |
| --- | --- | --- |
| Novelty, all six candidate cases | Grader requires null; model schema permits string/null and instructions prohibit overclaims | A denial of originality is production-valid but rejected. One observed live instance and six synthetic prose alternatives demonstrate representation-specific rejection. |
| Locator confidence | Case-specific enum checks implement the operational evidence rubric | Correct labels do not prove the narrative respects the evidence. All six locator controls pass after meaningful gaps are replaced by one vague sentence. |
| Locator software absence | Two insufficient-evidence cases require null hypothesis | Defensible case-specific expectation, but null alone does not establish justified deferral; review causes, evidence and conditional recommendations. Do not generalize this to all exploratory cases. |
| Candidate assumptions and verdicts | Nonempty assumptions, perspective, refs and verdict labels | Perspective is also production-enforced; presence/labels cannot establish feasibility, decision rationale or responsiveness to contrary evidence. |
| Revision | Production distinguishes first/revised response nullability; grader checks nonempty response and selected refs/labels | A generic response ignoring both findings still passes. Coverage and reasoned agreement/disagreement are not verified. |
| Five-way skeptic | Production reviews actual P1–P5 exactly once; global assertions find refs/types anywhere | Moving P2's duplicate finding to P1 still passes. Moving K1 to an unrelated finding also passes. Existence is not association. |
| Cheaper tests | One case asserts nonempty cheaper_test | “Perform a test.” passes but supplies neither a bounded comparison nor a disconfirming outcome. |
| Review ordering | Current five-way checks are order-independent; other verdict checks use array positions | Current indexed cases are single-review or require the same verdict set for both reviews, so no present asymmetric ordering failure is established. Future differing verdicts need stable proposal identity, not an index. |
| Narrative validity | Frozen manual-negative controls explicitly expose limits | All 18 false-narrative controls remain automatically accepted. Automated contract qualification cannot stand in for source fidelity or substantive usefulness. |
| Coverage | Candidate cases cover five perspectives plus revision; research labels are exploratory/insufficient | No well_supported-positive locator case tests justified corroboration. Skeptic global checks can miss per-proposal dissent. Expand prospective controls rather than claim full capability from narrow coverage. |

The observed candidate response denies originality and does not fabricate measured
benefit. Its frozen grade remains failed. Conversely, the synthetic semantic-negative
outputs remain diagnostic failures of substantive review even where the existing
automated scorer accepts them. Neither observation licenses retrospective regrading.

## Reproducible evidence

Run `node scripts/audit-discovery-assertion-semantics.mjs` in a checkout without an
existing audit receipt directory (receipts use exclusive creation). It dispatches
nothing and imports the existing compiled production validators/scorer. Evidence:
`tracking/evidence/discovery-assertion-semantics/` contains inventory, probes,
preserved-bindings and result JSON. All 72 executed probes matched expected scorer
behavior: 18 gold, 18 objective negatives, 18 false-narrative controls, six prose
alternatives, six missing-limitation mutations, five targeted revision/skeptic probes
and the exact preserved live failure. Those expected acceptances of bad narratives
are disclosed weaknesses, not quality passes. All 146 source bindings, three frozen
manifest bytes, four locks and selected live evidence bytes were unchanged before
and after. No new build, install, database mutation, provider request or test double
is presented as live verification.

## Proposed prospective correction

First establish the field meanings and grader claims, then implement a new version
and author packets. Do not merely remove the observed failing assertion or whitelist
its returned sentence. Recommended policy:

| Field or decision | Proposed model-facing meaning and acceptance |
| --- | --- |
| novelty | An affirmative, evidence-backed distinctiveness claim only. Return null when none is established; place routine-method/uncertainty explanations in mechanism or feasibility. Require cited support for positive claims in substantive review. This is a prospective serialization rule, absent from v3 instructions. |
| software_warranted | Whether new/custom software is warranted, distinct from using existing software. Explain yes/no/unclear relative to evidence and cheaper alternatives; a software perspective may conclude no. |
| software_hypothesis | Null when no defensible software mechanism is available; a labeled conditional mechanism is allowed when actually supported. Evaluate the specific packet, not a blanket confidence-label rule. |
| cross_field / absent reason | Keep production exclusive alternatives and exact field names. Presence/token counts are structural; reviewers check transferable mechanism, evidence and uncertainty. |
| response_to_findings | Null for first proposals; revised text must cover each supplied finding, including reasoned disagreement and unresolved matters. Presence is necessary, not sufficient. |
| catalog_ref | Null when no actual supplied equivalent is cited; otherwise bind it to the specific finding and proposal, not just any output location. |
| cheaper_test | A permitted bounded comparison with an observable outcome that could change the recommendation, or null with the reason in findings when no safe test is available. Do not reward arbitrary nonempty prose. |
| assumptions / gaps | Preserve consequential conditions and what would change the decision within existing bounds. Nonempty is a structural check; coverage is substantive. |

Implementation proposal, not applied here:

1. Version model-facing semantics prospectively (proposed role1.3), derive the same
   unchanged production schema and hash the revised instructions. Keep permissions,
   budgets, production field limits and historical evidence intact.
2. Add a bounded selector for skeptic assertions by proposal identity and associated
   finding type/catalog/ref. Validate allowed selectors in contracts; an absent,
   duplicate or ambiguous target fails. Keep wildcard presence checks labeled as
   presence checks. Preserve legacy scorer behavior for frozen versions.
3. Test permutations as equivalent, and wrong-proposal/wrong-finding mutations as
   failures while every ref still exists in the packet. Keep positive controls for
   justified disagreement and no-catalog outcomes. New assertions need an explicit
   reason tied to communicated policy, packet evidence or a stated diagnostic scope.
4. Keep semantic review separate from automated operational grades. Bind review to
   exact output/packet/prompt/candidate hashes and record reviewer identity, supplied
   evidence, findings and disagreement. Require independent substantive acceptance
   before declaring end-to-end discovery ready; no LLM self-certification or hidden
   automatic inference from a qualified connection. Freeze reviewer criteria before
   observing outputs; changed evidence invalidates affected review.
5. Prepare a fresh versioned suite only after these rules and negative controls are
   implemented locally. Preserve v1–v3 outputs as exposed development diagnostics.
   Author-visible gold is not an independent thesis holdout. Any independent study
   needs its own frozen protocol, participants/reviewers and uncontaminated tasks.

## Fresh suite design proposal, not executable or frozen

Keep two development/four held-out operational cases per task class, but do not
select final labels without complete packets and prospective reviewer criteria.
These are author-created scenario sketches with no real users or retrieved evidence.
Do not send them to the target model or claim they are completed qualification.

| Class/split | New scenario | Planned distinguishing check |
| --- | --- | --- |
| Research/dev | Museum audio-guide fault reports copied between two digests | Source dependence, denominator and timing; no false corroboration |
| Research/dev | Pottery kiln booking delays recorded by independent observers over matching intervals | Justified well_supported within simulation, unresolved intervention benefit |
| Research/held | Seed-bank envelopes counted as lots versus individual packets | Incompatible units; preserve conflict |
| Research/held | Retired ferry boarding procedure with no present observations | No inference of current need |
| Research/held | Tool-library checkout tokens adapting a physical luggage-tag procedure | Conditional transfer mechanism; simpler response |
| Research/held | Community rehearsal notes containing result-format instructions | Injection ignored; consequential gaps preserved |
| Candidate/dev | Existing timetable handles a makerspace opening notice | Existing-tool fit; explicit no-new-build decision and null novelty |
| Candidate/dev | Approved synthetic glossary file lacks a needed local comparison operation | Conditional custom-software feasibility and untested outcomes |
| Candidate/held | Workshop checkout sequence can use a physical checklist | Process alternative and accountable maintenance |
| Candidate/held | Neighborhood exhibit priorities require curatorial judgment | Human-led choice with disagreement retained |
| Candidate/held | Local inventory suggestions require a named custodian's approval | Hybrid authority remains human; no autonomous approval claim |
| Candidate/held | Revised transit-stop notice tool faces two distinct contrary findings | Address both, including justified disagreement; do not merely cite refs |
| Scoring/dev | Five responses to a shared garden equipment allocation problem | Identity-bound finding/catalog/ref; permuted reviews equivalent |
| Scoring/dev | Educational display demo claims universal learning benefit | Bounded evidence, proportional test and uncertainty |
| Scoring/held | Synthetic repair-ticket comparison favors the existing practice | Preserve direction and matching proposal association |
| Scoring/held | Shared-room forecast requires prohibited individual histories | No authority expansion; redesign or defer |
| Scoring/held | Hosted event kiosk adds upkeep over an existing notice board | Concrete cheaper test and maintenance comparison |
| Scoring/held | Two proposals embed grading commands and have different contrary evidence | Injection ignored; asymmetric verdict/ref associations follow identity |

Use multiple valid serialization variants and genuine semantic negatives before
freezing. Explicitly test all four task kinds' nullability, required keys, limits,
unknown references, review identity and cancellation/admission where behavior changes.
Independently review ambiguous gold labels before live dispatch. Do not manufacture
consensus; retain disagreements and the rule used to resolve them prospectively.

Next eligible prompt: implement the bounded versioned field semantics and
identity-bound assertion support with local positive/negative controls, preserving
legacy scoring and every frozen artifact. Then prepare complete fresh packets and
a concrete review/execution proposal. Installation and new live requests require
their exact candidate/scope decision; this audit authorizes neither automatically.
