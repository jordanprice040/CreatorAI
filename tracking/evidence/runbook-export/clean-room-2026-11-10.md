# P16 gate: clean-room consumption of the synthetic runbook bundle

Date: 2026-11-10. Subject: draft PR #152, branch `claude/project-thread-tq4rcm` at `c97bff3`.
Bundle: `tracking/evidence/runbook-export/synthetic-bundle/` (18 files), copied alone into an empty folder outside the repository.

## Method

- Only the bundle was read while implementing. The project was built in a second empty folder, following prompts 01 to 06 in order, one commit per step (7 commits, final `7e236de`).
- The implementation was frozen before `packages/domain/src/runbook-fixture.ts` was opened. The two held-out cases were then run against a fresh clone of the final commit with `python3 -I src/main.py`.
- Python 3.13, standard library only. No model calls, no paid spend, nothing pushed.

## Results

| Case | Input | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| A1 held-out | args `[]`, stdin `"  alpha\tbeta\n\ngamma  \n"` | `3\n`, exit 0 | `3\n`, exit 0 | PASS |
| A2 held-out | args `["--lines"]`, stdin `"only-held-out-line-zq7"` (no line end) | `1\n`, exit 0 | `1\n`, exit 0 | PASS |

Visible cases in a fresh clone: 4 run, 0 failed, A3 skipped (manual). The held-out marker text does not appear anywhere in the bundle.

## Limits of this run

- One session carried out all six prompts. "A fresh session per prompt" and the independence of prompt 05 were not exercised; REVIEW.md in the result says so, as the prompt requires.
- The implementer is the same kind of model that built the exporter, so wording that is clear to it may still be unclear to another model or a person.
- A3 was only carried out by the implementer (source read and grep; no file or network use found).

## Findings: missing or ambiguous context

**F1 (Medium) Prompt 04's gate cannot be met as written.** The gate says "Check A3 passes when run now", but DECISIONS.md lists "Name who judges the checks that have no executable case here (A3) and how" as still to decide, and contract rule 6 says to stop and ask on any open decision. A strict implementer halts at prompt 04, and prompts 05 and 06 depend on it. I continued and recorded A3 as the implementer's reading only. Suggested fix: for manual checks, make the gate "carried out and recorded, awaiting the owner's judge", or say that the reviewer role may carry it out provisionally.

**F2 (Medium) Running the checks dirties the project and no step may fix it.** `run_checks.py` runs `python3 -I src/main.py`, which writes `src/__pycache__/` as soon as `main.py` imports a local module (STACK.md tells it to). Setup creates no `.gitignore`, T1 may change only `src/main.py` and `src/tally.py`, and `-I` ignores `PYTHONDONTWRITEBYTECODE`. My first T1 commit picked up a `.pyc` file and failed the "no file outside the task's scope changed" gate; I had to amend it and set `sys.dont_write_bytecode` in `main.py`. Suggested fix: have prompt 01 add a `.gitignore` for the recipe, or have the checker run with `-B`.

**F3 (Low) The README mitigation has no owner.** REQUIREMENTS.md says the risk is mitigated by "The README states the counting rule in one sentence", but no task's file scope includes `README.md`, prompt 01 says to write no feature content beyond naming the project and the checks, and prompt 05 says to fix each finding "inside the scope of the task that owns the file". The same is true of `REVIEW.md` and `HANDOVER.md` at the project root. I fixed the README in prompt 05 and noted that no task owns it.

**F4 (Low) Behaviour the requirements leave open, which neither the visible nor the held-out cases settle.**
- Whether a line of only spaces or tabs is "non-empty" (I counted it; many implementers would not).
- Whether "no output" for an unknown option covers standard error as well as standard output.
- Whether a non-option argument such as a file name is "an unknown option" (I refused everything except `--lines`).
- Whether "whitespace" means ASCII only or Unicode, and what to do with bytes that are not UTF-8.
These come from the synthetic spec rather than the exporter, but the bundle gives no place to record such readings other than the report.

