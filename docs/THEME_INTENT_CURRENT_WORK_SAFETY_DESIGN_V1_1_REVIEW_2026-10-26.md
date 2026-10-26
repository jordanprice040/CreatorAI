# Current-work safety design v1.1 note independent review — October 26, 2026

Prompt: U02 (independent review), repository-only. Reviewed note:
`docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_NOTE_2026-10-26.md`, SHA-256
`d1b4fe0805ed908d54baf28faeaa0d2118fd5e241f00df103c27eab4182ac8a5`, with its
repair receipt (`46b3b1f1…28ce`) and input snapshot (`36e845bf…439d`, 337 entries).
Frozen companions: design `e4313c20…8dfa`, design receipt `8a21c170…921d`,
prior review `17f12f8c…d7d1`. Exact installed
candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`;
installation plan `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.

## Verdicts

- **Design-scope resolution: SUPPORTED.** The note resolves M1, L1 and L2 at design
  scope and disposes I1–I4 acceptably. M1 now has a reachable pass condition that
  is expressly threat-bounded (source, fresh observation, tamper-evident change
  detection and an enumerated owner attestation), with defer as the outcome when any
  part is missing. No further note is required before an implementation design.
- **Two new Low findings and four informational notes** (below). F1 is a citation
  erratum that this review records; F2 is a binding condition carried to the CW-01
  implementation review. Neither changes the design's safety posture; both fail
  closed under the note's own "unknown means stop" rule.
- **Implementation readiness: NOT STARTED.** No CW-01, reader, collector or
  PR-01/SH-01 extension exists; implementation is a separate milestone needing its
  own authorization.
- **Operational/native readiness: NOT READY (blocked).** Port, configured tools,
  active home, actor and protected access remain unbound; no cluster-start,
  credential or SQL grant exists; Jordan's attestation is blank and other-producer
  access remains reported unknown. Native acceptance blocked, original A0 blocked,
  NI not-run, H unverified and Jordan's alone, full C54 partial. M3 unchanged and
  not reopened. This review establishes no operational result.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family) in a Creator Agent project thread on
Jordan's device folder `C:\dev\creator_agent`. The design and the v1.1 note were
authored by Codex (a different model family). The prior review whose findings the
note repairs was written by another Claude session (same model family), and its
proposed repair shape (W1/W2/W3, attestation-or-defer, smart-or-fast mode choice)
is what the note adopts. This review is therefore not independent of that lineage
and was not blinded; it partly evaluates repairs its own model family proposed.
Two corrections to that prior review are recorded here rather than defended:
it listed `postgres.rs` as unbound (it is in the supported /4 helper review map,
see binding checks), and its unverified premise that every postmaster start
rewrites pg_control is not what REL_18_6 shows (see F1 and W2). No external review
service was used.

Static reading only: repository text, the hashed bundle read as text, `grep`/`sed`
excerpts, SHA-256 hashing, and official PostgreSQL 18 documentation and REL_18_6
source fetched read-only on October 26, 2026 (hashes in the receipt). No tests,
historical verifiers, imports, module evaluation, SQL, helper, cluster start/stop,
launch, sign-in, operational config/environment/registry/process/port reads,
credential access or retired-checkout access. Upstream source is evidence about
PostgreSQL 18.6 behavior, not about the owner's installed binaries.

## Binding checks performed

- Note `d1b4fe08…c8a5` and snapshot `36e845bf…439d` match the repair receipt.
  All 337 snapshot entries rehashed directly: 0 mismatches, 0 missing. The 330
  entries of the original design snapshot are an identical subset; the 7 additions
  are the design, its receipt and snapshot, the prior review and receipt,
  `postgres.rs` and `scripts/theme-intent-upgrade-v4-core.mjs`.
- Frozen bytes preserved: design `e4313c20…8dfa`, design receipt and snapshot
  (`4a30e192…d207`), prior review `17f12f8c…d7d1` (matches its receipt), prior
  reviewer receipt `f52880c7…a360`.
- Bundle `studio.mjs` `9d5ddac3…1da88` matches. `studio.rs` `31b0dac5…09fa7` is in
  the package reviewer map. `postgres.rs` `109615f4…b88b` is **not** in the package
  reviewer map but is in the supported /4 helper review receipt
  (`theme-intent-upgrade-helper-v4-review-2026-10-24/reviewer-receipt.json:186`)
  and its layout inputs, and has a single commit `efe6627` with no working-tree
  diff. The note's I1 statement is accurate: reviewed-source binding, not
  source-to-installed-native equivalence. Neither map proves the compiled desktop
  executable came from these bytes.
