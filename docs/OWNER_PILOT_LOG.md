# Owner pilot log

Runbook step 8. Accepted terms: tracking/OWNER_DECISIONS_2026-10-20.md #25–#32; hardware
limits: `config/owner-pilot.defaults.json` `hardware_limits`. Owner inputs below are Jordan's
thread reply of 2026-10-30 07:13 UTC, which also approved running the pilot on the installed
build as it is and asked Claude to set the WSL memory cap.

| Field                     | Value                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window (America/New_York) | 2026-10-30 03:15 EDT to 2026-11-06 03:15 EST (clocks change Nov 1)                                                                                                                                                                                              |
| Product idea              | Software to practice timing keyboard and mouse inputs, for gamers and speedrunners                                                                                                                                                                              |
| Workspace                 | Jordan's Creator Studio (installed app)                                                                                                                                                                                                                         |
| Accounts the pilot uses   | ChatGPT plan and Claude Code (Claude subscription). Jordan connected Claude Code in the installed app on 2026-10-30 03:20 EDT: signed in, extra usage confirmed off, caps accepted (30/day, 10/run), claude-sonnet-5-5 verified and qualified (see setup below) |
| Build                     | Approved as is: installed main ac0f3e4, schema 32                                                                                                                                                                                                               |
| Hardware limit handling   | Run without enforcement (Jordan's choice); free RAM is watched and logged by hand                                                                                                                                                                               |
| WSL memory                | `%USERPROFILE%\.wslconfig` `memory=8GB`, written 2026-10-30 (no prior file); WSL reports 7 GiB total                                                                                                                                                            |

## Stop rules

Stop the pilot at the first of these, and record which one fired:

- 3 consecutive failed runs.
- 120 minutes of owner intervention in total (voluntary use is logged but does not count).
- Any new metered spend (budget is $0), unknown cost, or no qualified route.
- Free system RAM below 8 GB: pause until it recovers.
- End of the 7-day window.

## Setup before the first run

- 2026-10-30 ~04:00 EDT, with Jordan's typed "OK qualify Claude": claude-sonnet-5-5 on the
  installed Claude Code connection (147e77aa…) qualified for summarization (55220983…,
  `summarization-synthetic-v1`, 2/2 development, 6/6 held out) and specification (db44619e…,
  `specification-synthetic-v1`, 2/2 and 6/6). 16 Claude requests, $0 metered; 19 of the 30
  daily requests used today including Jordan's verification checks. Run from the repo CLI
  against the installed API with a session file Jordan created himself.
- The ChatGPT plan (gpt-6-astra) already had research_synthesis, candidate_generation and
  scoring qualified (Jordan's screenshot).

## Runs

One row per manual run. Intervention means time Jordan spent fixing, unblocking or working
around the studio; voluntary means ordinary use (reading, choosing, writing inputs).

| #   | Started (local)  | What was run                                                         | Outcome                                                                                                                                                                | Failures in a row | Intervention min | Voluntary min | Lowest free RAM GB | Notes                                                     |
| --- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------- | ------------- | ------------------ | --------------------------------------------------------- |
| 1   | 2026-10-30 04:30 | Add evidence: fetch https://www.idiocode.com/blog/frame-perfect.html | Failed: "live fetch not configured". The installed app has no setting to turn on source fetching (the desktop clears its environment and studio.json has no host list) | 1                 | _ask Jordan_     | _ask Jordan_  | 40.7 (at setup)    | Blocks discovery: claims count only with fetched passages |

Totals: intervention _pending_ / 120 min; consecutive failures 1 / 3; new metered spend $0.
