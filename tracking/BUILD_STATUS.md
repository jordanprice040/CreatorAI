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

## P07 preview lifetime (November 5, branch `claude/project-thread-7c9lp1`)

Previews can be **Timed** (default, 1–60 min) or **Until stopped** (ADR-0069, migration 42,
schema 42): no expiry; live while a preview page heartbeats within 3 minutes; abandoned
previews end and free their slot; links expire after 10 minutes and can be renewed by the
owner; Stop/Revoke cancels in-flight runs and records cleanup. Limits unchanged. Verified
locally on disposable PostgreSQL 16 in the cloud container (see the PR for counts); the preview
page script was walked in headless Chromium against a stand-in store. Not verified: a full
studio browser walk, the installed app, real WSL runs. Awaiting independent review.
