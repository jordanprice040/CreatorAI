# Creator Agent completion runbook

Updated October 20, 2026. Owner: Jordan Price. Working checkout: `C:\dev\creator_agent`.

**Accepted owner choices:** [decision register](../tracking/OWNER_DECISIONS_2026-10-20.md)
records decisions #1–#52 and RD1–RD10 accepted in chat, including the final revisions.
Use it instead of reopening settled preferences. Remaining identity, cost, institutional
and exact-candidate gates are explicit there. Accepted design is not implemented
functionality or activation authority; deferred decisions remain deferred.

This is an actionable guide and a record of requested work, not evidence that the work is implemented. The five completion groups are preserved below. The new desktop-launch and model-connection requirements are included before the live pilot. Existing acceptance gates and frozen research conditions remain authoritative.

## Order and responsibilities

1. Independently review and adopt the repaired candidate.
2. Implement persistent desktop startup and clean model connections, starting with Ollama.
3. Verify real research/model paths and one complete discovery-to-product workflow.
4. Run a bounded owner pilot from the installed app.
5. Complete the selected remote, distribution, commerce and marketing integrations.

Use Codex or Claude Code for the prompts. Local Windows/WSL acceptance needs a local coding session. Browser/desktop control is useful only when that session exposes the required tools; browser-only evidence cannot establish native app behavior. Cloud sessions cannot verify your Windows startup, installed Ollama, or native worker.

Keep agents from editing the same files concurrently. Use the current checkout, not the older OneDrive copy. Never paste API keys, OAuth tokens, database passwords, signing keys or recovery codes into chat or Git. Credentials remain in the studio control process, outside generated product execution.

Prepend this contract to each prompt:

```text
Work in C:\dev\creator_agent. Follow AGENTS.md. Read PROJECT_CONTEXT.md,
the relevant PROMPT_LIBRARY.md entry, BUILD_STATUS, SESSION_HANDOFF,
relevant decisions/integration records and actual implementation.
Preserve existing changes and reconcile stale historical claims.
Complete authorized implementation and meaningful verification. Update tracking,
readiness and integration evidence. Use current official API documentation.
Never silently replace live behavior with fixtures or weaken an acceptance gate.
Prepare concrete scope, costs and rollback before requesting missing authority
for purchases, public deployment, account changes or outbound messages.
Honor existing matching grants without asking again. Do not start another
milestone automatically.
```

## Group 1 — Review and adopt the repairs

### 1.1 Independent review

Prefer a session other than the repair implementer.

```text
Execute U02 against the exact latest audit-boundary repair candidate.
Read docs/AUDIT_FIXES_2026-10-20.md. Review all four repaired boundaries,
migration 24, regressions and final evidence. Check for later changes that
invalidate evidence. Report pass/partial/blocked, severity, reproduction and
precise references. Do not modify code during this independent review.
```

If findings remain:

```text
Execute U03 for the independent review findings. Reproduce material failures,
make the smallest coherent repairs and run affected checks. Preserve acceptance
criteria and failed-run evidence. Record the exact final candidate and remaining
blockers. Do not activate external services.
```

### 1.2 Adopt into your saved local studio

**Recorded choice #1:** Jordan's fresh `creator_studio` and `.creator/studio/products`
were adopted under §1.2; see `docs/LOCAL_STUDIO.md` for verified identities/evidence.
Installed first run offers Create new studio, Restore studio backup, and Connect to
existing authorized studio. Recommend empty new studio on a new device; offer Jordan
adoption of the approved studio. Product/source archives are not studio backups.
Verify target ownership and backup/restore; never silently merge or overwrite.

```text
Prepare adoption of the reviewed candidate. Identify the configured database,
schema and product store without printing secrets. Follow the backup runbook:
create a backup, restore to a separate scratch database and verify records,
artifact references and resource totals. Never run destructive tests on real data.
After target confirmation and successful restoration, apply reviewed migrations
to the named operational database. Reverify/repackage artifacts affected by the
bridge hash change. Verify saved records, sign-in and affected application paths.
```

**Done:** independent review has no blocking findings; the intended database is current; restoration succeeds; affected package evidence is current.

## Group 2 — Persistent desktop and clean model connections

### 2.1 Define the normal app experience

Jordan requested a persistent Windows application that starts the whole local studio when launched. Keep the current PostgreSQL architecture unless a material change is explicitly accepted. Persistence means records/configuration survive exit and restart. Running jobs while the window is closed is a separate, visible background mode. No app can continue local computation while the computer is powered off; after sleep/reboot it must recover honestly.

Historical starting point: the original Tauri shell required separately started
services at `http://127.0.0.1:5173/`. New §2.1 supervisor/installer evidence is in
`docs/DESKTOP_STUDIO.md` and BUILD_STATUS; interactive acceptance is still pending.
The implemented close-to-quit default must be reconciled with accepted #2 before
claiming the selected experience complete. A shell shortcut alone is insufficient.

**Target behavior:**

- Install once; launch from Start menu or a shortcut without terminals or `pnpm dev`.
- Show setup/status while owned database/API/workflow/preview services start.
- Serve the production UI, with bundled runtime or a verified managed prerequisite.
- Keep owner data/config/logs under a stable per-user application directory outside the repository and OneDrive by default; preserve existing data through an explicit import/adoption path.
- Start only app-owned dependencies. Existing PostgreSQL/Ollama services are checked and reused through their configured connections, never killed as though they were owned children.
- Provide first-run prerequisite setup, database configuration, migration/backup, worker setup and actionable errors. Ordinary later launches should need no manual startup.
- Prevent duplicate studios, conflicting migrations and accidental connection to an unrelated service on an occupied port. Authenticate local service ownership.
- Provide an explicit Quit; optional tray/background mode and launch-at-login are owner settings. Closing the window must have a clear documented effect on active jobs.
- Persist secure sign-in and worker identity through supported OS-protected storage with expiry, revocation and reauthorization. Do not retain plaintext tokens in web storage.
- Recover from crashes, sleep, restart and unavailable dependencies; never silently resend uncertain external actions.
- Keep generated code in the existing isolated worker. Launch convenience does not grant it host execution rights.

**Accepted #1–#3:** close to tray by default with first-close explanation, Settings
choice of Close to tray / Quit on close, and explicit Quit. Launch-at-login is off,
separately opt-in. Offer the studio setup/adoption choices above. These preferences
are settled; native implementation and acceptance still require evidence.

```text
Implement the persistent desktop requirement in docs/COMPLETION_RUNBOOK.md §2.1.
Inspect the Tauri shell, service entry points, database setup, worker identity,
isolation and installer. Record the lifecycle/storage design and any consequential
architecture choice before implementation. Preserve PostgreSQL and existing data.

Build a production service supervisor and first-run setup. Launch the UI, API,
durable workflow processing and private preview from the installed app. Handle
owned versus external services, health/readiness, single instance, port conflicts,
bounded restart, graceful shutdown, migrations and crash recovery. Do not rely
on a development server, source checkout, terminal or build tool at ordinary launch.

Implement explicit background/quit settings and secure persistent identity.
Package the required runtime/dependencies or provide a complete managed setup path.
Do not silently install services, enable login startup or change external accounts.

Run meaningful lifecycle tests, then native installed-app acceptance from a cold
start with development processes stopped. Verify create record -> quit -> relaunch,
worker recovery, missing dependencies and failure UI. Use desktop controls if
available; otherwise retain machine-test evidence and mark manual checks pending.
```

**Jordan's native acceptance:** install the candidate; stop development terminals; launch from Start; complete setup; create a record; quit; relaunch; check the record and model settings; try background/quit controls; restart Windows and repeat. An agent may automate available UI controls, but report only checks actually executed. Signing is addressed in Group 5 and need not block a private unsigned acceptance build.

