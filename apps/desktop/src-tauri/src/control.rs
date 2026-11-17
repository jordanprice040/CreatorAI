//! Commands for the bundled setup/status window only (ADR-0041). Each command re-checks
//! that it came from the local `control` window; the capability also scopes them to it.
use crate::studio::Shared;
use serde_json::{json, Value};
use tauri::{Manager, State, WebviewWindow};

fn local(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Window closed")?;
    let bundled = url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost");
    if window.label() != "control" || !bundled {
        return Err("Not allowed from this window".into());
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "The operation stopped unexpectedly".to_string())?
}

#[tauri::command]
pub async fn studio_state(window: WebviewWindow, sup: State<'_, Shared>) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || Ok(s.state())).await
}

#[tauri::command]
pub async fn studio_detect_postgres(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<Value, String> {
    local(&window)?;
    let configured = sup.home.load().ok().flatten().and_then(|c| c.pg_bin);
    blocking(move || Ok(json!(crate::postgres::detect(configured.as_deref())))).await
}

#[tauri::command]
pub async fn studio_inspect_source(
    window: WebviewWindow,
    sup: State<'_, Shared>,
    source: Value,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.inspect_source(&source)).await
}

#[tauri::command]
pub async fn studio_setup(
    window: WebviewWindow,
    sup: State<'_, Shared>,
    request: Value,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.setup(&request)).await
}

#[tauri::command]
pub async fn studio_retry(window: WebviewWindow, sup: State<'_, Shared>) -> Result<(), String> {
    local(&window)?;
    sup.start();
    Ok(())
}

#[tauri::command]
pub async fn studio_migrate(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.approve_migration()).await
}

#[tauri::command]
pub async fn studio_preferences(
    window: WebviewWindow,
    sup: State<'_, Shared>,
    close_behavior: String,
    launch_at_login: bool,
) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.set_preferences(&close_behavior, launch_at_login)).await
}

#[tauri::command]
pub async fn studio_source_hosts(
    window: WebviewWindow,
    sup: State<'_, Shared>,
    hosts: Vec<String>,
) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.set_source_hosts(hosts)).await
}

#[tauri::command]
pub async fn studio_sign_in(window: WebviewWindow, sup: State<'_, Shared>) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.sign_in()).await?;
    crate::show_main(window.app_handle());
    Ok(())
}

#[tauri::command]
pub async fn studio_sign_out(window: WebviewWindow, sup: State<'_, Shared>) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || s.sign_out()).await
}

#[tauri::command]
pub async fn studio_open_logs(window: WebviewWindow, sup: State<'_, Shared>) -> Result<(), String> {
    local(&window)?;
    // Only the app's own logs folder, as one argument; no shell parsing.
    std::process::Command::new("explorer.exe")
        .arg(sup.home.logs())
        .spawn()
        .map_err(|_| "Could not open the logs folder")?;
    Ok(())
}

#[tauri::command]
pub async fn studio_open(window: WebviewWindow) -> Result<(), String> {
    local(&window)?;
    crate::show_main(window.app_handle());
    Ok(())
}

#[tauri::command]
pub async fn studio_quit(window: WebviewWindow, sup: State<'_, Shared>) -> Result<(), String> {
    local(&window)?;
    sup.quit();
    Ok(())
}

// ---- F4 in-app updates (ADR-0128) ----------------------------------------------------------

#[tauri::command]
pub async fn studio_update_settings(
    window: WebviewWindow,
    sup: State<'_, Shared>,
    repository: String,
    token: Option<String>,
    check_at_start: bool,
) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || crate::update_run::save_settings(&s, repository.trim(), token, check_at_start))
        .await
}

#[tauri::command]
pub async fn studio_update_forget_token(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<(), String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || crate::update_run::forget_token(&s)).await
}

#[tauri::command]
pub async fn studio_update_check(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || crate::update_run::check(&s)).await
}

#[tauri::command]
pub async fn studio_update_download(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || crate::update_run::download(&s)).await
}

#[tauri::command]
pub async fn studio_update_install(
    window: WebviewWindow,
    sup: State<'_, Shared>,
) -> Result<Value, String> {
    local(&window)?;
    let s = sup.inner().clone();
    blocking(move || crate::update_run::install(&s)).await
}
