# Theme-intent installed desktop acceptance plan — October 23, 2026

Status: prepared, not executed. This document is separate from the executable
upgrade-helper audit. It changes no helper, test, package, receipt, application
source or operational state. Full C54 remains partial.

## Purpose and entry conditions

Verify the installed Windows desktop's narrow theme-draft behavior after a
separately authorized installation and schema28→29 migration. This is neither a
request to install nor evidence that installation, migration or acceptance passed.

Intended candidate:
`7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`.
Intended installation plan:
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.
If either changes after review, reconcile this checklist with the actual candidate
and record which cases are affected before executing it.

Entry conditions, to be evidenced rather than assumed:

1. Independent helper review is complete and material findings resolved. Claude's
   current audit results are not yet known to this document.
2. Fresh backup/readiness and the exact owner installation/migration decision
   exist; the approved upgrade has completed, including its schema29/program and
   pre-existing-record preservation verification.
3. **Finish that preservation verification before launching the app or signing
   in.** Authentication, draft saves and archiving can legitimately change records;
   they must not contaminate the upgrade's unchanged-record baseline.
4. The acceptance session's actual scope covers local login, two clearly labeled
   synthetic drafts, bounded revisions and optional archival. Do not infer this
   authority from package or helper approval alone. Record the workspace and
   operator, and preserve all existing records/settings.
5. The local runtime is demonstrably quiescent and will not dispatch scheduled,
   maintenance, model or retrieval work during this session. Record the actual
   supported controls and their state before launch. If this cannot be established
   without unrelated settings changes, stop for a scoped decision; do not activate
   providers or silently change settings to make a test pass.

No credentials, login codes, auth headers, DPAPI contents or full sensitive
responses belong in screenshots or exported evidence. Use synthetic input only.

## Evidence setup

Create a new session-specific evidence directory when execution is authorized;
do not reuse a frozen package/helper evidence directory. Record:

- Candidate/plan identities, installed native and manifest hashes, schema version,
  reviewed helper identity, upgrade-verification receipt locator and observation
  times. Use observations from that actual installation, not copied success flags.
- Desktop process/build identity, workspace ID, session start/end, operator and
  applicable decision provenance. Do not substitute a Vite development page or
  intercepted browser fixtures for installed native evidence.
- A unique synthetic label, such as `LOCAL ACCEPTANCE <session-id> A` and `B`.
  Keep each entity's actual ID, version, content hash and status in a test-record
  ledger. Expected maximum: two new entities, A versions1–2 and B version1;
  any deviation must be explained before another write.
- A redacted baseline of existing requests, grants, qualifications, model access,
  connection settings, workflow/budget/retrieval state and pre-existing records,
  using already authorized local inspection. Do not obtain wider credentials or
  invent an inspection endpoint. If proof is unavailable, mark that assertion
  unverified and retain the gap.
- A check-results table with case ID, actual steps, expected/observed outcome,
  time, evidence locators and pass/fail/blocked/not-run. All cases start not-run.

## Native acceptance cases

| ID    | Action                                                                                                                                               | Required observation                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NI-01 | Launch the exact installed desktop and authenticate locally; open Submit. Inspect saved model status without invoking verification or qualification. | Actual local health/session succeeds on schema29. Saved status is presented accurately; no provider request is initiated. Existing connection settings and qualifications are preserved.                                                                                                                                                                                                             |
| NI-02 | In “Start with a theme,” enter only synthetic theme A and click “Save draft and prepare plan” once.                                                  | A single active `theme_intent` entity, format `theme-intent/1`, version1. No claim, run, grant or required model/budget setup is created. Notice identifies the saved version.                                                                                                                                                                                                                       |
| NI-03 | Inspect A's prepared research plan through the real installed path.                                                                                  | Plan format `theme-research-plan/1`; workspace/id/version/content_hash match saved A. Limits are provider_requests0, source_fetches0 and new_metered_spend_nano_usd `'0'`; execution is `not_authorized`; native search remains `not_integrated_account_entitlement_unknown`. Suggested questions are proposals.                                                                                     |
| NI-04 | Explicitly quit and relaunch the desktop after A is safely saved; authenticate if needed and select “Resume <A title>.”                              | A's saved fields and identity resume from durable storage. Do not expect an unsaved plan panel itself to persist. Preparing again without edits binds to the same saved version and does not create a duplicate entity or revision. Record any session-row changes separately.                                                                                                                       |
| NI-05 | Select “New theme draft,” create synthetic B, and save once. Include a short context, constraint, question and proposed `https://example.com/` URL.  | B version1 preserves these optional values. The URL remains a proposal, not retrieved evidence. No network/source/provider dispatch is attributed to saving it.                                                                                                                                                                                                                                      |
| NI-06 | Resume A. Edit context to a distinctive unsaved marker. Click “New theme draft” twice, then Resume B, then Resume A while confirmation is open.      | Every ordinary action retains A's unsaved marker and current saved-record identity. The confirmation remains effective. No draft switch or mutation occurs just because a prompt was already open. This specifically covers the former TI-01 bypass.                                                                                                                                                 |
| NI-07 | Select “Keep editing.” Then click “Reload saved version” twice without confirming discard.                                                           | The marker remains and ordinary Reload remains guarded. “Keep editing” removes the pending prompt without losing input.                                                                                                                                                                                                                                                                              |
| NI-08 | While edits are dirty, explicitly select Resume B and then “Discard edits and open.”                                                                 | B loads only after the explicit discard action; its saved fields/version appear. Draft A's stored version remains unchanged. Record deliberate loss of the synthetic unsaved marker as expected.                                                                                                                                                                                                     |
| NI-09 | Resume A again, edit context, open an ordinary navigation confirmation, then save A rather than discarding.                                          | Exactly one successful revision to A version2, and the obsolete navigation prompt clears. The prepared plan binds to version2/content hash. A later clean navigation works.                                                                                                                                                                                                                          |
| NI-10 | Before cleanup or normal work, compare the test-record ledger and local execution/accounting observations with baseline.                             | Exactly the declared synthetic records/revision changes plus explained auth/audit/session bookkeeping. No new claims/runs/grants, source retrievals, provider requests, workflow dispatch or metered exposure caused by acceptance. Existing saved requests, model access, qualifications and connection settings remain unchanged. Missing observability is an explicit gap, not a zero-call claim. |

