# Fresh local studio — October 20, 2026

Accepted first-run policy: [register #1](../tracking/OWNER_DECISIONS_2026-10-20.md) offers new/restore/connect. New devices normally start empty; Jordan may adopt this approved studio with verified backup/restore. Product archives do not restore a whole studio; no silent merge or cross-device sync.

Owner authorized a separate fresh studio after inspection found development fixture data.
The reviewed candidate is `5f7d22443e91f421197b3b0f9b1d3e623afc9edf`.

The adopted database is `creator_studio`, public schema 24, at `127.0.0.1:55433`
in the existing `creator-agent-local-db-1` Docker service. Product storage is
`C:/dev/creator_agent/.creator/studio/products`. The initial real workspace is
“Jordan’s Creator Studio”. A real workspace label does not establish live model access.

Start from PowerShell:

```powershell
cd C:\dev\creator_agent
.\scripts\start-local-studio.ps1
```

Open http://127.0.0.1:5173 and use the one-run login link printed by the API.
The launcher reads the existing ignored `.env.docker` password locally; it does not
print credentials, migrate, seed records or start Docker. Docker must already be
running. This remains a development launch; installed desktop lifecycle is §2.1.
Other terminals do not automatically inherit these connection settings.

Executed checks: direct TypeScript build, migrations 1–24 and repeat no-op,
anonymous access denial, local sign-in, real workspace creation through HTTP,
API close/restart and workspace readback, native PostgreSQL 18 backup and scratch
restore, audit chain, catalogued artifact checks, lineage and exact budget totals.
Evidence: [result](../tracking/evidence/studio-adoption/result.json).
Browser rendering and interactive sign-in were not executed in this adoption.

Private backup: `.creator/studio/backup-20261020` (database plus product-store
manifest). Restore target `creator_studio_restore_20261020` and
`.creator/studio/restore-products-20261020` are retained for inspection. No generated
packages exist in the new store, so no packages need bridge-hash revalidation.

The old `creator_dev` database remains schema 23 and the old `.creator/products`
and OneDrive checkout remain untouched. To return to them, stop the fresh studio
and use their prior connection and product-root configuration with matching code.
No data was imported, deleted or overwritten. Both databases share a Docker volume;
this is separate database storage, not independent infrastructure or an off-machine backup.

Milestone 1.2 is complete via the owner-authorized fresh-start path. Next eligible:
completion runbook §2.1, persistent desktop startup. No external integration was activated.
