# Integration readiness

## Pinned headless browser for static web QA (ADR-0078) — November 6, 2026

Implemented and checked in a Linux container (real Bubblewrap, Chrome for Testing headless shell 156.0.8078.47). Installed on Jordan's WSL2 worker on November 6, 2026 (hashes verified; Jordan installed the apt libraries) and used for the live web qualification (3 of 3, $0). The studio never downloads it: Jordan runs `packages/executor/worker/install_browser.py` in WSL as uid 1000 (downloads from `storage.googleapis.com/chrome-for-testing-public`, or `--zip FILE`), which checks the archive and tree SHA-256 and prints the apt command for system libraries. The browser runs only inside the QA sandbox with no network beyond loopback. No credential, account or paid service. Installing it and the live web qualification each need Jordan's typed OK ([setup](../docs/STATIC_WEB_RECIPE.md)).

## Authentication review follow-up — November 4, 2026

Schema 41 privately binds plan requests to the admitted login and actual dispatched credential. Late authentication failures cannot expire a disconnected or newer login; browser completion tolerates unrelated settings changes and refresh. Synthetic checks only; no live activation, installed-app migration or new credential scope. The earlier schema-40 bundle and evidence remain historical. See [follow-up report](../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md) and ADR-0067.

## Audit repairs — November 4, 2026

Plan sign-in/refresh completion is version/reference-bound so an older callback cannot reverse Disconnect. Current runtime floor is Node 22.23.4 (or 24.22.2 in 24.x); a locally staged bundle includes the verified patched binary. Qualification labels distinguish historical grades from current prompts. These are source repairs and fixture/contract/build evidence, not an installed-app update or new live connection activation. See [the repair report](../docs/CODEBASE_REPAIRS_2026-11-04.md) and [current status](../docs/CURRENT_STATUS.md); dated earlier live/native receipts retain their original candidate scope.

## Chat answers through plan connections (ADR-0057) — November 1, 2026

Implemented and fixture-verified (fake `claude`), not activated. Uses the existing ChatGPT plan and Claude Code connections; no new credential, endpoint or sign-in. Activation on a studio: allow private text on the chosen connection, accept its caps again, turn chat answers on in Models and connections. Each live question uses the owner's plan allowance ($0 to the studio, outside the $20 runtime ceiling); refusals never fall back to a paid route.

## Claude Code on this computer (ADR-0050) — October 28, 2026

Implemented, fixture-verified, not activated. Uses Jordan's own signed-in Claude Code CLI
(native installer) in the studio's dedicated `CREATOR_CLAUDE_CODE_CONFIG_DIR`; the studio holds
no Claude credential. Activation needs, each with Jordan's typed OK: install, `claude auth login`
in that folder, extra usage off in Claude Settings → Usage, caps accepted, one verification
call. Policy note: Pro/Max limits assume ordinary, individual use; personal studio only.

## Native acceptance readiness assessed; session remains blocked — October 24, 2026

Bounded repository-only reconciliation completed. No newer independent exact-v2
checklist review found in docs/tracking filename inventory and text search; original
review covers v1, revision is not independent, and supported v4 review covers helper
bytes only. No reviewer dispatched. Frozen checklist/helper/package/history preserved.
Actual schema29 installation and pre-UI receipts supersede v2's pending helper,
backup/install/migrate prerequisites; no repeat preparation/install is indicated.
Repository evidence check: 182 hash bindings, zero mismatches; 145 exact helper
bindings; 16 run-01 JSON receipts read; all114 business hashes preserved; migration
precedes observation. These are historical receipts, not fresh operational checks.

Readiness and proposed session scope:
docs/THEME_INTENT_ACCEPTANCE_READINESS_2026-10-24.md.
Evidence/reproducible repository-only check:
tracking/evidence/theme-intent-acceptance-readiness-2026-10-24/assessment-receipt.json
and assess.mjs. Native acceptance remains blocked by independent exact-v2 review,
unknown live scheduling state, named existing workspace/current owner-editor role,
continuity through first launch and a separate bounded session authorization.
Source defaults do not prove live scheduler state; worker starts on launch. UI-only
scope cannot establish raw hashes, post-UI database equality or exhaustive zero
dispatch. A v1–2/B v1 synthetic scope retains records by default; registry/shortcuts
need separate read-only scope; /NS skips creation; Jordan H remains separate.

No operational/credential access, launch/sign-in, acceptance writes, helper execution,
provider/workflow activation, recovery/stale release, cleanup or retired checkout
access. R/N/H remain unverified; full C54 partial. Next eligible: use
docs/THEME_INTENT_ACCEPTANCE_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md in a separate
review session. Resolve scheduling/continuity gates before requesting native session
execution. No automatic next milestone or authority granted by this assessment.

## Exact theme-intent installed and schema29 preserved before UI — October 24, 2026

Owner authorized next step after operational before completion. New exact /4 owner
install decision binds frozen candidate7100a039...8bc /plan27f79525...7a1, prepared
5bb69e60...ddf0d2 and reviewed145runtime map. Fresh admission passed with unchanged
schema28/predecessor/state/backups. Real NSIS3af2712c...6d834b ran /S /NS, exit0,
no timeout, completed2026-10-24T12:34:45.802Z (08:34:45EDT). Exact candidate migrate
applied[29] from28to29 and created its own verified schema28 migration snapshot.
Reviewed after passed before any desktop/UI launch: schema29 observed
2026-10-24T12:34:49.022Z; all114business table hashes, prior migrations, protected
files/config/products preserved. Parent rechecked full receipt/admission/installer/
migration chain and migration dump hash; exact installed native510b09...88ca9,
manifest5b38b4...eba6 and71runtime resources verified.
Operational cluster stopped normally. Host check pg_ctl status3, no configured-port
listener, no lease, desktop or runtime worker. No provider calls/workflow activation,
UI/acceptance writes, recovery or retired checkout access. Code/packages/reviews
unchanged; CurrentUser DPAPI used by reviewed wrapper only, no secret bytes logged.
Evidence: tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json
and shutdown-check.json; original session receipts and new owner-install-approval
under tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Prior before completion remains immutable history; installed state now supersedes28.
Keep schema28 snapshot and matching program together at private before backup;
coordinated rollback needs separate decision, never old binaries alone over29.
Real installation I is verified. Registry/shortcuts R, native UI N and Jordan human
acceptance H remain unverified. /NS skips shortcut creation. No operational restore
rehearsal claimed. Acceptance checklist v2 review/session scope still separate;
keep desktop quit until gates resolve. Next eligible: independent exact-checklist-v2
review alongside supported v4 helper, then scoped native acceptance decision.
No automatic acceptance/next milestone. FullC54 remains partial.

## Operational v4 before preparation completed — October 24, 2026

Owner authorized next step after exact-v4 independent support. Supported /4 review
validated with all145 runtime bindings; frozen package preflight passed. New session
operational-before-v4-20261024-01, evidence
tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Reviewed PS/CLI before exited0, fixture:false, provider_calls0. Actual managed
postgres/data schema28 observed;28migration rows and114table hashes. Dedicated
snapshot plus post-backup preserved-state checks/quiescence passed. Private backup:
C:/Users/jorda/AppData/Local/com.creatoragent.studio/backups/theme-intent-v4-operational-before-v4-20261024-01.
Database dump553996bytes; matching predecessor program78files, protected4files,
configured products tree0files. Helper verified dump list/hash and copy maps; parent
rehashed all copies/dump and prepared/before/backup receipt links. CurrentUser DPAPI
used only inside reviewed wrapper; no credential bytes logged/tracked. No restore
rehearsal performed on operational snapshot; dump-list/hash verification is distinct.
Prepared_at2026-10-24T12:31:01.322Z; prepared SHA256
5bb69e60eaae96a503368ef2bd9f7e61c9f40546825b893de4e1d44492ddf0d2.
Earliest backup/prepared15minute age deadline2026-10-24T12:46:00.939Z
(08:46:00.939 America/New_York). Admission must recheck freshness/unchanged state
and a NEW exact owner installation decision; age deadline is not admission approval.
Host final check:pg_ctl status3, no configured-port listener, no theme-intent lease.
Operational database and installed predecessor remain schema28; no install, migrate,
admit, recovery, stale release, provider/workflow activation or retired-path access.
Completion receipt and shutdown/owner provenance retained; prior failed v3 attempt
unchanged. Helper/plan/packages/reviews untouched. Native NSIS/registry/shortcuts/UI
and human acceptance remain unverified; acceptance checklist v2 review separate.
Next eligible: new exact installation/migration owner decision, fresh admission and
only then authorized install/migrate/after before any UI launch. If stale or state
changed, new before session/directories required. No automatic next milestone.
FullC54 remains partial.

## Installed acceptance checklist v2 revised; execution remains blocked — October 24, 2026

Owner authorized document-only revision following Claude's blocked checklist review.
New docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md preserves the original
plan and review. Incorporates A0–A13: exact candidate/plan/proposed-v4 map and review
binding; successful after/cluster-stop evidence before first launch with actual
v4 at/state.observed_at fields and operator timeline; control-window GUI-migration
stop; native sign-in/Quit; workspace/role/mutation scope; two-draft visible ledger;
clean-save version/activity check; pending-target semantics; retention by default.
UI-only observation chosen. Raw content hashes, whole-database equality after UI
activity and exhaustive zero dispatch are explicitly unverified. Plan declarations
are wiring, not measured dispatch. Worker startup/bookkeeping are explicit; no
worker-off control or live scheduler-off UI invented. Unknown runtime scheduling
blocks execution; stronger prevention/accounting proof needs a separate reviewed
inspection/control task. Real install, registry/shortcuts, native UI and Jordan's
human acceptance have separate I/R/N/H classes; historical fixtures are F.
All cases not-run. No operational data/credentials, helper, installer, app, provider,
workflow or retired path accessed/run. Only documentation/tracking/new planning
evidence changed. Original plan/report/receipt hashes preserved; all168 v4 repair
artifacts unchanged. Markdown formatting and case coverage checks pass. Evidence:
tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json.
Next: independent exact-v2 checklist review alongside resulting reviewed helper
identity. V4 helper review remains a separate gate; operational preparation, install/
migration and native acceptance still require their recorded gates and authority.
No automatic next milestone. No fresh operational backup from failed v3 attempt;
fullC54 remains partial.

## Native-layout helper v4 locally verified; independent review next — October 24, 2026

Owner authorized the next repair after operational v3 before failed. V4 preserves
v3 and frozen package/plan. Shared PGDATA is desktop-native postgres/data in normal
managed control, postmaster ownership inspection, stale data_dir binding/release
and coordinated recovery. Nested directory/no-links/PG_VERSION18 checks now precede
DPAPI. No flat fallback or data relocation. Versioned /4 authority/review/lease
contracts require a fresh exact independent review; v3 support does not cover v4.
Verified source-bound run:26/26 TAP tests (25scenarios+parent), guards11/11,0skip,
source maps unchanged. Independent fixture initdb uses nested layout; source-contract
guard reproduces v3 failure. Real wrapper rejects missing nested PGDATA while
synthetic DPAPI is unavailable. Before/death/stale-release, forward29 preservation
and coordinated28 recovery pass. Static package/PS parse/format/syntax pass.
First full run retained: two scenarios failed (23pass/3fail including parent):
missing synthetic studio.json setup, corrected in test only; transient EPERM on
fixture program rename during interrupted recovery. Exact-directory rename/back
subsequently succeeded, and unchanged runtime passed complete rerun. EPERM cause
unconfirmed, no production retry/gate relaxation; retain for independent review.
V2's162 and v3's161 artifact hashes unchanged. Disposable55455 summary stopped.
No operational configuration/credentials/database accessed in this repair; no NSIS,
providers/workflows, installed app changes or retired checkout access. Failed
v3 operational before still produced no fresh backup; installed schema28 remains
last verified status, not re-queried. FullC54partial. V3 low findings deferred.
See docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md and
tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/repair-receipt.json,
verified-{guards,e2e}-run.json/TAP and retained first-run failure evidence.
Next U02: fresh independent exact-v4 review of layout/pre-secret/stale/recovery
and failure evidence. Operational retry remains blocked until review support;
new session/directories/current authority required. No automatic next milestone,
installation/migration, recovery or release authority follows.

## Operational before blocked by native-layout mismatch — October 24, 2026

