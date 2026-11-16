# Monitor › Storage walk (F10, ADR-0121)

`walk.mjs` checks the Storage page in the real studio: review ports (5183/4330/4340), a throwaway
database (`creator_walk_storage`), a throwaway product store, fixture provider only, $0. It seeds a
fixture project through the CLI, makes a product in it with one task build and its finished merge
(both aged 30 days), and then in the browser checks the per-project table, the cleanup list (the
merge can go; the task is kept because it has no verified package), Cancel, the confirming button,
the removal on disk, the page reading again, the audit history, and phone width.

Result on November 15, 2026 (cloud container, PostgreSQL 16): 13 of 13 checks pass (review 2 added the moved-aside list: the walk seeds one moved-aside folder). Screenshots:
`storage-confirm.png` (confirmation), `storage-after.png` (result, kept reasons, history; the
repeated projects are earlier walk runs on the same database), `storage-phone.png` (390 px; the
table scrolls inside its own box). The full-page captures show the sticky top bar and sidebar
part-way down the page; that is how full-page screenshots draw sticky elements.
