# P14 repo benchmarks: small and larger, frozen before any run (November 6, 2026)

This is the preparation half of P14 qualification for the one supported build kind,
`python-build/1` (see the [capability matrix](CAPABILITY_MATRIX_2026-11-05.md), section 3). It
defines one **small** and one **larger** benchmark, freezes their expected results, pass bars and
grader, and gives the exact packet for live runs. **No benchmark was run against the studio or a
model before the freeze.** The only executions were local checks of the repository's own reference
solutions and deliberately broken copies of them.

**Version 2.** The first freeze (`-v1`, `FREEZE.json` SHA-256 `c0b5b017…382b64b` at `6caf820`) was
replaced before any run, after the independent review
(`/mnt/project-files/reviews/PR145_BENCHMARK_PREP_REVIEW_2026-11-06.md`): four listed known
failures passed every v1 case (M-1), one case expected an unstated rule (M-2), the grader was not
frozen (M-3), and nothing bound the studio's spec to the frozen one (M-4). v1 was never run and
its files remain in git history only.

Files: `config/repo-benchmarks/` (frozen, including `grader.mjs`), `scripts/p14-benchmark.mjs`
(CLI), `tests/src/p14-benchmarks.test.ts`.

## 1. The two benchmarks

|                   | Small: `p14-small-wordtally-v2`                 | Larger: `p14-larger-ledgercheck-v2`                                                                              |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Product           | Word tally CLI: top words from stdin, `--top K` | Ledger cap checker: validates `date,category,amount` rows, totals per category, caps, month filter, text or JSON |
| Code shape        | One module, `src/main.py`                       | `src/main.py` plus a `src/ledger` package with `parse.py`, `rules.py`, `report.py` (internal API)                |
| Checks            | 4 automated checks                              | 6 automated checks                                                                                               |
| Studio QA cases   | 10 (6 held out)                                 | 10 (5 held out), the studio's per-build maximum                                                                  |
| Extended held out | 8 cases                                         | 21 cases and a structure check                                                                                   |
| Build caps        | `max_repairs` 1, `max_calls` 4, 4000 tokens     | `max_repairs` 2, `max_calls` 6, 12000 tokens                                                                     |
| Requests          | typically 2, at most 4 per attempt              | typically 2, at most 6 per attempt                                                                               |

Extended cases are never entered into the studio. They are scored after the build on the
exported package. "Larger" means more interacting requirements and modules (row validation
order, error precedence, exact money formatting, caps on absent categories, month filtering that
still validates every row, an exact JSON shape) rather than line count. Both use synthetic data.

Each benchmark folder holds `spec.json` (the spec content exactly as entered in the studio; it
passes the studio's `SpecContentSchema`, is unchanged by the studio's trimming, and passes
`buildBlockers`), `expectations.json` (caps, requests and cost, attempts, pass bar, run rules,
measures, known failures with the cases that catch each), `extended-cases.json`, and `reference/`
(a reference solution that is never shown to builders or reviewers).

## 2. How the expected results were frozen

1. Every expected stdout and exit code was written by hand from the spec text. The v2 case
   files and the grader were committed (`4b4c26e`) before the reference solutions were added back
   with the freeze. The reference solutions themselves are unchanged from v1, so they predate the
   new v2 cases. The commit order shows only that the case files did not change after the
   references were committed. The `ordering_note` in the frozen `expectations.json` overstates
   this; the wording here is the corrected one, and a future v3 would carry it. That the outputs
   came from the spec and not from a run is the author's statement.
2. The reference solutions pass every case under both runners (small 10/10 + 8/8; larger 10/10 +
   21/21 and the structure check).
3. Each known failure listed in `expectations.json` has a mutant of the reference in the test
   suite, and the test fails unless one of the cases named for it fails. A new listed failure
   without a mutant also fails the test.
4. `config/repo-benchmarks/FREEZE.json` holds the SHA-256 of every file in both folders and of
   `grader.mjs`. `verify` and the tests fail on any change or added file, and `score` refuses to
   run while the freeze is broken. A change means a new version, never an edit.
5. **Anchor:** `FREEZE.json` SHA-256 is
   `e762e0ddf7b9aee387e6adf422fac940f8c57addc1828637297091d09345dbcd`. Deleting it and running
   `freeze` again would produce a different hash, so every results file cites this hash and the
   git commit it came from.

## 3. Pass bar and run rules (frozen in `expectations.json`)

Per attempt, all of:

- The studio build reaches **verified_candidate**: QA passes all 10 frozen cases in the WSL2
  worker, including every held-out one, and the reviewer approves with no findings (the studio's
  own rule).
- Requests used are within the plan's `max_calls`.
- `compare-spec` passes for the spec stored in that run.
- The exported package passes every build and extended case under the frozen grader, and
  (larger) the structure check.

