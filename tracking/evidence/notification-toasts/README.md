# N2 notification bell and toasts (ADR-0130): browser walk

`walk.mjs` ran in the cloud container on November 17, 2026 against a throwaway PostgreSQL 16 database (`n2_walk`), on the review ports (5183/4330/4340, via `../owner-actions/stack.mjs`), fixture provider only: no model call, $0. It seeds `seed-discovery`, opens the studio, then starts an autopilot through the API at assessment (the fixture stops it at a tie).

`walk.txt` (re-run after review 1 on November 17, database `n2_walk4`): 21/21 checks pass: the bell; one toast for the stop, claimed for the toast; the unread count; Open landing on the autopilot's card and marking it read; the Autopilot page line; Send test; the Builds row saying toast only; the bell panel; Escape returning focus to the bell; View all; two windows giving exactly one toast (check 6); a window hidden and shown again giving no late toast while the row waits unclaimed (check 12d); no sideways scroll at 390 px; the browser Notification API never used; no page errors.

- `01-toast.png`: the autopilot stop toast, desktop 1280 px.
- `02-settings.png`: Settings › Notifications (full page; the sticky top bar shows mid-page in a full-page capture).
- `03-bell.png`: the bell panel over Settings, with the test toast.
- `04-history.png`: Monitor › Notifications.
- `05-phone.png`: 390 px wide, bell open.

The first run found the Standard rows' selects stretched to full width; `notifications.css` now keeps them at their own width. It also found the bell panel hanging off the left edge at 390 px; on narrow windows the panel now spans the top bar.
