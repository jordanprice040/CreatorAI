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

## Part 2 (November 18–19), with the #243 fixes

Set-up: Jordan typed "OK F4 rerun" (2026-11-18 08:06 UTC). Backup `C:\CreatorAgentBackups\installed-pre-f4rerun-20261118T080923Z` (all 2,174 database files match, dump SHA-256 `6436691B…1DC8240`, layout 78, both workspaces, 605 audit events). Trial builds, local only, from main `ae6c42e1`: 0.1.3 `34ff1ae1` (installer `aa381ec0…01ee4ab`, layout 79), 0.1.4 `3310de7d` (planted migration 999, `bbf465ac…7fdb233`), 0.1.5 `f13e32de` (`1787f7db…656bb31`, layout 79). Jordan installed 0.1.3 by hand; it took its own backup, upgraded 78 → 79 (23:52:22) and ran from the install folder.

| Time (UTC, Nov 18)  | What happened                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23:56:16 / 23:56:19 | Check found 0.1.4; download kept (SHA-256 as built)                                                                                                                                                                     |
| 23:56:41            | Install approved from 0.1.3, layout 79, backup `pre-upgrade-v79-2026-11-18T23-56-27-907Z`                                                                                                                               |
| 23:56:54            | 0.1.4's rehearsal on a copy failed on the planted migration; the real database was not changed; rollback started                                                                                                        |
| 23:56:55            | `restore_files_retrying`: "the new version's files are in use"                                                                                                                                                          |
| 23:59:56            | **rollback_failed**: `restore_attempts` 61, `restore_wait_seconds` 180; 0.1.3 ran from `updates\rollback\0.1.3`, health ok; the install folder held `creator-desktop.exe.failed`, `uninstall.exe` and 0.1.4's `studio\` |

Cause (confirmed by reading each process's working folder): the update helper (pid 9832) and the `cmd.exe` wrapper `pg_ctl` left for PostgreSQL (pid 19876) both had `C:\Users\jorda\AppData\Local\Creator Agent\` as their working folder, inherited from the Start menu launch; Windows does not rename a folder that is a running program's working folder. Fixed in the follow-up PR (working folder moved to the studio folder at every launch, and set explicitly on every program the app starts).

Recovery (Nov 19, 00:04 UTC): Jordan quit the saved copy and installed 0.1.5 by hand ("Do not uninstall"); it runs from the install folder, health ok, layout 79, saved copy and helper gone. `v0.1.5` was never published. The restart-during-update step waits for the fix; the next trial versions start at 0.1.6.
