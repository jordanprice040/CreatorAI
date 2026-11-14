# ADR-0100 browser walk: autopilot settings and Allow and continue

November 14, 2026, cloud container. Throwaway PostgreSQL 16 database `creator_autopilot_walk` (schema 63), review ports 5183/4330/4340 (`../owner-actions/stack.mjs`), fixture provider only, $0, no model call. Script: [`walk.mjs`](walk.mjs).

`seed-discovery` through the real CLI, then through the API a run whose routine approvals are `autopilotRoutinePolicy` for the autopilot, and an autopilot started at assessment of a seeded problem (the seed already records every problem the fixture explorer finds, so an explore start stops as thin evidence with every candidate a duplicate). The fixture rates every option the same.

Results (all PASS):

- The autopilot stopped at a tie (`stop_kind: tie`), and its read offers `allow_and_continue` first.
- The stopped card shows **Allow “Break ties” and continue** after Continue, with what the setting does (`01-stopped-card-allow.png`). The settings panel starts with Hands-off off (`02-settings-panel-off.png`).
- Pressing Allow saved the setting (settings version 1) and continued the autopilot; the fixed order (opportunity rank, fewer unknowns, worst case) cannot separate the fixture's identical ratings, so it stopped again at the tie, which is the honest outcome.
- **Turn on Hands-off** turns on every fallback except the ethics switch (3 extra searches, 1 retry) (`03-settings-panel-hands-off.png`).
- **Automate the rest** offers "A new run, made for this autopilot", and its button names the new run (`04-automate-rest-new-run.png`).
- At 390 px wide there is no horizontal scroll (`05-phone-settings.png`); no console errors.

The first pass showed each switch's checkbox on its own line and the level text still saying an ethics gate only the model cleared "always" stops; both were fixed and the walk run again on a fresh database.
