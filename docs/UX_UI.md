# Studio UX/UI: dark-default workspace

Implemented October 19, 2026 by Claude Code from the owner's handoff (`docs/CLAUDE_UX_UI_HANDOFF.md`
on the owner's machine). Branch `claude/ux-ui-handoff-mfarlr` from main `0dfc6e6` (PR #32 included).
The web app in `apps/web` is also the desktop (Tauri) view: `apps/desktop/src-tauri/tauri.conf.json`
loads `apps/web/dist`, so this redesign applies to both. Native Tauri was not run here.

## Direction

A calm developer workspace: warm charcoal surfaces, warm neutral text, 1px borders, a quiet sage
accent carried over from the earlier forest-green identity, system fonts, and density where the
records need it. Dark is the default on every load, including a fresh install with a light OS
theme (owner decision, ADR-0035). Light is an explicit choice through the sun/moon button in the
top bar, saved in `localStorage` under `creator-agent.theme`.

The shell answers four questions on every screen: where am I (sidebar group + highlighted item,
breadcrumb, document title), what is happening (connection status with a coloured dot and words,
fixture-mode banner), what needs attention (status badges in words, alerts), and what to do next
(each view's own buttons, unchanged).

## Shell

- **Sidebar** (`aside.sidebar`): brand, workspace picker and "New workspace", grouped navigation,
  schema/local-control footer. Groups: Studio (Monitor, Submit a theme, Compare and decide),
  Evidence (Catalog, Evidence, Scores and specs, Search), Oversight (Decisions, Runs, Budgets,
  Activity), Build and study (Gallery, Studies), System (Desktop and workers, Operations).
- **Top bar** (`header.topbar`): menu button (narrow screens only), breadcrumb `Group / View`, a
  visually hidden `h1`, connection status, signed-in identity with Sign out, theme toggle.
- **Narrow screens (≤860px)**: the sidebar becomes a drawer opened by the menu button
  (`aria-expanded`, `aria-controls="sidebar"`); Escape, the backdrop, or choosing a view closes it.
  Every action available on desktop stays available.
- Before sign-in, or with no database, the same top bar shows without the sidebar.

Route identities and deep links are unchanged (`#/view?ws=…&id=…&q=…`). `VIEWS` keeps its order
and labels; `VIEW_GROUPS`, `viewLabel` and `viewGroup` are new exports in `src/ui.tsx`.

## Tokens (`src/style.css`)

All colours are custom properties on `:root` (dark) and `:root[data-theme='light']`. Components
use tokens only.

| Role                    | Tokens                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Surfaces, back to front | `--canvas`, `--surface-sidebar`, `--surface`, `--surface-raised`, `--surface-hover`, `--surface-sunken` |
| Text                    | `--text`, `--text-2` (secondary), `--text-3` (labels, meta), `--text-on-accent`                         |
| Lines                   | `--border`, `--border-strong`, `--border-input`                                                         |
| Interactive             | `--accent`, `--accent-strong`, `--accent-bg`, `--accent-bg-hover`, `--accent-soft`, `--focus`           |
| Status                  | `--ok`, `--warn`, `--danger`, `--info`, `--muted`, each with `-bg` and `-border` where used             |
| Meters                  | `--m-incurred`, `--m-reserved`, `--m-unknown`, `--m-allocated`, `--m-track`                             |
| Type and motion         | `--font`, `--mono`, `--radius`, `--radius-sm`, `--ease`, `--fast`                                       |

Every text token (`--text`, `--text-2`, `--text-3`, `--accent` and the status colours) measures at
least 4.5:1 on every surface token in both themes; the browser check computes this.

## Components for existing and new screens

Use the existing class names; no component library was added.

- Page: one `section.panel` per view with an `h2` title first (`.decision-head` when the title has a
  button beside it), a short `p` explanation, then content. Use `h3` for sections inside a panel.
- Buttons: `.primary` (one main action per form), `.secondary` (everything else),
  `.secondary.strong` (the primary choice in a group, e.g. approve), `.text` (inline links that are
  buttons), `.ghost.icon-button` (icon-only, with `aria-label`). A bare `<button>` gets the
  secondary look. Disabled buttons keep their label and are never the only explanation.
- Status: `.badge` plus a tone (`.ok`, `.warn`, `.bad`, `.info`) or an existing state class
  (`wf-*`, `ev-*`, `art-*`, `preview-*` …). The badge text names the state; colour only reinforces it.
- Alerts: `.notice` (warning tone; `.notice.ok` for confirmed outcomes), `.error-box` with a
  `.secondary` "Try again", `.error` for inline messages, `.mode-banner` for fixture mode.
- Lists and data: `.rows` for dense record lists, `dl` for label/value facts, `table.ranking` or
  `table.tests` inside `.table-wrap` for tables (horizontal scroll stays inside the wrapper).
- States: `Status` (loading/error/retry) and `Empty` from `src/ui.tsx`; `.empty-note` for empty lists.
- Icons: `Icon` in `src/ui.tsx` (menu, close, sun, moon, info, alert), decorative only.

**For X08 marketing/campaign screens (Codex):** add the view to `VIEWS` and to one `VIEW_GROUPS`
entry (a "Marketing" group between Build and study and System fits), render one `section.panel`,
and use the badges above for claim, audience, consent and delivery states, always with words. Any
fixture or test-mode delivery should reuse `.mode-banner` or a `.notice`. No new tokens are needed.

## Behaviour changes

- Theme: `public/theme-boot.js` (a classic script in `<head>`) sets `data-theme` before the stylesheet
  and app load; `index.html` defaults to `data-theme="dark"` and `color-scheme: dark`, so nothing
  paints white first. `src/theme.ts` owns the toggle and storage. Storage failures fall back to dark.
- Navigation race fixed (`useRoute` in `src/ui.tsx`): a view's late "focus this item" call (for
  example Runs selecting its first run after its data loads) used a stale route and could pull the
  user back to the view they had just left. `go` now merges into the latest route, and a view's
  focus request is dropped once the user has left that view.
