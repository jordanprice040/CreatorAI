# CW-01 implementation design independent review — October 26, 2026

Prompt: U02 (independent review), repository-only. Reviewed design:
`docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md`, SHA-256
`7aaa898cf8fc6b6a2d2b728a2e32e92dfc4ed295dfff44d29d4cdf4c30c17252`, with its
design receipt (`37a49082…f7dc`) and input snapshot (`b5b51a5b…4395`, 343 entries).
Governing: current-work design `e4313c20…8dfa`, v1.1 note `d1b4fe08…c8a5`, design
review `17f12f8c…d7d1`, v1.1 review `6ae7554e…9a05`. Exact candidate
`7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`; installation plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`; service bundle
`9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88`.

## Verdicts

- **Design support: PARTIAL — bounded repair required.** The structure is sound:
  no-adopt state machine, F2 start pin, explicit smart stop with no escalation,
  A/B activity samples in separate transactions, an exact schema29 work-predicate
  set, W2 non-proof limits, blank attestation, and an honest blocking ledger. Two
  Medium findings stop a "supported" verdict. M1 is a defect in the fixed SQL that
  makes the address gate always false. M2 is that Windows `pg_ctl` cannot supply
  the "exact launched process" the ownership gate names, and the design does not
  say what evidence replaces it. Both fail closed (no false pass), but the
  allowlist is meant to be hashed as a frozen asset, and ownership gates the only
  admitted stop. Four Lows and six informational notes follow.
- **Implementation readiness: NOT STARTED.** No CW-01 inspector, protected-access
  adapter, reader N1–N4 parity adapter, collector L1/L4, or PR01+W2/1 extension
  exists. Implementation is a separate milestone that needs its own authorization.
- **Operational/native readiness: NOT READY (blocked).** Port, home, pg_bin,
  startup/HBA/background boundary, relation fingerprints, observer credential
  mechanism and concrete grants are unbound. Jordan's attestation is blank and
  other-producer access is still reported as unknown. Native acceptance blocked,
  original A0 blocked, NI not-run, H unverified and Jordan's alone, full C54
  partial. M3 unchanged and not reopened. Workspace-ID alternative disabled.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a Creator Agent project thread on
Jordan's device folder `C:\dev\creator_agent`. Codex (a different model family)
wrote the CW-01 design, the governing design and the v1.1 note. The design review
and the v1.1 review were written by other Claude sessions (same model family). The
v1.1 review's F2 and I1–I3 are the conditions this design implements, so this
review partly evaluates conditions its own model family set. It was not blinded.
I wrote none of the reviewed documents. No external review service was used.

Static reading only: repository text, the hashed bundle read as text, `grep`/`sed`
excerpts, SHA-256 hashing, and read-only fetches of PostgreSQL 18 documentation,
REL_18_6 source and Microsoft's CreateProcess documentation (hashes in the receipt).
No code, tests, historical verifiers, imports, SQL, credentials, cluster start/stop,
launch, sign-in, operational config/environment/registry/process/port reads or
retired-checkout access. Upstream source describes PostgreSQL 18.6, not the
owner's installed binaries.

## Binding checks performed

- Design and snapshot hashes match the design receipt. All 343 snapshot entries
  rehashed directly: 0 mismatches, 0 missing. They include the governing design,
  note, both reviews, their receipts and snapshots, `packages/db/src/migrations.ts`,
  `postgres.rs` and the v4 helper core.
- Bundle `studio.mjs` `9d5ddac3…1da88`, `postgres.rs` `109615f4…b88b` and
  `scripts/theme-intent-upgrade-v4-core.mjs` `bd2e0105…23c7` match the values the
  v1.1 review recorded.
- The design's start argv (line 68) matches the v1.1 review's F2 condition
  character for character, with `-t 90`. The stop argv (line 74) matches the note's
  L2 specification. The design cites F1's corrected locators (lines 337–338).

## Schema29 predicate verification (exact bundle)

Every relation, column and state value in transaction A exists in schema29, and
each predicate selects exactly the nonterminal or uncertain states:

| Predicate | Bundle evidence | Result |
| --- | --- | --- |
| `workflows` finished_at null or state not terminal | enum 23144–23145; 23161 binds terminal ⇔ finished | Equivalent forms; correct |
| `workflow_tasks` finished_at null | enum 23205–23206; 23227 includes needs_human | Five nonterminal states; correct |
| `outbox` delivered_at null | 22654–22661 | Correct |
| `plan_requests` not in completed/failed/rejected/reconciled | 24804; later alters only add columns/purpose (24845–24858) | Catches in_flight, unknown |
| `plan_qualifications` running | 24789 | Correct |
| `budget_reservations` in_flight/unknown | 23038; provider-only alter 24741–24742 | Correct |
| `source_retrievals` in_flight | 23299–23300; 23321 binds in_flight ⇔ unfinished | needs_human is finished; correct |
| `context_batches` submitting/submitted/unknown | 23926–23927; consumer treats partial as terminal (36273) | Correct |
| `github_operations` dispatched/unknown | 24065–24066 | Correct |
| `marketing_deliveries` dispatching/unknown | 24565 | Correct |
| `portfolio_jobs` dispatching/unknown | 24631 | Correct |
| `desktop_jobs` not completed/cancelled/expired | 24167 | queued/leased/running/reconciling; correct |
| `artifact_previews` starting/ready | 23659 | Correct |
| `schema_migrations` version, name, checksum | ledger 24881–24886; versions 1–29 | Columns exist |

All state columns are `not null`, so `NOT IN` cannot drop rows here. The startup
path (`init`, 54695–54730; relay 54741–54750) is unchanged from the governing
trace. The bundle defines no row-level security: no `enable row level security`
or `create policy` appears. That matters for I-c below.

## Findings

### M1 — Medium: `address_ok` is always false

Locator: design line 157,
`pg_catalog.inet_server_addr()::text = '127.0.0.1' AS address_ok`.

PostgreSQL 18 `functions-net`: `text(inet)` "Returns the unabbreviated IP address
and netmask length as text. (This has the same result as an explicit cast to
text.) `text(inet '192.168.1.5')` → `192.168.1.5/32`". So the cast yields
`127.0.0.1/32`, and the comparison is false on every correct loopback connection.

Consequence: fail-closed, so there is no false pass. But transaction A can never
pass, and the statement is meant to be extracted, hashed and frozen as written.

Repair: compare without the netmask, for example
`pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1'`, or compare as
`inet`. State that a NULL result (a non-TCP connection) is a failure, not an
absent column. Re-review the extracted asset after the change.

