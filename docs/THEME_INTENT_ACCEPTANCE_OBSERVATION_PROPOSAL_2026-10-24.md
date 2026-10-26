# Theme-intent acceptance observation proposal — October 24, 2026

Status: proposed contract only. No inspector implemented or operational inspection
executed. No launch, sign-in, database access, helper execution or shutdown action
is authorized here. This accompanies checklist v3; v2 and all frozen packages and
helper bytes remain unchanged. The author prepared v3 and cannot independently
review it.

## PR-01: bounded prelaunch identity and continuity observation

Purpose: report current stopped-state and identity observations without starting
any service. This cannot observe a nonexistent process's live scheduling state.
No result is to be labeled live_scheduler_off or continuous_zero_dispatch.

A future implementation/review scope would bind candidate and installation plan,
v4 review, installation receipt, historical shutdown receipt, exact installed
native/manifest/resource map, exact managed cluster directory and configured port.
Resolve allowlisted locations from already reviewed plan identities, never by
recursively following arbitrary paths in a receipt. Refuse symlinks/reparse points,
identity mismatch, missing access, ambiguous ownership or unexpected paths.
No retired checkout, personal browser/session or broad filesystem search.

Proposed reads, each separately named in the later operational scope:

- Hash only exact installed native, manifest and its reviewed runtime resource
  allowlist, comparing to historical installed identities; no execution/import.
- Read exact cluster PG_VERSION and run only the bound PostgreSQL pg_ctl status
  command for the exact nested postgres/data directory. No connection, password,
  environment-secret loading, SQL or DPAPI. This command is a future operational
  read, not executed now. Distinguish documented stopped status 3 from errors;
  missing/invalid cluster or tooling is unavailable, not stopped.
- Inspect configured database and loopback studio API/web/preview port listeners,
  plus exact app/service process identities and helper lease presence. Use narrow
  OS metadata, never dump command lines, environments or unrelated processes.
  If service identity requires private command-line examination, compare in memory
  against the exact allowlist and emit booleans/counts only. If attribution remains
  ambiguous, stop; absence of an executable-name match is insufficient.
- Obtain named operator attestation of intervening launches, other producers and
  identity/configuration changes since the historical receipt. Record unknown
  intervals honestly. OS observations do not establish uninterrupted history.

Emit times, exact input hashes, expected identity matched booleans, exact scoped
counts, status codes and explicit unavailable/error fields. No config bodies,
connection strings, usernames, tokens, cookies, approval codes, log contents,
SQL rows, secret-file bytes or unfiltered OS output in evidence. Do not read
studio.json or credentials to rediscover values. A missing reviewed port/path
binding blocks the observation rather than widening access.

Suggested bounded sampling: one initial sample and one confirmation one second
later, both complete within 15 seconds; any unavailable/positive/changed result
fails. No continuous-monitoring claim. No state-changing subprocesses, retries of
mutations, cleanup or process termination. An inspector writes only its new
session evidence directory, using exclusive creation, and never reuses history.

PR-01 can support current identity and stopped-state observations and a clearly
labeled continuity attestation. It cannot prove current database quiescence,
workspace membership, absence of all producers or live scheduler state. An
unexplained continuity gap remains blocked; do not rerun upgrade preparation or
start a database under this proposal to fill it.

## SH-01: bounded observation after explicit Quit

Reuse the reviewed PR-01 stopped-state subset for exact cluster, app/service
processes, listener ports and upgrade leases. No installed-file rehash is needed
unless identity changed or became uncertain. After the separately authorized Quit,
allow up to 90 seconds from recorded Quit request, sampling at most once per
second; stop at the first two consecutive complete stopped observations at least
one second apart. This allows the native 20-second child grace period and the
60-second database stop timeout; it is an observation deadline, not permission to
stop anything. Implement observations asynchronously with bounded tool waits.

A pass requires pg_ctl status 3, no scoped listeners, no attributable desktop or
service processes, and no helper lease, with no unavailable result. Record both
samples and exact timestamps. Contradictory evidence, timeout or inaccessible
metadata means unknown/blocked. Exit code 0 from the app and log text alone never
pass SH-01. A later restart invalidates the prior stopped observation. SH-01 is
point-in-time evidence, not whole-database preservation or zero-dispatch proof.

## Scheduling gate: required decision and control alternative

Inspected source clears inherited child environment, constructs a fixed service
environment, defaults portfolio scheduling off and workflow worker on. This is
configuration evidence only. PR-01 does not resolve the frozen live scheduling
stop rule. Reading /api/health after launch is too late to justify that launch.
No currently reviewed prelaunch observation path was found that closes the gap.

Keep acceptance blocked. If live runtime state or continuous prevention remains
the required claim, propose a separate startup admission mode that defaults to
refusal before actor ensures, sweeps, outbox projection, worker/scheduler start or
listening. Any acceptance mode must be explicitly owner-selected, bound to a new
candidate, restrict all execution entry points and external worker admission, and
emit nonsecret effective-state evidence before work is allowed. An off flag or
health label alone cannot establish prevention. Preserve ordinary production
behavior and existing resource/authority enforcement. This is a design option,
not an accepted ADR, implemented mode or change to the current package.

Before implementation, bound the exact entry points and allowed theme/auth writes,
then review negative admission, startup ordering, restart/relaunch, external worker
and accidental normal-mode fallback checks in a disposable environment. A changed
candidate needs fresh identity-bound packaging/review and an explicit installation
decision; never silently patch the installed program or change its environment.

## Proposed next review prompt

Read U01/U02, checklist v3, exact-v2 review, this proposal and its hash receipt.
Declare involvement; a v3/proposal author must not claim independent support.
Assess the NI-04/final Quit correction and PR-01/SH-01 exact read bounds, process
attribution, timing, secret redaction, no-launch behavior and unavailable results.
State that source-derived scheduler-off is not live observation; determine whether
any already reviewed authorized path closes M1. Otherwise retain the blocker and
review the startup-control design option without granting implementation or
activation. Preserve frozen artifacts; no operational reads or acceptance session.
Produce per-gate support/partial/blocked verdicts and an exact-input review receipt.

After independent review, the next implementation selection may cover the bounded
inspector only; runtime execution requires its concrete reviewed scope. Scheduling
control work requires a separately selected candidate-changing implementation.
Existing workspace/current owner-editor, continuity and bounded session decisions
remain pending; default A/B retention, separate R scope and Jordan H are unchanged.
