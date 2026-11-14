# Static web recipe (`static-web/1`): design, limits and device setup

P15 slice 1 of the [November 5 plan](CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), the first item of
the [P14 matrix](CAPABILITY_MATRIX_2026-11-05.md) P15 order. Decision record: ADR-0078 in
[tracking/DECISIONS.md](../tracking/DECISIONS.md). No migration.

**Status (November 6, 2026):** implemented and tested in the cloud container (fixture builds, contract
tests and the real checker in Linux Bubblewrap with the pinned browser), then revised after the PR #149
review (section 10). **Live qualification, November 6 (section 11): 3 of 3 on Jordan's WSL2 worker**,
on the ChatGPT-plan connection `4e4a7bec…` with `gpt-6-astra` and the current role prompts, at $0. Web
builds on exactly that connection, model and prompt pair are qualified; every other web build is still
labelled an unqualified trial.

## 1. What it builds

One static web page or a small set of pages: plain HTML, CSS and JavaScript under `site/`, served as
files. No packages, CDN, build step, server code or network. Typical fit: a form with client-side
validation, a calculator, a small single-page tool with `#routes` and `localStorage`.

A product starts from the reviewed `static-site/1` template: `site/index.html`, `site/style.css`,
`site/app.js` and `readme.md`. The checker accepts at most 60 files under `site/` with the types
`.html .css .js .mjs .json .svg .txt .md`, and `site/index.html` must exist.

## 2. How a spec chooses it

The recipe comes from the frozen acceptance checks of a task, never from a model:

| Every check of the task is…                      | Recipe                       |
| ------------------------------------------------ | ---------------------------- |
| `automated_test` with `cases` (CLI stdin/stdout) | `python-build/1` (unchanged) |
| `browser_check` with `browser_cases`             | `static-web/1`               |
| a mix of both                                    | refused in words, no build   |

Build notes in the spec form also say when a web task is missing browser cases, has more than 10, has no
held-out case, or its file scope does not include `site`. A product records `recipe: 'static-web/1'`; a
product without the field is Python, so every existing product and manifest is unchanged.

## 3. Browser cases

A browser case is data: a page (`/`, `/x.html`, optionally `#route`), 1 to 25 steps and `held_out`.
The spec form takes one step per line, `<command> <selector> [= <value>]`:

```
fill #name = Ada
select #plan = pro
click #submit
expect text #done = Welcome, Ada! You chose the Pro plan.
expect hidden #errors
```

Commands: `click`, `check`, `fill`, `select`, `press`, `goto` (changes `location.hash`), and
`expect text`, `expect contains`, `expect visible`, `expect hidden`, `expect count`, `expect title`.
A case needs at least one `expect` step. A selector must match exactly one element (except
`expect count`). `expect text` compares whitespace-collapsed visible text, or a field's value.
Each expectation waits up to 3 seconds. Held-out cases never reach a builder or reviewer packet,
like CLI cases.

The typed form round-trips: only the start of a line is trimmed, so a value keeps its spaces. A
selector cannot contain `=` with spaces (the line splits at the first one; `[name="x"]` is fine), and a selector with unbalanced quotes,
brackets or parentheses, or a dangling combinator, is refused before the spec is frozen.

## 4. How QA runs a case

`packages/executor/worker/web_recipe.py` is the reviewed checker. The bridge starts it with
`--recipe static-web/1` inside the same Bubblewrap + systemd unit as Python QA, with the web policy:
1 GiB memory, 512 tasks, 100% CPU, 60 seconds, 64 MiB work, 256 MiB tmp, loopback-only network in the
sandbox's own namespace. Uid, lease, log and no-network rules are unchanged; Stop ends the whole unit
(process tree).

For each case the checker:

1. copies the candidate snapshot and checks the site's shape (index.html, file count, file types);
2. serves `site/` on a loopback-only HTTP server inside the sandbox;
3. starts the pinned Chrome for Testing headless shell 156.0.8078.47 with `--remote-debugging-pipe`
   (no debugging socket) and a fresh profile, so storage starts empty;
4. runs the steps in an isolated JavaScript world, so page scripts cannot replace the checker's
   functions (tested with a page that overrides `querySelectorAll`);
5. passes the case only when every step passes, no uncaught page error happened and nothing tried
   to reach outside the site; it prints one `browser-qa/1` JSON line.

"Outside the site" covers requests from the page and from every dedicated worker (auto-attached
and paused until the checker records their traffic), WebSockets, and WebRTC (its constructors are
replaced before page scripts run, and a call is recorded). A service worker, a shared worker or a
popup window (`window.open`) is not supported and fails the case. After the last step the page keeps
running for 1 second (`SETTLE_SECONDS`) before the checker reads what happened.

