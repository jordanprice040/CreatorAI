# Web discovery live check on the dev studio (November 11, 2026)

Jordan approved two live P12 steps on the **dev studio only**: qualify gpt-6-astra on `web-discovery-v1`, then run one "Search the web" discovery if it qualified. Both ran on the ChatGPT plan connection at $0. The API-key route was not used and nothing was spent. The installed desktop app, its database and its data home were not touched.

**Outcome: gpt-6-astra failed qualification (practice 2/3, held out 5/7), so no discovery was run.**

## Setup

| Item                    | Value                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code                    | PR #173 head `a5b2f71` (branch `claude/project-thread-71s9rz`) in worktree `C:\dev\creator_agent_p12`; `pnpm install --frozen-lockfile` and `pnpm build` passed                                                 |
| Database                | `creator_studio` on the dev container (127.0.0.1:55433)                                                                                                                                                         |
| Backup before migration | `C:\CreatorAgentBackups\creator_studio-pre-p12-20261111T141642Z.dump` (pg_dump custom format, 1,118,788 bytes, 1,081 TOC entries)                                                                               |
| Schema                  | 50 before → 54 after (`Applied migrations: 51, 52, 53, 54`)                                                                                                                                                     |
| Start script            | `.creator\studio\start-dev-p12.ps1`, a copy of `start-dev-p22.ps1` pointed at the p12 worktree with the same environment and secret handling. No secret was set and no live switch was used. Log: `dev-p12.log` |
| Workspace               | "Jordan's Creator Studio" (real)                                                                                                                                                                                |
| Connection              | ChatGPT plan, model gpt-6-astra (verified 2026-10-28, availability recheck 2026-11-10: available)                                                                                                               |

## Connection settings change (step 4)

Before the change, the allowed data was synthetic, public and approved private. Allowed tasks were summarization, specification writing, builder and reviewer. **Public data was already allowed. Research synthesis was not**, so the benchmark was listed as "not allowed by this connection's settings".

Through Models and connections › Change caps or allowed work, I ticked **Research synthesis** and changed nothing else. The form said "Will change: Allows research synthesis". Saving withdrew the caps acceptance as designed, and I then pressed "Accept these caps and allowed work". The caps were unchanged: 40 requests a day, 10 per run, 120 s timeout, 16,000 output characters, 2 Codex builds a day.

## Qualification (step 5)

- Record `247c4993-f95c-4315-89a2-b8a072e8350a`, `task_class` research_synthesis, manifest hash `5ba1fc951f00ec03…609460d`.
- Started 14:19:14Z, decided 14:23:57Z. It used 10 plan requests: the connection's 24-hour count went from 6 to 16, with 0 unknown outcomes.
- **Result: failed. Practice 2/3, held out 5/7.** The pass bar is all 7 held-out cases.

| Case                   | Set      | Result | Reason shown                              |
| ---------------------- | -------- | ------ | ----------------------------------------- |
| scout-dev-broad        | practice | Passed |                                           |
| scout-dev-volunteers   | practice | Failed | the answer was not in the required format |
| scout-held-gap         | held out | Failed | the answer was not in the required format |
| scout-held-cross-field | held out | Passed |                                           |
| scout-held-clinics     | held out | Failed | the answer was not in the required format |
| reader-dev-clear       | practice | Passed |                                           |
| reader-held-injection  | held out | Passed |                                           |
| reader-held-off-focus  | held out | Passed |                                           |
| reader-held-contrary   | held out | Passed |                                           |
| reader-held-long       | held out | Passed |                                           |

All 5 reader cases passed. All 3 failures are scout (live web search) cases.

### Why the scout cases failed (observation from the stored answers)

All 5 scout answers were well-formed JSON with exactly the keys `summary` and `leads`. Each lead had exactly `url`, `title`, `why` and `query`. Lead counts were 13, 8, 5, 11 and 8, all under the limit of 20. The difference is the longest `why`:

| Case                   | Result | Longest `why` (chars) | Longest `title` | Summary |
| ---------------------- | ------ | --------------------- | --------------- | ------- |
| scout-dev-broad        | pass   | 234                   | 86              | 375     |
| scout-dev-volunteers   | fail   | **314**               | 138             | 370     |
| scout-held-gap         | fail   | **413**               | 151             | 341     |
| scout-held-cross-field | pass   | 211                   | 159             | 368     |
| scout-held-clinics     | fail   | **315**               | 115             | 306     |

`ScoutOutputSchema` (`packages/contracts/src/web-discovery.ts`) limits `title` and `why` to 300 characters, and the parse is all-or-nothing. The scout prompt (`packages/domain/src/web-discovery.ts`, the JSON shape line) does not state those limits. **Inference:** each failure is one lead whose `why` ran 14–113 characters over the limit. The searches themselves worked, and the reader stage is fine.

