# Final UX pass: shell and wording (P-8, P-9, P-14, P-15, Budgets folds), November 14, 2026

Area thread "Polish app shell and wording". Source: `docs/FINAL_UX_PASS_FINDINGS_2026-11-14.md`, section 4 and Jordan's decisions in section 9. Decision record: ADR-0104 in `tracking/DECISIONS.md`. No migration.

## What changed

- **P-9, amounts.** `apps/web/src/amounts.ts` holds the exact `money` (moved from `budgets.tsx`, which re-exports it) and the Standard `cents` (half a cent up; `<0.01` for anything above zero and below a cent). `apps/web/src/money.tsx` `Money` shows cents in Standard and the exact amount on click, tap, Enter or Space (and as its title), and the exact amount in Advanced; what is left or available rounds down (`down`, review 1, L-4). Used on Budgets, Overview, Usage, Settings, Spending limits, Workflows, Funding, Payments balances, API key check results, Try costs, Search, Portfolio, Routine approvals and the Activity lines. Authorization places stay exact in both views: an approval's maximum (now `up to $5.00` instead of `5000000000 nano-USD`), the ceiling and limits, budgets to fund or allocate, prices, the charge preview and the check's run budget.
- **P-8, internal detail.** `apps/web/src/plain-words.ts`: `ACTION_LABEL` (every action type), `kindLabel`, `codeLabel`, `versionTag` and `plainEvent`, which reads a stored history line in page words with its amounts as parts. `EventLine` (`apps/web/src/event-line.tsx`) shows it on Activity, the side panel, Overview and a record's history. In Standard: no event numbers or subject ids on Activity (an "Open" link instead), run pickers and labels without the short id (`runLabel(..., id)`), no report hash on Decide or Scores, no content or spec hash and no target id on approval cards, standing approvals named by action and run name without `V1`, no discovery ids on Overview or Decide, uncertainty text without the run id (`plainUncertainty(..., ids)`), first versions without `v1` on Sources and the scorecard picker, and stored codes as phrases on approval cards. Advanced keeps all of it.
- **N-2.** `problemTitle` (`packages/db/src/workflow-store.ts`): a new discovered problem whose brief equals its observable problem is titled once.
- **N-3.** `tiedNames` (`packages/domain/src/autopilot.ts`): "3 options tie for first on suitability: “A”, “B” and “C”." with titles clipped to 60 characters and at most three named.
- **P-14.** Sources with no run: a "First, register a run for fetching" notice above the Fetch row with the Register button and a link to Discover › Search the web; the reason Fetch is off is shown beside it ("Fetch needs a run first (above)."), and the Next line names registering a run first.
- **P-15.** Pages whose line would only repeat the main path (Chat, Sources once it has claims, Settings, Models and others) now show the same Next banner as Projects (`pathBanner`: "Next: Go to the Freeze step on the main path." with the Open button) instead of a "Main path: … is next" line.
- **Section 6, Budgets.** In Standard, Pricing snapshots fold once pricing exists ("Pricing snapshots: 2 recorded"; open while there is none, since adding pricing is a main-path step) and Try a fixture call folds. Advanced shows both open. Monitor › Runs, Sources › Library and Discover's theme draft belong to the Discover thread; Decide's history fold to the Decide thread.

## Review 1 fixes (November 14)

Independent review: `/mnt/project-files/reviews/PR197_SHELL_WORDING_REVIEW_2026-11-14.md` (0 High or Medium, 5 Low, 8 nits).

- **L-1.** Budgets opens the Pricing snapshots fold only after pricing has loaded and is empty, so it no longer opens on the empty first render. The walk now asserts the fold is closed, not only present.
- **L-2.** Standard leaves out the remaining ids: the approval card names the run ("for run “…”") and counts evidence ("2 records cited"); Overview drops the run id on pending approvals and names failed workflows by role; the Budgets card, Usage's run list, and the Approvals and Automation fallbacks use `runRef` (the run's name, or "a run with no name"); Funding allocations drop the policy version and budget id. The other places the review listed (Freeze, Proposals, Humility, Assess, claim links, Checkout, Payments, Build, Gallery) also drop ids, hashes and commit prefixes in Standard. Checking this with a pending approval in place turned up two more, now fixed: worker lease history lines ("Gave a task to a worker") and action codes in approval questions ("Allow search the web on this run?", `plainText`).
- **L-3.** Budgets › Recent calls and the fixture call's result read the action and the call's state in words ("Model writing", "cost recorded").
- **L-4.** `cents(..., 'down')` and `Money down` round what is left or available toward zero: Budgets Available, Settings Left, Usage left, the portfolio's reserve, and funding capacity, usable liquidity, fresh sources and the period's remaining amount. Charges still round half up.
- **L-5.** The Sources link asks Discover's Search the web to show itself (`requestWebSearch()` with no prefill), which scrolls to it and moves focus to its heading.
- **Nits.** "an autonomous within scope run" (`withArticle`); Approvals › Runs reads the autonomy mode as "human-in-the-loop"; Coverage's target uses `kindLabel` ("spec"); the banner reads "Next: Go to the Freeze step on the main path."; `Money`'s unused `exact` and `decimalToNano` are gone; the `WorkflowStore` doc comment is back above the class; routine approvals show the maximum as money ("$12.50"); history lines carry "sim" or "$" from the workspace (`EventLine fixture`).

