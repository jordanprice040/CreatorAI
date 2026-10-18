# Integration readiness

T12, October 18, 2026: the authenticated owner CLI now connects current frozen
T08 tasks to existing model-call admission/reservations, scoped T11 Git patches,
fresh reviewer context and real WSL2 QA. Fixed synthetic Python checklist roles
exercise normal/error cases; no live model was activated. Exact task/commit/spec,
prompts, owner acceptance plan, broker traces and execution records persist locally.
Browser/persistence recipes, dependent-task integration, searchable build records,
participant implementation execution and public delivery remain unavailable.
See docs/BOUNDED_BUILDER.md, ADR-0016 and tracking/evidence/t12. Test files now run
serially to bound real-worker resource contention; internal concurrency gates remain.

Docker follow-up, October 18, 2026: local Docker CLI/daemon and Compose verified
(Desktop 4.95.0 / Engine 29.8.2 / Compose 5.6.0). Optional official PostgreSQL 18.6
image pinned by digest in compose.yaml; independent localhost dev/test services,
private ignored password file, no host-directory or daemon-socket mounts.
Migrations, persistence, host TCP authentication and all 140 DB/WSL tests passed.
Dev remains running, test stopped. Application use requires explicit terminal URL
configuration; existing PostgreSQL data is unchanged. No callable Docker MCP tool
was exposed in this chat, so the Codex connection-selector state is not separately
certified. No generated-product Docker worker activated; T11 WSL remains in use.
See docs/DOCKER.md, ADR-0015 and evidence/docker.

T11, October 18, 2026: reviewed local execution now uses the existing Ubuntu WSL2 VM, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4. The authenticated owner CLI binds current frozen T08 specs to separate Git repositories and a fixed offline template recipe. Real isolation/resource/cancellation/recovery gates were exercised; no Docker socket, personal mount, live provider, paid service or remote worker activated. Other hosts are blocked without a reviewed backend; ordinary CI skips real WSL execution explicitly. See ADR-0014, docs/ISOLATED_EXECUTION.md and evidence/t11.

T10, October 18, 2026: synthetic study execution reuses the fixture broker and T07 workflow worker. No new external integration, paid route, credentials, recruitment or real participant data. Native Windows PostgreSQL 18 was exercised in a disposable loopback-only cluster on port 55432. Human-only entries and conventional text checks require no model. Grader material remains under separate authorization; see ADR-0013 and evidence/t10.

## Development tools installed October 18, 2026

These are tools for the coding agent in this checkout, separate from the product integration table below. Setup details: [development tool guide](../docs/DEVELOPMENT_TOOLS.md).

| Tool | Installed / configured | Executed verification | Remaining limit |
| --- | --- | --- | --- |
| Emil Kowalski / Ponytail / Matt Pocock skills | 15 / 6 / 5 project skills, pinned Git commits | 104 upstream files across all 27 skills including Impeccable matched Git blob hashes; unique names/frontmatter present | Workflow usefulness is not benchmarked; next-turn discovery |
| Impeccable | Skill 4.6.0 and local Windows x64 engine 0.1.15 | Published SHA256 matched; engine-probe passed | Design commands, hooks and live overlay not activated/tested |
| Playwright MCP | Project stdio entry; npm package 0.0.83; isolated headless Edge | Codex configuration read; initialize, 25-tool discovery, blank navigation and close passed | Chat MCP restart may be needed; no personal session or generated-product sandbox |
| Firecrawl MCP | Official keyless hosted project entry | Codex configuration read; initialize and three-tool discovery, server 3.30.3 | Search/scrape/parse untested; rate-limited; full account/paid capabilities unverified |
| REA skill (`reverse-engineer-anything`) | Skill instructions from morluto/rea at c12d9ed, in `.agents/skills` and `.claude/skills` (added 2026-10-18) | 7 files copied unchanged, hashes in manifest, both copies identical | REA MCP server not registered; `rea-agents` setup, Hopper/Ghidra/IDA not installed; no REA analysis run |

Evidence: [manifest](evidence/development-tools/install-manifest.json), [MCP check](evidence/development-tools/mcp-verification.json). No credentials stored or copied. Existing Firecrawl app connector was observed in this session's available tools; it is distinct from this project MCP entry and its account status was not tested. Product source-search/fetch remains unimplemented.

Claude Code (October 18, 2026): `.claude/skills` mirrors all 31 skills (30 at first install, plus REA); `.mcp.json` holds both servers; Playwright verified in a Linux cloud container with executable-path and sandbox overrides (25 tools, `data:` navigation, close); Firecrawl unreachable from the cloud network (proxy 403) and untested there. The claude.ai Firecrawl connector is the recommended cloud route; it is not connected yet.

