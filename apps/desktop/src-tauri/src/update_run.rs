//! F4 (ADR-0128): the update steps that need the running studio or the system: the status
//! window's commands, the trial report of a newly installed version, and the `--apply-update`
//! helper that the copy of the earlier version runs. Decisions live in `update.rs`.
use crate::home::{Home, StudioConfig};
use crate::secret::Secrets;
use crate::studio::{chrono_now, random_hex, Shared, Status, Supervisor, PROTOCOL};
use crate::update::{
    self, Available, Outcome, Paths, Pending, Settings, Source, Steps, TrialAction,
};
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

/// How long ago the helper last showed it is watching this update (review M-1).
fn heartbeat_age(paths: &Paths, id: &str) -> Option<Duration> {
    let modified = std::fs::metadata(update::heartbeat(paths, id))
        .ok()?
        .modified()
        .ok()?;
    // A time stamp in the future (clock change) counts as fresh.
    Some(modified.elapsed().unwrap_or(Duration::ZERO))
}

/// Reports the trial's outcome when the studio runs or fails; starts the approved database
/// upgrade when the new version needs one. Review M-1: when the copy that installed this
/// version is no longer watching (restart, sign-out, crash), this launch decides itself.
pub fn trial_event(sup: &Supervisor, id: &str, s: &Status) {
    let paths = Paths::new(&sup.home.root);
    if s.phase == "needs_migration" {
        sup.note("update: upgrading the database as approved with the install");
        if let Some(shared) = sup.app.try_state::<Shared>() {
            shared.inner().approve_migration_in_background();
        }
        return;
    }
    let (result, detail) = if s.phase == "running" {
        ("running", String::new())
    } else {
        ("failed", format!("{}: {}", s.title, s.detail))
    };
    let outcome = Outcome {
        id: id.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        result: result.into(),
        detail,
        at: chrono_now(),
    };
    if let Err(e) = update::write_json_atomic(&paths.outcome(id), &outcome) {
        sup.note(&format!(
            "update: the trial outcome could not be saved: {e}"
        ));
    }
    let alive = update::helper_alive(heartbeat_age(&paths, id));
    match update::trial_action(alive, result) {
        TrialAction::Report => sup.note(&format!(
            "update: this version {}; reported to the installer",
            if result == "running" {
                "runs"
            } else {
                "did not start"
            }
        )),
        TrialAction::Confirm => confirm_without_helper(sup, &paths, id),
        TrialAction::ResumeRollback => resume_rollback(sup, &paths, id),
    }
}

/// Loads the pending update `id` when it is still at `stage`.
fn pending_at(paths: &Paths, id: &str, stage: &str) -> Option<Pending> {
    update::read_json::<Pending>(&paths.pending())
        .ok()
        .flatten()
        .filter(|p| p.id == id && p.stage == stage)
}

fn save_stage(paths: &Paths, p: &mut Pending, stage: &str, detail: &str) -> Result<(), String> {
    p.stage = stage.into();
    p.detail = detail.into();
    p.updated_at = chrono_now();
    update::write_json_atomic(&paths.pending(), p)
}

fn confirm_without_helper(sup: &Supervisor, paths: &Paths, id: &str) {
    let Some(mut p) = pending_at(paths, id, "starting") else {
        return;
    };
    let detail = "The new version is running. The copy that installed it had stopped (for example the computer restarted), so this version confirmed the update itself.";
    if let Err(e) = save_stage(paths, &mut p, "confirmed", detail) {
        sup.note(&format!("update: the confirmation could not be saved: {e}"));
        return;
    }
    update::record(
        paths,
        "update_confirmed",
        json!({"id": id, "version": p.to_version, "helper_gone": true}),
    );
    finish_confirmed(paths, id);
    sup.note("update: this version runs; the installer had stopped, so it confirmed itself");
}

/// After a confirmed update: the installer and this update's own files are no longer needed
/// (review 2 N-B). A rolled-back update keeps them for inspection.
fn finish_confirmed(paths: &Paths, id: &str) {
    let _ = std::fs::remove_dir_all(paths.downloads());
    let _ = std::fs::remove_file(update::heartbeat(paths, id));
    let _ = std::fs::remove_file(paths.outcome(id));
    let _ = std::fs::remove_file(paths.settings_copy(id));
}