What this establishes is **no outside request was seen during the frozen cases** (while they ran, plus
that second). A dynamic check cannot prove that a page never makes a request: a timer that fires later
is not seen. The QA sandbox has no network either way. The exported package runs in an ordinary
browser, where only the code review and the owner's preview stand behind `network: none`.

A case stays on one document. A dialog (`alert`, `confirm`, `prompt`) is dismissed and fails the case
with "the page opened a dialog". Loading another document (a form submitted without `preventDefault`,
a link to another page, a location change other than the hash) is detected when it is requested and
fails the case with that reason, including within the settle second after the last step. The builder packet's
`qa_runtime` notes say all of this, so repair feedback can explain it.

The studio accepts exactly one well-formed result line per case and a zero exit code. The bridge
verifies the browser tree's SHA-256 and ownership before every web run, so a changed browser fails
the run instead of grading it.

## 5. Preview

A static web preview opens the usual preview page on the 127.0.0.1 preview origin (same ticket,
session, heartbeat, Stop and "Until stopped" rules as ADR-0069). The page frames the site from
`w<preview id>-<token>.localhost:<preview port>`, a different host and so a different origin and site
from both the studio and the preview page:

- the token is an HMAC of the preview id and its current session hash under a per-process key, so a new
  link, Stop, Revoke, expiry or a studio restart refuses every later request of an older frame;
- when the preview page's heartbeat says the preview ended, the page removes the frame, so a site
  already loaded stops being usable too;
- every file request checks its token inside the lease lookup, before the preview counts a viewer, then
  re-hashes the package; a stale token, a stopped preview and an unknown id all get the same 403;
- files are served with a CSP that allows only the site's own files and inline code
  (`connect-src 'none'`, `form-action 'none'`, `worker-src 'none'`, `frame-ancestors` the preview
  origin), in a sandboxed iframe (`allow-scripts allow-forms allow-same-origin`; no modals, matching QA);
- the site cannot fetch or send data, but CSP does not control navigation: a link or a location change
  can still open another site inside the frame. The banner says so;
- only files under `site/` are served; the readme, manifest and other files are 404;
- web previews have no command runs and no terminal, and hosted studios refuse them for now.

The exported package's `startup` says how to open it anywhere:
`python3 -m http.server 8000 --bind 127.0.0.1 --directory site`.

## 6. Owner setup on the WSL2 worker (device step, needs Jordan's typed OK)

The studio never downloads or installs anything. Inside the reviewed WSL distribution, as the normal
user (uid 1000), from the repository checkout:

```
python3 -I packages/executor/worker/install_browser.py
```

It downloads the pinned archive from `storage.googleapis.com/chrome-for-testing-public`, refuses it unless
its SHA-256 is `0d5acc62…279daa`, checks the extracted tree hash `2f84beb6…47d141`, and installs it under
`~/.local/share/creator-agent/browser/chrome-headless-shell-156.0.8078.47`. If downloads are blocked,
download the zip yourself and pass `--zip FILE`. It then prints the apt command for the browser's
system libraries (it never runs sudo). On Ubuntu 22.04 drop the `t64` suffixes.

Check it with the frozen benchmark reference (no model call):

```
node scripts/p15-web-benchmark.mjs score p15-small-signup-v4 config/web-benchmarks/p15-small-signup-v4/reference
```

Expected: 10 of 10, 6 of 6 held out.

## 7. Qualification packet (live, needs Jordan's typed OK)

The roles keep their prompts (`builder/1`, `independent-reviewer/2`); the builder packet's
`qa_runtime` describes the web checker. Their qualifications were measured on Python tasks only, so
the web recipe is **not qualified** until this benchmark passes live.

- Benchmark `config/web-benchmarks/p15-small-signup-v4` (frozen; `FREEZE.json` includes the checker hash):
  one sign-up page, one task, 5 browser checks, 10 studio cases of which 6 are held out.
  `scripts/p15-web-benchmark.mjs verify` checks the freeze and that the spec parses unchanged with
  the studio's own schema and builds with `static-web/1`; `mutants` checks that all 16 listed known
  failures are caught by the cases named for them (9 behaviour bugs, plus a worker request, a
  WebSocket, WebRTC, an alert dialog, a native form submit, a popup window and a request 600 ms after
  the first input). The hostile ones must also fail for their own reason (`reason_contains`). v1, v2
  and v3 were frozen and replaced before any live run, because the reviews changed the checker; cases,
  spec content and reference are unchanged.
