# Model connections: ChatGPT plan and the Codex builder (§2.2 / §2.4)

October 20 live update: owner sign-in and one gpt-6-astra direct verification succeeded.
The owner-authorized initial summarization qualification also passed (2/2 development,
6/6 held-out, eight new plan requests). This is limited to synthetic structured event
summaries. See [scope, commands and receipts](PLAN_SUMMARIZATION_QUALIFICATION.md).
Specification/code-build qualification and broader readiness remain separate; the
historical implementation status below predates this live check.

Status on 2026-10-20: **implemented and contract-verified; not activated.** Nothing has
signed in, registered a client, installed Codex on Jordan's machine or called a model.
Design and owner answers: [CODEX_INTEGRATION.md](CODEX_INTEGRATION.md). Decision:
ADR-0042 in `tracking/DECISIONS.md`. Migration 26 (`chatgpt_plan_connections`); the
Brave §2.5 work owns migration 25.

## What exists

| Piece                                                                           | Where                                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Contracts (settings, caps, states, admission, qualification)                    | `packages/contracts/src/connections.ts`                                           |
| Admission rules (pure)                                                          | `packages/domain/src/plan-admission.ts`                                           |
| Store, ledger and events (migration 26)                                         | `packages/db/src/connection-store.ts`                                             |
| Sign in with ChatGPT (PKCE, loopback callback, ID token check, refresh, revoke) | `packages/broker/src/plan-oauth.ts`                                               |
| Token vault (Windows DPAPI; dev-only file vault by explicit opt-in)             | `packages/broker/src/plan-vault.ts`                                               |
| Direct Responses adapter (Path A)                                               | `packages/broker/src/plan-responses.ts`, `plan-service.ts`                        |
| Codex builder: relay, app-server supervisor, jail bridge (Path B)               | `packages/executor/src/codex-host.ts`, `packages/executor/worker/codex_bridge.py` |
| T12 integration (optional `codex_plan_builder` in a build plan)                 | `packages/executor/src/build.ts`                                                  |
| API                                                                             | `apps/api/src/connections.ts` (`/api/workspaces/:ws/plan-connections/...`)        |
| Screen                                                                          | System → **Models and connections** (`apps/web/src/models.tsx`)                   |
| CLI                                                                             | `pnpm cli plan-*` (listed in `pnpm cli help`)                                     |
| Proposed settings and caps                                                      | `config/connections/chatgpt-plan.json`                                            |
| Pinned Codex installer for WSL                                                  | `scripts/install-codex-wsl.sh`                                                    |

## States, kept separate

A connection moves through independent, recorded states. None implies another.

1. **Signed in**: the browser sign-in finished, the ID token checked out, and the
   granted scopes are recorded. If `chatgpt.tokens.use.direct` was not granted, the
   connection is signed in but cannot be used for plan usage.
2. **Credits confirmed off**: Jordan records, with the date, the exact statement that
   Creator Agent is not allowed to use credits after plan limits in ChatGPT Settings →
   Usage. Until then every model request is refused.
3. **Caps accepted**: Jordan accepts the exact stored caps (bound to their hash). Any
   settings change withdraws the acceptance.
4. **Model access verified** (per model and path): one completed request made under a
   one-shot owner approval that expires within 60 minutes.
5. **Qualified** (per model and task class): a frozen benchmark run with a held-out
   pass-rate floor. Only a qualified task class can use the connection for real work.

Provider answers are recorded as they come: not eligible (403), usage limit reached
(429), usage unavailable (503), unsupported model (400 with `param: model`), invalid
sign-in (401). A refusal never falls back to the paid API. A request whose outcome is
unknown (timeout, cut stream) blocks the connection until Jordan reconciles it.

## Proposed caps (need Jordan's acceptance before activation)

Plus shares its five-hour allowance with Jordan's own ChatGPT and Codex use, so these
are set low. They are studio limits; OpenAI can still refuse earlier.

| Cap                            | Proposed                     | Why                                                                        |
| ------------------------------ | ---------------------------- | -------------------------------------------------------------------------- |
| Requests in flight             | 1                            | Fixed; no parallel plan usage.                                             |
| Requests per day, both paths   | 40                           | Leaves most of the shared allowance for Jordan.                            |
| Direct requests per run        | 10                           | A summarization or specification run needs a few calls.                    |
| Direct request timeout         | 120 s                        | Long enough for a streamed answer; then the outcome is unknown.            |
| Output per direct request      | 16,000 characters            | The plan route refuses `max_output_tokens`, so the studio ends the stream. |
| Input per direct request       | 24,000 characters            | Keeps prompts small; larger inputs are refused before sending.             |
| Codex builds per day           | 2                            | Path B is not active yet (see below).                                      |
| Codex turns per build          | 1                            | One supervised turn per T12 build cycle.                                   |
| Codex model requests per build | 25                           | Each Codex tool round trip is one request.                                 |
| Codex build timeout            | 10 minutes                   | Then the jail is killed and the build is a checkpoint.                     |
| Data classes                   | public, synthetic            | Jordan's answer Q6.                                                        |
| Task classes                   | summarization, specification | Jordan's answer Q7; `code_build` is not enabled.                           |

