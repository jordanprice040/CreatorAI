//! F4 (ADR-0128): the update steps that need the running studio or the system: the status
//! window's commands, the trial report of a newly installed version, and the `--apply-update`
//! helper that the copy of the earlier version runs. Decisions live in `update.rs`.
use crate::home::{Home, StudioConfig};
use crate::postgres::Cluster;
use crate::secret::Secrets;
use crate::studio::{chrono_now, random_hex, Shared, Status, Supervisor, PROTOCOL};
use crate::update::{self, Available, Outcome, Paths, Pending, Settings, Source, Steps};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};
use tauri::Manager;

const TOKEN: &str = "update-token";

/// The pending update this version is the trial of: installed by the helper, which now
/// waits for this launch to say whether it runs.
pub fn trial_for_this_version(home: &Home) -> Option<String> {
    let p: Pending = update::read_json(&Paths::new(&home.root).pending())
        .ok()
        .flatten()?;
    (p.stage == "starting" && p.to_version == env!("CARGO_PKG_VERSION")).then_some(p.id)
}

/// Reports the trial's outcome when the studio runs or fails; starts the approved database
/// upgrade when the new version needs one.
pub fn trial_event(sup: &Supervisor, id: &str, s: &Status) {
    let paths = Paths::new(&sup.home.root);
    let outcome = |result: &str, detail: String| Outcome {
        id: id.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        result: result.into(),
        detail,
        at: chrono_now(),
    };
    match s.phase {
        "needs_migration" => {
            sup.note("update: upgrading the database as approved with the install");
            if let Some(shared) = sup.app.try_state::<Shared>() {
                shared.inner().approve_migration_in_background();
            }
        }
        "running" => {
            let _ =
                update::write_json_atomic(&paths.outcome(id), &outcome("running", String::new()));
            sup.note("update: this version runs; reported to the installer");
        }
        _ => {
            let detail = format!("{}: {}", s.title, s.detail);
            let _ = update::write_json_atomic(&paths.outcome(id), &outcome("failed", detail));
            sup.note("update: this version did not start; reported to the installer");
        }
    }
}

/// What the status window shows about updates. Never includes the token.
pub fn state(sup: &Supervisor, busy: bool) -> Value {
    let paths = Paths::new(&sup.home.root);
    let settings = Settings::load(&paths);
    let available: Option<Available> = update::read_json(&paths.available()).ok().flatten();
    let downloaded = available
        .as_ref()
        .map(|a| download_path(&paths, a))
        .is_some_and(|p| p.is_file());
    let pending: Option<Pending> = update::read_json(&paths.pending()).ok().flatten();
    json!({
        "current_version": env!("CARGO_PKG_VERSION"),
        "settings": match &settings {
            Ok(Some(s)) => json!({"repository": s.repository, "check_at_start": s.check_at_start}),
            Ok(None) => Value::Null,
            Err(e) => json!({"error": e}),
        },
        "token_saved": sup.home.secrets().join(format!("{TOKEN}.dpapi")).is_file(),
        "available": available,
        "downloaded": downloaded,
        "pending": pending.map(|p| json!({
            "from_version": p.from_version, "to_version": p.to_version, "stage": p.stage,
            "detail": p.detail, "updated_at": p.updated_at, "backup_dir": p.backup_dir,
        })),
        "history": update::history(&paths, 8),
        "busy": busy,
    })
}

fn download_path(paths: &Paths, a: &Available) -> PathBuf {
    paths
        .downloads()
        .join(&a.version)
        .join(&a.manifest.installer.name)
}

fn guarded<T>(sup: &Shared, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    {
        let mut i = sup.inner_lock();
        if i.update_busy {
            return Err("Another update step is still running".into());
        }
        i.update_busy = true;
    }
    let r = f();
    sup.inner_lock().update_busy = false;
    r
}

pub fn save_settings(
    sup: &Shared,
    repository: &str,
    token: Option<String>,
    check_at_start: bool,
) -> Result<(), String> {
    update::valid_repository(repository)?;
    let paths = Paths::new(&sup.home.root);
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        update::valid_token(&t)?;
        sup.secrets.save(TOKEN, &t)?;
    }
    update::write_json_atomic(
        &paths.settings(),
        &Settings {
            format: update::SETTINGS_FORMAT.into(),
            repository: repository.into(),
            check_at_start,
        },
    )?;
    update::record(
        &paths,
        "settings_saved",
        json!({"repository": repository, "check_at_start": check_at_start}),
    );
    Ok(())
}

