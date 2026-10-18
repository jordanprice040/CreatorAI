# Integration readiness

## Development tools installed October 18, 2026

These are tools for the coding agent in this checkout, separate from the product integration table below. Setup details: [development tool guide](../docs/DEVELOPMENT_TOOLS.md).

| Tool | Installed / configured | Executed verification | Remaining limit |
| --- | --- | --- | --- |
| Emil Kowalski / Ponytail / Matt Pocock skills | 15 / 6 / 5 project skills, pinned Git commits | 104 upstream files across all 27 skills including Impeccable matched Git blob hashes; unique names/frontmatter present | Workflow usefulness is not benchmarked; next-turn discovery |
| Impeccable | Skill 4.6.0 and local Windows x64 engine 0.1.15 | Published SHA256 matched; engine-probe passed | Design commands, hooks and live overlay not activated/tested |
| Playwright MCP | Project stdio entry; npm package 0.0.83; isolated headless Edge | Codex configuration read; initialize, 25-tool discovery, blank navigation and close passed | Chat MCP restart may be needed; no personal session or generated-product sandbox |
| Firecrawl MCP | Official keyless hosted project entry | Codex configuration read; initialize and three-tool discovery, server 3.30.3 | Search/scrape/parse untested; rate-limited; full account/paid capabilities unverified |

Evidence: [manifest](evidence/development-tools/install-manifest.json), [MCP check](evidence/development-tools/mcp-verification.json). No credentials stored or copied. Existing Firecrawl app connector was observed in this session's available tools; it is distinct from this project MCP entry and its account status was not tested. Product source-search/fetch remains unimplemented.

Claude Code (October 18, 2026): `.claude/skills` mirrors all 30 skills; `.mcp.json` holds both servers; Playwright verified in a Linux cloud container with executable-path and sandbox overrides (25 tools, `data:` navigation, close); Firecrawl unreachable from the cloud network (proxy 403) and untested there. The claude.ai Firecrawl connector is the recommended cloud route; it is not connected yet.

## Product integration status at T01

Updated October 17, 2026 (America/New_York), T01. Local API/CLI/web and the deterministic fixture provider are implemented and tested. No external application adapter is active. See [T01 evidence](evidence/t01/verification.json), [historical remote observation](evidence/t00/remote-refs.json), and [ADRs](DECISIONS.md).

| Integration | Implemented | Fixture tested | Contract tested | Live verified | Activated | Evidence / remaining setup |
| --- | --- | --- | --- | --- | --- | --- |
| Local API/CLI/web | Yes, stateless | Yes | Yes | Local HTTP and browser only | Local fixture demo | apps/api, apps/cli, apps/web; health, strict requests, errors and fixture results. No persistent catalog or hosted service. |
| Model/provider broker | Deterministic fake and admission prerequisites only | Yes | Fake contracts only | Real provider unverified | Fixture only; live disabled | No real SDK, model/API call, budget reservation or grant lookup. Reference GPT-6 Astra identity/access/pricing remain unverified; dated config/provider-availability.json. |
| Source search/fetch | No | No | No | No | No | No broker; approved sources, retention and network boundaries to implement. |
| PostgreSQL persistence | Yes (T02) | Yes (fixture workspaces) | Yes | Local PostgreSQL 16.15 in a Linux cloud container only | Optional; enabled by CREATOR_DATABASE_URL (loopback only) | packages/db, migration 1, evidence/t02. Owner's Windows PostgreSQL install untested; no hosted database. |
| Owner authentication (OIDC) | Yes (T03), openid-client 6.8.8 | Local development login | PKCE flow against a local test identity provider | No real IdP | Optional via CREATOR_OIDC_* | Development login refused in hosted mode; no IdP account configured. |
| Durable workflow service | No | No | No | Unverified | No | Temporal planned; CLI not on PATH, no SDK/config or endpoint verified. T05. |
| Execution isolation | No | No | No | Unverified | No | No worker; Docker not on PATH, VM/container boundary unverified. T11. |
| Local Git/artifacts/preview | No application adapter | No | No | Git CLI only | No product activation | Git 2.45.1.windows.1, unborn main/origin configured. No generated-product Git, artifacts or preview service. |
| Remote GitHub | No application adapter | No | No | Read-only refs only | No product activation | Supplied jordanprice040/CreatorAI URL: exit 0, zero advertised refs at 2026-10-18T03:26:37Z. Visibility, account/scopes, API permissions and CI unknown. No push/PR/release. |
| Windows desktop/paired worker | No | No | No | No | No | Native tooling/build/pairing/device verification deferred to X05. |
| Hosted control/monitoring | No | No | No | No | No | No deployment, external tracing or notifications configured. X06. |
| Payments/reinvestment | No | No | No | No | No | No verified accounts/economic events. Test mode first; live authority separate. X07. |
| Campaign delivery | No | No | No | No | No | No connector or content/audience grant. X08. |

Local tooling: Node v22.21.0 application baseline, bundled Node v24.19.0 additionally tested; pnpm 11.25.0 uses that bundled runtime. Strict manifests and lockfile now pin dependencies; a fresh frozen install/build/check passed. npm/Python/gh observations remain in T00 evidence. gh availability is not authentication verification. No secrets/private account configuration were read. Services, real model access, pricing and grants remain unresolved at their later gates.

Record verification date, observed target/account identity, versions, and evidence without storing credentials. A missing key blocks a live check; complete unrelated implementation first.
