# Theme-intent desktop package and upgrade plan — October 23, 2026

The reviewed theme-draft repair is packaged as an unsigned local Windows NSIS installer. The installed application remains unchanged. Packaging sent no provider calls and accessed no operational credentials or database. This package does not activate discovery, collection or a pilot.

Exact candidate canonical hash: `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`.
Installation-plan canonical hash: `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.
Installer SHA256: `3af2712caeccc3d4519b732964948270b8647dd023be6b6159614889be6d834b`.
Packaged native SHA256: `510b09c31d6ea2f00b65b97239345329a13835a63521262caa1a6223e8988ca9`.
Runtime manifest SHA256: `5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6`.

The candidate binds 265 source/artifact hashes and 71 runtime resources, archived under `.verification/theme-intent-artifacts-2026-10-23/`. The installer was extracted statically into `.verification/theme-intent-nsis-payload/`; all extracted resources and the manifest match staging. Native identity is taken from the extracted installer payload, separately from the loose build executable. The previous 67-resource installer/archive and installed predecessor were verified intact before building and retained for rollback provenance.

Executed: project TypeScript and production UI/service staging build, offline locked MSVC/Tauri/Cargo NSIS build, 7-Zip extraction and all resource hashes. Vite emitted its existing large-chunk advisory; staging completed. The Windows Store 7-Zip alias required host execution for read/extract access; no software was installed. Supported staged-service tests on disposable PostgreSQL passed 2/2: input validation and backup-first schema28-to29 upgrade under the migration lock. This proves that isolated path, not operational migration, restoration or native installed acceptance.

Static comparison of the old/new bundled migration arrays confirms all 28 prior SQL/name/version entries unchanged; only migration29 adds theme_intent to the entity-kind check. Eleven role/rendering/admission source/compiled paths match saved references (the orchestration source uses its historical subscription source receipt; the other ten use the prior distributable map). This supports a narrow unaffected-role assessment; historical model outputs and qualifications remain dated/candidate-bound evidence, not new inference or blanket acceptance for this package. Source/contract changes are not silently relabeled as live verification.

The upgrade plan requires schema28 before and schema29 after. The desktop's supported migration action performs a hash-verified backup and validates the dump table of contents before migrating. Installation will require fresh operational quiescence checks, a supported database/products snapshot, protected config/DPAPI/plan-credential backup, complete program rollback copy and exact preservation hashes for saved requests, grants, model access, qualifications and settings. No such new operational backup is claimed by this preparation.

Rollback is coordinated: schema28 binaries must not simply be reinstalled over schema29. After migration, recovery requires the verified schema28 snapshot and matching program/products/config restored together under an explicit recovery decision. No restore rehearsal or current backup coverage is claimed. Existing earlier snapshots are retained but must not substitute for a fresh snapshot of the now-current studio.

Before an owner decision, the new schema29-aware executable backup/install/preservation helper and its static gates still require implementation and affected review. Existing schema28 helpers must not be reused unchanged. The declarative plan requires exact package review, a new owner approval covering installation and backup-first migration, and Creator Agent fully quit. Closing its window may leave the process running. This document requests no installation, sign-in change or provider authority.

Evidence: `tracking/evidence/theme-intent-package-2026-10-23/` contains candidate-plan.json, installation-plan.json, stage/native/extraction logs, migration-role-parity.json, prepackage.json and staged-upgrade-tests.tap. Next: separate package/plan review and completion of the new executable installation-preparation helper; then fresh backup/readiness and an exact owner decision before installation. Full C54 remains partial; collection-to-claims and the in-app product lifecycle remain later gates.
