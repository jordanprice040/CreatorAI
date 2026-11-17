//! In-app updates (F4, ADR-0128). The owner points the status window at a private GitHub
//! repository's releases and gives it a read-only token. "Check" reads the latest release and
//! its update manifest; "Download" saves the installer and refuses it unless its size and
//! SHA-256 match the manifest (and GitHub's own digest of the asset, when GitHub gives one).
//! "Install" saves a verified backup, copies the running version aside, and hands over to that
//! copy (`--apply-update`), which runs the installer, starts the new version and waits for it
//! to report that it is running. If it does not, the copy puts the earlier version back and,
//! when the database was already upgraded, restores the backup into a new database.
//!
//! Nothing here contacts the network until the owner has saved a repository and token and
//! chooses Check. Builds are unsigned for the private beta (owner decision 2026-11-17), so the
//! hash check is the integrity check: it proves the bytes are the ones the release named, not
//! who built them.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const MANIFEST_ASSET: &str = "creator-agent-update.json";
pub const MANIFEST_FORMAT: &str = "creator-agent-update/1";
pub const SETTINGS_FORMAT: &str = "creator-update-settings/1";
pub const PENDING_FORMAT: &str = "creator-update-pending/1";
pub const GITHUB_API: &str = "https://api.github.com";
/// Hosts GitHub sends release downloads to. The token is never sent to them.
pub const DOWNLOAD_HOSTS: [&str; 3] = [
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];
const MAX_JSON: u64 = 1024 * 1024;
const MAX_MANIFEST: u64 = 64 * 1024;
pub const MAX_INSTALLER: u64 = 1024 * 1024 * 1024;
/// How long the new version has to report that it is running (backup, rehearsal, migration
/// and start included) before the earlier version is put back.
pub const START_DEADLINE: Duration = Duration::from_secs(30 * 60);

// ---- versions and manifest -------------------------------------------------------------------

/// A plain `major.minor.patch` version, as in tauri.conf.json.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u64, pub u64, pub u64);
impl Version {
    pub fn parse(s: &str) -> Result<Self, String> {
        let parts: Vec<&str> = s.split('.').collect();
        let num = |p: &str| -> Option<u64> {
            if p.is_empty() || p.len() > 9 || !p.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            if p.len() > 1 && p.starts_with('0') {
                return None;
            }
            p.parse().ok()
        };
        match parts.as_slice() {
            [a, b, c] => match (num(a), num(b), num(c)) {
                (Some(a), Some(b), Some(c)) => Ok(Version(a, b, c)),
                _ => Err(format!("\"{s}\" is not a version like 1.2.3")),
            },
            _ => Err(format!("\"{s}\" is not a version like 1.2.3")),
        }
    }
}
impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}
pub fn current_version() -> Version {
    Version::parse(env!("CARGO_PKG_VERSION")).expect("package version")
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct InstallerRef {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    /// The database layout (highest migration) this version uses.
    pub schema_version: u32,
    pub source_commit: String,
    pub built_at: String,
    pub installer: InstallerRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// An installer file name: one plain name ending in .exe, no folders. Review H-1: only
/// characters GitHub keeps when it stores a release asset (it renames others, a space becomes
/// a dot), so the name in the manifest is the name the release lists.
pub fn safe_installer_name(n: &str) -> bool {
    n.len() <= 200
        && n.to_ascii_lowercase().ends_with(".exe")
        && !n.starts_with('.')
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let m: Manifest = serde_json::from_slice(bytes)
            .map_err(|e| format!("The release's update manifest is not valid: {e}"))?;
        m.validate()?;
        Ok(m)
    }
    pub fn validate(&self) -> Result<(), String> {
        let bad = |why: &str| Err(format!("The release's update manifest is not valid: {why}"));
        if self.format != MANIFEST_FORMAT {
            return bad("unknown format");
        }
        Version::parse(&self.version)?;
        if !hex(&self.source_commit, 40) {
            return bad("source_commit must be a 40-character commit id");
        }
        if !hex(&self.installer.sha256, 64) {
            return bad("installer.sha256 must be 64 lowercase hex characters");
        }
        if self.installer.size == 0 || self.installer.size > MAX_INSTALLER {
            return bad("installer.size is out of range");
        }
        if !safe_installer_name(&self.installer.name) {
            return bad(
                "installer.name must be a plain .exe file name of letters, digits, dots, - and _ (no spaces)",
            );
        }
        if self.built_at.len() > 40 {
            return bad("built_at is too long");
        }
        if self
            .notes
            .as_ref()
            .is_some_and(|n| n.chars().count() > 4000)
        {
            return bad("notes are longer than 4000 characters");
        }
        Ok(())
    }
}

// ---- settings and files in the studio home ---------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub format: String,
    /// `owner/repository` of the private release repository.
    pub repository: String,
    /// Check once each time the studio starts (off by default).
    pub check_at_start: bool,
}

/// `owner/name` as GitHub allows them.
pub fn valid_repository(r: &str) -> Result<(), String> {
    let ok = match r.split_once('/') {
        Some((o, n)) => {
            !o.is_empty()
                && o.len() <= 39
                && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !o.starts_with('-')
                && !n.is_empty()
                && n.len() <= 100
                && n != "."
                && n != ".."
                && n.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        }
        None => false,
    };
    if ok {
        Ok(())
    } else {
        Err(
            "Enter the release repository as owner/name, for example jordan/creator-agent-releases"
                .into(),
        )
    }
}

/// A GitHub token as GitHub issues them (fine-grained or classic); never logged or shown.
pub fn valid_token(t: &str) -> Result<(), String> {
    let ok =
        (20..=255).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(())
    } else {
        Err("That does not look like a GitHub token (letters, digits and _ only)".into())
    }
}

pub struct Paths {
    pub root: PathBuf,
}
impl Paths {
    pub fn new(studio_home: &Path) -> Self {
        Self {
            root: studio_home.join("updates"),
        }
    }
    pub fn settings(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    pub fn available(&self) -> PathBuf {
        self.root.join("available.json")
    }
    pub fn pending(&self) -> PathBuf {
        self.root.join("pending.json")
    }
    pub fn history(&self) -> PathBuf {
        self.root.join("history.jsonl")
    }
    pub fn outcome(&self, id: &str) -> PathBuf {
        self.root.join(format!("outcome-{id}.json"))
    }
    pub fn downloads(&self) -> PathBuf {
        self.root.join("downloads")
    }
    pub fn rollback(&self) -> PathBuf {
        self.root.join("rollback")
    }
    /// `studio.json` as it was when the update was approved (review L-5).
    pub fn settings_copy(&self, id: &str) -> PathBuf {
        self.root.join(format!("studio-before-{id}.json"))
    }
}

pub fn write_json_atomic(path: &Path, v: &impl Serialize) -> Result<(), String> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|_| "Could not create the updates folder")?;
    }
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(v).map_err(|_| "Could not encode update state")?;
    std::fs::write(&tmp, bytes).map_err(|_| "Could not write update state")?;
    std::fs::rename(&tmp, path).map_err(|_| "Could not save update state".into())
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)
            .map(Some)
            .map_err(|e| format!("{} is invalid: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(format!("Could not read {}", path.display())),
    }
}

impl Settings {
    pub fn load(p: &Paths) -> Result<Option<Settings>, String> {
        let s: Option<Settings> = read_json(&p.settings())?;
        if let Some(s) = &s {
            if s.format != SETTINGS_FORMAT {
                return Err("Unsupported update settings format".into());
            }
            valid_repository(&s.repository)?;
        }
        Ok(s)
    }
}

