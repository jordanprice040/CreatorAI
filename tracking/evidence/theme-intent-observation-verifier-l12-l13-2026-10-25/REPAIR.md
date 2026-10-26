# L12/L13 verifier-only repair — October 25, 2026

Owner authorized the exact next prompt in the L11 independent review. This new
evidence directory contains a successor verifier and receipt; classifiers v1-v4,
tests, notes, prior reports, verifiers and receipts remain unchanged.
The author implemented these files and is not an independent reviewer.

## Changes and executed checks

L12: non-declaration for-of/for-in initializers now use the existing write-target
locality check, including its destructuring traversal. Declaration lists keep their
normal lexical binding behavior. L13: a ConstructorDeclaration must have its own
ConstructorKeyword child token. Modifiers and body tokens cannot substitute for it;
quoted and escaped quoted names have no such keyword token.

The seven exact L12/L13 forms from the review are negative self-tests and are also
checked against the frozen L11 guard to reproduce acceptance there. All L11 mutants,
controls, baseline reproductions and historical TAP checks are retained. Added
positive controls cover declaration loops, local loop targets, local member targets,
and ordinary/static keyword constructors. Mutant programs are never executed.
Only extracted guard functions run over source strings; no older verifier entry
point is executed. The unchanged classifier-v4 source must still be admitted.

Exact input hashes, preservation counts and self-test results are recorded in the
new repair-receipt.json. Default mode is check-only and must leave receipt bytes
unchanged; --record creates it exclusively with wx. Historical classifier TAP
20/20 is read, not rerun or claimed as fresh testing. No classifier behavior changed.
Tracking exclusions, if any, are listed explicitly; no nonzero count is presumed.

The guard remains supplemental, not general purity, alias or side-effect analysis.
Local alias and parameter alias writes remain documented limits. This change grants
no operational authority. No collector or operational adapter exists. No operational
config/environment/credential, registry/process/port/mutex/event read, launch, SQL,
provider/workflow activation, recovery or retired-checkout access occurred.
M3 unchanged; native acceptance blocked, H unverified, full C54 partial.

## Next eligible prompt: independent U02 review

Review this verifier, report and receipt against the exact final prompt in
 docs/THEME_INTENT_OBSERVATION_VERIFIER_L11_REVIEW_2026-10-25.md.
Disclose authorship/involvement and same-family/non-blinded limitations. Rehash all
receipt inputs; run only this new verifier with NO arguments and verify receipt
bytes unchanged. Independently parse the seven L12/L13 source strings through the
frozen L11 guard and successor; do not execute mutants or older verifier entry points.
Check declaration and local loop controls, destructuring write targets, modifiers,
escaped quoted constructor names and keyword constructors. Confirm all L11 mutants
and controls remain, and unchanged classifier-v4 bytes are admitted. Distinguish
historical TAP evidence from checks actually executed. Do not fix findings.

Repository and synthetic data only: no config/environment/credentials, OS/registry/
process/port/mutex/event access, launch, SQL, activation, recovery or retired checkout.
Preserve all existing evidence and source bytes. Never use --record or record-baseline.
Write docs/THEME_INTENT_OBSERVATION_VERIFIER_L12_L13_REVIEW_2026-10-25.md and
tracking/evidence/theme-intent-observation-verifier-l12-l13-review-2026-10-25/reviewer-receipt.json.
Update BUILD_STATUS and SESSION_HANDOFF. Report exact hashes, checks actually run,
severity/reproduction/evidence and separate verifier, fixture, collector and native
readiness verdicts. End with the smallest next eligible prompt, without executing it.
Full C54 remains partial.
