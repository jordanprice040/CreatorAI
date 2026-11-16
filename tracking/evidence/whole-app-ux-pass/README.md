# Whole-app UX pass (November 15, 2026)

The Phase 2–3 UX pass named in the notifications plan, with the audit L-3 docs refresh (FULL_AUDIT_2026-11-12) folded in. Web CSS, three web components and docs only; no server, contract, migration or ADR.

## How it was walked

Throwaway studio in the cloud container: PostgreSQL 16 database `ux_pass`, migrated to schema 68, `tracking/evidence/p1-build-retry/dev-double.mjs` on ports 5183/4330/4340, `pnpm cli seed-selection` and `seed-discovery`. Never the installed app or the dev studio database.

- `scripts/ux-sweep.mjs` over all 27 tabs: Standard at 1440, 1024, 768 and 390 px, Advanced at 1440, light theme at 1440 (162 shots). Before and after: 0 axe serious or critical violations, 0 sideways scroll, 0 controls under 24 px, 0 console errors, 0 failed API calls.
- Each 1440 dark screenshot read by eye, and the 390 px ones for the main pages. The issues below came from that reading.
- `row-align.mjs` (here): controls in one flex row whose centres differ by more than 3 px, all tabs, folds open. Before: Files, Search, Activity and Chat's step row. After: none (Chat's composer label is screen-reader only).
- `tracking/evidence/ui-polish-borders/border-sweep.mjs` with folds open, both views: still 0 touching boxes on every tab.

## What changed

| #   | Where                                                                                                                               | Was                                                                                                               | Now                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Autopilot (Working or waiting, Start, How much is automated), Discover (Discoveries, Explore for me), Proposals (Why this response) | A boxed sub-section's heading sat 24 px below the box's top padding, 28 to 46 px of empty space                   | Starts at the box's padding (`.panel > h3:first-child` and `:is(.explore, .discovery-progress) > h3:first-child`) |
| 2   | Same sub-sections                                                                                                                   | Their opening paragraph was 15 px in full white, larger and brighter than the page intro                          | 14 px secondary text, 78ch, like the page intro                                                                   |
| 3   | Files, Search, Activity, Chat                                                                                                       | "Add files", "Search" and "Filter" sat 6 to 10 px below their row; Chat's "Do a step here" label too              | One centre line (stacked-form margins dropped in those rows)                                                      |
| 4   | Any `p.small` directly in a panel (Decide's "Passages count as current…", Library's time zone note, …)                              | `.panel > p` outranked `.small`, so the notes were 14 px                                                          | 12 px notes, as everywhere else                                                                                   |
| 5   | Monitor › Overview, Catalog                                                                                                         | "HUMILITY REVIEW" ran into "1 active"                                                                             | Kind column 132 px                                                                                                |
| 6   | Monitor › Overview, Recently finished and In progress                                                                               | Three rows all read "Discovery"                                                                                   | Each names its project, as Runs does                                                                              |
| 7   | Decide, Alternatives side by side                                                                                                   | The option kind held a 96 px column and the title wrapped under it                                                | Kind and title run on together                                                                                    |
| 8   | Discover, start cards                                                                                                               | A card with a short text had it pushed down, centred                                                              | Text under its title                                                                                              |
| 9   | Discover                                                                                                                            | "Switch to Advanced to start with a theme" sat mid-page (right edge of a 78ch column)                             | Right edge of the cards                                                                                           |
| 10  | Discover, Discoveries                                                                                                               | "Hide" was 15 px beside 13 px buttons                                                                             | 13 px                                                                                                             |
| 11  | Projects › Launch › Sell                                                                                                            | Tab "Sell", breadcrumb "Sell", heading "Payments"                                                                 | Heading "Sell"                                                                                                    |
| 12  | Models and connections › Devices                                                                                                    | Jargon ("Presence pairing grants no execution authority"), and the pairing commands broke mid-id inside sentences | Plain words, and each command on its own copyable line                                                            |
| 13  | Every page at phone width                                                                                                           | "Reset fields" took a line of its own above the heading (50 px)                                                   | Beside the heading                                                                                                |

Before/after pictures: `discover-`, `autopilot-`, `files-`, `overview-`, `devices-`, `decide-cards-` and `decide-390-before-after.png` (left before, right after).

## Docs refresh (audit L-3)

`docs/CURRENT_STATUS.md` (now main `f5728aa`, schema 68, installed app `fdc7ce0`, what the studio does now and a new matrix), `docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md` (the seven pages, Next banner, Standard/Advanced and the everyday path through web search, autopilot, model-drafted specs and trial labels), and `README.md` (web search and the autopilot; the "does not automatically search the internet" line was out of date).

## Seen and left alone

- Refresh buttons sit in different places on different pages (beside the heading, under the intro, in a filter row). Moving them is a layout change on many pages for little gain.
- Empty states on Approvals' "Waiting for you" are a plain line, elsewhere a dashed box.
- Monitor › Runs lists a finished discovery as "succeeded" while Overview shows its outcome ("insufficient evidence"). Runs is Advanced-only and its detail shows the outcome.
- The live walk on Jordan's PC was not part of this pass; nothing here needs it.

## Review 1 fixes

Report `/mnt/project-files/reviews/PR219_UX_PASS_REVIEW_2026-11-15.md` (1 Medium, 2 Low, 4 nits), all fixed:

- M-1: the Devices rules had split `.output pre, pre.commands`, so build output stopped wrapping. The rule is whole again.
- L-1: CURRENT_STATUS's "Next" names the open S0, benchmark and Claude groundwork PRs after this pass.
- L-2: Overview, Workers and Devices have no Reset fields (`NO_RESET` in `page-drafts.tsx`); their headings keep no room for it.
- N-1: the button is "Shut down worker", and the Devices text marks the button names. N-2: `PRODUCTS_ROOT` is a `<var>` placeholder, and the text says to replace it. N-3: the dead `.panel` entry left the heading rule. N-4: BUILD_STATUS names the widths and themes walked.
