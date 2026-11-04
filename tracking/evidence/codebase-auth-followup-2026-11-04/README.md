# Authentication follow-up evidence

`receipt.json` binds the uncommitted follow-up source, tests, docs and local logs. `collect-evidence.mjs` assembles this additive receipt after verification; it neither runs tests nor rewrites prior evidence. Logs remain in ignored `.verification/auth-followup-2026-11-04/`. The original repair receipt intentionally remains bound to its earlier candidate.

Checks use portable Node `.verification/repairs-2026-11-04/runtime/node.exe` (22.23.4), a disposable PostgreSQL 18.6 cluster on port 55449 and fakes only. Commands actually executed:

```powershell
$node = (Resolve-Path '.verification/repairs-2026-11-04/runtime/node.exe').Path
& $node node_modules/typescript/bin/tsc -b
& $node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
# Vite build executed with apps/web as its working directory:
$vite = (Resolve-Path 'node_modules/vite/bin/vite.js').Path
Push-Location apps/web
& $node $vite build
Pop-Location
# With CREATOR_TEST_DATABASE_URL set only to the disposable cluster, CREATOR_PG_BIN
# and PATH containing PostgreSQL 18/bin:
& $node --test --test-concurrency=1 tests/dist/*.test.js
& $node tracking/evidence/codebase-repairs-independent-review-2026-11-04/races.mjs
& $node --test --test-concurrency=1 tests/dev-artifact-retention.test.mjs tests/theme-intent-upgrade-current-guards.test.mjs tests/development-config.test.mjs
& $node node_modules/prettier/bin/prettier.cjs --check apps packages tests scripts config docs package.json pnpm-workspace.yaml tsconfig.json tsconfig.base.json .prettierrc.json
git diff --check
```

`regressions-before.log` retains failing tests before the fix; `regressions-after.log` is the initial focused pass. The final full suite additionally includes the migration and replacement-admission tests and the newer-refresh subcase. Exact counts are in the receipt. The unchanged review reproducer is checked for all six expected results, not merely a successful process exit.

`browser-binding-correction.json` is an additive L2 correction: Claude's independent browser receipt and this fresh build share `index-CnE4waY8.js` and `models-7yCgyMjJ.js`. No new browser walk was executed. UI sources are unchanged from that walk; server changes await follow-up review. The old repair browser receipt and old bundle remain historical.

No live model, operational database, native installation, system Node update, paid activation, frozen experiment or original evidence was changed. See [the follow-up report](../../../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md).
