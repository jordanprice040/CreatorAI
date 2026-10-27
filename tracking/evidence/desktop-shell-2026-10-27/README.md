# Desktop-shell walkthrough of current `main` — October 27, 2026

Runbook step 5. Source: `main` at `3c42717` (PRs #1–#62) plus this branch's fixes. The
bundle reports "with uncommitted changes" because of an unrelated local edit to
`.codex/config.toml`.

## How it was run

- `node apps/desktop/build-studio.mjs`, then a debug `cargo build` of
  `apps/desktop/src-tauri`, started directly from `target\debug\creator-desktop.exe` with
  `CREATOR_STUDIO_RESOURCES` pointing at the staged bundle. Nothing was installed; the NSIS
  installer was not built (it would replace the installed app, which is step 7).
- `CREATOR_STUDIO_HOME` pointed at a throwaway folder in the agent's scratch directory.
  The installed app was not running, and its home
  (`%LOCALAPPDATA%\com.creatoragent.studio`) had no file changed after the walk began
  (checked with `find -newermt` before and after).
- The shell's fixed ports 5173/4310/4320 were free; the app-managed PostgreSQL picked 55440. No live provider, GitHub or payment call; every workspace was fixture.
- Driven through WebView2 remote debugging (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, set
  for these runs only) for page content, and Windows UI Automation for native dialogs and
  closing windows. Screen control was declined, so the native menu bar and tray icon were
  not clicked; their status-window and second-launch equivalents were used.
- Two homes: walk 1 on the unfixed build, walk 2 (fresh home) on the fixed build.

## What was exercised (walk 1, unfixed build)

| Step                                        | Result                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch, setup "new, empty studio"     | Pass. Native confirm, PostgreSQL 18.6 cluster created, layout initialised, service running in ~8 s.                                                              |
| Sign in as local owner (status window)      | Pass. Studio window signed in; DPAPI sign-in stored.                                                                                                             |
| New fixture workspace                       | Pass.                                                                                                                                                            |
| A discovery run from Submit                 | Pass, but only after claims and a pricing snapshot were added with the CLI using the window's session (a tester workaround; see D1). 13 fixture calls, 0.23 sim. |
| Quit (status window)                        | Pass. Service, ports and the app's PostgreSQL stopped; no process left.                                                                                          |
| Relaunch                                    | Pass. Sign-in and last workspace kept.                                                                                                                           |
| Quit one second into a run, relaunch        | Pass. Run created 07:41:30Z, quit 07:41:31Z, finished 07:41:51Z after relaunch.                                                                                  |
| Port 5173 held by another program           | Pass. "A studio port is in use", names the port; Retry after freeing it starts the studio.                                                                       |
| Second launch, same home                    | Pass. Exits 0, one instance left.                                                                                                                                |
| Close with "Keep running in the background" | Pass. Window hides, services stay up, one-time explanation shown; a second launch brings the window back.                                                        |
| Sign out on this computer                   | Pass. Stored sign-in removed; studio shows the sign-in panel.                                                                                                    |
| Download a Gallery package                  | Not exercised: a new desktop studio cannot produce a package (D2).                                                                                               |

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                 |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | High     | A new desktop studio cannot reach a first run from the app alone. Submit needs claims and a pricing snapshot; claims need a fetched source, fetching needs a registered run, and pricing can only be added with `pnpm cli pricing-add`. The CLI cannot sign in to the desktop service (per-launch code, never shown). | Recorded. Product scope for Jordan (in-app fixture setup, pricing form, run registration). The copy now says so honestly (F4).                         |
| D2  | High     | Packaging (`pnpm cli artifact-package`) runs only in the CLI's own product store, so a desktop studio never gets a Gallery package to download unless it was adopted with one.                                                                                                                                        | Recorded. Needs a design decision (in-studio packaging); overlaps runbook step 6.                                                                      |
| F1  | Medium   | `CREATOR_STUDIO_HOME` did not move WebView2 data: every run shared `%LOCALAPPDATA%\com.creatoragent.studio\EBWebView` with the installed app (cookies, storage).                                                                                                                                                      | Fixed: windows use the studio home as WebView2 data folder (same folder as before for the default home).                                               |
| F2  | Medium   | Setup preselected "Quit" on close, contrary to owner decision #2 (continue in tray by default).                                                                                                                                                                                                                       | Fixed: background preselected and marked default; saved choices on existing installs are unchanged.                                                    |
| F3  | Medium   | Setup recommended and preselected adopting the dev studio, contrary to decision #1 (recommend an empty new studio; offer adoption).                                                                                                                                                                                   | Fixed: new studio recommended and preselected; adoption still offered. "Restore a studio backup" (also #1) is not built: recorded.                     |
| F4  | Medium   | The desktop UI told users to run `pnpm cli seed-selection`, `seed-research`, `pricing-add`, `artifact-package`, `reconcile` and `plan-qualify`, none reachable from the desktop app; the top bar said "local development".                                                                                            | Fixed: in the desktop app those places say the step needs the command line, which the desktop app does not have yet; the top bar says "this computer". |
| L1  | Low      | Native confirm dialogs are titled "tauri.localhost says".                                                                                                                                                                                                                                                             | Recorded.                                                                                                                                              |
| L2  | Low      | Status window: "Recent activity" is collapsed and empty on first run although the log has entries; Save gives no visible confirmation.                                                                                                                                                                                | Recorded.                                                                                                                                              |
| L3  | Low      | Setup window repeats its heading ("Set up Creator Agent" then "Set up this computer's studio").                                                                                                                                                                                                                       | Recorded.                                                                                                                                              |
| L4  | Low      | Runs page text names `creator seed-discovery`, which is not a command.                                                                                                                                                                                                                                                | Recorded.                                                                                                                                              |

## Walk 2 (fixed build, fresh home)

- WebView2 data at `<home>\EBWebView` (not nested), installed home unchanged.
- Setup shows "Start a new, empty studio (recommended)" and "Keep running in the background
  (default)" preselected; `studio.json` saved `close_behavior: "background"`.
- Signed in: top bar "Local owner · this computer"; empty state, Submit, Gallery and Scores
  show the desktop wording (`submit-desktop-copy-after-fix.png`).
- Quit: no process or port left.

Files: `status-running.png`, `discovery-run.png`, `port-conflict.png`,
`setup-defaults-after-fix.png`, `submit-desktop-copy-after-fix.png`,
`supervisor-walk1.log`, `supervisor-walk2.log`.
