//! N3 (ADR-0131): Windows notifications from the installed studio. A background thread polls
//! the studio's notification API every 30 seconds with the native session (the DPAPI-stored
//! sign-in, never the WebView's). While the studio window is hidden or minimised it claims a
//! pending interrupting row and shows it as one Windows toast; while the window is visible the
//! in-app toast gets the row first, and this thread claims it only as a fallback (the row
//! arrived after the window was shown and is still unclaimed 90 seconds later). The claim is
//! the studio's one-winner update, so a toast and a Windows notification never both appear.
//! Toasts only link: clicking one opens the studio window at the row's in-app route. They
//! carry no buttons and never approve, continue or spend anything. Once per launch, the first
//! signed-in poll asks for one summary of what expired unseen while the app was closed.
//! The remote studio UI still has no native IPC: this thread only talks HTTP to 127.0.0.1.
use crate::studio::{bounded_json, client, Shared};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const API: &str = "http://127.0.0.1:4310/api/notifications";
/// The studio's NATIVE_POLL_MS and NATIVE_FALLBACK_MS (contracts `notifications.ts`).
const POLL: Duration = Duration::from_secs(30);
const FALLBACK_MS: u64 = 90_000;
/// How often the window's visibility is sampled, so "shown since" is accurate to two seconds.
const TICK: Duration = Duration::from_secs(2);
/// At most this many Windows toasts per poll; the rest wait for the next poll.
const PER_POLL: usize = 3;
const HIDDEN_TITLE: &str = "Creator Agent needs you";

/// Whether this process may claim a row now. `shown_for` is how long the studio window has
/// been visible (None while hidden or minimised); `age_ms` is the row's age on the studio's
/// clock. A row that was already waiting when the window was shown is left to the bell, as in
/// the web UI (plan §4): it is never shown late.
pub fn may_claim(shown_for: Option<Duration>, age_ms: u64) -> bool {
    match shown_for {
        None => true,
        Some(shown) => age_ms >= FALLBACK_MS && u128::from(age_ms) <= shown.as_millis(),
    }
}

/// The studio's NOTIFICATION_LINK_PATTERN, loosely: an in-app route of safe characters only,
/// so the window never navigates anywhere but the studio origin.
pub fn valid_link(link: &str) -> bool {
    link.len() <= 300
        && link.starts_with("#/")
        && link
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "#/?=&:._-".contains(c))
}

/// Title and line for the toast; "Hide details on Windows" replaces both (plan §4, privacy).
pub fn toast_text(title: &str, body: &str, hide: bool) -> (String, String) {
    if hide {
        return (HIDDEN_TITLE.into(), String::new());
    }
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    (cut(title, 140), cut(body, 200))
}

pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if (c as u32) < 0x20 && c != '\t' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

/// A plain text toast: no actions, no images, no inputs.
pub fn toast_xml(title: &str, body: &str) -> String {
    let line = if body.is_empty() {
        String::new()
    } else {
        format!("<text>{}</text>", xml_escape(body))
    };
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text>{line}</binding></visual></toast>",
        xml_escape(title)
    )
}

/// One row the studio offers (`NativeNotificationSchema`), checked again here.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub body: String,
    pub link: String,
    pub age_ms: u64,
}

pub fn item(v: &Value) -> Option<Item> {
    let id = v["id"].as_str()?;
    uuid::Uuid::parse_str(id).ok()?;
    let link = v["link"].as_str()?;
    if !valid_link(link) {
        return None;
    }
    Some(Item {
        id: id.to_owned(),
        title: v["title"].as_str()?.to_owned(),
        body: v["body"].as_str().unwrap_or("").to_owned(),
        link: link.to_owned(),
        age_ms: v["age_ms"].as_u64()?,
    })
}

