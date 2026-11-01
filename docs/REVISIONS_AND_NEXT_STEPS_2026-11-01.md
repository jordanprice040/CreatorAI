# Revisions and next steps — app audit, November 1, 2026

Audit of `main` at `e1d2fbb` (PRs #1–#98 merged) for Jordan, against his notes and
screenshots of Nov 1, the owner pilot log (`docs/OWNER_PILOT_LOG.md`, F2–F21), the
completion runbook (`docs/COMPLETION_RUNBOOK.md`) and the open Lows from recent reviews.
Priority (Jordan): a complete, usable, polished app before the thesis study.

**How this was checked.** Code read on `main`. The app was run in the cloud container on a
throwaway PostgreSQL 16 database (`creator_audit_throwaway`, ports 5183/4330/4340, fixture
provider only, seeded with `seed-lineage`, `seed-discovery`, `seed-selection`, plus four
problem records added through the API with long, shared-prefix titles like the pilot's).
A Playwright walk opened all 24 tabs and recorded the what's-next line, every visible
dropdown, page errors and horizontal overflow; two more walks tested Chat and whether pages
refresh on return. Scripts and results: `tracking/evidence/audit-2026-11-01/`. No model,
provider, GitHub or payment call was made; the installed app and its data were not touched.
Nothing here is live-verified on the installed app.

Every tab loaded with no page errors and no horizontal overflow at 1280 px. The full test
suite on the same PostgreSQL 16 server: 581 tests, 549 pass, 27 skipped, 5 fail (the known
PowerShell-wrapper tests; no pwsh in the cloud container). Shared doc:
https://claude.ai/artifact/CNYhcSuy9B4Gie2ZKcivDE

## Priority summary

| #   | Item                                                        | Kind            | Size   | Needs Jordan first             |
| --- | ----------------------------------------------------------- | --------------- | ------ | ------------------------------ |
| 1   | Dropdowns: newest first and newest by default               | Bug             | S      | No                             |
| 2   | Dropdown labels that tell records and runs apart; name runs | Usability       | M      | No (migration 35)              |
| 3   | What's-next line: Try never finishes; line on every page    | Bug / usability | S      | No                             |
| 4   | In-app forms for steps that are command-line only (F8)      | Missing feature | L      | No                             |
| 5   | Edit plan caps in the app                                   | Missing feature | S–M    | No                             |
| 6   | Pages that don't refresh on return (F6 remainder)           | Bug             | S–M    | No                             |
| 7   | Lists that drop the newest records past a cap               | Latent bug      | S      | No                             |
| 8   | Chat answered by the connected plans                        | Feature         | M–L    | Yes: route, data sent, quota   |
| 9   | Run built products from inside the app                      | Feature         | L      | Yes: where generated code runs |
| 10  | More evidence-website options ("any public site")           | Feature         | M      | Yes: amends ADR-0051           |
| 11  | Copy and layout polish                                      | Polish          | S      | No                             |
| 12  | Pilot leftovers F2, F5, F9, F14, F15                        | Mixed           | S–M    | F9 is a design question        |
| 13  | Open review Lows                                            | Low             | S each | No                             |
| 14  | Runbook remainder (reinstall, X10, later tracks)            | Plan            | —      | Some                           |

## 1. Dropdowns list oldest first and don't default to the newest (Jordan; F20 follow-up)

PR #90 fixed runs, budgets, pricing, reviews and packages on the Build, Submit, Workflows,
Gallery, GitHub and Payments forms. The record pickers were missed.

Evidence:

- The server lists records oldest first: `listEntities` uses
  `order by created_at, id limit 500` (`packages/db/src/store.ts:1011`). Runs are also
  oldest first (`oversight-store.ts:375`).
- Decide's Problem picker keeps that order and defaults to the problem with the most
  options (`richestProblem`, `apps/web/src/compare.tsx:174-177`), not the newest.
- Scores and specs' Problem picker defaults to the first, which is the oldest
  (`selection.tsx:412-419`).
- Monitor › Runs "Record" picker is unsorted and defaults to the oldest record
  (`workflows.tsx:91-93`).
- Monitor › Budgets run picker is unsorted (`budgets.tsx:140`): it defaulted to run
  01b6c903 while Sources defaulted to the newer 8ffda281 in the same workspace.
- Walk: after adding three new problems, Decide listed them last and selected an older
  clinic problem; Scores and specs selected the oldest problem; a problem added while
  Decide was hidden never appeared (see item 6).

Fix: apply `newestFirst` to every record picker (problems, subjects, claims, budgets' runs)
and default to the newest unless the page was opened for a specific record; make the
server's list routes return newest first so new lists get it for free. Test: a pure
"every picker defaults to the newest" check per view, plus the walk.

## 2. Labels don't tell records or runs apart; runs can't be named (Jordan; F7)

Evidence:

- Problem labels clip the title's first 80–90 characters (`problemLabel`, `ui.tsx:338`).
  Discovery titles start with the same theme, so the pilot's three problems all read
  "Practicing frame-precise keyboard and mouse input timing for speedrunners and…"
  (Jordan's screenshot 2; reproduced in the walk).
- The Runs "Record" picker mixes ideas, problems and alternatives, unclipped, up to 181
  characters per option (Jordan's screenshot 1; walk measured 181).
- Run options read "human in loop · f7f014a9": no date, no name, no theme. The run list
  on Monitor › Runs reads "Discovery · 5 perspectives · Nov 1, 7:50 AM" for every run.
- Runs have no name field (`RunControlSchema`, `packages/contracts/src/oversight.ts:83`),
  so Jordan's Oct 30 request to name runs is not built.
- Two workspaces with the same name can't be told apart in the workspace picker.

Fix:

- One shared label rule for records: the distinctive part of the title (after the theme's
  colon), then date, version and the run that found it, e.g. "Repeated inputs fall outside
  the target window · Oct 30 · v1 · run f7f014a9". Group mixed kinds with `<optgroup>` and
  limit the skeptic-review picker to ideas and problems.
- Runs get an owner-editable name (default: discovery theme + start date), shown in every
  run picker and list. Needs migration 35 and a rename route; the name is display only and
  never changes a run's policy.
- For long lists, a searchable picker instead of a native `<select>`.

## 3. The what's-next line never finishes after Try and repeats on every page (Jordan)

Evidence:

- The Try stage is hard-coded `done: false` (`next-rules.ts:532`), and once the newest
  product is packaged `productStep` always returns "Try the newest package in its private
  preview and record your feedback…" (`next-rules.ts:226-231`). The facts include no
  feedback or preview state, so recording feedback cannot clear it.
- The walk found the same line on all 24 tabs, including Chat, Models, Settings and
  Monitor.
- Chat said "Nothing on the main path is blocked right now" while Build said "Blocked:
  Building needs a frozen spec" in the same workspace.

Fix: count Try as done once feedback is recorded for the newest package (or the owner
presses "Done trying"); then the next step is "Revise from your feedback" or "This path is
finished: start a new discovery". Show the full line on Projects only and a small pill in
the top bar elsewhere. Make Chat's "why blocked" use the same rule as the Build tab.

## 4. Main-path steps that still need the command line (F8)

The desktop app has no command line, so a desktop user cannot finish the main path alone.

Evidence (`next-rules.ts:127-130`, `desktop-app.tsx:8`, CLI cases in `apps/cli/src/index.ts`):

- Scorecards: `pnpm cli scorecard` only.
- Writing a spec from a selection: `pnpm cli spec-create` only.
- Humility review: `pnpm cli humility-gate` only.
- Model qualification: `pnpm cli plan-qualify` only (`models.tsx:596-604`).
- Plan caps: `pnpm cli plan-settings` only (item 5).
- Pricing snapshots and recording a charge in a real workspace: CLI only
  (`submit.tsx:963`, `budgets.tsx:394,489`).

Fix: forms for each, using the existing API routes and the server's gates, in this order:
scorecard (with suggested fills Jordan reviews, since scores are his judgments), spec
from selection, humility review, qualification, pricing. One PR per form.

## 5. Plan caps can't be changed in the app (Jordan)

Evidence: the Models page shows the caps read-only with "Accept these caps"
(`models.tsx:372-437`). The API already has `plan-connections/{id}/settings`
(`apps/api/src/connections.ts:119`). In the pilot the per-run cap was raised 10 → 14 → 18
through the CLI.

Fix: an owner-only "Change caps" form (requests a day, per run, timeout, input and output
characters, Codex builds a day) bounded by the plan's hard limits; saving creates a new
settings version that must be accepted again, as today. Show each run's remaining request
room in run pickers.

## 6. Pages that don't refresh when you come back (F6 remainder)

Pages stay mounted while hidden (`page-drafts.tsx:75`). Decisions reloads on return and
Overview polls, but other pages load once. Walk: a problem added while Decide was hidden
did not appear on return or after 16 s, on Decide or on Scores and specs. "Reset fields" is
still the workaround on most pages, which Jordan found unintuitive.

Fix: one shared "reload when shown" hook for every page's lists (and a 15 s poll where work
runs), and a plain Refresh button where a manual control is useful.

## 7. Lists that silently drop the newest records

Several stores list oldest first with a cap, so past the cap the newest records disappear:
records `limit 500` (`store.ts:1011`; every discovery adds a problem and about 5 options),
chat messages `limit 2000` (`chat-store.ts:101`, PR #98 L-4), budgets `limit 200`
(`budget-store.ts:929`), offers, campaigns and schedules `limit 200`
(`payment-store.ts:546`, `marketing-store.ts:178`, `portfolio-store.ts:278`).

Fix: newest first with paging (or filter server-side); test with cap + 1 records.

## 8. Chat answered by the connected ChatGPT and Claude plans (Jordan)

Now: replies come from fixed rules (`classifyChat`, `apps/web/src/chat-replies.ts`). Any
other question is saved as a note with "I can't answer in words yet" (Jordan's screenshot 4;
walk: "What is Creator Agent and how do I use it?" and "Compare the three options for the
clinic problem" both became notes). Model replies were planned as PR C, after Jordan's OK on
route, data and cost.

Proposed design (needs Jordan's OK; ADR-0056):

- Route: the existing plan connections only. Claude only by spawning the signed-in,
  unmodified `claude -p` on Jordan's device (ADR-0050); the app never holds Claude tokens.
  ChatGPT through the existing plan connection. $0 metered; no API key fallback.
- Compliance: one person asking questions in his own app on his own computer is the
  ordinary individual use the Claude consumer terms assume; keep extra usage off and
  never route anyone else's requests through the plan. Before enabling ChatGPT for chat,
  re-read OpenAI's current terms for the plan route, which was accepted for builds.
- Data sent: the question plus the records the reply needs, within the connection's
  allowed data class; the reply shows what was sent and to whom.
- Quota: a separate daily chat cap so chat cannot use up the builder's requests
  (ChatGPT 40/day and Claude 30/day are shared today).
- Authority: chat still can't start, approve, fetch or spend. Suggested actions stay as
  cards that open the tab. Replies are labelled as model-written, cite the records used,
  and are stored with the model, connection and request id.
- Checks: classifier and redaction tests, a quota test, and one live reply per route with
  Jordan's typed OK.

## 9. Running built products from inside the app (Jordan; F17)

Now: Try's private preview runs a package once with all of standard input sent at once
(non-interactive). Jordan ran the timing analyzer's `--practice` mode from the exported
source in PowerShell.

Options:

1. **Recommended: an in-app terminal on the isolated worker.** Try gets "Open a terminal":
   an interactive terminal in the same WSL worker that runs QA (no network, time and CPU
   limits, no studio credentials), streamed to an in-app terminal panel. Keeps invariant 6
   (generated code never runs on the studio host). Needs an ADR for interactive execution
   and a security review. Caveat: key presses travel through the relay, which adds a few
   milliseconds of jitter, so a timing trainer is less precise there than in a native terminal.
2. **"Run on this computer" (owner decision).** The desktop app opens Windows Terminal in
   the export folder with the exact command after a confirmation each time. Best timing
   accuracy, but generated code runs on Jordan's own computer, outside isolation; this
   needs an explicit owner decision and an ADR.
3. **Later (F17):** interactive and small web-app product templates with QA beyond fixed
   stdin/stdout cases, and a preview on its own origin.

## 10. More evidence-website options (Jordan; ADR-0051)

Now: at most 20 exact host names, edited only in the desktop status window, saved with a
studio restart (`apps/desktop/src-tauri/src/home.rs:60`). Fetches already refuse private,
loopback and reserved addresses (`packages/research/src/adapters.ts:113`), and every fetch
still needs a run's `source.fetch` grant.

Options to put to Jordan (amends ADR-0051): edit the list in Settings without a restart;
allow `*.example.org` subdomains; raise the limit; an "any public website" switch (default
off, owner only, recorded in the audit log; private addresses stay refused, the run grant
still applies). Fetched text stays data, never instructions. Related F2 (still open): warn
when a fetched page gives almost no text because it needs JavaScript.

## 11. Copy and layout polish

- Try's empty state says packaging needs `pnpm cli artifact-package` (desktop: "needs the
  command line"), but Build has a Package button (`gallery.tsx:66-75`, `build.tsx:816`).
- The top bar wraps below about 1200 px: the theme button drops to its own row (Jordan's
  screenshots 2 and 4; Models tab in the walk).
- Sidebar footer: "Schema 1.0" reads like the database schema (it's at 34), and "Live calls
  need a provider, pricing, a grant and a budget" is out of date for the $0 plan route.
- The status line always says "live adapters configured, unverified": health reports
  configuration, not verification (known since Oct 20).
- Monitor › Runs has both Refresh and Reset fields.

## 12. Pilot findings still open

| Finding                                           | Status                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2 JavaScript-only pages                          | Open (item 10).                                                                                                                                                                                                             |
| F5 skeptic packet / revision rounds               | Input cap raised. Jordan's screenshot 1 shows a new form of it: "The call budget could not cover another revision round; the skeptic's objections are preserved as dissent." Show the call budget and let the owner set it. |
| F6 refresh on return                              | Partly fixed (item 6).                                                                                                                                                                                                      |
| F7 telling reruns apart                           | Open (item 2).                                                                                                                                                                                                              |
| F8 scorecards, ethics, humility forms             | Open (item 4).                                                                                                                                                                                                              |
| F9 humility gate judges software-only for hybrids | Open design question for Jordan.                                                                                                                                                                                            |
| F10 qualification reasons                         | Fixed (#86). Low L-5 open.                                                                                                                                                                                                  |
| F11, F12, F13, F18                                | Fixed (#92, #93), except approving in place with the action continuing by itself.                                                                                                                                           |
| F14 MSIX redirect                                 | Open: the app should detect a redirected data home and refuse with a clear message. No such check in `apps/desktop/src-tauri`.                                                                                              |
| F15 $0 route setup                                | Partly: one approval per build is done; a $0 plan build still needs an envelope and a pricing snapshot (U04).                                                                                                               |
| F16 preview usage                                 | Fixed (#94).                                                                                                                                                                                                                |
| F17 interactive products                          | Open (item 9).                                                                                                                                                                                                              |
| F19, F20 latest version defaults                  | Fixed for build forms (#90); record pickers remain (item 1).                                                                                                                                                                |
| F21 packet bound                                  | Fixed (ADR-0053).                                                                                                                                                                                                           |

## 13. Open review Lows (fix when the area is next touched)

- PR #98 chat: L-1 prefill never cleared and crosses workspaces; L-2 a failed first send
  makes empty conversations; L-3 the classifier misreads ordinary sentences ("Research
  shows…", "Note that…"); L-4 only the oldest 2000 messages show; L-5 fill overwrites
  typed text and Discover cuts the theme to 300 characters. Also: conversations can't be
  deleted.
- PR #95 decisions: dropped option doesn't flag the rationale; "ever typed" flag; editing
  only "would reverse if" clears a stale flag; an unneeded override reason is still stored.
- PR #94 preview: example button drops empty or newline arguments; flow fallback shows all
  flows; untested null-guide paths; dark placeholder contrast.
- PR #96: Codex packet capped only by the 1 MiB body (should be `PLAN_ROLE_CONTEXT_MAX`);
  capped runs stay "cap reached" in the usage panel.
- PR #90 N-4: Approvals' Revoke/Stop errors wiped by reload.
- PR #86 L-5: held-out viewing not recorded or enforced.
- PR #75 L-2: an older qualification pass admits after a newer fail.
- PR #77 L-1: artifact-store comparison count untested.
- Recorded design limits: the preview origin shares the studio's cookie host; the T17
  overrun guard isn't serialised against a concurrent settle.

## 14. Runbook remainder

- Step 9: confirm which build the installed app runs (the screenshots show the new pages),
  then the final walk as a user and X10 on the exact candidate.
- Later tracks, each its own task: theme-free discovery (C53); evidence gaps become
  searches (needs a search-provider decision); owner file uploads, file library and
  exports; re-run one failed step; Ollama; live GitHub on one private repo; signed Windows
  distribution and updates; hosted staging; live payments; campaigns; theme-intent native
  acceptance (v5 design next).
- Thesis (deprioritized): RD1–RD10, committee/IRB for RD5, T15/T16, 36 X10 owner rows.

## Suggested threads (can run in parallel)

| Thread                          | Items       | Files mostly touched                                            | Notes                              |
| ------------------------------- | ----------- | --------------------------------------------------------------- | ---------------------------------- |
| A. Lists and labels             | 1, 2, 7     | `versions.ts`, `ui.tsx`, record pickers, stores, migration 35   | Start now                          |
| B. What's next, refresh, polish | 3, 6, 11    | `next-rules.ts`, `next-step.tsx`, `main.tsx`, `page-drafts.tsx` | Start now                          |
| C. In-app forms                 | 4, 5        | `selection.tsx`, `compare.tsx`, `build.tsx`, `models.tsx`       | After A merges (shares pickers)    |
| D. Plan-backed chat             | 8           | `chat*.ts(x)`, chat store, plan routes, ADR-0056                | Design doc, then Jordan's OK       |
| E. Run products in the app      | 9           | `apps/api/src/artifacts.ts`, worker, desktop, new ADR           | Design doc, then Jordan's decision |
| F. Evidence websites            | 10, F2, F14 | desktop control window, `packages/research`, ADR-0051 update    | Jordan's choice of options first   |

A and B touch different files and can run together; both will conflict only in the
tracking logs. C should follow A. D, E and F each start with a short design for Jordan.
After A–C, reinstall once and do the final walk (runbook step 9).

Constraints that apply to all of them: the $20 runtime ceiling; Claude only through
`claude -p` (ADR-0050); any live call, install or upgrade of the installed app needs
Jordan's typed OK; never use the installed app's database or data home for testing.
