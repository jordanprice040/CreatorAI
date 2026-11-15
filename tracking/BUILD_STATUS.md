# Build status — November 10, 2026

## November 14 update — ChatGPT plan per-run cap default 30 and the held web-claims next step (PR #199)

What now works (no migration, no ADR; owner decision in `tracking/DECISIONS.md`): a new ChatGPT plan connection proposes 30 requests per run instead of 10, enough for a whole autopilot run (at least 13, up to about 27 with Hands-off). The Claude Code connection stays at 10. When an autopilot stops because its web search's quote-checked claims wait for a person, its next step points to Discover › Search the web and How much is automated. It offers “Accept quote-checked web claims” below only when that button is shown, and says Continue accepts them when the owner has already turned the setting on. The Evidence approval text says these claims wait unless that setting is on.

Found on the November 14 live rerun on the dev studio (schema 63, findings `/mnt/project-files/reviews/LIVE_AUTOPILOT_RERUN_SCHEMA63_2026-11-14.md`). Not fixed here; PR #202 fixes them: discovery refuses an "evidence packet too large" in a busy workspace (follow-up 8), Allow at a re-stopped held-claims step searches again (follow-up 10), and calls set aside for a locally refused step are not given back (follow-up 9).

Checked: `pnpm typecheck`, `pnpm format:check`, two new tests in `web-caps-form.test.ts` (the 30/10 defaults in config and the Models page, and the held-claims text cases). Full `pnpm test:db` in the cloud on PostgreSQL 16 with main 9f162d1 merged: 1229 tests, 1195 pass, 29 skipped, the 5 known PowerShell-wrapper failures. After re-review 2's nit (the setting state in the held-claims text), the web-caps-form tests pass (13 of 13).

## November 14 update — autopilot fixes from the live rerun on schema 63

What now works (no migration): a discovery packet gives its catalog of recorded problems, ideas and options only the room the brief and claims leave (newest first) and counts what it left out (`catalog_beyond_limit`), so a used workspace no longer refuses a two-claim brief as "too large for one model message". After a web search's claims wait for a person, Continue with none added stops again without setting calls aside and keeps the search on the step, and a later Allow accepts that search's claims instead of searching again. A step refused before it sent anything gives back the calls it set aside. A claims_held stop points to Discover › Search the web, and Continue says it stops again with none added. Evidence of the live run: `tracking/evidence/p13-autopilot-rerun-schema63-2026-11-14/` on the dev studio (not committed).

Checked: `pnpm build:code`, the web typecheck, Prettier on the changed files, and the discovery, exploration, web-discovery, workflow, routing and autopilot tests on PostgreSQL (throwaway database); the three new or changed tests fail on the code before the fix. Not checked: a full `pnpm test:db` and a new live run.

## November 14 update — UX pass P-2 (Path branches) and P-5 (draft the missing sections) (ADR-0101, migration 64)

What now works: after a selection, Projects › Path follows the choice. A non-code choice goes to Proposal and Review and finishes when the proposal's current version is complete and reviewed as ready; a selection that advanced nothing ends at Selection; software goes on to Spec, Freeze, Humility review, Build, Package and Try. The overview reports selections and the newest route, shown on Monitor › Overview. On Proposals, the owner can press **Draft the missing sections** on a saved proposal: the chat model drafts the unknown plan sections, each draft shows under its section as a model draft, and a person uses or dismisses each one; a saved section that came from a draft carries the model's name in the page, preview and export. Unsupported facts stay "Unknown yet".

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (1204 tests: 1170 pass, 29 skipped, the 5 known PowerShell-wrapper failures), new tests `proposal-section-drafts` (overview route and proposal progress; owner, chat and records rules; version and section checks; replay; marks checked by the studio; export labels; audit without words; settle-once; redaction) and `web-proposal-drafts`, plus new Path cases in `web-next-step`. Browser walk `tracking/evidence/p2-p5-path-proposals/walk.mjs` with a fake `claude`. No live model call.

After #193 merged: an owner autopilot setting, **Draft a proposal's missing sections** (off by default, part of Hands-off), makes an autopilot's proposal step ask for the drafts too; they wait for a person, and a refusal only shows in the step's note (tests in `autopilot.test.ts`).

Review 1 (1 M, 4 L, 6 nits; `/mnt/project-files/reviews/PR198_PATH_PROPOSALS_REVIEW_1_2026-11-14.md`) fixed: a draft a stopped studio left pending is closed on read, so the button is never held (and loses its words if the proposal was redacted); the autopilot's draft request is one of its own calls and Stop does not wait for it; a draft already on its way is not reported as failed; the settings card names the Hands-off switch that is not on yet; the page shows "and edited" as you type; one shared helper settles chat fills and drafts. Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (1208 tests: 1174 pass, 29 skipped, the 5 known PowerShell-wrapper failures) and the browser walk.

Open: re-review in a separate thread.

## November 14 update — final UX pass: shell and wording (P-8, P-9, P-14, P-15, Budgets folds; ADR-0104)

What now works (no migration): the Standard view shows amounts in cents with the exact value on click, tap or keyboard (`<0.01` for a charge below a cent), and the exact maximum wherever spending is authorized; Advanced shows every amount exactly, and storage and enforcement stay exact. Standard reads history lines, action types and stored codes in page words and leaves out ids, hashes, event numbers and first versions; Advanced keeps them. A discovered problem whose brief repeats it is titled once (N-2), and the autopilot's tie stop names at most three options (N-3). Sources with no run puts "register a run" before Fetch, says why Fetch is off and links to Search the web (P-14). Every page shows guidance in the Next banner (P-15). Budgets folds pricing snapshots (once pricing exists) and the fixture call in Standard. Details: `tracking/evidence/ux-shell-wording/README.md`.

Checked in the cloud container on a throwaway studio and database: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 before merging main (1181 tests: 1147 pass, 29 skipped, the 5 known PowerShell-wrapper failures), and after merging #193 the web and autopilot tests (all pass); the walk (`tracking/evidence/ux-shell-wording/walk.mjs`, 21 checks pass); `scripts/ux-sweep.mjs` over all 156 shots (0 axe violations, 0 console errors, 0 failed requests, no sideways scroll; the only small targets were the inline amount buttons, which 2.5.8 exempts as targets in a sentence, and the sweep now skips them like inline links: 0 in a re-run at 1440 px). Not covered: real (non-fixture) amounts and API-cost lines, which need a live connection.

Review 1 of #197 (5 Low, 8 nits) fixed: the Budgets pricing fold now starts closed; ids left in Standard (approval card run and evidence, Overview approvals and failures, Budgets card run, Usage runs, Funding allocations, run fallbacks, and the places the review listed besides) give way to names or are left out; Recent calls, approval questions and worker lease lines read in words; what is left or available rounds down; the Sources link lands on Search the web; and the eight wording and code nits. Re-checked: typecheck, format, web tests, the walk (24 checks, now asserting the fold is closed and the link's focus), the Standard text dump with a pending approval in place (0 id lines), and the 156-shot sweep (clean). Review 2 (1 Low, 5 nits) fixed: the last ids and hashes in Standard (Try, Devices, Build reasons, Runs card, Marketing, name-missing fallbacks), history amounts with their own unit, approval questions in words, `plainText` limited to known codes, and "Human-in-the-loop run"; the Standard text dump after building and packaging an artifact shows 0 id or hash lines outside Sources › Library. Review 3 (2 Low, 3 nits) fixed: the routine approval summary states its maximum exactly in dollars (shared contracts function, so page and server change together), Assess's "Why these ratings" keeps ids for Advanced, build stops read in words for every admission outcome, and workflow role names are a typed table.

## November 14 update — final UX pass P-6, P-7 and the Runs/Library move (ADR-0103)

What now works (web only, no migration): Discover opens one start panel at a time (Explore for me, Search the web, Discover from claims, Run it for me, How much is automated; Start with a theme in Advanced), keeping each closed panel's fields and polls; links into a closed panel open it. Starting a discovery stays on Discover, which lists each discovery's progress in plain words with its next step (Open in Decide, Open Approvals, Search the web, Sources and claims) and Pause, Resume and Cancel; Decide shows the ones running and refreshes its problems when one finishes. Standard no longer lists Monitor › Runs or Sources › Library (their addresses still open), and Runs links show only in Advanced. The autopilot summary no longer has blank gaps (N-14). Discover in Standard at 1440 px is 1,389 to 3,251 px tall depending on the open panel (7,146 px before).

Review 1 fixes (ADR-0103 amendment): a live discovery is always listed, ahead of finished ones; Pause, Resume and Cancel show to the owner only; the sidebar's Now list opens Discover or Decide for discovery, exploration and assessment work in Standard (the sidebar item now carries the workflow's role); a pause during a running step reads "Pausing"; the list sits below the start choices with finished lines folded (choices start at 576 px on a 390×844 screen); Decide's Search the web opens the web panel; one screen-reader status line; page-specific heading ids. Re-review fixes: a running assessment in the sidebar opens Decide on its own problem (sidebar items carry the workflow's subject), a discovery there scrolls to its line, "Pausing" no longer says Needs you, and the theme button says plainly that it switches the app to Advanced on all the person's devices. `pnpm test:db` after the re-review fixes: 1202 tests, 1168 pass, 29 skipped, the 5 known PowerShell-wrapper failures.

Checked: a browser walk on a throwaway studio (fixture, ports 5183/4330/4340, its own database): start a discovery from claims, watch it run and finish on Discover, every panel switch, the progress list's Search the web opening a closed panel, Advanced (theme draft, Runs and Library tabs, Run details), and axe-core WCAG 2.2 A/AA (0 violations) with no sideways scroll at 1440 and 390 px; `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (1179 tests: 1145 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

## November 14 update — final UX pass P-3 (approve in place) and P-4 (one-step gate confirmation) (ADR-0102)

What now works (no migration): Decide lists first which options can advance now, once ethics and access are confirmed, or not even then (with the other reasons as text). The owner confirms ethics and access for the options they tick in one step, with one shared reason per gate and an optional reason of an option's own; each confirmation records the reason that applied and whether it was shared or the option's own. When the owner's own selection, spec freeze or build stops for their approval, they approve it on the same page (same decision record and route as Approvals); Decide and Freeze then go ahead without another press. Decide's assumptions and selection history fold under one line each in Standard (section 6).

Checked: `pnpm typecheck`, `pnpm format:check`, the new DB test (`team-gates.test.ts`, all-or-nothing, reasons per option and gate, audit payload) and web tests (`web-gate-batch.test.ts`), UI walks on a throwaway database (reviewer ports): 10 gate confirmations in one step with one own reason, a selection approved in place without leaving Decide, 390 px axe clean (`tracking/evidence/p3-p4-decide-approvals/`). Full `pnpm test:db` on PostgreSQL 16 with main (#193) merged in: 1201 tests, 1167 pass, 29 skipped, the 5 known PowerShell-wrapper failures. Not covered: the build path in a browser (the inline approval there is the same component, found from the build's stop reason).

Review 1 fixes (1 M, 5 L, 6 nits; `/mnt/project-files/reviews/PR195_DECIDE_APPROVALS_REVIEW_1_2026-11-14.md`): only the requester's own approval is offered in place; options with a gate that cannot be cleared here are not pre-ticked and say why; the resend buttons stay and the approval reloads on return; the inline approval asks "worth asking?" and shows Uncertainty and If wrong; an HTTP test for both routes; the gate form sits above the alternatives heading; wording, kept own reasons after a reload, one shared reason rule, the live region, and the walks rerun on schema 63. Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1202 tests: 1168 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

Re-review 2 fixes (2 L, 3 nits): the in-place approval refreshes quietly when the window regains focus and after a failed approve, so a failed refresh keeps the form and shows the usual "may be out of date" note; Build's text says "Press Start build above to build again." (the ADR too); the retry buttons read "Submit again" and "Freeze again" when nothing was approved (rejected, someone else's request, or the approval could not be read); README wording and spacing under the approval. Both walks rerun (`walk-approve.cjs` now waits for the Decide form). Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1202 tests: 1168 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

## November 14 update — more automation for the autopilot (ADR-0100, migration 63)

Jordan's November 14 asks: an opt-in way for the autopilot to go on by itself at stops, automatic evidence gathering and claim linking when evidence is thin, a hands-off mode that recovers from most stops, and a clear next step whenever automation waits. Plan with the full stop map (23 stops, 6 that stay hard stops): `docs/AUTOPILOT_MORE_AUTOMATION_PLAN_2026-11-14.md`.

What now works (schema 63):

- **When the autopilot would stop** under How much is automated: the owner's per-workspace autopilot settings (gather evidence with up to 3 extra web searches, choose with unknown ratings by the worst case, break ties by a fixed order, keep the leader of a close ranking, try the next candidate, retry a failed step up to 2 times, and, per Jordan's decision, choose when only the model cleared ethics). All off by default; **Turn on Hands-off** turns on every one except the ethics switch. Versioned, owner only, audited.
- Every stop now records its kind. A stopped card offers **Allow “…” and continue** when a setting covers that kind of stop: one request turns that setting on and continues, refused if either changed since it was read. The read lists the other next steps for each kind of stop, and **Start a new autopilot** when it cannot continue.
- Thin evidence: the autopilot links suggested claims (up to 3 per problem or option, as the Autopilot actor, marked suggested), searches the web on a plan connection (public data only, inside the run's approvals and the autopilot's call limit), and explores, assesses or chooses again, in bounded rounds. With the setting on, the claims a discovery proposal cited are linked to its option.
- An ethics gate only the model cleared: with the owner's setting on, the autopilot chooses it, and the selection, proposal and audit entry say “Ethics checked by the model only: look at it.”
- Each fallback is recorded on its step with the setting and settings version that allowed it.
- Fixes from the November 14 live runs: the autopilot sizes child work to the plan connection's per-run request cap and what the run has already used (K-9), with a clear message; "Assessment/Exploration/Discovery can't start on this connection now" replaces "route is not ready"; Automate the rest can start on a new run made for it.

