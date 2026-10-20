# ChatGPT-plan and Codex integration design (runbook §2.4 preparation)

Status: **proposed design, not implemented.** Prepared 2026-10-20 for Jordan's review.
Nothing here signs in, registers an OAuth client, installs a binary, calls a model or
changes spending. Proposed decision record: [ADR-0042](../tracking/ADR-0042-codex-integration.md).

This document answers three questions from `docs/COMPLETION_RUNBOOK.md` §2.4:

1. **Supported route.** How Creator Agent can use Jordan's ChatGPT plan, and Codex,
   through mechanisms OpenAI documents for third-party apps.
2. **Eligibility.** Which accounts and apps qualify, and which Creator Agent work may
   be sent down this route.
3. **Isolation.** How the Codex agent is kept away from the studio host, personal
   files, credentials and the frozen study.

It builds on X01 routing (`docs/MODEL_ROUTING.md`), the T04 broker
(`packages/broker`), the T11 WSL2 worker (`docs/ISOLATED_EXECUTION.md`), the T12
bounded builder (`docs/BOUNDED_BUILDER.md`), the R2 ceiling (`config/spending.json`)
and owner decisions #5, #6, #7, #10, #14, #26, #30–#32 in
`tracking/OWNER_DECISIONS_2026-10-20.md`.

## 1. What was checked

| Check                                            | Result                                                                                                                                   | Evidence                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Installed Codex desktop app                      | `OpenAI.Codex` MSIX package 26.1013.4894.0                                                                                               | `Get-AppxPackage`, 2026-10-20       |
| Bundled Codex CLI                                | `codex-cli 0.163.0-alpha.10.2` at `%LOCALAPPDATA%\OpenAI\Codex\bin\896a0166b774037a\codex.exe` (hashed folder, changes with app updates) | `codex.exe --version`               |
| `codex` on PATH (PowerShell)                     | Not found                                                                                                                                | `Get-Command codex`                 |
| `codex` inside the reviewed `Ubuntu` WSL2 distro | Not found                                                                                                                                | `wsl -d Ubuntu -- command -v codex` |
| `codex app-server`                               | Present; help text marks it **[experimental]**                                                                                           | `codex.exe app-server --help`       |
| Official docs                                    | Read 2026-10-20 (sources at the end)                                                                                                     | Copies were not committed           |

Only version and help commands were run. No sign-in, token read, `~/.codex` read, model
call or install happened. Jordan's existing Codex desktop login was not inspected and
must not be reused (runbook §2.4).

## 2. The supported routes

OpenAI documents one supported way for a locally hosted third-party app to use a
ChatGPT plan: **Sign in with ChatGPT (SIWC) with ChatGPT plan usage.** It has two
inference paths, and both use the same OAuth access token.

| Path                    | What it is                                                                                                                                                                | Proposed Creator Agent use                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Direct Responses** | The app sends `POST https://api.openai.com/v1/responses` with the OAuth access token as bearer, `store: false`, `stream: true`.                                           | General model inference: research synthesis, candidate generation, scoring, specification drafting, summarization. A new broker adapter beside the existing `OpenAIAdapter`. |
| **B. Codex app-server** | The app starts `codex app-server --listen stdio://` with a custom `model_provider` whose `env_key` holds the same access token, then drives threads and turns over JSONL. | Agentic coding only (`code_build`), behind the T12 builder and T11 worker.                                                                                                   |

The runbook requires "general model inference and agentic coding must retain separate
capability/security scopes". OpenAI issues one token with one scope set
(`openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`).
So the separation is done by Creator Agent: two separate connection capabilities,
two separate grants, separate process boundaries, and separate audit entries. Path A
never starts a Codex process. Path B never gets the refresh token.

Routes the design rejects, and why:

- **Reusing the Codex desktop login** (`~/.codex/auth.json`, the desktop app's
  session) or Codex's own `chatgpt` login mode inside app-server. The runbook forbids
  copying existing desktop tokens. The app-server docs also say app-server auth "has
  never been permitted for commercial or hosted services" and recommend SIWC.
- **`chatgptAuthTokens` external-token login mode.** Experimental, and it needs a
  `chatgptAccountId` the SIWC flow does not hand out. The documented SIWC path for
  app-server is the `env_key` provider configuration, so use that.
