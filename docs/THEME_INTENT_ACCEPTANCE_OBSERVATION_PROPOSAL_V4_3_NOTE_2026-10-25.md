# Observation proposal v4.3 note — October 25, 2026

Status: additive contract clarification for pure fixture classifier v3. Preserve
proposal v4, notes v4.1/v4.2, checklist v5, classifiers v1/v2 and all receipts.
This note supersedes conflicting reset/timestamp wording for the next classifier/
collector scope. No operational observation, collector, launch or session grant.
M3's accepted exact-bundle scheduling decision remains unchanged; it is distinct
from review findings that happen to use the same label.

## Restart invalidates the whole SH-01 window (M4)

Once ANY complete stopped sample has been supplied in an SH-01 window, any later
non-stopped sample blocks the whole window as RESTART_AFTER_STOPPED_SAMPLE.
A new stopped pair cannot cure it. This includes activity, contradiction, unavailable
or incomplete subsequent observations; treating all of these as incidents is
conservative, not proof of an actual restart. Do not silently reset the count,
relabel the step or open a new window to erase an incident. Separate reconciliation
is required. Ordinary shutdown activity before the first stopped sample may still
be followed by two complete stopped samples, subject to all existing gates.

Explicit launch attempts anywhere retain the highest-priority
LAUNCH_DURING_SAMPLING result. Immediately after that scan, an object input whose
window launch_during_sampling flag is not exactly false blocks as
LAUNCH_NOT_EXCLUDED, before invalid-shape, contradiction, cap or deadline reasons.
Then the SH-01 restart scan precedes ordinary unknown/shape handling. Thus a known
or uncertain attempt cannot become a read-only re-observation case merely because
another field is invalid. JSON-like data only; executable getters are not inputs.

## One timestamp meaning and separate closure time (L8)

EVERY sample at_ms means the start of that sample's OS query batch, regardless of
its position. Compare only these query-start times for the at-least1000ms spacing
rule. There is no special meaning for the last sample. The future collector must
also avoid overlapping batches and close each batch's handles immediately; this
pure core receives no per-batch closure measurement and does not verify overlap.

The window supplies a separate nonnegative safe-integer closed_ms, the completion
time AFTER all final sample handles have closed. Require:

- start_ms ≤ each at_ms, strictly ordered and at least1000ms apart;
- last at_ms ≤ closed_ms = now_ms;
- closed_ms ≤ start_ms + 15000 for PR-01, or +90000 for SH-01;
- handles_closed:true and launch_during_sampling:false covering the WHOLE window
  through closed_ms, alongside each sample's exclusion flags.

The deadline includes closure and is never extended. No missing/string/negative,
pre-query or mismatched closure time can pass. A query pair can complete before
closed_ms; the interval through closure is covered only by the injected no-attempt/
closure attestations, not a continuous observed state. The core cannot establish
real clock values, handle closure or a lack of restarts between samples. First-sample
promptness and per-target measured events remain collector scope. All claims remain
point-in-time fixture classification, never zero dispatch or continuous prevention.

The v4.1/v4.2 mutex and show-event lifetime caveats remain: open-only is not
effect-free, no create/wait/acquire/release/set/reset, close handles promptly, never
hold them across sample intervals, and no launch attempt during sampling/closure.
Reader N1–N4 and classifier L1/L4 remain future adapter/collector work. No operational
adapter/collector exists. Native acceptance/H unverified; full C54 partial.
