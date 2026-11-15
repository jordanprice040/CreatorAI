# Installed-app build qualification records (2026-11-15)

ADR-0105 (B1) packets A and H from `docs/BUILD_QUALIFICATION_PACKETS_2026-11-14.md`, run on Jordan's
installed desktop app after his typed OK ("I OK the live packets", 2026-11-15 03:48 UTC). The runs
were driven through the installed app's local API as the owner, from a Remote Control session.
Everything was $0: ChatGPT plan credits were confirmed off and Claude Code extra usage was off. The data
was synthetic. No API key was used.

## Setup

- App build: main `3473b05` (merge of PR #200), installed by Jordan on 2026-11-15 around 05:53Z, with
  the app's own pre-migrate backup `pre-migrate-v62-2026-11-15T05-53-31-530Z`. The bundle manifest
  records `source_dirty: false`.
- Workspace: "Jordan's Creator Studio" (`88df6c10…`).
- ChatGPT plan connection `7529f8ef…` (Plus): model `gpt-6-astra`, verified 2026-10-20. Daily cap
  50 requests, input cap 64,000 characters, request timeout 120 s.
- Claude Code connection `147e77aa…` (local `claude -p`): model `claude-sonnet-5-5`, verified
  2026-10-30. Before packet H it allowed only summarization and specification, with a daily cap of 30
  and an input cap of 24,000. **Jordan changed these settings himself** (06:32:56Z, caps accepted): he
  allowed patch_build and independent_review among other tasks, and set the daily cap to 100, the input
  cap to 64,000, the output cap to 64,000 and the request timeout to 240 s.
- Role prompts at the time: builder `73cb799e…` (builder/1), reviewer `9e1cc6b4…`.
- Pre-flight: WSL2 Ubuntu has the pinned chrome-headless-shell 156.0.8078.47, and the frozen
  `p15-small-signup-v4` reference scored 10 of 10 (6 of 6 held out) in the sandbox, with no model call.

## Packet A: ChatGPT plan, GPT-6 Astra — passed

- **A1/A2 skipped.** Builder (`8d28f88b`, t12-builder-v1) and reviewer (`0f4b173e`, t12-reviewer-v2)
  were already qualified on 2026-11-11 and reported `prompt_current: true`.
- **A3 `p15-small-signup-v5`, record `7dc8312f`: qualified 3/3.** 06:01:08–06:05:35Z. Each attempt
  used 2 of 4 requests with 0 repairs (89.5 s, 88.8 s, 88.4 s). The build was verified and the
  reviewer approved, and the exported package passed all 10 frozen cases again. There are no extended
  cases. 6 requests in total, none replaced.
- **A4 `p14-larger-ledgercheck-v5`, record `8b8d8c26`: qualified 3/3.** 06:06:09–06:11:58Z. Each
  attempt used 4 of 6 requests with 1 repair (116 s, 114 s, 119 s). The package passed all 10 frozen
  cases again, **21/21 extended cases** and the structure check. 12 requests in total, none replaced.
- The connection used 18 of 50 daily requests, with nothing open or unresolved afterwards.

## Packet H: Claude Code, claude-sonnet-5-5 — stopped at H1

- **H1 builder `t12-builder-v1`, record `7c054251`: failed.** 06:34:04–06:34:42Z, 4 requests. The
  development case passed 1/1. Held out: bd-02 was accepted; **bd-03 and bd-04 were rejected as "The
  answer is not valid JSON."** because each answer was wrapped in one ```json code fence. The fenced
  content itself is complete JSON with `summary`, `submission` and `blocker`. The four cases started
  between 06:34:11Z and 06:34:35Z and the record was decided at 06:34:42Z, so every answer came well
  inside its time limit, and nothing was left open.
- **H2–H4 not run.** H3 and H4 need both roles qualified, so they could not run after H1 failed. H2
  (`t12-reviewer-v2`) was left for the rerun, which uses `t12-reviewer-v3` (ADR-0110).
- Follow-up outside this record: PR #207 (builder/2 prompt) and PR #208 (ADR-0110, accept exactly
  one ```json fence) were merged afterwards.

## Still current?

These records are bound to the builder/1 prompt (`73cb799e…`). PR #207 replaced it with builder/2.
The studio counts a build qualification only while its builder and reviewer prompt hashes match the
current ones (`onCurrentPrompts` in `apps/web/src/build-qualification.ts`, and the web recipe check
in `packages/contracts/src/web-recipe.ts`), and builder/1 role records no longer admit. So on main
after #207, packet A's results here are not current: its builder step now uses `t12-builder-v2` or
v3 (`docs/BUILD_QUALIFICATION_PACKETS_2026-11-14.md`). These files remain the record of what
builder/1 did. The rerun under builder/2 is recorded in `../2026-11-15-rerun/`.

## Files

- `p15-…_7dc8312f….json`, `p14-…_8b8d8c26….json`: build qualification records, as returned by
  `GET /api/workspaces/:ws/recipe-qualifications/:id`.
- `role-*.json`: role qualification records. The two GPT-6 Astra records were taken out of the
  connection detail response and written again, so they are indented and one timestamp lost a
  trailing zero (`created_at` `2026-11-11T09:37:17.84Z` in the reviewer record; the API always writes
  three digits, so it was `.840Z`). The Claude H1 record is the unchanged response of
  `GET plan-qualifications/:id`, with every case's answer and reason.
- `list_*.json`: each connection's build qualification list, taken after A3, after A4 and after H1. The
  Claude list is empty.

Apart from those two role records, the files hold the API's JSON responses unchanged. No file has a
byte-order mark, and each ends with one line feed. The setup facts above (connection plan, caps,
verification dates, the backup name and the 18 of 50 daily requests) come from the run session, not
from these files. The files were checked for tokens, cookies, session or CSRF values, API keys,
e-mail addresses and local paths. None were found, so nothing was redacted.