- Schema29 (bundle `version: 29` at 24863): `workflow_tasks` state enum
  (23205–23206) includes `needs_human`; check 23227 binds exactly
  `succeeded/failed/needs_human/cancelled` to non-null `finished_at`. Later
  migrations alter only the `kind` check, a `round` column and the slot key
  (23476–23482); the state/finished check is unchanged.
- Official sources: PostgreSQL 18 `app-pg-ctl`, `server-shutdown`, `wal-internals`,
  `monitoring-stats`, `app-postgres`, `runtime-config-connection`,
  `config-setting`; REL_18_6 `xlog.c` (configure.ac confirms 18.6),
  `backend_status.c`, `pgstat_xact.c`.

## Assessment by question

**M1 — reachable, threat-bounded pass condition: resolved.** The pass predicate is
a conjunction of the original gates, two fresh W1 observations, an owned smart stop,
a matching W2 comparison and the full attestation. Each conjunct is concrete and
reviewable, so CW-01 can now be specified; any missing conjunct defers. The note
states plainly that this is not technical exclusion of same-account processes and
forbids risk acknowledgment as a substitute. That boundary is appropriate for a
single-owner local desktop whose acceptance goal is a no-dispatch native session,
not an adversarial security claim. It would be inappropriate if a later use needs
protection against a hostile local process; the note correctly says that case
needs a separate control or deferral.

**W1 — observation freshness: resolved.** Requiring the second activity sample in a
new transaction is necessary, not just prudent: in REL_18_6 the backend status
array is copied to local memory once per transaction
(`backend_status.c:815–837`, "if not already done in this transaction") and thrown
away at transaction end (`pgstat_xact.c:58–59`, `:229–230`). A second read inside
the repeatable-read transaction would return the first copy. Broadening from the
historical helper's `datname=current_database()` (`theme-intent-upgrade-v4-core.mjs:522`)
to all databases in the cluster is correct. The transient connect/disconnect
residual between samples is stated and assigned to the attestation. See I1/I2 for
predicate-form details to carry into implementation.

**W2 — fingerprint limitations: resolved and honestly bounded.** The permitted and
forbidden claims are the right ones. REL_18_6 supports them more strongly than
the note says: after a clean shutdown, a start that is not in recovery does not
write pg_control until the transition to production (`xlog.c:6195–6214`); the
earlier write at 5749 happens only when `InRecovery`. So a start that fails before
production after a clean shutdown can leave pg_control byte-identical, which is
exactly the "starts failing before the observed startup transition" residual. WAL
segments are fixed-size (`wal-internals`: "normally each 16 MB"), so names/sizes
cannot show content changes. The rule "never refresh the reference after an
unexplained change" and the no-TTL rule are correct.

**Owner attestation: resolved.** Six enumerated items cover other agent/device
sessions, standalone tools and alternate launchers, scheduled/startup/sign-in
triggers, other users and credential holders, offline storage manipulation and
uncovered actions. It stays blank, requires basis and uncertainty per item, does
not reuse earlier reports, and defers if any item cannot be affirmed. It forbids
filling it by changing system state. See I3 for recording form.

