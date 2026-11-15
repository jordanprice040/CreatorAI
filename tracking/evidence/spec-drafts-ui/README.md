# Draft the spec with a model — browser walk (ADR-0107, fixture)

`walk.mjs` starts the real API (with its fixture discovery worker) and the built web app on a
throwaway database (reviewer ports 4330/5183/4340), seeds the fixture selection with the CLI,
archives its seeded spec so the option can be written again, and uses a loopback stand-in for the
ChatGPT plan that answers the spec draft instructions with a canned draft, edge case or
explanation. The `spec-cases-v1` qualification of the stand-in model is recorded directly in the
database. **Not a live qualification and not a real model's draft**: no model ran.

Run on November 15, 2026 (`walk.json`): 7 of 7 steps pass, no page errors or console errors, and
axe-core WCAG 2.2 A/AA finds 0 violations in the spec form in every state. The walk found two
problems, both fixed before this run: the draft's quieter text fell below 4.5:1 contrast on its
tinted background, and the Explain button ran into "Remove case N" on one line.

| Screen                     | What it shows                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `screens/01-no-route.png`  | Before any model is qualified: how to get one, no Draft button.                                                      |
| `screens/02-draft.png`     | The draft beside the form: the model's notes, the studio's checks in plain words, what the build is checked against. |
| `screens/03-used.png`      | After Use this draft: the check and its cases in the form, held-out ticks from the studio's pick, Explain per case.  |
| `screens/04-edge-case.png` | Add an edge case: the suggestion, why, and "work the expected result out yourself".                                  |
| `screens/05-explain.png`   | Explain this case, beside the case.                                                                                  |
| `screens/07-phone.png`     | 390 px: no sideways scroll.                                                                                          |
| `screens/06-saved-row.png` | The saved spec's Build row: "Drafted by m, checked by you; held-out cases picked at random by the studio."           |

Not walked here: a refused or failed draft, redaction and the drafted mark on later revisions
(covered on PostgreSQL in `tests/src/spec-drafts.test.ts`), and web (browser check) drafts.
