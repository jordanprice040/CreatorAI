# Discovery v2 execution and transport repair

Latest execution: [repair installed; one live request failed the production schema](DISCOVERY_V2_LIVE_RESULT.md).
The repair is now installed. The preparation and predecessor-stop descriptions below
retain their original scope and are superseded where they conflict with that result.

October20 local time (receipts cross midnight UTC). Jordan approved installing and
running the exact v2 packet. Installation succeeded; the installed manifest matches
`733837fe38fd84be6479e02ac1115dededd98a7ca99a644d03b31e72b043897c`.
A hash-verified program-only rollback copy is in
`.verification/discovery-v2-program-rollback`; it contains no personal studio data
or credentials. The installer from that approval is retained separately at
`.verification/discovery-v2-approved-installer.exe` with its original hash.

The app quit gracefully and reopened with its existing local-owner session. Readback
before/after installation confirms schema27, unchanged connection settings, zero
workflows,19 audit events and10 completed plan requests. No migration or task/data
permission change occurred.

## Stop before model dispatch

The frozen research-synthesis manifest creation returned HTTP413: the API's ordinary
64KiB JSON cap rejected its77,265-byte request. The scoring request would also exceed
that cap (74,411bytes); candidate generation is65,477bytes. These are total serialized
benchmark-creation bodies, not individual model-input sizes. Individual requests
remain subject to their accepted24,000-character input cap.

The runner's stop receipt records attempted0 and qualification_id=null. Independent
API/database readback confirms the request count and qualification list did not
change; there is no active, unknown or leased work. **Zero new provider calls ran.**
No case failed model grading, and no target saw development or held-out inputs.
The previous failed v1 model result remains unchanged. Preserve the v2 execution
intent, stop receipt and run.lock under tracking/evidence/discovery-qualification-v2.
Do not delete that lock or rerun that runner.

## Narrow repair prepared locally

Only authenticated POST `/api/workspaces/:ws/plan-connections/:id/qualifications`
accepts up to128KiB. Content-Length and streamed bytes are both bounded; other
actions retain64KiB. Owner/CSRF/schema/task/data/model/version checks still apply.
The fix changes no prompt, frozen input, grader, cap, money or saved settings.

TypeScript and production web/service staging passed. Four HTTP/API tests passed
with no skips on disposable PostgreSQL and loopback stand-ins. They submit all three
actual v2 manifests through authenticated HTTP, accept a valid chunked manifest,
reject oversized declared and chunked bodies, retain the ordinary action limit,
check authentication and server health, and confirm manifest operations send no
inference calls. A chunked oversize may close the stream rather than return JSON413;
the test retains that distinction. Earlier44 role/workflow checks and108 scorer
controls apply to the unchanged role/manifests; they were not relabeled as new tests
of the transport patch. No new native installed acceptance is claimed for the repair.

The repaired candidate is prepared separately, not installed. Its runner requires
the predecessor's zero-attempt stop and unchanged request/qualification counts,
and retains a separate repair-run lock/receipts. It uses the exact original v2
freeze and case criteria, not newly tuned cases. Maximum remaining exposure is
still18 sequential plan requests, no retries, no metered fallback or credits,
120seconds/request and36minutes aggregate. Stop at the first failed/unknown/quota
case; no workflows/search/build/pilot launches afterward. Substantive review of
exact output hashes remains required separately from operational contract grading.

Exact repaired installer, source and execution hashes are in
tracking/evidence/discovery-v2-transport-repair/execution-plan.json and result.json.

- Installer SHA256: `f47b120fac8fd4a3852dd9ceac971358cac4ed2ce76ea96dfec9d77b05417f6c`
- Repaired bundle-manifest SHA256: `b59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048`
- Execution-plan hash: `8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459`
  -137 source/compiled/runner/predecessor-receipt bindings. The installer is at
  `apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe`.

After approval, repeat the no-active/unknown-work preflight, preserve the current
program rollback, quit gracefully, install that exact candidate and verify its
bundle/session/schema/settings/records. Then the protected runner is:

```powershell
./scripts/qualify-discovery-transport-repair.ps1 `
  -StudioHome 'C:/Users/jorda/AppData/Local/com.creatoragent.studio' `
  -ApprovedExecutionPlanHash '8175e90e31df06302907a0abab8c7f1aa57a31b6b9d4180b9c204baef43da459'
```

The reviewed v2 installation stays in place until approval of this changed candidate.
This is the remaining boundary: install the transport repair, then start its bounded
execution with the preserved original cases. No new migration or permission change
is proposed. C54 remains partial; discovery remains unqualified.
