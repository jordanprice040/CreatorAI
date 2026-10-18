# Session handoff

## Claude Code tool setup — October 18, 2026

Owner approved making the development tools available to Claude Code. Copied `.agents/skills` to `.claude/skills` (30 skills; added Matt Pocock `grill-me`, `grilling`, `improve-codebase-architecture` to both at commit 49dd158). Added `.mcp.json` with the same Playwright and Firecrawl entries, and `.claude/settings.json` + `.claude/hooks/session-start.sh` (cloud only, `pnpm install`). `claude mcp list` reads both servers (pending per-user approval). Playwright stdio check passed in the cloud container with `PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium` and `PLAYWRIGHT_MCP_SANDBOX=false`; Firecrawl's host is blocked by the cloud network policy, so use the claude.ai Firecrawl connector there. Hook run, a Prettier check and `contracts.test.js` (9 pass) succeeded. Details: [DEVELOPMENT_TOOLS.md](../docs/DEVELOPMENT_TOOLS.md#claude-code), ADR-0004.

## Latest development-tool setup — October 18, 2026

Owner requested Emil Kowalski, Playwright MCP, Firecrawl MCP, Impeccable, Ponytail and selected Matt Pocock skills. Installed 27 project-local skills at pinned commits with original contents and licenses preserved. Added `.codex/config.toml` for `creator_playwright` and `creator_firecrawl`; existing global configuration remains unchanged. Impeccable Windows engine 0.1.15 was checked against its published SHA256 and its probe passed. No plugin hooks or automatic updaters installed.

Codex read both server configurations. Actual protocol checks passed: Playwright 25 tools plus isolated headless Edge navigation to about:blank and close; hosted Firecrawl 3.30.3 with three keyless tools. No Firecrawl search/scrape/parse, paid call, account signup, or application integration activation was performed. Newly configured MCP tools may need a restart in Codex Settings → MCP servers; skill discovery refreshes on the next turn. Current-chat exposure was not claimed from the direct handshake alone.

Read [DEVELOPMENT_TOOLS.md](../docs/DEVELOPMENT_TOOLS.md) for use, verification, and machine-specific cwd/browser setup. [Install manifest](evidence/development-tools/install-manifest.json) binds 104 exact upstream skill files; [MCP evidence](evidence/development-tools/mcp-verification.json) records executed checks. AGENTS.md gained a short tool pointer and precedence clarification; its existing instructions and CLAUDE.md were retained. Historical T01 manifests remain unchanged and describe the T01 snapshot, not the subsequent tooling/doc edits.

**Product status remains T01 complete; next eligible prompt is T02.** The earlier handoff below records T01 implementation and checks. No automatic milestone advancement.

Updated October 17, 2026 (America/New_York). **T01 verified complete; T02 not started.**

## Repository and candidate

- Root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Origin: `https://github.com/jordanprice040/CreatorAI.git`.
- Branch: unborn `main`; HEAD: none. Files remain untracked; no staging, commit or push. Do not mistake empty `git diff` output for no local work.
- Candidate: package 0.1.0 / executable schema 1.0. Exact file hashes are in [T01 final manifest](evidence/t01/final-files.sha256), with [verification details](evidence/t01/verification.json).
- Kit v3.0 and its T01/T02 prompts remain authoritative. Rubric/protocol documents remain drafts, not frozen study versions. Original AGENTS.md, CLAUDE.md, agent.md, templates, context and archived references preserved. README gained a local-development entry point; four tracking documents updated. Original kit/T00 manifests are historical and were not rewritten.

## What now works

Five implementation packages: contracts/domain and API/CLI/React web. Strict Zod runtime schemas validate task/result/run configuration, sources/claims, alternatives, assumptions, decisions, exact-money costs, typed links and experiment assignments. Domain functions check configuration binding, limits, delegation containment including sibling sums, transitions, expected versions and candidate evidence. Product stage, execution state, research condition and discovery method are distinct.