Checked in the cloud container on PostgreSQL 16: `pnpm typecheck`, `pnpm format:check`, `pnpm test` with the database (1178 tests: 1144 pass, 29 skipped, the 5 known PowerShell-wrapper failures) and `pnpm test:dev-safety` (19 pass, 3 skipped). Nine new ADR-0100 tests in `tests/src/autopilot.test.ts`. Browser walk on a throwaway database: [evidence](evidence/autopilot-settings/README.md). No live run and no model call (a live run on the dev studio needs Jordan's typed OK and the dev studio upgraded to schema 63).

P-11 and P-12 (Jordan's UX decisions, added before review): routine approvals made with an autopilot end when it finishes, fails or is cancelled, and stay while it waits for a person; approvals the run already had keep their terms. Quote-checked web claims an autopilot finds wait for a person unless the owner turns on **Accept quote-checked web claims** (off by default, not part of Hands-off); the autopilot stops for them with Allow and continue, and each one it accepts is labelled “Accepted by autopilot · quote check only” in packets, Decide and proposal references. Three new tests (both store rules mutation-checked). Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test` with the database (1181 tests: 1147 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

Review 1 fixes (no High; M-1, L-1 to L-8 and the eight nits, all fixed; ADR-0100 amendment). Six new tests (M-1, L-2, L-3, L-4, L-7 in `autopilot.test.ts`; the L-6 stamp in the P-12 store test, mutation-checked); the L-5 linking test updated. Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test` with the database (1186 tests: 1152 pass, 29 skipped, the 5 known PowerShell-wrapper failures), and the walk again on a fresh throwaway database.

Re-review 2 fixes (two Lows, six nits, all fixed; ADR-0100 amendment): Allow and continue is offered only when it changes a setting, and a stop the autopilot can no longer get past ends it and its approvals; the start check adds up each step's need from the config (5 types + research on 10 requests is refused); connection-setup refusals come first; the room check runs inside the idempotent start; workflows an autopilot starts are stamped. New tests for L-1, L-2, N-1, N-2, N-4 and N-5. Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test` with the database (1190 tests: 1156 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

Limits: web search for evidence runs only on a ChatGPT plan connection; the fixture's identical ratings cannot show a tie broken; Whole process still stops a software option at the spec.

## November 14 update — final UX pass P-1 (build after approval) and P-10 (build run default)

What now works (no migration or ADR): a build whose acceptance cases the worker could not run (no WSL2, a lost run, cleanup pending) stops at once with the worker's reason and keeps its candidate, instead of spending its repair rounds on the same patch and stopping with "Patch changes nothing". Building again (after a new approval) carries on from that kept candidate: when the builder submits the candidate's own content, the candidate is reviewed and tested afresh. Build's Start build form opens on the run the spec was frozen in. The P-1 finding's guess (retrying from `task.head`) was not the cause; see `tracking/evidence/p1-build-retry/README.md`.

Checked: the UI walk through Build on a throwaway studio with the test-double worker (start, approve, start again, Package, Try; and the worker-blocked path to Try), the 390 px Build check (one serious target-size on the fresh state on this branch alone, fixed by PR #192's text-button size; 0 with #192 merged), `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (1173 tests: 1139 pass, 29 skipped, the 5 known PowerShell-wrapper failures). Not covered: the real WSL2 worker (the live walk on Jordan's PC).

Review 1 fixes: a worker-blocked stop no longer shows the "app closed… Recover" notice (whole-word match); a run left needing cleanup says to Recover first and shows Recover; only the verified build offers "Packaged: open it under Try"; Start build no longer labels runs "no model grant" or prefers a granted run (outdated since ADR-0054: the build's one approval admits its plan requests; re-review L-1); the unfinished case is recorded in the build folder. Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1174 tests: 1140 pass, 29 skipped, the 5 known PowerShell-wrapper failures), and the blocked-worker UI walk to Try.

## November 14 update — final UX pass, fixture part (PR #192)

Web-only polish from the pass (see `docs/FINAL_UX_PASS_FINDINGS_2026-11-14.md`): autopilot stop guidance, banner wording, Back to top, accessibility sizes and alignment, wording nits. `scripts/ux-sweep.mjs` added (axe-core dev dependency). Not changed: server, contracts, migrations. Open: proposals P-1..P-15 for Jordan, including the P-1 build-retry bug.

## November 12 update — full codebase audit and its fixes (L-1, L-2, N-1..N-7)

Audit of main `abf4d77` (schema 62): [report](../docs/FULL_AUDIT_2026-11-12.md). No High or Medium; 3 Lows, 7 nits. Fixed here (no migration or ADR): a failed background refresh keeps what a panel shows and says so (`useLoad` `stale`, shown by `Status`), so the Autopilot, Automation levels and Build panels keep polling after one dropped request; those panels and the Gallery terminal list poll only while their page is shown and the window is visible (`usePoll`); one shared end-time helper (`apps/web/src/end-time.ts`); Automate selection no longer skips a problem whose newest assessment was cancelled or failed; a failed browser launch can no longer end the API on Windows or macOS; the Codex pin is checked against the install script by a test; unused exports, the stray `t17-test.log` and the one clippy warning are gone. Review 1 fixes (2 Lows, 5 nits; `/mnt/project-files/reviews/PR191_REVIEW_2026-11-12.md`): every `useLoad` view now shows a failed refresh (`Status` `stale` or `StaleNote`; a test scans the pages), the live assessment, exploration and Monitor views poll with `usePoll`, Autopilot unticks its confirmation when a summary changes, the end time is read again on return only once it is close or past, and a refresh that lands with new dependencies is a full load. Re-review nits (4): an end time not yet confirmed counts from when the form is shown again (a confirmed one is read again only once it is close or past), a full load after the dependencies change shows Loading, and an automation test reads its end time once. Left for the final UX pass: L-3, the refresh of `docs/CURRENT_STATUS.md`, the README boundary paragraph and the product guide.

Checked in the cloud container: `pnpm typecheck`, `pnpm format:check`, `cargo clippy --target x86_64-pc-windows-gnu` for the desktop crate (clean), `pnpm test:db` on PostgreSQL 16 (1165 tests: 1131 pass, 29 skipped, the 5 known PowerShell-wrapper failures) and `pnpm test:dev-safety`. The N-7 and L-1 tests were mutation-checked (each fails with its fix removed). No browser walk and no model call.

## November 12 update — PR #150 review nits N-1..N-3

What now works (no migration or ADR): the web qualification test finds its own record by recipe, benchmark, connection, model and both prompt hashes instead of pinning one record and today's prompt hashes, so a later prompt or benchmark bump, a requalification with new prompts, or another route's or model's record no longer turns it red (the app already ignores a stale record; the test now checks that too). The P15 results file records the SHA-256 and size of all 40 per-attempt files it was copied from (`source_files`, hashed read-only on Jordan's PC on November 12; each `package.tar` hash equals the recorded one, and the test checks that). `docs/STATIC_WEB_RECIPE.md` gives the real build-time range, 64.8 to 67.6 s.

Checked: `pnpm typecheck`, `pnpm format:check`, `node scripts/p15-web-benchmark.mjs verify` (ok), the changed test, and two mutation checks (a wrong `package.tar` hash fails it; an extra record for another benchmark and connection does not). `pnpm test:db` on a throwaway PostgreSQL 16: 1146 tests, 1112 pass, 29 skipped, 5 fail (the known PowerShell-wrapper tests; no pwsh in the cloud container).

Review 1 fixes (2 Lows, 2 nits): the test matches the record on all six fields, so a requalification with new prompts or another model's record on the same connection stays green; the count is 40 files, not 41; the freeze check reads the results file's own benchmark folder; the note says intent.json and the screenshots are not among the hashed files (hashing intent.json needs read access to the p15 worktree's `.creator` folder, which was not granted).

## November 12 update — P33 automation levels for a project (ADR-0099, migration 62)

Walk item 22, Decision B1. What now works (schema 62): Discover has **How much is automated** under Run it for me. For an active supervised or human-in-the-loop run the owner chooses a level and confirms its summary and the run's routine approvals (new, widened, or already covering) in one tick. **Automate selection** is a standing level on the run: each time an assessment on that run finishes, the studio starts a selection-only P13 autopilot for that problem, which chooses by the fixed rule and writes a proposal for a non-code option or stops for a person (a tie, unknown or unstable scores, a gate, ethics cleared only on the model's word, a software option). **Automate the rest** starts an autopilot at assessment or selection of a recorded problem on the running project. **Whole process** is Run it for me on a new run. **Set back to Manual** stops the level and its running autopilot. The level stops itself when its owner, run or routine approvals no longer allow it, or its end time passes. Autopilot cards say which level started them.

Checked in the cloud container on PostgreSQL 16: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1127 tests: 1093 pass, 29 skipped, the 5 known PowerShell-wrapper failures) and `pnpm test:dev-safety` (19 pass, 3 skipped). Browser walk on a throwaway database: [evidence](evidence/p33-automation-levels/README.md). New tests `tests/src/automation.test.ts` (6): presets and stages per level; policy covering and widening; an assessment on the run starts exactly one selection autopilot recorded with the level and assessment, under the Autopilot actor, none for an assessment before the level or after Manual; refusals (no or uncovering approvals, data class, end time past the approvals, changed summary, non-owner, twice); the level stops itself after the approvals are revoked and when its end time passes, and leaves an autopilot's own assessment to that autopilot (mutation-checked: removing that rule fails the test); HTTP set, list and Manual.

Review 1 fixes (November 12): applying a level changes the run's approvals in the same transaction as the level or autopilot, so a refused start changes nothing; an archived problem no longer stalls the level; a policy with too few steps left is offered widened; the status line and audit log name who stopped or started what. Tests now also cover a level that chooses and saves a proposal, and the stop when ethics was cleared only on the model's word (11 automation tests). Rechecked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1138 tests: 1104 pass, 29 skipped, the 5 known PowerShell-wrapper failures), `test:dev-safety` (19 pass), and the browser walk again.

Review 2 fixes (November 12): money the run's approvals have already admitted counts when the panel checks whether they cover a level, and used-up or expired approvals are offered widened instead of blocking; the panel shows Manual (with a note) while a choice Automate selection started is still working after the level was stopped; a start's approvals change now comes after the run's own checks; ADR-0099 notes the stop's lock order.

Review 3 fixes (November 12): when the run's approvals stopped because a person rejected a decision (or a paid call's outcome is unknown), the panel says so and will not widen them, even when they also ran out of steps or time; the owner looks at them under Monitor › Approvals first. The widened label lists every reason. Review 4 nits: an unknown paid outcome now points to reconciling the call under Monitor › Budgets (confirming the approvals again does not clear it), with tests for that and for a rejection with used-up steps. Rechecked after reviews 3 and 4 and merging main with #187 and #189: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1158 tests before the review 4 tests: 1124 pass, 29 skipped, the 5 known PowerShell-wrapper failures).

Limits: up to a minute between an assessment finishing and its choice; one autopilot per run at a time; Whole process still stops a software option at the spec (spec, build, review and QA are a later P13 slice); no live run was made (none needed; a live run on the dev studio needs Jordan's typed OK and the dev studio upgraded to this schema).

## November 12 update — Oversight lock order fixes (ADR-0098)

What now works (no migration): cancelling a run, revoking or revising a grant, revising a routine policy, answering a decision and admitting an action no longer deadlock against each other. Oversight writes lock run, decision, routine policy and grant, in that order, before their first audit append. The scan of other audit appenders found the same pattern in three places, and each now takes its locks first. Routine admission of web discovery claims locks its discovery, grants and sources up front. Cancelling or otherwise changing a workflow locks the workflow's run first, so it cannot deadlock with an answer to the workflow's question. A desktop job lease locks overdue jobs in id order, so two workers leasing at once cannot deadlock.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 (after review 4 and merging main with #189: 1146 tests, 1112 pass, 29 skipped, the 5 PowerShell-wrapper failures that always fail in the cloud). New tests: `tests/src/oversight-lock-order.test.ts` (5), `tests/src/desktop-lock-order.test.ts` (2), plus one each in `workflow.test.ts`, `subscription-workflow.test.ts` and `web-discovery.test.ts`. Each parks two transactions where the old order deadlocked and fails with "deadlock detected" on the old code.

Review 1 (2 Medium, 2 Low, 4 nits) fixed. M-1: the first lease fix deadlocked two workers; expiry now locks in one id-ordered statement. M-2: a workflow cancel against an answer still deadlocked; workflow entry points now lock the run first. L-1: claim sources are locked up front. L-2: the three reorders now have tests. Nits: `lockGrantForWrite` reports the policy row; the lock-waiter helpers moved to `pg-harness.ts`; the ADR names what is defence in depth.

Re-review 2 (2 Medium, 3 nits) fixed: a subscription plan request for a workflow task now locks the run before the workflow (M-1), and pausing or revoking a device locks its jobs in id order (M-2), each with a test that deadlocks without the fix; the ADR and the workflow store's lock-order comment are corrected.

Re-review 3 (1 Medium, 4 Lows, 2 nits, all also on main) fixed. M-1: the outbox relay delivers a decision wake in its own transaction, so it no longer deadlocks with a pause or task commit on another run. L-1: the owner's Add of web claims locks the claims' sources up front. L-2: a route outcome locks its promotion first. L-3: an assessment's options and older scorecards are locked up front by every workflow entry point. L-4: task claiming runs all portfolio gates before leasing. N-1: admission takes the portfolio job fence before expiring decisions. Tests for M-1 and L-1 (and, after review 4, L-2 to L-4).

Review 4 (1 Low, 3 nits) fixed: tests for L-2, L-3 and L-4 from the reviewer's patch (each deadlocks on the old code); the ADR names the real L-2 cycle (two outcomes of one promotion); finishing assessments of one problem take turns on an advisory lock; the options lock uses the primary key.

Limitations: four of the `lockWorkflowRun` call sites (task finish, lease sweep, decision wake, reconcile) are reasoned from the tested cancel path.

Next eligible: unchanged (P33 after P13 merges).

## November 12 update — the last older review items (#128 N-6, #129 N-4, #90 N-4 leftover)

Checked on main 9c6e751: #75 L-1 (stale-prompt rows read "historical pass (older prompt)"), #77 L-1 (`manifestCalls` test) and the first point of #90 N-4 (a failed Revoke or Stop keeps its message) were already fixed. What now works: the Codex plan relay stops the upstream call as soon as Codex disconnects, also while it waits for upstream data (before the headers or during a silent stretch), and records it as `codex_disconnected`; a relay closed by the builder records `relay_closed` instead of `timeout` (#128 N-6 and its note; `packages/executor/src/codex-host.ts`). Monitor › Approvals clears an error from a failed background poll when the next poll works, while an action's error stays (#90 re-review N-4, second point; `apps/web/src/oversight.tsx`). Review fixes (4 nits): a Codex disconnect during admission is noticed too, so nothing is sent upstream (test); the `relay_closed` test has a timeout; `poll-error.mjs` also checks that a refused Revoke keeps its error through a good poll (6/6 PASS); these logs say which point of #90 N-4 each change fixed. #129 N-4: a browser walk checks the owner-action buttons for each member role (owner, editor, viewer) on Models, Budgets, Library, Evidence and Runs, and that the server refuses each hidden action for that role (`tracking/evidence/member-roles/`). No migration, no ADR.

Checked (cloud container, throwaway PostgreSQL 16): `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (after the review fixes 1131 tests: 1097 pass, 29 skipped, 5 fail, all five the known PowerShell-wrapper tests; no pwsh in the container). New tests in `tests/src/codex-host.test.ts`: a disconnect before the upstream headers and during a silent stream each stop the upstream call and settle `codex_disconnected` (both fail with the new close listener removed), and closing the relay settles `relay_closed`. Walks on review ports 5183/4330/4340: `member-roles/walk.mjs` 27/27 PASS, `poll-error.mjs` 3/3 PASS (with the old `oversight.tsx` the error stayed after a good poll). Not independently reviewed yet. Still open from older reviews: PR #150 N-1..N-3.

## November 12 update — the owner's gate checklist (ADR-0097, migration 60)

What now works (schema 60 on this branch; 57–59 and 61 are reserved by other open branches): Settings › Team profile › Gate checklist, where the owner writes up to 12 ethics or access items (or adopts a suggested list); every assessment answers each item pass, fail or unknown with citations and names the capabilities the option needs; a new gate rule "Gates clear when they pass your gate checklist" clears ethics when every ethics item passed and access when every access item passed and the app found every needed capability in the team profile (checked on this computer, or declared when no check can test it). Compare lists the items that did not pass and the needs the app could not confirm, with what to do. A changed checklist marks assessments stale. Assessor prompt `r08-assessor/2.0`; benchmark `assessment-synthetic-v3` (15 cases).

Checked (cloud container, throwaway PostgreSQL 16; with the review 1 and 2 fixes): `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (after merging main with #180, #181, #182, #183, #184 and #186, migrations 55 to 61: 1127 tests, 1093 pass, 29 skipped, 5 fail, all five the known PowerShell-wrapper tests, since there is no pwsh in the container), with new `gate-checklist` tests (admission rules, verified capabilities, the store end to end, the mid-build refusal, and an agent's routine selection stopped on a checklist-cleared ethics gate), a `team-api` HTTP test and a packing test for checklist answer sizes. Remaining: the dev studio needs a v3 requalification after merge (15 plan requests, $0, needs Jordan's OK); notifications beyond Compare are not built.

## November 12 update — P30 copy connections between workspaces (ADR-0095)

Walk item 20. Models and connections › a connection › **Copy to another workspace** (owner of both workspaces) makes a new connection there with the same kind, name and settings (caps, allowed data and tasks). The copy starts not signed in, with no model checks, qualifications, credits statement or accepted caps; the source is unchanged. A ChatGPT sign-in is not shared, because its refresh token rotates (deviation from the plan's suggestion, recorded in ADR-0095). Optionally (opt-in, explained before Copy) the source's Chat answers setting is copied when the target has none. Re-review 2 and 3 fixes: the copy names the Chat answers version its note described and is refused if that changed (the form then re-reads and unticks); the result says whether the copied setting is on; the setting is read without a row lock and before any write, so a copy and a Chat answers save at once cannot deadlock (test). Re-review 4: all of the copy's rows are written before its audit records, so a ticked copy and a Chat answers save in the target cannot deadlock either (test, both with and without a target setting); the concurrency tests wait on reported lock waits, not sleeps. Re-review 5: a Chat answers save checks its version inside the write, so a stale first save (another tab, or racing a copy) is refused instead of overwriting (pre-existing gap in `setChatSettings`; tests). Re-review 6: a model switch writes the Chat answers row before its audit records, so it cannot deadlock against a Chat answers save in the same workspace (pre-existing order in `setModelChoice`; test), and the two-first-saves test now really overlaps the saves. Store `copyPlanConnection`, route `plan-connections/{id}/copy`, web `copy-connection.tsx`. No migration. Tests: `tests/src/copy-connection.test.ts` (DB and route) and `tests/src/web-copy-connection.test.ts`.

## November 12 update — P13 autopilot, slice 1 (ADR-0092, migration 57)

What now works (schema 57; this branch carries #179's migration 56 before it): Discover has **Run it for me (autopilot)**. The owner picks a route (a verified plan model or an API budget), optional web search (ChatGPT plan only), interests, groups, exclusions, evidence roles, a model-call limit and an end time, confirms the autopilot summary and the routine-approval policy built from it, and starts. One durable autopilot then runs research (optional) → Explore for me → brief → discovery → automatic assessment → selection → proposal on the Run, each step through the existing store operation and its checks, with the request and idempotency key stored before sending. It ends with an explicit outcome (proposal, insufficient evidence, no eligible option, needs a person, needs authority, limit reached, failed, cancelled) and a reason. Stop cancels the running child; Continue reruns only the stopped step after the cause is fixed; a studio restart resumes running autopilots without repeating steps. The choice follows a fixed rule (unique, fully scored, stable, gates clear); ties, unknown ratings and blocked gates stop for a person. A software option stops for the person, usually at `select` (choosing it for a build needs their humility review) and otherwise at `spec`. API: `POST runs/{id}/autopilots`, `GET autopilots[?run=]`, `GET autopilots/{id}`, `POST autopilots/{id}/cancel`, `POST autopilots/{id}/continue`.

Checked in the cloud container on PostgreSQL 16: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1053 tests: 1018 pass, 29 skipped, the 5 known PowerShell-wrapper failures, and the schema-version check in `storage.test.ts`, which expected 55; updated to 57 and rerun with the autopilot tests, 21 of 21 pass). New tests: `tests/src/autopilot.test.ts` (13: stage order, child limits, explored pick, choice rule against `checkSelection`, refusal outcomes; full fixture path tie → needs person → a person's scorecards → Continue → proposal admitted as `covered_by_routine_policy`; start refusals; empty workspace; call limit; Stop cancels the child; restart recovery without duplicate workflows; revoked policy; research step with a stub web runner; HTTP routes). Not checked: a live run on a real model (needs Jordan's typed OK), the web panel in a browser.

Limits: in-process runner without a lease (recovered every minute); spec writing, build, review and QA are a later slice; ethics must be cleared by a person (or their confirmation) before the autopilot's own choice is admitted; research step tested with a stub; the panel does not yet offer starting part way.

Review 1 fixes (PR #183, November 12; branch merged with #179's `claude/project-thread-uf8kgy`, migration 56 before 57): the autopilot's records name it, not the owner (H-1), and its choice stops for a person when only the model cleared ethics; a choice made under Decide while it waits is the one Continue goes on with (M-1); options that could be chosen and are not fully scored stop the rule (M-2); Lows and nits per ADR-0092's review amendment. Review 2 fixes: a part-way start keeps a person's earlier choice; tests for the end-time and Stop cancels, recovery and the step cap; nits. Review 3 fixes: a person's choice is carried on only while its scores are current (a start at assessment that rescored stops and asks); the open question is recorded on the step; tests for the 10-call minimum, the Approvals sentence and the end time during waits. Review 4 fixes: the scores check covers every recorded choice, including one that advances nothing; a test for the shortlist-size part. Checked on main with #178, #179, #184 and #186 merged (migrations 55, 56, 57, 58, 59, 61): `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1108 tests: 1074 pass, 29 skipped, only the 5 known PowerShell-wrapper failures); 24 autopilot tests.

## November 12 update — P29 extra requests when the daily cap runs out (ADR-0094)

What now works (migration 59): when a connection's studio daily request cap is used up, the owner can add **20 requests for the next 24 hours**, and again each time it runs out (Jordan's decision of November 11). The top-bar usage button says "· used up", its panel says when the next request is possible and offers **Add 20 requests for 24 hours** with a confirmation, and the connection's card in Models and connections shows the same notice. While an extra is in force both say "Includes 20 extra requests until …; after that the cap is 40 a day again". A refused request has its own code (`daily_cap_reached`), so the P27 fix buttons offer the same press beside the refusal. Admission counts the configured cap plus unexpired extras; the configured cap, accepted caps and recorded usage do not change, so the next window starts at the configured cap. Owner-only, offered only while used up (a second press with room left is refused), bound to the connection version, kept in an append-only table and audited. The provider's own limit stays a notice, and the $20 runtime ceiling is not touched.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 (1045 tests: 1011 pass, 29 skipped, the 5 PowerShell-wrapper failures that always fail in the cloud). New tests in `tests/src/p29-extra-requests.test.ts`: admission counts extras, the fix is offered by code, only the owner can add and only when used up (viewer, editor, stale version, wrong amount and a second press refused), the settings and recorded usage stay, grants are append-only and audited, an expired extra stops counting, and the confirmation words. Not checked: the press in the installed app or dev studio (it needs a used-up connection; Jordan can try it at the next upgrade).

## November 12 update — P28 OpenAI API key in Models and connections (ADR-0093)

What now works (migration 58; with #179 and P31 merged, migrations run 56, 58, 61; P13's 57 still to land): the owner of a real workspace adds, replaces and removes the workspace's own OpenAI API key in Models and connections › Other routes › "Your OpenAI API key". The key is sealed in the studio's protected vault (DPAPI on Windows, purpose `openai-api-key`) and never stored in the database, audit log, a response or a log; only its last four characters are shown. Calls from that workspace then reach the OpenAI route through the broker (API process and standalone worker), still under a grant, a funded budget, pricing and the $20 ceiling; P22's "Test connection" works on it. A studio started with `CREATOR_LIVE_PROVIDER=openai` keeps using its own key, and the panel says so. Fixture workspaces refuse a key. New ChatGPT plan and Claude Code connections now propose a 64,000-character input cap (Jordan, November 11), in the web and in `config/connections/*.json`; existing connections keep theirs.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container (after re-review 3: 1048 tests, 1014 pass, 29 skipped, the same 5 PowerShell-wrapper failures). New tests: `tests/src/workspace-api-key.test.ts` (vault kinds kept apart; environment key wins; a failed unlock is retried; the panel's key check never repeats the key; through the API: malformed, stale and fixture saves store nothing; an editor cannot save or remove; save, a paid check that reaches the loopback server with the saved key, replace (old vault entry gone, next call uses the new key), stale replace and remove refused, remove stops calls; database and audit log hold the last four only). Browser walk on reviewer ports (5183/4330/4340, throwaway DB, file-dev vault): save, saved state, remove confirm, removed; the key is not in the page after saving.

Limitations: the X02 batch adapter still uses only the environment key. Changing only the model needs the key pasted again. Not live-checked: DPAPI sealing of a key and a real Test connection in the installed app need Jordan's typed OK (a paid request, well under one cent, inside the $20 ceiling).

Review 1 (4 Lows, 6 nits) fixed: a saved key the studio cannot open shows as unusable (`saved_unavailable`), a failed file delete is reported and retried, the 64,000 default is pinned by a test, the startup, health and Budgets texts mention saved keys, and Change model re-points a key without pasting it (see ADR-0093 review amendment). Review 2 (2 Lows, 4 nits) fixed: a damaged key file is never quoted in the log, a studio without a key store no longer claims it deleted a file, failed unlocks are retried once a minute, and the health text no longer overclaims (re-review amendment).

Next eligible: P29 (running in parallel), then P30 and P31.

## November 12 update — P31 model help on Chat cards (ADR-0096, migration 61)

What now works: on a draft Chat card the owner can press **Fill in with <model>**; the workspace's chat model proposes text for the card's descriptive questions from the conversation (never a pick, judgment, budget or routine setting), the proposals are recorded with exactly what was sent, and **Use these** saves them as answers the person can change before Send. A finished card offers **Next step** (the Path's next card, or its tab). The Chat discovery card has **Explore for me**, the same component and routes as Discover; "Use this" fills the card from the pick, and an unedited pick starts on its own brief.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container (1045 tests: 1010 pass, 29 skipped, the 5 PowerShell-wrapper failures that need `pwsh`, and the schema pin in `storage.test.ts`, now 61 and passing on rerun). New tests: `tests/src/chat-action-fills.test.ts` (reply parsing, fillable keys per kind, records only when allowed, owner only, chat off, judgment keys refused, version, card unchanged, retry sends once, daily chat limit, settled fills immutable, audit without words, sent card refused, delete with fills, HTTP route) and an Explore pick test in `web-chat-cards.test.ts`. Browser walk on the reviewer ports with a throwaway database (fixture workspace): a budget card sent, **Next step: fetch a page** shown and added; Explore for me opened in a discovery card and started an exploration through Discover's routes (worker off, so it stayed running). Not walked: Fill in with a model (needs a verified plan connection; covered by the fake-`claude` tests).

Limits: an edited pick's own brief is not archived from a card; no live model call was made.

Review 1 fixes (PR #181, 1 Medium, 6 Lows, 6 nits; see the ADR-0096 amendment): a conversation with a fill can be deleted after a restore (migration 61's trigger), a database missing migrations names them, migrations are checked to be in order, the server sets each question's type and saved answer, typed answers are replaced only on a second press, an Explore pick always sets the card's claims and roles. Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1046 tests: 1012 pass, 29 skipped, only the 5 PowerShell-wrapper failures). The restore-order test fails on the old trigger and passes on the new one. The P20 Chat walk (`tracking/evidence/p20-chat-actions/walk.cjs`) passed again on this branch on the reviewer ports with a throwaway database and the worker on: the refused fetch is still refused, held for a decision then answered and sent again, and the stale card refused (409). Explore for me inside a card started and finished an exploration, but the fixture explorer proposed nothing without claims, so "Use this" filling a card is covered by `web-chat-cards.test.ts` only.

Re-review 3's three nits fixed too (ADR-0096 re-review 3 amendment; new test in `web-chat-cards.test.ts`). Re-review 2's four nits fixed (see the ADR-0096 re-review 2 amendment). Checked again: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (1046 tests: 1012 pass, 29 skipped, only the 5 PowerShell-wrapper failures).
After re-review 3: `pnpm test:db` 1047 tests, 1013 pass, 29 skipped, only the 5 PowerShell-wrapper failures.

## November 11 update — assessments read option claims; link claims from the app (ADR-0091)

What now works (no migration; schema 56 with #179 merged): an automatic assessment also reads claims linked to each option and tags them with the option in the packet; without option claims the packet is unchanged, and the R08 prompt is unchanged so assessment qualifications stay valid. Linking or unlinking evidence on the problem or an option marks earlier automatic assessments stale. Before Assess, Decide warns about options with no claim of their own, with **Link claims** (suggested claims that name the option, pre-ticked, plus a filter) and **Find evidence on the web** (opens Search the web filled in). Decide also has **Link claims to this problem** and **Link claims to this option**; Sources › Claims and Library claim pages show what a claim is evidence for, with **Unlink…** (asks for a reason; rows for a problem drafted from the claim have none) and **Link to problem** (the problem or one of its options). Under an option whose score is a range, Decide names the card behind each end and its unknowns, with **fill in the automatic assessment's unknowns**, **fill in your card's unknowns** (when the person's own card sets an end) or **score this option yourself** (when they have no card and no automatic card of this option version exists), or linking evidence and assessing again. Ranges still combine as before (Jordan's choice: keep them honest). Requests are also sized to the connection's answer cap (three option-and-rubric assessments per request at 16,000 characters, four at 20,000 or more), after a live run's part hit 16,005 of 16,000. Merge-review follow-up: the response explanation and gate confirmation build the selection report with the same inputs as Compare and recorded selections (team hash and problem-only claims hash), so a team-profile change makes cards stale there too.

Checked: `pnpm typecheck`, `pnpm format`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container (after re-review 3 fixes and the main merge: 1049 tests, 1015 pass, 29 skipped, and the 5 known PowerShell-wrapper failures, no `pwsh` here; merge-review follow-up #186 with #181 merged: 1066 tests, 1032 pass, 29 skipped, the same 5; `team-gates.test.ts` checks the response explanation, with and without a recorded selection, after a team-profile change), new tests in `assessment-packing.test.ts` (option claims first, tags, coverage, ninth-option claims not counted, small-packet hashes unchanged), `assessment.test.ts` (an option claim read and tagged, staleness, archived option) and `claim-suggest.test.ts` (suggestions on the CSV case in miniature, range ends). Browser walk-through on a fixture workspace: link two suggested claims to an option from the warning, preview tags them, fixture assessment, range explanation, Sources link/unlink, and the Search the web hand-off.

After upgrading, a problem with claims already linked to its options shows its automatic assessments as stale (they did not read those claims); the stale reason says so and to assess again.

Not done: live check on the dev studio (Jordan's CSV problem); the four CSV claims are linked separately on his PC.

## November 11 update — team profile and gate confirmations (ADR-0090, migration 56)

What now works (schema 56): Settings › Team profile, where the owner ticks what the team can run, install and do with data, or runs a built-in check (Python, pip, Java, Node.js, Git, Docker, Jupyter) on the studio's computer; every automatic assessment reads it (assessor `r08-assessor/1.2`), and an assessment goes stale only when the team block it read changes (a re-check that finds the same is a no-op). Compare shows each gate's concerns with who raised them, what to do, and the owner's one-click "Clear: I confirm" with a one-line reason (only once something has assessed the option). The owner chooses who clears gates: you (default), access on the model's reading of the team profile, or both gates on the model's word (Jordan's November 12 decision; such gates are marked "no person looked"). Review 1 fixes (H-1 by Jordan's choice, M-1, L-1 to L-5, N-1 to N-7) are in. Review 2 fixes: the middle choice is labelled as the model's reading of the team profile (an app-verified choice needs part 2), a run's selection stops for a person when the model alone cleared ethics (Jordan's yes), the bundled assessment benchmark is now `assessment-synthetic-v2` with three gate cases, and checks run from a studio-made empty folder.

Checked: see the PR for this branch (`claude/project-thread-uf8kgy`): `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container, with new `team-domain`, `team-gates` and `team-api` tests. Not live-checked: the plan-route assessment needs a new scoring qualification first (the prompt changed), which needs Jordan's typed OK; built-in checks have not run on Windows yet.

## November 11 update — P27 fix it here (ADR-0087)

What now works (no migration; with P12, P34 and P24 merged in, schema 55): where a plan refusal shows, the owner can fix it in place. Discover's setup reasons, Discover › Explore for me, Decide › Automatic assessment, the Chat discovery card and Build offer **Review and accept caps**, **Allow <data class> on this connection** (for example approved private data), **Allow this task** / **Allow and qualify**, and **Qualify now**, next to the existing "Open Models and connections" link. Each one reads the connection again, shows what it will do in the Models page's words (caps line and allowed work, "Will change: …" and whether the caps are accepted again, or the benchmark with its plan request count and pass bar), and only then calls the owner's existing routes. Only the owner sees them. Plan refusals now carry stable codes (`PlanRefusal`: caps not accepted, data class or task not allowed, not qualified, and others) on the connection detail (`refusals`) and on refused route checks and plan requests (`error.reasons`), so the buttons attach by code, not by wording; the refusal sentences are unchanged. A qualify fix runs only a benchmark of the route's own role, so Discover, Explore for me and the Chat card offer Qualify now on the discovery benchmarks the server offers (P34, `GET plan-benchmarks`); Build offers it for the build roles and Decide for the assessment benchmark.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container (after the P24 merge and review 7: 1040 tests, 1006 pass, 29 skipped, the same 5 PowerShell-wrapper failures). New tests: `tests/src/p27-fix-here.test.ts` (codes beside unchanged words, fixes by code with one allow-and-qualify per task, Discover blockers attached by code not wording, benchmark per role, confirmation texts, owner-only rendering), a data-class case in `web-allow-tasks.test.ts`, and the store's coded refusal in `subscription-workflow.test.ts`. Browser walk on the reviewer ports (5183/4330/4340, throwaway database, no sign-in, no model call): Discover's Review and accept caps showed the caps and allowed work and accepted them; picking approved private data offered Allow approved private data, which saved it and re-accepted the caps (version 4, still accepted); Explore for me offered Allow this task for research synthesis and allowed it. The walk found and fixed one bug (the fix read the connection detail with a strict schema). Review fixes (PR #177 review, all findings and nits): Run of a qualification is owner-only on the server (an editor could run one and record its failure before); a started qualification is run on only if it is the same benchmark (by manifest hash), another benchmark blocks the press with a message; several tasks stop at the first that does not pass; a saved change closes the panel even after a later failure; Explore for me counts the newest decided qualification; an unverified model still gets Allow this task; a fixture connection is never offered a qualification. Merged with #175 (P34): discovery's qualify fixes use the server's offers, started by name. Merged with #176 (P24): Allow and qualify posts one qualification queue, which the studio runs while the person may leave the page; while a queue or a Run holds the connection, presses that qualify are disabled, and the server refuses a start by hand while a queue runs. Not checked: Qualify now and Allow and qualify end to end (they run a real qualification: needs a verified model and Jordan's typed OK), the Chat card and Build buttons on screen (checked by type and tests).

## November 11 update — P24 qualify several tasks (ADR-0088)

What now works (migration 55; schema 55): Models and connections › Qualify a model for a task has "Qualify several tasks": checkboxes on the benchmarks that are allowed and not yet qualified for the chosen model, with Qualify selected and Qualify all. The studio runs the queued qualifications one after another in the API process under a database lease, so the page can be left; each finishes and records itself. Each task is started and admitted when its turn comes (same checks as a start by hand, then plan admission per case), a failure or refusal stops the queue and says where, Cancel stops tasks not yet started and lets the running one finish, and a restart resumes the queue without starting any task twice. Progress shows in the section and in Activity. A Run pressed by hand on the connection is refused while its queue runs. Review fixes (PR #176 review M-1, L-1 to L-4, N-1 to N-4): a stopped or cancelled task can be queued again, a runner cannot take its own queue twice, a repeatedly failing queue stops with its reason, a qualified task's re-run is not offered, the server refuses a queue while a Run executes, and the section says how many requests are left today. After merging P12, the queue follows research synthesis's two lanes (locator and web discovery, ADR-0086), and the section warns before Qualify all when its total (up to 45 plan requests for six benchmarks on a fresh connection) is above the connection's daily cap (default 40). After merging P34, the queue keeps each role apart (ADR-0089: the assessor and the discovery skeptic; the locator and web discovery), takes the offered discovery benchmarks by name, and leaves out a task whose other role is started; Qualify all on a fresh connection is then up to 63 plan requests.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 database in the cloud container (1025 tests after the merge with P34 and review 5: 991 pass, 29 skipped, and the same 5 PowerShell-wrapper failures that need `pwsh`). New tests: `tests/src/qualification-queue.test.ts` (PostgreSQL: order and one start per task, stop on failure, cancel mid-queue, crash between two runs with two runners sweeping at once, crash after a start, a task disallowed mid-queue refused at dispatch, caps changed and not re-accepted, queue admission rules, the review fixes, and research synthesis per lane: locator and web discovery queued apart, two web discovery benchmarks of any role version refused together, a web pass refusing only web discovery and a locator pass refusing only the locator; offered discovery benchmarks queued by name, a name not offered refused, and the assessor and discovery skeptic kept apart) and in `web-qualify-form.test.ts` (choices, request body, running and stopped rendering, choices per lane, the note before a queue that needs more than the 24-hour cap, and the discovery choices: queued by name, per role both ways, not offered while another role runs, 63 requests in all). Not checked: a live queue on a real plan connection (needs Jordan's typed OK); a browser walk.

## November 11 update — P34 qualify the discovery roles in the app (ADR-0089)

What now works (no migration of its own; with P12 merged in, schema 54): Models and connections › Qualify a model lists research synthesis, candidate generation and scoring "for discovery" beside the bundled benchmarks, with the same allow / start / started / qualified / failed states. The server picks each one (`GET …/plan-benchmarks`: the newest frozen manifest per discovery task class that passes the discovery role-currency check; today `discovery-research14-v2` and `discovery-semantics-v2`, since `discovery-synthetic-v5` was frozen for the older role 1.3) and loads it itself when the app starts a qualification by name; a name that is not offered is refused, and every existing check still applies. Qualifications carry `admits_discovery`, and the Chat discovery card, Discover, Explore for me and the model switcher now count only discovery-bound qualifications (an assessment scoring pass no longer makes Discover look ready). The "not qualified" texts send people to Qualify a model for the discovery steps.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 database in the cloud container (at the review-fix head: see the PR #175 review fixes paragraph), new `discovery-benchmarks.test.ts` (catalogue covers every discovery folder; offered names pinned; stale v5 and an edited prompt are never offered; start by name on a real connection with fixture mismatch, ADR-0052 held-out binding and duplicate-run refusals), the API route and start by name in `plan-connections-api.test.ts`, and the Qualify list and per-role states in `web-qualify-form.test.ts`. Browser walk on a local dev server with a real-mode workspace (verified access inserted directly, no model call): the list, "not allowed" with Allow this task, and Start then Run offered (screens in `tracking/evidence/p34-discovery-qualify/`). Run was not pressed.

Live (Jordan's typed OKs, dev studio running the P12 checkout at schema 54, $0 on the ChatGPT plan): gpt-6-astra is qualified for all three discovery steps on the benchmarks P34 offers. Research synthesis `discovery-research14-v2` (cc9e4f2a), candidate generation (cab57f95) and discovery scoring (7118b6d9) on `discovery-semantics-v2`: each 2/2 practice and 4/4 held out, 6 plan requests each. On Jordan's say-so the connection now allows all tasks, and its daily request cap went from 40 to 70 (both changes re-accepted). Evidence: `tracking/evidence/p34-live-discovery-qualify-2026-11-11/`. P34's own code has not run live yet: the dev studio database is at schema 54 (P12) and this branch is at 53, so `admits_discovery` shows once P12 and P34 are both in.

Re-review fixes (PR #175 re-review: L-A on this side, N-A, N-B, N-C): `runningFor`, `rowLatest` and `qualificationTask` in `apps/web/src/qualification-role.ts`; a start of one role never runs a running qualification of the other; older-prompt rows say so; the evidence README leads with the current state. M-A and the rest of L-A live in P27 (#177) and were handed over. New tests for all three helpers. Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (see the handoff for counts).

Merged with P12 (#173) on November 11 (see the ADR-0089 P12 merge amendment): one per-role rule for web, assessment and discovery qualifications; P12's separate `web` flag in Qualify a model is replaced by the `web_discovery` role tag. Checked at the merge head `20e036d`: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` 1003 tests: 969 pass, 29 skipped, 5 PowerShell-wrapper failures (no `pwsh` in the cloud container), confirmed by the second re-review. Second re-review nits fixed after it: `forDiscover` removed (no app caller; `isDiscoveryQualified` is the one discovery filter), an older-prompt running row is tagged "another run is started", and the held-out test covers both directions through qualification-linked views.

Review fixes (PR #175 review: M-1, M-2, L-1 and nits N-1, N-2, N-4; N-3 does not reproduce, as a fixture connection lists no benchmark): Qualify and the Qualified tasks list judge each qualification within its own role (`qualification-role.ts`). A failed assessment scoring run no longer withdraws a discovery scoring pass. Rows and outcomes say "scoring job for discovery" and the like. A bundled benchmark's role comes from its checks, so P12's web discovery benchmark is "research synthesis for Search the web" and never borrows a locator pass. A running qualification of the other role is named, with no Start. Checked at the final head: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (983 tests: 949 pass, 29 skipped, only the 5 PowerShell-wrapper failures).

## November 11 update — P12 Search the web (ADR-0086, migration 54)

"Search the web" on Discover finds new evidence online through the ChatGPT plan connection's own web search (Jordan's November 11 route: no search or browser API). One search request records its search calls and consulted URLs apart from the model's text; application code chooses pages only from those reported sources; the studio's own guarded fetcher fetches and stores them under the evidence-site policy; a second request reads the stored passages and proposes claims; each quote is checked word for word against the stored passage, and only checked claims can be added (by the owner, or by a routine policy that covers the new `evidence` stage). The owner's start is the one approval for exactly that discovery's two requests and chosen pages. Walkthrough item 15 (page furniture) is fixed: menus, buttons, headers and other furniture are stored as `boilerplate` passages after the page text and never sent to the reader. Bundled benchmark `web-discovery-v2` (13 cases, 7 held out: live-search scout cases and synthetic reading cases; `web-discovery-v1` is kept as the record of the first live run and no longer admits anything); a web qualification admits only web discovery.

Checked in the cloud container on a throwaway PostgreSQL 16: `pnpm typecheck` parts (`tsc -b`, web `tsc --noEmit`), `pnpm format:check`, the full `tests/dist` suite (918 pass; 7 fail: the 5 known PowerShell-wrapper tests, no `pwsh` here, and 2 qualify-form tests that failed only because the benchmark file was generated after that run; they pass now), then the 14 new `web-discovery` tests and 15 affected suites again after the last edits (150 pass, 0 fail). After the PR #173 review fixes: full suite 934 pass, 5 fail (the same PowerShell-wrapper tests). Nothing live was run; Windows-local checks were not run.

Pages stored before schema 54 show the furniture fold only after they are fetched again. Live on the dev studio (2026-11-11, Jordan's typed OK): gpt-6-astra failed `web-discovery-v1` (5/7 held out) and qualified on `web-discovery-v2` (7/7 held out); one discovery proposed 8 checked claims from 5 read pages, all pending Jordan (`tracking/evidence/web-discovery-live-2026-11-11/README.md`). Not yet: the Claude Code route's web search; PDFs; F2 outside web discovery. Reviews 3 and 4 (PR #173, November 11): web-discovery and Discover qualifications are read apart everywhere in the app (`forDiscover`/`forWebDiscovery`; Discover, Explore, the chat card, the model picker, the Models list and Qualify a model), the held-out guard drops a web check's role version from the case key and rechecks every recorded view against the benchmark it showed (so views stored before this change still guard), and model text that is stored is made well formed (no half emoji). Checked in the cloud container: `pnpm typecheck`, `pnpm format:check`, and the full `tests/dist` suite on PostgreSQL 16 (994 tests: 960 pass, 29 skipped, 5 known PowerShell-wrapper failures). If #175 (P34) merges first, follow the reconcile plan in `/mnt/project-files/reviews/PR173_P12_REVIEW4.md`.

## November 11 update — P23 qualify section (ADR-0084)

What now works (no migration; schema stays 53): a second Run of a qualification that is already running is refused by the server ("already running", or "still in flight" from another process), so leaving the page, switching workspaces or a second window can no longer start a second loop or produce "A qualification case is still unresolved." The connection detail says which started qualification is executing, and the Qualify section reads Running… and its locks from that. The section sits right below the approved model check; each benchmark says whether its task is qualified (date and score, with "Start a re-run" and what a re-run does), last failed, already started, or not allowed (with **Allow this task**). Decision A: new ChatGPT connections allow all eight tasks and new Claude Code connections all seven they can take; **Allow all tasks** appears beside Allowed when one is missing, and Change caps has Select all / Deselect all for tasks (data classes unchanged, private data stays opt-in). "Not qualified" messages in Chat, Explore for me and Discover name a task that is not allowed. The ChatGPT Model box shows an example id. Refresh connection status also reloads the Chat answers card when the connection list did not change (gap handed over from P26; walked by the PR #172 review).

Review fixes (PR #172 review: M-1, L-1, L-2 and nits N-1 to N-5, all fixed): refusal texts name Qualify a model only for tasks it has a benchmark for and say plainly that research synthesis and candidate generation can't be qualified in the app yet (P34, planned in PR #174); allow-button errors survive the button; a case of unknown outcome stops the next Run up front; Finish is refused while a Run holds the qualification; shorter qualified tag. New tests: `web-allow-tasks.test.ts` (both request sequences and the refused re-acceptance), the refusal texts and `QUALIFY_IN_APP` against the bundled benchmarks, an unknown-case Run, and Finish refused during a held Run. Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` (963 tests: 929 pass, 29 skipped, the same 5 PowerShell-wrapper failures).

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 database in the cloud container (958 tests: 924 pass, 29 skipped, and the 5 PowerShell-wrapper tests that always fail without `pwsh`; main before this change gave 920 pass with the same 5), including the new concurrency test (two Runs in one process and one from a second store instance; every case sent once). Browser walk on the reviewer ports (5183/4330/4340, throwaway database): a new ChatGPT connection lists all eight tasks; Deselect all plus Summarization showed the "No longer allows …" summary; after accepting, Allow all tasks showed the summary and "accepted again", and saved with the caps still accepted. Not checked: a live qualification (needs a verified model and Jordan's OK); the Claude Code proposal was checked by test, not on screen.

## November 11 update — P25 assessment requests that fit (ADR-0085)

Assessments no longer stop at a fixed 19,000-character packet. Requests are sized to the chosen connection's per-request input cap (counted with the role text, as admission counts it), split down to one option per request when needed, and every request reads the same claims; the preview shows each request's size and how many claims were left out, and offers raising the connection's input cap when evidence is left out or an option alone does not fit. No migration. Checked in the cloud container: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 (962 tests after the review fixes: 928 pass, 29 skipped, 5 fail: the known PowerShell-wrapper tests, no pwsh in the container). Not checked: the Decide screen in a browser, and a live assessment of Jordan's real problem (needs his typed OK; it spends plan requests).

## November 11 update — P26 stale state and small polish

Web only, no migration, no ADR ([fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) P26 with the review corrections M-2, M-3 and N-1). Item 9: the Chat answers card reads its connections again after any write in the window (verifying a model is one; its stamp never changed on verification), and an empty Connection or Model field takes the first connection and verified model once one shows, so a save no longer sends no model until Reset fields (`chat-answers-form.ts`). Item 13: every non-quiet write also announces itself when it is sent (`STUDIO_WRITE_STARTED`), and the usage button starts its fast reads on that, so a qualification run's requests show while the run is open, not only after it ends. Items 5 and 14: the Activity and sidebar counts and the Path and Getting started step circles trim their line box to the digits (`text-box: trim-both cap alphabetic`, inside `@supports`) and pad to the same size, so the number sits in the middle. Item 19 moved to P23 (review N-1), so `models.tsx` is untouched. "Refresh connection status" still does not re-read the card when nothing on the connection list changed; verification itself now does, and P23 owns `models.tsx` if a Refresh-driven read is still wanted.

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container (957 tests: 923 pass, 29 skipped for Windows, WSL2, Codex or pg_dump gates, 5 fail: the PowerShell-wrapper tests that need pwsh, unchanged code), with new tests for the empty-field fill, the card's write listener, and the send-time announcement. Centering was measured with the real stylesheet in Chromium 153 at 125%, 200% and 400% scaling with five fonts (Segoe UI is not available in the container): Path circles went from up to 2 px high to within 0.4 px, counts from up to 1.6 px high to within about 0.5 px. Not yet seen in the installed app.

Review fixes (PR #170 review, two Lows and five nits): the usage watch's 10-minute cap now moves while a write sent from this window is still open and a read shows a plan request running, so a long qualification run stays live to the end (`writeOpen()` in `oversight.tsx`, `watchAfterRead`); the cap is fixed again once the write ends. The Chat answers card re-reads connections after a write only while Models is shown; a hidden page reads on return as before. A saved connection or model the lists no longer offer is replaced by the first one offered (`matchOfferedChoice`), so the form always saves what the select shows. A skipped step's dash keeps the untrimmed layout (back to main's position, within a pixel row). The source-matching tests are labelled as wiring checks; the fix plan now lists item 19 and the Refresh-button reload under P23. Checked again: typecheck, format, `pnpm test:db` (958 tests: 923 pass, 29 skipped, the same 5 pwsh failures, plus one failure of the server-side X03 search acceptance test that this PR does not touch; it passed in the first run and 3 of 3 runs alone), plus a new test for the moving cap.

Re-review nits (RN-1, RN-2): when the saved model is no longer verified, the card says so under Model and names the model a save would use (`savedModelNote`), since chat keeps refusing until the owner saves. A failed background read now shows its own message, cleared by the next successful read, while a refused save or Allow keeps its message until the next action. Checked: typecheck, format, `pnpm test:db` (959 tests: 925 pass, 29 skipped, only the 5 pwsh failures).

## November 11 update — fix plan from the installed-app walk

Docs only: [fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) for the 24 walk findings (P23–P33 planned, not started; Jordan decided A (all allowed work on for new connections, plus allow buttons), B (whole-process automation after P13) and the P12 route (model connections own web search) on November 11). Checked: `prettier --check` on the new plan.

## November 11 update — Creator Agent visual assets

On base `e2304be`, the [brand pack](../assets/creator-agent/README.md) (Codex-made, reviewed separately) supplies the Windows icon, browser and touch icons, editable mark, horizontal logos and studio cover. It is stored byte-exact (`-text`) so `SHA256SUMS.txt` stays valid; the pack's ZIP copy is not committed. Wiring: the web favicon, Apple touch icon and the mark at both web brand placements; `icons/icon.ico` for the executable, window and tray; the mark in the desktop status window header; and the NSIS installer and uninstaller icon, header and sidebar images (`tauri.local-bundle.conf.json`). `scripts/brand-derived-assets.ps1` regenerates every app copy; the pack README lists them and `SHA256SUMS.txt` hashes them. The ICO's 256 px frame is stored as PNG (369 KB to 114 KB, all nine frames pixel-identical).

Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm build`, `pnpm test:db` on the throwaway test database (909 pass; 5 Windows-local failures in unchanged code: installed app holding studio ports, CRLF runner output, a `c:` ESM URL) and `bundle:windows`, which built the NSIS setup with the new icon and images. Nothing was installed and the setup was not run, so the installer pages have not been seen on screen.

Current source: main `e08e0a4` (PR #150, November 6). Schema **49** (migration 42 is intentionally
unused, see ADR-0070). No open pull requests on November 10. The installed app is still `f6e2ba0`,
schema **41** (upgraded November 4); the dev studio on Jordan's PC runs from the worktree
`C:\dev\creator_agent_p15` at `b73bd95`. This top section was rewritten on November 10 by the state
review ([report](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA)); the November 4 text it replaced
is kept verbatim below under "November 4 top section (superseded)". Dated sections further down are
the record of each package and are appended to, not rewritten.

## Current state (November 10, 2026)

[November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md) packages:

| Package                                    | State on main                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P00 candidate and repair closure           | Done (PR #135; F1/F2 recheck passed)                                                                                                                                                                                                                 |
| P01 activity links, P02 sorting and paging | Merged (PR #138)                                                                                                                                                                                                                                     |
| P03 chat context                           | Merged (PR #136, fixes #139; ADR-0070, migration 43)                                                                                                                                                                                                 |
| P04 guided Discover                        | Merged (PR #140; ADR-0071)                                                                                                                                                                                                                           |
| P05 workspace files                        | Merged (PR #141; ADR-0072, migration 45)                                                                                                                                                                                                             |
| P06 named notes                            | Merged (PR #142; ADR-0073, migration 46)                                                                                                                                                                                                             |
| P07 previews until stopped                 | Merged (PR #137; ADR-0069, migration 44)                                                                                                                                                                                                             |
| P08 automatic assessments                  | Merged (PR #144; ADR-0074, migration 47)                                                                                                                                                                                                             |
| P09 why this response, proposals           | Merged (PR #148; ADR-0077, migration 49)                                                                                                                                                                                                             |
| P10 scoped routine approvals               | Merged (PR #153; ADR-0079, migration 50); no evidence-admission stage yet (P12)                                                                                                                                                                      |
| P11 committee staging                      | Design and tester accounts merged (PRs #135, #143; ADR-0075, migration 48); deploy waits on D1–D9                                                                                                                                                    |
| P12 online discovery                       | Built in this branch (ADR-0086, migration 54): Search the web through the plan connection's own web search; live on the dev studio 2026-11-11: qualified on web-discovery-v2 (7/7 held out), one discovery proposed 8 checked claims, pending Jordan |
| P13 unattended workflow                    | Slice 1 built (ADR-0092, migration 57): autopilot from evidence to a proposal; software stops for a person                                                                                                                                           |
| P14 capability inventory and benchmarks    | Merged (PRs #135, #145, #146; ADR-0076)                                                                                                                                                                                                              |
| P15 larger software                        | Slice 1 `static-web/1` merged and recorded qualified on one route (PRs #149, #150; ADR-0078); later slices not started                                                                                                                               |
| P16 external runbook export                | Merged (PR #152; ADR-0080, no migration); wording follow-up merged (PR #163)                                                                                                                                                                         |
| P17 integrated acceptance                  | Not started                                                                                                                                                                                                                                          |
| P18 collapsible options, shorter pages     | Merged (PR #162; no migration or ADR)                                                                                                                                                                                                                |
| P19 Standard/Advanced across the app       | Merged (PR #164; ADR-0082, migration 52); Decide and Proposals folds follow-up on branch `claude/project-thread-qc6o5z`                                                                                                                              |
| P20 whole process from Chat                | Merged (PR #165; ADR-0083 amending ADR-0057/0070, migration 53)                                                                                                                                                                                      |
| P21 quick model switch                     | Merged (PR #161; ADR-0081, migration 51)                                                                                                                                                                                                             |
| P22 live API and GitHub checks             | Merged (PR #160); live checks passed November 10–11 (R24, R25)                                                                                                                                                                                       |

Checks on main `e08e0a4`, November 10 (cloud container, PostgreSQL 16): TypeScript, web typecheck and
formatting pass; `pnpm test:db` 867 tests, 833 pass, 29 skips, 5 fail (the known wrapper tests that need
`pwsh`); standalone safety 22 tests, 19 pass, 2 skips, 1 fail (a Windows-only test that did not skip on
Linux; fixed in the November 10 cleanup). `pnpm audit` reports no known vulnerabilities. GitHub Actions
is out of minutes (every run since about November 3 fails in seconds), so the Windows CI job has not run
for PRs #132–#150.

Open items:

- **Web recipe record (PR #150 review M-1):** resolved November 10. Jordan opened the previews of attempts
  2 and 3 and both showed the page, so the frozen per-attempt bar is met for 3 of 3.
- **Installed app** is eight schema versions behind main; migrations 43–49 are not rehearsed on a copy of
  the installed database, and the web preview frame is not observed in the desktop window.
- **Windows verification:** no full Windows run of main since CI stopped.
- **Owner pilot:** finished. Jordan marked it finished on November 10 (PR #155); its window ended
  November 6.
- **Older review items:** none open. PR #150 N-1..N-3, #128 N-6 and #129 N-4 fixed November 12. Health reports configuration,
  not live state; the preview cookie-host limit remains. (#75 L-1 was repaired earlier; #77 L-1, the first point of #90 N-4
  and PR #148 N-I are fixed by the November 10 cleanup; the second point of #90 N-4, a stale poll error, on November 12.)
- **The web qualification record** lives in source against the dev studio's connection id, so it does not
  apply to the installed app's connection.

## Next eligible prompt

P10 and P16 merged on November 10 (main `cb12eeb`; next free migration 51, ADR-0081). Jordan's 25 revision notes
were checked against main on November 10 (12 done, 7 partial, 6 not done; 14 done, 6 partial, 5 not done after P22's
live checks; table in the
[plan's November 10 section](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md#november-10-check-of-jordans-revision-notes-and-added-packages-p18p22)),
which added P18–P22. Next: P18 and P21 (small, UI only, can run in parallel); P22 (live tests approved November 10);
then P19; P12 once Jordan picks the next step from the search route investigation (PR #157, merged); P13; P20; later P15 slices; P17.
The installed-app upgrade stays owner-gated (rehearse 41 to current on a copy first). Do not automatically install,
publish, run a live provider or advance the pilot or thesis. Accepted owner decisions and existing scoped grants
remain authoritative.

## Previous sessions

All prior content is preserved byte-for-byte in [the historical record](BUILD_STATUS_HISTORY_2026-11-04.md); hashes
are in [the archive receipt](evidence/codebase-repairs-2026-11-04/document-archives.json).
The [previous section index](BUILD_STATUS_HISTORY_INDEX_2026-11-04.md) retains section names and archived targets without loading the historical narrative at startup.

## November 4 top section (superseded)

Current source: main `171430b` plus authorized audit and authentication review repairs (uncommitted). Schema 41;
no installed-app change, live provider call or new milestone activation. Preserve the existing
`.codex/config.toml` user change and the audit report/evidence from the previous turn.

### Current work (November 4)

Repaired the nine findings from [the audit](../docs/CODEBASE_AUDIT_2026-11-04.md): patched
Node baseline and bundle guard; version-bound sign-in/refresh and early disconnect; truthful
startup configuration; native Windows Claude fixtures and a corrected terminal secret check;
current standalone safety gates and Windows CI; current docs; derived qualification labels;
lazy secondary pages; concise tracking with preserved history.

Those schema-40 checks/bundle are historical: full PostgreSQL suite 720 pass/27 skip/zero fail,
22 current safety passes, TypeScript, web build, formatting, Windows Rust compilation and staging.
Claude's [independent review](../docs/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md) found
M1/L1 authentication issues and L2/L3 evidence/handoff gaps. The authorized follow-up repairs
are recorded in [the follow-up report](../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md), including
schema-41 checks and hashes. C54 and full product acceptance remain partial. No
installed-app/database update or live provider call.

Claude's [follow-up review](../docs/CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md)
passed M1/L1/L2/L3 with Lows F1/F2. That thread then repaired them at Jordan's request
([F1/F2 repairs](../docs/CODEBASE_AUTH_F1F2_REPAIRS_2026-11-04.md), ADR-0068); the repairs are not
yet independently rechecked. Current verification: **769 tests, 742 pass, 27 explicit skips,
zero failures**; current safety **22/22**. TypeScript, web typecheck, formatting and whitespace
checks pass.

Open older review items: **#77 L-1, #90 N-4, #128 N-6, #129 N-4**; descriptions and remaining
source-detail gaps are retained in [the current handoff](SESSION_HANDOFF.md).

### Next eligible prompt (November 4, superseded)

Next: **U02 focused independent recheck of the F1/F2 repairs** (`#settlePlanRequest` and the
three new tests), then owner-authorized acceptance work, including a migration-41 rehearsal on a
copy of a real schema-40 database.
Do not automatically install, publish, run a live provider, start new additions or advance the
pilot/thesis. Accepted owner decisions and the existing scoped grants remain authoritative.

## November 5 revision planning (documentation only)

Added docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md and
CREATOR_AGENT_PROMPT_RUNBOOK_2026-11-05.md: all 19 owner revisions mapped to 18
implementation packages, plus eight retained backlog tracks and task prompts.
Coverage and prompt-fence checks passed. No application code, operational data,
configuration, grants, provider calls, installation or activation changed; prior test
results were not rerun. The actual project is C:\dev\creator_agent; the supplied
OneDrive workspace path no longer exists. A read-only Git status attempt reported
“must be run in a work tree”; exact candidate/dirty-state reconciliation is included
in P00. Next eligible remains the focused independent F1/F2 recheck, before additions.

## November 5: P00 remainder, P11 staging design, P14 capability matrix (documentation only)

- [P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md): the candidate is main `9fe673b`, schema 41;
  the next free migration is 42 and ADR 0069 (recheck, because parallel threads allocate them). The F1/F2
  independent recheck already **passed** and the migration-41 trial and upgrade are done, so the
  "Next eligible remains the focused independent F1/F2 recheck" lines above are superseded. #77 L-1
  and #128 N-6 details were recovered from their original reviews. The Nov 1 audit and pilot F2–F21
  findings have a status table.
- [Committee staging design](../docs/COMMITTEE_STAGING_DESIGN_2026-11-05.md) (P11): costed hosting
  and sign-in options, code gaps G1–G6 (only one OIDC subject can sign in; builds need Windows+WSL2),
  and decisions D1–D9 for Jordan. Nothing was chosen, created or bought.
- [Capability matrix](../docs/CAPABILITY_MATRIX_2026-11-05.md) (P14 inventory): only `python-build/1`
  and `python-terminal/1` are supported. Every other kind is unsupported or unverified. Also lists
  representative tasks and a proposed P15 order.

No code, data, configuration, provider call or installation changed, and no tests were run (docs only).
Next eligible: P01. P11 continues with tester accounts (G1) once started, and its deploy waits on D1–D9.

## P03 chat context (November 5, 2026, ADR-0070, migration 43)

Chat now answers general requests broadly. Each message has a context choice (Automatic,
General, My projects, Selected records); an explicit choice wins, and Automatic sends studio
records only when the message names them. The fixed rules no longer turn ordinary sentences
into approvals/blocked/next cards. Each answer records the context used, why, and any picked
records, shown in "What was sent". Instructions `chat-assistant-v2`. Fixture-verified only (fake
`claude`, disposable PostgreSQL 16 in the cloud container); no live call, no installed-app change.
Checks: typecheck and web typecheck pass; suite 771 tests, 738 pass, 28 skip, 5 fail (the known
PowerShell-wrapper tests, no `pwsh` in the container); formatting passes; dev-safety 19/20 (the
Windows `pg_ctl` path test cannot run on Linux). Browser walk
`tracking/evidence/chat-context/walk.mjs` passes in dark, light and phone width.
Next: a separate independent review of the P03 PR.

## P03 review fixes (November 5, 2026, ADR-0070 amendment, no migration)

Fixes the PR #136 review (project file reviews/PR136_CHAT_CONTEXT_REVIEW_2026-11-05.md): M1–M3,
L1–L5, N1–N2. Short studio questions ("What's blocked?", "What needs approval?") reach their
cards again; any explicit context makes a message a model question; Automatic mentions are
narrower; broad "research how…", "remember to…" and "stuck on my essay" are no longer
swallowed; General answers leave out earlier studio-record answers and say so; an explicit
studio context the setting refuses is refused at send; the picker lists titles only and
reloads; `inspectDatabase` compares the set of applied migrations (migration 43 kept; previews
take 44). Checks: typecheck, formatting; suite 772 tests, 739 pass, 28 skip, 5 known
PowerShell fails (no `pwsh`); dev-safety 19/20 (Windows `pg_ctl` path); chat-context walk rerun.
Next: a fresh independent review.
Re-review Lows (PR #139 re-review, same day): L-A picks survive a new conversation's first
message; L-B Selected answers also leave out snapshot-made earlier answers; L-C/L-D more
blocked/approval variants, "remember that…"/"note that…"/"save me…" stay questions, "my studio
apartment" is not a mention; N-A unknown migrations are named; N-B ADR wording. Same check
counts (772/739/28 skip/5 known pwsh); walk rerun on a fresh DB.
Third review (same day): L-1 blocked/stuck keeps the general-request guard ("How do I fix a
stuck build in Jenkins?" is a question; "Are any runs blocked?" is a whole-message studio form);
L-2 "Remember that idea…"/"Remember my thought…" save again; N-1 picks made before a new
conversation's first send are cleared when another conversation is opened.
Fourth review (same day): L-A picks clear on every conversation change, including to New
conversation and after delete, except the one the first send creates; L-B only singular
"that/my idea|thought|note" saves; L-C anchored "Which runs are blocked?", "Show me what's
blocked" forms; "Note to self:" saves, a "?"-only target is dropped. All reviewed phrasings now
live in one table test, tests/src/chat-classifier-table.test.ts.
Fifth review (same day): L-1 "about"/"to self" are dropped only straight after the verb, so
"Save my idea: About Time" keeps its text; L-2 curly apostrophes read as straight ones and joined
's matches ("Everything's stuck", "Why's it blocked?"); L-3 one polite wrapper ("Can you…",
"…please", "…and why?") is removed before the whole-message studio tests; nits: thought
experiments and "Remember: I/you/we…" are not saves, a target with no letter or digit saves no
text. All new cases are in the table test.
Sixth review (same day): L-1 "Note: we should build…" and "Remember: we could…" save again
(only "Remember: I prefer/said…" stays a remark); L-2 up to two greetings or fillers ("Hey,",
"Please, can you") and "tell/show me" before a question are removed before the whole-message
tests, and "Is it stuck?" counts; nits: "Note to self:buy milk" and emoji ideas save, bare
"to"/"waiting" no longer open approvals. Cases added to the table test.
Seventh review (same day): L-1 "Show me everything that's blocked" is a studio question again;
L-2 acknowledgement and punctuation lead-ins ("Thanks! What's next?", "Got it, …", "Hi there,
…", "So... …") are removed before the whole-message tests; nits: "Remember: I'm vegan" / "my
name is…" are remarks, "Waiting for an answer" is not an approvals question, "Note to self,
buy milk" saves "buy milk". Rows added to the table test.

## P07 preview lifetime (November 5, branch `claude/project-thread-7c9lp1`)

Previews can be **Timed** (default, 1–60 min) or **Until stopped** (ADR-0069, migration 44,
schema 44): no expiry; live while a preview page heartbeats within 3 minutes; abandoned
previews end and free their slot; links expire after 10 minutes and can be renewed by the
owner; Stop/Revoke cancels in-flight runs and records cleanup. Limits unchanged. Verified
locally on disposable PostgreSQL 16 in the cloud container (see the PR for counts); the preview
page script was walked in headless Chromium against a stand-in store. Not verified: a full
studio browser walk, the installed app, real WSL runs. Awaiting independent review.

## P01 + P02 (November 5, branch `claude/project-thread-pb1ge7`)

Activity destinations, Search reset and server-side sort/paging for Search and the Library;
details and checks are in [the handoff](SESSION_HANDOFF.md) and the PR. No migration, ADR,
installed-app change or live call. Not yet independently reviewed.

## P05 workspace files (November 5, branch `claude/project-thread-h4hwto-p05`)

Sources › Files (ADR-0072, migration 45, schema 45): upload by dropping files anywhere or with
Add files; exact originals and SHA-256 in PostgreSQL with numbered immutable versions; newest-
first list with search inside names and text; inert viewers for text, Markdown, JSON, CSV, code
and images; download of any version's original bytes; rename, link to records, delete/restore
and owner-only permanent deletion; per-file and per-workspace bounds from the environment.

Checked: `tests/src/files-api.test.ts` (real API and PostgreSQL: traversal names, retries,
duplicates, spoofed types, inline image headers, exact download, versions, search with line
numbers, size limits, links, stranger/viewer/other-workspace access, delete/restore/purge,
immutable versions), `files-inspect.test.ts`, and the restore test now round-trips a binary
file through backup and restore. Walked in headless Chromium at 1280 and 390 px: drag over the
Discover page shows the overlay, the drop uploads without leaving the page (an unsaved theme
stayed), the same file again is reported as a duplicate, the picker adds a CSV, Markdown
renders without running a `<script>` line, and the download's SHA-256 matches the source.
Not done (B01): Trash expiry, OCR, editors, conversions, PDF preview, related files, global
Search indexing, record-targeted drops. Awaiting review.

## P05 review fixes (November 5, PR #141 review, migration 45 amended before merge)

Fixes the PR #141 review (project file reviews/PR141_WORKSPACE_FILES_REVIEW_2026-11-05.md): L1
invisible and C1 characters stripped from names; L2 role checked before the body is read; L3
targeted duplicates link to their record and reused keys must name the same target; L4 upload
bodies get a size-scaled deadline while other requests keep 10 seconds; L5 tests for mid-body
cancellation, editor purge, workspace binding and retry keys in the tray (new
`web-transfers.test.ts`); L6 search returns a window from the first match's line, kept text
stays outside the quota (recorded in ADR-0072); L7 tray cleared when another person's session
starts; nits N1–N8 (N5 adds an index to migration 45, which has not merged anywhere yet).

## P05 re-review fix R-M1 (November 5)

The longer upload deadline is granted only inside the upload route, after authentication, the
role check and a declared size within the file limit; every other request on the API and web
ports keeps the 10-second body deadline, and a refusal sent while a body is still arriving
closes the connection. New `files-deadline.test.ts`: unauthenticated, over-limit and web-port
slow bodies close within 11.5 s, and a member's upload still arriving at 14 s is stored (the
test fails on the previous head).

## P04 guided start and readable Discover (November 5, branch `claude/project-thread-h4hwto`)

Discover now opens with three start choices and a Guided/Advanced switch over the same form
(ADR-0071). Guided folds routine settings under one-line summaries; a "What will happen" panel
shows run, permission, model access, effective limits, data class and output, each with its
source; a per-person, per-workspace preset (this browser) can replace the studio defaults; the
default plan connection is now one that is ready and qualified. Discover and Build share one
blocked-reasons list with buttons to the fixing tab; the empty-claims state points to Sources
instead of the CLI. No migration or API change.

Walked in headless Chromium on a disposable database (fixture workspace from `seed-research`,
budget and pricing added in the app): with only the six brief fields typed and one claim ticked,
Guided started a real discovery run and opened it under Monitor › Runs; phone width (390 px)
reads in one column. Already implemented and only inspected: Try completes when feedback is
recorded on the newest package (next-rules), meaningful run labels and newest-first defaults
(PRs #100, #101, #138). For P17: the first-run "No workspace yet" card still mentions
`pnpm cli seed-selection`; the Start-with-a-theme draft form is long; Guided does not yet
apply to Explore's own options or to Build; presets are browser-local. Awaiting review.

## P04 review fixes (November 5, PR #140 review, no migration)

Fixes the PR #140 review (project file reviews/PR140_DISCOVER_REVIEW_2026-11-05.md): L-1 a
picked model pins its connection; L-2 presets drop blank time and budget text; L-3 a failed
start opens the right fold and focuses the field, and the problem list items are buttons; L-6
"What will happen" shows a Ceilings row (plan requests used of the daily allowance, or budget
available and the overall spending ceiling left) and fold summaries name the source of every
value; L-7 merged main keeping main's ADR-0070; nits N-1 (no per-call charge text when model
calls are not pre-approved), N-2 (studio default, not connection caps, when no connection),
N-3 (the reset button and note say routine edits are reset), N-4 (setup blocker views are a
literal union, no cast), N-5 (no private class in presets). Recorded, not fixed: L-4 for P17
(Guided still needs the six brief fields and one claim; the output is a statement, not a
choice) and L-5 in ADR-0071 (Projects pages keep their own blocker text, for P17).

## P06 named notes (November 5, branch `claude/project-thread-h4hwto-p06`)

Sidebar Notes (ADR-0073, migration 46, schema 46): several private named notes per person and
workspace with a switcher, New, Rename, Archive/Restore, Write/Preview (safe Markdown) and
Export as `.md`. Existing notepads became a note named "Notes" with the same text and version;
unsaved notepad drafts in the tab carry over. Autosave and conflict recovery work per note.

Checked: `tests/src/sidebar.test.ts` (privacy across people and workspaces, versions, rename
keeps the text version, archive read-only and restore, no audit rows, member removal, invalid
names, concurrent saves, the 200-note limit under concurrent creates, migration 46 from the
layout before 46, every route with sign-in and CSRF) and `web-note-drafts.test.ts` (per-note drafts,
legacy draft hand-over, export names). Walked in headless Chromium at 1600 and 390 px: an old
notepad draft became "Notes", Preview formats Markdown and keeps `<script>` as text, Export
downloads the exact text, rename and archive work, an archived note is read-only, switching
notes right after typing saves the text, and the chosen note comes back after reload.
Not done: deleting notes, sharing, search over notes. Awaiting review.

## P06 review fixes (November 5, PR #142 review, no new migration)

Fixes the PR #142 review (project file reviews/PR142_NAMED_NOTES_REVIEW_2026-11-05.md): L-1
Archive waits for a save in flight and saves text typed during it, and a restored note brings
back text kept in the tab; L-2 the old `workspace_notes` rows are recorded in ADR-0073 as kept
until the installed app's upgrade is confirmed, then cleared by a later migration (queued);
N-1 ADR wording on old-page tabs; N-2 a legacy notepad draft is kept when the note already has
unsaved text; N-3 Export waits until the note's text has loaded; N-4 the migration test starts
"from the layout before 46" (wording fixed above).

## ADR-0076 builder path rule and refused-patch repair; P14 larger benchmark v3 frozen (November 6, branch `claude/project-thread-q1juny`, ADR-0076, no migration)

What works: the executor path dialect admits Python package files (`__init__.py`, `__main__.py`, `_x.py`) and still refuses dot, dash, `__pycache__`, device and empty segments. Builder packets carry `patch_rules` and `qa_runtime` (the QA command and the `-I` sys.path rule) as data; `builder/1` is unchanged, so both build-role qualifications stand. A submission the patch contract or scoped tool refuses changes nothing, is recorded as `refused-N.json`, and goes back to the builder as repair feedback within `max_repairs`/`max_calls`; the checkpoint names the last refusal. Set v3 (`config/repo-benchmarks/v3/`, own grader copy, `FREEZE.json` `aaf369d7…0e13`) freezes `p14-larger-ledgercheck-v3`, the v2 larger task unchanged; `scripts/p14-benchmark.mjs` takes `--set v3` and picks the set from a benchmark id.

Checks: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` 825 tests (792 pass, 28 skipped, 5 known PowerShell-wrapper failures). Live (dev studio from worktree `C:\dev\creator_agent_p14v3` = `02c7646` + the ADR-0076 executor files, no migration, `plan_roles` gpt-6-astra, $0): v3 stopped after attempt 1 (patch with `__init__.py` admitted; reviewer packet over the 24,000-character input cap). Jordan raised the cap to 60,000 (06:15 UTC) and v4 (`config/repo-benchmarks/v4/`, identical task) went **3 of 3, qualified**: each verified with 2 requests and no repair, grader 10/10 + 21/21 + structure. 7 plan requests in all. Results: `tracking/evidence/p14-benchmarks/RESULTS_V3_V4_2026-11-06.json`; doc sections 8–9.

Review fixes (PR #146 review M-1, L-1 to L-4): a refusal after a reviewed round now keeps that review as `previous_review`; scoped-tool refusals name the path; a directory, a path beneath a file and a no-op patch are refusals (repair feedback) instead of stopping the build; ADR-0076 corrected on Codex call counting. Re-review L-1: a patch with one changed path beneath another (either order) is refused too. 12 new build tests cover every refusal branch, the Codex route and the refusal reset. These changes touch only refused rounds, which the live v4 runs never hit, so the v4 result stands. Checks: see the PR.

Limits: the repair path was not exercised live. The dev studio still runs from the worktree; switch back with `.creator\studio\start-dev.ps1` once this PR is merged and the main checkout is updated. Next: a separate review thread for this PR.

## P08 automatic assessments (November 6, branch `claude/project-thread-rbtrzm`, ADR-0074, migration 47)

Compare can now assess every option of a problem automatically: an `r08_assessment` workflow
(migration 47, schema 47) sends one packet (the problem version, up to 8 options, up to 30
linked claims with passages, the anchored rubrics; nothing fetched) and writes one system
scorecard per option and rubric with full provenance (route, model, prompt, rubric and packet
hashes, cited claim versions and support, uncertainty). Code computes totals and ranks; unknown
stays a range. People edit a system rating into their own card with a reason; the original is
kept and marked replaced. System cards cannot clear ethics or access gates, never select, and
are marked stale (not counted) when the problem, an option, a rubric or the evidence changes.
Plan routes need a scoring qualification on the new `assessment-synthetic-v1` benchmark
(draft for owner review); fixture connections use plain rules, labelled as such.

Checked: `tests/src/assessment.test.ts` (fixture run with provenance, ties, re-run archiving;
edits keep the original, forged/model cards and system-card revisions refused, edit of a
replaced card refused; support retraction and problem revision mark cards stale; bad answers
repaired then failed with no cards; unknown ratings stay a range; owner-only start) and
`tests/src/assessment-benchmark.test.ts` (benchmark bound to the current prompt, fixture and
instruction-obeying answers refused). Not done: owner review of the benchmark; live run.

## P08 review fixes (November 6, PR #144 review, no new migration)

Fixed every finding of the PR #144 review (project file reviews/PR144_ASSESSMENTS_REVIEW_2026-11-06.md;
ADR-0074 amendments): M-1 claims linked or unlinked after an assessment mark it stale
(`linked_hash`); M-2 Compare shows each system card's ratings, rationales, cited claims,
confidence, uncertainty, gate notes and provenance; M-3 Edit targets the exact system card and
a person's card moves on to replace a newer assessment; L-1 new ratings must cite current active
evidence; L-2 a late older assessment never replaces a newer one; L-3 packet limits recorded;
L-4 `admits_assessment` drives the Compare readiness check; L-5 edits name their author; N-1
comment; N-2 plan provider is the connection kind; N-4 more than 8 options assesses the first 8
with a note. Also: qualification starts take up to 256 KiB (the assessment benchmark did not fit
in 128 KiB on the trial copy). N-3 unchanged.

Checked: new DB tests (unlinked claim → stale; edit moves on after "Assess again" and cannot move
back while the newer one is current; old evidence version refused; a late older assessment writes
nothing), the benchmark size check, and a browser walk on a throwaway database
(tracking/evidence/automatic-assessments/walk.txt, 16/16 PASS, fixture only, $0). Full suite:
806 tests, 772 pass, 28 skip; failures only the 5 known PowerShell-wrapper tests plus one
chunked-body test whose oversized body was under the new 256 KiB cap (fixed and re-run green).

## P08 split assessment requests and L-6 (November 6, PR #144, no new migration)

The first live assessment on the trial copy failed with `output_cap_exceeded` (19,510 characters
against the plan route's 16,000). An assessment now sends one request per batch of at most four
option-and-rubric pairs and writes scorecards only when every batch succeeds (ADR-0074
amendments). The preview reports the request count and Compare sizes its limits from it. Re-review
L-6: the edit form now says older claim versions must be replaced and offers to cite the current
versions. Assessor prompt and benchmark unchanged, so qualification b9ad4984 on the trial copy
still counts. Checked: assessment DB tests (two-batch run records every card, unknown answers per
batch, limits too small refused) and the full suite; live re-run pending on the trial copy.

Re-review at 7eaf45d (L-7, N-5): a batch that fails for good now stops the workflow through the
shared stopper, so queued sibling tasks are cancelled and leased ones awaited (only reachable
through the API with concurrency above 1). New tests: a domain check of the stop with a queued,
leased and cancelled sibling, and a DB test where batch 1 succeeds, batch 2 fails after its
repair and no card is written.

## P11 preparation: tester accounts, sample workspaces, upload cap (November 6, branch `claude/project-thread-hdk4s6`)

ADR-0075, migration 48, schema 48 (migration 47 is reserved for P08 in parallel). More than one
person can now sign in through OIDC: allow-listed tester identities each get their own actor,
an expiry and an editor or viewer role in their own synthetic sample workspace. `pnpm ops
tester-add`, `tester-list`, `tester-reset` and `tester-remove` manage them from the command
line; reset retires the old workspace and seeds a fresh one, removal disables the account and
ends its sessions, and neither deletes records. Testers are refused on Settings, plan
connections, payments, campaigns, GitHub, portfolio scheduling, operations and desktop routes,
and the stores refuse them new workspaces, membership changes, owner policy actions and the
spending ceiling. Each person may have at most `CREATOR_FILE_CONCURRENT_UPLOADS` (default 2)
uploads in flight (PR #141 review follow-up).

Checked on a disposable PostgreSQL 16 database in the cloud container: new
`tester-accounts.test.ts` (real API with a local OIDC provider: stranger refused, owner subject,
duplicate, past expiry and owner role refused, tester signs in as its own actor and lists only
its sample, editor writes and viewer cannot, owner's and other tester's workspaces, files and
notes not found, every owner-only route 403 while the owner keeps them, store-level refusals
even with an owner membership inserted directly, reset keeps the old records, expiry and
removal end live sessions, concurrent resets leave one current workspace) and a new
`files-deadline.test.ts` case (two slow uploads at the cap stay open, the third gets 429 at once,
dropping one frees its slot). The owner-only API check was confirmed to matter: with it
disabled the tester test fails. The OIDC test provider moved to `tests/src/oidc-idp.ts`, shared
with `auth-api.test.ts`. Not deployed; D1–D9 still open. Not done: committee profile (G6),
per-tester quotas (G5), tester model route (G4), local Compose rehearsal, tester guide.
Full `pnpm test:db` (PostgreSQL 16): 799 tests, 765 pass, 28 skipped, 6 failed: the five
PowerShell-wrapper tests that always fail in the container (no pwsh), and the new upload-cap
case, whose 429 worked but whose assertion read the error body wrongly; fixed and rerun with
the auth, tester, storage and deadline suites (14/14). Typecheck and format check pass.
Awaiting review.

## P11 review fixes (November 6, PR #143 review, no new migration)

Fixes the PR #143 review (project file reviews/PR143_TESTER_ACCOUNTS_REVIEW_2026-11-06.md): L-1
`addMember` refuses a tester as owner; L-2 the upload slot is held until the response closes
(new test holds the store step and gets 429 for a second upload; it fails with the old
request-close release); N-1 artifact registration checks the owner role before reading the
product store; N-2 tester sessions end no later than the account; N-3 `pnpm ops tester-extend
[--restore]`; N-4 a failed seed after `tester-add` says to run `tester-reset`. N-5 (numbering
with P08) is passed to P08. Tests added to `tester-accounts.test.ts` and
`files-deadline.test.ts`.

## P14 repo benchmarks frozen (November 6, branch `claude/project-thread-5g8cg6`, no migration or ADR)

- [Repo benchmarks](../docs/REPO_BENCHMARKS_P14_2026-11-06.md), **version 2** (v1 was replaced before any run
  after review findings M-1..M-4 and L-1..L-6): small `p14-small-wordtally-v2` (one module, 10 studio cases with 6
  held out, 8 extended) and larger `p14-larger-ledgercheck-v2` (entry point plus a 3-module package, 10 studio
  cases with 5 held out, 21 extended and a structure check) for `python-build/1`.
- The grader is frozen with the cases (`config/repo-benchmarks/grader.mjs`): it compiles every file, merges
  stderr into the compared log like studio QA, and names the freeze, grader, spec and package hashes.
  `compare-spec` binds the studio's stored spec to `spec.json`. `FREEZE.json` SHA-256 `e762e0dd…45dbcd`.
- Every listed known failure has a mutant in `tests/src/p14-benchmarks.test.ts` that the cases named for it
  catch. Cases and grader were committed (`4b4c26e`) before the reference solutions and the freeze.
- Limits found: QA runs at most 10 cases per build, only dependency-free builder tasks build, and
  `python3 -I` leaves `src/` off the import path. The plan connection allows 10 requests per run, so each
  attempt uses its own run.
- Live runs: Jordan gave a typed OK in advance. The dev studio was migrated 40 → 41 with his typed OK (backup
  `C:\CreatorAgentBackups\creator_studio-20261105-200007-pre-migration41.dump`) and is ready; builds wait for
  the v2 re-review.
- **Live results (Nov 6, 9 plan requests, $0):** small `p14-small-wordtally-v2` **3 of 3, qualified at its declared
  scale** (each 2 requests, 0 repairs, QA 10/10, reviewer clean, grader 10/10 + 8/8 under Bubblewrap). Larger
  `p14-larger-ledgercheck-v2` **0 of 3, not qualified**: every builder patch included `src/ledger/__init__.py`, which
  the executor's path rule refuses (segments must start with a-z or 0-9); the builder is never told the rule and the
  studio checkpoints instead of repairing. Evidence `tracking/evidence/p14-benchmarks/RESULTS_2026-11-06.json`.
  Next: a follow-up to state the path/`sys.path` rules to the builder (or allow `__init__.py`) and turn a refused
  patch into repair feedback, then a new larger-benchmark version.

## X10 readiness test clock fix (November 6, branch `claude/project-thread-5z9ubg`, no migration/ADR)

- From 2026-11-06 08:15 UTC the committed-register test in `tests/src/x10-readiness.test.ts` failed everywhere
  because it read the real clock and the owner-pilot window in `config/owner-pilot.json` had ended. The test now
  derives fixed times from the committed window (its midpoint, one second before the end, the end itself, one second
  after): the plan is ready up to the last second and refused with "Pilot window has already ended." from the end
  on; mutating the gate to `<` or to an early cut-off each fails the test (review L-1/L-2). Jordan's pilot dates and the
  production gate (`checkPilot`/`evaluateReadiness`, which still default to the real time) are unchanged.
- Checks (cloud container, no PostgreSQL): x10 test file 5 pass / 1 DB skip (failed 4/1 before the fix), rebased on main after #146;
  `pnpm check` 835 tests, 534 pass, 296 DB skips, 5 fail (the known no-`pwsh` wrapper tests); formatting passes.

## P15 slice 1: static web recipe (November 6, branch `claude/project-thread-ja3wd1`, ADR-0078, no migration)

- New recipe `static-web/1` ([design, limits and owner setup](../docs/STATIC_WEB_RECIPE.md)): a task whose frozen
  checks are all `browser_check` with `browser_cases` builds a plain HTML/CSS/JS site from the reviewed
  `static-site/1` template; CLI tasks keep `python-build/1`; a mix is refused. Products without the new `recipe`
  field are unchanged. The spec form edits browser cases (one typed step per line, held-out flag).
- QA: the reviewed checker `packages/executor/worker/web_recipe.py` runs inside the existing Bubblewrap + systemd
  unit with a web policy, serves `site/` on loopback inside the sandbox and drives the pinned Chrome for Testing
  headless shell 156.0.8078.47 over a pipe; steps run in an isolated world; any page error or outside request
  fails the case. The browser is an owner-run, hash-checked install (`install_browser.py`); the studio installs
  nothing.
- Preview: the site is framed from its own `w<id>-<token>.localhost` origin with a session-bound HMAC token, a
  strict CSP and per-request lease and package checks; no command runs or terminal for web previews; hosted
  studios refuse them.
- Frozen benchmark `config/web-benchmarks/p15-small-signup-v1` (10 cases, 6 held out, 9 known failures, checker
  hash in `FREEZE.json`) and `scripts/p15-web-benchmark.mjs` (verify, score, mutants).
- Checks (cloud container, Linux, PostgreSQL 16): full `pnpm test:db` 851 tests (850 in the run plus the always-on freeze test added after), 816 pass, 28 skips, 6 fail: the 5 known no-`pwsh` wrapper tests and the opt-in REAL CHECKER test, which failed only because `pnpm format` had rewritten the frozen benchmark files. The exact frozen bytes were restored (all hashes match `FREEZE.json`), `config/web-benchmarks/` is now in `.prettierignore`, an always-on test checks the freeze, and the REAL CHECKER test passes again (reference 10/10, 6/6 held out, all 9 known failures caught; about 0.8 s per case). TypeScript, web typecheck and formatting pass.
- Not done: WSL2 worker run, exported-package start outside the studio and the live role qualification (all need
  Jordan's typed OK; packet in the design doc). The web recipe is **unqualified**.

## P15 review fixes (November 6, PR #149 review, ADR-0078 amendment, no migration)

- Fixed every finding of [the review](../docs/PR149_STATIC_WEB_RECIPE_REVIEW_2026-11-06.md) (no High, M-1/M-2, L-1..L-7) before
  any live run: worker, WebSocket and WebRTC traffic and service/shared workers now fail a case; web builds are
  labelled unqualified trials (`QUALIFIED_RECIPES`, manifest `role_qualification`, build and Try pages); dialogs and
  document loads fail with named reasons; the preview drops modals, removes the frame when the preview ends, checks
  the frame token before counting a viewer and answers every refusal alike; typed steps round-trip and selectors are
  shape-checked; the benchmark script runs the bridge's own `sandbox_args` and `verify_browser`; banner says links can
  leave; L-7 recorded with a browser update plan ([design §10](../docs/STATIC_WEB_RECIPE.md)).
- Benchmark v1 replaced before any run by `p15-small-signup-v2` (checker changed; same cases, spec content and
  reference; 14 known failures incl. 5 hostile pages). Reference 10/10 (6/6 held out), all 14 caught, twice in a row.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 851 tests, 818 pass, 28 skips, 5 fail (the
  known no-`pwsh` wrapper tests); the REAL CHECKER test passes. TypeScript, web typecheck and formatting pass.
- Jordan gave a typed OK (11:28) for the WSL browser install and the 3 live builds; held until the re-review.

## P15 re-review fixes (November 6, PR #149 re-review at `aec1dc2`, ADR-0078 amendment, no migration)

- [Re-review](../docs/PR149_REREVIEW_2026-11-06.md): no High or Medium. Fixed L-8 (popups fail the case; 1 s settle after
  the last step; docs, ADR and manifest claim only "no outside request seen during the frozen cases"), L-9 (no global
  qualified switch: `unqualifiedTrial` lifts the label only for a recorded pass on the build's own connection, model and
  role-prompt hashes; none recorded), N-1 (hostile known failures pin their reason), N-2, N-3, N-4 (`PINNED_BROWSER` pin
  date, build page shows when the monthly re-check is due or overdue).
- Benchmark v2 became `p15-small-signup-v3` before any live run (popup and late-request known failures). Reference 10/10
  (6/6 held out); all 16 known failures caught, each for its own reason, in two consecutive runs.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 853 tests, 820 pass, 28 skips, 5 fail (known
  no-`pwsh` wrapper tests); REAL CHECKER passes. TypeScript, web typecheck and formatting pass.
- Browser install and live builds (Jordan's typed OK 11:28) still held until a clean review.

## P15 third-review fixes (November 6, PR #149 third review at `e9b5a68`, ADR-0078 amendment, no migration)

- [Third review](../docs/PR149_THIRD_REVIEW_2026-11-06.md): no High or Medium. Fixed L-10 (trial label hashes the
  prompts recorded in the build's `intent.json`, and only a pass on the current benchmark version in
  `RECIPE_BENCHMARKS` counts), L-11 (build page shows the newest package's own label; artifact summaries carry
  `role_qualification`), N-a, N-b (checker reports popups and unsupported workers in `unsupported`, apart from
  `outbound`), N-c (escaped backslash then a comma is refused).
- The N-b checker change made benchmark v3 `p15-small-signup-v4` before any live run. Reference 10/10 (6/6 held out);
  all 16 known failures caught, each for its own reason. `verify` passes and checks `RECIPE_BENCHMARKS`.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 854 tests, 821 pass, 28 skips, 5 fail (known
  no-`pwsh` wrapper tests); REAL CHECKER passes. TypeScript, web typecheck and formatting pass.
- Browser install and live builds still held until a clean review.

## P15 live web qualification (November 6, Jordan's PC, no migration)

- Under Jordan's typed OKs (11:28, 20:24 UTC): pinned browser installed in WSL; dev studio `creator_studio` backed up
  (`C:\CreatorAgentBackups\creator_studio-20261106T204916Z-pre-p15.dump`), migrated 48 to 49 and run from worktree
  `C:\dev\creator_agent_p15` (`b73bd95`) via `.creator\studio\start-dev-p15.ps1`.
- `p15-small-signup-v4`: **3 of 3** on `plan_roles` (`4e4a7bec…`, `gpt-6-astra`): each verified in 2 requests, no repair,
  QA 10/10 (6/6 held out), reviewer approved, exported package 10/10. 6 requests, $0. Jordan saw the preview page in
  its frame in Chrome; WebView2 not observed. [Results](evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json).
- `RECIPE_QUALIFICATIONS` now holds that pass, so new web builds on that connection, model and prompt pair are no longer
  labelled unqualified trials. To return the dev studio to main: stop `start-dev-p15.ps1` and start
  `start-dev-main.ps1` once `C:\dev\creator_agent_main` is at schema 49 or later.

## P09 why this response and non-code proposals (November 6, branch `claude/project-thread-raqxjh`, ADR-0077, migration 49)

- Decide shows **Why this response** for the focused problem: the chosen response (the current selection's advancing
  options, or the top suitability rank when nothing is selected), its reasons and "would change if", and for every
  software or hybrid option not chosen, the criteria it is behind on, the ones nobody rated (unknown, not low), its
  open build gates, its humility review and specific evidence or conditions that would make it preferable. Computed
  by code from the records (`GET problems/{id}/explanation`); no model call.
- New **Projects › Proposals** tab: a recommended non-code option (existing tool, process change, human-led, hybrid
  or investigate) gets a versioned `proposal` record (migration 49) with 15 sections, drafted only from records with
  everything else marked unknown. Document checks (completeness, citation fidelity, changed problem/option/selection),
  reviews bound to one version (verdict, four marks, comments), revisions with a reason, older versions readable,
  Markdown download and "Save to Files" (P05). Software options are refused ("goes to a spec and a build").
- Pilot **F9** resolved in code: the humility gate judges a hybrid option, or its spec, on the hybrid comparison
  (disposition build or hybrid); plain software is unchanged. Jordan confirmed this on November 6 ("Judge the hybrid row").
- Checks (cloud container, local PostgreSQL 16): `tests/src/proposal.test.ts` (4 DB tests: explanation, F9 gate,
  draft/version/check/review/export, API download, save to Files and viewer refusal) and
  `tests/src/proposal-domain.test.ts` (4); browser walk `tracking/evidence/proposals-ui/walk.mjs` with screenshots
  in `tracking/evidence/proposals-ui/screens/` (no horizontal scroll at phone width). Full `pnpm typecheck` + `pnpm test:db`: 843 tests, 810 pass,
  28 skip, 5 fail (the known no-`pwsh` wrapper tests); `pnpm format:check` passes. CI not run (no Actions minutes).
- Review fixes (independent review at d99a7ff, Lows L-1–L-7 and nits N-1/N-2, see ADR-0077): drafts cite claims
  instead of copying them; the export is the same bytes for the same version (no export time, no reviews), so
  Save to Files keeps one copy; "ready" is refused while checks block and self-reviews are marked; one-line titles
  and escaped headings in the export; evidence read in one transaction with errors surfaced; a spec is judged by
  the option version it cites (new admission test); at most 60 cited claims; append-only reviews with a workspace
  FK; case-insensitive list filter. Checks after the fixes: proposal tests 5 DB + 6 pure pass; full `pnpm typecheck` +
  `pnpm test:db` 850 tests, 817 pass, 28 skip, 5 fail (the known no-`pwsh` wrapper tests); `pnpm format:check` passes;
  the browser walk passes again (no horizontal scroll at phone width). Re-review fixes (L-A fenced section text and
  escaped record text, N-A–N-C): same totals, 850 tests, 817 pass, 28 skip, 5 known `pwsh` fails; walk passes.
- Not done: model-assisted drafting, richer export formats; real-world execution and efficacy of any proposal stay
  unverified.

## State review cleanup (November 10, branch `claude/project-thread-7r0ehf`, PR #151, no migration or ADR)

- From the [November 10 state review](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA) (no High; four Medium, eight Low).
  Rewrote the top of this file, `BUILD_STATUS.md`/`SESSION_HANDOFF.md`, `docs/CURRENT_STATUS.md`, the runbook note,
  `README.md` and `docs/LOCAL_DEVELOPMENT.md` to main `e08e0a4`, schema 49 (M4). The November 4 tops are kept.
- Web recipe record (M1): the two stale "`RECIPE_QUALIFICATIONS` is empty" lines are corrected (a dated note is appended to
  the results file; nothing removed). PR #150 review M-1 is restated as open for Jordan; the record is unchanged.
- Fixes: `CREATOR_SESSION_FILE` is no longer read as a secret file by the API and migrations (L2, with a test);
  `pnpm cli help` prints plain usage and exits 0 (L7); the Windows-only foreign-listener safety test skips elsewhere (L8);
  a failed Revoke or Stop keeps its message (#90 N-4, first point; its second point, a stale poll error, was fixed November 12); the comparison's call counts are tested (#77 L-1, `manifestCalls`);
  no bare `: ` label for a control-character source title (PR #148 N-I).
- Left open: `config/owner-pilot.json` status, the installed-app upgrade and the web record decision (Jordan); #128 N-6,
  #129 N-4, PR #150 N-1..N-3; the qualification record living in source (L1). `t17-test.log` stays (the X10 manifest lists it).
- Checks (cloud container, PostgreSQL 16): TypeScript, web typecheck and formatting pass; full suite 867 tests, 833 pass,
  29 skips, 5 fail (the known no-`pwsh` wrapper tests); standalone safety 22 tests, 19 pass, 3 skips, 0 fail. GitHub CI
  cannot run (no Actions minutes). The #90 N-4 change was not walked in a browser. Not independently reviewed yet.
- Next eligible: P10 and P16 (in progress in their own threads).

## Web recipe owner observations, attempts 2 and 3 (November 10, no migration or ADR)

- Resolves PR #150 review M-1. With Jordan's request, the dev studio was restarted on his PC from
  `C:\dev\creator_agent_p15` (`b73bd95`, `start-dev-p15.ps1`; the stopped `creator-agent-local-db-1` container was
  started; no migration). Jordan opened the private previews of attempt 2 (artifact `68654f2d`, commit `bf373f5752`,
  manifest `b49c9fec…`) and attempt 3 (`c9a519b5`, `d81a8cc8c6`, `419e6fd0…`) in Chrome; both showed the sign-up page in
  its frame. Recorded in `RESULTS_P15_V4_2026-11-06.json` (`owner_observation.later_observations`) with his four
  screenshots in `evidence/p15-benchmarks/owner-previews-2026-11-10/` and their hashes. The frozen per-attempt pass bar
  is now met for 3 of 3; `RECIPE_QUALIFICATIONS` is unchanged. Observed four days after the runs, on the same packages.
- The Try list names packages by commit, not by artifact id; the guide's "find artifact X" steps should say so (UX note).
- The dev studio is still running on Jordan's PC and holds the installed app's ports until it is stopped.

## Owner pilot recorded as finished (November 10, no migration or ADR)

- Jordan's decision in the project thread (2026-11-10 08:37 UTC): the owner pilot is finished, not extended.
  `config/owner-pilot.json` now says `status: completed` with `finished_by`, `finished_at` and
  `docs/OWNER_PILOT_LOG.md` as evidence; the log has a "Pilot finished" section stating what it holds and what it
  does not (per-run owner minutes stay unknown). This supersedes the "Owner pilot ... still says `running`" open
  item above.
- Readiness gate (`packages/orchestrator/src/readiness.ts`): a completed pilot is judged by its evidence, so its
  past window no longer refuses it; a pilot that has not finished is still refused after its window. X10 stays NOT
  READY (readiness rows still need owner inputs). `docs/X10_ACCEPTANCE.md` no longer says the pilot was not run.
- Nothing on Jordan's device or in any studio database records the pilot's status (no runtime consumer of
  `owner-pilot.json`), so no app or database step is needed.
- Checks (cloud container): typecheck and format check pass; the X10 readiness tests pass; `pnpm readiness
pilot-check` reports the gate ready with no refusals. Full suite: see the PR. Next eligible: unchanged (P10 and
  P16 in their threads; then the installed-app upgrade, P12 once a search provider is chosen).

## PR #155 review fixes (November 10, no migration or ADR)

- Independent review of PR #155: no High, M-1 and L-1..L-3, all fixed here.
- M-1 and L-1: the pilot log's finish note no longer says F2–F21 are fixed; it points to the P00 reconciliation table
  (F2 open, F5/F7/F15/F17 web/F18 partly open as of November 5, F9 addressed by P09). It now says the 3-in-a-row stop
  rule never fired, with at most 2 failures in a row counting qualifications and builds.
- L-2: `checkPilot` now requires, for a completed pilot, `finished_by`, an ISO `finished_at` that is not before the
  window starts and not in the future, repository-relative evidence paths, and evidence other than
  `config/owner-pilot.json`. Negative tests cover each.
- L-3: the "Owner pilot" open item at the top of both tracking files, runbook step 4 and the `checkPilot` doc comment
  are current. The double blank line before the previous section is removed.

## PR #156 re-review fixes (November 10, no migration or ADR)

- Re-review of PR #156: no High or Medium; L-1..L-3 and a nit, all fixed in the same PR with negative tests.
- L-1: pilot evidence paths are normalised before the "not the pilot config itself" check, so `./config/owner-pilot.json`,
  `config//owner-pilot.json` and `docs/../config/owner-pilot.json` are refused too.
- L-2: pilot evidence must be a file. Empty, blank, `.`, and folders such as `docs` are refused. `checkPilot` and
  `evaluateReadiness` now take an `isFile` check for this; readiness rows keep `exists`, since they cite evidence folders.
- L-3: times must name a real calendar date and clock time (no month 13, February 30 or hour 25), both for
  `finished_at` and for the window, so a running pilot with an impossible end date is refused.
- Nit: `finished_by` must be non-blank text.
- Final review Low (at 1b79084): the "not the pilot config itself" check is now case-insensitive, so
  `Config/Owner-Pilot.json` (the same file on Windows) is refused; test added. Checks (cloud container, PostgreSQL 16):
  typecheck and format check pass; `pnpm test:db` 867 tests, 833 pass, 29 skipped, 5 fail (the known no-`pwsh`
  wrapper tests), the same counts as main.

## P16 runbook export (November 10, branch `claude/project-thread-tq4rcm`, PR #152, ADR-0080, no migration)

- **What works.** A spec (Projects › Build) or a non-code proposal (Projects › Proposals) can be exported as a
  standalone runbook: a ZIP with a README, the shared project contract, requirements and visible acceptance cases,
  the task plan in dependency order, the proposed stack and limits, decisions (decided / proposed / assumptions /
  still open), evidence, recovery steps, one prompt per step with prerequisites, scope, expected artifacts and a
  completion gate, a standard-library Python runner for command-line cases and a `runbook/1` manifest with a
  SHA-256 per file. Download or "Save to Files". Guide: [docs/RUNBOOK_EXPORT.md](../docs/RUNBOOK_EXPORT.md).
- **Rules.** Computed on read by code from one saved version (no model, nothing stored, nothing granted); held-out
  cases are dropped and only counted; well-known credential formats and personal folder paths are replaced and
  counted; the same version gives the same bytes; an unfrozen spec, replaced selection, changed option, missing
  evidence or a spec without executable cases is stated in the bundle; an invalid task plan is refused; every export
  passes `validateRunbook` or fails.
- **Checks (cloud container, local PostgreSQL 16).** `tests/src/runbook-domain.test.ts` (10 pure tests, including the
  shipped runner executed with Python against a reference program and a wrong one) and `tests/src/runbook.test.ts`
  (2 PostgreSQL/API tests). Browser walk `tracking/evidence/runbook-export/walk.mjs` in fixture mode: both panels,
  both downloads validated from their bytes, save to Files twice keeps one copy, no horizontal scroll at phone
  width. `pnpm typecheck` and `pnpm format:check` pass. Full database suite: see the PR description for the totals of
  the final run; the only failures are the 5 known no-`pwsh` wrapper tests, plus one `test:dev-safety` test that
  needs `pg_ctl.exe` (Windows only; it fails the same way on main in this container). CI did not run (no Actions
  minutes), so the Windows job is unverified.
- **Not done.** The plan's independent-consumption gate: a separately scoped implementer building the synthetic
  project from only `tracking/evidence/runbook-export/synthetic-bundle/` in a clean workspace. Not run here, so
  "no missing context" is unverified. Also no browser-case runner, no CLI command, Markdown and ZIP only.

## P16 runbook export: clean-room gate and fixes (November 10, PR #152)

- **Gate result.** A separate session built the synthetic project from only the committed bundle (at `c97bff3`) in an
  empty folder and froze it before the fixture was opened. Both held-out cases then passed on a fresh clone. Record:
  [tracking/evidence/runbook-export/clean-room-2026-11-10.md](evidence/runbook-export/clean-room-2026-11-10.md).
  Limits of that run: one session did all six prompts, the implementer was the same kind of model that built the
  exporter, and A3 was judged only by the implementer.
- **Its findings, fixed in the generator.** F1: a check a person must judge is now "carried out and recorded as
  provisional" in a task's gate, and the contract says an unnamed judge is not a reason to stop. F2: the runner adds
  `-B` and setup adds a `.gitignore` for the Python stack. F3: the contract names the root files no task owns, and the
  review step checks risk mitigations and may fix `README.md`. F4: unclear readings go in `ASSUMPTIONS.md` and are
  copied into the hand-over. F5: `.gitkeep` in empty folders. F6: a reviewer task reviews only its own checks, writes
  to a named file and says whether it wrote the code. F7: the contract defines `<bundle>` and the source archive goes
  outside the project.
- **Checks.** 25 runbook and proposal tests pass (one new test for these fixes; the runner test now also proves no
  `__pycache__` is left). `pnpm typecheck` and `pnpm format:check` pass. The example bundle was regenerated
  (hash `409d0fb8…`). The regenerated bundle has **not** been through a second clean-room run.
- **Second clean-room run (at `cf820c6`).** Both held-out cases passed again and F1 to F7 were found resolved; the run
  was not blind (the implementer had seen the first bundle and the held-out cases). Its three Lows are fixed: N1 the
  unclear-reading rule now says "the reading that does less and refuses more", N2 task gates say a line added to
  `ASSUMPTIONS.md` is allowed, N3 setup says to leave `.gitkeep` in place. The bundle after these three wording changes
  has not been consumed again.

## P16 runbook export: independent code review fixes (November 10, PR #152)

- **Review** of `ff29f25` by a separate thread: no High, 2 Medium, 8 Low
  (`/mnt/project-files/reviews/PR152_RUNBOOK_EXPORT_REVIEW_2026-11-10.md`). All fixed:
  M-1 an action runbook's `PLAN.md` is rendered inside the export from the redacted proposal, and the self-check reads
  Markdown with escapes removed; M-2 a missing humility review, one the pre-build gate would not accept, or unresolved
  ethics is a warning and an open decision, with ethics and dissent in `DECISIONS.md`; L-1 a failed self-check or an
  oversize bundle is `INVALID_CONTRACT` with its reason, slugs cannot look like credentials, the held-out check reads
  JSON; L-2 WSL, network-share and spaced Windows profile paths plus `glpat-`, `hf_`, `npm_` and `Basic` values; L-3
  held-out-only checks get their own gate wording and a review never lands in a code file; L-4 one proposal read per
  export; L-5 `STACK.md` and setup state the Linux `\n` and `python3` assumptions; L-6 the panel offers the frozen
  version when a draft is current; L-7 README states the hash rule, guide and ADR updated, walk records its commit;
  L-8 `evidenceFile` uses the escaped title test.
- **Checks at the fix commit (cloud container, PostgreSQL 16).** `pnpm typecheck` and `pnpm format:check` pass. Full
  suite `node --test tests/dist/*.test.js`: 884 tests, 850 pass, 29 skipped, 5 fail (the 5 known no-`pwsh` wrapper
  tests). `pnpm test:dev-safety`: 22 tests, 19 pass, 3 skipped, 0 fail. Browser walk rerun with a new step for the
  frozen-version offer (`screens/04-frozen-version-offered.png`); `walk.json` records the commit it ran on. CI did
  not run (no Actions minutes). The bundle after these changes has not been through another clean-room run.
- **Re-review (at `08069db`): no High or Medium; all earlier findings fixed.** Its two Lows and two nits are fixed:
  R-1 a spaced account name in a path continues for at most two capitalised words, so ordinary text after a path is
  kept; R-2 when unresolved ethics is the gate's only objection the bundle says the owner's ethical judgement is
  needed, not that the studio would refuse; the README says the owner runs the cases when every case is held back;
  the frozen-version button ignores a superseded response. Full suite after these: 884 tests, 850 pass, 29 skipped,
  5 fail (the known no-`pwsh` tests); `test:dev-safety` 0 fail; typecheck and format pass; walk rerun.
- **Final review (at `e9bcc95`): no High or Medium.** P-1 the account name in a path continues for one or two
  words of any case only when what follows the separator is clearly more path (a profile folder, another folder, a
  file name with an extension); P-2 Windows profile paths match in any letter case; N-1 the ethics-only wording uses
  the gate's own `needs_judgment`; N-2 SESSION_HANDOFF brought up to date; N-3 README names wholly held-back checks
  when they are mixed with manual ones. Tests cover every string the review listed. Full suite after these: 884 tests, 850 pass, 29 skipped, 5 fail (the known no-`pwsh` tests); `test:dev-safety` 0 fail.
- **Second re-review (at `ffb5a12`): no High or Medium.** R2-1 a two-word account name before one last folder or a
  bare separator is removed again (a last segment that ends the text or line, or a separator followed by a space,
  quote, bracket or the end, now counts as more path); R2-N2 names of up to four words, with digits or an apostrophe
  (`O'Brien`), are removed; R2-N3 lower-case macOS `/users/…` and lower-case profile folders on the Unix arm are
  matched, and the guide names the forms still not covered. Every string the review listed is a test row; probes of
  100k to 320k characters finish in about 10 ms. Full suite after these: 884 tests, 850 pass, 29 skipped, 5 fail (the known no-`pwsh` tests); `test:dev-safety` 0 fail.
- **Third re-review (at `b938e15`): 1 Medium, 2 Low, 3 nits, all addressed.** R3-1 (Medium) the last-segment rule
  backtracked cubically on long runs of closing brackets (5,000 took 47 s); the segment class no longer holds closing
  brackets and each part matches one way, so 20,000-character runs take a few milliseconds, with a timing test.
  R3-2 lower-case `/users/name` counts only before a profile folder, so routes such as `/users/me` are kept (test
  rows). R3-3 a last folder closed by a backtick, quote or bracket or followed by a comma is removed whole. R3-N3 the
  Unix arm has its own name class (no dead `replace`). R3-N1 and R3-N2 are named in the guide as limits. Full suite after these: 884 tests, 850 pass, 29 skipped, 5 fail (the known no-`pwsh` tests); `test:dev-safety` 0 fail.
- **Fourth re-review (at `7b8b376`): no High or Medium; 3 Lows and 2 nits fixed.** R4-1 the address-with-password
  pattern starts only where a scheme can start, so 100k-character dotted or hyphenated runs take a few ms (timing
  test; `git+ssh`, `jdbc:postgresql`, `-postgres` still caught); R4-2 the lower-case macOS arm needs the profile
  folder in its real spelling and refuses route placeholders (`{id}`, `:id`, digits, `me`), so routes such as
  `/users/{id}/links` stay; R4-3 a path right after `_` is caught; R4-N1 `*`, `~`, `}`, `|`, curly quotes and `»` also
  close a path; R4-N2 a closing bracket after a path is kept. R4-N3 needed no change. Full suite after these: 884 tests, 850 pass, 29 skipped, 5 fail (the known no-`pwsh` tests); `test:dev-safety` 0 fail.
- **Fifth re-review (at `0c8b2f3`): no High or Medium; 2 Lows and 2 nits fixed.** R5-1 a closing mark inside a
  removed path (`DOCUME~1`, `scans(old)`, `backups[2025]`) no longer cuts the path short: the tail may hold any path
  character and only refuses one as its last, so a bracket that closes the path still stays. R5-2 the
  address-with-password pattern allows an empty user name (`redis://:password@host`) and takes the password up to the
  last `@` before a `/` or space; ordinary URLs (`https://example.com:8080/x`, `ssh://git@github.com/x`) stay. R5-N1 a
  last folder closed by `_` before a space or the end is removed whole; R5-N2 the Unix forms keep a closing `**` or
  `|`. R5-N3 needed no change. Every reported string is a test row, with new timing loops; worst probe 2 ms at 20k
  characters.
- **Sixth re-review (at `0accf31`): no High or Medium, no leak; 2 Lows and 1 nit fixed (both Lows removed too
  much).** R6-1 the address password first stops at quotes, backticks, `<>` and `|` and only falls back to the
  last-`@` rule, so JSON keys, table cells and e-mail addresses after a URL stay; a raw `"` or `|` in a password is
  still caught. R6-2 a path tail no longer ends on `.,;:!`, so `(see /home/jordan/x.md).` keeps `).` and two older
  rows now keep their comma. R6-N1 a snake_case last folder inside `_…_` emphasis is removed whole, with a linear
  form. Every reported string is a test row, with timing loops for the new shapes; worst probe 12 ms at 50k
  characters.
- **Seventh re-review (at `de9bb58`): no High or Medium; 2 Lows and 1 nit fixed.** R7-1 a quote or backtick stays
  inside an address password unless structure follows it, so `P@ss'w0rd@db` is removed whole; a raw `@` before `|`,
  `<` or `>` is named in the guide as a limit. R7-2 a spaced name before one folder and a `.`, `:`, `!` or `?` and a
  space is removed whole. R7-N1 a path that ends at the account name keeps a closer or sentence mark after it, and the
  Unix tails also refuse a final `?`. One older row now keeps its full stop. Every reported string is a test row,
  with timing loops for the new shapes; worst probe 13 ms at 100k characters.
- **Eighth re-review (at `e37eaed`): 1 Medium and 1 nit fixed.** R8-1 (regression from R7-N1) a spaced name whose first
  word ends in `.` or `,` (`J. Price`, `Dr. Who`, `Smith, John`) leaked every later word; extra name words are now
  tried before the ending check, so these names are removed whole again and the R7-N1 rows still keep their marks.
  R8-N1 the guide's raw-`@` sentence is reworded. Test rows for each shape; worst probe 13 ms at 100k characters.

## P10 routine approvals (November 10, branch `claude/project-thread-q4lf7q`, PR #153, ADR-0079, migration 50)

- What works: an owner can choose "Approve routine steps for me" when a run is set up on the Discover form: stages
  (research, model work, selection, specification freeze, build), data classes, a step limit, a money total, an end
  time and two stop conditions, confirmed as one summary. Code admits covered steps through the policy's own grant
  and records each as `covered_by_routine_policy`; a step outside the policy pauses and raises a decision that says
  why. Monitor › Approvals lists each policy with its state, use, confirmed summary and admitted steps, and offers
  Change (new summary confirmed, versioned as widened or narrowed) and Revoke. After Jordan's November 10 request,
  the owner can also turn routine approvals on for a run that is already going, and again after a revoke
  (`POST runs/{id}/routine-policy`, on Monitor › Approvals); autonomous, human-only and study runs are refused.
- Checks run (cloud container, PostgreSQL 16, no CI: no Actions minutes): `pnpm typecheck` passes; `pnpm test:db`
  879 tests, 845 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests); `pnpm format:check` passes. 12 new
  PostgreSQL tests in `tests/src/routine-policy.test.ts`. Browser walk on a throwaway database
  (`tracking/evidence/routine-approvals/`): the form refused to send until the summary was confirmed, a discovery's
  model call was admitted by the policy with no decision raised, then the policy was changed and revoked on the
  Approvals page. The Windows CI job has no local substitute and did not run.
- Not done: no stage covers claim (evidence) admission, which has no action type yet (P12); the money total sums
  stated maximum amounts, not actual spend; the Evidence, Assess and Explore pages register runs without the policy
  fields; no CLI command; no live provider call; not independently reviewed.

### P10 review fixes (November 10, same PR #153; review `reviews/PR153_P10_ROUTINE_APPROVALS_REVIEW_2026-11-10.md`, 1 Medium, 6 Low)

- M-1: mid-run turn-on decides "study run" from a `study_attempts` row or the registered run version's `config_hash`
  (plus the current record), so an editor clearing the hash on the run record no longer opens it. L-1: a build the
  policy admitted stops at its next plan request while a stop condition holds (`routineStopReason`, used by
  `buildApprovalBlockers`); the step limit does not stop an admitted build. L-2: confirming the same settings is
  recorded as `reconfirmed` (migration 50 edited in place again, still unmerged). L-3: a step the policy names but
  does not cover says why (end time passed, data class, money total). L-4: the mid-run form starts from the kinds
  of data the page has seen for the run and says other kinds still ask. L-5: Revoke asks for confirmation.
- Not done (L-6, added so P10 is not read as complete): domain scope and output scope are not part of a policy
  (website scope still comes from the evidence-site settings); evidence admission as before (P12).
- Evidence: `tracking/evidence/routine-approvals/walk-output-2026-11-10.txt` and `screens/` are the captured output
  and screenshots of the three walk scripts, run after these fixes on a throwaway database (`WALK_WS` names the
  seeded discovery workspace). L-1 is tested at `buildApprovalBlockers` with an approval record inserted by the test;
  no plan-role build was run end to end with a policy.
- Checks at `dc29506` (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` passes; `pnpm test:db` 882 tests, 848 pass,
  29 skip, 5 fail (the known no-`pwsh` wrapper tests); `pnpm format:check` passes. 15 tests in `routine-policy.test.ts`.

## Search route investigation and live test — November 10, 2026

Report: [docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md](../docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md);
evidence: `tracking/evidence/search-route-test-2026-11-10/`. Verdict: a separate search API is not
necessary now; evidence is still insufficient for unattended runs. Before the test no route had run
a live search: Brave is off and limited to 1-5 domains, the OpenAI plan route sends no tools, the
Codex builder has web_search disabled (keep it so), and the studio's Claude Code route runs with no
tools. Official docs say web search is supported on the Sign in with ChatGPT plan route. The earlier
[comparison report](../docs/SEARCH_API_COMPARISON_2026-11-10.md) did not assess that route; its
Tavily-first pick conflicts with the accepted October 20 "native plan search first" planning, and
its "next prompt U02" line is stale.

Jordan-approved smoke test: 3 runs of the unmodified Claude Code CLI (studio sign-in, Max plan,
WebSearch only, cap 3 calls per run) produced 9 searches and 30 candidate URLs, all present in the
search output. Each run took 63-68 s at $0 incremental spend. Two earlier attempts failed on a
stale `.oauth_refresh.lock` left by `claude auth status`; both are preserved. Then 15 fetches went
through the studio's fetch adapter, per-hop policy and extractor, outside the studio DB: 5 usable
pages; 5 HTTP 403; 3 reCAPTCHA challenge pages stored as "fetched" (F2); 2 PDFs refused or over the
limit. Stored-text quote checks passed 5/5. Fetching, not finding, is the bottleneck. The studio
routes, configuration, grants and migrations are unchanged; no ADR is adopted. Next: Jordan chooses
whether to start P12 work on challenge/low-text detection and the PDF scope, or to authorise the
small code change that tests plan-route search.

## Revision notes check and plan update (November 10, documentation only)

Checked Jordan's 25 current revision notes against main `cb12eeb`: 12 done, 7 partial, 6 not done. The status table
and five new packages (P18 collapsible options, P19 Standard/Advanced app-wide, P20 chat-guided process, P21 quick
model switch, P22 live API and GitHub checks) were added to the November 5 plan and its prompt runbook rather than a
new plan. No application code, migration, ADR, configuration, grant or live call changed; no tests were needed or run.

## ChatGPT plan route search test — November 10, 2026

Jordan asked for it at 22:19 UTC and approved the dev-connection change at 22:42 UTC. PR #157
(merged) added an opt-in `web_search` option to the plan request (`plan-responses.ts`,
`plan-service.ts`, tests `plan-web-search.test.ts`); no route, UI or workflow uses it. The test ran
through `PlanConnectionService.invoke` on the dev database only (Plus connection `4e4a7bec…`,
gpt-6-astra, purpose chat, cap 3 calls). It was refused once at admission because chat needs
`private_approved`; with Jordan's OK that data class was added for the test, then removed. The
settings are byte-identical again and chat is off (connection version 16 to 21, caps re-accepted
22:44:10Z). Results: 4 search calls, 24 candidates, all in the reported sources, 17-27 s each, $0
incremental. 0 URLs overlap with the Claude Code run. Guarded fetch: 2/15 usable (PDFs, 403s,
Reddit empty shells). Fetching remains the bottleneck; no search API is justified by these
results. See [section 13](../docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md) and
`tracking/evidence/search-route-test-2026-11-10/plan-route/`. No ADR or migration.

## P21 current-model switch (November 10, 2026, ADR-0081, migration 51; branch `claude/project-thread-6af37w`)

- What works: a "Model" button beside the usage indicator (owners only) lists every verified model on the
  workspace's plan connections, says which tasks each is qualified for (Chat, Explore, Discover, Assess, Build),
  and switches the owner's current model. The choice is stored server-side per person and workspace
  (`model_choices`, `GET/POST /api/workspaces/:ws/model-choice`), versioned and audited; only verified models
  are accepted. Explore, Discover, Assess, Build (plan-role builder), the Chat answers setting and Qualify start
  from it unless changed on the form. A form whose task the current model is not qualified for keeps it, shows
  the reason and offers a qualified alternative as a button; it never switches quietly. A saved chat setting
  follows the switch (audited, `via: model_switch`). Runs, builds, qualifications and chat answers already
  started keep their recorded route.
- Evidence: `tests/src/model-choice.test.ts` (form rules, Build default, store: owner only, verified only,
  version conflict, audit, chat follows, earlier answer keeps its model, API route with CSRF and strict body).
  Browser walk on a throwaway database: `tracking/evidence/p21-model-switch/` (two switches move Explore,
  Discover, Assess and chat; a form pick wins locally; no page errors). The walk found and fixed a duplicate
  React key that rendered the picker many times.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm test:db` 903 tests, 869 pass, 29 skip, 5 fail (the known
  no-`pwsh` wrapper tests); after the last web edits, `pnpm typecheck`, `pnpm format:check`, `pnpm test:dev-safety`
  (19 pass, 3 skip) and the model-choice, storage and chat-answers suites (22 pass) were rerun and pass.
- Not done: Build and Qualify not walked in a browser (fixture workspaces have no plan builders and fixture
  connections cannot be qualified; Build's default is unit-tested); no CLI command; not independently reviewed.

### P21 review fixes (November 10, same PR #161; review `/mnt/project-files/reviews/P21_MODEL_SWITCH_REVIEW_2026-11-10.md`, 0 High/Medium, 6 Low)

- L-1: Build re-defaults its builder whenever the current model arrives or changes and nothing was picked on the
  form, so a choice that loads after Build's data is still used. L-2: the first-ever switch checks the version in the
  write itself (`on conflict … where version = expected`), so of two concurrent first switches one is refused as
  `VERSION_CONFLICT` and leaves no audit row. L-3: with no current model, Build defaults to a builder qualified for
  both roles before an unqualified one. L-4: tests that a tester is refused on `/model-choice` (read and switch) and
  that a discovery started before a switch finishes on its recorded model. L-5: `model_choice` activity rows open
  Models. L-6: the picker text names Qualify. Also (on main before this PR): the Build option names the Claude plan for
  a Claude Code connection instead of always "ChatGPT plan".
- L-1 is fixed in the form's effect and was not re-walked in a browser (fixture workspaces list no plan builders).
- Checks (cloud container, PostgreSQL 16, no CI): typecheck and format pass; `pnpm test:db` 912 tests, 878 pass, 29 skip,
  5 fail (the known no-`pwsh` wrapper tests); dev-safety 19 pass, 3 skip.
- Re-review fixes: M-1, Build's choice-change effect no longer runs its reset on mount, so a lost locked builder
  still shows "Chosen plan model unavailable: choose again" (the pure rule `builderAfterChoiceChange`, whose unit
  test covers an unchanged choice keeping a lost builder; no component test). L-1: the help text under a Claude Code builder says "Claude plan". Checks: typecheck
  and format pass; `pnpm test:db` 913 tests, 879 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests).
- Second re-review Lows: L-1, when the current model is not verified on a plan connection here and nothing was
  picked, Build says so and names the model it uses instead, like Explore, Discover and Assess. L-2: the wording above.
- Third re-review Lows: that note is not shown beside "Chosen plan model unavailable: choose again" (nothing runs
  until a builder is chosen) or in a fixture workspace (Build lists no plan builders there).

## P16 runbook wording follow-up — November 11, 2026

Jordan approved a follow-up PR for the eight Low wording gaps (R1–R8) the separate prompt 05 reviewer found in
the synthetic bundle ([report](evidence/runbook-export/clean-room-2026-11-10.md), third run). Exporter template
changes in `packages/domain/src/runbook.ts`: REQUIREMENTS.md says exact cases govern over a check's general measure
(R1); contract rule 9 settles readings where neither choice refuses or refusing has no defined exit code (R5); rule
10 lets only the review-and-repair step correct an ASSUMPTIONS.md line (R2); prompt 05 keeps past task reviews as
written (R3) and states what Part 1 may change and the commit order (R4); STACK.md says the notes under a proposed
stack are binding on that stack (R7). Fixture spec changes in `runbook-fixture.ts` (R1 A1 measure, R6 README
mitigation, R8 A3 measure). Bundle regenerated; `node scripts/p16-runbook-example.mjs` verifies
it. New assertions in `tests/src/runbook-domain.test.ts`. No ADR or migration. Not re-consumed in a clean room.

Review fixes (PR #163 review; report in the project files at `reviews/P16_PR163_REVIEW_2026-11-11.md`): the "cases
govern" line appears only when a check has visible cases (L1); the STACK.md sentence now covers what a note requires,
not every suggestion, and the static-web server note says it is only a way to try the page (L2); prompt 05 Part 1 may
add an ASSUMPTIONS.md line as the contract allows (L3); prompt 05 no longer names `review/` (N1); the commit order
reads right with no findings (N2); the synthetic spec is now version 3 with a new placeholder hash, since its text
changed (N3). Re-review fixes (report `reviews/P16_PR163_REREVIEW_2026-11-11.md`): prompt 05 commits a Part 1
ASSUMPTIONS.md line with REVIEW.md (L-A) and commits the final REVIEW.md marks whenever there are findings, fixed or
not (L-B); "other cases exist that you cannot see" appears only when cases are held out (L-C); the "cases govern"
line also appears when every case is held out (N-A). Bundle hash now `8648d257…`.

## P22 live connection checks (November 10, 2026, no migration, no ADR)

Jordan's typed OK (November 10, 22:40 UTC) covers live API and GitHub tests. Added: a "Test
connection" for the metered OpenAI API key route on Models and connections (one bounded request
under its own run, grant and $0.05 run budget; closed, revoked and cancelled afterwards;
`apps/web/src/api-key-check.ts`, `api-key-check-panel.tsx`), `live_model_id` on
`GET /api/broker/status`, and a read-only GitHub pull-request checks read
(`GET …/github-repositories/{id}/checks?pr=<n>`, `pnpm cli github-checks`, a form per repository).
Owner steps: [docs/LIVE_CONNECTION_CHECKS.md](../docs/LIVE_CONNECTION_CHECKS.md). GitHub credential
(Jordan's choice): a fine-grained token limited to one owner-created private repository
`creator-agent-p22-trial`; a later trial with a repository-creating token is recorded as a follow-up.
Local checks: new loopback API test `tests/src/api-key-check-api.test.ts`, unit tests
`tests/src/web-api-key-check.test.ts`, GitHub fixture assertions in `tests/src/github.test.ts`.
Live results (tracking/INTEGRATIONS.md, "P22 live connection checks"): API key route connected
(`gpt-6-astra`, $0.00036, November 10 23:16 UTC); GitHub scoped trial succeeded (verify, branch, two
pushes, PR #1 in `creator-agent-p22-trial`, checks read); ChatGPT and Claude Code availability rechecks
passed at $0 (November 11). The dev studio now runs from `C:\dev\creator_agent_p22`
(`.creator\studio\start-dev-p22.ps1`); `creator_studio` was backed up and migrated 49 → 50.
Review of PR #160 (1 Medium, 6 Lows) fixed in the same PR: refused GitHub reads are reported as
refusals (M-1); the panel says "outcome unknown, reconcile" when no answer arrives, archives a run
record whose registration failed, and its clean-up is tested end to end through `runCheck` (L-3–L-5);
Models and connections shows each model's last availability recheck (L-6). Re-review Lows fixed: the
checks read's repository lookup keeps GitHub's real status, and a rate-limit 403 says "try again", not
"token expired". Owner clean-up: Jordan revoked the "P22 trial" connection on November 11 (01:43 UTC)
and reported the token deleted; the trial repository is his to keep or delete. Nits fixed at Jordan's
request (November 11): a secondary rate limit without `retry-after` is recognised by GitHub's message, a
read with no answer is worded as the studio's own error rather than "GitHub said", and `checksSummary`
(now in `apps/web/src/github-checks.ts`) has unit tests (`tests/src/web-github-checks.test.ts`).
Fourth re-review nits (GitHub App path, not used live): a GitHub App token the studio cannot create
locally (e.g. an unusable private key) says to check the App credential, not "try again", and a token
GitHub refuses (e.g. 422, repository removed from the installation) says so instead of "did not answer".
Fifth re-review: a 404 from the App token step is a refusal, not "no such pull request" (L-1); a 401 there
points at the App id or private key; a 5xx or a 201 without a token names the token step.

## P18 collapsible options and shorter pages (November 10, branch `claude/project-thread-d4dxg5`, no migration or ADR)

R20 and part of R12 from the [November 10 check](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md) (the P18
row arrives with docs PR #158). Web only; no data, route, gate, scoring or API change.

- New `apps/web/src/fold.tsx` (`Fold`, `FoldAll`, `useFolds`) and `fold-state.ts` (pure rules: `foldIsOpen`,
  `chooseAll`, `firstNeeding`, `nameList`). Each item is a native `<details>`/`<summary>`, so Enter/Space and screen
  readers' expanded state work without extra code; closed content stays in the page, so typed fields keep their
  values. Open state lives in the page component, and pages stay mounted while hidden, so it lasts while the app is
  open. Expand all / Collapse all shows for lists of two or more.
- Projects › Decide: claims, alternatives, the Decide form's options and the selection history each show one line
  (alternatives: kind, title, scores, ethics and humility gates, how many choices gates block; options: chosen
  disposition, what still needs the person, blocked choices). Only the first option that needs the person
  (flagged, new, reasons written for another choice, or incomplete) opens by default; an option being edited stays
  open. The line above Record now names the options it waits on, including the new case "give a disposition, reason
  and would reverse if for N options (…)", so no reason a Record is disabled sits only inside a closed option.
- Scores and specs: the two rankings (summary: candidates, first place, gates not clear, shortlist stability), the
  selections and the open spec's task list fold; an unfrozen spec opens its tasks. Spec blockers and task-graph
  problems stay outside the fold.
- Proposals: the 15 editor sections fold (label, required, state, cited claims, first words); the first required
  section not written opens; checks and blockers stay above the sections.
- Monitor › Approvals: decision cards fold, every pending (and linked) decision is open, answered and closed ones
  fold; "cannot be approved: the target changed" shows in the summary. Routine approval policies fold (a paused one
  opens); the policy's error stays outside the fold.
- Evidence (`tracking/evidence/p18-folds/`, throwaway PostgreSQL 16 database with the four seed workspaces, 1280×900):
  page height before → after: Decide 6,480 → 3,563 px; Scores and specs 2,588 → 1,082 px (one screen); a new
  proposal with all 15 sections open 5,880 → 2,623 px collapsed. `walk.cjs` output in `walk-output-2026-11-10.txt`:
  Enter opens and Space closes an option from the keyboard; Expand/Collapse all; an emptied reason in a closed option
  shows in its summary and in "Before you can record", Record disabled; open state and the typed (empty) field kept
  after leaving for Scores and back; a freeze raised an approval whose card opened by default; empty Decide and
  Approvals show their empty messages with no Expand/Collapse buttons. Before/after screenshots in `screens/`.
- Gate: Scores and specs fits one screen. On Decide the collapsed alternatives and the collapsed options each fit in
  about one screen, but the whole page is still about four screens (problem statement, automatic assessment, the
  scoring form and "Why this response" are unchanged). Folding those is left to P19/P17.
- Not done: Decide's assumption list, Proposals' review list and the Approvals runs and standing-policy lists stay
  as they were (each is already one line per item). The decision card's `time_spent_ms` still counts from when the
  card was shown, as before; pending cards open by default, so the measure is unchanged for them. Not independently
  reviewed.
- Checks (cloud container, PostgreSQL 16, no CI: Actions has no minutes): `pnpm typecheck` and `pnpm format:check`
  pass; `pnpm test:db` 903 tests, 869 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests); `pnpm
test:dev-safety` 22 tests, 19 pass, 3 skip. New `tests/src/web-folds.test.ts` (4 tests); `web-session.test.ts`
  stubs the new `./fold.js` import of `oversight.tsx`. The Windows CI job did not run.

### P18 review fixes (November 10, same PR #162; review `reviews/P18_PR162_REVIEW_2026-11-10.md`, no High or Medium, 7 Lows)

- L-1 Decide: the option that opens by default follows what is still unreviewed (`unreviewed`, stale reasons,
  incomplete), not "changed since your decision", so after one changed option is reviewed the next one opens.
- L-2 Decide: an option's summary names each choice gates block and its first reason ("Blocked by gates: Select for
  a bounded build (…)") instead of only a count.
- L-3 Proposals: a section a check blocks (`level: blocker` for that section, e.g. no cited claim, a cited claim
  missing or no longer active) gets the attention style, shows "Written, blocked: …" and can be the section that opens.
- L-4 Decide: "Before you can record" no longer names a new, untouched option twice.
- L-5 Approvals: the question heading is inside the summary (read once; closed cards keep a heading); "expires"
  shows once.
- L-6 Proposals: section open/closed choices are held by the Proposals page (`useFoldChoices`, a new optional
  argument of `useFolds`), so a save that remounts the editor keeps them; another proposal or a new draft starts
  afresh.
- L-7 Approvals: following a link to a decision opens its card even after Collapse all.
- Evidence: `walk.cjs` re-run (output replaced): L-5 heading once inside the summary, L-7 linked card open after
  Collapse all, L-6 the opened section still open after "Save proposal"; L-2 shows in the blocked summary line.
  L-1 and L-4 need a revised alternative after a recorded selection and were checked from the code, not walked.
- Checks after the fixes (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass;
  `pnpm test:db` 910 tests, 876 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). Not re-reviewed yet.

### P18 re-review fixes (November 11, same PR #162; re-review `reviews/P18_PR162_REREVIEW_2026-11-10.md`, 3 Lows and a nit)

- R-1 Approvals: a linked decision opens on every return to the page (`useOnShow`), not only when the id changes, so
  following the same link again after closing the card opens it.
- R-2 Proposals: opening a different proposal any way (list, Decide's link, an address) clears the section choices;
  the step from a new draft to its first saved id keeps them.
- R-3 Decide: summaries name only blocks the person can clear; blocks that follow from the option's kind ("has no
  software to build", "Custom software is selected for build or validation", "not a response to recommend", "A
  failed outcome cannot be validated") stay in the dropdown. The alternatives' "N choices blocked" counts the same way.
- R-4: the L-3 entry above now says "missing or no longer active" (a stale citation is a warning, not a blocker).
- Evidence: `walk.cjs` re-run (output replaced): R-1 same link after closing opens the card; R-2 after Expand all on
  one proposal, another opened by address shows its own default (1 of 15 open); R-3 collapsed option summaries
  52/73/91/52/52 px at 1280 wide (re-review measured about 110 px each before). A second proposal for the walk was
  created through the API on the throwaway database.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` 910
  tests, 876 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). `web-session.test.ts` stub gains `useOnShow`.

### P18 second re-review fixes (November 11, same PR #162; `reviews/P18_PR162_REREVIEW2_2026-11-11.md`, 3 Lows and a nit)

- R2-1 Proposals: starting a new draft while another proposal is open resets the remembered proposal, so the draft's
  first save keeps the sections the person opened.
- R3-1 Decide: a choice the option's kind rules out is left out of the summary and the "N choices blocked" count,
  whatever its other reasons. N-1: the rule is now one function, `kindAllows` in `packages/contracts/src/selection.ts`,
  used by the domain's kind blocks (`packages/domain/src/selection.ts`) and by the web, instead of matching the
  domain's wording; tested in `tests/src/web-folds.test.ts`.
- R3-2 Decide: the "Blocked by gates" line groups choices by reason ("Discovery disposition: duplicate. (blocks
  validate, recommend)"), so a shared reason is written once.
- Evidence: walk re-run (output replaced). Collapsed option summaries 52/73/73/52/52 px at 1280 and 110/129/111/110/91
  px at 390 (the change-process option with a duplicate discovery went from 91 to 73 px at 1280). The revised-option
  case (ethics not assessed) and R2-1 were checked from the code; the walk data has no revised option and no option
  left to start a proposal for.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` 912
  tests, 878 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). Domain selection tests pass with `kindAllows`.

### P18 third re-review fixes (November 11, same PR #162; `reviews/P18_PR162_REREVIEW3_2026-11-11.md`, 1 Low and a nit)

- R4-1 Proposals: the section choices belong to one proposal or to the unsaved draft (`'draft'`). Starting a draft
  marks them as the draft's; the draft's own first save hands them to its new id; opening any other proposal,
  including a saved one picked while a draft is open, starts afresh.
- N-2 Decide: the "Blocked by gates" line uses the dropdown's labels ("Validate before building, Recommend (no new
  software)").
- Evidence: new `walk-proposal-choices.cjs` on a fresh `seed-selection` workspace (it records a second recommended
  option, approving the one selection approval through the API as the owner would on Approvals), output in
  `walk-proposal-choices-output-2026-11-11.txt`: A's opened sections survive its first save; an unsaved B draft's
  choices do not carry to A (R4-1, A shows only its default); with A open, B's draft keeps its choices over its
  first save (R2-1); A picked after B shows its default (R-2). Main walk re-run (output replaced).
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` 912
  tests, 878 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests).

### P18 fourth re-review fixes (November 11, same PR #162; fourth re-review at `6549579`, 1 Low and a nit)

- R5-1 tracking: SESSION_HANDOFF's table no longer says P18 is "Not started", and its P18 entry now covers the review
  rounds (shared `kindAllows`, the per-proposal fold choices, Approvals opening the focused decision, how to run
  `walk-proposal-choices.cjs`, and the Decide sections left unfolded for P19/P17).
- N-3 Decide: the blocked line reads "<reason> Blocks: Validate before building, Recommend (no new software)." with no
  nested brackets.
- Merged main (P21, #161); conflicts were only in BUILD_STATUS.md and SESSION_HANDOFF.md.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` 919
  tests, 885 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests).

### P18 fifth re-review nits (November 11, same PR #162; `reviews/P18_PR162_REREVIEW5_2026-11-11.md`, review-clean, 2 nits)

- N-4 Decide: two blocking reasons on one option are joined with a space, not ".;".
- N-5 tracking: both status tables mark P21 merged (PR #161) and the P16 wording follow-up merged (PR #163).
- Merged main again (#163); conflicts were only in BUILD_STATUS.md and SESSION_HANDOFF.md.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db` 919
  tests, 885 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests).

### P18 sixth re-review nit (November 11, same PR #162; `reviews/P18_PR162_REREVIEW6.md`, review-clean, 2 optional nits)

- N-6 tracking: SESSION_HANDOFF's P18 review-rounds paragraph now covers re-reviews 5 and 6. Text only; no code
  changed since `029f684`, so its checks stand. N-7 (P19 and P22 rows) is left to those threads.

## P19 Standard and Advanced (November 11, branch `claude/project-thread-xdq8er`, ADR-0082, migration 52)

- What works:
  - Each person has one Standard/Advanced choice, stored on the server (`person_preferences`, `GET`/`POST
/api/me/view-mode`, versioned). The choice follows the person to other browsers and devices. A person who
    never chose sees Standard, unless their browser held the older Discover "Show all fields" choice. The switch is
    in the sidebar, on Settings and on Discover.
  - Standard hides Launch, Workers and Study (also Maintain and Payments, Marketing and Portfolio when present) from
    the tabs and sidebar targets, with an "in Advanced" button. Their routes still open.
  - Standard folds routine fields behind a visible summary of the defaults on these forms: evidence cite, Discover,
    scorecard, humility review, spec (per task, plus data, risks and upkeep) and Start build. Each start or save on
    them shows "What will happen" first.
  - Defaults fill only routine values: scorecard checks default to "unknown", a new spec defaults to builder role,
    acceptance A1, maintainer, obligations and review interval, and a new budget defaults to "Studio budget" with
    cap 100 in fixture mode only (real budgets prefill 0.00). Defaults never add evidence, grants, qualifications or
    the private data class, and never raise a cap.
  - A "Getting started" card on Chat and Path walks a new workspace through five steps: evidence, budget, discover,
    score, choose. It can be hidden per workspace.
  - Advanced shows every tab and field with no folds. No server gate changed.
- Checks run (cloud container, PostgreSQL 16, no CI: no Actions minutes): `pnpm typecheck` passes;
  `pnpm format:check` passes; `pnpm test:db` 911 tests, 876 pass, 29 skip, 6 fail: the 5 known no-`pwsh` wrapper tests and the
  schema-number check in `storage.test.ts`, which still expected 50. That check now expects 52, and
  `storage.test.js` was rerun with 8 of 8 passing. New tests: `tests/src/view-mode.test.ts` (API and database:
  per-person storage, 401/403/409/400, other-actor isolation, concurrent saves; tab hiding; mode resolution;
  Getting started steps), plus default checks in the scorecard and spec form tests.
  - Browser walk (`tracking/evidence/p19-standard-advanced/`): a new owner in Standard went from evidence to a
    scored option, a recorded choice and a saved proposal with no Advanced click and no CLI. Advanced parity and the
    cross-browser switch were checked in a second browser. An earlier walk on a `cli seed-selection` workspace
    reached Start build, and the request stopped at the admission gate as before.
- Not done:
  - The Decide selection form and the Proposals form are not folded, because P18 (PR #162) rewrites `compare.tsx`
    and `proposals.tsx`.
  - Hiding Getting started is per browser.
  - P20 (ADR-0057/0070 amendment) not started.
  - Pre-existing 404 `problems//explanation` from the Proposals explanation panel (P18's file).
  - Not independently reviewed.
- After merging main with P21 (#161) into the branch: `pnpm typecheck` and `pnpm format:check` pass;
  `pnpm test:db` 918 tests, 884 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). The browser walk was
  rerun on a fresh database at schema 52 and passed as before.

### P19 review fixes (November 11, same PR #164; review `reviews/P19_PR164_REVIEW.md`, 1 Medium, 2 Low, 5 nits)

- M-1: Start build's "What will happen" names the builder's plan (Claude or ChatGPT) through `builderSummary` in
  `build-defaults.ts`; it said "ChatGPT plan" for a Claude Code builder after the P21 merge.
- L-1: the scorecard's "Evidence against it" and "What they do today" stay outside the Standard fold, under "What
  argues against it"; the fold's summary counts the other four checks.
- L-2: the view-choice upsert updates only the expected version, so a simultaneous first save is refused with
  `VERSION_CONFLICT` (it used to become version 2). The new race test failed before the fix and passes after it.
- Nits: N-1 three doc comments moved back to their declarations; N-2 a tab group kept in the row by its open section
  names its hidden sections ("Campaigns, Maintain in Advanced"); N-3 `Routine` opens on an error and never closes a
  fold the person opened; N-4 the budget default note shows only while the filled-in cap is untouched. N-5 (the
  provider re-indents `main.tsx`) is left as merged, as the review allows; undoing it now would only add churn
  against P18.
- Checks after the fixes and the merge of main through #163 (cloud container, PostgreSQL 16, no CI): `pnpm typecheck`
  and `pnpm format:check` pass; `pnpm test:db` 919 tests, 885 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper
  tests). The browser walk was rerun on a fresh database at schema 52 and passed; its output and screens 01–08 in
  `tracking/evidence/p19-standard-advanced/` are from that rerun.

### P19 re-review fixes (November 11, same PR #164; re-review `reviews/P19_PR164_REREVIEW.md`, 1 Low, 2 nits)

- L-A: Discover's model-access summary and the "Model access" option name the plan the connection runs on (Claude
  or ChatGPT) through `routeText` and `plansOffered` in `discover-defaults.ts`, with a test; both said "ChatGPT
  plan" for a Claude Code connection.
- N-A: the P19 status row no longer says "awaiting independent review".
- N-B: the scorecard's "Evidence against it" and "What they do today" start empty and must be answered (typing
  "unknown" is a deliberate answer); only the four routine checks start as "unknown". Applies in both views.
- Checks after the re-review fixes (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check`
  pass; `pnpm test:db` 920 tests, 886 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). The browser walk
  (which now answers the two judgment checks) was rerun on a fresh database and passed; evidence refreshed.
- Second re-review nits (`reviews/P19_PR164_REREVIEW2.md`): N-C the scorecard's "What will happen" note and N-D the
  comment above the check fields now say only the four routine checks default to "unknown". Text only; typecheck,
  format and the scorecard form tests pass.

## P20 whole process from Chat (November 11, branch `claude/project-thread-b20hlm`, ADR-0083, migration 53)

- What works:
  - Chat holds action cards for the main path: set up a budget, fetch a page, record a claim, start a discovery,
    answer a waiting decision, score an option, record a choice and save a proposal. Each asks the form's questions
    one at a time, says what it still needs, lists answers with Change, shows "What will happen" and exactly the
    requests Send makes. Standard uses P19's routine defaults; Advanced asks them too.
  - Send runs the form's own requests from the person's browser, each naming the card's `chat.action_sent` event as
    its cause. The store records done, unconfirmed, refused or "refused; part of it was recorded" (work was saved
    before the refusal) from the audit events, not from the browser's word alone. Held steps (a selection waiting for a decision) say so and offer
    "Send again with the same answers".
  - A card whose records changed (version, archived, gone, or a decision no longer waiting) is refused as stale before
    anything is sent.
  - A model answer may suggest one card (`<propose_action>`, CHAT_INSTRUCTIONS v3) with short hints only; it is a
    draft the person fills in and sends. Answering a decision is never suggested.
- Checks run (cloud container, PostgreSQL 16, no CI: no Actions minutes): `pnpm typecheck` and `pnpm format:check`
  pass; `pnpm test:db` 929 tests, 895 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). New tests:
  `chat-actions.test.ts` (HTTP flow with causation headers, retries, version conflicts, done/unconfirmed/refused,
  dismiss, cross-workspace; store roles, sender-only reports, stale by version, archive and missing record),
  `web-chat-cards.test.ts` (Standard vs Advanced, hints only prefill, discovery and approval plans checked against
  the server request schemas), a model-suggestion case in `chat-answers.test.ts`; schema check now 53.
  - Browser walk (`tracking/evidence/p20-chat-actions/`): empty fixture workspace → fetch → claim → budget →
    discovery → score → choice (held, approved from a card, sent again) → proposal, all from Chat, plus a refused
    fetch with the form's reason and a stale card. `audit-trail.txt` shows who sent each card and what it caused.
- Not done: spec freeze, build and runbook export cards; editing an earlier selection; other rubrics; resuming a send
  on another device. A model-suggested card was tested with the fake `claude`, not a live plan.
- Review fixes (November 11, review at `/mnt/project-files/reviews/P20_PR165_REVIEW.md`): M-1, L-1 to L-5 and N-1 to
  N-6 fixed as recorded in ADR-0083's review amendment. New tests: a fetch card asks about a new run (M-1), the
  study-run refusal through a card (L-4), "Send again" keeping origin and answer (L-5, in `chat-answers.test.ts`),
  `in_trail` marks (N-3), a demoted sender recording the outcome (N-4), whole-value placeholders (N-1). Migration 53
  gained `again_of` in place (unreleased).
- Re-review fixes (November 11, `/mnt/project-files/reviews/P20_PR165_REREVIEW.md`, 1 Low and 3 nits): a refusal whose
  only caused events record the refusal ends `refused`, not `partial` (L-6; tests for both); the committed walk was
  updated and re-run on a fresh `p20walk` (N-7); "Send again" on a fetch card reuses the run it registered (N-8); the
  new-run question is reworded (N-9). Second re-review clean; its two nits fixed (N-10 a lost send with only a
  refusal recorded ends `refused`; N-11 ADR-0083's provenance paragraph states the amended rule).

## P22 live connection checks (November 10, 2026, no migration, no ADR)

Jordan's typed OK (November 10, 22:40 UTC) covers live API and GitHub tests. Added: a "Test
connection" for the metered OpenAI API key route on Models and connections (one bounded request
under its own run, grant and $0.05 run budget; closed, revoked and cancelled afterwards;
`apps/web/src/api-key-check.ts`, `api-key-check-panel.tsx`), `live_model_id` on
`GET /api/broker/status`, and a read-only GitHub pull-request checks read
(`GET …/github-repositories/{id}/checks?pr=<n>`, `pnpm cli github-checks`, a form per repository).
Owner steps: [docs/LIVE_CONNECTION_CHECKS.md](../docs/LIVE_CONNECTION_CHECKS.md). GitHub credential
(Jordan's choice): a fine-grained token limited to one owner-created private repository
`creator-agent-p22-trial`; a later trial with a repository-creating token is recorded as a follow-up.
Local checks: new loopback API test `tests/src/api-key-check-api.test.ts`, unit tests
`tests/src/web-api-key-check.test.ts`, GitHub fixture assertions in `tests/src/github.test.ts`.
Live results (tracking/INTEGRATIONS.md, "P22 live connection checks"): API key route connected
(`gpt-6-astra`, $0.00036, November 10 23:16 UTC); GitHub scoped trial succeeded (verify, branch, two
pushes, PR #1 in `creator-agent-p22-trial`, checks read); ChatGPT and Claude Code availability rechecks
passed at $0 (November 11). The dev studio now runs from `C:\dev\creator_agent_p22`
(`.creator\studio\start-dev-p22.ps1`); `creator_studio` was backed up and migrated 49 → 50.
Review of PR #160 (1 Medium, 6 Lows) fixed in the same PR: refused GitHub reads are reported as
refusals (M-1); the panel says "outcome unknown, reconcile" when no answer arrives, archives a run
record whose registration failed, and its clean-up is tested end to end through `runCheck` (L-3–L-5);
Models and connections shows each model's last availability recheck (L-6). Re-review Lows fixed: the
checks read's repository lookup keeps GitHub's real status, and a rate-limit 403 says "try again", not
"token expired". Owner clean-up: Jordan revoked the "P22 trial" connection on November 11 (01:43 UTC)
and reported the token deleted; the trial repository is his to keep or delete. Nits fixed at Jordan's
request (November 11): a secondary rate limit without `retry-after` is recognised by GitHub's message, a
read with no answer is worded as the studio's own error rather than "GitHub said", and `checksSummary`
(now in `apps/web/src/github-checks.ts`) has unit tests (`tests/src/web-github-checks.test.ts`).
Fourth re-review nits (GitHub App path, not used live): a GitHub App token the studio cannot create
locally (e.g. an unusable private key) says to check the App credential, not "try again", and a token
GitHub refuses (e.g. 422, repository removed from the installation) says so instead of "did not answer".
Fifth re-review: a 404 from the App token step is a refusal, not "no such pull request" (L-1); a 401 there
points at the App id or private key; a 5xx or a 201 without a token names the token step.

- After merging main with P18 (#162): `style.css` and the tracking logs conflicted and were joined; typecheck and
  format pass; `pnpm test:db` 940 tests, 906 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). The walk now
  opens P18's one-line folds on Decide before using the option controls, as a person clicking each summary would,
  and passed on a fresh database. The Decide and Proposals forms now carry P18's folds; folding their routine fields
  under Standard is the remaining follow-up.

## P19 follow-up: Decide and Proposals in Standard (November 11, branch `claude/project-thread-qc6o5z`, no migration or ADR)

Closes P19's "not folded" item now that P18 (#162) and P19 (#164) are both on main. Web only, under ADR-0082; no
route, gate, request or data change. The rules are in `apps/web/src/decide-routine.ts`.

- What works:
  - Decide (Standard): "Record under run" folds under one line naming the run and whether it is the run that found
    the problem. The override reason folds with it only when it is empty and the choices do not need one; it stays in
    view when needed, when an earlier reason needs a look, or when one is typed (the "not recorded" note then shows
    beside it). The fold opens by itself when there is no active run. A new "What will happen" before Record lists
    the dispositions it records, the report it binds, the run, whether an override reason is recorded and the data
    class. Advanced shows the same fields open, in the order they had before.
  - Proposals (Standard): the seven required sections, "Contrary evidence" and "Decision-changing assumptions" stay
    in view (each keeps its P18 fold). The other six optional sections (background, materials, roles, timeline,
    costs, limitations) fold together under "6 more sections (optional): N written, M unknown yet"; the group opens
    when one of them is opened (Expand all included) or a check blocks one. A revision's "What changed" folds under
    its value ("Edited" by default). The review form's four marks fold under "Marks: all 4 not checked (default)" or
    their counts; verdict and comments stay in view. A new "What will happen" before Save lists the version saved,
    required and optional sections written, the "What changed" note and when checks run. Advanced keeps P18's order
    and every field open.
- Checks run (cloud container, PostgreSQL 16, no CI: no Actions minutes): `pnpm typecheck` and `pnpm format:check`
  pass; `pnpm test:db` 954 tests, 920 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests). New `tests/src/web-decide-routine.test.ts` (4 tests): an override reason folds
  only when empty and not needed; the run summary; folded proposal sections are never required sections, contrary
  evidence or assumptions; the reason and marks summaries.
  - Browser walk (`tracking/evidence/p19-decide-proposals/`, throwaway database `decidewalk` at schema 53, reviewer
    ports, `cli seed-selection`): Decide and Proposals in Standard and Advanced, a new proposal drafted and saved,
    Expand all opening the folded group. Output in `walk-output-2026-11-11.txt`, screens in `screens/`. The walk
    found the run fold opening for a moment before the first run was picked (and then staying open); it now opens
    only once the runs are loaded and none is active, and the rerun shows it closed.
- Not done: the folded override case was checked by the unit test, not in the browser (the seeded selection needs
  an override reason). The `problems//explanation` 404 on Proposals is still there (pre-existing). Not independently
  reviewed.

### P19 follow-up review fixes (November 11, same PR #166; review `reviews/PR166_DECIDE_PROPOSALS_FOLDS_REVIEW.md`, 1 Medium, 1 Low, 4 nits)

- M-1 Decide: the override reason has one place in the page, in its own fold ("Override reason: not needed for these
  choices", "needed before you can record", "review it", or the typed text with "(not needed, not recorded)"). The
  fold opens when the reason matters and never closes or moves the field, so typing into it or clearing it keeps
  focus and every keystroke. The run fold no longer holds the reason.
- L-1 Proposals: the four review marks are no longer folded; they are the reviewer's judgment.
- N-1: the optional-sections summary adds "· N blocked" when a check blocks a folded section. N-2: closing the group
  by hand closes its sections, so Expand all opens it again (`Routine` gained `onClose`). N-3: with no active run the
  run summary says "start or resume one first". N-4: "What changed" sits above "What will happen", right before Save.
- Evidence: new `walk-override.cjs` (output `walk-override-output-2026-11-11.txt`) records a selection deferring every
  option with no override reason on a fresh `seed-selection` workspace (approving once through the API), then in
  Standard: the reason loads folded; `keyboard.type("because")` keeps focus on `dec-override` with value "because";
  select-all, Backspace and "new reason" keep focus and the value; clearing keeps focus. Review marks: 4 visible,
  none in a fold. Expand all, close the group by hand, Expand all enabled and reopens it. Order before Save: "What
  changed", "What will happen", Save. `walk.cjs` re-run (output replaced).
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db`
  954 tests, 919 pass, 29 skip, 6 fail: the 5 known no-`pwsh` wrapper tests and one `tester-accounts` test that lost
  its database connection (`ECONNRESET`) while the browser walk ran against the same server; rerun alone it passed
  2 of 2, twice. No code it covers changed.

### P19 follow-up re-review fixes (November 11, same PR #166; `reviews/PR166_DECIDE_PROPOSALS_FOLDS_REREVIEW.md`, 1 Low, 1 nit)

- L-A Proposals: a section's own fold toggling no longer reaches the group's close handler (`Routine` ignores toggles
  from nested `<details>`), and Expand all reopens the group even while a blocked section keeps it marked open
  (`FoldAll` gained `onExpand`, `Routine` gained `reopen`).
- N-A: `walk.cjs` finds the "What changed" fold in its new place (output replaced).
- Evidence: `walk-override.cjs` gained a blocked folded section (Background cites a claim that is then archived):
  summary "· 1 blocked"; closed by hand, then Expand all opens the group with all 6 sections; closed and Expand all
  again, the same. Output replaced.
- Checks (cloud container, PostgreSQL 16, no CI): `pnpm typecheck` and `pnpm format:check` pass; `pnpm test:db`
  954 tests, 920 pass, 29 skip, 5 fail (the known no-`pwsh` wrapper tests).
