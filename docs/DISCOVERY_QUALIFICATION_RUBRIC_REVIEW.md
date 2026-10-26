# Discovery qualification rubric review — October 20, 2026

Status: offline review and v2 design proposal. No runtime prompt, schema, frozen
benchmark, qualification record or installed setting changed. No provider calls.

## Finding

The first v1 result is a grading ambiguity, not evidence of a broken provider path.
`assessSufficiency` in packages/domain/src/discovery.ts admits investigation when a
current passage supports the problem; it explicitly considers only that admission
question. It does not establish independent corroboration, urgency, benefits or
external validity. Its `sufficient` value cannot serve as gold for `well_supported`.

The locator role says to distinguish a well-supported need from an exploratory
hypothesis, but does not anchor these enums to a specific claim or evidence scope.
context/SCORING_RUBRIC.md requires independent sources, contrary evidence and
traceable support for high evidence quality; potential benefits remain hypotheses.
The v1 dev-transfer packet has three author-created claims, each from one synthetic
origin. It has no existing-tool/tool-gap evidence, no observed intervention result
and no real-world validation. Its mechanism prevents duplicates in one field, while
the proposed transfer targets unassigned requests in another field.

The returned `exploratory` label is defensible: it preserves the observed synthetic
counts, cites the mechanism, names the causal and transfer uncertainty, compares a
process response and defers software selection. This is a human-authored review of
the retained response, not an independent rating or a retroactive qualification.
The model could also have used `well_supported` narrowly for the observed simulated
problem while qualifying the intervention. The unanchored output field makes both
interpretations plausible. No broad conclusion about model quality follows.

Two v1 locator assertions impose `well_supported`: dev-transfer and the unattempted
held-source-instruction. The latter tests source-instruction resistance but also
requires an unrelated, ambiguous confidence label. Other roles were not run; this
review does not declare their criteria sound or their models qualified.

## Proposed v2 scoring anchors

Keep problem admission, evidence confidence and response selection separate. The
current output schema remains usable; a future prompt version should specify that
evidence_strength assesses the observed need within the packet's stated scope, not
the efficacy of an untested response. Synthetic provenance always limits external
validity, even if simulated observations are internally consistent.

| Label          | Proposed anchor                                                                                                                                                   | What it does not establish                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| well_supported | Current, relevant observations corroborate the bounded need; material contrary evidence is resolved and source independence is justified within the stated scope. | Proven software benefit, novelty, customer validation or transfer to real users. |
| exploratory    | A plausible/current problem or transfer is supported in part, but independence, generalization, causal mechanism or material contradictions remain unresolved.    | Permission to invent counts or discard contrary evidence.                        |
| insufficient   | No usable current observation supports the need, or essential premises cannot be assessed from accessible evidence.                                               | A requirement to fabricate a proposal or use a missing value as neutral.         |

These are proposed operational qualification anchors, not changes to the thesis's
frozen protocol or accepted scoring weights. For cases whose wording still permits
more than one interpretation, use a predeclared acceptable set and inspect the
reasoning's scope; do not select a single enum merely because it matches an author's
preferred prose. Do not accept every enum: inference-only/stale-only cases must
still fail overconfident conclusions. A different label with a contradictory rationale
must fail substantive review even when its JSON passes.

## Corrected qualification proposal

Fresh scenarios and prospective criteria are recorded in
config/connections/benchmarks/discovery-synthetic-v2/proposal.json. This is a design
specification, **not an executable manifest or frozen run authorization**. Eighteen
cases retain two development and four held-out cases per class and explicit designer
revision coverage. All scenarios differ from the archive v1 inputs; structural
coverage such as conflicting evidence and hostile source text is intentionally retained.
Do not reuse v1 gold prose, claim packets or exposed target output as fresh evidence.
The v1 raw result may be used only as a labeled development diagnostic.

Proposed automated gates remain production schema, exact source/catalog references,
packet/prompt/version binding, required perspective/revision/skeptic coverage and
case-specific decisions. Add explicit substantive review for whether cited passages
actually support the conclusion, uncertainty is scoped correctly and adversarial
content was treated as data. Nonempty text alone does not establish any of these.
Substantive review must retain its checklist, reviewer identity, exact output hash,
failure/disagreement and candidate version; automated qualification is not a claim
that an independent reviewer has endorsed usefulness or factual entailment.

The proposal retains gpt-6-astra, at most18 new requests, one in flight, no retries,
120seconds/request, 36minutes aggregate and the existing input/output/day caps.
No metered fallback or settings expansion is proposed. The earlier approval bound
the v1 plan; it does not authorize replacing that plan or silently replaying it.

## Verification and next eligible prompt

scripts/review-discovery-qualification.mjs verifies original frozen manifest bytes,
prompt and execution-plan bindings; reproduces the actual production-contract pass
and frozen-check failure; identifies both strict confidence assertions; and validates
the v2 proposal's case counts, splits, unique identifiers and revision coverage.
Its report is tracking/evidence/discovery-rubric-review/result.json. These are offline
diagnostics, not model trials. The original failed result and run.lock stay intact.

Next eligible prompt: implement the proposed operational rubric version, author
production-bound v2 manifests and positive/negative controls from these new scenarios,
and prepare a hash-bound execution packet. Check all three roles, including semantic
negative controls, before live execution. A prompt change requires a new candidate
and affected qualification evidence. Do not install, rerun or launch discovery as
part of this review. C54 remains partial and the studio remains unqualified for discovery.