### M2 — Medium: Windows `pg_ctl` cannot bind the launched postmaster; ownership evidence is unspecified

Locator: design lines 60–62 (ownership requires "exact launched process/cluster
identity and successful startup observation"), lines 78–81 (observe actual image
and cluster identity), line 265 (`postmaster.pid` existence only, in W2).

REL_18_6 `pg_ctl.c` on Windows:
- `start_postmaster` runs the postmaster through CMD.EXE and returns
  "Shell's PID, not postmaster's!" (509–519, 556–572).
- `wait_for_postmaster_start` accepts any pidfile whose start time is no more
  than 2 s before pg_ctl started: "Windows can only reject standalone-backend PIDs"
  (`pmpid > 0`, 617–626). It also treats `standby` status as ready (632–633).

So `-w` success on Windows shows that *some* postmaster in that data directory
reported ready around that time. It does not show that it is the child of this
pg_ctl call, or that it is a primary. The design correctly says exit 0 is not
ownership, but it names no evidence that is. The only per-instance record is
`postmaster.pid`: PID, data directory, start time, port, socket, listen address
and status lines. The design reads that file only in W2, existence only. W1 is
silent.

Consequence: fail-closed, or the implementer improvises an ownership rule.
Ownership gates the only stop the design admits, so this belongs in the reviewed
design, not in the adapter.

Repair (design scope): name the ownership evidence and its read scope. For
example: a bounded, handle-stable read of the `postmaster.pid` lines after `-w`
returns, with PID, data directory, port, status and start time matched to the
manifest and to the start intent. Bind that PID's image to the approved pg_bin
`postgres.exe`, and check that its parent chain leads to the CMD.EXE child of
this pg_ctl call. In transaction A, add
`pg_catalog.pg_postmaster_start_time()` (it must postdate start intent) and
`pg_catalog.pg_is_in_recovery()` (it must be false). Any mismatch means
`ownership_unavailable`, with no stop. Keep W2's existence-only rule unchanged.

### L1 — Low: pg_ctl's internal CMD.EXE conflicts with the "no shell" and environment-allowlist wording

