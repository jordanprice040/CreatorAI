#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod control;
mod download;
mod home;
mod job;
mod postgres;
mod secret;
mod signin;
mod studio;
#[cfg(windows)]
mod winsys;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    AppHandle, Manager, WebviewWindow,
};

pub const WEB_ORIGIN: &str = "http://127.0.0.1:5173/";
const IDENTIFIER: &str = "com.creatoragent.studio";

fn supervisor(app: &AppHandle) -> Option<studio::Shared> {
    app.try_state::<studio::Shared>().map(|s| s.inner().clone())
}

/// WebView2 data (cookies, storage) lives in the studio home, so a `CREATOR_STUDIO_HOME`
/// run never shares it with the installed app. WebView2 adds its own `EBWebView` folder, so
/// the default home keeps Tauri's default location.
fn webview_data(app: &AppHandle) -> Option<std::path::PathBuf> {
    supervisor(app).map(|s| s.home.root.clone())
}

/// Bundled setup/status window (local assets, the only window with native commands).
pub fn show_control(app: &AppHandle) {
    let window = match app.get_webview_window("control") {
        Some(w) => w,
        None => {
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "control",
                tauri::WebviewUrl::App("index.html".into()),
            );
            if let Some(dir) = webview_data(app) {
                builder = builder.data_directory(dir);
            }
            let built = builder
                .title("Creator Agent — status and settings")
                .inner_size(760.0, 720.0)
                .on_navigation(|url| {
                    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build();
            match built {
                Ok(w) => {
                    let handle = app.clone();
                    w.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let Some(sup) = supervisor(&handle) else {
                                return;
                            };
                            if sup.quitting() {
                                return;
                            }
                            api.prevent_close();
                            // While the studio runs, this is just a status window; otherwise
                            // closing it is the same as Quit.
                            if sup.running() {
                                if let Some(w) = handle.get_webview_window("control") {
                                    let _ = w.hide();
                                }
                            } else {
                                sup.quit();
                            }
                        }
                    });
                    w
                }
                Err(_) => return,
            }
        }
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn hide_control(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("control") {
        let _ = w.hide();
    }
}

pub fn hide_studio(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("studio") {
        let _ = w.hide();
    }
}

/// Brings forward the studio when it runs, otherwise the status window.
pub fn show_main(app: &AppHandle) {
    match supervisor(app) {
        Some(sup) if sup.running() => {
            if let Ok(w) = studio_window(app) {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        _ => show_control(app),
    }
}

/// The studio window: the production UI served by the app's own service on 127.0.0.1:5173.
pub fn studio_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window("studio") {
        return Ok(w);
    }
    let w = build_studio_window(app, WEB_ORIGIN.parse().unwrap(), Probes::default(), false)
        .map_err(|e| format!("Could not open the studio window: {e}"))?;
    let handle = app.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let Some(sup) = supervisor(&handle) else { return };
            if sup.quitting() {
                return;
            }
            api.prevent_close();
            if sup.close_behavior() == "background" {
                hide_studio(&handle);
                if sup.take_background_notice() {
                    #[cfg(windows)]
                    std::thread::spawn(|| {
                        winsys::message(
                            "Creator Agent is still running",
                            "Creator Agent keeps running in the background: the studio, its workflow worker and private previews continue. Open it again from the tray icon or the Start menu. Choose Quit in the tray or the Creator Agent menu to stop everything.",
                        )
                    });
                }
            } else {
                sup.quit();
            }
        }
    });
    Ok(w)
}

#[derive(Default, Clone, Copy)]
struct Probes {
    smoke: bool,
    download: bool,
    job: bool,
    signin: bool,
}
impl Probes {
    fn any(&self) -> bool {
        self.smoke || self.download || self.job || self.signin
    }
}

fn studio_home() -> Result<home::Home, String> {
    let root = match std::env::var("CREATOR_STUDIO_HOME") {
        Ok(p) if !p.is_empty() => std::path::PathBuf::from(p),
        _ => std::path::PathBuf::from(
            std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA is not set")?,
        )
        .join(IDENTIFIER),
    };
    home::Home::new(root)
}

fn studio_resources(app: &AppHandle) -> std::path::PathBuf {
    if cfg!(debug_assertions) {
        if let Ok(p) = std::env::var("CREATOR_STUDIO_RESOURCES") {
            return p.into();
        }
    }
    let dir = app
        .path()
        .resource_dir()
        .map(|d| d.join("studio"))
        .unwrap_or_default();
    plain_path(dir)
}

