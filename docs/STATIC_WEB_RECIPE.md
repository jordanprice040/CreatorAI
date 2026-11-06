# Static web recipe (`static-web/1`): design, limits and device setup

P15 slice 1 of the [November 5 plan](CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), the first item of
the [P14 matrix](CAPABILITY_MATRIX_2026-11-05.md) P15 order. Decision record: ADR-0078 in
[tracking/DECISIONS.md](../tracking/DECISIONS.md). No migration.

**Status (November 6, 2026):** implemented and tested in the cloud container (fixture builds, contract
tests and the real checker in Linux Bubblewrap with the pinned browser), then revised after the PR #149
review (section 10). **Not yet run on Jordan's WSL2 worker and not role-qualified.** Both need the owner
steps in sections 6 and 7; Jordan gave his typed OK on November 6, held until the fixes are re-reviewed.

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
selector cannot contain `=` (the line splits at the first one), and a selector with unbalanced quotes,
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
replaced before page scripts run, and a call is recorded). A service or shared worker is not
supported and fails the case. The QA sandbox has no network anyway; these checks make the manifest's
`network: none` a checked claim rather than an assumption.

A case stays on one document. A dialog (`alert`, `confirm`, `prompt`) is dismissed and fails the case
with "the page opened a dialog". Loading another document (a form submitted without `preventDefault`,
a link to another page, a location change other than the hash) is detected when it is requested and
fails the case with that reason, even if it starts after the last step. The builder packet's
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
node scripts/p15-web-benchmark.mjs score p15-small-signup-v2 config/web-benchmarks/p15-small-signup-v2/reference
```

Expected: 10 of 10, 6 of 6 held out.

## 7. Qualification packet (live, needs Jordan's typed OK)

The roles keep their prompts (`builder/1`, `independent-reviewer/2`); the builder packet's
`qa_runtime` describes the web checker. Their qualifications were measured on Python tasks only, so
the web recipe is **not qualified** until this benchmark passes live.

- Benchmark `config/web-benchmarks/p15-small-signup-v2` (frozen; `FREEZE.json` includes the checker hash):
  one sign-up page, one task, 5 browser checks, 10 studio cases of which 6 are held out.
  `scripts/p15-web-benchmark.mjs verify` checks the freeze and that the spec parses unchanged with
  the studio's own schema and builds with `static-web/1`; `mutants` checks that all 14 listed known
  failures are caught by the cases named for them (9 behaviour bugs, plus a worker request, a
  WebSocket, WebRTC, an alert dialog and a native form submit). v1 was frozen and replaced before any
  live run, because the review changed the checker; cases, spec content and reference are unchanged.
- Until this passes, every `static-web/1` build is an **unqualified trial**: its manifest carries
  `toolchain.role_qualification: 'unqualified_trial'` and a limitation saying so, and the build and Try
  pages show it (`QUALIFIED_RECIPES` in `packages/contracts/src/web-recipe.ts` lists only
  `python-build/1`; a recipe is added there only with the live results that qualify it).
- Route: `plan_roles` on the dev studio, $0. Caps per attempt: `max_repairs` 1, `max_calls` 4,
  8,000 output tokens. Expected 2 requests per attempt, at most 4; 3 attempts, at most 12 requests.
- Pass bar per attempt and what to record: `expectations.json`. Qualified at its declared scale only
  at 3 of 3; nothing is re-run to replace a failure.
- Also record: whether the private preview shows the page in its frame in the desktop app (WebView2)
  and in a normal browser. Both resolve `*.localhost` to loopback by design, but this was not observed.

## 8. Checks run for this slice (cloud container, Linux)

After the review (section 10): the v2 reference passes 10 of 10 and all 14 known failures are caught,
in two consecutive runs, through `scripts/p15-web-benchmark.mjs`, which now runs the bridge's own
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

- Not run on WSL2 and not qualified (sections 6 and 7).
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
