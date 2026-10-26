# Field-limited configuration reader preparation — October 24, 2026

Status: fixture-only reader implemented; independent exact review pending. Jordan
selected “Prepare a field-limited reader for separate review” in this conversation.
That choice does not authorize saved studio/configuration reads or acceptance.
The fixture library cannot read an operational path; no operational CLI exists.
PR-01/SH-01 OS inspector is not implemented by this task.

## What changed

scripts/theme-intent-config-reader-fixture.mjs projects only database.mode,
database.port, pg_bin and config_hash_matches, with visible fixture:true and an
explicit not-operationally-verified status. It reads only a marked direct synthetic
fixture directory below repository .verification/theme-config-reader-*. It does
not discover config paths, read studio.json outside that fixture, read environment,
query SQL, execute tools, launch the studio, fetch credentials, inspect registry/
mutexes/processes or establish workspace membership. Direct invocation exits2
without reading a config or echoing arguments.

Expected hash must be supplied; mismatch emits blocked with no projected fields.
Bytes are bounded32KiB; malformed/unknown-field/unsupported-mode/port/path errors
are redacted. Ancestry links are refused; before/open/after file identity/size/time
checks reject observed replacement/change. Original fixture bytes remain unchanged.
This is not protection against a malicious same-user concurrent namespace attacker;
a future operational reader needs its own reviewed path/authorization/concurrency
contract. Field projection is not validation of tool identity or active launch home.
Only managed mode is supported; other modes refuse, never fall back.

Historical comparison target from repository run-01 before/after:
fedcbce7bbcd8d1586008ae14de5a37d2407d5ef9082c3b3014f3e0a07060dbe.
Fixture tests compare their synthetic hashes, never read that operational config.
Unknown fields are rejected rather than returned. No raw config/hash/error payload
is emitted. pg_bin is a nonsecret proposed path, not an approved executable.

## Checklist/contract fixes

New checklist v5 and proposal v3 preserve frozen v4/proposal v2. They incorporate
S1 active-home CREATOR_STUDIO_HOME/LOCALAPPDATA attestation, S2 exact desktop
mutex/show-event identities, S3 open-only objects and type-agnostic Run existence,
S4 exact manifest allowlist source, and L-A/L-D/L-F/L-G clarifications. The show
object is an event, requiring OpenEventW rather than OpenMutexW; neither call is
implemented/executed here. Historical quiescence plus continuity is not refreshed
by PR-01. The accepted M3 choice is unchanged.

## Executed checks and limits

Focused tests cover redacted projection, mismatch without fields, malformed/large/
unsupported inputs, operational/traversal root rejection before read, unchanged
fixture bytes, missing marker, actual Windows junction rejection and inert CLI.
Initial sandbox run passed5/failed1: junction creation EPERM before reader execution.
Authorized isolated rerun passed6/6. Final evidence binds actual test output and
source hashes. No live or native acceptance tests were performed.

## Next eligible review prompt

In a separate uninvolved U02 session, review checklist v5/proposal v3, this report,
fixture reader/tests and exact receipt. Declare involvement. Rehash inputs without
operational access; run only disposable fixture tests if needed. Preserve earlier
receipts; use the new revision verifier in check-only mode. Assess field projection,
redaction on failure, root/ancestry/size/file-change guards, mismatch behavior and
absence of any operational entry point. Check S1–S4 and L-A–L-G against actual Rust
source, including event versus mutex and exact root-string key derivation. Treat
same-user race protection and all unexecuted OS contracts as limits, not passes.
Report whether this fixture-only reader is supported for a separately scoped future
operational adapter; do not claim an operational reader or PR-01/SH-01 exists.

No config read, inspector implementation/activation, launch/sign-in or acceptance
session in that review. Before operational use, a separately selected/reviewed
adapter must bind exact config path/hash, active-home attestation, approved output
and evidence destination, and a concrete owner read grant. Workspace/current role,
continuity, tool identity and eventual PR-01/SH-01/session scope remain unresolved.
Full C54 partial. Do not require Jordan to repeat the accepted M3 decision.
