# PR-01/SH-01 fixture classification core — October 25, 2026

Status: pure fixture classification implemented and tested; independent exact
review pending. User authorized this bounded next step after the supported
reader-v2/proposal-v4 review. The reviewed reader v2, tests, proposal v4, checklist
v5, M3 decision and all historical receipts are unchanged. Reader N1–N4 remain for
a separately scoped operational adapter; they are not silently repaired here.

## Implementation and interface

scripts/theme-intent-observation-classifier-fixture.mjs exports five pure functions.
Its sole import is deterministic node:crypto hashing. No filesystem, OS, environment,
registry, process, object, network, wall clock or collector callbacks are used.
There is no operational CLI, authorization grant or evidence-file writer in the core.
Tests supply synthetic JSON-like data; inputs are not independently verified evidence.

| Function          | Input                                                                | Output and meaning                                                                       |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| desktopKey        | localappdata_exact, override_unset:true, launch_paths_confirmed:true | fixture:true plus bound/key16, otherwise unavailable with a fixed reason                 |
| mapOpenResult     | exact key-bound boolean and numeric Win32 open result                | success0=present; file-not-found2=absent only if key bound; all other cases unavailable  |
| mapRunValueResult | numeric type-agnostic value-existence result                         | success0=present for any value type; file-not-found2=absent; all other cases unavailable |
| classifySample    | one injected sample described below                                  | fixture stopped/activity/unavailable/incident and fixed reason only                      |
| classifyWindow    | kind PR-01 or SH-01, start_ms, now_ms, ordered samples               | fixture pass/pending/blocked/unknown with fixed reason only                              |

Key admission requires the v4-attested literal ASCII drive-rooted backslash profile
string, no empty/dot/dotdot components, at most one trailing backslash; additional
invalid Windows punctuation is refused. Override-unset and launch-path coverage
must both be explicit true. The implemented join appends one separator only when
needed; it keeps literal spelling until lowercase+UTF8 SHA256 first16. There is no
path resolution or plan-path substitution. Both normal/trailing-backslash branches
and case variation yield d8c7860557013e56. Double trailing backslash, mixed trailing
slash and forward-slash LOCALAPPDATA (Rust reference keys681853bc5104874f,
cf2a5fe779f2e38c and b552bb84152dcde0) are rejected as unavailable. Vector evidence
is inherited from the independent Rust review; these new tests execute JavaScript
classification, not the native application.

Samples require at_ms and one binding_sha256 (lowercase64hex) that binds the exact
scope/identities for that fixture window. It is an injected binding token, not a
hash calculated or verified by this core. availability and identity_matches,
scope_bound, active_home_attested, continuity_attested, other_producers_idle,
key_bound and run_history_reconciled must all be true. launch_during_sampling must
be explicitly false under the v4.1 note's no-attempt meaning; otherwise incident.
run_value must be absent/present, never unavailable. Even current absence does not
remove the continuity requirement.

Required nonnegative safe-integer counts: listeners, desktop_processes,
service_processes, postgres_processes, leases, helper_mutexes, desktop_mutexes,
desktop_events. Missing, string, negative/fractional or unsafe counts are unavailable,
never zero. pg_ctl_status3 plus all zero counts means a fixture stopped sample;
status0 or positive counts mean activity; other status values are unavailable.
The caller must fold ALL required queries into these counts/availability. Omitting
a required target while supplying zero is an adapter error the core cannot detect.
Map functions handle raw numeric codes; the core does not execute those queries.

Window timestamps are injected nonnegative safe integers, not observed time.
Samples must be ordered, within start/now, at least1000ms apart (no faster than1Hz),
with one identical binding token. The last sample must equal now_ms, so stale
last-sample input cannot pass. PR-01 is bounded15000ms with at most16 samples;
any activity blocks. SH-01 is bounded90000ms with at most91 samples; ordinary
shutdown activity resets the stopped-pair count and can be followed by a pair.
Any unavailable result aborts unknown; any launch incident blocks. A pass requires
the final two consecutive complete stopped samples, spaced at least1000ms. Later
activity invalidates an earlier pair. Deadline-without-pair or overrun is unknown,
never an extended window/retry. No samples or one stopped sample is pending only
before deadline. Passing at the exact deadline is allowed if the pair is complete.

All object outputs are fixed allowlists: fixture/status/reason and, for an admitted
key, key16. Error text, config, paths, usernames, codes/cookies, commands and unknown
fields are not copied. Map outputs are fixed vocabulary strings. A fixture pass
is only classification of supplied data: not observed stopped state, independent
review, live scheduler state, continuous prevention, zero dispatch or launch authority.

## Tests and evidence

Windows Node test runner:10/10 test groups, zero failed/skipped, first run.
Command: node --test tests/theme-intent-observation-classifier-fixture.test.mjs.
TAP: tracking/evidence/theme-intent-observation-classifier-2026-10-25/tests.tap.
Coverage: actual trailing-separator branch and admitted/rejected Rust vectors;
not-found/denied/wrong-type/unknown mapping; every required binding/count; Run
continuity; spacing, binding changes, ordering, stale/deadline boundaries; shutdown
activity then stopped pair; restart invalidation; launch incidents and sentinel
redaction. No OS objects, hard links or operational files are touched by these tests.
No previous reader tests were rerun because their bytes/behavior did not change.

## Contract update and remaining work

THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_1_NOTE_2026-10-25.md discloses N6,
requires no attempted launch during sampling and blocks on uncertainty. The core
implements N5's actual join branch instead of a tautological comparison. N1–N4
remain explicitly deferred to a future reviewed operational adapter. No collector,
real-config adapter or PR-01/SH-01 operational inspector exists. Active-home and
continuity attestations, workspace/current owner-editor, port/tool identities,
reviewed scope and explicit operational/session grants remain pending. Full C54
partial; native acceptance and Jordan H unverified. M3 is unchanged.

## Next eligible independent review prompt

In a separate uninvolved U02 session, review this pure classifier/tests, v4.1 note,
frozen proposal v4/checklist v5, prior review, M3 decision and new receipt. Declare
involvement. Rehash inputs with the new check-only verifier (no --record), run only
pure fixture tests if needed, and independently assess admission/join vectors,
open/Run mappings, strict unavailable semantics, every sampling/deadline boundary,
binding stability, redaction and N6 attempt/handle-lifetime implications. Distinguish
injected attestations/counters/times from measured OS evidence. Look for pass paths
with missing or contradictory fields. Preserve prior artifacts. No operational
read, OS/registry/process/object query, real config, launch, provider/worker call,
recovery, cleanup or retired checkout. Produce exact-input report/receipt, actual
checks, per-area verdicts and smallest next scope. Do not implement that next scope
in the review. No reader N1–N4 repair or operational activation implied here.
