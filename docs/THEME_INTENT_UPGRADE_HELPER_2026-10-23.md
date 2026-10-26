# Theme-intent schema-29 upgrade helper — October 23, 2026

Implemented, locally tested and self-reviewed. This is executable preparation,
not installation approval or independent review. Full C54 remains partial.
The operational app/database were not inspected or changed during these tests;
their last verified state remains the installed schema-28 predecessor.

The helper pins candidate
`7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`
and installation plan
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.
Frozen packages, plans, reviews and historical receipts are unchanged.

## Executable paths

- `node scripts/upgrade-theme-intent.mjs --check`: validates both canonical
  identities, package review bindings, candidate source bindings, retained old
  installer, new installer, extracted native/manifest/all 71 resources and archive
  resources. Reads no operational configuration, credentials or database.
- `scripts/upgrade-theme-intent.ps1 -Phase before -EvidenceDir <new-directory>`:
  prospective operational preparation, **not executed here**. Requires fully quit
  desktop/workers and schema 28 with exact migration ledger checksums. Rejects other
  connections to that database, nonterminal tasks/workflows, unresolved plan
  requests, active/unknown budget reservations, source retrievals, provider batches,
  GitHub/marketing/portfolio operations, desktop jobs and previews.
  Fingerprints all public record tables (including requests, grants, access,
  qualifications and settings), protected files, configuration and products.
  Makes a verified complete program rollback copy, protected config/DPAPI/plan
  credential copies, product tree copy and PostgreSQL snapshot custom archive.
  Validates archive TOC and all hashes, then rechecks unchanged state and quit
  conditions. Evidence directory creation is exclusive; partial attempts remain.
- `scripts/install-theme-intent.ps1 -EvidenceDir <directory> -ApprovalFile <file>
-InstallAndMigrateApproved`: prospective installation, **not executed here**.
  No default or inherited approval. Admission verifies backups/rollback and current
  predecessor again, creates an exclusive installation lock, then runs the pinned
  silent installer. Migration rechecks schema28, state, target program, approval,
  admission and installer outcome, creates a separate exclusive migration lock,
  and invokes the installed supported `studio.mjs migrate` command. That command
  itself creates a verified pre-migration backup before the advisory-locked
  migration. Only from28/to29/applied[29] is accepted.
- `after` verifies schema29, all prior migration records/checksums, every existing
  public table fingerprint, config/protected files/products, exact native,
  manifest and 71 resources. Its receipt explicitly leaves installed UI acceptance
  false. Run before any UI test creates records or normal work resumes.

All mutation-related phases require approval and review checks before the
PowerShell wrapper decrypts the database credential. Both wrapper and Node path
repeat admission checks. Prepared snapshot, backup and approval timestamps must be
valid, nonfuture and at most 15 minutes old. Large backups or an expired window
fail closed; prepare a new directory rather than editing a receipt. Do not move
the evidence directory between phases. Keep exclusive local maintenance control;
process/database checks do not prevent a person deliberately restarting another
client after a check. No unattended upgrade guarantee is claimed.

## Required review and owner decision

There is deliberately no usable approval file or supported independent-helper
review receipt in this change. A future independent U02 reviewer must issue
`theme-intent-upgrade-independent-review/1`, status `supported_exact_helper`,
`prior_implementation_involvement:false`, exact candidate/plan hashes and
`helper_sha256` covering all four paths returned by `helperHashes()`. Changed
helper bytes invalidate that receipt. The implementation self-review receipt is
not accepted by the admission gate.

Only after that review and fresh preparation may an actual owner decision be
recorded as `theme-intent-owner-install-approval/1` with `candidate_plan_hash`,
`installation_plan_hash`, exact `prepared_sha256`, `helper_review_path`,
`install_and_migrate_28_to_29:true`, the verbatim `owner_decision`, and UTC
`approved_at`. Recording JSON alone is not evidence that the owner granted it;
retain the actual decision provenance. Earlier installation/provider grants do
not cover this package. These instructions grant no installation authority.

