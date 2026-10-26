# Owner-input inspection — October 26, 2026

Jordan explicitly requested inspection of items 1-6 and guidance for 7-9. This
supersedes the earlier preparation-only read boundary for the targeted inspection;
it does not waive the required operational-config adapter review or authorize app
launch, SQL, acceptance, work dispatch or state changes. This is preliminary owner
input evidence, not PR-01/SH-01 execution. No computer UI was operated: targeted
PowerShell reads and hashes were sufficient for the completed portion.

## Findings

1. Host process LOCALAPPDATA is C:\Users\jorda\AppData\Local. User/machine
persistent values were absent. The initial sandbox process had a sandbox-specific
LOCALAPPDATA and is explicitly unsuitable as a desktop launch value. Host result is
in host-environment.json. This does not prove every intended launch path's environment.
2. CREATOR_STUDIO_HOME absent in host process/user/machine settings. At
2026-10-26T04:10:11.5235099+00:00, read the exact user Start-menu Programs/Creator Agent.lnk:
it targets C:\Users\jorda\AppData\Local\Creator Agent\creator-desktop.exe,
with no arguments. Same-named common Start-menu, Public Desktop, user Startup and
common Startup shortcuts were not found. The exact value Creator Agent Studio in
HKCU/HKLM CurrentVersion Run and RunOnce was not found. No command text was emitted.
These are targeted current observations, not proof of no historical quiet launches,
all-path exclusion, or other-user/session absence. Arbitrary scripts, alternate
shortcut names, scheduled tasks and personal desktop shortcuts remain unchecked.
3. Database port not read or established. No operational studio.json was accessed.
4. Configured pg_bin not established. The source-listed candidate directory
C:\Program Files\PostgreSQL\18\bin exists and contains both target tools.
It must not be promoted to configured/active identity without evidence.
5. Candidate pg_ctl.exe SHA-256:
329daca106cab8f02abe15b3a2ea9d833c60f94995d57a54161c218a940f9193.
6. Candidate postgres.exe SHA-256:
8b8bf5d400487159e3e117053d3f5a89fad0c740b310a3ac69e5720ce4f818e1.
Both have file/product version 18.6 and company metadata PostgreSQL Global
Development Group. This is file metadata, not executed version output or verified
distribution authenticity. See environment-and-tool-candidates.json for paths,
lengths and observation time. Reparse attributes were checked on each target and
ancestry before hashing; this was not the full reviewed collector's race/identity
validation. Neither executable was run.

## Remaining requirements and guided owner answers

Proposal v4's binding-sources section says an operational adapter still needs
independent review and a concrete owner read grant. The latter has now been given
for items 1-6, but no reviewed operational adapter exists. The v2 reader review
requires confinement/native-accepted config identity and N1-N4 resolution. No
ad hoc operational config reader was substituted. Items 3-4 and configured binding
for 5-6 therefore remain pending, as does launch-path completeness for 1-2.

Item 7: Jordan supplies remembered launches (including possible quiet launches),
Windows sign-ins/restarts, config/install/helper activity and other-producer access
since the reviewed October 24 shutdown, explicitly marking unknown intervals.
Current Run-value absence cannot establish historical absence. No personal account
names are needed. The question has been sent; no answer is inferred.
Items 8-9: Jordan supplies the intended existing workspace ID (or name as context
with ID unknown) and last-known owner/editor/viewer role, with date/source. No
fresh sign-in is requested. Current identity/role is confirmed only at authorized
NI-01. The question has been sent; no answer is inferred.

Next: incorporate Jordan's answers with uncertainty preserved. Missing port/tool
configuration requires owner-supplied field evidence or a separately reviewed
field-limited adapter before an agent config read. No review or launch is implied.
Original blank template and prior evidence remain untouched. M3 unchanged;
collector absent, native acceptance blocked, H unverified and full C54 partial.