/// The new version does not start and nobody is watching: hand the rollback to the saved copy
/// of the earlier version, then quit so it can put that version back.
fn resume_rollback(sup: &Supervisor, paths: &Paths, id: &str) {
    let Some(mut p) = pending_at(paths, id, "starting") else {
        return;
    };
    let helper = PathBuf::from(&p.rollback_dir).join(HELPER_EXE);
    let going_back = format!(
        "The new version did not start and the copy that installed it had stopped; going back to {}",
        p.from_version
    );
    let r = save_stage(paths, &mut p, "resuming_rollback", &going_back).and_then(|_| {
        let mut cmd = Command::new(&helper);
        cmd.arg("--resume-rollback")
            .arg(id)
            .current_dir(&sup.home.root);
        spawn_detached(&mut cmd)
            .map(|_| ())
            .map_err(|_| format!("Could not start {}", helper.display()))
    });
    match r {
        Ok(()) => {
            update::record(paths, "rollback_resumed", json!({"id": id}));
            sup.note("update: this version did not start; the saved copy goes back to the earlier version");
            if let Some(shared) = sup.app.try_state::<Shared>() {
                let shared = shared.inner().clone();
                std::thread::spawn(move || shared.quit());
            }
        }
        Err(e) => {
            let why = format!(
                "The new version did not start, and going back to {} could not begin: {e}. Reinstall {} by hand; the backup is in {}.",
                p.from_version, p.from_version, p.backup_dir
            );
            let _ = save_stage(paths, &mut p, "rollback_failed", &why);
            update::record(paths, "rollback_failed", json!({"id": id, "reason": e}));
            sup.note(&format!("update: going back could not begin: {e}"));
        }
    }
}

/// What the status window shows about updates. Never includes the token.
pub fn state(sup: &Supervisor, busy: bool, schema_version: Option<i64>) -> Value {
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
        // Review N-4/N-5: the layout the running studio uses, compared with a release's.
        "schema_version": schema_version,
        "highest_failed": update::read_json::<update::Failed>(&update::failed_path(&paths))
            .ok()
            .flatten()
            .map(|f| f.highest_failed),
        // Live trial findings: a release at or below a rolled-back version is not offered, and
        // the saved copy a failed rollback runs says so instead of offering updates.
        "available_blocked": available
            .as_ref()
            .is_some_and(|a| update::check_not_blocked(&paths, &a.version).is_err()),
        "saved_copy": running_from_saved_copy(&paths).then_some(SAVED_COPY_TEXT),
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
        let r = source(sup)
            .and_then(|s| s.check(update::current_version()))
            .and_then(|a| {
                if a.newer {
                    release_allowed(sup, &paths, &a)?;
                }
                Ok(a)
            });
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

/// Review L-4 and N-4: a release must be above every version that was rolled back, and must
/// not use an older database layout than the running studio.
fn release_allowed(sup: &Supervisor, paths: &Paths, a: &Available) -> Result<(), String> {
    update::check_not_blocked(paths, &a.version)?;
    let current = sup.inner_lock().schema_version;
    release_layout_allowed(a.manifest.schema_version, current)
}

pub fn release_layout_allowed(release: u32, current: Option<i64>) -> Result<(), String> {
    match current {
        Some(c) if i64::from(release) < c => Err(format!(
            "This release uses database layout {release}, older than this studio's layout {c}. An update cannot take the database back; publish a release built from newer code."
        )),
        _ => Ok(()),
    }
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
    // Live trial finding: the copy a failed rollback runs takes its own folder for the
    // install folder, so an update started from it would install and save in the wrong place.
    if running_from_saved_copy(&paths) {
        return Err(SAVED_COPY_TEXT.into());
    }
    let a: Available = update::read_json(&paths.available())?.ok_or("Check for updates first")?;
    if !a.newer {
        return Err(format!("{} is not newer than this version", a.version));
    }
    release_allowed(sup, &paths, &a)?;
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
        let files = crate::studio::copy_verified_as(&install_dir, &rollback_dir, "app")?;
        sup.note(&format!(
            "update: saved a verified copy of {from} ({files} files)"
        ));
        let id = random_hex(8)?;
        // Review L-5: the settings as they are now, for a rollback to put back.
        let settings_copy = paths.settings_copy(&id);
        std::fs::copy(sup.home.config_path(), &settings_copy)
            .map_err(|_| "Could not save a copy of the studio settings")?;
        let mut p = Pending {
            format: update::PENDING_FORMAT.into(),
            id: id.clone(),
            from_version: from.into(),
            to_version: a.version.clone(),
            installer: installer.display().to_string(),
            installer_sha256: a.manifest.installer.sha256.clone(),
            installer_size: a.manifest.installer.size,
            backup_dir,
            schema_before,
            settings_copy: settings_copy.display().to_string(),
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
        let _ = std::fs::remove_file(update::heartbeat(&paths, &id));
        update::record(
            &paths,
            "install_approved",
            json!({"id": id, "from": from, "to": a.version, "backup_dir": p.backup_dir, "schema_before": schema_before}),
        );
        let hand_over = || -> Result<(), String> {
            let helper = rollback_dir.join(HELPER_EXE);
            std::fs::copy(rollback_dir.join(&exe_name), &helper)
                .map_err(|_| "Could not prepare the update step")?;
            let mut cmd = Command::new(&helper);
            cmd.arg("--apply-update")
                .arg(&id)
                .current_dir(&sup.home.root);
            spawn_detached(&mut cmd).map_err(|_| "Could not start the update step")?;
            Ok(())
        };
        // Review L-1: a failed hand-off ends the update visibly instead of "Installing".
        if let Err(e) = hand_over() {
            let why = format!("Nothing was installed and Creator Agent keeps running: {e}");
            let _ = save_stage(&paths, &mut p, "refused", &why);
            update::record(&paths, "install_failed", json!({"id": id, "reason": e}));
            return Err(why);
        }
        Ok(p)
    })?;
    sup.note("update: handing over to the saved copy and quitting");
    sup.quit();
    Ok(json!({"to_version": pending.to_version, "backup_dir": pending.backup_dir}))
}

