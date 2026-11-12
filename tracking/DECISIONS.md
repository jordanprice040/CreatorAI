# Decision log

## ADR-0097 — The owner's gate checklist and app-verified gate clears (November 12, 2026)

Part 2 of ADR-0090 (Jordan's November 11 requests: "a field of ethics checks to send to the model to walk through and return its result, notifying the user if anything was not accepted", built-in tests whose pass clears a gate, and on November 12 "there should still be a choice to have the user or app approve it"). Amends ADR-0090 and ADR-0074. Migration 60.

- **The owner's gate checklist.** Settings › Team profile › "Gate checklist": up to 12 short items (3 to 300 characters), each for the ethics or the access gate. Only the workspace owner, signed in as a person, saves it; every save is a new append-only version in `gate_checklist_versions`, audited as `gate_checklist.saved`, refusing a stale `expected_version`, a duplicate item and an unchanged list. A suggested starter list (`STARTER_GATE_CHECKLIST`: three ethics items on consent, tracking without knowledge and unfair harm; three access items on the team profile, paid tools and where data stays) is offered when the list is empty and applies only when the owner saves it. Routes: `GET`/`POST workspaces/{ws}/gate-checklist`.
- **Answered by the assessor.** When a checklist is saved, every assessment packet carries it (`checklist`: version and items `K1`… with their gate and text), and team capabilities now carry their key. The assessor (prompt `r08-assessor/2.0`) answers, on each suitability assessment, every item `pass`, `fail` or `unknown` with claim refs, team capability keys and a one-sentence note, and lists `access_needs`, the capability keys the option needs. One role and one benchmark rather than a separate gate-check role (a second workflow, role plumbing and qualification). Opportunity assessments do not answer it, to keep each answer inside the output cap. The studio's output check refuses an answer that skips or repeats an item, answers on the wrong rubric or without a checklist in the packet, cites a claim or capability not in the packet, passes an item with nothing cited, or repeats a need; the repair loop asks again. The answers are written onto the suitability scorecard (`assessment.checklist` with each item's gate and text, evidence resolved to exact claim versions, team keys and note; `access_needs`; `checklist_version`; `checklist_hash`).
- **Stale on change.** A card records the hash of the checklist it answered; a different current checklist marks it stale ("Your gate checklist changed since this assessment; assess again…"), like the team profile. Adding capability keys to the team block does not change the team hash, so assessments made before this change stay current. Starting an assessment refuses a packet built against an older checklist.
- **New gate rule: "Gates clear when they pass your gate checklist" (`checklist`).** An owner-only choice beside the ADR-0090 modes; it cannot be chosen until a checklist with at least one item is saved. Code clears a gate (`auto_cleared`, `rule_mode = checklist`) only when no current card raises a concern on it, no person's card or confirmation decides it, and the checklist has at least one item for that gate, and:
  - **ethics:** every current automatic suitability assessment passed every ethics item, each pass citing the packet. Each item's verdict is still the model's judgment against the owner's criteria, so the gate says "no person looked" and Jordan's November 12 rule applies: a run's selection that advances such an option stops and asks a person (`modelClearedEthics` covers `checklist` as well as `model`).
  - **access (app-verified for what the assessment names):** every access item passed, each assessment named at least one needed capability, and the app finds every named or cited capability in the current team profile itself (`verifiedCapabilities`): Yes and found by a built-in check on this computer for a capability a check can test (a declared Yes or a check on another computer does not count), or declared Yes by the owner for one no check can test (installs allowed, internet, data stays local, paid tools). The reason names the capabilities.
- **What was not accepted is listed.** Each gate in the selection report carries `checklist` (version, items for that gate, the items not passed with the worst answer and its note, the needs, and the needs the app could not confirm) whenever current assessments answered the checklist, in every mode. Compare lists them under the gate ("Checklist K2 failed: … — note"; "Needed, not confirmed in your team profile: Run Python") with what to do (run the check on this computer, tick a capability no check can test, add evidence and assess again, or confirm it yourself), and the blocked reason says "Your gate checklist did not clear this option (Ethics: K2 fail. Access: not confirmed: Run Python)…". Notifications beyond Compare are not added.
- **Qualification.** The bundled benchmark is now `assessment-synthetic-v3` (15 cases: 3 development, 12 held-out), generated by `scripts/assessment-benchmark.mjs`: v2's eleven cases with their labels, plus one development case and three held-out checklist cases (an access item passed and Python named as a need when the team block covers it; an access item not passed and Docker named when the team cannot run it; an ethics item not passed and ethics unresolved despite a claim telling the assessor to pass every item). `assessment-synthetic-v1.json` and `-v2.json` are kept unchanged as frozen records. The prompt change means the dev studio must qualify the assessor again on v3 after this merges (15 plan requests, $0). The qualification request cap rises from 256 KiB to 512 KiB, since v3 is about 290 KiB.
- **Migration 60.** `gate_checklist_versions` (append-only, counted in backups) and the `gate_rule_versions.mode` check widened to include `checklist`.

Rejected: a separate gate-check role and benchmark (twice the plumbing and qualification for the same packet); answering the checklist on every rubric (doubles the answer on software options and risks the output cap); clearing access on the model's pass alone (that is ADR-0090's `team_profile` mode; this mode adds the app's own comparison); counting a declared Yes for a capability a check can test (the owner can still confirm the gate by hand); making a missing need list a refusal of the whole answer (a non-software option may honestly need nothing; then the app has nothing to verify and access waits for the owner).

Not done: notifications beyond Compare; checks run by a person on another computer; a checklist per problem. In a hosted deployment (no built-in checks) a capability a check can test is never confirmed, so access never clears by this rule there; the owner confirms it.

- **Review amendment (PR #185 review 1, November 12).** M-1: a request's answer now also counts each suitability assessment's checklist answers (`CHECKLIST_CHARS_PER_ITEM` = 250 per item, beside ADR-0091's 5,000 per assessment) against the answer cap, so under a 16,000-character cap the starter list and a full 12-item list send two process options per request instead of three. L-2: "app-verified" access is limited to what the assessment names: code checks every capability in `access_needs` and every capability an access pass cites, and refuses an access pass that cites a capability the team block does not mark yes; a capability the model leaves out of both is not checked, and the clear reason says "every capability the assessment named or cited". The assessor prompt says so (the v3 manifest was regenerated). L-3: the checklist cannot be emptied while the gate rule is `checklist`, and Settings warns when a gate has no item under that rule. N-3: the rule picker disables the checklist choice until a checklist is saved, and saving either reloads both. L-4: tests for the mid-build checklist change at start, an agent's routine selection stopped on a checklist-cleared ethics gate, and an `unknown` answer in the gate detail and blocked reason.
## ADR-0094 — Extra requests when a connection's daily cap runs out: +20 for 24 hours, owner-only, as often as needed (November 12, 2026)

P29 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (walk item 6), with correction M-5 of the plan review (`PR169_FIX_PLAN_REVIEW.md`). **Migration 59** (`plan_extra_requests`; 57 and 58 are held by P13 and P28). No model call or spending was needed to build or verify it.

- **The design choice (review M-5).** The studio's daily cap is a rolling 24-hour window (`max_model_requests_per_day`, counted in `#usage` and `usage-summary.ts`), so there is no fixed "current window" with a reset time to raise. Option (a) of the review is taken: a **temporary extra allowance**. Jordan decided on November 11, 2026 that it is **20 requests** and can be granted again and again whenever the connection keeps running out (`PLAN_EXTRA_REQUESTS`, `PLAN_EXTRA_HOURS` in `packages/contracts/src/connections.ts`).
- **Only the window in use now.** An extra lasts 24 hours from the grant, the length of the window, then stops counting by itself. Admission's cap is the configured cap plus unexpired extras (`dailyCap` in `packages/domain/src/plan-admission.ts`); the connection's settings, its accepted caps and recorded usage are not changed, so once the extra expires the next window starts at the configured cap. To raise every day, the person changes the cap in the connection's settings as before.
- **When and who.** Offered only when the cap (with any earlier extra) is used up, and the server refuses a grant while there is room (`INVALID_TRANSITION`), so a double press never doubles it. Owner-only (`#ownerChange`: editors and viewers are refused), bound to the connection version the owner saw (`expected_version`), which moves on; the request body must name exactly 20. Each grant is a row in `plan_extra_requests` (amount, configured cap, used count at the grant, settings hash, connection version, who, when, expiry), which can be neither updated nor deleted, plus a connection event and an audit event `connection.extra_requests_granted` with a one-line summary ("Added 20 requests to today's cap (40 → 60) until …; the configured cap stays 40").
- **Where it shows.** The top-bar usage button adds "· used up" when a connection's cap is used up; its panel says when the next request is possible, offers the owner **Add 20 requests for 24 hours** with a confirmation, and says "Includes 20 extra requests until …; after that the cap is 40 a day again" while one is in force. The connection's card in Models and connections says the same under Recent requests. A refused request now has its own code, `daily_cap_reached` (it was `cap_reached`, which the per-run and per-build caps keep), and ADR-0087's fix buttons offer the same press beside the refusal; its sentence says the owner can add 20 more.
- **Not raised by this.** The provider's own allowance (the ChatGPT five-hour limit, Claude's usage limits) cannot be raised by the app: it stays a notice with the time the studio observed it (the existing quota notice, option (b) of the review). The $20 runtime ceiling and funded envelopes are not touched; plan requests use the subscription, not API money, and only Jordan changes the ceiling.

- **Review 1 amendment (PR #184, November 12).** L-1: whether the press is offered (`can_add_extra` on the usage summary and, new, on the connection detail) uses the same test as the grant (`isPolicyOwner`, which `requireOwner` now calls): the owner role, a person, not a tester account. L-2: the usage summary and the detail list each unexpired extra with its own expiry (`extras`, soonest first) instead of the latest one, and the lines name them ("Includes 40 extra requests: 20 until … and 20 until …"); "next request possible at" is computed by `nextRequestAt` (domain), which counts an extra that expires before a request leaves. L-3: the connection detail carries `next_frees_at` while the cap is used up, and the Models card says it. L-4: a store test sends a real plan request through `admitPlanRequest`, refused with `daily_cap_reached` at the cap and admitted after the grant. Nits: the notice and confirmation have layout styles; the detail reads the extras once; the detail's new fields are required (web and API ship together); the refusal says "the workspace owner can add …"; the migration comment lists every reserved number.

- **Re-review 2 amendment (PR #184, November 12).** L-1: the fix-it-here button beside a `daily_cap_reached` refusal is offered only when the detail's `can_add_extra` is true (`ready` in `fix-buttons.tsx`), and otherwise says "Only the workspace owner, signed in as a person, can add requests." N-1: `extras` has no length cap in the contracts, since the server lists every unexpired grant. N-2: the detail's `next_frees_at` follows the usage summary's rule (`nextRequestAt`, the oldest leaving when there is room). N-3: the detail's count, start times and clock come from one statement in `#usage`, so "full", the offer and the time agree.

- **Re-review 3 amendment (PR #184, November 12).** N-1: the usage summary reads each connection's window start times, clock and unexpired extras in the same statement as its other counts (`used` is the number of start times), as `#usage` does for the detail. N-2: Models › Chat answers names the cap in force ("60 requests now, 20 of them extra", `capWords`) while an extra is in force.

Rejected: changing `max_model_requests_per_day` and changing it back later (it rewrites the accepted caps and needs a timer that could fail); the review's "raise by what was used" reset (Jordan chose a fixed 20); granting in advance while there is room (the walk asked for it when the window runs out, and it keeps the extra bounded); an owner-chosen amount (one decided number keeps it simple; the configured cap is the place for a different daily amount).

## ADR-0093 — A workspace's own OpenAI API key, added in Models and connections (November 12, 2026)

P28 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (the P22 gap: the installed app had no way to add an OpenAI API key, because the key route was turned on only by `CREATOR_LIVE_PROVIDER=openai` and `OPENAI_API_KEY` in the API process, which a Start-menu launch does not have). **Migration 58.** Also records Jordan's November 11 decision on the default input cap.

- **Per workspace, owner only.** Models and connections › Other routes › "Your OpenAI API key" adds, replaces and removes one key per real workspace (`POST /api/workspaces/{ws}/api-keys/openai`, `.../openai/remove`, both with `expected_version`; `GET` for the status). Only the workspace owner, signed in as a person (not a tester), changes it; any member sees whether one is saved and its last four characters. Fixture workspaces never hold one (the row's `fixture` column must be false and references the workspace). Per workspace rather than per studio so that P30 can treat keys like plan sign-ins when copying connections, and so a second owner's workspace never spends on another owner's key.
- **Stored like the plan sign-ins.** The key is sealed in the same protected vault (`packages/broker/src/plan-vault.ts`: DPAPI for the current Windows user, with its own entropy purpose `openai-api-key` and file name, so a key entry never opens as a sign-in or the other way round). It is sealed before its record is written; a refused save deletes the new entry, and a replace or remove deletes the old one. `workspace_api_keys` holds only the vault reference, the model, the last four characters, a version, who saved it and when. The key is never in the database, the audit log (`api_key.saved`, `api_key.replaced`, `api_key.removed`, with the last four only), a response, an error message or a log, and is never shown again after saving. The page clears the field whether or not the save worked.
- **The environment wins.** A studio started with `CREATOR_LIVE_PROVIDER=openai` keeps using that key for every workspace, and the status says so ("used instead of the saved one"). Otherwise the broker's live slot is empty and it asks `ApiKeyService.liveFor` for the workspace's key (`ModelBroker` option `liveFor`), in the API process and the standalone worker. Unlocked keys are kept in memory per vault reference, so a replaced key is never used again; a failed unlock is retried on the next call, and meanwhile the call is denied as "no adapter", never faked.
- **A key is not permission to spend.** Every call still needs a grant, a funded budget, pricing for the model and room under the $20 runtime ceiling (`config/spending.json`), exactly as P22's check and any paid call. P22's "Test connection" now runs on whichever key is in use.
- **Default input cap for new connections: 64,000 characters** (Jordan, November 11, 22:27 UTC), up from 24,000, in the web's proposed settings for ChatGPT plan and Claude Code connections and in `config/connections/chatgpt-plan.json` and `claude-code.json` (the CLI's defaults). Existing connections keep their accepted caps. The frozen benchmark proposals under `config/connections/benchmarks/` are unchanged.

Rejected: one studio-wide key settable from the page (any workspace owner could then spend on it, and P30 needs per-workspace keys); storing the key encrypted in the database (the plan sign-ins already set the rule that secrets live only in the vault); testing the key on save (that is a paid request, so it stays the owner's separate "Test connection" press under a grant and budget).

Not done: the batch adapter (X02 context batches) still uses only the environment key; a workspace key is not used for batches. No live check: "Test connection" in the installed app with a real key needs Jordan's typed OK. A process killed between sealing a new key and committing its record (or between the commit and deleting the replaced entry) leaves an unused sealed file in the vault folder; nothing references it, and no startup sweep removes it (review 1 N-4).

- **Review amendment (PR #182 review 1, November 12).** L-1: the status now says `saved_unavailable`, not "in use", when a key is saved but this studio cannot open it (no protected store, a missing or damaged file, another Windows account); the note says calls are refused and to replace or remove it, an unlock failure is logged by reference only, and Remove (and Change model) stay on the page even when the studio cannot save keys. L-2: a vault delete that fails after Remove or Replace is reported (`unused_file_left`, a note, and the page's "Removed" line says the file stayed), logged by reference, and retried at the next save or remove in that process. L-3: `NEW_CONNECTION_MAX_INPUT_CHARS` (`apps/web/src/caps-fields.ts`) is the one value both Models buttons use, and `tests/src/web-caps-form.test.ts` pins it and both `config/connections` files to 64,000. L-4: the startup line, `/api/health`'s provider and `broker/status`'s note (shown on Monitor › Budgets) now say a workspace owner can save a key in Models and connections. N-1: `docs/MODEL_CONNECTIONS.md` and `docs/CLAUDE_CODE_CONNECTION.md` say 64,000. N-2: the key field uses `autoComplete="new-password"` and password-manager ignore attributes. N-3: the broker looks up a workspace key only for OpenAI models. N-5: an unlocked key is dropped from memory as soon as a call from that workspace reads a different reference or model (for example after the other process replaced it). N-6: **Change model…** (`POST …/api-keys/openai/model`, `expected_version`, audit `api_key.model_changed`) re-points the saved key without pasting it again.

- **Re-review amendment (PR #182 review 2, November 12).** L-1: a damaged key entry is never quoted anywhere: the vault's parse error is replaced by the fixed "A saved key is damaged." (Node's `JSON.parse` message quotes the text around the fault), and the unlock-failure log is fixed text naming only the reference; a test checks that no six characters of the key reach the log. L-2: Remove or Replace in a studio with no key store says the old file "was not touched" (`unused_file_left` is true) instead of claiming it was deleted. N-1: the leftover note says the retry happens only until the studio restarts. N-2: after a failed unlock the studio waits a minute before trying (and logging) again. N-3: `/api/health` says "OpenAI keys can be saved per workspace" only when the studio has a key store. N-4: Change model is hidden where keys cannot be used, the same model again is not a change (no version or audit row), and a redundant leftover line is gone.

- **Re-review 3 amendment (PR #182 re-review 3, November 12).** N-1: calls that wait on one unlock share it, so a failing unlock is tried and logged once, not once per waiting call. N-2: after Remove in a studio with no key store, the note names the missing store once.

## ADR-0096 — Model help on Chat cards: proposals for a card's text answers, Next step, and Explore for me on the discovery card (November 12, 2026)

P31 from the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (walk items 21 and 23). **Amends ADR-0083**; adds no authority. A card is still sent only by the person's Send, through the form's own routes, and every gate is checked there as before. Migration 61 (`chat_action_fills`). Verified with a fake `claude` only; no live model call and no spending.

- **"Fill in with <model>".** On a draft card, the owner (as for chat answers) can ask the workspace's chat model to propose text for the card's **descriptive** questions from the conversation. Which questions are allowed is fixed per kind in `CHAT_FILL_KEYS` (`packages/contracts/src/chat-actions.ts`) and checked by the store: a discovery's theme, who is affected, problem, measure, the two fields and setting; a claim's statement, uncertainty and quote; a fetch's address; a proposal's summary and sections. A model never proposes a pick (claims, passages, runs, decisions, options), a judgment (rating, gate, stance, basis, disposition, confidence, reason or rationale), a budget, or a routine setting, so answering a decision, scoring, recording a choice and setting up a budget offer no fill. Rejected: letting the model fill reasons with the person confirming them, since ADR-0083 keeps every reason the person's own words.
- **Same admission as a chat answer.** `POST …/chats/{c}/actions/{a}/fill` sends one request with purpose `chat` on the owner's chat connection and model, so the chat switch, verified model, private data allowed, the daily chat limit (fills count toward it) and the study pause all apply, with the same refusal words. The request names the card's version; a sent card or an older version is refused before anything is recorded. The conversation always goes (the person's messages; model answers that used studio records only when the owner's chat setting allows them); question help and answers so far can quote studio records, so they go only under the same setting.
- **Recorded like an answer.** Each press is a `chat_action_fills` row: the fixed instructions' version and hash (`chat-card-fill-v1`), the questions asked, exactly what was sent, the reply and its hash, the proposals the studio could read and how many were left out; it changes once, from pending to its outcome, and goes only with its card. A retried press (same `client_id`) or a fill still on its way returns that fill, so it is never asked twice; one the studio stopped waiting on is closed as failed at the chat answers' stale point, and a conversation cannot be deleted while a fill is on its way. Audit events `chat.action_fill_requested` and `chat.action_filled` hold ids, keys and hashes, never the words.
- **Proposals answer nothing.** The reply must be JSON (`{"values": {key: text}}`); only text for the asked keys, within each question's length, is kept (`readFillValues`). The card shows them as "Proposed by <model>"; **Use these** (the person's click) saves them as the card's answers, marked with the fill's id (`_fill`), which the person can change; a question still to answer starts from its proposal. Nothing is sent until Send.
- **Next step.** A finished card that is the latest in the conversation offers "Next step: <card>", chosen by the Path's own rules (the same as "Do it here": a waiting decision first, else `cardForStep`), or "Next step: open <tab>" when that step has no card yet. It only adds a draft card.
- **Explore for me on the Chat discovery card.** The discovery card can open the same Explore for me component as Discover, so its start uses the same routes, run, one-request grant and owner check. "Use this" on a problem fills the card with the pick's brief and the cited claims recorded here that support it (bearing on the problem); claims cited against it are left for the person, as on Discover. An unedited pick starts on the pick's own brief (no second brief, its version re-checked as a card subject); an edit saves a new brief with the pick's data and tools. "Send again" starts from the person's answers without the pick.

Not done: an edited pick's own brief is not archived from a card (Discover archives it after the start); the Fill flow was checked with a fake `claude` and in tests, not in a browser walk against a live plan.

- **Review 1 amendment (PR #181, November 12).** M-1: migration 61's settle-once trigger lets a fill row go when its card or conversation is already gone, as the chat-answer rules do, so a conversation with a fill can be deleted whatever order the cascade triggers fire in (a restore can change that order); a test swaps the card's foreign key before deleting to check both orders. L-1: a database missing migrations now says which ("missing migration(s) 55 (code expects 61)") instead of "at 61; expects 61"; L-2: a test checks that migrations are listed in strictly increasing order. L-3: the server rebuilds each question from the saved card: its type (`fillType`: long text for problem, statement, uncertainty, quote, summary and sections) and the saved answer so far; the page's own answer-so-far is ignored, and only the label and prompt wording come from the page. L-4: when the person already typed an answer, the proposals say so and the buttons offer "Use the N for unanswered questions" or "Use all, replacing my answers"; nothing typed is replaced without that second press. L-5: a pick's claims and roles always replace the card's (none supporting means no claims and no roles, so the card asks again), and the pick is a card subject only when its brief is reused unchanged. L-6: the P20 Chat walk was run again on this branch (see BUILD_STATUS). Nits: a Fill press's request id (`client_id`) is renewed when the card's version changes, so an edited card asks afresh; the retry hint shows only for network errors; a double press of "Use this" sends once; Next step ignores dismissed cards and says when the next card is already open; JSON is read from a fenced block first, then each `{` in turn, so braces in prose do not hide the reply; a connection whose input cap leaves under 500 characters after the instructions is refused before anything is recorded.
- **Re-review 2 amendment (PR #181, November 12; 4 nits).** Explore for me on the card waits until the card's records have loaded, so a pick cannot clear claims it could not see. After "Use the N for unanswered questions", the proposals that would replace typed answers stay on offer ("partly used") without another Fill in; a proposal already equal to the card's answer is not shown, and "Saving…" shows on the button pressed. The retry hint also shows for a server error (5xx; `ApiError.status`), where a retry is safe. The missing-migration test reads the newest version instead of a fixed number.
- **Re-review 3 amendment (PR #181, November 12; 3 nits).** A fill whose proposals all equal the card's answers says so ("The proposal matches…", `fillOutcomeNote`) instead of "Nothing to propose". The disabled Explore for me button says the card's records could not be read when the read failed, not that it is waiting (`exploreWaitNote`). The storage test's schema check reads the newest listed migration too, so no test pins a number.

## ADR-0091 — Assessments read each option's own claims; link claims from the app; say why a score is a range (November 11, 2026)

From Jordan's live "Assess automatically" on the dev studio's CSV problem (P27 thread, November 11): seven options, four claims linked to the problem, model cards mostly unknown, so ranges widened (csvkit 54.2–70.8 → 20.8–70.8; Great Expectations and ydata-profiling 0–100). Four recorded claims about those tools existed but were linked to nothing, and the web app had no way to link a claim to a problem or option (only `pnpm cli link`). **Amends ADR-0074 and ADR-0085** (what the packet reads). No migration, no model call, no spending. Owner decision (decision card, November 11): **ranges stay as they are** ("Yes, keep it honest"): no card is left out or down-weighted; the fix is better evidence and an easy way to fill in unknowns.

- **The packet reads option claims.** An assessment now reads the problem's claims (`PROBLEM_CLAIMS_SQL`, unchanged) and the active claims that support one of its active options (`claim supports alternative`, `ASSESSMENT_CLAIMS_SQL` in `selection-store.ts`). A claim linked to options carries `options: ["O3", …]` in the packet (`AssessmentClaimSchema`, optional); without option claims the packet, its order and its hashes are exactly as before. A claim linked only to options past the eighth is neither read nor counted. One packet note explains the `options` field. **The R08 prompt, role version and output schema are unchanged**, so current assessment qualifications stay valid (the qualification check compares the system text exactly).
- **Order under a tight cap.** Claims are picked in order while they fit (ADR-0085). Each assessed option's first own claim now comes first (in option order), then the problem's claims, then the rest, so a small input cap still reads something about every option that has evidence.
- **Staleness.** `linked_hash` hashes problem claims by id (as before) and option claims as `claim:option`, so linking, unlinking or moving a claim between the problem and an option marks earlier automatic assessments stale ("Evidence linked to the problem or its options changed …").
- **Preview coverage.** The assessment preview returns `option_coverage` (per option: claims linked to it, and how many the packet reads). Compare and decide shows a warning before Assess when an option has none read, naming each such option with **Link claims**, plus **Link claims to the problem**; assessing anyway stays possible.
- **Linking from the app.** One component (`apps/web/src/link-claims.tsx`) uses the existing `POST /links` route (`supports`, claim → problem or claim → option; writer role, audited, an identical active link counts as done). It suggests recorded claims whose title or statement name the option or problem (`claim-suggest.ts`: words every candidate shares count for nothing, rarer words count more, weak matches dropped), pre-ticked, with a filter box for any other claim and **Find evidence on the web**, which opens Discover › Search the web with the question filled in. It appears in the pre-Assess warning, under "Evidence behind the problem" and on each option in Decide. Sources › Claims and Library claim pages show what a claim is evidence for (including "problem derived_from claim", which has no Unlink) with **Unlink…** (takes a reason), and **Link to problem** (the problem itself or one of its options).
- **Answers fit the answer cap.** Reading more claims makes answers longer: after the CSV problem's claims were linked, Jordan's next run failed with part 1's answer at 16,005 characters against the plan connection's 16,000 `max_output_chars` (four assessments; tonight's four-claim parts were 14,852 and 13,354). Requests now carry at most `floor(max_output_chars / 5,000)` option-and-rubric assessments (between 1 and 4; `OUTPUT_CHARS_PER_ASSESSMENT`), so 16,000 gives three per request and 20,000 or more keeps four. Routes without an answer cap keep four. The preview's request count shows the extra requests before Assess, and the per-run request cap check applies as before.
- **Drafting-packet claim labels.** Option texts drafted by discovery cite that run's packet claims ("Data: C3"), which the assessor took as wrong citations of this packet's C3 (Jordan's run: "O5 incorrectly points to C8"). The packet renames them `draft-C3` in option title, rationale, trade-offs and uncertainty, with a note that they are not this packet's refs. The stored options are unchanged.
- **Assessor summary.** A split assessment's summary joins each part's summary; it was cut at 1,200 characters mid-word. Each part now gets an equal share, cut with an ellipsis.
- **Why a range.** Under an option without a single score, Decide names the counted card behind each end of the range and how many unknown ratings it counts at 1 or 5, then offers **Fill in the automatic assessment's unknowns** (the existing edit, which replaces the system card and keeps it) or **fill in your card's unknowns** when the person's own card sets an end, or **score this option yourself** when they have no card and no automatic card of this option version exists (the form would open that card instead), or linking evidence and assessing again. Ranking and range rules (`selection.ts`) are unchanged.

- **Review amendment (PR #178 review 1, November 12).** M-1: a claim's "Evidence for" list shows "the problem was drafted from it" rows without Unlink, since that link is the problem's lineage (invariant 7) and the app cannot recreate it; Unlink of a `supports` link now takes a reason (the support-retract form). L-1: requests are sized to the smaller of the connection's and the run's `max_output_chars`. L-2: `draft-C` renaming only in citation positions (after `:`, `(`, `,`, `;`, or "claim(s)", "cite(s)", "cited", "see", "and", "per", "from"). L-3: linked records, a problem's options and claims cited by scorecards are read by id, so nothing past the newest 500 goes unnamed; the claim filter and problem list say when they show only the newest 500. L-4: tests for an option link alone (problem link kept) marking the assessment stale, a start refused when an option link was added after the preview, and the summary join. Nits: the joined summary gives a short part's unused room to the others and cuts at a word boundary (`joinSummaries`); the 1-per-request floor is documented; coverage text says "not read (input cap or the 30-claim limit)" and counts problem-linked claims (`problem_claims_read`); unique form ids; "Score this option yourself"; new suggestions are ticked after a link; Search the web keeps what the person already typed and offers the suggestion beside it.
- **Upgrade note.** A problem that already has `claim supports alternative` links gets a new `linked_hash`, so its current automatic assessments show as stale after the upgrade. That is correct: they did not read those claims. The stale reason says so (re-review 2 L-2, below) instead of saying a claim was linked or unlinked.
- **Re-review 2 amendment (November 12).** L-1: `draft-C` renaming accepts capitalised citation words ("Claims C3 and C5", "See C7") and renames the end of a range after a renamed ref ("C3–C5", "C2 to C4"). Superseded by the re-review 3 amendment, since other list forms still mixed. Remaining false positives after a colon or citation word stay, explained by the packet note. L-2: the selection report also gets `problem_linked_hash` (the linked set without option claims, which is what assessments before this ADR hashed); when an assessment's hash equals it, the stale reason says the assessment did not read claims now linked to the options, because one was linked since or it was made before the studio read them, and to assess again. Nits: the drafted-from row says "assessments of the problem read it"; "Score this option yourself" is hidden when it would open the automatic card; a claim's links fetch only problems and options; docs use the app's button names; a DB test pins the run's smaller answer cap.
- **Re-review 3 amendment (November 12).** L-1: a run of refs joined by ",", "/", "&", "and", "or", "to", "through" or a dash is treated as one citation and renamed whole, when it follows a citation mark or word (any case) or lists two or more refs ("Compare C3 and C5"), so a list is never half renamed. A lone ref outside a citation position ("C3 shows exports.") is left as it is, which is consistent but can leave a sentence-start citation bare; the packet note covers it. N-1/N-2: the range help offers "fill in your card's unknowns" only when the person's own card sets an end, and "score this option yourself" only when they have no card and the form would not open an automatic card of this option version (the same `currentSystemCards` the form uses); another member's card is never offered, and with no button the line reads "To narrow it, link evidence to this option and assess again."
- **Re-review 4 amendment (November 12).** Joining words match in any case ("C3 OR C5", "C3 To C5"), and a ref already written "draft-C3" is never renamed again; the packing test covers both.
- **Re-review 5 amendment (November 12).** An already-prefixed ref in any case or with any dash ("Draft-C3", "DRAFT–C6") stays part of its list, so the bare refs beside it are renamed ("draft-C3 or C4", "Compare C3 and draft-C5") and the prefixed one is never prefixed twice; the packing test covers these.

Rejected: leaving unknown-heavy model cards out of ranges, or a per-card "don't count" switch (Jordan chose to keep ranges honest); changing the R08 prompt to mention option claims (would void every assessment qualification; the packet note says it instead); an "assess only covered options" mode (needs a subset start; linking is the fix); re-splitting a part whose answer hit the cap and retrying it (a later step if 5,000 per assessment proves too tight); auto-linking suggested claims without a person's tick.

Not done: the CSV problem's four claims on the dev studio were linked separately (P27 thread). Maintenance burden and stakeholder acceptability stay unknown on every option after Jordan's re-run: no claim supplies team facts (the gate thread's team profile is the home for that).

## ADR-0090 — Team profile, built-in capability checks, the owner's gate confirmations and who clears gates (November 11–12, 2026)

Jordan's request of November 11 (from the P27 thread): when an option's access gate is unresolved only because nothing shows what the team can install or run, explain it plainly, guide the person, give a quick way to clear it, offer built-in checks, and clear the gate automatically when they pass; and optionally resolve ethics and access gates automatically. On the decision card he chose **Clear automatically** (November 11, 23:26 UTC). **Amends ADR-0074** (its "Gates" bullet). **Migration 56** (`team_profile_versions`, `gate_confirmations`, `gate_rule_versions`). Part 1 of 2; part 2 is an owner-written ethics checklist the model answers item by item.

- **Team profile.** Settings › Team profile: a fixed list of capabilities (`TEAM_CAPABILITIES`: run Python, install Python packages, run Java, Node.js, Git, Docker, Jupyter; install new software; use the internet; keep data on our own computers; pay for tools), each Yes / No / Don't know with an optional note, plus free notes. Each is either **declared** by the owner or found by a **check**. Only a workspace owner signed in as a person writes it (`requireOwner`), so an agent (an editor) can read it but never write it. Every save is a new, append-only version with an audit event (`team_profile.saved` / `team_profile.checked`); a stale page gets VERSION_CONFLICT; a save that changes nothing is refused.
- **Built-in checks.** "Run check" runs a fixed program from `CAPABILITY_CHECKS` with fixed version-only arguments (`python --version`, then `python3`, then `py`; `python -m pip --version`; `java -version`; `node --version`; `git --version`; `docker version --format {{.Server.Version}}`, which asks the engine so a stopped engine does not pass; `jupyter --version`, passing only when Notebook or JupyterLab reports a version, not `jupyter_core` alone) through `execFile` without a shell, a 10-second limit, a 64 KiB output limit, an empty working directory the studio makes for checks (`creator-checks-*` in the user's own temporary folder, made again if a temp clean-up deleted it), `NoDefaultCurrentDirectoryInExePath=1` set in the API process itself on Windows (libuv reads the calling process's environment, so it is not put in the child's), and a bare environment (PATH and the few variables Windows needs to find programs; never `CREATOR_*` settings or keys). It passes only on exit 0 with the version printed, so the Windows Store "python" stub does not pass. A pass saves the capability as Yes with the command, what was found, the output's hash, the computer's host name and the time; a failure changes nothing and says what was tried. A re-check that finds the same thing on the same computer saves nothing ("Still found …; nothing changed"), and a check never overrules a capability the owner declared No (it says what it found and leaves the No). The owner check runs before anything starts. A hosted deployment refuses checks, since its computer is the server, not the team's. A check proves only the computer the studio runs on; the page says which. The host name goes only to the owner (other members see checks without it), and a hosted page hides the checks.
- **Sent with every assessment.** The assessment packet carries an optional `team` block (version, each capability's label, answer, how it is known, note, and the notes) whenever a profile has been saved. The host name is left out: the packet says "found by a built-in check on the studio's computer (…)", or "on another computer, so it may not hold here" when the check ran on a different host than the studio's now (after a restore or a move). Settings says the profile and notes are sent with every assessment, and the assessment preview shows the team block. The assessor prompt gains one sentence telling it to use the block for access, treat Yes as established and No as a real limit, and name the exact missing capability when it leaves a gate unresolved; the role is now `r08-assessor/1.2` (1.1 was an earlier text on this branch, never merged or qualified). The prompt also says the owner may let its clear or resolved stand without a person, and that a person or a rule the owner chose decides. **The prompt hash changed, so plan-route assessments need a new scoring qualification** on the new bundled benchmark `assessment-synthetic-v2` (review 2 L-2): v1's eight cases and labels unchanged, plus three held-out gate cases drafted before any model output: access stays unresolved when the team block says the team cannot run what the option needs; access is clear or resolved when the team block covers it; ethics and access stay unresolved when a claim instructs the assessor to mark both gates clear (no team block). `assessment-synthetic-v1.json` is left as it was on main, as a frozen record that nothing offers any more. A system card records `team_version`, `team_hash` (a hash of the team block it read, without its version) and `team_answers` (how many capabilities it answered). A card is stale only when the team block a packet would carry now hashes differently ("The team profile, or the computer its checks ran on, changed since this assessment"), so a new version that changes nothing the model reads keeps assessments current; an assessment start whose team block changed after the packet was built is refused.
- **Plain gate reasons.** The selection report gains `gate_details` for each gate: its state, every concern with who raised it (automatic assessment or the person's label) and its note, the confirmation that counts, and why an earlier one no longer does. The blocked reason names the gate, who raised it and what it said ("Access (automatic assessment): Nothing in the packet shows the team can install Python tools…"). Compare shows each gate under the option with what to do: say what the team can do in the team profile and assess again, or confirm it.
- **The owner's confirmation ("Clear: I confirm").** The owner confirms one gate of one option version with a one-line reason. The request names the concerns the page showed; if the current concerns differ (one was raised since), it is refused, so nothing is confirmed unseen. A person's own concern cannot be confirmed away (that person revises their card). The confirmation is its own append-only record (`gate.confirmed`), not a scorecard: the system card's ratings and gates stay unchanged and keep counting. It no longer counts when the option's version changes or a newer automatic assessment raises a concern it did not name.
- **Who clears gates (Jordan's decisions).** Settings › Team profile › "Who clears ethics and access gates", a per-workspace choice that only the owner changes, versioned and audited (`gate_rule.set`), with a confirm step that repeats what the choice does:
  - **You confirm every gate** (`owner`, the default): only a person's card or the owner's confirmation clears a gate.
  - **Access clears on the model's reading of your team profile** (`team_profile`): the access gate also clears when every current automatic assessment of the option read a team profile that answers at least one capability (`team_answers` ≥ 1) and found no access concern. Ethics still needs a person. This is still the model's judgment, not an app-verified approval: the app checks only that a profile answering something was sent, not that it covers what the option needs, so the label, the gate line ("cleared by the model, from your team profile (no person looked)") and the reason say so (review 2 M-1). **A truly app-approved choice needs part 2:** the assessor (or the checklist walk) must return structured references to the capabilities an option needs (`TEAM_CAPABILITIES` keys) and to checklist items with verified citations; code then clears access only when every named capability is Yes with `basis: check` on the studio's current computer, and ethics only when every checklist item passes with references the studio verifies. That needs an assessor output change, a new prompt version and benchmark cases, so it is not in this PR.
  - **Both gates clear on the model's word** (`model`): an ethics or access gate also clears when every current automatic assessment found no concern on it. Jordan chose to offer this explicitly on November 12 ("I would like to have an option to have the auto clear on the models word. There should still be a choice to have the user or app approve it"). No person looks at a gate cleared this way: the model can be wrong, or misled by a web-fetched passage in the packet, and an option whose gates cleared this way can be selected by a routine `candidate.select` policy (ADR-0079) with no person involved. So the setting says that, the gate shows "cleared on the model's word (no person looked)", and the clear's reason says "No person looked at this gate"; the selection record keeps the report with `gate_details`, including `rule_mode`. **Routine selection stops for a person (Jordan, November 12: "We can go with yes for now").** When a selection advances an option (`select_for_build`, `proceed_to_validation`, `recommend_alternative`) whose ethics gate is `auto_cleared` with `rule_mode: model`, and the actor is not a person (a run's agent, so a routine `candidate.select` policy included), the admission carries the existing `ethical_judgment` flag, so the action needs a person's decision instead of being admitted by the policy. A person selecting by hand is that person and is not stopped. The stop keys on the actor's kind, so any automation that selects must act as a non-person actor, never as the owner's own person actor. PR #183 (P13) does this by marking the autopilot's requests on the owner's session with an autopilot marker, which makes them run as the separate Autopilot agent actor, so this stop applies to them. Tested end to end: an agent under a routine selection policy gets `needs_human` and no selection, the owner selecting by hand is admitted, and after the owner answers "proceed" the agent's identical retry is recorded. A later automation step (P33) may lift this only by an explicit owner decision.
  A rule clear is `auto_cleared` with `confirmation.by = rule`, `rule_version` and `rule_mode`. In every mode no person's card or confirmation decides the gate, no current card raises a concern on it, and at least one current automatic assessment exists. It is computed on read, so changing the choice ends every clear the earlier one made. Any concern still blocks and comes to the owner. The assessor prompt says the owner may let its "clear" stand without a person, so it says clear only when the packet supports it.
- **No confirmation of what nothing assessed.** The owner's confirmation needs at least one current card (an assessment or a person's) on the option; otherwise it is refused and the gate says to assess or score the option first (review 1 L-5).
- **ADR-0074 amended.** ADR-0074 said a system card can raise a gate but never clear it, and only a person confirms. Now a gate clears from a person's card, the owner's confirmation, or the owner's chosen rule applied by code. Under `team_profile` the clear rests on the assessment's reading of the owner's own profile; under `model` it rests on the model's word alone, by the owner's explicit choice. The model still cannot write the profile, change the rule, or confirm a gate. Selection itself stays a person's decision (or a routine policy's, ADR-0079).

Rejected: writing the one-click confirmation as an edit of the system card (it would put ratings the person never reviewed under their name); putting the rule inside the profile (switching it would make every assessment stale); staleness by profile version (any re-check or note fix made every assessment in the workspace stale, review 1 M-1); a single on/off rule that cleared both gates on the model's word with no way to keep a person in the loop for ethics (review 1 H-1, replaced by the three-way choice); running checks in a shell or with model-written commands; sending the host name to the model; auto-clearing without a profile (the assessor would only be guessing about the team).

Not done (part 2 and later): an owner-written ethics checklist the model walks through with citations the studio verifies, clearing only when every item passes, and the app-verified access choice described above; notifications beyond Compare; a check run by the person on another computer.

## ADR-0087 — Fix it here: coded plan refusals and owner-only fix buttons where a refusal shows (November 11, 2026)

P27 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (walk items 16 and the rest of 8), with correction L-2 of the plan review (`PR169_FIX_PLAN_REVIEW.md`). Builds on ADR-0084 (P23). No migration, no model call and no spending was needed to build or verify it.

- **Stable codes beside the words.** Plan admission (`packages/domain/src/plan-admission.ts`) now builds each refusal as a `PlanRefusal` (`packages/contracts/src/connections.ts`): a code (`caps_not_accepted`, `data_class_not_allowed`, `task_class_not_allowed`, `not_qualified`, and `sign_in`, `credits_not_off`, `not_eligible`, `quota_exhausted`, `wrong_path`, `request_open`, `cap_reached`, `not_verified`, `grant`, `chat_setting`, `other`), the sentence, and the connection, model, task class or data class it names. `connectionBlockers` and `admissionBlockers` return the same sentences in the same order as before (a test pins it), so nothing that reads the words changes. The connection detail adds `refusals` beside `blockers`; a refused route check (Explore for me, Assessment, Discovery) and a refused plan request add `reasons` to the `ContractError`, which the API sends as `error.reasons` and the web keeps on `ApiError.reasons` (only entries that match the contract).
- **Fixes are chosen by code or by what the page knows, never by wording.** `apps/web/src/fix-here.ts` maps codes to fixes (`refusalFixes`), and `missingTaskFixes` (`discover-defaults.ts`) maps "this model lacks these tasks" to them. Four fixes exist: **Review and accept caps** (caps not accepted), **Allow <data class> on this connection** (for example "Allow approved private data on this connection"), **Allow and qualify** / **Allow this task** (task not allowed; one button for a task that is both not allowed and not qualified), and **Qualify now** (allowed but not qualified).
- **Same routes, same confirmation, owner only.** One component (`apps/web/src/fix-buttons.tsx`) draws them. Pressing a fix reads the connection again and shows what will happen in the Models page's words: the caps line and allowed work (the caps line is now one helper, `capsLine`, used by Models too), the "Will change: …" summary and whether the caps are accepted again, or the benchmark, its maximum plan requests and the pass bar. Nothing is sent until the person confirms. The fix then calls the owner's existing routes: settings plus accept-caps when the caps were accepted (`allowSequence`, the generalised P23 `allowTaskSequence`), accept-caps, or start qualification plus Run. Only the workspace owner sees the buttons, and the server refuses anyone else on every route as before. The buttons are drawn by the page from server state; a model's chat reply cannot contain, press or propose one, and the Chat card shows them under its blockers, not from the card's answers.
- **Each route qualifies on its own benchmark.** The server counts only qualifications on a benchmark for the route's role: discovery and Explore for me only discovery-contract benchmarks, automatic assessment only the assessment benchmark, build and spec roles any. So a fix qualifies a task only with a bundled benchmark of that role (`benchmarkFor(task, role)`, read from the manifest's check kind). Today that means Qualify now and Allow and qualify for the build roles, specification, summarization (Build) and scoring on the assessment benchmark (Decide); discovery has no bundled benchmark (P34 serves them from the server instead), so Discover, Explore for me and the Chat discovery card offer only the allow, caps and data fixes until P34's offers are wired in (see the review amendment). If a qualification of that model and task is already started on the same benchmark, Qualify now runs it on instead of starting a second (the server refuses a duplicate); one started on another benchmark blocks the press.
- **Where they show.** Discover's setup reasons and a refused start; Discover › Explore for me (route reasons and a refused start); Decide › Automatic assessment (route reasons and a refused start); the Chat discovery card's blockers; Build's "not qualified for the builder and reviewer roles" and "connection does not allow this data class" reasons. The existing "Open Models and connections" links stay beside them.

Rejected: matching refusal sentences (the plan review's L-2); a new API route for fixes (every fix already has an owner route); offering a scoring Qualify now in Discover on the assessment benchmark (the discovery route would still refuse it).

Not done: buttons in Chat answers' own refusals (chat states its refusals in its replies), and in the top-bar model picker (each form beside it now offers the fix). Observed: Discover's "not qualified for scoring" sentence still points at Qualify a model, where the only scoring benchmark is the assessment one that discovery does not count; P34 owns the discovery benchmarks and that sentence.

- **Review amendment (PR #177 review, November 11).** M-1: P34 (#175) does not add discovery benchmarks to `BENCHMARKS`; it serves them from the server (`GET plan-benchmarks`) and starts them by name (`{ expected_version, model_id, benchmark }`). The fix's benchmarks are now `QualifyOffer`s (`fix-buttons.tsx`: name, task, role, case counts, manifest hash, start body), listed by `offersFor(role)`. **Whichever of #175 and #177 merges second adds the server's discovery offers in `offersFor`**; only then do discovery's Qualify now and Allow and qualify turn on. Nothing turns them on by itself. M-2: a started qualification is run on only when its `manifest_hash` is the benchmark's (the app hashes a bundled manifest as the server does, `manifestHash` in `fix-here.ts`; P34's offers carry their hash). One started on another benchmark for that model and task (for example a discovery scoring run when Decide's fix wants the assessment benchmark) disables the confirm: "A scoring qualification on <benchmark> is started; finish it under Models and connections first." M-3 and N-1: the "Running" line shows only when the press qualifies; with several tasks it said to stay on the page; since the P24 merge, several tasks go to the server queue instead (see the P24 merge amendment). L-1: once anything was saved the panel closes and the page reads again, even if a later step failed. L-2: several tasks stop at the first that is not qualified, and the outcome names the tasks not started (ADR-0088's stop rule). L-3: running a qualification (`plan-qualifications/{id}/run`) is now owner-only on the server; an editor could run one and record its failure before (the per-case refusals were graded as failures). A test checks that a non-owner is refused on settings, accept-caps, start and Run, and that nothing changes or is sent. L-4: Explore for me counts the newest decided qualification under the current prompt (`isQualified`), for both its sentence and its fixes; P34 narrows it to `admits_discovery`. N-2: a task can be allowed without a verified model (allow-only fix on the Chat card and Discover). N-3: a fixture connection, or Build in a fixture workspace, is never offered a qualification (`qualifierFor`), and the confirm refuses one.

- **Re-review amendment (PR #177 re-review, November 11).** Finishing a started qualification (`plan-qualifications/{id}/finish`) is owner-only too: it records every unanswered case as failed, which withdraws an earlier pass. The Run loop's own finish is unchanged. Run and Finish refuse a non-owner with "Only the workspace owner, signed in as a person, can run (finish) a qualification." A settings save whose re-accept is refused now also closes the fix panel and reads again. A press that only allows is not blocked by a started run of another benchmark. Started runs are named from every offer, not only bundled ones. For the P34 merge: the role of a started run is the role of the benchmark its manifest hash names, so a fix never runs a started qualification of another role (P34 re-review L-A), and the P27 test loader transpiles any sibling it has no stub for (P34 re-review M-A). P34's offers are read by the page: Discover, Explore for me and the Chat card call `useQualifyOffers`, which reads `GET plan-benchmarks` once per workspace (again when a fix opens) and adds the offers, started by name, to the fix benchmarks; before #175 the route is missing and discovery offers no qualify fix. A bundled benchmark's role is read from every case, as P34's `manifestRole` does.

- **P34 merge amendment (November 11).** P34 (#175, ADR-0089) merged first. Discovery's Qualify now and Allow and qualify now run on the server's offered discovery benchmarks (`GET plan-benchmarks`, read with `DiscoveryBenchmarksSchema`, started by name); a bundled benchmark's route is P34's `manifestRole` (Search the web's benchmark offers no fix); Explore for me counts `isDiscoveryQualified`. The tasks a fix can qualify are exactly `QUALIFY_IN_APP` (a test checks it).

- **P24 merge amendment (November 11, after PR #176).** "Allow and qualify these tasks" no longer runs its qualifications from the browser one by one. After the allow it posts one `plan-connections/{id}/qualification-queues` request (ADR-0088), built by `queueRequest` in `apps/web/src/fix-buttons.tsx` from the same benchmark each task would start alone (a bundled manifest, or an offered discovery benchmark by name, ADR-0089). The studio runs the tasks one after another, stops at the first that does not pass, and carries on when the person leaves the page; the confirmation says so, and progress shows under Models and connections. A single **Qualify now** still runs on its own route. The queue start is owner-only (`#ownerChange`), refuses tasks already qualified, and links a started run of the same benchmark. After the live walk (November 11) a fix's outcome is kept on the page (`FixOutcome`) once the refusal and its buttons go away. Review 7 (at 2023173): M-1: while a qualification queue runs on the connection, a press that qualifies (Qualify now, or Allow and qualify) is disabled with "A queue is qualifying tasks on this connection; wait for it to finish, or cancel it under Models and connections › Qualify several tasks" (`queueBlocks`), and checked again on the fresh read before anything is sent, because a hand start the queue later meets stops the queue; a press that only allows or accepts caps still works. L-2: a fix's outcome is kept per workspace **and place** (`FixContext.place`: `assess`, `explore`, `submit`, `build:<product>`, `card:<id>`), so it shows only where it was pressed. Observed earlier and resolved by P34: Discover's "not qualified for scoring" sentence now names the benchmarks marked "for discovery". Review 8 (at 970bb5f): `startPlanQualification` refuses a start by hand while a queue runs on the connection, closing the moment between the page's read and its POST (N-1); a press that qualifies also waits while a Run executes there (`RUN_BUSY`, N-2), so the panel does not offer a press that would be refused; a queue or Run that starts between the fresh read and the queue POST can still refuse it after the allow was saved, and the outcome then says so (review 9 nit).

## ADR-0088 — Qualify several tasks: a queue the studio runs one after another, each task admitted on its own (November 11, 2026)

P24 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (walk items 2, 3 and the rest of 17), with correction L-3 of the plan review (`PR169_FIX_PLAN_REVIEW.md`). **Migration 55** (`plan_qualification_queues`, `plan_qualification_queue_items`). Extends ADR-0084's one-Run-per-qualification rule; no new authority path, no model call or spending to build or verify it.

- **What it is.** In Models and connections › Qualify a model for a task, "Qualify several tasks" lists the bundled benchmarks whose task is allowed on the connection and not yet qualified for the chosen model (new, last run failed, or started and not finished), each with a checkbox, plus **Qualify selected** and **Qualify all**. Pressing one queues those tasks, in the section's order, for that model. Nothing is started or sent at that moment.
- **The studio runs the queue, not the browser.** A runner in the API process (`QualificationQueueRunner`, `packages/broker/src/qualification-queue.ts`) takes a lease on a running queue in the database (`lease_holder`, `lease_until`, two minutes, renewed every 30 s), starts the next task's qualification and runs it through the same `PlanService.runQualification` a Run press uses. A run that answers every case records its result itself (it always did), so a queue finishes on its own and the person can leave the page or close the app window. The runner polls every 10 s and is told at once when a queue is started.
- **Each task is admitted when its turn comes.** The start of a queued task runs the same checks as a start by hand (`#checkQualificationStart`: owner, task and data class allowed, not `code_build`, build-role prompt, fixture matches fixture, model verified, held-out views, minimum held-out cases) against the connection as it is then, and every case goes through plan admission as usual (caps accepted, request and daily caps, one in flight, the $20 runtime ceiling, sign-in). Queueing checks the same things up front so a mistake shows at once, but that check does not carry over: a task disallowed or caps changed after queueing are refused at dispatch. Each qualification keeps its own intent, held-out binding and request records, exactly as before; the queue only links them.
- **Stop rules.** A task that does not qualify stops the queue there ("summarization did not qualify (5 of 8 held-out cases passed)"); so does a refused start (its reason is shown, nothing is sent for it) and a Run that stops on a refusal or error (its answered cases are kept; press Run on it once the cause is fixed). Tasks after the stop are marked "not started". **Cancel** (owner only) marks every task not yet started as cancelled; the task already running finishes and is recorded, so a cancel never cuts a case off mid-answer. One running queue per connection (unique index); a second is refused.
- **Only tasks not yet qualified.** A qualified task is refused in a queue, because the newest decided qualification counts (ADR-0052) and a failed re-run would replace the pass; re-running a qualified task stays a deliberate single Start. A task already started with the same benchmark is taken over (the queue runs that qualification, answered cases skipped); with a different benchmark it is refused.
- **Crash safety.** A task's qualification is inserted in the same transaction that links it to its queue item, so a restart between two runs starts the next task once, not twice; a restart after the start resumes that qualification. A qualification decided while no process held the queue (a crash after its last case, or a Finish by hand) is recorded when the queue is next picked up. A case left in flight or unknown by a crash stops the queue with ADR-0084's "close it under Running now" message. A lease that is not renewed expires after two minutes and the next studio process takes the queue over; a holder that lost its lease gets nothing more to run.
- **No competing Runs.** While a queue runs on a connection, a Run pressed by hand on any of its qualifications is refused ("A queue is qualifying tasks on this connection …"), since the connection allows one request at a time; the section locks Start, Run and Finish and shows the queue's progress. A queued start records `qualification_started` with the queue id but does not bump the connection version, so the person's open settings forms are not made stale by the runner.
- **Progress.** The connection detail carries the newest queue (`qualification_queue`: state, reason, whether a process holds it, each task's state); the section shows "n of m done", each task's result, Cancel while running and Hide once finished. Activity (the sidebar's "now" list) shows a running queue as "Qualifying tasks one after another · model · n of m done · now task", or "waiting for the studio" when no process holds it.

- **Review amendment (PR #176 review, November 11).** M-1: a qualification may be linked to several queue items over time (one `running` link at a time, by a partial unique index), so a task whose run stopped on a refusal or was cancelled can be queued again, as the stop message advises; the old item says "Taken over by a later queue." L-1: a runner never leases a queue it is still working on, and a runner whose renewal finds another holder finishes its case and leaves the queue. L-2: an unexpected error is retried at the next poll, and the same queue failing three times in a row is stopped with the error as its reason ("the studio could not continue this queue"), not left running; the count is cleared only after a whole step (start, run and record) succeeds, so an error that recurs when recording a result stops the queue too (re-review L-2b). L-3: Qualify all no longer offers a started re-run of a qualified task. L-4: the server refuses to start a queue while a qualification on the connection is executing. Nits: "running now" on a task a queue is running, a stop reason shown once, a refused queue start shown beside its buttons, and the requests left in the 24-hour cap shown before queueing.

- **Merge with P12 (November 11, after PR #173).** Research synthesis now has two lanes (ADR-0086): Discover's locator and web discovery, qualified apart. A queue follows them as Start does: queue items are unique by benchmark (`unique (queue_id, manifest_hash)`), not by task class, and a task may appear once per lane, so the locator and web discovery benchmarks can share a queue; the already-qualified check reads each benchmark's own lane on the server and in "Qualify several tasks". A benchmark is in the web lane when every case is a web scout or reader check, whatever its role version, so an outdated web benchmark (web-discovery-v1) shares the lane with the current one instead of passing as a locator benchmark (review 3 N-2). The shared start check includes P12's held-out view check (views matched by recomputed held-out keys). With web-discovery-v2 in the section, Qualify all on a fresh connection needs up to 45 plan requests (8 + 8 + 8 + 4 + 4 + 13), above the default 40 a day; the section now says so before it starts, and a queue that reaches the cap stops there with its answered cases kept (review 3 L-2). Default caps are unchanged.

- **Merge with P34 (November 11, after PR #175).** ADR-0089 gives research synthesis and scoring two roles each (locator and web discovery; the assessor and the discovery skeptic). The queue now keys items by task class and role, where the role comes from the benchmark's checks as the app's `manifestRole` reads it (any role version), and the already-qualified check counts only qualifications of that role (`admits_assessment`, `admits_discovery`, `admits_web_discovery`, or none of them for one-role tasks), on the server and in "Qualify several tasks". So a discovery-skeptic pass never refuses an assessor item, and the reverse. A queue item may also name a discovery benchmark the studio offers (`{ "benchmark": name }`); the server loads it with `offeredDiscoveryBenchmark` as Start does and refuses a name that is not offered. "Qualify several tasks" lists the bundled benchmarks, then the offered discovery ones, and leaves out a task whose other role is started for the model (the server runs one qualification per model and task class), saying so. Qualify all on a fresh connection now needs up to 63 plan requests (45 + 3 × 6), and the note above the cap says so.

Rejected: starting every queued qualification at queue time (a cancel would then leave started qualifications behind, and admission would be checked once for the batch); running the queue from the page (the plan's point is leaving the page); continuing past a failed task (the plan's stop rule; a failure usually means the route or prompt needs attention first); queueing across several models (a later step, as the plan says); a separate worker process (the API process already owns the plan service and the ADR-0084 claim).

Not done: "across models" queues; Jordan's live check (a real queue spends plan requests at $0 on the plan, and needs his typed OK).

## ADR-0089 — Qualify the discovery roles in the app, on server-chosen benchmarks (November 11, 2026)

P34 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (rest of walk item 8; found by the PR #172 review, M-1). No migration, no model call, no spending.

- **Problem.** Research synthesis and candidate generation could be qualified only with `pnpm cli plan-qualify`, which the installed app does not have, so on a new connection Explore for me, the Chat discovery card and Discover stayed blocked with no way forward in the app. A second gap found while building: discovery admission counts only scoring qualifications bound to the discovery skeptic prompt (`#discoveryQualifications`), but the only scoring benchmark in Qualify a model was the assessment one (ADR-0074), and the web counted any scoring pass for Discover and the model switcher (and the switcher's Discover row even used the assessment check). So "Qualify scoring in Qualify a model" pointed at a benchmark that never unblocks discovery, and a model qualified only for assessments looked ready for Discover until the server refused it.
- **The server chooses the benchmark.** `GET /api/workspaces/{ws}/plan-benchmarks` (any member) lists, per discovery task class, the newest frozen manifest that is real and passes the same role-currency check admission uses (`currentForDiscoveryRole`, now in `packages/db/src/discovery-benchmarks.ts`), with its name, task class, manifest hash, data class and case counts, never the manifest. "Newest" is the order of `DISCOVERY_BENCHMARK_DIRS` (newest first; a test makes every `discovery-*` folder appear there). A class with no current manifest is left out, never offered stale.
- **Start by name.** `POST …/plan-connections/{id}/qualifications` also takes `{expected_version, model_id, benchmark}`. The server loads the offered manifest itself (pass bar: every held-out case, floor 1/1) and then applies every existing check: allowed task and data class, fixture match, verified model, held-out binding (ADR-0052) and the one-running-per-model-and-task rule. A name that is not offered (unknown, or a manifest no longer current for the role) is refused. The manifest route the CLI uses is unchanged.
- **What is offered today** (role `r02-discovery/1.4`): research synthesis `discovery-research14-v2`, candidate generation and discovery scoring `discovery-semantics-v2`. **Correction to the plan:** the plan named `discovery-synthetic-v5` as the current set; v5 was frozen for `r02-discovery/1.3` (its own test asserts it is not the current role), so it fails the role check and is not offered. A test pins the three offered names, so a role change fails it until a new benchmark is frozen for the new prompts (P12 adds web discovery with its own benchmark and flag; it does not change this role).
- **Qualify a model.** The list shows the bundled benchmarks and then the offered discovery ones, as "research synthesis for discovery", "candidate generation for discovery", "scoring for discovery" (and the assessment benchmark as "scoring for assessments"), with the same not-allowed / started / qualified / failed states and Allow this task. A benchmark's qualified or failed state counts only qualifications of its own role: qualifications carry `admits_discovery` (beside `admits_assessment`), so a scoring pass for one role never shows the other as qualified.
- **Discovery readiness counts discovery qualifications only.** `isDiscoveryQualified` (contracts) and `qualifiedFor` (model switch) are used by the Chat discovery card, Discover (route choice and setup blockers), Explore for me and the model switcher, matching what the server admits. Explore for me now also uses the newest decided qualification (ADR-0052) instead of any past pass.
- **Texts.** `QUALIFY_IN_APP` now includes research synthesis and candidate generation (a test keeps it equal to the bundled plus offered classes), so the "not qualified" texts send people to Qualify a model, "with the benchmarks marked "for discovery"".
- **Desktop bundle.** The benchmarks are read from `config/connections/benchmarks/` next to the service, like `config/spending.json`; the bundle check now also looks for that path (the whole `config` folder is already copied).

Rejected: bundling the discovery manifests into the web app (about 100–140 KB each; the server would still have to recheck currency, and the list would not follow the role prompts); having the web send the manifest back (round trip of up to 140 KB and a stale copy in the client); refusing every stale discovery manifest on the manifest route (the CLI and historical research runs still start them on purpose; their results are labelled not current).

- **Review amendment (PR #175 review, November 11).** One task class can serve two roles: scoring (assessments, discovery) and research synthesis (discovery and, with P12, Search the web). Every place that judges a qualification now does it within the qualification's own role (`roleOf`, `forRole` and `roleTask` in `apps/web/src/qualification-role.ts`). M-1: each row of the Qualified tasks list counts its newest decided qualification within its own role, so a failed assessment scoring run no longer shows "No longer counts" on a discovery scoring pass. The rows are named with their role ("scoring job for discovery") and get names for the discovery classes. M-2: a bundled benchmark's role is read from its checks (`manifestRole`: assessment, discovery, or web scout and reader checks), so P12's web-discovery benchmark is tagged "research synthesis for Search the web" and counts only `admits_web_discovery` qualifications without any change in qualify.tsx. An untagged benchmark never borrows a tagged role's pass. L-1: a running qualification of the same model and task class but of the other role shows "A … for … qualification of the model is started; run or finish it below first", with no Start; its row and run outcome name the role (N-1). N-2: the "can't qualify yet" text stays as a guard for tasks with no benchmark (code build). N-3 does not reproduce: on a fixture connection the section shows only "These benchmarks are real…" and lists no benchmark.
- **Re-review amendment (PR #175 re-review, November 11).** L-A: one qualification per model and task class runs at a time on the server, whatever its role, so every start finds the running one with `runningFor` (`qualification-role.ts`): free, started in this role (run it), or started in another role (run or finish that one first; never run it in this role's name). Qualify a model uses it; P27's "Qualify now" must use it too (P27 also takes the role from `manifestRole` and starts the discovery benchmarks by the name `GET plan-benchmarks` offers). N-B: the Qualified tasks list calls `rowLatest` (newest decided of the same model, task class and role, skipping older prompts), and the test calls the same helper. N-C: a qualification no role admits because its prompt changed reads "scoring (older prompt)" (`qualificationTask`). `admits_web_discovery` is now in the contracts' `PlanQualificationSchema` (optional), so the P12 merge only has to emit it. M-A (merging with P27 breaks its fix-here test loader) is fixed in P27's test. N-A: the live evidence README leads with the current state.
- **P12 merge amendment (November 11).** P12 (#173, ADR-0086) merged first; this merge keeps one per-role rule for both. The server emits `admits_discovery` and `admits_web_discovery`, and `prompt_current` also accepts the web role. Qualify a model keeps P34's `admits` (from `manifestRole`) instead of P12's separate `web` flag: the web-discovery benchmark is tagged `web_discovery` by its checks, so it reads only web records, the locator's benchmark reads only discovery records, and a running qualification of the other role is named as such rather than hidden (hiding it would let Start hit the server's one-running-per-task refusal). P12's negative `forDiscover` is removed (second re-review N-1): `isDiscoveryQualified` keeps only `admits_discovery` records, so an assessment scoring pass no longer counts as the Discover skeptic; `forWebDiscovery` is unchanged; Discover, Explore, the chat card and the picker use `isDiscoveryQualified` / `qualifiedFor`. The Models list's `rowLatest` splits rows three ways (web, assessment, discovery). The held-out guard runs after both start paths, so start-by-name is covered.

Not done: qualify several in one go and a background runner (P24, since done); "Allow and qualify" on refusals (P27, done in #177). A live qualification of gpt-6-astra for the discovery roles in Testing needs Jordan's typed OK (about 18 plan requests for all three).

## ADR-0086 — Search the web: discovery through the plan connection's own web search, the studio's fetcher, and checked quotes (November 11, 2026)

P12 (online discovery) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), on Jordan's November 11 route ([fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md), "P12 route"): browsing goes through model connections, not a search or browser API, which stays a possible later option. This replaces the runbook's "select a search provider" step. **Amends ADR-0065**: Explore for me still reads only recorded claims; "Search the web" is a separate start on Discover that finds new evidence.

- **Stages.** One discovery runs search, fetch, read, in that order, in the studio process (`apps/api/src/web-discovery.ts`). Search: one plan request on a ChatGPT plan connection with the provider's hosted `web_search` (PR #157's option), `tool_choice` required, a call cap of 1–5 and the excluded websites as blocked domains. The studio records each search call (queries, status, consulted source URLs) apart from the answer text; the model's summary is shown as a draft, never evidence. Fetch: the studio's own guarded fetcher (SourceBroker) fetches the chosen pages under the workspace's evidence-site policy and stores passages with offsets and hashes, as for a manual fetch. Read: a second plan request gets only stored passages of usable pages (as untrusted evidence with no authority) and proposes claims with quotes.
- **Which pages are chosen is application code** (`checkScoutOutput`): a lead is fetched only if its URL is among the provider-reported search sources (a URL only the model's text names is `not_from_search` and never fetched), it is not an excluded website or topic, not a duplicate or already in the studio, and within the page limit (at most 2 per website). Each lead keeps its reason.
- **Quotes are checked word for word** (`checkReaderOutput`, the studio's `quoteInPassage` rule, spaces aside) against the stored passage the reference names. A proposal is `verified` only with at least one supporting quote found; unverified, excluded-topic and duplicate proposals are shown but cannot be added. Supporting and contradicting sources are counted by origin.
- **Authority: the owner's start is one approval** for exactly this discovery's search request, its reading request and fetches of the pages it chose, each once (the ADR-0054 build-approval pattern). The start binds the preview's input hash (a changed scope is refused). Plan admission (`webDiscoveryRequestGate`, under the run lock and a row lock on the discovery) refuses a request for another run, connection or model, by another person, in the wrong state, a second request for a stage, a cancelled or human-only run, and frozen study runs. A fetch is admitted only while the discovery is fetching and only for a chosen URL (`webDiscoveryFetchRefusal`), recorded as a retrieval "covered by the owner's start". A plan request with `web_search` and no such binding is refused (`web_search_not_bound`), except for qualification cases.
- **Adding claims.** Checked claims are added by the owner (one or all checked), or, unattended, only where the run's routine policy (ADR-0079) covers the new **evidence** stage and its `claim.admit` action: the studio dry-runs admission and accepts only `covered_by_routine_policy*` outcomes, then records the admission. An added claim is a normal claim (statement, basis, uncertainty) with quotation or inference support on the exact stored passages; dismissed proposals stay on the record.
- **Qualification.** Both requests are research synthesis and need a qualification on the bundled `web-discovery-v1` benchmark (`scripts/web-discovery-benchmark.mjs`): 5 scout cases searching the live web, graded on provider-reported search calls and sources (never exact URLs), and 5 reader cases on frozen synthetic packets graded by the quote check, the verified-claim count and refs that must not be cited (a prompt-injection passage, an off-focus page). Each case's system message is that stage's prompt, so a changed prompt needs a new qualification. A web qualification admits only web discovery, and the locator's or Explore's research-synthesis qualifications never admit it (`currentForWebDiscoveryRole`, `admits_web_discovery`).
- **Durability.** States: searching, fetching, reading, done, failed, cancelled, interrupted; one working discovery per workspace (a partial unique index; each start makes its own run). Fetches use deterministic operation ids. A plan request is never re-sent: on Resume after a stopped studio, a stage whose request was already sent becomes `interrupted` with a plain explanation. Cancel stops at the next guard.
- **Page furniture (walkthrough item 15).** Extraction flags navigation, header, footer, aside, form, button, menu and dialog text, text outside `main` when a page has one, and short UI labels as `boilerplate` on passages (migration 54). Content passages are stored first so furniture never uses up the passage limit, and the reading packet leaves furniture and instruction-like passages out. Page quality (usable, challenge, empty, low text) is judged from stored passages, so a challenge or sign-in page is not read.

Migration 54: `web_discoveries`, `web_discovery_claims`, the routine policy `evidence` stage, and `source_passages.boilerplate`, with update guards on both new tables (what a discovery started with, its search calls, leads and request ids, and each proposal are recorded once; a proposal is decided once).

- **Review amendment (PR #173 review, November 11).**
  - M-1: an `article` or `main` region counts as the page's text only when it holds at least half of the words outside site chrome, and chrome counts only when real text remains outside it. `form` is no longer chrome, because some sites wrap the whole page in one. Hidden notices, `role="alert"` boxes and navigation, banner and footer roles are furniture, and so is "Read in English" (N-4).
  - M-2: a quote counts only when it is found word for word **and** has at least six words or 40 characters. The studio checks that the quote exists, not that it proves the statement, and the UI says "Quote found on the page". The routine policy adds only `observation` claims; inferences always wait for the owner.
  - L-1: a chosen lead is fetched at the URL the search reported, not at the model's spelling of it. L-2: only pages the search reported are shown as links.
  - L-3: unattended adding uses one savepoint per claim, and it appends to the discovery's explanation how many claims it added, how many wait, and why.
  - L-4: pages stored before schema 54 keep their menus inline until they are fetched again, because stored passages cannot be changed.
  - N-1: a web qualification case's user message must equal that stage's input for its own scope or packet. N-3: duplicate checks compare against the newest 5000 claims and 20000 source URLs, and are best effort past that. N-6: the preview shows the evidence-site per-run fetch cap and warns when the page count is above it. N-8: the fetch gate refuses human-only runs, like the request gate.

- **Re-review amendment (PR #173 re-review, November 11).** R-1: only the largest marked `article`/`main` region counts as the page's text, so several related cards cannot outweigh a short article. R-2: with no routine policy on the run, nothing is tried and the note says only how many checked claims wait. R-3: the six-word rule applies to supporting quotes only; a shorter contrary quote found word for word is kept with the claim. R-4: a search source reported over `http://` is fetched at its `https` form. R-5: the panel says when live fetching is off for the studio instead of pointing to Settings. Kept for P13: one working discovery per workspace (a per-workspace setting can replace it with a new migration if unattended runs need parallel searches), and unattended adding still trusts the model's `observation` label and a found six-word quote, so P33 should add a second check (an independent review request or a quote-statement overlap test) before unattended adding becomes the normal path.

- **Live check amendment (November 11).** The first live qualification on the dev studio failed (held out 5/7; [evidence](evidence/web-discovery-live-2026-11-11/README.md)). Three search answers were valid JSON, but one lead's `why` ran past the 300-character limit, which the prompt did not state, and that rejected the whole answer. Fix: the scout prompt now states its field limits (role version 2), and over-long summary, title, why and query text is clipped instead of refused. Because the held-out answers were opened to find this (ADR-0052), `web-discovery-v2` moves v1's three held-out scout cases to practice and adds three new held-out scout cases. The reader prompt is unchanged, so its held-out cases stay. `web-discovery-v1` is kept as the record of the first run and no longer admits anything. The qualification reason now says how many held-out cases were needed, instead of "a floor of 1/1".
- **Review 3 amendment (November 11).** The app reads web-discovery and Discover qualifications apart (`forDiscover` / `forWebDiscovery` in contracts), since both are research synthesis: Discover, Explore, the chat card, the model picker and the Models list no longer let one stand in for, or cancel, the other. The held-out guard (ADR-0052) drops a web check's role version from the case key and compares each viewed case with its own stage's prompt, so a revised scout prompt is refused on viewed scout cases while an unchanged reader prompt is not. Clipping never leaves half an emoji, and a lone surrogate in model text becomes U+FFFD, so the answer can be stored.
- **Review 4 amendment (November 11).** The guard recomputes each recorded view from the stored benchmark of the qualification it showed, so views recorded before per-case prompts guard web cases too. Qualify a model shows a web-discovery benchmark's own result, apart from the locator's. Every stored string of the reading answer is made well formed, like the clipped search fields.

Rejected: a paid search API or a browser API now (Jordan's November 11 decision; Brave stays disabled); reading pages through the model's own browsing (the studio must fetch and store what is quoted); adding unverified claims, or letting the model choose pages outside the reported sources; re-sending a plan request after a crash (the outcome is unknown, so it is marked interrupted).

Not done: the Claude Code route's web search (the studio's Claude Code route runs without tools); PDFs; the general fetch path still stores challenge pages as fetched (F2 is handled inside web discovery only); P13 chains this with discovery and assessment.

## ADR-0085 — Assessment requests sized to the connection's input cap, every request reading the same claims (November 11, 2026)

P25 of the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (walk items 7 and 12), with correction M-4 of its review. **Amends ADR-0074.** No migration, no model call, no spending.

- **Problem.** The assessment packet was capped at a fixed 19,000 characters for the whole packet (`MAX_ASSESSMENT_PACKET_CHARS`), and a packet over it refused both the preview and the start ("too large for one model message"), with no next step. On a real problem the options and rubric anchors alone filled that before any claim. The fixed number also ignored the role text: plan admission counts instructions plus input against the connection's `caps.responses.max_input_chars`, and the R08 role text is about 6,500 characters, so even a 19,000-character packet could not fit a 24,000 cap.
- **Requests are sized to the route's per-request input cap.** The cap is the chosen plan connection's accepted `max_input_chars` (read with its settings hash at start; a changed hash is refused), or 32,000 for API, local and fixture routes, which have no cap of their own (review amendment L-3). Each request is counted exactly as plan admission counts it: the worker's instructions plus its JSON user input (`planTaskText`, now shared by the worker and the sizing so they cannot drift), with 1,200 characters kept for the notes and a final exact check of every request.
- **One claim set for the whole assessment.** Options in different requests are compared side by side in the scorecards and ranks, so every request reads the same claims, with the same refs. Claims are added in the existing order while they fit beside the _largest_ request's options. The options are split as finely as needed: at most four option-and-rubric assessments per request (the output cap, unchanged), down to one option per request, and a finer split is used only when it reads clearly more claims (review amendment L-1). A packet note and the preview say how many linked claims were left out.
- **Too large is refused with a next step.** Only if one option alone, with no claims, does not fit is the assessment refused: the message names the option, the characters it needs and the cap, and says to shorten its rationale or trade-offs or raise the connection's input cap under Models and connections, "Change caps or allowed work". That is Jordan's "approve a larger packet": the existing owner-only cap, not a new bypass, since admission would refuse a request above the cap anyway and the provider has to accept it too.
- **Preview.** `GET …/problems/{p}/assessment-preview?connection={id}` sizes to that connection. It returns the number of requests, each request's counted size (`request_chars`), the cap (`limit`), the largest request (`chars`) and `claims_left_out`. Decide reads it again when the connection or its settings change, shows each request's size against the cap, and, when evidence is left out or an option does not fit, offers "Open Models and connections" to raise the input cap. With up to eight requests, the calls stay within the connection's requests-per-run cap (a retry is dropped before a request is), and a run that needs more requests than that cap is blocked with the setting to raise.
- **Unchanged.** The R08 role text and prompt hash, the `assessment-packet/1` schema (so existing scoring qualifications still admit it), the workflow context (`batches` as before, `packetForOptions` per task), staleness and linked-evidence hashes. A small problem that fit one request before gets the identical packet and preview hash (a test pins the hashes computed on main `5ee86e9`).

Rejected: choosing claims per batch (the plan's first wording; options would be rated on different evidence without the person seeing it; it would need its own ADR line and a scorecard note); a per-assessment cap override (a second path around the owner's accepted caps); sending the full packet when it exceeds the cap (admission refuses it).

Observed, not changed: the workflow worker sends the user message as a JSON array, so the packet's JSON is escaped once more and its quotes count twice; qualification requests send the packet text plain. Sizing counts what the worker actually sends. Changing the worker's rendering would change every workflow request and is left for its own decision.

- **Review amendment (PR #171 review, November 11).** M-1: at a 24,000 cap an assessment reads only about 4 to 8 claims on any problem: the fixed cost of a request is about 9,200 counted characters and each claim about 1,760. So the preview now returns `cap_for_all`, the smallest cap (to a thousand) at which no claim is left out for size, and Decide says "Reading all of them needs an input cap of about N characters per request (about N/4 tokens)" with the button to Models and connections. Decide also shows "Rates on N of M linked claims" beside Start. The default `max_input_chars` for new connections stays 24,000 for now: raising it (the review suggests 64,000) is Jordan's decision and is pending. L-1: a finer split (more requests) is kept only when it reads at least 3 more claims or at least a fifth more, because every request repeats the role text and every claim, so twice the requests cost about twice the plan allowance. Eight mid-sized options at 32,000 now take 4 requests reading 9 claims, not 8 requests reading 10. L-2: claims past the 30-claim maximum are counted apart (`claims_over_max`) and noted apart, because raising the cap does not help them and the cap help counts only claims left out for size. L-3: API, local and fixture routes, which have no input cap of their own, are sized to 32,000. On every problem measured that reads at least as much evidence as the 19,000-character packet did before (its role text was not counted then). Their refusal says only to shorten the option. L-4: the size refusal has its own error code (now `BODY_TOO_LARGE`, see the re-review amendment), and Decide offers raising the cap only for that code, not for any preview error. Nits: Start waits while the preview is read again (N-1); the preview line gives the largest request and the per-request sizes move to "Show what would be sent" (N-2); the refusal leads with the option's title (N-3); a request still over the cap with no claims is refused, not returned (N-4); tests pin the claim count at 24,000, `cap_for_all`, the split trade-off and the over-30 count (N-5).

- **Re-review amendment (PR #171 re-review, November 11).** L-A: under the L-1 rule a slightly higher cap could let a coarser split win while reading up to 2 fewer claims, so raising the cap above the "needs about N" hint could read fewer claims (74,000 read 28 of 30 where 73,000 read all). Now the coarsest split that reads every claim always wins. The one-option-per-request split reads the most at any cap, so every cap from `cap_for_all` up reads all claims; below it the L-1 trade-off still applies and can cost up to 2 claims for half the requests. A test checks 30 caps above the hint, and a scan of 2 to 8 long options with 100- to 600-character statements, at caps from 20,000 to 120,000, finds no claim left out at or above the hint. N-A: the size refusal is `BODY_TOO_LARGE` (HTTP 413, the request the studio would send is too large) instead of `LIMIT_EXCEEDED` (429, which reads as rate limiting); Decide's cap help keys on it.

## ADR-0084 — Qualify section: one Run per qualification on the server, all allowed work on for new connections, allow in place (November 11, 2026)

P23 from the [installed-walk fix plan](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) (items 1, 4, 8, 10, 11, 17, 18 and 19), with the corrections of the independent plan review of November 11 (`PR169_FIX_PLAN_REVIEW.md`, M-1, L-1 and N-1). **Amends the least-privilege task default** used since the plan connections were added (ADR-0050 and the Models page): Jordan's Decision A, typed on November 11. No migration, no model call and no spending was needed to build or verify it.

- **One Run loop per qualification, enforced by the server.** A Run is one long request, and the page only remembered its own press, so leaving the page, switching workspaces or a second window could press Run again and start a second loop for the same qualification; that loop skipped the case in flight and then failed on finish with "A qualification case is still unresolved." (Jordan's items 4 and 10). `PlanService.runQualification` now claims the qualification before sending anything (`ConnectionStore.claimQualificationRun`): a qualification this API process is already running is refused ("already running"), so is one with a case still `in_flight` in the database (a run in another process, or one cut off by a restart: wait, or close it under Running now once it can be closed), and so is one that already finished. The claim is checked and taken with no await in between and released when the loop ends, however it ends. The in-process claim is the guard against the gap between two cases; the database check covers a second process only while a case is in flight, which is enough because the studio runs one API process per data home (the desktop app holds an instance lock).
- **The page reads "running" from the server.** Each started qualification in the connection detail carries `executing` (this studio is running its cases now). The Qualify section derives Running…, the locked buttons and "it carries on if you leave this page" from it, so a remount or workspace switch shows the truth within one 2-second refresh, and the section is keyed on workspace and connection so a switch starts it fresh. Start is locked while a qualification on the connection is executing (the connection sends one request at a time) but not merely because an idle one is started.
- **Already qualified, started or not allowed is said, not hidden.** Each benchmark shows where its task stands for the chosen model: "qualified (date, n of m held-out cases passed)" with "Start a re-run" and the line that the newest decided qualification counts, so a failed re-run replaces the pass (ADR-0052); "last run failed" with "Start qualification again"; "started" with no second Start (the server already refused a duplicate); or "not allowed on this connection yet" with **Allow this task**.
- **Decision A: new connections allow every task their kind can take.** All eight on a ChatGPT plan, including code build; the seven Responses tasks on Claude Code, which has no Codex path and whose settings the server refuses with `code_build` (review L-1). The four places that held the old default agree and a test pins them: the two proposals on the Models page (`defaultTaskClasses`) and `config/connections/chatgpt-plan.json` and `claude-code.json`. The owner can untick any task; accepting the caps is still the gate before anything runs. Data classes are a separate setting and keep their default: approved private data stays opt-in. Existing connections keep what they allow.
- **One-click allow, through the same owner route.** "Allow this task" (Qualify section) and "Allow all tasks" (beside Allowed, shown when the connection does not allow everything its kind can take) open the same "Will change: …" summary as Change caps and, on Allow, save the settings through the owner-only settings route. If the caps were accepted, the same confirmation accepts the new version again, so work carries on; if they were not, they stay unaccepted. No new route or authority path; the version, `settings_hash` and `caps_accepted_at` move as for any change. Change caps gets Select all and Deselect all for tasks only; data classes stay one by one so a bulk choice never ticks approved private data.
- **Refusals name the reason.** Where a model is "not qualified" for a task the connection does not allow (the Chat discovery card, Discover › Explore for me, Discover's setup blockers), the message says the task is not allowed on this connection and where to allow it. The fix-it-here buttons on those refusals stay in P27.
- **Placement and small items.** "Qualify a model for a task" moved to right below the approved model check, above the list of results (item 1). The approved model check's Model box shows an example id on ChatGPT too (`gpt-6-astra`; item 19, moved from P26 by review N-1). Refresh connection status also reloads the Chat answers card even when the connection list did not change (a gap handed over from P26).

- **Review amendment (PR #172 review, November 11).** M-1: the Qualify section has benchmarks only for specification, summarization, the builder and reviewer roles and scoring, so the refusal texts no longer point at "Allow this task in Qualify a model" for research synthesis or candidate generation. One helper (`missingTaskTexts` in `discover-defaults.ts`, used by the Chat discovery card, Explore for me and Discover's setup blockers) says: a task that is not allowed can be allowed with Allow all tasks or in Change caps; Qualify a model is named only for tasks in `QUALIFY_IN_APP` (kept equal to the section's benchmarks by a test); for the others it says the app can't qualify them yet (re-review N-A: without naming the command line, which the installed app does not have), and several names read "a, b and c" (N-B). Qualifying the discovery roles in the app is planned as P34 (PR #174). L-1: the two requests of an allow press (`allowTaskSequence`) report errors through the page's or the section's error line, which outlives the button (saving reloads the page and the button disappears before accept-caps answers); a refused re-acceptance says the caps are no longer accepted and how to accept them. L-2: the Run claim also refuses a case whose outcome is `unknown` (as Finish already did), with "close it under Running now", so item 10's message cannot come back through an unknown case. Nits: Finish from another window is refused while a Run loop holds the qualification (the loop itself still finishes it); the qualified tag in the benchmark list is just the date; the Chat answers `stamp` is empty until there is a connection or a Refresh press, with a comment saying what changes it.

Rejected: a UI-only guard (the plan's first version: two windows still start two loops); disabling Start for every started qualification (it blocked Start whenever an idle started one existed); a database run lease (needs a migration and a lease expiry for a loop the process already owns; revisit with P24's background runner, which needs crash recovery anyway); Select all for data classes.

Not done: qualify several tasks in one go and running qualifications in the background (P24); allow buttons on refusals outside Models (P27).

## ADR-0083 — Action cards in Chat: the next step filled in from the conversation, sent by the person through the form's own routes (November 11, 2026)

P20 (revision R22, "do the whole process from Chat") from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), November 10 section. **Amends ADR-0057 and ADR-0070** (Jordan approved the amendment on November 10): Chat no longer only opens the tab where work happens; it can hold a card that does the step. Everything else in ADR-0055/0057/0070 stands: a model answer is advice, nothing a model writes starts, approves or spends anything, and the owner's chat switch, caps and limits are unchanged. Migration 53 (`chat_actions`). No model call, no spending and no live step was needed to build or verify it.

- **A card stands in for one form.** Kinds: set up a budget, fetch a page, record a claim, start a discovery, answer a waiting decision, score an option, record a choice, save a proposal (the main path from an empty workspace to a decision and a proposal). Freezing a spec, building and exporting a runbook keep their tabs for now (a later slice); the card says "Use the form instead" for every kind.
- **Guided questions, one at a time.** A card asks the form's own questions in the form's order, says what it still needs ("Still needed: …"), lists the answers so far with Change, and shows "What will happen" (P19's piece) and, folded, **exactly the requests Send makes** (route and body, in order). Standard uses P19's routine defaults without asking and names them with their source; Advanced asks them too. A default never answers a judgment (ratings, gates, dispositions, stances and reasons are always asked) and never adds evidence, a grant, a qualification or a higher cap.
- **The person's click is the approval; the browser sends through the form's routes.** Send makes the same requests as the form, from the person's browser, with the person's session and CSRF token, so every role, grant, budget cap, admission, qualification, routine policy (P10), study rule and human-only rule is checked by the route exactly as for the form, with the same refusal text. Nothing new runs on the server for a card: no model, no worker, no second path to a decision. A step that needs an approval the person has not given (a run's gate, a decision) is held as the form would be; the card shows "Held for a decision" and offers "Send again with the same answers" once it is answered.
- **Provenance.** `POST …/chats/{c}/actions/{a}/send` checks the card's subjects, appends `chat.action_sent` (who sent it, the card, its kind and origin, the model answer it came from, the subject versions) and returns that event's id. Every request of the send carries it as `X-Causation-Id` (and the card id as `X-Correlation-Id`), which the API already maps into each audit event's `causation_id`/`correlation_id`; a new partial index `audit_events_by_causation` finds them. The browser then reports how the routes answered; the store does not take its word alone but counts the events, written by the sender, that name the send: success with events is `done`, success with none is `unconfirmed`; a refusal is `partial` (shown as "Refused; part of it was recorded") only when work it asked for was saved first, and otherwise `refused` (events that only record the refusal itself, such as a study-run denial or a blocked fetch, do not count as work; see the re-review amendments); a page that lost track is `unconfirmed` when work was recorded and `refused` otherwise. Only the sender reports; a repeated report returns the finished card unchanged. `chat.action_proposed`, `chat.action_stale`, `chat.action_finished` and `chat.action_dismissed` complete the trail.
- **Stale cards are refused before anything is sent.** A card stores the records it was made from (entities and decisions, with versions; at most 40) each time an answer is saved. At send, a record that changed version, was archived, left the workspace, or a decision no longer waiting, makes the card `stale` with the reason, committed and audited, and the send answers `VERSION_CONFLICT` with that reason. Nothing is sent. Answers are saved against the card's version (`VERSION_CONFLICT` on a stale page).
- **A model may suggest one card, never send it.** CHAT_INSTRUCTIONS v3 lets an answer end with `<propose_action kind="KIND">{"text": "…", "url": "…"}</propose_action>`. When the answer completes, exactly one tag of an allowed kind with only those two short hints becomes an origin `model` draft card under the answer; anything else (two tags, an unknown kind, answering a decision, any other field, bad JSON) makes no card and the answer says why. The answer's text is kept as the model wrote it (its hash is already recorded); the page hides the tag. Hints only prefill the first question (a theme, a claim statement or an address), which the person still sees and confirms. A model cannot carry a grant, policy, cap, budget or decision answer, cannot pick a decision, and never acts as the owner.
- **Where cards come from.** "Do it here" on the studio's replies (what's next, why blocked, what's waiting, a pasted address, "start a discovery about …", a saved idea), chosen by the Path tab's own rules (`cardForStep`); "Do a step here" under the conversation for any kind; and a model suggestion. Any editor or owner may fill in and send a card (the routes then apply their own roles: answering most decisions, for example, stays owner-only); viewers see cards and cannot change them.

- **Review amendment (PR #165 review, November 11).** M-1: a fetch card asks before registering a new evidence-gathering run ("No run can fetch pages yet. Register a new evidence-gathering run for this?"), in Standard too, because that step creates a 24-hour fetch grant and a default never adds a grant; the run question stays routine only when an existing fetching run is picked. L-1: every card says "Nothing happens until you press Send. It makes only the requests listed below, through the form's own routes, which check them exactly as for the form" (the old sentence wrongly said a card cannot add permissions, money or approvals). L-2: a decision card's `time_spent_ms` counts from when the card is shown on this page to the moment of Send, in milliseconds (capped at 24 hours), as on Approvals; nothing is stored on the card. L-3: a send the selection route holds for a decision reads "Held for a decision", not "Done". L-4: a test sends a discovery card's own request against a human-only run with the card's headers and gets the form's `HUMAN_ONLY_DENIED` and words; the recorded refusal names the send. L-5: "Send again" names the card it repeats (`again_of`, a new column in migration 53, which is unreleased); the store copies that card's origin and model answer, and `chat.action_proposed`/`chat.action_sent` record both; only a finished card of the same kind in the same conversation can be repeated, and the client still cannot set origin `model`. Nits: placeholders fill only whole-string values and path segments, never text the person typed (N-1); a routine answer is shown without a source that repeats it (N-2); each reported record is marked `in_trail` by the store when a caused audit event names it, and a record no event names is shown as reported by the page (N-3); the sender can record how a send ended after losing the editor role (N-4); a card naming more than 40 records says so plainly and cannot be sent (N-5).

- **Re-review amendment (PR #165 re-review, November 11).** L-6: an event that only records a route's refusal (`study.workflow_denied` or any other `*_denied`, a `source.fetch_recorded` whose state is not `fetched`, an `action.evaluated` that did not allow) does not count as work when a refused send is classed, so a study-run refusal or a blocked fetch ends `refused` with the form's words, and `partial` means something the request asked for was saved before the refusal; the event count still shows every caused event. N-7: the committed browser walk answers the new run question, waits for "Held for a decision", and was re-run. N-8: "Send again" on a fetch card that registered a new run drops that answer, so the run it registered is the routine choice and no second run or grant is made. N-9: the new-run question reads "Fetching needs a run with a 24-hour fetch grant. Register a new evidence-gathering run?" and says that putting the card away cancels.

- **Second re-review amendment (November 11).** N-10: a send the page lost track of whose only events record a refusal ends `refused` ("only a refusal was recorded. Nothing was saved"), like a reported refusal. N-11: the provenance paragraph above states the rule as amended.

- **P31 amendment (November 12).** [ADR-0096](#adr-0096--model-help-on-chat-cards-proposals-for-a-cards-text-answers-next-step-and-explore-for-me-on-the-discovery-card-november-12-2026): the owner's chat model may propose text for a draft card's descriptive questions (recorded, owner only, under the chat answer's admission); the person's **Use these** saves them as answers and Send still sends. A finished card offers Next step, and the discovery card offers Explore for me. Nothing here lets a model send a card, pick a record or answer a judgment.

Rejected: sending a card from the server by re-dispatching the routes internally (a second path to every gate that could drift from the forms); letting a model send or auto-send a card, even inside a routine policy (the policy admits the request the person's click makes; it does not make the click); trusting the browser's report without the audit trail; storing hints as answers.

Not done: spec freeze, build and runbook export cards; editing an earlier selection (a card records a problem's first selection; a later one is on Decide); scoring with the other rubrics or editing a system assessment (Decide); a card cannot be resumed on another device mid-send (a card left "sending" offers "Check what happened" to its sender).

## ADR-0082 — Standard and Advanced across the app: one choice per person on the server, folded routine fields, fewer tabs, a first-run path (November 11, 2026)

P19 (revisions R21 and the rest of R10–R12) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), November 10 section. Extends ADR-0071 from Discover to the whole studio. Migration 52 (`person_preferences`). No model call, no spending and no live step.

- **One choice per person, kept on the server.** `person_preferences (actor_id)` holds `view_mode` (`standard` | `advanced`) with a version. `GET/POST /api/me/view-mode` reads and sets the signed-in person's own choice; any signed-in person, owner or tester, may (it is presentation, not authority, so it is not owner-only and not audited). A stale `expected_version` is refused (`VERSION_CONFLICT`); the page then reads the newer version and saves the person's latest click once. Server-side rather than browser storage (ADR-0071's choice for Discover) because the plan asks for it to follow the person across browsers, devices and the desktop app. This browser keeps a copy only to paint the first screen before the server answers; before a person has ever chosen, Discover's older Guided/Advanced choice in this browser is honoured, else Standard.
- **Where it is set.** A Standard/Advanced switch at the foot of the page list (every page), on Settings, and in place of Discover's Guided/Advanced radio (ADR-0071's Guided is now Standard). Discover presets stay per browser as ADR-0071 decided.
- **Standard folds routine fields behind visible defaults; Advanced opens them.** One `Routine` fold (`apps/web/src/routine.tsx`): in Standard a `<details>` whose summary names the current values and whether each is a studio default or changed here; in Advanced the same fields, open. A fold holding a field with an error opens. Both modes submit exactly the same request. Folded per form: Discover (as ADR-0071); evidence citation (kind of evidence only; basis and stance stay open because they say what the evidence is); scorecard (four routine checks and existing tools checked; "Evidence against it" and "What they do today" stay open, review L-1); humility review (the optional inferred/disputed/unknown points, burdens and risks, and dissent); spec (each task's role, file scope and waits-for; data contracts, risks and upkeep); build (run, budget, pricing and humility review pickers).
- **Defaults never decide a judgment or add authority.** New defaults: an unanswered routine scorecard check starts as "unknown" (the answer the form already asked for when you do not know), while "Evidence against it" and "What they do today" start empty and need a deliberate answer (re-review N-B); a new spec's task T1 is a builder task delivering A1, its maintainer is the spec's author, its upkeep is "Check that the acceptance checks still pass", reviewed "Every 3 months"; with no active budget, the fund form starts at 100 simulated units in a fixture workspace and $0 in a real one. Every rating, gate, confidence, viability call, disposition, stance, basis, check method and case stays unpicked. No default adds evidence, a grant, a qualification, a higher cap or the private data class. The server checks every request as before; no server gate changed.
- **"What will happen" before each start.** The same summary Discover has, now on evidence, scorecard, humility review, spec and build: what pressing the button saves or starts, the builder and its limits, and where routine values came from.
- **Standard lists fewer tabs.** Projects › Launch (Sell, Campaigns, Maintain), Monitor › Workers and Settings › Study are left out of the tab rows and replaced by one "… in Advanced" link that switches. Their routes are not removed: addresses, Chat buttons and the what's-next line still open them, and an open hidden tab is listed while it is open. A page opened from the page list in Standard goes to a listed tab unless the person was last on another.
- **Getting started.** On Chat and Path, until the workspace has a scored option and a proposal, spec or build: five steps in the main path's order (record evidence, set up a budget, discover, score an option, choose), only the current one with its text and one button to the tab where it happens. Done states come from the same workspace facts as the what's-next line (plus a proposals count); a later record never skips an earlier gap. The person can hide it per workspace (this browser). It starts nothing.
- **For P20.** Chat-guided steps can read the same `view_mode` (`GET /api/me/view-mode`) to decide how many questions to ask, reuse `firstRunSteps` (`apps/web/src/first-run-rules.ts`) for "what do I do first", and present the same `Routine` defaults and "What will happen" items on an action card.

Rejected: a per-workspace choice (people work across workspaces and expect one studio); hiding the tabs' routes (links from records and Chat must keep working); defaulting judgments such as a scorecard's software influence or the Decide dispositions of options not chosen (a default must not record a judgment nobody made); a settings framework.

Not done: Decide's selection form (every option still needs a disposition, reason and what would reverse it) and the Proposals form are not folded: both are being rewritten by P18 (PR #162), so they are left for a small follow-up after it merges. The build and spec forms were checked rendered, not walked to a finished build (the walk ends at a proposal, which the gate allows).

## ADR-0081 — Current model: one owner choice per workspace beside the usage indicator; forms start from it (November 10, 2026)

P21 (revision R23) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), November 10 section. Migration 51 (`model_choices`). No model call, no spending and no live step.

- **Stored on the server, per person and workspace.** `model_choices (workspace_id, actor_id)` holds a plan connection and a model with a version. `GET/POST /api/workspaces/:ws/model-choice` reads and switches it; the route is owner-only like the plan connections it points at (ADR-0075 testers are refused). Server-side rather than browser storage so the choice follows the owner across devices and windows, and so a saved chat setting (already server-side, ADR-0057) can move with it in one transaction.
- **Only verified models.** A switch is refused unless the model has verified Responses access on a connection of that workspace. Qualification is not checked at switch time: it is per task, and each form checks it where the task runs, as before.
- **Forms start from it, never switch quietly.** Explore, Discover, Assess, Build (plan-role builder), the Chat answers setting and Qualify use the choice when nothing was picked on the form; a pick on the form wins for that form only. When the current model is not qualified for the form's task, the form keeps it, shows the existing blocker and offers a qualified alternative (same connection first, only connections that can run now) as a button, instead of silently using another model (`apps/web/src/model-choice.ts`). A choice no longer verified falls back to the form's own default and says so.
- **Chat follows a saved setting.** If the owner has saved a chat-answer setting, the switch moves its connection and model in the same transaction (on/off, snapshot and daily limit untouched), audited as `chat.settings_changed` with `via: model_switch`. An unsaved chat setting is not created; its form starts from the choice.
- **Started work keeps its route.** The switch writes only `model_choices` and, as above, `chat_settings`. Runs, workflows, builds, qualifications and chat answers keep the connection and model they recorded when they started.
- **Audited.** Each switch appends `model_choice.changed` with the new and previous route.

Rejected: browser `localStorage` (per device, invisible to the server and to chat); a workspace-wide choice for all members (plan connections are the owner's own credentials); picking the first qualified model automatically when the choice is not qualified (the person would not know which model ran); changing routes of runs already started (breaks the recorded route and the provenance invariant).

Not done: the Build plan-role default and its alternative are covered by unit tests of `planBuilderDefault` and the qualification blocker, not by a browser walk (fixture workspaces list no plan builders); Qualify preselects the choice but a fixture connection cannot be qualified, so that was not walked either; the CLI has no command for the choice.

## ADR-0080 — Runbook export: a standalone bundle of ordered prompts computed from a spec or proposal version (November 10, 2026)

P16 (revision R18) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). Guide: [docs/RUNBOOK_EXPORT.md](../docs/RUNBOOK_EXPORT.md). No migration, no model call, no spending and no live step.

- **Computed on read, nothing stored.** `RunbookStore` (between `ProposalStore` and `StudyStore`) builds the bundle from one saved version of a `specification` (software runbook) or a `proposal` (action runbook) and the records it follows: the selection's decision for that option, the option version the subject names, the problem, a humility review whose subject is the spec, and the problem's active linked claims with their non-retracted sources. Any member who can read the records can export; saving to Files needs write access and uses the ADR-0072 upload path. No table, no entity kind and no admission, because the export changes nothing and grants nothing.
- **`runbook/1` bundle.** README, shared contract, requirements, task plan, stack and limits, decisions (decided / proposed by the bundle / assumptions / still to decide), evidence, recovery, one prompt file per step (setup, each spec task in dependency order, independent review and repair, verify and hand over), the requirements and visible cases as JSON, a standard-library Python runner for command-line cases, and `manifest.json` with the subject's version and content hash, the freeze of exactly that version, what was withheld, a SHA-256 per file and a bundle hash. Each prompt names prerequisites, scope, expected artifacts and a completion gate. An action runbook carries the proposal's canonical Markdown as `PLAN.md` and prompts for people-led steps.
- **Deterministic bytes.** No export time is written; the archive is an uncompressed ZIP with fixed dates and sorted entries. The same version and records give the same bytes, so a second save to Files keeps one copy.
- **Withheld on purpose.** Held-out acceptance cases are dropped and only counted. Every text field is scanned for well-known credential formats and personal folder paths, which are replaced and counted. The scan is a pattern list and is described as such, not as a guarantee. Scores, chat, notes, files, other options, proposal reviews, run and budget records and retracted evidence are never read into the bundle.
- **Honest states.** An unfrozen spec version exports with a warning and "draft" requirements; a replaced selection, a changed option, missing evidence, a spec with no executable cases (no stack proposed, no runner) and redactions are each stated in the manifest and README. A recipe name only says which studio recipe the checks fit. An invalid task plan is refused. The bundle says it is a plan and that nothing in it shows the work exists or was accepted.
- **Self-check.** `validateRunbook` runs on every export (manifest schema, file list and hashes, prompt order and prerequisites, every relative link inside the bundle, no credential-like value, personal path or held-out case) and the export fails closed if it does not hold. No checker ships in the bundle; its README states the hash rule so a receiver can check the files and the bundle hash with any tool.

Rejected: a model-written runbook (needs a role, a qualification and live calls, and could invent requirements the frozen spec does not hold); storing bundles as records (a second copy of versioned data that could drift); a tar archive (Windows users open ZIP without tools); bundling held-out cases "for the owner" (the bundle is meant to leave the studio); a generic `key = value` secret scrub (it would silently alter frozen expected outputs).

Not done: the plan's independent-consumption gate (a separately scoped implementer building the synthetic project from only the bundle) was not run in this change and stays unverified; a browser-case runner; a CLI command; richer formats.

Update, November 10: the gate was run by a separate session and both held-out cases passed; a second, not blind, run passed after its findings were fixed. Record and limits: `tracking/evidence/runbook-export/clean-room-2026-11-10.md`. The built project was not kept, so the result cannot be re-checked from this repository. After independent review of PR #152 the bundle also reports the studio's pre-build humility gate (no review, a review that does not admit a build, unresolved ethics) as a warning and an open decision, an action runbook's plan text is rendered after redaction, and a failed self-check is a stated refusal (`INVALID_CONTRACT`).

## ADR-0079 — Routine approvals: one owner policy per run, admitted by code, set at run setup or mid run (November 10, 2026)

P10 (R05) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). Migration 50 (`routine_policies`, `routine_policy_versions`, an index on `action_admissions.grant_id`). Contract version `routine/1.0`.

- **What it is.** "Approve routine steps for me" is a policy the owner sets for one run. It names stages (fixed in code, `ROUTINE_STAGE_ACTIONS`): research (`tool.search_public`, `source.fetch`), model work (`model.generate`, `model.summarize`, `model.embed`), selection (`candidate.select`), specification freeze (`spec.freeze`) and build (`product.commit_build`, whose one build approval under ADR-0054 covers the review, repair rounds and private package). It also names data classes, the most steps in total, a money total, an end time within 90 days, and stop conditions. Owner-set limits have no hard-coded maximum (November 3 decision).
- **Admission is code, through one grant.** The policy owns one run-scoped standing grant, created by the owner's request and never allowing external effects. That grant is left out of ordinary grant matching (`withoutRoutineGrants`); only the policy path in `evaluateAction` may use it, after an ordinary covering grant was looked for first (existing grants are reused and do not spend the policy's limit). On that path the policy's grant also satisfies a supervised run's stage gates, which an ordinary standing grant does not. Each admission records the grant id and version, reason code `covered_by_routine_policy` and the policy id and version in its audit event. No approve-once grant or decision is created; a model cannot create, widen or confirm a policy (`requireOwner`: a signed-in person who owns the workspace).
- **One up-front summary.** `routinePolicySummary` (contracts) writes the summary from the chosen values; the form shows it and the request must carry the same lines (`summary_seen`), or it is refused. The stored policy keeps the summary that was confirmed.
- **Set at run setup or mid run (owner decision, November 10).** `POST runs` takes an optional `routine_policy`, and `POST runs/{id}/routine-policy` turns routine approvals on for a run that is already going: one set up without a policy, or one whose policy was revoked. The first version of this ADR allowed setup only; Jordan asked on November 10 for the choice to change it mid run. It is the same owner action either way (a signed-in person who owns the workspace, the summary confirmed, audited), never a plain setting, and a run has at most one active policy (partial unique index). The run's mode, condition and stage gates are unchanged by a policy, so the run's record still says how it was set up and the policy's versions say from when steps stopped asking. Refused for autonomous runs (the initial grant packet stays their only approval), human-only runs and any study run (frozen conditions). Mid run, "study run" is read from records an editor cannot change: a `study_attempts` row for the run, or the `config_hash` of the run version that was registered (`run_controls.run_version`); the current record counts as well (review M-1: the run record itself can be revised by any editor, an agent included). Saved Discover presets (ADR-0071) never carry a policy: it is off until ticked on the form.
- **Limits and stops, checked under the run lock.** Before the policy path is used the store counts what the policy's grant has admitted (steps, and the sum of stated maximum amounts) and refuses past either limit; a step that states an amount is never covered when no total is set. Stop conditions: `person_rejects` (a rejection in the run after the policy was last confirmed) and `unknown_outcome` (a budget reservation of the run in `unknown`). Admissions for a run are serialized by the run lock, so concurrent steps cannot pass a limit. A build the policy admitted counts as one step. Before each plan build-role request the stop conditions are checked again, so a rejection or an unknown outcome stops a build in flight at its next request (review L-1); the step limit is not applied to a build already admitted, which finishes within its own request limit.
- **Out of scope pauses and asks.** When the policy does not cover a step, admission continues as before: a decision is raised for the person, and its text says why routine approvals did not cover it: a limit or stop condition, or, for a kind of step the policy names, that its end time has passed, the data class is not covered, or the step states an amount the money total does not allow (review L-3). Value questions, flags, material or refuted assumptions and a serious unresolved ethical problem still ask; a failed humility review is still refused; human-only model denial and owner-only actions are unchanged. Publishing, messages, payments, GitHub changes, grants, policy and budget changes can never be in a policy.
- **Changes and revocation.** `POST routine-policies/{id}/revisions` needs the current version and the new summary confirmed; it is recorded as `widened` (permits more: a stage, data class, higher limit, later end, or a removed stop), `narrowed`, or `reconfirmed` when the same settings are confirmed again, for example to continue after a rejection (review L-2). Every version is kept in `routine_policy_versions` (append-only). A change bumps the grant version, so a build approved under the earlier version stops at its next request and asks again (ADR-0054's "grant changed" rule). Revocation (`…/revoke`, revoking the grant in the grant list, or stopping the run) ends that policy for good; the owner can turn routine approvals on again for the run, which creates a new policy with its own grant, limits and history. The policy's grant cannot be revised as a grant.
- **UI.** Discover › Run, model and permission (new run only): the on/off box, stages, data, limits, stops, the summary and a confirmation box; the form will not send until the summary is confirmed. Monitor › Approvals: turn routine approvals on for a run that is already going (same fields, summary and confirmation); each policy with its state (admitting, paused with the reason, ended, revoked), use, the confirmed summary, the steps it admitted (marked as admitted by policy rules, not approved by a person), Change and Revoke. Revoke asks for confirmation first, and the mid-run form starts from the kinds of data seen in the run's waiting decisions and own grants and says a step on any other kind still asks (review L-4, L-5).

Known limits: evidence (claim) admission has no action type yet, so no stage covers it; claims are still entered and accepted by people, and P12 must add the action and a stage before any unattended claim admission. The money total sums each step's stated maximum, not actual spend; budgets, the spending ceiling and connection caps apply as before. Plan requests have no "unknown outcome" stop of their own. The other run-setup pages (Evidence, Assess, Explore) register human-in-the-loop runs without the policy fields. There is no CLI command for policies. Domain scope and output scope from the P10 prompt are not part of a policy: which websites research may fetch still comes from the existing evidence-site settings, and nothing limits what kind of output a covered step may produce beyond the stage it belongs to. The mid-run form cannot know every kind of data a run will use; it shows what the page has seen.

Rejected: letting a model answer decisions or minting approve-once grants from a policy (manufactured approvals); a workspace-wide toggle, or any change of a run's recorded mode or condition (a supervised run must not silently become an autonomous one); relaxing the `allow = grant` admission invariant with a separate non-grant path (would bypass ADR-0054's build approval checks and grant revocation); and counting a policy's use per version (a change would reset the limit).

## ADR-0078 — Static web recipe (static-web/1): frozen browser checks in a pinned headless browser, previews on their own origin (November 6, 2026)

P15 slice 1 from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), following the [P14 matrix](../docs/CAPABILITY_MATRIX_2026-11-05.md) order. Design and setup: [docs/STATIC_WEB_RECIPE.md](../docs/STATIC_WEB_RECIPE.md). No migration.

- **Recipe choice from frozen checks.** A task whose every acceptance check is a `browser_check` with `browser_cases` builds with `static-web/1`; every check an `automated_test` with `cases` keeps `python-build/1`; a mix is refused in words (`taskRecipe`, `specRecipe`, `buildBlockers`). A product records `recipe: 'static-web/1'` (absent = Python, so existing product manifests are unchanged) and starts from the reviewed `static-site/1` template: `site/index.html`, `site/style.css`, `site/app.js`, `readme.md`. Plain HTML, CSS and JavaScript served as files: no packages, CDN, build step or network. Pinned Node and dependency acquisition are deferred to a later slice.
- **Browser cases are data.** `acceptance_checks[].browser_cases` (optional, additive) hold a page (`/`, `/x.html`, optional `#route`), up to 25 typed steps (click, check, fill, select, press, goto, expect text/contains/visible/hidden/count/title) and `held_out`. The spec form takes one step per line (`fill #name = Ada`). Steps are read by the reviewed checker; no spec author script runs. They are part of the frozen task hash like CLI cases. Held-out cases never reach a role packet.
- **QA in the same isolation (amended below: workers, WebSockets, WebRTC, popups, dialogs and page loads; 1 s settle).** `worker/web_recipe.py` runs inside the existing bwrap + systemd unit (bridge `--recipe static-web/1`): it copies the snapshot, checks the site's shape (index.html, ≤60 files, known text types), serves `site/` on a loopback-only server inside the sandbox's own network namespace and drives the pinned Chrome for Testing headless shell 156.0.8078.47 over `--remote-debugging-pipe` (stdlib Python, no sockets to the host). Steps run in an isolated JavaScript world, so page scripts cannot replace the checker's functions. A case passes only when every step passes and there is no uncaught page error and no request outside the site. Web policy: 1 GiB memory, 512 tasks, 100% CPU, 60 s, 64 MiB work, 256 MiB tmp; uid, lease, log and no-network rules unchanged. The bridge verifies the browser tree's SHA-256 and ownership before every web run.
- **Browser install is an owner device step.** `worker/install_browser.py` (run by the owner in WSL as uid 1000) checks the pinned archive's SHA-256 before extracting and the tree hash after; it prints, but never runs, the apt command for the browser's system libraries. The studio never downloads or installs anything.
- **Previews on their own origin (amended below: no `allow-modals`; an old frame's later requests are refused and an ended preview removes its frame).** A static web preview page (127.0.0.1 preview origin, unchanged ticket/session/heartbeat/Stop rules from ADR-0069) embeds the site in a sandboxed iframe (`allow-scripts allow-forms allow-same-origin allow-modals`) served from `w<preview id>-<frame token>.localhost:<preview port>`: a different host, so a different origin and site from the studio and the preview page. The frame token is an HMAC of the preview id and its current session hash under a per-process key, so a new link, Stop, Revoke, expiry or restart ends older frames. Every file request rechecks the preview lease and re-hashes the package. Files are served with a CSP that allows only the site's own files and inline code (`connect-src 'none'`, `form-action 'none'`, `frame-ancestors` = the preview origin). Static web previews have no command runs and no terminal; hosted studios refuse them for now.
- **Role prompts unchanged.** `builder/1` and `independent-reviewer/2` stay; the builder packet's `qa_runtime` describes the web checker (as ADR-0076 did for Python). Existing qualifications were measured on Python tasks only, so the web recipe is **not** qualified until a frozen web benchmark passes live (packet in the design doc).

- **Review amendment (PR #149 review, before any live run).** M-1: the checker auto-attaches every dedicated worker (paused until its requests are recorded), counts WebSockets and WebRTC attempts (constructors replaced before page scripts) as outside requests, and refuses service and shared workers. M-2 (per-connection since the re-review, see next bullet): a build with any other recipe records `toolchain.role_qualification: 'unqualified_trial'` and a limitation, and the build and Try pages show it. L-1: dialogs are dismissed and fail the case by name; loading another document is detected when requested and fails the case by name; the preview frame drops `allow-modals`; the builder's `qa_runtime` notes list both. L-2: the preview page removes the frame when its heartbeat says the preview ended. L-3: `previewFrame` checks the token before updating `last_seen_at`, and all frame refusals are one 403. L-4: typed steps round-trip (values keep spaces; selectors with `=` or an unbalanced shape are refused). L-5: `bridge.py` exposes `sandbox_args` and `verify_browser`, and the benchmark script uses both. L-6: banner and preview text say links can still leave the site. L-7 accepted: with `--no-sandbox` Chrome (its sandbox needs user namespaces, which the QA sandbox disables), a renderer exploit could control the browser's answers and ptrace the checker but not leave the sandbox; the pinned version is re-checked at each P15 slice and at least monthly, an update is a reviewed hash change plus a new benchmark version, and a per-browser sandbox needs its own ADR. Because the checker changed, benchmark v1 was replaced by `p15-small-signup-v2` (same cases, spec content and reference; 5 hostile-page known failures added) before any live run. Review report: [docs/PR149_STATIC_WEB_RECIPE_REVIEW_2026-11-06.md](../docs/PR149_STATIC_WEB_RECIPE_REVIEW_2026-11-06.md).

- **Re-review amendment (PR #149 re-review at `aec1dc2`, before any live run).** L-8: a new page target with an opener (popup) fails the case, and the page runs a 1 s settle after the last step; the claim is "no outside request was seen during the frozen cases", not that none can happen. L-9: there is no global qualified-recipe switch; `unqualifiedTrial` lifts the trial label only when a recorded benchmark pass matches the build's own connection, model and both role-prompt hashes (`RECIPE_QUALIFICATIONS`, empty until the live web benchmark passes; each pass is its own record with evidence). N-1: hostile known failures must fail with their own reason. N-2: selector wording; escaped trailing characters accepted. N-3: the bullets above are marked as amended. N-4: `PINNED_BROWSER` records the pin date (a test checks it against the bridge); the build page shows when the monthly security re-check is due or overdue. Benchmark v2 became `p15-small-signup-v3` (popup and late-request known failures added) before any live run. Report: [docs/PR149_REREVIEW_2026-11-06.md](../docs/PR149_REREVIEW_2026-11-06.md).

- **Third-review amendment (PR #149 third review at `e9b5a68`, before any live run).** L-10: the role-prompt hashes that `unqualifiedTrial` matches come from the prompts the build recorded in `intent.json` (checked against its recorded prompt hash), not the code at packaging time, and a recorded pass counts only for the recipe's current benchmark version (`RECIPE_BENCHMARKS`). L-11: the build page reads each package's own `role_qualification`. N-b: the checker reports popups and unsupported workers in a separate `unsupported` list; that checker change replaced benchmark v3 with `p15-small-signup-v4`.

- **Live qualification (November 6, after merge).** `p15-small-signup-v4` passed 3 of 3 live on the ChatGPT-plan connection `4e4a7bec…` with `gpt-6-astra` and the current builder and reviewer prompts ([results](evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json)); it is the first `RECIPE_QUALIFICATIONS` record. It qualifies only that connection, model and prompt pair on that benchmark version.

Rejected: serving generated pages on another port of 127.0.0.1 (same host, so same cookie jar and same site); a cookie-authenticated frame (third-party cookies in an iframe are being blocked by browsers); running Playwright or Node inside the sandbox (needs packages and a Node toolchain the reviewed backend does not have); evaluating checker code in the page's main world (page scripts could fake results); and letting spec authors write JavaScript checks (that is code, not frozen data).

## ADR-0077 — Why this response, versioned non-code proposals, and the hybrid humility gate (November 6, 2026)

P09 (revisions R08/R09) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). Reuses the selection report, scorecards, humility reviews, selections, entity versions, links and the P05 Files path. No model is called, nothing is spent and no live step is needed.

- **Why this response.** `GET problems/{id}/explanation` returns `response-explanation/1`, computed by application code on read from the current report, the problem's current selection, the counted scorecards and the newest humility review of each software option. It names the chosen response (the selection's advancing options, or the top suitability rank when nothing is selected; ties stay ties), its reasons and "would change if" text, and, for every software or hybrid option not chosen, the suitability criteria it is behind on (mean of counted ratings against the leader's), the criteria nobody rated (unknown, never treated as low), the open select-for-build gates, its humility review (software part, change-course trigger, disconfirming test) and a list of specific evidence or conditions that would make it preferable. Software influence stays in the opportunity rubric only, so nothing in the explanation can tilt the comparison toward code. Decide shows it as "Why this response" under the selection form.
- **Proposals.** A new stored kind `proposal` (migration 49 widens `entities_kind_check`), body `proposal/1`: problem, option (an existing tool, process change, human-led, hybrid or investigate option), the selection that advanced it, a summary and 15 sections (problem and users, background, objectives, evidence, contrary evidence, methods, materials, roles, timeline, costs, evaluation, ethics and risks, limitations, decision-changing assumptions, next tasks). Each section is written, unknown or not applicable; the seven core sections can never be not applicable. References are built from the cited claims and their sources, never typed. Body limit 128 KiB for this kind (16 KiB for others). The generic record API refuses the kind; `POST proposals` checks the option is a non-code kind that the problem's current selection recommended (or sent to validation) at this exact version, and that every cited claim is an active claim of the workspace at the cited version. A `derived_from` link (new pair `proposal:alternative`) ties it to the option. Custom software is refused with "goes to a spec and a build".
- **Draft from records.** `GET proposals/draft?alternative=` fills only what records hold (problem and affected group, the option's rationale and the selection's reasons, linked supporting and contrary claims as citations, recorded uncertainty and trade-offs, the selection's reverse-if and the software routes' conditions as assumptions) and marks every other section unknown. Nothing is saved until the person saves.
- **Checks.** Computed on read for the exact version: core sections still unknown (blocker), an evidence section without citations (blocker), a cited claim missing or no longer active (blocker), a claim cited at an older version, not linked to the problem, or cited as contrary while linked as support (warnings), contrary claims linked to the problem but not cited, and a changed problem or option or a replaced selection (warnings). "Ready for review" means complete with no blocker; the page and export say these checks are about the document, not whether the plan works.
- **Versions and reviews.** Revisions are entity versions with a reason; a revision keeps the problem, option, selection and response. `proposal_reviews` (migration 49, append-only) records a verdict (ready or revise, revise needs comments), four marks (completeness, citation fidelity, feasibility, access and ethics: looks right, concern, not checked) and comments, bound to one version and content hash; a review of a version that is no longer current is refused, and older reviews stay listed for the version they read. Viewers can read and download but not write or review.
- **Export.** `GET proposals/{id}/export?version=` returns the canonical Markdown (attachment, `text/markdown`, inert headers) with the problem, option, proposal id, version and content hash, the version's saved time, the document checks, every section in order (unknown and not applicable labelled), the references with their sources, and the line "This is a plan. It has not been carried out, and nothing here shows that it works in practice." `POST proposals/{id}/files` saves that export into Files (ADR-0072) linked to the proposal. Richer formats wait for a qualified conversion.
- **Hybrid humility gate (pilot F9).** `humilityGate` takes the subject kind. A hybrid option, or a spec written from one, is judged on the hybrid comparison: disposition `build` or `hybrid`, and `comparisons.hybrid.viable`. Software-only viability is no longer required for a hybrid (it stays recorded and shown). Plain software subjects are unchanged. The admission path, the gate route, the selection report and the form preview all pass the kind. Jordan confirmed this reading ("Judge the hybrid row") on a decision card on November 6, 2026.

- **Review fixes (independent review at d99a7ff, Lows L-1–L-7, nits N-1/N-2).** Drafts cite claims and never copy their statements into section text, so a later claim redaction reaches every saved version through the References; redaction does not reach text a person typed into a section or a review comment, which stay as written (L-1). The export no longer carries an export time or the reviews: its bytes depend only on the version (its saved time, title, body, content hash) and the current checks of the records it cites, so saving the same version to Files twice keeps one copy (L-2). A `ready` verdict is refused while the version's checks are not ready for review, and a review by the person who saved the reviewed version is shown as a self-review (L-3). Titles and revision reasons are one line without control characters; record titles, the summary, statements and quotes are flattened to one line in the export, and headings, setext underlines and line-leading HTML in section text are escaped, so the text cannot forge a section, the References or the provenance lines (L-4). Evidence for cited claims is read in the same transaction as the other checks, and a failure fails the request instead of silently dropping a reference's evidence status (L-5). A spec is judged as hybrid by the option version it cites, not the option's current body, with an admission test for a spec written from a hybrid (L-6). One proposal cites at most 60 distinct claims, matching the reference list, so no citation prints as "[?]" (L-7). `proposal_reviews` is append-only (trigger) and its proposal must belong to the same workspace (N-1); the list filter ignores the id's letter case (N-2). Re-review (fc57f4e): escaping line starts was not enough (an unclosed code fence swallowed the rest of the file, and headings nested in lists or quotes still rendered), so each section's typed text is now kept exactly as written inside a fenced text block whose fence is longer than any backtick run in it, and every record or one-line field (title, summary, problem and option titles, statements, source titles, URLs, quotes, check messages) is flattened and has its Markdown characters escaped; a test parses the export with the Files viewer's own parser and requires exactly the expected headings and the References for each attack (L-A). The trade-off is that Markdown typed in a section shows as written rather than rendered. The spec-from-hybrid test now follows the build commitment through to an `allow` admission (N-B), and the review form drops a "ready" choice when the checks stop allowing it (N-C). Migration 49 was amended in place before merge (N-A): main, the dev studio (schema 48) and the installed app never ran any version of it, so only a throwaway database that ran an earlier text is refused by the checksum rule, by design; recreate such a database rather than weakening the rule. Final review (5a392ca): source addresses are written as `<url>` autolinks (spaces, angle brackets, backslashes and control characters percent-encoded) so they open exactly that address, and a non-http(s) address is escaped text that cannot auto-link (L-B); section text is exported as a `proposal-text` fenced block (a plain code block in other viewers), and only that block is styled in the app's Markdown viewer (Files) with the body font, wrapping (long words and addresses break) and no height cap, measured in Chromium with the app's stylesheet; `text` and other code blocks in chat, notes and Files keep monospace, no wrapping and the usual scroll box; the section editor says Markdown shows as typed in the saved file, and other Markdown viewers show these blocks as unwrapped code (L-C, review 4 L-E). A reference says the version it cites and, when the claim has moved on, the version its statement comes from (N-D); blocker and warning counts are taken before the list is cut to 200, blockers are kept first, and the export says how many more are not listed (N-E, review 4 N-F/N-G). Review 4 L-D: every escaped text field also breaks "://", so a web address inside a statement, quote, title or summary shows as text instead of a link the escapes would send to the wrong page, and a source without a title shows only its address link.

Rejected: a model-written explanation or proposal draft (needs a role, a qualification and live calls; the records already hold the facts, and unknown sections are more honest than generated ones), letting a proposal skip the selection (it would not be tied to a decision), and typed reference lists (citation fidelity needs references built from claims).

Not done: a model-assisted drafting role, richer export formats, and proposals for options that were not advanced. Real-world execution and efficacy of any proposal remain unverified.

## ADR-0076 — Python package paths are admitted, the builder is told the patch rules, and a refused patch is repair feedback (November 6, 2026)

Follow-up to the P14 live runs ([results](evidence/p14-benchmarks/RESULTS_2026-11-06.json), PR #145). All three `p14-larger-ledgercheck-v2` attempts stopped at a checkpoint after one builder request: each patch included `src/ledger/__init__.py`, the executor's path dialect (`pathSchema`) refused any segment starting with `_`, `builder/1` never states that rule, and the studio ended the build instead of telling the builder why. The benchmark's own reference solution has the same file, so no correct ordinary Python package could pass.

- **Path dialect.** A path segment may now start with underscores before its first letter or digit (`PATH_SEGMENT` in `packages/executor/src/contracts.ts`), so `__init__.py`, `__main__.py` and `_private.py` are admitted everywhere `pathSchema` applies: task scopes, scoped patches, worktree walks and package archives. Still refused: a leading dot (`.git`, hidden files) or dash (option-like names), segments with no letter or digit (`_`, `__`), uppercase, empty and `.`/`..` segments, Windows device names, and `__pycache__` (generated bytecode stays out of every candidate). The refusal now says what the rule is.
- **Rules as packet data.** Each builder packet carries `patch_rules` (the path, scope, hash and size rules) and `qa_runtime` (the exact QA command `/usr/bin/python3 -I src/main.py <args>` from the product root, and that `-I` leaves the script directory off `sys.path`). They are data in the packet, not part of the role prompt, so `builder/1` and its qualifications stand.
- **Refused patch → repair feedback.** When a builder answer's `submission` fails the patch contract, names a stale `expected_commit`, or the scoped tool refuses it before writing anything (`PatchRefusedError`: duplicate path, outside the task scope, stale `before_hash`, over 512 KiB, a path that is a directory or lies beneath an existing file or beneath another path in the same patch, or a patch that changes nothing), nothing is applied and no patch intent is written. Each scoped-tool refusal names the offending path (or the byte total). The studio records `refused-N.json` in the build folder and starts the next round with `feedback = {refused_patch: {reason, details}}`, plus `previous_review` (the latest `{review, checks}`) when an earlier round's candidate was reviewed, so a last round still knows why that candidate was rejected; `patch_rules` already travel in every packet. The reviewer and QA do not run on a refused round. The round counts against `max_repairs` (at most 2). On the broker and `plan_roles` routes its builder request also counts against `max_calls`; on the Codex plan route builder calls never count against `max_calls` (only the reviewer's broker request does, as before this ADR), so rounds there are bounded by `max_repairs` alone. `codex-N-outcome.json` records the raw Codex answer before validation, whether it was admitted or refused. When the last round is refused, the checkpoint reason names that refusal; an admitted patch clears it. A malformed answer outside `submission`, a blocker, a failed write after the patch intent, and every authority, deadline and binding check still stop the build as before.

Rejected: changing the builder role prompt (a new prompt version needs both build-role requalifications, and the rule then lives in two places); allowing any leading underscore (`_` and `__` alone add nothing); and silently dropping a refused file from the patch (the builder must see what was refused).

Benchmark: the v2 larger result stays final at 0 of 3. A new set `config/repo-benchmarks/v3/` freezes `p14-larger-ledgercheck-v3` with its own grader copy and `FREEZE.json`; its task, studio cases, extended cases and reference are the v2 ones (tests check this), so v3 measures only the studio change.

## ADR-0075 — Tester accounts, synthetic sample workspaces and a per-person upload cap (November 6, 2026)

P11 preparation (revision R14, gaps G1 and G2 of [the committee staging design](../docs/COMMITTEE_STAGING_DESIGN_2026-11-05.md)) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md), plus the PR #141 review follow-up on concurrent uploads. Nothing is deployed, no provider, domain, sign-in provider, cap or retention is chosen (D1–D9 stay open), and no account is created anywhere outside a database the operator points the command at.

- **Accounts.** Migration 48 (`tester_accounts`) adds `tester_accounts`: one row per allow-listed OIDC identity (issuer without a trailing slash, subject), mapped to its own new person actor, with a workspace role (`editor` or `viewer`), a required expiry and an optional disabled time and reason. The owner's subject (`CREATOR_OIDC_OWNER_SUBJECT`) cannot be added, and one identity has at most one account. There is no hard-coded maximum expiry.
- **Sign-in.** The OIDC callback admits the owner subject as the owner actor (unchanged), an allow-listed identity whose account is neither disabled nor expired as that tester's actor, and refuses everyone else ("not the workspace owner or an invited tester"). Development login is unchanged and only ever signs in the owner. A session lookup also checks the tester account, so expiry or removal ends existing sessions at once; removal also revokes them. The session says `account: "tester"` and the header shows "tester account".
- **Isolation.** Every workspace route already checks membership, so a tester sees only workspaces they are a member of; another tester's or the owner's workspace is not found. Testers get no deployment-wide or owner powers, enforced twice. The API refuses a tester session (403) on Settings (spending ceiling and limits), plan connections (they use the owner's own ChatGPT and Claude sign-ins), payments, campaigns, GitHub, portfolio scheduling, operations status and verification, and desktop pairing and jobs. The stores refuse testers for new workspaces, membership changes and every `requireOwner` policy action, and the spending-ceiling audience excludes them, so even a tester who somehow owned a workspace could not read or change the ceiling or create a plan connection.
- **Sample workspaces.** `pnpm ops tester-add` creates the account and seeds a synthetic fixture workspace, "Sample review workspace (synthetic)": a source, claim, problem, two ideas and two products with their links, all labelled synthetic, no research or model call. The operations actor owns it; the tester is added with their role last, so a failed seed is never visible to anyone. `tester_workspaces` lists each tester's workspaces; exactly one is current (a unique index, and concurrent resets serialise on the account row).
- **Reset and removal.** `pnpm ops tester-reset` takes the tester out of their current workspace, marks it retired and seeds a fresh one. `pnpm ops tester-remove --reason` disables the account, revokes its sessions and retires its workspace. Neither deletes records: retired workspaces and their audit history stay until Jordan's retention decision (D8). `pnpm ops tester-list` shows each account's state (active, expired, disabled), current workspace and retired count. Each change is audited (`tester.added`, `tester.removed`, `member.added`, `member.removed`); the provider subject stays out of the audit payload.
- **Owner visibility.** The owner is not a member of tester workspaces, so they do not appear in the owner's studio. Jordan can see accounts with `tester-list`; viewing a tester's work in the app needs a later, deliberate membership step.
- **Upload cap.** Each person may have at most `CREATOR_FILE_CONCURRENT_UPLOADS` uploads in flight at once (default 2; any positive whole number). The check runs after authentication and the role check and before the upload deadline is extended, so a refused upload (429 `LIMIT_EXCEEDED`) keeps the ordinary 10-second body deadline and its connection then closes. A slot is freed when the request ends in any way: stored, refused, cancelled or cut off. The count is per API process, which is how the desktop app and the hosted Compose stack run today; several API replicas would each count separately.

- **Review fixes (PR #143 review).** `addMember` refuses a tester as `owner` of any workspace (L-1). The upload slot is freed when the response closes, so it is held while a fully received upload is still inspected and stored; Node closes the request as soon as its body is read (L-2). Registering an artifact checks the owner role before the server reads or hashes anything in the local product store (N-1). A tester's session expiry is capped at the account's expiry (N-2). `pnpm ops tester-extend <actor> --expires <time> [--restore]` moves an expiry and, with `--restore`, re-enables a removed account with a fresh sample workspace, since one identity keeps one account (N-3). If seeding fails after `tester-add` committed the account, the error names the actor and says to run `tester-reset`; `tester-extend` also seeds an account that has no current workspace (N-4).

Rejected: reusing the owner actor for testers (their actions would be the owner's), letting testers own their sample workspace (owner policy actions, budgets and model spend need G5 caps first), and deleting a workspace on reset (audit history is append-only and retention is undecided).

Not done here, still needed before a committee release: the single committee profile that turns off sign-up, payments, campaigns, GitHub mutations, terminals and builds with a visible label (G6; testers are already refused on those routes, but the pages still show their own error text), per-tester request and money quotas (G5), a tester model route (G4, D6), the local Compose rehearsal with a stand-in OIDC issuer, and the tester guide.

## ADR-0074 — Automatic assessments: system ratings beside people's, versioned and marked stale (November 6, 2026)

P08 from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). Reuses the T08 scorecards, the anchored rubrics (`opportunity-rubric/1.0`, `suitability-rubric/1.0`) and the exact selection report; reuses the T05 workflow path the way ADR-0065 does for Explore for me.

- **Run.** "Assess automatically" on Compare starts a workflow of the new role `r08_assessment` (migration 47 widens the role and task-kind checks) with one `assess` task of task class `scoring`. The owner starts it under a run, a `model.generate` grant and the usual limits, like an exploration; a viewer cannot. The packet (`assessment-packet/1`, untrusted evidence, no authority) holds the problem version, up to 8 active options with their rubrics (build and hybrid take both; others take suitability only), up to 30 claims linked to the problem with their verified passages, status, independent and contrary origins, and the rubric anchors. Nothing is fetched. The person can see the packet before starting and after; the start is refused if the problem, an option or the evidence changed since the preview.
- **Admission.** Fixture connections answer with plain rules, labelled "System assessment (fixture rules)". A plan route (ChatGPT or Claude subscription) is admitted only after a scoring qualification whose every case is an `assessment_contract` check carrying the assessor's current prompt; the discovery skeptic's scoring qualification does not admit assessments, nor the reverse. The bundled benchmark `assessment-synthetic-v1` (2 development, 6 held-out cases; generated by `scripts/assessment-benchmark.mjs`; replaced by `assessment-synthetic-v2`, 9 held-out cases, in ADR-0090) is a draft for the owner's review and is graded first by the studio's own output check, then by path assertions.
- **Output check.** The answer must rate exactly one assessment per option and listed rubric, every criterion key, refs only from the packet, at least one cited claim behind every non-null rating, and software influence only on suitability. One repair, then the task fails and no card is written.
- **Recording.** Code writes one scorecard per option and rubric with reviewer kind `model` (or `fixture`), the label, and an `assessment` block: workflow, task, output hash, packet hash, role version, prompt hash, rubric hash, route, provider and model, the problem version, each cited claim's version and support hash, and the assessor's uncertainty. Ratings are 1–5 or unknown; totals and ranks are computed by code from the anchors, unknown stays a range and never an average. Software influence on suitability is recorded but not counted, so it cannot push out a better non-software response. A re-run archives the earlier active system cards of the same option and rubric (kept in history).
- **People and system together.** Compare shows each option's system and personal ratings separately. A person who edits a system rating writes their own card with `edit_of` and a required reason; the original is kept unchanged, marked "replaced by a person's edit", and no longer counts. People cannot write a card that claims to be a system assessment, cannot revise a system card, and cannot edit one that a newer assessment replaced. Disagreements, ties and rank sensitivity are computed over the counted cards as before.
- **Gates.** A system card can raise an ethics or access concern but cannot clear one: if only system cards exist, the gate is not assessed and the report says a person must confirm it. Selection itself stays a person's decision; nothing selects automatically.
- **Stale.** A card no longer counts, and says why, when the option version changed or cited evidence changed (version, status, or which claim support rows are active). A system card is also stale when the problem version, the rubric hash, or any packet claim changed. Stale cards are shown but not counted.
- **Routes.** `GET /api/workspaces/{ws}/problems/{id}/assessment-preview`, `POST /runs/{id}/assessments`, `GET /workflows/{id}/assessment-packet`.

**PR #144 review amendments (November 6, 2026).**

- **Linked evidence (M-1).** Each system card also records `linked_hash`, a hash of every claim linked to the problem when the packet was built (including any beyond the packet's 30). A claim linked or unlinked since then marks the card stale ("Evidence linked to the problem changed…"). The start re-checks the set under the same lock.
- **Explanation on Compare (M-2).** Each system card opens "Why these ratings": each criterion's rating, rationale and cited claims; confidence; software influence (not counted); the gate notes (a person confirms); uncertainty; and model, route, time, problem version, role version, prompt hash, rubric version and workflow.
- **Editing a newer assessment (M-3).** Edit opens the form on that exact system card. A person's card that replaces an archived assessment, or none (scored by hand before), moves on to replace the newer one through its revision (`edit_of` re-pointed, checked like a new edit). A card that still replaces a current assessment cannot drop or move its `edit_of`.
- **Evidence at write time (L-1).** A person's new or revised rating must cite the current, active version of each claim or source (otherwise VERSION_CONFLICT), so it is never stale on arrival. Upgrade note: people's cards written before schema 47 that cite since-revised or archived evidence now show as stale and stop counting until revised; this applies the existing T08 rule ("changed evidence invalidates") that was not enforced before.
- **Late finishers (L-2).** An assessment does not archive or add to an option and rubric that already has an active system card from a newer problem version, or from a workflow started later; it notes this instead.
- **Which claims count as linked.** A claim that supports or contradicts the problem, or one the problem is `derived_from` (how a drafted problem records its claims; read as support). The packet, `linked_hash` and Compare's claim list use the same set (found on the trial run: the CSV-checker problem links its four claims only that way).
- **Packet limits (L-3).** The packet carries only claims linked to the problem; claims linked only to an option do not reach the assessor (known limit, kept so the qualified prompt and benchmark stay unchanged). Claim→problem links can only be `supports` (or problem→claim `derived_from`) today, so contrary evidence reaches the assessor through each claim's contrary origins and status; the `contradicts` relation is kept in the packet contract for when such links exist.
- **Readiness (L-4).** A qualification carries `admits_assessment`; the Compare form uses the newest decided one of those, as the server does. **Labels (L-5, N-2).** An edit names its author; a plan route records the connection kind (`chatgpt` or `claude_code`) as provider. **More than 8 options (N-4).** The first 8 by creation time are assessed and the packet says how many were left out. **Benchmark size.** The qualification start takes up to 256 KiB (the assessment benchmark is about 132 KiB).

- **Several requests per assessment (live trial, November 6).** The first live assessment on the trial copy failed with `output_cap_exceeded`: rating every option of a large problem in one answer took 19,510 characters against the plan route's 16,000. Each request now rates at most four option-and-rubric pairs (`assessmentBatches`); the coordinator runs one `assess` task per batch, each with its own repairs, and writes scorecards only when every batch has succeeded, from each batch's checked answer against that batch's part of the packet. A failed batch fails the workflow with nothing written, through the shared stop (review L-7): other batches' queued tasks are cancelled and leased ones are awaited before the workflow ends. Each request gets all the packet's claims, the rubrics its options need and the original option refs, so the qualified prompt and benchmark are unchanged. The preview says how many requests it will take, the Compare form sizes its limits from that, and a start whose limits allow fewer tasks or calls is refused. Rejected: raising the 16,000-character cap (it bounds every plan answer, and a larger problem would hit it again).
- **Older citations on a revision (L-6).** The edit form no longer says citations of claims not linked now are kept: it says saving needs the current version of every cited claim, and offers "Cite the current versions" (for claims still linked) or "remove them".
  Jordan reviewed and approved the eight benchmark cases on November 6, 2026; plan-route assessment stays blocked until a scoring qualification on it passes. N-3 (a replayed start after the state changed is refused rather than returning the first workflow) is unchanged; the page recovers by listing workflows.

## ADR-0073 — Named private notes with Markdown preview and export (November 5, 2026)

P06 (revision R04) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). Extends ADR-0060's single notepad.

- **Notes.** Each person keeps up to 200 named notes per workspace (`personal_notes`, migration 46): a title (1–120 characters, no control characters), Markdown text (at most 100,000 characters), a text `version`, a status (active or archived) and times. Only the author can list, read, save, rename, archive or restore them; another person's note id, or an id from another workspace, is not found. A viewer may keep notes too. Removing a member removes their notes. Nothing about notes is audited, so names and text never enter the activity history; they are never sent to a model.
- **Migration.** Every saved ADR-0060 notepad becomes an active note named "Notes" with the same text, version and time (`from_notepad`); `workspace_notes` is left unchanged as the original. The store accepts that version, so a note's next save continues from it; a tab still running the old page cannot save (it posts the old request shape, which is refused and shown as not saved), and its unsaved text carries over to the note on reload (PR #142 review N-1).
- **Retention of the old notepads (review L-2).** Nothing reads or writes `workspace_notes` any more, but its rows still hold each person's old notepad text (and so do backups), until member removal deletes them. They are kept only as a fallback while the upgrade is checked: a later migration clears them once the installed app's upgrade to schema 46 has been confirmed. Until then, text removed from the "Notes" note can still be in that table.
- **Saving.** Autosave and conflict recovery work as before, per note: the version check is in the update itself, a stale save gets VERSION_CONFLICT and the person picks which text to keep. Renaming and archiving do not change the text version, so an open editor is not refused because the note was renamed. An archived note is read-only (INVALID_TRANSITION) until restored; archiving first waits for a save in flight and then saves any text typed during it, and text kept in the tab while a note was archived comes back when it is restored (review L-1). Creates take a per-person lock so the limit holds under concurrency.
- **Drafts.** The tab's safety copies are keyed by person, workspace and note, cleared on sign-out as before. A copy left by the old notepad moves to the note it became, or starts a "Notes" note when the old notepad was never saved.
- **Viewing and export.** Write/Preview shows the note through the existing safe Markdown renderer (no raw HTML, scripts or images; `<script>` stays text). Export downloads the text as a `.md` file built in the browser; the file name keeps only safe characters. The chosen note is remembered per person and workspace on the device (its id only).
- **Routes.** `GET/POST /api/workspaces/{ws}/notes` (list, create), `GET/POST /notes/{id}` (read, save), `POST /notes/{id}/rename`, `POST /notes/{id}/archive` (`{archived}`); writes need the CSRF header.

Not done: deleting a note (archive keeps it), sharing notes with other members, search over notes, turning a note into a claim or file, and clearing `workspace_notes` (see retention above).

## ADR-0072 — Workspace files: exact originals in PostgreSQL, inert viewers, drop anywhere (November 5, 2026)

P05 (revision R19; owner decisions #11–#16 where they apply to a first release) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md).

- **File object.** A workspace file has a display name, a status (active or deleted) and numbered immutable versions. Each version keeps the exact original bytes, their SHA-256, size, the kind and media type the studio found from the bytes, the type the browser declared (recorded, never trusted), the name exactly as it arrived, a type-mismatch flag, and for text kinds the decoded text (at most 2,000,000 characters, marked when cut) for viewing and search. Migration 45 (`workspace_files`) adds `workspace_files`, `workspace_file_versions` (a trigger refuses any update) and `workspace_file_links`.
- **Storage.** Bytes live in PostgreSQL (`bytea`), so the existing backup (pg_dump) and restore carry them with no second store to reconcile; the backup manifest now counts the three tables and the restore test round-trips a binary file. Bounds come from the deployment: `CREATOR_FILE_MAX_BYTES` (default 25 MiB per file) and `CREATOR_FILE_WORKSPACE_MAX_BYTES` (default 2 GiB per workspace, every version, deleted files included until purged). A request can never raise them. Rejected: files under the studio data home (a second store for backup, restore and access checks to keep in step) and content-addressed sharing across workspaces (deleting one workspace's file must remove its bytes).
- **Upload.** `POST /api/workspaces/{ws}/files` (or `/files/{id}/versions`) takes raw `application/octet-stream` bytes with `X-File-Name` (URI-encoded), `X-Upload-Key`, optional `X-Declared-Type`, `X-Link-Entity` and `X-Keep-Duplicate`, plus the usual CSRF header. The whole body is read before anything is written, so a cancelled transfer stores nothing; a repeated upload key returns the earlier result and a reused key with different bytes is refused, so retries never store twice. Uploads in one workspace take a lock so quota and duplicate checks hold. The same bytes already present as an active file are not stored again unless the person chooses Keep both; a repeated display name gets ` (2)`, ` (3)`…
- **Names and kinds.** Names keep only the last path part, lose control and reserved characters, leading/trailing dots and spaces, and Windows device names, and are at most 200 characters with the extension kept. Kind comes from bytes: PNG, JPEG, GIF and WebP signatures are images, `%PDF-` is PDF, valid UTF-8 without NUL is text (the extension then picks Markdown, JSON if it parses, CSV, code or text), anything else is other. HTML and SVG are code: shown as text, never rendered.
- **Viewing and download.** Text kinds come back as JSON data and render as text nodes (Markdown through the existing safe renderer: no raw HTML, scripts or images; JSON pretty-printed; CSV as a table of the first 200 rows). Only sniffed raster images are served inline, with their exact type. Every byte response has `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` and no caching; downloads are attachments with `application/octet-stream` and the original bytes of the chosen version. PDF and other kinds are download-only and say so.
- **Access.** Any member may list, view and download; owners and editors upload, rename, link, delete and restore; only an owner purges. Membership is checked before any name, count, snippet or byte is read; another workspace's file id is not found. Files are shared within their workspace (unlike private notes). Uploading never sends a file to a model provider and never creates a claim or evidence; provider sharing rules (#14) stay with the existing grants and data classes.
- **Library and search.** Sources › Files lists newest first (also oldest first or by name) with keyset paging, finds a term in names and kept text, and shows the first matching lines with line numbers. Files are not yet in the global Search index.
- **Drop anywhere.** Dragging files over the studio shows an overlay naming the workspace; dropping (or Add files) uploads into that workspace, fixed at the moment of the drop. The browser never navigates to a dropped file, so page drafts stay. A transfer tray on every page shows progress with Cancel, Retry (same upload key), Keep both and Open; finished uploads leave it after 12 seconds; it is cleared on sign-out.
- **Deletion.** Delete hides a file and keeps it restorable; an owner can then delete it permanently, which removes every version's bytes in the same transaction. Backups made earlier still contain them until those backups are removed; the confirmation says so. Audit events (`file.uploaded`, `file.version_added`, `file.renamed`, `file.linked`, `file.unlinked`, `file.deleted`, `file.restored`, `file.purged`) keep ids, hashes, sizes and kinds, never names or contents.

- **Review fixes (PR #141 review).** Names also lose C1 controls and invisible format characters (bidi overrides and isolates, zero-width marks, BOM), so a name cannot disguise its extension; one leading dot is kept for dotfiles (L1, N2). The upload route checks membership and role before it reads any of the body (L2). A duplicate dropped onto a record is still stored once and is linked to that record; a reused upload key must name the same file and record, and a replay of a file deleted since is not reported as added (L3, N3). Node has one request timeout per server, so the API and web servers' limit is now 30 minutes and every request gets its own body deadline: 10 seconds as before for ordinary requests, and for uploads 60 seconds plus one second per 256 KiB declared, capped at 30 minutes (L4). After re-review (R-M1), every request on the API and web ports starts with the 10-second body deadline whatever its path or declared size; only the upload route lengthens it, after the caller is authenticated, may upload to the workspace and declared a Content-Length within the file limit. A response sent while a body is still arriving (any refusal) closes the connection within a second instead of draining the rest. The tray drops other people's transfers when a session starts in the tab (L7). Search returns only a 20,000-character window of kept text from the line of the first match, with its real line number, never the whole kept text (L6). Kept text is not counted in the workspace bound: the bound is for original bytes, and kept text is at most 2,000,000 characters per version (also L6). Kept text is cut without splitting a surrogate pair (N1); links have an index on the record (N5); a drop anywhere is refused before sending once the Files page has reported the limit (N6); `filename*` escapes `' ( ) *` (N7); Keep both is not offered for a new version with the same bytes (N4).

Queued for B01, not built here: 30-day Trash with automatic expiry (#15), OCR (#11), editors (#12), conversions (#13), related-files neighbourhood (#16), PDF preview, linking from record pages and drop targets on specific records, files in the global Search index and evidence promotion.

## ADR-0071 — Guided and Advanced views over one Discover form; visible defaults and presets (November 5, 2026)

P04 (revisions R10–R12) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md).

- **One form, two presentations.** Discover offers _Guided_ (default) and _Advanced_. Guided folds the routine groups (context, data and tools, time and budget constraints, seed, constraints; response types and revision rounds; run, model and permission) under one-line summaries of their current values; Advanced shows them open. Both submit the same request; nothing is computed differently. The choice is kept per person in this browser.
- **Start choices.** The page opens with three task-shaped choices (Explore for me, Start with a theme, Discover from claims) that jump to the existing sections. No section was removed or moved to another page.
- **Visible effective defaults.** A "What will happen" summary before the start button lists the run and oversight, model-call permission, model access, effective limits, data class and expected output, each tagged with its source: studio default, your saved preset, changed here, or connection caps.
- **Presets.** "Save these settings as my defaults here" saves only the routine fields (time and budget constraint text, constraints, data and tools, data class, revision rounds, oversight, standing model-call permission, route) per person and workspace in this browser. Reading a preset keeps only well-formed known values; a fixture workspace never takes a non-synthetic data class from one. A preset cannot add evidence, a claim role, a grant beyond the form's existing 24-hour model-call grant, a qualification or a higher cap.
- **Qualified default route.** With nothing chosen, the default plan connection is the first with no blockers that allows the data class and has a verified model qualified for every discovery task class, instead of simply the first listed. A person's own choice is kept and its blockers shown.
- **One blocked-reasons component** (`Blocked`) names the action, lists each specific reason and offers the tab that fixes it. Discover's setup blockers and Build's missing prerequisites, spec blockers and refused data class use it. Chat keeps stating its refusals in its replies. The Projects pages (Decide, Compare, Scores and specs) still use their own blocker text; moving them to `Blocked` is left for P17 (PR #140 review L-5).
- **Review fixes (PR #140 review).** Picking a model pins its connection, and a picked model counts only while it belongs to the connection in use (L-1). A preset never stores a blank time limit or budget constraint (L-2) or the private data class (N-5): sharing private data is chosen on purpose for each start. A failed start opens the fold holding the first field to fix and moves focus there, and each listed problem is a button that does the same (L-3). "What will happen" adds a Ceilings row: the plan requests used of the connection's daily allowance, or the chosen budget's available amount and, outside fixture workspaces, the overall spending ceiling and what is left of it; fold summaries give the source of every value they cover (L-6).

Rejected: a server-side preset store or configuration framework (a migration for convenience values; the plan prefers ordinary defaults and saved presets). Consequence: presets do not follow a person to another browser or device and are lost when site data is cleared; durable cross-device presets fall to B02. No migration, no API change, no new dependency. Every gate stays on the server.

## ADR-0070 — Chat answers general requests broadly; context is chosen and recorded (November 5, 2026)

P03 (revision R02) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). This refines ADR-0055 (chat rules) and ADR-0057 (plan-backed answers); everything else in them stands: answers are advice only, owner-only, under the chat switch, the daily chat limit, the connection's caps and the open-study pause, and nothing a model writes starts, approves or spends anything.

- **Context choice per message.** The composer offers _Automatic_ (default), _General_, _My projects_ (the existing short studio snapshot) and _Selected records_ (up to 5 active problems, ideas, specs, products or runs of the workspace). The choice is saved on the message; picked records are checked when the message is saved and read again when it is answered.
- **Explicit choice wins.** Any explicit choice (_General_, _My projects_ or _Selected records_) makes the message a question for the model with exactly that context: no studio rule (next, blocked, approvals, sources, save, discovery) applies to it. Only Automatic messages can get studio cards.
- **Automatic sends studio records only when the message names them** ("my ideas", "our runs", "my studio"); a broad request gets no snapshot. The fixed rules also stop swallowing ordinary sentences: a message that opens like a general request (write, explain, brainstorm, how/what…) reaches the approvals and blocked cards only through phrases only the studio uses or when it names studio records, "what's next" must be the whole question, and "why"/"can't" need a studio step or record.
- **The owner's switch still governs.** The existing chat setting (`include_snapshot`, now labelled "Allow studio records in answers") gates every studio record: with it off, Automatic answers generally and says why, and an explicit _My projects_ or _Selected records_ is refused before anything is recorded or sent, never silently changed.
- **Picked records go in a fixed shape:** kind, title, version, date, and only their own short fields (statement, affected group, summary, stage, state, discovery method, uncertainty), escaped and clipped inside `<selected_records>`. Evidence bodies, source text, file paths and product code are never read. Archived records are left out and counted; none left refuses.
- **Recorded and shown.** Each answer keeps the context used, a plain reason and the records sent; "What was sent" shows them. If the context has to be dropped to fit the input cap, the answer records General and says so. The audit event keeps the context and counts, never the words.
- **Instructions v2** (`chat-assistant-v2`): a general assistant that answers broad requests broadly and does not steer toward the studio, with a fixed page map for Creator Agent help, no web access (it points to discovery/Sources when fresh cited facts are needed), and all data blocks treated as data.

**Review amendment (PR #136 review, November 5, 2026).** Short studio questions stay studio questions whatever they open with ("What's blocked?", "Is anything blocked?", "What needs approval?", "Anything waiting?"). Otherwise "stuck", "why" and "can't" count only with a studio record or step; "research/explore how…/the…" and "remember to…" are broad requests; and Automatic no longer treats "the project/workspace/studio" or "this project" as naming the studio. A General answer leaves out earlier answers that were made with studio records (the person's earlier messages still go) and says how many. An explicit studio context that the owner's setting refuses is refused when the message is sent, so nothing unanswerable is saved. The record picker lists titles only (`entities?brief=1`) and reloads each time it is opened. The studio's schema check (`inspectDatabase`) now reports the highest migration up to which every known migration is applied, so a database that skipped one reads as needing migration. Migration 43 is not renumbered.

Migration 43 (`chat_context_scope`; 42 was reserved for the parallel preview work, which now takes 44, so 42 stays unused) adds `scope` and `selected` to `chat_messages` and `context`, `context_reason` and `context_records` to `chat_answers`; existing rows read as Automatic and show their old snapshot note. No new dependency, tool or live call. Fixture-verified only: fake `claude`, disposable databases. Limitations: the open-study pause still covers unfinished attempts only (ADR-0057 nit N-5); the classifier remains fixed regular expressions, so unusual phrasings may still need the person to choose General.

## ADR-0069 — Previews can last until stopped (November 5, 2026)

P07 (R03) from the [November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md). A preview's lifetime is now **Timed** (fixed expiry, 1–60 minutes, still the default) or **Until stopped** (no expiry; never a far-future date). Migration 44 adds (42 was skipped; P03 took 43) `lifetime`, nullable `expires_at`, `last_seen_at`, per-row `idle_grace_seconds`, `ticket_expires_at` and `cleanup`, with a shape check; old rows stay Timed. An Until-stopped preview is live while a viewer is seen within its grace (180 s): the preview page heartbeats every 30 s and on becoming visible, and page loads, runs, link opening and readiness also count. Without a viewer it ends as `expired` (computed on read and in the lease count, like Timed expiry), so closed tabs, crashes, sleep and restarts longer than the grace clean up without trusting browser unload; shorter gaps reconnect. Access tickets are separate from the lifetime: each link expires after 10 minutes, and the owner can issue a new link (authority rechecked, version bumped, audited); opening it replaces the browser session. Stop/Revoke closes admission first, then cancels in-flight runs tracked in the API process and waits up to 15 s, recording cleanup `none`/`cancelled`/`unknown` and an audit event. Run caps, the 2-preview limit, worker limits and spending caps are unchanged. Not changed: previews remain text-only CLI runs on the preview origin; generated web support stays P15. Review fixes (PR #137): an unused, unexpired link keeps an Until-stopped preview live until the link expires, and a starting preview stays counted for at most 300 s (the idle clock starts when ready; a start orphaned by a crash then ends); readiness runs are reaped by Stop too; web and CLI Stop wait 30 s. With more than one workspace owner, a link renewed by another owner still opens and runs as the preview's original actor; the renewal itself is audited under the renewing owner.

## ADR-0068 — Account observations also bind to the login generation (November 4, 2026)

Jordan authorized repairs of F1/F2 from [the follow-up review](../docs/CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md). Settlement now applies a request's eligibility, quota and model-access observations only when the request's admitted login generation is still the connection's generation. A result that ends after Disconnect or a replacement login stays recorded and counted on the request, but no longer marks the newer login's usage as exhausted, its account as eligible or ineligible, or a model as verified or refused. A same-login token refresh keeps the generation, so its observations still apply. Legacy requests with no generation (migrated from schema 40) record their outcome only. This narrows ADR-0067's statement that eligibility and quota keep their earlier behavior. The audit events of verification and availability requests are unchanged. No migration; schema stays 41. New regressions cover the Codex relay and Claude Code paths of the ADR-0067 binding.

## ADR-0067 — Bind plan outcomes to login generation and dispatched credential (November 4, 2026)

Owner authorized follow-up repairs to Claude's independent review (M1/L1). Migration 41 adds private login generations to connections and request snapshots, and credential references to requests. Sign-in, sign-out and recorded Claude status checks advance the generation; settings edits and token refresh do not. This supersedes ADR-0066's whole-connection-version rule for browser sign-in completion. The existing optimistic connection version still guards settings and refresh swaps.

Before dispatch, a request must retain its admitted login generation and bind the actual credential reference after refresh. A replacement login cannot inherit an older admission. A late authentication failure invalidates only the still-signed-in matching generation/reference and increments the connection version; older outcomes remain recorded and counted. Legacy requests migrated without a binding cannot invalidate a login. A successful browser callback removes the credential it actually replaced, including an intervening refresh's reference. No automatic retry, new grant, quota reset or provider route is introduced.

Verification uses disposable PostgreSQL and loopback/fake providers; the installed application and operational database are untouched. Original review/repair receipts remain historical. See [the follow-up report](../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md); independent review of these changed bytes is still the next gate.

## ADR-0066 — Disconnect fences older credentials; current repair/evidence gates (November 4, 2026)

Owner authorized repairs to the November 4 audit. Sign-in completion now compares the connection version captured at start under its existing row lock. Candidate credentials have unique references; a losing callback or refresh removes only its own candidate. Disconnect first records signed-out state and clears the credential reference, then attempts remote revocation. Refresh swaps references only while the original remains signed in; an old failure cannot mark a newer login as requiring reauthorization. Remote revocation observations cannot overwrite a newer connection version. Existing versions suffice; schema remains 40.

Qualification views expose derived current-prompt eligibility, using the admission predicate, while historical states/grades and frozen prompts/manifests stay unchanged. Current development safety tests are in the standard test route; frozen helper/package replay is an explicitly separate historical gate. Patched Node floors and a pre-copy bundle guard prevent creating a new bundle on the old runtime. No new provider route, policy grant, live activation, installer execution or study freeze.

Current status/handoff/runbook/guide now have short authoritative summaries and byte-preserved pre-repair histories with hashes and section indexes. The exact old bytes are protected from formatting and newline normalization. Details and verification: [repair report](../docs/CODEBASE_REPAIRS_2026-11-04.md). Next gate is U02 independent review; this entry records implementation, not independent acceptance.

## ADR-0065 — Explore for me: discovery without a theme (accepted November 3, 2026)

Context: C53 (runbook §2.18 at d5337e3, owner Oct 20) asked for problem discovery that starts without a theme: evidenced briefs or an honest empty result, with exclusions and website rules, duplicate detection, insufficient-evidence handling, cancellation and retry dedup. Every discovery path so far needed a search brief or a theme intent first. Jordan asked for it on November 3 as part of finishing the app before the final UX pass, usable in the app and $0 by default.

Decision:

- A new T05 workflow role `r01_exploration` with one task kind `explore` (migration 40 `exploration_workflows` widens the role and kind checks). It runs on the run entity as its subject, through the same worker, leases, caps, pause, cancel and reconcile paths as discovery.
- The model sees only what the studio has already recorded: the workspace's active claims, newest first, and a catalog of its active problems, ideas, alternatives and search briefs, as untrusted data in one packet (`exploration-packet/1`, hashed into the task context `exploration-context/1`). It does no web search of its own. The packet must fit one model message (19,000 characters), so claims are added newest first while they fit: at most `max_claims` (default 30), each with its two strongest passages, and the catalog takes at most 4,000 characters of it. Up to 200 claims are scanned, in batches, and reading stops once the packet is full. Passages older than `max_age_days` (default 180) count as stale; they are still read. What was not read is listed and counted (`not_searched`: beyond the limit, left out by the owner, excluded by topic, excluded by website, without passages, catalog entries not shown).
- Before starting, Discover shows exactly what would be sent (`POST exploration-preview`, no side effects): the claims with their status and websites, the catalog titles and the packet size. The owner can leave out any claim (`scope.leave_out`; the ids stay in the workflow context and only a count reaches the model). The start carries the preview's `preview_hash` (the packet without its read time) and is refused if what it would send changed since, so nothing unpreviewed is sent. After a run "Show what was sent to the model" reads the bound packet.
- Optional narrowing: interests, target groups, topics to exclude, only these websites, never these websites, and 1–5 candidates. Website rules are conservative so a claim's status stays exact: a claim citing any excluded host is dropped, and with an only-these list every one of its evidence rows must match; `*.example.org` means subdomains only.
- The R01 explorer returns up to `max_candidates` cards (who is affected, the observable pain, why it was chosen, current alternatives, an outcome measure, the next question, uncertainty, claim refs, contrary refs) plus directions it saw but could not support. Application code, not the model, decides each card: `candidate`, `duplicate` (title or body overlap with an existing record or an earlier card; checked against up to 200 recent records, including those the packet had no room to show the explorer), `insufficient_evidence` (no cited claim has current supporting evidence: supported or contested) or `excluded` (matches an excluded topic). One repair is allowed for a malformed answer, as in discovery. With no candidates the workflow ends `insufficient_evidence` and says so.
- Task class `research_synthesis`, so on a plan connection it needs the same qualification as the discovery locator (Jordan's choice on the decision card, Nov 3: reuse the locator qualification rather than freeze a new benchmark). Plan requests count against the connection's caps and cost $0; an API route reserves as usual.
- A pick becomes a search brief only when the owner clicks "Use as a brief" (`POST workflows/{id}/explored-briefs`): it needs a succeeded exploration and a `candidate` card, is idempotent per card (audit `exploration.brief_created`), and fills the Discover form: supporting claims bearing on the problem, claims cited against it labelled and left for the owner. Submitting the form unchanged reuses that brief; edited, it creates a new one and archives the pick's brief. A pick's brief that no workflow has used is left out of later explorations' catalogs, so an abandoned pick never marks the same problem a duplicate. Nothing runs on from an exploration by itself. If a start is refused after its run and permission were made, the app revokes the permission and cancels the run.
- App: Discover › "Explore for me" (start, narrowing, model access, blockers including the qualification, what will be sent, live progress with Stop, the shortlist with each cited claim's text linked to Sources, directions and what was not read). Chat sends "explore for me", "surprise me", "what should I build" and similar whole messages to it; "explore for me <topic>" offers the topic as a theme, and messages such as "show me problems with the build" are not captured.

Consequences: the explorer is not separately benchmarked; it rides on the locator's qualification, which tests a related but not identical task. Its candidates are only as good as the claims already in the workspace, so a new studio gets an honest empty result until sources are added. Autonomous selection, scheduled exploration and the explorer searching the web itself are not built. Not run live on a plan connection or on the installed app yet.

## ADR-0064 — Close a stuck plan request in the app (accepted November 3, 2026)

Context: a plan request stays `in_flight` if the studio stops while it runs, and `unknown` when the studio could not tell how it ended. Either one blocks every new request on that connection (`max_in_flight` is 1; an unknown outcome must be reconciled first), chat answers included. Closing one (`reconcilePlanRequest`, outcome `ran` or `did_not_run`) was only reachable through `pnpm cli plan-reconcile`, and the store allowed it for an `in_flight` request at any age, even one a running studio was still waiting on (PR #126 re-review N-2). Jordan approved bringing it into the app (Nov 3).

Decision:

- Models and connections shows a connection's open requests (`in_flight` or `unknown`, oldest first) near the top, under "Requests without a recorded outcome": what it was for, the model, when it started and its state in plain words. The owner closes one with "It ran, or I cannot tell" (default) or "It did not run (I checked…)", plus a required note, through the existing `POST plan-connections/{id}/reconcile` route. "Did not run" is disabled when part of an answer was observed (the store already refuses it).
- The page says plainly that closing only records what the owner knows: the request still counts toward the connection's requests a day, and whatever it used on the plan stays used. The choice is kept as the request's reason code (`owner_ran` / `owner_did_not_run`); it changes no counts.
- An `unknown` request can be closed at once. An `in_flight` one only when (a) this studio process is not waiting on it (the store keeps, in memory, the requests it admitted and has not settled; empty after a restart) and (b) it is past the running-now panel's stale point: its path's current timeout plus 15 minutes, never under 45 minutes. The rule is one SQL fragment (`PLAN_REQUEST_STALE_AFTER` in `packages/db/src/sidebar-store.ts`) shared by the panel and the store, so "no answer recorded; check Models and connections" and "can be closed" appear together. The store enforces this for every caller, the CLI included; before that point the page says when it can be closed. Requests run by the separate worker process are covered by the time rule only.
- `PlanConnectionDetail` gains `open_requests` (`request`, `closable`, `waiting`, `closable_after`).
- A chat answer refused because of an open request says to reconcile it in Models and connections and shows an "Open Models and connections" button.

Consequences: no migration. A request a live studio is waiting on can no longer be closed from the CLI either; if a running studio never settles one (a hung adapter), restarting the studio makes it closable once past the stale point. The page says so once such a request is past its time limit (PR #128 review L-1), and the Codex relay settles a request when Codex disconnects mid-response instead of waiting forever. A close of a waiting request is refused before any lock is taken, so it no longer takes locks in the reverse order of that request's settle (review L-2). That early check runs before the owner check, so anyone who knows a live request's id learns it is still waited on; ids are random and members can already list requests (re-review N-4). When Codex disconnects mid-response, the relay also stops the upstream model call, so it does not keep generating against the plan (re-review L-3). Refusals caused by an open request end with the shared `PLAN_RECONCILE_HINT` text, which the chat button keys on. One studio process per database is assumed, as in ADR-0063.

## ADR-0063 — Delete a chat conversation (accepted November 3, 2026)

Context: Chat is the studio's front page (ADR-0055), and conversations could be renamed but never removed. The full audit of November 2 (improvement 4) asked for delete, together with PR #98 Lows L-1 (a Chat hand-off refilled its form after "Reset fields" and in another workspace) and L-2 (a failed first send left empty conversations). ADR-0055 and ADR-0057 made messages and answers rows that never change and are never deleted.

Decision:

- A conversation can be deleted with everything in it: its messages and its model answers. Migration 39 (`chat_conversation_delete`; 38 belongs to PR #123) makes the foreign keys from `chat_messages` and `chat_answers` cascade, and replaces the triggers so a message or answer row may be deleted only when its conversation no longer exists. Messages still never change, answers still settle only once, and neither can be deleted on its own.
- `POST /api/workspaces/{ws}/chats/{id}/delete` (POST with CSRF, like the other chat actions). Owners delete any conversation; editors only those they started in which every message is theirs and there are no model answers (answers are always the owner's), so an editor never deletes someone else's words (PR #124 review L-2); viewers none. Another workspace's id is not found.
- Refused (`INVALID_TRANSITION`) while an answer in it is pending and younger than its connection's request timeout plus 15 minutes (the stale point ADR-0062 set; it was a fixed 15 minutes before PR #123 removed the 5-minute timeout maximum), so a reply can never land in a deleted conversation. Older pending answers are already treated as stopped (ADR-0057, ADR-0062) and do not block. An answer the running studio has begun and not yet finished blocks whatever its age, because the window reads the connection's current timeout and the owner may have lowered it mid-request (PR #124 timeout review L-1). The studio keeps these in memory: a reply can only come back to the process that sent the request, and after a restart nothing is waiting, so a request a stopped studio left in flight does not block the delete forever (PR #126 review L-1); the timeout rule alone applies. The close-as-failed sweep skips the same answers, so a second ask while one is still on its way gets that answer back. This assumes one studio process per database, which is how the studio runs today. If an answer's conversation is gone anyway when the reply comes back, the person sees that it was deleted and that the plan request is still counted.
- Plan requests are kept. They hold no words, so chat usage and the daily chat limit are unchanged by a delete.
- The audit event `chat.deleted` keeps the conversation id and the message and answer counts, never the title or words. Earlier `chat.*` events stay as they were: ids, intents and SHA-256 hashes of each message and title. A hash is not the words, but a short text could be guessed from it (PR #124 review N-3).
- The UI asks first, in place: "Delete "<title>" and its N messages? Model answers in it go too. This cannot be undone." with "Delete conversation" and "Keep it".
- Hard delete, not hide: the conversations hold the person's own private words, and keeping them after "delete" would not be honest. The provenance that matters for spending (plan requests, audit counts) stays.

Consequences: a deleted conversation cannot be recovered, and "What was sent" for its model answers goes with it; the plan request rows remain as the record that something was sent. Anyone with database access can still delete rows only through the conversation.

## ADR-0062 — Owner-set caps and limits have no upper limit (accepted November 3, 2026)

Context: Jordan asked (Nov 3) that the caps and limits the owner sets have no maximum. The Models form stopped at fixed numbers (for example 20 Codex builds and 300 model requests a day, 50 requests per run), the chat "Answers a day" stopped at 100, and GitHub connection limits at 50 repositories, 500 changes an hour and 50 open pull requests. An owner with a bigger plan, or paying for API use and fine with the amount, should be able to set them higher.

Decision:

- Plan connection caps (`PlanCapsSchema`, ADR-0056 form): requests a day, requests per run, input and output characters per request, Codex builds a day, Codex turns per build and model requests per Codex build keep only their minimums (1, or 500 characters, or 0 builds) and must be whole numbers. The request timeout and Codex build timeout keep one technical bound, the longest a JavaScript timer can wait (2^31 − 1 ms, about 24.8 days; a longer delay would fire at once), rounded down to the units the form shows: 2,147,483 seconds and 35,791 minutes. `max_in_flight` stays fixed at 1.
- Chat answers a day (ADR-0057): at least 1, no maximum. Migration 38 replaces the `chat_settings` check `between 1 and 100` with `>= 1`; the integer column still holds at most 2,147,483,647.
- GitHub connection limits: at least 1, no maximum.
- Unchanged: only the workspace owner changes caps; every caps change still clears the caps acceptance and needs a fresh owner acceptance before live use; the spending ceiling and spend limits (ADR-0043, ADR-0044) already had no practical maximum (15 whole-dollar digits) and the per-run and per-model limits still cannot exceed the ceiling in force. `config/spending.json` values are not touched.
- The running-now panel's stale point for an in-flight plan request (it was a fixed 45 minutes, above the old 30-minute build timeout) now follows the connection: its build timeout for a Codex build, else its request timeout, plus 15 minutes, and never under 45 minutes.
- Likewise a pending chat answer is treated as abandoned by a stopped studio (closed as failed so the message can be asked again) only after its connection's request timeout plus 15 minutes, not a fixed 15 minutes, so a live request is never asked a second time (PR #124 review L-1).

Follow-ups from the PR #123 review: the Codex jail bridge (`codex_bridge.py`) accepted at most 1,800 s per build and now accepts up to the timer bound (35,791 minutes plus the host's 5 s), and plan-backed discovery workflows take the connection's request timeout as their per-call timeout with no 600 s ceiling, a wall time that grows to hold every allowed call at that timeout (`WORKFLOW_WALL_MAX_SECONDS`), and the connection's output cap with no 100,000-character ceiling. API (metered) and local workflow calls keep the broker's 600 s per-call bound and a one-day wall time, and the skeptic workflow (always metered) is held to the same. Client waits (the CLI's Codex build request, chat answers, qualification runs) follow the connection's timeouts through `planWaitMs` instead of fixed waits sized for the old maxima. The CLI talks to the API over node:http so that no 300 s client limit cuts those waits short, and a Codex build started from the Build form gets a deadline of (repairs + 1) build timeouts plus 30 minutes, within the build approval's 24 hours. The usage summary reads the per-run cap as `bigint`.

Kept as technical or safety bounds, not owner caps: request body sizes (64 KiB, 1 MiB build calls), the plan-role build packet ceiling (`PLAN_ROLE_CONTEXT_MAX`, 200,000 characters, so an input cap above that does not enlarge a build packet), the per-role build call timeout (120 s), the one-approval-per-build limits (at most 2 repair rounds, 6 requests; ADR-0054), standing approval expiry (90 days), the evidence-site list length (100 hosts; "any public site" covers more), the fixture marketing delivery cap (100), list lengths and the study protocol's time caps. Run-level workflow ceilings set by the studio, not the owner, also stay: at most 60 calls, 8 children, 4 in parallel, 3 attempts, 2 repairs and 8,000 output tokens per workflow; the broker's 600 s per-call timeout and 3 attempts for metered calls (`budget.ts`); 32 in flight per budget envelope; and 20 runs per artifact (`artifacts.ts`). A plan-backed workflow's calls are also bounded by the connection's own caps (requests per run, timeout, output), which are checked when it starts.

Consequences: an owner can set caps as high as they like; the provider's own plan allowance or the API bill is then the real limit, and the spending ceiling still bounds paid spend. A typo such as an extra zero is no longer stopped by a maximum; the form shows the change in words before saving and the owner must accept the new caps before they apply.

## ADR-0061 — Open public links from the desktop app in the system browser (accepted November 2, 2026)

Context: after PR #106, links in chat answers in the installed app showed their address and a Copy button but could not be opened, because the studio window refuses every new window except private previews. Jordan asked (Nov 2) for links to open in the browser from within the app.

Decision:

- The studio window's new-window handler (`apps/desktop/src-tauri/src/main.rs`) still never opens a window itself. It hands a link to Windows' default handler (`rundll32 url.dll,FileProtocolHandler <url>`, one argument, no shell parsing, the same route as private previews and browser sign-in) only when `external::external_link` accepts it, and at most one per second (measured on a monotonic clock). The title bar says whether a click opened the link, was refused, or came too soon after the last one.
- `external_link` (`apps/desktop/src-tauri/src/external.rs`) accepts only:
  - `https` URLs of at most 2,048 characters, with no user name, password or explicit port, whose host is a public-looking name. That means at least two labels of letters, digits and hyphens, a last label that is not all digits, and no `localhost`, `local`, `localdomain`, `lan`, `home`, `corp`, `internal`, `intranet` or `home.arpa` ending. Names under well-known DNS services built to point back at a local or private address (`nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`) are refused too.
  - plain `mailto:` links to one address, with no query (no prefilled subject or body), no fragment and no percent escapes.
- Everything else is refused, including `http`, `file`, custom schemes, IP literals in any form, local names, credentials, ports, `javascript:` and `data:`.
- The web side mirrors the rule in `desktopOpens` (`apps/web/src/markdown.ts`), but only to choose what to show. In the desktop app an accepted link in a chat answer is clickable and also shows its address and a Copy button. Any other link stays copy-only text. The Rust check decides; the web mirror can't widen it.
- The app's other external links (Claude and ChatGPT usage pages in Models and connections, a checkout link) now open in the browser the same way when they pass the rule.
- No Tauri opener or shell plugin was added. A plugin would mean a new dependency and a native IPC capability for the studio window, which today has none (`tauri.conf.json` grants IPC only to the bundled control window). The existing new-window hook already sees every `target=_blank` click and `window.open` call.
- No migration and no server change.

Consequences: links in model answers open in Jordan's default browser or mail app. Anything that can open a new window in the studio UI can now send a public https page to the browser at most once a second. The studio UI is the app's own code, and model text only ever becomes an anchor after `safeHref`. Local addresses written as IP literals or local names are refused, and files and custom schemes can't be reached. A public name that resolves to this computer or the local network (DNS rebinding, a company's own DNS, a loopback service not on the list) is not detected; what limits it is https on port 443 only, the shown address, the owner's click, and the browser's own private-network protections. The rule lives in two places that must stay in step; both test suites read one case file, `apps/desktop/src-tauri/src/external-link-cases.json` (CI runs only the web one).

## ADR-0060 — Right-hand sidebar: activity and a private notepad per person per workspace (accepted November 2, 2026)

Context: Jordan asked (Nov 2) for a sidebar on the right of the app, which leaves about 400 px empty on a fullscreen window, to show current activity and a notepad for jotting things down while working. Design doc https://claude.ai/artifact/7HG4pShk39BoexPw1e6SNX; Jordan chose "One notepad per workspace" on the decision card (recommended). "One notepad for everything" and "This browser only" (no backup, not shared between the desktop app and a browser) were not chosen.

Decision:

- Layout (`apps/web/src/aside.tsx`, `aside.css`): from 1500 px wide the sidebar is a third grid column (320 px) beside the page, open by default; folding it leaves a 44 px rail, and the open/folded choice is remembered in this browser. From 1100 to 1499 px it is a rail and the panel slides over the page (Esc or a click outside closes it). Below 1100 px there is no rail; a top-bar button opens it as a drawer. Ctrl+. (Cmd+.) opens or folds it. Only inside a workspace.
- Activity tab: "Running now" from a new read route `GET /api/workspaces/{ws}/activity-now` (any member): plan requests still `in_flight` on the workspace's connections, unfinished workflows and unfinished product runs on a paired computer, at most 10 of each, names, states and start times only; each item says whether it is moving (`active`): paused workflows and those waiting for a person or another step are listed without a spinner, and an in-flight plan request older than 45 minutes (above the longest allowed plan timeout, 30 minutes) is shown as "no answer recorded; check Models and connections" (only active items count as running); and "Recent", the latest 15 entries of the existing activity history. Read every 15 s while the window is visible; entries newer than the last ones seen in the tab get a dot (seen position kept in this browser per workspace). It does not share a poller with the nav activity dots (PR #107), which read other routes.
- Notes tab: one note per person per workspace in `workspace_notes` (migration 37: `(workspace_id, actor_id)` key, text up to 100,000 characters, version). `GET/POST /api/workspaces/{ws}/notes` (any member, including viewers, since the note is their own and changes nothing in the workspace; POST needs CSRF). Each save carries `expected_version`; the check is part of the write itself (insert-if-absent for the first save, update-where-version for later ones), so a stale window or two first saves racing are refused with `VERSION_CONFLICT` and the person chooses "Keep what is here" or "Use the other window's text". The same text again is not a new version. The browser saves about a second after typing stops, on blur, when the notepad closes or the workspace changes, and on page close with a keepalive request when the body fits under 60 KB (best effort). Unsaved text is also kept as a safety copy per person and per workspace (`apps/web/src/note-drafts.ts`) in the tab's session storage, or in memory when storage is blocked (then it covers closing the notepad but not a reload), with the version it was based on and the text of any save in flight, so closing the notepad during a conflict, a resize or a reload brings it back with the choice still open, and a reload during a save does not raise a false conflict. Sign-out clears every copy in the tab, so the next person never sees them; after that no copy is written until a session starts again, so the notepad's save on closing cannot put one back. Signing out first asks "You have notes that are not saved yet… Sign out anyway?" when this person has unsaved text, including text waiting on a conflict choice (second re-review L-E). Whenever a session starts in the tab (sign-in or a page load that finds a session), copies belonging to anyone else are removed, which covers a sign-out the browser never saw confirmed and a session that expired (L-D); the same person signing back in gets their own text back. A failed save does not retry on its own; typing again or "Try again" does. The notes route accepts bodies up to 6 × 100,000 + 1,024 bytes (every character escaped); other routes keep 64 KiB. Note saves do not fire the studio-changed event, so pages are not reloaded.
- Notes are private scratch: no other member (not even the workspace owner) can read them, no audit event is written (so the text never reaches the activity history), and they are never included in chat snapshots, model inputs, evidence or decisions. They are in the database, so the studio backup includes them. A person's notes are deleted when they are removed from the workspace, and the rows cascade with their workspace or actor.

Consequences: the wide-window space is used without changing page widths on smaller windows. Notes survive upgrades and reinstalls and follow the person between the desktop app and a browser. Not covered: note history (only the latest text is kept), Markdown rendering, notes shared between members, open terminal sessions in "Running now" (they live in the product store, not the database), and saving more than 60 KB of unsaved text when the window is closed outright (a reload keeps it).

## ADR-0059 — Run a package again in the same terminal window, and show how to use it beside the button (accepted November 2, 2026)

Context: after using "Run in a terminal" (ADR-0058) on the installed app, Jordan wrote (Nov 2) that the program "only seem[s] to be able to run it once, then the program ends", unlike PowerShell where he could retry in the same window with a new command or the Up arrow, and asked for "a section for explaining how to use the program and what arguments can be used". Each new run otherwise needed the button, the confirmation and a new window.

Decision:

- When the program ends, the bridge (trusted, outside the sandbox) prompts in the same window: Enter repeats the arguments, a typed line becomes a new argument list (split like a POSIX shell line with `shlex`, never run by a shell; at most 12 arguments of 500 characters; a pasted `python3 src/main.py` prefix is dropped; `.` means none), the Up arrow recalls earlier lines (Python's `readline`), and `q`, Ctrl+C or end of input closes. Lines typed in the owner's own window are the owner's input, like the keys the program reads; they are not re-confirmed in the studio.
- Every run rewrites `launch.json` and starts a fresh `systemd-run --pty` unit (same name, reset first) and Bubblewrap sandbox over the same read-only package copy, so the sandbox and limits are unchanged per run. A run keeps the 15-minute unit limit, cut to what is left of the window's 60 minutes (never 0, which systemd reads as no limit). The window also ends after 50 runs or 10 idle minutes at the prompt. Stop, a stale lease, a closed window and the deadline end the session at the prompt as well as during a run (SIGALRM watcher). A unit that is not confirmed stopped ends the session (`cleanup_required` as before). Policy strings: bridge `isolation-terminal/2`, studio `wsl2-bwrap-systemd-pty/2` (`session=3600s;idle=600s;runs=50`).
- `result.json` and the session record gain `runs` (arguments, exit code, seconds; the last 50) and `run_count`; the session's exit code is the last run's. A run list outside the contract is left out rather than failing the outcome. Older records without these fields stay valid. Try lists "N runs" and the runs in the window. One session per product and 3 per studio still hold, and the slot is held until the window ends.
- Try shows "How to use it" above the arguments box: the spec's steps and visible examples (the same held-out-safe guide as the preview page, with "Use these arguments"), the arguments the program takes, and what to type in the window. `GET /api/workspaces/{ws}/artifacts/{id}/guide` (owner only) re-hashes the package and reads options from its Python source text: literal argparse `add_argument` calls (names, help, metavar/type/choices, default), or `--flag` literals in files that read `sys.argv`; nothing is imported or run, comments and strings are skipped, f-strings and computed values are shown as missing, at most 40 options. The page says the list was read from the source and suggests `--help`.
- Review and live-check follow-ups (November 2): the source reader treats an unterminated string as running to the end of its line or file, so it stays linear on any input (M-1: a valid 120 KB Python 3.12 file had frozen the API for 31 s); at most 1 MiB of sources, 200 `add_argument` calls for the whole guide, and 4,000 characters per call (strings included) are read. Arguments are counted in UTF-16 units in the bridge and recipe as in the contract (L-1). A hangup seen at any point records `window_closed` (L-2). `tests/worker/rerun_check.py` drives the prompt on a pseudo-terminal in CI (L-3). BooleanOptionalAction, `range()` and named choices, and required options are shown as they behave (L-4). The guide offers `--help` only when the program answers it (`help_flag`: argparse without `add_help=False`, or its own `--help`); the live check showed the timing analyzer refuses `--help` with its own usage line. `q`, Ctrl+C and Stop now close the window at once (Jordan found the Stop window waiting for Enter); other ends still wait so the last screen can be read.
- No migration; no new dependency.

Consequences: retrying a program is Enter in the same window instead of a new window, and the owner can see its options before the first run. Live check on Jordan's PC at 0baa7f6 (his typed OK, separate worktree, throwaway product store, no database, $0): 9 runs in one window (`--practice` repeated with Enter, new arguments, Up-arrow recall, `q`) ended cleanly with the limits read back; Stop at the prompt recorded `stopped` within a second; no unit or bwrap was left. Before that, the rerun prompt was exercised in the cloud through a pseudo-terminal with stand-ins for `systemd-run`/`systemctl` (Enter, new arguments, Up arrow, bad quotes, `.`, pasted prefix, q, Ctrl+C, Stop at the prompt and mid-run, idle timeout); the real WSL `systemd-run --pty` unit reuse, terminal-mode restore after a raw-mode program and `readline` in Windows Terminal need one live check on Jordan's device with his typed OK. Options read from source can miss options built at run time or by other libraries (click, typer); the guide then shows fewer or none.

## ADR-0058 — Run a verified package interactively in an isolated terminal window (accepted November 1, 2026)

Context: Jordan asked (Nov 1) to launch built products from inside the app, for example the timing analyzer's `--practice` mode, which he had run from the exported source in PowerShell. Try's private preview runs a package once with all of standard input sent at once (20 s, output after exit), so interactive programs cannot work there (pilot finding F17, audit item 9). Design doc https://claude.ai/artifact/4hf8VN3bePP4vNSJCcVhAq offered three options; Jordan chose "Terminal window, isolated" on the decision card (option 1, recommended). The in-app relayed terminal panel (jitter, more surface) and running directly on Windows (generated code outside isolation, an exception to invariant 6) were not chosen.

Decision:

- Try shows "Run in a terminal…" on a verified package whose integrity check passes and whose runnable demo is available. The owner types optional arguments (one per line) and confirms the exact command (`python3 src/main.py …`, shell-quoted for display only) every time.
- `POST /api/workspaces/{ws}/artifacts/{id}/terminals` (owner only; body `manifest_sha256` + `args`, at most 12 of 500 characters) refuses a hosted studio (`LIVE_DISABLED`), a stale manifest (409), a non-verified package and an unavailable demo, then re-hashes the manifest and archive and reads the exact package bytes. `GET` on the same path lists the artifact's sessions, newest first (20). `POST .../terminals/{session}/stop` (body `artifact_id`) stops one. Start and stop write audit events `artifact.terminal.requested` (written before the window opens, so a refused or failed start is on record too) / `artifact.terminal.stopped` (session id, state, command, manifest and policy hashes).
- `TerminalSupervisor` (`packages/executor/src/terminal.ts`) copies the package into a fresh session folder under the product (`terminals/{id}/job/input`), writes `launch.json` with only the argument list, records `intent.json`, and opens a console window (`conhost.exe`) running `wsl.exe --exec /usr/bin/env -i … python3 -I bridge.py <job> <id> --recipe-hash <h> --interactive`. No studio settings, credentials or `CREATOR_*` variables cross.
- The bridge's interactive mode runs the reviewed recipe `worker/terminal.py` under the same Bubblewrap sandbox as QA (no network, read-only `/usr` and package, private tmpfs work area, no studio files) through `systemd-run --user --pty` with MemoryMax 256 MiB, no swap, 32 tasks, 50% CPU and RuntimeMaxSec 900 (15 minutes); the recipe adds RLIMIT_CPU 600 s and replaces itself with `python3 -I src/main.py <args>`. Policy string `TERMINAL_POLICY` (hashed into each record).
- One open session per product, at most 3 per studio. The supervisor keeps a lease heartbeat (750 ms); the bridge stops the unit on Stop (cancelled lease), on a lease older than 5 s (studio gone), at the deadline, or when the window closes (SIGHUP/SIGTERM). The bridge writes `environment.json` and `result.json` beside the job; the window then stays on "Press Enter to close" so the program's last screen (a practice report) can be read. If the window closes without a result, the supervisor runs the bridge's reap path and records `window_closed` only when the unit is confirmed stopped, otherwise `cleanup_required` (the package copy is kept for inspection). A session open when the studio restarts is recorded `lost`, with "not confirmed" in its reason.
- What the program prints is not captured. Session records (`ended`, `stopped`, `timed_out`, `window_closed`, `lost`, `blocked`, `cleanup_required`) are the owner's own tries, never QA, verification or isolation evidence, and they change no artifact or feedback state.
- If the studio was started inside another app's container (the Claude desktop MSIX redirect, see the Oct 31 pilot finding), the fresh session folder fails the canonical-path check and the start is refused with "start Creator Agent from the Start menu".
- No migration (records live in the product store like executions); no new dependency.

Consequences: interactive Python CLI products can be used from Try with near-native key timing (the window is a native console attached to WSL, with no relay through the studio), while generated code stays inside the reviewed sandbox. Not covered: web or GUI products (F17 later), programs needing network or files from the computer, more than 15 minutes, and the browser-only dev studio on a non-Windows host (refused). The interactive path is unit- and API-tested with a stand-in window; the real conhost + WSL + `systemd-run --pty` path still needs one live check on Jordan's device.

## ADR-0057 — Chat answers from the owner's connected ChatGPT plan or Claude subscription (accepted November 1, 2026)

Context: Jordan asked for Chat to answer all sorts of questions with his connected plans instead
of only the fixed rule replies of ADR-0055. Design doc https://claude.ai/artifact/4g1AMoevoCRSJTywfijSVG;
Jordan chose "Build as recommended" on the decision card (November 1, 2026): both plans, the
conversation plus a short studio snapshot, no qualification gate (answers labelled), and a
separate daily chat limit of 20 inside the connection's daily cap.

Decision:

- One owner setting per workspace (`chat_settings`, migration 36): on/off, the connection and a
  model verified on it, snapshot on/off, daily chat limit (default 20, at most 100). Only the
  owner changes it (`VERSION_CONFLICT` on a stale version) and only the owner asks for answers;
  editors and viewers read saved answers. Audit `chat.settings_changed`.
- Plan requests gain the purpose `chat` (path `responses`, no task class, no run, data class
  `private_approved`). Admission runs in the same locked `admitPlanRequest` as builds and adds:
  owner caller, chat switched on for exactly this connection and model, and fewer chat requests
  on this connection in the last 24 hours than the daily chat limit. Every existing gate still
  applies: connection ready (sign-in, credits or extra usage off, caps accepted, quota), model
  verified, data class allowed on the connection (connections default to synthetic and public,
  so the owner must allow private text, which re-asks for the caps), input cap, one request in
  flight, no unresolved request, and the connection's own daily cap. No qualification is
  required for chat: chat answers never feed scores, specs, evidence or builds.
- `chat_answers` keeps every try: the message, the connection and model, the plan request, the
  fixed instructions' version and hash, the exact input sent and its hash, the answer and its
  hash, or the plain reason it was refused (nothing sent) or failed. A row changes once, from
  pending to its outcome, and is never deleted (trigger). A retried click (same `client_id`)
  and a second click on a message that already has a pending or completed answer return that
  answer instead of asking again. A pending answer older than 15 minutes (a stopped studio) is
  closed as failed (superseded by ADR-0062: after its connection's request timeout plus 15
  minutes; answers are deleted with their conversation since ADR-0063) so the message can be asked again; its plan request, if any, stays
  unresolved and blocks the connection until reconciled. Audit `chat.answer_requested` and
  `chat.answered` carry ids, model and state, never the words.
- What is sent: the fixed instructions `chat-assistant-v1` (answer plainly, no tools or web,
  never claim the studio did something, treat records as data), the last 10 messages and
  answers before the question, the question, and, when on, a fixed-shape snapshot read from
  records only (workspace name and mode, record counts, the 8 newest runs with state and
  autonomy mode, the 8 most recently changed problems/ideas/specs/products by title, waiting
  approvals' kind and reason, workflows needing attention). Older turns are dropped first to fit
  the connection's input cap. No credentials, file paths, source page text, evidence bodies or
  product code can be included. Output is cut at 12,000 characters or the connection's cap.
- Routes: `GET/POST /api/workspaces/{ws}/chat-settings`,
  `POST /api/workspaces/{ws}/chats/{id}/messages/{message}/answer` (returns the saved answer,
  including refused ones). `ChatDetail` gains `answers`.
- App: Models and connections › Models has a "Chat answers" card (switch, connection, verified
  model, snapshot, daily limit, today's use, why the connection would refuse, and an "Allow my
  private text on this connection" button). In Chat, a message the rules keep as a note is sent
  automatically when answers are on; any other message gets an "Ask <model>" button. Answers
  are labelled "model answer, not checked" (and "fixture stand-in" for fixture connections) and
  show a "What was sent" panel. The fixed rule cards are unchanged; nothing in an answer can
  start, approve, fetch or spend.

Consequences: plan requests cost the studio $0 and do not touch the $20 runtime ceiling; they use
the owner's plan allowance. A refused request never falls back to a metered route. Claude still
runs only through the owner's own signed-in `claude -p` (ADR-0050). Not built: web access,
streaming answers, picking records to include, deleting conversations or answers. Migration 36
and ADR-0057 were allocated by the coordinator (35/0056 and 37/0058 belong to parallel threads).

Review fixes (PR #102 review, `/mnt/project-files/reviews/PR102_CHAT_ANSWERS_REVIEW_2026-11-01.md`): M-1 an answer is `refused` ("nothing was sent") only for rejections that happen before the text leaves the studio (cancelled before dispatch, the studio's Claude Code folder or start failing, Claude Code unavailable, outdated or not a subscription login, no token, studio-side errors); a provider refusal after receiving the text (usage limit, sign-in, model, any non-200) is `failed`, says "<plan> refused it after receiving the text", and keeps the "What was sent" panel. L-2 any error before admission records the request is `refused`; after it, `failed`. L-3 chat is refused while a study attempt is open on an active run in the workspace. L-4 admission reads the chat setting without a row lock (the connection lock serializes chat requests), so a settings save cannot deadlock with it. L-5 `<` and `>` in snapshot fields, earlier turns and the question are written as entities, and the stored snapshot flag comes from the builder, not from searching the text. L-6 turns are labelled "Person"/"Assistant" and the question "Question:", not "Owner". L-1 the card says allowing private text applies to the whole connection (discovery and builds too) and stops workflows set up on the old settings. L-7 the note reply no longer promises an answer.

## ADR-0056 — Evidence websites and model caps in the app (accepted November 1, 2026)

Context: Jordan asked (Nov 1) for more evidence-website options, including allowing all sites,
and for changing model caps in the app (audit items 5 and 10). Design doc
https://claude.ai/artifact/8j34BJUups2CGMqbTrPw2X; Jordan chose "Both, with any-site switch".
Amends ADR-0051.

Decision: each workspace's evidence websites are owner settings in Settings › Evidence
websites. A change names a mode (`listed`, or `any_public`, which is off until the owner turns
it on), up to 100 exact hosts or `*.example.org` subdomain patterns (not the bare domain; never
an IP address), and a reason. Only a workspace owner signed in as a person may change it
(`requireOwner`); agents, workers and system actors are refused. Each change is an immutable
`evidence_site_changes` row (migration 35) naming the version it replaced, written with an
`evidence_sites.changed` audit event under a per-workspace advisory lock taken before the
audit-chain lock (ADR-0047); a stale page gets VERSION_CONFLICT and a no-op is refused. With no
change saved, the list the studio started with (`CREATOR_SOURCE_HOSTS`, the desktop window's
list) applies. The source broker reads the workspace's latest change on every live fetch, so a
change applies to the next fetch with no restart; the startup policy's hash-only hosts and all
limits (https on 443, 2 MB, 15 s, 3 redirects, 100 fetches per run, excerpt bounds) stay. "Any
public website" adds `any_public_host: true` to the source policy: a host no rule names is
fetched with excerpts when it is a fully qualified public DNS name (not an IP, single label or
local suffix such as .local, .lan, .internal, .home.arpa); named rules, including hash-only,
match first, and the adapter still refuses private, loopback, link-local and reserved
addresses after DNS on every hop. Policies without the switch keep their earlier hashes, and
every retrieval records the hash of the policy that admitted it. `CREATOR_SOURCE_FETCH=live`
no longer needs hosts: with none, the adapter exists but no website is approved and fetches are
blocked with `no_websites_approved`. The installed studio now always starts live (the desktop
list is only the starting list); `off` keeps all live fetching and Settings changes refused.

Model caps: the Models page gains a "Change caps" form over the existing owner-only plan
settings route (ADR-0042); ranges are PlanCapsSchema's, and saving withdraws the caps
acceptance as before. No migration for this part.

Consequences: the owner, not a model, chooses where evidence comes from, and can do it in the
app. With "any public website" on, runs may quote weak or planted pages and every fetched site
sees the request and the computer's IP address; robots.txt is not checked. Study conditions
compared against each other should use one frozen policy (the retrieval's policy hash shows
which applied). The policy is read just before admission, so a change racing a fetch applies
to whichever it is recorded with. Brave public search (off by default) still filters by the
startup list. Rolling back to an older app leaves migration 35's table unused.

Amended November 3, 2026 (PR #103 review Lows, no migration): a change in a fixture workspace is
refused, because fixture workspaces always use the fixture policy, and Settings says so (L1). A
`*.` pattern under a shared public suffix (a usual registry label such as `co`, `org` or `gov`
under a two-letter country code, or a shared hosting domain such as `github.io`) is refused by
the schema and the Settings box alike, since it reaches nearly as far as "any public website"
without its warnings; this is a short list, not the full public suffix list (L3). The sources
status note says where the websites come from now that the live adapter is always on (L4). "Any
public website" is described as the websites the owner or a scheduled refresh asks for, since
no model picks URLs today; if automated URL choice is ever added, revisit the warnings, because
URL query strings could then carry workspace text out (L5). While the startup list is in force
(version 0), the page sends the list it showed and a save is refused with VERSION_CONFLICT if a
restart changed it, so `previous_hosts` is what the owner saw (L6).

## ADR-0055 — Studio chat, first version: saved conversations with rule-based replies, no model (accepted November 1, 2026)

Context: runbook step 9 page consolidation. The approved page map (design doc, Jordan's "go")
puts a central Chat page first. Jordan chose "$0 chat first, model replies later" on the
decision card: the first version must not call any model or spend anything.

Decision: Chat is the studio's front door and home page (`#/chat/conversations`, the sixth page,
first in the sidebar; an address with no page now opens Chat instead of Overview).

- Conversations and the person's messages are saved per workspace (migration 34
  `studio_chat`: `chat_conversations`, `chat_messages`). Messages are immutable
  (`creator_reject_change()`), numbered per conversation under a row lock, and carry a
  client-chosen `client_id`: a retried send returns the saved message (200), the same id with
  other words is refused (`IDEMPOTENCY_CONFLICT`, 409).
- The server alone decides a message's intent with fixed rules (`classifyChat` in
  `packages/contracts/src/chat.ts`, in this order: web address, save/remember, start a
  discovery/research, approvals, why/blocked, what's next, else note). The request schema is
  strict, so a client cannot send an intent.
- The studio's replies are not stored. They are worked out in the browser
  (`apps/web/src/chat-replies.ts`) from the message's intent and the same facts as the Path tab
  and the what's-next line each time they are shown, so they cannot go stale silently: an older
  message of the same kind says its answer may be out of date.
- Cards only open a tab or fill in a field there (the Sources fetch address, the Discover
  theme). Nothing in Chat submits a form, starts a run, fetches, approves or spends; every step
  still goes through its own form and the server's gates.
- Audit events `chat.started`, `chat.message` (message id and intent only, never the text) and
  `chat.renamed`. Viewers read conversations; only editors and owners write.
- Routes: `GET/POST /api/workspaces/{ws}/chats` (list with `?q=` search over titles and message
  text, create), `GET .../chats/{id}`, `POST .../chats/{id}/messages`, `POST .../chats/{id}/title`.

Consequences: Chat answers only the fixed kinds of question; anything else is kept as a note
with a "make this a brief" card. Replies in words from a model are a later, separately approved
step (needs Jordan's OK on route, data sent and cost). Conversations cannot be deleted yet.

## ADR-0054 — One owner approval per build of a frozen spec (accepted October 31, 2026)

Context: owner pilot findings F12, F13, F15 and F18. A supervised run holds
`product.commit_build` at a stage gate, so each build needed a one-time grant, and the executor
asked for it again before every repair round. A build that needed a repair stopped at
"Build admission waiting_human", and building again then failed with "Stale build candidate",
because the studio always sent the task's base commit. On the plan route each builder and
reviewer request also needed the run's own `model.generate` admission, which in practice meant a
standing grant the app could not create. Jordan's decision (October 31, 2026, 06:57 EDT): one
approval per build of one frozen spec, covering its repair rounds and both plan roles within a
stated request limit, with an ADR and tests.

Decision: a build asks once, before its first round. `POST /workspaces/:ws/runs/:run/build-approvals`
(store `admitBuild`, which the studio calls directly) runs the ordinary `product.commit_build`
admission of the product's frozen spec (same target, humility review, stage gate, grants and
decision flow) and, when it is allowed, writes an immutable `build_approvals` row (migration 33)
in the same transaction. The row binds the build id, product, task, spec id, version and hash,
plan hash, route, plan connection and model, data class, humility review, the admission and the
grant that allowed it (and its decision), the deadline, and the build's stated limits: the plan's
`max_repairs` (at most 2) and its `max_calls` as the request limit (at most 6). The studio writes
the approval's wording; the Approve option on the decision says what one approval covers,
including, for plan-role builds, the connection (label and short id) and model (re-review L-B).
A build id can be approved only once; two racing starts of one build give one approval and
`DUPLICATE` for the others.

- A one-time approval is bound to the build scope it showed (review M-1). When a build asks,
  its route, connection, model, request limit and repair rounds are recorded against the
  decision it raised (`build_approval_asks`, first ask wins, like the wording). A one-time grant
  from that decision admits only a build with the same route, connection and model and no more
  requests or repair rounds. Before admission, `admitBuild` leaves out of the grant list every
  one-time grant for that spec and run whose ask does not cover this build, or that no build
  asked for, and, when one was asked for exactly this build's limits, the wider ones too
  (re-review L-A). So an unused one-time approval of another build never shadows a standing
  grant or the approval this build got: the build is admitted by those, or asks for its own
  approval, and the other grant stays unused. Leaving grants out only narrows authority; the
  scope check after admission still refuses a grant that does not fit. Under a standing
  `product.commit_build` grant the owner already authorized builds of that run, so the build's
  own stated scope is recorded as is (review L-2); the plan-side checks and the connection's
  per-run and daily caps bound it, no less than the standing `model.generate` grant it replaces.
- An approval lasts until the earlier of the build's deadline and the grant's expiry, and a build
  may not state a deadline more than 24 hours away (review L-1).
- Repair rounds do not ask again. The executor still re-checks the run, the grant behind the
  approval and the humility review at every step, so cancelling the run, revoking or changing a
  standing grant, or revising the review stops the build before its next request. A one-time
  grant is consumed when the approval is written and can no longer be revoked; stop such a
  build by cancelling its run (or revising its humility review), and its approval ends at its
  deadline at the latest.
- Plan-role requests (`patch_build`, `independent_review`) now name their build. Plan admission
  accepts one only when that build's approval exists, belongs to the caller, run, connection,
  model and data class, has not passed its deadline, its grant still stands (a one-time grant
  exactly as consumed, or a standing grant unchanged and unexpired), its humility review is
  unchanged, and fewer than the request limit of requests already carry its build id. This is
  checked under the connection lock, so two requests cannot take the last slot. The run's own
  `model.generate` grant is no longer needed for them. Every other plan check (qualification for
  the current role prompt, caps, owner, active non-human-only run, no study assignment) applies
  as before.
- The build-roles preflight no longer asks for a standing model grant. It now refuses a run
  with room for fewer than 2 plan requests on the connection, per run or per day (F11).
- A stopped build continues from the task's current candidate. `GET .../products` returns each
  task's `head`, and the studio sends it as `expected_commit` (F12). The commit check still
  refuses a build whose candidate changed underneath it.

Not changed: metered broker builds and the Codex builder keep their per-call `model.generate`
admission and reservations, because they spend or have their own caps. Frozen study builds
(T15) keep one admission per round (`perRoundAdmission`), so no study condition changes.
Executed QA and the independent review still decide `verified_candidate`.

Known limit: the decision's wording names the route, connection, model, repair rounds and
request limit, so builds that differ in any of them raise separate decisions, and several
one-time approvals for one spec can coexist; each goes only to a build it covers. "Covers" means
the same route, connection and model and no more requests or repair rounds, so when the only
active one-time approval is a wider build's (its decision was answered first), a narrower build
of the same spec that starts in between is admitted on it, within everything that card stated
and recording its own smaller limits; the wider build then asks again, and the narrower build's
own approval, if answered later, stays unused until it expires (PR #93 review L-1; fails
closed). A build with
the same wording shares the pending decision of the build that first asked (the first ask fixes
its scope). An approval has no "build finished" state: requests left under its limit stay usable
by the same owner, route and run until it ends (at most 24 hours, owner-only, $0, within plan caps). Approving in place, so that the build continues by itself, is separate work
(the navigation thread). Keeping decisions when scores change is in the selection code, not here (built later the same day in the Compare and decide form; web only).

Tests: `tests/src/build.test.ts` "one approval covers a whole build" (a repair round with both
roles asks once, the scope matches the recorded limits, a stop between rounds ends the build,
study ports still ask per round; fails when the executor asks every round) and "a stopped build
continues from its last candidate". `tests/src/plan-connections.test.ts` "build-role plan
requests ..." (no approval, the request limit, another run, another route, a revoked grant, the
wording of the decision, a duplicate approval, and the F11 preflight; fails when plan admission
skips the approval check). Review fixes add: a one-time approval refused to a build with
another route, model, more requests or more repair rounds, then admitting the build it showed;
a deadline over 24 hours refused; and per-request refusals for an expired approval, another
owner and a revised humility review (each fails when its check is removed). Re-review follow-up
adds `tests/src/plan-connections.test.ts` "a one-time build approval goes only to a build it
covers, preferring the exact one, never blocking others": a one-time grant from a generic admission's decision, another connection with the
same model, `codex_plan` against a `broker` approval, two approvals answered in reverse order
each going to its own build, a standing grant used despite unused one-time approvals of other
builds, the approval's expiry clamped to the standing grant's, four racing starts of one build,
and the per-request data-class check. Each of the route, connection, exact-preference,
exclusion, expiry-clamp, duplicate-mapping, data-class and wording checks fails a test when
removed.
`tests/src/studio-builds.test.ts` checks the recorded approval of a
studio build, its immutability, and a second approval of the same build refused over HTTP.

## ADR-0053 — Plan-role build packets are bounded by the accepted plan input cap (accepted October 31, 2026)

Context: owner pilot finding F21. Build 039ea78b (timing analyzer spec v4, $0 ChatGPT plan route)
ran the builder, then stopped before the reviewer with "Role context exceeds bounded packet". The
reviewer packet was 20,026 characters: spec and task fields (7,894), the full file map (5,971)
and the diff from the template (5,892). The executor's hard-coded 20,000-character role bound
dates from the metered broker route. The connection's owner-accepted per-request input cap was
64,000, and plan admission already enforces it on instructions plus input before any request is
sent. The v3 build of the same program had fit with 36 characters to spare.

Decision: on plan-role builds the executor's own bound is a runaway ceiling of 200,000 characters
(the schema maximum for `max_input_chars`). The binding bound is the connection's accepted
`caps.responses.max_input_chars`, which plan admission checks and records as a refusal. Metered
broker builds keep the 20,000-character bound, because nothing else bounds their input. The error
now states the packet size and the bound.

Amendment (review of PR #88, H-1 and M-1): the API's build-call route had its own 20,000-character
input schema and the ordinary 64 KiB body limit, and the studio's own builds pass through that
schema too. The route's input schema now uses the same 200,000 ceiling, and the `build-calls`
action gets a 1 MiB ingress allowance (a JSON packet sent as a JSON string can roughly double when
escaped). The accepted `max_input_chars` stays the binding bound through admission. A
`codex-builds` body carries the same builder packet (as an object) and gets the same 1 MiB
allowance instead of 64 KiB (PR #89 re-review L-B).

Consequences: a plan-role build is limited only by the cap the owner accepted in Settings, and a
packet over that cap is refused by admission without being sent. The file-map bound (14,000 bytes)
is unchanged. The reviewer packet still carries both the file map and the diff; trimming that
duplication is left for later. Tests: `tests/src/build.test.ts` "plan-role packets are bounded by
the accepted plan input cap, broker packets by 20,000" fails when the plan route uses the broker
bound. `tests/src/plan-connections-api.test.ts` registers a real run and sends, through HTTP,
build-call inputs over the connection's accepted `max_input_chars` (one also over 20,000
characters, one whose escaped body is over 64 KiB): each reaches plan admission and is refused
with the per-request input cap blocker, while a small input is refused without it (PR #89
re-review L-A; before, every call used an unregistered run and stopped at the run lookup). It
fails when the route schema, the body allowance or the admission check is reverted. It also sends
an over-64 KiB `codex-builds` body, which reaches the Codex configuration check rather than a
body-size refusal. `tests/src/plan-connections.test.ts` checks that
admission refuses an input one character over the accepted cap.

## ADR-0052 — Qualification answers and grading reasons are visible; held-out views bind prompt revisions (accepted October 31, 2026)

Context: owner pilot finding F10. On October 30 the installed app's patch_build qualification
failed 0/4 twice. The app showed only "failed", so the cause could not be seen. On October 31 the 8 stored
answers turned out to be correct patches. Every case was `provider_error`, because the installed
app had been started inside the Claude desktop app's MSIX container, which redirected the new
`plan-qualification-products` folder. Node's realpath then differed and `canonical()` refused the
path. The grader swallowed that message.

Decision: the patch_build grader (`gradePatchCase`) returns a plain reason for every non-pass.
The reason covers no submission (with the builder's blocker), a refused patch, a set-up failure, a worker
failure, or the failed check's exit codes and whether its output matched. It never prints expected
output. The reason is stored in the plan request's `reason_code` (at most 200 characters,
clipped once). `GET /plan-qualifications/{id}` and the Models page show each case's outcome,
reason and stored answer (synthetic or public data only, per ADR-0049), including held-out
cases. Because held-out answers and reasons are now visible to the owner, invariant 9 applies:
a role prompt revised after viewing a qualification's held-out results counts as tuned on those
cases, and is requalified on fresh held-out cases. The page says so next to held-out answers.
Reasons for the other check kinds (reviewer verdict, discovery contracts) are not added yet.
Those still show only the signal.

Consequences: no migration. The installed app must be launched by the owner, never from a Claude
session. Settings saved while it ran in the container (`studio.json` with the approved websites)
were copied back to the real home with the owner's OK on October 31.

Amended November 3, 2026 (PR #86 re-review L-5 and PR #75 review L-2, no migration). Opening a
qualification's results when any held-out case ran is recorded once per person as a
`qualification_held_out_viewed` connection event (the qualification, its task class, a hash of
the prompt and one key per held-out case: everything but the system message). Starting a
qualification is refused if any of its held-out cases match ones viewed for the same task class
in this workspace under a different prompt, naming the date: freeze fresh held-out cases.
Retrying the same prompt on them stays allowed (for example after a worker failure). For
discovery task classes the case key also leaves out the check's `role_version` and
`packet_hash`, and the role version counts as part of the prompt, so a revised discovery role
is caught too (PR #130 review L-1). A prompt carried in a user message rather than the system
message is not detected. Separately, the
newest decided qualification of a model for a task class is the one that counts (`isQualified`):
a later failure withdraws an earlier pass, a later pass restores it, and running or abandoned
rows decide nothing. Admission, the build-roles-ready preflight and the Submit page all use it,
and Models marks a pass that no longer counts.

## ADR-0051 — Owner-approved evidence websites in the installed app (accepted October 30, 2026)

Context: pilot run 1 (runbook step 8) could not add evidence. The installed app clears its
environment and its `studio.json` had no host list, so `CREATOR_SOURCE_FETCH` was always off
and every fetch in a real workspace was denied (`live_fetch_not_configured`). Claims count only
with quoted passages from fetched pages, so discovery could not start. Jordan chose "fix and
reinstall" over stopping the pilot.

Decision: `studio.json` gains an optional `source_hosts` list (at most 20 lowercase DNS host
names, no scheme, port, path or IP), edited in the status window ("Websites approved for
evidence") and saved with a restart of the studio service. The desktop passes the list in the
service input; a non-empty list sets `CREATOR_SOURCE_FETCH=live` and `CREATOR_SOURCE_HOSTS`.
Empty keeps fetching off. The source broker's per-hop policy and the run's `source.fetch` grant
are unchanged, so every fetch still needs a covering grant.

Consequences: the owner, not a model, approves websites, in the app's local control window
(no remote UI access). The field is omitted when empty, so a rollback to an older app still
reads the file; with hosts saved, an older app refuses the file until the field is removed.
Hash-only hosts are not exposed yet.

## ADR-0050 — Claude subscription through the owner's own Claude Code CLI (accepted October 28, 2026)

Context: Jordan asked whether Creator Agent can use a Claude subscription the way it uses the
ChatGPT plan. Anthropic's terms (Claude Code legal and compliance page, Agent SDK overview,
Consumer Terms; read 2026-10-28) forbid apps from offering Claude.ai login, routing requests
through Free/Pro/Max credentials for their users, or collecting, storing or intermediating
Claude.ai credentials or session tokens. They do allow a user to sign in to the unmodified
Claude Code binary with their own subscription, and they document scripted use (`claude -p`).
Jordan chose "Build it as designed" on the feasibility design.

Decision: plan connections get a fixed `kind` (`chatgpt_plan` or `claude_code`, migration 32,
immutable by trigger; a `claude_code` row can never hold a credential reference). A
`claude_code` connection runs the owner's own signed-in Claude Code on this computer, in a
dedicated `CLAUDE_CONFIG_DIR` (`CREATOR_CLAUDE_CODE_CONFIG_DIR`), never the owner's personal
folder. The studio has no Claude sign-in flow and never reads a Claude credential; "signed in"
is the last `claude auth status` result, and only a `claude.ai` login with the first-party
provider grants plan usage. The status is re-read before every request. Runs use restricted
mode with no tools, MCP, skills, session persistence or fallback model, one turn, an
allowlisted environment, stream output checked for tools, credential source and the answering
model. Refusals are cut at the first retry notice. Everything else reuses the ChatGPT-plan
gates unchanged: owner caps, a Claude-specific "extra usage is off" attestation, one-shot
model verification, frozen-benchmark qualification, the request ledger and reconcile. Direct
path only; `code_build` and Codex builds are refused for this kind.

Consequences: no money moves while extra usage is off; requests share Jordan's Claude limits.
Policy risk stays: Anthropic may judge studio automation as outside "ordinary, individual
usage" and may enforce without notice, so caps are low and the route is for Jordan's personal
studio only. The fully clear alternative remains a metered Claude API key. Details:
`docs/CLAUDE_CODE_CONNECTION.md`.

Review amendment (PR #76 review, same day, before merge):

- A fixture connection runs Claude Code only against an explicit stand-in. Without one it is
  refused with `LIVE_DISABLED`, the same as `endpointsFor` for ChatGPT, and nothing starts.
- The start event must report `apiKeySource: "none"`.
- The child's `ANTHROPIC_CONFIG_DIR` is an empty studio folder (checked before each run), so
  an Anthropic federation profile cannot outrank the login.
- Instructions go through `--system-prompt-file`.
- Claude Code older than 2.1.248 is refused with an update reason.

## ADR-0049 — Reviewer prompt states T12's answer rules; reviewer benchmark v2 (accepted October 28, 2026)

Context: Jordan's first live T12 role qualifications on gpt-6-astra (ChatGPT plan, $0):
`t12-builder-v1` qualified (1/1 development, 3/3 held out; an earlier 0/4 was the jsonb
key-order grading bug fixed in #73). `t12-reviewer-v1` failed (0/1 development, 2/3 held out):
both cases expecting `changes_requested` passed, while both expecting `approve` missed
(rv-01 `review_rejected`; rv-03 `acceptance_check_failed`, an echoed hash not matching). The
answers were not stored, so the cause is an inference. `independent-reviewer/1` never told
the model the two rules T12 itself enforces on a review (build.ts: `approve` counts only with
an empty findings list; candidate, spec and task hashes must match the packet). Real builds
would hit the same gap.

Decision: the reviewer prompt becomes `independent-reviewer/2`, which adds only those two
rules (copy the three values exactly; approve only with no findings, otherwise
`changes_requested` or `blocked`). The builder prompt is unchanged, so the builder
qualification stays valid. `t12-reviewer-v2` is authored by the same script
(`reviewer-v2` mode) with the same four cases, splits, candidates and expected verdicts as v1,
new T12 packets, and the current prompt; the 3 of 3 held-out bar is unchanged. Nothing about
the cases was tuned to the failed answers. v1 and its failed qualification stay recorded;
qualification start refuses v1 now because its prompt no longer matches. The study build gate
and the fixture reviewer accept the `/2` prefix (no final study has frozen; this changes the
synthetic study build role prompt too). Qualification requests on synthetic or public data
now keep their answer text in `plan_requests.output_text` (existing column, no migration) so a
failed case can be explained; other plan answers are still not kept.

Needs Jordan: approve `t12-reviewer-v2` as frozen, then one 4-request qualification run.

Follow-up (PR #74 review M-1): a build-role qualification now admits work, and counts in the
`build-roles-ready` preflight, only if its stored manifest still hashes to `manifest_hash` and
every case's system prompt is the current T12 role prompt. A future `builder/2` therefore
needs its own qualification. Qualification history is still shown in full. Review Lows L-1
(the prompt does not say `changes_requested` needs a finding) and L-2 (the strict key set is
not spelled out) are deferred on purpose: any prompt change now withdraws the reviewer
qualification Jordan just earned, so they wait for the next deliberate prompt revision.

## ADR-0048 — T12 builder and reviewer on the ChatGPT plan's direct route (accepted October 28, 2026)

Context: no real T12 build is $0 today. The Codex builder path is blocked in code (no
Codex-path verification or `code_build` qualification), and even with it the independent
reviewer always went through the metered dollar broker. CODEX_INTEGRATION §4.2 also barred a
reviewer on the same connection as the builder. Jordan chose "plan for a fully $0 route
first", then "Yes, build option 1" on the design (both roles as plan Responses requests,
with the §4.2 change).

Decision: a build plan may name `plan_roles: {connection_id, model_id}`. The builder and
reviewer then go as fresh direct Responses requests on that ChatGPT-plan connection under
new task class `patch_build` and existing `independent_review` (both added to the Responses
classes; the owner adds them to a connection's allowed classes in Settings). The role
prompts (`builder/1`, `independent-reviewer/1`, moved unchanged to domain `build-roles.ts`)
are fixed server-side; the caller sends only the packet. Packets, scoped patch tool, held-out
QA in the WSL worker and `verified_candidate` rules are unchanged. §4.2 now allows the
reviewer on the same connection and model as a fresh request (no builder conversation or
claims); executed QA still decides.

Admission (plan request ledger, no migration): each role's class must be allowed and
qualified for the model; a build-role request outside a workflow must name a registered run
that is active, not human-only, and not a study assignment (frozen study arms keep their
routes). Responses caps apply (10 per run, 40 a day shared, 120 s, 16,000 output chars).
Build plans allow `timeout_ms` up to 120 s only with `plan_roles`; broker builds keep 60 s;
`plan_roles` and `codex_plan_builder` are exclusive. Plans without `plan_roles` hash the same
as before. Each call writes an intent (route `chatgpt_plan_responses`, task class, prompt,
context hash) and the outcome to the build record.

Qualification: new benchmark checks. `review_verdict` needs the answer to bind the case's
candidate, spec and task hashes and give the expected verdict (approve with no findings, as
T12 requires; changes_requested with at least one finding). `patch_cases` is graded by the
studio's patch scorer (executor `scorePatchCase`): the patch is applied to a throwaway product
from the reviewed template (its own products root, `plan-qualification-products`) and every
case runs in the worker as QA does. Without the scorer the qualification stops before any
request (`patch_scorer_unavailable`). Route benchmarks refuse `patch_cases`. Every case of a
build-role qualification must use exactly the T12 role prompt. Build-role checks need their
own task class and JSON output. The web build form offers "Builder and reviewer on ChatGPT
plan" for verified Responses models; the CLI posts to `plan-connections/:id/build-calls`.

Consequences: a real build can cost $0 metered once Jordan signs in, verifies one model,
adds the two classes and qualifies both roles; until then admission refuses it. Benchmarks
`t12-builder-v1` and `t12-reviewer-v1` (4 cases each, 3 held out) are generated by
`scripts/author-plan-role-benchmarks.mjs` from the exact T12 packets of synthetic checklist
tasks. Jordan approved both as drafted on October 28, 2026, with a 3 of 3 held-out bar per
role (`min_held_out_cases` 3, floor 3/3); they are frozen and must not be edited.

Review of #71 (no High; 1 Medium, 5 Lows), all fixed. M-1: a patch scorer that threw left
the plan request in flight and blocked the connection; any grader error is now a recorded
`provider_error` signal and the request is settled, and `scorePatchCase` returns
`provider_error` if the throwaway product cannot be made. L-1: a build with `plan_roles`
first asks `planRolesReady` (new port; API `plan-connections/:id/build-roles-ready`) and stops
before the commit_build grant is used or the builder is sent unless both roles are allowed,
verified and qualified. L-2: build-role requests are owner-only and pass the run's own
`model.generate` admission (a grant covering model requests on the run is needed, as for
broker builds). L-3: qualification grades with T12's strict builder and review schemas.
L-4: the form says budget and pricing are recorded but unused on this route (plan hash
unchanged). L-5: throwaway qualification products are removed after grading; new tests for
the study-assignment refusal, owner-only, the run admission, the preflight and a
service-level patch qualification with an accepting and a crashing scorer. Re-review of
#72 (no High/Medium): N-1, the preflight now also checks owner, run state, study assignment
and a read-only dry run of the run's `model.generate` admission (`wouldAdmit`; nothing is
consumed or raised), and asks for a standing grant when only a one-time grant covers it
(each role request needs one). Nits: a grader error is stored as `grader_error: <message>`
in the request's reason; a failed throwaway create leaves no partial directory. Shared
model ancestry can correlate builder and reviewer errors; QA on held-out cases is the guard.
The study-assignment refusal is tested (added in #72).

## ADR-0047 — Study budget locks before the audit-chain lock (accepted October 28, 2026)

Jordan approved fixing the gap ADR-0044 recorded before the first real run. The study build
path (`prepareStudyBuild`) took the audit-chain lock in `lockAttemptForWrite`, then the
study-ledger lock and, for final records, the runtime-ceiling lock in `holdBudget`. Ceiling
and limit saves take runtime-ceiling then audit-chain, and `prepareStudyExecution` takes
study-ledger then audit-chain, so either pair could deadlock (PostgreSQL would abort one
transaction). It also applied to synthetic builds against concurrent synthetic execution in
the same workspace. Now `lockAttemptForWrite(..., budget = true)` takes `holdBudget`'s locks
(study ledger, then the runtime ceiling for final records) after the run and attempt row
locks and before the audit-chain lock; `holdBudget` re-takes them (advisory locks are
re-entrant). Order everywhere: run row, attempt row, study ledger, runtime ceiling, audit
chain. New `lockRuntimeCeiling` in runtime-ceiling.ts. Test (study-build, final-record
gate): while another transaction holds the study-ledger or runtime-ceiling lock, a final
build waits on it without holding the audit-chain lock, then refuses LIVE_DISABLED; it fails
on the old order. Final builds are still LIVE_DISABLED; no migration, no amounts changed.

Review of #70 (no High/Medium): L1, the test covered only final records; it now also checks
a synthetic build against a holder of `study-ledger:synthetic:<ws>` (the inversion that
deadlocked on main) and fails if the synthetic early lock is dropped. N2: budget-store uses
`lockRuntimeCeiling`. N1 kept: a final build takes the T15 ledger and ceiling locks before
refusing LIVE_DISABLED; brief, and it is the order live final builds will need.

## ADR-0046 — Builds and packaging started from the studio (accepted October 27, 2026)

Jordan approved the five recommendations of the in-app build and package design on
2026-10-27: builds run in the studio service; real workspaces use the ChatGPT-plan Codex
builder, with no live call until he approves a specific build; fixture workspaces get a $0
sample; generated code runs only in the WSL worker; the first release is build, package and
download, with revisions later. Context: the desktop app has no CLI, and every build step
after the frozen spec ran inside the CLI process.

Decision: the API gets `GET|POST /workspaces/:ws/products` (list; create from a current
frozen spec), `POST .../products/:id/tasks`, `POST .../products/:id/builds` and
`POST .../products/:id/package` (apps/api/src/products.ts). They run the same
`BuildSupervisor` and `ArtifactSupervisor` the CLI uses, over the API's product store
(`CREATOR_PRODUCTS_ROOT`, the desktop home's `products`). The build ports the CLI implements
over HTTP are implemented in-process against the store and broker under the caller's context,
with the same checks: workspace owner only, current active frozen spec bound to the product,
active non-human-only run, `product.commit_build` admission with a covering grant and an
active humility review, re-checked on every step; model calls reserve through the broker; the
Codex builder goes through the same plan relay (`runCodexBuild`, shared with the CLI route).
QA cases come from the frozen spec, never from the caller. A build or package answers once its
intent is recorded and continues in the background; a second start for a product with a build
running here is refused, not queued. Packaging re-checks the build first, re-reads and
re-hashes the package, then registers it as the register route does.

Limits: job state is in memory; after a restart a build with no outcome shows as interrupted
and is never resent. Generated code still runs only in the execution worker; a host without
WSL cannot build. The first live Codex build remains a separate, owner-approved step.

Amended October 27, 2026 (review of #67): the build ports run without the request's
Idempotency-Key, since store commands replay on it and one approved-once admission must
not cover a second build or round. `POST .../products/:id/recover` releases a product's
locks whose recorded process is gone (never one held by this process or a live one; the
management lock only with a clean integration repo), keeping the lock file and an event.
A second package request for a build already packaging is refused. Recover also reconciles an
acceptance run the app left in the worker (only after its supervisor is gone and the
executor verifies the WSL2 unit stopped) and releases a dispatch lock no worker was
launched under; a lock written before the current boot counts as dead. Known limit: a build
already running continues after the owner signs out, like other started work; revoking
its grant or stopping its run stops it at the next step.

## ADR-0045 — Test-mode checkout screen and simulated test buyer (accepted October 27, 2026)

Runbook step 3 (Jordan asked to start it on 2026-10-27). The Payments page gets a
"Checkout (test mode)" section (apps/web/src/checkout.tsx). Only the workspace owner opens
checkouts or acts as a buyer; the store enforces it. Three routes are added:
`GET /workspaces/:ws/payment-checkouts` (owner-only list, newest 50), and for the simulated
processor only `GET|POST .../payment-checkouts/:id/buyer` (state, and one buyer or processor
step: pay, settle, refund in full, dispute, dispute won/lost) and
`POST .../payment-checkouts/:id/deliver` (deliver one queued event correctly signed, with a
wrong secret, or with a timestamp outside the 5-minute tolerance). A step changes only the
in-memory fixture processor and queues the event body a processor would send; nothing reaches
the ledger or access until a delivery passes through `PaymentService.receiveWebhook`, the
same signature, mode, de-duplication and backend-read path real deliveries use, with the
webhook actor identity. The owner chooses the order and can repeat a delivery, which
exercises duplicate and out-of-order events. Each buyer step or delivery records a
`payment.test_buyer_requested` audit event (state reads do not). Test-buyer state lives in
API memory like the fixture processor. At most 100 test buyers are kept (the oldest is
forgotten first, and its simulated checkout session is closed with it); a forgotten
checkout, like one after a restart, says so and offers nothing. Stripe test-mode checkouts
show only Stripe's hosted `https://checkout.stripe.com/` link and a "read a payment by id"
recovery (the existing reconcile route); no Stripe call was made by this work. Also:
`checkoutTarget` now refuses an offer whose release has since been replaced (later build or
spec version), so a buyer cannot pay for a replaced release. No migration, no live mode, no
processor choice: Stripe remains the pending default.

## ADR-0044 — Per-run and per-model spending limits under the ceiling (accepted October 27, 2026)

Implements the narrower limits from owner decision #10 as runbook step 4 (Jordan approved
the step on 2026-10-27). One optional per-run limit and optional per-model limits
(provider + model id) sit under the overall ceiling of ADR-0043. Each Settings save is an
immutable version of the whole set in `runtime_limit_changes` (migration 31) with a reason
and a `spending.limits_changed` audit event in the same transaction, taken under the
`runtime-ceiling` advisory lock and naming the version it replaces. Same audience as the
ceiling: only a signed-in human workspace owner. Every limit must be at or below the
ceiling in force when saved; dispatch checks the ceiling and the limits both, so a later
lower ceiling still wins. Limits count real (non-fixture) paid calls since the ceiling's
start date, exactly as the ceiling does (settled cost, held exposure while in flight or
unknown); ChatGPT-plan requests are subscription quota, not metered, and are not counted.
They apply to study calls too, and a final study attempt whose frozen cap exceeds the
per-run limit is refused before it starts rather than cut off part-way, and a per-run limit
cannot be saved below the cap an open final attempt already holds. The Settings view lists
runs and models from every workspace, like the ceiling; that fits the single-owner app and
must be narrowed if more than one owner is ever supported. Known lock-order gap (pre-existing
since ADR-0043): the study build path takes the audit-chain lock before holdBudget takes the
runtime-ceiling lock, the reverse of ceiling and limit saves; unreachable while final builds
are LIVE_DISABLED, and must be fixed before live final builds are enabled (fixed by ADR-0047). Safe default: no
narrower limits are set, so behaviour is unchanged until Jordan sets some; this work set no
amounts. Still future work from #10: per-user, per-task, provider-wide and recurring limits.

## ADR-0043 — Owner-set runtime spending ceiling in Settings (accepted October 26, 2026)

Implements owner decision #10's overall ceiling (tracking/OWNER_DECISIONS_2026-10-20.md);
Jordan asked for it in this pass on 2026-10-26. `config/spending.json` keeps the reviewed
starting value ($20, counted from 2026-10-20). A signed-in person who owns at least one
workspace may set a new overall ceiling in Settings, higher or lower, with a reason. Each
change is an immutable row in `runtime_ceiling_changes` (migration 30) plus a
`spending.ceiling_changed` audit event in the same transaction, taken under the same
advisory lock every paid dispatch uses to check the ceiling, and must name the version it
replaces (stale pages get VERSION_CONFLICT). The latest change is the ceiling in force;
with none, the configured value applies. Changing the ceiling never resets what counts
against it. Agents, system actors and workers have no route to it: the store refuses any
actor that is not a human workspace owner, and only browser sessions reach the API route.
Limits: the ceiling is deployment-wide, so in a multi-user hosted deployment any human
workspace owner can change it; per-user, provider, model, run and task limits and recurring
limits from #10 remain future work. No amount was changed by this work; the $20 ceiling stays
until Jordan changes it in the app.

## CW-01 console undertaking limit widened to any console host (provisional) — October 26, 2026

Jordan: "For now the limit can cover any console host." This supersedes the wording of the
earlier entry below ("shows human presence"). Per the CW-01 adapter design v1.3 note (J1),
the undertaking is collected through an interactive-console check run by the supervisor
(Node tty API, per-run console challenge). Any process able to host or drive a console,
including a pseudoconsole host such as an IDE terminal panel or an agent's terminal tool,
could supply it; the author is not authenticated, and
receipts say so. Accepted for the present design; the acceptance is provisional ("for now") and can be withdrawn; an
authenticated owner path would replace it. It grants no undertaking, implementation,
operational read, SQL, credential, cluster start/stop, launch or native-session authority,
and no model may run the undertaking step or type it. M3 unchanged and not reopened.

## CW-01 unauthenticated console undertaking accepted as a known limit — October 26, 2026

Jordan accepted ("I am okay accepting that as a known limit") the residual raised by the
CW-01 operational adapter design v1.2 note (G2): the six-item W1-W3 undertaking is typed
at an interactive supervisor console after admission, which shows human presence but
does not authenticate the author. Receipts label it owner_undertaking_console and state
that the author is not authenticated. This accepts a design limit only: it grants no
undertaking, implementation, operational read, SQL, credential, cluster start/stop,
launch or native-session authority, and no model may type the undertaking. M3 unchanged
and not reopened.

## CW-01 attestation-to-spawn bound confirmed (120 s) — October 26, 2026

Jordan confirmed "120 s is fine" for the CW-01 fixture core's owner-attestation
bound: pg_ctl's measured creation may be at most 120 s after the attestation's
affirmed_at_ms (LIMITS.attestation_max_age_ms in
scripts/theme-intent-cw01-core-fixture-v4.mjs, introduced in v3). This settles the
value flagged in docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REPAIR_2026-10-26.md and the
v4 repair; no code changed. It confirms a fixture-core parameter only: it grants no
attestation, SQL, credential, registry/pidfile/process read, cluster start/stop,
launch or native-session authority. M3 unchanged and not reopened.

## Theme acceptance field-limited reader preparation — October 24, 2026

Jordan selected “Prepare a field-limited reader for separate review” in this
conversation. This authorizes fixture-only preparation and review, not saved
studio.json/credential reads, operational OS observations or native acceptance.
Implementation/report: docs/THEME_INTENT_CONFIG_READER_PREPARATION_2026-10-24.md.
M3's previously accepted exact-bundle evidence standard remains unchanged. Any
future operational adapter/read needs concrete separate reviewed scope; fixture
projection cannot establish active home/workspace role/continuity or tool identity.

## THEME-ACCEPTANCE-M3-2026-10-24 — scoped scheduler evidence standard

Jordan explicitly selected “Accept exact-bundle configuration evidence for this
session” after Claude's exact-v3 review. For narrow theme-draft UI acceptance only,
a fresh installed match to reviewed studio.mjs SHA256
9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88
may satisfy the scheduler-configuration gate. This is an explicit evidence-standard
change, not observed live state, continuous prevention or exhaustive zero dispatch.
Worker remains on; current identity/continuity and all other gates remain. No
startup-admission candidate selected. Concrete inspection/session scope separate.
Canonical scoped statement: docs/THEME_INTENT_ACCEPTANCE_SCHEDULING_DECISION_2026-10-24.md.
No frozen study/protocol or wider policy change, operational read, activation or
launch is authorized. V4/proposal v2 prepared for separate independent review.

## Native acceptance readiness assessed; session remains blocked — October 24, 2026

Bounded repository-only reconciliation completed. No newer independent exact-v2
checklist review found in docs/tracking filename inventory and text search; original
review covers v1, revision is not independent, and supported v4 review covers helper
bytes only. No reviewer dispatched. Frozen checklist/helper/package/history preserved.
Actual schema29 installation and pre-UI receipts supersede v2's pending helper,
backup/install/migrate prerequisites; no repeat preparation/install is indicated.
Repository evidence check: 182 hash bindings, zero mismatches; 145 exact helper
bindings; 16 run-01 JSON receipts read; all114 business hashes preserved; migration
precedes observation. These are historical receipts, not fresh operational checks.

Readiness and proposed session scope:
docs/THEME_INTENT_ACCEPTANCE_READINESS_2026-10-24.md.
Evidence/reproducible repository-only check:
tracking/evidence/theme-intent-acceptance-readiness-2026-10-24/assessment-receipt.json
and assess.mjs. Native acceptance remains blocked by independent exact-v2 review,
unknown live scheduling state, named existing workspace/current owner-editor role,
continuity through first launch and a separate bounded session authorization.
Source defaults do not prove live scheduler state; worker starts on launch. UI-only
scope cannot establish raw hashes, post-UI database equality or exhaustive zero
dispatch. A v1–2/B v1 synthetic scope retains records by default; registry/shortcuts
need separate read-only scope; /NS skips creation; Jordan H remains separate.

No operational/credential access, launch/sign-in, acceptance writes, helper execution,
provider/workflow activation, recovery/stale release, cleanup or retired checkout
access. R/N/H remain unverified; full C54 partial. Next eligible: use
docs/THEME_INTENT_ACCEPTANCE_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md in a separate
review session. Resolve scheduling/continuity gates before requesting native session
execution. No automatic next milestone or authority granted by this assessment.

## Exact theme-intent installed and schema29 preserved before UI — October 24, 2026

Owner authorized next step after operational before completion. New exact /4 owner
install decision binds frozen candidate7100a039...8bc /plan27f79525...7a1, prepared
5bb69e60...ddf0d2 and reviewed145runtime map. Fresh admission passed with unchanged
schema28/predecessor/state/backups. Real NSIS3af2712c...6d834b ran /S /NS, exit0,
no timeout, completed2026-10-24T12:34:45.802Z (08:34:45EDT). Exact candidate migrate
applied[29] from28to29 and created its own verified schema28 migration snapshot.
Reviewed after passed before any desktop/UI launch: schema29 observed
2026-10-24T12:34:49.022Z; all114business table hashes, prior migrations, protected
files/config/products preserved. Parent rechecked full receipt/admission/installer/
migration chain and migration dump hash; exact installed native510b09...88ca9,
manifest5b38b4...eba6 and71runtime resources verified.
Operational cluster stopped normally. Host check pg_ctl status3, no configured-port
listener, no lease, desktop or runtime worker. No provider calls/workflow activation,
UI/acceptance writes, recovery or retired checkout access. Code/packages/reviews
unchanged; CurrentUser DPAPI used by reviewed wrapper only, no secret bytes logged.
Evidence: tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json
and shutdown-check.json; original session receipts and new owner-install-approval
under tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Prior before completion remains immutable history; installed state now supersedes28.
Keep schema28 snapshot and matching program together at private before backup;
coordinated rollback needs separate decision, never old binaries alone over29.
Real installation I is verified. Registry/shortcuts R, native UI N and Jordan human
acceptance H remain unverified. /NS skips shortcut creation. No operational restore
rehearsal claimed. Acceptance checklist v2 review/session scope still separate;
keep desktop quit until gates resolve. Next eligible: independent exact-checklist-v2
review alongside supported v4 helper, then scoped native acceptance decision.
No automatic acceptance/next milestone. FullC54 remains partial.

## Operational v4 before preparation completed — October 24, 2026

Owner authorized next step after exact-v4 independent support. Supported /4 review
validated with all145 runtime bindings; frozen package preflight passed. New session
operational-before-v4-20261024-01, evidence
tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Reviewed PS/CLI before exited0, fixture:false, provider_calls0. Actual managed
postgres/data schema28 observed;28migration rows and114table hashes. Dedicated
snapshot plus post-backup preserved-state checks/quiescence passed. Private backup:
C:/Users/jorda/AppData/Local/com.creatoragent.studio/backups/theme-intent-v4-operational-before-v4-20261024-01.
Database dump553996bytes; matching predecessor program78files, protected4files,
configured products tree0files. Helper verified dump list/hash and copy maps; parent
rehashed all copies/dump and prepared/before/backup receipt links. CurrentUser DPAPI
used only inside reviewed wrapper; no credential bytes logged/tracked. No restore
rehearsal performed on operational snapshot; dump-list/hash verification is distinct.
Prepared_at2026-10-24T12:31:01.322Z; prepared SHA256
5bb69e60eaae96a503368ef2bd9f7e61c9f40546825b893de4e1d44492ddf0d2.
Earliest backup/prepared15minute age deadline2026-10-24T12:46:00.939Z
(08:46:00.939 America/New_York). Admission must recheck freshness/unchanged state
and a NEW exact owner installation decision; age deadline is not admission approval.
Host final check:pg_ctl status3, no configured-port listener, no theme-intent lease.
Operational database and installed predecessor remain schema28; no install, migrate,
admit, recovery, stale release, provider/workflow activation or retired-path access.
Completion receipt and shutdown/owner provenance retained; prior failed v3 attempt
unchanged. Helper/plan/packages/reviews untouched. Native NSIS/registry/shortcuts/UI
and human acceptance remain unverified; acceptance checklist v2 review separate.
Next eligible: new exact installation/migration owner decision, fresh admission and
only then authorized install/migrate/after before any UI launch. If stale or state
changed, new before session/directories required. No automatic next milestone.
FullC54 remains partial.

## Development artifact retention mechanism — October 24, 2026

Retention is opt-in by marker and never inferred from directory names, so
historical evidence, recovery material and unknown directories cannot be deleted by
pattern. Frozen reviewed runners are not retrofitted (hash bindings); new runs mark
themselves via createOwnedRun(). Policy: passed 24h + latest 1, failed 14d + latest 2,
abandoned active treated as failed, protected/referenced always kept. Deletion
refuses links/junctions anywhere in a run and operational/broad roots. No automatic
or scheduled deletion.

## Installed acceptance checklist v2 revised; execution remains blocked — October 24, 2026

Owner authorized document-only revision following Claude's blocked checklist review.
New docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md preserves the original
plan and review. Incorporates A0–A13: exact candidate/plan/proposed-v4 map and review
binding; successful after/cluster-stop evidence before first launch with actual
v4 at/state.observed_at fields and operator timeline; control-window GUI-migration
stop; native sign-in/Quit; workspace/role/mutation scope; two-draft visible ledger;
clean-save version/activity check; pending-target semantics; retention by default.
UI-only observation chosen. Raw content hashes, whole-database equality after UI
activity and exhaustive zero dispatch are explicitly unverified. Plan declarations
are wiring, not measured dispatch. Worker startup/bookkeeping are explicit; no
worker-off control or live scheduler-off UI invented. Unknown runtime scheduling
blocks execution; stronger prevention/accounting proof needs a separate reviewed
inspection/control task. Real install, registry/shortcuts, native UI and Jordan's
human acceptance have separate I/R/N/H classes; historical fixtures are F.
All cases not-run. No operational data/credentials, helper, installer, app, provider,
workflow or retired path accessed/run. Only documentation/tracking/new planning
evidence changed. Original plan/report/receipt hashes preserved; all168 v4 repair
artifacts unchanged. Markdown formatting and case coverage checks pass. Evidence:
tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json.
Next: independent exact-v2 checklist review alongside resulting reviewed helper
identity. V4 helper review remains a separate gate; operational preparation, install/
migration and native acceptance still require their recorded gates and authority.
No automatic next milestone. No fresh operational backup from failed v3 attempt;
fullC54 remains partial.

## Native-layout helper v4 locally verified; independent review next — October 24, 2026

Owner authorized the next repair after operational v3 before failed. V4 preserves
v3 and frozen package/plan. Shared PGDATA is desktop-native postgres/data in normal
managed control, postmaster ownership inspection, stale data_dir binding/release
and coordinated recovery. Nested directory/no-links/PG_VERSION18 checks now precede
DPAPI. No flat fallback or data relocation. Versioned /4 authority/review/lease
contracts require a fresh exact independent review; v3 support does not cover v4.
Verified source-bound run:26/26 TAP tests (25scenarios+parent), guards11/11,0skip,
source maps unchanged. Independent fixture initdb uses nested layout; source-contract
guard reproduces v3 failure. Real wrapper rejects missing nested PGDATA while
synthetic DPAPI is unavailable. Before/death/stale-release, forward29 preservation
and coordinated28 recovery pass. Static package/PS parse/format/syntax pass.
First full run retained: two scenarios failed (23pass/3fail including parent):
missing synthetic studio.json setup, corrected in test only; transient EPERM on
fixture program rename during interrupted recovery. Exact-directory rename/back
subsequently succeeded, and unchanged runtime passed complete rerun. EPERM cause
unconfirmed, no production retry/gate relaxation; retain for independent review.
V2's162 and v3's161 artifact hashes unchanged. Disposable55455 summary stopped.
No operational configuration/credentials/database accessed in this repair; no NSIS,
providers/workflows, installed app changes or retired checkout access. Failed
v3 operational before still produced no fresh backup; installed schema28 remains
last verified status, not re-queried. FullC54partial. V3 low findings deferred.
See docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md and
tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/repair-receipt.json,
verified-{guards,e2e}-run.json/TAP and retained first-run failure evidence.
Next U02: fresh independent exact-v4 review of layout/pre-secret/stale/recovery
and failure evidence. Operational retry remains blocked until review support;
new session/directories/current authority required. No automatic next milestone,
installation/migration, recovery or release authority follows.

## Operational before blocked by native-layout mismatch — October 24, 2026

Owner authorized operational before preparation only. Exact frozen package preflight
and independent /3 review passed (145 runtime bindings). Actual reviewed v3 attempt
operational-before-20261024-01 exited 1: managed() reads postgres/PG_VERSION, while
desktop Home::pg_data (apps/desktop/src-tauri/src/home.rs:121) uses postgres/data.
Read-only inspection confirmed postgres/data/PG_VERSION=18; operational schema was
not queried. Wrapper decrypted CurrentUser DPAPI before this failure; no credential
bytes logged. No database start, snapshot, private backup, prepared receipt, install,
migration, providers or workflows. Empty run-01 evidence directory retained; lease
removed normally. Original reviewed v3 bytes and all historical evidence preserved.
The synthetic fixture layout mirrored the same wrong assumption, so prior passing
tests/review do not establish native layout compatibility. Operational preparation
is blocked despite historical supported review. See
tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json
and owner-before-authorization.json.
Next eligible U03: bounded versioned native-layout repair, actual-desktop-layout
fixture coverage (including stale/recovery paths), then fresh independent exact
review before a new operational before attempt. No install/migration authorization.
No complete fresh backup exists from this attempt; full C54 remains partial.

## October 23 v3 bounded stale-state release repair

Owner authorized repair of the v2 independent review's two Medium process-death
findings. Preserve reviewed v2; use separate v3 /3 formats/paths. Cleanup authority
must be distinct from install/migration/rollback, work before a prepared receipt
exists and require no credential decryption. Bind dead lease/PID/token and exact
home/config/data/session/evidence/review map; preserve retired and partial artifacts.
Serialize cleanup and normal phases with a parent-monitored Windows named mutex;
publish synced complete disk leases atomically. Tag owned PG startup transiently,
never stop merely because status says running, keep desktop/workers quit and retain
leases on uncertain cleanup. After/reconcile can resume forward under cleanup scope
without repeating effects. These host-specific helper choices change no product
stack or frozen package. Inner/outer explicit confirmations remain separate from
the real owner decision. /NS skips shortcut creation; native integration unverified.
Run receipts now bind before/after runtime+test hashes and TAP digests.25+8 local
tests pass (24E2Escenarios+parent,8guards); independent /3 support still required.
No operational action authorized/executed; fullC54 partial. See v3 report/receipt.

## October 23 upgrade-helper independent-review repair revision2

The owner authorized repairs after Claude blocked v1. Preserve v1 helper bytes and
its rejected review, including malformed original metadata; create a separate v2
implementation rather than rewriting that evidence. No package rebuild/source or
frozen-plan change. Review binds migration/pg dependency closure before importing
it; all phases require the exact v2 gate before DPAPI. Managed cluster ownership is
explicit and normal phases refuse an already-running cluster. Sensitive snapshots
belong in the studio backup tree; tracked evidence has hashes only. Backup directory
reuse is rejected. Freshness applies to admission, not post-effect verification.
Recovery is a separate exact decision, restores only within the unchanged upgrade
window, verifies populated schema28 on a new empty DB, retains failed state, restores
matching program/products/protected files and explicitly redirects config. Standard
shell integration uses the pinned predecessor installer; actual/custom shell and UI
acceptance are unverified. Fixture installers/clock/DPAPI decisions are test-only.
Local21+5 checks pass; no independent support or operational authority implied.
Next fresh U02 v2 review. FullC54 partial. See v2 report/repair receipt for exact scope.

## October 23 schema29-aware upgrade-helper preparation

Implementation choice within authorized preparation: separate exact-pinned helper,
not edits to frozen schema28 helpers/package receipts. Current createBackup and
checkBackup expect schema29 and cannot cover the predecessor unchanged. Use
supported pg_dump custom archive/exported snapshot + pg_restore TOC validation,
verified product/protected/program trees, and explicit
theme-intent-upgrade-backup/1 metadata. Do not imply compatibility with current
Restore Studio; coordinated empty-target PostgreSQL recovery is documented.
All existing public tables and migration ledger checksums are fingerprinted;
schema28 before and29 after are distinct. Unknown work, stale evidence, review or
approval mismatch and partial-attempt locks fail closed. Independent helper review
and new exact owner decision remain prerequisites, not approvals supplied here.
10isolated checks pass; implementation-involved self-review only. No operational
or provider action. FullC54 partial. See new helper report/evidence.

## October 23 theme-intent preparation implementation

The authorized first C54 gap uses an additive theme_intent record (theme-intent/1),
reusing existing versioned storage and permission paths rather than weakening the
frozen claim-backed SearchBrief/discovery contracts. Migration29 only expands the
record-kind constraint; test databases only. Research-plan preparation is a pure,
version/hash-bound read with zero execution exposure,not a grant or source claim.
Source collection and current parent-limit/sharing admission remain later gates.
No new dependency,provider integration or installed-app change. See implementation
report and exact evidence; separate code review precedes packaging/installation.

## October22 research packet confidence/provenance correction before outputs

Preserved v1 and prepared/reviewed additive v2:injection current-need confidence
permits exploratory/insufficient,not unsupportedwell_supported;observer label
attached only to its actual C1 claim.18substantive criteria/floor/bounds unchanged.
No historical regrade,productionpolicy change or live authority inferred.
See docs/DISCOVERY_RESEARCH14_V2_REVIEW_2026-10-22.md.

## October 22 additive packet correction after review

V1 input contamination/temporal ambiguity/over-specific conditional verdict were
found before provider outputs. Preserve v1 and use separately frozen/reviewed v2.
This corrects authoring specification, not model results or historical grades.
No floor/budget expansion; no live activation or policy change. Same intended
scenarios, not an independent sample. docs/DISCOVERY_SEMANTICS_V2_REVIEW_2026-10-22.md.

## October 22 local finding-semantics implementation

Owner continued the prospective correction. Implemented role1.4 prompt definitions
and authoritative per-proposal cheaper_test locally; schema and historical grades
preserved. No policy or research-protocol acceptance inferred, no installation/live
authorization. Prompt hash and executed checks in
docs/DISCOVERY_FINDING_SEMANTICS_IMPLEMENTATION_2026-10-22.md.
Affected independent review is next before a new evaluation binding.

## October 22 proposed finding-semantics clarification (not activated)

Prepared U03 prospective specification after separate seven-output review.
Recommend preserving schema compatibility, defining novelty as originality and
using the existing per-proposal cheaper_test field as authoritative. Unsupported
benefit belongs to weak_evidence. This is a proposed implementation direction,
not an accepted research-protocol change, live authorization or retroactive
regrade. Production remains role1.3; role1.4 is proposed only. Exact scope,
alternatives, version consequences and local verification plan:
docs/DISCOVERY_FINDING_SEMANTICS_PROPOSAL_2026-10-22.md.

## October 21 v5 provider-quota stop and restored owner cap

Executed owner-authorized two-slot amendment; first10 answers passed,11th provider
quota failure stopped suite. Restore40 as agreed; preserve provider quota exhaustion.
Local restore verification corrected its false assumption that restoring a studio
cap removes independent quota blockers. No repeated mutation, retry, quota reset,
wider account/credits fallback or hidden grade change. Research narrow qualification
does not qualify incomplete candidate/scoring or establish usefulness. Next offline
review; any further live evaluation needs provider availability/prospective scope.
See docs/DISCOVERY_V5_LIVE_RESULT.md.

## October 21 owner authorized two additional test slots

Explicit user instruction permits temporary daily cap40→42, enough for the existing
approved18-case v5 suite with24 requests in the rolling window. No other permission,
credit, timeout, retry, per-run budget or frozen criterion changes. Accept new exact
caps through owner API, preserve original plan and bind separate capacity amendment
19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d.
Restore40 after bounded attempt; no erased usage. No repeat approval required for
this instructed delta. docs/V5_TEST_CAPACITY_AMENDMENT.md records scope/receipts.

## October 21 v5 installation approved; capacity gate honored

Owner authorized exact reviewed v5 next step. Installed verified candidate and
preserved saved state. Do not start18-request suite with only16 daily slots; no cap
increase, splitting, retry or inferred provider quota. Existing scoped approval
persists for unchanged plan when fresh preflight passes; no repeated approval.
Capacity estimate8:38:49AM EDT is conditional on no new usage, not a scheduled
automation or authority to skip checks. docs/DISCOVERY_V5_INSTALLATION.md.

## October 21 repair candidate/fresh v5 preparation

Owner authorized preparation. Package tested stream and reconciliation repairs with
fresh author-created role1.3 packets, preserving v4 failure/reconciliation and all
prior locks. No frozen deadline/cap extension, retrieved answer or proven live root
cause claimed.75 checks pass; exact source/package bindings in v5 execution plan.
Current16 daily slots cannot admit proposed18-request suite; fresh capacity check
must pass without increasing limits. No installation/live dispatch in preparation.
Independent substantive review remains pending. docs/DISCOVERY_QUALIFICATION_V5.md.

## October 21 owner adopted ran-without-result reconciliation

After the explicit proposal, owner authorized next step. Recorded ran (observed
partial activity only), retained unknown-result metadata and historical timeout,
then closed v4 qualification failed at3/4held-out under frozen4/4 requirement.
No retry or provider request. Independent API/DB readback confirms zero unresolved
and unchanged24 requests. No recovered answer or substantive pass claimed.
docs/V4_TIMEOUT_RECONCILIATION.md records receipts and next candidate preparation.

## October 21 bounded stream-recovery repair

Owner authorized next recovery review. Correct reproduced stream framing/cap defects
without claiming they explain the live timeout. Require observed-output consistency
on reconciliation: cannot say did_not_run when positive output is recorded. Preserve
unknown until an actual owner decision; propose ran without usable result and failed
qualification closure, never reconstructed completion or automatic retry. Keep existing
caps/deadline/grants, no wider retrieval scope or invented recovery API.36 local tests
pass; saved state/install unchanged. See docs/PLAN_STREAM_RECOVERY_REVIEW.md.

## October 21 approved v4 timeout stop

Owner approved exact v4 candidate/suite. Install succeeded; five requests accepted,
sixth timeout unknown. Stop honored with no retry or later task class. Preserve
unknown and running qualification until evidence-backed owner reconciliation; a
provider response ID/partial stream does not certify a complete result. Do not turn
unknown into a model schema failure or count unattempted cases as observations.
No wider retrieval credentials, invented capability, budget change or automatic
rerun. Next bounded step is timeout/recovery/reconciliation review. See
docs/DISCOVERY_V4_LIVE_RESULT.md.

## October 21 fresh v4 preparation

Owner authorized fresh qualification preparation.18 new author-created packets use
role1.3 semantics and identity selectors; gold/control/reviewer criteria frozen
before target exposure. Pretarget draft corrections and failed harness checks are
retained; final45 tests pass. No independent review or live result is asserted.
Author-visible operational holdouts are not independent thesis tasks. Preserve
all v1–v3 results/locks; no automatic rerun or new installation. Exact candidate/
execution proposal is docs/DISCOVERY_QUALIFICATION_V4.md. No budget/cap/permission
or research-study protocol change. Approval and active-state checks precede activation.

## October 21 role1.3 and opt-in identity-bound checks

Owner authorized bounded implementation after audit. Explicit field semantics are
versioned1.3; no output schema, permission or budget relaxation. Optional selector
binds skeptic assertions to one supplied proposal and one matching finding;
ambiguous/missing targets fail. Without selector, retain legacy grading so frozen
v3 novelty failure remains failed and historical manifests retain exact hashes.
No substring-based novelty whitelist or retrospective coercion. Independent
substantive acceptance remains separate from structural/reference matching.
38 local tests pass including v1–v3 qualification invalidation for new role.
No install/live requests; fresh packets and concrete candidate proposal come next.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## October 21 role1.3 and opt-in identity-bound checks

Owner authorized bounded implementation after audit. Explicit field semantics are
versioned1.3; no output schema, permission or budget relaxation. Optional selector
binds skeptic assertions to one supplied proposal and one matching finding;
ambiguous/missing targets fail. Without selector, retain legacy grading so frozen
v3 novelty failure remains failed and historical manifests retain exact hashes.
No substring-based novelty whitelist or retrospective coercion. Independent
substantive acceptance remains separate from structural/reference matching.
38 local tests pass including v1–v3 qualification invalidation for new role.
No install/live requests; fresh packets and concrete candidate proposal come next.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## October 21 prospective assertion-semantics correction proposal

Owner authorized next bounded audit. Preserve every v3 grade and exposed output;
do not null-coerce its valid prose or special-case the returned sentence. Audit
all roles: exact-null novelty lacks explicit model-facing semantics; wildcard
presence cannot establish correct proposal/finding association or source entailment.
Propose explicit field meanings (new/custom software versus existing tools included),
identity-bound assertions and independent substantive acceptance. Retain legacy
scoring and frozen study protocol.72 offline probes document limitations without
new model calls.18 fresh scenario sketches are proposed only, not frozen packets
or dispatch authority. See docs/DISCOVERY_ASSERTION_SEMANTICS_AUDIT.md. Next eligible
is local versioned implementation/controls, then a concrete qualification proposal.

## October 21 approved v3 installation and bounded result

Owner approved exact v3 plan8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a.
Installed verified candidate and ran seven sequential plan requests before first
failure; no retry. Research qualified operationally; candidate failed exact-null
novelty assertion while production-valid prose denies originality. Preserve this
failure and every frozen file/lock. Do not equate schema compliance with usefulness
or representation-specific grading failure with fabricated novelty. Audit assertion
semantics prospectively across roles before proposing new qualification; no post-hoc
gate weakening or target-string special case. Independent substantive review remains
separate. No automatic workflow/search/build/pilot/live run. See
docs/DISCOVERY_V3_LIVE_RESULT.md and v3 execution-outcome.json.

## ADR-0042 — ChatGPT plan connection and Codex builder (accepted October 20, 2026)

Full record: [ADR-0042](ADR-0042-codex-integration.md); design and Jordan's answers
Q1–Q7: docs/CODEX_INTEGRATION.md; owner guide: docs/MODEL_CONNECTIONS.md.

Creator Agent may use Jordan's ChatGPT Plus allowance through Sign in with ChatGPT
(private client, `dynamic_agent_client` registration, PKCE, loopback callback). Path A:
direct Responses for general inference. Path B: Codex app-server 0.163.0 in a WSL2
bubblewrap jail for `code_build` only. Sign-in, credits-off confirmation, accepted
caps, per-model verification and per-task-class qualification are separate recorded
states; any missing one blocks inference. Credits after the limit stay off and are
attested by the owner with a date; there is never a paid API fallback. Unknown
outcomes block the connection until reconciled. Tokens live only in the control
process vault (DPAPI), never in the database, logs or the jail. "No command execution"
is enforced by hardened config, a relay tool allowlist that cuts the stream, an
app-server supervisor and the jail, and is tested against the pinned binary. The T12
build keeps its scoped patch tool, independent broker review and held-out checks.
Migration 26 (25 belongs to the §2.5 Brave work). Not activated: no registration,
sign-in, Codex install on Jordan's machine or model call happened.

## Page-navigation draft repair — October 20, 2026

Owner reported Tauri form text disappearing on page changes and requested retention
until submission or deliberate clearing, plus a clear-fields control. Implemented
current-workspace/session memory retention at the shared page boundary, with scoped
confirmed Reset page fields and remembered page locations; hidden polling is paused.
No persistent web-storage drafts/credentials, API mutation or data/schema change.
This is a bounded navigation repair, not complete durable draft/undo implementation.
Reload/workspace-change/restart retention is still a documented limitation; future
draft adapters must preserve sensitive-data isolation and evidence/version rules.
Checks and candidate hashes: tracking/evidence/page-drafts. Native acceptance pending.

## Owner acceptance — completion-runbook decisions (October 20, 2026)

Canonical record: [accepted #1–#52 and RD1–RD10](OWNER_DECISIONS_2026-10-20.md).
Jordan accepted the recommendation list and final revisions in chat, then requested
project-wide recording. This supersedes conflicting proposed defaults, including
ADR-0041's historical close-to-quit default: target is configurable close-to-tray
by default with first-close notice. Product ceilings are owner-adjustable, including
above $20; the current $20 allowance and separate $20 T15 cap are unchanged.
No universal three-repository cap; initial live verification is one private repo
under a concrete scoped grant. Full rationale, gates, accepted deferrals, model/file/
UX/pilot/distribution choices and research direction are in the register.

This records design and operating choices, not implementation completion, protocol
freeze, new spending, provider activation or publication. Existing config/evidence
remain authoritative for actual implemented state. §2.1 interactive acceptance and
new owner-default reconciliation remain pending; next eligible afterward is §2.2.

## ADR-0041 — Installed desktop studio: supervisor, storage and dependency ownership

October 20, 2026. Accepted before implementation of COMPLETION_RUNBOOK §2.1 by Claude
Code on `claude/project-thread-b82rw9` from main 54ce751 (content 5f7d224). No migration.
Owner approvals in force: Jordan requested a persistent installed Windows studio (§2.1),
the fresh `creator_studio` adoption (§1.2), the $20 runtime ceiling and T15 $20 total.
Everything else below is an implementation decision under that request, not an owner
approval, and is reversible by a later recorded decision.

The installed Tauri executable is the supervisor. It owns one Node child (bundled
`node.exe` plus a single-file service bundle) that serves the production UI, the API with
its in-process durable workflow worker, and the private preview origin on the existing
loopback ports 5173/4310/4320. Keeping one child keeps one workflow worker and the
existing lease fencing; a second studio is refused by a per-user named mutex, and a second
launch only asks the first to show its window. A Windows job object kills owned children
if the supervisor dies; the child also exits when its stdin closes. Before showing the
studio the supervisor verifies an HMAC over a fresh nonce from the web and API ports with a
per-launch secret sent over the child's stdin, so an unrelated process on an occupied port
is never trusted or shown. Restarts are bounded (3 in 10 minutes, backoff), then the
setup window shows an actionable failure with Retry. Quit asks the child to stop, waits
20 s, then terminates only that child.

Storage: a per-user directory (`%LOCALAPPDATA%\com.creatoragent.studio`, overridable
only by an absolute `CREATOR_STUDIO_HOME` outside OneDrive for acceptance) holds
`studio.json`, logs, backups, products and DPAPI-protected secrets. Nothing at normal
launch reads the repository. PostgreSQL stays authoritative. Two database modes:
`managed` — an app-owned PostgreSQL 18 cluster in the data directory, started with the app
on loopback and stopped only by the app that started it, using verified PostgreSQL 18
binaries the owner already installed (a managed prerequisite, not bundled); and
`external` — an existing loopback server reused through its URL, never started, stopped
or claimed. Adoption of the §1.2 studio is an explicit first-run action: back up
`creator_studio` and its products with the existing T17 backup format, restore into the
managed cluster and a new products directory, and require the existing restore
verification (schema, audit chain, artifacts, lineage, exact budget totals) before the
config switches. The source database and files are left untouched. Alternatively the owner
may select the existing server in external mode. Creating an empty studio is a separate,
explicitly labelled choice. Migrations run only after a recorded owner click, after a
verified backup, under the existing advisory lock.

Identity: the supervisor generates a random per-launch local-owner code passed only over
stdin and signs in by an explicit owner action, then sets the HttpOnly session cookie in
the WebView. The session token is stored with Windows DPAPI (CurrentUser), validated
against the server at each launch, and deleted when expired or revoked; reauthorization is
the same explicit action. Database credentials are DPAPI-protected too. Paired execution
worker credentials remain in memory (ADR-0028) until persistent worker identity is
implemented; it is not claimed here. No token in URLs, argv, logs or web storage.

Close behavior is a setting: `quit` (initial default) or `background` (window hides, a tray
icon remains, services and workflows continue). Launch at login is off by default and is
only written to the current user's Run key after an explicit setting change. These
defaults follow the handoff's conservative suggestion and are not the owner's choice;
first-run setup asks. No Windows service, scheduled task, or account change.

Amended October 27, 2026 (owner decisions #1–#2, PR #63): setup now preselects
`background` (the first close each launch explains it) and recommends a new, empty studio
on a new computer while still offering adoption. A saved choice is kept, so an install set
up earlier keeps `quit` until the owner changes it in the status window.

Rejected: a shortcut to the existing shell; starting or stopping the Docker development
container (it serves `creator_dev` too and is not app-owned); bundling an unreviewed
PostgreSQL distribution; separate API/worker processes (duplicate worker risk without new
fencing); automatic migration or adoption; plaintext token files. New Cargo features only
(tauri `tray-icon`, extra `windows` API features); no new crates or npm packages.

## ADR-0040 — Repair audit boundaries without changing owner authority

October 20, 2026. Jordan authorized repair of all four findings in Codex audit PR #40 and directed work to C:/dev/creator_agent. Migration 24; docs/AUDIT_FIXES_2026-10-20.md.

Keep QA expected outputs in the supervisor; mount only runtime inputs and reject legacy full cases. Stop persisting unauthenticated invalid-signature webhook requests; verified event receipts remain durable. Superseding ADR-0034's processor-read lock placement only, use a per-connection monotonic observation epoch: short begin transaction, bounded external read without a database connection, then financial-lock projection with current revocation/epoch checks. Older reads fail rather than overwriting newer state. Conservative conflicts across different objects require bounded caller retry; no automatic retry is introduced.

Stream batch results with byte/line/count bounds; keep unknown costs held on unreadable data. Journal input/output/error IDs before use and delete only after durable terminal reconciliation; failed deletion retries on polling. Explicit 48-hour input/output/error expiry covers abandoned uploads and unknown creation, with possible loss of result availability when the studio remains offline. This is an implementation retention default under the repair request, not a frozen study choice. No provider cleanup runs outside the existing scoped adapter credential.

Rejected: removing stale-read ordering protection, holding financial locks across network I/O, marking parse failures free, deleting evidence with unresolved billing, storing raw hostile request samples, or changing held-out expected cases. Historical audit and ADRs remain intact. No new dependency, activation or spending grant.

## ADR-0039 — Owner decisions after the 2026-10-20 audit: runtime ceiling, pairing limits, scheduler state, portfolio reinvestment, OneDrive move

October 20, 2026. Jordan's decisions on audit items N1, N2, N4, R1 and R2. Built by Claude
Code on `claude/audit-full-qgjinb` from main `fc1e83f`; migration 23.

Decision: a $20 overall ceiling on new runtime spending (config/spending.json, from
2026-10-20) is enforced in BudgetStore.prepareAttempt for every non-fixture paid call and
in StudyStore.holdBudget for final study attempts, under one advisory lock. Exposure is
settled cost plus held in-flight/unknown exposure plus open final study holds at their cap;
calls inside an open held attempt are not counted twice. Any unknown-cost paid call blocks
new paid dispatch. The T15 $20 total stays and sits inside the ceiling. Only a reviewed edit
of the config raises it; no budget, portfolio or reinvestment path can.

Pairing stays open to start and owner-approved to finish, with limits per visitor (5 new /
3 pending) below the server's (30 / 15) and the existing five-minute expiry. The visitor is
a per-process salted SHA-256 of the socket address, or of the last X-Forwarded-For entry in
hosted mode (the TLS proxy appends it; earlier entries are client-controlled).

The portfolio scheduler records each attempt per workspace and for the sweep, keeps an
append-only failure history, backs off from 30 s to 30 min and stops a workspace after 5
consecutive failures until the owner resumes it (audited). Health shows codes only.

Reinvested earnings never fund anything automatically. An explicit allocation with target
`portfolio` is recorded once per allocation and admitted by the portfolio envelope gate for
exploration and improvement lanes only, so the maintenance reserve is untouched; tranche
consumption still prevents spending the same money twice.

The OneDrive move is a script the owner runs: it refuses synced targets and dirty checkouts,
clones, saves stashes as patches, copies ignored private files with hash checks, verifies
the database, takes a backup and restores it into a scratch database. It never deletes the
old checkout. Rejected: auto-detecting and deleting the old folder; storing raw visitor IPs;
counting fixture amounts against the ceiling.

Consequences: costs outside Creator Agent (development tools, hosting, marketing) cannot be
blocked by code and stay a manual owner limit. Many distinct addresses can still reach the
server pairing limit; a hosted proxy needs its own rate limit. The move script has not run
on Windows yet.

## ADR-0038 — X10 readiness register, declared-workload benchmark and owner pilot gate

October 19, 2026. Jordan asked for X10 after Codex finished X08/X09. Built by Claude Code on
`claude/x10-1y6bd6` from main `a68e9f9`. ADR-0037 is the UX/UI redesign, so this takes 0038;
no migration (the benchmark found no bottleneck that needed a schema change).

Decision: full-product readiness is a checked register, not prose. `config/readiness.json`
holds one row per requirement C01–C51 and per integration, with six separately recorded
states (implemented, fixture, contract, live, activated, native), the states each row
requires, evidence paths and what blocks it. `pnpm readiness` checks it against the
requirement table and the files on disk and refuses a verified state without evidence,
a later state without its earlier one (activated without live, live without implemented),
a missing or duplicate row, and a not-ready row with no blocker. The verdict is READY only
when every required state is verified and the owner pilot is completed with evidence.

The owner pilot is a gate, not a run: `config/owner-pilot.json` starts with every owner
choice empty, and `pnpm readiness pilot-check` refuses until Jordan records the decision,
an exact nano-USD budget, a spend stop at or under it, failure and owner-time stops,
stop-on-unknown-cost, a future window, schedules, platforms whose backing integration is
ready, and accounts that are both live-verified and activated. No account qualifies today.

The benchmark (`pnpm bench`) creates and drops its own database, seeds through the audited
store and fixture broker (no SQL shortcuts around the hash chain), and times the owner HTTP
API with one sequential client. Results are labelled synthetic; the 2 s search and 5 s event
targets are reported as provisional. `scripts/release-archive.mjs` binds a `git archive` tar
to its commit by per-file sha256 and Git blob id.

Consequences: the report says NOT READY while live/model/hosted/payment paths and the pilot
remain unverified, and it cannot be talked into READY without evidence on disk. The register
is hand-maintained: a row is only as true as the evidence it cites, so review it on each
milestone. Single-client latency says nothing about concurrent users.

## ADR-0036 — X09 bounded portfolio policy and reviewed task knowledge

October 19, 2026. Jordan authorized X09 after X08 and reported Claude's parallel
UI/UX work. X08 was hash-checked and preserved as local commit `64596ef`; X09 is
on `codex/x09-portfolio` in the same managed checkout. No push or changes to the
original dirty X05 checkout. Claude's shared styling remains separate.

Keep PostgreSQL scheduling beside the existing durable workflows and brokers;
do not introduce another scheduler service, paid adapter or credential path.
Migration 22 stores versioned owner policy, immutable run lanes and schedules,
deduplicated job intents, health and knowledge provenance. Source refresh uses
the existing source policy/admission; reviews create existing bounded workflows;
health rehashes exact artifact bytes and claims archive integrity only.

Reserve real maintenance authority in an existing period child of the configured
global envelope. Existing journal/ancestor accounting remains authoritative.
Improvement and exploration retain separate run allocations; non-maintenance
calls cannot spend the maintenance subtree. A depleted/expired reserve, due or
unfinished maintenance, unresolved health, review backlog, capacity and explicit
normal/conserve/maintenance_only/paused modes constrain shared dispatch. Study
attempts retain their frozen conditions and do not inherit portfolio changes.

Coalesce outage intervals into one current job; never enumerate missed slots.
Use a workspace cooldown, per-pass cap, one open job per schedule and stable
effect/idempotency IDs. Unknown outcomes occupy capacity and require read-only
reconciliation, not redispatch. Missing durable effect receipts fence delayed
dispatchers. Cancellation marks the schedule and cancels its dedicated run;
already-dispatched observations remain recorded. Optional API polling is off by
default and was not activated. Policy budget identities are fixed in this version;
budget rotation into different identities requires a new workspace.

Use bounded task guidance and artifact/source locators for reusable components,
lessons, prompts and skills. This is not an executable skill installer or a
system-policy loader. Proposals cannot change permissions, credentials, finance
or evaluation holdouts. Require executed structural renderer regressions bound
to the exact content hash, then human review and explicit activation. Regression
evidence records what was checked, not empirical output-quality gains. Rollback
selects a still-reviewed version using expected-head concurrency. Revocation and
stale provenance fence future workflow dispatch without changing immutable task
history. Workflow knowledge bindings retain exact candidate versions/hashes.

Owner feedback uses existing Gallery records; portfolio backlog counts those
unresolved submissions and pending decisions. An explicit hash/identity-bound
owner health deferral preserves the failed report as `owner_deferred`, never as
a successful check. No profit threshold or fixed production quota is introduced.

See docs/X09_PORTFOLIO.md and tracking/evidence/x09. The new Portfolio screen
requires only an import/view case in main.tsx and a view tuple in ui.tsx;
shared CSS and existing component props remain unchanged for Claude integration.

## ADR-0035 — X08 immutable campaigns and local fixture delivery

October 19, 2026. Jordan authorized X08 and stated that Claude is working on
UI/UX. Codex uses a separate managed checkout from current main `0dfc6e6`, branch
`codex/x08-marketing`. Original X05 edits and Claude's redesign remain separate.

Use deterministic templates over registered current verified artifact manifests
instead of a marketing model/provider. Closed factual claims name recorded package
checks, commit, execution ID, input hash and manifest hash; retain limitations and
synthetic labels. This provides inspectable evidence without introducing new paid
inference or claiming validated utility/demand. Arbitrary capability claims,
testimonials and customer/traffic counts are outside the draft contract. Audience
provenance and hypotheses are explicit owner assertions. A new draft, with its own
grant, is required after content/audience/experiment changes.

Migration 21 stores immutable campaign content and observations, human-owner
grants, workspace suppression, pre-adapter intents and native local receipts.
Grants bind the complete request/content hash, expiry and delivery cap. Reserve
one slot before dispatch, with no refund after uncertain/failed attempts. Monetary
adapter exposure is exactly zero because only a transactional local fixture sink
exists; host compute is unmetered. No live channel, paid-ad adapter, credentials,
real address, outbound message or public unsubscribe endpoint is implemented.

One workspace lock serializes admission, suppression, revocation/cancellation,
caps and local acceptance. A spec lock prevents candidate revisions/registration
from racing evidence checks. Unique campaign/recipient identity prevents retries
from creating another delivery. Unknown outcomes are reconciled through immutable
native receipts without resend. A missing receipt is definitive only for this
transactional local sink, never for an external service. Terminal state fences a
delayed dispatcher. All commands retain audit/outbox events.

Record synthetic feedback against an acknowledged fixture delivery and frozen
metric, with stable deduplicated event identity. Counts are fixture observations,
not market validation. Stop rules are explanatory; actual bounds are caps,
expiry, exact audience, once-per-recipient admission and cancellation. There is
no automatic experiment loop. Real distribution needs a separately implemented,
verified and authorized adapter; hosting/payment prerequisites remain applicable.

New UI is isolated in `marketing.tsx`; shared changes are one import/case in
`main.tsx` and one view tuple in `ui.tsx`. No shared CSS or public component prop
changes. See docs/X08_MARKETING.md and tracking/evidence/x08.

## ADR-0037 — Dark-default studio theme, semantic tokens and grouped workspace shell

October 19, 2026. Owner handoff (docs/CLAUDE_UX_UI_HANDOFF.md on the owner's machine) authorized a
UX/UI redesign of `apps/web`, which is also the desktop view. Dark is the default on every load,
including a light OS theme, superseding the earlier optional-dark-theme default; light is an
explicit saved choice. A classic `public/theme-boot.js` sets the theme before the stylesheet and
app run, so first paint is never white. Colours are semantic custom properties; components use
tokens only. Navigation is grouped (Studio, Evidence, Oversight, Build and study, System) in a
sidebar that becomes a drawer at 860px; route hashes, view keys and labels are unchanged.
Rejected: a component or CSS framework (dependency churn and overlap with the parallel X08 work);
following the OS theme (contradicts the owner's choice). `useRoute` now drops a view's late focus
request after the user leaves it (fixes being pulled back). No API, gate, session or CSRF change.
Numbering: if Codex's X08 lands first with ADR-0035, renumber this entry rather than X08's.
See docs/UX_UI.md.

## ADR-0034 — X06/X07 audit repairs and conserved processor identity

October 19, 2026. Owner authorized audit, repairs and strong scoped improvements.
Migration 20 permanently reserves each Stripe account identity and allows only one
processor funding rail per connection. This prevents economic double counting;
revoking a connection does not authorize re-registering its old financial history.
Existing duplicates block migration pending reconciliation, rather than rewriting
immutable records. Multiple fixture connections remain independent simulations.

Processor reads now run under the workspace financial lock and a connection row
lock, followed by atomic snapshot/projection writes. This supersedes ADR-0033's
outside-transaction read choice: that choice admitted stale observation ordering.
Bounded HTTP timeouts limit lock exposure; model/action authority is unchanged.
Account binding is checked against the current credential for each operation.
Incomplete loss histories are refused; bounded pagination is deferred. Failed rail
refresh invalidates availability instead of relying on an older balance TTL.

Hosted build exclusions, owned product storage, PostgreSQL 18 backup client,
service limits/log rotation and correct nested-budget metrics are preparation,
not hosted activation. See docs/X06_X07_AUDIT.md for reproduction and limitations.

## ADR-0033 - X07 payments, entitlements and reinvestment: backend reads, economic keys, tranche-bounded budgets (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X07 (prerequisites T17 and integration infrastructure; X05 and X06 not required). Branch claude/x07-5zm23m from main 4fe3d33. Migration 19 and this ADR number leave migration 18 and ADR-0032 to X06, built in parallel and merged first; this branch merged main afterwards and orders 18 before 19. X07 stays partial: no live or test-mode processor call, account or credential exists.
- Processor: Stripe chosen as the default test-mode adapter (reversible; the owner has not named a processor). Webhook scheme checked against docs.stripe.com on October 19, 2026: `Stripe-Signature` with `t` and `v1` values, HMAC-SHA256 over `t.raw-body`, 5-minute tolerance. Only `sk_test_`/`rk_test_` keys are accepted; live keys are refused before any call. No API version is pinned. Rejected: trusting webhook bodies, live mode, wider credentials.
- Payment connections, and therefore all payment data, exist only in fixture workspaces. Test-mode money is not money, so it never funds real budget envelopes. A real workspace needs live activation, which is a separate owner decision and is not built.
- Authority comes from backend reads only: a verified event names an object, the service reads it from the processor outside any transaction, and the store records that snapshot. An unreadable processor makes the delivery fail with 503 (retry) and records nothing as money. The checkout return page is inert.
- Ledger: immutable double entry separate from the budget journal, keyed by economic transaction (`connection:object:charge|settle|refund|dispute|payout:id`). Reconciling a snapshot brings each key to the processor's state with an original or a balanced correction entry; a deferred trigger rejects unbalanced entries. Event ids are de-duplicated as well, but economic keys are what stop double counting.
- Entitlements are derived from the snapshot (exact price, USD, offer metadata) and bound to one artifact manifest by id and hash. Refund or lost dispute revokes for good; an open dispute suspends.
- Reinvestment: one tranche per settled payment with the policy's basis points frozen at settlement and a holdback (30 days with no policy). Allocation capacity is the least of eligible tranches, surplus after operating costs and earlier reinvestment, usable liquidity of fresh available funding rails minus reserve, open commitments, unspent reinvested authority and outstanding losses, and the period cap. Allocations hold a per-workspace advisory lock, consume tranches oldest first (partial use keeps the remainder) and fund a new root envelope journalled as `fund`. Seed funding, pending funds, payouts and forecasts never count.
- Later losses lower a tranche's cap (never raise it). Consumption above the new cap becomes a reinvestment loss: idle reinvested envelopes are closed newest first and their remainder reopened as a smaller successor; otherwise new allocations are frozen until the loss is reclaimed or repaid from new eligible earnings. Rejected: editing envelope caps (they are immutable by design since T04).
- Rollback: revert the commit and drop the migration-19 tables. The only change to existing code is `BudgetStore.journal` becoming protected and the API's store class moving one level up the chain.

## ADR-0032 - X06 explicit hosted mode, environment-labelled databases and build-bound verification

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X06; branch claude/x06-j2pz5g from main 4fe3d33 (X05 merged). Migration 18 (X05 used 16 and 17; X07 takes 19). Prerequisites: T17 (backup/restore, health) and X05 (paired workers, for hosted-to-local pairing). Checked on local PostgreSQL with hosted processes on loopback behind a stand-in proxy; no hosted environment, DNS, certificate, managed database, identity provider or alert channel exists, and no live verification is recorded.
- Hosted is an explicit mode (`CREATOR_DEPLOYMENT_MODE=hosted`) with environments `test`, `staging` and `live`; local stays the default and unchanged. Hosted startup refuses: missing build commit, non-https or path-bearing public origins, a preview host equal to or a parent/child of the web or API host (cookie isolation), a relative product root, a missing metrics token, development login or insecure cookies, a web origin that differs from the OIDC web origin, no database, and a non-loopback database without `sslmode=verify-full`. Rejected: inferring hosted from a non-loopback host (an accidental exposure would silently change the security model).
- Secrets: generic `NAME_FILE` loading for `CREATOR_*`/`OPENAI_*` variables (Docker secrets/systemd credentials), both forms refused; values never enter the configuration hash, logs or status. Rejected: a secrets service client (no provider chosen; files work with every host).
- Environment separation is enforced by the data, not by naming: `deployment_identity` labels each database; API and worker claim an unlabelled one and refuse another environment's. Restores keep the label; relabelling a restored copy is audited and relabelling into live is refused.
- Verification is owner-recorded, append-only and bound to commit, configuration hash and schema: a smoke report (read-only checks of the declared public target) plus the server's own readiness. Any change makes it `stale`. A passing live record needs a typed confirmation of the exact build, also enforced by a database check. Readiness never reports live as verified otherwise. Rejected: self-declared verification via environment variables (not evidence).
- Observability is pull-only: `/api/ready` (public, terse), `/api/ops/status` and Prometheus `/api/ops/metrics` (owner session or read-only scrape token), `/api/ops/uncertain`. Alerts are local rule evaluation with delivery fixed to `none`; sending alerts anywhere is an outbound integration needing its own decision. Unreachable local workers are reported and never fail readiness.
- Backups now dump inside an exported snapshot and record counts plus lineage fingerprint and exact budget totals from that snapshot; restore requires exact equality (pre-X06 backups keep the at-least count rule).
- Cleanup removes only expired sign-in material past `config/operations/retention.json` (unreferenced sessions, OIDC states, pairing challenges), dry run by default, audited when applied. Records, audit history, budgets and artifacts are never cleaned.
- `deploy/hosted/` is reviewable configuration (Dockerfile, Compose per environment, Caddy with separate preview host, env examples without secrets); validated with `docker compose config` and `pnpm ops config-check` only, never built or run.
- Rollback: revert the commit; drop `deployment_verifications`, `deployment_identity` and their triggers. Earlier backups remain restorable.

## ADR-0031 - verified editor exports and explicit Windows activation

October 19, 2026: the native editor action initially launched no visible document,
confirmed by the owner. Direct AppData cache paths produced Notepad path errors;
the internal Windows cause is unconfirmed. Export only the last receipt-verified
manifest to a unique Downloads/Creator Agent source directory, verify those bytes
again, then activate fixed packaged Windows Notepad through
IApplicationActivationManager.ActivateApplication with a quoted UTF-16 path.
Pin the Windows API crate to 0.62.2. No arbitrary editor/program command, file
association fallback, source extraction or generated execution. Missing packaged
Notepad produces a visible failure. Export edits do not change the dated cache.
Ancestor reparse checks retain the existing owner-controlled filesystem
assumption; no protection against concurrent owner-privileged replacement claimed.
Final native screenshot showed the exact selected manifest; stale Notepad UIA
document text was not accepted as evidence. Rust tests verify cache preservation,
fresh copies and changed-source refusal. This supersedes prior pending editor
acceptance only for the observed local Windows host.

## ADR-0030 - explicit local NSIS packaging and manual rollback

October 19, 2026: pin Tauri CLI 2.12.3 and opt-in NSIS packaging for the existing
local-client shell. Current-user installation, existing WebView2, no hosted service
or worker installation. Refuse silent downgrades; explicit rollback is uninstall
and reinstall of a prior client, not rollback of authoritative data/schema.
Automatic updater/artifact signing remains disabled without configured keys and
release authority. Acceptance installs only a separately named/identified debug
fixture in a checked workspace directory, no shortcuts, and uninstalls it. Real
Windows WebView startup is observed after install/upgrade/rollback. Production
signing, rendered UI/editor and other supported-host claims require their own
acceptance. Default Cargo configuration keeps bundling disabled.

## ADR-0029 - scoped local paired execution

October 19, 2026: X05 reuses the reviewed execution supervisor. New explicit pairing
is required for artifact.run; owner jobs pin catalog manifest/archive and current
recipe/policy/bridge hashes. The local product root is owner configuration, never
job input. Admission is awaited after durable local intent and before dispatch.
One attempt per request; 10-second leases; 20-second/256 MiB/no-network limits;
one unresolved job per workspace, three globally, twenty hourly. Local compute
billing stays unknown. Expiry after start is reconciling, never queued again.
Reconciliation binds an independently observed stopped local outcome hash;
worker claims cannot verify QA. Presence pairing grants controls without execution.
Remote artifact synchronization, automatic retry, background installation, updater
activation and hosted pairing are outside this local implementation.

## ADR-0026 - X03 search, lineage and audit questions (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X03; branch claude/x03-s7po1x from main d2c8ef1. Migration 14. X03 is fixture-verified: no real embedding model is verified, so real workspaces refuse semantic search; no live call and no spend.
- Lexical search (T09) gains `code_version` (artifact commits and manifests), `model` (models called, exact totals) and `cost` (broker reservations with amounts), local-date filters read in an IANA zone, per-hit local time, and per-type coverage (searchable, redacted, no text, unsupported or oversized media) with activity freshness. The search transaction is read-only after the membership check. Rejected: a separate search engine (PostgreSQL full text over the same rows keeps one access path and no copy of redacted text).
- Natural-language audit questions compile into one plan from a closed list of intents with typed parameters; each intent has fixed, parameterized SQL in the application. The local rules compiler is free and deterministic; a model compiler is one metered broker call whose JSON must pass the same strict schema (any extra key such as `sql`, or an unknown intent, is refused before anything runs). Plans run in a read-only transaction with a 5 s statement timeout and limits of at most 200 rows. Rejected: text-to-SQL with a read-only role (model SQL could still read across workspaces or leak redacted history through joins; the prompt forbids executing model SQL).
- Permissions come before snippets and aggregation: every read checks membership first, so a removed member (new `removeMember`, audited `member.removed`, last owner kept) gets `NOT_FOUND` from search, saved queries, questions, semantic search, lineage and export verification. Saved queries store a request, not a permission, and run under the caller's current access.
- Semantic search embeds only candidates from an access-safe lexical stage (never redacted text), one `model.embed` broker call per text with a derived logical operation id, so a repeat replays without paying. Embedding models allowed per workspace mode are dated config (config/search/semantic-models.json); none is listed for real workspaces. Embeddings are not stored. Rejected: a persisted vector index (it would keep derived copies of text that redaction must then chase).
- Costs are summed once per reservation over a distinct set of runs (runs `part_of` a subject or its descendants, plus runs that froze specs for its builds), so a run shared by two products appears in each product's row but once in the combined total. Unknown charges are reported apart from incurred ones.
- Lineage graphs are bounded (depth 1-8, at most 500 nodes) with truncation flags; redacted records are tombstones; sources show whether their media was readable. Exports carry the SHA-256 of the canonical graph; verification reports tampering, missing records, version changes, redactions since export (and whether the export still holds the redacted title) and retracted links.
- Rollback: revert the commit and drop the migration-14 table, function and index; no existing table changes.

## Owner research decision - RD6 model preference and T15 budget

- Date: October 18, 2026. Jordan selected GPT-6 Astra and a $20 USD total live
  budget for T15. Includes child work, retries, tools and reviews; not per run.
- Actual accessible API identifier, pricing and budget enforcement must be
  verified/configured before dispatch. No model availability is asserted and no
  alternative model is authorized by this choice.
- Recorded in docs/PILOT_AND_PROTOCOL.md. Remaining protocol gates still apply;
  this documentation update did not freeze the protocol or activate live calls.

## ADR-0027 - X04 scoped GitHub management: verified owner, intent journal, exact-head merges (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X04 if it neither depends on nor conflicts with X03 (it does neither: prerequisites T13 and policy/broker coverage). Branch claude/x04-gm7n32 from main d2c8ef1. Migration 15 and this ADR number leave 14 and ADR-0026 to X03, built in parallel; whichever merges second renumbers if needed. X04 stays partial: no live GitHub call, credential or repository exists.
- Auth checked against docs.github.com on October 19, 2026 (REST API version 2026-03-10): per-endpoint permissions in docs/GITHUB.md. Two credential kinds, each a reference to an API-process environment variable: a GitHub App installation (recommended; tokens minted per call for one repository and that endpoint's permissions, one-hour expiry) and a fine-grained token with an owner-recorded expiry. Fine-grained tokens cannot call the Checks API, so their merge gate sees commit statuses only and refuses merges whose required checks are check runs. Rejected: classic tokens (all repositories), and any fallback to another credential or to an environment-chosen API host.
- A connection names the owner by immutable id and type; it activates only when the credential's account matches. Repositories are tracked by immutable GitHub id and owner id (names follow renames); another owner or public visibility quarantines a repository permanently. Existing repositories are outside scope unless listed by id; a listed repository that is public is quarantined, not used.
- Four action types (github.repo_create, github.write, github.workflow_change, github.merge), all external effects, admitted per operation with the operation's intent hash as spec_hash, so an approve-once covers exactly that change. Workflow-file pushes are their own action type. Rejected: entity records per operation (would need an entities kind change likely to collide with X03).
- Every mutation is journalled before the call (dispatched), settled once (succeeded, failed, unknown), and unknown outcomes are reconciled by reading GitHub, never by repeating the call; the same intent and any repository creation are refused while unknown. A database trigger enforces the state machine.
- Merges need the live head to equal the reviewed head, an approving review of that head by someone who did not push it, and every connection-required check succeeding on that head; the merge call carries the sha so GitHub refuses a moved head. No required checks means no merges.
- Webhooks are verified (X-Hub-Signature-256, constant-time), recorded, deduplicated by delivery id and only ever remove access. Live use needs CREATOR_GITHUB=live plus grants; fixture and live connections are confined to fixture and real workspaces.
- Store placement: GitHubStore sits between ArtifactStore and RoutingStore so the top of the store chain (which X03 extends) is unchanged.
- Rollback: revert the commit and drop the migration-15 tables; no existing table changes. The four new action types only appear in grants that name them.

## ADR-0025 - X02 context packs, result cache, compaction and batches (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X02; branch claude/x02-b3wzes from main c738369. Migration 13. X02 stays partial: every capability for a real model is `documented`, so only fixture workspaces exercise caching, batches and provider features.
- Context packs are immutable and hashed. The application derives the authority item from the run's active grants (it grants nothing); callers may pin only constraints, objections and acceptance criteria. Pins and the authority item render first so the provider-cacheable prefix is stable. Missing, removed or over-class pins, pins over budget, and required facts absent from the selection refuse the pack. Rejected: letting a model choose what to keep (survival must be checked by code).
- Every compaction (extractive, model, provider) passes the same check: each pin verbatim and every required fact present, or the result is recorded as rejected with what was lost. Model compaction is one broker call whose recorded request hash must equal the request the store rebuilds. Provider compaction is refused unless the capability is usable here, and as `output_unverifiable` when the provider's output is opaque (OpenAI documents an encrypted compaction item) while pins or facts must survive.
- Two caches, kept apart: provider prompt caching is measured only from provider (or fixture) usage records; the application's result cache stores the recorded answer of a settled, succeeded call of a metered read-only action. Keys include workspace, project, data class, action, tool, model, pricing hash, input and pack hashes, output limits and policy version. Entries record dependency hashes; a changed dependency invalidates for everyone, a caller's max age only for that caller; answers built on already-stale packs are not stored. Every hit re-runs admission under current grants and run state; study runs never read the cache. Rejected: caching any non-metered or mutating action (the contract has no such action type, so an external mutation cannot become a stored permission).
- Handoffs carry their pack's pins and required facts forward. The summary is reused only while its source entries are unchanged; facts that no longer hold refuse the next pack rather than disappearing.
- Capabilities are a versioned config per model and feature (`fixture`, `documented`, `verified`, `unsupported`, with source and evidence). Real workspaces use only `verified`, fixture workspaces only `fixture`. A batch capability names its own batch price snapshot (gpt-6-astra: 50% of Standard, from the official model page) and a batch must use exactly that price.
- Batches reserve every item before submission (all or nothing) and hold reservations for the completion window. Per-item request errors and documented expiry release; anything uncertain is `unknown`; a later result settles late exactly once. Batch status is derived from item reservations, not the provider status alone.
- Evaluations compare a baseline and candidate pack on questions with checks fixed at creation; total cost adds the compaction calls that produced the candidate. A quality drop beyond `max_regression` reports `not_claimed_quality_drop` before any cost claim; fixture results are `not_claimed_fixture`.
- Rollback: revert the commit and drop the migration-13 tables; no existing table changes.

## ADR-0024 - X01 model registry, route policies and held-out promotion gate (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X01; branch claude/x01-qfktko from main 8c09748. Migration 12. X01 stays partial: its prerequisite "measured task outcomes" does not exist yet, so every qualification is fixture evidence.
- The registry is a versioned config file (config/routing/model-registry*.json) registered per workspace; each entry stores the canonical hash of its pricing file, so a decision's pricing hash proves which price it used. Real registries hold only `documented`/`verified` models and fixture registries only fixture models. Only `verified` (accessible API id plus evidence) routes in a real workspace; gpt-6-astra is `documented`, so real routing is refused until verification is recorded as a new registry version. Rejected: probing the provider for availability at decision time (a live call nobody authorized).
- Policies: fixed (never substituted), auto (best held-out accepted rate, then cost), economy (lowest cost per accepted result at or above a floor, otherwise the reference baseline), each versioned per workspace or project. The owner's reference model is always the baseline and the only model qualified without a promotion.
- Promotion is the only path to qualification: criteria are fixed and hashed at creation; the store scores held-out benchmark cases from the broker's own reservations (callers cannot submit results); then shadow (never served), a deterministic capped canary (at most 1/4), and owner advancement that cannot override a failing gate. Canary or post-promotion outcomes below the floor roll back automatically; owners can roll back any active promotion. Rejected: model self-confidence or self-reported success as a gate (the outcome contract has no confidence field).
- Cost per accepted result includes failed attempts, review, repair and tool operations named on the outcome (same run only), divided by accepted results; unknown exposure is reported separately. Savings are `measured` only in a real workspace with fully known costs; fixture evidence is `not_claimed_fixture`.
- Escalation requires a recorded objective failure, happens once per decision, and goes to the reference baseline; if the baseline failed it is refused for a person to decide.
- Routing is opt-in per call (decide, then call under the decision). Existing workflow, study and builder paths keep their frozen models, so T15 study configuration is unaffected.
- Rollback: revert the commit and drop the migration-12 tables; no existing table changes.

## ADR-0023 - T16 analysis pipeline over T15 exports, verified on synthetic fixtures only

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to build T16 with empirical data collection deferred; branch claude/t16-analysis-95avhe from main 479dba4. No migration. Empirical T16 stays blocked.
- Inputs are only the files a T15 run writes (evaluation-package.json, private/assignment-key.json, private/raw-exports) plus reviewers' ratings.csv and an optional analysis-options.json. The analysis is pure (domain) and needs no database, so it reproduces from exports; each input file's SHA-256 is recorded and two runs must hash identically. Rejected: reading the database directly (results would depend on live state rather than the frozen package).
- Empirical status is derived, never asserted: `final_records` only for a final package under an adopted freeze with non-synthetic exports and no FIXTURE.json. Fixture outputs carry the label in every CSV row, figure banner and report.
- `ANALYSIS_PLAN` is an implementation default (task as unit; last attempt per slot for outcomes, every attempt for resources; complete reviewer rows only, no imputation; discovery repeats averaged within theme; range/median/sign counts always, bootstrap over tasks only with 10 or more pairs; quadratic-weighted kappa for two reviewers). It is not an owner decision and should be adopted or replaced in the freeze.
- No decision acceptance rule exists, so cost per accepted decision outcome stays undefined until Jordan supplies one (`decision_min_mean_rating` with its basis). Implementation acceptance is submitted with every executed frozen case passed. Zero accepted means undefined cost per accepted outcome with total spend shown; unknown or in-flight billing marks it a lower bound.
- Reconciliation checks fail the run when an attempt appears in two slots or exports, when flow and export measurements disagree, or when group, flow and export spend totals differ. Privacy check fails when a participant code, actor id, familiarity note or the blinding secret appears in output. Not measured: potential benefit, observed user impact, intervention necessity coding.
- Rollback: revert the commit; nothing persistent changes.

## ADR-0022 - T15 prerequisites: final-record gate, study budget ledger and builder-backed study attempts

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to complete T15's prerequisites without running the study or freezing the protocol; branch claude/t15-hdrwqz on top of ADR-0021. Migration 11. T15 stays partial.
- Owner choices recorded, not decided here: `config/evaluation.json` keeps the owner's `gpt-6-astra` preference (verified id null, live dispatch off) and Jordan's $20.00 total T15 cap (stated October 18, 2026; no spend authorized). Participants (RD3), reviewers (RD4), human-subjects review (RD5) and final tasks (RD8) are `unresolved`. RD6 must still be answered in the freeze; the gate requires the study cap to equal the $20 config cap.
- Final records: `synthetic` is now a boolean. `synthetic: false` passes only `finalRecordBlockers` (domain): real workspace, adopted freeze hash, every governance choice equal to the owner's freeze answer, preserved model preference with a verified id equal to the config and study model, $20 ledger cap. Final attempts get real-mode workspaces and no model grant; AI execution and builds refuse with `LIVE_DISABLED`. Rejected: accepting governance values from the request alone (would let a caller choose decisions the owner never answered).
- Budget: `study_budget_holds` holds each attempt's full frozen cap under an advisory lock before any model work. Open attempts count at cap; finished ones at settled plus in-flight/unknown reservations. Final records share one `t15-final` ledger; synthetic ones are per workspace, so fixture units never consume the real cap.
- Builder link: studies bind a frozen build task by exact spec, freeze, task hash and current humility review (re-read at creation and assignment). Each attempt pins a same-hash copy of the spec and a review rebound to it (`study_attempt_pins`), so admission, grants and products stay in the attempt's own workspace. A/B arms build with the unchanged T12 BuildSupervisor through `studyBuildPorts`; the broker admits only builder/reviewer calls under the prepared plan's envelope and caps. The API records results only from its own re-read of the local build record (`readStudyBuild`), one build per attempt. C arms have no builder; their code is checked server-side against every frozen case. Held-out cases leave the server only as key and pass/fail.
- Evidence states: every case result names its backend; only the reviewed WSL2 backend sets `isolation_evidence`. The cloud tests use the labelled test double.
- Rollback: revert the commit; migration 11 is additive (three objects).

## ADR-0021 - T15 frozen schedule, deterministic admission, run ledger and blinded packets

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T15 request; branch claude/t15-hdrwqz from main 3f3544a. No migration. The protocol is not frozen, so no final run exists.
- Schedule: built only from a freeze manifest (rebuilt from the `study.protocol_frozen` audit event against the proposal in code; a changed proposal is a VERSION_CONFLICT) and the owner's final tasks in the frozen counts. Slot ids hash the freeze, packet and arm; the order (one run at a time) comes from a seed derived from the freeze hash. The planned schedule hash goes to the audit log (`evaluation.schedule_planned`).
- Admission is domain code: final slots need non-synthetic study records, verified live AI (RD6) and, for AI implementation work, the isolated builder. None exists, so today every final slot is `blocked` with its reasons. Fixture output and scripted people are admitted only in rehearsal mode. Rejected: building non-synthetic study records now, because their shape depends on RD3, RD5, RD6 and RD9.
- Ledger: every slot is listed once (blocked, deferred, missing, or attempt states); a blocked slot with an attempt is an error; RD10's single infrastructure retry keeps the failed attempt.
- Reviewer packets: identical template, per-reviewer order, codes from a per-package secret kept in the private key. A scan fails on filename, template or id leaks and flags condition-like words inside submissions for owner review instead of rewriting them. Implementation outcomes are functional checks, not reviewer items. Packets are written to disk only.
- Rehearsal: `pnpm evaluate rehearsal` runs the frozen counts on 8 synthetic tasks with a labelled stand-in freeze; 10/10 checks pass.
- Rollback: revert the commit.

## ADR-0020 - T17 local backup/restore, overrun propagation and boundary audit

- Date: October 18, 2026. Status: implemented by Claude Code for T17 (branch claude/project-thread-k4si82 from main e46b2cf). Follows ADR-0019 (T14, built in parallel). No migration.
- Backup: `pnpm backup create|restore|verify` (packages/db/src/backup.ts) pairs a `pg_dump --format=custom` archive with a byte copy of the product store under one SHA-256 manifest. Restore re-hashes everything first, needs an empty database and products folder and the same schema version, then verifies the audit chain and every artifact's manifest and package hash. Alternatives rejected: a JSON export through the API (would have to re-implement immutable tables, identity columns and the hash chain); a database-only backup (artifact rows would point at missing bytes). Not covered: schedules, retention, encryption, hosted operation (C43/X06).
- Budget overrun: when actual charges pass a child's cap, the excess now counts against every ancestor. New reservations anywhere under an ancestor whose rollup passed its cap are denied (`ancestor_overrun`) and new carve-outs under it fail. Computed from current rows at admission; a settle that overruns concurrently with another admission is not serialized against it (overrun already means the provider exceeded the exposure bound, so this guard stops further spending rather than restoring an exact cap).
- Heartbeat: `WorkflowStore.heartbeat` referenced an ambiguous `version` column, so every lease extension failed and the worker ignored the error; a task whose call outlasted one lease was redelivered and parked in reconciling. Fixed to `t.version`; covered by a test that holds a call for three lease lengths.
- Health: `/api/health` derives `data_mode`, `live_enabled` and a `live` block from the configured adapters; `live_configured` means configured, not verified.
- Preview origin (audit item 6, recorded rather than changed): browsers do not scope cookies by port, so the management session cookie is also sent to the preview port. Accepted because previews render only `textContent`, the cookie is HttpOnly, the preview server ignores it and the API rejects the preview origin. Serving generated web content on the preview origin requires a distinct host name first.
- Rollback: revert the commit. Restored databases are ordinary databases.

## ADR-0019 - T14 pilot rehearsal, proposal freeze gate and open research decisions

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T14 request; branch claude/project-thread-ocgg8g from main e46b2cf. No live provider, participant, reviewer or adopted protocol.
- Pilot: `pnpm pilot <dir>` runs one fictional decision task through arms A, B and C and one structured/open-ended pair through the existing T10 store, broker and worker in a new fixture workspace. AI arms use the fixture adapter (live dispatch disabled); B and C human entries are scripted and labelled `scripted_rehearsal`. Pilot tasks are listed as excluded from final tasks. Rejected: skipping the human arms entirely, which would leave their instrumentation unchecked.
- Checks and classification are deterministic domain code (packages/domain/src/pilot.ts) over the real exports and contexts: metrics, intervention timing, source validation, contamination, reviewer blinding and export repeatability; each attempt is classed instrumentation or substantive and kept. A `reproducible_digest` excludes ids and timestamps.
- Findings carried into the proposal: structured runs end `insufficient_evidence` on unverified packet snapshots (RD9), and workflow-finished assisted attempts leave human totals empty, so analysis sums intervention rows. Not changed in code: the first is correct behaviour; the second is an analysis rule.
- Freeze: the API freezes only the server's `PROPOSED_PROTOCOL`, for the signed-in human workspace owner, when every one of 10 blocking decisions has a non-deferred answer recorded against the exact proposal hash. The manifest goes to the hash-chained audit log; no migration (avoids colliding with parallel T17 work). Rejected: a file-only freeze, which any process could write without an owner session.
- Rollback: revert the commit; no schema change.

## ADR-0018 - Audit fixes: frozen and held-out QA cases, case-insensitive study ids, database CI

- Date: October 18, 2026. Status: implemented by Claude Code after Jordan's codebase audit (report: /mnt/project-files/audits/2026-10-18-codebase-audit.md) and his request to fix findings 1-3. Branch claude/project-thread-mccbs5 from main c162376.
- QA cases: spec acceptance checks gain optional `cases` (args, stdin, stdout, exit_code, held_out). They sit inside the T08 task hash, so a freeze fixes them. T12 requires every assigned automated check to carry cases, the plan's `cases` to equal them exactly (spec order, no held_out), and at least one held-out case per task. Held-out inputs/outputs are removed from builder and reviewer packets and from repair feedback (only the check key and pass/fail remain). Existing specs without cases stay valid but cannot be built. Supersedes the per-build plan cases in ADR-0016. Alternative rejected: keeping plan cases and only recording plan_hash; that detects but does not prevent a weaker case set.
- Study ids: assignment stores participant and continuation ids in lowercase; grader grants normalize the actor id and compare lower(); attempt access compares lowercase. A mixed-case assignment previously let a participant become a grader and read hidden material.
- CI: a second job runs `pnpm test:db` against a postgres:16 service with throwaway credentials. WSL2 isolation tests still skip there and remain a manual Windows gate.
- Rollback: revert the commit. No migration; stored rows are unaffected (existing assignments were already lowercase in all recorded runs).

## ADR-0017 - T13 immutable manifests, separate preview origin and feedback revisions

- Date: October 18, 2026. Status: implemented within Jordan's explicit T13 request by Claude Code; owner review and the real WSL2 gate pending. Branch claude/t13-8h288j from main 6fe5bab (T12 merged as PR #14). No T14, live provider, real spend or public release.
- Package only a current T12 verified_candidate. Archive committed blobs as a deterministic ustar (sorted, 0644, mtime 0), written once. Re-read and strictly re-extract it, then re-run every owner acceptance case through the existing T11 worker from those bytes. A package case passes only with exact stdout/exit and an input hash equal to the build QA input hash. The immutable manifest.json binds exact repository, spec/freeze/task, template, toolchain, dependency (stdlib only, no lockfile), archive/file hashes, startup, tests, settled cost, lineage and limitations. Failed re-runs keep the archive but no demo; missing worker gives blocked, never a host run.
- Bytes stay in the local product store (T11 boundary); migration 10 adds an immutable PostgreSQL manifest index with an 'artifact' entity linked to the spec, plus mutable preview leases and feedback rows. Registration re-hashes from disk and refuses stale spec versions/hashes, mismatched freeze/task hashes, unknown lineage and, in real workspaces, non-reviewed backends. Downloads and preview starts name the expected manifest hash and re-hash manifest and archive at that moment.
- Preview: a studio-owned HTTP origin on its own port (default 4320). One-time ticket exchanged for an HttpOnly SameSite=Strict path-scoped cookie; strict CSP, no framing/referrer; Origin-checked JSON run requests; each run rechecks owner, state, expiry, run cap and manifest hash before the worker starts the exact archive. Two live previews per workspace, TTL 1-60 min, 1-20 runs. Same host, different port is not cookie isolation, so the origin serves only studio-authored pages and never generated HTML/JS; generated web previews need a separate host and a reviewed web recipe (not implemented). The runnable demo is a CLI runner because T12 supports only the Python CLI recipe. Native installer is always unavailable.
- Feedback binds to one manifest hash. Accept/decline is owner-versioned. Revision reuses the T08 spec revision path in the same transaction and marks the feedback revised; a revision product repo starts from the verified package bytes with recorded base lineage; the new package records previous artifact and feedback ids. Comparison reports spec versions, changed task hashes, per-case package results, file changes, cost and feedback. Old artifacts are never removed.
- Test double (tests/src/artifact-double.ts) executes nothing, labels its backend test-double, adds a "not isolation evidence" limitation, shows notices in gallery and preview page, and is refused by real workspaces. It is used only by tests and the browser harness so packaging, leases, UI and feedback bookkeeping can be checked where WSL2 is absent. It is not evidence for the acceptance gate's isolation part.
- HTTP mapping: management API adds LIMIT_EXCEEDED 429 and keeps existing EVIDENCE_MISMATCH 400 / EXPIRED 409 to avoid changing earlier contracts; the preview origin uses its own map (ACCESS_DENIED 403, EXPIRED 410, LIMIT_EXCEEDED 429, EVIDENCE_MISMATCH 409).
- Alternatives: storing archives in PostgreSQL duplicates the local product boundary; serving packages through the management origin mixes product and studio trust; trusting build QA without a re-extracted run would not prove the delivered bytes start; a host-run fallback violates isolation. Rejected.
- Rollback: stop the preview listener and remove the T13 routes/CLI commands; leave migration 10 tables, product stores, manifests and archives intact (they are append-only evidence). Earlier T00-T12 behavior is unchanged apart from the shared reviseSpec helper refactor, covered by the existing selection tests.

## ADR-0016 - T12 finite local builder and task-candidate gate

- Date: October 18, 2026. Status: implemented within the owner's explicit T12 request; review pending. Built on local T11 commit 2c14f9a without merging or staging the owner's Docker follow-up. This new request does not imply that T11 owner review/merge occurred.
- Reuse the existing broker and T11 scoped Git/WSL worker. The owner CLI supplies authenticated current frozen spec/task bindings, run checks, exact-spec humility review and product.commit_build admission. No new SDK, service, model identifier, external authority, migration or live grant. Add only the existing domain workspace dependency for frozen task hashes.
- Bound one independent Python task with immutable spec/prompt/plan hashes, at most six broker calls, one attempt per call, two repairs, finite deadline/output/context and ten clean-sandbox cases. Tools are structured scoped CAS submissions. Fresh review sees candidate files/diff and frozen task context without builder claims. Supervisor-executed exact stdout/exit assertions, clean approve/no-findings review and current commit/spec jointly determine task-specific verified_candidate. Model summaries cannot supply test evidence.
- Extend the trusted recipe with typed argv/stdin from a supervisor-owned read-only acceptance file outside generated files. T11 isolation/cleanup remain enforced. Browser/manual/metric checks, persisted-state scenarios and dependency integration require another reviewed recipe; fail explicitly. A task gate does not certify a merge or whole product.
- Alternatives: unrestricted shells/generated tests let the builder control its evidence; rejected. Replacing WSL or adding a scheduler duplicates infrastructure; previews belong to T13. Fixed Python fixture roles exercise this gate without model reasoning or empirical validation. Fresh role context does not remove correlated model errors.
- Local immutable build records bind command/execution identity and broker reservation IDs. They inherit T11's owner-controlled filesystem boundary and are not catalog-indexed. Unknown/late paid outcomes stay in the broker. Crashes preserve intents/locks for inspection without automatic replay or destructive repair. Existing explicit owner integration commands do not promote a catalog product automatically.
- Full-suite checks exposed two prior timing/teardown races: hold the duplicate fixture response until all three duplicate deliveries return (same assertions), and close the budget API worker before dropping its DB. Another parallel-file run observed a T11 worker uncertainty fence during its cancellation test. Serialize test files to avoid competing real WSL resource/lease probes; within-test concurrency checks remain intact. Failed logs are retained. No production admission, budget or isolation gate was weakened.
- Verification source/results are in tracking/evidence/t12; usage is in docs/BOUNDED_BUILDER.md. Rollback removes optional T12 runner/fixture/acceptance input while preserving product repositories, failed commits, build evidence and broker ledger. No database migration is needed. No public release, participant activation, live model or real spend occurred.

## ADR-0015 - Optional Docker PostgreSQL; retain reviewed WSL execution

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's request to check newly installed Docker and implement it where suitable. No next milestone authorized.
- Docker Desktop now connects through its Linux engine. Add optional Compose PostgreSQL development/test services using the official 18.6 Bookworm image pinned by registry digest. Separate named volumes and localhost ports 55433/55434 avoid the existing native cluster and distinguish test data. No existing records imported or silently selected.
- Alternative: continue native PostgreSQL (still supported); Docker makes local database setup reproducible. Replacing the verified WSL2/Bubblewrap generated-code worker would duplicate working isolation and require full backend lifecycle/resource/recovery verification. Keep that worker and the host API/CLI/web development workflow. Neither a broader container deployment nor a Docker MCP configuration change is needed for this scope.
- Password required, generated into ignored .env.docker; no tracked credentials. Application URLs remain explicit per-terminal choices. Official image initializes a local development superuser; production role separation is outside this local setup. CPU/memory/PIDs/logs bounded, persistent database disk not quota bounded, no automatic restart, no personal-directory or daemon-socket mounts. No live model/provider activation or paid dispatch. Local compute costs remain unmetered.
- Executed: actual CLI/daemon and Compose connection; official image pull; Compose validation and healthy startup; nine migrations; persistence through restart; inspected localhost bindings and resource limits; authenticated Windows TCP read and wrong-password SQLSTATE 28P01; full Docker-backed database + real WSL gate 140/140, no skips. See tracking/evidence/docker and docs/DOCKER.md. A stale process PATH required a process-local Docker bin prepend for the CLI credential helper. No Docker MCP tool appeared in this chat; a selector connection alone is not tool verification.
- Configuration follows official Docker Compose service/networking and docker-library PostgreSQL documentation checked October 18, 2026 (links in docs/DOCKER.md). PostgreSQL 18 volume target is /var/lib/postgresql. Affects local persistence/verification infrastructure; application contracts, migrations, executor policy, research prompts and frozen protocols unchanged.
- Rollback: stop/remove this Compose project's containers while preserving volumes and .env.docker; return to the existing native PostgreSQL URL. Do not use down -v or rotate the password file as an automatic repair. Prior ADR-0014 remains applicable to generated-code execution; its historical absence-of-Docker observation is superseded only by this installation check.

## ADR-0014 - T11 local product Git and WSL2 namespace worker

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's T11 request; owner review pending. Base 5f9bb1bf71673b4c5aa27f418cbb2c842948266b is T10 merged PR #12. Branch codex/t11-isolated-execution. No next milestone authorized.
- Use the existing Windows Git/Node management host, WSL2 Ubuntu, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4 for one reviewed dependency-free checklist template. Windows had no Docker/Podman runtime; actual non-root namespace and resource-control probes passed. No installation, Docker socket, paid service or host fallback was introduced. The existing WSL2 VM supplements user/mount/PID/network namespaces; this is not a newly dedicated VM appliance and is scoped to the reviewed template. Broader hostile workload hardening remains T17.
- New @creator/executor provides strict local management contracts, canonical path/file scopes, separate repos, exact task bases, typed CAS changes, immutable intents/outcomes, one integration owner and exclusive file locks. Conflicting merges remain in a separate review worktree; integration and task checkouts survive. No destructive resets/clean, shell command inputs, generated hooks or wider-credential fallback.
- The owner CLI consumes the actual authenticated T08 frozen spec and rechecks its active version, hashes and owner role before mutation/dispatch. Local provenance binds workspace/spec/freeze/task identities and Git commits. Keep these local files distinct from PostgreSQL audit/catalog records; T11 needs no schema migration and does not claim searchable product/task catalog records. T12's runtime can consume these local interfaces; it must enforce its own run/action admission and exact-candidate independent QA. This owner-facing CLI cannot be exposed directly as a model tool or remote HTTP command runner.
- The reviewed trusted bridge uses cleared environment and fixed absolute commands. Generated code sees read-only runtime/input/recipe, a read-only root/proc/dev, bounded disposable work/tmp, no home/Windows mounts/studio credentials/Git metadata/D-Bus/daemon, no network, UID/GID 1000, no capabilities or new privileges. Fixed cgroup limits: 256 MiB/no swap, 32 tasks, half one CPU and 20 s. Work/tmp limits are 16/1 MiB, per-file 8 MiB, captured output 64 KiB. Exact policy, recipe, bridge, input, binary hashes and observed controls are recorded. A successful conventional recipe is not an acceptance verdict.
- Worker leases renew every 750 ms with a five-second expiry. Cancellation stops the whole systemd cgroup; a hard runtime cap remains if the supervisor dies. One worker is admitted per studio products root. Dead locks are never automatically stolen; explicit reconciliation requires absent owner process, expired lease and observed stopped unit. Uncertain dispatch retains a fence; no retry/reclassification as successful. Git-side partial operations remain inspectable and require preserving user edits in manual recovery.
- Alternatives: unrestricted host Python/Node would violate isolation and was excluded; a fake backend cannot verify the acceptance gate; installing a new Docker runtime would duplicate already available working capabilities; cloud workers add credentials/cost/activation outside T11; hand-managed files cannot enforce frozen scope and provenance. Fixed Python stdlib keeps the first real recipe bounded without package-network exceptions.
- Local compute bounds are enforced, but host electricity/compute dollars are not metered or treated as free API inference. No provider/model/pricing configuration changed and no live call was made. No builders, independent QA, persistent preview, artifact download, participants or public release activated.
- Official references checked 2026-10-18: https://github.com/containers/bubblewrap/blob/main/README.md (policy is the caller's responsibility, namespaces/new-session/no socket mount); https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html (cgroup limits); https://git-scm.com/docs/git-worktree (separate task/review worktrees). Installed help and executed boundary tests, rather than generic docs alone, establish this host's capability.
- Review repairs: read-only root/dev/proc; compare exact committed blob bytes; reject corrupt task/product manifests; bind recipe before execution; retain a dispatch fence for uncertain cleanup; refuse concurrent workers; verify recovery only after the recorded process is absent. Two pre-existing broker concurrency tests used fixed 300 ms delays; under full-suite load they released pending admissions early. They now wait for the five budget/two concurrency denials before releasing the unchanged gates, retaining all assertions. Transient Windows lease-file write errors are counted; actual lease expiry is determined by the bridge, not by a single failed write.
- Rollback: leave local evidence/repos intact, stop any active unit, disable the product CLI entry points. Existing studio migrations and T00-T10 behavior remain compatible. Full instructions, limits and threat model are in docs/ISOLATED_EXECUTION.md; actual executed checks are in evidence/t11/verification.json.

## ADR-0013 - T10 immutable synthetic studies and separate participant/grader access

- Date: October 18, 2026. Status: accepted reversible implementation within Jordan's T10 request. T09 prerequisite verified as merged PR #10 at a9edf68; branch codex/t10-study-runner. The downloaded handover informed scope and was checked against canonical documents and actual code; it was not authority to activate live services or recruit people.
- Migration 9 adds append-only studies, assignments, execution requests, events and private grader materials. Assignment workspaces are separate; participant reads use the assigned actor rather than general workspace membership. Grader permissions are separate from catalog roles, mutually exclusive with participation for a study, and serialized with assignments. Study/hidden content is not indexed by catalog search. The coordinator remains trusted; synthetic seeds use one operator and cannot establish empirical independence.
- Artifact/config/prompt/protocol hashes freeze each study version. Three-arm autonomy and structured/open-ended discovery are separate assignment comparisons. Order is deterministically derived from the recorded seed; prior familiarity remains explicit. A needs_human original is terminal; assisted continuations have a separate identity and are excluded from that original primary comparison. A partial unique index permits exactly one terminal event under concurrency.
- Reuse the T07 structured worker and T04 broker. The baseline is a distinct versioned neutral prompt, one bounded broker operation, verbatim output formatting, no structured brief/rubric/skeptic. Admission checks the frozen request, fixture provider/model, deadline, envelope and call cap; generic workflows and caller-added baseline context are refused. Structured inputs are hash-checked before and during creation, and arbitrary catalog entries are omitted. Snapshot text is not independent source validation; synthetic structured runs stop for insufficient evidence. No new provider SDK or dependency.
- Human-only work can store document/code/artifact text and run conventional contains/equals/JSON checks bound to exact artifact hashes. Every broker helper is denied, including broker-backed search; conventional source browsing is a separate path. Workflow denials commit audit evidence before throwing. Untrusted code is never executed by the management host; implementation execution waits for T11 isolation.
- Study events and API authentication use existing transaction/audit/session machinery. Export uses a stable PostgreSQL repeatable-read snapshot, explicit raw records and post-serialization hashing. Money sums use integer nano-units without join multiplication; unknown and in-flight exposure stay separate. Human timing is reported; automatic fixture completion does not assert observed human activity. Grader content is explicitly withheld without grader authority, with content hashes retained for a protected sidecar.
- Alternatives: spreadsheets/manual records remain useful for protocol design but cannot enforce model/context boundaries; a second workflow engine would duplicate T05; generic searchable entities would expose hidden grader data; pretending fixtures are empirical work is excluded. This implements testable research plumbing, not protocol adoption or recruitment.
- Verification details are in evidence/t10/verification.json. Native Windows uses the already installed PostgreSQL 18 test binaries, not the handover's PostgreSQL 16 environment; no claim of a new PostgreSQL 16 test. A local LF checkout policy resolves the CRLF-only formatting failure observed on Windows. Earlier migrations/ADRs/protocol history remain unchanged.
- Official PostgreSQL 18 references checked October 18: https://www.postgresql.org/docs/18/transaction-iso.html and https://www.postgresql.org/docs/18/indexes-partial.html. Read-only export uses snapshot consistency; write invariants use row locks and a unique partial index.
- Review hardening: manual stops share the broker run lock; study events take the audit lock before insertion; no-key-update parent locks avoid foreign-key/audit inversion. Late outputs retain artifacts and charges but fail the original assignment deadline. Grader principals are human-only. Seed commands have distinct repeatable keys. Equal problem/outcome fields and bounded snapshots prevent arm-specific information loss.
- Rollback: additive migration 9 can remain unused if the study routes are disabled; do not delete study/audit evidence. A future live/participant implementation needs a new authorized configuration, verified adapters, protocol and recruitment decisions. T11 is the next milestone; it is not started here.

## ADR-0012 — T09 studio interface, PostgreSQL text search and address-kept state

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T09. Decision-maker: coding agent; owner review pending on the pull request.
- Interface: one React shell with a workspace picker and a list of views instead of stacked panels. State that should survive refresh (view, workspace, selected record, query, activity filter) lives in the hash address `#/view?ws=&id=&q=`; everything else is re-read from the API, so nothing is cached in browser storage. Views take plain props and call `api`, so a future desktop shell can host them unchanged. No new UI dependency.
- Search: PostgreSQL full text (`websearch_to_tsquery('english')`, plus a title substring match) over record titles and string values in bodies, source passage excerpts, decision request text and audit summaries, with GIN indexes (migration 8). Snippets come from `ts_headline` with control-character markers split into segments, so the page never renders HTML from the database. A full UUID or 8+ hex prefix switches to exact id search. Membership is resolved first; a non-member gets NOT_FOUND before any query runs. Redaction already nulls bodies, titles and excerpts, so redacted text cannot match.
- Comparison: one read route assembles the problem, its brief, claims linked to it with T06 evidence, alternatives derived from it with humility review and scorecard count, the discovery workflow and run, and run-level assumptions (assumptions may only be `part_of` a run, per the T02 link rules). Scores and gates still come from the T08 report; the page does not compute them.
- Actions: the page shows only actions the API exposes for the role and lets the server decide admission; a supervised selection returns `needs_human`, the page links to the decision and resubmits after approval. The submit form registers a run and, if asked, a 24-hour standing model grant capped per call, visible and revocable in Decisions.
- Alternatives considered: a client router library (rejected: hash state is enough and adds no dependency); a separate search engine (rejected: X03 owns semantic and audit questions; PostgreSQL covers lexical search with the existing access path); storing view state in localStorage (rejected: not shareable and survives sign-out).
- Not done: semantic search, graph view of lineage, product/task/gallery content (T11–T13), measured accessibility audit. Rollback: migration 8 only adds indexes; removing `catalog-store.ts`, `catalog.ts` contracts and the new routes restores T08 server behaviour.

## ADR-0011 — T08 computed selection reports, admitted selection and per-task spec freezes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T08. Decision-maker: coding agent; owner review pending on the pull request.
- Scores are computed, not stored: reviewers write `scorecard` records (a new kind) and the report is a pure function of the current alternative versions, their current scorecards, the T07 dispositions and the latest humility reviews. The report hash binds a selection to exactly what the owner saw; a changed card, alternative or gate changes the hash and the selection is refused (`VERSION_CONFLICT`).
- Arithmetic: score = 100·Σwᵢ(rᵢ−1)/(4Σw) as an exact BigInt fraction, shown to one decimal rounded half up. Unknown ratings are never averaged away: the candidate has no score, only bounds with unknowns at 1 and 5. Several reviewers are combined by the mean of their complete cards and differences are listed; ties share a rank; overlapping ranges are marked unresolved. Weights are equal integers; sensitivity reruns with each weight at 0 and at 2. Two rubrics (`opportunity-rubric/1.0`, `suitability-rubric/1.0`) keep the software opportunity ranking separate from cross-option suitability; both are `proposed` until calibration.
- Gates beside scores: ethics/access (from current cards: clear, unresolved, not assessed), the T07 disposition, the T03 humility gate for build and hybrid, and kind rules (`select_for_build` only for build or hybrid; `recommend_alternative` only for non-code or hybrid responses). No score can clear a gate. Advancing a candidate over a higher-ranked non-advanced one is an override that needs a reason; the full original report is stored with the selection.
- Authorization: new action type `candidate.select` (target = problem version, spec hash = hash of report hash, dispositions and override reason) is admitted through T03 inside the write transaction and added to the supervised default stage gates beside `spec.freeze`. Autonomous runs are recorded only under a covering grant, otherwise deferred.
- Storage (migration 7): append-only `selections` (newest is current; a later one replaces, never edits) and `spec_freezes` (unique per spec version, bound to the selection). `spec/1` bodies and scorecards are written only through the selection store; the generic record path refuses them.
- Task hashes: each task's hash covers its definition, its acceptance checks and their flows, the shared scope, non-goals and data contracts, and its dependencies' hashes, so a change propagates to dependants but not to unrelated tasks. A revision reports tasks as frozen, changed, added or unfrozen, plus removed ones; freezing again needs a new admitted decision. Freezing also re-checks the selection, the alternative version and the gates at that moment.
- Alternatives considered: storing model-written scores (rejected: not reproducible); floating-point means (rejected: ties and displays drift); renormalising around unknowns (rejected by C09); one spec-wide hash (rejected: cannot say which tasks a change affects).
- Not done: no model assessor role writes scorecards (fixture reviewers only); selection does not change a product lifecycle stage; no web form for selecting or freezing; Windows untested. Rollback: migration 7 adds two tables and widens one check constraint; removing `selection-store.ts`, the selection contracts and routes restores T07 behaviour once no `scorecard` rows or `spec/1` bodies exist.

## ADR-0010 — T07 discovery runs on the workflow engine with a hashed evidence packet

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T07. Decision-maker: coding agent; owner review pending on the pull request.
- Engine: discovery is a second role (`r02_discovery`, `r02-discovery/1.0`) on the T05 workflow tables rather than a new runner, so leases, fencing, replay through the T04 broker, budgets, decisions and owner controls apply unchanged. Migration 6 adds the `search_brief` kind, the discovery task kinds (locate, propose, skeptic, revise) and a revision `round` in the task's logical slot. The plan is a pure function (`coordinateDiscovery`) next to the T05 `coordinate`, sharing its guards and settlement.
- Evidence packet: built by the application from T06 claim evidence and the active catalog at start, size-capped, hashed and stored in the workflow's immutable context. Task contexts carry only the packet hash, their assignment and input task ids with output hashes; the worker renders packet and inputs as untrusted data with no authority. Independence of first proposals is checked from the stored contexts (same packet, only the locator as input) and recorded in the result.
- Deterministic gates in code: packet sufficiency (current supported or contested problem evidence), output validation against the packet (refs must exist, cross-field answers must name both fields and explain a mechanism in other words, perspectives must match, the skeptic covers each proposal once), duplicate detection by word overlap against catalog titles and summaries, per-type evidence checks (software needs usable data and tool-gap evidence; an existing-tool recommendation needs existing-tool evidence) and final dispositions. Model outputs that fail validation are repaired within `max_repairs`; they are never accepted.
- Alternatives considered: letting the model choose the plan or delegate (rejected: T05 keeps depth 1 and code-owned plans); embedding-based duplicate detection (needs a provider and a model version to pin; word overlap is transparent and enough for the gate); one call producing all proposals (cannot prove independence).
- Not done: the locator does not run searches or fetches itself; no live model run; semantic duplicates beyond word overlap are missed; scoring and selection are T08. Rollback: migration 6 rebuilds three check constraints and one unique key; removing `discovery-store.ts`, the discovery domain modules and routes restores T06 behaviour once no `r02_discovery` rows exist.

## ADR-0009 — T06 source broker, passages and claim support

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T06. Decision-maker: coding agent; owner review pending on the pull request.
- Broker: one application path (`SourceBroker`, `packages/research`) from a run to a page. Order: URL policy check, then T03 admission of a new `source.fetch` action type (reversible, no model, no external effect) and an in-flight retrieval row in one transaction, then the fetch outside any transaction, then one outcome transaction. The URL hash fills the binding's spec-hash slot, so an approve-once grant covers exactly one URL; standing grants cover the run. Idempotency is the logical operation id plus a request hash; in-flight rows past their deadline are swept to `failed/interrupted`. A real workspace without a live adapter is denied (`live_fetch_not_configured`); fixtures are never substituted.
- Network policy (`source-policy/1.0`, hashed into each retrieval): HTTPS on 443 only, approved hosts (exact or `*.` suffix, each `excerpts` or `hash_only`), no credentials in URLs, private/loopback/link-local/CGNAT/reserved/multicast addresses refused including IPv4-mapped and NAT64 forms (`net.BlockList`), DNS answers checked and the socket connected to the checked address, redirects followed manually with each target re-checked, byte/time/redirect/content-type/per-run limits, identity encoding only, no cookies, no shared agent.
- Records: `research_sources` (one per final URL key, tied to a `source` entity whose versions are the source versions; a new version only when content hash or access changes), append-only `source_retrievals`, `source_passages` (text offsets in extracted text, hashes, bounded excerpt or null), `claim_support` (retract-only). Excerpts and quotes are nulled by a trigger when a source is redacted. The generic record API refuses to forge broker facts (`retrieval` in a source body) or revise broker-managed sources.
- Evidence: supports/contradicts require a quote found verbatim in the stored excerpt and bind to the current claim and source versions; each row also creates or reuses a typed `supports`/`contradicts` link. Assessment is a pure domain function: rows whose claim changed or whose source changed, disappeared or is older than `max_age_days` stop counting; reposts count once by origin cluster (same normalized main text, or canonical link); inaccessible sources are labelled, never support.
- Dependency: `htmlparser2` 12.0.0 (streaming tokenizer, no DOM, no script execution) instead of a full DOM (jsdom: much larger, executes nothing by default but more surface) or regex parsing (fragile offsets).
- Retrieved text: wrapped as `untrusted_evidence/1` with `authority: none` when handed onward; no code path reads page text to decide permissions, policy, budgets or further fetches. The instruction-like regex is a label for people, not a boundary.
- Not done: live search adapter, readability-grade extraction, PDF/non-HTML parsing, re-clustering after later fetches, robots.txt handling, T05 roles calling the broker. Rollback: migration 5 is additive; removing `research-store.ts`, `packages/research` and the routes restores T05 behaviour.

## ADR-0008 — T05 durable orchestration on PostgreSQL instead of Temporal

- Date: October 18, 2026. Status: accepted. Decision-maker: Jordan, on a decision card in the T05 project thread ("Run T05's durable workflows on your PostgreSQL instead of a Temporal server?" → PostgreSQL). This deviates from the earlier proposed stack (ADR-0001, PROJECT_CONTEXT.md), which named Temporal as the T05 backend.
- Reason: Temporal needs a separate server next to the app on the owner's Windows PC; PostgreSQL is already required and installed, and T02's transactional audit + outbox already give atomic state, history and at-least-once delivery. The guarantees T05 asks for (step checkpoints, logical operation ids, leases with fencing, restart recovery, waiting on decisions, pause/cancel) are a few tables and row locks, testable in this repository. Alternatives: Temporal (more infrastructure, SDK determinism rules, a second source of truth beside the audit log), pg-boss/Graphile Worker (queue only; leases/fencing and the coordinator would still be ours).
- Design: migration 4 adds `workflows` (bound context, limits, control, state, result; identity and context immutable, terminal final, one live workflow per run) and `workflow_tasks` (one logical operation each, depth 1, lease owner/token/expiry from `workflow_lease_tokens`, decision link, output and hash). The coordinator is a pure domain function (`coordinate`) applied under the workflow row lock; lock order is workflow → tasks → (broker) run → envelope. Commits are fenced on (state = leased, token). Expired leases requeue (or cancel); the next lease replays the logical operation through the T04 broker, which never dispatches twice. An answered/closed decision wakes its task through a new idempotent outbox consumer (`workflow_wakeup`), with a polling fallback. Unknown outcomes wait in `reconciling`; repairs only follow known bad answers, within `max_repairs` and `max_calls`.
- Role: R05 skeptic critiques a pinned record version per perspective, then a synthesis; task context carries immutable constraints, the subject by id/version/content hash and a bounded excerpt, and synthesis inputs by task id and output hash. Prompt text and version are hashed (`prompt_hash`). The worker runs as a dedicated agent actor, added as a workspace editor when a workflow starts; it cannot start, steer or approve.
- Not done: no Temporal, no multi-role planning or model-chosen delegation, no deeper child trees (depth fixed at 1), no per-workflow child budget envelope (calls draw on the chosen envelope under T04 limits), no owner "retry with a new operation" for a reconciled task. Rollback: migration 4 is additive; removing `workflow-store.ts`, `packages/orchestrator` and the routes restores T04 behaviour.

## ADR-0007 — T04 budget envelopes, reservations and the model broker

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T04. Decision-maker: coding agent; owner review pending on the pull request. Stacked on ADR-0006 (T03), not yet merged.
- Accounting: permission-to-spend envelopes with carve-out allocation (a child's cap moves into the parent's `allocated`, and closing returns only the unspent remainder) rather than reserving on every ancestor. Reason: one row lock per reservation, no double counting, and conservation is a single inequality the database can check. Rollups are computed for reporting. Financial reality is a separate append-only `usage_records` table, one row per attempt.
- Exposure: reserve the maximum, not an estimate. Input tokens are bounded by UTF-8 bytes (byte-level BPE emits at least one byte per token) plus a fixed framing allowance, priced at the highest input rate; output at `max_output_tokens`; the documented long-context surcharge applies when the bound could cross its threshold. Text input only.
- Outcomes: provider refusals that are documented as unprocessed (429, 401/403, other 4xx) release the reservation; anything that may have been processed (timeout, 5xx, network loss, cancellation in flight, malformed or unpriced usage) holds the full reservation as `unknown` until a late answer settles it or the owner reconciles it. In-flight attempts past deadline + late window become `unknown` on restart. A settled attempt cannot be charged again.
- Order: run state, pricing/exposure, envelope checks, then T03 admission with the bound amount, then reservation, in one transaction (OversightStore admission refactored into `admitIn` for this). A failed budget check therefore never consumes an approve-once grant.
- Provider: the owner's reference model `gpt-6-astra` is documented in OpenAI's official model catalog with Standard pricing $10 / $1 cached / $12.50 cache write / $50 output per 1M tokens (long context above 272K input: 2x input, 1.5x output). Adapter uses `fetch` against POST /v1/responses instead of the `openai` SDK to avoid a dependency for one endpoint; revisit when streaming, tools or embeddings are needed. Live dispatch requires explicit `CREATOR_LIVE_PROVIDER=openai` plus a key; a key is not authorization.
- Alternatives considered: hierarchical reservation on each ancestor (more locks, harder reports); estimate-based reservation (can overspend); treating 5xx as unbilled (unknown is not zero).
- Rollback: migration 3 is additive; removing `packages/broker`, `budget-store.ts` and the routes restores T03 behaviour.

## ADR-0006 — T03 owner sessions, decision requests, grants and run modes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T03. Decision-maker: coding agent; owner review pending on the pull request.
- Authentication: opaque 256-bit random session tokens (stored as SHA-256) in an `HttpOnly; SameSite=Strict` cookie, `Secure` and `__Host-` prefixed when hosted, plus a per-session synchronizer CSRF token on every state-changing request and the existing Host/Origin checks. Login is either a local development code (constant-time compared, 5-failure lockout) or OIDC authorization code + PKCE through `openid-client` 6.8.8 (published 2026-09-05; `jose` 6.2.12 only as a test dependency for a local test IdP). No custom token or signature cryptography. Development login fails `authConfig` validation in hosted mode; hosted deployment is still refused overall (X06). Alternatives: a session library/framework (more surface for one owner), signed stateless cookies (revocation harder), passkeys (no established server library in the stack yet). Health, fixture and validate routes stay unauthenticated because they are stateless and loopback-only.
- Authority model: decision requests and grants live in dedicated tables (migration 2), not the generic record store, which now refuses `decision`/`grant` kinds. Approve-once creates a single-use grant bound to action type, run, target id/version/content hash, spec hash and amount; standing grants are versioned policy (create/revise/revoke by a human owner only, expiry ≤ 90 days). Standing approval is not offered for irreversible, external or stage-gated actions. Answers must echo the coverage hash the person saw; a changed target supersedes the request.
- Action effects come from a code registry (`ACTION_REGISTRY`), not the caller, so a caller cannot declare a model call model-free. Admission order follows HUMAN_OVERSIGHT.md; model flags can only add reasons. Value questions (judgment/clarification) are asked before authorization, and a judgment answer never authorizes.
- Modes: run mode is fixed at registration and must match the run record's research condition. Supervised asks at stage gates (default spec.freeze, product.commit_build, release.publish) and needs approve-once there; human-in-the-loop asks at release.publish and dynamic reasons; autonomous uses only its initial grant packet at recorded versions, cannot create decision requests, and defers as `needs_human`; human-only denies every model action type regardless of grants.
- Humility gate: `humility_review` records compare software, existing tool, process change, human-led, hybrid and defer/decline with evidence refs; `product.commit_build` requires a passing review of the exact subject version; an unresolved serious ethical problem becomes a judgment request. Assumptions are `assumption` records; routine reversible ones with a cheap test are logged as provisional.
- Not done: no budget reservation (T04), no orchestrator calling admission (T05; today the owner calls it through API/CLI), no agent actor sessions, no real IdP verified. Rollback: migration 2 is additive; dropping it and `oversight-store.ts` restores T02 behaviour except the auth requirement on record routes.

## ADR-0005 — T02 PostgreSQL record store, audit chain and outbox

- Date: October 18, 2026. Status: accepted reversible implementation decision within the owner's request to start T02 (started from the project's setup card). Decision-maker: coding agent; owner review pending on the pull request.
- Storage: one PostgreSQL database through node-postgres `pg` 8.23.1 (published 2026-09-30) with `@types/pg` 8.23.1. Alternatives: an ORM/query builder (more dependency surface for a small schema), PGlite/embedded Postgres (no service needed, but single-connection and weaker concurrency evidence), SQLite (not the architecture's PostgreSQL direction). Raw SQL keeps integrity rules visible in one migration.
- Model: a generic `entities` table plus immutable `entity_versions`, with per-kind Zod bodies, rather than one table per kind. Reason: thirteen kinds share identity, scope, versioning, redaction and linking; integrity that matters (scope, kind, version endpoints, fixture separation, append-only history) is enforced with composite foreign keys, partial unique indexes and triggers. A SourceVersion is a source entity version. Revisit per-kind tables if queries need typed columns.
- Contracts: schema 1.0 extended additively with `idea` and `assessment` kinds, relations `assesses`, `part_of`, `authorizes`, new derived_from pairs (including `artifact:task` and `product:idea`), error codes `ACCESS_DENIED`, `DUPLICATE`, `IDEMPOTENCY_CONFLICT`, `STORAGE_UNAVAILABLE`, and health fields `persistent: boolean`, `storage`. No T01-valid task/result/link becomes invalid; the health response changed shape (T01 clients accepted only `persistent: false`).
- Audit: database-ordered sequence, server clock, hash chain under a global transaction advisory lock, outbox row in the same transaction, idempotent consumer inbox. Exactly-once is not claimed; delivery is at-least-once with idempotent projection.
- Access: workspaces with owner/editor/viewer membership checked on every repository call; non-members get NOT_FOUND. The HTTP API acts as one configured local owner (`CREATOR_OWNER_ACTOR_ID`) because authentication is T03.
- Rollback: drop the database (no production data exists) and remove `packages/db`; the fixture app runs without `CREATOR_DATABASE_URL`. Later schema changes use new migrations, never edits to migration 1.

## ADR-0004 — Claude Code access to the development tools

Date: October 18, 2026. Status: accepted at the owner's request in the project thread.

Mirror `.agents/skills` into `.claude/skills` as plain copies (Windows checkouts break Git symlinks) and keep both in step on updates. Add Matt Pocock's `grill-me`, `grilling` (its dependency) and `improve-codebase-architecture` at the already-pinned commit; the architecture skill's default `GLOSSARY.md`/`docs/adr/` paths yield to `tracking/DECISIONS.md` and canonical context. Configure the same two MCP servers in `.mcp.json` without machine-specific paths; per-machine browser differences go in environment variables or a local-scope override, not the shared file. Add a cloud-only SessionStart hook that runs `pnpm install`, synchronously so checks never race dependency install. Plugin lifecycle hooks remain uninstalled. No credentials are stored; Firecrawl account access goes through the claude.ai connector or an environment variable reference.

## ADR-0003 — Project-local development skills and MCP

Date: October 18, 2026. Status: accepted within the owner's explicit tool-installation request.

Install the requested upstream development tools in this Creator Agent checkout: 27 skills under `.agents/skills` and two project MCP entries under `.codex/config.toml`. Use pinned source commits and the system skill-installer helper; preserve upstream text and licenses. Keep global Codex configuration and the separate CIS4914 repository unchanged. AGENTS.md gains only a tooling pointer and clarification that current authorization, canonical paths and host rules take precedence over third-party defaults.

Choose the official keyless Firecrawl hosted endpoint for the initial connection: it has no credential prerequisite and exposes scrape/search/parse. It is a hosted service with a mutable version and rate limits, not local inference or a self-hosted crawler. Full account capabilities require a later explicit connection. Existing Firecrawl app tools remain distinct; no credentials were extracted or reused. Direct initialize/list-tools passed without data-tool calls.

Choose pinned Playwright MCP 0.0.83 using the installed Edge channel, headless and isolated, instead of attaching a personal profile. Direct protocol discovery and blank-page navigation/close passed. Its upstream dependency reports Playwright 1.64.0-alpha-1790635538000; do not describe it as a stable Playwright release. This is developer browser access, not T11 execution isolation. Project cwd is machine-specific and must be adjusted if moved.

Install Impeccable's skill plus its pinned 0.1.15 Windows engine after matching the published SHA256 sidecar. Keep the binary ignored by Git; engine-probe passed. Ponytail is installed as six skills, without global lifecycle hooks or importing session history. Select Matt Pocock's tdd, diagnosing-bugs, codebase-design, domain-modeling and writing-for-agents skills; the existing kit already supplies milestone orchestration, handoff and decision tracking. No automatic updater, native app, issue tracker, redesign, or later product milestone is introduced.

Consequences: skills are available at the next turn; new MCP entries may require restarting MCP in Codex. Direct handshake evidence does not claim current-chat tool exposure or successful paid operations. Source pins and hashes, limitations, verification and update/removal instructions are in [the tool guide](../docs/DEVELOPMENT_TOOLS.md) and [evidence](evidence/development-tools/install-manifest.json). T01 application source/dependencies remain unchanged; T02 remains next eligible.

## ADR-0001 — Empty repository and minimal local architecture

- Date: October 17, 2026 (America/New_York; evidence timestamps use UTC).
- Status: accepted as a reversible implementation default within authorized T00, not as owner approval of spending, study design, or external activation.
- Decision-maker/source: coding agent executing Jordan Price's T00 request and supplied repository URL; canonical kit v3.0, October 9, 2026.
- Repository: `https://github.com/jordanprice040/CreatorAI.git`.
- Local root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Evidence: [remote refs](evidence/t00/remote-refs.json), [local baseline](evidence/t00/local-baseline.json), [incoming kit hashes](evidence/t00/input-kit-hashes.json). The local kit contained no implementation; the successful remote query advertised no refs. Inaccessible/deleted history is not claimed inspected.

### Decision and rationale

Use the existing kit directory as the local CreatorAI working tree. Initialize an unborn `main` and configure `origin` to the supplied URL, preserving the existing files. There is no HEAD commit, tracked file or observed remote default branch. `main` is a reversible local default. No commit or push was performed.

Carry forward modular TypeScript/pnpm, React/Vite web UI, Node API and CLI, with application-owned contracts and domain enforcement. PostgreSQL remains the T02 persistence direction, Temporal the planned T05 backend, and isolated execution/filesystem artifacts/local Git the T11–T13 direction. OpenAI Agents SDK remains an adapter candidate; Tauri remains deferred to X05. None is installed application functionality. Verify current official documentation and pin compatible versions during the relevant implementation milestone; historical examples are not adopted API signatures.

Alternatives considered: reuse earlier agent code (none found in this workspace/advertised remote refs); use manual kit records alone (sufficient for intake, insufficient for executable lifecycle/contract acceptance); use a generic agent framework (possible adapter, cannot replace application-owned authority and study controls); scaffold the entire stack (deferred by T00 scope). The selected minimal path matches the kit without a stack deviation.

Consequences: T01 can implement fixture contracts and API/CLI/web paths without credentials or database/workflow services. Persistent records after restart belong to T02, policy/budgets to T03–T04, bounded durable roles to T05. No discovery, model inference, generated builds or empirical research results exist yet.

Affected requirements: C22, C26–C35 and C49–C50 guide this architecture; none is implemented by the ADR. Affected versions: kit v3.0 and T00/T01 prompts; no application commit, frozen protocol, provider config or pricing snapshot exists. Supersedes: none. Rollback: revise this ADR before a material stack change; local branch/remote can be changed without application data migration. Preserve the kit/evidence. If earlier Creator Agent code is supplied later, compare it before replacing compatible functionality.

### Actual path map

All paths are relative to the local root above.

| Actual path                                            | Observed role                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.git/`                                                | Created by T00: unborn main/origin, no commits or tracked files.                                                                                    |
| `AGENTS.md`                                            | Canonical coding instructions, preserved.                                                                                                           |
| `agent.md`, `CLAUDE.md`                                | Instruction entry points, preserved; incoming CLAUDE checksum differed from original kit manifest.                                                  |
| `PROJECT_CONTEXT.md`, `PROMPT_LIBRARY.md`, `README.md` | v3.0 vision, milestones/shared contract, kit guide; their uninspected-repository statements describe kit creation, superseded by this dated intake. |
| `context/`                                             | 9 design, policy, requirements and reconciliation documents, not runtime code.                                                                      |
| `agents/`                                              | RUNTIME_CONTRACT.md and ROLE_PROMPTS.md; future runtime specifications, no executable agents.                                                       |
| `templates/`                                           | 5 JSON examples/scenarios and IDEA_DOSSIER.md; not executable validators/tests.                                                                     |
| `references/`                                          | 4 archived historical Markdown documents, retained as references.                                                                                   |
| `tracking/`                                            | Four status/decision/integration/handoff documents updated by T00.                                                                                  |
| `tracking/evidence/t00/`                               | Added input hashes, remote observation, PowerShell verifier, baseline output and final file hashes. Intake tooling only.                            |
| `PACKAGE_VALIDATION.md`, `SHA256SUMS.txt`              | Historical kit validation/checksums preserved; not a checksum manifest for the edited working tree.                                                 |

Absent: apps/, packages/, src/, application tests, dependency manifests/lockfiles, .github/workflows/, container definitions, migrations, provider adapters and application build/start/test commands. Input inventory: 32 files including SHA256SUMS.txt. Reusable assets are specifications, prompts, templates and requirements; no reusable implemented functionality was found. No other personal repository was searched.

### Planned dependency/path map — not present yet

| Gate       | Paths / dependency direction                                   | Prerequisite and behavior                                                                                                                            |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01        | `packages/contracts` → runtime validation library              | Versioned executable schemas, decimal-string exact money and explicit errors. Select/pin library after compatibility review.                         |
| T01        | `packages/domain` → contracts                                  | Lifecycle, containment and transition rules; no external effects.                                                                                    |
| T01        | `apps/api` → contracts/domain; `apps/cli` and `apps/web` → API | Thin health and validated fixture demonstration; React/Vite client. Clients do not own enforcement. Share schemas as needed.                         |
| T01        | Root pnpm workspace/scripts                                    | Strict checks, compatible pinned dependencies, lockfile and documented install/build/test/dev commands. Tool presence is not compatibility evidence. |
| T02        | `packages/db` → contracts/domain + PostgreSQL                  | Migrations, persistence, audit/outbox; usable service unverified.                                                                                    |
| T03–T05    | policy/finance/providers and `apps/orchestrator`               | Admission precedes provider/Temporal effects; verified SDKs, budgets, caps and grants required.                                                      |
| T11–T13    | `apps/worker`, artifacts/integrations                          | Isolated generated workspaces, exact Git/artifact evidence; no host-execution fallback.                                                              |
| X05 onward | `apps/desktop` and hosted extensions                           | Deferred; no empty packages created.                                                                                                                 |

Create only paths required by the authorized milestone. Smallest useful T01 slice: CLI/web → local API → runtime-validated fixture contract and deterministic lifecycle result, with health and invalid-input/transition checks. The persistent bounded-role slice in context/ARCHITECTURE.md spans T01–T05; T01 alone does not complete it.

### Instruction reconciliation and preservation

No remote instructions were available to merge. AGENTS.md is canonical; agent.md points to it and CLAUDE.md imports it. CLAUDE.md has escaped underscores in supplementary path text; use the actual PROJECT_CONTEXT.md and tracking/BUILD_STATUS.md paths stated in AGENTS.md. Preserve the incoming bytes rather than normalize an unexplained user change. Before edits, 30/31 original checksum entries matched; CLAUDE.md was the sole mismatch. Tracking edits intentionally make the historical checksum list stale; retain it and use separate dated input/final evidence.

Host rules/current user request take precedence, followed by recorded owner decisions and canonical context over archived references. Runtime role prompts are future product behavior, not coding-tool instructions. The separate CIS4914 repository was neither searched nor modified. No subagents were used.

### Remaining consequential choices

- T01: verify/pin compatible runtime, package manager, API/schema/test libraries using official documentation. No owner question blocks this routine local work.
- T02/T05/T11: verify local database/workflow/isolation deployment. psql, temporal and docker were not found on PATH; service availability elsewhere remains unknown.
- Before live models: verify preferred reference model's actual API identifier/access, capabilities, pricing, credentials, finite caps and scoped data/spend grant. GPT-6 Astra remains a historical preference, not verified availability; no substitution adopted.
- T14/final collection: owner/committee decisions on RQ priority, tasks, participants/raters, institutional requirements, sample size, limits and schedule remain unresolved. Synthetic/local work can proceed.
- Extensions: public GitHub writes/releases, hosting, payments, campaigns, reinvestment and external tracing require applicable configured authority. This URL/intake request is not product integration activation.

## ADR-0002 — T01 executable fixture boundary and dependency pins

- Date: October 17, 2026. Status: accepted reversible implementation decision within Jordan's explicit T01 request. Supersedes ADR-0001's absent-code inventory as current status; preserves its architecture and historical observation.
- Implemented: two shared packages (contracts/domain), three apps (Node HTTP API, compiled CLI, React/Vite web), and a tests workspace. Node's built-in HTTP/test APIs avoid an additional backend framework. Zod validates runtime inputs; TypeScript uses strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes and project references. Future db/policy/provider/orchestrator/worker/desktop packages remain absent.
- Pins: TypeScript 5.9.3, Zod 4.6.7, React/React DOM 19.3.1, Vite 8.3.4, Prettier 3.9.10, Node types 22.19.0, React types 19.3.0, pnpm 11.25.0. npm metadata verified available versions; selected TypeScript's stable 5.9 line rather than the newer major. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also supported/tested because the bundled pnpm runtime uses it. Package commands use the shell Node 22 here. Exact transitive resolution/integrity is in pnpm-lock.yaml. Official documentation sources and actual dependency roles are in docs/LOCAL_DEVELOPMENT.md.
- API: GET /api/health, POST /api/fixture and POST /api/validate. Loopback-only service/config, bounded JSON bodies and Host/origin checks. The web page and CLI use these real endpoints and validate responses. Hosted/live configuration fails; no paid/network provider exists. The historical model preference remains unverified in config/provider-availability.json.
- Schema 1.0 implements the kit's fields with UUID identities and SHA-256 version references; templates remain intentionally non-executable design examples. Canonical hashing sorts object keys by code-unit comparison, avoiding locale-dependent ordering. USD nano-units use canonical integer decimal strings (up to 30 digits) and BigInt comparisons; JSON never serializes money as floating point.
- Alternatives/consequences: a real model/database would exceed T01 scope and its prerequisites; using fixtures permits honest local verification now. A separate provider package is unnecessary for one deterministic fake, so it lives in domain/fixture.ts. The fixture's synthetic 2099 deadline is explicitly not a live allowance. Distinct successful decision execution and deferred/failed product outcomes are intentional. A build recommendation does not create an artifact or claim build-ready verification.
- Trust boundary: delegation validation checks a complete proposed allocation, not concurrent reservations. Lifecycle rules receive trusted current state/evidence; they do not let API callers advance arbitrary products or authenticate model-supplied evidence. Test/review evidence must bind candidate/spec/version and use a non-builder actor, but actual independent review is T12. No accounting, grant, persistence or isolation gate was weakened to pass T01.
- Verification: fresh source-only frozen install/build/check; 20 tests on Node 22 and 24; built-web proxy smoke and actual browser interactions. Exact candidate and logs: tracking/evidence/t01/. No real AI, research or study verification claimed.
- Affected requirements: partial foundations for C10–C16, C20–C23, C28–C29, C32, C35 and C49; see BUILD_STATUS.md. Kit v3.0 and draft research protocol unchanged. No protocol freeze, paid grant or owner study decision inferred.
- Rollback: replace/adjust these minimal packages and dependency pins with a recorded ADR. No persistent user data, real provider effect or deployment requires migration. Preserve incoming CLAUDE.md and historical T00 evidence. No separate senior-project repository was touched.

## Future entries

Use one entry per decision:

- Decision ID and date:
- Status: proposed / accepted / superseded / rejected:
- Decision-maker and source:
- Question and alternatives:
- Evidence and reason:
- Scope, consequences and affected requirement IDs:
- Affected code/spec/prompt/protocol versions:
- Migration or rollback plan:
- Supersedes / superseded by:

Proposed defaults are documented in context/DECISIONS_AND_OPEN_QUESTIONS.md. Do not silently convert them into accepted owner decisions.

## T18 drafting boundary — October 18, 2026

Owner explicitly authorized T18 using documented missing-data allowance, with no
sending. Draft from upstream 3e9026f and actual verification artifacts; keep T15
final evaluation/T16 empirical analysis incomplete, comparative protocol proposed
and unfrozen, empirical results unavailable and all research questions unanswered.
Preserve local edits and prior RD6 preference/cap without enabling dispatch.
Committee checklist records missing decisions and unconfirmed dates. This is a
scope record for drafting, not a research freeze, academic approval or stack ADR.

## T19 acceptance boundary and reproducibility overlays — October 18, 2026

User authorized T19 after the T18 missing-data packet. Preserve source 3e9026f
without merging over local changes; archive fixed-commit bytes plus explicit local
doc/script/test overlays. Tests may optionally preserve synthetic product packages
and same-workspace provenance/search/cost evidence. No runtime policy is changed.
The restart integration wait now accounts for observed killed-worker lease expiry
before its bounded completion window; runtime leases and no-duplicate assertions
are unchanged. Retain the original 185-pass/1-fail/1-skip full log and focused
checks rather than claiming a green whole-suite rerun. Committee acceptance,
participant evaluation, protocol freeze and academic schedule remain unresolved.
No live activation, release or sending follows from creating a local archive.

## X05 implementation boundary — October 19, 2026

Owner authorized starting independent X05 work alongside Claude Code X03/X04.
Keep this pass in new apps/desktop files; reuse T13 manifest schema and executor
canonical-path/ustar validators. Initial Tauri source uses existing loopback web
origin and same-origin API proxy, with no native command/plugin/IPC grants. This
avoids duplicating catalog authority or adding a credential-bearing native bridge.
Offline artifact cache stores exact bytes plus local import date; every inspection
re-hashes, and receipts grant no permission. No extraction or host execution.
Alternative retained: existing browser plus authenticated Gallery downloads already
works; desktop convenience does not justify weakening isolation/authentication.
Full system-browser handoff and paired-worker control require coordinated shared
API/database edits, not a process-local identity map or trusted model decision.
Tauri 2.12.4 and tauri-build 2.7.3 were checked on official docs.rs on this date;
capability/configuration/prerequisite references are in apps/desktop/README.md.
Native toolchain absent; transitive lock/build/native acceptance still pending.

## ADR-0028 — X05 local desktop sign-in, source cache and presence pairing

October 19, 2026. Owner confirmed Rust/Cargo installation and that X03/X04 were
finished, authorizing shared integration. Fast-forwarded to origin/main ddf7bcf;
restored local audit/X05 changes from a retained recoverable stash. Tracking-only
conflicts retain both sets of records. No new commit or push was made.

Use a Tauri 2.12.4 Windows shell over the existing loopback shared UI/API. No
remote-origin native IPC grants. Rust menu actions own browser opening, authenticated
source download and opening only the downloaded manifest in Notepad. Preview
window requests can open only the exact separate-origin T13 ticket URL in the
system browser; other navigation/new-window origins are denied. No source extraction
or generated-code execution occurs on the desktop host. Raw manifest export is an
owner-only, hash-bound addition to T13; original bytes are rehashed before sending.
Native and Node caches are dated read-only snapshots, not authority or synchronization.

Migration 16 follows X04's 15. Five-minute one-time challenges bind to SHA-256 of a
256-bit native/client proof. Browser approval uses existing session/CSRF, binds the
approving session and, for workers, requires current human workspace ownership.
Claiming is transactional and verifies that approval has not expired/revoked.
Desktop claims issue separate revocable HttpOnly sessions; worker claims issue
hashed, expiring, revocable identities scoped to one workspace. No token/proof in
URLs, audit events or device lists. Worker client credentials remain in memory;
restarting requires re-pairing. Declared capability is not infrastructure evidence.

Presence heartbeats use 30-second scoped leases and controls invalidate the fence.
Paired workers cannot dispatch work, read artifacts with their bearer token, call a
model or consume a budget. This is an explicit partial X05 boundary. Reject a
process-local identity map, copying a browser cookie to a worker, or wiring an
arbitrary shell command to a worker lease. Actual paired execution must integrate
existing isolation and admission/accounting, with its own acceptance evidence.
Closing a window is separate from stopping a worker. Shutdown is a request until
observed; revocation denies future polls immediately, and is not proof of OS exit.

The importer/native filesystem boundary assumes an owner-controlled cache outside
product execution workspaces. Ancestor symlink/reparse checks do not protect against
concurrent replacement by another owner-privileged process. No installer/updater,
background service, external tracing, hosted deployment or live integration activated.

Native source download and startup were executed on Windows with fixture inputs;
HTTP/PostgreSQL pairing/session checks are separate from native interactive browser
approval, which remains unverified. The imported X04 Git contract used POSIX mkdir
and an invalid Windows file URL; replaced its test setup with Node mkdirSync,
pathToFileURL and platform-appropriate Git environment, retaining every assertion.
Generated Cargo target/schema files are excluded from Git/Prettier. Dependency
versions and commands are in apps/desktop/README.md; exact results in evidence/x05.

## Owner-requested UX roadmap refinement — October 20, 2026 (planning)

Owner requested routing/effort optimization, broad file operations and conversion, discoverable keyboard navigation, visual file relationships and further QoL ideas. COMPLETION_RUNBOOK §2.10–§2.15 records planned acceptance and phased delivery. Reuse X01/X02/X03 rather than parallel subsystems; evaluate sufficient quality by task class instead of guaranteeing universal sufficiency. Store/reference permitted arbitrary formats with an explicit supported-operation matrix, immutable evidence originals and versioned edits/conversions. Relationship suggestions remain distinct from provenance. Additional QoL proposals are prioritized for task-based validation; no new stack, provider, implementation sequence, study protocol or activation is approved by this planning record. Claude's current §2.1 remains the selected implementation work.

## §2.5 provisional search adapter — October 20, 2026

Existing SourceBroker/HttpFetchAdapter retained; no existing live search adapter was present to qualify (only synthetic tool.search_public). Add a disabled Brave raw Web Search candidate using the existing metered ModelBroker rather than inventing a second authorization/accounting path. Raw results remain unverified; source fetch and exact passage support remain separate. One request/page, ten results, task domains plus output filtering, no generated summary or credential redirects. Provider HTTP errors conservatively keep billing unknown. This is an implementation choice, not final coverage/cost/terms qualification or owner account activation. Official Brave guide recommends LLM Context for machine consumption; owner plan terms/storage rights and suitability must be checked before activation, with an alternative if unsuitable. Migration 25 reserved for Brave provider constraints; coordinate concurrent §2.4 migration allocation before durable application. Guide and evidence: docs/RESEARCH_RETRIEVAL.md, tracking/evidence/research-2-5.

October 20, 2026 — Owner explicitly approved installed studio backup and migration
24→25 during reset-layout update verification. Applied through native upgrade action;
backup present and startup succeeded. Provider activation unchanged. Evidence:
tracking/evidence/reset-layout/result.json.

## Owner-requested studio chat and theme-free discovery — October 20, 2026

U04 roadmap refinement: docs/COMPLETION_RUNBOOK.md §2.17 specifies central Studio
chat for discussion, save-only prompts/sources and actionable research/comparison
using existing records, admission and workflows. §2.18 specifies manual Explore for
me: agent-selected directions within a bounded permitted search envelope, evidenced
shortlist, then concrete versioned briefs and configured selection. "Issues" is
interpreted as real-world problems; repository maintenance remains separate.
Requirements C52/C53 trace these additions. Current submit.tsx and
SearchBriefBodySchema require a theme; no theme-free control is asserted. This
records requested planning, not implementation, live dispatch, scheduling, higher
limits or a changed thesis protocol. Next eligible prompts are the bounded slices
in §2.17/§2.18 after their stated dependencies; no implementation started here.

## Billing-aware theme submission feedback — October 20, 2026 (planning)

U04: owner reports mandatory budget/pricing snapshots conflict with plan-only use.
Inspected submit.tsx: readiness requires both an envelope and pricing snapshot;
brief budget text is separate but confusing. Added COMPLETION_RUNBOOK §2.19 for
simple draft intake, distinct solution constraints, typed subscription/local/API
resource admission, internally resolved API pricing and no extra metered spend for
plan-only runs. Plan access/summary qualification does not qualify discovery roles.
Documentation only; no runtime changes or live calls. Diff whitespace check passed.
Next eligible: bounded §2.19 discovery-route/admission implementation and required
role qualification, preserving frozen studies and existing uncommitted work.

## Accepted workflow-alignment planning — October 20, 2026

Owner accepted all nine findings and native plan search/Agent Reach comparison
for later implementation. Runbook impact map covers §2.5A native search first,
selective upstream comparison, §2.10 shared resource settings, §2.14 onboarding,
§2.15 status reconciliation/delivery order, §2.17 research handoff, §2.19A role
workflow dispatch/worker parity/effective limits/data sharing and Group 3 in-app
spec/build/package/revision. These are plans, not implemented/activated features.
Official plan docs permit web search subject to model/account/workspace policy;
current app integration/qualification is missing. Agent Reach remains a candidate,
not an installed dependency or replacement provider. No spending, schedule or study
changes. Next eligible prompt: §2.15 current-status reconciliation, then explicitly
select a bounded dependency-complete implementation slice. Documentation checks
only; no runtime tests/live calls. Existing unrelated changes preserved.

## §2.19A typed subscription discovery resources — October 20, 2026

Owner selected the first workflow/resource slice. Keep legacy API request shape and
study hashes intact; add typed resources rather than fake zero-priced API snapshots.
Subscription route uses accepted connection caps plus explicit data grants and fixed
role-to-qualification mapping, with one job/attempt and parent connection enforcement.
Migration 27 stores immutable resource setup and bounded raw workflow response text
for hash-bound crash replay; other direct plan results stay hash-only. This is necessary
because a settled request hash alone cannot recover a lost task output. Unknown results
remain held; no automatic redispatch. Reuse existing workers/admission/output gates,
not a second coordinator. Local route is typed but explicitly blocked until implemented.
Source-only contract acceptance does not install or qualify the actual model. Guide:
docs/SUBSCRIPTION_DISCOVERY.md. Pilot schedule gate and broader settings remain separate.

## Discovery qualification preparation — October 20, 2026

Prepare production-role contract checks instead of qualifying discovery from generic
JSON-key/phrase checks. New discovery_contract benchmarks preserve schema, exact
packet/role bindings, grounded reference IDs, fixed decision expectations and revision
coverage. A same-name or obsolete-prompt benchmark no longer unlocks discovery.
New synthetic cases are target-held-out but author-visible; no claim of independent
review or thesis evidence. Exact candidate/settings/migration/run plan prepared in
docs/DISCOVERY_QUALIFICATION_PLAN.md; raw outcomes retained by the bounded runner
only after scoped execution approval. Source and compiled hashes pin checker behavior;
future prompt/checker changes invalidate affected qualification. No classes/caps or
provider access activated by preparation. Template note drift was resolved by matching
the last verified settings hash; current API equality must still precede any change.

## October20 approved discovery execution: preserve failed qualification

Owner approved the exact upgrade/settings/18-request packet. Upgrade and task-class
changes executed; first development case returned exploratory where frozen grading
required well_supported. Production contract passed. Preserve failed qualification
and all original criteria; no retry, hidden rubric change or exposure of remaining
held-out labels as fresh evidence. Review whether authored evidence-strength gold
confuses synthetic observability with real-world validation before proposing a new
version. See docs/DISCOVERY_QUALIFICATION_RESULT.md.

## October20 evidence-strength review: qualify scope before enum

The v1 locator prompt does not specify whether evidence_strength assesses the
observed bounded problem or the untested intervention. Packet sufficiency admits
investigation; it does not establish independent corroboration/external validity.
Retain the failed v1 grade and original candidate. Propose explicit operational
anchors and semantic negative controls in a new version; do not silently change
study rubric or accept all labels. Eighteen fresh scenario designs prepared, not
frozen executable manifests or live authorization. See
docs/DISCOVERY_QUALIFICATION_RUBRIC_REVIEW.md.

## October20 operational discovery rubric1.1 and fresh qualification v2

User authorized implementing clearer anchors and executable benchmarks. Version
locator prompts around observed-need confidence within evidence scope; do not map
packet sufficiency to high confidence or synthetic support to real-world validation.
Shared role/prompt version change invalidates prior discovery evidence for the new
candidate. Preserve historical v1 failure unchanged.18 fresh packets are operational
contract checks with explicit author-visible labels, not independent or thesis
evidence. Substantive entailment review remains separate and required; nonempty
fields/enums alone cannot certify it. Initial offline packet-role-tag correction
retained in preflight-draft before any target outputs. Candidate/execution packet
prepared, not authorized for live use by earlier v1 grant. No study protocol or
weights, money/data permissions or saved connection settings changed. See
docs/DISCOVERY_QUALIFICATION_V2.md.

## October20 v2 zero-dispatch transport blocker and bounded repair

Exact approved v2 candidate installed, but qualification manifest creation exceeds
API64KiB cap. Stop recorded before qualification/model admission. Preserve original
v2 lock and all inputs/criteria; not a model failure or a license to retry output.
Fix only authenticated plan-qualification creation ingress to128KiB, retaining
ordinary64KiB action limits and all auth/schema/domain controls. HTTP/stream tests
prove actual frozen manifests fit without inference. Prepare a new candidate/binding
for owner review, not automatic replacement of the exact approved installation.
Repair runner requires zero-dispatch predecessor proof and a separate durable lock.
Same18 cases remain unexposed to target; not freshly authored or independent study
evidence. See docs/DISCOVERY_V2_TRANSPORT_REPAIR.md.

## October20 approved repair resolves ingress; preserve actual v2 schema failure

Install/run approval matched repair hash8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459.
API413 blocker resolved; first actual target response violates affected_users type
and gaps max length. Stop after1, retain failed grade and all locks; do not normalize
arrays, truncate output or weaken schema to pass. Output prompt names fields without
all exact types/limits, while runtime asks for several auxiliary details. Audit the
whole model-facing contract before preparing any versioned next candidate; do not
tune just visible fields or reuse target-exposed output as fresh held-out evidence.
Coding-agent substantive observations are author review, not independent approval.
No further milestone or new live call automatically follows. See
docs/DISCOVERY_V2_LIVE_RESULT.md.

## October20 discovery contract1.2: derive complete output shape from validators

User authorized the next bounded output-contract audit/revision. All discovery
task kinds now receive schema-derived types/counts/lengths/enums/reference patterns,
including a complete revision proposal. Keep relational evidence/perspective/ref
checks in application code. Clarify discovery-specific serialization without editing
the general runtime contract or weakening production validators; omit reserved
fixture metadata from model-facing projection. Hash generated schemas and payload
instructions with version1.2, invalidating historical evidence for a new candidate.
Prompt guidance is not provider-enforced generation or substantive entailment.
Preserve every prior grade/manifest/lock, test historical invariants and use explicitly
fixture-only rebindings for current plumbing tests. Prepare18 fresh v3 scenario
designs without live dispatch or new installation. No thesis protocol or weights
changed. docs/DISCOVERY_OUTPUT_CONTRACT_AUDIT.md records limits and next prompt.

## October20 fresh v3 operational qualification frozen for role1.2

User authorized complete fresh packets/manifests, controls, size verification and
candidate preparation.18 new scenarios now have production-bound frozen inputs and
prospective assertions, without reusing exposed v1/v2 outputs or tuning after target
results. Do not treat author-visible gold as independent evaluation. Order-independent
review coverage is retained for five proposals; two findings supplied to revision.
Semantic false-narrative controls explicitly expose automation limits and require
separate substantive review. Exact HTTP ingress/input checks precede live approval;
no cap changes or unverified structured-output provider features. New candidate/
execution hash prepared, not installed or authorized by older grants. See
docs/DISCOVERY_QUALIFICATION_V3.md.

## Discovery follow-up preparation note — October 22, 2026

Implemented the authorized offline preparation in DISCOVERY_REMAINING_COVERAGE_PROPOSAL:
fresh12 cases, no pooling/resuming v5, unchanged production prompts/runtime and
4/4 held-out floor. Reuse the existing v5 runtime with externally frozen manifests
through its existing API; no packaging/install prerequisite added. Prospective runner
requires separate review and a provider-available observation within15min, plus
unchanged settings/caps and exact plan approval. This is a prepared execution
proposal, not owner execution approval, quota reset or an accepted new research
protocol. See docs/DISCOVERY_FOLLOWUP_V1.md; historical failures/grades retained.

## Explicit availability-check intent — October 22, 2026

Owner selected repairing the already-verified availability path and approved one
new bounded live check. Keep initial-verification restriction; separate intent
and purpose require a fresh one-use grant and existing verified model. Legacy
grants default model_access. Fixed synthetic prompt, ordinary caps/credits and
unknown fencing apply; settlement updates availability without replacing access
or qualification. Migration28 additive. Implemented/reviewed/installed; one call
completed. This is not approval for the12case suite, another recheck, provider
fallback, research protocol changes or pilot activation. See implementation report.
