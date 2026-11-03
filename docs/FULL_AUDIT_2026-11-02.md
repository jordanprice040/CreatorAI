# Full audit of main — November 2, 2026

- Audited: `main` at `85ff0d5` (PRs through #117 merged; schema 37; next free ADR 0062).
- Auditor: fresh Claude thread ("Audit the codebase and fix issues"). Not involved in building #117 or the other recent PRs.
- Spend: $0. No provider call, no Run button pressed. Throwaway PostgreSQL 16 database `audit_walk` on ports 5183/4330/4340; fixture workspaces from `seed-discovery` and `seed-selection`, plus one new real workspace with a ChatGPT plan connection added as a record only (never signed in).
- Fixes: draft PR on branch `claude/project-thread-q9nevz` (one PR; the changes are small and in separate areas). Each fix is marked **Fixed** below.

## Verdict

No High findings. One Medium found and fixed (the app pointed people to connection settings it had no control for). Five of the six known open Lows are fixed; #107 L-B is left as Jordan chose. The biggest remaining usability gaps are the desktop-only dead end for preview feedback, lists that drop their newest records past a cap, and pages that load only once.

## What was checked

- **Baseline.** `pnpm check` on main with PostgreSQL 16: 687 tests, 654 pass, 27 skipped, 5 fail (the known PowerShell-wrapper tests, no `pwsh`). Prettier clean. A 6th failure in that run came from my own edit landing mid-run. Rerun clean (see Checks).
- **PR #117 final commits** (see section 1).
- **Browser walk** of all 24 tabs on a `seed-selection` workspace at 1280 px. No page errors, no console errors, no horizontal overflow, no unexpected alerts. Screenshots were reviewed for Path, Build, Decide and Models.
- **Code read.** Route auth (every records route goes through `authn.require`, with CSRF on mutations; the webhooks use signature auth only). No `innerHTML`. SQL is parameterised everywhere (the only `${}` in queries is constant SQL fragments). I also read the plan-connection settings path and every known Low's code.
- **Desktop crate.** `cargo check --target x86_64-pc-windows-gnu` passes.

## 1. PR #117's last commits (no independent review before merge)

- `dbf04d3`, CLI `build-task` connection refusal: correct. It parses the plan once and reuses it. It reads `plan-connections/{id}` in the product's own workspace and refuses with `connectionDataBlocker` before `BuildSupervisor.run`, for both `plan_roles` and `codex_plan_builder`. A plan with neither (the broker builder) is unaffected. The new route test in `studio-builds.test.ts` asserts the 409 words and `builds: []` for both builder kinds. It passes.
- `8a40bdb`, merge of main: `git show --cc` shows no hunks in `apps/`, `packages/` or `tests/`. So no code was changed by hand in the merge, and only the tracking logs conflicted, as stated. Typecheck and the full suite pass on the merged result.
- **No findings.**

## 2. Findings

### Medium

**M-1 (Fixed): the app told people to allow a data class "in that connection's settings", but the settings could not be changed in the app.**

- `connectionDataBlocker` (Build, API and CLI) says "Allow approved private data in that connection's settings (Models and connections)".
- The qualify form shows benchmarks for classes the connection doesn't allow as "not allowed on this connection".
- But only `pnpm cli plan-settings` could change `allowed_data_classes` or `allowed_task_classes`. The desktop app has no CLI. So a desktop user who needs approved private data, or the builder or reviewer role, was stuck. Every new plan connection starts with only summarization and specification.
- **Fix:** Models now has "Change caps or allowed work". The form adds two checkbox groups, "Data it may receive" and "Tasks it may do". Claude Code connections don't offer `code_build`. At least one of each is required. The change line reads in words, e.g. "Allows approved private data". Saving uses the existing `POST plan-connections/{id}/settings`. The server still validates the kind's limits, still requires the owner, and still withdraws caps acceptance. The Allowed line now reads in words instead of raw keys.

### Low

**L-1 (Fixed, PR #110 L-F): the sign-out warning showed while a notes save was still landing.** Sign-out now waits up to 5 s for a notes save already in flight (`trackNoteSave` / `noteSavesSettled` in `note-drafts.ts`). Only then does it check for unsaved text. If the save fails, the copy stays and the warning shows as before.

**L-2 (Fixed, PR #111 L4): the desktop title-bar link note never cleared.** The note ("opened the link…", "wait a second between links", "refused") now goes back to "Creator Agent — local studio" after 6 s. It is not restored if something else changed the title meanwhile (`passing_title` in `main.rs`).

**L-3 (Fixed, PR #113 L-1): activity-dot seen keys held only in memory were dropped by the next write that worked.** `storeSeenWith` now merges in memory-only workspaces under what is stored. The workspaces the store has keep the stored copy.

**L-4 (Fixed, PR #116 N-5 and N-6):**

- "Confirm no charge…" is now owner-only, like "Record a charge…". The server already refused other members.
- The no-charge form has a busy state ("Confirming…"), so it can't be sent twice.
- Its input is wider.

**L-5 (Fixed, PR #98 L-4): chat showed the oldest 2000 messages of a conversation.** It now shows the newest 2000, in order.

**L-6 (Fixed, audit item 11): the top bar wrapped onto two rows at 1280 px on several pages,** for example Models. The status line was long ("Connected · fixture provider only · records saved in PostgreSQL"), and "live adapters configured, unverified" read like a fault in real use. The bar now says "Connected" and adds only problems (database unavailable, persistence off, maintenance degraded). The full line shows on hover. The top bar measured 59 px (one row) on Models at 1280 px.

**L-7 (Fixed, audit item 11): the sidebar footer said "Schema 1.0" and "Live calls need a provider, pricing, a grant and a budget",** which is out of date for the $0 plan routes. It now says "Local control" and "Models are used only through connections you approve."

**L-8 (Fixed 2026-11-03, Try › "Revise the spec from this feedback"): in the desktop app, accepted preview feedback can't become a spec revision.**

- Try › feedback › Accept says "Revising the spec from it needs the command line, which the desktop app does not have yet" (`gallery.tsx:1041`).
- The route exists: `POST feedback/{id}/revision`, which takes the spec's full title and content.
- The spec form from PR #112 can already edit that content.
- Suggested: a "Revise the spec from this feedback" button that opens the spec form in revise mode, with the reason filled in, and posts to the feedback route. This is the last main-path CLI-only step I found.

**L-9 (Open, audit item 7): some lists still keep the oldest records past a cap.**

- These are `order by created_at limit 200`: budget envelopes (`budget-store.ts:929`), payment offers (`payment-store.ts:546`), campaigns (`marketing-store.ts:178`) and schedules (`portfolio-store.ts:278`).
- These are `limit 500`: payment-store lines 1183 and 1876.
- Past the cap, the newest records disappear. That is unlikely for one owner today (the seeded workspaces have one envelope each).
- Suggested: newest first with paging, and a test with cap + 1 records.

**L-10 (Open, audit item 6): most pages load once and don't refresh when you return.** Budgets uses `useOnShow` and Decide reloads, but many tabs still need "Reset fields" or a manual Refresh. A shared "reload when shown" hook would fix it everywhere.

**L-11 (Open, PR #96): the Codex plan builder's packet is still bounded only by the 1 MiB body.** `PLAN_ROLE_CONTEXT_MAX` applies only to `plan_roles` (`build.ts:393`).

**L-12 (Fixed in the follow-up branch claude/project-thread-xi5g92, pilot F14): the desktop app still doesn't detect a redirected data home** (the MSIX container case). No check exists in `apps/desktop/src-tauri`. Launching from the Claude desktop app's container still fails later with "Noncanonical path refused".

### Nits

- **N-1 (Open):** on Build's spec row, "Revise" and "Freeze it under Scores and specs" run together with no separator ("Revise Freeze it under…").
- **N-2 (Open):** `seed-discovery` and `seed-selection` both name their workspace "Fixture discovery demonstration", so two seeds look identical in the workspace picker.
- **N-3 (Open):** on Models, the Chat answers card has an empty first line above its heading.
- **N-4 (Left, as chosen):** PR #107 L-B. A run that finishes after dropping off the 100-item list never gets a dot.

## 3. Known Lows re-checked

| Item                                            | Status                                |
| ----------------------------------------------- | ------------------------------------- |
| #107 L-B old runs never dot                     | Still present. Left, as Jordan chose. |
| #113 recovery Low (memory-only seen keys)       | Fixed (L-3).                          |
| #110 L-F sign-out warning during a landing save | Fixed (L-1).                          |
| #111 title-bar note never clears                | Fixed (L-2).                          |
| #116 N-5 non-owners see "Confirm no charge"     | Fixed (L-4).                          |
| #116 N-6 no busy state                          | Fixed (L-4).                          |
| Task classes only via `pnpm cli plan-settings`  | Fixed (M-1, data classes too).        |

Lows carried from the PR #99 audit, not re-verified one by one in this pass:

- #98 L-1, L-2, L-3 and L-5.
- #95 decisions flags.
- #94 preview example and fallback.
- #90 N-4.
- #86 L-5.
- #75 L-2.
- #77 L-1.

## 4. Valuable improvements, additions and changes (recommended order)

1. **Feedback → spec revision in the app** (L-8). This closes the last main-path CLI dead end for desktop users.
2. **Reload-when-shown for every page, and newest-first lists with paging** (L-9, L-10). Stale lists are the most common "it didn't work" moment in the walks.
3. **A redirected data home check in the desktop app** (L-12). Refuse at start with a plain message instead of failing mid-build.
4. **Delete and rename chat conversations, and clear the prefill** (#98 L-1 and L-2). Chat is now the front page.
5. **Show the stored reconcile evidence** on Budgets (PR #116 N-3). It is already saved on the reservation.
6. **Theme-free discovery** (C53). Still unbuilt, and the biggest functional addition before the final UX pass.
7. **Codex packet bound** (L-11). It is a one-line change in `build.ts`, plus a test.
8. **Final UX pass and X10 on the exact candidate** (runbook step 9). Do it after 1–3, on the installed app.

## Checks run on the fix branch

- `pnpm typecheck` and Prettier: pass.
- Unit tests:
  - `web-caps-form` (2 new: the choices equal `DataClassSchema` and `PlanTaskClassSchema`, the saved settings parse with `PlanSettingsSchema`, Claude has no `code_build`, the change wording).
  - `web-note-drafts` (new: a save in flight clears its copy before sign-out checks; the wait is bounded; a failed save is not an error).
  - `web-session` (new case: a landing save means no warning).
  - `web-activity-marks` (new: a memory-only workspace survives).
  - 25 tests across these four files, all pass.
- `chat-api` and `chat-answers` against PostgreSQL 16: 8 pass.
- Full `pnpm test:db` on the branch with PostgreSQL 16: 691 tests, 659 pass, 27 skipped, 5 fail (the known PowerShell-wrapper tests). Prettier clean.
- `cargo check --target x86_64-pc-windows-gnu` for the desktop crate: passes.
- Browser walk `tracking/evidence/full-audit-2026-11-02/walk.mjs`, on a new real workspace, $0:
  - Adding a plan connection showed "Synthetic (made-up) data, Public data · tasks: Summarization, Specification writing".
  - Unticking both data classes refused the save with "Allow at least one kind of data."
  - Ticking public, approved private and the builder role showed the change line. Saving stored `["public","private_approved"]` and `["specification","summarization","patch_build"]`, with caps acceptance withdrawn.
  - The top bar was one row (59 px).
  - Screenshots `01-form.png`, `02-filled.png` and `03-after.png`.

Not walked:

- The sign-out wait (covered by unit tests).
- The desktop title-bar reset (compiled only; it needs Windows).
- The owner-only no-charge button with a non-owner member.
