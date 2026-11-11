# Stack and limits

**Proposed stack: Python command-line program (standard library only).**

This is a proposal, not an owner decision. It is the stack the frozen acceptance cases were written for, so another stack must still pass the same cases in the same way.
The notes below are not proposals: they say what a program on this stack must do to meet the cases. A program that does not do what a note requires is a review finding, even where the owner’s own check would still pass. A way shown “for example” is only one way to do it.

- Python 3, standard library only. No packages to install and no network at run time.
- The entry point is `src/main.py`. Each check runs it as `python3 -I src/main.py <arguments>` from the project root, with the case’s standard input.
- `python3 -I` ignores `PYTHON*` variables and does not put the script’s folder on the import path, so `src/main.py` must add its own folder to `sys.path` before importing local modules.
- A case passes when standard output matches byte for byte (including line ends) and the exit code matches.
- Each run starts fresh: do not rely on files or state left by an earlier run.
- The cases were written for Linux, where the owner’s own check runs: line ends are a single `\n` and the command is `python3`. On Windows the command is usually `python` or `py -3`, and a program must write `\n` itself (for example `sys.stdout.reconfigure(newline="\n")`), or every case fails on the line end.
- Running Python can leave `__pycache__` folders behind. The bundled script adds `-B` so its runs write none, and the setup step adds a `.gitignore` for them; never commit one.

Creator Agent calls this recipe `python-build/1`. That name only says the checks fit the recipe; it does not say any model or tool is qualified to build it.

## Limits that always apply

- Build only what REQUIREMENTS.md lists as in scope.
- Use only the data classes REQUIREMENTS.md allows. Do not fetch, scrape or invent real personal data.
- No credentials, accounts, payments, publication or deployment are part of this bundle. Each needs its own decision by the owner.
- Keep every change inside the files the current task may change (TASKS.md).