- Until it passes, every `static-web/1` build is an **unqualified trial**: its manifest carries
  `toolchain.role_qualification: 'unqualified_trial'` and a limitation saying so, and the build and Try
  pages show it. There is no global switch (review L-9): `unqualifiedTrial` in
  `packages/contracts/src/web-recipe.ts` lifts the label only for a build whose own connection, model
  and both role-prompt hashes match a recorded pass. Since ADR-0105 (November 14) the passes are
  database records (`recipe_qualifications`, earned under Models › Qualify building on the in-app
  `p15-small-signup-v5`, or imported: the November 6 pass below). A pass on one connection, model or prompt version
  never qualifies another. The prompt hashes come from the prompts the build recorded in its
  `intent.json` when it started, not from the code at packaging time, and only a pass on the recipe's
  current benchmark version (`RECIPE_BENCHMARKS`, checked by `verify`) counts (third review L-10). The
  build page reads the newest package's own label rather than a fixed sentence (L-11).
- Route: `plan_roles` on the dev studio, $0. Caps per attempt: `max_repairs` 1, `max_calls` 4,
  8,000 output tokens. Expected 2 requests per attempt, at most 4; 3 attempts, at most 12 requests.
- Pass bar per attempt and what to record: `expectations.json`. Qualified at its declared scale only
  at 3 of 3; nothing is re-run to replace a failure.
- Also record: whether the private preview shows the page in its frame in the desktop app (WebView2)
  and in a normal browser. Both resolve `*.localhost` to loopback by design, but this was not observed.

## 8. Checks run for this slice (cloud container, Linux)

After the third review (section 10): the v4 reference passes 10 of 10 and all 16 known failures are
caught, each hostile one for its own reason, through `scripts/p15-web-benchmark.mjs`, which now runs the bridge's own
`sandbox_args` list and `verify_browser` check (the only host difference, binding `/etc/alternatives`
because this container's `python3` resolves through it, is reported as `sandbox_deviations`). A page
that registers a service worker also fails. The first run of this section was:

- `tests/src/web-recipe.test.ts`: step parser, recipe rules and refusals, template and product
  recipe, a fixture build that verifies and packages a `static-web/1` manifest with held-out cases kept
  out of packets, recipe crossing refusals, browser verdict negatives, frame-host path mapping, and the
  preview frame host (token bound to the session, CSP, forged token, new link, Stop, no command runs).
- The same file's opt-in REAL CHECKER test (`CREATOR_TEST_BROWSER_DIR`): the reference passes 10 of 10
  in Bubblewrap with Chrome 156, and all 9 known failures are caught. About 0.8 seconds per case.
- Manual negative runs of the checker: wrong text, outbound fetch and image, uncaught page error,
  disallowed file type, missing selector and a hostile page that overrides DOM functions.
- `install_browser.py` installed and verified the pinned build as uid 1000.

## 9. Limits and what is not covered

- Qualified only for one connection, model and role-prompt pair at the declared small scale (section
  11). Other connections, models or prompt versions stay unqualified trials. The repair path was not
  exercised live (no attempt needed a repair), and the desktop app's WebView2 frame was not observed.
- No packages, Node toolchain, bundlers or frameworks: pinned Node and dependency acquisition inside
  isolation are a later slice, and with them hostile build scripts and dependency failures.
- No server code, API, database or network, so readiness, restart and secret/network separation reduce
  to the static file server and the CSP above.
- No accessibility smoke check yet (the P14 matrix lists it for this row).
- At most 10 cases per build and 25 steps per case; one browser build and version.
- Multi-page sites are served, but a case cannot follow a link to another page (section 4).
- A renderer exploit could forge QA results (section 10, L-7).
- Hosted studios refuse web previews until the staging design's preview host exists.

## 10. Review fixes (PR #149 review, November 6)

The [review](PR149_STATIC_WEB_RECIPE_REVIEW_2026-11-06.md) (no High)
found two Medium and seven Low issues. All were fixed before any live run:

- **M-1** worker, WebSocket and WebRTC traffic now fails a case; service and shared workers are refused
  (section 4).
- **M-2** web builds are labelled unqualified trials until the web benchmark passes live (section 7).
- **L-1** dialogs and document loads fail with named reasons; the preview frame no longer allows modals.
- **L-2** the preview page removes the frame when the preview ends.
- **L-3** the frame token is checked before the viewer is counted, and every refusal looks the same.
- **L-4** typed steps round-trip; selectors with `=` or an unbalanced shape are refused.
- **L-5** the benchmark script uses the bridge's sandbox list and browser check (section 8).
- **L-6** the banner and preview text say that links can still leave the site.
- **L-7, accepted and recorded.** Chrome runs with `--no-sandbox` (its own sandbox needs user
  namespaces, which the QA sandbox disables), as the checker's uid and in its PID namespace. A
  renderer exploit would therefore control the browser process, and with it the DevTools answers the
  checker grades; it could also ptrace the checker (confirmed possible in this container). It cannot
  leave the QA sandbox: no network, a read-only filesystem, the systemd unit's limits and lifetime. A
  forged pass would still face the independent reviewer, who reads the code, and the owner's preview.
  Hardening the checker alone (for example making it non-dumpable) would not help while the browser
  itself answers the checks, so it was not added. **Browser update plan:** the pinned version is
  re-checked against Chrome for Testing security releases at each P15 slice and at least monthly; an
  update is a reviewed change of `install_browser.py` and the bridge hashes, plus a new benchmark
  version, since the freeze binds the checker. Running the browser under its own sandbox (allowing a
  user namespace for it alone) is the larger fix and needs its own ADR.

**Re-review (same day, at `aec1dc2`; no High or Medium).** Fixed: L-8 popups fail the case and the page
gets a 1 s settle after the last step; the docs, ADR and manifest claim only what was seen during the
cases (section 4). L-9: per-connection recipe qualification, no global switch (section 7). N-1: hostile
known failures pin their reason. N-2: selector wording; an escaped trailing character is accepted.
N-3: the superseded ADR-0078 bullets are marked. N-4: `PINNED_BROWSER` (contracts, checked equal to the
bridge) records the pin date, and the build page shows when the monthly security re-check is due or
overdue. Benchmark v2 became v3 before any live run.

**Third review (same day, at `e9b5a68`; no High or Medium).** Fixed: L-10, the trial label's role
hashes come from the prompts recorded in the build's `intent.json` (a mismatch with its recorded
prompt hash, or no plan roles, means no roles and a trial), and a pass counts only on the recipe's
current benchmark version (`RECIPE_BENCHMARKS` in contracts). L-11, the build page's notice states the
newest package's own `role_qualification` (now also on artifact summaries) instead of "None has yet".
N-a, the qualification list sits after the imports. N-b, popups and service or shared workers are
reported in the checker's own `unsupported` list, apart from `outbound` (outside requests only), and a
case passes only when both are empty; the reason names the kind without its URL. Because that changed
the checker, benchmark v3 became `p15-small-signup-v4` before any live run (cases, spec content and
reference unchanged). N-c, the selector shape check pairs escapes left to right, so an escaped
backslash followed by a comma is refused.