Owner authorized operational before preparation only. Exact frozen package preflight
and independent /3 review passed (145 runtime bindings). Actual reviewed v3 attempt
operational-before-20261024-01 exited 1: managed() reads postgres/PG_VERSION, while
desktop Home::pg_data (apps/desktop/src-tauri/src/home.rs:121) uses postgres/data.
Read-only inspection confirmed postgres/data/PG_VERSION=18; operational schema was
not queried. Wrapper decrypted CurrentUser DPAPI before this failure; no credential
bytes logged. No database start, snapshot, private backup, prepared receipt, install,
migration, providers or workflows. Empty run-01 evidence directory retained; lease
removed normally. Original reviewed v3 bytes and all historical evidence preserved.
The synthetic fixture layout mirrored the same wrong assumption, so prior passing
tests/review do not establish native layout compatibility. Operational preparation
is blocked despite historical supported review. See
tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json
and owner-before-authorization.json.
Next eligible U03: bounded versioned native-layout repair, actual-desktop-layout
fixture coverage (including stale/recovery paths), then fresh independent exact
review before a new operational before attempt. No install/migration authorization.
No complete fresh backup exists from this attempt; full C54 remains partial.

## Upgrade-helper v3 process-death repair — October 23, 2026

Local source-bound verification:25/25 E2E (24scenarios+parent),8/8 guards,0skip.
Adds credential-free, preparation-independent stale-state release and forward
schema29 verification; independent v3 support remains pending. Actual PowerShell/
synthetic DPAPI/disposable PG18, fixture installers; no operational configuration,
credentials/DB, NSIS, provider/workflow or retired-checkout access. Listener55454
stopped; v2 artifacts preserved. No integration/installation state advanced.
Native NSIS/registry/shortcuts/UI and operational-scale timing unverified. /NS does
not create shortcuts. FullC54 partial; next exact-v3 independent review, then only
separately authorized preparation/installation. See v3 repair report and receipt.

## Upgrade-helper v2 repair verification — October 23, 2026

V1 independent review blocked preparation; separate v2 repairs now have21 end-to-end
tests (20 scenarios+parent)+5 guard tests passing,0skip. Real local PowerShell5/DPAPI
and disposable SCRAM PG18; exact archived candidate migration. Installer execution
is fixture-only, so native NSIS/registry/shortcut and installed-UI gates remain open.
Sensitive backups separated from tracked hash evidence; no operational config,
credential or DB access; no providers/workflows/integration activation. Test listener
55452 stopped. Original16 artifacts and frozen package/plan preserved. No supported
operational v2 receipt or owner installation grant created. Next independent exact-v2
review; fullC54 partial. See docs/THEME_INTENT_UPGRADE_HELPER_V2_2026-10-23.md.

## Theme-intent executable upgrade-helper preparation — October 23, 2026

New schema28→29 backup/install/preservation helper implemented and self-reviewed;
static package preflight, PS parsing, formatting and10isolated tests pass.
Custom PostgreSQL snapshot restore/sentinel and full migration table-preservation
checks used disposable local PG18 only; both test listeners stopped. No provider,
operational credential/config/DB, installation or workflow access. No live
integration state advanced. Independent exact-helper review and new owner
approval are enforced at admission; neither created here. Current installed
schema28 remains last verified status. FullC54 partial; next U02 helper review.
See docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md for recovery-format limitations.

## Theme-intent desktop package/declarative plan supported — October 23, 2026

Candidate7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc;
installationplan27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1.
LockedofflineMSVC/Tauri NSIS build/staging complete:71runtime resources,265source
bindings. Installer3af271...d834b,packagednative510b09...88ca9 (distinct loosebinary),
manifest5b38b4...eba6 archived under .verification/theme-intent-artifacts-2026-10-23/.
All71extracted/staged/archive resources match. Supported stagedservice isolated
backup-first28->29 tests2/2pass;all28prior migration SQL unchanged,11role/admission
parity references match. Norestore/installedacceptance claim. Separatepackage review
supported/no materialfinding;parent verified424review artifact hashes. Oldinstaller/
archive and installed67resource predecessor unchanged before/afterbuild. No provider,
operationalDB/credential/settings access or install;testcluster stopped. C54partial.
See docs/THEME_INTENT_PACKAGE_2026-10-23.md and matching independentreview/evidence.
Installation remains prospective:NEWschema29-aware executable backup/install/
preservation helper+affectedreview required BEFORE newownerapproval. Freshoperational
quiescence/backup/rollback/preservation hashes stillrequired;nonewbackup claimed.
Rollbackafter29 must restore28snapshot+matchingprogram together,not oldbinaryalone.
Nexteligible:implement/reviewthathelper andstaticpreflight,thenfreshbackup/readiness
and exactownerinstallation/migration decision. Noautomatic install or activation.

## Theme-intent guard repaired and separately supported — October 23, 2026

TI-01closed on exact UI source4909dbf8...08de:ordinaryNew/Resume/Reload always guard
dirty input;only explicitDiscard passestrue. Failed-load preservation/re-guarding
retained; successfulsave clearsobsoletependingprompt. NoAPI/domain/schema change.
Valid before-regression2fail/1pass;after3pass0skip;8fixturebrowser checks pass with
APIintercepted,0mutations/DB/provider calls. Project/webtypes+formatpass. Separate
review independently reran3actual-handler tests,inspectedbuttonwiring,verified12repair
hashes+25unchangedoriginalbindings and reconstructedoldsource byreversing4edits.
Parent verified17reviewartifact hashes. TI-02format corrected in supplemental
versioned receipt;original malformedreceipt/partialreview/failureevidence preserved.
Verificationwebserver stopped;installedapp/studio unchanged,migration29stilltest-only.
No package/install/sourcecollection/pilot;fullC54partial. See docs/THEME_INTENT_REPAIR_2026-10-23.md
and docs/THEME_INTENT_REPAIR_REVIEW_2026-10-23.md with exactrepair/review evidence.
Next eligible: bounded exact candidate/package/install PREPARATION. Noautomatic
installation/activation;compare source/role/migration bindings and preserve rollback.

## Theme-intent independent review partial: input-loss repair required — October 23, 2026

U02 separate model review found TI-01(P2):open() guards dirty input only when
pending===null; after prompt appears,a second ordinary New/Resume/Reload skips
confirmation and overwrites edits. Reviewer actual-handler probe and parent actual
retained-browser reproduction independently confirm; prior10browser checks missed
that sequence. Packaging/install preparation not supported until U03repair/review.
API/domain zero-dispatch/version/workspace paths otherwise supported by inspection;
26implementation hashes and5frozenlegacycontract artifacts checked. One freshpure
domain test passed; priorHTTP/PG/browser evidence inspected,not freshly rerun.
Parent verified41reviewreceipt artifact hashes. TI-02minor:original implementation
receipt format='passed';preserve it and issue supplemental versioned metadata later.
No production/API/DB/provider/build/install changes. Model review/not humanacceptance;
C54partial. See docs/THEME_INTENT_REVIEW_2026-10-23.md and exactreview evidence.
NextU03:separate ordinary guarded-open from explicit confirmed discard;regress
repeatedNew/alternateResume/Reload while prompt open and failed-load preservation,
then review exact changed candidate. No packaging or activation yet.

## Durable theme-intent draft/preparation slice implemented — October 23, 2026

New theme-intent/1 contracts+theme_intent record,migration29,deterministic domain
research-plan preparation and active-record GET endpoint;reuses versioned entity
API/store. Submit saves theme-only/resumes after reload without claims,connection
or budget;optional context/solution constraints/questions/public URLs editable.
Expected-version conflicts and failed saves retain input;explicit reload/discard,
create idempotency and workspace/session isolation retained. Plan binds saved
version/hash,zero requests/fetches/spend,not_authorized;no grants/claims/run dispatch.
Existing brief/discovery/study contracts unchanged. Project/web types+formatpass;
28relevant tests0skip plus final2theme-only HTTP/restart/rebinding checks pass.
10browser checks against separate real API/PG inclinjected503/conflict/mobile pass.
TestSQL0claims/runs/grants/workflows/providerrequests. Testservices stopped/data
retained. Migration29 onlytestDB; installedapp/studio unchanged. No providers/source
fetches/productbuild/install/pilot. See docs/THEME_INTENT_IMPLEMENTATION_2026-10-23.md.
NextU02:exactchange review before candidate/package/install preparation. Collection
to claims,citedcomparison and fullin-app lifecycle remain later;C54partial.

## C54 readiness/gap audit completed — October 23, 2026

Read-only source/evidence audit plus4offline contract probes,36sourcebindings;
no network/provider/credentials/DB/build/install/workflow changes. Operationalroles
3/3+substantive modelreviews remain narrow. Existing subscription worker/admission,
source broker and artifact APIs present; not complete live/UI acceptance. Missing:
durable theme-only draft/no-claims intake,source collection-to-claims,complete
parent/pilot effective setup,subscription search integration/qualification,and
in-app spec/build/package/revision actions (CLI instructions remain). OldOct20
workflow receipt8/14sourcebindings current:historical tests not promoted. Dated
readiness config missing-role text superseded narrowly;frozen config unchanged.
See docs/C54_READINESS_AUDIT_2026-10-23.md and audit.json. FullC54partial.
Next eligible: bounded durable theme-intent draft+research-plan preparation through
contracts/domain/API/UI;save/resume without connection,budget,claims or dispatch.
Preserve existing evidence-first/study contracts;no source/provider activation or
install in that slice. Collection/citedcomparison then lifecycle and ownerwalkthrough
remain later gates. No approval requested for unimplemented live work.

## Six exact research outputs substantively supported — October 23, 2026

Separate U02 model review supports all6outputs/18frozen criteria; no material output
repair. Low packet issue R14-PACKET-01: event sufficiency rationale denies mechanism
while C2describes identifier suppression; output explicitly flags contradiction and
retains conditional transfer. Preserve frozen packet/results; prospective rationale
correction only if reused. Parent verified37review artifact hashes and6case/18criterion
coverage; reviewer replayed all6textSHA/char/identity/render/schema/checkOutput and
22liveartifact hashes. Reviewer-owned optional-input verifier error repaired/replayed;
no production/source/output edits. Review has prior familiarity,nonblinded/model-only,
not human/customer acceptance. Historical placeholders/decisions/locks unchanged.
No provider/API/DB/credential/network/build/install calls this milestone. Current
operationalrole evidence3/3 now has narrow substantive reviews; fullC54stillpartial.
See docs/DISCOVERY_RESEARCH14_OUTPUT_REVIEW_2026-10-23.md and exactreview evidence.
Next eligible: bounded read-only C54 acceptance readiness/gap audit against §2.19
bridge,§2.5citedresearch and Group3in-app spec/build/export/revision/ownerwalkthrough.
No automatic workflow/pilot/live action.

## Research role1.4 live suite operationally qualified — October 23, 2026

Owner approval “Yes I approve that” recorded for d567...23c0 before execution.
Oneavailability+sixresearch requests completed;0retries,2/2development+4/4held-out
contractpasses. Qualification a2e439d2-7ff8-43c9-8d70-2b510c6a861d qualified;
finished04:00:37Z/00:00EDT within12minute suite limit. Credits off/settings unchanged.
Read-only SQL64requests (62completed/1historicalfailed/1reconciled),exact7newcomplete,
newgrant usedonce,original44+baselinehashes preserved/prior13semantics stillcomplete,
0active/unknown. GET04:01:08Z usage29/40=11studio slots,0blockers;API50is page only.
Exact compiled filter replay admits current research/candidate/scoring:3/3
operationalcoverage; six outputhashes checked. Research substantive review pending,
not human acceptance/real-world validation. Full discovery/C54partial. All old/new
locks retained;noappchanges,workflow or pilot. See live-result report/evidence.
Next U02:separate six-output substantive review against frozen18criteria/source
packets;no further provider calls authorized or needed for that review.

## Fresh research authorization v2 prepared and reviewed — October 22, 2026

