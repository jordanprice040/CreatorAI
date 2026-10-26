# Theme-intent installed acceptance plan v4 — October 24, 2026

Status: planning revision after Claude's exact-v3 review. Independent exact-v4
review required; execution blocked. Frozen v2/v3, prior proposals, helper/package
bytes and historical receipts remain unchanged. No operational authority granted.
Full C54 remains partial.

## Scope, identities and current gates

Test the installed Windows theme-draft save/resume and dirty-input guards. This is
a UI-only observation plan with limited accounting visibility, not a whole-database
post-acceptance preservation or zero-dispatch certification.

| Binding                     | Required value or evidence                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Package candidate           | `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`                                                                    |
| Installation plan           | `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`                                                                    |
| Reviewed helper             | v4's complete `helper_sha256` map and hash of its repair receipt under `tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/` |
| Independent helper support  | Supported exact `/4` reviewer receipt; rehash its complete map                                                                        |
| Actual installation/session | Historical actual installation completion and run-01 chain exist; current continuity/session scope pending                            |

Actual installation and schema29 pre-UI verification supersede earlier pending
helper/backup/install/migration prerequisites. Bind the supported v4 reviewer map,
installation completion receipt and referenced operational-before-v4 run-01 chain.
See THEME_INTENT_INSTALLATION_RESULT_2026-10-24.md. No evidence warrants repeating
preparation, backup, installation or migration. Historical installation admission
age limits do not create a new acceptance deadline. Current identity, continuity,
observation implementation/review and a bounded session decision remain pending.

The session decision names operator, workspace ID, owner/editor role, allowed local
sign-in and launches, maximum two labeled drafts and one revision, UI-only evidence
limits, retention, and stop rules. Viewer is insufficient. Prefer an explicitly
selected existing workspace; creating one is an additional mutation needing scope.

## A0: preservation before the first desktop launch

Before launch, inspect already produced redacted installation evidence. Do not run
helpers, query SQL or obtain credentials merely to fill this checklist. Require:

- Exact candidate/plan, supported helper map and actual installed native/manifest
  hashes, not DisplayVersion alone.
- A successful operational `after` receipt from the reviewed helper, schema 29,
  `fixture:false`, the bound migration-result chain and recorded preserved state.
  For v4 this is `verification-<uuid>.json`, with `at`, `state.observed_at`,
  `state.schema` and state hashes. Successful execution checks target program,
  backup, migration identity, prior-state preservation and quiescence; the state
  hash map alone is not a serialized list of zero-count query results.
- Successful phase completion and cluster-stop evidence, with no retained or
  uncertain lease. An incomplete run's verification file alone is insufficient.
- Native-layout evidence establishing actual `postgres/data` use from the reviewed
  helper and operational run, not just a test fixture.
- An operator-maintained launch timeline: migration completion precedes
  `state.observed_at`, then verification completion and stop precede first launch.
  No desktop launch between installation and successful `after`. Record first
  launch time; absence of launches is an operator attestation, not proven solely
  by a receipt timestamp. Any launch or uncertain gap blocks this gate.

Missing migration result, partial installation, stale identities or uncertain
state means stop. No GUI migration, helper retry, stale release or rollback is
authorized by this plan.

## Launch effects and observation boundary

The installed service starts its in-process workflow worker. There is no reviewed
UI control to turn it off. Launch may ensure system actors, sweep broker/retrieval
state and drain the outbox; sign-in may create challenge/session/audit records.
These are expected categories, not permission to explain away arbitrary changes.
Record visible instances and times separately from theme-draft writes.

A0 must establish no eligible non-terminal workflows/tasks or active/uncertain
exposure at the pre-launch observation. Keep other operators and work producers
idle. This checkpoint is not a continuous no-work guarantee. The session decision
must acknowledge worker startup and the UI-only evidence limit; it never grants
provider dispatch or new workflow execution. If the required safety claim is
continuous prevention or exhaustive zero dispatch, this UI-only plan is blocked
until a separately implemented, reviewed and authorized inspection/control path
exists. Do not silently weaken that requirement.

