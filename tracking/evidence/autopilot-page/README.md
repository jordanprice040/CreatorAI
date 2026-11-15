# ADR-0111 browser walk: the Autopilot page

November 15, 2026, cloud container. Throwaway PostgreSQL 16 database `autopilot_walk` (schema 68), review ports 5183/4330/4340 (`../owner-actions/stack.mjs`), fixture provider only, $0, no model call. Script: [`walk.mjs`](walk.mjs); output: [`walk.txt`](walk.txt).

`seed-discovery` through the real CLI, then through the API a run whose routine approvals cover an autopilot started at assessment of a seeded problem. The fixture rates every option the same, so it stops at a tie and waits for the person.

Results (16 of 16 PASS):

- The left nav reads Chat, Projects, **Autopilot**, Sources, Monitor, Models and connections, Settings, and the Autopilot entry shows a count of 1 (the waiting autopilot).
- The page opens at `#/autopilot/run`. The stopped autopilot is first, under _Working or waiting for you_, with its border marked, what to do next, **Continue the autopilot from choose an option** and **Allow “Break ties” and continue** (`01-autopilot-page.png`).
- The page holds, top to bottom: working or waiting, Start an autopilot, How much is automated, Autopilot settings (`02-levels-and-settings.png`).
- Discover no longer has the autopilot or automation panels; its **Run it for me** choice opens the Autopilot page.
- Continue on the page continued the autopilot; the fixture's identical ratings stop it at the tie again, which is the honest outcome.
- At 390 px wide there is no horizontal scroll (`03-phone.png`); no console errors.

The first pass showed Continue and Allow and continue stacked with touching borders; they now sit in a spaced column and Continue is the accented button. The walk's nav check first read the Projects activity dot's text into the label; it now drops it.
