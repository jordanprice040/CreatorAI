# Theme-intent installed acceptance plan: independent review, October 24 2026

Reviewed document: `docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_2026-10-23.md` (the "plan").
Candidate `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`, installation
plan `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`. Checkout
`C:\dev\creator_agent`, HEAD `590aba3` with uncommitted work in the tree (left untouched).
Reviewer: a U02 model reviewer that had no part in writing the plan, the feature or the helpers.
This is not human acceptance.

## Verdict

**Blocked for execution, and the checklist needs changes before it can be ready.**

- **Blocked.** The plan's entry conditions depend on the upgrade helper's pre-UI preservation
  check (plan lines 22–29). The operational `before` attempt on 2026-10-24 showed that the
  v3 helper cannot run on the real desktop layout (finding H1). No fresh backup, installation
  or migration exists, and none is authorized.
- **Changes required.** Several required observations cannot be shown through the installed
  UI or any read-back that is already authorized (H2). The plan also leaves out the
  installation and registry/shortcut layer, human acceptance, the desktop's own migration
  button and the side effects of launching the app (M1–M5).

This review gives no installation, migration, recovery, stale-state release or acceptance
approval. It does not mark native acceptance complete. Full C54 remains partial.

## What was inspected (read-only)

- `AGENTS.md`, `PROJECT_CONTEXT.md` (present, not re-summarized), the U02 entry in
  `PROMPT_LIBRARY.md:557`, and the top entries of `tracking/BUILD_STATUS.md` and
  `tracking/SESSION_HANDOFF.md` (including "Operational before blocked by native-layout
  mismatch").
- The plan; `docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md`;
  `docs/THEME_INTENT_UPGRADE_HELPER_V3_REVIEW_2026-10-24.md`; and `reviewer-receipt.json`
  in `tracking/evidence/theme-intent-upgrade-helper-v3-review-2026-10-24/`.
- `docs/THEME_INTENT_PACKAGE_2026-10-23.md`, `docs/THEME_INTENT_REPAIR_2026-10-23.md`, and
  `docs/DESKTOP_STUDIO.md`. Searched `docs/C54_READINESS_AUDIT_2026-10-23.md` and
  `apps/desktop/INTERACTIVE_ACCEPTANCE.md`.
- Source: `apps/web/src/theme-intent.tsx`, `apps/web/src/submit.tsx`,
  `apps/web/src/catalog.tsx`, `packages/contracts/src/intake.ts`,
  `packages/domain/src/intake.ts`, `apps/api/src/index.ts` (startup, entity and research-plan
  routes), `apps/api/src/studio.ts`, `apps/api/src/connections.ts` (GET paths),
  `packages/broker/src/plan-service.ts` (token refresh), `packages/db/src/store.ts`
  (`drainOutbox`), `packages/db/src/migrations.ts:2348-2354`,
  `scripts/theme-intent-upgrade-v3-core.mjs` (`managed`, `state`, `preserved`),
  `scripts/theme-intent-upgrade-v3.mjs:288`, `scripts/install-theme-intent-v3.ps1`,
  `apps/desktop/src-tauri/src/{home,studio,signin}.rs`, `tauri.conf.json`,
  `tauri.local-bundle.conf.json`, `apps/desktop/installer-acceptance.ps1`, and
  `apps/cli/src/index.ts` (usage).

**No acceptance tests were executed.** Not run, opened or accessed: the application, helpers,
installers, migrations, browser automation, operational configuration, credentials, databases,
backups, installed program files, processes or services, providers and workflows. The retired
OneDrive checkout was not touched. The parallel `theme-intent-operational-before-2026-10-24`
evidence directory was not read. Its outcome is taken from the tracking summary only. The only
file written is this report.

## Findings (most severe first)

### H1. The pre-UI preservation gate cannot currently be met, and the plan does not bind a helper identity

- Plan lines 22–29 require a completed helper preservation check before launch.
- `managed()` reads `join(home,'postgres')/PG_VERSION`
  (`scripts/theme-intent-upgrade-v3-core.mjs:382-385`). The desktop's data directory is
  `postgres/data` (`apps/desktop/src-tauri/src/home.rs:120-121`).
- The tracking files record that operational `before` exited 1 for this reason. They also
  record that the synthetic fixture copied the same wrong layout. The supported v3 review
  therefore does not show that v3 works on the native layout.
- Any repair changes the helper bytes. The plan's "reviewed helper identity" (line 48) must
  then be the repaired helper plus its own new independent review, not the v3 receipt.
- The plan is also out of date. Lines 22–23 and 141–145 say Claude's audit result is "not yet
  known".
- **Impact:** none of the plan can run now. Running it on the v3 identity would bind the
  acceptance to a helper that has never worked on this machine's layout.

### H2. The plan names no authorized read-back for its database and accounting claims

These cases need record-level or accounting facts: NI-02 (format, "no claim, run, grant"),
NI-03 (workspace/id/version/content_hash), NI-05, NI-10 (no new claims, runs, grants, retrievals
or provider requests; existing settings unchanged), and the ledger content hashes (lines 54–57).
Lines 59–62 forbid inventing an endpoint but do not say which read-back is allowed. What the
code actually offers:

- **Installed UI.** It shows title, version, status and id (`theme-intent.tsx:179-187`, `:214-216`;
  `catalog.tsx:244-278`). It never shows a content hash.
- **CLI.** `show`, `list`, `activity` and `history` exist (`apps/cli/src/index.ts`, usage lines
  13–43). They need `pnpm cli login <code>`. In the installed studio that code is the service's
  `CREATOR_DEV_LOGIN_CODE` (`apps/api/src/studio.ts:533`), which is an operational credential.
- **Direct SQL.** This needs the DPAPI-protected database credentials.
- **Helper.** The helper's `state()` is the only whole-table hash tool
  (`core:502-574`). It has no post-acceptance phase, and it compares hashes per table, not per
  row.

**Impact:** as written, NI-10's zero-dispatch and unchanged-state conclusions cannot be
demonstrated. A tester would be pushed either to expose credentials or to report missing
evidence as zero.

### M1. Launching the app makes its own changes and starts the workflow worker

- On launch, `init()` ensures system actors exist, runs `sweepStale` and `sweepRetrievals`,
  drains the outbox and starts the in-process worker (`apps/api/src/index.ts:440-469`).
- A relay then drains the outbox every second and repeats the sweeps every 15 ticks
  (`:482-500`).
- The installed service builds a fixed environment (`studio.ts:528-539`). It sets no
  `CREATOR_WORKER` (so the worker is on, `index.ts:400`). The portfolio scheduler defaults to
  off (`index.ts:363`). No source-fetch or GitHub live switch is set.
- No user-facing control can disable the worker. Entry condition 5 ("record the actual
  supported controls") gives no way to meet it.
- **What does exist:** the helper's `state()` asserts zero non-terminal workflows and tasks,
  in-flight or unknown reservations, in-flight retrievals, open plan requests, running
  qualifications, batches, GitHub/marketing/portfolio/desktop jobs and live previews
  (`core:509-528`). It takes these readings with the desktop quit.

### M2. No stop rule for the desktop's own migration path

- If the schema is behind the program, the service reports `needs_migration` (`studio.ts:~510-521`).
- The control window then offers an owner migrate action (`studio.rs:567-575`, `:912-922`;
  `allow-studio-migrate` in `tauri.conf.json`).
- The helper has known windows where the install succeeded but the migration result is missing
  (v3 review L2/L4). Opening the new program in that state would offer a second, unreviewed
  migration route outside the helper's evidence.
- The plan has no stop condition for this.

### M3. The archival option cannot be done through the reviewed UI

- There is no archive control in `theme-intent.tsx` or the Catalog.
- Archiving exists only as `POST .../entities/{id}/archive` (`index.ts:1009-1013`) or
  `pnpm cli archive <workspace> <id> <expected-version> <reason>`. Both need a CLI or API
  session (see H2).
- Deletion is not available and is not authorized.
- Plan lines 115–119 do allow "retain" as the alternative. But "optional archival" reads as
  ready to do, and it is not.

### M4. Fixture, real installation, registry/shortcut, native UI and human acceptance are not separated

- The plan has no cases for actual NSIS execution or its exit code. It has none for the
  per-user uninstall registration either. `installMode: currentUser` is set at
  `tauri.local-bundle.conf.json:15`, and the existing script reads
  `HKCU:\...\Uninstall\<product>` at `apps/desktop/installer-acceptance.ps1:10`.
- It has no cases for Start-menu or desktop shortcuts. The helper installs with `/S /NS`
  (`theme-intent-upgrade-v3.mjs:288`), and `/NS` skips shortcut creation.
- `DisplayVersion` may not tell the builds apart. The candidate declares `0.1.0`
  (`tauri.conf.json`). The predecessor's value was not inspected.
- The plan records an "operator" (line 32) but does not say that a tester or agent running the
  cases is not Jordan's human acceptance.

### M5. NI-03 checks fixed declarations, not observed behavior, and the UI does not show those fields

- `prepareThemeResearchPlan` hard-codes `provider_requests:0`, `source_fetches:0`,
  `new_metered_spend_nano_usd:'0'`, `execution` and `native_search`
  (`packages/domain/src/intake.ts:32-39`). The schema makes them literal values
  (`packages/contracts/src/intake.ts:39-48`).
- Seeing these values proves only that the code is wired correctly. It is not evidence that
  nothing was dispatched.
- The UI shows prose instead of the raw fields (`theme-intent.tsx:294-303`).
- What a native observation *can* establish: if the plan panel renders, the client has already
  validated the literal schema and compared `intent.content_hash` with the saved record
  (`theme-intent.tsx:146-154`).

### L1. A clean "save" shows "Draft saved" even though nothing was written

When the draft has no edits, Save skips the write but still shows "Draft saved as version N."
(`theme-intent.tsx:113`, `:145`). The NI-04 rule "does not create a duplicate" has to be checked
by the version number in the list and legend staying the same, not by the notice. (This is also a
small UX wording issue. Report only; no product change is proposed here.)

### L2. The confirmation prompt does not say which draft it will open

Each ordinary action while the draft is dirty replaces the pending target (`theme-intent.tsx:71-74`).
The prompt text never names the target (`:192-209`). After NI-06, the pending target is the last
action clicked (Resume A). NI-08 must click Resume B again before discarding, which the plan
already does. The expected result should say this so the tester does not assume B is pending.

### L3. The retry rule is stricter than the code needs, but cannot be loosened safely

The idempotency key is kept for an identical payload within the same page state
(`theme-intent.tsx:123-128`), so an identical retry is de-duplicated by the server. Any edit,
reload or relaunch loses that key. The plan's "reconcile before retry" rule (lines 87–91) should
stay. It should add that a retry is only considered with an unchanged form in the same window.

### L4. Workspace, role and baseline details are missing

- A viewer role makes the form read-only (`theme-intent.tsx:64`, `:212`). The plan does not say
  which workspace or role to use.
- At the start of schema 29, the workspace must contain no `theme_intent` entities. Migration 29
  is what first allows that kind (`migrations.ts:2348-2354`). This is a strong and checkable
  baseline that the plan does not use.

### L5. Sign-in and quit details are missing

- Sign-in opens the system browser to `127.0.0.1:5173/api/desktop/approve?id=…` and asks the
  user to compare a code (`signin.rs:27-75`). The session is stored with DPAPI and revalidated
  at the next launch (`DESKTOP_STUDIO.md:65-67`).
- Closing the window may leave the app running, and Quit also stops the app's database
  (`DESKTOP_STUDIO.md:58`, `:70-72`). NI-04 already says "explicitly quit". It should name the
  tray or menu **Quit** and expect the control window to show the stopped state.
- Evidence must exclude the approval URL id and the code.

## Status of the ten review questions

| # | Topic | Status |
| --- | --- | --- |
| 1 | Create, save, reload and resume in the real UI | Covered by NI-02, 04, 05 and 09, and executable. Needs L1 and L4. |
| 2 | Dirty-input guard | NI-06 to NI-09 match the code paths. Needs L2. Failed native loads correctly stay not-run (plan lines 93–99). |
| 3 | Schema 29 and preservation | Correctly delegated to the helper. Blocked by H1. Post-UI preservation is limited by H2. |
| 4 | No dispatch or activation | Partly. Needs M1, M5 and H2. GET routes for Submit and connections are store reads only (`connections.ts:104-123`); `accessToken` refresh is only on POST paths (`plan-service.ts:280-300`, `:508`, `:624`). |
| 5 | Synthetic records, ledger, disposition | Ledger is good. Disposition needs M3. |
| 6 | Order: preservation before login | Correct in principle (lines 27–29). Needs the timestamp binding in amendment A0. |
| 7 | Separation of result types; `/NS` | Missing (M4). |
| 8 | Prerequisites, observations, evidence, stops, rollback limits | Mostly present. Needs M2 and the new stop rules. The rollback boundary (lines 111–113) is correct. |
| 9 | No paid calls, credentials or extra state | Achievable through the UI only. CLI or API archive or read-back would breach it (H2, M3). |
| 10 | Claims the code cannot show | NI-03 limits (M5); NI-10 byte-level unchanged state (H2); "optional archival" (M3). |

## Proposed checklist amendments (expected results)

**A0. Pre-launch gate (new, runs before NI-01).**

- Requires:
  - the exact repaired helper and its new independent review;
  - an `after` receipt whose `preserved()` passed (`core:575-583`), with schema 29, the target
    program, and all `state()` zero-count assertions;
  - an `observed_at` on that receipt that is earlier than the first desktop launch, with no
    launch between installation and `after`.
- Expected: the receipt is from the actual native `postgres/data` directory, and its identities
  match the candidate and plan.
- Stop if any of this is missing.

**A1. Launch check (new).**

- On first launch, the control window must go straight to running.
- Stop with no clicks if it shows `needs_migration`, setup, adopt, connect, or failed. Do not
  press Approve, Retry or Setup. Escalate to a reconcile or recovery decision instead.

**A2. Expected bookkeeping (amends NI-10).**

- List launch-time actor ensures, broker and retrieval sweeps, outbox projection, and sign-in
  challenge and session rows as expected, explained changes.
- Expect no workflow to run, because A0 proved none was non-terminal.
- Expect "portfolio scheduler off" on Operations or Health.

**A3. Read-back scope (amends lines 59–62, 81–83 and NI-10). Pick one.**

- **(a) UI only.** Use these views:
  - Catalog filtered to the `theme_intent` kind: ids, versions and status.
  - Activity: entries, actors and times for the acceptance window.
  - Monitor and Runs: no new runs or workflows, and the spend figures (charged, in flight,
    unknown) unchanged from a baseline taken right after sign-in.
  - Decisions and Budgets: unchanged.
  - Models and connections: saved status unchanged.

  Content hashes are then shown only indirectly, by the plan binding (M5). Byte-level
  "existing state unchanged" is recorded as **not verified after UI activity**.
- **(b)** Separately implement, independently review and authorize a read-only
  post-acceptance snapshot that uses no credentials beyond the helper's reviewed path.

Never use the CLI login code or database credentials for this.

**A4. NI-02, NI-05 and NI-09.**

- Before NI-02, the theme draft list is empty.
- After each save:
  - the legend reads "Theme draft · version N";
  - the list shows exactly the expected titles and versions;
  - Catalog shows the new ids with `active` status;
  - Activity shows exactly one create or revision entry per save.
- The record ids go into the ledger.

**A5. NI-03 (rewrite).**

- Expected: the plan panel renders "saved version N" with the prose about zero requests and
  fetches.
- Rendering means the client-side literal schema and content-hash check passed.
- Record this as **declaration wiring**. It is not evidence of zero dispatch, which comes only
  from A2 and A3.

**A6. NI-04.**

- Quit from the tray or menu; the control window reaches the stopped state.
- Relaunch. Sign-in may be restored automatically.
- Resume A and press Save without editing. Expected: the version stays the same in the list and
  legend, and there is no new Activity entry. The "Draft saved" notice is not evidence (L1).

**A7. NI-06 and NI-08.**

- In NI-06, the prompt stays visible after every click, and the form still holds A's marker and
  "version 1".
- The pending target is not shown and is whatever was clicked last.
- NI-08 clicks Resume B and then "Discard edits and open".

**A8. Disposition (amends lines 115–119).**

- Default: keep both labeled drafts and record their ids, versions and status as retained
  synthetic test data.
- Archive only with a separately decided path that needs no credential exposure, by exact id
  and expected version.
- No deletion.

**A9. Installation-layer observations (new, read-only, separate result class).**

- NSIS exit code and the installer and native hashes, taken from the helper's installer outcome
  receipt.
- The HKCU uninstall entry exists and points at the installed path. DisplayVersion is recorded,
  but it is not used as the identity check.
- Existing Start-menu and desktop shortcuts: record whether each is present and what it targets.
  Expect them to be neither created nor changed. If one is missing or stale, record it and do
  not repair it. Repair is a separate scoped decision.

**A10. Result classes and human acceptance (new).**

- The results table gets a class column with these values:
  - **F**: earlier fixture or intercepted-browser evidence, cited only.
  - **I**: real installation.
  - **R**: registry and shortcuts.
  - **N**: native UI, run by a named tester.
  - **H**: Jordan's own dated acceptance statement.
- N does not imply H. The completion template names each class separately.

**A11. Prerequisites (amends entry condition 4).**

- Name the workspace and confirm an owner or editor role.
- Owner chooses: use an existing workspace, or create a dedicated one, which is an extra change
  and needs its own scope.
- Labels go in the **theme** field, because that becomes the list title.

**A12. Extra stop conditions.**

- The control window shows any state other than running at launch (A1).
- The theme draft list is not empty before NI-02.
- Any Activity entry appears that is attributed to the workflow worker, broker dispatch or
  retrieval.
- The spend figures change (charged, in flight or unknown).
- A sign-in prompt asks for a ChatGPT or plan account.

**A13. Housekeeping.**

- Replace lines 22–23 and 141–145 with the current status: v3 supported, then blocked on the
  native layout.
- Bind the candidate, plan and helper identities as three separate fields.

## Remaining authorization requirements and limitations

**Needed before execution, each a separate step:**

1. U03 native-layout helper repair.
2. A fresh independent exact review of that repair.
3. An owner-authorized operational `before`, with a complete fresh backup.
4. A new exact installation and migration decision.
5. The installation itself, with a verified `after`.
6. An acceptance-session scope decision covering the workspace, the synthetic writes, the
   disposition and the A3 read-back choice.

Recovery to schema 28 still needs its own coordinated decision.

**Not shown by this review:**

- Native layout compatibility of any helper.
- Real NSIS, registry or shortcut behavior.
- Installed UI behavior.
- Operational-scale timing.
- Whether the predecessor's DisplayVersion differs.

Line numbers are from the current working tree, which contains uncommitted changes.

## Next eligible bounded step

U03: the bounded native-layout repair of the upgrade helper, with fixture coverage of the real
desktop layout (as recorded in the tracking files), followed by its fresh independent review. A
document-only revision of this checklist that applies A0–A13 can be done separately and should
be re-reviewed against whichever helper identity results. Nothing here authorizes installation,
migration or native acceptance. Full C54 remains partial.
