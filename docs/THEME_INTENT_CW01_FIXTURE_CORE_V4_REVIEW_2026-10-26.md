# CW-01 fixture core v4 repair independent re-review — October 26, 2026

Prompt: U02 (independent review), repository-only, per the re-review prompt at the
end of `docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REPAIR_2026-10-26.md`
(`979e0722…4f14`) and its receipt `repair-receipt.json` (`185416f1…a0e9`). The
repair answers `docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md`
(`04bc626f…dc55`). Reviewed code: core
`scripts/theme-intent-cw01-core-fixture-v4.mjs` (`ce3c4ad7…07bb`) and tests
`tests/theme-intent-cw01-core-fixture-v4.test.mjs` (`666ce597…7149`).

## Verdicts

- **Fixture core v4 and tests: SUPPORTED as a fixture-only slice.** L-1, I-1 and
  I-2 are fixed. I found no false pass and no regression against v3. There are no
  new Low or higher findings; three informational notes are below.
- **v1–v3 files, SQL asset and frozen inputs: byte-unchanged.** All 43 preserved
  hashes and the 5 new-file hashes in the repair receipt match (48/48).
- **120 s attestation bound: still needs Jordan's confirmation.** The code is
  unchanged on this point, and this review does not treat it as confirmed. The
  v3 re-review's reasoning stands: acceptable as a ceiling, and 30–60 s would
  also work if affirmation is the last human step before start.
- **Fixture-to-operational promotion: none.** `admitOperationalGate` never
  admits and refuses receipt formats `/1` to `/4`.
- **Operational/native readiness: NOT READY (blocked), unchanged.** M3 is
  unchanged and not reopened. Original A0/native acceptance is blocked, NI
  not-run, H unverified, full C54 partial, and the workspace-ID alternative is
  disabled.

## Reviewer, involvement and limitations

Reviewer: Claude (Anthropic model family), in a separate Creator Agent project
thread on Jordan's device folder `C:\dev\creator_agent`. I wrote none of the
reviewed files. Another Claude session wrote the v1 review and the v2, v3 and v4
repairs; earlier Claude sessions wrote the v2 and v3 re-reviews. This is the
same model family and was not blinded. No external review service.

Executed (Node 22.21.0): SHA-256 hashing of every file bound in the repair
receipt; `node --test tests/theme-intent-cw01-core-fixture-v4.test.mjs`; the
recorded v4 mutation check, run from a copy in my session scratch directory so
its work copies stayed outside the repository; and reviewer-only probes and six
extra mutants, all on scratch copies. The scripts and outputs are saved in
`tracking/evidence/theme-intent-cw01-fixture-core-v4-review-2026-10-26/`. Not
done: SQL, credentials, operational config/environment/registry/process/port/
object/pidfile reads, cluster/app actions, launch, sign-in, `pnpm` scripts,
Prettier, unrelated tests or verifiers, and the retired OneDrive checkout.

## Binding and execution checks

- New files: the core, tests, `tests-final.tap`, `mutation-check.mjs` and
  `mutation-results.json` all match the receipt.
- Preserved: v1–v3 cores and tests, their TAP and mutation evidence, the SQL
  asset (`074561c3…89b2`), every earlier CW-01 report, review and receipt, the
  design chain and its snapshots, AGENTS.md, PROJECT_CONTEXT.md,
  PROMPT_LIBRARY.md and the collector/current-work design documents. 0
  mismatches.
- `tracking/BUILD_STATUS.md` and `tracking/SESSION_HANDOFF.md` matched the
  receipt's `after` hashes before my edit.
- Tests: **26 tests, 26 pass, 0 fail** (`tests-rerun.tap`).
- Mutation check: baseline pass, **33/33 killed**. My output is byte-identical
  to the recorded `mutation-results.json` (`b74a3ab3…156c`).
- The code diff from v3 is narrow: version strings, `/3` added to the prior
  formats, the two handler `snapshot(e)` calls replaced by `e`, and `step` now
  copying its input once into `evidence` before anything else. Nothing else
  changed.

## L-1 — fixed

- `step` calls `snapshot(evidenceInput)` first. The same deep-frozen copy goes
  to the handler, to every history digest (accepted, terminal and refused
  entries) and into `ctx`. Probes confirm that `digest(ctx.sqlA)` and
  `digest(ctx.sqlB)` equal their history entries' `input_sha256`.
