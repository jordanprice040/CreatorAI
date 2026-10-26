# CW-01 operational adapter design — October 26, 2026

Status: repository-only design. Jordan asked for it after the CW-01 fixture core v4
was supported. Claude wrote it in a Creator Agent project thread on Jordan's device
folder `C:\dev\creator_agent`. It is **not reviewed**: Jordan wants the review in a
separate new thread. Nothing here is implemented, and no operational read, registry
read, process inspection, pidfile read, credential use, SQL, cluster start or stop,
launch or sign-in happened while writing it. Operational/native readiness is
**NOT READY (blocked)**. M3 is unchanged and not reopened. Original A0 is blocked, NI
not-run, H unverified, full C54 partial, and the workspace-ID alternative disabled.

This document says how the operational adapters behind the v4 fixture core should
be built, which manifest bindings they need, and which separate grant each one
needs. Naming a grant here grants nothing.

## Inputs

| Input                                 | Path                                                                     | SHA-256         |
| ------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| Fixture core v4 (supported)           | `scripts/theme-intent-cw01-core-fixture-v4.mjs`                          | `ce3c4ad7…07bb` |
| Fixture core v4 tests                 | `tests/theme-intent-cw01-core-fixture-v4.test.mjs`                       | `666ce597…7149` |
| Observer SQL asset v2                 | `scripts/theme-intent-cw01-observer-sql-v2.sql`                          | `074561c3…89b2` |
| Frozen implementation design          | `docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md`             | `7aaa898c…7252` |
| v1.1 note                             | `docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_NOTE_2026-10-26.md`   | `0462b516…bb81` |
| v1.1 review (supported, R1–R3, I1–I5) | `docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_REVIEW_2026-10-26.md` | `d7628032…de58` |
| Fixture core v4 review (I-A–I-C)      | `docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REVIEW_2026-10-26.md`            | `2d4ab765…c3e8` |
| Existing DPAPI store (precedent)      | `apps/desktop/src-tauri/src/secret.rs`                                   | `743959d2…64e1` |

Decision carried in: Jordan confirmed the **120 s** attestation-to-spawn bound
(`tracking/DECISIONS.md`, October 26). `LIMITS.attestation_max_age_ms = 120000`
stays as it is.

## What the adapters must fit

The v4 core is pure. It takes injected evidence objects and runs this sequence:
`admit → preflight → start_intent → start_outcome → sql_A → sql_B → disconnect →
stop_intent → stop_outcome → w2_reference`. Every evidence object must pass
`measured()`, which today accepts only `provenance: 'fixture_measurement'` with
`fixture: true`. `admitRequest` blocks `mode: 'operational'`, and
`admitOperationalGate` refuses every receipt. That is correct for v4. So the
operational path needs two things this design specifies but does not build:

1. **Adapters** that produce the evidence shapes the core already checks
   (`checkAutoRun`, `checkJobContext`, `validatePidfile`, `checkProcessChain`,
   `backendParent`, `checkSqlA`/`checkSqlB`, preflight, stop and W2 shapes).
2. **A successor core (v5)** with an operational mode. It keeps every v4 check
   and adds the operational provenance and adapter bindings described in
   "Core v5 changes" below. v1–v4 stay byte-unchanged, and fixture receipts stay
   unable to satisfy an operational gate.

## Architecture

Three processes, each with one job:

- **Supervisor (Node 22, in the repository).** It runs the v5 core, sequences
  events, writes the evidence directory, and runs the SQL observer. It never
  calls a Windows API directly and never holds a process handle.
- **Native helper (new Rust binary, `cw01-native`).** One hash-bound executable
  with fixed subcommands: `autorun`, `job`, `preflight`, `launch`, `pidfile`,
  `chain`, `backend-parent`, `revalidate`, `stopped`, `w2`, `unprotect`. It is
  built in this repository with the `windows` crate version the desktop app
  already pins (`=0.62.2`), plus `Win32_System_Diagnostics_ToolHelp`,
  `Win32_Storage_FileSystem`, `Win32_NetworkManagement_IpHelper` and
  `Win32_System_ProcessStatus` features. It runs as one long-lived child of the
  supervisor for the whole run, so retained handles live in one place.
