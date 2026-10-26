# CW-01 operational adapter design v1.1 note independent re-review — October 26, 2026

Prompt: U02 (independent re-review), repository-only. Reviewed document:
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_NOTE_2026-10-26.md`
(`0c314c1c…c02e`, 15,324 bytes), at commit `34c45a2` on branch
`claude/project-thread-7gwqdm` (PR #47). Read with the unchanged design
(`97258c08…031e`), the review (`3cbfe9cf…4c3f`) and its receipt
(`b2d13f6f…d88e`).

## Verdicts

- **Design support: SUPPORTED WITH CONDITIONS.** F1, F2, F4 and F6 are
  resolved. F3 and F5 are resolved with Low residuals. F7 is only partly
  resolved. The note introduces two new **Medium** findings, both in the F7
  repair: the single-frame input shape cannot carry the v4 events that combine
  several sources, so as written every real run is refused (G1), and the
  attestation channel names the wrong record and stamps owner provenance with
  nothing that ties the bytes to Jordan (G2). There are five new Low findings
  (G3–G7) and six informational items. No High finding. Nothing in the note
  widens authority.
- **I-C and the getter limit: not yet core properties.** Framed bytes close
  them for each frame, but G1 means composite events still need an assembled
  object, and G3 means the `{channel, bytes}` wrapper is itself a caller object.
- **Implementation readiness: NOT STARTED.** No helper, no v5, no tests. This
  review authorizes none of them.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
  full C54 partial, and the workspace-ID alternative disabled. Reader N1–N4
  native parity, collector L1/L4, real bindings, all grants, Jordan's
  attestation and W2 comparison are still missing.
- **120 s bound:** confirmed by Jordan and unchanged. Nothing here conflicts
  with it.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed or input files. The design and the note were written by another Claude
thread, and the first review by a third. This is the **same model family and
not blinded**. No external review service.

Executed: checked that `HEAD` is `34c45a2`; SHA-256 of the note, design,
review, receipt, v4 core and tests, SQL asset v2, `secret.rs` and the three
installed `pg` 8.23.1 files the review cites (all match); `git diff 25e39e4
34c45a2` confirms the design, v4 core and tests, SQL asset and `secret.rs` are
byte-unchanged. Read the v4 core (`admitPathSpelling`, `measured`,
`checkAttestation`, `validatePidfile`, `backendParent`, `HANDLERS`, `step`),
the collector owner-attestations template and the frozen design's v1.1 note
I-f. Downloaded PostgreSQL `REL_18_6` and libuv `v1.x` sources into my cloud
scratch directory. The six files the first review hashed match its receipt,
and `guc.c` and `launch_backend.c` are new (hashes in my receipt).

Not done: Windows API calls, registry, process, pidfile, port or credential
reads, SQL, cluster or app actions, launch, sign-in, builds, tests, `pnpm` or
Prettier, commits, and the retired OneDrive checkout. Windows behaviour below
comes from source and documentation. None of it was observed on a Windows
machine.

## Disposition of F1–F7

| Finding | State | Basis |
| --- | --- | --- |
| F1 detached helper | **Resolved**; Low G6 added | libuv `process.c` 1117–1128 sets `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP` and 1149–1152 skips the global-job assignment only for `UV_PROCESS_DETACHED`. With that, A2's `in_job: true` really means a job from outside Node. `HELPER_NOT_DETACHED` relies on spawn options the supervisor records itself, but A2 is the real check, so that is acceptable. The planned paired test (non-detached gives `in_job: true`, detached gives `false`) is the right proof. pg_ctl `CreateRestrictedProcess` (`pg_ctl.c` 1844–1872) creates its job only when the shell is outside a job, with `DIE_ON_UNHANDLED_EXCEPTION \| PRIORITY_CLASS` and no kill-on-close. Confirmed. |
| F2 pidfile literal | **Resolved**; Info I-a | For a path that `admitPathSpelling` admits (drive-rooted `X:\`, no `/`, no empty, `.` or `..` segment, no trailing dot or space, no CMD metacharacter, no `*?` or extra `:`), `canonicalize_path_enc` (`path.c` 344–) only debackslashes. The trailing-quote trim cannot fire (`"` is refused), there is no trailing or doubled separator, and there are no dot segments. `make_absolute_path` leaves an absolute path's spelling alone apart from canonicalizing. The rule keeps the drive-letter case, and the exact comparison keeps it too. The literal is computed once at admission from an admitted spelling, so it is a reviewed literal under I-d, not normalization. One assumption is unstated (I-a). |
| F3 argv[0] and hash locks | **Resolved for the three images**; Low G5 added | `exec.c` `find_my_exec` 160–176: an `argv0` with a separator is used directly, then `_fullpath` and canonicalization, and `find_other_exec` 310– looks for `postgres.exe` beside it and runs `"<path>" -V`. So a quoted, absolute argv[0] removes the cwd and `PATH` search. Read-only shared handles held from before `CreateProcessW` until A6 cover pg_ctl, postgres and cmd for the start window, but not the later backends (G5). The helper's self-hash plus the `native_helper_dir` ACL binding, with the restore-around-self-hash residual recorded, is an adequate answer to the helper race. |
| F4 printable ASCII | **Resolved** | Applies to every path PostgreSQL sees, and it is enforced at admission. Combined with the metacharacter refusal, it supports A4's "no quote can appear" claim. Non-ASCII stays allowed only for reads that never reach PostgreSQL. |
| F5 string password, no pgpass | **Resolved**; Low G7 added | `client.js` 274–310: when `password` is a function, its result is used and pg never reaches the `pgpass` branch. When it returns `undefined`, the password becomes `null` and `cb()` runs with no pgpass read. Building no client without a non-empty secret, and having no `PG*` environment, removes the remaining pgpass routes (`PGPASSFILE` and `APPDATA` are only read inside `pgpass`). No pgpass path remains. But pg keeps the string on the client (G7). |
| F6 no `PG*` environment | **Resolved**; Info I-b | `connection-parameters.js` `val()` (9–23) reads `process.env['PG'+KEY]` or a named variable only when the config value is falsy, and `readSSLConfigFromEnvironment` only when `ssl` is undefined. Refusing to start with any `PG*` key (case-insensitive), plus explicit `ssl: false`, closes those paths. The resolved-parameter check is sound defence in depth. Its list and expected values are incomplete (I-b). |
| F7 frames, strict parse, stamped provenance | **Partly resolved**; Medium G1 and G2, Low G3 and G4 | Little-endian length, the 64 KiB cap, strict UTF-8 with no BOM, refusal of duplicate and forbidden keys, separate codes recorded with a raw-byte digest, refusal of self-labeled frames, the per-channel adapter-hash table, and per-part channel stamps for nested `backend_parent` are all sound, and the code inconsistency is fixed. What is still open: the input shape (G1), the attestation channel (G2), the wrapper object (G3) and secret-frame routing (G4). |

