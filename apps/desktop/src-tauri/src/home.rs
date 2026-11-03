//! The installed studio's per-user home (ADR-0041): configuration, logs, backups, product
//! store, managed PostgreSQL data and DPAPI secrets, outside the repository and OneDrive.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const CONFIG_FORMAT: &str = "creator-desktop-config/1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DatabaseConfig {
    /// `managed`: app-owned cluster in this home. `external`: reused, never started/stopped.
    pub mode: String,
    /// Loopback port of the managed cluster, or of the external server (display only).
    pub port: u16,
    pub name: String,
    pub user: String,
    /// Non-secret description shown in status, e.g. `127.0.0.1:55433/creator_studio`.
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StudioConfig {
    pub format: String,
    pub database: DatabaseConfig,
    /// PostgreSQL 18 binaries (managed prerequisite; also used for backups).
    pub pg_bin: Option<String>,
    pub products_root: String,
    /// `quit` or `background`.
    pub close_behavior: String,
    pub launch_at_login: bool,
    /// How the studio's records got here: adoption evidence, a new studio, or a connection.
    pub origin: serde_json::Value,
    pub created_at: String,
    /// Websites the owner approved for evidence fetching (host names only). Empty means live
    /// fetching stays off. Omitted when empty so an older app can still read this file.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_hosts: Vec<String>,
}

impl StudioConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.format != CONFIG_FORMAT {
            return Err("Unsupported studio configuration format".into());
        }
        if !["managed", "external"].contains(&self.database.mode.as_str()) {
            return Err("Database mode must be managed or external".into());
        }
        if !["quit", "background"].contains(&self.close_behavior.as_str()) {
            return Err("Close behavior must be quit or background".into());
        }
        if self.database.port < 1024 {
            return Err("Database port must be 1024 or higher".into());
        }
        valid_ident(&self.database.name)?;
        valid_ident(&self.database.user)?;
        if !Path::new(&self.products_root).is_absolute() {
            return Err("Product folder must be absolute".into());
        }
        if self.source_hosts.len() > MAX_SOURCE_HOSTS {
            return Err(format!("Approve at most {MAX_SOURCE_HOSTS} websites"));
        }
        for h in &self.source_hosts {
            valid_host(h)?;
        }
        Ok(())
    }
}

pub const MAX_SOURCE_HOSTS: usize = 20;

/// A lowercase DNS host name such as `www.example.com`: no scheme, port, path or IP address.
pub fn valid_host(h: &str) -> Result<(), String> {
    let labels: Vec<&str> = h.split('.').collect();
    let ok = h.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
        && !labels
            .last()
            .is_some_and(|t| t.chars().all(|c| c.is_ascii_digit()));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "\"{h}\" is not a website host name like www.example.com"
        ))
    }
}

pub fn valid_ident(s: &str) -> Result<(), String> {
    let ok = !s.is_empty()
        && s.len() <= 63
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c == '_')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if ok {
        Ok(())
    } else {
        Err("Database and user names use lowercase letters, digits and underscores".into())
    }
}

/// Refuses repository-relative or OneDrive-synced locations for owner data.
pub fn check_home(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("The studio folder must be an absolute path".into());
    }
    if path.components().any(|c| {
        c.as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .starts_with("onedrive")
    }) {
        return Err("The studio folder must not be inside OneDrive".into());
    }
    Ok(())
}

