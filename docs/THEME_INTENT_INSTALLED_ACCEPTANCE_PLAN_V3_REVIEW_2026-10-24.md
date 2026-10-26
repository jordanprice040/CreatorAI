# Exact checklist v3 and observation proposal independent review — October 24, 2026

Verdict: **partial support for the M2 correction and the observation boundaries;
blocked for execution**. Checklist v3 is **not executable**. The proposed PR-01/SH-01
inspector contract is **not executable** (not implemented, required bindings have no
identified reviewed source, no operational scope). The native acceptance session is
**not executable**. This review grants no owner authority, is not Jordan's human
acceptance and does not establish full C54 completion.

## Reviewer provenance

Claude (Anthropic), in a project thread opened for this review on Jordan's request
on 2026-10-24, reading `C:\dev\creator_agent` through the approved device folder.
This thread did not prepare checklist v3, the observation proposal, the v2 checklist,
the exact-v2 review, the v4 helper or the package. The v3 receipt records that a
Codex conversation that reviewed v2 later prepared v3 and the proposal.

Lineage disclosures. A different Claude thread wrote the original v1 checklist review
(A0–A13) that v3 incorporates, and Claude threads reviewed helper v2/v3/v4. This
thread has none of their conversation context, but the same model family reviewed
earlier inputs. This is a separate-session review, not a blinded review and not a
different-model-family review.

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| Candidate (bound) | `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc` |
| Installation plan (bound) | `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1` |
| Checklist v3 | `4cf78a08e342255c9a741e787d083c76b31a9641ef5fd296871bd6ce7ae794db` |
| Observation proposal | `6e4f3a55084fbab79ddf8aebaa552031c41039208b76fabd58750b548ea317b7` |
| v3 revision receipt | `c74048b0ed7ac8fc02339b607d3e336272d4476cdecd7be3b860adcc82f3a504` |
| v3 verify.mjs | `7d45642d99421cc65e786da804d437cdabc21c471283727a47c8699b735888f6` |
| Frozen v2 | `754a9873965c6d223fae3126d6d1b8cf8fbddb913190d9c93c7543615e67c592` |
| Exact-v2 review report | `e7e7b3a501ec0f06a1a7a554c251f19ebb8a3cf7336800c7fc90da47f1e06902` |
| Exact-v2 reviewer receipt | `f6d37271a3bee96d7941c4cf70e96e4a61831221e8622f793a50f92ea4e571d2` |

The complete exact-input map is in
`tracking/evidence/theme-intent-acceptance-v3-review-2026-10-24/reviewer-receipt.json`.

## Checks actually executed (repository-only, read-only)

- Rehashed every `input_sha256` entry of the v3 revision receipt (204), the exact-v2
  reviewer receipt (200) and the readiness assessment receipt (183): 0 mismatches,
  0 missing. Rehashed the v4 helper review's `helper_sha256` (145) and
  `artifact_sha256` (32) maps: 0 mismatches. Rehashed the package review's
  `artifact_sha256` map (424 repository paths): 0 mismatches. All 265
  `source_sha256` entries of `theme-intent-package-2026-10-23/candidate-plan.json`
  still match the working tree.
- Confirmed frozen v2 hash, all NI-00–NI-10 identifiers in v3 and the removal of
  NI-04's "wait for control stopped" expectation (by reading v3, not by running its
  verifier). **The v3 `verify.mjs` was not run**: it rewrites
  `revision-receipt.json` with a new `recorded_at` on every run (see L6).
- Source inspection with locators below. Paths embedded in receipts (installed
  program, app home, backups) were not followed; only repository files were read.
- No application launch, sign-in, helper/installer/migration, SQL, credential or
  DPAPI access, registry/shortcut/process/port inspection, `studio.json` read,
  provider call, workflow activation, acceptance write, recovery, cleanup or retired
  checkout access. No tests were run; this is a document/source/receipt review.

## Findings by severity

