# What kinds of software Creator Agent can build: capability matrix (P14 inventory, November 5, 2026)

This is the inventory half of P14 (revision R17). It says which kinds of software the studio can
build and verify today, with the evidence behind each cell. It also defines the representative
tasks for later qualification runs and proposes the P15 order. **No qualification run was made
for this document.** Rows without executed evidence are marked unverified or unsupported. Do
not advertise more than the "yes" cells.

Sources: `packages/contracts/src/artifacts.ts` (recipes), `packages/executor/src/` and
`packages/executor/worker/` (build, QA, package, terminal), `docs/BOUNDED_BUILDER.md`,
`docs/ARTIFACTS_AND_PREVIEW.md`, ADRs 0048, 0052–0054 and 0058–0059, the
[owner pilot log](OWNER_PILOT_LOG.md), and the tests named below. Main at `9fe673b`.

## 1. What a supported build is today

There are exactly two recipes in the contracts:

- `python-build/1` (`artifacts.ts:62`): build, QA and package. The builder edits a reviewed
  **Python standard-library command-line template** with the entry point `src/main.py`. QA runs
  each owner-written case (arguments, stdin, exact stdout, exit code 0–125, at least one held out)
  in a fresh sandbox: `python3 -I`, no network (`bwrap --unshare-all`), 256 MiB memory, 32
  processes, 50% CPU, a 10 s CPU limit, 8 MiB files, 64 open files, 20 s wall time
  (`packages/executor/worker/recipe.py`; backend string in `packages/executor/src/execution.ts:44`).
  There are no third-party packages and no lockfile ("standard library only", manifest). State
  is not kept between runs.
- `python-terminal/1` (`artifacts.ts:368`): runs a verified package **interactively** in an
  isolated terminal window (ADR-0058/0059). No network, 256 MiB, 32 tasks, 50% CPU, 900 s.
  Output is not captured, so nothing about interactive behaviour is verified automatically.

The only reviewed isolation backend is **Windows + WSL2** (`wsl2-bwrap-systemd`;
`execution.ts:343` refuses elsewhere). A hosted (Linux) studio cannot build or open terminals
today (see [the staging design](COMMITTEE_STAGING_DESIGN_2026-11-05.md), gap G3).

The private preview pages are studio-written HTML around a CLI runner. They are **not**
evidence that generated web apps work (`docs/ARTIFACTS_AND_PREVIEW.md`, threat model).

## 2. Matrix

Columns (from the P14 prompt):

- **Impl.**: implemented in source.
- **Fixture**: covered by fixture or contract tests.
- **Real iso.**: run in the real WSL2 worker.
- **Export start**: an exported package started outside the studio.
- **Role-qual.**: build roles qualified on a live route for this kind.

"—" means not applicable because nothing exists.

