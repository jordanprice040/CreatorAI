#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod download;
mod job;
mod signin;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    webview::NewWindowResponse,
    Manager,
};

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

fn main() {
    // Initial shell uses the existing same-origin web/API proxy. No native commands,
    // plugins, credentials, execution, or remote IPC permissions are exposed.
    tauri::Builder::default()
        .setup(|app| {
            // Debug-only probe observes actual WebView startup without claiming UI interaction.
            let smoke = cfg!(debug_assertions) && std::env::args().any(|a| a == "--startup-probe");
            let download_probe =
                cfg!(debug_assertions) && std::env::args().any(|a| a == "--download-probe");
            let job_probe =
                cfg!(debug_assertions) && std::env::args().any(|a| a == "--paired-job-probe");
            let signin_probe =
                cfg!(debug_assertions) && std::env::args().any(|a| a == "--signin-probe");
            let probing = Arc::new(AtomicBool::new(false));
            let observed = Arc::new(Mutex::new(None::<String>));
            let title_observed = observed.clone();
            let busy = Arc::new(AtomicBool::new(false));
            let downloaded = Arc::new(Mutex::new(None::<std::path::PathBuf>));
            let requests = Arc::new(Mutex::new(std::collections::HashMap::new()));
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
            let menu = Menu::with_items(app, &[&sign_in, &source, &editor, &run])?;
            let url = if download_probe || job_probe {
                let ws = uuid::Uuid::parse_str(&std::env::var("CREATOR_NATIVE_PROBE_WORKSPACE")?)?;
                let id = uuid::Uuid::parse_str(&std::env::var("CREATOR_NATIVE_PROBE_ARTIFACT")?)?;
                format!("http://127.0.0.1:5173/#/gallery?ws={ws}&id={id}").parse()?
            } else {
                "http://127.0.0.1:5173/".parse()?
            };
            tauri::WebviewWindowBuilder::new(app, "studio", tauri::WebviewUrl::External(url))
                .title("Creator Agent — local studio (X05 preview)")
                .inner_size(1200.0, 800.0)
                .visible(!smoke && !download_probe && !job_probe && !signin_probe)
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
                                job::queue(webview.clone(), &mut requests.lock().unwrap()).map(
                                    |id| {
                                        let _ = webview.set_title(&format!(
                                            "Creator Agent — job {id}; inspect Desktop and workers"
                                        ));
                                    },
                                )
                            }
                            "download-source" => download::download(webview.clone()).map(|path| {
                                let _ = webview.set_title(
                                    "Creator Agent — source downloaded and hashes verified",
                                );
                                *downloaded.lock().unwrap() = Some(path);
                            }),
                            _ => {
                                let path = downloaded.lock().unwrap().clone();
                                path.ok_or("Download source from Gallery first".to_string())
                                    .and_then(|p| {
                                        let root = webview.path().download_dir()
                                            .map_err(|_| "Downloads directory unavailable".to_string())?
                                            .join("Creator Agent source");
                                        download::open_manifest(&p, &root).map(|_| {
                                            let _ = webview.set_title("Creator Agent — opened verified editor copy in Downloads");
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Creator desktop startup failed");
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
