# Explicit availability recheck — October 22, 2026

**Implemented, installed and narrowly live-verified.** Exactly one newly approved
provider request completed, with two output characters matching the hash of `ok`.
No retry or qualification suite followed. This establishes observed plan/model
availability at that instant, not sufficient remaining provider allowance for a
larger workload, discovery quality or overall product readiness.

## Behavior and authority

Initial model-access verification still refuses an already-verified model. A new
availability_recheck request requires an intent-bound, unexpired, unused one-shot
grant for the same connection/model/Responses path, plus existing verified access.
Legacy grants default to model_access and cannot authorize availability checks.
The new request is synthetic, has no task/run/build/qualification, and uses only
the fixed built-in connection-check prompt. Callers cannot supply arbitrary text.

Existing accepted caps, data permissions, credits-off, daily/concurrency limits and
unknown-outcome blocking still apply. Grant consumption and request creation share
the transaction/connection lock. Unknown delivery cannot be replayed, including with
a new grant. Successful availability settlement records the observation and emits
availability_checked; it does not overwrite established access or qualifications.

The authenticated API exposes availability-recheck. Models chooses the appropriate
check intent and pins the approved model to its grant. Existing CLI initial-access
commands are unchanged; availability currently uses the API/UI. No credentials or
fallback providers were added. Migration 28 adds grant intent/defaults and the
explicit request purpose without changing historical migration SQL.

Owner authorization: “Start with that next step, and I approve you testing again
with that.” This covered the local repair and one newly bounded live recheck.
The previous stopped operation and its lock were preserved; its unused legacy grant
was not repurposed. No approval for the 12-case discovery suite is inferred.

## Executed verification

- TypeScript build and production UI typecheck/build passed. Existing Vite chunk-size
  warning remains.
- 29 affected tests passed, zero failed/skipped, on a separate disposable PostgreSQL
  cluster and loopback provider fixtures. Tests execute authenticated HTTP through
  actual service/store admission, including intent/model mismatch, missing CSRF,
  unverified model, expiry, concurrent one-grant use, quota refusal, cut-stream unknown
  outcome, preserved access and no redispatch. The test database was stopped afterward.
- An initial fixture assertion expected the provider's input as a string. It was
  corrected to assert the actual exact user-message array; the final 29-test run
  passed without weakening production checks.
- [Separate model review](AVAILABILITY_RECHECK_REVIEW_2026-10-22.md) supported the
  bounded repair and found no material bypass. It is not independent human acceptance.
- Desktop packaging passed after a sandbox DNS failure was resolved by using the
  permitted host build and existing pinned tools. Installer hash:
  9cfacf012273627828da5a47d8834a9517ed0b3d7b9d467c907ca543752504f3.
- Verified a 68-file predecessor program rollback. After owner-confirmed graceful
  Quit, the pinned installer exited zero. Installed manifest and all 61 runtime
  resources match 82fa93fcc6783c7aa6db33b9ac94c00a2cb82d9b92ec4458d29cfe8116a509f7.
- A native-executable identity check initially failed against the loose build binary.
  Extraction from the exact pinned NSIS installer proved the installed executable
  matches the packaged binary, SHA256
  2d007429953fab03eb0adf7131b13158282920a66a9b01b9ce62704aef858652.
  The different loose-build hash is retained, not silently substituted in the plan.
- The supported installed backup/migrate command applied schema 27→28. The custom
  dump passed the supported archive-list check and its SHA256 was independently
  verified. This step did not perform a new restore rehearsal. Before/after queries
  confirmed original requests, grant fields, access, qualifications and settings.
- The app restarted normally and retained the owner session. No extra sign-in,
  credential copying, spending-cap change or activation occurred.

## One live request and receipt recovery

[Final read-only verified result](../tracking/evidence/availability-recheck-live-2026-10-22/final-result.json)
supersedes the helper's stopped receipt for reporting the outcome, while preserving
both. Request abf94f01-938e-4de7-b1a5-671f5f4478d8 used grant
4232244c-8d65-4cd6-9615-45ca54da2f32 exactly once. Provider response:
resp_0d6509ea9389a29a016ad9946a5e2c87d192cd58712be7f5ca.

The provider call completed at 00:43:24 EDT October 22. The adapter observed five
output tokens and two characters; the stored output hash matches `ok`. Quota was
recorded available at that time. Rolling studio usage was 25/40, leaving 15 slots;
provider remaining allowance/reset time was not measured. Credits remain confirmed_off.

The execution helper then incorrectly asserted grant_id on the API request summary,
whose schema omits that field. It stopped after the successful request. A separate
read-only SQL finalizer verified the actual persisted request/grant binding, used=1,
exactly one additional request, and all preservation invariants. It issued no second
provider request. The original script, source binding, stopped receipt and lock remain
as execution evidence; do not rerun that helper or reuse its approval.

Saved state after finalization: 36 requests (34 completed, one failed, one reconciled),
zero in flight/unresolved, no leased tasks. Exact hashes prove the original 35 request
records and prior grant fields/access/qualifications unchanged. Settings hash remains
5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533.

Evidence roots:

- [Implementation, candidate, rollback, migration and tests](../tracking/evidence/availability-recheck-implementation/)
- [Separate repair review](../tracking/evidence/availability-recheck-review-2026-10-22/)
- [New one-shot execution and finalization](../tracking/evidence/availability-recheck-live-2026-10-22/)

Candidate-plan canonical hash:
4d915e9ca439fb7c777696c876a1ebac4c28e967e81f3035ac08fdf105e6945f.
It binds 200 source/artifact files; packaged-identity.json adds the installer-payload
desktop identity without rewriting that plan. Source repairs intentionally invalidate
the original historical execution-source guards; no frozen v5/follow-up hashes changed.

## Limits and next eligible prompt

Full discovery/C54 remains partial. There are no new candidate-generation or scoring
qualification answers. The old follow-up runner requires schema 27 and predecessor
source hashes; it must fail against this candidate. Do not patch its historical
guards in place or assume this small successful call guarantees a 12-case quota.

Next eligible offline work: prepare a new prospective execution binding/review for
the still-unattempted 12-case packet on schema 28/current candidate. Assess affected
evidence and rerun applicable offline checks without reclassifying old successes or
exposing target answers. Preserve packet bytes and old plans; no need to invent fresh
cases solely to fix execution identity when no target outputs exist and role/prompt
semantics are unchanged. Then obtain a scoped suite decision and fresh preflight.
If availability is stale, any further one-shot live recheck needs its own applicable
authorization; this completed approval cannot be reused. No automatic next milestone.
