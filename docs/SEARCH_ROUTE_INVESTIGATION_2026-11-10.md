# Does Creator Agent need a separate web search API?

Investigation date: **November 10, 2026**. Architecture and readiness investigation only. No
code, configuration, account, grant or migration was changed; no live search, page fetch,
model request or purchase was made through Creator Agent or either CLI. Every external source
below was accessed on 2026-11-10. Code was read from `origin/main` at `2e94527` (schema 49),
because the local checkout (`02c7646`) is behind main; the local branch was not switched.

"Observed" means read in code or an official page. "Inference" is labelled. Nothing here is an
accepted decision: no ADR is proposed for adoption and no migration or ADR number is claimed.

## 1. Verdict

**Evidence insufficient, and nothing needs to be bought to settle it. A separate search API is
not necessary now.**

The precise reason:

- **No route has executed a single live search.** The only search code path is the Brave adapter.
  It is off by default, has no key, pricing snapshot or grant, and only searches 1 to 5 approved
  domains per query (`packages/broker/src/public-search.ts:57-80`). Both subscription routes have
  search switched off in code (section 3). So "can the existing connections find sources?" has
  zero executed evidence either way.
- **The official documentation says the existing OpenAI plan route can search and expose URLs.**
  The app already calls the Responses API with the owner's ChatGPT plan through Sign in with
  ChatGPT (`packages/broker/src/plan-responses.ts`, `plan-oauth.ts`). OpenAI's preview limits for
  that exact route list web search as supported "subject to model and account/workspace policy"
  [O5]. With `include: ["web_search_call.action.sources"]` the response lists every URL consulted,
  separately from the model's text [O2]. The earlier comparison report did not evaluate this route.
- **Evidence integrity does not depend on who found the URL.** The guarded fetcher re-fetches each
  page, stores exact text offsets and hashes, and claim support must quote stored text verbatim
  (`packages/contracts/src/research.ts:250-275`). A search engine only has to supply candidate URLs.
- **Full raw rankings are not required** by the product requirements, the P12 gate or the draft
  evaluation protocol (section 6). They are convenient for debugging and comparison studies.

What would flip this to "necessary now" is listed in section 8. The smallest tests that would
settle it are in section 7.

**Update after Jordan approved the test (section 12, same day):** Claude Code's built-in WebSearch
worked through the studio's own sign-in: 3 runs, 9 searches, 30 distinct candidate URLs, every one
traceable to a search result. The weak link was **fetching, not finding**: only 5 of 15 selected
pages produced usable passages. Academic hosts answered 403 or a reCAPTCHA page, and PDFs are not a
supported content type. A raw search API would return the same kinds of URLs, so it would not fix
this. The verdict stands: a separate search API is not necessary now. Evidence is still
insufficient for unattended runs.

**Second update (section 13, same evening):** the OpenAI plan route also searched, through the
studio's own admission and token handling. It made 4 search calls, ran 9 distinct queries and
returned 24 candidates, all among the sources it reported. Each answer took 17 to 27 s. Only 2 of 15
pages were usable after fetching. The two routes found **no identical URLs**, so they complement
each other rather than duplicate. Fetching is still the bottleneck.

## 2. Comparison of the routes

Columns: **Implemented** = what the code on main does today. **Documented** = what current official
pages say the provider supports. **Executed** = what has actually been run. **Unresolved** = what
only a live check or a provider answer can settle.

