# CW-01 implementation design v1.1 note independent review — October 26, 2026

Prompt: U02 (independent review), repository-only. Reviewed note:
`docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_NOTE_2026-10-26.md`, SHA-256
`0462b51605bdb2fad3ed0586594e8f31ecb216620e6d4a373a88c5c9788ebb81`, with its repair
receipt (`ce15033f…aa9f`) and input snapshot
(`ba937675…2c99`, 348 entries). Frozen design `7aaa898c…7252`; frozen review
`7619804d…f196` (findings M1, M2, L1–L4, I-a–I-f).

## Verdicts

- **Design support: SUPPORTED at design scope, with three Low conditions.** M1 is
  fixed. M2 is fixed in substance: the note names the ownership evidence (a W1
  pidfile read, a pg_ctl → CMD.EXE → postmaster instance chain, SQL start time and
  recovery state) and makes every gap `ownership_unavailable`. L2, L3 and L4 are
  fixed. L1 is fixed for COMSPEC and path metacharacters, but misses CMD.EXE
  AutoRun (R1). Two Lows tighten M2 so the chain does not rest on an undocumented
  Windows guarantee (R2) or on time matching alone (R3). None of the three allows
  a false ownership pass that the frozen design blocked; R1 is the one gap that
  does not fail closed. They are conditions for the implementation design and the
  adapter review, not reasons to reopen the note.
- **Implementation readiness: NOT STARTED.** No CW-01 inspector, process-metadata
  adapter, W1 pidfile reader, protected-access adapter, reader N1–N4 parity
  adapter, collector L1/L4 or PR01+W2/1 extension exists. Implementation needs its
  own authorization.
- **Operational/native readiness: NOT READY (blocked).** Port, home, pg_bin,
  startup/HBA/background boundary, relation fingerprints, observer credential
  mechanism, the new W1 pidfile-read scope and concrete grants are unbound.
  Jordan's attestation is blank; other-producer access is still unknown. Native
  acceptance blocked, original A0 blocked, NI not-run, H unverified, full C54
  partial. M3 unchanged and not reopened. Workspace-ID alternative disabled.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a Creator Agent project thread on
Jordan's device folder `C:\dev\creator_agent`. Codex (a different model family)
wrote the frozen design and this note. The frozen design review, whose findings
this note answers, was written by another Claude session (same model family), so
this review partly judges repairs to findings its own model family raised. It was
not blinded. I wrote none of the reviewed documents. No external review service.

Static reading only: repository text, SHA-256 hashing, and read-only fetches of
PostgreSQL 18 documentation, REL_18_6 source and Microsoft documentation (hashes
in the receipt). No code, tests, historical verifiers, imports, SQL, credentials,
cluster start/stop, launch, sign-in, operational config/environment/registry/
process/port/pidfile reads, or retired-checkout access. Upstream source describes
PostgreSQL 18.6 (REL_18_6 `configure.ac` AC_INIT 18.6), not the owner's installed
binaries. Line numbers below are from the raw REL_18_6 files as fetched.

## Binding checks performed

- Note and snapshot hashes match the repair receipt. All 348 snapshot entries
  rehashed directly: 0 mismatches, 0 missing. They are the frozen design's 343
  plus the design, its receipt and snapshot, the review and its receipt.
- Frozen design `7aaa898c…7252` and frozen review `7619804d…f196` unchanged; both
  receipts and the design snapshot unchanged.
- The note's four local links resolve (design, review, collector template and its
  v1.1 note). The note only adds text; it states that the frozen SQL is not edited
  and a successor asset must be hashed.

## Assessment of the repairs

### M1 — resolved

`host(inet)` "Returns the IP address as text, ignoring the netmask"
(`functions-net`); `network_host` strips any `/n` (`network.c:1138–1157`).
`inet_server_addr()` returns NULL for a non-TCP connection
(`network.c:1753–1784`). The new expression is therefore true on a 127.0.0.1 TCP
connection and NULL otherwise. The note requires an actual boolean true and treats
NULL, missing, false or error as blocking. That is the requested repair.

### M2 — resolved in substance; R2 and R3 tighten it

What the note gets right, checked against REL_18_6:

- `start_postmaster` returns "Shell's PID, not postmaster's!" (`pg_ctl.c:572`), and
  `wait_for_postmaster_start` on Windows only rejects negative PIDs, allows 2 s of
  slop and accepts `standby` (`pg_ctl.c:617–638`). The note treats `-w` success
  as necessary but not sufficient.
- The pidfile layout and status strings match `pidfile.h` (eight lines; `ready   `
  and `standby ` are space-padded). Requiring line 8 `ready   ` rejects standby.
  The PID must be positive (a standalone backend writes a negative PID,
  `miscinit.c:1438`).
- The pidfile time (`MyStartTime`, from `InitProcessGlobals`,
  `postmaster.c:502`, `1935–1936`) is captured before `PgStartTime`
  (`postmaster.c:1372`). So the note is right not to demand equality, and the
  ordering "pidfile seconds ≤ SQL start time" holds.
- W2 stays existence-only; the W1 read is declared as new scope needing its own
  grant. No pidfile overwrite or removal.
