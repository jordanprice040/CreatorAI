# Plan-connection specification qualification (draft for owner review)

Drafted 2026-10-28 at Jordan's request ("please do so"), after `claude-sonnet-5-5` qualified for
summarization on his Claude Code connection. **Not frozen and not run.** It is frozen only after
Jordan approves the cases below, and each run needs its own typed OK.

## Frozen scope (once approved)

Manifest: `config/connections/benchmarks/specification-synthetic-v1.json`.

- Eight synthetic request notes: two development cases and six held out.
- All six held-out cases must pass (floor 1/1, minimum six). No adaptation and no retries.
- The labels were written before any model saw these cases.
- The target model sees only the instructions and the note. Expected labels are never sent.
- These cases must not be reused as fresh evidence after anyone tunes against their results.

Each answer is one acceptance-check record, the narrow core of a `spec/1` acceptance check. It is
a minified JSON object with exactly four keys:

| Key        | Allowed values                                                            |
| ---------- | ------------------------------------------------------------------------- |
| `feature`  | the feature name, quoted exactly                                          |
| `method`   | `automated_test`, `browser_check`, `manual_review`, `metric` or `unknown` |
| `priority` | `must`, `should` or `could` only when stated, else `unknown`              |
| `scope`    | `in`, `out` or `unknown`                                                  |

The existing exact-label checker compares canonical JSON text, the same as the summarization
benchmark.

| Case               | Split       | What it tests                                   | Expected                   |
| ------------------ | ----------- | ----------------------------------------------- | -------------------------- |
| dev-complete       | development | everything stated                               | automated_test, must, in   |
| dev-missing        | development | no priority given                               | browser_check, unknown, in |
| held-correction    | held out    | a final decision replaces an earlier message    | metric, should, out        |
| held-conflict      | held out    | two check methods, neither final                | unknown, must, in          |
| held-excluded      | held out    | explicitly excluded from this release           | manual_review, could, out  |
| held-instruction   | held out    | a pasted instruction tries to change the answer | automated_test, should, in |
| held-distractors   | held out    | background numbers to ignore                    | browser_check, must, in    |
| held-unknown-scope | held out    | release not stated                              | metric, should, unknown    |

## What it does and doesn't show

This measures faithful, rule-following extraction of an acceptance check from a short request,
including corrections, conflicts, exclusions and embedded instructions. It does not show that a
model can write a full specification, judge feasibility, or produce useful specs for customers.
The product gate is named `specification`; read that broad label in light of this narrow manifest.

## Run (only after approval and a typed OK)

There are at most 8 requests, sent one at a time, on synthetic data, through the connection's
own admission and caps:

```powershell
pnpm cli plan-qualify <workspace> <connection> <version> <model> config/connections/benchmarks/specification-synthetic-v1.json 6 1/1
pnpm cli plan-qualify-run <workspace> <qualification-id>
```
