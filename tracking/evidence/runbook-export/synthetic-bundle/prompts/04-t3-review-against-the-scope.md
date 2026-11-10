# Prompt 04 — T3: Review against the scope

Paste the whole of [CONTRACT.md](../CONTRACT.md) first, then the block under “Prompt” below, into a fresh session.

## Prerequisites

- [Prompt 01](01-setup.md) passed its completion gate.
- [Prompt 02](02-t1-count-words-from-standard-input.md) passed its completion gate.
- [Prompt 03](03-t2-add-the-lines-option.md) passed its completion gate.

## Scope

- Task T3 only, in the role of reviewer (reads the work, changes nothing).
- May change: `review` (a folder covers everything under it).

## Expected artifacts

- A written review of the source against the scope.
- One commit that contains only this task’s changes.

## Completion gate

- Check A3 passes when run now.
- Every check that passed before this task still passes.
- No file outside the task’s scope changed (`git diff --stat` against the previous commit).

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: task T3 — Review against the scope
Role: reviewer (reads the work, changes nothing)
Deliverable: A written review of the source against the scope.
Files you may change: review
Depends on: T1, T2
Acceptance checks to satisfy: A3

1. Read the checks named above in REQUIREMENTS.md, with every case shown for them.
2. Check that the tasks this one depends on are committed and their checks pass.
3. Review the work those tasks produced against REQUIREMENTS.md. Change no code. Write findings with file and line, most serious first.
4. Carry out each check as REQUIREMENTS.md describes and record what you saw.
5. Run the checks of the earlier tasks again. Nothing that passed may now fail.
6. Commit only this task’s changes, then report against the completion gate.

If a check cannot pass without changing a file outside your scope, or without
changing the check, stop and report. Follow RECOVERY.md.
```
