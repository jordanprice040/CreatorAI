# Proposed role1.4 live verification — October 22, 2026

Prepared for a new owner decision; no provider request has been sent.
Combined authorization-plan hash:
1fd2ee8f8925af3e31ec7265b25c087e0b6dd021ca1c2183bf946eafc3b1af6f.
This is distinct from every earlier consumed approval.

Proposed scope:at most13 sequential subscription requests on the existing saved
ChatGPT-plan connection7529f8ef-8579-4685-80fc-5df300130667 using gpt-6-astra.
First,one synthetic availability_recheck request with a new intent-bound single-use
grant;120second configured request timeout,zero retries. No quota reset,settings
change,credits activation,new metered spend or credential/provider fallback.
If it fails,refuses,is uncertain or changes protected state,stop without suite.

Only if that succeeds:run the exact independently reviewed12-case semantics-v2
suite under executable-plan4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c,
up to12sequential requests,no retries,120seconds each and24minutes for the suite
including its preflight overhead. Retain16000output/24000input character limits,
cap40,one concurrent request,credits confirmed_off,4/4held-out floor per class.
The probe and suite have separate timeout bounds;the24minute ceiling describes
the suite,not the whole combined operation. Existing effective caps can reduce
these bounds. Subscription usage is real and shared;studio slots do not measure
provider remaining allowance.

Before probe credential lookup,static gates verify exact new combined approval,
supported authorization-review receipt,source hashes,installed role1.4/native/
manifest/all resources,runner review and preservation/backup installation receipt.
Runtime probe checks authenticated session,matching accepted settings,credits off,
no in-flight/unresolved requests,verified model access and at least13studio slots.
Its intent is persisted before the request and only one grant-bound delivery is
attempted. Provider error or unknown stops;no wider-credential fallback.

After successful probe,the suite runner repeats its full installation/auth/CSRF,
schema28,no active/unknown/leased/nonterminal work,new packet unattempted,settings/
credits/capacity and available-observation-freshness gates. The observation must
be no older than15minutes and not future-dated. The wrapper never clears saved
quota. No second refresh is permitted.

Combined,probe and suite exclusive locks remain on start/failure/crash. No replay,
resumption or retry is permitted;unknown delivery requires read-only reconciliation
before any new decision. The first unsuccessful or acceptance-failed suite result
stops remaining cases. Partial evidence,request/output identities and historical
failures remain. Structural passes still need substantive output review. No
workflow,search,build,pilot or further milestone follows automatically.

Local verification:four tests passed through standalone and default compiled
entry;TypeScript build and PowerShell syntax passed. These validate scope/identity
rejection,current installed static gates and actual wrapper refusal of old approval
before secret access. They do not establish provider availability or new model
quality. Independent authorization-package review is separately recorded before
asking for the new decision;this document alone authorizes no request.

Execution entry: scripts/run-semantics-v2-approved-live.ps1 with explicit
ApprovedAuthorizationHash and AuthorizationReviewReceipt. Parent must record the
owner decision matching this new combined hash before invoking it. Neither the
installed app nor the earlier12-suite approval implies this new13-request grant.
Full discovery/C54 remains partial.

[Combined plan](../tracking/evidence/discovery-semantics-v2-live-authorization/authorization-plan.json),
[one-shot plan](../tracking/evidence/discovery-semantics-v2-live-authorization/availability-plan.json).
