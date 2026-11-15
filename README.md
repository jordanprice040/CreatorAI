# Creator Agent

Creator Agent is a local evidence and product studio with a React web interface,
Node API/CLI and PostgreSQL records. It supports evidence-backed discovery,
alternative comparison, automatic assessments, human decisions, non-code proposals,
workspace files and notes, bounded workflows and budgets, searchable provenance, and
reviewed build/package/preview paths for a Python CLI prototype and a small static web page.

Start with [local development](docs/LOCAL_DEVELOPMENT.md) for setup and operation.
The [current product guide](docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md) covers features,
usage and remaining work. [Build status](tracking/BUILD_STATUS.md) and
[integration readiness](tracking/INTEGRATIONS.md) distinguish implementation,
recorded verification, configuration and activation.

## Quick start

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
or activated by setup. Submitting a theme uses recorded evidence; it does not
automatically search the internet. Generated execution needs the reviewed WSL2
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
