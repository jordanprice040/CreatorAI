# Word tally (synthetic) — implementation runbook

This folder is a self-contained handover for a coding model or a developer who has never seen the system that produced it. Everything needed to build the project is in these files; nothing here links back to that system.

_This is a plan to implement. Nothing in it shows the software exists, works, or has been accepted._

## What this is for

**Problem:** Writers paste unpublished drafts into web word counters several times a day.

**Who it affects:** Writers working on unpublished drafts (synthetic).

**Chosen response:** A local word-count command (custom software)

**Why this option:** A small local tool removes the paste step and keeps drafts private.

## Read this first

- 2 held-out acceptance cases are not in this bundle; the owner keeps them to test the result.

## How to use it

1. Read [DECISIONS.md](DECISIONS.md). Settle anything under “Still to decide” that blocks you.
2. For each prompt below, in order: open a fresh session, paste [CONTRACT.md](CONTRACT.md), then paste the prompt.
3. Do not start a prompt until the ones it depends on have passed their completion gate.
4. When a gate fails, follow [RECOVERY.md](RECOVERY.md).

## Prompts, in order

| # | Prompt | Needs |
| --- | --- | --- |
| 01 | [Set up the workspace](prompts/01-setup.md) | nothing |
| 02 | [T1: Count words from standard input](prompts/02-t1-count-words-from-standard-input.md) | 01 |
| 03 | [T2: Add the --lines option](prompts/03-t2-add-the-lines-option.md) | 01, 02 |
| 04 | [T3: Review against the scope](prompts/04-t3-review-against-the-scope.md) | 01, 02, 03 |
| 05 | [Independent review and repair](prompts/05-review-and-repair.md) | 01, 02, 03, 04 |
| 06 | [Verify and hand over](prompts/06-verify-and-hand-over.md) | 05 |

## Files

- [CONTRACT.md](CONTRACT.md): the shared project contract, pasted before every prompt.
- [REQUIREMENTS.md](REQUIREMENTS.md): audience, flows, scope, data, acceptance checks, risks.
- [TASKS.md](TASKS.md): the tasks, their order and dependencies.
- [STACK.md](STACK.md): the proposed stack and the limits.
- [DECISIONS.md](DECISIONS.md): decided, proposed, assumed and still open.
- [EVIDENCE.md](EVIDENCE.md): the claims and sources behind the problem.
- [RECOVERY.md](RECOVERY.md): what to do when something fails.
- [spec.json](spec.json): the requirements as data.
- [checks/acceptance.json](checks/acceptance.json): the acceptance checks and visible cases as data.
- [checks/run_checks.py](checks/run_checks.py): runs the command-line cases (Python 3, no packages).
- [manifest.json](manifest.json): versions and a SHA-256 hash of every file.

## Validation commands

From the project folder (the one that holds `src/`):

```sh
python3 <bundle>/checks/run_checks.py              # every visible command-line case
python3 <bundle>/checks/run_checks.py --task T1    # one task’s cases
python3 <bundle>/checks/run_checks.py --check A1   # one check
```

It prints PASS or FAIL per case and exits 0 only when every case it ran passed. Use `--cmd` to test a program that starts another way.

Checks without command-line cases (browser, manual, metric) are listed by the script as not run; a person or a browser tool carries them out.

## What is deliberately not here

- Held-out acceptance cases: 2, kept by the owner to test the result.
- Credentials, accounts and access of any kind.
- Personal folder paths and anything shaped like a credential (removed if found).
- Private notes, scores, chat and other records that the spec does not cite.

## Where it came from

- Spec 00000000-0000-4000-8000-000000000001, version 2, frozen on 2026-11-10 (freeze 00000000)
- Spec content hash `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, version saved 2026-11-10T08:00:00.000Z
- Selection 00000000-0000-4000-8000-000000000005
- Option 00000000-0000-4000-8000-000000000004, version 1
- Problem 00000000-0000-4000-8000-000000000003, version 1
- Produced by Creator Agent’s runbook export (`runbook/1`) from recorded data; no model wrote these files.
