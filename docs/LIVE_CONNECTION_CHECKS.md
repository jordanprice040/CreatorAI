# Live connection checks (P22)

How the owner checks that the pay-per-use OpenAI API key route and the GitHub connection work
against the real services. Each live step needs the owner's typed OK first (plan P22). Results
are recorded, failures included, in [tracking/INTEGRATIONS.md](../tracking/INTEGRATIONS.md)
under "P22 live connection checks".

Secrets are set by the owner in the PowerShell window that starts the studio, and only there.
They never go into the repository, the database, a command line argument or a log. The studio
reads them from its own process environment (see [GITHUB.md](GITHUB.md) and
`packages/broker/src/env.ts`).

## API key route: Test connection

What it is: Models and connections › Other routes › **Test connection**. It sends one request,
"Reply with exactly: ok", with at most 256 output tokens, to the model the API process is set up
with (`gpt-6-astra` unless `CREATOR_OPENAI_MODEL` says otherwise). It runs through the same
broker as every paid call:

1. A run titled "API key connection check · <date>" is recorded and registered.
2. One grant on that run: `model.generate`, synthetic data, at most $0.05, ending after 30 minutes.
3. A $0.05 run budget is lent by the newest active budget that has room (Monitor › Budgets).
4. The one call. The overall ceiling (config/spending.json, $20 unless changed in Settings), any
   spend limits, the grant and the budget all have to admit it, or nothing is sent.
5. The run budget is closed (its unspent part goes back), the grant is revoked and the run is
   cancelled. A call whose outcome is unknown keeps its reservation, so that budget stays open
   until it is reconciled on Monitor › Budgets.

The result shows the reply, the cost from the documented price (not an invoice) and the time.
Earlier checks are listed under it. At the documented price the call costs well under one cent.

Owner steps:

1. An OpenAI platform account (platform.openai.com) with an API key and prepaid credit. This is
   separate from the ChatGPT plan.
2. Since P28 (ADR-0093): in the real workspace, Models and connections › Other routes › **Your
   OpenAI API key**, paste the key and press **Save key**. The studio seals it in Windows'
   protected storage for your account; only its last four characters are shown again. **Replace
   key…** and **Remove key…** are beside it. Removing it does not revoke it at OpenAI; do that on
   the OpenAI dashboard.

   The older way still works and wins over a saved key: in the PowerShell window that starts the
   dev studio, before starting it,

   ```powershell
   $env:CREATOR_LIVE_PROVIDER = 'openai'
   $env:OPENAI_API_KEY = Read-Host 'OpenAI API key'
   ```

   `Read-Host` keeps the key out of the shell history file.

3. In the real workspace: fund a budget with at least $0.05 on Monitor › Budgets if none has room,
   add the documented price when the check offers it, then **Test connection…** › **Send one paid
   request**.

To turn the route off again, remove the saved key, and start the studio without
`CREATOR_LIVE_PROVIDER` if it was set.

The plan routes (ChatGPT plan, Claude Code) keep their own check on the same page: "One approved
model check" sends one plan request at no per-request charge.

## GitHub: scoped trial on one repository

The owner chose (November 10, 2026) a fine-grained token limited to one repository the owner
creates, so the token cannot reach any other repository. The studio lists that repository by its
immutable id; it does not create repositories in this trial.

Owner steps:

1. Create a private repository `creator-agent-p22-trial` with a README (so it has `main`).
2. Create a fine-grained token: expiry 7 days; repository access "Only select repositories" with
   just that repository; permissions Contents read and write, Pull requests read and write,
   Commit statuses read (Metadata read is added automatically).
3. In the studio's PowerShell window, before starting it:

   ```powershell
   $env:CREATOR_GITHUB = 'live'
   $env:CREATOR_GITHUB_TOKEN = Read-Host 'GitHub token'
   ```

4. Integrations › GitHub: add a live connection with the owner's login and numeric id, the
   fine-grained token named `CREATOR_GITHUB_TOKEN` with its expiry, repository prefix
   `creator-agent-`, branch prefix `creator/`, and the trial repository listed by its numeric id.
   Verify it.
5. One run with a `github.write` grant (synthetic data) for the trial's changes.

Trial steps, each an operation on Integrations › GitHub (or `pnpm cli github-op`):

1. Push a product commit to a new branch `creator/p22-base` (no base).
2. Create branch `creator/p22-trial` from that commit.
3. Push a later commit of the same product to `creator/p22-trial` with the first commit as base.
4. Open a pull request from `creator/p22-trial` into `creator/p22-base`.
5. Read its checks: the repository's **Read its checks** form (or `pnpm cli github-checks <ws>
<repository-id> <pr>`). This read is read-only and journals nothing. A read GitHub refuses (expired or revoked token, rate limit, 5xx) is shown as a refusal with its status, never as "no pull request" or "no checks".

The product's history is unrelated to the README commit on `main`, so the pull request goes
between two studio branches. With a fine-grained token GitHub shows commit statuses only, not
check runs; and while the account's GitHub Actions minutes are used up, no workflow runs at all.
Either way the read records what GitHub reported. Nothing is merged unless the owner approves
the exact head.

Afterwards: revoke the connection in the studio, delete the token on GitHub, and keep or delete
the trial repository (the studio never deletes repositories).

Follow-up recorded at the owner's request (November 10): once the rest of the GitHub work is
working, a separate trial with a token that can create repositories (studio-created
`creator-agent-` repository), with its own OK.

## GitHub App from the studio (P32, ADR-0132): live trial plan

Needs Jordan's typed OK in the thread, on the dev studio (`CREATOR_GITHUB=live`; the installed app
does not turn live GitHub on), with a new private test repository. Nothing is spent. Run the checks
in this order and record each pass or fail in ADR-0132 and here:

1. **GitHub accepts the manifest** (review L-5): pressing Create the GitHub App reaches GitHub's
   "Create GitHub App" page, GitHub creates the app with **no webhook**, and the browser comes back
   to `http://127.0.0.1:<port>/github-app/created`. If GitHub refuses the manifest, press Stop this
   setup, note GitHub's words, and switch the manifest to the prepared fallback
   `hook_attributes: { url: "https://github.com", active: false }` (an inactive webhook; nothing is
   ever delivered).
2. **Installation found**: install on "Only select repositories"; the page shows "installed"
   without a reload (or after Check installation).
3. **Repository creation on the personal account first** (review M-2): add the connection,
   Verify, then one `repo_create` (`creator-agent-p32-trial`). If GitHub answers 403 the operation
   says "GitHub does not let this app create repositories on a personal account…": create the
   repository on GitHub, add it to the installation, and list it on a new connection instead.
   Record which happened.
4. **The new repository is visible to the installation**: read it by id (`github-repos`, or the
   checks read). With a "selected repositories" installation, a repository the app created may not
   be added automatically; record whether it was.
5. Branch, push, pull request, and a checks read on the pull request (check runs readable).
6. Revoke the connection (the app key is deleted from this computer), then delete the app on
   GitHub › Settings › Developer settings › GitHub Apps.
