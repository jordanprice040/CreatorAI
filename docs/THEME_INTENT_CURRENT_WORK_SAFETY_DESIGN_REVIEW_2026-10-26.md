# Current-work safety design independent review — October 26, 2026

Prompt: U02 (independent review), repository-only. Reviewed candidate:
`docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md`, SHA-256
`e4313c2013c919be7c762ff58a20653a15a7721af71ac37ae044fc9208a58dfa`, with its
input snapshot (`4a30e192…ed207`, 330 entries) and design receipt. Exact
installed candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`;
installation plan `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.

## Verdicts

- **Design support: PARTIAL, supported with one Medium and two Low bounded
  repairs.** The source trace is faithful, the schema29 predicate set covers every
  automatic consumer found (with one fail-closed enum error), and effect separation
  is correct. The producer-exclusion and stop-to-launch validity section (question 5)
  names what must be excluded but gives no concrete evidence mechanism, so CW-01
  cannot yet be implemented with a passable, reviewable admission predicate (M1).
  No defect makes safe implementation impossible; every gap found fails closed.
- **Conditional database-only inspection remains the smallest coherent path.**
  Deferral or a changed-candidate startup control is not required by anything found
  here, provided M1 is repaired. If Jordan cannot give the M1(d) attestation, defer.
- **Operational/native readiness: NOT READY (blocked).** No reviewed reader,
  collector, PR-01/SH-01 or CW-01 implementation exists; port, configured tools,
  active home and protected access are unbound; no cluster-start, credential or SQL
  grant exists. Native acceptance remains blocked, original A0 blocked, NI cases
  not-run, H unverified and Jordan's alone, full C54 partial. M3 is unchanged.
  This review cannot establish any operational result.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family) in a Creator Agent project thread on
Jordan's device folder `C:\dev\creator_agent`. The design and every theme-intent
document it governs were authored by Codex (a different model family); this
reviewer authored none of them and did not see the author's reasoning. Other Claude
sessions in this project authored earlier reviews in this chain (for example the
classifier v4, verifier L12/L13 and owner-attestation template reviews), so this
review is not independent of that review lineage and was not blinded. No external
review service was used.

Static reading only: repository text, the hashed bundle read as text, `grep`/`sed`
excerpts and SHA-256 hashing. No tests, historical verifiers, imports, module
evaluation, SQL, helper, launch, sign-in, operational config/environment/registry/
process/port reads, credential access or retired-checkout access. Statements about
PostgreSQL 18 behavior (pg_control rewrite on every postmaster start, pg_ctl stop
modes, single-user lock-file handling) are reviewer knowledge, not verified against
PostgreSQL 18.6 documentation in this session; M1 and L2 require that verification
in the repair or implementation review. Not an exhaustive audit of every provider.

## Binding checks performed

- Design and input-snapshot hashes match the design receipt. All 330 snapshot
  entries were rehashed directly: 0 mismatches, 0 missing.
- Bundle `studio.mjs` `9d5ddac3…1da88` and `apps/api/src/index.ts`,
  `apps/api/src/studio.ts`, `packages/broker/src/plan-service.ts` match the package
  reviewer map (`tracking/evidence/theme-intent-package-review-2026-10-23/reviewer-receipt.json`).
- Additionally, `apps/desktop/src-tauri/src/studio.rs` matches that map
  (`31b0dac5…09fa7`), so the design's `studio.rs:400` cluster-start locator is
  bound, not only a navigation aid (I1).
- Unbound navigation aids: `postgres.rs`, `main.rs`, `winsys.rs` (not in the map);
  current `worker.ts`, `workflow-store.ts` and `migrations.ts` are modified against
  HEAD and must never substitute for the bundle. Schema29 facts below come from the
  bundle's embedded migrations (version 29 `theme_intent_drafts`, bundle ~24863).

## Answers to the review questions

