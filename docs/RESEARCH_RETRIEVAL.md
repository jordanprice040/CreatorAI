# Real evidence retrieval (§2.5)

October 20, 2026. Implementation and contract verification are separate from live
qualification. The installed desktop bundle has not been rebuilt for this change.

## Adapter assessment and selection

The existing `SourceBroker` and `HttpFetchAdapter` provide approved-domain fetching,
DNS/address checks, redirect checks, bounded bytes/time, exact excerpt locators,
hashes and durable retrieval outcomes. Keep them. No runtime public-search adapter
existed: `FixtureAdapter` only returned synthetic links. The Firecrawl coding
connector/MCP is a separate development tool, not a studio runtime connection.

A disabled Brave Web Search adapter now supplies raw indexed discovery results.
It avoids a generated search summary and fits the existing one-request tool
reservation. This is a provisional implementation choice, not evidence that Brave
beats alternatives on coverage, fidelity or account cost. Before activation,
verify the owner's plan, machine-consumption/storage terms and current per-request
price. The official guide recommends LLM Context for machine consumption; do not
switch endpoints implicitly. If terms or measured quality make Web Search unsuitable,
keep it disabled and qualify a permitted alternative. No account or purchase was made.

Official contract checked October 20 through the coding connector:
[Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started),
including the endpoint, subscription header, count, operators and `web.results`
shape. No price or access entitlement is inferred from that documentation.

## Configuration and API

Default: `CREATOR_PUBLIC_SEARCH=off`. To configure an authorized candidate:

- `CREATOR_PUBLIC_SEARCH=brave`
- `CREATOR_BRAVE_SEARCH_API_KEY_FILE` points at a local protected secret file,
  resolved by the existing secret-file loader. Never place a key in tracked config.
- `CREATOR_SOURCE_FETCH=live` and `CREATOR_SOURCE_HOSTS` name the task's approved
  exact official/primary hosts. Hash-only host rules remain supported by fetching.
- Record a documented pricing snapshot for provider `brave`, model identifier
  `brave-web-search-v1`, supported action `tool.search_public`, and the verified
  `search_public` per-request rate in nano-USD. Token rates are zero for this
  request-priced endpoint; unknown request pricing blocks activation.
- Provide a covering run grant and funded envelope. The existing studio ceiling,
  parent limits, unknown-cost stop, study exclusions and human-only refusal apply.

Migration 25 adds Brave to pricing/reservation provider constraints. Only disposable
test databases were migrated. Back up the actual studio and use its approved upgrade
path before installation. Coordinate migration numbering with concurrent §2.4 work;
historical migrations must not be edited after application.

`POST /api/workspaces/{workspace}/runs/{run}/source-searches` accepts the existing
`BrokerCallRequest` shape with `action_type: "tool.search_public"`,
`tool: "search_public"`, `output_format: "json"`, and one user input message:

```json
{
  "role": "user",
  "text": "{\"query\":\"CSV data quality guidance\",\"domains\":[\"www.nist.gov\"]}"
}
```

The query plus domain operators is capped at 400 characters, 1–5 exact approved
domains, one page and ten results. Returned URLs must independently pass the source
policy and exact task domains; query operators alone are not an access boundary.
The broker durably binds the request, operation, grant, pricing and outcome. Search
output includes the sent query, retrieval time, provider endpoint, policy hash,
response hash, ranks and unverified snippets. Repeated operations do not redispatch.
Fixture workspaces use the visibly synthetic existing adapter; real workspaces
without configuration are denied, never substituted with fixtures.

Search has no authority to create verified passages. Fetch a selected URL separately
through `POST .../source-fetches`, then cite the stored version and exact locator.
Search results are untrusted data; they cannot invoke tools or change policy.

## Failure and cancellation

Requests forward the broker's abort signal and never follow provider redirects.
The response is capped at 1 MB. No automatic pagination or secondary enrichments
occur. HTTP errors (including 429), malformed/oversized responses, timeouts and
network loss are conservatively uncertain billing: exposure stays held pending
reconciliation. No no-charge guarantee is assumed. The broker owns bounded retries;
unknown outcomes do not retry automatically. Provider errors retain HTTP status.

Run/workflow cancellation also aborts active source retrievals in the serving API
process. An aborted retrieval records `run_cancelled`; an unexpected source adapter
exception records `adapter_error`. Cross-process/crash recovery retains the existing
stale-retrieval sweep and timeout bounds; this is not a distributed socket registry.

## Qualification still required

Prepare exact domains with each brief. Candidate CSV-checker research sources:
`www.nist.gov` for measurement/data guidance and `www.w3.org` for tabular-data
standards; narrow further to relevant pages. These are proposed allowlists, not
activated grants, proof of relevance or permission to retain third-party material.

After local/subscription verification, record a concrete bounded search/fetch grant,
account-specific pricing/terms, then run through the real authenticated application.
Record returned URLs, fetch statuses, source fidelity against exact passages,
coverage gaps, independent origins and actual/uncertain costs. Include inaccessible
and no-result cases. Promote only the checks actually observed. No paid dispatch,
live search, live source fetch, UI acceptance or readiness promotion occurred here.
