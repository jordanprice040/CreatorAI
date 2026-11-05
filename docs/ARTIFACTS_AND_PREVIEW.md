# Verified artifacts, private preview and feedback revision (T13)

T13 turns a T12 `verified_candidate` into an immutable, downloadable package, lets the
owner run that exact package in a private preview, and turns accepted feedback on one
exact version into a new spec version, a new build and a compared revision. Decision
record: ADR-0017 in `tracking/DECISIONS.md`. Evidence: `tracking/evidence/t13`.

## What a package is

`pnpm cli artifact-package <product> <build>` runs locally next to the product store
(`.creator/products`, or `CREATOR_PRODUCTS_ROOT`):

1. Rechecks the build with `BuildSupervisor.status`. Only `verified_candidate` on the
   unchanged commit packages; a changed task head is refused (`Changed candidate`).
2. Reads the committed blobs of that commit (blob-hash verified) and writes a
   deterministic ustar archive `source.tar` (mode 0644, mtime 0, sorted, regular
   files only). The file is written with `wx`, so it is never overwritten.
3. Reads the archive back from disk, re-extracts it with a strict reader (checksums,
   no links or traversal, no duplicates, 100 files / 512 KiB, UTF-8 only, exact
   trailer) and runs every owner-authored acceptance case against those extracted
   bytes in the reviewed WSL2 worker (`runPackage`). A case passes only when its exact
   stdout/exit match **and** the worker's input hash equals the build QA input hash,
   which proves the tested bytes and the packaged bytes are the same.
4. Writes `manifest.json` (`build-manifest/1`, also `wx`). It binds workspace, owner,
   spec id/version/hash/freeze, task key/hash, build plan/prompt hashes, repository
   commit/base/initial commit and Git version, template, recipe/policy/bridge hashes,
   backend, Python and Node versions, dependency statement (standard library only,
   no lockfile), archive sha256/bytes/input hash/file hashes, availability, startup
   command and requirements, build QA and package results, settled broker cost,
   lineage and limitations.
5. Registers the manifest through the API, which re-hashes it and records an
   `artifact` entity linked `implements` to the spec, an index row and an audit event.

States: `verified` (all package cases passed), `failed` (a re-extracted run differed;
the source archive stays downloadable, the demo is unavailable) and `blocked` (the
reviewed worker is not present, as on Linux; nothing runs on the host).

Availability is three separate labels: **source archive** (available when the
archive hash checks), **runnable demo** (only for `verified` packages, and only as a
private preview in the worker) and **native installer** (always unavailable: no
installer recipe exists for the Python CLI template).

Registration refuses: a stale spec version or hash (`VERSION_CONFLICT`), a freeze or
task hash that no longer matches, a lineage that names an unknown artifact or
feedback, and, in real (non-fixture) workspaces, any manifest whose backend is not
the reviewed `wsl2-bwrap-systemd` worker.

## Owner workflow

```text
pnpm cli build-task ...                       # T12, gives a verified_candidate
pnpm cli artifact-package <product> <build>   # package, re-run, register
pnpm cli artifacts <ws>                       # list; current vs superseded
pnpm cli artifact <ws> <artifact>             # manifest + integrity re-hash
pnpm cli artifact-download <ws> <artifact> <manifest-sha256> out.tar
pnpm cli preview-start <ws> <artifact> <manifest-sha256> [ttl|until-stopped] [runs]
pnpm cli preview-link <ws> <preview>          # new one-time link (ADR-0069)
pnpm cli preview-stop <ws> <preview> <version> <reason> [--revoke]
pnpm cli feedback-submit <ws> <artifact> <manifest-sha256> change_request "..."
pnpm cli feedback-decide <ws> <feedback> <version> accept "why"
pnpm cli feedback-revise <ws> <feedback> revision.json   # new spec version
pnpm cli spec-freeze ...                      # freeze the revised spec
pnpm cli product-init <ws> <spec> --from <artifact>      # repo starts from package bytes
pnpm cli build-task ... && pnpm cli artifact-package <product> <build> --previous <artifact> --feedback <feedback>
pnpm cli artifact-compare <ws> <old> <new>
```

The gallery (`#/gallery`) shows the same: version list with current/superseded,
integrity line, availability chips, download, preview start with expiry, previews
with Stop / Revoke access, feedback on that exact version with Accept / Decline, and
a comparison (spec versions, changed tasks, per-case package results, changed
files, cost, and the feedback text that caused the revision).

