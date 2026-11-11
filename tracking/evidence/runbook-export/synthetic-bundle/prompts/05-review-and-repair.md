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
- May also change `README.md` and `REVIEW.md` at the project root, which no task owns, and correct a line in `ASSUMPTIONS.md` that a finding shows is wrong.
- Reviews that earlier tasks wrote stay as they were written; a mistake in one is a finding in `REVIEW.md`, not an edit to it.

## Expected artifacts

- A `REVIEW.md` in the project: findings by severity with file and line, and for each the fix or the reason it stays.
- `REVIEW.md` committed on its own first; then, only if something is fixed, one commit per repaired finding and a last commit that marks each finding in `REVIEW.md`.

## Completion gate

- `python3 <bundle>/checks/run_checks.py` ends with 0 failed.
- Every finding in `REVIEW.md` is marked fixed, or left with a stated reason for the owner.
- Nothing listed under “Not in scope” was built.

If the gate does not pass, follow [RECOVERY.md](../RECOVERY.md).

## Prompt

```text
Step: independent review, then repair. Use a session that did not write the code.

Part 1, review (change no file except REVIEW.md, and ASSUMPTIONS.md only to add a
line as the contract allows):
1. Read REQUIREMENTS.md, then the code and its history.
2. For each acceptance check, decide whether the code truly does what the statement
   says, not only what the visible cases test. Other cases exist that you cannot see.
3. Look for: behaviour outside the scope, a non-goal that was built, a changed check,
   input that crashes it, data the spec does not allow, anything a risk in
   REQUIREMENTS.md warned about.
   Also check that each mitigation REQUIREMENTS.md gives for a risk is in place. One
   that belongs in the documentation (for example a rule the README must state) is
   a finding if it is missing.
   Read ASSUMPTIONS.md if it exists: a reading there that looks wrong is a finding.
   A mistake in an earlier task’s review is a finding too; leave that review as it is.
4. Write REVIEW.md: findings, most serious first, each with file and line.
   Commit REVIEW.md on its own. If it has no findings, the repair part is empty.

Part 2, repair:
5. Fix each finding inside the scope of the task that owns the file. One commit each.
   A finding about README.md is fixed in README.md in this step; no task owns it.
   A wrong line in ASSUMPTIONS.md is corrected in place, saying what it said before.
6. After each fix run: python3 <bundle>/checks/run_checks.py
7. Mark each finding fixed, or say why it stays and what the owner must decide.
   If you fixed anything, commit that update to REVIEW.md last.

Do not review your own work and call it independent. If this session wrote the
code, say so in REVIEW.md.
```
