# Initial ChatGPT-plan summarization qualification

Prepared October 20, 2026 for Jordan's explicit request to prepare and execute this
next step. Model: `gpt-6-astra`, direct Responses through the existing real studio
connection. This does not authorize other model runs or change the daily caps.

## Frozen scope

Manifest: `config/connections/benchmarks/summarization-synthetic-v1.json`.
Eight synthetic event notes: two development and six held-out cases. The checks
cover complete/missing facts, final corrections, tentative status, cancellation,
unresolved conflict, embedded source instructions and distracting background facts.
All six held-out cases must pass (floor 1/1, minimum six). No adaptation or retries.
Expected values and splits were authored and frozen before target-model dispatch.
The author sees the labels; the target model receives only the case instructions
and source note. These cases must not be reused as independent fresh evidence in
a later study or after tuning against their results.

Each output is a compact structured summary with exactly four fields: event, when,
where and status. The existing exact-label checker compares canonical JSON text;
missing/incorrect facts, extra prose or fields, and noncanonical formatting fail.
This deliberately strict initial check measures constrained factual summaries and
format compliance. It does not establish general prose quality, fairness, customer
usefulness, independent review, or thesis outcomes. The product gate is named
`summarization`; interpret that broad UI label in light of this narrow manifest.
Specification and code-build qualifications remain separate.

## Limits and executed path

At most eight new model requests, sequential, synthetic data only; no retries,
credits or paid fallback. The connection's existing admission rules and caps remain
authoritative. Preflight requires current owner authentication, one verified real
connection, no blockers/unresolved requests, and headroom for all eight requests.
The connection's actual timeout and output-character limits are saved in intent.json.
The manifest's 250 output-token value is metadata: this plan adapter does not send
max_output_tokens; the actual deterministic output bound is the connection's character
cap. Eight cases bound dispatch exposure even if every request reaches that cap.

`scripts/qualify-plan-summarization.mjs` performs 40 offline schema/scoring assertions
and freezes file/canonical hashes. The qualification is created through the existing
authenticated API. Execution uses the same PlanConnectionService.invoke admission,
vault, provider adapter, scoring, settlement and finishPlanQualification domain paths
as the built-in run endpoint. This runner additionally saves each returned synthetic
output/outcome because the built-in endpoint returns aggregate results only. It makes
no direct SQL changes and never prints credentials. A persistent exclusive lock
refuses a second execution, including after failure; investigate before any new run.

## Commands and receipts

From `C:\dev\creator_agent`, with the installed studio open and signed in:

```powershell
# Preparation only, no model calls. Refuses to overwrite an existing freeze.
node scripts/qualify-plan-summarization.mjs --freeze

# Sends the eight requests only if preflight passes. Refuses an existing run.lock.
powershell.exe -NoProfile -File scripts/qualify-plan-summarization.ps1 -StudioHome 'C:/Users/jorda/AppData/Local/com.creatoragent.studio'
```

These commands document the authorized execution; do not rerun the completed
benchmark. The PowerShell wrapper unlocks only this studio's existing local session
and database credential with Windows DPAPI and passes them to the runner over stdin.
No environment dump, credential copying, new sign-in or registration is involved.

Receipts: `tracking/evidence/plan-summary-v1/freeze.json`, `intent.json`,
`qualification-created.json`, `raw-results.json` and `result.json` (or `stopped.json`).
The database stores immutable case request IDs, hashes, signals, totals and the
qualification decision. Raw synthetic outcomes are retained alongside those records.

Refresh System → Models and connections and inspect Qualified tasks. A qualified
entry means this manifest passed; it does not launch a discovery run or build.
