# CW-01 fixture-only core implementation — October 26, 2026

Status: repository-only fixture prerequisite slice, authorized by Jordan's
explicit request in this thread. Written by Claude (Anthropic model family), the
same model family that wrote the CW-01 design review and the v1.1 review whose
R1–R3 this implements. **Independent review pending**; no passing verdict is
self-issued. Completion means this fixture-only slice is verified, not that CW-01
is operational. M3 unchanged and not reopened; original A0/native acceptance
blocked, NI not-run, H unverified, full C54 partial; workspace-ID alternative
disabled.

Governed by the frozen [implementation design](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md)
(`7aaa898c…7252`), its [review](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_REVIEW_2026-10-26.md)
(`7619804d…f196`), the [v1.1 note](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_NOTE_2026-10-26.md)
(`0462b516…bb81`) and the [supported v1.1 review](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_REVIEW_2026-10-26.md)
(`d7628032…de58`), under the current-work design `e4313c20…8dfa`, v1.1 note
`d1b4fe08…c8a5` and v1.1 review `6ae7554e…9a05`. R1–R3 are carried directly
into code and checks, without another planning note, as Jordan directed.

## What was added

| File                                                                                | SHA-256                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/theme-intent-cw01-observer-sql-v2.sql`                                     | `074561c3e36d655888aed442664f6419d817a5d5ea48116eb2714381339f89b2` |
| `scripts/theme-intent-cw01-core-fixture.mjs`                                        | `b8b9eb5db59afdf3725717bf9a723c808e66b4ca399624d20fa8f4afe1730662` |
| `tests/theme-intent-cw01-core-fixture.test.mjs`                                     | `5e0b615cdeb4d1c953531c60b6a0829002904636a83119e65d8d975a06939dda` |
| `tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/tests-final.tap`       | `71164f896197628850ab217cd3999c90e2a15b9cb7707a0348153c60f252230e` |
| `tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/mutation-check.mjs`    | `1266cc3d7f7b8fb4e9f0b1401a12811a062096a7418c8cab045bf063d94a1457` |
| `tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/mutation-results.json` | `0eb618e5b70667e00cd570dde35e00f43b515b84ebaa0a378a7117e823fd766c` |

This report's hash, the tracking before/after hashes and the frozen-input check
are in `tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/implementation-receipt.json`.
No existing file other than the two tracking files was modified.

### Successor SQL asset `cw01-observer-sql/2`

A new LF-only file; the frozen design's SQL stays unchanged in the design document.
Statements are delimited by unique `-- @Snn/Ann/Bnn` markers so a later adapter
can bind exact text. Changes against the original allowlist:

- M1: `pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1' AS address_ok`.
- M2/R3: A04 and B03 `pg_postmaster_start_time()`, `pg_is_in_recovery()` and
  `pg_backend_pid()`.
- L3: A14 and B07 `backend_type IS NULL` count.
- L4: A05 five startup-boundary settings (detect-only).
- I-a: session `SET transaction_timeout = '30s';`; no cancel-request connection.

