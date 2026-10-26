# CW-01 operational adapter design v1.3 note independent re-review — October 26, 2026

Prompt: U02 (independent re-review), repository-only. Reviewed document:
`docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_3_NOTE_2026-10-26.md`
(`e8e553b2…1bb6`), at commit `ed7ae24` on branch
`claude/project-thread-7gwqdm` (PR #47). Read with the unchanged design
(`97258c08…031e`), the v1.1 note (`0c314c1c…c02e`), the v1.2 note
(`a3d64af4…0c8a`), the three reviews (`3cbfe9cf…4c3f`, `48ee4835…74de`,
`eb2a46a0…1577`) and their receipts.

## Verdicts

- **Design support: SUPPORTED WITH CONDITIONS.** J2, J3, J4, J5, J6, J8 and J9
  are resolved. J1 is resolved as a design finding: the name, the mechanism,
  the challenge and the residual are now correct and honest, and the residual
  is marked pending. J7 is only **partly resolved**: the reworded claim is still
  too strong for the undertaking's age and the pre-stop age (Low K3). The note
  adds two other Low gaps (K1, K2) and some informational points. No High or
  Medium finding. Nothing in the note widens authority.
- **Significant issues remain: no.** No Medium or higher finding is open. One
  owner decision is open and blocking: whether Jordan's accepted G2 limit also
  covers the wider J1 scope (any console host, including an agent's terminal
  tool). That is pending Jordan's answer, and this review does not treat it as
  decided. Until he confirms, operational runs stay blocked, as the note says.
- **Implementation readiness: NOT STARTED.** No helper, no v5, no tests. This
  review authorizes none of them.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
  full C54 partial, and the workspace-ID alternative disabled. Reader N1–N4
  native parity, collector L1/L4, real bindings (now including
  `supervisor_module_sha256` and `console_collector_sha256`), all grants, the
  J1 scope confirmation, Jordan's undertaking and the W2 comparison are still
  missing.
- **120 s bound:** confirmed by Jordan and unchanged.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed or input files. The design, the three notes and the three earlier
reviews were written by other Claude threads. This is the **same model family
and not blinded**. No external review service.

Executed: checked that `HEAD` is `ed7ae24`. SHA-256 of the v1.3 note, the
design, the v1.1 and v1.2 notes, the three reviews and their receipts, the v4
core and tests, SQL asset v2, `secret.rs`, the collector template and its v1.1
note, the frozen implementation design's v1.1 note, and the installed `pg`
8.23.1 `client.js` and `connection-parameters.js`. All match the named values
and the v1.2 re-review receipt (hashes in this review's receipt). `git log`
shows each document was written in one commit only (design `25e39e4`; first
review and v1.1 note `34c45a2`; v1.1 review and v1.2 note `f406df6`; v1.2
review and v1.3 note `ed7ae24`), and each code input was last touched before
this PR (`1c0167f`, `acd000b`, `cf3a839`, `efe6627`). So the earlier documents
and inputs are byte-unchanged. The working tree differs from `HEAD` only in
`.codex/config.toml`, which is not an input.

Read the v4 core (`measured`, `checkAttestation`, `checkSqlA`, `checkSqlB`,
`deadlineOk`, every `HANDLERS` entry, `step`, `LIMITS`, `TERMINAL`), design
"Architecture", the v1.1 note F7 channel table and v5 additions, the v1.2 note
G1–G7, and `tracking/DECISIONS.md`. Fetched libuv `v1.x` `src/win/handle.c`
(`uv_guess_handle`, lines 31–56) and `src/win/tty.c` (`uv_tty_set_mode`, from
line 367), and the current ECMA-262 draft (ES2027) indexed-collections page
(23.2.3.38 `get %TypedArray%.prototype[%Symbol.toStringTag%]` and 23.2.5.1.2
`InitializeTypedArrayFromTypedArray`). Hashes are in the receipt.

Not re-fetched: PostgreSQL `REL_18_6` and Microsoft's pseudoconsole page. I
relied on the earlier receipts for them; no finding here depends on a new
reading. I did not execute any JavaScript to confirm J6; it rests on the
specification text. Not done: Windows API calls, registry, process, pidfile,
port or credential reads, SQL, cluster or app actions, launch, sign-in, builds,
tests, `pnpm` or Prettier, tracking edits, commits, and the retired OneDrive
checkout.

## Disposition of J1–J9

| Finding | State | Basis |
| --- | --- | --- |
| J1 console check (Medium) | **Resolved as a design finding; owner confirmation pending** | Renamed "interactive-console check" and the old phrase is withdrawn. The check moves to the supervisor with a stated exception. libuv `uv_guess_handle` returns `UV_TTY` only when `GetFileType` is `FILE_TYPE_CHAR` and `GetConsoleMode` succeeds (`handle.c` 41–47), so requiring both `isTTY` values is a correct reading of that mechanism. The challenge is described as "harder to automate, still not authentication". The residual now names pseudoconsole hosts, IDE panels and agent terminal tools, and the receipt sentence says the same. The rule that no agent may run, read or type it is labelled a rule, not a control. The residual is marked pending Jordan's confirmation, and runs stay blocked until then. The exception's wording is too narrow (Low K1). |
| J2 console fields (Low) | **Resolved; Info** | The typed fields plus the supplied fields cover everything v4 `checkAttestation` reads (lines 324–359): `operator_ref`, `scope`, `inspector_sha256`, `request_id`, `affirmed_at_ms`, and per item `affirmed`, `basis`, `source`, `date`, `uncertainty`. Supplying hash links and the time is not prefilling an answer. The operational provenance `owner_undertaking_console` is stated, `owner_affirmation` is refused, and v4's fixture rule is kept. The channel table now gives each channel's adapter hash and provenance, with module hashes bound at admission. See the Info list for three small gaps. |
| J3 part time order (Low) | **Resolved; Info** | `launch ≤ pidfile ≤ chain`, and the chain time feeds the 90 s outer deadline (v4 745–749) and `start_observed_at_ms` (772), which `checkSqlA` uses (535). So the deadline and "connection after ownership" now cover the whole observation. Stop uses `launch ≤ stopped` with the stopped time, as v4 already does (882–884). See the Info list. |
| J4 `sql_instance_unchanged` (Low) | **Resolved** | The helper may not send it (`EVIDENCE_SELF_LABELED`, v1.1 F7). The core derives it: reaching `stop_intent` requires `disconnected`, which requires `sql_B`, where `checkSqlB` refused any change of `server_started_at_ms` or `backend_pid` (617–622). Same pidfile start seconds plus same postmaster PID and creation time mean the same postmaster process, so the SQL instance cannot have changed without the derivation failing. No SQL is needed after `sql_B`, consistent with G7. |
| J5 `sql_deadline` schema (Low) | **Resolved** | One `supervisor` part with `at_ms`. v4's handler (907–911) only moves the run to terminal `sql_unknown`, so the assertion can only end the run. The run now has a terminal receipt and is not counted as orphaned. The same gap exists for other supervisor-ended runs (Low K2). |
| J6 brand check and copy (Low) | **Resolved; Info** | ECMA-262 23.2.3.38: the getter returns `undefined` when `this` is not an object or has no `[[TypedArrayName]]`, else that slot. A Proxy has no such slot, so it returns `undefined` without running any trap; a Node `Buffer` (a `Uint8Array` subclass) returns `'Uint8Array'`. 23.2.5.1.2: same element type takes `CloneArrayBuffer(sourceData, …)`, which allocates a new `%ArrayBuffer%` and copies; no `constructor` or `@@species` lookup. So the copy cannot be steered. See the Info list for throws and the getter being configurable. |
| J7 supervisor times (Low) | **Partly resolved; Low K3** | The reword is right that supervisor times are trusted-code assertions that order events, and that the 90 s deadlines and the 15 s job, autorun and preflight ages have a helper-measured end. But "every freshness bound is anchored to a helper-measured time … so a wrong supervisor time cannot make stale evidence pass" is still too strong (K3). |
| J8 frame type (Info) | **Resolved** | The type byte is the first byte of `bytes`; trusted modules build their parts with `0x01`; the core requires `0x01`; a non-`0x02` reply to `unprotect`, or a `0x02` frame elsewhere, is a protocol error and never reaches `step`. How that error ends the run is K2. |
| J9 durable writes and orphans (Info) | **Resolved; Info** | `fs.fsyncSync` of the request, each history entry and the state before any `launch`; the orphan is a new record naming the last persisted entry hash; old files unchanged; clearing an orphan carries the J1 caveat. |

## New findings

### K1 — Low: the stated console exception is narrower than what the supervisor actually calls

Locator: v1.3 J1 "Where it runs" and "Harder to automate"; design
"Architecture" ("It never calls a Windows API directly").

The note says the supervisor reads `isTTY` "and makes no other console or
Windows call". Two lines later it reads the challenge "in raw mode with echo
off". In Node that is `process.stdin.setRawMode(true)`, which libuv implements
with `SetConsoleMode` (`tty.c` 367–418). Printing the challenge and reading the
replies also go through libuv's console paths. So the exception as written is
false, even though the behaviour is fine. Repair: state the exception as "the
supervisor uses Node's `tty` API on its own standard input and output
(`isTTY`, `setRawMode`, reads and writes) and calls no other Windows API", and
restore the console mode on every exit path, including a failed challenge.

### K2 — Low: runs ended by the supervisor before a terminal event have no schema

Locator: v1.3 J1 (`UNDERTAKING_CHALLENGE_FAILED`), v1.2 G2
(`UNDERTAKING_NOT_INTERACTIVE`), v1.3 J8 and v1.2 G4 ("the supervisor ends the
run as unknown"), v1.2 G1 (`PARTS_SCHEMA_MISMATCH` refuses before any check).

J5 fixed this for `sql_deadline` only. The undertaking refusals happen after
`admit` and before `start_intent`, and a protocol error or a helper that dies
can happen in any state. None of these has an event or part schema, and v4's
`step` keeps the state on a refusal (`refuse()` at 974–982). So the run ends
with no terminal entry. After `start_intent`, the next start would treat it as
orphaned (G6), which fails closed but asks Jordan to clear something that was
in fact a known protocol error. Before `start_intent`, the run is left
non-terminal, and the note does not say whether that counts as an orphan.
Repair: add one supervisor event (for example `supervisor_abort`, one
`supervisor` part with `at_ms` and a code from a fixed list) that moves any
non-terminal state to `blocked` before `start_intent`, `start_unknown` from
`start_intent`, and `sql_unknown` or `stop_unknown` later, so each such run gets
a terminal receipt. Or state that these runs are deliberately left for the
orphan rule.

### K3 — Low: two freshness bounds still rest on supervisor-process times

Locator: v1.3 J7, second bullet.

- The 120 s undertaking bound measures `spawnMs − affirmed_at_ms` (v4 756–757).
  The note itself says `affirmed_at_ms` is a supervisor time. So the
  undertaking's age has a helper-measured end (pg_ctl creation) and a
  supervisor end. A late `affirmed_at_ms` makes an older undertaking look
  fresh. Its only other limits, `admitted_at_ms` and `start_intent.at_ms`
  (341–342), are supervisor times too.
- The 5 s pre-stop bound measures `spawnMs − sqlB.observed_at_ms` (875), and the
  `stop_intent` check uses `at_ms − sqlB.observed_at_ms` (822). `sqlB` comes from
  the SQL observer, which runs inside the supervisor and uses its clock. The
  table stamps it `operational_measurement`, but it is not helper-measured.

All of these are hash-bound trusted code, so the risk is a supervisor bug, not
an adversary. That is why this is Low. Repair: say "every freshness bound has
at least one helper-measured end; where the other end is a supervisor or
observer time, the bound relies on the hash-bound supervisor". Optionally take
`affirmed_at_ms` from a helper `now` reply at the final confirmation.

## Informational

- **J1, practical scope.** The residual is not hypothetical in this project. The
  Claude desktop app gives threads terminal tools that can read Jordan's
  terminal panel and run commands in it. A challenge printed in that panel is
  readable by such a tool. As an operating note (not a control), the run plan
  can say the undertaking step runs in a standalone console window that no
  agent tool hosts. `tracking/DECISIONS.md` still records the G2 limit as one
  that "shows human presence". When Jordan answers the J1 question, that entry
  should be superseded with the v1.3 wording.
- **J2.** (a) v4 requires `affirmed === true` and `item === i`; say that the
  collector maps the typed `yes` to `true` and numbers the items, and that both
  are encodings, not answers. (b) Say whether v5 requires
  `challenge_passed === true`, or drop the flag. (c) Typing the request ID
  confirms the request ID only; the three hashes are shown, not confirmed.
  That is fine, but the wording "Jordan confirms them" claims more.
- **J2 and v4 timing.** Typing 31 fields cannot fit inside the 15 s pre-spawn
  ages for preflight and job. State the order: admit, then the undertaking,
  then preflight, job, autorun, `start_intent` and spawn, all within 15 s, with
  spawn within 120 s of the final confirmation.
- **J3.** (a) Also require `launch.observed_at_ms ≥` the launch's exit time,
  which the old mapping checked and the new one no longer does. (b) Name the
  stop failure state for `PARTS_TIME_ORDER`; `stop_unknown` fits better than
  `ownership_unavailable` once the stop has launched.
- **J4.** The name `sql_instance_unchanged` suggests a SQL measurement. Record
  in history that the core derived it.
- **J6.** (a) `new Uint8Array(bytes)` throws a `TypeError` on a detached or
  out-of-bounds source (`ValidateTypedArrayBounds`); map any throw from the
  brand check or copy to `EVIDENCE_NOT_FRAME`. (b) The getter property is
  configurable, so taking it at module load only helps if nothing runs before
  the core loads. The v1.2 I-b allowlist environment (no `NODE_OPTIONS`) covers
  that; say so.
- **J9.** Node cannot `fsync` a directory on Windows, so a new file's directory
  entry is not guaranteed by `fs.fsyncSync` alone. After a crash, a missing
  evidence directory would hide the orphan. The next run's preflight still
  refuses a running cluster (`PREEXISTING_CLUSTER_NO_ADOPTION`), so this fails
  closed. Note it as the backstop.

## Carried items

| Item | Disposition |
| --- | --- |
| R1 / R2 / R3 | Unchanged. |
| I-C, getter | Core properties after G1, G3 and J6. |
| N1 / N2 / N3 / N4 | Native parity still blocking. |
| Collector L1 / L4 | Pending. `leases` unbound, so preflight blocks. |
| G2 / J1 residual | Accepted by Jordan on the v1.2 wording. Confirmation that it covers the v1.3 scope is **pending**; operational runs stay blocked. |
| 120 s bound | Confirmed by Jordan. Unchanged. |
| M3 | Not reopened. |

## Status of authority

This review is repository-only. It grants no implementation, helper build,
Windows API call, registry, pidfile or process read, credential use, SQL,
cluster start or stop, launch, sign-in or native-session authority. It does not
record or request Jordan's undertaking or decide anything for Jordan, and it
fills no manifest binding or grant.

## Next eligible prompt (bounded)

No Medium or higher finding remains, so another fix/review round is optional.
Either:

- "Write a short repository-only v1.4 note to the CW-01 operational adapter
  design that answers K1–K3 of
  `docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_3_REVIEW_2026-10-26.md`
  and, at the author's discretion, the informational items. Keep every earlier
  document and input byte-unchanged. No code, tests, helper build, operational
  reads, SQL, credentials, launch or sign-in."; or
- carry K1–K3 as conditions into the v5 implementation design.

Either way, Jordan's answer on the J1 scope is needed before any operational
run. Jordan's priority is still a usable, polished app; this chain only matters
for native acceptance.
