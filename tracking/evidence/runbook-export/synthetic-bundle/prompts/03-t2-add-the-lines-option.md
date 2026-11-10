# Prompt 03 — T2: Add the --lines option

Paste the whole of [CONTRACT.md](../CONTRACT.md) first, then the block under “Prompt” below, into a fresh session.

## Prerequisites

- [Prompt 01](01-setup.md) passed its completion gate.
- [Prompt 02](02-t1-count-words-from-standard-input.md) passed its completion gate.

## Scope

- Task T2 only, in the role of builder (writes the code).
- May change: `src` (a folder covers everything under it).

## Expected artifacts

- src/main.py accepts --lines and prints the line count.
- One commit that contains only this task’s changes.

## Completion gate

- Check A2 passes when run now.
- `python3 <bundle>/checks/run_checks.py --task T2` ends with 0 failed.
- Every check that passed before this task still passes.
- No file outside the task’s scope changed (`git diff --stat` against the previous commit). A line added to `ASSUMPTIONS.md` under the contract’s rules is allowed.

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: task T2 — Add the --lines option
Role: builder (writes the code)
Deliverable: src/main.py accepts --lines and prints the line count.
Files you may change: src
Depends on: T1
Acceptance checks to satisfy: A2

1. Read the checks named above in REQUIREMENTS.md, with every case shown for them.
2. Check that the tasks this one depends on are committed and their checks pass.
3. Make the smallest change that satisfies the checks, inside the allowed files only.
4. Run: python3 <bundle>/checks/run_checks.py --task T2   and read every FAIL line.
5. Run the checks of the earlier tasks again. Nothing that passed may now fail.
6. Commit only this task’s changes, then report against the completion gate.

If a check cannot pass without changing a file outside your scope, or without
changing the check, stop and report. Follow RECOVERY.md.
```
