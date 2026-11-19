# Live autopilot rerun on schema 63, and file-type check (2026-11-14)

Dev studio only (C:\dev\creator_agent_main, DB creator_studio, ports 5173/4310/4320). The installed app and its DB were not touched. The $20 ceiling was unchanged. Evidence on Jordan's PC: `tracking/evidence/p13-autopilot-rerun-schema63-2026-11-14/` (README.md, FILES_CHECK.md, screenshots), not committed.

## 1. Upgrade

- A backup of creator_studio was taken before the upgrade.
- The dev studio moved to main f073115, schema 63, and started cleanly.
- #197 (dollar amounts) and #198 (drafting) were not on main yet, so those walk items were not covered.

## 2. Plan cap and the start check

- The new start check refused a whole run under the old cap of 10, as designed. The Run it for me form always sends 5 response types, so a whole run needs at least 13 plan requests (web search 2, explore 2, discovery 7, assessment at least 2). About 17 is typical, and up to about 27 with Hands-off.
- Jordan chose 30 per run. The dev studio connection was raised and accepted. PR #199 makes 30 the shipped default.

## 3. Whole run 526e1e7b

- Started with Jordan's typed OK, using the new cap.
- It stopped correctly with `claims_held`: 8 quote-only web claims are held for review (P-12).
- Finding: the next-step text pointed to Decide instead of Search the web. Fixed in PR #199 (commit 683a898), with the Evidence approval text updated to match.
- The autopilot waits for Jordan to Continue, Allow, or leave it. It ends at 00:23 UTC (7:23 PM Eastern).

## 4. #194 WSL2 build check

Passed: 41 of 41 checks ran for real.

## 5. File-type check (Testing workspace fd252ee8)

| File | Detected as | Viewer | Original download |
|---|---|---|---|
| .txt | text | plain text | exact (SHA-256 match) |
| .md | markdown | rendered, with a source toggle | exact |
| .csv | csv | table | exact |
| .json | json | pretty-printed | exact |
| broken .json | text | plain text | exact |
| .py | code | text | exact |
| .html, .svg | code | text, scripts stay inert | exact |
| .png, .jpg | image | image | exact |
| .pdf | pdf | "preview not available" notice | exact |
| .docx, .xlsx, .zip, unknown binary | other | "no viewer" notice | exact |
| fake .png (text inside) | text, mismatch flagged | plain text | exact |
| UTF-16 .txt | other (has_text false) | none | exact |

- All 17 downloads matched their SHA-256 hashes (#141 exact originals).
- Only real images are served inline. Downloads are attachments, with a sandbox CSP and nosniff (#141 inert viewers).
- Drop-anywhere worked on Discover.
- Limits (#143):
  - The UI refused a 26 MiB file with "This file is larger than the studio accepts".
  - The API returns 413 "Files are limited to 25 MiB each."
  - The UI queues a 3rd simultaneous upload. The API returns 201, 201, then 429 "You already have 2 uploads in progress; wait for one to finish."
- Cleanup: the 24 test files were deleted and purged. The empty Testing workspace stays.

## 6. Follow-ups (not fixed)

1. UTF-16 text files are not recognised as text, so they get no viewer.
2. The UI size refusal doesn't say the limit is 25 MiB.
3. Through the dev proxy, an oversized upload shows a bare 502 instead of the API's 413 message.
4. No type-mismatch flag for .json that falls back to text, or for .html and .svg.
5. React duplicate-key "Invalid UUID" console errors on the files list.
6. The Run it for me form has no response-type picker, so every whole run pays for all 5 types.

Earlier finding withdrawn: "card not visible" was a stale browser tab.

## 7. Continue at the claims_held stop (23:00 UTC, Jordan's typed request)

- Continue re-ran Search the web, which stopped again after 33 ms with the same claims_held text. It sent no new search and made no plan requests. The run is at 2 of 30 requests and the day at 15 of 100. API spend is still $0.00036.
- Follow-up 7: a Continue that can only stop again still sets aside 2 of the autopilot's 40 calls (the card reads "4 of 40"). It also gives no warning that no claims were added. Continue should be refused, or should warn and set nothing aside, while the held claims are unchanged.
- The dev studio still shows "go to Decide" because the #199 wording fix isn't on main yet.

## 8. Allow and continue (23:03 UTC, Jordan's typed OK for this run only)

The run went through Search the web (a new search, 57164be6), Explore, Brief and Discover, then failed at discover at 23:05:47 UTC.

- The new search's 8 claims show "Accepted by autopilot · quote check only" with their passage. The original 8 held claims (search 7b4c3dc8) are still 0 of 8.
- Explore found 3 candidates and took the first: "Prior authorization consumes practice staff time and delays access to care". The brief was written from 2 claims.
- Discovery was refused twice, the second time by the automatic retry: "The evidence packet is too large for one model message; select fewer claims."
- Totals: 5 plan requests for the run, 18 of 100 for the day, API spend still $0.00036.
- P-11 worked: the run's approvals were revoked when the autopilot ended (policy 19eb6501).
- The setting was turned back off at 23:06:14 UTC, as Jordan asked. Settings are now version 3, and Hands-off is still on.

Follow-ups:

8. **Highest.** Discovery refuses a packet over `MAX_PACKET_CHARS` (19,000; `packages/domain/src/discovery.ts:99`). The check runs locally in `packages/db/src/discovery-store.ts:153`. Only 2 claims were selected, so the likely cause is the catalog of up to 40 active problems, ideas and alternatives in a busy workspace. This hasn't been confirmed. If it holds, autopilot discovery can't run in the dev studio at all. The catalog should be trimmed to fit the packet instead of refusing the run. A retry of a deterministic local refusal should also be skipped.
9. Calls are set aside before a local refusal, and not given back. The run set aside 24 + 8, so the card shows "40 of 40" after only 5 requests.
10. Allow and continue at a claims_held stop runs a new search instead of accepting the held claims. That costs 2 requests, and the held claims stay unreviewed.
11. Topic drift: the new search's claims cover Asana recurring tasks, nonprofit impact systems and prior authorization. The run took a prior-authorization problem that nobody picked.
12. After a failed step, the card offers only "Start a new autopilot".

Follow-up 5 detail: every console line read "Encountered two children with the same key, `%s` … Invalid UUID" (@vite/client:356). It appeared only in the new, empty Testing workspace, on Discover and Sources › Files loads and on each upload refresh. The details were sent to the file viewers thread.