/// Opens (or brings forward) the studio window at an in-app route.
fn open_link(app: &AppHandle, link: &str) {
    if !valid_link(link) {
        return;
    }
    let Ok(url) = format!("{}{}", crate::WEB_ORIGIN, link).parse::<tauri::Url>() else {
        return;
    };
    if let Ok(w) = crate::studio_window(app) {
        let _ = w.navigate(url);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Whether a claim answer settles the row for this process: it won (2xx), or another window
/// or the bell already took it (409). Anything else (a 5xx, an expired sign-in, no answer) is
/// tried again on the next poll while the row is still pending (review L-3 of #236).
pub fn claim_settled(status: u16) -> bool {
    (200..300).contains(&status) || status == 409
}

/// The summary request: how long this app has been running, so only alerts from before it
/// started are summarised (review L-4 of #236). Close enough: the poller starts with the app.
fn catch_up_body(up: Duration) -> Value {
    json!({ "up_ms": u64::try_from(up.as_millis()).unwrap_or(u64::MAX).min(366 * 24 * 3_600_000) })
}

/// The changes since the last sample: the window's visibility and its page loads. A reload
/// restarts the web toast's "never shown late" cutoff, so it restarts ours too (review N-6).
fn shown_since(prev: Option<Instant>, visible: bool, reloaded: bool) -> Option<Instant> {
    match (visible, prev) {
        (false, _) => None,
        (true, Some(t)) if !reloaded => Some(t),
        (true, _) => Some(Instant::now()),
    }
}

struct Session {
    http: reqwest::blocking::Client,
    token: String,
    csrf: String,
}

impl Session {
    fn get(&self, path: &str) -> Result<reqwest::blocking::Response, String> {
        self.http
            .get(format!("{API}/{path}"))
            .header("Cookie", format!("creator_session={}", self.token))
            .send()
            .map_err(|_| "The studio did not answer".to_string())
    }
    fn post(&self, path: &str, body: Value) -> Result<reqwest::blocking::Response, String> {
        self.http
            .post(format!("{API}/{path}"))
            .header("Cookie", format!("creator_session={}", self.token))
            .header("X-CSRF-Token", &self.csrf)
            .json(&body)
            .send()
            .map_err(|_| "The studio did not answer".to_string())
    }
    fn json(&self, r: Result<reqwest::blocking::Response, String>) -> Result<Value, String> {
        let r = r?;
        if r.status().is_success() {
            bounded_json(r)
        } else {
            Err(format!("HTTP {}", r.status()))
        }
    }
}

/// Starts the poller for the installed app (Windows only; never for debug probes).
pub fn start(app: AppHandle, sup: Shared) {
    std::thread::spawn(move || {
        let _com = toast::init();
        let Ok(http) = client(5) else {
            return sup.note("Windows notifications are off: no local HTTP client");
        };
        let aumid = app.config().identifier.clone();
        let mut shown: Option<Instant> = None;
        let mut loads = crate::STUDIO_PAGE_LOADS.load(Ordering::SeqCst);
        let mut last_poll: Option<Instant> = None;
        let mut caught_up = false;
        let launched = Instant::now();
        let mut settled: VecDeque<String> = VecDeque::new();
        // Every toast shown this launch, so a click from Action Center still opens its link
        // (review N-3); each is a small handle.
        let mut alive: VecDeque<toast::Shown> = VecDeque::new();
        loop {
            if sup.quitting() {
                return;
            }
            let visible = app
                .get_webview_window("studio")
                .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true))
                .unwrap_or(false);
            let now_loads = crate::STUDIO_PAGE_LOADS.load(Ordering::SeqCst);
            shown = shown_since(shown, visible, now_loads != loads);
            loads = now_loads;
            let due = last_poll.is_none_or(|t| t.elapsed() >= POLL);
            if due && sup.running() {
                last_poll = Some(Instant::now());
                if let Some((token, csrf)) = sup.native_session() {
                    let session = Session {
                        http: http.clone(),
                        token,
                        csrf,
                    };
                    let os = toast::setting(&aumid);
                    let shown_for = shown.map(|t| t.elapsed());
                    let mut show = |title: &str, body: &str, link: String, id: String| {
                        let app = app.clone();
                        let clicked = sup.clone();
                        let http = http.clone();
                        let shown = toast::show(&aumid, &toast_xml(title, body), move || {
                            // Off the WinRT callback thread: the session check and the read
                            // are network calls (review N-2).
                            let app = app.clone();
                            let clicked = clicked.clone();
                            let http = http.clone();
                            let (link, id) = (link.clone(), id.clone());
                            std::thread::spawn(move || {
                                let handle = app.clone();
                                let _ = app.run_on_main_thread(move || open_link(&handle, &link));
                                // Opening it reads it, as in the bell.
                                if let Some((token, csrf)) = clicked.native_session() {
                                    let _ = Session { http, token, csrf }
                                        .post(&format!("{id}/read"), json!({}));
                                }
                            });
                        });
                        match shown {
                            Ok(t) => {
                                alive.push_back(t);
                                if alive.len() > 500 {
                                    alive.pop_front();
                                }
                            }
                            Err(e) => sup.note(&format!("Windows notification failed: {e}")),
                        }
                    };
                    if !caught_up && os == "on" {
                        match session
                            .json(session.post("catch-up", catch_up_body(launched.elapsed())))
                        {
                            Ok(v) => {
                                caught_up = true;
                                let hide = v["hide_details"].as_bool().unwrap_or(true);
                                if let Some(n) = item(&v["notification"]) {
                                    let (t, b) = toast_text(&n.title, &n.body, hide);
                                    show(&t, &b, n.link, n.id);
                                }
                            }
                            Err(e) => sup.note(&format!("Notification summary not read: {e}")),
                        }
                    }
                    match session.json(session.get(&format!("native?os={os}"))) {
                        // Windows does not allow the app's notifications (or this copy has no
                        // registered identity): claim nothing; the bell and the web keep them.
                        Ok(_) if os != "on" => {}
                        Ok(v) => {
                            let hide = v["hide_details"].as_bool().unwrap_or(true);
                            let rows = v["items"].as_array().cloned().unwrap_or_default();
                            let mut claimed = 0;
                            for n in rows.iter().filter_map(item) {
                                if claimed >= PER_POLL {
                                    break;
                                }
                                if settled.contains(&n.id) || !may_claim(shown_for, n.age_ms) {
                                    continue;
                                }
                                let Ok(r) = session
                                    .post(&format!("{}/claim", n.id), json!({"via":"windows"}))
                                else {
                                    continue;
                                };
                                let status = r.status().as_u16();
                                if !claim_settled(status) {
                                    continue;
                                }
                                settled.push_back(n.id.clone());
                                if settled.len() > 500 {
                                    settled.pop_front();
                                }
                                if r.status().is_success() {
                                    claimed += 1;
                                    let (t, b) = toast_text(&n.title, &n.body, hide);
                                    show(&t, &b, n.link, n.id);
                                }
                            }
                        }
                        Err(e) => sup.note(&format!("Notification poll failed: {e}")),
                    }
                }
            }
            std::thread::sleep(TICK);
        }
    });
}

