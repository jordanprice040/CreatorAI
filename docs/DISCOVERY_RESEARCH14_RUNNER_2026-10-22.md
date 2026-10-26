# Research role 1.4 runner implemented — October 22, 2026

The research-only runner is implemented and separately reviewed with no unresolved material findings. No provider calls, credential access, service/API/database operations, application build or installation were performed for this milestone.

The exact executable plan is `a96eed07aa0372e55d7880a62b57f6c0f5726b3ea6c559617af3f9119e11469a`, with 233 source/artifact bindings. It selects only the six `research_synthesis` locator cases in the reviewed v2 packet, freeze `c0576b32481fc2f682a71d7506ef10fe4866382d065dbeb45e68d937395142d4`. It binds installed candidate `d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf`; no reinstallation is required.

The runner limits delivery to six sequential requests, zero retries, 120 seconds per request, 16,000 output characters and a 12-minute dispatch budget. It records intent before delivery, takes a persistent exclusive run lock before qualification creation, rejects a seventh request and stops on the first failed, rejected, unknown or contract-failing outcome. Cancellation and the deadline prevent further dispatch; they cannot retract an already delivered request or guarantee remote reconciliation/process exit at exactly twelve minutes.

Static gates bind the exact plan, packet review, runner review, studio home, preservation/backup installation receipt and installed resource bytes before credential access. Live admission additionally requires fresh available status, credits confirmed off, unchanged settings, capacity for all six, no active/unknown work and no prior attempt of this manifest. The existing domain service owns actual permissions, atomic allowance and persistence. Availability refresh is outside this six-request plan.

New entry points are `scripts/qualify-discovery-research14.mjs` and its PowerShell wrapper, with research-specific checker, preparation script and bounded core. Shared reviewed installation/admission helpers are reused. The copied core changes only the predecessor's request and wall-time limits; earlier runners, packets, locks and results remain preserved.

Executed verification: TypeScript project build; standalone and normal compiled test entries, each 17 passed with zero failures/skips; actual offline runner check, six cases and 54 controls; PowerShell parser check; and actual review gate. Tests cover admission failures, source/review/install drift, capacity, intent failure, cancellation, deadline, unknown delivery and refusal of a seventh request. These are offline/static checks, not live service or model observations.

The [separate model review](DISCOVERY_RESEARCH14_RUNNER_REVIEW_2026-10-22.md) independently passed the compiled tests and offline checks. Its receipt binds 240 artifacts; parent integration verified all 240 hashes and passed the actual review gate. The review has prior familiarity and is not blinded evaluation or human acceptance. Evidence is in `tracking/evidence/discovery-research14-runner/` and `tracking/evidence/discovery-research14-runner-review-2026-10-22/`.

Current eligible role evidence remains two of three classes. Research output fidelity still requires fresh outputs and substantive review; full discovery/C54 remains partial. No run lock was created and no live approval is implied.

Next eligible step: prepare and review a new bounded live authorization package, explicitly including a separately scoped fresh availability check if needed, then obtain a new exact owner decision before execution. Earlier approvals are consumed and do not cover this suite. No automatic workflow or pilot follows.
