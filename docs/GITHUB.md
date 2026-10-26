# Scoped GitHub management (X04)

Accepted scope: [register #33–#35](../tracking/OWNER_DECISIONS_2026-10-20.md). No universal three-repository cap: users select access and creation/rate limits. Initial verification is one new private creator-agent- repository, existing repos explicitly selected by immutable ID, owner-approved merges. Exact account/grant remains pending.

X04 lets the studio create private repositories and do routine work in them (branches,
pushes, issues, pull requests, merges) under the same grants and admission as every
other action. It never touches a repository it did not create unless the owner lists
that repository by its immutable id.

Status: implemented and verified against a deterministic fixture GitHub and loopback
contract tests only. No live GitHub call has been made, no credential has been
configured and no repository has been created on github.com.

## Pieces

| Piece      | Where                                   | What it fixes                                                                                                                                       |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection | `github_connections`                    | One owner (login, immutable id, type), one credential reference, limits, required checks, included repositories. Status changes are audited.        |
| Repository | `github_repositories`                   | Managed repositories by immutable GitHub id and owner id; names follow renames. `active`, `access_lost` or `quarantined` (never used again).        |
| Operation  | `github_operations` (journal)           | The intent (parameters, intent hash, action type, admission) is written before any call; `dispatched` settles once to succeeded, failed or unknown. |
| Review     | `github_reviews` (immutable)            | Approve or request changes on one exact pull request head.                                                                                          |
| Delivery   | `github_webhook_deliveries` (immutable) | Every webhook, verified or not; verified ones apply once per `X-GitHub-Delivery`.                                                                   |
| Adapters   | `packages/broker/src/github.ts`         | `FixtureGitHub` (fixture workspaces and tests) and `LiveGitHub` (REST API version `2026-03-10` plus Git over HTTPS).                                |
| Service    | `packages/broker/src/github-service.ts` | Reads GitHub, asks the store to admit and journal the intent, makes exactly one call, settles it.                                                   |

## Rules the code enforces

- **Owner verified.** A connection is `unverified` until the credential's account
  (`GET /user` for a fine-grained token, `GET /app/installations/{id}` for an app) has
  the configured immutable id and type. A wrong owner is recorded and nothing else runs.
- **Credentials are references.** The connection names environment variables
  (`CREATOR_GITHUB_*`) on the API process. Secrets never enter the database, argv, the
  product repository's config or recorded output. There is no fallback to any other
  token, and no environment setting can point the credential at another host.
- **Live is off by default.** Real workspaces need `CREATOR_GITHUB=live` on the API
  process and an active, verified live connection. Fixture workspaces only accept
  fixture connections, and real workspaces only live ones.
- **Every mutation is admitted.** Each operation maps to an action type
  (`github.repo_create`, `github.write`, `github.workflow_change`, `github.merge`),
  all external effects, and is admitted for its run with the intent hash as `spec_hash`.
  Without a covering grant the run asks a person (or defers when autonomous) and
  nothing is sent.
- **Scope and limits.** Repository names need the connection's prefix, studio branches
  its branch prefix (and valid Git ref names). The connection caps repositories
  created (counting creations whose outcome is unknown), changes per hour and open
  studio pull requests per repository. Repositories are created private with
  `auto_init`; a repository that is or becomes public, or moves to another owner, is
  quarantined.
- **Pushes.** The server resolves the product's local repository (only a product of the
  same workspace), lists the paths that change, and refuses unless the remote branch is
  exactly at the stated base. Pushes never use force. Changing `.github/workflows/` or
  `.github/actions/` is `github.workflow_change`, which a `github.write` grant does not
  cover, and the app token then also needs the `workflows` permission.
- **Merges.** Allowed only when the pull request is open, its live head equals the
  reviewed head, the latest review of that head approves it and comes from someone other
  than whoever pushed that head through the studio, and every required check reported
  `success` on that exact head. The merge call sends `sha`, so a head that moves after
  the read is refused by GitHub (409). No required checks means no merges.
- **Unknown outcomes.** No answer, a timeout or a 5xx leaves the operation `unknown`.
  While unknown, the same operation (and any repository creation) is refused.
  `reconcile` reads GitHub (repository by name, branch head, issue by title, open pull
  request by head branch, pull request merge state) and records
  `reconciled_succeeded` or `reconciled_absent`; it never repeats the change. A process
  that died mid-call leaves `dispatched`; after two minutes it can be reconciled too.
- **Revocation and expiry.** A 401 marks the connection `credential_rejected`; the
  owner's revoke is final; a fine-grained token past its recorded expiry is refused
  before any call. A 404 on a managed repository marks it `access_lost`, as does a
  removal webhook. Re-verifying is the only way back (except after revoke).