Run rules:

- **3 attempts per benchmark**, on the same route, model and role prompts. Qualified at the
  declared scale only when all 3 pass; otherwise recorded as k of 3 and not qualified. A failure
  is never re-run to replace it.
- **One run per attempt.** The plan connection caps requests at 10 per run, so each attempt gets
  its own run, selection, spec and product.
- **Infrastructure fault before a verdict** (worker crash, studio restart, plan outage): recorded
  with its cause; each attempt may be replaced at most once.
- **Scorer or export fault after a verified build** (Bubblewrap missing, a path problem, a grader
  crash): the same exported package (same `product_tree_sha256`) may be exported or scored again,
  since no role re-runs. A grader result on a package is final once produced.

Measured per attempt: requests and repair rounds, wall time, files changed and diff size,
reviewer verdict and findings, QA development and held-out counts, `compare-spec`, the grader
JSON, plan daily requests before and after, and the dev studio schema and commit. **Clean export
start** is the grader run itself: the exported package, extracted outside the studio, runs with no
studio files present. **CPU and memory** come from the grader (per-case max CPU seconds and max
RSS). Studio QA records its limits but not usage, so studio-side usage is not measured on this route.

## 4. The grader

```text
node scripts/p14-benchmark.mjs verify
node scripts/p14-benchmark.mjs compare-spec <benchmark-id> <stored-spec.json>
node scripts/p14-benchmark.mjs score <benchmark-id> <export-dir>
```

The grading rules live in the frozen `config/repo-benchmarks/grader.mjs` and follow studio QA
(`packages/executor/worker/recipe.py`, `bridge.py`) where they can:

- every `.py` file is compiled first, and a compile error fails every case;
- each case runs `python3 -I -B src/main.py <args>` with stdout and stderr merged in one log,
  which must equal the expected stdout exactly, and the exit code must match;
- limits per case: 10 s CPU, 64 open files, 8 MiB files, 20 s wall. The studio's systemd limits
  (256 MiB memory, 32 tasks, 50% CPU) are not reproduced. That difference is part of the frozen rules.

`score` runs generated code in Bubblewrap by default (no network, read-only product, cleared
environment; Linux or WSL2). `--runner direct` is refused unless `--trusted` is given, which is
for the reference solutions or a throwaway container only. Each score names `freeze_sha256`,
`grader_sha256`, `frozen_spec_sha256` and `product_tree_sha256`.

`compare-spec` takes the studio's stored spec record (`title`, `content_hash`, `body`). It
recomputes the studio's content hash (`canonicalHash({kind, title, body})`) to show the file is
the stored version, then requires the body, minus `format`, `alternative` and `selection_id`,
to equal the frozen `spec.json` content field by field.

To get the stored record, read the frozen spec version from the dev studio's database
(`entity_versions`) and save it as JSON, for example with psql against `creator_studio`:

```text
psql -At -d creator_studio -c "select json_build_object('title', title, 'content_hash', content_hash, 'body', body) from entity_versions where entity_id = '<spec-id>' and version = <frozen-version>" > stored-spec.json
node scripts/p14-benchmark.mjs compare-spec p14-larger-ledgercheck-v2 stored-spec.json
```

