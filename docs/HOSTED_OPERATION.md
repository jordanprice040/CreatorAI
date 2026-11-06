# Hosted operation and observability (X06)

Creator Agent runs locally by default, and nothing in this milestone changes that. X06 adds
an explicit **hosted** deployment mode with separate test, staging and live environments,
readiness and metrics endpoints, an operations view, environment-safe backups and restores,
cleanup, and the runbooks below.

Status: implemented and checked against local PostgreSQL with hosted processes on
loopback behind a stand-in proxy. **No hosted environment exists.** Nothing was deployed,
no DNS, certificate, managed database, identity provider or alert channel was set up, and
no live verification has been recorded. Creating any of those, and making a deployment
public, is a separate owner decision.

## Deployment modes

| Mode   | Environment               | What it requires                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local  | `local`                   | Nothing new. Loopback only, development login allowed, database on loopback.                                                                                                                                                                                                                                                                        |
| hosted | `test`, `staging`, `live` | `CREATOR_DEPLOYMENT_MODE=hosted`, `CREATOR_ENVIRONMENT`, full `CREATOR_BUILD_COMMIT`, https `CREATOR_PUBLIC_WEB_ORIGIN` (and `_API_ORIGIN` if different), a `CREATOR_PUBLIC_PREVIEW_ORIGIN` on its **own host**, an absolute `CREATOR_PRODUCTS_ROOT` on durable storage, `CREATOR_METRICS_TOKEN`, OIDC sign-in with secure cookies, and a database. |

The API refuses to start when any of these is missing or unsafe:

- a preview host equal to, a parent of, or a child of the web or API host (previews must
  never receive the studio sign-in cookie);
- a database off the machine without `sslmode=verify-full` (a remote database is refused
  entirely in local mode);
- development login, insecure cookies, or `CREATOR_WEB_ORIGIN` different from the public web
  origin.

Behind the TLS proxy the API answers only to its public API host (and loopback, for local
probes such as container health checks) and accepts browser requests only from the public web
and API origins. It may listen on `0.0.0.0` (`CREATOR_LISTEN_HOST`) only in hosted mode.

Check a configuration without starting anything:

```powershell
pnpm ops config-check
```

It prints the mode, environment, origins, a configuration hash and which secrets came from
files, never their values.

### Secrets

Any `CREATOR_*` or `OPENAI_*` variable can be given as `NAME_FILE=/path/to/file` instead (the
Docker secrets and systemd credentials convention). The file's content becomes the value;
setting both forms is refused. In hosted mode `config-check` warns about credentials set
directly in the environment. Secrets never enter the database, the configuration hash, logs
or the operations view.

### Environment separation

Each database records which environment it belongs to (migration 18,
`deployment_identity`). The API and the workflow worker claim an unlabelled database at
startup and **refuse** a database labelled for another environment, so a staging process
pointed at the live database stops before doing anything.

A restore keeps the label. To use a restored live backup for a staging drill, relabel the
copy (audited):

```powershell
pnpm ops claim-environment staging --relabel-from live
```

Relabelling anything _into_ live is refused: a live database is only ever claimed by a live
process starting against an empty or already-live database.

## Health, readiness and verification

- `GET /api/health`: liveness only (unchanged).
- `GET /api/ready`: 200 when the database is reachable, the schema is current, the database
  belongs to this environment and product storage is writable; otherwise 503. It also
  reports the environment, build commit, configuration hash, schema version, public
  origins and the **verification** state. A paired local worker being offline never makes
  the deployment unready.

Verification states:

| State        | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `unverified` | No owner-recorded verification for this environment.                                |
| `verified`   | The latest one passed and matches this exact commit, configuration hash and schema. |
| `stale`      | The latest one checked a different commit, configuration or schema.                 |
| `failed`     | The latest one for this exact build did not pass.                                   |

Nothing reports a live deployment as verified until the owner records it:

1. Run the smoke check against the declared target from any machine:
   ```powershell
   pnpm ops smoke https://studio.staging.example --environment staging --commit <sha> --out smoke.json
   ```
   It makes read-only requests only: health, response headers, readiness, environment and
   commit match, that the target is the deployment's own public API origin, that previews
   have their own host, and that the operations status refuses an unauthenticated request.
2. Signed in as the owner, `POST /api/ops/verifications` with
   `{"smoke_report": <smoke.json>}`. The server checks that the report describes this exact
   environment, commit, configuration hash and target, re-runs its own readiness checks and
   records the result (append-only, audited).
