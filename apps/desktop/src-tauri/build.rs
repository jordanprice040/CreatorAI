// App commands are permissioned (ADR-0041): only the bundled local control window's
// capability allows them. The remote studio UI on 127.0.0.1 gets no native IPC.
const COMMANDS: &[&str] = &[
    "studio_state",
    "studio_detect_postgres",
    "studio_inspect_source",
    "studio_setup",
    "studio_retry",
    "studio_migrate",
    "studio_preferences",
    "studio_source_hosts",
    "studio_sign_in",
    "studio_sign_out",
    "studio_open_logs",
    "studio_open",
    "studio_quit",
    "studio_update_settings",
    "studio_update_forget_token",
    "studio_update_check",
    "studio_update_download",
    "studio_update_install",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build configuration failed");
}
