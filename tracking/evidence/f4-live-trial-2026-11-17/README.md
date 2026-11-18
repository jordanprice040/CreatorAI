# F4 live trial on Jordan's PC — part 1 (November 17, 2026)

Jordan's typed OK: "OK F4 live trial" (15:41 UTC). Plan: `/mnt/project-files/plans/F4_LIVE_TRIAL_PLAN_2026-11-17.md`.

## Set-up

- Backup before anything changed: `C:\CreatorAgentBackups\installed-pre-f4trial-20261117T154315Z` (cold copy of the app home and program folder, plus `database.dump` 1,358,951 bytes, SHA-256 `BC83E2D9…4C7E`, `pg_restore --list` OK; layout 78, workspaces "Jordan's Creator Studio" and "Testing", 605 audit events, 437 product files).
- Base build 0.1.0 from main `b68d934b` (PR #239), installed by Jordan by hand.
- Private release repository `jordanprice040/creator-agent-releases`, fine-grained token with Contents: read on it only, entered in the status window (DPAPI). The repository needed a first commit (a README) before a release tag could be created.
- Trial builds were local commits only, never pushed: 0.1.1 `e3fc7014` (version bump plus planted migration 999 that always fails), 0.1.2 `c7fea5d4` (version bump only).
- Release `v0.1.1`, published by Jordan: `Creator-Agent_0.1.1_x64-setup.exe` 28,184,755 bytes, `sha256:5232f3b9…a2f2`; `creator-agent-update.json` 449 bytes, `sha256:4e6ecc57…9f1a`. GitHub's digests matched the local files.

## Deliberate rollback (0.1.1), UTC

| Time        | What happened                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16:16:58    | Check: 0.1.1 newer, manifest SHA-256 matches the published file                                                                                                                                                                             |
| 16:17:11    | Download kept: size and SHA-256 match                                                                                                                                                                                                       |
| 16:17:21–26 | Verified pre-update backup `pre-upgrade-v78-2026-11-17T16-17-21-759Z-s3b135828`                                                                                                                                                             |
| 16:17:36    | Verified saved copy of 0.1.0 (520 files); install approved                                                                                                                                                                                  |
| 16:17:37–41 | Helper took over, 0.1.0 quit, installer ran, 0.1.1 started                                                                                                                                                                                  |
| 16:17:43–48 | 0.1.1 needed the upgrade; the rehearsal on a copy hit the planted failure; the real database was not changed; the copy was dropped (no extra database left)                                                                                 |
| 16:17:49    | Rollback claimed (`rollback-<id>.lock`) and started                                                                                                                                                                                         |
| 16:17:50    | **rollback_failed**: "the earlier files could not be put back (the new version's files are in use); it runs from its saved copy". 0.1.0 started from `updates\rollback\0.1.0` and ran by 16:17:52 with the same data. `failed.json` = 0.1.1 |

## Findings (fixed in the follow-up PR)

1. Putting the earlier files back was tried once, one second after 0.1.1 exited, while its last processes still held files. The install folder kept 0.1.1. Now retried for up to 3 minutes.
2. The saved copy running after that would have treated its own folder as the install folder if an update were started from it. Install now refuses there.
3. Download and Install were still offered for 0.1.1 after it was rolled back. Nothing at or below the failed version is offered now.

The helper stayed alive afterwards because it shows a message box after a failed rollback and waits for OK.

Recovery: Jordan quits the saved copy and installs 0.1.2 by hand (newer than 0.1.1, same database layout). The restart-during-trial step waits for the fix and its review.
