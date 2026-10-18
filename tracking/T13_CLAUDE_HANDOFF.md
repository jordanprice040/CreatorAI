# Claude Code handoff — T13

Implement **T13 — Verified artifacts, private preview, and feedback revision**.
The owner explicitly requested this handoff for Claude Code to start T13. Do not
advance to T14 or activate a live provider/public release.

## Start from the right candidate

Repository: `C:\Users\jorda\OneDrive\Desktop\creator_agent`, origin
`https://github.com/jordanprice040/CreatorAI.git`. T12 is on
`codex/t12-bounded-builder`; use that branch as the prerequisite if its PR is still
open, or current main after it merges. Inspect Git status and preserve local work.
T11 was verified merged as PR #13 when this handoff was written. T12 PR review is
still pending; do not claim owner approval or merge it as part of this handoff.

Read AGENTS.md, PROJECT_CONTEXT.md, the shared contract and complete T13 entry in
PROMPT_LIBRARY.md, tracking/BUILD_STATUS.md and tracking/SESSION_HANDOFF.md.
Then read context/ARCHITECTURE.md, context/HUMAN_OVERSIGHT.md, relevant requirements,
docs/ISOLATED_EXECUTION.md, docs/BOUNDED_BUILDER.md, docs/DOCKER.md, ADR-0014–0016
and actual code. Read docs/DEVELOPMENT_TOOLS.md before using its integrations.
Do not load unrelated role/reference documents or touch the CIS4914 repository.

## What T12 provides

- Authenticated owner CLI `build-task`, `build-status` and build IDs in
  `product-status`. Current frozen T08 task/spec hashes bind normal admission,
  exact-spec humility, broker reservations, scoped CAS patches and local commits.
- Fresh reviewer context excludes builder claims. Real WSL2/Bubblewrap/systemd
  runs typed Python argv/stdin cases with supervisor-owned read-only acceptance
  input. Exact stdout/exit checks plus review determine one task candidate's state.
- Finite calls/time/output/budget, two repairs maximum, cancellation and continuing
  grant/expiry/review checks. Failed commits, immutable intents, role traces,
  reservations, command/execution identity and results are retained.
- Fixed synthetic builder/reviewer logic only; no live provider or real spend.
  One independent offline Python task; browser/persistence/dependency recipes
  stop explicitly. Local build records are separate from database catalog/search.
  Task verification does not certify an integration merge or whole product.

Key code: packages/executor/src/{build,products,execution,contracts}.ts,
packages/executor/worker/{bridge,recipe}.py, packages/domain/src/build-fixture.ts,
packages/broker/src/adapters.ts, apps/cli/src/index.ts. The gallery is reserved in
apps/web/src/gallery.tsx; inspect the existing API/auth/catalog/storage patterns.

## Execute T13

1. Produce immutable build manifests binding exact repo/commit/spec/template,
   toolchain/lockfile, artifact hashes, startup requirements, actual tests and
   limitations. Package supported source/runtime output, then re-extract and start
   the exact exported package in a clean constrained environment.
2. Add real private preview/gallery actions with a separate product origin,
   owner authorization, resource leases, readiness, expiry and stop. Recheck access
   at download and start time. Distinguish source archive, runnable demo and native
   installer; show unavailable states honestly.
3. Bind feedback to exact versions, turn accepted feedback into versioned spec
   and task revisions, preserve old artifacts and connect new commits/tests/costs.
   Complete one actual feedback-driven revision and comparison.
4. Execute the owner inspect/preview/download/start/feedback/reverify flow and
   hash mismatch, expired preview, revoked access and stale-version refusals.
   Use browser checks for actual web behavior. Do not replace a failed live or
   isolation service with an invisible fixture or run generated code on the host.

T12 only supports Python CLI output, so assess and implement the necessary
reviewed recipe/preview prerequisites rather than pretending stdout assertions
verify a web app. Keep management credentials, personal files, daemon sockets and
management-origin trust out of generated products. Public publication remains a
separate authorized action. Missing external credentials block live activation,
not local implementation and checks.

## Verification and machine state

tracking/evidence/t12/verification.json and review.md describe the exact evidence.
Full PostgreSQL + real WSL suite: 149/149, zero skipped. Final grant-freshness CLI
checks were added afterward and their affected compiled path rerun successfully.
Final standard check: 69 pass, 80 explicit DB/WSL skips; typecheck/format and smoke
passed. Prior 147/149 and 148/149 failure logs are retained. File-level tests are
now serial; internal concurrency assertions remain. Do not claim parallel stress
testing passed or fixtures demonstrate independent model quality.

Optional Docker PostgreSQL dev/test services use 127.0.0.1:55433/55434. The existing
ignored .env.docker contains the password; preserve it and never echo or commit it.
Dev was left running; test was stopped with volumes retained. Verify process and
port state before reuse. Set opt-in URLs per docs/DOCKER.md. The WSL Ubuntu VM is
shared: do not shut it down. Products stay in ignored .creator/products; preserve
partial work and inspect unresolved worker/Git/build intents before recovery.

Run meaningful final checks, update BUILD_STATUS/SESSION_HANDOFF and applicable
DECISIONS/INTEGRATIONS, bind evidence to the actual candidate, and report remaining
limitations. The next eligible milestone after T13 is T14, requiring a new request.
