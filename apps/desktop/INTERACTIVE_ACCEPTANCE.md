# X05 interactive Windows acceptance

Passed locally on October 19, 2026 using the actual release executable, native
menus and shared WebView UI, Windows Notepad, PostgreSQL and the real reviewed WSL
sandbox. Native observations used supported @oai/sky Computer Use. This supersedes
the earlier stopped attempt; its failures remain in the evidence directory.

| Gate                        | Executed observation                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared UI and sign-in       | Native sign-in menu invoked the OS browser handler and opened Chrome's local approval window with a comparison code. Disposable owner approval used the explicit HTTP fixture seam. The native session displayed the same authorized workspace and Gallery record. No personal authentication dialog was automated.  |
| Download                    | Native menu reported hashes verified; exact manifest and archive bytes were retained with a dated receipt.                                                                                                                                                                                                           |
| Editor                      | Final native menu exported to Downloads and opened packaged Notepad. Its screenshot visibly showed artifact ec15d6bb-7c6b-493a-85eb-f595e17ac4f7 and workspace 91344076-357a-4327-b426-a8e0194086c3. Notepad's accessibility document text was stale from an older tab; the screenshot established this observation. |
| Native launch/shared record | Native menu submitted job 5c1b397f-fc07-4f95-8463-d7a9275089c2. Shared UI and owner API both showed completed, exact manifest 5d7bfed5f1da2916c16abdc3758e07567731ab6618a72531008b3f211bc626f2, WSL report succeeded/exit 0. Reports remain worker_report_only.                                                      |
| Worker controls             | Visible Pause changed active to paused and enabled Resume. Resume restored active. Shutdown changed state and the separately started CLI exited 0.                                                                                                                                                                   |
| Window lifecycle            | Earlier native window closure left the separately started worker polling; API heartbeat remained active. Separate explicit shutdown is required.                                                                                                                                                                     |
| Installer lifecycle         | Separate unsigned debug acceptance identity passed install/startup, upgrade/startup, downgrade refusal and explicit uninstall/reinstall rollback/startup, then was uninstalled. Final release installer rebuilt after editor fix; it was not installed as production.                                                |

Evidence in tracking/evidence/x05: native-ui-acceptance.json,
native-final-shared-job.json, interactive-worker-editor.log,
windows-accepted-release-artifacts.json, rust-editor-final.log,
windows-editor-release-bundle.log, windows-installer-acceptance.json, and
paired-lifecycle-final.log. Final candidate hashes bind the executed source.
Fixture harness shutdown is a skipped test, not an automated acceptance pass.
Real pairing/launch and fault tests have separate executed results.

The initial editor launch produced no new document, confirmed by the owner.
Direct cached AppData paths also produced Notepad path errors. Final behavior
rechecks the original receipt, creates a unique exact copy in Downloads, rehashes
it and activates packaged Notepad with a quoted UTF-16 path. Rust tests verify
cache preservation, fresh copies, and refusal after source tampering. No claim is
made about the internal Windows cause of the failed AppData path.

To repeat: start the documented local services, launch the client, select the
exact Gallery artifact, exercise the native download/editor/queue menus and
inspect Desktop and workers. Pair only an explicitly approved execution worker
against the studio's product root. Compare browser approval codes before approval.
Never copy session cookies or proofs into reports. Leave personal editor tabs intact.

Scope: this observed Windows x64/MSVC/WebView2/WSL host, synthetic provider/review
inputs, real local execution. Live OIDC, production signing, signed automatic
updates, public distribution and other hosts remain unverified or disabled.
X05 local acceptance does not activate those integrations.