For this narrow session Jordan accepted exact reviewed-bundle configuration
evidence as the scheduler-configuration standard. Require fresh installed identity
matching the reviewed studio.mjs hash named in proposal v2. Report configuration
fixed off by reviewed bytes, never observed live scheduler state. No UI scheduler
indicator is required or invented; unavailable/mismatched configuration identity
still stops. Worker startup, continuity and exhaustive-dispatch limitations remain.
No health request, settings change, SQL/credential access or launch-to-observe.

## Evidence and read-back scope

Use a new session evidence directory and record identities, receipt hashes,
workspace/role, tester, decision provenance, timezone and start/end/launch times.
Exclude passwords, cookies, headers, login codes, sign-in approval URL IDs, DPAPI
contents, plan credentials and sensitive responses. No developer-tools response
capture, CLI login, direct SQL, copied service login code or new API session.

After authorized local sign-in and before synthetic writes, record a UI baseline:

| View                                        | Record                                                                                             | Limit                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Catalog, `theme_intent` kind and any status | All matching IDs, titles, versions and status; require empty before first test create              | Selected workspace only; clear search filters and inspect all pages  |
| Activity                                    | Session-window entries, actors, actions, subjects and times; inspect all pages back to baseline    | A partial page or filter cannot prove absence of events              |
| Monitor and run records in Catalog          | Visible run/workflow state, with matching workspace and explicit filters                           | UI projection, not every execution table or all workspaces           |
| Budgets and spending                        | Displayed incurred/charged, reserved/in-flight and unknown exposure, per budget/call where visible | Subscription requests or unprojected events may have no money change |
| Decisions and model/connection views        | Visible decisions, saved status and qualifications, without verify/refresh/qualify actions         | No whole-table or protected-file equality claim                      |
| Operations                                  | Schema/build display, workflow leases, local jobs, unknown outcomes and alerts actually shown      | Readiness alone is not exact binary identity or scheduler status     |

Revisit these same views after writes with the same workspace, filters, pagination
coverage and units. Loading/error/stale views mean unavailable evidence, never
zero. Do not click Retry on an uncertain mutation or a control-window setup error;
ordinary read-only view refresh is distinct and may be used only when clearly so.

Maintain a two-record ledger: session label, A/B, actual ID, workspace, title,
version, status, save/revision times, Activity locator, final retention and any
uncertainty. Put labels in the theme field, which becomes the title. Expected
maximum: A v1→v2 and B v1. Raw content hashes and domain format fields are not
visible UI outputs; ledger hash = `not directly observed`. Plan-panel rendering
indirectly demonstrates the client's schema/content-hash equality check at that
moment. Never invent a hash or claim a row-level comparison from table hashes.

## Result classes and installation observations

Every result has a class, timestamp, evidence locator and status
pass/fail/blocked/not-run/unverified. All cases begin not-run.

| Class | Meaning                                                      |
| ----- | ------------------------------------------------------------ |
| F     | Earlier fixture/API/intercepted-browser evidence, cited only |
| I     | Real installer execution and installed program verification  |
| R     | Actual per-user registry and shortcut observations           |
| N     | Installed native UI observations by the named tester         |
| H     | Jordan's own explicit dated human acceptance statement       |

I-01: inspect the actual installer outcome's exit code, intent/result chain,
installer hash and reviewed post-install native/manifest hashes. A successful copy
fixture or UI version label is not I evidence. No installation is executed here.

R-01: when separately scoped, read the exact current-user uninstall registration;
record installed path, uninstall target and DisplayVersion. Check against the
already verified path. DisplayVersion `0.1.0` alone cannot distinguish builds.

R-02: when separately scoped, read existing Start-menu/desktop shortcut presence
and targets and compare with pre-install observations. `/S /NS` skips shortcut
creation; do not require new shortcuts or assume existing ones were preserved.
Missing, stale or unknown prior shortcuts are findings/gaps. Do not create,
repair, delete or launch shortcuts to make the check pass. Registry/shortcut
inspection uses only the installed user's scoped metadata, never secrets.

## Native UI cases

