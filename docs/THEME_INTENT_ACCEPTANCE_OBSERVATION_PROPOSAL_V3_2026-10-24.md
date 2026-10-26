# Theme-intent acceptance observation proposal v3 — October 24, 2026

Status: revised planning contract; no inspector implemented, independently reviewed
or operationally executed. No operational read/launch/sign-in/SQL/credential access
is authorized here. Preserve prior proposals, checklists and helper/package bytes.
Companion: THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md.

## Owner decision and claim boundary

Jordan explicitly selected “Accept exact-bundle configuration evidence for this
session” in this conversation on October 24. For this narrow UI-only theme-draft
session, fresh installed identity matching the reviewed bundle may satisfy the
scheduler-configuration gate. It is not observed live scheduler state, continuous
prevention or zero-dispatch proof. Worker-on and continuity limits remain. No
change to study protocols, general policy, runtime configuration or future session
standards is implied. No acceptance-session or operational inspection grant follows.

The exact bundle SHA-256 is
9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88,
bound in the package review's artifact map at
.verification/theme-intent-artifacts-2026-10-23/studio/service/app/dist/studio.mjs.
The installed counterpart is studio/service/app/dist/studio.mjs beneath the exact
installation root. Static analysis must confirm the literal createApi environment
has no scheduler override and its fallback is off; compare the installed file hash
to these reviewed bytes. No execution/import of bundle or health read is needed.
The bundle's worker default remains on. A mismatch/unavailable result blocks.

## Binding sources and required scope manifest (M4)

Use a new owner-supplied, explicitly approved nonsecret inspection-scope manifest;
its schema/version, exact bytes/hash and separate review must bind every concrete
field before implementation/execution. Do not infer values from defaults or read
studio.json/credentials to fill blanks. This is a contract, not an existing scope.

| Field                           | Named source and validation                                                                                                                                                       | Actual readiness                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate and installation plan | Existing exact reviewed package and installation receipts                                                                                                                         | Historical identities available                                                                                                                                                      |
| Installation root               | installation-plan.json target_install_dir; installed native/manifest/runtime map from actual completion                                                                           | Historical binding; current rehash pending                                                                                                                                           |
| Studio home                     | tracking/evidence/theme-intent-package-2026-10-23/installation-plan.json studio_home                                                                                              | Historical intended root available; Jordan must attest this is still the active root and disclose override/uncertainty                                                               |
| Cluster directory               | approved studio home plus literal postgres/data, matching reviewed home.rs and operational layout evidence                                                                        | Derived only after active-home confirmation                                                                                                                                          |
| Database port                   | Jordan supplies exact current nonsecret port in scope manifest, with stated basis and currentness                                                                                 | PENDING; no receipt/default is substituted                                                                                                                                           |
| pg_bin and pg_ctl path/hash     | Jordan supplies exact absolute pg_bin and approved pg_ctl.exe hash/version provenance; independent reviewer validates proposed binding against allowed PostgreSQL18 tool identity | PENDING; no PATH search or config read                                                                                                                                               |
| PostgreSQL process images       | exact approved pg_bin/postgres.exe and pg_ctl.exe with independently reviewed file identities                                                                                     | PENDING with pg_bin                                                                                                                                                                  |
| Desktop image                   | exact installation root/native executable and historical installed hash                                                                                                           | Historical binding; current rehash pending                                                                                                                                           |
| Service image/entry             | exact bundled node image plus studio/service/app/dist/studio.mjs entry, with reviewed resource hashes                                                                             | Bind complete per-file allowlist from reviewed bundle manifest SHA256 5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6; installation completion records only count71 |
| Studio ports                    | API4310, web5173, preview4320 from reviewed apps/api/src/studio.ts constants                                                                                                      | Static binding; check all local listeners on these ports, including unexpected interfaces                                                                                            |
| Lease identities                | approved studio home/theme-intent-v2.lock, -v3.lock, -v4.lock                                                                                                                     | Derived from all three reviewed helper versions                                                                                                                                      |
| Mutex identities                | Local\CreatorAgentUpgradeV3- and Local\CreatorAgentUpgradeV4- plus sha256(resolve(home).toLowerCase()) using exact helper algorithm                                               | Derive only from approved home; v2 has no named helper mutex found                                                                                                                   |
| Launch at login                 | HKCU\Software\Microsoft\Windows\CurrentVersion\Run, single value Creator Agent Studio                                                                                             | Exact source: winsys.rs RUN_KEY/RUN_VALUE; current presence unknown                                                                                                                  |

