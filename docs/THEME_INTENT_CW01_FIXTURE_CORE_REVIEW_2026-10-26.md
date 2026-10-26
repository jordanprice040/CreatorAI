# CW-01 fixture-only core independent review — October 26, 2026

Prompt: U02 (independent review), repository-only, per the review prompt in
`docs/THEME_INTENT_CW01_FIXTURE_CORE_IMPLEMENTATION_2026-10-26.md` (`9a3a1194…27e4`)
and its receipt `implementation-receipt.json` (`1788d54b…ab63f`). Governing
documents: frozen design `7aaa898c…7252`, review `7619804d…f196`, v1.1 note
`0462b516…bb81`, v1.1 review `d7628032…de58`. Reviewed code: successor SQL asset
`scripts/theme-intent-cw01-observer-sql-v2.sql` (`074561c3…89b2`), core
`scripts/theme-intent-cw01-core-fixture.mjs` (`b8b9eb5d…0662`), tests
`tests/theme-intent-cw01-core-fixture.test.mjs` (`5e0b615c…9dda`).

## Verdicts

- **SQL asset `cw01-observer-sql/2`: SUPPORTED.** Exact bytes match the receipt.
  After removing the six added statements and reversing the M1 line, the asset's
  statement lines equal the frozen design's 70 SQL lines **in order**. The six
  additions match the v1.1 note and R3 exactly. One comment-only error (I-1).
- **Fixture core and tests: SUPPORTED IN PART; two Medium repairs needed before
  the slice is supported as complete.** R1, R2, R3, I1, I2, I4 and N4 are
  enforced, and the tests have no false passes for the cases they cover. Two gaps
  remain, both outside what the tests exercise. F1: the start/stop outcome and
  the pg_ctl launch handle (the R2 anchor) skip the measured-provenance check.
  F2: the deadlines and freshness windows are anchored to caller-supplied intent
  times and self-reported booleans, not to the measured spawn. Both are small,
  local repairs. Neither reaches anything operational.
- **Fixture-to-operational promotion: none found.** `admitOperationalGate` never
  admits. Operational-mode requests are always blocked. Relabeled receipts stay
  refused.
- **Operational/native readiness: NOT READY (blocked), unchanged.** No adapters,
  real bindings, grants or attestation exist. M3 is unchanged and not reopened.
  Original A0/native acceptance is blocked, NI not-run, H unverified, full C54
  partial, and the workspace-ID alternative is disabled.
- **Freshness bounds:** I confirm the values (15 s AutoRun, 5 s pre-stop) but
  change what they are measured against (see F2).

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed files. The implementation was written by another Claude session, and the
CW-01 design review and v1.1 review it implements were also by Claude sessions.
This is the same model family and was not blinded. No external review service.

Executed: SHA-256 hashing, read-only text comparison of the SQL asset against the
design, `node --test tests/theme-intent-cw01-core-fixture.test.mjs` (Node 22.21.0),
and the recorded mutation check, run from a copy in my session scratch directory
so that its temporary isolated copies stayed outside the repository. Probes of
promotion, assertion acceptance, terminal/retry, stale A/B and version binding
were done by static reading of the core and its tests, with the passing test
fixtures as concrete evidence. No other code was run. Not done: SQL,
credentials, operational config/environment/registry/process/port/pidfile reads,
cluster/app actions, launch, sign-in, `pnpm` scripts, unrelated tests or
verifiers, and the retired OneDrive checkout.

## Binding checks

- All six new-file hashes, the report hash and the 18 frozen-input hashes in the
  implementation receipt match the files. 0 mismatches.
- `tracking/BUILD_STATUS.md` and `tracking/SESSION_HANDOFF.md` matched the
  receipt's `after` hashes before my edit. In each, the bytes after the
  prepended CRLF section hash to the receipt's `before` value, so the prior bytes
  were preserved as claimed.