### 2.2 Add a Models/Connections screen

Use separate connection types with visible billing and data boundaries:

| Connection           | Target experience                                              | Accounting                                                         |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Ollama local         | Discover installed models, select, test, disconnect            | Local inference; hardware/time are resources; no invented API bill |
| ChatGPT plan / Codex | Supported browser authorization, eligibility check, model test | Subscription quota/limits, separately from API dollars             |
| OpenAI API           | Secure key connection, verified model/pricing selection        | Metered API cost within existing money gates                       |

Every connection should show status, model/version, last verified time, supported features, context/output limits, data destination and billing mode. Provide role defaults and per-run overrides. A successful connection does not qualify a model for every role. Structured output, tools, embeddings, streaming and cancellation must be tested separately. No automatic paid fallback when a local model or subscription limit fails.

```text
Implement clean runtime model connections, starting with Ollama, behind the
application-owned broker. Read §2.2-2.4 of docs/COMPLETION_RUNBOOK.md.
Add a Models/Connections UI for discovery, configuration, test, disconnect,
capability status, role assignment and billing/data-destination labels.

Extend provider contracts, registries and persistence coherently; do not label
real local inference as fixture mode. Preserve deterministic grants, task limits,
audit provenance, cancellation and study-condition isolation. Keep secrets outside
web JavaScript and generated workers. Add behavior-based checks and actual UI/API
wiring. Do not activate paid fallback or change frozen study models.
```

### 2.3 Start with Ollama

Ollama's executable was found at `C:\Users\jorda\AppData\Local\Programs\Ollama\ollama.exe`. An October 20 `ollama list` check was denied by local socket access permissions. This does not establish whether the service is running or which models exist. No inference or model download was performed.

**Jordan:**

1. Open Ollama from Start. In a normal PowerShell terminal run `ollama list`.
2. If it fails, retain the exact error for the coding agent; do not expose the service to the network as a workaround.
3. Accepted #4: inspect RAM/GPU/VRAM and installed model metadata; use an installed model if suitable. Otherwise recommend a compatible model with capabilities, size, license and hardware requirements, allow alternatives, and confirm the exact tag before download. If hardware is insufficient, explain and offer supported connected alternatives. Qualify roles after testing.
4. If desired, run `ollama pull <chosen-model-tag>` only after choosing the exact tag. The placeholder is not a literal command argument.
5. Once the connection UI exists, select Ollama, test the chosen local model and assign only qualified roles. A local model needs no OpenAI API key.

```text
Implement and verify an Ollama runtime adapter using current official docs.
Inspect installed Ollama, hardware and model metadata read-only first. Report
access restrictions rather than interpreting them as an absent installation.
Use an owner-configured loopback endpoint; validate endpoints and redirects so
arbitrary URLs cannot turn model settings into credential/SSRF access.

Discover models using /api/tags and metadata, then implement bounded chat and
structured outputs with schema validation, timeout, cancellation, usage records
and explicit unsupported-capability results. Add embeddings only for a compatible
embedding model. Record model digest and actual configuration where available.
Do not assume every model supports tools, JSON schemas or the same context size.

Qualify installed models with bounded non-held-out representative tasks. Keep
local resource accounting separate from API money; do not weaken unknown-cost
gates or call local compute free. No cloud fallback or model download without
matching scope. Run a real local inference only within the owner's chosen limits.
```

### 2.4 Add supported ChatGPT-plan/Codex integration

Official documentation checked October 20, 2026 describes ChatGPT-plan usage for eligible clients and users, including an app-server route. Availability/client registration and account eligibility must be verified. Identity-only login does not itself authorize inference. Model catalog entries are not proof of entitlement; a completed request establishes access for that request.

Use supported OAuth/PKCE or documented Codex authentication. Do not scrape the ChatGPT web UI, extract another app's session cookies, or copy existing desktop tokens into arbitrary API requests. This is a subscription/quota route, not an unlimited or universally available substitute for API billing. General model inference and agentic coding must retain separate capability/security scopes.

**Jordan:** complete supported browser sign-in, scope review, MFA and any required
eligibility/registration. **Accepted #5/#7:** local and supported subscription access
first. On quota exhaustion use a permitted qualified local route or pause. Paid API
fallback is a user setting, off by default; manual enablement specifies eligible
providers/models, task scope, spending caps and privacy rules. Honor matching grants
without repeated prompts. No silent paid fallback; blocked subscription eligibility
does not block usable Ollama.

```text
Implement a supported subscription-backed ChatGPT/Codex connection.
First inspect installed Codex versions and current official auth/app-server and
ChatGPT-plan integration documentation. Determine the supported route and any
client-registration, account or distribution eligibility requirement for this app.
Do not promise access based on an existing desktop login or model/list alone.

Implement system-browser authorization, OS-protected credential storage, refresh,
disconnect/revocation, capability detection and bounded request/turn lifecycle.
If app-server is used, isolate its configuration, process environment, workspace,
credentials and tools. Do not inherit personal MCP servers, plugins, unrestricted
shell or host filesystem access. Generated builds retain the studio's isolated
worker boundary. All external actions still pass application-owned admission.

Display subscription/quota accounting distinctly from API dollars. Handle rate
limits, expiry and unavailable limits without fabricated prices or unlimited-use
claims. No silent paid fallback, quota circumvention or private web API use.
Exercise contract checks and one explicitly authorized live verification. If
eligibility blocks it, finish local implementation and report the exact dependency.
```

### 2.5 Finish real evidence retrieval

Local inference still needs real evidence. Ollama does not by itself provide internet search.

**Accepted #8–#10:** qualify the existing runtime research adapter first; replace
only if source fidelity, coverage or cost is unsuitable. Prepare task-specific
official/primary-source domain allowlists. Local/subscription verification precedes
new metered spending; any paid check needs a concrete grant within remaining funds.
Users control overall and narrower model/task budgets; $20 is this studio's current
allowance, not a product maximum. Credentials remain local secret references; owner
handles authentication/MFA and uncovered account/purchase decisions.

```text
Prepare and implement the selected live search adapter behind the research broker.
Use current official documentation; preserve permissions, exposure reservation,
query/result provenance, retrieval timestamps, cancellation and durable outcomes.
Do not treat snippets as verified source passages. Handle rate limits, uncertain
billing and unavailable sources. Configure approved-domain source fetching.
Run fixture/contract checks and, within a recorded grant, live search and fetch
through the real application. Update only evidenced readiness states.
```

### 2.6 File storage, permissions and transfer foundation

The owner requested user file uploads and downloads as explicit milestones. These
are planned work, not implemented acceptance claims. Implement §2.6–§2.9 in order
after the required desktop/auth/storage prerequisites; they do not change the
in-progress §2.1 scope. Reuse existing artifact downloads and source ingestion where
compatible. Keep the five completion groups and existing research protocols intact.

```text
Implement COMPLETION_RUNBOOK §2.6. Inspect existing artifact/source storage,
authorization, retention and desktop contracts. Record the file lifecycle and
storage design before implementation. Add workspace-owned immutable file versions
with stable IDs, content hashes, original display names, detected media types,
byte counts, origin/uploader and timestamps. Link originals, extracted derivatives
and consuming records without conflating uploaded assertions with verified facts.

Use controlled storage outside the repository with opaque storage keys, atomic
publication and durable pending/complete/failed/deleted states. Enforce owner and
workspace authorization, CSRF where applicable, per-file/workspace quotas, bounded
streaming, concurrency and disk-exhaustion handling. Define an explicit supported
type/size policy and safe handling for mismatched types, executable/active content,
archives, malicious filenames, traversal, symlinks and decompression bombs. Never
execute uploads or grant them native IPC/management-origin trust. Keep originals
untrusted; previews use safe rendering and the existing origin/isolation boundaries.

Implement cancellation, bounded retries, idempotency, crash recovery, partial-file
cleanup, integrity checks and actionable errors. Choose resumable transfers only
where supported sizes justify them; otherwise document safe retry behavior. Apply
retention/deletion to originals, derivatives, indexes and backups with documented
retention limits; preserve lawful audit tombstones without leaking deleted content.
Cover file storage in backup/restore and orphan reconciliation. Run negative access,
quota/concurrency, malformed-file, interruption/retry and restore checks.
```

