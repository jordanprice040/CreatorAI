# X08 campaigns and measured fixture feedback

Implemented October 19, 2026, on `codex/x08-marketing`, from merged main
`0dfc6e6`. This is a local review and test-delivery feature. Nothing is published
and no real recipient, advertising provider, email service or payment service is
contacted. No credentials are needed for its fixture gate.

## Review a campaign

After the normal local setup and database migrations, sign in, select a workspace
and open **Campaigns** (`#/marketing?ws=<workspace-id>`). Select a current verified
artifact. Supply intended audience, audience provenance, synthetic `test:` IDs,
an experiment hypothesis, feedback threshold and optional price hypothesis in
USD cents. The API also supports `demo_completed` as an outcome metric.

The generator deliberately uses a closed factual vocabulary: recorded package
checks, exact commit, check locator, execution ID, input hash and manifest hash.
It retains limitations, labels synthetic verification, and supplies recorded
demonstration input/output recipes. It does not run a new demo or infer utility,
demand, testimonials, willingness to pay or production readiness. The landing
page is reviewable text, not a hosted page. Audience descriptions and experiment
hypotheses are owner assertions, not independently verified market research.
Pricing is an unvalidated hypothesis, not an offer or checkout.

Campaign content and experiment conditions are immutable. Changes require a new
draft and new grant. Only a human workspace owner can draft, grant or deliver.
A grant binds the entire content/request hash, including exact audience,
artifact/manifest, channel, metric, threshold, hypothesis and zero-dollar budget.
It has a delivery cap and an expiry no more than 30 days away. The screen offers
a 24-hour grant; the API accepts an explicit expiry. Covered deliveries do not
ask for another approval. Cancellation/revocation, expiry, current artifact/spec
and suppression are checked again at the local adapter's acceptance boundary.

## Delivery and reconciliation

`local_fixture` is the only channel. Addresses, credentials, paid budgets,
arbitrary claim text and live channels are rejected by strict contracts. The
fixture sink writes an immutable native receipt in PostgreSQL. Its adapter
spend is exactly zero; host compute remains unmetered, not a zero total cost
claim. Paid advertising is unavailable.

Admission persists intent and conservatively consumes one grant slot before the
adapter. Concurrent requests for the same campaign/recipient share one delivery,
even with another grant or simulated outcome. Failed, suppressed, dispatching and
unknown deliveries are never automatically retried. To try changed content, create
and explicitly authorize a new campaign; workspace suppression still applies.

`unknown_after_accept` simulates a lost acknowledgement. Reconciliation reads the
fixture native receipt and never dispatches again. If the process stopped before
the local adapter transaction committed, no native receipt definitively means no
local acceptance. Reconciliation closes that intent as failed and fences a late
dispatcher. This conclusion is specific to the transactional local adapter; it
is **not** a reconciliation protocol for an external provider. Any future real
adapter needs supported native identity/status lookup, bounded exposure and
separate activation authority.

Suppression/opt-out is workspace-wide and retained across campaigns. The current
test channel records it through the owner API or screen; there is no public
unsubscribe endpoint or real mailing list. Suppression cannot be removed through
this feature. A delivery already accepted before opt-out remains in history.

## Outcomes

Record a manual, explicitly synthetic observation only against an acknowledged
fixture delivery and the campaign's frozen metric. Stable event keys and one
metric observation per delivery prevent double counting. Replaying an identical
observation returns the original; changing it under the same identity is refused.
The read model exposes delivered count, distinct observed count and the frozen
threshold without declaring real demand or statistical significance. The stop
rule is explanatory; executable bounds are grant cap/expiry, exact audience,
once-per-recipient delivery and owner cancellation. No autonomous experiment loop
or pricing optimizer is enabled.

## API and CLI

All routes use the existing authenticated workspace API and CSRF checks:

| Method/path under `/api/workspaces/:ws`  | Purpose                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| GET/POST `marketing-campaigns`           | List / create immutable draft                                                       |
| GET `marketing-campaigns/:id`            | Complete review, evidence status, grants, delivery and measurement history          |
| POST `marketing-campaigns/:id/grant`     | `content_hash`, `expires_at`, `max_deliveries`, `budget_nano_usd: "0"`, `rationale` |
| POST `marketing-campaigns/:id/deliver`   | `grant_id`, `recipient`, `simulation`                                               |
| POST `marketing-campaigns/:id/reconcile` | `delivery_id`                                                                       |
| POST `marketing-campaigns/:id/observe`   | `delivery_id`, `event_key`, `metric`, `note`                                        |
| POST `marketing-campaigns/:id/cancel`    | `reason`                                                                            |
| POST `marketing-campaigns/:id/revoke`    | `grant_id`, `reason`                                                                |
| POST `marketing-suppressions`            | `recipient`, `reason`                                                               |

CLI: `marketing-list <ws>`, `marketing-get <ws> <id>`,
`marketing-draft <ws> <json-or-file>`, `marketing-suppress <ws> <json-or-file>`,
`marketing-action <ws> <id> <grant|cancel|revoke|deliver|reconcile|observe> <json-or-file>`.
The strict request definitions are in `packages/contracts/src/marketing.ts`.

## Coordination and evidence

Claude owns the existing UI/UX redesign. X08 adds `apps/web/src/marketing.tsx` and
only a component import/switch case in `main.tsx` and a view tuple in `ui.tsx`.
It changes no shared CSS, component props, existing view keys or native Rust.
Reapply these small navigation additions when integrating Claude's branch; use
Claude's semantic tokens/components for subsequent visual alignment.

Migration 21 creates campaign, grant, suppression, intent, native fixture receipt
and observation tables. Existing artifact history is immutable. Tests use an
explicitly labelled synthetic manifest insertion seam, not actual product QA.
The existing T13 execution/package gates remain separate.

Executed checks and screenshots are in `tracking/evidence/x08`. Initial fixture
failures are retained: an attempted manifest update was rejected, then an empty
older test manifest broke artifact listing. The final test helper inserts a full
manifest at creation without weakening immutability. A required nullable revision
field was also corrected in a test. Narrow-screen hash overflow was reproduced
and repaired locally in the new component. No native, hosted, live delivery,
customer research or paid-service verification is claimed.
