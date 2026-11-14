# Final UX pass: plan

November 14, 2026. Written against main `5809f09` (schema 62). Status: **draft for Jordan's approval**. Nothing in the pass starts until Jordan accepts this plan or sends revisions.

## 1. What the pass is for

Before payments, hosting and the thesis study, the app should be complete, usable and polished. A person who opens Creator Agent for the first time should be able to tell what it wants from them, take an idea from evidence to a product they can try, and fix anything that stops them, without reading a manual.

The pass checks every page and tab, runs the whole project path end to end, compares the app with accepted UX and accessibility guidance, fixes small issues directly, and brings bigger changes to Jordan as proposals.

**In scope:** the web studio (`apps/web`), which is also the desktop app's view (`apps/desktop` loads `apps/web/dist`); desktop-only screens (startup, sign-in, refusal boxes, back up and upgrade); user-facing docs (audit L-3).

**Out of scope:** the thesis study protocol, P32 GitHub App sign-in (owner-gated, after this pass), payments and hosting, and any change to server-side enforcement (permissions, budgets, gates, run modes). The pass can propose changes to how those are _shown_, never to what they allow.

## 2. The rule: fix small, propose big

Every finding gets a severity and a route.

### Severity

The pass uses Nielsen's severity scale, mapped to the project's review levels so it matches every other review:

| Level      | Nielsen        | Meaning here                                                                                                                           |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **High**   | 4, catastrophe | Blocks the main path, loses work, misleads about money, approvals or what was verified, or locks out a keyboard or screen-reader user. |
| **Medium** | 3, major       | The person can get through, but only by guessing, backtracking, or asking for help.                                                    |
| **Low**    | 2, minor       | Slows the person down, confuses briefly, or fails a WCAG 2.2 AA check with an easy workaround.                                         |
| **Nit**    | 1, cosmetic    | Alignment, spacing, wording, casing, an inconsistent label.                                                                            |

Jordan wants Lows and nits fixed too, so every level gets fixed or is explicitly deferred by him.

### Route

