# CW-01 operational adapter design v1.1 note — October 26, 2026

Status: repository-only additive note. Jordan asked for it to answer the
independent review. The author is the Claude thread that wrote the design. It is
**not reviewed**: a fresh thread reviews it next. Read it with the
[design](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_2026-10-26.md)
(`97258c08…031e`, unchanged) and the
[review](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_REVIEW_2026-10-26.md)
(`3cbfe9cf…4c3f`; receipt `b2d13f6f…d88e`). Only the contracts named below
replace design text. Everything else in the design stands.

Nothing was implemented, built, tested, read from the operating system or
executed while writing this note. Operational/native readiness is **NOT READY
(blocked)**. M3 is unchanged and not reopened. Original A0 is blocked, NI
not-run, H unverified, full C54 partial, and the workspace-ID alternative is
disabled. The 120 s attestation bound (Jordan, October 26) is unchanged.

## F1 (Medium): spawn the helper detached

Replaces the design's statement that the helper runs "as one long-lived child of
the supervisor", and adds to A2.

- The supervisor starts `cw01-native` with `child_process.spawn(path, [],
{ detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env })`.
  `detached: true` maps to libuv's `UV_PROCESS_DETACHED`, so the helper is not
  put in libuv's global kill-on-close job. The supervisor does not call
  `unref()`. It keeps the pipes and waits for the helper to exit.
- A2 stays a self-check of the helper process. With the detached spawn, a `true`
  result now means the job comes from outside Node, such as a terminal or IDE.
  It still refuses start (`NESTED_JOB_REFUSED`). There is no breakaway attempt,
  no policy change, and no terminate right is added.
- The supervisor records the spawn options it used as part of the run request,
  and v5 refuses a run whose recorded helper spawn was not detached
  (`HELPER_NOT_DETACHED`). A helper running inside libuv's job is a defect, not
  a condition to work around.
- Required later test: spawning the helper without `detached` must make A2 report
  `in_job: true`, and v5 must refuse it. Spawning it detached from a plain
  console must report `in_job: false`. This shows libuv's job is the cause, so a
  pass is not an accident of the test host.
- The pg_ctl chain needs nothing new. pg_ctl creates its own `PostgreSQL_<pid>`
  job only when the shell is outside any job, and that job has no kill-on-close.

## F2 (Medium): bind a reviewed pidfile line-2 literal

Replaces the v4 rule "line 2 must have the same spelling as `cluster_dir`" for
operational runs. The v4 fixture rule stays for fixture runs.

