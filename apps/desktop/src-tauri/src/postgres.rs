//! App-managed PostgreSQL (ADR-0041): a cluster in the studio home, run with the owner's
//! verified PostgreSQL 18 binaries on loopback, started with the app and stopped only by
//! it. External servers never pass through here. An installer built with
//! `build-studio.mjs --postgres <folder>` includes PostgreSQL 18 under its `studio\postgres`
//! resources, so a new computer needs no separate install; setup copies it into the studio home.
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

pub const MAJOR: &str = "18";
pub const DEFAULT_PORT: u16 = 55440;
pub const CANDIDATES: [&str; 2] = [
    "C:\\pgsql18\\pgsql\\bin",
    "C:\\Program Files\\PostgreSQL\\18\\bin",
];

pub fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Checks that a folder holds the PostgreSQL 18 server and tools; returns the version.
pub fn verify_bin(dir: &Path) -> Result<String, String> {
    for tool in [
        "postgres.exe",
        "initdb.exe",
        "pg_ctl.exe",
        "pg_dump.exe",
        "pg_restore.exe",
    ] {
        if !dir.join(tool).is_file() {
            return Err(format!("{tool} is missing from {}", dir.display()));
        }
    }
    let out = quiet(Command::new(dir.join("postgres.exe")).arg("--version"))
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Could not run postgres.exe".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let version = text
        .strip_prefix("postgres (PostgreSQL) ")
        .ok_or("postgres.exe did not report a PostgreSQL version")?;
    if version.split('.').next() != Some(MAJOR) {
        return Err(format!("PostgreSQL {MAJOR} is required; found {version}"));
    }
    Ok(version.to_string())
}

/// Where an installer that includes PostgreSQL keeps its `bin` folder.
pub fn bundled_bin(resources: &Path) -> PathBuf {
    resources.join("postgres").join("bin")
}

/// Copies the included PostgreSQL into `<home>\runtime\postgresql-<version>` and returns its
/// `bin` folder. The database never runs from the install folder, which an update replaces
/// and a rollback renames, and the copy survives an uninstall together with the data it
/// serves. A verified copy of the same version is reused; a new one is written to a
/// temporary folder first and renamed into place, so a half-finished copy is never used.
pub fn install_bundled(resources: &Path, home_root: &Path) -> Result<PathBuf, String> {
    let src = resources.join("postgres");
    let version = verify_bin(&src.join("bin"))?;
    let runtime = home_root.join("runtime");
    let dest = runtime.join(format!("postgresql-{version}"));
    // Reused only when the version matches and no file is missing (review N3).
    if verify_bin(&dest.join("bin")).ok().as_deref() == Some(version.as_str())
        && count_files(&dest) == count_files(&src)
    {
        return Ok(dest.join("bin"));
    }
    std::fs::create_dir_all(&runtime).map_err(|_| "Could not create the studio runtime folder")?;
    // A copy interrupted by a closed or crashed app left its temporary folder (review L2).
    // Setup holds the app's single-instance and busy locks, so none is in use now.
    for entry in std::fs::read_dir(&runtime).into_iter().flatten().flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(".postgresql-")
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
    let tmp = runtime.join(format!(
        ".postgresql-{version}-{}",
        crate::studio::random_hex(4)?
    ));
    let copied = copy_tree(&src, &tmp);
    if let Err(e) = copied {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("Could not copy the included PostgreSQL: {e}"));
    }
    if dest.exists() {
        // Only this function writes here; a folder that does not verify is an earlier,
        // unusable copy (for example one whose files were removed by hand).
        std::fs::remove_dir_all(&dest)
            .map_err(|_| format!("Could not replace {}", dest.display()))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|_| {
        let _ = std::fs::remove_dir_all(&tmp);
        "Could not move the included PostgreSQL into place".to_string()
    })?;
    verify_bin(&dest.join("bin"))?;
    Ok(dest.join("bin"))
}

/// Whether a folder typed or kept in setup is the installer's included `bin` folder. Compared
/// without letter case and a trailing separator, as Windows paths are (review N2).
pub fn is_bundled(path: &str, resources: &Path) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    norm(path) == norm(&bundled_bin(resources).display().to_string())
}

fn count_files(dir: &Path) -> Option<usize> {
    let mut n = 0;
    for entry in std::fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        n += if entry.file_type().ok()?.is_dir() {
            count_files(&entry.path())?
        } else {
            1
        };
    }
    Some(n)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Lists PostgreSQL 18 folders for setup: the saved one, then the copy included with this
