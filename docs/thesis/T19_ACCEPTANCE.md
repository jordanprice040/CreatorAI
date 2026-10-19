# T19 reproducibility and acceptance record

October 18, 2026 · Source candidate `3e9026f12d85d5eb6fd933e217176fae30be61c3`

## What this delivery means

This packet archives an implemented discovery/product studio and the missing-data thesis draft. It does not constitute academic acceptance. The proposed comparative protocol remains unfrozen; final participant outcomes, independent ratings and empirical results remain unavailable. RQ1–RQ3 remain unanswered. Committee acceptance, applicable human-subjects determination, official academic deadlines and defense arrangements require recorded decisions in [the checklist](COMMITTEE_REVIEW.md).

T19 reproduces the software on a fresh directory from the fixed source commit, using the pinned lockfile and cached dependencies. It preserves local owner decisions and the T18/T19 documents and optional acceptance evidence recorder as separately identified overlays rather than merging over the working checkout. See [verification record](../../tracking/evidence/t19/verification.json) for executed results and [walkthrough coverage](../../tracking/evidence/t19/WALKTHROUGH.md) for the exact paths exercised. The final archive has a per-file origin/hash manifest and an external archive checksum. Its extraction is checked for missing, changed or extra files; a deliberate changed-byte probe must fail.

## Delivered and deferred

Delivered: evidence/claim records; competing response types; versioned scoring and selection; deterministic grants and exact-money budget admission; PostgreSQL-backed durable workflows; bounded builder/reviewer roles; real reviewed-worker acceptance paths; exact-byte package/preview/download and feedback revision; catalog/provenance/cost inspection; synthetic three-condition study support; failure-preserving evaluation/analysis; reviewable thesis materials and fixture backup.

These are bounded engineering mechanisms verified on synthetic tasks. The core CLI walkthrough runs discovery/selection, the reviewed product branch, delivery/revision and same-workspace provenance/search/cost inspection. Independent suites add other fixture paths and boundary checks. It is not an autonomous live discovery campaign or a participant study. The acceptance deliberately replaces the discovery-derived clinic specification with the reviewed checklist specification before building; it does not establish that the selected clinic intervention was implemented. The software-product branch uses a reviewed fixed Python CLI template; its successful execution does not establish general program synthesis, market demand, revenue or beneficial impact. Reviewer role checks and actual acceptance execution are distinct from independent human quality ratings.

X01–X10 remain outside this acceptance claim: qualified automatic model routing, deeper context optimization, comprehensive semantic/audit search, remote GitHub workflows, native Windows desktop parity, hosted control, revenue/entitlements/reinvestment, live marketing, reusable knowledge and portfolio maintenance. Partial prerequisites do not establish completed extensions.

## Archive contents and privacy

The archive contains selected fixed-commit application source, tests, scripts, lockfile, configs, prompts, rubric/context, thesis draft, decision records, requirements evidence, verification logs, synthetic public evaluation output, analysis tables/figures, original and revised generated product source archives with bound manifests, and setup instructions. `MANIFEST.json` identifies every included byte and records exclusions. Source code is retained even where it generates synthetic private keys during a future local rehearsal.

Excluded: `.env*` (including local database credentials), node_modules/build caches, Git metadata, studio product stores, private assignment/reviewer keys, raw fixture input folders and private raw exports. There is no real participant dataset to redact or include. Public tables are synthetic or explicitly not empirical; copied historical evidence remains attributed to its original version. The archive has no provider key or activation grant. External original-reference documents and development-agent installation/configuration are outside the selected source distribution. Some historical documents link to excluded material; the manifest is the content inventory.

The local ignored rehearsal folder can contain synthetic assignment keys and raw exports for reproducibility. Do not distribute it. Only the selected public outputs enter this archive. No material is sent or published by the archive scripts.

## Reproduce from the archive

1. Check the `.sha256` sidecar against the archive using `Get-FileHash -Algorithm SHA256`; extract into a new directory with `tar -xf <archive> -C <empty-directory>`.
2. Run `node <extracted>/source/scripts/t19-archive.mjs --verify <extracted>` before installing dependencies. A mismatch or extra file fails. The manifest is integrity evidence, not an independent signature; keep the externally supplied checksum separately.
3. In `<extracted>/source`, use supported Node 22/24 and pinned pnpm 11.25.0: `corepack pnpm install --frozen-lockfile --offline`, then `corepack pnpm build`. Cached install is not a cache-empty or network-independent bootstrap. Registry access is needed if the cache or Corepack pnpm distribution is absent.
4. For the offline demo, run `node packages/orchestrator/dist/analyze-main.js fixtures .verification/demo`; open the reports under each scenario's output. Every output retains its fixture label. See [defense script](DEMONSTRATION.md).
5. For full verification configure only `CREATOR_TEST_DATABASE_URL` to a disposable loopback PostgreSQL server with CREATEDB, PostgreSQL dump/restore clients on PATH and `CREATOR_TEST_ISOLATION=wsl2` for the reviewed Ubuntu worker. Run `corepack pnpm test:db`. The tests create/drop their uniquely named databases. Follow source `docs/DOCKER.md` and `docs/ISOLATED_EXECUTION.md` for prerequisites, without copying a personal password into the archive.
6. Run `node scripts/t19-rehearsal.mjs .verification/rehearsal` with that disposable test URL. It creates and drops its own database and invokes the actual evaluation/analysis CLIs. It generates scripted, labelled A/B/C entries and a discovery pair, never participants or final study records. Preserve the public analysis and keep `private-evaluation` local.
7. For a UI/HTTP startup smoke check run `corepack pnpm smoke` with unused loopback ports using CREATOR_API_PORT/CREATOR_WEB_PORT as needed. This does not replace real-worker checks or prove every UI interaction.

The archive verifier must run before dependencies or new outputs are added; those intentionally create extra files. Use a separate extraction for later integrity checks. To rebuild the release, run the included archive builder from a repository with the fixed commit and documented local overlays: `node scripts/t19-archive.mjs --build <clean-source> <new-workspace-output>`. Do not rebuild from an unrelated dirty checkout and claim the same archive hash.

## Remaining acceptance items

Research: record RD1–RD10 decisions, resolve retry-rule ambiguity, adopt analysis/acceptance rules, add intervention-necessity coding if retained, verify model/pricing and operative spend authority, freeze final tasks and protocol, perform final runs and independent ratings, then analyze. Retain failed and blocked assignments.

Academic: obtain review and required revisions, add source-checked scholarly related work and institution-compliant formatting, confirm dates and thesis sufficiency. No schedule or approval is fabricated here. The final committee checklist remains the operative review queue.

Operational: this is a local prototype with documented threat-model limits, not a production security certification or full product parity. A source archive is not an installer. External deployment, public release and outbound distribution require their own scoped authorization.

Next eligible work is the specific unresolved acceptance or research item the owner chooses. There is no automatic next milestone or extension activation.
