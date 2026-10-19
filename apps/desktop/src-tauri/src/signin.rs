use reqwest::blocking::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Read, time::Duration};
use tauri::{
    webview::cookie::{Cookie, SameSite},
    WebviewWindow,
};

const API: &str = "http://127.0.0.1:4310/api/desktop/";

fn response(mut r: reqwest::blocking::Response) -> Result<Value, String> {
    if !r.status().is_success() {
        return Err(format!("Desktop sign-in returned HTTP {}", r.status()));
    }
    let mut bytes = Vec::new();
    (&mut r)
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read desktop sign-in response")?;
    if bytes.len() > 65536 {
        return Err("Desktop sign-in response exceeded limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid desktop sign-in response".into())
}

pub fn sign_in(window: WebviewWindow) -> Result<(), String> {
    sign_in_with_browser(window, |browser_url| {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", browser_url])
            .spawn()
            .map_err(|_| "Could not open the system browser".to_string())?;
        Ok(())
    })
}

fn sign_in_with_browser(
    window: WebviewWindow,
    open_browser: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not create sign-in client")?;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Secure randomness unavailable")?;
    let proof: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let proof_hash = format!("{:x}", Sha256::digest(proof.as_bytes()));
    let challenge = response(
        client
            .post(format!("{API}challenges"))
            .json(&json!({
                "kind":"desktop_login", "proof_hash":proof_hash, "label":"Windows desktop",
                "workspace_id":null, "capabilities":[]
            }))
            .send()
            .map_err(|_| "Studio API unavailable on port 4310")?,
    )?;
    let id = challenge["id"]
        .as_str()
        .ok_or("Missing challenge identity")?;
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid challenge identity".into());
    }
    let code = &proof_hash[..8].to_uppercase();
    window
        .set_title(&format!("Compare sign-in code {code} in your browser"))
        .map_err(|_| "Window closed")?;
    // Only a fixed local origin plus a validated UUID reaches the OS browser; no shell parsing.
    let browser_url = format!("http://127.0.0.1:5173/api/desktop/approve?id={id}");
    open_browser(&browser_url)?;
    for _ in 0..120 {
        std::thread::sleep(Duration::from_secs(2));
        if window.url().is_err() {
            return Err("Desktop window closed".into());
        }
        let claimed = response(
            client
                .post(format!("{API}challenges/{id}/claim"))
                .json(&json!({"proof":proof}))
                .send()
                .map_err(|_| "Sign-in response unknown; start a new sign-in")?,
        )?;
        if claimed["state"] == "pending" {
            continue;
        }
        let token = claimed["token"]
            .as_str()
            .ok_or("Missing desktop credential")?;
        if token.len() != 43
            || !token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err("Invalid desktop credential".into());
        }
        let cookie_name = claimed["cookie"]["name"]
            .as_str()
            .ok_or("Missing session cookie policy")?;
        let secure = claimed["cookie"]["secure"]
            .as_bool()
            .ok_or("Missing cookie security policy")?;
        if cookie_name != "creator_session" && cookie_name != "__Host-creator_session" {
            return Err("Unsupported session cookie policy".into());
        }
        window
            .set_cookie(
                Cookie::build((cookie_name.to_owned(), token.to_owned()))
                    .domain("127.0.0.1")
                    .path("/")
                    .http_only(true)
                    .secure(secure)
                    .same_site(SameSite::Strict)
                    .build(),
            )
            .map_err(|_| "Could not store desktop session")?;
        window
            .set_title("Creator Agent — local studio")
            .map_err(|_| "Window closed")?;
        window
            .navigate("http://127.0.0.1:5173/".parse().unwrap())
            .map_err(|_| "Could not refresh studio")?;
        return Ok(());
    }
    Err("Sign-in timed out; start a new request".into())
}

pub fn probe(
    window: WebviewWindow,
    observed: std::sync::Arc<std::sync::Mutex<Option<String>>>,
) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("Native probes require a debug build".into());
    }
    // The test harness opens this URL in isolated Edge; production uses the OS handler above.
    sign_in_with_browser(window.clone(), |url| {
        println!("NATIVE_SIGNIN_APPROVAL_URL {url}");
        Ok(())
    })?;
    for _ in 0..100 {
        window.eval("fetch('/api/auth/session').then(async r=>{const v=await r.json();document.title='CREATOR_SIGNIN_PROBE:'+r.status+':'+(v.actor_id||'none')}).catch(()=>{document.title='CREATOR_SIGNIN_PROBE:failed'})").map_err(|_| "Could not inspect native session")?;
        std::thread::sleep(Duration::from_millis(100));
        if let Some(title) = observed
            .lock()
            .map_err(|_| "Native probe observation failed")?
            .clone()
        {
            if let Some(actor) = title.strip_prefix("CREATOR_SIGNIN_PROBE:200:") {
                uuid::Uuid::parse_str(actor).map_err(|_| "Invalid native session actor")?;
                return Ok(actor.to_owned());
            }
        }
    }
    Err("Native WebView did not authenticate with the claimed cookie".into())
}