- Pre-stop revalidation covers pidfile, handles, image, cluster and SQL instance.
  The note states honestly that the last check is not atomic with pg_ctl's signal.

Is ownership reachable on Windows without PID or clock guessing? Yes, at design
level. pg_ctl creates exactly one launch shell (`CreateRestrictedProcess`,
`pg_ctl.c:1844`), and `cmd /C` waits for postgres, so the shell stays alive while
the postmaster runs. Walking up from the pidfile PID gives a chain that can be
checked against live handles. R2 says which predicate makes that sound.

### L1 — partly resolved; see R1

COMSPEC pinning is right: pg_ctl falls back to bare `CMD` when COMSPEC is unset
(`pg_ctl.c:516–519`). The metacharacter list covers CMD's parsing hazards,
including `!` for delayed expansion. A fixed system working directory and fixed
argv are right. Not covered: CMD.EXE AutoRun (R1).

### L2 — resolved

`-t 80` inside a 90-second outer deadline separates the two deadlines.
Completion is process-handle exit, not pipe EOF. Standard handles are NUL.
There is no kill, tree-kill, second stop or cleanup. pg_ctl's own job is created
only when the shell is not already in a job, with no kill-on-close flag
(`pg_ctl.c:1846–1886`). So the hazard is only an inherited job, which the note
refuses. Note that pg_ctl's `-t` counts loop iterations with sleeps
(`pg_ctl.c:597`, `721`, `758`), not wall time. The note already says the
remaining time is not guaranteed slack. See I1 for nested jobs.

### L3 — resolved

A separate `backend_type IS NULL` count must be zero in both A and B, inside the
same transaction snapshot as the other counts. It is not folded into a known type.

### L4 — resolved

Signal-file absence before start and in both W2 captures, existence only, never
removed. Detect-only checks of the five settings are compared privately and only
booleans or hashes are emitted. `pg_is_in_recovery()` is mandatory in A and B
("Returns true if recovery is still in progress", `functions-admin`). The note
keeps the pre-start boundary mandatory and does not claim post-start repair. See
I4 for the per-session preload settings.

### Informational dispositions I-a–I-f — supported

- I-a: `transaction_timeout` "terminate[s] any session" that stays in a
  transaction too long (`runtime-config-client`). At 30 s it is longer than the
  2 s statement and idle timeouts, so none of those is ignored. Dropping the
  cancel-request connection keeps the single-connection rule.
- I-b, I-c, I-d, I-e: consistent with the frozen review. Nothing is filled in by
  default.
- I-f: links the collector template and its v1.1 note, adds the OneDrive rule and
  an owner-side route for port/pg_bin, and keeps the six-item undertaking
  separate. The v1.1 template note itself is still unreviewed here.

## Findings

### R1 — Low: CMD.EXE AutoRun runs inside the launch chain and is not addressed

Locator: note §L1. Source: pg_ctl builds `"<COMSPEC>" /C ""<postgres>" …"` with
no `/D` (`pg_ctl.c:556–561`). Before that, `find_other_exec` runs
`"<postgres>" -V` through `popen` (`pg_ctl.c:952`; `exec.c:330`, `360`), which on
Windows is `pgwin32_popen` → `_popen` (`port.h:365–368`; `system.c:108`). `_popen`
"executes a spawned copy of the command processor". Microsoft `cmd`: "If you don't
specify /d, cmd looks for the following registry subkeys:
HKEY_LOCAL_MACHINE\Software\Microsoft\Command Processor\AutoRun …
HKEY_CURRENT_USER\Software\Microsoft\Command Processor\AutoRun … they're executed
before all other variables."

Consequence: an AutoRun value (developer tools commonly install one in HKCU) runs
in both shells before postgres starts. It can change the environment the
postmaster inherits, which bypasses the design's child-environment allowlist. It
can also start extra children of the shell. COMSPEC pinning does not prevent it.
The adapter cannot add `/D`, because the note correctly forbids shell switches
and `-o` text. This is the one gap that does not fail closed.

Repair (design scope): add a detect-only, existence-only check of both AutoRun
values, so present or unavailable blocks start. Never read the value text into
receipts, and never delete or edit the values. This is new registry read scope
that needs its own exact grant. Pin the System32 `cmd.exe` so the Wow6432Node
variant is out of scope, or check it too. Alternatively, cover it explicitly in
the owner attestation, but technical evidence is preferable.

### R2 — Low: the parent-link proof relies on a PID non-reuse guarantee Microsoft does not document

Locator: note §M2 "Retain our pg_ctl handle after it exits, so a recycled PID
cannot substitute"; "expected parent PID/creation ordering".

Microsoft, "Process Handles and Identifiers": handles "are valid until closed, even
after the process … has been terminated", but "The identifier is valid from the
time the process is created until the process has been terminated." The docs do
not promise that a PID stays unused while a handle is open.
`PROCESSENTRY32W.th32ParentProcessID` is only "The identifier of the process that
created this process". It is a PID, not a handle. A lower bound on creation
ordering alone does not exclude a process that got pg_ctl's PID after pg_ctl
exited.

