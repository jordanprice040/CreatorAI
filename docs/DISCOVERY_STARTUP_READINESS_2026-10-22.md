# Saved studio startup/readiness — October 22, 2026

Started the installed desktop normally at its existing user location. Supervisor
log records managed PostgreSQL and service startup, followed by removal of an
expired or revoked local-owner session. The owner signed in through the desktop;
no session was fabricated, no other credential was substituted and provider OAuth
was not changed. An authenticated GET-only inspection then succeeded.

The [inspection receipt](../tracking/evidence/discovery-followup-v1/authenticated-readiness-c85abbd6-edcb-4754-a98f-e18d998f17d7.json)
records health, settings identity, caps, saved quota, usage and qualification summary.

| Gate                        | Observation                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Service                     | Healthy, persistent PostgreSQL; portfolio scheduler off                                   |
| Owner session               | Restored by the owner; authenticated GET succeeds                                         |
| Settings                    | Hash matches the exact follow-up plan                                                     |
| Credits                     | confirmed_off                                                                             |
| Studio daily allowance      | 40 maximum; 24 used in rolling 24 hours; 16 remaining versus 12 needed                    |
| Active/unknown requests     | Zero in flight and zero unresolved                                                        |
| Saved requests              | 35 total: 33 completed, 1 failed, 1 reconciled                                            |
| Saved provider quota        | exhausted, subscription_sharing_usage_limit_exceeded; observed October 21 at 03:29:59 EDT |
| Fresh provider availability | Not established; this was a local read, not a provider request                            |

The health endpoint's legacy fixture provider summary is not the separate plan
connection's qualification/availability state. No synthetic response was substituted
for live evidence. Prior qualifications and settings were not promoted or changed.
Startup runs the normal maintenance worker; this inspection made no model calls,
quota reset, qualification dispatch, spending change or migration. The app remains
running for the owner.

## Concrete next decision: one bounded availability check

The current code has no read-only provider-allowance endpoint behind this adapter.
An owner-authorized quota-recheck records unknown; only a completed provider outcome
records available. Therefore another local GET or elapsed time cannot satisfy the
follow-up runner's fresh-available gate.

Proposed action, **not executed or authorized by this startup inspection**:

1. Re-read the same connection and require matching settings, credits off, no unknown
   or active requests and at least one available studio slot. Stop on any other
   connection blocker; inspect its specific cause rather than bypassing it.
2. Preserve the current exhausted observation in a new receipt, then use the existing
   authenticated quota-recheck command with a fresh expected version. This clears
   only the saved quota observation to unknown, not the actual provider limit.
3. Create one existing one-shot verification grant for the same connection/model,
   responses path, expiring in 10 minutes; do not reuse or expand an old grant.
4. Invoke existing verify once. It sends only the built-in synthetic connection
   check asking for exactly `ok`. Existing limits remain 120 seconds and 16000 output
   characters maximum, one concurrent request, daily cap 40, credits off and zero
   new metered spend. No private research, source text or generated code is sent.
5. Save the request/outcome and read back quota/usage. Stop on failure, refusal,
   unknown, cancellation or provider limit. No retry, credential switch, credit
   activation or paid fallback. Unknown delivery requires normal reconciliation.

Exposure: at most **one new provider request** and no qualification requests. The
current 16 slots would become at most 15 without other usage; fresh admission remains
authoritative. Subscription quota consumption is not free capacity. A successful
check establishes observed model access/availability, not discovery quality.

No automatic 12-case suite follows. That suite still needs its separate exact-plan
execution decision and fresh preflight (including all applicable request caps,
installed identity, no active work and available observation within 15 minutes).
An already granted one-shot check is not permission for a second one if that
observation later becomes stale.

Checks for this step: actual authenticated GET response parsed through
PlanConnectionDetailSchema; JavaScript and PowerShell syntax passed; no runtime
changes or new acceptance tests were necessary for the GET-only helper. Initial
missing-session inspection was a real failed attempt; it is not counted as a pass.
