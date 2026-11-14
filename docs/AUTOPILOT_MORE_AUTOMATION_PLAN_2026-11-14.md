# Plan: more automation for the autopilot, when the owner opts in (November 14, 2026)

Jordan, November 14 01:26 UTC: "there should be more opportunities for things to be fully automated if the user decides", including (1) continuing past stops that wait for a person, per the user's automation settings and quick to change, (2) automatically adding evidence and linking claims, and (3) a clear next step whenever automation stops. Inputs are the three live runs (`/mnt/project-files/reviews/LIVE_AUTOPILOT_FINDINGS_2026-11-14.md`). Migration 63 and ADR-0100 are reserved for this.

This thread owns the server and behavior changes. The final UX pass (PR #192) owns the wording of the stopped card (`NextAfterStop`), the passage-count line, the cap warning in the form and the end-time refresh. This work adds one component that the card imports, so the two never edit the same lines.

## 1. Autopilot settings (per workspace, owner only, off by default)

A new versioned record (`autopilot_settings`, migration 63) holds the owner's choices. Every autopilot reads the current version at each choice and records the version it used on the step, so it's always visible which setting let it continue. Only the owner can change it. Changing it is audited. Turning a switch off takes effect at the next step.

| Setting | What the autopilot does instead of stopping | Bound |
|---|---|---|
| **Gather evidence when it is thin** | It links recorded claims to the problem and options that name them, links the claims discovery cited in each option, and when that is not enough runs a web search on the plan connection and explores or assesses again | 0–3 extra searches per autopilot (2 requests each); public or synthetic data only; claims enter only through the run's evidence approval, as today |
| **Choose with unknown ratings** | It ranks by the worst case (each unknown at 1, the range's lower end) and chooses the option whose worst case is best, if exactly one is | Never counts an unknown as neutral; the reason names each unknown |
| **Break ties** | It applies a fixed order: opportunity rank, then fewer unknowns, then the better worst case | It stops if the tie still holds |
| **Keep the leader of a close ranking** | It keeps the option first under the owner's weights when a weight check changes the leader | The reason lists the checks that changed it |
| **Choose when only the model cleared ethics** | **Waiting for Jordan's decision** (see below) | — |

Not included: a gate that blocks the choice outright (an unresolved ethics or access gate, a missing humility review). The selection rules refuse those for everyone, so the autopilot gathers evidence and assesses again (when that setting is on), or stops. Writing a spec also stays with the owner.

**Quick to change.** Every stop that a setting could have handled records its kind (`stop_kind`, for example `unknown_ratings`). The stopped card shows **Allow this from now on and continue** (owner only). One request turns that setting on and continues the autopilot, and the server refuses it if the autopilot changed since the card was read. The full settings sit in Discover › How much is automated, beside the levels, and apply to Run it for me, Automate the rest and Automate selection alike.

### Owner decision needed: the November 12 ethics rule

On November 12 Jordan decided "for now" that a selection only the model cleared on ethics stops for a person, and the autopilot counts as a non-person (ADR-0090, ADR-0092). The proposal is to make this an owner setting that is **off by default**. When it is on, the autopilot may choose such an option, the selection records that only the model cleared ethics, and the proposal and Decide show "Ethics checked by the model only: look at it". This part is built only after Jordan confirms. Until then, that stop stays as it is.

## 2. Automatic evidence and claim linking

* **Discovery-to-assessment handoff (the gap from run 2).** When discovery records options, the claims each option cites from discovery's own packet (`C3`, later shown to the assessor as `draft-C3`) are known exactly. With the evidence setting on, the autopilot links each cited claim to its option as `supports` (audited as the Autopilot's, with the reason "cited by discovery"), so the assessor reads them.
* **Suggested links.** The web app's claim suggestion (`claim-suggest.ts`) moves to the domain package so the server can use it. With the setting on, the autopilot links strong matches (the same pre-ticked set a person sees) to options that have no claims read. ADR-0091 rejected auto-linking without a person's tick. This reverses that rejection only when the owner opts in, and every link can be undone with Unlink.
* **Search when still thin.** If explore finds no candidate, or options still have no claims, or selection stops on unknown ratings or open gates, and searches remain, it runs one web search. The question comes from the explorer's research ideas or the option's title. It then explores again, or links the new claims and assesses again.

## 3. A clear next step at every stop

Each stopped step carries `stop_kind` and `next`: a short list of concrete actions (`allow_and_continue`, `search_web`, `link_claims`, `decide`, `approvals`, `raise_run_cap`, `new_run`), each with its own label. The UX pass's `NextAfterStop` can render them, and this work's component renders the one-click ones.

## Fixes from the live runs that are behavior, not wording

* **The per-run cap (K-9).** Each step is now sized from what is left of the plan connection's per-run cap on this run, not from the cap alone. Before this, run 2 sized each step as if all 10 were free. When the cap is used up, the autopilot stops with `run_cap`: "This run has used 10 of the plan connection's 10 requests per run. Raise the per-run cap under Models and connections, then continue." At the start, the autopilot also refuses a whole process that can't fit under the cap, with that reason. The refusal headline "Assessment route is not ready" becomes "Assessment can't start on this connection now".
* **Automate the rest on a new run.** The panel offers "on a new run" beside the running projects.
* **The Start box stays ticked.** This is a web fix in `autopilot.tsx`, left to the UX pass so the same file isn't edited by both.

## Verification

Unit tests for the new rules: the worst-case choice, the tie order, the close-ranking leader, cap sizing, and the `stop_kind`/`next` mapping. DB tests for the settings (owner only, versioned, audited), allow-and-continue (with a refusal on a version conflict), cited-claim linking, the evidence loop (fixture model and fixture web), and refusal of a whole process that can't fit under the cap. Then `pnpm typecheck`, `format:check`, `test:db`, and a browser walk on a throwaway database. A live run on the dev studio needs Jordan's typed OK.
