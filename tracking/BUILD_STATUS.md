# Build status — November 4, 2026

Current source: main `171430b` plus authorized audit and authentication review repairs (uncommitted). Schema 41;
no installed-app change, live provider call or new milestone activation. Preserve the existing
`.codex/config.toml` user change and the audit report/evidence from the previous turn.

## Current work

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

## Next eligible prompt

Next: **U02 focused independent recheck of the F1/F2 repairs** (`#settlePlanRequest` and the
three new tests), then owner-authorized acceptance work, including a migration-41 rehearsal on a
copy of a real schema-40 database.
Do not automatically install, publish, run a live provider, start new additions or advance the
pilot/thesis. Accepted owner decisions and the existing scoped grants remain authoritative.

## Previous sessions

All prior content is preserved byte-for-byte in [the historical record](BUILD_STATUS_HISTORY_2026-11-04.md); hashes
are in [the archive receipt](evidence/codebase-repairs-2026-11-04/document-archives.json).
The [previous section index](BUILD_STATUS_HISTORY_INDEX_2026-11-04.md) retains section names and archived targets without loading the historical narrative at startup.

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

## P01 + P02 (November 5, branch `claude/project-thread-pb1ge7`)

Activity destinations, Search reset and server-side sort/paging for Search and the Library;
details and checks are in [the handoff](SESSION_HANDOFF.md) and the PR. No migration, ADR,
installed-app change or live call. Not yet independently reviewed.