Every other original statement line is preserved verbatim (checked by a test that
extracts the frozen design's SQL). The asset's version and exact SHA-256 are the
`SQL_ASSET` constant, which admission requires in the request, every SQL evidence
item and every receipt history entry. **The asset was not executed.**

### Pure core `theme-intent-cw01-core-fixture.mjs`

Imports only `createHash`; no file, clock, environment, registry, process, port,
SQL or credential access (checked by a test). Exports admission
(`admitRequest`), validators, the lifecycle `step`, `fixtureReceipt` and
`admitOperationalGate`.

- **Admission.** `mode: 'operational'` is always blocked with
  `OPERATIONAL_ADAPTERS_UNIMPLEMENTED`. Fixture mode requires every binding
  (cluster, port, database, observer actor, pg_ctl/postgres/cmd images, working
  directory, log, startup boundary, background allowlist with reviewed ranges and
  `writes_storage_reviewed`, relation fingerprint, credential mechanism, seven
  grants, five adapter reviews) to be present and fixture-labeled. Missing or
  `pending` values are blockers; nothing is defaulted.
- **Lifecycle.** `prepared → admitted → preflight_stopped → start_intent →
candidate_process_bound → owned_running → sql_A → sql_B → disconnected →
stop_intent → stopped_verified → W2_reference_recorded`. Terminal states:
  `blocked`, `start_unknown`, `ownership_unavailable`, `invalid_producer_observed`,
  `sql_unknown`, `stop_unknown`, `W2_reference_recorded`. Every transition or
  refusal appends a hash-linked entry with input hash, SQL asset hash and manifest
  hash. Out-of-order events and any event from a terminal state are refused.
  `retry_*`, `second_stop`, `stop_fast`, `stop_immediate`, `kill`,
  `terminate_backend`, `adopt`, `reconnect`, `extend_deadline`, `cleanup` and
  `escalate` are always refused and change nothing.
- **Evidence provenance.** Each item must carry `fixture: true`,
  `provenance: 'fixture_measurement'`, the request's fixture adapter hash and the
  manifest hash. `model_assertion` or any other provenance is
  `ASSERTION_NOT_MEASURED`; an unlabeled item is `UNLABELED_EVIDENCE`; a changed
  manifest is `VERSION_BINDING_CHANGED`. The attestation must be an owner
  affirmation.
- **R1.** Start requires exactly two fresh existence-only observations of
  `HKLM` and `HKCU` `Software\Microsoft\Command Processor` value `AutoRun`, native
  view `64`, with System32 `cmd.exe` pinned (`view: 'system32'`); any other cmd
  binding is `UNBOUND_REGISTRY_VIEW`. Present, unavailable, missing, unknown,
  duplicate, wrong key/value/view, a value-text field or an observation outside
  admission→start intent or older than 15 s blocks start. Missing evidence is
  never absence. The pass result records that later registry inspection needs its
  own grant.
- **R2.** Ownership requires an upward walk from the pidfile PID with three
  handle-bound records (postmaster, shell, pg_ctl) and exact image hashes. The
  pg_ctl record must equal the launch handle's PID **and** creation time. The
  shell must be created within that pg_ctl instance's lifetime (at or after its
  creation, at or before its exit if exited), still running when observed, and the
  postmaster created at or after the shell. A downward walk, an exited shell (the
  `postgres -V` probe) or any reuse-shaped ordering is `ownership_unavailable`. A
  retained handle is not assumed to prevent PID reuse.
- **W1 pidfile.** Exactly eight lines, positive PID (negative is
  `STANDALONE_BACKEND_PID`), line 2 exactly equal to the bound cluster under N4
  (no case or separator normalization), manifest port, empty line 5, `127.0.0.1`,
  **line 7 empty**, line 8 exactly `ready   `; standby/starting/stopping block.
- **R3.** SQL A and B require `backend_parent`: handle-bound, backend PID equal to
  the SQL `pg_backend_pid()`, parent PID and creation equal to the bound
  postmaster, and backend created after it. Missing is
  `SQL_PARENT_LINK_MISSING`. Times are supporting only: pidfile seconds ≤ SQL start
  time, postmaster creation within the pidfile second, start intent ≤ creation.
  A contradiction blocks, but consistent times never replace the link.
- **SQL A/B.** Boolean gates must be exactly `true` (NULL fails). `in_recovery`
  must be `false`. Counts must be decimal strings; anything else is
  `sql_unknown`. Client, walsender and NULL-type counts must be zero, desktop
  adoption must be explicitly `false`, and background types must be within the
  allowlist ranges; otherwise `invalid_producer_observed`. B must use the same
  connection, a new transaction, a new later sample, the same SQL asset and the
  same instance start time and backend PID. Session/local preload evidence must
  be labeled `observer_session` (I4).
- **Clearance vs stop.** Positive work counts, unavailable work counts, schema/
  setting/fingerprint mismatch and startup-boundary divergence invalidate
  clearance but do not authorize a sweep. Smart stop of our owned cluster stays
  admissible only with a fresh B (≤ 5 s before stop intent), mode `smart`,
  `-t 80`, and revalidated pidfile/handle/chain/SQL instance.
- **Timeouts.** A start or stop timeout, outer-deadline excess, missing or
  nonzero exit, or a `-t` other than 80 is `start_unknown`/`stop_unknown`, with no
  retry or automatic stop. `sql_deadline` is `sql_unknown`, with no stop authority.
- **I1.** `in_job: true` is `NESTED_JOB_REFUSED`; anything but explicit `false`
  is `JOB_CONTEXT_UNKNOWN`.
