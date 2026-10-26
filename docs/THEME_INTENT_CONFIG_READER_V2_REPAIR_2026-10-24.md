# Config reader v2 repair and observation proposal v4 — October 24, 2026

Status: bounded fixture-only repair completed; independent exact review pending.
No operational adapter or PR-01/SH-01 inspector exists. No saved studio/config read,
credentials, registry/process/port/object inspection, launch or acceptance occurred.
The attached review matches the repository report SHA256 b4c619e8…bc0f4. Its findings
were assessed as evidence; the user's instruction authorized eligible repairs.
Frozen reader v1/tests/checklist v5/proposal v3/reviews/decisions/receipts are preserved.

## Repairs and finding disposition

F1: New scripts/theme-intent-config-reader-fixture-v2.mjs refuses link count other
than1 on pre-open lstat, open handle, post-read path stat and final handle stat.
The same bounded stable reader protects the marker as well as studio.json. Actual
Windows hard-link negatives cover each. BigInt stat identities/timestamps replace
Number comparisons. A fixture path is not proof of synthetic provenance; hard-link
rejection closes the demonstrated bypass but hostile same-user namespace races
remain outside this library's guarantee. projectConfig is pure and accepts caller
bytes: it inherits no path confinement and does not establish where bytes came from.

Windows ancestry checks additionally inspect System.IO.File.GetAttributes for the
ReparsePoint attribute, using a fixed system PowerShell command and stdin JSON
paths already confined to fixture ancestry. No path/code interpolation, profile or
visible window; timeout, errors and unexpected output refuse. Symlink/junction
checks still run. Tested actual Windows file/marker symlinks and junctions; arbitrary
non-symlink reparse tags were not manufactured, so that broad tag coverage rests
on attribute inspection, not executed examples of every tag. Host SystemRoot and
system PowerShell remain trusted. No new dependency or runtime integration.

F2: Proposal v4 binds the desktop key to the attested literal launch LOCALAPPDATA
string, not the plan path. It defines a constrained ASCII backslash-only input,
exact trailing-separator join and unavailable for unbound/unsupported input. Test
vectors distinguish d8c7860557013e56 (backslash root) from93553bda48f70dd2 (plan's
forward-slash spelling). These are computed string vectors, not observed current
native objects or independently reviewed Rust execution. The source formula and
Windows launch input must still be independently assessed; current attestation is
pending. Object absence never substitutes for process checks.

F3: UTF8 decoding now fails on malformed bytes. Projection is explicitly meaningful
only under equality to a natively accepted config's bound hash. JSON duplicate-key
and lexical-number/native-required-field parity are not claimed. An operational
adapter must pin native-accepted identity or introduce separately reviewed strict
parsing; arbitrary caller-computed hashes do not confer native provenance. Fixture
hashes establish only synthetic test binding.

F4: pg_bin is printable ASCII only; no second colon, invalid Windows filename
punctuation, empty segments, dot/dotdot segments or trailing space/dot. Tests cover
bidi override, DEL, ADS spelling and repeated/trailing separators. Returned pg_bin
is a proposed nonsecret value, not approved tool identity or authority to execute.

F5: BigInt identities and nanosecond times are tested with exact file IDs beyond
Number precision, link growth, changed identity, size/time and non-file snapshots.
These are deterministic metadata-guard tests, not an end-to-end concurrent attack
simulation. Pre/post checks cannot eliminate all same-user namespace races.

F6/F7: Proposal v4 folds S1–S4 into the table/body and explicitly supersedes old
proposal references for the next scope. It labels the newly introduced fixture
reader while retaining the operational-config-read prohibition. Launch attestation
names user/common Startup folders, HKCU/HKLM Run/RunOnce, scheduled tasks and
scripts/terminals/direct/shortcut launches. No wider inspection is granted.
Frozen checklist v5 is read alongside this new proposal; it is not silently edited.
The accepted scoped M3 exact-bundle evidence standard is unchanged.

## Executed checks

Windows12/12 pass (no skipped tests), final TAP:
tracking/evidence/theme-intent-config-reader-v2-2026-10-24/tests-final.tap.
Tests include unchanged valid fixture read, exact field redaction, blocked mismatch,
malformed/oversize/unsafe values, operational-looking/traversal root refusal before
I/O, actual junction/file-symlink/marker-symlink and config/marker hard-link refusal,
metadata snapshots, inert CLI and exact key vectors. Disposable roots removed only
after checking absolute parent/prefix. No personal or saved studio data involved.

Retained failures: sandbox initial8/11 (8pass/3fail),
with link creation EPERM plus a positive-control failure. Unrestricted attempt
10/11 isolated the positive-control test marker typo copied from v1; corrected
only test marker spelling. Final12/12 includes added key vector test. These are
not erased or converted into passes. Final source/TAP/doc hashes are in the new
repair receipt; old input preservation is checked without rerunning old writers.

## Next eligible independent review prompt

Run a separate uninvolved U02 review of reader v2, tests, this report, proposal v4,
frozen checklist v5, prior review, scoped M3 decision and the new check-only receipt.
Declare involvement. Rehash repository inputs and run only disposable fixture tests
if needed (Windows hard links/symlinks need an environment permitting creation).
Verify F1–F7 repairs, including no raw output, expected-hash provenance limits,
BigInt checks, PowerShell attribute-query scope/error redaction and exact root-key
spelling. Distinguish attribute logic from untested reparse tags and metadata-unit
checks from concurrent-race protection. Confirm fixture confinement is never
inherited by the pure projection API. Do not relabel vector checks as native passes.

No operational config/credential/OS-state read, launch, SQL, installer/helper,
activation, recovery, cleanup or retired checkout. Produce an exact-input report
and receipt with per-area verdicts and the smallest next eligible adapter scope.
Do not implement that adapter in the review. Operational adapter/read authority,
active home/continuity/workspace/current role, tool provenance and session scopes
remain pending. Full C54 partial; native acceptance/H unverified.
