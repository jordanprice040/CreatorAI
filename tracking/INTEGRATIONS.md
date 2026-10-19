# Integration readiness

X05 local Windows acceptance passed October 19, 2026: final release native
sign-in/browser-handler launch, shared authenticated Gallery, verified source,
visible Notepad editor copy, real paired WSL job and visible worker controls.
Owner approval used the explicit local fixture HTTP seam; no personal login or
live OIDC acceptance claimed. Editor uses a rehashed Downloads copy and fixed
packaged Notepad activation; original cache preserved. Explicit shutdown exited
the CLI 0. Evidence: tracking/evidence/x05/native-ui-acceptance.json. Local manual
installer lifecycle passed separately; final unsigned installer rebuilt. Signing,
automatic updater, hosted connections, other hosts and production activation
remain disabled/unverified. Entries below describe earlier candidates.

X05 continuation: actual paired active-process revocation and killed-worker/owner
API reconciliation passed on real WSL; no automatic retry. Tauri CLI 2.12.3 pinned,
NSIS local-client bundle prepared. Separate unsigned debug identity verified native
startup after install, upgrade and manual rollback; downgrade refused, fixture
uninstalled. Existing WebView2 and separately started studio services required.
No signed automatic updater, public distribution, OIDC activation or background
service installation. Interactive native UI/editor and other-host acceptance remain.

X05 continuation, October 19, 2026: migration 17 adds bounded owner jobs; explicitly
paired artifact.run CLI workers execute exact locally available artifacts using
reviewed WSL2/bubblewrap/systemd isolation. Native-to-worker launch and separate
window/worker shutdown verified. Browser handoff verified with isolated Edge
fixture approval and ordinary/Secure cookies. No live OIDC/default-browser-handler
acceptance. Worker reports remain observations, never independent QA. No installer,
update service, hosted connection or external account activated. Earlier
presence-only readiness below describes the prior candidate.

X05, October 19, 2026: Rust/Cargo/MSVC/WebView2 verified on Windows. Tauri shell
compiles/starts; native source download verified with disposable fixture session
and T13 test-double artifact, preserving exact manifest/archive hashes. Native
browser sign-in/menu implementation exists; interactive browser approval, editor,
OIDC/secure-cookie and real-worker launch gates remain. Migration 16 implements
single-use/session-bound pairing and separate revocable desktop sessions/workers;
shared UI and outbound client control presence-only scoped/fenced leases. No paired
job dispatch, arbitrary native IPC, installer/updater, background service or hosted
integration activated. See apps/desktop/README.md and tracking/evidence/x05. X01–X04
source is now integrated from origin/main ddf7bcf; their recorded fixture/live
boundaries remain unchanged. Existing local audit repairs preserved.


X04, October 19, 2026: no live call and no credential. GitHub REST (API version
2026-03-10) and Git-over-HTTPS adapters exist for a GitHub App installation or a
fine-grained token named by environment variable; they are checked only against
loopback contract tests and a local bare repository. Live use needs CREATOR_GITHUB=live
on the API process, a verified connection in a real workspace and grants. Endpoint
permissions were checked on docs.github.com. See ADR-0027 and docs/GITHUB.md.

X03, October 19, 2026: no new external integration and no live call. Semantic search
calls embedding models only through the broker (`model.embed`), and
config/search/semantic-models.json lists none for real workspaces, so they refuse it until
an owner verifies an embedding model (accessible id, dated pricing snapshot, data-class
approval). The fixture model fixture-embed-v1 (config/pricing/fixture-embed-v1.json) is a
labelled trigram hash with simulated rates. A model-compiled audit question is one
ordinary metered `model.generate` call; its output is a plan validated by schema, never SQL.
See ADR-0026 and docs/SEARCH_AND_AUDIT.md.

X02, October 19, 2026: no live call. config/context/provider-capabilities.json
records gpt-6-astra prompt caching, Batch API (/v1/responses, 24h window, 50% price in
config/pricing/openai-gpt-6-astra-batch.json) and server-side compaction as
`documented` from the official pages; real workspaces refuse them until verified.
OpenAIBatchAdapter (Files upload, POST /v1/batches, poll, output/error files) exists
behind the same CREATOR_LIVE_PROVIDER=openai opt-in and key as the live adapter and is
checked only against a loopback contract test. Fixture models fixture-context-v1
(simulated prompt cache and batches) and fixture-lossy-v1 use simulated rates. See
ADR-0025 and docs/CONTEXT_AND_CACHING.md.

X01, October 19, 2026: no new external integration and no live call. The model
registry records gpt-6-astra as `documented` (account access unverified), so a real
workspace refuses to route to it until an accessible API id is verified and recorded
as a new registry version. Two further fixture models (fixture-economy-v1,
fixture-bargain-v1) exist only for the deterministic adapter; their rates are
simulated units. See ADR-0024 and docs/MODEL_ROUTING.md.

T13, October 18, 2026: no new external integration. A local preview origin
(CREATOR_PREVIEW_PORT, default 127.0.0.1:4320) serves studio-authored pages that
start the exact verified package in the existing T11 WSL2 worker. Downloads and
previews are owner-only and local; public publication, hosting and native
installers are not implemented or activated. See ADR-0017 and
docs/ARTIFACTS_AND_PREVIEW.md.

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

T15, October 18, 2026: no new integration activated. Study builds reuse the T12 builder, the T11 WSL2 worker and the fixture broker; `config/evaluation.json` records the owner's `gpt-6-astra` preference (unverified, live dispatch off) and the $20 T15 cap with no spend authorized. See ADR-0022.

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
| Remote GitHub | Yes (X04): REST + Git adapters, fixture GitHub | Yes (fixture workspaces) | Loopback REST contracts (fine-grained token, app installation tokens), local bare-repo push | No credential configured | Off unless CREATOR_GITHUB=live plus a verified connection and grants | No live call or repository; studio repositories are private, prefixed and tracked by id. Releases, settings, secrets not implemented. |
| Windows desktop/paired worker | No | No | No | No | No | Native tooling/build/pairing/device verification deferred to X05. |
| Hosted control/monitoring | No | No | No | No | No | No deployment, external tracing or notifications configured. X06. |
| Payments/reinvestment | Yes (X07): fixture processor, Stripe test-mode REST adapter, signed webhooks, ledger, entitlements, reinvestment | Yes (fixture workspaces) | Stripe adapter against a contract double (payment intent, refunds, disputes, checkout, balance, payout); signature scheme per docs.stripe.com 2026-10-19 | No processor call or account | Fixture workspaces only; Stripe test mode needs `CREATOR_STRIPE_*` key + webhook secret env vars and a verified connection. Live mode not built; activation is a separate owner decision | docs/PAYMENTS.md, migration 19, ADR-0033, evidence/x07. No web UI. |
| Campaign delivery | No | No | No | No | No | No connector or content/audience grant. X08. |

Local tooling: Node v22.21.0 application baseline, bundled Node v24.19.0 additionally tested; pnpm 11.25.0 uses that bundled runtime. Strict manifests and lockfile now pin dependencies; a fresh frozen install/build/check passed. npm/Python/gh observations remain in T00 evidence. gh availability is not authentication verification. No secrets/private account configuration were read. Services, real model access, pricing and grants remain unresolved at their later gates.

Record verification date, observed target/account identity, versions, and evidence without storing credentials. A missing key blocks a live check; complete unrelated implementation first.
