use reqwest::blocking::{Client, Response};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};

pub(crate) fn bytes(mut response: Response, limit: u64) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("Download returned HTTP {}", response.status()));
    }
    let mut out = Vec::new();
    (&mut response)
        .take(limit + 1)
        .read_to_end(&mut out)
        .map_err(|_| "Could not read download")?;
    if out.len() as u64 > limit {
        return Err("Download size limit exceeded".into());
    }
    Ok(out)
}
fn check_hash(bytes: &[u8], expected: &str) -> Result<(), String> {
    if expected.len() != 64
        || !expected
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
        || format!("{:x}", Sha256::digest(bytes)) != expected
    {
        return Err("Downloaded artifact hash mismatch".into());
    }
    Ok(())
}
fn plain_path(path: &Path) -> Result<(), String> {
    // Same owner-controlled filesystem assumption as the existing executor; no reparse ancestors.
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("Linked download path refused".into());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err("Linked download path refused".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("Could not inspect download path".into()),
        }
    }
    Ok(())
}
fn save(path: &Path, value: &[u8]) -> Result<(), String> {
    plain_path(path)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Could not create download file")?;
    file.write_all(value)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not persist download".into())
}

pub fn selected(window: &WebviewWindow) -> Result<(String, String), String> {
    let url = window.url().map_err(|_| "Window unavailable")?;
    let fragment = url
        .fragment()
        .ok_or("Select an artifact in Gallery first")?;
    if !fragment.starts_with("/gallery?") {
        return Err("Select an artifact in Gallery first".into());
    }
    let query = tauri::Url::parse(&format!(
        "http://local/?{}",
        fragment.split_once('?').unwrap().1
    ))
    .map_err(|_| "Invalid gallery selection")?;
    let params: std::collections::HashMap<_, _> = query.query_pairs().into_owned().collect();
    let ws = params.get("ws").ok_or("Select a workspace")?;
    let id = params.get("id").ok_or("Select an artifact")?;
    uuid::Uuid::parse_str(ws).map_err(|_| "Invalid workspace")?;
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid artifact")?;
    Ok((ws.clone(), id.clone()))
}

pub(crate) fn local_client(window: &WebviewWindow) -> Result<(Client, String), String> {
    let origin = "http://127.0.0.1:5173/".parse().unwrap();
    let cookies = window
        .cookies_for_url(origin)
        .map_err(|_| "Could not read desktop session")?;
    let cookie = cookies
        .iter()
        .find(|c| c.name() == "creator_session" || c.name() == "__Host-creator_session")
        .ok_or("Sign in to the desktop first")?;
    if cookie.value().len() != 43
        || !cookie
            .value()
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid desktop session".into());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not create download client")?;
    Ok((client, format!("{}={}", cookie.name(), cookie.value())))
}

pub fn download(window: WebviewWindow) -> Result<PathBuf, String> {
    let (ws, id) = selected(&window)?;
    let (client, credential) = local_client(&window)?;
    let target = format!("http://127.0.0.1:4310/api/workspaces/{ws}/artifacts/{id}");
    let get = |url: &str, limit| -> Result<Vec<u8>, String> {
        bytes(
            client
                .get(url)
                .header("Cookie", &credential)
                .send()
                .map_err(|_| "Studio API unavailable")?,
            limit,
        )
    };
    let detail: Value =
        serde_json::from_slice(&get(&target, 262144)?).map_err(|_| "Invalid catalog response")?;
    let manifest_hash = detail["artifact"]["manifest_sha256"]
        .as_str()
        .ok_or("Missing catalog manifest hash")?;
    if manifest_hash.len() != 64 || !manifest_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid catalog manifest hash".into());
    }
    let manifest = get(&format!("{target}/manifest?sha256={manifest_hash}"), 262144)?;
    check_hash(&manifest, manifest_hash)?;
    let parsed: Value = serde_json::from_slice(&manifest).map_err(|_| "Invalid manifest JSON")?;
    if parsed["id"] != id || parsed["workspace_id"] != ws {
        return Err("Downloaded artifact scope mismatch".into());
    }
    let archive = get(
        &format!("{target}/download?sha256={manifest_hash}"),
        1048576,
    )?;
    let archive_hash = parsed["package"]["sha256"]
        .as_str()
        .ok_or("Missing package hash")?;
    check_hash(&archive, archive_hash)?;
    if parsed["package"]["bytes"].as_u64() != Some(archive.len() as u64) {
        return Err("Downloaded archive size mismatch".into());
    }
    let root = crate::data_root(window.app_handle())
        .ok_or("No studio folder for this launch")?
        .join("source-cache");
    plain_path(&root)?;
    fs::create_dir_all(&root).map_err(|_| "Could not create source cache")?;
    plain_path(&root)?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Secure randomness unavailable")?;
    let identity = uuid::Uuid::from_bytes(random);
    let pending = root.join(format!(".pending-{identity}"));
    fs::create_dir(&pending).map_err(|_| "Could not reserve download directory")?;
    save(&pending.join("manifest.json"), &manifest)?;
    save(&pending.join("source.tar"), &archive)?;
    let receipt = serde_json::json!({"format":"native-source-cache/1", "workspace_id":ws, "artifact_id":id,
        "manifest_sha256":manifest_hash,"cached_at_unix_seconds":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Invalid system time")?.as_secs(),
        "offline":"read_only_snapshot","authorization":"online_revalidation_required","extracted":false});
    save(
        &pending.join("receipt.json"),
        &serde_json::to_vec_pretty(&receipt).unwrap(),
    )?;
    let complete = root.join(format!("{manifest_hash}-{identity}"));
    fs::rename(&pending, &complete).map_err(|_| "Could not publish downloaded source")?;
    Ok(complete)
}

