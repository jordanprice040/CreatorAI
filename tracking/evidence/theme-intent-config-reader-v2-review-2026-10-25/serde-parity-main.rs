use serde::Deserialize;
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Db { mode: String, port: u16, name: String, user: String, label: String }
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cfg { format: String, database: Db, pg_bin: Option<String>, products_root: String, close_behavior: String, launch_at_login: bool, origin: serde_json::Value, created_at: String }
fn main() {
    let base = r#"{"format":"creator-desktop-config/1","database":{"mode":"managed","port":55455,"name":"n","user":"u","label":"l"},"pg_bin":"C:/b","products_root":"C:/p","close_behavior":"quit","launch_at_login":false,"origin":{},"created_at":"s"}"#;
    let mut bom = vec![0xEF, 0xBB, 0xBF]; bom.extend_from_slice(base.as_bytes());
    let dup = base.replace("\"port\":55455", "\"port\":1,\"port\":55455");
    let exp = base.replace("55455", "5.5455e4");
    for (n, b) in [("base", base.as_bytes().to_vec()), ("bom", bom), ("duplicate_port", dup.into_bytes()), ("exponent_port", exp.into_bytes())] {
        println!("{n}: {}", if serde_json::from_slice::<Cfg>(&b).is_ok() { "accepted" } else { "rejected" });
    }
}
