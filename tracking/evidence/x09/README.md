# X09 verification — October 19, 2026

Candidate: uncommitted `codex/x09-portfolio` on local X08 commit `64596ef`, in
`C:/Users/jorda/.codex/worktrees/x08-marketing/creator_agent`. X08's recorded source
hashes were checked before making its local commit. No push, original-checkout
reset or shared UI redesign was performed. Final X09 changed source/document
hashes are recorded in `final-source-sha256.json`.

Environment observed: Windows, Node v22.21.0, pnpm 11.25.0, PostgreSQL 18.6.
Existing pinned dependencies were reused; X09 adds no dependency.

## Executed checks

- `full-tests.log`: final code, `CREATOR_TEST_DATABASE_URL` targeting dedicated
  127.0.0.1:55442, `CREATOR_PG_BIN=C:/Program Files/PostgreSQL/18/bin`, `pnpm test`.
  **270 tests, 256 pass, 0 fail, 14 explicit skips**. Native/WSL opt-in and inverse
  worker-availability cases were not counted as passes. Actual PostgreSQL
  dump/restore ran and passed. The full run includes the X09 HTTP/CLI, scheduling,
  conservation, health/backlog, budget isolation and knowledge tests.
- `focused-fifth.log`: **7 pass, 0 fail, 0 skip**. Real owner HTTP/CSRF and compiled
  CLI, source-broker refresh, concurrent interval coalescing, maintenance admission
  refusal, actual budget subtree protection/ledger conservation, owner feedback,
  failed health and explicit deferral, normal/conserve/maintenance_only/paused,
  crash/restart receipts, delayed-dispatch fencing, knowledge regression/review/
  activation/rollback/revocation and stale-provenance refusal. Full suite includes
  the final cancellation receipt-state refinement made after this focused run.
- `final-typecheck.log`: `pnpm typecheck` passed for final TypeScript/web code.
- `build.log`: `pnpm build` passed. Vite retains its nonfatal >500 kB bundle warning.
- `format-check.log`: repository `pnpm format:check` passed.
- `whitespace-check.log`: `git diff --check` passed (empty output).
- Earlier focused/typecheck logs are retained. Fixture/test repairs include a
  manual source incorrectly labelled available without a hash, old test API-shape
  assumptions, broker `text`/`tool` fields and the existing source broker's
  public-data/null-amount grant contract. No acceptance assertion, source policy,
  immutable-history trigger or finance boundary was weakened to pass.

The source fixture adapter uses reserved `.fixture.test` pages without network
contact. Model calls use the labelled fixture model. Database fixtures use actual
admission, budget allocation/journals and durable workflow paths. Package-health
failure is intentionally tested against an explicit manifest fixture with absent
package bytes; it produces attention, never a fabricated health pass. Actual
archive validation remains covered by the existing artifact tests in the full run.

## Browser observations

Actual isolated headless Edge through installed Playwright MCP; loopback API 4319,
web 5189; disposable database and synthetic owner login. The optional background
scheduler was explicitly off. `browser-fixture.json` identifies the test workspace,
schedule and knowledge candidate. `browser-setup.mjs.txt` retains the setup source
(intended original location `.verification/x09-browser.mjs`, not this evidence folder).

Observed real UI actions: authenticated Portfolio view, bounded scheduling pass
that refreshed a synthetic source, executed structural knowledge regression,
reviewed the exact version, activated it, paused/resumed the portfolio, cancelled
the schedule and revoked the knowledge version. Paused pass control disabled and
readback showed actual succeeded retrieval, reviewed/active then revoked knowledge,
and cancelled schedule. No alert was present in the observed successful flow.

`x09-paused-reviewed.yml`, `x09-cancelled-revoked.yml`, `x09-desktop.png` and
`x09-narrow.png` retain snapshots/screenshots. Actual narrow viewport/document
widths both 390px. Screenshot inspected visually. This verifies the new shared
web view, not a native Tauri application or Claude's separate redesign.

## Cleanup and limits

The disposable browser API/Vite exited and its specifically named database was
dropped. Dedicated PostgreSQL cluster on 127.0.0.1:55442 was stopped after the full
suite. Existing studio databases were not migrated. Ignored test files may remain
for inspection; they are not active services or deployment evidence.

No live model/source adapter, paid call, public deployment, account change,
outreach, payment, automatic reinvestment or unattended polling was activated.
Source refresh is not truth validation. Health is private archive integrity, not
uptime. Knowledge regressions establish bounded rendering/unchanged authority,
not empirical quality improvements or installed executable skills. Policy budget
identity rotation and more than 100 background-polled workspaces are outside this
version's supported controls. No fixed production/profit quota was introduced.
