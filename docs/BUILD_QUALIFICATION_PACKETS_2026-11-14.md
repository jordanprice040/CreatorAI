# Build qualification packets — installed app and Claude route (November 14, 2026)

ADR-0105 (B1). Nothing here has run. **Each live step needs Jordan's typed OK in the B1 thread
first.** All of it is $0 on the plans (ChatGPT plan credits off; Claude Code extra usage off) and
uses synthetic data only. The runtime ceiling stays $20 and none of it is spent here.

## What has to be true first

1. The app runs a build that includes ADR-0105 (schema 65). The installed app is on 5809f09
   (schema 62) today: after this PR merges, install the new build the usual way (Jordan installs it
   himself; back up the data home first, as for every upgrade).
2. The connection is signed in, its credits/extra-usage statement is saved, its caps are accepted,
   and it allows **code build** and **independent review** with **synthetic** data (new connections
   do by default, ADR-0084).
3. The model is verified on the connection (Models › Approved model check).
4. The WSL2 worker is ready, with the pinned Chrome for the web benchmark (STATIC_WEB_RECIPE.md
   section 6). Without it a web attempt stops as "the worker did not finish" and is replaced once,
   then the qualification stops; nothing is judged.

## Packet A — installed app, ChatGPT plan connection (GPT-6 Astra)

| Step                                                                                          | Where                               | Requests (typical / most) |
| --------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| A1. Builder qualification `t12-builder-v1`, if not already qualified under the current prompt | Models › Qualify a model for a task | 4 / 4                     |
| A2. Reviewer qualification `t12-reviewer-v2`, same                                            | same                                | 4 / 4                     |
| A3. Web page benchmark `p15-small-signup-v5`, 3 builds                                        | Models › Qualify building           | 6 / 24                    |
| A4. Larger Python benchmark `p14-larger-ledgercheck-v5`, 3 builds                             | same                                | 6 / 36                    |
| A5 (optional). Small Python benchmark `p14-small-wordtally-v5`                                | same                                | 6 / 24                    |

Totals: about 20 plan requests typical (26 with A5); at most 68 (92 with A5). The connection's daily
cap is 100, and the studio refuses a request past it instead of spending. A3 is what lifts the
"unqualified trial" label from web builds on this connection, this model and today's prompts. A4
and A5 are evidence that the build path works on this connection at both scales; Python builds carry
no trial label today.

Each "most" assumes every attempt uses its full request cap and each is replaced once after an
infrastructure stop (a request that got no answer: network, provider, rate or usage limit, sign-in,
timeout). An answer the role itself caused to fail (too long, out of turns, a different model, the model refused) fails
the attempt and is not replaced. A failed attempt ends the qualification at once, so
a model that fails spends less.

## Packet H — the Claude route (local, unmodified `claude -p`, ADR-0050)

Jordan's decision H: qualify the Claude route as builder and reviewer.

| Step                                                                     | Where                               | Requests (typical / most) |
| ------------------------------------------------------------------------ | ----------------------------------- | ------------------------- |
| H1. Builder qualification `t12-builder-v1` on the Claude Code connection | Models › Qualify a model for a task | 4 / 4                     |
| H2. Reviewer qualification `t12-reviewer-v2`                             | same                                | 4 / 4                     |
| H3. Web page benchmark `p15-small-signup-v5`, 3 builds                   | Models › Qualify building           | 6 / 24                    |
| H4. Larger Python benchmark `p14-larger-ledgercheck-v5`, 3 builds        | same                                | 6 / 36                    |

About 20 Claude plan requests typical, at most 68. They count against the Claude subscription's own
limits; with extra usage off nothing is billed. Only the owner's own signed-in `claude -p` on the
studio's computer is used; no API key and no other route.

Known risk: the v5 benchmarks freeze a 120-second limit per builder or reviewer request (the same as
the November 6 runs). The Claude Code connection allows 180 seconds. A Claude answer that takes
longer than 120 seconds is cut off with an unknown outcome. That attempt ends without a verdict,
and the studio then stops the qualification as **stopped**, never as a failure of the model,
because no further request is admitted on the connection until the unknown one is reconciled
(Models › the connection). It does not spend the replacement on a request that would be refused.
If that happens, the fix is a new benchmark version with a longer limit, decided before any further
run. (Review 1 M-1: before this fix, the refused replacement was recorded as a failed attempt.)

Before every attempt and replacement the studio checks the connection first: a lost sign-in or
another connection refusal, a connection that no longer allows both build roles or synthetic data,
an earlier request with an unknown outcome, a request running past its time limit, or a daily cap
without room for a build (2 requests) stops the qualification as stopped with the reason; another
request still running makes it wait and look again 15 seconds later. Start is refused while a
request with an unknown outcome is open, the sign-in is lost, or the input cap is too small.

**Keep the connection free while a packet runs:** no chat, autopilot or model check on it. The
connection takes one request at a time. During an attempt, a role request waits up to 4 minutes
for another request to finish; a longer wait ends the attempt without a verdict (it is replaced
once). Don't change the connection's per-request input cap during a packet either: Start records it
and refuses a cap too small for the benchmark's first builder request, and a cap lowered during the
run stops it. A request refused because the roles' own output made its input larger than the
recorded cap fails the attempt, and so does a refusal to serve the model asked for, on either
route.

## What to record

The studio records everything itself: each attempt's requests, repairs, pass bars with their detail,
package hashes and extended-case counts, and the qualification's state and reason (Models › Qualify
building › Show attempts). After each packet, the thread copies the records into
`tracking/evidence/recipe-qualifications/` and notes them in BUILD_STATUS.md.

## How to run it

Either Jordan presses **Qualify building** and confirms the packet in the app himself (that press is
the owner's approval, and the studio admits no request beyond it), or he types an OK in the B1
thread, for example "OK: run packet A steps A3 and A4 on the installed app" or "OK: run packet H",
and the thread walks it through a Remote Control session. Stop under Qualify building ends a run
after the request in progress answers or reaches its time limit (at most 2 minutes); nothing more
is sent.
