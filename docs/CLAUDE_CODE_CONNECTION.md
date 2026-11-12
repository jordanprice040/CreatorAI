# Claude subscription through Claude Code on this computer (ADR-0050)

Status on 2026-10-28: **live on Jordan's dev studio for one verified model.** At 12:29 UTC
Jordan's real workspace verified `claude-sonnet-5-5` through his own signed-in Claude Code
2.1.252. That was one request (46d11105…, completed), made with his typed OK and with extra
usage confirmed off. With his typed OKs it then qualified for **summarization**
(`summarization-synthetic-v1`, qualification a3c6a8cd…, 2/2 development, 6/6 held out) and
**specification** (`specification-synthetic-v1` from PR #80, af46b4e5…, 2/2, 6/6), at 8
requests each. In total that was 17 requests that day, all completed. The specification benchmark is
narrow (one acceptance-check record per request) and had only Jordan's review before freezing.
The installed app is not set up for it. Decision: ADR-0050 in `tracking/DECISIONS.md`. Migration 32
(`plan_connection_kinds`).

## What it is

A second kind of plan connection on **System → Models and connections**. Instead of the
studio holding a ChatGPT token, it starts the owner's own, unmodified Claude Code CLI, which
the owner signed in to personally with their Claude Pro or Max account. Requests then use the
plan's included usage, with no per-request charge while extra usage stays off.

Everything after the sign-in is the same as the ChatGPT plan route: caps the owner accepts,
a confirmation that paid overflow is off, one approved verification call per model, and a
frozen-benchmark qualification per task class before real work. Only the direct path exists
(no Codex, no `code_build`).

## Why it is built this way (terms read 2026-10-28)

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance):
  third-party developers may not offer Claude.ai login in their apps, route requests through
  Free/Pro/Max credentials on behalf of their users, or "collect, store, or intermediate
  Claude.ai credentials or session tokens". It does not prevent "an end user from signing in
  to the unmodified Claude Code binary with their own Claude subscription". Pro/Max limits
  "assume ordinary, individual usage of Claude Code and the Agent SDK", and Anthropic may
  enforce "without prior notice".
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview): apps may not
  offer claude.ai login or rate limits for their products.