- The new test pins both directions: an A whose `toJSON` shifts its times is
  judged and stored as the shifted copy, with a matching digest, and a B whose
  `toJSON` hides a stale time is refused `STALE_B_EVIDENCE`.
- Probes: a nested `toJSON` (on `results.instance`) is judged on the copy, which
  here fails closed (`SQL_PARENT_LINK_MISSING`). A getter is read exactly once,
  so all checks see one value. In v3 the same getter failed closed by accident
  (`TIME_CONTRADICTION`), because the checks read the field more than once. v4
  judges what it stores. The report already states that a getter cannot be
  detected.
- Extra mutants that pass the raw input to the handler, or digest the raw input
  in the final entry, are killed.

## I-1 — fixed

The test asserts `Object.isFrozen(run.ctx.sqlB)` and a nested array of B. An
extra mutant that stores a shallow unfrozen copy of B is killed, and so is the
recorded `l1_copy_frozen` mutant.

## I-2 — fixed

I ran a matrix of 968 cells: every prefix state, every event (including
`sql_deadline`), and eight kinds of bad evidence (undefined, null, a bare BigInt,
a BigInt field, a string, an array, NaN times, Infinity times).

- **v4 threw in 0 cells. v3 threw in 242.**
- In every cell where v3 did not throw, v4 gave the same state and reason
  (0 differences). So the copy changes nothing for evidence v3 could handle.
- Six cells "accepted" with NaN or Infinity times. Each is an event whose real
  time fields are nested, so my injected top-level fields were ignored, and v3
  behaves identically. This is a probe artifact, not a pass on bad time.
- A `Date` value becomes a string and fails closed (`ADMISSION_TIME_INVALID`).
- An extra mutant that makes `snapshot` rethrow is killed.

## Regressions and false passes

- **False passes:** none found.
- **Regressions against v3:** none. All 24 carried tests pass unchanged apart from
  paths, and the 968-cell differential shows no behaviour change for evidence v3
  could process. The two v3 R-3 mutants were correctly retired, because the code
  they targeted is gone. `l1_copy_first` covers what they covered.
- **Promotion:** refused for v1–v4 receipt formats and for relabeled receipts.
  No receipt names an authority.

## Informational

- **I-A: refused entries' digest of the copy is not pinned.** A mutant that
  digests the raw input on the `refuse` path (terminal, out-of-order, unknown or
  forbidden events) survives. For plain data both digests are equal, so
  behaviour is correct today. It would differ only for `toJSON` or non-JSON input
  sent to a refused event, and a raw BigInt would then throw again. One
  assertion would pin it, for example a BigInt step after a terminal state.
- **I-B: the `/3` entry in the prior-format list is not pinned.** Removing it
  survives, because a v3 receipt is still refused by its `fixture` and `mode`
  fields, and `admitted` is false in every path. Only the reason code for a
  relabeled v3 receipt would change. It is cosmetic.
- **I-C: non-JSON evidence is recorded as `null`.** The history then shows
  `digest(null)` and the handler's missing-evidence code (`EVIDENCE_MISSING` for
  SQL A), the same as absent evidence. That fails closed, but the record cannot
  tell absent evidence from non-JSON evidence. Adapters should send plain JSON,
  and a distinct code could be added later if that difference matters.

None of these reopens F1–F3, R-1–R-3 or L-1.

## Status of authority

This re-review is repository-only. It grants no SQL execution, credential use,
registry, pidfile or process read, cluster start or stop, launch, sign-in,
adapter implementation or native-session authority, and requests no
activation. Operational blockers are unchanged: reader N1–N4, collector L1/L4,
the process-metadata, pidfile and registry adapters, the protected credential,
real manifest bindings, grants, Jordan's attestation, and W2 comparison.

## Decision for Jordan and next step

1. **Jordan: confirm the 120 s attestation-to-spawn bound, or give another
   value.** This is the only open item that needs Jordan.
2. With that confirmed, v4 can stand as the supported fixture slice. I-A and I-B
   are optional one-line test pins. I-C and the getter limitation carry into the
   adapter design and review as stated conditions. M3 stays closed either way.
