# Discovery field semantics and identity assertions — October 21, 2026

Implemented the bounded follow-up to the [assertion audit](DISCOVERY_ASSERTION_SEMANTICS_AUDIT.md).
Discovery role version is now `r02-discovery/1.3`; production output schemas, limits,
authority and budgets are unchanged. This source candidate is not installed or live
qualified. The installed role1.2 app and its recorded v3 results remain unchanged.
New prompt hash: `024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77`.
New prompt hash: `024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77`.

Model-facing instructions now define novelty as an affirmative evidence-backed
distinctiveness claim, requiring null when none is established. Routine-method
explanations belong in mechanism/feasibility. `software_warranted` explicitly means
new/custom software, distinct from using an existing tool. Locator hypotheses remain
conditional when supported; gaps must retain consequential uncertainty. Skeptic
instructions bind references to the actual proposal/finding and require a bounded
disconfirming comparison, or null with a reason when no permitted test exists.
Revision instructions retain all findings, including reasoned disagreement.

The benchmark assertion contract has an optional `select`. Its absence preserves
legacy behavior and canonical hashes; it has no default. A selector is legal only
for a skeptic task and one actual supplied proposal identity. Finding selectors
can bind a finding type, catalog reference (including null), and claim reference.
Unknown references, unsupported types/identities and extra keys are rejected by
the contract. Example for a newly authored benchmark:

```json
{
  "select": {
    "proposal": "P2",
    "finding": { "type": "duplicate", "catalog_ref": "K1", "claim_ref": "C2" }
  },
  "path": ["catalog_ref"],
  "op": "equals",
  "value": "K1"
}
```

`path` is relative to the selected review, or selected finding when `finding` is
present. Exactly one target must match. Missing or ambiguous findings fail; there
is no first-match fallback. Review/finding order is immaterial. The existing four
operators retain their behavior after selection. The existing maximum 20 assertions,
bounded paths, five reviews and eight findings per review limit evaluation work.

These are structural and reference-association checks. They do not prove narrative
entailment, adequate revision coverage, justified novelty, or useful interventions.
Independent substantive review remains required, bound to the exact candidate and
outputs. Legacy presence checks retain their disclosed weaknesses for historical
reproducibility, rather than silently acquiring a new meaning.

Tests use explicitly local copies of historical controls; no changed manifest is
presented as fresh qualification. Historical v1–v3 bytes, raw outputs and failure
records remain intact. Version changes invalidate qualification for the new role;
no saved qualification state is rewritten. The v3 test now treats its frozen prompt
as historical while retaining its exact manifest/control hashes and original grades.

Evidence and executed checks are recorded in
`tracking/evidence/discovery-semantics-implementation/`. The source build and selected
tests exercise local code and stand-ins, not the real plan provider. No installer,
provider call, search, workflow pilot or external integration activation is part of
this step. Full discovery/C54 remains partial.
TypeScript passed using the installed compiler directly after the pnpm launcher
could not resolve registry metadata. All38 affected tests passed,0 failed/0 skipped,
including the v3 qualification invalidation workflow. The disposable database was
stopped. Nineteen bound configuration/evidence files, historical suite hash checks
and the installed manifest were verified unchanged.
TypeScript passed using the installed compiler directly after the pnpm launcher
could not resolve registry metadata. All38 affected tests passed,0 failed/0 skipped,
including the v3 qualification invalidation workflow. The disposable database was
stopped. Nineteen bound configuration/evidence files, historical suite hash checks
and the installed manifest were verified unchanged.

Next eligible prompt: author complete fresh qualification packets, prospective
assertions and positive/negative controls using the audited scenario proposal;
verify serialization, input/HTTP bounds, role/prompt binding and substantive review
checklists, then freeze a concrete candidate/execution proposal. Do not reuse exposed
v3 outputs as fresh held-out evidence or automatically install/dispatch the next suite.
