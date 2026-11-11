# P19 follow-up: Decide and Proposals in Standard (November 11, 2026)

Setup: cloud container, throwaway PostgreSQL 16 database `decidewalk` migrated to schema 53, reviewer ports (web
5183, API 4330, previews 4340), `node scripts/dev.mjs`, `pnpm cli seed-selection`. Fixture route only; no installed
app or dev studio data, no live provider.

`walk.cjs` switches the owner's view through `/api/me/view-mode`, opens Decide and Proposals in each view and prints
what is folded, what stays in view and what "What will happen" says. `walk-output-2026-11-11.txt` is its output;
`screens/` holds the two forms in each view. The two `problems//explanation` 404s in the output are the known
pre-existing request from the Proposals explanation panel.

`walk-override.cjs` (review fixes) puts the override reason really in its fold: it records a selection that defers
every option with no reason on a fresh `cli seed-selection` workspace, then types into the folded field and clears it
from the keyboard, checking focus and value. It also checks the review marks and the optional-sections group on a
workspace with a saved proposal. Output in `walk-override-output-2026-11-11.txt`.
