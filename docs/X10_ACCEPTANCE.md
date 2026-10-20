# X10 full-product acceptance

X10 asks for a truthful readiness report, measured performance on a declared workload, a
bounded owner pilot and a reproducibility package. This page says what exists, what was
measured, and what is still not verified. The short answer: **the product is not ready**,
and the readiness check says so on its own.

## Readiness report

```powershell
pnpm readiness --out readiness.md   # exit 3 = not ready, 2 = the register is inconsistent
pnpm readiness pilot-check          # only the owner pilot gate
```

`config/readiness.json` has one row per requirement C01–C51 (from
`context/REQUIREMENTS.md`) and one per integration. Each row records six states separately:

| State       | Means                                                            |
| ----------- | ---------------------------------------------------------------- |
| implemented | code for the capability exists on main                           |
| fixture     | exercised end to end with fixture adapters on real PostgreSQL    |
| contract    | adapter checked against a loopback or contract double            |
| live        | exercised against the real external service, real data or people |
| activated   | switched on for real use by the owner                            |
| native      | exercised on the owner's Windows/WSL2 machine                    |

Each row lists the states it requires, its evidence paths and what blocks it. The checker
refuses a verified state with no evidence or with a missing evidence path, a later state
without its earlier one (activated without live), a missing, extra or duplicate row, and a
not-ready row with no blocker. The verdict is READY only when every required state is
verified and the owner pilot is completed with evidence. The latest generated report is
`tracking/evidence/x10/READINESS.md`.

At this commit: 51 requirements and 15 integrations, no register problems, and 36 rows not
ready. They fall into five groups:

- **No live model call yet** (C01–C08, C10, C11, C23, C37–C39, `openai-models`):
  gpt-6-astra stays documented until an accessible model id, key and grant are verified.
- **No real sources** (`source-fetch`, `source-search`): no approved host list or search provider.
- **Thesis study not run** (C15, C17–C19, C36): the protocol freeze waits on RD1–RD10.
- **External services not connected** (C40 GitHub, C43 hosted, C44/C45 payments, C46 and
  `campaign-delivery`, `oidc-sign-in`).
- **Not built, on purpose or not yet** (`paid-ads`, `alert-delivery`,
  `desktop-signing-updates`), plus C42, whose read-only offline cache was never separately verified.

The register is maintained by hand. It is only as true as the evidence it cites, so update it
whenever a milestone changes a state.

## Owner pilot

The pilot has **not been run**. `config/owner-pilot.json` starts with every owner choice
empty, and the gate refuses to start until Jordan records:

- who decided it, and when
- an exact budget in nano-USD, with a spend stop at or under it
- a stop after N consecutive failures, a cap on owner minutes, and a stop on unknown cost
  (unknown billing is not zero)
- a window that ends in the future, plus schedules
- platforms: `local-web`, `windows-desktop`, `wsl2-worker` or `hosted`. Each one needs its
  backing integration to be ready, and `hosted` is not.
- accounts: integration ids that are both live-verified and activated. None qualifies today.

When the pilot has run, set `status` to `completed` and list its evidence (costs, failures,
cleanup, owner time). Only then can the verdict become READY.

## Declared-workload benchmark

```powershell
$env:CREATOR_BENCH_DATABASE_URL = "postgres://USER:PASSWORD@127.0.0.1:5432/postgres"
pnpm bench .verification\x10-bench --ideas 10000 --events 100000 --samples 200
```

The benchmark creates its own database and drops it afterwards. It seeds one fixture
workspace through the audited store: sources, claims, problems, 10,000 ideas, products and
runs, linked together, plus 600 metered fixture broker calls. Revisions fill the rest of the
100,000 audit events. It then times the owner HTTP API with one sequential client.

Measured October 19, 2026 in the Linux cloud container (4 × Xeon 2.1 GHz, 16 GB, Node
22.22.0, PostgreSQL 16.15 with default settings, everything on loopback). This is a synthetic
workload, not real usage:

| Path (HTTP API)                        | p50 ms | p95 ms | p99 ms |
| -------------------------------------- | -----: | -----: | -----: |
| Catalog text search, all types         |  325.7 |  409.8 |  427.3 |
| Catalog browse                         |   20.1 |   28.5 |   38.3 |
| Id-prefix lookup                       |   58.7 |   73.2 |   97.2 |
| Bounded lineage (depth 4, 200 nodes)   |   10.2 |   12.6 |   14.9 |
| Cost of two products, shared runs once |   15.7 |   21.1 |   22.7 |
| Overview                               |    5.4 |    7.7 |    9.4 |
| Event display lag (commit to activity) |    8.6 |   12.9 |   14.7 |

Both provisional targets (search p95 under 2 s, event display p95 under 5 s) were met on
this machine. The event figure is measured at the API. A screen adds its own polling on top:
Overview polls every 4 s.

**Bottleneck fixed.** The first full run measured bounded lineage at p95 649 ms and cost
aggregation at p95 663 ms. The lineage walk built every link in the workspace into a CTE
before walking it, so each request cost more as the workspace grew. It now does two indexed
lookups per hop. Results, cycle handling and depth bounds are unchanged, and the X03
lineage/cost tests pass. Both runs are in `tracking/evidence/x10/` (`bench-before-lineage-fix/`
and `bench/`). Text search, the slowest remaining path, was left as it is because it is well
within its target.

Not measured: concurrent users, the owner's Windows machine, a browser, and real (non-fixture) data.

## Reproducibility package

```powershell
node scripts/release-archive.mjs --build <commit> .verification\x10-release
node scripts/release-archive.mjs --verify .verification\x10-release
node scripts/release-archive.mjs --extract .verification\x10-release .verification\x10-src
```

The script writes `git archive` of one exact commit and a `MANIFEST.json` listing every
file's sha256 and Git blob id. Verify reads the tar back and checks every file against the
manifest. It also checks that nothing is missing or extra, that the tar hash matches, that
the archive comment names the commit, and (when the checkout has that commit) that every
blob id matches `git ls-tree`. Extract writes only verified files into a new directory.
Running install, build and readiness in a fresh extract of commit `78f8536` is recorded in
`tracking/evidence/x10/release-validation.log`.

## Failures, cleanup, backup and effort

- **Failures.** The first version of the register had two inconsistencies (search marked
  fixture-verified while unimplemented, and the WSL2 worker marked activated without live).
  The checker refused both, and the register was corrected. Benchmark setup first failed
  because a source cannot directly support a problem, and a claim was added. Both are kept
  in this record and were not hidden.
- **Cleanup.** The benchmark drops its database, and its test checks that nothing is left behind.
- **Backup.** Backup restoration is covered by the existing restore test with real
  `pg_dump`, which ran in this milestone's full suite.
- **Owner effort.** No owner time, money or account was used in X10. All of it ran in the
  cloud container.
- **Maintenance burden.** The 36 not-ready rows above are the standing list of owner
  decisions and setup.
- **Not exercised.** Commerce and marketing ran in fixture/test mode only, as before. No
  live call, outreach, deployment or spend took place.
