# Discovery qualification execution — October 20, 2026

Jordan approved the entire concrete packet with “I approve all of that.” Execution
began October 20 local time (receipts cross midnight UTC). The approved plan hash is
`de5297fdbd86635a6301cf6a53147cebec4bcf467d77dabbfa56132dc16346b4`.

## Installed and saved state

The unsigned installer exited 0. Installed bundle-manifest SHA256 matches the
approved candidate: `80fe5f7a40e844d6361277dc4c96f33e927cb0527871fe2e863c08b086cdb56b`.
The studio was already stopped. Preflight found nine completed plan requests and no
unknown/in-flight requests or leased workflow tasks. The installed service's supported
`migrate` command saved and verified a custom-format PostgreSQL backup before applying
migration 27. Its dump hash was independently checked after migration:
`8bc7c74f170d16d269bb2e8ea08432ac281af5c29a7b949bbf8ae60d669ad0f9`.
Backup: `C:/Users/jorda/AppData/Local/com.creatoragent.studio/backups/pre-migrate-v26-2026-10-20T23-58-41-979Z`.
The actual backup has a readable restore listing; full restoration was tested earlier
on disposable databases, not repeated against this saved studio.

The desktop reopened and reached running state. Its expired local-owner session was
renewed through its native menu, with no provider OAuth or password entry. Authenticated
API paths added and accepted only research_synthesis, candidate_generation and scoring.
Settings hash is `5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533`.
Existing data permissions, all caps, credits-off policy and spending ceilings remain.

## Live result

Exactly **one new gpt-6-astra plan request** completed. The runner stopped on
`dev-transfer` (research_synthesis), with `acceptance_check_failed`; no retry or later
case/class dispatch occurred. Request `4f35a154-0210-4b40-b092-5bfd56a76503`,
qualification `bfdbcf34-dcd2-49bf-9afa-7ac401020429` (failed).
The production schema/reference check passed and both mechanism assertions passed.
The frozen evidence_strength assertion required `well_supported`; output was
`exploratory`, explicitly separating synthetic observations from real-world validation.

This suggests an overly restrictive authored expectation may be involved. It is not
proof of model inability or permission to change the outcome. Criteria, prompts and
labels remain frozen. No held-out cases were attempted. The durable failed record
reports 0/4 held-out accepted because unattempted cases cannot qualify; that is not
four observed model failures. Candidate generation/scoring remain untested.

Independent authenticated API readback confirms ten total completed plan requests,
zero in flight and zero unresolved. The earlier summary qualification remains valid
in its narrow scope. No new metered fallback, credits, search, workflow launch or
pilot activation occurred. Shared plan quota was consumed; no claim of free inference
or provider billing visibility is made.

## Evidence and next eligible work

Receipts under tracking/evidence/discovery-qualification-prep:
installed-upgrade.json, accepted-settings.json, execution-intent.json,
raw-results.json, stopped.json, verified-live-receipt.json and execution-outcome.json.
The earlier result.json describes preparation only. Keep run.lock and do not replay
this suite or present exposed cases as fresh held-out evidence.

Next eligible prompt: review the evidence-strength rubric against production role
semantics, then prepare a versioned qualification correction with fresh cases and
explicitly separated development/held-out evidence. Do not weaken this frozen result
or dispatch another suite automatically. Discovery admission remains blocked by the
missing current-role qualifications. C54 remains partial; chat/theme-free intake,
native-search qualification and end-to-end product paths remain separate work.
