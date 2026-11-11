# Installed app upgrade to schema 53 and P18–P22 owner walk (November 11, 2026)

First part of P17 final acceptance. The installed desktop app went from f6e2ba0 / schema 41 to main
e2304be (P18–P22 merged) / schema 53.

## Upgrade

- Build: `pnpm run bundle:windows` in `apps/desktop` from main e2304be. The only local change was
  `.codex/config.toml` (not bundled). The system Node is v22.21.0, but the repository needs 22.23.4 or later.
  The build therefore ran with the OpenJS-signed `node.exe` v22.23.4 taken from the previous staged bundle,
  which has the same SHA-256 as the one the installed app already ships. Installer
  `Creator Agent_0.1.0_x64-setup.exe`, SHA-256 `77AE889F8D9BEA6D1898AF42A39D9FCEE573718F74146C3E30FEAEE06DDA7FB2`,
  bundle-manifest `source_commit` e2304be.
- Backup before the upgrade, taken with the app stopped: `C:\CreatorAgentBackups\installed-pre-e2304be-20261111-031123`.
  It holds `home\` (3,142 files) and `program\` (107 files), and both hash-match the originals. It also holds
  `database.dump`, taken from a scratch copy of the cluster (SHA-256 `FAFCC801…8B23`). That dump was restore-checked:
  the per-table row counts were the same. `row-counts.txt` lists 125 tables, schema 41, and the workspaces
  "Jordan’s Creator Studio" and "Testing".
- Trial: a scratch copy of the cluster on 127.0.0.1:55443 with trust authentication, migrated by
  `packages/db/dist/migrate-main.js` from e2304be. It applied migrations 43–53; there is no migration 42 in the
  source. The result was schema 53 and 137 tables, with both workspaces. Every existing table kept its row count,
  except `schema_migrations` (41 → 52 rows) and `personal_notes`, which migration 46 fills with one row copied
  from the existing `workspace_notes`. The 12 new tables are empty. The counts are in
  `trial-row-counts-after-53.txt` in the backup folder.
- Install: Jordan ran the NSIS installer with `/S` from a normal PowerShell, opened the app from the Start menu
  and clicked "Back up and upgrade". The app made its own backup, `pre-migrate-v41-2026-11-11T08-34-44-787Z`.
  `supervisor.log` shows "service command migrate finished" at 08:34:45Z. `/api/health` returns ok with
  PostgreSQL storage. The live database was not queried, because its password is protected by DPAPI for
  Jordan's Windows account.

## Owner walk of P18–P22 (Jordan, November 11)

Works as intended:
- P19: the Standard/Advanced switch is in the sidebar, and the choice survives an app restart.
- P18: folds work, including Expand all and Collapse all, on Projects › Decide.
- P21: the Model button lists gpt-6-astra (ChatGPT plan: ready for Chat, Explore and Build; not qualified for
  Discover or Assess) and claude-sonnet-5-5 (Claude Code: Chat only). Switching works.
- Seen in screenshots: the Chat "Do a step here" card picker (P20) and the Notes panel (migration 46) are present.
  Jordan's existing note is there.

Issues and requests for review/fix:
1. **Qualify placement.** "Qualify a model for a task" is at the very bottom of Models and connections › Models.
   Jordan suggests moving it up, for example right below the approved model check.
2. **Qualify all / batch qualify.** Jordan asks for a "Qualify all" option, and checkboxes on the tasks that are
   not yet qualified, so the chosen qualifications run in one go. They would still run one after another, so the
   person doesn't have to come back to start each run.
3. **Several started, one running.** Several qualifications can be started (independent review, patch build and
   summarization were all "started"), but only one can run at a time. Each of the others needs its own Run press
   later. This is the same need as item 2.
4. **Start qualification while running.** Jordan reports that "Start qualification" still looks enabled and can be
   pressed while a qualification runs. In `apps/web/src/qualify.tsx` the button is disabled only by
   `locked || !chosen || !pick`, not by a running qualification, so a new one can be started.
5. **Activity badge alignment.** The number in the Activity tab's badge is not centered vertically.
6. **Usage window exhausted.** Jordan asks for a notice when a model's usage window runs out, with an option to
   raise or reset the current window only, without changing future windows; those stay on the model's settings.
   (Jordan's message was cut off here.)
7. **Seen in a screenshot, not raised by Jordan:** Projects › Decide › Automatic assessment shows "The assessment
   packet is too large for one model message." Unlike the evidence and exploration messages, it does not say what
   to do about it (`packages/db/src/selection-store.ts:877`). It also shows that gpt-6-astra has no scoring
   qualification. Worth checking whether a real problem with several options can be assessed at all on the plan
   route.

Jordan's note about the model switch ("…but being able to") was also cut off; waiting on the rest.