pub fn forget_token(sup: &Shared) -> Result<(), String> {
    sup.secrets.delete(TOKEN)?;
    update::record(&Paths::new(&sup.home.root), "token_removed", Value::Null);
    Ok(())
}

fn source(sup: &Shared) -> Result<Source, String> {
    let paths = Paths::new(&sup.home.root);
    let s = Settings::load(&paths)?.ok_or("Set the release repository first")?;
    let token = sup
        .secrets
        .load(TOKEN)?
        .ok_or("Save a GitHub token with read access to the release repository first")?;
    Ok(Source::github(&s.repository, &token))
}

/// Reads the latest release (manifest only). The only network call besides Download.
pub fn check(sup: &Shared) -> Result<Value, String> {
    guarded(sup, || {
        let paths = Paths::new(&sup.home.root);
        let r = source(sup).and_then(|s| s.check(update::current_version()));
        match r {
            Ok(a) => {
                update::write_json_atomic(&paths.available(), &a)?;
                update::record(
                    &paths,
                    "checked",
                    json!({"version": a.version, "newer": a.newer, "manifest_sha256": a.manifest_sha256}),
                );
                sup.note(&format!(
                    "update check: latest release {} ({})",
                    a.version,
                    if a.newer { "newer" } else { "not newer" }
                ));
                Ok(json!(a))
            }
            Err(e) => {
                update::record(&paths, "check_failed", json!({"reason": e}));
                Err(e)
            }
        }
    })
}

pub fn download(sup: &Shared) -> Result<Value, String> {
    guarded(sup, || {
        let paths = Paths::new(&sup.home.root);
        let a: Available =
            update::read_json(&paths.available())?.ok_or("Check for updates first")?;
        if !a.newer {
            return Err(format!("{} is not newer than this version", a.version));
        }
        let dir = paths.downloads().join(&a.version);
        let r = source(sup).and_then(|s| s.download(&a, &dir));
        match r {
            Ok(p) => {
                update::record(
                    &paths,
                    "downloaded",
                    json!({"version": a.version, "sha256": a.manifest.installer.sha256, "size": a.manifest.installer.size}),
                );
                Ok(json!({"path": p.display().to_string()}))
            }
            Err(e) => {
                update::record(
                    &paths,
                    "download_refused",
                    json!({"version": a.version, "reason": e}),
                );
                Err(e)
            }
        }
    })
}

