# X06/X07 audit — October 19, 2026

Candidate: merged `origin/main` at `8d44ace`; fixes in the attached audit worktree.
The original X05 checkout and its pre-existing uncommitted edits were preserved.
Scope: X06/X07 acceptance gates, domain/store/service/API paths, deployment files,
and executed PostgreSQL checks. No deployment, external alert, processor account,
paid call, public release or activation was authorized or performed.

## Findings and repairs

| Priority | Reproduction / consequence                                                                                                             | Repair                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Hosted `COPY . .` included local `.env` files, products, Git metadata and verification outputs in the build context/image.             | Added `.dockerignore` exclusions for private/generated inputs.                                                                                                                   |
| P1       | Fresh named product volume had no image-created directory owned by the non-root app user; readiness could fail with permission denied. | Create `/data/products` owned by `node` before switching users. Image startup remains unexecuted.                                                                                |
| P1       | Bookworm's default PostgreSQL client cannot dump supported newer servers.                                                              | Install major-version-18 client from the official signed PostgreSQL package repository. Image build remains unexecuted.                                                          |
| P1       | Two Stripe connections naming one account could record the same charge under different economic keys, including after revocation.      | Permanent global Stripe account identity constraint; serialized registration and a clear duplicate error. Fixtures remain independent simulated processors.                      |
| P1       | Multiple rails for one connection counted the same available processor balance repeatedly.                                             | One processor rail per connection, enforced in code and migration 20 under concurrency.                                                                                          |
| P1       | Processor snapshots read before the workspace lock could apply in reverse order and undo newer refunds or payout observations.         | Observe payment/payout/balance under the financial lock, hold connection revocation lock, then update within that same transaction. Reads use bounded adapter timeouts.          |
| P1       | Stripe loss lists with `has_more` were treated as complete; omitted refunds/disputes could be reversed in the ledger.                  | Refuse partial or malformed lists, returning a retryable processor-unavailable outcome. Pagination beyond the current contract limits remains unsupported.                       |
| P1       | An active connection retained its old verification after the environment credential changed accounts.                                  | Check current processor account and test-mode identity before checkout and each observation.                                                                                     |
| P1       | Non-USD payments entered the USD ledger; partially captured payments could grant full-price access.                                    | Validate snapshots at the store boundary, refuse non-USD payment posting, check net/fee arithmetic and require the captured amount to match the offer payment amount for access. |
| P1       | A failed balance refresh left the last successful rail usable until TTL expiry.                                                        | Mark the rail unavailable on observation outage/account mismatch; an owner must verify it before explicitly restoring availability.                                              |
| P2       | Operations money totals omitted reserved, unknown and incurred amounts recorded on child envelopes.                                    | Sum charged amounts across all envelopes once, excluding allocation transfers. Count overruns at every level.                                                                    |
| P2       | Signed JSON `null` reached property access and failed as a server error.                                                               | Reject non-object/array event bodies as malformed input.                                                                                                                         |
| P2       | Hosted services had no CPU/memory/process bounds or rotated container logs.                                                            | Add explicit per-service limits and bounded JSON log rotation.                                                                                                                   |

## Verification and limits

The final financial regression also covers a sale smaller than its processing fee:
settlement records zero earnings and the fee deficit as a loss. Previously the
negative earnings violated the tranche constraint and rolled back reconciliation.

Regression checks exercise concurrent duplicate registration, revocation identity,
actual database lock contention during overlapping observations, truncated histories,
credential account drift, currency rejection, partial-capture entitlement denial,
balanced snapshot arithmetic, fresh-rail outage and child-envelope monitoring.
Existing acceptance checks exercise the owner API/CLI, signed event processing,
refunds/disputes, concurrent/partial reinvestment, environment separation, staging
proxy rehearsal and real PostgreSQL dump/restore into an empty database/store.

Final executed results are recorded in `tracking/evidence/x06-x07-audit/` and the
current build status: final focused checks 24/24 with no skips; broad audit suite
242 passed, zero failed, 14 explicit skips (256 tests), before the last fee-deficit
repair. The final focused run covers that last repair. Final typecheck, production
build, formatting and Compose configuration checks passed. The production build
retains Vite's nonfatal bundle-size warning. An initial invocation failed because its separately started
disposable PostgreSQL process had ended with its tool session (connection refused).
The subsequent invocation kept the database alive with the tests and passed all
21 focused checks; this earlier pass precedes the final currency/account/metrics
regressions and is not evidence for those later edits.

Migration 20 deliberately refuses an existing database with duplicate Stripe account
identities or processor rails. Reconcile such test records before upgrading; do not
delete or rewrite immutable financial history just to pass the migration. No existing
studio database was migrated during this audit; tests use disposable databases.

X06 remains partial until the actual image, fresh-volume startup, TLS/OIDC and a
declared hosted staging target are verified. Docker CLI is installed but its daemon
was unavailable in this audit. X07 remains fixture/contract verified, USD only,
without live payment activation or an observed Stripe test API call. Stripe API
version remains unpinned. Existing owner-attested rail evidence still depends on
the owner identifying disjoint real funds; software cannot infer bank identity
from an opaque label. No product-wide completion claim follows from these tests.

Next eligible milestone: X08, only on owner request. Actual staging activation and
live commerce require their separate scoped decisions.

Sources checked October 19, 2026:
[Docker build context and dockerignore](https://docs.docker.com/build/concepts/context/),
[PostgreSQL Debian repository and versioned clients](https://www.postgresql.org/download/linux/debian/),
[Stripe refund list pagination](https://docs.stripe.com/api/refunds/list),
[Stripe dispute list pagination](https://docs.stripe.com/api/disputes/list).