**F5 (Low) Setup asks for something Git cannot do.** Step 4 says to create every folder TASKS.md lets a task change, and the gate wants a clean tree with one commit. An empty `review/` cannot be committed, so a placeholder file is needed, which no instruction mentions.

**F6 (Low) Two overlapping reviews with unclear shape.** T3 writes "a written review" into `review/` with no file name, and its prompt step 3 asks for general findings while its deliverable is the scope review. Prompt 05 then writes a second review to `REVIEW.md` at the root. Only prompt 05 asks whether the session wrote the code.

**F7 (Low) `<bundle>` is never defined in what gets pasted.** CONTRACT.md and the prompts use `<bundle>` and name bundle files without saying where the bundle is; only the README implies it. Prompt 06 also does not say where the source archive should go (inside the project it would dirty the tree).

## What worked

The order of work, file scopes, exact cases, the `-I` import note in STACK.md, RECOVERY.md and the checker were enough to build the program without any outside context, and the checker's FAIL output was clear.

---

# Second run: regenerated bundle at `cf820c6` (bundle hash `409d0fb8…`)

Same method, new empty workspace and new project folder (7 commits, final `339a06d`). Bundle changes read from a diff against the first copy: CONTRACT.md, STACK.md, `checks/run_checks.py`, and prompts 01, 04, 05, 06.

## Results

| Case | Expected | Observed | Result |
| --- | --- | --- | --- |
| A1 held-out | `3\n`, exit 0 | `3\n`, exit 0 | PASS |
| A2 held-out | `1\n`, exit 0 | `1\n`, exit 0 | PASS |

Visible cases in a fresh clone: 4 run, 0 failed, A3 skipped. `git status` stayed clean after every check run and at every gate. The held-out marker text is not in the bundle.

## Earlier findings

| Finding | Status | What was observed |
| --- | --- | --- |
| F1 A3 gate vs open judge | Resolved | Contract rule 6 now has the manual-check exception and prompt 04's gate asks for a provisional record. No stop needed. |
| F2 `__pycache__` | Resolved | Checker runs with `-B` and setup writes `.gitignore`; no cache folder appeared and no commit needed amending. |
| F3 README mitigation unowned | Resolved | Rule 10 names the five root files; prompt 05 checks risk mitigations and fixes README.md itself. |
| F4 open readings | Resolved as a process | Rule 9 plus ASSUMPTIONS.md, which prompt 05 reviews and prompt 06 copies into HANDOVER.md. Four readings were recorded. The spec itself still leaves them open, which is the owner's call. |
| F5 empty folder | Resolved | Setup step 4 asks for `.gitkeep`. |
| F6 overlapping reviews | Resolved | T3 writes `review/t3-review.md`, limited to its own checks, with a line on whether the session wrote the code. |
| F7 `<bundle>` and archive place | Resolved | Contract defines `<bundle>`; prompt 06 puts the archive beside the project. |

## New gaps (all Low)

**N1 "Narrower reading" does not always pick one answer.** For "Refuse an unknown option", the narrower reading (only arguments starting with `-`) leaves a bare word such as a file name with no defined behaviour at all, so the implementer still has to choose. For "whitespace", the narrower reading is ASCII only, which is the less useful one for writers. For "no output", it is unclear which reading is narrower. Suggested wording: "take the reading that does less and refuses more".

**N2 The task gates do not mention the ASSUMPTIONS.md exception.** Prompts 02 and 03 still say "No file outside the task's scope changed (`git diff --stat` against the previous commit)". With rule 9 followed, that diff lists ASSUMPTIONS.md. Rule 10 allows it, but the gate line read alone says it fails.

**N3 Leftover `.gitkeep`.** Nothing says whether `review/.gitkeep` should go once T3 adds a real file. Harmless.

## Limits of the second run

- Not blind: by this run the implementer had already seen the first bundle and both held-out cases. The result shows the fixes work and nothing regressed, not a second independent consumption.
- Prompt 05 was again carried out by the session that wrote the code, and REVIEW.md says so. A separate reviewer session was not started.
- The two runs chose opposite readings of "non-empty line" (only spaces counted in run 1, not counted in run 2) and both pass, so the held-out cases do not tell these readings apart.

---