## Review 2 fixes (November 14)

Re-review: `/mnt/project-files/reviews/PR197_SHELL_WORDING_REREVIEW_2026-11-14.md` (all review-1 fixes confirmed; 1 Low, 5 nits).

- **R-1.** Standard drops the remaining ids and hashes: Try's package list, heading and Compare picker ("Spec v2 · built <when>"), Try's manifest facts (hashes and commit stay in Advanced; Standard shows the package's size), Devices' demo picker and job history (by spec and time), Build's recovery messages and stop reasons (`plainReason`: "Build waits for your approval"), the Monitor › Runs card (the role's name), Marketing's package picker, and the name-missing fallbacks ("an option no longer listed", "someone" for an unknown actor). Checked with a text dump of every Standard page after building and packaging an artifact on the throwaway studio (the API path of `tests/src/build-retry-web.test.ts`): 0 id or hash lines outside Sources › Library (moving to Advanced in the Discover thread). Devices' job history needs a paired desktop, so it is checked in code only.
- **N-a.** History amounts say their own unit: the spending ceiling is real money ("from $20.00 to $25.50"), and a simulated budget reads "100.00 sim" without "(simulated)" after it.
- **N-b.** Approval questions read "Allow “Freeze a spec” on this spec?".
- **N-c.** `plainText` rewrites only codes the studio knows, so a name someone wrote (`user_id`) stays as written.
- **N-d.** An unnamed run reads "Human-in-the-loop run".
- **N-e.** The PR body's checks are brought up to date.

## Review 3 fixes (November 14)

Third review: `/mnt/project-files/reviews/PR197_SHELL_WORDING_REVIEW3_2026-11-14.md` (2 Low, 3 nits).

- **L-1.** The routine approval summary (`routinePolicySummary` in `packages/contracts/src/oversight.ts`, which the page and the server both build from) states its maximum exactly in dollars: "up to $5.00 in total (the sum of each step's stated maximum)", "$0.004" for a sub-cent cap, with no "about" and no nano-USD figure. A page loaded before the upgrade gets the existing "review the summary again" conflict; stored summaries are a record and are not re-checked. Other nano-USD texts the server writes (runtime-ceiling refusals) predate this PR and are left for a follow-up.
- **L-2.** Assess › "Why these ratings" shows the route and when it was assessed in Standard; the problem version (v2 and later), role version, prompt hash, rubric version and workflow id are Advanced.
- **N-1.** Build stops read "Build needs your approval" or "Build was refused" for every admission outcome, without "decision none".
- **N-2.** Workflow role names are a `Record<WorkflowRole, string>` on Monitor › Runs and Overview, so a new role fails typecheck.
- **N-3.** Assess › "Show what was sent to the model" keeps rubric hashes and option references in Standard on purpose: it is an opt-in audit view of the exact packet, and opening it is the request to see that detail.

## Checks

- `walk.mjs` on a throwaway studio (ports 5183/4330/4340, throwaway PostgreSQL 16 database, fixture seeds, the test-double executor from `tracking/evidence/p1-build-retry/dev-double.mjs`): 21 checks pass (24 after review 1, adding the closed fold, Recent calls in words and the Search the web landing). Screenshots `01`..`09` here.
- A text dump of every tab in all four fixture workspaces in Standard, before and after: before, 126 lines carried short ids or hashes (Activity, Approvals, Decide, Overview, run labels) and there were 76 raw codes such as `derived_from`, `outside_grant`, `approve_once`; after, 0 id lines (the desktop pairing command, which a person types, is left out of the count) and 11 codes, all on Monitor › Workers (Advanced only) and Sources › Library (moving to Advanced in the Discover thread).
- Unit tests: `tests/src/web-plain-words.test.ts` (new), `web-display.test.ts` (cents, `<0.01`, exact parts), `web-next-step.test.ts` (`pathBanner`, the P-14 line).
- `scripts/ux-sweep.mjs` over all 156 shots of the selection workspace (after merging main with #193): 0 axe violations, 0 console errors, 0 failed API requests, no sideways scroll. An earlier run found a nested button (amounts inside Overview's Budget tile); amounts inside a button or summary now render as plain cents with the exact value as title (`inButton`). The only small targets left were the inline amount buttons, exempt under WCAG 2.5.8 as targets in a sentence; the sweep now skips them as it skips inline links (0 in a re-run at 1440 px).
- `pnpm typecheck`, `pnpm format:check`; `pnpm test:db` before the merge (1181 tests: 1147 pass, 29 skipped, the 5 known PowerShell-wrapper failures); after the merge, the web and autopilot tests pass.
