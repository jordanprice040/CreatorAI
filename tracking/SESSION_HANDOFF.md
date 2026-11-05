# Session handoff — November 4, 2026

Current source: main `171430b` plus authorized audit and authentication review repairs (uncommitted). Schema 41;
no installed-app change, live provider call or new milestone activation. Preserve the existing
`.codex/config.toml` user change and the audit report/evidence from the previous turn.

## Current work

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

## Open items retained from earlier reviews

- **#77 L-1:** no test asserts the artifact comparison's `base_calls`/`candidate_calls` (reverting `calls()` in `artifact-store.ts` stays green). Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#90 N-4:** Decisions page Revoke/Stop error handling remains open.
- **#128 N-6:** the Codex relay notices a disconnect only at its next write, not while waiting in `reader.read()`. Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#129 N-4:** component-level role coverage remains absent; owner-only browser evidence and pure role rules do not establish a second-member UI check.

Source: [historical handoff](SESSION_HANDOFF_HISTORY_2026-11-04.md), “Older open review Lows”.
#75 L-1 was repaired by the current-prompt qualification labels; the four items above were not closed by this follow-up.

## Next eligible prompt

Next: **U02 focused independent recheck of the F1/F2 repairs** (`#settlePlanRequest` and the
three new tests), then owner-authorized acceptance work, including a migration-41 rehearsal on a
copy of a real schema-40 database.
Do not automatically install, publish, run a live provider, start new additions or advance the
pilot/thesis. Accepted owner decisions and the existing scoped grants remain authoritative.

## Previous sessions

All prior content is preserved byte-for-byte in [the historical record](SESSION_HANDOFF_HISTORY_2026-11-04.md); hashes
are in [the archive receipt](evidence/codebase-repairs-2026-11-04/document-archives.json).
The [previous section index](SESSION_HANDOFF_HISTORY_INDEX_2026-11-04.md) retains section names and archived targets without loading the historical narrative at startup.

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
