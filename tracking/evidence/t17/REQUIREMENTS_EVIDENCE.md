# T17 requirements-to-evidence report

Date: October 18, 2026. Candidate: branch `claude/project-thread-k4si82` from `main` at
`e46b2cf` (T13 and the audit fixes merged). Author: Claude Code. ADR-0020.

Status words follow BUILD_STATUS: **verified** (executed checks on the stated platform),
**partial** (some acceptance evidence executed, named gaps remain), **planned** (later core
milestone), **deferred** (extension, not started). "Fixture" means deterministic fake model,
reviewers or sources; "test double" means the labelled executor that runs nothing; "WSL2"
means the real reviewed worker on Jordan's Windows machine. Nothing here is live: no real
model call, real web fetch, real participant or public release has happened.

## What T17 executed

| Check | Platform | Result |
| --- | --- | --- |
| Full PostgreSQL suite `pnpm test:db` (before changes) | Linux cloud, PostgreSQL 16.15 | 158 tests, 148 pass, 0 fail, 10 WSL-only skips |
| Full PostgreSQL suite after T17 changes | Linux cloud, PostgreSQL 16.15 | 161 tests, 151 pass, 0 fail, 10 WSL-only skips; typecheck and format pass |
| Backup → restore into a new database and product store → real API on the restored copy (`tests/src/restore.test.ts`) | Linux cloud | pass: counts equal, audit chain intact, artifact manifest and package hashes match, catalog search returns the same hits, artifact lineage and download return the exact bytes; a second restore over a non-empty target is refused; a tampered restored package fails verify and the download is refused (400 hash mismatch); a stray file in the backup is refused; redacted text is absent from a plain dump of the restored data |
| `pnpm backup create / restore / verify` CLI by hand | Linux cloud | pass on an empty migrated database; restore into a non-empty database refused; a wrong password errors without printing it |
| Parent overrun (audit item 4), reproduced first | Linux cloud | before: a sibling under an overrun parent still spent (`succeeded`); after: `ancestor_overrun`, and new carve-outs under the period and the root fail `BUDGET_EXCEEDED`, adapter calls unchanged |
| Concurrent parent calls vs child carve-outs for the last budget (S07) | Linux cloud | pass three runs: reservations + created children = exactly the authority that existed |
| Preview stdin split mid-character (audit item 7), reproduced first | Linux cloud | before: `café ✓` corrupted; after: arrives intact |
| Health labels (audit item 5) | Linux cloud | live adapter configured → `live_configured`, `live.model` and `live.sources` = `configured_unverified`; the key never appears |
| Real WSL2 worker gate | Jordan's Windows machine | **not run for T17**; last run (audit fixes) 157 pass / 1 expected skip. The T17 changes touch no executor code. Re-run recommended before merge: `CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` (the restore test needs `pg_dump` 18 for the Docker database; set `CREATOR_PG_BIN` or it skips visibly) |

## T17 priority risks

| Risk | Evidence | Status |
| --- | --- | --- |
| Concurrent budgets | `broker.test.ts`: 8 concurrent calls vs a 3-call envelope; new S07 parent/child race | verified (cloud) |
| Child inheritance | `domain.test.ts` delegation contains paths/grants/depth; `broker.test.ts` child envelopes conserve authority; `orchestration.test.ts` limits | verified (cloud); overrun now reaches ancestors (fixed in T17) |
| Unknown external outcome | `broker.test.ts` unknown outcomes need owner reconciliation, lost worker leaves exposure unknown; `orchestration.test.ts` unknown is never retried | verified (cloud, fixture provider) |
| Crash / replay | `workflow.test.ts` crashed worker loses its lease, stale worker cannot commit; `workflow-api.test.ts` killed worker and API processes; `executor.test.ts` unresolved dispatch blocks another worker | verified (cloud; executor part WSL2) |
| Source injection | `research-store.test.ts` retrieved instructions change nothing (no grants, decisions, policy or fetches); passages flagged `instruction_like`; `research.test.ts` packets carry text as data | verified (fixture and loopback adapters) |
| Stale approval | `oversight-store.test.ts` changed target or expiry needs a new decision; `selection.test.ts` spec change invalidates approval versions; `artifacts.test.ts` changed commits invalidate packaging | verified (cloud) |
| Worker escape | T11/T12/T13 WSL2 gates: namespace, mount, network, resource, symlink/hardlink, tree cancellation; Linux hosts refuse execution by design (`artifacts.test.ts` no-worker test) | verified for the reviewed Python template on Windows + WSL2; hostile-workload breadth (seccomp, arbitrary toolchains) not audited |
| Human-only leakage | `study.test.ts` human-only denies every broker action and helper with zero adapter calls; participant/grader isolation incl. mixed-case ids; `oversight.test.ts` | verified (cloud) |
| Benchmark contamination | `study.test.ts` baseline context excludes rubric and structured prompt; held-out QA cases never reach a role packet (`build.test.ts`) | verified (cloud); final-protocol checks belong to T14/T15 |
| Artifact / commit mismatch | `artifacts.test.ts` manifest bound to commit/spec/task/QA; `artifact-api.test.ts` hash mismatch on read, download and start; new restore test | verified (cloud double + WSL2 T13 gate) |
| Backup and restoration | new `restore.test.ts` and `pnpm backup` | verified (cloud Linux); Windows run pending |
| Cancellation / reaping | `workflow.test.ts`, `broker.test.ts` cancellation keeps in-flight exposure held, `sweepStale`; WSL2 process-tree cancellation and cleanup (T11) | verified |
| Redaction and search permissions | `catalog.test.ts` membership before snippets and counts, redaction leaves nothing to find; `storage.test.ts` tombstones; restore keeps redaction | verified (cloud). There is no way to remove a member, so "access revoked after indexing" (S16) has no path to test; search checks membership at query time, so a future removal would take effect immediately |
| Protected logs | Database URL never logged (`config.ts`), session and ticket tokens stored as hashes (T03/T13), OpenAI key not leaked (`budget.test.ts`), health hides keys (new), backup passes passwords by environment | verified by test where named; the API's console output was reviewed by reading, not by a test |
| Windows / WSL startup | T10 (native Windows, PostgreSQL 18.6), T11–T13 (WSL2 worker), Docker PostgreSQL 18.6; `docs/LOCAL_DEVELOPMENT.md`, `docs/ISOLATED_EXECUTION.md`. Jordan's PATH has pnpm 12, which refuses this repo; use a terminal-local corepack shim | verified on Jordan's machine at T13 and the audit fixes; not re-run for T17 |

