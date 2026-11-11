# P19 Standard and Advanced: browser walk evidence (November 11, 2026)

Setup: cloud container, throwaway PostgreSQL database `p19walk`, reviewer ports (web 5183, API 4330, worker 4340),
`node scripts/dev.mjs` with the worker on, fixture model route only. No installed-app or dev-studio data was used and
no live provider was called.

`walk.cjs` drives two Chromium browsers (A and B) signed in as the same owner. Run it with
`NODE_PATH=$(npm root -g) node walk.cjs <out-dir>` against a running dev server. Before the final run the owner's
`person_preferences` row was deleted, so the walk starts from a person who never chose a view.

## What the walk shows (`walk.json`, `walk-output.txt`, `screens/`)

- First sign-in is Standard, and the server reports `version 0` (never chosen).
- Getting started on Chat lists the five steps with one marked Next. Each step turns Done as the walk records it.
- Standard tabs: Projects hides Launch, Monitor hides Workers and Settings hides Study, each with an "in Advanced"
  button. Opening the Workers route directly still works in Standard, and the Workers tab shows while it is open.
- Folded forms in Standard, each with a visible summary of its defaults:
  - Evidence cite form: only "Kind of evidence" is folded. Basis and stance stay open.
  - Discover: routine details, response types and model access.
  - Scorecard: four routine checks fold, and unanswered ones become "unknown". "Evidence against it" and "What they
    do today" stay visible (review L-1).
  - Humility review: the three optional lists.
- Each start or save shows "What will happen" first.
- Budget defaults on the fund form are "Studio budget" with a cap of 100 (fixture mode only).
- The main path runs end to end without Advanced (`advancedClicks: 0`): evidence, budget, discovery run, scorecard,
  humility review, and Decide. The run's human-in-the-loop gate asked once on Monitor › Approvals, and the selection
  was recorded again. A proposal was then saved, and Getting started went away.
- Switching to Advanced in browser A is stored on the server (`version 1`). Browser B then opens in Advanced and shows
  the same tabs and fields with no folds (parity). B switches back to Standard and A picks that up.

The walk output, `walk.json` and screens 01–08 are from the rerun after the review fixes (November 11, fresh
database at schema 52, merged with main through #163).

## Earlier walk on a seeded workspace (screenshots 09 and 10)

`cli seed-selection` was used to reach Build. The spec revise form folded the per-task role, file scope and
waits-for, plus data, risks and upkeep. Stored values showed as "as in vN". The Start build form folded the run,
budget, pricing and humility selects behind a summary and showed "What will happen". The build request was sent and
stopped at the server admission gate (waiting for a human), as before P19.

## Known, not from P19

The browser console showed one 404, `problems//explanation`. It comes from the response-explanation panel on
Proposals, which asks for an empty problem id. That code is in `proposals.tsx`, which P18 (PR #162) rewrites.
