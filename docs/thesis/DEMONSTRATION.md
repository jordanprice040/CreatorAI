# Defense outline and reproducible demonstration

Every screen/output in this script is **VERIFICATION FIXTURE: synthetic data, not empirical**. The static backup is a fixture walkthrough, not a recording of a live participant study.

## Suggested 12-minute defense narrative

1. Minutes 0–2: State the problem and RQ1–RQ3. Say: “The software instrument is implemented; the comparative study is proposed and unfrozen. Empirical results are unavailable.”
2. Minutes 2–4: Explain client → API/domain admission → durable PostgreSQL workflow → broker → isolated worker → exact artifact → catalog. Authority and money are application-owned. Temporal was replaced by accepted ADR-0008.
3. Minutes 4–7: Run the offline analysis below. Open mixed/output/report.md and its resource figure; show missing ratings and unknown exposure. Open zero-accepted/output/report.md; show undefined cost per accepted outcome. Open all-blocked/output/report.md; show scheduled slots retained without invented ratings. These are synthetic arithmetic and data-integrity checks.
4. Minutes 7–9: Open evidence/source/tracking/evidence/t13/cli-acceptance.json. Point to fixture flag, exact commit/archive hashes, feedback revision and refused boundary actions. This is historical executed software evidence, not a fresh worker run. Explain non-code success using the existing-tool/process-change/defer dispositions; do not imply a deployed product validated a real opportunity.
5. Minutes 9–11: Explain proposed A/B/C conditions and separate discovery pair; display unavailable-results table. A scripted human entry is not a participant. A test double is not isolation evidence.
6. Minute 11–12: Show committee checklist, unresolved dates and the decision about academic sufficiency. Do not announce an unconfirmed defense appointment.

## Offline reproducibility setup

Use a separate source directory so existing work is preserved. Requires Git, tar, Node 22.21+ within the package engine range (or supported Node 24), Corepack and cached dependencies or package-registry access. PowerShell from the repository root:

```powershell
$demoSource = Join-Path $PWD '.verification/t18-reproduce'
New-Item -ItemType Directory -Path $demoSource -ErrorAction Stop | Out-Null
git archive --format=tar --output=.verification/t18-reproduce.tar 3e9026f
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
tar -xf .verification/t18-reproduce.tar -C $demoSource
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
Push-Location $demoSource
try {
  corepack pnpm install --frozen-lockfile --offline
  if ($LASTEXITCODE -ne 0) { throw 'Dependency setup failed; inspect cache/access' }
  corepack pnpm build:code
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  node --test tests/dist/analysis.test.js
  if ($LASTEXITCODE -ne 0) { throw 'Analysis tests failed' }
  node packages/orchestrator/dist/analyze-main.js fixtures ./demo-fixtures
  if ($LASTEXITCODE -ne 0) { throw 'Fixture analysis failed' }
} finally { Pop-Location }
```

No database, provider key or paid call is needed. If the source commit is absent, obtain it from the repository before running; do not silently run the older local branch. Offline install reuses cache and is not proof of a fresh network installation. If it fails, inspect the error; a registry install is a separate dependency setup choice. An existing target directory deliberately stops this recipe rather than overwriting prior evidence.

Expected: three synthetic scenarios, all analysis reconciliation checks pass, stable analysis hashes, and explicit gaps. The database-dependent analysis test visibly skips without its database prerequisite. Generated output contains synthetic private keys only; real private exports must never be substituted into the backup.

## Static fixture backup and failure recovery

Open [mixed report](../../tracking/evidence/t18/demo-output/mixed/output/report.md), [zero-accepted report](../../tracking/evidence/t18/demo-output/zero-accepted/output/report.md) and [all-blocked report](../../tracking/evidence/t18/demo-output/all-blocked/output/report.md). These were generated during T18 and remain available with no running application. [Execution log](../../tracking/evidence/t18/demo-run.log) records the rerun. If startup fails during a presentation, state the failure and show this backup without relabeling it live. No video recording is claimed.

## Optional full product walkthrough — not executed in T18

For a later authorized rehearsal use docs/LOCAL_DEVELOPMENT.md, docs/ISOLATED_EXECUTION.md, docs/BOUNDED_BUILDER.md and docs/ARTIFACTS_AND_PREVIEW.md at the source commit. Configure a disposable test database, migrate, start the API/web and reviewed worker, then show fixture discovery, alternatives, humility/selection, frozen tasks, bounded build, fresh QA, exact package, separate-origin preview, feedback revision and provenance/cost search. Retain a legitimate existing-tool/deferred branch and label all scripted entries. Do not use a final evaluation command, enable live dispatch, recruit people or expose personal data to make a demo appear complete. This full-path clean attempt belongs to T19; the offline script above covers only the analysis segment.

## November 19, 2026 note (draft 2)

The script above is the October 18 fixture demonstration and keeps its scope. The defense on December 2 will also need to show the live evidence in draft 2 (Sections 5.2–5.4 of the [thesis draft](THESIS_DRAFT.md)). Use committed records and screenshots for that (for example the [p14-xl-v1 record](../../tracking/evidence/p14-xl-v1-live-qualify-2026-11-17/README.md), the [Autopilot page walk](../../tracking/evidence/autopilot-page/README.md), the [GitHub App walk](../../tracking/evidence/github-app-setup/README.md) and the [F4 trial](../../tracking/evidence/f4-live-trial-2026-11-17/README.md)) and label each as the dated record it is, not a live run. Any live demonstration on Jordan's PC needs Jordan's own go-ahead. The updated defense outline and slides are separate work.
