# Discovery qualification and migration review packet

Prepared October 20, 2026. **Owner approved and upgrade executed; qualification stopped after its first failed development case.**
Latest execution: [result and limitation](DISCOVERY_QUALIFICATION_RESULT.md).
The preparation description below is retained as the frozen proposal, not current status.
This is operational qualification, separate from thesis tasks, study holdouts and
independent ratings. Preparation has sent no new real model/search requests and
has not changed the saved studio, connection settings or credits policy.

## Concrete proposal

1. Gracefully quit the installed studio after checking for active/unknown work.
   Install the reviewed per-user candidate at the existing `Creator Agent` location.
2. Use its supported upgrade path to save a verified pre-migration backup and migrate
   the existing studio from schema 26 to 27; reopen and verify sign-in and records.
3. On the existing `gpt-6-astra` plan connection, add only `research_synthesis`,
   `candidate_generation` and `scoring` to permitted task classes and accept that
   reviewed settings version. Preserve summarization/specification, data permissions,
   every cap and the credits-off/no-paid-fallback policy.
4. Run at most **18 new plan requests**, sequential, with public synthetic inputs:
   six per class (two development, four held-out). No retries or prompt tuning.
   Stop at the first provider refusal, unknown result, failed case or quota/cap issue.
   Require all four held-out cases per class; the full suite also stops on development
   failure. No discovery workflow, build, web search or pilot launches afterward.

The existing studio ceiling and API allowance are unchanged. No new metered spending
or credits use is proposed. Plan quota is shared with personal ChatGPT/Codex use;
remaining provider allowance may be unknown and may stop this run. Studio caps stay
40 requests per rolling day, one in flight, 10 per operational run, 120 seconds and
16,000 output characters per request, 24,000 input characters. Qualification requests
use the existing separate benchmark path; this plan caps their aggregate at 18 and
36 minutes. Preflight requires at least 18 remaining studio daily slots and no
in-flight/unknown requests; it does not claim provider quota is guaranteed.

## Reviewable identities

- Installer: `apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe`
- Installer SHA256: `f94ff911ef46e596e3425b8443edd538807fa80bb4a536291911b74881e672c9`
- New bundle manifest SHA256: `80fe5f7a40e844d6361277dc4c96f33e927cb0527871fe2e863c08b086cdb56b`
- Current installed manifest re-read: `97720440cd44a24f5f95d371706257742d24ea3e6620607f2e3691d3f01a13eb`
- Execution-plan hash: `de5297fdbd86635a6301cf6a53147cebec4bcf467d77dabbfa56132dc16346b4`
- Exact target, source/compiled-file hashes and limits:
  tracking/evidence/discovery-qualification-prep/execution-plan.json.
- Exact before/after connection settings and hashes:
  tracking/evidence/discovery-qualification-prep/settings-review.json.

The proposed settings match the last recorded connection settings except the three
added task classes. The checked-in default template has an older explanatory-note
string, so it must not overwrite the saved settings. The execution settings review
supersedes the initial preparation freeze's template-settings hashes; frozen case
bytes, splits, assertions and success criteria are unchanged. Re-read actual settings
before applying: a mismatch stops preparation for review, never broadens the diff.

## Cases and grading

Manifests are in config/connections/benchmarks/discovery-synthetic-v1. Inputs are newly
authored imaginary archive-workflow notes, not reused thesis or fixture corpus cases.
Sources use `.invalid` URLs and synthetic passages; none is customer validation or
an actual source fetch. `fixture:false` means the intended target is a real model,
not that the input facts are real. Gold/control outputs and expected assertions are
separate author-visible controls; only each case's `input` reaches the target model.
The author saw the labels. These held-out labels are held from the target, not from
an independent evaluation team; do not reuse them as fresh evidence after tuning.

