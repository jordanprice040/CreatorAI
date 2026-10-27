# Installed desktop studio (§2.1)

Owner update after implementation: [register #1–#3](../tracking/OWNER_DECISIONS_2026-10-20.md) settles new/restore/connect and configurable close-to-tray as the target default, first-close explanation, explicit Quit and login startup off/opt-in. Since October 27, 2026 setup recommends and preselects a new, empty studio and preselects Keep running in the background (existing installs keep their saved choice). An upgrade keeps an install's saved choice, so the installed studio (set up with `quit`) still quits on close after step 7 unless Jordan switches it in the status window. Restoring a studio backup from setup is not built yet. Historical evidence below predates these defaults.

October 20, 2026. Design: ADR-0041 in `tracking/DECISIONS.md`. Evidence:
`tracking/evidence/desktop-2-1/`.

## What the installed app does

`Creator Agent` installs per user (NSIS, no administrator rights, no service, no
scheduled task). Launching it from Start:

1. Opens a small **status and settings** window (bundled page, the only window with
   native commands).
2. Starts the app's own PostgreSQL cluster (managed mode) or checks the configured
   existing server (external mode, never started or stopped by the app).
3. Starts one bundled Node service that serves the production UI (5173), the API with
   its in-process workflow worker (4310) and private previews (4320), all on 127.0.0.1.
4. Proves each port belongs to this launch (HMAC over a fresh nonce with a per-launch
   secret) and only then opens the studio window. A development server or any other
   program on those ports is reported, never shown.

No terminal, pnpm, development server or source checkout is used at launch. A developer
shell's `CREATOR_*`, `OPENAI_*` or proxy variables do not reach the service (the child gets
a minimal environment), so no live provider can be switched on by accident.

## Data

Per-user home: `%LOCALAPPDATA%\com.creatoragent.studio` (outside the repository; OneDrive
locations are refused). `CREATOR_STUDIO_HOME` overrides it for acceptance runs only.

| Path              | Contents                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `studio.json`     | non-secret settings and how the records got here (adoption evidence)         |
| `EBWebView\`      | the windows' WebView2 data (cookies, storage); follows `CREATOR_STUDIO_HOME` |
| `secrets\*.dpapi` | database password/URL and the persisted sign-in, Windows DPAPI (CurrentUser) |
| `postgres\data`   | app-managed PostgreSQL 18 cluster (managed mode)                             |
| `products\`       | generated product store                                                      |
| `backups\`        | adoption and pre-upgrade backups                                             |
| `logs\`           | `supervisor.log`, `service.log`, `postgres.log`                              |

## First run

The setup window asks for:

1. **PostgreSQL 18 folder.** A managed prerequisite: the app uses PostgreSQL 18 that is
   already installed (detected at `C:\pgsql18\pgsql\bin` and
   `C:\Program Files\PostgreSQL\18\bin`; version checked). It downloads nothing.
2. **Where records come from.**
   - _Start a new, empty studio (recommended on a new computer, preselected):_ nothing is imported.
   - _Adopt an existing studio on this computer:_ prefilled with the §1.2 studio
     (`creator_studio` on 127.0.0.1:55433, password read from the named line of
     `C:\dev\creator_agent\.env.docker`, products from `.creator\studio\products`).
     "Check this studio" shows its workspaces read-only. Adoption takes a T17 backup,
     restores it into the app's cluster and product folder, and requires the restore
     check (schema, audit chain, artifacts, lineage, exact budget totals) before saving
     anything. The source database and files are only read.
   - _Keep using an existing database server directly:_ external mode; you start it yourself.
3. **Close behavior and login start.** Defaults: closing keeps the studio running in the
   background with a tray icon (owner decision #2; the first close each launch explains
   it); login start off (#3).

A failed setup removes only what it created and saves nothing.

## Everyday use

- **Sign in:** _Creator Agent → Sign in as local owner_ (window menu) or the status
  window. The app holds a random per-launch code that is never displayed; the resulting
  session is stored DPAPI-protected and revalidated at each launch. It lasts until it
  expires (12 h default) or you choose _Sign out on this computer_, which revokes it on the
  server. Signing out in the web UI also revokes it; the next launch deletes the stale copy.
- **Close:** with _Quit_ the studio, workflow worker, previews and the app's database
  stop. Workflows keep their saved state and continue next launch. A separately paired
  execution worker keeps running but gets no new work. With _Keep running in the
  background_ the window hides, a tray icon stays and workflows continue.
- **Quit:** tray icon, _Creator Agent → Quit_, or the status window.
- **Upgrades:** if a new app version needs a newer database layout, the status window
  asks first, then saves a pre-upgrade backup and migrates under the existing lock.

## Failure handling

| Situation                                  | Behavior                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Port 5173/4310/4320 in use                 | Status window names the port; Retry                                                         |
| Database unreachable (external)            | Message with how to start it; retries every 15 s                                            |
| PostgreSQL folder missing                  | Actionable failure naming the missing tool                                                  |
| Service crash                              | Restarted up to 3 times in 10 minutes (1/4/15 s backoff), then paused with Retry            |
| Service stops answering (e.g. after sleep) | 3 failed health checks restart it within the same bounds                                    |
| App crash                                  | Job object stops the service; the app's database keeps running and is reused at next launch |
| Second launch                              | Brings the running studio forward and exits                                                 |
| Uncertain external outcomes                | Unchanged: existing reconciliation; nothing is re-sent automatically                        |

## Building the installer

```powershell
node apps/desktop/build-studio.mjs
cd apps/desktop
node node_modules/@tauri-apps/cli/tauri.js build --config src-tauri/tauri.local-bundle.conf.json --bundles nsis
```

`build-studio.mjs` compiles, builds the UI, bundles the service into one file and stages
`node.exe` (the build host's Node), the executor bridge, `config/` and the UI with a hash
manifest (`bundle-manifest.json`, including the source commit and whether it was dirty).
The installer is unsigned; it is a local review artifact, not a public release.

Checks: `node --test tests/dist/studio-service.test.js` (set `CREATOR_TEST_DATABASE_URL`,
`CREATOR_PG_BIN`; `CREATOR_TEST_STUDIO_BUNDLE` runs it against an installed bundle),
`cargo test` in `apps/desktop/src-tauri`, and the scripted installed-app run
`node apps/desktop/studio-acceptance.mjs --pg-bin C:\pgsql18\pgsql\bin [--adopt-env <file>]`.

## Not covered

- Persistent identity for the separately paired execution worker (ADR-0028 still holds:
  re-pair after restart).
- Bundling PostgreSQL itself; OIDC sign-in inside the installed app; code signing and
  updates; other Windows machines or architectures.
