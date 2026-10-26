# Theme-intent acceptance observation proposal v4 — October 24, 2026

Status: revised planning contract; no inspector implemented, independently reviewed
or operationally executed. No operational read/launch/sign-in/SQL/credential access
is authorized here. Preserve prior proposals, checklists and helper/package bytes.
Read with frozen THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md.
For the next implementation scope, this proposal v4 supersedes proposal v3's
binding/observation text. The frozen checklist's proposal-v2/proposal-v3 references
are historical; this is the current contract. No native observation is executable.

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

| Field                           | Named source and validation                                                                                                                                                       | Actual readiness                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate and installation plan | Existing exact reviewed package and installation receipts                                                                                                                         | Historical identities available                                                                                                                                                                                 |
| Installation root               | installation-plan.json target_install_dir; installed native/manifest/runtime map from actual completion                                                                           | Historical binding; current rehash pending                                                                                                                                                                      |
| Studio home                     | tracking/evidence/theme-intent-package-2026-10-23/installation-plan.json studio_home                                                                                              | Historical intended root available; Jordan must attest exact launch LOCALAPPDATA string, CREATOR_STUDIO_HOME unset at user/machine and all launch paths, per the exact-key section below; unknown stays pending |
| Cluster directory               | approved studio home plus literal postgres/data, matching reviewed home.rs and operational layout evidence                                                                        | Derived only after active-home confirmation                                                                                                                                                                     |
| Database port                   | Jordan supplies exact current nonsecret port in scope manifest, with stated basis and currentness                                                                                 | PENDING; no receipt/default is substituted                                                                                                                                                                      |
| pg_bin and pg_ctl path/hash     | Jordan supplies exact absolute pg_bin and approved pg_ctl.exe hash/version provenance; independent reviewer validates proposed binding against allowed PostgreSQL18 tool identity | PENDING; no PATH search or config read                                                                                                                                                                          |
| PostgreSQL process images       | exact approved pg_bin/postgres.exe and pg_ctl.exe with independently reviewed file identities                                                                                     | PENDING with pg_bin                                                                                                                                                                                             |
| Desktop image                   | exact installation root/native executable and historical installed hash                                                                                                           | Historical binding; current rehash pending                                                                                                                                                                      |
| Service image/entry             | exact bundled node image plus studio/service/app/dist/studio.mjs entry, with reviewed resource hashes                                                                             | Bind complete per-file allowlist from reviewed bundle manifest SHA256 5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6; installation completion records only count71                            |
| Studio ports                    | API4310, web5173, preview4320 from reviewed apps/api/src/studio.ts constants                                                                                                      | Static binding; check all local listeners on these ports, including unexpected interfaces                                                                                                                       |
| Lease identities                | approved studio home/theme-intent-v2.lock, -v3.lock, -v4.lock                                                                                                                     | Derived from all three reviewed helper versions                                                                                                                                                                 |
| Mutex identities                | Local\CreatorAgentUpgradeV3- and Local\CreatorAgentUpgradeV4- plus sha256(resolve(home).toLowerCase()) using exact helper algorithm                                               | Derive only from approved home; v2 has no named helper mutex found                                                                                                                                              |
| Desktop object key              | Exact attested launch LOCALAPPDATA string joined with literal backslash com.creatoragent.studio; never derive from plan forward-slash spelling                                    | PENDING exact attestation; unknown key means unavailable                                                                                                                                                        |
| Desktop objects                 | Local\CreatorAgentStudio-<key16> mutex and Local\CreatorAgentStudioShow-<key16> EVENT                                                                                             | Derivation and open-only semantics below                                                                                                                                                                        |
| Launch at login                 | HKCU\Software\Microsoft\Windows\CurrentVersion\Run, single value Creator Agent Studio                                                                                             | Exact source: winsys.rs RUN_KEY/RUN_VALUE; current presence unknown                                                                                                                                             |

Claude M4's broad statement that no repository receipt names a home root is too
strong: installation-plan.json names studio_home. That records intended identity,
not proof of current active-home selection. Database port/pg_bin remain missing.
Owner-supplied values identify intended targets; they do not by themselves prove
current runtime configuration. Reviewer must reject a stale/unsubstantiated binding.
Jordan selected preparation of a field-limited reader for separate review.
The new scripts/theme-intent-config-reader-fixture-v2.mjs is fixture-only; no
operational adapter exists. If owner-supplied values remain unavailable, a future
exact-path field-limited operational adapter still needs independent review and
a concrete owner read grant. This proposal does not permit reading studio.json.

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