## Acceptance scenarios (templates/ACCEPTANCE_SCENARIOS.json)

| ID | Case | Evidence | Status |
| --- | --- | --- | --- |
| S01 | Source asks to expose a secret | `research-store.test.ts` injected instructions; `instruction_like` flag | verified (fixture). The flag is stored on the passage; there is no separate incident record |
| S02 | Two sources repeat one complaint | `research-store.test.ts` reposts form one origin | verified (fixture) |
| S03 | Existing tool solves the need | `discovery.test.ts` justified existing-tool choice | verified (fixture) |
| S04 | Role ambiguity | `discovery.test.ts` non-software options; `oversight.test.ts` humility gate | verified (fixture) |
| S05 | Stakeholder values absent in autonomous trial | `oversight-store.test.ts` autonomous runs end as needs_human | verified |
| S06 | Routine reversible detail | `oversight-store.test.ts` covered routine actions proceed without a decision | verified |
| S07 | Parent/child race for last budget | new S07 test; overrun propagation | verified (cloud) |
| S08 | Provider timeout after possible execution | `broker.test.ts` late results reconcile without duplicate charge | verified (fixture provider) |
| S09 | Worker dies then reports | `workflow.test.ts` fencing | verified |
| S10 | Candidate changes after approval/QA | `selection.test.ts`, `artifacts.test.ts`, `build.test.ts` mismatched reviewed commit | verified |
| S11 | Generated code reaches host path or secret | T11 WSL2 gate | verified on Windows + WSL2 for the reviewed template |
| S12 | Human-only asks for AI summary | `oversight.test.ts`, `study.test.ts` | verified |
| S13 | Open-ended baseline sees the rubric | `study.test.ts` baseline context excludes rubric | verified |
| S14 | Export omits runtime instructions | T13 clean-start verification (`artifacts.test.ts` re-extracted run differs → not runnable) | verified (double + WSL2) |
| S15 | Condition with no accepted outcomes | not implemented; T16 analysis | planned (T16) |
| S16 | Access revoked after indexing | no member-removal path exists; query-time checks; preview revocation verified (T13) | partial |
| S17 | Payment events | X07 | deferred |
| S18 | Campaign retry | X08 | deferred |

## Requirements C01–C51

