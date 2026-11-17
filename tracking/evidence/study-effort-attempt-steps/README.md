# Study effort timer: human-only and finish steps (ADR-0129), November 17, 2026

Cloud container, throwaway PostgreSQL 16 database `creator_walk_adr0129`, review ports 5183/4330/4340
(`../owner-actions/stack.mjs`), synthetic fixture study only, $0, no model call.

`node tracking/evidence/study-effort-attempt-steps/walk.mjs <database-url> <out-dir>`: 14 of 14 checks pass (after review 2; 13 of 13 after review 1, 11 of 11 before it).
Opening the human-only attempt starts the step timer; a second click on it keeps its one step; a submit refused for having no entry keeps the step timing (the browser logs that intended 409); a detour to the assisted attempt and back keeps the step's clock (the entry step's totals cover its server time, the detour counted as away); typing an entry counts as active; saving the
entry ends the step (the API returned `ended_by` `entry`, `active_ms` 3209, `idle_ms` 59 against a
server `wall_ms` of 3288) and the next starts; Submit saved work ends it (`ended_by` `finish`, `wall_ms`
1050); opening the assisted attempt starts timing before the intervention form is opened; Stop attempt
ends its step as the finish; the export shows the human-only attempt `complete`, labelled
`synthetic_operator_not_participant`, and the autonomous attempt `condition_timed: false`; no page errors.

- `01-human-only-timing.png`: the readout at the top of the human-only attempt while typing an entry.
- `02-entry-saved.png`: after saving the entry: one timed step, the next one timing.
- `03-assisted-timing.png`: the assisted attempt timing with the intervention form closed.
