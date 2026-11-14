# Final UX pass: findings and proposals (November 14, 2026)

Plan: `docs/FINAL_UX_PASS_PLAN_2026-11-14.md` (approved by Jordan, November 14, 00:57 UTC). Fix PR: #192 (branch `claude/project-thread-x4kr5m`).

**How to answer:** for each proposal in section 4, reply **accept**, **revise** (say how), or **defer**. One reply, such as "accept all but P-9, defer P-5", is enough.

## 1. Summary

- **Where it ran:** a throwaway studio in the cloud container. It used main `5809f09` plus this PR's fixes, schema 62, ports 5183/4330/4340 and the `ux_studio` database. Fixture mode only. It never touched the dev studio, the installed app or any live connection. The live walk on Jordan's PC (plan step 10) is still to come.
- **What ran:**
  - The automated sweep, `scripts/ux-sweep.mjs` (now in the repo). It took 156 shots: 26 tabs in dark Standard at 1440, 1024, 768 and 390 px, plus Advanced and light at 1440.
  - axe-core WCAG 2.2 A/AA on every tab.
  - A keyboard pass.
  - The full fixture walk from an empty workspace through explore, brief, discovery, assess, select and proposal (non-code). Build and the autopilot were walked on the seeded selection workspace.
- **Accessibility:**
  - axe-core found 0 WCAG A/AA violations on all 26 tabs at 1440 px. At 390 px it found one serious target-size issue, on Build.
  - No tab scrolls sideways at 390 px. Focus is always visible, and it is never hidden under the sticky header (WCAG 2.4.11).
  - After the fixes, no button on any tab is under 24 px tall. Checkboxes are still 13 px boxes inside their labels, which counts as a nit (N-12).
- **Findings:** 1 High, 9 Medium, 14 Low and about 25 nits.
  - 22 items fixed in PR #192: section 3.
  - 15 proposals for Jordan: section 4.
  - The nits: section 5.
- **The one High** is a real bug, not polish. A build that stopped for approval fails every time it is started again after the approval (P-1). So the $0 fixture sample never reaches Package or Try from the app.

## 2. Scorecard (my judgment, Nielsen 1–4, 4 = no issue)

Heuristics:

- H1: visibility of status
- H2: match with the real world (plain words)
- H3: user control
- H4: consistency
- H5: error prevention
- H6: recognition over recall
- H7: efficiency
- H8: minimal design
- H9: error recovery
- H10: help

"Before" is the walk before the PR. "After" counts only what PR #192 changed.

| Page                 | H1  | H2  | H3  | H4  | H5  | H6  | H7  | H8  | H9    | H10 | Main gaps                                                                       |
| -------------------- | --- | --- | --- | --- | --- | --- | --- | --- | ----- | --- | ------------------------------------------------------------------------------- |
| Path and Next banner | 3   | 3   | 4   | 2→3 | 4   | 3   | 3   | 4   | 3     | 3   | No proposal branch (P-2); banners were stale on Decide (fixed)                  |
| Discover             | 3   | 3   | 3   | 3   | 3   | 3   | 2   | 2   | 2→3   | 3   | 7,146 px tall, every panel open (P-7); autopilot stops had no next step (fixed) |
| Decide               | 3   | 2   | 3   | 3   | 3   | 2   | 1   | 2   | 3     | 3   | 30 actions to confirm gates (P-4); ids and enums (P-8)                          |
| Approvals (Monitor)  | 3   | 1   | 3   | 3   | 4   | 2   | 2   | 2   | 2→3   | 2→3 | Internal verbs and hashes (P-8); approving your own action (P-3)                |
| Proposals            | 3   | 3   | 4   | 3   | 3   | 3   | 2   | 3   | 3     | 3   | 5 of 7 required sections left to write by hand (P-5)                            |
| Build                | 3   | 2   | 3   | 3   | 2   | 3   | 2   | 3   | **1** | 3   | Build after approval always fails (P-1)                                         |
| Sources              | 3   | 2   | 3   | 2   | 3   | 3   | 3   | 3   | 3     | 2   | Steps in the wrong order on first use (N-8); placeholder misplaced (N-9)        |
| Monitor › Runs       | 3   | 1   | 3   | 3   | 4   | 2   | 3   | 2   | 3     | 3   | Internal page that Start discovery jumps to (P-6)                               |

## 3. Fixed in PR #192