**B1 (blocking, retained) — M1 live scheduling and prelaunch continuity.** No
already reviewed and authorized prelaunch path resolves the gate. Repository
inventory found no reviewed inspector, no implemented startup-admission mode and no
operational scope covering a scheduling observation. Health reads require a running
service and are too late (v3 and proposal correctly say so). The blocker stands;
this review does not authorize launching to inspect scheduling, nor weaken the stop
rule. Note also that scheduler-off would not imply no dispatch: the in-process
workflow worker starts unconditionally in the installed path
(`apps/api/src/index.ts:400`, `:468`; no `CREATOR_WORKER` key in
`apps/api/src/studio.ts:528-538`).

**M3 — The scheduling stop rule, as worded, cannot be met by any prelaunch
observation; the next step is an owner decision on what it requires.** v3 asks for
an observed live scheduler state before first launch, but no process exists before
launch, so only (a) a configuration claim bound to installed bytes or (b) a
candidate-changing startup control can ever close it prelaunch. Evidence for (a) is
stronger than "source defaults": the supported package review's artifact map binds
`.verification/theme-intent-artifacts-2026-10-23/studio/service/app/dist/studio.mjs`
= `9d5ddac3…1da88` (identical to both repository bundle copies). In that bundle,
`createApi` receives an object literal with no scheduler key (`studio.mjs:55715-55722`)
and the scheduler defaults to off (`studio.mjs:54654`); `createApi` defaults its env
to `{}` and `index.ts` reads no `process.env` (`index.ts:210-211`, `:363`). So, for
those exact bytes, no environment or configuration file can turn the portfolio
scheduler on, independent of the native `env_clear` (`studio.rs:316`, which is not in
the candidate source map). This remains static analysis of reviewed bytes plus a
historical installed-identity check; it is not live observation and does not
establish continuity. Whether "configuration fixed by reviewed installed bytes, with a
fresh PR-01 identity rehash" satisfies the gate is Jordan's decision, recorded
explicitly. It would change the gate's evidentiary standard, so a reviewer cannot
grant it. Without that decision, option (b) is the only route.

**M4 — PR-01/SH-01 bindings have no identified reviewed source.** The proposal
requires an exact app home, the managed cluster directory, the configured database
port, the `pg_ctl` path and lease locations, resolved "from already reviewed plan
identities", and forbids reading `studio.json`. No repository receipt records the
database port, `pg_bin` or home root. The run-01 receipts and the installation
completion receipt carry only `data_relative_path: postgres/data`, counts and
hashes. The port is chosen per install (`postgres.rs` `choose_port`), and `pg_bin`
comes from the saved configuration (`home.rs:25-27`). The studio ports 5173/4310/4320
are constants in reviewed source (`apps/api/src/studio.ts:32`) and are bindable.
Until each remaining value has a named, reviewed, non-secret source (for example
recorded by Jordan in the scope decision, or emitted by a reviewed reader that outputs
only that field), the contract cannot be implemented as written. Do not widen access
to fill the gap.

**M5 — Launch-at-login is outside PR-01 and R, so continuity rests on an attestation
that can miss a quiet launch.** Setup or Settings can register
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value `Creator Agent Studio` =
`"<exe>" --at-login` (`winsys.rs:94-124`; `studio.rs:1110-1114`, `:1127-1135`). An
at-login start sets `quiet_start` (`studio.rs:193`) and starts the database, service
and worker without showing the control window (`studio.rs:452-458`). Owner decision 3
(`tracking/OWNER_DECISIONS_2026-10-20.md:34`) says off initially, but the installed
value is unobserved. Add an exact single-value presence read (boolean only, no command
text) to PR-01. If it is present, treat every Windows sign-in since the historical
shutdown as an unattested launch. Settings changes remain outside session scope.

**L1 — Quit during startup can leave the cluster running (source inspection, not
reproduced).** `start_blocking` checks `quitting` only on entry (`studio.rs:452-454`);
`database_url` stores the cluster after `quit` may already have taken `None`
(`studio.rs:405-418`, `:885-891`), so the app can exit with PostgreSQL up. SH-01
would correctly fail. v3 should allow Quit only from a recorded `running` state and
classify any other Quit as unplanned, needing SH-01.

