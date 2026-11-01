# App audit walk, November 1, 2026

Evidence for `docs/REVISIONS_AND_NEXT_STEPS_2026-11-01.md`. Run in the cloud container on a
THROWAWAY PostgreSQL 16 database with the dev studio on ports 5183/4330/4340 (fixture
provider only; no model, provider, GitHub or payment calls; never the installed app's data).

1. `CREATOR_DATABASE_URL=… CREATOR_API_PORT=4330 CREATOR_PREVIEW_PORT=4340 CREATOR_WEB_PORT=5183 node scripts/dev.mjs`
2. `CREATOR_API_URL=http://127.0.0.1:4330 CREATOR_SESSION_FILE=… pnpm cli login <code>`, then
   `seed-lineage`, `seed-discovery`, `seed-selection`.
3. `node seedprob.mjs` adds three problem records with long, shared-prefix titles (like the
   pilot's) to the seed-selection workspace (the workspace id is hard-coded; edit it).
4. `walk.mjs <code>` opens all 24 tabs and records the what's-next line, visible dropdowns,
   page errors and overflow (`walk.json` is the trimmed result); `walk2.mjs` tests Chat
   replies and the Try line; `walk3.mjs` adds a problem while Decide / Scores and specs are
   hidden and checks whether it appears on return.

Results quoted in the audit: no page errors or overflow on any tab; record pickers oldest
first; Decide defaults to the problem with most options, Scores and specs to the oldest;
identical clipped problem labels; the same what's-next line on all 24 tabs; a problem added
while Decide was hidden did not appear on return or after 16 s.
