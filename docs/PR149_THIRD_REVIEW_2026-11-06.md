# PR #149 (P15 static-web/1): third review

- PR: jordanprice040/CreatorAI #149, branch `claude/project-thread-ja3wd1`
- Reviewed at `e9b5a68` (code changes in `df24fa6`; `e9b5a68` only edits a tracking line). Diff read: `aec1dc2..e9b5a68`.
- Reviewer: Claude, a fresh thread. **Involvement: none.** I did not build this PR or any of its fix rounds, and I did not
  write either earlier review.
- Date: 2026-11-06. Nothing was pushed, no live build, install or model call was made, and the installed app, OneDrive
  checkouts and `.codex/config.toml` were not touched.

## Verdict

**No High or Medium findings.** L-8, L-9 and N-1 to N-4 are fixed. I found two new **Lows** (L-10, L-11), both in the
new L-9 code and both latent today because no recipe qualification is recorded yet, plus three nits.

## Checks I ran (cloud container, Linux, as uid 1000 where the browser needs it)

- Pinned Chrome for Testing headless shell 156.0.8078.47 downloaded from the pinned URL; zip SHA-256 matches
  `install_browser.py` (`0d5acc62…`), and `bridge.verify_browser` accepts the tree. `bwrap` 0.9.0 from apt.
- `node scripts/p15-web-benchmark.mjs verify`: ok, no problems.
- `score p15-small-signup-v3 …/reference`: **10/10, held out 6/6**; checker SHA-256 `29f89d04…` equals `FREEZE.json`.
  Only sandbox deviation is the known `/etc/alternatives` bind.
