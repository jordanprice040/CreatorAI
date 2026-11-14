# P-1 build retry after approval, and P-10 build run default (November 14, 2026)

Final UX pass findings P-1 (High) and P-10 (Low), `docs/FINAL_UX_PASS_FINDINGS_2026-11-14.md` on PR #192.

## What was wrong

The finding guessed that Build retried from `task.head` after the stopped attempt had already applied the patch. A reproduction on a throwaway studio showed otherwise:

- The first Start build stops at admission **before** any patch, so the build after approval starts from the first commit (`task.head` equals `base_commit`).
- In the cloud container there is no WSL2 worker. Every acceptance case came back `blocked` ("Isolation unavailable: this reviewed backend requires Windows + WSL2"). The build treated that as a failed check, spent its repair round resubmitting the same patch, and stopped with "Repair limit reached; the last patch was refused: Patch changes nothing".
- Every later attempt then started from the kept candidate (`task.head`), where the builder's patch again changed nothing, so it failed the same way, "every time".

With a worker that runs (the test double, standing in for WSL2), main already verified the sample after approval. On a PC whose worker fails, the old code would have shown the same misleading message.

## What changed

- `packages/executor/src/build.ts`: a case the worker did not finish (`blocked`, `lost`, `cleanup_required`, `cancelled`) stops the build at a checkpoint with the worker's reason ("The worker did not finish check A1 (blocked: …). The candidate is kept; build again once the worker runs."). No repair round is spent on code no test judged. Plan qualification already treated an unfinished run this way.
- Same file: a build resumed from a kept candidate keeps it when the builder submits the candidate's own content (`NoChangePatchError`), then reviews and tests it afresh. An empty patch is still refused on the first commit and on a candidate this build already judged.
- `apps/web/src/build-defaults.ts` `buildRunDefault`, used by Build's Start build form: the run defaults to the run the spec version was frozen in (P-10), then the earlier defaults.

## Checks

- `tests/src/build-retry-web.test.ts` (API, Build's own request shape: Prepare task from the first commit, Start build from the products list's task head, StartBuild's plan): start, approve, start again, verified, packaged, in Try; and the worker-blocked path through to Try. Fails on main with "Patch changes nothing".
- `tests/src/build.test.ts`: two executor tests (worker block stops without a repair round and the resumed build judges the kept candidate; the empty patch is refused on a candidate already judged). The Codex-builder test now expects the worker's reason on hosts without WSL2.
- `tests/src/web-next-step.test.ts`: `buildRunDefault`.

## UI walk (cloud container, test-double worker)

`dev-double.mjs` starts a throwaway studio on ports 4330/5183/4340 with the test-double executor (records say "test-double"; Try shows "Not isolation evidence"). `walk.mjs` drives Build with Playwright. Fresh fixture seed, throwaway PostgreSQL database.

1. Sample content, freeze (approved under Monitor › Approvals), sample review, Create product, Prepare task. The run selector opened on the spec's run `fbf5efd0`, not the two newer seed runs (`01-prepared.png`).
2. Start build: stopped at a checkpoint for approval (`02-stopped-for-approval.png`). Approve it once under Monitor › Approvals, Start build again: verified. Package, then "Packaged: open it under Try": the package is in Try (`06-try.png`).
3. Same again with `P1_BLOCK_FIRST=1` (the worker blocks the first case): the build after approval stops with the worker's reason (`b1-worker-blocked.png`); Start build asks a new approval; after it, the build verifies the kept candidate, packages and appears in Try.

## 390 px Build check

`scripts/ux-sweep.mjs` from PR #192, limited to Build at 390 px, on four Build states (fresh seed, stopped for approval, verified and packaged, blocked then resumed):

- This branch alone (main base): one serious axe `target-size` on the fresh state only, the "Export a runbook for another model" text button (218×20 px). PR #192's `button.text { min-height: 24px }` is the fix; it is not repeated here to keep `style.css` out of this branch.
- This branch merged with PR #192 head `1eed3d9`: 0 axe violations, 0 controls under 24 px, no sideways scroll, no console errors, in all four states.

Not covered here: the real WSL2 worker. That is the live walk on Jordan's PC, a separate step with his typed OK.