**1. Source trace — faithful.** Verified in the bundle: `serveStudio` (55682)
passes a literal environment to `createApi` (~55715) with no `CREATOR_WORKER`, so
the worker defaults on (54685) and the portfolio scheduler defaults off (54654).
`init` (54695–54730) runs schema check, actor/environment bookkeeping, broker
`sweepStale`, retrieval `sweepRetrievals`, `drainOutbox`, then `worker.start()`.
`ensureReady` retries `init`; the 1 s relay drains the outbox every tick and sweeps
every 15 ticks (54743–54751). Worker `tick` (46140–46150) runs `sweepLeases`,
`wakeWaiting`, `reconcileTasks`, `coordinateWorkflow` over `liveWorkflowIds`
(`finished_at is null`, 28647), then `claimTasks` (28703; run-controlled workflows
with queued tasks). Outbox `consume` (28867) wakes tasks on answered/closed
decisions. Other timers in the bundle (Codex relay, builder heartbeats, preview
monitors, plan sign-in, portfolio) are request- or enabled-scheduler-driven; plan
token refresh (45736) occurs inside `invoke`. No omitted automatic startup consumer
was found.

**2. Predicates — sufficient, one fail-closed error (L1).** Every automatic
consumer reads only states the predicates reject: `liveWorkflowIds`/`coordinate`
(workflows `finished_at is null`), `claimTasks`/`sweepLeases`/`wakeWaiting`/
`reconcileTasks` (tasks queued/leased/waiting_human/reconciling), `drainOutbox`
(`delivered_at is null`), `sweepStale` (reservations in_flight), `sweepRetrievals`
(retrievals in_flight). Schema29 enums match the design for plan_requests,
plan_qualifications, budget_reservations, source_retrievals, context_batches,
github_operations, marketing_deliveries, portfolio_jobs, desktop_jobs and
artifact_previews; no later migration alters those state/status checks. The
workflows `OR` clause is redundant with the schema's terminal/`finished_at` check
but harmless. Unresolved external exposure is covered for reservations, plan
requests, batches, GitHub, marketing and portfolio. Payment checkouts/finance
commitments `open` and pending decisions have no startup consumer (I2).

**3. Effect separation — correct.** The design distinguishes read-only SQL from
cluster start/stop (WAL, checkpoint, pid and log writes; crash recovery), from
protected authentication (credential use) and from application startup, and never
calls the whole operation read-only. Bound `studio.rs` confirms the desktop starts
or reuses the managed cluster and loads the DPAPI-protected database secret before
serve.

**4. Bindings, access, ownership, limits, redaction, failure — concrete and
feasible, except stop semantics (L2).** Manifest fields, no default/PATH tools,
fixed allowlist, repeatable-read read-only transaction, counts-only output,
2 s statement/lock limits, single attempt, no force stop, no retry/cleanup and no
password on command lines are implementable. Protected access is correctly listed
as a missing reviewed mechanism rather than assumed.

**5. Producer exclusion and validity — not yet supportable as written (M1).** The
design correctly refuses to treat a clean snapshot, Local mutex or cooperative lock
as exclusion, and correctly keeps unknown access blocking. But it supplies no
mechanism that could ever turn the stop-to-launch interval into supported
evidence, so the conditional path has no reachable pass condition.

**6. Smallest coherent path — yes, conditionally.** Startup control would require
a changed candidate, new package/install decisions and re-verification; inspection
preserves existing evidence. With M1 repaired the inspection path is coherent.

**7. Preservation — yes.** Historical evidence (330 entries unchanged), M3 as the
accepted exact-bundle scheduler-configuration standard (scheduler-off is not
treated as excluding workflow execution, and M3 is not reopened or called live
evidence), the original A0 block and the disabled workspace-ID alternative are all
retained.

## Actionable findings

### M1 — Medium: producer exclusion has no concrete evidence basis

Locator: design §"Admission and binding", paragraph beginning "Producer exclusion
must cover all sessions/users…", and §"Effects, bounds, outputs and invalidation",
paragraph beginning "Validity is causal…".

Consequence: CW-01's admission predicate cannot be specified or reviewed, so a
future implementation either never passes or invites an implementer to substitute
a lock, TTL or rerun-until-zero, which the design itself prohibits. Question 5
cannot be answered positively.

Smallest repair (additive v1.1 note, no implementation): split the interval and
give each part a named, non-cooperative basis or an explicit residual.

- (a) **W1, CW-01 cluster-up window:** zero other client backends in the snapshot
  and again immediately before the owned stop; record the listener/credential
  boundary (loopback listener, scram-sha-256 initdb, DPAPI-protected secret) once
  bound to exact installed bytes. `postgres.rs` must be bound first. This narrows
  database producers to processes under Jordan's Windows account. It is not
  enforcement.
