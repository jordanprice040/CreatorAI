# Session handoff — November 10, 2026

Current source: main `e08e0a4` (PR #150, November 6). Schema **49** (migration 42 is intentionally
unused, see ADR-0070). No open pull requests on November 10. The installed app is still `f6e2ba0`,
schema **41** (upgraded November 4); the dev studio on Jordan's PC runs from the worktree
`C:\dev\creator_agent_p15` at `b73bd95`. This top section was rewritten on November 10 by the state
review ([report](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA)); the November 4 text it replaced
is kept verbatim below under "November 4 top section (superseded)". Dated sections further down are
the record of each package and are appended to, not rewritten.

## Current state (November 10, 2026)

[November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md) packages:

| Package | State on main |
| --- | --- |
| P00 candidate and repair closure | Done (PR #135; F1/F2 recheck passed) |
| P01 activity links, P02 sorting and paging | Merged (PR #138) |
| P03 chat context | Merged (PR #136, fixes #139; ADR-0070, migration 43) |
| P04 guided Discover | Merged (PR #140; ADR-0071) |
| P05 workspace files | Merged (PR #141; ADR-0072, migration 45) |
| P06 named notes | Merged (PR #142; ADR-0073, migration 46) |
| P07 previews until stopped | Merged (PR #137; ADR-0069, migration 44) |
| P08 automatic assessments | Merged (PR #144; ADR-0074, migration 47) |
| P09 why this response, proposals | Merged (PR #148; ADR-0077, migration 49) |
| P10 scoped routine approvals | Not on main; started November 10 in its own thread |
| P11 committee staging | Design and tester accounts merged (PRs #135, #143; ADR-0075, migration 48); deploy waits on D1–D9 |
| P12 online discovery | Not started; needs Jordan's search provider choice |
| P13 unattended workflow | Not started; needs P10 and P12 |
| P14 capability inventory and benchmarks | Merged (PRs #135, #145, #146; ADR-0076) |
| P15 larger software | Slice 1 `static-web/1` merged and recorded qualified on one route (PRs #149, #150; ADR-0078); later slices not started |
| P16 external runbook export | Not on main; started November 10 in its own thread |
| P17 integrated acceptance | Not started |

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
- **Older review items still open:** #128 N-6, #129 N-4, PR #150 N-1..N-3. Health reports configuration,
  not live state; the preview cookie-host limit remains. (#75 L-1 was repaired earlier; #77 L-1, #90 N-4
  and PR #148 N-I are fixed by the November 10 cleanup.)
- **The web qualification record** lives in source against the dev studio's connection id, so it does not
  apply to the installed app's connection.

## Next eligible prompt

P10 and P16 are in progress in their own threads (suggested numbers: P10 migration 50 and ADR-0079; P16
migration 51 and ADR-0080 if needed; recheck main). After them: the installed-app upgrade when Jordan
approves it (rehearse 41 to current on a copy first), P12 once the search provider is chosen, then P13,
later P15 slices, the final design pass and P17. Do not automatically install, publish, run a live
provider or advance the pilot or thesis. Accepted owner decisions and existing scoped grants remain
authoritative.

## Previous sessions

All prior content is preserved byte-for-byte in [the historical record](SESSION_HANDOFF_HISTORY_2026-11-04.md); hashes
are in [the archive receipt](evidence/codebase-repairs-2026-11-04/document-archives.json).
The [previous section index](SESSION_HANDOFF_HISTORY_INDEX_2026-11-04.md) retains section names and archived targets without loading the historical narrative at startup.

## November 4 top section (superseded)

Current source: main `171430b` plus authorized audit and authentication review repairs (uncommitted). Schema 41;
no installed-app change, live provider call or new milestone activation. Preserve the existing
`.codex/config.toml` user change and the audit report/evidence from the previous turn.

### Current work (November 4)

The first [repair report](../docs/CODEBASE_REPAIRS_2026-11-04.md) and Claude's
[independent review](../docs/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md) retain their original scope.
Follow-up M1/L1 repairs bind outcomes to the admitted login and actual credential, permit
unrelated changes during browser sign-in, and preserve Disconnect/newer logins. L2 is an
additive browser evidence correction; L3 restores the open items below. See
[the follow-up report](../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md) for current checks and hashes.

Claude's [follow-up review](../docs/CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md)
passed M1/L1/L2/L3 with two Lows. Jordan authorized their repair: the
[F1/F2 repairs](../docs/CODEBASE_AUTH_F1F2_REPAIRS_2026-11-04.md) (ADR-0068) bind quota,
eligibility and model-access observations to the login generation and add Codex relay and
Claude Code regressions. The reviewing thread made these repairs, so they are not independently
reviewed yet.

Current verification (after F1/F2): full PostgreSQL suite **742 pass, 27 explicit skips, zero
failures** (769 tests); current safety **22/22**; TypeScript, web typecheck, formatting and
whitespace checks pass.

Prior schema-40 suite/bundle receipts remain historical. Schema 41 is tested
on disposable databases only; no installed bundle or operational database migration.
C54 and full product acceptance remain partial; fixture/contract/native/live/activation
evidence stays separate.

### Open items retained from earlier reviews (November 4)

- **#77 L-1:** no test asserts the artifact comparison's `base_calls`/`candidate_calls` (reverting `calls()` in `artifact-store.ts` stays green). Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#90 N-4:** Decisions page Revoke/Stop error handling remains open.
- **#128 N-6:** the Codex relay notices a disconnect only at its next write, not while waiting in `reader.read()`. Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#129 N-4:** component-level role coverage remains absent; owner-only browser evidence and pure role rules do not establish a second-member UI check.

Source: [historical handoff](SESSION_HANDOFF_HISTORY_2026-11-04.md), “Older open review Lows”.
#75 L-1 was repaired by the current-prompt qualification labels; the four items above were not closed by this follow-up.

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

## P01 + P02 — activity links, Search reset, newest-first sorting (November 5)

Branch `claude/project-thread-pb1ge7`; no migration or ADR. Activity (tab and sidebar) and
Search open a subject through one server check (`GET …/destination`): a task opens its
workflow, an artifact its newest code version on Try, a selection its problem's scores;
missing/other-workspace subjects read the same and show a reason without a title. Reset
fields on Search/Activity/Library also clears the address words, kind filter and remembered
sort. Search and the Library have Sort by (Newest by creation by default; Search also Oldest
and Best match; Library also Recently updated and Name), applied on the server before the
limit with id tie-breaks and cursors bound to sort and filters. Pickers still use the
unchanged newest-first `entities` list (cap 500). Next eligible prompt: separate review of
this PR, then P03.

Checks (cloud container, PostgreSQL 16, Node 22.23.4): full `pnpm test:db` 772 tests,
737 pass, 28 skip, 7 fail: the 5 known PowerShell-wrapper tests (no pwsh here) plus 2
studio-service tests that collided with a dev server on 5173/4310; those 2 pass when rerun
alone with the new test file, catalog and search suites (18 pass, 2 pg_dump skips). New
`tests/src/list-sort-destinations.test.ts` covers cap+1, tied microsecond times, inserts
between pages, cursor/sort/filter binding, membership and the HTTP routes. TypeScript, web
typecheck, Prettier and whitespace pass. A Playwright walk on a throwaway studio checked
Search sort/More/Reset (address cleared, sort back to Newest after reload), Activity opening a
record, a deleted chat's explanation, and Library name sort with More records.

Review fixes (independent review of PR #138): M1, where the Name sort cursor could not carry long titles, now
continues after the last row read again by id, and a long-title page-edge test was added; L1 stale
"More" errors are tied to the result they belong to; L2 merged main; nits N2/N3 fixed (fallback
wording, malformed ids show the "can't be opened" sentence). N1: Search's date filter for records
now uses creation time, matching the time shown. Full `pnpm test:db`: 776 tests, 743 pass,
28 skip, 5 fail (the known PowerShell-wrapper tests only).

Re-review fixes: Name cursors carry a short hash of the last row's lowercased title, so a
rename between pages is refused with "start again"; hand-edited time cursors are refused as
INVALID_CONTRACT before PostgreSQL parses them. Full `pnpm test:db`: 777 tests, 744 pass,
28 skip, 5 fail (known PowerShell-wrapper tests only).

Third-review fixes: Name sort seeks from the title value it just checked (no second read), and
cursor times that are well-formed but impossible (PostgreSQL 22007/22008/22009) are refused as
INVALID_CONTRACT. Full `pnpm test:db`: 777 tests, 744 pass, 28 skip, 5 fail (known PowerShell only).

Fourth-review nit: cursor-time error mapping now applies only when a cursor was used, so a bad
Search date filter is no longer reported as a bad page cursor. Merged main (API route list keeps
main's `link` action). Full `pnpm test:db`: 777 tests, 744 pass, 28 skip, 5 fail (known
PowerShell only).

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

What works: Compare's "Assess automatically" runs an `r08_assessment` workflow and writes
system scorecards beside people's, with provenance, edit-with-reason (`edit_of`), gate limits
and stale marking (see ADR-0074). New routes: `problems/{id}/assessment-preview`,
`runs/{id}/assessments`, `workflows/{id}/assessment-packet`. Benchmark generator:
`node scripts/assessment-benchmark.mjs` after `pnpm build:code`; regenerate it whenever the
assessor prompt changes (the old manifest then stops admitting assessments).

Open: Jordan reviews `config/connections/benchmarks/assessment-synthetic-v1.json` before it
counts as frozen; plan-route assessments stay blocked until a scoring qualification on it
passes. Next free numbers after P11: migration 49, ADR-0076.

## P08 review fixes (November 6, PR #144 review, no new migration)

All PR #144 review findings fixed except N-3 (see ADR-0074 amendments and BUILD_STATUS). The
assessor prompt and the benchmark are unchanged, so a scoring qualification on
assessment-synthetic-v1 still counts. Live trial: a copy of the dev studio database,
`creator_p08_trial` on Jordan's Docker server, runs this branch from the worktree
C:\dev\creator_agent_p08 on the review ports; creator_studio itself is untouched (backup
C:\CreatorAgentBackups\creator_studio-20261105-200145-pre-p08-trial.dump). Jordan approved the
benchmark cases and adding scoring to the Claude Code connection on the trial copy only.

## P08 split assessment requests and L-6 (November 6, PR #144)

Live trial so far (trial copy only, Claude plan, $0): scoring qualification b9ad4984 passed
(dev 2/2, held-out 6/6, 8 requests); the first assessment e5aa5780 failed with
`output_cap_exceeded` (1 request), which led to splitting assessments into batches of four
option-and-rubric pairs. Next: re-run the live assessment of "CSV files need a quick quality check
before analysis" on the trial copy after pulling this commit, then re-review.

Live re-run at 7eaf45d on the trial copy: workflow ab5a4999 succeeded in 2 requests (answers
12,166 and 11,825 characters), 8 system cards, 30 of 48 ratings unknown, every option incomplete
so nothing ranked; connection at 11 of 30 daily, $0. Then re-review Low L-7 and nit N-5 fixed.
Follow-up idea, not done: option rationales cite claim labels (C5 to C8) from the drafting step
that differ from the assessment packet's numbering.

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

What works: see ADR-0077 and the BUILD_STATUS entry. New routes: `problems/{id}/explanation`, `proposals`
(list, create), `proposals/draft?alternative=`, `proposals/{id}` (`?version=`), `proposals/{id}/revisions`,
`proposals/{id}/reviews`, `proposals/{id}/export?version=` (Markdown attachment), `proposals/{id}/files`. New tab
Projects › Proposals (`#/projects/proposals`). Stores: `ProposalStore` sits between `CatalogStore` and
`StudyStore`; `SelectionStore.gather` is now protected and `toSelection` exported.

Review fixes (L-1–L-7, N-1, N-2 from the independent review at d99a7ff) are in ADR-0077's "Review fixes" bullet;
migration 49 was amended (append-only trigger, workspace FK) since it is unmerged. `ResearchStore.claimEvidenceIn`
reads one claim's evidence inside a caller's transaction. After the re-review, section text is exported inside fenced text blocks and record text is escaped (`inlineText`). Migration 49 changed in place before merge: a throwaway review or test database that ran an earlier text of it fails the checksum check; recreate it (no lasting database ran 49).

F9: Jordan confirmed "Judge the hybrid row" on November 6, as implemented. No live run or device step was needed or done. Main becomes schema 49; next free numbers
are migration 50 and ADR-0078 (P15 was asked to take those if it needs them).

## State review cleanup (November 10, branch `claude/project-thread-7r0ehf`, PR #151, no migration or ADR)

- From the [November 10 state review](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA) (no High; four Medium, eight Low).
  Rewrote the top of this file, `BUILD_STATUS.md`/`SESSION_HANDOFF.md`, `docs/CURRENT_STATUS.md`, the runbook note,
  `README.md` and `docs/LOCAL_DEVELOPMENT.md` to main `e08e0a4`, schema 49 (M4). The November 4 tops are kept.
- Web recipe record (M1): the two stale "`RECIPE_QUALIFICATIONS` is empty" lines are corrected (a dated note is appended to
  the results file; nothing removed). PR #150 review M-1 is restated as open for Jordan; the record is unchanged.
- Fixes: `CREATOR_SESSION_FILE` is no longer read as a secret file by the API and migrations (L2, with a test);
  `pnpm cli help` prints plain usage and exits 0 (L7); the Windows-only foreign-listener safety test skips elsewhere (L8);
  a failed Revoke or Stop keeps its message (#90 N-4); the comparison's call counts are tested (#77 L-1, `manifestCalls`);
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

What works: see ADR-0080, [docs/RUNBOOK_EXPORT.md](../docs/RUNBOOK_EXPORT.md) and the BUILD_STATUS entry. New routes:
`specs/{id}/runbook` and `proposals/{id}/runbook` (`GET` manifest, `?format=zip` archive, `?version=`; `POST` saves to
Files). New files: `packages/contracts/src/runbook.ts`, `packages/domain/src/runbook.ts` (builder, redaction,
`validateRunbook`, `writeZip`/`readZip`), `packages/domain/src/runbook-fixture.ts` (synthetic project),
`packages/db/src/runbook-store.ts`, `apps/web/src/runbook.tsx`, `scripts/p16-runbook-example.mjs`. `RunbookStore`
sits between `ProposalStore` and `StudyStore`; `ProposalStore.problemClaims` is now protected and `toFreeze` and
`contentOf` are exported from the selection store. The test harness builds a `RunbookStore`.

Changing any bundle wording changes the committed example: run `node scripts/p16-runbook-example.mjs write` after
`pnpm build:code`, or the pin test fails.

Open: the independent-consumption gate (give a fresh session only
`tracking/evidence/runbook-export/synthetic-bundle/`, have it follow the prompts in a clean workspace, then the owner
side runs the two held-out cases from `RUNBOOK_FIXTURE_SPEC`). No live run or device step was needed or done. Schema
stays 49; this change used ADR-0080 and no migration number. Next eligible prompts: P10 (in progress in its own
thread), then P12 (needs the search provider choice), P13, P17.

## P16 follow-up: clean-room findings fixed (November 10, PR #152)

The independent-consumption gate ran in a separate session and passed both held-out cases; its record is
`tracking/evidence/runbook-export/clean-room-2026-11-10.md`. Its seven findings (2 Medium, 5 Low) are fixed in
`packages/domain/src/runbook.ts` (contract rules 6, 9 and 10, setup prompt, task gates for judged checks, reviewer
task wording, review and hand-over prompts, runner `-B`) and the example bundle was regenerated. The new wording has
not been consumed in a second clean-room run. Next eligible prompts are unchanged.

## P16 follow-up: code review fixes (November 10, PR #152)

All 10 findings of the independent review (2 Medium, 8 Low) are fixed; see the BUILD_STATUS entry of the same name.
`ActionRunbookInput.proposal` now takes `checks`, `problem_title` and `option_title` instead of pre-rendered
Markdown; `RunbookHumility` carries the ethics status, dissent and the result of `humilityGate`. Next eligible
prompts unchanged.

## P16 follow-up: re-review and final review fixes (November 10, PR #152)

The independent-consumption gate is no longer open: it ran twice (the second run not blind) and passed both
held-out cases each time; the N1 to N3 wording fixes from the second run are in `ff29f25`. The re-review's R-1, R-2
and two nits are in `24a1555`. The final review's P-1 (the account-name rule continues only into more path, any case
of letters), P-2 (Windows profile paths in any letter case) and nits N-1 (`needs_judgment` carried from
`humilityGate`), N-2 (this entry) and N-3 (README wording when held-out and manual checks are mixed) are in the next
commit. The last wording has not been consumed in a clean-room run. Next eligible prompts unchanged.

## P10 routine approvals (November 10, branch `claude/project-thread-q4lf7q`, PR #153, ADR-0079, migration 50)

What works and what was checked: see ADR-0079 and the BUILD_STATUS entry. New in code: `routine_policy` on
`POST runs`; routes `routine-policies` (list), `routine-policies/{id}/revisions`, `routine-policies/{id}/revoke`;
contracts in `packages/contracts/src/oversight.ts` (`RoutinePolicy*`, `routinePolicySummary`); the policy path in
`evaluateAction` (`routine` input); store methods in `OversightStore` (`reviseRoutinePolicy`, `revokeRoutinePolicy`,
`listRoutinePolicies`); web `apps/web/src/routine-policy.tsx`, used by the Discover form and Monitor › Approvals.

Owner decision (Jordan, November 10): routine approvals can be changed mid run. `POST runs/{id}/routine-policy`
(`setRoutinePolicy`) turns them on for a run that is already going or whose policy was revoked; migration 50 was
changed in place before merge (one active policy per run instead of one policy per run), so a throwaway database
that ran the earlier text fails the checksum check and must be recreated (no lasting database ran 50). Choices the
owner has not yet confirmed: the stop conditions are a rejection in the run and an unknown paid outcome; the end
time is at most 90 days, as for grants.

For P12: add an action type for claim admission and a routine stage for it before any unattended claim admission.
Do not run prettier on `tracking/` or `context/`; the repository's format script does not cover them.

Main becomes schema 50 when this merges. Next free numbers: migration 51 and ADR-0081 (P16, PR #152, took
ADR-0080). Next eligible prompts: P12 (needs the search provider choice) and P13.

P10 review fixes (November 10, same PR): see the BUILD_STATUS entry "P10 review fixes". New code: `packages/db/src/
routine-stops.ts` (`routineStopReason`), `routineMissNote` in `packages/domain/src/oversight.ts`, version change
`reconfirmed`, `runDataClasses` on `RoutinePolicies`. Migration 50 was edited in place a second time (the `change`
check gained `reconfirmed`); recreate any throwaway database that ran an earlier text. Not built: domain and output
scope in a policy; claim admission (P12).
