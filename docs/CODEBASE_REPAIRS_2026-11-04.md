# Codebase audit repairs — November 4, 2026

Scope: the nine findings in [the audit](CODEBASE_AUDIT_2026-11-04.md). Source baseline
`171430b639b4dbd4170292894444cf2c01f3f27b`, plus uncommitted repairs. The pre-existing
`.codex/config.toml` change and the audit report/evidence were preserved. Suggested new
product features were not part of this repair.

## Disposition

| Finding                                | Repair                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1: Node security baseline              | Pins, engine floors, current setup and Docker use patched supported releases. Development and desktop staging refuse an older runtime before starting/copying it.                                                                                                                                                                         | Official Node 22.23.4 download checked against published SHA-256; staged `node.exe` reports 22.23.4 and matches that binary. No system or installed-studio replacement.                                                        |
| 2: Disconnect race                     | Disconnect clears the database connection before remote revocation. Sign-in completion compares the captured connection version under lock; unique candidate credential references are removed when stale. Refresh swaps references only while the original is still signed in; late completion cannot restore a disconnected connection. | Real-store/loopback regressions for delayed callback in another service and delayed refresh after Disconnect; successful refresh/sign-out and normal sign-in remain covered. No migration or OAuth endpoint change.            |
| 3: False fixture-only banner           | Development prints the actual factory's API/plan availability and the remaining dispatch gates.                                                                                                                                                                                                                                           | Factory-backed notice checks for fixture and configured API routes without sending a provider request.                                                                                                                         |
| 4: Windows fixtures and path assertion | Fake Claude uses a native Windows launcher with a kill-on-close child job. Production shim refusal is unchanged. The terminal test checks environment assignments rather than matching `creator_agent` inside a path. Windows CI now has a disposable database contract gate.                                                             | Local Windows connection/chat/Claude/terminal regressions. CI configuration added, not a claim of a GitHub Actions run.                                                                                                        |
| 5: Omitted safety tests                | `pnpm test` now includes current retention/runtime/startup/upgrade safety checks. Frozen v4 replay has its own explicit historical command. Current tests exercise the original approval code independently of historical package preflight.                                                                                              | Current safety gate; originals and their receipts retain their bytes. Native-only PowerShell tests skip explicitly on other platforms.                                                                                         |
| 6: Stale documentation                 | README, current status, product guide, local development and runbook now distinguish implementation, contract/native/live verification and activation.                                                                                                                                                                                    | Pre-repair documents preserved byte-for-byte with an archive hash receipt. Original audit findings/results stay unchanged.                                                                                                     |
| 7: Stale qualification labels          | Server derives current-prompt eligibility using the same prompt binding as admission; historical grades remain intact. Models shows “historical pass (older prompt)” and the next action.                                                                                                                                                 | Store assertion, rendered UI check and production-UI browser walk against an older-prompt fixture.                                                                                                                             |
| 8: Eager secondary pages               | Models, GitHub, payments, marketing, portfolio, operations and study load on demand. Each retained page has a loading/error boundary.                                                                                                                                                                                                     | Initial JS 1,042.85 → 843.89 kB; gzip 290.82 → 246.43 kB. Browser: Models chunk absent before opening, draft survives navigation, failed chunk leaves other pages/drafts usable; 390 px has no horizontal overflow.            |
| 9: Oversized handoff                   | Current build status and handoff are concise, with separate history and section indexes. Exact original narratives remain available without being loaded at every startup.                                                                                                                                                                | Original 597,645/545,281-byte pre-audit files and the subsequent audit entry are preserved in the snapshots; current pages are approximately 2 kB each. Archive files are protected from newline normalization and formatting. |

## Verification

The full database suite passed: **747 tests, 720 pass, 27 explicit skips, zero failures**.
After final formatting/rebuild, the affected security/API/UI contracts passed again: **97 tests, 96 pass, 1 optional-real-CLI skip**. The current development safety gate passed **22/22** checks, including the compiled API startup message.

Project and web TypeScript checks, the production build, formatting and offline locked Windows Rust compilation pass. Desktop staging contains 84 runtime resources with Node 22.23.4; its binary matches the official download. The actual older system Node is refused by the staging command before changing the existing bundle. The large-chunk warning and a Rust incremental-cache hard-link warning remain recorded; neither check was weakened.

See [the final receipt](../tracking/evidence/codebase-repairs-2026-11-04/receipt.json), [archive hashes](../tracking/evidence/codebase-repairs-2026-11-04/document-archives.json) and [browser observations](../tracking/evidence/codebase-repairs-2026-11-04/browser.json). Full logs remain in ignored `.verification/repairs-2026-11-04/`. The full suite ran before formatting-only source changes; the final affected check binds to the rebuilt output. The final standalone gate also covers the subsequent API-banner text correction.

The UI walk used a separate disposable PostgreSQL database, production-built assets on
review ports, a fixture-only workspace, and a disabled worker. It made no model calls.
The deliberate chunk-failure check produced expected browser network/React error logging;
the normal navigation/qualification walk produced no page errors. It did not interact with
the installed app or a personal browser session.

## Boundaries and next work

- C54 and full-product acceptance remain partial. This is a source repair, not a release.
- No live provider, GitHub, payment or campaign call; no account, spending policy, study
  freeze, held-out answer, installed application or operational database was changed.
- The installed application and system Node were not upgraded. The current staged bundle
  includes the patched runtime, but it still needs independent exact-candidate review and
  the supported native packaging/acceptance/owner-decision path before installation.
- The initial web chunk remains above Vite's warning threshold. The measured transfer-size
  reduction is not a benchmark of user-perceived startup latency; no threshold was weakened.
- Historical upgrade replay still requires its original code/package. Its refusal on a
  changed checkout remains correct; current guards no longer confuse that refusal with an
  exercised approval-switch assertion.

Next eligible prompt: **U02 — Independent milestone review** of this changed candidate and
its final evidence. No automatic next milestone, installation, activation or new feature work.

Implementation references checked November 4: [Node 22.23.4 security release](https://nodejs.org/en/blog/release/v22.23.4), [optional Node 24.22.2](https://nodejs.org/en/blog/release/v24.22.2), [React lazy](https://react.dev/reference/react/lazy) and [Suspense](https://react.dev/reference/react/Suspense).
