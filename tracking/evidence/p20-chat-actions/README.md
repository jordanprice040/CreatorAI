# P20 whole process from Chat: browser walk evidence (November 11, 2026)

Setup: cloud container, throwaway PostgreSQL database `p20walk` (schema 53), reviewer ports (web 5183, API 4330,
previews 4340), `node scripts/dev.mjs` with the worker on, fixture workspace only. No installed-app or dev-studio
data was used, no model plan was connected and no live provider was called.

`walk.cjs` drives one Chromium browser signed in as the owner (Standard view). Run it with
`NODE_PATH=$(npm root -g) node walk.cjs <out-dir>` against a running dev server.

## What the walk shows (`walk-output.txt`, `walk.json`, `audit-trail.txt`, `screens/`)

From an empty workspace to a recorded choice and a saved proposal, using only Chat. Every step is a card made from
a studio reply ("Do it here") or from "Do a step here", filled in one question at a time and sent with its own Send:

1. "What's next?" → fetch a page. With no run that can fetch yet, the card asks the address and then, in Standard
   too, "Fetching needs a run with a 24-hour fetch grant. Register a new evidence-gathering run?" (review M-1, N-9).
   A new evidence run, its 24-hour fetch grant, the fetch: done, 6 events.
   - A fetch from a site that is not approved (the run from step 1 is now the routine choice, so only the address is
     asked) is refused with the Sources form's own reason ("not-approved.example.org is not on the owner-approved
     source list"). The blocked retrieval is recorded and names the send, but it only records the refusal, so the card
     reads "Refused" (re-review L-6) with "1 audit event names this send as its cause".
2. Record a claim from the fetched passage (claim, link, support with an exact quote): done.
3. Set up a budget: Standard asked nothing (routine "Studio budget", 100 units, fixture pricing) and showed what it
   would do: done.
4. "Start a discovery about rural clinic appointment waits" → the theme is prefilled from the message; the card asked
   the brief, two fields, the claim it rests on and what it bears on; routine limits, oversight and response types
   were defaults. Brief, run, run registration, model-call grant and the discovery workflow: done. The fixture run
   proposed 5 options without asking at a gate.
5. Score an option (the human-led one): 6 criteria with rating, evidence and reason, gates, checks, confidence: done.
6. Record your choice: the selection route held it ("Needs a person: outside grant"), exactly as the Decide form is
   held, and the card reads "Held for a decision" (review L-3). "What's waiting for me?" → answer that decision from a card (Approve once) → "Send again with the same
   answers": the selection was recorded.
7. Save a proposal for the chosen option: done.
8. A stale card: a discovery card made from the claim at version 1; the claim was then revised to version 2; Send was
   refused before anything was sent ("… changed since this card was made (version 1, now 2), so nothing was sent").

`audit-trail.txt` lists each `chat.action_sent` event with who sent it and the events whose `causation_id` names it
(for example the answered decision: `grant.created, decision.answered`; the second selection: `grant.consumed,
action.evaluated, selection.recorded`). The only 4xx response in the walk is the intended stale refusal (409).

Not shown here (covered by tests instead): a model-suggested card (`tests/src/chat-answers.test.ts`, fake `claude`),
viewer and sender-only rules, unconfirmed and lost sends (`tests/src/chat-actions.test.ts`). Study-run and
human-only refusals come from the same routes and were not re-walked; `tests/src/chat-actions.test.ts` sends a
discovery card's own request against a human-only run and gets the form's `HUMAN_ONLY_DENIED` (review L-4).

Re-run November 11 after the review fixes (head after `6b510a4`) on a freshly created `p20walk` at schema 53; the
script answers the new run question and waits for "Held for a decision" (re-review N-7).
