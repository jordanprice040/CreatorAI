# Live autopilot rerun on main 42dce84 (#205 merged), 2026-11-15

Jordan's typed OK at 09:00 UTC: "OK upgrade the dev studio to main and start the autopilot, 40 calls, accept quote-checked web claims on for this run".

## Setup
- Dev studio: worktree C:\dev\creator_agent_mainrun, now on main 42dce84, schema 67. URL http://127.0.0.1:5273 (API 4410), per ADR-0108.
- Backup: C:\CreatorAgentBackups\creator_studio-pre-main42dce84-20261115T090104Z.dump.
- Autopilot e8b36bd9 (run e9da2ea1), 09:04–09:29 UTC. Settings: gpt-6-astra on the ChatGPT plan, Search the web first, public data, 40 calls.
- "Accept quote-checked web claims" was on for this run only and is now OFF again.
- Evidence (uncommitted): C:\dev\creator_agent_mainrun\tracking\evidence\p13-autopilot-rerun-main-2026-11-15 (README third-run section, record, screenshot).

## What happened
1. **Search:** 8 claims, all 8 accepted by the autopilot.
2. **Explore:** 3 candidates. "Disparate systems delay nonprofit operations" went on.
3. **Brief:** written from 2 claims.
4. **Discovery:** 1 problem and 5 options, with no "packet too large" error.
5. **Four rounds of assess, choose, gather.** Every choose stopped on unknown ratings:
   - round 1: feasibility, maintenance and stakeholder acceptability, on 3 options;
   - round 2: stakeholder acceptability, on 2 options;
   - round 3: maintenance, on 1 option;
   - round 4: stakeholder acceptability again, on 2 options.

   Gathers 1–3 each searched the web. Gather 4 had no searches left.
6. **Assess 5 failed.** Its retry was refused because the ChatGPT account's own usage limit was reached ("Plan requests pause; check ChatGPT Settings > Usage").
7. **End state:** needs_authority at assess. The card says "Stopped: needs an approval", and its next step is "Fix the connection". Nothing was chosen.

## Confirmed fixed (#205)
- **Call budget.** Finished steps keep only what they used: explore went 2→1, discovery 24→7, and each assess 4→2. calls_reserved is 26, which equals the sum of the steps and the 26 real requests (day count 37→63). The run got much further than the last one, which spent its whole 40 after 18 requests.
- **Claim accepting.** 26 claims were accepted by the autopilot (8+5+5+8) with no database error. 5 wait under Discover › Search the web.
- **Search note.** The claim count is no longer contradictory.
- **Spend:** unchanged at $0.00036 of $20. The studio's caps (30 per run, 100 per day) were not reached.

## New findings
1. **The gather question is still cut** at 300 characters (finding 6 follow-up). With three unknowns and long titles, the question loses its closing quote or ends mid-word ("…as a response to “Disparate syst"). Fix: shorten the option and problem titles inside the question so the sentence stays whole, and name at most two unknowns.
2. **The choose and gather notes lose their reason.** The tail (option names plus "searching the web about…") is long, so `fitNote` leaves too little room and cuts the reason itself. The gather-1 note ends at "Score them under ". Fix: give the reason a minimum share of the space, and shorten the names first.
3. **A usage-limit refusal is retried.** The assess-5 failure was retried even though the plan's usage limit refuses every request until it resets. Fix: treat a usage-limit refusal as a stop with no retry.
4. **The usage-limit stop has the wrong label.** It shows as "Stopped: needs an approval" with the next step "Fix the connection". It should say the ChatGPT usage limit was reached and the run can continue after it resets. While it waits, the run's approvals stay open.
5. **The retry note reads oddly:** "…ended failed: failed Trying the step again…".
6. **The gather loop does not settle.** Stakeholder acceptability came back as unknown in round 4 after it had cleared in round 3. Four rounds and 3 extra searches ended with no choice. Worth checking whether a re-assessment can return an unknown for a criterion an earlier round settled, and whether the loop should stop sooner and hand the choice to a person.
7. **Minor:** "Claims so far: The autopilot accepted…" has a capital letter after the colon.

The console showed 0 errors and 0 warnings.