| ID    | Action                                                                                                                                                                                                                          | Required observation and boundary                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NI-00 | First authorized native launch after A0; record time and control state                                                                                                                                                          | Control reaches running. Stop without clicking migrate, Approve, Retry, Setup, adopt or connect if it shows needs_migration, setup, failed or any unexpected state. Do not use the desktop's alternate migration path.                                                                                                                                          |
| NI-01 | Authenticate locally if required; confirm workspace/role; open Submit and capture UI baseline                                                                                                                                   | Local desktop sign-in may open the system browser at loopback and require a human code comparison; exclude URL ID/code from evidence. Restored sign-in may be automatic. Stop for ChatGPT/plan-account sign-in or other provider authentication. No verify/qualification button is used. All-theme draft list and Catalog kind filter are empty before NI-02.   |
| NI-02 | Enter synthetic A in the theme field and click Save draft and prepare plan once                                                                                                                                                 | Exactly one A v1 in draft list and selected Catalog detail, active status and actual ID; exactly one corresponding creation Activity entry. Capture ledger. Raw entity format is not directly observed.                                                                                                                                                         |
| NI-03 | Inspect A's plan panel                                                                                                                                                                                                          | Panel renders saved version 1 and preparation-only prose. This is declaration wiring and indirect client schema/hash-binding evidence. Literal zero-request/fetch/spend declarations are not measured zero dispatch; no raw hash/format is claimed visible.                                                                                                     |
| NI-04 | After save, record running state, use explicit tray/menu Quit, record any visible stopping indication and app exit; require separately scoped SH-01 shutdown observation before relaunch and Resume A; Save unchanged form once | Saved fields/identity persist. Plan panel need not persist. Draft list and legend remain v1 with no create/revision Activity entry. The clean Save notice says Draft saved even without a write; it is not proof. Record restored/new auth bookkeeping separately.                                                                                              |
| NI-05 | New theme draft; save synthetic B once with context, constraint, question and proposed `https://example.com/` URL                                                                                                               | B v1 appears exactly once with expected ID/status and one creation entry. Resume shows saved optional fields. URL remains proposal; UI observations do not independently prove zero network retrieval.                                                                                                                                                          |
| NI-06 | Resume A, add unsaved context marker; click New twice, Resume B, then Resume A while prompt is open                                                                                                                             | Marker and A v1 identity remain; confirmation stays effective. Pending target is the last clicked action and is not named in the prompt; do not assume B is still pending. No new create/revision event.                                                                                                                                                        |
| NI-07 | Keep editing, then click Reload saved version twice without confirming discard                                                                                                                                                  | Marker remains; Keep editing clears pending prompt and repeated ordinary Reload remains guarded.                                                                                                                                                                                                                                                                |
| NI-08 | Explicitly click Resume B again, then Discard edits and open                                                                                                                                                                    | B loads only after explicit discard, with saved fields/v1. A's stored v1 remains unchanged in list/Catalog. Deliberate loss of synthetic unsaved marker is expected.                                                                                                                                                                                            |
| NI-09 | Resume A; edit context, open ordinary navigation confirmation, then save rather than discard                                                                                                                                    | Exactly one revision to A v2 and one revision Activity entry; obsolete prompt clears; plan panel binds saved v2 indirectly. Clean navigation works.                                                                                                                                                                                                             |
| NI-10 | Before any disposition/normal work, compare UI baseline and ledger across the same views and full session window                                                                                                                | A v2 and B v1 only; explain expected auth/startup bookkeeping. No observed new workflow/run/provider/retrieval action or exposure. Any incomplete observation remains unverified. Whole-database equality, all-grant/request/qualification equality, raw content hashes and exhaustive zero dispatch after UI activity are expressly not verified by this plan. |

No provider, source-fetch, workflow-start, qualification, model verification,
permission, connection or budget-setting action is part of these cases.

## Errors, stop rules and disposition

Stop new writes on uncertain save/load, unexpected version/duplicate, guarded input
loss, nonempty initial theme list, worker/broker/retrieval dispatch, new execution,
changed charged/reserved/in-flight/unknown exposure, unrelated state changes,
missing baseline coverage, or unexpected control/authentication state. Do not call
ordinary sign-in/outbox housekeeping a dispatch without inspecting its action and
actor; unexplained events stop the session. Capture redacted evidence and the last
known entity/version. A stopped session is not a passing check.

For an uncertain save, reconcile visible ID/version/Activity before considering
retry. An identical in-window payload may retain an idempotency key, but edits,
reload, relaunch or changed page state lose that protection. No blind retry is
permitted. If commitment cannot be established with UI evidence, stop for a scoped
reconciliation decision; do not obtain credentials or force another write.

