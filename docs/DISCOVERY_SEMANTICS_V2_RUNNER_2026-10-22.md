# Bound semantics-v2 runner implementation — October 22, 2026

Implemented and separately reviewed against exact executable-plan v3 hash
4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c.
Plan binds229 source/artifact hashes, exact reviewed role1.4 package and v2 packet.
The shared control loop is unchanged:12 sequential requests,0retries,120seconds
per request,24minutes total,one concurrent request,16000output characters.

Static gates bind the exact plan and model/workspace/connection/settings, supported
runner review receipt, all source hashes, package identity and future installation
receipt. PowerShell now calls --execution-check before Add-Type/DPAPI: exact home,
installation proof and installed native/manifest/all resource hashes are checked
before any secret decryption. --review-check is an explicitly review-only static
diagnostic; it does not certify installation. The real run repeats installed checks
and then authenticated API/CSRF, schema28, availability within15minutes, credits
off,cap40,capacity,no active/unknown/leased/nonterminal work and unattempted manifest
checks. Exclusive persistent lock precedes qualification creation/provider work.
Output intents/outcomes and substantive-review placeholders are preserved;unknown
delivery remains unresolved and blocks progress. No implicit refresh or fallback.

Reviewer found R1: original wrapper could decrypt secrets before rejecting wrong
home/missing installation proof. Repaired as above and added an actual PowerShell
wrapper subprocess rejection check. Final17 tests pass through standalone and
normal compiled entry; TypeScript build and PowerShell parser pass. Tests cover
wrong scope/candidate/source/review/install evidence, stale/future/unknown quota,
credits/capacity,first failure/refusal/quota/unknown,exceptions,intent failure,
cancellation,deadline,12-request ceiling and sequential dispatch.108 packet controls
pass. Initial16 tests/finding snapshot and superseded draft plans remain preserved.
The intermediate v2 plan captured a test syntax typo caught before testing; final
v3 captures corrected sources. No superseded plan was used for dispatch.

Independent review verified all17tests/108controls, exact plan/source bindings,
positive --review-check and missing-installation rejection. Parent verified240
review artifact hashes and reran positive --review-check with the actual receipt.
These are injected/offline/static checks, not live API/database/provider execution.
No installation,studio/credential access,provider call or run.lock occurred.
Full discovery/C54 remains partial; installed role1.3 unchanged.

Runner: scripts/qualify-discovery-semantics-v2.ps1 with required StudioHome,
ApprovedExecutionPlanHash,SeparateReviewReceipt and InstallationReceipt arguments.
The future installation receipt must have status verified_records_preserved,
exact candidate/install plan hashes, installed manifest/native hashes,schema28,
records/settings unchanged,credits confirmed_off,zero active/unknown requests and
verified backup. It does not exist yet. No live approval is inferred by supplying
the review receipt or implementing this runner; a new exact-plan owner decision
and fresh preflight are still required.

Next eligible: supported local upgrade using the reviewed pinned installer, with
fully quit app,idle check,program rollback,supported studio-home/database backup,
before/after record preservation,all installed hashes and health/session checks.
Do not run the suite or refresh availability automatically.

[Final plan](../tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json),
[separate review](DISCOVERY_SEMANTICS_V2_RUNNER_REVIEW_2026-10-22.md),
[tests](../tracking/evidence/discovery-semantics-v2-runner/tests-review-fix.tap).
