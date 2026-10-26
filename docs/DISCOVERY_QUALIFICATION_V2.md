# Discovery qualification v2 — prepared candidate

Latest execution: [installed v2, zero-dispatch transport stop and prepared repair](DISCOVERY_V2_TRANSPORT_REPAIR.md).
Jordan approved this packet; the candidate is installed, but qualification creation
stopped at HTTP413 before any model call. Earlier preparation status below is historical.

Operational preparation only. No new model calls, installed-app update, saved-studio
migration, settings expansion, search, workflow or pilot launch. The installed app
still uses the preceding candidate. Its failed v1 qualification and earlier summary
qualification remain historical records with their original scope.

## What changed

The production locator uses role version `r02-discovery/1.1` with explicit confidence
anchors: packet sufficiency permits investigation; it does not establish independent
corroboration. Evidence strength describes the bounded observed need, while an
untested intervention remains a hypothesis. The prompt distinguishes exploratory,
insufficient and well-supported observations within a simulation and always requires
limits on real-world inference. Schemas, API money, caps and thesis scoring weights
are unchanged. No database migration is added beyond the already installed schema27.

The version changes the shared discovery prompt binding. All three role classes
require evidence for this candidate; the previous prompt cannot unlock its discovery
workflow. Existing record contents are not rewritten or marked qualified.

## Frozen cases and controls

Manifests: config/connections/benchmarks/discovery-synthetic-v2. The18 fresh cases use
two development and four held-out cases per class. The model receives production
system text and the exact production serialization of user messages, without grader
assertions or gold outputs. Inputs are invented simulation records, not fetched sources
or observed customers. The author saw the labels; this is not independent evaluation
or a thesis holdout. See proposal.json for prospective scenarios and author-controls.json
for local controls and case-specific substantive-review checklists.

| Class                | Cases                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| research_synthesis   | Repeated single-author logs; unobserved rumor; missing denominator; superseded count with independently reconciled correction; obsolete-only report; hostile source instruction           |
| candidate_generation | Existing spreadsheet; bounded offline label checker; naming process; human aesthetic judgment; technician-controlled checklist assistance; withdrawal of unauthorized individual tracking |
| scoring              | Duplicate booking filters (two proposals); unsupported universal benefit; contrary trial; unavailable tree-level data; proportionate paper rota; hostile proposal instruction             |

All three confidence labels have positive controls, and schema-valid wrong decisions
must fail. Schema/extra-field/fixture-output and forged-reference controls remain.
The corroboration case explicitly supplies an independently authored reconciliation
within the simulation; the fact that all inputs are author-created remains visible.
Its corrected count is not evidence of software benefit or actual customer need.

Before any target output, local inspection found that the initial authoring draft
had not tagged the corrected observations as problem evidence. Its packet admission
summary was inconsistent with the intended case. The initial manifests, freeze and
test log are retained in tracking/evidence/discovery-qualification-v2/preflight-draft.
The final preparation corrects those role tags and checks packet admission for every
locator case. This was an offline preparation correction, not tuning after model
results. The final freeze is tracking/evidence/discovery-qualification-v2/freeze.json.

Automated acceptance does not prove that every narrative sentence follows from its
citations. A dedicated negative-control test demonstrates that a schema-valid false
real-world trial claim can evade enum/reference assertions. This remains a documented
limit, not a passing factual check. The execution runner records exact output hashes
and a `required_not_performed` substantive-review ledger. Reviewers must inspect the
case checklist, supplied passages, contradictory evidence, scope/independence and
permissions; retain identity, exact candidate/output hash, findings and disagreements.
Do not use contract qualification as independent substantive approval or usefulness.

## Verification and execution boundary

Offline authoring:108 positive/negative scorer controls passed. Affected test evidence
is tracking/evidence/discovery-qualification-v2/tests.tap:44 passed, zero skipped,
using disposable PostgreSQL and loopback stand-ins. That includes v1 historical
manifest-byte preservation, v2 production transport and confidence controls, stale
role/prompt rejection, authenticated embedded workflow dispatch, cancellation,
concurrency and unknown-result handling. TypeScript and staged production web build
passed; the existing large-chunk warning remains. Native candidate and exact hashes
are recorded in the execution-plan/result receipts. Final staged-service backup-first
upgrade and restore/adoption checks passed on disposable databases. The additional
startup/persistence check failed with PORT_IN_USE on4310 because the saved studio was
already running; its result is retained, and new installed/native acceptance is not
claimed. Sandbox DNS initially blocked the pinned NSIS fetch; outside-sandbox packaging
succeeded. No studio process was stopped to make that optional startup check pass.

## Reviewable candidate and bounded run

- Installer: `apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe`
- Installer SHA256: `1df0f73eb9ad4fe086f749e72e17de02f004c9941c1de5d0585a182cb3def2a6`
- New bundle-manifest SHA256: `733837fe38fd84be6479e02ac1115dededd98a7ca99a644d03b31e72b043897c`
- Existing installed manifest expected before upgrade: `80fe5f7a40e844d6361277dc4c96f33e927cb0527871fe2e863c08b086cdb56b`
- Execution-plan hash: `46186bc4952349c040c70e3d39fab47ee0f6677fc5ac6f9894c95223b065b8e0`
- Exact127 source/compiled/runner/control bindings and target identity:
  tracking/evidence/discovery-qualification-v2/execution-plan.json.

After scoped approval, first check active/unknown work, preserve a verified current
program rollback copy and gracefully quit the saved studio. Install only this exact
candidate, reopen it and verify the bundle/session/records. No new migration or saved
permission change is proposed; retain schema27 and settings hash
`5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533`.
Stop if actual state differs. The protected wrapper, only after approval, is:

```powershell
./scripts/qualify-plan-discovery-v2.ps1 `
  -StudioHome 'C:/Users/jorda/AppData/Local/com.creatoragent.studio' `
  -ApprovedExecutionPlanHash '46186bc4952349c040c70e3d39fab47ee0f6677fc5ac6f9894c95223b065b8e0'
```

Preparation scripts refuse to overwrite frozen artifacts. Do not rerun the generator
against this directory. The old v1 runner and review scripts bind their historical
source snapshot and will reject this revised source; do not edit their hashes to
make them execute again.

The v2 runner uses the same protected DPAPI/stdin and application-owned admission,
quota, grading and settlement paths. It requires the exact approved execution-plan
hash, installed candidate identity, source/compiled hashes, frozen manifest/control
bytes, saved settings equality, no unresolved work and18 remaining daily slots.
A prior failed v1 manifest may coexist; any previous attempt of the exact v2 manifest
prevents replay. The separate exclusive v2 run.lock must be preserved after dispatch.

Proposed live bounds remain18 requests maximum, one in flight, no retries,
120seconds/request,36minutes aggregate,16,000 output/24,000 input characters and
existing40/day studio cap. No new metered spending, paid fallback or credits use.
Shared provider quota may be unknown and can stop the run. Stop at the first failed,
unknown, refused or quota-limited case. An unattempted held-out case cannot count as
accepted and must not be reported as an observed model failure.

Offline validation (no credentials/network):

```powershell
node scripts/qualify-plan-discovery-v2.mjs --check
```

The earlier approval applied to the v1 hash, not this revised candidate or new18-case
run. Next eligible action is review of the exact v2 installation/execution packet.
No further migration or task-permission expansion is proposed. Discovery stays
unqualified until the affected operational gates are satisfied; C54 remains partial.

Latest live result supersedes the earlier ingress stop: [approved repair and schema failure](DISCOVERY_V2_LIVE_RESULT.md).
One new request, no retries; cases/criteria unchanged and discovery unqualified.