| Task class           | Coverage                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| research_synthesis   | Transfer mechanism; no observation; conflicting counts; stale-only evidence; hostile source instruction; existing checklist      |
| candidate_generation | Installed-tool response; bounded software hypothesis; process change; human judgment; hybrid uncertainty; withdrawal on revision |
| scoring              | Duplicate; unsupported novelty; contrary trial; unavailable data; cheaper alternative; hostile proposal instruction              |

The new `discovery_contract` check uses production output schemas and evidence-ref,
perspective and skeptic-coverage checks, plus frozen assertions on expected enums,
source refs and required uncertainty/revision content. It rejects unknown/extra
schema fields, forged source refs, missing criteria, mismatched packet hashes and
fixture-model outputs. It permits authored sets of acceptable decisions where more
than one response is reasonable; it does not demand exact prose.

The workflow gate now checks qualifying manifests against current production prompts
and role version, with propose+revise coverage for designers. A successful unrelated
benchmark with the same task-class name or obsolete prompt cannot unlock discovery.
Future prompt/checker changes require affected qualification review/versioning.
These checks do not establish nuanced factual entailment of every sentence, overall
idea quality, novelty, product usefulness, fairness or a generally qualified role.
Independent substantive review and end-to-end acceptance remain separate.

## Preparation evidence

- 90 offline positive/schema/reference/fixture-negative scorer controls passed at
  manifest preparation; additional valid-shape decision mutations are covered by
  tests/src/discovery-qualification.test.ts.
- Final affected scorer/connection/workflow/routing checks: **32/32**, no skips
  (tracking/evidence/discovery-qualification-prep/final-tests.tap).
- Final staged-bundle backup-first 26→27 upgrade and restore/adoption checks: **2/2**,
  no skips, on disposable PostgreSQL (final-migration-tests.tap).
- TypeScript, web typecheck/production bundle, native release and NSIS build passed.
  Existing Vite chunk-size warning remains. Sandbox DNS initially blocked NSIS fetch;
  outside-sandbox packaging succeeded. No installed-app acceptance is claimed.
- A verified rollback copy of current executable and runtime resources is held under
  .verification/discovery-upgrade-rollback. No personal studio records/credentials
  were copied. Receipt: tracking/evidence/discovery-qualification-prep/rollback-copy.json.

The rollback program copy does not replace a database backup. Migration has no
in-place downgrade: on a failed upgrade preserve the failed candidate/logs, verify
restoration of the pre-upgrade dump into a separate target, then restore program/data
compatibility under the recovery procedure. Never launch the old schema-26 bundle
against the schema-27 database or overwrite the sole studio copy to try a rollback.

## Execution after approval

First verify the installed candidate/hash and actual upgrade backup. Apply the
reviewed task-class-only settings change through authenticated settings/accept-caps
paths, retaining concurrency/version checks. Do not directly edit database settings.
Then the protected local wrapper is:

```powershell
./scripts/qualify-plan-discovery.ps1 `
  -StudioHome 'C:/Users/jorda/AppData/Local/com.creatoragent.studio' `
  -ApprovedExecutionPlanHash 'de5297fdbd86635a6301cf6a53147cebec4bcf467d77dabbfa56132dc16346b4'
```

The wrapper keeps local DPAPI credentials off command lines/output. The runner checks
candidate/manifest/settings hashes, current connection state and remaining studio
allowance before dispatch, uses the existing admission/qualification/settlement path,
retains raw synthetic results and request IDs, and preserves an exclusive run.lock.
Do not delete that lock, retry a failed case, tune using held-out outputs or call a
partial run fresh independent evidence. Unknown outcomes require reconciliation.
The hash is a review binding, not authorization on its own.

Offline check (no credentials or network):

```powershell
node scripts/qualify-plan-discovery.mjs --check
```

Next eligible action is approval/execution of this exact packet. If scope/candidate
changes, prepare a new binding; if target results exist, preserve them and version
any new cases/criteria. No search/Agent Reach, paid fallback, unrelated account or
pilot activation is included.