## Command blocking in the Codex builder

Default Codex 0.163.0 runs shell commands **without asking for approval** (probed:
`approval_policy="never"` with `danger-full-access` ran `touch` with no request). So the
studio enforces "no command execution" deterministically, in four independent places:

1. **Hardened config** removes the shell, unified exec, multi-agent, goals, apps,
   plugins, hooks, image and web tools. Captured from the pinned binary, the hardened
   tool list is only `exec` (a JavaScript isolate exposing `apply_patch`, MCP resource
   reads and a clock), `wait` and `request_user_input`.
2. **Studio relay.** Codex can reach a model only through the relay. It refuses any
   request that offers a tool outside the allowlist (including nested `exec` tools),
   and cuts the stream before Codex receives a call to anything else (function calls,
   `local_shell_call`, dynamic `tools[...]` access). The real token is added by the
   relay; the jail holds only a per-session capability.
3. **Supervisor.** The app-server client sends only `initialize`, `thread/start`,
   `turn/start` and `turn/interrupt`. It kills the session on any command item, unknown
   item type or unexpected server request, declines permission requests, and accepts a
   file change only inside the task's file scope.
4. **Jail.** Bubblewrap with its own network namespace (loopback only), the two static
   Codex binaries, an empty Codex home, `/proc`, a minimal `/dev`, a tmpfs and the
   disposable workspace. There is no shell or other program to run.

The result is a proposed patch. T12 applies it through the scoped compare-and-swap
patch tool, then runs the unchanged independent broker review and the frozen and
held-out acceptance cases in the T11 worker.

Tests: `tests/src/codex-host.test.ts` runs the pinned binary when `CREATOR_CODEX_DIR`
(and `CREATOR_CODEX_BWRAP` where bwrap is not at `/usr/bin/bwrap`) are set: an in-scope
patch lands; an out-of-scope patch is declined; a function call, a JavaScript
`tools.exec_command` call and a `local_shell_call` are each cut by the relay before
Codex sees them; and with the relay's checks removed, the hardened config alone still
runs none of the three. On Windows the tests use the production WSL2 launcher. On
2026-10-20 they passed 13/13 in Jordan's WSL Ubuntu with the pinned install, and on
Linux as root and as an unprivileged user.

## Pinned Codex CLI for WSL

|                                |                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Version                        | `codex-cli 0.163.0` (npm `@openai/codex@0.163.0-linux-x64`, published 2026-10-15 by `openai-publisher`) |
| Source                         | `https://registry.npmjs.org/@openai/codex/-/codex-0.163.0-linux-x64.tgz`                                |
| Package SHA-256                | `30efc97738b975940d78b59a9bea115fa34040b732807d54ec35ae6b7528de94`                                      |
| npm integrity (SHA-512)        | `sha512-uwRaOsrYogLQhcxAM/GoeWrw0QIWEMRo7c9gM8sKAviVkZQHlu9kRLJ5PkufbV+ABGjyZgIwiFdJ0LCJ0N6e8w==`       |
| `codex` SHA-256                | `399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215`                                      |
| `codex-code-mode-host` SHA-256 | `8724d73ec190536233ab4628d24a071bfbcf27e5124f08fe35129f26fe48b916`                                      |

`bash scripts/install-codex-wsl.sh` (inside WSL Ubuntu, as the normal user) downloads,
checks both package hashes and installs the two binaries to
`~/.local/share/creator-agent/codex/0.163.0`. The studio then needs
`CREATOR_CODEX_DIR` set to that folder. Removing the folder uninstalls it.

## What is still blocked, and on what

| Blocked                  | Needs                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any live request         | Database at migration 26 (owner-approved backed-up upgrade), the studio running this build, Jordan's sign-in, credits confirmation and cap acceptance                                 |
| Eligibility              | Only a real sign-in and one verification request show whether OpenAI accepts a private client on Plus. If refused, the exact code is recorded and shown; Creator Agent stays private. |
| Path A real work         | A verified model, then a qualification run on a frozen summarization or specification benchmark                                                                                       |
| Path B (Codex) real work | A Codex-path verification call and a `code_build` qualification, neither built yet; `code_build` is not in the allowed task classes                                                   |

## Proposed bounded live verification (needs Jordan's approval)

One request, once the blockers in the first row are cleared:

- Connection: the ChatGPT plan connection in Jordan's real studio workspace.
- Model: `gpt-6-astra` (Jordan's preferred model; it is in the pinned Codex model
  catalog, but plan-route availability is unknown).
- Path: direct Responses. Purpose: verification. Data: synthetic.
- Content: instructions "This is a connection check from Creator Agent. Reply with
  exactly the word: ok", input "Reply with exactly: ok".
- Limits: exactly one request (one-shot approval, expires in 30 minutes), 120 s
  timeout, 16,000 output characters, `store: false`, no credits, no paid fallback.
- Success means `response.completed`; it marks only that model as verified on the
  direct path. It does not qualify any task class.
- Steps: Models and connections → Approve one call (model `gpt-6-astra`) → Run the
  verification call. CLI equivalent: `pnpm cli plan-verify-approve` then
  `pnpm cli plan-verify`.
