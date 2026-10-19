# Local development

Current setup, October 18, 2026. Creator Agent has a local API/CLI, React studio,
PostgreSQL catalog and durable workflows. See the
[product guide](CODE_AUDIT_AND_PRODUCT_GUIDE.md) and
[build status](../tracking/BUILD_STATUS.md) for features, evidence and limitations.

## Install and start

Use pnpm 11.25.0 and Node 22.21+ within Node 22 or 24.19+ within Node 24,
as enforced in package.json.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the app](http://127.0.0.1:5173). The API is on
[port 4310](http://127.0.0.1:4310/api/health); private previews use 4320.
All bind to loopback. Ctrl+C stops development processes. Web edits hot reload;
restart after backend/contracts changes. No Docker, Temporal or provider key is
needed for the stateless fixture demo. That demo saves nothing.

## Enable saved records and sign in

Use PostgreSQL 16+ on loopback. Recorded checks include Linux PostgreSQL 16.15,
native Windows PostgreSQL 18, and optional Docker PostgreSQL 18.6. These are
historical checks, not a fresh verification of your running database. Follow
[Docker setup](DOCKER.md) for the optional existing Compose services. For an
existing local database, set its URL in the terminal starting the API:

```powershell
$env:CREATOR_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/creator_dev'
pnpm db:migrate
pnpm dev
```

Replace placeholder credentials and database. The application does not load
.env.docker automatically. Keep passwords and session files out of Git.
Migrations check the stored schema against code. Without a database, record routes
return 503 STORAGE_UNAVAILABLE and sign-in is unavailable.

Open the one-run login link printed by the API, or use `pnpm cli login <code>`.
Local development login is the default. OIDC is implemented and contract-tested
with a local identity provider; no real identity deployment is verified. The
[archived auth reference](LOCAL_DEVELOPMENT_HISTORY.md#sign-in-and-human-decisions-t03)
contains environment variables. Failed sign-out keeps the UI signed in with a
retry message until the server confirms success.

## Use the studio

```powershell
pnpm cli help
pnpm cli workspaces
pnpm cli seed-lineage
pnpm cli seed-discovery
pnpm cli seed-selection
```

Seed commands create labelled synthetic workspaces. Select one in the web UI.
Monitor, Catalog, Evidence, Search and Activity show recorded work and provenance.
Submit a theme uses claims already recorded in the workspace. Configure the run,
pricing, envelope and scoped authority before starting bounded discovery. Watch
Runs, answer covered questions in Decisions, inspect Budgets, and use Compare and
decide and Scores and specs to record a choice and freeze a plan.

The [archived milestone command reference](LOCAL_DEVELOPMENT_HISTORY.md) retains
record, grant, budget, workflow, source, discovery and selection examples. It
contains superseded status statements; use current CLI help/contracts for
arguments and replace sample IDs, dates and credentials.

## Build, package and preview

Read [isolated execution](ISOLATED_EXECUTION.md),
[bounded builder](BOUNDED_BUILDER.md), then
[artifacts and preview](ARTIFACTS_AND_PREVIEW.md). Generated code runs only through
the reviewed WSL2/Bubblewrap worker. The supported recipe is a bounded Python
standard-library CLI, not an arbitrary web or persistent application.

Gallery supports integrity inspection, source download, private preview and
feedback for the exact package. Revised specs and verified builds produce new
packages while preserving originals. Native installers and public publication
are unavailable.

## Studies and analysis

Follow [pilot and protocol](PILOT_AND_PROTOCOL.md),
[final evaluation](FINAL_EVALUATION.md) and [analysis](ANALYSIS.md). Studies exposes
synthetic records; final research is incomplete. Rehearsal/fixture output is not
empirical findings. Keep private assignment keys/raw exports out of reviewer
packets and published archives.

## Check and diagnose

```powershell
pnpm check
```

This runs TypeScript checks, tests and formatting. PostgreSQL and real-isolation
tests skip explicitly without their configuration. Follow
[disposable test setup](DOCKER.md#database-and-isolation-checks) and
[isolation instructions](ISOLATED_EXECUTION.md); never target tests at real data.
Use [backup/restore](BACKUP_AND_RESTORE.md) for saved data.

GET /api/health reports adapters, persistence and process-local maintenance:
maintenance.degraded and each job's latest success, failure and safe error code.
Jobs are outbox, broker_recovery and retrieval_recovery. Repeated identical errors
log once until recovery or a different error. Retries remain automatic; overlapping
ticks share one job. Database messages/credentials are excluded. Diagnostics reset
on API restart; durable intents/outcomes remain in PostgreSQL. Healthy maintenance
does not certify worker execution or live provider access.

The web connection check includes a degraded notice when observed. Refresh or
query health again for current diagnostics; this is not live monitoring.
Live adapters require deliberate configuration, verified pricing, authority and
funding. Installing development tools does not activate them.

## Additional implemented milestones

See [X08 campaigns](X08_MARKETING.md), [X09 portfolio](X09_PORTFOLIO.md), and [current UI](UX_UI.md). The portfolio scheduler defaults off; campaign delivery uses a fixture sink. Current build status takes precedence over historical acceptance notes.
