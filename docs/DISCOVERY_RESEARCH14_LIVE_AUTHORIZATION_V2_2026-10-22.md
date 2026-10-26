# Research live authorization v2 — October 22, 2026

This is a new proposed operation, not a retry of the locked first plan. No provider requests have been sent under v2. The first attempt stopped on a refused local API connection before grant creation or provider delivery; its plan, receipts and locks remain preserved. Subsequent authenticated GET and read-only SQL checks restored local readiness and confirmed all 57 prior requests were preserved.

The proposed exact combined authorization hash is:
`d567088498d2d0ed111c939113990997ab73cfd50f829736775697724c2223c0`.
The separate one-shot availability plan hash is:
`df52351b7edff8c9fd5493a2f33ab9d47afc681819c2e9e3d3163fe7ad4f8477`.

Authorize at most seven subscription requests on saved connection `7529f8ef-8579-4685-80fc-5df300130667`, model `gpt-6-astra`: first one synthetic availability_recheck with an intent-bound, single-use grant, then at most six research14-v2 locator requests only if all admission gates pass. No retries, quota reset, settings changes, credits activation, metered-spend expansion or credential/provider fallback. Actual subscription usage is shared; studio capacity is not provider remaining allowance.

The availability request has a 120-second configured timeout. The research suite remains bound to reviewed executable plan `a96eed07aa0372e55d7880a62b57f6c0f5726b3ea6c559617af3f9119e11469a`: six sequential requests, zero retries, 120 seconds each, 12-minute dispatch budget, 16,000 output/24,000 input characters and a 4/4 held-out operational floor. The probe is outside the suite deadline; the deadline clamps timeouts and prevents further dispatch, rather than guaranteeing remote reconciliation or process exit at exactly twelve minutes.

Static gates before secret access bind the new exact owner hash and authorization review, all 236 source/artifact bindings, prior failure/readiness evidence, the reviewed research runner, preserved installation receipt, exact installed candidate and all installed resources. The first failed plan cannot authorize this new plan. Runtime requires a valid owner session, matching settings, credits confirmed_off, verified model access, no active/unknown requests and capacity for all seven. After the probe, the suite repeats its actual domain admission, schema/workspace checks, unattempted manifest and availability freshness checks (at most 15 minutes, not future dated). No refresh is hidden in the suite.

The combined/probe operation paths are new. The unchanged research suite path has no run lock and has never started; its original exclusive lock and manifest-attempt rules remain. Combined, probe and suite locks persist once started; no replay/resumption or lock removal is allowed. Stop on the first refusal, failed/unknown delivery or contract failure, preserving partial evidence for read-only reconciliation. Structural success still requires substantive output review and is not human acceptance. No workflow, search, pilot or next milestone follows automatically.

Executed local checks: four standalone and four compiled admission tests passed, including actual wrapper refusal of the previously approved first-plan hash before secret lookup; TypeScript build, PowerShell parser and exact static installation/runner gates passed. Separate review is recorded in the matching review report and receipt before requesting a new owner decision. This proposal and the prior authorization do not authorize execution.

Execution entry: `scripts/run-research14-v2-approved-live.ps1`, with the new ApprovedAuthorizationHash and AuthorizationReviewReceipt. Record the new owner decision before invoking it. Evidence is in `tracking/evidence/discovery-research14-live-authorization-v2/`. Current role evidence remains 2/3; full discovery/C54 remains partial.