3. For **live**, a passing record also needs `"confirmation": "verify live <first 12
characters of the commit> <first 12 characters of the configuration hash>"`. The database
   refuses a passing live record without it.

## Monitoring

- `GET /api/ops/status` (owner session or scrape token): readiness detail, environment
  label, latest verification, metrics and alert states. Also in the web app under
  **Operations**.
- `GET /api/ops/metrics` (owner session or `Authorization: Bearer <CREATOR_METRICS_TOKEN>`):
  Prometheus text format, every series labelled with the environment.
- `GET /api/ops/uncertain` (owner session): every action whose outcome is unknown, oldest
  first, with the runbook section below.

The scrape token is read-only; it never authorizes a change.

Metrics cover: queue (live workflows by state, open tasks, oldest queued task, outbox
backlog), workers (workflow leases active and expired, paired local workers by availability
with last-seen times, open local jobs), budget (active global-envelope count; reserved,
unknown and incurred amounts across directly charged envelopes without allocation
transfers; overruns, in-flight and unknown reservations), index (current context
index entries and freshness, saved queries), webhooks (accepted and signature-rejected
deliveries in the last day) and uncertain outcomes per subsystem. Money is exact in the JSON
status; the Prometheus series are floats for graphs only.

Local worker availability: `online` (presence lease current), `unreachable` (active but not
reporting), `paused`, `shutdown`, `revoked` or `expired`. An unreachable worker gets no new
work and nothing is reassigned to another device.

**Alerts** are rules in `config/operations/alerts.json`, evaluated in the status response
and the Operations view. `delivery` is fixed to `none`: sending an alert anywhere outside the
deployment (email, pager, chat) is an outbound message and needs its own authorized
integration, which does not exist yet.

## Hosted-to-local pairing

A local worker on your own computer can pair with a hosted control plane. It connects
outbound only, over https with certificate verification, and must be asked to explicitly:

```powershell
$env:CREATOR_CONTROL = 'hosted'
$env:CREATOR_API_URL = 'https://studio.staging.example'
node apps/desktop/worker.mjs pair <workspace-id>
```

Pairing, presence leases, revocation and job limits are X05's, unchanged. The hosted
deployment shows the worker's availability as above.

## Backup, restore and the restore drill

`pnpm backup create` (T17) now takes the database dump inside an exported snapshot and
records, from that same snapshot, the row counts and **totals**: a fingerprint of every
lineage link (endpoints, versions, relation, retracted or not) and exact budget sums
(envelope caps and balances, journal entries, reservations and their incurred amounts).
`pnpm backup restore` then requires the restored copy to match those exactly, as well as
the existing hash, audit-chain and artifact checks. Backups from before X06 have no totals
and keep the earlier at-least row-count rule.

Restore drill for a hosted environment (run it into staging, never over live):

1. `pnpm backup create <new-folder>` against the source environment.
2. Create an empty database for the drill and an empty products folder.
3. `pnpm backup restore <folder>` with `CREATOR_DATABASE_URL` and `CREATOR_PRODUCTS_ROOT`
   pointing at them. It refuses non-empty targets, schema mismatches and any hash, count,
   lineage or budget difference.
4. If the source was live, `pnpm ops claim-environment staging --relabel-from live` on the
   restored copy.
5. Start the staging API on it and run the smoke check.

Product files are still copied after the dump; stop workers first for a clean pair (see
[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)).

## Tester accounts (ADR-0075)

A private review can let named testers sign in besides the owner. Each tester needs an account
at the deployment's OIDC provider; the operator then allow-lists that identity:

```
pnpm ops tester-add --subject <provider subject> --name "<display name>" --expires 2026-12-15T00:00:00Z [--role editor|viewer] [--issuer <url>]
pnpm ops tester-list
pnpm ops tester-extend <actor id> --expires 2027-01-15T00:00:00Z [--restore]
pnpm ops tester-reset <actor id>
pnpm ops tester-remove <actor id> --reason "Review window ended"
```