- **pg_ctl and its descendants**, launched only by the helper's `launch`
  subcommand.

Why a native helper and not PowerShell: Windows PowerShell 5 `Add-Type` compiles
C# at run time into a temporary assembly, and that cannot be bound to a reviewed
hash. A prebuilt helper can be hash-bound like `pg_ctl` (N3). Node has no
`GetProcessTimes`, Toolhelp or DPAPI without a native addon, and an addon would
put handles and secrets inside the supervisor.

### The evidence boundary (carries I-C and the getter limit)

The helper writes each result as one frame on its stdout pipe: a 4-byte length,
then UTF-8 JSON with no BOM, at most 64 KiB. The supervisor parses the frame with
`JSON.parse` and passes the parsed object to `step`. Parsed JSON has no getters,
no `toJSON`, no prototypes other than `Object`/`Array`, and no BigInt. This closes
the v4 review's getter limitation by construction: no caller-built object reaches
the core in operational mode. The SQL observer builds its evidence in the
supervisor, so it must also round-trip through `JSON.stringify`/`JSON.parse`
before `step`.

For I-C, v5 distinguishes the cases v4 folds together. A frame that is not valid
JSON, is too large, or has a duplicate key gives `EVIDENCE_NOT_JSON`. An empty
frame or a missing subcommand result gives `EVIDENCE_MISSING`. Both fail closed;
only the codes differ. Duplicate keys need a strict parser on the supervisor side,
because `JSON.parse` keeps the last one silently (same rule as N1).

Requests to the helper use the same framing. Paths travel as JSON strings, so
non-ASCII paths are carried exactly (N2). The helper refuses any request that is
not one of its fixed subcommands with the fixed field set.

## Adapters

Each adapter lists what it reads, how, what it emits, and the grant it needs.
"Emits" means the fields in the frame. Nothing else leaves the helper.

### A1. AutoRun existence reader (`autorun`), from v1.1 review R1

- **Reads:** whether the value `AutoRun` exists under
  `HKLM\Software\Microsoft\Command Processor` and
  `HKCU\Software\Microsoft\Command Processor`. Nothing else.
- **How:** `RegOpenKeyExW` with `KEY_QUERY_VALUE | KEY_WOW64_64KEY`, then
  `RegQueryValueExW(hkey, "AutoRun", NULL, &type, NULL, &size)`. Passing a NULL
  data buffer returns only type and size, so the value text is never read into
  memory. `ERROR_FILE_NOT_FOUND` on the key or the value means `absent`.
  `ERROR_SUCCESS` means `present`. Any other result means `unavailable`.
- **HKCU scope:** the helper must run as the manifest's operator in the intended
  Windows session. Before the read, it compares its token user SID and session ID
  with the manifest. It does not open `HKEY_USERS\<SID>`, so no other user's hive
  is read. A mismatch gives `unavailable`.
- **Emits:** `{hive, key, value: "AutoRun", view: "64", existence_only: true,
result, observed_at_ms}` per hive, exactly as `checkAutoRun` expects.
- **Bitness:** `KEY_WOW64_64KEY` is only correct if CMD.EXE is the 64-bit
  System32 image. A 32-bit `pg_ctl` would have `C:\Windows\System32\cmd.exe`
  redirected to SysWOW64 and would read the 32-bit view. So `admitRequest` in v5
  also requires the PE machine type of `pg_ctl`, `postgres` and `cmd` to be AMD64
  (or ARM64 with a separately reviewed view rule). Otherwise it blocks.
- **Never:** reads or logs the value text, deletes or edits the value, or opens
  `Wow6432Node`.
- **Grant:** `registry_autorun_existence_read` (two exact keys, one value name,
  existence only, one run).

### A2. Job context (`job`), from v1.1 review I1

- `IsProcessInJob(GetCurrentProcess(), NULL, &in_job)` for the helper, which is
  the process that will launch pg_ctl. `in_job = true` refuses start (no
  breakaway, no policy change). A failed call gives `in_job: null`, which the
  core reads as unknown.