Check all v2–v4 lease files without reading their contents. Query the exact
V3/V4 helper mutexes, desktop mutex and desktop show EVENT using only open-existing
calls. For mutexes use OpenMutexW(SYNCHRONIZE); for the show event use
OpenEventW(SYNCHRONIZE). Close handles immediately. Never create/acquire/wait/
release/set/reset objects or reuse helper constructors. Not-found means absent
only with a bound exact key; denied, wrong-type/invalid-handle and all other errors
are unavailable. Local namespace observations cover only the
current Windows session: require owner attestation that no other user/session or
helper/work producer can act on this home. This is not a machine-wide exclusion.
Unexpected additional theme-intent lease names in the exact home may be reported
as a blocking boolean; no recursive enumeration or cleanup.

Read only existence of the single named current-user Run value without any
registry-type restriction. Only ERROR_FILE_NOT_FOUND means absent; a value of any
type means present; access denied and every other error mean unavailable. Never
copy the application's REG_SZ-only boolean semantics. No value command text,
broad registry enumeration or settings write. If present, reconcile every Windows sign-in since historical shutdown
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
review of the new reader v2/tests/proposal v4/owner decision and check-only receipt. Assess
per-gate claims and implementation readiness without operational reads. Do not
implement or execute the inspector under these planning documents. Existing
workspace/current owner-editor and bounded local session decisions remain pending;
A v1–2/B v1 retention, separate R and Jordan-only H remain unchanged. Full C54 partial.

## Exact desktop key input and launch-path attestation (F2/F7)

Before any desktop-object absence can be used, Jordan attests the exact string
LOCALAPPDATA supplied to every intended desktop launch. Record its literal spelling
as a nonsecret scope field launch_localappdata_exact, not merely a resolved directory.
For this bounded contract require an ASCII drive-rooted backslash-only spelling,
no dot/dotdot or empty interior segments, and at most one trailing backslash.
Different/non-ASCII/forward-slash/uncertain input is unavailable pending separately
reviewed Rust-equivalent derivation; do not normalize it opportunistically.

CREATOR_STUDIO_HOME must be attested unset in user and machine environments and
not injected by any launch path. Include Start-menu/desktop shortcuts, direct
launches/scripts/terminals, HKCU and HKLM Run and RunOnce, per-user and common Startup
folders and scheduled tasks. This is attestation scope, not permission for broad
registry/task/environment inspection. Unknown paths or intervening Windows sign-ins
still block continuity. A present override requires a separately reviewed exact
root/key scope rather than silently using the plan root.

For the admitted spelling, emulate PathBuf::join by appending one backslash only
if the attested string lacks its single trailing backslash, then append the literal
com.creatoragent.studio. Preserve case and spelling until root.to_lowercase();
SHA256 its UTF8 bytes and take first16 lowercase hex. Never path.resolve, replace
slashes or derive this input from installation-plan.json studio_home. Both the
literal LOCALAPPDATA input and resulting literal root/key belong in the reviewed
scope; if unattested, object lookup result is unavailable even if OS says not-found.

Illustrative vectors, computed from strings only (not current environment):

| Exact LOCALAPPDATA            | Exact joined root                                    | Expected key16   |
| ----------------------------- | ---------------------------------------------------- | ---------------- |
| C:\Users\jorda\AppData\Local  | C:\Users\jorda\AppData\Local\com.creatoragent.studio | d8c7860557013e56 |
| C:\Users\jorda\AppData\Local\ | C:\Users\jorda\AppData\Local\com.creatoragent.studio | d8c7860557013e56 |

The plan's forward-slash root yields93553bda48f70dd2 instead and is NOT an
alternative desktop-object key for that attested backslash launch. Tests compute
both values and assert inequality. These vectors await independent review, not
observed native execution. Probe launches can omit objects, so absence is never
sufficient without separate process-image/other stopped-state checks.

S1–S4 are folded into the table and PR-01 body here; there is no contradictory
appendix fallback. The manifest5b38b43e per-file map, not count71, is authoritative.
Reader-v2 fixture tests are not PR-01/SH-01 implementation or operational evidence.
The accepted M3 decision remains unchanged. Native acceptance and H stay unverified.
