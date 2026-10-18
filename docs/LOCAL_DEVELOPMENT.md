# Local development — T03

Creator Agent has a local API, CLI and React page. The task demonstration still uses the **deterministic fixture provider** and is not saved. Since T02, records (sources, claims, problems, ideas, alternatives, assessments, products, specifications, runs, tasks, decisions, grants, artifacts), typed many-to-many links and an audit history persist in **PostgreSQL** when `CREATOR_DATABASE_URL` is set. Without it the app still starts, reports `persistent: false`, and record routes return `503 STORAGE_UNAVAILABLE`. Nothing here researches problems, invokes AI, builds generated products, or runs studies.

## Start

From the repository root with Node 22.21.0 (the `.node-version` baseline) or Node 24.19.0 and pnpm 11.25.0:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the local page](http://127.0.0.1:5173). The API health endpoint is [on port 4310](http://127.0.0.1:4310/api/health). `pnpm dev` builds the backend, starts both servers and prints their addresses. Ctrl+C stops them. Web edits hot reload; restart after contracts/domain/API edits. The API binds only to loopback. No provider key, Docker, or Temporal service is needed; PostgreSQL is needed only for saved records.

## Saved records (PostgreSQL)

Verified with PostgreSQL 16.15 on Linux. Any PostgreSQL 16+ on the same machine should work; a Windows installation has not been tested yet. The database must be on loopback (`127.0.0.1`, `localhost` or `[::1]`).

```powershell
# once, as the PostgreSQL superuser (choose your own local password)
psql -U postgres -c "create role creator login createdb password 'local-dev-password'"
psql -U postgres -c "create database creator_dev owner creator"

$env:CREATOR_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/creator_dev'
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` applies pending migrations under an advisory lock and refuses a database whose applied migration differs from the code. The API checks the schema at startup and serves records only when it is current; it re-checks on the next request after you migrate. In another terminal (same `CREATOR_DATABASE_URL` is not needed; the CLI talks to the API):

```powershell
pnpm cli seed-lineage          # labeled fixture workspace: two ideas → one product, one idea → two products, task → artifact
pnpm cli workspaces
pnpm cli list <workspace-id> idea
pnpm cli show <workspace-id> <record-id>
pnpm cli lineage <workspace-id> <record-id> upstream
pnpm cli history <workspace-id> [record-id]
pnpm cli create <workspace-id> idea "Shared roster" '{"summary":"One roster","uncertainty":"Untested"}'
pnpm cli revise <workspace-id> <record-id> <expected-version> "Shared roster" '{"summary":"…","uncertainty":"…"}' "Reason"
pnpm cli link <workspace-id> derived_from <product-id>@1 <idea-id>@1 "Rationale"
pnpm cli archive <workspace-id> <record-id> <expected-version> "Reason"
```

The web page shows a read-only Records panel: workspace records, each record's versions, incoming/outgoing links and history.

In a second terminal:

```powershell
pnpm cli health
pnpm cli demo use_existing "Compare a shared checklist with custom software"
pnpm cli demo change_process "Clarify responsibility for a recurring task"
pnpm cli demo failed "Show a synthetic failed attempt"
```

The CLI calls the API; it never substitutes an offline result when the API is unavailable. Failures return a nonzero exit code. Run `pnpm build` before invoking the compiled CLI directly.

Separate terminals are also supported: `pnpm dev:api` and `pnpm dev:web` after a build. Do not start these alongside `pnpm dev` on the same ports.

## Sign-in and human decisions (T03)

Records, decisions, grants and runs need an owner session (PostgreSQL required). Two sign-in modes exist:

- **Local development (default).** The API prints a one-run login link (`http://127.0.0.1:5173/#login=<code>`) and code at startup, or uses `CREATOR_DEV_LOGIN_CODE` (32+ URL-safe characters) if set. Open the link, or run `pnpm cli login <code>`. This mode fails configuration in hosted mode.
- **OIDC.** Set `CREATOR_OIDC_ISSUER`, `CREATOR_OIDC_CLIENT_ID`, optional `CREATOR_OIDC_CLIENT_SECRET`, `CREATOR_OIDC_REDIRECT_URI` (for the web page: `http://127.0.0.1:5173/api/auth/oidc/callback`) and `CREATOR_OIDC_OWNER_SUBJECT` (the `sub` claim allowed in). Authorization code + PKCE through `openid-client` 6.8.8. Plain-http issuers are accepted only on loopback. Verified only against a local test identity provider, not a real one.

Sessions are opaque tokens in an `HttpOnly; SameSite=Strict` cookie (stored hashed, 12 hours by default, `CREATOR_SESSION_HOURS`); every state-changing request must send the session's `X-CSRF-Token`, and foreign origins are refused. The CLI keeps its session in `.creator/cli-session.json` (git-ignored; override with `CREATOR_SESSION_FILE`).

```powershell
pnpm cli login <code>
pnpm cli run-register <workspace> <run-id>@1 supervised     # or human_in_loop, autonomous_within_scope [grant-id@version ...], human_only
pnpm cli grant-create <workspace> '{"run_id":null,"action_types":["record.revise"],"target_kind":null,"max_amount_nano_usd":null,"allow_irreversible":false,"allow_external_effects":false,"data_classes":["synthetic"],"expires_at":"2026-11-01T00:00:00Z","rationale":"Routine edits"}'
pnpm cli admit <workspace> <run-id> '<action-json>'           # allow / request_human / deny / defer, recorded
pnpm cli decisions <workspace> pending
pnpm cli decision <workspace> <decision-id>                   # shows exactly what it covers and its coverage_hash
pnpm cli answer <workspace> <decision-id> <coverage-hash> approve_once "Reason"
pnpm cli answer <workspace> <decision-id> <coverage-hash> choose_option proceed "Reason"
pnpm cli run-cancel <workspace> <run-id> "Reason"
pnpm cli humility-gate <workspace> <review-id>
```

The web page shows the same decisions in a Human decisions panel: the concise request, what an approval covers (action, target version, content/spec hash, amount, expiry), approve once versus a previewed standing policy, option answers for judgment questions, standing policies with Revoke, and runs with Stop.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm format:check
pnpm smoke
```

`pnpm check` combines type checks, tests and formatting. Without `CREATOR_TEST_DATABASE_URL`, the PostgreSQL suites are reported as **skipped** with that reason. `pnpm test:db` refuses to start without it, so run it to exercise the storage gate:

```powershell
$env:CREATOR_TEST_DATABASE_URL = 'postgresql://creator:local-dev-password@127.0.0.1:5432/postgres'
pnpm test:db
```

Each storage test creates, migrates and force-drops its own `creator_test_*` database, so the role needs `CREATEDB`. Point it at a local development server, never at a database whose contents matter. `pnpm format` formats only application/tooling/docs paths, preserving original kit documents. `pnpm smoke` builds and starts temporary API/Vite-preview servers, checks the built page and its API proxy, then closes them. Stop `pnpm dev` first, or choose unused ports. Unit/HTTP/CLI tests use ephemeral API ports and may run while the demo is open. Browser verification is recorded separately from HTTP smoke checks.

Restricted runners may require permission for dependency-cache symlinks and loopback sockets. A sandbox `EACCES` connecting to localhost is not a successful HTTP check. No credentials or broader access are a fallback.

## Configuration

Environment variables are read explicitly; no `.env` loader is installed.

| Variable                    | Default / accepted value                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `CREATOR_HOST`              | `127.0.0.1` only                                                                               |
| `CREATOR_API_PORT`          | `4310`; integer 1024–65535                                                                     |
| `CREATOR_WEB_PORT`          | `5173`; integer 1024–65535, different from API port                                            |
| `CREATOR_DEPLOYMENT_MODE`   | `local` only                                                                                   |
| `CREATOR_DATA_MODE`         | `fixture` only                                                                                 |
| `CREATOR_PROVIDER`          | `fixture` only                                                                                 |
| `CREATOR_LIVE_ENABLED`      | `false` only                                                                                   |
| `CREATOR_API_URL`           | CLI only; default `http://127.0.0.1:4310`; loopback HTTP origin without credentials/path/query |
| `CREATOR_DATABASE_URL`      | Unset (no persistence) or a loopback `postgresql://` URL; never logged                         |
| `CREATOR_OWNER_ACTOR_ID`    | UUID the local API acts as; default `00000000-0000-4000-8000-000000000001`                     |
| `CREATOR_TEST_DATABASE_URL` | Tests only; loopback server where the role may create databases                                |

For example, set `$env:CREATOR_API_PORT = '4311'` and `$env:CREATOR_WEB_PORT = '5174'` before `pnpm dev`. Set `$env:CREATOR_API_URL = 'http://127.0.0.1:4311'` in the CLI terminal. Invalid settings fail startup. There is no live-provider switch; live admission is denied even for structurally complete live configs. Provider availability remains unverified in `config/provider-availability.json`.

## Actual paths and boundaries

| Path                      | Responsibility                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/` | Strict Zod schemas, inferred types, schema 1.0 and stable error codes                                                             |
| `packages/domain/src/`    | Pure admission prerequisites, delegation containment, version/evidence-bound transitions, result checks and deterministic fixture |
| `packages/db/src/`        | PostgreSQL migrations, schema gate, record/link repository, audit hash chain, outbox relay and history projection                 |
| `apps/api/src/`           | Node HTTP routes, configuration, size/Host/origin checks and errors                                                               |
| `apps/cli/src/`           | HTTP client and response validation                                                                                               |
| `apps/web/src/`           | React form, actual API health, explicit synthetic outcomes, accessible error/empty states                                         |
| `tests/src/`              | Contract, domain, real HTTP and compiled CLI checks                                                                               |
| `scripts/`                | Local combined startup and built-page proxy smoke                                                                                 |

GET `/api/health` reports fixture provider status plus `persistent` and `storage` (`postgresql`, `not_configured`, `unavailable`).

Record routes, all under `/api/workspaces`: `GET`/`POST /api/workspaces`; `GET`/`POST …/{ws}/entities` (`?kind=&status=`); `GET …/{ws}/entities/{id}` (current record, every version, incoming and outgoing links); `POST …/entities/{id}/revisions` (`expected_version`, `title`, `body`, `reason`, `corrects_version`); `POST …/entities/{id}/archive`; `POST …/entities/{id}/redact` (owner only); `GET …/entities/{id}/lineage?direction=upstream|downstream`; `POST …/{ws}/links` (`relation`, `from: {id, version}`, `to: {id, version}`, `rationale`); `POST …/links/{id}/retract`; `GET …/{ws}/history?subject=`. Optional headers: `Idempotency-Key` (replays one create/link, 409 if reused for a different request), `X-Correlation-Id` and `X-Causation-Id` (UUIDs recorded on audit events). Stale `expected_version` returns `409 VERSION_CONFLICT`; a link across workspaces returns `403 SCOPE_EXCEEDED`; unknown or non-member workspaces return 404.

The API acts as one configured local owner. There is **no authentication yet** (T03); the loopback Host/Origin checks are the only boundary. The repository still enforces membership and roles for every call, which tests exercise with several actors. POST `/api/fixture` accepts `{ "goal": "Synthetic task", "outcome": "use_existing" }`. Other outcomes: `build`, `change_process`, `human_led`, `hybrid`, `investigate`, `defer`, `decline`, `failed`.

POST `/api/validate` accepts `{ "kind": "task", "value": { ... } }`; kinds are `task`, `result`, `run_config`, `source`, `claim`, `alternative`, `assumption`, `decision`, `cost`, `link`, `assignment`. This checks structure, not authority or evidentiary truth. Errors return `{ "error": { "code", "message", "details" } }`. Requests are limited to 64 KiB and JSON content type. Unknown fields/schema versions fail.

The fixture uses deterministic IDs/hashes and a synthetic 2099 deadline, not an operating grant. Simulated lifecycle evidence has `fixture: true`; it never stands in for executed product tests. Same input produces the same result, fixture runs are not saved, and reload clears that view. Money serializes as integer decimal strings in nano-USD; unknown exposure remains a distinct tagged value.

Delegation checks a proposed complete sibling allocation, including exact aggregate cost/calls/tokens and scope containment. It does not schedule children or atomically reserve resources. Transition functions require trusted current state and trusted evidence supplied by the application; schemas do not authenticate actors or establish that a source/check is true. There is no endpoint accepting arbitrary lifecycle advancement. Persistence now exists (T02); authorization, budgets, orchestration and review remain T03–T05/T12 work. Product stage and run/task state are stored at their initial values and generic revisions cannot change them; only domain transitions will.

## Dependency sources

Consulted October 17, 2026; exact direct pins and transitive integrity are in the manifests/lockfile. Selected TypeScript 5.9.3 deliberately rather than the registry's newer major. Runtime dependencies: Zod 4.6.7, React/React DOM 19.3.1; Vite 8.3.4, Prettier 3.9.10 and types are build tooling.

- [pnpm workspaces](https://pnpm.io/workspaces) and [settings](https://pnpm.io/settings): explicit workspace dependencies and engine settings.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html): strict compile checks, plus unchecked-index and exact-optional checks in this project.
- [Zod API](https://zod.dev/api) and [basic parsing](https://zod.dev/basics): strict objects, refinements and safeParse.
- [Vite guide](https://vite.dev/guide/) and [server options](https://vite.dev/config/server-options): build, loopback host, strict ports and API proxy. Current Vite documents Node 20.19+ or 22.12+ compatibility; this project's tested baselines are narrower.
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot): browser mounting.
- [Node 22.21 test runner](https://nodejs.org/download/release/v22.21.0/docs/api/test.html) and [HTTP](https://nodejs.org/download/release/v22.21.0/docs/api/http.html): actual installed baseline APIs.
- [Prettier CLI](https://prettier.io/docs/cli): write/check formatting.

T02 adds `pg` 8.23.1 (node-postgres; runtime) and `@types/pg` 8.23.1. Consulted October 18, 2026: [node-postgres transactions](https://node-postgres.com/features/transactions) (every statement of a transaction on one checked-out client, never `pool.query`) and [pooling](https://node-postgres.com/features/pooling) (always release clients; handle idle-client `error` events). PostgreSQL features used (advisory locks, `FOR UPDATE SKIP LOCKED`, PL/pgSQL triggers, composite foreign keys, partial unique indexes) were verified by the executed test suite against PostgreSQL 16.15, not by a separate documentation review.

No provider SDK was added. No CI run, hosted deployment or real research capability is implied by local checks.
