# CW-01 operational adapter design v1.2 note independent re-review — October 26, 2026

Prompt: U02 (independent re-review), repository-only. Reviewed document:
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_NOTE_2026-10-26.md`
(`a3d64af4…0c8a`, 15,006 bytes), at commit `f406df6` on branch
`claude/project-thread-7gwqdm` (PR #47). Read with the unchanged design
(`97258c08…031e`), the v1.1 note (`0c314c1c…c02e`), the first review
(`3cbfe9cf…4c3f`, receipt `b2d13f6f…d88e`) and the v1.1 re-review
(`48ee4835…74de`, receipt `c1debc77…ee31`).

## Verdicts

- **Design support: SUPPORTED WITH CONDITIONS.** G4, G5, G6 and G7 are
  resolved. G3 is resolved in structure with one Low residual (J6). G1 is
  resolved for the input shape and the supervisor channel, with three Low gaps
  in the schema (J3, J4, J5) and one overclaim about supervisor times (J7). G2
  is only **partly resolved**: the two records, the two channels and the hash
  links are right, and the receipt sentence is honest, but the note describes
  the console check as a "human-presence check" when a program can satisfy it
  with no desktop at all, and the check mechanism as written cannot run in the
  detached helper (**Medium J1**). The console flow also does not collect every
  field `checkAttestation` reads, and the provenance stamp no longer matches it
  (Low J2). I-a to I-f are all resolved, with three informational notes. No High
  finding. Nothing in the note widens authority.
- **Significant issues remain: yes, one Medium (J1).**
- **I-C and the getter limit:** now core properties for the wrapper and parts,
  except that the single copy in G3 can still be steered by the caller (J6).
- **Implementation readiness: NOT STARTED.** No helper, no v5, no tests. This
  review authorizes none of them.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
  full C54 partial, and the workspace-ID alternative disabled. Reader N1–N4
  native parity, collector L1/L4, real bindings (now including
  `pg_bin_dir_acl`), all grants, Jordan's undertaking and W2 comparison are
  still missing.
- **G2 residual:** while this review was being written, Jordan accepted it in
  the author thread as a known limit ("I am okay accepting that as a known
  limit", 2026-10-26 09:35Z, relayed by the coordinator). That acceptance was
  given on the note's wording. J1 shows the real scope is wider: a program can
  pass the console check without the desktop. If Jordan confirms the acceptance
  also covers that wider scope, J1's first part is closed and J1 drops to Low
  (the mechanism gap only). Until then J1 stays Medium.
- **120 s bound:** confirmed by Jordan and unchanged.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed or input files. The design, both notes and both earlier reviews were
written by other Claude threads. This is the **same model family and not
blinded**. No external review service.

Executed: checked that `HEAD` is `f406df6`; SHA-256 of the v1.2 note, design,
v1.1 note, both reviews and both receipts, v4 core and tests, SQL asset v2,
`secret.rs`, the collector template and its v1.1 note, and the frozen
implementation design's v1.1 note (all match the named values, hashes in the
receipt). `git log` shows each of those inputs was last touched by an earlier
commit (`25e39e4`, `34c45a2`, `cf3a839`, `1c0167f`, `acd000b`, `efe6627`), and
`git diff 34c45a2 f406df6 --stat` lists only the v1.1 re-review, the v1.2
note, its receipt, `.prettierignore` and the two tracking files. So the earlier
documents and inputs are byte-unchanged. The working tree differs from `HEAD`
only in `.codex/config.toml`, which is not an input. Read the v4 core
(`measured`, `checkJobContext`, `checkAttestation`, `validatePidfile`,
`checkProcessChain`, `sqlCommon`, `backendParent`, `checkSqlA`, `checkSqlB`,
`checkPreflight`, `HANDLERS`, `step`), design A6 and A7, the frozen v1.1 note
I-f, and the installed `pg` 8.23.1 `client.js` (`_getPassword`, 274–311) and
`connection-parameters.js` (78–135), whose hashes match the v1.1 re-review
receipt. Fetched Microsoft's "Creating a Pseudoconsole session" page.

Not re-fetched: the PostgreSQL `REL_18_6` and libuv sources. I relied on the
v1.1 re-review's hashed copies for them, and none of my findings depends on a
new reading of them. ECMAScript `%TypedArray%.prototype.slice` behaviour (J6)
is from the ECMA-262 text as I know it. I did not execute it. Not done: Windows
API calls, registry, process, pidfile, port or credential reads, SQL, cluster
or app actions, launch, sign-in, builds, tests, `pnpm` or Prettier, tracking
edits, commits, and the retired OneDrive checkout.

## Disposition of G1–G7

| Finding | State | Basis |
| --- | --- | --- |
| G1 composite input | **Resolved for shape; Low J3, J4, J5, J7** | Checked every field each v4 handler reads. `admit` (`at_ms`), `preflight` (whole), `start_intent` (`at_ms`, `attestation`, `job`, `autorun`), `start_outcome` (`deadlineOk` fields, `pg_ctl_exit`, `launch`, `observed_at_ms`, `pidfile`, `chain`), `sql_A`/`sql_B` (observer evidence plus `results.backend_parent`), `disconnect`, `stop_intent` (`at_ms`, `mode`, `pg_ctl_timeout_s`, `revalidation`), `stop_outcome` (`deadlineOk` fields, `launch`, `stopped_observation`) and `w2_reference` all have a part. Gaps: `start_outcome.observed_at_ms` comes from the wrong part (J3), `revalidation.sql_instance_unchanged` has no measuring source (J4), and `sql_deadline` has no schema (J5). `measured()` refusing `supervisor_assertion`, and `mode`/`pg_ctl_timeout_s` checked against constants, mean those two assertions can only refuse. The same is not true of supervisor times (J7). |
| G2 owner undertaking | **Partly resolved; Medium J1, Low J2** | Two records on two channels (`owner_bindings` stamped `owner_produced`, `owner_undertaking`) match the frozen v1.1 note I-f ("remains separate, freshly affirmed and hash-linked"). The four hash links and the admission-to-`start_intent` window plus 120 s to pg_ctl creation are right. The receipt sentence "the author is not authenticated" is honest, and the residual is correctly left to Jordan. But the console check is weaker than described and cannot run where the note puts it (J1), and the console flow does not produce a record `checkAttestation` accepts (J2). |
| G3 wrapper | **Resolved in structure; Low J6** | Own data-property descriptors with exact key sets, `Array.isArray` plus index descriptors, a primitive channel from a fixed list, and `ArrayBuffer.isView` close the getter and accessor routes. A Proxy that answers descriptor reads is harmless as long as each descriptor is read once and its value used, which the text implies (say it). The single copy uses `%TypedArray%.prototype.slice`, which is species-dependent (J6). |
| G4 secret frame | **Resolved; Info J8** | In-band 1-byte type, secret valid only as the reply to `unprotect`, routed to the credential path, protocol error otherwise, and a test that the secret's digest never appears. |
| G5 postgres lock | **Resolved** | v1.1 F3 opens images with `GENERIC_READ` and `FILE_SHARE_READ` only, so while the handle is open no other open can get write or delete access, and rename needs delete access. Holding it until `disconnect` covers the observer backend's `CreateProcess`. The backend image hash through a handle on the still-locked path, compared with the bound hash (`IMAGE_MISMATCH`), is consistent. `pg_bin_dir_acl` as owner-produced or granted ACL evidence, with DLL substitution by a `pg_bin` writer as a recorded residual, is an adequate answer. |
| G6 supervisor loss | **Resolved; Info J9** | Exit on stdin EOF, broken pipe or failed write, with no new subcommand and no action on pg_ctl, the shell or the cluster, is the right behaviour. `orphaned_run_needs_owner` as a terminal state that blocks the cluster until Jordan decides is fail-closed. The planned stdin-close test is the right proof. |
| G7 password lifetime | **Resolved** | Confirmed `client.js` 286: `this.connectionParameters.password = this.password = pass`. Ending the client after `sql_B`, dropping the reference, and never serializing the client or its parameters is the honest contract. Keeping `CREDENTIAL_REUSE_REFUSED` as defence in depth is fine. |

## Disposition of I-a to I-f

| Item | State |
| --- | --- |
| I-a | Resolved. The assumption is stated, fails closed if wrong, and the disposable-cluster test covers both cases. |
| I-b | Resolved. Allowlist environment and the extended refusal and parameter list are right. Info: `pg` 8.23.1 does not read a `connect_timeout` config key; it derives `connect_timeout` from `connectionTimeoutMillis` (`connection-parameters.js` 126–130), so the expected value 5 means `connectionTimeoutMillis` 5000. `sslnegotiation` (line 104, `PGSSLNEGOTIATION`) can be added to the resolved list. |
| I-c | Resolved. Wording now rests on creation-time ordering. |
| I-d | Resolved. Recorded as a planning check. |
| I-e | Resolved in intent. Info: say how the pin is checked. HBA is first-match, `pg_hba_file_rules` is not readable by an unprivileged role by default, and it shows the file rather than the loaded rules. A live backstop is cheap: refuse the run (fail closed) if the password function was not called exactly once before authentication completed. |
| I-f | Resolved. One direct `WriteFile` from a buffer zeroed afterwards, with OS pipe copies as a recorded residual. |

## New findings

### J1 — Medium: the console check is not a human-presence check, and the helper cannot perform it

Locator: note G2 "How the undertaking is produced" and "What the label means";
v1.1 note F1; design "Architecture".

Two problems.

1. **What it proves.** `GetConsoleMode` succeeding on standard input shows that
   the handle is a console. It does not show a person is present. Windows'
   pseudoconsole (ConPTY) lets any program create a console, start a
   character-mode child attached to it, and write the child's input through a
   pipe ("the hosting application can use the write end of the input pipe to
   send user interaction information into the pseudoconsole", Microsoft,
   *Creating a Pseudoconsole session*). Terminal panels in IDEs and agent tools
   are typically hosted this way. So a program with no desktop control can pass
   the check and type all six answers. That includes the terminal tools the
   Claude threads in this project can use. The note's residual names only "an
   agent driving the desktop, or anyone at the keyboard". That understates who
   can satisfy it, and Jordan's acceptance (see Verdicts) was given on that
   text.
2. **Where it runs.** The note says the check is made "through the helper". Per
   v1.1 F1 the helper is spawned with `detached: true` (`DETACHED_PROCESS`) and
   piped stdio, so it has no console and no handle to the supervisor's standard
   input. As written the check cannot be made there. The design also says the
   supervisor never calls a Windows API directly, which rules out the obvious
   alternative (Node's `process.stdin.isTTY`, which libuv answers with
   `GetConsoleMode`) unless that exception is stated.

Repair: call it an interactive-console check, not human presence. Restate the
residual as "any process able to host or drive a console, including an agent's
terminal tool, can satisfy it; the author is not authenticated". Put that
wording to Jordan to confirm the acceptance covers it. Name the
mechanism: either a stated exception that the supervisor reads
`process.stdin.isTTY`, or a helper path that receives a duplicated handle.
Optionally narrow the check so it is harder to automate (for example a
per-run random challenge printed only to the console, with the console read in
raw mode), but say clearly that this still is not authentication.

### J2 — Low: the console record does not satisfy `checkAttestation` as written

Locator: note G2; v4 `checkAttestation`; v1.1 F7 provenance table.

v4 `checkAttestation` requires `provenance === 'owner_affirmation'`,
`operator_ref`, `scope === 'W1-W3'`, `inspector_sha256`, `request_id`,
`affirmed_at_ms`, and for each of six items `affirmed`, `basis`, `source`, a
`YYYY-MM-DD` `date` and an `uncertainty` string. It also calls `measured()`,
which needs an `adapter_sha256` for the part's channel. The note:

- stamps the part `owner_undertaking_console`, so unchanged v4 logic refuses it
  with `ATTESTATION_NOT_OWNER`, and the v5 code list does not say this check
  changes;
- has Jordan type only the request ID and "`yes` plus a short basis" per item,
  so `source`, `date`, `uncertainty` and `operator_ref` are either never
  collected (every run ends `ATTESTATION_INCOMPLETE`) or filled by the
  supervisor, which conflicts with "Nothing is prefilled";
- adds three channels (`supervisor`, `owner_bindings`, `owner_undertaking`)
  without extending the v1.1 F7 table that says what `adapter_sha256` each
  channel is stamped with (for example the supervisor module and console
  collector hashes).

All of this fails closed. Repair: state the v5 provenance value
`checkAttestation` accepts, list every field the console prompts for, mark
which ones (if any) the supervisor supplies and why that is not prefilling (the
hash links and `affirmed_at_ms` are reasonable supervisor fields), and extend
the channel table.

### J3 — Low: `start_outcome.observed_at_ms` comes from the launch part, not the ownership observation

Locator: note G1 table, `start_outcome` row; v4 `start_outcome` and `checkSqlA`.

v4 uses `e.observed_at_ms` for the 90 s outer deadline "from start intent
through the ownership observation", and stores it as `start_observed_at_ms`,
which `checkSqlA` requires the SQL connection to follow ("The single connection
opens after ownership was observed"). The schema fills it from the `launch`
part. The `pidfile` and `chain` parts are read later and carry their own
`observed_at_ms`, which the schema drops. So a chain observed after the 90 s
deadline would pass, and the SQL connection could open before the chain was
observed. Repair: require `launch ≤ pidfile ≤ chain` by `observed_at_ms`, and
fill the field from the `chain` part (or the maximum of the three).

### J4 — Low: `revalidation.sql_instance_unchanged` has no measuring source

Locator: note G1 table, `stop_intent` row; v4 `stop_intent`; design A6
"Pre-stop revalidation"; note G7.

v4 requires `v.sql_instance_unchanged === true`. The schema fills the whole
`revalidation` from the helper's `revalidate` part. Design A6's revalidation
re-reads the pidfile, checks retained handles and repeats the chain. It does no
SQL, and after G7 the client has already ended. So the helper could only
assert the field, and the core would stamp that assertion as a measurement.
Repair: have the core derive it from facts already checked (`checkSqlB`'s
`INSTANCE_CHANGED` test, plus the pidfile start time and postmaster creation
time unchanged in the revalidation), or remove it from the v5 shape with a
stated reason.

### J5 — Low: `sql_deadline` has no part schema

Locator: note G1 table; v4 `HANDLERS.sql_deadline`.

v4 has a `sql_deadline` event from `candidate_process_bound`, `sql_A` and
`sql_B` to terminal `sql_unknown`. The table omits it. Under "missing ...
parts are refused", it would be refused with `PARTS_SCHEMA_MISMATCH`, and a run
that hit the SQL deadline could not reach its terminal state. That fails
closed for stopping (stop needs `disconnected`), but it leaves a run with no
terminal receipt, which G6 would then treat as orphaned. Repair: give it a
schema, for example one `supervisor` part with `at_ms`, noting that it can only
move the run to `sql_unknown`.

### J6 — Low: the single copy in G3 can be steered through `@@species`

Locator: note G3.

`%TypedArray%.prototype.slice` creates its result with
`TypedArraySpeciesCreate`, which reads `bytes.constructor` and its
`@@species`. Both can be own properties or getters on the caller's array. A
species constructor may return a `Uint8Array` over a buffer the caller keeps,
so the caller can still change the "copy" between parse and digest. Repair:
brand-check with the `%TypedArray%.prototype[@@toStringTag]` getter (it reads
the internal slot, so it is `'Uint8Array'` for Buffers and cannot be spoofed by
an own property), then copy with `new Uint8Array(bytes)`, which allocates a
fresh `ArrayBuffer` without consulting species. Parse and digest that copy.
The Proxy case still throws.

### J7 — Low: supervisor times can loosen some orderings

Locator: note G1 "Times".

The note says "A supervisor time can only make a check stricter". That holds
for some checks but not all. `admitted_at_ms` is a lower bound for job,
attestation and preflight times, `start_intent.at_ms` is an upper bound for job
and attestation times and a lower bound for pg_ctl's creation
(`PG_CTL_BEFORE_INTENT`), so an early or late supervisor time loosens one side.
The undertaking's `affirmed_at_ms` is also a supervisor time. The
safety-relevant bounds that remain helper-measured (120 s from the undertaking
to pg_ctl creation, the pre-spawn ages, and pg_ctl's own creation time) limit
the effect, so this is Low. Repair: reword to say supervisor times are
trusted-code assertions that order events, and that every freshness bound is
anchored to a helper-measured time. Optionally take event times from a helper
`now` reply. Info: V8's `Date.now()` and the helper's
`GetSystemTimePreciseAsFileTime` both read system time but round separately,
so a 1 ms inversion can cause a spurious refusal. That fails closed; a
disposable-cluster run will show whether it matters.

## Informational

- **J8 (G4).** G3's exact key set `{channel, bytes}` has no place for the frame
  type, so "the core refuses any part that is not tagged evidence" needs a
  stated carrier (for example `bytes` includes the type byte for helper parts).
  Also state that any reply to `unprotect` that is not type `0x02` is a protocol
  error and is never forwarded to `step`.
- **J9 (G6).** Orphan detection needs the run's evidence directory and each
  history entry to be written durably before the helper is asked to `launch`.
  Record the orphan as a new record that names the last persisted entry hash,
  not as a change to the old run. "Until Jordan records a decision" carries the
  same not-authenticated caveat as J1.

## Carried items

| Item | Disposition |
| --- | --- |
| R1 / R2 / R3 | Unchanged. R2 wording now per I-c. |
| I-C, getter | Core properties after G1 and G3, subject to J6. |
| N1 / N2 / N3 / N4 | N3 improved by G5. Native parity still blocking. |
| Collector L1 / L4 | Pending. `leases` unbound, so preflight blocks. |
| G2 residual | Accepted by Jordan as a known limit on the note's wording; confirmation that it covers J1's wider scope is still needed. |
| 120 s bound | Confirmed by Jordan. Unchanged. |
| M3 | Not reopened. |

## Status of authority

This review is repository-only. It grants no implementation, helper build,
Windows API call, registry, pidfile or process read, credential use, SQL,
cluster start or stop, launch, sign-in or native-session authority. It does not
record or request Jordan's undertaking or decide anything for Jordan, and it fills
no manifest binding or grant.

## Next eligible prompt (bounded)

"Write a repository-only v1.3 note to the CW-01 operational adapter design that
answers J1–J9 of
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_REVIEW_2026-10-26.md`.
Keep the design, the v1.1 and v1.2 notes and every input byte-unchanged. No
code, tests, helper build, operational reads, SQL, credentials, launch or
sign-in. Then request an independent re-review in a separate thread." In
parallel, Jordan can confirm whether the accepted G2 limit also covers a
program passing the console check through a pseudoconsole.

Jordan's priority is still a usable, polished app. This chain only matters for
native acceptance.
