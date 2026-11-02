# Decision log

## ADR-0061 — Open public links from the desktop app in the system browser (accepted November 2, 2026)

Context: after PR #106, links in chat answers in the installed app showed their address and a Copy button but could not be opened, because the studio window refuses every new window except private previews. Jordan asked (Nov 2) for links to open in the browser from within the app.

Decision:

- The studio window's new-window handler (`apps/desktop/src-tauri/src/main.rs`) still never opens a window itself. It hands a link to Windows' default handler (`rundll32 url.dll,FileProtocolHandler <url>`, one argument, no shell parsing, the same route as private previews and browser sign-in) only when `external::external_link` accepts it, and at most one per second (measured on a monotonic clock). The title bar says whether a click opened the link, was refused, or came too soon after the last one.
- `external_link` (`apps/desktop/src-tauri/src/external.rs`) accepts only:
  - `https` URLs of at most 2,048 characters, with no user name, password or explicit port, whose host is a public-looking name. That means at least two labels of letters, digits and hyphens, a last label that is not all digits, and no `localhost`, `local`, `localdomain`, `lan`, `home`, `corp`, `internal`, `intranet` or `home.arpa` ending. Names under well-known DNS services built to point back at a local or private address (`nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`) are refused too.
  - plain `mailto:` links to one address, with no query (no prefilled subject or body), no fragment and no percent escapes.
- Everything else is refused, including `http`, `file`, custom schemes, IP literals in any form, local names, credentials, ports, `javascript:` and `data:`.
- The web side mirrors the rule in `desktopOpens` (`apps/web/src/markdown.ts`), but only to choose what to show. In the desktop app an accepted link in a chat answer is clickable and also shows its address and a Copy button. Any other link stays copy-only text. The Rust check decides; the web mirror can't widen it.
- The app's other external links (Claude and ChatGPT usage pages in Models and connections, a checkout link) now open in the browser the same way when they pass the rule.
- No Tauri opener or shell plugin was added. A plugin would mean a new dependency and a native IPC capability for the studio window, which today has none (`tauri.conf.json` grants IPC only to the bundled control window). The existing new-window hook already sees every `target=_blank` click and `window.open` call.
- No migration and no server change.

Consequences: links in model answers open in Jordan's default browser or mail app. Anything that can open a new window in the studio UI can now send a public https page to the browser at most once a second. The studio UI is the app's own code, and model text only ever becomes an anchor after `safeHref`. Local addresses written as IP literals or local names are refused, and files and custom schemes can't be reached. A public name that resolves to this computer or the local network (DNS rebinding, a company's own DNS, a loopback service not on the list) is not detected; what limits it is https on port 443 only, the shown address, the owner's click, and the browser's own private-network protections. The rule lives in two places that must stay in step; both test suites read one case file, `apps/desktop/src-tauri/src/external-link-cases.json` (CI runs only the web one).

## ADR-0058 — Run a verified package interactively in an isolated terminal window (accepted November 1, 2026)

Context: Jordan asked (Nov 1) to launch built products from inside the app, for example the timing analyzer's `--practice` mode, which he had run from the exported source in PowerShell. Try's private preview runs a package once with all of standard input sent at once (20 s, output after exit), so interactive programs cannot work there (pilot finding F17, audit item 9). Design doc https://claude.ai/artifact/4hf8VN3bePP4vNSJCcVhAq offered three options; Jordan chose "Terminal window, isolated" on the decision card (option 1, recommended). The in-app relayed terminal panel (jitter, more surface) and running directly on Windows (generated code outside isolation, an exception to invariant 6) were not chosen.

Decision:

- Try shows "Run in a terminal…" on a verified package whose integrity check passes and whose runnable demo is available. The owner types optional arguments (one per line) and confirms the exact command (`python3 src/main.py …`, shell-quoted for display only) every time.
- `POST /api/workspaces/{ws}/artifacts/{id}/terminals` (owner only; body `manifest_sha256` + `args`, at most 12 of 500 characters) refuses a hosted studio (`LIVE_DISABLED`), a stale manifest (409), a non-verified package and an unavailable demo, then re-hashes the manifest and archive and reads the exact package bytes. `GET` on the same path lists the artifact's sessions, newest first (20). `POST .../terminals/{session}/stop` (body `artifact_id`) stops one. Start and stop write audit events `artifact.terminal.requested` (written before the window opens, so a refused or failed start is on record too) / `artifact.terminal.stopped` (session id, state, command, manifest and policy hashes).
- `TerminalSupervisor` (`packages/executor/src/terminal.ts`) copies the package into a fresh session folder under the product (`terminals/{id}/job/input`), writes `launch.json` with only the argument list, records `intent.json`, and opens a console window (`conhost.exe`) running `wsl.exe --exec /usr/bin/env -i … python3 -I bridge.py <job> <id> --recipe-hash <h> --interactive`. No studio settings, credentials or `CREATOR_*` variables cross.
- The bridge's interactive mode runs the reviewed recipe `worker/terminal.py` under the same Bubblewrap sandbox as QA (no network, read-only `/usr` and package, private tmpfs work area, no studio files) through `systemd-run --user --pty` with MemoryMax 256 MiB, no swap, 32 tasks, 50% CPU and RuntimeMaxSec 900 (15 minutes); the recipe adds RLIMIT_CPU 600 s and replaces itself with `python3 -I src/main.py <args>`. Policy string `TERMINAL_POLICY` (hashed into each record).
- One open session per product, at most 3 per studio. The supervisor keeps a lease heartbeat (750 ms); the bridge stops the unit on Stop (cancelled lease), on a lease older than 5 s (studio gone), at the deadline, or when the window closes (SIGHUP/SIGTERM). The bridge writes `environment.json` and `result.json` beside the job; the window then stays on "Press Enter to close" so the program's last screen (a practice report) can be read. If the window closes without a result, the supervisor runs the bridge's reap path and records `window_closed` only when the unit is confirmed stopped, otherwise `cleanup_required` (the package copy is kept for inspection). A session open when the studio restarts is recorded `lost`, with "not confirmed" in its reason.
- What the program prints is not captured. Session records (`ended`, `stopped`, `timed_out`, `window_closed`, `lost`, `blocked`, `cleanup_required`) are the owner's own tries, never QA, verification or isolation evidence, and they change no artifact or feedback state.
- If the studio was started inside another app's container (the Claude desktop MSIX redirect, see the Oct 31 pilot finding), the fresh session folder fails the canonical-path check and the start is refused with "start Creator Agent from the Start menu".
- No migration (records live in the product store like executions); no new dependency.

Consequences: interactive Python CLI products can be used from Try with near-native key timing (the window is a native console attached to WSL, with no relay through the studio), while generated code stays inside the reviewed sandbox. Not covered: web or GUI products (F17 later), programs needing network or files from the computer, more than 15 minutes, and the browser-only dev studio on a non-Windows host (refused). The interactive path is unit- and API-tested with a stand-in window; the real conhost + WSL + `systemd-run --pty` path still needs one live check on Jordan's device.

## ADR-0057 — Chat answers from the owner's connected ChatGPT plan or Claude subscription (accepted November 1, 2026)

Context: Jordan asked for Chat to answer all sorts of questions with his connected plans instead
of only the fixed rule replies of ADR-0055. Design doc https://claude.ai/artifact/4g1AMoevoCRSJTywfijSVG;
Jordan chose "Build as recommended" on the decision card (November 1, 2026): both plans, the
conversation plus a short studio snapshot, no qualification gate (answers labelled), and a
separate daily chat limit of 20 inside the connection's daily cap.

Decision:

- One owner setting per workspace (`chat_settings`, migration 36): on/off, the connection and a
  model verified on it, snapshot on/off, daily chat limit (default 20, at most 100). Only the
  owner changes it (`VERSION_CONFLICT` on a stale version) and only the owner asks for answers;
  editors and viewers read saved answers. Audit `chat.settings_changed`.
- Plan requests gain the purpose `chat` (path `responses`, no task class, no run, data class
  `private_approved`). Admission runs in the same locked `admitPlanRequest` as builds and adds:
  owner caller, chat switched on for exactly this connection and model, and fewer chat requests
  on this connection in the last 24 hours than the daily chat limit. Every existing gate still
  applies: connection ready (sign-in, credits or extra usage off, caps accepted, quota), model
  verified, data class allowed on the connection (connections default to synthetic and public,
  so the owner must allow private text, which re-asks for the caps), input cap, one request in
  flight, no unresolved request, and the connection's own daily cap. No qualification is
  required for chat: chat answers never feed scores, specs, evidence or builds.
- `chat_answers` keeps every try: the message, the connection and model, the plan request, the
  fixed instructions' version and hash, the exact input sent and its hash, the answer and its
  hash, or the plain reason it was refused (nothing sent) or failed. A row changes once, from
  pending to its outcome, and is never deleted (trigger). A retried click (same `client_id`)
  and a second click on a message that already has a pending or completed answer return that
  answer instead of asking again. A pending answer older than 15 minutes (a stopped studio) is
  closed as failed so the message can be asked again; its plan request, if any, stays
  unresolved and blocks the connection until reconciled. Audit `chat.answer_requested` and
  `chat.answered` carry ids, model and state, never the words.