- Skip link no longer rewrites the hash (the hash is the route); it focuses `main`.
- `document.title` names the current view.
- Desktop and workers: devices are panels with a status badge in words ("online",
  "unreachable: not reporting", "revoked" …); buttons use the shared styles.
- Operations: readiness, checks, workers and alerts show labelled badges.
- Eyebrow labels above headings replaced by badges after the heading (fixture demo, study runner).

Nothing changed in API calls, request/response shapes, CSRF handling, session handling, gates,
approval/revocation semantics, money formatting or research-condition labels.

## Verification

Run against a disposable PostgreSQL database seeded by `tracking/evidence/ux-ui/harness.mjs`
(a copy of the T13 test-double harness: fixture workspace, synthetic records, test-double
artifacts that are labelled "Not isolation evidence"):

```powershell
$env:CREATOR_DATABASE_URL = "postgres://…/empty_db"; $env:CREATOR_DEV_LOGIN_CODE = "<32+ chars>"
pnpm build; pnpm db:migrate
node tracking/evidence/ux-ui/harness.mjs            # leave running
node tracking/evidence/ux-ui/browser-acceptance.mjs <playwright index.mjs> <chromium>
node tracking/evidence/ux-ui/screens.mjs <playwright index.mjs> <chromium> after
```

`browser-acceptance.json` records each step. Screenshots: `screens/before` (main `0dfc6e6`),
`screens/after`, `screens/checks`.

## Limits

- Browser (Chromium) only; no native Tauri window, Windows high-contrast mode, or screen reader
  was exercised. WebView2 renders the same build but was not observed.
- There are no dialogs in the app to check; Revoke and Stop run act without a confirmation step,
  as before this change.
- Evidence uses fixture data and the T13 test double; no live service, provider or worker.
- The workspace picker truncates long names in the sidebar (the full name is in the option list).
