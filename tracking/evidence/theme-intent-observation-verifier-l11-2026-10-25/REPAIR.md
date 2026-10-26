# L11 verifier-only repair — October 25, 2026

Owner authorized the exact successor-verifier prompt in the v4 independent review.
Classifier v4 and its tests, reports, notes and evidence remain byte-identical.
This directory contains a new verifier and an exclusively created repair receipt.
The author is involved; independent review is pending.

The two added rules reject dangerous quoted property names in name/propertyName
positions and writes rooted in non-local identifiers. Writes include assignment,
compound/logical assignment, delete and prefix/postfix increment/decrement; nested
members, parentheses and destructuring assignment targets are traversed. Imported
bindings are not treated as mutable local state. Local mutation controls remain
admitted. All v4 negative mutants and TAP checks are retained.

The verifier extracts only the old purityGuard function for parse-only baseline
checks of quoted constructor destructuring and Number/Array mutation. It never
executes the old verifier entry point or the mutant programs. New negative cases
cover all three dangerous names in binding, object-property, method and class-name
positions, plus write forms and lexical scope. Positive controls cover local writes,
shadowing, benign quoted keys and a harmless constructor string value.

The verifier checks prior receipt/review hashes and unchanged classifier-v4 source.
It reads historical 20/20 TAP and U7 evidence; it does not rerun classifier tests.
No classifier behavior changed, so those previously executed tests were not rerun.
Counts and exact hashes are in repair-receipt.json. Default mode writes nothing;
--record creates the receipt once with wx. Historical mutable tracking exclusions,
if any, are listed individually; the count is not implied to be nonzero.

This remains a supplemental source guard, not an arbitrary-JavaScript purity proof.
Lexical root checks are not alias or side-effect analysis. Local aliases, input
getters/proxies, mutated intrinsics and arbitrary method behavior are not proven
safe by this guard. No collector or real-config adapter exists. No operational
configuration, environment, OS/registry/process/port/mutex/event/credential read,
launch, SQL, activation or retired-checkout access is authorized or performed.
M3 unchanged; native acceptance blocked, H unverified, full C54 partial.

## Next eligible prompt: separate uninvolved U02 review

Review this new verifier and report against the final exact prompt in
 docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V4_REVIEW_2026-10-25.md.
Disclose involvement. Rehash all new receipt inputs, run only this verifier WITHOUT
--record and confirm receipt bytes unchanged. Inspect quoted-property-name coverage,
all write target forms, lexical locality, preserved v4 mutants and local controls.
Independently reproduce the L11 old/new guard outcomes by parsing source strings;
do not execute mutant programs or older verifier entry points. Distinguish historical
classifier TAP evidence from checks actually executed in this review. Confirm all
accepted classifier and earlier evidence bytes remain unchanged. Do not modify them.

Repository/synthetic-only scope: no operational config/environment/credentials, OS,
registry, processes, ports, mutex/events, launch, SQL, activation, recovery or retired
checkout. Write docs/THEME_INTENT_OBSERVATION_VERIFIER_L11_REVIEW_2026-10-25.md and
tracking/evidence/theme-intent-observation-verifier-l11-review-2026-10-25/reviewer-receipt.json.
Update BUILD_STATUS and SESSION_HANDOFF. Give severity, reproduction, exact evidence,
bounded verdict and smallest next eligible prompt; do not implement that next step.
Keep verifier support, fixture correctness, collector existence and native readiness
separate. Full C54 remains partial.

Implementation check history: the first guard run failed on a negative mutant; a
diagnostic rerun identified Number.isSafeInteger assignment. TypeScript may attach
assignment declarations to a free name. The repair now requires actual lexical
declaration kinds for write-root locality, including shorthand targets. Both failed
runs stopped before receipt creation; no mutant program executed.

A third pre-receipt self-check exposed TypeScript's special ConstructorDeclaration
representation of a quoted class constructor (no name child). The guard now also
checks that declaration's first token. No classifier change was needed.

The first-token attempt also failed before receipt creation: TypeScript's synthetic
StringLiteral token has no text value. Decoding its spelling with the TypeScript
scanner handles the quoted constructor, including escaped spelling.