Repair: state the containment predicate on documented `GetProcessTimes` values
from retained handles. (1) The CMD shell's creation time is at or after pg_ctl's
creation, and either pg_ctl is still running or the shell was created at or
before pg_ctl's exit time. (2) The postmaster was created at or after the shell,
and the shell is still running when observed (`cmd /C` waits for postgres).
(3) Walk upward from the pidfile PID, not downward from pg_ctl. pg_ctl's earlier
`postgres -V` probe also creates a CMD.EXE and a postgres.exe child (R1 sources).
A downward search over the start phase can find two shells, and the note forbids
choosing between them. These are kernel timestamps on the same retained handles,
compared only for order, so they are not clock guesses. The note's
clock-discontinuity rejection still applies.

### R3 — Low: the SQL session is linked to the bound postmaster only indirectly

Locator: note §M2 "Match both SQL observations to the same pidfile/process-chain
instance"; frozen design A's `data_directory`/`port` settings and its OS listener
collector.

As written, the match rests on time intervals with one-second pidfile precision,
plus the data-directory lock and Windows `SO_EXCLUSIVEADDRUSE` binding
(`pqcomm.c:562`). That is sound in practice but implicit, and the user asked for
ownership without clock reasoning. A direct link is available with the same
adapter. Add `pg_catalog.pg_backend_pid()` to the fixed instance query, and
require our backend's parent to be the bound postmaster, created after it, under
R2's predicate. Or require the reviewed listener collector to report the
127.0.0.1:port listener's owning PID as the bound postmaster. Make one of these
mandatory, keep the times as supporting evidence, and emit only match booleans.

### Informational

- **I1. Nested jobs.** With a NULL handle, `QueryInformationJobObject` reports only
  "the immediate job of the calling process" when jobs are nested (Microsoft).
  Outer job policy cannot be seen that way. State the conservative predicate:
  refuse when `IsProcessInJob` is true unless every enclosing job's policy is
  established, which in practice means start only outside any job.
- **I2. Pidfile lines 2 and 7.** `pidfile.h` says line 7 is "empty on Windows",
  and `win32_shmem.c` writes nothing to it, so say "must be empty". Line 2 is
  PostgreSQL's own spelling of the data directory, which may differ from the
  manifest in separators. Compare it only under the N4 rule (I-d), without
  normalization.
- **I3. Crash-reinitialization.** `PgStartTime` is set once (`postmaster.c:1372`),
  so equal A/B start times do not show that no crash-restart happened under the
  same postmaster. A crash-restart ends our backend, so B on the same connection
  fails. Record that the same-connection rule is what covers this case.
- **I4. Per-session preloads.** `session_preload_libraries` and
  `local_preload_libraries` read via `current_setting` describe our session.
  Role or database settings can differ for other sessions. Label them as
  per-session evidence.
- **I5. Privacy of process metadata.** A Toolhelp snapshot reads every process
  name into memory. The note's "retain only scoped instances" is the right bound.
  An upward walk from the pidfile PID through handle queries (R2) keeps the
  unrelated reads to a minimum.

## Assessment by requested area

- **Reachable Windows ownership without PID/clock guessing:** yes at design
  scope, with R2's containment predicate and R3's direct SQL link. The
  process-metadata adapter is unimplemented and unqualified.
- **Bounded, non-destructive spawn/stop:** supported. One start and one smart
  stop, separate inner and outer deadlines, handle-exit completion, NUL handles,
  no kill/tree-kill/escalation/retry/cleanup, refusal of inherited kill-capable
  jobs (I1), and unknown preserved on timeout. The residual stop race is stated
  and assigned to the attestation. R1 is the remaining launch-chain gap.
- **SQL A/B changes:** coherent. A adds the M1 expression, the instance and
  recovery query, the NULL count and the startup-boundary settings. B adds the
  instance and recovery query and the NULL count in a fresh transaction. Session
  setup adds `transaction_timeout`. All are fixed `pg_catalog` reads; no new
  parameters beyond the existing tuples, no writes. A successor SQL asset must be
  extracted and hashed. R3 would add `pg_backend_pid()`.
- **Evidence/privacy scope:** supported. Coded or hashed outputs only. No raw
  pidfile, shared-memory value, command line, environment, unexpected preload
  string or SQL error. Two new read scopes need exact grants: the W1 pidfile
  (declared) and the AutoRun registry check (R1).

## Status of authority

This review is repository-only. It grants no implementation, W1 pidfile read,
registry read, process inspection, cluster start or stop, credential use, SQL,
launch, sign-in or native-session authority. It does not record or request
Jordan's attestation. Existing items 1–6 field-inspection authority is unchanged.
M3 is not reopened. No owner decision is requested beyond choosing what comes next.

## Next options (Jordan's selection; nothing starts automatically)

1. A small additive CW-01 v1.2 note (no code) that closes R1–R3 and, where
   useful, I1–I4, then a narrow independent review.
2. Carry R1–R3 as stated conditions into a later, separately authorized CW-01
   implementation design and adapter review, without another note.
3. Defer native acceptance.