Claude M4's broad statement that no repository receipt names a home root is too
strong: installation-plan.json names studio_home. That records intended identity,
not proof of current active-home selection. Database port/pg_bin remain missing.
Owner-supplied values identify intended targets; they do not by themselves prove
current runtime configuration. Reviewer must reject a stale/unsubstantiated binding.
If Jordan cannot supply these fields without opening protected configuration,
leave blocked; a field-limited reader would need its own separately selected,
reviewed access scope. Such a reader is not introduced here.

## PR-01: proposed bounded prelaunch read

After implementation/review and a concrete operational scope, hash only exact
installed native/manifest/reviewed runtime resource allowlist; read exact cluster
PG_VERSION and execute only the hash-bound pg_ctl status -D <exact cluster> command.
No database connection, SQL, DPAPI, secret loading, config read, log dump or launch.
Reject reparse points in targets/ancestry, missing tools, mismatched identities,
unsupported cluster/version, inaccessible data or ambiguous ownership. Status3 is
stopped only with valid exact tooling/cluster; other errors are unavailable.

Check all scoped ports and exact desktop/bundled node/managed PostgreSQL process
images. Compare service entry/cluster command-line identity privately in memory
only if needed; emit no command text, environment or unrelated process list.
Ambiguous shared executable use is blocking, not an absent-process result.

Check all v2–v4 lease files without reading their contents. Query existence of the
exact V3/V4 mutex objects without acquiring/creating/releasing them; permission or
namespace ambiguity is unavailable. Local namespace observations cover only the
current Windows session: require owner attestation that no other user/session or
helper/work producer can act on this home. This is not a machine-wide exclusion.
Unexpected additional theme-intent lease names in the exact home may be reported
as a blocking boolean; no recursive enumeration or cleanup.

Read only existence of the single named current-user Run value; no value command
text, broad registry enumeration or settings write. Access denied is unavailable,
not absent. If present, reconcile every Windows sign-in since historical shutdown
as a possible quiet launch. Current absence cannot establish past absence. Record
operator attestation of all intervening use, sign-ins, overrides, other producers
and changes; unknown intervals still block A0. Do not infer continuity from no UI.

Emit hashes, timestamps, exact-scoped counts, existence booleans, coded errors and
availability; omit config bodies/paths beyond approved scope identity, usernames,
credentials, cookies, URLs/codes, full OS responses and command lines. Two complete
samples at least 1 second apart within 15 seconds; changed, positive, unavailable
or contradictory stopped-state results block. Write only a new exclusive session
evidence directory. No automatic repeat, process termination, service stop or
mutation. PR-01 establishes point-in-time identity/stopped observations and labeled
attestation, not current SQL quiescence, whole-database equality or all-producer absence.

## SH-01: proposed observation after explicit Quit

Planned Quit requires recorded running state. Closing either window is not this
step. The control hides while running and otherwise Quits; the studio backgrounds
or Quits according to saved preference. Unplanned Quit/startup interruption is an
incident; stop the test sequence and obtain reconciliation before another launch.

Observe exact cluster, all scoped processes/listeners and all versioned leases/
mutexes using PR-01's reviewed bindings and unavailable semantics. Allow up to 90
seconds from Quit request, at most one sample per second; require two complete
stopped samples at least 1 second apart. Each requires valid pg_ctl status3 and no
scoped listener/process/lease/mutex. Native 20-second child and 60-second database
grace periods are context, not proof. Do not rerun Quit, kill, recover or extend
the deadline to pass. No file rehash unless identity changed/became uncertain.