## Disposition of I-1 to I-8

| Item | State |
| --- | --- |
| I-1 | Resolved. A failed image query gives `unavailable`, and the three-valued `cluster_running` rule fails closed. Operational consequence in I-d. |
| I-2 | Resolved in effect, but worded too strongly (I-c). |
| I-3 | Resolved. Three distinct inheritable NUL handles with the four required flags. pg_ctl passes them on (`InheritStdHandles`, `pg_ctl.c` 1744, 1789). |
| I-4 | Resolved as a required test with a binding-only extension rule. |
| I-5 | Resolved in intent. The frame type and routing are underspecified (G4). |
| I-6 | Resolved as an accepted residual. |
| I-7 | No change needed. Agreed. |
| I-8 | Resolved as a required disposable-cluster confirmation tied to F2. |

## New findings

### G1 — Medium: the single-frame input cannot carry v4's composite events

Locator: note F7 "Input", "Nested evidence"; v4 `HANDLERS`.

The note says an operational `step` takes `{ channel, bytes }` and refuses
"any other input shape" (`EVIDENCE_NOT_FRAME`). The only exception is
`related` for `sql_A` and `sql_B`. But v4 handlers, whose checks v5 keeps,
read composite evidence:

- `start_intent` reads `e.at_ms`, `e.attestation`, `e.job` and `e.autorun`.
  That is the owner channel plus at least two helper subcommands, plus a time.
- `start_outcome` reads `e.pg_ctl_exit`, `e.launch`, `e.pidfile`, `e.chain` and
  `e.observed_at_ms`, which come from three helper subcommands (`launch`,
  `pidfile`, `chain`).
- `admit` and `start_intent` read `e.at_ms`, and `stop_intent` reads `e.at_ms`
  and `e.mode`. These fields come from the supervisor, and none of the three
  channels in the table covers them.

As written, v5 must either refuse those events, which blocks every real run
just as F1 and F2 would have, or let the supervisor assemble an object again,
which undoes the F7 closure. The supervisor-supplied `at_ms` values also drive
the 120 s freshness check (`affirmed_at_ms ≤ start_intent_at_ms`) and the
pre-stop age check. So their source needs to be stated, not left implicit.

