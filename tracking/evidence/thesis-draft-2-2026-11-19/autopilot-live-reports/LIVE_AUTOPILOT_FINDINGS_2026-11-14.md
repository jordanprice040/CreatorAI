# Live autopilot findings (2026-11-14, dev studio main 5809f09, gpt-6-astra ChatGPT plan)

There were three runs, all at $0 and using 13 plan requests in total. Evidence notes (uncommitted) are in C:\dev\creator_agent_main\tracking\evidence\p13-first-live-autopilot-2026-11-14\.

## Runs
1. **Run it for me, no web search** (run 636849e5, autopilot 6a2e12c9). It stopped at explore with "not enough evidence": only 8 of 22 claims had passages, and all were about CSV tools. 1 request.
2. **Run it for me, web search first** (run 654993cc, autopilot f03f9987). It added 8 web claims automatically, explore picked duplicate QuickBooks bank-feed downloads, brief and discovery produced 5 options, and assess was refused because the per-run request cap was reached. 10 requests.
3. **Automate the rest from assess** (run f788f3af, autopilot 746a9a0c). It wrote 7 scorecards, then choose stopped with "needs a person": the 3 candidate options have unknown feasibility burden, maintenance burden and stakeholder acceptability. 2 requests.

## Fix list
- **BUG:** the form accepts a 40-call cap, but config/connections/chatgpt-plan.json caps each run at 10 requests. A whole process with web search therefore can't get past discovery on the plan. The stop text "Assessment route is not ready" misnames the cause.
- **GAP:** option texts cite draft claim references from discovery that the assessor can't resolve, so the discovery-to-assessment handoff breaks.
- With thin public evidence, the assessor leaves burden and acceptability unknown, so web-evidence runs will usually stop at choose for a person.
- The stopped card hides the model's research ideas, doesn't link to the exploration, and suggests no next step such as "Search the web first".
- Nothing warns before start that claims without passages are skipped.
- The end time isn't recalculated after a stop.
- The run's routine approvals stay active until the end time after the autopilot ends.
- "Automate the rest" has no "new run" option, so the only way to start it on a new run is through the API (or via Run it for me, which also starts a discovery).
- The "Run it for me" confirmation box stays ticked after a run, so one click on Start begins another whole run.
- A web-evidence problem leaves every option with an unresolved ethics/access gate and no claims of its own. Decide then offers only Research further, Defer or Reject, so Continue from choose can't advance it. The stopped card should say this rather than only "score them under Decide".