New combined plan d567088498d2d0ed111c939113990997ab73cfd50f829736775697724c2223c0;
availability df52351b7edff8c9fd5493a2f33ab9d47afc681819c2e9e3d3163fe7ad4f8477.
Same seven-request ceiling (one availability check then six research), no retries,
credits off/settings unchanged,120s each/12minute suite dispatch limit. Fresh
combined/probe operation paths; original stopped plan and locks preserved and bound
in236source/artifact hashes. Never-started research suite path/guards unchanged.
Four standalone and four compiled tests,tsc,PSparser,static exactinstalled gates
passed. Separate model review supported/no material findings; parent verified245
review artifact hashes and actual approval gate. No credentials/API/DB/provider
calls,appchanges or new locks. Readiness evidence is saved,not freshly re-observed.
See docs/DISCOVERY_RESEARCH14_LIVE_AUTHORIZATION_V2_2026-10-22.md and matching review.
Next: new exact owner decision before scripts/run-research14-v2-approved-live.ps1;
record it before execution. Old approval does not cover new operation. Stop on
first failure/unknown; no automatic workflow. Coverage2/3,C54partial.

## Local research readiness restored and records reconciled — October 22, 2026

App open and saved owner session valid; authenticated GET-only local API check
succeeded at03:51:54Z Oct23/23:51EDT Oct22. Settings match,credits off,0blockers/
active/unresolved,rolling22/40=18studio slots. Research14-v2 packet unattempted.
Saved availability18:02:59Z Oct22 is stale; no current provider availability claim.
Read-only SQL confirms57requests (55complete/1historicalfailed/1reconciled), prior
44+13semantics requests/grants/access/qualifications preserved; stopped research
attempt added0. Reconciliation receipt new_requests13 refers to historical run,
not this inspection. API50record history is a page only. Exact installed gates
pass; no provider calls,settings changes or retry; old operation locks preserved.
See docs/DISCOVERY_RESEARCH14_READINESS_2026-10-22.md and readiness evidence.
Next eligible: new bounded authorization package/review with fresh paths, then
new exact owner decision for availability+sixresearch. Coverage2/3,C54partial.

## Authorized research run stopped before provider dispatch — October 22, 2026

Owner “I authorize this” recorded for combined581dd0e6...e8286 before execution.
Actual static approval/review/install gates passed. First local auth/session read
failed ECONNREFUSED127.0.0.1:4310; availability endpoint_attempted:false. No grant,
provider dispatch or research suite start; zero provider requests, no retries.
Combined/availability locks preserved; local stop reconciliation verifies absence
of grant/dispatch/provider result/suite run-lock artifacts. No app process or4310
listener observed. No DB/current service health claim; installed files unchanged.
Coverage remains2/3, C54partial. See docs/DISCOVERY_RESEARCH14_LIVE_STOP_2026-10-22.md.
Next eligible: restore/inspect local app readiness without provider calls, then
prepare a new reviewed authorization. Never replay this plan or remove its locks.

## Research live authorization prepared and separately reviewed — October 22, 2026

Combined plan 581dd0e6e30b3626a80a0657a6e169d5e11b9e6361a3c2c721a04919db7e8286
allows at most seven subscription requests: one intent-bound availability recheck,
then six research14-v2 cases only if all unchanged admission gates pass. Probe120s;
suite12-minute dispatch budget,120s each,zero retries,credits off,unchanged settings,
no quota reset/fallback/automatic workflow. Exact installed candidate and reviewed
research runner remain bound. 229 plan source bindings; 238 separate-review hashes
verified by parent. Four standalone and four compiled tests, TypeScript build,
PowerShell parser, static installed-file checks and actual approval gate passed.
Separate model review supported with no unresolved material findings; not human
acceptance or execution authorization. No credential/API/DB/provider calls, app
changes or operation/run locks. Coverage remains 2/3; full discovery/C54 partial.
See docs/DISCOVERY_RESEARCH14_LIVE_AUTHORIZATION_2026-10-22.md and matching review.
Next eligible: new exact owner approval for this seven-request scope, then record
that decision before invoking scripts/run-research14-approved-live.ps1. Prior
approvals are consumed; failure/unknown preserves locks and stops without retry.

## Research-only runner implemented and separately reviewed — October 22, 2026

Exact plan a96eed07aa0372e55d7880a62b57f6c0f5726b3ea6c559617af3f9119e11469a
binds 233 sources/artifacts, reviewed research14-v2 packet and unchanged installed
role1.4 candidate. Six sequential locator requests, no retries, 120s per request,
12-minute dispatch budget; persistent lock, intent-before-delivery and first-failure
stop. Static plan/review/install gates precede credentials; live admission remains
subject to fresh availability, credits off, unchanged settings and full capacity.
TypeScript build, standalone and compiled entries (17/17 each), six-case/54-control
check, PowerShell parser and actual review gate passed. Separate model review has
no unresolved material findings; parent verified all 240 receipt-bound hashes.
Offline checks do not establish current service health or target output fidelity.
No provider/API/DB/credential/build/install operations or run lock; prior evidence
preserved. Actual role coverage remains 2/3; full discovery/C54 remains partial.
See docs/DISCOVERY_RESEARCH14_RUNNER_2026-10-22.md and matching review/evidence.
Next eligible: prepare/review new bounded live authorization, separately scoping
fresh availability if needed, then obtain a new exact owner decision. No inherited
approval or automatic suite/workflow/pilot.

## Research-only packet v2 supported after additive review repair — October22,2026

Separate v1 review found injection confidence too narrowly exploratory despite
no usable current-need observation;minor C2observer label inherited C1provenance.
V1 preserved. Additive v2 goldinsufficient/accepts exploratory or insufficient;
unsupportedwell_supported still fails. Two-observer label restricted to C1 only.
Same6scenarios corrected before outputs,18substantive criteria unchanged.
Separate v2review supports all6golds/18criteria with no unresolved findings.
54controls/223sourcebindings independently verified;both injection positives and
negative,2/1origins labels and7v1preparation hashes checked. Parent verified
237v1+239v2receipt hashes. Currentfreeze
c0576b32481fc2f682a71d7506ef10fe4866382d065dbeb45e68d937395142d4.
Existing installed candidate d009.../role1.4 unchanged. Body102468,maxinput11987;
2dev4held-out/4of4floor,6seq0retry120seach12min prospective limits retained.
See docs/DISCOVERY_RESEARCH14_V2.md and matching V1/V2review reports/evidence.
No provider/API/DB/credential/build/install/frozenresult changes. Installedmanifest
bytes compared only. Actual coverage remains2of3;goldreview is not targetoutput
or human acceptance. Next eligible:research-only bound runner/exactplan preparation
and independent review;new applicable decision/preflight before any livecheck.
No automatic suite/workflow/pilot. Full discovery/C54partial.

## Fresh research-only role1.4 packet prepared — October22,2026

New discovery-research14-v1:6synthetic locator cases,2dev/4held-out,4of4floor.
54controls pass;18frozen substantive criteria,outputs null/not_reviewed. Covers
copied-origin counts,conditional mechanism transfer,within-simulation corroboration
versus correctness/benefit,adverse13vs5,injection/aggregate authority,stale-only
insufficient need. Corroborated case allows exploratory/well_supported with fidelity
review rather than over-specific confidence demand. Fabricated prose control
discloses structural blindspot. Not independent thesis holdouts/customer evidence.
Freeze8aead115a755b6581627e34900f1ef58e2a4c0e26f6daf490e50f9791eb3da67;
existing installed candidate d009...manifest621e...role1.4 binding223sources.
Manifest102238bytes,maxinput11980,production rendering/schema/hash checks pass.
No app rebuild/install,provider/API/DB/credential calls or oldevidence regrade.
Prospective suite6seq/0retries/120seach/12min/16000output;not an executableplan,
noimplicit availability check. Eligiblecoverage remains2of3 until actualevidence.
See docs/DISCOVERY_RESEARCH14_V1.md and packet evidence. Next U02:separate packet/
controls/criteria review;then bound researchrunner/new exactlive decision.
No automatic workflow/pilot;full discovery/C54partial.

## Role1.4 remaining evidence audit completed — October22,2026

Exact compiled discovery qualification filter replay:current candidate-generation
andscoring qualify;older research1.3 does not.2of3classes currently covered.
Oldresearch6outputs/2dev4held-out/model review remain historical,not relabeled.
All6locator system texts differ only by role-version marker versus currentprompt,
but deterministic gate intentionally requires exactcurrent binding. No gatebug
or productionrepair found.4negative controls reject stale role/system/packet and
missing revision;18saved outputhash/review associations verified. No DB/API test
was run;existing DB integration test source inspected only.
See docs/DISCOVERY_ROLE14_COVERAGE_AUDIT_2026-10-22.md and coverage audit receipt.
No provider/workflow/search/DB/credential/install/settings or oldgrade action.
Next eligible:prepare fresh research-only locator packet,currentrole1.4/candidate,
2dev4held-out/4of4floor and substantive fidelity controls;then separate review
and new exact-plan decision before any livecheck. No apprebuild needed solely
for evidencegap. C54also needs real-workspace citedcollection/comparison and
permitted search/effective limits/in-app build/export/revision/owner acceptance;
rolebenchmarks alone cannot complete it. Full discovery/C54partial.

## Role1.4 twelve-output substantive model review completed — October22,2026

Separate reviewer supports12 exact outputs against all36 frozen substantive
criteria,with no material findings or output repair. Independently verified12
outputhashes/charcounts/schemas/contracts,input rendering,raw/execution-result
correspondence and13live evidence hashes. Parent verified32review artifact hashes
and exact12request/output/packet/localcandidate bindings plus36checkliststrings.
Correct benefit/originality types,per-proposal cheaper tests,adverse comparisons,
prohibited-data deferral,both revision findings and injection asymmetry retained.
Review binds localcandidatef6cce6...,distributabled009...,manifest621e...,native
exe6c841... and executable-plan4fb62... separately. No historical grades or old
review placeholder changed. All12contract passes/4of4perclass remain recorded.
See docs/DISCOVERY_SEMANTICS_V2_OUTPUT_REVIEW_2026-10-22.md and structured response/
receipt/integration in discovery-semantics-v2-output-review-2026-10-22.
Nonblinded model review with previous packet familiarity,not independent human
acceptance,customer validation,causal improvement or fullC54 completion.
No provider/network/studio/credential/DB/build/install action this review.
Next eligible:coverage audit of remaining exact-candidate discovery evidence,
especially older research-role qualification versus installed role1.4. No
automatic new suite/workflow/pilot. Full discovery/C54 partial.

## Role1.4 semantics live suite operationally qualified — October22,2026

Owner approved exact combined1fd2ee...;oneavailability+12suite requests completed,
0retries/failures/unknowns. All12contract accepted. Candidate generation andscoring
each2/2dev+4/4held-out,exact saved manifests qualified. Suiteplan4fb62a...b280c;
completed14:02:59EDT within24min. All12outputhashes verified.
Read-only reconciliation:57saved (55completed/1historicalfailed/1reconciled);exact
prior44requests/grants/access/qualifications preserved. Newgrant usedonce;13new
requestIDs allcomplete. GET endpoint50entries is page cap,not savedcount. Credits
off/settings unchanged,22rolling/18slots,0active/unknown. Alllocks preserved.
See docs/DISCOVERY_SEMANTICS_V2_LIVE_RESULT_2026-10-22.md and runner/live-result.json.
No workflow/search/build/pilot or further provider call. Approval consumed.
Next eligible U02:independent exact-output substantive review of12responses and
36frozen criteria. Structural qualification is not source entailment/human acceptance/
customer benefit. Prior research-role evidence is older candidate,not newlyrole1.4
verified by thissuite. Full discovery/C54 partial.

## New13-request live authorization prepared/reviewed — October22,2026

Concrete combined authorization hash
1fd2ee8f8925af3e31ec7265b25c087e0b6dd021ca1c2183bf946eafc3b1af6f.
At most1new synthetic intent-bound availability check (plan4ea9ac49aaebccf028d035efe5c14ed57bed4ad8ca9979d794f3019ffcdd5a40),
then exact12suite4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c
only after success/fullpreflight. No retries,credits/settings unchanged,noquotareset,
noadditional refresh/fallback. Probe120s configured;suite24min total/120seach,
other limits/floors unchanged. Global/probe/suite locks preserve no-replay semantics.
Static combined approval/review/installedproof gates precede DPAPI;probe failure
or unknown stops suite. Exact new ownerdecision required,not supplied yet.
4offline tests/defaultentry pass;tsc/PSparser pass. Independent review supported;
239review artifact hashes verified;actual receipt static --approval-check passes
(no authority implied).GET-only13:53:06EDT healthy/owner valid,44requests unchanged,
31studio slots,0active/unknown,newpacket unattempted;provider availabilitystale.
No provider calls,probe/global/suite locks absent. See scope/review docs
DISCOVERY_SEMANTICS_V2_LIVE_AUTHORIZATION_2026-10-22.md and matching reviewreport.
Next:owner exact13request decision,then execute one combined operation ifapproved;
stop first failure/unknown and preserve evidence;substantive output review later.
Past approvals not reused;noauto workflow/pilot. Full discovery/C54 partial.