Repair: define one multipart input, for example `{ parts: [{ channel, bytes }]
}`, with a fixed per-event schema that names every required part by channel
and `subcommand`, its count and its field. Refuse missing, extra or duplicate
parts. Add a `supervisor` channel for supervisor-authored fields (event times,
`mode`), with provenance `supervisor_assertion`, which the core never accepts
as a measurement. Where a measured time exists, take times from helper frames'
`observed_at_ms`. State how the supervisor clock relates to `observed_at_ms`
(both come from the same machine clock).

### G2 — Medium: the attestation channel names the wrong record and stamps owner provenance without tying the bytes to Jordan

Locator: note F7 "Attestation" and the channel table; frozen design v1.1 note
I-f; v4 `checkAttestation`; collector owner-attestations template.

The note says the operational attestation's bytes are "Jordan's completed
collector template record". That template holds nine pre-admission binding
inputs, such as the LOCALAPPDATA literal, port, pg_bin and image provenance.
The frozen design's v1.1 note I-f says the opposite: "The six-item CW-01
W1–W3 undertaking remains separate, freshly affirmed and hash-linked to this
common record." v4 `checkAttestation` expects the six-item undertaking, with
`affirmed_at_ms` between admission and `start_intent`. A collector record that
was filled in before admission cannot satisfy that check. So taken literally,
every operational run ends at `ATTESTATION_NOT_FRESH` or `ATTESTATION_INCOMPLETE`.
The only way around that is to merge the two records, which contradicts a
supported contract. The first review's repair suggested "the collector
template", so this traces back to that review rather than to the author alone.

Separately, the core stamps `owner_affirmation` purely because the bytes
arrived on the `owner_attestation` channel. Nothing shows that Jordan, rather
than the supervisor or an agent running it, wrote the bytes. AGENTS.md
invariants 3 and 4 say a model cannot mark itself verified or supply
authorization. A channel label is not owner authentication.

Repair: name a distinct `owner_undertaking` channel for the six-item W1–W3
record, hash-linked to the collector record's hash, the manifest hash and the
request ID. Keep the collector record as binding evidence under its own
channel, with the provenance `owner_produced`. State the human-only path by
which the undertaking is produced inside the 120 s window. One example is an
interactive affirmation typed at the supervisor console after admission, or a
signed-in studio decision record, if one exists. If the design has no
authenticated path, say plainly that the stamp records the channel only, and
record that as an accepted residual for Jordan to accept or reject.

### G3 — Low: the `{channel, bytes}` wrapper is still a caller-built object

