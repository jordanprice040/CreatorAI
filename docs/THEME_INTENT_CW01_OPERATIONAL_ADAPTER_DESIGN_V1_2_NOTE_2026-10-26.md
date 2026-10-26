# CW-01 operational adapter design v1.2 note — October 26, 2026

Status: repository-only additive note. It answers the
[v1.1 re-review](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_REVIEW_2026-10-26.md)
(`48ee4835…74de`). The author is the Claude thread that wrote the design and
the v1.1 note. It is **not reviewed**: a fresh thread reviews it next. Read it
with the [design](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_2026-10-26.md)
(`97258c08…031e`) and the
[v1.1 note](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_NOTE_2026-10-26.md)
(`0c314c1c…c02e`). Both are unchanged. Only the contracts named below replace
earlier text.

Nothing was implemented, built, tested, read from the operating system or
executed. Operational/native readiness is **NOT READY (blocked)**. M3 is
unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
full C54 partial, and the workspace-ID alternative is disabled. The 120 s
attestation bound is unchanged.

## G1 (Medium): one multipart input with a fixed schema per event

Replaces v1.1 F7 "Input" and "Nested evidence".

- An operational `step(run, event, input)` takes `input = { parts }`, where
  `parts` is an array of `{ channel, bytes }`. That includes events with a
  single part.
- Each event has a fixed **part schema** in the core. The schema lists each
  required part by channel and, for helper parts, by `subcommand`. It also
  gives the count (exactly one each) and the evidence field the parsed part
  fills. The core assembles the evidence object from parsed parts itself, so
  the v4 checks run on that core-built object. Missing, extra, duplicate or
  wrong-subcommand parts are refused (`PARTS_SCHEMA_MISMATCH`) before any check
  runs.

  | Event            | Parts (channel / subcommand → field)                                                                                                                                                  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `admit`          | supervisor / `admit` → `at_ms`                                                                                                                                                        |
  | `preflight`      | helper / `preflight` → whole evidence                                                                                                                                                 |
  | `start_intent`   | supervisor / `start_intent` → `at_ms`; owner_undertaking → `attestation`; helper / `job` → `job`; helper / `autorun` → `autorun`                                                      |
  | `start_outcome`  | helper / `launch` → `pg_ctl_exit`, `pg_ctl_timeout_s`, `timed_out`, `outer_deadline_exceeded`, `launch`, `observed_at_ms`; helper / `pidfile` → `pidfile`; helper / `chain` → `chain` |
  | `sql_A`, `sql_B` | sql_observer → whole evidence except `backend_parent`; helper / `backend-parent` → `results.backend_parent`                                                                           |
  | `disconnect`     | sql_observer / `disconnect` → whole evidence                                                                                                                                          |
  | `stop_intent`    | supervisor / `stop_intent` → `at_ms`, `mode`, `pg_ctl_timeout_s`; helper / `revalidate` → `revalidation`                                                                              |
  | `stop_outcome`   | helper / `launch` → outcome fields and `launch`; helper / `stopped` → `stopped_observation`                                                                                           |
  | `w2_reference`   | helper / `w2` → whole evidence                                                                                                                                                        |

- **Supervisor channel.** Fields only the supervisor can supply (event times,
  `mode`, the fixed `pg_ctl_timeout_s`) arrive on a new `supervisor` channel.
  The core stamps them `supervisor_assertion`. They are never accepted where v4
  requires a measurement, and `measured()` refuses them. The `mode` and
  `pg_ctl_timeout_s` values are checked against fixed constants, so an
  assertion can only refuse, never widen.
- **Times.** Helper parts carry `observed_at_ms` from the helper. Supervisor
  `at_ms` values come from `Date.now()` in the supervisor. Both read the same
  machine's system clock (`GetSystemTimePreciseAsFileTime` in the helper,
  converted to Unix milliseconds). The core checks ordering between them as v4
  already does: for example `start_intent.at_ms` must not precede the newest
  pre-spawn observation, and the stop part's `at_ms` must come after the
  revalidation part's `observed_at_ms`. A supervisor time can only make a check
  stricter. Freshness against spawn still uses the helper-measured pg_ctl
  creation time (v4 F2), not supervisor times.

## G2 (Medium): a separate owner undertaking, and an honest provenance label

Replaces v1.1 F7 "Attestation" and the `owner_attestation` row of its channel
table.

- **Two records, two channels.** The collector template record (the nine
  pre-admission inputs) stays binding evidence on an `owner_bindings` channel,
  stamped `owner_produced`. It is read at admission. The six-item W1–W3
  undertaking that v4 `checkAttestation` checks arrives on a separate
  `owner_undertaking` channel. This matches the frozen design's v1.1 I-f.
