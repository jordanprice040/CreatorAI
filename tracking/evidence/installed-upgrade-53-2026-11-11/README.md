# Installed app upgrade to schema 53 and P18–P22 owner walk (November 11, 2026)

First part of P17 final acceptance. The installed desktop app went from f6e2ba0 / schema 41 to main
e2304be (P18–P22 merged) / schema 53.

## Upgrade

- Build: `pnpm run bundle:windows` in `apps/desktop` from main e2304be. The only local change was
  `.codex/config.toml` (not bundled). The system Node is v22.21.0, but the repository needs 22.23.4 or later.
  The build therefore ran with the OpenJS-signed `node.exe` v22.23.4 taken from the previous staged bundle,
  which has the same SHA-256 as the one the installed app already ships. Installer
  `Creator Agent_0.1.0_x64-setup.exe`, SHA-256 `77AE889F8D9BEA6D1898AF42A39D9FCEE573718F74146C3E30FEAEE06DDA7FB2`,
  bundle-manifest `source_commit` e2304be.
- Backup before the upgrade, taken with the app stopped: `C:\CreatorAgentBackups\installed-pre-e2304be-20261111-031123`.
  It holds `home\` (3,142 files) and `program\` (107 files), and both hash-match the originals. It also holds
  `database.dump`, taken from a scratch copy of the cluster (SHA-256 `FAFCC801…8B23`). That dump was restore-checked:
  the per-table row counts were the same. `row-counts.txt` lists 125 tables, schema 41, and the workspaces
  "Jordan’s Creator Studio" and "Testing".
- Trial: a scratch copy of the cluster on 127.0.0.1:55443 with trust authentication, migrated by
  `packages/db/dist/migrate-main.js` from e2304be. It applied migrations 43–53; there is no migration 42 in the
  source. The result was schema 53 and 137 tables, with both workspaces. Every existing table kept its row count,
  except `schema_migrations` (41 → 52 rows) and `personal_notes`, which migration 46 fills with one row copied
  from the existing `workspace_notes`. The 12 new tables are empty. The counts are in
  `trial-row-counts-after-53.txt` in the backup folder.
- Install: Jordan ran the NSIS installer with `/S` from a normal PowerShell, opened the app from the Start menu
  and clicked "Back up and upgrade". The app made its own backup, `pre-migrate-v41-2026-11-11T08-34-44-787Z`.
  `supervisor.log` shows "service command migrate finished" at 08:34:45Z. `/api/health` returns ok with
  PostgreSQL storage. The live database was not queried, because its password is protected by DPAPI for
  Jordan's Windows account.

## Owner walk of P18–P22 (Jordan, November 11)

Works as intended:
- P19: the Standard/Advanced switch is in the sidebar, and the choice survives an app restart.
- P18: folds work, including Expand all and Collapse all, on Projects › Decide.
- P21: the Model button lists gpt-6-astra (ChatGPT plan: ready for Chat, Explore and Build; not qualified for
  Discover or Assess) and claude-sonnet-5-5 (Claude Code: Chat only). Switching works.
- Seen in screenshots: the Chat "Do a step here" card picker (P20) and the Notes panel (migration 46) are present.
  Jordan's existing note is there.

Issues and requests for review/fix:
1. **Qualify placement.** "Qualify a model for a task" is at the very bottom of Models and connections › Models.
   Jordan suggests moving it up, for example right below the approved model check.
2. **Qualify all / batch qualify.** Jordan asks for a "Qualify all" option, and checkboxes on the tasks that are
   not yet qualified, so the chosen qualifications run in one go. They would still run one after another, so the
   person doesn't have to come back to start each run.
3. **Several started, one running.** Several qualifications can be started (independent review, patch build and
   summarization were all "started"), but only one can run at a time. Each of the others needs its own Run press
   later. This is the same need as item 2.
4. **Start qualification while running.** Jordan reports that "Start qualification" still looks enabled and can be
   pressed while a qualification runs. In `apps/web/src/qualify.tsx` the button is disabled only by
   `locked || !chosen || !pick`, not by a running qualification, so a new one can be started.
5. **Activity badge alignment.** The number in the Activity tab's badge is not centered vertically.
6. **Usage window exhausted.** Jordan asks for a notice when a model's usage window runs out, with an option to
   raise or reset the current window only. Future windows are not changed automatically; the person can change them
   in the model's settings if they want to.
7. **Seen in a screenshot, not raised by Jordan:** Projects › Decide › Automatic assessment shows "The assessment
   packet is too large for one model message." Unlike the evidence and exploration messages, it does not say what
   to do about it (`packages/db/src/selection-store.ts:877`). It also shows that gpt-6-astra has no scoring
   qualification. Worth checking whether a real problem with several options can be assessed at all on the plan
   route.

Jordan withdrew the half-written model-switch request; P21 needs no change.

## Owner walk, second pass: P20 and P22 (Jordan, November 11, Testing workspace)

Works as intended:
- P20: the Getting started card and the Chat action cards work. Getting started and Projects › Path update together
  as steps finish. Several cards can be used in one conversation. Jordan recorded evidence, set up a budget and
  recorded a claim from Chat; the claim card showed "What will happen" before Send.
- The qualification flow worked once the task was allowed: gpt-6-astra qualified for summarization and
  specification writing in Testing (practice 2/2, held out 6/6).

Not testable:
- P22 API key "Test connection": the installed app offers no way to add an OpenAI API key. The route is turned on
  only by the process environment (`CREATOR_LIVE_PROVIDER=openai` and `OPENAI_API_KEY`, see
  `docs/LIVE_CONNECTION_CHECKS.md`). A Start-menu launch of the desktop app does not get those, so "Other routes"
  shows the route as not configured and has no Test connection button. **Gap:** the installed app needs a way to
  add, store (DPAPI, like the plan credentials) and remove an API key in Models and connections.

### Bugs

8. **"Not qualified" with no way forward in Testing.** The Chat discovery card says "gpt-6-astra is not qualified for
   research synthesis, candidate generation, scoring". Discover › Explore for me says the same for research
   synthesis. This persists after a new card, a new conversation and an app restart, and does not happen in
   Jordan's Creator Studio. Likely cause, not verified against the database: qualifications and allowed tasks
   belong to each workspace's connection. Testing's ChatGPT connection allows only Summarization and Specification
   writing, so research synthesis, candidate generation and scoring cannot be qualified there; their benchmarks are
   listed as "not allowed by this connection's settings". The messages are correct but give no way forward (see 12).
9. **Chat answers "No verified model" after verification.** After the plan connection was added and its model
   verified, Models and connections › Chat answers still listed "No verified model". "Refresh connection status"
   did not fix it; only "Reset fields" did. The verified list should refresh by itself, and at least on Refresh.
10. **Qualification state after switching workspaces.** After switching to Jordan's Creator Studio and back to
    Testing, Run was enabled for a qualification that was already running. Pressing it showed "A qualification case
    is still unresolved." That message stayed after the qualification resolved. Page state is kept per mounted page,
    not reloaded per workspace.
11. **Starting a qualification for an already-qualified task**, then pressing Finish, warns that it will record
    every unanswered case as failed. Either don't offer Start for a task that is already qualified, or say that a
    re-run replaces or adds to the existing result.
12. **Assessment packet too large** (item 7, confirmed after scoring was qualified in Jordan's Creator Studio). The
    limit is a fixed 19,000 characters for the whole packet (`MAX_ASSESSMENT_PACKET_CHARS`,
    `packages/domain/src/assessment.ts:41`): all options plus up to 30 claims with their quotes. A real problem
    exceeds it, and nothing the person can do in the UI resolves it. Jordan suggests a way to approve sending a
    larger packet wherever "packet too large" appears. A safer fix is probably to split the packet into several
    requests by option or claim, inside the connection's input cap (24,000 characters on Testing).
13. **Usage indicator not live.** The ChatGPT request count in the top bar sometimes updates only when clicked, for
    example during qualifications. It should refresh periodically or after each request.
14. **Badge number alignment** (item 5) also affects the step numbers on Projects › Path. Check every numbered or
    badge circle.
15. **Fetched passage text.** In the claim card, the passages of one fetched page (Microsoft Learn, Xbox
    Accessibility Guidelines) are mostly page furniture ("Copy Markdown Print", "Note", "Feedback", sign-in
    notices) rather than the guideline text. This may be extraction on that page. It matches the search route
    finding that fetching is the bottleneck.

### Making blocked states fixable where they appear

16. A refusal should offer its fix in place, with a link to Models and connections as a fallback:
    - "Data class private_approved is not allowed on this connection": offer to allow approved private data.
    - "The owner has not accepted the current caps and allowed work": offer to accept them right there, in Chat or
      wherever it shows.
    - "gpt-6-astra is not qualified for …" (Chat discovery card, Discover › Explore for me, Decide › Automatic
      assessment): offer to allow the task and run the qualification right there.
17. Qualify a model for a task: allow a task from this section without scrolling up to Change caps; offer
    "qualify all" across tasks and across models; move the section up (items 1–3).
18. Allowed work should default to all tasks on for a new connection, with the person able to turn some off, and the
    task list should have Select all and Deselect all. *Note:* this changes a deliberate default (least privilege,
    the owner opts in per task class), so it is an owner decision to record as an ADR, not a UI tweak.
19. One approved model check: give an example in the Model box, such as `gpt-6-astra` or `claude-opus-5-5`.

### Feature requests

20. **Copy connections between workspaces.** Copy a workspace's model connections and their settings (caps, allowed
    work, chat answers) to another workspace, then adjust them there. Credentials and qualifications would need
    care: whether a qualification can carry over is a policy question.
21. **Model help per step in Chat.** On an action card, offer to let the connected model fill in or do the step,
    and a "Next step" button that adds the next card in the path.
22. **Automation levels for a project.** Choose which steps are automated when a project starts ("automate
    selection"), switch a running project to automated ("automate the rest"), and have the whole process run by a
    model. Jordan notes that full-process automation seems not to exist yet and wants it. *Note:* this touches run
    modes, permissions and stop conditions (context/HUMAN_OVERSIGHT.md), so it needs a design and owner decisions.
23. **Explore for me in the Chat discovery card**, not only on Discover.
24. **Simpler GitHub connection.** Today it needs a hand-made fine-grained token in the environment. Jordan asks for
    a browser sign-in, like the plan connections (for example a GitHub App or OAuth device flow).
