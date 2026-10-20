# Payments, entitlements, revenue and reinvestment (X07)

October 19 audit (ADR-0034, migration 20): each Stripe account retains one permanent
connection identity, including after revocation, and each processor connection has
one funding rail. Existing duplicate identities block migration for reconciliation.

October 20 repairs (ADR-0040, migration 24): processor reads occur outside financial
transactions, with observation epochs fencing stale results. Before applying
snapshots, current connection state is rechecked, and
each operation rechecks the current credential's account. Non-USD posting, inconsistent
balance arithmetic and partial-capture access are refused. Stripe histories with
`has_more` or malformed list metadata are unavailable, never assumed complete.
Failed balance observations mark a rail unavailable even if its old balance is still
within TTL; explicitly restore availability only after verifying the rail. Full audit
and remaining verification gaps: [X06/X07 audit](X06_X07_AUDIT.md).

Status: implemented and verified with the labelled fixture processor and a Stripe contract double, October 19, 2026. No live or test-mode Stripe call has been made by this project. Live payments are not built; turning them on is a separate owner decision (ADR-0033).

## What exists

- **Processor connections** (`pnpm cli pay-connect`, `pay-verify`, `pay-revoke`). A connection names the processor (`fixture` or `stripe`), its mode (`fixture` or `test`), the account it must belong to, and the environment variables that hold its test secret key and webhook signing secret. Secrets are never stored. Verification asks the processor whose credential it is; only the configured account activates. A live Stripe key (`sk_live_…`) is refused before any call. Connections are allowed only in fixture workspaces, because test-mode money is not money and must never fund real budgets.
- **Offers** (`offer-create`, `offers`, `offer-archive`) sell exactly one verified release: an artifact manifest by id and SHA-256, priced in whole cents.
- **Checkout** (`checkout`) asks the processor for a checkout session that carries the offer and an opaque customer reference. It grants nothing.
- **Webhooks** arrive at `POST /api/payments/webhooks/<connection-id>` with the `Stripe-Signature` header (HMAC-SHA256 over `t.body`, 5-minute tolerance, checked against docs.stripe.com on October 19, 2026). After the signature, the mode and the event id are checked, the service reads the named payment or payout from the processor and records only that backend read. Event bodies are hints; their amounts and states are ignored. If the processor cannot be read the delivery gets 503 so the processor retries, and nothing is recorded as money.
- **Return page** `GET /api/payments/return` is deliberately inert. Query parameters are never read, and return URLs that try to carry `paid`, `grant` or `entitle` flags are refused when the checkout is created.
- **Ledger** (`ledger`, `ledger-balances`, `owner-funding`). Double entry, debits positive, credits negative, each entry summing to zero (enforced by a deferred database trigger). Entries are keyed by the underlying economic transaction (charge, settlement, refund, dispute, payout), not by webhook event, so duplicate or reordered events converge on the same entries. When the processor later reports something different (a dispute won, a payout failed, a refund that failed), a balanced correction entry is posted; nothing is edited. Accounts: `processor_pending`, `processor_available`, `bank`, `revenue`, `processing_fees`, `refunds`, `dispute_losses`, `dispute_fees`, `owner_funding`.
- **Entitlements** (`entitlements`, `entitlement-check`) are derived from the backend read only: a captured payment of exactly the offer price in USD whose metadata names the offer. Any refund or a lost dispute revokes (permanently); an open dispute suspends; a won dispute restores. The check returns the bound manifest hash.
- **Reinvestment** (`reinvest`, `reinvest-policy`, `reinvest-allocate`, `reinvest-allocations`, `reinvest-tranches`, `reinvest-settle`), disabled until the owner sets an enabled policy. See below.
- **Funding rails and commitments** (`rails`, `rail-add`, `rail-status`, `rail-attest`, `rail-observe`, `commitment-add`, `commitment-close`).

## Reinvestment rules

Each settled payment creates one earnings tranche: its net (amount minus processor fees), the policy's basis points at settlement, and an eligibility date after the holdback window (30 days when no policy exists). Pending funds, owner seed funding, payouts and forecasts never create tranches.

An allocation turns eligible tranche capacity into a new root (`global`) budget envelope, journalled as `fund` in the existing budget journal. The financial ledger is not touched: reinvestment is budget authority, not a bank transfer. Capacity is the least of these bounds, each reported separately by `pnpm cli reinvest`:

| Bound               | Meaning                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eligible_tranches` | Unconsumed reinvestable share of tranches past their holdback and not under dispute                                                                                                             |
| `surplus`           | Retained earnings of settled tranches (net minus refunds and disputes) minus operating costs outside reinvested envelopes (incurred plus unknown) minus what reinvested envelopes hold or spent |
| `usable_liquidity`  | Fresh balances of available funding rails, minus the policy reserve, open commitments, unspent reinvested authority and outstanding losses                                                      |
| `period_cap`        | The policy's cap for the current period minus allocations already made in it                                                                                                                    |

Allocations take the workspace's reinvestment lock and consume tranches oldest first; a partly used tranche keeps its remainder. A request above capacity is refused unless `allow_partial` is set.

A funding rail is either a processor balance (read from the processor, usable for 15 minutes) or an owner attestation (with evidence, usable for 24 hours). A rail marked unavailable, a stale balance, or a processor connection that is not active contributes nothing, so with no usable rail no authority can be created.

When a refund or dispute arrives after its earnings were reinvested, the tranche's cap falls. Consumption above the new cap becomes a reinvestment loss. The store then closes idle reinvested envelopes (newest first) and reopens any remainder as a smaller successor envelope. An envelope with in-flight work or carved-out children is left alone; while any loss is outstanding, new allocations are refused (`losses_outstanding`). `pnpm cli reinvest-settle` retries the reclaim and repays losses from newly eligible tranches.

## Example (PowerShell, fixture workspace)

```powershell
$env:CREATOR_PAYMENTS_HOOK = "whsec_fixture_local_secret"
pnpm cli pay-connect <ws> '{"label":"Fixture","processor":"fixture","mode":"fixture","account_id":"acct_fixture0001","secret_key_env":null,"webhook_secret_env":"CREATOR_PAYMENTS_HOOK"}'
pnpm cli pay-verify <ws> <connection-id>
pnpm cli offer-create <ws> '{"connection_id":"<connection-id>","artifact_id":"<artifact-id>","manifest_sha256":"<manifest-sha256>","label":"My app","price_nano_usd":"25000000000"}'
pnpm cli reinvest <ws>
```

The fixture processor lives in the API process memory and is lost on restart. For a Stripe test-mode connection, set `CREATOR_STRIPE_TEST_KEY` (or the name you registered) to a `sk_test_` or `rk_test_` key and forward webhooks with the Stripe CLI to the loopback API.

## Not done

- No live mode, live keys, live webhook endpoints or payouts to real accounts.
- No Stripe call observed: the adapter is checked against a contract double built from the documented object shapes. The Stripe API version is not pinned; the account default applies.
- No web UI; API and CLI only.
- No taxes, currency conversion (USD only), subscriptions, partial-refund pricing or customer accounts. `customer_ref` is an opaque studio reference.
- Invalid-signature deliveries create no durable records (ADR-0040). Public deployments still need proxy rate limits for inbound traffic.
