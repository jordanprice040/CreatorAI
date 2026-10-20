# Owner decisions after the 2026-10-20 audit

Jordan made five decisions after the full audit
(`/mnt/project-files/audits/2026-10-20-codebase-audit.md`, items N1, N2, N4, R1 and R2). This
page says what the code now enforces for each, how it was checked, and what it does not
cover. Everything was verified in the cloud test environment (Linux, PostgreSQL 16) with
fixture and stand-in data. No live call was made and nothing was spent.

## 1. Device pairing limits (N1)

Opening a pairing request still needs no sign-in, and completing it still needs a signed-in
owner's approval from the browser. New limits, all checked under one lock:

| Limit                                          | Per visitor | Whole server |
| ---------------------------------------------- | ----------- | ------------ |
| New requests in any five minutes               | 5           | 30           |
| Requests still pending (not used, not expired) | 3           | 15           |

Each visitor's share is well below the server's, so one visitor cannot use up pairing for
everyone. Requests expire five minutes after they open (unchanged). The visitor is the
socket address locally; in hosted mode it is the last `X-Forwarded-For` entry, which the TLS
proxy appends (earlier entries are whatever the client sent and are ignored). Only a salted
SHA-256 of the address is stored (migration 23), and the salt changes on every restart.

Limits: many different addresses together can still reach the server limit; that needs a
rate limit in the proxy in front of a hosted deployment, which does not exist yet.

## 2. Portfolio scheduler failures (N4)

The scheduler is still off unless `CREATOR_PORTFOLIO_SCHEDULER=on`. Every pass now records,
durably, per workspace and for the sweep itself: last attempt, last success, current error
code and message, consecutive failures and the next retry time (`portfolio_scheduler_state`),
plus an append-only history of each failure (`portfolio_scheduler_failures`).

- Retries back off: 30 s, doubling, at most 30 minutes.
- After 5 failures in a row a workspace stops until its owner resumes it:
  `pnpm cli portfolio-command <workspace> scheduler-resume '{"reason":"..."}'`
  (audited as `portfolio.scheduler_resumed`). The sweep itself only backs off.
- `/api/health` shows `portfolio_scheduler` with state (`off`, `not_run`, `ok`, `failing`,
  `stopped`, `unavailable`), times and the error code; messages stay out of the public
  health check. `pnpm cli portfolio <workspace>` shows the full row with the message.

## 3. Reinvestment and portfolio budgets (N2)

Nothing moves earnings automatically: eligible earnings stay unallocated capacity until the
owner allocates them. An allocation can now name `"target": "portfolio"`:

```powershell
pnpm cli reinvest-allocate <workspace> '{"amount_nano_usd":"5000000000","allow_partial":false,"envelope_name":"Reinvested portfolio budget","max_in_flight":2,"target":"portfolio"}'
```

That creates the envelope as before and records it as portfolio money
(`reinvestment_portfolio_allocations`). Portfolio runs in the exploration and improvement
lanes may then draw on it; maintenance runs may not, so the protected maintenance reserve
and its floor are untouched. The reinvestment cash reserve (`min_reserve_nano_usd`) still
bounds capacity. Each tranche is consumed once under the reinvestment lock and each
allocation is recorded once, so the same money cannot fund two budgets. Omitting `target`
keeps the old standalone behaviour, which portfolio runs still refuse.

## 4. Moving out of OneDrive (R1)

`scripts/move-out-of-onedrive.ps1` (Windows PowerShell 5.1) does the move without touching the
old checkout:

1. Refuses if the target (default `C:\dev\creator_agent`) or backup folder (default
   `C:\CreatorAgentBackups`) is inside OneDrive, if the target is not empty, or if the old
   checkout has uncommitted changes.
2. Clones every local branch, points `origin` back at GitHub, and saves each `git stash`
   entry as a patch under `.creator\moved-stashes` (stashes are not cloned; this includes the
   Strix/claude-mem stash on `claude/project-thread-mccbs5`).
3. Copies the ignored local files that matter (`.env*`, `.creator\` with products and the CLI
   session, private study inputs) and checks each copy's hash.
4. Installs, builds, runs `pnpm backup verify` against the Docker database (same named volume,
   so no data moves), takes `pnpm backup create`, restores it into a scratch database, verifies
   it, and drops the scratch database.
5. Prints how to retire the old folder: check for unpushed work, delete it yourself, then
   empty OneDrive's online recycle bin, which keeps copies of the synced private files.

Not run on your machine yet: it was written here and read through, but this environment has
no PowerShell or Docker. Run it, and send the output if any step fails.

## 5. The $20 ceiling (R2)

`config/spending.json` records a $20 overall ceiling on new Creator Agent runtime spending
from 2026-10-20, until you approve more by a reviewed change to that file. The T15 study
keeps its own $20 total (child work, retries, tools and reviews included) and counts inside
the ceiling, not on top of it.

- Every paid dispatch in a real workspace reserves through the budget broker
  (`BudgetStore.prepareAttempt`): workflow, study, portfolio, context and batch, routing
  benchmark and semantic search calls. Each one now also checks the ceiling under one global
  lock, across all workspaces and envelopes. Budgets, portfolio settings and reinvestment
  cannot raise it.
- What counts: settled cost, plus held exposure of in-flight and unknown calls, plus every
  open final study attempt at its full cap (its own calls are not counted twice).
- Any paid call with an unknown cost blocks every new paid dispatch until it is reconciled
  (`runtime_unknown_cost`). A call that would pass the ceiling is refused
  (`runtime_ceiling`) before anything is sent.
- Fixture workspaces are not money and are not counted.

What it cannot cover: development tools (this coding session, Codex), hosting, domains and
marketing bills have no paid path in the code. They are not dispatched by Creator Agent, so
no code can stop them; keep those under the same $20 by hand until you approve more.