## Role1.4 installed and preservation verified — October 22, 2026

Owner confirmed Quit;pinned installer exit0 once;installer.lock preserved.
Restarted installed app;all67resources/native/manifests match reviewed package.
Schema28 and requests/grants/access/qualifications/connections/settings/config
before-state hashes unchanged.44requests (42completed/1failed/1reconciled),
zero active/unknown or leased/nonterminal work. Backups/72file rollback retained.
GET-only health/session verified at13:45:31EDT:healthy,owner authenticated,
credits off,settings unchanged,new packet unattempted.9rolling requests/31studio
slots;old records remain44. Saved availability05:04:50Z stale,not refreshed.
Runner actual static --execution-check passes verified installation and review
receipts;not live preflight or owner live decision. Executable plan
4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c.
See docs/DISCOVERY_SEMANTICS_V2_UPGRADE_RESULT_2026-10-22.md and installed-result.
No provider calls,suite,migration,setting change or old-grade change.
Next eligible:prepare/request new bounded live decision for one freshavailability
check plus exact12-suite if gates pass;no old grant/approval reuse,hidden refresh
or automatic live action. Full discovery/C54 partial.

## Local role1.4 upgrade backed up; waiting app Quit — October 22, 2026

Supported createBackup snapshot/dump/products hashes verified;protected home
config/DPAPI/plan-credential copy hashes verified;72-file program rollback verified.
Read-only before/after backup state: schema28,44requests,zero active/unknown or
leased/nonterminal workflows,settings/credits unchanged. Requests/grants/access/
qualifications/connection/config hashes saved. No provider call or migration.
Creator Agent still running PID2672;installation not started. Native controls
unavailable;owner must fully Quit through app/tray,not merely close window.
See docs/DISCOVERY_SEMANTICS_V2_UPGRADE_PREPARATION_2026-10-22.md and installation
evidence. Pinned installer helper checks quit,predecessor,installer,backup/rollback
then exclusive installer.lock. After owner Quit: install once,start app,verify67
resources/exe/schema/records/settings plus owner health/session;then installation
receipt. No restore rehearsal or live suite claimed/authorized. C54 partial.

## Bound semantics-v2 runner implemented and reviewed — October 22, 2026

Final executable plan v3
4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c
binds229sources,reviewed packet/package and exact scope.17offline tests and108
controls pass;TypeScript build/PowerShell syntax pass. Separate review supported;
240review artifact hashes verified;positive --review-check passed actual receipt.
R1 wrapper secret-order gap resolved:static --execution-check validates exact home,
installation receipt and installed resources BEFORE DPAPI. Actual wrapper negative
and direct missing-installation test independently verify refusal. Initial finding
and superseded plans preserved;no dispatch with them.
New runner retains shared12seq/no-retry/24min loop,exclusive lock,unknown/stop,
exact static review/install/hash gates and live auth/quota/credit/capacity/idle gates.
Future installation receipt and new exact-owner live decision remain required.
No run.lock,provider/network/studio/credential call or installation this step.
Installed role1.3 unchanged. See docs/DISCOVERY_SEMANTICS_V2_RUNNER_2026-10-22.md
and separate runner review report/receipt/integration.
Next eligible:supported local upgrade with reviewed pinned installer,fully quit/idle
app,rollback+supported backup,before/after state and installed-resource checks.
No automatic suite,quota refresh or new spending. Full discovery/C54 partial.

## Exact role1.4 package/plan review supported — October 22, 2026

Separate review supports exact archived candidate and declarative bindings, no
unresolved findings.370 immutable review artifact hashes verified at integration:
219 source bindings,installer/native payload/manifest,all67 archived+67 extracted
resources and exact packet/review identities. Checker108controls independently
pass. Candidate d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf.
Installation plan preserves schema28/no migration and before/after backup/record
checks. Execution binding retains limits but is explicitly non-runnable. No
installed/service or model behavior verification claimed. Parent manifest delta:
one changed service resource,six added evaluation configs,no removals.
See docs/DISCOVERY_SEMANTICS_V2_PACKAGE_REVIEW_2026-10-22.md and review receipt/integration.
No source/frozen/runtime edits,installation,provider/network/studio/credential
calls this review. Installed role1.3 unchanged. Next eligible: implement and
independently review bound runner;then supported local upgrade with backup and
record preservation under applicable scope. Exact final executable-plan owner
decision/fresh preflight remain before live suite;no old approval or quota refresh
is reused. Full discovery/C54 partial.

## Role1.4 exact Windows package prepared — October 22, 2026

Staged67 resources;TypeScript/UI/service build and host Tauri/NSIS build pass.
Initial sandbox NSIS download DNS failure retained;host build completed. Exact
installer archived and extracted;all67 payload resources match staged manifest.
Native payload SHA distinct from loose executable recorded without substitution.
Candidate d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf;
219 source/artifact hashes verified;23 targeted tests/108 controls pass.
Prospective install/execution bindings prepared, not executed or dispatch-ready.
Install requires quit/idle, rollback+supported backup, exact installer/hash checks
and before/after record preservation;schema28/no migration/settings/provider calls.
Execution binding retains12sequential/0retries/24min/credits-off/cap40/4of4 floors,
15min availability freshness and no implicit refresh. Runner remains required.
See docs/DISCOVERY_SEMANTICS_V2_PACKAGE_2026-10-22.md and package evidence directory.
Old staged bundle/installer archived;installed role1.3/manifest unchanged. No live
API/provider/credentials, installation, migration or grade change this step.
Next U02: independent exact-package/prospective-plan review;then bound runner
implementation/review and supported local upgrade under scoped work. No automatic
provider test, suite or pilot. Full discovery/C54 partial.

## Evaluation packet v2 separately reviewed — October 22, 2026

Independent v1 review found R1 inherited cross-proposal justifications/perspectives,
R2 no-new-trial wording ambiguity, R3 over-specific cable verdict. Preserved v1
and findings; created additive v2 correction before any provider outputs. Each
scoring input now cites its own justification, singleton software perspectives
match, adverse supplied comparisons coexist with no NEW trial wording, and cable
allows no/unclear while still rejecting unsupported yes.
Separate v2 review supports bounded offline packet, no unresolved findings.
108controls independently pass;12 golds and36checklist judgments reviewed.
11 own-source reasons verified;3null/8nonnull polarity swaps rejected;7v1
preparation hashes unchanged. Verified19v1+22v2 reviewer hashes at integration.
Current freeze b6da3adc6061627b81036dcacee83884d6c8fe40c539368cead1f63fb139e5fa;
local candidate f6cce6ffd9b5fa76370cd40c56e3c72c008c980f8835491b31804182516b5289.
Same newly authored scenarios corrected, not independent new sample or thesis
holdouts.13-binding identity is local source/compiled only, not installed release.
See docs/DISCOVERY_SEMANTICS_V2.md, v1/v2 review reports and v2/review-integration.json.
No runtime edits, install, provider/studio/credential calls, old grade changes or
new live authority. Installed role1.3 unchanged. Next eligible: exact distributable
packaging and supported installation/execution binding under scoped work; then
new exact-plan decision/fresh preflight. No suite/quota refresh/cap change/retry
automatically. Full discovery/C54 remains partial.

## New role1.4 evaluation packet prepared offline — October 22, 2026

New discovery-semantics-v1 packet:12 author-visible synthetic cases,2dev/4held-out
per candidate-generation/scoring class;4/4 floor retained.108 controls pass,
production input rendering and source/packet/context hashes verified. Manifest
bodies90096/120375bytes below128KiB;max inputs12850/21051 below24000.
Frozen per-output substantive criteria; fabricated narrative controls deliberately
expose structural blind spot. Gold fixtures are not provider/model-review evidence.
Freeze92635f76d187a51c3f356847f65d13d48dbdc31235feda8b31efe5841f2f5b59;
local13-binding candidate801007c2c9a2f17768dd12a3655de39db6dc335aaf4bcdc24a76534d9663fe1e.
This is source/compiled identity only, not an installed distributable. Installed
role1.3 unchanged; no executable plan/live decision/provider call. Old suites,
failures/locks and8 live artifact hashes preserved. See docs/DISCOVERY_SEMANTICS_V1.md
and tracking/evidence/discovery-semantics-v1/.
Next eligible U02: independent packet/controls/criteria/local-binding review.
Then prepare exact distributable/install/execution binding as scoped work. No
old-suite resumption, quota refresh, cap change or live dispatch. C54 partial.

## Role1.4 affected review supported — October 22, 2026

Separate model review supports bounded local finding-semantics implementation.
Exact prompt c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8;
39 immutable review artifact hashes verified at integration. No schema/selector
weakening or unresolved actionable findings. Reviewer independently passed23
checks through both standalone and compiled-default entry. Found P2 test discovery
gap: ten new calibration checks omitted by normal test glob. Repaired with small
tests/src/discovery-finding-semantics.test.ts importing shared calibration; compiled
entry now matches existing default glob. Build and23 checks pass; independent
review verified fix. Full default suite not run. Original receipts preserved;
supplemental default-entry receipt/transcript records this review-driven repair.
Historical failure/evidence unchanged and old execution guard refuses new prompt.
Installed role1.3 unchanged; no provider/network/studio/credential call or install.
See docs/DISCOVERY_FINDING_SEMANTICS_REVIEW_2026-10-22.md and review receipt/integration.
Next eligible: prepare prospective new evaluation packet and exact candidate
binding under role1.4; retain source controls, substantive review and frozen bounds.
No old locked-suite replay, new live authorization or model-behavior claim.
Full discovery/C54 remains partial.

## Finding semantics role1.4 implemented locally — October 22, 2026

Actual skeptic prompt defines finding types and authoritative reviews[].cheaper_test;
legacy enum/schema preserved. Role1.4 hash
c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8.
Direct installed TypeScript build passed;23 targeted checks passed/0failed/0skipped.
Calibration covers current rendered schema/prompt and source/proposal associations,
including disclosed structural acceptance of contradictory prose needing review.
Eight historical live artifact hashes verified; old execution guard rejects changed
candidate. No frozen assertions/output/grade changes. Installed role1.3 unchanged;
no provider call, installation, migration or new qualification.
See docs/DISCOVERY_FINDING_SEMANTICS_IMPLEMENTATION_2026-10-22.md and receipt/tests
in tracking/evidence/discovery-finding-semantics-implementation-2026-10-22/.
Next eligible U02: affected independent review of local prompt/tests; only then
prepare prospective new evaluation/candidate binding. No old-suite resumption.
Full discovery/C54 remains partial; no model-behavior verification claimed.

## Prospective finding semantics proposal prepared — October 22, 2026

U03 specification proposal defines weak_evidence for unsupported benefit and
novelty_overclaim for unsupported originality, with reviews[].cheaper_test as
authoritative test representation. Retain legacy enum/wire compatibility; no
normalizer, source-selector relaxation or historical regrade. Proposed role1.4
and new prompt hash are not implemented or activated. See
docs/DISCOVERY_FINDING_SEMANTICS_PROPOSAL_2026-10-22.md.
Verified8 live-result artifact hashes and28 preserved reviewer/source bindings;
unchanged exact-plan checker still passes108 controls. Preparation receipt in
tracking/evidence/discovery-finding-semantics-proposal-2026-10-22/.
No runtime edits, new provider calls, installation, live suite or policy change.
Next eligible U03: implement the prospective prompt/role clarification locally,
verify rendered prompt and source-association controls, then affected review.
Future live qualification requires new packet/plan/candidate binding; do not reuse
old exposed cases as independent holdouts or resume the locked suite.
Historical scoring failed/incomplete remains; full discovery/C54 partial.

## Follow-up v2 substantive model review completed — October 22, 2026

