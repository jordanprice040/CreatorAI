# Discovery follow-up v2 live result — October 22, 2026

The approved suite stopped at its first scoring case after seven requests. No retry
was made and the exclusive lock remains. No acceptance criterion was changed.

- One separately approved availability refresh succeeded (request
  3d5d5a45-da2c-4a9e-b853-3e9b82256090); settings/access/qualifications unchanged.
- Candidate generation completed 6/6 contract checks: 2/2 development, 4/4 held-out.
  The saved qualification is operationally qualified for this synthetic packet.
- The first scoring development response completed but failed two of nine frozen
  assertions. Five scoring cases, including all four held-out cases, remain unattempted.
  Scoring qualification is failed/incomplete.

Offline replay of the unchanged production checker on the exact saved response
identifies assertion indexes 4 and 8. For P3/C3 the response labeled the unsupported
outcome guarantee weak_evidence rather than the required novelty_overclaim finding.
For P5/C5 it explained the hosting burden and supplied a cheaper comparison, but
labeled the finding counterevidence rather than the required cheaper_test finding.
The response therefore contains relevant reasoning while failing the frozen typed
finding requirements. These observations do not regrade it or establish that the
rubric is substantively ideal; review must distinguish reasoning quality from type
compliance. See failed-case-diagnosis.json for exact assertion replay.

At 05:05:07Z, GET-only inspection confirmed 44 saved requests (42 completed, one
failed, one reconciled), zero in-flight/unresolved, 33 rolling requests, seven studio
slots remaining, credits off, unchanged settings. Seven new suite responses all
completed at the provider; six passed contract checks and one failed acceptance.
Including the refresh, eight new provider requests were made in this operation.

No live suite resumption, retry, prompt change, rubric relaxation, workflow, build
or pilot followed. The original packet/plan/criteria and all prior failures remain.
Full discovery/C54 remains partial. Seven outputs still require substantive review
against the exact packet and candidate before any broader quality claim.

Next eligible prompt: U02 independent review of these seven outputs and the two
scoring assertion failures, followed by a prospective repair proposal if warranted.
Any changed prompt/contract/candidate invalidates affected evidence; future live
qualification requires fresh cases/plan and applicable authorization, not replay of
this locked suite.

Evidence: [live result](../tracking/evidence/discovery-followup-v2/live-result.json),
[raw results](../tracking/evidence/discovery-followup-v2/raw-results.json), and
[diagnosis](../tracking/evidence/discovery-followup-v2/failed-case-diagnosis.json).