Timeout, contradiction or inaccessible observation is unknown/blocked; app exit or
exit0 never substitutes. Shutdown can finish later. A later non-mutating SH-01
re-observation may establish a later stopped state only under a new exact scoped
decision, directory and bounded window; preserve the initial failure/unknown. It
does not retroactively pass the original case or grant a new launch. Independent
review must assess the remaining incident and whether session resumption is safe.
A restart invalidates prior stopped evidence. Final unknown means no passing
acceptance or normal-use handoff.

## Disposition and next review

M3 is resolved as a scoped owner evidentiary choice, not runtime verification.
M4 has named sources and an explicit manifest contract; actual port/tool/current
home attestations remain pending. M5 and L1–L5 are incorporated. L6 is addressed
by a new check-only verifier; frozen old verifiers must not be rerun to rewrite
history. No startup-admission implementation is selected under this owner choice.
If continuous prevention is later required, reopen that distinct changed-candidate
implementation/review/install path; do not relabel this evidence as prevention.

Next: obtain missing nonsecret scope bindings, then a separate uninvolved exact
review of checklist v5/proposal v3/owner decision and check-only receipt. Assess
per-gate claims and implementation readiness without operational reads. Do not
implement or execute the inspector under these planning documents. Existing
workspace/current owner-editor and bounded local session decisions remain pending;
A v1–2/B v1 retention, separate R and Jordan-only H remain unchanged. Full C54 partial.

## Exact-v4 review implementation constraints (S1–S4)

S1: The active-home attestation names CREATOR_STUDIO_HOME explicitly. Jordan must
confirm it is unset in both user and machine environment and not injected by any
launch path (Start menu, desktop shortcut or Run entry), and that LOCALAPPDATA
resolves to the parent of the plan home. If an override is present, uncertain or
launch-path coverage incomplete, leave pending; do not inspect an inactive tree
and call the studio stopped. An alternative overridden home needs a new exact
reviewed scope. This remains attestation, not an observed environment claim.

S2: Also inspect the desktop single-instance mutex
Local\CreatorAgentStudio-<key16> and show event
Local\CreatorAgentStudioShow-<key16>. key16 is the first16 lowercase hex digits of
SHA256(UTF8(root.to_string_lossy().to_lowercase())), exactly as home.rs::key.
Unlike helper names, there is no resolve() step. Preserve the exact root spelling
used by the native launch; case folding/Unicode behavior must match Rust or fail
unavailable. Show is an EVENT (winsys.rs CreateEventW), not a mutex. OpenMutexW
with SYNCHRONIZE for mutexes, OpenEventW with SYNCHRONIZE for this event; close
handles immediately. Never Create/Wait/Acquire/Release/SetEvent/ResetEvent. Open-only
not-found is absent, access-denied and other errors unavailable. Local namespace
limits and cross-session attestations remain. Do not copy helper Mutex constructors.

S3: Query the exact Run value’s existence without a registry-type restriction.
Only ERROR_FILE_NOT_FOUND maps to absent; any value type maps to present; all
other errors are unavailable. Do not copy launch_at_login_present’s REG_SZ-only
boolean semantics. No data/command text output or registry changes.

S4: The complete runtime allowlist comes from the reviewed bundle manifest
SHA256 5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6.
It includes node/node.exe and service/app/dist/studio.mjs; historical install
verified all71 files. The completion receipt’s count71 is not a per-file map.

The next bounded implementation must exercise these contracts only against
disposable fixtures/injected OS observations until separately independently
reviewed and operationally scoped. Negative checks must cover wrong active home,
reparse paths, mismatches, denied/unavailable queries, wrong-type Run value,
namespace ambiguity, event/mutex distinction, timeout, exclusive evidence paths
and preservation of unknown outcomes. No operational fallback or studio.json read
is introduced. L-A/L-D/L-G are corrected in checklist v5; L-F requires explicit
excluded path + historical-hash entries in the new check-only revision receipt.
