# Creator Agent completion runbook

Updated October 26, 2026, against `main` at `54639a1` (PRs #1–#54 merged, none open).
Owner: Jordan Price. Work only in `C:\dev\creator_agent`; the OneDrive checkout is retired.

This page says what is done, what is left and what to do next. It is a plan, not
evidence: the evidence lives in `tracking/BUILD_STATUS.md`, `tracking/SESSION_HANDOFF.md`,
`tracking/evidence/` and the linked docs. Accepted owner choices (#1–#52, RD1–RD10) are
in [the decision register](../tracking/OWNER_DECISIONS_2026-10-20.md) and
`tracking/DECISIONS.md`; don't reopen them.

**Priority (Jordan):** a complete, usable, decently polished app comes before the thesis
study.

## Where things stand

| Area                                           | State                                                                                                                                                                                                                                                                        | Where to look                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Core studio engine                             | Done and checked with fixtures on real PostgreSQL: runs, budgets and reservations, workflows, specs and task DAGs, isolated builds, independent review and QA, packaging, downloads, feedback revision, audit, search, backup/restore.                                       | `config/readiness.json` (dated Oct 20), T01–T19 rows in `BUILD_STATUS`      |
| Web app                                        | Pages for overview, submit, theme drafts, selection, compare, evidence, search, gallery, catalog, workflows, operations, oversight, budgets, models, settings, GitHub, payments, marketing, portfolio, study. Usability pass #48–#54 closed with no Medium or higher.        | `apps/web/src/`, `docs/UX_UI.md`                                            |
| Spending control                               | One owner-set runtime ceiling per workspace, editable in Settings (ADR-0043, migration 30). No per-model or per-run limits.                                                                                                                                                  | `tracking/DECISIONS.md` ADR-0043                                            |
| Model connections                              | ChatGPT-plan connection and isolated Codex builder (PR #44, ADR-0042). Discovery role 1.4 passed live operational suites for design, scoring and research on the plan route (Oct 22–23); reviewed by a model, not by a person. Ollama shows as "not available yet".          | `DISCOVERY_RESEARCH14_LIVE_RESULT_2026-10-23.md`, `apps/web/src/models.tsx` |
| Evidence search                                | Bounded public search exists (PR #43). No live end-to-end discovery run yet.                                                                                                                                                                                                 | `docs/SEARCH_AND_AUDIT.md`                                                  |
| Theme intake (C54)                             | Theme drafts and Submit page built. Installed app has the theme-intent candidate at schema 29 (Oct 24); `main` is now ahead of it. Full C54 is partial.                                                                                                                      | `C54_READINESS_AUDIT_2026-10-23.md`                                         |
| GitHub (X04)                                   | Adapter plus GitHub page; walked in fixture mode. Never run against real GitHub.                                                                                                                                                                                             | `docs/GITHUB.md`                                                            |
| Payments (X07)                                 | Adapter plus Payments page (connections, offers, ledger, buyer access, reinvestment capacity), simulated or Stripe test mode only. Owner funding, funding sources, commitments, reinvestment policy and allocation added Oct 27 (step 2). Test-mode checkout screen with a simulated test buyer added Oct 27 (step 3).          | `docs/PAYMENTS.md`                                                          |
| Desktop app (X05)                              | Tauri app; interactive Windows acceptance passed Oct 19. The installed copy is Jordan's operational studio and is off-limits for testing. The usability-pass build has not been packaged or exercised in the desktop shell.                                                  | `apps/desktop/INTERACTIVE_ACCEPTANCE.md`, `docs/DESKTOP_STUDIO.md`          |
| Hosted (X06), campaigns (X08)                  | Code and fixture checks only. Not activated, by owner decision.                                                                                                                                                                                                              | `docs/HOSTED_OPERATION.md`, `docs/X06_X07_AUDIT.md`                         |
| Central chat (C52), theme-free discovery (C53) | Not built.                                                                                                                                                                                                                                                                   | `config/readiness.json`                                                     |
| Theme-intent native acceptance                 | NOT READY. Reviewed designs and fixture slices exist (upgrade helper v3, observation classifier v4, CW-01 fixture core v4, CW-01 adapter design v1.3). Missing: the `cw01-native` adapters and core v5, the collector, the PR-01/SH-01 inspector, and Jordan's attestations. | `BUILD_STATUS` Oct 24–26 entries                                            |
| Thesis study                                   | Deprioritized. Blocked on RD1–RD10 answers (RD5 needs committee/IRB), T15 partial, T16 blocked, and 36 of 66 X10 rows needing owner inputs.                                                                                                                                  | `docs/X10_ACCEPTANCE.md`, `docs/PILOT_AND_PROTOCOL.md`                      |

## Known issues

Checked against the code on October 26 unless noted.

- **Study export over-shares the audit log.** `exportStudy` reads every audit event in
  the workspace, not just the study's (`packages/db/src/study-store.ts`, the
  `audit_events where workspace_id=$1` query).
- **Health is configuration, not verification.** `/api/health` reports `live_configured`
  when a live adapter is configured and `fixture` otherwise. It never says whether a
  connection actually works.
- **Preview origin shares the studio host.** The preview server runs on its own port, so
  its cookie isn't isolated from the studio. This is a recorded design limit: the
  preview serves only studio-written pages, never generated HTML or JS
  (`tracking/DECISIONS.md`, preview entry). Generated web previews would need a separate
  host.
- **Overrun guard.** T17 fixed child overruns so they count against every ancestor. It
  also recorded that the guard isn't serialized against a concurrent settle. Not
  rechecked here.
- **A test fails on `main`.** `build.test` "ChatGPT-plan Codex builder still goes through
  scoped patches" was reported failing on Oct 26. Not rerun here.
- **Missing test.** Nothing tests that an offer for a replaced release is refused (needs
  two builds of one spec).
- **Stale status files.** `config/readiness.json` is dated Oct 20; `docs/CURRENT_STATUS.md`
  stops at Oct 23. Use `BUILD_STATUS` until they're refreshed.

Two items from older audit lists look done in code: batch input files are deleted at the
provider once no item is in flight or unknown (`packages/broker/src/context.ts`), and
child overruns reach the parent (T17).

## Next steps, in order

Each step is a separate, bounded task. None of them needs live provider, GitHub or
payment calls unless it says so, and those need Jordan's go-ahead first.

1. **Clean up `main`.** Fix or explain the failing Codex-builder test, add the
   replaced-release refusal test, and scope `exportStudy` to the study's own audit events.
   Refresh `config/readiness.json` from current evidence.
2. **Funding and reinvestment in the app.** Done October 27 in the Payments page
   ("Funding and reinvesting"), fixture-checked; reinvestment stays off until Jordan sets
   a policy (#47–#49).
3. **Checkout in the app (test mode only).** Built October 27 in the Payments page
   ("Checkout (test mode)", ADR-0045), fixture-checked with a simulated test buyer: signature
   checks, entitlements, refunds, disputes and duplicate or out-of-order events. Stripe test
   mode shows Stripe's hosted page link; no Stripe call made yet. Live mode stays a separate,
   disabled stage.
4. **Narrower spending limits.** Per-model and per-run limits under the workspace ceiling
   (ADR-0043 follow-up), shown in Settings and enforced in the budget code, not the UI.
5. **Exercise the current build in the desktop shell.** Package `main` with its own data
   home (never the installed app's database or data home) and walk sign-in, a run,
   download, quit and relaunch.
6. **One real end-to-end run (Group 3).** The accepted example is a CSV quality checker
   for a research team (#22–#24): real sources, compare existing tools first, then spec,
   build, review, QA, package, download, one round of Jordan's feedback and one revision.
   Needs Jordan's approval of the exact scope and model route. Plan route, $0 metered.
7. **Upgrade the installed app.** Decide with Jordan when to move the installed studio
   from the schema 29 candidate to current `main`, given that it also protects the
   theme-intent acceptance chain. Back up first; this needs an exact owner decision.
8. **Owner pilot (Group 4).** Seven days from the installed app under the accepted terms
   (#25–#32): $0 new metered spend, stop after three consecutive failures or 120 minutes
   of intervention, manual runs only. Jordan still needs to give dates and RAM/VRAM limits.
9. **Final UX pass and exact-candidate acceptance.** Walk the installed app as a user
   (first launch, running work, errors, recovery, export), fix what blocks release,
   then repeat X10 on the exact candidate.

**Later, each its own task:** central studio chat (C52); theme-free problem discovery
(C53); Ollama as a local model route; live GitHub verification on one new private
`creator-agent-` repo (#33–#35); signed Windows distribution and updates, then the
public-release package (#36–#43); hosted staging after a costed plan (#44–#46); live
payments; campaigns (#50–#52).

**Separate track: theme-intent native acceptance.** Next is the v5 implementation design
for the `cw01-native` helper and core (carrying CW-01 Lows K1–K3), then the collector,
the PR-01/SH-01 inspector, and Jordan's attestations from the blank template. M3 is
settled and stays closed.

**Thesis (when Jordan picks it up):** answer RD1–RD10, get the committee/IRB decision for
RD5, finish T15 and unblock T16, and fill the 36 X10 rows that need owner inputs. Never
fill in participant, reviewer, IRB, task or model details that Jordan hasn't given.

## What needs Jordan

- Approval for any live call, spend, install or upgrade of the installed app, GitHub
  account use, payment account, publication or outbound message.
- Dates and hardware limits for the pilot.
- A reinvestment policy before reinvestment is turned on.
- When to upgrade the installed app (step 7).
- Attestations for the theme-intent track.

## Rules for every session

```text
Work in C:\dev\creator_agent. Follow AGENTS.md. Read PROJECT_CONTEXT.md, BUILD_STATUS,
SESSION_HANDOFF and the code you will change. Preserve existing changes. Don't use the
installed desktop app's database or data home. No live provider, GitHub or payment calls
and no spend without Jordan's go-ahead for that exact action. Label fixture results as
fixture. Never invent participant, reviewer, IRB, task or model details. Don't reformat
hash-bound files (.prettierignore, .gitattributes -text). Update BUILD_STATUS and
SESSION_HANDOFF, and don't start the next step automatically.
```

Local setup for running the dev studio is in `docs/LOCAL_DEVELOPMENT.md`.
