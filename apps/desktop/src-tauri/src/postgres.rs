//! App-managed PostgreSQL (ADR-0041): a cluster in the studio home, run with the owner's
//! verified PostgreSQL 18 binaries on loopback, started with the app and stopped only by
//! it. External servers never pass through here.
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

pub fn detect(configured: Option<&str>) -> Vec<serde_json::Value> {
    let mut dirs: Vec<String> = configured.map(|s| vec![s.to_string()]).unwrap_or_default();
    for c in CANDIDATES {
        if !dirs.iter().any(|d| d.eq_ignore_ascii_case(c)) {
            dirs.push(c.to_string());
        }
    }
    dirs.into_iter()
        .map(|d| match verify_bin(Path::new(&d)) {
            Ok(v) => serde_json::json!({"path": d, "version": v, "ok": true}),
            Err(e) => serde_json::json!({"path": d, "error": e, "ok": false}),
        })
        .collect()
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
    fn detects_the_listening_port() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(port_in_use(l.local_addr().unwrap().port()));
    }
}