**Fix now** (in the pass's fix PR, then reported) when all of these hold:

- web or docs only: no migration, no ADR, no new API field, no contract change;
- it changes how something looks, reads, is ordered or is reached, not what the server allows;
- it does not move a tab or panel between Standard and Advanced;
- it does not remove a feature or change a default;
- it is easy to reverse.

Examples: spacing and alignment, contrast, focus rings, button wording, empty and error state text, a missing link to the next step, a missing `aria-label`, a panel that should open folded, a long intro cut to one sentence.

**Propose** (listed for Jordan with the change I recommend, done only after he accepts or revises) when any of these hold:

- it needs a server, contract, migration or ADR change;
- it moves, merges, removes or renames a page or tab, or changes the Standard/Advanced split;
- it changes a default or an owner decision on record (dark default theme, allowed work selected by default, 64,000 input cap, gate modes, and so on);
- it changes what an approval, budget or autopilot does, even if the change looks small;
- it is a redesign of a whole page or flow.

Each proposal says: what is wrong (with a screenshot), which guideline it breaks, the change I recommend, one alternative, and the cost (web only, or API, or migration).

## 3. What the app is compared against

| Reference                                                  | Used for                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nielsen's 10 usability heuristics** (NN/g)               | The per-page heuristic review in section 6. Each finding names the heuristic it breaks.                                                                                                                                                                                                                                                                                                                                                                           |
| **WCAG 2.2 level AA** (W3C)                                | Accessibility checks in section 6.K, including the criteria new in 2.2: 2.4.11 Focus Not Obscured, 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication.                                                                                                                                                                                                                          |
| **Fluent 2 and Material 3 layout guidance**                | Spacing on a 4 px base unit (Fluent's ramp; Material's 8 dp grid is the same rhythm doubled), a fixed type ramp, and window-size classes (Material: compact under 600 px, medium 600–839, expanded 840 and up) for the width checks. Windows is the main platform, so Fluent wins where the two differ.                                                                                                                                                           |
| **Laws of UX** (Yablonski)                                 | Hick's law (number of choices on a page), Fitts's law (target size and distance), Miller's law and chunking (long forms), Jakob's law (familiar patterns), Tesler's law (who carries complexity), Doherty threshold (feedback within 400 ms), goal-gradient and Zeigarnik effect (visible progress on the path), aesthetic-usability effect, von Restorff effect (one primary action stands out), and the Gestalt laws of proximity and common region (grouping). |
| **Progressive disclosure** (NN/g)                          | The Standard/Advanced split and folded panels (section 6.G).                                                                                                                                                                                                                                                                                                                                                                                                      |
| **NN/g error-message guidelines**                          | Refusals and errors: visible, in plain words, saying what happened and what to do, next to the problem (section 6.F).                                                                                                                                                                                                                                                                                                                                             |
| **Plain language** (plainlanguage.gov, GOV.UK style guide) | Copy: short sentences, second person, active voice, sentence case, no internal terms or ids.                                                                                                                                                                                                                                                                                                                                                                      |
| **The studio's own design notes** (`docs/UX_UI.md`)        | Tokens, the 4.5:1 contrast rule on every surface, the shell's four questions (where am I, what is happening, what needs attention, what to do next).                                                                                                                                                                                                                                                                                                              |
| **The studio's invariants** (`AGENTS.md`)                  | Trust UX: cost and effect shown before any spend, fixture mode labelled, what was verified kept distinct from what was claimed.                                                                                                                                                                                                                                                                                                                                   |

A score: at the start and at the end, the pass rates each page 0–4 against each heuristic (a heuristic scorecard), so the before and after are comparable. If Jordan wants, he also fills in the 10-question System Usability Scale after his own walk. That is one owner's rating of his own app, useful for him, and it is **not** study data.

## 4. Where the pass runs

Three places, each for what it is good at. None of them touches the installed app's database or data home for development.

1. **Cloud container, throwaway database, fixture mode** (ports 5183/4330/4340, a throwaway PostgreSQL, fixture workspace). For the automated sweep, the screenshots, the accessibility scan and the fixture end-to-end walk. Costs nothing, can be repeated, and every fix can be re-checked here.
2. **Dev studio on Jordan's PC** (`http://localhost:5173`, ports 5173/4310/4320, main or the fix branch). For the live end-to-end walk with the real model connections. Records are saved in a **Testing workspace** on the dev studio (created if it does not exist), never in "Jordan's Creator Studio". A backup of `creator_studio` is taken first. Live plan requests or paid calls need Jordan's typed OK in this thread, and stay inside the $20 runtime ceiling; the walk is designed to use plan requests ($0), not API spend.
3. **Installed desktop app, Testing workspace**, after Jordan upgrades it to the pass's build himself ("Back up and upgrade", launched by him, never from a Claude session because of the MSIX redirect). For desktop-only checks (startup, sign-in, window sizes, system browser links, file drop) and for Jordan's own final walk.

Dev studio and installed app are never open at once (shared ports).

## 5. How the pass runs, step by step

| Step                        | What happens                                                                                                                                                                                                                                                                                                                             | Who                                           | Output                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| 0. Prep                     | Start the throwaway studio in the cloud; seed a fixture workspace with the existing seed commands (lineage, research, discovery, selection) plus an empty workspace for first-run checks.                                                                                                                                                | Claude                                        | Running fixture studio                                     |
| 1. Inventory                | List every page, tab, panel, form and button; mark each as main path, occasional, expert or internal.                                                                                                                                                                                                                                    | Claude                                        | Inventory table (appendix of the findings doc)             |
| 2. Automated sweep          | Playwright screenshots of every tab at 1440, 1024, 768 and 390 px wide, dark and light, Standard and Advanced; axe-core accessibility scan of every tab; console errors and failed requests; page heights; tab-order capture. Tools run from a scratch folder, not added to the repo, unless Jordan wants a repeatable check (proposal). | Claude                                        | Screenshot set, scan results                               |
| 3. Heuristic review         | Each page against section 6's checks and Nielsen's heuristics, with the before scorecard.                                                                                                                                                                                                                                                | Claude                                        | Findings                                                   |
| 4. Fixture walk             | The full project path in section 7, in fixture mode, Standard view, keyboard only for one pass and mouse for another.                                                                                                                                                                                                                    | Claude                                        | Walk log with screenshots, clicks and time per step        |
| 5. Fix small                | Fix-now findings on one branch, one draft PR; recheck with the sweep.                                                                                                                                                                                                                                                                    | Claude                                        | Fix PR                                                     |
| 6. Report                   | Findings doc: what was fixed, and the proposals with recommendations. A decision card for any choice that changes a goal.                                                                                                                                                                                                                | Claude                                        | `docs/FINAL_UX_PASS_FINDINGS_<date>.md` and a summary here |
| 7. Jordan decides           | Accept, revise or defer each proposal.                                                                                                                                                                                                                                                                                                   | Jordan                                        | Decisions recorded in the findings doc                     |
| 8. Build accepted proposals | In this thread or split threads by area (one per PR, as usual).                                                                                                                                                                                                                                                                          | Claude                                        | PRs                                                        |
| 9. Independent review       | A separate review thread per PR, until no Low or above remains.                                                                                                                                                                                                                                                                          | Reviewer                                      | Review reports                                             |
| 10. Live walk               | The section 7 path on the dev studio, Testing workspace, live plan connection, with Jordan's typed OK.                                                                                                                                                                                                                                   | Claude via his PC, Jordan watching or driving | Walk log                                                   |
| 11. Docs refresh            | Audit L-3 (section 8), written last so the docs describe the polished app.                                                                                                                                                                                                                                                               | Claude                                        | Docs PR                                                    |
| 12. Jordan's walk           | Jordan upgrades the installed app and walks the path himself in the Testing workspace; anything he finds goes back to step 5.                                                                                                                                                                                                            | Jordan                                        | His notes                                                  |

### Done when

- every page scores 3 or 4 on every heuristic, or Jordan has accepted the gap;
- no High, Medium, Low or nit open unless Jordan deferred it by name;
- the fixture walk and the live walk both finish with no dead end and no step that needs outside help;
- axe-core reports no serious or critical issue on any tab, and the keyboard-only walk finishes;
- every text and control colour meets its contrast ratio in both themes;
- the docs in section 8 describe the app as it is.

## 6. What the pass checks, by area

Each area lists concrete checks. "Every tab" means all 26 views in `apps/web/src/pages.ts`, in Standard and Advanced.

### A. Layout and formatting

- One clear heading per tab (`h2`), sections as `h3`, no skipped levels.
- Content width: long text lines stay under about 80 characters; forms do not stretch across a wide window.
- Page height: measure every tab; flag anything over three screens at 1440×900 (the Decide tab was about 6,300 px on November 10). Long pages get folds, steps or a summary first.
- Forms: labels above fields, related fields grouped (Gestalt proximity and common region), one column unless fields are truly paired, required versus optional marked the same way everywhere.
- Lists and tables: consistent column order, numbers right-aligned, dates in one format, long ids hidden behind names.
- Empty, loading, stale and error states exist on every list and panel, and look the same everywhere (`Status`, `StaleNote`).
- Width classes: nothing overflows or hides at 390, 768, 1024 and 1440 px; the sidebar drawer works under 860 px; text reflows at 400 % zoom (WCAG 1.4.10).

### B. Visual appeal and consistency

- Tokens only: no hard-coded colours or font sizes outside `style.css` tokens.
- A fixed type ramp and a 4 px spacing scale; list every font size and margin in use and fold strays into the scale.
- One primary button per panel, visibly the primary (von Restorff); secondary and danger buttons styled consistently.
- Status shown the same way everywhere: badge colour plus a word, never colour alone.
- Icons, dots and marks (`activity-dots`, `activity-marks`) mean the same thing on every page.
- Dark theme first (owner decision); light theme checked for nothing broken or unreadable.
- Brand assets (`assets/`, wired in #167) are used consistently in the sidebar, the desktop window and the installer.
- Overall impression: calm, uncluttered, trustworthy (aesthetic-usability effect); screenshots of each page reviewed side by side for anything that looks like it came from a different app.

### C. Visual alignment of components

- Left edges of headings, text, fields and buttons line up within a panel.
- Buttons in a row share a baseline and height; icon buttons are the same size.
- Cards in a grid share heights or align to the top consistently.
- Labels, chips and badges are vertically centred with their text.
- Inputs, selects and textareas share height, padding and border.
- Checked by overlaying a 4 px grid on screenshots and by measuring bounding boxes in Playwright for each panel's buttons and fields.

### D. Ease of moving around the app

- The shell answers "where am I" on every tab: sidebar highlight, tab row, breadcrumb, document title.
- Every main-path step can be reached from the Path tab and from Chat in at most two clicks.
- Back and Forward, deep links (`#/<page>/<tab>?ws=&id=`) and reloads land where expected and keep drafts as designed.
- Buttons that leave the page say where they go (`placeLabel`, for example "Projects › Decide").
- Records are named by something a person recognises, not by id (runs were named by id on November 10; re-check).
- Workspace switching: the workspace name is readable (it was truncated on November 10), the switch is obvious, and forms do not leak between workspaces.
- Number of top-level choices per page (Hick's law): Discover shows six panels at once (Explore, Search the web, Run it for me, How much is automated, theme draft, Discover from claims); check whether the start choices should open one form instead of scrolling.

### E. Knowing what the app wants and what to do next

- Every tab says in one sentence what it is for and what to do first. Intros are second person and short (third-person, multi-sentence intros were flagged on November 10).
- The Path tab, the Getting started card (`first-run.tsx`) and Monitor › Overview agree on the next step.
- Every disabled button says why it is disabled and how to enable it.
- Every finished action says what happened and what comes next (success message plus a next-step link).
- Every long-running action shows progress, an expected time, and what the person can do meanwhile (Doherty threshold for the first feedback, goal-gradient for progress).
- "What will happen" (`WhatWillHappen`) appears before every action that spends money or plan requests, starts an autopilot, or widens approvals.
- Words a new person will not know (claim, passage, problem, alternative, scorecard, gate, freeze, humility review, routine approvals, qualification) are explained where they first appear, and used the same way everywhere. The pass writes a short glossary and checks the app against it.

### F. Ease of problem resolution

- Every refusal and error: in plain words, says what happened, why, and what to do, next to where it happened (NN/g error guidelines; WCAG 3.3.1 and 3.3.3).
- Where a fix exists, a fix-it-here button (P27 `fix-buttons.tsx`) is offered; check every refusal code has one or a link to where it is fixed.
- No raw JSON, stack traces, internal codes or ids shown to a person (internal wording in Monitor was flagged on November 10).
- Recovery: a failed request can be retried; a stopped autopilot or workflow says why and offers the next step; nothing is lost on a failed submit (drafts kept).
- Connection problems (plan connection used up, signed out, API key unusable, model not qualified) each say what to do, on the page where the person hits them, and in the top bar.
- Destructive or irreversible actions ask for confirmation and say exactly what will and will not change.
- Help is in the same place on every page (WCAG 3.2.6 Consistent Help); check where Chat's help and the docs links sit.

### G. Standard and Advanced views

Today Standard hides five tabs (`ADVANCED_ONLY` in `pages.ts`: Sell, Campaigns, Maintain, Workers, Study) and folds routine settings (`Routine` in `routine.tsx`). The pass checks the split at three levels: tabs, panels within a tab, and fields within a form.

- **Method:** for every tab, panel and field, record who needs it and how often: main path (everyone, every project), occasional (everyone, sometimes), expert (owner tuning), internal (studio or study diagnostics). Standard shows main path and occasional; Advanced adds expert and internal.
- **Checks:**
  - nothing the main path needs is hidden in Standard (the Path tab, Chat buttons and fix-it-here buttons never send a Standard user to something they cannot see or understand);
  - Standard does not show internal detail (ids, hashes, versions, raw counts, prompt and benchmark names) unless it explains it;
  - folded routine settings have sensible defaults and say what they are set to while folded;
  - switching mode keeps the current tab and drafts, and the choice persists per person.
- **Candidates to examine** (no decision yet; each becomes a proposal if a move is recommended): Runs, Activity and Budgets › pricing snapshots and fixture calls; Sources › Library, Files and Search; Models › Other routes and qualification details; Discover's Explore, Search the web, Run it for me and How much is automated panels; Decide's selection history and assumptions; Proposals' reviews; Settings › Study.
- **Output:** a table of every tab and panel with its current mode, recommended mode and reason, for Jordan to accept.

### H. Everything works as intended

For every tab, in fixture mode:

- every button, link, form and toggle does what its label says; nothing throws in the console; no request fails unexpectedly;
- forms validate before submit, keep the person's input on a refusal, and reset only when asked;
- lists refresh and poll as designed (`usePoll` only while the page is shown), and show stale data honestly;
- page drafts survive moving between pages and are cleared on sign-out and workspace change;
- theme toggle, view-mode toggle, sidebar drawer, workspace picker and sign-out work from every page;
- file drop shows its overlay, uploads to the right workspace, and has a button-based alternative (WCAG 2.5.7);
- viewer and tester roles see read-only versions without dead buttons (`tracking/evidence/member-roles/walk.mjs` as a base);
- desktop: startup, sign-in code, system browser links, the MSIX refusal box, back up and upgrade, and closing and reopening the window.

### I. Full feature coverage

Each feature in the product guide and `context/REQUIREMENTS.md` is exercised at least once from the UI: evidence fetch and cite, web search to claims, explore, theme drafts, discovery from claims, automatic assessment, scorecards, Decide and selection, proposals and their reviews, specs, freeze, humility review, build, package, Try and feedback, autopilot and automation levels, routine approvals, budgets and spending limits, models, qualification, API key, extra requests, copying connections, GitHub (read-only until P32), devices and workers, Chat and its cards, Settings and Study, and the Launch group in Advanced. Anything that cannot be reached from the UI is a finding.

### J. Copy and language

- Sentence case for headings and buttons; buttons start with a verb and name the result ("Start discovery", not "Submit").
- One term per concept across the app (the glossary from 6.E).
- Numbers with units and money in one format; times in the person's local time with the zone shown where it matters (end times showed UTC).
- No internal names (P-numbers, ADR numbers, role ids, schema versions) in Standard.

### K. Accessibility (WCAG 2.2 AA)

- Contrast 4.5:1 for text, 3:1 for large text, controls and focus indicators (1.4.3, 1.4.11), in both themes.
- Everything works with the keyboard alone, in a sensible order, with no trap (2.1.1, 2.1.2, 2.4.3).
- Focus is always visible and never hidden under the sticky top bar or a tray (2.4.7, 2.4.11).
- Targets at least 24×24 px or spaced to the same effect (2.5.8); chips and icon buttons are the likely misses.
- Dragging has a single-pointer alternative (2.5.7, file drop).
- Sign-in does not require remembering or retyping a code without paste or copy support (3.3.8): check the development sign-in code and the desktop sign-in.
- Information already entered is not asked for again in the same flow (3.3.7): check the brief, spec and proposal forms.
- Status messages (saved, started, failed, stopped) are announced (`aria-live`, 4.1.3).
- Names, roles and states on custom controls: start choices, folds, chips, tabs, toggles (4.1.2).
- Reflow at 320 CSS px and 400 % zoom, and text spacing overrides (1.4.10, 1.4.12).
- Reduced motion respected for any animation (`prefers-reduced-motion`).
- Screen-reader spot check of the main path with NVDA on Windows (Jordan's PC) or Narrator.

### L. Speed and feedback

- First feedback on any click within 400 ms (a pressed state, a spinner, or the result).
- Page load times per tab on the fixture studio; flag anything over one second.
- Long-running work (exploration, assessment, autopilot, build, package) shows progress and can be left and come back to.

### M. Trust and safety in the interface

Specific to this product's invariants:

- Before any spend or plan request: the cost, the cap and what will happen are shown, and the confirmation matches the summary.
- Fixture mode is visibly labelled on every page and never looks like live results.
- Verified, reviewed, claimed and unverified are visually distinct (scores, specs, builds, qualifications).
- Approvals in force are visible: what is approved, for how long, and how to end them.
- The autopilot and automation level say what they will do on their own and where they will stop for a person.
- Claims accepted without a person (web claims that passed only the quote check) are marked as such wherever they are used, until Jordan decides K-10.

## 7. The full project walkthrough

The path the person takes, mapped to the app's actual tabs and the Path tab's stages (`next-rules.ts`: Evidence, Discovery, Scores, Selection and spec, Freeze, Humility review, Build, Package, Try).

Run twice: **manual** (the person drives each step) and **automated** (Run it for me, Whole process, then the manual steps it leaves). Whole process currently stops a software option at the spec (spec, build, review and QA are a later P13 slice), so the automated walk continues by hand from the spec. Each run starts from an **empty workspace**, Standard view, so first-run guidance is part of the test.

For every step the walk records: where the person starts, how they knew to go there, clicks and time, what was unclear, any error and whether it said how to fix it, and a screenshot of the result.

| #   | Step              | Where                                                                              | What to do                                                                                          | Checks                                                                                                                                         |
| --- | ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Setup             | Getting started card; Models; Budgets                                              | Connect or confirm a model, fund a $0 budget                                                        | The card names the first step; model state and qualification are clear; a $0 budget is explained.                                              |
| 1   | Explore           | Sources › Sources and claims; Discover › Search the web; Discover › Explore for me | Gather evidence: fetch a page and cite a passage, or search the web and accept claims; then explore | It is clear that only claims with passages are read (known item K-2); explore says what it found or why it found nothing, and what to do next. |
| 2   | Brief             | Discover › Start with a theme, or Discover from claims                             | Write the theme or brief, attach claims                                                             | Fields explained with examples; claim attachment is quick; nothing already entered is asked again.                                             |
| 3   | Discovery         | Discover › Discover from claims                                                    | Start the run; watch it                                                                             | What will happen, cost and time shown first; progress visible; the result links to Decide.                                                     |
| 4   | Assess            | Projects › Decide (Automatic assessment, scorecards)                               | Assess the options                                                                                  | Ranges and unknowns are explained and easy to fix (claim linking one click); the page does not overwhelm (height).                             |
| 5   | Select            | Projects › Decide › Decide                                                         | Choose an option, pass the gates                                                                    | Gates say what each needs and who cleared it; an ethics gate cleared only by the model stops for a person and says so.                         |
| 6   | Proposal          | Projects › Proposals                                                               | Write or review the proposal                                                                        | Ready-for-proposal list is obvious; sections and references are readable; reviews are understandable.                                          |
| 7   | Spec and freeze   | Projects › Scores and specs                                                        | Write the spec, freeze it                                                                           | Freeze explains what it locks and why.                                                                                                         |
| 8   | Humility review   | Projects › Build                                                                   | Review alternatives to building                                                                     | The non-software, existing-tool and defer options are real choices, not a formality.                                                           |
| 9   | Build and package | Projects › Build                                                                   | Start the build, package it                                                                         | Builder route and cost are right (the P19 M-1 kind of mismatch); progress and failure are clear.                                               |
| 10  | Try               | Projects › Try                                                                     | Open the product, leave feedback                                                                    | The preview opens; feedback is saved and the Path shows the closing step.                                                                      |

The autopilot variant also checks the stopped card (K-1), the end time after a stop (K-3) and what happens to the run's approvals when the autopilot ends (K-4).

**Fixture walk** (cloud, $0) covers every step. **Live walk** (dev studio, Testing workspace, Jordan's typed OK) covers steps 0 to 7 on a real plan connection with web search on, plus build and Try if Jordan wants a live build (plan requests only; any API spend is named first and stays inside the $20 ceiling).

## 8. Already-known items folded in

Each is checked first in the pass and handled by the rule in section 2. My expected route is given; the pass confirms it.

| Id   | Item                                                                                                                                                                                                                                                                                                                                                 | Source                             | Expected route                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-1  | The autopilot's stopped card hides the model's three suggested research ideas, has no link to the exploration, and suggests no next step (for example "Search the web first").                                                                                                                                                                       | First live autopilot, November 14  | Fix now if the ideas are already in what the web reads; propose if the API has to return them.                                                                                                                                                 |
| K-2  | Nothing warns before start that claims without passages will not be read (8 of 22 were readable).                                                                                                                                                                                                                                                    | Same                               | Fix now if the count is available to the web; otherwise propose (a readable-claims count in the start summary).                                                                                                                                |
| K-3  | The end time is not worked out again after a stop.                                                                                                                                                                                                                                                                                                   | Same                               | Fix now (display only), unless it is the stored end time, then propose.                                                                                                                                                                        |
| K-4  | The run's routine approvals stay in force until their end time after the autopilot ends.                                                                                                                                                                                                                                                             | Same                               | **Propose**: it changes what an approval does. Options: end the run's autopilot-made approvals when the autopilot ends, or show them on the stopped card with "End approvals now".                                                             |
| K-5  | Decide is very long (about 6,300 px on November 10).                                                                                                                                                                                                                                                                                                 | State review, November 10          | Re-measure; propose a restructure if still over three screens.                                                                                                                                                                                 |
| K-6  | Discover shows every start form at once.                                                                                                                                                                                                                                                                                                             | Same                               | Re-check after the start choices; propose one-form-at-a-time if still crowded.                                                                                                                                                                 |
| K-7  | Internal wording in Monitor; runs named by id; workspace name truncated; long third-person intros.                                                                                                                                                                                                                                                   | Same                               | Re-check; fix now where still present.                                                                                                                                                                                                         |
| K-8  | Audit L-3: `docs/CURRENT_STATUS.md` says main `e08e0a4`, schema 49, and that Explore has no web search; `README.md` says a theme never searches the internet; `docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md` (November 4) misses web discovery, autopilot, automation levels, saved OpenAI keys, extra requests, Chat card fill-ins and copying connections. | `docs/FULL_AUDIT_2026-11-12.md`    | Fix in step 11, after the UX changes land, so the docs describe the final app. Also refresh `docs/UX_UI.md` (its shell section still describes the October navigation groups) and `docs/LOCAL_DEVELOPMENT.md` where the pass changes anything. |
| K-9  | The autopilot form accepts a 40-call cap, but the ChatGPT plan connection allows only 10 requests per run, so Whole process with web search can never get past discovery on the plan. The stop message then says "Assessment route is not ready", which names the wrong cause.                                                                       | Second live autopilot, November 14 | Fix now: the form checks the cap against the connection's per-run limit before start, and the stop message names the per-run limit. Propose if the per-run limit itself should change or be shown elsewhere.                                   |
| K-10 | Web claims that pass only the quote check are accepted automatically during an autopilot run (8 in the second run).                                                                                                                                                                                                                                  | Same                               | **Decision for Jordan** (trust item, section 6.M): keep auto-accepting, or hold them for a person to mark before discovery uses them.                                                                                                          |

## 9. What Jordan gets back

- **Findings doc** `docs/FINAL_UX_PASS_FINDINGS_<date>.md`: the before and after heuristic scorecard; every finding with id, area, guideline, severity, where, screenshot and route; what was fixed (with the PR); the proposals, each with the recommended change, an alternative and the cost; the Standard/Advanced table; the walk logs.
- **A fix PR** for the small items, reviewed in a separate thread like every other PR.
- **One message** in this thread with the counts and the proposals to decide, and a decision card for any choice that changes the app's direction.

## 10. Questions for Jordan before the pass starts

1. **Live walk:** should I drive the dev studio on your PC while you watch (computer use, your typed OK for plan requests), or do you prefer to drive it yourself and send notes?
2. **Repeatable checks:** keep the screenshot and accessibility sweep as a script in the repo (a dev-only dependency on axe-core and the existing Playwright), so later changes can be rechecked, or run it from a scratch folder this once?
3. **Split:** run the pass in this thread end to end, or split the accepted proposals into one thread per area (Discover, Decide, Build, shell and navigation) so they can run in parallel?

My recommendations: 1, I drive and you watch, so you only step in for OKs; 2, keep the script, because the polish should stay checked after this pass; 3, this thread for steps 0 to 7, then one thread per area for the accepted proposals.
