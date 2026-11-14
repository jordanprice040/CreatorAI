# UX pass P-3 and P-4: Decide approvals in place (November 14, 2026)

Setup: cloud container, throwaway PostgreSQL 16 database `decidewalk` migrated to schema 63 (main with #193 merged; the walks were rerun after review 1), reviewer ports (web 5183,
API 4330, previews 4340), `node scripts/dev.mjs`, `pnpm cli seed-discovery`, then one fixture automatic assessment of
the clinic problem (`POST runs/{run}/assessments`, fixture route, synthetic data). No installed app or dev studio data,
no live provider, no spending.

- `walk.cjs` opens Decide in Standard, prints "Which options can advance" and the one-step form, ticks every option
  (including the duplicate one that confirming cannot help), gives the first option its own access reason and fills
  the two shared reasons, presses Confirm, and prints the list again. Output: `walk-output-2026-11-14.txt`. Before:
  four options "Can advance once ethics and access are confirmed", one "Cannot advance yet … Discovery disposition:
  duplicate"; four ticked by default. Form: "What will happen: 10 gate confirmations for 5 options, 9 with a shared
  reason and 1 with the option's own." After: the four can advance now. About 30 actions on the old per-option
  buttons became 2 reasons and 1 press (plus ticks).
- `gate-events-2026-11-14.txt`: the ten `gate.confirmed` events from the database: one batch id, `reason_from` shared
  on nine and own on the first option's access gate.
- `walk-approve.cjs` decides every option (one to validation, the rest deferred) and presses Record. The run asks the
  owner's approval; the page shows "You approve this yourself", the coverage and a reason box filled from the
  rationale. "Approve once and record the selection" answers the decision and records the selection; the page never
  leaves Decide. Output: `walk-approve-output-2026-11-14.txt` (POSTs: selection 200 needing approval, decision answer
  200, selection 200 recorded). After review 1 the approval also shows Uncertainty and If wrong, offers "Was this
  question worth asking?" (the walk answers "unnecessary"), and sits outside the live region.
  `inline-decision-2026-11-14.txt`: the decision as stored: answered, approve_once, interruption unnecessary, requester
  and responder the same person.
- `narrow.cjs`: Decide at 390 px with the form shown: axe-core (WCAG 2.2 AA tags) on the section, 0 violations, no
  horizontal overflow. `screens/advance-390.png`.

The coverage block in the approval still shows internal words ("candidate · select", hashes); that is P-8, owned by
the Shell/wording thread.
