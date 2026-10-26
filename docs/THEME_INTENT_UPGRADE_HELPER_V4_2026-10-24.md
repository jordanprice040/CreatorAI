# Theme-intent helper v4: native PostgreSQL layout repair

Prepared October 24, 2026. Canonical checkout: C:\dev\creator_agent.

## Why v3 support did not establish operational compatibility

The separately authorized operational before attempt operational-before-20261024-01
failed before starting PostgreSQL: v3 expected postgres/PG_VERSION. Desktop
Home::pg_data in apps/desktop/src-tauri/src/home.rs:121 uses postgres/data.
The synthetic v3 fixture repeated the wrong layout. The v3 supported review and
passing tests remain historical evidence for their exact bytes, not proof that the
helper can operate on the native studio. The attempt decrypted the credential but
created no backup/prepared receipt and started no database. See
tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json.

## Bounded change

V4 is a separate candidate; v1/v2/v3, package and plan remain unchanged. New files
are scripts/theme-intent-upgrade-v4{,-core}.mjs, the upgrade/install/recover v4 PS
wrappers, v4 mutex guard and source-bound test runner, with v4 fixture/tests.

Core dataPath(home) mirrors Home::pg_data exactly: home/postgres/data. All normal
pg_ctl commands, ownership-tag inspection, stale decision data_dir validation and
stale release use that nested path. Coordinated recovery starts the same managed
cluster and restores into a new empty database there; it does not relocate or
reinitialize PGDATA. No flat-layout fallback, discovery search or automatic movement
of existing data is permitted.

verifyDataLayout checks the nested directory, rejects links in its ancestry and
PG_VERSION, and requires PostgreSQL 18. The CLI runs it after the exact package and
independent review gates, before the wrapper can read/decrypt DPAPI. Managed and
stale-release paths repeat the check before using the directory. Cleanup-only
release still needs no prepared backup or credential; the existing cluster layout
must be present and valid. Missing/corrupt layout requires investigation, not
unverified cleanup.

Helper authority/receipt/test formats use /4, backup prefix and lease use v4, and
mutex uses V4. Never mix versioned evidence or use v4 to retire a v3 lease. The
failed operational v3 attempt left no lease. V4 requires a fresh supported exact
independent-review/4 receipt and complete runtime hashes. Implementation never
manufactures operational support or installation approval.

Candidate: 7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc

Installation plan: 27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1

## Verification

The guarded disposable fixture uses PostgreSQL18 on 127.0.0.1:55455, synthetic
SCRAM and CurrentUser DPAPI, populated schema28, real frozen migration code and
explicit fixture installer copies. It initializes home/postgres/data independently
of the helper dataPath function. A source-contract guard checks desktop Home::pg_data
and demonstrates that v3 rejects this native-shaped layout before any PG command.
Additional guards reject flat-only, wrong-version and junction clusters.

A real-wrapper test hides the nested data directory and synthetic DPAPI blob,
leaves a valid flat version marker and invokes before. It must fail pre-secret,
create no evidence/lease and start no listener. The rest of the suite exercises
preparation, early/partial deaths, exact nested ownership and stale release,
forward schema29 verification, preserved business rows, and coordinated schema28
recovery using the nested cluster. Run receipts bind source hashes before/after,
TAP digests, exit code and timeout. Actual results are in the repair receipt once
execution finishes; this document alone is not a test result.

## Limits and next gate

No operational studio configuration, credential, database or private backup is
accessed for this repair. No real NSIS, providers, workflows, installed app or
retired checkout is used. Fixture migrations/recovery do not establish native
installer, registry, shortcut or UI acceptance. /NS skips shortcut creation.

V3 review low findings remain deferred: stale resume-phase whitelist, migrate
continuation confirmation ceremony, session/path-spelling-sensitive mutex, and
missing migration-result handling. Exact bound owner authority remains required;
no new continuation policy or acceptance exception is introduced in this repair.
System tools remain trusted host prerequisites. Desktop/workers must remain fully
quit outside the helper mutex. Admission is limited to the existing 15minute
freshness window, which still requires operational-scale verification.

Next U02: independently review exact v4 source, receipts and actual native-layout
coverage. Operational before remains blocked pending that review; a later retry
needs a new session/directory and verified current authority. No installation or
migration approval follows. No fresh operational backup exists from the failed
v3 attempt. Full C54 remains partial.

## Retained development failures

The first bound full run passed 23 of 26 TAP tests and failed two scenarios plus
the parent. The new pre-secret layout test initially lacked studio.json, so it
failed at configuration loading before reaching the intended gate. Only the test
setup was corrected; its assertions remain. The final interrupted-protected-recovery
scenario hit EPERM renaming the fixture program directory immediately after
predecessor copy. A later exact-directory rename/back probe succeeded. The
transient refusal's cause is unconfirmed; no antivirus or handle attribution is
claimed, no production retry was added, and recovery acceptance was not relaxed.
The first TAP/run maps and failure analysis remain. A new labeled verified run
uses the corrected test and is the acceptance candidate only if it passes.

## Executed result and self-review

The verified source-bound run passed 26/26 TAP tests (25 end-to-end scenarios plus
the parent) and 11/11 guards, zero failed/skipped/cancelled tests, in about 9.3
minutes for end-to-end execution. Both run receipts report unchanged sources and
exit 0. The interrupted protected-file recovery that previously hit EPERM passed
without changing production code, retrying its failed effect, or weakening a gate.
The transient refusal remains retained evidence and an independent-review focus;
its root cause is not established. No broader Windows handle-recovery claim follows.

The new wrapper regression passed with a real synthetic config, missing nested
cluster and unavailable DPAPI blob. The nested layout succeeds throughout real
fixture before/install/migrate/after/reconcile/release/recover composition. Managed
normal cleanup and stale ownership validation both inspect the nested cluster.
All 161 v3 and 162 v2 repair-artifact hashes remain unchanged. Static frozen-package
preflight, five PowerShell parses, targeted formatting and JavaScript syntax pass.
The fixture summary reports listening_after:false.

Implementation-involved review found no additional blocker in the normalized
layout diff; this is not independent support or native acceptance. The deferred
v3 low findings and host/native limits above remain. Next eligible prompt:
Independently review the exact v4 native-layout repair and repair receipt under
U02; verify real desktop layout fidelity and retained failure evidence, using only
disposable fixtures. Do not run operational preparation or install/migrate.