- What is sent: the fixed instructions `chat-assistant-v1` (answer plainly, no tools or web,
  never claim the studio did something, treat records as data), the last 10 messages and
  answers before the question, the question, and, when on, a fixed-shape snapshot read from
  records only (workspace name and mode, record counts, the 8 newest runs with state and
  autonomy mode, the 8 most recently changed problems/ideas/specs/products by title, waiting
  approvals' kind and reason, workflows needing attention). Older turns are dropped first to fit
  the connection's input cap. No credentials, file paths, source page text, evidence bodies or
  product code can be included. Output is cut at 12,000 characters or the connection's cap.
- Routes: `GET/POST /api/workspaces/{ws}/chat-settings`,
  `POST /api/workspaces/{ws}/chats/{id}/messages/{message}/answer` (returns the saved answer,
  including refused ones). `ChatDetail` gains `answers`.
- App: Models and connections › Models has a "Chat answers" card (switch, connection, verified
  model, snapshot, daily limit, today's use, why the connection would refuse, and an "Allow my
  private text on this connection" button). In Chat, a message the rules keep as a note is sent
  automatically when answers are on; any other message gets an "Ask <model>" button. Answers
  are labelled "model answer, not checked" (and "fixture stand-in" for fixture connections) and
  show a "What was sent" panel. The fixed rule cards are unchanged; nothing in an answer can
  start, approve, fetch or spend.

Consequences: plan requests cost the studio $0 and do not touch the $20 runtime ceiling; they use
the owner's plan allowance. A refused request never falls back to a metered route. Claude still
runs only through the owner's own signed-in `claude -p` (ADR-0050). Not built: web access,
streaming answers, picking records to include, deleting conversations or answers. Migration 36
and ADR-0057 were allocated by the coordinator (35/0056 and 37/0058 belong to parallel threads).

Review fixes (PR #102 review, `/mnt/project-files/reviews/PR102_CHAT_ANSWERS_REVIEW_2026-11-01.md`): M-1 an answer is `refused` ("nothing was sent") only for rejections that happen before the text leaves the studio (cancelled before dispatch, the studio's Claude Code folder or start failing, Claude Code unavailable, outdated or not a subscription login, no token, studio-side errors); a provider refusal after receiving the text (usage limit, sign-in, model, any non-200) is `failed`, says "<plan> refused it after receiving the text", and keeps the "What was sent" panel. L-2 any error before admission records the request is `refused`; after it, `failed`. L-3 chat is refused while a study attempt is open on an active run in the workspace. L-4 admission reads the chat setting without a row lock (the connection lock serializes chat requests), so a settings save cannot deadlock with it. L-5 `<` and `>` in snapshot fields, earlier turns and the question are written as entities, and the stored snapshot flag comes from the builder, not from searching the text. L-6 turns are labelled "Person"/"Assistant" and the question "Question:", not "Owner". L-1 the card says allowing private text applies to the whole connection (discovery and builds too) and stops workflows set up on the old settings. L-7 the note reply no longer promises an answer.

## ADR-0056 — Evidence websites and model caps in the app (accepted November 1, 2026)

Context: Jordan asked (Nov 1) for more evidence-website options, including allowing all sites,
and for changing model caps in the app (audit items 5 and 10). Design doc
https://claude.ai/artifact/8j34BJUups2CGMqbTrPw2X; Jordan chose "Both, with any-site switch".
Amends ADR-0051.

Decision: each workspace's evidence websites are owner settings in Settings › Evidence
websites. A change names a mode (`listed`, or `any_public`, which is off until the owner turns
it on), up to 100 exact hosts or `*.example.org` subdomain patterns (not the bare domain; never
an IP address), and a reason. Only a workspace owner signed in as a person may change it
(`requireOwner`); agents, workers and system actors are refused. Each change is an immutable
`evidence_site_changes` row (migration 35) naming the version it replaced, written with an
`evidence_sites.changed` audit event under a per-workspace advisory lock taken before the
audit-chain lock (ADR-0047); a stale page gets VERSION_CONFLICT and a no-op is refused. With no
change saved, the list the studio started with (`CREATOR_SOURCE_HOSTS`, the desktop window's
list) applies. The source broker reads the workspace's latest change on every live fetch, so a
change applies to the next fetch with no restart; the startup policy's hash-only hosts and all
limits (https on 443, 2 MB, 15 s, 3 redirects, 100 fetches per run, excerpt bounds) stay. "Any
public website" adds `any_public_host: true` to the source policy: a host no rule names is
fetched with excerpts when it is a fully qualified public DNS name (not an IP, single label or
local suffix such as .local, .lan, .internal, .home.arpa); named rules, including hash-only,
match first, and the adapter still refuses private, loopback, link-local and reserved
addresses after DNS on every hop. Policies without the switch keep their earlier hashes, and
every retrieval records the hash of the policy that admitted it. `CREATOR_SOURCE_FETCH=live`
no longer needs hosts: with none, the adapter exists but no website is approved and fetches are
blocked with `no_websites_approved`. The installed studio now always starts live (the desktop
list is only the starting list); `off` keeps all live fetching and Settings changes refused.

Model caps: the Models page gains a "Change caps" form over the existing owner-only plan
settings route (ADR-0042); ranges are PlanCapsSchema's, and saving withdraws the caps
acceptance as before. No migration for this part.

Consequences: the owner, not a model, chooses where evidence comes from, and can do it in the
app. With "any public website" on, runs may quote weak or planted pages and every fetched site
sees the request and the computer's IP address; robots.txt is not checked. Study conditions
compared against each other should use one frozen policy (the retrieval's policy hash shows
which applied). The policy is read just before admission, so a change racing a fetch applies
to whichever it is recorded with. Brave public search (off by default) still filters by the
startup list. Rolling back to an older app leaves migration 35's table unused.

## ADR-0055 — Studio chat, first version: saved conversations with rule-based replies, no model (accepted November 1, 2026)

Context: runbook step 9 page consolidation. The approved page map (design doc, Jordan's "go")
puts a central Chat page first. Jordan chose "$0 chat first, model replies later" on the
decision card: the first version must not call any model or spend anything.

Decision: Chat is the studio's front door and home page (`#/chat/conversations`, the sixth page,
first in the sidebar; an address with no page now opens Chat instead of Overview).

- Conversations and the person's messages are saved per workspace (migration 34
  `studio_chat`: `chat_conversations`, `chat_messages`). Messages are immutable
  (`creator_reject_change()`), numbered per conversation under a row lock, and carry a
  client-chosen `client_id`: a retried send returns the saved message (200), the same id with
  other words is refused (`IDEMPOTENCY_CONFLICT`, 409).
- The server alone decides a message's intent with fixed rules (`classifyChat` in
  `packages/contracts/src/chat.ts`, in this order: web address, save/remember, start a
  discovery/research, approvals, why/blocked, what's next, else note). The request schema is
  strict, so a client cannot send an intent.
- The studio's replies are not stored. They are worked out in the browser
  (`apps/web/src/chat-replies.ts`) from the message's intent and the same facts as the Path tab
  and the what's-next line each time they are shown, so they cannot go stale silently: an older
  message of the same kind says its answer may be out of date.
- Cards only open a tab or fill in a field there (the Sources fetch address, the Discover
  theme). Nothing in Chat submits a form, starts a run, fetches, approves or spends; every step
  still goes through its own form and the server's gates.
- Audit events `chat.started`, `chat.message` (message id and intent only, never the text) and
  `chat.renamed`. Viewers read conversations; only editors and owners write.
- Routes: `GET/POST /api/workspaces/{ws}/chats` (list with `?q=` search over titles and message
  text, create), `GET .../chats/{id}`, `POST .../chats/{id}/messages`, `POST .../chats/{id}/title`.

Consequences: Chat answers only the fixed kinds of question; anything else is kept as a note
with a "make this a brief" card. Replies in words from a model are a later, separately approved
step (needs Jordan's OK on route, data sent and cost). Conversations cannot be deleted yet.

## ADR-0054 — One owner approval per build of a frozen spec (accepted October 31, 2026)

Context: owner pilot findings F12, F13, F15 and F18. A supervised run holds
`product.commit_build` at a stage gate, so each build needed a one-time grant, and the executor
asked for it again before every repair round. A build that needed a repair stopped at
"Build admission waiting_human", and building again then failed with "Stale build candidate",
because the studio always sent the task's base commit. On the plan route each builder and
reviewer request also needed the run's own `model.generate` admission, which in practice meant a
standing grant the app could not create. Jordan's decision (October 31, 2026, 06:57 EDT): one
approval per build of one frozen spec, covering its repair rounds and both plan roles within a
stated request limit, with an ADR and tests.

Decision: a build asks once, before its first round. `POST /workspaces/:ws/runs/:run/build-approvals`
(store `admitBuild`, which the studio calls directly) runs the ordinary `product.commit_build`
admission of the product's frozen spec (same target, humility review, stage gate, grants and
decision flow) and, when it is allowed, writes an immutable `build_approvals` row (migration 33)
in the same transaction. The row binds the build id, product, task, spec id, version and hash,
plan hash, route, plan connection and model, data class, humility review, the admission and the
grant that allowed it (and its decision), the deadline, and the build's stated limits: the plan's
`max_repairs` (at most 2) and its `max_calls` as the request limit (at most 6). The studio writes
the approval's wording; the Approve option on the decision says what one approval covers,
including, for plan-role builds, the connection (label and short id) and model (re-review L-B).
A build id can be approved only once; two racing starts of one build give one approval and
`DUPLICATE` for the others.

- A one-time approval is bound to the build scope it showed (review M-1). When a build asks,
  its route, connection, model, request limit and repair rounds are recorded against the
  decision it raised (`build_approval_asks`, first ask wins, like the wording). A one-time grant
  from that decision admits only a build with the same route, connection and model and no more
  requests or repair rounds. Before admission, `admitBuild` leaves out of the grant list every
  one-time grant for that spec and run whose ask does not cover this build, or that no build
  asked for, and, when one was asked for exactly this build's limits, the wider ones too
  (re-review L-A). So an unused one-time approval of another build never shadows a standing
  grant or the approval this build got: the build is admitted by those, or asks for its own
  approval, and the other grant stays unused. Leaving grants out only narrows authority; the
  scope check after admission still refuses a grant that does not fit. Under a standing
  `product.commit_build` grant the owner already authorized builds of that run, so the build's
  own stated scope is recorded as is (review L-2); the plan-side checks and the connection's
  per-run and daily caps bound it, no less than the standing `model.generate` grant it replaces.
- An approval lasts until the earlier of the build's deadline and the grant's expiry, and a build
  may not state a deadline more than 24 hours away (review L-1).
- Repair rounds do not ask again. The executor still re-checks the run, the grant behind the
  approval and the humility review at every step, so cancelling the run, revoking or changing a
  standing grant, or revising the review stops the build before its next request. A one-time
  grant is consumed when the approval is written and can no longer be revoked; stop such a
  build by cancelling its run (or revising its humility review), and its approval ends at its
  deadline at the latest.
- Plan-role requests (`patch_build`, `independent_review`) now name their build. Plan admission
  accepts one only when that build's approval exists, belongs to the caller, run, connection,
  model and data class, has not passed its deadline, its grant still stands (a one-time grant
  exactly as consumed, or a standing grant unchanged and unexpired), its humility review is
  unchanged, and fewer than the request limit of requests already carry its build id. This is
  checked under the connection lock, so two requests cannot take the last slot. The run's own
  `model.generate` grant is no longer needed for them. Every other plan check (qualification for
  the current role prompt, caps, owner, active non-human-only run, no study assignment) applies
  as before.
- The build-roles preflight no longer asks for a standing model grant. It now refuses a run
  with room for fewer than 2 plan requests on the connection, per run or per day (F11).
- A stopped build continues from the task's current candidate. `GET .../products` returns each
  task's `head`, and the studio sends it as `expected_commit` (F12). The commit check still
  refuses a build whose candidate changed underneath it.

Not changed: metered broker builds and the Codex builder keep their per-call `model.generate`
admission and reservations, because they spend or have their own caps. Frozen study builds
(T15) keep one admission per round (`perRoundAdmission`), so no study condition changes.
Executed QA and the independent review still decide `verified_candidate`.

Known limit: the decision's wording names the route, connection, model, repair rounds and
request limit, so builds that differ in any of them raise separate decisions, and several
one-time approvals for one spec can coexist; each goes only to a build it covers. "Covers" means
the same route, connection and model and no more requests or repair rounds, so when the only
active one-time approval is a wider build's (its decision was answered first), a narrower build
of the same spec that starts in between is admitted on it, within everything that card stated
and recording its own smaller limits; the wider build then asks again, and the narrower build's
own approval, if answered later, stays unused until it expires (PR #93 review L-1; fails
closed). A build with
the same wording shares the pending decision of the build that first asked (the first ask fixes
its scope). An approval has no "build finished" state: requests left under its limit stay usable
by the same owner, route and run until it ends (at most 24 hours, owner-only, $0, within plan caps). Approving in place, so that the build continues by itself, is separate work
(the navigation thread). Keeping decisions when scores change is in the selection code, not here (built later the same day in the Compare and decide form; web only).

Tests: `tests/src/build.test.ts` "one approval covers a whole build" (a repair round with both
roles asks once, the scope matches the recorded limits, a stop between rounds ends the build,
study ports still ask per round; fails when the executor asks every round) and "a stopped build
continues from its last candidate". `tests/src/plan-connections.test.ts` "build-role plan
requests ..." (no approval, the request limit, another run, another route, a revoked grant, the
wording of the decision, a duplicate approval, and the F11 preflight; fails when plan admission
skips the approval check). Review fixes add: a one-time approval refused to a build with
another route, model, more requests or more repair rounds, then admitting the build it showed;
a deadline over 24 hours refused; and per-request refusals for an expired approval, another
owner and a revised humility review (each fails when its check is removed). Re-review follow-up
adds `tests/src/plan-connections.test.ts` "a one-time build approval goes only to a build it
covers, preferring the exact one, never blocking others": a one-time grant from a generic admission's decision, another connection with the
same model, `codex_plan` against a `broker` approval, two approvals answered in reverse order
each going to its own build, a standing grant used despite unused one-time approvals of other
builds, the approval's expiry clamped to the standing grant's, four racing starts of one build,
and the per-request data-class check. Each of the route, connection, exact-preference,
exclusion, expiry-clamp, duplicate-mapping, data-class and wording checks fails a test when
removed.
`tests/src/studio-builds.test.ts` checks the recorded approval of a
studio build, its immutability, and a second approval of the same build refused over HTTP.

## ADR-0053 — Plan-role build packets are bounded by the accepted plan input cap (accepted October 31, 2026)

Context: owner pilot finding F21. Build 039ea78b (timing analyzer spec v4, $0 ChatGPT plan route)
ran the builder, then stopped before the reviewer with "Role context exceeds bounded packet". The
reviewer packet was 20,026 characters: spec and task fields (7,894), the full file map (5,971)
and the diff from the template (5,892). The executor's hard-coded 20,000-character role bound
dates from the metered broker route. The connection's owner-accepted per-request input cap was
64,000, and plan admission already enforces it on instructions plus input before any request is
sent. The v3 build of the same program had fit with 36 characters to spare.

Decision: on plan-role builds the executor's own bound is a runaway ceiling of 200,000 characters
(the schema maximum for `max_input_chars`). The binding bound is the connection's accepted
`caps.responses.max_input_chars`, which plan admission checks and records as a refusal. Metered
broker builds keep the 20,000-character bound, because nothing else bounds their input. The error
now states the packet size and the bound.

Amendment (review of PR #88, H-1 and M-1): the API's build-call route had its own 20,000-character
input schema and the ordinary 64 KiB body limit, and the studio's own builds pass through that
schema too. The route's input schema now uses the same 200,000 ceiling, and the `build-calls`
action gets a 1 MiB ingress allowance (a JSON packet sent as a JSON string can roughly double when
escaped). The accepted `max_input_chars` stays the binding bound through admission. A
`codex-builds` body carries the same builder packet (as an object) and gets the same 1 MiB
allowance instead of 64 KiB (PR #89 re-review L-B).

Consequences: a plan-role build is limited only by the cap the owner accepted in Settings, and a
packet over that cap is refused by admission without being sent. The file-map bound (14,000 bytes)
is unchanged. The reviewer packet still carries both the file map and the diff; trimming that
duplication is left for later. Tests: `tests/src/build.test.ts` "plan-role packets are bounded by
the accepted plan input cap, broker packets by 20,000" fails when the plan route uses the broker
bound. `tests/src/plan-connections-api.test.ts` registers a real run and sends, through HTTP,
build-call inputs over the connection's accepted `max_input_chars` (one also over 20,000
characters, one whose escaped body is over 64 KiB): each reaches plan admission and is refused
with the per-request input cap blocker, while a small input is refused without it (PR #89
re-review L-A; before, every call used an unregistered run and stopped at the run lookup). It
fails when the route schema, the body allowance or the admission check is reverted. It also sends
an over-64 KiB `codex-builds` body, which reaches the Codex configuration check rather than a
body-size refusal. `tests/src/plan-connections.test.ts` checks that
admission refuses an input one character over the accepted cap.

## ADR-0052 — Qualification answers and grading reasons are visible; held-out views bind prompt revisions (accepted October 31, 2026)

Context: owner pilot finding F10. On October 30 the installed app's patch_build qualification
failed 0/4 twice. The app showed only "failed", so the cause could not be seen. On October 31 the 8 stored
answers turned out to be correct patches. Every case was `provider_error`, because the installed
app had been started inside the Claude desktop app's MSIX container, which redirected the new
`plan-qualification-products` folder. Node's realpath then differed and `canonical()` refused the
path. The grader swallowed that message.

Decision: the patch_build grader (`gradePatchCase`) returns a plain reason for every non-pass.
The reason covers no submission (with the builder's blocker), a refused patch, a set-up failure, a worker
failure, or the failed check's exit codes and whether its output matched. It never prints expected
output. The reason is stored in the plan request's `reason_code` (at most 200 characters,
clipped once). `GET /plan-qualifications/{id}` and the Models page show each case's outcome,
reason and stored answer (synthetic or public data only, per ADR-0049), including held-out
cases. Because held-out answers and reasons are now visible to the owner, invariant 9 applies:
a role prompt revised after viewing a qualification's held-out results counts as tuned on those
cases, and is requalified on fresh held-out cases. The page says so next to held-out answers.
Reasons for the other check kinds (reviewer verdict, discovery contracts) are not added yet.
Those still show only the signal.

Consequences: no migration. The installed app must be launched by the owner, never from a Claude
session. Settings saved while it ran in the container (`studio.json` with the approved websites)
were copied back to the real home with the owner's OK on October 31.

## ADR-0051 — Owner-approved evidence websites in the installed app (accepted October 30, 2026)

Context: pilot run 1 (runbook step 8) could not add evidence. The installed app clears its
environment and its `studio.json` had no host list, so `CREATOR_SOURCE_FETCH` was always off
and every fetch in a real workspace was denied (`live_fetch_not_configured`). Claims count only
with quoted passages from fetched pages, so discovery could not start. Jordan chose "fix and
reinstall" over stopping the pilot.

Decision: `studio.json` gains an optional `source_hosts` list (at most 20 lowercase DNS host
names, no scheme, port, path or IP), edited in the status window ("Websites approved for
evidence") and saved with a restart of the studio service. The desktop passes the list in the
service input; a non-empty list sets `CREATOR_SOURCE_FETCH=live` and `CREATOR_SOURCE_HOSTS`.
Empty keeps fetching off. The source broker's per-hop policy and the run's `source.fetch` grant
are unchanged, so every fetch still needs a covering grant.

Consequences: the owner, not a model, approves websites, in the app's local control window
(no remote UI access). The field is omitted when empty, so a rollback to an older app still
reads the file; with hosts saved, an older app refuses the file until the field is removed.
Hash-only hosts are not exposed yet.

## ADR-0050 — Claude subscription through the owner's own Claude Code CLI (accepted October 28, 2026)

Context: Jordan asked whether Creator Agent can use a Claude subscription the way it uses the
ChatGPT plan. Anthropic's terms (Claude Code legal and compliance page, Agent SDK overview,
Consumer Terms; read 2026-10-28) forbid apps from offering Claude.ai login, routing requests
through Free/Pro/Max credentials for their users, or collecting, storing or intermediating
Claude.ai credentials or session tokens. They do allow a user to sign in to the unmodified
Claude Code binary with their own subscription, and they document scripted use (`claude -p`).
Jordan chose "Build it as designed" on the feasibility design.

Decision: plan connections get a fixed `kind` (`chatgpt_plan` or `claude_code`, migration 32,
immutable by trigger; a `claude_code` row can never hold a credential reference). A
`claude_code` connection runs the owner's own signed-in Claude Code on this computer, in a
dedicated `CLAUDE_CONFIG_DIR` (`CREATOR_CLAUDE_CODE_CONFIG_DIR`), never the owner's personal
folder. The studio has no Claude sign-in flow and never reads a Claude credential; "signed in"
is the last `claude auth status` result, and only a `claude.ai` login with the first-party
provider grants plan usage. The status is re-read before every request. Runs use restricted
mode with no tools, MCP, skills, session persistence or fallback model, one turn, an
allowlisted environment, stream output checked for tools, credential source and the answering
model. Refusals are cut at the first retry notice. Everything else reuses the ChatGPT-plan
gates unchanged: owner caps, a Claude-specific "extra usage is off" attestation, one-shot
model verification, frozen-benchmark qualification, the request ledger and reconcile. Direct
path only; `code_build` and Codex builds are refused for this kind.

Consequences: no money moves while extra usage is off; requests share Jordan's Claude limits.
Policy risk stays: Anthropic may judge studio automation as outside "ordinary, individual
usage" and may enforce without notice, so caps are low and the route is for Jordan's personal
studio only. The fully clear alternative remains a metered Claude API key. Details:
`docs/CLAUDE_CODE_CONNECTION.md`.

Review amendment (PR #76 review, same day, before merge):

- A fixture connection runs Claude Code only against an explicit stand-in. Without one it is
  refused with `LIVE_DISABLED`, the same as `endpointsFor` for ChatGPT, and nothing starts.
- The start event must report `apiKeySource: "none"`.
- The child's `ANTHROPIC_CONFIG_DIR` is an empty studio folder (checked before each run), so
  an Anthropic federation profile cannot outrank the login.
- Instructions go through `--system-prompt-file`.
- Claude Code older than 2.1.248 is refused with an update reason.

## ADR-0049 — Reviewer prompt states T12's answer rules; reviewer benchmark v2 (accepted October 28, 2026)

Context: Jordan's first live T12 role qualifications on gpt-6-astra (ChatGPT plan, $0):
`t12-builder-v1` qualified (1/1 development, 3/3 held out; an earlier 0/4 was the jsonb
key-order grading bug fixed in #73). `t12-reviewer-v1` failed (0/1 development, 2/3 held out):
both cases expecting `changes_requested` passed, while both expecting `approve` missed
(rv-01 `review_rejected`; rv-03 `acceptance_check_failed`, an echoed hash not matching). The
answers were not stored, so the cause is an inference. `independent-reviewer/1` never told
the model the two rules T12 itself enforces on a review (build.ts: `approve` counts only with
an empty findings list; candidate, spec and task hashes must match the packet). Real builds
would hit the same gap.

Decision: the reviewer prompt becomes `independent-reviewer/2`, which adds only those two
rules (copy the three values exactly; approve only with no findings, otherwise
`changes_requested` or `blocked`). The builder prompt is unchanged, so the builder
qualification stays valid. `t12-reviewer-v2` is authored by the same script
(`reviewer-v2` mode) with the same four cases, splits, candidates and expected verdicts as v1,
new T12 packets, and the current prompt; the 3 of 3 held-out bar is unchanged. Nothing about
the cases was tuned to the failed answers. v1 and its failed qualification stay recorded;
qualification start refuses v1 now because its prompt no longer matches. The study build gate
and the fixture reviewer accept the `/2` prefix (no final study has frozen; this changes the
synthetic study build role prompt too). Qualification requests on synthetic or public data
now keep their answer text in `plan_requests.output_text` (existing column, no migration) so a
failed case can be explained; other plan answers are still not kept.

Needs Jordan: approve `t12-reviewer-v2` as frozen, then one 4-request qualification run.

Follow-up (PR #74 review M-1): a build-role qualification now admits work, and counts in the
`build-roles-ready` preflight, only if its stored manifest still hashes to `manifest_hash` and
every case's system prompt is the current T12 role prompt. A future `builder/2` therefore
needs its own qualification. Qualification history is still shown in full. Review Lows L-1
(the prompt does not say `changes_requested` needs a finding) and L-2 (the strict key set is
not spelled out) are deferred on purpose: any prompt change now withdraws the reviewer
qualification Jordan just earned, so they wait for the next deliberate prompt revision.

## ADR-0048 — T12 builder and reviewer on the ChatGPT plan's direct route (accepted October 28, 2026)

Context: no real T12 build is $0 today. The Codex builder path is blocked in code (no
Codex-path verification or `code_build` qualification), and even with it the independent
reviewer always went through the metered dollar broker. CODEX_INTEGRATION §4.2 also barred a
reviewer on the same connection as the builder. Jordan chose "plan for a fully $0 route
first", then "Yes, build option 1" on the design (both roles as plan Responses requests,
with the §4.2 change).

Decision: a build plan may name `plan_roles: {connection_id, model_id}`. The builder and
reviewer then go as fresh direct Responses requests on that ChatGPT-plan connection under
new task class `patch_build` and existing `independent_review` (both added to the Responses
classes; the owner adds them to a connection's allowed classes in Settings). The role
prompts (`builder/1`, `independent-reviewer/1`, moved unchanged to domain `build-roles.ts`)
are fixed server-side; the caller sends only the packet. Packets, scoped patch tool, held-out
QA in the WSL worker and `verified_candidate` rules are unchanged. §4.2 now allows the
reviewer on the same connection and model as a fresh request (no builder conversation or
claims); executed QA still decides.

Admission (plan request ledger, no migration): each role's class must be allowed and
qualified for the model; a build-role request outside a workflow must name a registered run
that is active, not human-only, and not a study assignment (frozen study arms keep their
routes). Responses caps apply (10 per run, 40 a day shared, 120 s, 16,000 output chars).
Build plans allow `timeout_ms` up to 120 s only with `plan_roles`; broker builds keep 60 s;
`plan_roles` and `codex_plan_builder` are exclusive. Plans without `plan_roles` hash the same
as before. Each call writes an intent (route `chatgpt_plan_responses`, task class, prompt,
context hash) and the outcome to the build record.

Qualification: new benchmark checks. `review_verdict` needs the answer to bind the case's
candidate, spec and task hashes and give the expected verdict (approve with no findings, as
T12 requires; changes_requested with at least one finding). `patch_cases` is graded by the
studio's patch scorer (executor `scorePatchCase`): the patch is applied to a throwaway product
from the reviewed template (its own products root, `plan-qualification-products`) and every
case runs in the worker as QA does. Without the scorer the qualification stops before any
request (`patch_scorer_unavailable`). Route benchmarks refuse `patch_cases`. Every case of a
build-role qualification must use exactly the T12 role prompt. Build-role checks need their
own task class and JSON output. The web build form offers "Builder and reviewer on ChatGPT
plan" for verified Responses models; the CLI posts to `plan-connections/:id/build-calls`.

Consequences: a real build can cost $0 metered once Jordan signs in, verifies one model,
adds the two classes and qualifies both roles; until then admission refuses it. Benchmarks
`t12-builder-v1` and `t12-reviewer-v1` (4 cases each, 3 held out) are generated by
`scripts/author-plan-role-benchmarks.mjs` from the exact T12 packets of synthetic checklist
tasks. Jordan approved both as drafted on October 28, 2026, with a 3 of 3 held-out bar per
role (`min_held_out_cases` 3, floor 3/3); they are frozen and must not be edited.

Review of #71 (no High; 1 Medium, 5 Lows), all fixed. M-1: a patch scorer that threw left
the plan request in flight and blocked the connection; any grader error is now a recorded
`provider_error` signal and the request is settled, and `scorePatchCase` returns
`provider_error` if the throwaway product cannot be made. L-1: a build with `plan_roles`
first asks `planRolesReady` (new port; API `plan-connections/:id/build-roles-ready`) and stops
before the commit_build grant is used or the builder is sent unless both roles are allowed,
verified and qualified. L-2: build-role requests are owner-only and pass the run's own
`model.generate` admission (a grant covering model requests on the run is needed, as for
broker builds). L-3: qualification grades with T12's strict builder and review schemas.
L-4: the form says budget and pricing are recorded but unused on this route (plan hash
unchanged). L-5: throwaway qualification products are removed after grading; new tests for
the study-assignment refusal, owner-only, the run admission, the preflight and a
service-level patch qualification with an accepting and a crashing scorer. Re-review of
#72 (no High/Medium): N-1, the preflight now also checks owner, run state, study assignment
and a read-only dry run of the run's `model.generate` admission (`wouldAdmit`; nothing is
consumed or raised), and asks for a standing grant when only a one-time grant covers it
(each role request needs one). Nits: a grader error is stored as `grader_error: <message>`
in the request's reason; a failed throwaway create leaves no partial directory. Shared
model ancestry can correlate builder and reviewer errors; QA on held-out cases is the guard.
The study-assignment refusal is tested (added in #72).

## ADR-0047 — Study budget locks before the audit-chain lock (accepted October 28, 2026)

Jordan approved fixing the gap ADR-0044 recorded before the first real run. The study build
path (`prepareStudyBuild`) took the audit-chain lock in `lockAttemptForWrite`, then the
study-ledger lock and, for final records, the runtime-ceiling lock in `holdBudget`. Ceiling
and limit saves take runtime-ceiling then audit-chain, and `prepareStudyExecution` takes
study-ledger then audit-chain, so either pair could deadlock (PostgreSQL would abort one
transaction). It also applied to synthetic builds against concurrent synthetic execution in
the same workspace. Now `lockAttemptForWrite(..., budget = true)` takes `holdBudget`'s locks
(study ledger, then the runtime ceiling for final records) after the run and attempt row
locks and before the audit-chain lock; `holdBudget` re-takes them (advisory locks are
re-entrant). Order everywhere: run row, attempt row, study ledger, runtime ceiling, audit
chain. New `lockRuntimeCeiling` in runtime-ceiling.ts. Test (study-build, final-record
gate): while another transaction holds the study-ledger or runtime-ceiling lock, a final
build waits on it without holding the audit-chain lock, then refuses LIVE_DISABLED; it fails
on the old order. Final builds are still LIVE_DISABLED; no migration, no amounts changed.

Review of #70 (no High/Medium): L1, the test covered only final records; it now also checks
a synthetic build against a holder of `study-ledger:synthetic:<ws>` (the inversion that
deadlocked on main) and fails if the synthetic early lock is dropped. N2: budget-store uses
`lockRuntimeCeiling`. N1 kept: a final build takes the T15 ledger and ceiling locks before
refusing LIVE_DISABLED; brief, and it is the order live final builds will need.

## ADR-0046 — Builds and packaging started from the studio (accepted October 27, 2026)

Jordan approved the five recommendations of the in-app build and package design on
2026-10-27: builds run in the studio service; real workspaces use the ChatGPT-plan Codex
builder, with no live call until he approves a specific build; fixture workspaces get a $0
sample; generated code runs only in the WSL worker; the first release is build, package and
download, with revisions later. Context: the desktop app has no CLI, and every build step
after the frozen spec ran inside the CLI process.

Decision: the API gets `GET|POST /workspaces/:ws/products` (list; create from a current
frozen spec), `POST .../products/:id/tasks`, `POST .../products/:id/builds` and
`POST .../products/:id/package` (apps/api/src/products.ts). They run the same
`BuildSupervisor` and `ArtifactSupervisor` the CLI uses, over the API's product store
(`CREATOR_PRODUCTS_ROOT`, the desktop home's `products`). The build ports the CLI implements
over HTTP are implemented in-process against the store and broker under the caller's context,
with the same checks: workspace owner only, current active frozen spec bound to the product,
active non-human-only run, `product.commit_build` admission with a covering grant and an
active humility review, re-checked on every step; model calls reserve through the broker; the
Codex builder goes through the same plan relay (`runCodexBuild`, shared with the CLI route).
QA cases come from the frozen spec, never from the caller. A build or package answers once its
intent is recorded and continues in the background; a second start for a product with a build
running here is refused, not queued. Packaging re-checks the build first, re-reads and
re-hashes the package, then registers it as the register route does.

Limits: job state is in memory; after a restart a build with no outcome shows as interrupted
and is never resent. Generated code still runs only in the execution worker; a host without
WSL cannot build. The first live Codex build remains a separate, owner-approved step.

Amended October 27, 2026 (review of #67): the build ports run without the request's
Idempotency-Key, since store commands replay on it and one approved-once admission must
not cover a second build or round. `POST .../products/:id/recover` releases a product's
locks whose recorded process is gone (never one held by this process or a live one; the
management lock only with a clean integration repo), keeping the lock file and an event.
A second package request for a build already packaging is refused. Recover also reconciles an
acceptance run the app left in the worker (only after its supervisor is gone and the
executor verifies the WSL2 unit stopped) and releases a dispatch lock no worker was
launched under; a lock written before the current boot counts as dead. Known limit: a build
already running continues after the owner signs out, like other started work; revoking
its grant or stopping its run stops it at the next step.

## ADR-0045 — Test-mode checkout screen and simulated test buyer (accepted October 27, 2026)

Runbook step 3 (Jordan asked to start it on 2026-10-27). The Payments page gets a
"Checkout (test mode)" section (apps/web/src/checkout.tsx). Only the workspace owner opens
checkouts or acts as a buyer; the store enforces it. Three routes are added:
`GET /workspaces/:ws/payment-checkouts` (owner-only list, newest 50), and for the simulated
processor only `GET|POST .../payment-checkouts/:id/buyer` (state, and one buyer or processor
step: pay, settle, refund in full, dispute, dispute won/lost) and
`POST .../payment-checkouts/:id/deliver` (deliver one queued event correctly signed, with a
wrong secret, or with a timestamp outside the 5-minute tolerance). A step changes only the
in-memory fixture processor and queues the event body a processor would send; nothing reaches
the ledger or access until a delivery passes through `PaymentService.receiveWebhook`, the
same signature, mode, de-duplication and backend-read path real deliveries use, with the
webhook actor identity. The owner chooses the order and can repeat a delivery, which
exercises duplicate and out-of-order events. Each buyer step or delivery records a
`payment.test_buyer_requested` audit event (state reads do not). Test-buyer state lives in
API memory like the fixture processor. At most 100 test buyers are kept (the oldest is
forgotten first, and its simulated checkout session is closed with it); a forgotten
checkout, like one after a restart, says so and offers nothing. Stripe test-mode checkouts
show only Stripe's hosted `https://checkout.stripe.com/` link and a "read a payment by id"
recovery (the existing reconcile route); no Stripe call was made by this work. Also:
`checkoutTarget` now refuses an offer whose release has since been replaced (later build or
spec version), so a buyer cannot pay for a replaced release. No migration, no live mode, no
processor choice: Stripe remains the pending default.

## ADR-0044 — Per-run and per-model spending limits under the ceiling (accepted October 27, 2026)

Implements the narrower limits from owner decision #10 as runbook step 4 (Jordan approved
the step on 2026-10-27). One optional per-run limit and optional per-model limits
(provider + model id) sit under the overall ceiling of ADR-0043. Each Settings save is an
immutable version of the whole set in `runtime_limit_changes` (migration 31) with a reason
and a `spending.limits_changed` audit event in the same transaction, taken under the
`runtime-ceiling` advisory lock and naming the version it replaces. Same audience as the
ceiling: only a signed-in human workspace owner. Every limit must be at or below the
ceiling in force when saved; dispatch checks the ceiling and the limits both, so a later
lower ceiling still wins. Limits count real (non-fixture) paid calls since the ceiling's
start date, exactly as the ceiling does (settled cost, held exposure while in flight or
unknown); ChatGPT-plan requests are subscription quota, not metered, and are not counted.
They apply to study calls too, and a final study attempt whose frozen cap exceeds the
per-run limit is refused before it starts rather than cut off part-way, and a per-run limit
cannot be saved below the cap an open final attempt already holds. The Settings view lists
runs and models from every workspace, like the ceiling; that fits the single-owner app and
must be narrowed if more than one owner is ever supported. Known lock-order gap (pre-existing
since ADR-0043): the study build path takes the audit-chain lock before holdBudget takes the
runtime-ceiling lock, the reverse of ceiling and limit saves; unreachable while final builds
are LIVE_DISABLED, and must be fixed before live final builds are enabled (fixed by ADR-0047). Safe default: no
narrower limits are set, so behaviour is unchanged until Jordan sets some; this work set no
amounts. Still future work from #10: per-user, per-task, provider-wide and recurring limits.

## ADR-0043 — Owner-set runtime spending ceiling in Settings (accepted October 26, 2026)

Implements owner decision #10's overall ceiling (tracking/OWNER_DECISIONS_2026-10-20.md);
Jordan asked for it in this pass on 2026-10-26. `config/spending.json` keeps the reviewed
starting value ($20, counted from 2026-10-20). A signed-in person who owns at least one
workspace may set a new overall ceiling in Settings, higher or lower, with a reason. Each
change is an immutable row in `runtime_ceiling_changes` (migration 30) plus a
`spending.ceiling_changed` audit event in the same transaction, taken under the same
advisory lock every paid dispatch uses to check the ceiling, and must name the version it
replaces (stale pages get VERSION_CONFLICT). The latest change is the ceiling in force;
with none, the configured value applies. Changing the ceiling never resets what counts
against it. Agents, system actors and workers have no route to it: the store refuses any
actor that is not a human workspace owner, and only browser sessions reach the API route.
Limits: the ceiling is deployment-wide, so in a multi-user hosted deployment any human
workspace owner can change it; per-user, provider, model, run and task limits and recurring
limits from #10 remain future work. No amount was changed by this work; the $20 ceiling stays
until Jordan changes it in the app.

## CW-01 console undertaking limit widened to any console host (provisional) — October 26, 2026

Jordan: "For now the limit can cover any console host." This supersedes the wording of the
earlier entry below ("shows human presence"). Per the CW-01 adapter design v1.3 note (J1),
the undertaking is collected through an interactive-console check run by the supervisor
(Node tty API, per-run console challenge). Any process able to host or drive a console,
including a pseudoconsole host such as an IDE terminal panel or an agent's terminal tool,
could supply it; the author is not authenticated, and
receipts say so. Accepted for the present design; the acceptance is provisional ("for now") and can be withdrawn; an
authenticated owner path would replace it. It grants no undertaking, implementation,
operational read, SQL, credential, cluster start/stop, launch or native-session authority,
and no model may run the undertaking step or type it. M3 unchanged and not reopened.

## CW-01 unauthenticated console undertaking accepted as a known limit — October 26, 2026

Jordan accepted ("I am okay accepting that as a known limit") the residual raised by the
CW-01 operational adapter design v1.2 note (G2): the six-item W1-W3 undertaking is typed
at an interactive supervisor console after admission, which shows human presence but
does not authenticate the author. Receipts label it owner_undertaking_console and state
that the author is not authenticated. This accepts a design limit only: it grants no
undertaking, implementation, operational read, SQL, credential, cluster start/stop,
launch or native-session authority, and no model may type the undertaking. M3 unchanged
and not reopened.

## CW-01 attestation-to-spawn bound confirmed (120 s) — October 26, 2026

Jordan confirmed "120 s is fine" for the CW-01 fixture core's owner-attestation
bound: pg_ctl's measured creation may be at most 120 s after the attestation's
affirmed_at_ms (LIMITS.attestation_max_age_ms in
scripts/theme-intent-cw01-core-fixture-v4.mjs, introduced in v3). This settles the
value flagged in docs/THEME_INTENT_CW01_FIXTURE_CORE_V3_REPAIR_2026-10-26.md and the
v4 repair; no code changed. It confirms a fixture-core parameter only: it grants no
attestation, SQL, credential, registry/pidfile/process read, cluster start/stop,
launch or native-session authority. M3 unchanged and not reopened.

## Theme acceptance field-limited reader preparation — October 24, 2026

Jordan selected “Prepare a field-limited reader for separate review” in this
conversation. This authorizes fixture-only preparation and review, not saved
studio.json/credential reads, operational OS observations or native acceptance.
Implementation/report: docs/THEME_INTENT_CONFIG_READER_PREPARATION_2026-10-24.md.
M3's previously accepted exact-bundle evidence standard remains unchanged. Any
future operational adapter/read needs concrete separate reviewed scope; fixture
projection cannot establish active home/workspace role/continuity or tool identity.

## THEME-ACCEPTANCE-M3-2026-10-24 — scoped scheduler evidence standard

Jordan explicitly selected “Accept exact-bundle configuration evidence for this
session” after Claude's exact-v3 review. For narrow theme-draft UI acceptance only,
a fresh installed match to reviewed studio.mjs SHA256
9d5ddac373c475a88253f23e01bf18852276db04a2113d2de7582c22fa21da88
may satisfy the scheduler-configuration gate. This is an explicit evidence-standard
change, not observed live state, continuous prevention or exhaustive zero dispatch.
Worker remains on; current identity/continuity and all other gates remain. No
startup-admission candidate selected. Concrete inspection/session scope separate.
Canonical scoped statement: docs/THEME_INTENT_ACCEPTANCE_SCHEDULING_DECISION_2026-10-24.md.
No frozen study/protocol or wider policy change, operational read, activation or
launch is authorized. V4/proposal v2 prepared for separate independent review.

## Native acceptance readiness assessed; session remains blocked — October 24, 2026

Bounded repository-only reconciliation completed. No newer independent exact-v2
checklist review found in docs/tracking filename inventory and text search; original
review covers v1, revision is not independent, and supported v4 review covers helper
bytes only. No reviewer dispatched. Frozen checklist/helper/package/history preserved.
Actual schema29 installation and pre-UI receipts supersede v2's pending helper,
backup/install/migrate prerequisites; no repeat preparation/install is indicated.
Repository evidence check: 182 hash bindings, zero mismatches; 145 exact helper
bindings; 16 run-01 JSON receipts read; all114 business hashes preserved; migration
precedes observation. These are historical receipts, not fresh operational checks.

Readiness and proposed session scope:
docs/THEME_INTENT_ACCEPTANCE_READINESS_2026-10-24.md.
Evidence/reproducible repository-only check:
tracking/evidence/theme-intent-acceptance-readiness-2026-10-24/assessment-receipt.json
and assess.mjs. Native acceptance remains blocked by independent exact-v2 review,
unknown live scheduling state, named existing workspace/current owner-editor role,
continuity through first launch and a separate bounded session authorization.
Source defaults do not prove live scheduler state; worker starts on launch. UI-only
scope cannot establish raw hashes, post-UI database equality or exhaustive zero
dispatch. A v1–2/B v1 synthetic scope retains records by default; registry/shortcuts
need separate read-only scope; /NS skips creation; Jordan H remains separate.

No operational/credential access, launch/sign-in, acceptance writes, helper execution,
provider/workflow activation, recovery/stale release, cleanup or retired checkout
access. R/N/H remain unverified; full C54 partial. Next eligible: use
docs/THEME_INTENT_ACCEPTANCE_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md in a separate
review session. Resolve scheduling/continuity gates before requesting native session
execution. No automatic next milestone or authority granted by this assessment.

## Exact theme-intent installed and schema29 preserved before UI — October 24, 2026

Owner authorized next step after operational before completion. New exact /4 owner
install decision binds frozen candidate7100a039...8bc /plan27f79525...7a1, prepared
5bb69e60...ddf0d2 and reviewed145runtime map. Fresh admission passed with unchanged
schema28/predecessor/state/backups. Real NSIS3af2712c...6d834b ran /S /NS, exit0,
no timeout, completed2026-10-24T12:34:45.802Z (08:34:45EDT). Exact candidate migrate
applied[29] from28to29 and created its own verified schema28 migration snapshot.
Reviewed after passed before any desktop/UI launch: schema29 observed
2026-10-24T12:34:49.022Z; all114business table hashes, prior migrations, protected
files/config/products preserved. Parent rechecked full receipt/admission/installer/
migration chain and migration dump hash; exact installed native510b09...88ca9,
manifest5b38b4...eba6 and71runtime resources verified.
Operational cluster stopped normally. Host check pg_ctl status3, no configured-port
listener, no lease, desktop or runtime worker. No provider calls/workflow activation,
UI/acceptance writes, recovery or retired checkout access. Code/packages/reviews
unchanged; CurrentUser DPAPI used by reviewed wrapper only, no secret bytes logged.
Evidence: tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json
and shutdown-check.json; original session receipts and new owner-install-approval
under tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Prior before completion remains immutable history; installed state now supersedes28.
Keep schema28 snapshot and matching program together at private before backup;
coordinated rollback needs separate decision, never old binaries alone over29.
Real installation I is verified. Registry/shortcuts R, native UI N and Jordan human
acceptance H remain unverified. /NS skips shortcut creation. No operational restore
rehearsal claimed. Acceptance checklist v2 review/session scope still separate;
keep desktop quit until gates resolve. Next eligible: independent exact-checklist-v2
review alongside supported v4 helper, then scoped native acceptance decision.
No automatic acceptance/next milestone. FullC54 remains partial.

## Operational v4 before preparation completed — October 24, 2026

Owner authorized next step after exact-v4 independent support. Supported /4 review
validated with all145 runtime bindings; frozen package preflight passed. New session
operational-before-v4-20261024-01, evidence
tracking/evidence/theme-intent-operational-before-v4-2026-10-24/.
Reviewed PS/CLI before exited0, fixture:false, provider_calls0. Actual managed
postgres/data schema28 observed;28migration rows and114table hashes. Dedicated
snapshot plus post-backup preserved-state checks/quiescence passed. Private backup:
C:/Users/jorda/AppData/Local/com.creatoragent.studio/backups/theme-intent-v4-operational-before-v4-20261024-01.
Database dump553996bytes; matching predecessor program78files, protected4files,
configured products tree0files. Helper verified dump list/hash and copy maps; parent
rehashed all copies/dump and prepared/before/backup receipt links. CurrentUser DPAPI
used only inside reviewed wrapper; no credential bytes logged/tracked. No restore
rehearsal performed on operational snapshot; dump-list/hash verification is distinct.
Prepared_at2026-10-24T12:31:01.322Z; prepared SHA256
5bb69e60eaae96a503368ef2bd9f7e61c9f40546825b893de4e1d44492ddf0d2.
Earliest backup/prepared15minute age deadline2026-10-24T12:46:00.939Z
(08:46:00.939 America/New_York). Admission must recheck freshness/unchanged state
and a NEW exact owner installation decision; age deadline is not admission approval.
Host final check:pg_ctl status3, no configured-port listener, no theme-intent lease.
Operational database and installed predecessor remain schema28; no install, migrate,
admit, recovery, stale release, provider/workflow activation or retired-path access.
Completion receipt and shutdown/owner provenance retained; prior failed v3 attempt
unchanged. Helper/plan/packages/reviews untouched. Native NSIS/registry/shortcuts/UI
and human acceptance remain unverified; acceptance checklist v2 review separate.
Next eligible: new exact installation/migration owner decision, fresh admission and
only then authorized install/migrate/after before any UI launch. If stale or state
changed, new before session/directories required. No automatic next milestone.
FullC54 remains partial.

## Development artifact retention mechanism — October 24, 2026

Retention is opt-in by marker and never inferred from directory names, so
historical evidence, recovery material and unknown directories cannot be deleted by
pattern. Frozen reviewed runners are not retrofitted (hash bindings); new runs mark
themselves via createOwnedRun(). Policy: passed 24h + latest 1, failed 14d + latest 2,
abandoned active treated as failed, protected/referenced always kept. Deletion
refuses links/junctions anywhere in a run and operational/broad roots. No automatic
or scheduled deletion.

## Installed acceptance checklist v2 revised; execution remains blocked — October 24, 2026

Owner authorized document-only revision following Claude's blocked checklist review.
New docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md preserves the original
plan and review. Incorporates A0–A13: exact candidate/plan/proposed-v4 map and review
binding; successful after/cluster-stop evidence before first launch with actual
v4 at/state.observed_at fields and operator timeline; control-window GUI-migration
stop; native sign-in/Quit; workspace/role/mutation scope; two-draft visible ledger;
clean-save version/activity check; pending-target semantics; retention by default.
UI-only observation chosen. Raw content hashes, whole-database equality after UI
activity and exhaustive zero dispatch are explicitly unverified. Plan declarations
are wiring, not measured dispatch. Worker startup/bookkeeping are explicit; no
worker-off control or live scheduler-off UI invented. Unknown runtime scheduling
blocks execution; stronger prevention/accounting proof needs a separate reviewed
inspection/control task. Real install, registry/shortcuts, native UI and Jordan's
human acceptance have separate I/R/N/H classes; historical fixtures are F.
All cases not-run. No operational data/credentials, helper, installer, app, provider,
workflow or retired path accessed/run. Only documentation/tracking/new planning
evidence changed. Original plan/report/receipt hashes preserved; all168 v4 repair
artifacts unchanged. Markdown formatting and case coverage checks pass. Evidence:
tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json.
Next: independent exact-v2 checklist review alongside resulting reviewed helper
identity. V4 helper review remains a separate gate; operational preparation, install/
migration and native acceptance still require their recorded gates and authority.
No automatic next milestone. No fresh operational backup from failed v3 attempt;
fullC54 remains partial.

## Native-layout helper v4 locally verified; independent review next — October 24, 2026

Owner authorized the next repair after operational v3 before failed. V4 preserves
v3 and frozen package/plan. Shared PGDATA is desktop-native postgres/data in normal
managed control, postmaster ownership inspection, stale data_dir binding/release
and coordinated recovery. Nested directory/no-links/PG_VERSION18 checks now precede
DPAPI. No flat fallback or data relocation. Versioned /4 authority/review/lease
contracts require a fresh exact independent review; v3 support does not cover v4.
Verified source-bound run:26/26 TAP tests (25scenarios+parent), guards11/11,0skip,
source maps unchanged. Independent fixture initdb uses nested layout; source-contract
guard reproduces v3 failure. Real wrapper rejects missing nested PGDATA while
synthetic DPAPI is unavailable. Before/death/stale-release, forward29 preservation
and coordinated28 recovery pass. Static package/PS parse/format/syntax pass.
First full run retained: two scenarios failed (23pass/3fail including parent):
missing synthetic studio.json setup, corrected in test only; transient EPERM on
fixture program rename during interrupted recovery. Exact-directory rename/back
subsequently succeeded, and unchanged runtime passed complete rerun. EPERM cause
unconfirmed, no production retry/gate relaxation; retain for independent review.
V2's162 and v3's161 artifact hashes unchanged. Disposable55455 summary stopped.
No operational configuration/credentials/database accessed in this repair; no NSIS,
providers/workflows, installed app changes or retired checkout access. Failed
v3 operational before still produced no fresh backup; installed schema28 remains
last verified status, not re-queried. FullC54partial. V3 low findings deferred.
See docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md and
tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/repair-receipt.json,
verified-{guards,e2e}-run.json/TAP and retained first-run failure evidence.
Next U02: fresh independent exact-v4 review of layout/pre-secret/stale/recovery
and failure evidence. Operational retry remains blocked until review support;
new session/directories/current authority required. No automatic next milestone,
installation/migration, recovery or release authority follows.

## Operational before blocked by native-layout mismatch — October 24, 2026

Owner authorized operational before preparation only. Exact frozen package preflight
and independent /3 review passed (145 runtime bindings). Actual reviewed v3 attempt
operational-before-20261024-01 exited 1: managed() reads postgres/PG_VERSION, while
desktop Home::pg_data (apps/desktop/src-tauri/src/home.rs:121) uses postgres/data.
Read-only inspection confirmed postgres/data/PG_VERSION=18; operational schema was
not queried. Wrapper decrypted CurrentUser DPAPI before this failure; no credential
bytes logged. No database start, snapshot, private backup, prepared receipt, install,
migration, providers or workflows. Empty run-01 evidence directory retained; lease
removed normally. Original reviewed v3 bytes and all historical evidence preserved.
The synthetic fixture layout mirrored the same wrong assumption, so prior passing
tests/review do not establish native layout compatibility. Operational preparation
is blocked despite historical supported review. See
tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json
and owner-before-authorization.json.
Next eligible U03: bounded versioned native-layout repair, actual-desktop-layout
fixture coverage (including stale/recovery paths), then fresh independent exact
review before a new operational before attempt. No install/migration authorization.
No complete fresh backup exists from this attempt; full C54 remains partial.

## October 23 v3 bounded stale-state release repair

Owner authorized repair of the v2 independent review's two Medium process-death
findings. Preserve reviewed v2; use separate v3 /3 formats/paths. Cleanup authority
must be distinct from install/migration/rollback, work before a prepared receipt
exists and require no credential decryption. Bind dead lease/PID/token and exact
home/config/data/session/evidence/review map; preserve retired and partial artifacts.
Serialize cleanup and normal phases with a parent-monitored Windows named mutex;
publish synced complete disk leases atomically. Tag owned PG startup transiently,
never stop merely because status says running, keep desktop/workers quit and retain
leases on uncertain cleanup. After/reconcile can resume forward under cleanup scope
without repeating effects. These host-specific helper choices change no product
stack or frozen package. Inner/outer explicit confirmations remain separate from
the real owner decision. /NS skips shortcut creation; native integration unverified.
Run receipts now bind before/after runtime+test hashes and TAP digests.25+8 local
tests pass (24E2Escenarios+parent,8guards); independent /3 support still required.
No operational action authorized/executed; fullC54 partial. See v3 report/receipt.

## October 23 upgrade-helper independent-review repair revision2

The owner authorized repairs after Claude blocked v1. Preserve v1 helper bytes and
its rejected review, including malformed original metadata; create a separate v2
implementation rather than rewriting that evidence. No package rebuild/source or
frozen-plan change. Review binds migration/pg dependency closure before importing
it; all phases require the exact v2 gate before DPAPI. Managed cluster ownership is
explicit and normal phases refuse an already-running cluster. Sensitive snapshots
belong in the studio backup tree; tracked evidence has hashes only. Backup directory
reuse is rejected. Freshness applies to admission, not post-effect verification.
Recovery is a separate exact decision, restores only within the unchanged upgrade
window, verifies populated schema28 on a new empty DB, retains failed state, restores
matching program/products/protected files and explicitly redirects config. Standard
shell integration uses the pinned predecessor installer; actual/custom shell and UI
acceptance are unverified. Fixture installers/clock/DPAPI decisions are test-only.
Local21+5 checks pass; no independent support or operational authority implied.
Next fresh U02 v2 review. FullC54 partial. See v2 report/repair receipt for exact scope.

## October 23 schema29-aware upgrade-helper preparation

Implementation choice within authorized preparation: separate exact-pinned helper,
not edits to frozen schema28 helpers/package receipts. Current createBackup and
checkBackup expect schema29 and cannot cover the predecessor unchanged. Use
supported pg_dump custom archive/exported snapshot + pg_restore TOC validation,
verified product/protected/program trees, and explicit
theme-intent-upgrade-backup/1 metadata. Do not imply compatibility with current
Restore Studio; coordinated empty-target PostgreSQL recovery is documented.
All existing public tables and migration ledger checksums are fingerprinted;
schema28 before and29 after are distinct. Unknown work, stale evidence, review or
approval mismatch and partial-attempt locks fail closed. Independent helper review
and new exact owner decision remain prerequisites, not approvals supplied here.
10isolated checks pass; implementation-involved self-review only. No operational
or provider action. FullC54 partial. See new helper report/evidence.

## October 23 theme-intent preparation implementation

The authorized first C54 gap uses an additive theme_intent record (theme-intent/1),
reusing existing versioned storage and permission paths rather than weakening the
frozen claim-backed SearchBrief/discovery contracts. Migration29 only expands the
record-kind constraint; test databases only. Research-plan preparation is a pure,
version/hash-bound read with zero execution exposure,not a grant or source claim.
Source collection and current parent-limit/sharing admission remain later gates.
No new dependency,provider integration or installed-app change. See implementation
report and exact evidence; separate code review precedes packaging/installation.

## October22 research packet confidence/provenance correction before outputs

Preserved v1 and prepared/reviewed additive v2:injection current-need confidence
permits exploratory/insufficient,not unsupportedwell_supported;observer label
attached only to its actual C1 claim.18substantive criteria/floor/bounds unchanged.
No historical regrade,productionpolicy change or live authority inferred.
See docs/DISCOVERY_RESEARCH14_V2_REVIEW_2026-10-22.md.

## October 22 additive packet correction after review

V1 input contamination/temporal ambiguity/over-specific conditional verdict were
found before provider outputs. Preserve v1 and use separately frozen/reviewed v2.
This corrects authoring specification, not model results or historical grades.
No floor/budget expansion; no live activation or policy change. Same intended
scenarios, not an independent sample. docs/DISCOVERY_SEMANTICS_V2_REVIEW_2026-10-22.md.

## October 22 local finding-semantics implementation

Owner continued the prospective correction. Implemented role1.4 prompt definitions
and authoritative per-proposal cheaper_test locally; schema and historical grades
preserved. No policy or research-protocol acceptance inferred, no installation/live
authorization. Prompt hash and executed checks in
docs/DISCOVERY_FINDING_SEMANTICS_IMPLEMENTATION_2026-10-22.md.
Affected independent review is next before a new evaluation binding.

## October 22 proposed finding-semantics clarification (not activated)

Prepared U03 prospective specification after separate seven-output review.
Recommend preserving schema compatibility, defining novelty as originality and
using the existing per-proposal cheaper_test field as authoritative. Unsupported
benefit belongs to weak_evidence. This is a proposed implementation direction,
not an accepted research-protocol change, live authorization or retroactive
regrade. Production remains role1.3; role1.4 is proposed only. Exact scope,
alternatives, version consequences and local verification plan:
docs/DISCOVERY_FINDING_SEMANTICS_PROPOSAL_2026-10-22.md.

## October 21 v5 provider-quota stop and restored owner cap

Executed owner-authorized two-slot amendment; first10 answers passed,11th provider
quota failure stopped suite. Restore40 as agreed; preserve provider quota exhaustion.
Local restore verification corrected its false assumption that restoring a studio
cap removes independent quota blockers. No repeated mutation, retry, quota reset,
wider account/credits fallback or hidden grade change. Research narrow qualification
does not qualify incomplete candidate/scoring or establish usefulness. Next offline
review; any further live evaluation needs provider availability/prospective scope.
See docs/DISCOVERY_V5_LIVE_RESULT.md.

## October 21 owner authorized two additional test slots

Explicit user instruction permits temporary daily cap40→42, enough for the existing
approved18-case v5 suite with24 requests in the rolling window. No other permission,
credit, timeout, retry, per-run budget or frozen criterion changes. Accept new exact
caps through owner API, preserve original plan and bind separate capacity amendment
19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d.
Restore40 after bounded attempt; no erased usage. No repeat approval required for
this instructed delta. docs/V5_TEST_CAPACITY_AMENDMENT.md records scope/receipts.

## October 21 v5 installation approved; capacity gate honored

Owner authorized exact reviewed v5 next step. Installed verified candidate and
preserved saved state. Do not start18-request suite with only16 daily slots; no cap
increase, splitting, retry or inferred provider quota. Existing scoped approval
persists for unchanged plan when fresh preflight passes; no repeated approval.
Capacity estimate8:38:49AM EDT is conditional on no new usage, not a scheduled
automation or authority to skip checks. docs/DISCOVERY_V5_INSTALLATION.md.

## October 21 repair candidate/fresh v5 preparation

Owner authorized preparation. Package tested stream and reconciliation repairs with
fresh author-created role1.3 packets, preserving v4 failure/reconciliation and all
prior locks. No frozen deadline/cap extension, retrieved answer or proven live root
cause claimed.75 checks pass; exact source/package bindings in v5 execution plan.
Current16 daily slots cannot admit proposed18-request suite; fresh capacity check
must pass without increasing limits. No installation/live dispatch in preparation.
Independent substantive review remains pending. docs/DISCOVERY_QUALIFICATION_V5.md.

## October 21 owner adopted ran-without-result reconciliation

After the explicit proposal, owner authorized next step. Recorded ran (observed
partial activity only), retained unknown-result metadata and historical timeout,
then closed v4 qualification failed at3/4held-out under frozen4/4 requirement.
No retry or provider request. Independent API/DB readback confirms zero unresolved
and unchanged24 requests. No recovered answer or substantive pass claimed.
docs/V4_TIMEOUT_RECONCILIATION.md records receipts and next candidate preparation.

## October 21 bounded stream-recovery repair

Owner authorized next recovery review. Correct reproduced stream framing/cap defects
without claiming they explain the live timeout. Require observed-output consistency
on reconciliation: cannot say did_not_run when positive output is recorded. Preserve
unknown until an actual owner decision; propose ran without usable result and failed
qualification closure, never reconstructed completion or automatic retry. Keep existing
caps/deadline/grants, no wider retrieval scope or invented recovery API.36 local tests
pass; saved state/install unchanged. See docs/PLAN_STREAM_RECOVERY_REVIEW.md.

## October 21 approved v4 timeout stop

Owner approved exact v4 candidate/suite. Install succeeded; five requests accepted,
sixth timeout unknown. Stop honored with no retry or later task class. Preserve
unknown and running qualification until evidence-backed owner reconciliation; a
provider response ID/partial stream does not certify a complete result. Do not turn
unknown into a model schema failure or count unattempted cases as observations.
No wider retrieval credentials, invented capability, budget change or automatic
rerun. Next bounded step is timeout/recovery/reconciliation review. See
docs/DISCOVERY_V4_LIVE_RESULT.md.

## October 21 fresh v4 preparation

Owner authorized fresh qualification preparation.18 new author-created packets use
role1.3 semantics and identity selectors; gold/control/reviewer criteria frozen
before target exposure. Pretarget draft corrections and failed harness checks are
retained; final45 tests pass. No independent review or live result is asserted.
Author-visible operational holdouts are not independent thesis tasks. Preserve
all v1–v3 results/locks; no automatic rerun or new installation. Exact candidate/
execution proposal is docs/DISCOVERY_QUALIFICATION_V4.md. No budget/cap/permission
or research-study protocol change. Approval and active-state checks precede activation.

## October 21 role1.3 and opt-in identity-bound checks

Owner authorized bounded implementation after audit. Explicit field semantics are
versioned1.3; no output schema, permission or budget relaxation. Optional selector
binds skeptic assertions to one supplied proposal and one matching finding;
ambiguous/missing targets fail. Without selector, retain legacy grading so frozen
v3 novelty failure remains failed and historical manifests retain exact hashes.
No substring-based novelty whitelist or retrospective coercion. Independent
substantive acceptance remains separate from structural/reference matching.
38 local tests pass including v1–v3 qualification invalidation for new role.
No install/live requests; fresh packets and concrete candidate proposal come next.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## October 21 role1.3 and opt-in identity-bound checks

Owner authorized bounded implementation after audit. Explicit field semantics are
versioned1.3; no output schema, permission or budget relaxation. Optional selector
binds skeptic assertions to one supplied proposal and one matching finding;
ambiguous/missing targets fail. Without selector, retain legacy grading so frozen
v3 novelty failure remains failed and historical manifests retain exact hashes.
No substring-based novelty whitelist or retrospective coercion. Independent
substantive acceptance remains separate from structural/reference matching.
38 local tests pass including v1–v3 qualification invalidation for new role.
No install/live requests; fresh packets and concrete candidate proposal come next.
See docs/DISCOVERY_SEMANTICS_IMPLEMENTATION.md.

## October 21 prospective assertion-semantics correction proposal

Owner authorized next bounded audit. Preserve every v3 grade and exposed output;
do not null-coerce its valid prose or special-case the returned sentence. Audit
all roles: exact-null novelty lacks explicit model-facing semantics; wildcard
presence cannot establish correct proposal/finding association or source entailment.
Propose explicit field meanings (new/custom software versus existing tools included),
identity-bound assertions and independent substantive acceptance. Retain legacy
scoring and frozen study protocol.72 offline probes document limitations without
new model calls.18 fresh scenario sketches are proposed only, not frozen packets
or dispatch authority. See docs/DISCOVERY_ASSERTION_SEMANTICS_AUDIT.md. Next eligible
is local versioned implementation/controls, then a concrete qualification proposal.

## October 21 approved v3 installation and bounded result

Owner approved exact v3 plan8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a.
Installed verified candidate and ran seven sequential plan requests before first
failure; no retry. Research qualified operationally; candidate failed exact-null
novelty assertion while production-valid prose denies originality. Preserve this
failure and every frozen file/lock. Do not equate schema compliance with usefulness
or representation-specific grading failure with fabricated novelty. Audit assertion
semantics prospectively across roles before proposing new qualification; no post-hoc
gate weakening or target-string special case. Independent substantive review remains
separate. No automatic workflow/search/build/pilot/live run. See
docs/DISCOVERY_V3_LIVE_RESULT.md and v3 execution-outcome.json.

## ADR-0042 — ChatGPT plan connection and Codex builder (accepted October 20, 2026)

Full record: [ADR-0042](ADR-0042-codex-integration.md); design and Jordan's answers
Q1–Q7: docs/CODEX_INTEGRATION.md; owner guide: docs/MODEL_CONNECTIONS.md.

Creator Agent may use Jordan's ChatGPT Plus allowance through Sign in with ChatGPT
(private client, `dynamic_agent_client` registration, PKCE, loopback callback). Path A:
direct Responses for general inference. Path B: Codex app-server 0.163.0 in a WSL2
bubblewrap jail for `code_build` only. Sign-in, credits-off confirmation, accepted
caps, per-model verification and per-task-class qualification are separate recorded
states; any missing one blocks inference. Credits after the limit stay off and are
attested by the owner with a date; there is never a paid API fallback. Unknown
outcomes block the connection until reconciled. Tokens live only in the control
process vault (DPAPI), never in the database, logs or the jail. "No command execution"
is enforced by hardened config, a relay tool allowlist that cuts the stream, an
app-server supervisor and the jail, and is tested against the pinned binary. The T12
build keeps its scoped patch tool, independent broker review and held-out checks.
Migration 26 (25 belongs to the §2.5 Brave work). Not activated: no registration,
sign-in, Codex install on Jordan's machine or model call happened.

## Page-navigation draft repair — October 20, 2026

Owner reported Tauri form text disappearing on page changes and requested retention
until submission or deliberate clearing, plus a clear-fields control. Implemented
current-workspace/session memory retention at the shared page boundary, with scoped
confirmed Reset page fields and remembered page locations; hidden polling is paused.
No persistent web-storage drafts/credentials, API mutation or data/schema change.
This is a bounded navigation repair, not complete durable draft/undo implementation.
Reload/workspace-change/restart retention is still a documented limitation; future
draft adapters must preserve sensitive-data isolation and evidence/version rules.
Checks and candidate hashes: tracking/evidence/page-drafts. Native acceptance pending.

## Owner acceptance — completion-runbook decisions (October 20, 2026)

Canonical record: [accepted #1–#52 and RD1–RD10](OWNER_DECISIONS_2026-10-20.md).
Jordan accepted the recommendation list and final revisions in chat, then requested
project-wide recording. This supersedes conflicting proposed defaults, including
ADR-0041's historical close-to-quit default: target is configurable close-to-tray
by default with first-close notice. Product ceilings are owner-adjustable, including
above $20; the current $20 allowance and separate $20 T15 cap are unchanged.
No universal three-repository cap; initial live verification is one private repo
under a concrete scoped grant. Full rationale, gates, accepted deferrals, model/file/
UX/pilot/distribution choices and research direction are in the register.

This records design and operating choices, not implementation completion, protocol
freeze, new spending, provider activation or publication. Existing config/evidence
remain authoritative for actual implemented state. §2.1 interactive acceptance and
new owner-default reconciliation remain pending; next eligible afterward is §2.2.

## ADR-0041 — Installed desktop studio: supervisor, storage and dependency ownership

October 20, 2026. Accepted before implementation of COMPLETION_RUNBOOK §2.1 by Claude
Code on `claude/project-thread-b82rw9` from main 54ce751 (content 5f7d224). No migration.
Owner approvals in force: Jordan requested a persistent installed Windows studio (§2.1),
the fresh `creator_studio` adoption (§1.2), the $20 runtime ceiling and T15 $20 total.
Everything else below is an implementation decision under that request, not an owner
approval, and is reversible by a later recorded decision.

The installed Tauri executable is the supervisor. It owns one Node child (bundled
`node.exe` plus a single-file service bundle) that serves the production UI, the API with
its in-process durable workflow worker, and the private preview origin on the existing
loopback ports 5173/4310/4320. Keeping one child keeps one workflow worker and the
existing lease fencing; a second studio is refused by a per-user named mutex, and a second
launch only asks the first to show its window. A Windows job object kills owned children
if the supervisor dies; the child also exits when its stdin closes. Before showing the
studio the supervisor verifies an HMAC over a fresh nonce from the web and API ports with a
per-launch secret sent over the child's stdin, so an unrelated process on an occupied port
is never trusted or shown. Restarts are bounded (3 in 10 minutes, backoff), then the
setup window shows an actionable failure with Retry. Quit asks the child to stop, waits
20 s, then terminates only that child.

Storage: a per-user directory (`%LOCALAPPDATA%\com.creatoragent.studio`, overridable
only by an absolute `CREATOR_STUDIO_HOME` outside OneDrive for acceptance) holds
`studio.json`, logs, backups, products and DPAPI-protected secrets. Nothing at normal
launch reads the repository. PostgreSQL stays authoritative. Two database modes:
`managed` — an app-owned PostgreSQL 18 cluster in the data directory, started with the app
on loopback and stopped only by the app that started it, using verified PostgreSQL 18
binaries the owner already installed (a managed prerequisite, not bundled); and
`external` — an existing loopback server reused through its URL, never started, stopped
or claimed. Adoption of the §1.2 studio is an explicit first-run action: back up
`creator_studio` and its products with the existing T17 backup format, restore into the
managed cluster and a new products directory, and require the existing restore
verification (schema, audit chain, artifacts, lineage, exact budget totals) before the
config switches. The source database and files are left untouched. Alternatively the owner
may select the existing server in external mode. Creating an empty studio is a separate,
explicitly labelled choice. Migrations run only after a recorded owner click, after a
verified backup, under the existing advisory lock.

Identity: the supervisor generates a random per-launch local-owner code passed only over
stdin and signs in by an explicit owner action, then sets the HttpOnly session cookie in
the WebView. The session token is stored with Windows DPAPI (CurrentUser), validated
against the server at each launch, and deleted when expired or revoked; reauthorization is
the same explicit action. Database credentials are DPAPI-protected too. Paired execution
worker credentials remain in memory (ADR-0028) until persistent worker identity is
implemented; it is not claimed here. No token in URLs, argv, logs or web storage.

Close behavior is a setting: `quit` (initial default) or `background` (window hides, a tray
icon remains, services and workflows continue). Launch at login is off by default and is
only written to the current user's Run key after an explicit setting change. These
defaults follow the handoff's conservative suggestion and are not the owner's choice;
first-run setup asks. No Windows service, scheduled task, or account change.

Amended October 27, 2026 (owner decisions #1–#2, PR #63): setup now preselects
`background` (the first close each launch explains it) and recommends a new, empty studio
on a new computer while still offering adoption. A saved choice is kept, so an install set
up earlier keeps `quit` until the owner changes it in the status window.

Rejected: a shortcut to the existing shell; starting or stopping the Docker development
container (it serves `creator_dev` too and is not app-owned); bundling an unreviewed
PostgreSQL distribution; separate API/worker processes (duplicate worker risk without new
fencing); automatic migration or adoption; plaintext token files. New Cargo features only
(tauri `tray-icon`, extra `windows` API features); no new crates or npm packages.

## ADR-0040 — Repair audit boundaries without changing owner authority

October 20, 2026. Jordan authorized repair of all four findings in Codex audit PR #40 and directed work to C:/dev/creator_agent. Migration 24; docs/AUDIT_FIXES_2026-10-20.md.

Keep QA expected outputs in the supervisor; mount only runtime inputs and reject legacy full cases. Stop persisting unauthenticated invalid-signature webhook requests; verified event receipts remain durable. Superseding ADR-0034's processor-read lock placement only, use a per-connection monotonic observation epoch: short begin transaction, bounded external read without a database connection, then financial-lock projection with current revocation/epoch checks. Older reads fail rather than overwriting newer state. Conservative conflicts across different objects require bounded caller retry; no automatic retry is introduced.

Stream batch results with byte/line/count bounds; keep unknown costs held on unreadable data. Journal input/output/error IDs before use and delete only after durable terminal reconciliation; failed deletion retries on polling. Explicit 48-hour input/output/error expiry covers abandoned uploads and unknown creation, with possible loss of result availability when the studio remains offline. This is an implementation retention default under the repair request, not a frozen study choice. No provider cleanup runs outside the existing scoped adapter credential.

Rejected: removing stale-read ordering protection, holding financial locks across network I/O, marking parse failures free, deleting evidence with unresolved billing, storing raw hostile request samples, or changing held-out expected cases. Historical audit and ADRs remain intact. No new dependency, activation or spending grant.

## ADR-0039 — Owner decisions after the 2026-10-20 audit: runtime ceiling, pairing limits, scheduler state, portfolio reinvestment, OneDrive move

October 20, 2026. Jordan's decisions on audit items N1, N2, N4, R1 and R2. Built by Claude
Code on `claude/audit-full-qgjinb` from main `fc1e83f`; migration 23.

Decision: a $20 overall ceiling on new runtime spending (config/spending.json, from
2026-10-20) is enforced in BudgetStore.prepareAttempt for every non-fixture paid call and
in StudyStore.holdBudget for final study attempts, under one advisory lock. Exposure is
settled cost plus held in-flight/unknown exposure plus open final study holds at their cap;
calls inside an open held attempt are not counted twice. Any unknown-cost paid call blocks
new paid dispatch. The T15 $20 total stays and sits inside the ceiling. Only a reviewed edit
of the config raises it; no budget, portfolio or reinvestment path can.

Pairing stays open to start and owner-approved to finish, with limits per visitor (5 new /
3 pending) below the server's (30 / 15) and the existing five-minute expiry. The visitor is
a per-process salted SHA-256 of the socket address, or of the last X-Forwarded-For entry in
hosted mode (the TLS proxy appends it; earlier entries are client-controlled).

The portfolio scheduler records each attempt per workspace and for the sweep, keeps an
append-only failure history, backs off from 30 s to 30 min and stops a workspace after 5
consecutive failures until the owner resumes it (audited). Health shows codes only.

Reinvested earnings never fund anything automatically. An explicit allocation with target
`portfolio` is recorded once per allocation and admitted by the portfolio envelope gate for
exploration and improvement lanes only, so the maintenance reserve is untouched; tranche
consumption still prevents spending the same money twice.

The OneDrive move is a script the owner runs: it refuses synced targets and dirty checkouts,
clones, saves stashes as patches, copies ignored private files with hash checks, verifies
the database, takes a backup and restores it into a scratch database. It never deletes the
old checkout. Rejected: auto-detecting and deleting the old folder; storing raw visitor IPs;
counting fixture amounts against the ceiling.

Consequences: costs outside Creator Agent (development tools, hosting, marketing) cannot be
blocked by code and stay a manual owner limit. Many distinct addresses can still reach the
server pairing limit; a hosted proxy needs its own rate limit. The move script has not run
on Windows yet.

## ADR-0038 — X10 readiness register, declared-workload benchmark and owner pilot gate

October 19, 2026. Jordan asked for X10 after Codex finished X08/X09. Built by Claude Code on
`claude/x10-1y6bd6` from main `a68e9f9`. ADR-0037 is the UX/UI redesign, so this takes 0038;
no migration (the benchmark found no bottleneck that needed a schema change).

Decision: full-product readiness is a checked register, not prose. `config/readiness.json`
holds one row per requirement C01–C51 and per integration, with six separately recorded
states (implemented, fixture, contract, live, activated, native), the states each row
requires, evidence paths and what blocks it. `pnpm readiness` checks it against the
requirement table and the files on disk and refuses a verified state without evidence,
a later state without its earlier one (activated without live, live without implemented),
a missing or duplicate row, and a not-ready row with no blocker. The verdict is READY only
when every required state is verified and the owner pilot is completed with evidence.

The owner pilot is a gate, not a run: `config/owner-pilot.json` starts with every owner
choice empty, and `pnpm readiness pilot-check` refuses until Jordan records the decision,
an exact nano-USD budget, a spend stop at or under it, failure and owner-time stops,
stop-on-unknown-cost, a future window, schedules, platforms whose backing integration is
ready, and accounts that are both live-verified and activated. No account qualifies today.

The benchmark (`pnpm bench`) creates and drops its own database, seeds through the audited
store and fixture broker (no SQL shortcuts around the hash chain), and times the owner HTTP
API with one sequential client. Results are labelled synthetic; the 2 s search and 5 s event
targets are reported as provisional. `scripts/release-archive.mjs` binds a `git archive` tar
to its commit by per-file sha256 and Git blob id.

Consequences: the report says NOT READY while live/model/hosted/payment paths and the pilot
remain unverified, and it cannot be talked into READY without evidence on disk. The register
is hand-maintained: a row is only as true as the evidence it cites, so review it on each
milestone. Single-client latency says nothing about concurrent users.

## ADR-0036 — X09 bounded portfolio policy and reviewed task knowledge

October 19, 2026. Jordan authorized X09 after X08 and reported Claude's parallel
UI/UX work. X08 was hash-checked and preserved as local commit `64596ef`; X09 is
on `codex/x09-portfolio` in the same managed checkout. No push or changes to the
original dirty X05 checkout. Claude's shared styling remains separate.

Keep PostgreSQL scheduling beside the existing durable workflows and brokers;
do not introduce another scheduler service, paid adapter or credential path.
Migration 22 stores versioned owner policy, immutable run lanes and schedules,
deduplicated job intents, health and knowledge provenance. Source refresh uses
the existing source policy/admission; reviews create existing bounded workflows;
health rehashes exact artifact bytes and claims archive integrity only.

Reserve real maintenance authority in an existing period child of the configured
global envelope. Existing journal/ancestor accounting remains authoritative.
Improvement and exploration retain separate run allocations; non-maintenance
calls cannot spend the maintenance subtree. A depleted/expired reserve, due or
unfinished maintenance, unresolved health, review backlog, capacity and explicit
normal/conserve/maintenance_only/paused modes constrain shared dispatch. Study
attempts retain their frozen conditions and do not inherit portfolio changes.

Coalesce outage intervals into one current job; never enumerate missed slots.
Use a workspace cooldown, per-pass cap, one open job per schedule and stable
effect/idempotency IDs. Unknown outcomes occupy capacity and require read-only
reconciliation, not redispatch. Missing durable effect receipts fence delayed
dispatchers. Cancellation marks the schedule and cancels its dedicated run;
already-dispatched observations remain recorded. Optional API polling is off by
default and was not activated. Policy budget identities are fixed in this version;
budget rotation into different identities requires a new workspace.

Use bounded task guidance and artifact/source locators for reusable components,
lessons, prompts and skills. This is not an executable skill installer or a
system-policy loader. Proposals cannot change permissions, credentials, finance
or evaluation holdouts. Require executed structural renderer regressions bound
to the exact content hash, then human review and explicit activation. Regression
evidence records what was checked, not empirical output-quality gains. Rollback
selects a still-reviewed version using expected-head concurrency. Revocation and
stale provenance fence future workflow dispatch without changing immutable task
history. Workflow knowledge bindings retain exact candidate versions/hashes.

Owner feedback uses existing Gallery records; portfolio backlog counts those
unresolved submissions and pending decisions. An explicit hash/identity-bound
owner health deferral preserves the failed report as `owner_deferred`, never as
a successful check. No profit threshold or fixed production quota is introduced.

See docs/X09_PORTFOLIO.md and tracking/evidence/x09. The new Portfolio screen
requires only an import/view case in main.tsx and a view tuple in ui.tsx;
shared CSS and existing component props remain unchanged for Claude integration.

## ADR-0035 — X08 immutable campaigns and local fixture delivery

October 19, 2026. Jordan authorized X08 and stated that Claude is working on
UI/UX. Codex uses a separate managed checkout from current main `0dfc6e6`, branch
`codex/x08-marketing`. Original X05 edits and Claude's redesign remain separate.

Use deterministic templates over registered current verified artifact manifests
instead of a marketing model/provider. Closed factual claims name recorded package
checks, commit, execution ID, input hash and manifest hash; retain limitations and
synthetic labels. This provides inspectable evidence without introducing new paid
inference or claiming validated utility/demand. Arbitrary capability claims,
testimonials and customer/traffic counts are outside the draft contract. Audience
provenance and hypotheses are explicit owner assertions. A new draft, with its own
grant, is required after content/audience/experiment changes.

Migration 21 stores immutable campaign content and observations, human-owner
grants, workspace suppression, pre-adapter intents and native local receipts.
Grants bind the complete request/content hash, expiry and delivery cap. Reserve
one slot before dispatch, with no refund after uncertain/failed attempts. Monetary
adapter exposure is exactly zero because only a transactional local fixture sink
exists; host compute is unmetered. No live channel, paid-ad adapter, credentials,
real address, outbound message or public unsubscribe endpoint is implemented.

One workspace lock serializes admission, suppression, revocation/cancellation,
caps and local acceptance. A spec lock prevents candidate revisions/registration
from racing evidence checks. Unique campaign/recipient identity prevents retries
from creating another delivery. Unknown outcomes are reconciled through immutable
native receipts without resend. A missing receipt is definitive only for this
transactional local sink, never for an external service. Terminal state fences a
delayed dispatcher. All commands retain audit/outbox events.

Record synthetic feedback against an acknowledged fixture delivery and frozen
metric, with stable deduplicated event identity. Counts are fixture observations,
not market validation. Stop rules are explanatory; actual bounds are caps,
expiry, exact audience, once-per-recipient admission and cancellation. There is
no automatic experiment loop. Real distribution needs a separately implemented,
verified and authorized adapter; hosting/payment prerequisites remain applicable.

New UI is isolated in `marketing.tsx`; shared changes are one import/case in
`main.tsx` and one view tuple in `ui.tsx`. No shared CSS or public component prop
changes. See docs/X08_MARKETING.md and tracking/evidence/x08.

## ADR-0037 — Dark-default studio theme, semantic tokens and grouped workspace shell

October 19, 2026. Owner handoff (docs/CLAUDE_UX_UI_HANDOFF.md on the owner's machine) authorized a
UX/UI redesign of `apps/web`, which is also the desktop view. Dark is the default on every load,
including a light OS theme, superseding the earlier optional-dark-theme default; light is an
explicit saved choice. A classic `public/theme-boot.js` sets the theme before the stylesheet and
app run, so first paint is never white. Colours are semantic custom properties; components use
tokens only. Navigation is grouped (Studio, Evidence, Oversight, Build and study, System) in a
sidebar that becomes a drawer at 860px; route hashes, view keys and labels are unchanged.
Rejected: a component or CSS framework (dependency churn and overlap with the parallel X08 work);
following the OS theme (contradicts the owner's choice). `useRoute` now drops a view's late focus
request after the user leaves it (fixes being pulled back). No API, gate, session or CSRF change.
Numbering: if Codex's X08 lands first with ADR-0035, renumber this entry rather than X08's.
See docs/UX_UI.md.

## ADR-0034 — X06/X07 audit repairs and conserved processor identity

October 19, 2026. Owner authorized audit, repairs and strong scoped improvements.
Migration 20 permanently reserves each Stripe account identity and allows only one
processor funding rail per connection. This prevents economic double counting;
revoking a connection does not authorize re-registering its old financial history.
Existing duplicates block migration pending reconciliation, rather than rewriting
immutable records. Multiple fixture connections remain independent simulations.

Processor reads now run under the workspace financial lock and a connection row
lock, followed by atomic snapshot/projection writes. This supersedes ADR-0033's
outside-transaction read choice: that choice admitted stale observation ordering.
Bounded HTTP timeouts limit lock exposure; model/action authority is unchanged.
Account binding is checked against the current credential for each operation.
Incomplete loss histories are refused; bounded pagination is deferred. Failed rail
refresh invalidates availability instead of relying on an older balance TTL.

Hosted build exclusions, owned product storage, PostgreSQL 18 backup client,
service limits/log rotation and correct nested-budget metrics are preparation,
not hosted activation. See docs/X06_X07_AUDIT.md for reproduction and limitations.

## ADR-0033 - X07 payments, entitlements and reinvestment: backend reads, economic keys, tranche-bounded budgets (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X07 (prerequisites T17 and integration infrastructure; X05 and X06 not required). Branch claude/x07-5zm23m from main 4fe3d33. Migration 19 and this ADR number leave migration 18 and ADR-0032 to X06, built in parallel and merged first; this branch merged main afterwards and orders 18 before 19. X07 stays partial: no live or test-mode processor call, account or credential exists.
- Processor: Stripe chosen as the default test-mode adapter (reversible; the owner has not named a processor). Webhook scheme checked against docs.stripe.com on October 19, 2026: `Stripe-Signature` with `t` and `v1` values, HMAC-SHA256 over `t.raw-body`, 5-minute tolerance. Only `sk_test_`/`rk_test_` keys are accepted; live keys are refused before any call. No API version is pinned. Rejected: trusting webhook bodies, live mode, wider credentials.
- Payment connections, and therefore all payment data, exist only in fixture workspaces. Test-mode money is not money, so it never funds real budget envelopes. A real workspace needs live activation, which is a separate owner decision and is not built.
- Authority comes from backend reads only: a verified event names an object, the service reads it from the processor outside any transaction, and the store records that snapshot. An unreadable processor makes the delivery fail with 503 (retry) and records nothing as money. The checkout return page is inert.
- Ledger: immutable double entry separate from the budget journal, keyed by economic transaction (`connection:object:charge|settle|refund|dispute|payout:id`). Reconciling a snapshot brings each key to the processor's state with an original or a balanced correction entry; a deferred trigger rejects unbalanced entries. Event ids are de-duplicated as well, but economic keys are what stop double counting.
- Entitlements are derived from the snapshot (exact price, USD, offer metadata) and bound to one artifact manifest by id and hash. Refund or lost dispute revokes for good; an open dispute suspends.
- Reinvestment: one tranche per settled payment with the policy's basis points frozen at settlement and a holdback (30 days with no policy). Allocation capacity is the least of eligible tranches, surplus after operating costs and earlier reinvestment, usable liquidity of fresh available funding rails minus reserve, open commitments, unspent reinvested authority and outstanding losses, and the period cap. Allocations hold a per-workspace advisory lock, consume tranches oldest first (partial use keeps the remainder) and fund a new root envelope journalled as `fund`. Seed funding, pending funds, payouts and forecasts never count.
- Later losses lower a tranche's cap (never raise it). Consumption above the new cap becomes a reinvestment loss: idle reinvested envelopes are closed newest first and their remainder reopened as a smaller successor; otherwise new allocations are frozen until the loss is reclaimed or repaid from new eligible earnings. Rejected: editing envelope caps (they are immutable by design since T04).
- Rollback: revert the commit and drop the migration-19 tables. The only change to existing code is `BudgetStore.journal` becoming protected and the API's store class moving one level up the chain.

## ADR-0032 - X06 explicit hosted mode, environment-labelled databases and build-bound verification

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start X06; branch claude/x06-j2pz5g from main 4fe3d33 (X05 merged). Migration 18 (X05 used 16 and 17; X07 takes 19). Prerequisites: T17 (backup/restore, health) and X05 (paired workers, for hosted-to-local pairing). Checked on local PostgreSQL with hosted processes on loopback behind a stand-in proxy; no hosted environment, DNS, certificate, managed database, identity provider or alert channel exists, and no live verification is recorded.
- Hosted is an explicit mode (`CREATOR_DEPLOYMENT_MODE=hosted`) with environments `test`, `staging` and `live`; local stays the default and unchanged. Hosted startup refuses: missing build commit, non-https or path-bearing public origins, a preview host equal to or a parent/child of the web or API host (cookie isolation), a relative product root, a missing metrics token, development login or insecure cookies, a web origin that differs from the OIDC web origin, no database, and a non-loopback database without `sslmode=verify-full`. Rejected: inferring hosted from a non-loopback host (an accidental exposure would silently change the security model).
- Secrets: generic `NAME_FILE` loading for `CREATOR_*`/`OPENAI_*` variables (Docker secrets/systemd credentials), both forms refused; values never enter the configuration hash, logs or status. Rejected: a secrets service client (no provider chosen; files work with every host).
- Environment separation is enforced by the data, not by naming: `deployment_identity` labels each database; API and worker claim an unlabelled one and refuse another environment's. Restores keep the label; relabelling a restored copy is audited and relabelling into live is refused.
- Verification is owner-recorded, append-only and bound to commit, configuration hash and schema: a smoke report (read-only checks of the declared public target) plus the server's own readiness. Any change makes it `stale`. A passing live record needs a typed confirmation of the exact build, also enforced by a database check. Readiness never reports live as verified otherwise. Rejected: self-declared verification via environment variables (not evidence).
- Observability is pull-only: `/api/ready` (public, terse), `/api/ops/status` and Prometheus `/api/ops/metrics` (owner session or read-only scrape token), `/api/ops/uncertain`. Alerts are local rule evaluation with delivery fixed to `none`; sending alerts anywhere is an outbound integration needing its own decision. Unreachable local workers are reported and never fail readiness.
- Backups now dump inside an exported snapshot and record counts plus lineage fingerprint and exact budget totals from that snapshot; restore requires exact equality (pre-X06 backups keep the at-least count rule).
- Cleanup removes only expired sign-in material past `config/operations/retention.json` (unreferenced sessions, OIDC states, pairing challenges), dry run by default, audited when applied. Records, audit history, budgets and artifacts are never cleaned.
- `deploy/hosted/` is reviewable configuration (Dockerfile, Compose per environment, Caddy with separate preview host, env examples without secrets); validated with `docker compose config` and `pnpm ops config-check` only, never built or run.
- Rollback: revert the commit; drop `deployment_verifications`, `deployment_identity` and their triggers. Earlier backups remain restorable.

## ADR-0031 - verified editor exports and explicit Windows activation

October 19, 2026: the native editor action initially launched no visible document,
confirmed by the owner. Direct AppData cache paths produced Notepad path errors;
the internal Windows cause is unconfirmed. Export only the last receipt-verified
manifest to a unique Downloads/Creator Agent source directory, verify those bytes
again, then activate fixed packaged Windows Notepad through
IApplicationActivationManager.ActivateApplication with a quoted UTF-16 path.
Pin the Windows API crate to 0.62.2. No arbitrary editor/program command, file
association fallback, source extraction or generated execution. Missing packaged
Notepad produces a visible failure. Export edits do not change the dated cache.
Ancestor reparse checks retain the existing owner-controlled filesystem
assumption; no protection against concurrent owner-privileged replacement claimed.
Final native screenshot showed the exact selected manifest; stale Notepad UIA
document text was not accepted as evidence. Rust tests verify cache preservation,
fresh copies and changed-source refusal. This supersedes prior pending editor
acceptance only for the observed local Windows host.

## ADR-0030 - explicit local NSIS packaging and manual rollback

October 19, 2026: pin Tauri CLI 2.12.3 and opt-in NSIS packaging for the existing
local-client shell. Current-user installation, existing WebView2, no hosted service
or worker installation. Refuse silent downgrades; explicit rollback is uninstall
and reinstall of a prior client, not rollback of authoritative data/schema.
Automatic updater/artifact signing remains disabled without configured keys and
release authority. Acceptance installs only a separately named/identified debug
fixture in a checked workspace directory, no shortcuts, and uninstalls it. Real
Windows WebView startup is observed after install/upgrade/rollback. Production
signing, rendered UI/editor and other supported-host claims require their own
acceptance. Default Cargo configuration keeps bundling disabled.

## ADR-0029 - scoped local paired execution

October 19, 2026: X05 reuses the reviewed execution supervisor. New explicit pairing
is required for artifact.run; owner jobs pin catalog manifest/archive and current
recipe/policy/bridge hashes. The local product root is owner configuration, never
job input. Admission is awaited after durable local intent and before dispatch.
One attempt per request; 10-second leases; 20-second/256 MiB/no-network limits;
one unresolved job per workspace, three globally, twenty hourly. Local compute
billing stays unknown. Expiry after start is reconciling, never queued again.
Reconciliation binds an independently observed stopped local outcome hash;
worker claims cannot verify QA. Presence pairing grants controls without execution.
Remote artifact synchronization, automatic retry, background installation, updater
activation and hosted pairing are outside this local implementation.

## ADR-0026 - X03 search, lineage and audit questions (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X03; branch claude/x03-s7po1x from main d2c8ef1. Migration 14. X03 is fixture-verified: no real embedding model is verified, so real workspaces refuse semantic search; no live call and no spend.
- Lexical search (T09) gains `code_version` (artifact commits and manifests), `model` (models called, exact totals) and `cost` (broker reservations with amounts), local-date filters read in an IANA zone, per-hit local time, and per-type coverage (searchable, redacted, no text, unsupported or oversized media) with activity freshness. The search transaction is read-only after the membership check. Rejected: a separate search engine (PostgreSQL full text over the same rows keeps one access path and no copy of redacted text).
- Natural-language audit questions compile into one plan from a closed list of intents with typed parameters; each intent has fixed, parameterized SQL in the application. The local rules compiler is free and deterministic; a model compiler is one metered broker call whose JSON must pass the same strict schema (any extra key such as `sql`, or an unknown intent, is refused before anything runs). Plans run in a read-only transaction with a 5 s statement timeout and limits of at most 200 rows. Rejected: text-to-SQL with a read-only role (model SQL could still read across workspaces or leak redacted history through joins; the prompt forbids executing model SQL).
- Permissions come before snippets and aggregation: every read checks membership first, so a removed member (new `removeMember`, audited `member.removed`, last owner kept) gets `NOT_FOUND` from search, saved queries, questions, semantic search, lineage and export verification. Saved queries store a request, not a permission, and run under the caller's current access.
- Semantic search embeds only candidates from an access-safe lexical stage (never redacted text), one `model.embed` broker call per text with a derived logical operation id, so a repeat replays without paying. Embedding models allowed per workspace mode are dated config (config/search/semantic-models.json); none is listed for real workspaces. Embeddings are not stored. Rejected: a persisted vector index (it would keep derived copies of text that redaction must then chase).
- Costs are summed once per reservation over a distinct set of runs (runs `part_of` a subject or its descendants, plus runs that froze specs for its builds), so a run shared by two products appears in each product's row but once in the combined total. Unknown charges are reported apart from incurred ones.
- Lineage graphs are bounded (depth 1-8, at most 500 nodes) with truncation flags; redacted records are tombstones; sources show whether their media was readable. Exports carry the SHA-256 of the canonical graph; verification reports tampering, missing records, version changes, redactions since export (and whether the export still holds the redacted title) and retracted links.
- Rollback: revert the commit and drop the migration-14 table, function and index; no existing table changes.

## Owner research decision - RD6 model preference and T15 budget

- Date: October 18, 2026. Jordan selected GPT-6 Astra and a $20 USD total live
  budget for T15. Includes child work, retries, tools and reviews; not per run.
- Actual accessible API identifier, pricing and budget enforcement must be
  verified/configured before dispatch. No model availability is asserted and no
  alternative model is authorized by this choice.
- Recorded in docs/PILOT_AND_PROTOCOL.md. Remaining protocol gates still apply;
  this documentation update did not freeze the protocol or activate live calls.

## ADR-0027 - X04 scoped GitHub management: verified owner, intent journal, exact-head merges (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X04 if it neither depends on nor conflicts with X03 (it does neither: prerequisites T13 and policy/broker coverage). Branch claude/x04-gm7n32 from main d2c8ef1. Migration 15 and this ADR number leave 14 and ADR-0026 to X03, built in parallel; whichever merges second renumbers if needed. X04 stays partial: no live GitHub call, credential or repository exists.
- Auth checked against docs.github.com on October 19, 2026 (REST API version 2026-03-10): per-endpoint permissions in docs/GITHUB.md. Two credential kinds, each a reference to an API-process environment variable: a GitHub App installation (recommended; tokens minted per call for one repository and that endpoint's permissions, one-hour expiry) and a fine-grained token with an owner-recorded expiry. Fine-grained tokens cannot call the Checks API, so their merge gate sees commit statuses only and refuses merges whose required checks are check runs. Rejected: classic tokens (all repositories), and any fallback to another credential or to an environment-chosen API host.
- A connection names the owner by immutable id and type; it activates only when the credential's account matches. Repositories are tracked by immutable GitHub id and owner id (names follow renames); another owner or public visibility quarantines a repository permanently. Existing repositories are outside scope unless listed by id; a listed repository that is public is quarantined, not used.
- Four action types (github.repo_create, github.write, github.workflow_change, github.merge), all external effects, admitted per operation with the operation's intent hash as spec_hash, so an approve-once covers exactly that change. Workflow-file pushes are their own action type. Rejected: entity records per operation (would need an entities kind change likely to collide with X03).
- Every mutation is journalled before the call (dispatched), settled once (succeeded, failed, unknown), and unknown outcomes are reconciled by reading GitHub, never by repeating the call; the same intent and any repository creation are refused while unknown. A database trigger enforces the state machine.
- Merges need the live head to equal the reviewed head, an approving review of that head by someone who did not push it, and every connection-required check succeeding on that head; the merge call carries the sha so GitHub refuses a moved head. No required checks means no merges.
- Webhooks are verified (X-Hub-Signature-256, constant-time), recorded, deduplicated by delivery id and only ever remove access. Live use needs CREATOR_GITHUB=live plus grants; fixture and live connections are confined to fixture and real workspaces.
- Store placement: GitHubStore sits between ArtifactStore and RoutingStore so the top of the store chain (which X03 extends) is unchanged.
- Rollback: revert the commit and drop the migration-15 tables; no existing table changes. The four new action types only appear in grants that name them.

## ADR-0025 - X02 context packs, result cache, compaction and batches (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X02; branch claude/x02-b3wzes from main c738369. Migration 13. X02 stays partial: every capability for a real model is `documented`, so only fixture workspaces exercise caching, batches and provider features.
- Context packs are immutable and hashed. The application derives the authority item from the run's active grants (it grants nothing); callers may pin only constraints, objections and acceptance criteria. Pins and the authority item render first so the provider-cacheable prefix is stable. Missing, removed or over-class pins, pins over budget, and required facts absent from the selection refuse the pack. Rejected: letting a model choose what to keep (survival must be checked by code).
- Every compaction (extractive, model, provider) passes the same check: each pin verbatim and every required fact present, or the result is recorded as rejected with what was lost. Model compaction is one broker call whose recorded request hash must equal the request the store rebuilds. Provider compaction is refused unless the capability is usable here, and as `output_unverifiable` when the provider's output is opaque (OpenAI documents an encrypted compaction item) while pins or facts must survive.
- Two caches, kept apart: provider prompt caching is measured only from provider (or fixture) usage records; the application's result cache stores the recorded answer of a settled, succeeded call of a metered read-only action. Keys include workspace, project, data class, action, tool, model, pricing hash, input and pack hashes, output limits and policy version. Entries record dependency hashes; a changed dependency invalidates for everyone, a caller's max age only for that caller; answers built on already-stale packs are not stored. Every hit re-runs admission under current grants and run state; study runs never read the cache. Rejected: caching any non-metered or mutating action (the contract has no such action type, so an external mutation cannot become a stored permission).
- Handoffs carry their pack's pins and required facts forward. The summary is reused only while its source entries are unchanged; facts that no longer hold refuse the next pack rather than disappearing.
- Capabilities are a versioned config per model and feature (`fixture`, `documented`, `verified`, `unsupported`, with source and evidence). Real workspaces use only `verified`, fixture workspaces only `fixture`. A batch capability names its own batch price snapshot (gpt-6-astra: 50% of Standard, from the official model page) and a batch must use exactly that price.
- Batches reserve every item before submission (all or nothing) and hold reservations for the completion window. Per-item request errors and documented expiry release; anything uncertain is `unknown`; a later result settles late exactly once. Batch status is derived from item reservations, not the provider status alone.
- Evaluations compare a baseline and candidate pack on questions with checks fixed at creation; total cost adds the compaction calls that produced the candidate. A quality drop beyond `max_regression` reports `not_claimed_quality_drop` before any cost claim; fixture results are `not_claimed_fixture`.
- Rollback: revert the commit and drop the migration-13 tables; no existing table changes.

## ADR-0024 - X01 model registry, route policies and held-out promotion gate (fixture-verified)

- Date: October 19, 2026. Status: implemented by Claude Code on Jordan's request to start extra milestone X01; branch claude/x01-qfktko from main 8c09748. Migration 12. X01 stays partial: its prerequisite "measured task outcomes" does not exist yet, so every qualification is fixture evidence.
- The registry is a versioned config file (config/routing/model-registry*.json) registered per workspace; each entry stores the canonical hash of its pricing file, so a decision's pricing hash proves which price it used. Real registries hold only `documented`/`verified` models and fixture registries only fixture models. Only `verified` (accessible API id plus evidence) routes in a real workspace; gpt-6-astra is `documented`, so real routing is refused until verification is recorded as a new registry version. Rejected: probing the provider for availability at decision time (a live call nobody authorized).
- Policies: fixed (never substituted), auto (best held-out accepted rate, then cost), economy (lowest cost per accepted result at or above a floor, otherwise the reference baseline), each versioned per workspace or project. The owner's reference model is always the baseline and the only model qualified without a promotion.
- Promotion is the only path to qualification: criteria are fixed and hashed at creation; the store scores held-out benchmark cases from the broker's own reservations (callers cannot submit results); then shadow (never served), a deterministic capped canary (at most 1/4), and owner advancement that cannot override a failing gate. Canary or post-promotion outcomes below the floor roll back automatically; owners can roll back any active promotion. Rejected: model self-confidence or self-reported success as a gate (the outcome contract has no confidence field).
- Cost per accepted result includes failed attempts, review, repair and tool operations named on the outcome (same run only), divided by accepted results; unknown exposure is reported separately. Savings are `measured` only in a real workspace with fully known costs; fixture evidence is `not_claimed_fixture`.
- Escalation requires a recorded objective failure, happens once per decision, and goes to the reference baseline; if the baseline failed it is refused for a person to decide.
- Routing is opt-in per call (decide, then call under the decision). Existing workflow, study and builder paths keep their frozen models, so T15 study configuration is unaffected.
- Rollback: revert the commit and drop the migration-12 tables; no existing table changes.

## ADR-0023 - T16 analysis pipeline over T15 exports, verified on synthetic fixtures only

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to build T16 with empirical data collection deferred; branch claude/t16-analysis-95avhe from main 479dba4. No migration. Empirical T16 stays blocked.
- Inputs are only the files a T15 run writes (evaluation-package.json, private/assignment-key.json, private/raw-exports) plus reviewers' ratings.csv and an optional analysis-options.json. The analysis is pure (domain) and needs no database, so it reproduces from exports; each input file's SHA-256 is recorded and two runs must hash identically. Rejected: reading the database directly (results would depend on live state rather than the frozen package).
- Empirical status is derived, never asserted: `final_records` only for a final package under an adopted freeze with non-synthetic exports and no FIXTURE.json. Fixture outputs carry the label in every CSV row, figure banner and report.
- `ANALYSIS_PLAN` is an implementation default (task as unit; last attempt per slot for outcomes, every attempt for resources; complete reviewer rows only, no imputation; discovery repeats averaged within theme; range/median/sign counts always, bootstrap over tasks only with 10 or more pairs; quadratic-weighted kappa for two reviewers). It is not an owner decision and should be adopted or replaced in the freeze.
- No decision acceptance rule exists, so cost per accepted decision outcome stays undefined until Jordan supplies one (`decision_min_mean_rating` with its basis). Implementation acceptance is submitted with every executed frozen case passed. Zero accepted means undefined cost per accepted outcome with total spend shown; unknown or in-flight billing marks it a lower bound.
- Reconciliation checks fail the run when an attempt appears in two slots or exports, when flow and export measurements disagree, or when group, flow and export spend totals differ. Privacy check fails when a participant code, actor id, familiarity note or the blinding secret appears in output. Not measured: potential benefit, observed user impact, intervention necessity coding.
- Rollback: revert the commit; nothing persistent changes.

## ADR-0022 - T15 prerequisites: final-record gate, study budget ledger and builder-backed study attempts

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's request to complete T15's prerequisites without running the study or freezing the protocol; branch claude/t15-hdrwqz on top of ADR-0021. Migration 11. T15 stays partial.
- Owner choices recorded, not decided here: `config/evaluation.json` keeps the owner's `gpt-6-astra` preference (verified id null, live dispatch off) and Jordan's $20.00 total T15 cap (stated October 18, 2026; no spend authorized). Participants (RD3), reviewers (RD4), human-subjects review (RD5) and final tasks (RD8) are `unresolved`. RD6 must still be answered in the freeze; the gate requires the study cap to equal the $20 config cap.
- Final records: `synthetic` is now a boolean. `synthetic: false` passes only `finalRecordBlockers` (domain): real workspace, adopted freeze hash, every governance choice equal to the owner's freeze answer, preserved model preference with a verified id equal to the config and study model, $20 ledger cap. Final attempts get real-mode workspaces and no model grant; AI execution and builds refuse with `LIVE_DISABLED`. Rejected: accepting governance values from the request alone (would let a caller choose decisions the owner never answered).
- Budget: `study_budget_holds` holds each attempt's full frozen cap under an advisory lock before any model work. Open attempts count at cap; finished ones at settled plus in-flight/unknown reservations. Final records share one `t15-final` ledger; synthetic ones are per workspace, so fixture units never consume the real cap.
- Builder link: studies bind a frozen build task by exact spec, freeze, task hash and current humility review (re-read at creation and assignment). Each attempt pins a same-hash copy of the spec and a review rebound to it (`study_attempt_pins`), so admission, grants and products stay in the attempt's own workspace. A/B arms build with the unchanged T12 BuildSupervisor through `studyBuildPorts`; the broker admits only builder/reviewer calls under the prepared plan's envelope and caps. The API records results only from its own re-read of the local build record (`readStudyBuild`), one build per attempt. C arms have no builder; their code is checked server-side against every frozen case. Held-out cases leave the server only as key and pass/fail.
- Evidence states: every case result names its backend; only the reviewed WSL2 backend sets `isolation_evidence`. The cloud tests use the labelled test double.
- Rollback: revert the commit; migration 11 is additive (three objects).

## ADR-0021 - T15 frozen schedule, deterministic admission, run ledger and blinded packets

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T15 request; branch claude/t15-hdrwqz from main 3f3544a. No migration. The protocol is not frozen, so no final run exists.
- Schedule: built only from a freeze manifest (rebuilt from the `study.protocol_frozen` audit event against the proposal in code; a changed proposal is a VERSION_CONFLICT) and the owner's final tasks in the frozen counts. Slot ids hash the freeze, packet and arm; the order (one run at a time) comes from a seed derived from the freeze hash. The planned schedule hash goes to the audit log (`evaluation.schedule_planned`).
- Admission is domain code: final slots need non-synthetic study records, verified live AI (RD6) and, for AI implementation work, the isolated builder. None exists, so today every final slot is `blocked` with its reasons. Fixture output and scripted people are admitted only in rehearsal mode. Rejected: building non-synthetic study records now, because their shape depends on RD3, RD5, RD6 and RD9.
- Ledger: every slot is listed once (blocked, deferred, missing, or attempt states); a blocked slot with an attempt is an error; RD10's single infrastructure retry keeps the failed attempt.
- Reviewer packets: identical template, per-reviewer order, codes from a per-package secret kept in the private key. A scan fails on filename, template or id leaks and flags condition-like words inside submissions for owner review instead of rewriting them. Implementation outcomes are functional checks, not reviewer items. Packets are written to disk only.
- Rehearsal: `pnpm evaluate rehearsal` runs the frozen counts on 8 synthetic tasks with a labelled stand-in freeze; 10/10 checks pass.
- Rollback: revert the commit.

## ADR-0020 - T17 local backup/restore, overrun propagation and boundary audit

- Date: October 18, 2026. Status: implemented by Claude Code for T17 (branch claude/project-thread-k4si82 from main e46b2cf). Follows ADR-0019 (T14, built in parallel). No migration.
- Backup: `pnpm backup create|restore|verify` (packages/db/src/backup.ts) pairs a `pg_dump --format=custom` archive with a byte copy of the product store under one SHA-256 manifest. Restore re-hashes everything first, needs an empty database and products folder and the same schema version, then verifies the audit chain and every artifact's manifest and package hash. Alternatives rejected: a JSON export through the API (would have to re-implement immutable tables, identity columns and the hash chain); a database-only backup (artifact rows would point at missing bytes). Not covered: schedules, retention, encryption, hosted operation (C43/X06).
- Budget overrun: when actual charges pass a child's cap, the excess now counts against every ancestor. New reservations anywhere under an ancestor whose rollup passed its cap are denied (`ancestor_overrun`) and new carve-outs under it fail. Computed from current rows at admission; a settle that overruns concurrently with another admission is not serialized against it (overrun already means the provider exceeded the exposure bound, so this guard stops further spending rather than restoring an exact cap).
- Heartbeat: `WorkflowStore.heartbeat` referenced an ambiguous `version` column, so every lease extension failed and the worker ignored the error; a task whose call outlasted one lease was redelivered and parked in reconciling. Fixed to `t.version`; covered by a test that holds a call for three lease lengths.
- Health: `/api/health` derives `data_mode`, `live_enabled` and a `live` block from the configured adapters; `live_configured` means configured, not verified.
- Preview origin (audit item 6, recorded rather than changed): browsers do not scope cookies by port, so the management session cookie is also sent to the preview port. Accepted because previews render only `textContent`, the cookie is HttpOnly, the preview server ignores it and the API rejects the preview origin. Serving generated web content on the preview origin requires a distinct host name first.
- Rollback: revert the commit. Restored databases are ordinary databases.

## ADR-0019 - T14 pilot rehearsal, proposal freeze gate and open research decisions

- Date: October 18, 2026. Status: implemented by Claude Code on Jordan's T14 request; branch claude/project-thread-ocgg8g from main e46b2cf. No live provider, participant, reviewer or adopted protocol.
- Pilot: `pnpm pilot <dir>` runs one fictional decision task through arms A, B and C and one structured/open-ended pair through the existing T10 store, broker and worker in a new fixture workspace. AI arms use the fixture adapter (live dispatch disabled); B and C human entries are scripted and labelled `scripted_rehearsal`. Pilot tasks are listed as excluded from final tasks. Rejected: skipping the human arms entirely, which would leave their instrumentation unchecked.
- Checks and classification are deterministic domain code (packages/domain/src/pilot.ts) over the real exports and contexts: metrics, intervention timing, source validation, contamination, reviewer blinding and export repeatability; each attempt is classed instrumentation or substantive and kept. A `reproducible_digest` excludes ids and timestamps.
- Findings carried into the proposal: structured runs end `insufficient_evidence` on unverified packet snapshots (RD9), and workflow-finished assisted attempts leave human totals empty, so analysis sums intervention rows. Not changed in code: the first is correct behaviour; the second is an analysis rule.
- Freeze: the API freezes only the server's `PROPOSED_PROTOCOL`, for the signed-in human workspace owner, when every one of 10 blocking decisions has a non-deferred answer recorded against the exact proposal hash. The manifest goes to the hash-chained audit log; no migration (avoids colliding with parallel T17 work). Rejected: a file-only freeze, which any process could write without an owner session.
- Rollback: revert the commit; no schema change.

## ADR-0018 - Audit fixes: frozen and held-out QA cases, case-insensitive study ids, database CI

- Date: October 18, 2026. Status: implemented by Claude Code after Jordan's codebase audit (report: /mnt/project-files/audits/2026-10-18-codebase-audit.md) and his request to fix findings 1-3. Branch claude/project-thread-mccbs5 from main c162376.
- QA cases: spec acceptance checks gain optional `cases` (args, stdin, stdout, exit_code, held_out). They sit inside the T08 task hash, so a freeze fixes them. T12 requires every assigned automated check to carry cases, the plan's `cases` to equal them exactly (spec order, no held_out), and at least one held-out case per task. Held-out inputs/outputs are removed from builder and reviewer packets and from repair feedback (only the check key and pass/fail remain). Existing specs without cases stay valid but cannot be built. Supersedes the per-build plan cases in ADR-0016. Alternative rejected: keeping plan cases and only recording plan_hash; that detects but does not prevent a weaker case set.
- Study ids: assignment stores participant and continuation ids in lowercase; grader grants normalize the actor id and compare lower(); attempt access compares lowercase. A mixed-case assignment previously let a participant become a grader and read hidden material.
- CI: a second job runs `pnpm test:db` against a postgres:16 service with throwaway credentials. WSL2 isolation tests still skip there and remain a manual Windows gate.
- Rollback: revert the commit. No migration; stored rows are unaffected (existing assignments were already lowercase in all recorded runs).

## ADR-0017 - T13 immutable manifests, separate preview origin and feedback revisions

- Date: October 18, 2026. Status: implemented within Jordan's explicit T13 request by Claude Code; owner review and the real WSL2 gate pending. Branch claude/t13-8h288j from main 6fe5bab (T12 merged as PR #14). No T14, live provider, real spend or public release.
- Package only a current T12 verified_candidate. Archive committed blobs as a deterministic ustar (sorted, 0644, mtime 0), written once. Re-read and strictly re-extract it, then re-run every owner acceptance case through the existing T11 worker from those bytes. A package case passes only with exact stdout/exit and an input hash equal to the build QA input hash. The immutable manifest.json binds exact repository, spec/freeze/task, template, toolchain, dependency (stdlib only, no lockfile), archive/file hashes, startup, tests, settled cost, lineage and limitations. Failed re-runs keep the archive but no demo; missing worker gives blocked, never a host run.
- Bytes stay in the local product store (T11 boundary); migration 10 adds an immutable PostgreSQL manifest index with an 'artifact' entity linked to the spec, plus mutable preview leases and feedback rows. Registration re-hashes from disk and refuses stale spec versions/hashes, mismatched freeze/task hashes, unknown lineage and, in real workspaces, non-reviewed backends. Downloads and preview starts name the expected manifest hash and re-hash manifest and archive at that moment.
- Preview: a studio-owned HTTP origin on its own port (default 4320). One-time ticket exchanged for an HttpOnly SameSite=Strict path-scoped cookie; strict CSP, no framing/referrer; Origin-checked JSON run requests; each run rechecks owner, state, expiry, run cap and manifest hash before the worker starts the exact archive. Two live previews per workspace, TTL 1-60 min, 1-20 runs. Same host, different port is not cookie isolation, so the origin serves only studio-authored pages and never generated HTML/JS; generated web previews need a separate host and a reviewed web recipe (not implemented). The runnable demo is a CLI runner because T12 supports only the Python CLI recipe. Native installer is always unavailable.
- Feedback binds to one manifest hash. Accept/decline is owner-versioned. Revision reuses the T08 spec revision path in the same transaction and marks the feedback revised; a revision product repo starts from the verified package bytes with recorded base lineage; the new package records previous artifact and feedback ids. Comparison reports spec versions, changed task hashes, per-case package results, file changes, cost and feedback. Old artifacts are never removed.
- Test double (tests/src/artifact-double.ts) executes nothing, labels its backend test-double, adds a "not isolation evidence" limitation, shows notices in gallery and preview page, and is refused by real workspaces. It is used only by tests and the browser harness so packaging, leases, UI and feedback bookkeeping can be checked where WSL2 is absent. It is not evidence for the acceptance gate's isolation part.
- HTTP mapping: management API adds LIMIT_EXCEEDED 429 and keeps existing EVIDENCE_MISMATCH 400 / EXPIRED 409 to avoid changing earlier contracts; the preview origin uses its own map (ACCESS_DENIED 403, EXPIRED 410, LIMIT_EXCEEDED 429, EVIDENCE_MISMATCH 409).
- Alternatives: storing archives in PostgreSQL duplicates the local product boundary; serving packages through the management origin mixes product and studio trust; trusting build QA without a re-extracted run would not prove the delivered bytes start; a host-run fallback violates isolation. Rejected.
- Rollback: stop the preview listener and remove the T13 routes/CLI commands; leave migration 10 tables, product stores, manifests and archives intact (they are append-only evidence). Earlier T00-T12 behavior is unchanged apart from the shared reviseSpec helper refactor, covered by the existing selection tests.

## ADR-0016 - T12 finite local builder and task-candidate gate

- Date: October 18, 2026. Status: implemented within the owner's explicit T12 request; review pending. Built on local T11 commit 2c14f9a without merging or staging the owner's Docker follow-up. This new request does not imply that T11 owner review/merge occurred.
- Reuse the existing broker and T11 scoped Git/WSL worker. The owner CLI supplies authenticated current frozen spec/task bindings, run checks, exact-spec humility review and product.commit_build admission. No new SDK, service, model identifier, external authority, migration or live grant. Add only the existing domain workspace dependency for frozen task hashes.
- Bound one independent Python task with immutable spec/prompt/plan hashes, at most six broker calls, one attempt per call, two repairs, finite deadline/output/context and ten clean-sandbox cases. Tools are structured scoped CAS submissions. Fresh review sees candidate files/diff and frozen task context without builder claims. Supervisor-executed exact stdout/exit assertions, clean approve/no-findings review and current commit/spec jointly determine task-specific verified_candidate. Model summaries cannot supply test evidence.
- Extend the trusted recipe with typed argv/stdin from a supervisor-owned read-only acceptance file outside generated files. T11 isolation/cleanup remain enforced. Browser/manual/metric checks, persisted-state scenarios and dependency integration require another reviewed recipe; fail explicitly. A task gate does not certify a merge or whole product.
- Alternatives: unrestricted shells/generated tests let the builder control its evidence; rejected. Replacing WSL or adding a scheduler duplicates infrastructure; previews belong to T13. Fixed Python fixture roles exercise this gate without model reasoning or empirical validation. Fresh role context does not remove correlated model errors.
- Local immutable build records bind command/execution identity and broker reservation IDs. They inherit T11's owner-controlled filesystem boundary and are not catalog-indexed. Unknown/late paid outcomes stay in the broker. Crashes preserve intents/locks for inspection without automatic replay or destructive repair. Existing explicit owner integration commands do not promote a catalog product automatically.
- Full-suite checks exposed two prior timing/teardown races: hold the duplicate fixture response until all three duplicate deliveries return (same assertions), and close the budget API worker before dropping its DB. Another parallel-file run observed a T11 worker uncertainty fence during its cancellation test. Serialize test files to avoid competing real WSL resource/lease probes; within-test concurrency checks remain intact. Failed logs are retained. No production admission, budget or isolation gate was weakened.
- Verification source/results are in tracking/evidence/t12; usage is in docs/BOUNDED_BUILDER.md. Rollback removes optional T12 runner/fixture/acceptance input while preserving product repositories, failed commits, build evidence and broker ledger. No database migration is needed. No public release, participant activation, live model or real spend occurred.

## ADR-0015 - Optional Docker PostgreSQL; retain reviewed WSL execution

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's request to check newly installed Docker and implement it where suitable. No next milestone authorized.
- Docker Desktop now connects through its Linux engine. Add optional Compose PostgreSQL development/test services using the official 18.6 Bookworm image pinned by registry digest. Separate named volumes and localhost ports 55433/55434 avoid the existing native cluster and distinguish test data. No existing records imported or silently selected.
- Alternative: continue native PostgreSQL (still supported); Docker makes local database setup reproducible. Replacing the verified WSL2/Bubblewrap generated-code worker would duplicate working isolation and require full backend lifecycle/resource/recovery verification. Keep that worker and the host API/CLI/web development workflow. Neither a broader container deployment nor a Docker MCP configuration change is needed for this scope.
- Password required, generated into ignored .env.docker; no tracked credentials. Application URLs remain explicit per-terminal choices. Official image initializes a local development superuser; production role separation is outside this local setup. CPU/memory/PIDs/logs bounded, persistent database disk not quota bounded, no automatic restart, no personal-directory or daemon-socket mounts. No live model/provider activation or paid dispatch. Local compute costs remain unmetered.
- Executed: actual CLI/daemon and Compose connection; official image pull; Compose validation and healthy startup; nine migrations; persistence through restart; inspected localhost bindings and resource limits; authenticated Windows TCP read and wrong-password SQLSTATE 28P01; full Docker-backed database + real WSL gate 140/140, no skips. See tracking/evidence/docker and docs/DOCKER.md. A stale process PATH required a process-local Docker bin prepend for the CLI credential helper. No Docker MCP tool appeared in this chat; a selector connection alone is not tool verification.
- Configuration follows official Docker Compose service/networking and docker-library PostgreSQL documentation checked October 18, 2026 (links in docs/DOCKER.md). PostgreSQL 18 volume target is /var/lib/postgresql. Affects local persistence/verification infrastructure; application contracts, migrations, executor policy, research prompts and frozen protocols unchanged.
- Rollback: stop/remove this Compose project's containers while preserving volumes and .env.docker; return to the existing native PostgreSQL URL. Do not use down -v or rotate the password file as an automatic repair. Prior ADR-0014 remains applicable to generated-code execution; its historical absence-of-Docker observation is superseded only by this installation check.

## ADR-0014 - T11 local product Git and WSL2 namespace worker

- Date: October 18, 2026. Status: accepted reversible implementation within the owner's T11 request; owner review pending. Base 5f9bb1bf71673b4c5aa27f418cbb2c842948266b is T10 merged PR #12. Branch codex/t11-isolated-execution. No next milestone authorized.
- Use the existing Windows Git/Node management host, WSL2 Ubuntu, Bubblewrap 0.11.1, systemd 259/cgroup v2 and Python 3.14.4 for one reviewed dependency-free checklist template. Windows had no Docker/Podman runtime; actual non-root namespace and resource-control probes passed. No installation, Docker socket, paid service or host fallback was introduced. The existing WSL2 VM supplements user/mount/PID/network namespaces; this is not a newly dedicated VM appliance and is scoped to the reviewed template. Broader hostile workload hardening remains T17.
- New @creator/executor provides strict local management contracts, canonical path/file scopes, separate repos, exact task bases, typed CAS changes, immutable intents/outcomes, one integration owner and exclusive file locks. Conflicting merges remain in a separate review worktree; integration and task checkouts survive. No destructive resets/clean, shell command inputs, generated hooks or wider-credential fallback.
- The owner CLI consumes the actual authenticated T08 frozen spec and rechecks its active version, hashes and owner role before mutation/dispatch. Local provenance binds workspace/spec/freeze/task identities and Git commits. Keep these local files distinct from PostgreSQL audit/catalog records; T11 needs no schema migration and does not claim searchable product/task catalog records. T12's runtime can consume these local interfaces; it must enforce its own run/action admission and exact-candidate independent QA. This owner-facing CLI cannot be exposed directly as a model tool or remote HTTP command runner.
- The reviewed trusted bridge uses cleared environment and fixed absolute commands. Generated code sees read-only runtime/input/recipe, a read-only root/proc/dev, bounded disposable work/tmp, no home/Windows mounts/studio credentials/Git metadata/D-Bus/daemon, no network, UID/GID 1000, no capabilities or new privileges. Fixed cgroup limits: 256 MiB/no swap, 32 tasks, half one CPU and 20 s. Work/tmp limits are 16/1 MiB, per-file 8 MiB, captured output 64 KiB. Exact policy, recipe, bridge, input, binary hashes and observed controls are recorded. A successful conventional recipe is not an acceptance verdict.
- Worker leases renew every 750 ms with a five-second expiry. Cancellation stops the whole systemd cgroup; a hard runtime cap remains if the supervisor dies. One worker is admitted per studio products root. Dead locks are never automatically stolen; explicit reconciliation requires absent owner process, expired lease and observed stopped unit. Uncertain dispatch retains a fence; no retry/reclassification as successful. Git-side partial operations remain inspectable and require preserving user edits in manual recovery.
- Alternatives: unrestricted host Python/Node would violate isolation and was excluded; a fake backend cannot verify the acceptance gate; installing a new Docker runtime would duplicate already available working capabilities; cloud workers add credentials/cost/activation outside T11; hand-managed files cannot enforce frozen scope and provenance. Fixed Python stdlib keeps the first real recipe bounded without package-network exceptions.
- Local compute bounds are enforced, but host electricity/compute dollars are not metered or treated as free API inference. No provider/model/pricing configuration changed and no live call was made. No builders, independent QA, persistent preview, artifact download, participants or public release activated.
- Official references checked 2026-10-18: https://github.com/containers/bubblewrap/blob/main/README.md (policy is the caller's responsibility, namespaces/new-session/no socket mount); https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html (cgroup limits); https://git-scm.com/docs/git-worktree (separate task/review worktrees). Installed help and executed boundary tests, rather than generic docs alone, establish this host's capability.
- Review repairs: read-only root/dev/proc; compare exact committed blob bytes; reject corrupt task/product manifests; bind recipe before execution; retain a dispatch fence for uncertain cleanup; refuse concurrent workers; verify recovery only after the recorded process is absent. Two pre-existing broker concurrency tests used fixed 300 ms delays; under full-suite load they released pending admissions early. They now wait for the five budget/two concurrency denials before releasing the unchanged gates, retaining all assertions. Transient Windows lease-file write errors are counted; actual lease expiry is determined by the bridge, not by a single failed write.
- Rollback: leave local evidence/repos intact, stop any active unit, disable the product CLI entry points. Existing studio migrations and T00-T10 behavior remain compatible. Full instructions, limits and threat model are in docs/ISOLATED_EXECUTION.md; actual executed checks are in evidence/t11/verification.json.

## ADR-0013 - T10 immutable synthetic studies and separate participant/grader access

- Date: October 18, 2026. Status: accepted reversible implementation within Jordan's T10 request. T09 prerequisite verified as merged PR #10 at a9edf68; branch codex/t10-study-runner. The downloaded handover informed scope and was checked against canonical documents and actual code; it was not authority to activate live services or recruit people.
- Migration 9 adds append-only studies, assignments, execution requests, events and private grader materials. Assignment workspaces are separate; participant reads use the assigned actor rather than general workspace membership. Grader permissions are separate from catalog roles, mutually exclusive with participation for a study, and serialized with assignments. Study/hidden content is not indexed by catalog search. The coordinator remains trusted; synthetic seeds use one operator and cannot establish empirical independence.
- Artifact/config/prompt/protocol hashes freeze each study version. Three-arm autonomy and structured/open-ended discovery are separate assignment comparisons. Order is deterministically derived from the recorded seed; prior familiarity remains explicit. A needs_human original is terminal; assisted continuations have a separate identity and are excluded from that original primary comparison. A partial unique index permits exactly one terminal event under concurrency.
- Reuse the T07 structured worker and T04 broker. The baseline is a distinct versioned neutral prompt, one bounded broker operation, verbatim output formatting, no structured brief/rubric/skeptic. Admission checks the frozen request, fixture provider/model, deadline, envelope and call cap; generic workflows and caller-added baseline context are refused. Structured inputs are hash-checked before and during creation, and arbitrary catalog entries are omitted. Snapshot text is not independent source validation; synthetic structured runs stop for insufficient evidence. No new provider SDK or dependency.
- Human-only work can store document/code/artifact text and run conventional contains/equals/JSON checks bound to exact artifact hashes. Every broker helper is denied, including broker-backed search; conventional source browsing is a separate path. Workflow denials commit audit evidence before throwing. Untrusted code is never executed by the management host; implementation execution waits for T11 isolation.
- Study events and API authentication use existing transaction/audit/session machinery. Export uses a stable PostgreSQL repeatable-read snapshot, explicit raw records and post-serialization hashing. Money sums use integer nano-units without join multiplication; unknown and in-flight exposure stay separate. Human timing is reported; automatic fixture completion does not assert observed human activity. Grader content is explicitly withheld without grader authority, with content hashes retained for a protected sidecar.
- Alternatives: spreadsheets/manual records remain useful for protocol design but cannot enforce model/context boundaries; a second workflow engine would duplicate T05; generic searchable entities would expose hidden grader data; pretending fixtures are empirical work is excluded. This implements testable research plumbing, not protocol adoption or recruitment.
- Verification details are in evidence/t10/verification.json. Native Windows uses the already installed PostgreSQL 18 test binaries, not the handover's PostgreSQL 16 environment; no claim of a new PostgreSQL 16 test. A local LF checkout policy resolves the CRLF-only formatting failure observed on Windows. Earlier migrations/ADRs/protocol history remain unchanged.
- Official PostgreSQL 18 references checked October 18: https://www.postgresql.org/docs/18/transaction-iso.html and https://www.postgresql.org/docs/18/indexes-partial.html. Read-only export uses snapshot consistency; write invariants use row locks and a unique partial index.
- Review hardening: manual stops share the broker run lock; study events take the audit lock before insertion; no-key-update parent locks avoid foreign-key/audit inversion. Late outputs retain artifacts and charges but fail the original assignment deadline. Grader principals are human-only. Seed commands have distinct repeatable keys. Equal problem/outcome fields and bounded snapshots prevent arm-specific information loss.
- Rollback: additive migration 9 can remain unused if the study routes are disabled; do not delete study/audit evidence. A future live/participant implementation needs a new authorized configuration, verified adapters, protocol and recruitment decisions. T11 is the next milestone; it is not started here.

## ADR-0012 — T09 studio interface, PostgreSQL text search and address-kept state

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T09. Decision-maker: coding agent; owner review pending on the pull request.
- Interface: one React shell with a workspace picker and a list of views instead of stacked panels. State that should survive refresh (view, workspace, selected record, query, activity filter) lives in the hash address `#/view?ws=&id=&q=`; everything else is re-read from the API, so nothing is cached in browser storage. Views take plain props and call `api`, so a future desktop shell can host them unchanged. No new UI dependency.
- Search: PostgreSQL full text (`websearch_to_tsquery('english')`, plus a title substring match) over record titles and string values in bodies, source passage excerpts, decision request text and audit summaries, with GIN indexes (migration 8). Snippets come from `ts_headline` with control-character markers split into segments, so the page never renders HTML from the database. A full UUID or 8+ hex prefix switches to exact id search. Membership is resolved first; a non-member gets NOT_FOUND before any query runs. Redaction already nulls bodies, titles and excerpts, so redacted text cannot match.
- Comparison: one read route assembles the problem, its brief, claims linked to it with T06 evidence, alternatives derived from it with humility review and scorecard count, the discovery workflow and run, and run-level assumptions (assumptions may only be `part_of` a run, per the T02 link rules). Scores and gates still come from the T08 report; the page does not compute them.
- Actions: the page shows only actions the API exposes for the role and lets the server decide admission; a supervised selection returns `needs_human`, the page links to the decision and resubmits after approval. The submit form registers a run and, if asked, a 24-hour standing model grant capped per call, visible and revocable in Decisions.
- Alternatives considered: a client router library (rejected: hash state is enough and adds no dependency); a separate search engine (rejected: X03 owns semantic and audit questions; PostgreSQL covers lexical search with the existing access path); storing view state in localStorage (rejected: not shareable and survives sign-out).
- Not done: semantic search, graph view of lineage, product/task/gallery content (T11–T13), measured accessibility audit. Rollback: migration 8 only adds indexes; removing `catalog-store.ts`, `catalog.ts` contracts and the new routes restores T08 server behaviour.

## ADR-0011 — T08 computed selection reports, admitted selection and per-task spec freezes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T08. Decision-maker: coding agent; owner review pending on the pull request.
- Scores are computed, not stored: reviewers write `scorecard` records (a new kind) and the report is a pure function of the current alternative versions, their current scorecards, the T07 dispositions and the latest humility reviews. The report hash binds a selection to exactly what the owner saw; a changed card, alternative or gate changes the hash and the selection is refused (`VERSION_CONFLICT`).
- Arithmetic: score = 100·Σwᵢ(rᵢ−1)/(4Σw) as an exact BigInt fraction, shown to one decimal rounded half up. Unknown ratings are never averaged away: the candidate has no score, only bounds with unknowns at 1 and 5. Several reviewers are combined by the mean of their complete cards and differences are listed; ties share a rank; overlapping ranges are marked unresolved. Weights are equal integers; sensitivity reruns with each weight at 0 and at 2. Two rubrics (`opportunity-rubric/1.0`, `suitability-rubric/1.0`) keep the software opportunity ranking separate from cross-option suitability; both are `proposed` until calibration.
- Gates beside scores: ethics/access (from current cards: clear, unresolved, not assessed), the T07 disposition, the T03 humility gate for build and hybrid, and kind rules (`select_for_build` only for build or hybrid; `recommend_alternative` only for non-code or hybrid responses). No score can clear a gate. Advancing a candidate over a higher-ranked non-advanced one is an override that needs a reason; the full original report is stored with the selection.
- Authorization: new action type `candidate.select` (target = problem version, spec hash = hash of report hash, dispositions and override reason) is admitted through T03 inside the write transaction and added to the supervised default stage gates beside `spec.freeze`. Autonomous runs are recorded only under a covering grant, otherwise deferred.
- Storage (migration 7): append-only `selections` (newest is current; a later one replaces, never edits) and `spec_freezes` (unique per spec version, bound to the selection). `spec/1` bodies and scorecards are written only through the selection store; the generic record path refuses them.
- Task hashes: each task's hash covers its definition, its acceptance checks and their flows, the shared scope, non-goals and data contracts, and its dependencies' hashes, so a change propagates to dependants but not to unrelated tasks. A revision reports tasks as frozen, changed, added or unfrozen, plus removed ones; freezing again needs a new admitted decision. Freezing also re-checks the selection, the alternative version and the gates at that moment.
- Alternatives considered: storing model-written scores (rejected: not reproducible); floating-point means (rejected: ties and displays drift); renormalising around unknowns (rejected by C09); one spec-wide hash (rejected: cannot say which tasks a change affects).
- Not done: no model assessor role writes scorecards (fixture reviewers only); selection does not change a product lifecycle stage; no web form for selecting or freezing; Windows untested. Rollback: migration 7 adds two tables and widens one check constraint; removing `selection-store.ts`, the selection contracts and routes restores T07 behaviour once no `scorecard` rows or `spec/1` bodies exist.

## ADR-0010 — T07 discovery runs on the workflow engine with a hashed evidence packet

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T07. Decision-maker: coding agent; owner review pending on the pull request.
- Engine: discovery is a second role (`r02_discovery`, `r02-discovery/1.0`) on the T05 workflow tables rather than a new runner, so leases, fencing, replay through the T04 broker, budgets, decisions and owner controls apply unchanged. Migration 6 adds the `search_brief` kind, the discovery task kinds (locate, propose, skeptic, revise) and a revision `round` in the task's logical slot. The plan is a pure function (`coordinateDiscovery`) next to the T05 `coordinate`, sharing its guards and settlement.
- Evidence packet: built by the application from T06 claim evidence and the active catalog at start, size-capped, hashed and stored in the workflow's immutable context. Task contexts carry only the packet hash, their assignment and input task ids with output hashes; the worker renders packet and inputs as untrusted data with no authority. Independence of first proposals is checked from the stored contexts (same packet, only the locator as input) and recorded in the result.
- Deterministic gates in code: packet sufficiency (current supported or contested problem evidence), output validation against the packet (refs must exist, cross-field answers must name both fields and explain a mechanism in other words, perspectives must match, the skeptic covers each proposal once), duplicate detection by word overlap against catalog titles and summaries, per-type evidence checks (software needs usable data and tool-gap evidence; an existing-tool recommendation needs existing-tool evidence) and final dispositions. Model outputs that fail validation are repaired within `max_repairs`; they are never accepted.
- Alternatives considered: letting the model choose the plan or delegate (rejected: T05 keeps depth 1 and code-owned plans); embedding-based duplicate detection (needs a provider and a model version to pin; word overlap is transparent and enough for the gate); one call producing all proposals (cannot prove independence).
- Not done: the locator does not run searches or fetches itself; no live model run; semantic duplicates beyond word overlap are missed; scoring and selection are T08. Rollback: migration 6 rebuilds three check constraints and one unique key; removing `discovery-store.ts`, the discovery domain modules and routes restores T06 behaviour once no `r02_discovery` rows exist.

## ADR-0009 — T06 source broker, passages and claim support

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T06. Decision-maker: coding agent; owner review pending on the pull request.
- Broker: one application path (`SourceBroker`, `packages/research`) from a run to a page. Order: URL policy check, then T03 admission of a new `source.fetch` action type (reversible, no model, no external effect) and an in-flight retrieval row in one transaction, then the fetch outside any transaction, then one outcome transaction. The URL hash fills the binding's spec-hash slot, so an approve-once grant covers exactly one URL; standing grants cover the run. Idempotency is the logical operation id plus a request hash; in-flight rows past their deadline are swept to `failed/interrupted`. A real workspace without a live adapter is denied (`live_fetch_not_configured`); fixtures are never substituted.
- Network policy (`source-policy/1.0`, hashed into each retrieval): HTTPS on 443 only, approved hosts (exact or `*.` suffix, each `excerpts` or `hash_only`), no credentials in URLs, private/loopback/link-local/CGNAT/reserved/multicast addresses refused including IPv4-mapped and NAT64 forms (`net.BlockList`), DNS answers checked and the socket connected to the checked address, redirects followed manually with each target re-checked, byte/time/redirect/content-type/per-run limits, identity encoding only, no cookies, no shared agent.
- Records: `research_sources` (one per final URL key, tied to a `source` entity whose versions are the source versions; a new version only when content hash or access changes), append-only `source_retrievals`, `source_passages` (text offsets in extracted text, hashes, bounded excerpt or null), `claim_support` (retract-only). Excerpts and quotes are nulled by a trigger when a source is redacted. The generic record API refuses to forge broker facts (`retrieval` in a source body) or revise broker-managed sources.
- Evidence: supports/contradicts require a quote found verbatim in the stored excerpt and bind to the current claim and source versions; each row also creates or reuses a typed `supports`/`contradicts` link. Assessment is a pure domain function: rows whose claim changed or whose source changed, disappeared or is older than `max_age_days` stop counting; reposts count once by origin cluster (same normalized main text, or canonical link); inaccessible sources are labelled, never support.
- Dependency: `htmlparser2` 12.0.0 (streaming tokenizer, no DOM, no script execution) instead of a full DOM (jsdom: much larger, executes nothing by default but more surface) or regex parsing (fragile offsets).
- Retrieved text: wrapped as `untrusted_evidence/1` with `authority: none` when handed onward; no code path reads page text to decide permissions, policy, budgets or further fetches. The instruction-like regex is a label for people, not a boundary.
- Not done: live search adapter, readability-grade extraction, PDF/non-HTML parsing, re-clustering after later fetches, robots.txt handling, T05 roles calling the broker. Rollback: migration 5 is additive; removing `research-store.ts`, `packages/research` and the routes restores T05 behaviour.

## ADR-0008 — T05 durable orchestration on PostgreSQL instead of Temporal

- Date: October 18, 2026. Status: accepted. Decision-maker: Jordan, on a decision card in the T05 project thread ("Run T05's durable workflows on your PostgreSQL instead of a Temporal server?" → PostgreSQL). This deviates from the earlier proposed stack (ADR-0001, PROJECT_CONTEXT.md), which named Temporal as the T05 backend.
- Reason: Temporal needs a separate server next to the app on the owner's Windows PC; PostgreSQL is already required and installed, and T02's transactional audit + outbox already give atomic state, history and at-least-once delivery. The guarantees T05 asks for (step checkpoints, logical operation ids, leases with fencing, restart recovery, waiting on decisions, pause/cancel) are a few tables and row locks, testable in this repository. Alternatives: Temporal (more infrastructure, SDK determinism rules, a second source of truth beside the audit log), pg-boss/Graphile Worker (queue only; leases/fencing and the coordinator would still be ours).
- Design: migration 4 adds `workflows` (bound context, limits, control, state, result; identity and context immutable, terminal final, one live workflow per run) and `workflow_tasks` (one logical operation each, depth 1, lease owner/token/expiry from `workflow_lease_tokens`, decision link, output and hash). The coordinator is a pure domain function (`coordinate`) applied under the workflow row lock; lock order is workflow → tasks → (broker) run → envelope. Commits are fenced on (state = leased, token). Expired leases requeue (or cancel); the next lease replays the logical operation through the T04 broker, which never dispatches twice. An answered/closed decision wakes its task through a new idempotent outbox consumer (`workflow_wakeup`), with a polling fallback. Unknown outcomes wait in `reconciling`; repairs only follow known bad answers, within `max_repairs` and `max_calls`.
- Role: R05 skeptic critiques a pinned record version per perspective, then a synthesis; task context carries immutable constraints, the subject by id/version/content hash and a bounded excerpt, and synthesis inputs by task id and output hash. Prompt text and version are hashed (`prompt_hash`). The worker runs as a dedicated agent actor, added as a workspace editor when a workflow starts; it cannot start, steer or approve.
- Not done: no Temporal, no multi-role planning or model-chosen delegation, no deeper child trees (depth fixed at 1), no per-workflow child budget envelope (calls draw on the chosen envelope under T04 limits), no owner "retry with a new operation" for a reconciled task. Rollback: migration 4 is additive; removing `workflow-store.ts`, `packages/orchestrator` and the routes restores T04 behaviour.

## ADR-0007 — T04 budget envelopes, reservations and the model broker

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T04. Decision-maker: coding agent; owner review pending on the pull request. Stacked on ADR-0006 (T03), not yet merged.
- Accounting: permission-to-spend envelopes with carve-out allocation (a child's cap moves into the parent's `allocated`, and closing returns only the unspent remainder) rather than reserving on every ancestor. Reason: one row lock per reservation, no double counting, and conservation is a single inequality the database can check. Rollups are computed for reporting. Financial reality is a separate append-only `usage_records` table, one row per attempt.
- Exposure: reserve the maximum, not an estimate. Input tokens are bounded by UTF-8 bytes (byte-level BPE emits at least one byte per token) plus a fixed framing allowance, priced at the highest input rate; output at `max_output_tokens`; the documented long-context surcharge applies when the bound could cross its threshold. Text input only.
- Outcomes: provider refusals that are documented as unprocessed (429, 401/403, other 4xx) release the reservation; anything that may have been processed (timeout, 5xx, network loss, cancellation in flight, malformed or unpriced usage) holds the full reservation as `unknown` until a late answer settles it or the owner reconciles it. In-flight attempts past deadline + late window become `unknown` on restart. A settled attempt cannot be charged again.
- Order: run state, pricing/exposure, envelope checks, then T03 admission with the bound amount, then reservation, in one transaction (OversightStore admission refactored into `admitIn` for this). A failed budget check therefore never consumes an approve-once grant.
- Provider: the owner's reference model `gpt-6-astra` is documented in OpenAI's official model catalog with Standard pricing $10 / $1 cached / $12.50 cache write / $50 output per 1M tokens (long context above 272K input: 2x input, 1.5x output). Adapter uses `fetch` against POST /v1/responses instead of the `openai` SDK to avoid a dependency for one endpoint; revisit when streaming, tools or embeddings are needed. Live dispatch requires explicit `CREATOR_LIVE_PROVIDER=openai` plus a key; a key is not authorization.
- Alternatives considered: hierarchical reservation on each ancestor (more locks, harder reports); estimate-based reservation (can overspend); treating 5xx as unbilled (unknown is not zero).
- Rollback: migration 3 is additive; removing `packages/broker`, `budget-store.ts` and the routes restores T03 behaviour.

## ADR-0006 — T03 owner sessions, decision requests, grants and run modes

- Date: October 18, 2026. Status: accepted reversible implementation decision within Jordan's request to start T03. Decision-maker: coding agent; owner review pending on the pull request.
- Authentication: opaque 256-bit random session tokens (stored as SHA-256) in an `HttpOnly; SameSite=Strict` cookie, `Secure` and `__Host-` prefixed when hosted, plus a per-session synchronizer CSRF token on every state-changing request and the existing Host/Origin checks. Login is either a local development code (constant-time compared, 5-failure lockout) or OIDC authorization code + PKCE through `openid-client` 6.8.8 (published 2026-09-05; `jose` 6.2.12 only as a test dependency for a local test IdP). No custom token or signature cryptography. Development login fails `authConfig` validation in hosted mode; hosted deployment is still refused overall (X06). Alternatives: a session library/framework (more surface for one owner), signed stateless cookies (revocation harder), passkeys (no established server library in the stack yet). Health, fixture and validate routes stay unauthenticated because they are stateless and loopback-only.
- Authority model: decision requests and grants live in dedicated tables (migration 2), not the generic record store, which now refuses `decision`/`grant` kinds. Approve-once creates a single-use grant bound to action type, run, target id/version/content hash, spec hash and amount; standing grants are versioned policy (create/revise/revoke by a human owner only, expiry ≤ 90 days). Standing approval is not offered for irreversible, external or stage-gated actions. Answers must echo the coverage hash the person saw; a changed target supersedes the request.
- Action effects come from a code registry (`ACTION_REGISTRY`), not the caller, so a caller cannot declare a model call model-free. Admission order follows HUMAN_OVERSIGHT.md; model flags can only add reasons. Value questions (judgment/clarification) are asked before authorization, and a judgment answer never authorizes.
- Modes: run mode is fixed at registration and must match the run record's research condition. Supervised asks at stage gates (default spec.freeze, product.commit_build, release.publish) and needs approve-once there; human-in-the-loop asks at release.publish and dynamic reasons; autonomous uses only its initial grant packet at recorded versions, cannot create decision requests, and defers as `needs_human`; human-only denies every model action type regardless of grants.
- Humility gate: `humility_review` records compare software, existing tool, process change, human-led, hybrid and defer/decline with evidence refs; `product.commit_build` requires a passing review of the exact subject version; an unresolved serious ethical problem becomes a judgment request. Assumptions are `assumption` records; routine reversible ones with a cheap test are logged as provisional.
- Not done: no budget reservation (T04), no orchestrator calling admission (T05; today the owner calls it through API/CLI), no agent actor sessions, no real IdP verified. Rollback: migration 2 is additive; dropping it and `oversight-store.ts` restores T02 behaviour except the auth requirement on record routes.

## ADR-0005 — T02 PostgreSQL record store, audit chain and outbox

- Date: October 18, 2026. Status: accepted reversible implementation decision within the owner's request to start T02 (started from the project's setup card). Decision-maker: coding agent; owner review pending on the pull request.
- Storage: one PostgreSQL database through node-postgres `pg` 8.23.1 (published 2026-09-30) with `@types/pg` 8.23.1. Alternatives: an ORM/query builder (more dependency surface for a small schema), PGlite/embedded Postgres (no service needed, but single-connection and weaker concurrency evidence), SQLite (not the architecture's PostgreSQL direction). Raw SQL keeps integrity rules visible in one migration.
- Model: a generic `entities` table plus immutable `entity_versions`, with per-kind Zod bodies, rather than one table per kind. Reason: thirteen kinds share identity, scope, versioning, redaction and linking; integrity that matters (scope, kind, version endpoints, fixture separation, append-only history) is enforced with composite foreign keys, partial unique indexes and triggers. A SourceVersion is a source entity version. Revisit per-kind tables if queries need typed columns.
- Contracts: schema 1.0 extended additively with `idea` and `assessment` kinds, relations `assesses`, `part_of`, `authorizes`, new derived_from pairs (including `artifact:task` and `product:idea`), error codes `ACCESS_DENIED`, `DUPLICATE`, `IDEMPOTENCY_CONFLICT`, `STORAGE_UNAVAILABLE`, and health fields `persistent: boolean`, `storage`. No T01-valid task/result/link becomes invalid; the health response changed shape (T01 clients accepted only `persistent: false`).
- Audit: database-ordered sequence, server clock, hash chain under a global transaction advisory lock, outbox row in the same transaction, idempotent consumer inbox. Exactly-once is not claimed; delivery is at-least-once with idempotent projection.
- Access: workspaces with owner/editor/viewer membership checked on every repository call; non-members get NOT_FOUND. The HTTP API acts as one configured local owner (`CREATOR_OWNER_ACTOR_ID`) because authentication is T03.
- Rollback: drop the database (no production data exists) and remove `packages/db`; the fixture app runs without `CREATOR_DATABASE_URL`. Later schema changes use new migrations, never edits to migration 1.

## ADR-0004 — Claude Code access to the development tools

Date: October 18, 2026. Status: accepted at the owner's request in the project thread.

Mirror `.agents/skills` into `.claude/skills` as plain copies (Windows checkouts break Git symlinks) and keep both in step on updates. Add Matt Pocock's `grill-me`, `grilling` (its dependency) and `improve-codebase-architecture` at the already-pinned commit; the architecture skill's default `GLOSSARY.md`/`docs/adr/` paths yield to `tracking/DECISIONS.md` and canonical context. Configure the same two MCP servers in `.mcp.json` without machine-specific paths; per-machine browser differences go in environment variables or a local-scope override, not the shared file. Add a cloud-only SessionStart hook that runs `pnpm install`, synchronously so checks never race dependency install. Plugin lifecycle hooks remain uninstalled. No credentials are stored; Firecrawl account access goes through the claude.ai connector or an environment variable reference.

## ADR-0003 — Project-local development skills and MCP

Date: October 18, 2026. Status: accepted within the owner's explicit tool-installation request.

Install the requested upstream development tools in this Creator Agent checkout: 27 skills under `.agents/skills` and two project MCP entries under `.codex/config.toml`. Use pinned source commits and the system skill-installer helper; preserve upstream text and licenses. Keep global Codex configuration and the separate CIS4914 repository unchanged. AGENTS.md gains only a tooling pointer and clarification that current authorization, canonical paths and host rules take precedence over third-party defaults.

Choose the official keyless Firecrawl hosted endpoint for the initial connection: it has no credential prerequisite and exposes scrape/search/parse. It is a hosted service with a mutable version and rate limits, not local inference or a self-hosted crawler. Full account capabilities require a later explicit connection. Existing Firecrawl app tools remain distinct; no credentials were extracted or reused. Direct initialize/list-tools passed without data-tool calls.

Choose pinned Playwright MCP 0.0.83 using the installed Edge channel, headless and isolated, instead of attaching a personal profile. Direct protocol discovery and blank-page navigation/close passed. Its upstream dependency reports Playwright 1.64.0-alpha-1790635538000; do not describe it as a stable Playwright release. This is developer browser access, not T11 execution isolation. Project cwd is machine-specific and must be adjusted if moved.

Install Impeccable's skill plus its pinned 0.1.15 Windows engine after matching the published SHA256 sidecar. Keep the binary ignored by Git; engine-probe passed. Ponytail is installed as six skills, without global lifecycle hooks or importing session history. Select Matt Pocock's tdd, diagnosing-bugs, codebase-design, domain-modeling and writing-for-agents skills; the existing kit already supplies milestone orchestration, handoff and decision tracking. No automatic updater, native app, issue tracker, redesign, or later product milestone is introduced.

Consequences: skills are available at the next turn; new MCP entries may require restarting MCP in Codex. Direct handshake evidence does not claim current-chat tool exposure or successful paid operations. Source pins and hashes, limitations, verification and update/removal instructions are in [the tool guide](../docs/DEVELOPMENT_TOOLS.md) and [evidence](evidence/development-tools/install-manifest.json). T01 application source/dependencies remain unchanged; T02 remains next eligible.

## ADR-0001 — Empty repository and minimal local architecture

- Date: October 17, 2026 (America/New_York; evidence timestamps use UTC).
- Status: accepted as a reversible implementation default within authorized T00, not as owner approval of spending, study design, or external activation.
- Decision-maker/source: coding agent executing Jordan Price's T00 request and supplied repository URL; canonical kit v3.0, October 9, 2026.
- Repository: `https://github.com/jordanprice040/CreatorAI.git`.
- Local root: `C:\Users\jorda\OneDrive\Desktop\creator_agent`.
- Evidence: [remote refs](evidence/t00/remote-refs.json), [local baseline](evidence/t00/local-baseline.json), [incoming kit hashes](evidence/t00/input-kit-hashes.json). The local kit contained no implementation; the successful remote query advertised no refs. Inaccessible/deleted history is not claimed inspected.

### Decision and rationale

Use the existing kit directory as the local CreatorAI working tree. Initialize an unborn `main` and configure `origin` to the supplied URL, preserving the existing files. There is no HEAD commit, tracked file or observed remote default branch. `main` is a reversible local default. No commit or push was performed.

Carry forward modular TypeScript/pnpm, React/Vite web UI, Node API and CLI, with application-owned contracts and domain enforcement. PostgreSQL remains the T02 persistence direction, Temporal the planned T05 backend, and isolated execution/filesystem artifacts/local Git the T11–T13 direction. OpenAI Agents SDK remains an adapter candidate; Tauri remains deferred to X05. None is installed application functionality. Verify current official documentation and pin compatible versions during the relevant implementation milestone; historical examples are not adopted API signatures.

Alternatives considered: reuse earlier agent code (none found in this workspace/advertised remote refs); use manual kit records alone (sufficient for intake, insufficient for executable lifecycle/contract acceptance); use a generic agent framework (possible adapter, cannot replace application-owned authority and study controls); scaffold the entire stack (deferred by T00 scope). The selected minimal path matches the kit without a stack deviation.

Consequences: T01 can implement fixture contracts and API/CLI/web paths without credentials or database/workflow services. Persistent records after restart belong to T02, policy/budgets to T03–T04, bounded durable roles to T05. No discovery, model inference, generated builds or empirical research results exist yet.

Affected requirements: C22, C26–C35 and C49–C50 guide this architecture; none is implemented by the ADR. Affected versions: kit v3.0 and T00/T01 prompts; no application commit, frozen protocol, provider config or pricing snapshot exists. Supersedes: none. Rollback: revise this ADR before a material stack change; local branch/remote can be changed without application data migration. Preserve the kit/evidence. If earlier Creator Agent code is supplied later, compare it before replacing compatible functionality.

### Actual path map

All paths are relative to the local root above.

| Actual path                                            | Observed role                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.git/`                                                | Created by T00: unborn main/origin, no commits or tracked files.                                                                                    |
| `AGENTS.md`                                            | Canonical coding instructions, preserved.                                                                                                           |
| `agent.md`, `CLAUDE.md`                                | Instruction entry points, preserved; incoming CLAUDE checksum differed from original kit manifest.                                                  |
| `PROJECT_CONTEXT.md`, `PROMPT_LIBRARY.md`, `README.md` | v3.0 vision, milestones/shared contract, kit guide; their uninspected-repository statements describe kit creation, superseded by this dated intake. |
| `context/`                                             | 9 design, policy, requirements and reconciliation documents, not runtime code.                                                                      |
| `agents/`                                              | RUNTIME_CONTRACT.md and ROLE_PROMPTS.md; future runtime specifications, no executable agents.                                                       |
| `templates/`                                           | 5 JSON examples/scenarios and IDEA_DOSSIER.md; not executable validators/tests.                                                                     |
| `references/`                                          | 4 archived historical Markdown documents, retained as references.                                                                                   |
| `tracking/`                                            | Four status/decision/integration/handoff documents updated by T00.                                                                                  |
| `tracking/evidence/t00/`                               | Added input hashes, remote observation, PowerShell verifier, baseline output and final file hashes. Intake tooling only.                            |
| `PACKAGE_VALIDATION.md`, `SHA256SUMS.txt`              | Historical kit validation/checksums preserved; not a checksum manifest for the edited working tree.                                                 |

Absent: apps/, packages/, src/, application tests, dependency manifests/lockfiles, .github/workflows/, container definitions, migrations, provider adapters and application build/start/test commands. Input inventory: 32 files including SHA256SUMS.txt. Reusable assets are specifications, prompts, templates and requirements; no reusable implemented functionality was found. No other personal repository was searched.

### Planned dependency/path map — not present yet

| Gate       | Paths / dependency direction                                   | Prerequisite and behavior                                                                                                                            |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01        | `packages/contracts` → runtime validation library              | Versioned executable schemas, decimal-string exact money and explicit errors. Select/pin library after compatibility review.                         |
| T01        | `packages/domain` → contracts                                  | Lifecycle, containment and transition rules; no external effects.                                                                                    |
| T01        | `apps/api` → contracts/domain; `apps/cli` and `apps/web` → API | Thin health and validated fixture demonstration; React/Vite client. Clients do not own enforcement. Share schemas as needed.                         |
| T01        | Root pnpm workspace/scripts                                    | Strict checks, compatible pinned dependencies, lockfile and documented install/build/test/dev commands. Tool presence is not compatibility evidence. |
| T02        | `packages/db` → contracts/domain + PostgreSQL                  | Migrations, persistence, audit/outbox; usable service unverified.                                                                                    |
| T03–T05    | policy/finance/providers and `apps/orchestrator`               | Admission precedes provider/Temporal effects; verified SDKs, budgets, caps and grants required.                                                      |
| T11–T13    | `apps/worker`, artifacts/integrations                          | Isolated generated workspaces, exact Git/artifact evidence; no host-execution fallback.                                                              |
| X05 onward | `apps/desktop` and hosted extensions                           | Deferred; no empty packages created.                                                                                                                 |

Create only paths required by the authorized milestone. Smallest useful T01 slice: CLI/web → local API → runtime-validated fixture contract and deterministic lifecycle result, with health and invalid-input/transition checks. The persistent bounded-role slice in context/ARCHITECTURE.md spans T01–T05; T01 alone does not complete it.

### Instruction reconciliation and preservation

No remote instructions were available to merge. AGENTS.md is canonical; agent.md points to it and CLAUDE.md imports it. CLAUDE.md has escaped underscores in supplementary path text; use the actual PROJECT_CONTEXT.md and tracking/BUILD_STATUS.md paths stated in AGENTS.md. Preserve the incoming bytes rather than normalize an unexplained user change. Before edits, 30/31 original checksum entries matched; CLAUDE.md was the sole mismatch. Tracking edits intentionally make the historical checksum list stale; retain it and use separate dated input/final evidence.

Host rules/current user request take precedence, followed by recorded owner decisions and canonical context over archived references. Runtime role prompts are future product behavior, not coding-tool instructions. The separate CIS4914 repository was neither searched nor modified. No subagents were used.

### Remaining consequential choices

- T01: verify/pin compatible runtime, package manager, API/schema/test libraries using official documentation. No owner question blocks this routine local work.
- T02/T05/T11: verify local database/workflow/isolation deployment. psql, temporal and docker were not found on PATH; service availability elsewhere remains unknown.
- Before live models: verify preferred reference model's actual API identifier/access, capabilities, pricing, credentials, finite caps and scoped data/spend grant. GPT-6 Astra remains a historical preference, not verified availability; no substitution adopted.
- T14/final collection: owner/committee decisions on RQ priority, tasks, participants/raters, institutional requirements, sample size, limits and schedule remain unresolved. Synthetic/local work can proceed.
- Extensions: public GitHub writes/releases, hosting, payments, campaigns, reinvestment and external tracing require applicable configured authority. This URL/intake request is not product integration activation.

## ADR-0002 — T01 executable fixture boundary and dependency pins

- Date: October 17, 2026. Status: accepted reversible implementation decision within Jordan's explicit T01 request. Supersedes ADR-0001's absent-code inventory as current status; preserves its architecture and historical observation.
- Implemented: two shared packages (contracts/domain), three apps (Node HTTP API, compiled CLI, React/Vite web), and a tests workspace. Node's built-in HTTP/test APIs avoid an additional backend framework. Zod validates runtime inputs; TypeScript uses strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes and project references. Future db/policy/provider/orchestrator/worker/desktop packages remain absent.
- Pins: TypeScript 5.9.3, Zod 4.6.7, React/React DOM 19.3.1, Vite 8.3.4, Prettier 3.9.10, Node types 22.19.0, React types 19.3.0, pnpm 11.25.0. npm metadata verified available versions; selected TypeScript's stable 5.9 line rather than the newer major. Node 22.21.0 is .node-version baseline; Node 24.19.0 is also supported/tested because the bundled pnpm runtime uses it. Package commands use the shell Node 22 here. Exact transitive resolution/integrity is in pnpm-lock.yaml. Official documentation sources and actual dependency roles are in docs/LOCAL_DEVELOPMENT.md.
- API: GET /api/health, POST /api/fixture and POST /api/validate. Loopback-only service/config, bounded JSON bodies and Host/origin checks. The web page and CLI use these real endpoints and validate responses. Hosted/live configuration fails; no paid/network provider exists. The historical model preference remains unverified in config/provider-availability.json.
- Schema 1.0 implements the kit's fields with UUID identities and SHA-256 version references; templates remain intentionally non-executable design examples. Canonical hashing sorts object keys by code-unit comparison, avoiding locale-dependent ordering. USD nano-units use canonical integer decimal strings (up to 30 digits) and BigInt comparisons; JSON never serializes money as floating point.
- Alternatives/consequences: a real model/database would exceed T01 scope and its prerequisites; using fixtures permits honest local verification now. A separate provider package is unnecessary for one deterministic fake, so it lives in domain/fixture.ts. The fixture's synthetic 2099 deadline is explicitly not a live allowance. Distinct successful decision execution and deferred/failed product outcomes are intentional. A build recommendation does not create an artifact or claim build-ready verification.
- Trust boundary: delegation validation checks a complete proposed allocation, not concurrent reservations. Lifecycle rules receive trusted current state/evidence; they do not let API callers advance arbitrary products or authenticate model-supplied evidence. Test/review evidence must bind candidate/spec/version and use a non-builder actor, but actual independent review is T12. No accounting, grant, persistence or isolation gate was weakened to pass T01.
- Verification: fresh source-only frozen install/build/check; 20 tests on Node 22 and 24; built-web proxy smoke and actual browser interactions. Exact candidate and logs: tracking/evidence/t01/. No real AI, research or study verification claimed.
- Affected requirements: partial foundations for C10–C16, C20–C23, C28–C29, C32, C35 and C49; see BUILD_STATUS.md. Kit v3.0 and draft research protocol unchanged. No protocol freeze, paid grant or owner study decision inferred.
- Rollback: replace/adjust these minimal packages and dependency pins with a recorded ADR. No persistent user data, real provider effect or deployment requires migration. Preserve incoming CLAUDE.md and historical T00 evidence. No separate senior-project repository was touched.

## Future entries

Use one entry per decision:

- Decision ID and date:
- Status: proposed / accepted / superseded / rejected:
- Decision-maker and source:
- Question and alternatives:
- Evidence and reason:
- Scope, consequences and affected requirement IDs:
- Affected code/spec/prompt/protocol versions:
- Migration or rollback plan:
- Supersedes / superseded by:

Proposed defaults are documented in context/DECISIONS_AND_OPEN_QUESTIONS.md. Do not silently convert them into accepted owner decisions.

## T18 drafting boundary — October 18, 2026

Owner explicitly authorized T18 using documented missing-data allowance, with no
sending. Draft from upstream 3e9026f and actual verification artifacts; keep T15
final evaluation/T16 empirical analysis incomplete, comparative protocol proposed
and unfrozen, empirical results unavailable and all research questions unanswered.
Preserve local edits and prior RD6 preference/cap without enabling dispatch.
Committee checklist records missing decisions and unconfirmed dates. This is a
scope record for drafting, not a research freeze, academic approval or stack ADR.

## T19 acceptance boundary and reproducibility overlays — October 18, 2026

User authorized T19 after the T18 missing-data packet. Preserve source 3e9026f
without merging over local changes; archive fixed-commit bytes plus explicit local
doc/script/test overlays. Tests may optionally preserve synthetic product packages
and same-workspace provenance/search/cost evidence. No runtime policy is changed.
The restart integration wait now accounts for observed killed-worker lease expiry
before its bounded completion window; runtime leases and no-duplicate assertions
are unchanged. Retain the original 185-pass/1-fail/1-skip full log and focused
checks rather than claiming a green whole-suite rerun. Committee acceptance,
participant evaluation, protocol freeze and academic schedule remain unresolved.
No live activation, release or sending follows from creating a local archive.

## X05 implementation boundary — October 19, 2026

Owner authorized starting independent X05 work alongside Claude Code X03/X04.
Keep this pass in new apps/desktop files; reuse T13 manifest schema and executor
canonical-path/ustar validators. Initial Tauri source uses existing loopback web
origin and same-origin API proxy, with no native command/plugin/IPC grants. This
avoids duplicating catalog authority or adding a credential-bearing native bridge.
Offline artifact cache stores exact bytes plus local import date; every inspection
re-hashes, and receipts grant no permission. No extraction or host execution.
Alternative retained: existing browser plus authenticated Gallery downloads already
works; desktop convenience does not justify weakening isolation/authentication.
Full system-browser handoff and paired-worker control require coordinated shared
API/database edits, not a process-local identity map or trusted model decision.
Tauri 2.12.4 and tauri-build 2.7.3 were checked on official docs.rs on this date;
capability/configuration/prerequisite references are in apps/desktop/README.md.
Native toolchain absent; transitive lock/build/native acceptance still pending.

## ADR-0028 — X05 local desktop sign-in, source cache and presence pairing

October 19, 2026. Owner confirmed Rust/Cargo installation and that X03/X04 were
finished, authorizing shared integration. Fast-forwarded to origin/main ddf7bcf;
restored local audit/X05 changes from a retained recoverable stash. Tracking-only
conflicts retain both sets of records. No new commit or push was made.

Use a Tauri 2.12.4 Windows shell over the existing loopback shared UI/API. No
remote-origin native IPC grants. Rust menu actions own browser opening, authenticated
source download and opening only the downloaded manifest in Notepad. Preview
window requests can open only the exact separate-origin T13 ticket URL in the
system browser; other navigation/new-window origins are denied. No source extraction
or generated-code execution occurs on the desktop host. Raw manifest export is an
owner-only, hash-bound addition to T13; original bytes are rehashed before sending.
Native and Node caches are dated read-only snapshots, not authority or synchronization.

Migration 16 follows X04's 15. Five-minute one-time challenges bind to SHA-256 of a
256-bit native/client proof. Browser approval uses existing session/CSRF, binds the
approving session and, for workers, requires current human workspace ownership.
Claiming is transactional and verifies that approval has not expired/revoked.
Desktop claims issue separate revocable HttpOnly sessions; worker claims issue
hashed, expiring, revocable identities scoped to one workspace. No token/proof in
URLs, audit events or device lists. Worker client credentials remain in memory;
restarting requires re-pairing. Declared capability is not infrastructure evidence.

Presence heartbeats use 30-second scoped leases and controls invalidate the fence.
Paired workers cannot dispatch work, read artifacts with their bearer token, call a
model or consume a budget. This is an explicit partial X05 boundary. Reject a
process-local identity map, copying a browser cookie to a worker, or wiring an
arbitrary shell command to a worker lease. Actual paired execution must integrate
existing isolation and admission/accounting, with its own acceptance evidence.
Closing a window is separate from stopping a worker. Shutdown is a request until
observed; revocation denies future polls immediately, and is not proof of OS exit.

The importer/native filesystem boundary assumes an owner-controlled cache outside
product execution workspaces. Ancestor symlink/reparse checks do not protect against
concurrent replacement by another owner-privileged process. No installer/updater,
background service, external tracing, hosted deployment or live integration activated.

Native source download and startup were executed on Windows with fixture inputs;
HTTP/PostgreSQL pairing/session checks are separate from native interactive browser
approval, which remains unverified. The imported X04 Git contract used POSIX mkdir
and an invalid Windows file URL; replaced its test setup with Node mkdirSync,
pathToFileURL and platform-appropriate Git environment, retaining every assertion.
Generated Cargo target/schema files are excluded from Git/Prettier. Dependency
versions and commands are in apps/desktop/README.md; exact results in evidence/x05.

## Owner-requested UX roadmap refinement — October 20, 2026 (planning)

Owner requested routing/effort optimization, broad file operations and conversion, discoverable keyboard navigation, visual file relationships and further QoL ideas. COMPLETION_RUNBOOK §2.10–§2.15 records planned acceptance and phased delivery. Reuse X01/X02/X03 rather than parallel subsystems; evaluate sufficient quality by task class instead of guaranteeing universal sufficiency. Store/reference permitted arbitrary formats with an explicit supported-operation matrix, immutable evidence originals and versioned edits/conversions. Relationship suggestions remain distinct from provenance. Additional QoL proposals are prioritized for task-based validation; no new stack, provider, implementation sequence, study protocol or activation is approved by this planning record. Claude's current §2.1 remains the selected implementation work.

## §2.5 provisional search adapter — October 20, 2026

Existing SourceBroker/HttpFetchAdapter retained; no existing live search adapter was present to qualify (only synthetic tool.search_public). Add a disabled Brave raw Web Search candidate using the existing metered ModelBroker rather than inventing a second authorization/accounting path. Raw results remain unverified; source fetch and exact passage support remain separate. One request/page, ten results, task domains plus output filtering, no generated summary or credential redirects. Provider HTTP errors conservatively keep billing unknown. This is an implementation choice, not final coverage/cost/terms qualification or owner account activation. Official Brave guide recommends LLM Context for machine consumption; owner plan terms/storage rights and suitability must be checked before activation, with an alternative if unsuitable. Migration 25 reserved for Brave provider constraints; coordinate concurrent §2.4 migration allocation before durable application. Guide and evidence: docs/RESEARCH_RETRIEVAL.md, tracking/evidence/research-2-5.

October 20, 2026 — Owner explicitly approved installed studio backup and migration
24→25 during reset-layout update verification. Applied through native upgrade action;
backup present and startup succeeded. Provider activation unchanged. Evidence:
tracking/evidence/reset-layout/result.json.

## Owner-requested studio chat and theme-free discovery — October 20, 2026

U04 roadmap refinement: docs/COMPLETION_RUNBOOK.md §2.17 specifies central Studio
chat for discussion, save-only prompts/sources and actionable research/comparison
using existing records, admission and workflows. §2.18 specifies manual Explore for
me: agent-selected directions within a bounded permitted search envelope, evidenced
shortlist, then concrete versioned briefs and configured selection. "Issues" is
interpreted as real-world problems; repository maintenance remains separate.
Requirements C52/C53 trace these additions. Current submit.tsx and
SearchBriefBodySchema require a theme; no theme-free control is asserted. This
records requested planning, not implementation, live dispatch, scheduling, higher
limits or a changed thesis protocol. Next eligible prompts are the bounded slices
in §2.17/§2.18 after their stated dependencies; no implementation started here.

## Billing-aware theme submission feedback — October 20, 2026 (planning)

U04: owner reports mandatory budget/pricing snapshots conflict with plan-only use.
Inspected submit.tsx: readiness requires both an envelope and pricing snapshot;
brief budget text is separate but confusing. Added COMPLETION_RUNBOOK §2.19 for
simple draft intake, distinct solution constraints, typed subscription/local/API
resource admission, internally resolved API pricing and no extra metered spend for
plan-only runs. Plan access/summary qualification does not qualify discovery roles.
Documentation only; no runtime changes or live calls. Diff whitespace check passed.
Next eligible: bounded §2.19 discovery-route/admission implementation and required
role qualification, preserving frozen studies and existing uncommitted work.

## Accepted workflow-alignment planning — October 20, 2026

Owner accepted all nine findings and native plan search/Agent Reach comparison
for later implementation. Runbook impact map covers §2.5A native search first,
selective upstream comparison, §2.10 shared resource settings, §2.14 onboarding,
§2.15 status reconciliation/delivery order, §2.17 research handoff, §2.19A role
workflow dispatch/worker parity/effective limits/data sharing and Group 3 in-app
spec/build/package/revision. These are plans, not implemented/activated features.
Official plan docs permit web search subject to model/account/workspace policy;
current app integration/qualification is missing. Agent Reach remains a candidate,
not an installed dependency or replacement provider. No spending, schedule or study
changes. Next eligible prompt: §2.15 current-status reconciliation, then explicitly
select a bounded dependency-complete implementation slice. Documentation checks
only; no runtime tests/live calls. Existing unrelated changes preserved.

## §2.19A typed subscription discovery resources — October 20, 2026

Owner selected the first workflow/resource slice. Keep legacy API request shape and
study hashes intact; add typed resources rather than fake zero-priced API snapshots.
Subscription route uses accepted connection caps plus explicit data grants and fixed
role-to-qualification mapping, with one job/attempt and parent connection enforcement.
Migration 27 stores immutable resource setup and bounded raw workflow response text
for hash-bound crash replay; other direct plan results stay hash-only. This is necessary
because a settled request hash alone cannot recover a lost task output. Unknown results
remain held; no automatic redispatch. Reuse existing workers/admission/output gates,
not a second coordinator. Local route is typed but explicitly blocked until implemented.
Source-only contract acceptance does not install or qualify the actual model. Guide:
docs/SUBSCRIPTION_DISCOVERY.md. Pilot schedule gate and broader settings remain separate.

## Discovery qualification preparation — October 20, 2026

Prepare production-role contract checks instead of qualifying discovery from generic
JSON-key/phrase checks. New discovery_contract benchmarks preserve schema, exact
packet/role bindings, grounded reference IDs, fixed decision expectations and revision
coverage. A same-name or obsolete-prompt benchmark no longer unlocks discovery.
New synthetic cases are target-held-out but author-visible; no claim of independent
review or thesis evidence. Exact candidate/settings/migration/run plan prepared in
docs/DISCOVERY_QUALIFICATION_PLAN.md; raw outcomes retained by the bounded runner
only after scoped execution approval. Source and compiled hashes pin checker behavior;
future prompt/checker changes invalidate affected qualification. No classes/caps or
provider access activated by preparation. Template note drift was resolved by matching
the last verified settings hash; current API equality must still precede any change.

## October20 approved discovery execution: preserve failed qualification

Owner approved the exact upgrade/settings/18-request packet. Upgrade and task-class
changes executed; first development case returned exploratory where frozen grading
required well_supported. Production contract passed. Preserve failed qualification
and all original criteria; no retry, hidden rubric change or exposure of remaining
held-out labels as fresh evidence. Review whether authored evidence-strength gold
confuses synthetic observability with real-world validation before proposing a new
version. See docs/DISCOVERY_QUALIFICATION_RESULT.md.

## October20 evidence-strength review: qualify scope before enum

The v1 locator prompt does not specify whether evidence_strength assesses the
observed bounded problem or the untested intervention. Packet sufficiency admits
investigation; it does not establish independent corroboration/external validity.
Retain the failed v1 grade and original candidate. Propose explicit operational
anchors and semantic negative controls in a new version; do not silently change
study rubric or accept all labels. Eighteen fresh scenario designs prepared, not
frozen executable manifests or live authorization. See
docs/DISCOVERY_QUALIFICATION_RUBRIC_REVIEW.md.

## October20 operational discovery rubric1.1 and fresh qualification v2

User authorized implementing clearer anchors and executable benchmarks. Version
locator prompts around observed-need confidence within evidence scope; do not map
packet sufficiency to high confidence or synthetic support to real-world validation.
Shared role/prompt version change invalidates prior discovery evidence for the new
candidate. Preserve historical v1 failure unchanged.18 fresh packets are operational
contract checks with explicit author-visible labels, not independent or thesis
evidence. Substantive entailment review remains separate and required; nonempty
fields/enums alone cannot certify it. Initial offline packet-role-tag correction
retained in preflight-draft before any target outputs. Candidate/execution packet
prepared, not authorized for live use by earlier v1 grant. No study protocol or
weights, money/data permissions or saved connection settings changed. See
docs/DISCOVERY_QUALIFICATION_V2.md.

## October20 v2 zero-dispatch transport blocker and bounded repair

Exact approved v2 candidate installed, but qualification manifest creation exceeds
API64KiB cap. Stop recorded before qualification/model admission. Preserve original
v2 lock and all inputs/criteria; not a model failure or a license to retry output.
Fix only authenticated plan-qualification creation ingress to128KiB, retaining
ordinary64KiB action limits and all auth/schema/domain controls. HTTP/stream tests
prove actual frozen manifests fit without inference. Prepare a new candidate/binding
for owner review, not automatic replacement of the exact approved installation.
Repair runner requires zero-dispatch predecessor proof and a separate durable lock.
Same18 cases remain unexposed to target; not freshly authored or independent study
evidence. See docs/DISCOVERY_V2_TRANSPORT_REPAIR.md.

## October20 approved repair resolves ingress; preserve actual v2 schema failure

Install/run approval matched repair hash8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459.
API413 blocker resolved; first actual target response violates affected_users type
and gaps max length. Stop after1, retain failed grade and all locks; do not normalize
arrays, truncate output or weaken schema to pass. Output prompt names fields without
all exact types/limits, while runtime asks for several auxiliary details. Audit the
whole model-facing contract before preparing any versioned next candidate; do not
tune just visible fields or reuse target-exposed output as fresh held-out evidence.
Coding-agent substantive observations are author review, not independent approval.
No further milestone or new live call automatically follows. See
docs/DISCOVERY_V2_LIVE_RESULT.md.

## October20 discovery contract1.2: derive complete output shape from validators

User authorized the next bounded output-contract audit/revision. All discovery
task kinds now receive schema-derived types/counts/lengths/enums/reference patterns,
including a complete revision proposal. Keep relational evidence/perspective/ref
checks in application code. Clarify discovery-specific serialization without editing
the general runtime contract or weakening production validators; omit reserved
fixture metadata from model-facing projection. Hash generated schemas and payload
instructions with version1.2, invalidating historical evidence for a new candidate.
Prompt guidance is not provider-enforced generation or substantive entailment.
Preserve every prior grade/manifest/lock, test historical invariants and use explicitly
fixture-only rebindings for current plumbing tests. Prepare18 fresh v3 scenario
designs without live dispatch or new installation. No thesis protocol or weights
changed. docs/DISCOVERY_OUTPUT_CONTRACT_AUDIT.md records limits and next prompt.

## October20 fresh v3 operational qualification frozen for role1.2

User authorized complete fresh packets/manifests, controls, size verification and
candidate preparation.18 new scenarios now have production-bound frozen inputs and
prospective assertions, without reusing exposed v1/v2 outputs or tuning after target
results. Do not treat author-visible gold as independent evaluation. Order-independent
review coverage is retained for five proposals; two findings supplied to revision.
Semantic false-narrative controls explicitly expose automation limits and require
separate substantive review. Exact HTTP ingress/input checks precede live approval;
no cap changes or unverified structured-output provider features. New candidate/
execution hash prepared, not installed or authorized by older grants. See
docs/DISCOVERY_QUALIFICATION_V3.md.

## Discovery follow-up preparation note — October 22, 2026

Implemented the authorized offline preparation in DISCOVERY_REMAINING_COVERAGE_PROPOSAL:
fresh12 cases, no pooling/resuming v5, unchanged production prompts/runtime and
4/4 held-out floor. Reuse the existing v5 runtime with externally frozen manifests
through its existing API; no packaging/install prerequisite added. Prospective runner
requires separate review and a provider-available observation within15min, plus
unchanged settings/caps and exact plan approval. This is a prepared execution
proposal, not owner execution approval, quota reset or an accepted new research
protocol. See docs/DISCOVERY_FOLLOWUP_V1.md; historical failures/grades retained.

## Explicit availability-check intent — October 22, 2026

Owner selected repairing the already-verified availability path and approved one
new bounded live check. Keep initial-verification restriction; separate intent
and purpose require a fresh one-use grant and existing verified model. Legacy
grants default model_access. Fixed synthetic prompt, ordinary caps/credits and
unknown fencing apply; settlement updates availability without replacing access
or qualification. Migration28 additive. Implemented/reviewed/installed; one call
completed. This is not approval for the12case suite, another recheck, provider
fallback, research protocol changes or pilot activation. See implementation report.