Use the spec id and version that the run's spec freeze names (`spec-freeze` output or `pnpm cli
spec <workspace> <spec-id>`).

## 5. Limits and deviations found while freezing

- **The studio's QA runs at most 10 cases per build** (`MAX_BUILD_CASES`), so the larger
  benchmark splits into 10 studio cases plus 21 extended cases. That also means `--month` has no
  development case and JSON has no held-out studio case; the extended suite covers both.
- **Only builder tasks with no dependencies can be built**, so a multi-task DAG with
  checkpoints cannot be benchmarked yet (P15 slice 3).
- **`python3 -I` does not put `src/` on the import path.** Multi-module products must add their
  own directory to `sys.path` in `main.py`, or every case fails. The larger spec states this as a
  runtime rule; the builder prompt and template do not mention it today.
- **Deviation from the matrix:** the matrix's larger task said "one repair round expected". Here
  a repair is measured but not required, so a first-try success is not penalised.
- The held-out cases live in this repository. Runtime roles never see the repository, but a
  coding agent that edits the studio could. That limits claims about coding agents, not roles.

## 6. Live run packet

Jordan gave a typed OK in advance for these runs (project chat, 2026-11-06 00:24 UTC).

- **Where:** the dev studio on Jordan's PC (`C:\dev\creator_agent`, database `creator_studio`),
  never the installed app's data. WSL2 isolation worker.
- **Route:** `plan_roles` on the ChatGPT-plan connection with `gpt-6-astra`; `patch_build` and
  `independent_review` qualified on the current role prompts (preflight `build-roles-ready`).
  Stop if either is not qualified.
- **Path per attempt:** a synthetic run, selection, spec entered from `spec.json`, humility
  review, freeze, `compare-spec`, product, Start with the caps above and `data_class` synthetic;
  after a verified build, export and score it.
- **Requests:** small at most 4 per attempt (12 for 3), larger at most 6 (18 for 3), 30 at most
  in all, $0 on the plan route, inside the connection's 40 a day.
- **Records:** one results file per attempt under `tracking/evidence/p14-benchmarks/` with the
  measured fields, build and package ids, the `FREEZE.json` hash and commit, and the grader JSON.

## 7. Results (live runs, November 6, 2026)

Run on the dev studio (`creator_studio`, schema 41, code `02c7646`), `plan_roles` on the
ChatGPT-plan connection with `gpt-6-astra`, benchmark commit `79dfea8`, `FREEZE.json`
`e762e0dd…45dbcd`, grader `5fc73efa…7a84`. **9 plan requests in total, $0.** Every stored spec
passed `compare-spec`. Key fields are in
[`tracking/evidence/p14-benchmarks/RESULTS_2026-11-06.json`](../tracking/evidence/p14-benchmarks/RESULTS_2026-11-06.json);
the full per-attempt files stay on Jordan's PC under `.creator\p14-benchmarks\v2\results\`.

| Benchmark                   | Outcome                                     | Per attempt                                                                                                                                                                               |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p14-small-wordtally-v2`    | **3 of 3, qualified at its declared scale** | verified_candidate; 2 requests, 0 repairs, 27–31 s; QA 4/4 + 6/6 held out; reviewer approve, no findings; grader (Bubblewrap) 10/10 + 8/8 extended; max 0.019 s CPU, 11.5 MB RSS per case |
| `p14-larger-ledgercheck-v2` | **0 of 3, not qualified**                   | each stopped at a checkpoint after 1 builder request (48–51 s); no QA, review or package                                                                                                  |

**Why the larger benchmark failed (all three the same).** The builder's patch included
`src/ledger/__init__.py`. The executor's `pathSchema` requires every path segment to start with
a lowercase letter or digit, so the whole submission was refused at admission
("Input does not satisfy the versioned contract"). The other four files were valid. The
builder prompt (`builder/1`) never states the path rule, the spec does not require
`__init__.py` (a namespace package would satisfy it), and the studio stops the build instead of
giving the builder a repair round with the reason. Under the frozen rules these are failed
attempts, not infrastructure faults, and were not re-run.

What this shows: the current recipe and roles are qualified for **small single-module**
Python CLIs. They are **not** qualified for multi-module packages, and the first blocker is in
the studio (path rule not stated to the builder, no repair on a refused patch), before model
quality at that scale is even measured. Follow-ups, each needing its own change and a new
benchmark version or run: state the path and `sys.path` rules in the builder packet, or allow
`__init__.py`; and turn a refused patch into repair feedback instead of a checkpoint.

## 8. Set v3: the larger task after ADR-0076 (frozen November 6, 2026, before any v3 run)

ADR-0076 admits Python package files such as `__init__.py`, gives the builder the patch and QA
runtime rules as packet data, and turns a refused patch into repair feedback. The v2 result
(0 of 3) stays final. Set v3 lives in `config/repo-benchmarks/v3/` with its own copy of the
grader (only the benchmark list differs) and its own `FREEZE.json`
(SHA-256 `aaf369d709aba3614f8a7bf8cac6f5fb6544762a2e10219409b69259fd4c0e13`; grader
`24d8e6b0281c736927e1da617a0ae56f68bec759f36b52d0d47c528dcc28cf4e`).

`p14-larger-ledgercheck-v3` repeats the v2 larger task: the spec content, the 10 studio cases,
the 21 extended cases, the known failures and the reference solution are the v2 ones (a test
checks each). Reusing them is sound because no role saw a v2 QA result or held-out case: every
v2 attempt stopped at its first builder answer, and builder packets never contain held-out
cases. The expectations add only the v3 notes: the studio must run code with ADR-0076, a refused
patch counts as one repair round within `max_repairs` 2 and `max_calls` 6, and refusals are
recorded (`refused-N.json`).

```text
node scripts/p14-benchmark.mjs verify --set v3
node scripts/p14-benchmark.mjs compare-spec p14-larger-ledgercheck-v3 stored-spec.json
node scripts/p14-benchmark.mjs score p14-larger-ledgercheck-v3 <export-dir>
```

The live packet is the one in section 6 for the larger benchmark (3 attempts, one run each, at
most 6 requests per attempt, $0 on `plan_roles`), on a dev studio running this branch.