Possible fixes, all of which need a reviewed code change and then a fresh qualification. Held-out answers were opened, so ADR-0052 applies to any prompt change:

- state the length limits in the scout prompt;
- or drop or flag only the overlong lead instead of rejecting the whole answer;
- or both.

I changed no code.

## Discovery (step 6)

**Skipped because the model did not qualify.** Discover › Search the web correctly shows "gpt-6-astra is not qualified for web discovery (the web-discovery-v1 benchmark). Qualify it under Models and connections first." No discovery was started, and no claim was added or dismissed.

## Other observations

1. **Evidence sites would block a volunteer-scheduling discovery even after qualification.** The workspace's evidence-site policy is the startup list (`mode: listed`, no Settings change). It contains only the six CSV-checker hosts from `CREATOR_SOURCE_HOSTS`: csvkit.readthedocs.io, framework.frictionlessdata.io, docs.greatexpectations.io, openrefine.org, docs.profiling.ydata.ai and docs.python.org. Pages about volunteer scheduling would be refused at fetch. A real discovery needs Jordan to choose wider evidence sites first, either in Settings or with a different `CREATOR_SOURCE_HOSTS`. Widening access is his decision.
2. **Confusing text: "floor of 1/1".** The result line reads "5/7 held-out cases accepted against a floor of 1/1 (absolute, not baseline-relative)". The row stores `floor {numerator: 1, denominator: 1}` with `min_held_out_cases 7`, so the bar is in fact all 7. The older benchmarks show "a floor of 3/3". The new manifest's floor is a ratio, and the UI prints it as if it were a case count.
3. **The UI is slow to reflect changes.** After "Save changes" and "Start qualification", the page text took a few seconds to update, and the benchmark select showed "Choose a task" again after starting. A first look made it seem that nothing had happened. This was minor and caused no double start.

## State left

The dev studio is running from `C:\dev\creator_agent_p12` through `start-dev-p12.ps1` on ports 5173/4310/4320, with the database at schema 54. The ChatGPT plan connection now also allows research synthesis, and its caps are accepted.

## Second run (v2)

Jordan typed "I OK the live search test" (14:32Z). The fix `e2e2781` changes three things:

- the scout prompt now states the field limits (role version 2);
- over-long text is clipped instead of refused;
- a new benchmark, `web-discovery-v2`, adds fresh held-out scout cases, and the opened v1 held-out cases became practice.

I pulled the fix and ran `pnpm build`, which passed. I restarted the dev studio with `start-dev-p12.ps1`. The migrate check reported "Database schema already current", so the schema stayed at 54.

### Qualification

- Record `6fcf69cb-504d-4993-bc33-0bb543ddb73c`, manifest hash `d3a87d16…c460800dc`.
- Started 14:36:19Z, decided 14:42:19Z. I ran it once. It used 13 plan requests; the connection's 24-hour count went from 16 to 29, with 0 unknown outcomes. Cost was $0.
- **Result: qualified. Practice 6/6, held out 7/7.** The page reads "7/7 held-out cases accepted; 7 of 7 were needed", so the v1 "floor of 1/1" wording is fixed for v2.

| Case                        | Set      | Result |
| --------------------------- | -------- | ------ |
| scout-dev-broad             | practice | Passed |
| scout-dev-volunteers        | practice | Passed |
| scout-dev-gap               | practice | Passed |
| scout-dev-cross-field       | practice | Passed |
| scout-dev-clinics           | practice | Passed |
| scout-held-donations        | held out | Passed |
| scout-held-allotments       | held out | Passed |
| scout-held-school-transport | held out | Passed |
| reader-dev-clear            | practice | Passed |
| reader-held-injection       | held out | Passed |
| reader-held-off-focus       | held out | Passed |
| reader-held-contrary        | held out | Passed |
| reader-held-long            | held out | Passed |

**Scout answer shapes:** all 8 parsed. Lead counts were 10, 8, 6, 11, 10, 6, 13 and 14. The longest `why` per answer was 146–174 characters and the longest `title` 74–116. Nothing came near 300, so the stated limits were followed and **no clipping was needed**.

### Evidence websites

Jordan's choice, relayed by the coordinator, was "any public website". When I tried to set it through Settings › Evidence websites, this machine's auto-mode safety check refused the change. Widening fetch access needs the owner's own typed OK in the session, and I did not work around the refusal. The setting stayed at the six CSV-checker hosts, and I asked Jordan to type the OK or make the change himself.

Jordan then typed "OK set evidence websites to any public website on the dev studio" (14:42:58Z). I made the change through the form: Settings › Evidence websites › Change evidence websites › "Any public website" › Review change › "Allow any public website".