const SAVED_COPY_TEXT: &str = "This is the saved copy of the earlier version that a rollback started, not the installed app. Quit, reinstall Creator Agent by hand with an installer newer than the failed version, then update from the installed app.";

/// True when this program runs from `updates/rollback` (a rollback could not put its files
/// back into the install folder).
/// Live trial part 2: a rollback renames the failed program to `<name>.exe.failed`; when the
/// files cannot be put back, that file stays in the install folder, and a later install over
/// it (or the saved copy made from it) keeps it. The installed app removes it at start.
pub fn tidy_install_folder(paths: &Paths) {
    if running_from_saved_copy(paths) {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut stale = exe.into_os_string();
        stale.push(".failed");
        let stale = PathBuf::from(stale);
        if stale.is_file() && std::fs::remove_file(&stale).is_ok() {
            update::record(
                paths,
                "stale_failed_program_removed",
                json!({"path": stale.display().to_string()}),
            );
        }
    }
}

fn running_from_saved_copy(paths: &Paths) -> bool {
    std::env::current_exe()
        .ok()
        .is_some_and(|exe| is_inside(&exe, &paths.rollback()))
}

pub fn is_inside(path: &Path, dir: &Path) -> bool {
    let norm = |p: &Path| {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect::<Vec<_>>()
    };
    let (p, d) = (norm(path), norm(dir));
    p.len() > d.len() && p[..d.len()] == d[..]
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

/// The status label of a database restored by a rollback (review N-2: set, not patched).
pub fn restored_label(mode: &str, url: &str, name: &str, failed_version: &str) -> String {
    let server = reqwest::Url::parse(url)
        .ok()
        .map(|u| {
            format!(
                "{}:{}",
                u.host_str().unwrap_or("?"),
                u.port().unwrap_or(5432)
            )
        })
        .unwrap_or_else(|| "?".into());
    let kind = if mode == "managed" {
        "app-managed PostgreSQL"
    } else {
        "existing PostgreSQL"
    };
    format!("{kind} at {server}/{name} (restored when update {failed_version} was rolled back)")
}

struct RealSteps {
    home: Home,
    secrets: Secrets,
    paths: Paths,
    /// The saved copy's own `studio` resources (its Node service matches the earlier layout).
    resources: PathBuf,
    started: Instant,
    child: Option<Child>,
    /// The update being applied, for the heartbeat and labels.
    id: String,
    to_version: String,
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
    /// Shows a new version's launch that this helper is still watching (review M-1).
    fn beat(&self) {
        let _ = std::fs::write(update::heartbeat(&self.paths, &self.id), chrono_now());
    }
    fn database(&self) -> Result<(StudioConfig, String), String> {
        let c = self.home.load()?.ok_or("The studio settings are missing")?;
        let (url, _) = crate::studio::open_database(&self.home, &self.secrets, &c)?;
        Ok((c, url))
    }
    fn spawn(&mut self, exe: &Path) -> Result<Child, String> {
        // Live trial part 2: never in the install folder, which a rollback renames.
        spawn_detached(Command::new(exe).current_dir(&self.home.root))
            .map_err(|_| format!("Could not start {}", exe.display()))
    }
}

impl Steps for RealSteps {
    fn wait_for_previous_exit(&mut self, limit: Duration) -> Result<(), String> {
        #[cfg(windows)]
        {
            let key = Home::key_for(&self.home.root);
            let deadline = Instant::now() + limit;
            while Instant::now() < deadline {
                if !crate::winsys::studio_running(&key) {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            Err(format!(
                "it was still running after {} minutes",
                limit.as_secs().div_ceil(60)
            ))
        }
        #[cfg(not(windows))]
        {
            let _ = limit;
            Ok(())
        }
    }
    fn run_installer(&mut self, installer: &Path) -> Result<(), String> {
        // NSIS silent install for the current user; it never asks for administrator rights.
        let mut child = Command::new(installer)
            .arg("/S")
            .current_dir(&self.home.root)
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
        self.beat();
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
        self.beat();
        std::thread::sleep(d);
        self.beat();
    }
    fn elapsed_since_start(&mut self) -> Duration {
        self.started.elapsed()
    }
    fn restore_settings(&mut self, copy: &Path) -> Result<(), String> {
        let bytes = std::fs::read(copy).map_err(|_| "its saved copy could not be read")?;
        serde_json::from_slice::<StudioConfig>(&bytes)
            .map_err(|_| "its saved copy is not readable by this version")?;
        let tmp = self.home.root.join("studio.json.restore");
        std::fs::write(&tmp, &bytes).map_err(|_| "it could not be written")?;
        std::fs::rename(&tmp, self.home.config_path())
            .map_err(|_| "it could not be replaced".into())
    }
    fn database_changed(&mut self, schema_before: i64) -> Result<bool, String> {
        let (c, url) = self.database()?;
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
        let (mut c, url) = self.database()?;
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
        c.database.label = restored_label(&c.database.mode, &new_url, &name, &self.to_version);
        c.database.name = name.clone();
        c.products_root = products.display().to_string();
        if c.database.mode == "external" {
            self.secrets.save("database-url", &new_url)?;
        }
        self.home.save(&c)?;
        Ok(name)
    }
    fn drop_rehearsal_copies(&mut self) -> Result<Vec<String>, String> {
        let (c, url) = self.database()?;
        let r = self.service(
            "drop-rehearsals",
            &service_input(&self.home, &c, &url, Value::Null),
        )?;
        let names = |k: &str| -> Vec<String> {
            r[k].as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().or(v["name"].as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        };
        let failed = names("failed");
        if !failed.is_empty() {
            return Err(format!("{} could not be dropped", failed.join(", ")));
        }
        Ok(names("dropped"))
    }
    fn restore_files(&mut self, from: &Path, install_dir: &Path) -> Result<(), String> {
        // Review of #243, N-1: a folder left by an earlier failed copy is removed instead of
        // being moved aside again, so only one aside folder holds the new version's files.
        if install_dir.exists() {
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
        }
        if let Err(e) = crate::studio::copy_verified_as(from, install_dir, "app") {
            let _ = std::fs::remove_dir_all(install_dir);
            return Err(format!("the earlier files could not be copied back ({e})"));
        }
        let _ = std::fs::remove_file(install_dir.join(HELPER_EXE));
        Ok(())
    }
    fn disable_failed_version(&mut self, exe: &Path) -> Result<(), String> {
        let mut to = exe.as_os_str().to_owned();
        to.push(".failed");
        std::fs::rename(exe, PathBuf::from(to)).map_err(|e| e.to_string())
    }
    fn studio_running(&mut self) -> bool {
        #[cfg(windows)]
        {
            crate::winsys::studio_running(&Home::key_for(&self.home.root))
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
    fn start_previous(&mut self, exe: &Path) -> Result<(), String> {
        self.spawn(exe).map(|_| ())
    }
    fn save(&mut self, p: &Pending) -> Result<(), String> {
        update::write_json_atomic(&self.paths.pending(), p)
    }
    fn note(&mut self, event: &str, detail: Value) {
        update::record(&self.paths, event, detail);
    }
    fn block_version(&mut self, v: &str) -> Result<(), String> {
        update::block_version(&self.paths, v)
    }
    fn claim_rollback(&mut self, id: &str) -> Result<bool, String> {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(update::rollback_claim(&self.paths, id))
        {
            Ok(mut f) => {
                use std::io::Write;
                let _ = writeln!(f, "{} pid {}", chrono_now(), std::process::id());
                Ok(true)
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(_) => Err("the rollback's lock file could not be created".into()),
        }
    }
}

/// `--apply-update <id>`: run by the saved copy of the earlier version, with no window.
/// `--resume-rollback <id>` (`resume`): started by a new version that did not start after the
/// first helper had gone (review M-1); it waits for that version to quit, then rolls back.
pub fn helper(root: PathBuf, id: &str, resume: bool) -> Result<(), String> {
    let home = Home::new(root)?;
    let paths = Paths::new(&home.root);
    let p: Pending = update::read_json(&paths.pending())?.ok_or("No update is pending")?;
    let want = if resume {
        "resuming_rollback"
    } else {
        "installing"
    };
    if p.id != id || p.stage != want {
        return Err(if resume {
            "This update is not waiting to be rolled back".into()
        } else {
            "This update is not waiting to be installed".into()
        });
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
        id: id.into(),
        to_version: p.to_version.clone(),
    };
    let out = if resume {
        let why = update::read_json::<Outcome>(&steps.paths.outcome(id))
            .ok()
            .flatten()
            .map(|o| format!("The new version did not start: {}", o.detail))
            .unwrap_or_else(|| "The new version did not start".into());
        update::resume_rollback(&mut steps, p, &why)
    } else {
        update::apply(&mut steps, p)
    };
    if out.stage == "confirmed" {
        finish_confirmed(&steps.paths, id);
    }
    let _ = std::fs::remove_file(update::heartbeat(&steps.paths, id));
    // Only an update that ended badly here says so; one another process is rolling back
    // (review 2 L-B) is reported by that process.
    if matches!(out.stage.as_str(), "refused" | "rollback_failed") {
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
    fn the_saved_copy_is_recognised_by_its_folder() {
        let rb = Path::new("/home/updates/rollback");
        assert!(is_inside(&rb.join("0.1.0").join("creator-desktop.exe"), rb));
        assert!(!is_inside(Path::new("/app/creator-desktop.exe"), rb));
        assert!(!is_inside(rb, rb));
        assert!(!is_inside(
            Path::new("/home/updates/rollback-old/x.exe"),
            rb
        ));
    }
    #[test]
    fn restored_labels_name_the_restored_database() {
        assert_eq!(
            restored_label(
                "managed",
                "postgresql://creator:pw@127.0.0.1:55440/creator_studio_rb_1",
                "creator_studio_rb_1",
                "0.2.0"
            ),
            "app-managed PostgreSQL at 127.0.0.1:55440/creator_studio_rb_1 (restored when update 0.2.0 was rolled back)"
        );
        let l = restored_label(
            "external",
            "postgresql://u:secret@db.local/x_rb_1",
            "x_rb_1",
            "0.3.0",
        );
        assert_eq!(
            l,
            "existing PostgreSQL at db.local:5432/x_rb_1 (restored when update 0.3.0 was rolled back)"
        );
        assert!(!l.contains("secret"));
    }
    #[test]
    fn releases_with_an_older_database_layout_are_refused() {
        assert!(release_layout_allowed(78, Some(78)).is_ok());
        assert!(release_layout_allowed(80, Some(78)).is_ok());
        assert!(release_layout_allowed(77, None).is_ok());
        let e = release_layout_allowed(77, Some(78)).unwrap_err();
        assert!(e.contains("layout 77") && e.contains("layout 78"), "{e}");
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
