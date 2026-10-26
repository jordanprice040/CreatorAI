# Theme-intent helper v3: bounded stale-state release and forward verification

Prepared October 23, 2026 in the canonical `C:\dev\creator_agent` checkout.
The independent v2 review dated October24 remains `partial_changes_required` for
those exact bytes. V1/v2 source, packages, reviews and receipts are preserved.
V3 is a separate repair candidate, not independent support or installation approval.
Full C54 remains partial. The retired checkout is not used.

The package candidate remains
`7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc` and
installation plan remains
`27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.
No app/schema/package source was changed or rebuilt for this helper revision.

## Repair scope

V3 retains v2's exact package/plan checks, pre-secret independent review, private
backup tree, dedicated exported PostgreSQL snapshot/client, populated-state
preservation, admission-only freshness, bounded migration child, and separate
coordinated rollback decision. It uses new `-v3` entry points, lock and `/3` receipt
formats. Never mix v2 and v3 receipts or apply v3 cleanup to a legacy lock.

New v3 behavior addresses the two Medium findings:

- A `release` phase works without `prepared.json`, a complete backup, database
  credentials, a Pool, SQL, migration or installer execution. It is available after
  death during early or partial `before` preparation. It preserves partial evidence
  and snapshots; a new preparation needs a new session and new directories.
- `after` and `reconcile` can use the same narrowly bound stale-release decision
  before acquiring a new phase lease. A known successful schema29 result can be
  verified forward rather than forcing schema28 rollback. No installer or migration
  effect is repeated or reclassified as successful just to grant acceptance.

## Cleanup-only authority and pre-secret gate

Every operational phase still needs a separately produced supported
`theme-intent-upgrade-independent-review/3` receipt with exact candidate/plan and
the full `helper_sha256` map from `--bindings`, status `supported_exact_helper`,
and `prior_implementation_involvement:false`. Fixture receipts use a distinct
format/status and only work in a marked, contained ignored-root test layout.

A stale release additionally requires an actual new decision file:

| Field                                           | Required binding                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `format`                                        | `theme-intent-owner-stale-state-release/3`                         |
| `candidate_plan_hash`, `installation_plan_hash` | Exact frozen identities above                                      |
| `helper_sha256`                                 | Complete current reviewed runtime binding map                      |
| `owner_decision`                                | Actual nonempty decision and retained provenance; never fabricated |
| `fixture`                                       | `false` for operational use                                        |
| `release_stale_state`                           | `true`; grants cleanup only                                        |
| `resume_phase`                                  | Exact `release`, `after`, `reconcile` or `recover` invocation      |
| `session_id`, `evidence_dir`                    | Exact original session and evidence directory                      |
| `studio_home`, `data_dir`                       | Exact studio home and its managed `postgres` directory             |
| `config_sha256`                                 | Current `studio.json` hash                                         |
| `context_sha256`                                | `null` operationally; exact fixture context hash in tests          |
| `lock_sha256`, `lock_pid`, `lock_token`         | Exact stale lease file and its recorded owner                      |
| `allow_stop_owned_cluster`                      | Must be `true` to stop a still-running matching helper cluster     |

The helper checks the decision and proves the recorded PID no longer exists.
A still-live or reused live PID is refused. The lock must be readable and match
its session/home/evidence. The wrapper's pre-secret pass performs these checks.
For `release`, the wrapper then follows a no-credentials branch: it never reads or
decrypts DPAPI, and the CLI never loads database dependencies. Missing live secrets
or an incomplete protected backup do not prevent cleanup.

This decision does not grant installation, migration, rollback, record writes or
retries. `after`/`reconcile` still require their prepared/admission/effect bindings;
`recover` still requires its separate coordinated recovery decision. The generic
inner wrapper and CLI now also require explicit installation/recovery confirmation
switches/fields, in addition to the exact owner decision files.

## Ownership, serialization and preservation

All v3 CLI operations hold a per-studio Windows named mutex through a small bound
PowerShell guard. The guard monitors its owning Node PID and process start time;
it releases the OS mutex if the Node process dies, including when inherited pipe
handles remain open. Unexpected guard loss terminates the owning CLI rather than
letting it continue without serialization. The desktop does not participate in
this mutex: fully quit desktop/workers and maintain that condition during work.

The durable lease is written/synced completely to a temporary file, then published
with an exclusive same-volume hard link. A new visible lease cannot be the empty
`wx`-then-write lock identified in v2. The mutex protects cleanup and lease
publication from competing helper processes; the lease retains the dead PID,
session and unique ownership token after a crash.

Each managed start uses a unique transient `cluster_name=creator-upgrade-<token>`
option. Before stopping, the helper checks `pg_ctl status` against the exact data
directory and verifies that ownership token in `postmaster.opts`. A foreign port
listener or different cluster token is not stopped. Normal cleanup no longer
stops a cluster merely because its status is running. It checks that the desktop
and workers remain quit, and preserves the lease when cleanup is uncertain.
The startup token changes no application table or persistent PostgreSQL config.

`release` serializes, repeats its proof checks, stops only that matching tagged
cluster if authorized, then retires the original lease into its evidence directory.
It writes a new decision-bound cleanup receipt. It never erases the original lock
or partial artifacts and does not repair or relabel an incomplete backup. If the
cluster is already stopped, it can retire the proven stale lease without a stop.
Corrupt/unknown legacy metadata or a live worker requires separate investigation;
this is not a process-killing or general disaster-recovery tool.

## Forward verification

After a post-result death, invoke `after` with the original install decision and a
new stale-release decision scoped to `after`. The helper first releases the dead
lease/owned cluster, then takes a new lease, starts its own cluster and runs the
unchanged exact schema29/program/record-preservation verifier. Freshness is still
an admission rule, so elapsed time does not block this read-only check.

Alternatively, `reconcile` can release the stale state and record actual schema,
program and preservation observations. Its receipt marks
`forward_state_verified:true` only for observed schema29 and the exact target
program. It separately records whether the migration response exists. If the
response is missing, this observation is not a fabricated child-success receipt;
no installer or migration is retried. `after` still requires an actual bound
migration-result receipt. Recovery to schema28 remains a separately chosen action.

Prospective calls (not executed operationally):

```powershell
./scripts/upgrade-theme-intent-v3.ps1 -Phase release -SessionId <original-id> `
  -EvidenceDir <original-evidence> -ReviewFile <supported-v3-review> `
  -StaleDecisionFile <new-cleanup-only-decision>

