# P34 live discovery qualification — dev studio, 2026-11-11

Jordan's typed-OK live qualification of `gpt-6-astra` on the ChatGPT plan connection for the three
discovery steps, using the frozen benchmarks P34 (PR #175, ADR-0089) offers. ChatGPT plan, $0.

## Current state (end of the session, 2026-11-11 ~16:02Z)

- `gpt-6-astra` is **qualified for all three discovery steps** on the dev studio's ChatGPT plan
  connection: research_synthesis `cc9e4f2a…`, candidate_generation `cab57f95…`, scoring
  `7118b6d9…`. Each 2/2 practice and 4/4 held out, 6 plan requests each, **18 requests in all**, $0.
- The connection allows all eight task classes it can take, and its daily request cap is **70**
  (raised from 40 on Jordan's typed approval). 49 of 70 requests used in the last 24 h after the
  runs; 0 in flight, 0 unresolved. Connection version 40.
- `admits_discovery` is not shown yet, because the dev studio runs the P12 checkout, not P34 code.

The sections below were written as the work went. "Results" and "Remaining" describe the state
**as of 15:40Z** (only research synthesis run, five task classes allowed, cap 40); the later
sections record the changes after that.

## Environment

- Dev studio API on 127.0.0.1:4310, started by `.creator\studio\start-dev-p12.ps1` from
  `C:\dev\creator_agent_p12` at commit `9cb46bbca9f154f02964ebcab746d5428d855b01`
  (branch `claude/project-thread-71s9rz`, P12). **Not** the P34 code: P34 (`2550f21`) is a sibling
  branch that does not contain this commit.
- Database `creator_studio` in Docker `creator-agent-local-db-1` (127.0.0.1:55433), schema 54
  (53 migration rows, max version 54). The installed desktop app was not touched.
- Workspace `88df6c10-7310-4ec0-b623-7f48046bc447` ("Jordan's Creator Studio"; the dev studio has no
  "Testing" workspace).
- Connection `4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4` (ChatGPT plan, Plus), version 32 before / 34
  after. `gpt-6-astra` access verified on the Responses path (2026-10-28).
- CLI signed in with `pnpm cli login <code>` using the startup code in `dev-p12.log`.
- The three manifests are byte-identical (same git blob) on `main`, the P34 branch and the p12
  checkout. The `discovery_contract` grader is unchanged between p12 and P34, and P34 decides
  `admits_discovery` from the stored manifest and hash, so the result should count under P34 too
  (not verified by running P34 code).

## Results (as of 15:40Z)

| Task class | Manifest | Qualification | State | Practice | Held out | Plan requests |
|---|---|---|---|---|---|---|
| research_synthesis | discovery-research14-v2/research_synthesis.json (hash `217d5875…8e1f`) | `cc9e4f2a-e9c2-4f03-9112-11a569b3b8b8` | qualified | 2/2 | 4/4 | 6 |
| candidate_generation | discovery-semantics-v2/candidate_generation.json | — | skipped: task class not allowed on the connection | — | — | 0 |
| scoring | discovery-semantics-v2/scoring.json | — | skipped: task class not allowed on the connection | — | — | 0 |

Research synthesis reason: "4/4 held-out cases accepted; 4 of 4 were needed (absolute, not
baseline-relative)." Started 15:36:57Z, decided 15:39:14Z, one Run, no refusals. All six cases
completed with signal `accepted`. Held-out outputs were not opened.

The connection's allowed task classes are `research_synthesis, specification, summarization,
patch_build, independent_review`. Connection settings were not changed, so candidate generation and
scoring were not run.

Before this run the newest decided research_synthesis qualification was `6fcf69cb…` (qualified,
web-discovery-v2, a different manifest hash `d3a87d16…`), so it did not cover this manifest.

## Plan usage (as of 15:40Z)

- Before: 31 requests in the last 24 h (daily cap 40), 0 in flight, 0 unresolved.
- After: 37 requests in the last 24 h, 0 in flight, 0 unresolved.
- Used: 6 of the 18 allowed.

## Remaining (as of 15:40Z; the first item was done later, see below)

- Candidate generation and scoring need Jordan to allow those task classes on the plan connection
  (and re-accept caps) before they can be qualified; only 3 requests remain under today's 40/day cap.
- `admits_discovery` will only show once the dev studio runs P34 code. The P34 branch does not
  have the P12 migrations this schema-54 database already has (it branched from main before them),
  so P34 needs P12 merged in before it runs on this database.

## Settings change

On Jordan's "Allow" (2026-11-11 15:40:41Z), the dev studio's ChatGPT plan connection
`4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4` (workspace `88df6c10…`, API 127.0.0.1:4310) was changed
the same way the app's "Allow all tasks" button changes it (ADR-0084 `allowTaskSequence`), through
the owner CLI (`plan-settings`, then `plan-accept-caps`). The installed app was not touched.

- Settings saved from version 34 to 35 (15:43:21Z). Only `allowed_task_classes` changed. Data
  classes (`synthetic, public, private_approved`) and all caps stayed the same.
- Allowed task classes are now `research_synthesis, candidate_generation, scoring,
  specification, summarization, patch_build, independent_review, code_build` (all eight a
  ChatGPT plan connection can take).
- The caps had been accepted before (14:18:53Z), so they were accepted again: version 36,
  `caps_accepted_at` 15:43:37Z, settings_hash
  `c3452298ca07c1ea18d2d46dd75c467e7f7333898b99faabb62ca4209dfb24d5`. No blockers are listed.
- No qualification was run. There were 37 requests in the last 24 h (cap 40, 3 free). Going by
  the `plan_requests` start times, and only if no new requests start, at least 12 requests are
  free just after **2026-11-12 14:21:01.336Z**, when the ninth-oldest request (started
  2026-11-11 14:21:01.336Z) leaves the window.

## Cap change

On Jordan's typed approval to raise the request window by 30 (relayed 2026-11-11 15:55Z), the dev
studio's ChatGPT plan connection `4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4` was changed through the
owner CLI (`plan-settings`, then `plan-accept-caps`) from `C:\dev\creator_agent_p12`. The installed
app was not touched.

- Field: `settings.caps.shared.max_model_requests_per_day` (rolling 24 hours, both paths together;
  `PlanCapsSchema` in `packages/contracts/src/connections.ts`, minimum 1, no maximum per ADR-0062).
- Changed 40 → 70. The saved settings equal the previous settings with only that field changed
  (checked by comparing the full settings object). The server accepted 70 without a refusal.
- Settings saved from version 36 to 37 (`caps_accepted_at` cleared), settings_hash
  `18fbb29750084996256c0fa34c3b9d0cdd0cf519651f7267df96f627d468fb11`.
- Caps accepted again at version 38, `caps_accepted_at` 2026-11-11T15:56:19.635Z. No blockers.
- After the change: 37 requests in the last 24 h (33 free), 0 in flight, 0 unresolved.

## Candidate generation and scoring

`pnpm cli plan-qualify <ws> <conn> <version> gpt-6-astra <manifest> 4 1/1`, then `plan-qualify-run`,
one at a time. One run each, no retries, no continuation needed. Held-out outputs were not opened.

| Task class | Manifest | Qualification | State | Practice | Held out | Plan requests |
|---|---|---|---|---|---|---|
| candidate_generation | discovery-semantics-v2/candidate_generation.json (hash `b3917017…8e74`) | `cab57f95-9e55-4dc8-a595-2698aeaa9815` | qualified | 2/2 | 4/4 | 6 |
| scoring | discovery-semantics-v2/scoring.json (hash `d4031d22…5576`) | `7118b6d9-70ab-4202-8001-52f301f0946c` | qualified | 2/2 | 4/4 | 6 |

- Candidate generation: started 15:56:31Z (connection version 38 → 39), decided 15:59:54Z.
- Scoring: started 16:00:07Z (version 39 → 40), decided 16:01:58Z.
- Both reasons: "4/4 held-out cases accepted; 4 of 4 were needed (absolute, not
  baseline-relative)." Both `prompt_current: true`.

Plan usage: 37 requests in the last 24 h before, 43 after candidate generation, 49 after scoring
(cap 70); 0 in flight and 0 unresolved throughout. Used 12 of the 12 allowed.

`admits_discovery` is still not shown: the dev studio runs p12 code, not P34 (see Remaining above).