| Id   | Sev    | Fix                                                                                                                                                                                                                                                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1  | Medium | **Autopilot stopped card (K-1).** Every finished autopilot now says what to do next for its outcome, with buttons: Open the exploration, Search the web, Sources and claims, Open Decide, Open Approvals, How much is automated, Open Proposals. This covers Jordan's ask for a clearer next step when automation stops. |
| F-2  | Medium | **Autopilot start box stays ticked** (live findings). The box now always unticks after a start, including one that failed or timed out after the server had begun it, so one more click can't start a second whole run.                                                                                                  |
| F-3  | Low    | **Readable claims before start (K-2).** The summary now says "The explorer can read N claims in this scope; M without a passage are not read", with a link to cite passages.                                                                                                                                             |
| F-4  | Low    | **End time after a start or a stop (K-3)** is worked out again from now.                                                                                                                                                                                                                                                 |
| F-5  | Low    | **Per-run cap (K-9, form side).** The form warns when Model calls in all is more than the plan connection's per-run cap. The server side is in the autopilot automation thread.                                                                                                                                          |
| F-6  | Medium | **Decide's Next banner** said to score after scoring was done, and to record a selection after one was recorded. It now says score first, then select, and that a non-code choice goes to Proposals (not to a spec).                                                                                                     |
| F-7  | Low    | **Approvals** now says, once approved, to go back and press the same button (or its "I approved it" button) again.                                                                                                                                                                                                       |
| F-8  | Low    | **Back to top** button on long pages (Jordan's ask). It appears after one screen of scrolling, sits at the foot of the main column so it never covers the right sidebar, and moves focus back to the page.                                                                                                               |
| F-9  | Low    | **Checkboxes** sat centred on their own line above their sentence (Run it for me and other `label.check` forms). They now sit beside the text.                                                                                                                                                                           |
| F-10 | Low    | **Text buttons** (Sign out, Refresh, Reset fields, Open …, Link claims) were 18–21 px tall. They are now at least 24 px (WCAG 2.5.8).                                                                                                                                                                                    |
| F-11 | Low    | **Doubled labels** "Hybrid: Hybrid: …" and "Human-led: Human-led: …" on Decide, Proposals and the proposal header.                                                                                                                                                                                                       |
| F-12 | Low    | **404** on `problems//explanation` (Decide and Proposals with no problem picked), which logged a console error on every load.                                                                                                                                                                                            |
| F-13 | Nit    | "1 claims attached" became "1 claim attached"; "(fixture).." double period removed.                                                                                                                                                                                                                                      |
| F-14 | Nit    | The view switch repeated inside "Discover from existing claims" is now the compact one.                                                                                                                                                                                                                                  |
| F-15 | —      | `scripts/ux-sweep.mjs` is kept in the repo (Jordan's answer 2) with axe-core as a dev dependency. It puts the person's view mode back when it ends.                                                                                                                                                                      |

Checks run:

- `pnpm typecheck`: passed
- `pnpm format:check`: passed
- the web unit tests (`tests/dist/web-*.test.js`): 242 passed, 0 failed
- a quick sweep re-run at 1440 px (78 shots): 0 axe violations, 0 console errors, 0 failed API requests, 0 buttons under 24 px
- a browser check of the Back to top button (it shows after scrolling, scrolls back and focuses the page) and of the autopilot stopped card

## 4. Proposals for Jordan

| Id   | Sev    | Area           | Problem                                                                                                                                                                                                                                                                                                                                                                                  | Recommended change                                                                                                                                                                                                                                                                        |
| ---- | ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | High   | Build          | The first Start build stops for approval. After approving, Start build again fails with "Repair limit reached … Patch changes nothing", every time (reproduced on a fresh seed). Likely cause: the first attempt already applied the patch, and the web retries from `task.head` (`build.tsx:1111`). The API test retries from the product's first commit, so it never covers this path. | Fix the retry so it starts from the commit the stopped attempt started from, or carries on from the applied patch. Add a test that goes through the web's request shape. This is a bug fix, so I'd do it first, in its own Build thread.                                                  |
| P-2  | Medium | Path           | The Path only knows the software route (spec, freeze, build, try). After a non-code choice it stays on "Record a selection", and it never finishes. It doesn't count selections or proposals.                                                                                                                                                                                            | Branch the Path after Selection. A non-code choice goes to Proposal and then Review; software goes to Spec, Freeze, Build and Try. Add selection and proposal counts to the studio facts.                                                                                                 |
| P-3  | Medium | Approvals      | When the owner records a selection, freezes a spec or starts a build, they then approve their own action on another page. That means a typed reason, coming back, and pressing again: about 8 actions over 2 pages, three times on the main path. It also shows internal verbs such as `candidate.select`.                                                                               | Where the person acting is the one who must approve, show the approval inline: "Record and approve" with one reason box, kept as the same human decision record. Other people's requests still go to Approvals. This stays a human approval (invariant 4); it only removes the page trip. |
| P-4  | Medium | Decide         | Each option needs ethics and access confirmed separately, each with a typed reason: about 30 actions for 5 options. Options that can never be recommended still ask for confirmation first. The reasons they're blocked appear only inside disabled dropdown options.                                                                                                                    | Show first which options can be recommended. Then one "Confirm ethics and access for the options I choose" step, with one reason per gate kind and a per-option tick. Show block reasons as text, not in dropdowns.                                                                       |
| P-5  | Medium | Proposals      | A drafted proposal leaves 5 of 7 required sections "Unknown yet" (objectives, methods, testing, ethics, next tasks), and the person writes them all by hand.                                                                                                                                                                                                                             | An opt-in "Draft the missing sections" button. It uses the chosen model connection, its text is labelled as a model draft, and a person accepts it section by section. With automation on (Jordan's November 14 ask), the autopilot can request the draft too.                            |
| P-6  | Medium | Discover, Runs | Start discovery jumps to Monitor › Runs, an internal page (report ids, step codes, a CLI hint and an unrelated skeptic-review form).                                                                                                                                                                                                                                                     | Show discovery progress in plain words on Discover and Decide, and stay on Projects. Move Runs to Advanced (section 6).                                                                                                                                                                   |
| P-7  | Medium | Discover       | Discover is 7,146 px tall in Standard. Every start choice (Explore, Search the web, Run it for me, How much is automated, theme draft, from claims) is open at once (K-6).                                                                                                                                                                                                               | The start choices at the top open one panel at a time and fold the rest, keeping each panel's state.                                                                                                                                                                                      |
| P-8  | Low    | All            | Internal detail in Standard: full UUIDs, "binds report 178ff266eac9", "grant 0e0a13c4", raw enum names ("not_recommended", "(use_existing)"), "v1" suffixes, passage offsets, "E1 duplicate" codes, "5000000000 nano-USD" (K-7).                                                                                                                                                         | One label map for actions and enums. Ids, hashes and versions shown only in Advanced (and in a "Details" fold). E-codes replaced with the problem's title. Touches many pages, so its own Shell thread.                                                                                   |
| P-9  | Low    | Money display  | Amounts are shown exactly ("99.97259 sim", "0.69665 sim charged"). That is the project's exact-money rule, but it reads as noise.                                                                                                                                                                                                                                                        | Standard rounds to cents, with the exact amount on hover and in Advanced. Stored and compared amounts stay exact. **Your call**, since it relaxes how the exact-money rule is displayed.                                                                                                  |
| P-10 | Low    | Build          | Prepare task defaults the build's run to another project's run.                                                                                                                                                                                                                                                                                                                          | Default to the spec's own run.                                                                                                                                                                                                                                                            |
| P-11 | Low    | Autopilot      | K-4: a run's routine approvals stay in force until their end time after the autopilot has ended.                                                                                                                                                                                                                                                                                         | End the run's routine approvals when its autopilot ends, or offer "End these approvals now" on the stopped card.                                                                                                                                                                          |
| P-12 | —      | Autopilot      | K-10: web claims that pass only the quote check are accepted automatically during an autopilot run.                                                                                                                                                                                                                                                                                      | **Your decision.** My recommendation: keep it automatic only when automation is set to accept web claims, and label those claims "accepted by the autopilot (quote check only)" so a person can review them.                                                                              |
| P-13 | —      | Autopilot      | K-9 (server), K-11, K-12, K-13 and your November 14 automation asks: continue at person-stops, automatic evidence and claim linking, a new-run option for Automate the rest.                                                                                                                                                                                                             | **Already in [Expand autopilot automation options](#cmsg_01Ekfs9asX2KK8f8YWsvsDtFDeUbJ5GivuBajxeRjhbs5H)**, which has its own plan. You made the ethics rule an owner setting (off by default) at 01:31 UTC; it is built there. Nothing to decide here.                                   |
| P-14 | Low    | Sources        | First use: the Next banner says "Fetch approved sources below", but Fetch stays disabled until "Register a run for fetching", whose button sits below the fetch row. Nothing says why Fetch is disabled, and Search the web (the easier route) isn't mentioned.                                                                                                                          | Put "Register a run" (or an automatic evidence run) before Fetch, give the disabled reason beside it, and link to Discover › Search the web. This could be fix-now if you prefer; it changes the order of a form, so I'm asking.                                                          |
| P-15 | Low    | Chat, Sources  | Two styles for the same guidance: Projects tabs use the Next banner, while Chat and Sources use a "Main path: … is next" line.                                                                                                                                                                                                                                                           | Use the Next banner everywhere.                                                                                                                                                                                                                                                           |

Suggested threads, by your answer 3:

- **Build:** P-1 and P-10, first.
- **Decide and approvals:** P-3 and P-4.
- **Path and Proposals:** P-2 and P-5.
- **Discover:** P-6 and P-7.
- **Shell and wording:** P-8, P-9, P-14 and P-15.
- **Autopilot:** P-11 and P-12 go to the existing autopilot thread.

## 5. Nits (no decision needed)

Fixed in the second commit on PR #192:

- N-1: Decide's Uncertainty line listed up to 7 "No claim in the packet addresses …" sentences and a full run UUID. It now reads "Not covered by any claim: who is affected, … and data availability", with the short run id. The stored text is unchanged; there is a unit test.
- N-4: Run names no longer repeat their date ("Autopilot · Nov 14, 2026, 1:07 AM · Nov 14, 1:07 AM"). Unit test added.
- N-6: The "New theme draft" button shows only once a saved draft is open, since the form is already a new draft.
- N-7: The Sources intro is now plain and second person, and points to Search the web. The other intros are left for P-8's wording thread.
- N-10: The Fetch row's run select has a visible label ("under").
- N-11: The brief's "First field / Second field" are now "First subject area (for example nursing)" and "Second subject area", on the form and the Chat card.
- N-12: Checkboxes and radios are 16 px, inside their clickable labels.
- N-13: The "Clear ethics: I confirm" button has space before the next gate's heading.

Checked and left as they are:

- N-5: "Runs : A run finished" is the screen-reader text of the tab's dot (the sweep reads text content). Nobody sees it, and it reads fine aloud.
- N-8: "Register a run for fetching" matches the button's own name. P-14 changes the step itself.
- N-9: The Sources placeholder is in the right column; it only looked centred in a full-page shot. No change.

Moved to P-8, because the text comes from the server:

- N-2: The problem heading repeats the title ("X.: X.").
- N-3: The run-on tie sentence that lists every option.

Left for P-7's Discover layout work, which rebuilds these panels:

- N-14: The blank gap in the autopilot summary.
- N-15: "Reset fields" placement at 390 px.

Re-check after this commit:

- a quick sweep at 1440 px (78 shots): 0 axe violations, 0 console errors, 0 failed API requests, no button under 24 px
- typecheck and format checks pass
- 243 web unit tests pass

## 6. Standard and Advanced

Today, Advanced-only covers Sell, Campaigns, Maintain, Workers and Study. I recommend:

| Tab or panel                                                             | Now      | Recommended              | Why                                                                                                    |
| ------------------------------------------------------------------------ | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Monitor › Runs                                                           | Standard | Advanced (after P-6)     | Internal: report ids, step codes, a CLI hint. The main path should show progress where the work is.    |
| Sources › Library                                                        | Standard | Advanced                 | A browser of every record kind (49 mixed records). The main path reaches records from their own pages. |
| Monitor › Budgets: pricing snapshots, Try a fixture call                 | Standard | Advanced fold            | Setup and diagnostics, not day to day.                                                                 |
| Discover › theme draft                                                   | Standard | Advanced                 | An older, expert way to start; Explore and Search the web cover the main path.                         |
| Discover › Explore, Search the web, Run it for me, How much is automated | Standard | Standard                 | Main path. You want more automation available, so keep these visible.                                  |
| Decide › selection history and assumptions                               | Standard | Standard, folded         | Occasional.                                                                                            |
| Ids, hashes, versions, offsets, exact nano amounts                       | Standard | Advanced only (P-8, P-9) | Internal detail.                                                                                       |
| Activity, Approvals, Proposals, Build, Try                               | Standard | Standard                 | Main path or occasional.                                                                               |
| Models › other routes and qualification detail                           | Standard | Unchanged for now        | Looked fine in fixture mode. Recheck in the live walk with real connections.                           |

## 7. Walk log (fixture, Standard)

| Step                    | Result                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Getting started (Chat)  | Clear 5-step card; one jargon step (N-8).                                                                                         |
| Sources: fetch and cite | Worked after finding Register a run below Fetch (P-14). The claim form's "What will happen" and live "Still needed" were good.    |
| Budgets                 | Clear Next banner; fund and add pricing in 2 clicks.                                                                              |
| Explore for me          | Worked; "Use as a brief" filled the form about 5,500 px further down (P-7).                                                       |
| Brief and discovery     | Worked; Start discovery left Projects for Monitor › Runs (P-6).                                                                   |
| Assess automatically    | Worked, and said what it read and didn't.                                                                                         |
| Decide: gates           | 30 actions to confirm ethics and access for 5 options; 6 wasted on an option that could never be recommended (P-4).               |
| Record a selection      | Approval loop: Record, Approvals with a typed reason, back, submit again. It worked, with no hint on Approvals (fixed, F-7; P-3). |
| Proposal                | Saved, with 5 required sections still unknown (P-5). The Path never moved past Selection (P-2).                                   |
| Software path (seed)    | Spec, freeze (approval loop again), humility review, product and task were all guided well by Build's numbered list.              |
| Build                   | **Failed after approval, every time** (P-1). The sample never reached Package or Try.                                             |
| Autopilot (seed)        | Stopped in 2 s for thin evidence with no next step (fixed, F-1); the form didn't mention the per-run cap (fixed, F-5).            |

## 8. Still to do in the pass

1. (Done) Section 5 on PR #192.
2. An independent review of PR #192 in its own thread.
3. Jordan's decisions on section 4, then one thread per area.
4. The live walk on Jordan's PC: dev studio, Testing workspace, live plan connection, with his typed OK.
5. The audit L-3 docs refresh, last.
6. Jordan's own walk on the upgraded installed app.

## 9. Jordan's decisions (November 14, 02:14 UTC)

Accepted as proposed: P-1, P-2, P-3, P-5, P-6, P-7, P-8, P-10, P-14, P-15, and the Standard/Advanced table in section 6. Monitor › Runs moves to Advanced once Discover and Decide show discovery progress and what to do next (P-6).

Revised or chosen:

- **P-4 (ethics and access):**
  - Keep the eligibility display, the visible block reasons, the per-option checkboxes and one shared reason per gate.
  - A single option can also be given its own reason in the same form. For example, the same ethics reason but different data-access permissions.
  - Record which reason applied to each option and gate.
- **P-9 (money display):**
  - Standard rounds routine amounts to cents.
  - A positive amount below one cent shows as `<0.01` with its unit, so a real charge never reads as zero.
  - The exact value is available by click, tap and keyboard.
  - Wherever Jordan authorizes spending, the exact maximum is shown before he confirms.
  - Storage, comparisons and enforcement stay exact.
- **P-11 (run approvals): automatic expiry.**
  - Routine approvals created for an autopilot run end when the run finishes, fails or is cancelled.
  - A temporary pause that waits for input keeps them, within their original scope and expiry.
  - Separately granted workspace approvals keep their own terms.
- **P-12 (quote-checked web claims):** an automation setting with an explicit default.
  - With automatic acceptance off, quote-only claims are held for human review before discovery uses them.
  - When Jordan turns it on, the autopilot may use them.
  - The label "Accepted by autopilot · quote check only" is carried wherever the claim informs discovery, assessment or a proposal, with the source passage available to inspect.
- **P-13:** stays in the existing automation work, with the ethics setting already decided there.
- **P-5:** opt-in drafting with section-by-section acceptance, as proposed. Suggested methods and future tests are welcome. Unsupported factual claims stay "Unknown yet".

Order:

1. **P-1 and P-10 first.** P-1 is verified through the same UI path that failed: start the fixture build, approve it, resume it, and confirm the sample reaches Package and Try. Keep the regression test using the web request shape.
2. Before the accessibility finding is closed, rerun the 390 px Build check on the fixed candidate.

The live walk on Jordan's PC stays a separate step, with his typed OK.
