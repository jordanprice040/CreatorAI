# Prompt 06 — Verify and hand over

Paste the whole of [CONTRACT.md](../CONTRACT.md) first, then the block under “Prompt” below, into a fresh session.

## Prerequisites

- [Prompt 05](05-review-and-repair.md) passed its completion gate.

## Scope

- Verify the finished project from a clean copy and package it for the owner.
- Change no feature code. Publish, deploy and release nothing.

## Expected artifacts

- A `HANDOVER.md` in the project: how to run it, each check with its observed result, what was not run, known limits and open decisions.
- A source archive made from the final commit (for example `git archive`).

## Completion gate

- From a fresh clone, the checks give the results `HANDOVER.md` records.
- `HANDOVER.md` marks every check that was not executed as “not run”.
- `HANDOVER.md` says the 2 held-out cases were not run and the owner must run them.

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: verify and hand over. Change no feature code.

1. Clone the project into a new, empty folder so nothing untracked can help it pass.
2. In the clone run: python3 <bundle>/checks/run_checks.py   and keep the full output.
3. Carry out each check the script does not run (browser, manual, metric) as
   REQUIREMENTS.md describes, or mark it "not run" and say who must do it.
4. Write HANDOVER.md: how to run the project, each check key with its observed
   result, what was not run, known limits, and the decisions DECISIONS.md leaves open.
5. Make a source archive from the final commit.
6. Report. Do not publish, deploy, release, or say the owner has accepted the work.

The owner still has 2 held-out cases. The work is not accepted until the owner runs them.
```
