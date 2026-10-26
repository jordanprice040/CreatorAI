# CW-01 operational adapter design v1.3 note — October 26, 2026

Status: repository-only additive note. It answers the
[v1.2 re-review](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_REVIEW_2026-10-26.md)
(`eb2a46a0…1577`). The author is the Claude thread that wrote the design and the
earlier notes. It is **not reviewed**: a fresh thread reviews it next. Read it
with the [design](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_2026-10-26.md)
(`97258c08…031e`), the
[v1.1 note](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_NOTE_2026-10-26.md)
(`0c314c1c…c02e`) and the
[v1.2 note](THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_NOTE_2026-10-26.md)
(`a3d64af4…0c8a`). All three are unchanged. Only the contracts named below
replace earlier text.

Nothing was implemented, built, tested, read from the operating system or
executed. Operational/native readiness is **NOT READY (blocked)**. M3 is
unchanged and not reopened. Original A0 is blocked, NI not-run, H unverified,
full C54 partial, and the workspace-ID alternative is disabled. The 120 s bound
is unchanged.

## J1 (Medium): an interactive-console check, run by the supervisor, with an honest residual

Replaces v1.2 G2 "How the undertaking is produced" and "What the label means".

- **Name.** The check is an **interactive-console check**. It is not a
  human-presence check, and the design no longer uses that phrase.
- **Where it runs.** The supervisor runs it, not the helper. The detached helper
  has no console. This is a stated exception to "the supervisor never calls a
  Windows API directly": the supervisor reads Node's `process.stdin.isTTY` and
  `process.stdout.isTTY`, which libuv answers with `GetConsoleMode`. Both must be
  `true`, otherwise `UNDERTAKING_NOT_INTERACTIVE`. The supervisor makes no other
  console or Windows call.
- **Harder to automate, still not authentication.** After admission, the
  supervisor generates a per-run challenge of 8 characters from
  `crypto.randomInt` over an unambiguous alphabet. It prints the challenge only
  to the console, never to a log, receipt or file, and reads the reply in raw
  mode with echo off. The typed challenge must match before any item is
  accepted. A wrong challenge ends collection for this run
  (`UNDERTAKING_CHALLENGE_FAILED`); there is no retry. The challenge is not
  stored; the record keeps only a `challenge_passed: true` flag.
- **Residual, restated.** Any process that can host or drive a console can pass
  this check and type the answers. That includes a pseudoconsole (ConPTY) host
  such as an IDE terminal panel or an agent's terminal tool, as well as anyone
  or anything at the keyboard. The author is not authenticated. Every
  operational receipt states: "Undertaking collected through an interactive
  console. Any console host, including an agent's terminal tool, could have
  supplied it. The author is not authenticated."
- **Rule for agents.** No model or agent may run the supervisor's undertaking
  step, read the challenge, or type the undertaking. This is a rule, not a
  technical control. It does not change what the check can prove.
- **Jordan's acceptance.** Jordan accepted the v1.2 wording ("an agent driving
  the desktop, or anyone at the keyboard"). Jordan has been asked whether the
  acceptance also covers this wider scope. Until Jordan confirms, the residual
  is **pending Jordan's confirmation**, and operational runs stay blocked on it.

## J2 (Low): the fields the console collects, and the provenance v5 accepts

Replaces the v1.2 G2 sentence "Jordan types the request ID and answers each
item with `yes` plus a short basis".

- **Typed at the console:** `operator_ref` (once), and for each of the six items
  `affirmed` (the word `yes`; anything else ends collection), `basis`, `source`,
  `date` (`YYYY-MM-DD`) and `uncertainty`. An empty field is refused. "No known
  uncertainty" must be typed out, for example `none`, so it is not defaulted.
- **Supplied by the supervisor:** `scope` (the constant `W1-W3`),
  `request_id`, `inspector_sha256`, `manifest_sha256`, `collector_record_sha256`
  and `affirmed_at_ms`. The supervisor shows the four identifiers before the
  items, and Jordan confirms them by typing the request ID, which must match.
  `affirmed_at_ms` is the supervisor's time at the final confirmation. These
  are hash links and a timestamp. They are not answers, so supplying them is not
  prefilling.
- **v5 check.** In operational mode, `checkAttestation` accepts provenance
  `owner_undertaking_console` (stamped by the core from the channel) and refuses
  `owner_affirmation`. In fixture mode it keeps v4's rule. All of v4's field
  checks stay. The code list adds `UNDERTAKING_CHALLENGE_FAILED`.
- **Channel table** (extends v1.1 F7):

  | Channel             | Adapter hash covers                                                           | Provenance                  |
  | ------------------- | ----------------------------------------------------------------------------- | --------------------------- |
  | `helper`            | The helper image                                                              | `operational_measurement`   |
  | `sql_observer`      | The observer module file plus the SQL asset                                   | `operational_measurement`   |
  | `supervisor`        | The supervisor module file                                                    | `supervisor_assertion`      |
  | `owner_bindings`    | The collector template's hash; the record's own SHA-256 is recorded alongside | `owner_produced`            |
  | `owner_undertaking` | The console-collector module file                                             | `owner_undertaking_console` |

  Each module hash is a manifest binding (`supervisor_module_sha256`,
  `observer_module_sha256`, `console_collector_sha256`), checked at admission
  against the files the supervisor loaded.

## J3 (Low): take the ownership time from the chain observation

