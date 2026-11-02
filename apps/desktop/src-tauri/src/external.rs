//! ADR-0061: which links the studio window may hand to the system browser or mail app.
//! Only https links to a public-looking host name and plain mailto addresses qualify; file:,
//! http:, custom schemes, IP literals, localhost and single-label or local-network names,
//! credentials and explicit ports never do. A public name that resolves to this computer or the
//! local network is not detected (beyond the well-known loopback DNS services listed below).
//! Keep `desktopOpens` in apps/web/src/markdown.ts in step with this; both test suites read
//! external-link-cases.json.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::Url;

const MAX_LEN: usize = 2048;
/// Name endings that only mean something on a local network or this computer, plus public DNS
/// services whose names are built to point back at a local or private address.
const LOCAL_SUFFIXES: [&str; 14] = [
    "localhost",
    "local",
    "localdomain",
    "lan",
    "home",
    "corp",
    "internal",
    "intranet",
    "home.arpa",
    "nip.io",
    "sslip.io",
    "xip.io",
    "localtest.me",
    "lvh.me",
];

fn public_host_name(host: &str) -> bool {
    let host = host.strip_suffix('.').unwrap_or(host).to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 || host.len() > 253 {
        return false;
    }
    if labels.iter().any(|l| {
        l.is_empty()
            || l.len() > 63
            || l.starts_with('-')
            || l.ends_with('-')
            || !l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }) {
        return false;
    }
    // IPv6 literals fail the character check above; a dotted name ending in digits is an IPv4
    // address (the URL parser already turned forms like 127.1 or 0x7f000001 into 127.0.0.1).
    if labels
        .last()
        .is_some_and(|l| l.chars().all(|c| c.is_ascii_digit()))
    {
        return false;
    }
    !LOCAL_SUFFIXES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// True for a link the owner may open outside the studio window.
pub fn external_link(url: &Url) -> bool {
    if url.as_str().len() > MAX_LEN {
        return false;
    }
    match url.scheme() {
        "https" => {
            url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && url.host_str().is_some_and(public_host_name)
        }
        "mailto" => {
            let to = url.path();
            url.query().is_none()
                && url.fragment().is_none()
                && !to.is_empty()
                && !to.contains(',')
                && !to.contains('%')
                && to.split_once('@').is_some_and(|(user, host)| {
                    !user.is_empty()
                        && user
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
                        && public_host_name(host)
                })
        }
        _ => false,
    }
}

/// At most one hand-off per second, so a page can't open a flood of browser tabs. Measured on a
/// monotonic clock, so a system clock change can't block or unblock hand-offs.
pub struct Throttle(AtomicU64);

const NEVER: u64 = u64::MAX;

fn millis_since_start() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

impl Throttle {
    pub const fn new() -> Self {
        Self(AtomicU64::new(NEVER))
    }
    pub fn allow(&self) -> bool {
        let now = millis_since_start();
        let last = self.0.load(Ordering::SeqCst);
        (last == NEVER || now.saturating_sub(last) >= 1000)
            && self
                .0
                .compare_exchange(last, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }
}

/// What happened to a link the studio window was asked to open, for the title-bar note.
pub enum Outcome {
    Opened,
    Refused,
    Throttled,
}

impl Outcome {
    pub fn note(&self) -> &'static str {
        match self {
            Outcome::Opened => "Creator Agent — opened the link in your browser or mail app",
            Outcome::Refused => {
                "Creator Agent — link not opened: only public https pages and plain email addresses open from the app"
            }
            Outcome::Throttled => {
                "Creator Agent — link not opened: wait a second between links"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_public_https_and_plain_mailto_links_open() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("external-link-cases.json")).unwrap();
        for ok in cases["open"].as_array().unwrap() {
            let ok = ok.as_str().unwrap();
            assert!(external_link(&ok.parse().unwrap()), "{ok}");
        }
        for refused in cases["refused"].as_array().unwrap() {
            let refused = refused.as_str().unwrap();
            assert!(!external_link(&refused.parse().unwrap()), "{refused}");
        }
        let long = format!("https://example.com/{}", "a".repeat(MAX_LEN));
        assert!(!external_link(&long.parse().unwrap()));
    }
    #[test]
    fn hand_offs_are_throttled() {
        let t = Throttle::new();
        assert!(t.allow());
        assert!(!t.allow());
    }
}