**Done:** the application enforces a tested file lifecycle; failed or unauthorized
transfers cannot publish usable records, escape storage or exhaust unbounded resources.

### 2.7 Uploads, attachments and research-source intake

Required workflows: file picker and drag/drop in web and desktop; attach files to
workspace briefs, tasks, evidence and release-specific feedback; list, inspect,
detach and delete permitted attachments; show progress, cancellation, retry,
limits and extraction status. Provide accessible keyboard alternatives. Directory
and arbitrary archive imports are unsupported until explicitly bounded and tested.

**Owner-requested app-wide intake:** dropping one or multiple files anywhere in the
signed-in management app adds them to the current workspace's Sources/Library
without navigating away or losing the current draft. Show a file-drag overlay naming
the destination workspace and a persistent transfer tray with progress, per-file
results, cancel/retry and Open in library. Use the same ingestion/validation path as
the picker; accepted routine uploads need no extra confirmation. A persistent Add
files action provides the equivalent keyboard/picker workflow from any page.

Only actual file drags invoke global intake. Preserve text selection, internal
drag/reordering, links and ordinary editor behavior. A more specific attachment
drop zone takes precedence: store once in the library and attach to its indicated
record, with no duplicate upload from bubbling or native/WebView double delivery.
Prevent dropped files from replacing the application with browser navigation.
Unsupported files report errors without navigating, executing or losing drafts.
Do not treat directories, dropped paths or URLs as permission to scan host folders
or fetch remote content. Native drops use a narrow authorized file-transfer bridge.

Bind each transfer to the workspace visible at drop time; later navigation must
not redirect it into another workspace. If signed out or without a workspace/write
permission, explain the needed sign-in/selection/access and do not silently queue
or upload. On sign-out, cancel uncommitted transfers and clear sensitive transfer
previews; handle already committed files through normal authorized records. Partial
failures preserve successful receipts. Library intake may schedule supported local
extraction but does not automatically make content verified evidence, add it to a
run, send it to a provider or execute it. References retain user-provided labels.

```text
Implement COMPLETION_RUNBOOK §2.7 using §2.6. Add real API/domain/UI paths for
single and multiple file uploads and versioned attachments, preserving original
bytes and names as display metadata. Support plain text/Markdown, PDF, DOCX,
CSV/JSON and common raster images through explicit tested adapters. Mark unsupported,
encrypted, corrupt or unextractable files honestly; do not invent extracted text.
Implement accepted #11 bounded local OCR for scanned PDFs/images; expose its
availability, uncertainty and resource cost. Keep tables and page/section/row or
image locators sufficient to trace extracted passages to the exact original.

Allow an authorized file to become a research source with provenance, extraction
version, duplicate detection and claim links. Preserve conflicting evidence and
user-provided/unverified labels. Distinguish upload time from source publication
and retrieval dates. Extend approved URL retrieval to supported downloadable
documents with redirect/host/size/type checks; do not bypass source access limits.
Retain inaccessible and permission-restricted states and original-download policy.

Show which files or selected passages will reach each model/provider. Uploading
does not itself authorize external transmission: reuse matching grants, data
classification and context-selection rules; request only uncovered scope. Treat
embedded instructions as data. Respect study assignment and held-out restrictions.
User reference code stays inert; importing it as an executable project requires
a separately reviewed isolated-build contract.

Verify upload -> attach -> extract -> inspect original locator -> cite -> restart
and readback through actual UI/API. Test duplicates/version replacement, revoked
access, prompt injection, extraction failure, cancellation and deletion. Fixture
and real-file evidence remain distinct; no provider activation is implicit.
Verify app-wide drops from several pages while preserving unsent fields, multi-file
and duplicate drops, specific attachment-zone precedence, keyboard alternatives,
workspace changes mid-transfer, sign-out/revocation and native/WebView event
deduplication. Confirm no accidental file navigation or cross-workspace intake.
```

**Done:** supported local files and approved remote documents become inspectable
attachments/evidence with exact-original lineage and truthful extraction status.

### 2.8 Downloads, source exports and generated deliverables

```text
Implement COMPLETION_RUNBOOK §2.8. Preserve and verify existing Gallery source
archive and manifest downloads. Add authorized download of uploaded originals,
retained research documents and generated deliverables. Link to external originals
when redistribution/access policy forbids storing or exporting them; report missing
or unavailable originals without silently substituting extracted text.

Provide explicit exports for individual records and selected workspace/run results:
human-readable report, machine-readable JSON, tabular CSV where appropriate, and
a bounded evidence bundle containing permitted originals, extracted passages,
citations/locators, decisions and provenance. Include format/schema versions,
file hashes, exact record/artifact versions, export time and omissions/redactions.
Preserve study blinding and held-out exclusions. Exclude credentials, private
tokens, internal-only fields and unrelated workspace data; do not export private
chain-of-thought. Keep portable exports distinct from operational backups.

Expose only generated output formats the product actually supports. Capture
isolated worker output files as bounded, inspected, versioned artifacts with lineage
and readiness labels; do not permit arbitrary host-path reads or automatic execution.
Existing source archives remain downloadable alongside supported runnable packages,
reports and output files. Do not promise arbitrary product types or format conversion.

Implement web download and desktop Save As with safe filenames, explicit overwrite
handling, progress/cancel/retry and integrity verification. Recheck access and exact
versions at download/export dispatch and before publishing a prepared export.
Use bounded, expiring authenticated delivery; keep files private by default.
Public sharing/publishing needs separate scoped authorization. Prevent active
content from rendering on the management origin and spreadsheet formula injection
in CSV exports. Document offline cached-file access, expiry, deletion and revocation
limits: a legitimately downloaded copy cannot be remotely recalled.

Test exact-byte round trips, stale versions, cross-workspace/revoked access,
redaction/source fidelity, malicious filenames/content, bounded bulk exports and
interrupted delivery. Verify supported exported packages still start in isolation.
```

**Done:** users can retrieve permitted originals, source code and supported results,
and inspect a reproducible export without secret or cross-workspace disclosure.

### 2.9 End-to-end file workflow and release acceptance

```text
Verify COMPLETION_RUNBOOK §2.6–§2.8 against the exact candidate in both browser
and installed Windows UI. Upload representative supported files, attach to a real
brief/task, inspect extraction and provenance, use authorized context, produce a
supported result, and download originals/results plus an evidence bundle. Compare
hashes and locators; open exports using ordinary tools. Verify quit/relaunch,
backup/restore, cancellation/retry, quota errors, deletion and access revocation.
Exercise keyboard/file-picker alternatives to drag/drop and desktop Save As.

Use synthetic/public acceptance files and bounded existing grants; live provider
checks require their matching authority. Record actual file types/sizes, platform,
versions and failures. Publish supported formats, limits, privacy/provider-sharing,
retention and download instructions in app help and the §5.2 release materials.
Update readiness and integration records with executed evidence. Missing native
checks remain pending; never label browser-only evidence desktop acceptance.
```