**L2 — Lease scope.** The v4 review's L2 says v4 ignores v2/v3 locks. PR-01/SH-01
"helper lease" should name every versioned theme-intent lease/mutex identity (v2–v4),
not only v4.

**L3 — SH-01 deadline outcome.** `pg_ctl stop -m fast -w -t 60` can time out while
PostgreSQL keeps shutting down (`postgres.rs:180-205`), so a 90-second SH-01 can
report unknown and the cluster stops later. v3 correctly forbids retrying Quit,
killing processes or recovery. It should state whether a later, separately scoped,
non-mutating SH-01 re-observation may clear the relaunch block, so testers do not
improvise.

**L4 — Window closing.** Closing the control window is Quit (`main.rs:52-67`).
Closing the studio window either backgrounds or quits, depending on saved
`close_behavior` (`main.rs:117-135`). Owner decision 2 makes background the default.
v3 should say that closing a window is not the NI-04/final Quit step, and that an
accidental Quit needs SH-01 and an incident note.

**L5 — Layered document.** v3 keeps superseded v2 prose ("Proposed helper … pending",
"Next eligible task: independent review of this exact v2 checklist") and overrides it
in a final section. The override is explicit, so this is not a correctness defect,
but a tester could follow stale lines. Fold the reconciliation into the body in the
next revision.

**L6 — Non-idempotent verifier.** `theme-intent-acceptance-plan-v3-2026-10-24/verify.mjs`
overwrites its own receipt with a fresh timestamp and hashes itself into it, so a
re-run silently replaces evidence. Prefer a check-only mode that compares and never
writes.

## Assessment of the requested questions

1. **M2 correction (supported).** `quit` sets `stopping`, stops the child (20 s grace,
   then kill), attempts `pg_ctl stop`, logs any error, then calls `app.exit(0)`
   (`studio.rs:666-692`, `:865-893`). There is no final stopped state, and a
   cluster-stop error still exits. v3 now records Quit requested, stopping if
   actually seen, and exit if seen. It forbids fabricated screenshots and inferring
   shutdown from exit, requires a passing SH-01 before relaunch and after final Quit,
   and blocks on unknown results with no retry, kill or recovery. NI-04 design:
   **supported**. Execution: **blocked** (SH-01 not implemented or scoped). Final-Quit
   SH-01: **supported** design. Treating an unknown final result as no passing
   acceptance and no normal-use handoff is conservative and consistent.
2. **PR-01/SH-01 bounds: partial.** Supported: exact-path allowlists; refusal of
   symlinks, reparse points and ambiguity; status-3 versus error distinction;
   unavailable is never treated as stopped; booleans and counts only; no SQL,
   connection, secrets, `studio.json`, command-line dump or log contents; exclusive
   new evidence directory; two samples 1 s apart within 15 s for PR-01; a 90-second,
   1 Hz SH-01 window that covers the 20 s + 60 s native bounds; restart invalidates
   a prior pass; and no launch. Gaps: M4 bindings, M5 Run value, L2 lease versions,
   L3 re-observation. Process attribution by exact image path under the installed
   program, with ambiguity stopping, is adequate in principle. The concrete
   allowlist (desktop exe, bundled node, the managed PostgreSQL binaries) must be
   written into the implementation scope.
3. **Observation sufficiency (supported as limited).** The proposal and v3 restrict
   claims correctly: PR-01 supports current identity and stopped-state plus a labelled
   attestation, and SH-01 is point-in-time. Neither is labelled live-scheduler-off,
   continuous quiescence or zero dispatch. NI-10 keeps whole-database equality and
   exhaustive zero dispatch explicitly unverified.
4. **M1 (blocked, retained).** See B1 and M3. Source-derived defaults are not live
   observation. No already reviewed or authorized prelaunch path was found.
