# Project development tools

Installed October 18, 2026 at the owner's request. These tools support the coding agent working on Creator Agent. They do not activate Creator Agent's model broker, source ingestion, generated-code execution, or research conditions. T01 remains complete and T02 remains the next eligible milestone.

## Installed skills

All 27 skills are local to `.agents/skills`, pinned to inspected Git commits. Their upstream contents are unchanged. Exact commits, source paths, file hashes and license locations are recorded in [the install manifest](../tracking/evidence/development-tools/install-manifest.json).

| Source                                                  | Installed                                                                                          | Useful entry points                                                                                                                                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Emil Kowalski](https://github.com/emilkowalski/skills) | All 15 skills                                                                                      | `$emil-design-eng`, `$animate`, `$review-animations`, `$animation-performance`, `$break-ui`, `$mobile-native`, `$prototype`. Swift/Expo guidance is available for explicitly scoped future work; no native app was added.                   |
| [Impeccable](https://github.com/pbakaus/impeccable)     | `impeccable` 4.6.0, its references and launchers                                                   | `$impeccable audit`, `$impeccable polish`, `$impeccable harden`. Pinned Windows engine 0.1.15 installed and checksum verified.                                                                                                              |
| [Ponytail](https://github.com/dietrichgebert/ponytail)  | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help` | `$ponytail` for small complete changes; `$ponytail-review` for a targeted review. This is the skill installation, without plugin lifecycle hooks or session-history import. Upstream benchmark claims are not measurements of this project. |
| [Matt Pocock](https://github.com/mattpocock/skills)     | `tdd`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `writing-for-agents`               | Behavior-based tests, reproducible diagnosis, module boundaries, precise domain vocabulary and concise agent guidance.                                                                                                                      |

Matt's full orchestration, issue-tracker setup, interview, and automatic parallel-agent workflows were not selected: this repository already has a canonical prompt sequence, tracking, and host-controlled delegation. The selected disciplines can be used independently. Honor the existing authorized task and test boundaries; a skill's generic confirmation step does not require re-approval of an already authorized step. Record decisions in `tracking/DECISIONS.md`; project context and accepted decisions remain authoritative over upstream default paths and processes.

Skills become available on the next turn. If the selector does not refresh, restart Codex. Invoke the explicit `$skill-name`, or describe a task matching its description. See [official skill discovery guidance](https://learn.chatgpt.com/docs/build-skills).

## MCP servers

[Project configuration](../.codex/config.toml) is loaded for this already-trusted project. Global Codex configuration was not changed. Codex CLI 0.163.0-alpha.10.2 successfully read both entries.

| Name                 | Configuration                                                                                                                                   | Verification                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creator_playwright` | `@playwright/mcp@0.0.83` through npx; installed Edge; headless, isolated in-memory profile; output under ignored `.verification/playwright-mcp` | Real stdio initialize/list-tools, 25 tools discovered, `about:blank` navigation and browser close passed. Upstream reports Playwright `1.64.0-alpha-1790635538000`.                                     |
| `creator_firecrawl`  | Official hosted `https://mcp.firecrawl.dev/v2/mcp`; keyless                                                                                     | Real HTTP initialize/list-tools passed; server 3.30.3 exposed `firecrawl_search`, `firecrawl_scrape`, and `firecrawl_parse`. No search, scrape, parse or paid call was made. Hosted version can change. |

The current chat's tool catalogue may require an MCP restart before these names appear. In Codex Settings → MCP servers, restart the servers; `/mcp` shows connection status. The direct protocol checks above are separate from observing a refreshed chat catalogue. See [official MCP configuration guidance](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Firecrawl's [official setup](https://github.com/firecrawl/firecrawl-mcp-server#installation) documents the rate-limited keyless tier. Full crawl/map/agent access and higher limits need a separate account connection. An existing Firecrawl app connector is also present in this Codex environment; its account credentials were not read or copied. If upgrading the project server later, use secure OAuth or a bearer-token environment reference on the existing entry, never a secret in a URL, tracked file, or chat. Full account access is not verified here.

Playwright uses its own browser context, without personal browser cookies or an extension connection. It is a development tool, not the future generated-product isolation boundary. Only use it on the targets covered by the current request.

## Verify and maintain

From this repository root:

```powershell
codex mcp get creator_playwright
codex mcp get creator_firecrawl
python scripts/verify-development-tools.py
& .agents/skills/impeccable/scripts/impeccable.cmd engine-probe
```

The verification script requires Python 3.11+, Node/npm, installed Edge and network access. It records dated MCP evidence in `tracking/evidence/development-tools/mcp-verification.json`, makes no Firecrawl data-tool calls, and closes the browser it opens. A failure stays a failure rather than substituting a fixture.

Project config currently contains this machine's absolute working directory. Update `creator_playwright.cwd` if moving the checkout; on another OS choose an installed browser and a suitable npx command. The Playwright package version is pinned; npx keeps its downloaded package in the normal npm cache. No application dependency or lockfile was changed.

Impeccable's engine is in `.agents/skills/impeccable/scripts/bin/windows-x64/impeccable.exe`, ignored by Git. Its version probe passed after checking the release SHA256 sidecar. The launcher can restore a missing engine from its pinned release; review its cache destination on another machine. No Impeccable hooks, browser overlay, project redesign or `PRODUCT.md` generation was run as part of installation. Existing project context should inform any later design setup.

For skill updates, inspect a new upstream commit and use the system `skill-installer` helper with the manifest's repository/path and explicit `--ref`, targeting `.agents/skills`. Preserve any local edits first; the helper refuses existing destinations. Refresh the manifest and meaningful checks after updates. There is no automatic updater.

To disable an MCP server, set its project `enabled` field to `false` and restart MCP. Skill folders are ordinary project files and can be removed individually when no longer wanted. Preserve project instructions and user changes.
