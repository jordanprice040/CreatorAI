# CW-01 implementation design — October 26, 2026

Status: repository-only design, authorized by Jordan's explicit “Prepare
implementation design” reply. Codex authored this and the governing design/note;
independent exact-byte review pending. No executable code, live manifest, grant,
owner attestation or operational result is created. Implementation not started;
operational/native readiness NOT READY. M3 unchanged, original A0 blocked,
NI not-run, H unverified, full C54 partial; workspace-ID alternative disabled.

Governed by the frozen [current-work design](THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md),
[v1.1 note](THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_NOTE_2026-10-26.md) and
[supported v1.1 review](THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_REVIEW_2026-10-26.md).
This document specifies one future conditional inspector. It neither reopens the
accepted threat-bounded evidence standard nor treats attestation as technical
prevention. Missing facts remain blockers rather than automatically widening scope.

## Candidate, components and inputs

Exact candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`,
installation plan `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`;
reviewed service bundle `9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88`.
Historical package/helper/installation receipts remain evidence at their original
scope. Actual installed files must later be revalidated. No rebuild or migration
is requested to make this inspector possible.

Future implementation has three separable interfaces: (1) a pure request/receipt
validator and state machine; (2) bounded Windows file/process/object/command and
protected-access adapters; (3) one fixed SQL observer. No API initialization,
workflow store, service bundle import, model/provider adapter or helper entry point.
Fixture execution must visibly say fixture and can never yield an operational
receipt. No automatic live fallback or retry mode.

The future approved manifest is data, with schema/version/hash, exact inspector/
SQL/adapter hashes, request ID, operator, intended Windows session, current
candidate/installation map, exact active home/LOCALAPPDATA literal/key, managed
cluster, PG major, database/observer identity, port, pg_bin/pg_ctl/postgres identities,
approved log/evidence destinations, config/auth/startup-boundary identity, protected
credential locator/type and concrete grants. Exact values are **pending**, not
filled from defaults, PATH, the shortcut's location or candidate tools. Never put
passwords, login codes, command text or unneeded account data in the manifest.

All targets use exact approved absolute identities and ancestry/file-handle checks;
unavailable, changed, aliased or ambiguous objects fail closed. No recursive home
scan. Freeze config/startup inputs before dispatch: unknown preloads, recovery,
replication, HBA or extension startup behavior blocks before cluster start. A
post-start setting check cannot repair that missing prerequisite.

## State machine, ownership and commands (F2)

`prepared → admitted → preflight_stopped → start_intent → owned_running → sql_A →
sql_B → disconnected → stop_intent → stopped_verified → W2_reference_recorded`.
Later: `W2_reference_recorded → fresh_PR01_with_W2_match → eligible_for_separate_session_decision`.
Every transition records input/intent/outcome IDs and exact hashes. A late/unknown
outcome never becomes a pass. Eligibility is not a native launch authorization.

Before `start_intent`: supported adapter/collector reviews, concrete operational
grant, current attestation, manifest/config binding and complete PR-01 are required.
Any already-running cluster, positive/unknown process/listener/lease/object or
changed identity means not-owned/block; no adoption, connect-first or repair.
Ownership requires stopped preflight, unique request/start intent, exact launched
process/cluster identity and successful startup observation. Exit0 alone is not
ownership. A start timeout or nonzero/ambiguous result is unknown: no retry or
automatic stop without proven ownership and a separately admissible stop path.

Future start argv, passed directly to the exact hash-bound pg_ctl executable:

```text
start -D <cluster> -l <approved_log> -o "-p <port> -c listen_addresses=127.0.0.1" -w -t 90
```

Future stop argv, only with proven ownership and fresh no-foreign-access evidence:

```text
stop -D <cluster> -m smart -w -t 90
```

These are declarative specifications, not commands executed here. `<port>` is a
validated integer 1–65535 rendered as decimal; no arbitrary `-o` text. Bind the
postgres image selected by pg_ctl to the approved pg_bin sibling and observe
actual image/cluster identity. Use explicit executable path, no shell, hidden
window, null stdin and bounded/redacted output. The adapter must handle Windows
argv encoding with path spaces; refuse unsupported spellings rather than build
a shell string. Child environment is an allowlist: no inherited libpq service,
PGOPTIONS/PGDATA, preload or credential overrides, PATH tool lookup or plan keys.
Preserve only reviewed OS/runtime necessities with their own trusted bindings.

Start has one 90-second operation deadline. SQL has one 30-second total deadline,
2-second statement/lock limits and one connection with a bounded 5-second connect
phase included in the SQL deadline. Stop has one 90-second deadline. Supervisor
deadlines include process completion; do not kill the server when pg_ctl times out.
No fast/immediate mode, second stop/start, timeout extension, init/adopt/migrate,
lease cleanup, rollback of product data or recovery. Timeout may leave a running
or shutting-down cluster: preserve unknown state and request scoped follow-up.

Before stop, a foreign backend, walsender, desktop adoption, unexpected producer
or unknown ownership forbids the stop. Disconnect only our observer, record
invalid/unknown and possible running-cluster residue. Do not terminate anyone
else's connection. After SQL errors, the same fresh safety check is necessary
before any owned smart stop; if it cannot be obtained within bounds, leave state
unknown for follow-up. A positive work count invalidates clearance; it does not
authorize sweeping/cancelling that work. Smart stop may still be used for our
owned cluster only if the independent pre-stop access/ownership check passes.

## Protected access and observer identity (I2)

Only an existing manifest-bound database actor/credential may be used. No new
role, grants, password reset, trust authentication or wider-credential fallback.
Select the existing database-owner credential path only if its prior authority and
CurrentUser DPAPI binding are explicitly covered by the new operational grant.
The reviewed upgrade wrapper is design precedent, not an entry point to reuse:
it admits broader operations. A new single-purpose protected-access adapter must
be reviewed with exact blob path, entropy/protection format, operator binding and
redacted errors. This mechanism is **blocking/unimplemented**.

Credential travels only through a private bounded pipe/in-memory connection
configuration, never argv, environment, file, receipt, log or console. No plan-vault
read. Disable automatic reconnect/retry. Minimize secret lifetime; do not claim
JavaScript string clearing guarantees zeroization. Preserve only coded outcomes.

This design requires the existing observer to be the manifest-bound superuser
database actor so it cannot silently undercount RLS-protected tables or activity.
That is a high-privilege read capability needing explicit exact-scope review/grant,
not authority to create/escalate an actor. An insufficient actor blocks; no
replacement credential is sought. SQL identity/privilege must be checked before
counts, not inferred from initdb history. Only fixed SELECT/transaction/session
statements below may execute; privilege does not widen the allowlist.

## Fixed schema29 SQL contract (I1)

This section is the proposed complete SQL allowlist, not executed SQL. Review and
hash exact extracted strings as a versioned asset before implementation. Values
use driver parameters; no user identifiers, SQL fragments, dynamic query builder,
functions from application schemas or search-path-dependent table resolution.
Use `pg_catalog` built-ins and `public` studio tables; another layout blocks.
Require each target to be the expected ordinary schema29 relation with the
reviewed column/check/RLS boundary; no substitute views or custom expression hooks.
Exact relation-definition fingerprint validation is a blocking adapter detail,
not established by merely seeing migration ledger rows.

Session setup, once on the sole connection:

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET statement_timeout = '2s';
SET lock_timeout = '2s';
SET idle_in_transaction_session_timeout = '2s';
SET search_path = pg_catalog;
```

