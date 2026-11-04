# November 4 repair evidence

Baseline: `171430b639b4dbd4170292894444cf2c01f3f27b` plus the uncommitted repairs.
See [the repair report](../../../docs/CODEBASE_REPAIRS_2026-11-04.md),
[receipt](receipt.json), [browser observations](browser.json) and
[exact document archive hashes](document-archives.json).

Verification used a portable, checksum-verified Node 22.23.4 and a disposable local
PostgreSQL 18.6 cluster. Full test logs remain in ignored `.verification/repairs-2026-11-04/`;
their hashes and the final source/artifact hashes are in the receipt. The test database
server and browser fixture were stopped and their databases/cluster removed. The system
Node, installed studio, operational data and `.codex/config.toml` user edit were not changed.

`browser-stack.mjs` creates a throwaway fixture database on the explicitly configured
`CREATOR_TEST_DATABASE_URL` server and serves production-built UI assets on review ports
5183/4330/4340, with the worker disabled. Run it only from the repository root after building,
with a disposable test server whose role may create databases. Remove the earlier
`.verification/repairs-2026-11-04/stop-browser` marker before a repeat run; create it again
afterward to close the fixture and drop its database.

`browser-walk.js` is the callback for the Playwright MCP `browser_run_code_unsafe` tool. It
uses a synthetic login, checks on-demand loading, historical qualification labels, draft
preservation, a deliberately failed chunk, and a 390 px viewport. It submits no model work.
The combined callback preserves the steps executed individually in this session; the
observations distinguish normal navigation from the deliberate network-failure probe.

The old failing race reproduction and audit receipt stay unchanged under
`tracking/evidence/codebase-audit-2026-11-04/`; they describe the pre-repair candidate.
The repaired behavior is covered by the normal compiled `plan-connections.test` regressions.
Frozen v4 helpers/tests remain unchanged and their whole-package replay is a separate,
candidate-specific historical gate. This evidence does not establish native installation,
real WSL isolation, live model quality, GitHub Actions execution or full-product acceptance.
