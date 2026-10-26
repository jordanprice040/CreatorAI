# Theme-intent upgrade helper v2 repair — October 23, 2026

This separate helper revision addresses the blocked independent review of v1.
The original four helpers, original tests, malformed original implementation
receipt, package, plans and review evidence remain historical artifacts. Do not
use v1 for operational preparation. This document is implementation preparation,
not a supported independent review or owner installation/recovery approval.
Full C54 remains partial.

The exact package candidate remains
`7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`;
the frozen installation plan remains
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.

## Revised executable boundary

New files are `theme-intent-upgrade-v2-core.mjs`,
`theme-intent-upgrade-v2.mjs`, `upgrade-theme-intent-v2.ps1`,
`install-theme-intent-v2.ps1`, and `recover-theme-intent-v2.ps1` under `scripts/`.
The PowerShell wrapper transports nonsecret parameters through a temporary UTF8
JSON request, so Windows PowerShell5 argument dropping/quoting does not select a
different phase. Password transport is UTF8 stdin and DPAPI remains CurrentUser
with the existing PostgreSQL entropy. No operational credentials were read during
implementation/testing. The pinned Windows libpq path is restricted to ASCII
managed passwords, matching desktop-generated hexadecimal credentials; non-ASCII
credentials fail explicitly rather than falling back to another credential.

All phases—including `before`—require an independent v2 helper receipt before
reading operational configuration or decrypting credentials. The helper imports
only Node built-ins and its reviewed local core before that gate. It computes
hashes for the helper files, the standalone migration module and the installed
`pg` dependency closure without executing those dependencies. Only after the
receipt matches does it dynamically load migration code and pg. Native pg override
via `NODE_PG_FORCE_NATIVE` is refused. `--bindings` emits the review map;
`--check` verifies the frozen candidate/package/plan without operational access.
There is no domain-package import in this secret-holding process.

Operational review format is `theme-intent-upgrade-independent-review/2`, status
`supported_exact_helper`, with `prior_implementation_involvement:false`, exact
candidate/plan identities and `helper_sha256` matching `--bindings`. A simulated
fixture-only receipt has a different format/status and cannot satisfy that
operational gate. No supported operational v2 review receipt is created by the
implementation session.

## Lifecycle, backup and admission

The desktop and studio workers must be quit. Each phase takes a global exclusive
lock in the selected studio home, checks the exact managed data directory with
`pg_ctl status`, refuses an already-running/uncertain cluster or foreign port
listener, and starts its own PostgreSQL18 cluster using the desktop's loopback
options. It records ownership and stops the cluster in `finally`, recording the
stop. PostgreSQL18 tools are the configured local installation; the helper does
not initialize an operational cluster or silently adopt an external server.

Sensitive bytes go only under
`<studio_home>/backups/theme-intent-v2-<session-id>/`: custom database archive,
products, complete predecessor program, `studio.json`, `secrets`, and
`plan-credentials`. Tracked evidence contains hashes/ledger metadata and action
receipts, not credential copies or database contents. Resolved ancestors and trees
must not be links/junctions. Sensitive destinations must be outside the tracked
repository (the ignored `.verification` subtree is allowed for fixtures), outside
the install/protected source trees and outside the products source tree.
Both evidence and sensitive backup destinations must be new. Reusing a session ID
with a different evidence directory cannot overwrite an earlier dump.

`before` obtains one dedicated PostgreSQL client and one repeatable-read read-only
transaction for both the preservation baseline and the exported pg_dump snapshot.
The client remains checked out until dump/TOC validation completes. It fingerprints
all public tables with populated records preserved, exact migration names/checksums,
config, protected files and products. A second observation must match. Quiescence
also covers running plan qualifications; connection checks count client backends,
not autovacuum. Unknown/active work remains a blocker.

The backup format is explicitly `theme-intent-upgrade-backup/2`, not
`creator-backup/1`. It uses supported pg_dump/pg_restore tools but is not input to
the current portable Restore Studio API. Do not relabel it.

`install` resolves and hashes the installer relative to the script's repository,
regardless of the caller's working directory, before consuming admission. It
rechecks source state, full current-program/rollback parity and backup hashes/TOC.
Only admission checks the 15minute freshness of preparation, backup and owner
approval. A new exact `theme-intent-owner-install-approval/2` binds the prepared
receipt hash, candidate/plan, actual owner decision, `fixture:false`, timestamp and
`install_and_migrate_28_to_29:true`. Earlier approvals are not inherited.
Standalone admission is reusable only with the same fresh decision and before any
installer intent exists. Once an installer intent exists, no install retry is
admitted through this route.

Migration binds to the durable admission and installer outcome rather than
reapplying the admission expiration. The outcome binds the admission hash and must
follow its timestamp. An intent is recorded before each external effect. Migration
uses the exact installed candidate's supported backup-first command, accepts only
from28/to29/applied[29], and verifies the command's backup. Child execution has a
bounded timeout and process-tree termination, retained exit/timeout state, stderr
redaction and output hash. Malformed output or uncertainty blocks retries.

