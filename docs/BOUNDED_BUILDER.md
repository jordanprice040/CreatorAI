# Bounded builder and candidate verification (T12)

The local owner CLI connects a current frozen T08 task to the existing metered
broker, scoped Git patches, fresh reviewer context and real T11 WSL2 worker.
`verified_candidate` describes one task commit and its recorded acceptance plan,
not the whole product or a later merge.

## Supported recipe

An independent `builder` task may edit the reviewed Python stdlib CLI template.
Every assigned acceptance check must be `automated_test` and carry owner-authored
`cases` in the spec itself (arguments, stdin, exact stdout including newlines, exit
code 0–125 and `held_out`). The cases are part of the frozen task hash, and the build
plan's `cases` must equal them exactly, in spec order and without `held_out`, so a build
cannot choose or weaken its own tests. Each task needs at least one held-out case:
QA runs it, but its inputs and expected output never enter the builder or reviewer
packet or repair feedback (which only names the failed check key).
Each case runs in a clean sandbox. Browser/manual/metric checks and task dependency
integration stop explicitly; persisted state across invocations is unsupported.
Do not use this recipe to verify web behavior or persistent applications.

The fixture adapter implements only the fixed synthetic checklist exported from
`packages/domain/src/build-fixture.ts`: add `verify` to the list and reject an
unexpected argument. Its reviewer compares against fixed fixture source. These
are deterministic test roles, not model reasoning or customer validation. A real
workspace uses the existing live broker slot without fixture fallback. No live
provider is configured or activated by T12.

A plan may instead name `plan_roles` (ADR-0048): builder and reviewer then go as fresh
requests on a ChatGPT-plan connection's direct Responses route (`patch_build` and
`independent_review` task classes), with no dollar broker call. The packets, prompts,
scoped patch tool and QA are the same; admission needs each role qualified, an active
non-human-only run outside any study assignment, and the plan caps. The call timeout may be
up to 120 s on this route only; broker builds keep 60 s. `plan_roles` and
`codex_plan_builder` cannot both be set. Plans without `plan_roles` hash as before.

## Owner commands

Create/freeze the actual specification through T08 and use `product-init` and
`product-task` from [isolated execution](ISOLATED_EXECUTION.md). Supply an active
registered run, funded envelope, compatible pricing snapshot and model grants.
`product.commit_build` also passes normal admission. Its target is the exact
specification version; supply a current humility review of that specification,
not an alternative. Answer a concrete admission decision or use an existing
authorized standing grant. No policy defaults need changing.

Example plan (replace IDs and deadline; copy `cases` from the frozen spec):

```json
{
  "format": "build-plan/1",
  "run_id": "00000000-0000-4000-8000-000000000001",
  "envelope_id": "00000000-0000-4000-8000-000000000002",
  "pricing_snapshot_id": "00000000-0000-4000-8000-000000000003",
  "humility_review": {
    "id": "00000000-0000-4000-8000-000000000004",
    "version": 1
  },
  "data_class": "synthetic",
  "max_repairs": 0,
  "max_calls": 2,
  "timeout_ms": 10000,
  "max_output_tokens": 3000,
  "deadline": "2026-10-18T23:00:00.000Z",
  "cases": [
    {
      "check_key": "A1",
      "args": [],
      "stdin": "",
      "stdout": "expected output\n",
      "exit_code": 0
    }
  ]
}
```

```powershell
pnpm cli build-task <product-id> <task-id> <expected-task-commit> build-plan.json
pnpm cli build-status <product-id> <build-id>
pnpm cli product-status <product-id>
```

The start command prints its build ID, then the result. Failed finite attempts
return `checkpoint` with the last committed candidate; inspect `state`, not just
the CLI exit code. Preflight/auth/contract errors exit unsuccessfully. Pending
admission reports its decision ID without calling a model. Approve covered work
and explicitly start another attempt; there is no hidden continuation. Maximum
repairs is two, calls six, attempts one per role call, output 16,000 tokens,
provider timeout 60 seconds and cases ten. Broker budgets reserve financial
exposure before each dispatch. Local compute retains T11 bounds and remains
monetarily unmetered.

## Evidence and recovery

`.creator/products/<product>/builds/<build>/` retains immutable intent, spec,
prompts/hashes, plan, context/request hashes, admissions, broker reservation/output
traces, commits, review, executed commands and full execution/case results. The
reviewer receives fresh candidate files/diff and frozen task context without
builder summaries or prior conversations. Models have no filesystem/process
capabilities; the supervisor applies typed CAS patches and invokes fixed recipes.

Acceptance input is supervisor-owned, outside the generated snapshot and mounted
read-only. The supervisor compares actual output/exit status. Model claims cannot
supply test evidence. Changed commits, dirty files and changed current specs
invalidate status. Failed code stays in Git. Integration remains an explicit owner
operation; a merge needs its own verification.

Cancellation, current authority/spec and deadline are checked before/after calls
and between cases. A QA monitor requests T11 process-tree cancellation if they
stop passing. Already dispatched charges remain in the broker ledger, including
late/unknown outcomes. Use `run-cancel` and `product-cancel`. Crashes retain intent
and traces without automatic redispatch. Inspect broker calls, worker leases,
Git and the exclusive build lock before manual recovery; never reset partial work
or remove a live owner's lock.

Local build evidence inherits T11's owner-controlled filesystem trust. It is
separate from database audit/search; broker operations remain in the database.
No gallery, preview, package export, participant implementation workflow or public
release is added. Role separation cannot eliminate correlated errors. Passing a
plan does not establish that its assertions fully capture real user needs.

`pnpm check` runs contract/Git/refusal tests with visible real-worker skips.
With a disposable test DB and `CREATOR_TEST_ISOLATION=wsl2`, `pnpm test:db` also
executes good/broken candidates and compiled authenticated CLI acceptance. Set
`CREATOR_RECORD_T12_EVIDENCE=true` only to intentionally refresh the synthetic CLI
evidence in `tracking/evidence/t12/`. Test doubles never substitute for real QA.