5. **Startup-control option (correctly labelled).** It is a proposed design only.
   No ADR exists, nothing is implemented, it would change the candidate (new
   packaging, review and installation decision), and it carries no operational
   authorization. The proposal states all four. Its draft requirements (refuse
   before actor ensures, sweeps, outbox, worker, scheduler and listening; explicit
   owner selection; external-worker admission; negative/restart/fallback tests in a
   disposable environment) are a sound starting point. They are not reviewed here as
   an implementation.
6. **Gates.** See the table below.
7. **Historical installation versus continuity (supported).** Actual NSIS `/S /NS`
   exit 0, migration 28→29, schema29 observed at 12:34:49.022Z before verification
   and launch, preservation, and a stopped host check at 12:35:23Z are receipt-backed
   and rehash cleanly. No evidence warrants repeating preparation, backup,
   installation or migration. Current continuity since 12:35:23Z is unobserved (B1,
   M5).

## Per-gate verdicts

All native cases remain **not-run**. "Supported" means the planned observation
matches inspected source or receipts, not a native pass. NI-02/03/05–09 UI-behavior
verdicts carry the exact-v2 review's source analysis. Their UI inputs
(`theme-intent.tsx`, `submit.tsx`, `catalog.tsx`, `activity.tsx`, `budgets.tsx`,
`operations.tsx`) are byte-identical to that review. This review did not
independently re-derive UI logic beyond that check.

| Gate | Verdict |
| --- | --- |
| A0 historical schema29/pre-UI preservation | Supported (receipts rehashed) |
| A0 current continuity to first launch | Blocked (B1, M5; attestation only) |
| Scheduling stop rule | Blocked (B1); owner decision needed on standard (M3) |
| I-01 installation | Supported, historical |
| R-01/R-02 | Unverified; separate scope supported. Recommend Run value via PR-01 (M5) |
| PR-01 contract | Partial (M4, M5, L2) |
| SH-01 contract | Partial (M4, L2, L3) |
| NI-00 | Supported design; blocked by B1 |
| NI-01 | Partial: existing workspace ID and current owner/editor role pending Jordan; local sign-in only |
| NI-02, NI-03 | Supported design (carried) |
| NI-04 | Supported design after M2 correction; blocked on SH-01 |
| NI-05 – NI-09 | Supported design (carried) |
| NI-10 | Partial by design: UI-only, explicit unverified limits |
| Final Quit + SH-01 | Supported design; blocked on SH-01 |
| Bounded local auth and launches | Supported design; decision pending (initial launch, NI-04 relaunch, final Quit) |
| A v1→v2 / B v1, retain by default | Supported; no archive/delete path |
| Startup-control option | Correctly labelled proposal; not accepted, implemented or authorized |
| H | Unverified; Jordan's own dated statement only |

## Limitations

No operational observation was made, so current installed identity, cluster state,
listeners, processes, leases and the Run value are unknown. The source-to-native
link for `studio.rs` is not in the candidate source map. Native behavior claims
(M2, L1, L4, M5) come from repository source, not executed binaries. UI case verdicts
are carried. The package review's 424 artifacts were rehashed in the repository
verification folder, not the installed copy.

## Precise next eligible prompt

> Jordan decides the M1 evidentiary standard in writing: either (a) for this UI-only
> session, accept "portfolio scheduler configuration fixed by the reviewed bundle
> `studio.mjs` 9d5ddac3…, confirmed by a fresh PR-01 installed-identity rehash" as
> satisfying the scheduling-configuration gate, never labelled live observation, with
> the worker-on and continuity limits unchanged; or (b) select a candidate-changing
> startup-admission implementation. Then, preserving frozen v2, v3, the proposal,
> helper/package bytes and history, prepare checklist v4 and proposal v2. They should
> resolve M4 (a named, reviewed, non-secret source for the home root, database port,
> pg_ctl path and lease identities, without reading studio.json), M5 (an exact
> launch-at-login value presence read in PR-01), L1–L5, and a check-only verifier
> (L6). Then commission a separate uninvolved exact review. No inspector
> implementation, operational read, launch or acceptance session until those reviews
> pass and Jordan grants a concrete scope.
