# Follow-up execution binding v2 — October 22, 2026

Prepared **offline, not dispatched**: the unchanged 12-case packet is bound to the
installed schema-28 repair. No case, prompt, assertion, split or acceptance floor
was changed. This is a new execution identity, not new cases or a resumption of v5.
Full discovery/C54 remains partial until missing live role evidence is obtained.

## Exact proposal

| Binding                               | Value                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| Execution-plan canonical hash         | 22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2 |
| Original packet-freeze canonical hash | 55da91cabef9163692508132e936b9a2e5df9815f071ca93642db0cd091f2266 |
| Runtime manifest SHA256               | 82fa93fcc6783c7aa6db33b9ac94c00a2cb82d9b92ec4458d29cfe8116a509f7 |
| Packaged/installed desktop SHA256     | 2d007429953fab03eb0adf7131b13158282920a66a9b01b9ce62704aef858652 |
| Schema / role                         | 28 / r02-discovery/1.3                                           |
| Model                                 | gpt-6-astra on the existing saved ChatGPT-plan connection        |
| Frozen bindings / installed resources | 259 / 61 verified                                                |

[Execution plan](../tracking/evidence/discovery-followup-v2/execution-plan.json),
[preparation result](../tracking/evidence/discovery-followup-v2/preparation-result.json),
[prospective output-review plan](../tracking/evidence/discovery-followup-v2/review-plan.json),
and [offline tests](../tracking/evidence/discovery-followup-v2/tests-final.tap).

The original freeze contains its historical schema-27 source snapshot. That snapshot
was preserved, not rewritten to appear current. The v2 validator separately verifies
the exact original packet/controls/review bytes and the current reviewed runtime
source bindings. The new plan binds the repair's candidate plan, packaged executable
receipt, migration preservation receipts, one-shot availability result and its own
runner/checker/test files. The old validator still rejects the changed runtime.

The installed native identity uses the exact executable extracted from the pinned
installer, avoiding the previously incorrect comparison with the loose build binary.
No rebuild, installation, migration or production-code change was required here.

## Scope and bounds

Same candidate-generation and scoring manifests as follow-up v1: two development
and four target-held-out cases per class, including the two-finding revision and
identity-specific skeptical review. All 12 remain unattempted in the saved connection
at the authenticated read below. Keep 4/4 held-out acceptance per class. No historical
success is pooled into that denominator; v5's failure/partial outcomes stay intact.

If explicitly approved, dispatch at most **12 sequential plan requests**, no retries,
120 seconds per request and 24 minutes total including preflight overhead. Retain
16000 output characters, 24000 input characters, studio daily cap 40, one in flight,
credits confirmed_off, zero new metered spend and no provider/account fallback.
Existing effective caps can only reduce these bounds. Subscription quota use is
real and shared; studio capacity does not establish provider remaining allowance.

Stop on the first unsuccessful, refused, unknown, quota, deadline, cancellation or
binding-mismatch result. Preserve partial evidence and request IDs. Unknown delivery
blocks subsequent calls and requires evidence-backed reconciliation; no retry. The
exclusive execution lock remains after a start/crash, preventing resumption.

The runner requires the exact new execution-plan approval hash and the exact prior
separate-review response bytes before credential lookup. Fresh preflight rechecks
installed manifest/resources/desktop, schema 28, accepted settings, credits, daily
capacity, no unresolved/in-flight/leased/nonterminal work and no prior attempt of
either manifest. Provider quota must be saved as available with observed_at no older
than 15 minutes. This runner performs no quota reset or availability probe.

No search, workflow, build, pilot, setting change or further milestone follows the
suite automatically. Successful structural grading remains operational evidence;
new outputs still need substantive review against the exact candidate/packet hashes.
Author-visible synthetic cases are not independent thesis holdouts or customer data.

## Executed checks and current observation

Replayed all 108 frozen controls using current compiled production contracts/domain
code. All matched expected behavior, including schema-valid fabricated-benefit
narratives that deliberately expose the substantive-review blind spot. Neither
nonempty revision prose nor passing structure establishes source entailment.

Seventeen offline tests passed, zero failed/skipped. These exercise the actual shared
runner control loop with injected adapters, source/prompt/input identity, stale
schema/candidate/source rejection, exact connection/model scope, unchanged resource
limits, no thirteenth request, first-failure/unknown/cancellation/deadline fencing,
intent-recording failure, and reviewer bindings. The old execution guard's failure
against repaired source was an expected negative check, not a weakened gate.

Serialized manifest creation bodies remain 93537 and 111689 bytes, below 128 KiB;
maximum inputs remain 13468 and 19695 characters. These are local serialization
checks, not a new authenticated ingress test. No provider/DPAPI/database operation
was used by the offline tests.

An authenticated **GET-only** read at 00:52:48 EDT confirmed healthy service,
matching settings, credits off, 36 unchanged saved requests, zero in-flight/unresolved,
25 rolling requests and 15 studio slots versus 12 required. Neither manifest has
been attempted. Saved provider availability was observed at 00:43:24 EDT and was
within the 15-minute gate at that read; it ages and must be checked again at actual
execution. This was not a fresh provider call or a guarantee of remaining quota.
Receipt: authenticated-readiness-34aa2f61-bac7-45d5-8545-e54ebf639f1f.json in the v2
evidence directory. No provider call, quota reset, settings change or activation
occurred in this preparation.

## Decision and commands

Next eligible action is separate model review of this exact new binding, followed
by an owner execution decision and fresh preflight. Prior approval covered one
availability check; it is not approval of this suite. Any additional availability
refresh also needs its own applicable authorization and is not hidden in these 12.

Safe offline checks:

```powershell
node scripts/qualify-discovery-followup-v2.mjs --check
node --test tests/src/discovery-followup-v2.test.mjs
```

Only after the exact suite decision and passing fresh gates:

```powershell
./scripts/qualify-discovery-followup-v2.ps1 `
  -StudioHome 'C:/Users/jorda/AppData/Local/com.creatoragent.studio' `
  -ApprovedExecutionPlanHash '22e7ba4d803e73a42f075cfe211fe77ad315757df586609e40648e177a6fdbb2' `
  -SeparateReviewReceipt 'tracking/evidence/discovery-separate-review-2026-10-22/v5-review-response.json'
```
