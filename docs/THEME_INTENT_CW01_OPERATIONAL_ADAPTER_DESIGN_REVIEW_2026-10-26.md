# CW-01 operational adapter design independent review — October 26, 2026

Prompt: U02 (independent review), repository-only. Reviewed document:
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_2026-10-26.md`
(`97258c08…031e`, 32,495 bytes), at commit `25e39e4` on branch
`claude/project-thread-7gwqdm` (PR #46).

## Verdicts

- **Design support: SUPPORTED WITH CONDITIONS.** The direction is sound. That
  means one hash-bound Rust helper, framed JSON evidence, existence-only reads,
  no terminate rights, a successor core v5 and one grant per scope. Every adapter
  fails closed on the paths I checked, and nothing in the design widens
  authority. There is no High finding. Two Medium findings mean the design, as
  written, would block every real start (F1) or every real W1 pidfile (F2).
  Five Low findings (F3–F7) need a v1.1 note before anyone implements it.
- **I-C and the getter limit: closed in principle, not yet in the core.** The
  framed boundary removes getters and non-JSON values for helper output. But v5
  `step` still accepts caller-built objects, and the provenance fields are
  self-reported. So the closure is a supervisor discipline, not a core property
  (F7). It becomes a core property if v5 takes frame bytes.
- **Implementation readiness: NOT STARTED.** There is no helper, no v5 and no
  tests. This review authorizes none of them.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
  full C54 partial, and the workspace-ID alternative disabled. Still missing:
  reader N1–N4 native parity, collector L1/L4, real manifest bindings, all nine
  grants, Jordan's attestation, and W2 comparison.
- **120 s bound:** Jordan confirmed it. The design keeps
  `attestation_max_age_ms = 120000`. Nothing here conflicts with it.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed or input files. Another Claude session wrote the design. Earlier Claude
sessions wrote the v4 core review and the v1.1 review. This is the **same model
family and not blinded**. No external review service.

Executed: SHA-256 of the design and its 8 bound inputs (8/8 match the design's
input table); reading the v4 core, its tests' pidfile fixture, `secret.rs`,
`studio.rs` credential call sites, the desktop `Cargo.toml` pin and the
installed `pg` 8.23.1 sources; downloading PostgreSQL `REL_18_6` and libuv
`v1.x` source files into my cloud scratch directory (hashes in the receipt);
and reading Microsoft Learn pages. Not done: Windows API calls, registry,
process, pidfile, port or credential reads, SQL, cluster or app actions, launch,
sign-in, builds, tests, `pnpm` or Prettier, and the retired OneDrive checkout.
Behaviour claims about Windows below come from source and documentation. None
was observed on a Windows machine.

## Findings

### F1 — Medium: A2 checks the helper's job, and Node puts the helper in a job

Locator: Architecture ("runs as one long-lived child of the supervisor"); A2.

libuv (`src/win/process.c`, `uv__init_global_job_handle` and `uv_spawn`)
assigns every child that is not spawned `UV_PROCESS_DETACHED` to a global job
with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and `SILENT_BREAKAWAY_OK`. Node's
`child_process.spawn` without `detached: true` is that case. So
`IsProcessInJob(GetCurrentProcess())` in the helper returns true on every run,
and A2 yields `NESTED_JOB_REFUSED` every time. That fails closed, but start can
never happen.

The check also measures the wrong thing. Because of `SILENT_BREAKAWAY_OK`,
pg_ctl would not inherit libuv's job anyway. What matters (v1.1 I1) is whether
pg_ctl, CMD and postgres end up inside a job whose policy is unknown. pg_ctl
itself creates `PostgreSQL_<pid>` only when the shell is outside any job
(`pg_ctl.c` `CreateRestrictedProcess`, `IsProcessInJob` then
`CreateJobObject`, no kill-on-close).

Repair: spawn the helper with `detached: true` (and `windowsHide`) so it is not
in libuv's job. Keep the helper's self-check, which then reports any job that
Node itself sits in, such as a terminal or IDE job. State in the design that a
helper running inside libuv's job is a defect, and add a test for it. Do not
add terminate rights to handle a suspended pg_ctl found in a job.

### F2 — Medium: real pidfile line 2 uses forward slashes, so W1 always fails

Locator: A5 "The lines go only to the core"; Core v5 "Every v4 check … stays".

pg_ctl runs `canonicalize_path(pgdata_D)` and passes `-D "<that>"`
(`pg_ctl.c` option `D`). The postmaster's `SetDataDir` calls
`make_absolute_path`, which canonicalizes again. On WIN32, `canonicalize_path_enc`
first calls `debackslash_path`, which turns every `\` into `/` (`path.c`).
`CreateLockFile` writes that `DataDir` as line 2 (`miscinit.c` "%d\n%s\n…").
So line 2 reads like `C:/dev/…/data`.

v4 `validatePidfile` requires `sameSpelling(l[1], cluster_dir)`, and
`admitPathSpelling` refuses any `/`. The v4 fixture uses a backslash spelling
(`tests/…-v4.test.mjs` `CLUSTER`), so tests pass, but every real pidfile would
return `PIDFILE_DIRECTORY_MISMATCH`. The v1.1 review's I2 noted that the
separators may differ. The design keeps the check unchanged, so the gap stays.

Repair: add a manifest binding `pidfile_data_dir_literal`. It is derived by one
reviewed rule (PostgreSQL 18.6 replaces `\` with `/` and changes nothing else
for an admitted path), and v5 compares line 2 to it exactly. This is a reviewed
literal under I-d, not normalization into a match. Add a v5 test with a
forward-slash line 2. Limit the rule to ASCII paths (F4).

### F3 — Low: launch trusts executables by path before checking their hashes

Locator: A4 command line; N3 row; Architecture ("supervisor hashes the helper
before starting it").

1. **argv[0] is unspecified.** The command-line text starts at `start -D …`.
   pg_ctl calls `find_my_exec(argv[0])`. If argv[0] has no separator, on WIN32
   it checks the current directory first, then `PATH` (`exec.c`
   `find_my_exec`). It then finds `postgres` beside the resolved pg_ctl. If
   argv[0] is missing or bare, postgres can come from the working directory,
   or the start fails.
2. **Hashes come after execution.** pg_ctl runs `postgres -V` through
   `_popen` before starting the server (v1.1 R1 sources). A6 compares the
   postgres and CMD hashes only after the chain exists. A swapped binary would
   already have run.
3. **Hash-then-spawn races.** The supervisor hashes `cw01-native`, then Node
   spawns it by path. On Windows, Node's `fs.open` always shares write and
   delete access, so it cannot lock the file in between.

Repair: argv[0] is the quoted exact manifest pg_ctl path. Before
`CreateProcessW`, the helper opens pg_ctl, postgres and System32 cmd with
`FILE_SHARE_READ` only, hashes them, and keeps those handles until A6
finishes. That blocks writes, renames and deletes during the launch window.
Bind the helper's directory to one that an unprivileged account cannot write,
with ACL evidence as for `working_dir`, or record the helper race as an
accepted residual.

### F4 — Low: non-ASCII paths pass through ANSI conversion in pg_ctl and postgres

Locator: N2 row ("paths are carried literally"); A4 ("no quote or CMD
metacharacter can appear").

`pg_ctl` and `postgres` use `main(argc, char **argv)`, so the CRT builds argv
in the active ANSI code page. Characters the code page cannot hold go through
Windows best-fit mapping, and some of those map to ASCII quote or slash
characters. DEVCORE's "WorstFit" research and the XZ Utils argument-injection
advisory describe this. `admitPathSpelling` refuses only ASCII
metacharacters, so a path that passes it can still turn into a quote in
pg_ctl's argv and in the CMD string it builds. Line 2 of the pidfile is also
written in ANSI bytes, so A5's strict UTF-8 decode would refuse a non-ASCII
directory. That part fails closed.

Repair: require printable ASCII for every path that reaches pg_ctl, CMD or
postgres (`cluster_dir`, `log_path`, `working_dir` and the image paths). Turn
the N2 non-ASCII tests for those paths into refusal tests. Helper frames can
still carry non-ASCII paths for reads that never reach PostgreSQL.

### F5 — Low: A7 credential delivery does not match pg 8.23.1, and pgpass is a fallback

Locator: A7 Delivery and Never.

- `pg` requires the password to be a string. The SCRAM path throws "client
  password must be a string" (`lib/crypto/sasl.js:67`). A password function
  must return a string (`lib/client.js:282`). A `Buffer` cannot be used.
- When the password is null, `pg` reads `pgpass` (`client.js:295–303`). That is
  a different credential source, which A7's Never rule and AGENTS.md invariant
  4 forbid.

Repair: turn the secret frame into a short-lived string, given only through a
one-shot `password` function. Say plainly that the string cannot be zeroed.
Never build the client unless `unprotect` succeeded. Clear `PGPASSFILE`, and
add a test proving no pgpass read when a password is present or the credential
is missing.

### F6 — Low: clearing `PG*` "from that config path" does not stop env fallback

Locator: A8.

In `pg` 8.23.1 `connection-parameters.js`, `val(key, config)` reads
`process.env['PG' + KEY]` whenever `config[key]` is falsy. So an empty
`options: ''` still picks up `PGOPTIONS`, which can set session GUCs. The same
applies to `PGAPPNAME`, `PGCLIENTENCODING` and `PGSSLNEGOTIATION`. `PGSSLMODE`
applies when `ssl` is undefined.

Repair: start the supervisor with an explicit environment that has no `PG*`
keys, or delete them from `process.env` before importing `pg`. Then confirm the
client's resolved parameters before connecting. The design's test that sets
`PG*` variables stays mandatory.

### F7 — Low: the evidence boundary lives in the supervisor, and provenance is self-reported

Locator: "The evidence boundary"; Core v5 changes; A6 backend parent; A8.

- v5 `step` still takes objects. Whether the evidence was parsed from bytes
  depends on supervisor discipline. The core cannot check it, and a test of the
  core alone cannot show it.
- `provenance`, `adapter_sha256` and `manifest_sha256` arrive inside the frame,
  so the helper labels its own output.
- "Per-adapter hash (A1–A9)" does not fit one helper binary plus supervisor
  code for A8. Nothing says what each hash covers.
- A duplicate key is `EVIDENCE_NOT_JSON` in one paragraph and
  `EVIDENCE_DUPLICATE_KEY` in the code list.
- `sql_A` and `sql_B` embed the helper's `backend_parent` under the
  supervisor's provenance.
- v4 `checkAttestation` gives the owner attestation fixture provenance. v5
  does not say where the operational attestation comes from or how it is bound.

Repair: in operational mode, v5 `step` takes `{channel, bytes}`. The core
parses strictly: no BOM, duplicate keys refused, `__proto__`, `constructor` and
`prototype` keys refused, and a stated length endianness. The core then stamps
provenance and adapter hash from the channel's manifest binding: the helper
hash for helper channels, and the hash of the observer module plus SQL asset
for A8. It records `EVIDENCE_NOT_JSON`, `EVIDENCE_DUPLICATE_KEY` and
`EVIDENCE_MISSING` in history. Nested helper output in `sql_A`/`sql_B` keeps its
own channel stamp. Name the attestation channel, which is the collector
template, with an owner-affirmation provenance that no adapter can emit. With
this, I-C and the getter limit become core properties.

## Informational

- **I-1 (A3).** If `QueryFullProcessImageNameW` fails for a `postgres.exe` or
  `pg_ctl.exe` entry, for example another user's process, the result must be
  `unavailable`, not a non-match. The design does not say how
  `cluster_running` is derived.
- **I-2 (A6).** Snapshot parent PIDs can belong to a process that exited. After
  the snapshot, check that the opened handle is still running
  (`WaitForSingleObject == WAIT_TIMEOUT`). A live PID cannot be shared, so
  that ties the parent PID to the handle. `NtQueryInformationProcess`
  (`InheritedFromUniqueProcessId`) on the handle avoids a global snapshot. It
  is documented, with Microsoft's change caveat.
- **I-3 (A4).** `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` needs
  `EXTENDED_STARTUPINFO_PRESENT`, `STARTF_USESTDHANDLES`, inheritable handles
  and `bInheritHandles = TRUE` (Microsoft `UpdateProcThreadAttribute`). Use
  distinct handles in the list. pg_ctl passes its standard handles on to the
  shell (`InheritStdHandles`), so the NUL handles also reach postgres.
  Diagnostics go only to the `-l` log.
- **I-4 (A4).** The restricted-token chain reads `COMSPEC` from the explicit
  environment (`pg_ctl.c` `getenv("COMSPEC")`), which confirms why it is
  pinned. Whether postgres starts with only `COMSPEC` and `SystemRoot` is
  untested. The disposable-cluster test must show that.
- **I-5 (A7).** The `secret.rs` precedent copies the DPAPI output (`to_vec()`)
  and frees it without zeroing. The helper must zero the `CryptUnprotectData`
  buffer before `LocalFree`, avoid extra copies, and use a separate frame type
  that the generic evidence logger never records.
- **I-6 (A4 stop).** `pg_ctl stop` reads `postmaster.pid` itself. There is a
  short window between revalidation and that read, bounded by the 5 s
  pre-stop limit and the data-directory lock. Record it as a residual.
- **I-7.** Confirmed from source and documentation:
  - pg_ctl 18.6 still uses `"<COMSPEC>" /C` without `/D`, so A1 is needed.
  - `RegQueryValueExW` with NULL `lpData` and non-NULL `lpcbData` returns only
    the size. A missing value returns `ERROR_FILE_NOT_FOUND`, so A1 never reads
    the value text.
  - `secret.rs` uses `ENTROPY_PREFIX = "creator-agent-studio/1:"`, purpose
    `postgres` and `<name>.dpapi`. `studio.rs` loads `postgres` and saves it at
    setup, which matches A7.
  - The desktop app pins `windows = "=0.62.2"`. The helper needs four
    additional features.
- **I-8 (A5 LF rule).** Supported by source, not observed. `CreateLockFile`
  opens the file without `PG_BINARY`. In the backend (no `FRONTEND`),
  `pgwin32_open` passes no `O_TEXT` to `_open_osfhandle`, so the descriptor is
  binary. `open.c` says the frontend adds `O_TEXT` only to keep pre-12
  behaviour, and Microsoft lists `_O_TEXT` as the only text flag.
  `AddToDataDirLockFile` uses `PG_BINARY`. So the file should contain LF only.
  A disposable-cluster test must confirm it before W1 is relied on.

## Carried items

| Item | Disposition |
| --- | --- |
| R1 AutoRun | Design adequate (A1 plus AMD64 rule). Source confirms `/C` without `/D`. |
| R2 containment | Adequate. Add I-2. |
| R3 SQL link | Adequate in shape. Provenance per F7. |
| I-C, getter | Closed only with the F7 repair. |
| N1 / N2 / N3 / N4 | N1 strict parser specified, native parity still blocking. N2 narrowed by F4. N3 needs F3. N4 kept, with the F2 literal. |
| Collector L1 / L4 | Pending, not changed by this design. `leases` stays unbound, so preflight blocks. |
| 120 s bound | Confirmed by Jordan. Unchanged. |
| M3 | Not reopened. |

## Status of authority

This review is repository-only. It grants no implementation, Windows API call,
registry, pidfile or process read, credential use, SQL, cluster start or stop,
launch, sign-in or native-session authority. It does not record or request
Jordan's attestation, and it does not fill any manifest binding or grant.

## Next eligible prompt (bounded)

"Write a repository-only v1.1 note to the CW-01 operational adapter design that
answers F1–F7 and I-1 to I-8 of
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_REVIEW_2026-10-26.md`. Keep
the design and every input byte-unchanged. No code, tests, helper build,
operational reads, SQL, credentials, launch or sign-in. Then request an
independent re-review in a separate thread."

Jordan's priority remains a usable, polished app. This chain only matters for
native acceptance, so it can wait behind app work without any risk.
