# T12 implementation self-review

This is the implementing agent's review, not independent certification. Runtime
fixture reviewer separation is tested separately and is not model-quality evidence.

The boundary remains owner CLI -> authenticated current spec/run/admission and
budget API -> structured role output -> trusted scoped Git patches -> fixed WSL
worker. Models receive no host tools, credentials, authority mutation or arbitrary
command capability. Builder summaries are excluded from fresh reviewer context and
cannot mark readiness. The worker receives supervisor-owned read-only acceptance
input outside generated files. Exact stdout/exit checks execute real code and
bind command, recipe/policy/input hash, environment, candidate and frozen spec.

Failure probes cover no submitted work, scope expansion, stale review commit,
changed candidate/spec, cancellation after model completion, concurrent attempts,
deadline/admission refusal, human-only denial, zero-budget broker refusal and
deliberately broken code despite approving role claims. Actual WSL executions
exercise normal and invalid-input behavior. Two repairs exhaust with retained code.
A new supervisor instance can read the same current verified candidate.

Final inspection added continued validation of the exact build grant's version,
status and expiry, plus the humility review's current version/status. This closes
the interval between initial admission, a model response and a local patch/QA.
Consumed one-time grants remain valid only for their recorded admitted operation;
the CLI does not consume another approval simply to revalidate that operation.
The final compiled CLI test passed standing-authority, revoked-authority/no-model,
and one-time-authority cases with real DB/broker/WSL execution. This final guard
was added after the successful full 149-test run; its affected CLI path was rerun
separately, followed by the standard gate on final source.

Two preexisting test races were fixed without loosening assertions: duplicate
deliveries now hold the response until all three replays return, and budget API
cleanup closes its worker before the DB drop. A subsequent parallel-file run hit
the existing worker's uncertainty fence during cancellation; file-level test
serialization avoids resource/lease contention between independent real WSL test
fixtures. Internal budget/duplicate/cancellation/concurrency tests still execute.
Initial 147/149 and 148/149 failure logs are retained alongside the successful
149/149 serial run. The gate is not represented as passing parallel stress testing.

Remaining limits: reviewed Python CLI template, owner-authored stdout/exit plans,
one independent task, fixed synthetic builder/reviewer responses, local filesystem
evidence and no auto-replay of interrupted builds. No browser or persistence
recipe, dependent-task integration, searchable build catalog, exported-package
startup, live provider, participant activation or public release is verified.
Verification is task-specific; merging creates a different candidate. Shared-model
errors, the completeness of acceptance plans and the T11 local host trust boundary
remain limitations. No T11 owner review/merge or T12 source commit is claimed.