**Done for Group 2:** the installed app starts its studio, persists records, exposes working model settings, performs a bounded real local inference and retrieves approved real evidence. The §2.6–§2.9 upload/download workflows pass their applicable gates. Subscription/API options have truthful separate statuses. Additional providers are not prerequisites for local usability.

### 2.10 Qualified model allocation and optimization (X01/X02)

Accepted #6/#10: Economy with quality floor is the default. Implement user-editable
overall, provider/model, project/run and task caps (including recurring limits),
with authenticated/audited/versioned changes and atomic enforcement of every parent
limit. Users may explicitly raise their own ceiling above $20; agents cannot.
Current $20 studio exposure limit remains until an actual amount change is approved.

**Existing foundation:** `docs/MODEL_ROUTING.md` describes fixed, Auto and Economy
policies, task constraints, held-out promotion and rollback; its documented evidence
is fixture-only. `docs/CONTEXT_AND_CACHING.md` covers context optimization. Inspect
current code and newer evidence before deciding what remains. Extend these systems,
not a competing router. Connected does not mean qualified for every task.

**Refined goal:** choose the least total resource burden among routes that meet a
declared task-quality floor. No model can guarantee sufficiency for every unseen
task. Use measured task-class performance and deterministic acceptance checks;
show uncertainty and stop/escalate on objective failure within existing authority.

```text
Complete COMPLETION_RUNBOOK §2.10 through existing X01/X02 brokers and real
workflow/builder/reviewer paths. Inventory connected model capabilities, accessible
IDs/versions, context/tool/structured-output support, privacy boundaries, dated
prices, availability and qualification evidence. Include supported effort levels
as evaluated route configurations; never invent provider parameters. Filter hard
constraints before optimization. Route no-model deterministic work without inference.

Expose understandable presets: Auto (balanced), Economy (quality floor), Quality,
Local-only and fixed model, with per-project/per-role overrides. Map these to
versioned policies; Quality still obeys budgets and Local-only cannot cloud-fallback.
Permit only qualified routes. When none qualify, explain the missing capability,
qualification or authority; do not silently choose a cheap untested model. Preserve
independent-review role boundaries and frozen study assignments.

Minimize measured cost per accepted outcome including failures, retries, reviews,
tools, context preparation and conversion/OCR overhead. Display latency, local
RAM/VRAM/queue limits and quota pressure separately where not valid money estimates.
Subscription access is quota-limited; local inference consumes resources. Unknown
pricing stays unknown. Reserve bounded fallback/escalation exposure before dispatch;
never expand a grant or repeat an uncertain external mutation to change models.

Show a concise route explanation, candidate exclusions, estimated versus actual
usage, active policy and override controls. Verify safe concurrency/allocation,
outages, quota exhaustion, drift and rollback. Use frozen representative held-out
task cases to qualify model+effort+context configurations, compare a fixed baseline,
and measure total quality/cost/latency. Any shadow/canary calls need bounded grants.
Do not claim savings or universal sufficiency from fixture tests or self-confidence.
```

**Done:** actual connected routes are qualified for declared tasks, integrated end
to end and explainable, with executed quality-floor, fallback and accounting checks.

### 2.11 File library, editing, search and conversion

**Refinement:** accept arbitrary file types as inert stored attachments within the
§2.6 security policy; publish a per-format matrix for store/download, metadata search,
content search, preview, edit, cite and convert. Unknown binaries can be stored and
referenced without claiming the app understands or can safely edit them. Restricted
types receive an explicit reason. This extends §2.6–§2.9 rather than duplicating them.

```text
Implement COMPLETION_RUNBOOK §2.11. Add a unified file library with names, tags,
collections, recent/pinned files, versions and backlinks to briefs/tasks/sources/
products. Support user-created notes and files, rename/move within the library,
metadata and full-text search for supported formats, and exact-version references
with page/row/section locators. Renames preserve stable links. Search unsupported
files by metadata and report extraction/indexing status. Reuse X03 access-safe
search; add similarity only through a verified approved embedding route.

Start native editing with text/Markdown, code as inert text, structured JSON and
bounded CSV/table editing. Validate structured output and provide draft autosave,
undo/redo, version diff/restore, optimistic concurrency and crash recovery. Add rich
document, spreadsheet and image editing as separately tested adapters; previews
do not imply editing support. Original evidence remains immutable: edits create
derived versions and invalidate affected citations/verification explicitly.
Offer explicit open-with/export-and-reimport where native editing is unsupported;
never let an app-managed attachment overwrite arbitrary host files or auto-launch
executables. External edits are imported as new versions after owner selection.

Provide explicit source-to-target conversion adapters, beginning with useful
bounded pairs such as Markdown/text -> PDF, DOCX -> text/Markdown, CSV <-> JSON
with a schema/mapping preview, and raster image format conversion. Confirm actual
library support before promising each pair. Distinguish text extraction from
layout-preserving conversion. Show lossy features, formulas/macros, encoding,
metadata and OCR limitations; retain originals, conversion version/options and
hash-linked outputs. Preview changes before replacing a selected working version.
Use isolated bounded converters without network by default; cloud conversion
requires its own data-sharing grant. No arbitrary converter/plugin execution.

Verify format fidelity with representative fixtures and round trips where valid,
malformed/large files, concurrent edits, recovery and citation invalidation. Never
claim universal lossless conversion. Update the format matrix and §2.9 acceptance.
```

**Done:** users can find/reference every permitted stored file, edit supported
formats safely and convert declared pairs with inspectable limitations and history.

### 2.12 Command palette, shortcuts and fast navigation

```text
Implement COMPLETION_RUNBOOK §2.12 with one action registry shared by menus,
buttons, command palette and shortcuts. Add searchable commands, quick file/record
switching, recent locations, back/forward navigation and contextual actions. Show
disabled-action reasons; all entry points use the same backend authorization.

Add discoverable remappable shortcuts for page switching, search, new note/upload,
save, navigation and palette access. Prototype a hold-modifier hint overlay with
numbered visible destinations as requested; choose a tested conflict-free chord,
not an assumed Ctrl+number mapping that steals browser tab navigation. Keep web
and desktop binding differences visible. Allow disabling hints/shortcuts; retain
ordinary menus and keyboard focus navigation. Avoid firing while typing, composing
IME input, using AltGr or assistive shortcuts; handle key repeat, blur and modifier
release. Single-character commands must be focus-scoped, remappable or disableable.

Test native/browser conflicts, keyboard layouts, screen-reader announcements,
focus restoration, modal behavior and reduced motion. Switching pages preserves
drafts, scroll and selected record; shortcuts never bypass irreversible-action
review or cause duplicate paid dispatch. Publish an in-app shortcut reference.
```

**Done:** common actions and destinations are discoverable and usable by keyboard,
with no loss of drafts or conflict with ordinary text entry and platform controls.

### 2.13 Explorable knowledge map and related files (X03)

**Refined goal:** an optional relationship map that answers “what is connected to
this file, why, and where did this result come from?” Keep search and a related-files
list useful without opening a graph. Similarity is a suggestion, not corroboration.

```text
Implement COMPLETION_RUNBOOK §2.13 on existing typed links and bounded lineage.
Start with a selected file's local neighborhood; add a bounded workspace overview,
search, type/tag/project/time filters, zoom, pin/focus, legend and breadcrumb return.
Nodes represent files, notes, sources, claims, tasks and outputs. Distinguish explicit
links, provenance/derived-from edges and suggested semantic similarity visually
and textually. Explain each edge with the linked record or matching passage and
model/index version. No invented relationships or automatic equivalence of evidence.

Add optional related-file recommendations, duplicate/near-duplicate suggestions,
manual link acceptance/dismissal and a list/table equivalent for keyboard and
screen readers. Embeddings follow data-sharing/budget rules; lexical/explicit links
remain available without them. Apply permissions before graph counts, labels,
snippets and similarity; deletion/revocation removes affected index/graph access.

Bound query depth, nodes/edges and layout work; disclose truncated/unindexed data,
load progressively, cancel stale queries and keep large graphs off blocking UI
paths. Measure responsiveness on a declared representative library. Persist user
layout preferences separately from authoritative evidence. Verify exact links,
similarity explanations, access isolation and keyboard navigation natively/browser.
```