| Kind                                            | Impl.                                                                                    | Fixture                                                                                                                     | Real iso.                                                                                                                                                      | Export start                                                                                                                                                          | Role-qual.                                                                                                                                                                                           | Status and limits                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Python CLI, stdin/stdout** (`python-build/1`) | Yes                                                                                      | Yes: `tests/src/build.test.ts`, `artifacts.test.ts`, `artifact-api.test.ts`, `studio-builds.test.ts`, `study-build.test.ts` | Yes: `studio-builds-wsl.test.ts` (opt-in); real builds on Jordan's PC: CSV checker (Oct 28, QA in WSL2), timing analyzer v2 (QA 7/7) and v4 (QA 10/10, Oct 31) | Yes: the timing analyzer v4 exported source was run by Jordan in PowerShell on Oct 31 (pilot log). The CSV checker was exported to `.creator\exports\csv-checker-v2\` | Yes, small scale: on the ChatGPT plan (gpt-6-astra) `patch_build` qualified with `t12-builder-v1` 3/3 and `independent_review` with `t12-reviewer-v2` 3/3 (dev studio Oct 28; installed app Oct 31). | **Supported.** Standard library only, one entry point, exact-output cases, no network, no files kept between runs, a 10 s CPU budget per case. Qualified only on small single-module tasks. Repairs are bounded by ADR-0054's limits (`max_repairs` ≤ 2, `max_calls` ≤ 6). |
| **Interactive CLI** (`python-terminal/1`)       | Yes                                                                                      | Yes: `terminal.test.ts`, `terminal-rerun.test.ts`                                                                           | Yes: live check on Jordan's PC on Nov 1 (conhost, WSL, `systemd-run --pty`, timing analyzer v4)                                                                | Same package as above                                                                                                                                                 | Not separate: it runs a package that `python-build/1` already verified                                                                                                                               | **Supported for running, not for verifying.** Windows desktop only. Interactive behaviour (timing, prompts) is checked only by a person. Hosted studios refuse it.                                                                                                         |
| Static web frontend (`static-web/1`, ADR-0078)  | Yes: plain HTML/CSS/JS, no packages or build step                                        | Yes: `tests/src/web-recipe.test.ts`                                                                                         | Yes: WSL2 worker with pinned Chrome 156 (live, November 6)                                                                                                     | Not run (startup is `python3 -m http.server`)                                                                                                                         | **Yes, one route**: `p15-small-signup-v4` 3 of 3 on the ChatGPT plan with `gpt-6-astra`                                                                                                              | **Implemented, qualified on one route.** Small static pages only; see [STATIC_WEB_RECIPE.md](STATIC_WEB_RECIPE.md). Pinned Node, dependencies, frameworks and accessibility smoke are later slices.                                                                        |
| API service (HTTP)                              | No                                                                                       | —                                                                                                                           | —                                                                                                                                                              | —                                                                                                                                                                     | —                                                                                                                                                                                                    | **Unsupported.** No port or network policy, readiness checks, or service QA.                                                                                                                                                                                               |
| Database-backed web app                         | No                                                                                       | —                                                                                                                           | —                                                                                                                                                              | —                                                                                                                                                                     | —                                                                                                                                                                                                    | **Unsupported.** No scoped ephemeral database, persistence or export policy.                                                                                                                                                                                               |
| Multi-module repository / larger project        | Partly: the template may hold several `.py` files (all are compiled); one task per build | Only through the small fixtures                                                                                             | Not measured at larger scale                                                                                                                                   | —                                                                                                                                                                     | No: the benchmarks are small single tasks                                                                                                                                                            | **Unverified beyond small.** No task DAG, checkpoints or integration checks across tasks ("task dependency integration stop explicitly", `BOUNDED_BUILDER.md`).                                                                                                            |
| Data pipeline / file processing                 | Only as a CLI reading stdin                                                              | Same as Python CLI                                                                                                          | The CSV checker is an example                                                                                                                                  | Yes (CSV checker)                                                                                                                                                     | As Python CLI                                                                                                                                                                                        | **Supported only in CLI form:** input through stdin or arguments, stdlib parsing, no input files, no libraries such as pandas, no network.                                                                                                                                 |
| Native desktop GUI                              | No                                                                                       | —                                                                                                                           | —                                                                                                                                                              | —                                                                                                                                                                     | —                                                                                                                                                                                                    | **Unsupported.**                                                                                                                                                                                                                                                           |
| Mobile app                                      | No                                                                                       | —                                                                                                                           | —                                                                                                                                                              | —                                                                                                                                                                     | —                                                                                                                                                                                                    | **Unsupported.**                                                                                                                                                                                                                                                           |
| Codex builder route (ADR-0042) for any kind     | Route exists in source (`codex-host.ts`, `codex_bridge.py`)                              | `codex-host.test.ts`, `codex-bridge-timeout.test.ts`                                                                        | No recorded verified Codex build                                                                                                                               | —                                                                                                                                                                     | No `code_build` qualification recorded                                                                                                                                                               | **Not a supported path.** Same template and recipe as the Python CLI if it is ever qualified.                                                                                                                                                                              |
| Non-software deliverable (proposal)             | No (P09)                                                                                 | —                                                                                                                           | —                                                                                                                                                              | —                                                                                                                                                                     | —                                                                                                                                                                                                    | Not built. Listed because R08/R09 route some projects here instead of to code.                                                                                                                                                                                             |

Limits that apply to every row:

- Builds run only on Windows with WSL2. Hosted studios build nothing (G3).
- Qualification is per role prompt, route, model and version (ADR-0052 and PR #75). A new
  prompt, model or route needs requalification. A pass under an older prompt does not carry over.
- No universal maximum project size is claimed. "Larger" will mean more requirements and more
  integration, measured on frozen tasks, not line count.

## 3. Representative tasks for qualification (to freeze before any run)

Each family gets a small and a larger task. Each task freezes its spec, acceptance checks
(including held-out ones), runtime and dependency rules, resource limits and the
known-failure cases **before** the first run. Results, including failures, are kept as they
are. Nothing below has been run.

| Family                     | Small task                                                       | Larger task                                                                                                                                                    | Acceptance evidence to collect                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python CLI (current)       | Already covered (CSV checker, timing analyzer)                   | 3–5 modules with an internal API (for example a parser, a rules engine and a report writer), 15+ cases with held-out edge cases, and one repair round expected | QA pass rate, held-out pass, repair rounds used, requests, wall time, reviewer findings, clean export start                                       |
| Static frontend            | A single page with a form and client-side validation, no network | A multi-view app with routing and local state, about 3 components                                                                                              | Headless browser checks on the preview host (separate cookie host), accessibility smoke, no outbound requests, export starts with a static server |
| API service                | Two JSON endpoints with input validation                         | Authenticated CRUD with 5+ endpoints and error contracts                                                                                                       | Readiness probe, contract tests from the spec, port and network policy held, process-tree Stop, restart                                           |
| Database-backed web        | —                                                                | API plus frontend over an ephemeral database with migrations                                                                                                   | Migration from empty, persistence across restart, data export, cleanup of the ephemeral database                                                  |
| Multi-module, checkpointed | —                                                                | 3+ dependent tasks with checkpoints and integration checks                                                                                                     | Each checkpoint verified, integration checks, budget conserved across tasks, targeted repair of one failed task without rerunning the rest        |

Measure, per family and scale: startup and export, CPU, memory and wall time, multi-file
changes, tests passed, reviewer findings, repairs and recovery, and requests used. Before any
run that calls a model or uses a live route, prepare an exact packet (benchmark, route, caps,
expected requests) and get Jordan's typed OK. That is the project's rule for live steps.

## 4. Proposed P15 order

1. **Generated static frontend.** The biggest gap Jordan hit (F17, the live input tester).
   Needs: a web recipe with pinned Node and dependency acquisition inside isolation, headless
   browser QA, a preview on its own host (not just another port), and P07's preview lifecycle.
2. **API service, then database-backed web.** Adds port and network policy, readiness and
   ephemeral data.
3. **Multi-module checkpointed jobs.** Task DAG and checkpoints over the existing Git and
   artifact lineage. Feeds P13.
4. **A Linux execution backend** for hosted builds, if Jordan chooses D7(b) in the staging
   design. It can run in parallel with 1–3, but needs its own security review.
5. Native desktop, mobile and other kinds only after their own design and qualification.

P16 (exporting an implementation runbook for another model) can come before slices 1–3. It lets
projects outside this matrix still leave the studio with a usable plan.

## 5. Gate

P14 inventory gate: a documented capability and support policy, and an evidence matrix with
unexecuted rows marked unverified. Both are in this document. Next for P14: freeze the larger
Python CLI task from section 3 and prepare its qualification packet for Jordan's OK. Next for
P15: slice 1 design.

**Update, November 6:** the [P14 repo benchmarks](REPO_BENCHMARKS_P14_2026-11-06.md) ran live.
The small single-module benchmark is qualified 3 of 3. The larger multi-module benchmark is
0 of 3, because the studio refuses `__init__.py` in a builder patch without telling the builder
the rule. The "Multi-module repository" row stays **unverified beyond small**.

**Update, November 6 (P15 slice 1):** the static web frontend row is now implemented as
`static-web/1` ([design and limits](STATIC_WEB_RECIPE.md), ADR-0078). Evidence executed: contract and
fixture tests, and the reviewed browser checker run in real Bubblewrap with the pinned Chrome 156 in
a Linux container, where the frozen benchmark `p15-small-signup-v4` reference passes 10 of 10 and all
16 known failures (including worker, WebSocket, WebRTC, dialog, native-submit, popup and late-request pages)
are caught. The check shows no outside request was seen during the cases, not that none can ever happen.
**Update, November 6 (live):** the WSL2 worker and the live role qualification ran: 3 of 3 attempts
verified (10/10 QA, 6/6 held out, reviewer approved, exported packages scored 10/10) on the ChatGPT-plan
connection with `gpt-6-astra` at $0 ([results](../tracking/evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json)).
The row is **qualified for that connection, model and role-prompt pair only**; other web builds stay
labelled unqualified trials. Not executed: an exported package started outside the studio, the repair
path, and the desktop app's preview frame.