- `mutants p15-small-signup-v3`: **16/16 caught**, each hostile one with its own reason (popup → "the page opened a
  popup window…", late-request → "request outside the site", dialog, another document, and so on).
- `pnpm typecheck` and `pnpm format:check`: pass.
- Full suite without a database (`node --test tests/dist/*.test.js`): 849 tests, 547 pass, 297 skipped (database
  tests; no PostgreSQL here), **5 fail = the known no-`pwsh` wrapper tests**. I did not run `test:db`.
- `tests/dist/web-recipe.test.js` as uid 1000 with `CREATOR_TEST_BROWSER_DIR`: the new L-9 and N-4 tests, the
  freeze test and the **REAL CHECKER** test pass. (Three other tests in that file failed only because uid 1000 cannot
  write to the root-owned checkout; they pass in the root suite run above.)

### Extra probe pages (A1.1, injected at the top of the reference `app.js`)

| Probe | Result |
| --- | --- |
| control (unchanged reference) | pass |
| `window.open(url,'_blank','noopener')` | fail: popup window |
| `window.open(url,'_blank','noreferrer')` | fail: popup window |
| script-clicked `<a target=_blank>` | fail: popup window |
| script-submitted `<form target=_blank>` | fail: popup window |
| `window.open('')` then `w.location = …` (the old L-8 case) | fail: popup window |
| `window.open` 700 ms after first input | fail: popup window |
| fetch 900 ms after the last click | fail: request outside the site |
| `new Image().src` outside | fail: request outside the site |
| `<meta http-equiv=refresh>` to outside | fail: another document |
| legit dedicated worker with no outside request | **pass** (no false positive from the opener check) |
| fetch 1500 ms after first input | pass (outside the 1 s settle; this is the documented limit) |

The noopener probes matter: Chrome still reports `openerId` on the new target for `noopener`/`noreferrer`, so the
opener check catches them. The last row is the expected, now-documented gap.

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| L-8 popups and late requests; doc overclaim | **Fixed** | `Target.targetCreated` with `openerId` fails the case (`web_recipe.py`); 1 s `SETTLE_SECONDS` loop after the last step. Probes above. `STATIC_WEB_RECIPE.md` §4, ADR amendment, the capability matrix and a new manifest limitation now say only that no outside request was seen during the frozen cases (plus the settle). The builder's `qa_runtime` notes mention popups and the settle second. Benchmark v3 adds popup and late-request known failures. |
| L-9 global `QUALIFIED_RECIPES` | **Fixed** (see L-10, L-11) | Constant removed. `unqualifiedTrial(recipe, roles, qualifications)` lifts the label only when a record matches recipe, connection, model and both role-prompt hashes; a build with no `plan_roles` stays a trial. `RECIPE_QUALIFICATIONS` is empty. Unit test covers every mismatching field. |
| N-1 mutants don't pin reasons | **Fixed** | `reason_contains` on all 7 hostile known failures; `mutants()` requires it on a named case. |
| N-2 selector wording / escaped trailing char | **Fixed** (nit N-c below) | Doc wording corrected; lookbehind accepts `.a\,`; test added. |
| N-3 stale ADR bullets | **Fixed** | Both bullets carry "(amended below: …)". |
| N-4 no browser re-check reminder | **Fixed** | `PINNED_BROWSER` with `pinned_on`, `BROWSER_PINNED_ON` in `bridge.py`, a test checks both equal, and the build page shows the due date or "overdue". |

## New findings

### Low

**L-10. The recipe-qualification match uses the role prompts in the code at packaging time, and ignores which
benchmark version passed.**

- `packages/executor/src/artifacts.ts` computes `builder_prompt_sha256: digest(BUILD_ROLE_PROMPTS.builder)` (and the
  reviewer's) when the package is made. Packaging is a separate step that reads the build's `intent.json`, which
  already records the prompts the build actually used (`prompts`, `prompt_hash`, written in `build.ts`). The same
  manifest records `intent.prompt_hash`.
- So a build made with old prompts and packaged after a studio upgrade would be matched against the new prompts. If a
  recorded pass exists for the new prompts, an old-prompt build loses its trial label: the M-2/L-9 gap again, in a
  narrow window.
- `unqualifiedTrial` also never looks at `benchmark_id`. A benchmark version is replaced precisely when the checker
  changes (v1 → v2 → v3 here), so a pass recorded against an older version would keep qualifying builds after the
  checker changed.
- Latent today (`RECIPE_QUALIFICATIONS` is empty).
- Fix: hash `intent.prompts.builder` and `intent.prompts.reviewer` (or treat the build as a trial when
  `digest(JSON.stringify(BUILD_ROLE_PROMPTS)) !== intent.prompt_hash`), and match only records whose `benchmark_id` is
  the current one for that recipe (for example `BENCHMARKS` in the benchmark script, moved into contracts). Add a test
  for each.

**L-11. The build page's trial notice is hard-coded, not read from the build's manifest.**

- `apps/web/src/build.tsx` now shows, for every `static-web/1` product, "Static web builds are unqualified trials unless
  … None has yet." That last sentence is a fixed string. Whether any build is qualified lives in
  `RECIPE_QUALIFICATIONS` in the executor, and nothing ties the two together.
- Before this round the card's notice followed the same rule as the manifest. Now, once the first pass is recorded,
  the build page will keep saying "None has yet" next to products whose manifests are qualified. The gallery
  (`gallery.tsx`) does read `m.toolchain.role_qualification` and stays correct.
- Latent today, but it is a claim not derived from data (invariant 1).
- Fix: drop "None has yet" and show the trial wording from the newest build's manifest (as the gallery does), or
  export the qualification list from contracts and derive the sentence from it, with a test.

### Nits

- **N-a.** In `artifacts.ts`, `const RECIPE_QUALIFICATIONS` sits between two `import` blocks. It works (imports are
  hoisted) but reads oddly; move it below the imports. When a record is added, consider whether a code constant (a
  release per qualification, with studio-specific connection ids) is the right store versus the existing
  qualification records in the database.
- **N-b.** Popup and service/shared-worker entries are appended to `result.outbound` as "a popup window (not supported
  by static-web/1)". The case reason is right, but the field is named for outside requests; a separate `unsupported`
  list would read more clearly in QA evidence. Also, `k.split(' http')` only strips http(s) URLs from the reason, so a
  popup to `about:blank` keeps its URL in the reason text (cosmetic).
- **N-c.** The N-2 lookbehind treats any trailing combinator after a backslash as escaped, so `.a\\,` (an escaped
  backslash, then a real dangling comma) is accepted. The browser would then throw on the selector and the step would
  fail at QA rather than before freeze. Rare; counting the run of backslashes would fix it.

## Checked and fine

- Popup check doesn't fire for the checker's own page or for dedicated workers (control and legit-worker probes pass).
- The settle loop keeps pumping events (`Runtime.evaluate` every 0.1 s), and a failed step still gets the settle, so
  late events after a failure are recorded too. Adds about 1 s per case (each case about 1.9 s here).
- A build with no `plan_roles` (broker or Codex route) always stays a trial. Python builds never get the label, as
  before.
- `browserRecheckDue()` uses UTC on both sides; the test pins `2026-12-06`.
- Benchmark v2 directory was renamed to v3 (still in git history); FREEZE binds the new expectations, spec and checker.
  `.prettierignore` covers `config/web-benchmarks/`; formatting passes.
- Tracking (`BUILD_STATUS.md`, `SESSION_HANDOFF.md`, `DECISIONS.md`) matches the code.

## Recommendation

Mergeable from a High/Medium standpoint. L-10 and L-11 are small and should be fixed before the first
`RECIPE_QUALIFICATIONS` record is added (that is, before the live web benchmark result is recorded), since that is
when both become real. The browser install and live qualification can follow once Jordan is satisfied with that.
