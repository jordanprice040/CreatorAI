# Full codebase audit of main — November 12, 2026

- Audited: `main` at `abf4d77` (PR #190 merged; schema 62; next free migration 63, ADR-0100).
- Auditor: a fresh Claude thread ("Run full codebase audit"). It did not build any of the PRs since the November 2 audit.
- Spend: $0. No model call, no Run button, no live service. Only a throwaway PostgreSQL 16 database in the cloud container. The dev studio and the installed app were not touched.
- No code was changed. Fixes wait for Jordan's pick.

## Verdict

No High or Medium findings. Three Lows and seven nits.

Since November 2, main grew by about 64,000 lines in `apps/` and `packages/` (schema 37 to 62). The server code for that work went through several review rounds each, and it shows. Auth, CSRF, SQL parameters, file serving, money in exact units, lock order and the new background runners all held up when checked.

The findings are mostly in the web pages and the docs:

- Live panels stop updating after one failed poll.
- Hidden pages keep polling.
- The "current" docs describe the app as it was on November 6.

All open items from the November 2 audit are now fixed on main (see "Earlier audits").

## Checks run

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm format:check` | Pass |
| `pnpm audit` (prod and dev) | No known vulnerabilities |
| `cargo check --target x86_64-pc-windows-gnu` (desktop crate) | Pass |
| `cargo clippy` (same target) | 1 warning (N-5) |
| `pnpm test:db` on PostgreSQL 16 | 1159 tests: 1125 pass, 29 skipped, 5 fail (the known PowerShell-wrapper tests; no `pwsh` in the cloud container). `test:dev-safety` did not run because `pnpm test` stops on those 5 failures. |

## What was read

These were read closely:

- **Request edge.** Host and Origin checks, owner-only routes, the webhook signature paths and the body limits (`apps/api/src/index.ts`).
- **Sign-in.** Sessions, CSRF, the dev code lockout and OIDC (`apps/api/src/auth.ts`).
- **File serving.** `apps/api/src/files.ts` (`INERT` headers; only images are shown inline).
- **SQL.** Every query that builds SQL text with `${…}`. All the inserted parts are constant fragments or numbered parameters.
- **Process starts.** Every place that starts another program (`spawn`/`execFile`). None uses a shell. The capability checks run with a bare environment.
- **Runners.** P13/P33 autopilot and automation: `apps/api/src/autopilot.ts`, `packages/db/src/automation-store.ts`, `autopilot-store.ts`.
- **Web discovery.** P12: `apps/api/src/web-discovery.ts`, and `admitWebClaimsByPolicy` in `packages/db/src/web-discovery-store.ts`.
- **Plan requests.** Plan-request admission in `packages/db/src/connection-store.ts` (connection lock, usage count, insert).
- **Saved API keys.** P28 (`packages/broker/src/api-keys.ts`).
- **Charges.** The cents conversion in the payments path.
- **Migrations.** The migration list: numbers in order, 42 deliberately unused (ADR notes), 55–62 additive only.
- **Desktop app.** The ports, the sign-in and the MSIX redirect check.

These were only spot-checked or not read line by line:

- Most of `connection-store.ts` (6,000 lines).
- `context-store`, `study-store`, `payment-store`, `budget-store`. These were covered by the October and November audits and have changed little since.
- The 70+ web pages beyond the poll and load helpers.
- The Python worker.

No browser walk was done. The November 2 audit walked all tabs, and nothing found here needs one to confirm.

## Findings

### Low

**L-1: One failed poll blanks a live panel and stops it updating.**

`useLoad` (`apps/web/src/ui.tsx:199-203`) sets `data` to `null` on any failed load, background `refresh()` polls included. The panels decide whether to keep polling from that same data:

- Autopilot: `running`, `apps/web/src/autopilot.tsx:96-101`.
- Automation levels: `watching`, `apps/web/src/automation.tsx:172-180`.
- Build: `running`, `apps/web/src/build.tsx:333-342`.

So one dropped request clears the panel and also turns off its poll. Examples: the studio restarting, a database blip, the laptop waking from sleep.

Case: an autopilot is running and one poll of `GET …/autopilots` fails. The panel shows only the error. The interval is cleared because `running` is now false. It stays that way until the person presses Retry or leaves and comes back to the page, even though the autopilot carries on.

Fix: keep the last good data when a quiet refresh fails, and show a small "couldn't refresh" note. Only a first load or `reload()` should clear the data. Add one test in `web-session`-style for a failed refresh after a good load.

**L-2: Hidden pages keep polling, unlike Monitor and Approvals.**

Pages stay mounted while hidden (`apps/web/src/page-active.ts:3`). Overview (`overview.tsx:80-85`) and Oversight (`oversight.tsx:731-740`) pause their polls when the page is not shown or the window is hidden. These four do not:

| Panel | File | Every | Requests each time |
| --- | --- | --- | --- |
| Autopilot | `autopilot.tsx:97-101` | 3 s | 4 + one per plan connection (autopilots, connections, budgets, pricing, each connection's detail) |
| Automation levels | `automation.tsx:176-180` | 10 s | about 6 + one per connection |
| Build | `build.tsx:337-341` | 2 s | — |
| Gallery terminal | `gallery.tsx:768-772` | 3 s | — |

Case: Jordan starts "Whole process" (up to days), then works on Chat or minimises the window. The open studio window keeps making well over a thousand requests an hour against the local API for a panel nobody sees.

Fix: gate each interval on `usePageActive()` and `document.visibilityState`, as Overview and Oversight already do. `useOnShow` then refreshes on return.

**L-3: The "current status" docs describe main as of November 6.**

- `docs/CURRENT_STATUS.md:1-6` says main is `e08e0a4` (PR #150), schema **49**, and the installed app `f6e2ba0`, schema 41. Main is schema 62, and the installed app was upgraded on November 11.
- Its matrix says "Explore has no web search" and "automatic search-to-claim drafting remains planned". P12 web discovery shipped both (ADR-0086).
- `README.md:31-35` says submitting a theme "does not automatically search the internet". That is no longer true when a plan connection is qualified for web discovery.
- `docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md` (the "current product guide" the README links) is dated November 4. It doesn't mention:
  - web discovery
  - autopilot (P13)
  - automation levels (P33)
  - saved OpenAI keys (P28)
  - extra requests (P29)
  - Chat card fill-ins (P31)
  - copying connections (P30)
  - the gate checklist (#185)

`tracking/BUILD_STATUS.md` and `SESSION_HANDOFF.md` are current. This matters for the final UX pass and the committee, because the README and status page are what a reader opens first.

Fix: refresh `CURRENT_STATUS.md` (header, schema, matrix rows for discovery and evidence), the README boundary paragraph, and add short sections to the product guide for the new features.

### Nits

- **N-1: A stray log file at the repo root.** `t17-test.log` (83 KB, UTF-16 PowerShell error output from `pnpm test:db | Tee-Object`) came in with #135. Delete it and add `*.log` at the root to `.gitignore`.
- **N-2: Exports nothing uses.** These are exported and referenced nowhere else in `apps`, `packages`, `tests` or `scripts`:
  - `taskLabel` (`apps/web/src/allow-tasks.tsx:167`)
  - `presentationKey` (`apps/web/src/discover-defaults.ts:128`)
  - `TEXT_KINDS` (`packages/contracts/src/files.ts:22`)
  - `AUDIT_INTENTS` (`search.ts:200`)
  - `HumilityOptionKeys` (`oversight.ts:661`)
  - `CODEX_PIN` (see N-3)
  - the `*_POLICY_VERSION` constants in `contracts` `assessment`, `connections`, `discovery`, `exploration`, `routing`

  The policy-version constants may be kept on purpose as dated markers. If so, say so in a comment; otherwise delete them with the rest.
- **N-3: The Codex pin is written twice.** `CODEX_PIN` (`packages/executor/src/codex-host.ts:22-30`) repeats the version and SHA-256 that `scripts/install-codex-wsl.sh:10-12` actually checks. Nothing reads the TypeScript copy, so the two can drift apart silently. Delete one, or have a test compare them.
- **N-4: Three copies of "end time from hours", and the form's end time goes stale.**
  - The copies: `automation.tsx:752` (caps at 90 days), `routine-policy.tsx:57`, and `autopilot.tsx:121-127`.
  - Each computes the end time only when the hours field changes. So a form left open overnight confirms an end time that has already passed, or nearly has.
  - Fix: one shared helper, computed at confirm time.
- **N-5: Clippy warning.** `apps/desktop/src-tauri/src/studio.rs:54` uses `s.len() % 2 != 0`; clippy asks for `!s.len().is_multiple_of(2)`. It is the only warning in the crate.
- **N-6: A failed browser launch could crash the API.** `openSystemBrowser` (`packages/broker/src/plan-service.ts:145-157`) adds an `'error'` listener only on Linux. On Windows (`rundll32.exe`) and macOS (`open`), a failed spawn emits an unhandled `'error'` event, which ends the API process. It is unlikely on Windows, but it is one line to match the Linux branch.
- **N-7: "Automate selection" quietly skips a problem whose newest assessment failed.** In `dueAutomations` (`packages/db/src/automation-store.ts:236-282`), any newer assessment of the same problem hides the older one, even a newer one that failed. A failed one never qualifies either.

  Case: a problem's assessment succeeds and is chosen on. Later it is re-assessed and that run fails. The level now never acts on that problem until another assessment succeeds. The panel doesn't say why.

  Either count only newer *succeeded* (or still running) assessments, or show "waiting: the latest assessment failed" on the level's card.

## Earlier audits: what changed

November 2 audit ([FULL_AUDIT_2026-11-02.md](FULL_AUDIT_2026-11-02.md)): every item left open then is fixed on main.

| Item | Status |
| --- | --- |
| L-8, feedback to spec revision was CLI-only | Fixed (Try shows "became spec vN"; the in-app revise path exists) |
| L-9, capped lists kept the oldest records | Fixed (`packages/db/src/paging.ts`, newest first with cursors) |
| L-10, pages loaded once | Fixed (`useOnShow` / `useShown` in `useLoad`) |
| L-11, Codex packet bound | Fixed (#122) |
| L-12, MSIX redirected data home | Fixed (`home.rs` `redirected_package`) |
| N-1..N-3 | Fixed (#122) |
| #107 L-B, old runs never dot | Still present; left as Jordan chose |

October 18–20 audits: their items were closed by #17 and the later audit PRs. Nothing from them came up again here.

The older review Lows were closed by #189 (November 12), and PR #150 N-1..N-3 were closed by #190.

The new findings (L-1..L-3, N-1..N-7) are all in code or docs added or changed after November 2.

## Suggested fix order

One small PR, no migration or ADR:

1. L-1 and L-2 together (the same four panels and `useLoad`).
2. N-4, N-6, N-7, N-5, N-1, N-2, N-3.
3. L-3, the docs refresh. It could wait until the final UX pass, so the docs describe the polished app once.

## Fixes (November 12, branch `claude/project-thread-2jhwqe`)

Jordan asked for the Lows and nits to be fixed; L-3 (the docs refresh) is left for the final UX pass, as suggested.

- **L-1:** `useLoad` keeps its data when a quiet refresh fails and reports `stale`; `Status` shows "Could not refresh: … Showing what was read last." above the view. A first load or `reload()` that fails is still an error. The Autopilot, Automation levels and Build panels pass `stale`; the Gallery terminal list shows it too and now polls with `refresh` (no "Loading…" flash).
- **L-2:** `usePoll` (`page-active.ts`) runs an interval only while the page is shown and the window is visible; the four panels use it.
- **N-1:** `t17-test.log` removed; `/*.log` ignored at the root.
- **N-2:** the unused exports are removed (the five `*_POLICY_VERSION` markers too; nothing recorded them).
- **N-3:** `CODEX_PIN` stays as the code's record, and a test checks that `scripts/install-codex-wsl.sh` uses the same version, SHA-256, npm integrity and binary folder.
- **N-4:** one `endAfter` / `useEndTime` (`apps/web/src/end-time.ts`); the end time is worked out again when the hours change, the page is shown again or the window comes back into view.
- **N-5:** `is_multiple_of` in `studio.rs`; clippy is clean.
- **N-6:** `openSystemBrowser` ignores a launcher that cannot start on every platform.
- **N-7:** `dueAutomations` lets only a newer assessment that has not failed or been cancelled hide an older one (test, mutation-checked).
