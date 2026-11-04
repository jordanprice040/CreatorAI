# Independent U02 review of the November 4 audit repairs

Reviewer: Claude (Anthropic), running on the owner's device at Jordan's request, November 4, 2026.

**Prior involvement and independence.** I did not write the November 4 audit or its repairs;
both were produced by Codex. I had no part in their design, code, tests or evidence. This review
read the audit and repair reports as claims, traced the code itself, and reran or replaced the
consequential checks with my own. It is a model review plus local fixture/contract execution,
not native installation, real-WSL, CI, live-provider or activation acceptance.

## Reviewed candidate

- Base commit: `171430b639b4dbd4170292894444cf2c01f3f27b` (verified `git rev-parse HEAD`).
- Candidate: that commit plus the uncommitted working tree (30 modified tracked files,
  16 untracked paths at review start). Nothing was committed, fixed or reformatted.
- `.codex/config.toml`: the one-line pre-existing `cwd` change (OneDrive path → `C:\dev\creator_agent`)
  is outside the repair scope, absent from the receipt, and was left untouched.
- **Hash reconciliation:** all 62 `file_hashes` entries in
  `tracking/evidence/codebase-repairs-2026-11-04/receipt.json` (bytes and SHA-256), the 4 frozen
  v4 upgrade sources and the 5 archive entries in `document-archives.json` match the current files.
  The only changed paths not in the receipt are `.codex/config.toml` (correctly excluded) and the
  receipt itself. No mismatch, so the receipt binds to the reviewed source bytes.