/// Drops the `\\?\` verbatim prefix Windows APIs may return for local drive paths: Node
/// cannot resolve its entry script through it, and child tools should see ordinary paths.
fn plain_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.into(),
        _ => p,
    }
}

fn local_navigation(url: &tauri::Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5173)
        && url.username().is_empty()
        && url.password().is_none()
}

fn private_preview(url: &tauri::Url) -> bool {
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(4320)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let Some(id) = url.path().strip_prefix("/preview/") else {
        return false;
    };
    if uuid::Uuid::parse_str(id).is_err() {
        return false;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    pairs.len() == 1
        && pairs[0].0 == "ticket"
        && pairs[0].1.len() == 43
        && pairs[0]
            .1
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Builds the studio window. Navigation stays on the management origin; preview tickets open
/// only in the system browser. Debug probes (X05) reuse this with external services.
fn build_studio_window(
    app: &AppHandle,
    url: tauri::Url,
    probes: Probes,
    visible: bool,
) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let Probes {
        smoke,
        download: download_probe,
        job: job_probe,
        signin: signin_probe,
    } = probes;
    let probing = Arc::new(AtomicBool::new(false));
    let observed = Arc::new(Mutex::new(None::<String>));
    let title_observed = observed.clone();
    let busy = Arc::new(AtomicBool::new(false));
    let downloaded = Arc::new(Mutex::new(None::<std::path::PathBuf>));
    let requests = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let local_sign_in = MenuItem::with_id(
        app,
        "local-signin",
        "Sign in as local owner",
        true,
        None::<&str>,
    )?;
    let local_sign_out = MenuItem::with_id(
        app,
        "local-signout",
        "Sign out on this computer",
        true,
        None::<&str>,
    )?;
    let status = MenuItem::with_id(
        app,
        "studio-status",
        "Status and settings…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "studio-quit", "Quit Creator Agent", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let studio_menu = Submenu::with_items(
        app,
        "Creator Agent",
        true,
        &[&local_sign_in, &local_sign_out, &status, &separator, &quit],
    )?;
    let sign_in = MenuItem::with_id(
        app,
        "browser-signin",
        "Sign in using system browser…",
        true,
        None::<&str>,
    )?;
    let source = MenuItem::with_id(
        app,
        "download-source",
        "Download selected Gallery source…",
        true,
        None::<&str>,
    )?;
    let editor = MenuItem::with_id(
        app,
        "open-manifest",
        "Open last downloaded manifest in editor…",
        true,
        None::<&str>,
    )?;
    let run = MenuItem::with_id(
        app,
        "paired-run",
        "Queue selected artifact once on paired worker (empty input)…",
        true,
        None::<&str>,
    )?;
    let tools = Submenu::with_items(app, "Tools", true, &[&sign_in, &source, &editor, &run])?;
    let menu = Menu::with_items(app, &[&studio_menu, &tools])?;
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, "studio", tauri::WebviewUrl::External(url));
    if let Some(dir) = webview_data(app) {
        builder = builder.data_directory(dir);
    }
    let window = builder
        .title("Creator Agent — local studio")
        .inner_size(1200.0, 800.0)
        .visible(visible && !probes.any())
        .on_document_title_changed(move |_, title| {
            if signin_probe && title.starts_with("CREATOR_SIGNIN_PROBE:") {
                *title_observed.lock().unwrap() = Some(title);
            }
        })
        .on_page_load(move |view, payload| {
            if smoke && payload.event() == tauri::webview::PageLoadEvent::Finished {
                println!("NATIVE_WEBVIEW_NAVIGATION_FINISHED {}", payload.url());
                view.app_handle().exit(0);
            }
            if signin_probe
                && payload.event() == tauri::webview::PageLoadEvent::Finished
                && !probing.swap(true, Ordering::SeqCst)
            {
                let handle = view.app_handle().clone();
                let observed = observed.clone();
                std::thread::spawn(move || {
                    let result = handle
                        .get_webview_window("studio")
                        .ok_or("Missing native window".to_string())
                        .and_then(|window| signin::probe(window, observed));
                    match result {
                        Ok(actor) => {
                            println!("NATIVE_SIGNIN_AUTHENTICATED {actor}");
                            handle.exit(0);
                        }
                        Err(e) => {
                            eprintln!("Native sign-in probe failed: {e}");
                            handle.exit(1);
                        }
                    }
                });
            }
            if (download_probe || job_probe)
                && payload.event() == tauri::webview::PageLoadEvent::Finished
                && !probing.swap(true, Ordering::SeqCst)
            {
                let handle = view.app_handle().clone();
                std::thread::spawn(move || {
                    let result = handle
                        .get_webview_window("studio")
                        .ok_or("Missing native window".to_string())
                        .and_then(|window| {
                            if job_probe {
                                job::probe(window)
                            } else {
                                download::probe(window).map(|p| p.display().to_string())
                            }
                        });
                    match result {
                        Ok(path) => {
                            println!(
                                "{} {}",
                                if job_probe {
                                    "NATIVE_PAIRED_JOB"
                                } else {
                                    "NATIVE_SOURCE_CACHE"
                                },
                                path
                            );
                            handle.exit(0);
                        }
                        Err(e) => {
                            eprintln!("Native download probe failed: {e}");
                            handle.exit(1);
                        }
                    }
                });
            }
        })
        .menu(menu)
        .on_menu_event(move |window, event| {
            let action = event.id().as_ref().to_owned();
            let handle = window.app_handle().clone();
            // App lifecycle actions go to the supervisor (absent in debug probes).
            if let Some(sup) = supervisor(&handle) {
                match action.as_str() {
                    "studio-quit" => return sup.quit(),
                    "studio-status" => return show_control(&handle),
                    "local-signin" | "local-signout" => {
                        std::thread::spawn(move || {
                            let r = if action == "local-signin" {
                                sup.sign_in()
                            } else {
                                sup.sign_out()
                            };
                            if let Err(e) = r {
                                if let Some(w) = handle.get_webview_window("studio") {
                                    let _ = w.set_title(&format!("Creator Agent — {e}"));
                                }
                            }
                        });
                        return;
                    }
                    _ => {}
                }
            }
            if ![
                "browser-signin",
                "download-source",
                "open-manifest",
                "paired-run",
            ]
            .contains(&action.as_str())
                || busy.swap(true, Ordering::SeqCst)
            {
                return;
            }
            let Some(webview) = window.app_handle().get_webview_window("studio") else {
                busy.store(false, Ordering::SeqCst);
                return;
            };
            let busy = busy.clone();
            let downloaded = downloaded.clone();
            let requests = requests.clone();
            std::thread::spawn(move || {
                let result = match action.as_str() {
                    "browser-signin" => signin::sign_in(webview.clone()),
                    "paired-run" => {
                        job::queue(webview.clone(), &mut requests.lock().unwrap()).map(|id| {
                            let _ = webview.set_title(&format!(
                                "Creator Agent — job {id}; inspect Desktop and workers"
                            ));
                        })
                    }
                    "download-source" => download::download(webview.clone()).map(|path| {
                        let _ = webview
                            .set_title("Creator Agent — source downloaded and hashes verified");
                        *downloaded.lock().unwrap() = Some(path);
                    }),
                    _ => {
                        let path = downloaded.lock().unwrap().clone();
                        path.ok_or("Download source from Gallery first".to_string())
                            .and_then(|p| {
                                let root = webview
                                    .path()
                                    .download_dir()
                                    .map_err(|_| "Downloads directory unavailable".to_string())?
                                    .join("Creator Agent source");
                                download::open_manifest(&p, &root).map(|_| {
                                    let _ = webview.set_title(
                                        "Creator Agent — opened verified editor copy in Downloads",
                                    );
                                })
                            })
                    }
                };
                if let Err(message) = result {
                    let _ = webview.set_title(&format!("Creator Agent — {message}"));
                }
                busy.store(false, Ordering::SeqCst);
            });
        })
        .on_navigation(local_navigation)
        .on_new_window(|url, _| {
            // Preview tickets open only on the distinct preview origin, outside management WebView.
            if private_preview(&url) {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["url.dll,FileProtocolHandler", url.as_str()])
                    .spawn();
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(window)
}

fn main() {
    // Debug-only probes observe actual WebView behavior against separately started services.
    let flag = |f: &str| cfg!(debug_assertions) && std::env::args().any(|a| a == f);
    let probes = Probes {
        smoke: flag("--startup-probe"),
        download: flag("--download-probe"),
        job: flag("--paired-job-probe"),
        signin: flag("--signin-probe"),
    };
    // One studio per user and data folder; a second launch only asks the first to show.
    #[cfg(windows)]
    let mut show_signal = None;
    #[cfg(windows)]
    let mut instance_guard = None;
    let home = if probes.any() {
        None
    } else {
        Some(studio_home())
    };
    #[cfg(windows)]
    if let Some(Ok(h)) = &home {
        match winsys::single_instance(&h.key()) {
            Ok(winsys::Instance::Second) => return,
            Ok(winsys::Instance::First { _mutex, show }) => {
                instance_guard = Some(_mutex);
                show_signal = Some(show);
            }
            Err(e) => {
                winsys::message("Creator Agent", &e);
                return;
            }
        }
    }
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            control::studio_state,
            control::studio_detect_postgres,
            control::studio_inspect_source,
            control::studio_setup,
            control::studio_retry,
            control::studio_migrate,
            control::studio_preferences,
            control::studio_sign_in,
            control::studio_sign_out,
            control::studio_open_logs,
            control::studio_open,
            control::studio_quit,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            if probes.any() {
                let url = if probes.download || probes.job {
                    let ws =
                        uuid::Uuid::parse_str(&std::env::var("CREATOR_NATIVE_PROBE_WORKSPACE")?)?;
                    let id =
                        uuid::Uuid::parse_str(&std::env::var("CREATOR_NATIVE_PROBE_ARTIFACT")?)?;
                    format!("http://127.0.0.1:5173/#/gallery?ws={ws}&id={id}").parse()?
                } else {
                    WEB_ORIGIN.parse()?
                };
                build_studio_window(&handle, url, probes, false)?;
                return Ok(());
            }
            let home = match home {
                Some(Ok(h)) => h,
                Some(Err(e)) => return Err(e.into()),
                None => unreachable!(),
            };
            let sup = studio::Supervisor::new(handle.clone(), home, studio_resources(&handle));
            app.manage(sup.clone());
            sup.note(&format!(
                "Creator Agent {} starting (home {})",
                env!("CARGO_PKG_VERSION"),
                sup.home.root.display()
            ));
            let tray_open =
                MenuItem::with_id(app, "tray-open", "Open Creator Agent", true, None::<&str>)?;
            let tray_status = MenuItem::with_id(
                app,
                "tray-status",
                "Status and settings…",
                true,
                None::<&str>,
            )?;
            let tray_quit =
                MenuItem::with_id(app, "tray-quit", "Quit Creator Agent", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&tray_open, &tray_status, &tray_quit])?;
            let mut tray = TrayIconBuilder::with_id("studio")
                .tooltip("Creator Agent")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-open" => show_main(app),
                    "tray-status" => show_control(app),
                    "tray-quit" => {
                        if let Some(s) = supervisor(app) {
                            s.quit()
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            #[cfg(windows)]
            if let Some(signal) = show_signal.take() {
                let handle = handle.clone();
                let sup = sup.clone();
                std::thread::spawn(move || loop {
                    if sup.quitting() {
                        return;
                    }
                    if winsys::wait_for_show(&signal, 1000) {
                        let h = handle.clone();
                        let _ = handle.run_on_main_thread(move || show_main(&h));
                    }
                });
            }
            sup.watchdog();
            sup.start();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Creator desktop startup failed");
    app.run(move |handle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            // Hidden windows keep the studio alive in background mode; only Quit exits.
            if code.is_none() && supervisor(handle).is_some_and(|s| !s.quitting()) {
                api.prevent_exit();
            }
        }
    });
    #[cfg(windows)]
    drop(instance_guard);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_refuses_other_origins_and_credentials() {
        assert!(local_navigation(
            &"http://127.0.0.1:5173/#/catalog".parse().unwrap()
        ));
        for target in [
            "http://127.0.0.1:4320/",
            "http://localhost:5173/",
            "https://example.org/",
            "file:///C:/Windows/",
            "http://user@127.0.0.1:5173/",
        ] {
            assert!(!local_navigation(&target.parse().unwrap()), "{target}");
        }
    }
    #[test]
    fn verbatim_drive_paths_become_plain() {
        assert_eq!(
            plain_path(r"\\?\C:\Users\x\Creator Agent\studio".into()),
            std::path::PathBuf::from(r"C:\Users\x\Creator Agent\studio")
        );
        let unc = std::path::PathBuf::from(r"\\?\UNC\server\share");
        assert_eq!(plain_path(unc.clone()), unc);
    }
    #[test]
    fn only_scoped_private_preview_tickets_can_open_a_browser() {
        let target = format!(
            "http://127.0.0.1:4320/preview/12345678-1234-4234-8234-123456789abc?ticket={}",
            "a".repeat(43)
        );
        assert!(private_preview(&target.parse().unwrap()));
        for value in [
            target.replace(":4320", ":5173"),
            target.replace("127.0.0.1", "example.org"),
            format!("{target}&other=x"),
            target.replace("/preview/", "/other/"),
        ] {
            assert!(!private_preview(&value.parse().unwrap()));
        }
    }
}
