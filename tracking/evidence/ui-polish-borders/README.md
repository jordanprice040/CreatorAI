# Sidebar, borders and top bar polish (November 15, 2026)

Jordan's UI notes of 2026-11-15 (the Autopilot page is a separate thread). Checked on a throwaway fixture studio (ports 5183/4330/4340, throwaway PostgreSQL database, `pnpm cli seed-selection`), never the dev studio or the installed app.

- **Sidebar foot.** The theme button (now with its action in words, "Use light theme" or "Use dark theme") sits above Standard/Advanced in `.sidebar-controls`; the divider moved down to sit above "Local control". `sidebar-foot-after.png`.
- **Top bar.** The Model and usage pills are `<details>` and took the global 14 px `details` top margin, so they sat about 7 px below the crumbs, connection and sign-in text. `.usage` now has no top margin; every item centres on the same line (measured: all at 25.5 px). `topbar-before.png`, `topbar-after.png`.
- **Back to top.** Kept 24 px in from the right, so it lines up with the page panel's content instead of sitting on its right border.
- **Shared borders.** `border-sweep.mjs <standard|advanced>` (set `OPEN=1` to open every fold) lists bordered boxes and buttons that touch or overlap (gap -3 to 2 px) on all 27 tabs (26 plus the Autopilot page). Before: "Record this selection" on the "Why this response" box (Decide), "Refresh devices" on its "No paired devices." box (Devices), and, after an automatic assessment, "Assess again" on its run's state badge. A button on its own line in a panel, section, article or form now keeps 12 px from the block under it (element-only specificity, so a box with its own larger margin keeps it); the nested explanation panel and the assessment run keep 16 px. The sweep skips the closed top-bar usage popover (measured but not shown). After: 0 touching pairs in either view with every fold open. `record-selection-after.png`, `assess-again-after.png`, `refresh-devices-after.png`.

The sweep only sees the throwaway studio's state (one fixture workspace with a recorded selection and one automatic assessment); screens that need other records were not checked.

Checks (cloud, throwaway PostgreSQL 16): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` at 540c2ab (main with #213 merged in) 1351 tests, 1317 pass, 29 skipped, 5 known PowerShell-wrapper failures (need Windows).
