//! ADR-0061: which links the studio window may hand to the system browser or mail app.
//! Only https links to a public-looking host name and plain mailto addresses qualify; file:,
//! http:, custom schemes, IP literals, localhost and single-label or local-network names,
//! credentials and explicit ports never do. Keep `desktopOpens` in apps/web/src/markdown.ts
//! in step with this.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Url;

const MAX_LEN: usize = 2048;
/// Name endings that only mean something on a local network or this computer.
const LOCAL_SUFFIXES: [&str; 7] = [
    "localhost",
    "local",
    "lan",
    "home",
    "internal",
    "intranet",
    "home.arpa",
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

/// At most one hand-off per second, so a page can't open a flood of browser tabs.
pub struct Throttle(AtomicU64);

impl Throttle {
    pub const fn new() -> Self {
        Self(AtomicU64::new(0))
    }
    pub fn allow(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let last = self.0.load(Ordering::SeqCst);
        now.saturating_sub(last) >= 1000
            && self
                .0
                .compare_exchange(last, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_public_https_and_plain_mailto_links_open() {
        for ok in [
            "https://example.com/docs",
            "https://docs.example.co.uk/a?b=c#d",
            "https://xn--bcher-kva.example/",
            "https://example.com./",
            "mailto:jordan.p+x@example.com",
            "https://claude.ai/settings/usage",
            "https://chatgpt.com/settings/usage",
        ] {
            assert!(external_link(&ok.parse().unwrap()), "{ok}");
        }
        for refused in [
            "http://example.com/",
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            "javascript:alert(1)",
            "ftp://example.com/",
            "https://127.0.0.1/",
            "https://127.1/",
            "https://0x7f000001/",
            "https://[::1]/",
            "https://localhost/",
            "https://studio.localhost/",
            "https://printer.local/",
            "https://router.home.arpa/",
            "https://intranet/",
            "https://example.com:8443/",
            "https://user:pw@example.com/",
            "https://user@example.com/",
            "mailto:",
            "mailto:a@example.com?body=hi",
            "mailto:a@example.com,b@example.com",
            "mailto:a@localhost",
            "mailto:a@127.0.0.1",
        ] {
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