- It was saved as **version 1, "Any public website"**, at 14:49Z. The six CSV hosts remain listed as well.
- The confirm step listed the risks: low-quality pages, sites seeing the IP address, sites' terms, and keeping the setting fixed across study conditions.

### Discovery

Discover › Search the web, run once with:

- interests "volunteer scheduling";
- who it might help "small community organisations";
- defaults for everything else: no question, exclusions or skipped websites; up to 8 pages; up to 8 claims; ChatGPT plan with gpt-6-astra.

The request preview showed exactly what would be sent: `{"focus":{"interests":["volunteer scheduling"],"target_groups":["small community organisations"],"question":null},"excluded_topics":[],"excluded_websites":[],"max_leads":16}`.

The API ran from the `e2e2781` build. A later pull merged main (assessment code only) without a restart.

| Item                  | Value                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Discovery             | `018107d0-ef6c-4d0f-a292-3fbf2329403c`, run `0c1ff13e-7266-41e5-885a-6e1219324577`                                         |
| Started / finished    | 14:49:30Z / 14:50:43Z (73 s)                                                                                               |
| Final state / outcome | **done / claims_found**                                                                                                    |
| Explanation           | "8 claims proposed from 5 pages; 8 passed the word-for-word quote check. 8 checked claims wait for you to add or dismiss." |
| Plan requests         | 2: one search, one read. Cost $0.                                                                                          |

#### Search calls

The UI summary reads "Search: 3 calls, 71 pages consulted".