Transaction A:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_user::text = $1::text AND r.rolsuper AS observer_ok
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
SELECT pg_catalog.current_database()::text = $1::text AS database_ok,
       pg_catalog.inet_server_addr()::text = '127.0.0.1' AS address_ok,
       pg_catalog.inet_server_port() = $2::integer AS port_ok,
       pg_catalog.current_setting('transaction_read_only') = 'on' AS readonly_ok,
       pg_catalog.current_setting('transaction_isolation') = 'repeatable read' AS isolation_ok;
SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
ORDER BY c.relname;
SELECT c.relname, a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.attisdropped
FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
 AND a.attnum > 0 ORDER BY c.relname, a.attnum;
SELECT c.relname, k.conname, k.contype, pg_catalog.pg_get_constraintdef(k.oid, true) AS definition
FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
ORDER BY c.relname, k.conname;
SELECT version, name, checksum FROM public.schema_migrations ORDER BY version;
SELECT pg_catalog.current_setting('listen_addresses') AS listen_addresses,
       pg_catalog.current_setting('port') AS port,
       pg_catalog.current_setting('unix_socket_directories') AS sockets,
       pg_catalog.current_setting('data_directory') AS data_directory;
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid();
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity WHERE backend_type = 'walsender';
SELECT backend_type, count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type NOT IN ('client backend','walsender') GROUP BY backend_type ORDER BY backend_type;
SELECT count(*)::text AS n FROM public.workflows
 WHERE finished_at IS NULL OR state NOT IN ('succeeded','failed','cancelled');
