# Qualify building — browser walk (ADR-0105, fixture)

`walk.mjs` starts the real API and the built web app on a throwaway database (reviewer ports
4330/5183/4340), with a loopback stand-in for the ChatGPT plan whose builder answers with the
`p15-small-signup-v5` reference solution and whose reviewer approves, and the test-double executor
for the qualification harness. **Not isolation evidence and not a live qualification**: no real
model, plan or worker ran.

Run on November 14, 2026 (`walk.json`): 5 of 5 steps pass, no page errors or console errors, and
axe-core WCAG 2.2 A/AA finds 0 violations in the section in every state.

| Screen                     | What it shows                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `screens/01-blocked.png`   | Before both roles qualify: what blocks a start, in the server's words; no Start button.                                     |
| `screens/02-confirm.png`   | The confirm packet: attempts, typical and most requests, fixture note, pass bars, Stop. Nothing was sent before confirming. |
| `screens/03-qualified.png` | After Start: 3 of 3 passed in 6 plan requests, with each attempt's bars.                                                    |
| `screens/04-phone.png`     | 390 px: no sideways scroll.                                                                                                 |

Not walked here: the Build page's web note (unit-tested in `tests/src/web-build-qualification.test.ts`)
and a qualification that fails or is stopped (covered end to end in `tests/src/recipe-qualification.test.ts`).