- (b) **W2, stopped gap (owned stop, fresh PR-01, launch):** tamper-evident
  storage continuity. Hash `global/pg_control` and record a names/sizes listing of
  `pg_wal` plus `postmaster.pid` absence immediately after the owned stop. Fresh
  PR-01 recaptures them immediately before launch. Any difference invalidates.
  This is detection, not prevention. It is sufficient for validity because the
  acceptance launch is then refused. Verify the PostgreSQL 18 claim that every
  postmaster start rewrites pg_control.
- (c) **W3, native session:** existing v4.1–v4.4 rules plus an explicit residual.
  Same-account automation (other agent device sessions such as Codex or Claude
  threads, scheduled tasks, alternate shortcuts or scripts) cannot be technically
  excluded.
- (d) **Owner attestation for W1–W3:** a concrete, enumerated attestation from
  Jordan covering those same-account classes for W1–W3, recorded as a
  threat-bounded limitation. If Jordan cannot attest, defer acceptance. Do not
  accept a softer substitute.

### L1 — Low: terminal `needs_human` tasks counted as nonterminal

Locator: design predicate row `workflow_tasks: state not in
succeeded/failed/cancelled`; inherited from `scripts/theme-intent-upgrade-v4-core.mjs:525`.
Bundle schema: `workflow_tasks` enum (23205–23206) includes `needs_human`, and the
check (23227) makes `succeeded/failed/needs_human/cancelled` exactly the
`finished_at is not null` states.

Consequence: fail-closed, but a legitimately finished `needs_human` task would
block CW-01 permanently. The row's rationale also misdescribes schema29.

Smallest repair: use `finished_at IS NULL`, or list the five nonterminal states
explicitly. State that divergence from the helper is deliberate. Either form is
safe.

### L2 — Low: stop semantics under foreign access are unspecified

Locator: design §"Effects, bounds…", the phrase "Only normal stop of a cluster this
run proved it started". The desktop "reusing the app's running PostgreSQL" path is
in bound `studio.rs` (412). The desktop's stop mode `fast` (`postgres.rs:191`) and
the Local single-instance key (`winsys.rs:42`) are unbound.

Consequence: if a desktop launch adopts CW-01's cluster, or a foreign backend
connects, the design does not say what happens. A stop could interrupt a foreign
studio's in-flight work and create new unknown outcomes. Not stopping leaves a
cluster this run started. The "normal" mode (`smart` or `fast`) is ambiguous.

Smallest repair:
- Recheck backends before the stop. If any foreign backend is present, do not stop
  the cluster; record the result as invalid and producer-observed, and stop for a
  scoped follow-up.
- Otherwise name the exact pg_ctl mode, with its deadline.
- Optionally hold the exact desktop instance key during W1. Record it as a
  same-session partial guard only, not as exclusion.

### Informational

- I1: `studio.rs` is package-bound; strengthen the locator's evidence label.
- I2: state the deliberate omission of payment/finance `open` states and pending
  decisions (no startup consumer; request/webhook-driven), so it is not mistaken
  for an oversight.
- I3: `pg_stat_activity` is not MVCC-consistent with the repeatable-read snapshot;
  the design's "observation time only" wording already covers this.
- I4: a single-user `postgres --single` inspection would remove the listener and
  password use during W1, but runs as superuser with nonstandard I/O. It is worth
  assessing in the repair. It is not required.

## Status of authority

This review is repository-only. It grants no implementation, cluster start,
credential use, SQL, launch, sign-in or native-session authority, and it does not
enable the workspace-ID alternative. Existing items 1–6 field-inspection authority
is unchanged. No owner decision is requested by this review.

## Exact next bounded prompt

> Prepare an additive repository-only v1.1 note to
> docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md (SHA-256
> e4313c2013c919be7c762ff58a20653a15a7721af71ac37ae044fc9208a58dfa) that resolves
> review M1, L1 and L2 and disposes I1–I4 from
> docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_REVIEW_2026-10-26.md. Specify
> W1/W2/W3 producer-exclusion bases, including pg_control/pg_wal continuity across
> owned stop and fresh PR-01, pre-stop foreign-backend handling and exact stop mode,
> the enumerated owner attestation with defer-if-absent, and the corrected
> workflow_tasks predicate. Verify PostgreSQL 18 behavior claims against official
> documentation and bind postgres.rs to exact installed bytes or mark it unbound.
> Preserve the design, its receipt and this review byte-for-byte. No implementation,
> operational reads, SQL, credentials, cluster start, tests/verifiers, launch or
> sign-in. Then stop for independent review of the note.