mod toast {
    use windows::core::{IInspectable, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::UI::Notifications::{
        NotificationSetting, ToastNotification, ToastNotificationManager,
    };

    /// Keeps a shown toast (and its click handler) alive while it may still be clicked.
    pub struct Shown(#[allow(dead_code)] ToastNotification);

    pub struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }
    pub fn init() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }

    /// What Windows says about this app's notifications: "on", "off" (turned off by the
    /// person, a group policy or the system) or "unknown" (for example under `cargo run`,
    /// where the app has no registered AppUserModelID).
    pub fn setting(aumid: &str) -> &'static str {
        match ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))
            .and_then(|n| n.Setting())
        {
            Ok(NotificationSetting::Enabled) => "on",
            Ok(_) => "off",
            Err(_) => "unknown",
        }
    }

    pub fn show(
        aumid: &str,
        xml: &str,
        on_click: impl Fn() + Send + 'static,
    ) -> Result<Shown, String> {
        let run = || -> windows::core::Result<ToastNotification> {
            let doc = XmlDocument::new()?;
            doc.LoadXml(&HSTRING::from(xml))?;
            let toast = ToastNotification::CreateToastNotification(&doc)?;
            toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(
                move |_, _| {
                    on_click();
                    Ok(())
                },
            ))?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?
                .Show(&toast)?;
            Ok(toast)
        };
        run()
            .map(Shown)
            .map_err(|e| format!("{:#010x}", e.code().0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_claims_at_once_visible_only_as_a_late_fallback() {
        assert!(may_claim(None, 0));
        assert!(may_claim(None, 599_000));
        let shown = Some(Duration::from_secs(300));
        // The web toast gets the first 90 seconds.
        assert!(!may_claim(shown, 10_000));
        assert!(!may_claim(shown, 89_999));
        assert!(may_claim(shown, 90_000));
        // A row that was waiting before the window was shown stays in the bell.
        assert!(!may_claim(Some(Duration::from_secs(60)), 120_000));
        assert!(may_claim(Some(Duration::from_secs(121)), 120_000));
    }

    #[test]
    fn the_summary_names_the_launch() {
        assert_eq!(
            catch_up_body(Duration::from_millis(1500)),
            json!({"up_ms": 1500})
        );
        assert_eq!(
            catch_up_body(Duration::from_secs(400 * 24 * 3600)),
            json!({"up_ms": 366u64 * 24 * 3_600_000})
        );
    }

    #[test]
    fn only_a_win_or_a_conflict_settles_a_claim() {
        assert!(claim_settled(200));
        assert!(claim_settled(409));
        for retry in [401, 403, 404, 500, 502, 503] {
            assert!(!claim_settled(retry), "{retry}");
        }
    }

    #[test]
    fn a_reload_or_a_hide_restarts_the_shown_clock() {
        let then = Instant::now() - Duration::from_secs(300);
        assert_eq!(shown_since(Some(then), true, false), Some(then));
        assert_eq!(shown_since(Some(then), false, false), None);
        let after_reload = shown_since(Some(then), true, true).unwrap();
        assert!(after_reload > then);
        assert!(shown_since(None, true, false).is_some());
    }

    #[test]
    fn only_in_app_routes_are_opened() {
        assert!(valid_link("#/autopilot/run?ws=1f0e&id=abc-1"));
        assert!(valid_link("#/monitor/notifications?q=unread"));
        for bad in [
            "https://example.org/",
            "//example.org",
            "#/x\" onload=",
            "#/a b",
            "/#/a",
            "javascript:alert(1)",
        ] {
            assert!(!valid_link(bad), "{bad}");
        }
        assert!(!valid_link(&format!("#/{}", "a".repeat(300))));
    }

    #[test]
    fn hidden_details_replace_the_text_and_xml_is_escaped() {
        assert_eq!(
            toast_text("Autopilot stopped", "needs your choice", true),
            (HIDDEN_TITLE.to_string(), String::new())
        );
        assert_eq!(
            toast_text("A", "b", false),
            ("A".to_string(), "b".to_string())
        );
        let xml = toast_xml("<b>&\"'", "x\u{1}y");
        assert!(xml.contains("<text>&lt;b&gt;&amp;&quot;&apos;</text>"));
        assert!(xml.contains("<text>x y</text>"));
        assert!(!toast_xml("t", "").contains("<text></text>"));
        assert!(!xml.contains("<action"));
        // The start-up summary follows the same setting (review M-1 of #236).
        let summary = json!({"id":"12345678-1234-4234-8234-123456789abc",
            "title":"Missed alerts: 2 items still need you",
            "body":"Autopilot stopped: needs your choice · $19 of $20 spent or reserved",
            "link":"#/monitor/notifications?q=unread","age_ms":0,"severity":"needs_you"});
        let n = item(&summary).unwrap();
        assert_eq!(
            toast_text(&n.title, &n.body, true),
            (HIDDEN_TITLE.to_string(), String::new())
        );
    }

    #[test]
    fn rows_are_checked_again_before_use() {
        let good = json!({"id":"12345678-1234-4234-8234-123456789abc","title":"T","body":"B",
            "link":"#/autopilot/run?id=x","age_ms":5,"severity":"needs_you"});
        assert_eq!(item(&good).unwrap().age_ms, 5);
        let mut bad = good.clone();
        bad["link"] = json!("https://example.org/");
        assert!(item(&bad).is_none());
        let mut bad = good.clone();
        bad["id"] = json!("../x");
        assert!(item(&bad).is_none());
        assert!(item(&Value::Null).is_none());
    }
}