./scripts/upgrade-theme-intent-v3.ps1 -Phase after -SessionId <original-id> `
  -EvidenceDir <original-evidence> -ReviewFile <supported-v3-review> `
  -ApprovalFile <original-install-decision> `
  -StaleDecisionFile <new-decision-scoped-to-after>
```

Use absolute metadata paths. No supported operational v3 review, cleanup decision,
installation decision or recovery decision is supplied by implementation tests.

## Other review corrections and limits

- `/NS` suppresses shortcut creation in the generated NSIS template. Predecessor
  replay does not establish shortcut restoration. Existing shortcuts normally point
  to the same program path; missing/custom links need native acceptance and a
  separately scoped repair. Standard/custom registry and real NSIS behavior remain
  unexecuted. The earlier v2 shortcut statement is superseded here, not rewritten.
- Node from PATH, configured PostgreSQL binaries and Windows system tools remain
  trusted host prerequisites. The helper/JavaScript dependency closure is bound;
  this is not a claim that every system runtime binary is included.
- The15minute freshness window can still be consumed by hashing/copying large
  trees. That fails closed at admission. Operational-scale timing remains unverified.
- Tracked preservation metadata can contain relative product/vault file names and
  hashes, not credential bytes. Sensitive snapshots remain outside tracked output.
- The v3 test runner records exact helper/test/fixture hashes before and after each
  run plus the resulting TAP hash and exit state. A source change invalidates the
  run receipt; counting passing TAP entries alone is no longer sufficient evidence.

## Local verification and next gate

The v3 suites use real Windows PowerShell/DPAPI with synthetic credentials and a
disposable managed PostgreSQL18 layout on127.0.0.1:55454. Candidate migration is the
real frozen service; installer effects are labeled fixture copies, never NSIS.
Abrupt-death probes observe the actual CLI process exit independently of inherited
server handles. The source-bound run receipts and retained attempts identify the
exact tested code. No operational configuration, credentials, database, installed
application, provider, workflow or retired checkout is accessed.

Completion results are recorded in the v3 repair receipt only after executed
checks finish. Next eligible step remains a fresh independent exact-v3 review,
followed only by separately authorized operational preparation and a new exact
owner installation/migration decision. Full C54 remains partial.

## Executed results

The first source-bound run passed **24 end-to-end scenarios plus their parent
test (25/25 TAP tests)** and **8/8 guard tests**, with zero failures or skips.
`first-e2e-run.json` and `first-guards-run.json` bind the before/after helper,
test and fixture hashes to the actual TAP digests. Both report unchanged sources.
The end-to-end run took about13minutes on this host; this is local fixture timing,
not an operational-scale performance claim. The test listener55454 was stopped.

New executed cases include two actual CLI deaths during `before`: immediately
after managed startup and after the dump/baseline but before protected-file copies.
Both had no prepared receipt or protected backup. Cleanup rejected a wrong lock
hash and a foreign cluster tag, then succeeded with the live DPAPI blob unavailable.
It kept retired locks/partial evidence, stopped the matching owned cluster and
allowed a new session's preparation afterward. The guard suite separately rejects
a live lock owner and concurrent helper control processes.

Forward checks killed the CLI during `after` and just after the migration result.
The former resumed `after`; the latter ran `reconcile` followed by `after`.
Both verified schema29 without a required rollback, new installer effect or repeated
migration, preserving the original effect-receipt hashes. Rollback was subsequently
exercised only under a separate synthetic recovery decision as fixture reset.
Inherited populated-state, snapshot, admission, concurrency, child-failure/redaction,
age-independent verification and coordinated recovery regressions also passed.

Five PowerShell files parsed; targeted JavaScript formatting/syntax and static
package preflight passed. The v2 repair's162 artifact hashes remain unchanged.
Standalone early guard output is retained separately; the source-bound run receipts
are the acceptance evidence. No failed v3 full run was suppressed or replaced.

These are implementation-involved checks, not an independent support verdict.
No real NSIS, registry/shortcut operation, operational config/credential/database,
provider, workflow or retired checkout was used. All test owner/review decisions
are visibly synthetic and confined to the ignored fixture root.
