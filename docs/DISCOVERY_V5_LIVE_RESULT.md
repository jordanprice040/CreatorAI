# V5 test result: provider quota stop — October 21, 2026

Jordan explicitly authorized additional test slots. Temporarily raised the studio
daily cap40→42, accepted its exact settings, and executed the previously approved
v5 suite with a separate [capacity amendment](V5_TEST_CAPACITY_AMENDMENT.md).
Original plan, installed candidate, cases, scorer, deadline and first-failure rule
remained unchanged. No credits, paid fallback, new permissions or retry were enabled.

Original plan hash:
`68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d`.
Amendment hash:
`19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d`.

## Observed result

Eleven new requests attempted; ten completed and passed automated checks. The
eleventh failed after streaming began because the provider reported
`subscription_sharing_usage_limit_exceeded`, quota exhausted. The runner stopped
immediately; no retry or subsequent class dispatch occurred.

| Class | Result | Qualification |
| --- | --- | --- |
| Research synthesis | 2/2 development,4/4 held-out accepted | `ff7ae4f1-117f-4773-be46-b39f3c18ff53`, operational contract qualified |
| Candidate generation | 2/2 development,2/4 held-out accepted; one quota failure and one unattempted | `b90d89e8-cb58-46b3-80c5-4a58af019ad0`, failed |
| Scoring | Six unattempted | No new qualification |

Failed case: `design-held-costume-coordinator`; request
`7fe8f598-e299-4e55-9fdf-8d47c79a9cde`, response
`resp_05422295dcf3162c016ad869f76df487d1bb441920a7ea75be`. Output characters0,
retry_allowed=false. There is no completed answer to grade for content. The candidate
qualification's2/4 tally is not two observed content failures: two answers passed,
one provider call failed, and one case was not dispatched. Seven total cases remain
unattempted (revision plus six skeptic cases).

The first ten completed answers retain source dependence and synthetic limits,
conditional transfer, existing-tool fit, untested phonetic checking, physical process
change and human interpretive authority. Author observations are bound to exact
output hashes in author-review.json, separate from independent substantive review.
The latter remains unperformed. Contract passes do not establish real-world usefulness
or that the earlier v4 timeout's exact cause was fixed. Full discovery/C54 is partial.

## Restoration and verified saved state

The temporary daily cap was restored to40 through owner settings/accept-caps commands.
Settings hash is again
`5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533`;
credits remain confirmed_off. The restore helper's original final assertion expected
zero blockers and therefore errored after the successful settings change: provider
quota is an independent blocker. Read-only API/database verification confirmed both
restoration and quota exhaustion without repeating the mutation. The local helper
was corrected to preserve provider quota during restoration, and the recovery is
explicit in cap-restore-receipt.json.

Verified35 total saved requests:33 completed,1 failed,1 previously reconciled.
Zero in flight/unresolved/leased/workflows;36 audit events. Provider quota remains
exhausted. The installed manifest and all58 resources match
`0331d863e67859d0338e4f54560e12a020f16923730b47ed82411743474707d9`;
all183 original source bindings and supplemental runner hash still match. No
installation, migration, search, product build, pilot or further inference followed.

Increasing a studio cap does not create provider plan allowance. No reset time was
supplied in the observed response. Do not clear the quota observation, switch accounts,
enable credits or repeat the frozen run to work around this stop. Additional live
testing requires actual provider availability and a prospective scoped decision.

## Evidence and next eligible work

`tracking/evidence/discovery-qualification-v5/` retains execution-intent,
raw-results, substantive-review, decisions, stopped, postrun-state, author-review,
execution-outcome, capacity authorization and cap increase/restore intent/receipts/
locks. Original preparation result.json is historical; execution-outcome.json is
the live result. Keep v5 run.lock plus five older locks and reconciliation lock.
Never rerun this frozen version as fresh evidence or relax its grades after results.

Next eligible work is offline review of completed artifacts and remaining
qualification coverage. The research portion is narrowly qualified; candidate
generation and scoring remain incomplete. Prepare any future evaluation prospectively
after considering quota availability and review findings; no automatic new suite,
workflow, search, build or pilot is authorized by the two-slot increase.