/// The path as the file system resolves it (junctions, 8.3 names, separators), without
/// creating anything: the deepest existing ancestor is canonicalized and the rest appended.
fn resolved(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        if let Ok(c) = std::fs::canonicalize(&cur) {
            return rest.into_iter().rev().fold(c, |p: PathBuf, n| p.join(n));
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                cur = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// The deepest folder on `path` that already exists (the path itself when it does).
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    path.ancestors().find(|p| p.is_dir()).map(Path::to_path_buf)
}

/// Lowercased path segments with any `\\?\` verbatim prefix, separators and `.` dropped.
fn segments(p: &Path) -> Vec<String> {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.split('\\')
        .filter(|x| !x.is_empty() && *x != ".")
        .map(str::to_string)
        .collect()
}

/// The MSIX package whose private `Packages\<package>\LocalCache` folder holds `p`.
fn package_cache(p: &Path) -> Option<String> {
    let segs = segments(p);
    segs.windows(3)
        .find(|w| w[0].eq_ignore_ascii_case("packages") && w[2].eq_ignore_ascii_case("localcache"))
        .map(|w| w[1].clone())
}

/// When a folder created at `requested` actually landed at `observed` inside another app's
/// package cache, the package that redirected it (pilot finding F14).
pub fn redirected_package(requested: &Path, observed: &Path) -> Option<String> {
    match (package_cache(requested), package_cache(observed)) {
        (None, Some(pkg)) => Some(pkg),
        _ => None,
    }
}

/// The plain refusal shown when Windows redirects the studio folder into `package`.
pub fn redirect_message(package: &str) -> String {
    format!(
        "Creator Agent was started from inside another app ({package}).\n\n\
         Windows quietly moves new files from apps started that way into that app's own \
         storage, so studio data would be split between two folders and builds would later \
         fail with \"Noncanonical path refused\".\n\n\
         Nothing was changed. Close this message and start Creator Agent yourself from the \
         Start menu or its desktop shortcut, not from inside another app such as Claude."
    )
}

/// Refuses a studio folder whose new files Windows would redirect into an app package's
/// LocalCache (a process started inside an MSIX container, e.g. by the Claude desktop app).
/// It creates and removes one empty probe folder at the deepest existing part of `root` and
/// compares where it really landed. If no probe can be made, Home::new reports the problem.
pub fn check_not_redirected(root: &Path) -> Result<(), String> {
    let Some(base) = existing_ancestor(root) else {
        return Ok(());
    };
    let Ok(tag) = crate::studio::random_hex(8) else {
        return Ok(());
    };
    let probe = base.join(format!(".creator-redirect-probe-{tag}"));
    if std::fs::create_dir(&probe).is_err() {
        return Ok(());
    }
    let observed = std::fs::canonicalize(&probe);
    let _ = std::fs::remove_dir(&probe);
    match observed.ok().and_then(|o| redirected_package(&probe, &o)) {
        Some(pkg) => Err(redirect_message(&pkg)),
        None => Ok(()),
    }
}

/// True when one folder is the other or contains it (case-insensitive, as on Windows).
pub fn overlaps(a: &Path, b: &Path) -> bool {
    let parts = |p: &Path| -> Vec<String> {
        resolved(p)
            .components()
            .filter(|c| !matches!(c, std::path::Component::CurDir))
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    a.starts_with(&b) || b.starts_with(&a)
}

#[derive(Clone)]
pub struct Home {
    pub root: PathBuf,
}

impl Home {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        check_home(&root)?;
        check_not_redirected(&root)?;
        std::fs::create_dir_all(&root).map_err(|_| "Could not create the studio folder")?;
        for d in ["logs", "secrets", "backups"] {
            std::fs::create_dir_all(root.join(d)).map_err(|_| "Could not create studio folders")?;
        }
        Ok(Self { root })
    }
    pub fn config_path(&self) -> PathBuf {
        self.root.join("studio.json")
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
    pub fn secrets(&self) -> PathBuf {
        self.root.join("secrets")
    }
    pub fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }
    pub fn products(&self) -> PathBuf {
        self.root.join("products")
    }
    pub fn pg_data(&self) -> PathBuf {
        self.root.join("postgres").join("data")
    }
    /// Short stable key for per-home kernel object names.
    pub fn key(&self) -> String {
        use sha2::{Digest, Sha256};
        let lower = self.root.to_string_lossy().to_lowercase();
        format!("{:x}", Sha256::digest(lower.as_bytes()))[..16].to_string()
    }
    pub fn load(&self) -> Result<Option<StudioConfig>, String> {
        let raw = match std::fs::read(self.config_path()) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not read studio.json".into()),
        };
        let config: StudioConfig =
            serde_json::from_slice(&raw).map_err(|e| format!("studio.json is invalid: {e}"))?;
        config.validate()?;
        Ok(Some(config))
    }
    pub fn save(&self, config: &StudioConfig) -> Result<(), String> {
        config.validate()?;
        let tmp = self.root.join("studio.json.tmp");
        let bytes = serde_json::to_vec_pretty(config).map_err(|_| "Could not encode settings")?;
        std::fs::write(&tmp, bytes).map_err(|_| "Could not write studio.json")?;
        std::fs::rename(&tmp, self.config_path()).map_err(|_| "Could not save studio.json".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(root: &Path) -> StudioConfig {
        StudioConfig {
            format: CONFIG_FORMAT.into(),
            database: DatabaseConfig {
                mode: "managed".into(),
                port: 55440,
                name: "creator_studio".into(),
                user: "creator".into(),
                label: "managed".into(),
            },
            pg_bin: None,
            products_root: root.join("products").display().to_string(),
            close_behavior: "quit".into(),
            launch_at_login: false,
            origin: serde_json::json!({"kind":"new"}),
            created_at: "2026-10-20T00:00:00Z".into(),
            source_hosts: Vec::new(),
        }
    }
    #[test]
    fn refuses_onedrive_relative_and_bad_settings() {
        assert!(check_home(Path::new("relative/home")).is_err());
        assert!(check_home(Path::new("C:\\Users\\x\\OneDrive\\studio")).is_err());
        assert!(check_home(Path::new("C:\\Users\\x\\OneDrive - Personal\\studio")).is_err());
        assert!(check_home(Path::new("C:\\Users\\x\\AppData\\Local\\studio")).is_ok());
        let root = std::env::temp_dir();
        let mut c = sample(&root);
        assert!(c.validate().is_ok());
        c.close_behavior = "tray".into();
        assert!(c.validate().is_err());
        let mut c = sample(&root);
        c.database.name = "Robert'); drop".into();
        assert!(c.validate().is_err());
        let mut c = sample(&root);
        c.products_root = "products".into();
        assert!(c.validate().is_err());
        let mut c = sample(&root);
        c.source_hosts = vec!["www.speedrun.com".into(), "tasvideos.org".into()];
        assert!(c.validate().is_ok());
        for bad in [
            "https://www.speedrun.com",
            "speedrun.com:443",
            "speedrun.com/forum",
            "Speedrun.com",
            "localhost",
            "127.0.0.1",
            "-bad.com",
            "",
        ] {
            c.source_hosts = vec![bad.into()];
            assert!(c.validate().is_err(), "{bad} should be refused");
        }
        c.source_hosts = (0..=MAX_SOURCE_HOSTS)
            .map(|i| format!("h{i}.example.com"))
            .collect();
        assert!(c.validate().is_err());
    }
    #[test]
    fn source_hosts_are_omitted_when_empty_so_older_apps_can_read_the_file() {
        let root = std::env::temp_dir();
        let c = sample(&root);
        assert!(!serde_json::to_string(&c).unwrap().contains("source_hosts"));
        let old = serde_json::to_string(&c).unwrap();
        let back: StudioConfig = serde_json::from_str(&old).unwrap();
        assert!(back.source_hosts.is_empty());
    }
    #[test]
    fn saves_atomically_and_rejects_unknown_fields() {
        let root = std::env::temp_dir().join(format!(
            "creator-home-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        let home = Home::new(root.clone()).unwrap();
        assert_eq!(home.load().unwrap(), None);
        let c = sample(&root);
        home.save(&c).unwrap();
        assert_eq!(home.load().unwrap(), Some(c));
        let mut v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(home.config_path()).unwrap()).unwrap();
        v["surprise"] = serde_json::json!(true);
        std::fs::write(home.config_path(), v.to_string()).unwrap();
        assert!(home.load().is_err());
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn names_the_package_only_when_a_new_folder_lands_in_its_cache() {
        let requested = Path::new(r"C:\Users\j\AppData\Local\com.creatoragent.studio\p");
        let redirected = Path::new(
            r"\\?\C:\Users\j\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\com.creatoragent.studio\p",
        );
        assert_eq!(
            redirected_package(requested, redirected).as_deref(),
            Some("Claude_pzs8sxrjxfjjc")
        );
        // Verbatim prefix, forward slashes and case differences alone are not a redirect.
        for same in [
            r"\\?\C:\Users\j\AppData\Local\com.creatoragent.studio\p",
            "c:/users/j/appdata/local/com.creatoragent.studio/p",
            r"C:\Users\j\AppData\Local\Packages\NotACache\p",
        ] {
            assert_eq!(
                redirected_package(requested, Path::new(same)),
                None,
                "{same}"
            );
        }
        // An owner who deliberately keeps the studio in a package folder is not refused.
        assert_eq!(redirected_package(redirected, redirected), None);
        let m = redirect_message("Claude_pzs8sxrjxfjjc");
        assert!(m.contains("Claude_pzs8sxrjxfjjc") && m.contains("Start menu"));
        assert!(m.contains("Noncanonical path refused"));
    }
    #[test]
    fn probe_passes_on_an_ordinary_folder_and_leaves_nothing_behind() {
        let base = std::env::temp_dir().join(format!(
            "creator-redirect-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(&base).unwrap();
        // Home not created yet: the probe goes in the deepest existing folder.
        assert!(check_not_redirected(&base.join("new").join("home")).is_ok());
        assert!(check_not_redirected(&base).is_ok());
        assert_eq!(std::fs::read_dir(&base).unwrap().count(), 0);
        assert!(!base.join("new").exists());
        let _ = std::fs::remove_dir_all(base);
    }
    /// Stands in for the MSIX redirect with a symlink: the probe is made under a folder that
    /// really resolves into a package's LocalCache, so the whole check runs end to end.
    #[cfg(unix)]
    #[test]
    fn probe_refuses_a_folder_that_resolves_into_a_package_cache() {
        let base = std::env::temp_dir().join(format!(
            "creator-redirect-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        let cache = base
            .join("Packages")
            .join("Claude_pzs8sxrjxfjjc")
            .join("LocalCache")
            .join("Local");
        std::fs::create_dir_all(&cache).unwrap();
        let local = base.join("Local");
        std::os::unix::fs::symlink(&cache, &local).unwrap();
        let err = check_not_redirected(&local.join("com.creatoragent.studio")).unwrap_err();
        assert!(err.contains("Claude_pzs8sxrjxfjjc"), "{err}");
        assert!(Home::new(local.join("com.creatoragent.studio")).is_err());
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(base);
    }
    #[test]
    fn overlap_sees_through_spelling_and_nesting() {
        let base = std::env::temp_dir().join(format!(
            "creator-overlap-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        let installed = base.join("com.creatoragent.studio");
        std::fs::create_dir_all(&installed).unwrap();
        let s = installed.to_string_lossy().to_string();
        for same in [
            format!("{s}\\"),
            s.replace('\\', "/"),
            s.to_uppercase(),
            format!("{s}\\.\\"),
        ] {
            assert!(overlaps(Path::new(&same), &installed), "{same}");
        }
        assert!(overlaps(
            &installed.join("nested").join("deeper"),
            &installed
        ));
        assert!(overlaps(&base, &installed));
        assert!(!overlaps(
            &base.join("com.creatoragent.studio-probe"),
            &installed
        ));
        assert!(!overlaps(&base.join("other"), &installed));
        let _ = std::fs::remove_dir_all(base);
    }
}
