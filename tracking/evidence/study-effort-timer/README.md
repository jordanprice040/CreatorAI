# Study effort timer walk (ADR-0122, F13), November 15, 2026

Cloud container, throwaway PostgreSQL 16 database `creator_walk_f13`, review ports 5183/4330/4340
(`../owner-actions/stack.mjs`), synthetic fixture study only, $0, no model call.

`node tracking/evidence/study-effort-timer/walk.mjs <database-url> <out-dir>`: 7 of 7 checks pass.
Opening "Record human intervention" on the assisted attempt starts the step timer; the box names
the synthetic operator; typing counts as active; saving records the step (the API returned
`active_ms` 3357, `wait_ms` 0, `away_ms` 57 against a server `wall_ms` of 3456 on the first run);
the export labels the attempt's timing `synthetic_operator_not_participant`; no page errors.

- `01-timing-step.png`: the live readout above the intervention form while editing.
- `02-saved.png`: after saving, with "Measured on this attempt".
