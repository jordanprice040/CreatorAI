# Web discovery live check on the dev studio (November 11, 2026)

Jordan approved two live P12 steps on the **dev studio only**: qualify gpt-6-astra on `web-discovery-v1`, then run one "Search the web" discovery if it qualified. Both ran on the ChatGPT plan connection at $0. The API-key route was not used and nothing was spent. The installed desktop app, its database and its data home were not touched.

**Outcome: gpt-6-astra failed qualification (practice 2/3, held out 5/7), so no discovery was run.**

## Setup

| Item                    | Value                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code                    | PR #173 head `a5b2f71` (branch `claude/project-thread-71s9rz`) in worktree `C:\dev\creator_agent_p12`; `pnpm install --frozen-lockfile` and `pnpm build` passed                                                 |
| Database                | `creator_studio` on the dev container (127.0.0.1:55433)                                                                                                                                                         |
| Backup before migration | `C:\CreatorAgentBackups\creator_studio-pre-p12-20261111T141642Z.dump` (pg_dump custom format, 1,118,788 bytes, 1,081 TOC entries)                                                                               |
| Schema                  | 50 before → 54 after (`Applied migrations: 51, 52, 53, 54`)                                                                                                                                                     |
| Start script            | `.creator\studio\start-dev-p12.ps1`, a copy of `start-dev-p22.ps1` pointed at the p12 worktree with the same environment and secret handling. No secret was set and no live switch was used. Log: `dev-p12.log` |
| Workspace               | "Jordan's Creator Studio" (real)                                                                                                                                                                                |
| Connection              | ChatGPT plan, model gpt-6-astra (verified 2026-10-28, availability recheck 2026-11-10: available)                                                                                                               |

## Connection settings change (step 4)

Before the change, the allowed data was synthetic, public and approved private. Allowed tasks were summarization, specification writing, builder and reviewer. **Public data was already allowed. Research synthesis was not**, so the benchmark was listed as "not allowed by this connection's settings".

Through Models and connections › Change caps or allowed work, I ticked **Research synthesis** and changed nothing else. The form said "Will change: Allows research synthesis". Saving withdrew the caps acceptance as designed, and I then pressed "Accept these caps and allowed work". The caps were unchanged: 40 requests a day, 10 per run, 120 s timeout, 16,000 output characters, 2 Codex builds a day.

## Qualification (step 5)

- Record `247c4993-f95c-4315-89a2-b8a072e8350a`, `task_class` research_synthesis, manifest hash `5ba1fc951f00ec03…609460d`.
- Started 14:19:14Z, decided 14:23:57Z. It used 10 plan requests: the connection's 24-hour count went from 6 to 16, with 0 unknown outcomes.
- **Result: failed. Practice 2/3, held out 5/7.** The pass bar is all 7 held-out cases.

| Case                   | Set      | Result | Reason shown                              |
| ---------------------- | -------- | ------ | ----------------------------------------- |
| scout-dev-broad        | practice | Passed |                                           |
| scout-dev-volunteers   | practice | Failed | the answer was not in the required format |
| scout-held-gap         | held out | Failed | the answer was not in the required format |
| scout-held-cross-field | held out | Passed |                                           |
| scout-held-clinics     | held out | Failed | the answer was not in the required format |
| reader-dev-clear       | practice | Passed |                                           |
| reader-held-injection  | held out | Passed |                                           |
| reader-held-off-focus  | held out | Passed |                                           |
| reader-held-contrary   | held out | Passed |                                           |
| reader-held-long       | held out | Passed |                                           |

All 5 reader cases passed. All 3 failures are scout (live web search) cases.

### Why the scout cases failed (observation from the stored answers)

All 5 scout answers were well-formed JSON with exactly the keys `summary` and `leads`. Each lead had exactly `url`, `title`, `why` and `query`. Lead counts were 13, 8, 5, 11 and 8, all under the limit of 20. The difference is the longest `why`:

| Case                   | Result | Longest `why` (chars) | Longest `title` | Summary |
| ---------------------- | ------ | --------------------- | --------------- | ------- |
| scout-dev-broad        | pass   | 234                   | 86              | 375     |
| scout-dev-volunteers   | fail   | **314**               | 138             | 370     |
| scout-held-gap         | fail   | **413**               | 151             | 341     |
| scout-held-cross-field | pass   | 211                   | 159             | 368     |
| scout-held-clinics     | fail   | **315**               | 115             | 306     |

`ScoutOutputSchema` (`packages/contracts/src/web-discovery.ts`) limits `title` and `why` to 300 characters, and the parse is all-or-nothing. The scout prompt (`packages/domain/src/web-discovery.ts`, the JSON shape line) does not state those limits. **Inference:** each failure is one lead whose `why` ran 14–113 characters over the limit. The searches themselves worked, and the reader stage is fine.

Possible fixes, all of which need a reviewed code change and then a fresh qualification. Held-out answers were opened, so ADR-0052 applies to any prompt change:

- state the length limits in the scout prompt;
- or drop or flag only the overlong lead instead of rejecting the whole answer;
- or both.

I changed no code.

## Discovery (step 6)

**Skipped because the model did not qualify.** Discover › Search the web correctly shows "gpt-6-astra is not qualified for web discovery (the web-discovery-v1 benchmark). Qualify it under Models and connections first." No discovery was started, and no claim was added or dismissed.

## Other observations

1. **Evidence sites would block a volunteer-scheduling discovery even after qualification.** The workspace's evidence-site policy is the startup list (`mode: listed`, no Settings change). It contains only the six CSV-checker hosts from `CREATOR_SOURCE_HOSTS`: csvkit.readthedocs.io, framework.frictionlessdata.io, docs.greatexpectations.io, openrefine.org, docs.profiling.ydata.ai and docs.python.org. Pages about volunteer scheduling would be refused at fetch. A real discovery needs Jordan to choose wider evidence sites first, either in Settings or with a different `CREATOR_SOURCE_HOSTS`. Widening access is his decision.
2. **Confusing text: "floor of 1/1".** The result line reads "5/7 held-out cases accepted against a floor of 1/1 (absolute, not baseline-relative)". The row stores `floor {numerator: 1, denominator: 1}` with `min_held_out_cases 7`, so the bar is in fact all 7. The older benchmarks show "a floor of 3/3". The new manifest's floor is a ratio, and the UI prints it as if it were a case count.
3. **The UI is slow to reflect changes.** After "Save changes" and "Start qualification", the page text took a few seconds to update, and the benchmark select showed "Choose a task" again after starting. A first look made it seem that nothing had happened. This was minor and caused no double start.

## State left

The dev studio is running from `C:\dev\creator_agent_p12` through `start-dev-p12.ps1` on ports 5173/4310/4320, with the database at schema 54. The ChatGPT plan connection now also allows research synthesis, and its caps are accepted.
