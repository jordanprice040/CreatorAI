# X08 verification — October 19, 2026

Candidate: uncommitted `codex/x08-marketing` on `0dfc6e6` in the managed X08
worktree. Final changed source/document hashes: `final-source-sha256.json`.
Environment observed: Windows, Node v22.21.0, pnpm 11.25.0, PostgreSQL 18.6.
Pinned install used `pnpm install --frozen-lockfile --offline` (cached packages).

## Executed gates

- `final-focused.log`: compiled Node tests for marketing, marketing API/CLI,
  payments, payments API/CLI and storage. **23 pass, 0 fail, 0 skip**.
- `full-tests.log`: `CREATOR_TEST_DATABASE_URL` against the dedicated loopback
  cluster, `pnpm test`. **263 tests, 248 pass, 0 fail, 15 skip**. This run began
  before final helper/CLI-help/UI wrapping changes; it is not a claim that every
  test executed against all final source hashes. The final focused run covers the
  helper and API/backend; final build/typecheck/browser cover the final new UI.
  Skips: native/WSL opt-in paths, inverse worker-availability case and pg_dump
  discovery (client installed, CREATOR_PG_BIN not supplied to this run).
- `build.log`: `pnpm build` passed, with Vite's >500 kB bundle warning.
- `final-typecheck.log`: final `pnpm typecheck` passed.
- `format-check.log`: `pnpm format:check` passed for all configured paths.
- `whitespace-check.log`: final `git diff --check` passed (empty output).
- `focused-initial.log`, `focused-second.log`, `focused-third.log`: retained
  intermediate failures/repairs and the earlier passing 13-check run. Fixture
  manifest mutation was rejected; a missing required nullable test request field
  was repaired. The first browser fixture also contained an empty older manifest,
  so the fixture helper was changed to insert a complete manifest at creation.
  No immutable-history trigger or acceptance assertion was disabled.

## Browser observations

Actual isolated headless Edge through the installed Playwright MCP, loopback
API 4318/web 5188, disposable database, synthetic owner development login and
explicit manifest test seam. No generated code executed, personal session used,
real recipient contacted or market validation collected.

Observed via UI: sign-in, Campaigns route, verified package selection, create
reviewable draft, grant exact content/audience, simulated lost acknowledgement,
reconcile without resend, record synthetic feedback and suppression. Readback:
one acknowledged local delivery, one distinct fixture observation, $0 adapter
spend. Final narrow viewport/document widths both 390px with complete campaign
detail visible. An initially reproduced content-hash overflow was repaired in
the new component. Final browser console after reload had React development
information, with no application runtime error. Earlier session navigation
included an expected stale session response; no error-free claim for the entire
multi-fixture browsing session.

`browser-fixture.json` identifies the last synthetic workspace/artifact.
`x08-measured.yml`, `x08-final.yml`, `x08-desktop-final.png`, `x08-narrow.png`
retain actual rendered evidence. Browser evidence was copied from the tool's
allowed output root into this worktree. Direct tool writes to the managed
worktree were refused by the tool's path boundary, without changing that boundary.

Final API/Vite fixture exited; its database was dropped. The earlier interrupted
fixture's specifically named database was also dropped. Dedicated PostgreSQL
cluster on 127.0.0.1:55441 stopped. No existing studio database was migrated.

## Limits

Acceptance is local fixture delivery only. No live/test email or advertising API,
hosted landing-page deployment, public unsubscribe endpoint, customer validation,
live payment, paid inference, native Tauri or new WSL execution was verified or
activated. No commit or push was made. Claude's UI/UX integration remains separate.
