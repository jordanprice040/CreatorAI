# Current-work safety design v1.1 additive note — October 26, 2026

Prepared by Codex, author of the original design. Independent support pending.
Companion to the frozen [design](THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md),
SHA-256 `e4313c2013c919be7c762ff58a20653a15a7721af71ac37ae044fc9208a58dfa`,
addressing Claude's [M1/L1/L2 review](THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_REVIEW_2026-10-26.md).
Supersedes only the producer-exclusion/continuity procedure, task predicate and
ambiguous stop wording specified below. No implementation, operational grant,
attestation, live result or native-session authority is supplied.

## M1: three windows, evidence and explicit residual assumptions

CW-01 remains one conditional database-only inspection, not desktop/service startup.
The proposed pass predicate is: all original admission/identity/schema/count gates
(with L1 below), supported W1 observations, owned smart stop, supported W2
comparison, and the exact W1–W3 owner attestation below. W3 is monitored/attested
during a separately authorized native session; it is not completed prospectively.
Any missing prerequisite keeps acceptance deferred. This is a threat-bounded
combination of source, observation and human evidence, not technical exclusion
of every same-account process. Independent review must support that boundary
before implementation. No risk acknowledgment substitutes for these predicates.

### W1 — controlled cluster-up inspection through owned stop

Require PR-01 and bound cluster ownership before the single owned start. Require
evidence of the actual loopback listener and approved authentication/configuration
boundary, not merely a default or an initdb source comment. Verify no alternate
listeners, authentication exceptions, replication/recovery/custom startup producers
or unknown extension behavior within the reviewed exact scope. Unknown means stop.
No broad config dump or new operational read is authorized by this note; the
future field-limited capability and grant must explicitly cover needed evidence.

Observe zero foreign client backends for the cluster, excluding only CW-01's own
connection, during the predicate phase and again immediately before disconnect/
owned stop. Include other databases in this cluster rather than treating their
clients as unrelated. Emit counts/times/availability, no account names, query text
or rows. Require adequate observer privilege; inaccessible activity is unavailable.
Background worker/replication/startup activity must match the reviewed startup
boundary; a zero client count does not rule it out.

Use one connection. The fixed work predicates remain in the original repeatable-read
read-only transaction. Roll it back, then take a fresh activity observation on that
same connection in a new read-only transaction before disconnecting. This is a
deliberate small amendment to the original one-transaction wording; retain the
30-second total SQL cap and 2-second statement/lock limits. Do not reuse a cached
activity snapshot. Activity is an observation of processes, not MVCC evidence about
all prior connections. A transient connect/write/disconnect between samples is
not excluded by two zero counts; the attestation covers this residual.

Loopback plus SCRAM/password protection reduces exposure but does not prove that
only Jordan's account can connect. Other local processes can reach loopback;
credentials may have been shared, HBA changed or privilege boundaries bypassed.
Record these assumptions explicitly. Current other-session access is unknown;
source defaults do not resolve it.

### W2 — stopped gap through final prelaunch decision

After a successful owned stop and independent stopped-state observation, capture
an exact-scope fingerprint: `global/pg_control` SHA-256/size/file identity;
nonrecursive sorted `pg_wal` entry names/types/sizes; `postmaster.pid` absence;
cluster/config/tool identity and availability, all bound to the manifest. Reject
reparse/alias/race ambiguity and unsupported layout. Do not follow WAL symlinks
or recurse into unrelated files. No raw control/WAL contents are emitted.

Fresh PR-01 immediately before the separately approved launch must repeat these
inputs and compare exact fingerprints. Capture start/end times; ensure each
capture is stable and the cluster remains stopped. Difference, missing/inaccessible
input, positive process/listener/object evidence or uncertain no-attempt coverage
invalidates the window. Never refresh the reference fingerprint after an unexplained
change or repeat until it matches. Extend PR-01 only through separately reviewed
implementation/scope; current PR-01 contract alone does not read these new files.

**Permitted claim:** the two sampled fingerprints match, with no intervening start,
offline write/restore or other producer activity reported under the enumerated
attestation and trusted-storage assumptions. **Forbidden claim:** unchanged
fingerprints prove that no start or database write occurred. WAL segment files have
fixed sizes and can change without changing their names/sizes. A control-file hash
is supporting change detection, not an authenticated historical log. It does not
exclude byte restoration, offline edits to other data files, alternate binaries,
single-user access or starts failing before the observed startup transition.

