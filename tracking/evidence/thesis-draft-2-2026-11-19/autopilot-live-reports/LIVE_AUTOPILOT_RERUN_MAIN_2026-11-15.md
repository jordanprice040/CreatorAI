# Live autopilot rerun on main 9172584 (schema 64), 2026-11-15

Dev studio only (worktree C:\dev\creator_agent_mainrun, DB creator_studio). Backup: C:\CreatorAgentBackups\creator_studio-pre-mainrun-20261115T032910Z.dump. Jordan typed OKs at 03:28, 03:33 and 03:37 UTC. Evidence (uncommitted): tracking/evidence/p13-autopilot-rerun-main-2026-11-15/ in that worktree.

## Run

Autopilot a6014f1b, run 830141f2, gpt-6-astra on the ChatGPT plan, Search the web first, 40 calls.

1. Search the web: claims_held stop (8 quote-only claims, search 508cd10e). 2 requests.
2. Jordan: "Accept quote-checked web claims" on for this run only (settings v4), via Allow and continue.
3. Search the web (try 2): went on from the held search, with no new search (#202 works). 7 claims were added; claim 8 failed with a raw DB error.
4. Explore: 3 candidates. It took "Recurring tasks require repeated manual section restoration", an Asana topic.
5. Brief: built from 1 claim.
6. Discovery: recorded a problem with 5 options. No "too large" refusal (#202 works). The packet had 1 claim and 40 catalog entries, 17,425 chars, with nothing left out.
7. Assess: 7 scorecards. Choose stopped on unknown feasibility or maintenance burden for 3 options.
8. Gather, then Assess, then Choose: stopped on the same unknowns.
9. Gather again, then Assess (try 3): refused, needing 3 calls with 0 left of 40.
10. Outcome: limit_reached at 03:50:34 UTC. Nothing was chosen. Routine approvals ended (P-11). The setting was turned back off at 03:51 (settings v5).

Totals: 18 real plan requests (day 13 → 29 of 100), 40 calls set aside, spend unchanged at $0.00036.

## Confirmed fixed

- Discovery ran in the busy workspace.
- Allow reused the held search.
- Set-aside calls matched real requests at the first stop.
- The card's Next text points to Search the web.

## New findings

1. **Claim admit error.** Accepting held claim 8 shows a raw database error: duplicate key value violates "claim_support_active". The claim was likely already supported by an existing passage. Admission should treat it as already present, or skip it with a readable note.
2. **Contradictory note.** The try-2 search note still says "8 checked claims wait for you… the setting is off", which contradicts its own last sentence.
3. **Cut-off note.** The card cuts the Choose note mid-word ("Gathering evidence for “H"). Likely a fixed-length display cut.
4. **Repeated sentence.** The first gather note repeats the "Linked 4 recorded claims…" sentence.
5. **Call budget.** With Hands-off, 40 autopilot calls ran out after two gather rounds, at only 18 real requests: calls are set aside per step's worst case. Consider a bigger default for whole runs with Hands-off, giving back unused set-aside on each step's finish (if not already done), or saying up front that Hands-off needs about 60.
6. **Gather rounds didn't help.** Two rounds (11 claims added) didn't resolve unknown feasibility or maintenance burden. Web claims may rarely address those dimensions, so the round may need a targeted question.
7. **Topic drift.** The web search's claims spanned Asana, late payments and shelter tech, and the run picked a one-claim Asana problem. Same as the earlier live finding: an unscoped search drifts.
