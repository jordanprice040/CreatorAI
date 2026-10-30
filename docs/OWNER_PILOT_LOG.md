# Owner pilot log

Runbook step 8. Accepted terms: tracking/OWNER_DECISIONS_2026-10-20.md #25–#32; hardware
limits: `config/owner-pilot.defaults.json` `hardware_limits`. Not started: the window, product
idea, accounts and build approval below are blank until Jordan gives them.

| Field                     | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| Window (America/New_York) | _not given_                                             |
| Product idea              | _not given_                                             |
| Workspace                 | _not given_                                             |
| Accounts the pilot uses   | _not given_                                             |
| Build                     | _not approved_ (installed now: main ac0f3e4, schema 32) |
| Hardware limit handling   | _not decided_ (the app does not enforce them yet)       |

## Stop rules

Stop the pilot at the first of these, and record which one fired:

- 3 consecutive failed runs.
- 120 minutes of owner intervention in total (voluntary use is logged but does not count).
- Any new metered spend (budget is $0), unknown cost, or no qualified route.
- Free system RAM below 8 GB: pause until it recovers.
- End of the 7-day window.

## Runs

One row per manual run. Intervention means time Jordan spent fixing, unblocking or working
around the studio; voluntary means ordinary use (reading, choosing, writing inputs).

| #   | Started (local) | What was run | Outcome | Failures in a row | Intervention min | Voluntary min | Lowest free RAM GB | Notes |
| --- | --------------- | ------------ | ------- | ----------------- | ---------------- | ------------- | ------------------ | ----- |

Totals: intervention 0 / 120 min; consecutive failures 0 / 3; new metered spend $0.
