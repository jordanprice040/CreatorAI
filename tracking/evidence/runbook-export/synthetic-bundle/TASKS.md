# Task plan

Tasks in the order to do them. A task may start only when every task it depends on has passed its gate.

| Order | Task | Role | Depends on | Delivers checks | May change |
| --- | --- | --- | --- | --- | --- |
| 1 | T1 — Count words from standard input | builder | nothing | A1 | `src/main.py`, `src/tally.py` |
| 2 | T2 — Add the --lines option | builder | T1 | A2 | `src` |
| 3 | T3 — Review against the scope | reviewer | T1, T2 | A3 | `review` |

## Dependencies

- T1 needs nothing and can start after setup
- T2 needs T1
- T3 needs T1, T2

## Deliverables

- T1: src/main.py prints the word count and refuses unknown options.
- T2: src/main.py accepts --lines and prints the line count.
- T3: A written review of the source against the scope.