**Done:** users can explore and understand actual file relationships without a
misleading or inaccessible graph; performance and similarity limits are visible.

### 2.14 Everyday usability and recovery

These additional ideas prioritize completing work and recovering context. Inspect
the current UI first and reuse working pieces; this list does not assert they are
all missing. Implement as bounded submilestones, with each independently reviewable.

| Submilestone                         | User outcome and acceptance                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Useful home and onboarding       | A project-oriented home shows recent work, next action and unresolved blockers. A first-run sample is visibly synthetic and separate from real work. Users can reach a first brief, file and useful result; setup explains missing services and recovery.                                                                       |
| B — Drafts and workspace continuity  | Autosave status, crash-restored drafts, tabs/pins, split source/result inspection and remembered per-project layout prevent lost context. Test restart, unsaved navigation and concurrent versions; avoid offline multi-writer synchronization scope.                                                                           |
| C — Run center and decision inbox    | One durable view shows queued/running/blocked/completed work, last progress, costs, artifacts and next action. Pause/cancel/retry obey lifecycle rules. Decision cards explain consequence and exact approval scope; batch only compatible independently authorized decisions. No fake percentage or ETA.                       |
| D — Trustworthy changes and undo     | Show proposed edits as diffs with affected files/citations, version restore and trash where policy permits. Explain when undo is unavailable for external actions. Bulk tag/move/export uses previews and partial-failure receipts; never imply an outbound action can be unsent.                                               |
| E — Reusable work and handoff        | Save versioned brief/checklist/export templates, duplicate project structure without secrets/grants, and create a resume summary linked to source records. Reuse never imports authority, stale verification or study labels into another project.                                                                              |
| F — Quiet status and actionable help | In-app notifications prioritize finished work, failures and required decisions with deduplication, preferences and deep links. Optional OS notifications require platform consent and redact sensitive content. Errors retain work and offer a concrete retry/fix; a redacted diagnostics export is previewable before sharing. |
| G — Accessible personal preferences  | Theme/contrast, text sizing, density, reduced motion, keyboard focus and date/timezone preferences remain usable in all states. Test long names, empty/large libraries, localization-ready text and real assistive tools where available; record pending checks honestly.                                                       |

```text
Implement the selected COMPLETION_RUNBOOK §2.14 submilestone [A–G] through real
application paths after inspecting existing behavior. State the user task, preserve
permissions/budgets/version binding and define measurable acceptance before edits.
Verify normal, empty, error, recovery and accessibility states on the exact candidate.
Avoid adding settings or notifications without a demonstrated user decision they
support. Record evidence and remaining limitations; do not auto-start other work.
```

### 2.15 Usability validation and delivery order

These additions are a roadmap, not proof of demand. The owner requested planning;
this does not authorize all implementation, external recruitment or public release.
Next work remains the already selected §2.1; select later bounded prompts explicitly.