/// Owner-approved install: verified backup, a copy of this version aside, then the copy takes
/// over and this version quits.
pub fn install(sup: &Shared) -> Result<Value, String> {
    if cfg!(debug_assertions) {
        return Err("Updates install only into the installed app, not a development build".into());
    }
    if !sup.running() {
        return Err(
            "Start the studio first: the backup before an update needs its database".into(),
        );
    }
    let paths = Paths::new(&sup.home.root);
    let a: Available = update::read_json(&paths.available())?.ok_or("Check for updates first")?;
    if !a.newer {
        return Err(format!("{} is not newer than this version", a.version));
    }
    let installer = download_path(&paths, &a);
    update::verify_download(&installer, &a.manifest.installer)?;
    let exe = std::env::current_exe().map_err(|_| "Could not find this app's program file")?;
    let install_dir = exe
        .parent()
        .ok_or("Could not find the install folder")?
        .to_path_buf();
    let exe_name = exe
        .file_name()
        .ok_or("Could not find this app's program file")?
        .to_string_lossy()
        .to_string();
    let config = sup.home.load()?.ok_or("Run setup first")?;
    let pending = guarded(sup, || {
        sup.note(&format!(
            "update: saving a backup before installing {}",
            a.version
        ));
        let url = sup.database_url(&config)?;
        let backup = sup.command("backup", &sup.input(&config, &url, Value::Null))?;
        let backup_dir = backup["dir"]
            .as_str()
            .ok_or("The backup did not say where it is")?
            .to_string();
        let schema_before = backup["schema_from"]
            .as_i64()
            .ok_or("The backup did not name its layout")?;
        // A copy of this version, used to apply the update and to put this version back.
        let from = env!("CARGO_PKG_VERSION");
        let rollback_dir = paths.rollback().join(from);
        if paths.rollback().exists() {
            std::fs::remove_dir_all(paths.rollback())
                .map_err(|_| "Could not clear the previous saved copy")?;
        }
        let files = crate::studio::copy_verified(&install_dir, &rollback_dir)?;
        sup.note(&format!(
            "update: saved a verified copy of {from} ({files} files)"
        ));
        let id = random_hex(8)?;
        let p = Pending {
            format: update::PENDING_FORMAT.into(),
            id: id.clone(),
            from_version: from.into(),
            to_version: a.version.clone(),
            installer: installer.display().to_string(),
            installer_sha256: a.manifest.installer.sha256.clone(),
            installer_size: a.manifest.installer.size,
            backup_dir,
            schema_before,
            rollback_dir: rollback_dir.display().to_string(),
            install_dir: install_dir.display().to_string(),
            exe_name: exe_name.clone(),
            stage: "installing".into(),
            detail: "Waiting for Creator Agent to quit".into(),
            created_at: chrono_now(),
            updated_at: chrono_now(),
        };
        update::write_json_atomic(&paths.pending(), &p)?;
        let _ = std::fs::remove_file(paths.outcome(&id));
        update::record(
            &paths,
            "install_approved",
            json!({"id": id, "from": from, "to": a.version, "backup_dir": p.backup_dir, "schema_before": schema_before}),
        );
        let helper = rollback_dir.join(HELPER_EXE);
        std::fs::copy(rollback_dir.join(&exe_name), &helper)
            .map_err(|_| "Could not prepare the update step")?;
        let mut cmd = Command::new(&helper);
        cmd.arg("--apply-update").arg(&id);
        spawn_detached(&mut cmd).map_err(|_| "Could not start the update step".to_string())?;
        Ok(p)
    })?;
    sup.note("update: handing over to the saved copy and quitting");
    sup.quit();
    Ok(json!({"to_version": pending.to_version, "backup_dir": pending.backup_dir}))
}

/// The helper's own file name. The installer closes running copies of the app's program
/// by name, so the helper runs under another name.
pub const HELPER_EXE: &str = "creator-agent-update-helper.exe";

/// Starts a program on its own (no console, its own process group) so it outlives this app;
/// outside any job this app may be in when Windows allows that.
fn spawn_detached(cmd: &mut Command) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, then CREATE_BREAKAWAY_FROM_JOB if allowed.
        cmd.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0100_0000);
        if let Ok(c) = cmd.spawn() {
            return Ok(c);
        }
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd.spawn()
}

