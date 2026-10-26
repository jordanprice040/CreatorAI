# Collector owner-attestations template — October 25, 2026

Status: blank preparation only. No owner value, attestation, approval or operational
grant has been supplied by this template. Do not infer an answer from an example,
default, historical installation path or fixture. Jordan may report unknown; unknown
remains a blocker, not an affirmative attestation.

For each blank below, Jordan would supply the requested nonsecret information,
its evidence/source locator, when that evidence was current (with timezone), and
any uncertainty. No credentials, config bodies, command lines, sign-in URLs/codes
or unrelated personal data belong here. These are requests for owner-supplied
evidence, not instructions or permission to inspect systems or launch anything.

## Pending owner inputs

### 1. Exact launch LOCALAPPDATA literal

Owner response and evidence: ________________________________________________

Supply the literal string provided to every intended desktop launch, preserving
case, separators and any trailing separator, with the basis for knowing those
launch paths use it. A resolved directory or historical plan path is insufficient.
The reviewed bounded derivation admits ASCII drive-rooted backslash-only spelling,
no dot/dotdot or empty interior segments, and at most one trailing backslash;
other or uncertain spellings require separate review, not normalization.

Supports: exact active-home and desktop mutex/show-event key binding for PR-01 and
SH-01. An unattested key makes an object lookup unavailable, even if not-found.
No root or key is derived or filled in by this template.

### 2. CREATOR_STUDIO_HOME and launch-path attestation

Owner response and evidence: ________________________________________________

Supply whether the override is unset in both user and machine environments and
not injected by any launch path, with the basis and any unresolved paths. Cover
Start-menu/desktop shortcuts, direct launches/scripts/terminals, HKCU/HKLM Run and
RunOnce, per-user/common Startup folders and scheduled tasks. This coverage list
does not authorize registry, environment or task inspection. Do not presume unset.
A present override requires a separately reviewed exact root/key scope.

Supports: active-home confirmation, correct cluster/lease/helper-object scope and
desktop-key admission. Unknown paths remain blocking.

### 3. Current database port

Owner response and evidence: ________________________________________________

Supply the exact current nonsecret port, its source and currentness. Do not use a
default or a historical receipt as a substitute for current supporting evidence.

Supports: the database listener target in the reviewed inspection scope. This
does not authorize a connection, SQL query or port observation.

### 4. Exact pg_bin directory

Owner response and evidence: ________________________________________________

Supply the exact absolute directory and evidence tying it to the intended managed
PostgreSQL installation. No PATH search or operational config read is authorized.
Owner-supplied intended location alone does not establish current runtime identity.

Supports: exact tool and process-image paths for PR-01/SH-01 scope preparation,
subject to independent validation and the later adapter's confinement checks.

### 5. pg_ctl.exe identity provenance

Owner response and evidence: ________________________________________________

Supply the exact executable path, SHA-256, version and source/provenance tying those
bytes to the allowed PostgreSQL 18 tooling. Supply an existing evidence locator and
its date; this template does not authorize hashing or executing an operational tool.

Supports: independent tool-identity review before any exact-cluster pg_ctl status
observation can be admitted. A status code alone is insufficient.

### 6. postgres.exe identity provenance

Owner response and evidence: ________________________________________________

Supply the exact executable path, SHA-256, version and source/provenance tying those
bytes to the intended managed PostgreSQL installation, with evidence currentness.

Supports: independent binding of the PostgreSQL process-image identity. A basename
alone does not establish ownership; ambiguous shared executable use still blocks.

### 7. Continuity since the historical shutdown

Owner response and evidence: ________________________________________________

Supply an operator-maintained timeline tied to the reviewed installation/after/stop
evidence, covering intervening launches (including quiet launches), Windows sign-ins,
override or installation/config changes, helpers, other users/sessions and other work
producers through the attestation time. State the basis for each interval, any gaps,
and whether other producers can act on this home. Include the A0 ordering: migration,
historical state observation, verification completion and stop before first launch,
and whether any launch occurred before successful after-verification. No launch is
requested here. Continuity must later extend through the first authorized launch.

Supports: A0 preservation/continuity and reconciliation of possible launch-at-login
activity, plus PR-01/SH-01 other-producer and launch-exclusion prerequisites. Current
Run-value absence or lack of a visible UI cannot prove past absence. Unknown
intervals block A0. This attestation is not fresh SQL quiescence, continuous
prevention, whole-database equality or proof of zero dispatch.

### 8. Selected existing workspace ID

Owner response and evidence: ________________________________________________

Supply the exact existing workspace ID and an evidence locator establishing the
selection and its currentness. A workspace name alone is insufficient. Creating a
workspace is a separate mutation and is not requested or authorized here.

Supports: binding the later scope manifest/session decision and workspace-specific
UI evidence. This is a session prerequisite, not an OS stopped-state measurement.

### 9. Current owner/editor role

Owner response and evidence: ________________________________________________

Supply the intended operator's current role in that exact workspace and supporting
evidence with currentness. Owner or editor is required by the frozen checklist;
viewer is insufficient. Do not supply credentials or initiate sign-in to fill this.

Supports: the later operator/workspace authorization check for the bounded UI
session. A role assertion does not itself grant an inspection or launch session.

## What remains separate

Completed responses would supply inputs for review, not satisfy every gate. A
schema/versioned inspection-scope manifest with exact bytes/hash and independent
review remains pending, as do collector implementation/review, a concrete
operational grant and the bounded session decision. None is created here. Current
installed identity and tool bindings still need the separately authorized checks.
Reader N1–N4 and classifier L1/L4 remain future work. R remains separately scoped;
H belongs to Jordan and remains unverified.

M3 remains unchanged: fresh identity of the exact reviewed scheduler-off bundle may
satisfy the narrow session's configuration gate; it is not live scheduler-state or
zero-dispatch evidence. Worker startup and continuity limits remain. No collector or
operational adapter exists. Native acceptance remains blocked; full C54 is partial.

## Repository sources and next eligible step

- `docs/THEME_INTENT_OBSERVATION_VERIFIER_L12_L13_REVIEW_2026-10-25.md`, remaining prerequisites and final template prompt.
- `docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2026-10-24.md`, binding sources, PR-01 and exact launch-path attestation.
- `docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md`, session decision, A0 and launch-effects boundary.
- `docs/THEME_INTENT_ACCEPTANCE_SCHEDULING_DECISION_2026-10-24.md`, retained M3 decision.

Next eligible prompt: review this blank template against those repository sources
for prerequisite coverage, evidence requirements and authority boundaries; preserve
all frozen source/evidence, read no operational value and fill no field. Report any
missing or misleading requirement without implementing a collector or granting a
session. Owner-supplied answers, if later provided, must be evaluated with their
uncertainty rather than treated as automatically verified facts.
