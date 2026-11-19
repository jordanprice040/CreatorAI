# Installed desktop studio (§2.1)

Owner update after implementation: [register #1–#3](../tracking/OWNER_DECISIONS_2026-10-20.md) settles new/restore/connect and configurable close-to-tray as the target default, first-close explanation, explicit Quit and login startup off/opt-in. Since October 27, 2026 setup recommends (on a new computer) and preselects a new, empty studio and preselects Keep running in the background (existing installs keep their saved choice). An upgrade keeps an install's saved choice, so the installed studio (set up with `quit`) still quits on close after step 7 unless Jordan switches it in the status window. Restoring a studio backup from setup is not built yet. Historical evidence below predates these defaults.

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
   program on those ports is reported, never shown. These ports are fixed and never
   fall back (ADR-0108): the window's origin, its session cookie and saved settings,
   and the shell's navigation checks are bound to them. Development runs default to
   5273/4410/4420 instead, so they no longer hold these ports.

Building and packaging products (ADR-0046, the Build and package page) also needs Git for
Windows: the app passes its resolved `git.exe` to the service as `CREATOR_GIT` (found on
the app's PATH or in the usual install folders); without it a build says Git is missing.
Generated code still runs only in the WSL worker.

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
| `updates\`        | update settings, downloads, the saved copy for rollback, `history.jsonl`     |
| `products-rb-*\`  | product folder restored by an update rollback (with database `<name>_rb_*`)  |
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
     Upgrades and updates rehearse on a copy and a rollback restores into a new database, so
     the database user needs permission to create databases: `ALTER ROLE <user> CREATEDB;`.
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
- **Windows notifications (N3, ADR-0131):** while you are signed in on this computer and
  the studio window is minimised or in the tray, an alert that would interrupt you appears
  as one Windows notification (title and one short line, or only "Creator Agent needs you"
  with _Hide details on Windows_). Clicking it opens the studio window at the place to act
  and marks the alert read. While the window is visible you get the in-app toast instead;
  the app shows a Windows notification only if the page has not shown a new alert within
  90 seconds. You never get both. Nothing is delivered while the app has quit; on the next
  start, one summary ("Missed alerts: …") names what still needs you. The app polls every 30 seconds with its
  own stored sign-in, and claims nothing while Windows has its notifications turned off
  (Settings › Notifications in the studio says which). Focus Assist can still hide them.
  A copy started with `cargo run` has no registered app identity and shows none.
- **Upgrades:** if a new app version needs a newer database layout, the status window
  asks first, then saves a pre-upgrade backup, rehearses the upgrade on a throwaway copy of the
  database (ADR-0128) and only then migrates under the existing lock. In external mode the
  database user needs `CREATEDB` for the copy (`ALTER ROLE <user> CREATEDB;`).
- **Updates (F4, ADR-0128):** see [In-app updates](#in-app-updates).

## In-app updates

The status window's **Updates** section installs new versions from a private GitHub repository's
releases. Set it up once: the repository (`owner/name`) and a fine-grained GitHub token
(`github_pat_…`) with read-only access to that repository's contents (stored with Windows
protection, never shown again). A classic token (`ghp_…`) or an OAuth token (`gho_…`) is refused:
it cannot be limited to one repository. One saved before this check keeps working until replaced.
Nothing is checked until both are saved; checking at each start is opt-in.

1. **Check for updates** reads the latest release and its `creator-agent-update.json`. It is refused
   if the manifest, the release tag, the installer's size or GitHub's own digest disagree.
2. **Download** saves the installer and keeps it only if its size and SHA-256 match the manifest.
   Whether a release is newer is always judged against the version running now, so after an
   update the status window no longer offers the version just installed.
3. **Back up and install** (one confirmation) saves a verified backup, keeps a copy of this version,
   quits, installs the update silently and starts the new version. A database upgrade the new
   version needs runs without asking again, rehearsed on a copy first.
4. If the new version does not report that it runs within 30 minutes (or fails, or closes), the
   earlier version is put back, with its settings. If the database had already been upgraded, the
   backup is restored into a new database (`<name>_rb_<time>`) and product folder
   (`products-rb-<time>`) and the app switches to them; the upgraded ones are kept. Copies a
   stopped rehearsal left behind (`<name>_rehearse_*`) are dropped. If the computer restarts
   during the trial, the new version decides at its next start: it keeps itself when it runs, or
   starts the saved copy to go back when it does not.
5. Windows still lists a rolled-back version as installed and its installer refuses a lower one,
   so **the next release must be newer than any version that was rolled back**; Check refuses
   anything else. A release with an older database layout than the running studio is refused too.

In external mode the database user needs `CREATEDB` (`ALTER ROLE <user> CREATEDB;`) for the
rehearsal copy and for a rollback's restore.

Builds are unsigned for the private beta (owner decision, November 17), so Windows may warn about
the installer; the hash check proves the file is the one the release names, not who built it.

**Publishing a release (manual):** raise `version` in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` (above any version that was rolled back), build from a clean checkout
(below), rename the installer without the space (GitHub renames uploaded files with spaces,
and the app looks for the exact name), then run the manifest script right after the build:

```powershell
cd apps\desktop\src-tauri\target\release\bundle\nsis
Rename-Item "Creator Agent_<version>_x64-setup.exe" "Creator-Agent_<version>_x64-setup.exe"
cd C:\dev\creator_agent
node apps/desktop/update-manifest.mjs "apps\desktop\src-tauri\target\release\bundle\nsis\Creator-Agent_<version>_x64-setup.exe" --notes "What changed"
```

and create a release tagged `v<version>` in the private repository with the renamed installer and
`creator-agent-update.json`. Publishing is an outward step: it needs Jordan's go-ahead each time.

## Failure handling

| Situation                                  | Behavior                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Port 5173/4310/4320 in use                 | Status window names the port and, where Windows can tell, the program holding it; Retry     |
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

The installer uses a copy of Tauri's own NSIS template (`src-tauri/nsis/installer.nsi`, from
the pinned `@tauri-apps/cli` 2.12.3) with the changes marked "Creator Agent" in it: when an older
version is installed, the "Already Installed" page picks **Do not uninstall** by default (owner
decision, November 19, 2026), and the uninstaller has **no "Delete the application data" box**
(owner decision, November 19, 2026; audit 2026-11-19 M-2). Uninstalling, from the installer or
from Windows Settings › Apps, removes only the program: the studio home in
`%LOCALAPPDATA%\com.creatoragent.studio` (app-managed database, product files, default backups
and saved secrets) stays. Delete that folder by hand if you really want it gone. When the CLI is
upgraded, take that version's template and make the same changes; a test fails until then.

Checks: `node --test tests/dist/studio-service.test.js` (set `CREATOR_TEST_DATABASE_URL`,
`CREATOR_PG_BIN`; `CREATOR_TEST_STUDIO_BUNDLE` runs it against an installed bundle),
`cargo test` in `apps/desktop/src-tauri` (outside Windows it also needs the GTK and WebKitGTK
development packages; `icons/icon.png` is committed for it), and the scripted installed-app run
`node apps/desktop/studio-acceptance.mjs --pg-bin C:\pgsql18\pgsql\bin [--adopt-env <file>]`.

## Not covered

- Persistent identity for the separately paired execution worker (ADR-0028 still holds:
  re-pair after restart).
- Bundling PostgreSQL itself; OIDC sign-in inside the installed app; code signing (updates
  are hash-checked, ADR-0128); other Windows machines or architectures.
- Updates: the downloaded installer is removed once an update is confirmed, but one that is
  refused or rolled back stays in `updates\downloads\` until you delete it. A rollback's
  `products-rb-*` folder and the kept upgraded database are never removed automatically. A
  restart while the installer itself runs is not resumed (the status window shows the stage).
  While a rollback waits for the files, the failed version's program is renamed, so the Start
  menu shortcut does nothing for up to 3 minutes. If the earlier files still cannot be put
  back, the earlier version runs from its saved copy in `updates\rollback\`; it offers no
  updates there, and the shortcut stays broken. Quit it and install a version newer than the
  failed one by hand.
  Neither is a restart during the rollback itself: the stage stays "Going back to the earlier
  version" and its lock (`updates\rollback-<id>.lock`) stays, so reinstall the earlier version
  and restore the backup the status window names by hand. A rolled-back update keeps its
  `studio-before-<id>.json`, `outcome-<id>.json` and lock for inspection, and `failed.json`
  keeps the highest rolled-back version on purpose; a confirmed update removes its own files.
  When a rollback puts the earlier files back, the failed version's files are set aside beside
  the install folder as `<install folder>.failed-update-<hex>` (the update history names it);
  the next confirmed update removes them.