The decision register now records accepted delivery priorities and preferences
(#11–#21); implementation selection and empirical validation remain separate.

- **First useful release:** existing §2.1–§2.9, §2.10 qualified routing, §2.11 basic
  library/text editing/search, §2.12 palette/navigation, and §2.14 A/C plus draft
  recovery. Prove “bring evidence -> do useful work -> inspect -> take results away.”
- **Next usability increment:** richer tested editors/conversions, §2.13 local map
  and related-file list, then §2.14 B/D/E/F/G improvements based on observed friction.
  Basic accessibility and security remain requirements from the first increment.
- **Later only with evidence:** broad graph overview, additional format adapters,
  advanced personalization and optimization. Keep unsupported functions visible
  as unavailable rather than presenting nonfunctional controls.

```text
Execute COMPLETION_RUNBOOK §2.15 for a declared release scope. Before trials, freeze
the user tasks and practical success criteria: time to first useful result, ability
to find/cite a file, predict data sharing/cost, resume interrupted work, locate a
related source and export a usable result. Record completion, errors, help needed,
owner effort, observed confusion and performance on declared hardware/library size.
Use an owner walkthrough first; additional participants need applicable consent/
research decisions and explicit recruitment authority. Do not send invitations.
Compare with an existing-tool/process workflow where relevant; preserve failures
and separate operational UX testing from frozen thesis evaluation. Prioritize fixes
by observed impact and effort. Record what remains unvalidated; do not claim people
want the product from feature count or repeated tests by one person.
```

**Release scope:** the earlier Group 2 gate remains the core launch/file gate.
§2.10–§2.15 have their own acceptance gates; final acceptance must identify which
are included, verified, deferred or unsupported rather than silently claiming all.

Planning references checked October 20, 2026: [W3C shortcut accessibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)
and [Obsidian Graph view](https://obsidian.md/help/plugins/graph). These inform
interaction planning; they do not establish implementation or product demand.

### 2.16 Undo/redo, history and navigation continuity

October 20 owner-observed defect: navigating away discarded unsubmitted text.
Session-memory page retention and confirmed Reset page fields are now implemented
in the shared UI; see `docs/UX_UI.md` for scope and evidence. This is partial
continuity: reload/restart/workspace-change recovery, comprehensive editor undo and
full native acceptance remain separate gates. Future durable drafts must preserve
text until confirmed successful submission or deliberate clear, retain failed-submit
drafts, isolate workspace/account/record identities and avoid storing credentials.

**Existing foundation:** `apps/web/src/ui.tsx` has hash routes and browser history
updates. §2.11 plans editor undo/redo, §2.12 plans back/forward and §2.14 plans
draft recovery and reversible changes. This milestone makes their shared behavior
explicit; route code alone is not executed acceptance of the complete experience.
Reuse those contracts and the shared action registry rather than separate histories
that disagree. This is planned work and does not alter the current §2.1 scope.

#### 2.16A — Back, forward and finding your place

```text
Implement COMPLETION_RUNBOOK §2.16A on the existing router and §2.12 action registry.
Provide visible Back/Forward buttons with accurate disabled states and destination
labels, keyboard equivalents, and supported mouse back/forward buttons. Integrate
browser history and native-window navigation without double-handling an event.
Use tested platform bindings; do not steal text-editing or browser shortcuts.

Define history entries for meaningful page/record navigation; replace transient
filter typing rather than filling history on each keystroke. Preserve workspace,
record/version, committed search/filter/sort, pagination, scroll, selection and
appropriate focus per history entry. Back/Forward moves location, not data versions
or executed jobs. A new destination after Back clears the forward branch. Handle
reload/deep links and hashchange/popstate consistently; late responses cannot move
the user back or show another workspace's stale data. No tokens or sensitive
document contents in routes/history. Reauthorize every loaded destination.

Add breadcrumbs for hierarchy, a recent-location switcher and a return-to-results
action that restores the prior query and position. Distinguish Back from Up to
parent. Where tabs are included, allow close/reopen-last-closed, pin and restore
views on restart within retention/privacy settings. A missing/deleted/revoked
destination shows a useful state with a safe onward path. Never trap users by
adding duplicate history entries, silently leave the management origin, or reopen
private content after sign-out/account change. External links remain explicit.

Preserve drafts before navigation; when safe persistence is impossible offer
Save/Discard/Stay only for the actual unsaved loss. Navigation must not cancel
background work implicitly. Restore focus to the invoking control when dismissing
a dialog; Escape dismisses the topmost dismissible layer without losing edits or
triggering unrelated cancellation. All controls have ordinary accessible menus.

Durable draft recovery must survive reload, restart and workspace switching.
On sign-out, clear visible/in-memory draft content and authenticated access, while
retaining protected durable drafts according to the user's retention policy.
After sign-in, recover a draft only for the same authenticated owner with current
access to its original studio/workspace/record. Another account, an expired session
or revoked workspace access must not expose draft text, previews or search snippets.
Provide explicit discard and explain retention/expiry; sign-out alone must not
silently delete recoverable drafts. This is planned behavior, not the current
session-memory implementation.
```

**Acceptance:** navigate search -> file -> linked source -> task, then Back/Forward;
verify exact route, query, scroll, focus and draft restoration. Exercise forward-
branch replacement, deep-link reload, rapid navigation/late responses, restart,
closed-view restoration, workspace changes and revoked/deleted records in browser
and native Windows. Record which history state persists across restart.
For durable drafts, verify sign-out hides content, another account cannot recover
it, and the same owner signing back in can recover it only after access checks.
Exercise expiry, explicit discard and revoked access without cross-account leaks.

#### 2.16B — Scoped undo/redo and reversible changes

```text
Implement COMPLETION_RUNBOOK §2.16B through existing editors/versioned commands.
Define separate editor history, reversible record/file changes and navigation
history. Undo never means Back. Support standard editor Undo/Redo and discoverable
menu/palette actions with labels such as Undo rename and disabled reasons.
Ctrl+Z affects the focused editor first; support tested redo bindings and IME,
paste, multi-field edits and bounded grouping. Do not override ordinary native
input undo. A new edit clears the relevant redo branch. Scope stacks to the
document/workspace, with clear behavior on focus changes, reload and restart.

Add reversible rename, tags, collection moves, draft edits and soft-delete/restore
where policy permits. Group a bulk operation into an inspectable transaction when
atomic, otherwise expose partial results and scoped reversal. Undo/redo is a new
authorized, audited versioned command: check current permissions and expected
version, retain original history and handle concurrent changes without overwriting
someone else's work. Repeated requests are idempotent; unrelated refreshes must
not silently reset editor history. Bound retained history and remove sensitive
draft/history content according to sign-out, deletion and retention policy.

Distinguish unsaved editor undo from restoring an earlier saved version. For saved
or AI-generated changes, preview diffs and restore as a new version with lineage;
invalidate affected verification/citations. Never rewrite evidence originals.
Provide Trash with retention/restore state and an explicit irreversible permanent
deletion action where supported. Brief Undo notices supplement persistent history
controls; expiring a notice does not unexpectedly destroy recoverability.

Declare non-undoable actions honestly: sent messages, charges, external publication,
dispatched jobs and grants cannot be reversed by replaying a local stack. Show
supported cancel/revoke/refund/compensating paths with their own permissions and
confirmation requirements. Redo never automatically repeats paid/external actions,
restarts work or restores expired authority. Pause/cancel remain run controls.
```

**Acceptance:** edit/undo/redo across typing and bulk changes; change focus between
documents; create a new edit after undo; handle failed saves, concurrency conflicts,
restart and revoked access. Restore deleted items and saved versions with intact
audit history. Verify navigation never mutates data and shortcuts never replay an
external action. Inspect keyboard-only behavior, announced state and menu labels.

**Delivery:** implement §2.16A and basic editor undo/redo with the first useful
release in §2.15. Add persistent reversible library actions with the corresponding
§2.11/§2.14 features. Include these checks in §2.9 and final §5.6 acceptance for the
selected release; document unsupported reversals. Update help/shortcut reference,
BUILD_STATUS and SESSION_HANDOFF with executed evidence, not planned completion.

## Group 3 — Prove a complete real workflow

The current generated-product recipe is a bounded Python standard-library CLI. Arbitrary websites, services and other product types require a separately specified extension. Local model quality is measured, not assumed equivalent to a reference hosted model.

**Accepted #22–#24:** use a research-team CSV quality checker example (missing values,
duplicates, inconsistent columns and readable reports), comparing existing tools
before custom building. Prepare public/synthetic clean, empty and malformed inputs
with frozen expected results, original preservation, useful errors and isolated
exported startup. Exclude sensitive data, release, payments and outreach. Obtain
actual owner feedback after use; one bounded revision follows the exact candidate.

```text
Prepare a real discovery-to-product acceptance run for:
[problem, users, examples, outputs, constraints]
Use the chosen verified model connection and real approved sources. Record exact
scope, maximum exposure, call/time/repair limits, human decision points and stop
conditions. Include existing-tool, process, human-led and hybrid alternatives
where relevant. Prepare workspace/run/grants; do not force a custom build.
Keep this operational acceptance distinct from the frozen comparative study.
```

Approve the concrete scope/grant if it is not already covered. For local inference specify time/concurrency/output limits even when no API fee applies.

```text
Execute the prepared acceptance run within its recorded authority. Preserve
evidence, alternatives and decisions. If software is selected, continue through
frozen spec, task DAG, isolated implementation, independent review, executed QA,
package integrity, private preview and source download. Verify exported startup
in the supported isolation. Exercise material recovery/cancel risks. Inspect the
actual UI with available browser/native controls. Retain failures and actual usage.
Include a supported user-file attachment as an input and verify its original,
source locators and permitted use. Download the supported result/source package
and evidence export through §2.8, preserving input-to-output lineage.
```

**Jordan:** try normal and invalid/empty inputs. Compare outputs to acceptance criteria. Supply one concrete defect or improvement against the exact release.

```text
Record this feedback against the exact release: [feedback].
Execute one bounded revision within the grant, or identify precise missing scope.
Preserve the original. Repeat affected review/tests and exported startup. Show
source -> decision -> spec -> commit -> test -> release lineage and total usage/cost.
```

**Done:** a real run has a verified usable package and feedback revision, or a justified non-code outcome. A non-code outcome does not by itself verify the builder path; retain a separate software-path acceptance example.

## Group 4 — Bounded owner pilot

This operational pilot is separate from the formal thesis comparison. The existing $20 runtime ceiling does not automatically authorize a pilot or cover unrelated hosting/development bills.

**Accepted #25–#32:** Jordan; seven days after installed acceptance;
America/New_York; $0 new metered/API spending; stop after three consecutive failures
or 120 owner intervention minutes; Windows app/isolated worker; verified local and
subscription connections; manual runs, no schedules. Permit private research,
alternatives, isolated build/review, files and exports; exclude publication,
messages, commerce, ads and unrelated repos. One model job and one build at a time,
30-minute run maximum, stricter worker limits retained. Pause on unknown cost/no
qualified authorized route. Exact dates and hardware RAM/VRAM bounds remain to fill.
Prepare the concrete pilot below and obtain its candidate-bound approval before execution:

```text
Owner:
Start/end dates and timezone:
Maximum pilot spend:
Maximum consecutive failures:
Maximum owner minutes:
Platforms (start with verified local desktop/worker):
Enabled accounts/connections:
Schedules (or explicitly none):
Permitted activities:
Excluded activities:
Local resource/time limits:
Quota exhaustion behavior:
```

```text
Prepare config/owner-pilot.json from these choices: [settings].
Validate the actual schema, remaining runtime ceiling, open reservations and
unknown exposure. Include child work/retries/reviews/tools. Reconcile the existing
pilot/readiness gate with real Ollama and subscription connection semantics through
a documented versioned change if necessary; never mark local inference fixture or
claim broad readiness merely to pass. Preserve study protocol and money safeguards.
Run pnpm readiness pilot-check. Present the exact pilot and remaining blockers.
```

Approve the concrete pilot, then:

```text
Execute the prepared authorized owner pilot from the installed app. Record
successes, failures, usage/costs, cleanup, interventions and owner time. Verify
pause/cancel, failure stops, quota/unknown-cost behavior and restart recovery.
At the end stop schedules, reconcile exposure, verify restoration and archive
the exact candidate. Record the truthful outcome, not automatic completion.
```

**Jordan:** use the app normally, record intervention time and confusing behavior, answer real decision requests and retain failure reports. Report whether launching and using the studio actually feels self-contained.

**Done:** a bounded repeated-use report reconciles outcomes/resources and identifies maintenance burden. Global full-product readiness may still remain not ready for deferred integrations.

## Group 5 — Broader integrations

Complete each as a separate bounded task. They need not block useful local operation.

### 5.1 GitHub

**Accepted #33–#35:** confirm the existing personal account (or existing dedicated
organization) and scoped installation. Initial verification uses one new private
`creator-agent-` repository, no existing repos. There is no universal three-repo
product cap: users select access/creation scope and configurable per-run/project
creation/rate limits. Existing repositories require explicit immutable IDs. Prepare
PRs; owner approves merges of exact reviewed heads with applicable build/typecheck,
meaningful tests and independent review. Exact account/target and grants remain gates.

