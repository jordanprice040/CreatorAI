# Creator Agent

**Honors thesis project.** Creator Agent is a local studio for AI-assisted problem discovery and prototyping. A person starts from a theme, the studio gathers evidence from web pages and uploaded documents, turns checked quotes into claims, compares alternatives, and records every human decision. Bounded AI-agent workflows can then build and review a small prototype, under spending limits and with a person approving each step that matters. The thesis question is how autonomous AI, human-assisted AI and human-only workflows compare, and the repo includes the evaluation tooling for that comparison.

## What it does

- **Evidence-backed discovery.** Fetches pages and reads uploaded text documents marked as evidence. A claim's quote is checked against the source text before it is accepted.
- **Provenance in PostgreSQL.** Sources, claims, assessments and decisions are linked records, so any conclusion can be traced back to the quote and source behind it.
- **Bounded agent workflows.** Builder and reviewer roles, per-run budgets and spending limits, and tests against acceptance criteria that are frozen before the build starts. An autopilot runs the same steps and stops wherever a person must decide.
- **Sandboxed execution.** Generated code runs in a reviewed WSL2 worker. Supported recipes: a Python standard-library CLI and a plain HTML/CSS/JS static page checked in a pinned headless browser.
- **Evaluation tooling.** Study, evaluation and analysis commands (`pnpm evaluate`, `pnpm analyze`) for comparing autonomous AI, human-assisted AI and human-only workflows.
- **Windows desktop build.** A Tauri installer that bundles PostgreSQL, so testers install nothing else ([latest release](https://github.com/jordanprice040/CreatorAI/releases)).

## Tech stack

TypeScript (pnpm monorepo), React (Vite) web UI, Node.js API and CLI, PostgreSQL, Tauri desktop shell, WSL2 worker for isolated execution, Node test runner, GitHub Actions CI.

```
apps/      api, cli, desktop (Tauri), web (React)
packages/  broker, contracts, db, domain, executor, orchestrator, research
tests/     unit and integration tests
docs/      setup, product guide, capability matrix, status
```

## Run it locally

Requires Node 22 (22.23.4+) or Node 24 (24.22.2+) and pnpm 11.25.0.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open http://127.0.0.1:5273. Without `CREATOR_DATABASE_URL` set, only the stateless fixture demo runs (deterministic synthetic responses). For saved records and sign-in, point `CREATOR_DATABASE_URL` at a loopback PostgreSQL 16+ database, run `pnpm db:migrate`, start the app and use the one-time login link the API prints. Full setup: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

Run `pnpm check` for typecheck, tests and formatting. Database and isolation tests skip unless configured.

## Status and limits

- The evaluation machinery is implemented and rehearsed. The final participant study, independent ratings and empirical analysis are not finished yet, so there are no results to report here.
- Live model providers and live web research have adapters but are not activated by default setup.
- See [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md) and the [capability matrix](docs/CAPABILITY_MATRIX_2026-11-05.md) for what is verified versus implemented.

## More

- [Product guide](docs/CODE_AUDIT_AND_PRODUCT_GUIDE.md): features and usage
- [Tester guide](docs/TESTER_GUIDE.md) and [desktop studio guide](docs/DESKTOP_STUDIO.md)
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md): project intent