A visibly labeled deterministic fixture runs through web/CLI → HTTP API → domain and returns inspectable structured outcomes. Live dispatch and human-only provider calls are denied. Nonsoftware/existing-tool/human-led/hybrid/deferred/failed outcomes work. This is stateless: no research, real models, persistent catalog, generated software or study results.

Start from the root:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Web: http://127.0.0.1:5173. API: http://127.0.0.1:4310/api/health. In another terminal: `pnpm cli health` or `pnpm cli demo use_existing "Synthetic task"`. Full commands, configuration and trust limitations: [local guide](../docs/LOCAL_DEVELOPMENT.md).

The combined local demo was restarted on the final compiled candidate during this session (tool process session 3619). Do not assume it is still running in a later chat; inspect before starting another server. Ctrl+C stops both servers. No remote deployment or public service was started.

## Checks actually executed

- `scripts/verify-clean.ps1`: new source-only directory `.verification/t01-20261018-035503-421`, no initial node_modules; `pnpm install --frozen-lockfile --offline`, build and check passed. Offline reused the package cache; this is a fresh install directory, not a fresh network/cache environment. Clean log is retained in evidence/t01.
- `pnpm check` includes strict type checks, **20 passing contract/domain/HTTP/compiled-CLI tests** and formatting. Shell/application Node 22.21.0. A separate invocation of bundled Node 24.19.0 also passed all 20 tests; pnpm itself uses that bundled runtime. pnpm pinned 11.25.0.
- `pnpm smoke`: built page and preview proxy → API health/fixture POST passed on separate ports 4312/5175, then closed. This is HTTP evidence separate from browser rendering.
- Actual in-app browser: health connected; existing-tool, process-change and failed fixture dispositions; whitespace input disables submission. Final restarted candidate's process-change result captured in browser-state.txt and browser-fixture.png. No mobile-device or comprehensive accessibility certification claimed.
- Final manifest/checks verify candidate hashes, current links and preservation of original non-edited kit files. Git remains uncommitted; no CI run was made.

Resolved intermediate issues: restricted npm/pnpm cache access and localhost sockets required sandbox escalation; HTTP tests passed once loopback was permitted. A hostile-Host test initially used fetch, which normalized Host; switched to raw HTTP so the actual hostile header was exercised without weakening the gate. Initial formatting command ran before the docs directory existed; final formatting passed. During a demo restart, the old browser tab became a connection-error page; a fresh local tab verified the restarted app. This was not a completed browser unavailable-service test; CLI unavailability is covered by executed tests.

## Decisions, limits and next step

ADR-0002 records the installed versions, Node HTTP/test choice, fixture boundary and trust assumptions. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also tested. Official dependency sources are recorded in the local guide. Provider identifier/access/pricing remain unverified in config/provider-availability.json; no silent model substitution.

Domain checks are pure prerequisites, not an authenticated policy store, transactional reservation ledger, scheduler or independent reviewer. Path scopes are logical strings, not OS isolation. Validated evidence structure does not prove source truth or check execution. Persistence/auth/grants/budget broker/orchestration/isolation/research remain later milestones. No real credentials, paid calls, study runs or unknown external effects exist. X01–X10 remain deferred. The separate CIS4914 repository was neither inspected nor modified.

**Next eligible prompt: T02 — Persistence, provenance, and durable audit.** T01 prerequisite satisfied. Requires a new user request; do not advance automatically.

```text
Apply the shared implementation contract. Execute T02: Persistence, provenance, and durable audit.
```

Read the complete T02 prompt and current files first. Add actual PostgreSQL persistence, migrations, stable scoped entities/links, optimistic versions, transactional state/audit/outbox, idempotent projections, API/CLI/history paths, restart/stale/cross-scope/duplicate-delivery verification. PostgreSQL service/setup remains unverified; complete unrelated work before treating live service setup as a blocker. Preserve the T01 contracts or record necessary versioned migration. No owner question currently blocks beginning T02 inspection.