- [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (effective Oct 8, 2025):
  no automated access except by API key or where Anthropic explicitly permits it. Claude Code
  documents scripted use (`claude -p`, [headless](https://code.claude.com/docs/en/headless)).

So the studio never offers a Claude sign-in, never reads `.credentials.json`, never uses
`claude setup-token`, and never calls Anthropic's API with a subscription credential. It only
runs `claude` and reads what it prints. This is a reading of public documents, not legal
advice. Heavy unattended use is the part most likely to be judged outside "ordinary,
individual usage"; the low default caps exist partly for that. Use it only for Jordan's own
personal studio, never in a build given to other people.

## How a request runs

`packages/broker/src/claude-code.ts`:

1. **Fresh sign-in check.** Before every request, `claude --version` and
   `claude auth status --json` run in the studio's dedicated folder. Claude Code older than
   2.1.248 (the first with `--restricted`) is refused with "run claude update". Only
   `authMethod: "claude.ai"` with the first-party provider counts. An API key, long-lived OAuth token, key helper or cloud provider is refused before
   anything is sent, and the connection moves to "check again".
2. **Clean environment.** The child gets an allowlist (PATH, home and temp folders, locale,
   proxy settings) plus `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
   `DISABLE_AUTOUPDATER=1` and `ANTHROPIC_CONFIG_DIR` pointing at an empty
   `studio-anthropic-config` folder, so an active Anthropic (Workload Identity Federation)
   profile in `%APPDATA%\Anthropic` cannot outrank the subscription login. If anything appears
   in that folder, checks and requests stop. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
   `CLAUDE_CODE_OAUTH_TOKEN` and provider switches never reach it.
3. **Locked-down run.** `claude -p --output-format stream-json --verbose --model <id>
--restricted --tools "" --strict-mcp-config --disallowedTools "mcp__*"
--disable-slash-commands --no-session-persistence --max-turns 1 --permission-mode dontAsk
--system-prompt-file <file>`, prompt on stdin, in an empty working folder. The instructions
   go in a per-request file in `studio-prompts` that is deleted afterwards, so they are not on
   the command line. Files left by a crash are swept after 15 minutes, and a failed delete
   never stops the studio. `--bare` is
   not used because it ignores the subscription login. No `--fallback-model`.
4. **Checks on what came back.** The start event must list no tools and no MCP servers and
   must report `apiKeySource: "none"`, or the run is stopped. The first live verification
   (2026-10-28) confirmed that a claude.ai login reports `none`. The answering model
   must be the requested one (`modelUsage`), or the result is `model_substituted`. Answers
   over the output cap are refused.
5. **Outcomes** follow the plan ledger. A usage limit, sign-in, account or model refusal is
   cut at Claude Code's first retry notice and recorded as rejected (usage limit pauses the
   connection; no paid fallback). A timeout or a run that ended without a result is unknown
   and blocks the connection until Jordan reconciles it.

Spend is recorded as $0 only because extra usage is confirmed off; Claude Code's own
`total_cost_usd` is a client-side estimate and is not stored as spend.

## Owner steps (each live step needs Jordan's typed OK)

1. Install Claude Code with the **native installer** (`claude.exe`; the npm `claude.cmd` shim
   is refused because the studio never starts a shell).
2. Studio configuration: the installed app sets `CREATOR_CLAUDE_CODE_CONFIG_DIR` to a
   `claude-code` folder beside its data. For the dev studio set it yourself, for example
   `$env:CREATOR_CLAUDE_CODE_CONFIG_DIR = "C:\dev\creator_agent\.creator\studio\claude-code"`.
   A fixture workspace never runs the real Claude Code: without a test stand-in it is refused
   (`live_disabled`), like a fixture ChatGPT connection. Use a real-mode workspace for live
   steps. `CREATOR_CLAUDE_CODE_BIN` is optional (default: `claude.exe` on PATH, then
   `%USERPROFILE%\.local\bin\claude.exe`).
3. Models and connections → **Add Claude Code on this computer** → **Check Claude Code**. It
   shows the folder. In PowerShell:
   `$env:CLAUDE_CONFIG_DIR = "<that folder>"; claude auth login; Remove-Item Env:CLAUDE_CONFIG_DIR`
   and pick the Claude account (the last part returns that window to your own Claude Code).
   Check again.
4. In Claude Settings → Usage, make sure extra usage (usage credits) is off, then record the
   confirmation. Accept the caps.
5. Approve one verification call for a full model id (for example the model you want from
   your plan) and run it. Then qualify task classes with frozen benchmarks
   (`pnpm cli plan-qualify`), as for ChatGPT.

CLI: `pnpm cli claude-connect`, `claude-check`, `claude-usage-off`; every `plan-*` command
works on either kind.

## Proposed caps (need Jordan's acceptance)

`config/connections/claude-code.json`: one request at a time, 30 a day, 10 per run, 180 s
timeout, 16,000 output and 64,000 input characters (24,000 before November 11; ADR-0093), synthetic and public data, summarization
and specification. The limits are shared with Jordan's own Claude and Claude Code use.

## Tests

- `tests/src/claude-code.test.ts` with a fake `claude` (`tests/src/claude-fake.ts`):
  environment allowlist, locked-down flags, shim refusal, status parsing, outcomes (success,
  usage limit, sign-in, model refusal, substituted model, output cap, unsafe session, API-key
  session, timeout, crash), settings and statement checks per kind, the immutable kind, a
  sign-in change between check and request (refused, nothing sent), and the usage-limit pause.
  Review fixes add tests for: a fixture connection with no stand-in (refused, no process
  started), a Console `/login managed key` source, a non-empty Anthropic profile folder, the
  instructions arriving by file, and an outdated Claude Code.
- An optional contract check runs the **real** Claude Code CLI against a loopback stand-in for
  Anthropic's API (`CREATOR_TEST_CLAUDE_BIN=<path>`); it never contacts Anthropic.
- Browser walk: `tracking/evidence/claude-code-ui/walk.mjs` (fake `claude`).