/// Append-only record of every update step (check, download, refusal, install, rollback).
/// Kept beside the database, not in it: a rollback may replace the database.
pub fn record(p: &Paths, event: &str, detail: Value) {
    let line = json!({"at": crate::studio::chrono_now(), "event": event, "detail": detail});
    let written = std::fs::create_dir_all(&p.root)
        .and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p.history())
        })
        .and_then(|mut f| writeln!(f, "{line}"));
    // Review L-6: a lost history line is itself noted, in the app's update log.
    if let Err(e) = written {
        if let Some(home) = p.root.parent() {
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(home.join("logs").join("update.log"))
            {
                let _ = writeln!(f, "could not record {event} in history.jsonl ({e}): {line}");
            }
        }
    }
}

/// The last `last` history entries, reading only the end of the file (review N-6).
pub fn history(p: &Paths, last: usize) -> Vec<Value> {
    use std::io::{Seek, SeekFrom};
    const TAIL: u64 = 64 * 1024;
    let Ok(mut f) = std::fs::File::open(p.history()) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if f.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    // A cut first line is dropped by the JSON parse below.
    let mut out: Vec<Value> = text
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str(l).ok())
        .take(last)
        .collect();
    out.reverse();
    out
}

pub fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let mut f = std::fs::File::open(path).map_err(|_| "Could not open the downloaded file")?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut n: u64 = 0;
    loop {
        let r = f
            .read(&mut buf)
            .map_err(|_| "Could not read the downloaded file")?;
        if r == 0 {
            break;
        }
        h.update(&buf[..r]);
        n += r as u64;
    }
    Ok((format!("{:x}", h.finalize()), n))
}

// ---- the release source ----------------------------------------------------------------------

/// A GitHub repository's releases, read with the owner's read-only token.
pub struct Source {
    pub api: String,
    pub repository: String,
    pub token: String,
    pub download_hosts: Vec<String>,
    /// Tests only: lets the fake server use plain http on 127.0.0.1.
    pub allow_loopback_http: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Available {
    pub version: String,
    pub newer: bool,
    pub tag: String,
    pub release_url: String,
    pub published_at: String,
    pub manifest: Manifest,
    pub manifest_sha256: String,
    pub installer_asset: u64,
    /// GitHub's own `sha256:` digest of the installer asset, when it gave one.
    pub github_digest: Option<String>,
    pub checked_at: String,
}

fn client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(timeout)
        .user_agent(concat!("creator-agent-updater/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Could not prepare the update connection".into())
}

fn read_bounded(mut r: impl Read, max: u64) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    (&mut r)
        .take(max + 1)
        .read_to_end(&mut out)
        .map_err(|_| "The download stopped before it finished".to_string())?;
    if out.len() as u64 > max {
        return Err("The release sent more data than expected".into());
    }
    Ok(out)
}

fn status_error(code: u16) -> String {
    match code {
        401 => "GitHub refused the token (401). Save a new token with read access to the release repository.".into(),
        403 => "GitHub refused the request (403): the token may lack access to this repository, or the rate limit was reached.".into(),
        404 => "GitHub found no published release in that repository (404), or the token cannot see it.".into(),
        c => format!("GitHub answered with status {c}"),
    }
}

impl Source {
    pub fn github(repository: &str, token: &str) -> Self {
        Self {
            api: GITHUB_API.into(),
            repository: repository.into(),
            token: token.into(),
            download_hosts: DOWNLOAD_HOSTS.iter().map(|h| h.to_string()).collect(),
            allow_loopback_http: false,
        }
    }

    fn api_get(
        &self,
        c: &reqwest::blocking::Client,
        path: &str,
        accept: &str,
    ) -> Result<reqwest::blocking::Response, String> {
        c.get(format!("{}/repos/{}{path}", self.api, self.repository))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", accept)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .map_err(|_| "Could not reach GitHub to check for updates".to_string())
    }

    /// Whether a redirect target may receive the download request (without the token).
    pub fn redirect_allowed(&self, url: &reqwest::Url) -> bool {
        let host = url.host_str().unwrap_or("");
        let creds = url.username().is_empty() && url.password().is_none();
        if self.allow_loopback_http && url.scheme() == "http" && host == "127.0.0.1" {
            return creds;
        }
        url.scheme() == "https"
            && creds
            && url.port().is_none()
            && self.download_hosts.iter().any(|h| h == host)
    }

    /// Opens a release asset's bytes. GitHub answers with a redirect to its download host;
    /// that one hop is followed only to a known host, and without the token.
    fn open_asset(
        &self,
        c: &reqwest::blocking::Client,
        id: u64,
    ) -> Result<reqwest::blocking::Response, String> {
        let r = self.api_get(
            c,
            &format!("/releases/assets/{id}"),
            "application/octet-stream",
        )?;
        let s = r.status();
        if s.is_success() {
            return Ok(r);
        }
        if !s.is_redirection() {
            return Err(status_error(s.as_u16()));
        }
        let location = r
            .headers()
            .get("location")
            .and_then(|l| l.to_str().ok())
            .ok_or("GitHub sent a redirect without a location")?;
        let url = reqwest::Url::parse(location).map_err(|_| "GitHub sent a malformed redirect")?;
        if !self.redirect_allowed(&url) {
            return Err(format!(
                "Refused to download from {}: not a GitHub download host",
                url.host_str().unwrap_or("an unknown host")
            ));
        }
        let r = c
            .get(url)
            .header("Accept", "application/octet-stream")
            .send()
            .map_err(|_| "Could not download from GitHub".to_string())?;
        if !r.status().is_success() {
            return Err(status_error(r.status().as_u16()));
        }
        Ok(r)
    }

    /// Reads the latest published release and its update manifest. Nothing is downloaded
    /// besides the manifest.
    pub fn check(&self, current: Version) -> Result<Available, String> {
        let c = client(Duration::from_secs(60))?;
        let r = self.api_get(&c, "/releases/latest", "application/vnd.github+json")?;
        if !r.status().is_success() {
            return Err(status_error(r.status().as_u16()));
        }
        let release: Value = serde_json::from_slice(&read_bounded(r, MAX_JSON)?)
            .map_err(|_| "GitHub's release answer was not readable")?;
        if release["draft"] == true || release["prerelease"] == true {
            return Err("The latest release is a draft or pre-release; it is not offered".into());
        }
        let assets = release["assets"].as_array().cloned().unwrap_or_default();
        let find = |name: &str| assets.iter().find(|a| a["name"] == name).cloned();
        let manifest_asset = find(MANIFEST_ASSET).ok_or(format!(
            "The latest release has no {MANIFEST_ASSET}, so it cannot be checked"
        ))?;
        let mid = manifest_asset["id"]
            .as_u64()
            .ok_or("Release asset without an id")?;
        let bytes = read_bounded(self.open_asset(&c, mid)?, MAX_MANIFEST)?;
        let manifest_sha256 = format!("{:x}", Sha256::digest(&bytes));
        if let Some(d) = manifest_asset["digest"].as_str() {
            if d != format!("sha256:{manifest_sha256}") {
                return Err("The update manifest does not match GitHub's digest of it".into());
            }
        }
        let manifest = Manifest::parse(&bytes)?;
        let tag = release["tag_name"].as_str().unwrap_or("").to_string();
        if tag != manifest.version && tag != format!("v{}", manifest.version) {
            return Err(format!(
                "The release tag {tag} does not match the manifest's version {}",
                manifest.version
            ));
        }
        let installer = find(&manifest.installer.name).ok_or(format!(
            "The release has no {} although its manifest names it",
            manifest.installer.name
        ))?;
        if installer["size"].as_u64() != Some(manifest.installer.size) {
            return Err("The installer's size on GitHub differs from the manifest".into());
        }
        let github_digest = installer["digest"].as_str().map(str::to_string);
        if let Some(d) = &github_digest {
            if *d != format!("sha256:{}", manifest.installer.sha256) {
                return Err(
                    "GitHub's digest of the installer differs from the manifest's SHA-256".into(),
                );
            }
        }
        let version = Version::parse(&manifest.version)?;
        Ok(Available {
            version: manifest.version.clone(),
            newer: version > current,
            tag,
            release_url: release["html_url"].as_str().unwrap_or("").to_string(),
            published_at: release["published_at"].as_str().unwrap_or("").to_string(),
            installer_asset: installer["id"]
                .as_u64()
                .ok_or("Installer asset without an id")?,
            github_digest,
            manifest,
            manifest_sha256,
            checked_at: crate::studio::chrono_now(),
        })
    }

