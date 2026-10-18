# Docker for local PostgreSQL

Docker Desktop is an optional database backend for the studio. The Node API,
React development server and CLI stay on the host, preserving their existing
loopback authentication boundary. Generated products still run through the
reviewed WSL2/Bubblewrap worker described in [isolated execution](ISOLATED_EXECUTION.md).
This Compose stack is not a generated-code sandbox or a public deployment.

## Start on Windows

Docker Desktop must be running with Linux containers. In a new terminal `docker`
should be available. If this Codex session predates installation, temporarily add
the installed CLI and its credential helper to this terminal's PATH:

```powershell
$env:PATH = "$env:LOCALAPPDATA/Programs/DockerDesktop/resources/bin;$env:PATH"
docker version
docker compose version
```

On a system-wide installation, use `C:/Program Files/Docker/Docker/resources/bin`
instead. No Docker MCP tool was exposed in the verification chat; these checks
exercise the actual CLI and daemon, independently of the connection selector.

From the repository root, generate a local password once. `.env.docker` is ignored
by Git. Preserve it: changing this file does not change an initialized database's
password. Do not replace an existing file or publish it.

```powershell
if (Test-Path .env.docker) { throw 'Use the existing .env.docker' }
$dockerPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path (Get-Location) '.env.docker'), "CREATOR_DOCKER_PASSWORD=$dockerPassword`n")
```

For this checkout the file was already generated during verification. Start the
development database and configure the application in the same terminal:

```powershell
docker compose --env-file .env.docker up -d --wait db
$env:CREATOR_DOCKER_PASSWORD = (Get-Content .env.docker -Raw).Trim().Substring('CREATOR_DOCKER_PASSWORD='.Length)
$env:CREATOR_DATABASE_URL = "postgresql://creator:$env:CREATOR_DOCKER_PASSWORD@127.0.0.1:55433/creator_dev"
pnpm db:migrate
pnpm dev
```

Compose reads the password file; the application does not automatically load it.
Set the application URL in each new terminal. These databases are new and
independent of any existing Windows PostgreSQL installation; no existing records
are imported or switched automatically. Port conflicts fail instead of selecting
another database. `POSTGRES_USER=creator` is a local development superuser; it is
not a production application role. Never reuse this password for another service.

## Database and isolation checks

The test profile uses its own container and named volume on port 55434. Tests
create and drop uniquely named databases there; never point this URL at real data.

```powershell
docker compose --env-file .env.docker --profile test up -d --wait db-test
$env:CREATOR_TEST_DATABASE_URL = "postgresql://creator:$env:CREATOR_DOCKER_PASSWORD@127.0.0.1:55434/postgres"
$env:CREATOR_TEST_ISOLATION = 'wsl2'
pnpm test:db
docker compose --env-file .env.docker --profile test stop db-test
```

The real isolation gate also requires the reviewed Ubuntu WSL environment.
Without `CREATOR_TEST_ISOLATION=wsl2`, those tests explicitly skip; a Docker
database alone does not establish generated-code isolation.

## Storage and shutdown

```powershell
docker compose --env-file .env.docker --profile test ps
docker compose --env-file .env.docker stop db
docker compose --env-file .env.docker --profile test down
```

Stopping/removing containers retains both named volumes. Do not use `down -v`
unless deliberately deleting these databases. No automatic restart is configured.
Each service has a two-CPU, 1 GiB memory and 256-process limit, 128 MiB shared
memory and rotated logs. Database storage is persistent and has no per-volume
quota; monitor Docker disk usage. Both published ports bind only to 127.0.0.1.
There are no host-directory, personal-file or Docker-socket mounts. The Docker
management connection remains outside generated products.

The official PostgreSQL 18.6 Bookworm image is pinned by registry digest in
[compose.yaml](../compose.yaml). Updating it is an explicit dependency change;
back up real data and reverify migrations/tests first. PostgreSQL 18 stores its
versioned data below `/var/lib/postgresql`, which is the mounted volume target.

References checked October 18, 2026:
[official PostgreSQL image](https://github.com/docker-library/docs/blob/master/postgres/README.md),
[Compose service configuration](https://docs.docker.com/reference/compose-file/services/),
[Compose networking](https://docs.docker.com/compose/how-tos/networking/).
