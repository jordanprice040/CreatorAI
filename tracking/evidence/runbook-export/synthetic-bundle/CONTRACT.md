# Project contract — Word tally (synthetic)

Paste this whole file at the start of every session, before the prompt for the step.

```text
You are implementing one step of a project called "Word tally (synthetic)".
You have a folder of files called the runbook bundle. It is your only source of
requirements. You have no access to the system that produced it, and you do not need any.

Where things are:
  <bundle>   stands for the path of the bundle folder: the one that holds README.md,
             manifest.json and this file. Replace it with the real path in every command.
             Keep the bundle outside the project folder and never commit it.
  Every file named in capitals below (REQUIREMENTS.md and so on) is in <bundle>.
  The project is the separate folder that the setup step creates. Commands run from it.

What the project is for:
  Problem: Writers paste unpublished drafts into web word counters several times a day.
  Who it affects: Writers working on unpublished drafts (synthetic).
  Who the software is for: Writers who want a quick count from the command line (synthetic).
  Chosen response: A local word-count command

Read before you start a step:
  REQUIREMENTS.md  what to build and the acceptance checks (fixed; do not edit)
  TASKS.md         the tasks, their order and the files each may change
  STACK.md         the proposed stack and the limits
  DECISIONS.md     what is decided, what is only proposed, what is still open
  EVIDENCE.md      why the problem is believed to be real
  RECOVERY.md      what to do when something fails

Rules for every step:
  1. Do only the step in the prompt you were given. Do not start the next one.
  2. Change only the files that step may change.
  3. Never edit the bundle, a requirement, an acceptance check or an expected output.
  4. Build nothing listed under "Not in scope".
  5. Do not use credentials, accounts, payments, real personal data or the network
     unless the step says the owner has provided it. The bundle grants no access.
  6. If you need a decision that DECISIONS.md lists as open, stop and ask. Do not guess.
     One exception: a check that a person must judge (manual review or metric). Who
     judges it may still be open. Carry the check out as REQUIREMENTS.md describes,
     record what you saw as provisional, and go on. Only the owner’s judge can pass it.
  7. Report only what you ran and saw. Say "not run" for anything you did not run.
  8. 2 acceptance cases are held back by the owner. Passing the visible cases does
     not show the work is accepted. Make the behaviour right, not just the cases.
  9. Where a requirement can be read more than one way and no case settles it, take
     the narrower reading and add one line to ASSUMPTIONS.md in the project: the
     requirement, the reading you took, and the other reading. This is not a reason
     to stop. It is for readings of a requirement only, never for an open decision.
  10. Five files at the project root belong to no task: README.md, .gitignore,
     ASSUMPTIONS.md, REVIEW.md and HANDOVER.md. A step may change one of them only
     where its prompt says so, except that any step may add a line to ASSUMPTIONS.md.
     Such a change does not count as a change outside the task’s scope.

End every step with a short report: what changed (files), what you ran and its
result, whether the completion gate passed, and anything the owner must decide.
```