- New manifest binding `pidfile_data_dir_literal`. It is derived from the
  admitted `cluster_dir` by one rule: replace every `\` with `/` and change
  nothing else. That is what PostgreSQL 18.6's `debackslash_path` in
  `canonicalize_path_enc` does on Windows for a path that `admitPathSpelling`
  already admits. Such a path has no `.`, `..`, empty segment or trailing
  separator, so the other canonicalization steps change nothing.
- v5 `admitRequest` recomputes the literal from `cluster_dir` and requires it to
  equal the bound value (`PIDFILE_LITERAL_MISMATCH`). It is computed once, at
  admission, from an already admitted spelling. This is a reviewed literal under
  I-d, not normalization of an observed value into a match.
- v5 `validatePidfile` compares line 2 to `pidfile_data_dir_literal` with exact
  string equality. Case, drive-letter case, doubled separators or any other
  difference returns `PIDFILE_DIRECTORY_MISMATCH`.
- The rule applies only to printable-ASCII paths (F4).
- Required later tests: a fixture whose line 2 is the forward-slash literal
  passes; one with backslashes, mixed separators, a lowercase drive letter or a
  trailing `/` fails. A disposable-cluster test must show the real line 2 equals
  the derived literal before W1 is relied on.

## F3 (Low): fixed argv[0] and hash-locked images before launch

Adds to A4 and the N3 row.

- **argv[0].** The command line starts with the exact manifest `pg_ctl` path in
  double quotes, then the fixed tokens. `lpApplicationName` is the same path.
  pg_ctl's `find_my_exec` then resolves itself from that absolute path and finds
  `postgres` beside it, never in the working directory or `PATH`.
- **Hash-locked images.** Before `CreateProcessW`, the helper opens `pg_ctl.exe`,
  `postgres.exe` (the sibling in the bound `pg_bin`) and System32 `cmd.exe` with
  `GENERIC_READ` and `FILE_SHARE_READ` only. It checks each for no reparse
  attribute and one link, hashes each through its handle, and compares with the
  manifest. A mismatch blocks start (`IMAGE_MISMATCH_PRELAUNCH`). The helper
  keeps all three handles open until A6 finishes for start, and again from
  pre-stop revalidation until the stop outcome. While they are open, no other
  process can get write or delete access, so the files cannot be replaced
  between hashing and the `postgres -V` probe or the start.
- **Helper race.** The supervisor cannot lock `cw01-native` the same way, because
  Node's `fs.open` always shares write and delete access. The manifest binds
  the helper's directory (`native_helper_dir`) to one that an unprivileged
  account cannot write. That needs ACL evidence of the same kind as
  `working_dir`, owner-produced or under a granted read. The helper also hashes
  its own image at startup, through a read-only handle to its module path, and
  reports the hash in its first frame. v5 compares that hash with the manifest. A
  replacement between the supervisor's hash and the spawn would have to carry
  the bound hash to pass. The remaining window (replaced and then restored
  around the self-hash) is recorded as an accepted residual.

## F4 (Low): printable ASCII for every path PostgreSQL sees

Adds to N2, A4 and A5.

- `cluster_dir`, `log_path`, `working_dir`, `pg_bin`, the `pg_ctl` and
  `postgres` image paths and `cmd_image` must be printable ASCII (`0x20`–`0x7E`)
  and still pass `admitPathSpelling`. Anything else gives `PATH_NOT_ASCII` at
  admission. This shuts out Windows best-fit ("WorstFit") conversion in
  pg_ctl's and postgres's ANSI `argv`, and keeps the pidfile line 2 decodable.
- The planned N2 non-ASCII tests for those paths become refusal tests. Helper
  frames still carry non-ASCII paths unchanged for reads that never reach
  PostgreSQL, for example the DPAPI blob path or collector targets.
- A4's statement that "no quote or CMD metacharacter can appear" now rests on
  ASCII-only plus the metacharacter refusal together.

## F5 (Low): credential delivery that fits pg 8.23.1, and no pgpass

Replaces A7 "Delivery".

- `pg` 8.23.1 needs the password as a string. The supervisor converts the secret
  frame to a string once, passes it only through a one-shot `password` function
  given to the client, and drops its own reference after the function runs. A
  second call returns `CREDENTIAL_REUSE_REFUSED` by throwing. JavaScript strings
  cannot be zeroed, and the design does not claim they are. The helper still
  zeroes its own buffer (I-5).
- The client is built only after `unprotect` returns a non-empty secret. There
  is no code path that builds a client with a null or empty password, so `pg`
  never reaches its `pgpass` branch.
- `PGPASSFILE` is covered by F6: the supervisor runs with no `PG*` variables at
  all. It is not set to a dummy value, because any `PG*` value is a fallback
  source.
- Required later tests: with the credential missing, no client is built and no
  file named `pgpass.conf` (or `PGPASSFILE`) is opened; with it present, the
  `password` function is called once and the pgpass branch is not taken.

## F6 (Low): no `PG*` environment at all

Replaces A8's sentence about clearing `PG*` "from that config path".

- The supervisor process itself starts with an explicit environment built by the
  launcher script. It contains no key that starts with `PG` (case-insensitive,
  since Windows environment names are case-insensitive), no `PGPASSFILE`, and no
  `PGSERVICEFILE`.
- At startup, before importing `pg`, the supervisor checks `process.env` and
  refuses to run if any `PG*` key is present (`PG_ENV_PRESENT`). It does not
  delete them and carry on, so a misconfigured launch is visible.
- Before connecting, it reads the client's resolved `ConnectionParameters`
  (`host`, `port`, `database`, `user`, `options`, `application_name`,
  `client_encoding`, `ssl`) and compares them with the expected values. Any
  difference refuses the connection (`PG_PARAMETERS_UNEXPECTED`). `ssl` is set
  to `false` explicitly, never left undefined.
- The test that sets `PG*` variables stays mandatory, and it now checks both
  the startup refusal and the resolved-parameter check.

## F7 (Low): the core parses frames and stamps provenance

Replaces "The evidence boundary" paragraph's I-C and provenance text, and the
"Core v5 changes" list where they differ.

- **Input.** In operational mode, v5 `step(run, event, input)` takes
  `{ channel, bytes }` where `bytes` is a `Uint8Array`. Any other input shape is
  refused (`EVIDENCE_NOT_FRAME`). The supervisor never passes parsed objects to
  an operational run.
- **Framing.** Each helper frame is a 4-byte unsigned **little-endian** length
  followed by that many bytes, at most 64 KiB. The supervisor splits frames and
  hands each frame's bytes to the core. The length prefix is not part of
  `bytes`.
- **Parsing in the core.** Strict UTF-8, no BOM, a JSON parser that refuses
  duplicate keys and the keys `__proto__`, `constructor` and `prototype`. It
  also refuses numbers outside the safe-integer range and non-integer numbers
  where the schema expects integers. Codes, all recorded in history with the
  digest of the raw bytes:
  - empty bytes or no frame for the event: `EVIDENCE_MISSING`;
  - invalid UTF-8, BOM, syntax error, oversize: `EVIDENCE_NOT_JSON`;
  - duplicate key: `EVIDENCE_DUPLICATE_KEY`;
  - forbidden key: `EVIDENCE_FORBIDDEN_KEY`.

  This replaces the design's statement that a duplicate key gives
  `EVIDENCE_NOT_JSON`.

- **Provenance is stamped, not reported.** Frames must not contain
  `provenance`, `adapter_sha256`, `manifest_sha256` or `fixture`
  (`EVIDENCE_SELF_LABELED`). The core adds them from the channel binding:

  | Channel             | Source                      | Adapter hash covers                                         |
  | ------------------- | --------------------------- | ----------------------------------------------------------- |
  | `helper`            | `cw01-native` stdout frames | The helper image (the hash it self-reports must match)      |
  | `sql_observer`      | Supervisor A8 module        | SHA-256 of the observer module file plus the SQL asset hash |
  | `owner_attestation` | Collector-template record   | The template's hash; provenance `owner_affirmation`         |

  "Per-adapter hash (A1–A9)" in the design is replaced by this table. A1–A7 and
  A9 share the helper channel; each frame carries a `subcommand` field that the
  core checks against the event.

- **Nested evidence.** `sql_A` and `sql_B` frames from the observer must not
  contain `backend_parent`. The core takes `backend_parent` from a separate
  helper-channel frame (`backend-parent`) passed in the same `step` call as
  `{ channel, bytes, related: [{ channel: 'helper', bytes }] }`, and stamps each
  part with its own channel.
- **Attestation.** The operational attestation comes only from the
  `owner_attestation` channel. Its bytes are Jordan's completed collector
  template record, linked to the manifest hash and request ID. No helper or
  observer frame can carry `owner_affirmation`. v4's fixture shortcut
  (`checkAttestation` adding fixture provenance) does not exist in operational
  mode.
- With this, I-C and the getter limit become properties of the core: an
  operational run cannot receive an object at all.

## Informational items

- **I-1 (A3).** If opening or querying any `postgres.exe` or `pg_ctl.exe` entry
  fails, the preflight result is `unavailable`, not a non-match.
  `cluster_running` is `true` if any matching process or listener exists,
  `false` only if the pidfile, process count and listener count are all absent
  or zero, and `unavailable` otherwise.
- **I-2 (A6).** After the snapshot gives a parent PID, the helper opens that PID
  and checks it is still running (`WaitForSingleObject(h, 0) == WAIT_TIMEOUT`)
  before using it. A running process's PID cannot be shared, so the PID is then
  tied to the handle. The snapshot is still the parent-PID source; the
  `NtQueryInformationProcess` alternative is not chosen, because Microsoft says
  it may change.
- **I-3 (A4).** `CreateProcessW` uses `EXTENDED_STARTUPINFO_PRESENT`,
  `STARTF_USESTDHANDLES`, `bInheritHandles = TRUE`, and a
  `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` with three **distinct** inheritable NUL
  handles. pg_ctl passes them on, so postgres also gets NUL standard handles,
  and diagnostics go only to the `-l` log.
- **I-4 (A4).** Whether postgres starts with only `COMSPEC` and `SystemRoot` is
  unproven. The disposable-cluster test must show it. If more variables are
  needed, each one is added by a reviewed binding, never by copying the
  supervisor's environment.
- **I-5 (A7).** The helper zeroes the `CryptUnprotectData` output with
  `SecureZeroMemory` before `LocalFree`, makes no other copy except the frame
  write, and uses a separate frame type (`secret`) that the evidence logger
  never records or digests.
- **I-6 (stop).** `pg_ctl stop` reads `postmaster.pid` itself after the
  revalidation. That window is bounded by the 5 s pre-stop limit and the
  data-directory lock, and is recorded as an accepted residual.
- **I-7.** No change needed; the review confirmed A1, A7's store layout and the
  crate pin.
- **I-8 (A5).** The LF-only rule is supported by source. The disposable-cluster
  test must confirm it before W1 is relied on (same test as F2).

## Updated new-code list for v5

`HELPER_NOT_DETACHED`, `PIDFILE_LITERAL_MISMATCH`, `IMAGE_MISMATCH_PRELAUNCH`,
`PATH_NOT_ASCII`, `CREDENTIAL_REUSE_REFUSED`, `PG_ENV_PRESENT`,
`PG_PARAMETERS_UNEXPECTED`, `EVIDENCE_NOT_FRAME`, `EVIDENCE_NOT_JSON`,
`EVIDENCE_DUPLICATE_KEY`, `EVIDENCE_FORBIDDEN_KEY`, `EVIDENCE_SELF_LABELED`,
plus the design's `IMAGE_MACHINE_UNSUPPORTED` and `GRANT_MISSING:<scope>`.

New manifest bindings: `pidfile_data_dir_literal`, `native_helper_dir` (with
ACL evidence) and `observer_module_sha256`. All values stay **pending**.

## Status of authority

Repository-only. This note grants no implementation, helper build, Windows API
call, registry, pidfile or process read, credential use, SQL, cluster start or
stop, launch, sign-in or native-session authority. It fills no binding or grant
and does not record or request Jordan's attestation. M3 is not reopened.

Next eligible: an independent repository-only re-review of this note in a fresh
thread, against the design, the review and its receipt, the v4 core and tests,
SQL asset v2, `secret.rs`, and the cited PostgreSQL, libuv, `pg` and Microsoft
sources. Report design support separately from implementation and operational
readiness. No code, tests, operational reads, SQL, credentials or launch.