Separate reviewer directly assessed seven exact outputs and all21 frozen substantive
checklist judgments: supported. Bound request/output/packet/candidate hashes and
30 reviewer artifacts verified at integration; reviewed tracking snapshots saved
before this update. Independently replayed seven schemas/contracts and individual
assertions; historical six accepted/one scoring failure unchanged, five scoring
cases unattempted. No human acceptance or full qualification claim.
Review identifies P2 prospective taxonomy/representation alignment issue: prompt
does not define universal benefit as novelty_overclaim, or require a cheaper_test
typed finding alongside its separate cheaper_test field. Output addressed both
issues substantively; no selector defect established. Do not regrade/relax/resume.
See docs/DISCOVERY_FOLLOWUP_V2_OUTPUT_REVIEW_2026-10-22.md and new bound review
response/receipt/integration in discovery-followup-v2-output-review-2026-10-22.
No provider/network/studio/credential calls this review; no runtime/frozen changes.
Next eligible U03: propose explicit finding semantics and one authoritative cheaper
test representation, then prospectively align prompt/contract/new evaluation.
Preserve identity/source controls and all historical failures. No automatic repair,
new live suite, workflow, build or pilot. Full discovery/C54 remains partial.

## Follow-up v2 stopped on scoring acceptance — October 22, 2026

Owner approved exact suite and one additional availability refresh. Refresh succeeded;
suite sent seven sequential requests, no retries, then stopped at first scoring
development failure. Candidate generation operationally qualified: 2/2 dev, 4/4
held-out accepted. Scoring failed/incomplete: first dev failed assertions 4 and 8;
five cases including all held-out unattempted. Saved response discusses the issues
but uses weak_evidence instead of novelty_overclaim for P3/C3 and counterevidence
instead of cheaper_test for P5/C5. Offline exact-output replay reproduced both.
No rubric/prompt/code change; run.lock retained. Seven outputs need substantive
review. GET-only final state:44 requests (42 completed/1 failed/1 reconciled),
33 rolling,7 studio slots,0active/unknown,credits off/settings unchanged.
Eight new provider calls total:one approved refresh plus seven suite responses.
See docs/DISCOVERY_FOLLOWUP_V2_LIVE_RESULT.md and v2/live-result.json.
Next eligible prompt U02: independent substantive review and assessment of typed
finding failures, then prospective repair proposal if warranted. No auto retry,
resumption, suite, workflow, build or pilot. Full discovery/C54 remains partial.

## Approved follow-up stopped at freshness preflight — October 22, 2026

Owner approved exact plan 22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2
(12 sequential requests, no retries, credits off, 24-minute ceiling). Approval saved
in discovery-followup-v2/owner-execution-decision.json. Static bindings passed;
authenticated preflight stopped before run.lock or qualification creation because
availability observed 04:43:24Z was older than 15 minutes. No provider call.
GET-only read at 04:58:58Z confirms 36 requests unchanged, no manifest attempted,
zero active/unknown, 15 studio slots and unchanged settings/credits. Approval for
the suite remains valid for the unchanged plan; do not ask for it again.
Next: owner decision on one additional synthetic availability recheck, no retries,
120-second timeout, no quota reset/settings change; proposal recorded in
tracking/evidence/discovery-followup-v2/availability-refresh-proposal.json.
If approved and successful, continue the already approved suite after fresh gates.
Preserve all previous operation locks/grants. C54 remains partial.

## Discovery follow-up schema 28 binding separately reviewed — October 22, 2026

Prepared a new execution binding for the unchanged, unattempted 12-case packet.
Exact plan: 22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2.
17 tests and 108 controls passed; separate model review supported the binding.
Verified 259 execution bindings, 261 reviewer artifact hashes, and 61 installed
resources. Original packet, criteria, plans, and evidence remain unchanged.
Read-only snapshot at 04:52:48Z: 36 saved requests, 25 rolling, 15 studio slots,
zero active/unknown requests; credits off. Neither manifest has been attempted.
No provider calls, settings changes, installation, or suite execution in this step.
See docs/DISCOVERY_FOLLOWUP_V2.md and docs/DISCOVERY_FOLLOWUP_V2_REVIEW_2026-10-22.md.
Next eligible step: exact-plan owner decision, then fresh preflight for at most
12 sequential requests, no retries, 24-minute ceiling. Availability observed
04:43:24Z ages; the runner requires freshness within 15 minutes and includes no
extra refresh request. Earlier one-shot approval is consumed. C54 remains partial.

## V5 provider quota exhausted — October 21, 2026

10 new accepted answers/1 provider quota failure; no retry. Research operationally
qualified, candidate failed incomplete held-out gate/scoring unattempted. Studio
cap40 restored, credits off; provider quota remains exhausted.35 requests,0unknown/
active; no workflow/search/build/pilot. Independent review pending/C54 partial.
Source/installed candidate unchanged. docs/DISCOVERY_V5_LIVE_RESULT.md.

## V5 installed, no live dispatch — October 21, 2026

58 installed resources verified; state/schema/settings unchanged.24 requests and
zero unknown/active work.16 daily slots cannot admit18-case suite; no inference
started. Approval retained for unchanged plan after capacity/other gates pass.
Installed repairs have local checks/native installation evidence, no new real-model
verification. C54 partial. docs/DISCOVERY_V5_INSTALLATION.md.

## V5 repair candidate prepared, not activated — October 21, 2026

18 fresh packets/144 controls;75 local affected checks pass/0 skipped.183 source
bindings/58 package files verified. Installed app/saved studio unchanged; no live
requests.16 daily slots observed,18 needed before suite dispatch. No credits/cap/
permission expansion. Full discovery/C54 partial; exact approval and preflight next.
See docs/DISCOVERY_QUALIFICATION_V5.md.

## Approved timeout reconciliation — October 21, 2026

Request reconciled ran without usable result; v4 qualification closed failed3/4held.
24 requests unchanged, zero unresolved/in-flight; no new provider calls or integration
activation. Original timeout evidence preserved. Stream fixes remain uninstalled;
role1.3/C54 partial. Next repair candidate/prospective qualification preparation.
See docs/V4_TIMEOUT_RECONCILIATION.md.

## Local stream recovery repair — October 21, 2026

CRLF framing/completion fallback cap/reconciliation contradiction repaired in source;
36 affected local checks pass,0 skipped. No new real provider calls, installation or
reconciliation. Exact live unknown and24 saved requests unchanged; C54 partial.
Concrete ran-without-result/failed-qualification proposal pending owner decision.
Read docs/PLAN_STREAM_RECOVERY_REVIEW.md before any further dispatch.

## Approved v4 installed; one unresolved timeout — October 21, 2026

Five new plan requests completed/accepted; sixth timeout unknown stopped suite.
Current installed115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1;
schema/settings unchanged.24 total requests:23 completed/1unknown/0inflight.
Research qualification running/unresolved, role1.3 unqualified. No retry, candidate/
scoring dispatch, search/workflow/build/pilot or credits activation. Unknown retained;
next timeout/recovery/reconciliation review. docs/DISCOVERY_V4_LIVE_RESULT.md.

## Fresh v4 prepared, not activated — October 21, 2026

Role1.3 candidate packaged with18 frozen operational cases;45 local checks pass,
144 base scorer controls,162 source bindings and53 packaged files verified.
Installed app/saved studio unchanged. No provider calls/native search/Agent Reach
or integration activation. Independent review pending; full discovery/C54 partial.
Next eligible exact v4 packet approval/install/bounded execution. See
docs/DISCOVERY_QUALIFICATION_V4.md.

## Role1.3 local implementation — October 21, 2026

Explicit field semantics and opt-in identity-bound assertions implemented/tested
locally.38 affected checks pass/0 skipped with disposable PostgreSQL/loopback fakes;
new role rejects v1–v3 qualification for current workflow admission. Historical
grades remain unchanged. No installation, saved-studio mutation, real provider calls
or integration activation. Installed role1.2 unchanged; source role1.3 unqualified.
Full discovery/C54 partial. See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## Role1.3 local implementation — October 21, 2026

Explicit field semantics and opt-in identity-bound assertions implemented/tested
locally.38 affected checks pass/0 skipped with disposable PostgreSQL/loopback fakes;
new role rejects v1–v3 qualification for current workflow admission. Historical
grades remain unchanged. No installation, saved-studio mutation, real provider calls
or integration activation. Installed role1.2 unchanged; source role1.3 unqualified.
Full discovery/C54 partial. See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## Cross-role grading audit — October 21, 2026

Offline audit completed:18 v3 cases/71 assertions,72 diagnostic probes matched
expected scorer behavior including disclosed false acceptances. No provider calls,
runtime activation, install, settings or historical-grade change. Prospective
field semantics and identity-bound assertions remain proposed. Full discovery/C54
partial; v3 research operational qualification does not establish independent
substantive acceptance. See docs/DISCOVERY_ASSERTION_SEMANTICS_AUDIT.md.

## Fresh v3 qualification frozen and candidate prepared — October20,2026

Completed18 new synthetic packets/manifests for current role1.2 with exact production
prompt and message serialization.2 development/4 held-out per class; full two-finding
revision and five-proposal skeptic coverage. Cases/criteria/gold/control hashes frozen
before target outputs.144 local scorer assertions, including18 explicit demonstrations
of the substantive-entailment blind spot; required reviewer checklists retained.
All56 affected checks pass/0 skipped on disposable PostgreSQL and loopback stand-ins.
Actual v3 manifests exercised through authenticated HTTP; research service grading
uses stand-in outputs, not real model evidence. POST bytes101745/86861/104186 and
max inputs12244/12140/18274 fit existing128KiB/24000 limits. Historical v1/v2 files,
failed grades and locks preserved. TypeScript/web build and native NSIS packaging
passed; existing chunk warning. Test cluster stopped. No new provider calls, saved
studio changes, install, settings expansion or migration. Current installed manifest
remainsb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Concrete review packet: docs/DISCOVERY_QUALIFICATION_V3.md. New installer hash
a29821c994c7a4f3de6e9629fc92be27de449467a28444b43d19eebb8a9ad648,
bundle907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17,
execution plan8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a
binds146 files plus frozen data. Next eligible: exact v3 packet approval, graceful
install/state verification and max18 new sequential plan requests with no retries/
new metered spend, stop first failure/unknown/quota. No automatic workflow/search/
build/pilot; substantive review remains separate, discovery unqualified and C54 partial.

## Discovery output-contract audit/revision1.2 completed offline — October20,2026

Audited locate/propose/revise/skeptic against all production schemas. Replaced
field-name sketches with schema-derived JSON types/limits/enums/reference formats,
strict object keys and full revision shape. Clarified discovery payload instead of
generic TaskResult/status/usage wrapper; preserve uncertainty within bounded fields.
Application validators, relational/source checks, permissions and budgets unchanged.
Shared discovery role version1.2/prompt hash01ef4e7c37ab9c6c50abe0d4c3ef25a22484daa8d3d1490672bc60e8007c0f00.
No provider-enforced structured-output support assumed: existing plan adapter still
sends text; deterministic post-validation and substantive review remain required.
TypeScript passed;52 affected tests pass/0 skipped on disposable PostgreSQL and
loopback stand-ins, including189 nested boundary mutations, exact historical v1/v2
bytes/grades and rejection of both historical qualification versions. Current-model
fixture HTTP payloads101668/83535/88740bytes and inputs12173/10748/10939characters
fit accepted ingress/input caps. Test-only rebindings are not live qualification.
Retained exact v2 output still invalid; no coercion/regrading. Offline inventory
and prompts: tracking/evidence/discovery-output-contract.18 fresh v3 scenario
designs proposed, not executable manifests or frozen live authority. No model calls,
install, settings change, migration or frozen-study protocol/weight changes. Current
installed bundle remainsb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Read docs/DISCOVERY_OUTPUT_CONTRACT_AUDIT.md. Next eligible: author/freeze complete
fresh v3 packets/manifests/controls, verify exact HTTP/input bounds and reviewer
checklists, then prepare a concrete candidate/execution packet. No automatic live
rerun, workflow/search/build/pilot; discovery unqualified and C54 partial.

## Approved transport repair installed; v2 stopped on schema failure — October20,2026