- **Attestation.** Six affirmed items with basis, source, date and uncertainty,
  W1–W3 scope, matching request/inspector/manifest, affirmed between admission and
  start intent; prefilled or copied records are refused. Ceiling
  `W1_W2_supported_W3_pending`.
- **Receipts.** `fixtureReceipt` is `FIXTURE - not operational evidence`,
  `operational: false`, `authorizes: []`, binds request/manifest/inspector/SQL
  asset and lists the later scopes that need their own grants.
  `admitOperationalGate` refuses every receipt; a relabeled fixture receipt
  remains `FIXTURE_CANNOT_SATISFY_OPERATIONAL_GATE`.

## Checks actually executed

- `node --test tests/theme-intent-cw01-core-fixture.test.mjs` (Node 22.21.0):
  **18 tests, 18 pass, 0 fail**, TAP in `tests-final.tap`. Groups cover the SQL
  asset content and original-line fidelity; a complete fixture sequence and gate
  refusal; promotion attempts; missing bindings/grants/reviews; changed SQL and
  manifest versions; N4/CMD path spelling; AutoRun present/unavailable/unknown/
  missing/wrong view/stale; reused PIDs, lifetime containment, probe shell,
  downward walk; pidfile layout; missing or wrong SQL parent link; identity,
  recovery, NULL activity types, malformed counts; work and boundary
  invalidation; stale B, changed connection, foreign access and adoption; timeout,
  retry and escalation; preflight adoption refusal; attestation and nested jobs;
  module purity.
- Mutation check (`mutation-check.mjs`, isolated scratch copies, then removed):
  12 targeted mutants of the core, **12 killed**. One mutant (SQL hash in A)
  first survived because B caught it; the test now also asserts the refusal
  happens at A.
- Prettier `--check` on the two new `.mjs` files: clean.
- Direct SHA-256 of the 14 frozen inputs recorded in the v1.1 review receipt: 0
  mismatches. Governing current-work design, note and review match their recorded
  prefixes.

Not run: the SQL asset or any SQL, credentials, operational config/environment/
registry/process/port/object/pidfile reads, cluster/app start or stop, launch or
sign-in, helpers/install/migration/recovery, activation or dispatch, unrelated
historical tests or verifiers, `pnpm` scripts, and the retired OneDrive checkout.

## Remaining limitations and blockers

- Fixture evidence is hand-built. The core checks shape, binding and ordering; it
  cannot show that a real adapter can produce such evidence on Windows.
- Separate blockers, unchanged: reader N1–N4, collector L1/L4, process-metadata,
  W1 pidfile and AutoRun registry adapters, protected-credential adapter, real
  manifest bindings (port, home, pg_bin, startup/HBA/background boundary,
  relation fingerprints), concrete grants and Jordan's attestation.
- SQL result shaping (private comparison of ledger, settings, preloads and
  fingerprints into booleans) is assumed to happen in a future trusted adapter;
  the core consumes only the booleans.
- The background allowlist uses fixture ranges; real ranges and the
  `writes_storage` disposition remain unbound.
- The 15 s AutoRun and 5 s pre-stop freshness bounds are this slice's choices,
  not values set by the design; review should confirm or change them.
- Times are numeric fixture values; clock-discontinuity detection is an adapter
  concern and is not modelled.
- W2 comparison and the `PR01+W2/1` extension are out of scope; the core stops at
  recording the reference hash.
- The author's model family also wrote the reviews being implemented.

## Next independent-review prompt

> Independently review the CW-01 fixture-only core against
> docs/THEME_INTENT_CW01_FIXTURE_CORE_IMPLEMENTATION_2026-10-26.md and its receipt
> (tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/), the frozen design
> (7aaa898c…7252), review (7619804d…f196), v1.1 note (0462b516…bb81) and v1.1 review
> (d7628032…de58). Check the successor SQL asset's exact bytes and fidelity to the
> original plus M1/M2/R3/L3/L4/I-a, and that R1–R3 and I1/I2/I4/N4 are enforced
> in the pure core and its tests without false passes. Probe fixture-to-operational
> promotion, model-assertion acceptance, terminal/retry handling, stale A/B and
> version binding. You may run only `node --test` on the new test file and the
> recorded mutation check in isolated copies. No SQL execution, credentials,
> operational reads, cluster/app actions, launch or sign-in. Report fixture-slice
> support separately from operational readiness. Then stop for Jordan.
