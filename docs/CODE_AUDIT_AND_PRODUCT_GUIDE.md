# Creator Agent product guide — November 15, 2026

Use [current implementation and verification](CURRENT_STATUS.md) for capability boundaries and
[build status](../tracking/BUILD_STATUS.md) for what was checked and when. The
[October 18 guide/audit](CODE_AUDIT_AND_PRODUCT_GUIDE_HISTORY_2026-11-04.md) and the
[November 4 audit](CODEBASE_AUDIT_2026-11-04.md) are historical.

## Finding your way

The left nav has seven pages. **Chat** answers what's next, why something is blocked and, with a
plan connection, open questions; a step can also be done there as a card. **Projects** holds the
path from evidence to a product, one tab per step. **Autopilot** takes those steps for you and
stops where a person must decide. **Sources** holds pages, claims, the library, files and search.
**Monitor** shows what runs, what waits for you, activity and budgets. **Models and connections**
and **Settings** hold access and owner settings.

The **Next** banner at the top of each page names the one step that moves the main path on and
links to it. Standard view (the default) folds routine settings behind their defaults and shows
amounts in cents; Advanced view, at the foot of the nav, lists every tab and shows exact amounts
and ids. Both send the same requests and the server checks them the same way.

## Everyday path

1. Start the web studio using [local development](LOCAL_DEVELOPMENT.md), or open the installed
   Windows app. Sign in and choose the workspace. Fixture workspaces are visibly synthetic.
2. In **Models and connections**, add a ChatGPT plan or Claude Code connection (or, in the
   desktop app, a workspace's own OpenAI API key), review its caps and allowed work, and
   qualify it for each kind of task. Qualify a model runs several tasks one after another. A
   connection's settings can be copied to another workspace; nothing it earned comes along.
   When a daily cap runs out, the owner can add extra requests for 24 hours.
3. Record evidence under **Sources**: fetch a page from an approved site and cite a passage in a
   claim. **Projects › Discover › Search the web** finds new pages through the plan's own web
   search; the studio fetches them and drafts claims only from quotes it finds on the page. A
   typed theme is not evidence.
4. On **Discover**, start from claims (Explore for me), a short brief, or the web. Discoveries
   and what to do when one stops show on Discover and Decide.
5. On **Decide**, read every option against the same evidence, link claims to options, assess
   automatically or score by hand, confirm ethics and access in the gate checklist, and record a
   selection. Existing tools, process changes, human-led action and defer/decline remain
   legitimate outcomes. A non-code choice goes to **Proposals**, where missing sections can be
   drafted for you to check.
6. For a software choice, write or draft the spec under **Build** (a qualified model can draft
   it and its cases; you check them), freeze it under **Scores and specs**, add the humility
   review, then build. The build runs in the isolated worker with independent review and QA; a
   verified build is packaged and opened under **Try**. A larger Python build is labelled an
   unqualified trial unless its roles passed the larger benchmark.
7. Or open **Autopilot**: choose the model and limits, read both summaries, and start. It takes
   the steps with routine approvals made for that run only, and stops with a reason and a next
   step when a person must decide; Continue picks it up again. How much is automated and the
   autopilot settings are on the same page.
8. Use **Monitor** for what waits for you (Approvals), activity, budgets and recovery. Unknown
   requests and costs need reconciliation; retrying is not evidence that the earlier action did
   not happen.

Windows desktop, scoped GitHub, hosted, test-mode payments and campaign code exists, with
differing fixture, contract, native and live evidence. None is activated simply by reading this
guide. See [the completion runbook](COMPLETION_RUNBOOK.md) for remaining acceptance and
additions.