- **Hash links.** The undertaking record must contain the collector record's
  SHA-256, the manifest hash, the request ID and the inspector hash. v5 refuses
  a mismatch (`UNDERTAKING_LINK_MISMATCH`). Its `affirmed_at_ms` must fall
  between admission and `start_intent`, as v4 already requires, and within
  120 s of pg_ctl's creation.
- **How the undertaking is produced.** After admission, the supervisor prints
  the request ID, the manifest hash and the six items to its **console**. Jordan
  types the request ID and answers each item with `yes` plus a short basis.
  The supervisor refuses to collect the undertaking unless its standard input is
  an interactive console (`GetConsoleMode` succeeds on the input handle, checked
  through the helper). Piped or redirected input gives `UNDERTAKING_NOT_INTERACTIVE`.
  It writes the record, then sends its bytes on the `owner_undertaking`
  channel. Nothing is prefilled.
- **What the label means.** This is a human-presence check, not authentication.
  An agent driving the desktop, or anyone at the keyboard, could type the
  answers. The design has no cryptographic owner identity. So the core stamps
  the part `owner_undertaking_console`, not `owner_affirmation`, and every
  operational receipt states: "Undertaking collected at an interactive console;
  the author is not authenticated." AGENTS.md invariants 3 and 4 still hold:
  the undertaking grants nothing, and no model may type it. This residual is
  **for Jordan to accept or reject** before any operational run. If Jordan rejects
  it, operational runs stay blocked until an authenticated path exists, such as
  a signed-in studio decision record.

## G3 (Low): read the wrapper through own data properties and copy the bytes once

Adds to G1.

- The core reads `input` and each part only through
  `Object.getOwnPropertyDescriptor`. It requires plain data properties with the
  exact key set (`parts` on the input, and `channel` and `bytes` on each part).
  `parts` must be a real array (`Array.isArray`), read by index descriptor. Any
  accessor, extra key, missing key or non-array refuses the step
  (`EVIDENCE_NOT_FRAME`).
- `channel` must be a primitive string from the fixed channel list.
- `bytes` is accepted only when `ArrayBuffer.isView(bytes)` is true and it is a
  `Uint8Array`. Node `Buffer`s pass. The core copies it once with
  `Uint8Array.prototype.slice.call(bytes)`, which throws on a Proxy, and then
  parses and digests only that copy.
- The v1.1 claim "an operational run cannot receive an object at all" is
  replaced by: **no caller-built object reaches the checks**. With G1 and G3, I-C
  and the getter limit are core properties.

## G4 (Low): the secret frame never reaches the core

Replaces v1.1 F7 "Framing" and adds to I-5.

- Each helper frame starts with a 1-byte type, then a 4-byte little-endian
  length, then the payload. Type `0x01` is evidence. Type `0x02` is secret. Any
  other type is a protocol error, and the supervisor ends the run as unknown.
- A secret frame is valid only as the single reply to an `unprotect` request.
  The supervisor's frame reader hands it straight to the credential path (v1.1
  F5) and never to `step`, a logger or a digest. A secret frame at any other
  time is a protocol error.
- The core also refuses any part that is not tagged evidence
  (`EVIDENCE_NOT_FRAME`), without digesting it.
- Required later test: after a run with a known test secret, no history entry,
  receipt or log contains the SHA-256 of that secret, or the secret itself.

## G5 (Low): keep the postgres image locked through disconnect, and bind pg_bin

Adds to v1.1 F3.

- The helper keeps its read-only handle on `postgres.exe` from before launch
  until `disconnect` is recorded, so the observer backend execs the hashed image.
  The `pg_ctl.exe` and `cmd.exe` handles are released after A6 for start, as
  before, and reopened from pre-stop revalidation through the stop outcome.
- `backend-parent` also reports the backend's image path and its SHA-256,
  hashed through a handle. v5 requires it to equal the bound postgres hash
  (`IMAGE_MISMATCH`).
- **DLLs.** New binding `pg_bin_dir_acl`: owner-produced or granted evidence that
  an unprivileged account cannot write to `pg_bin`. This is the same kind of
  evidence as `native_helper_dir`. Without it, admission blocks. DLLs are not
  hashed one by one. Substitution by an account that can write `pg_bin` is
  recorded as an accepted residual under the owner-trust boundary.

## G6 (Low): the helper stops on supervisor loss and never touches the cluster

Adds to v1.1 F1.