PostgreSQL's normal startup/shutdown path supports this supplemental evidence;
it does not make every attempted postmaster start permanently distinguishable.
Do not infer the converse from a control-file rewrite. If independent review
requires technical proof rather than the expressly attested, trusted-owner threat
boundary, W2 is insufficient: defer for a separately designed control. No whole-WAL
hashing, filesystem watcher or anti-tamper subsystem is silently added.

The last comparison cannot protect the gap between it and launch. Maintain the
same no-attempt/exclusion attestation through final handle closure, launch handoff
and W3. A new event, unknown interval or changed identity invalidates prospective
use; no timestamp TTL repairs it. Do not call these observations continuous control.

### W3 — separately authorized native session

Keep proposal v4 and notes v4.1–v4.4, exact-bundle M3, all UI baselines/write limits,
no-dispatch scope, explicit Quit and SH-01 requirements. Maintain the attestation
through final shutdown observation. Same-account automation is not technically
prevented by PR-01, database counts or a Local mutex. Any report/observation of an
unexpected producer or launch attempt stops the relevant sequence, preserves the
incident and invalidates prospective clearance; no clean retry erases it.

### Required owner attestation — blank until actually supplied

Before W1, Jordan must identify the operator and exact window scope and affirm
each item with basis and uncertainty, then confirm no intervening exception through
W2 and W3 completion. Do not prefill these from earlier reports:

1. No other Codex, Claude or other agent/device session will launch, connect to,
   configure, inspect operationally or write this studio/home/database during W1–W3.
2. No standalone worker, helper, script, terminal command, alternate shortcut,
   automatic updater/installer or other application will act on that scope.
3. Scheduled tasks, Startup/Run/RunOnce/quiet launches and Windows sign-ins/restarts
   that could trigger them are accounted for and will not intervene. List relevant
   classes and the basis for exclusion; unknown scheduled activity is not absent.
4. No other Windows user/session or holder of database credentials can act on this
   scope; no unaccounted credential sharing or background access is known.
5. No offline edit, copy-back/restore, rollback, tool/config replacement, single-user
   database access or storage manipulation will occur; report any uncertainty/event.
6. No uncovered provider/workflow/retrieval/preview action will be requested. The
   operator will preserve evidence and stop on any exception or unknown interval.

This is a specific factual/exclusion undertaking with residual trust in the owner,
not permission to execute work or a statement that unknown access is safe. If any
item cannot be affirmed with a basis, defer acceptance. Existing answer “unknown”
for other producers remains unknown; no attestation is recorded or requested for
immediate execution in this preparation. Do not disable scheduled tasks, change
accounts/ACLs/HBA, acquire broader credentials or stop other processes to fill it.

## L1: correct terminal-task predicate

Replace only the proposed `workflow_tasks` count with `finished_at IS NULL`.
The exact schema29 bundle at lines 23205–23227 includes terminal `needs_human`
and binds succeeded/failed/needs_human/cancelled exactly to non-null finished time.
Thus a finished `needs_human` task does not itself block CW-01; an unfinished parent
workflow or other required count still does. This intentionally diverges from the
historical helper's fail-closed three-state exclusion. Do not edit that helper,
historical queries, results or receipts. Unknown schema/checksum still blocks.

## L2: owned smart stop and foreign-access handling

After the fresh pre-stop activity observation, if any foreign backend, desktop
adoption, unexpected producer or uncertain ownership is observed, mark
`invalid_producer_observed` or `ownership_unavailable`. Do not stop the cluster or
terminate the foreign connection. Record that the cluster may remain running and
require a separately scoped follow-up; no acceptance/relaunch/recovery follows.

Otherwise disconnect CW-01 and request exactly one hash-bound
`pg_ctl stop -D <approved cluster> -m smart -w -t 90`, hidden with redacted/bounded
output. This is a declarative command specification, not executed here. The mode
is explicit: do not inherit pg_ctl's fast default or the desktop's fast stop.
Smart shutdown refuses new connections once received and waits for existing
sessions instead of aborting their transactions. The pre-stop check is not atomic
with that request; a racing client can still connect/act. Such activity invalidates
clearance if discovered; smart mode reduces interruption, not admission risk.

Timeout/nonzero/uncertain ownership means unknown, even if shutdown later completes.
Do not escalate to fast/immediate, send another stop, kill, restart or clean up.
pg_ctl timeout does not cancel the server's shutdown request. An independent
stopped observation and W2 capture are required after reported success; exit0/PID
absence alone cannot replace the complete observation contract.

No optional desktop-key acquisition is selected: it is only a same-session guard
and would add object-lifetime/concurrency effects without solving producer exclusion.
Existing open-only v4.1–v4.4 observations remain unchanged.