    /// Downloads the installer into `dir`, hashing while it streams. It is written as
    /// `<name>.partial` and renamed only when size and SHA-256 match the manifest; a mismatch
    /// deletes it. Returns the final path.
    pub fn download(&self, a: &Available, dir: &Path) -> Result<PathBuf, String> {
        a.manifest.validate()?;
        let want = &a.manifest.installer;
        std::fs::create_dir_all(dir).map_err(|_| "Could not create the downloads folder")?;
        let path = dir.join(&want.name);
        let partial = dir.join(format!("{}.partial", want.name));
        let c = client(Duration::from_secs(60 * 60))?;
        let mut body = self.open_asset(&c, a.installer_asset)?;
        let result = (|| {
            let mut f =
                std::fs::File::create(&partial).map_err(|_| "Could not save the download")?;
            let mut h = Sha256::new();
            let mut n: u64 = 0;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let r = body
                    .read(&mut buf)
                    .map_err(|_| "The download stopped before it finished".to_string())?;
                if r == 0 {
                    break;
                }
                n += r as u64;
                if n > want.size {
                    return Err("The installer is larger than its manifest says; refused".into());
                }
                h.update(&buf[..r]);
                f.write_all(&buf[..r])
                    .map_err(|_| "Could not save the download".to_string())?;
            }
            f.sync_all().map_err(|_| "Could not save the download")?;
            if n != want.size {
                return Err(format!(
                    "The installer is {n} bytes; its manifest says {}. Refused.",
                    want.size
                ));
            }
            let got = format!("{:x}", h.finalize());
            if got != want.sha256 {
                return Err(format!(
                    "The installer's SHA-256 ({}…) does not match the manifest ({}…). It was deleted and will not be installed.",
                    &got[..12],
                    &want.sha256[..12]
                ));
            }
            Ok(())
        })();
        if let Err(e) = result {
            let _ = std::fs::remove_file(&partial);
            return Err(e);
        }
        std::fs::rename(&partial, &path).map_err(|_| "Could not finish saving the download")?;
        Ok(path)
    }
}

/// Re-hashes a downloaded installer right before it is used.
pub fn verify_download(path: &Path, want: &InstallerRef) -> Result<(), String> {
    let (sha, size) = sha256_file(path)?;
    if size != want.size || sha != want.sha256 {
        return Err(
            "The downloaded installer changed since it was verified; download it again".into(),
        );
    }
    Ok(())
}

// ---- install and roll back -------------------------------------------------------------------

/// What the running version hands to its copy before it quits.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Pending {
    pub format: String,
    pub id: String,
    pub from_version: String,
    pub to_version: String,
    pub installer: String,
    pub installer_sha256: String,
    pub installer_size: u64,
    /// The verified backup taken just before; a rollback restores it when needed.
    pub backup_dir: String,
    pub schema_before: i64,
    /// Review L-5: `studio.json` as it was before the update; a rollback puts it back first.
    pub settings_copy: String,
    /// The copy of the running version that applies the update and can be put back.
    pub rollback_dir: String,
    pub install_dir: String,
    pub exe_name: String,
    /// `installing`, `starting`, then `confirmed`, `rolled_back`, `rollback_failed` or `refused`.
    pub stage: String,
    pub detail: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Written by the new version once it runs (or fails to start) under a pending update.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Outcome {
    pub id: String,
    pub version: String,
    /// `running` or `failed`.
    pub result: String,
    pub detail: String,
    pub at: String,
}

/// Review L-4: after a rollback Windows still lists the failed version as installed, and the
/// installer refuses to install a lower one over it. Check refuses anything not above it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Failed {
    pub highest_failed: String,
}
pub fn failed_path(p: &Paths) -> PathBuf {
    p.root.join("failed.json")
}
/// Records a version that was rolled back, keeping the highest.
pub fn block_version(p: &Paths, v: &str) -> Result<(), String> {
    let new = Version::parse(v)?;
    let old = read_json::<Failed>(&failed_path(p))
        .ok()
        .flatten()
        .and_then(|f| Version::parse(&f.highest_failed).ok());
    if old.is_some_and(|o| o >= new) {
        return Ok(());
    }
    write_json_atomic(
        &failed_path(p),
        &Failed {
            highest_failed: v.into(),
        },
    )
}
/// Refuses a release that is not above every version that failed and was rolled back.
pub fn check_not_blocked(p: &Paths, v: &str) -> Result<(), String> {
    let Some(f) = read_json::<Failed>(&failed_path(p))? else {
        return Ok(());
    };
    if Version::parse(v)? <= Version::parse(&f.highest_failed)? {
        return Err(format!(
            "Version {v} is not above {}, which did not start earlier and is still recorded by Windows, so its installer would refuse. Publish a version above {}.",
            f.highest_failed, f.highest_failed
        ));
    }
    Ok(())
}

/// Review M-1: the helper touches this file while it watches; a launch that finds it stale
/// knows nobody is waiting for its report.
pub fn heartbeat(p: &Paths, id: &str) -> PathBuf {
    p.root.join(format!("helper-{id}.beat"))
}
pub const HEARTBEAT_FRESH: Duration = Duration::from_secs(20);
pub fn helper_alive(age: Option<Duration>) -> bool {
    age.is_some_and(|a| a <= HEARTBEAT_FRESH)
}

/// What a trial launch does with its outcome.
#[derive(Debug, PartialEq)]
pub enum TrialAction {
    /// The helper is watching: write the outcome for it.
    Report,
    /// The helper had gone (restart, crash) and this version runs: keep it.
    Confirm,
    /// The helper had gone and this version does not start: start the saved copy to roll back.
    ResumeRollback,
}
pub fn trial_action(helper_alive: bool, result: &str) -> TrialAction {
    match (helper_alive, result) {
        (true, _) => TrialAction::Report,
        (false, "running") => TrialAction::Confirm,
        (false, _) => TrialAction::ResumeRollback,
    }
}

/// How long the helper waits for the earlier version to quit before it gives up installing,
/// and then how much longer before it starts that version again (review L-2).
pub const QUIT_WAIT: Duration = Duration::from_secs(120);
pub const QUIT_WAIT_MORE: Duration = Duration::from_secs(20 * 60);

