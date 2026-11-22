# Creator Agent

Creator Agent is a local evidence and product studio with a React web interface,
Node API/CLI and PostgreSQL records. It supports evidence-backed discovery,
web search with checked quotes, uploaded documents as evidence, alternative
comparison, automatic assessments, human decisions, an autopilot that stops for a
person, non-code proposals, workspace files and notes, bounded workflows and budgets, searchable provenance, and reviewed
build/package/preview paths for a Python CLI prototype and a small static web page.

Start with [local development](docs/LOCAL_DEVELOPMENT.md) for setup and operation.
The [current product guide](docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md) covers features,
usage and remaining work. [Build status](tracking/BUILD_STATUS.md) and
[integration readiness](tracking/INTEGRATIONS.md) distinguish implementation,
recorded verification, configuration and activation.

## Install on Windows (testers)

The current release is **0.1.9** ([release page](https://github.com/jordanprice040/CreatorAI/releases/tag/v0.1.9)).
Its installer includes PostgreSQL 18 and the Visual C++ runtime it needs, so a tester installs
nothing else: no database, Docker or Node. Windows 10 or 11 (64-bit), no administrator rights.
The build is not code-signed, so it goes, with its SHA-256 hash, only to people the owner knows
personally. Follow the [tester guide](docs/TESTER_GUIDE.md); the
[desktop studio guide](docs/DESKTOP_STUDIO.md) covers updates, backups and building the installer.

## Quick start (development)

Use Node 22.23.4+ within Node 22 or 24.22.2+ within Node 24 and pnpm 11.25.0.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the local app](http://127.0.0.1:5273) (development ports; the installed
desktop app uses 5173). Without CREATOR_DATABASE_URL, only
the stateless fixture demonstration is available. For saved records and sign-in,
configure loopback PostgreSQL, run `pnpm db:migrate`, then start the app and use
the one-run login link printed by the API.

## Current boundaries

Fixture demonstrations use deterministic synthetic responses. Live provider and
source-fetch adapters exist, but paid inference and live research are not verified
or activated by setup. Submitting a theme uses recorded evidence. Evidence comes from
pages the studio fetched itself or from uploaded text documents marked **Use as evidence**; a claim's quote is checked
against that text. Searching the web
(Projects › Discover › Search the web) needs a plan connection qualified for web
discovery, and only quotes the studio finds on a fetched page become draft claims.
The autopilot takes the same steps for you and stops where a person must decide.
Standard view (the default) keeps explanations short and folds long sections; Advanced shows
every tab, exact amounts and ids.
Generated execution needs the reviewed WSL2
worker and supports a bounded Python standard-library CLI recipe and the
`static-web/1` recipe (plain HTML, CSS and JavaScript, checked in a pinned headless browser);
see the [capability matrix](docs/CAPABILITY_MATRIX_2026-11-05.md).

Study/evaluation/analysis machinery is implemented and rehearsed; final participant
evaluation, independent ratings, empirical analysis and committee acceptance remain
incomplete. Windows desktop, scoped GitHub, hosted, commerce and marketing adapters are implemented
with differing contract/native/live evidence. Hosted operation, live commerce and campaigns
remain separately gated; see [current status](docs/CURRENT_STATUS.md).

Run `pnpm check` for typecheck, tests and formatting. Database and real-isolation
tests explicitly skip unless configured; use the documented disposable database
and WSL gates before claiming those paths pass.

## Project context

[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) defines intent;
[PROMPT_LIBRARY.md](PROMPT_LIBRARY.md) defines milestones. Follow
[AGENTS.md](AGENTS.md) for coding-agent work. The
[original kit/scaffold README](README_IMPLEMENTATION_KIT.md) is historical evidence,
not current setup guidance.
