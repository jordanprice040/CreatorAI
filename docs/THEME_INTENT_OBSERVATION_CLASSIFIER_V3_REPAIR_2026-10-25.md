# Observation classifier v3 repair — October 25, 2026

Status: pure fixture repair verified; separate independent exact review pending.
User authorized the smallest next step in the classifier-v2 independent review.
New module/tests: scripts/theme-intent-observation-classifier-fixture-v3.mjs and
tests/theme-intent-observation-classifier-fixture-v3.test.mjs. No operational
adapter, collector, OS observation or native acceptance was implemented or executed.
Frozen versions v1/v2, tests/reports/verifiers/receipts, notes v4.1/v4.2, reader v2,
proposal v4, checklist v5 and accepted M3 scheduling decision remain unchanged.

## Repairs

M4: Before ordinary window rejection, SH-01 scans the injected sample sequence;
once a complete stopped sample is seen, any later non-stopped result blocks with
RESTART_AFTER_STOPPED_SAMPLE. This persists through later clean pairs, timeout or
invalid fields. Explicit launch anywhere still takes priority. A contradiction or
unavailable result AFTER a stopped sample is conservatively blocked, not evidence
of an independently observed restart. Earlier shutdown activity remains allowed.

L6: Immediately after explicit-launch scanning, object input with window-level
launch exclusion other than exactly false blocks with LAUNCH_NOT_EXCLUDED. An
invalid shape, over-cap array or contradiction cannot downgrade uncertainty to an
unknown that might be mistaken for routine re-observation.

L8: All at_ms values now mean query-batch START, with a separate closed_ms equal
to now_ms for completion after final closure. Last query start may precede closure;
query-start spacing remains ≥1000ms, closure must fit original15s/90s bounds, and
all query starts must be within that window. Missing/invalid/mismatched/pre-query
closed_ms cannot pass. The v4.3 note documents this replacement of the v4.2 mixed
semantics; injected flags/times are not OS evidence or proof of unobserved gaps.

L7: The successor verifier rejects ANY computed element access, including string
concatenation and template constructor spellings, plus Math/crypto/Reflect/Proxy
identifiers and import.meta. The core's whitelisted field folding now uses static
property accesses so it passes that stricter guard. Public input/output fields,
strict count handling, admission, deterministic hash derivation and redaction remain.
AST checks remain supplemental, not a proof that arbitrary JavaScript is pure.

No changes to reader N1–N4. Per-target result folding, key/scope preimage, distinct
identity/namespace/lease evidence, caller-chosen step and early sampling (L1/L4 and
informational collector limits) remain for a future reviewed collector. Inputs must
be JSON-like plain data, not getters or executable callbacks. No operational scope
or authority is conferred by any fixture pass.

## Actual checks

Final Windows Node suite18/18 groups passed, zero failures/skips. Inherited tests
were updated only for the stricter restart outcome and new closed_ms input; the
original frozen suites remain untouched. Three added groups reproduce reviewer
R1–R3 restart sequences, R4 normal shutdown positive control, N1 uncertain launch
priority, and query-spacing/closure/deadline cases. Explicit launch precedence and
all previous M1–M3 repairs continue passing. No operational data/OS calls in tests.

Pure baseline probes execute frozen v2 and new v3 against identical fixtures:
R1/R2/R3 v2 pass → v3 blocked; R4 pass in both; N1 v2 unknown → v3 launch exclusion
block. TAP/probes and exact source/doc hashes are under
tracking/evidence/theme-intent-observation-classifier-v3-2026-10-25/.

Retained attempts: initial16/18 failed two inherited test setups/expectations
(old pending-on-restart and missing closure field); second17/18 still had the
pending expectation because a text replacement did not match. Corrected that
assertion to the exact restart reason; final18/18. No production/core changes
between those attempts and no weakened gate. Each failed TAP is preserved.

Verifier reads recorded TAP; it does NOT run tests. It checks anchored exact totals,
prior input maps (with historical mutable tracking exclusions explicit), new hashes,
baseline outcomes and hardened AST negative self-checks. Default compares only;
--record exclusively creates the new receipt once. Hash checks and code review
remain distinct from executed tests and independent support.

## Next eligible independent review prompt

In a separate uninvolved U02 session review classifier-v3/tests, v4.3 note, this
report and new check-only receipt/verifier against the exact classifier-v2 review.
Declare involvement. Rehash repository inputs and run only pure fixture tests if
needed. Assess restart precedence across all later statuses/early exits, uncertain
window-launch priority, uniform query-start timestamps, separate closure bound,
positive controls, all prior M1–M3 regressions, redaction and purity. Check hardened
AST mutants, anchored TAP handling and immutable check-only behavior as supplemental
guards. Distinguish injected evidence, timestamp/closure attestations and actual
OS observations. Preserve all frozen versions and reader N1–N4/M3 decisions.

No operational/config/credential/environment/registry/process/port/mutex/event read,
launch, SQL, helper/installer/provider/worker activation, recovery, cleanup or retired
checkout. Produce exact-input report/receipt, actual checks, per-area verdicts,
limits and the smallest next bounded implementation prompt; do not execute it.
No collector or operational adapter exists; active home/continuity/workspace/role/
tool provenance, reviewed scope and operational/session grants remain pending.
Full C54 partial; native acceptance and Jordan H unverified. Author implemented
these files and cannot give independent support.
