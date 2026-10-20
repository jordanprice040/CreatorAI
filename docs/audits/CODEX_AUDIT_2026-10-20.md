# Creator Agent independent code audit — October 20, 2026

The inspected safeguards are substantial, but the held-out QA boundary needs repair before its results can support a study. Generated code can read its expected test answers inside the worker. Three previously reported operational issues also remain; this report changes no application code or owner decisions.

**Commit audited:** `7fd1369485ffcf21320e406205b6a100a10e5c93` (main, merge of PR #39).

Creator Agent is a local evidence and product studio. It uses bounded model workflows, PostgreSQL records, scoped approvals, budget reservations, isolated Python products, and a web/desktop catalog. I assessed one owner operating the studio, with concurrent workflows and potentially hostile generated code and unauthenticated webhook traffic; I did not assume a large public service.

## Method and independence

I inspected this chat's clean checkout at `C:/Users/jorda/OneDrive/Desktop/creator_agent`. `git pull --ff-only` reported it current. `C:/dev/creator_agent` exists, but I did not switch to or modify that checkout. This is not evidence that the move script ran successfully.

I read the supplied handoff, project instructions, project context, current tracking and decisions, milestone/review instructions, relevant architecture, oversight and evaluation requirements, and implementation paths. I used the ponytail-audit skill. No other audit report was opened. **The initial handoff read accidentally included its earlier-audit appendix before I formed findings. This audit is independently verified, but not blind.** The comparisons below use that appendix, not independent verification of the earlier reports or their historical commits.

The requested report-only scope overrides the usual instruction to update tracking files. Only this report and its reproduction script belong in the PR. No source, test-suite, migration, configuration, protocol, or owner decision was changed. No subagents, runtime paid calls, real credentials, outreach, payments, deployment, or runtime integration activation were used. GitHub publication of this audit PR is the explicit exception authorized by the handoff.

## What I actually ran

Environment: Windows, Node `22.21.0`, pinned pnpm `11.25.0`, disposable loopback PostgreSQL `18.6` on port `55447`. PostgreSQL 16 was not available for this local run. Existing dependencies were present; I did not perform a clean frozen-lockfile install. Corepack downloaded the pinned pnpm under sandbox escalation; no dependency or lockfile changed.

| Command or probe                                                                      | Actual result                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short --branch`, `git pull --ff-only`, `git rev-parse HEAD`             | Clean main at the commit above; already current. Created `codex/independent-audit`. The first pull lacked `.git` write permission; the escalated retry succeeded.                                                                                                                                              |
| `node --version`, `pnpm --version`                                                    | Node 22.21.0; pnpm 11.25.0 through a local Corepack shim. Initial sandbox download failed DNS; escalated use succeeded.                                                                                                                                                                                        |
| `pnpm check`                                                                          | Passed typecheck, tests and formatting: **288 tests, 144 pass, 0 fail, 144 skip**. Most skips were the unconfigured database suites, so this alone was insufficient.                                                                                                                                           |
| `initdb` / `pg_ctl`                                                                   | Created a disposable trust-authenticated cluster under ignored `.verification/codex-audit/pgdata`, bound only to 127.0.0.1.                                                                                                                                                                                    |
| First `pnpm test:db` attempts                                                         | One stopped before tests because sandbox pnpm could not download. Another reached tests but the server started in a separate tool process had exited: **288 tests, 145 pass, 130 fail, 13 skip**, with database cases failing `ECONNREFUSED`. These are failed environment attempts, not passing verification. |
| `pnpm test:db`, with the server kept in the same command                              | Passed: **290 tests, 276 pass, 0 fail, 14 skip**; 434.38 seconds. Thirteen native/WSL gates and one inverse-backend case skipped. Server stopped cleanly.                                                                                                                                                      |
| `pnpm readiness`                                                                      | Exit **3**, truthful **not ready**, no register inconsistencies; unresolved live/native/study/pilot prerequisites remain.                                                                                                                                                                                      |
| `pnpm --filter @creator/web build`                                                    | Passed. JavaScript bundle 572.47 kB / 163.50 kB gzip; existing >500 kB warning.                                                                                                                                                                                                                                |
| `pnpm audit --prod`                                                                   | “No known vulnerabilities found.” This is dependency advisory coverage, not a security proof.                                                                                                                                                                                                                  |
| `pnpm smoke`                                                                          | Passed built page → Vite preview proxy → API health/fixture checks. HTTP smoke, not browser rendering.                                                                                                                                                                                                         |
| `node --test tracking/evidence/codex-audit/probes.mjs`, with disposable DB configured | **3 pass, 0 fail, 0 skip**. Confirmed QA answer exposure by source tracing and emulated the answer-copy predicate; loopback batch file read 2,108,061 bytes; 25 bad signatures created 25 stored rows; processor callback held both financial locks; three study attempts exported disjoint audit events.      |
| Earlier probe attempts                                                                | Sandbox loopback access failed one batch probe; first DB probe used a fixture environment-variable name rejected by the contract. Corrected the probe, retained the application contract, and reran successfully.                                                                                              |
| `wsl --list --quiet`                                                                  | Sandbox returned `Wsl/E_ACCESSDENIED`. No native exploit or opt-in isolation acceptance was run.                                                                                                                                                                                                               |

Ignored command logs remain in `.verification/codex-audit/` in this checkout. They are not part of the PR. The reproduction script is [probes.mjs](../../tracking/evidence/codex-audit/probes.mjs). From the repository root after building, set `CREATOR_TEST_DATABASE_URL` to a disposable PostgreSQL server and run `node --test tracking/evidence/codex-audit/probes.mjs`. It creates and drops its own test database; the HTTP double binds only to loopback. Without the variable, its database probe explicitly skips.

## Findings

### 1. High — Generated code can read held-out expected answers

**Where:** `packages/executor/src/execution.ts:230`, `packages/executor/src/contracts.ts:87`, `packages/executor/worker/bridge.py:90`, `packages/executor/worker/recipe.py:21`; comparison predicate at `packages/executor/src/artifacts.ts:28`.

The supervisor writes the whole QA case to `acceptance.json`. That includes `stdout` and `exit_code`, the expected answers. The bridge mounts that file at `/acceptance.json` in the same sandbox where generated `src/main.py` runs. Read-only mounting prevents alteration; it does not prevent reading. Python's `-I` option does not deny filesystem reads.

**Failure scenario:** A submitted Python program reads `/acceptance.json`, writes its `stdout` value and exits with its `exit_code`. It can match every test answer without implementing the requested behavior. This applies to held-out cases in build QA, study code checking, and exported-package rechecks. Independent review might reject such code, but the executed QA check itself does not enforce the claimed secrecy. No reviewer acceptance of malicious code is claimed here.

**Evidence:** The probe confirms the exact serialization and mount statements, parses a case through the real schema, copies the exposed answers, and passes the real `casePassed` predicate. **The data exposure is confirmed by reading; the complete WSL2 exploit is inferred, not executed.** Confirm the remaining step by running this answer-copy program through the real worker in a disposable product; it should be unable to read any expected-answer file after the repair.

```python
# Proposed native reproduction; NOT executed in this audit.
import json, sys
with open('/acceptance.json') as source:
    answer = json.load(source)
sys.stdout.write(answer['stdout'])
sys.exit(answer['exit_code'])
```

**Suggested fix:** Keep expected stdout and exit status exclusively in the supervisor. Send only runtime inputs, such as argv and stdin, into the worker. Check the namespace for alternative copies of answers and add an adversarial native acceptance case that attempts this read. Keep the frozen expected cases unchanged.

**Comparison: New.** The earlier fix hid/froze cases in builder contexts. This is a different leak through the execution filesystem; it does not show that the earlier prompt-redaction fix disappeared. Invariants 8–9 are affected.

### 2. Medium — Invalid payment signatures cause unlimited durable writes

**Where:** `packages/broker/src/payments-service.ts:188`, `packages/db/src/payment-store.ts:525`, unauthenticated dispatch at `apps/api/src/index.ts:1480`.

Every invalid signature for an existing payment connection calls `recordPaymentEvent`. That inserts a new row even when the same invalid request is repeated. There is no application-side cap or coalescing on this path. Correct signature verification prevents fake money, but does not prevent storage exhaustion.

**Failure scenario:** Someone who knows a webhook endpoint repeatedly posts a small invalid body. Each rejected request consumes database storage and write capacity. This matters before exposing a webhook publicly; endpoint UUID secrecy is not a request limit.

**Reproduction:** The real service/store probe sends the same invalid signature and `{}` body 25 times to a fixture connection. All return 400, and the real database contains 25 rejected receipt rows. This is a service-path reproduction; the HTTP route was inspected, not load-tested.

**Suggested fix:** Rate-limit at the proxy and bound application-side rejected-request recording by connection/time bucket. Retain aggregate counts and a small sample. Keep successful, signature-verified economic events durable and deduplicated as today.

**Comparison: Known, still open.** Appendix N1 explicitly excluded bad-signature payment writes from the pairing-limit repair. Invariant 5 is affected through resource exhaustion, not unauthorized money creation.

### 3. Medium — Slow processor reads hold financial database locks

**Where:** `packages/db/src/payment-store.ts:764` and `:772`; the payout path repeats this at `:813` and `:825`. `packages/broker/src/payments-service.ts:253` passes the network-reading callback.

The store takes the workspace financial lock and the connection row lock before awaiting the processor callback. A slow processor therefore prevents other work needing those locks from proceeding and occupies a database connection. Multiple overlapping requests can amplify that contention. The bounded adapter timeout limits each request, but does not eliminate the queue.

**Failure scenario:** A payment reconciliation waits on the processor while another request tries to revoke that connection or update financial allocation state. The second request waits for an unrelated external read.

**Reproduction:** The probe pauses the callback passed to the real `applyPaymentSnapshot`. A second database connection cannot acquire the workspace financial advisory lock; `FOR UPDATE NOWAIT` on the connection row fails with PostgreSQL `55P03`. The callback is then released with an intentional error, rolling back without creating money.

**Suggested fix:** Separate bounded processor observation from the short projection transaction, while preserving stale-observation ordering and current revocation checks. ADR-0034 explains why naive fetch-first application was unsafe. Use a per-object observation fence or equivalent ordering rule; do not simply move the fetch and remove the ordering protection.

**Comparison: Known, still open.** Appendix N3. This is an availability issue; this audit found no duplicate-money effect from it.

### 4. Medium — Batch result reads have no byte bound, and uploaded files have no cleanup path

**Where:** `packages/broker/src/batch.ts:208`, `:222`, `:295` and `:299`.

Polling reads each result file completely with `Response.text()` and then splits it into lines. The requested item IDs filter only after the whole body has been buffered. File size can therefore dominate memory even for a small requested result set. The adapter also does not retain the uploaded input file ID for cleanup or delete input/output/error files when they are no longer needed.

**Failure scenario:** Polling a very large result file allocates the entire body and the line array, potentially interrupting the API. Repeated batches also leave provider-side context files without application-managed cleanup. Exact provider retention behavior was not checked against a live account.

**Reproduction:** The real adapter polled a loopback HTTP double for one requested ID. It consumed **2,108,061 bytes**, mostly unrelated records, and returned that one result. The observed requests were only `GET /batches/probe` and `GET /files/out/content`; source inspection found no delete/cleanup implementation. This confirms the missing bound, not an observed out-of-memory crash or real provider retention duration.

**Suggested fix:** Stream lines with byte, line-length and result-count limits. On overflow, preserve unresolved exposure and record a bounded failure rather than implying zero charge. Record provider file IDs and use an explicit, retryable cleanup policy after durable reconciliation; handle abandoned submissions too.

**Comparison: Known, still open.** Appendix R3. Invariants 5 and 10 are affected.

## Checked and found sound within this scope

- Budget arithmetic uses integer nano-USD. Admission and reservations precede model dispatch. Unknown outcomes retain exposure; stale attempts become unknown rather than being silently released. The overall ceiling uses one cross-workspace lock, excludes fixture spending and includes final study holds. The configured ceiling tests passed across real-mode workspaces, unknown-cost blocking and open study holds, using synthetic requests without provider dispatch.
- Owner policy changes require a human owner. Normal record writes resolve the session and require CSRF. OIDC checks the configured owner subject; webhook exceptions verify raw-body signatures. Pairing completion binds to a current approving session, and visitor/server pairing limits are serialized. These conclusions combine code inspection with the configured database suite, not live identity-provider verification.
- Study assignment constructs separate attempt workspaces and frozen contexts. Human-only admission refuses model/helper paths. Participant/grader exclusion works in both directions, with case-normalized actor IDs. Portfolio knowledge checks exclude study workspaces and pins. The QA filesystem finding limits the broader claim of held-out secrecy.
- Artifact checking binds hashes, candidate commit, spec and execution records. Package paths are constrained; source fetching checks DNS answers and pins the connection address; management Git disables hooks and credential helpers. No host fallback was found in the execution path examined. Actual WSL escape resistance was not tested here.
- GitHub operations record intents, scope immutable repository identity and bind merges to reviewed heads/checks. Marketing uses content/audience-bound grants, suppression and a visibly local fixture sink. Payment snapshots use economic keys, balanced corrections and explicit reinvestment allocation; fixture money does not fund real work.
- The readiness command reports not ready instead of treating fixtures as live verification. Live model IDs, study decisions, public hosting and native acceptance remain explicit gaps. The HTTP smoke passed without claiming browser/native verification.

These are bounded audit observations, not a certification of every route, interleaving or deployment.

## Comparison with earlier audits

**Counts:** 1 new; 3 known and still open; 0 demonstrated regressions. Severity: 1 High, 3 Medium, 0 Low, 0 Optimization.

The appendix's R4 claim that the whole workspace audit log is repeated across attempts **did not reproduce at this commit**. Assignment creates a distinct workspace for each attempt, and export selects `a.workspace_id`. The real store probe exported three attempts: three workspace IDs and five audit events with no cross-attempt duplicates. I treat that specific duplication claim as absent now, without asserting when it changed or that this tiny probe establishes large-export performance.

Earlier fixed items checked again include participant/grader exclusion, held-out case redaction in role packets, database CI configuration, configured-adapter health reporting, parent overrun accounting, output-folder refusal, CSV quoting, and the exclusive `after DATE` predicate. The new runtime QA leak remains despite role-packet redaction. The configured suite supplies the automated coverage described above.

I did not reclassify the accepted local preview cookie risk as a finding. Backup encryption remains an unresolved owner-policy item, not a newly reproduced defect. Context indexing secret-looking files, minor housekeeping, scheduler polling efficiency, and all earlier historical fixes were not exhaustively re-audited. The web bundle warning is measured above but not promoted into an additional defect without a user-visible performance failure. No earlier audit was treated as proof that a path works.

## Not covered and limits

- No live model, source, GitHub runtime, processor, outreach, hosted deployment, account activation or owner pilot. No real funds or verified model IDs.
- No actual WSL2 exploit, native Tauri interaction/installer/update run, browser accessibility review or generated-code escape testing. The existing native/WSL skips are limitations, not defects.
- PostgreSQL 18.6 rather than the requested CI PostgreSQL 16. No clean dependency reinstall or independent clean-room release rebuild. The existing commit-bound archive extraction/tamper test passed. The configured backup/restore test passed on the disposable server, including tampering refusal.
- No new large-load/concurrency benchmark (the existing test used 60 ideas and 700 events), disk-full/crash fault campaign or exhaustive migration-history replay. I examined high-consequence paths and ran their existing suites; I did not read every UI component or every line of the repository.
- No historical checkout of earlier audit fixes, and the earlier-audit appendix was seen too early for a blind comparison. “New” means absent from the supplied appendix, not proof nobody has ever noticed it.

## Decisions for Jordan

1. What bounded retention and rejection-log detail do you want for invalid webhook traffic?
2. What provider-file retention window should batch cleanup enforce after results are durably saved?

The held-out QA boundary and financial lock ordering are engineering repairs under the existing invariants; they do not require changing study decisions or raising spending authority. **Next eligible prompt:** U03, scoped to the findings you choose to repair. No next milestone or repair starts automatically.
