# Fix plan from the installed-app walk (November 11, 2026)

Source: the 24 findings Jordan recorded while walking P18–P22 in the installed app, schema 53
([record](../tracking/evidence/installed-upgrade-53-2026-11-11/README.md), PR #168). This plan groups them
into fix packages, gives each package's scope, likely files and order, and lists the two findings that change a
safety default as open decisions for Jordan. Nothing here is implemented yet.

Package numbers continue the [November 5 plan](CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md) (P00–P22), so
P23 onwards. Allocate migration and ADR numbers from main when each package starts; on November 11 the next free
are **migration 54** and **ADR-0084**. GitHub Actions minutes are out until about December 1, so every package is
verified locally (`pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway database, and a browser
walk on the reviewer ports), never against the installed app's data.

File references were checked against main `28ebed0`. Causes marked "likely" were read from the code, not
reproduced.

## Where each finding goes

| #   | Finding (shortened)                                            | Package                        |
| --- | -------------------------------------------------------------- | ------------------------------ |
| 1   | Qualify section is at the bottom of Models                     | P23                            |
| 2   | Qualify all, checkboxes for unqualified tasks                  | P24                            |
| 3   | Several started, only one runs; each needs its own Run         | P24                            |
| 4   | Start qualification enabled while one runs                     | P23                            |
| 5   | Activity badge number not vertically centred                   | P26                            |
| 6   | Notice when a usage window runs out; raise current window only | P29                            |
| 7   | Assessment packet too large, no next step                      | P25                            |
| 8   | "Not qualified" with no way forward in Testing                 | P23 (message), P27 (fix there) |
| 9   | Chat answers "No verified model" until Reset fields            | P26                            |
| 10  | Run enabled for a running qualification after a workspace swap | P23                            |
| 11  | Start offered for an already-qualified task                    | P23                            |
| 12  | Packet limit fixed at 19,000 characters                        | P25                            |
| 13  | Usage indicator not live during qualifications                 | P26                            |
| 14  | Badge and Path step numbers misaligned                         | P26                            |
| 15  | Fetched passages are page furniture                            | P12 (online discovery, exists) |
| 16  | Refusals should offer their fix in place                       | P27                            |
| 17  | Allow a task from Qualify; qualify all; move it up             | P23, P24                       |
| 18  | All allowed work on by default; Select all / Deselect all      | P23 + P27 (Decision A: all on) |
| 19  | Example in the approved model check's Model box                | P26                            |
| 20  | Copy connections between workspaces                            | P30                            |
| 21  | Model help per step in Chat; Next step button                  | P31                            |
| 22  | Automation levels for a project                                | P33 after P13 (Decision B)     |
| 23  | Explore for me in the Chat discovery card                      | P31                            |
| 24  | Simpler GitHub connection (browser sign-in)                    | P32                            |
| —   | P22 gap: no way to add an OpenAI API key in the installed app  | P28                            |

## Packages

### First: the qualify flow and the assessment packet

**P23 Qualify section fixes** (items 1, 4, 10, 11, part of 8 and 17; Select all / Deselect all from 18). Small–medium,
web only, no migration expected.

- Move "Qualify a model for a task" up in Models and connections › Models, right below the approved model check
  (`apps/web/src/models.tsx`, the `QualifyModel` mount near line 1015).
- Disable Start qualification while any qualification on the connection is running, and say why. Today the button is
  disabled only by `locked || !chosen || !pick` (`apps/web/src/qualify.tsx:205`); add the `running` list.
- Reload qualification state when the workspace changes (key the component's state on `workspace.id` and the
  connection id), so Run is not enabled for one that is already running and the "case is still unresolved" message
  clears once the case resolves (`qualify.tsx` keeps `runningId`, `error` and `outcome` per mounted page).
- For a task that is already qualified, show "Qualified (date, score)" instead of a plain Start. Offer "Re-run" with a
  line saying what a re-run does: the newest decided qualification is the one that counts (`isQualified`, ADR-0052),
  so a failed re-run replaces a pass. Finish's "every unanswered case is recorded as failed" warning stays for runs
  the person actually started.
- Allow a task from this section: a benchmark that is "not allowed by this connection's settings" gets an "Allow this
  task" button. It goes through the same owner route as Change caps or allowed work, shows the same summary, and
  re-accepts the caps (the version and `caps_accepted_at` move as they do now). No new authority path.
- Add Select all and Deselect all to the allowed-work task list in Change caps or allowed work. This does not change
  the default (that is Decision A).
- Make the "not qualified" messages name the reason when the task is not allowed on this connection
  (`apps/web/src/chat-card-load.ts:240`, `explore.tsx:299`, `discover-defaults.ts:224`), so Testing's state reads
  "research synthesis is not allowed on this connection, so it can't be qualified" instead of a dead end.
- Gate: a browser walk in a fixture workspace shows the section near the top, Start disabled during a run, correct
  state after switching workspaces and back, Allow this task changing the connection version with the summary shown.

**P24 Qualify several tasks in one go** (items 2, 3, rest of 17). Medium; likely **migration 54** (a queue).

- Checkboxes on the benchmarks that are allowed and not yet qualified, plus "Qualify all", for the chosen model; later
  "across models" as a second step.
- The chosen qualifications run one after another, server-side, so the person can leave the page. Store the queue
  (connection, model, task classes, order, who asked, when) and advance it when one finishes; a failure or a refusal
  stops the queue and says where. Each run keeps its own intent, held-out binding and cost record, as now.
- Each queued run is still admitted on its own at dispatch: caps, daily window, $20 runtime ceiling, data class and
  allowed work are checked per run, not once for the batch. A cancelled queue cancels only runs not yet started.
- Show progress in the section and in Activity.
- ADR: the queue and its stop rules (one ADR, number from main).
- Gate: tests for queue order, stop on failure, cancellation mid-queue, crash between two runs (the next run starts
  once, not twice), and admission refusal of a later run after a cap change.

**P25 Assessment packets that fit** (items 7, 12). Medium; domain and db, no migration expected; ADR amending
ADR-0074.

- What the code does now: `buildAssessmentPacket` (`packages/domain/src/assessment.ts`) fits claims into a fixed
  19,000 characters (`MAX_ASSESSMENT_PACKET_CHARS`, line 41) after up to 8 options, and
  `buildAssessment` refuses the whole packet if it is still over (`packages/db/src/selection-store.ts:874`), so the
  preview and the start both fail. The
  options are already sent in batches of up to 4 assessments (`assessmentBatches`, `packetForOptions`), but the size
  check is on the full packet. Likely cause: on a real problem the options and rubric anchors alone fill the
  19,000 characters, before any claim, so claim trimming cannot help. Not yet checked against Jordan's packet.
- Fix: check size per request, not per whole packet. Build each batch's packet (its options, its rubrics, and the
  claims that fit) inside the route's own input cap (`caps.responses.max_input_chars`, 24,000 on Testing) minus the
  role text, and make the batching size-aware (one option per request if needed). Claims are chosen per batch in the
  same order as now, and what was left out is noted in that batch's packet.
- Keep the R08 role text and the `assessment-packet/1` schema unchanged, so the existing scoring qualification still
  applies (ADR-0074 L-3 kept the packet stable for the same reason). The preview shows the number of requests and
  each request's size.
- Only if a single option with no claims still does not fit, refuse with a next step: "Shorten this option's
  rationale or trade-offs, or raise the input cap under Change caps (currently N characters)". That covers Jordan's
  "approve a larger packet" idea through the existing owner cap, not a new bypass: the cap is what the provider route
  accepts, so a packet above it would be refused by admission anyway.
- Staleness, linked-evidence hashes and the start-time re-check stay per assessment; record each batch's packet hash.
- Gate: unit tests for a problem with 8 long options and 30 claims (several requests, all under the cap, nothing
  silently dropped), a single oversized option (clear refusal), and unchanged hashes for a small problem that fits
  in one request today. A live check on Jordan's real problem needs his typed OK (it spends plan requests).

### Then: small polish and stale state (can run beside P23–P25)

**P26 Stale state and small polish** (items 5, 9, 13, 14, 19). Small; web only.

- Chat answers: reload the verified model list on "Refresh connection status" and when a model is verified on any
  connection, not only on Reset fields (`apps/web/src/chat-answers.tsx`, `load()` runs only on workspace or session
  change).
- Usage indicator: it reads every minute and every few seconds after a write "here" (`apps/web/src/usage.tsx`,
  `UsageIndicator`). A qualification or chat request started from another page does not start the fast reads. Send
  one app-wide "usage may have changed" signal after any plan or API request finishes (qualification case, chat
  answer, exploration, assessment) and have the indicator read on it.
- Badge circles: centre the number vertically in every badge and numbered circle (`.nav-count` in `aside.tsx` and
  `main.tsx`, Path step numbers, `.badge` in `apps/web/src/style.css`). Check each at 100% and 125% scaling.
- Approved model check: placeholder in the Model box, for example `gpt-6-astra` or `claude-opus-5-5`.
- Gate: browser walk; a test for the chat-answers refresh.

### Then: fixing a blocked state where it shows

**P27 Fix it here** (items 16, rest of 8). Medium; web, maybe one small API route; ADR (number from main). Needs P23
(Allow this task, qualify in place).

- Each refusal that has an owner fix gets a button next to the message, plus the existing link to Models and
  connections:
  - "Data class private_approved is not allowed on this connection" → "Allow approved private data on this
    connection".
  - "The owner has not accepted the current caps and allowed work" → "Review and accept caps", showing the same
    summary as Models and connections.
  - "<model> is not qualified for <task>" (Chat discovery card, Discover › Explore for me, Decide › Automatic
    assessment) → "Allow and qualify" when the task is not allowed, "Qualify now" when it is.
- Rules: only the owner sees the buttons; each one calls the same route as the Models page and shows the same
  confirmation; nothing is applied without the person's click; a model in Chat can never press them or propose them
  as an action card (ADR-0083 keeps model suggestions to the cards it lists). After the fix the original action is
  re-checked, not assumed to pass.
- Gate: a walk through each of the three refusals in a fixture workspace; tests that a viewer gets no button and the
  route refuses a viewer.

### Then: connections and usage

**P28 OpenAI API key in Models and connections** (P22 gap). Medium; likely a migration for key metadata; ADR.

- Today the API-key route is turned on only by `CREATOR_LIVE_PROVIDER=openai` and `OPENAI_API_KEY` in the API
  process (`packages/broker/src/env.ts`), which a Start-menu launch does not have.
- Add, test, replace and remove a key in Models and connections › Other routes. The key is stored like the plan
  credentials: DPAPI on the desktop (`apps/desktop/src-tauri/src/secret.rs`, `packages/broker/src/plan-vault.ts`),
  never in the database or logs, never shown again after saving (last four characters only). The environment keeps
  working and wins if both exist, with that shown.
- Spending: metered calls stay inside a funded envelope and the $20 runtime ceiling (`config/spending.json`).
- Gate: local tests with a fake key (store, replace, remove, never logged); the live "Test connection" in the
  installed app needs Jordan's typed OK.

**P29 Usage window ran out** (item 6). Small–medium; ADR.

- A notice in the top bar and on the model's card when a connection's request window is used up, with the reset time.
- "Raise this window" changes only the current window's limit (owner action, versioned, with a summary); later
  windows keep the configured cap, which the person can change in the model's settings. "Reset" is offered as the
  same action (the current window's limit raised by what was used); recorded usage is never rewritten.
- The $20 runtime ceiling and funded envelopes are not raised by this; only Jordan changes them.
- Gate: tests that only the current window changes, that a viewer is refused, and that the next window starts at the
  configured cap.

**P30 Copy connections between workspaces** (item 20). Medium; ADR (small policy choices below).

- Copy a connection's settings (caps, allowed work, chat answers settings) from one workspace to another the same
  owner owns; the copy is a new connection with its own version and needs its caps accepted in the target.
- Credentials: plan sign-ins are the owner's own; recommend reusing the stored sign-in only after the owner
  confirms, with each workspace's requests still counted separately. API keys (P28) the same.
- Qualifications: recommend not copying them. They are bound to the connection, prompt and held-out cases, and a
  re-run is cheap; P24's "Qualify all" makes it one step. Copying them would need a decision recorded in the ADR.
- Gate: tests that the copy has no grants, no qualifications, unaccepted caps, and that the source is unchanged.

### Then: Chat and GitHub

**P31 Chat card help** (items 21, 23). Medium; extends ADR-0083 (amend, not new authority).

- "Next step" on a finished card adds the next card in the Path.
- "Fill in with <model>": the connected model proposes values for the card's fields from the conversation; the person
  sees them in the card and still presses Send. The model never sends a card.
- "Explore for me" offered on the Chat discovery card, using the same route and grant as Discover › Explore for me.
- Gate: the Chat walk from P20 again, plus refused and study-run actions staying refused.

**P32 Simpler GitHub connection** (item 24). Medium–large; owner-gated.

- Options to record in an ADR: OAuth device flow (browser sign-in, a user token, simplest for one person) or a GitHub
  App (scoped installation, needed for check runs; ADR-0027 and the P22 follow-ups already note this).
  Recommendation: GitHub App, since P22 found check runs need it, with the device flow only if the App setup proves
  too heavy for one person.
- Live trial needs Jordan's typed OK and a new private test repository, as in P22.

### Elsewhere

- Item 15 (fetched passages are page furniture) belongs to P12 online discovery; the search route investigation
  already found that fetching is the bottleneck. Add the Microsoft Learn page as a test case there.

## Order

1. In parallel: **P23** (qualify section), **P25** (assessment packets), **P26** (polish). Different areas:
   `qualify.tsx`/`models.tsx`, `assessment.ts`/`selection-store.ts`, and small web files.
2. **P24** (qualify several) after P23, since both change the Qualify section.
3. **P27** (fix it here) after P23. The new all-on default (Decision A) goes in P23; P27 adds the allow buttons for
   connections that do not have every task allowed.
4. **P28** (API key) and **P29** (usage window), in parallel.
5. **P30** (copy connections), then **P31** (Chat card help).
6. **P32** when Jordan wants it and gives the live OK.
7. **P12** (online discovery) through the model connections, then **P13** as a priority once P12 is merged (Jordan,
   November 11), then **P33** (automation levels, including the whole process) right after P13.

Jordan's timing (November 11): P12, P13 and the automation levels should be ready by the next user-testing phase,
which can start once these fixes are made. So the target set before that test is P23–P31 plus P12, P13 and P33;
P32 (GitHub sign-in) only if he gives the live OK in time.

### P12 route (Jordan, November 11)

"Browsing should be done through model connections rather than API calls to a browser, which can be left as a
possibility for the future." This matches the smallest architecture in the
[search route investigation](SEARCH_ROUTE_INVESTIGATION_2026-11-10.md) (section 7, PR #157):

- Discovery uses the connected model's own web search on the plan connections (the ChatGPT plan route first, with
  the URLs it consulted recorded separately from its text; Claude Code's web search as an optional second route).
  The model's prose is a draft, never evidence.
- Evidence is unchanged: the guarded fetcher re-fetches each chosen URL under the workspace's evidence-site policy,
  stores passages with locators and hashes, and claim support must quote stored text. Item 15 (page furniture in
  passages) is fixed in that extraction step.
- No search or browser API is bought or turned on; the Brave adapter stays disabled as the future option. The
  earlier paid-provider shortlist (Tavily, Mojeek, Brave) is set aside.
- The request side already exists: PR #157 added an opt-in `web_search` option to plan requests
  (`packages/broker/src/plan-responses.ts`), smoke-tested live on November 10 (section 13 of the report), but no route,
  UI or workflow passes it yet. P12 wires it into discovery, records each search call and source URL, and adds the
  claim-admission stage that P10 left for P12.
- Live runs from the app need Jordan's typed OK, inside the $20 runtime ceiling.

## Open decisions for Jordan

Both change a safety default, so each needs Jordan's choice and an ADR before any code.

### Decision A: allowed work on by default (item 18)

Today a new plan connection allows only Summarization and Specification writing (`apps/web/src/models.tsx:67`
and `:91`), and the owner opts in per task class. That is least privilege on purpose: a connection can only be
used for work the owner chose, and nothing runs until the owner accepts the caps.

| Option                                                  | What changes                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1. Keep the default, remove the friction (recommended) | Same default. Select all / Deselect all (P23) and "Allow this task" wherever a refusal shows (P27) make opting in one click where it matters. Nothing is allowed that the owner did not choose.                                                                               |
| A2. All on for new connections                          | New connections start with every task class ticked; the owner can untick before accepting. Caps acceptance is still required, so nothing runs without the owner's OK. Existing connections unchanged. Code build (`code_build`) and the approved-private data class stay off. |
| A3. All on, including existing                          | As A2, and existing connections are offered "Allow all" once. Most convenient, widest change.                                                                                                                                                                                 |

Why A1: it fixes what Jordan actually hit (dead ends, scrolling, one task at a time) without widening any
connection's use. A2 is a reasonable choice too, since caps acceptance remains the gate.

**Jordan, November 11 (typed in the planning thread):** A2 plus the buttons. "I like the one click allow buttons
and I think they should be implemented for when the user does not have all of the allowed-work already selected,
but I am still going with the decision to have all the allowed-work selected by default and the user can unselect
and reselect them as desired." Recorded as:

- New connections start with every task class allowed, including code build; the owner can untick and re-tick any of
  them, and caps acceptance is still the gate before anything runs. This change goes in P23 with an ADR (number
  from main) amending the least-privilege default.
- Data classes are a separate setting and keep their current default: approved private data stays opt-in, through
  its own "allow" button (P27).
- Existing connections keep what they allow. Where a task is not allowed, the one-click buttons (P23, P27) offer it.

### Decision B: automation levels for a project (item 22)

Jordan wants to choose what is automated when a project starts ("automate selection"), switch a running project
to automated ("automate the rest"), and have a model run the whole process. This touches run modes, permissions
and stop conditions (`context/HUMAN_OVERSIGHT.md`). Today P10 routine approvals (ADR-0079) already let one owner
policy admit covered steps of one run, with limits, an end time and stop conditions. The whole process from
evidence to build is P13, which needs P12 (fetching).

| Option                                           | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1. Presets over routine approvals (recommended) | A project gets an automation level: Manual, Automate selection, Automate the rest, Whole process. Each level is a P10 routine-approval policy preset (stages, limits, end time, stop conditions) shown as one summary the owner confirms. "Automate the rest" sets that policy on a running project. Whole process becomes available when P13 lands. External effects (publish, payments, messages, GitHub merges) and value questions are never automated. |
| B2. Only "automate the rest" now                 | Add the mid-run switch using P10 as it is; no project-level presets; whole process waits for P13.                                                                                                                                                                                                                                                                                                                                                           |
| B3. Defer until P13                              | No change now; design automation levels together with the unattended workflow.                                                                                                                                                                                                                                                                                                                                                                              |

Why B1: it reuses the deterministic policy and recording that already exist (a model never grants itself
authority), gives Jordan the choices he described, and leaves the whole-process level honestly marked as waiting
for P13. Either way, study runs keep their frozen condition; an app automation level never changes a study run's
recorded mode (thesis protocol).

**Jordan, November 11 (typed in the planning thread):** "I would still like to automate the full process, so
that should be noted to follow P13 and P13 should be considered a priority to be carried out once it is viable to
do so." Recorded as:

- Whole-process automation is wanted. It is planned as **P33**, directly after P13.
- **P13 is a priority** as soon as it is viable. It becomes viable when P12 (online discovery, fetching) is merged,
  and P12 still waits on Jordan's choice of its scope. P13 then starts ahead of the remaining packages in this plan.
- The partial levels (Automate selection, Automate the rest) follow B1 and are built in P33 with the whole-process
  level, unless Jordan asks for them earlier.

A smaller choice inside P30 (whether qualifications can be copied between workspaces) is recommended "no" above
and only needs Jordan's input if he wants it.
