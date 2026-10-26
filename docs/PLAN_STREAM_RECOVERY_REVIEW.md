# Plan stream timeout and reconciliation review — October 21, 2026

Execution update: the owner subsequently authorized the concrete decision.
[Reconciliation/failed closure completed](V4_TIMEOUT_RECONCILIATION.md), with no
new model calls. The review below records the pre-decision state.

The retained v4 request proves partial provider activity and a local deadline,
not a complete result. It remains unknown; no reconciliation or new live request
was performed. Read-only API/database comparison confirms the exact request,
24 total requests,26 audit events,0 workflows and1 unresolved outcome unchanged.
The installed v4 manifest remains
`115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1`.

## What was reproduced and repaired locally

The deterministic loop was `node --test tests/dist/plan-stream-recovery.test.js`
after compiling with installed TypeScript. Before repair, CRLF completion produced
unknown rather than completed, and a completed-event fallback larger than the
output cap was accepted. An independent truncated-stream control correctly remained
unknown. A disposable-store test also reproduced acceptance of did_not_run despite
observed output. These are actual local defects, not proof of the live timeout's cause.

Three hypotheses remain consistent with the retained live record: provider stalled
before completion, completion framing was not recognized, or the transport was
interrupted. No wire trace or complete payload was retained, so the exact live
cause cannot be established or replayed. The1653 observed characters cannot now
be reconstructed; a response ID is not a substitute for a completed artifact.

Changes implemented in source:

- Incremental normalization accepts LF, CRLF and CR across arbitrary chunk boundaries.
  A split CRLF does not introduce a spurious blank line. This follows the
  [WHATWG event-stream line-ending rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).
- The same output-character cap now applies to text carried only in a completion
  event. No timeout, request cap, credential scope or qualification threshold increased.
- Owner reconciliation rejects did_not_run when durable output_chars is positive.
  The connection/request locks make the evidence check and update atomic. Zero or
  missing output is not proof that execution did not occur; the owner still records
  the actual outcome with a note. The guard grants no automatic ran reconciliation.

Tests cover byte-fragmented line endings, completion fallback cap, a real loopback
HTTP stream stalled after partial output, interrupted streams, duplicate logical
operations, durable observed metadata, negative reconciliation, explicit owner ran
reconciliation, API and worker behavior. Non-workflow duplicate requests are refused
with DUPLICATE; they are not automatically replayed. Existing workflow replay tests
retain their separate idempotency behavior. No broad request retry was introduced.

All36 affected tests pass,0 failed/0 skipped on disposable PostgreSQL and loopback
stand-ins. TypeScript passed; the test cluster is stopped. Evidence:
`tracking/evidence/plan-stream-recovery/tests.tap`, postrun-state.json and result.json.
Five historical locks and the exact live unknown record are preserved. The repaired
source has not been packaged or installed and has no live verification. Source
changes intentionally invalidate prior execution source hashes; never rewrite them.

## Concrete reconciliation decision for review

Request `50fcd841-85c1-4abd-9591-e18655538a2f`, response
`resp_0306953cb8a7ff12016ad85ed6ed9c87d1a478817473f4ca98` has1653 observed characters
and no complete result. The supported owner decision is **ran, without usable
result**, not successful completion. Proposed note: “Partial response activity was
observed before timeout. No complete result/hash was recovered. This records
activity only, not success, acceptance or permission to retry.”

If adopted through the owner reconciliation command with the then-current connection
version, retain the request and its metadata as reconciled, then finish qualification
`887288bb-ce7f-4edb-b11f-7f1494b146e3` as failed under its unchanged floor:3/4 held-out
accepted, one unknown/unaccepted. This does not grade the missing answer as a schema
failure or erase the original timeout evidence. No new requests are needed for
reconciliation/closure. Do not infer an owner decision from this proposal.

No implemented retrieval observer or provider-approved recovery endpoint exists in
this adapter. Do not invent one, obtain wider credentials, resend the assignment,
or silently extend its frozen timeout. Retained store:false configuration is not
evidence that a usable result can be fetched later.

Next eligible step: decide the explicit ran-without-result reconciliation and
failed-qualification closure; separately prepare a hash-bound repair installer and
prospective qualification proposal. Keep v4 locked and exposed results diagnostic.
Fresh packets/criteria and any supported bounded retrieval must be decided before
further live evaluation. Independent substantive review remains pending; C54 partial.