- **Emits:** `{in_job, observed_at_ms}`.
- **Grant:** none beyond the run itself; it reads only the helper's own process.

### A3. Preflight and stopped-state observer (`preflight`, `stopped`)

- **Pidfile and signal files:** existence only for the exact
  `<cluster>\postmaster.pid`, `recovery.signal` and `standby.signal`, using
  `CreateFileW` with zero access rights, `FILE_FLAG_OPEN_REPARSE_POINT` and
  `FILE_FLAG_BACKUP_SEMANTICS`. Not-found means `absent`. Success means `present`.
  Anything else means `unavailable`. No contents are read.
- **Processes:** a Toolhelp snapshot, keeping only entries whose executable name
  is `postgres.exe` or `pg_ctl.exe`. For each, `QueryFullProcessImageNameW` and
  an exact comparison with the manifest image paths. Only the count of matches is
  kept. Other process names are dropped as they are read (I5).
- **Listeners:** `GetExtendedTcpTable` (IPv4 and IPv6, `TCP_TABLE_OWNER_PID_LISTENER`),
  counting listeners on the manifest port on any address. The count is kept; no
  other ports are kept.
- **Leases:** come from collector L1/L4 (below), not from this adapter. Until the
  collector is reviewed, `leases` is unbound and the preflight blocks.
- **Emits:** `{cluster_running, pidfile, processes, listeners, leases,
signal_files, observed_at_ms}` for preflight, and
  `{pidfile, processes, listeners, observed_at_ms}` for the stopped observation.
- **Grants:** `process_metadata` (image-name filter and counts) and a new
  `cluster_file_existence` grant for the three exact cluster files.

### A4. Launch adapter (`launch`), from frozen design F2 and v1.1 L1/L2

This is not a reader, but the process chain depends on it, so it is specified
here. It runs only under `cluster_start` or `cluster_stop`.

- `CreateProcessW` with `lpApplicationName` set to the exact manifest `pg_ctl`
  path and a command line built from fixed tokens only: `start -D "<cluster>" -l
"<log>" -o "-p <port> -c listen_addresses=127.0.0.1" -w -t 80` or `stop -D
"<cluster>" -m smart -w -t 80`. Paths must pass `admitPathSpelling`, so no
  quote or CMD metacharacter can appear. The port is a validated decimal integer.
- `bInheritHandles = TRUE` with a `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` holding only
  three NUL handles for stdin, stdout and stderr. No pipes to pg_ctl.
- `CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW` with an explicit environment
  block. It contains only `COMSPEC` (the manifest's System32 `cmd.exe`, checked
  against its hash) and `SystemRoot` (from `GetSystemWindowsDirectoryW`, not the
  inherited environment). Any further variable needs its own reviewed binding.
  No `PATH`, `PG*`, `PGSERVICE`, `PGOPTIONS` or plan keys.
- `lpCurrentDirectory` is the manifest's working directory.
- Right after creation, the helper duplicates the process handle with
  `PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE` only, closes the full-rights
  handle, and closes the thread handle. It never holds terminate rights.
- It waits on the retained handle with the 90 s outer deadline, then reads
  `GetExitCodeProcess` and `GetProcessTimes`. Creation and exit times are emitted
  as decimal FILETIME strings, which is the v4 `filetime()` format.
- **Emits:** `{pg_ctl_exit, pg_ctl_timeout_s: 80, timed_out,
outer_deadline_exceeded, launch: {pid, creation_ft, exit_ft}, observed_at_ms}`.
  On deadline it emits `timed_out: true` and keeps the handle. It never kills.

### A5. W1 pidfile reader (`pidfile`), from v1.1 M2 and I2

- **Opens** the exact `<cluster>\postmaster.pid` with `GENERIC_READ`, share mode
  read, write and delete (so PostgreSQL is never blocked), and
  `FILE_FLAG_OPEN_REPARSE_POINT`.
- **Checks on the handle:** `FileBasicInfo` has no reparse attribute and is not a
  directory; `FileStandardInfo.NumberOfLinks == 1`; size is at most 16 KiB.
