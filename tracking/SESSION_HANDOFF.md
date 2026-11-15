# Session handoff — November 10, 2026

## November 15 handoff — Autopilot page (ADR-0111)

Branch `claude/project-thread-5bdkyb` from main 13744b4, main 6886fcf (#210) merged. Web only. `pages.ts`: view and page `autopilot` (after Projects). `autopilot-page.tsx` (`AutopilotPage`) mounts `Autopilot` with `between` = `Automation` + the `AutopilotSettingsPanel` section (`#autopilot-settings-title`). `autopilot.tsx`: `autopilotCurrent`, cards split into current (`article.card.waiting` when stopped) and earlier (folded), `controlError`, `NextAfterStop` takes `open` (Search the web: `open('submit')` + `revealWhenShown('web-title')`; exploration: `openExplorationWhenShown`). `automation.tsx` no longer mounts the settings panel. `discover-panels.ts`: `DiscoverPanel` drops autopilot and automation; `PanelChoice.page`. `next-rules.ts`/`next-step.tsx`: `StudioFacts.autopilots {running, waiting}`, `nextStep('autopilot')`; `main.tsx` nav count and dot. Walk: `tracking/evidence/autopilot-page/walk.mjs`. PR #211 (autopilot rerun fixes) is still open; it adds a Continue notice on Decide, and since 56768ae it carries the same `autopilotContinuable(a, now)` end-time change as this PR, word for word (review 1 H-1), so merging main after it lands should only conflict in tracking. Review 1 fixes: `autopilotCurrent` and the facts' `waiting` follow the end time; the page redraws every 30 s; `controlError` is per card; cards name problem and run (`shortName`) and their end time; `whenShown` shared. Stable link for the notifications plan: `#/autopilot/run?ws=<workspace>&id=<autopilot id>` opens that autopilot's card (unfolding Earlier autopilots), with its next step (`NextAfterStop`) shown on it. Review 2 fixes (report `/mnt/project-files/reviews/PR213_REVIEW_2_2026-11-15.md`): Earlier cards that can no longer continue are headed `Ended: …`; `automation.tsx` `currentLevel` uses `autopilotContinuable` only; names load in their own effect keyed on missing ids; the store's allow path checks `EXPIRED` before `autopilotContinuable`, as `#retryIn` does. Next: re-review, then merge main once #211 lands (keep one copy of the end-time code).
## November 15 handoff — Windows web build and B1 records (PR #212)

Branch `claude/project-thread-lvmxmx` from main 13744b4 (main 6886fcf with #210 merged in). `apps/web/src/package-root.ts`: `rootOf`, `packageRoot(entry, path)` (forward slashes, throws when no package directory is above the entry), `inNodeModules(entry, path)`; `vite.config.ts` `thirdPartyLicenses()` uses them with the platform `node:path`. The web app never imports the module; it lives under `src` so `loadWeb` tests can run it. Records and README in `tracking/evidence/recipe-qualifications/2026-11-15-installed/` (builder/1 run) and `2026-11-15-rerun/` (builder/2 rerun: A1', H1–H3 qualified, H4 failed on a preamble). Review 1 and its re-check: `/mnt/project-files/reviews/PR212_REVIEW_1_2026-11-15.md`. Windows build and licence list confirmed (23 packages). Next: Jordan's merge; then `p15-small-signup-v5` on the ChatGPT connection under builder/2, and a decision on the Claude H4 preamble (needs Jordan).

## November 15 handoff — B2 follow-up after the live run (branch `claude/project-thread-m8yaok`, restarted from main aa922f9)

`SPEC_DRAFT_INSTRUCTIONS_VERSION` `spec-draft-v3` (check fields listed); `config/connections/benchmarks/spec-cases-v2.json` written by `scripts/spec-cases-benchmark.mjs` (refuses to overwrite without `--overwrite-before-live`); `spec-cases-v1.json` untouched and no longer admits. Every code and test reference moved to v2 (gate hash, Qualify page import, form text). `qualification-role.ts` exports `ROLE_NAME`, used by `qualification-results.tsx`. Dev studio on Jordan's PC: `C:\dev\creator_agent_mainrun` at main 334d0e5, schema 67, running (backup `C:\CreatorAgentBackups\creator_studio-pre-b2-20261115T075652Z.dump`); evidence note (uncommitted) `tracking\evidence\b2-live-spec-cases-qualify-2026-11-15\README.md` there. Next: review, merge, then a `spec-cases-v2` live qualification with Jordan's typed OK (the dev studio must be on a main that includes this fix). Review 1 of #210 fixes: `withoutRoleVersion` (connection-store.ts) drops a spec cases check's `role_version` and `source_sha256`, so v1 and v2 held-out cases share keys and a v1 held-out view refuses a v2 start; `#checkQualificationStart` refuses any spec cases manifest that is not the bundled v2 file ("spec-cases-v1 is kept as it ran; qualify on spec-cases-v2."); tests pin v2's canonical hash and read the filled-in draft_spec example. Before the live v2 run: read-only check that `plan_connection_events` on the dev studio has no `qualification_held_out_viewed` row for qualification 33cbf3aa.

## November 15 handoff — one code fence on build-role answers (ADR-0110)

Branch `claude/project-thread-khx8ph` from main 3473b05, no migration. Contracts `routing.ts`: `RoleAnswerWrappingSchema`, `unwrapOneJsonFence`, `parseRoleAnswer`, optional `BenchmarkManifestSchema.answer_wrapping` (build-role classes only). Broker `plan-service.ts` `#runQualification` score reads `manifest.answer_wrapping`. Executor `build.ts` plan-route `invoke` uses `parseRoleAnswer(r.text, 'one_json_fence')` and writes `call-N-answer-form.json` when unwrapped. Benchmarks `t12-builder-v3.json`, `t12-reviewer-v3.json` by `scripts/author-fence-benchmarks.mjs`; `apps/web/src/qualify.tsx` offers them. Tests: `role-answer-fence.test.ts`, one in `plan-connections.test.ts`, one in `build.test.ts`. #207 (B4) merged first; main merged here and `t12-builder-v3` re-cut from `t12-builder-v2` (builder/2), hashes pinned; t12-builder-v2 stays strict. Next: review in a separate thread; packet H rerun with Jordan's fresh typed OK.

Review 1 fixes (November 15): main (#201, #206) merged; `RoutingStore.registerBenchmark` refuses `answer_wrapping` (L-2); `roleAnswerText` is the one rule (N-2), whitespace outside the fence is JSON's only (N-1); canonical hashes of t12-builder-v1/v3 and t12-reviewer-v2/v3 pinned in `role-answer-fence.test.ts` (N-4). L-1 done after #207 merged (script source is now `t12-builder-v2`). Packet H can rerun after this PR merges, with Jordan's fresh typed OK.

## November 15 handoff — B4: room for bigger programs (ADR-0109, migration 68)

Branch `claude/project-thread-fcsj4x` from main 3473b05. Builder prompt is now `builder/2` (`BUILD_ROLE_PROMPTS.builder`; `LEGACY_BUILDER_PROMPT` keeps builder/1 for frozen T15 study builds via the `legacyBuilder` port in `study-build.ts`). Executor: `builder-answer.ts` (`builderV2Schema`, `ANSWER_RULES`, `RoundDraft` for parts and `{find, replace}` edits, `resolveSubmission`); `build.ts` runs each round as parts (labelled loop `rounds:`; packet `answer_rules` and `round {part, further_parts_allowed, staged}`; `part-<round>-<n>.json`; call intents carry `round`/`part`); a refused part or a part asked for with no request left refuses the whole round as ADR-0076 feedback; the round is applied once by the unchanged `ProductSupervisor.apply`. Plan and Codex builds bound task files by `PLAN_ROLE_CONTEXT_MAX` (broker keeps `BROKER_FILES_MAX` 14,000). `build-progress.ts` groups builder calls by round (`BuildRound.parts`). Grader `plan-qualification.ts` uses builder/2 (edits resolved against the template; `complete: false` fails). Contracts: `BUILD_APPROVAL_MAX_REQUESTS` 20, `BUILD_APPROVAL_MAX_REPAIRS` 5, `MAX_BUILD_CASES` 30, `defaultBuildRequests`, `BUILD_CASE_MAX_MS` (also the worker launch limits), `BUILD_REQUEST_MAX_MS`, `buildDeadlineMs(codex, repairs, {requests, cases, recipe})`, `buildCaseCount`. Migration 68 widens the `build_approvals`/`build_approval_asks` checks. Web: `build-limits.ts` (`REPAIR_OPTIONS`, `requestOptions`, `buildLimits`, `limitsText`), Build form repair and request selects and the time limit in "What will happen"; timeline says "in N parts". New frozen benchmark `config/connections/benchmarks/t12-builder-v2.json` (`scripts/author-plan-role-benchmarks.mjs <dir> builder-v2`); Qualify uses it. Tests: `build-parts.test.ts` (new), `web-build-limits.test.ts` (new), widest approval in `plan-connections.test.ts`, builder v2 benchmark in `routing-domain.test.ts`.

After merge every builder qualification must be re-earned under builder/2: plan role `patch_build` with `t12-builder-v2`, then the recipe qualifications (B1). Live steps need Jordan's typed OK: requalification, and the new frozen benchmark `p14-xl-v1` (not built in this PR; about 60 requests, needs a per-run cap above 30 or the P29 allowance). `docs/BUILD_QUALIFICATION_PACKETS_2026-11-14.md` still names `t12-builder-v1` because tonight's packets run on main before B4. Review 1 fixes are in (see the ADR-0109 amendment: `ROUND_FILE_MAX_CHARS`/`ROUND_PATHS_MAX` in `RoundDraft`, overlapping `occurrences`, `round.staged` carries `before_hash` and `files` leaves staged paths out, later-part size refusal in `build.ts`, `buildLimits({requestMs})`). Review 2 L-5: `BuildPorts.planRoleInputCap` (API `products.ts` and the CLI read it from the `build-roles-ready` answer, the recipe qualification runner from `PlanConnectionService.buildRoleInputCap`). Next: re-review in the review thread.

## November 15 handoff — autopilot fixes from the live rerun (findings 1–7)

Branch `claude/project-thread-77qqks` from main 3473b05, no migration or ADR. `web-discovery-store.ts`: `#admitOne` adds supports first and one support row per passage; `CLAIMS_MARK` replaces the summary's claim count. `autopilot.ts`: exported `cutWords`, `fitNote`, `namesOf`, `gatherQuestion`; `#gather` builds one link note; `#trimSpent` runs after every step and before `#finish`/`#redo`, and `advanceAutopilot` now receives `calls_reserved` on every path. `autopilot-store.ts` cuts explanations at 1200. Web: `ap-question` input and the broad-search hint. Next: independent review in a separate thread; a live rerun after merge needs Jordan's typed OK.
Review 1 fixes: `trimSpent(a, details)` and `spentCandidates(a)` are pure and exported (the runner's `#trimSpent` reads the workflows); `nextGatherQuestion(options, problem, asked)` picks the select-gather question; `withoutOldCount` in `web-discovery-store.ts` strips pre-mark count sentences. Next: re-review in a separate thread.

## November 15 handoff — dev ports apart from the installed app (ADR-0108)

Branch `claude/project-thread-wi5qfs` from main 3473b05. `packages/domain/src/config.ts`: `APP_PORTS`, `DEV_PORTS`, `APP_PORT_ENV`, `RESERVED_PORTS`, `defaultPorts(env)`; `serviceConfig` and the OIDC `web_origin` default use them. `apps/api/src/ports.ts` (exported as `@creator/api/ports`): `portHolder`, `pidFromNetstat`, `nameFromTasklist`, `holderFromLsof`, `portInUseText`, `portFree` (also checks 0.0.0.0 for a loopback port), `creatorAgentOn`, `planDevPorts`/`PortPlanError`. `studio.ts` uses `APP_PORTS`, passes `APP_PORT_ENV` to `createApi`, and names the holder in PORT_IN_USE. `scripts/dev.mjs` plans ports first and sets `process.env` before `createApi` and Vite. `apps/api/src/main.ts` names the holder. CLI default base follows `CREATOR_API_PORT` or 4410. Rust: the PORT_IN_USE hint in `studio.rs` only. Docs: README, `docs/LOCAL_DEVELOPMENT.md`, `docs/DESKTOP_STUDIO.md`. Jordan's `.creator/studio/start-dev-*.ps1` set no ports, so his dev studio moves to 5273 once its worktree has this change; the reviewer convention 5183/4330/4340 is unchanged. Next: independent review in a separate thread.

Review 1 fixes: `packages/db/src/studio-lock.ts` (`takeStudioLock`, `STUDIO_LOCK_KEY` 4310108, holder named via `application_name`), taken in `scripts/dev.mjs` after port planning and in `serveStudio` before listening (`STUDIO_RUNNING`, exit 7; Rust shows it under its default arm). `apps/desktop/worker.mjs` `approvalOrigin`. `ports.ts` `system32()`, `CREATOR_PORT_FALLBACK` spellings. Tests: `tests/src/studio-lock.test.ts`, more in `dev-ports.test.ts` and `studio-service.test.ts`. Next: re-review.

Review 2 fixes: `takeStudioLock(url, label, { onLost, onNote, connectMs, retryMs })` watches its connection's `end` and retakes with backoff (1/2/5/10 s); `onLost` when another studio holds it. `apps/api/src/studio-guard.ts` `guardStudio(env, label, onLost)` (exported as `@creator/api/studio-guard`) is used by `scripts/dev.mjs` and `apps/api/src/main.ts`; `serveStudio` races `stop` with the lost lock.

Review 3 nits: `studio.rs` STUDIO_RUNNING arm (title, hint, hide the studio window, show the status window); `main.ts` default `shutdown` exits. No further review; PR marked ready. Rust not compiled in the cloud.

## November 15 handoff — B2: model-drafted specs (ADR-0107, migration 67)

Branch `claude/project-thread-m8yaok` from main 9172584, main with #200 (B1) merged in. Contracts: `spec-draft.ts` (`SPEC_DRAFT_INSTRUCTIONS` `spec-draft-v2`, request/result/record schemas, `readSpecDraft`/`readEdgeCase`/`readExplanation`, `specCaseProblems`, `pickHeldOut`, `specDraftInput`, `checkedAgainst`, `draftComparable`, `draftedMarkText`); `selection.ts` `SpecDraftedMarkSchema`, `drafted` on the spec body, `draft_ids` on create/revise; `routing.ts` check kind `spec_cases_contract`; `connections.ts` `admits_spec_drafts`. Domain: `spec-cases.ts` (`SPEC_BENCHMARK_PROGRAMS`, `gradeSpecCases`), wired in `checkOutput`. Benchmark `config/connections/benchmarks/spec-cases-v1.json` written by `scripts/spec-cases-benchmark.mjs` (then Prettier); changing the instructions, the input or a program needs `spec-cases-v2`. DB: migration 67 `spec_drafts`; `spec-draft-gates.ts` (`currentForSpecDraftRole`, `specDraftRequestGate`, `draftedMark`); ConnectionStore `specDraftRoutes`, `listSpecDrafts`, `beginSpecDraft`, `finishSpecDraft`, `admitPlanRequest(…, recipeAttemptId, specDraft)`; queue role `spec_drafts`; `redactEntity` clears draft words; `selection-store.ts` records the mark. Broker: `PlanConnectionService.specDraft`, `#chatOnce` with a `task`; the qualification scorer passes the raw text for `spec_cases_contract`. API: `GET spec-drafts/routes`, `GET spec-drafts?alternative=`, `POST spec-drafts`. Web: `spec-drafts.tsx`, `spec-form.tsx` (panel, helpers, per-case problems, preview), `spec-fields.ts` (`checkForDraft`, `problemKey`, `draftRoute`, `caseDraft`, `browserCaseDraft`), `build.tsx` (row mark, `owner`/`choice` to the form), `qualification-role.ts`/`qualify.tsx`/`fix-buttons.tsx` (role `spec_drafts`, bundled benchmark, no fix). Evidence: `tracking/evidence/spec-drafts-ui/`. Next: independent review in a separate thread; then the live `spec-cases-v1` qualification with Jordan's typed OK.

Review 1 fixes (November 15): `spec-draft-gates.ts` `specCasesManifestHash()` (bundled file via `BENCHMARKS_ROOT`) and fingerprint check in `currentForSpecDraftRole`; domain `specCasesFingerprint`, `SPEC_CASES_GRADER_VERSION`, `SPEC_CASES_PROBES`, `specCasesProbeReply` (the tests' probe sets moved here); `spec_cases_contract.fingerprint` in `routing.ts`, set by `scripts/spec-cases-benchmark.mjs`. Any change to a program, `readSpecDraft`, `specCaseProblems`, `pickHeldOut` or the grader changes a fingerprint: write `spec-cases-v2`, never regenerate v1 once a real qualification exists. `SpecDraftRequestSchema` refuses `product: 'web'`; the web paragraph left the instructions. `specDraftRoutes(ctx, ws, selectionId?)` (`GET spec-drafts/routes?selection=`) and `beginSpecDraft` use `specDraftConnectionRefusal`. `specDraftInput` sends held-out cases as a count. Form: no product radios, CLI-only note, `openModels` from `build.tsx`. Next: re-review.

Review 2 fixes (November 15): `spec-draft-gates.ts` `specCasesBar` (applied in `ConnectionStore.#insertQualification`, so Start and the queue both get it), `SPEC_CASES_MIN_HELD_OUT`, `SPEC_CASES_FLOOR`; `currentForSpecDraftRole` checks the row's `floor` and `min_held_out_cases`. `SPEC_DRAFT_INSTRUCTIONS_VERSION` is `spec-draft-v2`. `spec_cases_contract.source_sha256` hashes `spec-cases.ts` plus the region of `spec-draft.ts` between the `spec-cases-v1 frozen source` markers (LF line endings); `tests/src/spec-draft-rules.test.ts` holds it. Editing either, even with Prettier, means regenerating the benchmark before anything is live, or `spec-cases-v2` after. Next: re-review.

Review 3 fix (November 15): `selection.ts` `specContentSchemaJson()` (zod `toJSONSchema` of `SpecContentSchema`) is part of `specCasesFingerprint`, so changing a spec limit or case field also needs `spec-cases-v2`. No further review round; next is Jordan's merge, then the live `spec-cases-v1` qualification with his typed OK.

## November 14 handoff — file viewers: PDF, Word, Excel, PowerPoint, ZIP and code in colour (ADR-0106, migration 66)

Branch `claude/project-thread-qj839l` from main 9f162d1. Migration 66 `file_kinds_office` (65 is B1's, 67 B3's) widens `workspace_file_versions.kind` with `document`, `spreadsheet`, `presentation`, `archive`. Contracts `files.ts`: `zipEntries` (central directory, nothing inflated), `decodeText` (UTF-8 or UTF-16 with BOM), `inspectFile` (Office/ZIP from entries, `.xls` from the old format, mismatch for Office/ZIP names, invalid JSON, non-SVG `.svg`, non-HTML `.html`), `FILE_MAX_BYTES_DEFAULT`. Web: `file-viewer-rules.ts` (pure: `viewerFor`, `KIND_TEXT`, `codeLanguage`, `noViewerText`), `file-bytes.ts` (`useFileBytes`), `inert-html.tsx` (`cleanTree`, `inertPage`, `InertFrame` with `sandbox=""` and a CSP meta), and lazy viewers `pdf-view.tsx` (pdf.js, text layer), `docx-view.tsx` (docx-preview with an inert-document `h`, fit width), `sheet-view.tsx` (SheetJS, formulas without values show as formulas), `slides-view.tsx` (own PPTX outline reader on JSZip), `archive-view.tsx`, `code-view.tsx` (lowlight to React); `files.tsx` routes to them, draws SVG through `<img>`, and has Full width. `vite.config.ts` copies pdf.js cmaps, iccs, standard fonts and wasm (no quickjs) to `/pdfjs/`; `studio.ts` serves `.wasm` as `application/wasm`. `transfers.ts` names the size and limit, also for a bare 502. `autopilot.tsx`/`automation.tsx` no longer list raw "Invalid UUID" draft issues when there is no route, and de-duplicate blockers (live check follow-up 5).

Tests: new `web-file-viewers.test.ts`; new cases in `files-inspect.test.ts` (Office/ZIP, listing, UTF-16, mismatches) and `web-transfers.test.ts` (limit text, 502). `pnpm typecheck`, `pnpm format:check`, `pnpm build` pass; `pnpm test:db` on PostgreSQL 16: 1236 tests, 1202 pass, 29 skipped, the 5 known PowerShell-wrapper failures. Walk: `tracking/evidence/file-viewers/` (README, `make-samples.py`, `walk.mjs`, `walk.json`, screens) passes with 0 outside requests, 0 dialogs, 0 console errors.

Not done: installed-app (WebView2) walk; Word bullet glyphs from Symbol fonts do not show (docx-preview limit); PowerPoint is an outline, not a slide render; files stored before migration 66 keep kind `other` (they open by extension).

Review 1 (`/mnt/project-files/reviews/PR201_FILE_VIEWERS_REVIEW_2026-11-15.md`: 1 H, 1 M, 5 L, 6 nits) fixed: `svgDataUrl` and `officeRefusal` (64 MiB a part, 256 MiB in all, unreadable ZIPs refused) in `file-viewer-rules.ts`; `files.tsx` refuses before Office viewers and draws SVG from `data:`; `pdf-view.tsx` frees canvases of far pages; `sheet-read.ts` + `sheet-worker.ts` (SheetJS in a module worker, `worker.format: 'es'`); `slides-view.tsx` sizes pictures from `zipEntries` before inflating, counts each part once, `dropped` per slide and deck; `vite.config.ts` `thirdPartyLicenses()` writes `dist/THIRD_PARTY_LICENSES.txt` and drops all quickjs files; `code-view.tsx` `original` (Copy the original); `docx-view.tsx` watches `data-theme`; SheetJS from `apps/web/vendor/xlsx-0.20.3.tgz` (same integrity). Walk gains `bomb.pptx`, `many-pages.pdf`, a repeated slide picture and open-as-page probes. Rechecked: typecheck, format, build, `pnpm test:db` 1238 tests (1204 pass, 29 skipped, 5 known PowerShell failures), walk passes. Re-review (`/mnt/project-files/reviews/PR201_FILE_VIEWERS_REREVIEW_2026-11-15.md`: 2 L, 4 nits) fixed: `officeCheck` in `file-viewer-rules.ts` (DecompressionStream, 4 KiB input slices, refuses past the declared size, 64 MiB a part or 256 MiB in all; damaged or unknown methods refused) gates Office viewers in `files.tsx` `BinaryView`; `pdf-view.tsx` keeps `drawn` (page and settled render) and calls `page.cleanup()` when far; `zipEntries(bytes, names)` and `ZipEntry.method`/`offset` in contracts; `archive-view.tsx` "at least"; `sheet-view.tsx` transfers its copy. Tests: lying part, damaged stream, UTF-8 names; walk sample `liar.pptx`. Main merged (#199). Review 3 (`/mnt/project-files/reviews/PR201_REVIEW_3_2026-11-15.md`, 1 L, 1 nit) fixed: `localDisagrees` in `file-viewer-rules.ts` (method, data-descriptor flag, name, sizes, encryption, ZIP64 extra), `ZipEntry.flags`/`zip64`; test with a stored-central, deflated-local part. Rechecked after review 3: see BUILD_STATUS. Review 4 (`/mnt/project-files/reviews/PR201_REVIEW_4_2026-11-15.md`, 1 L, 1 nit) fixed: `zipLayoutProblem` and `zip64Extra` in contracts `files.ts` (`ZipEntry.zip64` is now the extra's sizes or null); `officeRefusal` refuses ambiguous layouts; `localDisagrees` accepts consistent ZIP64 extras; tests for a hidden second end record, mismatched counts, a short comment, extra central headers, and ZIP64 extras. Main merged (#202, #203). Review 5 (`/mnt/project-files/reviews/PR201_REVIEW_5_2026-11-15.md`, 1 L) fixed: `localDisagrees` checks the local sizes SheetJS uses (local ZIP64 when non-zero, else 32-bit) are 0 or the central ones; test with streamed parts (zeros pass, 0x1FFFFF00 and 0xFFFFFFFF+ZIP64 0 refused). Main merged (#200, migration 65). Review 6 (`/mnt/project-files/reviews/PR201_REVIEW_6_2026-11-15.md`, 1 L) fixed: `officeOpen(bytes, repack)` and `storedZip` in `file-viewer-rules.ts`; `files.tsx` gives `SheetView` the re-packed stored ZIP, never the original; `zip64Extra` marks short, repeated or partial ZIP64 fields malformed (`ZipEntry.extraMalformed`), refused local and central; tests for those shapes and a SheetJS round trip through the re-pack; walk sample `shortzip64s.xlsx`. Review 7 (`/mnt/project-files/reviews/PR201_REVIEW_7_2026-11-15.md`, 1 L, 2 nits) fixed: `sheet-read.ts` passes `sheet_to_json` a range clamped to the shown rows and columns; `StoredZip` in `file-viewer-rules.ts` replaces `storedZip` (one buffer sized from declared sizes, parts inflated in place, raw local name bytes); `SheetView` `transfer`/`onSpent`, `BinaryView` re-checks on `round`; tests for the reviewer's wide workbook, name bytes and exact re-pack size. Review 8 (`/mnt/project-files/reviews/PR201_REVIEW_8_2026-11-15.md`, 2 nits) fixed: `officeOpen` checks all headers before allocating; the cut-sheet note formats the column total. No findings remain; next is Jordan's merge. Earlier recheck: typecheck, format, build, `pnpm test:db` 1241 tests (1207 pass, 29 skipped, 5 known PowerShell failures), walk passes. Next: re-review in a separate thread.

## November 14 handoff — B1: building qualified in the app (ADR-0105, migration 65)

Branch `claude/project-thread-4czj6i`. Contracts `packages/contracts/src/recipe-qualification.ts` (benchmark ids and `RECIPE_BENCHMARK_INFO` with the frozen caps, record/attempt/pass-bar schemas, `RecipeBenchmarkOffersSchema`, `recipePasses`); `RECIPE_BENCHMARKS` values are now arrays. Frozen benchmarks `config/recipe-benchmarks/*-v5` (prettier-ignored; `scripts/recipe-benchmarks.mjs freeze <id>`). Executor: `recipe-scoring.ts` (`infrastructureStop`, `structureBar`, `barsPassed`; hashed into each FREEZE as `scorer:`), `recipe-benchmarks.ts` (`recipeFreezeProblems`, `loadRecipeBenchmark`); `RECIPE_QUALIFICATIONS` removed and `ArtifactSupervisor.package` takes `passesFor`. DB: migration 65, `recipe-qualification-store.ts` (`nextRecipeAttempt` holds the attempt rules), ConnectionStore `#recipeAttemptGate` and the start/stop/lease methods; `admitPlanRequest` takes `recipeAttemptId`. Broker: `buildRole`/`buildRolesReady` accept `run_id: null` with `recipe_attempt_id`. API: `apps/api/src/recipe-qualification.ts` (`RecipeQualificationRunner`, `startRecipeQualification`, `recipeBenchmarkOffers`), routes in `connections.ts` (`GET recipe-benchmarks`, `GET|POST plan-connections/{id}/recipe-qualifications`, `GET recipe-qualifications/{id}`, `POST …/stop`), runner wired in `index.ts` with its own product store. Web: `build-qualification.ts` (rules), `qualify-building.tsx` (Models), the web note in `build.tsx`. Desktop: `build-studio.mjs` stages `web_recipe.py`. Tests: `recipe-qualification.test.ts`, `web-build-qualification.test.ts`; `plan-fakes.ts` gains `respond`. Next: independent review in a separate thread; then the live packets with Jordan's typed OK (`docs/BUILD_QUALIFICATION_PACKETS_2026-11-14.md`).

Review 1 fixes (November 15): `nextRecipeAttempt` takes a `room` callback (`RecipeRoom` ok/wait/stop, `RECIPE_WAIT_MS`); `ConnectionStore.#recipeRoom` uses `#usage` (unresolved, daily cap, in-flight age); the runner keeps its lease on `wait`. `recipe-scoring.ts` is `recipe-scorer/2` with `ROLE_CAUSED_STOPS`, `pythonLogicalLines`, `hasTopLevelFunction`, `importsLedger`. Any change to `recipe-scoring.ts` (even formatting) changes the scorer hash: run prettier, then `rm FREEZE.json; node scripts/recipe-benchmarks.mjs freeze <id>` for all three v5 benchmarks, and only while no v5 record exists.

Re-review fixes (November 15): `recipe-scoring.ts` is `recipe-scorer/3` with `ROLE_CAUSED_REFUSALS`, `refusalError` (coded build reason) and `onlyBusyRefusal`; the runner wraps `buildRole` in `sendWhenFree` (bounded wait `RECIPE_ROLE_BUSY_WAIT_MS`, 4 min). `PlanConnectionService.buildRole` reports any `model_refused` outcome other than Claude's as `model_refused`. `pythonReadProblem` backs the structure bar. `#recipeRoom(c, conn, classes)` also checks `connectionRefusals`.

Third review fixes (November 15): migration 65 adds `recipe_qualifications.max_input_chars` (check: set exactly when in_app). `startRecipeQualification` bound takes `min_input_chars` (`firstBuilderInputFloor`); `ConnectionStore.recipeInputCapLowered(attemptId)` feeds the runner's `sendWhenFree({ inputCap })`; `refusalError(e, inputCap)`. The fake plan's `respond` may return an error step.

Review 4 and 5 fixes (November 15): `pythonRead` drops only the file's one final line ending and flags a backslash on the last line (`lastContinued`), so a backslash followed by a blank or comment line at the end is valid. Migration 65 also records `min_input_chars` (the Start floor), which the lowered-cap stop names; `RecipeQualificationRecordSchema.max_input_chars` is shown by `recordLine`. Scorer label `recipe-scorer/5`; v5 freezes re-cut (review 5 nit). No review findings remain; next is Jordan's merge, then the live packets with his typed OK.

## November 14 handoff — B3 Build page timeline, results and repair benchmark

Branch `claude/project-thread-bn6eyf` from main 2faaa17; no migration or ADR (coordinator reserved migration 67 / ADR-0107 if needed; unused). Executor: `build-progress.ts` (`readBuildProgress`, `BuildProgress`, `CaseFailure`), `BuildSupervisor.progress(product, build, running)`. API: `StudioBuilds.buildList` adds `progress` to each task's newest build; `begin` sends `frozenBrowserCases` for `static-web/1` (in-app web builds were refused before); test seam `createApi(env, { buildPorts })` → `StudioBuilds.wrapPorts`. Web: `build-progress-rules.ts` (`timeline`, `nowLine`, `stopExplanation`, `judgedRound`, `runSteps`, `testedSummary`, `changedFiles`), `build-progress.tsx` (`BuildDetails`, `BuildTimeline`, `WhyFailed`, `BuildProgressSchema`), rendered in `build.tsx` on each task's newest build row; CSS at the end of `style.css`. Benchmark set `repair-v1` (`scripts/p14-benchmark.mjs` `SETS`, `setOf('p14-repair-v1')`), mutants in `tests/src/p14-benchmarks.test.ts`. Evidence and walk: `tracking/evidence/b3-build-page/`. Live repair benchmark done on Jordan's PC (3 of 3, no repair needed, 6 requests, $0; Jordan's dev studio now runs this branch at schema 63). Review 1 fixed (`nowParts`, `headlineText`, `codex_turns`, daily-cap and no-covering-grant stops; main merged); L-3 (#200's trial label on web results) goes to whichever of #200/#203 merges second. Next: re-review; the desktop preview look on Jordan's PC. `pnpm test:db` after review 1: 1235 tests, 1201 pass, 29 skipped, 5 known PowerShell-wrapper failures. Review 2 nits fixed (`nowLine` removed; `headlineText` adds the period unless the headline ends in ? or !; only the owner can add the 20 requests). The live records are a local commit on Jordan's PC (`claude/project-thread-48x3x8` `0616a077`), waiting for his OK to push.

## November 14 handoff — plan per-run cap 30 and held-claims next step (PR #199)

Branch `claude/project-thread-77qqks` from main f073115, with main 9f162d1 merged in (no migration or ADR). `config/connections/chatgpt-plan.json` and `PROPOSED_SETTINGS` in `apps/web/src/models.tsx` use `max_requests_per_run: 30`. `docs/MODEL_CONNECTIONS.md` and the owner decision in `tracking/DECISIONS.md` were updated. `apps/web/src/autopilot-held.ts` `heldClaimsSetting(a, canContinue)` is used by the `claims_held` branch of `NextAfterStop` in `autopilot.tsx`. The Evidence covers text is in `packages/contracts/src/oversight.ts`. Tests are in `tests/src/web-caps-form.test.ts`. Dev studio: f073115, schema 63, plan cap 30 accepted. Live rerun findings, including follow-ups 7 to 12, are in `/mnt/project-files/reviews/LIVE_AUTOPILOT_RERUN_SCHEMA63_2026-11-14.md`. The discovery packet-size refusal and follow-ups 9 and 10 are fixed in PR #202 (branch claude/project-thread-wvhnhi); a copy of the packet fix was pushed here and reverted. #202 also changes the claims_held text in `autopilot.tsx`, so whichever merges second keeps `heldClaimsSetting`. Next: re-review of review 1's fixes in a separate thread.

## November 14 handoff — autopilot fixes from the live rerun (branch `claude/project-thread-wvhnhi`)

From main 9f162d1, no migration. `packages/domain/src/discovery.ts` `buildPacket` fits the catalog to the room left (optional `limit`), `EvidencePacketSchema.catalog_beyond_limit` (optional). `apps/api/src/autopilot.ts`: exported `heldSearch(steps, stage)` finds the held web search past repeated claims_held stops; `#afterHeld` uses it; `#plan` reserves 0 calls for research or gather going on from a held search; `Stop.child` keeps the search on a re-stop; `Stop.unsent`/`Fallback.unsent` make `#finish` and `#redo` give the step's calls back; review 1 L-5: `#run`'s catch sets it only when the start call itself threw (`#starting` wraps `web.start` and `start{Exploration,Discovery,Assessment}` and records the step key in `#refused`). Review 1 L-3: `DiscoveryWorkflowContext.duplicates_against` keeps the 40 fetched records when the packet had no room for some, `disposeDiscovery({ catalog })` checks duplicates against them, and `catalogBeyondNote` adds the count to the discovery's explanation; the skeptic's `catalog_matches` stay on packet entries because it can only cite packet refs. N-2: `buildPacket` cuts titles to 160 and summaries to 200 when the entries do not all fit, then keeps the newest that fit. L-4: `cutText` replaces `.slice` in `summaryOf`, `buildPacket` and every string cut in the runner (re-review L-1). Re-review: `#starting(ws, step, start)` records a refusal only when the start's receipt does not exist (`Store.commandCommitted(ws, key)` over `command_receipts`, third review N-1; a failed read counts as sent); `duplicates_against` is always stored (N-3); `withNote` in `workflow-store.ts` leaves the note room in the 1,200-character explanation (N-2); store test in `discovery.test.ts` (N-4). Web: claims_held next text in `autopilot.tsx`; contracts Continue detail. Tests: P-12 test now does Continue then Allow; new tests for the refused-step release with and without a retry and for a start that returned before recording failed (`autopilot.test.ts`), and for the catalog budget and cuts, emoji-safe cuts and duplicates beyond the packet (`discovery-domain.test.ts`). Left: an unscoped web search can drift off topic. (The routine policy wording about quote-checked claims was fixed on main by #199.) Next: re-review, then a live rerun with Jordan's typed OK.

## November 14 handoff — UX pass P-2 (Path branches) and P-5 (draft the missing sections) (ADR-0101, migration 64)

Branch `claude/project-thread-ta0ygk` from main 7edcd3e. Migration 64 `proposal_section_drafts` (one pending row per proposal, `(proposal_id, client_id)` replay, settle-once trigger that only allows a redaction after settling); ADR-0101 in `tracking/DECISIONS.md`. Decide holds 65/0102, Discover 66/0103, Shell 67/0104.

P-2: `OverviewSchema.selections` (`count`, `latest` with `route` software / non_code / none and the newest proposal's `unknown_core`, `reviewed`, `revise`) from `CatalogStore.overviewSelections`. `apps/web/src/next-rules.ts`: `pipelineStep` and `pathStages` branch after Selection (`proposalStep`, `NO_ROUTE_STEP`); `next-step.tsx` passes `selection`; Monitor › Overview gains a Selections tile; the proposal export says "Unknown yet".

P-5: contracts `packages/contracts/src/proposal-draft.ts` (draftable sections, fixed instructions `proposal-section-draft-v1`, `readSectionDrafts`, `proposalDraftInput`, `draftMarkText`); `ProposalSectionBodySchema.draft` (`SectionDraftMarkSchema`, written sections only). Store: `ConnectionStore.beginProposalSectionDraft` / `finishProposalSectionDraft` (owner only; chat answers on and studio records allowed; version and unknown-section checks; stale pending rows closed like chat answers; audit holds ids, sections and hashes), `ProposalStore.listProposalSectionDrafts` and `markDrafts` (the studio checks each mark and sets `model_id` and `edited` itself), redaction clears drafts' words. Broker `PlanConnectionService.proposalSectionDraft` (chat purpose). Routes `GET`/`POST proposals/{id}/section-drafts`. Web `proposal-drafts.tsx` (`DraftMissing`, `SectionDraftOffer`, `useSectionDrafts`) and pure `proposal-draft-rules.ts`; Proposals shows each draft under its section with Use this draft and Dismiss, and the default "What changed" names the drafts used.

Tests: `tests/src/proposal-section-drafts.test.ts` (new), `tests/src/web-proposal-drafts.test.ts` (new), new Path cases in `web-next-step.test.ts`; shared seeding moved to `tests/src/proposal-harness.ts`. Walk `tracking/evidence/p2-p5-path-proposals/walk.mjs` (fake `claude`, ports 5183/4330/4340, throwaway DB): Path after a non-code selection, draft, use two drafts, save v2, preview labels, Path and Monitor after, 390 px, 0 console errors. Checks: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on PostgreSQL 16 (1204 tests: 1170 pass, 29 skipped, the 5 known PowerShell-wrapper failures); the walk passes on the merged branch.

Main (with #193) merged in. Autopilot: setting `draft_proposal_sections` in `packages/contracts/src/autopilot-settings.ts` (off, in Hands-off, listed in `autopilot-settings.tsx`); `AutopilotRunnerOptions.drafts` (`ProposalDrafter`, wired to `planService.proposalSectionDraft` in `apps/api/src/index.ts`); `#proposal` calls `#draftSections` after saving (press id from the step key; never stops the autopilot). Tests in `autopilot.test.ts` (setting on, off, and refused). No live model call. Review 1 (1 M, 4 L, 6 nits; `/mnt/project-files/reviews/PR198_PATH_PROPOSALS_REVIEW_1_2026-11-14.md`) fixed: `ConnectionStore.listProposalSectionDrafts` closes stale pending drafts on read via `#closeStaleSectionDrafts` (clears input when the proposal is redacted); the autopilot's `#plan` reserves one call for the proposal step (`request.draft_sections`: ask / no_calls / no_service), `#draftSections` races the step's abort signal and reports a pending replay as on its way; `handsOffMissing` names the Hands-off switches not on; `draftEdited` in `proposal-draft-rules.ts`; `PlanConnectionService.#chatOnce` settles chat fills and drafts; walk screenshot `05-path-proposal-still-next.png`, failure shots go to the temp folder. Rechecked: 1208 tests, 1174 pass, 29 skipped, 5 known PowerShell failures; walk passes. Next: re-review in a separate thread.

## November 14 handoff — final UX pass: shell and wording (P-8, P-9, P-14, P-15, Budgets folds)

Branch `claude/project-thread-mj3965` from main 7edcd3e; ADR-0104, no migration. New web modules: `amounts.ts` (`money` moved here, `cents` with a `down` rounding for what is left, `roundedAway`), `money.tsx` (`Money`, with `down`, `bare` and `inButton`), `plain-words.ts` (`ACTION_LABEL`, `kindLabel`, `codeLabel`, `versionTag`, `plainEvent`, `plainText`, `withArticle`), `labels.ts` `runRef` (a run in a sentence: its name in Standard), `event-line.tsx` (`EventLine`). `runLabel` takes `id` and `plainUncertainty` takes `ids` (Standard passes false). `next-rules.ts` `pathBanner` replaces `pathSummary`; the Sources line names registering a run when `runs` is 0. Server: `problemTitle` in `workflow-store.ts` (N-2), `tiedNames` in domain `autopilot.ts` (N-3). Evidence and walk: `tracking/evidence/ux-shell-wording/`. Left to other area threads: Monitor › Runs, Sources › Library and Discover's theme draft to Advanced (Discover), Decide's history fold (Decide). Test stubs: `web-session.test.ts` stubs `amounts`, `plain-words` and `view-mode` for `oversight.tsx`; `web-display.test.ts` stubs `money.js` and `view-mode.js`. Reviews 1, 2 and 3 are fixed (review 3: `routinePolicySummary` exact dollars in contracts, `ROLE_NAME` tables) (`plainReason`, `plainText` known codes only, `useActors(ws, ids)`); see the evidence README's "Review 1 fixes". Next: re-review in a separate thread.

## November 14 handoff — Discover P-6, P-7 and Runs/Library to Advanced (ADR-0103)

Branch `claude/project-thread-wloopy`, no migration. New: `apps/web/src/discover-panels.ts` (start choices, `panelsFor`, `firstPanel`; `SHOW_PANEL` is in `ui.tsx`), `discovery-progress-rules.ts` (`discoveryLine`, `shownDiscoveries`), `discovery-progress.tsx` (`DiscoveryProgress`, on Discover and Decide). `submit.tsx` wraps each panel in `data-panel` with `hidden`, and stays on Discover after a start (`startedId`); `reveal` in `ui.tsx` opens a closed panel first; `automation.tsx` and `web-discovery.tsx` scroll through `reveal`. `pages.ts` `ADVANCED_ONLY` adds `runs` and `catalog`; `main.tsx` page dots count listed tabs only. Runs links in `compare.tsx` and `assess.tsx` show in Advanced only. N-15 fixed (`.short-title`); N-14 fixed (`.notice.stacked` on the autopilot summary, after merging main with #193). Tests: `tests/src/web-discover-progress.test.ts`, `view-mode.test.ts` updated. Review 1 (`/mnt/project-files/reviews/PR196_REVIEW_2026-11-14.md`, 1 M, 3 L, 5 nits) fixed: `shownDiscoveries(list, now, hidden, keep, include)` lists live ones first and applies Decide's filter before the cap; controls are owner only; `aside.tsx` `nowTarget(item, standard)` sends discovery, exploration and assessment workflows to Projects in Standard, using the role that `sidebar-store.ts` now puts in `purpose`; "Pausing" line; `revealWhenShown` for Decide's Search the web; one sr-only status line; the list sits below the choices with finished lines folded; theme pointer button; page-specific heading ids. Re-review (`/mnt/project-files/reviews/PR196_REREVIEW_2026-11-14.md`, 1 L, 3 nits) fixed: sidebar items carry `subject_id` (contract and `activityNow`; test in `sidebar.test.ts`), so a Standard assessment opens Decide on its problem; a discovery item reveals `dp-discover-<id>` (line ids name the page, third review N-D); "Pausing" uses the running tone; the theme button reads "Switch to Advanced to start with a theme" with a visible note. Third review: only nits N-D (line ids) and N-E (theme note alignment at 390 px), both fixed; PR marked ready. The Overview's links to Runs are left as listed-while-open.

## November 14 handoff — P-3 approve in place and P-4 one-step gate confirmation (ADR-0102)

Branch `claude/project-thread-5xtdra` from main 7edcd3e; ADR-0102, no migration (63 is #193's, 64 the Path/Proposals thread's). Contracts: `ConfirmGatesRequestSchema`, `ConfirmGatesResultSchema`, `gateItemReason` (`team.ts`), `advanceOutlook` (`selection.ts`). Store: `SelectionStore.confirmGates`, with `confirmGate` and it sharing `gateReport` (per-option advisory locks in id order) and `confirmableGate`; `TeamStore.insertGateConfirmation` takes an optional batch (`batch_id`, `reason_from` in the event payload). Route `POST problems/{id}/gate-confirmations/batch`. Web: `gate-batch.ts` (pure rules), `AdvanceAndGates` in `gates.tsx` (shown on Decide before the options), `inline-approval-rules.ts` and `inline-approval.tsx` (`InlineApproval`, used by Decide's Record, Freeze and Build's admission stop; `Coverage` is now exported from `oversight.tsx`), `assumptionsSummary`/`historySummary` in `decide-routine.ts` (Standard folds). Tests: one new test in `team-gates.test.ts`, new `web-gate-batch.test.ts`. Evidence and walk scripts: `tracking/evidence/p3-p4-decide-approvals/`. `pnpm test:db` with #193 merged: 1201 tests, 1167 pass, 29 skipped, 5 known PowerShell-wrapper failures. Review 1 (1 M, 5 L, 6 nits) fixed: `inlineApprovable(d, { owner, actorId })` needs the requester, `decisionOutcome`/`decisionApproved`, `InlineApproval` takes `approveLabel`/`againLabel`/`afterText` and reloads on show and focus, `batchNote` and `tickedByDefault` use `gatesConfirmableNow`, HTTP route test in `team-gates.test.ts`; test:db 1202 tests, 1168 pass, 29 skipped, 5 PowerShell. Re-review 2 (2 L, 3 nits) fixed: `InlineApproval` uses the quiet `refresh` on focus and after a failed approve (no extra `useOnShow`; `useLoad` already reloads on show), takes `retryLabel`, Build's `afterText` names Start build, `.approval-step` spacing; walks rerun, same test:db counts. Next: re-review in a separate thread; the Discover thread owns Decide's "Discovery run" link and a progress line near the top of Decide; P-8 (Shell/wording) owns the internal words in the approval coverage.

## November 14 handoff — more automation for the autopilot (ADR-0100, migration 63)

Branch `claude/project-thread-77qqks` from main 5809f09. Contracts `packages/contracts/src/autopilot-settings.ts` (settings schema, defaults, `handsOff`, stop kinds, `SETTING_FOR_STOP`, setting text, `settingOn`, allow request, next steps, fallback record, `MODEL_ONLY_ETHICS_NOTE`); `autopilot.ts` adds the `gather` stage, `stop_kind`, `fallback`, `next` and `autopilotNextSteps`, and `autopilotRoutinePolicy`/`restRoutinePolicy` take `{ gatherSearch }`. Domain: `autopilotChoice(report, settings)` with the fallbacks, `pickExplored(result, skip)`, `autopilotChildLimits` takes `per_run_used`; `claim-suggest.ts` is the server copy of the web's claim suggestions. DB: migration 63 (`autopilot_settings`, `gather` stage), `AutopilotStore` settings, `allowAndContinueAutopilot` and `autopilotLinkClaims`; `selection-store.ts` honors `choose_model_ethics` for the autopilot only; `workflow-store.ts` links cited claims when `gather_evidence` is on; `ConnectionStore.planRunRoom`. Runner `apps/api/src/autopilot.ts`: fallbacks, the gather loop, `allowAndContinue`. Routes `GET|POST workspaces/{ws}/autopilot-settings`, `POST autopilots/{id}/allow`. Web: `autopilot-settings.tsx` (panel, hook, change event), `autopilot-next.tsx` (`AllowAndContinue`, rendered once in `autopilot.tsx` after Continue), `automation.tsx` (panel, new-run option). P-11/P-12 (ADR-0100 amendment): `autopilots.routine_policy_id` and `approvals_ended_at` (migration 63), `OversightStore.endRoutinePolicyIn`, `AutopilotStore.#endOwnApprovals` (advance and cancel), `autopilotEndsApprovals` (with `SETTLED_BUT_COVERED`); setting `accept_quote_checked_claims`, stop kind `claims_held`, `AUTOPILOT_QUOTE_CHECK_LABEL`, `admitted_via = 'autopilot'`, the gate in `admitWebClaimsByPolicy` (`#autopilotSearch`), the label in `claimEvidenceIn` and proposal references, runner `#held`/`#heldStop`/`#afterHeld` and `AutopilotWeb.accept`. Review 1 fixes: stop kind `connection` and exported `refusalKind` (plan reason codes), `#fitsRunCap` at start, `#searchRoute(a, settings, own)`, `web_discoveries.autopilot_id`, `autopilotLinkClaims(…, dataClass)`, cited-claim links only on autopilot steps. Re-review 2 fixes: `settingIsOn` (contracts), `autopilotNextSteps(a, settings)`, runner `with(a, settings)`/`withNext` and `#settle` (a settled stop whose setting is on is final), the store refuses an Allow that changes nothing, `#fitsRunCap` sums each step's floor and runs inside `startAutopilot`'s idempotent start (`beforeNew`), `workflows.autopilot_id` (migration 63). The UX pass thread (PR #192) owns the stopped card's next-step wording around this. Next eligible: re-review of the re-review 2 fixes in a separate thread; then a live run on the dev studio after its upgrade, with Jordan's typed OK.

## November 14 handoff — P-1 build after approval and P-10 build run default

Branch `claude/project-thread-7ob594` from main 5809f09; no migration or ADR. `packages/executor/src/build.ts`: an acceptance case the worker did not finish stops the build with "The worker did not finish check … The candidate is kept; build again once the worker runs." (after `active()`, so a cancelled run still reports its own reason); a resumed build accepts a `NoChangePatchError` (new, `packages/executor/src/products.ts`) on a candidate that is not the task's base and that this build has not judged (`judged`), and reviews and tests it. `apps/web/src/build-defaults.ts` `buildRunDefault`; `StartBuild` takes `specRun` (the latest freeze's run when it is the product's spec version). Tests: `tests/src/build-retry-web.test.ts` (new, Build's request shape, fails on main), two new tests in `build.test.ts` (the "continues from its last candidate" test now uses the test double, since QA runs before the review verdict is acted on; the Codex test expects the worker's reason without WSL2), `buildRunDefault` in `web-next-step.test.ts`. Evidence and walk scripts: `tracking/evidence/p1-build-retry/`. The 390 px target-size finding on Build is the "Export a runbook" text button, fixed by PR #192's `button.text` min-height (0 violations with #192 merged). Review 1 (1 M, 2 L, 4 nits; `/mnt/project-files/reviews/PR194_REVIEW_2026-11-14.md`) fixed: `needsRecover` (whole-word `locked`) in `build-defaults.ts`; `cleanup_required` stops say "Recover this product first"; `artifactForBuild` needs a verified build; the unfinished case writes `qa-<round>-<case>.json` (`unfinished: true`) and its execution id is in the reason; `candidate-N.json` of a carried-over candidate has `kept: true`; evidence names all three small buttons and the walk setup. Re-review L-1 fixed: Build no longer reads grants at all (the plan route's one build approval admits its requests, ADR-0054), so the run note, the "no model grant" labels, the granted-run default and `modelGrantCovers` are gone; `buildRunDefault(runs, specRun)`. Next: merge; then P-2..P-15 per Jordan's decisions; the live walk on Jordan's PC stays a separate step with his typed OK.

## November 14 handoff — final UX pass, fixture part (PR #192)

Jordan approved the plan at 00:57 UTC. The cloud fixture pass is done. `scripts/ux-sweep.mjs` (Playwright and axe-core, a dev dependency) took 156 shots; the full fixture walk is in `docs/FINAL_UX_PASS_FINDINGS_2026-11-14.md`.

Web-only fixes on this branch:

- autopilot next step after every stop, with links; readable-claims count; end time renewed; per-run cap warning; the Start box always unticks
- Decide and Path banner wording
- Approvals "press it again" hint
- Back to top button
- checkbox alignment and 16 px boxes; text buttons at least 24 px
- doubled kind labels, the `problems//explanation` 404, condensed uncertainty text, run labels without a repeated date, and smaller wording fixes

Checks: typecheck, format:check and 243 web unit tests pass; the sweep re-run shows 0 axe violations and 0 console errors.

Proposals P-1..P-15 wait for Jordan. P-1 (High) is a bug: a build retried after approval fails with "Patch changes nothing", likely because `build.tsx` retries from `task.head`.

Server-side autopilot work belongs to the "Expand autopilot automation options" thread (branch `claude/project-thread-77qqks`).

Next: an independent review of #192, then Jordan's decisions and one thread per area, the live walk, and the L-3 docs last. No migration or ADR.

## November 14 handoff — final UX pass plan (draft for Jordan)

Docs only, no code, migration or ADR. `docs/FINAL_UX_PASS_PLAN_2026-11-14.md`: the pass's fix-small/propose-big rule, severity scale, references (Nielsen, WCAG 2.2 AA, Fluent/Material, Laws of UX), where it runs (cloud fixture, dev studio Testing workspace, installed app Testing workspace), checks by area, the Standard/Advanced method, the full project walkthrough, and known items K-1..K-13 (live autopilot notes, November 10 UX notes, audit L-3). Next: Jordan approves or revises the plan; the pass starts only after that.

## November 12 handoff — full codebase audit fixes

Branch `claude/project-thread-2jhwqe`, no migration or ADR. Report `docs/FULL_AUDIT_2026-11-12.md` (also `/mnt/project-files/reviews/FULL_AUDIT_2026-11-12.md`), with a Fixes section. New: `usePoll` in `apps/web/src/page-active.ts`; `useLoad` returns `stale` and `Status` takes `stale`; `apps/web/src/end-time.ts` (`endAfter`, `useEndTime`); `dueAutomations` ignores failed or cancelled newer assessments. Tests: `tests/src/web-load-poll.test.ts` (8, a small hook harness, no DOM), `automation.test.ts` audit N-7, `codex-host.test.ts` pin check. Review 1 (2 L, 5 nits) fixed: `StaleNote` in `ui.tsx`, `stale` on every `useLoad` view (scan test in `web-load-poll.test.ts`), `usePoll` in `assess.tsx` `Run`, `explore.tsx` and `overview.tsx`, `endTimeClose` in `end-time.ts`, `useLoad` tracks the dependencies its data was read for. Open: L-3 docs refresh at the final UX pass. Re-review nits N-1..N-4 fixed (`useEndTime` takes `keep`, the confirmation; `useLoad` shows Loading on a full load; one end time in the automation widen test). Next: merge.

## November 12 handoff — PR #150 review nits N-1..N-3

Branch `claude/project-thread-eondj8`, no migration or ADR. `tests/src/web-recipe.test.ts`: the recorded-qualification test filters `RECIPE_QUALIFICATIONS` by all six fields of the results file's record (recipe, benchmark, connection, model, both prompt hashes), no longer imports `BUILD_ROLE_PROMPTS`, expects the record to qualify its own roles only while its benchmark is current, and checks `source_files`. `tracking/evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json` gains `source_files` (40 files under `C:\dev\creator_agent_p15\.creator\p15-benchmarks\v4\runs\`, SHA-256 and bytes; no file there is newer than 2026-11-06 21:44). `docs/STATIC_WEB_RECIPE.md`: 64.8 to 67.6 s. No older review items remain open.

Review 1 fixes (2 Lows, 2 nits): the test matches the record on all six fields, so a requalification with new prompts or another model's record on the same connection stays green; the count is 40 files, not 41; the freeze check reads the results file's own benchmark folder; the note says intent.json and the screenshots are not among the hashed files (hashing intent.json needs read access to the p15 worktree's `.creator` folder, which was not granted).

## November 12 handoff — P33 automation levels for a project (ADR-0099, migration 62)

Built on branch `claude/project-thread-lmx6uz` from main 66a93c8. Contracts `packages/contracts/src/automation.ts` (levels and their text, `automationStagesNeeded`, `RunAutomationConfigSchema`, `runAutomationSummary`, `automationAutopilotConfig`, `selectionRoutinePolicy`, `restRoutinePolicy`, `policyCovering`, `policyInputOf`); `AutopilotSchema.automation_id`. Store `packages/db/src/automation-store.ts` (`AutomationStore` between `AutopilotStore` and `ConnectionStore`: `setRunAutomation`, `stopRunAutomation`, `listRunAutomations`, `dueAutomations`, `startAutomationAutopilot`); `AutopilotStore.checkAutopilotPolicy` is now protected so the level reuses it. Runner `AutopilotRunner.automate` (called by `watch` each minute and after a level is set). Routes `POST runs/{run}/automation`, `GET automations`, `POST automations/{id}/stop`. Web `apps/web/src/automation.tsx` (panel on Discover) and `apps/web/src/autopilot-routes.ts` (route helpers now shared with `autopilot.tsx`). Migration 62 `run_automations` plus `autopilots.automation_id` and `trigger_workflow_id`; ADR-0099. #185 holds migration 60 and ADR-0097, #187 ADR-0098; if either merges first, merge main here and keep migrations.ts in numeric order. Review 1 (1 M, 5 L, 5 nits; `/mnt/project-files/reviews/PR188_REVIEW1.md`) is fixed: the approvals change now rides in the level's or autopilot's own request (`routine_policy`, one transaction through `OversightStore.setRoutinePolicyIn`/`reviseRoutinePolicyIn`), archived problems are skipped, studio stops are recorded as the studio's; see ADR-0099's amendment. Review 2 (1 L, 3 nits; `/mnt/project-files/reviews/PR188_REVIEW2.md`) is fixed: `policyCovering` takes `used_nano_usd`, the panel widens used-up or expired approvals, a level's leftover autopilot shows as Manual, and `startAutopilot` applies the approvals change after its run checks. Review 3 (1 L, 1 nit; `/mnt/project-files/reviews/PR188_REVIEW3.md`) is fixed: `RoutinePolicyView.stop_reason`, the panel's blocker and `idleReasons`, and `applyRoutinePolicyChange` refusing a revision while a stop condition holds. Next eligible: another re-review if wanted; then the dev studio upgrade and Jordan's final UX pass; a later P13 slice adds spec, build, review and QA for software options so Whole process can go past the spec.

## November 12 handoff — Oversight lock order fixes (ADR-0098)

Branch `claude/project-thread-iqbxmf`, no migration. `packages/db/src/oversight-store.ts`:

- `cancelRun` locks routine policies and grants before it appends.
- `lockGrantForWrite` locks run, policy, then grant, and returns `{ grant, routine }`. `revokeGrant` and `reviseGrant` use it.
- `writeGrant` updates the policy row before it appends.
- `answerDecision` locks the run first.
- `admitIn` locks the run and grants (`lockAdmissionGrants`, protected) before `expireDue`.

Other stores:

- `web-discovery-store.ts`: `admitWebClaimsByPolicy` locks the discovery, the grants and the claims' sources up front.
- `workflow-store.ts`: `lockWorkflowRun` (run, then workflow) is used by `controlWorkflow`, task finish, `sweepLeases`, `wakeIn` and `reconcileTasks`. `coordinateIn` locks waiting tasks' decisions before a stop's changes.
- `desktop-job-store.ts`: `expireJobs(c, queuedOf)` locks overdue jobs, plus that device's queued jobs, in id order, then updates exactly those. `desktopControlChanged` locks the device's jobs in id order before updating them.
- `connection-store.ts`: `#admitPlanRequest` locks a workflow task's run before its workflow.
- Re-review 3: `Store.consumerLocks(topic)` (WorkflowStore: decision answered/closed), and `drainOutbox` delivers such an event first in its own transaction. `#lockClaimSources` is used by both web claim paths. `recordRouteOutcome` locks the promotion first. `lockAssessmentRows` runs from `lockWorkflowRun` for an unfinished assessment, and `coordinateWorkflow` uses `lockWorkflowRun`. `claimTasks` gates every workflow before leasing. `admitIn` takes the portfolio fence before `expireDue`.

Tests: the lock-waiter helpers (`lockWaiters`, `hold`, `holdAudit`) are in `tests/src/pg-harness.ts`. #180's `copy-connection.test.ts` now uses the shared `lockWaiters` too.

## November 12 handoff — the last older review items (#128 N-6, #129 N-4, #90 N-4 leftover)

Built on branch `claude/project-thread-kxrgo2`, no migration or ADR. `PlanRelay.#handle` (`packages/executor/src/codex-host.ts`) listens for the Codex response's `close` from admission on and aborts the upstream call with `CodexDisconnected` unless the response finished; `stopReason` classifies an abort as `codex_disconnected`, `relay_closed` (new `RelayClosed`, from `close()`) or `timeout`. `Oversight` (`apps/web/src/oversight.tsx`) keeps `loadFailed`: an error from a failed load is cleared by the next load that works; an action's error is not. Review nits fixed: `if (res.destroyed) gone()` after the listener covers a disconnect during admission. #129 N-4 is covered by `tracking/evidence/member-roles/walk.mjs` (role set with SQL as a test seam, since development sign-in has one member) rather than component unit tests: the pages load their data in effects, and the repo has no DOM test harness. #75 L-1, #77 L-1 and the first point of #90 N-4 were already fixed on main. Next: independent review in a separate thread. Older items still open: PR #150 N-1..N-3.

## November 12 handoff — the owner's gate checklist (ADR-0097, migration 60)

Built on branch `claude/project-thread-uf8kgy`: migration 60 (`gate_checklist_versions`; `gate_rule_versions.mode` adds `checklist`); contracts `GateChecklistSchema`, `SaveGateChecklistRequestSchema`, `PacketChecklistSchema`, `STARTER_GATE_CHECKLIST` (`packages/contracts/src/team.ts`), the packet's `checklist`, the assessor's `checklist`/`access_needs`, the card's `assessment.checklist*`, and each gate's `checklist` detail; domain `verifiedCapabilities`, `packetChecklist`, `checklistHash` (`team.ts`), the checklist checks in `checkAssessmentOutput` and the fixture answer, `checklistResult`/`checklistMiss` in `selection.ts`; store `gateChecklist`, `saveGateChecklist`, `checklistForPacket` (`team-store.ts`) and their use in `selection-store.ts`; API `workspaces/{ws}/gate-checklist`; web `GateChecklistEditor` (`team-profile.tsx`), checklist misses in `gates.tsx`, the packet preview in `assess.tsx`. Tests: `gate-checklist` (new), `team-api`, `team-domain`, and the v3 counts in the qualify tests. Next: review in a separate thread; after merge, requalify the dev studio's assessor on `assessment-synthetic-v3` (Jordan's OK).

## November 12 handoff — P30 copy connections between workspaces (ADR-0095)

Built on branch `claude/project-thread-vy3q6k`. `ConnectionStore.copyPlanConnection` (`packages/db/src/connection-store.ts`) copies kind, name and settings into another workspace the caller owns (owner of both, same record mode, not the same workspace, current `expected_version`); the new row is written by `#insertConnection`, now shared with `createPlanConnection`, which takes a per-workspace name lock so a duplicate name is always `DUPLICATE`. Nothing earned is copied: no sign-in or credential, model access, grants, qualifications, credits statement or caps acceptance. Provenance is in the copy's `created` event (`copied_from`) and the source workspace's `connection.copied` audit record; no migration. `chat_answers` (opt-in; the form says first that Chat answers may come on there) copies the source's Chat answers setting only when it uses this connection and the target has none (`copied`, `not_requested`, `source_not_using`, `target_has_own`). Route `POST plan-connections/{id}/copy` (`apps/api/src/connections.ts`); contracts `CopyPlanConnectionRequestSchema` / `CopyPlanConnectionResultSchema`; web `apps/web/src/copy-connection.tsx` (form and the steps left) and `copy-connection-text.ts` (targets and step text). Deviation: the ChatGPT sign-in is not reused across workspaces (refresh token rotation and revocation, ADR-0095). Numbers: ADR-0095, no migration (reserved migration 60 is unused). Review 1 (2 Lows, 6 nits) fixed: opt-in Chat answers copy with the note before Copy, copy-versus-create name race test, settings rechecked before copying, copy refusal wording for viewers and testers. Re-review 2 and 3 fixes: the copy names the Chat answers version its note described and is refused if that changed (the form then re-reads and unticks); the result says whether the copied setting is on; the setting is read without a row lock and before any write, so a copy and a Chat answers save at once cannot deadlock (test). Re-review 4: all of the copy's rows are written before its audit records, so a ticked copy and a Chat answers save in the target cannot deadlock either (test, both with and without a target setting); the concurrency tests wait on reported lock waits, not sleeps. Re-review 5: a Chat answers save checks its version inside the write, so a stale first save (another tab, or racing a copy) is refused instead of overwriting (pre-existing gap in `setChatSettings`; tests). Re-review 6: a model switch writes the Chat answers row before its audit records, so it cannot deadlock against a Chat answers save in the same workspace (pre-existing order in `setModelChoice`; test), and the two-first-saves test now really overlaps the saves. Jordan's check at the next upgrade: copy a connection into another workspace he owns of the same kind (fixture or real), sign in there, accept caps, verify the model and Qualify all.

## November 12 handoff — P13 autopilot, slice 1 (ADR-0092, migration 57)

Built on branch `claude/project-thread-ykuvt6`. Contracts `packages/contracts/src/autopilot.ts` (config, steps, outcomes, `autopilotSummary`, `autopilotStagesNeeded`, `autopilotRoutinePolicy`); rules `packages/domain/src/autopilot.ts` (`nextAutopilotStage`, `autopilotChildLimits`, `pickExplored`, `autopilotChoice`, `refusalOutcome`); store `packages/db/src/autopilot-store.ts` (`AutopilotStore`, now a base of `ConnectionStore`; start, advance, cancel, retry, `runningAutopilots`); runner `apps/api/src/autopilot.ts` (`AutopilotRunner`, `webResearch` adapter over P12's runner), wired and recovered at start in `apps/api/src/index.ts`; web panel `apps/web/src/autopilot.tsx` on Discover. Migration 57 (`autopilots`), ADR-0092; migration 56 and ADR-0090 stay with #179, ADR-0091 with #178. Tests `tests/src/autopilot.test.ts`. This branch includes #179's branch (merged in for review 1, H-1): an autopilot's selection is recorded under the Autopilot agent actor with `autopilot_id`, and with ethics cleared only on the model's word (ADR-0090 `model` rule) it is not admitted and stops for a person, per Jordan's November 12 decision. If #179 changes before it merges, merge it here again and keep migration 56 before 57. A person's selection under Decide while an autopilot waits is carried on by Continue. `config.start` (assess or select of a recorded problem) is ready for P33; no panel offers it yet. Next eligible: independent review; then P33 (automation levels as presets over `autopilotRoutinePolicy`, plus this autopilot for "Whole process"); a later P13 slice adds spec writing, build, review and QA for software options. A live run needs Jordan's typed OK (plan requests or API spend within the $20 ceiling).

## November 12 handoff — P29 extra requests when the daily cap runs out (ADR-0094)

Built on branch `claude/project-thread-sldot1`: **migration 59** (`plan_extra_requests`, append-only), ADR-0094. Numbers from the coordinator's table: P13 holds migration 57 / ADR-0092, P28 58 / ADR-0093, P30 60 / ADR-0095, P31 61 / ADR-0096; #179 holds 56 / ADR-0090 and #178 ADR-0091. Whichever merges later keeps its own number and inserts its migration in version order in `migrations.ts` (backups and the version shown read `migrations.at(-1)` as the newest); the runner applies any missing version and the startup check counts them, so a gap before 59 is fine while 57 and 58 are unmerged. Contracts: `PLAN_EXTRA_REQUESTS` (20), `PLAN_EXTRA_HOURS` (24), `GrantExtraRequestsRequestSchema`, refusal code `daily_cap_reached`, connection detail `usage.extra_requests` / `extra_until` (optional), usage summary `connection_version` and `daily.configured_cap` / `extra` / `extra_until` / `can_add_extra` (`daily.cap` is now the cap in force). Domain: `PlanUsageCounts.extra_requests` and `dailyCap`. Store: `grantExtraRequests` (POST `plan-connections/{id}/extra-requests`, `{ expected_version, requests: 20 }`), `#extra`, `#usage` adds the extras. Web: `apps/web/src/extra-requests.tsx` (`AddExtraRequests`, `DailyCapNotice`), the usage panel and button, the Models card, and the `extra_requests` fix in `fix-here.ts` / `fix-buttons.tsx`. Tests: `tests/src/p29-extra-requests.test.ts` (5); `storage.test.ts` expects schema 59; `p27-fix-here.test.ts` now expects `daily_cap_reached` for a full daily cap. Checked: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` on a throwaway PostgreSQL 16 in the cloud container: 1045 tests, 1011 pass, 29 skipped, the same 5 PowerShell-wrapper failures (the schema-number test was then updated and passes). No browser walk and no model call. Review 1 (4 Low, 5 nits) all fixed: `isPolicyOwner` in `oversight-store.ts` (non-throwing `requireOwner` test) sets `can_add_extra` on summary and detail; `extras` (each with `expires_at`) replace `extra_until`; `nextRequestAt` in `plan-admission.ts` computes next-request time with expiring extras; detail has `next_frees_at`; store-level admission test in `plan-connections.test.ts`. Re-review 2 (1 Low, 3 nits) fixed: the P27 fix uses `can_add_extra` (`ready` exported from `fix-buttons.tsx` for tests), `extras` uncapped, one `next_frees_at` rule, `#usage` returns the window's start times from the same statement. Re-review 3 (2 nits) fixed: `usage-summary.ts` reads starts, clock and extras in its main statement; Chat answers uses `capWords` (`extra-requests-text.ts`). Next eligible: unchanged (P13, P28, P30, P31 in their own threads). Jordan's check at the next upgrade: when a connection is used up, the top bar says so, and Add 20 requests lets work continue for 24 hours without changing the connection's caps.

## November 12 handoff — P28 OpenAI API key in Models and connections (ADR-0093)

Built on branch `claude/project-thread-xhr7vr`. Migration 58 (`workspace_api_keys`: vault reference, model, last four, version, saved by/at; one row per real workspace, `fixture` must be false); ADR-0093 (numbers reserved by the coordinator: #179 holds migration 56 and ADR-0090, P13 migration 57 and ADR-0092, #178 ADR-0091). The vault (`packages/broker/src/plan-vault.ts`) gains `getApiKey`/`putApiKey` under `openai-api-key/<uuid>` references with their own DPAPI entropy and file names; plan sign-in files are unchanged. `ApiKeyService` (`packages/broker/src/api-keys.ts`) seals before it records, deletes the new entry if the record is refused and the old one after a replace or remove, and gives the broker the workspace's adapter through the new `ModelBroker` option `liveFor` (the environment's live adapter still wins). Store methods are in `connection-store.ts` (`workspaceApiKey`, `workspaceApiKeyRef`, `saveWorkspaceApiKey`, `removeWorkspaceApiKey`; owner only for changes, audit `api_key.saved/replaced/removed`). Routes: `GET|POST /api/workspaces/{ws}/api-keys/openai`, `POST .../openai/remove`. Web: `api-key-check-panel.tsx` reads that status instead of `broker/status`; `keyProblem` in `api-key-check.ts`. 64,000 default input cap: `models.tsx` proposed settings and `config/connections/chatgpt-plan.json`, `claude-code.json`. Checks: typecheck, format:check, test:db 1048 tests after re-review 3 (1014 pass, 29 skipped, 5 known PowerShell-wrapper failures); `tests/src/storage.test.ts` now expects schema 58. Jordan's check at the next upgrade (needs his typed OK, a paid request under one cent): add the key in the Testing workspace's Models page, then Test connection; also add a new connection and see 64,000 proposed. Next eligible: P29, then P30 and P31. Review 1 (4 Lows, 6 nits) fixed: a saved key the studio cannot open shows as unusable (`saved_unavailable`), a failed file delete is reported and retried, the 64,000 default is pinned by a test, the startup, health and Budgets texts mention saved keys, and Change model re-points a key without pasting it (see ADR-0093 review amendment). Review 2 (2 Lows, 4 nits) fixed: a damaged key file is never quoted in the log, a studio without a key store no longer claims it deleted a file, failed unlocks are retried once a minute, and the health text no longer overclaims (re-review amendment).

## November 12 handoff — P31 model help on Chat cards (ADR-0096, migration 61)

Built on branch `claude/project-thread-frdk72`. Contracts: `CHAT_FILL_KEYS`/`fillableKey`, `ChatActionFillRequestSchema`, `ChatActionFillSchema`, `CHAT_FILL_INSTRUCTIONS` (`chat-card-fill-v1`), `readFillValues` in `packages/contracts/src/chat-actions.ts`; `ChatDetail.fills`. Store: `beginChatActionFill` / `finishChatActionFill` in `connection-store.ts`, `fillInput` / `toChatActionFill` / `chatActionFills` in `chat-action-store.ts`; `deleteChat` waits for a pending fill. Broker: `PlanConnectionService.chatActionFill` (purpose `chat`, same admission as answers). API: `POST …/chats/{c}/actions/{a}/fill`. Web: `chat-card.tsx` (Fill in, proposals, Use these, Next step button, Explore for me inside the discovery card), `chat.tsx` (`nextFor`, `answerWait`), `chat-cards.ts` (`answersFromPick`, `exploredPick`; the discovery plan reuses an unedited pick's brief). Migration 61 was reserved for P31; 56–60 belong to other threads, and gaps apply fine. Review 1 fixes pushed (ADR-0096 review 1 amendment; `assertSchemaCurrent` in `migrate.ts` now names missing versions; `fillType` in contracts). Re-review 2's four nits fixed (ADR-0096 re-review 2 amendment; `ApiError.status` in `oversight.tsx`). Next eligible: Jordan's merge decision, after re-checking main's migration numbers.

## November 11 handoff — option claims, claim linking, range explanation (ADR-0091)

#178 merged (after #179). Merge-review follow-up #186: the response explanation and gate confirmation pass `team_hash` and `problem_linked_hash` like every other `selectionReport` call, so a team-profile change makes cards stale there too and `report_changed` agrees; no migration. The notes below were written before the merge.

Branch `claude/project-thread-j9fsjp`, no migration. Packet: `ASSESSMENT_CLAIMS_SQL` and `linkedClaimsHash` (`claim:option` keys) in `packages/db/src/selection-store.ts`; `AssessmentInputClaim`, coverage-first claim order and `option_coverage` in `packages/domain/src/assessment.ts`; optional `options` on `AssessmentClaimSchema` and `option_coverage` on `AssessmentPreviewSchema`. Web: `link-claims.tsx` (`LinkClaims`, `ClaimLinks`), `claim-suggest.ts` (pure: `suggestClaims`, `rangeEnds`), `web-search-handoff.ts`; `Coverage` and `RangeWhy` in `assess.tsx`; Compare, Evidence, Catalog and WebDiscover wired. R08 untouched on purpose (qualification check compares the system text). The ethics/access gate thread plans ADR-0090 / migration 56 and an R08 change; expect a small merge in the packet notes area of `assessment.ts`.

Review 1 (`/mnt/project-files/reviews/PR178_REVIEW1.md`: 1 Medium, 4 Low, 7 nits) fixed; see the ADR-0091 review amendment. Merge notes for #179: keep `RangeWhy`, `LinkClaims` and `GateLines` imports in compare.tsx; keep `ASSESSMENT_CLAIMS_SQL` and `extends TeamStore`, and both `outputCap` and `team` in `buildAssessment`; rerun assessment-packing tests after. Re-review 2 (`PR178_REVIEW2.md`: 2 Low, 5 nits) and re-review 3 (`PR178_REVIEW3.md`: 1 Low, 2 nits) fixed; see their amendments. Main (with #177) merged in.

After upgrading, problems with claims already linked to options show their automatic assessments as stale; assess again to read them (the stale reason says this).

Next: Jordan tries Link claims on the CSV problem and assesses again (about 2 plan requests, needs his OK).

## November 11 handoff — team profile and gate confirmations (ADR-0090)

Built on branch `claude/project-thread-uf8kgy`: migration 56; `packages/contracts/src/team.ts`; `packages/domain/src/team.ts` (profile rules, packet block, `CAPABILITY_CHECKS`); `gateState` in `packages/domain/src/selection.ts`; `packages/db/src/team-store.ts` (profile, checks, confirmations, rule; `SelectionStore` now extends it, and `confirmGate` lives in the selection store); `apps/api/src/team-checks.ts` and the `team-profile`, `team-profile/checks`, `gate-rule` and `problems/{id}/gate-confirmations` routes; `apps/web/src/team-profile.tsx` (Settings) and `apps/web/src/gates.tsx` (Compare). Review 1 (`/mnt/project-files/reviews/PR179_REVIEW1.md`) is fixed: the gate rule is now a three-way `mode` (`owner`, `team_profile`, `model`; migration 56 was edited in place since it is unmerged), staleness follows `team_hash`, re-checks that find the same are no-ops, checks keep a declared No. Before live use: re-qualify assessment (scoring) on the plan connection with the new `assessment-synthetic-v2` (prompt `r08-assessor/1.2`; 11 plan requests). Review 2 (`PR179_REVIEW2.md`) is fixed too; `modelClearedEthics` (domain) adds the `ethical_judgment` flag to a non-person's selection. Next: part 2, the owner's ethics checklist walked through by the model.

## November 11 handoff — P27 fix it here (ADR-0087)

Built on branch `claude/project-thread-z75as7` (draft PR #177). Plan refusals carry stable codes (`PlanRefusal` in `packages/contracts/src/connections.ts`, built by `admissionRefusals` / `connectionRefusals` in `plan-admission.ts`; the old `*Blockers` functions return the same words). The web picks fixes from codes or from what the page knows (`apps/web/src/fix-here.ts`, `missingTaskFixes` in `discover-defaults.ts`) and draws them with one owner-only component (`apps/web/src/fix-buttons.tsx`) in Discover, Explore for me, Automatic assessment, the Chat discovery card and Build. Run and Finish of a qualification are owner-only on the server. No migration; ADR-0087 used (P24 holds ADR-0088 and migration 55, P34 ADR-0089, no migration; P12 ADR-0086 and migration 54). Discovery benchmarks come from the server: Discover, Explore for me and the Chat card call `useQualifyOffers(base)`, which reads `GET plan-benchmarks` into the fix offers, started by name with `{ expected_version, model_id, benchmark }`; a failed re-read keeps the list read before, and a fix whose benchmark is no longer offered says so and can't be pressed. `roleOf` reads every case as P34's `manifestRole` does (web discovery offers no fix). "Allow and qualify these tasks" posts one P24 qualification queue (`queueRequest`), which the studio runs one after another, stopping at the first that does not pass; while a queue or a Run holds the connection, presses that qualify wait (`queueBlocks`). A fix's outcome stays on the page where it was pressed after the refusal goes (`FixOutcome`, keyed by workspace and `FixContext.place`). **Merged with #175** (main 750a7a6): Explore computes `explorationQualified` with `isDiscoveryQualified`, `roleOf` wraps P34's `manifestRole` (`'web_discovery'` → null, null → `'plan'`), the offers are read with contracts' `DiscoveryBenchmarksSchema`, and a test checks that the tasks a fix can qualify are exactly `QUALIFY_IN_APP` with the server's offers. **Merged with #176** (P24): contracts keep the `PlanRefusal*` and queue schemas one after the other, each with its `/**` opener; the detail schema and `planConnectionDetail` return both `qualification_queue` and `refusals`; `requireOwner` stays in `planQualificationManifest`; `startPlanQualification` refuses a start by hand while a queue runs (review 8 N-1). Next eligible: P28 and P29. Jordan's check at the next upgrade: a refused Discover, Explore or Build start offers the fix beside the reason.

## November 11 handoff — P24 qualify several tasks (ADR-0088)

Built on branch `claude/project-thread-hw1q5w`: migration 55 (`plan_qualification_queues`, `plan_qualification_queue_items`), ADR-0088. Store: `startQualificationQueue`, `cancelQualificationQueue`, `planQualificationQueue`, and the runner's `leaseQualificationQueue` / `renewQualificationQueueLease` / `releaseQualificationQueueLease` / `nextQueuedQualification` / `recordQueuedRun` in `connection-store.ts`; the start checks were moved into `#checkQualificationStart` / `#insertQualification`, shared by Start and the queue. Runner: `QualificationQueueRunner` (`packages/broker/src/qualification-queue.ts`), started with the API (`apps/api/src/index.ts`) and kicked by `POST plan-connections/{id}/qualification-queues`; cancel is `POST plan-qualification-queues/{id}/cancel`. `claimQualificationRun` refuses a hand Run while a queue runs on the connection. Web: "Qualify several tasks" and the queue's progress in `apps/web/src/qualify.tsx`; Activity kind `qualification_queue`. Numbers used: migration 55, ADR-0088 (P27 holds ADR-0087, P34 used ADR-0089 and no migration; re-check main). Next: independent review; then Jordan's live check, which needs his typed OK (a queue of the bundled benchmarks on a verified model sends one plan request per case: up to 45 for the six bundled benchmarks on a fresh connection (8 + 8 + 8 + 4 + 4 + 13 with web-discovery-v2), 63 with P34's three discovery benchmarks, at $0 on the plan but above the default 40-a-day request cap, so Qualify all stops at the cap partway through and the section says so before it starts; on the dev studio gpt-6-astra is already qualified for web discovery v2, so it is not offered there and Qualify all needs up to 32 for the bundled benchmarks, plus 6 for each of P34's three discovery benchmarks not yet qualified on the current discovery prompts (up to 50; check the section on the dev studio); a new queue later takes over the started task and skips its answered cases). After the merge with P34 the queue keys and qualified checks follow each role (ADR-0089), a queue item can name an offered discovery benchmark, and the three discovery benchmarks are queue choices too, so Qualify all on a fresh connection needs up to 63 plan requests (45 + 18), above the default 40 in any 24 hours; the section says so before it starts.

## November 11 handoff — P34 qualify the discovery roles in the app (ADR-0089)

Built on branch `claude/project-thread-s4ihl8`: `packages/db/src/discovery-benchmarks.ts` (moved `currentForDiscoveryRole`; `DISCOVERY_BENCHMARK_DIRS` newest first; `offeredDiscoveryBenchmarks`), `ConnectionStore.planBenchmarks` and start by `benchmark` name in `startPlanQualification`, route `plan-benchmarks`, contracts `StartOfferedQualificationRequestSchema`, `DiscoveryBenchmarksSchema`, `admits_discovery`, `isDiscoveryQualified`; web `qualify.tsx` (`offers`, per-role `benchmarkState`), `qualifiedFor` in `model-switch.tsx`, discovery checks in `submit.tsx`, `chat-card-load.ts`, `explore.tsx`; `QUALIFY_IN_APP` now has the discovery classes. ADR-0089 used, no migration (migration 56 was reserved and is free again). When the discovery role prompts change, freeze a new benchmark and put its folder at the top of `DISCOVERY_BENCHMARK_DIRS`; `discovery-benchmarks.test.ts` fails until then. Merging with P12 (PR #173): both touch `toQualification` and `qualify.tsx`; keep both flags, and the web-discovery benchmark stays a bundled entry (its `admits` should filter on `admits_web_discovery`). Review fixes (PR #175 review M-1, M-2, L-1, nits) add `apps/web/src/qualification-role.ts`; when merging P12, its `forDiscover` wrappers can go (`qualifiedFor` / `isDiscoveryQualified` already exclude web qualifications), keep `forWebDiscovery`, and the web-discovery benchmark is tagged by `manifestRole` automatically. Live (Jordan's typed OKs, dev studio conn 4e4a7bec): gpt-6-astra qualified for research synthesis (cc9e4f2a), candidate generation (cab57f95) and discovery scoring (7118b6d9), each 4/4 held out; the connection now allows all tasks and has a daily cap of 70 (was 40), caps re-accepted (v40). Merged with P12 (#173): now at schema 54, so the dev studio can run this branch. P27 (#177) handover for whichever merges second: /mnt/project-files/reviews/PR175_P27_HANDOVER.md (test loader stub for `./qualification-role.js`, `manifestRole`, server-offered discovery benchmarks). Next eligible: re-review.

## November 11 handoff — P12 Search the web (ADR-0086, migration 54)

Built on the ChatGPT plan route only: `packages/domain/src/web-discovery.ts` (prompts, lead and quote checks, page quality, grading), `packages/db/src/web-discovery-store.ts` and `web-discovery-gates.ts` (records, plan and fetch admission bound to the owner's start, claim admission by owner or routine policy), `apps/api/src/web-discovery.ts` (the stage runner), routes under `runs/{run}/web-discoveries`, `web-discovery-preview` and `web-discoveries/{id}/{cancel,resume,admit,dismiss}`, and `apps/web/src/web-discovery.tsx` on Discover. Tests: `tests/src/web-discovery.test.ts` (fake plan, fixture pages). To use it live: allow research synthesis and public data on the ChatGPT connection, qualify the model on `web-discovery-v2` under Models and connections (one plan request per case, 13 cases, $0 on the plan), then Discover › Search the web. Live on the dev studio (2026-11-11, Jordan's typed OK): gpt-6-astra failed v1 (5/7 held out, over-long "why" text) and qualified on v2 (7/7 held out); one discovery on volunteer scheduling proposed 8 checked claims from 5 read pages, all left pending for Jordan (`tracking/evidence/web-discovery-live-2026-11-11/README.md`). UI follow-ups from that run are in: the page summary counts pages read, "Add all" sits below the claims with a read-first note, and Explore's not-qualified message names the discovery-locator benchmark. Migration 54 and ADR-0086 are used; the next free numbers are migration 55 and ADR-0087 unless P23–P26 took others first (re-check main). Next: P13 (unattended workflow), then P33. Pages fetched before schema 54 (such as the Microsoft Learn page from the walkthrough) keep their menus inline until they are fetched again; stored passages cannot be changed, so item 15 shows only on new fetches. Reviews 3 and 4 (PR #173, November 11): web-discovery and Discover qualifications are read apart everywhere in the app (`forDiscover`/`forWebDiscovery`; Discover, Explore, the chat card, the model picker, the Models list and Qualify a model), the held-out guard drops a web check's role version from the case key and rechecks every recorded view against the benchmark it showed (so views stored before this change still guard), and model text that is stored is made well formed (no half emoji). Checked in the cloud container: `pnpm typecheck`, `pnpm format:check`, and the full `tests/dist` suite on PostgreSQL 16 (994 tests: 960 pass, 29 skipped, 5 known PowerShell-wrapper failures). If #175 (P34) merges first, follow the reconcile plan in `/mnt/project-files/reviews/PR173_P12_REVIEW4.md`.

## November 11 handoff — P23 qualify section (ADR-0084)

Built on branch `claude/project-thread-0uxoq0` (PR to follow): server guard against a second concurrent qualification Run (`claimQualificationRun`, in-process claim plus an in-flight check), `executing` on started qualifications in the connection detail, the Qualify section moved up and showing qualified/failed/started/not-allowed states with Allow this task, Decision A defaults (all tasks the kind can take) in the Models page and `config/connections/*.json`, Allow all tasks, Select all / Deselect all for tasks, clearer "not allowed" refusals, Model box example. No migration; ADR-0084 used. Next free numbers: migration 54, ADR-0085 (P25 holds ADR-0085 and P12 ADR-0086 by plan; re-check main). Review fixes pushed on the same branch (all findings of the PR #172 review, nits included); needs a fresh re-review. P34 (qualify the discovery roles in the app, planned in PR #174) is needed before the next user test; when it adds benchmarks it must add their task classes to `QUALIFY_IN_APP` in `apps/web/src/discover-defaults.ts` (a test enforces it). Next eligible: P24 (qualify several, background runner), P27 (fix it here) and P34 after this merges; P25, P26 and P12 run in parallel threads. Installed app gets this only at Jordan's next upgrade; existing connections keep their allowed work and show Allow all tasks.

## November 11 handoff — P25 assessment requests that fit

[ADR-0085](DECISIONS.md) amends ADR-0074. `buildAssessmentPacket` (`packages/domain/src/assessment.ts`) now returns the packet with its requests (`batches`, `request_chars`, `claims_left_out`) sized to an input cap, or a refusal naming the option that does not fit alone; `selection-store.ts` reads the cap from the plan connection (preview `?connection=`, start `resource_setup`). Decide (`apps/web/src/assess.tsx`) shows the sizes and an "Open Models and connections" button to raise the cap. Tests: `tests/src/assessment-packing.test.ts` (pure) and a DB test in `assessment.test.ts`. Review fixes (PR #171 review: M-1, L-1 to L-4, N-1 to N-5) are in; the preview also returns `cap_for_all` and `claims_over_max`, and Decide shows "Rates on N of M linked claims". Re-review fixes (L-A, N-A): the coarsest split that reads every claim always wins, so every cap from `cap_for_all` up reads all claims (a test checks 30 caps above it); the size refusal is `BODY_TOO_LARGE` (HTTP 413), and Decide's cap help keys on that code. Pending Jordan: whether new connections default to a 64,000 input cap instead of 24,000 (not changed here). Next: a live check on Jordan's real problem after his typed OK (dev studio, or the installed app after its next upgrade); if the 24,000 cap still leaves too few claims there, he raises the input cap on that connection. Next free numbers after this: migration 54, ADR-0086 (re-check main; P12 may take them).

## November 11 handoff — P26 stale state and small polish

P26 (walk items 5, 9, 13, 14) is on branch `claude/project-thread-8jjhd7`, web only, no migration or ADR. Chat answers picks up a newly verified model by itself, the usage count goes live when a long request starts, and badge and step numbers are centred. Item 19 belongs to P23 now. Jordan's check at the next upgrade: verify a model on a fresh connection and see Chat answers offer and save it without Reset fields; watch the top-bar count move during a qualification run; look at the Activity count and the Path circles at 100% and 125%. Next eligible prompts unchanged: P23, P25, P12 (running), then P24 and P27 after P23, P28 and P29 once this merges.

## November 11 handoff — fix plan from the installed-app walk

Docs only. [FIX_PLAN_INSTALLED_WALK_2026-11-11.md](../docs/FIX_PLAN_INSTALLED_WALK_2026-11-11.md) groups the 24 findings from Jordan's walk of the installed app at schema 53 ([record](evidence/installed-upgrade-53-2026-11-11/README.md), PR #168) into packages P23–P32, with order and Jordan's November 11 decisions: all allowed work on for new connections plus one-click allow buttons; whole-process automation (P33) right after P13, and P13 a priority; P12 discovery through the model connections' own web search, no search or browser API. Target before the next user test: P23–P31, P12, P13, P33. No code changed. Next eligible prompts: P23 (qualify section), P25 (assessment packets that fit) and P26 (stale state and polish), in parallel. Next free numbers: migration 54, ADR-0084.

## November 11 handoff — Creator Agent visual assets

The [identity folder](../assets/creator-agent/README.md) includes the mark, theme variants, cover and a usage guide; `SHA256SUMS.txt` binds its bytes. The web shell, desktop status window, Windows icon and NSIS installer images now use it. The installed desktop app picks this up only at Jordan's next upgrade, which is also the first on-screen check of the installer header and sidebar bitmaps. Next eligible product prompt is the P12 discovery follow-up once Jordan selects its scope.

Current source: main `e08e0a4` (PR #150, November 6). Schema **49** (migration 42 is intentionally
unused, see ADR-0070). No open pull requests on November 10. The installed app is still `f6e2ba0`,
schema **41** (upgraded November 4); the dev studio on Jordan's PC runs from the worktree
`C:\dev\creator_agent_p15` at `b73bd95`. This top section was rewritten on November 10 by the state
review ([report](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA)); the November 4 text it replaced
is kept verbatim below under "November 4 top section (superseded)". Dated sections further down are
the record of each package and are appended to, not rewritten.

## Current state (November 10, 2026)

[November 5 plan](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md) packages:

| Package                                    | State on main                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| P00 candidate and repair closure           | Done (PR #135; F1/F2 recheck passed)                                                                                                  |
| P01 activity links, P02 sorting and paging | Merged (PR #138)                                                                                                                      |
| P03 chat context                           | Merged (PR #136, fixes #139; ADR-0070, migration 43)                                                                                  |
| P04 guided Discover                        | Merged (PR #140; ADR-0071)                                                                                                            |
| P05 workspace files                        | Merged (PR #141; ADR-0072, migration 45)                                                                                              |
| P06 named notes                            | Merged (PR #142; ADR-0073, migration 46)                                                                                              |
| P07 previews until stopped                 | Merged (PR #137; ADR-0069, migration 44)                                                                                              |
| P08 automatic assessments                  | Merged (PR #144; ADR-0074, migration 47)                                                                                              |
| P09 why this response, proposals           | Merged (PR #148; ADR-0077, migration 49)                                                                                              |
| P10 scoped routine approvals               | Merged (PR #153; ADR-0079, migration 50); no evidence-admission stage yet (P12)                                                       |
| P11 committee staging                      | Design and tester accounts merged (PRs #135, #143; ADR-0075, migration 48); deploy waits on D1–D9                                     |
| P12 online discovery                       | Built (ADR-0086, migration 54): Search the web through the plan connection's own web search; live qualification waits for Jordan's OK |
| P13 unattended workflow                    | Not started; needs P10 and P12                                                                                                        |
| P14 capability inventory and benchmarks    | Merged (PRs #135, #145, #146; ADR-0076)                                                                                               |
| P15 larger software                        | Slice 1 `static-web/1` merged and recorded qualified on one route (PRs #149, #150; ADR-0078); later slices not started                |
| P16 external runbook export                | Merged (PR #152; ADR-0080, no migration); wording follow-up merged (PR #163)                                                          |
| P17 integrated acceptance                  | Not started                                                                                                                           |
| P18 collapsible options, shorter pages     | Merged (PR #162; no migration or ADR)                                                                                                 |
| P19 Standard/Advanced across the app       | Merged (PR #164; ADR-0082, migration 52); Decide and Proposals folds follow-up on branch `claude/project-thread-qc6o5z`               |
| P20 whole process from Chat                | Merged (PR #165; ADR-0083 amending ADR-0057/0070, migration 53)                                                                       |
| P21 quick model switch                     | Merged (PR #161; ADR-0081, migration 51)                                                                                              |
| P22 live API and GitHub checks             | Merged (PR #160); live checks passed November 10–11 (R24, R25)                                                                        |

Checks on main `e08e0a4`, November 10 (cloud container, PostgreSQL 16): TypeScript, web typecheck and
formatting pass; `pnpm test:db` 867 tests, 833 pass, 29 skips, 5 fail (the known wrapper tests that need
`pwsh`); standalone safety 22 tests, 19 pass, 2 skips, 1 fail (a Windows-only test that did not skip on
Linux; fixed in the November 10 cleanup). `pnpm audit` reports no known vulnerabilities. GitHub Actions
is out of minutes (every run since about November 3 fails in seconds), so the Windows CI job has not run
for PRs #132–#150.

Open items:

- **Web recipe record (PR #150 review M-1):** resolved November 10. Jordan opened the previews of attempts
  2 and 3 and both showed the page, so the frozen per-attempt bar is met for 3 of 3.
- **Installed app** is eight schema versions behind main; migrations 43–49 are not rehearsed on a copy of
  the installed database, and the web preview frame is not observed in the desktop window.
- **Windows verification:** no full Windows run of main since CI stopped.
- **Owner pilot:** finished. Jordan marked it finished on November 10 (PR #155); its window ended
  November 6.
- **Older review items still open:** PR #150 N-1..N-3 (#128 N-6 and #129 N-4 fixed November 12). Health reports configuration,
  not live state; the preview cookie-host limit remains. (#75 L-1 was repaired earlier; #77 L-1, the first point of #90 N-4
  and PR #148 N-I are fixed by the November 10 cleanup; the second point of #90 N-4, a stale poll error, on November 12.)
- **The web qualification record** lives in source against the dev studio's connection id, so it does not
  apply to the installed app's connection.

## P20 review fixes (November 11, PR #165, ADR-0083 amendment, migration 53 unreleased)

Review: `/mnt/project-files/reviews/P20_PR165_REVIEW.md` (0 High, 1 Medium, 5 Low, 6 nits), all fixed:
M-1 a fetch card asks before registering a new fetching run (it creates a grant); L-1 the card's safety note is
accurate; L-2 a decision card's `time_spent_ms` runs from when the card is shown to Send, in milliseconds; L-3 a held
send reads "Held for a decision"; L-4 a test sends a discovery card's own request against a human-only run and gets
the form's `HUMAN_ONLY_DENIED`; L-5 "Send again" names the card it repeats (`again_of` column) and keeps its origin and
model answer; N-1 placeholders fill whole values and path segments only; N-2 no repeated source; N-3 records marked
`in_trail` by the store; N-4 a sender who lost the editor role can still record the outcome; N-5 plain message over
40 records; N-6 DECISIONS.md reflows reverted and the package table corrected. Migration 53 was edited in place
(never released): a database that ran the earlier 53 must be re-created.
Re-review (`/mnt/project-files/reviews/P20_PR165_REREVIEW.md`): L-6 refusal-only events no longer make a card
`partial`; N-7 walk script updated and re-run; N-8 "Send again" on a fetch card reuses its run; N-9 new-run question
reworded. Second re-review clean (0 Low+); nits N-10 and N-11 fixed. Ready for Jordan to merge after #164.

## Next eligible prompt

P10 and P16 merged on November 10 (main `cb12eeb`; next free migration 51, ADR-0081). Jordan's 25 revision notes
were checked against main on November 10 (12 done, 7 partial, 6 not done; 14 done, 6 partial, 5 not done after P22's
live checks; table in the
[plan's November 10 section](../docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md#november-10-check-of-jordans-revision-notes-and-added-packages-p18p22)),
which added P18–P22. Next: P18 and P21 (small, UI only, can run in parallel); P22 (live tests approved November 10);
then P19; P12 once Jordan picks the next step from the search route investigation (PR #157, merged); P13; P20; later P15 slices; P17.
The installed-app upgrade stays owner-gated (rehearse 41 to current on a copy first). Do not automatically install,
publish, run a live provider or advance the pilot or thesis. Accepted owner decisions and existing scoped grants
remain authoritative.

## Previous sessions

All prior content is preserved byte-for-byte in [the historical record](SESSION_HANDOFF_HISTORY_2026-11-04.md); hashes
are in [the archive receipt](evidence/codebase-repairs-2026-11-04/document-archives.json).
The [previous section index](SESSION_HANDOFF_HISTORY_INDEX_2026-11-04.md) retains section names and archived targets without loading the historical narrative at startup.

## November 4 top section (superseded)

Current source: main `171430b` plus authorized audit and authentication review repairs (uncommitted). Schema 41;
no installed-app change, live provider call or new milestone activation. Preserve the existing
`.codex/config.toml` user change and the audit report/evidence from the previous turn.

### Current work (November 4)

The first [repair report](../docs/CODEBASE_REPAIRS_2026-11-04.md) and Claude's
[independent review](../docs/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md) retain their original scope.
Follow-up M1/L1 repairs bind outcomes to the admitted login and actual credential, permit
unrelated changes during browser sign-in, and preserve Disconnect/newer logins. L2 is an
additive browser evidence correction; L3 restores the open items below. See
[the follow-up report](../docs/CODEBASE_AUTH_FOLLOWUP_2026-11-04.md) for current checks and hashes.

Claude's [follow-up review](../docs/CODEBASE_AUTH_FOLLOWUP_INDEPENDENT_REVIEW_2026-11-04.md)
passed M1/L1/L2/L3 with two Lows. Jordan authorized their repair: the
[F1/F2 repairs](../docs/CODEBASE_AUTH_F1F2_REPAIRS_2026-11-04.md) (ADR-0068) bind quota,
eligibility and model-access observations to the login generation and add Codex relay and
Claude Code regressions. The reviewing thread made these repairs, so they are not independently
reviewed yet.

Current verification (after F1/F2): full PostgreSQL suite **742 pass, 27 explicit skips, zero
failures** (769 tests); current safety **22/22**; TypeScript, web typecheck, formatting and
whitespace checks pass.

Prior schema-40 suite/bundle receipts remain historical. Schema 41 is tested
on disposable databases only; no installed bundle or operational database migration.
C54 and full product acceptance remain partial; fixture/contract/native/live/activation
evidence stays separate.

### Open items retained from earlier reviews (November 4)

- **#77 L-1:** no test asserts the artifact comparison's `base_calls`/`candidate_calls` (reverting `calls()` in `artifact-store.ts` stays green). Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#90 N-4:** fixed: the Revoke/Stop error on November 10, the stale poll error on November 12.
- **#128 N-6:** the Codex relay notices a disconnect only at its next write, not while waiting in `reader.read()`. Detail recovered in [the P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md); still open.
- **#129 N-4:** component-level role coverage remains absent; owner-only browser evidence and pure role rules do not establish a second-member UI check.

Source: [historical handoff](SESSION_HANDOFF_HISTORY_2026-11-04.md), “Older open review Lows”.
#75 L-1 was repaired by the current-prompt qualification labels; the four items above were not closed by this follow-up.

### Next eligible prompt (November 4, superseded)

Next: **U02 focused independent recheck of the F1/F2 repairs** (`#settlePlanRequest` and the
three new tests), then owner-authorized acceptance work, including a migration-41 rehearsal on a
copy of a real schema-40 database.
Do not automatically install, publish, run a live provider, start new additions or advance the
pilot/thesis. Accepted owner decisions and the existing scoped grants remain authoritative.

## November 5 revision planning (documentation only)

Added docs/CREATOR_AGENT_IMPLEMENTATION_PLAN_2026-11-05.md and
CREATOR_AGENT_PROMPT_RUNBOOK_2026-11-05.md: all 19 owner revisions mapped to 18
implementation packages, plus eight retained backlog tracks and task prompts.
Coverage and prompt-fence checks passed. No application code, operational data,
configuration, grants, provider calls, installation or activation changed; prior test
results were not rerun. The actual project is C:\dev\creator_agent; the supplied
OneDrive workspace path no longer exists. A read-only Git status attempt reported
“must be run in a work tree”; exact candidate/dirty-state reconciliation is included
in P00. Next eligible remains the focused independent F1/F2 recheck, before additions.

## November 5: P00 remainder, P11 staging design, P14 capability matrix (documentation only)

- [P00 reconciliation](../docs/P00_RECONCILIATION_2026-11-05.md): the candidate is main `9fe673b`, schema 41;
  the next free migration is 42 and ADR 0069 (recheck, because parallel threads allocate them). The F1/F2
  independent recheck already **passed** and the migration-41 trial and upgrade are done, so the
  "Next eligible remains the focused independent F1/F2 recheck" lines above are superseded. #77 L-1
  and #128 N-6 details were recovered from their original reviews. The Nov 1 audit and pilot F2–F21
  findings have a status table.
- [Committee staging design](../docs/COMMITTEE_STAGING_DESIGN_2026-11-05.md) (P11): costed hosting
  and sign-in options, code gaps G1–G6 (only one OIDC subject can sign in; builds need Windows+WSL2),
  and decisions D1–D9 for Jordan. Nothing was chosen, created or bought.
- [Capability matrix](../docs/CAPABILITY_MATRIX_2026-11-05.md) (P14 inventory): only `python-build/1`
  and `python-terminal/1` are supported. Every other kind is unsupported or unverified. Also lists
  representative tasks and a proposed P15 order.

No code, data, configuration, provider call or installation changed, and no tests were run (docs only).
Next eligible: P01. P11 continues with tester accounts (G1) once started, and its deploy waits on D1–D9.

## P03 chat context (November 5, 2026, ADR-0070, migration 43)

Chat now answers general requests broadly. Each message has a context choice (Automatic,
General, My projects, Selected records); an explicit choice wins, and Automatic sends studio
records only when the message names them. The fixed rules no longer turn ordinary sentences
into approvals/blocked/next cards. Each answer records the context used, why, and any picked
records, shown in "What was sent". Instructions `chat-assistant-v2`. Fixture-verified only (fake
`claude`, disposable PostgreSQL 16 in the cloud container); no live call, no installed-app change.
Checks: typecheck and web typecheck pass; suite 771 tests, 738 pass, 28 skip, 5 fail (the known
PowerShell-wrapper tests, no `pwsh` in the container); formatting passes; dev-safety 19/20 (the
Windows `pg_ctl` path test cannot run on Linux). Browser walk
`tracking/evidence/chat-context/walk.mjs` passes in dark, light and phone width.
Next: a separate independent review of the P03 PR.

## P03 review fixes (November 5, 2026, ADR-0070 amendment, no migration)

Fixes the PR #136 review (project file reviews/PR136_CHAT_CONTEXT_REVIEW_2026-11-05.md): M1–M3,
L1–L5, N1–N2. Short studio questions ("What's blocked?", "What needs approval?") reach their
cards again; any explicit context makes a message a model question; Automatic mentions are
narrower; broad "research how…", "remember to…" and "stuck on my essay" are no longer
swallowed; General answers leave out earlier studio-record answers and say so; an explicit
studio context the setting refuses is refused at send; the picker lists titles only and
reloads; `inspectDatabase` compares the set of applied migrations (migration 43 kept; previews
take 44). Checks: typecheck, formatting; suite 772 tests, 739 pass, 28 skip, 5 known
PowerShell fails (no `pwsh`); dev-safety 19/20 (Windows `pg_ctl` path); chat-context walk rerun.
Next: a fresh independent review.
Re-review Lows (PR #139 re-review, same day): L-A picks survive a new conversation's first
message; L-B Selected answers also leave out snapshot-made earlier answers; L-C/L-D more
blocked/approval variants, "remember that…"/"note that…"/"save me…" stay questions, "my studio
apartment" is not a mention; N-A unknown migrations are named; N-B ADR wording. Same check
counts (772/739/28 skip/5 known pwsh); walk rerun on a fresh DB.
Third review (same day): L-1 blocked/stuck keeps the general-request guard ("How do I fix a
stuck build in Jenkins?" is a question; "Are any runs blocked?" is a whole-message studio form);
L-2 "Remember that idea…"/"Remember my thought…" save again; N-1 picks made before a new
conversation's first send are cleared when another conversation is opened.
Fourth review (same day): L-A picks clear on every conversation change, including to New
conversation and after delete, except the one the first send creates; L-B only singular
"that/my idea|thought|note" saves; L-C anchored "Which runs are blocked?", "Show me what's
blocked" forms; "Note to self:" saves, a "?"-only target is dropped. All reviewed phrasings now
live in one table test, tests/src/chat-classifier-table.test.ts.
Fifth review (same day): L-1 "about"/"to self" are dropped only straight after the verb, so
"Save my idea: About Time" keeps its text; L-2 curly apostrophes read as straight ones and joined
's matches ("Everything's stuck", "Why's it blocked?"); L-3 one polite wrapper ("Can you…",
"…please", "…and why?") is removed before the whole-message studio tests; nits: thought
experiments and "Remember: I/you/we…" are not saves, a target with no letter or digit saves no
text. All new cases are in the table test.
Sixth review (same day): L-1 "Note: we should build…" and "Remember: we could…" save again
(only "Remember: I prefer/said…" stays a remark); L-2 up to two greetings or fillers ("Hey,",
"Please, can you") and "tell/show me" before a question are removed before the whole-message
tests, and "Is it stuck?" counts; nits: "Note to self:buy milk" and emoji ideas save, bare
"to"/"waiting" no longer open approvals. Cases added to the table test.
Seventh review (same day): L-1 "Show me everything that's blocked" is a studio question again;
L-2 acknowledgement and punctuation lead-ins ("Thanks! What's next?", "Got it, …", "Hi there,
…", "So... …") are removed before the whole-message tests; nits: "Remember: I'm vegan" / "my
name is…" are remarks, "Waiting for an answer" is not an approvals question, "Note to self,
buy milk" saves "buy milk". Rows added to the table test.

## P07 preview lifetime (November 5, branch `claude/project-thread-7c9lp1`)

Previews can be **Timed** (default, 1–60 min) or **Until stopped** (ADR-0069, migration 44,
schema 44): no expiry; live while a preview page heartbeats within 3 minutes; abandoned
previews end and free their slot; links expire after 10 minutes and can be renewed by the
owner; Stop/Revoke cancels in-flight runs and records cleanup. Limits unchanged. Verified
locally on disposable PostgreSQL 16 in the cloud container (see the PR for counts); the preview
page script was walked in headless Chromium against a stand-in store. Not verified: a full
studio browser walk, the installed app, real WSL runs. Awaiting independent review.

## P01 + P02 — activity links, Search reset, newest-first sorting (November 5)

Branch `claude/project-thread-pb1ge7`; no migration or ADR. Activity (tab and sidebar) and
Search open a subject through one server check (`GET …/destination`): a task opens its
workflow, an artifact its newest code version on Try, a selection its problem's scores;
missing/other-workspace subjects read the same and show a reason without a title. Reset
fields on Search/Activity/Library also clears the address words, kind filter and remembered
sort. Search and the Library have Sort by (Newest by creation by default; Search also Oldest
and Best match; Library also Recently updated and Name), applied on the server before the
limit with id tie-breaks and cursors bound to sort and filters. Pickers still use the
unchanged newest-first `entities` list (cap 500). Next eligible prompt: separate review of
this PR, then P03.

Checks (cloud container, PostgreSQL 16, Node 22.23.4): full `pnpm test:db` 772 tests,
737 pass, 28 skip, 7 fail: the 5 known PowerShell-wrapper tests (no pwsh here) plus 2
studio-service tests that collided with a dev server on 5173/4310; those 2 pass when rerun
alone with the new test file, catalog and search suites (18 pass, 2 pg_dump skips). New
`tests/src/list-sort-destinations.test.ts` covers cap+1, tied microsecond times, inserts
between pages, cursor/sort/filter binding, membership and the HTTP routes. TypeScript, web
typecheck, Prettier and whitespace pass. A Playwright walk on a throwaway studio checked
Search sort/More/Reset (address cleared, sort back to Newest after reload), Activity opening a
record, a deleted chat's explanation, and Library name sort with More records.

Review fixes (independent review of PR #138): M1, where the Name sort cursor could not carry long titles, now
continues after the last row read again by id, and a long-title page-edge test was added; L1 stale
"More" errors are tied to the result they belong to; L2 merged main; nits N2/N3 fixed (fallback
wording, malformed ids show the "can't be opened" sentence). N1: Search's date filter for records
now uses creation time, matching the time shown. Full `pnpm test:db`: 776 tests, 743 pass,
28 skip, 5 fail (the known PowerShell-wrapper tests only).

Re-review fixes: Name cursors carry a short hash of the last row's lowercased title, so a
rename between pages is refused with "start again"; hand-edited time cursors are refused as
INVALID_CONTRACT before PostgreSQL parses them. Full `pnpm test:db`: 777 tests, 744 pass,
28 skip, 5 fail (known PowerShell-wrapper tests only).

Third-review fixes: Name sort seeks from the title value it just checked (no second read), and
cursor times that are well-formed but impossible (PostgreSQL 22007/22008/22009) are refused as
INVALID_CONTRACT. Full `pnpm test:db`: 777 tests, 744 pass, 28 skip, 5 fail (known PowerShell only).

Fourth-review nit: cursor-time error mapping now applies only when a cursor was used, so a bad
Search date filter is no longer reported as a bad page cursor. Merged main (API route list keeps
main's `link` action). Full `pnpm test:db`: 777 tests, 744 pass, 28 skip, 5 fail (known
PowerShell only).

## P05 workspace files (November 5, branch `claude/project-thread-h4hwto-p05`)

Sources › Files (ADR-0072, migration 45, schema 45): upload by dropping files anywhere or with
Add files; exact originals and SHA-256 in PostgreSQL with numbered immutable versions; newest-
first list with search inside names and text; inert viewers for text, Markdown, JSON, CSV, code
and images; download of any version's original bytes; rename, link to records, delete/restore
and owner-only permanent deletion; per-file and per-workspace bounds from the environment.

Checked: `tests/src/files-api.test.ts` (real API and PostgreSQL: traversal names, retries,
duplicates, spoofed types, inline image headers, exact download, versions, search with line
numbers, size limits, links, stranger/viewer/other-workspace access, delete/restore/purge,
immutable versions), `files-inspect.test.ts`, and the restore test now round-trips a binary
file through backup and restore. Walked in headless Chromium at 1280 and 390 px: drag over the
Discover page shows the overlay, the drop uploads without leaving the page (an unsaved theme
stayed), the same file again is reported as a duplicate, the picker adds a CSV, Markdown
renders without running a `<script>` line, and the download's SHA-256 matches the source.
Not done (B01): Trash expiry, OCR, editors, conversions, PDF preview, related files, global
Search indexing, record-targeted drops. Awaiting review.

## P05 review fixes (November 5, PR #141 review, migration 45 amended before merge)

Fixes the PR #141 review (project file reviews/PR141_WORKSPACE_FILES_REVIEW_2026-11-05.md): L1
invisible and C1 characters stripped from names; L2 role checked before the body is read; L3
targeted duplicates link to their record and reused keys must name the same target; L4 upload
bodies get a size-scaled deadline while other requests keep 10 seconds; L5 tests for mid-body
cancellation, editor purge, workspace binding and retry keys in the tray (new
`web-transfers.test.ts`); L6 search returns a window from the first match's line, kept text
stays outside the quota (recorded in ADR-0072); L7 tray cleared when another person's session
starts; nits N1–N8 (N5 adds an index to migration 45, which has not merged anywhere yet).

## P05 re-review fix R-M1 (November 5)

The longer upload deadline is granted only inside the upload route, after authentication, the
role check and a declared size within the file limit; every other request on the API and web
ports keeps the 10-second body deadline, and a refusal sent while a body is still arriving
closes the connection. New `files-deadline.test.ts`: unauthenticated, over-limit and web-port
slow bodies close within 11.5 s, and a member's upload still arriving at 14 s is stored (the
test fails on the previous head).

## P04 guided start and readable Discover (November 5, branch `claude/project-thread-h4hwto`)

Discover now opens with three start choices and a Guided/Advanced switch over the same form
(ADR-0071). Guided folds routine settings under one-line summaries; a "What will happen" panel
shows run, permission, model access, effective limits, data class and output, each with its
source; a per-person, per-workspace preset (this browser) can replace the studio defaults; the
default plan connection is now one that is ready and qualified. Discover and Build share one
blocked-reasons list with buttons to the fixing tab; the empty-claims state points to Sources
instead of the CLI. No migration or API change.

Walked in headless Chromium on a disposable database (fixture workspace from `seed-research`,
budget and pricing added in the app): with only the six brief fields typed and one claim ticked,
Guided started a real discovery run and opened it under Monitor › Runs; phone width (390 px)
reads in one column. Already implemented and only inspected: Try completes when feedback is
recorded on the newest package (next-rules), meaningful run labels and newest-first defaults
(PRs #100, #101, #138). For P17: the first-run "No workspace yet" card still mentions
`pnpm cli seed-selection`; the Start-with-a-theme draft form is long; Guided does not yet
apply to Explore's own options or to Build; presets are browser-local. Awaiting review.

## P04 review fixes (November 5, PR #140 review, no migration)

Fixes the PR #140 review (project file reviews/PR140_DISCOVER_REVIEW_2026-11-05.md): L-1 a
picked model pins its connection; L-2 presets drop blank time and budget text; L-3 a failed
start opens the right fold and focuses the field, and the problem list items are buttons; L-6
"What will happen" shows a Ceilings row (plan requests used of the daily allowance, or budget
available and the overall spending ceiling left) and fold summaries name the source of every
value; L-7 merged main keeping main's ADR-0070; nits N-1 (no per-call charge text when model
calls are not pre-approved), N-2 (studio default, not connection caps, when no connection),
N-3 (the reset button and note say routine edits are reset), N-4 (setup blocker views are a
literal union, no cast), N-5 (no private class in presets). Recorded, not fixed: L-4 for P17
(Guided still needs the six brief fields and one claim; the output is a statement, not a
choice) and L-5 in ADR-0071 (Projects pages keep their own blocker text, for P17).

## P06 named notes (November 5, branch `claude/project-thread-h4hwto-p06`)

Sidebar Notes (ADR-0073, migration 46, schema 46): several private named notes per person and
workspace with a switcher, New, Rename, Archive/Restore, Write/Preview (safe Markdown) and
Export as `.md`. Existing notepads became a note named "Notes" with the same text and version;
unsaved notepad drafts in the tab carry over. Autosave and conflict recovery work per note.

Checked: `tests/src/sidebar.test.ts` (privacy across people and workspaces, versions, rename
keeps the text version, archive read-only and restore, no audit rows, member removal, invalid
names, concurrent saves, the 200-note limit under concurrent creates, migration 46 from the
layout before 46, every route with sign-in and CSRF) and `web-note-drafts.test.ts` (per-note drafts,
legacy draft hand-over, export names). Walked in headless Chromium at 1600 and 390 px: an old
notepad draft became "Notes", Preview formats Markdown and keeps `<script>` as text, Export
downloads the exact text, rename and archive work, an archived note is read-only, switching
notes right after typing saves the text, and the chosen note comes back after reload.
Not done: deleting notes, sharing, search over notes. Awaiting review.

## P06 review fixes (November 5, PR #142 review, no new migration)

Fixes the PR #142 review (project file reviews/PR142_NAMED_NOTES_REVIEW_2026-11-05.md): L-1
Archive waits for a save in flight and saves text typed during it, and a restored note brings
back text kept in the tab; L-2 the old `workspace_notes` rows are recorded in ADR-0073 as kept
until the installed app's upgrade is confirmed, then cleared by a later migration (queued);
N-1 ADR wording on old-page tabs; N-2 a legacy notepad draft is kept when the note already has
unsaved text; N-3 Export waits until the note's text has loaded; N-4 the migration test starts
"from the layout before 46" (wording fixed above).

## ADR-0076 builder path rule and refused-patch repair; P14 larger benchmark v3 frozen (November 6, branch `claude/project-thread-q1juny`, ADR-0076, no migration)

What works: the executor path dialect admits Python package files (`__init__.py`, `__main__.py`, `_x.py`) and still refuses dot, dash, `__pycache__`, device and empty segments. Builder packets carry `patch_rules` and `qa_runtime` (the QA command and the `-I` sys.path rule) as data; `builder/1` is unchanged, so both build-role qualifications stand. A submission the patch contract or scoped tool refuses changes nothing, is recorded as `refused-N.json`, and goes back to the builder as repair feedback within `max_repairs`/`max_calls`; the checkpoint names the last refusal. Set v3 (`config/repo-benchmarks/v3/`, own grader copy, `FREEZE.json` `aaf369d7…0e13`) freezes `p14-larger-ledgercheck-v3`, the v2 larger task unchanged; `scripts/p14-benchmark.mjs` takes `--set v3` and picks the set from a benchmark id.

Checks: `pnpm typecheck`, `pnpm format:check`, `pnpm test:db` 825 tests (792 pass, 28 skipped, 5 known PowerShell-wrapper failures). Live (dev studio from worktree `C:\dev\creator_agent_p14v3` = `02c7646` + the ADR-0076 executor files, no migration, `plan_roles` gpt-6-astra, $0): v3 stopped after attempt 1 (patch with `__init__.py` admitted; reviewer packet over the 24,000-character input cap). Jordan raised the cap to 60,000 (06:15 UTC) and v4 (`config/repo-benchmarks/v4/`, identical task) went **3 of 3, qualified**: each verified with 2 requests and no repair, grader 10/10 + 21/21 + structure. 7 plan requests in all. Results: `tracking/evidence/p14-benchmarks/RESULTS_V3_V4_2026-11-06.json`; doc sections 8–9.

Review fixes (PR #146 review M-1, L-1 to L-4): a refusal after a reviewed round now keeps that review as `previous_review`; scoped-tool refusals name the path; a directory, a path beneath a file and a no-op patch are refusals (repair feedback) instead of stopping the build; ADR-0076 corrected on Codex call counting. Re-review L-1: a patch with one changed path beneath another (either order) is refused too. 12 new build tests cover every refusal branch, the Codex route and the refusal reset. These changes touch only refused rounds, which the live v4 runs never hit, so the v4 result stands. Checks: see the PR.

Limits: the repair path was not exercised live. The dev studio still runs from the worktree; switch back with `.creator\studio\start-dev.ps1` once this PR is merged and the main checkout is updated. Next: a separate review thread for this PR.

## P08 automatic assessments (November 6, branch `claude/project-thread-rbtrzm`, ADR-0074, migration 47)

What works: Compare's "Assess automatically" runs an `r08_assessment` workflow and writes
system scorecards beside people's, with provenance, edit-with-reason (`edit_of`), gate limits
and stale marking (see ADR-0074). New routes: `problems/{id}/assessment-preview`,
`runs/{id}/assessments`, `workflows/{id}/assessment-packet`. Benchmark generator:
`node scripts/assessment-benchmark.mjs` after `pnpm build:code`; regenerate it whenever the
assessor prompt changes (the old manifest then stops admitting assessments).

Open: Jordan reviews `config/connections/benchmarks/assessment-synthetic-v1.json` before it
counts as frozen; plan-route assessments stay blocked until a scoring qualification on it
passes. Next free numbers after P11: migration 49, ADR-0076.

## P08 review fixes (November 6, PR #144 review, no new migration)

All PR #144 review findings fixed except N-3 (see ADR-0074 amendments and BUILD_STATUS). The
assessor prompt and the benchmark are unchanged, so a scoring qualification on
assessment-synthetic-v1 still counts. Live trial: a copy of the dev studio database,
`creator_p08_trial` on Jordan's Docker server, runs this branch from the worktree
C:\dev\creator_agent_p08 on the review ports; creator_studio itself is untouched (backup
C:\CreatorAgentBackups\creator_studio-20261105-200145-pre-p08-trial.dump). Jordan approved the
benchmark cases and adding scoring to the Claude Code connection on the trial copy only.

## P08 split assessment requests and L-6 (November 6, PR #144)

Live trial so far (trial copy only, Claude plan, $0): scoring qualification b9ad4984 passed
(dev 2/2, held-out 6/6, 8 requests); the first assessment e5aa5780 failed with
`output_cap_exceeded` (1 request), which led to splitting assessments into batches of four
option-and-rubric pairs. Next: re-run the live assessment of "CSV files need a quick quality check
before analysis" on the trial copy after pulling this commit, then re-review.

Live re-run at 7eaf45d on the trial copy: workflow ab5a4999 succeeded in 2 requests (answers
12,166 and 11,825 characters), 8 system cards, 30 of 48 ratings unknown, every option incomplete
so nothing ranked; connection at 11 of 30 daily, $0. Then re-review Low L-7 and nit N-5 fixed.
Follow-up idea, not done: option rationales cite claim labels (C5 to C8) from the drafting step
that differ from the assessment packet's numbering.

## P11 preparation: tester accounts, sample workspaces, upload cap (November 6, branch `claude/project-thread-hdk4s6`)

ADR-0075, migration 48, schema 48 (migration 47 is reserved for P08 in parallel). More than one
person can now sign in through OIDC: allow-listed tester identities each get their own actor,
an expiry and an editor or viewer role in their own synthetic sample workspace. `pnpm ops
tester-add`, `tester-list`, `tester-reset` and `tester-remove` manage them from the command
line; reset retires the old workspace and seeds a fresh one, removal disables the account and
ends its sessions, and neither deletes records. Testers are refused on Settings, plan
connections, payments, campaigns, GitHub, portfolio scheduling, operations and desktop routes,
and the stores refuse them new workspaces, membership changes, owner policy actions and the
spending ceiling. Each person may have at most `CREATOR_FILE_CONCURRENT_UPLOADS` (default 2)
uploads in flight (PR #141 review follow-up).

Checked on a disposable PostgreSQL 16 database in the cloud container: new
`tester-accounts.test.ts` (real API with a local OIDC provider: stranger refused, owner subject,
duplicate, past expiry and owner role refused, tester signs in as its own actor and lists only
its sample, editor writes and viewer cannot, owner's and other tester's workspaces, files and
notes not found, every owner-only route 403 while the owner keeps them, store-level refusals
even with an owner membership inserted directly, reset keeps the old records, expiry and
removal end live sessions, concurrent resets leave one current workspace) and a new
`files-deadline.test.ts` case (two slow uploads at the cap stay open, the third gets 429 at once,
dropping one frees its slot). The owner-only API check was confirmed to matter: with it
disabled the tester test fails. The OIDC test provider moved to `tests/src/oidc-idp.ts`, shared
with `auth-api.test.ts`. Not deployed; D1–D9 still open. Not done: committee profile (G6),
per-tester quotas (G5), tester model route (G4), local Compose rehearsal, tester guide.
Full `pnpm test:db` (PostgreSQL 16): 799 tests, 765 pass, 28 skipped, 6 failed: the five
PowerShell-wrapper tests that always fail in the container (no pwsh), and the new upload-cap
case, whose 429 worked but whose assertion read the error body wrongly; fixed and rerun with
the auth, tester, storage and deadline suites (14/14). Typecheck and format check pass.
Awaiting review.

## P11 review fixes (November 6, PR #143 review, no new migration)

Fixes the PR #143 review (project file reviews/PR143_TESTER_ACCOUNTS_REVIEW_2026-11-06.md): L-1
`addMember` refuses a tester as owner; L-2 the upload slot is held until the response closes
(new test holds the store step and gets 429 for a second upload; it fails with the old
request-close release); N-1 artifact registration checks the owner role before reading the
product store; N-2 tester sessions end no later than the account; N-3 `pnpm ops tester-extend
[--restore]`; N-4 a failed seed after `tester-add` says to run `tester-reset`. N-5 (numbering
with P08) is passed to P08. Tests added to `tester-accounts.test.ts` and
`files-deadline.test.ts`.

## P14 repo benchmarks frozen (November 6, branch `claude/project-thread-5g8cg6`, no migration or ADR)

- [Repo benchmarks](../docs/REPO_BENCHMARKS_P14_2026-11-06.md), **version 2** (v1 was replaced before any run
  after review findings M-1..M-4 and L-1..L-6): small `p14-small-wordtally-v2` (one module, 10 studio cases with 6
  held out, 8 extended) and larger `p14-larger-ledgercheck-v2` (entry point plus a 3-module package, 10 studio
  cases with 5 held out, 21 extended and a structure check) for `python-build/1`.
- The grader is frozen with the cases (`config/repo-benchmarks/grader.mjs`): it compiles every file, merges
  stderr into the compared log like studio QA, and names the freeze, grader, spec and package hashes.
  `compare-spec` binds the studio's stored spec to `spec.json`. `FREEZE.json` SHA-256 `e762e0dd…45dbcd`.
- Every listed known failure has a mutant in `tests/src/p14-benchmarks.test.ts` that the cases named for it
  catch. Cases and grader were committed (`4b4c26e`) before the reference solutions and the freeze.
- Limits found: QA runs at most 10 cases per build, only dependency-free builder tasks build, and
  `python3 -I` leaves `src/` off the import path. The plan connection allows 10 requests per run, so each
  attempt uses its own run.
- Live runs: Jordan gave a typed OK in advance. The dev studio was migrated 40 → 41 with his typed OK (backup
  `C:\CreatorAgentBackups\creator_studio-20261105-200007-pre-migration41.dump`) and is ready; builds wait for
  the v2 re-review.
- **Live results (Nov 6, 9 plan requests, $0):** small `p14-small-wordtally-v2` **3 of 3, qualified at its declared
  scale** (each 2 requests, 0 repairs, QA 10/10, reviewer clean, grader 10/10 + 8/8 under Bubblewrap). Larger
  `p14-larger-ledgercheck-v2` **0 of 3, not qualified**: every builder patch included `src/ledger/__init__.py`, which
  the executor's path rule refuses (segments must start with a-z or 0-9); the builder is never told the rule and the
  studio checkpoints instead of repairing. Evidence `tracking/evidence/p14-benchmarks/RESULTS_2026-11-06.json`.
  Next: a follow-up to state the path/`sys.path` rules to the builder (or allow `__init__.py`) and turn a refused
  patch into repair feedback, then a new larger-benchmark version.

## X10 readiness test clock fix (November 6, branch `claude/project-thread-5z9ubg`, no migration/ADR)

- From 2026-11-06 08:15 UTC the committed-register test in `tests/src/x10-readiness.test.ts` failed everywhere
  because it read the real clock and the owner-pilot window in `config/owner-pilot.json` had ended. The test now
  derives fixed times from the committed window (its midpoint, one second before the end, the end itself, one second
  after): the plan is ready up to the last second and refused with "Pilot window has already ended." from the end
  on; mutating the gate to `<` or to an early cut-off each fails the test (review L-1/L-2). Jordan's pilot dates and the
  production gate (`checkPilot`/`evaluateReadiness`, which still default to the real time) are unchanged.
- Checks (cloud container, no PostgreSQL): x10 test file 5 pass / 1 DB skip (failed 4/1 before the fix), rebased on main after #146;
  `pnpm check` 835 tests, 534 pass, 296 DB skips, 5 fail (the known no-`pwsh` wrapper tests); formatting passes.

## P15 slice 1: static web recipe (November 6, branch `claude/project-thread-ja3wd1`, ADR-0078, no migration)

- New recipe `static-web/1` ([design, limits and owner setup](../docs/STATIC_WEB_RECIPE.md)): a task whose frozen
  checks are all `browser_check` with `browser_cases` builds a plain HTML/CSS/JS site from the reviewed
  `static-site/1` template; CLI tasks keep `python-build/1`; a mix is refused. Products without the new `recipe`
  field are unchanged. The spec form edits browser cases (one typed step per line, held-out flag).
- QA: the reviewed checker `packages/executor/worker/web_recipe.py` runs inside the existing Bubblewrap + systemd
  unit with a web policy, serves `site/` on loopback inside the sandbox and drives the pinned Chrome for Testing
  headless shell 156.0.8078.47 over a pipe; steps run in an isolated world; any page error or outside request
  fails the case. The browser is an owner-run, hash-checked install (`install_browser.py`); the studio installs
  nothing.
- Preview: the site is framed from its own `w<id>-<token>.localhost` origin with a session-bound HMAC token, a
  strict CSP and per-request lease and package checks; no command runs or terminal for web previews; hosted
  studios refuse them.
- Frozen benchmark `config/web-benchmarks/p15-small-signup-v1` (10 cases, 6 held out, 9 known failures, checker
  hash in `FREEZE.json`) and `scripts/p15-web-benchmark.mjs` (verify, score, mutants).
- Checks (cloud container, Linux, PostgreSQL 16): full `pnpm test:db` 851 tests (850 in the run plus the always-on freeze test added after), 816 pass, 28 skips, 6 fail: the 5 known no-`pwsh` wrapper tests and the opt-in REAL CHECKER test, which failed only because `pnpm format` had rewritten the frozen benchmark files. The exact frozen bytes were restored (all hashes match `FREEZE.json`), `config/web-benchmarks/` is now in `.prettierignore`, an always-on test checks the freeze, and the REAL CHECKER test passes again (reference 10/10, 6/6 held out, all 9 known failures caught; about 0.8 s per case). TypeScript, web typecheck and formatting pass.
- Not done: WSL2 worker run, exported-package start outside the studio and the live role qualification (all need
  Jordan's typed OK; packet in the design doc). The web recipe is **unqualified**.

## P15 review fixes (November 6, PR #149 review, ADR-0078 amendment, no migration)

- Fixed every finding of [the review](../docs/PR149_STATIC_WEB_RECIPE_REVIEW_2026-11-06.md) (no High, M-1/M-2, L-1..L-7) before
  any live run: worker, WebSocket and WebRTC traffic and service/shared workers now fail a case; web builds are
  labelled unqualified trials (`QUALIFIED_RECIPES`, manifest `role_qualification`, build and Try pages); dialogs and
  document loads fail with named reasons; the preview drops modals, removes the frame when the preview ends, checks
  the frame token before counting a viewer and answers every refusal alike; typed steps round-trip and selectors are
  shape-checked; the benchmark script runs the bridge's own `sandbox_args` and `verify_browser`; banner says links can
  leave; L-7 recorded with a browser update plan ([design §10](../docs/STATIC_WEB_RECIPE.md)).
- Benchmark v1 replaced before any run by `p15-small-signup-v2` (checker changed; same cases, spec content and
  reference; 14 known failures incl. 5 hostile pages). Reference 10/10 (6/6 held out), all 14 caught, twice in a row.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 851 tests, 818 pass, 28 skips, 5 fail (the
  known no-`pwsh` wrapper tests); the REAL CHECKER test passes. TypeScript, web typecheck and formatting pass.
- Jordan gave a typed OK (11:28) for the WSL browser install and the 3 live builds; held until the re-review.

## P15 re-review fixes (November 6, PR #149 re-review at `aec1dc2`, ADR-0078 amendment, no migration)

- [Re-review](../docs/PR149_REREVIEW_2026-11-06.md): no High or Medium. Fixed L-8 (popups fail the case; 1 s settle after
  the last step; docs, ADR and manifest claim only "no outside request seen during the frozen cases"), L-9 (no global
  qualified switch: `unqualifiedTrial` lifts the label only for a recorded pass on the build's own connection, model and
  role-prompt hashes; none recorded), N-1 (hostile known failures pin their reason), N-2, N-3, N-4 (`PINNED_BROWSER` pin
  date, build page shows when the monthly re-check is due or overdue).
- Benchmark v2 became `p15-small-signup-v3` before any live run (popup and late-request known failures). Reference 10/10
  (6/6 held out); all 16 known failures caught, each for its own reason, in two consecutive runs.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 853 tests, 820 pass, 28 skips, 5 fail (known
  no-`pwsh` wrapper tests); REAL CHECKER passes. TypeScript, web typecheck and formatting pass.
- Browser install and live builds (Jordan's typed OK 11:28) still held until a clean review.

## P15 third-review fixes (November 6, PR #149 third review at `e9b5a68`, ADR-0078 amendment, no migration)

- [Third review](../docs/PR149_THIRD_REVIEW_2026-11-06.md): no High or Medium. Fixed L-10 (trial label hashes the
  prompts recorded in the build's `intent.json`, and only a pass on the current benchmark version in
  `RECIPE_BENCHMARKS` counts), L-11 (build page shows the newest package's own label; artifact summaries carry
  `role_qualification`), N-a, N-b (checker reports popups and unsupported workers in `unsupported`, apart from
  `outbound`), N-c (escaped backslash then a comma is refused).
- The N-b checker change made benchmark v3 `p15-small-signup-v4` before any live run. Reference 10/10 (6/6 held out);
  all 16 known failures caught, each for its own reason. `verify` passes and checks `RECIPE_BENCHMARKS`.
- Checks (cloud container, PostgreSQL 16, real browser): `pnpm test:db` 854 tests, 821 pass, 28 skips, 5 fail (known
  no-`pwsh` wrapper tests); REAL CHECKER passes. TypeScript, web typecheck and formatting pass.
- Browser install and live builds still held until a clean review.

## P15 live web qualification (November 6, Jordan's PC, no migration)

- Under Jordan's typed OKs (11:28, 20:24 UTC): pinned browser installed in WSL; dev studio `creator_studio` backed up
  (`C:\CreatorAgentBackups\creator_studio-20261106T204916Z-pre-p15.dump`), migrated 48 to 49 and run from worktree
  `C:\dev\creator_agent_p15` (`b73bd95`) via `.creator\studio\start-dev-p15.ps1`.
- `p15-small-signup-v4`: **3 of 3** on `plan_roles` (`4e4a7bec…`, `gpt-6-astra`): each verified in 2 requests, no repair,
  QA 10/10 (6/6 held out), reviewer approved, exported package 10/10. 6 requests, $0. Jordan saw the preview page in
  its frame in Chrome; WebView2 not observed. [Results](evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json).
- `RECIPE_QUALIFICATIONS` now holds that pass, so new web builds on that connection, model and prompt pair are no longer
  labelled unqualified trials. To return the dev studio to main: stop `start-dev-p15.ps1` and start
  `start-dev-main.ps1` once `C:\dev\creator_agent_main` is at schema 49 or later.

## P09 why this response and non-code proposals (November 6, branch `claude/project-thread-raqxjh`, ADR-0077, migration 49)

What works: see ADR-0077 and the BUILD_STATUS entry. New routes: `problems/{id}/explanation`, `proposals`
(list, create), `proposals/draft?alternative=`, `proposals/{id}` (`?version=`), `proposals/{id}/revisions`,
`proposals/{id}/reviews`, `proposals/{id}/export?version=` (Markdown attachment), `proposals/{id}/files`. New tab
Projects › Proposals (`#/projects/proposals`). Stores: `ProposalStore` sits between `CatalogStore` and
`StudyStore`; `SelectionStore.gather` is now protected and `toSelection` exported.

Review fixes (L-1–L-7, N-1, N-2 from the independent review at d99a7ff) are in ADR-0077's "Review fixes" bullet;
migration 49 was amended (append-only trigger, workspace FK) since it is unmerged. `ResearchStore.claimEvidenceIn`
reads one claim's evidence inside a caller's transaction. After the re-review, section text is exported inside fenced text blocks and record text is escaped (`inlineText`). Migration 49 changed in place before merge: a throwaway review or test database that ran an earlier text of it fails the checksum check; recreate it (no lasting database ran 49).

F9: Jordan confirmed "Judge the hybrid row" on November 6, as implemented. No live run or device step was needed or done. Main becomes schema 49; next free numbers
are migration 50 and ADR-0078 (P15 was asked to take those if it needs them).

## State review cleanup (November 10, branch `claude/project-thread-7r0ehf`, PR #151, no migration or ADR)

- From the [November 10 state review](https://claude.ai/artifact/7KiojJQSaz5Mf1p3DTpFcA) (no High; four Medium, eight Low).
  Rewrote the top of this file, `BUILD_STATUS.md`/`SESSION_HANDOFF.md`, `docs/CURRENT_STATUS.md`, the runbook note,
  `README.md` and `docs/LOCAL_DEVELOPMENT.md` to main `e08e0a4`, schema 49 (M4). The November 4 tops are kept.
- Web recipe record (M1): the two stale "`RECIPE_QUALIFICATIONS` is empty" lines are corrected (a dated note is appended to
  the results file; nothing removed). PR #150 review M-1 is restated as open for Jordan; the record is unchanged.
- Fixes: `CREATOR_SESSION_FILE` is no longer read as a secret file by the API and migrations (L2, with a test);
  `pnpm cli help` prints plain usage and exits 0 (L7); the Windows-only foreign-listener safety test skips elsewhere (L8);
  a failed Revoke or Stop keeps its message (#90 N-4, first point; its second point, a stale poll error, was fixed November 12); the comparison's call counts are tested (#77 L-1, `manifestCalls`);
  no bare `: ` label for a control-character source title (PR #148 N-I).
- Left open: `config/owner-pilot.json` status, the installed-app upgrade and the web record decision (Jordan); #128 N-6,
  #129 N-4, PR #150 N-1..N-3; the qualification record living in source (L1). `t17-test.log` stays (the X10 manifest lists it).
- Checks (cloud container, PostgreSQL 16): TypeScript, web typecheck and formatting pass; full suite 867 tests, 833 pass,
  29 skips, 5 fail (the known no-`pwsh` wrapper tests); standalone safety 22 tests, 19 pass, 3 skips, 0 fail. GitHub CI
  cannot run (no Actions minutes). The #90 N-4 change was not walked in a browser. Not independently reviewed yet.
- Next eligible: P10 and P16 (in progress in their own threads).

## Web recipe owner observations, attempts 2 and 3 (November 10, no migration or ADR)

- Resolves PR #150 review M-1. With Jordan's request, the dev studio was restarted on his PC from
  `C:\dev\creator_agent_p15` (`b73bd95`, `start-dev-p15.ps1`; the stopped `creator-agent-local-db-1` container was
  started; no migration). Jordan opened the private previews of attempt 2 (artifact `68654f2d`, commit `bf373f5752`,
  manifest `b49c9fec…`) and attempt 3 (`c9a519b5`, `d81a8cc8c6`, `419e6fd0…`) in Chrome; both showed the sign-up page in
  its frame. Recorded in `RESULTS_P15_V4_2026-11-06.json` (`owner_observation.later_observations`) with his four
  screenshots in `evidence/p15-benchmarks/owner-previews-2026-11-10/` and their hashes. The frozen per-attempt pass bar
  is now met for 3 of 3; `RECIPE_QUALIFICATIONS` is unchanged. Observed four days after the runs, on the same packages.
- The Try list names packages by commit, not by artifact id; the guide's "find artifact X" steps should say so (UX note).
- The dev studio is still running on Jordan's PC and holds the installed app's ports until it is stopped.

## Owner pilot recorded as finished (November 10, no migration or ADR)

- Jordan's decision in the project thread (2026-11-10 08:37 UTC): the owner pilot is finished, not extended.
  `config/owner-pilot.json` now says `status: completed` with `finished_by`, `finished_at` and
  `docs/OWNER_PILOT_LOG.md` as evidence; the log has a "Pilot finished" section stating what it holds and what it
  does not (per-run owner minutes stay unknown). This supersedes the "Owner pilot ... still says `running`" open
  item above.
- Readiness gate (`packages/orchestrator/src/readiness.ts`): a completed pilot is judged by its evidence, so its
  past window no longer refuses it; a pilot that has not finished is still refused after its window. X10 stays NOT
  READY (readiness rows still need owner inputs). `docs/X10_ACCEPTANCE.md` no longer says the pilot was not run.
- Nothing on Jordan's device or in any studio database records the pilot's status (no runtime consumer of
  `owner-pilot.json`), so no app or database step is needed.
- Checks (cloud container): typecheck and format check pass; the X10 readiness tests pass; `pnpm readiness
pilot-check` reports the gate ready with no refusals. Full suite: see the PR. Next eligible: unchanged (P10 and
  P16 in their threads; then the installed-app upgrade, P12 once a search provider is chosen).

## PR #155 review fixes (November 10, no migration or ADR)

- Independent review of PR #155: no High, M-1 and L-1..L-3, all fixed here.
- M-1 and L-1: the pilot log's finish note no longer says F2–F21 are fixed; it points to the P00 reconciliation table
  (F2 open, F5/F7/F15/F17 web/F18 partly open as of November 5, F9 addressed by P09). It now says the 3-in-a-row stop
  rule never fired, with at most 2 failures in a row counting qualifications and builds.
- L-2: `checkPilot` now requires, for a completed pilot, `finished_by`, an ISO `finished_at` that is not before the
  window starts and not in the future, repository-relative evidence paths, and evidence other than
  `config/owner-pilot.json`. Negative tests cover each.
- L-3: the "Owner pilot" open item at the top of both tracking files, runbook step 4 and the `checkPilot` doc comment
  are current. The double blank line before the previous section is removed.

## PR #156 re-review fixes (November 10, no migration or ADR)

- Re-review of PR #156: no High or Medium; L-1..L-3 and a nit, all fixed in the same PR with negative tests.
- L-1: pilot evidence paths are normalised before the "not the pilot config itself" check, so `./config/owner-pilot.json`,
  `config//owner-pilot.json` and `docs/../config/owner-pilot.json` are refused too.
- L-2: pilot evidence must be a file. Empty, blank, `.`, and folders such as `docs` are refused. `checkPilot` and
  `evaluateReadiness` now take an `isFile` check for this; readiness rows keep `exists`, since they cite evidence folders.
- L-3: times must name a real calendar date and clock time (no month 13, February 30 or hour 25), both for
  `finished_at` and for the window, so a running pilot with an impossible end date is refused.
- Nit: `finished_by` must be non-blank text.
- Final review Low (at 1b79084): the "not the pilot config itself" check is now case-insensitive, so
  `Config/Owner-Pilot.json` (the same file on Windows) is refused; test added. Checks (cloud container, PostgreSQL 16):
  typecheck and format check pass; `pnpm test:db` 867 tests, 833 pass, 29 skipped, 5 fail (the known no-`pwsh`
  wrapper tests), the same counts as main.

## P16 runbook export (November 10, branch `claude/project-thread-tq4rcm`, PR #152, ADR-0080, no migration)

What works: see ADR-0080, [docs/RUNBOOK_EXPORT.md](../docs/RUNBOOK_EXPORT.md) and the BUILD_STATUS entry. New routes:
`specs/{id}/runbook` and `proposals/{id}/runbook` (`GET` manifest, `?format=zip` archive, `?version=`; `POST` saves to
Files). New files: `packages/contracts/src/runbook.ts`, `packages/domain/src/runbook.ts` (builder, redaction,
`validateRunbook`, `writeZip`/`readZip`), `packages/domain/src/runbook-fixture.ts` (synthetic project),
`packages/db/src/runbook-store.ts`, `apps/web/src/runbook.tsx`, `scripts/p16-runbook-example.mjs`. `RunbookStore`
sits between `ProposalStore` and `StudyStore`; `ProposalStore.problemClaims` is now protected and `toFreeze` and
`contentOf` are exported from the selection store. The test harness builds a `RunbookStore`.

Changing any bundle wording changes the committed example: run `node scripts/p16-runbook-example.mjs write` after
`pnpm build:code`, or the pin test fails.

Open: the independent-consumption gate (give a fresh session only
`tracking/evidence/runbook-export/synthetic-bundle/`, have it follow the prompts in a clean workspace, then the owner
side runs the two held-out cases from `RUNBOOK_FIXTURE_SPEC`). No live run or device step was needed or done. Schema
stays 49; this change used ADR-0080 and no migration number. Next eligible prompts: P10 (in progress in its own
thread), then P12 (needs the search provider choice), P13, P17.

## P16 follow-up: clean-room findings fixed (November 10, PR #152)

The independent-consumption gate ran in a separate session and passed both held-out cases; its record is
`tracking/evidence/runbook-export/clean-room-2026-11-10.md`. Its seven findings (2 Medium, 5 Low) are fixed in
`packages/domain/src/runbook.ts` (contract rules 6, 9 and 10, setup prompt, task gates for judged checks, reviewer
task wording, review and hand-over prompts, runner `-B`) and the example bundle was regenerated. The new wording has
not been consumed in a second clean-room run. Next eligible prompts are unchanged.

## P16 follow-up: code review fixes (November 10, PR #152)

All 10 findings of the independent review (2 Medium, 8 Low) are fixed; see the BUILD_STATUS entry of the same name.
`ActionRunbookInput.proposal` now takes `checks`, `problem_title` and `option_title` instead of pre-rendered
Markdown; `RunbookHumility` carries the ethics status, dissent and the result of `humilityGate`. Next eligible
prompts unchanged.

## P16 follow-up: re-review and final review fixes (November 10, PR #152)

The independent-consumption gate is no longer open: it ran twice (the second run not blind) and passed both
held-out cases each time; the N1 to N3 wording fixes from the second run are in `ff29f25`. The re-review's R-1, R-2
and two nits are in `24a1555`. The final review's P-1 (the account-name rule continues only into more path, any case
of letters), P-2 (Windows profile paths in any letter case) and nits N-1 (`needs_judgment` carried from
`humilityGate`), N-2 (this entry) and N-3 (README wording when held-out and manual checks are mixed) are in the next
commit. The last wording has not been consumed in a clean-room run. Next eligible prompts unchanged.

## P10 routine approvals (November 10, branch `claude/project-thread-q4lf7q`, PR #153, ADR-0079, migration 50)

What works and what was checked: see ADR-0079 and the BUILD_STATUS entry. New in code: `routine_policy` on
`POST runs`; routes `routine-policies` (list), `routine-policies/{id}/revisions`, `routine-policies/{id}/revoke`;
contracts in `packages/contracts/src/oversight.ts` (`RoutinePolicy*`, `routinePolicySummary`); the policy path in
`evaluateAction` (`routine` input); store methods in `OversightStore` (`reviseRoutinePolicy`, `revokeRoutinePolicy`,
`listRoutinePolicies`); web `apps/web/src/routine-policy.tsx`, used by the Discover form and Monitor › Approvals.

Owner decision (Jordan, November 10): routine approvals can be changed mid run. `POST runs/{id}/routine-policy`
(`setRoutinePolicy`) turns them on for a run that is already going or whose policy was revoked; migration 50 was
changed in place before merge (one active policy per run instead of one policy per run), so a throwaway database
that ran the earlier text fails the checksum check and must be recreated (no lasting database ran 50). Choices the
owner has not yet confirmed: the stop conditions are a rejection in the run and an unknown paid outcome; the end
time is at most 90 days, as for grants.

For P12: add an action type for claim admission and a routine stage for it before any unattended claim admission.
Do not run prettier on `tracking/` or `context/`; the repository's format script does not cover them.

Main becomes schema 50 when this merges. Next free numbers: migration 51 and ADR-0081 (P16, PR #152, took
ADR-0080). Next eligible prompts: P12 (needs the search provider choice) and P13.

P10 review fixes (November 10, same PR): see the BUILD_STATUS entry "P10 review fixes". New code: `packages/db/src/
routine-stops.ts` (`routineStopReason`), `routineMissNote` in `packages/domain/src/oversight.ts`, version change
`reconfirmed`, `runDataClasses` on `RoutinePolicies`. Migration 50 was edited in place a second time (the `change`
check gained `reconfirmed`); recreate any throwaway database that ran an earlier text. Not built: domain and output
scope in a policy; claim admission (P12).

## Search route investigation and live test — November 10, 2026

Report: [docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md](../docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md);
evidence: `tracking/evidence/search-route-test-2026-11-10/`. Verdict: a separate search API is not
necessary now; evidence is still insufficient for unattended runs. Before the test no route had run
a live search: Brave is off and limited to 1-5 domains, the OpenAI plan route sends no tools, the
Codex builder has web_search disabled (keep it so), and the studio's Claude Code route runs with no
tools. Official docs say web search is supported on the Sign in with ChatGPT plan route. The earlier
[comparison report](../docs/SEARCH_API_COMPARISON_2026-11-10.md) did not assess that route; its
Tavily-first pick conflicts with the accepted October 20 "native plan search first" planning, and
its "next prompt U02" line is stale.

Jordan-approved smoke test: 3 runs of the unmodified Claude Code CLI (studio sign-in, Max plan,
WebSearch only, cap 3 calls per run) produced 9 searches and 30 candidate URLs, all present in the
search output. Each run took 63-68 s at $0 incremental spend. Two earlier attempts failed on a
stale `.oauth_refresh.lock` left by `claude auth status`; both are preserved. Then 15 fetches went
through the studio's fetch adapter, per-hop policy and extractor, outside the studio DB: 5 usable
pages; 5 HTTP 403; 3 reCAPTCHA challenge pages stored as "fetched" (F2); 2 PDFs refused or over the
limit. Stored-text quote checks passed 5/5. Fetching, not finding, is the bottleneck. The studio
routes, configuration, grants and migrations are unchanged; no ADR is adopted. Next: Jordan chooses
whether to start P12 work on challenge/low-text detection and the PDF scope, or to authorise the
small code change that tests plan-route search.

## Revision notes check and plan update (November 10, documentation only)

Checked Jordan's 25 current revision notes against main `cb12eeb`: 12 done, 7 partial, 6 not done. The status table
and five new packages (P18 collapsible options, P19 Standard/Advanced app-wide, P20 chat-guided process, P21 quick
model switch, P22 live API and GitHub checks) were added to the November 5 plan and its prompt runbook rather than a
new plan. No application code, migration, ADR, configuration, grant or live call changed; no tests were needed or run.

## ChatGPT plan route search test — November 10, 2026

Jordan asked for it at 22:19 UTC and approved the dev-connection change at 22:42 UTC. PR #157
(merged) added an opt-in `web_search` option to the plan request (`plan-responses.ts`,
`plan-service.ts`, tests `plan-web-search.test.ts`); no route, UI or workflow uses it. The test ran
through `PlanConnectionService.invoke` on the dev database only (Plus connection `4e4a7bec…`,
gpt-6-astra, purpose chat, cap 3 calls). It was refused once at admission because chat needs
`private_approved`; with Jordan's OK that data class was added for the test, then removed. The
settings are byte-identical again and chat is off (connection version 16 to 21, caps re-accepted
22:44:10Z). Results: 4 search calls, 24 candidates, all in the reported sources, 17-27 s each, $0
incremental. 0 URLs overlap with the Claude Code run. Guarded fetch: 2/15 usable (PDFs, 403s,
Reddit empty shells). Fetching remains the bottleneck; no search API is justified by these
results. See [section 13](../docs/SEARCH_ROUTE_INVESTIGATION_2026-11-10.md) and
`tracking/evidence/search-route-test-2026-11-10/plan-route/`. No ADR or migration.

## P21 current-model switch (November 10, 2026, ADR-0081, migration 51)

Branch `claude/project-thread-6af37w`. The owner picks a current model beside the usage indicator; forms
start from it and say so when it is not qualified for their task (offering a qualified one); a saved chat
setting follows the switch; started work keeps its route. Details, evidence and limits: BUILD_STATUS.md
"P21 current-model switch" and ADR-0081. Migration 51 and ADR-0081 were reserved with the parallel P18 and
P22 threads (they were told to take 52/0082 and 53/0083 if they need numbers). Next free after this PR:
migration 52, ADR-0082 (recheck main). Next eligible: independent review of this PR in a separate thread;
then P19 per the November 10 order.

## P16 runbook wording follow-up — November 11, 2026

Jordan approved a follow-up PR for the eight Low wording gaps (R1–R8) the separate prompt 05 reviewer found in
the synthetic bundle ([report](evidence/runbook-export/clean-room-2026-11-10.md), third run). Exporter template
changes in `packages/domain/src/runbook.ts`: REQUIREMENTS.md says exact cases govern over a check's general measure
(R1); contract rule 9 settles readings where neither choice refuses or refusing has no defined exit code (R5); rule
10 lets only the review-and-repair step correct an ASSUMPTIONS.md line (R2); prompt 05 keeps past task reviews as
written (R3) and states what Part 1 may change and the commit order (R4); STACK.md says the notes under a proposed
stack are binding on that stack (R7). Fixture spec changes in `runbook-fixture.ts` (R1 A1 measure, R6 README
mitigation, R8 A3 measure). Bundle regenerated; `node scripts/p16-runbook-example.mjs` verifies
it. New assertions in `tests/src/runbook-domain.test.ts`. No ADR or migration. Not re-consumed in a clean room.

Review fixes (PR #163 review; report in the project files at `reviews/P16_PR163_REVIEW_2026-11-11.md`): the "cases
govern" line appears only when a check has visible cases (L1); the STACK.md sentence now covers what a note requires,
not every suggestion, and the static-web server note says it is only a way to try the page (L2); prompt 05 Part 1 may
add an ASSUMPTIONS.md line as the contract allows (L3); prompt 05 no longer names `review/` (N1); the commit order
reads right with no findings (N2); the synthetic spec is now version 3 with a new placeholder hash, since its text
changed (N3). Re-review fixes (report `reviews/P16_PR163_REREVIEW_2026-11-11.md`): prompt 05 commits a Part 1
ASSUMPTIONS.md line with REVIEW.md (L-A) and commits the final REVIEW.md marks whenever there are findings, fixed or
not (L-B); "other cases exist that you cannot see" appears only when cases are held out (L-C); the "cases govern"
line also appears when every case is held out (N-A). Bundle hash now `8648d257…`.

## P19 Standard and Advanced (November 11, branch `claude/project-thread-xdq8er`, ADR-0082, migration 52)

What works and what was checked: see ADR-0082 and the BUILD_STATUS entry.

New code:

- Contracts in `packages/contracts/src/preferences.ts`.
- Migration 52 `person_preferences`.
- `ConnectionStore.viewPreference` and `setViewPreference`.
- Route `/api/me/view-mode`.
- Web:
  - `view-mode.tsx` and `view-mode-rules.ts` (the context, the switch and the mode resolution).
  - `routine.tsx` (the `Routine` fold and `WhatWillHappen`).
  - `first-run.tsx` and `first-run-rules.ts`.
  - `shownSections` and `hiddenTabs` in `pages.ts`.

For P20:

- Read the mode with `useViewMode()`.
- Put new routine fields inside `Routine` and add a row to the form's `WhatWillHappen`.
- Keep every default out of evidence, grants, qualifications, caps and the private data class.

Overlap with open PRs:

- `build.tsx`, `submit.tsx` and `main.tsx` overlap P21 (PR #161) and P18 (PR #162). Expect small conflicts.
- Conflicts are also likely in the tracking logs.

Main becomes schema 52 when this merges, after P21's 51. Next free numbers: migration 53 and ADR-0083.
Next eligible prompts: P20, then P12 and P13 as the plan orders them.

## P20 whole process from Chat (November 11, branch `claude/project-thread-b20hlm`, ADR-0083, migration 53)

Built on P19's branch (PR #164, head `c24bd27`) because it reuses `useViewMode`, `Routine` and `WhatWillHappen`;
merge main into it once #164 merges.

- Chat holds **action cards** (`chat_actions`, migration 53): budget, fetch a page, record a claim, start a
  discovery, answer a waiting decision, score an option, record a choice, save a proposal. A card asks the form's
  questions one at a time (Standard uses P19 routine defaults, Advanced asks them), shows "Still needed", the answers
  with Change, "What will happen" and exactly the requests Send makes. Send runs those requests from the browser
  through the forms' own routes, each carrying `X-Causation-Id` (the `chat.action_sent` event) and
  `X-Correlation-Id` (the card). The store decides done / unconfirmed / refused / partial from the audit events that
  name the send. A changed, archived or missing subject record (or a decision no longer waiting) makes a card stale
  before anything is sent.
- Cards come from "Do it here" on studio replies (`cardForStep`, the Path's own rules), "Do a step here" under the
  conversation, and model answers: an answer may end with one `<propose_action kind="…">{"text","url"}</propose_action>`
  (CHAT_INSTRUCTIONS v3); a valid one becomes an origin `model` draft under the answer, anything else makes no card
  and the answer says why. A model can never suggest answering a decision.
- Files: `packages/contracts/src/chat-actions.ts`, `packages/db/src/chat-action-store.ts`, store methods in
  `connection-store.ts`, route in `apps/api/src/index.ts`, `apps/web/src/chat-cards.ts` (pure rules and plans),
  `chat-card-load.ts` (reads), `chat-card.tsx` (UI and sending), `chat.tsx`, `chat-answers.tsx`, `oversight.tsx`
  (`api()` `trace` option).
- Tests: `tests/src/chat-actions.test.ts` (HTTP and store), `tests/src/web-chat-cards.test.ts` (plans checked
  against the server request schemas), one new case in `chat-answers.test.ts` (model suggestion). Walk evidence in
  `tracking/evidence/p20-chat-actions/`.
- Not done: spec freeze, build and runbook export cards; editing an earlier selection; other rubrics; mid-send resume
  on another device.

Next eligible prompt: independent review of P20 in a new thread (reviewer ports 5183/4330/4340, throwaway DB); then
the installed app upgrade, then P17.

## P22 live connection checks (November 10, 2026, no migration, no ADR)

Jordan's typed OK (November 10, 22:40 UTC) covers live API and GitHub tests. Added: a "Test
connection" for the metered OpenAI API key route on Models and connections (one bounded request
under its own run, grant and $0.05 run budget; closed, revoked and cancelled afterwards;
`apps/web/src/api-key-check.ts`, `api-key-check-panel.tsx`), `live_model_id` on
`GET /api/broker/status`, and a read-only GitHub pull-request checks read
(`GET …/github-repositories/{id}/checks?pr=<n>`, `pnpm cli github-checks`, a form per repository).
Owner steps: [docs/LIVE_CONNECTION_CHECKS.md](../docs/LIVE_CONNECTION_CHECKS.md). GitHub credential
(Jordan's choice): a fine-grained token limited to one owner-created private repository
`creator-agent-p22-trial`; a later trial with a repository-creating token is recorded as a follow-up.
Local checks: new loopback API test `tests/src/api-key-check-api.test.ts`, unit tests
`tests/src/web-api-key-check.test.ts`, GitHub fixture assertions in `tests/src/github.test.ts`.
Live results (tracking/INTEGRATIONS.md, "P22 live connection checks"): API key route connected
(`gpt-6-astra`, $0.00036, November 10 23:16 UTC); GitHub scoped trial succeeded (verify, branch, two
pushes, PR #1 in `creator-agent-p22-trial`, checks read); ChatGPT and Claude Code availability rechecks
passed at $0 (November 11). The dev studio now runs from `C:\dev\creator_agent_p22`
(`.creator\studio\start-dev-p22.ps1`); `creator_studio` was backed up and migrated 49 → 50.
Review of PR #160 (1 Medium, 6 Lows) fixed in the same PR: refused GitHub reads are reported as
refusals (M-1); the panel says "outcome unknown, reconcile" when no answer arrives, archives a run
record whose registration failed, and its clean-up is tested end to end through `runCheck` (L-3–L-5);
Models and connections shows each model's last availability recheck (L-6). Re-review Lows fixed: the
checks read's repository lookup keeps GitHub's real status, and a rate-limit 403 says "try again", not
"token expired". Owner clean-up: Jordan revoked the "P22 trial" connection on November 11 (01:43 UTC)
and reported the token deleted; the trial repository is his to keep or delete. Nits fixed at Jordan's
request (November 11): a secondary rate limit without `retry-after` is recognised by GitHub's message, a
read with no answer is worded as the studio's own error rather than "GitHub said", and `checksSummary`
(now in `apps/web/src/github-checks.ts`) has unit tests (`tests/src/web-github-checks.test.ts`).
Fourth re-review nits (GitHub App path, not used live): a GitHub App token the studio cannot create
locally (e.g. an unusable private key) says to check the App credential, not "try again", and a token
GitHub refuses (e.g. 422, repository removed from the installation) says so instead of "did not answer".
Fifth re-review: a 404 from the App token step is a refusal, not "no such pull request" (L-1); a 401 there
points at the App id or private key; a 5xx or a 201 without a token names the token step.

## P18 collapsible options (November 10, branch `claude/project-thread-d4dxg5`, no migration or ADR)

See the BUILD_STATUS entry "P18 collapsible options and shorter pages". Shared pieces for later pages (P19, P17):
`Fold`, `FoldAll` and `useFolds` in `apps/web/src/fold.tsx`, rules in `fold-state.ts` (tested in
`tests/src/web-folds.test.ts`). Rule for any new fold: the reason an action is blocked goes in the summary or
outside the fold, never only inside it; open by default only what needs the person (`firstNeeding`), and mark an
item open once the person edits it so it does not close under them. Walk scripts:
`tracking/evidence/p18-folds/walk.cjs` and `heights.mjs` (set `WALK_CODE` to the throwaway API's
`CREATOR_DEV_LOGIN_CODE`; web on 5183). P18 takes no migration or ADR number; P21 (parallel thread) takes migration 51 and
ADR-0081, so check main before allocating. Next eligible prompt after review: P19 (Standard and Advanced across
the app), which can fold Decide's remaining long sections.

Review rounds on PR #162 (November 10–11; reports in the project's `reviews/P18_PR162_*`): first review 7 Lows,
then re-reviews 1–4 (R-1..R-4, R2-1/R3-1/R3-2/N-1, R4-1/N-2, R5-1/N-3), all fixed; re-review 5 was review-clean
with nits N-4/N-5 (fixed at `029f684`); re-review 6 was review-clean with nit N-6 (this paragraph, fixed) and N-7
(P19/P22 table rows, left to their own threads). Details in BUILD_STATUS under the P18 entry. Things a later thread should know:

- `kindAllows(kind, disposition)` in `packages/contracts/src/selection.ts` is the one rule for which dispositions an
  option's kind can ever take. The domain's kind blocks use it; Decide's summaries leave those choices out.
- Proposal section choices are held by the Proposals page and belong to one proposal or the unsaved draft
  (`choicesFor` ref in `proposals.tsx`); `useFolds(attention, held)` takes parent-held choices.
- Approvals opens a linked decision on focus change and on every return to the page (`useOnShow`).
- `walk-proposal-choices.cjs` needs a fresh `seed-selection` workspace (`WALK_WS`); it records one selection and
  approves it through the API on the throwaway database.
- Still not done: Decide's problem statement, automatic assessment, scoring form and "Why this response" are not
  folded (page about 4 screens); left to P19/P17. CI did not run (no Actions minutes).

## P19 Standard and Advanced (November 11, branch `claude/project-thread-xdq8er`, ADR-0082, migration 52)

What works and what was checked: see ADR-0082 and the BUILD_STATUS entry.

New code:

- Contracts in `packages/contracts/src/preferences.ts`.
- Migration 52 `person_preferences`.
- `ConnectionStore.viewPreference` and `setViewPreference`.
- Route `/api/me/view-mode`.
- Web:
  - `view-mode.tsx` and `view-mode-rules.ts` (the context, the switch and the mode resolution).
  - `routine.tsx` (the `Routine` fold and `WhatWillHappen`).
  - `first-run.tsx` and `first-run-rules.ts`.
  - `shownSections` and `hiddenTabs` in `pages.ts`.

For P20:

- Read the mode with `useViewMode()`.
- Put new routine fields inside `Routine` and add a row to the form's `WhatWillHappen`.
- Keep every default out of evidence, grants, qualifications, caps and the private data class.

Overlap with open PRs:

- `build.tsx`, `submit.tsx` and `main.tsx` overlap P21 (PR #161) and P18 (PR #162). Expect small conflicts.
- Conflicts are also likely in the tracking logs.

Main becomes schema 52 when this merges, after P21's 51. Next free numbers: migration 53 and ADR-0083.
Next eligible prompts: P20, then P12 and P13 as the plan orders them.

## P19 follow-up: Decide and Proposals in Standard (November 11, branch `claude/project-thread-qc6o5z`)

Standard now folds the Decide form's run choice (and an override reason only when empty and not needed) and the
Proposals form's six non-core optional sections, revision "What changed" and review marks; both forms gained "What
will happen". Contrary evidence, assumptions and required sections never fold. Rules in `apps/web/src/decide-routine.ts`,
tests in `tests/src/web-decide-routine.test.ts`, walk in `tracking/evidence/p19-decide-proposals/` (run it with
`LOGIN_CODE=<dev login code> node walk.cjs` against dev servers on 5183/4330/4340 and a `cli seed-selection`
workspace). No migration or ADR; next free numbers stay migration 54 and ADR-0084. Review fixes (M-1 override field stays in one place, L-1 review marks open, N-1..N-4) are in
the same PR, with `walk-override.cjs`. Re-review fixes (L-A Expand all with a
blocked folded section, N-A walk selector) followed. Next: re-review, then the installed app upgrade and P17.
