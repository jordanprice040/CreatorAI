# P34 live discovery qualification — dev studio, 2026-11-11

Jordan's typed-OK live qualification of `gpt-6-astra` on the ChatGPT plan connection for the three
discovery steps, using the frozen benchmarks P34 (PR #175, ADR-0089) offers. ChatGPT plan, $0.

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

## Results

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

## Plan usage

- Before: 31 requests in the last 24 h (daily cap 40), 0 in flight, 0 unresolved.
- After: 37 requests in the last 24 h, 0 in flight, 0 unresolved.
- Used: 6 of the 18 allowed.

## Remaining

- Candidate generation and scoring need Jordan to allow those task classes on the plan connection
  (and re-accept caps) before they can be qualified; only 3 requests remain under today's 40/day cap.
- `admits_discovery` will only show once the dev studio runs P34 code. The P34 branch does not
  have the P12 migrations this schema-54 database already has (it branched from main before them),
  so P34 needs P12 merged in before it runs on this database.