- **Ancestry:** each parent directory up to the drive root is opened the same way
  and must have no reparse attribute. `GetFinalPathNameByHandleW` on the file must
  return exactly the approved spelling after removing only a leading `\\?\`.
  This is an exact string comparison under N4. Case or separator differences give
  `unavailable`, never a normalized match.
- **Stable read:** record `FileIdInfo`, size and last-write time; read up to
  16 KiB + 1 bytes; read the metadata again; read the bytes a second time. Any
  difference between the two reads or the two metadata samples gives
  `stable: false`.
- **Decoding:** strict UTF-8, no BOM, LF line endings. The file is split on LF
  into exactly eight lines plus a final empty string. A CR anywhere makes it
  malformed. That LF-only rule must be confirmed against REL_18_6 `miscinit.c`
  `CreateLockFile` and `AddToDataDirLockFile` in the adapter review.
- **Emits:** `{stable, single_link, reparse_free, size_bytes, lines,
observed_at_ms}`. The lines go only to the core, which keeps the PID and start
  seconds. Receipts keep only the digest.
- **Grant:** `w1_pidfile_read` (one exact file, this run, W1 only). W2 stays
  existence-only.

### A6. Process-chain reader (`chain`, `backend-parent`, `revalidate`), from M2, R2, R3

- **Upward walk from the pidfile PID**, never downward from pg_ctl (R2):
  1. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE)` on the pidfile
     PID. Read `GetProcessTimes` and `QueryFullProcessImageNameW`.
  2. Find its parent PID with one Toolhelp snapshot, keeping only the entry whose
     `th32ProcessID` matches. All other entries are dropped as read (I5).
  3. Open the parent the same way. That is the shell.
  4. The shell's parent PID must equal the launch PID. The pg_ctl record comes
     from the **retained launch handle**, never from reopening that PID.
- **Image identity:** each image path must equal the manifest path exactly. The
  image file is opened with read sharing, checked for reparse and single link,
  and hashed with SHA-256. The hash is compared in the helper, and the hash is
  what is emitted.
- **Containment:** the helper emits the raw FILETIMEs. The core applies the R2
  ordering checks (already in v4 `checkProcessChain`), so the rule lives in one
  place.
- **Retention:** the postmaster and shell handles are kept, non-inheritable, until
  the run ends. They are used by `revalidate` and closed with the receipt, never
  to terminate anything.
- **Backend parent (R3):** for the PID returned by `pg_backend_pid()`, the helper
  opens the backend, reads its creation time and its Toolhelp parent PID, and
  emits `{handle_bound, backend_pid, backend_creation_ft, parent_pid,
parent_creation_ft}`. The parent creation time comes from the retained
  postmaster handle.
- **Pre-stop revalidation:** re-reads the pidfile (A5), checks the retained
  handles are still alive (`WaitForSingleObject(h, 0) == WAIT_TIMEOUT`), and
  repeats the chain. It emits the `revalidation` shape `stop_intent` expects.
- **Never:** `PROCESS_TERMINATE`, `PROCESS_VM_READ`, `SeDebugPrivilege`, command
  lines, environment blocks, or names of unrelated processes.
- **Grant:** `process_metadata` (scoped to the chain and the observer backend).

### A7. Protected credential adapter (`unprotect`), from frozen design I2

- **Source of truth:** the desktop app's store in
  `apps/desktop/src-tauri/src/secret.rs`: one `<name>.dpapi` file per purpose,
  `CryptProtectData`/`CryptUnprotectData` with CurrentUser scope,
  `CRYPTPROTECT_UI_FORBIDDEN`, and entropy `ENTROPY_PREFIX + purpose`. Existing
  PowerShell scripts use the same layout with `secrets/postgres.dpapi` and entropy
  `creator-agent-studio/1:postgres`. The adapter review must confirm the exact
  prefix, purpose and blob path from that source. The scripts are precedent, not
  an entry point.
- **Binding:** the manifest names the blob path, purpose and operator SID. Before
  decrypting, the helper checks its token SID and session against the manifest,
  and opens the blob file with the same reparse, single-link and spelling checks
  as A5.