Do not induce operational outages/conflicts, intercept native production traffic,
edit underlying records, or force failed loads. If a failure occurs naturally,
inspect retained input/identity without further mutation. Failure cases with only
isolated evidence remain F/not-run for N. The New/Resume/Reload guard does not
promise draft preservation on route changes, refresh, close or OS shutdown.

Default disposition: retain A/B as labeled synthetic data, with final IDs,
versions/status in the ledger. No reviewed archive UI exists. Archival needs a
separately reviewed and authorized exact-ID/version path with no credential
exposure; it is not an executable option in this plan. No deletion or broad title
match. Finish with explicit tray/menu Quit and record stopped/unknown runtime
state; failed Quit requires scoped follow-up, not unrelated process killing.

Acceptance failure never authorizes rollback. Schema-28 recovery requires a new
coordinated snapshot-plus-matching-program decision, preserving failed evidence;
never install old binaries alone over schema29.

## Completion and next step

Record F/I/R/N/H separately, exact identities, completed/failed/blocked/not-run
cases, visible state/exposure changes, ledger retention and observation gaps.
N performed by an agent/tester does not establish H. Only Jordan can supply his
own dated acceptance statement. Do not present this plan or its review as that
statement. Full C54 and source-collection/live-discovery/lifecycle acceptance
remain partial even if every narrow visible case passes.

Historical v2 prerequisite wording retained below is superseded by the v3 reconciliation. ## V4 observation gates and finding disposition

Companion: THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V2_2026-10-24.md.
Jordan selected exact-bundle configuration evidence for this narrow UI-only session
on October 24 in this conversation. A fresh installed identity check matching the
reviewed studio.mjs bundle may satisfy the scheduler-configuration gate. This is
configuration evidence, never observed live state or continuous prevention. The
worker remains on; continuity, no new execution authority and UI-only limits remain.
Proposal v2 names exact bundle identity and input sources. A missing/mismatched
identity or unknown active configuration blocks. Earlier references to unknown
scheduling as a stop condition mean unknown configuration under this explicitly
accepted standard; no launch-to-observe or health request resolves it. No new
startup-admission candidate was selected, and no operational/session grant follows.

SH-01 is required after NI-04 Quit before relaunch and after final Quit. Planned
Quit is allowed only after recorded running state. Record Quit request, stopping
if actually seen, exit if seen, and observation receipt/time. There is no required
visible stopped state; exit, including exit code zero, does not establish shutdown.
The observation contract is not implemented/reviewed/operationally authorized.
Missing, stale, ambiguous, failed or timed-out SH-01 means unknown and blocks
relaunch and passing acceptance/normal-use handoff. No second Quit, kill, service
stop or recovery is allowed to produce a pass. Later read-only re-observation
requires a new separately scoped decision and evidence directory; it cannot erase
the initial unknown result. Record both and any changed state.

Window closing is not the NI-04/final explicit Quit step. The control window hides
when running and invokes Quit otherwise (main.rs:52–67). Studio-window closing
backgrounds or quits according to saved close_behavior (main.rs:117–135). Do not
change that preference. Accidental/unplanned Quit, especially during startup, is
an incident: stop the normal test sequence, record last state, require SH-01 and
separate reconciliation before continuing. A passing stopped observation does
not repair input loss or authorize a new launch.

PR-01 must include the exact launch-at-login Run-value presence observation;
unknown is blocking. Present means each Windows sign-in since historical shutdown
needs explicit reconciliation as a possible quiet launch, even if no window was
seen. Current absence does not prove historical absence. No settings/registry write.

M4 binding-source design and concrete pending fields, M5, versioned leases/mutexes,
SH-01 re-observation and redaction are specified in proposal v2. Missing approved
fields block inspection; no studio.json/credential read is introduced. Historical
schema29 preservation is not current database quiescence or post-UI equality.

All native cases remain not-run; R/H remain unverified. A v1–2/B v1 default retention,
existing workspace/current owner-editor, local-only auth, separate R scope, UI-only
limits and Jordan-only H remain. The author prepared v3/v4 and cannot independently
support this revision. Next eligible: uninvolved exact-v4/proposal-v2 review. No inspector
implementation, operational observation or acceptance execution in this revision.