## Backup compatibility and coordinated rollback

The workspace `createBackup`/`checkBackup` currently require schema29 and cannot
back up a schema28 predecessor unchanged. This helper therefore uses the same
supported PostgreSQL custom-format archive and TOC operations as
`preMigrationBackup`, adds an exported read snapshot, and separately hashes product,
protected and program copies. Its format is explicitly
`theme-intent-upgrade-backup/1`, **not** `creator-backup/1`; do not feed it to the
current Restore Studio API or relabel it as a portable studio backup.

On any uncertain installer/migration outcome stop and preserve evidence/locks;
never remove a lock to retry blindly. Before migration, retain the old program
copy and schema28 dump together. After migration, old binaries cannot run schema29.
Under a separate explicit recovery decision:

1. Fully stop the studio/workers and retain the failed schema29 state for diagnosis.
2. Reverify `backup.json`, dump hash/TOC and every program/products/protected hash.
3. Restore `database.dump` with supported PostgreSQL `pg_restore --exit-on-error`
   into an empty recovery database, with the matching product tree. Never restore
   over a nonempty operational database. Verify ledger28 and preserved records
   against `before.json` using matching predecessor code/tools.
4. Restore the matching complete `program` tree and protected `studio.json`,
   `secrets`, `plan-credentials` together on the same Windows user/machine. DPAPI
   copies do not establish portable credential recovery. Any recovery-target
   config changes require explicit recording and revalidation.
5. Verify old native/manifest/resources, settings, lineage and local startup before
   permitting new work. Do not merely run the old installer over schema29.

This session rehearsed only a synthetic database dump/restore and file-copy
integrity. It did not rehearse full studio/program/DPAPI recovery or operational
restoration. Fresh operational snapshots, actual owner approval, installation,
authenticated local health/model status and installed theme save/resume/navigation
acceptance remain unexecuted. Installed UI probes must label any test records.

## Executed evidence and review

`tracking/evidence/theme-intent-upgrade-helper-2026-10-23/` retains transcripts
and exact helper hashes. Final reviewed test transcript (`tests-reviewed.tap`): **10 passed, 0 failed,
0 skipped**. Contract tests cover stale/wrong approval, unsafe paths, copy
corruption/reuse, schema/state preservation, twelve quiescence rejection categories,
review gate and installer denial before file/credential reads. Disposable
PostgreSQL18 checks cover full schema28→29 fingerprint preservation, altered
migration-checksum rejection, custom archive TOC, restore of schema28 ledger and
sentinel rows, and corrupt-dump rejection. No provider calls/workflows.

Initial sandbox TCP access failed (EACCES), then a host attempt had no reachable
test server. Those failures remain in `tests.tap` and `tests-host.tap`. A separate
host cluster at127.0.0.1:55451 produced `tests-executed.tap` (8/8),
`tests-expanded.tap` (10/10), and after review repairs `tests-reviewed.tap` (10/10).
`tests-shutdown-orchestration.tap` records a later attempt after shutdown (8pass,
2connection failures); it is not the successful acceptance transcript.
Both disposable listeners were stopped. No operational credentials/config/DB
were accessed. PowerShell parse checks, JavaScript formatting and static package
preflight passed. No application build was necessary; frozen runtime source was
not changed.

Self-review used the Ponytail review discipline and traced the wrappers, admission,
snapshot/backup, supported migration path, state verifier and tests. It identified
and corrected the schema28 standard-backup incompatibility, required matching
helper-review hashes, complete current-program/rollback parity at admission,
additional uncertain-work categories and fresh approval rechecks near mutation.
This is implementation-involved model
review, not independent or human acceptance. The full operational CLI path remains
unexecuted; tests exercise its shared gates and real local backup/state primitives.

Next eligible prompt: U02 independent exact-helper review, including PowerShell
control flow, pre-secret gates, custom backup recovery contract and the retained
isolated results. Then fresh operational backup/readiness preparation and a new
exact owner installation/migration decision; no automatic next milestone.
