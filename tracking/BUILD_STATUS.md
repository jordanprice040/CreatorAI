# Build status — November 10, 2026

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

- **Web recipe record (PR #150 review M-1):** the frozen per-attempt bar includes the owner seeing the
  preview; only attempt 1's was opened. Waiting on Jordan (open attempts 2 and 3, or decide explicitly).
- **Installed app** is eight schema versions behind main; migrations 43–49 are not rehearsed on a copy of
  the installed database, and the web preview frame is not observed in the desktop window.
- **Windows verification:** no full Windows run of main since CI stopped.
- **Owner pilot:** `config/owner-pilot.json` still says `running`; its window ended November 6. Jordan
  decides finished or extended.
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
  a failed Revoke or Stop keeps its message (#90 N-4); the comparison's call counts are tested (#77 L-1, `manifestCalls`);
  no bare `: ` label for a control-character source title (PR #148 N-I).
- Left open: `config/owner-pilot.json` status, the installed-app upgrade and the web record decision (Jordan); #128 N-6,
  #129 N-4, PR #150 N-1..N-3; the qualification record living in source (L1). `t17-test.log` stays (the X10 manifest lists it).
- Checks (cloud container, PostgreSQL 16): TypeScript, web typecheck and formatting pass; full suite 867 tests, 833 pass,
  29 skips, 5 fail (the known no-`pwsh` wrapper tests); standalone safety 22 tests, 19 pass, 3 skips, 0 fail. GitHub CI
  cannot run (no Actions minutes). The #90 N-4 change was not walked in a browser. Not independently reviewed yet.
- Next eligible: P10 and P16 (in progress in their own threads).

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
