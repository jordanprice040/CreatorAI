# p14-xl-v1 live qualification: 2026-11-17 (Jordan's dev studio)

Jordan authorized this run himself in the project thread on 2026-11-17 ("Upgrade the dev studio … Run the p14-xl-v1 live qualification…" and "Requalify GPT-6 Astra as builder on t12-builder-v3, then run p14-xl-v1.").

## Setup

- Dev studio: worktree C:\dev\creator_agent_mainrun at origin/main 317c4bd8, database creator_studio at schema 74 (migrated from 68 on 2026-11-17). The backup taken before migrating is C:\CreatorAgentBackups\creator_studio-pre-main317c4bd8-20261117T052028Z.dump.
- Connection: ChatGPT plan 4e4a7bec in workspace 88df6c10 (Jordan's Creator Studio). Model gpt-6-astra.
- Caps for the run (connection v67, settings hash 414d1dde…8355c): input 120,000, daily 120, per-run 30. Before the run they were input 60,000, daily 100, per-run 30 (v65), and they were restored to those values after it (v69, hash 22430024…e071a, re-accepted 07:17:05Z).

## Builder requalification (prerequisite)

The Oct 28 patch_build qualification (08210fde) was on an older builder prompt, so it was no longer current.

- Record 2cd36cf2-7dbd-441d-8d16-6cf76416c76c: t12-builder-v3, manifest 77f056a6770b50a201c3e44a0b8e5b5fe7c6c629a851cc0d0e1beccdce1698e1.
- **qualified.** bd-01 (development), bd-02, bd-03 and bd-04 (held out) were all accepted, 3 of 3 held out. 4 plan requests.
- The reviewer qualification 94ed329e (t12-reviewer) was already current.

## p14-xl-v1

- Record 4d445253-78dc-4d63-812f-5befe464ffc1, freeze 308fc5de6db962f58672730430a04b81498791c02f3d9e756b90f15056ae2c21, builder prompt 1417735c…bb7e, reviewer prompt 9e1cc6b4…f99c, max_input_chars 120000.
- **qualified, 3 of 3 attempts.** It started at 07:08:14Z and finished at 07:15:39Z.

| attempt | id       | requests | repairs | 25 frozen cases (11 held out) | package re-run | extended | structure | manifest sha256 | archive sha256     | wall  |
| ------- | -------- | -------- | ------- | ----------------------------- | -------------- | -------- | --------- | --------------- | ------------------ | ----- |
| 1       | 1db77888 | 2/20     | 0       | all passed, reviewer approved | 25/25          | 37/37    | ok        | 599e2ced…6dfb1c | cd29a101…21e90a    | 149 s |
| 2       | ef02a7f4 | 2/20     | 0       | all passed, reviewer approved | 25/25          | 37/37    | ok        | 64e41758…b250d  | 235d4c08…5083631eb | 152 s |
| 3       | 51eb2c04 | 2/20     | 0       | all passed, reviewer approved | 25/25          | 37/37    | ok        | 090f5aac…f4c7d7 | 39b033cb…a4b02c9   | 144 s |

The record keeps the outcome per bar, not per case. "QA passed every frozen case" covers all 25 studio cases, the 11 held-out ones included. The extended set had no failures (`failed: []`).

## Requests and spend

Plan requests since 07:00Z, read from the database: 4 qualification (patch_build) requests, 3 task patch_build requests and 3 task independent_review requests, so 10 in all. Every one completed, with no refusals, failures or unknown outcomes. No budget reservations were made, so the spend is $0. The full records are in the JSON files in this folder.
