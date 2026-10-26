# Observation proposal v4.2 note — October 25, 2026

Status: additive contract clarification for new pure fixture classifier v2.
Preserve frozen proposal v4, v4.1 note and checklist v5. This note governs the next
classification/collector scope where it is more specific. No operational read,
collector, config adapter, launch or acceptance is authorized. M3's previously
accepted exact-bundle scheduling evidence standard is unchanged (distinct from
review finding M3 below).

## Incident precedence and planned shutdown

An explicit launch_during_sampling:true at window level OR anywhere in the supplied
sample array is a launch incident. Scan the entire array before shape, cap, time,
spacing, binding, availability, contradiction or activity rejection; return
blocked/LAUNCH_DURING_SAMPLING. Do not replace it with an unknown/ordinary-activity
reason that could be mistaken for a read-only re-observation case. A new scope
cannot erase the prior incident; reconciliation is required. A partially malformed
window containing a known launch still preserves that known incident. Inputs are
JSON-like records, not executable getters/callbacks.

SH-01 additionally requires injected running_state_recorded:true, planned_quit:true
and a nonnegative safe-integer quit_request_ms exactly equal to start_ms. Missing,
false or mismatched preconditions return unknown/PLANNED_QUIT_NOT_ESTABLISHED,
never a shutdown pass. This does not establish an independent running-state
observation or permit unplanned-exit recovery. An actual unplanned shutdown still
needs incident reconciliation, not an automatic relaunch/read retry.

pg_ctl_status:0 paired with postgres_processes:0 is contradictory: the cluster
status sees a running postmaster that the scoped process observation missed.
Such a sample anywhere makes PR-01 or SH-01 terminally unknown for that window,
even if later samples look stopped. Explicit launch takes precedence over this
contradiction. This is a minimum cross-field predicate, not exhaustive OS-result
consistency checking. Ordinary noncontradictory SH-01 activity can still precede
a valid stopped pair; unavailable results and all prior stop rules remain.

## Full-window attestation and handle closure (L3)

Use a window-level launch_during_sampling:false attestation in addition to per-sample
flags. It must cover every sample, interval and closure of ALL observation handles,
including after the last query. Missing/uncertain window exclusion blocks. Require
handles_closed:true before completing the window. In the v2 input contract, now_ms
and the last sample's at_ms denote completion of the final sample AFTER its handles
have closed, not the instant of the last OS query. Completion/closure must fit
within the original15s/90s deadline; it cannot extend it. The pure core verifies
only the supplied flags/times, not actual closure or clock readings. A future
collector must supply and bind these semantics; no collectors exist yet.

As v4.1 disclosed, an open mutex handle can prolong existence and suppress a
concurrent desktop launch. An open handle on the show EVENT can also prolong its
lifetime, preserving an earlier signaled auto-reset event. A later First instance
can receive that already-signaled event from CreateEventW and immediately show its
window, including a quiet at-login launch (winsys.rs:55; main.rs wait_for_show).
Neither mutex nor event observation is effect-free. Close immediately; never
create/wait/acquire/release/set/reset, and never retain handles between samples.
No attempted launch during sampling, intervals or final closure is permitted;
suspected/suppressed/quiet attempts are incidents, not proof of harmless absence.
No OS handle is opened or tested by this fixture implementation.

## Admission and remaining limits

Native Home::check_home rejects components beginning with onedrive, ASCII-case
insensitive. New key admission does the same before producing a key; paths such
as OneDrive-work are unavailable. This supplements proposal v4's admitted spelling;
it does not inspect actual home/environment. All prior native key vectors remain.

Per-target result-to-count folding, key-to-binding-token preimage, distinct identity/
namespace/unexpected-lease evidence (review L1/L4) remain for the future collector.
Reader-side N1–N4 remain for a future operational adapter. No frozen parser change,
real OS observation, collector or session authority is introduced. Full C54 partial;
native acceptance and Jordan H unverified.