/// installer (`bundled`, listed first on a new computer), then the usual install folders.
pub fn detect(configured: Option<&str>, bundled: Option<&Path>) -> Vec<serde_json::Value> {
    let mut found = Vec::new();
    // Listed when this installer includes PostgreSQL (its folder exists), also when it fails
    // its check, so setup can say why (review L1).
    if let Some(b) =
        bundled.filter(|b| configured.is_none() && b.parent().is_some_and(|p| p.is_dir()))
    {
        let path = b.display().to_string();
        found.push(match verify_bin(b) {
            Ok(v) => serde_json::json!({"path": path, "version": v, "ok": true, "bundled": true}),
            Err(e) => serde_json::json!({"path": path, "error": e, "ok": false, "bundled": true}),
        });
    }
    let mut dirs: Vec<String> = configured.map(|s| vec![s.to_string()]).unwrap_or_default();
    for c in CANDIDATES {
        if !dirs.iter().any(|d| d.eq_ignore_ascii_case(c)) {
            dirs.push(c.to_string());
        }
    }
    found.extend(dirs.into_iter().map(|d| match verify_bin(Path::new(&d)) {
        Ok(v) => serde_json::json!({"path": d, "version": v, "ok": true}),
        Err(e) => serde_json::json!({"path": d, "error": e, "ok": false}),
    }));
    found
}