fn editor_copy(directory: &Path, root: &Path) -> Result<PathBuf, String> {
    plain_path(directory)?;
    plain_path(&directory.join("manifest.json"))?;
    plain_path(&directory.join("receipt.json"))?;
    let raw =
        fs::read(directory.join("manifest.json")).map_err(|_| "Missing downloaded manifest")?;
    let receipt: Value = serde_json::from_slice(
        &fs::read(directory.join("receipt.json")).map_err(|_| "Missing receipt")?,
    )
    .map_err(|_| "Invalid receipt")?;
    let expected = receipt["manifest_sha256"]
        .as_str()
        .ok_or("Missing receipt hash")?;
    check_hash(&raw, expected)?;
    plain_path(root)?;
    fs::create_dir_all(root).map_err(|_| "Could not create editor export directory")?;
    plain_path(root)?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Secure randomness unavailable")?;
    let entry = root.join(format!("{expected}-{}", uuid::Uuid::from_bytes(random)));
    fs::create_dir(&entry).map_err(|_| "Could not create editor export")?;
    let path = entry.join("manifest.json");
    save(&path, &raw)?;
    check_hash(
        &fs::read(&path).map_err(|_| "Could not verify editor export")?,
        expected,
    )?;
    Ok(path)
}

pub fn open_manifest(directory: &Path, root: &Path) -> Result<PathBuf, String> {
    let path = editor_copy(directory, root)?;
    show_manifest_editor(&path)?;
    Ok(path)
}

#[cfg(windows)]
fn show_manifest_editor(path: &Path) -> Result<(), String> {
    use std::{ffi::OsString, os::windows::ffi::OsStrExt};
    use windows::{
        core::{w, PCWSTR},
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
                COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            },
            UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
        },
    };
    // Activate the installed packaged app directly. The legacy executable alias
    // can leave headless forwarding processes. Pass only the re-hashed manifest.
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }
        .ok()
        .map_err(|_| "Could not initialize Windows editor activation")?;
    let result: windows::core::Result<()> = (|| unsafe {
        let manager: IApplicationActivationManager =
            CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)?;
        let mut argument = OsString::from("\"");
        argument.push(path);
        argument.push("\"");
        let arguments: Vec<u16> = argument.encode_wide().chain(Some(0)).collect();
        manager.ActivateApplication(
            w!("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"),
            PCWSTR(arguments.as_ptr()),
            AO_NONE,
        )?;
        Ok(())
    })();
    unsafe { CoUninitialize() };
    result.map_err(|e| format!("Could not activate packaged Notepad: {}", e.code()))
}

#[cfg(not(windows))]
fn show_manifest_editor(_: &Path) -> Result<(), String> {
    Err("Manifest editor requires the supported Windows desktop".into())
}

pub(crate) fn seed_probe_cookie(window: &WebviewWindow) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Native probes require a debug build".into());
    }
    let credential =
        std::env::var("CREATOR_NATIVE_PROBE_COOKIE").map_err(|_| "Missing fixture session")?;
    let (name, token) = credential
        .split_once('=')
        .ok_or("Invalid fixture session")?;
    if name != "creator_session"
        || token.len() != 43
        || !token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid fixture cookie".into());
    }
    window
        .set_cookie(
            tauri::webview::cookie::Cookie::build((name.to_owned(), token.to_owned()))
                .domain("127.0.0.1")
                .path("/")
                .http_only(true)
                .build(),
        )
        .map_err(|_| "Could not seed fixture native cookie")?;
    Ok(())
}

pub fn probe(window: WebviewWindow) -> Result<PathBuf, String> {
    seed_probe_cookie(&window)?;
    download(window)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires actual Windows editor observation and an explicit verified cache path"]
    fn native_editor_file_activation() {
        let cache =
            std::env::var_os("CREATOR_NATIVE_EDITOR_CACHE").expect("Set verified cache directory");
        let root =
            std::env::var_os("CREATOR_NATIVE_EDITOR_EXPORT").expect("Set editor export directory");
        open_manifest(Path::new(&cache), Path::new(&root))
            .expect("Native editor activation failed");
    }
    #[test]
    fn editor_exports_preserve_cache_and_refuse_changed_source() {
        let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.verification/native editor tests");
        fs::create_dir_all(&parent).unwrap();
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let root = parent.join(uuid::Uuid::from_bytes(random).to_string());
        let cache = root.join("cache");
        fs::create_dir_all(&cache).unwrap();
        let raw = b"{\"fixture\":true}";
        let expected = format!("{:x}", Sha256::digest(raw));
        fs::write(cache.join("manifest.json"), raw).unwrap();
        fs::write(
            cache.join("receipt.json"),
            serde_json::to_vec(&serde_json::json!({"manifest_sha256":expected})).unwrap(),
        )
        .unwrap();
        let export_root = root.join("editor copies with spaces");
        let copy = editor_copy(&cache, &export_root).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), raw);
        fs::write(copy, b"owner edit").unwrap();
        assert_eq!(fs::read(cache.join("manifest.json")).unwrap(), raw);
        let next = editor_copy(&cache, &export_root).unwrap();
        assert_eq!(fs::read(next).unwrap(), raw);
        fs::write(cache.join("manifest.json"), b"changed source").unwrap();
        assert!(editor_copy(&cache, &export_root).is_err());
        // Only this randomly created test subtree is removed.
        assert!(fs::canonicalize(&root)
            .unwrap()
            .starts_with(fs::canonicalize(&parent).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn hash_validation_rejects_tampering_and_malformed_hash() {
        let expected = format!("{:x}", Sha256::digest(b"source"));
        assert!(check_hash(b"source", &expected).is_ok());
        assert!(check_hash(b"tampered", &expected).is_err());
        assert!(check_hash(b"source", "../escape").is_err());
    }
}
