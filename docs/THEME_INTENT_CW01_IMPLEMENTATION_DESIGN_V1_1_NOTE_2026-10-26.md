# CW-01 implementation design v1.1 additive note — October 26, 2026

Codex-authored repository-only repair; independent exact-byte review pending.
Jordan authorized this note, not implementation or operational activity. Read with
the frozen [implementation design](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md)
(`7aaa898cf8fc6b6a2d2b728a2e32e92dfc4ed295dfff44d29d4cdf4c30c17252`)
and [review](THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_REVIEW_2026-10-26.md).
Only the contracts explicitly corrected below supersede proposed design text.
Prior receipts/documents/source bytes remain unchanged. No passing verdict or
operational authority is self-issued.

## M1: address predicate

Replace only transaction A's address expression with:

```sql
pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1' AS address_ok
```

Require an actual boolean true. NULL (including non-TCP), missing field, false or
driver error is unavailable/blocking, never truthy or absence. No IPv6/other
loopback substitution. Other database/port/isolation/read-only identity gates stay.
Hash/review a successor fixed SQL asset; do not edit the frozen design's SQL.

## M2: explicit Windows instance ownership, not pg_ctl readiness

`pg_ctl -w` success is necessary but insufficient. Its Windows child identity may
be CMD.EXE, and it can accept a recent ready/standby pidfile. Ownership is the
conjunction below, with any absent/inaccessible/contradictory evidence producing
`ownership_unavailable`. Neither a recent timestamp, process basename nor a
pidfile alone establishes ownership.

Amend the state machine to insert `candidate_process_bound` after start and
before the sole SQL connection. It admits only fixed observer authentication and
instance-identity queries, under the explicit credential grant. No work counting,
`owned_running` claim or stop authority until SQL instance identity also passes.

### Start intent and process chain

Before the single start, persist request/manifest hashes, complete stopped
preflight, no preexisting pidfile/process, and paired wall-clock/monotonic time.
The native launch adapter retains the exact pg_ctl process handle and creation
time; its PID is not reused as the postmaster PID. Under the bounded start phase,
capture the actual parent links and query handles for the associated CMD.EXE and
postmaster. Required chain: this exact pg_ctl instance → approved CMD.EXE instance
→ approved postgres.exe postmaster instance. No alternative ancestor, chain-depth
guessing, basename search or newest-process heuristic. If the shell/parent evidence
is no longer obtainable, fail closed rather than infer the chain.

Bind each instance using PID plus creation time and a retained, non-inheritable
query/synchronize handle, actual image path/file identity/hash and expected parent
PID/creation ordering. Use limited query rights, no debug/terminate/suspend rights.
Retain our pg_ctl handle after it exits, so a recycled PID cannot substitute.
Validate parent links with a reviewed native process-metadata adapter (for example
Toolhelp parent PID plus open-handle creation/image checks). Any system snapshot
must be bounded/private and retain only these scoped instances; no unrelated
process names, command lines or environment in receipts. No elevated trace/debug
privilege, new service or broad process log is selected. This adapter remains
unimplemented and must prove parent/PID-reuse handling in later isolated checks.

### Narrow W1 pidfile read scope

Add an explicit W1-only, bounded stable read of exact `<cluster>/postmaster.pid`
after pg_ctl exits successfully. Cap 16 KiB, ordinary single-link file with no
reparse ancestry, before/open-handle/after identity checks, strict encoding and
the eight-line REL_18_6 layout. Reject malformed/extra nonempty lines and unstable
reads. Allow only the documented ready-status padding, not arbitrary normalization.
Read privately: positive postmaster PID, exact data directory, epoch start seconds,
manifest port, socket/listen fields and status. Shared-memory line is validated
for the Windows layout and not emitted. Negative standalone PID, standby/starting/
stopping status, extra sockets, wrong directory/port/listener or any ambiguity blocks.

The PID must equal the process-chain postmaster. The directory must pass the N4
approved spelling/identity rule; line 5 must be empty, line 6 `127.0.0.1`, line 8
ready. This is **new operational read scope**, requiring exact review/grant; it
does not authorize other pidfile/log/config contents. Preserve W2's existing
pidfile existence-only rule. Do not overwrite/remove a pidfile to establish ownership.

### SQL confirmation and pre-stop revalidation

After existing observer privilege/TCP/database checks, before work predicates,
add the following fixed query in transaction A; repeat in fresh transaction B:

```sql
SELECT pg_catalog.pg_postmaster_start_time() AS server_started_at,
       pg_catalog.pg_is_in_recovery() AS in_recovery;
```

Require non-NULL `in_recovery = false`, typed non-NULL timestamp, and unchanged
SQL start timestamp between A and B. Match both SQL observations to the same
pidfile/process-chain instance. All times must fit the recorded start-intent →
process creation → readiness interval. The pidfile's integral seconds are a
one-second precision interval: require it overlaps the postmaster lifetime after
creation and precedes SQL startup completion, allowing only that encoding
precision. Do not demand equality with the later SQL startup timestamp or use
pg_ctl's permissive two-second age test as our proof. Reject clock discontinuity
or inconsistent ordering; monotonic clocks bound durations, UTC times bind events.
Time consistency supplements, never replaces, actual ancestry/image evidence.