Locator: lines 78–85.

pg_ctl takes CMD.EXE from `COMSPEC` or else uses the bare name `CMD`
(`pg_ctl.c:516–519`). It runs it through
`CreateProcessAsUser(restrictedToken, NULL, cmd, …, TRUE, …, NULL, NULL, …)`
(1844), so the child inherits pg_ctl's environment and handles. Microsoft's
CreateProcess documentation: a bare file name is searched first in "the directory
from which the application loaded", then "the current directory for the parent
process", before the system directory. The data-directory, log and `-o` text are
also embedded in a CMD.EXE command line (556–561).

Consequence: if the allowlist drops `COMSPEC`, `CMD` resolves from the pg_bin
directory or the working directory first. That is an N3-class executable-trust
gap. A path with CMD metacharacters (`%`, `^`, `&`, `"`) can change the postmaster
command even when our own argv is passed without a shell.

Repair: say that our adapter uses no shell, but pg_ctl does. Set `COMSPEC` to the
N3-bound system `cmd.exe` identity, and set the working directory to an approved,
non-writable location. Refuse cluster or log paths containing CMD metacharacters,
in addition to the argv-encoding rule. Expect `cmd.exe` as the postmaster's parent
in the M2 identity chain.

### L2 — Low: supervisor and pg_ctl deadlines coincide, and "process completion" is undefined

Locator: lines 87–91 (one 90 s start/stop deadline that "include[s] process
completion"; "do not kill the server when pg_ctl times out").

- pg_ctl's own `-t 90` starts after its setup, so the 90 s supervisor deadline will
  normally expire first. That leaves the supervisor in an unspecified state: abandon
  or kill pg_ctl. On Windows, killing pg_ctl does not stop a postmaster that has
  already started.
- Because handles are inherited (`TRUE`, 1844), stdout/stderr pipes given to pg_ctl
  are also held by CMD.EXE and the postmaster. If "completion" means pipe EOF, the
  start step will not complete while the server runs, and every start would be
  classed unknown.
- pg_ctl adds the child to its own job object only if it is not already in one
  (1846–1886). A supervisor that runs pg_ctl inside a kill-on-close job would put
  the postmaster in it too, and could kill the server when the supervisor exits.

Repair: set pg_ctl's `-t` strictly below the supervisor deadline (for example
`-t 80` under 90 s), or raise the supervisor deadline above it. Define completion
as pg_ctl process exit observed through its handle, not stream closure, and send
pg_ctl's output to a bounded file or to NUL. Never run pg_ctl inside a
kill-on-close job, and never terminate its process tree. Apply the same rules to
stop.

### L3 — Low: NULL `backend_type` rows drop out of every activity count

Locator: lines 189–193 and 234–238.

In REL_18_6 `pg_stat_get_activity`, `backend_type` is NULL for a background worker
whose type lookup fails (`pgstatfuncs.c:581–587`). It is also NULL for any row the
caller may not see in full (650–662). `= 'client backend'`, `= 'walsender'` and
`NOT IN (…)` all exclude NULL, so such a row is counted nowhere. The superuser
gate removes the visibility case but not the worker-lookup case.

Repair: add a fixed count of `backend_type IS NULL` rows that must be zero, or
require the total row count to equal the sum of the three categories. Do this in
both A and B.

### L4 — Low: the effective startup boundary is not cross-checked after start

Locator: line 44 (freeze startup inputs before start), lines 185–188 (effective
listener settings only); W2 scope at 258.

The design is right that a post-start check cannot repair a missing pre-start
boundary. But it also never *detects* a mismatch between the frozen inputs and
the running server, apart from listeners. pg_ctl accepts a standby as ready (M2).
The pre-start input list also does not name `recovery.signal` or
`standby.signal`, the files that select recovery mode, and W2 does not cover them.

Repair: add detect-only effective checks to transaction A: `pg_is_in_recovery()`,
`shared_preload_libraries`, `session_preload_libraries`,
`local_preload_libraries`, `archive_mode` and `max_wal_senders`. Compare them to
the frozen boundary as booleans or hashes, with no strings emitted. Add the
absence of both signal files to the pre-start boundary contract.

### Informational