## 11. Live qualification (November 6, 2026)

Run on Jordan's PC under his typed OKs (11:28 and 20:24 UTC). Raw summary:
[RESULTS_P15_V4_2026-11-06.json](../tracking/evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json)
(per-attempt files stay on the device, gitignored).

- Setup: the pinned browser was installed in WSL as uid 1000 by `install_browser.py` (hashes verified);
  Jordan installed the system libraries with apt. `verify` ok; the reference scored 10/10 there with no
  sandbox deviation. The dev studio (`creator_studio`, backed up first, migrated 48 to 49) ran from the
  PR #149 head `b73bd95`; the worker used that worktree's `bridge.py` and checker (hash equals FREEZE).
- Route: `plan_roles` on connection `4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4`, model `gpt-6-astra`, builder
  prompt `73cb799e…`, reviewer prompt `9e1cc6b4…` (from each build's `intent.json`, matching its prompt
  hash). 6 plan requests in all (UTC day 16 to 22 of 40), $0, credits off.
- Each of the 3 attempts: its own run, selection, spec (equal to `spec.json` content) and product;
  `verified_candidate` in 2 requests with no repair round in 64.8 to 67.6 s; QA 10/10 in the WSL2
  worker (6/6 held out); reviewer approved with no findings; package verified; the exported package
  scored 10/10. No attempt was replaced and no patch was refused. The driver's own spec comparison
  stopped attempt 1's setup once (it compared the stored record envelope); it was fixed before any
  request.
- Owner observation: Jordan opened attempt 1's private preview in Chrome and the sign-up page showed in
  its frame ("it showed up!", with screenshots). Only that product was opened, as section 7 asks; the
  desktop app (WebView2) was not observed because the installed app shares the dev studio's ports.
- Result: **3 of 3, qualified at the declared scale** for that connection, model and prompt pair. The
  pass was recorded in `RECIPE_QUALIFICATIONS` (`packages/executor/src/artifacts.ts`; since ADR-0105 an
  imported database record, migration 65) with
  `benchmark_id` `p15-small-signup-v4`; a test checks the record against the results file, the current
  role prompts, `RECIPE_BENCHMARKS` and the freeze hash. The three packages made during the run were
  labelled unqualified trials when packaged, and keep that label: a manifest is not rewritten.
- Owner observation of attempts 2 and 3 (PR #150 review M-1, resolved November 10): Jordan opened their
  private previews in Chrome and both showed the sign-up page in its frame (screenshots and hashes in the
  results file). Every line of the frozen per-attempt pass bar is now met for 3 of 3 attempts. These two
  were observed four days after the runs, on the same packages and dev studio code.
