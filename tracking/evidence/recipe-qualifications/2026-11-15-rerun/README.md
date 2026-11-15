# Installed-app build qualification rerun (2026-11-15)

This is the rerun after PR #207 (builder/2 prompt) and PR #208 (ADR-0110: accept exactly one ```json
fence). Jordan's typed OK: "OK: rerun packet H and requalify GPT-6 Astra as builder" (10:46 UTC). The
runs were driven through the installed app's local API as the owner, from a Remote Control session.
Everything was $0: ChatGPT plan credits were confirmed off and Claude Code extra usage was off. The data
was synthetic. No API key was used. No connection setting was changed during the runs.

## Setup

- App build: `fdc7ce0c`, which is main `13744b4` plus the records commit and the Windows licence-walk
  fix of this branch. Jordan installed it around 11:05Z, and the app made its own pre-migrate backup,
  `pre-migrate-v65-2026-11-15T11-05-23-806Z`. The bundle manifest records `source_dirty: false`. The
  pre-install cold backup is `C:\CreatorAgentBackups\installed-pre-fdc7ce0-20261115T105346Z`.
- Role prompts: builder `1417735c…` (builder/2), reviewer `9e1cc6b4…` (unchanged).
- ChatGPT plan connection `7529f8ef…`, `gpt-6-astra`: daily cap 50, input cap 64,000, request timeout
  120 s.
- Claude Code connection `147e77aa…`, `claude-sonnet-5-5`, with the settings Jordan set at 06:32:56Z:
  daily cap 100, input and output caps 64,000, request timeout 240 s. The benchmarks freeze their own
  120 s limit per role request.
- Pre-flight: both connections were signed in, credits or extra usage off, caps accepted, the model
  verified, and no open or unresolved requests. GPT-6 Astra's builder/1 qualification showed
  `prompt_current: false`. Its reviewer qualification (`0f4b173e`) was still current, so
  `t12-reviewer-v3` was not run for it.

## Results

| Step | Record | Result | Requests | Time (UTC) |
| --- | --- | --- | --- | --- |
| A1' GPT-6 Astra builder `t12-builder-v3` | `c543b548` | qualified: development 1/1, held out 3/3 | 4 | 11:14:07–11:14:52 |
| H1 Claude builder `t12-builder-v3` | `c753dc42` | qualified: development 1/1, held out 3/3 | 4 | 11:15:05–11:15:34 |
| H2 Claude reviewer `t12-reviewer-v3` | `0677598a` | qualified: development 1/1, held out 3/3 | 4 | 11:15:48–11:16:06 |
| H3 Claude `p15-small-signup-v5` | `699dd264` | qualified 3/3: each attempt 2 of 4 requests, 0 repairs (77 s, 86 s, 76 s); the package passed all 10 frozen cases again; no extended cases | 6 | 11:16:24–11:20:24 |
| H4 Claude `p14-larger-ledgercheck-v5` | `49fe5782` | **not qualified**: attempt 1 failed after 1 of 6 requests, 0 repairs, 27 s; attempts 2 and 3 were not run | 1 | 11:20:40–11:21:07 |

H4's reason: "The build did not verify: SyntaxError: Unexpected token '<', "<invoke na"... is not valid
JSON". The stored builder answer (call 1 outcome, request `8e62b9ea…`, 6,960 characters) is a stray
`<invoke name="note">na</invoke>` / `</invoke>` preamble followed by one ```json fence holding a
complete-looking patch. Even where ADR-0110's `one_json_fence` applies, one fence is accepted only
when it wraps the whole answer with nothing but whitespace outside it
(`packages/contracts/src/routing.ts`), so the preamble makes the answer invalid either way. That is a role-caused failure, so it was not replaced. Nothing was left open.

Packet A's build records (`7dc8312f`, `8b8d8c26`, in `../2026-11-15-installed/`) are bound to builder/1
(`73cb799e…`). Under builder/2 they no longer count, so web builds on the ChatGPT connection carry the
trial label again until `p15-small-signup-v5` is rerun there. It was not rerun here.

Daily use afterwards: ChatGPT 22 of 50, Claude Code 19 of 100.

## Files

- `role-*.json`: the unchanged response of `GET plan-qualifications/:id`, with every case's answer and
  reason.
- `p15-…_699dd264….json`, `p14-…_49fe5782….json`: build qualification records from
  `GET recipe-qualifications/:id`.
- `list_<connection>.json`: each connection's build qualification list after H4.

Each file holds the API's JSON response unchanged, without a byte-order mark and ending in one line feed.
The files were checked for tokens, cookies, session or CSRF values, API keys, e-mail addresses and local
paths. The only matches were the word "token" in the H4 error text ("Unexpected token"), so nothing was
redacted.
