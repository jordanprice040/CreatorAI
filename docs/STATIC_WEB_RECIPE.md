# Static web recipe (`static-web/1`): design, limits and device setup

P15 slice 1 of the [November 5 plan](CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), the first item of
the [P14 matrix](CAPABILITY_MATRIX_2026-11-05.md) P15 order. Decision record: ADR-0078 in
[tracking/DECISIONS.md](../tracking/DECISIONS.md). No migration.

**Status (November 6, 2026):** implemented and tested in the cloud container (fixture builds, contract
tests and the real checker in Linux Bubblewrap with the pinned browser). **Not yet run on Jordan's WSL2
worker and not role-qualified.** Both need the owner steps in sections 6 and 7.

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
5. passes the case only when every step passes, no uncaught page error happened and no request left
   the site; it prints one `browser-qa/1` JSON line.

The studio accepts exactly one well-formed result line per case and a zero exit code. The bridge
verifies the browser tree's SHA-256 and ownership before every web run, so a changed browser fails
the run instead of grading it.

## 5. Preview

A static web preview opens the usual preview page on the 127.0.0.1 preview origin (same ticket,
session, heartbeat, Stop and "Until stopped" rules as ADR-0069). The page frames the site from
`w<preview id>-<token>.localhost:<preview port>`, a different host and so a different origin and site
from both the studio and the preview page:

- the token is an HMAC of the preview id and its current session hash under a per-process key, so a new
  link, Stop, Revoke, expiry or a studio restart ends older frames;
- every file request rechecks the preview lease and re-hashes the package;
- files are served with a CSP that allows only the site's own files and inline code
  (`connect-src 'none'`, `form-action 'none'`, `frame-ancestors` the preview origin), in a sandboxed
  iframe (`allow-scripts allow-forms allow-same-origin allow-modals`);
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
node scripts/p15-web-benchmark.mjs score p15-small-signup-v1 config/web-benchmarks/p15-small-signup-v1/reference
```

Expected: 10 of 10, 6 of 6 held out.

## 7. Qualification packet (live, needs Jordan's typed OK)

The roles keep their prompts (`builder/1`, `independent-reviewer/2`); the builder packet's
`qa_runtime` describes the web checker. Their qualifications were measured on Python tasks only, so
the web recipe is **not qualified** until this benchmark passes live.

- Benchmark `config/web-benchmarks/p15-small-signup-v1` (frozen; `FREEZE.json` includes the checker hash):
  one sign-up page, one task, 5 browser checks, 10 studio cases of which 6 are held out.
  `scripts/p15-web-benchmark.mjs verify` checks the freeze and that the spec parses unchanged with
  the studio's own schema and builds with `static-web/1`; `mutants` checks that all 9 listed known
  failures are caught by the cases named for them.
- Route: `plan_roles` on the dev studio, $0. Caps per attempt: `max_repairs` 1, `max_calls` 4,
  8,000 output tokens. Expected 2 requests per attempt, at most 4; 3 attempts, at most 12 requests.
- Pass bar per attempt and what to record: `expectations.json`. Qualified at its declared scale only
  at 3 of 3; nothing is re-run to replace a failure.
- Also record: whether the private preview shows the page in its frame in the desktop app (WebView2)
  and in a normal browser. Both resolve `*.localhost` to loopback by design, but this was not observed.

## 8. Checks run for this slice (cloud container, Linux)

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
- Hosted studios refuse web previews until the staging design's preview host exists.
