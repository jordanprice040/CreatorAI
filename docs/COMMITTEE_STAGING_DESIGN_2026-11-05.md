# Committee staging: design and costed options (P11, November 5, 2026)

Purpose: let Jordan's thesis committee try Creator Agent through a private web address, each
person in their own workspace (revision R14). This document is the P11 design step. It
deploys nothing, creates no account and spends nothing. Accepted owner decisions #44–#46
still apply. The committee use case is the concrete need #44 asked for. The provider, account,
domain, region, sign-in provider, spending caps and retention are all still **unset** (#45, #46),
and this document does not choose them. Section 6 lists them as decisions for Jordan, with
options.

Prices below were read on November 5, 2026 from the providers' own pricing pages where
possible, and are marked otherwise. Prices change often. Recheck them at the decision.

## 1. What already exists (X06)

From `docs/HOSTED_OPERATION.md`, `deploy/hosted/` and the API source:

- A hosted mode with `test`, `staging` and `live` environments. The API refuses to start
  without HTTPS origins, a preview host separate from the studio host, a full build commit, a
  metrics token, OIDC with secure cookies, and a remote database with `sslmode=verify-full`.
- `deploy/hosted/`: one Docker image (API, workflow worker, migration runner), a Compose stack
  per environment, a Caddy proxy with separate studio and preview hosts, and example env files.
  The Compose stack expects a **managed PostgreSQL outside the stack**. It has never been built
  or run on real infrastructure.
- Readiness, a read-only smoke check, owner-recorded verification bound to commit, config and
  schema, Prometheus metrics, alert rules (delivery fixed to `none`), backup/restore with exact
  totals, a restore drill, environment labels that refuse a database from another environment,
  and expired sign-in cleanup.
- A hosted studio refuses to open a terminal (`apps/api/src/artifacts.ts:284`, "Download the
  package instead").

## 2. Gaps that block committee testing

These were found by reading the current code. Each must be closed before a useful committee
release. None needs an owner decision to _build_. Some need one to _turn on_.

| #   | Gap                                   | Evidence                                                                                                                                                                                                                                             | Work                                                                                                                                                                                                                                                           |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Only one person can sign in**       | OIDC accepts exactly one subject, `CREATOR_OIDC_OWNER_SUBJECT`, and refuses everyone else ("This identity is not the workspace owner", `apps/api/src/auth.ts:237`). Every session is created for the one owner actor (`ownerId`, `auth.ts:180,242`). | Tester accounts: an owner-managed allow-list of (issuer, subject) pairs, each mapped to its own actor, with a role and an expiry. Sessions bind to that actor. Needs a migration and an ADR (next free numbers at the time). Testers never get Jordan's actor. |
| G2  | No tester workspace seed or reset     | Seeds exist for development (`seed-lineage`, `seed-discovery`, `seed-selection`), not per tester.                                                                                                                                                    | `ops` commands to create a tester's workspace from public or synthetic examples, reset it, and remove it, all audited. Never copy Jordan's studio database, files or credentials.                                                                              |
| G3  | **Builds cannot run on a Linux host** | The only reviewed isolation backend is `wsl2-bwrap-systemd` and needs Windows plus WSL2 (`packages/executor/src/execution.ts:44,343`).                                                                                                               | First release: builds off and labelled. Later: a reviewed Linux execution backend on a separate worker machine (a P15-sized design with its own security review), or a paired worker (see D7).                                                                 |
| G4  | No model route testers may use        | Plan connections are Jordan's personal ChatGPT and Claude logins (ADR-0050, ADR-0057). The plan forbids routing others' requests through them. There is no per-user API-key storage.                                                                 | Pick a route at D6. Until then: sample mode (no model calls) with a visible label.                                                                                                                                                                             |
| G5  | Per-tester limits                     | Spending and caps are per workspace and owner (ADR-0043, ADR-0062). There is no hosted per-account request quota.                                                                                                                                    | Per-tester request and money caps enforced by the existing budget broker, set by Jordan at D5.                                                                                                                                                                 |
| G6  | Release-scope switches                | Commerce, campaigns, GitHub and terminals have their own off states. There is no single "committee review" profile.                                                                                                                                  | One hosted profile that forces off public sign-up, payments, campaigns, GitHub mutations, terminals and (first release) builds, shown in the UI as "Not available in this review build".                                                                       |

## 3. Release scopes (smallest first)

| Scope            | Testers can                                                                                                        | Needs                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| R0 Sample review | Sign in; browse a seeded sample workspace (records, scores, specs, a packaged example); notes; read-only chat help | G1, G2, G6, hosting, sign-in provider           |
| R1 Discovery     | R0, plus submit their own discovery and chat answers through a model route within caps                             | R0, plus G4 (route chosen), G5 (caps)           |
| R2 Builds        | R1, plus build and preview the bounded Python CLI recipe                                                           | R1, plus G3 (hosted execution backend reviewed) |

The plan allows releasing R0 or R1 early, labelled honestly, without waiting for P13–P15.
Files (P05) and the guided start (P04) make a review build much more useful, so their state
when the deploy happens matters.

## 4. Hosting options and monthly cost

Sizing for staging (a handful of testers): one machine with about 2 vCPU and 4 GB RAM for
the API, worker and proxy (the Compose file caps the API at 1 GB and the proxy at 256 MB); a small
managed PostgreSQL 18; about 10–20 GB of durable storage for products and backups; one domain.

| Option                                        | What runs where                                                    | Fit with `deploy/hosted/` as written                                                                                                                                                      | Estimated monthly cost (USD unless noted)                                                                                                                                                                 | Source and caveats                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. VM + managed PostgreSQL** (DigitalOcean) | The Compose stack on one Droplet; DigitalOcean Managed PostgreSQL  | **Closest.** Runs the reviewed Compose and Caddy files unchanged; the API and worker share the `products` volume on one machine.                                                          | Droplet 4 GiB/2 vCPU **$24** + weekly backups (20%) **$4.80** + Managed PostgreSQL single node 1 GiB **$15** ≈ **$44**                                                                                    | digitalocean.com/pricing/droplets; docs.digitalocean.com PostgreSQL pricing. Included database storage and point-in-time recovery for the $15 plan were not shown on the page read. Confirm PostgreSQL 18 availability.                                                      |
| **B. VM with self-run PostgreSQL** (Hetzner)  | Compose stack plus PostgreSQL on one VM                            | Needs a reviewed change: the stack has no database service, and the API's rule for a database off the machine needs `verify-full` TLS. Backups, upgrades and restore become Jordan's job. | VM "Regular Performance" **from €6.49** (excl. VAT) + IPv4 + backups ≈ **€10–25**, depending on size                                                                                                      | hetzner.com/cloud shows only "from" prices. Third-party reports describe 2026 price rises of up to about 176% on some lines, and some plans show "currently not available". US sites are Ashburn and Hillsboro. No managed PostgreSQL offer was found. Least certain option. |
| **C. Managed platform** (Render)              | API web service, worker service, managed Postgres, static site     | Needs changes: a disk attaches to one service only, but API and worker share product files today. The preview server needs its own public host (Render exposes one port per web service). | API 1 CPU/2 GB **$25** + worker 512 MB **$7** + Postgres 1 GB **$19** + disk 10 GB **$2.50**, Hobby workspace $0 ≈ **$54** (Pro workspace +$25)                                                           | render.com/pricing. Bandwidth: 5 GB included on Hobby, then $0.15/GB. Combining API and worker into one service would avoid the shared-disk problem.                                                                                                                         |
| **D. Machines platform** (Fly.io)             | One machine running API and worker, a volume, Fly Managed Postgres | Needs changes: a volume attaches to one machine (run API and worker together). Separate preview host through a second app or the proxy.                                                   | 2 GB shared machine ≈ **$11–13** (from $2.19 for 256 MB plus $6.00 per extra GB) + volume 10 GB **$1.50** + Managed Postgres Basic **$38** + storage 10 GB **$2.80** + dedicated IPv4 **$2** ≈ **$56–58** | fly.io/pricing (Ashburn). The machine figure is derived from the page's per-GB add-on, not a listed price.                                                                                                                                                                   |
| E. Usage-billed platform (Railway)            | Services plus Postgres                                             | Similar changes to C and D.                                                                                                                                                               | Hobby **$5** including $5 of usage; RAM about $10/GB-month per third-party sources. Likely **$25–45**                                                                                                     | The official rate table was not confirmed (sources conflict on volume price). Treat as unverified.                                                                                                                                                                           |

Common to all: a domain, about $10–20 a year at most registrars (typical price, not
checked). Both hosts can live on one domain as siblings (for example `studio.` and `previews.`),
because the API refuses a preview host equal to, above or below the studio host and the session
cookie is `__Host-` host-only. A second registrable domain for previews gives stronger
separation (different site for SameSite purposes) for another domain fee. Egress at committee
scale is negligible on all five.

Option A runs the configuration that was already reviewed with the fewest changes. B is
cheapest but moves database operations to Jordan. C–E trade Compose for platform services and
need the deployment adapted. Choosing is Jordan's decision (D1).

## 5. Sign-in provider options (OIDC)

The API speaks standard OIDC (authorization code plus PKCE). Any of these works once G1 is
built. Each tester needs an account with the chosen provider.

| Provider                    | Cost at committee scale                      | Notes                                                                                              |
| --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth0 Free                  | $0, up to 25,000 monthly active users        | 1 custom domain (card verification needed), unlimited social logins. auth0.com/pricing.            |
| Microsoft Entra External ID | $0 for the first 50,000 monthly active users | Premium add-ons (for example SMS) are billed separately. learn.microsoft.com, External ID pricing. |
| Google as the OIDC provider | $0                                           | Testers sign in with Google accounts. Needs a Google Cloud OAuth client and consent screen.        |
| University single sign-on   | Unknown                                      | Only if the university lets a student register an app. Its own approval process applies.           |
| Self-hosted Keycloak        | Hosting only                                 | Another service to run, patch and back up. Not recommended for a short committee window.           |

## 6. Decisions for Jordan

None of these is made. Each lists options. Nothing is purchased or created until Jordan
records the choice.

| #   | Decision                              | Options                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Hosting provider and account          | A–E above, or another provider compared the same way.                                                                                                                                                                                                                                                     |
| D2  | Region                                | Nearest to the committee (for example a US East site), subject to the provider's PostgreSQL 18 availability.                                                                                                                                                                                              |
| D3  | Domain and host names                 | One domain with sibling hosts, or a second domain for previews.                                                                                                                                                                                                                                           |
| D4  | Sign-in provider                      | Section 5.                                                                                                                                                                                                                                                                                                |
| D5  | Hosted caps (#46)                     | Monthly hosting ceiling; per-tester request and dollar caps; whether hosted model spend counts inside the existing $20 runtime ceiling (`config/spending.json`) or gets its own.                                                                                                                          |
| D6  | Tester model route                    | (a) None: R0 sample review only. (b) A server API key Jordan funds, metered by the broker with per-tester caps. (c) Testers bring their own API key (needs per-user credential storage, not built). Never Jordan's personal ChatGPT or Claude plan logins.                                                |
| D7  | Builds for testers (R2)               | (a) Not in the committee release. (b) A reviewed Linux execution worker in the hosted environment (build first, then security review). (c) Builds run on a paired worker on Jordan's PC: generated code from testers' specs would run on his machine inside the WSL2 sandbox. Needs an explicit decision. |
| D8  | Retention and alert destination (#46) | How long tester workspaces, sessions and backups are kept after the review; where alerts go (today `none`; sending anywhere is an outbound integration of its own).                                                                                                                                       |
| D9  | Release scope and window              | R0, R1 or R2 (section 3), start date, end date and shutdown.                                                                                                                                                                                                                                              |

Rough model cost for D5/D6, from the documented GPT-6 Astra price in
`config/pricing/openai-gpt-6-astra.json` ($10 per million input tokens and $50 per million
output tokens, retrieved October 18; recheck): a request near the 64,000-character input cap
(about 16,000 tokens) with about 2,000 output tokens costs about $0.26. A discovery run of
about 7 requests (pilot day 1) is then about **$1.80**, and a short chat answer a few cents. Five
testers doing three discovery runs each would be about $27, more than the whole current $20
runtime ceiling. These are estimates from token counts, not measured bills.

Inviting committee members is a separate outbound message and is not part of P11.

## 7. Work that can start before the decisions

Each item below is reversible and needs no account. Together they make the deploy-ready package.

1. **Tester accounts (G1):** allow-list, actor mapping, roles, expiry, cross-account denial tests.
2. **Seed, reset and remove (G2):** `ops` commands with synthetic or public examples. A test that a
   tester can't read another tester's workspace or Jordan's.
3. **Committee profile (G6):** one switch that turns off sign-up, payments, campaigns, GitHub
   mutations, terminals and builds, and shows the "not available in this review build" label.
   Sample mode for D6(a).
4. **Per-tester quotas (G5):** reuse the budget broker and connection caps, with tests at the cap
   and cap + 1.
5. **Local rehearsal:** run the Compose stack on loopback with a stand-in OIDC issuer, the smoke
   check, a backup and a restore drill into an empty database, and a reset.
6. **Provider adapter, after D1:** for option A, the existing files plus a provisioning checklist.
   For C–E, a reviewed variant that runs API and worker in one service.
7. **Tester guide and support list:** what works, what is turned off and why, how to report a
   problem, and the review window.

## 8. Deploy and verification gate (after the decisions)

Deploy the reviewed candidate only, then verify and record each point:

- HTTPS on both hosts; OIDC sign-in for an allow-listed tester; refusal for a non-listed account.
- Cross-account denial: tester A cannot read B's workspace, notes or files, or Jordan's.
- Previews served only from the preview host; the studio cookie never reaches it.
- Persistence across an API and worker restart; product storage writable; readiness `ok`.
- Quotas refuse at the cap; disabled features refuse server-side, not just in the UI.
- Backup, restore drill into a fresh database, environment relabel, smoke check, and the
  owner-recorded verification (`POST /api/ops/verifications`).
- Reset and shutdown procedure rehearsed; retention cleanup dry run.

The outcome is either a verified private URL with tester instructions, or a deploy-ready
package plus the exact missing decisions. The second is not a hosted app and must not be
reported as one.

## Sources read November 5, 2026

- DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets
- DigitalOcean Managed PostgreSQL pricing: https://docs.digitalocean.com/products/databases/postgresql/details/pricing/
- Hetzner Cloud: https://www.hetzner.com/cloud (third-party reports on the 2026 changes: https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)
- Render pricing: https://render.com/pricing
- Fly.io pricing: https://fly.io/pricing
- Railway plans: https://docs.railway.com/pricing/plans (rates not confirmed)
- Auth0 pricing: https://auth0.com/pricing
- Microsoft Entra External ID pricing: https://learn.microsoft.com/en-gb/entra/external-id/external-identities-pricing
