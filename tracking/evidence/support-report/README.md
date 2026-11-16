# Support report walk (ADR-0118, F5), November 15, 2026

Cloud container, fixture workspace, throwaway PostgreSQL 16 database, reviewer ports (web 5183,
API 4330, previews 4340). No live calls, no spending.

One planted portfolio scheduler failure held `refresh_token=abc123secret` and
`C:\Users\jordan\AppData`. `walk.mjs` opened Monitor > Workers in both themes, pressed
"Prepare support report", checked that the preview hid both, pressed "Copy report" and checked
that the clipboard held exactly the previewed text. Review 1 added a check that the status
region announces "Report ready, N items hidden." and an axe pass (WCAG 2 A/AA, 2.2 AA) on the
section. Result after review 1 fixes: 12 of 12 checks pass.

- `support-report-dark.png`, `support-report-light.png`: the section after copying.
