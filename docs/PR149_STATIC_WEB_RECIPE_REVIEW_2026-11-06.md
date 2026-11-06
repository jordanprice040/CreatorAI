# PR #149 review: static web recipe (P15 slice 1, ADR-0078)

- Reviewed: branch `claude/project-thread-ja3wd1` at `dcfe74e` (2 commits over main `286c873`).
- Reviewer involvement: none. I did not write, design or earlier review any part of this PR.
- Date: November 6, 2026. Cloud container (Linux), not Jordan's WSL2 worker.

## Verdict

No High findings. Two Medium, seven Low. The sandbox layering (bwrap with no network, uid 1000,
read-only mounts, pinned browser verified by tree hash before every run) and the held-out
handling hold up. The two Mediums are about honest verification claims, not sandbox escapes.

## What I ran

- Installed the pinned browser with the PR's own `install_browser.py --zip` as uid 1000. The
  archive I downloaded matched the pinned SHA-256 (`0d5acc62…279daa`), and the tree hash matched.
- `p15-web-benchmark.mjs score` on the frozen reference: 10 of 10, 6 of 6 held out.
- The checker under the **bridge's exact bwrap argument list** (no `/etc/alternatives` bind,
  `/dev` and `/proc` remounted read-only; only systemd-run left out): 10 of 10, exactly one stdout
  line and no stderr. That matters because the opt-in real-checker test and the benchmark script use
  a slightly different sandbox (L-5).
- Hostile pages (results below): a worker fetch, a WebSocket, and `alert()`.
- `pnpm check` and `pnpm test:db` (results at the end).

## Medium

**M-1. "No request outside the site" misses workers and WebSockets, but the manifest still says
`network: 'none'`.** `packages/executor/worker/web_recipe.py:310-323` reads only
`Network.requestWillBeSent` events from the page's own session. Requests from dedicated, shared
and service workers go through their own targets (no `Target.setAutoAttach`). WebSockets show up as
`Network.webSocketCreated`. WebRTC is not visible at all. I ran it: the reference site plus
`new Worker('w.js')` (whose code calls `fetch('http://10.9.9.9/…')`) and
`new WebSocket('ws://10.1.2.3/x')` **passed all 10 cases** with `outbound: []`. Inside QA this is
harmless, since the sandbox has no network. But the verified manifest
(`packages/executor/src/artifacts.ts:315`, `network: 'none'`), the builder packet
(`build.ts:193`, "any request outside the site … fails the case") and ADR-0078 all claim a check
that is not made. And the exported package does reach the network in a normal browser. Fix: in the
checker, auto-attach to worker targets (flatten) and record their requests, count
`Network.webSocketCreated` as outbound, and either block RTCPeerConnection or say it isn't
checked. Add a hostile-page test for each.

**M-2. Web builds are admitted on qualifications measured only on Python, and nothing records
that.** ADR-0078 and `docs/STATIC_WEB_RECIPE.md` §7 say the web recipe is **not qualified** until
the frozen benchmark passes live. But role readiness (`build-roles-ready`,
`apps/api/src/connections.ts:104`) and qualification records ignore the recipe. Also,
`plan-qualification.ts` only accepts CLI cases. So a `plan_roles` web build goes through on the
Python `patch_build`/`independent_review` qualifications. Its verified manifest
(`artifacts.ts` limitations) then reads like any qualified build. That breaks invariant 8: the
"unqualified" state lives only in the docs. Fix: make the readiness and qualification keys
recipe-aware (refuse, or require an explicit unqualified-trial label), or at least write
"roles not qualified for static-web/1" into the manifest limitations and the build page.

## Low

**L-1. Dialogs and full-page navigation fail cases with an unclear reason, and the preview behaves
differently.** I added `alert('Welcome')` to the reference: every case failed with "The browser did
not answer in time" (`web_recipe.py:103-108`; nothing handles `Page.javascriptDialogOpening`). A
form submitted without `preventDefault`, or a link to another page, destroys the isolated world, so
the next step fails with a context error. Meanwhile the preview iframe allows modals
(`apps/api/src/artifacts.ts:901`). Neither limit is in `WEB_QA_RUNTIME.notes` (`build.ts:193`), so
the builder can't learn them and repair feedback won't explain them. Fix: dismiss dialogs and fail
with "page opened a dialog" (or drop `allow-modals`). Detect navigation and name it. List both in
the notes.

**L-2. Stop and Revoke don't end a frame that is already loaded.** The doc says a new link, Stop,
Revoke or expiry "ends older frames". In fact only new file requests are refused. On 403/410 the
preview page's script (`artifacts.ts:577`) only changes the status text, and the site stays usable.
Fix: remove the iframe (or set `src="about:blank"`) when the heartbeat says the preview ended.