**Stop races and mode: resolved.** Smart mode is correct per PostgreSQL 18 docs
(`app-pg-ctl`: smart "disallows new connections, then waits for all existing
clients to disconnect"; fast "(the default)" rolls back and forcibly disconnects).
The explicit `-m smart` correctly avoids inheriting pg_ctl's fast default and the
desktop's fast stop (`postgres.rs:186–195`). Timeout as unknown, with no
escalation, matches the docs ("the operation might continue in the background and
eventually succeed"). Foreign-backend or adoption observed before stop means no
stop and no termination, which avoids creating new unknown outcomes in someone
else's work. The pre-stop check is correctly called non-atomic. Bound source makes
the main race visible in practice (I4).

**Finished-task predicate: resolved.** `finished_at IS NULL` is exactly the five
nonterminal states under check 23227, so it is equivalent to the explicit list and
admits a finished `needs_human` task. The deliberate divergence from the historical
helper is stated, and that helper and its results are left untouched. Unfinished
parent workflows still block.

**Source/binary binding limits: resolved.** The note neither overstates nor
discards `postgres.rs`: it is used as reviewed design context, while the current
listener/authentication/startup boundary must come from reviewed scoped evidence.
Upstream PostgreSQL source is correctly labeled as not proving the owner's binaries.

## Findings

### F1 — Low: REL_18_6 xlog.c locators do not point at the cited code

Locator: note §"Official PostgreSQL verification", `xlog.c` bullet. In the REL_18_6
file, lines 5798–5805 are `ResetUnloggedRelations`/`DeleteAllExportedSnapshotFiles`
in `StartupXLOG`, and 6816 is inside `LogCheckpointEnd`. The production-state
transition and the "small window" comment the note describes are at 6195–6214
(`StartupXLOG`, `ControlFile->state = DB_IN_PRODUCTION` at 6207,
`UpdateControlFile()` at 6213). The shutdown-checkpoint control update is in
`CreateCheckPoint`, 7290–7309 (`DB_SHUTDOWNED` at 7294, `UpdateControlFile()` at
7308). The described behavior is correct; only the locators are wrong.

Consequence: the project's evidence rule requires accurate locators; an
implementation reviewer following them lands on unrelated code. No safety effect.

Disposition: this review records the corrected locators. Any CW-01 implementation
or later note citing this evidence must use them. No v1.1 revision is required.

### F2 — Low: CW-01's own start invocation is unspecified

Locator: note §W1, "Require evidence of the actual loopback listener"; original
design §"Effects, bounds…", "one owned managed-cluster start". The note fixes the
stop command exactly but not the start. The bound desktop start passes
`-p <port> -c listen_addresses=127.0.0.1` on the command line (`postgres.rs:158–171`).
Per PostgreSQL 18 `config-setting`, command-line settings "override those set via
postgresql.conf or ALTER SYSTEM". A CW-01 start without them would use whatever
port and `listen_addresses` the data directory's files hold. Those are unbound, and
the documented default is `localhost`, which may resolve to more than 127.0.0.1.
On Windows `unix_socket_directories` defaults to empty (`runtime-config-connection`),
so no socket listener appears unless configured.

Consequence: fail-closed. W1's listener evidence would come out unknown or would
differ from the desktop's boundary, so CW-01 stops. But the implementation could
not pass W1 predictably until the start is pinned.

Binding condition for the implementation review: specify one hash-bound
`pg_ctl start -D <approved cluster> -l <approved log> -o "-p <manifest port> -c
listen_addresses=127.0.0.1" -w -t 90`, mirroring the bound desktop options with the
design's 90 s deadline. Treat start timeout, nonzero exit or an already-running
cluster as unknown or not-owned, with no retry. Still observe the effective
listener and `unix_socket_directories` rather than inferring them from the command.
This is a declarative condition, not executed here.

### Informational

- **I1 — W1 count form.** Carry the historical predicate shape forward with the
  database filter removed: `backend_type = 'client backend' AND pid <>
  pg_backend_pid()` across the cluster, plus a separate zero count of `walsender`
  backends. Count background workers by type against the reviewed startup boundary
  rather than folding them into the client count.
- **I2 — Observer privilege.** The initdb bootstrap role (`postgres.rs:115–121`,
  `-U user`) is a superuser, so it would see all backends. But the CW-01 actor is
  still unbound. The note's "inaccessible activity is unavailable" rule must stay
  in the implementation.
- **I3 — Attestation record.** The note says what Jordan must affirm, not where it
  is recorded. The implementation should bind it into the CW-01 receipt: operator,
  window identifiers, manifest hash, affirmation time before W1, and the post-W3
  no-exception confirmation. Reuse the reviewed collector owner-attestation
  template's currentness lesson (its L1): affirm immediately before W1, not from an
  earlier session.
- **I4 — Adoption race is visible.** `postgres.rs:146–150` makes a desktop launch
  adopt any running cluster from this folder. If that happens between the pre-stop
  sample and the smart stop, the desktop's existing connections hold the smart
  shutdown open and its new connections are refused. pg_ctl then times out, which
  the note already classifies as unknown and invalid. A short-lived client that
  connects and disconnects before the stop request is not detected; the
  attestation covers that residual, as the note says.

## Status of authority

This review is repository-only. It grants no implementation, cluster start or stop,
credential use, SQL, launch, sign-in or native-session authority. It does not
record or request Jordan's attestation, and it does not enable the workspace-ID
alternative. Existing items 1–6 field-inspection authority is unchanged. No owner
decision is requested.

## Exact next bounded prompt

> When Jordan chooses to proceed, prepare a repository-only CW-01 implementation
> design (not code) against docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md
> (e4313c20…8dfa), its v1.1 note (d1b4fe08…c8a5) and
> docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_REVIEW_2026-10-26.md. Pin the
> exact start/stop invocations (F2), the fixed schema29 SQL allowlist including the
> W1 count forms (I1), observer-privilege handling (I2), the attestation record
> (I3), the W2 fingerprint capture contract and PR-01 extension scope, and use the
> corrected REL_18_6 locators (F1). Settle reader N1–N4 and collector L1/L4 bindings
> or mark them blocking. No implementation, operational reads, SQL/credentials,
> cluster start/stop, tests/verifiers, launch or sign-in. Then stop for review.

Alternatively, Jordan may defer native acceptance. Either choice is Jordan's; no
milestone starts automatically.
