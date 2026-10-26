# Post-launch acceptance amendment v2 independent review — October 26, 2026

Verdict: **supported at documentation-repair scope; operational/native readiness remains blocked**. R1 and R2 are addressed. No new actionable finding in this bounded repair review. This is not owner adoption, a safety implementation review or execution authority.

Exact candidate: `docs/THEME_INTENT_POST_LAUNCH_ACCEPTANCE_AMENDMENT_V2_2026-10-26.md`, SHA-256 `555a54faa9f5f33efbb912dd5170e3794577fa18a3bdd6716e07755aed55ad8d`.

## Reviewer and scope

Same Codex subagent that authored the first independent reconciliation review, with that review history retained; no authorship of amendment v2. Same model as the authoring parent, not blinded, not separate-model-family support. Parent requested this exact-path/hash review. Repository-only source reading and input hashing; no tests, verifiers, external review service, operational reads, implementation, launch or sign-in. Only this new report and its new receipt were written. Prior review/report, original plan and v1 remain frozen.

## Finding disposition

**R1 resolved for documentation.** The opening prerequisite now makes current-work safety support mandatory before every launch, expressly including identification-only launch. Owner acceptance, PR-01, M3 and absence of intentional edits cannot substitute. The design question explicitly covers automatic startup, worker, outbox, broker and retrieval paths, including queued, leased and uncertain work, with deterministic admission and bounded exposure.

The alternatives require one coherent reviewed method before capability implementation/use, address inspection validity and intervening producers, distinguish changed-candidate control from historical evidence, and allow explicit deferral. This resolves the unsafe optional-risk route. No future method has been demonstrated; implementing that method is outside this documentation repair's gate.

**R2 resolved for documentation.** Exact-ID prelaunch requirement remains the default; identification alternative remains disabled pending a separately reviewed installed UI procedure and every other prelaunch gate. Source reading confirms main.tsx automatic first-workspace fallback, workspace name/mode rendering and omitted owner suffix; desktop.tsx renders selected workspace ID in worker command examples. V2 correctly limits a possible future read to the displayed ID token, prohibits executing/copying commands or pairing, and rejects familiar name/absent suffix as direct current owner-role evidence. It claims no installed observation and retains the block if adequate UI role evidence is unavailable.

Original A0 remains blocked. M3, historical installation evidence, reader/collector obligations, scoped existing grants, NI limits, shutdown rules, H and full C54 status are retained. Relabeling NI-00 remains conditional on later safety support and a concrete session decision.

## Evidence and completion limits

Nine exact inputs were hashed before and after this bounded review; all unchanged, including original plan, v1 and first report/receipt. The new receipt contains the complete maps. No historical chain rehash or test rerun was needed: this review assesses only the exact documentation repairs against the earlier findings and relevant source excerpts. Source excerpts establish possible UI behavior, never current rendered installed behavior or current-work safety.

Native acceptance is blocked, NI cases not-run, H unverified and Jordan's alone, full C54 partial.

## Exact next bounded prompt

> Prepare one repository-only current-work safety design for exact installed candidate 7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc under amendment v2 SHA-256 555a54faa9f5f33efbb912dd5170e3794577fa18a3bdd6716e07755aed55ad8d. Trace actual startup/worker/outbox/broker/retrieval paths and their deterministic permission, resource and uncertain-outcome admission using exact source and existing reviewed evidence. Select the smallest coherent inspection, startup-control or equivalent-evidence approach, or explicitly defer. Specify exact predicates, evidence/version binding, validity interval, producer exclusion, observer effects, failure/stop semantics and any missing implementation/review/authority. Preserve frozen documents and evidence. No operational reads, tests/verifiers, adapter/collector/control implementation, launch/sign-in, SQL/credentials/helpers, install/migration, activation or recovery. Do not enable the workspace-ID alternative or grant native-session authority.