Every download and preview start names the manifest sha256 it expects. The server
rechecks owner membership and re-hashes manifest and archive from disk. Naming
another version's hash is `VERSION_CONFLICT` (409); changed bytes on disk are
`EVIDENCE_MISMATCH` (400 on the management API, 409 on the preview origin). Old
artifacts are never removed by a revision.

## Private preview

The preview is a separate HTTP origin (`CREATOR_PREVIEW_PORT`, default
`127.0.0.1:4320`) served by the studio, not by the generated program:

- Starting a preview checks the expected manifest hash, that the runnable demo is
  available, and the lease limit (2 live previews per workspace; 1–20 runs). Its
  lifetime is **Timed** (TTL 1–60 minutes, the default) or **Until stopped**
  (ADR-0069, see below). The API then runs the readiness case through the worker and only
  returns a URL when the preview is `ready`.
- The URL carries a one-time ticket. The preview origin exchanges it for an
  HttpOnly, `SameSite=Strict` cookie scoped to `/preview/<id>` and redirects to a
  ticket-free address. A reused ticket is refused (403); a ticket older than 10
  minutes is refused (410). **New link** in the gallery (owner only, authority
  rechecked) issues a fresh ticket without changing the preview's lifetime or run
  count; opening it moves the preview to that browser and older tabs lose access.
- The page is studio-authored HTML with `default-src 'none'` CSP, no framing, no
  referrer. Program output is rendered as text. Runs are `POST` with the preview
  origin as `Origin` and JSON `{args, stdin}`; each run rechecks state, expiry,
  owner membership, manifest hash and the run cap before the worker starts the
  exact archive again.
- Refusals: revoked or stopped → 403, expired → 410, run cap or lease limit → 429,
  hash mismatch → 409. A revoked preview refuses an already open tab.
- **Until stopped** has no expiry date. It stays live while an open preview page
  reports a viewer: the page sends a heartbeat every 30 s and whenever it becomes
  visible again; every page load and run also counts. With no viewer for 3 minutes
  (closed tab, browser crash, long sleep, network loss or studio restart longer than
  that) it ends as `expired`, frees its slot, and the page says so. Browser unload is
  never relied on. Several tabs of the same browser share one session, so any open
  tab keeps it alive. A gap shorter than 3 minutes reconnects without action;
  the session is stored in PostgreSQL, so a restarted studio keeps it.
- Stop / Revoke closes admission at once (page loads, runs, heartbeats and new links
  are refused) and then cancels runs that were already in flight, waiting up to 15 s.
  The preview records cleanup `none`, `cancelled` or `unknown` (a cancel failed or a
  run had not ended; its own worker time limit still applies). After a studio
  restart, in-flight runs are the executor's normal recovery.
- Neither lifetime changes per-run limits (worker CPU, memory, offline network,
  deadline), the run cap, the 2-preview limit or any spending cap. Previews are still
  text-only CLI runs; generated web apps need P15's separate host and worker.
- The preview server never reads the management session. Generated code does not
  run in the browser at all; it runs only in the WSL2 worker, offline, with the T11
  limits.

## Threat model and limits

- The worker boundary is T11's (ADR-0014); T13 adds no new execution path. Without
  the reviewed worker, packages are `blocked`; there is no host fallback.
- The test double in `tests/src/artifact-double.ts` runs nothing. It exists so
  packaging, hashing, leases, UI and feedback bookkeeping can be checked where WSL2
  is absent. Its manifests say backend `test-double`, carry a "not isolation
  evidence" limitation, show a visible notice in the gallery and preview page, and
  are refused by real workspaces.
- Origins differ by port on the same loopback host. Browsers do not isolate cookies
  by port, so the separation relies on the preview origin serving only
  studio-authored pages, never generated HTML/JS, and ignoring management cookies.
  Serving generated web UIs would need a distinct host name and a reviewed web
  recipe; that is not implemented.
- The runnable demo is a CLI runner. Browser, persistence and dependency recipes are
  still unavailable (T12 limitation), so no web-app product can be previewed.
- The manifest index is in PostgreSQL; the archive and manifest bytes stay in the
  local product store. Losing the store makes downloads fail the integrity check
  rather than serve other bytes.
- Local compute is bounded but not metered in money. Public publication is a
  separate authorized action and is not implemented.
