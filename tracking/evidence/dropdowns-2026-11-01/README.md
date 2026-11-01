# Record and run pickers walk, November 1, 2026

Evidence for the dropdown order and labels change (audit items 1 and 2,
`docs/REVISIONS_AND_NEXT_STEPS_2026-11-01.md` in PR #99). Run in the cloud container on a
THROWAWAY PostgreSQL 16 database (`creator_walk_dd`) with the dev studio on ports
5183/4330/4340, fixture provider only; no model, provider, GitHub or payment call; the
installed app and its data were not touched.

1. `CREATOR_DATABASE_URL=… CREATOR_API_PORT=4330 CREATOR_PREVIEW_PORT=4340 CREATOR_WEB_PORT=5183 node scripts/dev.mjs`
2. `pnpm cli login <code>`, then `seed-lineage`, `seed-discovery`, `seed-selection`.
3. `node seed.mjs <workspace>` adds the pilot's three look-alike problem titles and a run
   titled "Discovery: <theme>" to the seed-selection workspace.
4. `node walk.mjs <code> <workspace> <out-dir>` opens Decide, Scores and specs, Discover,
   Build, Monitor › Runs, Budgets and Approvals, Sources and GitHub, and records every
   record or run picker's options (with group headings in brackets) and selection.
   `walk.json` is the result; the `*-picker.png` files show three pickers opened as list
   boxes (a native dropdown doesn't render in a screenshot).

Results: every problem and run picker lists newest first and selects the newest (Decide and
Scores and specs open on the newest problem, not the one with the most options or the
oldest); the three look-alike problems read differently under one theme heading; runs read
"<theme> · <date> · <short id>"; the skeptic-review record picker is grouped by kind; no
page errors. All seeded records share one minute, so dates are equal here.
