## PR #110 review fixes: right sidebar (M-1, M-2, L-1–L-5) — November 2, 2026

Fresh review of PR #110 at `293a4e0` (`/mnt/project-files/reviews/PR110_RIGHT_SIDEBAR_REVIEW_2026-11-02.md`): two Medium, five Low; all fixed in the same PR, ADR-0060 amended, main merged (PR #106 moved the theme toggle; the sidebar's top-bar button sits beside it). M-1: notes over about 64 KiB never saved (API body limit); the notes route now accepts 6 × NOTE_MAX + 1 KiB. M-2: text typed while the "changed in another window" card was open was lost when the notepad unmounted; unsaved text now lives in the tab's session storage with its base version and comes back with the choice still open. L-1 a failed save no longer retries every second. L-2 in-flight plan requests older than 30 minutes show "no answer recorded" without a spinner. L-3 paused or waiting workflows read "paused", "waiting for you", "waiting on another step", no spinner, and are not counted as running (new `active` field). L-4 page close sends a keepalive save when it fits under 60 KB. L-5 a removed member's notes are deleted; migration 37's foreign keys cascade (37 is unmerged, so its checksum changed: recreate any throwaway database migrated with the earlier 37).

Checks (cloud, PostgreSQL 16): typecheck and prettier pass; `sidebar.test.ts` + `storage.test.ts` 12/12 (new: a 100,000-character note of escaped characters saves through the route and one more is refused with 400; notes gone after remove and re-add; a 31-minute-old in-flight request is inactive and labelled). Browser walk re-run on a fresh seeded database: all earlier checks plus text typed during a conflict survives fold and reopen and is kept, and a 70,000-character note saves (200); no console errors.

## Right-hand sidebar: activity and notes (ADR-0060, migration 37) — November 2, 2026

Jordan asked (Nov 2) for a right-hand sidebar to use the empty space on fullscreen windows, with current activity and a notepad. Design https://claude.ai/artifact/7HG4pShk39BoexPw1e6SNX; Jordan chose one notepad per workspace. The studio now has an Activity / Notes panel on the right: docked open (320 px) from 1500 px wide and foldable to a rail (remembered), a rail with a slide-over panel from 1100 px, and a top-bar drawer below that; Ctrl+. toggles it. Activity shows "Running now" (in-flight plan requests, unfinished workflows, product runs on a paired computer) and the latest 15 activity entries with new-entry dots, refreshed every 15 s while visible. Notes is each person's own notepad per workspace, saved as they type, with a choice when another window saved first. New: `workspace_notes` (migration 37), routes `GET/POST workspaces/{ws}/notes` and `GET workspaces/{ws}/activity-now`, `packages/contracts/src/sidebar.ts`, `packages/db/src/sidebar-store.ts`, `apps/web/src/aside.tsx` + `aside.css`; `api()` gains a `quiet` option so note saves do not reload pages.

Checks (cloud, PostgreSQL 16): typecheck and prettier pass; new `tests/src/sidebar.test.ts` (4 DB tests: per person and per workspace, versions, same text is not a new version, stale and duplicate-first saves conflict, nothing written to the audit history, non-members get NOT_FOUND, length cap and extra fields refused; three concurrent first saves and three concurrent later saves each leave exactly one winner; running-now lists only this workspace's in-flight requests; routes need sign-in and CSRF and return 409 on a stale save). Browser walk on a throwaway seeded database (`tracking/evidence/right-sidebar/walk.mjs`, screenshots in `screens/`, results in `walk.json`): docked at 1600 px with no overlap, notes saved and reloaded, fold remembered across reload, Ctrl+. unfolds, second-window conflict asked and resolved, rail and overlay with Esc at 1280 px, drawer within the window and no horizontal scroll at 960 and 390 px (light), no console errors. Full suite 624 tests: 592 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh); `storage.test.ts` now expects schema 37. Not live on the dev studio or installed app (needs schema 37). Next free: migration 38, ADR-0061 (verify on main; ADR-0059 is the terminal-rerun PR #109).

## PR #106 review fixes: Markdown chat answers (M1, L1–L4, N1) — November 2, 2026

Fresh review of PR #106 at `def43e0` (`/mnt/project-files/reviews/PR106_MARKDOWN_CHAT_REVIEW_2026-11-02.md`): one Medium, four Lows, one nit, no High. All fixed in the same PR. There is no migration and no ADR.

- M1: the desktop app's studio window opens no new windows (`apps/desktop/src-tauri/src/main.rs`), so an answer link there would do nothing and hide its address. In the desktop app (`managed_by: desktop_app`) a link now shows as its words, then its address in monospace (selectable), then a Copy button; no anchor is created. In a browser it stays a new-window link with the address as its title. Opening links in the system browser from the desktop app was not added: that changes what the management window may hand to the OS and would need its own decision. The same dead-link pattern still exists in `checkout.tsx` and `models.tsx` (pre-existing, not changed here).
- L1: bare-link trimming counts parentheses once instead of once per trailing `)`, and heading closers (`## Title ##`) are trimmed by a scan instead of a backtracking regex.
- L2: a link's label never contains another link (no autolinks, `<url>` or `[..](..)` inside a label), so `[https://a](https://b)` is one link to b.
- L3: a table directly after a text line (no blank line) is recognised when the next line is a separator with the same number of cells.
- L4: new tests for L1 (a 20k `)` run, a 190k-space heading and a 20k `[` run must each parse in under 200 ms), L2 and L3, plus closer and `C#` heading cases.
- N1: answer bullets use disc, then circle, then square, whatever list they sit in.
- Also fixed: table cells were parsed with `.map(inline)`, which passed the column index as the nesting depth.

Checks (cloud, PostgreSQL 16): typecheck and prettier pass. `node --test` ran 625 tests: 388 pass, 5 fail (the known PowerShell-wrapper tests) and 232 skipped (database tests). `web-markdown.test.ts` passes 9 of 9. I re-ran the walk with a labelled link added to the fake answer. In a browser, both links are anchors with `title` set to the address, and bullets are disc. With the auth status rewritten to `desktop_app`, there are 0 anchors, and the links read "https://example.com/docs Copy" and "the getting-started guide (https://example.com/docs/start) Copy" (screenshot `screens/desktop-links-dark.png`). There were no page errors. The Copy button's clipboard write was not clicked in the walk, and the installed app itself was not tried.

## Chat answers show formatted Markdown; theme button moves to the sidebar foot — November 2, 2026

Jordan's Nov 2 notes after the upgrade: model answers in Chat showed raw Markdown (`**bold**`, `### Its purpose`, `- items`), and the light/dark button wrapped onto its own top-bar line when the window was not full screen. No migration, no ADR, no server change; display only.

- Chat answers (`AnswerView` in `apps/web/src/chat-answers.tsx`) now render through a small built-in Markdown reader (`apps/web/src/markdown.ts`, no new dependency) and `markdown-view.tsx`, which maps its tree to React elements only (no `dangerouslySetInnerHTML`). Covered: headings (shown at h4–h6 so they sit under the page's own headings), paragraphs with line breaks, bold, italic, strikethrough, inline code, fenced code, bulleted and numbered lists (nested), quotes, tables with alignment, rules, `[text](url)`, `<url>` and bare https links. Safety: any HTML in an answer stays visible text; a link keeps its href only when it is an absolute `http(s)` URL with a host or `mailto:`, otherwise its words show without a link; links open in a new window with `noopener noreferrer`, like the app's other external links. Nesting is capped at 8 levels and text past 200,000 characters stays plain; unmatched marks (`2 * 3`, `snake_case`) stay literal. The user's own messages and the studio's rule replies are unchanged (plain text). The text sent to the model and the stored answer are unchanged; the chat instructions (`chat-assistant-v1`) were not edited.
- In the studio, the theme button now sits in the sidebar foot just above "Schema 1.0 · Local control" (on phone width it is in the slide-out menu); signed out, where there is no sidebar, it stays in the top bar.

Checks (cloud, PostgreSQL 16): typecheck and prettier pass; `pnpm test` 622 tests, 385 pass, 5 fail (the known PowerShell-wrapper tests, no `pwsh` in the container), the rest skipped (database tests; no test database set, and this change touches no server code). New `tests/src/web-markdown.test.ts` (6: the screenshot's answer shape, HTML kept as text and only safe links kept, code keeps its characters, unmatched/intraword marks stay literal, nested lists/quotes/tables/rules, depth and length bounds). Browser walk `tracking/evidence/chat-markdown/walk.mjs` against `serve.mjs` (throwaway database, fake `claude`, no real model, $0): the answer renders headings, bold, a nested list, a table, code, a quote and one safe link (`https://example.com/docs`, `_blank`, `noopener noreferrer`); the `javascript:` link has no href, `<img onerror>` and `<script>` show as text with 0 such elements created, no `**`/`###` left; theme button in the sidebar foot above "Schema 1.0" at 1280, 1195 (Jordan's window width) and in the phone menu, and it still switches the theme; no page errors; no horizontal overflow at 390 px. Screenshots in `tracking/evidence/chat-markdown/screens/` (dark, light, 1195 px window, phone). Ad hoc timing on hostile 100–200k-character inputs: all under 0.7 s.

Limitations: not checked on the installed app or with a real model answer (fixture text only); images, footnotes, task-list checkboxes and HTML are not rendered (shown as text); a link's label inside a refused link is kept as plain words. At 1195 px the top bar still uses two lines (page name, then status and usage), but the button no longer adds a third. Other items in Jordan's Nov 2 message (re-running a product in the same window, a how-to/arguments section, background-completion indicators) are handled in other threads.

## Run in a terminal: live check on Jordan's PC and re-review fixes (ADR-0058 follow-up) — November 1, 2026

Live check (Jordan's device, PR #104 checkout `C:\dev\creator_agent_pr104`, throwaway product store via `tracking/evidence/terminal-live/run.mjs`, real timing-analyzer v4 package, no database, $0; result JSON files stay on the device under `tracking\evidence\terminal-live\`). The launcher is `cmd.exe /d /s /c "start "Creator Agent" /wait wsl.exe …"`; on this PC Windows hands the window to Windows Terminal 1.24.12741.0 (a tab titled with the bwrap command); WSL systemd 259. Results: practice runs end `ended`, exit 0, with the unit limits read back (RuntimeMaxSec 15 min, CPU 50%, MemoryMax 256 MiB, no swap, TasksMax 32, KillMode control-group); Stop after 3 s → `stopped` about 1.6 s later; closing with X mid-run → `window_closed` (reached through the studio's reap; the bridge's SIGHUP handler did not get to write `result.json` first), with no `creator-term-*` unit, bwrap or program left running; Jordan's own timing run → `ended`, exit 0; his impression (one run, not measured): "felt pretty similar to the PowerShell one", not sure it was exactly the same. Apparent "phantom Enter presses" in an earlier run were Jordan pressing along with the beats: six probe windows launched the same way (plain wsl.exe, `systemd-run --pty` raw and line mode, the product's exact unit and bwrap flags, the full product path with an input-logging program and with an input-logging copy of practice mode) received 0 bytes untouched. Not checked live: Ctrl+C (documented as "quit with the program's own keys", review L-3); direct conhost launch no longer starts its program on this PC, so it was not used.

Re-review at `b7fd106` (`/mnt/project-files/reviews/PR104_RUN_IN_TERMINAL_REREVIEW_2026-11-01.md`): no High or Medium. Fixed here: N-1 (a start that failed after creating its folder but before `intent.json` left a folder that made every later list for that product throw) — `launch()` now removes the folder on any failure before the intent, and `list()` skips any folder with no intent; N-2 (blocked paths released the slot before writing the outcome) — the slot is now released after `settle()`; nit — the concurrency test now asserts refused starts leave no folder. New test: a duplicate package path fails before the record, leaves no folder, the list stays readable and an intent-less folder is skipped. Checks (cloud): typecheck and prettier pass; `terminal.test.ts` 10/10. Next free: migration 38, ADR-0059 (verify on main).

## Run built products in the app: isolated terminal window (ADR-0058) — November 1, 2026

Jordan asked (Nov 1) to launch created products from inside Creator Agent, for example the timing analyzer's `--practice` mode (audit item 9, pilot F17). Design doc https://claude.ai/artifact/4hf8VN3bePP4vNSJCcVhAq; Jordan chose "Terminal window, isolated". Try now has "Run in a terminal…" on a verified package: optional arguments, a confirmation showing the exact command, then a console window on the studio's computer running a fresh copy of the exact package bytes in the same WSL Bubblewrap sandbox as QA (no network, 256 MiB, 32 tasks, half a CPU, 15 minutes, no studio files), attached through `systemd-run --pty` so keys don't pass through the studio. Output is not captured; the window waits for Enter after the program ends. Sessions end on Stop, deadline, window close or a stale lease (studio gone); a close without the worker's result is reaped and only confirmed stops count as clean. One open session per product, 3 per studio. Records in `<product>/terminals/<id>/`, audit events `artifact.terminal.requested/stopped`. Hosted studios and non-Windows hosts refuse; a studio started inside another app's container is refused with "start it from the Start menu". New: `packages/executor/src/terminal.ts`, `worker/terminal.py` (bundled by `apps/desktop/build-studio.mjs`), bridge `--interactive`, routes `artifacts/{id}/terminals` and `terminals/{id}/stop`, `TerminalSessionSchema`. Also: the CLI now honours `CREATOR_PRODUCTS_ROOT` like the API (the dev launcher's `.creator/studio/products` vs the CLI's `.creator/products` mismatch). No migration.

Checks (cloud, PostgreSQL 16): typecheck, web build and prettier pass; new `tests/src/terminal.test.ts` (7: Windows-only and owner-only start, argument bound, fresh package copy plus only the argument list, cleared worker environment, lease heartbeat, ended/stopped/timed_out/cleanup_required mapping, reap after a window close and unconfirmed reap, one per product and the cap, restart → lost, bridge and policy limits agree); `artifact-api.test.ts` extended over HTTP (stale manifest 409, no CSRF refused, exact package files hashed in the job, second start 409, wrong artifact 404, stop via lease, audit rows). Full suite 599 tests: 566 pass, 27 skipped, 6 failed = the 5 known PowerShell-wrapper tests (no pwsh) and one terminal-test cleanup race, since fixed and re-run 3/3. The terminal tests use a stand-in window; nothing ran conhost, WSL, Bubblewrap or `systemd-run --pty` here. Next: one live check on Jordan's device (timing analyzer `--practice`) after his typed OK. Next free: migration 37, ADR-0059 (35/0056 and 36/0057 are taken by the parallel evidence-site and chat threads).

Live check on Jordan's PC (his typed OK, 2026-11-01, separate worktree, throwaway product store, no database, $0; harness `tracking/evidence/terminal-live/run.mjs`): run 1 with the v4 timing analyzer `--practice` opened a plain console window and ended normally (exit 0, about 7 minutes) with systemd's limits applied (RuntimeMax 15 min, CPUQuota 50%, MemoryMax 256 MiB, no swap, TasksMax 32). Later launches flashed a window that closed in about 0.2 s without starting the program: spawning `conhost.exe` directly stopped working on his PC (probes with a harmless command failed the same way; Windows' default terminal is "Let Windows decide" with Windows Terminal 1.24 installed; cause not confirmed). `cmd.exe /d /s /c "start "" /wait …"` worked every time, and through it the Stop path passed end to end (stopped within about a second, limits applied). The product now launches that way (`consoleCommand`). A window that closes before the bridge starts is now recorded `blocked` with a try-again reason instead of `window_closed`. Fresh review of the PR (`/mnt/project-files/reviews/PR104_RUN_IN_TERMINAL_REVIEW_2026-11-01.md`): M-1 (concurrent starts passed the limits) and L-1–L-5 fixed; the start audit is now `artifact.terminal.requested`, written before the window opens. L-6 (session folders never pruned; list reads all of them) is left as is. Remaining live steps: Stop again, close with X, and a timing run on the new launcher.

## Friction pass: evidence websites and model caps in the app (ADR-0056, migration 35) — November 1, 2026

Jordan's Nov 1 ask (audit items 5 and 10); design https://claude.ai/artifact/8j34BJUups2CGMqbTrPw2X, Jordan chose "Both, with any-site switch". Settings › Evidence websites (per workspace): "Only these websites" (default) or "Any public website" (off until turned on), up to 100 hosts or `*.example.org` patterns, a reason per change, a confirm step that lists the risks when turning the switch on, and a change history. Owner-only (human workspace owner; agents and editors refused), versioned, immutable rows plus an audit event, applies on the next fetch with no restart. The broker reads the latest change per fetch and records its policy hash; private, loopback and local-network names are still refused. The installed studio always starts the live adapter; the desktop window's list is now the starting list. Models › Change caps: form for every plan cap within PlanCapsSchema's ranges through the existing owner-only settings route; saving clears acceptance. No pricing form here (audit thread C).

Checks (cloud, PostgreSQL 16): typecheck and format pass; new `tests/src/evidence-sites.test.ts` (4 DB tests: editor and agent refused, no-op refused, stale version conflicts, audit event with reason, rows immutable, invalid hosts refused; a change applies to the next fetch with its own policy hash; subdomain pattern excludes the bare domain; any public site fetched while private, localhost, .local and .home.arpa never contact the adapter; empty list blocks with `no_websites_approved`; studio started with no hosts; fetch off refuses changes), 2 new in `research.test.ts` (policy rules, schema, unchanged hashes), caps and site-list tests in `web-caps-form.test.ts` (ranges equal the schema's, round trip, refusals, Claude Code hides Codex caps); full suite 603 tests, 571 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh). Browser walk on a throwaway real workspace (ports 5183/4330/4340): `tracking/evidence/evidence-sites/` (out-of-range cap refused in the form, caps saved as "Proposed, not accepted · 60 requests a day · 24 per run", invalid site entry flagged, any-public confirm with risks, saved v1). Not live-verified on the dev studio or installed app; the installed app needs an upgrade (schema 36) to get it. Migration 35 sits before main's 36 (plan-backed chat); the migrator applies the missing 35 on a database already at 36. Next free: migration 38, ADR-0059 (37/ADR-0058 are claimed by the product-launch thread).

## PR #102 review fixes: chat answers (M-1, L-1–L-7) — November 1, 2026

Fresh review of PR #102 at 80e7b6b: one Medium, seven Lows; all fixed in the same PR (no new migration or ADR; ADR-0057 amended). M-1: a provider refusal after the text was sent (Claude usage limit, sign-in, model; any ChatGPT non-200) was saved as "Not asked. Nothing was sent." with the "What was sent" panel hidden. Now only pre-dispatch rejections are `refused`; the rest are `failed` with "<plan> refused it after receiving the text" and the panel shown. L-2 errors before admission records the request are refused, after it failed (`onAdmitted` hook on `invoke`). L-3 chat is refused while a study attempt is open on an active run. L-4 admission no longer locks `chat_settings`. L-5 angle brackets escaped in snapshot, history and question; snapshot flag from the builder. L-6 "Person"/"Question" labels. L-1 card copy says the private-text change covers the whole connection. L-7 note reply wording. Checks (cloud, PostgreSQL 16): typecheck and format pass; `chat-answers.test.ts` 6/6 (new: rate-limit refusal after sending is `failed` with the panel; an API-key sign-in is `refused` with nothing started; study-open blocker; escaping and the snapshot flag); `web-chat-replies` 3/3. Mutation check: treating every rejection as refused fails the new M-1 test.

## Chat answers from the connected ChatGPT plan or Claude subscription (ADR-0057, migration 36) — November 1, 2026

Jordan chose "Build as recommended" on the design (https://claude.ai/artifact/4g1AMoevoCRSJTywfijSVG). Chat now answers open questions through one plan the owner picks. Models and connections › Models has a "Chat answers" card: on/off, connection, a model verified on it, studio snapshot on/off, daily chat limit (default 20, inside the connection's own daily cap), today's use, why the connection would refuse, and "Allow my private text on this connection" (connections default to synthetic and public data, and the change asks for the caps to be accepted again). In Chat, a message the rules keep as a note is sent automatically when answers are on; other messages get an "Ask <model>" button; rule replies and cards are unchanged. Each answer is labelled "model answer, not checked" (plus "fixture stand-in" on fixture connections) and has a "What was sent" panel with the exact input.

Server: plan requests gain the purpose `chat` (direct path, no task class or run, data class `private_approved`), admitted in the same locked `admitPlanRequest` with every existing gate plus owner caller, chat switched on for that connection and model, and the daily chat limit. No qualification is needed (answers never feed scores, specs, evidence or builds). `chat_settings` and `chat_answers` (migration 36); an answer changes once, from pending to completed, failed or refused, and is never deleted. Retried clicks and second clicks never ask twice; a pending answer older than 15 minutes is closed as failed. Fixed instructions `chat-assistant-v1`; input = snapshot (names, states and counts from records only) + last 10 turns + question, trimmed to the connection's input cap; output cut at 12,000 characters. Routes `GET/POST /api/workspaces/{ws}/chat-settings`, `POST /api/workspaces/{ws}/chats/{id}/messages/{message}/answer`. Claude still runs only through the owner's own `claude -p` (ADR-0050); a refusal never falls back to a paid route.

Checks (cloud, PostgreSQL 16): typecheck and format pass. New `tests/src/chat-answers.test.ts` (5 tests: admission refusals for off, other connection or model, daily limit and unverified model, no qualification needed; chat requests refused with a run, task class or non-private data class; input trimming keeps the question and newest turns; store and service with a fake `claude`: off by default, stale version refused, private data not allowed → refused with nothing sent, completed answer with the exact stdin and system prompt, retries and second clicks never ask again, history carried, daily limit refuses with nothing sent, immutable answers, audit without words; editors cannot ask or change the switch but can read it; a stopped studio's pending answer is closed after 15 minutes; routes: off → 403, extra field → 400, unknown connection → 404) and one new web test (note wording). Mutation check: dropping the daily-limit check fails two tests. `storage.test.ts` expects schema 36. Full suite: 598 tests, 566 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh). Browser walk on a throwaway database, ports 5183/4330/4340, with a fake `claude` behind a fixture Claude Code connection (`tracking/evidence/chat-answers/serve.mjs`, `walk.mjs`, `walk.json`, `screens/`): off by default with no answer requests, allow private text + accept caps + switch on in the card, "Ask" on an earlier note, automatic answer for a new note, "What's next?" keeps its rule reply and is not sent, "What was sent" panel; dark, light, phone width; no page errors or overflow.

Not done: live verification (needs Jordan's typed OK for one real question per plan on the dev studio, after turning on private text and re-accepting caps there), web access, streaming, choosing records to include, deleting conversations. Migration 35 and ADR-0056 belong to the parallel evidence-sites thread, 37/0058 to product launch.

## Friction pass: what's-next review fixes (PR #101 review M-1, L-1–L-3) — November 1, 2026

Fresh review of PR #101 at 995fc84 (`/mnt/project-files/reviews/PR101_WHATS_NEXT_REVIEW_2026-11-01.md`): one Medium, three Lows, all fixed in the same PR (web only). M-1: "It works as intended" records a submitted praise item, which counted as undecided, so the line said "Accept one under Try to start a revision". Praise could also be accepted, which turned the path into "Revise the spec". Praise now never counts as undecided or accepted (`feedbackCounts` in `next-rules.ts`, used by the facts), so a praise note alone gives "This product's path is finished". Try shows no Accept/Decline on praise items. L-1: Path no longer repeats the closing line under the list; the line above the tabs carries it. L-2: once a version has a praise item, the one-click button is replaced by a note, so it cannot add duplicates. L-3: on the newest package, Try shows the path's own step, so an earlier open stage (a missing humility review) is named instead of "All clear". Tests: 2 new in `web-next-step.test.ts`, built from real feedback lists rather than hand-set counts. Mutation check: dropping the praise filter fails the M-1 test. Web tests 54/54; typecheck and format pass. Review nits left as they are: re-reading Try re-hashes the artifact on each show (cheap for small packages); revising from feedback is still CLI-only (audit thread C).

## Friction pass: the what's-next line finishes after Try, and pages refresh (audit items 3 and 6) — November 1, 2026

Jordan's post-upgrade finding (Nov 1): after trying a package, "Next: Try…" stayed at the top of every page. Audit items 3 and 6 (`docs/REVISIONS_AND_NEXT_STEPS_2026-11-01.md`, PR #99). Try is now done once feedback is recorded on the newest package (the one Try opens). After that the line says what is left: with accepted feedback, "Revise the spec from your accepted feedback" (`pnpm cli feedback-revise`, or "needs the command line" on the desktop app); with undecided feedback, "You tried it… accept one under Try to start a revision, or start a new discovery" (All clear); with everything decided, "This product's path is finished" (All clear, opens Discover). A revision makes the product stale, so the path goes back to building it as before. The Path tab marks all nine stages done and shows the closing line under the list. Try's feedback panel has a one-click "It works as intended" (records praise feedback, the owner's own click) so trying can finish without writing anything. Placement: the full line shows on Projects and on pages whose line is about that page (approvals waiting, no budget, no plan connected, blocked run steps); every other page shows one quiet line, "Main path: Freeze is next. Open Projects › Scores and specs" (`lineStyle`, `pathSummary` in `next-rules.ts`). Approvals with nothing waiting no longer says "Next:" in front of a finished path. Chat's "why is it blocked" now says later steps wait for the next one, so it no longer seems to disagree with Build's "Blocked: Building needs a frozen spec"; its Try empty state names Build's Package button instead of the CLI.

Refresh: every `api()` write (any POST, answered, refused or timed out) sends a `creator:studio-changed` event and the what's-next facts read again within 0.3 s instead of on the 15 s tick. Pages stay mounted while hidden, so `useLoad` now reads again quietly (no "Loading…" flash, fields kept) each time its page is shown again, which covers Decide, Try, Build, Discover, Library, Search, Workers, Devices, GitHub, Sell and Settings at once; Scores and specs, Sources and claims, Budgets, Activity, Maintain, Campaigns and Study get the same through a shared `useOnShow` hook (`apps/web/src/page-active.ts`). Build's and Overview's polls no longer flash "Loading…". API: new read-only `GET workspaces/{ws}/artifacts/{id}/feedback` (the artifact's feedback without the detail read's archive re-hash), used by the facts. No migration, no ADR, no contract change.

Checks (cloud, PostgreSQL 16): typecheck and format pass; web tests 52/52 incl. 3 new in `web-next-step.test.ts` (feedback finishes Try, accepted/undecided/closed wording, desktop wording, stale product after a revision; no "Next:" on a finished path; full vs short line per page and the summary text); `artifact-api.test.ts` asserts the new feedback list; full suite 584 tests, 552 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh). Browser walk on a throwaway seed-selection database (ports 5183/4330/4340): `tracking/evidence/whats-next-refresh/walk.mjs`, `walk.json`, `screens/`: full line on Path and Decide, short line on Chat, Overview, Models and Settings; a problem added through the CLI while Decide was hidden appeared on return (3 → 4 options) with no reload; freezing a spec changed the line (approval note) 0.57 s after the click; no page errors. Not walked: the Try → feedback flow in the browser (needs a packaged build, which the cloud container cannot make); it is covered by the rules tests and the API test, and should be checked on the dev studio. Not live-verified on the installed app. Next free: migration 35, ADR-0056.

## Friction pass: record and run pickers newest first, with labels you can tell apart (audit items 1–2) — November 1, 2026

From Jordan's Nov 1 notes and the app audit (PR #99, items 1 and 2; web plus two list queries, no migration, no ADR). Every problem, record and run dropdown now lists newest first and opens on the newest: Decide and Scores and specs open on the newest problem (Decide used to pick the problem with the most options, Scores and specs the oldest; `richestProblem` is gone), and Monitor › Runs, Monitor › Budgets, Sources, Discover, Build and GitHub sort their record and run lists the same way. A page opened for a specific record still shows that record. The server lists records (`listEntities`) and runs (`listRuns`) newest first too, so the 500-record cap now drops the oldest instead of the newest.

Labels: one rule in `apps/web/src/labels.ts`. Problem pickers group records under their shared theme (an `<optgroup>` heading), and each option shows the part of the title that differs (the theme and a short repeated lead-in like "Candidate observation:" are dropped), clipped at a word, then the date and time, then the version when it is past v1; two options that would still read the same get the short id. The full title is the option's tooltip. Runs are named by their run record (discovery runs: the theme; "Evidence gathering" runs: that), so a run reads "<theme> · Oct 30, 3:12 PM · f7f014a9" instead of "human in loop · f7f014a9"; a run with no readable record falls back to its oversight mode. The Monitor › Runs list and the Decisions page's run list show the name too. The skeptic-review record picker groups Problems, Ideas, Options and Specifications and defaults to the newest problem or idea.

Checks run: `pnpm typecheck`, prettier, new `tests/src/web-labels.test.ts` (the pilot's three look-alike titles read differently, theme grouping keeps newest-first order, duplicate labels get ids, run names and fallbacks), an updated `web-display` test, a storage test that 501 records list newest first and the cap drops the oldest, and the full suite on local PostgreSQL 16 (results in the PR). Walk on a throwaway database with ports 5183/4330/4340: `tracking/evidence/dropdowns-2026-11-01/` (every picker selects the newest; no page errors).

Not done here: owner-editable run names (audit item 2, would revise the run record's title or need migration 35), a searchable picker for very long lists, and the other capped lists (budgets, offers, campaigns, schedules, chat; audit item 7). The what's-next line and page refresh are a separate thread. Nothing was live-verified on the installed app.

## App audit: revisions and next steps (document only) — November 1, 2026

Jordan asked for a list of everything not implemented, improvable or broken. Audit of `main` at e1d2fbb against his Nov 1 notes and screenshots, the pilot log (F2–F21), the runbook and open review Lows: `docs/REVISIONS_AND_NEXT_STEPS_2026-11-01.md` (shared doc https://claude.ai/artifact/CNYhcSuy9B4Gie2ZKcivDE). No code change. Checked on a throwaway PostgreSQL 16 database with the dev studio on 5183/4330/4340 (fixture provider, no live calls): a browser walk of all 24 tabs (no page errors or overflow), Chat, and refresh on return (`tracking/evidence/audit-2026-11-01/`); full suite 581 tests, 549 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests). Main findings: record pickers oldest first with wrong defaults (Decide picks the problem with most options, Scores and specs the oldest); clipped, identical problem labels and unnamed runs; the Try stage never completes so "Next: Try…" stays on all 24 tabs; scorecards, spec writing, humility reviews, qualification, plan caps and pricing are CLI-only (so the desktop app cannot finish the main path); Decide does not reload on return; several lists are oldest first with a cap (records 500, chat 2000). Features needing Jordan first: plan-backed chat, running products in the app, evidence-website options. Suggested parallel threads A–F are in the doc. Next free: migration 35, ADR-0056.

## Friction pass: central chat, first version (PR B, ADR-0055, migration 34) — November 1, 2026

Second PR of the page map (design doc https://claude.ai/artifact/HtRSVin4d9sGJsU9EpcZnS); Jordan chose "$0 chat first, model replies later". The studio now opens on a sixth page, **Chat** (`#/chat/conversations`, first in the sidebar; an address with no page opens Chat instead of Overview). Conversations are saved per workspace (migration 34 `studio_chat`, immutable messages, per-conversation numbering under a lock, client ids so a retried send is not added twice). The server sorts each message into an intent with fixed rules (`classifyChat`: web address, save an idea, start a discovery, approvals, why blocked, what's next, else note); a client cannot send an intent. Replies are not stored: the browser works them out (`apps/web/src/chat-replies.ts`) from the same facts as Path and the what's-next line each time, and an older question of the same kind says its answer may be out of date. Cards only open a tab or fill in a field there (Sources fetch address, Discover theme); nothing in Chat submits, fetches, approves, starts a run or spends. Audit events keep the message id and intent, never the text. Viewers read only. Search covers titles and message text; conversations can be renamed. Also: the Chat page has no tab row or Reset button, and a page with one screen shows one breadcrumb.

Checks run: `pnpm typecheck`, prettier, `pnpm test:db` on local PostgreSQL 16 (581 tests: 549 pass, 27 skipped, 5 fail = the known PowerShell-wrapper tests with no pwsh in the cloud container). New tests: `tests/src/chat-api.test.ts` (classifier rules; API: smuggled intent 400, retry 200 same id, reused id 409, 3 parallel sends numbered 1–4, title from first message, rename, search incl. `%`, cross-workspace 404, immutability, audit without text, viewer read-only, non-member not found), `tests/src/web-chat-replies.test.ts`, and `web-pages` updated for six pages with Chat as home. Browser walk on a throwaway seeded fixture database: `tracking/evidence/chat/walk.mjs`, results `walk.json`, screenshots in `screens/` (dark, light, phone; no horizontal overflow, no page errors; both fill cards made no POST).

Limitations: no replies in words (a model route is a later step that needs Jordan's OK on route, data and cost); conversations cannot be deleted; the installed app is still behind main. Next free migration 35 / ADR-0056.

## Friction pass: page map review fixes (PR #97 review M-1, L-1–L-5) — November 1, 2026

Fresh review of PR #97 at 5aeff6a: no High, one Medium, five Lows; all fixed in the same PR (web only, no API, migration or ADR). M-1: the line above the tabs on Path and the Path list could disagree when a budget or owner rule blocked (no budget: list "Discovery: Blocked", line "Next: start a discovery"). `nextStep('path')` now returns `pathStages(f).step`, and a running build or packaging is never turned into an owner block. L-1: packaging is no longer shown as blocked by budget or pricing; the server's `package` needs only the owner and a verified build, so budget and pricing apply to the Build stage only. L-2: the Projects nav dot now marks a path step the person has not seen: it shows when the step changes and clears once Projects is opened (remembered per workspace in this browser, `creator.path-seen`). L-3: when discovery proposed no options, the Scores stage reads "Not needed" instead of Done. L-4: screen headings use the new names (Discover, Library, Try, Approvals, policies and runs, Budgets and pricing, Workers, Devices and local workers) and the build form's "pricing snapshot (Monitor › Budgets)"; `scripts/verify-page-drafts.playwright.js` now navigates by page and tab. L-5: the Path tab no longer keeps empty room for the hidden Reset fields button. Tests: two new rules tests (the line equals the list's step for no budget, non-owner, running build, unfrozen spec and finished path; packaging without budget or pricing; skipped scoring). Full suite (cloud, PostgreSQL 16): 577 tests, 545 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests); typecheck and format pass. Browser walk re-run in dark, light and phone width with no page errors. Next free: migration 34, ADR-0055.

## Friction pass: fewer, task-shaped pages (page map, PR A) — November 1, 2026

Pilot feedback (Oct 30, 08:07 EDT): too many pages and no sense of what's next. Design doc for Jordan's OK: https://claude.ai/artifact/HtRSVin4d9sGJsU9EpcZnS (six pages; Chat is PR B). This PR (web only; no API, contract, migration or ADR) folds the 22 sidebar pages into five pages with tabs: **Projects** (Path, Discover, Decide, Scores and specs, Build, Try, Launch with Sell/Campaigns/Maintain), **Sources** (Sources and claims, Library, Search), **Monitor** (Overview, Approvals, Runs, Activity, Budgets, Workers), **Models and connections** (Models, GitHub, Devices) and **Settings** (Owner settings, Study). The page map lives in the import-free `apps/web/src/pages.ts`; views keep their old keys, so per-tab form drafts, `subjectTarget` links and the what's-next rules are unchanged in meaning. Addresses are `#/<page>/<tab>?ws=…`; old `#/<view>?…` addresses still open the same screen and are rewritten in place. The sidebar reopens the last tab used on each page, shows the number of waiting approvals on Monitor and a dot on Projects when the path has a next step. The what's-next line sits above the tab row; its buttons now name the page and tab ("Open Projects › Build"), and `next-rules.ts` actions carry only the view. New Projects › Path tab (`pathStages` in `next-rules.ts`, `path.tsx`): the main path as nine stages (evidence, discovery, scores, selection and spec, freeze, humility review, build, package, try), each done, next, in progress, blocked or later, done strictly in order and worded from the same `pipelineStep` text; the current stage shows why it is blocked (no budget, no pricing snapshot, not the owner) and later stages show what they will need. It reads the same facts as the what's-next line (now one `useStudioFacts` hook in the shell); the server still enforces every gate. Copy that named old pages (Gallery, Decisions, Compare and decide, Evidence, Budgets view) now names the new places. Unchanged: approval and spending gates, one approval per build, the usage indicator, carried decisions, the preview's "How to use it", the dark default theme. Checks (cloud, PostgreSQL 16): new `web-pages.test.ts` (every old view in exactly one page with a unique address, legacy addresses, defaults, labels) and two Path tests in `web-next-step.test.ts`; full suite 575 tests, 543 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh); the 2 studio-service port tests failed only while the walk's dev studio held port 4310 and pass with it stopped (6/6 run); typecheck and format pass. Browser walk `tracking/evidence/page-map/walk.mjs` on a throwaway seed-selection workspace, dark, light and phone width: legacy `#/compare` → `#/projects/decide`, five pages, every page's tabs, Launch sections, last-tab memory, Back, no page errors (`walk.json`, `screens/`). Not live-verified on the dev studio or the installed app. Next: PR B, the central chat (migration 34, ADR-0055), after Jordan's choice on model replies. Next free: migration 34, ADR-0055.

## Friction pass: carried decisions, re-review fixes (PR #95 re-review M-A, L-A–L-C) — November 1, 2026

Re-review of PR #95 at 8ad36fa: M-1, M-2 and L-1–L-3 fixed; one new Medium and 3 Lows, all fixed in the same PR (web only, no API, migration or ADR). M-A: the overall rationale was carried silently when the choices changed. `formGate` now returns `rationale_review`, true while any option's disposition differs from the earlier decision (new and cleared options count) and the rationale is neither rewritten nor kept; "Keep this rationale" binds to exactly the current choices and report, so a later change asks again. L-A: "Keep this reason" for the override now binds to the current set of overrides and report (`override_signature`) instead of a yes/no, so different overrides ask again. L-B: the override reason is also flagged when an option in one of the overrides changed score, status, range or version, even with the same options involved. L-C: an option whose disposition differs from the earlier one while its reason and "would reverse if" are still the earlier text needs them rewritten or "Keep these reasons" for that choice (`stale_reasons`). The line above Record lists what still needs a look. Nit: the `overridesChanged` comment now says a shrunk set counts as changed. Checks: typecheck; `web-carry-decisions` 17/17 (4 new; mutation checks: dropping the rationale check, the in-set score check or the stale-reasons check each fails its test); web tests 37/37; full suite on PostgreSQL 16: 565 tests, 533 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh). Browser walk (same fixture workspace): after keeping the flagged options and the override reason, changing one option from research further to defer turned Record off with "rewrite or keep the reasons written for an earlier choice; review the overall rationale"; keeping both turned it back on (`tracking/evidence/carry-decisions/changed-choice-walk.mjs`, `changed-choice.png`).

## Friction pass: carried decisions, review fixes (PR #95 review M-1, M-2, L-1–L-3) — November 1, 2026

Fresh review of PR #95 at 87864f0: no High, 2 Medium, 3 Low; all fixed in the same PR, web only, still no API, migration or ADR. M-1: the old override reason was carried into a new set of overrides without notice. The form now works out the overrides the carried choices need on the new report (the server's `checkSelection` rule, copied into `overridesFor`; the server stays the authority) and compares them with the selection's recorded `overrides`. An advanced option that a new or different set of higher-ranked options now outranks is flagged ("the override reason needs a fresh look"). While the overrides the form's current choices need differ from the recorded ones, Record stays off until the override reason is kept ("Keep this reason") or rewritten. M-2: discovery gate changes are compared ("Discovery candidate → needs research"), and so is a change in which choices the gates allow when no named gate explains it. L-1: a revised problem asks the owner to tick "I read the revised problem and my decision still applies" before recording. L-2: an untouched row resubmits its recorded list of reasons (`rowReasons`), so several 300-character reasons are no longer joined into one string the server refuses. L-3: the form's rules (unreviewed flags, duplicate decision, override review, problem review) are a pure `formGate` with tests. Nits: a blocked row says "Reviewed." only once a choice is picked; the same decision can be recorded again under a different run. Checks: typecheck; `web-carry-decisions` 13/13 (6 new; mutation checks: removing the discovery comparison fails the M-2 test, removing the override comparison fails the M-1 test); web tests 33/33; full suite on PostgreSQL 16: 561 tests, 529 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh). Browser walk (same fixture workspace, one more scorecard revision): the human-led option rose above the recommended existing tool, both were flagged, the override reason showed "Review the override reason", Record stayed off until both options and the reason were kept, then the `candidate.select` approval was raised (screenshot `tracking/evidence/carry-decisions/override-review.png`, script `override-walk.mjs`).

## Friction and flow pass: decisions survive score changes — October 31, 2026

Owner pilot feedback (Oct 30, 08:07 EDT): a changed score invalidated the whole Compare and decide decision, so every option had to be decided and justified again. Now the Decide form starts from the problem's latest selection instead of blank. Each option keeps its disposition, reason and "would reverse if", and the overall rationale and override reason carry over too. Only options whose own inputs changed since that selection are flagged: a revised option version, a changed suitability or opportunity score, status or range, an ethics/access or humility gate change, or a disposition the new report now blocks (that choice is cleared, its words kept). A flagged option needs "Keep my decision" or an edit before the form can be recorded; a rank moved only by another option's score is shown as a note, not a flag. New options start blank, options no longer in the problem are counted, and the option cards show "Changed since your decision". When nothing changed, the form says so and recording the identical decision again is disabled. Web only (`apps/web/src/carry-decisions.ts`, pure; `compare.tsx`; small CSS); no API, migration or ADR. The server is unchanged: a selection still names the exact report hash it was made on, gates and overrides are re-checked on record, and the `candidate.select` admission still binds the report and dispositions. Checks: typecheck; `tests/src/web-carry-decisions.test.ts` 7 new tests (mutation check: treating rank moves as changes fails the rank-note test); all web tests 29/29; full suite on PostgreSQL 16: 557 tests, 523 pass, 27 skipped, 7 failed: the 5 known PowerShell-wrapper tests (no pwsh) and 2 database-teardown errors ("permission denied to terminate process" in broker and selection tests), which passed 18/18 when those two files were rerun. Browser walk on a fixture workspace (PostgreSQL 16, `seed-selection`, then one suitability scorecard revised through the API): the form said "1 of 5 options changed", flagged only the revised option (Suitability 62.5 → 66.7), kept the other four, enabled Record after "Keep my decision", and after the owner approved the resulting `candidate.select` decision the new selection recorded and the form showed "Nothing has changed since" with Record disabled. Evidence: `tracking/evidence/carry-decisions/` (walk scripts, screenshot). Limits: the override reason is carried as written, and whether ranks now need one is still only checked by the server on record; owner-initiated selections still raise a `candidate.select` approval (separate pilot item); not live-verified on the dev studio or the installed app.

## Leftover review Lows from PRs #89–#93 — October 31, 2026

One follow-up PR for the open Lows of the PR #89, #90, #91 and #93 reviews; no migration, no new ADR (ADR-0053 and ADR-0054 text amended). Usage indicator (#91 review): L-3 the usage read no longer takes the runtime-ceiling lock (`runtimeExposure(..., { lock: false })`, display only), so the minute-by-minute refresh never queues behind or holds up paid dispatches and ceiling saves; L-4 an active run already at its lifetime per-run cap stays listed after its last request leaves the 24-hour window (a stopped run does not); nit N-1 the workspace id is normalised once. Plan packet bound (#89 re-review): L-A the HTTP test now registers a real run and sends inputs over the accepted `max_input_chars` (including one over 20,000 characters and one with an over-64 KiB body), each refused by admission with the input-cap blocker; before, every call used an unregistered run (and, since ADR-0054, no `build_id`), so it stopped before admission. L-B `codex-builds` gets the same 1 MiB ingress allowance as `build-calls`. What's-next line and forms (#90 re-review): N-1 blocking and failed workflow counts come from the overview's exact per-state totals, not its 20-item attention list; N-2 the review step is decided for the most recently changed frozen spec, so a reviewed older spec no longer hides a missing review; N-3 Submit lists only budgets the chosen run may use (with "No budget this run can use" and a hint), and Workflows disables Start with a hint when no budget fits the run. #93 review L-1: ADR-0054, `docs/BOUNDED_BUILDER.md` and the test name now say what the code does (a one-time approval goes to a build it covers, preferring the exact one); the behaviour itself is unchanged. Skipped: #90 N-4 (Decisions page Revoke/Stop errors) and #93 L-1 behaviour and nit N-1 (build approval code), left to the parallel decisions work; #89 L-2 (open by design); the Build page's budget select (build form). Checks (cloud, PostgreSQL 16): full suite 554 tests, 522 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh); typecheck, format and web build pass. Mutation checks: restoring the lock, dropping the cancelled-run condition, reverting the route schema to 20,000, the build-call or codex-builds body allowance to 64 KiB, or removing admission's input-cap check each fails a test. Not live-verified on the dev studio or the installed app.

## Friction pass: the preview shows how to use the package (F16) — October 31, 2026

Pilot finding F16: the private preview gave no hint of what to type. The preview page (served by the API on its own origin, `apps/api/src/artifacts.ts`; not part of `apps/web`) now has a "How to use it" section read from the exact frozen spec version the package was built from: what each run does (arguments, standard input sent all at once, not interactive), the user flows the built task covers with their steps, and up to 3 visible acceptance cases of that task, each with its full command line, standard input, expected output and exit code, and a "Use this example" button that fills in the run form. The form's fields show the first example as a placeholder. Held-out cases are never shown (only a note that they exist), so the page cannot leak what QA keeps from the build roles. If the pinned spec version is missing, redacted or no longer hashes to the manifest's spec hash, the page shows only the command and says why. Read-only: `ArtifactStore.previewAccess` returns the guide on page loads (not on runs) from `entity_versions`; no contract, migration or ADR. Checks (cloud, PostgreSQL 16): `artifact-api.test.ts` asserts the flow, the visible A1 example and its fill-in data are shown and the held-out A2 case is not; full suite 550 tests, 518 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh); typecheck and format pass. Browser walk of the real page and script against a stubbed store with timing-analyzer-like data, dark and light: the button fills both fields and focuses Run. Not live-verified on the dev studio or the installed app (the installed app lacks this and PRs #89–#93). Next free: migration 34, ADR-0055.

## Friction pass item 1 follow-up: one-time build approvals go to their own build — October 31, 2026

Follow-up to PR #92 (ADR-0054) for the re-review's three Lows; no migration, ADR-0054 amended. L-A: an unused one-time approval of another build no longer blocks a build. Before admission, `admitBuild` leaves out the run's one-time `product.commit_build` grants for that spec whose recorded ask does not cover the build (or that no build asked for), and prefers one asked for exactly this build's limits over a wider one. A build is then admitted by the approval it asked for or by a standing grant, or it asks for its own approval, and the other approvals stay unused. Before, the oldest one-time grant was picked first and refused the build, even with a standing grant in place. L-B: the Approve option now names the plan connection (label and short id) and the model, so builds that differ in them raise separate decisions and the person sees what they approve; the ADR's "known limit" text is corrected. L-C: new test "a one-time build approval goes only to the build it was asked for" (generic once grant, another connection with the same model, `codex_plan` vs `broker`, two approvals answered in reverse order, standing grant plus leftover approvals, expiry clamped to the standing grant, four racing starts give one approval and DUPLICATE), plus the per-request data-class check. Checks (cloud, PostgreSQL 16): full suite 550 tests, 518 pass, 27 skipped, 5 failed (the known PowerShell-wrapper tests, no pwsh); typecheck and format pass. Mutation checks: removing the exclusion, the route, connection or exact-limit comparison, the expiry clamp, the duplicate mapping, the data-class check or the connection wording each fails a test (one equivalent mutant: the explicit "no ask" test, since a missing ask never matches a route). Not live-verified on the dev studio or the installed app. Next free: migration 34, ADR-0055.

## Friction and flow pass, item 1: one approval per build (ADR-0054, migration 33) — October 31, 2026

Jordan's decision is now built: a build of a frozen spec asks for `product.commit_build` once, and that approval covers its repair rounds and, on the ChatGPT-plan route, its builder and reviewer requests up to the plan's request limit (`max_calls`, at most 6; `max_repairs`, at most 2). The approval is recorded in a new immutable `build_approvals` table (migration 33) in the same transaction as the admission. Plan admission checks every build-role request against it (owner, run, connection, model, data class, deadline, request count, grant still standing, humility review unchanged), so the run no longer needs a standing `model.generate` grant (F13). The build-roles preflight refuses a run without room for 2 requests (F11). A stopped build continues from the task's current candidate instead of failing with "Stale build candidate" (F12). Broker and Codex calls and frozen study builds are unchanged. Checks (cloud, PostgreSQL 16): full suite 534 tests, 501 pass, 27 skipped, 6 failed: the 5 known PowerShell-wrapper tests (no pwsh), plus the schema-version assertion in storage.test.ts, since fixed to 33 (storage suite 7/7). Mutation checks: the new tests fail when the executor asks every round and when plan admission skips the approval check. Not done: approving in place so the build continues by itself (navigation thread); keeping decisions when scores change (selection code). Not live-verified on the dev studio or the installed app. Review fixes (same PR, fresh review at 6bb4b64): M-1 a one-time approval now admits only the build scope its decision showed (route, connection, model, no more requests or repair rounds; recorded in `build_approval_asks`, still migration 33); L-1 approvals last until the earlier of the build deadline and the grant's expiry, at most 24 hours; L-3 tests for the per-request deadline, creator and humility-review checks; N-1 a racing duplicate returns DUPLICATE. Full suite after the fixes: 534 tests, 502 pass, 27 skipped, 5 known PowerShell failures. Next free: migration 34, ADR-0055.

## Friction and flow pass item 3: plan and cost usage indicator — October 31, 2026

The top bar now has a usage button (for example "ChatGPT 17/40 · API $0.00/$20.00") that opens a small panel. For each plan connection it shows the studio's requests in the rolling 24 hours against the daily cap, how many are left, when the oldest request drops out and when all of them do, Codex builds today, runs active in the last 24 hours against the per-run cap, running and unknown-outcome requests, and the provider's own limit state as last observed. The ChatGPT or Claude plan's own remaining allowance is not visible to the app, so the panel says so and points to the provider's Settings > Usage page instead of showing a guessed number. It also shows the workspace's plan requests (24 hours, 7 days, total) and API spending against the ceiling (exposure, remaining, paid calls, unknown-cost calls) with a link to Settings. It refreshes every minute, on window focus and on page changes. New read-only route `GET /api/workspaces/{ws}/usage` (contract `UsageSummarySchema`). Plan counts use the same rows and rolling-window expression as plan admission, and a test pins that the shown "used" equals admission's count. API cost is shown only to a person who owns a workspace (the ceiling's ADR-0043 audience); others get a stated reason. No migration, no ADR (read-only view; no policy change). Checks: typecheck and format pass; `usage-indicator.test.ts` 3/3 on PostgreSQL 16; full suite 530 tests with only the 5 known PowerShell-wrapper failures (no pwsh) once a stray local server was stopped; browser walk on a throwaway database at desktop and phone width. Review (no Medium+) Lows fixed in the PR: L-1 "next request possible at" now picks the request whose leaving brings used under a lowered cap (test corrected); L-2 each connection carries admission's own `connectionBlockers`, shown in red, so a signed-out or caps-not-accepted connection no longer reads green. L-3 (GET takes the ceiling lock) and L-4 (runs capped over 24 hours ago drop off) are left as is. The installed app does not have this yet.

## Friction pass item 2: Decisions refresh, latest-version defaults, what's next on every page — October 31, 2026

Runbook step 9 (friction and flow pass), web app only; no API, migration or ADR. Pilot feedback F19, F20 and the Decisions-refresh note, plus "every page says what's next or why it's blocked". Decisions reloads whenever you return to it (pages stay mounted while hidden, which is why it showed stale data) and every 15 s while open; opening Decisions without a named decision no longer reopens one focused on an earlier visit. Build and package now shows one product per spec, the latest by default, with older versions in a Version dropdown (F19). Runs, budgets, pricing, humility reviews, Gallery packages, and the GitHub and Payments choices now list and default to the newest (F20). The Build form defaults to the verified $0 plan-role builder instead of the metered broker, and on that route to the newest run a standing model.generate grant covers (run options show their start time and "no model grant"). A line under each page title says what comes next on the main path, or why the page is blocked, with a button to the page that takes the step. Waiting decisions show as a note on every page. The rules are pure (`apps/web/src/next-rules.ts`) and read the workspace from existing routes. Steps that are command-line only (scorecards, specs, humility reviews) say so, and the desktop app's wording doesn't offer a command. Checks: typecheck, format, web build; `tests/src/web-next-step.test.ts` 8 new tests; all web tests 21/21. Browser walk on a fixture workspace (PostgreSQL 16, seed-selection): every page shows a line, a spec freeze raised a decision, and Decisions showed it on return without Refresh. Limits: the line rereads on page change and every 15 s, so it can lag an action by a few seconds; "request room" on a run is not checked; the build gates stay on the server.

Review fixes (review `PR90_NAVIGATION_REVIEW_2026-10-31.md`, 3 Medium, 6 Low): M-1 a build counts as packaged when a Gallery artifact has its spec version and commit, so an API restart no longer brings back "Package it" (Build page and line). M-2 only waiting, paused or reconciling steps block Overview and Runs; failed steps are a note. M-3 the plan builder shown as default counts as chosen; if it stops being verified, the form names it as unavailable and won't start rather than switch to the metered broker. L-1 the model-grant default also checks the data class and an autonomous run's initial grants. L-2 the default budget is never one bound to another run (Build, Submit, Workflows). L-3 a humility review counts only for the frozen version it reviews. L-4 only active budgets count. L-5 Decisions polls keep action errors and drop stale responses. L-6 left as is (poll cost, line placement, the extra read on Build). Web tests 25/25; typecheck, format and web build pass; fixture browser walk repeated.

## Owner pilot revision round: plan-role packet bound (ADR-0053) — October 31, 2026

Jordan's feedback on the analyzer (typing timings is too much friction) became spec v3 and then v4, adding a terminal `--practice` mode. v3 build 76a0b9ae passed QA 10/10, but the reviewer found a real capture-timing gap, which v4 fixes in the spec. The v4 build stopped before the reviewer because its packet (20,026 characters) exceeded the executor's hard-coded 20,000 bound. ADR-0053 now bounds plan-role packets by the owner-accepted plan input cap, which plan admission enforces, with a 200,000 runaway ceiling. Broker builds keep 20,000. Tests: build.test.ts 16 pass, 2 skipped (opt-in WSL). The new test fails when the plan route uses the broker bound. Findings F17–F21 are in `docs/OWNER_PILOT_LOG.md`. With Jordan's OK the installed app was upgraded to 2b1f558, and v4 build 7f6802ac then verified (reviewer approve with no findings, QA 10/10, 2 plan requests, $0; its reviewer packet was 19,162 characters, so it didn't exercise the new bound). The PR #88 review found the API build-call route still capped input at 20,000 with a 64 KiB body limit (H-1, M-1); both are fixed with HTTP tests in the follow-up PR. Jordan then ran `--practice` in PowerShell: "for a prototype that runs in powershell, it felt quite good to use" (likes the fps/beats/tempo options and the per-press early/late/on-frame report). The pilot's build → feedback → revision loop is complete. Next: the friction and flow pass (F11–F21, one approval per build, latest-version defaults).

## Owner pilot day 2: first verified build on the installed app — October 31, 2026

The timing analyzer (spec ae20b026 v2) was built on the ChatGPT plan at $0: build 072d00a1 verified, reviewer approve, QA 7/7, package a05e1ae526 in the Gallery. Before that, the builder qualified (24adc57c, 3/3) once the app was launched outside Claude's MSIX container. Spec v1 missed the exact A7 wording, and the per-run cap of 10 blocked a reviewer; the cap is now 14. New findings F11–F15 and Jordan's Decisions-refresh feedback are in `docs/OWNER_PILOT_LOG.md` under "Day 2 summary". Next: Jordan's one feedback item, then one revision (needs an OK).

## Owner pilot day 2: builder failure cause found; F10 reasons visible (ADR-0052) — October 31, 2026

The October 30 builder qualification failures (37752d2f, 31aae6c9) were not caused by the model or the
stale deadline. All 8 stored answers are correct patches, each graded `provider_error`. The installed app
had been started inside the Claude desktop app's MSIX container. There, the new
`plan-qualification-products` folder was redirected to Claude's LocalCache, and `canonical()`
refused it ("Noncanonical path refused"). The grader hid that message. A replay on Jordan's PC
with the installed bundle, the service's cleared environment and a kill-on-close job accepted
the same answer when the folder sat at its real path. With Jordan's typed OK, the real
`studio.json` got back the 6 approved websites that had only been saved in the redirected
copy (backup `studio.json.bak-20261031`). Jordan relaunched the app himself.

PR #86 (draft): `gradePatchCase` records a reason per non-pass, `GET
/plan-qualifications/{id}` returns the answers and reasons, and the Models page shows them. Checks:
typecheck and format pass. The full suite on PostgreSQL 16 ran 530 tests: 498 passed, 27 skipped, and 5
failed, all known PowerShell-wrapper tests (no pwsh). The targeted suites ran 40 tests: 38 passed, 2 skipped. CI can't run (Actions minutes).
Not done: reasons for non-patch checks. The installed app does not have #86 yet.

## Owner pilot day 1 — October 30, 2026

The pilot ran from 03:15 to 08:56 EDT in the installed app (now 09fc937, schema 32). Discovery
through selection is complete for the input-timing idea: the hybrid was selected for a bounded
build. The build is blocked because the ChatGPT plan's builder qualification failed twice (0/4
each). A correct answer passes the app's own grader, also in the installed cleared environment,
so the likely cause is the model's answers (hypothesis: the Oct 28 deadline frozen in the
t12-builder-v1 packets). The answers are not visible in the app (F10). Two reinstalls with
typed OKs: ADR-0051 approved evidence websites, then F3 and F4. Full log, findings F2–F10,
Jordan's feedback and next steps are in `docs/OWNER_PILOT_LOG.md`. The runbook has added
post-pilot items (evidence-gap search; a friction and flow pass). $0 new metered spend.

## Owner pilot run 1 failed; approved evidence websites added (ADR-0051) — October 30, 2026

Run 1 (add evidence) failed in the installed app: live fetching could not be turned on there
(failure 1 of 3, 5 owner minutes). Jordan chose to fix and reinstall. The status window now has
"Websites approved for evidence"; `studio.json` `source_hosts` reaches the studio service, which
sets `CREATOR_SOURCE_FETCH=live` and `CREATOR_SOURCE_HOSTS` only when the list is non-empty.
Checks: cargo test 18 pass, 1 ignored (new host validation and old-file compatibility tests);
studio-service "studio input" tests 2/2 (sourceFetchEnv feeds `sourceConfigFromEnv`).
Installed with Jordan's typed "OK install" (08:44 UTC): Jordan quit the app; cold copy of the
data home (2,339 files) and program folder (90 files) to
`C:\CreatorAgentBackups\installed-pre-sources-20261030-044533`, every SHA-256 matching.
Installer from bce80cd (clean tree; sha256 80c77a23…9934). Rehearsal on a copy of the home
without sign-ins (DB port 55463, release exe, CDP on the status window): a bad host was refused
with its message; saving three hosts rewrote `studio.json` and restarted the service; health
showed sources `configured_unverified`; clearing the list removed the field and showed `off`.
Then `/S` install exit 0 (program `source_commit` bce80cd), launch from the program folder,
health ok (PostgreSQL, sources off until Jordan adds hosts), both workspaces present, ChatGPT
plan v31 and Claude Code v12 connections unchanged. No schema change (still 32). No live fetch
has been made yet.

## Owner pilot running (runbook step 8) — October 30, 2026

Jordan's thread reply (07:13 UTC) gave the inputs and approved running on the installed build
as is (main ac0f3e4, schema 32). `config/owner-pilot.json` is now `running`: window
2026-10-30 03:15 EDT to 2026-11-06 03:15 EST, $0 budget and spend cap, manual runs only
(`schedules: []`), 3 failures / 120 owner minutes, platforms windows-desktop + wsl2-worker,
accounts `chatgpt-plan` and `claude-code`. Workspace: Jordan's Creator Studio. Product idea: software to practice
timing keyboard and mouse inputs, for gamers and speedrunners. Log: `docs/OWNER_PILOT_LOG.md`.

- The readiness register gains `chatgpt-plan` (live from the Oct 20 plan qualification,
  activated by Jordan's pilot decision) and `claude-code` (live on the dev studio Oct 28, not
  activated: Jordan connected it in the installed app at 03:20 EDT and verified claude-sonnet-5-5;
  now enabled for the pilot). With Jordan's typed OK it qualified on the installed app for
  summarization (55220983…) and specification (db44619e…), each 2/2 + 6/6, 16 requests, $0.
- `pilot-check` returns ready with no refusals; the full readiness verdict stays not ready.
  `tests/dist/x10-readiness.test.js` 5/5 pass (1 DB test skipped). The gate now also accepts
  `schedules: []` as manual-only (decision #29).
- `%USERPROFILE%\.wslconfig` written with `memory=8GB` at Jordan's request (no file before);
  WSL reports 7 GiB total.
- Hardware limits are not enforced in the app (Jordan's choice); free RAM is watched by hand.
- The Oct 23 C54 audit's recorded hash of `config/readiness.json` now describes the earlier file.

## Owner pilot hardware limits drafted — October 29, 2026

Jordan accepted these limits for the owner pilot (decision #31). They were measured on his PC
(64 GB RAM, RTX 3090 24 GB, i9-11900K) and are recorded as `hardware_limits` in
`config/owner-pilot.defaults.json`, which is still a draft that nothing reads at runtime: studio
16 GB RAM, pause below 8 GB free system RAM, WSL 8 GB (recommended `.wslconfig`, not applied),
VRAM 0 GB (subscription routes only). The worker per-job caps are unchanged. The Oct 23 C54
audit's recorded hash of that file now describes the earlier version. Still open for step 8:
pilot dates and runtime enforcement of these limits.

## Runbook step 7 done: installed app upgraded to main, schema 29 → 32 — October 29, 2026

With Jordan's typed OKs ("Yes, please start step 7", then "OK install"), the installed app
(`%LOCALAPPDATA%\Creator Agent`, data home `%LOCALAPPDATA%\com.creatoragent.studio`, its own
PostgreSQL 18 on 55440) moved from the theme-intent candidate (590aba3, dirty, schema 29) to
main ac0f3e4 (clean build, schema 32).

- Backup first, app quit, original cluster never started:
  `C:\CreatorAgentBackups\installed-pre-v32-20261029-013747` holds a byte copy of the data home
  (2,300 files) and program folder (83 files), all SHA-256 matching the source, plus
  `database.dump` taken from a scratch copy of the copied cluster. The dump restored into a
  fresh PG18 cluster with identical counts (schema 29, 115 tables, 403 rows). Rollback is the
  program and home folders together, never the old program alone over schema 32.
- Installer: `build-studio.mjs` + Tauri NSIS from ac0f3e4 (sha256 184e3488…1958); cargo test
  17/17 (1 ignored). Rehearsal on a scratch copy of the home (port 55463, plan credentials
  removed) migrated 29 → 32 via the status window with all row counts unchanged.
- Real upgrade: `/S` install exit 0; the status window offered "layout 29 → 32"; the app saved
  `backups\pre-migrate-v29-2026-10-29T05-43-11-618Z` and migrated. After: schema 32, every
  table's row count equal to the backup (only `runtime_limit_changes` and
  `runtime_ceiling_changes` added, empty). Sign-in worked; Monitor, Submit, Evidence, Runs,
  Budgets, Activity, Build, Settings, Models, Desktop, Operations, Payments, GitHub and Studies
  loaded. Jordan's workspace keeps its ChatGPT plan connection (signed in) and $5 budget.
  Quit and relaunch from the Start shortcut reached running with /api/health ok.
- No provider, GitHub or payment calls. The theme-intent native checks bound to the schema-29
  candidate no longer describe the installed program and would need redoing on this build.

Limits: Operations shows "development build (no commit recorded)" because the desktop does not
set `CREATOR_BUILD_COMMIT` (cosmetic, pre-existing). The installed app now runs the Claude Code
connection code, but no Claude Code connection was added there.

Next eligible: runbook step 8 (owner pilot), which needs Jordan's dates and RAM/VRAM limits.

## Claude Code connection live on the dev studio — October 28, 2026

Jordan's dev studio (main 64f42c1; creator_studio backed up to
`C:\CreatorAgentBackups\creator_studio-20261028-082335-pre-migration32.dump`, then migrated to
schema 32) now has a `claude_code` connection in Jordan's real workspace (95f918a6…).

- Claude Code 2.1.252 is the native install. Jordan signed in himself in
  `.creator\studio\claude-code`, confirmed extra usage off and accepted the caps.
- With his typed OK, one verification call on `claude-sonnet-5-5` completed (request 46d11105…).
  That call also confirmed the `apiKeySource: "none"` rule on a real login.
- With Jordan's typed OKs, claude-sonnet-5-5 then qualified for summarization (a3c6a8cd…,
  `summarization-synthetic-v1`, 2/2 development, 6/6 held out). It also qualified for
  specification (af46b4e5…, the new `specification-synthetic-v1` from PR #80, 2/2 and 6/6).
  Each run took 8 requests; the connection is at version 8, with 17 of 30 daily requests used.

## Claude Code connection (ADR-0050) — October 28, 2026

Creator Agent can now add **Claude Code on this computer** on Models and connections: Claude
subscription usage through Jordan's own signed-in, unmodified Claude Code CLI. The studio never
offers Claude sign-in or holds a Claude credential (Anthropic's terms forbid that); it reads
`claude auth status` and runs locked-down `claude -p` requests. Same gates as the ChatGPT
plan (caps, extra-usage-off confirmation, verification, qualification, ledger). Migration 32.

Checks: `tests/src/claude-code.test.ts` 14/14 with a fake `claude` plus the real Claude Code
2.1.312 against a loopback stand-in (no Anthropic contact); key guards mutation-checked; browser
walk `tracking/evidence/claude-code-ui/walk.mjs`. Not activated: no real Claude account used.

Review fixes (M-1, L-1 to L-4, nit N-2): a fixture workspace without a stand-in is refused and
starts nothing; only `apiKeySource: "none"` is accepted; Anthropic profiles are isolated; the
system prompt goes through a file; the minimum Claude Code version is 2.1.248. Checks after the
fixes: claude-code tests 17 pass, 1 skipped (the optional real-CLI test, which also passes when
run against Claude Code 2.1.312 on a loopback stand-in). The M-1 guard was mutation-checked.
Browser walk 6/6. CI cannot run while the GitHub Actions monthly limit is used up.

Next (each needs Jordan's typed OK): install Claude Code (native), sign in in the studio folder,
confirm extra usage off, accept caps, one verification call, then qualifications.

## Runbook step 6 done: CSV checker built, packaged and revised — October 28, 2026

All on Jordan's dev studio (main 224c917), gpt-6-astra over the ChatGPT plan, $0, nothing
released. Discovery: 8 pages fetched from the 6 approved hosts, 8 claims, 7 alternatives
(csvkit recorded as the recommended alternative; build selected only under owner decision #22),
humility gate passed, and Jordan rated urgency 2 and benefit 3 himself. Spec v1 (8 cases, A8 held
out) frozen. Build 7352660b… verified (2 plan requests, reviewer approve, QA 8/8). Artifact
c955b648… verified after PR #77, and it ran from a clean folder with Windows Python 3.13. Jordan's
feedback 4e096111… ("detect NA or N/A or similar values as missing": penguins.csv showed 19
NA cells as clean) became spec v2 (adds A9 and held-out A10; NA, N/A, NULL, NaN case-insensitive),
frozen as 5e39903a…. Revision build c52ec200… verified with a one-line change (2 plan requests,
QA 10/10). Artifact 93473b32… verified, lineage previous c955b648… plus the feedback; penguins now
reports missing 19. Connection total: 21 plan requests.

Gaps found along the way: plan-route packaging (fixed in #77); the plan route still needs
envelope and pricing ids (U04, $0 envelopes used); the dev launcher's products root must match the
CLI's; a re-run select opened a duplicate decision (rejected). Optional review Lows still open:
#75 L-1/L-2, #77 L-1/L-2.

Next eligible: runbook step 7 (upgrade the installed app), which needs Jordan's go-ahead. Step 5
(desktop-shell walkthrough) was done on October 27 in PRs #63–#69.

## First real CSV-checker build, and packaging for plan-route builds — October 28, 2026

On Jordan's dev studio (main 90638dc), the CSV-checker spec 7527c318…@1 is frozen with the 8
approved cases (freeze 2327cfb4…). Build 7352660b… on the ChatGPT plan with gpt-6-astra reached
verified_candidate: 2 plan requests (builder, then reviewer), $0, reviewer approve, QA 8/8
including held-out A8, candidate commit 28acd8cf…. Packaging it was refused (INVALID_CONTRACT),
because `ArtifactSupervisor.package` read every call outcome as a broker result. This change
reads plan-role outcomes on plan_roles builds. The manifest records `costs.plan_requests`
(connection, model, request ids) with 0 broker calls and $0 settled, and adds a plan-quota
limitation. Broker manifests are unchanged. The gallery and artifact comparison count plan
requests. The new test reproduces the device error with the change reverted. test:db 479 pass /
5 known pwsh failures. No migration, no ADR (follow-up to ADR-0048).

Next: merge, update the device, package and download the candidate, Jordan's feedback round,
then one bounded revision (needs its own OK). Dev launcher note: the studio's
CREATOR_PRODUCTS_ROOT must match the CLI's `.creator\products`.

## Build-role qualifications bound to the current prompt — October 28, 2026

t12-reviewer-v2 QUALIFIED live (94ed329e…, 1/1 development, 3/3 held out), so both T12 plan roles
are qualified for gpt-6-astra (17 plan requests, $0). PR #74 review M-1 fix: plan admission and the
build-roles-ready preflight count a build-role qualification only when its stored manifest matches
its hash and uses the current role prompt. A negative test tampers the stored reviewer prompt; the
build-role call is refused with nothing sent, and the preflight names it. This test fails with the
admission change reverted. test:db 478 pass / 5 known pwsh failures. CSV run: 8 documentation
pages fetched live from the six approved hosts (run 001ad495…, source.fetch grant d61ba81b…).

## Live role qualifications and reviewer prompt v2 — October 28, 2026

On Jordan's dev studio, gpt-6-astra over the ChatGPT plan ($0, 13 plan requests so far):

- patch_build: QUALIFIED with `t12-builder-v1` (08210fde…; 1/1 development, 3/3 held out).
- independent_review: FAILED with `t12-reviewer-v1` (21f2ce7e…; 0/1 development, 2/3 held
  out). Both changes_requested cases passed; both approve cases missed.

This PR (ADR-0049) adds the `independent-reviewer/2` prompt, which states T12's two answer
rules. It also adds frozen `t12-reviewer-v2` (same cases and verdicts) and keeps the answer text
of synthetic/public qualification requests. Checks: test:db 478 pass / 5 known pwsh failures;
the answer-retention test fails without the change.

Next: merge, update the device, get Jordan's OK on v2 and run one 4-request reviewer
qualification. After that come the standing model.generate grant and the CSV-checker build,
each needing its own OK.

## patch_build grader fix after the first live qualification — October 28, 2026

Jordan's first live patch_build qualification (5b95c8c6…, gpt-6-astra, t12-builder-v1, 4 plan
requests, $0) was decided failed 0/4. A read-only diagnosis on his device found that every answer
parsed, stayed in scope, applied and ran in the WSL worker, but grading could never pass:

- The stored manifest is jsonb, which reorders each case's keys.
- `qaPassed` hashed that jsonb order, while the worker hashed the schema order.

The failed record stands as recorded; it says nothing about answer quality.

Fix:

- `scorePatchCase` normalizes each case through `qaCaseSchema` before running and comparing it.
- A run the worker did not carry out (blocked, lost, cleanup pending) is `provider_error`, not a
  failed check.

review_verdict grading does not depend on key order. The benchmark, floor and pass rule are
unchanged.

Checks: build tests 15/15 (the new test fails on the old scorer); test:db 477 pass / 5 known pwsh
failures.

Next: merge, update the device, then a fresh patch_build qualification and the reviewer
qualification, each with Jordan's OK.

## Live plan steps and qualification-root reconcile — October 28, 2026

Live, on Jordan's dev studio (creator_studio, not the installed app): gpt-6-astra verified on the
direct Responses path (1 request, $0, 08:49 UTC; eligible, quota available). Jordan added
patch_build and independent_review via `pnpm cli plan-settings` and re-accepted caps (connection
v7). Nothing is qualified yet. Code: `scorePatchCase` now keeps a throwaway product while the
qualification root's pending-worker marker names it, and before grading reconciles a leftover run
through the executor's verified reap; an unreconcilable marker is refused with what to check.
Checks: build tests 14/14 (mutation-checked), test:db 476 pass / 5 known pwsh failures.
Next: merge #72 and update the device checkout before the two qualification runs (owner OK each).

## PR #72 re-review follow-ups — October 28, 2026

Re-review of #72: no High/Medium. N-1 fixed: the plan-role preflight now also checks owner,
run state, study assignment and dry-runs the run's `model.generate` admission (read-only),
so a missing standing grant stops the build before its commit grant is used. Nits: grader
errors are stored in the request reason; failed throwaway creates are cleaned up; stale
"not tested" note removed. Open (pre-existing): a worker crash under the qualification
products root leaves `pending-worker.json` that the API reconcile path does not see; follow
up before real qualification runs on Jordan's device.

## PR #71 review fixes (ADR-0048) — October 28, 2026

Review of #71: no High, M-1 and L-1 to L-5, all fixed (details under ADR-0048). A crashing
patch scorer now settles the request as `provider_error` instead of blocking the connection;
builds preflight both plan roles before using their grant; build-role requests are
owner-only and pass the run's `model.generate` admission (so a real build needs a grant
covering model requests on its run); qualification uses T12's strict schemas; throwaway
qualification products are removed; the form explains budget/pricing are unused on this
route. Also: the #69 lock-staleness test now re-checks like Recover (it was flaky in CI;
it still fails on the M-1 regression it guards). Checks: see the PR.

## $0 plan route for T12 builder and reviewer (ADR-0048) — October 28, 2026

A build plan can now name `plan_roles`, sending the T12 builder and reviewer as fresh
ChatGPT-plan Responses requests (`patch_build`, `independent_review`) instead of the dollar
broker. Admission needs each role qualified on the exact T12 prompt, an active
non-human-only run outside study assignments, and the plan caps. New benchmark checks
`review_verdict` and `patch_cases` (graded by applying the patch and running the cases in the
WSL worker). API `plan-connections/:id/build-calls`, CLI port, and a web build-form option.
No migration. Checks run: build (15 incl. 4 new), plan-connections (new build-role admission
and qualification test), plan-connections-api (build-calls refusals), routing-domain (review
verdict and manifest pairing), plus the suites listed in the PR. Fixture-verified only: no
live plan request was sent. Role benchmarks `t12-builder-v1` / `t12-reviewer-v1` drafted (scripts/author-plan-role-benchmarks.mjs; 4 cases each, 3 held out). Jordan OK'd the CSV-checker cases and hosts (October 28). Jordan approved the role benchmarks as drafted with a 3 of 3 held-out bar per role (October 28). Next: after #71 merges and the CSV
checker cases/hosts, then each live step with its exact command and request count.

## Study-build lock order fixed (ADR-0044 gap) — October 28, 2026

Jordan approved fixing the gap ADR-0044 recorded before the first real run. The study build
path (`prepareStudyBuild`) took the audit-chain lock in `lockAttemptForWrite`, then the
study-ledger lock and, for final records, the runtime-ceiling lock in `holdBudget`. Ceiling
and limit saves take runtime-ceiling then audit-chain, and `prepareStudyExecution` takes
study-ledger then audit-chain, so either pair could deadlock (PostgreSQL would abort one
transaction). It also applied to synthetic builds against concurrent synthetic execution in
the same workspace. Now `lockAttemptForWrite(..., budget = true)` takes `holdBudget`'s locks
(study ledger, then the runtime ceiling for final records) after the run and attempt row
locks and before the audit-chain lock; `holdBudget` re-takes them (advisory locks are
re-entrant). Order everywhere: run row, attempt row, study ledger, runtime ceiling, audit
chain. New `lockRuntimeCeiling` in runtime-ceiling.ts. Test (study-build, final-record
gate): while another transaction holds the study-ledger or runtime-ceiling lock, a final
build waits on it without holding the audit-chain lock, then refuses LIVE_DISABLED; it fails
on the old order. Final builds are still LIVE_DISABLED; no migration, no amounts changed.

Review of #70 (no High/Medium): L1, the test covered only final records; it now also checks
a synthetic build against a holder of `study-ledger:synthetic:<ws>` (the inversion that
deadlocked on main) and fails if the synthetic early lock is dropped. N2: budget-store uses
`lockRuntimeCeiling`. N1 kept: a final build takes the T15 ledger and ceiling locks before
refusing LIVE_DISABLED; brief, and it is the order live final builds will need.

## PR #69 review fixes — October 28, 2026

Review of #69: one Medium (M-1, a regression): `withLock` added its token to the live set
only after writing the lock and dropped it before removing it, so a same-process Recover
could judge a lock being taken or released as stale and rename it away. The token is now
live from before the file is created until after it is removed (an unlink that finds it
gone is fine). New test: a Recover-like poller over 200 lock lifetimes never releases one
(the old order lets it steal 135). Lows: a cleanup failure never hides the work's own
error; a lock removed between Recover's read and its stat counts as nothing to recover.
CI: the test:db job runs PostgreSQL 18 (ubuntu-latest now ships pg_dump 18.6, which the
restore test cannot load into the old postgres:16 service; the desktop app also uses 18).
Checks: locks (both tests), studio-builds, executor, web-display, artifact-api, typecheck,
format:check. Real-WSL gated tests not rerun this round (withLock change only; they break
WSL on this machine, see the previous entry).

## Recover edge cases from the #68 fourth re-review (N-1 to N-4) — October 28, 2026

Jordan asked for the follow-up now. N-1: after a verified reap, the dispatch lock is freed
only if it is dead by the same rule recovery uses, so a live holder that reused the PID
after a reboot keeps it. N-2: the process keeps the tokens of the locks it holds; a lock
naming this process with any other token is stale and can be recovered without an app
restart. N-3: `withLock` cleanup treats only a missing file as "not ours" and surfaces any
other read error instead of leaking the lock. N-4: reconcile throws `ReapUnverified` only
for a failed or unconfirmed reap, and only that gets the "check that WSL works" advice.
The #66 re-review first-run Lows were already fixed in #67. New tests/src/locks.test.ts
(own lock held only by live token, other PIDs by liveness and boot, empty locks by age,
cleanup never deletes another holder's lock); studio-builds now expects an own-PID lock
with a foreign token to be released. Checks: locks, studio-builds, executor, web-display;
with CREATOR_TEST_ISOLATION=wsl2: executor, studio-builds and studio-builds-wsl pass;
typecheck; format:check. Observed: after the killed-supervisor crash tests, wsl.exe on this
machine sometimes fails with Wsl/Service/E_UNEXPECTED until `wsl --shutdown`; the gated
test passed after a restart. Worth watching on Jordan's machine: if a real closed-app
crash does the same, Recover will correctly refuse until WSL is restarted.

## PR #68 third re-review fixes — October 27, 2026

Third re-review of #68: M-B, the new unresolved-run test assumed the Windows reap message
and failed on Linux CI (`pnpm test:db`); now any unverifiable reap (WSL failing, or no
WSL backend) is refused with the same "could not be confirmed stopped: check that WSL
works" hint (L-3), and the test asserts that. L-1: reconcile on an already-settled run
frees only that run's marker; `release` never unlinks a dispatch lock naming this process
(always a live `withLock`); `withLock` removes the lock only if it still holds its own
token; a finished run frees only its own marker. New test: a settled run whose live
supervisor holds the dispatch lock → Recover frees the marker, refuses the live lock and
leaves it (restoring the old release fails it). Nits: Recover's "waiting" result also
lists what it released; the unfinished-build notice says to just build again when nothing
is locked. L-2 (clock step over 10 minutes) left as recorded. Checks: studio-builds,
executor, web-display; with CREATOR_TEST_ISOLATION=wsl2 from PowerShell: executor,
studio-builds and studio-builds-wsl 14/14; typecheck; format:check.

## PR #68 second re-review fixes (Recover) — October 27, 2026

Second re-review of #68: one Medium (M-A), Lows A–D, nits. M-A: a run that ends
`cleanup_required` while the app keeps running (bridge failure, e.g. WSL failing) could
not be reconciled ("Supervisor still exists") and blocked every build. The executor now
tracks the runs it is dispatching; a run recorded under this process's PID that it is not
dispatching (or that started before this boot) counts as having no live supervisor, and
reconcile still requires the expired lease and a verified reap. A reap that cannot be
verified tells the owner to check WSL; "needs reconciliation" errors and failed builds
show the Recover notice. Lows: own-PID locks count as held whatever time they record, and
the pre-boot rule has a 10-minute margin (A); reconcile finishes freeing the marker of an
already-settled run and Recover lists only runs it changed (B); reconcile applies the
pre-boot rule to reused supervisor PIDs (C); every per-product action records its product
for the lock notice (D). Nits: `execution.reconciled` records who; another product's live
in-app run makes Recover return `waiting` instead of failing. Checks: studio-builds (own
lock held, unresolved own-PID run → no "Supervisor still exists"; here WSL fails so it
refuses with the WSL hint, then a settled run's marker is freed with nothing listed;
disabling the own-PID rule fails the test), executor + web-display, typecheck,
format:check. After Jordan approved `wsl --shutdown` (WSL was failing with E_UNEXPECTED),
with CREATOR_TEST_ISOLATION=wsl2 from PowerShell: executor (real WSL worker, killed
supervisor + reconcile), studio-builds and the new studio-builds-wsl gated test (Recover
refuses while the supervisor lives, then reconciles; dispatch lock and marker freed) all
pass, 14/14. WSL failed again once while Docker restarted around a run; it recovered after
another shutdown and was healthy after the passing runs.

## PR #68 re-review fixes (Recover) — October 27, 2026

Re-review of #68: M1 confirmed; one Medium left (N1) and four Lows. N1: Recover now also
reconciles acceptance runs a closed app left in the worker (this product's running
executions and the studio-wide pending marker's run if it is this owner's) through
`ExecutionSupervisor.reconcile`, which refuses while the supervisor lives or the lease is
fresh and verifies the WSL2 unit stopped before freeing the dispatch lock and marker; a
dispatch lock with no worker launched is released; the page says "Nothing was locked"
when nothing changed and lists what it released or reconciled. Lows: recovery holds the
product (no build or second recovery meanwhile) and re-reads each lock before releasing;
a lock written before this boot is dead whatever process has its number now; the
management lock needs clean task worktrees and no leftover Git index lock (else: create a
new product); the lock notice shows only on the product that failed, Recover asks to
confirm, and the event records who; an empty fresh lock is "being written"; CREATOR_GIT
must be absolute. Checks: studio-builds (live holder, writing, pre-boot, nothing-to-do,
dispatch with/without marker), executor + web-display, cargo test 17/17, typecheck,
format:check. New gated test studio-builds-wsl (real WSL2 crash → Recover refuses while
the supervisor lives, then reconciles) could not run: wsl.exe on this machine now fails
with Wsl/Service/E_UNEXPECTED (the existing real-worker executor tests fail the same way).

## PR #67 review fixes (in-app builds) — October 27, 2026

Review of #67: 2 Medium, 4 Low. M1: the build ports drop the request's Idempotency-Key,
so an approved-once admission can't be replayed for a second build or round (test: a
second build with the same key stops and asks again; restoring the key makes it pass
admission). M2: `POST .../products/:id/recover` and a Recover button release a product's
locks whose process is gone (refuses a live holder or this process; management lock only
with a clean repo; keeps the lock file and an event) (test: live holder refused, dead
holder released, build no longer locked; disabling the liveness check fails it). Lows: a
second package request is refused (reserved before the first await); find_git prefers the
install folders over PATH; the cite form starts a new key when choosing another claim;
running builds continuing after sign-out is documented in ADR-0046. Checks: studio-builds
(both mutations fail it), executor + web-display, cargo test 17/17, typecheck,
format:check.

## Build and package in the app (D2, ADR-0046) — October 27, 2026

Jordan approved the design's five recommendations. The studio service now builds and
packages: `GET|POST /workspaces/:ws/products`, `POST .../products/:id/tasks|builds|package`,
and fixture-only `products/sample-spec` and `products/sample-review` for the $0 sample
(apps/api/src/products.ts). They run the CLI's BuildSupervisor and ArtifactSupervisor with
in-process ports and the same gates (owner, current frozen spec, active run,
`product.commit_build` admission with grant and humility review, broker reservations);
`runCodexBuild` is shared with the CLI's Codex route. New Build and package page
(apps/web/src/build.tsx). Desktop: the service gets Git for Windows as `CREATOR_GIT` (its
PATH is System32 only, so builds failed with "Unexpected server failure"). Also folded in
the #66 re-review Lows: the cite form keeps a saved, evidence-less claim across passage
switches (held by the page), reloads the claim list, sends an Idempotency-Key, and the
page notes a claim still without evidence.
Checks: new studio-builds test (unfrozen spec refused, other workspace 404 and empty list,
missing grant → checkpoint naming the decision, concurrent starts 202/409, package into
Gallery, changed spec refuses packaging; mutations of the list filter fail it); full
`pnpm test` 494 tests, 468 pass, 26 skip, 0 fail (before the last UI/git edits); cargo test
17/17; typecheck; format:check. Walked in the desktop shell end to end: sample spec →
freeze → review → product → task → build (checkpoint, approve, verified in the real WSL2
worker) → package → Gallery → download bytes match the archive hash.
Not done: no live Codex build (needs Jordan's approval of a specific build); scorecards,
spec writing and humility reviews for real options are still CLI-only.

## PR #65 review fixes (first run without the CLI) — October 27, 2026

Review of #65: 1 Medium, 3 Low, 3 nits. M1: the cite form checks the quote against the
passage (whitespace-normalized, as the server's quoteInPassage does) before creating
anything, and remembers a claim it already created, so a failed evidence step followed by a
retry attaches to that claim instead of making a duplicate (checked in the desktop shell:
a bad quote creates nothing; a simulated 503 on the evidence step then a retry leaves one
claim). L1/L2: "Register a run for fetching" and "Add fixture pricing" show only for the
workspace owner. L3: an optional quote under "does not support" must still be 8+
characters. Nits: the form's buttons share one row; a real workspace notes that pages are
fetched only while live fetching is on. Not changed: N2 (a passage over 1000 characters
prefills a verbatim cut). Checks: typecheck, format:check, web-display 8/8.

## Desktop first run without the CLI (D1) — October 27, 2026

Jordan asked to build in-app setup and packaging next. Part 1 (D1): a new desktop studio
can now reach a discovery run without the command line. Budgets lists pricing snapshots
and, in a fixture workspace, adds the bundled fixture pricing (config/pricing/
fixture-model-v1.json, imported at build time). Evidence can register a run whose only
grant is public `source.fetch` for 24 hours, suggests fixture corpus pages, and lets each
kept passage be cited in a new or existing claim (stance, kind, verbatim quote checked by
the server, rationale). Submit's hints point there. No API, schema or policy change.
Walked in the desktop shell on a fresh home: workspace → budget → fixture pricing →
register run → fetch → cite → discovery run succeeded (evidence in
tracking/evidence/desktop-shell-2026-10-27/). Checks: typecheck, format:check,
web-display 8/8. Real-workspace pricing is still CLI-only. Next: D2 design (in-app build
and package), which needs Jordan's decisions on the builder route before any live call.

## PR #63 re-review follow-ups (new PR) — October 27, 2026

#63 merged before its review fixes landed, so 97184f5 (probe home guard, ADR-0041
amendment, Lows) goes in a new PR with the re-review's items. L1: the probe guard now
compares file-system-resolved paths component by component (canonicalizing the deepest
existing ancestor, so nothing is created) and refuses a home that is, contains or sits
inside the installed folder. Checked on this machine: a junction to the installed home, a
trailing slash, forward slashes, the 8.3 short name, a `\?\` prefix, a nested folder and
LOCALAPPDATA itself are all refused (exit 101), nothing was created and no file in the
installed home changed; new unit test `overlap_sees_through_spelling_and_nesting`. L2: both probe
scripts wait for the probe to exit before removing the throwaway home and retry busy
WebView2 files (about 11 s). Nits: "on a new computer" in DESKTOP_STUDIO.md; a comment that
the close fallback also covers an invalid studio.json.
Checks: cargo test 17/17 (1 ignored), cargo fmt --check, typecheck, format:check;
native-startup.mjs passed and left no probe folder. signin-acceptance.mjs started but needs
a person to approve the sign-in in the browser, so it timed out unattended (not a pass).

## PR #63 review fixes (desktop walkthrough) — October 27, 2026

Review of #63: 1 Medium, 4 Low, 1 nit, all addressed. M1: debug probes no longer fall back
to the installed app's folder; they refuse to start without `CREATOR_STUDIO_HOME` or when
it names the installed home, and both the WebView2 data and the download probe's source
cache now live in the launch's studio home (download.rs used `app_local_data_dir`, the
installed home, too). native-startup.mjs, signin-acceptance.mjs and the two native artifact
tests pass a throwaway home. L1: ADR-0041 amended and the desktop README updated. L2: "(recommended on a
new computer)". L3: the close-behavior fallback is `background` everywhere. L4: noted in
DESKTOP_STUDIO.md and the ADR amendment: an upgraded install keeps its saved `quit`. Nit:
the desktop Submit copy no longer points at the Evidence view.
Checks: cargo fmt --check, cargo test 16/16 (1 ignored), typecheck, format:check,
web-display 8/8; probe without a home and with the installed home both refused (exit 101);
native-startup.mjs passed; artifact-api with CREATOR_TEST_NATIVE=1 3/3, including the
native download; studio-service 7/7 on the test DB. The installed home had no file
changed. Not run: artifact-cli native pairing (needs the WSL worker), signin-acceptance.
D1/D2 still wait on Jordan.

## Desktop-shell walkthrough of current main (runbook step 5) — October 27, 2026

Walked `main` 3c42717 as a debug desktop shell (not installed) with a throwaway
`CREATOR_STUDIO_HOME`; the installed app and its home were not touched (no file changed).
Fixture only, no live calls. Passed: new-studio setup, sign-in, fixture workspace, a
discovery run, quit, relaunch (sign-in and workspace kept), quit one second into a run
(it finished after relaunch), port-in-use message and Retry, second launch, background
close, sign out. Fixed: F1 WebView2 data now follows the studio home (it was shared with
the installed app's EBWebView); F2/F3 setup now preselects a new empty studio
(recommended) and Keep running in the background, per owner decisions #1–#2 (existing
installs keep their saved choice); F4 the desktop UI no longer tells users to run
`pnpm cli` commands they can't reach, and the top bar says "this computer". Recorded,
not fixed (need Jordan's scope call): D1 High, a new desktop studio can't reach a first
run without the CLI (claims, run registration and pricing are CLI-only and the CLI can't
sign in to the desktop service); D2 High, packaging is CLI-only so a desktop studio can't
produce a download; "Restore a studio backup" setup option (decision #1) not built; four
Lows. Evidence: tracking/evidence/desktop-shell-2026-10-27/.
Checks: typecheck, format:check, cargo fmt --check, cargo test 16/16 (1 ignored),
web-display 8/8, desktop + desktop-lifecycle 2 pass 4 skipped; re-walk on the fixed build.
Not run: studio-service tests (need test DB), the scripted installed-app acceptance.
Next eligible: Jordan's call on D1/D2 (in-app fixture setup and packaging), else runbook
step 6.

## Test-mode checkout review fixes (PR #60 review, 7 Lows) — October 27, 2026

Fresh review of #60 (merged) found no High or Medium; all seven Lows fixed here. L1:
checkout-api.test.ts now refuses the test buyer in a real workspace (LIVE_DISABLED), on a
seeded open Stripe test-mode checkout (labelled SQL seam, no Stripe call), and in the
service when the fixture seam hands back something that is not a FixtureProcessor. L2: the
test asserts the ledger and entitlement audit rows of a test delivery carry the webhook
actor. L3: the restart check posts `pay` and expects the "restarted" refusal. L4: test-buyer
state keeps the latest 100 checkouts, event bodies live with their buyer and go with it.
L5: one `#release` helper serves createOffer and checkoutTarget; the Payments page flags an
active offer whose release was replaced ("release replaced", archive and re-offer) and the
checkout picker leaves it out. L6: ADR-0045 says buyer steps and deliveries are audited,
state reads are not. L7: a delivery reserves its slot before awaiting, so concurrent
deliveries can't pass the cap; "Leave without paying" is disabled while busy; Settle is no
longer offered after a full refund or a lost dispute (tested).
Checks: typecheck; format:check; checkout-api passes; mutation checks (each fixture gate,
the restart check, the webhook identity and the new Settle rule removed in turn) each fail
the test; full `pnpm test` 487 tests, 457 pass, 25 skip, 5 fail (the known
PowerShell-wrapper tests, no pwsh here); browser walk re-run 11/11 (tracking/evidence/
checkout-ui/walk.json). The replaced-offer badge is not covered by the walk (its artifact
list is stubbed empty); it is the same `current` flag the offer picker already uses.
Next eligible: runbook step 5 (exercise the current build in the desktop shell).

## PR #57 review fixes (spending limits) — October 27, 2026

Review of #57: 0 High, 1 Medium, 8 Low. Medium fixed: a new test fires 8 concurrent paid
dispatches from two workspaces against a 3-call per-model limit and asserts exactly 3 are
reserved; removing the dispatch's runtime-ceiling lock now fails it (3 of 3 runs). The old
"serialize" test is renamed to what it checks (concurrent saves). Lows fixed: a direct
holdBudget test for the study per-run and ceiling refusals (removing the per-run refusal
fails it); a per-run limit can't be saved below an open final study hold's cap; limits
above a later, lower ceiling say "the ceiling applies", and the over-ceiling error says to
lower the limit or raise the ceiling; the review step warns when a limited model has no
pricing or spending (exact-id match); the form says a reason is needed, keeps edits on a
version conflict and has a Remove button per model; an API test covers no session (401),
no workspace (403), missing CSRF (403) and a save; usdToNano moved to apps/web/src/amounts.ts
to break the settings/spending-limits import cycle. L-6 (view spans all workspaces) is
recorded in ADR-0044. Re-review of #59 (no High or Medium) lows: the save-side lock is load-bearing once the
open-hold check exists (a save could otherwise read the holds before an uncommitted hold
commits), so a test now holds an uncommitted final hold of 3 calls, starts a per-run save of
2 and expects it refused once the hold commits; removing the lock fails it. The "no pricing
or calls use this id" warning now also shows after a save (the view marks models named only
by a limit). Recorded, not fixed: the study build path takes the audit-chain lock before
holdBudget takes the runtime-ceiling lock, the reverse of ceiling and limit saves, so a final
build racing an owner save could deadlock (PostgreSQL aborts one, 40P01). Unreachable while
final builds are LIVE_DISABLED; reordering inside lockAttemptForWrite would invert against
prepareAttempt's ceiling-then-run order, so fix it with the live final-build work.

## Test-mode checkout screen (runbook step 3, ADR-0045) — October 27, 2026

The Payments page has a "Checkout (test mode)" section (apps/web/src/checkout.tsx), between
Offers and Money in. The owner picks an active offer and a buyer reference and opens a
checkout; recent checkouts are listed and can be continued. With the simulated processor
the detail shows a labelled simulated checkout page (Pay, or leave without paying), then the
buyer and processor steps the current state allows (settle, refund in full, dispute, dispute
won/lost) and the queued processor events, each deliverable correctly signed, with the wrong
secret or with an old timestamp, again and in any order; the buyer's access badge and the
ledger update from the server. Stripe test-mode checkouts show only Stripe's hosted
checkout link plus a "read a payment by id" recovery; no Stripe call was made. Server:
`GET .../payment-checkouts` (owner-only), `GET|POST .../payment-checkouts/:id/buyer` and
`POST .../payment-checkouts/:id/deliver` (owner-only, fixture workspace and simulated
processor only, audited as `payment.test_buyer_requested`); deliveries go through
`receiveWebhook` with the webhook identity. Test-buyer state is in API memory and says so
after a restart. Checkout is now refused for an offer whose release has been replaced. No
migration; ADR-0045; no live mode; processor choice still pending with Jordan.
Checks (cloud container, PostgreSQL 16): typecheck; format:check; full `pnpm test` 485 tests, 454 pass, 25 skip, 6 fail: the 5
known PowerShell-wrapper tests (no pwsh here) and web-display, whose payments stub lacked
the new checkout module; after the stub and a new Stripe-link test, web-display passes 8/8;
new tests/src/checkout-api.test.ts (wrong-secret and expired deliveries refused with no
receipt, correct delivery grants and books revenue, repeat is a duplicate, second pay
refused, dispute suspends then lost dispute revokes, refund delivered before its payment
still ends revoked with a balanced ledger, editor/viewer refused, replaced release refused at
checkout, restart leaves the test buyer unavailable). Browser walk in fixture mode
(tracking/evidence/checkout-ui/walk.mjs, walk.json, screens/): 11/11 steps, dark theme, no
console errors, no horizontal scroll at 390 px; the walk answers the artifact list with []
as the funding walk does. Fixture only; no processor, provider or GitHub call.
Next eligible: runbook step 5 (exercise the current build in the desktop shell), after the
fresh review of this PR.

## Funding and reinvestment screen (runbook step 2) — October 27, 2026

The Payments page has a new "Funding and reinvesting" section (apps/web/src/funding.tsx):
owner funding (review then confirm, idempotency key), funding sources (add an attested or
processor-balance source, record or read a balance, mark available/unavailable with a
reason, freshness shown), commitments (add, list open and closed, close with confirm),
the reinvestment policy (blank fields except the existing 30-day default; turning it on
asks first and says what it allows), allocations (refuses over-limit amounts unless
"take what the limits allow", confirm step, idempotency key), settled-earnings tranches
and "Repay losses now". Controls show only for the workspace owner; the server still
enforces owner-only, every capacity bound and the runtime ceiling. Added
GET /workspaces/:ws/commitments (PaymentStore.listCommitments) and `pnpm cli commitments`.
No migration, no ADR, no policy change: reinvestment stays off until Jordan sets a policy.
Checks (cloud container, PostgreSQL 16): typecheck; full `pnpm test` 476 tests, 446 pass,
25 skip, 5 fail (the known PowerShell-wrapper tests, no pwsh here); new
tests/src/funding-api.test.ts (owner-funding retry posts once, reused key with another
body is refused, commitments list/close, attested balance feeds usable cash, an enabled
policy with no settled sale creates no budget); web-display covers percentToBps and
railState; format:check. Browser walk in fixture mode (tracking/evidence/funding-ui/
walk.mjs, walk.json, screens/): 9/9 steps, dark theme, no console errors, no horizontal
scroll at 390 px. The walk answers the artifact list with [] because the seeded minimal
release row fails the Gallery contract. Fixture only; no processor, provider or GitHub call.
Review fixes (fresh review of #58: no High or Medium, 7 Lows, all fixed on #58): saving a
policy that is already on asks first whenever it lets more be reinvested or sooner
(`loosens`); adding a funding source or commitment sends an idempotency key and the store
now runs both through `idempotent()`; the portfolio target is disabled without a portfolio
policy; `listCommitments` returns every open commitment (capacity holds all of them back)
plus the 100 latest closed; tests added for a second workspace, retried source/commitment
adds, editor and viewer refusals on all nine writes, `requestKeys` retention and `loosens`.
Walk re-run on the final code: 12/12 steps including a viewer pass (workspace list served
with the role rewritten to viewer) and the loosened-policy confirm.
Next eligible: runbook step 3 (checkout, test mode).

## Per-run and per-model spending limits (runbook step 4, ADR-0044) — October 27, 2026

Settings now has optional per-run and per-model limits under the overall ceiling
(migration 31 `runtime_limit_changes`, ADR-0044). None are set by default: until Jordan sets
some, the overall ceiling ($20 from config/spending.json, or its latest Settings version) is
the only limit, and no amount was set or changed by this work. Each save is a new immutable
version of the whole limit set with a reason, a `spending.limits_changed` audit event, the
version it replaces (stale pages get VERSION_CONFLICT), and the same `runtime-ceiling`
advisory lock every paid dispatch takes. Only a signed-in human workspace owner can read or
change them; agents and system actors are refused. No limit may be above the ceiling in
force; a later lower ceiling still wins because dispatch checks both. Enforcement is in
BudgetStore.prepareAttempt (after the ceiling check, real workspaces only): a call is
refused with `runtime_run_limit` or `runtime_model_limit` if it would take its run, or its
provider/model across every workspace, past the limit. Counting matches the ceiling: settled
cost plus held exposure of in-flight and unknown calls since the ceiling's start date.
A final study attempt whose frozen cap is above the per-run limit is refused before it
starts (StudyStore.holdBudget). Settings shows each model's limit and used-or-held amount,
the highest run so far, a review step that says whether a change widens spending, and the
change history.
Checks (cloud container, PostgreSQL 16, fixture only, no live calls): typecheck; format;
web build; `pnpm test` 481 tests, 450 pass, 25 skipped, 6 fail before the last fix: the 5
known PowerShell-wrapper tests (no pwsh here) and one new web-display test, fixed and rerun
(5/5); new tests/src/spending-limits.test.ts 6/6 (defaults, per-run, per-model across
workspaces, every limit plus a lowered ceiling, owner-only/bounds/versions/immutability,
concurrent saves); runtime-ceiling and storage tests pass. Walked Settings in the dev studio
on a throwaway database (view, over-ceiling error, review, save, history, 390px width).
Not tested end to end: the study per-run refusal (final study attempts stay blocked on the
protocol freeze). Not built: per-user, per-task, provider-wide and recurring limits (#10).
Next eligible: runbook step 3 (checkout in test mode) after step 2, or step 5.

## Main cleanup (runbook step 1) — October 27, 2026

Tests and status only; no product behavior, schema, policy or migration change.
(a) build.test "ChatGPT-plan Codex builder still goes through scoped patches" passes on
Linux. Its last assertion keyed on CREATOR_TEST_ISOLATION, but the executor runs real QA
whenever the host is Windows, so on Jordan's machine without that variable QA passed and
the test expected a checkpoint (the Oct 26 failure). It now keys on the platform:
verified_candidate with the real WSL2 gate on, either state on Windows without it, the
QA checkpoint elsewhere. Not rerun on Windows here.
(b) New payments test: with two verified builds of one spec, an offer for the older one
is refused, the newer one is accepted, and after a spec revision both are refused; no
refused offer is written. Removing the server check makes it fail (checked).
(c) exportStudy already reads the attempt's own workspace (a.workspace_id, created per
attempt), not the study's home workspace, so no cross-attempt or home-workspace events
are exported; the older audit wording was wrong. Pinned by an assertion in study.test and
a code comment. Residual: anything the owner does by hand inside an attempt workspace
would be exported with that attempt.
(d) config/readiness.json as_of 2026-10-27: plan-route rows cite the Oct 22-23 role 1.4
live suites (synthetic, model-reviewed), C54 reflects theme drafts and the schema 29
candidate, C40/C44 mention the pages, C41 notes main isn't packaged, C28 cites the
runtime-ceiling test. No state changed. SHA-256 now
30b903d9e5b1f840f0d9d624653d9b232160dcb621c48416aad22dca01c292e4 (was cb927b91...),
so receipts that bound the old bytes are historical, not tampering.
Checks: typecheck, format, pnpm test:db 445 pass, 25 skipped, 5 fail; the 5 are the
PowerShell-wrapper tests (no PowerShell in this container) and fail identically on
unchanged main. pnpm readiness: no register problems, verdict NOT READY.
Review of #56: no High or Medium. Folded in L1 (Windows without the gate no longer fails)
and L2 (plan-route rows keep "task qualification and end-to-end evidence remain missing"
and cite the discovery-semantics-v2 evidence for candidate generation and scoring).
Next eligible: runbook step 2 (funding and reinvestment in the app).

## Completion runbook rewritten — October 26, 2026

docs/COMPLETION_RUNBOOK.md went from 1,829 lines of dated status snapshots and prompts to
a 131-line page: a current-state table checked against main 54639a1 (PRs #1-#54 merged),
known issues, nine ordered next steps (app first, then the theme-intent track, then the
thesis) and what still needs Jordan. Removed history stays in git and in BUILD_STATUS.
Checked in code: exportStudy still reads the whole workspace audit log; /api/health
reports configuration, not verification; batch input files are deleted at the provider
and child overruns reach the parent (both look done). Docs only; no tests run, no live calls.
Next eligible: step 1 of the runbook (clean up main).

## Usability pass closed; final Lows — October 26, 2026

Review of #53: no Medium or higher on GitHub, Payments, Settings or Scores, so the
fix-and-review loop Jordan set is complete. Folded in its Lows: the server refuses an offer
for a replaced release (not the latest build of its spec, or built for an older spec
version), matching Gallery's "current"; the Payments hint says when a verified build exists
but isn't current; the two Payments add forms reset independently; a repository whose
connection was revoked shows "connection revoked"; changing the connection clears the
repository pick and the disappearance note only fires when there is a replacement. Checks:
typecheck, format, payments + web-display 19/19. No dedicated test yet for the replaced-
release refusal (needs two builds of one spec).
Open items outside this pass: payments checkout/rails/reinvestment policy and allocation
are still CLI-only; ADR-0043 per-user and narrower limits; desktop shell and live
integrations not exercised.

## PR #52 review fixes — October 26, 2026

Review of #52: the #51 Medium is fixed (reproduced in the browser); one pre-existing
Medium fixed: "Create an offer" lists only verified, current releases, and the "package a
verified build first" hint shows when there are none. Lows: a disappeared repository is
named too, with is/are grammar; operation fields hide when the connection has no
repositories; each managed repository names its connection or says it was revoked; the
usable-cash note lists everything it subtracts and that funding sources are added on the
command line; add-connection and create-offer forms close and reset after success so a
double click can't add twice. Checks: typecheck, format; checked in the dev studio.

## PR #51 review fixes — October 26, 2026

Review of #51: no High; one Medium fixed. GitHub "Ask for a change" now lists only the
chosen connection's repositories (and only those of active connections), falls back within
that list, says "This connection has no repositories yet" and won't send without a
repository. Lows: forms on GitHub and Payments say when a picked connection, run,
processor or release disappeared instead of switching silently; the deliveries error clears
on retry; the token expiry is marked required; the Payments ledger note covers owner
funding and "Usable cash for reinvesting" explains what counts. Not changed: the spec-freeze
run lookup still reads each problem's selections (there is no selection-by-id route).
Checks: typecheck, format; checked in the dev studio.

## PR #50 review fixes — October 26, 2026

Review of #50 (same model family): #49 fixes hold; three Mediums fixed. GitHub and Payments
forms now fall back to the first valid connection, run, repository or release whenever the
lists change (no more empty ids after a repository is created or a connection revoked);
archiving an offer asks first and says it can't be undone and buyers keep access; "Money
in" shows revenue and owner funding as positive amounts and the bank line as "At the bank".
Lows: Settings freezes the reviewed version and pauses reloads while confirming; spec
freeze looks up the selection's run across all problems and shows an error with Try again
instead of a run picker; failed webhook-delivery loads show the error; a token connection
needs its expiry; revoke confirms say what happens, have a visible label and focus the
reason; price label no longer says US dollars. Not added: a restore test for older dumps
(restore tests need pg tools, skipped here). Checks: typecheck, format, web-display 4/4.

## PR #49 review fixes — October 26, 2026

Independent review of #49 (same model family): no High; server-side ceiling confirmed
sound. Mediums fixed: Settings re-reads the ceiling when shown, on window focus and after
a save or a version conflict (no stale "Left"); spec freeze uses the run that made the
spec's selection (found from the problems' selections) and clears an old outcome on each
attempt. Lows: server caps a ceiling at 24 nano digits (15 whole-dollar digits), backup
restore verification counts runtime_ceiling_changes (zero when an older dump predates
it), an unknown workspace in the address reloads the list once before redirecting, the
no-workspace refusal says to create one, the ceiling read documents its lock, a test title
corrected. The ceiling stays bound to any human workspace owner (ADR-0043 limit).
config/spending.json changed only in its change_rule text for ADR-0043; new SHA-256
1fa35deb2e80bb7d1ffd482ea6d2de3e4b526e6ecfa5427944aafea9d6455ee0 (was 07aa514d...), so a hash difference on upgrade is this edit, not tampering.
Checks: typecheck, format; runtime-ceiling 6/6 incl. the new bound, web-display 3/3;
restore test skipped here (needs pg tools). Dev DB ceiling set back to $20 (version 2).

## GitHub and Payments screens — October 26, 2026

Web pages for the existing X04 and X07 routes (no API, policy or schema change). GitHub:
connections (add fixture or live by credential variable name only, verify, revoke with
confirmation, webhook deliveries), managed repositories, operations (all six kinds; refused
ones point to Decisions; unknown ones can be checked against GitHub) and pull request
reviews. Walked in the fixture workspace: added and verified the simulated connection,
repo_create was refused for want of a grant, approved once under Decisions, then succeeded.
Payments: processor connections (simulated or Stripe test mode, fixture workspaces only;
add, verify, revoke), offers (create from a packaged release, archive), ledger balances,
buyer access and reinvestment capacity in simulated units for fixture workspaces. Walked:
simulated processor added and verified; offers need a packaged build, which this workspace
has none of. Checkout, rails, commitments, owner funding and reinvestment policy/allocation
stay API/CLI. Checks: typecheck and format pass.

## Spending ceiling in Settings; round 1 review fixes — October 26, 2026

Jordan asked for Settings (user-adjustable spending ceiling), GitHub and Payments screens in
this pass. Settings is done (ADR-0043, migration 30): a signed-in workspace owner can raise
or lower the overall runtime ceiling with a reason; each change is an immutable versioned
row plus a spending.ceiling_changed audit event under the runtime-ceiling lock, with a
version check against stale pages; agents/system actors are refused; config/spending.json
stays the $20 starting value and no amount was changed. Walked in the dev studio on the
Docker dev database only (raised to $25 there to exercise the flow; the installed app was
not touched). Tests: runtime-ceiling 6/6 (new owner/agent/stranger/version/lowering/
immutability test), storage (schema 30), web-display, catalog and budget suites pass.
Round 1 independent review (same model family): one Medium, fixed: environment-claim
history now names the actual environment. Lows fixed: condition-specific Stop text, twin
workspace labels carry an id prefix, Scores keeps a pick made while counts load, Studies
auto-open never overrides a pick or a workspace switch, Budgets says "N in flight now · at
most M at once", an address without a workspace opens the starting workspace. Accepted as
is: up to 20 comparison reads to choose the default problem (a count endpoint can follow);
older history rows keep raw nano amounts.
Next: re-review of these commits; then GitHub and Payments screens.

## Studio usability pass, round 2 — October 26, 2026

Scores and specs can now freeze the shown specification version in the app: pick the run,
give a reason, Freeze; when the server asks for an approval the form links the decision and
re-sends the same request after it is answered (no new authority; same admitted
spec-freezes route the CLI uses). Walked end to end in the fixture workspace: freeze of v2
asked for an approval, approved once under Decisions, then froze all four tasks. Writing or
revising a specification still goes through the CLI/API. Submit a theme explains its two
entry points and collapses the claim matrix to a tick per claim with role chips only for
ticked claims (page 4,876px to about 4,100px with one claim ticked); the theme-intent draft
form itself is unchanged. Checks: typecheck and format pass.

## Studio usability pass, round 1 — October 26, 2026

Hands-on walk of every reachable studio flow in the dev studio (Docker PostgreSQL, fixture
provider, dev login code, seed-selection/study-seed/seed-research/seed-lineage; no live calls
or spend). Audit: https://claude.ai/artifact/GZnCnhr5EmGtbh67V8Ut5C (5 high, 9 medium, 7 low).
Round 1 (web display only; no policy, budget-enforcement or schema change):
Compare and Scores open on the problem with the most alternatives and mark problems with
none; workspace switcher disambiguates same-named workspaces by creation date and opens the
last-used (else newest) workspace; amounts drop trailing zeros and settlement notes no longer
show raw nano integers; new history rows use words for study/spec/selection events, amounts
in units and no repeated reasons (existing rows keep their stored wording; the UI words raw
codes); Monitor shows a run's conclusion instead of a second "succeeded"; Studies opens the
newest study and confirms Stop attempt; Catalog detail stays in view and shows nested record
fields as lists; labels clip at word boundaries; page reset is a quiet "Reset fields" link;
input values no longer render bold; developer-only text removed from Evidence, Models,
Operations and Monitor.
Checks: typecheck pass; format check pass; new tests/src/web-display.test.ts pass; pnpm
test:db 442 pass, 26 skipped, 3 fail. Two failures were port clashes with the running dev
studio (studio-service.test passes 5/5 with ports free); "ChatGPT-plan Codex builder still
goes through scoped patches" also fails on unmodified main (expects checkpoint, gets
verified_candidate), not triaged here.
Not covered: desktop shell (installed app off-limits, dev shell not built), Gallery/preview
(needs the WSL build chain), payments (no screen). Open for Jordan: Settings page with the
user-adjustable spending ceiling; whether Payments and GitHub screens belong in this pass.
Next: round 1 independent re-review; round 2 (Submit restructure, spec freeze in the app).

## CW-01 operational adapter design v1.3 note re-reviewed; review loop closed — October 26, 2026

CW-01 adapter design v1.3 note independently re-reviewed 2026-10-26 (review 163f92c0...aec7,
receipt a3257bc2...231b): supported with conditions; J1-J6, J8, J9 resolved, J7 partly; new
Low K1-K3; no Medium or higher open. Implementation not started; operational NOT READY
(blocked). Open: Jordan to confirm the G2 limit covers the v1.3 J1 scope (any console host,
incl. agent terminal tools). K1 (Node tty raw mode uses SetConsoleMode; restore mode on
every exit), K2 (abort/refusal events need a schema or the orphan rule) and K3 (120 s and
5 s bounds still end on supervisor/observer clocks) carry as conditions into the future v5
implementation design; no further note.

## CW-01 operational adapter design v1.3 note written — October 26, 2026

CW-01 adapter design v1.2 note independently re-reviewed 2026-10-26: supported with
conditions (Medium J1, Low J2-J7). G2 limit accepted by Jordan; confirm it covers
pseudoconsole automation (J1). Review docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_REVIEW_2026-10-26.md
(eb2a46a0...1577); receipt tracking/evidence/theme-intent-cw01-operational-adapter-design-v1-2-review-2026-10-26/
reviewer-receipt.json (7b7a7841...d3a5).
v1.3 note docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_3_NOTE_2026-10-26.md
(e8e553b2...1bb6), repository-only and unreviewed, answers J1-J9: interactive-console
check run by the supervisor (isTTY exception), per-run console challenge, residual restated
as any console host including an agent's terminal tool, pending Jordan's confirmation (J1);
full console field list, operational provenance owner_undertaking_console and extended
channel table (J2); ownership time from the chain part (J3); core-derived
sql_instance_unchanged (J4); sql_deadline schema (J5); toStringTag brand check and
new Uint8Array copy (J6); supervisor times are assertions, freshness anchored to helper
times (J7); type byte in parts (J8); durable history before launch (J9). Earlier
documents unchanged; nothing implemented or executed. Implementation not started;
operational NOT READY. Next eligible: v1.3 note re-review in a fresh thread.

## CW-01 operational adapter design v1.2 note written — October 26, 2026

CW-01 operational adapter design v1.1 re-review (2026-10-26): SUPPORTED WITH CONDITIONS;
F1-F6 resolved, F7 partial; new Medium G1, G2, Low G3-G7; implementation not started;
native NOT READY. Review docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_REVIEW_2026-10-26.md
(48ee4835...74de); receipt tracking/evidence/theme-intent-cw01-operational-adapter-design-v1-1-review-2026-10-26/
reviewer-receipt.json (c1debc77...ee31).
v1.2 note docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_2_NOTE_2026-10-26.md
(a3d64af4...0c8a), repository-only and unreviewed, answers G1-G7 and I-a to I-f: multipart
{parts} input with fixed per-event schema and a supervisor channel (G1); separate
owner_undertaking channel hash-linked to the collector record, console-collected and
labeled unauthenticated, residual for Jordan to accept or reject (G2); descriptor-only
wrapper reads and one byte copy (G3); typed frames, secret never reaches the core (G4);
postgres image locked through disconnect and pg_bin ACL binding (G5); helper exits on
supervisor loss, orphaned_run_needs_owner terminal (G6); password lives with the client,
ended after sql_B (G7). Design and v1.1 note unchanged; nothing implemented or executed.
Next eligible: v1.2 note re-review in a fresh thread.

## CW-01 operational adapter design v1.1 note written — October 26, 2026

Additive note docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_V1_1_NOTE_2026-10-26.md
(0c314c1c...c02e), repository-only and unreviewed, answers the review's F1-F7 and
I-1 to I-8: detached helper spawn (F1); reviewed forward-slash pidfile line-2 literal
(F2); quoted argv[0] and share-read hash-locked images before launch (F3); printable-
ASCII paths for everything PostgreSQL sees (F4); one-shot string password, no pgpass
(F5); no PG* environment and resolved-parameter check (F6); core v5 takes {channel,
bytes}, parses strictly and stamps provenance per channel (F7). Design bytes unchanged.
Nothing implemented or executed. M3 unchanged and not reopened; operational/native
readiness NOT READY. Next eligible: independent re-review of the note in a fresh thread.

## CW-01 operational adapter design independently reviewed — October 26, 2026

Independent review (Claude, same model family as the author; not blinded):
docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_REVIEW_2026-10-26.md (3cbfe9cf...4c3f);
receipt tracking/evidence/theme-intent-cw01-operational-adapter-design-review-2026-10-26/
reviewer-receipt.json (b2d13f6f...d88e). Verdict: SUPPORTED WITH CONDITIONS. Mediums:
F1 libuv puts non-detached children in a kill-on-close job, so A2 always refuses; F2
PostgreSQL 18.6 writes pidfile line 2 with forward slashes, so v4's same-spelling check
always fails. Lows F3-F7 (argv[0]/prelaunch hashing, WorstFit non-ASCII paths, pg string
password and pgpass fallback, PG* env fallback, core-side framing/provenance).
Implementation not started; operational readiness NOT READY; M3 not reopened.

## Studio work committed (PR #46); CW-01 operational adapter design written — October 26, 2026

Committed the uncommitted work from October 20-26 on branch claude/project-thread-7gwqdm
and opened PR #46 (six commits). Hash-bound files were kept byte-exact: 101 listed in
.prettierignore, 121 CRLF/mixed-ending files marked -text in .gitattributes. .codex/config.toml
left uncommitted (local path only). Checks: tsc -b pass; prettier check pass; CW-01 v4
tests 26/26. Some historical-state script tests fail on hash drift of later-edited files
(recorded in the PR); compiled suite had 16 local failures, not triaged.
Wrote docs/THEME_INTENT_CW01_OPERATIONAL_ADAPTER_DESIGN_2026-10-26.md (97258c08...031e),
repository-only and unreviewed: native helper (Rust, hash-bound) with AutoRun existence,
job, preflight, launch, W1 pidfile, process-chain, DPAPI credential and W2 adapters; SQL
observer on asset v2; framed JSON evidence boundary closing I-C and the getter limit;
manifest bindings and nine per-scope grants; core v5 changes specified, not built.
Nothing operational read or executed. M3 unchanged and not reopened; operational/native
readiness NOT READY. Next eligible: independent repository-only review of the adapter
design in a separate thread.

## CW-01 fixture core v4 independently supported; 120 s bound owner-confirmed — October 26, 2026

v4 re-review (docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REVIEW_2026-10-26.md, 2d4ab765...c3e8):
v4 SUPPORTED as a fixture-only slice; no new Low+ findings; fix/review loop closed.
Jordan then confirmed the 120 s attestation-to-spawn bound ("120 s is fine"),
recorded in tracking/DECISIONS.md; no code changed. Supported fixture core:
scripts/theme-intent-cw01-core-fixture-v4.mjs with
tests/theme-intent-cw01-core-fixture-v4.test.mjs and SQL asset cw01-observer-sql/2.
Carry into adapter design: non-JSON evidence is recorded as null and fails closed;
getters are resolved once at copy time. Operational/native readiness NOT READY
(blocked): reader N1-N4, collector L1/L4, process-metadata/pidfile/registry adapters,
protected credential, real manifest bindings, grants and the owner attestation remain.
M3 unchanged and not reopened; original A0/native acceptance blocked; NI not-run; H
unverified; full C54 partial; workspace-ID alternative disabled. No commit, push or
automatic next milestone.

## CW-01 fixture core v4 repair independently re-reviewed — October 26, 2026

Independent re-review (Claude, same model family as the repair author; not blinded):
docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REVIEW_2026-10-26.md; receipt
tracking/evidence/theme-intent-cw01-fixture-core-v4-review-2026-10-26/reviewer-receipt.json.
Verdict: fixture core v4 (ce3c4ad7...07bb) and tests (666ce597...7149) SUPPORTED as a
fixture-only slice; L-1, I-1 and I-2 fixed; no regression against v3. Reproduced: v4
tests 26/26; mutation check baseline pass and 33/33 killed (output byte-identical to the
recorded results). All 48 receipt-bound hashes match; v1-v3 files, SQL asset and frozen
inputs unchanged. Probes: 968-cell bad-evidence matrix, v4 throws 0 (v3 242), 0 v3/v4
differences where v3 did not throw; stored copy digests equal history digests. No new Low
or higher. Informational: refused-path digest of the copy not pinned by a test (I-A);
prior format /3 not individually pinned (I-B, cosmetic); non-JSON evidence is recorded
as null, indistinguishable from absent (I-C). Decision for Jordan: confirm the 120 s
attestation-to-spawn bound or name another value; this is the only open item needing
Jordan. Operational/native readiness NOT READY (blocked), unchanged. M3 unchanged and not
reopened; original A0/native acceptance blocked; NI not-run; H unverified; full C54
partial; workspace-ID alternative disabled. No SQL, credentials, operational reads,
cluster/app actions, launch or sign-in.

## CW-01 fixture core v4 repair (v3 re-review L-1) — October 26, 2026

Under Jordan's approved fix-and-review loop, after the v3 re-review
(docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md: v3 SUPPORTED as a
fixture slice; Low L-1, informational I-1/I-2). Report:
docs/THEME_INTENT_CW01_FIXTURE_CORE_V4_REPAIR_2026-10-26.md; evidence:
tracking/evidence/theme-intent-cw01-fixture-core-v4-2026-10-26/. Successor files
scripts/theme-intent-cw01-core-fixture-v4.mjs and
tests/theme-intent-cw01-core-fixture-v4.test.mjs; v1-v3 and SQL asset byte-unchanged.
L-1: step copies evidence first (deep-frozen JSON) and validates, digests and stores
that copy. I-1: B freeze pinned. I-2: non-JSON evidence fails closed without throwing.
Attestation bound still 120 s pending Jordan's confirmation. Checks: v4 tests 26/26;
mutation check baseline pass and 33/33 killed; Prettier clean. Independent re-review
pending. Operational/native readiness NOT READY (blocked), unchanged. M3 unchanged
and not reopened; original A0/native acceptance blocked; NI not-run; H unverified;
full C54 partial; workspace-ID alternative disabled. No SQL, credentials,
operational reads, cluster/app actions, launch or sign-in.

## CW-01 fixture core v3 repair independently re-reviewed — October 26, 2026

Independent re-review (Claude, same model family as the repair author; not blinded):
docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REVIEW_2026-10-26.md; receipt
tracking/evidence/theme-intent-cw01-fixture-core-v3-review-2026-10-26/reviewer-receipt.json.
Verdict: fixture core v3 (4f61cbaf...5aa2) and tests (ecb7e95d...c37c) SUPPORTED as a
fixture-only slice; R-1, R-2 and R-3 fixed as specified; no regression against v2.
Reproduced: v3 tests 24/24; mutation check baseline pass and 33/33 killed (output
byte-identical to the recorded results). All 39 receipt-bound hashes match; v1/v2 files,
SQL asset and frozen inputs unchanged. New Low L-1: SQL evidence is checked before it is
copied, so an evidence object with its own toJSON can store values different from those
checked (probe: SQL phase limit bypassed); repair is copy-then-check. Informational: B's
freeze not pinned by a test; non-JSON evidence throws (pre-existing in v2). Decision for
Jordan: confirm the 120 s attestation-to-spawn bound or name another value (review finds
120 s acceptable; 30-60 s would also work). Then a narrow v4 repair of L-1, or carry L-1
into adapter design. Operational/native readiness NOT READY (blocked), unchanged. M3
unchanged and not reopened; original A0/native acceptance blocked; NI not-run; H
unverified; full C54 partial; workspace-ID alternative disabled. No SQL, credentials,
operational reads, cluster/app actions, launch or sign-in.

## CW-01 fixture core v3 repair (re-review R-1 to R-3) — October 26, 2026

Under Jordan's approved fix-and-review loop, after the v2 re-review
(docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md: v2 SUPPORTED as a
fixture slice with Lows R-1 to R-3). Report:
docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REPAIR_2026-10-26.md; evidence:
tracking/evidence/theme-intent-cw01-fixture-core-v3-2026-10-26/. Successor files
scripts/theme-intent-cw01-core-fixture-v3.mjs and
tests/theme-intent-cw01-core-fixture-v3.test.mjs; v1/v2 and SQL asset byte-unchanged.
R-1: attestation at most 120 s older than pg_ctl creation (repair's choice; Jordan to
confirm). R-2: stop launch exit required; stopped state observed after that exit.
R-3: accepted SQL A/B evidence kept as deep-frozen copies. Checks: v3 tests 24/24;
mutation check baseline pass and 33/33 killed; Prettier clean. Written by the same
Claude session as the v1 review and v2 repair: independent re-review pending.
Operational/native readiness NOT READY (blocked), unchanged. M3 unchanged and not
reopened; original A0/native acceptance blocked; NI not-run; H unverified; full C54
partial; workspace-ID alternative disabled. No SQL, credentials, operational reads,
cluster/app actions, launch or sign-in.

## CW-01 fixture core v2 repair independently re-reviewed — October 26, 2026

Independent re-review (Claude, same model family as the repair author; not blinded):
docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REVIEW_2026-10-26.md; receipt
tracking/evidence/theme-intent-cw01-fixture-core-v2-review-2026-10-26/reviewer-receipt.json.
Verdict: fixture core v2 (f72b9ea1...a1de) and tests (3309e810...624c) SUPPORTED as a
fixture-only slice; F1, F2 (as specified) and F3 fixed; I-2/I-3 fixed; I-1 erratum
accurate; 15 s pre-spawn bound for preflight/job confirmed. Reproduced: v2 tests 21/21;
mutation check baseline pass and 28/28 killed (output byte-identical to the recorded
results). All 30 receipt-bound hashes match; v1 files, SQL asset and frozen inputs
unchanged. Three Low conditions: R-1 attestation not bounded to the spawn (design I3
"immediately before W1"); R-2 stop launch handle need not show an exit; R-3 accepted SQL
A/B evidence held by reference in ctx. Options: narrow v3 repair of R-1..R-3, or carry
them as conditions into adapter design. Operational/native readiness NOT READY
(blocked), unchanged. M3 unchanged and not reopened; original A0/native acceptance
blocked; NI not-run; H unverified; full C54 partial; workspace-ID alternative disabled.
No SQL, credentials, operational reads, cluster/app actions, launch or sign-in.

## CW-01 fixture core v2 repair (review F1-F3) — October 26, 2026

Jordan approved repairing the fixture-core review findings. Report:
docs/THEME_INTENT_CW01_FIXTURE_CORE_V2_REPAIR_2026-10-26.md; receipt/TAP/mutation
evidence: tracking/evidence/theme-intent-cw01-fixture-core-v2-2026-10-26/. Successor
files scripts/theme-intent-cw01-core-fixture-v2.mjs and
tests/theme-intent-cw01-core-fixture-v2.test.mjs; v1 core/tests and SQL asset
cw01-observer-sql/2 byte-unchanged. F1: start/stop outcomes and launch handles are
measured evidence; chain pg_ctl exit must equal the launch handle's. F2: 90 s outer
deadlines, 30 s SQL phase and freshness measured to the spawn (AutoRun/job/preflight
<= 15 s before pg_ctl creation; B <= 5 s before stop pg_ctl creation; timed
revalidation). F3: frozen request snapshot with digest in history and receipt. I-2
ordered SQL fidelity test; I-3 CONIN$/CONOUT$; I-1 header-comment erratum (A02/B02)
recorded, asset unchanged. Checks: v2 tests 21/21; mutation check baseline pass and
28/28 killed; Prettier clean. Written by the reviewer of v1 (same model family): an
independent re-review is pending; no self-issued pass. Operational/native readiness
NOT READY (blocked), unchanged. M3 unchanged and not reopened; original A0/native
acceptance blocked; NI not-run; H unverified; full C54 partial; workspace-ID
alternative disabled. No SQL, credentials, operational reads, cluster/app actions,
launch or sign-in. Next: independent re-review per the report's prompt.

## CW-01 fixture-only core independently reviewed — October 26, 2026

Independent U02 review (Claude, same model family as the implementer; not blinded):
docs/THEME_INTENT_CW01_FIXTURE_CORE_REVIEW_2026-10-26.md; receipt
tracking/evidence/theme-intent-cw01-fixture-core-review-2026-10-26/reviewer-receipt.json.
Verdicts: SQL asset cw01-observer-sql/2 (074561c3...89b2) SUPPORTED (exact bytes;
ordered fidelity to the frozen design's 70 SQL lines; M1/M2/R3/L3/L4/I-a correct;
header comment erratum I-1). Fixture core/tests SUPPORTED IN PART: R1-R3, I1/I2/I4/N4
enforced; tests 18/18 and recorded mutation check 12/12 killed reproduced. Two Medium
repairs needed: F1 start/stop outcome and pg_ctl launch handle bypass measured
provenance; F2 outer/SQL deadlines and freshness anchored to caller intent times and
self-reported booleans, not the measured spawn. Low F3: request not snapshotted or
digest-bound. Freshness values confirmed (15 s AutoRun, 5 s pre-stop) but to be
measured to pg_ctl creation / stop launch. No fixture-to-operational promotion found.
Operational/native readiness NOT READY (blocked), unchanged. M3 unchanged and not
reopened; original A0/native acceptance blocked; NI not-run; H unverified; full C54
partial; workspace-ID alternative disabled. No SQL, credentials, operational reads,
cluster/app actions, launch or sign-in. Next is Jordan's selection (narrow F1/F2 repair
plus re-review, carry as conditions, or defer); no automatic next milestone, commit
or push.

## CW-01 fixture-only core implemented — October 26, 2026

Jordan authorized the bounded repository-only CW-01 prerequisite slice. Report:
docs/THEME_INTENT_CW01_FIXTURE_CORE_IMPLEMENTATION_2026-10-26.md; receipt/TAP/mutation
evidence: tracking/evidence/theme-intent-cw01-fixture-core-2026-10-26/. Added
successor SQL asset scripts/theme-intent-cw01-observer-sql-v2.sql (cw01-observer-sql/2,
074561c3...89b2; NOT executed; original design SQL unchanged), pure core
scripts/theme-intent-cw01-core-fixture.mjs and tests/theme-intent-cw01-core-fixture.test.mjs.
Core: fixture-only admission (operational mode always blocked; missing bindings,
grants and adapter reviews are blockers), hash-linked lifecycle with
candidate_process_bound, terminal unknown/ownership/producer states, refused
retry/escalation/adoption. R1 fresh existence-only HKLM/HKCU AutoRun, System32 view
bound; R2 upward walk from pidfile PID with handle-bound containment (no PID
non-reuse assumption, probe shell refused); R3 mandatory pg_backend_pid parent =
owned postmaster. I1 nested-job refusal, pidfile line 7 empty, N4 spelling, same
connection A/B, per-session preload labels. Fixture receipts never satisfy an
operational gate; model assertions are not measurements.

Checks: node --test on the new file only, 18/18 pass; 12/12 targeted mutants killed;
Prettier check on new files; 14 frozen inputs rehashed, 0 mismatches. Not run: SQL,
credentials, operational config/registry/process/port/pidfile reads, cluster/app
actions, launch/sign-in, unrelated tests/verifiers. Independent review pending (author
is the reviews' model family). Adapters N1-N4, collector L1/L4, process/pidfile/
registry/credential adapters, real bindings, grants and attestation remain blockers.
CW-01 NOT operational. M3 unchanged and not reopened; original A0/native blocked, NI
not-run, H unverified, full C54 partial; workspace-ID alternative disabled. Next:
independent review using the prompt in the report; no automatic next milestone.

## CW-01 implementation design v1.1 note independently reviewed — October 26, 2026

Repository-only U02 review by Claude (same model family as the frozen design
review; note and design by Codex; not blinded). Report:
docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_REVIEW_2026-10-26.md; receipt:
tracking/evidence/theme-intent-cw01-implementation-design-v1-1-review-2026-10-26/.
Design support: SUPPORTED at design scope with three Lows. M1, L2, L3, L4 and
I-a-I-f resolved; M2 resolved in substance; L1 partly. R1 CMD.EXE AutoRun (no /D in
pg_ctl's shell or its popen version probe) runs before postgres and can alter the
postmaster environment; needs a detect-only existence check with its own grant.
R2 parent links must use GetProcessTimes containment and an upward walk from the
pidfile PID, not undocumented PID non-reuse while a handle is open. R3 link the SQL
session directly (pg_backend_pid parent or listener owner PID), not only by time.
Info I1-I5 (nested jobs, pidfile lines 2/7, crash-restart, per-session preloads,
process-metadata privacy). Implementation NOT STARTED; operational/native NOT READY.

Checks: 348 snapshot entries rehashed (0 mismatches), note/receipt/frozen design and
review hashes, local links, REL_18_6 source and PostgreSQL 18/Microsoft docs read
(hashes in receipt). No code, tests/verifiers, SQL/credentials, pidfile/registry/
process/operational reads, cluster/app actions or sign-in. M3 unchanged and not
reopened; original A0/native blocked, NI not-run, H unverified, full C54 partial;
workspace-ID alternative disabled. Next on Jordan's selection: a small additive
v1.2 note closing R1-R3, carry R1-R3 into a later implementation design, or defer.

## CW-01 implementation design v1.1 repair note prepared — October 26, 2026

Jordan authorized the additive repository-only repair. Added
docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_V1_1_NOTE_2026-10-26.md;
receipt/input map: tracking/evidence/theme-intent-cw01-implementation-design-v1-1-2026-10-26/.
Proposed M1/M2 and L1-L4 fixes, I-a-I-f dispositions; independent exact review pending.
M1 uses host(inet_server_addr()), requires boolean true; NULL blocks. M2 defines
W1-only stable bounded postmaster.pid read, exact pg_ctl->CMD->postmaster instance
chain with image/creation/parent handles, SQL startup time/recovery confirmation
and pre-stop revalidation. Candidate_process_bound precedes SQL identity proof;
pg_ctl readiness alone grants neither ownership nor stop. W2 pidfile stays
existence-only; new W1 read requires its own reviewed scope/grant.

L1 pins trusted COMSPEC/system working directory and strict CMD-safe paths,
acknowledging pg_ctl's internal shell. L2 inner pg_ctl timeout80s under outer90s,
process-handle exit not pipe EOF, NUL output, no inherited kill-on-close jobs or
process-tree kill. L3 NULL backend_type zero counts in both transactions. L4
pre-start/W2 signal-file absence and detect-only effective recovery/preload/archive
boundary checks; no post-start repair of missing preflight. No new background ranges,
credentials, operational inputs or owner attestation inferred. Adapter/binding
blockers remain, including Windows process-provenance implementation/qualification.

Checks: official PostgreSQL18/REL_18_6 and Microsoft source/docs read, prior343
snapshot entries verified, 348 frozen inputs unchanged, four local links and new-note
format/whitespace checks. Original design/review/receipts untouched; prior tracking
bytes preserved as suffixes. No code, tests/verifiers, operational reads, pidfile/SQL/
credential access, cluster/app actions, sign-in, helper/install/migration/recovery,
activation or retired-checkout access. M3 unchanged; original A0/native blocked,
NI not-run, H unverified, full C54 partial; workspace-ID alternative disabled.
Next eligible: independent exact repository-only note review (prompt at note end),
then stop for owner selection. No automatic implementation or operational milestone.

## CW-01 implementation design independent review — October 26, 2026

U02 review by Claude (Codex authored the CW-01 design, governing design and v1.1
note; prior reviews by other Claude sessions, same model family; not blinded):
docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_REVIEW_2026-10-26.md, receipt
tracking/evidence/theme-intent-cw01-implementation-design-review-2026-10-26/.
Design support PARTIAL, bounded repair required. M1 Medium: address_ok compares
inet_server_addr()::text, which renders 127.0.0.1/32, so the gate is always false
(fail-closed). M2 Medium: Windows pg_ctl returns the CMD.EXE PID and its -w accepts
any recent pidfile and standby, so the ownership evidence (postmaster.pid line scope,
image/parent binding, pg_postmaster_start_time, pg_is_in_recovery) must be named.
Lows: L1 pg_ctl's own CMD.EXE/COMSPEC lookup and metacharacters; L2 coinciding
90 s deadlines, inherited pipes and job objects; L3 NULL backend_type rows uncounted;
L4 no post-start detect-only check of recovery/preload/archive settings or signal
files. Schema29 work predicates verified exact. 343 design inputs rehashed, 0
mismatches; prior bytes preserved. Implementation not started; operational/native
NOT READY; attestation blank. M3 unchanged; A0/native blocked, NI not-run, H
unverified, full C54 partial. Next on Jordan's choice: additive CW-01 design v1.1
note (prompt in review) or defer; no automatic milestone.

## CW-01 implementation design prepared — October 26, 2026

Jordan explicitly selected Prepare implementation design. Added
docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md;
receipt/input map: tracking/evidence/theme-intent-cw01-implementation-design-2026-10-26/.
Repository-only specification, not code or execution. Pins direct hash-bound start
argv with manifest port/listen_addresses=127.0.0.1 and smart/wait/90s stop; no adopt,
retry or escalation. Fixed schema29 SQL allowlist includes observer privilege and
identity, effective listener settings, catalog relation validation, ledger parity,
all work predicates and cluster-wide client/walsender/background observations in
separate A/B transactions. Terminal needs_human admitted via finished_at IS NULL.
W2/PR01+W2 extension has exact read scope/caps, immutable reference and no-proof
fingerprint limitations. Attestation binds operator/windows/manifest and fresh
pre-W1 affirmation, plus W1/W2/post-W3 confirmations; still blank.

Reader N1-N4, collector L1/L4 have concrete contracts with unimplemented/unbound
items marked blocking. Protected credential access, actual port/home/tools,
startup/auth/background boundary and relation fingerprint assets remain blockers;
no wider-credential fallback. Uses Claude's corrected REL_18_6 xlog locators
6195-6214/7290-7309 (F1) and addresses start binding F2. No new note edits.

Checks: 343 prior input hashes unchanged, three local links, new-document formatting/
whitespace and official PostgreSQL documentation reads. Prior tracking bytes
preserved as exact suffixes. Author involved; independent exact review pending.
No implementation, tests/verifiers, operational reads, SQL/credentials, cluster/app
start/stop, sign-in, helper/install/migration/recovery, activation or retired-checkout
access. M3 unchanged; original A0/native blocked, NI not-run, H unverified, full
C54 partial; workspace-ID alternative disabled. Next eligible: independent exact
repository-only implementation-design review (prompt in document), then stop;
no automatic implementation or operational milestone.

## Current-work safety design v1.1 note independent review — October 26, 2026

U02 review by Claude (Codex authored the design and note; the repaired findings came
from another Claude session, same model family; not blinded): docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_REVIEW_2026-10-26.md,
receipt tracking/evidence/theme-intent-current-work-safety-design-v1-1-review-2026-10-26/.
Design-scope resolution SUPPORTED: M1 now has a reachable, expressly threat-bounded
pass condition (W1 fresh samples, owned smart stop, W2 fingerprint match, full
owner attestation, else defer); L1 finished_at IS NULL equals schema29's five
nonterminal states; L2 smart mode, no escalation, foreign access means no stop.
W1 new-transaction sample confirmed necessary (REL_18_6 backend_status.c caches
activity per transaction). W2 limits confirmed (clean non-recovery start writes
pg_control only at production, xlog.c 6195-6214). New Lows: F1 note's xlog.c
locators wrong (corrected here: 6195-6214, 7290-7309); F2 CW-01 start invocation
unpinned (implementation condition: -p manifest port, listen_addresses=127.0.0.1,
-w -t 90). Corrected prior review: postgres.rs is in the /4 helper map. 337 note
inputs and all prior bytes unchanged. Implementation not started; operational/native
NOT READY; attestation blank. M3 unchanged; A0/native blocked, NI not-run, H
unverified, full C54 partial. Next eligible on Jordan's choice: repository-only CW-01
implementation design (prompt in review) or defer. No automatic execution.

## Current-work safety design v1.1 note prepared — October 26, 2026

Added docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_V1_1_NOTE_2026-10-26.md and
tracking/evidence/theme-intent-current-work-safety-design-v1-1-2026-10-26/.
Proposed M1/L1/L2 repair with I1-I4 dispositions; independent review pending.
W1: fresh foreign-client observations, explicit current listener/auth/startup
boundary and residual transient-access limitation. W2: pg_control hash/WAL inventory/
pid absence comparison plus enumerated owner attestation, not proof no start/write.
W3: retained native/observation rules and continuing no-producer undertaking.
Unknown owner access remains unknown; absent attestation means defer. Corrected
task count to finished_at IS NULL (terminal needs_human deliberately admitted).
Explicit owned pg_ctl smart/wait/90s stop; foreign access/adoption means no stop,
invalid result and scoped follow-up. No fast/immediate escalation or retry.

Official PostgreSQL 18 docs and REL_18_6 source read: normal startup/shutdown updates
control state, WAL names/sizes cannot establish unchanged contents; universal
no-start inference rejected. Fingerprint evidence is supplemental and threat-bounded.
studio.rs package map confirmed by prior review; postgres.rs directly matches
supported /4 helper source artifact map 109615f4...b88b, but source-to-exact-installed
native binary equivalence not established here. Current operational boundary still
needs reviewed evidence. Single-user alternative assessed, not selected.

Checks: original 330 snapshot entries verified; 337 frozen inputs preserved;
new-note formatting/local links and tracking whitespace checked. No implementation,
operational reads, tests/verifiers, SQL/credentials, cluster/app start/stop, helpers,
install/migration/recovery, activation or retired-checkout access. Original design,
receipts and Claude review unchanged; prior tracking bytes preserved as suffixes.
M3 unchanged; original A0/native acceptance blocked, NI not-run, H unverified,
full C54 partial, workspace-ID alternative disabled. Next eligible: independent
exact v1.1-note review against original design/review, schema29 and cited official
sources; exact bounded prompt in note. No automatic implementation/execution.

## Current-work safety design independent review — October 26, 2026

U02 review by Claude (different model family from Codex author; earlier Claude
sessions reviewed parts of this chain, not blinded): docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_REVIEW_2026-10-26.md,
receipt tracking/evidence/theme-intent-current-work-safety-design-review-2026-10-26/.
Design support PARTIAL: source trace faithful against bound studio.mjs 9d5ddac3
(plus studio.rs, also package-bound); schema29 predicates cover every automatic
consumer found; effect separation correct. M1 Medium: producer exclusion lacks a
concrete evidence basis (repair: W1/W2/W3 split, pg_control/pg_wal continuity across
owned stop and fresh PR-01, enumerated owner attestation or defer). L1 Low: terminal
needs_human tasks counted as nonterminal (fail-closed). L2 Low: stop mode and
foreign-backend-before-stop handling unspecified. Conditional database-only CW-01
remains the smallest coherent path. Operational/native readiness NOT READY.
Static reads and hashing only; no tests, verifiers, SQL, launch or operational reads.
Design, receipts and 330 snapshot inputs unchanged. M3 unchanged; native acceptance
blocked, original A0 blocked, NI not-run, H unverified, full C54 partial.
Next eligible: additive v1.1 note resolving M1/L1/L2 (exact prompt in the review),
then independent review. No automatic implementation or execution.

## Current-work safety design prepared — October 26, 2026

Repository-only design: docs/THEME_INTENT_CURRENT_WORK_SAFETY_DESIGN_2026-10-26.md.
Receipt/input map: tracking/evidence/theme-intent-current-work-safety-design-2026-10-26/.
Traced hashed reviewed studio.mjs startup, recovery/outbox relay, workflow leasing/
wakeup/reconciliation, plan/model admission, scheduler and request-driven fetch/
preview paths. Exact bundle and three mapped sources match package reviewer hashes.
Worker starts before UI baseline; M3 scheduler-off does not exclude queued work.
Selected conditional standalone database-only CW-01 design, not helper execution.
Adapt historical quiescence predicates, add actual unfinished-workflow enumeration
and undelivered outbox checks; schema29 allowlist, all-workspace counts only, bounded
read-only transaction, owned cluster start/normal stop and protected authentication.
These lifecycle/credential operations have effects and need separate exact review/
authority. No generic helper invocation, source-only clearance or worker-off shortcut.

Operational admission deferred: configured port/tools/home, reviewed capability,
protected access and producer exclusion unresolved. Other-session/work-producer
access is owner-reported unknown; a clean snapshot cannot bridge that gap or survive
uncontrolled stop/relaunch. No current-work observation or native permission claimed.
If exclusion cannot be supported, defer or separately design effective startup
control; no changed-candidate implementation/install selected automatically.

Checks: static reads/searches only, four exact package-map matches, 330 preserved
input hashes unchanged, four local links, new-document formatting/whitespace.
Snapshot taken after inspection/before authoring, not claimed pre-read capture.
Failed path searches/parse-only shell attempt corrected; no result invented.
Prior tracking bytes preserved as suffixes. No tests/verifiers, operational reads,
SQL/credentials, implementation, launch/sign-in, helper/install/migration/recovery,
activation or retired-checkout access. Author involved; independent review pending.
M3 unchanged, original A0/native acceptance blocked, NI not-run, H unverified,
full C54 partial. Next eligible: independent exact repository-only design review;
exact prompt in design. No automatic implementation or operational milestone.

## Owner Quit method/time clarified — October 26, 2026

Jordan reports no problems with launches/sign-ins/restarts since October 24; this
does not establish that none occurred or provide complete helper/config/install
history. Reports using Quit in the top-left dropdown about October 26 00:15
America/New_York (approximately 04:15 UTC), not a measured timestamp. Other-session/
work-producer access explicitly unknown. Additive owner report:
tracking/evidence/theme-intent-owner-input-inspection-2026-10-26/OWNER_QUIT_AND_HISTORY_CLARIFICATION.md.
Quit control reported, actual running/stopped state and SH-01 timing unobserved;
no passing planned-Quit case or unplanned-exit incident inferred. Prior evidence
and reviews unchanged. No operational read/action or new grant. Original A0 and
native acceptance blocked; M3 unchanged, H unverified, full C54 partial. Next
eligible remains repository-only current-work safety design under supported v2,
not automatically executed. Validation: targeted report formatting and tracking
whitespace; prior tracking bytes preserved as exact suffixes. No runtime tests.

## Post-launch reconciliation independently reviewed and repaired — October 26, 2026

Owner authorized continuing the recommended path and a fresh review subagent.
First review: docs/THEME_INTENT_POST_LAUNCH_RECONCILIATION_REVIEW_2026-10-26.md,
receipt under tracking/evidence/theme-intent-post-launch-reconciliation-review-2026-10-26/.
Same-model fresh subagent, no inherited conversation, not blinded; did not author
reviewed plan/v1. Verdict partial documentation, native admission blocked. R1 High:
owner acceptance of unknown queued/uncertain work cannot replace current-work
safety support before worker-on launch. R2 Low: identification branch needs exact
installed UI identity/role procedure. Historical evidence reusable: reviewer checked
341 helper/reviewer/installation map bindings, all matched; 384 preservation hashes
unchanged. Parent independently rechecked the 384 hashes before tracking updates.

Preserved original plan and proposed v1. Added successor
docs/THEME_INTENT_POST_LAUNCH_ACCEPTANCE_AMENDMENT_V2_2026-10-26.md,
SHA256 555a54faa9f5f33efbb912dd5170e3794577fa18a3bdd6716e07755aed55ad8d.
Current-work safety is mandatory before every launch, including identification;
owner risk acceptance, PR-01 and M3 cannot substitute. Exact-ID default block
retained; no UI role inference from absent owner suffix and no worker command
execution. Separate review of exact v2 supports documentation repair, R1/R2 resolved,
no new actionable findings: docs/THEME_INTENT_POST_LAUNCH_ACCEPTANCE_AMENDMENT_V2_REVIEW_2026-10-26.md,
receipt under tracking/evidence/theme-intent-post-launch-amendment-v2-review-2026-10-26/.
Same reviewer, retained review history, no v2 authorship; nine inputs unchanged.
Owner adoption and operational/native readiness remain pending; no grant created.

Validation: new author documents formatted and local links checked; both review
receipts and preservation maps checked directly, no historical verifier/test run.
Prior tracking bytes retained as exact suffixes. Only repository preparation/review;
no operational reads, adapter/collector/control implementation, launch/sign-in,
SQL/helpers, installation/migration, activation, recovery or retired-checkout access.
Missing owner history/quit mechanism/other-producer knowledge requested, not inferred.
M3 unchanged; original A0 blocked, NI cases not-run, H unverified, full C54 partial.
Next eligible: exact repository-only current-work safety design prompt in v2 review.
Trace exact-candidate startup/worker/outbox/broker/retrieval admission, choose one
bounded evidence/control approach or defer; no automatic operational milestone.

## Post-launch reconciliation plan prepared — October 26, 2026

Repository-only proposal:
docs/THEME_INTENT_POST_LAUNCH_RECONCILIATION_PLAN_2026-10-26.md.
Historical October 24 installation/preservation evidence remains usable at its
original scope; no reinstall, migration or unrelated fixture rerun justified.
October 26 owner-reported visit is not NI-00/NI-01 or a sampling incident. Original
A0 remains blocked; reported quit does not establish stopped state. Proposed path:
review a versioned prospective-session amendment, resolve missing owner/binding
inputs, then separately prepare/review the concrete operational capability and
scope before any observation or native session. Unknown workspace ID needs existing
evidence or an explicitly reviewed/owner-approved identification-only amendment;
no out-of-order sign-in. Prior items 1–6 targeted authority retained, not expanded
or executed; adapter/collector review prerequisites remain. M3 unchanged, native
acceptance blocked, H unverified, full C54 partial. No operational reads, launch,
implementation, SQL/helpers, activation, cleanup or retired-checkout access.
Validation: targeted new-plan formatting, local-link and whitespace checks; prior
tracking bytes retained as exact suffixes and frozen theme-intent files hash-checked.
No runtime tests or independent review claimed. Next eligible: uninvolved exact
repository-only review of this plan and amendment choices; no automatic next step.

# Implementation status

## Owner launch details clarified — October 26, 2026

Jordan reports opening Creator Agent about 12:10 a.m. October 26 via
C:\Users\jorda\OneDrive\Desktop\Creator Agent.lnk, subsequently quitting,
and only looking around without making changes. Time interpreted as America/New_York
(approximately 04:10 UTC), not a measured timestamp. Exact quit time/mechanism and
actual stopped state unobserved. No intentional changes reported; automatic startup/
worker/auth/shutdown effects remain unobserved. Shortcut storage in OneDrive does
not establish a OneDrive studio home; shortcut not inspected in this step.
Evidence: tracking/evidence/theme-intent-owner-input-inspection-2026-10-26/OWNER_LAUNCH_CLARIFICATION.md.
Prior reports preserved. Workspace name/owner role reported, ID unknown. Next
eligible: bounded reconciliation proposal before acceptance, using repository and
owner evidence; no automatic operational read/relaunch/recovery. Native acceptance
remains blocked; M3 unchanged, H unverified, full C54 partial.

## Owner workspace/role replies and reported launch — October 26, 2026

Jordan reports workspace Jordan's Creator Studio, role owner; workspace ID unknown.
Earlier persistence/install recollections refer to before October 24 shutdown.
Jordan also reports opening the app now and seeing apparently persisted state.
Exact time/route, subsequent actions, other intervening activity and running state
remain unknown. Evidence: tracking/evidence/theme-intent-owner-input-inspection-2026-10-26/OWNER_REPLIES_AND_LAUNCH.md.
Owner report only, not NI-00/NI-01 verification or a collector observation. No
sampling window was running. A0 continuity/prelaunch gate remains blocked; familiar
appearance does not establish unchanged database/work state. No damage or dispatch
is inferred. Next: clarify launch details and prepare scoped reconciliation before
acceptance; no automatic relaunch, SQL, helper or recovery. No agent app interaction
performed. M3 unchanged, H unverified, full C54 partial.

## Targeted owner-input inspection — October 26, 2026

Jordan authorized inspection of items 1-6 and guidance for 7-9. Completed targeted
host environment, named Creator Agent shortcut/Run-value reads and hashes/file
versions of two source-listed PostgreSQL candidate executables. Results/limits:
tracking/evidence/theme-intent-owner-input-inspection-2026-10-26/INSPECTION.md.
Host LOCALAPPDATA identified; no host process/user/machine home override found;
all launch paths remain unconfirmed. Both candidate tools have file version 18.6;
exact hashes recorded, not yet bound to configured pg_bin. Initial sandbox
LOCALAPPDATA explicitly rejected as launch evidence. No app/tool launch, config
read, SQL, PR-01/SH-01 execution or acceptance. Database port and configured pg_bin
remain pending because no independently reviewed operational adapter exists.
User's targeted read authorization does not substitute for that review requirement.
Asked Jordan for continuity and intended workspace/last-known role; replies pending.
Original template remains blank. Next: incorporate answers and resolve missing
field evidence through owner input or separately reviewed adapter. M3 unchanged;
no collector; native acceptance blocked, H unverified, full C54 partial.

## Owner-attestation template v1.1 clarification — October 26, 2026

Owner authorized the L1-L3 documentation clarifications. Added
docs/THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_V1_1_NOTE_2026-10-25.md
(the October 25 filename is retained from the review's requested artifact name;
the note records its actual preparation date and Codex authorship).
L1 now distinguishes intended workspace/last-known role with evidence date from
current confirmation at NI-01; mismatch or insufficient role stops before writes.
L2 adds ASCII-case-insensitive onedrive component-prefix rejection and links all
four successor notes with their precedence. L3 permits owner-produced nonsecret
port/hash/file-properties-version evidence with source/date/method, while missing
evidence stays pending and agent inspection still needs its own scoped grant.
Also clarifies historical versus per-window attestation, observer effects and
omission of other account names. No values filled, operational reads, collector,
launch, grants or runtime changes. M3 unchanged; native acceptance blocked,
H unverified and full C54 partial.

Validation: source comparison against the review, proposal/notes and plan v5;
all source links resolve and all nine original fields remain blank. Rehashed
116 prior review input/report paths before and after, zero mismatches.
Template SHA-256: a5f49bf0edc962ec9dc1305c0261e82b52721c03cc2a998f2e6304c69a4e3e91.
Additive note SHA-256: 0347619a9974aff3889950aae3353d6321c3335e1d6fb0849a00beec25296c39.
Review receipt SHA-256: fba04ac9702e2bcb2418ed2c92b1306f5744bd5b976f27c266c84f8e3b4a3e76.
No runtime tests or verifiers run for this documentation-only change; no independent
review claimed. Next eligible: Jordan supplies nonsecret owner inputs under the
clarified template, leaving unknowns explicit; assess them without treating the
template as an execution grant or automatically starting a collector milestone.

## Claude collector owner-attestation template independent review — October 25, 2026

Separate-session Claude U02 review (did not author the template or its tracking
entries; same model family as the L12/L13 review thread that wrote the template
prompt; not blinded). Report:
docs/THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-collector-owner-attestations-template-review-2026-10-25/reviewer-receipt.json
(fba04ac9...3e76). Template a5f49bf0...3e91 unchanged. Verdict: supported as a blank
owner-input request; no Critical/High/Medium. All nine fields blank, cover the nine
prerequisites, preserve exact-key, active-home, tool-identity, continuity/quiet-launch
and workspace/role rules, prefill nothing and grant no authority. Low L1: workspace
ID/role currentness demanded before a session while sign-in is forbidden (plan v5
confirms at NI-01). Low L2: note v4.2 OneDrive key-admission rule omitted; notes
v4.1-v4.4 not cited. Low L3: port and pg_ctl/postgres hash/version evidence has no
stated owner-side route (no repository record exists). Info I16-I19. Checks: prior
L12/L13 receipt input+report maps rehashed 113/113 distinct paths, zero mismatches;
text searches of template; static reading. No classifier, verifier, --record,
record-baseline or test run; no operational access; no field filled. M3 unchanged.
No collector; native acceptance blocked, H unverified, full C54 partial. Next
eligible (exact prompt in report, not executed): additive v1.1 template note
resolving L1-L3, or Jordan fills the template as is accepting them.

## Blank collector owner-attestation template prepared — October 25, 2026

Owner authorized the exact next prompt from the supported L12/L13 review. Added
docs/THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_2026-10-25.md using
repository text only. Nine blank response fields cover exact launch LOCALAPPDATA,
CREATOR_STUDIO_HOME/launch paths, database port, pg_bin, separate pg_ctl/postgres
identity provenance, historical continuity, existing workspace ID and current role.
Each names owner-supplied evidence and the collector/session prerequisite it supports.
No values filled or inferred; no operational read, environment/registry/process/port
query, external file access, collector, launch or grant. The reviewed scope manifest,
collector implementation/review, concrete operational grant and bounded session
decision remain separate and pending. M3 unchanged; native acceptance blocked,
H unverified and full C54 partial.

Validation: reviewed against the L12/L13 report's exact prompt, proposal v4 and
checklist v5; all nine fields blank. Prior review-bound files rehashed before and
after preparation (113 distinct paths, zero mismatches). No runtime tests rerun for
this documentation-only change. Next eligible: review the blank template against
its named repository sources, without filling values or expanding access. The
template contains that bounded next prompt; no automatic collector milestone.

## Claude verifier-L12/L13 repair independent review — October 25, 2026

Separate-session Claude U02 review (did not author the L12/L13 verify.mjs, REPAIR.md
or repair receipt, nor the L11 review; same model family as the L11 review that wrote
the implemented prompt; not blinded). Report:
docs/THEME_INTENT_OBSERVATION_VERIFIER_L12_L13_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-observation-verifier-l12-l13-review-2026-10-25/reviewer-receipt.json
(93417f2a...9996). Verdict: supported at supplemental-guard scope; no Critical/High/
Medium/Low. L12 and L13 resolved: the frozen L11 guard accepts all seven named forms,
the successor rejects them plus 35 further loop-target and modified-constructor
variants; 23 declaration/local-loop and keyword-constructor controls admitted. All 52
L11 mutants and 6 controls kept; unchanged classifier v4 admitted by v4, L11 and new
guards. Info I13 (static keyword constructor admitted; harmless static method), I14
(L11 scanner block replaced by a strictly stronger rule), I15 (escaped unquoted
keyword fails closed). Alias writes remain a documented limit. Checks: rehash 111/111
(214 overlapping bindings, 108 distinct prior paths, no tracking exclusion); new
verify.mjs no-arg exit 0, receipt bytes unchanged (041a98f7...caedb); 67 parse-only
guard probes on v4, L11 and new guards. No mutant program, older verifier entry point,
--record, record-baseline or classifier test run; historical 20/20 TAP read only. No
operational access. M3 unchanged. Verifier supported; fixture classifier unchanged;
no collector; native acceptance blocked, H unverified, full C54 partial. Next eligible
(exact prompt in report, not executed): owner-attestation template for the collector
prerequisites, repository text only, no values read or filled.

## L12/L13 verifier-only repair — October 25, 2026

Owner authorized the L11 review's exact successor prompt. New evidence directory:
tracking/evidence/theme-intent-observation-verifier-l12-l13-2026-10-25/.
L12 routes non-declaration for-of/for-in initializers through existing write-target
checks. L13 requires a ConstructorDeclaration's own ConstructorKeyword token,
including after modifiers. All L11 mutants and controls retained; unchanged v4
classifier admitted. Executed 61 negative AST/TAP checks, 12 positive controls,
three retained L11 and seven L12/L13 parse-only baseline reproductions. Preservation:
214 overlapping bindings, 108 distinct prior paths, zero mismatches. Historical
20/20 classifier TAP read only; classifier tests not rerun. No prior evidence edited.

REPAIR.md contains scope, limitations and the exact next independent U02 prompt.
Default verifier check-only preserves receipt bytes; receipt created exclusively.
Author involved; independent review pending. Next eligible: separate uninvolved
review of these exact bytes, no automatic implementation. Guard remains supplemental;
alias analysis is a documented limit. No operational access, collector, adapter,
launch or activation. M3 unchanged; N1-N4 and L1/L4 remain later scope. Native
acceptance blocked, H unverified, full C54 partial.

## Claude verifier-L11 repair independent review — October 25, 2026

Separate-session Claude U02 review (did not author the L11 verify.mjs, REPAIR.md or
repair receipt; same model family as the v4 review that wrote the implemented prompt;
not blinded). Report: docs/THEME_INTENT_OBSERVATION_VERIFIER_L11_REVIEW_2026-10-25.md;
receipt: tracking/evidence/theme-intent-observation-verifier-l11-review-2026-10-25/reviewer-receipt.json
(c4f53087...4d2e). Verdict: partial, two Low, no Critical/High/Medium. Both L11 rules
hold for every named and listed form; all 26 v4 mutants and v4 checks kept (guard diff
removes nothing); unchanged classifier v4 admitted. Low L12: for-of/for-in targets
rooted in allowed intrinsics accepted (`for (Number.isSafeInteger of [() => true]);`,
valid JS). Low L13: quoted constructor after static/async accepted (harmless or
unloadable). Alias writes are a documented limit; source uses none of these.
Checks: rehash 106/106 (204 overlapping bindings, 103 distinct prior paths; no
tracking exclusion occurred; v3/v4 mutex scripts are distinct paths with identical
bytes); new verify.mjs no-arg exit 0, receipt bytes unchanged (fb068553...8e2b); 151
parse-only guard probes on old and new guards; 7 node --check syntax files. No mutant
program, older verifier entry point, --record, record-baseline or classifier test run;
historical 20/20 TAP read only. No operational access. M3 unchanged. Verifier support
partial; fixture classifier unchanged; no collector; native acceptance blocked, H
unverified, full C54 partial. Next eligible (exact prompt in report, not executed):
verifier-only L12/L13 successor, or Jordan accepts both as documented limits.

## L11 verifier-only repair — October 25, 2026

Owner authorized the exact v4 review successor prompt. Added only a new verifier,
report and receipt under tracking/evidence/theme-intent-observation-verifier-l11-2026-10-25/.
Classifier v4, tests, notes and prior evidence unchanged: 204 overlapping bindings,
103 distinct prior paths, zero mismatches. Dangerous quoted property names and
non-local-root writes are rejected; all v4 mutants retained. Executed 54 negative
AST/TAP checks, six positive local controls and three parse-only old-guard L11
reproductions. The unchanged classifier is admitted. Historical 20/20 TAP was read,
not rerun. Default check-only verification preserves receipt bytes.

REPAIR.md records pre-receipt implementation failures and fixes, scope, limitations
and the exact next separate uninvolved U02 review prompt. The author is involved;
independent support is pending. Supplemental guard is not general purity or alias
analysis. No operational access, collector, adapter, launch or activation. M3
unchanged; N1-N4 and L1/L4 remain later scope. Native acceptance blocked, H unverified,
full C54 partial. No automatic next implementation.

## Claude observation-classifier v4 / v4.4-note independent review — October 25, 2026

Separate-session Claude U02 review (did not author classifier v4, tests, repair
report, v4.4 note, verify.mjs, record-baseline.mjs, baseline probes, TAP or repair
receipt; same model family as the v3 review that wrote the implemented prompt; not
blinded). Report: docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V4_REVIEW_2026-10-25.md;
receipt: tracking/evidence/theme-intent-observation-classifier-v4-review-2026-10-25/reviewer-receipt.json.
Verdict: pass for the fixture repair scope with one Low. Fixture classifier supported;
v4.4 note supported; no operational collector exists; native acceptance not ready/
blocked. v3->v4 diff is exactly the requested L9 pre-scan plus loop reason. L9
resolved and independently reproduced: U7 v3 unknown/INVALID_CLOSURE_TIMING -> v4
blocked/LAUNCH_NOT_EXCLUDED; U1-U7/U10 and other earlier rejections block for six
flag values; explicit launch keeps LAUNCH_DURING_SAMPLING; classifySample identical
(58 inputs) so the availability split holds. M1-M4, L6, L8, timing, key, binding,
count, redaction and planned Quit unchanged; no new pass in 210 v3/v4 probes; no
inherited test changed. L10 mutants rejected. Low L11: guard still accepts a
string-literal `{'constructor':F}` destructuring (reaches Function) and assignments
to allowed intrinsics (Number.isSafeInteger); source clean. Info I7-I9 in report.
Checks: rehash 101/101 (180 overlapping bindings, 92 distinct prior paths; tracking
exclusion excluded nothing); verify.mjs check-only exit 0, repair receipt bytes
unchanged (4e70e400...7bd0); reviewer ran v4 tests 20/20; record-baseline not run.
No operational read, config, environment, registry, process, mutex/event, launch,
SQL, credentials, repairs or retired checkout. M3 preserved; N1-N4, L1/L4 later
scope. Full C54 partial; native/H unverified. Next eligible (exact prompt in report,
not executed): verifier-only L11 guard successor, or Jordan accepts L11 as a
documented supplemental-guard limit.

## Observation classifier v4 fixture repair — October 25, 2026

Owner authorized the v3 review's bounded repair. New classifier-v4 and tests add
sample-level LAUNCH_NOT_EXCLUDED precedence and preserve its reason in the loop.
The v4.4 note corrects the v4.3 overstatement while retaining the sample availability
split. Earlier source, tests, notes and evidence preserved: 180 overlapping hash
bindings, 92 distinct prior paths, zero mismatches (historical mutable tracking
excluded explicitly). Fixture suite executed 20/20 pass, zero fail/skip. U7 reproduced:
v3 INVALID_CLOSURE_TIMING unknown -> v4 LAUNCH_NOT_EXCLUDED blocked. New verifier
uses lexical free-identifier allowlisting and ComputedPropertyName rejection;
28 negative AST/TAP self-checks pass. Static guard remains supplemental.

Report and exact next review prompt:
docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V4_REPAIR_2026-10-25.md.
Note: docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_4_NOTE_2026-10-25.md.
Evidence: tracking/evidence/theme-intent-observation-classifier-v4-2026-10-25/.
Author involved, independent review pending. Next eligible: separate uninvolved U02
review of those exact bytes; no next implementation authorized. No collector or
operational adapter, config/OS/credential read, launch or activation. M3 unchanged;
N1-N4 and L1/L4 later scope. Full C54 partial, native acceptance blocked, H unverified.

## Claude observation-classifier v3 / v4.3-note independent review — October 25, 2026

Separate-session Claude U02 review (did not author classifier v3, tests, repair
report, v4.3 note, verify.mjs, baseline probes, TAP or repair receipt; same model
family as the v2 review that wrote the implemented prompt; not blinded). Report:
docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V3_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-observation-classifier-v3-review-2026-10-25/reviewer-receipt.json.
Verdict: pass for the fixture repair scope with Lows. Fixture classifier supported
with Lows; v4.3 note supported with one Low; no operational collector exists; native
acceptance not ready/blocked. Resolved and independently reproduced: M4 (R1-R3 v2
pass -> v3 RESTART_AFTER_STOPPED_SAMPLE, persists through clean pairs and every early
exit; R4 shutdown control passes), L6 (uncertain window flag blocks before
contradiction/shape/cap/deadline), L8 (uniform query-start at_ms, closed_ms=now_ms
within original bounds; missing/invalid closure no longer passes), L7 checks as
specified. M1-M3/L2, planned Quit, key/admission, mapping, counts, binding, redaction
still hold. No false pass found. Low L9: uncertain sample-level launch flag still
downgraded to unknown by earlier rejections (new path via missing closed_ms) and
labelled LAUNCH_DURING_SAMPLING; a v4.3 sentence overstates. Low L10: AST guard still
bypassable without element access (computed destructuring, descriptor Function, Intl
clock); source clean. Checks: rehash 88/88 (154 overlapping bindings, 78 distinct
prior paths); verify.mjs check-only exit 0, receipt unchanged; reviewer ran v3 tests
18/18; 103 pure probe windows across v1-v3; guard probes. No operational read, config,
environment, registry, process, mutex/event, launch, SQL, credentials, repairs or
retired checkout. M3 decision preserved; N1-N4, L1/L4 later scope. Full C54 partial;
native/H unverified. Next eligible (exact prompt in report, not executed): pure
classifier v4 for L9 plus v4.4 note and allowlist verifier for L10, then separate
uninvolved review.

## Observation classifier v3 restart/timing repair verified in fixtures — October 25, 2026

Owner authorized the classifier-v2 review's bounded next step. New classifier-v3
and tests preserve v1/v2, their evidence, reader v2, proposal v4, notes v4.1/v4.2,
checklist v5 and M3. SH-01 now blocks any non-stopped result after any stopped
sample as RESTART_AFTER_STOPPED_SAMPLE; later clean pairs cannot pass. Explicit
launch keeps priority; object-level uncertain launch exclusion immediately blocks
before contradiction/shape/deadline checks. Uniform query-start at_ms plus separate
closed_ms=now_ms bounds closure within original15s/90s windows. No operational data.

Report/review prompt: docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V3_REPAIR_2026-10-25.md.
Additive note: docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_3_NOTE_2026-10-25.md.
New code/tests: scripts/theme-intent-observation-classifier-fixture-v3.mjs and
tests/theme-intent-observation-classifier-fixture-v3.test.mjs. Static whitelisted
field folding replaces computed property accesses for the stronger AST guard.
L7 verifier rejects all computed element access, Math/crypto/Reflect/Proxy and
import.meta; these remain supplemental guards, not an arbitrary-code purity proof.

Final Windows fixture suite18/18 groups passed, zero fail/skip. Retained initial
16/18 and second17/18: inherited pending-on-restart expectation and missing closed_ms
in one manual fixture, then a nonmatching text replacement; corrected tests only.
Core unchanged between attempts. Baseline pure probes reproduce R1-R3 v2 passes
and v3 incident blocks, R4 shutdown control passes both, N1 uncertain launch is now
blocked. Evidence/check-only receipt/verifier:
tracking/evidence/theme-intent-observation-classifier-v3-2026-10-25/.
154 prior hash bindings including overlap,78 distinct prior paths,zero mismatches;
16 negative AST/TAP guard self-checks passed. Formatting/whitespace passed; default
check-only preserves receipt bytes. No saved config/OS/credential/environment/
registry/process/object observation, launch, activation/recovery/retired checkout.

Next eligible: separate uninvolved exact classifier-v3/tests/v4.3 implementation
review using report prompt. No collector/operational adapter exists; reader N1-N4,
classifier L1/L4 and informational collector limits remain later scope. Active-home/
continuity/workspace/role/tool provenance/reviewed scope/operational-session grants
still pending. Full C54 partial; native/H unverified. Author involved, not independent.

## Claude observation-classifier v2 / v4.2-note independent review — October 25, 2026

Separate-session Claude U02 review (did not author classifier v2, tests, repair
report, v4.2 note, verify.mjs, baseline probes or repair receipt; same model family as
the review that wrote the implemented prompt; not blinded). Report:
docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V2_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-observation-classifier-v2-review-2026-10-25/reviewer-receipt.json.
Verdict: partial. Fixture classifier partial (M4 open); v4.2 note supported with
Lows; no operational collector exists; native acceptance not ready/blocked. Resolved
and independently reproduced: M1 launch precedence over every early return, M2
SH-01 planned-Quit preconditions, M3 contradiction invalidates either window with
launch priority, L2 OneDrive refusal matching home.rs check_home, L3 window
attestation/closure and show-event disclosure, L5 in substance. Medium M4: SH-01
passes after a restart (activity after a stopped sample, then a new pair); v1 had it
too. Low: L6 uncertain window exclusion reported unknown on contradiction/invalid
paths, L7 verifier AST guard bypasses (actual source clean), L8 mixed at_ms meaning.
L1/L4 carried. Checks: rehash 76/76 receipt-bound inputs match; new verify.mjs
check-only exit 0, receipt unchanged; reviewer ran fixture tests 15/15; pure probes;
guard probes. No Rust rerun, operational read, config, environment, registry,
process, mutex/event, launch, SQL, credentials, repairs or retired checkout. M3
decision preserved; N1-N4 out of scope. Full C54 partial; native/H unverified. Next
eligible: pure classifier v3 for M4/L6 plus v4.3 note for restart rule and L8 (exact
prompt in report). Not executed.

## Observation classifier v2 fixture repairs verified — October 25, 2026

Owner authorized bounded M1-M3 repair after Claude's partial review. New module/tests:
scripts/theme-intent-observation-classifier-fixture-v2.mjs and
tests/theme-intent-observation-classifier-fixture-v2.test.mjs. Explicit launch
pre-scans every supplied sample and window before any rejection; SH-01 requires
recorded running/planned Quit and exact quit_request_ms=start_ms; pg_ctl0 with
postgres_processes0 invalidates the whole window. OneDrive-prefixed components
refused. Window-level no-attempt and final handles-closed attestations required.
All inputs remain injected fixtures, not observed OS state or authority.

New report/review prompt: docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V2_REPAIR_2026-10-25.md.
New additive v4.2 note: docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2_NOTE_2026-10-25.md.
Covers planned shutdown, contradiction, final-handle completion timing and show-event
lifetime effect. Original15s/90s bounds unchanged; no collector exists. Frozen v1/
tests/report/v4.1/reader v2/proposal v4/checklist v5/M3/prior evidence unchanged.

Windows pure fixture suite15/15 groups passed first run, zero fail/skip. Separate
pure baseline probes reproduced all3 old defects and new corrected outcomes.
Evidence/TAP/probes/check-only receipt/verifier:
tracking/evidence/theme-intent-observation-classifier-v2-2026-10-25/.
84 prior frozen hash bindings matched, zero mismatches. Anchored exact TAP totals,
AST import/dependency guard and7 negative guard self-checks passed; guards are
supplemental, not proof of arbitrary JavaScript purity. Formatting/whitespace passed.
Check-only receipt bytes preserved. No config/credentials/OS observation/launch,
activation/recovery/retired checkout; full C54 partial, native/H unverified.

Next eligible: separate uninvolved exact classifier-v2/tests/v4.2 implementation
review using report prompt. L1/L4 remain future collector, reader N1-N4 future
adapter. Active home/continuity/workspace/current role/tool provenance, reviewed
scope and concrete operational/session grants remain pending. No next milestone
execution; author involved in implementation, not independent support.

## Claude observation-classifier / v4.1-note independent review — October 25, 2026

Separate-session Claude U02 review (did not author the classifier, tests, report,
v4.1 note, verify.mjs or implementation receipt; same model family as the review
that wrote the implemented prompt; not blinded). Report:
docs/THEME_INTENT_OBSERVATION_CLASSIFIER_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-observation-classifier-review-2026-10-25/reviewer-receipt.json.
Verdict: partial. Classification core partial; v4.1 note supported with Lows;
no operational collector exists; native acceptance not ready/blocked. Supported:
key admission and native join (vectors recomputed, match Rust-executed values),
open/Run mapping, strict counts/attestations, spacing/binding/stale/deadline/caps,
redaction, purity. No PR-01 false pass found. Medium: M1 launch incident downgraded
to unknown (unavailable/overrun/spacing/cap paths) or to prelaunch-activity block;
M2 SH-01 passes without recorded running state/planned Quit; M3 contradictory SH-01
sample (pg_ctl 0, zero postgres processes) then stopped pair passes. Low: L1 map
results unconnected to samples, L2 OneDrive-component homes admitted though native
refuses, L3 N6 note lacks post-final-sample attestation and show-event effect, L4
gates folded into one boolean, L5 weak verifier guards. N5 resolved. Checks: rehash
16/16 receipt-bound inputs match; new verify.mjs check-only (76 bindings, 0
mismatches); fixture tests 10/10 run by reviewer; pure probes; string-only key
recomputation. No Rust rerun, operational read, studio.json, registry, process,
mutex/event, launch, SQL, credentials, repairs or retired checkout. M3 decision
preserved; N1-N4 out of scope. Full C54 partial; native/H unverified. Next eligible:
pure classifier v2 for M1-M3 and L2 plus a v4.2 note (exact prompt in report). Not
executed.

## PR-01/SH-01 pure fixture classification core implemented — October 25, 2026

Owner explicitly authorized the review's bounded next step. New pure module:
scripts/theme-intent-observation-classifier-fixture.mjs; tests:
tests/theme-intent-observation-classifier-fixture.test.mjs. Implements attested
exact LOCALAPPDATA admission/join/key derivation, bound-key open result mapping,
type-agnostic Run existence, complete stopped-sample classification, PR-01 15s and
SH-01 90s two-sample rules, unavailable/incident handling and fixed-field redaction.
Inputs are injected fixture observations/attestations/times, not measured OS data.
No collector, OS/file/network/environment/clock calls or operational entry point.

Report + independent-review prompt: docs/THEME_INTENT_OBSERVATION_CLASSIFIER_2026-10-25.md.
New v4.1 note: docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_1_NOTE_2026-10-25.md.
N6 open-only handles can briefly suppress a concurrent launch; no launch attempt
during whole sampling window, uncertainty/attempt is incident. N5 actual trailing-
separator branch is exercised. N1-N4 reader-side changes remain in future adapter
scope. Frozen reader v2/tests/proposal v4/checklist v5/M3/prior receipts unchanged.

Windows pure tests10/10 groups passed first run, zero skips. Evidence/TAP and
new check-only verifier/receipt:
tracking/evidence/theme-intent-observation-classifier-2026-10-25/.
76 prior frozen hash bindings matched, zero mismatches; source-only pure-dependency
guard and changed-file formatting/whitespace checks passed. Check-only preserves
receipt bytes. No previous reader suite rerun because no reader behavior changed.
No saved config/credentials/OS observation/launch/activation/recovery/retired checkout.

Next eligible: separate uninvolved exact classifier/tests/v4.1-note implementation
review using report's prompt. No operational adapter/PR-01/SH-01 collector exists;
active-home/continuity/workspace/current role/tool provenance/reviewed scope and
operational/session grants remain pending. Full C54 partial, native/H unverified.
Author implemented these bytes and cannot give independent support.

## Claude reader-v2 / proposal-v4 independent review — October 25, 2026

Separate-session Claude U02 review (did not author reader v2, tests, repair report,
proposal v4 or the repair verifier/receipt; receipt records author involvement;
same model family as the v5 reviewer; not blinded). Report:
docs/THEME_INTENT_CONFIG_READER_V2_AND_PROPOSAL_V4_REVIEW_2026-10-25.md; receipt:
tracking/evidence/theme-intent-config-reader-v2-review-2026-10-25/reviewer-receipt.json.
Verdict: pass for the fixture-only repair milestone, Low findings only. F1 resolved
(Windows hard links refused; mutation probe shows nlink guards are operative and
layered). F2 resolved (both v4 vectors confirmed with actual Rust PathBuf::join on
Windows; forward-slash LOCALAPPDATA gives b552bb84, double trailing backslash
681853bc, both outside v4's admitted spelling). F3-F7 resolved as specified;
symlink/junction tags caught by the attribute query alone, other reparse tags
untested. Open Lows: N1 BOM accepted (v1 regression; serde_json rejects), N2
PowerShell stdin encoding unpinned, N3 SystemRoot-derived PowerShell path, N4 pg_bin
device names, N5 tautological key test/no join emulation, N6 open mutex handle can
make a concurrent launch exit as second instance. Checks: rehash 0 mismatches;
repair verify.mjs check-only (72 bindings, 0 mismatches, receipt unchanged); Windows
fixture tests 12/12; reviewer probes; serde_json 1.0.154 parity build. SystemRoot
probe inconclusive (Node aborts). No operational read, studio.json, registry,
process, mutex/event, launch, SQL, credentials or retired checkout. Adapter and
PR-01/SH-01 do not exist; native acceptance blocked. M3 preserved. Full C54 partial;
native/H unverified. Next eligible: fixture-only pure PR-01/SH-01 classification core
plus proposal v4.1 N6 note (exact prompt in report). Not executed.

## Config reader v2 and proposal v4 repairs verified in fixtures — October 24, 2026

Owner authorized assessment and eligible fixes after separate Claude v5 review.
New files preserve reader v1/tests/checklist v5/proposal v3 and prior receipts.
Report/review prompt: docs/THEME_INTENT_CONFIG_READER_V2_REPAIR_2026-10-24.md.
New code/tests: scripts/theme-intent-config-reader-fixture-v2.mjs and
tests/theme-intent-config-reader-fixture-v2.test.mjs. F1 fixed with nlink1 across
pre/open/post/final stats for config and marker; BigInt identity/time comparisons;
Windows ReparsePoint attribute query on fixture ancestry, fail closed. F4 strict
printable-ASCII pg_bin path components. F3 native-accepted hash provenance required;
not a complete serde-parity parser. F5 metadata guard tests added; hostile same-user
namespace race prevention and all-tag executed coverage not claimed.

Proposal v4 folds S1-S4 into body/table, binds exact attested LOCALAPPDATA spelling
for desktop key (unattested=unavailable), includes slash/backslash test vectors and
all named startup paths. Event vs mutex and open-only contracts preserved. No M3
change. Operational adapter/PR-01/SH-01 still absent; no saved configuration read.
Windows12/12 final fixture tests passed with actual hard links, junction and file/
marker symlinks. Initial8/11 (sandbox link EPERM + marker test typo), unrestricted
10/11, final12/12 retained in evidence. Only test marker typo repaired after first
attempt; no acceptance criterion weakened. New repair verifier passed72 prior
frozen hash bindings, zero mismatches; check-only default. Evidence:
tracking/evidence/theme-intent-config-reader-v2-2026-10-24/.
Formatting/whitespace checks passed. Full C54 partial, native/H unverified.
Next eligible: separate uninvolved exact reader-v2/tests/proposal-v4 review using
report's embedded prompt. Do not execute operational reads/OS observations, native
launch/session, activation, recovery or retired checkout access. Concrete adapter
scope/read grant, active home/continuity/workspace/current role/tool provenance
remain pending. Author involved in repair; no independent support claimed.

## Claude config-reader / v5 / proposal-v3 independent review — October 24, 2026

Separate-session Claude U02 review (did not write the reader, tests, v5, proposal v3
or M3 decision; Codex did; exact-v3/v4 reviews were other Claude threads; not
blinded). Report: docs/THEME_INTENT_CONFIG_READER_AND_PLAN_V5_REVIEW_2026-10-24.md;
receipt: tracking/evidence/theme-intent-config-reader-v5-review-2026-10-24/reviewer-receipt.json.
Verdict: partial, changes required. Reader projection/redaction/mismatch/size and
symlink guards supported; F1 (Medium) hard link to a file outside the fixture root
is read and labelled fixture:true (no nlink check). F2 (Medium) desktop mutex/event
key input string unbound (plan's forward-slash studio_home gives a different key
than PathBuf::join, so wrong-key "absent" = false stopped). S1/S3/S4 supported;
S2 event-vs-mutex correct; L-A/L-D/L-F/L-G resolved; M3 preserved. Lows F3-F7:
native-parse divergence, pg_bin charset, untested change guards, proposal v3 body
contradicts S1-S4 addendum, launch-path list incomplete. Checks: v5 verify.mjs
check-only (36 inputs, 0 mismatches, receipt unchanged; no --record); reader tests
6/6 on exact copied bytes in scratch on Linux (junction case is a symlink there);
16 disposable reviewer probes. No operational read, studio.json, registry/process/
mutex, launch, SQL, credentials or retired checkout. Operational adapter and
PR-01/SH-01 do not exist; native acceptance not executed. Full C54 partial.
Next eligible: new-file reader v2 (nlink/reparse/pg_bin fixes + tests on Windows)
and proposal v4 (fold S1-S4, bind exact key input) with check-only receipt, then a
separate uninvolved review. No operational execution.

## V4 findings repaired; field-limited fixture reader prepared — October 24, 2026

Owner authorized assessment/fixes and selected “Prepare a field-limited reader
for separate review”; no operational config read granted. Report/scope:
docs/THEME_INTENT_CONFIG_READER_PREPARATION_2026-10-24.md. New checklist v5 and
observation proposal v3 incorporate S1-S4/L-A..L-G while preserving frozen history.
Actual source correction: desktop Show object is an event (OpenEventW), not mutex;
no object observation implemented. Active-home attestation names CREATOR_STUDIO_HOME
and LOCALAPPDATA; reviewed manifest is allowlist source; registry semantics explicit.
A0 historical assertion is not refreshed by PR-01; no closing either window.

scripts/theme-intent-config-reader-fixture.mjs is a fixture-only library, direct CLI
refuses. Projects mode/port/pg_bin/hash-equality only; mismatch has no fields;
redacted errors, bounded bytes and observed ancestry/file-change guards. No live
adapter or PR-01/SH-01 inspector exists. Workspace/role/continuity/tool identity
and concrete operational grant remain pending. Same-user hostile namespace races
not claimed protected; operational adapter needs separate exact review/scope.

Tests: initial sandbox5/6, junction setup EPERM; authorized isolated Windows rerun
and final run6/6 including junction refusal. TAP at tracking/evidence/theme-intent-config-reader-2026-10-24/tests-final.tap.
V5 receipt/check-only verifier at tracking/evidence/theme-intent-acceptance-plan-v5-2026-10-24/;
36 direct v4-review inputs preserved, zero mismatches; excluded mutable tracking
paths and recorded pre-update hashes listed. Earlier v4 verifier separately checks
807 bindings. New source/docs formatted; whitespace checks passed. No operational
read/credentials/launch/activation/recovery/retired checkout. Full C54 partial.
Next eligible: separate uninvolved exact reader/tests/v5/proposal-v3 review using
embedded preparation-report prompt; no further document-only review required as a
separate step from that combined implementation review. Then separately scope an
operational adapter; no execution now. Author involved, not independent support.

## Claude exact-v4/proposal-v2 independent review — October 24, 2026

Separate-session Claude review (did not prepare v4, proposal v2 or the M3 decision;
another Claude thread wrote the exact-v3 review; not blinded). Report:
docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V4_REVIEW_2026-10-24.md; receipt:
tracking/evidence/theme-intent-acceptance-v4-review-2026-10-24/reviewer-receipt.json.
Verdict: planned observations supported (design); M3 exact-bundle configuration
decision faithfully implemented (studio.mjs 9d5ddac3 scheduler fixed off, worker on;
fresh installed match pending); PR-01/SH-01 contract partial; no inspector exists;
operational/native execution not executable. Findings: M-A active home can be
overridden by CREATOR_STUDIO_HOME (main.rs:155-164), name it in the attestation;
lows L-A..L-G (desktop Local\CreatorAgentStudio-<key16> mutex omitted, open-only
mutex and type-agnostic Run-value checks, allowlist source = bundle manifest
5b38b43e, window-close instruction, receipt exclusion list, v4 line 208).
Port/pg_bin pending; reliable values need Jordan's own reading of studio.json or a
separately selected field-limited reader scope. Checks: 636/636 v4 inputs rehashed;
v4 verify.mjs run check-only (807 bindings, 0 mismatches), receipt unchanged; no
--record, no older verifier. No launch, SQL, credentials, studio.json, registry/
process/port/mutex inspection, activation or retired checkout access. Full C54
partial. Next eligible: Jordan supplies nonsecret scope values (or selects a
field-limited reader scope); then bounded fixture-only PR-01/SH-01 inspector folding
S1-S4; then separate uninvolved implementation review. No operational execution.

## Exact-v4 independent review packet ready — October 24, 2026

Owner requested next step. Current author prepared v4/proposal v2 and cannot supply
independent support. Prepared self-contained fresh-Claude review prompt:
docs/THEME_INTENT_ACCEPTANCE_V4_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md.
No reviewer dispatched or independent review completed in this turn. V4 check-only
verification passed 807 prior bindings, zero mismatches, without changing receipts.
Packet carries accepted M3 decision and asks distinct design/implementation/scope
verdicts; no repeated M3 owner choice. Operational bindings/continuity/workspace/
current role and concrete session scope remain pending. No operational read,
launch, implementation, activation or retired checkout access. Full C54 partial.
Next eligible: run the prepared prompt in a separate uninvolved Claude session;
bring back its exact report/receipt before repairs or inspector implementation.

## Claude v3 findings reconciled; v4/proposal v2 prepared — October 24, 2026

Owner authorized assessment/eligible fixes and explicitly selected exact-bundle
configuration evidence for this narrow UI-only session. Decision:
docs/THEME_INTENT_ACCEPTANCE_SCHEDULING_DECISION_2026-10-24.md
(THEME-ACCEPTANCE-M3-2026-10-24). Not live observation, continuous prevention or
zero dispatch; worker remains on. No inspection/launch/session authority follows.

Prepared docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V4_2026-10-24.md and
THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V2_2026-10-24.md. Folded historical
installation reconciliation into body; explicit running-only planned Quit,
accidental-close/startup incident, versioned v2-v4 leases and V3/V4 mutex bounds,
launch-at-login single-value presence read and separately scoped later SH-01
re-observation. Binding sources named with no config/credential-read fallback.
M4 nuance: installation-plan.json does name intended studio_home; current active
home still needs confirmation. Database port/pg_bin/tool identity remain pending.
L4 nuance: control close hides while running, Quits otherwise; studio close follows
saved preference. No source/runtime/helper/package changes or operational reads.

Evidence: tracking/evidence/theme-intent-acceptance-plan-v4-2026-10-24/.
Check-only verifier defaults to no writes; --record uses exclusive creation.
807 prior hash bindings passed, zero mismatches; mutable pre-update tracking hashes
explicitly excluded. New Markdown formatted, all NI identifiers/stale wording
checked. Frozen v2/v3/proposals/reviews preserved. No inspector implemented or run;
full C54 partial, R/N/H unverified. Author involved in revisions, not independent.
Next eligible: separate uninvolved exact-v4/proposal-v2/decision review; concrete
port/tool/active-home bindings and workspace/current role/continuity/session scope
remain necessary before operational execution. No automatic milestone advance.

## Exact checklist v3 and observation proposal independently reviewed; execution blocked — October 24, 2026

Separate Claude project-thread review (did not prepare v3, the proposal, v2, the
exact-v2 review, helper or package; other Claude threads wrote the v1 review and
helper reviews; not blinded). Verdict: partial support, blocked for execution.
Report: docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V3_REVIEW_2026-10-24.md.
Receipt: tracking/evidence/theme-intent-acceptance-v3-review-2026-10-24/reviewer-receipt.json.
Rehashed 204 v3, 200 v2-review, 183 readiness, 145 helper, 32 v4-artifact,
424 package-artifact and 265 candidate-source bindings: 0 mismatches. v3 verify.mjs
not run (it rewrites its receipt). M2 correction supported: NI-04/final Quit record
stopping/exit honestly and require SH-01. Not executable: v3, PR-01/SH-01 inspector
contract, native session. B1: M1 retained; no reviewed authorized prelaunch path.
M3: the rule cannot be met by prelaunch observation. The reviewed bundle studio.mjs
9d5ddac3 fixes the scheduler off for those bytes; whether that suffices is Jordan's
decision, otherwise a startup-admission candidate is needed. Worker stays on either
way. M4: no reviewed source for home/port/pg_ctl/lease bindings (studio.json barred).
M5: launch-at-login Run value outside PR-01/R. L1–L6 minor. No operational access,
launch, credentials, helpers, writes, activation or retired checkout. Full C54
partial. Next eligible: Jordan's M1 standard decision, then checklist v4/proposal v2
resolving M4, M5 and L1–L6, then a separate exact review. No inspection or session.

## Checklist v3 and bounded observation proposal prepared — October 24, 2026

User authorized the next planning step after exact-v2 review. Full derived v3:
docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V3_2026-10-24.md. Companion contract:
docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_2026-10-24.md.
NI-04/final Quit now require separately scoped SH-01 shutdown observations;
visible stopping/exit does not establish shutdown. Historical installation and
schema29 prerequisites reconciled without repeating preparation/install.
PR-01 proposes exact-path identity/continuity/stopped-host reads; SH-01 proposes
bounded post-Quit polling. Neither is implemented/reviewed/operationally executed.
Source-derived scheduler default remains configuration evidence only. Unknown
live scheduling still blocks acceptance; candidate-changing startup admission is
an unaccepted design option, not an activated mode or granted implementation.

Evidence: tracking/evidence/theme-intent-acceptance-plan-v3-2026-10-24/revision-receipt.json
and verify.mjs. Verified all 200 prior exact-review input hashes unchanged, frozen
v2 hash, all NI identifiers and removal of NI-04's stopped-control expectation.
Changed planning Markdown formatted; no runtime tests needed for documentation.
Author now prepared v3/proposal and cannot independently support them. Existing
workspace/current owner-editor, continuity and separate bounded session decisions
remain pending. No operational/credential access, launch, helper, writes to saved
studio, activation, recovery, cleanup or retired checkout access. Full C54 partial.
Next eligible: separate uninvolved exact-v3/proposal review using its embedded
review prompt. No operational inspection or native acceptance execution yet.

## Exact checklist v2 independently reviewed; execution blocked — October 24, 2026

User-requested separate review completed with no prior implementation involvement
in the available conversation. Verdict: partial checklist support, blocked for
execution. Report: docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_REVIEW_2026-10-24.md.
Receipt/verifier: tracking/evidence/theme-intent-acceptance-v2-review-2026-10-24/.
Repository-only verifier passed 365 hash bindings, zero mismatches; 145 helper
bindings, 16 run-01 receipts, 114 preserved business hashes, schema29 and ordered
migration/observation. Historical receipts only; no fresh operational observation.
Actual installation supersedes frozen v2 pending helper/install prerequisites.

M1: live scheduling and continuity still block launch; source off-default and
cleared child environment do not establish live observation. M2: NI-04 expects a
visible stopped control state, but Quit sets stopping then exits, including after
a logged cluster-stop error. Closure cannot prove shutdown; prepare a versioned
correction and separately scoped reviewed shutdown observation before relaunch.
All NI cases not-run. Existing workspace/current owner-editor and bounded session
decision remain pending. A v1–2/B v1 retain by default; R separate; H Jordan only.
No launch/sign-in, operational/credential access, helper execution, acceptance
writes, activation, recovery, cleanup or retired checkout access. Frozen artifacts
preserved. Full C54 partial. Next eligible: versioned M2 correction and bounded
prelaunch scheduling/continuity inspection/control proposal, then independent
review; no native session execution or automatic next milestone.

## Native acceptance readiness assessed; session remains blocked — October 24, 2026

Bounded repository-only reconciliation completed. No newer independent exact-v2
checklist review found in docs/tracking filename inventory and text search; original
review covers v1, revision is not independent, and supported v4 review covers helper
bytes only. No reviewer dispatched. Frozen checklist/helper/package/history preserved.
Actual schema29 installation and pre-UI receipts supersede v2's pending helper,
backup/install/migrate prerequisites; no repeat preparation/install is indicated.
Repository evidence check: 182 hash bindings, zero mismatches; 145 exact helper
bindings; 16 run-01 JSON receipts read; all114 business hashes preserved; migration
precedes observation. These are historical receipts, not fresh operational checks.

Readiness and proposed session scope:
docs/THEME_INTENT_ACCEPTANCE_READINESS_2026-10-24.md.
Evidence/reproducible repository-only check:
tracking/evidence/theme-intent-acceptance-readiness-2026-10-24/assessment-receipt.json
and assess.mjs. Native acceptance remains blocked by independent exact-v2 review,
unknown live scheduling state, named existing workspace/current owner-editor role,
continuity through first launch and a separate bounded session authorization.
Source defaults do not prove live scheduler state; worker starts on launch. UI-only
scope cannot establish raw hashes, post-UI database equality or exhaustive zero
dispatch. A v1–2/B v1 synthetic scope retains records by default; registry/shortcuts
need separate read-only scope; /NS skips creation; Jordan H remains separate.

No operational/credential access, launch/sign-in, acceptance writes, helper execution,
provider/workflow activation, recovery/stale release, cleanup or retired checkout
access. R/N/H remain unverified; full C54 partial. Next eligible: use
docs/THEME_INTENT_ACCEPTANCE_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md in a separate
review session. Resolve scheduling/continuity gates before requesting native session
execution. No automatic next milestone or authority granted by this assessment.

## Exact theme-intent installed and schema29 preserved before UI — October 24, 2026

Owner authorized next step after operational before completion. New exact /4 owner
install decision binds frozen candidate7100a039...8bc /plan27f79525...7a1, prepared
5bb69e60...ddf0d2 and reviewed145runtime map. Fresh admission passed with unchanged
schema28/predecessor/state/backups. Real NSIS3af2712c...6d834b ran /S /NS, exit0,
no timeout, completed2026-10-24T12:34:45.802Z (08:34:45EDT). Exact candidate migrate
applied[29] from28to29 and created its own verified schema28 migration snapshot.
Reviewed after passed before any desktop/UI launch: schema29 observed
2026-10-24T12:34:49.022Z; all114business table hashes, prior migrations, protected
files/config/products preserved. Parent rechecked full receipt/admission/installer/
migration chain and migration dump hash; exact installed native510b09...88ca9,
manifest5b38b4...eba6 and71runtime resources verified.
Operational cluster stopped normally. Host check pg_ctl status3, no configured-port
listener, no lease, desktop or runtime worker. No provider calls/workflow activation,
UI/acceptance writes, recovery or retired checkout access. Code/packages/reviews
unchanged; CurrentUser DPAPI used by reviewed wrapper only, no secret bytes logged.
Evidence: tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json
and shutdown-check.json; original session receipts and new owner-install-approval
under tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Prior before completion remains immutable history; installed state now supersedes28.
Keep schema28 snapshot and matching program together at private before backup;
coordinated rollback needs separate decision, never old binaries alone over29.
Real installation I is verified. Registry/shortcuts R, native UI N and Jordan human
acceptance H remain unverified. /NS skips shortcut creation. No operational restore
rehearsal claimed. Acceptance checklist v2 review/session scope still separate;
keep desktop quit until gates resolve. Next eligible: independent exact-checklist-v2
review alongside supported v4 helper, then scoped native acceptance decision.
No automatic acceptance/next milestone. FullC54 remains partial.

## Operational v4 before preparation completed — October 24, 2026

Owner authorized next step after exact-v4 independent support. Supported /4 review
validated with all145 runtime bindings; frozen package preflight passed. New session
operational-before-v4-20261024-01, evidence
tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Reviewed PS/CLI before exited0, fixture:false, provider_calls0. Actual managed
postgres/data schema28 observed;28migration rows and114table hashes. Dedicated
snapshot plus post-backup preserved-state checks/quiescence passed. Private backup:
C:/Users/jorda/AppData/Local/com.creatoragent.studio/backups/theme-intent-v4-operational-before-v4-20261024-01.
Database dump553996bytes; matching predecessor program78files, protected4files,
configured products tree0files. Helper verified dump list/hash and copy maps; parent
rehashed all copies/dump and prepared/before/backup receipt links. CurrentUser DPAPI
used only inside reviewed wrapper; no credential bytes logged/tracked. No restore
rehearsal performed on operational snapshot; dump-list/hash verification is distinct.
Prepared_at2026-10-24T12:31:01.322Z; prepared SHA256
5bb69e60eaae96a503368ef2bd9f7e61c9f40546825b893de4e1d44492ddf0d2.
Earliest backup/prepared15minute age deadline2026-10-24T12:46:00.939Z
(08:46:00.939 America/New_York). Admission must recheck freshness/unchanged state
and a NEW exact owner installation decision; age deadline is not admission approval.
Host final check:pg_ctl status3, no configured-port listener, no theme-intent lease.
Operational database and installed predecessor remain schema28; no install, migrate,
admit, recovery, stale release, provider/workflow activation or retired-path access.
Completion receipt and shutdown/owner provenance retained; prior failed v3 attempt
unchanged. Helper/plan/packages/reviews untouched. Native NSIS/registry/shortcuts/UI
and human acceptance remain unverified; acceptance checklist v2 review separate.
Next eligible: new exact installation/migration owner decision, fresh admission and
only then authorized install/migrate/after before any UI launch. If stale or state
changed, new before session/directories required. No automatic next milestone.
FullC54 remains partial.

## Bounded disk cleanup — October 24, 2026

Owner-authorized cleanup only; no milestone advanced. Removed 36.34 GiB of file
bytes (C: free 12.35 GB to 50.00 GB right after; the concurrent v4 review run then
grew): superseded TEST_ONLY v2 (7) and v3 (2) helper fixture roots, three finished
v2/v3 reviewer probe roots, and cargo intermediates target/{debug,release}/
{deps,build,.fingerprint} plus debug/incremental. Explicit list, lstat walk,
containment and top-level reparse refusal; each root's alias-home junction was
unlinked, not traversed; no process referenced any target. Preserved all v4 roots
(review run on 55455 active), frozen candidate/predecessor artifacts (setup.exe
hashes re-verified against the installation plan), rollback copies, approved
installers, target final exe/pdb/bundle/nsis/studio, .creator, tracking/evidence and
uncommitted work. Historical v2/v3 record-repair.mjs can no longer re-run (newest
fixture root gone); receipts and their tracked artifact hashes are unaffected.
Remaining: .verification about 18 GiB (includes the live v4 review run), target
0.29 GiB. Manifest: tracking/evidence/disk-cleanup-2026-10-24/MANIFEST.md,
cleanup.mjs and dry-run/execute results. Next desktop build recompiles from scratch.
Next eligible task is unchanged: the in-progress independent exact-v4 helper review.

## Development artifact retention mechanism — October 24, 2026

Owner authorized bounded retention for synthetic development test artifacts.
New scripts/dev-artifact-retention.mjs: opt-in createOwnedRun() writes a
.creator-dev-run.json marker (owner, host/pid, active/passed/failed, heartbeat,
optional protection) before anything else; cleanup CLI is dry-run unless --apply.
Only direct children with a valid marker naming that exact directory are
candidates. Kept: unmarked/foreign/copied-marker dirs, links/junctions, live or
recent active runs, protected runs, runs named in tracking/ or docs/, the latest
passed (1) and failed (2) per prefix, passed <24h and failed <14d. Abandoned
active runs follow failure retention. Root safety refuses drive/home/temp/checkout
roots, link roots and APPDATA/LOCALAPPDATA/PROGRAMDATA/Program Files. Apply holds
an exclusive lock, re-validates, renames to a tombstone, re-validates and refuses
any run containing a link. Checks: node --test tests/dev-artifact-retention.test.mjs
8/8 pass (disposable temp roots); real .verification dry run: 94 entries, 0
candidates (61 unmarked dirs, 33 files). Frozen v2/v3/v4 tests and runners were not
edited, so their existing and future directories stay unmarked and untouched;
nothing was deleted. Usage: docs/DEV_ARTIFACT_RETENTION.md. No product milestone,
operational data, credentials or installed app touched.

## Installed acceptance checklist v2 revised; execution remains blocked — October 24, 2026

Owner authorized document-only revision following Claude's blocked checklist review.
New docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md preserves the original
plan and review. Incorporates A0–A13: exact candidate/plan/proposed-v4 map and review
binding; successful after/cluster-stop evidence before first launch with actual
v4 at/state.observed_at fields and operator timeline; control-window GUI-migration
stop; native sign-in/Quit; workspace/role/mutation scope; two-draft visible ledger;
clean-save version/activity check; pending-target semantics; retention by default.
UI-only observation chosen. Raw content hashes, whole-database equality after UI
activity and exhaustive zero dispatch are explicitly unverified. Plan declarations
are wiring, not measured dispatch. Worker startup/bookkeeping are explicit; no
worker-off control or live scheduler-off UI invented. Unknown runtime scheduling
blocks execution; stronger prevention/accounting proof needs a separate reviewed
inspection/control task. Real install, registry/shortcuts, native UI and Jordan's
human acceptance have separate I/R/N/H classes; historical fixtures are F.
All cases not-run. No operational data/credentials, helper, installer, app, provider,
workflow or retired path accessed/run. Only documentation/tracking/new planning
evidence changed. Original plan/report/receipt hashes preserved; all168 v4 repair
artifacts unchanged. Markdown formatting and case coverage checks pass. Evidence:
tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json.
Next: independent exact-v2 checklist review alongside resulting reviewed helper
identity. V4 helper review remains a separate gate; operational preparation, install/
migration and native acceptance still require their recorded gates and authority.
No automatic next milestone. No fresh operational backup from failed v3 attempt;
fullC54 remains partial.

## Native-layout helper v4 locally verified; independent review next — October 24, 2026

Owner authorized the next repair after operational v3 before failed. V4 preserves
v3 and frozen package/plan. Shared PGDATA is desktop-native postgres/data in normal
managed control, postmaster ownership inspection, stale data_dir binding/release
and coordinated recovery. Nested directory/no-links/PG_VERSION18 checks now precede
DPAPI. No flat fallback or data relocation. Versioned /4 authority/review/lease
contracts require a fresh exact independent review; v3 support does not cover v4.
Verified source-bound run:26/26 TAP tests (25scenarios+parent), guards11/11,0skip,
source maps unchanged. Independent fixture initdb uses nested layout; source-contract
guard reproduces v3 failure. Real wrapper rejects missing nested PGDATA while
synthetic DPAPI is unavailable. Before/death/stale-release, forward29 preservation
and coordinated28 recovery pass. Static package/PS parse/format/syntax pass.
First full run retained: two scenarios failed (23pass/3fail including parent):
missing synthetic studio.json setup, corrected in test only; transient EPERM on
fixture program rename during interrupted recovery. Exact-directory rename/back
subsequently succeeded, and unchanged runtime passed complete rerun. EPERM cause
unconfirmed, no production retry/gate relaxation; retain for independent review.
V2's162 and v3's161 artifact hashes unchanged. Disposable55455 summary stopped.
No operational configuration/credentials/database accessed in this repair; no NSIS,
providers/workflows, installed app changes or retired checkout access. Failed
v3 operational before still produced no fresh backup; installed schema28 remains
last verified status, not re-queried. FullC54partial. V3 low findings deferred.
See docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md and
tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/repair-receipt.json,
verified-{guards,e2e}-run.json/TAP and retained first-run failure evidence.
Next U02: fresh independent exact-v4 review of layout/pre-secret/stale/recovery
and failure evidence. Operational retry remains blocked until review support;
new session/directories/current authority required. No automatic next milestone,
installation/migration, recovery or release authority follows.

## Operational before blocked by native-layout mismatch — October 24, 2026

Owner authorized operational before preparation only. Exact frozen package preflight
and independent /3 review passed (145 runtime bindings). Actual reviewed v3 attempt
operational-before-20261024-01 exited 1: managed() reads postgres/PG_VERSION, while
desktop Home::pg_data (apps/desktop/src-tauri/src/home.rs:121) uses postgres/data.
Read-only inspection confirmed postgres/data/PG_VERSION=18; operational schema was
not queried. Wrapper decrypted CurrentUser DPAPI before this failure; no credential
bytes logged. No database start, snapshot, private backup, prepared receipt, install,
migration, providers or workflows. Empty run-01 evidence directory retained; lease
removed normally. Original reviewed v3 bytes and all historical evidence preserved.
The synthetic fixture layout mirrored the same wrong assumption, so prior passing
tests/review do not establish native layout compatibility. Operational preparation
is blocked despite historical supported review. See
tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json
and owner-before-authorization.json.
Next eligible U03: bounded versioned native-layout repair, actual-desktop-layout
fixture coverage (including stale/recovery paths), then fresh independent exact
review before a new operational before attempt. No install/migration authorization.
No complete fresh backup exists from this attempt; full C54 remains partial.

## Upgrade-helper v3 stale-state repair locally verified — October 23, 2026

V2 independent review is partial: interrupted before had no cleanup route and
post-migration death forced rollback. Separate v3 fixes both while preserving v1/v2
bytes/evidence. New cleanup-only release requires current review, exact dead PID,
lease hash/token, home/data/evidence/config/session and owner scope; needs no prepared
backup, SQL or credentials. Matching transient PG token is required before a stop.
Per-studio OS guard survives parent death safely, complete leases publish atomically,
and after/reconcile can clean stale state then verify schema29 forward without
repeating effects. Inner confirmation gates added; /NS shortcut claim corrected.
Source-bound full run25/25 (24scenarios+parent), guards8/8,0skip. Actual early/partial
before deaths, missing-DPAPI cleanup, wrong-hash/foreign/live-owner denial and two
forward-verification deaths pass, alongside inherited regressions. Runtime/test
hashes unchanged during runs; TAP digests bound. PS parse/format/static package pass.
V2's162 artifacts unchanged; test listener55454 stopped. No operational config,
credentials/DB, NSIS, providers, workflows or retired checkout access. FullC54 partial.
Package/plan stay7100a039...8bc /27f79525...7a1. Native NSIS/shell/UI and large-scale
timing remain unverified; owner must keep desktop/workers quit outside helper mutex.
See docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md and v3 repair receipt.
Next U02: independent exact-v3 review. No operational preparation or installation
authority follows from local checks; fresh owner decisions remain separate.

## Upgrade-helper v2 repairs locally verified; independent review pending — October 23, 2026

Claude's exact-v1 review blocked operational preparation (H1/H2/M1–M5); preserve
that verdict and all v1 bytes/receipts. Separate v2 helpers implement owned managed
PG lifecycle, review before DPAPI including before, private backup/hash-evidence
separation, dedicated snapshot/client, admission-only freshness, absolute installer
resolution, bound action provenance, global locks, reconciliation and coordinated
schema28 restore. Recovery refuses later/unknown work and requires a separate exact
decision; it restores into a new database, retains failed state and restores matching
program/products/protected files with explicit config relocation.
Final20 end-to-end scenarios+parent21/21,0skip; guard tests5/5,0skip. Real PowerShell5,
synthetic DPAPI/SCRAM PG18 and exact candidate migrate; installers are fixture copies.
Crash/death, interrupted protected restore, aged after, concurrency, populated
requests/grants/access/qualifications/settings preservation and negative gates pass.
Static package preflight, PS parsing/format pass. Prior16 artifact hashes intact;
test listener55452 stopped. No operational config/credential/DB, NSIS, provider,
workflow, install/migration/recovery action. FullC54 partial. Exact package/plan stay
7100a039...8bc /27f79525...7a1. Native NSIS/shell and UI acceptance remain unverified.
See docs/THEME_INTENT_UPGRADE_HELPER_V2_2026-10-23.md and new repair receipt.
Next U02: fresh exact-v2 independent review, then separately authorized fresh
operational preparation and new exact installation/migration decision. No auto install.

## Schema29-aware upgrade helper prepared — October 23, 2026

Implemented backup/admission/install/migrate/after helpers pinned to candidate
7100a039...8bc and plan27f79525...7a1. Static package/review/resource preflight,
PowerShell parsing and JS formatting pass. Isolated expanded tests10/10 pass,
0skip: full28→29 table-fingerprint preservation/checksum rejection plus synthetic
dump/restore and negative approval/quiescence/copy gates. Initial connectivity and
shutdown-orchestration failures retained separately. Both test listeners stopped.
No operational config/credentials/DB access, installation, provider or workflow.
Self-reviewed only; independent exact-helper U02 review remains required and is
enforced before admission, followed by fresh backups/readiness and new exact owner
installation/migration approval. No approval file created. Existing installed
schema28 is last verified status, not re-inspected here. FullC54 partial.
New backup format is explicitly theme-intent-upgrade-backup/1 (custom PostgreSQL
snapshot plus product/protected/program copies), not current schema29 portable
Restore Studio format. Full coordinated studio/DPAPI recovery not rehearsed.
See docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md and exact helper evidence.
Next eligible: U02 independent helper review; no automatic install/next milestone.

## Theme-intent desktop package/declarative plan supported — October 23, 2026

Candidate7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc;
installationplan27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1.
LockedofflineMSVC/Tauri NSIS build/staging complete:71runtime resources,265source
bindings. Installer3af271...d834b,packagednative510b09...88ca9 (distinct loosebinary),
manifest5b38b4...eba6 archived under .verification/theme-intent-artifacts-2026-10-23/.
All71extracted/staged/archive resources match. Supported stagedservice isolated
backup-first28->29 tests2/2pass;all28prior migration SQL unchanged,11role/admission
parity references match. Norestore/installedacceptance claim. Separatepackage review
supported/no materialfinding;parent verified424review artifact hashes. Oldinstaller/
archive and installed67resource predecessor unchanged before/afterbuild. No provider,
operationalDB/credential/settings access or install;testcluster stopped. C54partial.
See docs/THEME_INTENT_PACKAGE_2026-10-23.md and matching independentreview/evidence.
Installation remains prospective:NEWschema29-aware executable backup/install/
preservation helper+affectedreview required BEFORE newownerapproval. Freshoperational
quiescence/backup/rollback/preservation hashes stillrequired;nonewbackup claimed.
Rollbackafter29 must restore28snapshot+matchingprogram together,not oldbinaryalone.
Nexteligible:implement/reviewthathelper andstaticpreflight,thenfreshbackup/readiness
and exactownerinstallation/migration decision. Noautomatic install or activation.

## Theme-intent guard repaired and separately supported — October 23, 2026

TI-01closed on exact UI source4909dbf8...08de:ordinaryNew/Resume/Reload always guard
dirty input;only explicitDiscard passestrue. Failed-load preservation/re-guarding
retained; successfulsave clearsobsoletependingprompt. NoAPI/domain/schema change.
Valid before-regression2fail/1pass;after3pass0skip;8fixturebrowser checks pass with
APIintercepted,0mutations/DB/provider calls. Project/webtypes+formatpass. Separate
review independently reran3actual-handler tests,inspectedbuttonwiring,verified12repair
hashes+25unchangedoriginalbindings and reconstructedoldsource byreversing4edits.
Parent verified17reviewartifact hashes. TI-02format corrected in supplemental
versioned receipt;original malformedreceipt/partialreview/failureevidence preserved.
Verificationwebserver stopped;installedapp/studio unchanged,migration29stilltest-only.
No package/install/sourcecollection/pilot;fullC54partial. See docs/THEME_INTENT_REPAIR_2026-10-23.md
and docs/THEME_INTENT_REPAIR_REVIEW_2026-10-23.md with exactrepair/review evidence.
Next eligible: bounded exact candidate/package/install PREPARATION. Noautomatic
installation/activation;compare source/role/migration bindings and preserve rollback.

## Theme-intent independent review partial: input-loss repair required — October 23, 2026

U02 separate model review found TI-01(P2):open() guards dirty input only when
pending===null; after prompt appears,a second ordinary New/Resume/Reload skips
confirmation and overwrites edits. Reviewer actual-handler probe and parent actual
retained-browser reproduction independently confirm; prior10browser checks missed
that sequence. Packaging/install preparation not supported until U03repair/review.
API/domain zero-dispatch/version/workspace paths otherwise supported by inspection;
26implementation hashes and5frozenlegacycontract artifacts checked. One freshpure
domain test passed; priorHTTP/PG/browser evidence inspected,not freshly rerun.
Parent verified41reviewreceipt artifact hashes. TI-02minor:original implementation
receipt format='passed';preserve it and issue supplemental versioned metadata later.
No production/API/DB/provider/build/install changes. Model review/not humanacceptance;
C54partial. See docs/THEME_INTENT_REVIEW_2026-10-23.md and exactreview evidence.
NextU03:separate ordinary guarded-open from explicit confirmed discard;regress
repeatedNew/alternateResume/Reload while prompt open and failed-load preservation,
then review exact changed candidate. No packaging or activation yet.

## Durable theme-intent draft/preparation slice implemented — October 23, 2026

New theme-intent/1 contracts+theme_intent record,migration29,deterministic domain
research-plan preparation and active-record GET endpoint;reuses versioned entity
API/store. Submit saves theme-only/resumes after reload without claims,connection
or budget;optional context/solution constraints/questions/public URLs editable.
Expected-version conflicts and failed saves retain input;explicit reload/discard,
create idempotency and workspace/session isolation retained. Plan binds saved
version/hash,zero requests/fetches/spend,not_authorized;no grants/claims/run dispatch.
Existing brief/discovery/study contracts unchanged. Project/web types+formatpass;
28relevant tests0skip plus final2theme-only HTTP/restart/rebinding checks pass.
10browser checks against separate real API/PG inclinjected503/conflict/mobile pass.
TestSQL0claims/runs/grants/workflows/providerrequests. Testservices stopped/data
retained. Migration29 onlytestDB; installedapp/studio unchanged. No providers/source
fetches/productbuild/install/pilot. See docs/THEME_INTENT_IMPLEMENTATION_2026-10-23.md.
NextU02:exactchange review before candidate/package/install preparation. Collection
to claims,citedcomparison and fullin-app lifecycle remain later;C54partial.

## C54 readiness/gap audit completed — October 23, 2026

Read-only source/evidence audit plus4offline contract probes,36sourcebindings;
no network/provider/credentials/DB/build/install/workflow changes. Operationalroles
3/3+substantive modelreviews remain narrow. Existing subscription worker/admission,
source broker and artifact APIs present; not complete live/UI acceptance. Missing:
durable theme-only draft/no-claims intake,source collection-to-claims,complete
parent/pilot effective setup,subscription search integration/qualification,and
in-app spec/build/package/revision actions (CLI instructions remain). OldOct20
workflow receipt8/14sourcebindings current:historical tests not promoted. Dated
readiness config missing-role text superseded narrowly;frozen config unchanged.
See docs/C54_READINESS_AUDIT_2026-10-23.md and audit.json. FullC54partial.
Next eligible: bounded durable theme-intent draft+research-plan preparation through
contracts/domain/API/UI;save/resume without connection,budget,claims or dispatch.
Preserve existing evidence-first/study contracts;no source/provider activation or
install in that slice. Collection/citedcomparison then lifecycle and ownerwalkthrough
remain later gates. No approval requested for unimplemented live work.

## Six exact research outputs substantively supported — October 23, 2026

Separate U02 model review supports all6outputs/18frozen criteria; no material output
repair. Low packet issue R14-PACKET-01: event sufficiency rationale denies mechanism
while C2describes identifier suppression; output explicitly flags contradiction and
retains conditional transfer. Preserve frozen packet/results; prospective rationale
correction only if reused. Parent verified37review artifact hashes and6case/18criterion
coverage; reviewer replayed all6textSHA/char/identity/render/schema/checkOutput and
22liveartifact hashes. Reviewer-owned optional-input verifier error repaired/replayed;
no production/source/output edits. Review has prior familiarity,nonblinded/model-only,
not human/customer acceptance. Historical placeholders/decisions/locks unchanged.
No provider/API/DB/credential/network/build/install calls this milestone. Current
operationalrole evidence3/3 now has narrow substantive reviews; fullC54stillpartial.
See docs/DISCOVERY_RESEARCH14_OUTPUT_REVIEW_2026-10-23.md and exactreview evidence.
Next eligible: bounded read-only C54 acceptance readiness/gap audit against §2.19
bridge,§2.5citedresearch and Group3in-app spec/build/export/revision/ownerwalkthrough.
No automatic workflow/pilot/live action.

## Research role1.4 live suite operationally qualified — October 23, 2026

Owner approval “Yes I approve that” recorded for d567...23c0 before execution.
Oneavailability+sixresearch requests completed;0retries,2/2development+4/4held-out
contractpasses. Qualification a2e439d2-7ff8-43c9-8d70-2b510c6a861d qualified;
finished04:00:37Z/00:00EDT within12minute suite limit. Credits off/settings unchanged.
Read-only SQL64requests (62completed/1historicalfailed/1reconciled),exact7newcomplete,
newgrant usedonce,original44+baselinehashes preserved/prior13semantics stillcomplete,
0active/unknown. GET04:01:08Z usage29/40=11studio slots,0blockers;API50is page only.
Exact compiled filter replay admits current research/candidate/scoring:3/3
operationalcoverage; six outputhashes checked. Research substantive review pending,
not human acceptance/real-world validation. Full discovery/C54partial. All old/new
locks retained;noappchanges,workflow or pilot. See live-result report/evidence.
Next U02:separate six-output substantive review against frozen18criteria/source
packets;no further provider calls authorized or needed for that review.

## Fresh research authorization v2 prepared and reviewed — October 22, 2026

New combined plan d567088498d2d0ed111c939113990997ab73cfd50f829736775697724c2223c0;
availability df52351b7edff8c9fd5493a2f33ab9d47afc681819c2e9e3d3163fe7ad4f8477.
Same seven-request ceiling (one availability check then six research), no retries,
credits off/settings unchanged,120s each/12minute suite dispatch limit. Fresh
combined/probe operation paths; original stopped plan and locks preserved and bound
in236source/artifact hashes. Never-started research suite path/guards unchanged.
Four standalone and four compiled tests,tsc,PSparser,static exactinstalled gates
passed. Separate model review supported/no material findings; parent verified245
review artifact hashes and actual approval gate. No credentials/API/DB/provider
calls,appchanges or new locks. Readiness evidence is saved,not freshly re-observed.
See docs/DISCOVERY_RESEARCH14_LIVE_AUTHORIZATION_V2_2026-10-22.md and matching review.
Next: new exact owner decision before scripts/run-research14-v2-approved-live.ps1;
record it before execution. Old approval does not cover new operation. Stop on
first failure/unknown; no automatic workflow. Coverage2/3,C54partial.

## Local research readiness restored and records reconciled — October 22, 2026

App open and saved owner session valid; authenticated GET-only local API check
succeeded at03:51:54Z Oct23/23:51EDT Oct22. Settings match,credits off,0blockers/
active/unresolved,rolling22/40=18studio slots. Research14-v2 packet unattempted.
Saved availability18:02:59Z Oct22 is stale; no current provider availability claim.
Read-only SQL confirms57requests (55complete/1historicalfailed/1reconciled), prior
44+13semantics requests/grants/access/qualifications preserved; stopped research
attempt added0. Reconciliation receipt new_requests13 refers to historical run,
not this inspection. API50record history is a page only. Exact installed gates
pass; no provider calls,settings changes or retry; old operation locks preserved.
See docs/DISCOVERY_RESEARCH14_READINESS_2026-10-22.md and readiness evidence.
Next eligible: new bounded authorization package/review with fresh paths, then
new exact owner decision for availability+sixresearch. Coverage2/3,C54partial.

## Authorized research run stopped before provider dispatch — October 22, 2026

Owner “I authorize this” recorded for combined581dd0e6...e8286 before execution.
Actual static approval/review/install gates passed. First local auth/session read
failed ECONNREFUSED127.0.0.1:4310; availability endpoint_attempted:false. No grant,
provider dispatch or research suite start; zero provider requests, no retries.
Combined/availability locks preserved; local stop reconciliation verifies absence
of grant/dispatch/provider result/suite run-lock artifacts. No app process or4310
listener observed. No DB/current service health claim; installed files unchanged.
Coverage remains2/3, C54partial. See docs/DISCOVERY_RESEARCH14_LIVE_STOP_2026-10-22.md.
Next eligible: restore/inspect local app readiness without provider calls, then
prepare a new reviewed authorization. Never replay this plan or remove its locks.

## Research live authorization prepared and separately reviewed — October 22, 2026

Combined plan 581dd0e6e30b3626a80a0657a6e169d5e11b9e6361a3c2c721a04919db7e8286
allows at most seven subscription requests: one intent-bound availability recheck,
then six research14-v2 cases only if all unchanged admission gates pass. Probe120s;
suite12-minute dispatch budget,120s each,zero retries,credits off,unchanged settings,
no quota reset/fallback/automatic workflow. Exact installed candidate and reviewed
research runner remain bound. 229 plan source bindings; 238 separate-review hashes
verified by parent. Four standalone and four compiled tests, TypeScript build,
PowerShell parser, static installed-file checks and actual approval gate passed.
Separate model review supported with no unresolved material findings; not human
acceptance or execution authorization. No credential/API/DB/provider calls, app
changes or operation/run locks. Coverage remains 2/3; full discovery/C54 partial.
See docs/DISCOVERY_RESEARCH14_LIVE_AUTHORIZATION_2026-10-22.md and matching review.
Next eligible: new exact owner approval for this seven-request scope, then record
that decision before invoking scripts/run-research14-approved-live.ps1. Prior
approvals are consumed; failure/unknown preserves locks and stops without retry.

## Research-only runner implemented and separately reviewed — October 22, 2026

Exact plan a96eed07aa0372e55d7880a62b57f6c0f5726b3ea6c559617af3f9119e11469a
binds 233 sources/artifacts, reviewed research14-v2 packet and unchanged installed
role1.4 candidate. Six sequential locator requests, no retries, 120s per request,
12-minute dispatch budget; persistent lock, intent-before-delivery and first-failure
stop. Static plan/review/install gates precede credentials; live admission remains
subject to fresh availability, credits off, unchanged settings and full capacity.
TypeScript build, standalone and compiled entries (17/17 each), six-case/54-control
check, PowerShell parser and actual review gate passed. Separate model review has
no unresolved material findings; parent verified all 240 receipt-bound hashes.
Offline checks do not establish current service health or target output fidelity.
No provider/API/DB/credential/build/install operations or run lock; prior evidence
preserved. Actual role coverage remains 2/3; full discovery/C54 remains partial.
See docs/DISCOVERY_RESEARCH14_RUNNER_2026-10-22.md and matching review/evidence.
Next eligible: prepare/review new bounded live authorization, separately scoping
fresh availability if needed, then obtain a new exact owner decision. No inherited
approval or automatic suite/workflow/pilot.

## Research-only packet v2 supported after additive review repair — October22,2026

Separate v1 review found injection confidence too narrowly exploratory despite
no usable current-need observation;minor C2observer label inherited C1provenance.
V1 preserved. Additive v2 goldinsufficient/accepts exploratory or insufficient;
unsupportedwell_supported still fails. Two-observer label restricted to C1 only.
Same6scenarios corrected before outputs,18substantive criteria unchanged.
Separate v2review supports all6golds/18criteria with no unresolved findings.
54controls/223sourcebindings independently verified;both injection positives and
negative,2/1origins labels and7v1preparation hashes checked. Parent verified
237v1+239v2receipt hashes. Currentfreeze
c0576b32481fc2f682a71d7506ef10fe4866382d065dbeb45e68d937395142d4.
Existing installed candidate d009.../role1.4 unchanged. Body102468,maxinput11987;
2dev4held-out/4of4floor,6seq0retry120seach12min prospective limits retained.
See docs/DISCOVERY_RESEARCH14_V2.md and matching V1/V2review reports/evidence.
No provider/API/DB/credential/build/install/frozenresult changes. Installedmanifest
bytes compared only. Actual coverage remains2of3;goldreview is not targetoutput
or human acceptance. Next eligible:research-only bound runner/exactplan preparation
and independent review;new applicable decision/preflight before any livecheck.
No automatic suite/workflow/pilot. Full discovery/C54partial.

## Fresh research-only role1.4 packet prepared — October22,2026

New discovery-research14-v1:6synthetic locator cases,2dev/4held-out,4of4floor.
54controls pass;18frozen substantive criteria,outputs null/not_reviewed. Covers
copied-origin counts,conditional mechanism transfer,within-simulation corroboration
versus correctness/benefit,adverse13vs5,injection/aggregate authority,stale-only
insufficient need. Corroborated case allows exploratory/well_supported with fidelity
review rather than over-specific confidence demand. Fabricated prose control
discloses structural blindspot. Not independent thesis holdouts/customer evidence.
Freeze8aead115a755b6581627e34900f1ef58e2a4c0e26f6daf490e50f9791eb3da67;
existing installed candidate d009...manifest621e...role1.4 binding223sources.
Manifest102238bytes,maxinput11980,production rendering/schema/hash checks pass.
No app rebuild/install,provider/API/DB/credential calls or oldevidence regrade.
Prospective suite6seq/0retries/120seach/12min/16000output;not an executableplan,
noimplicit availability check. Eligiblecoverage remains2of3 until actualevidence.
See docs/DISCOVERY_RESEARCH14_V1.md and packet evidence. Next U02:separate packet/
controls/criteria review;then bound researchrunner/new exactlive decision.
No automatic workflow/pilot;full discovery/C54partial.

## Role1.4 remaining evidence audit completed — October22,2026

Exact compiled discovery qualification filter replay:current candidate-generation
andscoring qualify;older research1.3 does not.2of3classes currently covered.
Oldresearch6outputs/2dev4held-out/model review remain historical,not relabeled.
All6locator system texts differ only by role-version marker versus currentprompt,
but deterministic gate intentionally requires exactcurrent binding. No gatebug
or productionrepair found.4negative controls reject stale role/system/packet and
missing revision;18saved outputhash/review associations verified. No DB/API test
was run;existing DB integration test source inspected only.
See docs/DISCOVERY_ROLE14_COVERAGE_AUDIT_2026-10-22.md and coverage audit receipt.
No provider/workflow/search/DB/credential/install/settings or oldgrade action.
Next eligible:prepare fresh research-only locator packet,currentrole1.4/candidate,
2dev4held-out/4of4floor and substantive fidelity controls;then separate review
and new exact-plan decision before any livecheck. No apprebuild needed solely
for evidencegap. C54also needs real-workspace citedcollection/comparison and
permitted search/effective limits/in-app build/export/revision/owner acceptance;
rolebenchmarks alone cannot complete it. Full discovery/C54partial.

## Role1.4 twelve-output substantive model review completed — October22,2026

Separate reviewer supports12 exact outputs against all36 frozen substantive
criteria,with no material findings or output repair. Independently verified12
outputhashes/charcounts/schemas/contracts,input rendering,raw/execution-result
correspondence and13live evidence hashes. Parent verified32review artifact hashes
and exact12request/output/packet/localcandidate bindings plus36checkliststrings.
Correct benefit/originality types,per-proposal cheaper tests,adverse comparisons,
prohibited-data deferral,both revision findings and injection asymmetry retained.
Review binds localcandidatef6cce6...,distributabled009...,manifest621e...,native
exe6c841... and executable-plan4fb62... separately. No historical grades or old
review placeholder changed. All12contract passes/4of4perclass remain recorded.
See docs/DISCOVERY_SEMANTICS_V2_OUTPUT_REVIEW_2026-10-22.md and structured response/
receipt/integration in discovery-semantics-v2-output-review-2026-10-22.
Nonblinded model review with previous packet familiarity,not independent human
acceptance,customer validation,causal improvement or fullC54 completion.
No provider/network/studio/credential/DB/build/install action this review.
Next eligible:coverage audit of remaining exact-candidate discovery evidence,
especially older research-role qualification versus installed role1.4. No
automatic new suite/workflow/pilot. Full discovery/C54 partial.

## Role1.4 semantics live suite operationally qualified — October22,2026

Owner approved exact combined1fd2ee...;oneavailability+12suite requests completed,
0retries/failures/unknowns. All12contract accepted. Candidate generation andscoring
each2/2dev+4/4held-out,exact saved manifests qualified. Suiteplan4fb62a...b280c;
completed14:02:59EDT within24min. All12outputhashes verified.
Read-only reconciliation:57saved (55completed/1historicalfailed/1reconciled);exact
prior44requests/grants/access/qualifications preserved. Newgrant usedonce;13new
requestIDs allcomplete. GET endpoint50entries is page cap,not savedcount. Credits
off/settings unchanged,22rolling/18slots,0active/unknown. Alllocks preserved.
See docs/DISCOVERY_SEMANTICS_V2_LIVE_RESULT_2026-10-22.md and runner/live-result.json.
No workflow/search/build/pilot or further provider call. Approval consumed.
Next eligible U02:independent exact-output substantive review of12responses and
36frozen criteria. Structural qualification is not source entailment/human acceptance/
customer benefit. Prior research-role evidence is older candidate,not newlyrole1.4
verified by thissuite. Full discovery/C54 partial.

## New13-request live authorization prepared/reviewed — October22,2026

Concrete combined authorization hash
1fd2ee8f8925af3e31ec7265b25c087e0b6dd021ca1c2183bf946eafc3b1af6f.
At most1new synthetic intent-bound availability check (plan4ea9ac49aaebccf028d035efe5c14ed57bed4ad8ca9979d794f3019ffcdd5a40),
then exact12suite4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c
only after success/fullpreflight. No retries,credits/settings unchanged,noquotareset,
noadditional refresh/fallback. Probe120s configured;suite24min total/120seach,
other limits/floors unchanged. Global/probe/suite locks preserve no-replay semantics.
Static combined approval/review/installedproof gates precede DPAPI;probe failure
or unknown stops suite. Exact new ownerdecision required,not supplied yet.
4offline tests/defaultentry pass;tsc/PSparser pass. Independent review supported;
239review artifact hashes verified;actual receipt static --approval-check passes
(no authority implied).GET-only13:53:06EDT healthy/owner valid,44requests unchanged,
31studio slots,0active/unknown,newpacket unattempted;provider availabilitystale.
No provider calls,probe/global/suite locks absent. See scope/review docs
DISCOVERY_SEMANTICS_V2_LIVE_AUTHORIZATION_2026-10-22.md and matching reviewreport.
Next:owner exact13request decision,then execute one combined operation ifapproved;
stop first failure/unknown and preserve evidence;substantive output review later.
Past approvals not reused;noauto workflow/pilot. Full discovery/C54 partial.

## Role1.4 installed and preservation verified — October 22, 2026

Owner confirmed Quit;pinned installer exit0 once;installer.lock preserved.
Restarted installed app;all67resources/native/manifests match reviewed package.
Schema28 and requests/grants/access/qualifications/connections/settings/config
before-state hashes unchanged.44requests (42completed/1failed/1reconciled),
zero active/unknown or leased/nonterminal work. Backups/72file rollback retained.
GET-only health/session verified at13:45:31EDT:healthy,owner authenticated,
credits off,settings unchanged,new packet unattempted.9rolling requests/31studio
slots;old records remain44. Saved availability05:04:50Z stale,not refreshed.
Runner actual static --execution-check passes verified installation and review
receipts;not live preflight or owner live decision. Executable plan
4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c.
See docs/DISCOVERY_SEMANTICS_V2_UPGRADE_RESULT_2026-10-22.md and installed-result.
No provider calls,suite,migration,setting change or old-grade change.
Next eligible:prepare/request new bounded live decision for one freshavailability
check plus exact12-suite if gates pass;no old grant/approval reuse,hidden refresh
or automatic live action. Full discovery/C54 partial.

## Local role1.4 upgrade backed up; waiting app Quit — October 22, 2026

Supported createBackup snapshot/dump/products hashes verified;protected home
config/DPAPI/plan-credential copy hashes verified;72-file program rollback verified.
Read-only before/after backup state: schema28,44requests,zero active/unknown or
leased/nonterminal workflows,settings/credits unchanged. Requests/grants/access/
qualifications/connection/config hashes saved. No provider call or migration.
Creator Agent still running PID2672;installation not started. Native controls
unavailable;owner must fully Quit through app/tray,not merely close window.
See docs/DISCOVERY_SEMANTICS_V2_UPGRADE_PREPARATION_2026-10-22.md and installation
evidence. Pinned installer helper checks quit,predecessor,installer,backup/rollback
then exclusive installer.lock. After owner Quit: install once,start app,verify67
resources/exe/schema/records/settings plus owner health/session;then installation
receipt. No restore rehearsal or live suite claimed/authorized. C54 partial.

## Bound semantics-v2 runner implemented and reviewed — October 22, 2026

Final executable plan v3
4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c
binds229sources,reviewed packet/package and exact scope.17offline tests and108
controls pass;TypeScript build/PowerShell syntax pass. Separate review supported;
240review artifact hashes verified;positive --review-check passed actual receipt.
R1 wrapper secret-order gap resolved:static --execution-check validates exact home,
installation receipt and installed resources BEFORE DPAPI. Actual wrapper negative
and direct missing-installation test independently verify refusal. Initial finding
and superseded plans preserved;no dispatch with them.
New runner retains shared12seq/no-retry/24min loop,exclusive lock,unknown/stop,
exact static review/install/hash gates and live auth/quota/credit/capacity/idle gates.
Future installation receipt and new exact-owner live decision remain required.
No run.lock,provider/network/studio/credential call or installation this step.
Installed role1.3 unchanged. See docs/DISCOVERY_SEMANTICS_V2_RUNNER_2026-10-22.md
and separate runner review report/receipt/integration.
Next eligible:supported local upgrade with reviewed pinned installer,fully quit/idle
app,rollback+supported backup,before/after state and installed-resource checks.
No automatic suite,quota refresh or new spending. Full discovery/C54 partial.

## Exact role1.4 package/plan review supported — October 22, 2026

Separate review supports exact archived candidate and declarative bindings, no
unresolved findings.370 immutable review artifact hashes verified at integration:
219 source bindings,installer/native payload/manifest,all67 archived+67 extracted
resources and exact packet/review identities. Checker108controls independently
pass. Candidate d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf.
Installation plan preserves schema28/no migration and before/after backup/record
checks. Execution binding retains limits but is explicitly non-runnable. No
installed/service or model behavior verification claimed. Parent manifest delta:
one changed service resource,six added evaluation configs,no removals.
See docs/DISCOVERY_SEMANTICS_V2_PACKAGE_REVIEW_2026-10-22.md and review receipt/integration.
No source/frozen/runtime edits,installation,provider/network/studio/credential
calls this review. Installed role1.3 unchanged. Next eligible: implement and
independently review bound runner;then supported local upgrade with backup and
record preservation under applicable scope. Exact final executable-plan owner
decision/fresh preflight remain before live suite;no old approval or quota refresh
is reused. Full discovery/C54 partial.

## Role1.4 exact Windows package prepared — October 22, 2026

Staged67 resources;TypeScript/UI/service build and host Tauri/NSIS build pass.
Initial sandbox NSIS download DNS failure retained;host build completed. Exact
installer archived and extracted;all67 payload resources match staged manifest.
Native payload SHA distinct from loose executable recorded without substitution.
Candidate d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf;
219 source/artifact hashes verified;23 targeted tests/108 controls pass.
Prospective install/execution bindings prepared, not executed or dispatch-ready.
Install requires quit/idle, rollback+supported backup, exact installer/hash checks
and before/after record preservation;schema28/no migration/settings/provider calls.
Execution binding retains12sequential/0retries/24min/credits-off/cap40/4of4 floors,
15min availability freshness and no implicit refresh. Runner remains required.
See docs/DISCOVERY_SEMANTICS_V2_PACKAGE_2026-10-22.md and package evidence directory.
Old staged bundle/installer archived;installed role1.3/manifest unchanged. No live
API/provider/credentials, installation, migration or grade change this step.
Next U02: independent exact-package/prospective-plan review;then bound runner
implementation/review and supported local upgrade under scoped work. No automatic
provider test, suite or pilot. Full discovery/C54 partial.

## Evaluation packet v2 separately reviewed — October 22, 2026

Independent v1 review found R1 inherited cross-proposal justifications/perspectives,
R2 no-new-trial wording ambiguity, R3 over-specific cable verdict. Preserved v1
and findings; created additive v2 correction before any provider outputs. Each
scoring input now cites its own justification, singleton software perspectives
match, adverse supplied comparisons coexist with no NEW trial wording, and cable
allows no/unclear while still rejecting unsupported yes.
Separate v2 review supports bounded offline packet, no unresolved findings.
108controls independently pass;12 golds and36checklist judgments reviewed.
11 own-source reasons verified;3null/8nonnull polarity swaps rejected;7v1
preparation hashes unchanged. Verified19v1+22v2 reviewer hashes at integration.
Current freeze b6da3adc6061627b81036dcacee83884d6c8fe40c539368cead1f63fb139e5fa;
local candidate f6cce6ffd9b5fa76370cd40c56e3c72c008c980f8835491b31804182516b5289.
Same newly authored scenarios corrected, not independent new sample or thesis
holdouts.13-binding identity is local source/compiled only, not installed release.
See docs/DISCOVERY_SEMANTICS_V2.md, v1/v2 review reports and v2/review-integration.json.
No runtime edits, install, provider/studio/credential calls, old grade changes or
new live authority. Installed role1.3 unchanged. Next eligible: exact distributable
packaging and supported installation/execution binding under scoped work; then
new exact-plan decision/fresh preflight. No suite/quota refresh/cap change/retry
automatically. Full discovery/C54 remains partial.

## New role1.4 evaluation packet prepared offline — October 22, 2026

New discovery-semantics-v1 packet:12 author-visible synthetic cases,2dev/4held-out
per candidate-generation/scoring class;4/4 floor retained.108 controls pass,
production input rendering and source/packet/context hashes verified. Manifest
bodies90096/120375bytes below128KiB;max inputs12850/21051 below24000.
Frozen per-output substantive criteria; fabricated narrative controls deliberately
expose structural blind spot. Gold fixtures are not provider/model-review evidence.
Freeze92635f76d187a51c3f356847f65d13d48dbdc31235feda8b31efe5841f2f5b59;
local13-binding candidate801007c2c9a2f17768dd12a3655de39db6dc335aaf4bcdc24a76534d9663fe1e.
This is source/compiled identity only, not an installed distributable. Installed
role1.3 unchanged; no executable plan/live decision/provider call. Old suites,
failures/locks and8 live artifact hashes preserved. See docs/DISCOVERY_SEMANTICS_V1.md
and tracking/evidence/discovery-semantics-v1/.
Next eligible U02: independent packet/controls/criteria/local-binding review.
Then prepare exact distributable/install/execution binding as scoped work. No
old-suite resumption, quota refresh, cap change or live dispatch. C54 partial.

## Role1.4 affected review supported — October 22, 2026

Separate model review supports bounded local finding-semantics implementation.
Exact prompt c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8;
39 immutable review artifact hashes verified at integration. No schema/selector
weakening or unresolved actionable findings. Reviewer independently passed23
checks through both standalone and compiled-default entry. Found P2 test discovery
gap: ten new calibration checks omitted by normal test glob. Repaired with small
tests/src/discovery-finding-semantics.test.ts importing shared calibration; compiled
entry now matches existing default glob. Build and23 checks pass; independent
review verified fix. Full default suite not run. Original receipts preserved;
supplemental default-entry receipt/transcript records this review-driven repair.
Historical failure/evidence unchanged and old execution guard refuses new prompt.
Installed role1.3 unchanged; no provider/network/studio/credential call or install.
See docs/DISCOVERY_FINDING_SEMANTICS_REVIEW_2026-10-22.md and review receipt/integration.
Next eligible: prepare prospective new evaluation packet and exact candidate
binding under role1.4; retain source controls, substantive review and frozen bounds.
No old locked-suite replay, new live authorization or model-behavior claim.
Full discovery/C54 remains partial.

## Finding semantics role1.4 implemented locally — October 22, 2026

Actual skeptic prompt defines finding types and authoritative reviews[].cheaper_test;
legacy enum/schema preserved. Role1.4 hash
c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8.
Direct installed TypeScript build passed;23 targeted checks passed/0failed/0skipped.
Calibration covers current rendered schema/prompt and source/proposal associations,
including disclosed structural acceptance of contradictory prose needing review.
Eight historical live artifact hashes verified; old execution guard rejects changed
candidate. No frozen assertions/output/grade changes. Installed role1.3 unchanged;
no provider call, installation, migration or new qualification.
See docs/DISCOVERY_FINDING_SEMANTICS_IMPLEMENTATION_2026-10-22.md and receipt/tests
in tracking/evidence/discovery-finding-semantics-implementation-2026-10-22/.
Next eligible U02: affected independent review of local prompt/tests; only then
prepare prospective new evaluation/candidate binding. No old-suite resumption.
Full discovery/C54 remains partial; no model-behavior verification claimed.

## Prospective finding semantics proposal prepared — October 22, 2026

U03 specification proposal defines weak_evidence for unsupported benefit and
novelty_overclaim for unsupported originality, with reviews[].cheaper_test as
authoritative test representation. Retain legacy enum/wire compatibility; no
normalizer, source-selector relaxation or historical regrade. Proposed role1.4
and new prompt hash are not implemented or activated. See
docs/DISCOVERY_FINDING_SEMANTICS_PROPOSAL_2026-10-22.md.
Verified8 live-result artifact hashes and28 preserved reviewer/source bindings;
unchanged exact-plan checker still passes108 controls. Preparation receipt in
tracking/evidence/discovery-finding-semantics-proposal-2026-10-22/.
No runtime edits, new provider calls, installation, live suite or policy change.
Next eligible U03: implement the prospective prompt/role clarification locally,
verify rendered prompt and source-association controls, then affected review.
Future live qualification requires new packet/plan/candidate binding; do not reuse
old exposed cases as independent holdouts or resume the locked suite.
Historical scoring failed/incomplete remains; full discovery/C54 partial.

## Follow-up v2 substantive model review completed — October 22, 2026

Separate reviewer directly assessed seven exact outputs and all21 frozen substantive
checklist judgments: supported. Bound request/output/packet/candidate hashes and
30 reviewer artifacts verified at integration; reviewed tracking snapshots saved
before this update. Independently replayed seven schemas/contracts and individual
assertions; historical six accepted/one scoring failure unchanged, five scoring
cases unattempted. No human acceptance or full qualification claim.
Review identifies P2 prospective taxonomy/representation alignment issue: prompt
does not define universal benefit as novelty_overclaim, or require a cheaper_test
typed finding alongside its separate cheaper_test field. Output addressed both
issues substantively; no selector defect established. Do not regrade/relax/resume.
See docs/DISCOVERY_FOLLOWUP_V2_OUTPUT_REVIEW_2026-10-22.md and new bound review
response/receipt/integration in discovery-followup-v2-output-review-2026-10-22.
No provider/network/studio/credential calls this review; no runtime/frozen changes.
Next eligible U03: propose explicit finding semantics and one authoritative cheaper
test representation, then prospectively align prompt/contract/new evaluation.
Preserve identity/source controls and all historical failures. No automatic repair,
new live suite, workflow, build or pilot. Full discovery/C54 remains partial.

## Follow-up v2 stopped on scoring acceptance — October 22, 2026

Owner approved exact suite and one additional availability refresh. Refresh succeeded;
suite sent seven sequential requests, no retries, then stopped at first scoring
development failure. Candidate generation operationally qualified: 2/2 dev, 4/4
held-out accepted. Scoring failed/incomplete: first dev failed assertions 4 and 8;
five cases including all held-out unattempted. Saved response discusses the issues
but uses weak_evidence instead of novelty_overclaim for P3/C3 and counterevidence
instead of cheaper_test for P5/C5. Offline exact-output replay reproduced both.
No rubric/prompt/code change; run.lock retained. Seven outputs need substantive
review. GET-only final state:44 requests (42 completed/1 failed/1 reconciled),
33 rolling,7 studio slots,0active/unknown,credits off/settings unchanged.
Eight new provider calls total:one approved refresh plus seven suite responses.
See docs/DISCOVERY_FOLLOWUP_V2_LIVE_RESULT.md and v2/live-result.json.
Next eligible prompt U02: independent substantive review and assessment of typed
finding failures, then prospective repair proposal if warranted. No auto retry,
resumption, suite, workflow, build or pilot. Full discovery/C54 remains partial.

## Approved follow-up stopped at freshness preflight — October 22, 2026

Owner approved exact plan 22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2
(12 sequential requests, no retries, credits off, 24-minute ceiling). Approval saved
in discovery-followup-v2/owner-execution-decision.json. Static bindings passed;
authenticated preflight stopped before run.lock or qualification creation because
availability observed 04:43:24Z was older than 15 minutes. No provider call.
GET-only read at 04:58:58Z confirms 36 requests unchanged, no manifest attempted,
zero active/unknown, 15 studio slots and unchanged settings/credits. Approval for
the suite remains valid for the unchanged plan; do not ask for it again.
Next: owner decision on one additional synthetic availability recheck, no retries,
120-second timeout, no quota reset/settings change; proposal recorded in
tracking/evidence/discovery-followup-v2/availability-refresh-proposal.json.
If approved and successful, continue the already approved suite after fresh gates.
Preserve all previous operation locks/grants. C54 remains partial.

## Discovery follow-up schema 28 binding separately reviewed — October 22, 2026

Prepared a new execution binding for the unchanged, unattempted 12-case packet.
Exact plan: 22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2.
17 tests and 108 controls passed; separate model review supported the binding.
Verified 259 execution bindings, 261 reviewer artifact hashes, and 61 installed
resources. Original packet, criteria, plans, and evidence remain unchanged.
Read-only snapshot at 04:52:48Z: 36 saved requests, 25 rolling, 15 studio slots,
zero active/unknown requests; credits off. Neither manifest has been attempted.
No provider calls, settings changes, installation, or suite execution in this step.
See docs/DISCOVERY_FOLLOWUP_V2.md and docs/DISCOVERY_FOLLOWUP_V2_REVIEW_2026-10-22.md.
Next eligible step: exact-plan owner decision, then fresh preflight for at most
12 sequential requests, no retries, 24-minute ceiling. Availability observed
04:43:24Z ages; the runner requires freshness within 15 minutes and includes no
extra refresh request. Earlier one-shot approval is consumed. C54 remains partial.

## Explicit availability recheck installed and live-verified — October 22, 2026

Owner authorized repair and newly bounded live testing. Added intent-bound grant
and availability_recheck purpose/API/UI; initial already-verified rejection retained.
Schema28 defaults old grants to model_access.29 tests pass/0skipped on disposable
PostgreSQL/loopback; TS/UI/native build pass; separate model review supported repair.
Pinned installer9cfacf012273627828da5a47d8834a9517ed0b3d7b9d467c907ca543752504f3 installed exit0
after owner Quit;68-file rollback saved. Supported backup/migrate27→28 hash verified;
original35requests/grants/access/qualifications/settings preserved.61 installed
resources manifest82fa93fcc6783c7aa6db33b9ac94c00a2cb82d9b92ec4458d29cfe8116a509f7.
Loose-native hash differed; pinned-installer extraction proves installed payload
2d007429953fab03eb0adf7131b13158282920a66a9b01b9ce62704aef858652. Original plan retained.
One new live availability requestabf94f01-938e-4de7-b1a5-671f5f4478d8 completed with
2chars/hash ok/5outputtokens. Grant4232244c-8d65-4cd6-9615-45ca54da2f32 used1.
Quota observed available2026-10-22T04:43:24.328Z;25/40rolling,15slots,credits off.
Helper postcondition erroneously expected omitted API grant_id; stopped AFTER
success. Read-only SQL finalizer verified binding and exact preservation;no retry.
36saved=34completed+1failed+1reconciled,0active/unknown. Test server stopped/app running.
See docs/AVAILABILITY_RECHECK_IMPLEMENTATION_2026-10-22.md and live final-result.json.
No discovery qualification/suite/pilot. Old follow-up schema27/source bindings
intentionally stale. Next offline prospective schema28/current-candidate binding
and affected review for unchanged unattempted12cases; then scoped suite decision
and fresh preflight. One-shot approval consumed;C54 partial.

## Approved availability recovery stopped at local admission — October 22, 2026

Owner approved quota-observation clear plus one verify/no retry/no suite. Reset
succeeded to unknown; new one-shot grant082e920d-d3c1-4ab7-8f19-9a19258eab53 created.
Verify POST returned403; stopped without retry. GET-only diagnosis and actual
compiled admission replay identify sole blocker: model already verified on this
path. Proposed recovery procedure missed this restriction; no guard bypassed.
35 requests unchanged,0new/active/unknown;grant unused;24/40 rolling use,16slots;
credits off/settings hash unchanged/qualifications unchanged. No provider call
admitted. Unknown quota is not available. Original observation and operation.lock
preserved in tracking/evidence/approved-availability-check-2026-10-22.
See docs/APPROVED_AVAILABILITY_CHECK_RESULT_2026-10-22.md. Earlier built-in verify
recovery proposal is not executable for this already-verified model. Next eligible
local versioned explicit availability-recheck implementation with one-use grant,
privacy/cap enforcement and meaningful tests; then affected-candidate review and
new live decision. No repeat grant/retry/suite. C54 partial.

## Saved studio started; authenticated readiness inspected — October 22, 2026

Started installed desktop normally. Supervisor recorded healthy managed DB/service
and removed expired/revoked local session. Owner signed in through desktop; GET-only
inspection succeeded. Settings5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533
match plan;credits off;24 rolling requests/40cap=16slots versus12needed;0active/unknown.
35 saved requests=33completed+1failed+1reconciled unchanged. Saved provider quota
still exhausted from2026-10-21T07:29:59Z; actual current allowance not checked.
No provider calls/quota reset/settings change/qualification/migration. Desktop left
running. docs/DISCOVERY_STARTUP_READINESS_2026-10-22.md gives concrete proposed
one-shot availability recovery: preserve observation, authenticated quota-recheck
to unknown, new one-request grant and one built-in verify with existing120sec/
16000char caps; no retry/paid fallback/automatic suite. This new provider action
requires scoped authorization. Read-only helper syntax/contract parsing passed.
Next eligible: owner decision on that one request; then separately exact-suite
decision/fresh preflight if availability established. C54 partial.

## Separate model review completed — October 22, 2026

Owner explicitly authorized fresh-context review subagent. Separate reviewer read
all ten v5 outputs before author conclusions;10 cases/30 criteria supported.
No material new code defect established in follow-up packet/runner; static gate
and14 offline tests pass. Parent verified235 reviewed artifact hashes and exact
review-response binding; narrow separate-model-review gate satisfied. Not human
acceptance, thesis rating, full discovery qualification or activation. Additive
report docs/DISCOVERY_SEPARATE_REVIEW_2026-10-22.md and evidence under
tracking/evidence/discovery-separate-review-2026-10-22; original files preserved.
Fresh installed manifest0331d863e67859d0338e4f54560e12a020f16923730b47ed82411743474707d9
and58 resources match. Local health initially sandbox EACCES; permitted read-only
retry ECONNREFUSED. No credential access/service launch/provider call. Current quota
unobserved. Availability gate requires available observation within15min; reset
to unknown or waiting is insufficient. No quota reset authorized/performed.
Next eligible: start normal saved studio and inspect authenticated status read-only;
establish separately authorized bounded availability path if necessary, then exact
plan decision/fresh preflight. Do not resume v5, relax availability gate, pool
grades or dispatch automatically. Human/owner acceptance and C54 remain partial.

## Separate-review authorization requested — October 22, 2026

Checked available review tools: Code Review connector exposes CI diagnostics only;
CodeRabbit CLI not found. No install, external upload or reviewer contact performed.
Host requires explicit authorization to spawn a review subagent; requested a fresh-
context separate model review of the ten v5 outputs plus follow-up packet/runner.
No separate acceptance claimed. Local health probe initially EACCES in sandbox;
authorized read-only retry returned ECONNREFUSED on127.0.0.1:4310. Current provider
availability remains unobserved, not inferred exhausted or reset. Two unique
readiness-observation receipts retained under discovery-followup-v1. No inference,
settings change, service launch or frozen artifact mutation. Next: on explicit
subagent authorization perform separate model review; otherwise owner-supplied
reviewer response. Live dispatch remains gated. C54 partial.

## Fresh discovery follow-up packet prepared — October 22, 2026

Prepared12 fresh candidate/scoring cases,2dev+4held each;108 author controls and
14 offline runner/contract tests pass,0 skipped. Same role1.3/schema27/v5 runtime;
no installation or production edits. External manifests POST93537/111689bytes,
max input13468/19695chars.231 bindings/58 staged resources verified; original183
source bindings and historical evidence preserved. Freeze55da91cabef9163692508132e936b9a2e5df9815f071ca93642db0cd091f2266;
execution plan2dca3f79f5c7c98f88eef2f20a915c8e2a5f71e1f2da8934b9ca6c0dd9110c3e.
Bounded runner max12 sequential/no retries/120sec request/24min total; static
separate-review gate before secrets, fresh available quota within15min,40/day
unchanged,credits off,no paid fallback. No live calls/quota check/settings/migration.
See docs/DISCOVERY_FOLLOWUP_V1.md. Separate substantive review/provider availability
and exact prospective approval remain gates; no automatic run/research/search/pilot.
Next eligible: separate reviewer completes prior exact-output packet and reviews
new packet/runner; resolve availability, then exact decision/fresh preflight.
C54 partial; offline adapter tests do not establish live qualification.

## Separate review packet and remaining-coverage proposal — October 21, 2026

Prepared docs/DISCOVERY_REMAINING_COVERAGE_PROPOSAL.md and new additive evidence
in tracking/evidence/discovery-followup-proposal. Ten exact outputs/full inputs/
frozen checklists exported without prior author judgments or automated grades;
review-response template remains not_reviewed, no independent acceptance claimed.
Verified ten output/packet bindings, frozen manifests and all183 source bindings;
original top-level v5 evidence unchanged. Proposed fresh12-request suite covers
candidate_generation/scoring,2dev+4held each, unchanged4/4 floor, no pooled v5
grades, no retries/paid fallback,40/day unchanged. Proposal is not executable or
authorized. No new cases frozen, live calls, quota read, install or reviewer contact.
Next eligible offline preparation of fresh executable cases/controls/bounded runner;
separate substantive reviewer and provider availability remain dispatch gates.
C54 partial; source parity does not establish current installed/runtime parity.

## V5 offline artifact review — October 21, 2026

Completed coding-agent second pass of all ten answers against frozen claims and
review checklists; not independent human/blind acceptance. No material source
contradiction identified; minor origami next-action placement and condition-checklist
responsibility observations recorded, no grade/prompt changes. New offline receipt
binds ten output/packet hashes and candidate/plan; replayed ten frozen checks pass.
Verified frozen manifests and original top-level evidence unchanged. One quota case
has no answer, seven cases unattempted; research operational-only, candidate failed,
scoring absent, C54 partial. See docs/DISCOVERY_V5_OFFLINE_REVIEW.md. Current-status
and runbook banners distinguish superseded instructions. No live calls, quota read,
settings changes, install or pilot. Next: separate substantive acceptance and
prospective remaining-coverage proposal; no automatic dispatch or frozen-v5 rerun.

## V5 ran with owner capacity amendment; provider quota stop — October 21, 2026

Owner authorized temporary40→42 daily cap. Separate amendment
19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d preserved original
v5 plan/cases/candidate.11 attempts:10 completed/accepted; request11 failed provider
subscription_sharing_usage_limit_exceeded. Research2dev+4held accepted/qualified;
candidate2dev+2held accepted, next held quota failure, revision unattempted; failed
2/4 floor. Scoring6 unattempted. No retry,7 cases unattempted, no content grade
inferred for quota failure. Temporary cap restored40/settings hash5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533,
credits off. Restore assertion encountered independent quota blocker after mutation;
read-only verification recovered receipt without repeat mutation.35 requests:
33complete/1failed/1reconciled,0unknown/0active/0leased/0workflows;36 audit events.
Installed/source hashes verified. Provider quota exhausted; no reset time observed.
docs/DISCOVERY_V5_LIVE_RESULT.md. Independent review pending/full discovery C54 partial.
Next eligible offline artifact/remaining-coverage review, no automatic rerun or pilot.

Capacity recheck October21,03:19AM EDT (07:19UTC): approved v5 plan and183 source
bindings/installed candidate still match;16 daily slots versus18 required,
0unresolved/0inflight. No requests or qualification dispatched. Evidence
discovery-qualification-v5/preflight-capacity-check.json and capacity-recheck-result.json.
Existing approval remains valid; next eligible fresh check at sufficient capacity,
estimated08:38:49AM EDT without further usage. No cap changes or automation.

## Approved v5 installed; suite awaits capacity — October 21, 2026

Verified183 bindings/installer/predecessor, saved62-file program rollback, graceful
Quit and installer exit0. Current manifest
0331d863e67859d0338e4f54560e12a020f16923730b47ed82411743474707d9;58 installed files verified.
Session/schema27/settings/exact request records retained. Readback24 requests,
28 audit events/0 workflows/0leased/0unresolved/0inflight unchanged. No live call or
v5 qualification/run.lock. Capacity16 slots versus18 required; keep40/day unchanged.
Estimated18 slots October21~8:38:49AM EDT without new usage; recheck authoritative
preflight then. Approval retained for exact plan68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d.
Next eligible same approved bounded suite when capacity/other gates pass; no repeat
approval needed. No automation scheduled. docs/DISCOVERY_V5_INSTALLATION.md.
Live repair/model qualification still unverified; C54 partial/no automatic pilot.

## Stream repair candidate and fresh v5 frozen — October 21, 2026

18 fresh role1.3 packets (2dev/4held per class),144 base controls,75 affected checks
pass/0 skipped on disposable PostgreSQL/loopback fakes. Actual v3/v4/v5 manifests
exercise authenticated HTTP with no inference. TypeScript/UI/NSIS build passes;
existing chunk warning. Test DB stopped. POST106202/92691/108642bytes and max input
14064/13135/18382chars within existing caps. Final freeze
bdea8d1b1eb819ef53fd37fa4460987a90f8db1f8d8ab0a2ccdaa61cf58beaf9.
Candidate0331d863e67859d0338e4f54560e12a020f16923730b47ed82411743474707d9,
installer2d1be3976bbe6618a8c3acc1d3d31854752e1be370238b0fa01ef3422c89c08d,
plan68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d.
183 source bindings/58 packaged resources verified; historical packets/5locks and
reconciliation lock retained. Current installed115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1 unchanged.
No model calls/install/settings/migration. Readback24 requests/0unresolved/0inflight;
only16 daily slots remain versus18 required. Next eligible exact packet approval,
install/state checks and capacity-gated execution; never raise cap or extend timeout.
See docs/DISCOVERY_QUALIFICATION_V5.md. Independent review pending/C54 partial.

## Approved timeout reconciliation and qualification closure — October 21, 2026

Owner authorized the concrete next decision. Local authenticated API recorded
50fcd841-85c1-4abd-9591-e18655538a2f as reconciled/owner_ran WITHOUT usable result;
upstream ID/1653chars/null output hash+tokens/start+finish times preserved. Closed
qualification887288bb-ce7f-4edb-b11f-7f1494b146e3 failed under unchanged3/4held-out
versus4/4 required (2/2dev). No retry/new provider call or missing-answer grade.
Independent API/DB readback:24 requests=23completed+1reconciled,0unknown/0inflight,
0leased/0workflows,28 audit events. Schema27/settings/installed manifest unchanged.
Five old locks and original timeout evidence preserved; new operation.lock retained.
See docs/V4_TIMEOUT_RECONCILIATION.md. Source stream fixes remain uninstalled;
role1.3 discovery unqualified/C54 partial. Next eligible: repair candidate/prospective
qualification preparation. No automatic installation/live run or workflow/pilot.

## Stream recovery/reconciliation reviewed and repaired locally — October 21, 2026

Reproduced missed CRLF completion, completion-fallback output-cap bypass and
did_not_run reconciliation contradicting positive observed output. Fixed incremental
LF/CRLF/CR normalization, fallback cap and atomic reconciliation contradiction guard.
36 affected checks pass/0 skipped including stalled real loopback HTTP, durable
unknown/duplicate fencing, API and worker paths on disposable PostgreSQL. TypeScript
passed/test DB stopped. Live v4 timeout root cause remains unproven (no wire trace).
Readback24 requests/26 audit events/0 workflows/1unknown unchanged; no new live calls,
owner reconciliation or installation. Installed115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1 unchanged.
See docs/PLAN_STREAM_RECOVERY_REVIEW.md and tracking/evidence/plan-stream-recovery.
Concrete proposal: owner records ran without usable result, then closes v4 qualification
failed at unchanged3/4 held-out floor; no retry. Next eligible decision/repair-candidate
preparation, not automatic dispatch. Source repair not live verified; C54 partial.

## Approved v4 installed; stopped on unknown timeout — October 21, 2026

Exact approved plan58dff31c4e9484689ff9c533c71337c44b97e6a52e8c1025a82562850af8d721
installed successfully;162 bindings/53 installed resources verified,56-file rollback.
Current manifest115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1.
Schema27/session/settings/records preserved. Six attempts:5 completed/accepted
(2dev/3held), sixth held-out timeout unknown after120359ms/1653 observed chars.
No retry; candidate/scoring12 cases unattempted. Research qualification
887288bb-ce7f-4edb-b11f-7f1494b146e3 remains running/unresolved, not qualified.
Readback24 saved requests:23 completed/1unknown/0in-flight;0leased/0workflows.
No reconciliation or fabricated completion; response ID retained. No quota result
observed. No migration/settings/credits/metered fallback/search/build/pilot.
Independent substantive review pending/full discovery C54 partial. See
docs/DISCOVERY_V4_LIVE_RESULT.md and v4 execution-outcome.json. Next eligible:
bounded stream-timeout recovery/reconciliation review; preserve unknown and5 locks,
no restart or new live dispatch automatically.

## Fresh v4 packets frozen and candidate prepared — October 21, 2026

18 new synthetic packets for role1.3 (2dev/4held per class),144 base scorer controls
and45 affected tests pass/0 skipped. Actual v4/v3 fixture manifests exercised through
authenticated HTTP with no inference dispatch. Identity-bound skeptic associations,
permutation equivalence, positive internal corroboration and complete revision covered.
Semantic-negative controls remain disclosed automation limits; independent review
is required/not performed. Pretarget authoring drafts and failed local logs retained.
TypeScript/UI/native NSIS build passed; existing Vite chunk warning. Test DB stopped.
POST106068/92312/108784 bytes; max input14221/13016/18426 chars fit existing caps.
Verified162 source bindings/53 packaged files; historical v1–v3 frozen data/4locks
and installed manifest907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17 unchanged.
Prepared candidate115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1,
installer5587625285af68a1288e4f97cf27dcf2dc91e9460b4e4d37e6d17e989bf1e3c1;
execution plan58dff31c4e9484689ff9c533c71337c44b97e6a52e8c1025a82562850af8d721.
No install/model calls/settings/migration. See docs/DISCOVERY_QUALIFICATION_V4.md.
Next eligible: exact candidate approval, graceful install/state verification,
at most18 sequential requests/no retries or new metered spend; stop first failure.
No automatic workflow/search/build/pilot. Source discovery unqualified/C54 partial.

## Role1.3 field semantics and identity assertions implemented — October 21, 2026

Added opt-in skeptic proposal/finding selectors with packet/context validation;
exactly one match required, null catalog supported, reordered reviews equivalent.
Legacy assertions retain grading/canonical hashes. Model instructions clarify
affirmative novelty/null, new/custom software, bounded cheaper tests and evidence
association. Output schemas/limits unchanged; new prompt hash
024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77.
TypeScript passed via installed compiler (pnpm launcher registry DNS unavailable).
38 affected domain/API/workflow tests pass,0 skipped on disposable PostgreSQL and
loopback stand-ins. Historical v1–v3 qualifications cannot unlock new-role workflow;
exact historical grades preserved. Test database stopped.19 bound config/evidence
files and installed907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17 unchanged.
No installer, saved-studio mutation or model calls. Source role1.3 unqualified;
independent substantive review still required/full discovery C54 partial.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md and implementation evidence.
Next eligible: author complete fresh packets/controls, verify serialization/bounds/
review criteria and freeze concrete candidate proposal. No automatic install/dispatch.

## Role1.3 field semantics and identity assertions implemented — October 21, 2026

Added opt-in skeptic proposal/finding selectors with packet/context validation;
exactly one match required, null catalog supported, reordered reviews equivalent.
Legacy assertions retain grading/canonical hashes. Model instructions clarify
affirmative novelty/null, new/custom software, bounded cheaper tests and evidence
association. Output schemas/limits unchanged; new prompt hash
024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77.
TypeScript passed via installed compiler (pnpm launcher registry DNS unavailable).
38 affected domain/API/workflow tests pass,0 skipped on disposable PostgreSQL and
loopback stand-ins. Historical v1–v3 qualifications cannot unlock new-role workflow;
exact historical grades preserved. Test database stopped.19 bound config/evidence
files and installed907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17 unchanged.
No installer, saved-studio mutation or model calls. Source role1.3 unqualified;
independent substantive review still required/full discovery C54 partial.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md and implementation evidence.
Next eligible: author complete fresh packets/controls, verify serialization/bounds/
review criteria and freeze concrete candidate proposal. No automatic install/dispatch.

## Cross-role assertion-semantics audit completed offline — October 21, 2026

Audited18 frozen v3 cases/71 assertions across locate/propose/revise/skeptic.
Executed72 offline probes against existing production validators/scorer; all expected
results matched, including disclosed false acceptances. Six no-originality prose
alternatives fail exact-null grading; six generic-gap mutations, ignored revision
findings and misassociated skeptic findings can pass. Preserved146 source bindings,
all three v3 manifests, four run locks and selected exact live evidence unchanged.
No runtime/prompt/grade/settings changes, install or model requests. Full discovery
unqualified/C54 partial; v3 research remains operationally qualified only.
docs/DISCOVERY_ASSERTION_SEMANTICS_AUDIT.md contains field-policy proposal,
identity-bound assertion design, independent-review boundary and18 fresh scenario
sketches (not executable/frozen). Evidence tracking/evidence/discovery-assertion-semantics.
Next eligible: implement prospective versioned field semantics and identity-bound
assertions with local controls and preserved legacy scoring; then prepare complete
fresh packets/candidate proposal. No automatic install/live dispatch.

## Approved v3 installed; research passes, candidate suite stops — October 21, 2026

Exact owner-approved installation succeeded: 146 bindings, 51 rollback files and 48
installed resources verified. Current manifest
907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17; schema27/session/settings intact.
Seven new requests completed: research 2/2 development + 4/4 held-out accepted;
first candidate development case failed frozen novelty=null assertion. Production
validation and four other assertions pass; actual text denies originality. Possible
grading/serialization mismatch recorded without regrading. Stop honored, no retries,
eleven unattempted, scoring not started. API/database:18 total requests, zero
active/unknown/leased/workflows. Independent substantive review remains required;
author observations are separate. No migration/settings expansion/metered fallback/
credits/search/build/pilot. Full discovery unqualified/C54 partial.
See docs/DISCOVERY_V3_LIVE_RESULT.md. Next eligible: cross-role assertion-semantics
audit and prospective versioned qualification design. Preserve all grades/locks;
no automatic live rerun.

## Fresh v3 qualification frozen and candidate prepared — October20,2026

Completed18 new synthetic packets/manifests for current role1.2 with exact production
prompt and message serialization.2 development/4 held-out per class; full two-finding
revision and five-proposal skeptic coverage. Cases/criteria/gold/control hashes frozen
before target outputs.144 local scorer assertions, including18 explicit demonstrations
of the substantive-entailment blind spot; required reviewer checklists retained.
All56 affected checks pass/0 skipped on disposable PostgreSQL and loopback stand-ins.
Actual v3 manifests exercised through authenticated HTTP; research service grading
uses stand-in outputs, not real model evidence. POST bytes101745/86861/104186 and
max inputs12244/12140/18274 fit existing128KiB/24000 limits. Historical v1/v2 files,
failed grades and locks preserved. TypeScript/web build and native NSIS packaging
passed; existing chunk warning. Test cluster stopped. No new provider calls, saved
studio changes, install, settings expansion or migration. Current installed manifest
remainsb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Concrete review packet: docs/DISCOVERY_QUALIFICATION_V3.md. New installer hash
a29821c994c7a4f3de6e9629fc92be27de449467a28444b43d19eebb8a9ad648,
bundle907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17,
execution plan8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a
binds146 files plus frozen data. Next eligible: exact v3 packet approval, graceful
install/state verification and max18 new sequential plan requests with no retries/
new metered spend, stop first failure/unknown/quota. No automatic workflow/search/
build/pilot; substantive review remains separate, discovery unqualified and C54 partial.

## Discovery output-contract audit/revision1.2 completed offline — October20,2026

Audited locate/propose/revise/skeptic against all production schemas. Replaced
field-name sketches with schema-derived JSON types/limits/enums/reference formats,
strict object keys and full revision shape. Clarified discovery payload instead of
generic TaskResult/status/usage wrapper; preserve uncertainty within bounded fields.
Application validators, relational/source checks, permissions and budgets unchanged.
Shared discovery role version1.2/prompt hash01ef4e7c37ab9c6c50abe0d4c3ef25a22484daa8d3d1490672bc60e8007c0f00.
No provider-enforced structured-output support assumed: existing plan adapter still
sends text; deterministic post-validation and substantive review remain required.
TypeScript passed;52 affected tests pass/0 skipped on disposable PostgreSQL and
loopback stand-ins, including189 nested boundary mutations, exact historical v1/v2
bytes/grades and rejection of both historical qualification versions. Current-model
fixture HTTP payloads101668/83535/88740bytes and inputs12173/10748/10939characters
fit accepted ingress/input caps. Test-only rebindings are not live qualification.
Retained exact v2 output still invalid; no coercion/regrading. Offline inventory
and prompts: tracking/evidence/discovery-output-contract.18 fresh v3 scenario
designs proposed, not executable manifests or frozen live authority. No model calls,
install, settings change, migration or frozen-study protocol/weight changes. Current
installed bundle remainsb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Read docs/DISCOVERY_OUTPUT_CONTRACT_AUDIT.md. Next eligible: author/freeze complete
fresh v3 packets/manifests/controls, verify exact HTTP/input bounds and reviewer
checklists, then prepare a concrete candidate/execution packet. No automatic live
rerun, workflow/search/build/pilot; discovery unqualified and C54 partial.

## Approved transport repair installed; v2 stopped on schema failure — October20,2026

Jordan approved exact repair packet8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459.
Verified137 bindings, saved hash-verified program rollback, graceful Quit, installer
exit0 and installed manifestb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Reopened with session/schema27/settings/records unchanged; no migration/permissions
change. Real API qualification creation now succeeds. Exactly one new gpt-6-astra
request completed on loc-dev-maintenance, then schema_invalid stopped the suite.
affected_users was an array instead of string; gaps had10 entries versus max8.
No retry, later cases/classes or held-out dispatch. Research qualification
9586ebfb-adf8-4550-8c95-9a011744f2a1 is failed. Independent readback:11 total completed
requests, zero in-flight/unknown/leased and0 workflows. Earlier summarization remains
narrowly qualified; discovery does not. Raw output, hashes, failed grade and all
three locks preserved. Coding-agent author review observed appropriate uncertainty
and synthetic limits, but is not independent human acceptance or a passing grade.
See docs/DISCOVERY_V2_LIVE_RESULT.md and tracking/evidence/discovery-v2-transport-repair/
execution-outcome.json. No metered fallback/credits activation/search/workflow/build/
pilot launch. C54 partial. Next eligible: bounded model-facing output-contract audit
against every production role schema, exact types/limits and versioned prospective
controls/qualification proposal; preserve current failure, no automatic live retry.

## Approved v2 installed; zero-dispatch HTTP413 stop; repair prepared — October20,2026

Owner approved exact v2 packet. Verified program-only rollback, graceful Quit,
installer exit0 and installed bundle733837fe38fd84be6479e02ac1115dededd98a7ca99a644d03b31e72b043897c.
Reopened with saved session/schema27/settings/records unchanged. Qualification
manifest creation was rejected by the64KiB API body cap: research payload77,265bytes.
Runner stopped at attempted0/qid=null; preserve v2 run.lock. Independent readback:
10 total completed requests, zero active/unknown/leased, no new qualifications,
19 audit events and zero workflows unchanged. No target inputs were sent.
Narrow fix implemented locally: authenticated qualification creation accepts128KiB,
all other actions retain64KiB; declared and streamed bytes, owner/CSRF/schema/task/
data/model/version gates remain. Four HTTP/API checks pass using actual frozen
manifest payloads and chunked requests, oversized/unauthenticated rejections and
loopback-only inference stand-ins. TypeScript/web/service/native/NSIS build passed;
existing chunk warning. Repair built but not installed. Original18 model cases,
criteria and runtime prompt unchanged; frozen-input/role evidence remains as before.
Separate repair packet binds137 files/receipts and requires predecessor zero-dispatch
proof; new lock preserves stopped run. docs/DISCOVERY_V2_TRANSPORT_REPAIR.md has
exact candidate/run hashes. Next eligible: approve/install transport repair and run
same bounded18-case suite (no retries/new metered spending), then substantive review.
No saved-data migration or permission expansion proposed. C54 partial; discovery
unqualified. No workflow/search/build/pilot activation.

## Operational rubric1.1 and executable v2 qualification prepared — October20,2026

Implemented explicit observed-need confidence anchors in the production locator;
shared discovery role version is r02-discovery/1.1. Packet admission is separate
from corroboration/real-world validity and from untested intervention benefit.
Authored/froze18 fresh production-bound cases and108 local scorer controls, with
positive coverage of all confidence labels, schema-valid bad decisions, source
refs, designer revision and multi-proposal skeptic coverage. All44 affected tests
passed with zero skips on disposable PostgreSQL. Historical v1 grades/bytes remain
unchanged and a qualified v1 manifest cannot unlock the revised role. A semantic
negative control documents the narrative-entailment gap; substantive review is
still required and the runner retains reviewer/output-hash checklist state.
Offline initial draft packet-tag inconsistency was corrected before target output;
its manifests/freeze/test log retained in v2/preflight-draft. Final bundle built and
NSIS packaged; backup-first staged upgrade and restore/adoption passed. Extra staged
startup/persistence check blocked by existing port4310 (failed receipt retained),
not claimed verified. No installed update, saved settings/migration or provider calls.
Review packet: docs/DISCOVERY_QUALIFICATION_V2.md; evidence:
tracking/evidence/discovery-qualification-v2. Exact127 bindings and installer/run
hashes prepared. Next eligible: scoped approval/install/execution of the v2 packet
(max18 new plan requests, no retries/new metered spend, stop first failure), then
substantive review of exact outputs; no automatic workflow/search/build/pilot.
Earlier v1 approval does not cover this new candidate/run. C54 remains partial.

## Discovery evidence-strength review completed — October20,2026

Offline review: docs/DISCOVERY_QUALIFICATION_RUBRIC_REVIEW.md. Packet sufficiency
is investigation admission, not proof of independent or real-world need. Production
locator labels lack scope anchors; two v1 cases require well_supported despite
synthetic evidence. Actual exploratory response is defensible; original failed grade
is retained, not promoted. Review reproduces contract-pass/assertion-fail and verifies
117 pinned source bindings, original manifest bytes and preserved run.lock.
Prepared18 fresh scenario designs (2development/4held-out per class), including
designer revision, in config/connections/benchmarks/discovery-synthetic-v2/proposal.json.
These are prospective design specs, not executable manifests, independent ratings,
a frozen study or live authority. No provider calls, runtime/prompt/installed/settings
changes. C54 remains partial; discovery unqualified. Receipt:
tracking/evidence/discovery-rubric-review/result.json. Next eligible: implement
operational rubric anchors and production-bound v2 manifests/controls, verify all
roles and prepare a new hash-bound execution packet. No automatic install/live rerun.

## Approved discovery upgrade executed; qualification stopped — October 20, 2026

Jordan approved the exact review packet. Installer exited0; installed bundle hash
80fe5f7a40e844d6361277dc4c96f33e927cb0527871fe2e863c08b086cdb56b.
Supported installed service saved a verified pre-upgrade dump and migrated26→27.
Desktop reopened, local-owner sign-in renewed, reviewed three task permissions
accepted through API; caps/data/credits-off unchanged. Exactly one live gpt-6-astra
request completed, then stop-on-first-failure halted dev-transfer: production schema/
refs passed, frozen well_supported expectation disagreed with exploratory output.
No retries, held-out cases, later classes, search, workflows or pilot launched.
Readback:10 total completed requests, zero in-flight/unresolved; discovery remains
unqualified (research_synthesis failed; other two classes untested). Preserve all
frozen inputs/criteria/run.lock. Possible overly restrictive authored expectation
requires review, not retroactive passing. See docs/DISCOVERY_QUALIFICATION_RESULT.md
and tracking/evidence/discovery-qualification-prep/execution-outcome.json.
Next eligible: bounded evidence-strength rubric review and versioned fresh-case
qualification proposal; no automatic rerun or new milestone. C54 remains partial.

## Discovery qualification and migration prepared — October 20, 2026

Concrete review packet: docs/DISCOVERY_QUALIFICATION_PLAN.md. Built final unsigned
installer and staged migration-27 bundle; current installed manifest re-read and
verified rollback program copy prepared (no studio data/credentials copied).
Prepared 18 new synthetic cases: 2 development + 4 held-out per discovery class.
Production schemas/source refs and frozen decision assertions grade outputs; current
role-prompt binding and designer revision coverage are required by workflow admission.
Unrelated/stale task-class qualification cannot unlock discovery. Local checks32/32,
staged backup-first upgrade/restore checks2/2; native release/NSIS build passed.
No new real provider calls, saved-studio migration, installation, settings expansion
or activation. Before/after settings, source/artifact hashes and exact execution plan
are in tracking/evidence/discovery-qualification-prep. Initial freeze's template
settings hashes are superseded only for execution by settings-review.json; case
bytes/criteria unchanged and no target outcomes seen. The actual approved change
adds only research_synthesis/candidate_generation/scoring, preserving all caps/data/
credits policy. Next eligible: exact packet approval/execution (max18 plan calls,
no retries/new metered spend; stop on failure/unknown/quota). Do not replay summary
benchmark or start other milestones. Existing uncommitted work preserved.

## §2.19A subscription discovery bridge — October 20, 2026

Implemented first slice in checkout; docs/SUBSCRIPTION_DISCOVERY.md describes exact
scope. Migration 27 adds immutable typed workflow resources and task-bound replay
outputs. Plan discovery has no API pricing/envelope, uses existing grants/lifecycle/
leases, and requires research_synthesis/candidate_generation/scoring qualifications.
Connection settings/data/role/call/day/run caps and input hashes are checked; one
job/attempt, bounded repairs, cancellation and unknown-result reconciliation remain.
Embedded and standalone workers share the plan service. Submit selects resource/data
classes and shows blockers; workflow details distinguish subscription usage. Legacy
payload/hash and frozen-study paths retained; local route explicitly unimplemented.
Checks: TypeScript/web pass; affected suites 46/46; final focused checks and candidate
hashes in tracking/evidence/subscription-workflow; browser 7/7 fixture-only, zero writes.
No new real provider calls, settings changes, studio migration, native install,
Agent Reach, pilot activation or study changes. Existing earlier uncommitted repairs
preserved. C54 remains partial. Next eligible: bounded role-qualification preparation;
live dispatch/settings expansion requires its matching scoped authority. See guide.

## Current-status reconciliation completed — October 20, 2026

Authoritative concise snapshot: docs/CURRENT_STATUS.md (candidate/evidence table,
limits and next bounded prompt). Earlier conflicting entries below are historical.
Staged desktop manifest hash rechecked against recorded installed receipt; no fresh
installed-disk/native acceptance asserted. Plan-summary receipts confirm narrow
2/2 development + 6/6 held-out qualification, not discovery/search/code readiness.
Readiness register adds C52–C54 as not_verified and corrects obsolete no-live-call
blockers without promoting states/removing gates. Deterministic check: not_ready,
zero register problems. Separate non-activating owner-pilot.defaults.json prepares
accepted defaults; activation config unchanged. Manual schedules=[] rejection and
integration-wide account gating remain implementation blockers, not bypassed.
Next eligible: first §2.19A typed-resource/workflow-bridge slice in CURRENT_STATUS.
No runtime implementation, live dispatch, installs, activation or frozen-study change.

## First live summarization qualification — October 20, 2026

Jordan authorized benchmark preparation and execution in chat after the successful
one-call model verification. Frozen eight-case synthetic structured-event-summary
manifest: config/connections/benchmarks/summarization-synthetic-v1.json. Two development
and six held-out cases, all six required; exact canonical JSON grading rejects missing,
wrong and extra content. Forty local scoring checks passed before dispatch. No target
outputs were seen before freezing; no prompts, labels or criteria changed afterward.

Executed exactly eight new gpt-6-astra direct-plan requests through the existing
PlanConnectionService admission/vault/provider/settlement path. Qualification created
through the authenticated API, then finished through the existing domain gate. All
eight completed/accepted: development 2/2, held-out 6/6; state qualified. Qualification
db9cc857-cb7b-4651-a0e9-4f74ac00da85; manifest canonical hash
72809de002696f07d9574c3ec474596d4847afc8fe5904281150e8bdff5fea15.
Independent installed-API read verified the decision, matching eight request IDs and
output hashes, valid UI schema, nine requests total (one prior verification + eight
cases), zero running/unknown. No retries, credits, paid fallback or cap changes.

Guide/commands: docs/PLAN_SUMMARIZATION_QUALIFICATION.md. Frozen intent, raw synthetic
outputs and receipts: tracking/evidence/plan-summary-v1. Runner retains raw outcomes
in addition to the normal database hashes/signals, and an exclusive lock prevents
automatic repetition. This is a small operational check of constrained structured
summaries, not general prose quality, independent review or thesis evidence. Existing
UI gate calls it summarization; qualification of specification/code_build and broader
acceptance remain separate. No new app build needed. Next eligible: separately select
a bounded summarization use or specification qualification; no automatic next task.

## ChatGPT sign-in repair — October 20, 2026

Reproduced two native defects: the minimal installed-service PATH cannot resolve
`powershell.exe`, so DPAPI token saving fails after browser authorization; and
PostgreSQL JSONB credits.confirmed_at uses an offset timestamp rejected by the UI's
strict ISO parser, hiding the saved connection after restart. Fixed with the explicit
Windows PowerShell path and UTC normalization at the database adapter boundary.
Models now refreshes visible connection status, shows pending/failure states, blocks
repeated pending sign-in, offers manual refresh, and waits for a successful list load
before offering Add. Browser callback no longer claims sign-in has already succeeded.

Executed: both regression checks failed before their fixes; connection/API/CLI suite
18/18 pass on disposable PostgreSQL; native DPAPI minimal-PATH save/read/delete 1/1
pass outside the sandbox; intercepted browser checks 5/5; TypeScript and targeted
format/whitespace checks; studio/native/NSIS builds. Installed update (exit 0) after
Jordan quit, reopened it, and confirmed installed/staged bundle-manifest SHA256
97720440cd44a24f5f95d371706257742d24ea3e6620607f2e3691d3f01a13eb. Existing real
connection now passes the actual UI schema. Sandbox rename/network failures were
environmental; rechecks passed outside those restrictions. Existing Vite chunk warning.

Jordan retried and confirmed Signed in. Installed API independently reports completed
sign-in with plan usage granted (2026-10-20T12:28:39Z); a separate process reopened
the DPAPI record and confirmed saved registration, access/refresh/ID tokens and
plan scope without printing credentials. Native restart itself was not repeated.
Request ledger reports zero model requests. Earlier failed registrations saved no
local IDs/tokens; their duplicate ChatGPT settings entries remain unchanged and
cannot be revoked with this connection's credentials. No real inference or model
verification request sent. Next eligible: separately approve the documented
one-request model verification; task qualification remains blocked.

## §2.2 / §2.4 — ChatGPT plan connection and Codex builder (October 20, 2026)

ADR-0042, migration 26, docs/MODEL_CONNECTIONS.md. Implemented and contract-verified,
not activated.

Works (against loopback stand-ins only): connection settings and caps with hash-bound
acceptance; dated credits-off confirmation; Sign in with ChatGPT (PKCE, state/nonce, ID
token signature and audience, refresh rotation, revocation on sign-out); DPAPI vault;
direct Responses adapter (store:false, streamed, client-side output cap, documented
`subscription_sharing_*` and `chatpass_v2_*` codes mapped to eligibility/quota/sign-in/
model states); one-in-flight and daily/run caps; one-shot verification grants (≤60
min); held-out qualification per task class; unknown-outcome reconciliation; API under
`/plan-connections`, `pnpm cli plan-*`, System → Models and connections. Codex builder:
relay, supervisor and bwrap jail, optional `codex_plan_builder` in a T12 build plan.

Executed (cloud Linux, PostgreSQL test DB): full suite 345 tests, 328 pass, 16 skip,
1 fail (`research-api` "research demonstration", uncaught "Connection terminated" from
the maintenance outbox during database teardown; passes 3/3 alone; code untouched by
this work). Changed files re-run: 48 tests, 46 pass, 2 WSL-gated skips. Codex host
tests ran the pinned 0.163.0 binary as root and as an unprivileged user: in-scope patch
lands, out-of-scope patch declined, function call, `tools.exec_command` and
`local_shell_call` each cut by the relay, and the hardened config alone still runs none.
Typecheck, web typecheck and format check pass. Codex 0.163.0 installed in Jordan's WSL
Ubuntu by scripts/install-codex-wsl.sh (both binary SHA-256 match the pin); on Windows
the 13 codex-host tests then passed 13/13 through the production WSL2 launcher.

Not done: registration/eligibility (needs Jordan's sign-in), credits confirmation, cap
acceptance, any live call, Codex install and native jail tests in Jordan's WSL, a
Codex-path verification and a `code_build` qualification (Path B stays blocked by
design). Next eligible: Jordan's backed-up upgrade to migration 26, sign-in, then the
bounded verification in docs/MODEL_CONNECTIONS.md once approved.

## Reset layout installed and checked natively — October 20, 2026

Rebuilt studio runtime, native release and unsigned NSIS installer; installed per-user
(exit 0), installed/staged manifest SHA256 matches. Existing app quit gracefully,
including PostgreSQL. Tauri packaging first failed DNS in sandbox, then passed with
network-enabled NSIS fetch. Existing checkout migration 25 required explicit owner
approval (given in chat); app saved pre-migrate-v24-2026-10-20T09-38-55-174Z backup
(database.dump 430138 bytes plus manifest) and upgraded 24→25 successfully. This
widens two provider constraints to include brave; no provider activation.
Updated installed app opened existing real workspace with persisted sign-in. Native
Monitor and Submit layout inspected: helper strip absent; Reset inside panel beside
Refresh on Monitor. Native temporary theme retained across Monitor/return; reset
confirmation opened; Keep fields preserved draft. Temporary text cleared without
submitting. Confirmed clearing remains browser-verified, not repeated natively.
Evidence and candidate hashes: tracking/evidence/reset-layout/result.json. No paid
calls, discovery submission, public release, credential or login preference changes.
App left running. Broader §2.1 setup/tray/login/restart acceptance remains incomplete;
next eligible prompt: finish those outstanding §2.1 checks, then §2.2 only if selected.

## Reset action layout refinement — October 20, 2026

Removed the draft-explanation strip and placed Reset page fields inside the panel's
upper-right corner, reserving room beside headings and Refresh. Narrow screens use
a separate action row inside the panel. Confirmation and retention are unchanged.
Executed: web TypeScript check, production Vite build, Impeccable detector (no
findings), 11/11 intercepted fixture-API draft/reset browser checks. Desktop render
inspected. Existing chunk-size warning remains. Browser harness file-root mismatch
required passing script code; local server required network-enabled execution.
The minimal Monitor fixture shows a contract error; live Monitor data is unverified.
No operational API/provider calls. Installer/native bundle not rebuilt for this edit.
Next eligible: rebuild/install candidate and finish native runbook §2.1 acceptance;
§2.2 only when separately selected. Preserve all other uncommitted work.

## Page-navigation draft loss repaired — October 20, 2026

Shared web/Tauri UI now retains visited page fields in current-workspace session
memory, restores sidebar record/query locations, and offers confirmed Reset page
fields. Hidden Monitor/Runs polling pauses. Workspace/session change and sign-out
discard retained forms; reload/restart recovery remains planned. Existing submit
handlers keep their success behavior; invalid submission preserves inputs.

Executed: browser fixture-API regression checks 11/11, TypeScript check, production
web build, studio resource bundle, native release and unsigned NSIS installer build.
Rendered confirmation inspected. Evidence and hashes: tracking/evidence/page-drafts.
No operational data/provider calls or install. The installed app needs this new
candidate: apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe.
Native interaction is pending; initial restricted NSIS download failed, network-enabled
retry succeeded. Production build retains chunk-size warning. Next eligible: install
and verify this candidate's drafts plus remaining §2.1 acceptance; §2.2 afterward
only when selected. This repair does not complete the broader draft/undo roadmap.

## Completion runbook §2.1 — installed desktop studio (October 20, 2026)

Branch claude/project-thread-b82rw9 from main 54ce751; ADR-0041; no migration (next free: migration 25, ADR-0042). Guide: docs/DESKTOP_STUDIO.md. Evidence: tracking/evidence/desktop-2-1.

Works: per-user NSIS install; launch from Start starts the whole studio without terminals, pnpm, dev server or checkout. Tauri supervisor owns one bundled Node service (production UI 5173, API with in-process workflow worker 4310, previews 4320) and, in managed mode, an app-owned PostgreSQL 18 cluster in %LOCALAPPDATA%\com.creatoragent.studio, using owner-installed PostgreSQL 18 binaries (verified prerequisite, not bundled). External mode reuses an existing loopback server and never starts or stops it. Listener ownership is HMAC-verified per launch before the window opens; single instance per home; job object; bounded restarts (3/10 min) and health watchdog; graceful Quit stops service then database. First-run setup window: adopt the §1.2 studio (T17 backup → restore into the app cluster → full restore check before saving; source only read), external connection, or explicitly labelled new studio; failed setup removes only what it created. Owner-approved, backed-up migrations. DPAPI-protected database secret and persisted local-owner sign-in (per-launch code never shown; revalidated each launch; revoked on sign-out). Close = quit (default) or background with tray; launch-at-login off unless toggled (HKCU Run only). Remote studio UI has no native IPC; control commands scoped to the bundled window. Child gets a minimal environment, so no live provider/key can leak in.

Executed: tsc build and web typecheck; studio service protocol tests 7/7 against source and against the installed bundle (disposable PostgreSQL 18): new studio, serve, sign-in, record survives quit/relaunch, stale code refused, sign-out revocation, port conflict, unreachable DB, backed-up upgrade 23→24, adoption with untouched source. Rust 16 pass/1 ignored (DPAPI round trip, config, HMAC RFC 4231, URLs, copy). Release build and NSIS installer built and installed silently. Scripted installed-app run 17/17 PASS: read-only adoption of the real creator_studio (Jordan’s Creator Studio, audit chain ok) into an isolated acceptance home; cold launch running in ~2 s; health/UI/previews; one owned service child; duplicate launch hands off; service crash restarted; WM_CLOSE quit stops service and database; relaunch; supervisor crash leaves no orphan and database is reused; foreign listener on 5173 and missing PostgreSQL folder give actionable failures. Two earlier failed runs retained (verbatim `\\?\` resource path broke Node; harness path matching).

Limitations: screen control was declined, so setup-window clicks, menu sign-in, creating a record in the window, tray/background and login toggles, and Windows restart are NOT executed natively (service-level equivalents pass). The agent shell runs inside the Claude desktop package, whose AppData writes are virtualized, so its install landed in the package's LocalCache: Jordan must install from the setup .exe himself. Paired execution worker identity still in memory (ADR-0028). Unsigned local build; NSIS tools downloaded by the Tauri CLI with hash validation. Bundled Node is the build host's v22.21.0. §2.1 is not complete until Jordan's interactive acceptance passes. Next eligible after that: §2.2 (new request).

## Claude handoff prepared — §2.1 (October 20, 2026)

Owner requested a handoff for Claude to implement persistent desktop startup. Copyable prompt and verified starting state: docs/CLAUDE_HANDOFF_2_1.md. Covers fresh studio adoption, production service lifecycle, secure identity, packaging, external dependency ownership, native acceptance and unchosen background/login preferences. Local uncommitted work must be preserved; use this checkout, not a cloud clone. Handoff formatted successfully; no §2.1 implementation, external message, commit or push performed. Next eligible work remains §2.1; §2.2 is outside this handoff's implementation scope.

## Milestone 1.2 — fresh studio adopted (October 20, 2026)

Owner authorized a separate fresh studio after the read-only fixture inventory. Candidate 5f7d22443e91f421197b3b0f9b1d3e623afc9edf. Created creator_studio (public, schema 24) on existing Docker PostgreSQL at 127.0.0.1:55433; product root C:/dev/creator_agent/.creator/studio/products. Existing creator_dev (schema 23), old products and OneDrive copy unchanged. No data imported or deleted. Initial real workspace created via authenticated HTTP: Jordan’s Creator Studio. Real labels do not establish live inference.

Executed: direct TypeScript build; all 24 migrations; repeated migration no-op; unauthenticated denial; local sign-in; workspace creation; API restart/readback; PostgreSQL 18 backup and restore into separate creator_studio_restore_20261020 and empty scratch product store; schema/audit/artifact/lineage/budget verification. Evidence tracking/evidence/studio-adoption/result.json. Empty artifact catalog means no affected packages to repackage. Backup and scratch retained privately under .creator/studio. Readiness still not_ready with no register problems; no integration activation. No browser/native interactive acceptance, paid call or public release. Initial pnpm wrapper stalled; direct installed tsc succeeded.

Start with scripts/start-local-studio.ps1; see docs/LOCAL_STUDIO.md. This explicitly selects the fresh target but remains development startup, not installed desktop lifecycle. Milestone 1.2 complete via owner-authorized fresh-start path. Next eligible: COMPLETION_RUNBOOK §2.1; not started automatically.

## Milestone 1.2 — read-only saved-data inventory (October 20, 2026)

Owner is open to a fresh studio; this turn authorized read-only inspection. Confirmed Docker creator-agent-local-db-1 healthy, loopback port 55433, database creator_dev, public schema version 23. Its only workspace is "Fixture discovery demonstration" (fixture mode); all 49 entities are fixture-labelled, 3 run controls, 39 usage records all source fixture, 0 studies and 0 catalogued artifact manifests. Current checkout .creator/products contains 40 product directories and 19 package manifests, all 19 with fixture_roles=true. Older OneDrive copy also has products; it was not changed. These observations support a fresh studio without losing implemented code, but do not prove every ancillary file or database row is disposable.

No database/artifact/configuration changes, migration, backup, restore, activation or live inference. Existing development database and files retained. No CREATOR environment configuration was present in this tool process; Compose documentation identifies the development connection, not an owner-confirmed operational deployment. Next eligible: confirm a separately named fresh studio database/product store, initialize schema 24, and execute backup/restore plus application verification appropriate to the fresh target. Milestone 1.2 remains incomplete; no automatic advance to 2.1.

## Completion runbook §1.1 — independent repair review (October 20, 2026)

U02 PASS for candidate 5f7d22443e91f421197b3b0f9b1d3e623afc9edf: no blocking findings in the four repaired audit boundaries. Separate review conversation; not blind. Report: docs/audits/U02_REPAIR_REVIEW_2026-10-20.md. All 14 bound source/test hashes match; migrations 1–23 unchanged. Scratch schema 23→24 upgrade, repeat apply, schema gate and record preservation passed. Focused PostgreSQL/contract checks 41/41 and QA secrecy checks 2/2 (including real WSL) passed; build/typecheck passed. Readiness remains not_ready, exit 3, no register inconsistencies. Evidence: tracking/evidence/u02-review.

Application code/configuration and existing tests unchanged. No operational database migration, provider activation, live call, spending or publication. Review-only PostgreSQL stopped. Existing runbook/tracking edits preserved. Next eligible: COMPLETION_RUNBOOK §1.2, requiring the owner's named operational database/artifact store and scoped adoption authority. No automatic milestone advancement; full product remains incomplete.

## Completion runbook and desktop/model direction — October 20, 2026

Added docs/COMPLETION_RUNBOOK.md with all five completion groups, owner steps,
copyable coding prompts and acceptance gates. Jordan requested launch-complete,
persistent desktop operation, clean model connections, Ollama-first local inference
and supported subscription-backed Codex/GPT access. These are recorded requirements,
not implemented features. Existing Tauri shell still requires separately started
services. Ollama executable exists; ollama list failed with local socket permission
error, so service/model availability and inference remain unverified. Official
OpenAI plan/app-server and Ollama docs consulted; eligibility and actual model access
remain to verify. No runtime code, provider activation, download, inference, spending,
operational migration or frozen protocol changed. Next existing gate: U02 review;
then select desktop lifecycle/Ollama work from the runbook. Documentation checks only.

## Codex audit repairs — October 20, 2026

Work continues in C:/dev/creator_agent, branch codex/audit-boundary-fixes, from main 1cf6d63. All four PR #40 findings are implemented: runtime-only QA mount plus legacy rejection; no unauthenticated invalid-signature receipt writes; processor observation epochs with network reads outside financial transactions; bounded streaming batch reads, durable file IDs, retryable post-reconciliation deletion and 48-hour orphan expiry. Migration 24, ADR-0040. See docs/AUDIT_FIXES_2026-10-20.md and tracking/evidence/audit-fixes for exact verification and remaining limits.

Verified: full pnpm check 302 tests / 287 pass / 0 fail / 15 skips; typecheck/format clean. Real WSL QA secrecy 1/1; final context 18/18 and uppercase audit-chain case 1/1; final API/cleanup regressions 3/3. Build/smoke pass; readiness honestly not_ready (exit 3, no inconsistencies). Intermediate failed runs retained and explained in the repair report. Migrations 1–23 checksum-identical; only disposable databases migrated to 24.

No paid/live runtime operation, protocol/owner decision change, deployment or activation. Existing deployment databases were not migrated. Next eligible: U02 independent review of the repair candidate; no automatic next milestone.

## Owner decisions after the 2026-10-20 audit (October 20, 2026)

Branch claude/audit-full-qgjinb from main fc1e83f; migration 23, ADR-0039,
docs/OWNER_DECISIONS_2026-10-20.md. Works: a $20 overall runtime ceiling
(config/spending.json) checked under one lock by every real paid dispatch and every final
study hold, counting open study attempts at their cap; any unknown-cost call blocks paid
dispatch. Device pairing has per-visitor and server limits on new and pending requests
(visitor = salted hash of the socket address, or the proxy-appended X-Forwarded-For entry
when hosted). Portfolio scheduler attempts and failures are durable, back off, stop a
workspace after 5 failures until the owner resumes it, and show in /api/health and
`pnpm cli portfolio`. Reinvestment can be allocated explicitly to a portfolio (non-
maintenance lanes only); nothing allocates automatically. scripts/move-out-of-onedrive.ps1
prepares the move out of OneDrive with a tested backup restore.

Executed (cloud Linux, PostgreSQL 16): pnpm check 290 tests, 277 pass, 0 fail, 13 WSL2/
native skips, format clean (tracking/evidence/owner-decisions-2026-10-20/check.log).
Not executed: the PowerShell move script (no PowerShell or Docker here); no live call or
spend. Development, hosting and marketing costs have no paid path in code, so the ceiling
cannot stop them.

## Audit 2026-10-20 (full product, T00–X10) fixes (October 20, 2026)

Branch claude/audit-full-qgjinb from main 051a9bb; no migration, no ADR. Report: project
file audits/2026-10-20-codebase-audit.md. Two contained fixes. X09 portfolio capacity:
each run counted every other unfinished workflow as active, so two runs over capacity
waited on each other and nothing leased; now only older unfinished workflows count, so the
oldest work proceeds and newer work waits (docs/X09_PORTFOLIO.md). X03 audit questions:
"after DATE" now excludes that day, like "before DATE" (docs/SEARCH_AND_AUDIT.md).

Executed (cloud Linux, PostgreSQL 16): pnpm check on main: 280 tests, 267 pass, 0 fail,
13 WSL2/native skips. With the fixes: 281 tests, 268 pass, 0 fail, 13 skips; format clean (tracking/evidence/audit-2026-10-20/check.log).
The new capacity test fails on the previous code (0 leases). `pnpm readiness`: NOT READY,
register consistent, 36 rows open, unchanged. `pnpm audit --prod` clean.

Note on older entries below: X08 and X09 were merged to main through PR #34, and the local
audit fixes through PR #35. Their "uncommitted / not pushed" wording describes the moment
they were written. Open recommendations (owner judgment): see the report (hosted rate
limits, reinvestment vs portfolio root, processor read inside a transaction, silent
scheduler errors, plus the still-open 10-19 items R1–R6). No live call, no spend; the
protocol freeze and study decisions untouched.

## X10 — full-product acceptance and readiness (October 19, 2026)

Claude Code, branch `claude/x10-1y6bd6` from main `a68e9f9`; ADR-0038, no migration,
docs/X10_ACCEPTANCE.md. Also removed leftover merge-conflict marker lines from the three
tracking files on main (both sides kept).

Works: `pnpm readiness` checks `config/readiness.json` (C01–C51 plus 15 integrations, six
separately recorded states each) against REQUIREMENTS.md and evidence on disk; verdict is
**NOT READY** with 36 rows open (no live model/source call, study unfrozen, GitHub/hosted/
payments/OIDC/outreach not live, paid ads/alerts/signed updates not built, C42 offline cache
unverified). `pnpm readiness pilot-check` refuses the owner pilot: every owner choice in
`config/owner-pilot.json` is empty and no account is live-verified and activated. The pilot
was not run. `pnpm bench` seeded 10,000 ideas / 100,000 audit events through the real store
in a disposable database and timed the HTTP API (p95: text search 410 ms, lineage 13 ms, cost
21 ms, event display 13 ms; synthetic workload, one client, cloud container). The first run
found lineage/cost at ~650 ms p95; the lineage walk now uses indexed per-hop lookups.
`scripts/release-archive.mjs` builds/verifies/extracts a commit-bound tar.

Executed: see tracking/evidence/x10 (bench runs, readiness report, full-suite log, release
validation). Limits: register is hand-maintained; no concurrent load, browser or Windows
measurement; nothing live, deployed, spent or sent. Next eligible: owner decisions listed in
the readiness report (pilot choices, model verification, RD1–RD10); no automatic milestone.

## Local audit fixes published for review — 2026-10-19

Preserves the original checkout while publishing its DNS cancellation, sign-out, stale actor request, and maintenance-health fixes with regression tests. Documentation cleanup and historical local tracking patches are retained. This PR is stacked on X08/X09; X10 is not started. Validation: typecheck, production build, formatting, and 15 focused regression tests passed. PostgreSQL/live activation was not rerun for this audit branch.

## X09 — portfolio scheduling and reviewed knowledge (October 19, 2026)

Implemented on `codex/x09-portfolio`, layered on local X08 commit `64596ef`.
Managed checkout remains `C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`.
X08 was hash-checked before committing; nothing was pushed. Original X05 dirty
checkout and Claude's parallel UI/UX work preserved. X09 changes are uncommitted.

Works through owner API, compiled CLI and the new Portfolio screen: separate
maintenance/improvement/exploration lanes; real maintenance budget allocation
checks; normal/conserve/maintenance_only/paused modes; review/feedback backlog,
capacity, reserve and health gates in shared admission/workflow/broker paths;
deduplicated interval jobs that coalesce missed periods; source refresh, private
archive health and bounded review workflows; cancellation and receipt-based
reconciliation without resend. Owner health deferral retains failure evidence.

Versioned components/lessons/prompts/skills retain provenance, permitted use and
executed structural regression evidence. Human review binds the exact hash;
activation/rollback uses expected-head concurrency. Reviewed guidance actually
enriches bounded workflow/task constraints without changing authority. Revocation
or stale provenance blocks new queued dispatch. Study attempts, human-only paths
and held-out material remain separate. Migration 22; ADR-0036;
docs/X09_PORTFOLIO.md.

Executed on Windows, Node 22.21.0 and dedicated disposable PostgreSQL 18.6:

- Focused X09 acceptance: **7 pass, 0 fail, 0 skip**, including actual HTTP/CSRF/
  compiled CLI, source broker, concurrent scheduling, low-fund/lane protection,
  backlog/health/modes, restart reconciliation, knowledge review/rollback/revoke.
  Initial fixture/schema/grant failures are retained and repaired, not bypassed.
- Final broader PostgreSQL suite: **270 tests, 256 pass, 0 fail, 14 explicit
  skips** (`full-tests.log`). Native/WSL opt-in and inverse-backend cases remain
  skipped; actual PostgreSQL backup/restore ran with installed client tools.
- Final TypeScript/web typecheck, production build, repository format check and
  diff whitespace passed. Vite retains its nonfatal >500 kB bundle warning.
- Actual isolated Edge: source scheduling pass, knowledge regression/review/
  activation, pause/resume, schedule cancellation and knowledge revocation.
  Desktop/narrow screenshots and accessibility snapshots retained; viewport and
  document widths both 390px in the observed narrow layout, with no alerts.

Limits: optional background polling implemented but off/unactivated; no live
model/source call, paid dispatch, public release, account change or real customer
validation. Health is archive integrity, not runtime uptime. Reusable skills are
bounded task guidance, not executable plugins; regression evidence is structural,
not measured quality gains. Budget identity rotation needs a new workspace in
this version. No existing studio database migrated. Next eligible prompt:
**X10 — Full-product acceptance and bounded owner pilot**, on request; inherited
hosted/live/operational gaps still apply and no pilot was started.

## X08 — campaign review and measured fixture feedback (October 19, 2026)

Implemented on `codex/x08-marketing` in the managed checkout
`C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`, from current merged
main `0dfc6e6`. Original X05 dirty checkout preserved. Claude owns the parallel
UI/UX redesign; X08 changes only its new screen plus small navigation wiring.

Works through authenticated API, compiled CLI and Campaigns screen: immutable
positioning/landing drafts, recorded demonstrations, pricing/channel hypotheses,
exact artifact/manifest/check evidence and audience provenance; hash-bound human
owner grants with zero adapter spend, caps and expiry; durable intent/native
fixture receipt, suppression/opt-out, deduplication, unknown-outcome reconciliation,
revocation/cancellation and distinct synthetic feedback counts. Changed content,
audience or experiment requires a fresh draft/grant. Stale evidence refuses sends.
Migration 21; ADR-0035; docs/X08_MARKETING.md.

Executed on Windows, Node 22.21.0 and disposable PostgreSQL 18.6:

- Final focused X08 HTTP/CLI/domain/DB plus X07/storage checks: **23 pass, 0 fail,
  0 skip** (`final-focused.log`). Earlier focused run: 13/13.
- Broader suite: **248 pass, 0 fail, 15 explicit skips, 263 tests**
  (`full-tests.log`). Skips include native/WSL opt-in gates, one inverse-backend
  case and unconfigured pg_dump discovery. This run began before final UI hash
  wrapping, CLI help and fixture-helper repairs; final focused checks cover the
  final helper, while final build/browser checks cover the final new UI.
- TypeScript/web typecheck and production build passed; Vite retains the
  nonfatal >500 kB bundle warning. Formatting/whitespace checks recorded alongside
  final source hashes in tracking/evidence/x08.
- Actual isolated Edge: signed-in Campaigns, draft/grant, simulated unknown,
  reconcile without resend, feedback and suppression; final snapshot and desktop/
  narrow screenshots retained. Final 390px viewport/document widths both 390px
  with the content hash and delivery history visible. No native acceptance claim.

Initial fixture failures retained and fixed without weakening immutability or
acceptance gates. Fixture records explicitly declare no real execution or customer
validation. Test-delivery acceptance is met; external delivery, paid ads, hosted
landing pages, real customer/demand research and live commerce remain unavailable
or unverified. No real outreach, paid call, release, account activation, commit or
push. Existing studio databases were not migrated. Next eligible prompt: **X09 —
portfolio scheduling, maintenance, and reusable knowledge**, only on request.

## UX/UI redesign: dark-default studio shell (October 19, 2026)

Claude Code, branch `claude/ux-ui-handoff-mfarlr` from main `0dfc6e6` (PR #32 included), from the
owner's handoff. Scope: `apps/web` only (also the desktop view). ADR-0037, docs/UX_UI.md. No
migration, API, contract, dependency or lockfile change. X08 (Codex) status is not affected or
claimed by this entry.

What now works (checked in headless Chromium against a fixture workspace):

- Dark theme on first paint for a fresh install with a light OS theme (checked with the app script
  held back); saved light choice survives reload; toggle back to dark.
- Semantic colour tokens for both themes; every text/status token is at least 4.5:1 on every
  surface (computed in the browser).
- Grouped sidebar navigation, breadcrumb, view-named document title, connection status in words,
  fixture-mode banner; drawer navigation at phone width (Escape/backdrop/link close it).
- All 15 views restyled through shared classes; Desktop and Operations show worker and check
  states as labelled badges (an unreachable synthetic worker shows "unreachable: not reporting").
- Fixed: a view's late focus request after the user left it pulled them back (Runs → Budgets).
  Fixed: the skip link rewrote the route hash; it now focuses the content.

Evidence: tracking/evidence/ux-ui (verification.json with source hashes, browser-acceptance.json
22/22 steps, before/after/check screenshots). `pnpm typecheck`, `pnpm format:check` and `pnpm test`
on PostgreSQL 16: 257 tests, 244 pass, 0 fail, 13 skips. `pnpm build` passes.

Limits: browser only; native Tauri/WebView2, screen reader and Windows high contrast not observed.
No dialogs exist to check. Fixture data and the T13 test double only.

## X06/X07 independent audit and repairs (October 19, 2026)

Audited merged main `8d44ace` in the attached worktree on `codex/x06-x07-audit`.
Original X05 checkout and its pre-existing local edits preserved. See
docs/X06_X07_AUDIT.md for findings, reproduction, fixes and limits; ADR-0034.

Repaired processor/account and rail double counting (migration 20), stale concurrent
observations, partial loss histories, credential account drift, non-USD posting,
partial-capture access, inconsistent balance arithmetic, low-sale fee deficits and
fresh-rail outage handling. Repaired omitted child-budget metrics and malformed
signed JSON handling. Hosted preparation now excludes private/generated build
inputs, owns fresh product storage, uses PostgreSQL 18 clients and bounds service
CPU/memory/processes/logs. No existing studio database migrated.

Executed on Windows with disposable PostgreSQL 18.6:

- Final exact-source focused X06/X07 checks: 24 pass, 0 fail, 0 skip, including
  API/CLI, concurrency and actual dump/restore. `final-focused-tests.log`.
- Broader suite during audit: 256 tests, 242 pass, 0 fail, 14 explicit skips.
  `full-tests.log`; completed before the final fee-deficit repair, subsequently
  covered by the final focused checks. This is not a final full-suite rerun.
- Final TypeScript/web typecheck, production build, Prettier and whitespace passed.
  Vite retains its nonfatal >500 kB bundle warning. Hosted Compose config validated
  with example-only environment values, without building or starting containers.
- Evidence in tracking/evidence/x06-x07-audit, with source/config hashes. Initial
  disconnected database attempt failed; subsequent database lifecycle stayed within
  each test session. The final test database was stopped.

Status remains partial: Docker daemon unavailable, so no image/fresh-volume startup,
actual hosted TLS/OIDC/staging verification or external monitoring. X07 remains
fixture/contract only, USD only, no observed Stripe call or live commerce. Migration
20 refuses pre-existing duplicate identities for explicit reconciliation; no silent
financial-history rewrite. No paid call, release, activation, commit or push.
Next eligible prompt: X08 on owner request; no automatic milestone advance.

## X07 — payments, entitlements, revenue and reinvestment (October 19, 2026)

Branch claude/x07-5zm23m from main 4fe3d33 (X05 merged); migration 19 (main with X06's
migration 18 merged in); ADR-0033; docs/PAYMENTS.md. Partial: implemented and verified with a
labelled fixture processor and a Stripe contract double only. No processor account,
credential or call; live payments are not built and need a separate owner decision.

What works: processor connections (fixture or Stripe test mode, fixture workspaces only;
live keys refused) verified against the configured account; offers bound to one verified
artifact manifest by id and hash; checkout sessions that grant nothing; an inert return
page; signed webhooks (Stripe-Signature, 5-minute tolerance) that only name objects, with
the payment or payout then read from the processor (503 and nothing recorded if it cannot
be read); an immutable double-entry ledger keyed by economic transaction with balanced
corrections (deferred balance trigger); fees, refunds, disputes (open, won, lost),
settlements and payouts; entitlements derived from verified payment state; owner seed
funding as non-earnings; reinvestment policy, tranches per settled payment, funding rails
(processor balance or owner attestation, with expiry), commitments, allocations bounded
by eligible tranches, surplus, usable liquidity and the period cap under a per-workspace
lock, partial allocations, and loss handling that reclaims idle reinvested envelopes or
freezes new allocations. API routes, webhook endpoint and CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL passed:
typecheck, 243 tests, 230 pass, 0 fail, 13 skips (opt-in WSL2/native gates), format clean
(tracking/evidence/x07/check.log). Baseline on main before X07: 234 tests, 221 pass, 13
skips. New tests: payments-domain (5), payments (3 DB acceptance incl. Stripe contract
double), payments-api (1 API + CLI); storage test updated for migration 19. Acceptance on
fixtures: forged, stale, live-mode and unsigned deliveries refused; processor outage
defers; duplicate event ids and distinct events about one charge post nothing new;
refund-before-settlement order converges; redirect grants nothing; refund revokes, open
dispute suspends, won dispute restores with a correction entry; payout failure reversed;
seed, pending and payouts add no capacity; unavailable or stale rails give zero capacity;
10 racing allocations consume exactly the tranche (3 won); refund after reinvestment
reclaims idle envelopes and freezes while a busy one holds authority. Mutation check:
with economic-key correction disabled the duplicate/out-of-order test fails
(evidence/x07/mutation-economic-key.log).

Limits: no live mode; no Stripe call observed (API version not pinned); no web UI; USD
only; no taxes, subscriptions or customer accounts; fixture processor state is in API
memory. Next eligible: X08 on request (X06 merged into this branch).

## X06 — hosted operation and observability (October 19, 2026)

Implemented by Claude Code on branch claude/x06-j2pz5g from main 4fe3d33.
Migration 18, ADR-0032, docs/HOSTED_OPERATION.md. Status: implemented and checked
locally; **no hosted environment exists and nothing was deployed or activated.**

What now works (checked):

- Explicit hosted mode (test/staging/live) with refusals for unsafe configs: non-https
  or path origins, preview host sharing or nesting the studio host, no build commit,
  relative product root, missing metrics token, dev login, remote DB without
  sslmode=verify-full. `NAME_FILE` secrets. `pnpm ops config-check`.
- Environment-labelled databases: API and worker refuse another environment's database;
  audited relabel of restored copies; relabel into live refused.
- `/api/ready` (503 when not ready), `/api/ops/status`, Prometheus `/api/ops/metrics`
  (owner session or read-only scrape token), `/api/ops/uncertain`; queue, worker,
  local-worker availability, budget, index, webhook and uncertain-outcome metrics;
  local alert rules (delivery fixed to none); web Operations view; Desktop view shows
  unreachable workers.
- Owner-recorded verification bound to commit + config hash + schema (stale on change);
  passing live record needs typed confirmation, also enforced in the database.
  `pnpm ops smoke` read-only smoke check of a declared target.
- Backups dump inside an exported snapshot with lineage fingerprint and exact budget
  totals; restore requires exact match. Cleanup of expired sign-in material (dry run
  default, audited). Hosted-to-local worker pairing (explicit, https only).
- deploy/hosted (Dockerfile, Compose, Caddy, env examples): `docker compose config` and
  `pnpm ops config-check` pass; images never built (no Docker daemon in the cloud).

Evidence: full PostgreSQL suite in the cloud container, 242 tests, 229 pass, 0 fail,
13 WSL2 opt-in skips (storage schema test re-run separately after bumping to 18). New
tests/src/operations.test.ts: 8 tests (hosted staging rehearsal through a stand-in proxy,
live confirmation, environment separation, cleanup, worker availability). restore.test
extended (totals, forged totals refused). Browser check of the Operations view against
a local API showed a synthetic unreachable worker and its info alert.

Limitations: no real hosted target, TLS, managed DB, OIDC provider, scraper or alert
channel; staging smoke only against loopback hosted processes; hosted desktop (Tauri)
sign-in not covered; product files still copied after the dump. Next eligible prompt:
X07 (in progress in its own thread) or X08; a real staging deployment is an owner decision.

## X05 local Windows acceptance passed (October 19, 2026)

Final release native menus and rendered shared UI passed local acceptance.
Sign-in invoked the OS browser handler; approval used the disposable fixture HTTP
owner seam, not personal login or live OIDC. Native Gallery download rehashed the
source. The original editor action failed visibly (owner confirmed); repaired
behavior exports a rehashed copy to Downloads and activates packaged Notepad.
The actual screenshot showed the selected artifact/workspace. Notepad UIA text
was stale from an older tab and was not used as passing evidence.

Native job 5c1b397f-fc07-4f95-8463-d7a9275089c2 completed through the real
outbound CLI and offline WSL sandbox. Native UI and shared owner API agreed on
the exact artifact/manifest and succeeded/exit 0 report (worker_report_only).
Visible pause/resume/shutdown changed states; explicit shutdown exited CLI 0.
Earlier native window-close observation left the separate worker polling.
Rust final tests: 4 passed, 0 failed, 1 explicit editor-probe opt-in ignored;
actual final editor menu was observed separately. Final release/NSIS rebuilt.
Previous real native/WSL tests (2 pass), paired fault tests (3 pass), Windows
cache tests (3 pass) and installer fixture lifecycle evidence remain scoped to
their recorded candidates; no acceptance assertions were weakened. Earlier full
suite: 223 passed, 0 failed, 14 opt-in skips. Fixture hold harness is skipped,
not an automated acceptance pass. Final typechecks/format/whitespace recorded
with source and release hashes in tracking/evidence/x05.

See apps/desktop/INTERACTIVE_ACCEPTANCE.md and native-ui-acceptance.json.
Local Windows acceptance is complete; production signing, signed automatic
updates, live OIDC and other hosts remain unverified/disabled. No paid call,
public release, account activation, commit or push. Existing dirty work retained.
Next eligible prompt: X06 — hosted operation and observability; not started.
Earlier continuation entries below are historical evidence, superseded here.

## X05 acceptance attempt - native Computer Use stopped (October 19, 2026)

Supported @oai/sky Computer Use was available; earlier claims that no native path
was available were too broad. Actual release window rendered the shared UI and
native menu. Sign-in menu opened the local approval page through the OS browser
handler and displayed comparison code 538F1524. No user authentication dialog
was automated. Opera access initially timed out; owner approved access. Subsequent
capture required restoring its minimized window, then the helper stopped the
turn because it could not determine the current browser URL confidently enough
to enforce policy. No further UI input issued. Acceptance remains open; editor,
authenticated native navigation and visible job checks not completed this attempt.
Disposable fixture shutdown requested; test fixture mode is explicitly skipped,
not counted as an automated acceptance pass. No personal Notepad documents edited.

## X05 continuation - actual worker faults and local installer lifecycle (October 19, 2026)

Real paired lifecycle acceptance passed 3/3 with no skips (paired-lifecycle-final.log).
A dedicated synthetic artifact explicitly declares its long-lived test path and
passes real package QA. Tests observe the detached child in Linux /proc before
revocation or killing the actual outbound CLI. Revocation cancels parent/child,
records inactive cleanup and exits the revoked worker. Crash leaves no report;
actual lease expiry yields reconciling, blocks new work and never redispatches.
Owner API reconciliation binds the stopped local outcome hash. Synthetic review
is labelled fixture, not independent review or empirical validation.

Pinned Tauri CLI 2.12.3; added opt-in NSIS current-user bundle configuration with
no WebView installation, no automatic updater and downgrade refusal. Separate
acceptance identity/version installers verified native startup after baseline,
upgrade and explicit uninstall/reinstall rollback. Silent downgrade refused with
unchanged executable. Fixture uninstalled. See windows-installer-acceptance.json
and windows-installer-final.log; unsigned debug fixtures, not production signing.
Earlier failures retained: signal-killed test-child cleanup awaited a second close;
first installer upgrade returned 2; two subsequent runs passed after adding an
executable-write-access barrier. Final lock observations were zero, so its cause
is not confirmed.
No acceptance assertions weakened. Release-mode unsigned NSIS build passed
(windows-release-bundle.log); fixture install lifecycle used debug builds. Orphan disposable DB from interrupted first
run matched to retained fixture product before removal. Default bundling remains
off; production local bundle requires explicit configuration. No paid call,
public release, signing key, account integration, automatic update, commit or push.

Native functional gates now cover pairing/sign-in, source download, real paired
launch, window/worker separation, active-process revocation and crash reconciliation.
Local manual installer/update/rollback gates passed on this observed host.
Interactive native UI/editor/default-browser-handler checks (apps/desktop/INTERACTIVE_ACCEPTANCE.md) and live OIDC/signing
remain unverified. Other Windows hosts/architectures are unverified. Next eligible
work: finish X05 interactive acceptance; X06 not started. Earlier suite evidence
(223 pass, 0 fail, 14 opt-in skips) remains for the prior runtime candidate; this
continuation changes tests, packaging configuration/dependency and probe selection.
Final TypeScript project/web checks, Rust tests 3/3, formatting and whitespace
checks passed. Source hashes: lifecycle-candidate-sha256.json. Release executable
and installer hashes/signature status: windows-release-artifacts.json.

## X05 continuation - bounded paired jobs and native handoff (October 19, 2026)

Migration 17 adds owner/API/UI/native paths for exact artifact jobs on explicitly
execution-capable paired workers. Code enforces immutable idempotency, one-time
leases, pre-dispatch admission, artifact/profile binding, fixed offline sandbox
limits, bounded concurrency/rate and cancellation/fencing. Reports remain
`worker_report_only`, with full evidence retained locally. Unknown outcomes block
new workspace jobs until explicit observed-stop reconciliation. Existing presence
pairings gain no authority. No paid call, deployment, account activation, commit or
push. Existing audit edits preserved.

Native queue -> outbound CLI -> reviewed WSL2/bubblewrap/systemd execution passed
(2/2, no skips; native-paired-wsl-final.log): exact archive/output, inactive cleanup,
worker alive after window exit, then explicit shutdown exits worker. Underlying
real detached-child cancellation and killed-supervisor reconciliation passed 2/2
(real-worker-stop-reconcile.log). Native browser approval in isolated Edge
authenticated the Windows WebView using ordinary and Secure cookies, with separate
browser/desktop sessions (native-signin*.json). Fixture identity; no live OIDC or
personal browser-handler claim. Corrected debug instrumentation; prior failure
recorded in native-signin-probe-diagnosis.md. Windows cache checks passed 3/3 after
sandbox junction creation denial required an unchanged elevated rerun. Rust 3/3,
TypeScript project/web checks and production web build passed. Vite retains its
nonfatal bundle-size warning.

X05 remains partial: interactive native UI/editor/default-browser acceptance,
paired running revocation/crash reconciliation and installer/update/rollback
checks remain. Bundling and updater activation disabled. Next eligible prompt:
continue X05; X06 is not started. Integrated PostgreSQL suite: 237 tests, 223 passed, 0 failed, 14 explicit opt-in
skips (paired-integrated-tests.log). Real native/WSL gates ran separately as above.
Formatting and diff whitespace checks passed. Current source hashes are in
paired-candidate-sha256.json; earlier evidence is retained for its prior candidate.

## X05 — native build, sign-in and paired presence controls (October 19, 2026)

Owner installed Rust/Cargo and confirmed X03/X04 finished. Verified Rust/Cargo 1.99.1,
Windows MSVC toolchain, Visual Studio 18 C++ Build Tools and WebView2 155.0.4283.62.
Fast-forwarded this checkout to origin/main ddf7bcf (X01–X04); restored all local
audit/X05 edits from a retained stash, retaining both sides of tracking conflicts.
No new commit, push, paid call, hosted deployment or account activation.

Tauri shell now builds and starts natively; missing Windows icon fixed and Cargo
lockfile retained. Native menus implement proof-bound system-browser sign-in,
authenticated selected-artifact source download with exact manifest/archive hashes,
and opening only the last downloaded manifest in Notepad. Private preview tickets
open only on T13's separate origin in the system browser; no generated source is
extracted/executed on the desktop. No native IPC granted to remote web content.
Raw manifest export added to existing owner/hash-bound artifact routes.

Migration 16 and shared contracts/API/UI implement durable five-minute one-time
challenges, session-bound browser approval, separate revocable desktop sessions,
hashed/revocable/expiring workspace worker identities, scoped 30-second presence
leases and control fences. Shared Desktop and workers view offers refresh and
pause/resume/shutdown/revoke. Outbound worker CLI holds its token in memory only.
Presence-only leases grant no dispatch, artifact-read, model or budget authority.
Window close, shutdown request, lease expiry and observed process exit are distinct.

Executed: TypeScript project/web checks and production web build; locked Cargo
check/build and 3 Rust tests; 3 Windows Node cache tests; 11 focused DB/HTTP/storage
checks; actual Windows WebView startup and authenticated native source download
(2 fixture-backed checks; manifest/archive hash readback). Imported X04 Git test
failed on POSIX mkdir/file URL assumptions, repaired with Node portable setup;
all 4 Git/REST domain checks then passed unchanged assertions. Initial integrated
run preserved as failed evidence (221 pass, 1 fail, 13 skips).
Final integrated PostgreSQL suite: 236 tests, 222 pass, 0 fail, 14 explicit native/WSL opt-in skips (final-integrated-tests.log).
Formatting and diff whitespace checks passed. Final runtime source hashes are in
tracking/evidence/x05/candidate-sha256.json; logs are in that evidence folder.

X05 remains PARTIAL. Native browser approval/editor interaction, OIDC secure-cookie
path, actual bounded job dispatch to paired workers, native-to-real-worker launch
and revocation, and installer/signed-update acceptance remain unverified/incomplete.
Native download fixture used test-double execution; it is not isolation evidence.
No installer/updater or background service activated. Next eligible: continue X05;
no automatic X06. Commands and trust assumptions: apps/desktop/README.md.

## X04 — scoped GitHub management (October 19, 2026)

Branch claude/x04-gm7n32 from main d2c8ef1; migration 15 (after X03's 14,
merged in); ADR-0027; docs/GITHUB.md. Partial: implemented and verified against a
deterministic fixture GitHub and loopback contract tests only. No live GitHub call, no
credential configured, no repository created on github.com.

What works: connections naming one owner by immutable id, one credential reference
(GitHub App installation or fine-grained token, by environment variable name only), limits
and required checks; owner verification before anything else runs; managed repositories
by immutable id (renames followed; another owner or public visibility quarantines);
existing repositories only when listed by id; an operation journal (intent before call,
settled once, unknown until reconciled by reading GitHub); four admitted action types
(github.repo_create, github.write, github.workflow_change, github.merge) with the intent
hash as spec_hash; prefix, repository-count, hourly-change and open-PR limits; pushes of
exact local commits without force from the same workspace's product only; exact-head
merges (live head = reviewed head, independent approving review, every required check
succeeding on that head, sha sent to GitHub); verified, deduplicated webhooks that only
remove access; live off unless CREATOR_GITHUB=live. REST adapter on API version
2026-03-10 with per-call installation tokens scoped to one repository and the
endpoint's permissions. API routes, a webhook endpoint and `github-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 221 tests, 210 pass, 0 fail, 11 skips (real WSL2 gates, opt-in); format
check then flagged only docs/GITHUB.md (written during the run), which was reformatted
and re-checked clean (tracking/evidence/x04/check.log, format-recheck.log). New tests:
github (4 DB acceptance), github-domain (4: rules, two REST contracts, Git push
contract), github-api (1 API + CLI); storage test updated for migration 15.
Acceptance gate on fixtures: wrong owner stays unverified and sends nothing; stale base,
stale head (before and during merge, 409), missing/pending/failed checks, missing or
self-review all refused; unknown creation, push and merge reconciled from GitHub with no
retry while unknown; GitHub 401, owner revoke, recorded token expiry, lost repository
scope and a publicized repository all stop calls; live off and missing grants send
nothing in a real workspace. The stale-head check was confirmed to fail when its rule is
disabled. After merging X03 from main (61aa2d8), pnpm check passed again: 228 tests,
217 pass, 0 fail, 11 skips, format clean (evidence/x04/merge-x03-check.log). No WSL2
run needed.

Limits: no live verification (needs an owner-created GitHub App or fine-grained token,
CREATOR_GITHUB=live and grants); the API binds to loopback, so live webhooks need a
local forwarder; no releases, repository settings, secrets or branch protection; issue
and PR reconciliation match by title or head branch; no web UI. Next eligible: X05 on
request, or remaining T15/T16 work once the protocol is frozen.

## X03 — search, lineage and audit questions (October 19, 2026)

Branch claude/x03-s7po1x from main d2c8ef1; migration 14; ADR-0026; docs/SEARCH_AND_AUDIT.md.
Partial: implemented and verified in fixture workspaces only. No live call, no spend.
No real embedding model is verified, so real workspaces refuse semantic search; the
fixture embedding (character trigrams) supports no relevance claim.

What works: lexical search now also covers code versions (artifact commits and
manifests), models called and cost records (reservations with amounts), with local-date
filters in an IANA zone, per-hit local time, per-type coverage (searchable, redacted, no
text, unsupported or oversized media) and activity freshness; saved searches and saved
questions that re-run under the caller's current access; semantic search as an
access-safe lexical stage plus one metered `model.embed` broker call per text, replayed
without paying for a repeated operation id; natural-language audit questions compiled
into one of eight fixed read-only plans (rules compiler, or a metered model compiler whose
JSON must pass the strict schema), run in a read-only transaction with a 5 s timeout;
source-to-product, lineage, run cost, subject cost (shared runs counted once), decisions,
activity, redactions and model usage answers with their supporting record ids; bounded
lineage graphs with truncation flags, tombstones and source media status; lineage
exports with a canonical SHA-256 and verification (tamper, missing, version change,
redacted since, retracted links); owner-only member removal (audited). API routes and
CLI commands (`search --from/--to/--tz`, `search-semantic`, `saved-query-*`, `ask`,
`ask-model`, `audit-plan`, `lineage-graph`, `lineage-export`, `lineage-verify`,
`member-add`, `member-remove`); the web search page shows the new types, amounts and
coverage.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 219 tests, 208 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check clean (tracking/evidence/x03/check.log). New tests: search-domain (4),
search (2 DB acceptance), search-api (1 API + CLI); artifact-api now also finds a verified
build by commit prefix; storage test updated for migration 14.
Acceptance gate on fixtures: "Which sources does product … come from?" and "Which
products use source …?" return the sources, claims and link ids on the path; "How much
did run … cost?" equals the settled reservations and lists their reservation and usage
ids; two products sharing a run total once (shared_runs 1) while each product's row
includes it; injected questions (`'; drop table …`, quoted SQL in titles) compile only
to bound ids or titles, a plan with `sql` or a bad zone is refused, a write inside the
plan transaction fails with PostgreSQL 25006, and entities and the audit chain are
unchanged; after removal, viewer, editor and outsider get NOT_FOUND from search,
questions, semantic search, saved queries, lineage, export and verify; after redaction,
the source no longer matches text or semantic search, appears only as a tombstone in
answers and graphs, cannot be named by title, and an earlier export is flagged
`contains_redacted_text`. No WSL2 run needed.

Limits: no real embedding model or live compile call verified; embeddings are not stored
(each new search pays again; pool at most 40); access is workspace-level only; saved
queries, questions, semantic search and lineage graphs have no web UI; the rules compiler
is English and pattern-based. Next eligible: X04 on request (being built in parallel), or
remaining T15/T16 work once the protocol is frozen.

## Audit 2026-10-19 (T14–X02) fixes (October 19, 2026)

Branch claude/audit-x02-iois7j from main 6ffb0e6; no migration, no ADR. Report:
project file audits/2026-10-19-codebase-audit.md. Three contained fixes: `parseRatings`
reads ratings.csv as RFC 4180 records (quoted notes with line breaks no longer break
`pnpm analyze`); `context-index` skips symbolic links and junctions (nothing outside the
named folder is indexed, no ELOOP crash); `pnpm evaluate` and `pnpm pilot` refuse a
non-empty output folder so the only copy of the blinding key is never overwritten.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 212 tests, 201 pass, 0 fail, 11 skips (real WSL2 gates); format check
clean (tracking/evidence/audit-2026-10-19/check.log). The new link and multi-line-note
checks fail on the previous code. evaluate/pilot reruns into a used folder exit 2;
scripts/t19-rehearsal.mjs still passes on rerun.

Open recommendations (owner judgment): working folder inside OneDrive syncs private study
files, backups and the CLI session; the $20 ledger covers study attempts only; OpenAI batch
files are never deleted; study export repeats the workspace audit log per attempt; backups
are unencrypted. No live call, no spend; the protocol freeze and study decisions untouched.

## X02 — context selection, caching, compaction and batches (October 19, 2026)

Branch claude/x02-b3wzes from main c738369; migration 13; ADR-0025; docs/CONTEXT_AND_CACHING.md.
Partial: implemented and verified in fixture workspaces only. No live call, no spend;
gpt-6-astra's prompt caching, batch and compaction stay `documented`, so real
workspaces refuse them until verified. No savings are claimed.

What works: incremental index of code/note/source corpora and workspace records
(version bump on change, explicit and snapshot removals); immutable context packs with
application-derived authority, pinned constraints/objections/acceptance criteria and
required facts, per-item provenance and exclusion reasons; extractive, model (metered)
and provider compaction, each verified to keep pins verbatim and every required fact;
reusable handoffs that go stale when a source changes; a result cache separate from
provider prompt caching, keyed by scope and version, invalidated by dependency
changes, re-admitted on every hit (revoked grant refuses), never read by study runs;
capability registry per model and feature; batches with all-or-nothing reservation at
the batch price, per-item settlement, expiry release, unknown-then-late settlement;
quality-and-total-cost evaluations including compaction overhead; a usage report whose
figures list their reservation and operation ids. Broker ContextService, fixture and
OpenAI batch adapters, API routes and `context-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 212 tests, 201 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check clean (tracking/evidence/x02/check.log). New tests: context-domain (7,
incl. the OpenAI batch loopback contract), context (6 DB acceptance), context-api (1
API + CLI); storage test updated for migration 13.
Acceptance gate on fixtures: model-compacted pack answers 2/2 questions like the full
pack (quality maintained, compaction overhead counted) while a starved pack fails
(`not_claimed_quality_drop`); pins, authority and facts survive extractive and model
compaction, a lossy compactor is rejected naming the lost facts, opaque provider
compaction is refused; cache hits, dependency invalidation, revoked-grant refusal and
workspace isolation verified; usage figures trace to reservations and source
operations. No WSL2 run needed.

Limits: no live verification of the OpenAI batch adapter or of prompt caching; no
provider compaction adapter; packs and caching are opt-in per call and not yet used by
workflow, study or builder paths; no web UI; the quality check uses a small synthetic
question set. Next eligible: X03 on request, or remaining T15/T16 work once the
protocol is frozen.

## X01 — model registry and qualified routing (October 19, 2026)

Branch claude/x01-qfktko from main 8c09748; migration 12; ADR-0024; docs/MODEL_ROUTING.md.
Partial: implemented and verified in fixture workspaces only. The prerequisite
"measured task outcomes" does not exist (T15 not run), so no real model is qualified
beyond the reference baseline and no quality or savings claim is made.

What works: versioned registry (config/routing) with pricing hashes; fixed/auto/economy
route policies per workspace or project; immutable route decisions naming policy,
registry and pricing versions and every candidate's reason; hard-constraint refusal
(availability, action, task class, tools, data class, context, latency); held-out
benchmark scored by the store from broker reservations; shadow, capped deterministic
canary, owner advancement that cannot override a failing gate; automatic rollback on
canary/post-promotion outcomes below the floor and owner rollback; objective-only
escalation to the baseline; cost per accepted result including failed, review, repair
and tool operations; broker callRouted/callModel; API routes and `route-*` CLI commands.

Executed (cloud Linux, PostgreSQL 16): pnpm check with CREATOR_TEST_DATABASE_URL:
typecheck passed; 198 tests, 187 pass, 0 fail, 11 skips (real WSL2 gates, opt-in);
format check then flagged only docs/MODEL_ROUTING.md, which was reformatted and
re-checked clean (tracking/evidence/x01/check.log, format-recheck.log). New tests:
routing-domain (8), routing (2 DB acceptance), routing-api (1 API + CLI).
Acceptance gate on fixtures: decisions carry policy/model/price versions; privacy-
incompatible, unsupported, unverified and unqualified fixed routes are refused and
recorded; the cheap-but-unreliable fixture model (4/8 held-out) is rejected though
cheaper; promotion of the reliable fixture model, automatic and manual rollback back
to the baseline all verified. No live call, no spend, no WSL2 run needed.

Limits: gpt-6-astra stays `documented`, so real workspaces cannot route until an
accessible id is verified; routing is opt-in per call and not yet used by workflow,
study or builder paths; no web UI; fixture models and benchmark are synthetic.
Next eligible: X02 on request (prerequisite X01 now implemented), or remaining T15/T16
work once the protocol is frozen.

## PR publication validation (October 18, 2026)

Owner requested a PR for all pending work. Branch: codex/t18-t19-thesis-archive.
Integrated origin/main at 3e9026f while retaining the T15/T16 and T18/T19 tracking
records. Includes the RD6 owner update, thesis packet, reproducibility archive,
optional acceptance recorder, lease-aware recovery test and existing T17 log.
Generated T18 fixture private assignment keys/raw exports remain local and ignored;
credentials, ignored verification directories and product stores are excluded.
Evidence paths preserve original bytes through Git; archive checksum and all twelve
T18 copied-source hashes verified against committed blobs.

Executed on integrated candidate: pnpm check passed (94 pass, 0 fail, 93 skips because
database/real-isolation gates are not configured in this invocation), including
typecheck and format check. Log: tracking/evidence/t19/pr-publication-check.log.
No DB/WSL rerun in the publication step; prior T19 full-run failure and focused
repair checks remain explicitly recorded. No empirical study, protocol adoption,
committee acceptance or application activation is implied. PR publication is now
authorized; the earlier no-push entries describe their historical milestone runs.

## T19 — reproducibility archive and conditional acceptance (October 18, 2026)

Prepared docs/thesis/T19_ACCEPTANCE.md and tracking/evidence/t19/WALKTHROUGH.md.
Source is fixed upstream 3e9026f with separately hashed documentation/scripts and
two test-only overlays; local HEAD 38b3e46 and prior owner edits are preserved.
No source merge, commit, push, public release, contact, paid call or recruitment.

Fresh cached install succeeded. Full PostgreSQL 18.6 + real WSL suite: 187 tests,
185 pass, 1 fail, 1 expected no-worker skip. The process-restart recovery test
observed running at its polling deadline. Original focused test passed; inspection
found its 20-second wait shorter than a possible 30-second killed-worker lease.
Test-only lease-aware deadline repair passed the focused integration; all success
and exact-call assertions remain. Full suite was not repeated after test-only
changes. Failed log and diagnosis are retained, not relabelled as green.
Latest study-build WSL gate passed. Typecheck and built web/proxy/API smoke passed.

The optional artifact acceptance recorder passed with the real worker, preserving
original/revised generated package bytes, manifests, same-workspace lineage/search
and incurred-budget inspection. The fixture CLI explicitly replaces the discovered
clinic spec with the reviewed checklist template; no arbitrary synthesis or clinic
validation claim. Fresh A/B/C + discovery rehearsal: 26 slots, 10 evaluation and
12 analysis checks pass; no independent ratings and data remains not_empirical.
Private keys/raw exports stay in ignored verification directories.

Archive tooling: scripts/t19-archive.mjs verifies upstream Git blob identities,
per-file SHA256, exclusions, extraction and tamper refusal. scripts/t19-rehearsal.mjs
recreates synthetic study/analysis on its own disposable database. Final archive
readback and extracted install/build smoke are recorded externally in
tracking/evidence/t19/release-validation.json after construction. Distribution
files are creator-agent-t19.tar and its .sha256 sidecar in that evidence directory.

T19 packages the engineering thesis under the retained missing-data limits; it does
not establish academic acceptance. T15 final participant evaluation and T16
empirical analysis remain incomplete; comparative protocol proposed/unfrozen,
RQ1–RQ3 unanswered, academic dates/committee decisions unconfirmed. Next eligible
work is an owner-selected remaining committee/research acceptance item; no automatic
X milestone. Existing DB services left as found; test harnesses close their temporary
processes/databases. See verification.json for exact checks and limitations.

## T18 — review packet under documented missing-data allowance (October 18, 2026)

Prepared docs/thesis/README.md, THESIS_DRAFT.md, EVIDENCE.md,
COMMITTEE_REVIEW.md and DEMONSTRATION.md. Reviewable engineering draft with
architecture, methods, executed software results, unavailable empirical tables,
limitations, RQ1–RQ3 unanswered, concrete decisions/revisions and fixture backup.
No committee response, approved academic schedule or final empirical result claimed.

Fetched origin/main 3e9026f (T15/T16 merged) and inspected/built an archive at
.verification/t18-source. Local HEAD remains 38b3e46; existing edits preserved,
no merge/commit/push. T15 final evaluation and T16 empirical analysis remain partial;
only their machinery and fixture checks are implemented. T18 uses its explicit
missing-data route, not a retrospective protocol adoption.

Executed on Node 22.21.0: pinned pnpm 11.25.0 cached install (required sandbox
escalation for package-store access), TypeScript build, analysis tests 8 pass,
0 fail, 1 DB skip; three synthetic analysis scenarios, 12 checks pass each.
Logs, rerun outputs, source copies and hashes: tracking/evidence/t18.
Initial sandbox install and a later sandbox Corepack version probe failed on
store/network access; the escalated cached install and subsequent build succeeded.
No database, live model, paid call, participant evaluation, full product demo,
recruitment, sending or publication in T18. Historical WSL checks are not a latest
study-build gate. No source runtime or study policy changed.

Next eligible prompt: T19 on a new request, retaining missing-data limits; final
academic acceptance and empirical completion cannot be claimed. Empirical path:
record RD decisions/IRB determination and dates, adopt protocol/analysis rules,
verify model/pricing/runtime allowance and latest study worker, execute final runs,
obtain independent ratings, then analyze. Full clean reproducibility is T19 work.

October 18, 2026 owner research decision: RD6 now records GPT-6 Astra and a
$20 USD total T15 live budget in docs/PILOT_AND_PROTOCOL.md. API identifier/access,
pricing and enforced runtime configuration remain unverified. Documentation-only
update; no live calls, adopted freeze or evaluation run. Next eligible: resolve
remaining T14 decisions and verification prerequisites before freezing, then T15.

T16 implementation update, October 18, 2026 (Claude Code, branch claude/t16-analysis-95avhe from
main 479dba4; ADR-0023; no migration): **analysis pipeline built; empirical T16 blocked.** No
final run, rating or outcome exists, so nothing was analyzed for real and no finding, power or
comparative result is reported. Added `pnpm analyze <evaluation-dir> <out-dir>`: reads the T15
package, private key, raw study exports and reviewers' ratings.csv; writes analysis.json,
report.md, CSV tables and SVG figures (completion over all assigned slots, decision quality
without imputation, functional completion, task-level paired and per-theme discovery
comparisons, exact-money resources with undefined or lower-bound cost per accepted outcome,
human effort and latency, interventions, evidence validity, two-reviewer kappa and
disagreements, deviations, exploratory per-protocol completion). Checks: slot/attempt/export
reconciliation without join multiplication, rating-code validity, privacy, identical reruns
and no comparative wording. Empirical status is derived from the inputs. Verified on three
labelled synthetic fixtures (`pnpm analyze fixtures`, outputs in tracking/evidence/t16/fixtures)
and on a real T15 rehearsal package. Cloud `pnpm test:db`: **187 tests, 176 pass, 0 fail, 11
WSL skips** (tracking/evidence/t16/test-db.log). Real-data inputs: docs/ANALYSIS.md.

T15 prerequisites update, October 18, 2026 (Claude Code, branch claude/t15-hdrwqz on top of
ADR-0021; ADR-0022; migration 11): **T15 still partial; protocol not frozen, no final run, no
live call or spend.** Added `config/evaluation.json` (owner preference `gpt-6-astra`
unverified, live off, $20.00 total T15 cap, RD3/RD4/RD5/RD8 unresolved); a final-record gate
that creates non-synthetic studies only when the adopted freeze answers every governance item,
the verified model matches config and the cap is $20 (today it refuses, listing each unmet
condition); a study budget ledger that holds each attempt's full cap before model work; and
builder-backed implementation attempts (A/B through the T12 builder in per-attempt products,
C refused the builder with its code checked server-side against every frozen case). Verified
on labelled synthetic records with the test double: exact spec/task/file hashes, condition
isolation, human-only denial, budget refusal, cancellation retention, mismatch refusals,
held-out cases kept out of role packets and records. Cloud `pnpm test:db`: **178 tests, 167
pass, 0 fail, 11 WSL skips** (one new opt-in WSL2 study-build test, not yet run on Jordan's
machine). Evidence: tracking/evidence/t15/study-build-tests.log.

T15 update, October 18, 2026 (Claude Code, branch claude/t15-hdrwqz from main 3f3544a;
ADR-0021; no migration): **final evaluation not run, because the protocol is not frozen.** Built the
final-evaluation machinery: schedule from the adopted freeze and owner tasks, deterministic
slot admission, a run ledger where every slot is listed (blocked, deferred, missing, or
attempt states, with RD10 retries kept), and blinded per-reviewer packets with a leak scan, a
private key and raw exports (`pnpm evaluate rehearsal|final`, docs/FINAL_EVALUATION.md).
Rehearsal on 8 synthetic tasks (26 slots, fixture AI, scripted labelled humans): 10/10 checks
pass. `pnpm evaluate final` refuses without a freeze and lists RD1-RD10; with a freeze every
slot is blocked (synthetic-only study records, no verified live model, AI implementation not
wired to studies). Cloud `pnpm test:db`: **174 tests, 164 pass, 0 fail, 10 WSL skips**.
Evidence: tracking/evidence/t15.

T17 update, October 18, 2026 (Claude Code, branch claude/project-thread-k4si82 from main
e46b2cf; ADR-0020; built in parallel with T14): requirements-to-evidence report for C01–C51,
S01–S18 and the T17 priority risks in tracking/evidence/t17/REQUIREMENTS_EVIDENCE.md. New
local backup/restore (`pnpm backup`, docs/BACKUP_AND_RESTORE.md): a restored database and
product store pass the audit chain, artifact hash, catalog search, lineage and exact-byte
download checks through the real API, and tampering is refused. Fixed: a child overrun now
counts against every ancestor; `/api/health` reports configured live adapters; preview stdin
survives split UTF-8; workflow lease heartbeats work (an ambiguous SQL column had made every
heartbeat fail silently, so long calls were redelivered). Cloud `pnpm test:db`: 162 tests,
152 pass, 0 fail, 10 WSL skips; after merging T14, 168 tests, 158 pass, 0 fail, 10 WSL skips.
Real WSL2 gate on Jordan's Windows machine (reported by Jordan, October 18, 2026, on merge commit 38b3e46): `CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` 168 tests, 167 pass, 0 fail, 1 skip (the no-worker test, which always skips where the worker exists, so the restore test ran there). No critical blocker found; not production-ready or live.

T14 update, October 18, 2026 (Claude Code, branch claude/project-thread-ocgg8g from main
e46b2cf; ADR-0019): `pnpm pilot <dir>` runs a pilot rehearsal (arms A, B, C on one fictional
decision task plus one structured/open-ended pair) through the real study path, with fixture
AI and scripted, labelled human entries. Checks: 16 pass, 1 warn, 0 fail; reproducible digest
stable across databases. Blinded reviewer packet, feasibility estimate, pilot report and
proposed final protocol in docs/PILOT_AND_PROTOCOL.md. The owner-only freeze route refuses
until 10 research decisions (RD1-RD10) are answered; **protocol not adopted**. Cloud
`pnpm test:db` **164 tests, 154 pass, 0 fail, 10 WSL skips**. No live model, participant,
reviewer or empirical result. Evidence: tracking/evidence/t14.

Audit fixes, October 18, 2026 (Claude Code, branch claude/project-thread-mccbs5 from
main c162376; ADR-0018): build QA cases are now frozen in the spec and checked against the
plan, with at least one held-out case no role sees; study participant ids compare
case-insensitively so a participant can no longer be granted grader access; CI runs the
PostgreSQL suites. Cloud check: typecheck, format, `pnpm test:db` **158 tests, 148 pass, 0
fail, 10 WSL skips**; GitHub CI (including the new database job) green. Real WSL2 gate on
Jordan's Windows machine (reported by Jordan, October 18, 2026): `CREATOR_TEST_ISOLATION=wsl2
pnpm test:db` **158 tests, 157 pass, 0 fail, 1 skip** (the no-worker test). Remaining
audit items (parent envelope overrun, health labels, preview cookie scope, small fixes) are
in /mnt/project-files/audits/2026-10-18-codebase-audit.md; T17 (above) fixes 4, 5 and 7
and records 6.

T13 update, October 18, 2026 (Claude Code, branch claude/t13-8h288j from main at
6fe5bab, T12 merged as PR #14): a T12 verified candidate now packages into a
deterministic source archive and an immutable `build-manifest/1` binding repo,
commit, spec/freeze/task hashes, template, toolchain, dependency statement, archive
and file hashes, startup requirements, build QA and exported-package results, cost,
lineage and limitations. The archive is re-read, re-extracted and every acceptance
case re-run from those bytes; matching input hashes prove the tested bytes ran.
Migration 10 indexes manifests, private previews and feedback. A separate preview
origin with one-time tickets, owner rechecks, leases, readiness, expiry, stop and
revoke runs the exact package; downloads recheck access and hash. Accepted feedback
on one exact version becomes a new spec version, a revision repo starts from the
package bytes, and versions compare by spec, tasks, tests, files, cost and feedback.
Source archive, runnable demo and native installer are separate labels.

Verified in the Linux cloud container (PostgreSQL 16): typecheck, format, full test
suite **146 pass, 0 fail, 10 skipped** (every skip needs the reviewed WSL2 worker),
and a 13-step headless Chromium walkthrough of gallery, download, compare, preview
origin, ticket reuse, cross-origin, revoke and feedback. That walkthrough used the
visibly labeled test double, which runs nothing and is **not isolation evidence**.

Real-worker gate, October 18, 2026, on Jordan's Windows machine (WSL2
`wsl2-bwrap-systemd` worker, Docker test PostgreSQL): `pnpm test:db` with
`CREATOR_TEST_ISOLATION=wsl2` ran **156 tests, 155 passed, 0 failed, 1 skipped**
(the skip is the no-worker test, which only runs where the worker is absent). The
compiled CLI flow packaged a verified artifact, re-ran it in the worker, ran a
preview, completed one feedback-driven revision (spec v3 to v4, new verified
package with A3) and refused revoked (403), expired (410), tampered download (400)
and stale feedback revision (409). Evidence: tracking/evidence/t13/cli-acceptance.json
and wsl-gate.log. PR #15 merged at b035d99. See ADR-0017,
docs/ARTIFACTS_AND_PREVIEW.md and tracking/evidence/t13. No live provider, public
release or T14 work.

T12 update, October 18, 2026: the bounded local Python task path now connects
authenticated current frozen T08 tasks to build admission and exact-spec humility
review, the existing metered broker, scoped committed T11 patches, fresh reviewer
context and actually executed WSL QA. Immutable plans/prompts/contexts, broker
traces, commits, reviews, commands and execution identities are retained. Only
supervisor code can mark the exact task candidate verified. Broken behavior,
unsupported success claims, stale reviewed commits/specs, scope expansion,
cancelled/human-only runs and zero budgets fail; two-repair exhaustion preserves
partial code. **149/149 database + real-isolation checks passed, no skips** after
serializing test files; earlier failed logs remain. See ADR-0016,
docs/BOUNDED_BUILDER.md and evidence/t12. The final authority-freshness guard has
separate compiled CLI verification in that evidence directory.

This is fixed synthetic builder/reviewer verification for the reviewed offline
Python template, not independent model-quality evidence or a whole-product
readiness claim. Browser/persistence recipes, dependent-task integration, build
catalog indexing, participant implementation execution, previews and delivery
remain unavailable. No live provider, real spend, public release or study
activation. T11 and T12 were later merged (PRs #13 and #14) and T13 is done.

| Requirement | T12 verified scope                                                                                                                | Remaining limitation                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C21, C29    | Finite broker calls, bounded context/output/deadline, typed scoped tools, two repairs, cancellation and preserved partial commits | One independent builder task; crash intents require inspection, no automatic continuation |
| C23         | Fresh review plus real normal/error assertions bound to exact commit/spec/task/plan                                               | Fixed synthetic roles; stdout/exit CLI recipe only, no browser/persistence verification   |
| C27, C34    | Immutable prompt/context/command/output traces and broker reservation IDs                                                         | Local build records are not yet searchable in the catalog                                 |

Docker follow-up, October 18, 2026: CLI/daemon connection verified (Docker Desktop
4.95.0, Engine 29.8.2, Compose 5.6.0, desktop-linux). Optional digest-pinned
PostgreSQL 18.6 Compose development/test services now work on distinct loopback
ports and named volumes. All nine migrations applied, restart persistence and host
TCP password rejection checked; **140/140 tests passed, zero skipped**, including
real WSL isolation. Development DB remains running on 55433; test container on
55434 is stopped. Credentials are in ignored `.env.docker`; application URLs are
opt-in per terminal. No Docker MCP tool was exposed; direct CLI connection is
verified. Generated-code execution remains the T11 WSL worker. See ADR-0015,
docs/DOCKER.md and evidence/docker. T12 is not started; its review/merge and new
request prerequisites remain.

T11 update, October 18, 2026: verified local owner CLI and reviewed Python template execution on Windows + the existing Ubuntu WSL2 VM (Bubblewrap 0.11.1, systemd 259, Python 3.14.4). Separate Git repositories/task/review worktrees bind exact frozen T08 spec/task hashes; typed CAS changes enforce portable file scopes, reject linked paths and stale heads, preserve edits and conflicts, and serialize one integration owner. Generated code runs offline/non-root with narrow read-only mounts and bounded CPU/memory/processes/disk/time/output. Worker leases, process-tree cancellation, uncertain-dispatch fencing, crash reconciliation and cleanup were exercised. **140/140** database + real-isolation checks pass; standard check **63 pass / 77 explicitly skipped**, smoke and authenticated compiled CLI acceptance pass. ADR-0014, docs/ISOLATED_EXECUTION.md and evidence/t11 bind the exact source. No model builder, independent QA, persistent preview, participant implementation execution or public release. T10 is merged as PR #12 at 5f9bb1b; T12 is next after T11 review/merge and a new request.

T10 update, October 18, 2026: verified synthetic study runner on native Windows, Node 22.21.0 and PostgreSQL 18.6. Migration 9 and ADR-0013 add immutable protocol/task/config manifests and hashes, seeded order and condition assignments, isolated attempt workspaces, human-only verbatim document/code/artifact entry with conventional bound text checks, separate human grader authorization, intervention/deviation records, structured T07 execution and a versioned open-ended broker baseline, condition-stable outcomes and excluded assisted continuations, metrics and a repeatable hashed export. Database gate: 130/130; non-database check: 59 pass, 71 explicitly skipped; smoke, compiled CLI/API and headless Edge acceptance passed. No live model, real spend, recruitment or empirical results. Unverified snapshots stop structured execution; arbitrary code and AI implementation execution wait for T11. See [T10 evidence](evidence/t10/verification.json), [review](evidence/t10/review.md) and the [local guide](../docs/LOCAL_DEVELOPMENT.md).

| Requirement | T10 status                                             | Evidence and remaining gate                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C15         | partial, synthetic workflow verified                   | Three-arm matched packet/hash, seed/order/familiarity, separate discovery comparison, condition-stable failures, intervention metrics and available-record export; actual participant work, adopted design and independent outcomes remain T14-T16 |
| C16         | verified for implemented fixture/broker/workflow paths | Every model/broker action, seven study helper paths and both workflow starts refused for human-only work, zero adapter calls; hidden grader and cross-participant contexts denied; external human tool use is not empirically verified             |

T09 update, October 18, 2026: the web page is now a usable studio over the existing API (migration 8, ADR-0012). One workspace picker and a view list replace the stacked panels; the address (`#/view?ws=&id=&q=`) keeps the view, workspace, selected record and query across refresh. Views: Monitor (waiting decisions, workflows in progress with Pause/Resume/Cancel, recently finished, catalog counts, product stages, charged/in-flight/unknown spend and refused calls, latest activity; refreshes itself while work runs), Submit a theme (versioned search brief, claims with what each bears on, response types with exclusion reasons, a new or existing run with an optional revocable 24-hour model permission, then the T07 discovery run), Catalog, Compare and decide (the problem, its brief and claims with passages, freshness and counted status, run assumptions, alternatives side by side with suitability and opportunity scores, gates, humility review, discovery disposition and dissent, then a selection form whose blocked choices are disabled and which handles the supervised approval round), Evidence, Decisions (who asked and when, who answered), Runs, Budgets (now with a Fund a budget form), Scores and specs, Search, Activity and a reserved Gallery that says no preview or download exists. New server routes: `search` (full text over record text, source passages, decision questions and activity summaries via PostgreSQL text search with highlighted snippets; exact UUID or 8+ hex prefix; kind and status filters), `activity` (actor names, action filter, paging), `actors`, `overview`, `problems/{id}/comparison`, and `lineage?depth=1..8`. Membership is checked before any snippet or count; redacted text and redacted sources' passages are not searchable. Fixture workspaces carry a FIXTURE MODE banner. Verified in a Linux cloud container with PostgreSQL 16.15: 122/122 tests with the database (58 pass, 64 visibly skipped without), smoke, and a 12-step headless Chromium acceptance run from a freshly seeded database (submit → evidence → compare → decide with approval → search and activity, budget denial, permission revocation, reserved gallery, keyboard skip link, no overflow at 390 px). C35 is partial (fixture-verified); C26 search is partial; C31 snippet access is partial. See [T09 evidence](evidence/t09/verification.json).

T08 update, October 18, 2026: versioned scoring, selection and frozen specifications now exist (migration 7, ADR-0011). Reviewers record `scorecard` records against two versioned rubrics with equal integer weights: `opportunity-rubric/1.0` ranks software opportunities (urgency, benefit, software influence, feasibility, differentiation, evidence quality) and `suitability-rubric/1.0` compares every response type, software or not. Every rating cites claim or source versions or is explicitly unknown; cards also record confidence, ethics and access gates and which existing alternatives were checked and when. The selection report is computed, never stored as a model claim: exact rational scores (shown to one decimal), no score for a candidate with an unknown rating (bounds instead), the mean of several reviewers with their disagreements listed, shared ranks on ties, overlapping ranges marked unresolved, and a sensitivity report for each weight removed or doubled. Ethics/access, the T07 disposition and the T03 humility review are gates beside the score. A selection (new admitted action `candidate.select`, now a supervised default stage gate) must name the current report hash and give every candidate a disposition with reasons and a reversal condition; code refuses gated candidates and `select_for_build` for a non-code response, and an override of a higher-ranked candidate needs a reason, with the original ranking stored. A `spec/1` specification for the selected build candidate covers audience, flows, scope, non-goals, data contracts, measurable acceptance checks, risks, maintenance and a task DAG checked for cycles, unknown references, uncovered checks and parallel file-ownership conflicts. Freezing is the admitted `spec.freeze` action and records a hash per task; a later revision shows which tasks are still covered by the freeze and which changed. API routes, CLI commands (`scorecard`, `report`, `select`, `selections`, `spec-create`, `spec`, `spec-revise`, `spec-freeze`, `seed-selection`) and a read-only web Scoring and selection panel. Fixture reviewers only. Verified in a Linux cloud container with PostgreSQL 16.15: 117/117 tests with the database (57 pass, 60 visibly skipped without), smoke, a CLI seed run against the API and a headless Chromium check. C09 and C20 are now partial (fixture-verified); C04 and C10 selection-side are partial. See [T08 evidence](evidence/t08/verification.json).

T07 update, October 18, 2026: discovery runs now locate a problem and generate competing responses on the T05 workflow engine (migration 6, ADR-0010). A run starts from a `search_brief` record (theme, two distinct fields, target users, context, measurable problem and outcome measure, data and tools, time and budget limits, optional NAE Grand Challenge seed that must be narrowed) plus chosen T06 claims tagged with what they bear on. The application builds one evidence packet (claims with their current T06 status and quoted passages, matching catalog records, a deterministic sufficiency verdict), binds it by hash, and runs: a locator (affected users, urgency, workaround, alternatives, the transferred cross-field mechanism, or a reason none was found), then one independent proposal per response type (software, existing tool, process change, human-led, hybrid; every type is either run or excluded with a reason), a skeptic pass, revisions up to a configured cap (0–2) and a final skeptic pass. First proposals see the packet and the locator only; their task contexts carry hashes, and the result records the proof. Insufficient problem evidence stops after the locator. Outputs are checked in code (refs must exist in the packet, cross-field answers must explain a mechanism beyond naming the fields, the skeptic must review every proposal) and repaired within limits. Dispositions are deterministic: duplicate of a catalog record (word overlap), rejected, not recommended (including software when an existing tool covers the need), insufficient evidence, or candidate; unresolved objections stay as dissent. Finished runs write a problem record and one alternative per proposal with typed links. API routes, CLI commands (`discovery-start`, `discovery`, `discovery-packet`, `seed-discovery`) and discovery results in the web Workflow runs panel. Fixture model only; the locator does not search the web itself. Verified in a Linux cloud container with PostgreSQL 16.15: 104/104 tests with the database (52 pass, 52 visibly skipped without), smoke, a CLI seed run against the API and a headless Chromium check. Requirements C02, C03 and C07 are now partial (fixture-verified; live model behaviour unverified); C10 discovery-side options are partial. See [T07 evidence](evidence/t07/verification.json).

T06 update, October 18, 2026: runs now fetch web pages only through an application source broker (migration 5, ADR-0009). Each fetch is a `source.fetch` action admitted against the run's grants (approve-once covers one URL) after a URL policy check; every redirect hop and DNS answer is re-checked, private/loopback/link-local/metadata addresses, non-HTTPS, other ports, credentials in URLs and unapproved hosts are refused, and byte, time, type and per-run limits apply with no cookies or credentials sent. Sources keep URL, final URL, content hash, retrieval and publication dates, retrieval state, retention class and passages with exact text offsets, hashes and bounded excerpts (none under hash-only retention); a changed page is a new version. Claim support binds a quoted passage (verified verbatim) to exact claim and source versions as supports/contradicts/does-not-support, typed as source assertion, quotation, observation or inference; inaccessible sources are labelled, never counted. Evidence status counts reposts of one origin once, stops counting changed, removed or stale rows, and names gaps. Retrieved text is stored as data with no authority. API routes, CLI commands and a web Sources and evidence panel. Fixture adapter only; the live HTTP adapter is tested against loopback servers, not real sites, and there is no live search adapter. Verified in a Linux cloud container with PostgreSQL 16.15: 91/91 tests with the database in three full runs (45 pass, 46 visibly skipped without), smoke and a headless Chromium check. See [T06 evidence](evidence/t06/verification.json).

T05 update, October 18, 2026: durable bounded orchestration now runs on PostgreSQL (migration 4; Jordan chose this over a Temporal server, ADR-0008). A deterministic coordinator runs one bounded role (R05 skeptic) for a registered run: per-perspective critique tasks within concurrency, call, repair, depth and deadline limits, then a synthesis once its dependencies finish. Tasks are checkpointed with logical operation ids, leased to workers with fencing tokens and heartbeats, woken from decisions through an idempotent outbox consumer, and never auto-retried after an unknown outcome. Pause, resume and cancel are owner controls; cancel stops delegation and keeps in-flight exposure held. A worker runs inside the API (or `pnpm worker`), with API routes, CLI commands and a web Workflow runs panel. Verified in a Linux cloud container with PostgreSQL 16.15: 72/72 tests with the database (37 pass, 35 visibly skipped without), a real killed-process restart, smoke and a headless Chromium check. See [T05 evidence](evidence/t05/verification.json).

T04 update, October 18, 2026: an application-owned model/tool broker now meters every model and metered tool call. Owner-funded budget envelopes (global, period, run, task) with carve-out child allocation, dated pricing snapshots, atomic reservation of maximum exposure committed together with T03 admission, settlement from authoritative usage (one charge per attempt), release for definitive provider refusals, held unknown exposure for timeouts/5xx/cancellation with late-result settlement and owner reconciliation, a deterministic fixture adapter and an OpenAI Responses adapter for `gpt-6-astra` (documented by OpenAI; account access unverified, no live call made). API routes, CLI commands and a web Budgets panel. Verified in a Linux cloud container with PostgreSQL 16.15: 61/61 tests with the database (33 pass, 28 visibly skipped without), smoke and a headless Chromium check. See [T04 evidence](evidence/t04/verification.json) and ADR-0007.

T03 update, October 18, 2026: owner sign-in (local development code or OIDC with PKCE), CSRF-protected sessions, versioned standing grants, approve-once grants bound to exact target/content/spec versions, durable decision requests (clarification, judgment, authorization, feedback) with expiry, cancellation and idempotent answers, deterministic action admission for supervised, human-in-the-loop, autonomous-within-scope and human-only runs, assumption records and a pre-build humility gate now exist behind the API, CLI and a web Human decisions panel. Verified in a Linux cloud container with PostgreSQL 16.15: 47/47 tests with the database (29 pass, 18 visibly skipped without), smoke and a headless Chromium check. Not run on the owner's Windows machine; OIDC verified only against a local test identity provider. See [T03 evidence](evidence/t03/verification.json) and ADR-0006.

T02 update, October 18, 2026: PostgreSQL persistence, migrations, many-to-many typed links, optimistic versions, workspace scopes, a hash-chained audit log with transactional outbox, an idempotent history projection, corrections and redaction tombstones now exist behind the API, CLI and a read-only web Records panel. Verified in a Linux cloud container against PostgreSQL 16.15 (29/29 tests with the database; 21 pass and 8 visibly skipped without it). Not yet run on the owner's Windows machine. See [T02 evidence](evidence/t02/verification.json) and ADR-0005 in [decisions](DECISIONS.md). The task demonstration remains fixture-only; no AI, research or authentication exists.

Claude Code tooling, October 18, 2026: the same skills (now 30, adding Matt Pocock `grill-me`, `grilling` and `improve-codebase-architecture`) are mirrored to `.claude/skills`, both MCP servers are in `.mcp.json`, and a cloud-only SessionStart hook runs `pnpm install`. Playwright MCP was verified in a Linux cloud container with environment overrides; Firecrawl was not reachable from the cloud network (403) and is untested there. Product status unchanged: T01 complete, T02 next.

CI update, October 18, 2026: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` and `pnpm check` on Node 22 for every push and pull request. It does not advance T02.

Tooling update, October 18, 2026: the owner's requested development setup is installed project-locally: 27 pinned skills, Playwright MCP 0.0.83, Firecrawl's keyless hosted MCP, and Impeccable engine 0.1.15. MCP handshakes/tool discovery and an isolated blank browser check passed; Firecrawl data/account operations remain untested. See [tool guide](../docs/DEVELOPMENT_TOOLS.md) and [tooling evidence](evidence/development-tools/install-manifest.json). This does not advance T02 or activate product integrations. T01 source and application dependencies are unchanged.

Updated October 17, 2026 (America/New_York). T00 and T01 verified. A minimal TypeScript workspace now provides strict runtime contracts, deterministic domain rules, a fixture-only Node API/CLI and React web page. No real AI, research, persistence or generated-product execution exists. Local main remains unborn (no HEAD commit); exact source/evidence hashes identify the candidate. See [decisions](DECISIONS.md), [startup guide](../docs/LOCAL_DEVELOPMENT.md) and [T01 evidence](evidence/t01/verification.json).

Use planned, in_progress, implemented_unverified, verified, partial, blocked, or deferred. Each verified entry needs exact code/spec version, checks actually executed, and evidence. Identify external/live/native gates separately.

| ID  | Milestone                                                  | Status                                                                                                                      | Code/version and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Remaining work                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00 | Repository intake and verified starting point              | verified                                                                                                                    | Historical T00 snapshot in evidence/t00; ADR-0001                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Intake complete; T01 subsequently implemented                                                                                                                                                                                                                                           |
| T01 | Minimal workspace, typed contracts, and lifecycle          | verified                                                                                                                    | Package 0.1.0, schema 1.0; evidence/t01/final-files.sha256; clean install/build/check, 20 passing tests on Node 22 and 24, HTTP smoke and browser checks                                                                                                                                                                                                                                                                                                                                                                                                                      | Superseded as current status by T02                                                                                                                                                                                                                                                     |
| T02 | Persistence, provenance, and durable audit                 | verified (cloud Linux, PostgreSQL 16.15), merged PR #3                                                                      | Migration 1; evidence/t02/verification.json; 29/29 tests incl. real process restart, stale/concurrent writes, cross-scope links, duplicate outbox delivery and two-ideas/two-descendants lineage; browser check of Records panel                                                                                                                                                                                                                                                                                                                                              | Windows PostgreSQL setup untested; authentication added in T03                                                                                                                                                                                                                          |
| T03 | Human decisions, autonomy modes, and humility              | verified (cloud Linux, PostgreSQL 16.15)                                                                                    | Branch claude/t03-decisions-autonomy-5gpinz; migration 2; evidence/t03/verification.json; 47/47 tests incl. changed/expired approvals, cancellation, duplicate and concurrent answers, autonomous needs_human, human-only model denial, routine action without interruption, OIDC PKCE and CSRF                                                                                                                                                                                                                                                                               | Merged (PR #4); Windows and real IdP untested                                                                                                                                                                                                                                           |
| T04 | Budgets and a metered model/tool broker                    | verified (cloud Linux, PostgreSQL 16.15; fixture and contract only)                                                         | Branch claude/t04-budgets-broker-px0108 stacked on T03; migration 3; evidence/t04/verification.json; 61/61 tests incl. 8 concurrent calls against a 3-call envelope, denied calls with zero adapter calls, late result settled once, duplicate deliveries dispatching once, rate-limit retry, cancellation, lost worker, overrun                                                                                                                                                                                                                                              | Merged (PR #5); live call needs a key, a spend grant and an owner request; Windows untested                                                                                                                                                                                             |
| T05 | Durable bounded orchestration and recovery                 | verified (cloud Linux, PostgreSQL 16.15; fixture only)                                                                      | Branch claude/t05-t1b785 from main at f51530f; migration 4; ADR-0008 (PostgreSQL instead of Temporal); evidence/t05/verification.json; 72/72 tests incl. restart with killed worker and API processes, duplicate task delivery and duplicate outbox wake-up, waiting on two decisions, stale-worker commit refused, cancellation with held exposure, autonomous needs_human, bounded repair, pause/resume                                                                                                                                                                     | Merged (PR #6); Windows untested; CI still runs only `pnpm check`                                                                                                                                                                                                                       |
| T06 | Source ingestion, claim support, and research boundaries   | verified (cloud Linux, PostgreSQL 16.15; fixture and loopback contract only)                                                | Branch claude/t06-sources-claims-ogwzbb from main at da976c7; migration 5; ADR-0009; evidence/t06/verification.json; 91/91 tests incl. supporting and non-supporting passages, fabricated quotes refused, repost cluster vs independent contrary source, changed version invalidating support, 403 and 410 pages, redirects to 169.254.169.254 / an intranet address / http, injected instructions with no grant/decision/policy/fetch change, byte/time/type/hash-only limits, approve-once per URL, no fixture fallback, concurrent fetch, sweep of lost fetches, redaction | Owner review; no live search adapter; live fetch unverified against real sites; T05 workflow roles do not call the broker yet; Windows untested; merged as PR #7                                                                                                                        |
| T07 | Locator and competing response generation                  | verified (cloud Linux, PostgreSQL 16.15; fixture model only)                                                                | Branch claude/t07-locator-responses-nyj7cq from main at 5a07713; migration 6; ADR-0010; evidence/t07/verification.json; 104/104 tests incl. cross-field locator, a known duplicate, software not recommended when an existing tool fits, a software-suitable candidate after one revision, insufficient evidence stopping after the locator, proposal independence from provider inputs, repairs of out-of-packet refs and names-only mechanisms, revision cap 0 with dissent, changed claim versions                                                                         | Owner review; no live model run; locator does not search; duplicate detection is word overlap; starting a discovery run has no web form (API/CLI); Windows untested; next eligible T08                                                                                                  |
| T08 | Versioned scoring, selection, and frozen specifications    | verified (cloud Linux, PostgreSQL 16.15; fixture reviewers only)                                                            | Branch claude/t08-aq72aq from main at df04354; migration 7; ADR-0011; evidence/t08/verification.json; 117/117 tests incl. exact scores, unknowns kept as bounds, ties and reviewer disagreement, sensitivity, override with original ranking retained, gates that no score clears, no build-ready non-code response, a gate closing after selection stops the freeze, spec revision invalidating changed tasks and the earlier approval, cycles and ownership conflicts, replaced selections, autonomous runs with and without a grant                                        | Owner review; no model assessor role; selecting does not move a product stage; selecting and freezing have no web form (API/CLI); Windows untested; next eligible T09                                                                                                                   |
| T09 | Usable catalog, decisions, search, and run monitor         | verified (cloud Linux, PostgreSQL 16.15; fixture workspace in headless Chromium)                                            | Branch claude/t09-catalog-monitor-ml1t89 from main at bba9e9a; migration 8; ADR-0012; evidence/t09/verification.json; 122/122 tests incl. search permissions before snippets and counts, redaction, id and prefix search, activity paging and validation, comparison assumptions; 12-step browser acceptance run with screenshots                                                                                                                                                                                                                                             | Owner review; fixture model and reviewers only; search is lexical (no semantic search, X03); lineage traversal bounded at 8 hops with no graph view; no product stages exist yet so stage and task views show empty states; Windows and real screen readers untested; next eligible T10 |
| T10 | Study runner and human-only workflow                       | verified (Windows, PostgreSQL 18.6; synthetic only)                                                                         | Branch codex/t10-study-runner from a9edf68 (T09 merged PR #10); migration 9; ADR-0013; evidence/t10/verification.json; 130/130 DB tests, check, smoke, CLI/API export and headless Edge acceptance                                                                                                                                                                                                                                                                                                                                                                            | Merged PR #12 at 5f9bb1b; no empirical study or live AI; study-arm implementation integration remains separate from the T11 owner CLI                                                                                                                                                   |
| T11 | Isolated execution and local product Git                   | verified (Windows + WSL2; reviewed synthetic template)                                                                      | Branch codex/t11-isolated-execution from 5f9bb1b; ADR-0014; evidence/t11/verification.json and source manifest; 140/140 DB + real isolation, check, smoke, CLI/API admission                                                                                                                                                                                                                                                                                                                                                                                                  | Owner review/merge; fixed offline Python recipe; no model builder/independent QA, catalog indexing, dedicated appliance or persistent preview; T12 next on request                                                                                                                      |
| T12 | Bounded builder, independent review, and QA                | verified (Windows + WSL2; fixed synthetic roles)                                                                            | Branch codex/t12-bounded-builder; ADR-0016; evidence/t12; 149/149 DB + real isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Merged PR #14 at 6fe5bab                                                                                                                                                                                                                                                                |
| T13 | Verified artifacts, private preview, and feedback revision | verified (Windows + WSL2; synthetic fixture roles)                                                                          | Branch claude/t13-8h288j from 6fe5bab; migration 10; ADR-0017; evidence/t13; real WSL2 gate 155 pass / 1 expected skip; cloud 146 pass / 10 WSL skips; 13-step browser walkthrough                                                                                                                                                                                                                                                                                                                                                                                            | Merged PR #15 at b035d99; CLI-only runnable demo, no native installer, web-app preview or public release; next eligible T14 on request                                                                                                                                                  |
| T14 | Pilot, rubric calibration, and protocol freeze             | partial (cloud Linux, PostgreSQL 16; fixture pilot rehearsal, protocol proposed not adopted)                                | Branch claude/project-thread-ocgg8g from e46b2cf; ADR-0019; evidence/t14; 154 pass / 10 WSL skips; pilot 16 pass, 1 warn                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Owner research decisions RD1-RD10, then freeze; live AI pilot, human pilot and reviewer calibration not run                                                                                                                                                                             |
| T15 | Final evaluation and blinded rating package                | partial (cloud Linux, PostgreSQL 16; machinery, rehearsal, final-record gate, budget ledger and study builds; no final run) | Branch claude/t15-hdrwqz from 3f3544a; ADR-0021, ADR-0022; migration 11; evidence/t15; 167 pass / 11 WSL skips; rehearsal 10/10 checks                                                                                                                                                                                                                                                                                                                                                                                                                                        | Protocol freeze (RD1-RD10) with participants, reviewers, IRB and final tasks answered; verified live model id and spend authorization (RD6); final build tasks frozen with held-out cases; WSL2 gate for study builds                                                                   |
| T16 | Reproducible analysis and limits                           | partial (pipeline only; empirical blocked)                                                                                  | Branch claude/t16-analysis-95avhe; ADR-0023; `pnpm analyze`; docs/ANALYSIS.md; evidence/t16 (3 synthetic fixtures, real rehearsal package, 187 tests / 176 pass / 11 WSL skips)                                                                                                                                                                                                                                                                                                                                                                                               | Real T15 final runs under an adopted freeze, reviewer ratings (RD4), a decision acceptance rule, owner coding of intervention necessity                                                                                                                                                 |
| T17 | Failure recovery, boundary checks, and requirements audit  | verified (cloud Linux, PostgreSQL 16.15; Jordan's Windows/WSL2 gate 167 pass, 1 expected skip)                              | Branch claude/project-thread-k4si82 from e46b2cf; ADR-0020; evidence/t17 (requirements-to-evidence report, verification.json); backup → restore → real API on the restored copy; audit items 4, 5 and 7 and a silent workflow heartbeat failure fixed with reproduced failures                                                                                                                                                                                                                                                                                                | `pnpm backup` CLI not run by hand on Windows; overrun guard not serialized against a concurrent settle; no member-removal path; no live end-to-end run                                                                                                                                  |
| T18 | Thesis, committee review, and defense preparation          | planned                                                                                                                     | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T16 and T17, or documented missing-data limits                                                                                                                                                                                                                                          |
| T19 | Final thesis acceptance and reproducibility archive        | planned                                                                                                                     | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T18                                                                                                                                                                                                                                                                                     |
| X01 | Model registry and qualified automatic routing             | partial (cloud Linux, PostgreSQL 16; fixture-verified routing machinery)                                                    | Branch claude/x01-qfktko from 8c09748; migration 12; ADR-0024; docs/MODEL_ROUTING.md; evidence/x01; 198 tests / 187 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                       | Measured task outcomes (T15) to qualify real models; verified gpt-6-astra id; routing used by workflow/study/builder paths; web UI                                                                                                                                                      |
| X02 | Context selection, caching, compaction, and batches        | partial (cloud Linux, PostgreSQL 16; fixture-verified)                                                                      | Branch claude/x02-b3wzes from c738369; migration 13; ADR-0025; docs/CONTEXT_AND_CACHING.md; evidence/x02; 212 tests / 201 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                 | Live verification of gpt-6-astra prompt caching and batch (owner-authorized call); provider compaction adapter; packs/cache used by workflow, study and builder paths; web UI                                                                                                           |
| X03 | Comprehensive search, lineage, and audit questions         | partial (cloud Linux, PostgreSQL 16; fixture-verified)                                                                      | Branch claude/x03-s7po1x from d2c8ef1; migration 14; ADR-0026; docs/SEARCH_AND_AUDIT.md; evidence/x03; 219 tests / 208 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verified real embedding model (owner decision, accessible id, pricing, data-class approval); live model compile check; web UI for questions, saved queries and lineage graphs; per-record access control if ever needed                                                                 |
| X04 | Scoped GitHub management                                   | partial (cloud Linux, PostgreSQL 16; fixture GitHub and loopback contracts)                                                 | Branch claude/x04-gm7n32 from d2c8ef1; migration 15; ADR-0027; docs/GITHUB.md; evidence/x04; 221 tests / 210 pass / 11 WSL skips                                                                                                                                                                                                                                                                                                                                                                                                                                              | Owner-created GitHub App or fine-grained token, CREATOR_GITHUB=live, grants and a live verification; webhook forwarder; releases and settings; web UI                                                                                                                                   |
| X05 | Windows desktop and paired local workers                   | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13                                                                                                                                                                                                                                                                                     |
| X06 | Hosted operation and observability                         | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T17; X05 only for hosted-to-local pairing                                                                                                                                                                                                                                               |
| X07 | Payments, entitlements, revenue and reinvestment           | partial (cloud Linux, PostgreSQL 16; fixture processor and Stripe contract double)                                          | Branch claude/x07-5zm23m from 4fe3d33; migration 19; ADR-0033; docs/PAYMENTS.md; evidence/x07                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner choice of processor and live activation; a Stripe test account and keys for a real test-mode check; webhook forwarder; web UI                                                                                                                                                     |
| X08 | Evidence-backed marketing and measured feedback            | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13; X06/X07 only where distribution/payment requires them                                                                                                                                                                                                                              |
| X09 | Portfolio scheduling, maintenance, and reusable knowledge  | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T13; X01/X07/X08 for their enabled features                                                                                                                                                                                                                                             |
| X10 | Full-product acceptance and bounded owner pilot            | deferred                                                                                                                    | No application code at T00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Applicable X01–X09 gates                                                                                                                                                                                                                                                                |

Requirement-level evidence: the T17 audit lists every C01–C51 status with evidence in [evidence/t17/REQUIREMENTS_EVIDENCE.md](evidence/t17/REQUIREMENTS_EVIDENCE.md). No requirement is pre-marked complete.

## T00 checks and limitations

- `git ls-remote --symref https://github.com/jordanprice040/CreatorAI.git`: exit 0, no advertised refs at 2026-10-18T03:26:37Z (October 17 locally). [Saved result](evidence/t00/remote-refs.json).
- Initial Git status/remote checks failed because this was not a Git working tree. `git init -b main` and local `git remote add origin ...` subsequently succeeded. No staging, commit, push or remote provisioning. Config writing required sandbox escalation.
- Initial restricted remote lookup failed with `getaddrinfo() thread failed to start`; approved retry succeeded. No application defect is inferred from that sandbox failure.
- `& ./tracking/evidence/t00/verify-starting-point.ps1` succeeded: inventoried files, Git state, tools, absent manifests/application paths; all five template JSON files parsed. Parsing is not runtime-schema validation.
- Before edits, 30/31 original manifest entries matched; CLAUDE.md differed and was preserved. [Input hashes](evidence/t00/input-kit-hashes.json) distinguish existing bytes from T00 changes. [Final hashes](evidence/t00/final-files.sha256) identify the completed uncommitted candidate, excluding that manifest itself and .git/.
- Version commands succeeded: Git 2.45.1.windows.1, Node v22.21.0, pnpm 11.25.0, npm 10.9.4, Python 3.13.0, gh 2.98.0. PowerShell 7.6.6. These are observations, not a tested application dependency combination.
- Docker, psql and Temporal CLIs were not on PATH. No endpoint, provider account, credential, pricing, CI run or deployment was tested. No application build/test/start command exists, so an application baseline is not applicable.

T00 acceptance covered inventory, path/dependency ADR, baseline evidence and next step only. Its evidence remains historical and unchanged. No paid calls, generated products, research trials or external activation occurred.

## T01 acceptance and evidence

- Actual paths: packages/contracts, packages/domain, apps/api, apps/cli, apps/web, tests, scripts, config and docs. No empty future packages. Direct dependencies pinned and pnpm-lock.yaml checked in the working tree (not yet Git committed). Strict TypeScript, configuration validation and formatting commands work.
- Runtime schema 1.0 covers task/result, run config, source/claim, alternative, assumption, decision request, cost, entity links and experiment assignment. Invalid/unknown fields and versions fail. Decimal-string nano-USD preserves exact amounts; unknown costs are distinct.
- Pure domain checks reject stale versions/candidate evidence, invalid transitions, unsafe child allocations/paths and mismatched results. Product lifecycle, execution state, research condition and discovery method are distinct. Nonsoftware/existing-tool/human-led/hybrid/deferred/failed dispositions are supported.
- Provider admission rejects missing caps, expired scope, human-only dispatch and all live requests. The deterministic fixture has no network/tools/paid route. Structural live configuration validation is not authorization; real grants, atomic reservations and services remain later milestones.
- Fresh source-only directory: frozen offline-cache install, build, typecheck, 20 contract/domain/HTTP/CLI tests and formatting all passed. [Clean log](evidence/t01/clean-verification.log). Separate Node 24.19.0 execution: [20 passing tests](evidence/t01/node24-tests.log). Main baseline uses Node 22.21.0; pnpm 11.25.0 itself uses bundled Node 24.19.0 on this machine.
- Built-web preview → API proxy health and fixture POST passed: [smoke log](evidence/t01/smoke.log). Browser verified visible health, existing-tool/process-change/failure outcomes and whitespace-input disablement; final process-change result captured in [state](evidence/t01/browser-state.txt) and [screenshot](evidence/t01/browser-fixture.png).
- Honest limitations: no persistence/audit outbox, authentication/grant store, atomic budget broker, workflow engine, worker isolation, genuine evidence verification, independent review service or study execution. Pure rules consume trusted state/evidence; accepting a schema does not authenticate an actor or prove a claim. No CI/remote deployment verification was performed.

| Requirement | Current status | T01 evidence / remaining gate                                                                                                                        |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| C10–C11     | partial        | Non-code outcomes and assumption/disconfirmation contracts; real humility/discovery gates remain T03/T07–T08                                         |
| C13–C16     | partial        | Separate mode/condition schemas, scope checks and human-only provider denial; authenticated grants/study runner remain T03/T10                       |
| C20–C23     | partial        | Version/spec/result binding, delegation validation, lifecycle evidence requirements; no task scheduler, persistence or independent reviewer yet      |
| C28–C29     | partial        | Exact-money/sibling allocation checks, finite limits and terminal cancellation transitions; atomic reservation/cancellation execution remain T04–T05 |
| C32         | partial        | Usable local API/CLI/web fixture; persistent usable control remains T02/T05/T17                                                                      |
| C35         | partial        | Thin real health/fixture UI with empty/error states; full catalog/controls remain T09                                                                |
| C49         | partial        | Visible fixture labels and separate implementation/contract/live status; real adapters remain unverified                                             |

T02–T19 remain planned; X01–X10 remain deferred. No full requirement or product completion is inferred from the T01 gate. Next: T02 only after a new request. (T02 since completed; see below.)

## T02 acceptance and evidence

- New package `packages/db` (node-postgres `pg` 8.23.1): one immutable migration (checksum-verified, advisory-locked), a startup schema gate, and a `Store` repository. Tables: actors, workspaces/members (owner/editor/viewer), entities with immutable `entity_versions`, typed `entity_links` bound to exact endpoint versions, `audit_events` (database-sequenced, hash-chained), `outbox`, `consumer_inbox`, `history_projection`, `command_receipts`.
- Stored kinds: source, claim, problem, idea, alternative, assessment, product, specification, run, task, decision, grant, artifact. Bodies are strict Zod schemas capped at 16 KiB; artifacts and sources hold URIs and hashes, not content. Product stage and run/task state are stored at their initial value and generic revisions cannot move them.
- Fixture separation: a workspace is `fixture` or `real`; a composite foreign key keeps fixture records out of real workspaces. Cross-workspace links fail in code (`SCOPE_EXCEEDED`) and in the schema.
- Every mutation commits record + version + audit event + outbox row in one transaction. Audit payloads carry ids, kinds, versions, hashes and enums only. Corrections append a version that names the corrected one; links are retracted, not deleted; triggers reject edits/deletes of audit events and versions except redaction, which blanks titles/bodies/reasons and leaves identity, versions, hashes, links and audit intact.
- API record routes, CLI commands (`workspaces`, `create`, `show`, `list`, `revise`, `archive`, `link`, `lineage`, `history`, `seed-lineage`) and a read-only web Records panel. Lineage walks typed links by provenance direction (many-to-many, not parent IDs).
- Checks executed: see [verification.json](evidence/t02/verification.json), [with-database log](evidence/t02/test-db.log), [without-database log](evidence/t02/check-without-db.log), [browser screenshot](evidence/t02/browser-records.png).
- Limitations: no authentication (API acts as one configured local owner; repository role checks are real but the actor is asserted); global advisory lock serializes writes for the hash chain (fine locally, revisit for hosted use); hash chain is tamper-evident only against parties who do not also rewrite later hashes (the table owner can); content hashes of redacted records remain and could be guessed for very short bodies; no search beyond lineage/history; Windows PostgreSQL path untested; schema 1.0 extended additively (ADR-0005).

| Requirement | Current status | T02 evidence / remaining gate                                                                        |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| C32         | partial        | Records persist across real API restart; usable control/orchestration remains T05/T17                |
| C20–C23     | partial        | Version-bound links and optimistic versions persist; scheduler and independent review remain T05/T12 |

## T03 acceptance and evidence

- Sessions: `/api/auth/dev-login`, `/api/auth/oidc/login|callback`, `/api/auth/session`, `/api/auth/logout`. Record, decision, grant and run routes resolve the actor from the session; 401 without one, 403 `CSRF_DENIED` without the session's token, 403 for foreign origins. OIDC attempts are single use and admit only `CREATOR_OIDC_OWNER_SUBJECT`.
- Decisions and grants: migration 2 tables `run_controls`, `grants`/`grant_versions`, `decision_requests`, `action_admissions`, `auth_sessions`, `oidc_logins`, all audited through the T02 hash chain; run controls, grant versions, decisions and admissions reject deletes (and edits where immutable).
- Acceptance cases executed (tests/src/oversight*.test.ts, auth-api.test.ts): changed target supersedes an open approval and denies stale-version actions; expired requests and grants stop authorizing; cancellation closes pending decisions, revokes run grants and denies later actions; duplicate requests return the open one, identical answers replay, conflicting and concurrent answers have one winner; autonomous runs defer as `needs_human`, cannot request help and ignore later grants; human-only runs are denied model calls despite a grant; a covered routine reversible action proceeds three times with no decision; agents cannot answer or create grants; build commitment needs the humility gate, then an ethics judgment, then an exact approval.
- Browser: sign-in via login link, pending judgment and authorization cards, standing-policy preview, approve once, answered view, no horizontal overflow at 390 px ([log](evidence/t03/browser-check.log), [screenshot](evidence/t03/browser-decisions.png)).
- Limitations: admission is called by the owner via API/CLI until T05 adds an orchestrator; no budget exposure check (T04); single owner (no editor/agent sessions); OIDC verified with a local test provider only; Windows untested; schema 1.0 extended additively (new kinds `assumption`, `humility_review`, error codes `UNAUTHENTICATED`, `CSRF_DENIED`).

| Requirement | Current status | T03 evidence / remaining gate                                                                           |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| C10–C11     | partial        | Humility gate and assumption records enforced at build commitment; discovery-side use remains T07–T08   |
| C13–C16     | partial        | Authenticated owner, versioned grants, mode enforcement and decision requests; study runner remains T10 |

## T04 acceptance and evidence

- New package `packages/broker`: `ModelBroker`, `FixtureAdapter` (no network, simulated units) and `OpenAIAdapter` (POST /v1/responses via `fetch`, `store: false`, key held only in the API process). `packages/domain/src/budget.ts` holds exact BigInt pricing: exposure bound (UTF-8 bytes + framing at the highest input rate, max output at the output rate, documented long-context surcharge) and usage cost in disjoint categories (uncached, cached, cache-write input; output including reasoning, never added twice; per-call tools).
- Migration 3: `pricing_snapshots` (immutable), `budget_envelopes` (cap/allocated/reserved/unknown/incurred, a check constraint that rejects overspend, immutable identity and cap), `budget_reservations` (one row per attempt or denial; legal transitions enforced by trigger; unique dispatched attempt per logical operation), `usage_records` (unique per attempt: no duplicate charge), `budget_journal` (every balance movement; tests re-derive balances from it).
- Admission order follows HUMAN_OVERSIGHT.md: non-delegable run state, pricing and exposure, envelope scope/window/concurrency/balance, then T03 grants/mode/stage gates with the bound amount, then the reservation, all in one transaction. A denial records a reason and reserves nothing; a needs-human outcome creates an authorization decision for the exact amount.
- Acceptance gate, executed: concurrent reservations cannot overspend (8 parallel calls, room for 3: 3 dispatched, 5 `budget_exceeded`; the database also refuses a direct overspend); a denied call never reaches the provider (human-only, cancelled, missing pricing, unpriced tool, budget, envelope scope, expired period, no grant, autonomous without grant, model limit, real workspace without live adapter: adapter calls 0); late results reconcile without duplicate charge (timeout → unknown held → late answer settles once; repeated late delivery changes nothing; replay returns stored output without a second call). Also: rate-limit release and retry, malformed output charged, provider error held then owner-reconciled, cancellation in flight keeps exposure, lost worker becomes unknown, child conservation and rollup without double counting, overrun recorded honestly and then blocking.
- Live: no call. `gpt-6-astra` id, pricing and Responses usage semantics were read from OpenAI's official pages on 2026-10-18; no key exists in this environment and no spend grant was requested. The adapter is contract-tested against a loopback server.
- Limitations: retries under an approve-once grant need a fresh approval (the grant is single-use); only text input is bounded (no images/files); OpenAI embeddings and tool calls are not implemented (refused before dispatch); compute/sandbox costs belong to T11; reconciliation of unknown outcomes is manual; the broker is called by the owner via API/CLI/web until T05 adds an orchestrator.

| Requirement | Current status                      | T04 evidence / remaining gate                                                                                                                                                                                        |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C27         | partial                             | Reservation, settlement and denial events with amounts and reason codes in the audit chain and history; X03 adds per-run and per-subject cost questions with supporting reservation and usage ids (fixture-verified) |
| C28         | partial (fixture/contract verified) | Atomic reservations, carve-out conservation, unknown ≠ zero, journal re-derivation; live billing reconciliation unverified                                                                                           |
| C34         | partial                             | Token bounds and accounting per call; task-specific context selection remains T05                                                                                                                                    |

## T09 acceptance and evidence

- Interface: `apps/web/src/main.tsx` shell with skip link, labelled view navigation (`aria-current`), workspace picker and FIXTURE MODE banner; shared pieces in `ui.tsx` (routing, `useLoad`, loading/empty/error states, actor names, snippets) take plain props so a desktop shell can reuse them. Each view only offers actions the API supports for the current role; viewers see read-only text.
- Server: `packages/db/src/catalog-store.ts` (search, activity, actors, overview, comparison), contracts in `packages/contracts/src/catalog.ts`, migration 8 GIN text-search indexes. Search and activity drain the audit outbox first so a just-made change is findable.
- Acceptance gate, executed in headless Chromium against `vite preview` and the API on a database seeded with `pnpm cli seed-selection` ([script](evidence/t09/browser-acceptance.mjs), [results](evidence/t09/browser-acceptance.json), screenshots 01–17): submit a theme with two claims and a new human-in-the-loop run → the run finishes on the server and shows on the Monitor after reload → open the claim's passages from Compare → five alternatives side by side → record a selection, which the supervised gate turns into a decision; approve it in Decisions, submit again, recorded and still shown after reload → search “no-show” (highlighted record, passage and activity hits), an 8-character id prefix, the activity log filtered to selections and “Answered decision” → a 0.000001 budget refuses a call before sending (`budget_exceeded`) → revoking the run's standing model permission makes the next call `needs_human (outside_grant)` and shows “Revoked standing grant” in Activity → the Gallery has no download or preview control → no horizontal overflow at 390 px on Monitor or Compare. No console errors.
- Defects found by inspecting screenshots and repaired: raw validation messages shown before any input, the navigation centred vertically, a problem picker overflowing phone width, the Monitor not updating while a workflow ran, activity and search links for grants that opened a failing page, a missing workflow id in the run detail, old numbered panel labels and a favicon 404.
- Database tests (`tests/src/catalog.test.ts`): non-members get NOT_FOUND for search, activity, overview, actors and comparison; viewers can search; another workspace's records are never counted; redaction removes text from search; a redacted source drops its passages; actor names, paging, action filter and validation; overview counts and a cancelled run; comparison includes run-level assumptions.
- Limitations: lexical search only; snippets come from PostgreSQL `ts_headline`; lineage depth is capped at 8 and shown as a list; product stages, tasks and artifacts are empty until T11–T13; Windows, real assistive technology and contrast measurement tools were not run (colours were chosen against WCAG AA by hand, not measured).

| Requirement | Current status             | T09 evidence / remaining gate                                                                                                                                                                                                                                                    |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C26         | partial                    | Full-text, exact-id and filtered search with bounded lineage; X03 adds code-version, model and cost search, source-to-product questions, lineage graphs and verified exports (fixture-verified; semantic search refused in real workspaces until an embedding model is verified) |
| C31         | partial                    | Membership checked before snippets and aggregates (search, coverage, questions, semantic candidates, lineage, exports); redacted text unsearchable and tombstoned; lineage exports flag redactions since export; member removal verified (fixture)                               |
| C35         | partial (fixture-verified) | Browser paths over real state with keyboard, empty/error and permission cases; product, task and gallery views wait for T11–T13                                                                                                                                                  |

## T11 acceptance and evidence

- Actual owner path: CLI authenticates to existing HTTP API, checks workspace owner and current active frozen T08 specification/body/content/task hashes, then manages a separate local product repo and real constrained worker. No generic remote command endpoint or generated-code host execution was added. Studio schema remains 9. The local provenance store is not the PostgreSQL audit chain or web catalog.
- Real worker checks: harmless compilation/entry point; non-root/no capabilities/no new privileges; secret/home/Windows/daemon/D-Bus/Git/symlink escape and writes to input/root/dev denied; metadata/public/loopback network denied with a different network namespace; observed CPU/memory/swap/task/runtime controls; actual disk/memory/process/output/runtime limits; cancellation of a detached signal-ignoring child; killed supervisor, lease expiry and explicit no-redispatch reconciliation; missing distribution blocked with no fallback. Snapshot workspaces are disposed only after observed unit cleanup.
- Real Git checks: separate repos/worktrees, exact bases, scoped CAS writes, traversal/reserved-name/alternate-stream/link rejection, dirty and stale work preserved, one owner, non-destructive conflict workspace, and immutable task/commit/file lineage. One worker per products root, exclusive locks never stolen by elapsed time, durable uncertain-dispatch fence.
- Tests: 140/140 with PostgreSQL 18.6 + opt-in WSL2; pnpm check 63 pass/77 explicitly skipped without DB/isolation; frozen install, smoke and scripts/verify-executor.mjs pass. Evidence includes final logs, synthetic CLI result, source manifest and self-review repairs. No browser/UI claim is made for this CLI-only addition.
- Limits: fixed reviewed Python stdlib recipe in existing WSL2, not a newly dedicated worker appliance; no seccomp allowlist; local owner-controlled evidence not yet catalog indexed; manual inspection for Git-side crash recovery; costs not monetarily metered; success is conventional build completion rather than independent acceptance. T12 adds runtime builder/review/QA; T13 adds artifact/private preview paths; T17 audits broader workloads.

| Requirement | Current status                                     | T11 evidence / remaining gate                                                                                                           |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C30         | partial (real reviewed-template boundary verified) | Namespace, mount, network, resource, lease, tree-cancellation and cleanup gates passed; broader-hostile-workload audit T17              |
| C33         | verified local owner path                          | Separate repo/task/review worktrees, frozen task-to-commit lineage and preserved conflicts; catalog/runtime integration remains T12–T13 |

## X05 — independent desktop first slice (October 19, 2026)

Owner authorized starting X05 while Claude Code works on X03/X04. Prompt-library
prerequisite is T13 only. Owner reports X01/X02 complete; their source is not in
this checkout, and their acceptance was not reverified. Existing dirty changes
were preserved. All application changes are new files under apps/desktop; no API,
database, shared contract/UI, package manifest or lockfile edits were made.

Added a Tauri 2 shell source displaying the existing local shared web UI/API proxy
at the default port, with same-origin navigation restriction and no native IPC
commands/plugins/capabilities. Direct Rust dependencies pinned from official docs.
Native build/startup is unverified: cargo/rustc absent; MSVC/WebView2 not checked;
Cargo.lock, packaging and updater verification remain outstanding.

Added executable local source-archive import/inspection CLI. Shared T13 manifest
schema, separately supplied workspace/artifact/manifest hash, bounded archive
hash/size and per-file inventory are checked. Reuses strict executor ustar/path
validation. Unique pending-to-published entries, synced writes, dated read-only
receipts, concurrent import isolation and re-read tamper detection are implemented.
Cache receipts grant no authority, do not promote blocked/fixture manifests and
require online revalidation. No extraction, editor/launch or worker dispatch.

Executed node node_modules/typescript/bin/tsc -b successfully. Final focused Windows
suite: 3 tests pass, 0 fail/skip, including real CLI inspect, spaces, concurrent
imports, wrong identity/hash/inventory, tampering, oversized input and junction
rejection. Evidence: tracking/evidence/x05/artifact-cache-test.log. Initial fixture
used uppercase filename refused by the existing portable-path contract; fixed the
fixture. Sandbox junction creation was denied; authorized unrestricted rerun passed.
Prettier checked desktop JS/JSON/Markdown; git diff --check passed. The pnpm wrapper
stalled without output and was interrupted; installed Node CLIs performed build
and formatting directly. No full-suite, browser or native Tauri gate was run.

X05 is PARTIAL, not accepted. System-browser session handoff, durable paired device
identity/challenges, outbound scoped worker leases, revoke/pause/shutdown, native
source download/editor opening/isolated launch and installer/update acceptance
remain. Those API/database/shared UI changes are intentionally pending coordination
with X03/X04. Next eligible prompt: continue X05, not X06.

## Public-release runbook coverage (October 20, 2026)

Owner requested explicit public-release deliverables. Added docs/COMPLETION_RUNBOOK.md §5.2 gates for supported systems/prerequisites, clean-machine install/upgrade/recovery, download and user documentation, license/notices/privacy, and exact-candidate security review/vulnerability response; §5.6 now requires this evidence for public Windows readiness. Private §2.1 acceptance remains distinct. Claude is currently implementing §2.1; that section, its handoff and runtime files were not changed by this documentation task. No release functionality or public publication is claimed. Verification: targeted Markdown formatting and diff review. Next eligible prompt remains the in-progress §2.1; no automatic advancement.

## File upload/download milestones (October 20, 2026)

Owner requested relevant upload/download functionality and workflows in the completion runbook. Added §2.6 storage/transfer lifecycle; §2.7 uploads, attachments and research-source extraction; §2.8 original/source/result downloads and bounded exports; §2.9 browser/native end-to-end acceptance. Group 3 and §5.6 now require file lineage/export evidence; §5.2 documentation is referenced. Includes permissions, provider-sharing grants, supported-type limits, isolation, cancellation/recovery, retention, backup/restore, export redaction and integrity. These are planned milestones, not implemented features or activation authority. Claude's in-progress §2.1 scope/handoff and runtime files were not changed by this task. Next eligible remains §2.1 in progress; no automatic advance. Checks: targeted Markdown formatting and whitespace validation; no runtime tests for this documentation-only change.

## Routing, file tools and usability roadmap (October 20, 2026)

Owner requested refinement of model allocation/optimization, broad file operations/conversion, keyboard navigation and an Obsidian-like relationship map, plus additional useful UX ideas. Added COMPLETION_RUNBOOK §2.10–§2.15 with bounded prompts, existing X01/X02/X03 reuse, independent acceptance gates and delivery priorities. Routing foundations are documented as fixture-verified, not real-model qualification. File capability matrices replace an impossible universal editing/conversion claim. Added autosave/recovery, run/decision center, diffs/restore, reusable templates, quiet notifications, accessibility and task-based usability validation. These are planned scope, not implementation, empirical demand or provider/public activation. Claude's §2.1 runtime scope/handoff remains untouched by this documentation task. Next eligible remains §2.1 in progress; later prompts require selection. Verification: targeted Prettier and diff whitespace checks; no runtime tests for documentation-only changes.

## Undo/redo and navigation continuity plan (October 20, 2026)

Owner requested smooth undo/redo, page Back/Forward and related navigation workflows. Existing ui.tsx route history and planned §2.11/§2.12/§2.14 coverage inspected; added COMPLETION_RUNBOOK §2.16A/B to make unified behavior and acceptance explicit. Covers visible history controls, restoring search/scroll/focus/drafts, breadcrumbs/recent/reopen views, scoped editor and reversible command histories, version conflicts, trash/restore and honest external-action limits. Core navigation/basic editor undo is prioritized in the first useful release; later reversals follow their library features. Documentation only; no runtime or §2.1 handoff changes. Checks: targeted Markdown formatting and whitespace validation. Next eligible remains the selected §2.1 implementation; no automatic advancement.

## Owner decisions recorded — October 20, 2026

Jordan accepted all runbook recommendations with final revised #1/#2/#4/#5/#10/#34. Canonical register: tracking/OWNER_DECISIONS_2026-10-20.md (#1–#52 and RD1–RD10), including accepted deferrals and remaining identity/activation/research gates. Runbook, project/context policy, prompt-library pointer, desktop handoff/guides, routing/GitHub/local-studio guides and integration tracking now reference current choices. Spending config change_rule metadata reconciled with accepted future Settings control; exact $20 values unchanged. No runtime code, provider activation, paid dispatch, publication, pilot start or protocol freeze. Existing config/evidence retains actual-state authority. Claude's newer §2.1 evidence preserved: interactive acceptance remains pending and close-to-quit implementation must be reconciled with owner-selected configurable default tray. Next eligible afterward remains §2.2, requiring selection. Verification: targeted Markdown/JSON formatting, whitespace, local-link and decision-ID coverage checks; no runtime tests for documentation/metadata-only changes.

## Durable draft sign-in boundary clarified — October 20, 2026

Owner confirmed same-user recovery after sign-in, with drafts inaccessible while signed out or under another account. COMPLETION_RUNBOOK §2.16A and owner decision register now explicitly require protected retained drafts, current studio/workspace/record access checks, explicit discard/expiry and negative cross-account/revocation tests. This is planned durable recovery; current session-memory behavior is unchanged. Targeted Markdown formatting/whitespace checks executed. Next work remains native acceptance of the draft candidate and remaining §2.1 gates, then separately selected §2.2.

## App-wide file drop planned — October 20, 2026

Owner requested dropping files anywhere in the app to add them to Sources/Library without leaving the current page. Expanded COMPLETION_RUNBOOK §2.7 and owner register: current-workspace destination overlay, transfer tray, global picker alternative, specific attachment-target precedence, single ingestion/deduplication, draft preservation, workspace binding at drop time and sign-out/access handling. Includes browser/native negative and normal acceptance cases. Planning only; no runtime upload support, provider transmission or activation added. Targeted Markdown formatting and whitespace checks passed. Next work remains candidate native acceptance/remaining §2.1 gates; §2.2 afterward by selection.

## Final UX/UI release gate planned — October 20, 2026

Owner requested a final overall UXD/friction pass after functionality is integrated. Added COMPLETION_RUNBOOK §5.6.1 covering complete browser/native journeys, navigation/draft continuity, running/completed/changed/error feedback, durable receipts, recovery, notification restraint, accessibility and consistency. Requires observed findings, prioritized repairs, post-repair verification, owner walkthrough and exact-candidate evidence; §5.6.2 final acceptance now requires the pass. Deferred functionality is explicitly scoped; existing user-test consent/authorization boundaries preserved. Updated owner register. Documentation only; targeted formatting/whitespace checks passed. Current implementation/acceptance status and next eligible work unchanged.

## Completion runbook §2.5 — evidence retrieval implementation (October 20, 2026)

Implemented a disabled Brave raw-web-search candidate through the existing ModelBroker and authenticated POST runs/:id/source-searches route. Existing HTTP SourceBroker retained after inspection. Search binds query/sent query, policy/response hashes, timestamp and ranked unverified snippets; filters exact approved domains, bounds request/response, never promotes snippets to passages, and conservatively holds uncertain billing (including HTTP 429). Uses existing grant/budget/idempotency/cancel enforcement and local secret-file references. Run/workflow cancellation now aborts source fetches; adapter exceptions become durable failed retrievals. Guide: docs/RESEARCH_RETRIEVAL.md.

Executed: TypeScript build; formatting of changed files; 34/34 research/broker/API checks and 12/12 final search/budget/global-ceiling checks on disposable PostgreSQL 18 at loopback 55439 (overlapping suites). Evidence: tracking/evidence/research-2-5. Initial restricted loopback EACCES and stopped Docker port 55433 ECONNREFUSED retained as environment failures in the evidence README. Existing research API test leaves a handle after its passed subtest; final suite used Node --test-force-exit after test completion. No saved studio database migrated, live provider request, account activation, paid dispatch, desktop rebuild or UI/native acceptance.

Migration 25 adds the Brave provider constraints; coordinate that number with concurrent Claude §2.4 work before applying anywhere durable. No desktop/auth/subscription implementation files touched. Readiness promotes only source-search implementation/fixture/contract; live/activation remain unverified. §2.5 is PARTIAL until account-specific terms/pricing, protected credential, local/subscription prerequisite verification and a recorded bounded live search/fetch grant are available. Next eligible prompt: finish §2.5 live qualification through the actual application; no automatic §2.6.

## §2.4 plan clarification — October 20, 2026

Jordan confirmed ChatGPT Plus. Q2 resolved in docs/CODEX_INTEGRATION.md and proposed ADR-0042; plan is owner-reported, connection/eligibility unverified. Shared plan usage must account for Creator Agent and personal Codex use. No other proposed decision accepted, activation authorized or code changed. Next eligible work remains the selected milestones and their documented gates.

## PR #43 CI repair — October 20, 2026

GitHub Actions runs 39403134152/39403141239 exposed unformatted
CODEX_INTEGRATION.md and a storage migration assertion still expecting schema 24
following migration 25. Applied Prettier and updated the expected version to 25;
no runtime behavior or acceptance gate changed. Direct TypeScript build, full
repository formatting check and 7/7 storage tests passed on disposable PostgreSQL
18 databases. Initial local role mismatch and test-port conflict were environmental
failures; isolated cluster on 55579 resolved them. GitHub PostgreSQL 16 rerun pending.
Next eligible milestone remains outstanding section 2.1 native acceptance; no
additional milestone authorized by this CI repair.

## Studio chat and theme-free discovery roadmap — October 20, 2026

Owner feedback incorporated through U04 into COMPLETION_RUNBOOK §2.17/§2.18 and
requirements C52/C53; rationale in DECISIONS. Planned central chat supports prompt/
source intake and linked actions; Explore for me derives evidence-backed concrete
briefs without a user theme, within explicit resource/source/oversight limits.
Inspected submit.tsx and SearchBriefBodySchema: current discovery requires a theme.
Documentation-only; no feature implementation, live dispatch, schedule activation,
budget change or frozen study modification. Checked diff/section references; no
runtime tests needed. Existing uncommitted implementation/evidence preserved.
Next eligible: select §2.17's bounded intake slice or §2.18's manual exploration
slice after required source/model gates; no automatic milestone progression.

## Billing-aware theme submission feedback — October 20, 2026 (planning)

U04: owner reports mandatory budget/pricing snapshots conflict with plan-only use.
Inspected submit.tsx: readiness requires both an envelope and pricing snapshot;
brief budget text is separate but confusing. Added COMPLETION_RUNBOOK §2.19 for
simple draft intake, distinct solution constraints, typed subscription/local/API
resource admission, internally resolved API pricing and no extra metered spend for
plan-only runs. Plan access/summary qualification does not qualify discovery roles.
Documentation only; no runtime changes or live calls. Diff whitespace check passed.
Next eligible: bounded §2.19 discovery-route/admission implementation and required
role qualification, preserving frozen studies and existing uncommitted work.

## App/workflow alignment review — October 20, 2026

Source-based review: docs/WORKFLOW_ALIGNMENT_REVIEW_2026-10-20.md records nine
prioritized findings and proposed edits to existing runbook sections. Direction
aligns overall; plan-to-workflow dispatch, evidence-first intake, in-app build/
revision transitions, route/data/limit setup and stale delivery/readiness text
remain gaps. User requested findings before adding scope; runbook unchanged this
review. No runtime tests, live dispatch or native walkthrough executed. Existing
changes preserved. Next eligible planning action: owner selects proposed refinements;
then amend existing sections and choose a bounded implementation prompt.

## Accepted workflow-alignment planning — October 20, 2026

Owner accepted all nine findings and native plan search/Agent Reach comparison
for later implementation. Runbook impact map covers §2.5A native search first,
selective upstream comparison, §2.10 shared resource settings, §2.14 onboarding,
§2.15 status reconciliation/delivery order, §2.17 research handoff, §2.19A role
workflow dispatch/worker parity/effective limits/data sharing and Group 3 in-app
spec/build/package/revision. These are plans, not implemented/activated features.
Official plan docs permit web search subject to model/account/workspace policy;
current app integration/qualification is missing. Agent Reach remains a candidate,
not an installed dependency or replacement provider. No spending, schedule or study
changes. Next eligible prompt: §2.15 current-status reconciliation, then explicitly
select a bounded dependency-complete implementation slice. Documentation checks
only; no runtime tests/live calls. Existing unrelated changes preserved.