Replaces the `start_outcome` row's `observed_at_ms` mapping in v1.2 G1.

- The three parts must be ordered: `launch.observed_at_ms ≤
pidfile.observed_at_ms ≤ chain.observed_at_ms`. Otherwise
  `PARTS_TIME_ORDER` → `ownership_unavailable`.
- The evidence `observed_at_ms` used for the 90 s outer deadline and stored as
  `start_observed_at_ms` is the **chain** part's time. So the deadline covers the
  whole ownership observation, and `checkSqlA`'s "connection after ownership"
  rule compares against it.
- The stop outcome uses the same rule: `launch ≤ stopped`, with the `stopped`
  part's time used for the stop deadline.

## J4 (Low): the core derives `sql_instance_unchanged`

Replaces the v1.2 G1 mapping of the whole `revalidation` from the helper.

- The helper's `revalidate` part must not contain `sql_instance_unchanged`
  (`EVIDENCE_SELF_LABELED` if it does).
- The core sets it to `true` only when all of the following hold:
  - the run reached `sql_B`, so `checkSqlB` already refused any change of
    `server_started_at_ms` or `backend_pid` between A and B;
  - the revalidation's pidfile start seconds equal `ctx.pidfile.start_s`;
  - the revalidation's postmaster PID and creation time equal
    `ctx.postmaster`.

  Otherwise it is `false`, and v4 refuses the stop. No SQL runs after `sql_B`,
  and none is needed.

## J5 (Low): a part schema for `sql_deadline`

Adds a row to the v1.2 G1 table.

- `sql_deadline`: exactly one `supervisor` part carrying `at_ms`. It can only
  move the run from `candidate_process_bound`, `sql_A` or `sql_B` to terminal
  `sql_unknown`, as in v4. So a run that hits the SQL deadline reaches a
  terminal receipt and is not later counted as orphaned.

## J6 (Low): brand check and a species-free copy

Replaces the v1.2 G3 copy rule.

- Brand check: the core reads the `%TypedArray%.prototype[Symbol.toStringTag]`
  getter (taken once at module load from
  `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get`)
  and calls it on `bytes`. It must return `'Uint8Array'`. The getter reads the
  internal slot, so it returns `'Uint8Array'` for a Node `Buffer` and
  `undefined` for a Proxy or any non-typed-array, whatever own properties the
  object has. Otherwise `EVIDENCE_NOT_FRAME`.
- Copy: `new Uint8Array(bytes)`. For a real typed array this allocates a fresh
  `ArrayBuffer` and copies the elements without consulting `constructor` or
  `@@species`. A Proxy never reaches this line, because the brand check refused
  it.
- The core parses and digests only that copy.

## J7 (Low): what supervisor times are

Replaces v1.2 G1's sentence "A supervisor time can only make a check stricter".

- Supervisor times (`admit`, `start_intent`, `stop_intent`, `sql_deadline`
  `at_ms`, and the undertaking's `affirmed_at_ms`) are assertions by
  hash-bound supervisor code. They order events. An early or late value can
  loosen one side of an ordering check.
- Every **freshness** bound is anchored to a helper-measured time: the 120 s
  bound and the 15 s pre-spawn ages to pg_ctl's measured creation time, the 5 s
  pre-stop bound to the stop pg_ctl's creation, and the 90 s deadlines to the
  chain and stopped observations (J3). So a wrong supervisor time cannot make
  stale evidence pass a freshness bound.
- `Date.now()` and `GetSystemTimePreciseAsFileTime` round separately. A 1 ms
  inversion can cause a refusal. That fails closed; the disposable-cluster test
  will show whether it matters in practice.

## Informational items

- **J8 (G4).** Every part's `bytes` begins with the frame type byte. Helper parts
  are the helper's frame payload with its type byte. Supervisor, observer and
  owner parts are built with type `0x01` by their trusted modules. The core
  requires `0x01` and parses the rest. A reply to `unprotect` that is not type
  `0x02`, or a `0x02` frame at any other time, is a protocol error. The
  supervisor ends the run as unknown and never forwards that frame to `step`.
- **J9 (G6).** The supervisor writes the request, each history entry and the
  current state to the run's evidence directory with a flush to disk
  (`fs.fsyncSync`) before it sends the helper any `launch` request. An orphan is
  recorded as a **new** record that names the last persisted entry hash. The old
  run's files are not changed. Clearing an orphan needs Jordan's decision,
  which carries the same "not authenticated" caveat as J1 when it is collected at
  the console.

## Updated v5 additions

New codes: `UNDERTAKING_CHALLENGE_FAILED` and `PARTS_TIME_ORDER`. New bindings:
`supervisor_module_sha256` and `console_collector_sha256`
(`observer_module_sha256` was added in v1.1). All values stay **pending**.

Open for Jordan: confirm that the accepted G2 limit also covers the wider J1
scope (any console host, including an agent's terminal tool).

## Status of authority

Repository-only. This note grants no implementation, helper build, Windows API
call, registry, pidfile or process read, credential use, SQL, cluster start or
stop, launch, sign-in or native-session authority. It fills no binding or grant
and does not record or request the undertaking. M3 is not reopened.

Next eligible: an independent repository-only re-review of this note in a fresh
thread, against the design, the v1.1 and v1.2 notes, all three reviews and their
receipts, the v4 core and tests, SQL asset v2, `secret.rs` and the cited
sources. Report design support separately from implementation and operational
readiness.
