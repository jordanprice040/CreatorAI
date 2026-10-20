# Claude handoff — completion runbook §2.1

Prepared October 20, 2026. This is a handoff for implementation, not evidence of desktop completion.

Owner preferences are now settled in
[the decision register](../tracking/OWNER_DECISIONS_2026-10-20.md) #1–#3:
new/restore/connect studio choices; default tray with user-changeable close setting;
login startup off/opt-in. Apply these within §2.1; implementation scope is unchanged.

## Copy this prompt into a local Claude Code session

```text
Work in C:\dev\creator_agent. Implement ONLY docs/COMPLETION_RUNBOOK.md §2.1:
persistent Windows desktop startup. Follow AGENTS.md and preserve existing changes.
Read this entire handoff before editing. Do not use the older OneDrive checkout.

Read PROJECT_CONTEXT.md, PROMPT_LIBRARY.md shared implementation contract and X05,
tracking/BUILD_STATUS.md, tracking/SESSION_HANDOFF.md, relevant accepted decisions,
tracking/INTEGRATIONS.md, docs/COMPLETION_RUNBOOK.md §2.1, docs/LOCAL_STUDIO.md,
apps/desktop/README.md, context/ARCHITECTURE.md and context/HUMAN_OVERSIGHT.md.
Read docs/DEVELOPMENT_TOOLS.md if using development integrations. Inspect actual
Tauri, API/auth, workflows, preview, worker, installer and configuration code.

Deliver an installed Windows app that starts the local studio without terminals,
pnpm, a development server or a source checkout at normal launch. Record lifecycle,
storage, packaging and dependency ownership design in an accepted project-style ADR
before implementation, distinguishing your implementation decisions from owner approvals.
Preserve PostgreSQL, existing data, security gates and isolated generated execution.

Implement production UI serving, a bounded service supervisor, first-run setup,
health/readiness and actionable failure states. Cover single instance, occupied
ports, authenticated local service ownership, migration serialization and backup,
bounded restarts, graceful shutdown, crash/sleep/reboot recovery and uncertain
external outcomes. Launch API, durable processing and private previews coherently;
avoid duplicate workers and preserve fencing. Reuse external PostgreSQL/Ollama
without killing or claiming ownership of them. Provide a complete dependency setup
path and package required runtime/resources; inspect current official docs for
installed versions. No silent service install, login startup or account changes.

Use a stable per-user data/config/log directory outside the repository and OneDrive.
Provide an explicit, verified adoption path for the freshly created studio below;
do not strand it or silently create another empty studio. Protect secrets and persist
sign-in/worker identity through supported Windows OS-protected storage, with expiry,
revocation and reauthorization. Do not store plaintext tokens in web storage.

Expose close/background/Quit settings. Owner selected close-to-tray by default
with first-close explanation and Settings choice to quit on close. Provide explicit
Quit. Launch-on-demand, login startup off, separately opt-in. Describe active-job
effects. Offer Create new / Restore studio backup / Connect existing; recommend
new studio on a new device, offer Jordan approved studio adoption. Preserve targets
and verify restoration; ordinary product archives are not studio backups.

Implement through real domain/API/UI paths, with honest fixture/live labels.
Do not implement §2.2–2.4 model connections, activate providers, download models,
make paid calls, publish, sign releases, or start the owner pilot. No automatic next
milestone. Do not delegate unless separately authorized by applicable host/user rules.

Run risk-based lifecycle checks and actual local native build/installer acceptance.
Verify cold installed launch with development processes stopped, sign-in, create
record -> explicit Quit -> relaunch -> same record, worker recovery, duplicate launch,
port conflict, absent/unavailable dependencies and actionable failure UI. Verify
background/quit behavior and identity revocation. Reboot acceptance may require the
owner; do not reboot the user's computer automatically. If UI control is unavailable,
retain executable evidence and explicitly mark interactive checks pending. Do not
claim installed/native acceptance from browser or source-tree tests alone.

Update BUILD_STATUS, SESSION_HANDOFF, DECISIONS, INTEGRATIONS and applicable readiness
evidence. Bind checks to the final candidate, preserve failed-run evidence and report
remaining limitations. Ask only for genuinely missing authority after preparing a
concrete reviewable action. Do not weaken gates to label the milestone complete.
```

## Verified starting point

- Reviewed HEAD: `5f7d22443e91f421197b3b0f9b1d3e623afc9edf`.
  Independent U02 review passed; see `docs/audits/U02_REPAIR_REVIEW_2026-10-20.md`.
- §1.2 completed using the owner's authorized fresh-start path. PostgreSQL database
  `creator_studio`, schema `public`, version 24, endpoint `127.0.0.1:55433`.
  Existing Docker service: `creator-agent-local-db-1`; Compose project
  `creator-agent-local`. Reinspect current status before use.
- Current product root: `C:/dev/creator_agent/.creator/studio/products`.
  Initial workspace: “Jordan’s Creator Studio” (`real` record mode). No live model
  activation or spending authority follows from that label.
- Credentials remain in ignored `.env.docker`. Read locally without printing them.
  `scripts/start-local-studio.ps1` selects this database and product root, but is only
  a development launcher. Its PowerShell syntax was checked; the full interactive
  launcher was not exercised. It does not satisfy §2.1.
- Private backup: `.creator/studio/backup-20261020`. Scratch restore database:
  `creator_studio_restore_20261020`; scratch product directory:
  `.creator/studio/restore-products-20261020`. Keep these unless separately retired.
- Actual adoption evidence: `tracking/evidence/studio-adoption/result.json`.
  Direct TypeScript build, migrations 1–24 and repeat no-op, anonymous denial,
  authenticated HTTP workspace creation, API restart/readback, PostgreSQL 18
  backup/restore, audit chain, artifact checks, lineage and budget totals passed.
  No browser/native interactive acceptance was performed in §1.2. The new artifact
  catalog is empty, so no old package was imported or revalidated.
- `creator_dev` remains schema 23 with fixture data. Old `.creator/products` and
  the OneDrive copy are preserved. Never migrate, delete or repoint these accidentally.
  Fresh and old databases share the Docker volume; there is no off-machine backup.
- Existing desktop README records historical Windows Rust/MSVC/WebView2 and native
  X05 acceptance. Recheck installed tools; do not repeat stale claims as current results.
  The shell currently depends on manually started services at ports 5173/4310/4320.
- Last readiness evaluation: `not_ready`, no register problems. Desktop lifecycle
  and this adoption do not establish broader product or live integration readiness.
- The pnpm wrapper attempted a registry lookup and failed DNS in the prior session.
  Direct installed `node node_modules/typescript/bin/tsc -b` passed. Diagnose tooling
  rather than changing pinned dependencies or accepting a partial build.

## Preserve the working tree

At handoff, tracked changes include `tracking/BUILD_STATUS.md`,
`tracking/SESSION_HANDOFF.md` and `tracking/INTEGRATIONS.md`. New files include
`docs/COMPLETION_RUNBOOK.md`, `docs/LOCAL_STUDIO.md`, the U02 report and evidence,
`scripts/start-local-studio.ps1`, adoption evidence and this handoff. They are local
and uncommitted; a cloud checkout or another machine will not automatically have them.
Use the current local checkout, inspect `git status`, and do not reset or overwrite
these files. No commit, push or message to another chat was performed for this handoff.

## Completion report required

State what the installed app actually does, exact candidate/package evidence, checks
executed, adoption/storage locations, remaining manual acceptance and limitations.
Mark §2.1 complete only when its gates are met. Next eligible after completion is
§2.2 (Models/Connections); it requires a new request.