# Third run: prompt 05 by a separate reviewer session (2026-11-10, evening)

PR #152 had merged by then (main `655f5dd`, bundle hash `b572ed29…`, which fixes N1–N3). The reviewer got only that bundle and the run-2 project at its T3 commit `b376e7d`, before my own non-independent review. It did not get my reports, the repository or the held-out cases. Its full REVIEW.md is in the project files at `reviews/p16-independent-review/REVIEW.md`.

## Result

- Gate passed: 4 visible cases run, 0 failed, clean tree. Final commit `a661db8` (5 commits: review, 3 fixes, status).
- I re-ran both held-out cases on a fresh clone of `a661db8`: **A1 PASS, A2 PASS**.
- Code findings: 1 Medium fixed (README did not state the counting rule, the same gap I found in my own runs). Lows fixed: Windows line ends now forced as STACK.md asks, and ASSUMPTIONS.md now names the exact separators. Lows left for the owner: invalid UTF-8 is counted rather than refused, whitespace-only lines are not counted, a closed standard input gives a traceback, and T3's review cites lines that are off by one.

## Bundle gaps the reviewer found (new, all Low)

- **R1** REQUIREMENTS.md A1: the measure says "exit code 0", but A1 case 3 expects exit 2. Exporter-wide: a check's measure can contradict its own refusal case. This comes from the spec text.
- **R2** Prompt 05 says a wrong line in ASSUMPTIONS.md is a finding, but rule 10 lets steps only *add* lines, so the reviewer cannot correct one.
- **R3** Prompt 05 says to fix findings inside the owning task's scope, but `review/t3-review.md` belongs to T3, a role that "changes nothing". It is unclear whether a later step may correct a past review.
- **R4** Prompt 05: "review (change nothing)" sits next to "Write REVIEW.md", and "one commit per repaired finding" does not say how REVIEW.md itself is committed.
- **R5** Rule 9 ("does less and refuses more") still does not settle readings where neither choice refuses anything (whitespace-only lines), or how to refuse when no exit code is defined (invalid UTF-8).
- **R6** "The README states the counting rule in one sentence": it says "rule", but there are two counts. Spec wording.
- **R7** STACK.md's Windows line-end advice is a proposal, so it is unclear whether ignoring it is a review finding.
- **R8** A3 "no file use": it is unclear whether `os.path` on `__file__` (required by STACK.md) counts.

R1, R6 and R8 are spec wording in the synthetic fixture. R2–R5 and R7 are exporter template wording.

## Fixes for R1–R8 (2026-11-11, follow-up PR)

Regenerated bundle hash `9ddeb6ac…` (after the PR review fixes; the synthetic spec is now version 3). Not re-consumed in a clean room; the wording was checked by tests only.

| Gap | Where | Fix |
| --- | --- | --- |
| R1 | Fixture A1 measure; REQUIREMENTS.md template | The A1 measure now names the exit code 2 refusal. A REQUIREMENTS.md with visible cases now says a case's exact output and exit code govern where they differ from the general measure, and the mismatch is reported, not edited. |
| R2 | CONTRACT.md rule 10; prompt 05 | Only the review-and-repair step may correct an ASSUMPTIONS.md line, for a finding in REVIEW.md, saying what it said before. |
| R3 | Prompt 05 | Past task reviews (`review/`) stay as written; a mistake in one is a finding in REVIEW.md. |
| R4 | Prompt 05 | Part 1 changes no file except REVIEW.md; commit order is REVIEW.md first, one commit per fix, then the final status update. |
| R5 | CONTRACT.md rule 9 | Where neither reading refuses, take the one closer to the plain words; where refusing needs an undefined exit code or message, do not invent one, take the non-refusing reading and mark it "owner to decide". |
| R6 | Fixture risk mitigation | The README states how words are counted and how lines are counted, one sentence each. |
| R7 | STACK.md template | The stack is a proposal, but what its notes require is not: a program on that stack that does not do it is a review finding. A way shown “for example” is only one way. |
| R8 | Fixture A3 measure | "No reading or writing of files and no network use"; finding the program's own folder for imports does not count. |
