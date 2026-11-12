# P33 automation levels: browser walk (November 12, 2026)

Throwaway PostgreSQL 16 database `creator_p33` in the cloud container (not the dev studio or the installed app), `pnpm dev` on this branch, fixture workspace from `pnpm cli seed-selection`, Chromium through Playwright. No model call or spending.

- **Automate selection** on the first run: the panel showed the level's summary and the routine approvals the run gets (selection only, synthetic, 20 steps, no money), one tick confirmed both, and the run then read "Now: Automate selection … 0 choices started; Routine approvals: active, 0 of 20 steps used". Pressing it again on that run is refused with "This run already automates selection" (`panel-selection.png`).
- **Automate the rest** on another run, from the scores already recorded: the run's existing approvals were shown as already covering it (first press) and as widened to a later end time (second press); the autopilot started, and Run it for me listed it at once, marked "Automate the rest". It stopped as "Waiting for you" because the seeded problem already has a person's selection advancing several options (P13's M-1 rule), which is the honest outcome for this seed (`panel-rest.png`, `autopilot-card.png`).
- No console errors.