- Tests: 18/18 pass (TAP rerun in this review's evidence folder). Mutation check:
  12/12 killed, identical to `mutation-results.json`.

## SQL asset

- LF-only, no CR, ends with LF. The only non-ASCII bytes are one em dash in the
  header comment. The 42 `-- @` markers are unique.
- Ordered fidelity: I split the asset by marker, dropped S05/A04/A05/A14/B03/B07
  and mapped the M1 line back to the original. The result equals the design's
  SQL line sequence exactly (70 lines). The implementer's test checks only line
  membership, which would miss reordering or lines moved between A and B. The
  ordered check shows that did not happen (I-2).
- M1: A03 uses `pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1'`.
  NULL fails in the core (`address_ok !== true`).
- M2/R3: A04 and B03 return `pg_postmaster_start_time()`, `pg_is_in_recovery()`
  and `pg_backend_pid()`. A04 sits after the identity gates and before work
  predicates, as the note requires.
- L3: A14 and B07 `backend_type IS NULL` counts, in the same transaction as the
  other counts.
- L4: A05 has the five settings, after the identity/instance gates and before work.
- I-a: S05 `SET transaction_timeout = '30s'`. No cancel-request or second
  connection statement. The core refuses `terminate_backend` and `reconnect`.
- No write, DDL, COMMIT, terminate/cancel, `set_config` or reload statements.

## Enforcement of R1–R3 and I1/I2/I4/N4

- **R1 AutoRun:** exactly two observations, HKLM and HKCU, exact key and value
  name, native view `64`, existence-only, with no value text. Present,
  unavailable, missing, unknown, duplicate, wrong scope/view and stale all block
  before `start_outcome`. A cmd binding other than System32 is
  `UNBOUND_REGISTRY_VIEW`. Missing evidence is never read as absence. The
  freshness anchor has a gap (F2).
- **R2 chain:** upward walk; three handle-bound records with image hashes; pg_ctl
  PID **and** creation must equal the launch handle; shell created within pg_ctl's
  lifetime and still running; postmaster created at or after the shell and
  running; pg_ctl created at or after start intent. The reuse, probe-shell and
  downward-walk cases are tested, and the `pgctl_instance` and `shell_running`
  mutants are killed. The launch handle itself is unmeasured (F1).
- **R3:** A and B both require a handle-bound `backend_parent` whose PID equals
  `pg_backend_pid()`, whose parent PID and creation equal the bound postmaster,
  and whose creation follows it. Times are supporting only; contradictions block.
  The `b_parent` mutant is killed.
- **I1:** `in_job` must be measured and exactly `false`.
- **I2:** pidfile line 7 must be empty; line 2 must equal the bound cluster
  spelling exactly (lowercase drive and `/` variants refused).
- **I4:** session/local preload evidence must be labeled `observer_session`;
  otherwise clearance is invalidated.
- **N4:** one drive-rooted spelling, with CMD metacharacters, dot/empty segments,
  trailing dot/space, reserved devices, 8.3 aliases, ADS colons, UNC and `\\?\`
  refused rather than normalized. `CONIN$`/`CONOUT$` are not refused (I-3).

## Findings

### F1 — Medium: start/stop outcomes and the launch handle bypass the measured-evidence rule

Locator: core `start_outcome` (lines 655–688) and `stop_outcome` (751–763)
handlers. The report says every evidence item must carry `fixture: true`,
`provenance: 'fixture_measurement'` and the adapter and manifest hashes. However,
`start_outcome` never calls `measured()` on its own fields: `pg_ctl_exit`,
`timed_out`, `outer_deadline_exceeded`, `pg_ctl_timeout_s` and `launch`
(pid, creation, exit). Only the nested pidfile and chain are measured.
`stop_outcome` likewise accepts unmeasured exit and timeout fields. The test
fixtures confirm this: `base.start_outcome` and `launch` carry no provenance at
all, and the full sequence passes.

Consequence: the launch handle is R2's anchor ("this exact pg_ctl instance"). A
model-supplied or unlabeled launch record that copies a measured chain's pg_ctl
PID and creation passes. So a chain rooted in some other pg_ctl instance started
after start intent would be accepted as ours. A model assertion of exit 0 or "no
timeout" is likewise accepted. `launch.exit_ft` is also never compared with the
chain's own pg_ctl `exit_ft`. In this fixture slice the effect is a false pass
in the core's own semantics, not an operational effect.

Repair: pass the outcome object (or a required `launch` evidence item) through
`measured()`, refusing with `ASSERTION_NOT_MEASURED`/`UNLABELED_EVIDENCE`. Require
the chain's pg_ctl `exit_ft` to equal the launch handle's. Do the same for
`stop_outcome`. Add negative tests for model-asserted and unlabeled outcomes.

### F2 — Medium: deadlines and freshness are not tied to the measured spawn

Locator: `LIMITS.outer_deadline_ms` and `LIMITS.sql_total_ms` are declared but
never used. `deadlineOk` trusts the booleans `timed_out`/`outer_deadline_exceeded`.
`checkProcessChain` gives pg_ctl's creation only a lower bound (≥ start intent).
`checkAutoRun` measures age against the caller-supplied `start_intent.at_ms`.

The v1.1 note requires a 90-second outer deadline "from before spawn through
required ownership/stop observation" and requires all times to fit the
start-intent → process creation → readiness interval. As written, a pg_ctl
created an hour after start intent passes if the evidence says
`outer_deadline_exceeded: false`. Then the 15 s AutoRun check, the attestation
window and the job-context check say nothing about the shell that actually
launched. The same pattern applies elsewhere: preflight evidence has no
observation time; SQL A and B may be any distance apart (the 30 s SQL total is
unused); and the pre-stop revalidation and the stop launch carry no time. Only
B → stop intent is bounded.

Repair, with my **freshness determination**:

- **Keep 15 s for AutoRun, but measure it to the spawn.** Require
  `observed_at ≤ pg_ctl creation` and `pg_ctl creation − observed_at ≤ 15 s`
  for both hives. Also require `pg_ctl creation − start_intent` to fit inside the
  outer window. 15 s is short relative to the 90 s outer deadline and leaves
  room for setup. It is not a guarantee: the registry can change after the
  read, and that residual stays with the attestation.
- **Keep 5 s pre-stop, measured to the stop launch.** Require B → stop pg_ctl
  creation ≤ 5 s. Require a timestamped revalidation between B and stop intent.
  5 s matches the design's "immediately pre-stop" B and still allows disconnect
  and revalidation.
- Enforce `outer_deadline_ms` from start intent to ownership/readiness
  observation, and `sql_total_ms` from A's connection to B, from measured times.
  Give preflight an observation time inside admission → start intent. Treat a
  missing time as unknown, never as fresh.

### Low and informational

- **F3 — Low: the request is held by reference and not digest-bound.** `newRun`
  neither clones nor freezes the request. Later checks read
  `ctx.request.bindings` live, and history reads `run.request.manifest_sha256`
  live. If a caller mutates bindings after admission (for example, widening a
  background range or swapping an image hash), later decisions change, and
  neither the history nor the receipt records it. The receipt binds
  request_id/manifest/inspector but not a request digest. Repair: snapshot and
  deep-freeze the request at `newRun`, and record its digest in the admit entry
  and the receipt.
- **I-1:** the SQL header says "A02/B01 use ($1 = expected actor)". B01 is
  `BEGIN`; the observer statement is B02, and its marker says `params=actor`
  correctly. The bytes are hash-frozen, so record this as an erratum or fix it
  in the next successor. Adapters must bind parameters by marker.
- **I-2:** the fidelity test should compare statement order, not line
  membership. I ran the ordered comparison above; it passes today.
- **I-3:** `admitPathSpelling` does not refuse `CONIN$`/`CONOUT$`. This is
  low-risk under the other rules, but they are reserved names.
- **I-4:** the report describes the postmaster as created "within the pidfile
  second". The code checks only `creation < end of that second`, which is right,
  because creation precedes the pidfile time. The wording should match the code.
- **I-5:** a refused `step` returns an unfrozen object. The core is not a
  boundary against its own caller; this is noted only for the future adapter
  boundary.

## Assessment by requested probe

- **Fixture-to-operational promotion:** refused. Operational mode is always
  blocked, every gate call returns `admitted: false`, and relabeled receipts are
  refused (the `gate` mutant is killed). No receipt names an authority
  (`authorizes: []`).
- **Model-assertion acceptance:** refused for preflight, job, AutoRun, pidfile,
  chain, SQL A/B, disconnect, revalidation, stopped observation and W2
  reference. The attestation must be an owner affirmation. **Not refused for
  start/stop outcomes and the launch handle (F1).**
- **Terminal/retry:** seven terminal states. Every event from a terminal state is
  refused and changes nothing. The twelve forbidden retry/escalation events are
  refused from any state. Timeouts, nonzero exits and missing exits go to
  unknown, with no stop authority. Out-of-order and unknown events (including
  prototype names) are refused.
- **Stale A/B:** B must use the same connection, a new transaction, a later
  observation, a new sample, the same SQL hash, start time and backend PID, and
  the parent link. B → stop intent ≤ 5 s. The A–B span and the stop launch are
  unbounded (F2).
- **Version binding:** the SQL version and hash are checked at admission, in A
  and B, and in every history entry. The manifest and adapter hashes are checked
  in each measured item. The request digest is not bound (F3).

## Status of authority

This review is repository-only. It grants no SQL execution, credential use,
registry, pidfile or process read, cluster start or stop, launch, sign-in,
adapter implementation or native-session authority, and requests no attestation.
M3 is not reopened. Nothing starts automatically.

## Next options (Jordan's selection)

1. A narrow repair of F1 and F2 (and optionally F3, I-2, I-3) in the core and
   tests, keeping the SQL asset as is with I-1 recorded as an erratum. Then a
   narrow re-review of the diff.
2. Accept the slice as is for design exploration, and carry F1–F3 as stated
   conditions into the later adapter review.
3. Defer CW-01.