Jordan approved exact repair packet8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459.
Verified137 bindings, saved hash-verified program rollback, graceful Quit, installer
exit0 and installed manifestb59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048.
Reopened with session/schema27/settings/records unchanged; no migration/permissions
change. Real API qualification creation now succeeds. Exactly one new gpt-6-astra
request completed on loc-dev-maintenance, then schema_invalid stopped the suite.
affected_users was an array instead of string; gaps had10 entries versus max8.
No retry, later cases/classes or held-out dispatch. Research qualification
9586ebfb-adf8-4550-8c95-9a011744f2a1 is failed. Independent readback:11 total completed
requests, zero in-flight/unknown/leased and0 workflows. Earlier summarization remains
narrowly qualified; discovery does not. Raw output, hashes, failed grade and all
three locks preserved. Coding-agent author review observed appropriate uncertainty
and synthetic limits, but is not independent human acceptance or a passing grade.
See docs/DISCOVERY_V2_LIVE_RESULT.md and tracking/evidence/discovery-v2-transport-repair/
execution-outcome.json. No metered fallback/credits activation/search/workflow/build/
pilot launch. C54 partial. Next eligible: bounded model-facing output-contract audit
against every production role schema, exact types/limits and versioned prospective
controls/qualification proposal; preserve current failure, no automatic live retry.

## Approved v2 installed; zero-dispatch HTTP413 stop; repair prepared — October20,2026

Owner approved exact v2 packet. Verified program-only rollback, graceful Quit,
installer exit0 and installed bundle733837fe38fd84be6479e02ac1115dededd98a7ca99a644d03b31e72b043897c.
Reopened with saved session/schema27/settings/records unchanged. Qualification
manifest creation was rejected by the64KiB API body cap: research payload77,265bytes.
Runner stopped at attempted0/qid=null; preserve v2 run.lock. Independent readback:
10 total completed requests, zero active/unknown/leased, no new qualifications,
19 audit events and zero workflows unchanged. No target inputs were sent.
Narrow fix implemented locally: authenticated qualification creation accepts128KiB,
all other actions retain64KiB; declared and streamed bytes, owner/CSRF/schema/task/
data/model/version gates remain. Four HTTP/API checks pass using actual frozen
manifest payloads and chunked requests, oversized/unauthenticated rejections and
loopback-only inference stand-ins. TypeScript/web/service/native/NSIS build passed;
existing chunk warning. Repair built but not installed. Original18 model cases,
criteria and runtime prompt unchanged; frozen-input/role evidence remains as before.
Separate repair packet binds137 files/receipts and requires predecessor zero-dispatch
proof; new lock preserves stopped run. docs/DISCOVERY_V2_TRANSPORT_REPAIR.md has
exact candidate/run hashes. Next eligible: approve/install transport repair and run
same bounded18-case suite (no retries/new metered spending), then substantive review.
No saved-data migration or permission expansion proposed. C54 partial; discovery
unqualified. No workflow/search/build/pilot activation.

## Operational rubric1.1 and executable v2 qualification prepared — October20,2026

Implemented explicit observed-need confidence anchors in the production locator;
shared discovery role version is r02-discovery/1.1. Packet admission is separate
from corroboration/real-world validity and from untested intervention benefit.
Authored/froze18 fresh production-bound cases and108 local scorer controls, with
positive coverage of all confidence labels, schema-valid bad decisions, source
refs, designer revision and multi-proposal skeptic coverage. All44 affected tests
passed with zero skips on disposable PostgreSQL. Historical v1 grades/bytes remain
unchanged and a qualified v1 manifest cannot unlock the revised role. A semantic
negative control documents the narrative-entailment gap; substantive review is
still required and the runner retains reviewer/output-hash checklist state.
Offline initial draft packet-tag inconsistency was corrected before target output;
its manifests/freeze/test log retained in v2/preflight-draft. Final bundle built and
NSIS packaged; backup-first staged upgrade and restore/adoption passed. Extra staged
startup/persistence check blocked by existing port4310 (failed receipt retained),
not claimed verified. No installed update, saved settings/migration or provider calls.
Review packet: docs/DISCOVERY_QUALIFICATION_V2.md; evidence:
tracking/evidence/discovery-qualification-v2. Exact127 bindings and installer/run
hashes prepared. Next eligible: scoped approval/install/execution of the v2 packet
(max18 new plan requests, no retries/new metered spend, stop first failure), then
substantive review of exact outputs; no automatic workflow/search/build/pilot.
Earlier v1 approval does not cover this new candidate/run. C54 remains partial.

## Discovery evidence-strength review completed — October20,2026

Offline review: docs/DISCOVERY_QUALIFICATION_RUBRIC_REVIEW.md. Packet sufficiency
is investigation admission, not proof of independent or real-world need. Production
locator labels lack scope anchors; two v1 cases require well_supported despite
synthetic evidence. Actual exploratory response is defensible; original failed grade
is retained, not promoted. Review reproduces contract-pass/assertion-fail and verifies
117 pinned source bindings, original manifest bytes and preserved run.lock.
Prepared18 fresh scenario designs (2development/4held-out per class), including
designer revision, in config/connections/benchmarks/discovery-synthetic-v2/proposal.json.
These are prospective design specs, not executable manifests, independent ratings,
a frozen study or live authority. No provider calls, runtime/prompt/installed/settings
changes. C54 remains partial; discovery unqualified. Receipt:
tracking/evidence/discovery-rubric-review/result.json. Next eligible: implement
operational rubric anchors and production-bound v2 manifests/controls, verify all
roles and prepare a new hash-bound execution packet. No automatic install/live rerun.

## Approved discovery upgrade executed; qualification stopped — October 20, 2026

Jordan approved the exact review packet. Installer exited0; installed bundle hash
80fe5f7a40e844d6361277dc4c96f33e927cb0527871fe2e863c08b086cdb56b.
Supported installed service saved a verified pre-upgrade dump and migrated26→27.
Desktop reopened, local-owner sign-in renewed, reviewed three task permissions
accepted through API; caps/data/credits-off unchanged. Exactly one live gpt-6-astra
request completed, then stop-on-first-failure halted dev-transfer: production schema/
refs passed, frozen well_supported expectation disagreed with exploratory output.
No retries, held-out cases, later classes, search, workflows or pilot launched.
Readback:10 total completed requests, zero in-flight/unresolved; discovery remains
unqualified (research_synthesis failed; other two classes untested). Preserve all
frozen inputs/criteria/run.lock. Possible overly restrictive authored expectation
requires review, not retroactive passing. See docs/DISCOVERY_QUALIFICATION_RESULT.md
and tracking/evidence/discovery-qualification-prep/execution-outcome.json.
Next eligible: bounded evidence-strength rubric review and versioned fresh-case
qualification proposal; no automatic rerun or new milestone. C54 remains partial.

## Discovery qualification and migration prepared — October 20, 2026

Concrete review packet: docs/DISCOVERY_QUALIFICATION_PLAN.md. Built final unsigned
installer and staged migration-27 bundle; current installed manifest re-read and
verified rollback program copy prepared (no studio data/credentials copied).
Prepared 18 new synthetic cases: 2 development + 4 held-out per discovery class.
Production schemas/source refs and frozen decision assertions grade outputs; current
role-prompt binding and designer revision coverage are required by workflow admission.
Unrelated/stale task-class qualification cannot unlock discovery. Local checks32/32,
staged backup-first upgrade/restore checks2/2; native release/NSIS build passed.
No new real provider calls, saved-studio migration, installation, settings expansion
or activation. Before/after settings, source/artifact hashes and exact execution plan
are in tracking/evidence/discovery-qualification-prep. Initial freeze's template
settings hashes are superseded only for execution by settings-review.json; case
bytes/criteria unchanged and no target outcomes seen. The actual approved change
adds only research_synthesis/candidate_generation/scoring, preserving all caps/data/
credits policy. Next eligible: exact packet approval/execution (max18 plan calls,
no retries/new metered spend; stop on failure/unknown/quota). Do not replay summary
benchmark or start other milestones. Existing uncommitted work preserved.

## §2.19A subscription discovery bridge — October 20, 2026

Implemented first slice in checkout; docs/SUBSCRIPTION_DISCOVERY.md describes exact
scope. Migration 27 adds immutable typed workflow resources and task-bound replay
outputs. Plan discovery has no API pricing/envelope, uses existing grants/lifecycle/
leases, and requires research_synthesis/candidate_generation/scoring qualifications.
Connection settings/data/role/call/day/run caps and input hashes are checked; one
job/attempt, bounded repairs, cancellation and unknown-result reconciliation remain.
Embedded and standalone workers share the plan service. Submit selects resource/data
classes and shows blockers; workflow details distinguish subscription usage. Legacy
payload/hash and frozen-study paths retained; local route explicitly unimplemented.
Checks: TypeScript/web pass; affected suites 46/46; final focused checks and candidate
hashes in tracking/evidence/subscription-workflow; browser 7/7 fixture-only, zero writes.
No new real provider calls, settings changes, studio migration, native install,
Agent Reach, pilot activation or study changes. Existing earlier uncommitted repairs
preserved. C54 remains partial. Next eligible: bounded role-qualification preparation;
live dispatch/settings expansion requires its matching scoped authority. See guide.

## Current-status reconciliation completed — October 20, 2026

Authoritative concise snapshot: docs/CURRENT_STATUS.md (candidate/evidence table,
limits and next bounded prompt). Earlier conflicting entries below are historical.
Staged desktop manifest hash rechecked against recorded installed receipt; no fresh
installed-disk/native acceptance asserted. Plan-summary receipts confirm narrow
2/2 development + 6/6 held-out qualification, not discovery/search/code readiness.
Readiness register adds C52–C54 as not_verified and corrects obsolete no-live-call
blockers without promoting states/removing gates. Deterministic check: not_ready,
zero register problems. Separate non-activating owner-pilot.defaults.json prepares
accepted defaults; activation config unchanged. Manual schedules=[] rejection and
integration-wide account gating remain implementation blockers, not bypassed.
Next eligible: first §2.19A typed-resource/workflow-bridge slice in CURRENT_STATUS.
No runtime implementation, live dispatch, installs, activation or frozen-study change.

October 20 live qualification: Jordan completed gpt-6-astra model verification, then
authorized the initial synthetic summarization qualification. Eight additional calls,
development 2/2 and held-out 6/6, recorded qualified via the existing plan domain gate.
Installed-API read verifies matching ledger/output hashes and zero unknown outcomes.
This proves only the narrow structured-summary manifest, not general summarization
quality, specification, code builds or research readiness. No credits, paid fallback,
new integration activation or settings change. See docs/PLAN_SUMMARIZATION_QUALIFICATION.md
and tracking/evidence/plan-summary-v1; earlier status entries are historical.

October 20 native ChatGPT repair: owner attempted browser registration twice; neither
saved credentials locally. Reproduced/fixed DPAPI executable lookup under minimal PATH
and credits JSON timestamp rejection that hid the existing connection. Updated build
installed and local response parses correctly; native vault and fixture OAuth/API/UI
checks pass. Fresh owner sign-in completed and owner-confirmed; installed API reports
plan usage granted and a separate process reopens the protected credentials. Ledger:
zero model requests. No model access or task qualification promoted, and no duplicate
ChatGPT account entries modified. See the
latest BUILD_STATUS/SESSION_HANDOFF entries; historical statements below describe
their original verification times.

October 20, 2026 §2.2/§2.4 (ADR-0042): ChatGPT plan connection (Sign in with ChatGPT,
direct Responses) and Codex 0.163.0 builder implemented and verified only against
loopback stand-ins and the pinned binary with a fake relay upstream. No client was
registered, no sign-in, no model call, no Codex install on Jordan's machine. Activation
needs Jordan's sign-in, dated credits-off confirmation, cap acceptance and one approved
verification call. No readiness state promoted. See docs/MODEL_CONNECTIONS.md.

October 20 reset layout: rebuilt/installed and checked in native app. Owner-approved
backed-up schema 24→25 upgrade applied; no provider activated or readiness promoted.
Evidence: tracking/evidence/reset-layout/result.json.

October 20 draft-navigation repair: shared UI, native executable and unsigned
installer rebuilt; no integration activated or readiness state promoted. Fixture
browser checks pass; native interaction pending. See tracking/evidence/page-drafts.

Owner choices are recorded in [the accepted register](OWNER_DECISIONS_2026-10-20.md): local/subscription first; optional paid fallback off; task-scoped research; user-configurable budgets; bounded GitHub; staged distribution; hosted/commerce/advertising activation deferred. This document update promotes no integration readiness or verification state.