`after` is repeatable read-only verification with new uniquely named receipts.
It does not expire because installation or migration took longer than 15minutes.
It still verifies exact review/prepared/admission/migration bindings, backup hashes,
schema29, prior ledger and record/config/product/program preservation. It leaves
installed UI acceptance false. Perform it before login/UI tests mutate records.

## Failure, reconciliation and coordinated recovery

No partially executed installer or migration is automatically repeated. The
`reconcile` phase inspects actual schema28/29, current program identity and preserved
state and writes a new observation; it does not fabricate an installer-success or
migration-success result or authorize a retry. Keep all incomplete intents.

A separately authorized `recover` path exists for admission-only, missing installer
outcome, migration-intent-only and migrated-without-result states. It is not gated
on successful installer/migration outcomes. It requires a new
`theme-intent-owner-recovery-approval/2`, exact prepared hash and candidate/plan,
actual owner decision, unique `decision_id`, `fixture:false`,
`restore_schema28_program_protected_products:true`, and
`reinstall_predecessor_and_relocate_config:true`.

Recovery first rehashes the original backup and confirms that the original
database's records remain unchanged and quiescent at schema28 or29. Later work is
not silently discarded or unknown billing rolled back. A changed or unavailable
source requires a separate recovery plan; this helper covers the bounded upgrade
window. It then stages verified program/products/config and protected copies,
creates a new empty recovery database, restores with pg_restore
in one transaction, then runs the same full schema28 state comparison against
`before.json`. Existing databases are never dropped or overwritten. It runs the
pinned predecessor installer to restore its normal uninstall/shortcut integration,
quarantines the failed program tree, restores the complete matching program and
protected files, and atomically updates config to the new recovered database and
product copy. The old database, failed program and failed protected trees remain
available for diagnosis. Database/products path relocation is an explicit recovery
decision, not an assertion that `studio.json` stayed byte-identical after activation.
The restored pre-relocation config bytes are verified before that final change.
No desktop or workflow is automatically launched afterward.

Standard NSIS shell integration is restored by replaying the exact predecessor
installer, rather than assuming that copying program bytes restores registry and
shortcut effects. Custom shortcut/registry state and actual NSIS integration are
not established by the fixture installer tests; require native recovery acceptance
if the independent reviewer or recovery decision needs that additional guarantee.
DPAPI copies are for the same Windows user/machine, not portable recovery.

After an actual process death, do not erase locks manually. Recovery must bind the
stale lock hash to its decision and establish that its owner PID no longer exists;
the old lock is retained as evidence. To stop a leftover cluster from that exact
managed data directory, the recovery decision must additionally include
`allow_stop_owned_cluster:true`; normal phases never adopt or stop it. Recovery
reads the verified backup's DPAPI blob, so it can repair an interruption that left
the live protected directory absent. A still-live lock owner or foreign listener
must never be stopped by a different run. Exact recovery startup/stop observations
belong in the new attempt receipt.

## Prospective invocation

Use absolute metadata paths. These are not instructions to execute now:

```powershell
# New operational backup only after independent v2 support:
./scripts/upgrade-theme-intent-v2.ps1 -Phase before -SessionId <unique-id> `
  -EvidenceDir <new-tracking-evidence-directory> -ReviewFile <v2-review>

# Only after a new exact owner installation/migration decision:
./scripts/install-theme-intent-v2.ps1 -SessionId <same-id> `
  -EvidenceDir <same-directory> -ReviewFile <v2-review> `
  -ApprovalFile <new-install-decision> -InstallAndMigrateApproved

# Read-only re-verification or reconciliation, even after admission ages out:
./scripts/upgrade-theme-intent-v2.ps1 -Phase after -SessionId <same-id> `
  -EvidenceDir <same-directory> -ReviewFile <v2-review> `
  -ApprovalFile <same-install-decision>