| ID | Requirement | Status | Evidence | Gap / next |
| --- | --- | --- | --- | --- |
| C01 | Evidence-based discovery-to-product workflow | partial | Each stage verified separately: T06 sources → T07 discovery → T08 selection/spec → T12 build → T13 artifact and revision; restore test runs spec → artifact → catalog | No single run has gone from a fetched source to a downloaded product; fixture model and sources only |
| C02 | Directed locator | partial (fixture) | `discovery.test.ts` | Live model behaviour unverified |
| C03 | Cross-field ideation | partial (fixture) | `discovery-domain.test.ts` names-only mechanisms repaired | Live model unverified |
| C04 | Urgency and software influence | partial (fixture) | `selection.test.ts` rubric with cited evidence | Fixture reviewers only |
| C05 | Source provenance and claim support | verified (fixture/loopback) | `research-store.test.ts` | No live search adapter; live fetch unverified on real sites |
| C06 | Corroboration and counterevidence | verified (fixture) | reposts counted once, contrary source retained | — |
| C07 | Competing concepts and bounded revision | partial (fixture) | `discovery.test.ts` revision limit and dissent | Live model unverified |
| C08 | Deduplication and existing alternatives | partial | word-overlap duplicate detection | Lexical only |
| C09 | Versioned rubric, uncertainty, override | verified (fixture reviewers) | `selection.test.ts`, `selection-domain.test.ts` | Calibration is T14 |
| C10 | Non-code options | verified (fixture) | existing-tool and non-code paths never forced to build | — |
| C11 | Assumptions and reconsideration | verified (fixture) | assumption records, humility gate | — |
| C12 | Useful human requests | verified | decision requests with evidence, options and scope (T03) | Real-owner usability not measured |
| C13 | Configurable autonomy | verified | `oversight*.test.ts`; model self-approval fails | — |
| C14 | Version-bound approvals, dissent | verified | approve-once exact target; overrides retained | — |
| C15 | Three-condition comparisons | partial (synthetic) | T10 study runner | Real participants and adopted protocol: T14–T16 |
| C16 | No hidden AI in human-only | verified for implemented paths | zero adapter calls across broker, helpers, workflows | External human tool use cannot be verified by software |
| C17 | Structured vs open-ended comparison | partial (synthetic) | baseline context excludes rubric | Frozen final design: T14 |
| C18 | Reproducible protocol, failures, blinded ratings | partial | failures retained, export hashed, grader separation | Blinded packets: T15 |
| C19 | Intervention quality and effort | partial | intervention and time fields in export | Real measurement: T15–T16 |
| C20 | Specs and task DAGs | verified (fixture) | cycles, coverage, ownership checks before freeze | — |
| C21 | Bounded delegation | verified | child scope/budget/call limits; cancellation propagates | — |
| C22 | Persistent state and crash recovery | verified (cloud) | killed worker and API restart, fencing | Build crash intents need manual inspection (T12 limit) |
| C23 | Independent review and executed QA | verified (WSL2, synthetic roles) | T12 gate; held-out cases (ADR-0018) | stdout/exit CLI recipe only |
| C24 | Tested artifacts and downloads | verified (WSL2) | T13 gate; restore keeps hashes | CLI-only demo; no installer |
| C25 | Feedback revision | verified (WSL2) | T13 one feedback-driven revision | — |
| C26 | Searchable many-to-many provenance | partial | lexical search, lineage ≤ 8 hops, artifact lineage | Build records not catalogued; semantic search X03 |
| C27 | Observable audit | verified | hash-chained audit, intents/outcomes, costs; chain re-verified after restore | Natural-language audit questions X03 |
| C28 | Exact budgets and reservations | verified (fixture/contract) | atomic reservations, carve-outs, unknown ≠ zero, overrun reaches ancestors (T17) | Live billing reconciliation unverified; overrun guard not serialized against a concurrent settle (ADR-0020) |
| C29 | Cancellation and partial results | verified | workflow, broker and builder cancellation keep partial output and held exposure | — |
| C30 | Restricted execution | partial (verified for reviewed template) | T11 WSL2 namespace/mount/network/resource gates | No seccomp allowlist; broader hostile workloads unaudited; Linux refuses by design |
| C31 | Privacy, injection, retrieval access | verified (cloud) | injection inert, membership before snippets, redaction survives backup | No member removal path (S16) |
| C32 | Local-first usable control | verified | loopback-only config, PostgreSQL persistence, local backup/restore (T17), explicit live flags in health (T17) | Windows run of backup pending |
| C33 | Local Git per product | verified (WSL2) | T11 | — |
| C34 | Task-specific context and tokens | partial | bounded packets and token accounting per call | Context selection breadth X02 |
| C35 | Web catalog and controls | partial (fixture, headless Chromium) | T09 and T13 browser walkthroughs | Real screen readers untested |
| C36 | Thesis and reproducibility | planned | — | T18–T19 |
| C37–C48 | Extension features | deferred | — | X01–X09 |
| C49 | Real vs fixture status | verified | fixture banners, labelled test double, health now reports configured live adapters honestly (T17) | — |
| C50 | Owner control without repeated prompts | verified | standing grants cover routine actions | — |
| C51 | Declared-scale performance | deferred | — | X10 |

## Critical blockers

None found that block T14–T16 preparation. Items that remain open and are recorded rather than
fixed: real WSL2 re-run for this branch; overrun guard serialization (ADR-0020); preview
cookie scope assumption (ADR-0020); no member-removal path; no single end-to-end run from a
live source to a product. This is not a production-ready or live-integrated system.
