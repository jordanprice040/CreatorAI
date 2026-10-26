# Approved availability check result — October 22, 2026

**Partial execution, stopped on local HTTP 403; zero provider requests admitted.**
The owner approved clearing the saved exhausted observation and one built-in
verification request, without retry or automatic qualification. The approved reset
succeeded; the verification endpoint refused admission. Provider availability remains
unestablished and the 12-case suite did not run.

## Actual effects and evidence

Evidence directory:
[approved availability check](../tracking/evidence/approved-availability-check-2026-10-22/).
The operation lock, authorization, script hash, original snapshot, mutation intents,
reset receipt, one-shot grant and stopped receipt remain intact.

- Settings hash remains 5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533.
- Saved quota changed from exhausted to unknown through authenticated quota-recheck.
  The prior exhausted observation was preserved in before.json and the reset intent.
  Unknown is not an observation of available provider allowance.
- Created grant 082e920d-d3c1-4ab7-8f19-9a19258eab53 for gpt-6-astra/responses,
  max_requests=1, expiry 2026-10-22T04:32:09.246Z. At readback it was unused (used=0).
  Do not reuse it to work around this refusal; let it expire normally.
- One POST to verify returned HTTP 403. The helper stopped without retry. No
  verification result was fabricated; stopped.json records the failed endpoint call.
- Subsequent authenticated GETs show 35 unchanged requests (33 completed, one failed,
  one reconciled), zero new request IDs, zero in-flight/unresolved requests and
  unchanged qualification states. Rolling daily use remains 24/40 with 16 slots.
- Credits remain confirmed_off. No spending caps, provider credentials, model access,
  production code, installed candidate or qualification grades were changed.

## Cause and preparation error

The response body for the failed POST was not retained by the helper; the observed
fact is HTTP 403. A later GET-only diagnostic replayed the same request through the
actual compiled admission rules using current saved connection/access/grant/usage.
It found exactly one blocker: **“This model is already verified on this path.”**
The saved access record already verifies gpt-6-astra/responses from October 20.
The grant is otherwise matching, unused and unexpired at diagnosis.

Source: packages/domain/src/plan-admission.ts, verification branch; the store checks
these blockers before consuming a grant or inserting a provider request. The
[refusal diagnosis](../tracking/evidence/approved-availability-check-2026-10-22/refusal-diagnosis.json)
records that reproduction and request-count evidence. This establishes local
admission refusal, not provider refusal, quota exhaustion or an uncertain upstream
delivery. No new unknown outcome requires reconciliation.

The proposed recovery procedure missed this existing verified-model restriction.
That was a preparation error, not evidence that provider availability had reset.
The earlier proposal in DISCOVERY_STARTUP_READINESS_2026-10-22.md is superseded as
an executable recovery procedure. Its existing endpoint cannot recheck this
already-verified model. No retry, second grant, access deletion, model switch,
qualification-as-probe or paid fallback was attempted.

## Checks and next eligible work

Before execution: exact source/freeze checks, JavaScript/PowerShell syntax and
static one-request scope check passed. Actual API calls executed authenticated
quota reset and grant creation, then refused verification; these are not counted as
a successful provider check. Follow-up GET-only contract parsing and pure admission
replay passed. No new acceptance tests or successful live checks are claimed.

Next eligible **local implementation**: design an explicit owner-authorized
availability recheck for an already-verified model. Preserve the original verified
access and exhausted observation, use a fresh single-use scoped grant, enforce
unchanged caps/credits/privacy rules, and distinguish local rejection, upstream
quota refusal, unknown delivery and successful availability observation. Keep
ordinary initial-verification restrictions intact rather than deleting the guard.
Add meaningful admission/concurrency/retry tests, freeze a new exact candidate/plan,
and review the affected bindings before proposing another live action.

This is a necessary versioned repair to the recovery procedure, not authority to
change runtime policy or repeat the stopped operation now. The original no-retry
scope and follow-up suite's fresh-available gate remain enforced. C54 stays partial.
