# Approved v3 installation and live result — October 21, 2026

Jordan approved the exact candidate and bounded suite with “I approve you moving
forward with that.” Execution-plan hash:
`8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a`.
All 146 source bindings and installer bytes matched. A 51-file program-only rollback
was verified, the app quit gracefully, and the installer exited 0. Current installed
manifest: `907d3d2aae9cbbc56a14dac5b1d84f7400354db8b97967f5fc2ed00c243bee17`.
All 48 installed manifest resources match. Session, schema 27, settings and saved
records survived. No migration or settings expansion occurred.

| Class | Observed result | Qualification |
| --- | --- | --- |
| Research synthesis | 2/2 development, 4/4 held-out accepted | `463406b6-898e-421f-8c03-391a21b020e1`, operational contract qualified |
| Candidate generation | First development case failed; five unattempted | `4e6a8cad-a777-44d9-bf05-aa728545701f`, failed |
| Scoring | Six unattempted | No new qualification |

Seven new gpt-6-astra plan requests completed, with no retry. Stop-on-first-failure
prevented the remaining eleven dispatches. Unattempted held-out cases are not observed
model failures. No workflow, search, build, pilot, metered fallback or credits activation.

## Failure and diagnostic distinction

Case `design-dev-existing-calendar`, request `4df814b9-35af-4bb0-b8a9-b3a911341fdd`,
returned `acceptance_check_failed`. Exact output SHA256:
`e6c8999f056ddf8ea85ffa9d461626718f63a40f6028c5259066deceb9190c86`.

Production schema and relational validation pass. Four of five frozen assertions
pass. The failing assertion requires `novelty === null`; the returned value is:

> Routine use of an existing calendar feature; no originality or demonstrated impact is claimed.

The model-facing schema permits string or null. Role instructions prohibit overclaims
but do not require null for this circumstance. The response recommends the installed
calendar, rejects a new build, and labels its 4/4 target proposed with baseline/results
unknown. This suggests a construct-validity mismatch between an exact representation
check and the intended absence of novelty overclaims. It is not a production schema
failure or evidence of fabricated originality. No frozen assertion, prompt, output,
grade or qualification state was changed to pass.

Separate coding-agent author observations cover all seven exact output hashes.
Research responses retain source dependence, stale/current distinctions, incompatible
units, synthetic limitations and conditional transfer; the source-injection case
keeps the required format. These observations are not independent human review,
thesis evidence or a replacement acceptance decision. The runner's separate
substantive-review ledger remains required/not performed.

## Saved state, evidence and next eligible prompt

Authenticated API/database readback: 18 total saved requests (11 before, 7 new),
25 audit events, zero workflows, zero leased tasks, zero in flight and zero unresolved.
Settings hash remains `5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533`.
Earlier summarization remains narrowly qualified. Full discovery remains unqualified
because candidate generation failed and scoring was not attempted; C54 stays partial.

Evidence lives in `tracking/evidence/discovery-qualification-v3/`: preflight-state,
rollback, installed-upgrade, installed-state, execution-intent, raw-results,
substantive-review, decisions, stopped, postrun-state, failure-diagnostic,
author-review and execution-outcome JSON receipts. `result.json` remains historical
preparation; `execution-outcome.json` describes execution. Keep v3 run.lock and all
three predecessor locks. Do not rerun these manifests as fresh qualification evidence.

Next eligible prompt: audit qualification assertions against production contracts
and model-facing instructions across all task kinds, including nullable fields and
semantic equivalents. Preserve v3 grades and exposed outputs as diagnostic evidence;
propose a prospective versioned correction and fresh qualification design with
meaningful positive/negative controls before new live dispatch. Do not special-case
this observed string or weaken gates to pass. Independent substantive review and
end-to-end/native-search acceptance remain separate work.