- **ChatGPT `backend-api` endpoints, web UI scraping, cookies.** Explicitly unsupported.
- **Running Codex on the Windows host with its Windows sandbox.** That process would
  sit next to Jordan's personal files and the studio's own credentials. See §5.

## 3. Account and app eligibility (gates Jordan must clear)

These are facts from the docs that decide whether the route works at all. None can be
settled by code.

1. **App eligibility.** The docs say ChatGPT plan usage "is available to all
   open-source partners and selected private clients", and that the docs cover
   "open-source and locally hosted apps"; paid or remotely hosted apps must use the
   interest form. Creator Agent is a **private** repository run locally by its owner.
   Whether a private, unpublished, non-distributed local app qualifies is not stated.
   _Open question Q1 for Jordan._ Options: (a) try registration and treat a
   `subscription_sharing_user_not_eligible` or registration refusal as the answer,
   (b) ask OpenAI through the interest form, (c) publish the relevant client code as
   open source. The design works the same in every case; only activation depends on it.
2. **Plan eligibility.** Plan usage is described for eligible ChatGPT **Plus and Pro**
   users. Jordan confirmed **Plus** on October 20, 2026. Q2 is resolved as an
   owner-reported plan; app eligibility and successful connection remain unverified.
3. **Shared quota.** For Plus, the five-hour usage limit is **shared across every app**
   using the plan, including Jordan's own Codex desktop use. Studio work and Jordan's
   personal coding compete for the same allowance. Pro has no five-hour limit.
4. **Credits after the limit.** ChatGPT Settings → Usage lets each app "use credits
   after reaching plan limits". Credits are real money spent outside the studio's
   broker, and the studio cannot see per request whether credits were used. Under R2
   ("unknown costs block paid dispatch") the studio must treat that as unknown cost.
   Proposed rule: the connection stays **blocked** until Jordan records that credits
   are **off** for Creator Agent in ChatGPT Settings, with the date checked. _Q3:
   confirm this rule, or decide that credit use should count against the $20 ceiling
   with some recording method._
5. **Model entitlement.** `/v1/models` and app-server's `model/list` are catalogs, not
   entitlement checks. A model becomes `verified` in the X01 registry only after one
   completed request (`response.completed`, or `turn/completed` with
   `status: completed`). That single verification call is a live call and needs
   Jordan's explicit go-ahead (runbook: "one explicitly authorized live verification").
6. **App-server stability.** `codex app-server` is labelled experimental in both the
   CLI help and the docs ("not supported for production workloads"). Pin an exact
   Codex version and treat any upgrade as a reviewed change.

## 4. Which Creator Agent work is eligible

Eligibility is decided by application code at admission time, never by a model. A
request that fails any rule is refused with a recorded reason; it is never quietly
sent somewhere else.

### 4.1 Connection-level rules (both paths)

| Rule                                                                                                                                                                                                                                                                                                                                                  | Source                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Connection is `verified` (completed request recorded) and `chatgpt.tokens.use.direct` is in the granted scopes.                                                                                                                                                                                                                                       | Docs; X01 availability rule                                   |
| Credits-after-limit attestation is present and current (§3.4).                                                                                                                                                                                                                                                                                        | R2, #32                                                       |
| Data class is one Jordan allowed for this connection. Proposed default: `synthetic` and `public` only; `private_approved` needs a per-project sharing rule.                                                                                                                                                                                           | #14                                                           |
| Not a T15 study condition, routing held-out benchmark case, or any frozen protocol path, unless the adopted freeze names this route. Today's frozen choice is GPT-6 Astra via API, so the answer is no.                                                                                                                                               | Invariant 9, runbook §2.2 "do not change frozen study models" |
| Quota state is not `exhausted` or `unavailable`. On `subscription_sharing_usage_limit_exceeded` the route pauses; the work goes to an already-qualified local (Ollama) route if one is permitted for that task, otherwise it pauses. Paid API fallback only if Jordan has enabled the fallback setting with providers, scope, caps and privacy rules. | #5, #7, #32                                                   |
| One active model job at a time during the pilot.                                                                                                                                                                                                                                                                                                      | #31                                                           |

### 4.2 Path A (direct Responses) task classes