SELECT count(*)::text AS n FROM public.workflow_tasks WHERE finished_at IS NULL;
SELECT count(*)::text AS n FROM public.outbox WHERE delivered_at IS NULL;
SELECT count(*)::text AS n FROM public.plan_requests WHERE state NOT IN ('completed','failed','rejected','reconciled');
SELECT count(*)::text AS n FROM public.plan_qualifications WHERE state = 'running';
SELECT count(*)::text AS n FROM public.budget_reservations WHERE status IN ('in_flight','unknown');
SELECT count(*)::text AS n FROM public.source_retrievals WHERE state = 'in_flight';
SELECT count(*)::text AS n FROM public.context_batches WHERE status IN ('submitting','submitted','unknown');
SELECT count(*)::text AS n FROM public.github_operations WHERE state IN ('dispatched','unknown');
SELECT count(*)::text AS n FROM public.marketing_deliveries WHERE state IN ('dispatching','unknown');
SELECT count(*)::text AS n FROM public.portfolio_jobs WHERE state IN ('dispatching','unknown');
SELECT count(*)::text AS n FROM public.desktop_jobs WHERE state NOT IN ('completed','cancelled','expired');
SELECT count(*)::text AS n FROM public.artifact_previews WHERE state IN ('starting','ready');
ROLLBACK;
```

The two parameterized statements have their own fixed parameter tuples: expected
actor; expected database/port. Compare full schema ledger 1–29 names/checksums to
the exact candidate asset privately; any missing/newer/mismatched entry blocks.
Only booleans/hash of comparison are emitted. No migration function is invoked.
Compare effective settings privately to the manifest: only literal 127.0.0.1,
manifest port, empty sockets and exact approved data-directory identity admitted.
Do not log unexpected setting strings. Inspect effective listeners via the reviewed
OS collector too; a successful setting does not prove interface/process identity.

All work/client/walsender counts must be zero. Background type/count results
must match an explicitly reviewed manifest allowlist for this configuration; it
is presently **unbound/blocking**, not a default assumed from a normal cluster.
Validate decimal count strings exactly as nonnegative integers with bounded length;
never coerce malformed, null, truncated or missing results to zero. Query/schema
errors are unavailable and never print SQL diagnostics or row data. Counts span
all workspaces; there is no selected-workspace escape hatch.

Transaction B is a new transaction on the same connection, immediately pre-stop:

```sql
BEGIN READ ONLY;
SELECT current_user::text = $1::text AND r.rolsuper AS observer_ok
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid();
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity WHERE backend_type = 'walsender';
SELECT backend_type, count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type NOT IN ('client backend','walsender') GROUP BY backend_type ORDER BY backend_type;
ROLLBACK;
```

Only after B succeeds and the independent no-adoption/ownership checks pass may
the connection close and smart stop be admitted. A/B activity observations have
their own query times, not MVCC history. A transient writer between samples can
escape them; current attestation remains mandatory. No `COMMIT`, writes, sweep,
stored procedure, advisory lock, extension creation or arbitrary SQL is allowed.
Cancelling our own timed-out read is permitted; terminating another backend is not.
Permission for transaction/session SET does not permit ALTER SYSTEM/config writes.

## W2 fingerprint and PR-01 extension

One reference after owned stop and complete stopped verification; one comparison
inside a fresh separately scoped prelaunch PR-01 window. New receipt kind
`PR01+W2/1` explicitly extends read scope; original PR-01/classifier receipts and
contracts stay frozen. It still executes no SQL/start/stop/credential access.
No implicit launch after a passing comparison.

Allow only cluster-relative `global/pg_control`, `pg_wal` and `postmaster.pid` plus
the already approved identities/config hashes. Stable open-handle snapshot of
pg_control with SHA-256, size/file identity and before/after metadata; cap 64 KiB.
Require ordinary file, single link, no reparse target/ancestry. For pg_wal, bounded
nonrecursive sorted exact names/types/sizes: cap 4096 entries/1 MiB encoded inventory.
Reject unexpected entry types/reparse/aliases, failures and cap excess; never
truncate to pass or follow subdirectories/symlinks. Known subdirectory names/types
are listed, contents not traversed. `postmaster.pid` existence only, never contents.
Names remain exact Unicode data for comparison; no shell expansion/case folding.

Collect stable reference and comparison with two complete query batches ≥1 second
apart; no overlapping batches, ≤15 seconds through final handle closure as in
v4.3/v4.4. Each batch includes the added fingerprint. Instability or insufficient
time returns unavailable; no extended deadline or partial success. Fingerprint
adapter has a 2-second per-batch I/O cap within that window. Preserve per-batch
values; compare against one immutable reference, never update after a change.

No-attempt attestation covers all samples, intervals, closure and launch handoff.
Matching control/WAL metadata is supporting change detection, not no-start/no-write
proof. No TTL, filesystem locks surviving stop, adversarial storage protection or
full WAL/data equality claim. Offline restore and failed starts remain stated
residuals under the accepted owner-trust boundary. Any unknown interval invalidates.

## Attestation and receipts (I3)

Future attestation asset: schema/version, operator identity reference, manifest
and inspector hashes, request/W1/W2/W3 identifiers, all six v1.1 item answers with
source/basis/date/uncertainty, affirmative timestamp immediately before W1 and
applicable scope. Every answer must be explicitly affirmative with a basis; no
checkbox default, copied old template or inferred agreement. Blank/unknown defers.
The actual attestation remains blank; no request to run a session is made here.

Append immutable exception/no-exception confirmations after W1, W2 handoff and
post-W3 final shutdown; each links the previous hash. Post-W3 confirmation cannot
be prefilled. A prelaunch result can only say `W1_W2_supported_W3_pending`, never
whole-session producer exclusion. No attestation grants launch/dispatch authority.

Exclusive new evidence directory: manifest/attestation references, request/intent
and outcome sequence, exact executable/SQL/adapter/candidate hashes, grant IDs,
monotonic durations and UTC/wall timestamps with timezone, availability, per-target
codes, count/boolean evidence, SQL A/B boundaries/read-only/rollback results,
ownership/stop result, W2 reference/comparison hashes and exceptions. Bound stdout
to coded output, not operational text; preserve failure evidence without secrets.
Crash between start intent and ownership outcome is unknown, never resumable by
replaying start. New inspection needs a separate decision/directory and preserves
the earlier incident. No automatic repair, rollback or cleanup command.

## Reader/collector disposition and blocking ledger

| Issue                        | Required implementation contract / present state                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 BOM/native parse identity | Reject UTF-8 BOM/invalid UTF-8 and non-native schema/duplicate-key/number forms; require independently bound native-accepted config bytes. Strict native-parity adapter design and actual config hash remain **blocking**, not solved by JSON.parse                                                           |
| N2 encoding                  | Fixed system-adapter request uses explicitly pinned UTF-8/base64 framing; preserve literal paths, add non-ASCII negative/positive fixture coverage. Implemented/reviewed evidence **pending**                                                                                                                 |
| N3 executable trust          | Exact system helper image/hash or independently located native system-directory identity, never inherited SystemRoot/PATH. Concrete chosen image and review **blocking**                                                                                                                                      |
| N4 tool path spelling        | One approved drive-rooted spelling; reject reserved devices, aliases/8.3 ambiguity, substitutions, ADS, dot/empty segments and unsupported separators. No normalizing a bad binding into a pass. Configured tool identity **blocking**                                                                        |
| Collector L1                 | Carry every per-target open/Run result, approved exact literal root/key16 and result timestamp into sample; derive counts in the trusted collector, no caller-supplied counts/key_bound. Bind them to canonical manifest/adapter/key preimage hash. Implementation/review **pending**                         |
| Collector L4                 | Separate installed/M3 hashes, PG_VERSION, reparse/file/link checks, tool/image identity, shared-image ambiguity, unexpected lease and Windows session/namespace codes; aggregate pass only when every required gate passes. Never one unexplained identity_matches boolean. Implementation/review **pending** |
| Other bindings               | Actual port/home/pg_bin, startup/config/HBA boundary and background types, protected access actor/mechanism, relation fingerprints, exact operational grants and owner attestation all **blocking**                                                                                                           |

This is a concrete contract for future review, not a declaration that missing
adapters are operationally ready. Implementation can use fixture inputs only under
a separately selected milestone; no fixture evidence may fill an operational field.
No wider access is authorized by naming an unresolved binding.

## Necessary future verification, not executed here

Review the design first. A later authorized implementation should verify: exact
argv/port/path-space handling; injection rejection; wrong/BOM/duplicate/native
config and reparse/alias failures; per-target unavailable folding and wrong key/
namespace; insufficient observer/RLS/view substitution; every active/unknown count
and terminal needs_human; fresh A/B cache boundary; race/adoption/foreign access
with no stop; start timeout/crash ownership; smart-stop timeout with no escalation;
fingerprint mutation/caps/unstable capture and forbidden reference replacement;
missing/stale/unknown attestation; redaction and fixture/operational separation.
Use disposable isolated fixtures, not saved studios. Real operational qualification
and acceptance require separate exact grants after independent implementation review.

## Sources, corrections and next step

Use Claude's corrected REL_18_6 xlog.c locators **6195–6214** (production transition)
and **7290–7309** (shutdown checkpoint), as recorded in the frozen v1.1 review.
The earlier note's web-rendered line numbers are not raw-source locators. Preserve
that note; cite the correction, named symbols and source identity together.
Upstream PostgreSQL source is not proof of installed binary behavior/identity.

Official docs read October 26, 2026: [pg_ctl](https://www.postgresql.org/docs/18/app-pg-ctl.html)
for explicit start/stop modes and timeout semantics;
[connection settings](https://www.postgresql.org/docs/18/runtime-config-connection.html)
and [configuration precedence](https://www.postgresql.org/docs/18/config-setting.html)
for listener/command-line settings;
[transactions](https://www.postgresql.org/docs/18/sql-set-transaction.html) and
[client settings](https://www.postgresql.org/docs/18/runtime-config-client.html)
for read-only/isolation/timeouts/search-path limits. Read-only transactions still
permit physical storage effects; scoped startup/authentication review remains required.

Executed here only repository source/review reads, direct preservation hashing,
official documentation reads and new-document format/link/whitespace checks.
No implementation or tests/verifiers, operational config/OS/database/credential
reads, SQL execution, cluster/app start/stop, sign-in, helper/install/migration,
activation or recovery. Prior files and tracking suffixes preserved. One attempted
read used a nonexistent reversed helper filename; corrected to the actual wrapper
source, never treated as evidence or executed.

Next eligible: independent exact repository-only review of this implementation
design and receipt against governing design/v1.1/review, exact schema29 bundle,
reader/collector findings and official documentation. Check SQL completeness and
privilege/identity boundaries, start/stop ownership/races, fresh samples, W2/PR-01
extension, receipts/attestation and explicitly unresolved blockers. Report design
support separately from implementation and operational readiness; no code, tests,
operational reads, SQL/credentials, launch or next milestone. Then stop for review.