| Call | Action    | Queries (as reported; duplicates are in the provider's record)                                                                                                                                                                                            | Sources |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1    | search    | "volunteer scheduling small nonprofit spreadsheet challenges food bank volunteers" (×2); "volunteer scheduling community organisation survey availability challenges"; "site.reddit.com volunteer scheduling small nonprofit shifts"                      | 39      |
| 2    | search    | "site.ncvo.org.uk time well spent 2023 flexibility volunteers time commitment" (×2); "volunteer scheduling case study small charity \"spreadsheet\""; "volunteer scheduling \"case study\" \"museum\""; "volunteer scheduling \"case study\" \"shelter\"" | 36      |
| 3    | open_page | none                                                                                                                                                                                                                                                      | 0       |

There were 71 distinct source URLs across the calls. The model wrote `site.reddit.com` and `site.ncvo.org.uk` with a dot instead of the `site:` operator. The provider still returned matching pages.

#### Leads

The UI shows "Pages: 8 chosen of 8 named". All 8 came from search sources (`origin: search_source`), and all have the disposition `selected`. No lead was refused.

| #   | Page                                                       | Host                      | Fetch            | Quality     | Note                                                                    |
| --- | ---------------------------------------------------------- | ------------------------- | ---------------- | ----------- | ----------------------------------------------------------------------- |
| 0   | Lots of users overwriting roster changes                   | reddit.com (r/excel)      | fetched          | **empty**   | "The page has no readable text without running scripts (an app shell)." |
| 1   | Volunteer Scheduling Help                                  | reddit.com (r/nonprofit)  | fetched          | **empty**   | same app-shell note                                                     |
| 2   | The Salvation Army North Toronto Case Study                | volunteerschedulerpro.com | fetched          | usable      | 663 words                                                               |
| 3   | Key findings from Time Well Spent 2023                     | ncvo.org.uk               | fetched          | usable      | 1,837 words                                                             |
| 4   | The Volunteer Workflow System                              | uw.manifoldapp.org        | fetched          | usable      | 240 words                                                               |
| 5   | Kingdom Animal Shelter: Volunteer Scheduling Case Study    | casestudies.com           | fetched          | usable      | 178 words                                                               |
| 6   | How We Built a Scheduling System That Saved 8 Hours a Week | scalogy.com               | fetched          | usable      | 567 words                                                               |
| 7   | Maine's food pantries stare down volunteer shortage…       | apnews.com                | **inaccessible** | not_fetched | HTTP 403                                                                |

That gives 5 usable pages, 2 empty pages and 1 refused. The two Reddit threads were the model's strongest firsthand complaints, and both came back as script-only shells. The empty-page check kept them out of the reading packet.

#### Proposed claims

All 8 proposals have the basis `observation` and the check `verified`, with no reasons listed. All are still **pending**. **I did not add or dismiss any.**

| #   | Title                                                 | Source                           | Supporting / contradicting | Quotes (all "found on the page")                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------- | -------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Paper schedule changes risk lost information          | volunteerschedulerpro.com S1.P11 | 1 / 0                      | "But as soon as you start doing that, and touching the different hard-copy volunteer lists, the chance of missing information or misscheduling rears its ugly head."                                                                                                                                                                                                   |
| 1   | Booking shifts required telephone back-and-forth      | volunteerschedulerpro.com S1.P15 | 1 / 0                      | "Previously, they would have to call someone [and] go back and forth. It was like trying to book a doctor's appointment."; "With VSP, [volunteers] quickly look at the calendar, see what dates are open, and choose"                                                                                                                                                  |
| 2   | Shift reminders previously required individual calls  | volunteerschedulerpro.com S1.P17 | 1 / 0                      | "Rick: Yes - before, we had to phone everybody to remind them about their shift. But with VSP, we enabled the text messaging reminders, as well as the emails."                                                                                                                                                                                                        |
| 3   | Volunteer growth overwhelmed informal scheduling      | casestudies.com S4.P4            | 1 / 0                      | "As their volunteer base more than doubled, scheduling by email and informal sign‑ups became unmanageable, so they selected TCP Software's Humanity work scheduler…"                                                                                                                                                                                                   |
| 4   | Shelter schedule maintenance consumed hours weekly    | scalogy.com S5.P5                | 1 / 0                      | "The staff spent 5-8 hours every week keeping the schedule alive. That is a huge tax on a small team…"                                                                                                                                                                                                                                                                 |
| 5   | Time commitment deters prospective volunteers         | ncvo.org.uk S2.P59, P60, P63     | 1 / 1                      | supports: "Among those who had considered volunteering in the last 12 months, the most common barriers were:"; "thinking it involved more time than they could commit (21%)"; contradicts: "However, experiences of flexible volunteering are largely positive. For example, 82% of those who do volunteer report their organisation is flexible with the time given." |
| 6   | Reduced availability is a leading reason to stop      | ncvo.org.uk S2.P30               | 1 / 0                      | "Most people said less time due to changes in circumstances is the main reason they're stopping. Being unhappy with the way their volunteering group is managed and organised is much less common (10%)."                                                                                                                                                              |
| 7   | Open shifts address shelter coordination difficulties | casestudies.com S4.P5            | 1 / 0                      | "TCP Software implemented Humanity to create open shifts, enable self‑scheduling, and let multiple coordinators manage different volunteer roles without overlap."                                                                                                                                                                                                     |

The proposals' own uncertainty notes point out the following, and Jordan should weigh them before adding anything:

- 6 of the 8 rest on vendor or builder case studies: volunteerschedulerpro, casestudies.com/TCP and Scalogy.
- Each claim has one supporting source.
- The NCVO survey claims are not specific to small organisations.

The "Not covered" list names gaps in prevalence across small organisations, independent outcome measurements, budgets and willingness to pay, accessibility for phone or paper volunteers, and detailed requirements.

### Notes on the check

These are observations, not failures.

- **Claim 5's first supporting quote** is a lead-in sentence ("…the most common barriers were:") that proves nothing on its own. It passes because the check confirms that a quote exists and meets the length rule, not that it supports the statement (ADR-0086 M-2). The second quote carries the claim.
- **Claim 7** describes a vendor's solution, not a problem. Its title, "Open shifts address shelter coordination difficulties", reads as an outcome the source does not measure.
- **Claim 2's statement** says the operation "replaced phone reminders", which the quote supports. Its uncertainty note adds "few schedule holes afterward", which comes from a passage the claim does not quote.

### UI notes from this run

1. **The Settings page has two "Review change" buttons**: the spending ceiling and the evidence websites. A script that targets one by its text picks the wrong one. A person on screen would not hit this, but the ceiling button is disabled with no hint while its form is empty.
2. **Explore for me still says "gpt-6-astra is not qualified for research synthesis (the discovery locator's qualification)"** after the web-discovery qualification. This is correct by design: a web qualification admits only web discovery. But the same task name, research synthesis, now shows as both qualified on Models and not qualified on Discover. Naming the benchmark in both places would avoid the apparent contradiction.
3. **"Add all 8 checked claims"** is the first button under Proposed claims, above the claims themselves. It is easy to press before reading the vendor-source caveats.
4. **"8 claims proposed from 5 pages" next to "8 chosen of 8 named"** is right, because 2 pages were empty and 1 was refused. But the page count that was actually read appears only in the per-lead details.

### State left

- The dev studio is running from `C:\dev\creator_agent_p12` through `start-dev-p12.ps1`. The schema is 54.
- Evidence websites are set to "Any public website", version 1.
- The ChatGPT plan connection allows research synthesis, and gpt-6-astra is qualified on `web-discovery-v2`.
- The connection's 24-hour count is 31 of its 40 daily requests.
- 8 proposals are pending in discovery `018107d0…`.
