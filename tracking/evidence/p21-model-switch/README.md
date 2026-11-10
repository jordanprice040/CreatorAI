# P21 current-model switch: browser walk (November 10, 2026)

Throwaway PostgreSQL 16 database in the cloud container, fixture workspace, Claude Code connection served
by the test suite's fake `claude` stand-in (no live model, no spending). Dev servers on 4330/5183/4340.

Setup: `pnpm build:code`, migrate a fresh database, start `node scripts/dev.mjs` with a 32+ character
`CREATOR_DEV_LOGIN_CODE`, `pnpm cli login <code>`, `pnpm cli seed-lineage`, then copy `seed.mjs` into
`tests/` and run it with `WS=<workspace>` (adds the connection, verifies `claude-walk-haiku` and
`claude-walk-sonnet`, saves chat answers on sonnet). `add-option.mjs <session.json> <ws> build` adds one
option under the seeded problem so Assess shows its form. `walk.cjs <out dir>` with `WS` and `CONN` set
runs the walk. Before the final run the `model_choices` row from an earlier run was deleted on this
throwaway database.

What `walk.json` records:

1. Before any switch: Explore, Discover and Assess default to the first verified model (haiku); chat
   answers use sonnet (its saved setting).
2. Switch to haiku in the top bar: "Chat answers use it too"; Chat now says "answered by claude-walk-haiku";
   every form shows haiku with the note that it is not qualified for its task (no qualified alternative
   exists in this workspace, so none is offered).
3. Switch to sonnet: Explore, Discover, Assess and the chat card all move to sonnet.
4. Picking haiku on the Discover form keeps haiku there, removes the note, and leaves the top bar on sonnet.
5. No page errors or failed requests.

Not walked: Build (fixture workspaces list no plan builders; covered by `planBuilderDefault` tests) and
Qualify (fixture connections cannot be qualified). The qualified-alternative button is covered by the
`preferredRoute` unit tests, not by this walk.
