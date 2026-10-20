//! Installed-studio supervisor (ADR-0041). Owns one Node service child and, in managed mode,
//! the app's PostgreSQL cluster. Verifies listener ownership before showing the studio,
//! restarts within bounds, persists sign-in with DPAPI and stops only what it started.
use crate::home::{DatabaseConfig, Home, StudioConfig, CONFIG_FORMAT};
use crate::postgres::{self, Cluster};
use crate::secret::Secrets;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub const PROTOCOL: &str = "creator-studio/1";
pub const PORTS: [u16; 3] = [5173, 4310, 4320];
const API: &str = "http://127.0.0.1:4310";
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(600);
const BACKOFF: [u64; 3] = [1, 4, 15];
const DB_NAME: &str = "creator_studio";
const DB_USER: &str = "creator";

pub fn random_hex(n: usize) -> Result<String, String> {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).map_err(|_| "Secure randomness unavailable")?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}
/// 43 URL-safe characters (258 bits); 64 divides 256, so the mapping is unbiased.
pub fn random_code() -> Result<String, String> {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut b = [0u8; 43];
    getrandom::fill(&mut b).map_err(|_| "Secure randomness unavailable")?;
    Ok(b.iter().map(|x| A[(*x as usize) % 64] as char).collect())
}
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.iter().map(|b| b ^ 0x36).collect::<Vec<_>>());
    inner.update(msg);
    let mut outer = Sha256::new();
    outer.update(k.iter().map(|b| b ^ 0x5c).collect::<Vec<_>>());
    outer.update(inner.finalize());
    outer.finalize().into()
}
fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}
/// The listener's expected answer to a nonce challenge on one port.
pub fn ownership_mac(secret_hex: &str, port: u16, nonce: &str) -> Option<String> {
    let key = unhex(secret_hex)?;
    let mac = hmac_sha256(&key, format!("{PROTOCOL}:{port}:{nonce}").as_bytes());
    Some(mac.iter().map(|b| format!("{b:02x}")).collect())
}
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn client(timeout: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not create a local HTTP client".into())
}
fn bounded_json(mut r: reqwest::blocking::Response) -> Result<Value, String> {
    let mut bytes = Vec::new();
    (&mut r)
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read a local response")?;
    if bytes.len() > 65536 {
        return Err("Local response exceeded limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid local response".into())
}

/// Asks each studio port to prove it holds this launch's secret. An unrelated listener
/// (another app, a development server) cannot answer and is never trusted.
pub fn verify_ownership(secret: &str) -> Result<(), String> {
    let c = client(5)?;
    for port in PORTS {
        let nonce = random_hex(32)?;
        let r = c
            .get(format!("http://127.0.0.1:{port}/__creator/ownership"))
            .header("x-creator-nonce", &nonce)
            .send()
            .map_err(|_| format!("Port {port} did not answer the ownership check"))?;
        if !r.status().is_success() {
            return Err(format!("Port {port} failed the ownership check"));
        }
        let v = bounded_json(r)?;
        let expected = ownership_mac(secret, port, &nonce).ok_or("Bad launch secret")?;
        if v["protocol"] != PROTOCOL || !same(v["mac"].as_str().unwrap_or(""), &expected) {
            return Err(format!(
                "Port {port} is held by a program that is not this studio"
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct Status {
    pub phase: &'static str,
    pub title: String,
    pub detail: String,
    pub action: Option<&'static str>,
    pub migration: Option<(i64, i64)>,
}
impl Status {
    fn new(phase: &'static str, title: &str, detail: &str) -> Self {
        Self {
            phase,
            title: title.into(),
            detail: detail.into(),
            action: None,
            migration: None,
        }
    }
}

struct Inner {
    status: Status,
    busy: bool,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    generation: u64,
    restarts: Vec<Instant>,
    quitting: bool,
    owner_secret: String,
    login_code: String,
    cluster: Option<Cluster>,
    signed_in: bool,
    log: VecDeque<String>,
    background_notice: bool,
    quiet_start: bool,
}

pub struct Supervisor {
    pub app: AppHandle,
    pub home: Home,
    pub secrets: Secrets,
    pub resources: PathBuf,
    #[cfg(windows)]
    job: Option<crate::winsys::Owned>,
    inner: Mutex<Inner>,
}

pub type Shared = Arc<Supervisor>;

impl Supervisor {
    pub fn new(app: AppHandle, home: Home, resources: PathBuf) -> Shared {
        let secrets = Secrets::new(&home.secrets());
        Arc::new(Self {
            app,
            secrets,
            resources,
            #[cfg(windows)]
            job: crate::winsys::kill_on_close_job().ok(),
            inner: Mutex::new(Inner {
                status: Status::new("starting", "Starting Creator Agent", "Reading settings"),
                busy: false,
                child: None,
                stdin: None,
                generation: 0,
                restarts: Vec::new(),
                quitting: false,
                owner_secret: String::new(),
                login_code: String::new(),
                cluster: None,
                signed_in: false,
                log: VecDeque::new(),
                background_notice: false,
                quiet_start: std::env::args().any(|a| a == "--at-login"),
            }),
            home,
        })
    }

    pub fn note(&self, line: &str) {
        let stamped = format!("{} {line}", chrono_now());
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.home.logs().join("supervisor.log"))
        {
            let _ = writeln!(f, "{stamped}");
        }
        let mut i = self.inner.lock().unwrap();
        i.log.push_back(stamped);
        while i.log.len() > 40 {
            i.log.pop_front();
        }
    }
    fn set(&self, s: Status) {
        self.note(&format!("[{}] {} — {}", s.phase, s.title, s.detail));
        let needs_owner = matches!(s.phase, "setup" | "failed" | "needs_migration");
        self.inner.lock().unwrap().status = s;
        if needs_owner {
            crate::show_control(&self.app);
        }
    }
    pub fn quitting(&self) -> bool {
        self.inner.lock().unwrap().quitting
    }
    pub fn running(&self) -> bool {
        self.inner.lock().unwrap().status.phase == "running"
    }
    pub fn close_behavior(&self) -> String {
        self.home
            .load()
            .ok()
            .flatten()
            .map(|c| c.close_behavior)
            .unwrap_or_else(|| "quit".into())
    }
    /// True the first time per launch, so the background notice is shown once.
    pub fn take_background_notice(&self) -> bool {
        let mut i = self.inner.lock().unwrap();
        !std::mem::replace(&mut i.background_notice, true)
    }

    pub fn state(&self) -> Value {
        let config = self.home.load();
        let i = self.inner.lock().unwrap();
        let bundle = std::fs::read(self.resources.join("bundle-manifest.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .map(|m| json!({"source_commit": m["source_commit"], "source_dirty": m["source_dirty"], "node_version": m["node_version"], "built_at": m["built_at"]}));
        json!({
            "phase": i.status.phase,
            "title": i.status.title,
            "detail": i.status.detail,
            "action": i.status.action,
            "migration": i.status.migration.map(|(a, b)| json!({"current": a, "expected": b})),
            "busy": i.busy,
            "signed_in": i.signed_in,
            "home": self.home.root.display().to_string(),
            "config": match &config {
                Ok(Some(c)) => json!({
                    "database": c.database, "pg_bin": c.pg_bin, "products_root": c.products_root,
                    "close_behavior": c.close_behavior, "launch_at_login": c.launch_at_login,
                    "origin": c.origin,
                }),
                Ok(None) => Value::Null,
                Err(e) => json!({"error": e}),
            },
            "bundle": bundle,
            "log": i.log.iter().rev().take(12).collect::<Vec<_>>(),
        })
    }

    fn node(&self) -> (PathBuf, PathBuf) {
        (
            self.resources.join("node").join("node.exe"),
            self.resources
                .join("service")
                .join("app")
                .join("dist")
                .join("studio.mjs"),
        )
    }

    fn service_log(&self) -> Result<std::fs::File, String> {
        let path = self.home.logs().join("service.log");
        if std::fs::metadata(&path)
            .map(|m| m.len() > 10 * 1024 * 1024)
            .unwrap_or(false)
        {
            let _ = std::fs::rename(&path, self.home.logs().join("service.1.log"));
        }
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|_| "Could not open the service log".into())
    }

    /// Starts the Node child with a minimal environment: no inherited CREATOR_*, OPENAI_* or
    /// proxy settings, so a developer shell can never redirect the installed studio.
    fn spawn(
        &self,
        mode: &str,
        input: &Value,
    ) -> Result<(Child, ChildStdin, std::process::ChildStdout), String> {
        let (node, entry) = self.node();
        if !node.is_file() || !entry.is_file() {
            return Err(
                "The app's studio service files are missing; reinstall Creator Agent.".into(),
            );
        }
        let mut cmd = Command::new(&node);
        postgres::quiet(&mut cmd);
        cmd.arg(&entry)
            .arg(mode)
            .current_dir(&self.home.root)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(self.service_log()?));
        for k in [
            "SystemRoot",
            "SystemDrive",
            "windir",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "USERNAME",
            "LOCALAPPDATA",
            "APPDATA",
            "COMPUTERNAME",
            "NUMBER_OF_PROCESSORS",
            "PROCESSOR_ARCHITECTURE",
        ] {
            if let Ok(v) = std::env::var(k) {
                cmd.env(k, v);
            }
        }
        // WSL (generated-code isolation) and the PostgreSQL tools are found by explicit paths.
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        cmd.env("PATH", format!("{system}\\System32;{system}"));
        cmd.env("NODE_ENV", "production");
        let mut child = cmd
            .spawn()
            .map_err(|_| "Could not start the studio service".to_string())?;
        #[cfg(windows)]
        if let Some(job) = &self.job {
            crate::winsys::assign(job, &child)?;
        }
        let mut stdin = child.stdin.take().ok_or("No service input")?;
        let stdout = child.stdout.take().ok_or("No service output")?;
        writeln!(stdin, "{input}").map_err(|_| "Could not configure the studio service")?;
        stdin.flush().ok();
        Ok((child, stdin, stdout))
    }

    /// Runs a one-shot service command (inspect, init, adopt, migrate) to its result.
    fn command(&self, mode: &str, input: &Value) -> Result<Value, String> {
        self.note(&format!("running service command {mode}"));
        let (mut child, stdin, stdout) = self.spawn(mode, input)?;
        let mut outcome: Result<Value, String> =
            Err("The studio service ended without a result".into());
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match event["event"].as_str() {
                Some("result") => outcome = Ok(event["result"].clone()),
                Some("error") => {
                    outcome = Err(event["message"]
                        .as_str()
                        .unwrap_or("Studio command failed")
                        .to_string())
                }
                _ => {}
            }
        }
        drop(stdin);
        let _ = child.wait();
        match &outcome {
            Ok(_) => self.note(&format!("service command {mode} finished")),
            Err(e) => self.note(&format!("service command {mode} failed: {e}")),
        }
        outcome
    }

    fn cluster_for(&self, c: &StudioConfig) -> Result<Cluster, String> {
        let bin = c
            .pg_bin
            .clone()
            .ok_or("Choose the PostgreSQL 18 folder in settings")?;
        Ok(Cluster {
            bin: PathBuf::from(bin),
            data: self.home.pg_data(),
            port: c.database.port,
            log: self.home.logs().join("postgres.log"),
        })
    }

    /// Database URL for the configured studio; starts the managed cluster when needed.
    fn database_url(&self, c: &StudioConfig) -> Result<String, String> {
        if c.database.mode == "managed" {
            let cluster = self.cluster_for(c)?;
            postgres::verify_bin(&cluster.bin)?;
            if !cluster.exists() {
                return Err("The studio database folder is missing. Restore it from a backup or run setup again.".into());
            }
            let started = cluster.start()?;
            self.note(if started {
                "started the app's PostgreSQL"
            } else {
                "reusing the app's running PostgreSQL"
            });
            let pw = self
                .secrets
                .load("postgres")?
                .ok_or("The studio database password is missing")?;
            self.inner.lock().unwrap().cluster = Some(cluster);
            Ok(format!(
                "postgresql://{}:{pw}@127.0.0.1:{}/{}",
                c.database.user, c.database.port, c.database.name
            ))
        } else {
            self.secrets
                .load("database-url")?
                .ok_or("The saved database connection is missing; run setup again".into())
        }
    }

    fn input(&self, c: &StudioConfig, url: &str, source: Value) -> Value {
        let i = self.inner.lock().unwrap();
        json!({
            "protocol": PROTOCOL,
            "database_url": url,
            "products_root": c.products_root,
            "backups_dir": self.home.backups().display().to_string(),
            "pg_bin": c.pg_bin,
            "web_root": self.resources.join("web").display().to_string(),
            "owner_secret": if i.owner_secret.is_empty() { Value::Null } else { json!(i.owner_secret) },
            "login_code": if i.login_code.is_empty() { Value::Null } else { json!(i.login_code) },
            "worker_distro": Value::Null,
            "source": source,
        })
    }

    /// (Re)starts the studio from saved settings. Safe to call from any thread.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || me.start_blocking());
    }

    fn start_blocking(self: &Arc<Self>) {
        if self.quitting() {
            return;
        }
        let quiet = std::mem::replace(&mut self.inner.lock().unwrap().quiet_start, false);
        if !quiet {
            crate::show_control(&self.app);
        }
        let config = match self.home.load() {
            Ok(Some(c)) => c,
            Ok(None) => {
                self.set(Status::new(
                    "setup",
                    "Set up Creator Agent",
                    "Choose how this computer's studio gets its records.",
                ));
                return;
            }
            Err(e) => {
                let mut s = Status::new("failed", "Settings could not be read", &e);
                s.action = Some("retry");
                self.set(s);
                return;
            }
        };
        self.set(Status::new(
            "starting",
            "Starting Creator Agent",
            &format!(
                "Connecting to the studio database ({})",
                config.database.label
            ),
        ));
        let url = match self.database_url(&config) {
            Ok(u) => u,
            Err(e) => {
                let mut s = Status::new("failed", "The studio database is not available", &e);
                s.action = Some("retry");
                self.set(s);
                return;
            }
        };
        let (secret, code) = match (random_hex(32), random_code()) {
            (Ok(a), Ok(b)) => (a, b),
            _ => return self.set(Status::new("failed", "Secure randomness unavailable", "")),
        };
        {
            let mut i = self.inner.lock().unwrap();
            i.owner_secret = secret;
            i.login_code = code;
            i.signed_in = false;
        }
        self.set(Status::new(
            "starting",
            "Starting Creator Agent",
            "Starting the studio service",
        ));
        let input = self.input(&config, &url, Value::Null);
        let (child, stdin, stdout) = match self.spawn("serve", &input) {
            Ok(x) => x,
            Err(e) => {
                let mut s = Status::new("failed", "The studio service could not start", &e);
                s.action = Some("retry");
                return self.set(s);
            }
        };
        let generation = {
            let mut i = self.inner.lock().unwrap();
            i.generation += 1;
            i.child = Some(child);
            i.stdin = Some(stdin);
            i.generation
        };
        let me = self.clone();
        let external = config.database.mode == "external";
        std::thread::spawn(move || me.follow(generation, stdout, external));
    }

    fn current(&self, generation: u64) -> bool {
        let i = self.inner.lock().unwrap();
        i.generation == generation && !i.quitting
    }

    fn follow(self: Arc<Self>, generation: u64, stdout: std::process::ChildStdout, external: bool) {
        let mut retry_db = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !self.current(generation) {
                continue;
            }
            match event["event"].as_str() {
                Some("ready") => {
                    let secret = self.inner.lock().unwrap().owner_secret.clone();
                    match verify_ownership(&secret) {
                        Ok(()) => {
                            self.set(Status::new("running", "Creator Agent is running", "The studio, its workflow worker and private previews are running on this computer."));
                            let me = self.clone();
                            std::thread::spawn(move || me.show_studio_signed_in());
                        }
                        Err(e) => {
                            self.note(&format!("ownership check failed: {e}"));
                            let mut s = Status::new(
                                "failed",
                                "Another program answered on the studio's ports",
                                &e,
                            );
                            s.action = Some("retry");
                            self.set(s);
                            self.stop_child(generation);
                        }
                    }
                }
                Some("needs_migration") => {
                    let mut s = Status::new(
                        "needs_migration",
                        "The studio database needs an upgrade",
                        "This version of Creator Agent uses a newer database layout. Upgrading first saves a backup of the current database.",
                    );
                    s.action = Some("migrate");
                    s.migration = Some((
                        event["current"].as_i64().unwrap_or(0),
                        event["expected"].as_i64().unwrap_or(0),
                    ));
                    self.set(s);
                }
                Some("error") => {
                    let code = event["code"].as_str().unwrap_or("STARTUP_FAILED");
                    let message = event["message"]
                        .as_str()
                        .unwrap_or("Startup failed")
                        .to_string();
                    let (title, hint) = match code {
                        "PORT_IN_USE" => (
                            "A studio port is in use",
                            format!("{message} Close the other Creator Agent or development studio (ports 5173, 4310 and 4320), then choose Retry."),
                        ),
                        "DATABASE_UNAVAILABLE" if external => {
                            retry_db = true;
                            ("The studio database is not reachable", format!("{message}. Start that PostgreSQL server (for the Docker development database: start Docker Desktop and the creator-agent-local database container). Retrying every 15 seconds."))
                        }
                        "DATABASE_UNAVAILABLE" => ("The studio database is not reachable", message),
                        "DATABASE_NEWER" => ("This app is older than the studio database", message),
                        _ => ("The studio service could not start", message),
                    };
                    let mut s = Status::new("failed", title, &hint);
                    s.action = Some("retry");
                    self.set(s);
                }
                _ => {}
            }
        }
        // Output closed: the child has exited (or is about to).
        let child = {
            let mut i = self.inner.lock().unwrap();
            if i.generation != generation {
                return;
            }
            i.stdin = None;
            i.child.take()
        };
        let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        self.note(&format!("studio service exited with code {code:?}"));
        if self.quitting() {
            return;
        }
        let phase = self.inner.lock().unwrap().status.phase;
        if retry_db && phase == "failed" {
            std::thread::sleep(Duration::from_secs(15));
            if self.current(generation) && self.inner.lock().unwrap().status.phase == "failed" {
                self.start_blocking();
            }
            return;
        }
        if phase == "running" || phase == "starting" {
            self.restart_after_crash();
        }
    }

    fn restart_after_crash(self: &Arc<Self>) {
        let attempt = {
            let mut i = self.inner.lock().unwrap();
            i.restarts.retain(|t| t.elapsed() < RESTART_WINDOW);
            if i.restarts.len() >= MAX_RESTARTS {
                None
            } else {
                i.restarts.push(Instant::now());
                Some(i.restarts.len())
            }
        };
        crate::hide_studio(&self.app);
        match attempt {
            None => {
                let mut s = Status::new(
                    "failed",
                    "The studio service keeps stopping",
                    "It stopped unexpectedly three times in ten minutes, so automatic restarts are paused. Your records are saved. Open the logs, then choose Retry.",
                );
                s.action = Some("retry");
                self.set(s);
            }
            Some(n) => {
                self.set(Status::new(
                    "starting",
                    "Restarting the studio service",
                    &format!("It stopped unexpectedly. Restart {n} of {MAX_RESTARTS}; durable work resumes and uncertain outcomes stay for review."),
                ));
                std::thread::sleep(Duration::from_secs(BACKOFF[n - 1]));
                self.start_blocking();
            }
        }
    }

    /// Ends the current service child: asks first, then terminates only that process.
    fn stop_child(&self, generation: u64) {
        let (child, stdin) = {
            let mut i = self.inner.lock().unwrap();
            if i.generation != generation {
                return;
            }
            i.generation += 1; // its output thread now ignores everything
            (i.child.take(), i.stdin.take())
        };
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(b"{\"cmd\":\"shutdown\"}\n");
            let _ = stdin.flush();
        }
        if let Some(mut child) = child {
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            self.note("studio service did not stop within 20 s; terminating it");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Health watchdog: three failed checks in a row (for example after sleep) restart the
    /// service within the same restart bounds.
    pub fn watchdog(self: &Arc<Self>) {
        let me = self.clone();
        std::thread::spawn(move || {
            let mut failures = 0;
            loop {
                std::thread::sleep(Duration::from_secs(15));
                if me.quitting() {
                    return;
                }
                let generation = {
                    let i = me.inner.lock().unwrap();
                    if i.status.phase != "running" {
                        failures = 0;
                        continue;
                    }
                    i.generation
                };
                let ok = client(5)
                    .ok()
                    .and_then(|c| c.get(format!("{API}/api/health")).send().ok())
                    .is_some_and(|r| r.status().is_success());
                failures = if ok { 0 } else { failures + 1 };
                if failures >= 3 {
                    failures = 0;
                    me.note("health checks failed three times; restarting the studio service");
                    let child = me.inner.lock().unwrap().child.take();
                    if let Some(mut c) = child {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    let _ = generation;
                }
            }
        });
    }

    fn session_cookie(token: &str) -> tauri::webview::cookie::Cookie<'static> {
        // A session cookie (no expiry): the WebView keeps it only while open. The persistent
        // copy is the DPAPI file, which each launch revalidates with the server.
        tauri::webview::cookie::Cookie::build(("creator_session".to_string(), token.to_string()))
            .domain("127.0.0.1")
            .path("/")
            .http_only(true)
            .same_site(tauri::webview::cookie::SameSite::Strict)
            .build()
    }

    fn stored_token(&self) -> Option<String> {
        let raw = self.secrets.load("session").ok().flatten()?;
        let v: Value = serde_json::from_str(&raw).ok()?;
        v["token"].as_str().map(str::to_string)
    }

    /// Checks a stored sign-in with the server; deletes it when expired or revoked.
    fn validate_session(&self) -> Option<(String, String)> {
        let token = self.stored_token()?;
        let r = client(5)
            .ok()?
            .get(format!("{API}/api/auth/session"))
            .header("Cookie", format!("creator_session={token}"))
            .send()
            .ok()?;
        if r.status().as_u16() == 401 {
            self.note("stored sign-in expired or was revoked; removed it");
            let _ = self.secrets.delete("session");
            return None;
        }
        let v = bounded_json(r).ok()?;
        Some((token, v["csrf_token"].as_str()?.to_string()))
    }

    fn show_studio_signed_in(self: &Arc<Self>) {
        let session = self.validate_session();
        let window = match crate::studio_window(&self.app) {
            Ok(w) => w,
            Err(e) => {
                let mut s = Status::new("failed", "The studio window could not open", &e);
                s.action = Some("retry");
                return self.set(s);
            }
        };
        if let Some((token, _)) = &session {
            let _ = window.set_cookie(Self::session_cookie(token));
        }
        self.inner.lock().unwrap().signed_in = session.is_some();
        let _ = window.navigate(crate::WEB_ORIGIN.parse().unwrap());
        let at_login_hidden = std::env::args().any(|a| a == "--at-login")
            && self.close_behavior() == "background"
            && !self.inner.lock().unwrap().background_notice;
        if at_login_hidden {
            self.inner.lock().unwrap().background_notice = true;
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            crate::hide_control(&self.app);
        }
    }

    /// Explicit local-owner sign-in: the per-launch code never leaves this process and the
    /// service. The session token is kept DPAPI-protected and set as an HttpOnly cookie.
    pub fn sign_in(&self) -> Result<(), String> {
        if !self.running() {
            return Err("Start the studio before signing in".into());
        }
        let code = self.inner.lock().unwrap().login_code.clone();
        let r = client(10)?
            .post(format!("{API}/api/auth/dev-login"))
            .json(&json!({ "code": code }))
            .send()
            .map_err(|_| "The studio did not answer the sign-in")?;
        if !r.status().is_success() {
            return Err(format!("Sign-in was refused (HTTP {})", r.status()));
        }
        let token = r
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|h| h.to_str().ok())
            .find_map(|h| h.strip_prefix("creator_session="))
            .and_then(|rest| rest.split(';').next())
            .map(str::to_string)
            .ok_or("The studio did not return a session")?;
        if token.len() != 43
            || !token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err("The studio returned an invalid session".into());
        }
        let session = bounded_json(r)?;
        self.secrets.save(
            "session",
            &json!({"token": token, "expires_at": session["expires_at"]}).to_string(),
        )?;
        let window = crate::studio_window(&self.app)?;
        window
            .set_cookie(Self::session_cookie(&token))
            .map_err(|_| "Could not hand the session to the studio window")?;
        let _ = window.navigate(crate::WEB_ORIGIN.parse().unwrap());
        self.inner.lock().unwrap().signed_in = true;
        self.note("signed in as the local owner");
        Ok(())
    }

    /// Revokes the stored sign-in on the server, deletes it here and clears the WebView.
    pub fn sign_out(&self) -> Result<(), String> {
        if let Some((token, csrf)) = self.validate_session() {
            let r = client(10)?
                .post(format!("{API}/api/auth/logout"))
                .header("Cookie", format!("creator_session={token}"))
                .header("X-CSRF-Token", csrf)
                .json(&json!({}))
                .send()
                .map_err(|_| "The studio did not answer the sign-out")?;
            if !r.status().is_success() {
                return Err(format!("Sign-out was not confirmed (HTTP {})", r.status()));
            }
        }
        self.secrets.delete("session")?;
        if let Some(window) = self.app.get_webview_window("studio") {
            let _ = window.delete_cookie(Self::session_cookie(""));
            let _ = window.navigate(crate::WEB_ORIGIN.parse().unwrap());
        }
        self.inner.lock().unwrap().signed_in = false;
        self.note("signed out and removed the stored sign-in");
        Ok(())
    }

    /// Explicit Quit: stop the service gracefully, then the app's own database, then exit.
    pub fn quit(self: &Arc<Self>) {
        {
            let mut i = self.inner.lock().unwrap();
            if i.quitting {
                return;
            }
            i.quitting = true;
            i.status = Status::new(
                "stopping",
                "Quitting Creator Agent",
                "Stopping the studio service and its database",
            );
        }
        self.note("quit requested");
        let me = self.clone();
        std::thread::spawn(move || {
            let generation = me.inner.lock().unwrap().generation;
            {
                // stop_child ignores `quitting`; it only needs the current generation.
                me.stop_child(generation);
            }
            let cluster = me.inner.lock().unwrap().cluster.take();
            if let Some(c) = cluster {
                match c.stop() {
                    Ok(()) => me.note("stopped the app's PostgreSQL"),
                    Err(e) => me.note(&e),
                }
            }
            me.note("quit complete");
            me.app.exit(0);
        });
    }

    fn busy<T>(self: &Arc<Self>, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        {
            let mut i = self.inner.lock().unwrap();
            if i.busy {
                return Err("Another setup step is still running".into());
            }
            i.busy = true;
        }
        let r = f();
        self.inner.lock().unwrap().busy = false;
        r
    }

    /// Owner-approved upgrade: verified pre-migration backup, migration, then start.
    pub fn approve_migration(self: &Arc<Self>) -> Result<Value, String> {
        self.busy(|| {
            let c = self.home.load()?.ok_or("Run setup first")?;
            self.set(Status::new(
                "working",
                "Upgrading the studio database",
                "Saving a backup, then upgrading",
            ));
            let url = self.database_url(&c)?;
            let r = self.command("migrate", &self.input(&c, &url, Value::Null));
            match r {
                Ok(v) => {
                    self.start();
                    Ok(v)
                }
                Err(e) => {
                    let mut s = Status::new("failed", "The database upgrade did not finish", &e);
                    s.action = Some("retry");
                    self.set(s);
                    Err(e)
                }
            }
        })
    }

    pub fn inspect_source(self: &Arc<Self>, source: &Value) -> Result<Value, String> {
        let url = source_url(source)?;
        let probe = json!({
            "protocol": PROTOCOL, "database_url": url,
            "products_root": self.home.products().display().to_string(),
            "backups_dir": self.home.backups().display().to_string(),
            "pg_bin": Value::Null, "web_root": Value::Null, "owner_secret": Value::Null,
            "login_code": Value::Null, "worker_distro": Value::Null, "source": Value::Null,
        });
        let r = self.command("inspect", &probe)?;
        Ok(json!({
            "reachable": r["reachable"], "applied": r["applied"], "expected": r["expected"],
            "empty": r["empty"], "workspaces": r["workspaces"], "error": r["error"],
        }))
    }

    /// First-run setup. `kind` is `adopt`, `new` or `external`; nothing is saved unless the
    /// chosen path finishes and verifies.
    pub fn setup(self: &Arc<Self>, req: &Value) -> Result<Value, String> {
        self.busy(|| {
            if self.home.load()?.is_some() {
                return Err("This studio is already set up".into());
            }
            let kind = req["kind"].as_str().ok_or("Choose a setup option")?;
            let close = req["close_behavior"].as_str().unwrap_or("quit");
            let login = req["launch_at_login"].as_bool().unwrap_or(false);
            let pg_bin = req["pg_bin"].as_str().ok_or("Choose the PostgreSQL 18 folder")?.to_string();
            let version = postgres::verify_bin(Path::new(&pg_bin))?;
            self.note(&format!("setup {kind} with PostgreSQL {version}"));
            let products = self.home.products();
            // An unfinished earlier setup (app closed mid-way) left only app-created files:
            // its marker proves that, so they are cleared. Anything else is left for the owner.
            let marker = self.home.root.join("setup-in-progress.json");
            if marker.is_file() {
                self.note("clearing an unfinished earlier setup attempt");
                let old = Cluster {
                    bin: PathBuf::from(&pg_bin),
                    data: self.home.pg_data(),
                    port: 0,
                    log: self.home.logs().join("postgres.log"),
                };
                let _ = old.stop();
                let _ = std::fs::remove_dir_all(self.home.root.join("postgres"));
                let _ = std::fs::remove_dir_all(&products);
                let _ = self.secrets.delete("postgres");
                let _ = self.secrets.delete("database-url");
            }
            // Never adopt files this setup did not create: the marker is written only after
            // checking that the database and products folders are absent.
            if self.home.root.join("postgres").exists() || products.exists() {
                return Err("This studio folder already holds a database or products that setup did not create. Move them aside before setting up again.".into());
            }
            std::fs::write(&marker, json!({"kind": kind, "started_at": chrono_now()}).to_string())
                .map_err(|_| "Could not record setup progress")?;
            let mut config = StudioConfig {
                format: CONFIG_FORMAT.into(),
                database: DatabaseConfig {
                    mode: "managed".into(),
                    port: postgres::DEFAULT_PORT,
                    name: DB_NAME.into(),
                    user: DB_USER.into(),
                    label: String::new(),
                },
                pg_bin: Some(pg_bin.clone()),
                products_root: products.display().to_string(),
                close_behavior: close.into(),
                launch_at_login: login,
                origin: Value::Null,
                created_at: chrono_now(),
            };
            config.validate()?;
            let result = match kind {
                "new" | "adopt" => {
                    let port = postgres::choose_port()?;
                    config.database.port = port;
                    config.database.label = format!("app-managed PostgreSQL {version} on 127.0.0.1:{port}");
                    let cluster = self.cluster_for(&config)?;
                    self.set(Status::new("working", "Creating the studio database", &config.database.label));
                    let password = random_hex(24)?;
                    let outcome = (|| -> Result<Value, String> {
                        self.secrets.save("postgres", &password)?;
                        cluster.init(DB_USER, &password)?;
                        cluster.start()?;
                        // Registered at once, so Quit during setup also stops it.
                        self.inner.lock().unwrap().cluster = Some(cluster.clone());
                        let url = format!("postgresql://{DB_USER}:{password}@127.0.0.1:{port}/{DB_NAME}");
                        if kind == "new" {
                            self.set(Status::new("working", "Creating a new, empty studio", "Preparing the database layout"));
                            let r = self.command("init", &self.input(&config, &url, Value::Null))?;
                            Ok(json!({"kind": "new_empty", "created_at": chrono_now(), "applied": r["applied"]}))
                        } else {
                            let source = &req["source"];
                            let src = json!({
                                "database_url": source_url(source)?,
                                "products_root": source["products_root"].as_str().ok_or("Choose the products folder to adopt")?,
                            });
                            self.set(Status::new("working", "Adopting your existing studio", "Backing up, restoring and verifying every record"));
                            let r = self.command("adopt", &self.input(&config, &url, src))?;
                            if r["ok"] != true {
                                return Err("The adopted copy did not pass verification; nothing was switched over".into());
                            }
                            Ok(json!({
                                "kind": "adopted", "adopted_at": chrono_now(),
                                "from": source_label(source), "from_products": source["products_root"],
                                "backup_dir": r["backup_dir"], "verified": true,
                                "workspaces": r["workspaces"], "counts": r["counts"],
                                "audit_chain": r["check"]["audit_chain"],
                            }))
                        }
                    })();
                    match outcome {
                        Ok(origin) => origin,
                        Err(e) => {
                            // Only what this attempt created is removed; sources are untouched.
                            self.inner.lock().unwrap().cluster = None;
                            let _ = cluster.stop();
                            let _ = std::fs::remove_file(&marker);
                            let _ = std::fs::remove_dir_all(self.home.root.join("postgres"));
                            let _ = std::fs::remove_dir_all(&products);
                            let _ = self.secrets.delete("postgres");
                            let mut s = Status::new("setup", "Setup did not finish", &e);
                            s.action = Some("setup");
                            self.set(s);
                            return Err(e);
                        }
                    }
                }
                "external" => {
                    let source = &req["source"];
                    let url = source_url(source)?;
                    config.database.mode = "external".into();
                    config.database.port = source["port"].as_u64().and_then(|p| u16::try_from(p).ok()).ok_or("Bad port")?;
                    config.database.name = source["database"].as_str().unwrap_or_default().into();
                    config.database.user = source["user"].as_str().unwrap_or_default().into();
                    config.database.label = format!("existing PostgreSQL at {} (not managed by the app)", source_label(source));
                    config.validate()?;
                    let outcome = (|| -> Result<Value, String> {
                        let state = self.inspect_source(source)?;
                        if state["reachable"] != true {
                            return Err(format!("Could not reach that database: {}", state["error"].as_str().unwrap_or("unknown error")));
                        }
                        if let Some(from) = source["products_root"].as_str().filter(|s| !s.is_empty()) {
                            self.set(Status::new("working", "Copying generated products", "Copying and hash-checking every file"));
                            let n = copy_verified(Path::new(from), &products)?;
                            self.note(&format!("copied {n} product files"));
                        } else {
                            std::fs::create_dir_all(&products).map_err(|_| "Could not create the products folder")?;
                        }
                        self.secrets.save("database-url", &url)?;
                        if state["empty"] == true {
                            self.command("init", &self.input(&config, &url, Value::Null))?;
                        }
                        Ok(json!({"kind": "external", "connected_at": chrono_now(), "label": config.database.label, "workspaces": state["workspaces"]}))
                    })();
                    match outcome {
                        Ok(origin) => origin,
                        Err(e) => {
                            let _ = std::fs::remove_dir_all(&products);
                            let _ = self.secrets.delete("database-url");
                            let _ = std::fs::remove_file(&marker);
                            let mut s = Status::new("setup", "Setup did not finish", &e);
                            s.action = Some("setup");
                            self.set(s);
                            return Err(e);
                        }
                    }
                }
                _ => return Err("Unknown setup option".into()),
            };
            config.origin = result.clone();
            self.home.save(&config)?;
            let _ = std::fs::remove_file(&marker);
            #[cfg(windows)]
            if login {
                let exe = std::env::current_exe().map_err(|_| "Could not find the app")?;
                crate::winsys::set_launch_at_login(true, &exe)?;
            }
            self.note(&format!("setup saved: {}", result["kind"]));
            self.start();
            Ok(result)
        })
    }

    pub fn set_preferences(&self, close: &str, login: bool) -> Result<(), String> {
        let mut c = self.home.load()?.ok_or("Run setup first")?;
        if !["quit", "background"].contains(&close) {
            return Err("Close behavior must be quit or background".into());
        }
        #[cfg(windows)]
        if login != c.launch_at_login || login != crate::winsys::launch_at_login_present() {
            let exe = std::env::current_exe().map_err(|_| "Could not find the app")?;
            crate::winsys::set_launch_at_login(login, &exe)?;
        }
        c.close_behavior = close.into();
        c.launch_at_login = login;
        self.home.save(&c)?;
        self.note(&format!(
            "preferences saved: close={close}, launch_at_login={login}"
        ));
        Ok(())
    }
}

fn source_label(s: &Value) -> String {
    format!(
        "{}:{}/{}",
        s["host"].as_str().unwrap_or("127.0.0.1"),
        s["port"].as_u64().unwrap_or(0),
        s["database"].as_str().unwrap_or("")
    )
}

/// Builds a loopback database URL from setup fields. The password is typed by the owner or
/// read from the named key of a local env file; it is never shown or logged.
pub fn source_url(s: &Value) -> Result<String, String> {
    let host = s["host"].as_str().unwrap_or("127.0.0.1");
    if host != "127.0.0.1" && host != "localhost" {
        return Err("Only a database on this computer (127.0.0.1) can be used".into());
    }
    let port = s["port"]
        .as_u64()
        .filter(|p| (1024..=65535).contains(p))
        .ok_or("Enter a database port")?;
    let db = s["database"].as_str().ok_or("Enter the database name")?;
    let user = s["user"].as_str().ok_or("Enter the database user")?;
    crate::home::valid_ident(db)?;
    crate::home::valid_ident(user)?;
    let password = match s["password"].as_str().filter(|p| !p.is_empty()) {
        Some(p) => p.to_string(),
        None => {
            let file = s["password_file"]
                .as_str()
                .filter(|p| !p.is_empty())
                .ok_or("Enter the database password or choose the file that holds it")?;
            let text =
                std::fs::read_to_string(file).map_err(|_| "Could not read the password file")?;
            let line = text
                .lines()
                .filter_map(|l| l.trim().strip_prefix("CREATOR_DOCKER_PASSWORD="))
                .collect::<Vec<_>>();
            if line.len() != 1 || line[0].is_empty() {
                return Err(
                    "The file must contain exactly one CREATOR_DOCKER_PASSWORD= line".into(),
                );
            }
            line[0].to_string()
        }
    };
    let mut url = tauri::Url::parse(&format!("postgresql://{host}:{port}/{db}"))
        .map_err(|_| "Bad database address")?;
    url.set_username(user).map_err(|_| "Bad database user")?;
    url.set_password(Some(&password))
        .map_err(|_| "Bad database password")?;
    Ok(url.to_string())
}

/// Copies a product store file by file, refusing links, then re-hashes every copy.
pub fn copy_verified(from: &Path, to: &Path) -> Result<usize, String> {
    if !from.is_dir() {
        return Err("The products folder to copy does not exist".into());
    }
    if to.exists()
        && std::fs::read_dir(to)
            .map(|mut d| d.next().is_some())
            .unwrap_or(true)
    {
        return Err("The studio products folder is not empty".into());
    }
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
        for e in std::fs::read_dir(dir).map_err(|_| "Could not read the products folder")? {
            let e = e.map_err(|_| "Could not read the products folder")?;
            let t = e
                .file_type()
                .map_err(|_| "Could not read the products folder")?;
            if t.is_symlink() {
                return Err(format!("Refusing to copy a link: {}", e.path().display()));
            } else if t.is_dir() {
                walk(&e.path(), out)?;
            } else {
                out.push(e.path());
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(from, &mut files)?;
    std::fs::create_dir_all(to).map_err(|_| "Could not create the products folder")?;
    for f in &files {
        let rel = f.strip_prefix(from).map_err(|_| "Bad product path")?;
        let dest = to.join(rel);
        std::fs::create_dir_all(dest.parent().unwrap())
            .map_err(|_| "Could not create a product folder")?;
        let bytes = std::fs::read(f).map_err(|_| "Could not read a product file")?;
        std::fs::write(&dest, &bytes).map_err(|_| "Could not write a product file")?;
        let copy = std::fs::read(&dest).map_err(|_| "Could not re-read a product file")?;
        if Sha256::digest(&copy) != Sha256::digest(&bytes) {
            return Err(format!(
                "Copy of {} does not match its source",
                rel.display()
            ));
        }
    }
    Ok(files.len())
}

pub fn chrono_now() -> String {
    // RFC 3339 UTC from the system clock without extra crates.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, m, s) = (rem / 3600, rem % 3600 / 60, rem % 60);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hmac_matches_rfc4231_case_2() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        let hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }
    #[test]
    fn ownership_mac_binds_port_and_nonce() {
        let secret = "11".repeat(32);
        let a = ownership_mac(&secret, 5173, "aa").unwrap();
        assert_ne!(a, ownership_mac(&secret, 4310, "aa").unwrap());
        assert_ne!(a, ownership_mac(&secret, 5173, "ab").unwrap());
        assert_ne!(a, ownership_mac(&"22".repeat(32), 5173, "aa").unwrap());
        assert!(ownership_mac("zz", 5173, "aa").is_none());
    }
    #[test]
    fn random_values_have_the_service_formats() {
        let code = random_code().unwrap();
        assert_eq!(code.len(), 43);
        assert!(code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(code, random_code().unwrap());
        assert_eq!(random_hex(32).unwrap().len(), 64);
    }
    #[test]
    fn source_urls_stay_on_loopback_and_escape_passwords() {
        let base = json!({"host":"127.0.0.1","port":55433,"database":"creator_studio","user":"creator","password":"p@ss/word:#"});
        let url = source_url(&base).unwrap();
        assert!(url.starts_with("postgresql://creator:"));
        assert!(url.ends_with("@127.0.0.1:55433/creator_studio"));
        assert!(!url.contains("p@ss/word"));
        let mut remote = base.clone();
        remote["host"] = json!("db.example.org");
        assert!(source_url(&remote).is_err());
        let mut bad = base.clone();
        bad["database"] = json!("x; drop");
        assert!(source_url(&bad).is_err());
        let dir = std::env::temp_dir().join(format!(
            "creator-env-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(".env.docker");
        std::fs::write(&file, "OTHER=1\nCREATOR_DOCKER_PASSWORD=secret123\n").unwrap();
        let mut from_file = base.clone();
        from_file["password"] = json!("");
        from_file["password_file"] = json!(file.display().to_string());
        assert!(source_url(&from_file).unwrap().contains(":secret123@"));
        std::fs::write(
            &file,
            "CREATOR_DOCKER_PASSWORD=a\nCREATOR_DOCKER_PASSWORD=b\n",
        )
        .unwrap();
        assert!(source_url(&from_file).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn product_copy_is_verified_and_refuses_non_empty_targets() {
        let root = std::env::temp_dir().join(format!(
            "creator-copy-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        let from = root.join("from");
        std::fs::create_dir_all(from.join("p1/artifacts")).unwrap();
        std::fs::write(from.join("p1/artifacts/manifest.json"), b"{}").unwrap();
        std::fs::write(from.join("top.txt"), b"x").unwrap();
        assert_eq!(copy_verified(&from, &root.join("to")).unwrap(), 2);
        assert_eq!(
            std::fs::read(root.join("to/p1/artifacts/manifest.json")).unwrap(),
            b"{}"
        );
        assert!(copy_verified(&from, &root.join("to")).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn timestamps_are_rfc3339() {
        let t = chrono_now();
        assert_eq!(t.len(), 20);
        assert!(t.starts_with("20") && t.ends_with('Z'));
    }
}