Native UI evidence alone supports visible behavior, not all database/accounting
assertions. Pair it with redacted authorized local readbacks. Do not log raw
request headers, cookies, CSRF tokens or credential payloads.

## Failure behavior and separate controlled tests

If a real save/load fails naturally, stop repeated clicking, record the error and
verify the current input and record identity before any recovery choice. Preserve
the attempted entity/version in the ledger. Do not retry an uncertain write
blindly; first reconcile whether it committed. A failed confirmed load must retain
input and the next ordinary navigation must still be guarded.

Do not induce database outages, intercept installed production traffic, edit
operational records behind the UI or manufacture version conflicts in this
session. Failed-save, stale-version and failed-confirmed-load tests already have
dated isolated HTTP/browser evidence; that evidence is not installed-native
verification. If independent review requires fresh native fault injection, prepare
a separately bounded disposable installed-studio test environment and acceptance
decision. Until then label those native fault cases not-run.

The current in-form guard covers New/Resume/Reload. This checklist makes no claim
that browser refresh, arbitrary app-route navigation, window closure or operating
system shutdown preserves unsaved text. Do not test those with valuable input or
expand the product claim without implementation/evidence.

## Cleanup and stop rules

Stop at unexpected provider/retrieval/workflow dispatch, unexplained existing-state
changes, stale program/schema identity, lost input in a guarded action, duplicate
creates, or inability to distinguish test mutations from preserved records. Keep
evidence and stop new test writes. An acceptance failure does not authorize
rollback; coordinated schema28 snapshot and matching-program recovery requires
its own decision. Do not install old binaries over schema29.

If archival was authorized, archive only the two entity IDs in the session ledger
with their current expected versions and a synthetic-acceptance reason. Record
resulting status/version/audit effects; do not delete history or archive records
by a broad title match. Otherwise leave the two labeled drafts and report their
IDs as retained test data. Quit any test session and record runtime state.

## Completion statement template

> On [time], candidate [actual identity] at installed schema [observed] completed
> [passed cases]/[executed cases], with [failed/blocked/not-run cases]. Evidence:
> [locators]. Test records: [IDs/versions/status and cleanup]. Existing-state and
> zero-dispatch conclusions are supported by [actual readbacks], with [gaps].
> This establishes only installed theme-draft preparation/navigation acceptance.
> Source collection-to-claims, live discovery, broader lifecycle and full C54
> remain partial. Next eligible task: [bounded task supported by current reviews].

Do not fill that template with assumed results. This plan has no executed native
results and grants no installation, migration, provider or workflow authority.

## Preparation provenance and handoff

Prepared by read-only inspection of the existing theme-intent UI/domain/contracts,
implementation/repair reports and prior real-API and intercepted-browser scripts.
The plan uses the actual button labels and domain fields. It deliberately separates
the upgrade's pre-UI preservation check from subsequent authorized test mutations.

Only this new document was written for the parallel task. Shared tracking updates
are deferred until Claude's audit completes so its reviewed file set remains
stable. After results arrive, reconcile findings first, then reference this plan
from tracking if still applicable. The audit/helper's pending review and all frozen
evidence remain unchanged by this task.