## Product integration status at T01

Updated October 17, 2026 (America/New_York), T01. Local API/CLI/web and the deterministic fixture provider are implemented and tested. No external application adapter is active. See [T01 evidence](evidence/t01/verification.json), [historical remote observation](evidence/t00/remote-refs.json), and [ADRs](DECISIONS.md).

| Integration | Implemented | Fixture tested | Contract tested | Live verified | Activated | Evidence / remaining setup |
| --- | --- | --- | --- | --- | --- | --- |
| Local API/CLI/web | Yes, stateless | Yes | Yes | Local HTTP and browser only | Local fixture demo | apps/api, apps/cli, apps/web; health, strict requests, errors and fixture results. No persistent catalog or hosted service. |
| Model/provider broker | Yes (T04): `ModelBroker`, fixture adapter, OpenAI Responses adapter | Yes | OpenAI adapter against a loopback server (usage normalization, 429/401/5xx/malformed mapping, key not serialized) | No live call | Fixture workspaces only; live needs `CREATOR_LIVE_PROVIDER=openai` + `OPENAI_API_KEY`, documented pricing, a covering grant and a funded envelope | `gpt-6-astra` and its pricing documented on developers.openai.com (retrieved 2026-10-18); account access unverified. config/provider-availability.json, config/pricing/. |
| Source search/fetch | Fetch: yes (T06) `SourceBroker`, fixture adapter, HTTP adapter. Search: no live adapter (T04 fixture `tool.search_public` only) | Yes (synthetic `.fixture.test` corpus) | HTTP adapter against loopback servers (DNS answer check, pinned address, no credentials/cookies, byte limit); policy and redirects against PostgreSQL 16.15 | No real site fetched | Fixture workspaces only; live needs `CREATOR_SOURCE_FETCH=live` + `CREATOR_SOURCE_HOSTS` and a covering `source.fetch` grant | packages/research, migration 5, ADR-0009, evidence/t06. Approved host list, robots/terms review and a live search provider still to choose. |
| PostgreSQL persistence | Yes (T02) | Yes (fixture workspaces) | Yes | Local PostgreSQL 16.15 in a Linux cloud container only | Optional; enabled by CREATOR_DATABASE_URL (loopback only) | packages/db, migration 1, evidence/t02. Owner's Windows PostgreSQL install untested; no hosted database. |
| Owner authentication (OIDC) | Yes (T03), openid-client 6.8.8 | Local development login | PKCE flow against a local test identity provider | No real IdP | Optional via CREATOR_OIDC_* | Development login refused in hosted mode; no IdP account configured. |
| Durable workflow service | Yes (T05): PostgreSQL-backed coordinator, leases and fencing in `packages/db` + `packages/orchestrator`; no Temporal (ADR-0008) | Yes (fixture workspaces) | Restart, duplicate delivery, stale worker, decision wait and cancellation against PostgreSQL 16.15 | Local PostgreSQL in a Linux cloud container only | In-process worker in the API when a database is configured (`CREATOR_WORKER=off` disables); optional `pnpm worker` | No external workflow service. Owner's Windows PostgreSQL untested. |
| Execution isolation | No | No | No | Unverified | No | No worker; Docker not on PATH, VM/container boundary unverified. T11. |
| Local Git/artifacts/preview | No application adapter | No | No | Git CLI only | No product activation | Git 2.45.1.windows.1, unborn main/origin configured. No generated-product Git, artifacts or preview service. |
| Remote GitHub | No application adapter | No | No | Read-only refs only | No product activation | Supplied jordanprice040/CreatorAI URL: exit 0, zero advertised refs at 2026-10-18T03:26:37Z. Visibility, account/scopes, API permissions and CI unknown. No push/PR/release. |
| Windows desktop/paired worker | No | No | No | No | No | Native tooling/build/pairing/device verification deferred to X05. |
| Hosted control/monitoring | No | No | No | No | No | No deployment, external tracing or notifications configured. X06. |
| Payments/reinvestment | No | No | No | No | No | No verified accounts/economic events. Test mode first; live authority separate. X07. |
| Campaign delivery | No | No | No | No | No | No connector or content/audience grant. X08. |

Local tooling: Node v22.21.0 application baseline, bundled Node v24.19.0 additionally tested; pnpm 11.25.0 uses that bundled runtime. Strict manifests and lockfile now pin dependencies; a fresh frozen install/build/check passed. npm/Python/gh observations remain in T00 evidence. gh availability is not authentication verification. No secrets/private account configuration were read. Services, real model access, pricing and grants remain unresolved at their later gates.

Record verification date, observed target/account identity, versions, and evidence without storing credentials. A missing key blocks a live check; complete unrelated implementation first.