- **Webhooks are evidence, never authority.** `POST /api/github/webhooks/{connection}`
  checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, constant-time compare)
  with the connection's secret, records every delivery and applies verified ones once.
  Only losses act: repositories removed from the installation, deleted, transferred or
  archived (`access_lost`), made public (`quarantined`), and installations deleted,
  suspended or authorizations revoked (`access_revoked`). Additions grant nothing.

## Endpoint-specific auth (checked October 19, 2026)

From docs.github.com (REST API version `2026-03-10`, the current version; `2022-11-28`
is supported until March 10, 2028):

| Operation              | Endpoint                                       | Fine-grained / installation permission           |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Create repository      | `POST /user/repos` or `POST /orgs/{org}/repos` | Administration (write) or Repository creation    |
| Read repository by id  | `GET /repositories/{id}`                       | Metadata (read)                                  |
| Create branch          | `POST /repos/{o}/{r}/git/refs`                 | Contents (write)                                 |
| Push                   | Git over HTTPS (`x-access-token` basic auth)   | Contents (write); Workflows (write) for workflow |
| Create issue           | `POST /repos/{o}/{r}/issues`                   | Issues (write)                                   |
| Open pull request      | `POST /repos/{o}/{r}/pulls`                    | Pull requests (write)                            |
| Read pull request      | `GET /repos/{o}/{r}/pulls/{n}`                 | Pull requests (read)                             |
| Check runs on a commit | `GET /repos/{o}/{r}/commits/{sha}/check-runs`  | Checks (read); not available to fine-grained PAT |
| Commit statuses        | `GET /repos/{o}/{r}/commits/{sha}/status`      | Commit statuses (read)                           |
| Merge (with `sha`)     | `PUT /repos/{o}/{r}/pulls/{n}/merge`           | Contents (write); 409 when the head moved        |
| Installation token     | `POST /app/installations/{id}/access_tokens`   | App JWT (RS256, `iss` = client id, ≤ 10 minutes) |

Fine-grained personal access tokens cannot call the Checks API, so with one the merge
gate sees commit statuses only; GitHub Actions results then show as missing and merges
are refused. A GitHub App installation reads both. Installation tokens are minted per
call for the one repository and the permissions that endpoint needs, and expire after an
hour. Sources: [pull requests](https://docs.github.com/en/rest/pulls/pulls),
[repositories](https://docs.github.com/en/rest/repos/repos),
[API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
[troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api),
[personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens),
[installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[app JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

## Commands

API under `/api/workspaces/{ws}/`: `github-connections` (GET, POST),
`github-connections/{id}` (GET), `…/verify`, `…/revoke` (POST), `…/deliveries` (GET),
`github-repositories` (GET), `github-operations` (GET, POST), `github-operations/{id}`
(GET), `…/reconcile` (POST), `github-reviews` (POST). Webhooks:
`POST /api/github/webhooks/{connection-id}`. The API listens on loopback only, so
GitHub deliveries need a local forwarder; none is set up.

CLI: `github-connect`, `github-connections`, `github-verify`, `github-revoke`,
`github-deliveries`, `github-repos`, `github-op`, `github-ops`, `github-reconcile`,
`github-review` (`pnpm cli` prints usage). An operation request:

```json
{
  "connection_id": "…",
  "run_id": "…",
  "task_id": null,
  "data_class": "synthetic",
  "justification": "Repository for the reviewed product.",
  "params": { "kind": "repo_create", "name": "ca-planner", "description": "" }
}
```

Other `params` kinds: `branch_create` (repository_id, branch, from_sha), `push`
(repository_id, branch, product_id, sha, base_sha), `issue_create`, `pr_open`
(head_branch, base_branch, title, body), `pr_merge` (pr_number, reviewed_head_sha,
merge_method `merge` or `squash`).

## Turning on live use (owner steps, not done)

1. Choose the credential: a GitHub App installed on selected repositories (recommended:
   it can read check runs and tokens are short-lived) or a fine-grained token limited to
   the owner and selected repositories, with an expiry.
2. Put the secret in the API process environment only, for example in PowerShell:
   `$env:CREATOR_GITHUB_TOKEN = "<token>"` and `$env:CREATOR_GITHUB = "live"`.
3. Register a `live` connection in a real workspace naming the owner's login and
   numeric id, run `pnpm cli github-verify`, then create the grants the runs need.

## Not covered

No live verification; releases, repository deletion, settings, secrets and branch
protection are not implemented (the adapter has no endpoint for them). Production
secrets and workflow changes stay separately controlled. Reconciling an issue or pull
request matches by title or head branch, so a look-alike created by hand in the same
minute would be adopted. The web studio's GitHub page (October 26, 2026) covers connections, verify,
revoke, deliveries, repositories, operations, reconcile and reviews through the same routes.