October 20, 2026 §2.1 installed desktop (ADR-0041): no external integration activated and no readiness state promoted. The installed app uses owner-installed PostgreSQL 18 binaries as a verified local prerequisite (not bundled, not downloaded) and bundles the build host's Node 22.21.0. Its service child gets no OPENAI_* or provider settings, so live adapters stay unconfigured. Building the NSIS installer let the Tauri CLI fetch its NSIS tools from the official tauri-apps release URLs with hash validation. See docs/DESKTOP_STUDIO.md and tracking/evidence/desktop-2-1.

October 20, 2026 audit repair: the payment and OpenAI batch adapters were hardened locally (observation fences, bounded reads, durable cleanup and expiry). The QA input boundary was verified in the real WSL worker. No live provider/payment call, file deletion, account verification or activation occurred. See docs/AUDIT_FIXES_2026-10-20.md and tracking/evidence/audit-fixes. Existing readiness states are not promoted by these repairs.

X10 (October 19, 2026): no new integration and no live call. Integration states now live in
`config/readiness.json` and are checked by `pnpm readiness`; the generated report is
tracking/evidence/x10/READINESS.md. None of the 15 integrations gained a state in X10.

X09 (October 19, 2026): portfolio schedules run through existing source, artifact
and workflow adapters, with shared admission/budget gates. Optional API polling
(`CREATOR_PORTFOLIO_SCHEDULER=on`) is implemented but defaults off and was not
activated. Verified manual passes use synthetic sources and fixture models;
there is no new live adapter, credential, paid call or external mutation.
Knowledge components/lessons/prompts/skills are reviewed bounded task guidance,
not installed executable plugins or policy changes. Structural regressions do
not establish empirical quality gains. Product health means archive integrity,
not runtime uptime. See docs/X09_PORTFOLIO.md, ADR-0036 and evidence/x09.

X08 (October 19, 2026): implemented local fixture sink, authenticated API/CLI and
Campaigns screen. No real outreach adapter, mailing-list import, paid ads,
credentials, public landing-page deployment or payment integration was activated.
Fixture recipients are opaque `test:` IDs; exposure is bounded at zero adapter
spend plus a grant delivery cap/expiry. Host compute is unmetered. Unknown outcomes
reconcile from the local transactional native inbox without resend; this does not
establish an external-provider reconciliation contract. Suppression is owner-managed
and workspace-wide; no public unsubscribe flow exists. See docs/X08_MARKETING.md,
ADR-0035 and tracking/evidence/x08 for verification and limits.

October 19 audit: X06/X07 repaired in the attached worktree (ADR-0034, migration 20).
No change in activation: hosted configuration remains undeployed; payments remain
fixture/contract checked, with no Stripe test/live API observation. Account identity,
loss history completeness and funding rail uniqueness now fail closed. Existing
databases were not migrated. See docs/X06_X07_AUDIT.md and current build status.

X06 hosted operation (October 19, 2026, Claude Code, branch claude/x06-j2pz5g):
hosted mode, environment-labelled databases, readiness/metrics/status endpoints,
owner-recorded build-bound verification and hosted-to-local worker pairing are
implemented and checked against local PostgreSQL with loopback hosted processes and
a stand-in proxy. Not activated or verified: any hosted environment, DNS/TLS
certificates, managed PostgreSQL (verify-full TLS), OIDC provider for hosted sign-in,
Prometheus scraping, external alert delivery (fixed to none; no adapter), and the
deploy/hosted container images (never built). No live verification is recorded.

X05 local Windows acceptance passed October 19, 2026: final release native
sign-in/browser-handler launch, shared authenticated Gallery, verified source,
visible Notepad editor copy, real paired WSL job and visible worker controls.
Owner approval used the explicit local fixture HTTP seam; no personal login or
live OIDC acceptance claimed. Editor uses a rehashed Downloads copy and fixed
packaged Notepad activation; original cache preserved. Explicit shutdown exited
the CLI 0. Evidence: tracking/evidence/x05/native-ui-acceptance.json. Local manual
installer lifecycle passed separately; final unsigned installer rebuilt. Signing,
automatic updater, hosted connections, other hosts and production activation
remain disabled/unverified. Entries below describe earlier candidates.

X05 continuation: actual paired active-process revocation and killed-worker/owner
API reconciliation passed on real WSL; no automatic retry. Tauri CLI 2.12.3 pinned,
NSIS local-client bundle prepared. Separate unsigned debug identity verified native
startup after install, upgrade and manual rollback; downgrade refused, fixture
uninstalled. Existing WebView2 and separately started studio services required.
No signed automatic updater, public distribution, OIDC activation or background
service installation. Interactive native UI/editor and other-host acceptance remain.

X05 continuation, October 19, 2026: migration 17 adds bounded owner jobs; explicitly
paired artifact.run CLI workers execute exact locally available artifacts using
reviewed WSL2/bubblewrap/systemd isolation. Native-to-worker launch and separate
window/worker shutdown verified. Browser handoff verified with isolated Edge
fixture approval and ordinary/Secure cookies. No live OIDC/default-browser-handler
acceptance. Worker reports remain observations, never independent QA. No installer,
update service, hosted connection or external account activated. Earlier
presence-only readiness below describes the prior candidate.

X05, October 19, 2026: Rust/Cargo/MSVC/WebView2 verified on Windows. Tauri shell
compiles/starts; native source download verified with disposable fixture session
and T13 test-double artifact, preserving exact manifest/archive hashes. Native
browser sign-in/menu implementation exists; interactive browser approval, editor,
OIDC/secure-cookie and real-worker launch gates remain. Migration 16 implements
single-use/session-bound pairing and separate revocable desktop sessions/workers;
shared UI and outbound client control presence-only scoped/fenced leases. No paired
job dispatch, arbitrary native IPC, installer/updater, background service or hosted
integration activated. See apps/desktop/README.md and tracking/evidence/x05. X01–X04
source is now integrated from origin/main ddf7bcf; their recorded fixture/live
boundaries remain unchanged. Existing local audit repairs preserved.

X04, October 19, 2026: no live call and no credential. GitHub REST (API version
2026-03-10) and Git-over-HTTPS adapters exist for a GitHub App installation or a
fine-grained token named by environment variable; they are checked only against
loopback contract tests and a local bare repository. Live use needs CREATOR_GITHUB=live
on the API process, a verified connection in a real workspace and grants. Endpoint
permissions were checked on docs.github.com. See ADR-0027 and docs/GITHUB.md.

X03, October 19, 2026: no new external integration and no live call. Semantic search
calls embedding models only through the broker (`model.embed`), and
config/search/semantic-models.json lists none for real workspaces, so they refuse it until
an owner verifies an embedding model (accessible id, dated pricing snapshot, data-class
approval). The fixture model fixture-embed-v1 (config/pricing/fixture-embed-v1.json) is a
labelled trigram hash with simulated rates. A model-compiled audit question is one
ordinary metered `model.generate` call; its output is a plan validated by schema, never SQL.
See ADR-0026 and docs/SEARCH_AND_AUDIT.md.

X02, October 19, 2026: no live call. config/context/provider-capabilities.json
records gpt-6-astra prompt caching, Batch API (/v1/responses, 24h window, 50% price in
config/pricing/openai-gpt-6-astra-batch.json) and server-side compaction as
`documented` from the official pages; real workspaces refuse them until verified.
OpenAIBatchAdapter (Files upload, POST /v1/batches, poll, output/error files) exists
behind the same CREATOR_LIVE_PROVIDER=openai opt-in and key as the live adapter and is
checked only against a loopback contract test. Fixture models fixture-context-v1
(simulated prompt cache and batches) and fixture-lossy-v1 use simulated rates. See
ADR-0025 and docs/CONTEXT_AND_CACHING.md.

X01, October 19, 2026: no new external integration and no live call. The model
registry records gpt-6-astra as `documented` (account access unverified), so a real
workspace refuses to route to it until an accessible API id is verified and recorded
as a new registry version. Two further fixture models (fixture-economy-v1,
fixture-bargain-v1) exist only for the deterministic adapter; their rates are
simulated units. See ADR-0024 and docs/MODEL_ROUTING.md.

T13, October 18, 2026: no new external integration. A local preview origin
(CREATOR_PREVIEW_PORT, default 127.0.0.1:4320) serves studio-authored pages that
start the exact verified package in the existing T11 WSL2 worker. Downloads and
previews are owner-only and local; public publication, hosting and native
installers are not implemented or activated. See ADR-0017 and
docs/ARTIFACTS_AND_PREVIEW.md.

T12, October 18, 2026: the authenticated owner CLI now connects current frozen
T08 tasks to existing model-call admission/reservations, scoped T11 Git patches,
fresh reviewer context and real WSL2 QA. Fixed synthetic Python checklist roles
exercise normal/error cases; no live model was activated. Exact task/commit/spec,
prompts, owner acceptance plan, broker traces and execution records persist locally.
Browser/persistence recipes, dependent-task integration, searchable build records,
participant implementation execution and public delivery remain unavailable.
See docs/BOUNDED_BUILDER.md, ADR-0016 and tracking/evidence/t12. Test files now run
serially to bound real-worker resource contention; internal concurrency gates remain.

Docker follow-up, October 18, 2026: local Docker CLI/daemon and Compose verified
(Desktop 4.95.0 / Engine 29.8.2 / Compose 5.6.0). Optional official PostgreSQL 18.6
image pinned by digest in compose.yaml; independent localhost dev/test services,
private ignored password file, no host-directory or daemon-socket mounts.
Migrations, persistence, host TCP authentication and all 140 DB/WSL tests passed.
Dev remains running, test stopped. Application use requires explicit terminal URL
configuration; existing PostgreSQL data is unchanged. No callable Docker MCP tool
was exposed in this chat, so the Codex connection-selector state is not separately
certified. No generated-product Docker worker activated; T11 WSL remains in use.
See docs/DOCKER.md, ADR-0015 and evidence/docker.

T15, October 18, 2026: no new integration activated. Study builds reuse the T12 builder, the T11 WSL2 worker and the fixture broker; `config/evaluation.json` records the owner's `gpt-6-astra` preference (unverified, live dispatch off) and the $20 T15 cap with no spend authorized. See ADR-0022.

T11, October 18, 2026: reviewed local execution now uses the existing Ubuntu WSL2 VM, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4. The authenticated owner CLI binds current frozen T08 specs to separate Git repositories and a fixed offline template recipe. Real isolation/resource/cancellation/recovery gates were exercised; no Docker socket, personal mount, live provider, paid service or remote worker activated. Other hosts are blocked without a reviewed backend; ordinary CI skips real WSL execution explicitly. See ADR-0014, docs/ISOLATED_EXECUTION.md and evidence/t11.

T10, October 18, 2026: synthetic study execution reuses the fixture broker and T07 workflow worker. No new external integration, paid route, credentials, recruitment or real participant data. Native Windows PostgreSQL 18 was exercised in a disposable loopback-only cluster on port 55432. Human-only entries and conventional text checks require no model. Grader material remains under separate authorization; see ADR-0013 and evidence/t10.

## Development tools installed October 18, 2026

These are tools for the coding agent in this checkout, separate from the product integration table below. Setup details: [development tool guide](../docs/DEVELOPMENT_TOOLS.md).

| Tool                                          | Installed / configured                                                                                      | Executed verification                                                                                                  | Remaining limit                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Emil Kowalski / Ponytail / Matt Pocock skills | 15 / 6 / 5 project skills, pinned Git commits                                                               | 104 upstream files across all 27 skills including Impeccable matched Git blob hashes; unique names/frontmatter present | Workflow usefulness is not benchmarked; next-turn discovery                                             |
| Impeccable                                    | Skill 4.6.0 and local Windows x64 engine 0.1.15                                                             | Published SHA256 matched; engine-probe passed                                                                          | Design commands, hooks and live overlay not activated/tested                                            |
| Playwright MCP                                | Project stdio entry; npm package 0.0.83; isolated headless Edge                                             | Codex configuration read; initialize, 25-tool discovery, blank navigation and close passed                             | Chat MCP restart may be needed; no personal session or generated-product sandbox                        |
| Firecrawl MCP                                 | Official keyless hosted project entry                                                                       | Codex configuration read; initialize and three-tool discovery, server 3.30.3                                           | Search/scrape/parse untested; rate-limited; full account/paid capabilities unverified                   |
| REA skill (`reverse-engineer-anything`)       | Skill instructions from morluto/rea at c12d9ed, in `.agents/skills` and `.claude/skills` (added 2026-10-18) | 7 files copied unchanged, hashes in manifest, both copies identical                                                    | REA MCP server not registered; `rea-agents` setup, Hopper/Ghidra/IDA not installed; no REA analysis run |