/// The steps of applying an update that touch the system, so the decisions can be tested.
pub trait Steps {
    /// Waits up to `limit` until no studio for this home runs.
    fn wait_for_previous_exit(&mut self, limit: Duration) -> Result<(), String>;
    fn run_installer(&mut self, installer: &Path) -> Result<(), String>;
    fn start_new_version(&mut self, exe: &Path) -> Result<(), String>;
    fn new_version_running(&mut self) -> bool;
    fn stop_new_version(&mut self);
    fn read_outcome(&mut self, id: &str) -> Option<Outcome>;
    fn wait(&mut self, d: Duration);
    fn elapsed_since_start(&mut self) -> Duration;
    /// Puts `studio.json` back as it was before the update.
    fn restore_settings(&mut self, copy: &Path) -> Result<(), String>;
    /// True when the database is no longer at the layout the earlier version uses.
    fn database_changed(&mut self, schema_before: i64) -> Result<bool, String>;
    /// Restores the backup into a new database and points the settings at it; returns its name.
    fn restore_database(&mut self, backup_dir: &Path) -> Result<String, String>;
    /// Drops rehearsal copies a stopped upgrade left behind; returns their names.
    fn drop_rehearsal_copies(&mut self) -> Result<Vec<String>, String>;
    /// Puts the earlier version's files back into the install folder.
    fn restore_files(&mut self, from: &Path, install_dir: &Path) -> Result<(), String>;
    /// Starts the earlier version again: from the install folder, or from the copy itself.
    fn start_previous(&mut self, exe: &Path) -> Result<(), String>;
    fn save(&mut self, p: &Pending) -> Result<(), String>;
    fn note(&mut self, event: &str, detail: Value);
    fn block_version(&mut self, v: &str) -> Result<(), String>;
    /// Review 2 L-B: only one process may roll an update back. False when another already
    /// claimed it (a helper that slept through its heartbeat and the copy started to resume).
    fn claim_rollback(&mut self, id: &str) -> Result<bool, String>;
}

/// The lock file a rollback claims (review 2 L-B); created exclusively, never reused.
pub fn rollback_claim(p: &Paths, id: &str) -> PathBuf {
    p.root.join(format!("rollback-{id}.lock"))
}

/// Whether the installer may have changed the installed version (review 2 N-A).
#[derive(Clone, Copy, PartialEq)]
enum Installed {
    No,
    Maybe,
}

fn set(steps: &mut dyn Steps, p: &mut Pending, stage: &str, detail: &str) -> Result<(), String> {
    p.stage = stage.into();
    p.detail = detail.into();
    p.updated_at = crate::studio::chrono_now();
    steps.save(p)
}

/// Gives up before installing, then makes sure the earlier version runs again (review L-2).
fn refuse(steps: &mut dyn Steps, mut p: Pending, why: &str, installed_exe: &Path) -> Pending {
    let _ = set(steps, &mut p, "refused", why);
    steps.note("update_refused", json!({"id": p.id, "reason": why}));
    let _ = steps.wait_for_previous_exit(QUIT_WAIT_MORE);
    if let Err(e) = steps.start_previous(installed_exe) {
        steps.note("start_previous_failed", json!({"id": p.id, "reason": e}));
    }
    p
}

/// Applies a pending update. Every path ends with a version running: the new one when it
/// reported that it runs, otherwise the earlier one.
pub fn apply(steps: &mut dyn Steps, mut p: Pending) -> Pending {
    let install_dir = PathBuf::from(&p.install_dir);
    let rollback_dir = PathBuf::from(&p.rollback_dir);
    let installed_exe = install_dir.join(&p.exe_name);
    let copy_exe = rollback_dir.join(&p.exe_name);
    // Review L-6: the new version learns of its trial from this file; unwritable means stop.
    if let Err(e) = set(
        steps,
        &mut p,
        "installing",
        "Waiting for Creator Agent to quit",
    ) {
        return refuse(
            steps,
            p,
            &format!("The update's progress could not be saved, so nothing was installed: {e}"),
            &installed_exe,
        );
    }
    if let Err(e) = steps.wait_for_previous_exit(QUIT_WAIT) {
        return refuse(
            steps,
            p,
            &format!("Creator Agent did not quit, so nothing was installed: {e}"),
            &installed_exe,
        );
    }
    // The installer is hashed again here, by the copy that runs it.
    let want = InstallerRef {
        name: String::new(),
        size: p.installer_size,
        sha256: p.installer_sha256.clone(),
    };
    if let Err(e) = verify_download(Path::new(&p.installer), &want) {
        return refuse(steps, p, &e, &installed_exe);
    }
    steps.note("install_started", json!({"id": p.id, "to": p.to_version}));
    if let Err(e) = steps.run_installer(Path::new(&p.installer)) {
        return roll_back(
            steps,
            p,
            &format!("The installer did not finish: {e}"),
            &installed_exe,
            &copy_exe,
            Installed::No,
        );
    }
    if let Err(e) = set(steps, &mut p, "starting", "Starting the new version") {
        return roll_back(
            steps,
            p,
            &format!("The update's progress could not be saved: {e}"),
            &installed_exe,
            &copy_exe,
            Installed::Maybe,
        );
    }
    if let Err(e) = steps.start_new_version(&installed_exe) {
        return roll_back(
            steps,
            p,
            &format!("The new version could not be started: {e}"),
            &installed_exe,
            &copy_exe,
            Installed::Maybe,
        );
    }
    loop {
        if let Some(o) = steps.read_outcome(&p.id) {
            if o.result == "running" && o.version == p.to_version {
                let _ = set(steps, &mut p, "confirmed", "The new version is running");
                steps.note(
                    "update_confirmed",
                    json!({"id": p.id, "version": p.to_version}),
                );
                return p;
            }
            let why = if o.result == "running" {
                format!(
                    "The installed version reports {}, not {}",
                    o.version, p.to_version
                )
            } else {
                format!("The new version did not start: {}", o.detail)
            };
            return roll_back(steps, p, &why, &installed_exe, &copy_exe, Installed::Maybe);
        }
        if !steps.new_version_running() {
            return roll_back(
                steps,
                p,
                "The new version closed before it reported that it runs",
                &installed_exe,
                &copy_exe,
                Installed::Maybe,
            );
        }
        if steps.elapsed_since_start() >= START_DEADLINE {
            return roll_back(
                steps,
                p,
                "The new version did not report that it runs within 30 minutes",
                &installed_exe,
                &copy_exe,
                Installed::Maybe,
            );
        }
        steps.wait(Duration::from_secs(2));
    }
}

/// Review M-1: the saved copy started again by a new version that does not start after the
/// first helper had gone. That version quits itself; the copy then rolls back.
pub fn resume_rollback(steps: &mut dyn Steps, p: Pending, why: &str) -> Pending {
    let installed_exe = PathBuf::from(&p.install_dir).join(&p.exe_name);
    let copy_exe = PathBuf::from(&p.rollback_dir).join(&p.exe_name);
    if let Err(e) = steps.wait_for_previous_exit(QUIT_WAIT + QUIT_WAIT_MORE) {
        steps.note(
            "rollback_waiting",
            json!({"id": p.id, "reason": format!("the new version did not quit: {e}")}),
        );
    }
    roll_back(steps, p, why, &installed_exe, &copy_exe, Installed::Maybe)
}