pub fn port_in_use(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

pub fn choose_port() -> Result<u16, String> {
    (DEFAULT_PORT..DEFAULT_PORT + 40)
        .find(|p| !port_in_use(*p))
        .ok_or("No free loopback port for the studio database".into())
}

#[derive(Clone)]
pub struct Cluster {
    pub bin: PathBuf,
    pub data: PathBuf,
    pub port: u16,
    pub log: PathBuf,
}

impl Cluster {
    fn pg_ctl(&self) -> Command {
        let mut c = Command::new(self.bin.join("pg_ctl.exe"));
        quiet(&mut c);
        // F4 live trial part 2: the wrapper pg_ctl leaves running beside the server keeps this
        // working folder; never the app's install folder, which a rollback renames.
        if let Some(parent) = self.data.parent().filter(|p| p.is_dir()) {
            c.current_dir(parent);
        }
        // pg_ctl's server inherits handles; null stdio keeps it from holding our pipes.
        c.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        c
    }
    pub fn exists(&self) -> bool {
        self.data.join("PG_VERSION").is_file()
    }
    /// Creates the cluster: scram-sha-256 only, one owner role with a generated password.
    pub fn init(&self, user: &str, password: &str) -> Result<(), String> {
        if self.exists() {
            return Err("The studio database folder already holds a cluster".into());
        }
        if self.data.exists()
            && std::fs::read_dir(&self.data)
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err("The studio database folder is not empty".into());
        }
        let parent = self.data.parent().ok_or("Bad database folder")?;
        std::fs::create_dir_all(parent).map_err(|_| "Could not create the database folder")?;
        let pwfile = parent.join(format!("init-{}.pw", crate::studio::random_hex(8).unwrap()));
        std::fs::write(&pwfile, password).map_err(|_| "Could not prepare database setup")?;
        let out = quiet(Command::new(self.bin.join("initdb.exe")).args([
            "-D",
            &self.data.display().to_string(),
            "-U",
            user,
            "--auth=scram-sha-256",
            &format!("--pwfile={}", pwfile.display()),
            "--encoding=UTF8",
            "--no-locale",
        ]))
        .stdin(Stdio::null())
        .output();
        let _ = std::fs::remove_file(&pwfile);
        let out = out.map_err(|_| "Could not run initdb".to_string())?;
        std::fs::write(
            self.log.with_file_name("postgres-init.log"),
            [&out.stdout[..], &out.stderr[..]].concat(),
        )
        .ok();
        if !out.status.success() {
            return Err("Creating the studio database failed; see logs/postgres-init.log".into());
        }
        Ok(())
    }
    pub fn running(&self) -> bool {
        self.pg_ctl()
            .args(["status", "-D", &self.data.display().to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    /// Starts the app's own cluster. A cluster already running from this folder is ours
    /// (for example after a supervisor crash) and is reused; a foreign listener is refused.
    pub fn start(&self) -> Result<bool, String> {
        if self.running() {
            return Ok(false);
        }
        if port_in_use(self.port) {
            return Err(format!(
                "Port {} is used by another program, so the studio database cannot start. Close that program or choose another port.",
                self.port
            ));
        }
        let ok = self
            .pg_ctl()
            .args([
                "start",
                "-D",
                &self.data.display().to_string(),
                "-l",
                &self.log.display().to_string(),
                "-o",
                &format!("-p {} -c listen_addresses=127.0.0.1", self.port),
                "-w",
                "-t",
                "60",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            return Err("The studio database did not start; see logs/postgres.log".into());
        }
        Ok(true)
    }
    pub fn stop(&self) -> Result<(), String> {
        if !self.running() {
            return Ok(());
        }
        let ok = self
            .pg_ctl()
            .args([
                "stop",
                "-D",
                &self.data.display().to_string(),
                "-m",
                "fast",
                "-w",
                "-t",
                "60",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            Ok(())
        } else {
            Err("The studio database did not stop cleanly".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_folders_without_postgres_18() {
        let dir = std::env::temp_dir().join(format!(
            "creator-pg-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(verify_bin(&dir)
            .unwrap_err()
            .contains("postgres.exe is missing"));
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn included_runtime_is_listed_with_its_check_and_nothing_is_saved() {
        let dir = std::env::temp_dir().join(format!(
            "creator-pg-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // An installer without PostgreSQL has no `postgres` folder: nothing is listed for it.
        let bin = dir.join("postgres").join("bin");
        let listed = detect(None, Some(&bin));
        assert!(listed.iter().all(|c| c["bundled"].is_null()));
        // An included copy that fails its check is listed with the reason, not hidden.
        std::fs::create_dir_all(&bin).unwrap();
        let listed = detect(None, Some(&bin));
        assert_eq!(listed[0]["bundled"], true);
        assert_eq!(listed[0]["ok"], false);
        assert!(listed[0]["error"]
            .as_str()
            .unwrap()
            .contains("postgres.exe is missing"));
        // A saved folder wins: setup is already done, the included copy is not offered.
        let listed = detect(Some("C:\\saved\\bin"), Some(&bin));
        assert_eq!(listed[0]["path"], "C:\\saved\\bin");
        assert!(install_bundled(&dir, &dir)
            .unwrap_err()
            .contains("postgres.exe is missing"));
        assert!(!dir.join("runtime").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn matches_the_included_folder_without_case_or_trailing_separator() {
        let res = Path::new("C:\\Users\\t\\AppData\\Local\\Creator Agent\\studio");
        let bin = bundled_bin(res).display().to_string();
        assert!(is_bundled(&bin, res));
        assert!(is_bundled(&format!("{}\\", bin.to_uppercase()), res));
        assert!(is_bundled(&format!(" {bin}/ "), res));
        assert!(!is_bundled("C:\\pgsql18\\pgsql\\bin", res));
    }
    #[test]
    fn counts_files_so_an_incomplete_copy_is_not_reused() {
        let dir = std::env::temp_dir().join(format!(
            "creator-pg-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(dir.join("a/share")).unwrap();
        std::fs::write(dir.join("a/share/x"), b"x").unwrap();
        std::fs::write(dir.join("a/y"), b"y").unwrap();
        copy_tree(&dir.join("a"), &dir.join("b")).unwrap();
        assert_eq!(count_files(&dir.join("a")), Some(2));
        assert_eq!(count_files(&dir.join("a")), count_files(&dir.join("b")));
        std::fs::remove_file(dir.join("b/share/x")).unwrap();
        assert_ne!(count_files(&dir.join("a")), count_files(&dir.join("b")));
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn copies_a_tree_with_nested_folders() {
        let dir = std::env::temp_dir().join(format!(
            "creator-pg-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(dir.join("src/share/timezone")).unwrap();
        std::fs::write(dir.join("src/share/timezone/UTC"), b"tz").unwrap();
        std::fs::write(dir.join("src/top.txt"), b"x").unwrap();
        copy_tree(&dir.join("src"), &dir.join("dst")).unwrap();
        assert_eq!(
            std::fs::read(dir.join("dst/share/timezone/UTC")).unwrap(),
            b"tz"
        );
        assert_eq!(std::fs::read(dir.join("dst/top.txt")).unwrap(), b"x");
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn detects_the_listening_port() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(port_in_use(l.local_addr().unwrap().port()));
    }
}