```text
Complete X04 live verification. Use docs/GITHUB.md and current official docs to
prepare endpoint-compatible scoped auth. After authorization verify owner identity
and one private repo/branch/push/PR/check workflow. Merge only an authorized exact
reviewed head with required checks. Verify revocation/uncertain reconciliation.
Record immutable IDs and actual provider evidence, not coding-tool GitHub access.
```

### 5.2 Signed Windows distribution and updates

**Accepted #36–#39:** small private beta then public beta after gates; evaluate
Microsoft Artifact Signing first with trusted-certificate alternative if unsuitable;
GitHub Releases in a deliberately selected distribution repository for downloads/
verified updates. First public scope is local Windows studio with user connections
and documented worker/format prerequisites. Eligibility, actual cost, enrollment,
repository and exact publication authority remain pending. Protect signing secrets.

```text
Finish X05 distribution after persistent startup works. Implement signed packaging
and authenticated update verification, version/rollback safeguards, recovery from
failed/interrupted updates and data-preserving uninstall. Verify offline/read-only
cache, reconnect, secure persistent sign-in and worker revocation natively. Build
an installer and test on the supported Windows target. Do not claim browser-only
checks prove installed-app completion. Public publication needs matching authority.
```

#### Public-release deliverables and acceptance

These are required for public Windows distribution, in addition to the installer
and update work above. They do not block a private acceptance build under §2.1.
Hosted operation, payments and campaigns are required only if the selected release
includes those capabilities; document exclusions accurately.

**Accepted #40–#43:** source remains private during private beta; public license
selection deferred until before public release. Use public nonsensitive issue
tracking plus a private vulnerability channel; owner supplies actual contacts.
Automatic diagnostics off; previewable local redacted diagnostics export. Owner
approves exact signed package/destination after checks. No publication, new account,
purchase, telemetry activation or external message follows from these choices.

- **Supported systems and prerequisites:** publish the tested Windows versions,
  architectures, minimum hardware/storage and network requirements. Distinguish
  basic studio requirements from local-model and isolated-worker requirements.
  Explain which dependencies are bundled, managed or externally configured,
  including PostgreSQL, WebView2, WSL and optional Ollama where applicable.
- **Clean-machine acceptance:** test the exact installer on a clean supported
  Windows VM or machine without the repository or development tools. Exercise
  first-run prerequisite setup, ordinary-user launch, missing dependencies,
  create/quit/relaunch persistence, upgrade from the previous supported version,
  interrupted-update recovery, uninstall and reinstall. Verify the documented
  data retention/removal behavior. Record actual OS/build, package hashes,
  results and remaining unsupported configurations; do not infer coverage.
- **Download and user documentation:** prepare a public download page with the
  version, signed installer, checksum, supported systems and release notes.
  Include installation, model/connection setup, update, backup/restore,
  troubleshooting, uninstall/data-removal and support instructions. Explain
  background/quit behavior, provider costs and known limitations. Verify links
  and ensure screenshots and claims match the candidate.
- **License and privacy materials:** include the chosen application license,
  dependency inventory and required third-party notices for shipped components.
  Document local storage, provider-bound context, credentials, logs, retention,
  deletion and any diagnostics. Keep optional diagnostics disabled unless
  deliberately configured. Check distribution terms for any bundled runtime or
  model; do not assume local availability grants redistribution rights. Record
  unresolved license/privacy decisions and obtain appropriate review where needed.
- **Release security review and response:** review the exact candidate's installer,
  update/signing trust, credential storage, exposed local services, generated-code
  isolation and shipped dependencies. Track findings and fixes with verification;
  resolve release-blocking findings before publication. Publish a working private
  vulnerability-reporting route and document ownership, triage, patch/update and
  signing-key revocation/recovery procedures. Never publish credentials or private
  vulnerability details in the release packet.

```text
Complete the public-release deliverables in COMPLETION_RUNBOOK §5.2 for the chosen
Windows release scope. Preserve the §2.1 lifecycle contract. Prepare the support
matrix, clean-machine installation/upgrade/recovery evidence, download page and
user documentation, license/notices and privacy/data-flow materials, and exact-
candidate security review with a vulnerability-response procedure. Use current
official dependency/distribution documentation during implementation. Bind the
release manifest to installer/update hashes, source revision and executed checks;
retain explicit pending/unsupported states. Prepare the concrete publication
package for owner approval; do not publish or activate services automatically.
```

**Done:** the chosen public release has an inspectable package and completed
applicable gates above, with owner decisions and evidence bound to the candidate.
Publication is a separate authorized action. Any later candidate change requires
repeating affected checks; an installer build alone does not satisfy this gate.

### 5.3 Hosted operation and alerts

**Accepted #44–#46:** defer hosted activation; $0 hosted spending until a reviewed
staging plan. Choose exact account/provider/domain/region/IdP, cap, data-specific
retention and owner-controlled alert destination at that gate using a costed
comparison. Preparation can proceed; production follows reviewed staging evidence
and separate activation authority.

```text
Complete X06. Build/repair deploy/hosted images and prepare a costed staging plan.
Include separate environments, verified database TLS, durable artifacts, OIDC,
secure cookies, isolated preview origin, proxy rate limits, secrets, monitoring,
backups and rollback. Implement the chosen scoped external alert delivery adapter.
After authorization deploy staging; execute authenticated checks, restore drill
and hosted-to-local pairing. Use pnpm ops config-check and documented smoke/build-
bound verification. Prepare live activation as a separate concrete decision.
```

### 5.4 Payments and reinvestment

**Accepted #47–#49:** free beta with users' own model access. Defer live commerce;
qualify existing payment adapter in test mode when needed, after actual account
confirmation. Pricing/refunds/entitlements wait for measured value/support cost.
Reinvestment disabled; percentages/reserves/holdback/caps need a later explicit
policy based on reconciled earnings. Test credentials/onboarding and live activation
remain distinct gates; no commercial account or charge is authorized here.

```text
Finish X07 in two stages. Verify actual processor test-mode checkout, signatures,
authoritative reads, entitlements, refunds, duplicate/out-of-order events and
financial reconciliation. Then implement separately disabled live mode using
current docs, deliberate API versioning, isolated credentials and real-workspace
rules. Prepare activation review. Test money never funds real budgets. Keep
reinvestment disabled absent owner policy; verify loss handling synthetically.
```

### 5.5 Campaigns and advertising