Eligible after X01 qualification for the class: `research_synthesis`,
`candidate_generation`, `scoring`, `specification`, `summarization`. Not eligible:
`embedding` (no embeddings on this route), `independent_review` of work produced by
the same connection (a reviewer must be a different route, keeping T12's independence
rule), and anything needing hosted tools the preview rejects (file search, Code
Interpreter, hosted MCP/connectors, image generation, `tool_search`). Web search is
"subject to model and account/workspace policy", so `tool.search_public` stays on the
existing research adapter (#8).

### 4.3 Path B (Codex) work

Eligible: **one T12 builder task at a time**, with all of:

- a frozen T08 spec and a task whose `file_scope` is set, as T12 requires today;
- the `checklist/1` Python template or another reviewed recipe;
- owner-authored acceptance cases frozen in the spec, with at least one held-out case;
- a run, envelope and grant naming the Codex connection for `product.commit_build`.

Not eligible for Codex: independent review, QA or acceptance verdicts; integration
merges; conflict resolution; anything with external effects (GitHub writes, release,
messages, payments, ads); study-arm builds; human-only arm tasks; work touching the
studio's own repository; tasks needing network access, package installs or persistent
services.

Codex's output is treated exactly like the current builder model's output: a
proposed set of file contents. It is not trusted as evidence of anything.

## 5. Isolation design for Path B

### 5.1 Where Codex runs

Codex app-server runs as a new **agent host** inside the reviewed WSL2 distro, under
the same Bubblewrap + systemd user-unit pattern as the T11 worker, but as a separate
unit type with its own limits. It is a different boundary from the product worker:

|                   | T11 product worker (unchanged)                                  | New Codex agent host                                                                        |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Runs              | Generated product code                                          | Pinned Linux `codex` binary only                                                            |
| Network           | None                                                            | Egress only to `api.openai.com:443` through a studio-owned allowlist proxy on a Unix socket |
| Credential inside | None                                                            | The current one-hour access token, in the app-server environment only                       |
| Writable          | 16 MiB work tmpfs                                               | A disposable copy of the task's `file_scope` files, and an empty private `CODEX_HOME`       |
| Mounted           | Read-only `/usr`, input snapshot, recipe                        | Read-only `/usr`, the Codex binary, disposable workspace, `CODEX_HOME`                      |
| Never mounted     | Home, Windows drives, studio dir, Git metadata, sessions, D-Bus | Same, plus the refresh token, the studio database and `.creator/`                           |

A Linux Codex binary is needed inside WSL2 because none is installed there. Installing
it is a download into the reviewed distro and needs Jordan's approval, with the exact
version and SHA-256 recorded (_Q4_).

### 5.2 Codex configuration (defence in depth inside the jail)

The outer jail is the boundary the design relies on. Codex's own settings add a second
layer. All of these go on the command line or in the private `CODEX_HOME`, so no
personal configuration is read:

- `CODEX_HOME` set to a fresh, empty, per-build directory. This avoids Jordan's
  `~/.codex` config, auth, skills, plugins, MCP servers, history and memories.
- `model_provider` set to the documented ChatGPT-plan provider with `env_key`.
- `sandbox_mode = "workspace-write"` limited to the disposable workspace, and
  `sandbox_workspace_write.network_access = false`.
- `approval_policy` set so command execution and permission requests reach the
  studio as approval requests (`on-request` or `granular`; exact form verified against
  the pinned version). The studio answers per §5.3.
- `features.apps`, `features.hooks`, `features.memories`, `features.multi_agent` off;
  no `mcp_servers`; `web_search` off; `history.persistence` none;
  `analytics.enabled = false`; `check_for_update_on_startup = false`.
- `shell_environment_policy` set so commands Codex runs get none of the jail's
  environment (no `ACCESS_TOKEN`).
- Start with `--strict-config` so an unknown key fails rather than being ignored.

Every key above exists in the current config reference, but the exact values must be
checked against the pinned version before implementation, because app-server is
experimental.

### 5.3 The studio is the only client, and it uses an allowlist

Creator Agent's supervisor is the only process speaking to app-server's stdio. It
sends only: `initialize` / `initialized` (with `clientInfo.name = "creator_agent"`),
`thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, and
`account/rateLimits/read`. It never sends `thread/shellCommand`, `command/exec` or
`process/spawn` (these run outside Codex's sandbox), and never the credit, reset or
nudge methods (`account/rateLimitResetCredit/consume`,
`account/sendAddCreditsNudgeEmail`). It does not opt into `experimentalApi` unless a
specific reviewed need appears.

Server-initiated requests are answered by fixed rules:

| Request                                                       | Studio answer (v1)                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `item/fileChange/requestApproval`                             | `accept` only if every path is inside the task `file_scope` and passes T11's path dialect; else `decline`. |
| `item/commandExecution/requestApproval`                       | `decline`. Codex does not run code in v1; all execution goes through the T11 worker after the build.       |
| `item/permissions/requestApproval`                            | Grant nothing.                                                                                             |
| `mcpServer/elicitation/request`, `item/tool/requestUserInput` | `decline` / cancel.                                                                                        |
| `account/chatgptAuthTokens/refresh`                           | Not applicable (not using that mode); fail the turn.                                                       |

Declining all command execution means Codex cannot run its own tests. That is
deliberate for v1: it keeps generated code out of the process that holds a token, and
T12 already runs the frozen cases (including held-out ones) in the T11 worker.
Allowing Codex to run code inside a second, tokenless nested sandbox is a possible
later change and would need its own review.

### 5.4 How a Codex build flows through T12

1. T12 prepares the builder packet exactly as today: frozen task, file scope, visible
   cases only. Held-out inputs and outputs never enter it.
2. Admission and broker reservation run as today, against the Codex connection's
   quota envelope (§6). Pending admission means no Codex process starts.
3. The supervisor copies the task's in-scope files at the exact base commit into a
   fresh disposable workspace. No Git metadata goes in.
4. It starts the agent host with the current access token, sends the packet as one
   `turn/start`, and enforces a wall-clock deadline, an event-count cap and a
   maximum turn count with `turn/interrupt` and unit stop.
5. Success requires `turn/completed` with `status: completed`. `failed`,
   `interrupted`, a stream ending early or a quota error are recorded outcomes.
6. The supervisor diffs the workspace against the snapshot, refuses anything outside
   `file_scope` or failing the path rules, and turns the rest into T11's typed
   `changes.json` (preimage hashes, CAS). Codex never touches Git.
7. From here the existing T12 pipeline runs unchanged: commit, T11 build and frozen
   cases in the worker, fresh-context independent review by a **different** route.
8. The workspace and `CODEX_HOME` are deleted after the unit is seen stopped. The
   app-server's JSONL transcript (with the token redacted) and hashes are kept in
   `.creator/products/<product>/builds/<build>/` as build evidence.

### 5.5 Credential handling (both paths)

- Tokens live only in the studio control process, in OS-protected storage
  (Windows DPAPI / Credential Manager through the desktop shell), not in files under
  the repository, not in web storage and never in logs, URLs or audit records. The
  docs' plain-file example (`0600`) is a minimum; §2.1's secure identity storage is
  the place to keep them.
- Sign-in uses the system browser, PKCE S256, fresh `state` and `nonce`, a
  `127.0.0.1` loopback callback (never `localhost`), ID-token signature and claims
  validation against OpenAI's JWKS, and a check that `chatgpt.tokens.use.direct` was
  granted. First registration uses `client_id=dynamic_agent_client` and
  `agent_name_hint="Creator Agent"`; the issued `client_id` is saved per account.
- `ext_agent_host_id`: one per installed studio, generated once before first sign-in,
  `urn:uuid:` form (the RFC 9278 thumbprint form can come later). Not derived from
  Jordan's email or ids.
- Refresh is serialized per account (rotating refresh tokens). Path B gets only the
  access token; on renewal the studio restarts app-server and `thread/resume`s.
- Disconnect revokes the refresh token at the published revocation endpoint, then
  clears tokens locally, and tells Jordan if remote revocation was not confirmed.
- No secret enters the T11 product worker, generated code, preview, or the browser UI.

## 6. Accounting: quota, not dollars

The broker today reserves dollar exposure from `max_output_tokens` and a pricing
snapshot. Plan usage breaks both assumptions: the preview **rejects
`max_output_tokens`**, and there is no per-token price. So the design adds a separate
billing mode instead of bending the money path:

- New provider value (proposed `openai_chatgpt_plan`) with
  `billing_mode: "subscription_quota"` in the registry and connection records.
- A quota envelope type with **owner-set caps in the units the studio can enforce**:
  requests or turns per run and per day, wall-clock time per request, and observed
  output tokens per request (enforced client-side by aborting the stream). _Q5: the
  initial caps._ These are studio limits, not OpenAI's limits.
- Metered dollars for this route are recorded as **zero only while the credits-off
  attestation holds**. Without it, exposure is unknown and paid dispatch blocks (R2).
- Quota state comes from errors (`..._usage_limit_exceeded`, `..._usage_unavailable`)
  and, for Path B, `account/rateLimits/read`. The UI shows "subscription quota" apart
  from API dollars and local resources (#10), links to ChatGPT Settings → Usage, and
  never invents a reset time or claims unlimited use.
- Usage numbers the stream reports are recorded as observations; missing numbers stay
  `unknown`, never zero.
- Mid-stream failures (`response.failed` after output started) are outcomes, not
  retries. Retries follow the documented table: no retry on 400 / 401 / 403 errors;
  bounded backoff only on the 503 ones.

## 7. Contract and code changes for the implementation milestone

Listed so the next milestone can be scoped; none are made here.

- `contracts/budget.ts`: extend `ProviderSchema`; add billing mode and a quota
  envelope / reservation shape.
- `contracts/routing.ts`: registry entries carry `billing_mode` and `connection_id`;
  `subscription_quota` models need the credits attestation to route.
- New migration: connections table (account label, issued client id, host id, scopes,
  status, last verified, credits attestation with date, quota state), with tokens only
  as references to OS-protected storage.
- `packages/broker`: `ChatGptPlanAdapter` (Path A), streaming-only, no
  `max_output_tokens`, `instructions` instead of system messages, mapped error codes.
- `packages/executor`: agent-host recipe (bwrap profile, egress proxy, systemd unit
  limits) and app-server JSONL client with the allowlist in §5.3.
- T12 builder: a `codex` builder role that produces typed changes via §5.4.
- Models/Connections UI (§2.2): Continue with ChatGPT, account picker, scopes, plan
  usage on/off, quota state, disconnect.
- Tests to write: refused admission without verification / attestation / scope;
  out-of-scope file changes declined; command approvals declined; forbidden RPC
  methods never sent; token absent from transcripts, logs and the product worker;
  quota error pauses and does not fall back to paid; refresh race; crash mid-turn
  leaves an unknown outcome and no redispatch; study conditions refuse the route.

## 8. Open questions for Jordan

| #   | Question                                                                                                                                      | Default if unanswered                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Q1  | Does a private, local, non-distributed Creator Agent qualify for ChatGPT plan usage? Try registration, ask OpenAI, or open-source the client? | Build locally; activation waits.                                                              |
| Q2  | Which ChatGPT plan (Plus or Pro) will be connected?                                                                                           | Resolved: Jordan confirmed Plus on October 20, 2026; connection verification remains pending. |
| Q3  | Credits after limit: keep the connection blocked until you confirm credits are off for Creator Agent in ChatGPT Settings?                     | Blocked.                                                                                      |
| Q4  | Approve installing a pinned Linux Codex CLI into the `Ubuntu` WSL2 distro for the agent host (exact version and hash shown first)?            | Path B not built past contract tests.                                                         |
| Q5  | Initial quota caps: requests/turns per run and per day, per-request time and output limits.                                                   | Pilot defaults from #31 (one job, 30-minute run) plus a small per-day request cap you set.    |
| Q6  | Allowed data classes for this connection.                                                                                                     | `synthetic` and `public` only.                                                                |
| Q7  | Which Path A task classes to qualify first.                                                                                                   | `summarization` and `specification`.                                                          |

## 9. Rollback

Every piece is behind a connection that is off until verified. Disconnecting revokes
the refresh token and stops new admissions; routing falls back to the X01 baseline or
pauses. Removing the feature drops one connection type and one builder role; existing
broker, T11 and T12 paths are unchanged.

## Sources (read 2026-10-20; recheck at implementation)

- Sign in with ChatGPT quickstart: https://developers.openai.com/siwc/quickstart
- ChatGPT plan usage overview: https://developers.openai.com/siwc/token-sharing-open-source
- Registration and sign-in: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- Accounts and sessions: https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- Models and inference: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- Codex app-server with plan tokens: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- Token reference: https://developers.openai.com/siwc/token-sharing-open-source/token-reference
- Errors and recovery: https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- Preview limitations: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- Codex app-server protocol: https://learn.chatgpt.com/docs/app-server
- Codex config reference: https://learn.chatgpt.com/docs/config-file/config-reference
- Codex environment variables: https://learn.chatgpt.com/docs/config-file/environment-variables
