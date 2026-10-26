# Finding semantics implementation — October 22, 2026

Implemented locally in the actual discovery skeptic prompt as role r02-discovery/1.4.
Derived prompt hash: c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8.
Unsupported benefit/causal premises use weak_evidence; novelty_overclaim describes
unsupported originality. Definitions also cover duplicate, infeasible_assumption,
counterevidence and other. The per-proposal cheaper_test field is authoritative;
the legacy finding type remains optional and must agree with it. No wire schema,
checker selectors, permissions, budgets or output normalization changed.

Role guidance updated. Two existing current-prompt tests now expect role1.4; frozen
manifests, old prompts, live outputs, assertions and grades remain unchanged.
New author-visible sorting-procedure calibration tests exercise the rendered system
prompt and unchanged schema, distinct benefit/originality findings, optional typed
test duplication, prohibited dependencies/null, adverse source association, missing
reviews, wrong-proposal/source/catalog bindings and forged references. A deliberate
contradictory narrative still passes structural checks, documenting the need for
substantive review; these tests do not establish model behavior or source entailment.

Executed: node node_modules/typescript/bin/tsc -b passed.
node --test tests/discovery-finding-semantics.test.mjs
tests/dist/discovery-identity-assertions.test.js
tests/dist/discovery-output-contract.test.js passed23,failed0,skipped0.
The pnpm launcher produced no output and was cancelled; direct installed TypeScript
completed successfully. Initial tests exposed incorrect expectations about missing
field error classification and historical-context inspection; expectations corrected
without altering production guards.

Verified all8 historical live-result artifact hashes, unchanged contract schema,
and unchanged installed bundle identity. The old frozen execution guard now refuses
the changed local candidate; preserved failure output is in the evidence directory.
The installed app remains role1.3. No new provider calls, installation, live suite,
quota reset, schema migration or historical regrade occurred. Full discovery/C54
remains partial.

Next eligible U02: affected independent review of the local role1.4 prompt,
calibration tests and preserved historical evidence. Then prepare a new evaluation
packet/candidate binding if review supports it; old locked/exposed cases cannot
be resumed or presented as independent new holdouts.

[Receipt](../tracking/evidence/discovery-finding-semantics-implementation-2026-10-22/result.json),
[test transcript](../tracking/evidence/discovery-finding-semantics-implementation-2026-10-22/tests-final.tap).