**L-3. A frame request updates `last_seen_at` before its token is checked.**
`artifacts.ts:761` calls `store.previewFrame(id)`, which updates `last_seen_at`
(`packages/db/src/artifact-store.ts:794`), and only then compares the HMAC. A request with a stale
or forged token (an old frame after a new link, or any local process that knows the preview id)
still counts as a viewer for the "Until stopped" idle grace. It also tells live ids from dead ones
by error code. Fix: read the session hash without writing, check the token, then update.

**L-4. Typed steps don't round-trip as claimed.** `formatBrowserStep` says
`parseBrowserStep(formatBrowserStep(s))` gives `s` back (`packages/contracts/src/web-recipe.ts:206`).
It doesn't when a selector contains ` = `: `input[name = "x"]` parses back as selector
`input[name`. It also doesn't when a value has trailing spaces: `"  padded  "` comes back as
`"  padded"`. The form keeps stored steps until the text is edited
(`apps/web/src/spec-fields.ts`), but then one edit silently rewrites the other steps. Invalid CSS
selectors are also only found at QA time ("checker script failed"). Fix: refuse ` = ` inside
selectors, or split on the last ` = `. Keep values unchanged. Do a basic selector syntax check
before freeze.

**L-5. The benchmark script and the opt-in real-checker test don't use the bridge's sandbox or its
browser check.** `scripts/p15-web-benchmark.mjs:123-191` binds `/etc/alternatives`, prefers
`python3.12`, leaves out `--remount-ro /dev /proc`, and never checks the browser tree hash or
ownership (the bridge does, in `bridge.py` `browser_dir`). I confirmed the bridge-exact argument
list also passes 10 of 10 here, so this is about parity, not a live bug. But "exactly as studio QA
does" is not true, and `score` could grade with an unpinned browser. Fix: share one argument list
with `bridge.py` (or test the bridge's list), and check the tree hash in `score`.

**L-6. The preview banner's "with no network" is too strong.** The frame CSP blocks fetch, XHR,
workers, images and form posts. But the sandboxed frame can still navigate itself to any URL
(`location = 'https://…?data'`; CSP has no navigation control and the sandbox only blocks
top-level navigation and popups). WebRTC isn't blocked either. Nothing sensitive is reachable from
the frame, so the risk is low. But the banner (`artifacts.ts:641`) and the doc should say "no
fetches; links and navigation can leave". Or the page should notice when the frame leaves its
origin.

**L-7. A renderer exploit could forge the QA result.** Chrome runs with `--no-sandbox`
(`web_recipe.py:86`) as the same uid, in the same PID namespace as the checker. A compromised
renderer could open `/proc/<checker>/fd/1` or ptrace it, and print a passing `browser-qa/1` line.
bwrap still contains it (no network, read-only filesystem), so it can't escape. But a pinned
build only gathers known renderer bugs over time, and there is no update path besides a new
benchmark version. Fix: accept and record this in ADR-0078 with a plan for browser updates.
Better: run the browser under a separate uid or PID namespace from the checker (a nested bwrap
with `--unshare-pid`), with the CDP pipe as the only link.

## Checked and fine

- Held-out cases: role packets drop `browser_cases`. Repair feedback names a failed held-out
  case only by key. Execution logs never reach a packet. `acceptance.json` holds only
  `{page, steps}`, and the bridge refuses any other keys.
- Generated pages can't read `/acceptance.json`: the server is rooted at `site/`, file URLs are
  blocked from http, and snapshots are written as regular files only, so there are no symlinks.
- The checker's helpers run in an isolated world. Selectors and values go through `json.dumps`.
  Exactly one schema-checked result line is required, and the step count and indexes must match.
- Preview frame: an HMAC token per session hash, compared in constant time. Strict-SameSite studio
  cookies aren't sent to cross-site frames. `frame-ancestors` is the preview origin. Paths reject
  `..`, `.` and `\` after decoding. Only allowed types under `site/` are served, with `nosniff`.
  Hosted studios are refused.
- `install_browser.py`: refuses root. Checks the archive SHA-256 before extracting. Refuses
  absolute and `..` entries (Python's zipfile creates no symlinks). Checks the tree hash after
  extracting, then normalises file modes. Never runs sudo. The bridge then rechecks ownership,
  modes, symlinks and the tree hash before each run (about 0.6 s here).
- The 10 frozen bench files and the checker hash match `FREEZE.json` (the reference scored 10/10).

## Local checks

- `pnpm typecheck`: pass. `pnpm format:check`: pass.
- `pnpm test:db` (PostgreSQL 16, as root): 851 tests, 817 pass, 29 skipped, 5 fail. All 5 failures
  are the known PowerShell-wrapper tests (no `pwsh` in the container). The web-recipe fixture tests
  pass, and the real-checker test is skipped without a browser.
- `tests/dist/web-recipe.test.js` as uid 1000 with `CREATOR_TEST_BROWSER_DIR` set: the REAL
  CHECKER test **passes** (reference 10/10, all 9 known failures caught). Three fixture tests failed
  in that run only because uid 1000 can't write the root-owned `.verification/` folder. They pass
  in the root run, so this is not a PR problem.
- Pushed nothing.