- **Delivery:** the supervisor starts the observer, then asks the helper for
  `unprotect`. The helper writes one length-prefixed frame holding only the
  secret bytes on its stdout pipe, then zeroes its buffer with `SecureZeroMemory`.
  The supervisor reads the frame into a `Buffer` and passes it straight into the
  `pg` client's `password` option. It never goes into argv, the environment, a
  file, a receipt, a log or the console. JavaScript strings cannot be reliably
  zeroed; the design does not claim they are.
- **Errors:** coded only (`CREDENTIAL_UNAVAILABLE`, `CREDENTIAL_SCOPE_MISMATCH`).
  No DPAPI error text.
- **Never:** reads the plan vault, creates a role, resets a password, or tries a
  different credential when this one fails.
- **Grant:** `protected_credential` (one blob, one decryption, this run).

### A8. SQL observer (supervisor side), from SQL asset v2

- Loads `scripts/theme-intent-cw01-observer-sql-v2.sql`, checks its SHA-256 equals
  `SQL_ASSET.sha256`, and splits it only on the `-- @` marker lines. Statements
  run in file order with their fixed parameter tuples.
- One `pg` 8.23.1 client: `host: '127.0.0.1'`, manifest port and database,
  `ssl: false` (loopback only), `connectionTimeoutMillis: 5000`, `keepAlive: false`,
  with no reconnect. The client is built from an explicit config object, and
  `PG*` environment variables are cleared from that config path so the driver
  cannot pick them up.
- Private comparisons stay in the supervisor: ledger 1–29 names and checksums
  against the candidate asset, relation fingerprints against
  `relation_fingerprint_sha256`, listener settings, and startup-boundary values.
  Only booleans and hashes reach the evidence.
- Count strings are passed through unchanged for the core's `COUNT` check. No
  coercion.
- **Emits:** the `sql_A` and `sql_B` shapes, with `sql_asset_version`,
  `sql_asset_sha256`, `connection_id`, `transaction_id`, `sample_id`,
  `connected_at_ms`, `observed_at_ms` and `deadline_exceeded`, plus
  `results.backend_parent` from A6.
- **Grant:** `sql_observer` (fixed asset hash, one connection, read-only).

### A9. W2 fingerprint (`w2`), from frozen design "W2 fingerprint"

- Unchanged from the frozen design and v1.1 I-e. It reads `global/pg_control`
  (stable handle snapshot, 64 KiB cap), a nonrecursive `pg_wal` inventory (4096
  entries / 1 MiB), `postmaster.pid` existence only, and both signal files'
  existence. It emits only hashes and existence codes.
- **Grant:** a new `w2_fingerprint_read` grant under the `PR01+W2/1` receipt kind.
  This is separate from `w1_pidfile_read`.

## Carried-in findings

