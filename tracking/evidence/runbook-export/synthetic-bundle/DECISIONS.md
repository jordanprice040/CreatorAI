# Decisions and assumptions

This file separates what people recorded as decided from what this bundle only proposes.

## Decided and recorded

- **Selection** (2026-11-10, id 00000000): “A local word-count command” (custom software) was selected for a build.
  - Reason: Highest suitability among the options scored
  - Rationale: Build the small local tool (synthetic selection).
  - It would be reversed if: Writers say they will not use a terminal.
- **Requirements frozen** on 2026-11-10 at spec version 2 (freeze 00000000).
- **Should-this-be-software review** (review 00000000, of spec version 2): disposition “build”.
  - The software part: Counting words and lines.
  - The part people keep: Deciding what the count means for the draft.
  - Rationale: Small, local and reversible (synthetic review).
  - Ethics: none identified
  - The studio’s pre-build gate accepts this review for this spec version.

## Proposed by this bundle (not decided)

- The stack in STACK.md (Python command-line program (standard library only)).
- The order of tasks that do not depend on each other (TASKS.md keeps the spec’s order).
- The split into one prompt per task, and the wording of the prompts.

## Assumptions that would change the plan

- The selection would be reversed if: Writers say they will not use a terminal.
- Change course if: The writing app gains a built-in private counter.
- A test that could show this is the wrong response: Three writers try it for a week and go back to the web page.
- Uncertainty recorded with the option: Whether writers will use a terminal at all is not known.
- Trade-off recorded with the option: Writers must open a terminal
- Burden or risk named in review: One more tool to keep installed

## Still to decide (by the owner)

- Name who judges the checks that have no executable case here (A3) and how.
- Run the 2 held-out cases on the finished work; only the owner has them.
- Where and how the result is released, hosted, published or sold. Nothing here decides that.
- The licence for the code, and who may see the repository.