Evidence: [manifest](evidence/development-tools/install-manifest.json), [MCP check](evidence/development-tools/mcp-verification.json). No credentials stored or copied. Existing Firecrawl app connector was observed in this session's available tools; it is distinct from this project MCP entry and its account status was not tested. Product source-search/fetch remains unimplemented.

Claude Code (October 18, 2026): `.claude/skills` mirrors all 31 skills (30 at first install, plus REA); `.mcp.json` holds both servers; Playwright verified in a Linux cloud container with executable-path and sandbox overrides (25 tools, `data:` navigation, close); Firecrawl unreachable from the cloud network (proxy 403) and untested there. The claude.ai Firecrawl connector is the recommended cloud route; it is not connected yet.

## Product integration status at T01

Updated October 17, 2026 (America/New_York), T01. Local API/CLI/web and the deterministic fixture provider are implemented and tested. No external application adapter is active. See [T01 evidence](evidence/t01/verification.json), [historical remote observation](evidence/t00/remote-refs.json), and [ADRs](DECISIONS.md).

| Integration                   | Implemented                                                                                                                     | Fixture tested                         | Contract tested                                                                                                                                             | Live verified                                          | Activated                                                                                                                                                                                | Evidence / remaining setup                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local API/CLI/web             | Yes, stateless                                                                                                                  | Yes                                    | Yes                                                                                                                                                         | Local HTTP and browser only                            | Local fixture demo                                                                                                                                                                       | apps/api, apps/cli, apps/web; health, strict requests, errors and fixture results. No persistent catalog or hosted service.                                              |
| Model/provider broker         | Yes (T04): `ModelBroker`, fixture adapter, OpenAI Responses adapter                                                             | Yes                                    | OpenAI adapter against a loopback server (usage normalization, 429/401/5xx/malformed mapping, key not serialized)                                           | No live call                                           | Fixture workspaces only; live needs `CREATOR_LIVE_PROVIDER=openai` + `OPENAI_API_KEY`, documented pricing, a covering grant and a funded envelope                                        | `gpt-6-astra` and its pricing documented on developers.openai.com (retrieved 2026-10-18); account access unverified. config/provider-availability.json, config/pricing/. |
| Source search/fetch           | Fetch: yes (T06) `SourceBroker`, fixture adapter, HTTP adapter. Search: no live adapter (T04 fixture `tool.search_public` only) | Yes (synthetic `.fixture.test` corpus) | HTTP adapter against loopback servers (DNS answer check, pinned address, no credentials/cookies, byte limit); policy and redirects against PostgreSQL 16.15 | No real site fetched                                   | Fixture workspaces only; live needs `CREATOR_SOURCE_FETCH=live` + `CREATOR_SOURCE_HOSTS` and a covering `source.fetch` grant                                                             | packages/research, migration 5, ADR-0009, evidence/t06. Approved host list, robots/terms review and a live search provider still to choose.                              |
| PostgreSQL persistence        | Yes (T02)                                                                                                                       | Yes (fixture workspaces)               | Yes                                                                                                                                                         | Local PostgreSQL 16.15 in a Linux cloud container only | Optional; enabled by CREATOR_DATABASE_URL (loopback only)                                                                                                                                | packages/db, migration 1, evidence/t02. Owner's Windows PostgreSQL install untested; no hosted database.                                                                 |
| Owner authentication (OIDC)   | Yes (T03), openid-client 6.8.8                                                                                                  | Local development login                | PKCE flow against a local test identity provider                                                                                                            | No real IdP                                            | Optional via CREATOR_OIDC_*                                                                                                                                                              | Development login refused in hosted mode; no IdP account configured.                                                                                                     |
| Durable workflow service      | Yes (T05): PostgreSQL-backed coordinator, leases and fencing in `packages/db` + `packages/orchestrator`; no Temporal (ADR-0008) | Yes (fixture workspaces)               | Restart, duplicate delivery, stale worker, decision wait and cancellation against PostgreSQL 16.15                                                          | Local PostgreSQL in a Linux cloud container only       | In-process worker in the API when a database is configured (`CREATOR_WORKER=off` disables); optional `pnpm worker`                                                                       | No external workflow service. Owner's Windows PostgreSQL untested.                                                                                                       |
| Execution isolation           | No                                                                                                                              | No                                     | No                                                                                                                                                          | Unverified                                             | No                                                                                                                                                                                       | No worker; Docker not on PATH, VM/container boundary unverified. T11.                                                                                                    |
| Local Git/artifacts/preview   | No application adapter                                                                                                          | No                                     | No                                                                                                                                                          | Git CLI only                                           | No product activation                                                                                                                                                                    | Git 2.45.1.windows.1, unborn main/origin configured. No generated-product Git, artifacts or preview service.                                                             |
| Remote GitHub                 | Yes (X04): REST + Git adapters, fixture GitHub                                                                                  | Yes (fixture workspaces)               | Loopback REST contracts (fine-grained token, app installation tokens), local bare-repo push                                                                 | No credential configured                               | Off unless CREATOR_GITHUB=live plus a verified connection and grants                                                                                                                     | No live call or repository; studio repositories are private, prefixed and tracked by id. Releases, settings, secrets not implemented.                                    |
| Windows desktop/paired worker | No                                                                                                                              | No                                     | No                                                                                                                                                          | No                                                     | No                                                                                                                                                                                       | Native tooling/build/pairing/device verification deferred to X05.                                                                                                        |
| Hosted control/monitoring     | No                                                                                                                              | No                                     | No                                                                                                                                                          | No                                                     | No                                                                                                                                                                                       | No deployment, external tracing or notifications configured. X06.                                                                                                        |
| Payments/reinvestment         | Yes (X07): fixture processor, Stripe test-mode REST adapter, signed webhooks, ledger, entitlements, reinvestment                | Yes (fixture workspaces)               | Stripe adapter against a contract double (payment intent, refunds, disputes, checkout, balance, payout); signature scheme per docs.stripe.com 2026-10-19    | No processor call or account                           | Fixture workspaces only; Stripe test mode needs `CREATOR_STRIPE_*` key + webhook secret env vars and a verified connection. Live mode not built; activation is a separate owner decision | docs/PAYMENTS.md, migration 19, ADR-0033, evidence/x07. Web Payments page (Oct 26).                                                                                      |
| Campaign delivery             | No                                                                                                                              | No                                     | No                                                                                                                                                          | No                                                     | No                                                                                                                                                                                       | No connector or content/audience grant. X08.                                                                                                                             |

Local tooling: Node v22.21.0 application baseline, bundled Node v24.19.0 additionally tested; pnpm 11.25.0 uses that bundled runtime. Strict manifests and lockfile now pin dependencies; a fresh frozen install/build/check passed. npm/Python/gh observations remain in T00 evidence. gh availability is not authentication verification. No secrets/private account configuration were read. Services, real model access, pricing and grants remain unresolved at their later gates.

Record verification date, observed target/account identity, versions, and evidence without storing credentials. A missing key blocks a live check; complete unrelated implementation first.

## Local audit publication — 2026-10-19

No external integration activated. Local maintenance diagnostics and cancellation/session fixes are published separately from X08/X09. Earlier local tracking edits are preserved in evidence/local-audit/original-tracking.patch; current entries above remain authoritative.

October 20 fresh studio adoption: local PostgreSQL creator_studio verified at schema 24 with backup/scratch restore and authenticated API persistence checks. Existing development data retained. No external integration readiness state promoted. See docs/LOCAL_STUDIO.md and tracking/evidence/studio-adoption/result.json.

## §2.5 search/retrieval candidate — October 20, 2026

Source search now has a disabled Brave Web Search adapter through ModelBroker and the authenticated source-searches run route. Implemented/fixture/contract verified; live/activation NOT verified. Existing HTTP source fetch retained, with run-cancellation abort and durable adapter exceptions repaired. 34/34 research/broker/API and 12/12 final search/budget checks on disposable PostgreSQL 18, with overlapping suites. Evidence tracking/evidence/research-2-5; setup/remaining qualification docs/RESEARCH_RETRIEVAL.md. Provider price/terms/access not qualified; coding Firecrawl is not a runtime credential. No live query/fetch or paid dispatch. Migration 25 not applied to saved studio. Readiness remains blocked on real account-specific configuration, terms/suitability, local/subscription prerequisites and a bounded live grant. This supersedes the older 'no live search adapter exists' implementation statement only; it does not supersede its lack of live verification.

## Accepted workflow-alignment planning — October 20, 2026

Owner accepted all nine findings and native plan search/Agent Reach comparison
for later implementation. Runbook impact map covers §2.5A native search first,
selective upstream comparison, §2.10 shared resource settings, §2.14 onboarding,
§2.15 status reconciliation/delivery order, §2.17 research handoff, §2.19A role
workflow dispatch/worker parity/effective limits/data sharing and Group 3 in-app
spec/build/package/revision. These are plans, not implemented/activated features.
Official plan docs permit web search subject to model/account/workspace policy;
current app integration/qualification is missing. Agent Reach remains a candidate,
not an installed dependency or replacement provider. No spending, schedule or study
changes. Next eligible prompt: §2.15 current-status reconciliation, then explicitly
select a bounded dependency-complete implementation slice. Documentation checks
only; no runtime tests/live calls. Existing unrelated changes preserved.

## October 21 approved v3 plan qualification execution

Exact v3 candidate installed (manifest907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17).
Seven new gpt-6-astra requests completed. Research operational contract qualified
(2dev/4held); candidate first dev case failed exact novelty=null assertion despite
production-valid prose denying originality. No retry, scoring or later cases.
18 saved requests, zero active/unknown/leased/workflows. Settings/schema27 unchanged.
Full discovery unqualified/C54 partial; substantive independent review pending.
No native search/Agent Reach installation, metered fallback, credits activation,
workflow/build/pilot. Next eligible: prospective assertion-semantics audit. See
docs/DISCOVERY_V3_LIVE_RESULT.md; preserve all frozen grades and locks.

## Discovery follow-up preparation — October 22, 2026

Fresh12-case candidate/scoring operational packet and bounded runner prepared offline.
108 controls/14 tests pass; no provider calls or integration activation. Same v5
runtime/role1.3, external manifests. Independent acceptance, provider availability
and exact scoped execution decision remain pending. Research remains narrowly
operational-qualified; candidate/scoring are not promoted. docs/DISCOVERY_FOLLOWUP_V1.md.

## Separate discovery model review — October 22, 2026

Authorized fresh-context reviewer supported10 outputs/30 criteria and the bounded
follow-up runner; parent verified235 artifact hashes. Separate-model-review gate
satisfied, no human/live/activation promotion. Installed58 resources match; local
health ECONNREFUSED, current quota unobserved. Reset-to-unknown cannot satisfy fresh
available gate; availability action and exact execution decision remain unresolved.
No provider calls/settings change. docs/DISCOVERY_SEPARATE_REVIEW_2026-10-22.md.

## Availability recovery refused locally — October 22, 2026

Approved reset changed quota to unknown; one verify POST403 due already-verified
model. Grant unused/35 requests unchanged/no provider call, retry or activation.
Settings/credits and qualifications unchanged. Explicit versioned availability
recheck path needed; do not erase model access or bypass initial-verification guard.
docs/APPROVED_AVAILABILITY_CHECK_RESULT_2026-10-22.md.

## Explicit plan availability path live-verified — October 22, 2026

Intent-bound single-use availability_recheck API/UI and schema28 installed;29
checks/separate model review passed. One approved synthetic check completed, quota
available at04:43:24Z,credits off/caps unchanged. Original access/qualifications
preserved; no automatic suite. Helper final assertion recovered via SELECT/no retry.
Readiness remains task-specific/C54 partial. CLI supports initial verification only.
docs/AVAILABILITY_RECHECK_IMPLEMENTATION_2026-10-22.md.
