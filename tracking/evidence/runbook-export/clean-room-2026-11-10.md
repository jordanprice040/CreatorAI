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