- Archives: the three `docs/*_HISTORY_2026-11-04.md` files are byte-identical to the baseline
  blobs. The two tracking histories are the baseline blob as an exact suffix plus the 1,915-byte
  audit entry prepended (the audit's own entry, as the repair report says), so "all prior content
  preserved byte-for-byte" holds.
- Staged desktop bundle: all 84 resource hashes in `bundle-manifest.json` verify; its
  `node/node.exe` is v22.23.4 with SHA-256 `dccc52de…ec14f`, equal to the official
  `win-x64/node.exe` line in a freshly downloaded `https://nodejs.org/dist/v22.23.4/SHASUMS256.txt`
  (signature of that file not checked). Its web assets are the current build (`index-CnE4waY8.js`).
- One evidence binding gap: see finding L2 (browser evidence was taken on an earlier web build).

## Findings, most severe first

No High or Critical finding. No authority bypass, budget/admission bypass or credential
disclosure was found in the repaired paths.

### M1 — A late request result can rewrite a disconnected or newer sign-in (Medium)

- **Where:** `packages/db/src/connection-store.ts:2479` (`#settlePlanRequest`): when a settled
  request reports `sign_in_invalid` (any 401), it sets `sign_in.state = 'reauthorization_required'`
  with no check of the connection's current state, credential reference or version, and without
  bumping `version`.
- **Reproduction:** `tracking/evidence/codebase-repairs-independent-review-2026-11-04/races.mjs`
  (real `ConnectionStore`, disposable PostgreSQL, `MemoryVault`, loopback fake returning 401):
  - Request in flight → Disconnect → late 401: state goes `signed_out` → `reauthorization_required`,
    version unchanged (7 → 7).
  - Request in flight → Disconnect → new sign-in (`signed_in`, v8) → late 401 from the old token:
    the new login becomes `reauthorization_required`, version still 8.
- **Consequence:** not an authority bypass (no credential is restored and `reauthorization_required`
  admits nothing), but a stale result overrides the owner's newer action: a disconnected
  connection is shown as needing re-authorization, and a fresh login is invalidated by the
  previous token's failure. Because the version does not change, the new version-bound sign-in
  and optimistic UI checks cannot see the change. This path pre-dates the repairs, but it is part
  of finding 2's scope ("newer-login protection"), which the repair report presents as complete.
- **Smallest fix:** record the admitting `credential_ref` (or a sign-in generation) on the plan
  request, and apply `sign_in_invalid` only `where credential_ref = <that ref> and sign_in->>'state'
= 'signed_in'`, bumping `version` when it applies. Add the two scenarios above as regressions.

### L1 — Sign-in completion fails after any unrelated connection change (Low)

- **Where:** `packages/broker/src/plan-service.ts:415` passes the whole-connection
  `expected_version` captured at `beginSignIn`; `packages/db/src/connection-store.ts:1452` refuses
  on any difference.
- **Reproduction (races.mjs):** start a first sign-in, confirm credits in the studio, finish the
  browser flow → `failed: "The connection changed during sign-in"`, state `not_signed_in`. Start
  "Sign in again", let a model call refresh the token, finish the browser flow → same failure.
  Cap acceptance and settings edits bump the version the same way.
- **Consequence:** fails closed (safe), but an owner who completes Models setup while the browser
  tab is open, or whose worker refreshes a token meanwhile, must sign in twice.
- **Smallest fix:** bind completion to the sign-in/credential generation (for example
  `credential_ref` plus `sign_in.state` captured at start, or a dedicated sign-in counter
  incremented only by sign-in/sign-out/refresh-swap) instead of the global version.

### L2 — Browser evidence binds to an earlier web build than the candidate (Low, evidence)

- **Where:** `tracking/evidence/codebase-repairs-2026-11-04/browser.json` and the receipt's
  `browser` block record `index-8usNy4Zt.js` / `models-BCbOm89p.js` (from `web-build.log`, 03:13).
  `apps/web/src/main.tsx`, `page-load.tsx` and `qualification-results.tsx` were rewritten at 03:23:06;
  a fresh build of the receipt-hashed sources gives `index-CnE4waY8.js` / `models-7yCgyMjJ.js`
  (gzip 246.42 vs 246.43 kB), which is also what the staged bundle contains.
- **Consequence:** the recorded walk did not exercise the exact final UI bytes, and the receipt does
  not say so (it does for the full suite). My own walk on the current build reproduced every
  claimed behavior (below), so the substantive UI claims hold for this candidate.
- **Smallest fix:** note the build identity in the repair evidence, or let this review's
  `browser.json` stand as the current-build observation. Do not regenerate the old receipt.

### L3 — The concise handoff dropped the list of still-open review items (Low, docs)

- **Where:** `tracking/SESSION_HANDOFF.md`, `tracking/BUILD_STATUS.md`, `docs/CURRENT_STATUS.md`.
  The previous handoff ended with "Not done: #75 L-1, #77 L-1, #90 N-4, #128 N-6, #129 N-4"
  (now in the history at line 64). #75 L-1 is repaired here; the other four appear in no current
  document.
- **Consequence:** a new session reading only the prescribed startup files no longer learns about
  known open Lows/nits, which is the failure mode finding 9 was meant to prevent.
- **Smallest fix:** a short "Open items" list (ids plus one line each) in the current handoff.

### Notes (no action required, recorded for completeness)

- **N1 credential residue on crash.** Unique credential references (`plan-service.ts:397`, `:530`)
  mean a crash between vault write and database record, or between the refresh swap and deleting
  the old reference, leaves an orphaned vault entry. Not reproduced; no sweep exists. Consider a
  later vault/record reconciliation.
- **N2 terminal secret assertion** (`tests/src/terminal.test.ts:222`) now checks assignment-shaped
  arguments only; it no longer looks for secret values. Adequate for `env -i` argument lists, but a
  harness-injected sentinel value would make the leak check stronger.
- **N3 Windows CI** (`.github/workflows/ci.yml`) uses whatever PostgreSQL the runner image ships,
  not pinned to 18, and has never run (CI minutes exhausted). Configuration only.
- **N4 failed page chunk** stays failed for that page until reload (React.lazy caches the
  rejection). This matches the alert's wording ("Reload to try again"), so it is not a defect.

## Disposition of the nine original findings

| #   | Finding                       | Disposition                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Node security baseline        | **Resolved in source.** Pins/engines/Docker/docs use 22.23.4+ / 24.22.2+. `requireSupportedNode` runs before staging copies `process.execPath`; the system Node 22.21.0 was refused with the bundle manifest unchanged. Bundled runtime verified against the official checksum. Installed app and system Node not upgraded (out of scope). |
| 2   | Disconnect vs delayed sign-in | **Resolved for the audited race; partial overall.** Audit scenario now ends `signed_out`; delayed callback in another service and late refresh are fenced and their candidate credentials removed. Open: M1 (late 401 settlement) and L1 (over-broad version binding).                                                                     |
| 3   | Startup messages              | **Resolved.** `scripts/dev.mjs` and `apps/api/src/main.ts` print the factory's actual adapter and plan availability, never "no real AI"/"no live calls"; covered by `development-config.test.mjs` without provider calls.                                                                                                                  |
| 4   | Windows fixtures/CI           | **Resolved locally.** Native compiled launcher with kill-on-close job; production shim refusal unchanged (fixture-only change). Terminal check no longer trips on `creator_agent`. Windows CI added but unexecuted (N3).                                                                                                                   |
| 5   | Omitted safety tests          | **Resolved.** `pnpm test` (and so `check`/`test:db`) now runs the retention, current upgrade-guard and development-config suites; frozen v4 replay is a separate `test:historical-upgrade`; the four frozen sources keep their hashes. Acceptance criteria not weakened.                                                                   |
| 6   | Stale documentation           | **Resolved**, with L3. README/current status/runbook/guide distinguish implemented, contract, native, live and activation; originals archived byte-for-byte; original audit unchanged.                                                                                                                                                     |
| 7   | Qualification labels          | **Resolved.** `prompt_current` is derived server-side from the same `currentForBuildRole`/`currentForDiscoveryRole` used for admission; grades unchanged; `latestDecided` ignores stale rows. Browser shows "qualified" for a current-prompt pass and "historical pass (older prompt)" for an older one.                                   |
| 8   | Lazy pages                    | **Resolved.** Seven secondary pages are lazy; Models chunk absent until opened; drafts survive navigation and a failed chunk; the boundary has `role="status"`/`role="alert"`; initial JS 843.89 kB (still above Vite's warning, not weakened).                                                                                            |
| 9   | Oversized handoff             | **Resolved**, with L3. Current files ~2 kB; history and section indexes intact.                                                                                                                                                                                                                                                            |

## Commands actually executed

All with the portable Node v22.23.4 (`.verification/repairs-2026-11-04/runtime/node.exe`, SHA-256
verified against nodejs.org) unless noted. Logs are in ignored `.verification/review-2026-11-04/`.

| Check                                                                                    | Result                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Receipt/archive/frozen-source hash reconciliation (`hashcheck` script)                   | 71/71 match; no mismatch                                                                         |
| Staged bundle resource hashes and bundled `node.exe` version/hash                        | 84/84 match; v22.23.4, official checksum                                                         |
| `tsc -b`                                                                                 | Pass                                                                                             |
| Web `tsc --noEmit` and `vite build`                                                      | Pass; 843.89 kB initial chunk, large-chunk warning remains                                       |
| `prettier --check` (format:check file set)                                               | Pass (before this report was added)                                                              |
| System Node 22.21.0 → `apps/desktop/build-studio.mjs`                                    | Refused (exit 1), bundle manifest hash unchanged                                                 |
| Full compiled suite on disposable PostgreSQL 18.6 (`127.0.0.1:55447`, own cluster)       | 747 tests: 717 pass, 0 fail, 30 skipped (first run, `CREATOR_PG_BIN` unset)                      |
| Rerun of the 3 pg_dump-dependent tests with `CREATOR_PG_BIN=C:\pgsql18\pgsql\bin`        | 3/3 pass (studio-service ×2, restore ×1; their files 17/17) → combined 720 pass, 27 skip, 0 fail |
| Current safety gate (`test:dev-safety` file list)                                        | 22/22 pass                                                                                       |
| `races.mjs` (5 scenarios, fixture only)                                                  | Audit race fixed; M1 reproduced twice; L1 reproduced twice; two-instance refresh did not race    |
| Browser walk, this review's `browser-stack.mjs`, review ports 5183/4330/4340, worker off | All claimed UI behaviors observed on the current build; see `browser.json`, `models-390.png`     |

The 27 remaining skips are the same explicit opt-in gates as the repair run (pinned Codex binary,
real WSL2/isolation, Linux pseudo-terminal, real Claude CLI); they are not counted as passes.
The claimed 747/720/27 therefore reproduces. The 97-test "final affected contracts" subset was
not rerun separately because the full suite covers those files on the final bytes.

The pnpm launcher was not used (system Node is below the new floor); the same scripts' commands
were run directly. Windows Rust `cargo check` was not rerun (compilation-only evidence, no Rust
source changed in this repair). The disposable cluster and fixture databases were removed after
the run; the studio database (`creator_studio`, port 55433), installed app, credentials and
personal browser profile were not touched. No live provider, GitHub, payment or outbound call.

## Unchecked areas and limits

- GitHub Actions execution of the new Windows job; real WSL isolation; native installer/update;
  installed-app upgrade/acceptance; live ChatGPT/Claude behavior; the historical v4 replay gate.
- The Windows fixture launcher was exercised only through the test suite, not by forced
  termination of a stuck child.
- User-perceived startup latency was not measured (only transfer size).
- This is one model's review; it is not a human acceptance decision.

## Verdict

**Partial.** The nine repairs are real and the reported results reproduce on this exact
candidate: hashes reconcile, the audited Disconnect race no longer reproduces, the runtime floor
and bundle identity hold, and the UI changes behave as claimed. It is not a full pass because
finding 2's newer-login protection remains incomplete (M1: a stale 401 still rewrites a
disconnected or newer sign-in without a version change), L1 makes sign-in fail after unrelated
owner changes, and the browser evidence of record did not bind to the final build (L2). None of
these is an authority or spending bypass.

This review does not mark the product complete and does not authorize installation, release or
activation. Next eligible prompt: **U03 — Repair a failed gate**, bounded to M1 and L1 (with L3 as
a documentation touch), then a focused U02 recheck of those paths.