/// Optional check at start (off by default), once the studio runs.
pub fn check_at_start(sup: &Shared) {
    let paths = Paths::new(&sup.home.root);
    let on = Settings::load(&paths)
        .ok()
        .flatten()
        .is_some_and(|s| s.check_at_start);
    if !on {
        return;
    }
    let sup = sup.clone();
    std::thread::spawn(move || {
        for _ in 0..120 {
            if sup.running() {
                let _ = check(&sup);
                return;
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

// ---- the helper: the saved copy of the earlier version ----------------------------------------

/// Database URL for the saved settings, starting the app's own PostgreSQL when needed.
fn database_url(home: &Home, secrets: &Secrets, c: &StudioConfig) -> Result<String, String> {
    if c.database.mode == "managed" {
        let cluster = Cluster {
            bin: PathBuf::from(c.pg_bin.clone().ok_or("No PostgreSQL folder is set")?),
            data: home.pg_data(),
            port: c.database.port,
            log: home.logs().join("postgres.log"),
        };
        cluster.start()?;
        let pw = secrets
            .load("postgres")?
            .ok_or("The studio database password is missing")?;
        Ok(format!(
            "postgresql://{}:{pw}@127.0.0.1:{}/{}",
            c.database.user, c.database.port, c.database.name
        ))
    } else {
        secrets
            .load("database-url")?
            .ok_or("The saved database connection is missing".into())
    }
}

fn service_input(home: &Home, c: &StudioConfig, url: &str, extra: Value) -> Value {
    let mut v = json!({
        "protocol": PROTOCOL,
        "database_url": url,
        "products_root": c.products_root,
        "backups_dir": home.backups().display().to_string(),
        "pg_bin": c.pg_bin,
        "web_root": Value::Null,
        "owner_secret": Value::Null,
        "login_code": Value::Null,
        "worker_distro": Value::Null,
        "source_hosts": c.source_hosts,
        "source": Value::Null,
    });
    if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
        for (k, x) in e {
            o.insert(k.clone(), x.clone());
        }
    }
    v
}

/// The same database URL with another database name.
pub fn with_database(url: &str, name: &str) -> Result<String, String> {
    let mut u =
        reqwest::Url::parse(url).map_err(|_| "The saved database connection is malformed")?;
    u.set_path(&format!("/{name}"));
    Ok(u.to_string())
}

/// A name for the restored database: the old name (shortened) and a UTC time stamp.
pub fn restored_name(name: &str, stamp: &str) -> String {
    let base: String = name.chars().take(40).collect();
    format!("{base}_rb_{stamp}")
}

struct RealSteps {
    home: Home,
    secrets: Secrets,
    paths: Paths,
    /// The saved copy's own `studio` resources (its Node service matches the earlier layout).
    resources: PathBuf,
    started: Instant,
    child: Option<Child>,
}

impl RealSteps {
    fn service(&self, mode: &str, input: &Value) -> Result<Value, String> {
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.home.logs().join("update.log"))
            .map_err(|_| "Could not open the update log")?;
        let (child, stdin, stdout) =
            crate::studio::spawn_service(&self.resources, &self.home, mode, input, log)?;
        crate::studio::finish_command(child, stdin, stdout)
    }
    fn spawn(&mut self, exe: &Path) -> Result<Child, String> {
        spawn_detached(&mut Command::new(exe))
            .map_err(|_| format!("Could not start {}", exe.display()))
    }
}

impl Steps for RealSteps {
    fn wait_for_previous_exit(&mut self) -> Result<(), String> {
        #[cfg(windows)]
        {
            let key = Home::key_for(&self.home.root);
            for _ in 0..240 {
                if !crate::winsys::studio_running(&key) {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            Err("it was still running after two minutes".into())
        }
        #[cfg(not(windows))]
        Ok(())
    }
    fn run_installer(&mut self, installer: &Path) -> Result<(), String> {
        // NSIS silent install for the current user; it never asks for administrator rights.
        let mut child = Command::new(installer)
            .arg("/S")
            .spawn()
            .map_err(|_| "the installer could not be started".to_string())?;
        let deadline = Instant::now() + Duration::from_secs(15 * 60);
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => return Ok(()),
                Ok(Some(s)) => return Err(format!("it ended with {s}")),
                Ok(None) if Instant::now() > deadline => {
                    let _ = child.kill();
                    return Err("it did not finish within 15 minutes".into());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(500)),
                Err(_) => return Err("its progress could not be read".into()),
            }
        }
    }
    fn start_new_version(&mut self, exe: &Path) -> Result<(), String> {
        self.started = Instant::now();
        self.child = Some(self.spawn(exe)?);
        Ok(())
    }
    fn new_version_running(&mut self) -> bool {
        self.child
            .as_mut()
            .is_some_and(|c| matches!(c.try_wait(), Ok(None)))
    }
    fn stop_new_version(&mut self) {
        if let Some(mut c) = self.child.take() {
            // Its kill-on-close job stops its studio service with it.
            let _ = c.kill();
            let _ = c.wait();
        }
        #[cfg(windows)]
        {
            let key = Home::key_for(&self.home.root);
            for _ in 0..60 {
                if !crate::winsys::studio_running(&key) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    fn read_outcome(&mut self, id: &str) -> Option<Outcome> {
        update::read_json(&self.paths.outcome(id)).ok().flatten()
    }
    fn wait(&mut self, d: Duration) {
        std::thread::sleep(d);
    }
    fn elapsed_since_start(&mut self) -> Duration {
        self.started.elapsed()
    }
    fn database_changed(&mut self, schema_before: i64) -> Result<bool, String> {
        let c = self.home.load()?.ok_or("The studio settings are missing")?;
        let url = database_url(&self.home, &self.secrets, &c)?;
        let r = self.service("inspect", &service_input(&self.home, &c, &url, Value::Null))?;
        if r["reachable"] != true {
            return Err(r["error"]
                .as_str()
                .unwrap_or("database unavailable")
                .to_string());
        }
        Ok(r["applied"].as_i64() != Some(schema_before) || r["unknown_newer"] == true)
    }
    fn restore_database(&mut self, backup_dir: &Path) -> Result<String, String> {
        let mut c = self.home.load()?.ok_or("The studio settings are missing")?;
        let url = database_url(&self.home, &self.secrets, &c)?;
        let stamp: String = chrono_now()
            .chars()
            .filter(|ch| ch.is_ascii_digit())
            .collect();
        let name = restored_name(&c.database.name, &stamp);
        let new_url = with_database(&url, &name)?;
        let products = self.home.root.join(format!("products-rb-{stamp}"));
        let r = self.service(
            "restore",
            &service_input(
                &self.home,
                &c,
                &new_url,
                json!({"products_root": products.display().to_string(), "restore_from": backup_dir.display().to_string()}),
            ),
        )?;
        if r["ok"] != true {
            return Err("the restored copy did not pass its check".into());
        }
        // Point the settings at the restored copy; the upgraded database stays as it is.
        let old = c.database.name.clone();
        c.database.label = c.database.label.replace(&old, &name);
        c.database.name = name.clone();
        c.products_root = products.display().to_string();
        if c.database.mode == "external" {
            self.secrets.save("database-url", &new_url)?;
        }
        self.home.save(&c)?;
        Ok(name)
    }
    fn restore_files(&mut self, from: &Path, install_dir: &Path) -> Result<(), String> {
        let aside = install_dir.with_file_name(format!(
            "{}.failed-update-{}",
            install_dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            random_hex(4)?
        ));
        std::fs::rename(install_dir, &aside)
            .map_err(|_| "the new version's files are in use".to_string())?;
        crate::studio::copy_verified(from, install_dir)?;
        let _ = std::fs::remove_file(install_dir.join(HELPER_EXE));
        Ok(())
    }
    fn start_previous(&mut self, exe: &Path) -> Result<(), String> {
        self.spawn(exe).map(|_| ())
    }
    fn save(&mut self, p: &Pending) {
        let _ = update::write_json_atomic(&self.paths.pending(), p);
    }
    fn note(&mut self, event: &str, detail: Value) {
        update::record(&self.paths, event, detail);
    }
}

/// `--apply-update <id>`: run by the saved copy of the earlier version, with no window.
pub fn helper(root: PathBuf, id: &str) -> Result<(), String> {
    let home = Home::new(root)?;
    let paths = Paths::new(&home.root);
    let p: Pending = update::read_json(&paths.pending())?.ok_or("No update is pending")?;
    if p.id != id || p.stage != "installing" {
        return Err("This update is not waiting to be installed".into());
    }
    let exe = std::env::current_exe().map_err(|_| "Could not find the program file")?;
    let resources = exe
        .parent()
        .ok_or("Could not find the saved copy")?
        .join("studio");
    let mut steps = RealSteps {
        secrets: Secrets::new(&home.secrets()),
        paths,
        home,
        resources,
        started: Instant::now(),
        child: None,
    };
    let out = update::apply(&mut steps, p);
    if out.stage != "confirmed" && out.stage != "rolled_back" {
        #[cfg(windows)]
        crate::winsys::message("Creator Agent update", &out.detail);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restored_database_names_stay_valid_identifiers() {
        let n = restored_name("creator_studio", "20261117101500");
        assert_eq!(n, "creator_studio_rb_20261117101500");
        crate::home::valid_ident(&n).unwrap();
        let long = restored_name(&"a".repeat(63), "20261117101500");
        assert!(long.len() <= 63);
        crate::home::valid_ident(&long).unwrap();
    }
    #[test]
    fn database_urls_keep_credentials_and_change_only_the_name() {
        let u = with_database(
            "postgresql://creator:p%40ss@127.0.0.1:55440/creator_studio",
            "creator_studio_rb_1",
        )
        .unwrap();
        assert_eq!(
            u,
            "postgresql://creator:p%40ss@127.0.0.1:55440/creator_studio_rb_1"
        );
    }
}
