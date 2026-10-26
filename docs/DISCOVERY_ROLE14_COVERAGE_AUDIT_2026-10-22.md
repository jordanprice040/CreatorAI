# Discovery role1.4 evidence coverage audit — October22,2026

Two of three discovery role classes have eligible current-version evidence.
Research synthesis is the remaining qualification gap. No runtime defect or guard
bypass was found and no production change is needed for this finding.

| Class | Historical/live evidence | Current exact admission-filter result | Substantive model review |
| --- | --- | --- | --- |
| Research synthesis / locator | V5 role1.3:2/2development,4/4held-out accepted; saved qualification ff7ae4f1-117f-4773-be46-b39f3c18ff53 | Ineligible under role1.4;retain old qualified record as historical | Six exact old outputs separately reviewed,not new role1.4 evidence |
| Candidate generation / propose+revise | Semantics-v2 role1.4:2/2development,4/4held-out accepted | Eligible under current gate | Six exact outputs/18 frozen criteria supported |
| Scoring / skeptic | Semantics-v2 role1.4:2/2development,4/4held-out accepted | Eligible under current gate | Six exact outputs/18 frozen criteria supported |

The actual compiled ConnectionStore.#discoveryQualifications callback checks
manifest hash,discovery-contract schema,current role version,packet hash,exact
rendered system prompt and required role kinds. Candidate generation must include
both propose and revise. Qualified state is then required by admissionBlockers.
A saved qualified task-class label alone therefore cannot unlock current workflow
dispatch. The full subscription workflow needs all three required classes.

Executed offline: extracted and ran the exact compiled filter callback from
packages/db/dist/connection-store.js in an isolated JavaScript context against the
three saved qualification/manifests. It rejected old research and retained both
current classes. Four negative controls,recomputing manifest hashes to avoid a
trivial hash-only failure,rejected stale role,altered system prompt,stale packet
hash and missing revision coverage. This was not a live API/database admission
attempt. Existing subscription-workflow tests cover stale qualification refusal;
their database integration suite was inspected,not rerun for this audit.

For all six old locator cases,the current rendered system message is identical
after replacing only the role1.3 marker with role1.4. Locator instructions and
schema therefore show no additional textual change in this comparison. This
helps explain the narrow gap,but does not make those outputs new inference under
the current exact prompt or authorize relabeling frozen evidence. The production
gate intentionally requires the current binding. No waiver,record rewrite,case
replay or automatic provider trial follows from semantic similarity.

Eighteen saved output hashes and exact request/output associations with their
separate model-review responses were checked:six old research plus twelve current
design/scoring. Prior failures,qualifications,locks and review placeholders remain
unchanged. Evidence is author-visible synthetic operational verification and
nonblinded model review,not independent human acceptance or causal improvement.
Current installed candidate remains d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf,
manifest621e6f12e37db3baf883c30d76d27a39bbdcba71a8df3a72c32fdfe22ddaa448,
role1.4 prompt c7ba20c798279491da5b3c4818c9e561d1ef65649477a1875630c74206e691f8.
This audit used saved artifacts/local compiled code;it did not re-inspect current
provider quota,installed processes,service status or database state.

Next eligible bounded task:prepare a fresh research-only locator packet for the
unchanged current role1.4 candidate,with2development/4target-held-out cases,4/4
floor,source-fidelity/substantive review criteria and exact input/candidate binding.
Use newly authored scenarios;do not recycle exposed historical targets as
independent holdouts or pool old successes into its denominator. Independently
review the packet/runner before any new exact-plan live decision. A fresh
availability check is not authorized by this audit. No need to rebuild or replace
the current app solely to clear an evidence-version gap.

Closing that qualification gap would still not complete C54. Its remaining product
acceptance requires a real-workspace theme with no existing claims to reach cited
comparison using current qualified routes,permitted evidence collection/search,
visible effective limits/data sharing,and supported build/export/revision through
the in-app flow plus owner acceptance. Those are separate gates,not established
by isolated role benchmarks. Full discovery/C54 remains partial. No provider
calls,workflow,search,installation,settings or grade changes occurred.

[Coverage and bindings](../tracking/evidence/discovery-role14-coverage-audit/coverage.json),
[exact filter snapshot](../tracking/evidence/discovery-role14-coverage-audit/compiled-filter.js).
