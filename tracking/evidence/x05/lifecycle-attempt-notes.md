# X05 lifecycle acceptance attempts — October 19, 2026

- paired-lifecycle-attempt1.log: real revocation passed; crash harness hung after
  a signal-killed child because exitCode stays null while signalCode is set. The
  finally block awaited a second close event. Stopped only verified test PIDs
  37520/21824. Corrected the test cleanup check to include signalCode. Retained
  the failed fixture product locally; matched its product ID to the orphan
  disposable database before dropping that database.
- paired-lifecycle-attempt2.log: 3 passed, 0 failed. Cleanup order dropped the DB
  before the API background tick stopped, causing shutdown diagnostics. Disabled
  the unrelated workflow worker and registered API close before database cleanup.
- paired-lifecycle-final.log: final candidate, 3 passed, 0 failed, 0 skipped.
- Initial bundle schema rejected unsupported createDesktopShortcut. Removed it;
  acceptance invokes NSIS /NS (confirmed in generated pinned CLI template).
- windows-installer-attempt1.log: installed baseline startup passed; upgrade
  returned code 2. Fixture was uninstalled in finally. Added explicit exclusive
  executable-write-access observation before replacing it. Cause remains unknown:
  windows-installer-attempt2.log and windows-installer-final.log passed, and final
  lock observations were zero. Do not call this a confirmed file-lock diagnosis.
- Final NSIS gate installed only Creator Agent X05 Acceptance, separate bundle ID,
  versions 0.1.0/0.1.1, into a checked workspace path with no shortcuts. Native
  WebView navigation passed after install/upgrade/manual rollback; silent downgrade
  returned 2 and left the executable hash unchanged. Fixture uninstalled. This
  does not verify production signing, automatic updates or rendered UI/editor use.

Earlier evidence is retained. No assertion was relaxed to hide a failed gate.
