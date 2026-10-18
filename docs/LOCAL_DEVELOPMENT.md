# Local development — T01

Creator Agent currently has a **fixture-only**, stateless API, CLI and React page. It demonstrates executable contracts and deterministic domain rules. It does not research problems, invoke AI, persist records, build generated products, or run studies.

## Start

From the repository root with Node 22.21.0 (the `.node-version` baseline) or Node 24.19.0 and pnpm 11.25.0:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open [the local page](http://127.0.0.1:5173). The API health endpoint is [on port 4310](http://127.0.0.1:4310/api/health). `pnpm dev` builds the backend, starts both servers and prints their addresses. Ctrl+C stops them. Web edits hot reload; restart after contracts/domain/API edits. The API binds only to loopback. No database, provider key, Docker, or Temporal service is needed.

In a second terminal:

```powershell
pnpm cli health
pnpm cli demo use_existing "Compare a shared checklist with custom software"
pnpm cli demo change_process "Clarify responsibility for a recurring task"
pnpm cli demo failed "Show a synthetic failed attempt"
```

The CLI calls the API; it never substitutes an offline result when the API is unavailable. Failures return a nonzero exit code. Run `pnpm build` before invoking the compiled CLI directly.

Separate terminals are also supported: `pnpm dev:api` and `pnpm dev:web` after a build. Do not start these alongside `pnpm dev` on the same ports.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm format:check
pnpm smoke
```

`pnpm check` combines type checks, tests and formatting. `pnpm format` formats only application/tooling/docs paths, preserving original kit documents. `pnpm smoke` builds and starts temporary API/Vite-preview servers, checks the built page and its API proxy, then closes them. Stop `pnpm dev` first, or choose unused ports. Unit/HTTP/CLI tests use ephemeral API ports and may run while the demo is open. Browser verification is recorded separately from HTTP smoke checks.

Restricted runners may require permission for dependency-cache symlinks and loopback sockets. A sandbox `EACCES` connecting to localhost is not a successful HTTP check. No credentials or broader access are a fallback.

## Configuration

Environment variables are read explicitly; no `.env` loader is installed.

| Variable                  | Default / accepted value                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `CREATOR_HOST`            | `127.0.0.1` only                                                                               |
| `CREATOR_API_PORT`        | `4310`; integer 1024–65535                                                                     |
| `CREATOR_WEB_PORT`        | `5173`; integer 1024–65535, different from API port                                            |
| `CREATOR_DEPLOYMENT_MODE` | `local` only                                                                                   |
| `CREATOR_DATA_MODE`       | `fixture` only                                                                                 |
| `CREATOR_PROVIDER`        | `fixture` only                                                                                 |
| `CREATOR_LIVE_ENABLED`    | `false` only                                                                                   |
| `CREATOR_API_URL`         | CLI only; default `http://127.0.0.1:4310`; loopback HTTP origin without credentials/path/query |

For example, set `$env:CREATOR_API_PORT = '4311'` and `$env:CREATOR_WEB_PORT = '5174'` before `pnpm dev`. Set `$env:CREATOR_API_URL = 'http://127.0.0.1:4311'` in the CLI terminal. Invalid settings fail startup. There is no live-provider switch; live admission is denied even for structurally complete live configs. Provider availability remains unverified in `config/provider-availability.json`.

## Actual paths and boundaries

| Path                      | Responsibility                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/` | Strict Zod schemas, inferred types, schema 1.0 and stable error codes                                                             |
| `packages/domain/src/`    | Pure admission prerequisites, delegation containment, version/evidence-bound transitions, result checks and deterministic fixture |
| `apps/api/src/`           | Node HTTP routes, configuration, size/Host/origin checks and errors                                                               |
| `apps/cli/src/`           | HTTP client and response validation                                                                                               |
| `apps/web/src/`           | React form, actual API health, explicit synthetic outcomes, accessible error/empty states                                         |
| `tests/src/`              | Contract, domain, real HTTP and compiled CLI checks                                                                               |
| `scripts/`                | Local combined startup and built-page proxy smoke                                                                                 |

GET `/api/health` reports fixture/nonpersistent status. POST `/api/fixture` accepts `{ "goal": "Synthetic task", "outcome": "use_existing" }`. Other outcomes: `build`, `change_process`, `human_led`, `hybrid`, `investigate`, `defer`, `decline`, `failed`.

POST `/api/validate` accepts `{ "kind": "task", "value": { ... } }`; kinds are `task`, `result`, `run_config`, `source`, `claim`, `alternative`, `assumption`, `decision`, `cost`, `link`, `assignment`. This checks structure, not authority or evidentiary truth. Errors return `{ "error": { "code", "message", "details" } }`. Requests are limited to 64 KiB and JSON content type. Unknown fields/schema versions fail.

The fixture uses deterministic IDs/hashes and a synthetic 2099 deadline, not an operating grant. Simulated lifecycle evidence has `fixture: true`; it never stands in for executed product tests. Same input produces the same result, no history is retained, and reload clears the view. Money serializes as integer decimal strings in nano-USD; unknown exposure remains a distinct tagged value.

Delegation checks a proposed complete sibling allocation, including exact aggregate cost/calls/tokens and scope containment. It does not schedule children or atomically reserve resources. Transition functions require trusted current state and trusted evidence supplied by the application; schemas do not authenticate actors or establish that a source/check is true. There is no endpoint accepting arbitrary lifecycle advancement. Those persistence/authorization/broker/review capabilities remain T02–T05/T12 work.

## Dependency sources

Consulted October 17, 2026; exact direct pins and transitive integrity are in the manifests/lockfile. Selected TypeScript 5.9.3 deliberately rather than the registry's newer major. Runtime dependencies: Zod 4.6.7, React/React DOM 19.3.1; Vite 8.3.4, Prettier 3.9.10 and types are build tooling.

- [pnpm workspaces](https://pnpm.io/workspaces) and [settings](https://pnpm.io/settings): explicit workspace dependencies and engine settings.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html): strict compile checks, plus unchecked-index and exact-optional checks in this project.
- [Zod API](https://zod.dev/api) and [basic parsing](https://zod.dev/basics): strict objects, refinements and safeParse.
- [Vite guide](https://vite.dev/guide/) and [server options](https://vite.dev/config/server-options): build, loopback host, strict ports and API proxy. Current Vite documents Node 20.19+ or 22.12+ compatibility; this project's tested baselines are narrower.
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot): browser mounting.
- [Node 22.21 test runner](https://nodejs.org/download/release/v22.21.0/docs/api/test.html) and [HTTP](https://nodejs.org/download/release/v22.21.0/docs/api/http.html): actual installed baseline APIs.
- [Prettier CLI](https://prettier.io/docs/cli): write/check formatting.

No provider SDK was added. No CI run, hosted deployment, persistence or real research capability is implied by local checks.
