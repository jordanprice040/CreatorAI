# Windows desktop and paired workers — X05

Owner update: [accepted setup/close preferences](../../tracking/OWNER_DECISIONS_2026-10-20.md) #1–#3 supersede prior proposed defaults. Target close-to-tray is user-changeable with explicit Quit; current close-to-quit implementation needs reconciliation and native acceptance. Login startup remains off/opt-in.

> **October 20, 2026 (§2.1, ADR-0041):** the installed app now starts the whole local
> studio itself — app-managed PostgreSQL, one bundled Node service for UI/API/worker/
> previews, ownership-checked ports, DPAPI sign-in, quit/background settings. See
> [docs/DESKTOP_STUDIO.md](../../docs/DESKTOP_STUDIO.md). The instructions below describe
> the development shell and X05 probes, which still run against separately started services.

Status on October 19, 2026: native functional and local installer gates verified on this Windows host.
Native UI/editor acceptance passed with local fixture approval and real WSL execution.
Production signing/provider activation remain unverified.

## Start the desktop

Rust 1.99.1/Cargo 1.99.1, stable-x86_64-pc-windows-msvc, Visual Studio 18 Build Tools
with the C++ toolchain and WebView2 155.0.4283.62 were observed on this host.
Tauri 2.12.4 and tauri-build 2.7.3 compile; Cargo.lock fixes transitive versions.

Configure the existing local PostgreSQL connection, then from the repository root:

```powershell
pnpm db:migrate
pnpm build
pnpm dev
```

In another terminal:

```powershell
cargo run --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The shell requires the default local ports: web 5173, API 4310, private preview 4320.
It uses the same shared React UI, contracts, API and authoritative PostgreSQL as
the web app. Migrations 16 and 17 add pairing/session and bounded job records after X04's migration 15.
The desktop does not start these services or synchronize another database.

Native menus expose four scoped actions:

- **Sign in using system browser:** the native process creates a five-minute
  request, holds a random proof in memory, opens an approval page in the system
  browser, and displays a comparison code in its title. Sign in to the studio in
  that browser, return to the approval page, compare codes and approve. The
  native process claims a separate HttpOnly session and refreshes the shared UI.
  The proof and resulting session are never placed in URLs or web JavaScript.
- **Download selected Gallery source:** open an artifact in Gallery, then use
  this menu. The native client rechecks the authenticated catalog, downloads raw
  manifest bytes and archive, verifies their hashes, scope and byte counts, and
  saves an unextracted, dated snapshot in the application-local `source-cache`.
- **Open last downloaded manifest in editor:** rechecks its receipt hash, exports
  an exact copy under `Downloads/Creator Agent source`, rehashes the copy and opens
  packaged Windows Notepad. Editing this copy cannot change the dated cache.
  It does not extract or execute source. Missing packaged Notepad reports an error.

- **Queue selected artifact once on paired worker:** submits the selected exact
  catalog manifest with empty args/stdin to the sole active execution-capable
  worker in that workspace. Use Desktop and workers for other inputs or multiple
  workers. Retries in the same window retain the request identity.

Top-level WebView navigation stays on the management origin. Private preview
links with exactly one valid ticket open only on the separate loopback preview
origin in the system browser. Existing T13 preview controls still enforce their
server-side artifact/version/worker checks. Remote pages get no native IPC,
filesystem, shell or plugin capabilities. There is no general native command API.
The browser-origin authentication and worker-control checks are unchanged.

## Pair a local presence worker

```powershell
node apps/desktop/worker.mjs pair WORKSPACE_UUID "My Windows worker"
```

Open its approval URL in your signed-in system browser. Compare the terminal's
code before approving. Only a human workspace owner can approve worker pairing.
The challenge is single-use and bound to the process's proof. Revoked/expired
browser approvals cannot be claimed. Worker credentials are stored only as hashes
on the server and remain in memory in the local client; a process restart requires
pairing again. They expire after 30 days and cannot act as owner session cookies.

Use **Desktop and workers** in the shared UI to inspect, refresh, pause, resume,
request shutdown or revoke. Every heartbeat checks the workspace owner membership,
identity expiry and revocation. Presence leases last 30 seconds and carry the
workspace, declared capability and a fence invalidated by controls. The client
makes outbound connections only, polls every five seconds, and stops after three
consecutive failures or a shutdown response. No inbound worker listener is opened.

Presence-only workers retain no job authority. To explicitly pair an execution worker:

```powershell
node apps/desktop/worker.mjs run WORKSPACE_UUID "ABSOLUTE_PRODUCTS_ROOT" "My isolated worker"
```

The root must be the existing local T13 product store, configured by its owner;
jobs cannot select host paths. This local deployment does not download arbitrary
remote workspaces. Approval declares `artifact.run`. Only owner-submitted jobs for
an exact verified, runnable manifest/archive can be leased. Existing pairings do
not gain capabilities automatically. Shared UI accepts bounded args/stdin and
shows job history, cancellation and explicit local-stop reconciliation.

Each job permits one attempt with fixed 20-second runtime, 256 MiB memory and no
network, using the existing reviewed WSL2/bubblewrap/systemd backend. Current
recipe/policy/bridge hashes must match the artifact. Maximum unresolved exposure
is three jobs globally, one per workspace, and twenty submissions per hour.
Local compute is recorded as unmetered by the studio, never priced as free.
Ten-second job leases are renewed while running. Revocation, pause, shutdown,
lease loss and transport failure stop admission and request cancellation. Running
unknown outcomes remain `reconciling`, block new workspace jobs and are never
redispatched automatically. Owner reconciliation checks the actual local execution
and stopped sandbox before releasing that slot. Worker reports remain immutable
`worker_report_only` observations and cannot promote artifact QA.

Closing the desktop leaves a separately started worker and studio services running.
Ctrl+C stops the worker. Shutdown is observed on its next successful poll;
revocation immediately denies later admission/checks. Expired presence or a stale
last-seen time alone does not prove process exit. Full local execution evidence is
retained; remote stdout reports are bounded and explicitly flag truncation.

## Offline snapshots and local import

The existing Node CLI also checks the shared T13 schema, strict ustar reader and
per-file inventory before caching downloaded files. Obtain the raw manifest from
the new authenticated owner route:
`/api/workspaces/WORKSPACE/artifacts/ARTIFACT/manifest?sha256=CATALOG_MANIFEST_HASH`.
The independently obtained expected identity JSON contains `workspace_id`,
`artifact_id`, and `manifest_sha256` from the authorized catalog record.

```powershell
node apps/desktop/artifacts.mjs import ".verification/desktop cache" "manifest.json" "source.tar" "expected.json"
node apps/desktop/artifacts.mjs inspect "CACHE_ENTRY_FROM_IMPORT" "expected.json"
```

Node and native caches preserve original manifest state and fixture/limitation
markers. Their timestamps record local import time, not a fresh server observation.
They do not modify studio records or grant permission for later offline actions.
Native downloads verify archive/manifest identity but do not extract or re-run QA;
the Node inspector additionally validates the file inventory. Use an owner-only
cache outside generated-product workspaces. Reparse/symlink ancestors are refused,
but path checks are not a boundary against owner-privileged concurrent replacement.
No multi-writer synchronization is implemented.

## Verification and remaining gates

Executed Windows gates and exact results are in `tracking/evidence/x05`:

- Locked Cargo check/build and Rust tests for navigation, preview ticket scope and
  hash tampering. Actual WebView navigation was observed with the hidden debug
  startup probe; this does not assert rendered-UI correctness.
- A debug native download probe used a disposable fixture session and a T13
  test-double artifact through the actual Windows executable/WebView cookie store.
  Downloaded manifest and archive bytes matched the catalog hashes. This is real
  native download evidence; it is not real execution-isolation evidence.
- PostgreSQL/HTTP tests cover proof binding, one-time concurrent claims, expiry,
  revoked browser approvals, membership, CSRF, worker credential separation,
  controls/fencing, raw manifest export and the actual outbound worker client.
- The earlier Node cache tests exercise Windows paths with spaces, junction
  rejection, concurrent imports, bounded input and tamper detection.

Commands for focused checks (use a disposable test database server):

```powershell
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node --test tests/dist/desktop.test.js
node --test apps/desktop/artifacts.test.mjs
cargo test --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo build --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml
node apps/desktop/native-startup.mjs
```

`CREATOR_TEST_DATABASE_URL` enables disposable PostgreSQL tests.
`CREATOR_TEST_NATIVE=1` additionally enables the native download gate in
`tests/dist/artifact-api.test.js`; it needs free ports 4310/5173 and a built UI and
Windows executable. Debug probes use fixture credentials supplied only to their
process environment, have no native IPC endpoint, and are disabled in release
builds. Native fixture source snapshots are left in application-local cache for
inspection. No editor or personal browser was opened by these automated probes.

To reproduce the real paired/native gate after building the UI and executable:

```powershell
$env:CREATOR_TEST_ISOLATION = 'wsl2'
$env:CREATOR_TEST_NATIVE = '1'
node --test tests/dist/artifact-cli.test.js
```

This needs the existing reviewed WSL backend and disposable PostgreSQL; it never
substitutes the fixture execution backend. `node apps/desktop/signin-acceptance.mjs`
creates a disposable local studio and prints a fixture approval URL/code for an
isolated browser. `CREATOR_TEST_NATIVE_SECURE=1` checks the Secure-cookie policy.
Both harnesses require free local ports 4310/5173 and clean up their test databases.

Additional executed gates: native browser approval in isolated Edge and authenticated
fetch inside the Windows WebView, with both ordinary and Secure cookies; actual
native queue -> paired outbound CLI -> reviewed WSL sandbox with exact archive and
successful output; worker remains alive after native window exit, then explicit
shutdown exits it. Fixtures provide identity and approval; generated execution
uses the real isolation backend. HTTP tests exercise capability denial, hash
binding, queue concurrency, idempotency, one-time leases, prelaunch pause/revocation,
expiry and immutable reports. Evidence distinguishes these from live provider use.

The first sign-in probe incorrectly read the OS window title rather than the DOM
title; corrected instrumentation uses Tauri's document-title event. The failed
probe is recorded in `tracking/evidence/x05/native-signin-probe-diagnosis.md`.

Remaining acceptance/activation boundaries:

- Configured live OIDC acceptance remains unverified. Native menu/browser-handler
  launch, authenticated navigation, exact editor copy and worker controls passed
  locally; owner approval used the explicit fixture HTTP seam, not personal login.
- Production code signing and signed automatic updater activation are not configured.
  Local NSIS install, upgrade, refused downgrade and explicit reinstall rollback
  passed under a separate unsigned debug acceptance identity.
- Supported infrastructure is this observed Windows x64/MSVC/WebView2/Ubuntu WSL2
  host; other Windows environments and architectures are not verified.

## Local installer and update policy

`@tauri-apps/cli` 2.12.3 is pinned in this workspace and lockfile. Default Cargo
builds keep bundling disabled. To prepare an opt-in local client installer:

```powershell
pnpm build
pnpm --filter @creator/desktop bundle:windows
```

The NSIS configuration in `src-tauri/tauri.local-bundle.conf.json` uses current-user
installation, requires an existing WebView2 runtime and refuses downgrades. It does
not install the studio API/database/UI or register a background worker/service.
Start those separately on the documented local ports. No automatic updater plugin,
endpoint, signing key or update capability is configured. The release-mode unsigned installer built successfully on this host
(`windows-release-bundle.log`). An unsigned installer is
a local review artifact, not a signed public release. Public distribution remains
a separate owner decision.

Manual upgrade uses a newer installer after closing the desktop. Explicit rollback
uninstalls the client and reinstalls the known prior installer; the authoritative
studio database and separately running worker are not part of the client installer.
Do not infer schema rollback from client rollback. The acceptance harness uses a
separate product/identifier, no shortcuts, and a checked workspace directory. It
refuses a pre-existing fixture registration or target, verifies installed versions,
checks native WebView startup for baseline/upgrade/rollback, and uninstalls its
fixture. It observes executable write access before replacement. Its scripts and
results are `installer-acceptance.ps1`, `windows-installer-final.log` and
`windows-installer-acceptance.json`. These are unsigned debug fixture checks.

The final paired lifecycle gate (`paired-lifecycle-final.log`) packages a synthetic
fixture with real WSL QA and an explicitly declared long-lived test path. It
observes the detached child in Linux /proc before revocation or killing the paired
CLI. Revocation cancels the actual process tree and reports inactive cleanup.
Worker crash leaves no report, expires the real server lease, blocks new work and
requires owner API reconciliation with an observed stopped local execution hash.
No automatic redispatch occurs. Synthetic review is visibly fixture-labelled and
is not independent product review or empirical validation.

Local X05 acceptance passed; see `INTERACTIVE_ACCEPTANCE.md` and
`tracking/evidence/x05/native-ui-acceptance.json`. Next eligible prompt: X06,
hosted operation and observability. X06 is not started.

Official documentation checked October 19, 2026:
[Tauri configuration](https://v2.tauri.app/reference/config/),
[capabilities](https://v2.tauri.app/security/capabilities/),
[Windows prerequisites](https://v2.tauri.app/start/prerequisites/),
[Tauri 2.12.4](https://docs.rs/crate/tauri/2.12.4),
[reqwest 0.13.5](https://docs.rs/crate/reqwest/0.13.5).