The issuer defaults to `CREATOR_OIDC_ISSUER`; the owner's subject is refused. Each tester signs
in as their own person and sees only "Sample review workspace (synthetic)", seeded from labelled
synthetic records and owned by the operations actor. Testers cannot create workspaces, change
membership, open Settings, plan connections, payments, campaigns, GitHub, portfolio scheduling,
operations or desktop pairing. An account stops working at its expiry; `tester-remove` also ends
its sessions at once. Reset retires the old workspace and seeds a fresh one; nothing is deleted,
so retired workspaces stay until a retention decision. `tester-extend` moves an account's expiry;
with `--restore` it re-enables a removed account (one identity keeps one account, so it cannot
be added again) and seeds a fresh sample. If `tester-add` reports that the account was created
but its sample was not, run `tester-reset` for that actor id. A tester's session never outlasts
the account's expiry. Inviting testers is a separate outbound
message and is not done by these commands.

Each person may have at most `CREATOR_FILE_CONCURRENT_UPLOADS` uploads in flight (default 2),
counted per API process.

## Retention and cleanup

`pnpm ops cleanup` (dry run) and `pnpm ops cleanup --apply` remove only expired sign-in
material past `config/operations/retention.json`: sessions expired or revoked over 30 days
ago and not referenced by a desktop device or pairing approval, OIDC login states over 2 days
past expiry, and pairing challenges over 7 days past expiry. An applied run is audited with
its counts. Records, audit history, budgets, artifacts and backups are never removed by it;
backup retention is your storage's policy, kept as private as the database.

## Runbooks: uncertain outcomes

The rule for all of them: **never retry an action whose outcome is unknown** until you have
established what happened. `pnpm ops uncertain` lists them.

<a id="model-call-unknown"></a>

### Model or tool call with unknown outcome (`budget_reservation`, `unknown`)

The exposure stays held against the budget. Check the provider's usage records for the
attempt's time and request id, then reconcile with evidence:
`pnpm cli reconcile <workspace> <reservation-id> '{"outcome":"no_charge","evidence":"…"}'`
(or the charged outcome with the observed amount). See
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

<a id="workflow-reconciling"></a>

### Workflow or task reconciling

A timeout or lost answer left the task without a known result. A late provider answer
completes it; otherwise reconcile the underlying reservation as above, and the task ends as
failed. It is never retried automatically.

<a id="github-unknown"></a>

### GitHub operation unknown or stuck dispatched

`pnpm cli github-reconcile <workspace> <operation-id>` reads GitHub and records
`reconciled_succeeded` or `reconciled_absent`; it never repeats the change. A process that
died mid-call leaves `dispatched`, which can be reconciled after two minutes. See
[GITHUB.md](GITHUB.md).

<a id="batch-unknown"></a>

### Batch unknown or stuck submitting

`pnpm cli context-batch-poll <workspace> <batch-id>` collects late results; items without
results stay unknown until reconciled per reservation. See
[CONTEXT_AND_CACHING.md](CONTEXT_AND_CACHING.md).

<a id="local-job-reconciling"></a>

### Local paired job reconciling

The worker stopped mid-job. Stop the old worker, check the actual local execution record on
that computer, and use the owner reconciliation in the Desktop and workers view, which binds
an observed stopped-execution hash. The job is never re-dispatched automatically. See
[apps/desktop/README.md](../apps/desktop/README.md).

## Deploying, updating and rolling back

Reviewable configuration is in `deploy/hosted/`: a Dockerfile (API, worker and migration
runner from one build, plus a static web stage), a Compose file with one stack per
environment, a Caddyfile with separate studio and preview hosts, and an example env file per
environment holding no secrets. `docker compose config` validates it; it has **not** been
built or run against real infrastructure.

Release steps for an environment:

1. `pnpm check` and `pnpm test:db` green on the exact commit.
2. Take a backup of the environment (above).
3. Set `CREATOR_BUILD_COMMIT` to that commit, run the `migrate` service, then start `api`
   and `worker`. Migrations are forward-only and applied migrations are checksum-locked.
4. Run the smoke check and, if it passes, record the verification (typed confirmation for
   live).

Dependency updates: change pinned versions in a branch, regenerate the lockfile with pnpm,
and release through the same steps, staging before live. Pins are exact (`package.json`,
`pnpm-lock.yaml`, image tags in `deploy/hosted`).

Rollback: if the release added no migration, redeploy the previous commit; its readiness
reports `stale` until re-verified. If it added a migration, an older build refuses the newer
schema at startup, so roll back by restoring the pre-release backup into a new database,
pointing the previous build at it, and re-verifying. Work recorded after the backup is in
the newer database and must be reconciled by hand.
