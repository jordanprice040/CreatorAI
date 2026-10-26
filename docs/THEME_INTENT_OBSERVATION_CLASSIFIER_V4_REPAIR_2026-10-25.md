# Observation classifier v4 fixture repair — October 25, 2026

Owner authorized the bounded next prompt in the v3 independent review. New v4
changes only the L9 sample-uncertainty pre-scan and preservation of its incident
reason in the loop. v1-v3 and all frozen notes, evidence and decisions are preserved.
The v4.4 additive note corrects the v4.3 overstatement without changing sample
availability semantics. The author implemented these files and is not independent.

## Evidence

Executed node --test tests/theme-intent-observation-classifier-fixture-v4.test.mjs:
20/20 groups passed, zero failures/skips. The 18 inherited groups are retained;
new groups cover U1-U7/U10 early returns, multiple uncertain values, explicit-launch
priority, unavailable/contradictory same-sample controls and INVALID_WINDOW with
window launch flag false. No inherited assertion was weakened.

record-baseline.mjs records the U7 regression: v3 unknown/INVALID_CLOSURE_TIMING
versus v4 blocked/LAUNCH_NOT_EXCLUDED. Its output is baseline-probes.json. Tests and
these probes were executed separately; the verifier reads their recorded evidence.

The new verify.mjs checks prior review and repair maps, records overlapping bindings
and distinct paths separately, and excludes only explicitly listed historical
mutable tracking hashes. It uses lexical free-identifier allowlisting, rejects
ComputedPropertyName and tests the L10 computed-destructuring, descriptor Function,
Intl clock/environment, console, prototype mutation, structuredClone, WebAssembly,
Atomics and Promise mutants, plus scope-leak and shorthand-reference cases.
It retains the older structural mutants and anchored unique TAP total checks.
The guard is supplemental, not proof of arbitrary JavaScript purity.

Evidence directory: tracking/evidence/theme-intent-observation-classifier-v4-2026-10-25/.
Default verifier is check-only; --record creates repair-receipt.json exclusively.
The receipt supplies exact hashes and executed guard/preservation counts.
An initial generation command stopped on a line-ending-dependent replacement
assertion before writing source/tests; its following test command found no file.
The replacement was corrected; the first actual v4 fixture suite passed 20/20.

No operational config, environment, registry, process, port, lock/event, SQL,
credential, application launch or retired checkout access occurred. No collector or
real-config adapter was implemented. Reader N1-N4 and collector L1/L4 stay pending;
M3 stays unchanged. Native acceptance remains blocked, H unverified, full C54 partial.

## Next eligible prompt: separate uninvolved U02 review

Review the exact classifier-v4, its tests, this repair report, the v4.4 note and
all files in the v4 evidence directory against the v3 review's final repair prompt.
Disclose authorship/involvement and same-family or non-blinded limitations. Rehash
all receipt inputs, run only the new verifier WITHOUT --record, confirm receipt
bytes unchanged, and independently run the v4 fixture suite. Reproduce U7 against
frozen v3. Probe L9 precedence, explicit-launch priority and unchanged availability
split; retain M1-M4, L6/L8 and all existing timing, binding and key gates. Evaluate
lexical free-identifier resolution and computed-property rejection against L10,
including scope and shorthand cases. Do not count recorded TAP as your own run.

Use only repository files and synthetic data. No operational config/environment,
registry/process/port/mutex/event observation, app launch, SQL, credentials, provider,
workflow, recovery or retired checkout access. Do not modify frozen implementation
or evidence, run old verifiers or use any --record mode. Write a new
 docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V4_REVIEW_2026-10-25.md and a separate
 tracking/evidence/theme-intent-observation-classifier-v4-review-2026-10-25/reviewer-receipt.json;
update BUILD_STATUS and SESSION_HANDOFF with bounded verdicts, exact hashes, tests
actually run, findings and the smallest next eligible prompt. Do not implement that
next prompt. Keep fixture correctness, collector existence and native readiness
separate; full C54 remains partial.