fn roll_back(
    steps: &mut dyn Steps,
    mut p: Pending,
    why: &str,
    installed_exe: &Path,
    copy_exe: &Path,
    installed: Installed,
) -> Pending {
    match steps.claim_rollback(&p.id) {
        Ok(true) => {}
        Ok(false) => {
            steps.note(
                "rollback_already_claimed",
                json!({"id": p.id, "reason": why}),
            );
            return p;
        }
        Err(e) => steps.note(
            "rollback_claim_unrecorded",
            json!({"id": p.id, "reason": e}),
        ),
    }
    let mut problems = Vec::new();
    if let Err(e) = set(steps, &mut p, "rolling_back", why) {
        problems.push(format!("the update's progress could not be saved ({e})"));
    }
    steps.note("rollback_started", json!({"id": p.id, "reason": why}));
    steps.stop_new_version();
    let mut restored_db = None;
    // Review L-5: the settings first, so the earlier version can read them again.
    if let Err(e) = steps.restore_settings(Path::new(&p.settings_copy)) {
        problems.push(format!("the studio settings could not be put back ({e})"));
    }
    // Review L-3: a stopped upgrade can leave its rehearsal copy behind. Review 2 L-A: before
    // the restore, while the settings still name the database the copies were made from.
    match steps.drop_rehearsal_copies() {
        Ok(dropped) if !dropped.is_empty() => {
            steps.note(
                "rehearsal_copies_dropped",
                json!({"id": p.id, "databases": dropped}),
            );
        }
        Ok(_) => {}
        Err(e) => problems.push(format!(
            "leftover rehearsal copies of the database could not be checked or removed ({e})"
        )),
    }
    match steps.database_changed(p.schema_before) {
        Ok(false) => {}
        Ok(true) => match steps.restore_database(Path::new(&p.backup_dir)) {
            Ok(name) => restored_db = Some(name),
            Err(e) => problems.push(format!("the backup could not be restored ({e})")),
        },
        Err(e) => problems.push(format!("the database could not be checked ({e})")),
    }
    let files = steps.restore_files(Path::new(&p.rollback_dir), Path::new(&p.install_dir));
    let start = match &files {
        Ok(()) => installed_exe,
        Err(e) => {
            problems.push(format!(
                "the earlier files could not be put back ({e}); it runs from its saved copy"
            ));
            copy_exe
        }
    };
    if let Err(e) = steps.start_previous(start) {
        problems.push(format!("the earlier version could not be started ({e})"));
    }
    // Review 2 N-A: an installer that failed changed nothing Windows records.
    if installed == Installed::Maybe {
        if let Err(e) = steps.block_version(&p.to_version) {
            problems.push(format!("the failed version could not be recorded ({e})"));
        }
    }
    let mut detail = format!("{why}. Creator Agent went back to {}.", p.from_version);
    if let Some(db) = &restored_db {
        detail.push_str(&format!(
            " The database was restored from the backup taken before the update into {db}; the upgraded one was kept, unchanged, for inspection."
        ));
    }
    if installed == Installed::Maybe {
        detail.push_str(&format!(
            " Windows still lists {} as installed, so the next update must be newer than {}.",
            p.to_version, p.to_version
        ));
    }
    if !problems.is_empty() {
        detail.push_str(&format!(" Problems: {}.", problems.join("; ")));
    }
    let stage = if problems.is_empty() {
        "rolled_back"
    } else {
        "rollback_failed"
    };
    let _ = set(steps, &mut p, stage, &detail);
    steps.note(
        stage,
        json!({"id": p.id, "to": p.to_version, "detail": p.detail, "restored_database": restored_db}),
    );
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[test]
    fn versions_compare_numerically_and_refuse_odd_forms() {
        assert!(Version::parse("0.10.0").unwrap() > Version::parse("0.9.9").unwrap());
        assert!(Version::parse("1.0.0").unwrap() > Version::parse("0.99.99").unwrap());
        assert_eq!(Version::parse("0.1.0").unwrap(), current_version());
        for bad in [
            "1.2",
            "1.2.3.4",
            "v1.2.3",
            "1.02.3",
            "1.2.x",
            "",
            "1..3",
            "1.2.3-beta",
        ] {
            assert!(Version::parse(bad).is_err(), "{bad}");
        }
    }

    fn manifest(bytes: &[u8], version: &str) -> Manifest {
        Manifest {
            format: MANIFEST_FORMAT.into(),
            version: version.into(),
            schema_version: 79,
            source_commit: "a".repeat(40),
            built_at: "2026-11-17T10:00:00Z".into(),
            installer: InstallerRef {
                name: format!("Creator-Agent_{version}_x64-setup.exe"),
                size: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(bytes)),
            },
            notes: Some("Fixes".into()),
        }
    }

    #[test]
    fn manifest_validation_refuses_unsafe_or_malformed_fields() {
        let ok = manifest(b"x", "0.2.0");
        ok.validate().unwrap();
        let mut cases = Vec::new();
        let mut m = ok.clone();
        m.format = "other/1".into();
        cases.push(m);
        let mut m = ok.clone();
        m.installer.name = "..\\evil.exe".into();
        cases.push(m);
        let mut m = ok.clone();
        m.installer.name = "setup.msi".into();
        cases.push(m);
        let mut m = ok.clone();
        m.installer.sha256 = "A".repeat(64);
        cases.push(m);
        let mut m = ok.clone();
        m.installer.size = 0;
        cases.push(m);
        let mut m = ok.clone();
        m.installer.size = MAX_INSTALLER + 1;
        cases.push(m);
        let mut m = ok.clone();
        m.source_commit = "abc".into();
        cases.push(m);
        let mut m = ok.clone();
        m.version = "latest".into();
        cases.push(m);
        for m in cases {
            assert!(m.validate().is_err(), "{m:?}");
        }
        let mut extra = serde_json::to_value(&ok).unwrap();
        extra["run_after_install"] = json!("cmd.exe");
        assert!(Manifest::parse(extra.to_string().as_bytes()).is_err());
    }

    /// The file `update-manifest.mjs` writes is the file this app reads (contract fixture,
    /// also checked from the Node side in desktop-update-manifest.test.ts).
    #[test]
    fn the_release_script_example_parses() {
        let m = Manifest::parse(include_bytes!("update-manifest-example.json")).unwrap();
        assert_eq!(m.version, "0.2.0");
        assert_eq!(m.installer.size, 104857600);
    }

    #[test]
    fn repository_and_token_shapes() {
        valid_repository("jordanprice040/creator-agent-releases").unwrap();
        for bad in [
            "noslash",
            "a/b/c",
            "/repo",
            "owner/",
            "own er/repo",
            "o/..",
            "-o/r",
        ] {
            assert!(valid_repository(bad).is_err(), "{bad}");
        }
        valid_token(&format!("github_pat_{}", "A1_".repeat(20))).unwrap();
        assert!(valid_token("short").is_err());
        assert!(valid_token(&format!("ghp_{} x", "a".repeat(30))).is_err());
    }

    #[test]
    fn redirects_go_only_to_github_download_hosts() {
        let s = Source::github("o/r", "t");
        let ok = |u: &str| s.redirect_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://objects.githubusercontent.com/x?sig=1"));
        assert!(ok("https://release-assets.githubusercontent.com/x"));
        assert!(!ok("http://objects.githubusercontent.com/x"));
        assert!(!ok("https://objects.githubusercontent.com:8443/x"));
        assert!(!ok("https://evil.example/x"));
        assert!(!ok("https://user@objects.githubusercontent.com/x"));
        assert!(!ok("http://127.0.0.1:9/x"), "loopback only in tests");
    }

    // ---- a fake GitHub on 127.0.0.1 -----------------------------------------------------

    type Seen = Arc<Mutex<Vec<(String, HashMap<String, String>)>>>;
    /// Path → (status, headers, body).
    type Routes = HashMap<String, (u16, Vec<(String, String)>, Vec<u8>)>;
    struct Fake {
        base: String,
        seen: Seen,
    }
    fn fake(routes: Routes) -> Fake {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let seen: Seen = Arc::default();
        let seen2 = seen.clone();
        let base2 = base.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { continue };
                let mut r = BufReader::new(s.try_clone().unwrap());
                let mut line = String::new();
                if r.read_line(&mut line).is_err() {
                    continue;
                }
                let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                let mut headers = HashMap::new();
                loop {
                    let mut h = String::new();
                    if r.read_line(&mut h).is_err() || h.trim().is_empty() {
                        break;
                    }
                    if let Some((k, v)) = h.trim().split_once(':') {
                        headers.insert(k.to_ascii_lowercase(), v.trim().to_string());
                    }
                }
                seen2.lock().unwrap().push((path.clone(), headers));
                let (code, extra, body) =
                    routes
                        .get(&path)
                        .cloned()
                        .unwrap_or((404, vec![], b"{}".to_vec()));
                let mut head = format!(
                    "HTTP/1.1 {code} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                    body.len()
                );
                for (k, v) in extra {
                    head.push_str(&format!("{k}: {}\r\n", v.replace("{base}", &base2)));
                }
                head.push_str("\r\n");
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(&body);
            }
        });
        Fake { base, seen }
    }

    fn release_routes(m: &Manifest, installer: &[u8], installer_digest: Option<String>) -> Routes {
        let mbytes = serde_json::to_vec(m).unwrap();
        let mut inst = json!({"id": 22, "name": m.installer.name, "size": m.installer.size});
        if let Some(d) = installer_digest {
            inst["digest"] = json!(d);
        }
        let release = json!({
            "tag_name": format!("v{}", m.version), "draft": false, "prerelease": false,
            "html_url": "https://github.com/o/r/releases/tag/x", "published_at": "2026-11-17T10:00:00Z",
            "assets": [
                {"id": 11, "name": MANIFEST_ASSET, "size": mbytes.len(),
                 "digest": format!("sha256:{:x}", Sha256::digest(&mbytes))},
                inst,
            ],
        });
        let mut routes = HashMap::new();
        routes.insert(
            "/repos/o/r/releases/latest".into(),
            (200, vec![], release.to_string().into_bytes()),
        );
        routes.insert(
            "/repos/o/r/releases/assets/11".into(),
            (200, vec![], mbytes),
        );
        // The installer comes through a redirect, as on GitHub.
        routes.insert(
            "/repos/o/r/releases/assets/22".into(),
            (
                302,
                vec![("Location".into(), "{base}/download/installer".into())],
                vec![],
            ),
        );
        routes.insert(
            "/download/installer".into(),
            (200, vec![], installer.to_vec()),
        );
        routes
    }

    fn source(f: &Fake) -> Source {
        Source {
            api: f.base.clone(),
            repository: "o/r".into(),
            token: "test_token_0123456789abcdef".into(),
            download_hosts: vec![],
            allow_loopback_http: true,
        }
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "creator-update-{tag}-{}",
            crate::studio::random_hex(6).unwrap()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn finds_a_newer_version_and_downloads_it_only_when_the_hash_matches() {
        let bytes = b"MZ fake installer bytes".to_vec();
        let m = manifest(&bytes, "0.2.0");
        let digest = format!("sha256:{}", m.installer.sha256);
        let f = fake(release_routes(&m, &bytes, Some(digest)));
        let s = source(&f);
        let a = s.check(Version(0, 1, 0)).unwrap();
        assert!(a.newer);
        assert_eq!(a.version, "0.2.0");
        assert_eq!(a.manifest, m);
        assert!(
            !s.check(Version(0, 2, 0)).unwrap().newer,
            "same version is not newer"
        );
        let dir = tmp("ok");
        let path = s.download(&a, &dir).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        verify_download(&path, &m.installer).unwrap();
        // The token went to the API, never to the download host it redirected to.
        let seen = f.seen.lock().unwrap();
        let api = seen
            .iter()
            .find(|(p, _)| p == "/repos/o/r/releases/assets/22")
            .unwrap();
        assert_eq!(api.1["authorization"], "Bearer test_token_0123456789abcdef");
        let dl = seen
            .iter()
            .find(|(p, _)| p == "/download/installer")
            .unwrap();
        assert!(!dl.1.contains_key("authorization"));
        drop(seen);
        // A file changed after the download is refused at install time.
        std::fs::write(&path, b"MZ fake installer bytez").unwrap();
        assert!(verify_download(&path, &m.installer).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_a_hash_mismatch_and_keeps_nothing() {
        let bytes = b"MZ the real installer".to_vec();
        let m = manifest(&bytes, "0.2.0");
        // The release serves different bytes of the same length.
        let tampered = b"MZ the evil installer".to_vec();
        assert_eq!(tampered.len(), bytes.len());
        let f = fake(release_routes(&m, &tampered, None));
        let s = source(&f);
        let a = s.check(Version(0, 1, 0)).unwrap();
        let dir = tmp("bad");
        let e = s.download(&a, &dir).unwrap_err();
        assert!(e.contains("does not match the manifest"), "{e}");
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            0,
            "nothing left behind"
        );
        // Longer than the manifest says: stopped while streaming.
        let f = fake(release_routes(
            &m,
            &[bytes.clone(), b"more".to_vec()].concat(),
            None,
        ));
        let a = source(&f).check(Version(0, 1, 0)).unwrap();
        assert!(source(&f)
            .download(&a, &dir)
            .unwrap_err()
            .contains("larger"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_releases_whose_parts_disagree() {
        let bytes = b"MZ installer".to_vec();
        let m = manifest(&bytes, "0.2.0");
        // GitHub's own digest of the installer disagrees with the manifest.
        let f = fake(release_routes(
            &m,
            &bytes,
            Some(format!("sha256:{}", "0".repeat(64))),
        ));
        assert!(source(&f)
            .check(Version(0, 1, 0))
            .unwrap_err()
            .contains("digest"));
        // The tag names another version than the manifest.
        let mut routes = release_routes(&m, &bytes, None);
        let latest = routes.get_mut("/repos/o/r/releases/latest").unwrap();
        let mut rel: Value = serde_json::from_slice(&latest.2).unwrap();
        rel["tag_name"] = json!("v0.3.0");
        latest.2 = rel.to_string().into_bytes();
        let f = fake(routes);
        assert!(source(&f)
            .check(Version(0, 1, 0))
            .unwrap_err()
            .contains("does not match"));
        // A redirect to anywhere but a GitHub download host is refused.
        let mut routes = release_routes(&m, &bytes, None);
        routes.insert(
            "/repos/o/r/releases/assets/11".into(),
            (
                302,
                vec![("Location".into(), "https://evil.example/m.json".into())],
                vec![],
            ),
        );
        let f = fake(routes);
        assert!(source(&f)
            .check(Version(0, 1, 0))
            .unwrap_err()
            .contains("Refused"));
        // A token GitHub refuses says so.
        let f = fake(HashMap::from([(
            "/repos/o/r/releases/latest".to_string(),
            (401, vec![], b"{}".to_vec()),
        )]));
        assert!(source(&f)
            .check(Version(0, 1, 0))
            .unwrap_err()
            .contains("401"));
    }

    // ---- applying and rolling back ------------------------------------------------------

    #[derive(Default)]
    struct FakeSteps {
        exited: bool,
        installer_fails: bool,
        outcome: Option<Outcome>,
        outcome_after: u32,
        alive: bool,
        db_changed: bool,
        files_fail: bool,
        /// Exits seen only after this many waits (review L-2), or never with `exited: false`.
        exit_after_waits: u32,
        exit_waits: u32,
        save_fails: bool,
        leftover_copies: Vec<String>,
        /// Another process already claimed the rollback (review 2 L-B).
        claimed_elsewhere: bool,
        polls: u32,
        clock: Duration,
        log: Vec<String>,
        saved: Vec<String>,
    }
    impl Steps for FakeSteps {
        fn wait_for_previous_exit(&mut self, limit: Duration) -> Result<(), String> {
            self.exit_waits += 1;
            self.log.push(format!("wait_exit {}", limit.as_secs()));
            if self.exited && self.exit_waits > self.exit_after_waits {
                Ok(())
            } else {
                Err("still running".into())
            }
        }
        fn run_installer(&mut self, _: &Path) -> Result<(), String> {
            self.log.push("install".into());
            if self.installer_fails {
                Err("exit code 2".into())
            } else {
                Ok(())
            }
        }
        fn start_new_version(&mut self, _: &Path) -> Result<(), String> {
            self.log.push("start_new".into());
            Ok(())
        }
        fn new_version_running(&mut self) -> bool {
            self.alive
        }
        fn stop_new_version(&mut self) {
            self.log.push("stop_new".into());
        }
        fn read_outcome(&mut self, _: &str) -> Option<Outcome> {
            self.polls += 1;
            if self.polls > self.outcome_after {
                self.outcome.clone()
            } else {
                None
            }
        }
        fn wait(&mut self, d: Duration) {
            self.clock += d;
        }
        fn elapsed_since_start(&mut self) -> Duration {
            self.clock
        }
        fn restore_settings(&mut self, _: &Path) -> Result<(), String> {
            self.log.push("restore_settings".into());
            Ok(())
        }
        fn drop_rehearsal_copies(&mut self) -> Result<Vec<String>, String> {
            self.log.push("drop_rehearsals".into());
            Ok(std::mem::take(&mut self.leftover_copies))
        }
        fn block_version(&mut self, v: &str) -> Result<(), String> {
            self.log.push(format!("block {v}"));
            Ok(())
        }
        fn database_changed(&mut self, _: i64) -> Result<bool, String> {
            Ok(self.db_changed)
        }
        fn restore_database(&mut self, _: &Path) -> Result<String, String> {
            self.log.push("restore_db".into());
            Ok("creator_studio_rb_1".into())
        }
        fn restore_files(&mut self, _: &Path, _: &Path) -> Result<(), String> {
            self.log.push("restore_files".into());
            if self.files_fail {
                Err("locked".into())
            } else {
                Ok(())
            }
        }
        fn start_previous(&mut self, exe: &Path) -> Result<(), String> {
            self.log.push(format!("start_previous {}", exe.display()));
            Ok(())
        }
        fn save(&mut self, p: &Pending) -> Result<(), String> {
            if self.save_fails {
                return Err("disk full".into());
            }
            self.saved.push(p.stage.clone());
            Ok(())
        }
        fn note(&mut self, e: &str, _: Value) {
            self.log.push(format!("note {e}"));
        }
        fn claim_rollback(&mut self, _: &str) -> Result<bool, String> {
            self.log.push("claim".into());
            Ok(!std::mem::replace(&mut self.claimed_elsewhere, true))
        }
    }

    fn pending(installer: &Path, bytes: &[u8]) -> Pending {
        Pending {
            format: PENDING_FORMAT.into(),
            id: "abc".into(),
            from_version: "0.1.0".into(),
            to_version: "0.2.0".into(),
            installer: installer.display().to_string(),
            installer_sha256: format!("{:x}", Sha256::digest(bytes)),
            installer_size: bytes.len() as u64,
            backup_dir: "/b".into(),
            schema_before: 78,
            settings_copy: "/u/studio-before.json".into(),
            rollback_dir: "/rb".into(),
            install_dir: "/app".into(),
            exe_name: "creator-desktop.exe".into(),
            stage: "installing".into(),
            detail: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
    fn running(v: &str) -> Option<Outcome> {
        Some(Outcome {
            id: "abc".into(),
            version: v.into(),
            result: "running".into(),
            detail: String::new(),
            at: String::new(),
        })
    }
    fn with_installer(tag: &str) -> (PathBuf, Pending) {
        let dir = tmp(tag);
        let inst = dir.join("setup.exe");
        std::fs::write(&inst, b"MZ new").unwrap();
        let p = pending(&inst, b"MZ new");
        (dir, p)
    }

    #[test]
    fn a_new_version_that_reports_running_is_kept() {
        let (dir, p) = with_installer("keep");
        let mut s = FakeSteps {
            exited: true,
            alive: true,
            outcome: running("0.2.0"),
            outcome_after: 3,
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "confirmed");
        assert_eq!(s.saved, ["installing", "starting", "confirmed"]);
        assert!(!s
            .log
            .iter()
            .any(|l| l.starts_with("restore") || l == "stop_new"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_new_version_that_never_starts_is_rolled_back_with_the_backup() {
        let (dir, p) = with_installer("timeout");
        let mut s = FakeSteps {
            exited: true,
            alive: true,
            db_changed: true,
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "rolled_back");
        assert!(out.detail.contains("within 30 minutes"), "{}", out.detail);
        assert!(out.detail.contains("creator_studio_rb_1"));
        assert!(s.clock >= START_DEADLINE);
        let order: Vec<&str> = s
            .log
            .iter()
            .map(String::as_str)
            .filter(|l| !l.starts_with("note") && !l.starts_with("wait_exit"))
            .collect();
        let app = format!(
            "start_previous {}",
            Path::new("/app").join("creator-desktop.exe").display()
        );
        assert_eq!(
            order,
            [
                "install",
                "start_new",
                "claim",
                "stop_new",
                "restore_settings",
                "drop_rehearsals",
                "restore_db",
                "restore_files",
                app.as_str(),
                "block 0.2.0"
            ]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_crash_or_a_reported_failure_rolls_back_without_touching_an_unchanged_database() {
        let (dir, p) = with_installer("crash");
        let mut s = FakeSteps {
            exited: true,
            alive: false,
            ..Default::default()
        };
        let out = apply(&mut s, p.clone());
        assert_eq!(out.stage, "rolled_back");
        assert!(out.detail.contains("closed before"));
        assert!(!s.log.iter().any(|l| l == "restore_db"));
        let mut s = FakeSteps {
            exited: true,
            alive: true,
            outcome: Some(Outcome {
                result: "failed".into(),
                detail: "Port 5173 is in use".into(),
                ..running("0.2.0").unwrap()
            }),
            ..Default::default()
        };
        let out = apply(&mut s, p.clone());
        assert_eq!(out.stage, "rolled_back");
        assert!(out.detail.contains("Port 5173"));
        // A different version than the one installed counts as not started.
        let mut s = FakeSteps {
            exited: true,
            alive: true,
            outcome: running("0.1.5"),
            ..Default::default()
        };
        assert_eq!(apply(&mut s, p).stage, "rolled_back");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_installer_or_stuck_files_still_end_with_the_earlier_version_running() {
        let (dir, p) = with_installer("inst");
        let mut s = FakeSteps {
            exited: true,
            installer_fails: true,
            files_fail: true,
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "rollback_failed");
        assert!(out.detail.contains("exit code 2"));
        // Review 2 N-A: the installer changed nothing Windows records, so nothing is blocked.
        assert!(
            !out.detail.contains("Windows still lists"),
            "{}",
            out.detail
        );
        assert!(!s.log.iter().any(|l| l.starts_with("block ")));
        assert!(out.detail.contains("runs from its saved copy"));
        assert_eq!(
            s.log
                .iter()
                .rfind(|l| l.starts_with("start_previous"))
                .unwrap(),
            &format!(
                "start_previous {}",
                Path::new("/rb").join("creator-desktop.exe").display()
            )
        );
        assert!(!s.log.iter().any(|l| l == "start_new"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_changed_installer_or_a_running_studio_is_refused_before_installing() {
        let (dir, mut p) = with_installer("refuse");
        let mut s = FakeSteps {
            exited: false,
            ..Default::default()
        };
        assert_eq!(apply(&mut s, p.clone()).stage, "refused");
        assert!(!s.log.iter().any(|l| l == "install"));
        // Review L-2: after giving up it keeps waiting, then starts the earlier version.
        assert_eq!(s.log[..2], ["wait_exit 120", "note update_refused"]);
        assert_eq!(s.log[2], "wait_exit 1200");
        assert!(s.log[3].starts_with("start_previous"));
        p.installer_sha256 = "0".repeat(64);
        let mut s = FakeSteps {
            exited: true,
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "refused");
        assert!(!s.log.iter().any(|l| l == "install"));
        assert_eq!(
            s.log.last().unwrap(),
            &format!(
                "start_previous {}",
                Path::new("/app").join("creator-desktop.exe").display()
            )
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_slow_quit_still_installs_and_an_unsavable_update_never_starts() {
        // Exits on the first wait (the 2-minute one): normal path.
        let (dir, p) = with_installer("slow");
        // Review L-6: progress that cannot be saved refuses before anything is installed,
        // and the earlier version is started again.
        let mut s = FakeSteps {
            exited: true,
            save_fails: true,
            ..Default::default()
        };
        let out = apply(&mut s, p.clone());
        assert_eq!(out.stage, "refused");
        assert!(out.detail.contains("could not be saved"));
        assert!(!s.log.iter().any(|l| l == "install"));
        assert!(s.log.last().unwrap().starts_with("start_previous"));
        // Review L-2: a quit slower than two minutes ends with the earlier version started
        // once it has quit, not with nothing running.
        let mut s = FakeSteps {
            exited: true,
            exit_after_waits: 1,
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "refused");
        assert_eq!(s.exit_waits, 2);
        assert!(s.log.last().unwrap().starts_with("start_previous"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_rollback_drops_leftover_rehearsal_copies_and_records_them() {
        let (dir, p) = with_installer("leftover");
        let mut s = FakeSteps {
            exited: true,
            alive: false,
            db_changed: true,
            leftover_copies: vec!["creator_studio_rehearse_0a1b2c3d".into()],
            ..Default::default()
        };
        let out = apply(&mut s, p);
        assert_eq!(out.stage, "rolled_back");
        assert!(s.log.iter().any(|l| l == "note rehearsal_copies_dropped"));
        // Review 2 L-A: copies are looked for before the restore renames the database.
        let at = |name: &str| s.log.iter().position(|l| l == name).unwrap();
        assert!(at("drop_rehearsals") < at("restore_db"), "{:?}", s.log);
        let _ = std::fs::remove_dir_all(dir);
    }

    // Review 2 L-B: a helper that slept through its heartbeat and the copy the new version
    // started both reach a rollback; only the first to claim it acts.
    #[test]
    fn only_one_process_rolls_an_update_back() {
        let (dir, p) = with_installer("claim");
        let mut s = FakeSteps {
            exited: true,
            alive: true,
            outcome: Some(Outcome {
                id: "abc".into(),
                version: "0.2.0".into(),
                result: "failed".into(),
                detail: "port in use".into(),
                at: String::new(),
            }),
            db_changed: true,
            claimed_elsewhere: true,
            ..Default::default()
        };
        let out = apply(&mut s, p.clone());
        assert_eq!(out.stage, "starting", "left to the process that claimed it");
        assert!(s.log.iter().any(|l| l == "note rollback_already_claimed"));
        for step in ["stop_new", "restore_db", "restore_files", "drop_rehearsals"] {
            assert!(!s.log.iter().any(|l| l == step), "{step}: {:?}", s.log);
        }
        assert!(!s.log.iter().any(|l| l.starts_with("start_previous")));
        // The resume path loses the same way; the first claim wins.
        let mut r = FakeSteps {
            exited: true,
            claimed_elsewhere: true,
            ..Default::default()
        };
        let mut q = p;
        q.stage = "resuming_rollback".into();
        let out = resume_rollback(&mut r, q, "The new version did not start");
        assert_eq!(out.stage, "resuming_rollback");
        assert!(!r.log.iter().any(|l| l == "restore_files"));
        let mut first = FakeSteps {
            exited: true,
            ..Default::default()
        };
        let (_, p2) = with_installer("claim2");
        let mut q = p2;
        q.stage = "resuming_rollback".into();
        assert_eq!(resume_rollback(&mut first, q, "x").stage, "rolled_back");
        let _ = std::fs::remove_dir_all(dir);
    }

    // Review M-1: the watcher can die (restart, crash) during the trial.
    #[test]
    fn a_trial_without_its_watcher_confirms_or_resumes_the_rollback() {
        assert!(helper_alive(Some(Duration::from_secs(3))));
        assert!(!helper_alive(Some(Duration::from_secs(21))));
        assert!(!helper_alive(None));
        assert_eq!(trial_action(true, "failed"), TrialAction::Report);
        assert_eq!(trial_action(true, "running"), TrialAction::Report);
        assert_eq!(trial_action(false, "running"), TrialAction::Confirm);
        assert_eq!(trial_action(false, "failed"), TrialAction::ResumeRollback);
        // The resumed copy waits for the failed version to quit, then rolls back fully.
        let (dir, mut p) = with_installer("resume");
        p.stage = "starting".into();
        let mut s = FakeSteps {
            exited: true,
            db_changed: true,
            ..Default::default()
        };
        let out = resume_rollback(
            &mut s,
            p,
            "The new version did not start: Port 5173 is in use",
        );
        assert_eq!(out.stage, "rolled_back");
        assert!(out.detail.contains("Port 5173"));
        assert_eq!(s.log[0], "wait_exit 1320");
        assert!(s.log.iter().any(|l| l == "restore_db"));
        assert!(!s.log.iter().any(|l| l == "install" || l == "start_new"));
        let _ = std::fs::remove_dir_all(dir);
    }

    // Review L-4: Windows keeps the failed version recorded, so nothing at or below it is offered.
    #[test]
    fn versions_at_or_below_a_failed_one_are_refused() {
        let dir = tmp("blocked");
        let paths = Paths { root: dir.clone() };
        check_not_blocked(&paths, "0.1.1").unwrap();
        block_version(&paths, "0.2.0").unwrap();
        block_version(&paths, "0.1.5").unwrap();
        for v in ["0.1.1", "0.2.0"] {
            let e = check_not_blocked(&paths, v).unwrap_err();
            assert!(e.contains("not above 0.2.0"), "{e}");
        }
        check_not_blocked(&paths, "0.2.1").unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // Review H-1: GitHub renames asset files with spaces (a space becomes a dot), so a name it
    // would change is refused in the manifest, and the release's listed name must match.
    #[test]
    fn installer_names_are_ones_github_keeps() {
        let mut m = manifest(b"x", "0.2.0");
        m.installer.name = "Creator Agent_0.2.0_x64-setup.exe".into();
        assert!(m.validate().unwrap_err().contains("no spaces"));
        let bytes = b"MZ installer".to_vec();
        let m = manifest(&bytes, "0.2.0");
        let mut routes = release_routes(&m, &bytes, None);
        let latest = routes.get_mut("/repos/o/r/releases/latest").unwrap();
        let mut rel: Value = serde_json::from_slice(&latest.2).unwrap();
        rel["assets"][1]["name"] = json!("Creator.Agent_0.2.0_x64-setup.exe");
        latest.2 = rel.to_string().into_bytes();
        let f = fake(routes);
        let e = source(&f).check(Version(0, 1, 0)).unwrap_err();
        assert!(
            e.contains("has no Creator-Agent_0.2.0_x64-setup.exe"),
            "{e}"
        );
    }
}