Before stop revalidate stable pidfile/process identity, retained handle liveness,
image/cluster ownership and unchanged SQL instance evidence, alongside B's fresh
activity and no-adoption checks. A changed/dead instance, foreign backend or
uncertain ownership forbids stop. No reconnect to identify a replacement. The
last observation is not atomic with pg_ctl's signal; the remaining race is covered
only by the accepted no-other-producer attestation, not prevention. Unknown means
preserve state and scoped follow-up, never stop an arbitrary current pidfile PID.

## L1: pg_ctl's internal shell and executable trust

Our adapter launches pg_ctl directly without a shell; **pg_ctl itself uses CMD.EXE**
on Windows. Pin child `COMSPEC` to an absolute, independently located, hash-bound
system cmd.exe with N3 source/identity validation. Never omit COMSPEC and fall
back to bare CMD, or trust inherited SystemRoot/PATH. Bind CMD.EXE in the M2 chain.
Use a manifest-approved system working directory verified not writable by an
unprivileged account; no repository/pg_bin/current-directory executable search.
Unknown trust/ACL evidence blocks; do not change ACLs to make it pass.

For every shell-interpolated executable, cluster and log path, admit only the
already strict canonical path subset further rejecting `"`, `%`, `^`, `&`, `|`,
`<`, `>`, `!`, `(`, `)`, control characters and unapproved substitutions/aliases.
The adapter supplies only fixed quoted argv/options and a validated decimal port;
no arbitrary `-o`, shell switches or owner command text. Keep paths with ordinary
spaces supported through reviewed encoding. Unsupported legitimate paths defer
rather than normalize them. No copying/renaming operational files is authorized.

## L2: separated deadlines, process exit and non-destructive handles/jobs

Replace start/stop's pg_ctl `-t 90` with **`-t 80`**, retaining a **90-second outer
deadline** for each phase from before spawn through required ownership/stop
observation. Remaining time is not guaranteed slack; setup counts toward the
outer cap. Never extend it or report pg_ctl success after the outer deadline as
a pass. Start/stop modes, one-attempt limits and command options otherwise stay.

Completion is pg_ctl's process-handle exit/status plus required identity evidence,
not stdout/stderr EOF or CMD/postmaster exit. Give pg_ctl standard handles NUL
(no diagnostic pipes); PostgreSQL's `-l` target remains the approved log with its
separate write-effect scope. No log dump. Retained process/ownership handles are
not inherited. Close them according to the receipt lifecycle, not to terminate
processes. Record unknown on timeouts; do not kill pg_ctl/server/tree, wait
unboundedly for EOF, send another stop or clean up to pass.

Do not place pg_ctl or its descendants in a kill-on-close job. Preflight must
establish the launch context has no inherited job policy capable of killing
descendants on supervisor close. If a constrained host would propagate that
policy, refuse start; no silent breakaway/elevation or job-policy mutation.
pg_ctl's own restricted-token/job behavior must be included in the later adapter
review, not assumed equivalent to ordinary spawn. A supervisor crash can leave
the owned cluster running; preserve unknown state for a new decision.

## L3: account for NULL activity types

Add this fixed SELECT to both A and B activity observations:

```sql
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type IS NULL;
```

Require zero, with normal decimal/availability rules. Keep cluster-wide client,
walsender and background categories. NULL is not dropped by NOT IN or silently
folded to a known background type. Maintain B's new transaction; no cached A copy.

## L4: detect-only startup-boundary cross-checks

Before start, add exact `recovery.signal` and `standby.signal` absence checks to
the approved cluster/startup-boundary scope. Reject either present/unavailable;
never remove them. Repeat these existence checks in reference/comparison W2
captures under PR01+W2/1; unknown/difference invalidates. No file contents read.

After the observer/instance identity gates in A, before work predicates, add:

```sql
SELECT pg_catalog.current_setting('shared_preload_libraries') AS shared_preloads,
       pg_catalog.current_setting('session_preload_libraries') AS session_preloads,
       pg_catalog.current_setting('local_preload_libraries') AS local_preloads,
       pg_catalog.current_setting('archive_mode') AS archive_mode,
       pg_catalog.current_setting('max_wal_senders') AS max_wal_senders;
```

Compare privately to the frozen reviewed startup-boundary asset; emit only per-field
match booleans or expected/actual hashes, not unexpected library strings. All
values must be available and match. Values/ranges are still unbound, not inferred
from defaults. `pg_is_in_recovery()` is already mandatory in A and B under M2.
These checks detect divergence; they cannot undo preload/archive/startup effects.
The complete pre-start boundary remains a mandatory blocker before any launch.

## Informational dispositions I-a–I-f

- **I-a:** rely on server-side statement/idle timeouts and the 30-second total
  client phase bound; add fixed session `SET transaction_timeout = '30s';` as a
  backstop, not a resettable total-phase timer. Remove the permission to open a
  second connection for a client cancel request. On deadline disconnect only our
  connection; without a timely B/ownership observation there is no stop authority.
  No termination of other backends. No configuration-file timeout change.