| Item                  | How this design handles it                                                                                                                                                                                                                                                              | State                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| N1 BOM / native parse | Evidence frames and config bytes: strict UTF-8, no BOM, strict parser that rejects duplicate keys and non-native number forms. Config admission still needs the native-parity adapter from the config reader review; `JSON.parse` alone is not parity.                                  | Design only; native parity still blocking |
| N2 encoding           | All helper requests and results are UTF-8 JSON frames, so paths are carried literally. Future tests need non-ASCII positive and negative cases.                                                                                                                                         | Design only                               |
| N3 executable trust   | `cw01-native`, `pg_ctl`, `postgres` and `cmd` are each bound by exact path and SHA-256 in the manifest. No PATH or `SystemRoot` lookup for executables. The supervisor hashes the helper before starting it.                                                                            | Design only; concrete images unbound      |
| N4 path spelling      | `admitPathSpelling` from v4 is reused unchanged. Final-path checks compare exact strings after removing only `\\?\`. No normalization into a match.                                                                                                                                     | Design only                               |
| Collector L1          | Per-target results, the exact approved root/key16 literal and timestamps come from the collector itself. Counts are derived in the trusted collector, never supplied by a caller, and bound to the manifest/adapter/key preimage hash. This design adds `leases` as a collector output. | Collector implementation/review pending   |
| Collector L4          | Separate codes per gate: installed/M3 hashes, `PG_VERSION`, reparse/file/link checks, image identity, shared-image ambiguity, unexpected lease, Windows session/namespace. Aggregate pass only when every gate passes.                                                                  | Collector implementation/review pending   |
| R1 AutoRun            | A1, existence only, 64-bit view, plus the AMD64 image rule.                                                                                                                                                                                                                             | Design only                               |
| R2 containment        | A6 walks up from the pidfile and uses the retained launch handle. The core applies the ordering.                                                                                                                                                                                        | Design only                               |
| R3 SQL link           | A6 `backend-parent` with the `pg_backend_pid()` result.                                                                                                                                                                                                                                 | Design only                               |
| I-C non-JSON evidence | Framed JSON boundary and the new `EVIDENCE_NOT_JSON` code.                                                                                                                                                                                                                              | Design only                               |
| Getter limit          | Closed by construction: operational evidence is always parsed from bytes.                                                                                                                                                                                                               | Design only                               |
| I-A, I-B (test pins)  | Add both one-line pins to the v5 tests.                                                                                                                                                                                                                                                 | Optional                                  |

## Manifest bindings

The manifest is data with its own schema, version and hash. v5 `admitRequest`
requires every binding to carry `source`, `observed_at`, `method` and
`uncertainty`, and it rejects a value labeled `fixture`. Values are **pending**;
none is filled in here.

| Binding                       | How it can be obtained                                                                                      | Needed by      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| `cluster_dir`                 | Owner-produced exact path (collector template), checked under N4                                            | A3, A4, A5, A9 |
| `port`                        | Owner-produced configured port with source and method (template v1.1 L3)                                    | A3, A4, A8     |
| `database`, `observer_actor`  | Owner-produced; actor must be the existing superuser observer (frozen design I-c)                           | A8             |
| `pg_ctl`, `postgres` image    | Owner-produced path, SHA-256 and file version (template v1.1 L3), plus AMD64 check at admission             | A4, A6         |
| `cmd_image`                   | Exact `C:\Windows\System32\cmd.exe` path and SHA-256, owner-produced or from a separately granted hash read | A4, A6         |
| `native_helper`               | Path and SHA-256 of the reviewed `cw01-native` build                                                        | All            |
| `working_dir`                 | A system directory not writable by an unprivileged account; ACL evidence must be owner-produced or granted  | A4             |
| `log_path`                    | Owner-approved path for pg_ctl's `-l` log, with its own write-effect scope                                  | A4             |
| `operator_sid`, `session_id`  | Owner-produced reference for the intended account and session (no username in receipts)                     | A1, A7         |
| `credential_mechanism`        | Blob path, purpose and entropy prefix, confirmed from `secret.rs` in the adapter review                     | A7             |
| `startup_boundary_sha256`     | Reviewed startup-boundary asset (preloads, archive mode, WAL senders, HBA)                                  | A8             |
| `background_allowlist`        | Reviewed asset with type, min, max and `writes_storage` per type (v1.1 I-b)                                 | A8             |
| `relation_fingerprint_sha256` | Reviewed fingerprint asset for the 14 schema29 relations                                                    | A8             |
| `adapter_reviews`             | Hashes of the supported reviews of A1–A9, collector L1/L4 and reader N1–N4                                  | All            |
| `grants`                      | One concrete grant ID per scope below                                                                       | All            |

## Grants each adapter needs

Each grant names one target set, one operation, the permitted output and one run
(request ID). None exists today. Each needs Jordan's concrete decision.

| Grant                             | Target                                                                | Operation and output                                         | Adapter |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | ------- |
| `registry_autorun_existence_read` | HKLM and HKCU `Software\Microsoft\Command Processor`, value `AutoRun` | Existence only; `present`, `absent` or `unavailable`         | A1      |
| `cluster_file_existence`          | `postmaster.pid`, `recovery.signal`, `standby.signal` in the cluster  | Existence only                                               | A3      |
| `process_metadata`                | postgres/pg_ctl image matches, the launch chain, the observer backend | Counts, PIDs, FILETIMEs, image hashes; no other process data | A3, A6  |
| `w1_pidfile_read`                 | One exact `postmaster.pid`, W1 only                                   | Bounded read; core keeps PID and start seconds               | A5      |
| `protected_credential`            | One DPAPI blob                                                        | One decryption, delivered only to the observer connection    | A7      |
| `sql_observer`                    | SQL asset `074561c3…89b2`, one connection                             | Read-only statements; booleans, counts, hashes               | A8      |
| `cluster_start`                   | One `pg_ctl start` with the fixed argv                                | One attempt, 80 s / 90 s deadlines, no retry                 | A4      |
| `cluster_stop`                    | One `pg_ctl stop -m smart` with the fixed argv                        | One attempt, only after revalidation passes, no escalation   | A4      |
| `w2_fingerprint_read`             | `pg_control`, `pg_wal` inventory, existence checks                    | Hashes and existence codes only                              | A9      |

The grants for collector L1/L4 and the config reader are defined in their own
reviewed designs and are not repeated here.

## Core v5 changes (specified, not built)

- `measured()` accepts `provenance: 'operational_measurement'` with
  `fixture: false` only when the run's mode is `operational`. It keeps the v4
  fixture branch for fixture runs. A run cannot mix the two.
- `adapter_sha256` is checked against the manifest's per-adapter hash (A1–A9),
  not one shared fixture adapter hash.
- `admitRequest` in operational mode requires the bindings above with source
  fields, every grant ID, every adapter review hash, and the AMD64 image rule.
- New codes: `EVIDENCE_NOT_JSON`, `EVIDENCE_DUPLICATE_KEY`,
  `IMAGE_MACHINE_UNSUPPORTED`, `GRANT_MISSING:<scope>`.
- New receipt format `theme-intent-cw01-operational-receipt/1` with
  `fixture: false` and `mode: 'operational'`. `admitOperationalGate` still refuses
  v1–v4 fixture formats. Even an operational receipt only supports
  `W1_W2_supported_W3_pending`; it authorizes no launch or dispatch.
- Every v4 check, limit and terminal state stays as it is, including the 120 s
  attestation bound.

## Verification a later implementation must run

Not executed here. Use disposable fixtures and a disposable cluster, never the
saved studio:

- Helper framing: oversized, BOM, duplicate key, invalid UTF-8, empty and
  truncated frames; non-ASCII paths both ways.
- AutoRun: absent, present, unreadable key, wrong session or SID, 32-bit image
  refusal. Confirm the value text is never read (no data buffer).
- Launch: path-space handling, metacharacter refusal, explicit environment
  contents, NUL handles, no terminate rights, outer-deadline behavior without
  killing.
- Pidfile: reparse ancestry, hard link, CR in file, BOM, nine lines, unstable
  read, standby and negative PID.
- Chain: PID reuse after pg_ctl exit, the `postgres -V` probe shell, an exited
  shell, wrong image hash, upward-walk only.
- Credential: wrong SID, wrong entropy, reparse blob, and a check that the secret
  never appears in argv, environment, files or receipts.
- SQL: every core refusal path with real driver results, plus `PG*` variables set
  in the environment to prove they are ignored.
- Mixed-mode refusal: fixture evidence in an operational run, and the reverse.

## Open items for Jordan

These are the facts or decisions this design cannot fill in:

1. Whether a new Rust helper in this repository is acceptable as the native
   layer. The alternative is a native Node addon, which this design does not
   recommend.
2. The owner-produced bindings: cluster directory, port, image paths and hashes,
   log path, operator and session reference.
3. Each concrete grant in the table, when implementation is chosen.
4. The startup-boundary, background and relation-fingerprint assets, which need
   their own reviewed contents.

## Status of authority

Repository-only design. It grants no implementation, registry, pidfile, process,
credential, SQL, start, stop, launch, sign-in or native-session authority, and it
does not record or request Jordan's attestation. M3 is not reopened.

Next eligible: an independent repository-only review of this design in a separate
thread, against the v4 core, SQL asset v2, the frozen design, the v1.1 note and
review, the v4 core review and `secret.rs`. The review should report design
support separately from implementation and operational readiness. No code, tests,
operational reads, SQL, credentials, launch or next milestone.
