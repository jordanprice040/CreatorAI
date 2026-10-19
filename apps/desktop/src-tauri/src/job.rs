use crate::download::{bytes, local_client, selected};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::WebviewWindow;

pub fn queue(
    window: WebviewWindow,
    requests: &mut HashMap<String, String>,
) -> Result<String, String> {
    let (workspace, artifact) = selected(&window)?;
    let (client, credential) = local_client(&window)?;
    let base = "http://127.0.0.1:4310/api";
    let get = |path: &str| -> Result<Value, String> {
        let raw = bytes(
            client
                .get(format!("{base}/{path}"))
                .header("Cookie", &credential)
                .send()
                .map_err(|_| "Studio unavailable")?,
            262144,
        )?;
        serde_json::from_slice(&raw).map_err(|_| "Invalid studio response".into())
    };
    let session = get("auth/session")?;
    let csrf = session["csrf_token"]
        .as_str()
        .ok_or("Missing CSRF binding")?;
    if csrf.len() != 43
        || !csrf
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Invalid session binding".into());
    }
    let devices = get("desktop/devices")?;
    let active: Vec<_> = devices
        .as_array()
        .ok_or("Invalid worker list")?
        .iter()
        .filter(|d| {
            d["kind"] == "worker"
                && d["state"] == "active"
                && d["workspace_id"] == workspace
                && d["capabilities"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|c| c == "artifact.run"))
        })
        .collect();
    if active.len() != 1 {
        return Err("Start exactly one execution worker in this workspace, or choose a worker in Desktop and workers".into());
    }
    let device = active[0]["id"].as_str().ok_or("Missing worker identity")?;
    uuid::Uuid::parse_str(device).map_err(|_| "Invalid worker identity")?;
    let detail = get(&format!("workspaces/{workspace}/artifacts/{artifact}"))?;
    let manifest = detail["artifact"]["manifest_sha256"]
        .as_str()
        .ok_or("Missing artifact hash")?;
    if manifest.len() != 64 || !manifest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid artifact hash".into());
    }
    let key = format!("{workspace}/{artifact}/{device}/{manifest}");
    let request_id = if let Some(id) = requests.get(&key) {
        id.clone()
    } else {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Secure randomness unavailable")?;
        random[6] = (random[6] & 15) | 64;
        random[8] = (random[8] & 63) | 128;
        let id = uuid::Uuid::from_bytes(random).to_string();
        requests.insert(key, id.clone());
        id
    };
    let response = client.post(format!("{base}/desktop/devices/{device}/jobs")).header("Cookie", &credential).header("X-CSRF-Token", csrf)
        .json(&json!({"request_id":request_id,"artifact_id":artifact,"manifest_sha256":manifest,"input":{"args":[],"stdin":""}}))
        .send().map_err(|_| "Job response unknown; retry this menu action with the same selection to reuse its request identity")?;
    let result: Value =
        serde_json::from_slice(&bytes(response, 65536)?).map_err(|_| "Invalid job response")?;
    let id = result["id"].as_str().ok_or("Missing job identity")?;
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid job identity")?;
    Ok(id.to_owned())
}

pub fn probe(window: WebviewWindow) -> Result<String, String> {
    crate::download::seed_probe_cookie(&window)?;
    queue(window, &mut HashMap::new())
}