## I1–I4 and evidence provenance

- **I1:** `studio.rs` SHA-256 `31b0dac592aa42bcdfc43cbc75f663ff63d3e965aef36a285242b381e1f09fa7`
  matches the package reviewer map. `postgres.rs` SHA-256
  `109615f43ac15fb8b7959844e09b6682c9f234e8b57b37456dd978386963b88b`
  matches the supported /4 helper review's artifact map, contrary to treating it
  as wholly unreviewed. That is a reviewed-source binding, not a reproducible-build
  proof linking this file to installed native machine code. It is absent from the
  package reviewer map; a direct source-to-exact-installed-native binding remains
  unestablished here. Therefore loopback/SCRAM operational admission cannot rely
  solely on it. Its init/start/stop text is supporting design context; current
  authentication/listener/startup conditions still require the reviewed scoped
  evidence described above. No configured tools or operational files were read.
- **I2:** Payment/finance open states and pending decisions are deliberately not
  rejected solely by those labels: no automatic startup consumer was found in
  the prior exact-bundle review. Decision wakeups remain covered by unfinished
  tasks/workflows and undelivered outbox. This does not authorize webhook/request
  activity; producer exclusion and the no-action scope still apply.
- **I3:** Activity observations have independent timing/cache semantics. They are
  not part of the table MVCC snapshot. Require fresh pre-stop observation and
  receipt times; two zero observations are not history of all connections.
- **I4:** Single-user mode was assessed and not selected: official docs describe
  implicit superuser powers, nonstandard query input and different locking/no
  background processing. It needs a different reviewed authority/I/O contract
  and does not solve W2/W3 same-account access. No single-user execution or
  unsupported lock-file exclusion claim is made.

## Official PostgreSQL verification — retrieved October 26, 2026

- [PostgreSQL 18 pg_ctl](https://www.postgresql.org/docs/18/app-pg-ctl.html):
  explicit stop modes, wait/timeout and possible completion after timeout.
- [PostgreSQL 18 shutdown](https://www.postgresql.org/docs/18/server-shutdown.html):
  smart refuses new connections and lets existing sessions finish; fast aborts
  their transactions. This supports L2's mode choice, not race-free exclusion.
- [PostgreSQL 18 WAL internals](https://www.postgresql.org/docs/18/wal-internals.html):
  records append within segment files, normally fixed-size. Names/sizes are not
  content equality or a no-write proof.
- [Official PostgreSQL REL_18_6 xlog.c](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/access/transam/xlog.c):
  `StartupXLOG` near 5798–5805 changes control state and writes it on transition
  to production; shutdown checkpoint near 6816 updates control/checkpoint state.
  This is versioned upstream source evidence, not an executed proof about the
  owner's candidate binaries or every attempted start. The source even describes
  a short interval before the on-disk production-state update. No universal
  no-start inference from matching hashes is supported.
- [PostgreSQL 18 statistics](https://www.postgresql.org/docs/18/monitoring-stats.html):
  dynamic activity differs from cached statistics/table snapshots; fresh reads
  still cannot establish absence between observations.
- [PostgreSQL 18 postgres/single-user mode](https://www.postgresql.org/docs/18/app-postgres.html):
  special privilege, input and locking semantics support I4's decision to defer
  that alternative.

Official documentation/source verification is static, not Windows tool execution,
installed-distribution authenticity, binary/source equivalence or operational
evidence. No external SDK/dependency behavior was changed or activated.

## Completion and exact next review

Proposed M1/L1/L2 repairs and I1–I4 dispositions are ready for independent exact-byte
review; no passing verdict is self-issued. Original design, receipt, review and
frozen evidence remain unchanged. M3 unchanged, A0/native acceptance blocked,
NI not-run, H unverified, full C54 partial; workspace-ID alternative stays disabled.

Next prompt: independently review this additive v1.1 note and its new receipt
against the frozen design/review, exact schema29 bundle, supported /4 source map
and cited official PostgreSQL 18 documentation/REL_18_6 source. Assess M1's reachable
but expressly threat-bounded pass condition, W1 observation freshness, W2's
non-proof fingerprint limitations, required owner attestation, stop races/mode,
corrected finished-task predicate and source/binary binding limits. Report whether
the note resolves the findings at design scope or needs a bounded repair; keep
implementation/operational/native readiness separate. Preserve all prior bytes.
No implementation, operational reads, SQL/credentials, cluster start/stop,
tests/verifiers, launch/sign-in, helper/migration/recovery or activation. Then stop.