**Accepted #50–#52:** first delivery check is owner-controlled and separately
authorized with exact provider/recipient/content/cap/dates. Real campaigns use an
explicit opt-in audience, suppression/unsubscribe and reviewed claims; exact campaign
scope is decided later. Advertising remains disabled until a useful public product,
evidence, supported bounded adapter and explicit account/spend decision exist.

```text
Complete X08 real delivery: provider adapter, public unsubscribe/suppression,
content/audience-bound grants, delivery limits, native receipts, deduplication
and uncertain-outcome reconciliation. Test locally and with an explicitly
authorized owner-controlled test recipient/provider test mode. Prepare a concrete
evidence-backed campaign. Do not send beyond a matching grant. Paid advertising
requires its own supported adapter with enforceable cost caps; keep disabled until
implemented, verified and authorized.
```

### 5.6 Final acceptance

#### 5.6.1 Final UX/UI and friction review

Run this pass after all functionality selected for the release is integrated and
before final candidate acceptance or publication. Deferred features do not block
the pass, but their status must be clear. Earlier accessibility/usability work
remains required throughout implementation; this final pass checks the combined
experience across feature boundaries. Repeat affected checks after repairs.

Review the installed app and supported browser experience as a user completing
real tasks, not just as isolated screens. Include first launch/setup, creating or
resuming a project, adding files anywhere, finding/citing sources, model/budget
configuration, running work, handling decisions, inspecting edits, exporting results
and returning after interruption. Include empty, loading, offline, quota-limited,
permission-denied, failed, partially completed and recovery states.

| Review area                   | Required user experience                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orientation and next action   | Consistent navigation, labels, breadcrumbs and sensible defaults make location, available actions and the next useful step clear. Preserve drafts and context; remove unnecessary repeated entry, page hopping and already-covered approval prompts.                                                                                                                 |
| Running work                  | Immediately acknowledge accepted actions. Distinguish queued, running, waiting for input, paused, cancel requested, canceled and failed. Show actual stage, last update, relevant budget/usage and available controls. Use determinate progress/ETA only when supported by evidence; explain uncertain or stale status.                                              |
| Completion and changes        | Give clear success, partial-success or failure feedback with links to actual outputs. Show what changed, where it was saved, affected versions/citations, and a useful next action. Distinguish saving a draft, committing a change, finishing a job and verifying a result. Keep durable receipts/history for important work; a disappearing toast is insufficient. |
| Errors and recovery           | Explain what happened and how to fix it in plain language. Preserve entered work, show per-item failures for bulk actions, and make retry/cancel/undo/restore behavior clear. Prevent duplicate submissions and accidental destructive actions without claiming external effects are reversible.                                                                     |
| Notification quality          | Prefer inline status for local actions and a persistent run/decision center for ongoing work. Use quiet, deduplicated notifications for meaningful outcomes or required action, following user preferences. Do not steal focus, interrupt typing or expose sensitive details.                                                                                        |
| Consistency and accessibility | Check visual hierarchy, spacing, typography, contrast, responsive/window-size behavior, readable density and consistent control states. Verify keyboard-only navigation, shortcut discoverability/conflicts, focus order/return, screen-reader status announcements, zoom and reduced motion. Important meaning cannot rely only on color, animation or hover.       |
| Trust and control             | Clearly expose source provenance, fixture/live status, model/data destinations, spending estimates versus actual usage and grant scope. Settings and destructive actions explain consequences; unsupported features have honest labels. User feedback must reflect authoritative application state.                                                                  |

```text
Execute COMPLETION_RUNBOOK §5.6.1 after the chosen release features are integrated.
Read current UX docs, accepted owner decisions and §2.15 task-based validation.
Declare the exact candidate, release scope, representative data/library size,
supported platforms and user journeys before reviewing. Inspect the actual rendered
UI at supported window sizes and walk normal, error, interruption and recovery
paths. Include long-running, background and bulk operations: can the user tell
what is happening, what finished/changed, where the result is and what to do next?

Record reproducible friction with task, steps, observed behavior, expected outcome,
severity and screenshots or other concrete evidence. Prioritize lost work, misleading
status, inaccessible actions, dead ends and unexpected external/cost consequences.
Repair findings through real UI/domain paths; avoid cosmetic controls masking
missing behavior. Preserve budgets, permissions, provenance and research conditions.
Re-run affected functional and usability checks on the final repaired candidate.

Use an owner walkthrough first. Additional user sessions follow §2.15 recruitment/
consent boundaries; record actual completion, errors and help needed, not invented
satisfaction or demand. Archive before/after evidence and a concise remaining-friction
list. Update UX docs, BUILD_STATUS and SESSION_HANDOFF. This pass does not authorize
publication or automatically implement deferred capabilities.
```

**Gate:** no unresolved release-blocking UX findings such as silent draft loss,
false completion feedback, inaccessible critical paths or accidental duplicate
consequential actions. Remaining minor issues have explicit severity, workaround
and disposition. Evidence binds to the final candidate; native checks left pending
prevent a claim of fully verified installed-app UX. Owner reviews the actual
experience and remaining issues before release approval.

#### 5.6.2 Exact-candidate product acceptance

```text
Repeat X10 on the exact final candidate. Reconcile requirements and integrations
with executed evidence. Check applicable live/native paths, cost/uncertain actions,
restoration, clean installed startup and archived package. Report local-studio,
hosted/distributed, commerce/marketing and thesis readiness separately. Explicitly
list deferred/unsupported capabilities. Passing build or local pilot is insufficient
for a blanket product-completion claim.
For public Windows distribution, include every applicable §5.2 public-release
deliverable and its exact-candidate evidence. Keep prepared, verified and published
states separate; missing release gates prevent a public-release readiness claim.
Include §2.9 file-workflow evidence and the published supported-format/limit
matrix; verify upload privacy, original/result downloads and export exclusions.
Require the final §5.6.1 UX/UI review and affected post-repair checks on this same
candidate; include its unresolved-friction report in the release decision.
```

## Thesis work remains separate

Resolve RD1-RD10, applicable committee/IRB requirements, protocol freeze, actual comparisons, independent ratings, reproducible analysis and thesis/defense acceptance. Do not substitute this operational pilot or new model qualification for frozen research conditions. Do not silently replace a study reference model with Ollama or subscription-backed models.

Owner direction for RD1–RD10 is now recorded in the decision register. Actual
reviewer identities, institutional determination, model access, final task identities,
feasibility and exact protocol adoption/freeze remain gates; acceptance of direction
does not fill these with invented values or activate the study.

## Sources and verification boundaries

Repository references: `docs/LOCAL_DEVELOPMENT.md`, `apps/desktop/README.md`, `apps/desktop/src-tauri/src/main.rs`, `docs/AUDIT_FIXES_2026-10-20.md`, `docs/GITHUB.md`, `docs/HOSTED_OPERATION.md`, `docs/PAYMENTS.md`, `config/readiness.json` and `config/owner-pilot.json`.

Official sources consulted October 20, 2026 (recheck during implementation):

- [Ollama model discovery](https://docs.ollama.com/api/tags) and [chat API](https://docs.ollama.com/api/chat).
- [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart): eligible plan use is distinct from identity-only sign-in, with client eligibility/registration requirements.
- [ChatGPT-plan Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server): supported authorized-token integration and model-access verification.

This runbook and owner-decision update does not itself implement features, activate
accounts, download models, perform inference or authorize new spending. U02 and
fresh-studio adoption have recorded evidence in tracking. Current §2.1 has installed
supervisor evidence but still needs interactive acceptance and reconciliation of
the newly accepted close default; see BUILD_STATUS and `docs/DESKTOP_STUDIO.md`.
After that, next eligible is §2.2 by explicit selection. Owner decisions are in the
linked register; implementation/activation and research freeze remain separate.
