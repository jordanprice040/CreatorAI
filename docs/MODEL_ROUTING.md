# Model registry and qualified routing (X01)

Accepted owner policy: [register #4–#10](../tracking/OWNER_DECISIONS_2026-10-20.md). Economy with measured quality floor is the target default; qualified local fallback and opt-in bounded paid fallback remain distinct. User-adjustable ceilings may exceed $20; the current studio allowance is unchanged. This is design direction, not new qualification evidence.

X01 adds a versioned model registry, route policies, a held-out promotion gate and
rollback on top of the T04 broker. Routing only chooses _which_ model serves a call:
the broker still checks the run, grants, envelope and pricing for every routed call,
and a refused route is recorded, never replaced.

Status: implemented and verified in fixture workspaces only. No live model has been
called, no account access has been verified and no savings are claimed. The X01
prerequisite "measured task outcomes" is not met yet, so every qualification today
comes from the synthetic fixture benchmark.

## Pieces

| Piece        | Where                                                        | What it fixes                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry     | `config/routing/model-registry*.json` → `route_registries`   | Per model: task classes, tools, allowed data classes, latency basis, availability, and the hash of its pricing file.                                                                   |
| Route policy | `route_policies` (versioned per workspace or per project)    | `fixed` (one model, never substituted), `auto` (best held-out accepted rate), `economy` (lowest cost per accepted result at or above a quality floor).                                 |
| Decision     | `route_decisions` (immutable)                                | The chosen model with the policy id/version/hash, registry version/hash, pricing snapshot id/hash, role, promotion and criteria hash, and the reason for every candidate.              |
| Benchmark    | `config/routing/benchmark.fixture.json` → `route_benchmarks` | Frozen cases with `development` and `held_out` splits and objective checks written before any result.                                                                                  |
| Promotion    | `route_promotions`                                           | candidate → shadow → canary → promoted, or rejected / rolled back, under criteria fixed (and hashed) at creation.                                                                      |
| Outcome      | `route_outcomes` (immutable)                                 | Objective signal (`accepted`, `schema_invalid`, `incomplete_output`, `acceptance_check_failed`, `review_rejected`, `provider_error`) and cost read from the broker's own reservations. |

## Rules the code enforces

- A route must meet every hard constraint: availability, action, task class, tools,
  data class (privacy), context window and output size, and latency when the request
  sets a limit (unknown latency fails). In a real workspace only `verified` models
  route; `gpt-6-astra` is `documented`, so real routing is refused until an accessible
  API id is verified with evidence.
- Only the reference baseline and promoted models are quality-qualified. The owner's
  reference model is always kept as the baseline every candidate is measured against.
- The held-out gate counts held-out cases only, requires the minimum case count, the
  quality floor and no larger drop below the baseline than `max_regression`. A failed
  benchmark rejects the promotion; results cannot be re-run for the same promotion.
- Benchmark outputs and costs are read from the broker's reservations by the store and
  scored there; the caller cannot supply results.
- Cost per accepted result counts failed attempts, reviews, repairs and tools, divided
  by accepted results only. Unknown exposure is kept separate, never zero. Savings are
  `measured` only in a real workspace with fully known costs; fixture evidence is always
  `not_claimed_fixture`.
- Shadow candidates run under their own operation id and are never served. A canary
  serves a deterministic, capped slice (at most a quarter, and at most
  `canary_max_decisions`). Fixed policies are never canaried.
- Advancing shadow → canary → promoted is an owner action that re-evaluates the stage
  gate; the owner cannot override a failing gate. Canary or post-promotion outcomes
  that fall below the floor roll the route back automatically; owners can roll back
  any active promotion. After rollback, decisions return to the baseline.
- Escalation needs a recorded objective failure, happens once per decision and goes to
  the reference baseline. If the baseline failed, it is refused (`escalation_exhausted`).
  There is no confidence field anywhere in the outcome contract.

## Local commands (PowerShell)

Sign in first (`pnpm cli login <code>`), then with a fixture workspace `$ws`, a
registered run `$run` and an envelope `$env`:

```powershell
pnpm cli route-registry-add $ws config/routing/model-registry.fixture.json
pnpm cli route-policy-set $ws policy.json            # add a project id to scope it
pnpm cli route-benchmark-add $ws config/routing/benchmark.fixture.json
pnpm cli route-promotion-create $ws promotion.json
pnpm cli route-benchmark-run $ws $promotion $run $env 5000
pnpm cli route-decide $ws route-request.json
pnpm cli route-call $ws $decision broker-request.json          # add --shadow for the shadow
pnpm cli route-outcome $ws $decision outcome.json
pnpm cli route-advance $ws $promotion <expected-version> "reason"
pnpm cli route-rollback $ws $promotion <expected-version> "reason"
```

Arguments ending in `.json` are read from file, which avoids PowerShell quoting.
The API routes are under `/api/workspaces/:ws/route-registries`, `route-policies`,
`route-benchmarks`, `route-promotions` and `route-decisions`.

## Not done

- No live verification of `gpt-6-astra` (no key, no authorized call); real workspaces
  cannot route until that is done and recorded as a new registry version.
- No measured task outcomes exist, so no real model is qualified beyond the baseline
  and no cost or quality claim is made.
- Routing is opt-in per call (decide, then `route-call`); existing workflow, study and
  builder paths still call the broker directly with their frozen model.
- No web UI for routing yet; use the CLI or API.
