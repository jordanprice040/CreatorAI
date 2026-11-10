# Prompt 05 — Independent review and repair

Paste the whole of [CONTRACT.md](../CONTRACT.md) first, then the block under “Prompt” below, into a fresh session.

## Prerequisites

- [Prompt 01](01-setup.md) passed its completion gate.
- [Prompt 02](02-t1-count-words-from-standard-input.md) passed its completion gate.
- [Prompt 03](03-t2-add-the-lines-option.md) passed its completion gate.
- [Prompt 04](04-t3-review-against-the-scope.md) passed its completion gate.

## Scope

- Review the whole project against REQUIREMENTS.md in a fresh session that did not write the code.
- Then repair only what the review found, each fix inside the scope of the task that owns the file.

## Expected artifacts

- A `REVIEW.md` in the project: findings by severity with file and line, and for each the fix or the reason it stays.
- One commit per repaired finding.

## Completion gate

- `python3 <bundle>/checks/run_checks.py` ends with 0 failed.
- Every finding in `REVIEW.md` is marked fixed, or left with a stated reason for the owner.
- Nothing listed under “Not in scope” was built.

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: independent review, then repair. Use a session that did not write the code.

Part 1, review (change nothing):
1. Read REQUIREMENTS.md, then the code and its history.
2. For each acceptance check, decide whether the code truly does what the statement
   says, not only what the visible cases test. Other cases exist that you cannot see.
3. Look for: behaviour outside the scope, a non-goal that was built, a changed check,
   input that crashes it, data the spec does not allow, anything a risk in
   REQUIREMENTS.md warned about.
4. Write REVIEW.md: findings, most serious first, each with file and line.

Part 2, repair:
5. Fix each finding inside the scope of the task that owns the file. One commit each.
6. After each fix run: python3 <bundle>/checks/run_checks.py
7. Mark each finding fixed, or say why it stays and what the owner must decide.

Do not review your own work and call it independent. If this session wrote the
code, say so in REVIEW.md.
```