- **I-a. Cancellation.** "Cancelling our own timed-out read" (line 247) through a
  client cancel request opens a second, short connection to the postmaster.
  Rely on server-side `statement_timeout`, or admit the cancel packet explicitly
  as the one exception to the single-connection rule. PostgreSQL 18 also offers
  `transaction_timeout` (`runtime-config-client`) as a server-side backstop for
  the 30 s phase.
- **I-b. Background allowlist (blocking already).** PostgreSQL 18 defaults
  `io_method=worker` with `io_workers=3` (`runtime-config-resource`). Autovacuum
  and parallel workers come and go. An exact type/count match will fail at random
  unless the allowlist uses ranges. It must also decide whether a transient
  autovacuum worker, which writes storage, is admitted.
- **I-c. Superuser rationale.** Line 121 justifies superuser by RLS. Schema29 has
  no RLS. The real need is `pg_stat_activity` visibility: superuser or
  `pg_read_all_stats` (`pgstatfuncs.c:37`; `monitoring-stats`). Superuser remains
  acceptable because it is the existing initdb actor and no new actor is allowed.
  The `relrowsecurity` columns still serve as fingerprint inputs.
- **I-d. Path spelling.** `current_setting('data_directory')` on Windows may use a
  spelling different from the manifest (separators, case). Compare under the N4
  single-spelling rule. A mismatch blocks.
- **I-e. pg_wal subdirectories.** The "known subdirectory names" for PostgreSQL 18
  include `archive_status` and `summaries`. Name them in the asset so other entries
  are rejected.
- **I-f. Attestation cross-reference.** The CW-01 attestation (six v1.1 items) is
  separate from the collector owner-attestation template. It does not cite the
  template's v1.1 clarification note (`0347619a…6c39`, Codex, not reviewed here),
  which answers template Lows L1–L3. It also gives no owner-side route for the
  pending manifest port and pg_bin values (template L3), and no OneDrive rule for
  the active-home literal (template L2, note v4.2). Cross-reference both before
  implementation, so the owner fills one coherent record.

## Assessment by requested area

- **SQL completeness:** complete and correct against schema29 for work predicates,
  ledger and catalog fingerprint inputs. Repairs are M1, L3 and L4.
- **Privilege/identity boundaries:** no new role, no grants, no wider credential,
  no argv/env/file credential, superuser checked before counts, fixed allowlist
  only. Correct. The protected-access adapter is properly marked blocking. I-c is
  a rationale correction only.
- **Start/stop ownership and races:** the no-adopt rule, smart-only stop, no
  escalation, foreign access meaning no stop and timeout meaning unknown are all
  correct. Repairs are M2, L1 and L2.
- **Fresh samples:** B is a new transaction on the same connection, which is what
  REL_18_6's per-transaction status snapshot requires (v1.1 review). The residual
  between samples is assigned to the attestation. Correct, plus L3.
- **W2/PR-01 extension:** the separate `PR01+W2/1` kind leaves original contracts
  frozen. Caps, stability, the immutable reference and the non-proof claims are
  correct, plus I-e.
- **Receipts/attestation:** the hash chain of confirmations, the
  `W1_W2_supported_W3_pending` ceiling, no prefill, an exclusive directory and no
  replay after a crash are correct, plus I-f.
- **Unresolved blockers:** the ledger and receipt honestly list N1–N4, collector
  L1/L4, actual bindings, the protected access mechanism, background/relation
  assets, attestation and grants. Nothing unresolved is presented as solved.

## Status of authority

This review is repository-only. It grants no implementation, cluster start or
stop, credential use, SQL, launch, sign-in or native-session authority. It does
not record or request Jordan's attestation. Existing items 1–6 field-inspection
authority is unchanged. M3 is not reopened. No owner decision is requested.

## Exact next bounded prompt

> When Jordan chooses, prepare an additive repository-only CW-01 implementation
> design v1.1 note (no code) against
> docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md (7aaa898c…7252) and
> docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_REVIEW_2026-10-26.md. Repair M1
> (address comparison without netmask; NULL fails) and M2 (named Windows ownership
> evidence: postmaster.pid line read scope, image/parent binding,
> pg_postmaster_start_time, pg_is_in_recovery). Address L1–L4 and, where useful,
> I-a to I-f. Preserve all prior bytes. No implementation, operational reads,
> SQL/credentials, cluster start/stop, tests/verifiers, launch or sign-in. Then
> stop for independent review.

Alternatively, Jordan may defer native acceptance. Either choice is Jordan's; no
milestone starts automatically.
