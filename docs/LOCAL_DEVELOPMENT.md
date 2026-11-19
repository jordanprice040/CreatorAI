# Local development

Current source setup, November 4, 2026. Creator Agent has a local API/CLI, React studio,
PostgreSQL catalog and durable workflows. See the
[product guide](CODE_AUDIT_AND_PRODUCT_GUIDE.md) and
[build status](../tracking/BUILD_STATUS.md) for features, evidence and limitations.

## Install and start

Use pnpm 11.25.0 and Node 22.23.4+ within Node 22 or 24.22.2+ within Node 24,
as enforced in package.json.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the app](http://127.0.0.1:5273). The API is on
[port 4410](http://127.0.0.1:4410/api/health); private previews use 4420.
All bind to loopback. These development ports differ from the installed desktop
app's 5173/4310/4320 (ADR-0108), so a dev studio and the installed app can run
side by side. In one browser they share a sign-in slot: the session cookie is
kept per host (127.0.0.1), not per port, so signing in to one studio there signs
you out of the other (no access crosses between their databases). The installed
app's window has its own browser profile and is not affected. Two studios on the
same database are refused, whatever their ports.

If another program holds one of the default development ports, `pnpm dev` names
it (for example `Port 4410 is already in use by node.exe (process 1234).`) and
moves that piece to the next free port for this run, printing the new address.
It never moves when you set the port yourself (`CREATOR_WEB_PORT`,
`CREATOR_API_PORT`, `CREATOR_PREVIEW_PORT`), with OIDC sign-in (its redirect
address is fixed), or with `CREATOR_PORT_FALLBACK=off` (also `false`, `0` or `no`). If another Creator Agent
studio already answers there, it stops instead of starting a second studio on the
same database. Browser settings saved for one address do not carry over to
another, and `pnpm cli` needs `CREATOR_API_URL` when the API moved (the printed
login command includes it). With a database configured, `pnpm dev` and `pnpm dev:api`
refuse to start while another studio uses that database, and stop if the
database cannot be reached. After a database restart a running studio takes its
claim again; if another studio started on that database meanwhile, it stops. `pnpm dev:api`
on its own never moves (`dev:web` would not follow); it names the holder. Ctrl+C stops development processes. Web edits hot reload;
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

Settings › Backups (ADR-0123) needs `pg_dump` and `pg_restore` at least as new as
the server: set `CREATOR_PG_BIN` to their folder when they are not on `PATH` (for
example `$env:CREATOR_PG_BIN = 'C:\pgsql18\pgsql\bin'`), or the daily backup fails.
`CREATOR_BACKUPS_DIR` sets the starting backups folder (default `.creator/backups`).

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
`seed-discovery` and `seed-selection` take an optional workspace name, for example
`pnpm cli seed-selection "Demo workspace"` (quote a name with spaces; extra words are
refused). Without one they use their default names.
The studio has six pages. It opens on **Chat**: ask "what's next?" or "why is it
blocked?", paste a web address, or "save this idea: …". Conversations are saved per
workspace; studio replies come from your records by fixed rules, and their buttons only
open a tab or fill in a field there. Open questions are answered by a model only when the
owner has turned on Chat answers for a connected plan (Models and connections), and those
replies are labelled as unchecked model answers. The other pages have tabs:
**Projects** (Path, Discover, Decide,
Proposals, Scores and specs, Build, Try, Launch), **Sources** (sources and claims, Library,
Files, Search), **Monitor** (Overview, Approvals, Runs, Activity, Budgets, Workers),
**Models and connections** (Models, GitHub, Devices) and **Settings**. Projects ›
Path shows which step of the main path is next or blocked, and why. Discover uses
claims already recorded in the workspace. Configure the run, pricing, envelope and
scoped authority before starting bounded discovery. Discover shows one way to start at a
time and lists each discovery's progress and next step (Decide shows it too); answer
covered questions under Monitor › Approvals, and use Decide and Scores and specs to
record a choice and freeze a plan. Addresses from before the page map (`#/runs?ws=…`)
still open the same screen. Each person chooses Standard (the default) or Advanced at the
foot of the page list or on Settings, and the choice is saved for them on the server
(ADR-0082). Standard folds routine fields behind their defaults, shows "What will happen"
before each start, and leaves Launch, Runs, Library, Workers and Study (and Discover's theme
draft) out of the tab rows (their addresses
still open); Advanced opens every field and lists every tab. A new workspace shows a
"Getting started" path on Chat and Path.

The [archived milestone command reference](LOCAL_DEVELOPMENT_HISTORY.md) retains
record, grant, budget, workflow, source, discovery and selection examples. It
contains superseded status statements; use current CLI help/contracts for
arguments and replace sample IDs, dates and credentials.

## Build, package and preview

Read [isolated execution](ISOLATED_EXECUTION.md),
[bounded builder](BOUNDED_BUILDER.md), then
[artifacts and preview](ARTIFACTS_AND_PREVIEW.md). Generated code runs only through
the reviewed WSL2/Bubblewrap worker. The supported recipes are a bounded Python
standard-library CLI and [`static-web/1`](STATIC_WEB_RECIPE.md) (a small plain HTML, CSS and
JavaScript page), not an arbitrary web or persistent application.

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

## Development safety and historical replay

On Windows, the synthetic Claude CLI fixture uses the built-in .NET Framework 4 C#
compiler to create a native test launcher; this is a development-test requirement,
not a dependency of the installed studio or the production Claude adapter.

The normal `pnpm test` route includes `pnpm test:dev-safety`: retention, current portable/native
upgrade guards, runtime floors and startup configuration messages. Windows CI also runs the
PostgreSQL contracts; real WSL/native acceptance remains an explicit gate.

Frozen v4 helper tests retain their original bytes. `pnpm test:historical-upgrade` is an
explicit replay gate for its original checkout/package, not a current-branch acceptance gate.
Current guard tests exercise the actual guard code separately from the earlier candidate's
package preflight, so an unrelated hash refusal cannot stand in for the approval-switch check.
