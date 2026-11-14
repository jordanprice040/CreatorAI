# B3: Build page timeline, results and repair evidence (November 14, 2026)

Milestone B3 of the build capability plan (`/mnt/project-files/reviews/BUILD_CAPABILITY_PLAN_2026-11-14.md`;
Jordan accepted proposal D on November 14: repair evidence comes from a fair, harder frozen
benchmark, and if no attempt needs a repair, that is the result). No migration, no ADR.

## What changed

**Build page, task's newest build** (`apps/web/src/build-progress.tsx`, rules in
`build-progress-rules.ts`):

- While it runs: one live line ("The builder is writing the code (12 s so far).", "Testing: case 3 of
  10 (repair round 1 of 2)", …) in a polite status region, and the steps below it, updating with
  the page's 2 s poll and a 1 s clock.
- The steps, by round: approval (what it covers), then "First try" and each "Repair round N of M":
  what the builder changed (or that the studio refused its change, and why), the reviewer's verdict,
  and the tests ("2 of 10 test cases failed", "All 10 test cases passed (6 hidden cases the builder
  never saw)"), with requests used. Folded once the build ends.
- When it stops: what happened in plain words and one next step (approval, worker not available or
  needing Recover, repair limit, refused last fix, builder or reviewer blocked, request cap, deadline,
  plan or connection refusals, input too large, unknown reasons in the page's plain words). In
  Standard the raw reason is no longer repeated on the newest row; Advanced keeps it.
- "Why did it fail?": the stopped round's failing visible cases with the input, the expected output
  and what the program printed side by side (exit codes when they differ); a web case names the
  failing step and any page errors or outside requests; a failed **hidden** case is named by its check
  only. The reviewer's findings follow.
- When it verifies: what you got (files), what was tested and what was not (honestly: only these
  cases, Linux sandbox, not used for real yet; fixture builds say they are not evidence), and how to
  run it on Windows (PowerShell, `py -3`) and macOS/Linux, with the downloaded archive's own name.

**Server** (`packages/executor/src/build-progress.ts`, `BuildSupervisor.progress`,
`apps/api/src/products.ts`): `GET products` adds `progress` to each task's newest build, read from the
build folder's existing files (intent, admission, call, candidate, refused, review, qa, outcome), so
running, stopped and interrupted builds read the same way and nothing new is recorded. Held-out flags
come from the frozen spec in the build's intent; a held-out failure carries only its check key and
index. Texts are cut at 1,500 characters.

**Fix found by this milestone:** a static web product built from the Build page sent no test cases
(`frozenCases` reads Python cases only), so every in-app web build was refused with "cases: Too small".
The November 6 web qualification used the CLI, which passes its own cases. `startBuild` now sends the
browser cases for a `static-web/1` product. `tests/src/build-progress.test.ts` fails on main with that
message.

**Test seam:** `createApi(env, { buildPorts })` wraps each studio build's ports (used by the tests and
this walk to script fixture role answers; the fixture broker still admits and records each request).

## Repair benchmark `p14-repair-v1` (frozen)

`config/repo-benchmarks/repair-v1/` (own grader copy and `FREEZE.json`; `node scripts/p14-benchmark.mjs
verify --set repair-v1`; in `.prettierignore` so its bytes stay frozen). A score sheet CLI: averages of
`name,score` lines, rounded half up to one decimal, best first. Every rule is in the spec; several are
easy to miss on a first draft (half-up rounding where `%.1f` and `round()` give 82.2 for 82.25, line
numbers that count blank and comment lines, a trailing `\r`, first-record spelling, lowercased tie
order, `+5` as an invalid score). 10 studio cases (6 held out), 22 extended cases. The visible case
A1.2 (82.25 prints 82.3) fails the usual float draft, so its repair feedback shows expected against
actual output.

Checked (`tests/src/p14-benchmarks.test.ts`): the reference passes 10/10 and 22/22; each of the 11
listed easy-to-miss mistakes fails the cases named for it; editing a repair file breaks only that set.
The expected outputs were written from the spec, then checked against the reference, in the same
commit, before any studio or model run.

## Repair round through the app (test double, not live)

`tests/src/build-progress.test.ts` runs the repair benchmark through the studio's own build route:
scripted fixture roles (first a draft with float averages and `int()` scores, then the reference) and
a test double that runs each case with the host's `python3` (no isolation). Round 0 fails A1.2
(visible: expected `Cy 82.3 (4)`, printed `Cy 82.2 (4)`) and one hidden A2 case; the builder's repair
packet carries the visible failure and only the hidden case's check; round 1 passes 10/10 and the
build verifies after 1 repair in 4 requests. This proves the studio's repair path and the page's view
of it; it is not live evidence of a model repairing code.

## UI walk (cloud container, test double)

`dev-double.mjs` (header lists the environment; migrate the throwaway database first), `setup.mjs`
(puts a frozen spec into the seeded spec and freezes it), `walk.mjs` (Playwright; `open` opens the
build's folds, `choose` sets a select, `axe` runs axe-core WCAG 2.2 A/AA on `main`). Ports
4330/5183/4340, throwaway database `b3walk`. Screenshots in `shots/`:

1. `01-stopped-for-approval.png`: first Start build stops for approval: plain reason and next step
   above the in-place approval.
2. `02-running-first-try.png`, `03-running-tests.png`: live line and steps while it runs.
3. `04-verified-after-repair.png`: verified after one repair round: results, how to run it, steps.
4. `05-stopped-why-failed.png`, `06-stopped-390px.png`: a build with 0 repair rounds stops; "Why did it
   fail?" shows A1's expected and printed output and the hidden A2 case by its check only.
5. `07-verified-packaged.png`, `08-web-verified-packaged.png`: packaged; the run steps name the
   downloaded archive. The web product was built from the Build page (the fix above).

axe-core: 0 violations on Build with the folds open, at 1440 and 390 px.

## Export start outside the studio (cloud, Linux)

`fetch-package.mjs` downloads a package's manifest and archive as Try does; `export-start.mjs`
extracts it with the system `tar` into a fresh folder and starts it with the manifest's own startup
command, then checks the manifest's frozen cases:

- Python (`export-start-python.json`): `python3 -I src/main.py` passes 10/10 cases. The frozen grader
  on the same extracted package: build 10/10, extended 22/22.
- Static web (`export-start-web.json`): `python3 -m http.server 8000 --bind 127.0.0.1 --directory site`
  serves the site; Playwright's Chromium (not the studio's pinned checker) plays all 10 frozen cases:
  10/10, no page errors and no requests outside the site.

Finding: on Windows, `python3` is often the Microsoft Store stub, so the manifest's command may not
start there. The manifest is unchanged (it records how QA ran); the results card gives Windows
PowerShell steps with `py -3` and `tar -xf … -C`. Not yet observed on Windows itself.

## Desktop preview (code read; live look needs Jordan's PC)

The plan named "the web preview inside the desktop window (WebView2)". The installed app never shows
a preview in its WebView: `apps/desktop/src-tauri/src/main.rs` `on_new_window` sends a link that
`private_preview` accepts (127.0.0.1:4320, `/preview/<uuid>?ticket=<43 chars>`) to the system browser
and denies every new window. Try's "Open the private preview" link is `target="_blank"`, so in the
desktop app it opens in the default browser, which frames the site from `w<id>-<token>.localhost`.
What remains to observe on Jordan's PC: in the installed app, Try › a static web package › Start
private preview › Open: the default browser opens and the page shows. Not done here.

## Not done (needs Jordan's typed OK)

- **Live repair benchmark**: 3 attempts of `p14-repair-v1` on the ChatGPT plan, `plan_roles`,
  gpt-6-astra, caps from `expectations.json` (2 repairs, 6 requests each), at most 18 plan requests,
  $0, one run per attempt, on the dev studio running this branch, WSL2 worker. Records go to
  `tracking/evidence/p14-benchmarks/` as before.
- **Desktop preview look** as above, and the Windows export start with the PowerShell steps.