- EOF or a broken pipe on the helper's stdin, or a failed write to stdout, ends
  the run inside the helper. It starts no new subcommand and stops waiting. It
  closes its retained handles and exits. It never stops, kills or signals pg_ctl,
  the shell or the cluster.
- If that happens after `start_intent`, the next supervisor start finds the
  previous run's evidence directory without a final receipt. It records the run
  as terminal `orphaned_run_needs_owner` and refuses any new run for that
  cluster until Jordan records a decision (no automatic adoption, stop or
  retry). This adds one terminal state to v5.
- Required later test: close the helper's stdin during a fixture launch wait.
  The helper must exit, and the fixture process must still be running.

## G7 (Low): the password string lives as long as the client

Replaces v1.1 F5's "drops its own reference" claim.

- pg 8.23.1 replaces the password function with the returned string on the
  client and its `connectionParameters`. So the string lives as long as the
  client. The supervisor ends the client (`client.end()`) right after `sql_B`,
  before `disconnect` is recorded, and drops the client reference.
- The client and `connectionParameters` are never serialized, logged or put in
  an error message. The observer catches driver errors and keeps only coded
  outcomes, as A8 already says.
- `CREDENTIAL_REUSE_REFUSED` is kept as defence in depth. The note no longer
  claims it is reachable through pg.

## Informational items

- **I-a (F2).** Assumption stated with the rule: the cluster's
  `postgresql.conf` does not set `data_directory`. If it does, PostgreSQL uses
  that value and line 2 differs, so W1 fails closed. The startup-boundary asset
  must record that `data_directory` is unset, and the disposable-cluster test
  covers both cases.
- **I-b (F6).** The supervisor launcher uses an **allowlist** environment:
  `SystemRoot`, `TEMP`, `TMP` and `PATH` limited to the bound Node directory,
  each from a reviewed binding. Everything else is absent, including
  `NODE_OPTIONS`, `NODE_PG_FORCE_NATIVE` and every `PG*` key. The startup
  refusal (`PG_ENV_PRESENT`) also covers `NODE_OPTIONS` and
  `NODE_PG_FORCE_NATIVE`. The resolved-parameter check adds `replication`,
  `binary` and `connect_timeout`. Expected values: `host` `127.0.0.1`, bound
  `port`, `database` and `user`, `ssl` `false`, `replication` undefined,
  `binary` `false`, `options` undefined, `client_encoding` undefined,
  `application_name` `cw01-observer`, and `connect_timeout` 5.
- **I-c (I-2).** Reworded: opening a running process after the snapshot does
  not by itself tie the PID to the snapshot entry, because the PID could be
  reused in between. The tie comes from v4's creation-time ordering
  (`checkProcessChain`, and `backendParent`'s `SQL_PARENT_PID_REUSE`), which
  refuses a process created after the expected parent.
- **I-d (I-1).** Recorded: if another account's PostgreSQL is running, a
  limited query may fail for it, and preflight will be `unavailable` every
  time. A run plan must check for that first.
- **I-e (F5).** The startup-boundary asset pins the observer's HBA method to
  `scram-sha-256` on `127.0.0.1/32`. A `trust` or `peer` entry that matches the
  observer fails admission. The "password function called once" test then
  holds.
- **I-f (I-5).** The helper writes the secret frame with one direct `WriteFile`
  on the raw stdout handle from a buffer it zeroes afterwards, not through
  Rust's buffered `std::io::stdout()`. Copies the operating system makes in
  the pipe are an accepted residual.

## Updated v5 additions

New codes: `PARTS_SCHEMA_MISMATCH`, `UNDERTAKING_LINK_MISMATCH`,
`UNDERTAKING_NOT_INTERACTIVE`, `IMAGE_MISMATCH`, and terminal state
`orphaned_run_needs_owner`. New channels: `supervisor`, `owner_bindings` and
`owner_undertaking`. They replace v1.1's `owner_attestation`. New binding:
`pg_bin_dir_acl`. All values stay **pending**.

New decision for Jordan: accept or reject the G2 residual (the undertaking is
collected at an interactive console and the author is not authenticated).

## Status of authority

Repository-only. This note grants no implementation, helper build, Windows API
call, registry, pidfile or process read, credential use, SQL, cluster start or
stop, launch, sign-in or native-session authority. It fills no binding or grant
and does not record or request the undertaking. M3 is not reopened.

Next eligible: an independent repository-only re-review of this note in a fresh
thread, against the design, the v1.1 note, both reviews and their receipts, the
v4 core and tests, SQL asset v2, `secret.rs` and the cited sources. Report
design support separately from implementation and operational readiness.