```

Recovery uses the separate `recover-theme-intent-v2.ps1` wrapper and
`-CoordinatedRecoveryApproved` with the new recovery decision. Never use the old
installer alone over schema29. Do not mix v1 and v2 receipts or edit frozen plans.

## Isolated verification boundary

The v2 suite invokes the actual Windows PowerShell5 wrapper, real DPAPI with
synthetic credentials and a disposable SCRAM-authenticated PostgreSQL18 cluster on
127.0.0.1:55452. It seeds nonempty actor/workspace/entity/connection/access/grant/
qualification records. Candidate migration runs the actual archived service.
Installers are explicitly fixture copy adapters under ignored `.verification`;
neither target nor predecessor NSIS is executed. Operational config/credentials,
database, registry, shortcuts, providers and workflows are not used.

The fixture layout requires an ignored-root marker, contained home/install/adapter
paths, synthetic database naming and bounded test ports. Its simulated review and
owner decisions remain under that ignored root and do not authorize operations.
No broad environment-variable override selects operational credentials or a test
home. Review fixture substitutions separately from the real candidate migration.

Executed results, failures, exact hashes and limitations are recorded in the v2
repair evidence and completion receipt after checks finish. Earlier v1 results
remain dated and are not relabeled as v2 acceptance. Next eligible gate remains a
fresh independent exact-v2 review; no operational action follows automatically.

## Completed local repair checks

Final `e2e-verified.tap`: 20 end-to-end scenarios plus the parent fixture test,
**21 passed, 0 failed, 0 skipped**. `guards-final.tap`: **5 passed, 0 failed,
0 skipped**. PowerShell parsing, targeted JavaScript syntax/format checks and exact
static package preflight passed. Original16 preparation artifact hashes remain
unchanged. The disposable test listener was stopped and fixture data retained.

The end-to-end run covers actual PowerShell admission before credential use,
synthetic DPAPI decryption, populated backup/snapshot preservation, a real running
qualification blocker, refusal to adopt a running cluster, backup-session reuse,
stale admission, separate admission then install from another working directory,
the exact candidate migration and result parser, repeated read-only verification,
global lock contention, source-data-change refusal, full matching-file/schema28
recovery, four caught crash windows, an abrupt CLI process death, child nonzero/
malformed/timeout outcomes, and credential redaction. A fixture clock creates
24hour-old admission metadata to test nonexpiring post-mutation verification;
this is not an actual24hour experiment. Recovery after an abrupt protected-file
move verifies the backup-DPAPI route, stale-lock retirement and explicit owned
cluster stop. Abrupt CLI probes bypass the PowerShell caller to observe process
exit independently of inherited Windows server handles; normal/recovery cases
exercise the actual wrapper.

The five additional guards cover tracked-tree backup rejection, dependency-binding
tampering, shared locks across evidence directories, refusal to stop a foreign
loopback listener, and both mutation wrappers' missing-switch denial before file
reads. Native NSIS/registry/shortcuts and installed UI remain unexecuted.

Retained development attempts are not final acceptance: `e2e-first.tap` exposed
Windows inherited-handle waiting; `e2e-second.tap` exposed pinned libpq's Unicode
credential limitation; `e2e-third.tap` passed14 checks on the earlier development
candidate; `e2e-expanded.tap` was deliberately interrupted when the process-death
harness waited on server handles. `e2e-final.tap` passed16 and failed5 including the
parent because its nonzero-child fixture read the wrong protocol field and left
later scenarios without recovery. The fixture was corrected to read the actual
`database_url`; the unchanged helper then passed the complete `e2e-verified.tap`
run. Do not suppress these failed/interrupted attempts or call them native tests.

Finding-to-repair map for independent re-review:

| Finding | Implemented repair                                                                                       | Local evidence                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| H1      | Owned managed-cluster lifecycle and receipts; explicit stale-cluster recovery                            | Real wrapper lifecycle, running-cluster refusal, abrupt-death recovery                                                                     |
| H2      | Sensitive bytes separated from hash evidence, ancestor/link checks, exclusive backup destination         | Containment/junction guards, before output inspection, reused-session rejection                                                            |
| M1      | Independent version2 binding gate on every phase before DPAPI                                            | Blocked-review negative case and operational rejection of fixture receipts                                                                 |
| M2      | Freshness at admission only, age-independent bound verification/recovery                                 | Expired admission refusal; fixture-aged after/recovery success                                                                             |
| M3      | Absolute repository-derived installer path before admission                                              | Actual wrapper invoked from a different working directory                                                                                  |
| M4      | Intent/result provenance, reconciliation and coordinated empty-target restore with retained failed state | Populated restores, caught/abrupt crash windows, protected-directory interruption; actual NSIS integration remains a native acceptance gap |
| M5      | Test-only contained layout, actual wrapper/CLI composition and populated sentinels                       | 20 scenarios; installer remains explicitly a fixture                                                                                       |
| L1/L2   | Same exporting transaction and checked-out client for baseline/dump                                      | Populated backup→restore fingerprints                                                                                                      |
| L3      | Running qualifications checked; autovacuum excluded from client count                                    | Real qualification rejection and source inspection                                                                                         |
| L4      | Bound/ordered installer outcome and migration chain; timeout/tree termination and redacted diagnostics   | Child failure/malformed/timeout/redaction scenarios                                                                                        |
| L5      | Built-in-only bootstrap, then reviewed migration/pg dependency closure before dynamic import             | Dependency-tamper guard and exact runtime map                                                                                              |
| L6/L7   | New nonduplicate receipt fields and JSON/UTF8 request transport                                          | New repair receipt, Windows PowerShell5 execution; ASCII libpq constraint explicit                                                         |
| L8      | Per-studio rather than per-evidence phase lock                                                           | Actual concurrent wrappers and cross-directory lock guard                                                                                  |

The implementation self-review does not close these findings on behalf of Claude.
Audit the exact new receipt hashes and retained failures before issuing any
supported v2 independent receipt. Operational preparation remains blocked pending
that review; installation additionally requires a fresh exact owner decision.
