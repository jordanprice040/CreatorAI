# Proposed discovery finding semantics — October 22, 2026

Status: prospective U03 specification proposal, prepared but not implemented or
installed. This resolves the ambiguity identified by the
[seven-output review](DISCOVERY_FOLLOWUP_V2_OUTPUT_REVIEW_2026-10-22.md).
The historical scoring failure remains failed/incomplete. Neither old assertions
nor saved outputs are changed or regraded.

The current production prompt lists finding types without defining their boundaries.
It explicitly describes `reviews[].cheaper_test`, but does not require the same
comparison in `findings[]`. The frozen scoring case nevertheless requires a
`novelty_overclaim` finding for an unsupported benefit guarantee and a `cheaper_test`
finding for an objection about hosting. The checker correctly enforces those frozen
assertions; the specification does not adequately justify the expected labels.

## Recommended prospective definitions

| Finding type | Meaning and required support |
| --- | --- |
| `weak_evidence` | A consequential premise or benefit lacks adequate support, including an unsupported universal outcome guarantee, unexecuted comparison presented as proof, or unjustified causal inference. Name the unsupported claim and cite its supplied evidence. |
| `novelty_overclaim` | A claim of originality or distinctiveness exceeds the supplied comparison with existing alternatives. Absence of a catalog match does not prove novelty. An efficacy claim alone is not a novelty claim. |
| `duplicate` | A supplied catalog entry materially matches the proposal. Cite the actual proposal's claim and the matching catalog reference; explain the equivalence. A merely similar title is insufficient. |
| `infeasible_assumption` | A consequential dependency is unavailable, unauthorized, incompatible with a stated constraint, or otherwise unsupported as feasible. Distinguish a known prohibition from an unresolved dependency. Never grant access by recommending it. |
| `counterevidence` | A supplied observation, constraint, or alternative weighs against the proposal or its incremental value. State what it contradicts. Unknown effectiveness alone is weak support, not an invented adverse observation. |
| `other` | A consequential issue that does not fit the defined categories. Explain it concretely; do not use it to hide a source/authority issue. |
| `cheaper_test` | Retain as a legacy-compatible finding value in the existing schema. A finding with this type may describe a test, but is not the authoritative place for the executable comparison description. New evaluation must not require redundant encoding here. |

These categories are not exclusive: a proposal can be both a duplicate and make an
unsupported originality claim. Separate findings are appropriate when they express
distinct issues. Do not force every proposal to have every type or pad the eight
finding limit. Reference validity, correct proposal/source association, and actual
entailment remain separate requirements; labels alone do not prove them.

## One authoritative cheaper-test field

Use `reviews[].cheaper_test` as the authoritative per-proposal comparison. Preserve
the current required nullable string and the existing finding enum for compatibility.
No migration, second test field, or output normalizer is proposed. Never rewrite a
model's finding label after delivery to make it pass.

A non-null cheaper test must specify a permitted bounded action, an observable
comparison or result, and a condition that could change the recommendation. It is
a proposed test, not an executed result. A paper comparison or existing tool can be
appropriate; custom software and live data are not prerequisites. If no permitted
test can address the consequential dependency, return null and explain that limit
in the relevant findings. Do not fabricate access, spending, or completed checks.
If a legacy `cheaper_test` finding is also present, it must agree with the authoritative
field; it is optional and does not replace that field. Contradictions require review.

## Alternatives and consequences

1. Keep exact typed-test duplication and broaden novelty to include efficacy. This
   could preserve old assertion conventions prospectively, but conflates distinct
   concepts and requires redundant descriptions. Not recommended.
2. Remove the legacy enum value or introduce a structured test object now. This
   gives a cleaner future schema, but causes unnecessary compatibility/versioning
   work for the present ambiguity. Defer until a product need warrants it.
3. Use human/model review alone or accept any nonempty text. This loses deterministic
   identity/source controls. Retain those controls and substantive review together.
4. Defer further live qualification while preparing the specification. This is the
   current state; no further provider request follows from this proposal.

The recommendation follows the meaning of the existing fields and separates
originality from efficacy. It is informed by an exposed development failure;
historical results must not be used as independent validation of this proposal.

## Bounded implementation plan

Next eligible U03 implementation: add these semantics to the production skeptic
prompt and publish a new discovery role version (proposed `r02-discovery/1.4`) and
new derived prompt hash. Document matching role guidance. Keep the wire schema,
reference associations, admission rules, budgets, installed candidate and old
evidence unchanged unless a separately scoped implementation requires otherwise.
Do not claim a version switch before code/build evidence establishes it.

Tests should exercise the actual rendered system prompt and production checker
using new domain-neutral calibration examples: an unsupported speedup claim versus
an unsupported first-of-its-kind claim; a cheaper manual comparison with an explicit
decision condition; a prohibited-data dependency with no permitted test; and an
adverse supplied measurement that cannot be erased by proposing a later test.
Include positive and negative examples, wrong-proposal and wrong-source bindings,
forged references, missing reviews, schema-invalid output and contradictory claims.
Nonempty strings cannot deterministically establish entailment; preserve substantive
review for semantic adequacy rather than disguising a text-presence check as proof.

Prospective evaluation should assert unsupported benefit through `weak_evidence`,
novelty through `novelty_overclaim` only where originality is actually claimed, and
the permitted test through the per-proposal `cheaper_test` field. Associate every
requirement with the correct proposal and source. Define observable expectations
before outputs exist; do not broaden selectors to let unrelated findings satisfy them.
Calibrate structural/schema controls separately from substantive reviewer criteria.

Any later live evaluation needs a new packet/plan and current candidate bindings.
Preserve the four held-out cases per class and acceptance floor unless an explicitly
versioned protocol decision changes them. Do not reuse the five unattempted but
author-visible old scoring cases as fresh independent holdouts. Keep author-visible
synthetic operational evaluation distinct from thesis holdouts and customer evidence.
No new suite, installation, quota refresh, cap change, retry, or pilot is authorized
by preparation of this document.

## Completion evidence and remaining limits

The proposal is grounded in the production schema/prompt, the unchanged frozen
manifests, saved failure diagnosis and separate exact-output review. A preparation
receipt records their hashes and preservation checks. No runtime implementation,
API/SDK dependency change, new test execution against changed behavior, provider
call, model review of this proposal, or human acceptance is claimed. Full discovery
and C54 remain partial. Next: implement this prospective clarification locally,
verify the rendered prompt and source-association controls, then obtain affected
candidate review before preparing any new live qualification.
