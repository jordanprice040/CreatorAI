# Prompt 01 — Set up the workspace

Paste the whole of [CONTRACT.md](../CONTRACT.md) first, then the block under “Prompt” below, into a fresh session.

## Prerequisites

- None. This is the first step.

## Scope

- Create an empty project folder with version control and the folder layout the tasks need.
- Write no feature code.

## Expected artifacts

- A new Git repository with one commit.
- A short `README.md` in the project that names the project and says how to run the checks.
- The empty entry point for the proposed stack (`src/main.py`).

## Completion gate

- `git status` is clean and `git log` shows one commit.
- `python3 <bundle>/checks/run_checks.py` starts and reports the cases (they are expected to fail now).
- Your report lists every open decision from DECISIONS.md that blocks a later step.

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: set up the workspace. Write no feature code in this step.

1. Read every file named in the project contract.
2. Create a new, empty project folder outside the bundle and run `git init` in it.
3. Create the layout for the proposed stack: Python command-line program (standard library only). Add src/main.py that exits with code 0 and prints nothing.
4. Create every folder that TASKS.md lets a task change.
5. Add a README.md that names the project and says how to run the checks.
6. Run: python3 <bundle>/checks/run_checks.py   (from the project folder). Failures are expected; the script must start.
7. Commit. Then report, including each open decision in DECISIONS.md that would block a later step.
```
