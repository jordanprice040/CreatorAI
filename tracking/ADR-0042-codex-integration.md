# ADR-0042: ChatGPT-plan and Codex integration route, eligibility and isolation

Status: **Proposed** (2026-10-20). Not accepted, not implemented. Kept as its own file
because `tracking/DECISIONS.md` has uncommitted local edits and is being changed by
the §2.1 work; fold it into DECISIONS.md (newest first) when this design is accepted.

Design: [docs/CODEX_INTEGRATION.md](../docs/CODEX_INTEGRATION.md).

## Context

Runbook §2.4 asks for a supported subscription-backed ChatGPT/Codex connection.
Owner decisions #5 and #7 put local and supported subscription routes first, with no
silent paid fallback; R2 caps new runtime spend at $20 and blocks unknown cost.
OpenAI documents Sign in with ChatGPT (SIWC) plan usage for open-source and locally
hosted apps, usable directly against `/v1/responses` or through `codex app-server`.
App-server is labelled experimental. Jordan's machine has the Codex desktop app
(26.1013.4894.0, bundled CLI 0.163.0-alpha.10.2) and no Codex in WSL2.

## Decision (proposed)

1. Use only SIWC with ChatGPT plan usage: system-browser OAuth with PKCE, dynamic
   client registration as "Creator Agent", a per-studio `ext_agent_host_id`, tokens in
   OS-protected storage in the studio control process. Never reuse the Codex desktop
   login or any other app's tokens.
2. Two separate capabilities on one token: Path A (direct Responses broker adapter)
   for general inference, Path B (Codex app-server) for `code_build` only. Separate
   grants, processes and audit entries. Path B receives only the short-lived access
   token.
3. Path B runs in a new WSL2 agent-host jail (Bubblewrap + systemd unit) with egress
   only to `api.openai.com`, a private empty `CODEX_HOME`, a disposable copy of the
   task's in-scope files, and no Git, studio, home or Windows mounts. The studio is
   the only app-server client, sends an allowlist of methods, declines all command
   execution in v1, and accepts file changes only inside `file_scope`. Output becomes
   T11 typed changes and then runs through the unchanged T12 build, QA and
   independent review by a different route.
4. Plan usage is accounted as subscription quota with owner-set studio caps, separate
   from API dollars. The connection is blocked until Jordan attests that credits after
   plan limits are off for Creator Agent; otherwise its cost is unknown and R2 blocks.
5. Excluded: T15 study conditions and other frozen protocol paths, routing held-out
   cases, independent review of the same route's output, QA verdicts, integration,
   and any external action.
6. A model is `verified` only after one completed request, which is a live call that
   needs Jordan's explicit authorization.

## Consequences

- No new dollar spend path; quota competes with Jordan's own Plus usage (shared
  five-hour limit) unless the plan is Pro.
- Codex cannot run its own tests in v1, which may lower first-attempt quality; T12
  repairs and the frozen cases cover verification.
- Requires broker, contract, migration, executor and UI changes (design §7) and a
  pinned Linux Codex install in WSL2.
- Jordan confirmed Plus on October 20, 2026 (Q2 resolved, owner-reported).
  Activation still depends on app eligibility (private local app), the credits
  attestation and successful connection verification. This clarification does not
  accept the proposed ADR or authorize registration, installation or inference.

## What would change this decision

OpenAI declining private local clients (then: open-source the client, or rely on
Ollama and the metered API); app-server leaving experimental status or changing its
auth model; a reviewed nested sandbox that lets Codex run code without the token.