Locator: note F7 "Input" and the final bullet ("an operational run cannot
receive an object at all").

The wrapper is an object. `channel`, `bytes` or `related` can be getters, and
`bytes` can be a Proxy or a subclass whose contents change after the core
parses them and before it digests them. The supervisor will naturally hand
over Node `Buffer`s, which are a `Uint8Array` subclass. So a strict
"`Uint8Array`" prototype test would refuse real input, and an `instanceof`
test would accept Proxies.

Repair: read the wrapper only through own data-property descriptors with an
exact key set. Accept `bytes` only when `ArrayBuffer.isView(bytes)` is true
and it is a `Uint8Array`, Buffers included. Copy it once with
`Uint8Array.prototype.slice.call(bytes)`, which throws on a Proxy. Parse and
digest that copy only. Change the claim to "no caller object reaches the
checks".

### G4 — Low: the secret frame's type and routing are not specified

Locator: note F7 "Framing"; I-5; design A7 "Delivery".

The framing is "length plus bytes", and the note says each frame goes to the
core, which records a digest of the raw bytes in history. I-5 adds a separate
`secret` frame type that the logger never records or digests. But the frame
format has no type field, and nothing says the supervisor routes the secret
frame away from `step`. A SHA-256 of a low-entropy password in history or in a
receipt can be guessed offline.

Repair: put the frame type in-band, in a fixed header byte or a distinct
length-prefix range, or define the secret frame as the one reply to an
`unprotect` request that is never forwarded. Have the core refuse any part
whose type is `secret`, without digesting it, and test that the secret's
digest never appears in history or receipts.

### G5 — Low: the postgres.exe lock is released before later backends exec, and DLLs are not covered

Locator: note F3 "Hash-locked images"; design A6 backend parent.

On Windows, every backend is a fresh `CreateProcess` of `postgres_exec_path`
(`launch_backend.c` 409–488). The note releases the image handles when A6
finishes for start. The observer backend is created after that, and the
`backend-parent` frame carries PIDs and creation times only, with no image
hash. On reviewer knowledge, not verified from a primary source here, Windows
lets a running image be renamed while refusing overwrite or delete. So a
rename-and-replace after the lock is released would give the observer a
different image. Separately, pg_ctl and postgres load DLLs from `pg_bin`
(application directory first), which are neither hashed nor locked.

Repair: keep the `postgres.exe` handle until `disconnect`, or hash the backend
image in `backend-parent`. Either bind `pg_bin` to a directory an unprivileged
account cannot write (ACL evidence, like `native_helper_dir`), or record DLL
substitution as an accepted residual.

### G6 — Low: a detached helper outlives a supervisor crash

Locator: note F1.

Without libuv's kill-on-close job, a supervisor crash leaves `cw01-native`
running with its retained handles, and possibly in the middle of a 90 s launch
wait. The note says the supervisor waits for the helper to exit, but not what
the helper does when the supervisor disappears.

Repair: the helper treats EOF or a broken pipe on stdin as the end of the run.
It completes or abandons nothing further, issues no new subcommand, closes its
handles and exits. It never stops or kills the cluster. Record an orphaned
cluster from such a crash as a terminal state that needs Jordan's attention.
Add a test that closes stdin mid-run.

### G7 — Low: pg keeps the password string for the client's lifetime

Locator: note F5.

`client.js` 286 assigns `this.connectionParameters.password = this.password
= pass` after the function returns. So dropping the supervisor's own reference
does not make the string short-lived. Because pg replaces the function with the
string, `CREDENTIAL_REUSE_REFUSED` cannot be reached through pg. That is
harmless as defence in depth.

Repair: say that the string lives as long as the client, end the client right
after `sql_B`/`disconnect`, and never serialize or log the client or its
`connectionParameters`.

## Informational

- **I-a (F2).** `guc.c` `SelectConfigFiles` (1857–1877) uses
  `data_directory` from `postgresql.conf`, when it is set, in preference to
  `-D`. In that case line 2 differs from the derived literal and W1 fails
  closed (`PIDFILE_DIRECTORY_MISMATCH`). State that assumption next to the rule,
  and let the disposable-cluster test cover it.
- **I-b (F6).** Use an allowlist for the launcher environment, not just a
  `PG*` denylist. `NODE_PG_FORCE_NATIVE` (`pg/lib/index.js` 41) switches pg
  to `./native`. That fails closed today only because `pg-native` is not
  installed (no `pg-native` under `node_modules/.pnpm`). `NODE_OPTIONS` can
  inject code. Add `replication`, `binary` and `connect_timeout` to the
  resolved-parameter list, and give the expected value for each field (for
  example `options` and `client_encoding` undefined).
- **I-c (I-2).** Liveness at open time does not tie the PID to the snapshot
  entry. A PID can be reused between the snapshot and the open. What makes this
  safe is the v4 creation-time ordering (`checkProcessChain`, and
  `backendParent`'s `SQL_PARENT_PID_REUSE`). Word I-2 that way.
- **I-d (I-1).** If another account's PostgreSQL service is running, a standard
  user's limited query may fail, so preflight would always be `unavailable`.
  That fails closed, but it is worth knowing before a run is planned.
- **I-e (F5).** If HBA allows `trust` for the observer, the password function
  never runs, and the "called once" test would fail. The startup-boundary asset
  should pin the observer's HBA method.
- **I-f (I-5).** Rust's `std::io::stdout()` writes through an internal buffer
  that is never zeroed. Write the secret frame with a direct `WriteFile` on the
  raw handle, or record the residual.

## Carried items

| Item | Disposition |
| --- | --- |
| R1 / R2 / R3 | Unchanged from the first review. R2 now also has I-2 and I-c. |
| I-C, getter | Not core properties until G1 and G3 are repaired. |
| N1 / N2 / N3 / N4 | N2 narrowed by F4. N3 improved by F3, residual G5. N4 kept, with the F2 literal. Native parity still blocking. |
| Collector L1 / L4 | Pending. `leases` unbound, so preflight blocks. |
| 120 s bound | Confirmed by Jordan. Unchanged. |
| M3 | Not reopened. |

## Status of authority

This review is repository-only. It grants no implementation, Windows API call,
registry, pidfile or process read, credential use, SQL, cluster start or stop,
launch, sign-in or native-session authority. It does not record or request
Jordan's attestation, and it fills no manifest binding or grant.

## Next eligible prompt (bounded)

"Write a repository-only v1.2 note to the CW-01 operational adapter design that
answers G1–G7 and I-a to I-f of
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_REVIEW_2026-10-26.md`.
Keep the design, the v1.1 note and every input byte-unchanged. No code, tests,
helper build, operational reads, SQL, credentials, launch or sign-in. Then
request an independent re-review in a separate thread."

Jordan's priority is still a usable, polished app. This chain only matters for
native acceptance.
