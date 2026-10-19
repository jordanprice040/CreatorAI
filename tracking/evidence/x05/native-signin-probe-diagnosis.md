# Native sign-in probe diagnosis � October 19, 2026

Initial fixture approval succeeded, but the executable exited 1 with:
`Native sign-in probe failed: Native WebView did not authenticate with the claimed cookie`.
No credential or proof was logged.

Inspection of installed Tauri 2.12.4 showed `WebviewWindow.title()` delegates to
`self.window.title()` (OS title). The test wrote `document.title`, so the assertion
never observed it. Corrected the debug probe to observe `on_document_title_changed`.
No production cookie policy was weakened. Reruns authenticated the fixture owner
inside the actual Windows WebView with both ordinary and Secure session cookies;
separate browser and desktop sessions were checked in PostgreSQL. See
`native-signin.json` and `native-signin-secure.json`. This does not establish live
OIDC, personal default-browser handler, rendered UI or editor acceptance.
