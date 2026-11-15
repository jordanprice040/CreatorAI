# ADR-0111 browser walk: the Autopilot page

November 15, 2026, cloud container. Throwaway PostgreSQL 16 database `autopilot_walk` (schema 68), review ports 5183/4330/4340 (`../owner-actions/stack.mjs`), fixture provider only, $0, no model call. Script: [`walk.mjs`](walk.mjs); output: [`walk.txt`](walk.txt).

`seed-discovery` through the real CLI, then through the API two runs whose routine approvals cover an autopilot started at assessment of a seeded problem: one ending in 2 hours, one ending 75 seconds after it starts. The fixture rates every option the same, so both stop at a tie and wait for the person.

Results (22 of 22 PASS, after the review 1 fixes):

- The left nav reads Chat, Projects, **Autopilot**, Sources, Monitor, Models and connections, Settings, and the Autopilot entry counts 2.
- The page opens at `#/autopilot/run` with two waiting cards, each naming its problem and run and saying until when it can continue.
- With the page left open, the short autopilot's end time passes: it moves to Earlier autopilots, saying its end time has passed, with no Continue or Allow, and the nav count drops to 1 (review 1 H-1).
- The waiting card shows what to do next, then **Continue the autopilot from choose an option** and **Allow “Break ties” and continue**, then its steps (`01-autopilot-page.png`).
- The page holds, top to bottom: working or waiting, Start an autopilot, How much is automated, Autopilot settings (`02-levels-and-settings.png`).
- Discover no longer has the autopilot or automation panels; its **Run it for me** choice opens the Autopilot page.
- Continue on the page continued the autopilot; the fixture's identical ratings stop it at the tie again, which is the honest outcome.
- `#/autopilot/run?ws=…&id=<autopilot id>` opens that autopilot's card, here inside the folded Earlier autopilots.
- At 390 px wide there is no horizontal scroll (`03-phone.png`); no console errors.

Earlier passes: Continue and Allow and continue first sat stacked with touching borders (now a spaced column, Continue accented); the walk's nav check first read the Projects activity dot's text into the label (now dropped).