| Route                                                                         | Implemented (main)                                                                                                                                                                                                                                                                                                                                        | Documented (official, 2026-11-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Executed                                                                                                                                                                                | Unresolved                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. OpenAI plan Responses route** (Sign in with ChatGPT, owner's plan)       | Text-only requests. `planRequestBody` sends model, instructions, input, `store:false`, `stream:true` and **no tools** (`plan-responses.ts`). Plan errors are classified (not eligible, usage limit, unavailable). Timeout, abort and output-length cut exist.                                                                                             | Web search supported on this route subject to model and account/workspace policy; `max_tool_calls` and `max_output_tokens` are **unsupported fields** [O5]. Hosted `web_search` gives `web_search_call` items (actions `search`, `open_page`, `find_in_page`; search queries "usually (but not always)" included), a complete `sources` list via `include`, `url_citation` annotations (url, title, offsets), up to 100 allowed **or** blocked domains, `external_web_access` live/cached, `tool_choice: "required"` [O2]. | Text requests have run on this route in earlier qualifications. **No search request ever sent.**                                                                                        | Whether the owner's account and chosen model allow search here; whether `include` and `filters` are accepted on this route; how searches count against plan limits; how many searches one request runs (no documented cap field on this route).                   |
| **B. Codex app-server builder** (Path B, WSL jail)                            | `web_search="disabled"` and a relay that refuses any request offering a tool outside a fixed allowlist (`packages/executor/src/codex-host.ts:33-90`). Built for isolated code generation.                                                                                                                                                                 | Codex web search is a hosted tool separate from command networking; modes `disabled`/`cached`/`indexed`/`live`; searches appear as `web_search` items in `codex exec --json` [O6][O7]. With a custom model provider (which this route uses), standalone search "remains under development and is off by default" [O6].                                                                                                                                                                                                     | None.                                                                                                                                                                                   | Not worth resolving for discovery. **Inference:** keep this route search-free; opening it would weaken the builder's isolation layers (AGENTS.md invariant 6).                                                                                                    |
| **C. Claude Code CLI** (owner's own sign-in, `claude -p`)                     | Every run uses `--restricted --tools "" --disallowedTools mcp__* --max-turns 1 --no-session-persistence`, and the session is stopped if Claude Code reports any tool (`packages/broker/src/claude-code.ts`). Usage-limit errors are classified. Local CLI is 2.1.252.                                                                                     | `WebSearch` returns result **titles and URLs only**, does not fetch pages, may run **up to eight backend searches per call**, accepts `allowed_domains` or `blocked_domains` (not both), backend not configurable [C6]. In `-p` mode the search cap applies per turn and can be raised (`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`) but not removed [C6]. `WebFetch` passes the page through a separate model call, so it is "lossy by design" [C6].                                                                       | **3 live runs on 2026-11-10 with the unmodified CLI outside the studio code (section 12):** WebSearch works on the Max sign-in; 9 searches, 30 candidates.                              | Whether WebSearch is available to a subscription sign-in (the tools page lists Claude API, AWS and Foundry availability and does not mention subscription plans [C6]); exact `stream-json` shape of WebSearch results; whether `page_age` reaches the CLI output. |
| **D. Direct raw search API** (Brave adapter, or a new provider)               | Brave adapter: one request, 10 results, strict safe search, rank/title/URL/snippet, sent query, response hash, policy hash; discovery only; HTTP errors keep billing unknown (`public-search.ts`). Off unless `CREATOR_PUBLIC_SEARCH=brave` plus key, pricing snapshot and grant. Migration 25.                                                           | Provider terms and prices are in the earlier report; not re-verified here.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fixture and contract tests only. No live query.                                                                                                                                         | Rights to store results and publish the study (Brave default terms restrict both, per the earlier report); broad any-host search is not implemented (1 to 5 domains).                                                                                             |
| **E. Hybrid** (model-driven discovery, app-controlled fetch and verification) | Fetch half exists: `SourceBroker` + `HttpFetchAdapter` with DNS/address pinning, per-hop redirect re-check, byte and time limits, run-cancellation abort, durable outcomes, exact passage locators and hashes (`packages/research/src/broker.ts`, `adapters.ts`). "Any public website" fetch policy exists (ADR-0056, `contracts/src/research.ts:36-51`). | Both A and C document URL-bearing search events that are separate from model text [O2][C6].                                                                                                                                                                                                                                                                                                                                                                                                                                | Fetcher contract-tested. **On 2026-11-10, 15 real pages were fetched** with the studio's own adapter, per-hop policy and extractor, outside the studio database (section 12): 5 usable. | Missing for P12: robots/terms handling (none in `packages/research`), detection of bot-challenge and low-text pages (F2 still open; a reCAPTCHA page is stored as "fetched"), PDF support, gap-to-query loop.                                                     |

## 3. What each route exposes programmatically

|                             | Search event                                               | Query text               | URLs                                                                        | Rank           | Snippet / page text          | Source age                                                 |
| --------------------------- | ---------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- | -------------- | ---------------------------- | ---------------------------------------------------------- |
| A. OpenAI plan `web_search` | `web_search_call` item, own id and status [O2]             | Usually, not always [O2] | Complete `sources` list with `include`; cited subset in `url_citation` [O2] | No             | No snippets; model text only | Not documented                                             |
| C. Claude Code `WebSearch`  | Tool call and tool result in the stream (shape unverified) | Tool input               | Titles and URLs [C6]                                                        | Not documented | No                           | API results carry `page_age` [C7]; CLI exposure unverified |
| D. Brave adapter            | One request = one search (code)                            | Sent query stored        | Up to 10                                                                    | Yes            | Unverified snippet           | Not stored by the adapter                                  |

**Inference:** all three supply what the guarded fetcher needs, which is a URL. None of the model
routes provides page text that the app could treat as evidence, and the app should not want it:
model citations (`cited_text`, up to 150 characters in the Claude API [C7]) and `WebFetch` output
are model-processed, so they can point to evidence but never be evidence.

### Can search activity be told apart from inference, and verified independently?

- **Separated:** yes on A and C. Search appears as distinct items or tool events next to the
  model's text [O2][C6]. The app can therefore record each URL's origin as _search event_,
  _citation_, or _model text only_.
- **Independently verified:** no. Both events are reported by the provider; the app cannot see the
  search backend. **Inference:** this does not matter for evidence, because a URL that the guarded
  fetcher retrieves and whose stored text contains the quoted passage is verified regardless of how
  it was found. It does matter for honesty labels: a URL with no search event behind it must be
  marked "model-suggested, not searched", and a response with no search event must never be
  reported as "searched the web".

## 4. Bounds, failures and cancellation

|                        | A. OpenAI plan route                                                                                                                                                                 | C. Claude Code CLI                                                                                                                                       | D. Brave adapter                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Calls                  | One request per broker call (code)                                                                                                                                                   | One process per call (code)                                                                                                                              | One request = one search (code)                             |
| Searches inside a call | **No cap field on this route** (`max_tool_calls` unsupported [O5]). The app can count `web_search_call` items as they stream and stop the stream, but a search may already have run. | Per-turn cap via environment variable, cannot be turned off; each call can run up to 8 backend searches [C6].                                            | Exactly 1                                                   |
| Tools                  | Request decides which tools are offered                                                                                                                                              | `--tools WebSearch` alone, restricted mode                                                                                                               | n/a                                                         |
| Time / cancel          | Timeout and abort signal (code)                                                                                                                                                      | Timeout kills the child (code)                                                                                                                           | Abort signal, 1 MB cap (code)                               |
| Quota / auth failure   | Typed plan errors: not eligible, usage limit, unavailable, sign-in invalid (code)                                                                                                    | `claude_usage_limit` and other classified failures (code)                                                                                                | HTTP error → billing unknown, reconcile before retry (code) |
| Search failure         | Not documented for this route                                                                                                                                                        | API reports `too_many_requests`, `unavailable` and others inside a 200 response [C7]; CLI retries overloaded requests, then returns an error result [C6] | Provider error → unknown                                    |
| Money                  | $0 incremental; draws plan limits                                                                                                                                                    | $0 incremental; draws subscription limits [C5]                                                                                                           | Paid per request                                            |

**Inference:** for supervised runs these bounds are adequate. For unattended runs, route A's missing
per-request search cap is the main unresolved control. A timed-out or cut request must be recorded
as an unknown outcome against plan usage, never as "did not search".

## 5. Terms: permission, restriction, ambiguity

|                               | Confirmed permission                                                                                                                                                                                              | Confirmed restriction                                                                                                                                                                                                                                                                                                                                                                                        | Ambiguity                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenAI plan route**         | Sign in with ChatGPT plan usage is offered for "open-source and locally hosted apps" [O4]; web search is a supported tool on it, subject to policy [O5].                                                          | Paid or remotely hosted apps must use an interest form [O4]. Consumer Terms of Use prohibit automatically or programmatically extracting data or Output (published 2026-01-01) [O8]. Interface showing web results must show inline citations as clickable links [O2].                                                                                                                                       | How the consumer-terms clause applies to the official plan-usage program for local apps; whether unattended background runs are acceptable plan usage; how search counts against plan limits. **Inference:** the program is OpenAI's own sanctioned route, which weighs against reading the general clause as a ban, but this is not confirmed.  |
| **Codex CLI**                 | ChatGPT sign-in is supported for local CLI work [O3].                                                                                                                                                             | OpenAI recommends API keys for programmatic Codex CLI workflows such as CI/CD [O3].                                                                                                                                                                                                                                                                                                                          | Not relevant for discovery (route B stays search-free).                                                                                                                                                                                                                                                                                          |
| **Claude Code**               | `claude -p`, the Agent SDK and third-party app usage draw from subscription limits (updates 2026-06-15 and 2026-10-07) [C5]. Each end user may sign in to the unmodified binary with their own subscription [C3]. | OAuth is for ordinary use of Claude Code; advertised limits assume ordinary, individual usage; developers building products should use API keys; no offering Claude.ai login in your own app, no routing requests through plan credentials on users' behalf, no collecting or intermediating tokens; preinstalling or running Claude Code in a product needs Commercial Terms and an unmodified binary [C3]. | Whether a scheduled unattended discovery run counts as "ordinary, individual usage". Distribution to other people is allowed only with each person's own sign-in and an unmodified binary. **The current design (owner signs in through `claude auth login`, studio never reads the token) matches the stated rules** (`claude-code.ts` header). |
| **Search results themselves** | —                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                                                                                            | Neither subscription route documents a licence to store raw search results; the app would store URLs it found plus pages it fetched itself. Publisher-page rights are separate in every route (as the earlier report says).                                                                                                                      |

**For the owner's personal local use:** permitted on both routes, with the ambiguities above for
unattended runs. **For later distribution:** each user would need their own plan sign-in; a paid or
hosted version would need OpenAI's interest process and Anthropic API keys or Commercial Terms.

## 6. Are full raw rankings necessary?

**Observed requirements:** C05 needs source, version and locator behind each claim
(`context/REQUIREMENTS.md`); the P12 gate needs "auditable supported problems or an honest
empty/blocked result" (`docs/CREATOR_AGENT_PROMPT_RUNBOOK_2026-11-05.md`, P12). The draft
evaluation protocol ranks _candidates_, not search results, and requires condition A to use a
"fixed approved model/tool configuration" (`context/EVALUATION_PROTOCOL.md`).

**Conclusion:** raw rankings are not necessary for the product or the adopted protocol. What _is_
necessary for condition A is a recorded, versioned route and tool configuration, plus the queries
and URLs actually used. A model-driven route is less reproducible than a raw API (a rerun can search
differently). **Inference:** if the study later needs replayable result sets, that is a reason for
a raw API (section 8), not something to buy before the study design asks for it.

## 7. Smallest recommended architecture and test plan

### Architecture (proposal, not adopted)

1. **Discovery:** add `web_search` to the existing OpenAI plan route for discovery requests only:
   `tool_choice: "required"`, `include: ["web_search_call.action.sources"]`, workspace exclusions
   as `blocked_domains`, live access on. The app records each `web_search_call` (id, status, query
   when present) and every source URL with its origin. The model's prose is kept as a draft, never
   as evidence.
2. **Second discovery route (optional):** Claude Code with `--tools WebSearch` only (no `WebFetch`,
   no shell), restricted mode, empty working directory, a per-turn search cap. Same result contract.
3. **Evidence:** unchanged `SourceBroker`. Select URLs, fetch through the guarded fetcher under the
   workspace's evidence-site policy, store passages with locator and hashes, require verbatim quotes.
4. **Result contract:** reuse the Brave adapter's `public-search/1` shape where it fits (query,
   retrieved time, URLs, response hash), plus route, model, search-event ids and URL origin.
5. **Keep Brave disabled.** Keep it as the raw-API option if section 8's conditions appear.

No new provider, no new paid spend, and the shared $20 ceiling is untouched.

### Acceptance criteria (proposed thresholds, to be fixed before any run)

- **AC1 Search happened:** every discovery response has at least one search event; a response
  without one is labelled "no search" and its URLs "model-suggested".
- **AC2 Useful candidates:** a broad query yields at least 5 distinct URLs from at least 3
  registrable domains.
- **AC3 Fetchable:** at least 60% of selected URLs produce at least one stored passage through
  the guarded fetcher; failures are kept with their reason.
- **AC4 Citation fidelity:** every quoted claim matches stored text exactly; model citations are
  checked against the fetched page, and mismatches are recorded, not repaired.
- **AC5 Bounded:** searches per request are observable, and a configured cap stops the request.
- **AC6 Typed failures:** usage limit, expired sign-in and search unavailable each produce a typed
  outcome; no fixture substitution; no paid fallback.
- **AC7 Cancellation:** cancelling a run stops the request or process and records an unknown outcome.
- **AC8 Spend:** $0 incremental; no API key reaches either route.

### Bounded test plan (needs Jordan's approval; nothing has been run)

**Development set (not held out):** (1) broad: "recurring problems small community organisations
report with volunteer scheduling"; (2) cross-field: "methods from aviation checklists applied to
home medication management"; (3) evidence-gap follow-up: one question generated from a gap in (1)
or (2), such as "independent evidence on whether shared volunteer calendars reduce no-shows".

**Step 1, no code change: Claude Code, 3 runs.** The unmodified `claude -p` in an empty scratch
folder, owner's existing sign-in in the studio's dedicated Claude Code folder, `--restricted
--tools WebSearch --strict-mcp-config --no-session-persistence --output-format stream-json
--verbose --max-turns 2`, search cap 3 per run (so at most 3 WebSearch calls, which may mean up to
24 backend searches), 180-second timeout. Record raw stream, search events, URLs, latency and the
result message's usage. Subscription usage only.

**Step 2, no code change: guarded fetch, at most 15 fetches.** In the dev studio (never the
installed app's data), fetch up to 5 selected URLs per query through the existing `source-fetches`
route with approve-once grants. Score AC2 to AC4.

**Step 3, needs a separately authorised small code change:** the same 3 queries on the OpenAI plan
route with `web_search` added behind a flag. This is implementation, so it is listed for a later
decision only.

Report counts and failures as observed. Three queries cannot establish quality, superiority or
study validity.

## 8. When a separate search API would be justified

- The OpenAI plan route refuses search for the owner's account or model, **and** Claude Code
  WebSearch is unavailable or fails AC1 to AC3.
- Searches per request cannot be capped (AC5 fails) and unattended runs (P13) need a hard count.
- Plan limits are exhausted often enough to block the needed run cadence.
- A provider answer says unattended or distributed use of plan search is not allowed.
- The study design adopts replayable result sets, raw-ranking analysis or coverage-bias measurement.
- Distribution to people without their own subscriptions.

Even then, the earlier report's rights questions (result storage, thesis publication) must be
answered for the chosen provider first.

## 9. Mismatches between code, documentation and the requirement

1. **The earlier report's recommendation conflicts with an accepted owner decision.** It
   recommends Tavily first; the October 20 accepted planning says "native plan search first,
   selective upstream comparison" (`tracking/DECISIONS.md` "Accepted workflow-alignment planning",
   `docs/WORKFLOW_ALIGNMENT_REVIEW_2026-10-20.md`). The report never evaluates native plan search.
2. **The earlier report misses the route the app already has.** It assesses "OpenAI API web search"
   as a paid API-key product and treats subscriptions only as "a separately qualified route". It
   does not mention the implemented Sign in with ChatGPT plan route, where web search is documented
   as supported [O5].
3. **The earlier report's "next prompt U02" line is stale.** Main's status lists P12 as "Not
   started; needs Jordan's search provider choice" (`tracking/BUILD_STATUS.md` on main).
4. **P12 is framed as a provider purchase decision** in the status files, while the requirement
   (R15) is a search-to-evidence pipeline that existing routes may already serve.
5. **Broad discovery does not exist:** the only search adapter needs 1 to 5 approved domains and
   filters results by the startup host list (`public-search.ts`, `docs/RESEARCH_RETRIEVAL.md`),
   although fetching already supports "any public website" (ADR-0056).
6. **Older integration row still says "Search: no live adapter"** (`tracking/INTEGRATIONS.md`
   source search/fetch row); a later note supersedes it for implementation only. Both are accurate
   that nothing is live-verified.
7. **Missing for the stated workflow:** robots/terms handling, bot-challenge and low-text detection
   (F2), PDF extraction, and gap-to-query generation. (Correction to an earlier draft of this
   report: the extractor already records `published_at`, `canonical_url` and a normalized-text
   `fingerprint` used to find reposts, so basic source age and syndication signals exist.)

### Claims in the earlier report checked

| Earlier claim                                                               | Status                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Brave adapter requests 10 results and needs 1 to 5 approved domains         | **Confirmed** (code)                                                                                           |
| Claude `claude -p`/SDK/third-party usage draws from subscription limits     | **Confirmed** [C5]                                                                                             |
| Anthropic forbids third-party Claude.ai login and credential intermediation | **Confirmed** [C3]                                                                                             |
| Codex docs advise API keys for programmatic CLI workflows                   | **Confirmed** [O3], but it concerns the Codex CLI, not the plan Responses route the app uses for discovery     |
| "Neither subscription offers ... N raw ranked searches"                     | Correct, but not a requirement (section 6)                                                                     |
| Subscription routes are not a fit for the raw-search role                   | **Unsupported as a conclusion:** the plan route documents search with a complete URL list; it was not examined |
| Tavily Free should be the first choice                                      | **Unsupported now:** contradicts accepted planning and was made before the native route was assessed           |
| Next prompt U02                                                             | **Stale**                                                                                                      |

## 10. Source register (all accessed 2026-11-10)

| ID  | Source                                                                                                                                           | Page date shown                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| O2  | [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search.md)                                                     | None                              |
| O3  | [Codex authentication](https://developers.openai.com/codex/auth) (served from learn.chatgpt.com/docs/auth)                                       | None                              |
| O4  | [Sign in with ChatGPT: plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)                                        | None                              |
| O5  | [Sign in with ChatGPT: preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)                    | None                              |
| O6  | [Codex web search](https://developers.openai.com/codex/web-search) (served from learn.chatgpt.com/docs/web-search)                               | None                              |
| O7  | [Codex configuration reference](https://developers.openai.com/codex/config-file/config-reference) (search excerpt)                               | None                              |
| O8  | [OpenAI Terms of Use (rest of world)](https://openai.com/policies/row-terms-of-use/)                                                             | Published 2026-01-01              |
| C3  | [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)                                                         | None                              |
| C5  | [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | Updates 2026-06-15 and 2026-10-07 |
| C6  | [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference)                                                                   | None                              |
| C7  | [Claude API web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)                                      | None                              |

Pages were read through the coding tool's web connector (a development tool, not a Creator Agent
runtime integration). The US OpenAI Terms of Use were not separately retrieved.

## 11. Outcome

No application code, configuration, grant or migration changed. Application tests were not run.
Jordan approved steps 1 and 2 on 2026-11-10 ("yes to both"); results are in section 12. Next
eligible action is Jordan's choice between the follow-ups in section 12. P12 implementation has
not started.

## 12. Live test results (2026-11-10, approved by Jordan)

Raw output, metadata and scored results are in
[tracking/evidence/search-route-test-2026-11-10/](../tracking/evidence/search-route-test-2026-11-10/).
This is a small non-held-out smoke test. It does not establish quality, coverage, superiority or
anything about the study.

### Scope actually used

- **Step 1:** the unmodified `claude.exe` 2.1.252 with the studio's dedicated sign-in folder
  (`.creator/studio/claude-code`; `claude auth status` reported a claude.ai sign-in on the Max plan,
  first-party, no API key). It ran from an empty working folder with an allowlisted environment.
  Flags were `--restricted --tools WebSearch --allowedTools WebSearch --strict-mcp-config
--disallowedTools mcp__* --no-session-persistence --max-turns 5`, with
  `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION=3` and a 180 s timeout. No `--model` was passed, so the
  CLI default `claude-opus-5[1m]` answered. These runs used the CLI directly, **not** the studio's
  Claude Code route, which is unchanged and still runs with no tools.
- **Step 2:** 15 fetches, the model's top 5 candidates per query, chosen before fetching. They used
  the studio's own `HttpFetchAdapter`, `checkUrl`, `classifyStatus` and `extractDocument`, built
  from `C:\dev\creator_agent_p15` (its `packages/research` matches main), plus a script that repeats
  `SourceBroker`'s per-hop rules. The policy was any public HTTPS host, 3 MB, 20 s, 5 redirects,
  HTML or plain text only. The dev studio was **not** started, so durable retrieval rows, grants
  and run cancellation were **not** exercised.

### Step 1: discovery

| Query                                                           | Searches (cap 3) | Distinct URLs in results | Candidates | Hosts | Candidates found in search output | Time | Reported usage                                                |
| --------------------------------------------------------------- | ---------------: | -----------------------: | ---------: | ----: | --------------------------------: | ---: | ------------------------------------------------------------- |
| q1 broad (volunteer scheduling problems)                        |                3 |                       32 |         10 |    10 |                             10/10 | 63 s | 6 in, 2,077 out, 11,911 cache read, 10,611 cache write tokens |
| q2 cross-field (aviation checklists for home medication)        |                3 |                       27 |         10 |     7 |                             10/10 | 67 s | 6 in, 2,128 out, 14,909 / 6,623 cache                         |
| q3 evidence-gap follow-up (do scheduling tools reduce no-shows) |                3 |                       29 |         10 |     7 |                             10/10 | 68 s | 6 in, 2,206 out, 15,285 / 6,844 cache                         |

Observations:

- **Search events are visible and separate from model text.** Each search is a `tool_use` named
  `WebSearch` with the query, followed by a `tool_result`. The result starts with
  `Web search results for query: ...` and a `Links:` JSON array of `{title, url}`, then
  **model-written summary text in the same result**. The app must parse only the `Links` array.
  No snippets, ranks, dates or `page_age` were exposed.
- **The cap held.** Exactly 3 WebSearch calls per run. The number of backend searches behind each
  call is not reported.
- **Usage accounting is not a search counter.** `server_tool_use.web_search_requests` reported 0 in
  every run despite 3 WebSearch calls. `total_cost_usd` reported $0.57, $0.48 and $0.49. That is the
  CLI's API-price estimate; on a subscription sign-in it is not a charge. Observed incremental
  spend was $0.
- **No hallucinated URLs in this sample.** All 30 candidates appear in the search output. A first
  pass of my analysis script flagged 2 URLs because its URL regex stopped at `'` and `(`; a plain
  substring check found both. This is recorded rather than hidden.
- **Failure observed and preserved:** the first two attempts of q1 failed in about 8 s with "Failed
  to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh". The
  results reported `is_error: true` with `subtype: "success"` and `duration_api_ms: 0` (no API
  request was made). Cause: an empty `.oauth_refresh.lock` folder created at 22:19:27Z by my own
  `claude auth status` check just before. No other Claude Code process used that folder. I removed
  the lock and the third attempt succeeded. **Inference:** the studio route needs a typed outcome
  and recovery note for a stale refresh lock, and must classify on `is_error`, as it already does,
  not on `subtype`.

### Step 2: guarded fetch (5 per query)

| Outcome                                                                                            | Count | Where                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------- |
| Fetched with usable passages                                                                       | **5** | 4 of q1's practitioner pages (789 to 2,326 words, 18 to 60 passages of 80+ characters); 1 q3 university news page |
| Fetched, but the page is a bot challenge ("Checking your browser - reCAPTCHA", 18 words, HTTP 200) |     3 | PubMed Central (q2, q3)                                                                                           |
| HTTP 403                                                                                           |     5 | ncbi.nlm.nih.gov PMC, Wiley, ScienceDirect, AJM                                                                   |
| PDF refused as unsupported content type                                                            |     1 | q2                                                                                                                |
| PDF over the 3 MB limit                                                                            |     1 | q1                                                                                                                |

- **Per query:** q1 4/5 usable, q2 **0/5**, q3 1/5. Overall 5/15 (33%), which **fails AC3** (60%).
  The cross-field and evidence-gap queries, which lean on academic sources, fared worst.
- **Provenance on fetched pages:** every usable page had a content hash, text hash, fingerprint and
  retrieval time. `published_at` was present on 3 of 5. Every page title matched its search title.
  No duplicate fingerprints were found among the 5.
- **Quote check:** for each usable page, an 80-character excerpt taken from the stored text was
  found at its recorded offset, and an invented sentence was not found (5/5 each). The search route
  supplies no quotations of its own, so model citation fidelity could not be measured here.
- **Critical gap:** the 3 challenge pages would be stored as **fetched sources** by the current
  broker. Nothing flags them. This is open finding F2, and it now has a concrete case.
- Latency: average 0.37 s per fetch, at most 2.1 s.

### Acceptance criteria (Claude Code route only)

|                                           | Result                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC1 search happened                       | **Pass:** 3 search events per run                                                                              |
| AC2 useful candidates (≥5 URLs, ≥3 hosts) | **Pass:** 10 URLs and 7 to 10 hosts per query                                                                  |
| AC3 fetchable (≥60%)                      | **Fail:** 33%; the cause is the fetcher and the source mix, not the search route                               |
| AC4 citation fidelity                     | Stored-text quote check works (5/5); model citations not testable on this route                                |
| AC5 bounded                               | **Pass** for call count; backend searches per call not observable                                              |
| AC6 typed failures                        | Partly observed: refresh-lock failure surfaced as an error result; usage-limit and search-unavailable not seen |
| AC7 cancellation                          | **Not tested** (studio not used)                                                                               |
| AC8 spend                                 | **Pass:** $0 incremental; no API key in the environment                                                        |

### What this changes

**Inference:** for this sample, finding sources was not the bottleneck, and paying for a raw search
API would not have improved the 5/15 fetch result. A raw API returns the same URLs to the same
fetcher. The next useful work is on the evidence side: detect challenge and low-text pages, decide
whether PDFs are in scope, and prefer open-access copies (for example Europe PMC or publisher
open-access pages) when a host refuses. These are P12 implementation choices for a separate
decision. Still unresolved: the OpenAI plan route (needs a small code change to test),
cancellation, usage-limit behaviour, and whether unattended runs are acceptable plan usage.

## 13. OpenAI plan route results (2026-11-10, approved by Jordan)

Jordan asked for this test at 22:19 UTC ("I would like this done as well"). Jordan approved the
dev-connection change at 22:42 UTC ("OK widen dev connection"). Evidence is in
`tracking/evidence/search-route-test-2026-11-10/plan-route/`, and the driver is
`scripts/plan-search.mjs` in the same folder. Smoke test only.

### Code and scope

- **Code:** PR #157 (merged) added an opt-in `web_search` option to the plan request
  (`packages/broker/src/plan-responses.ts`, `plan-service.ts`). The request asks for the hosted
  `web_search` tool with `tool_choice: "required"` and `include: ["web_search_call.action.sources"]`.
  Each `web_search_call` is recorded once, and more than `max_calls` calls end the stream as
  `unknown` (`studio_search_cap`). Claude Code connections refuse the option, and no route, UI or
  workflow passes it. Tests: `tests/src/plan-web-search.test.ts`. The new and existing plan suites
  passed 65 of 65 against the test database.
- **Route:** `PlanConnectionService.invoke` on the dev database (schema 49), workspace
  `88df6c10…`, ChatGPT plan connection `4e4a7bec…` (Plus), model `gpt-6-astra`, purpose `chat`,
  `max_calls: 3`. Admission, the plan request record and the token stayed inside studio code; the
  driver never saw the token.
- **Settings changed for the test and restored:**
  - **First attempt:** refused at admission before anything was sent. Chat answers are
    `private_approved` and the connection allowed only `synthetic` and `public`. Kept as
    `attempt1-refused.txt`.
  - **With Jordan's OK:** the driver added `private_approved`, re-accepted the same caps, switched
    chat answers on, ran the 3 requests, then restored both.
  - **After:** the connection settings are byte-identical to before (`same_settings_as_before:
true`) and chat answers are off. The caps acceptance timestamp is now 2026-11-10T22:44:10Z, the
    connection version went from 16 to 21, and the chat setting from 0 to 4. Each change is in the
    audit log.

### Discovery

| Query          | Search calls (cap 3) | Distinct queries | Distinct source URLs | Candidates | Hosts | Candidates in sources | Time | Output tokens |
| -------------- | -------------------: | ---------------: | -------------------: | ---------: | ----: | --------------------: | ---: | ------------: |
| q1 broad       |                    1 |                3 |                   40 |         10 |     7 |                 10/10 | 27 s |           763 |
| q2 cross-field |                    1 |                3 |                   29 |          8 |     7 |                   8/8 | 17 s |           538 |
| q3 gap         |                    2 |                3 |                   56 |          6 |     4 |                   6/6 | 23 s |           546 |

Observations:

- **One call can run several queries.** A single `web_search_call` reported 3 to 4 query strings,
  and the `query` field repeats the first entry of `queries`. So `max_calls` bounds calls, not the
  queries inside them.
- **The complete sources list worked.** It is separate from the model's text. Every candidate
  appeared in it, so none were invented in this sample.
- **No snippets, ranks or dates** came back, as documented.
- **Overlap with Claude Code:** 0 identical candidate URLs across all three queries. One article
  appears on both routes under two ScienceDirect paths (`/abs/pii/…` and `/pii/…`), so
  normalising URLs before deduplication matters.
- **Speed:** 2 to 4 times faster than the Claude Code runs (17 to 27 s against 63 to 68 s).
- **Spend:** $0 incremental. The connection notes that the Plus five-hour allowance is shared with
  Jordan's own ChatGPT and Codex use. Plan-side usage was not observable.

### Guarded fetch (top 5 per query, same method as section 12)

| Outcome                                     | Count | Where                                                     |
| ------------------------------------------- | ----: | --------------------------------------------------------- |
| Usable passages                             | **2** | psnet.ahrq.gov (6,005 words), stateswin.org (1,357 words) |
| "Fetched", but an empty app shell (0 words) |     2 | reddit.com, stored as fetched (F2)                        |
| PDF refused or over the limit               |     5 | report PDFs on q1, q2 and q3                              |
| HTTP 403                                    |     6 | apnews, ahrq.gov PDF, PMC, ResearchGate, ScienceDirect ×2 |

- **Usable rate:** 2/15 (13%), which fails AC3. Both usable pages passed the stored-text quote check
  and the invented-sentence check, and both had `published_at`.
- **Source mix:** this route leaned more on PDFs and forum threads than Claude Code did, and both
  are poor fits for the current fetcher.

### Acceptance criteria (plan route)

| AC                                        | Result                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| AC1 search happened                       | **Pass:** `web_search_call` items on every response                                        |
| AC2 useful candidates (≥5 URLs, ≥3 hosts) | **Pass:** 6 to 10 URLs, 4 to 7 hosts                                                       |
| AC3 fetchable (≥60%)                      | **Fail:** 13%                                                                              |
| AC4 citation fidelity                     | Stored-text quote check 2/2; model `url_citation` annotations not requested in this prompt |
| AC5 bounded                               | **Partly:** call cap enforced in code (untriggered here); queries per call not bounded     |
| AC6 typed failures                        | Admission refusal observed and typed; usage-limit and search-unavailable not seen          |
| AC7 cancellation                          | Not tested live (unit tests cover the cap stop)                                            |
| AC8 spend                                 | **Pass:** $0 incremental                                                                   |

### What this changes

**Observation:** both subscription routes can find sources, at $0 incremental spend and with
search events separate from model text. **Inference:** running both and merging candidates gives
more independent sources than either alone. A paid raw API is still not justified by anything
measured here. The deciding work for P12 is on the evidence side:

- detect challenge, empty-shell and low-text pages;
- decide on PDF support;
- find open-access alternatives when a host refuses;
- normalise URLs before deduplication.

Using the plan route for real chat or discovery would also need a deliberate data-class decision,
because chat requires `private_approved`.