- **I-b:** background manifest entries are exact type names with reviewed integer
  min/max counts and an explicit `writes_storage`/startup-effect disposition, not
  a brittle single count. Include PostgreSQL18 I/O workers and dynamic autovacuum/
  parallel activity in the assessment. No default ranges are filled here. Unknown
  type, NULL, out-of-range or unreviewed effect blocks; don't disable maintenance
  or alter settings to pass. Background boundary asset remains pending.
- **I-c:** retaining the existing manifest-bound superuser actor is for complete
  activity visibility and the existing protected credential path. Schema29 has
  no RLS; relrowsecurity remains a fingerprint/change-detection field. Do not
  create/grant a new role or seek a wider credential if this actor is unavailable.
- **I-d:** data-directory spelling must meet the approved N4 literal/identity
  rule; do not canonicalize an unknown variant into a match. Mismatch blocks.
- **I-e:** pg_wal known subdirectory types/names are `archive_status` and
  `summaries`, contents not traversed. Unknown directories, reparse entries or
  inventory cap excess block. WAL files remain metadata-only, never no-write proof.
- **I-f:** link the future single manifest/owner-input record to the
  [collector template](THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_2026-10-25.md)
  and its [v1.1 clarification](THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_V1_1_NOTE_2026-10-25.md).
  Port/pg_bin may use owner-produced field-only evidence with source/time/method;
  otherwise the separately reviewed adapter and existing matching grant are
  required. No app launch or ad hoc config parser to fill them. Active-home/key
  admission includes ASCII-case-insensitive rejection of components beginning
  `onedrive`; shortcut storage in OneDrive does not identify the home. Preserve
  literal launch LOCALAPPDATA/key binding. The six-item CW-01 W1–W3 undertaking
  remains separate, freshly affirmed and hash-linked to this common record.
  All blanks/unknowns, including other-producer access, stay pending.

## Evidence, sources and remaining gates

Add W1 pidfile-read/process-chain scope, exact CMD/system/working-directory trust,
job context, creation/clock relationships, pidfile status codes, per-field instance/
SQL matches, NULL activity counts, signal-file existence and startup-boundary
comparison results to the future manifest/receipt schema. Do not emit raw pidfile,
paths beyond approved scope, shared-memory values, command lines, environment,
unexpected preload strings or SQL errors. Hash-bound identifiers/times and coded
match/availability evidence suffice. No observation of these inputs occurred here.
Missing adapter/API evidence is blocking, not satisfied by this design description.

Official sources read October 26, 2026:

- [PostgreSQL18 network functions](https://www.postgresql.org/docs/18/functions-net.html):
  `host(inet)` omits netmask, unlike explicit text conversion; supports M1.
- [REL_18_6 pg_ctl.c](https://github.com/postgres/postgres/blob/REL_18_6/src/bin/pg_ctl/pg_ctl.c):
  `start_postmaster`, `wait_for_postmaster_start`, `CreateRestrictedProcess`;
  supports readiness-versus-ownership, COMSPEC/internal shell, inherited handles
  and job caveats. Use named symbols, not web-rendered line numbers.
- [REL_18_6 pidfile.h](https://github.com/postgres/postgres/blob/REL_18_6/src/include/utils/pidfile.h):
  eight-line pidfile layout/status definitions; W1 read scope only.
- [REL_18_6 postmaster.c](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/postmaster/postmaster.c):
  `InitProcessGlobals` and `PostmasterMain` capture different startup timestamps;
  pidfile time and SQL startup time are not required to be equal.
- [PostgreSQL18 information functions](https://www.postgresql.org/docs/18/functions-info.html),
  [recovery functions](https://www.postgresql.org/docs/18/functions-admin.html), and
  [client settings](https://www.postgresql.org/docs/18/runtime-config-client.html):
  SQL instance/recovery/timeouts; no SQL executed.
- Microsoft [process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags),
  [process creation time](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
  [parent PID metadata](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w):
  handle/creation/ancestry inputs are supporting adapter design, not executed
  Windows process-provenance qualification or protection against a hostile owner.

Original reader N1–N4/collector L1/L4, protected access, actual configuration/tool
identities, boundary/fingerprint assets, owner attestation and operational grants
remain blocking. Source behavior does not establish installed binary authenticity.
No new candidate, migration, worker/provider permission or M3 standard is selected.
M3 unchanged, original A0/native blocked, NI not-run, H unverified, full C54 partial;
workspace-ID alternative disabled. No implementation, tests/verifiers, operational
config/OS/process/pidfile/SQL/credential reads, cluster/app actions or activation.

Next eligible: independent exact repository-only review of this note/receipt,
frozen design/review and cited official sources. Assess M1/M2 and L1–L4, reachable
Windows ownership without PID/clock guessing, bounded non-destructive spawn/stop,
SQL A/B changes and evidence/privacy scope. Report design support separately from
implementation/operational readiness. Preserve all prior bytes. No implementation,
tests/verifiers, operational reads, SQL/credentials, cluster start/stop, launch/
sign-in, recovery or next milestone. Then stop for owner selection.
