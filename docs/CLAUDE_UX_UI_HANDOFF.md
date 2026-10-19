> Historical handoff: Claude implemented the UI redesign in merged PR #33. Current UI guidance is in UX_UI.md.

# Claude prompt — Creator Agent UX/UI redesign

Implement a cohesive UX/UI redesign of Creator Agent's existing web app and shared
desktop UI. Jordan has authorized this work. Codex owns the separate X08 workstream
(evidence-backed marketing and measured feedback). Keep your changes compatible
with that parallel work. This is an implementation task, including verification,
not just a design critique or mockup.

## Start and establish your baseline

Read AGENTS.md, PROJECT_CONTEXT.md, tracking/BUILD_STATUS.md,
tracking/SESSION_HANDOFF.md, the shared implementation contract in PROMPT_LIBRARY.md,
and its X08 entry for coordination context. Read context/HUMAN_OVERSIGHT.md and the
relevant actual frontend code. Consult docs/DEVELOPMENT_TOOLS.md before using the
installed design skills or browser tools. Use the relevant Impeccable and Emil
design guidance available in your environment; project policy takes precedence.

Use a separate branch and checkout/worktree from Codex. Fetch current main and
verify the starting commit. Audit PR #32 was confirmed merged on October 19, 2026:
https://github.com/jordanprice040/CreatorAI/pull/32. Include those repairs in your
baseline. The original local checkout contains unrelated uncommitted edits and
stale X05 tracking; preserve them and reconcile current status against current main.
Do not reset, stash, overwrite or casually import those edits into your redesign.

## Owner's design direction

**Dark mode is the default**, including on a fresh install with a light OS theme.
This is Jordan's confirmed preference, superseding the earlier optional-dark-theme
default. Apply the theme before the initial render so startup does not flash white.
Respect an explicitly saved theme choice if you provide a theme toggle; a light
theme is optional and should not delay completion of the dark experience.

Aim for the calm, clean developer-workspace feel Jordan likes in dark-mode Codex
and Claude Code: charcoal surfaces, restrained warm neutral tones, subtle borders,
clear typography, generous but purposeful spacing, and a quiet accent color.
Treat those products as mood references, not an exact copy or a claim that their
current interfaces were inspected. Retain a distinct Creator Agent identity.

Make this an effective evidence-based product studio: the user can tell where they
are, what is happening, what needs attention, and what action comes next. Favor a
stable workspace shell, grouped navigation, a clear page title/action hierarchy,
and readable content. Keep secondary details available through progressive
disclosure. Dense evidence tables, audit history, budgets and logs must remain
usable; avoid turning every row or fact into an oversized card.

Establish reusable semantic tokens for surfaces, text, borders, focus, interactive
and status states. Give forms, buttons, tables, panels, alerts, dialogs and empty
states a consistent treatment. Use system/local fonts where practical. Motion
should clarify state changes and respect reduced motion.

## Ownership and coordination with Codex

Your primary ownership is `apps/web`: application shell, navigation presentation,
existing screens, styling, responsive behavior, accessibility and UI components.
Inspect the current structure rather than assuming the paths are unchanged;
likely shared entry points include `src/main.tsx`, `src/ui.tsx`, `src/style.css`
and the session components in `src/oversight.tsx`.

Codex owns X08 domain behavior, contracts, migrations, API routes, campaign state,
claim/evidence binding, audience provenance, grants/budgets, delivery adapters,
suppression/opt-out, deduplication, reconciliation and their tests. Codex initially
owns any new X08 marketing/campaign screens. Leave those new screens to that branch
until their contracts settle. You may document how they should use your tokens and
shared components; their absence need not block redesigning existing screens.

Keep public component props, route identities/deep links, API request/response
shapes and validation behavior stable where practical. Shared frontend files are
the main overlap risk: keep changes localized, avoid unnecessary file moves and
whole-tree reformatting, and document any navigation/component interface changes
in your handoff. If a backend change is required, record the exact proposed contract
and continue independent UI work; do not silently alter Codex's ownership area.
Avoid unrelated dependency/lockfile, native Rust, workflow or execution changes.

Append clearly scoped entries to shared tracking files. Preserve Codex's X08 entries
when merging; neither workstream should replace the other's current status or
historical evidence. Actual X08 execution status must come from tracking/code;
this assignment alone is not evidence that X08 has started or passed.

## Preserve these product behaviors

- Keep approval, cancellation, pause, revocation and budget controls visible and
  understandable. Retain exact-version/hash binding and stale-approval warnings.
  A visual simplification must not add authority or bypass a gate.
- Keep fixture, test-mode, live, unavailable, unverified and activated states
  distinguishable. An offline worker or failed service must show its actual state.
  Use text/icons as well as color; only show success after an observed outcome.
- Preserve evidence locators, contrary evidence, uncertainty, provenance, money
  precision and research-condition boundaries. Summary views must still lead to
  the underlying records. Existing-tool, process, human-led and defer options
  remain legitimate outcomes.
- Keep authentication, CSRF, session handling and protected-data retrieval intact.
  Do not expose secrets or make protected requests from a new unauthorized path.
- Keep the same real actions available across supported screen sizes and the
  shared desktop view. Every visible action must work or explain why it is
  unavailable. Use labelled synthetic records for design verification, never fake
  customer activity, revenue, demand, testimonials or production readiness.

## Execute and verify

1. Inspect the app running locally and map the existing screens and real actions.
   Record a concise design direction and implementation scope, then proceed
   without waiting for routine design approval.
2. Implement the shared theme and shell, then bring existing screens into that
   system. Preserve functionality while improving information hierarchy and copy.
3. Verify real browser flows with fixture data: sign-in/session state, navigation
   and deep-link refresh, catalog/evidence inspection, one available decision/run
   interaction, budget visibility, gallery, worker and Operations states. Verify
   any additional changed behavior. Record blocked flows honestly.
4. Check a fresh dark-default load and reload; desktop and narrow layouts;
   keyboard navigation, visible focus, labels, contrast, reduced motion; long
   titles/IDs/URLs, empty/loading/error states, tables and dialogs. Avoid clipped
   controls and accidental page-wide horizontal scrolling. Browser results verify
   the shared UI; native Tauri claims require actual native checks.
5. Run the repository's relevant typechecks/build and meaningful behavior tests.
   Retain before/after screenshots, commands and results bound to your candidate.
   Add tests for behavior you change, not tests that merely duplicate CSS values.

Complete when the existing app has a cohesive, usable dark-default interface,
changed flows still work, accessibility/responsive checks have evidence, and
remaining gaps are explicit. Update BUILD_STATUS, SESSION_HANDOFF and relevant
DECISIONS entries without marking X08 complete. Deliver a reviewable branch and
handoff listing touched shared files/component interfaces, screenshots, checks,
limitations and integration notes for Codex. Public hosting, real outreach,
payments and new spending remain outside this UX/UI authorization.
