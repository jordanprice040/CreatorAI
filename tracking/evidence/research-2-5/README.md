# §2.5 verification — October 20, 2026

- research-suite.tap: 34 passed, 0 failed/skipped. Real disposable PostgreSQL 18,
  fixture source corpus, local HTTP servers, scripted search transport. No provider call.
- final-budget-suite.tap: 12 passed, 0 failed/skipped. Includes final source-search
  HTTP grant/settlement/replay and real-workspace no-provider denial, Brave pricing
  and denied-reservation migration compatibility, arithmetic/global ceiling. Suites overlap.
- Direct TypeScript project build succeeded. Changed-file Prettier and git diff
  whitespace checks succeeded. No UI change or native acceptance claimed.
- Initial restricted run failed loopback operations with EACCES (10 pass/23 fail).
  Network-enabled retry exposed stopped Docker PostgreSQL 55433 (11 pass/22 fail).
  An independent cluster in .verification/research-2-5-pg on 55439 resolved this;
  all migrations ran only in throwaway creator_test_ databases.
- The initial successful suite stalled after the existing research-api subtest passed
  because it retained an open handle; interrupted it and reran with Node's
  --test-force-exit. The completed full run passes all 34 tests. No acceptance
  assertion was weakened. The final budget suite also used that runner option.
- Public-search contract was checked against the official Brave Web Search guide,
  retrieved through the coding Firecrawl connector on October 20 (HTTP 200;
  connector reported cachedAt 2026-10-20T05:45:53.040Z). URL is in the guide.
  This coding documentation retrieval is not live runtime verification.
- No key, real account price, paid request, actual-site SourceBroker fetch, saved
  studio migration, desktop build/install or activated integration. §2.5 is partial.
- source-hashes.json binds the implementation checked here. Other pre-existing
  uncommitted work and concurrent Claude changes are outside this verification.
