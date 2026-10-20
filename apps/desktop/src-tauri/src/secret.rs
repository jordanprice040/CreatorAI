//! Windows DPAPI (CurrentUser) storage for the installed studio's secrets (ADR-0041):
//! the database credential and the persisted sign-in. Files hold only DPAPI ciphertext,
//! bound to this Windows account and a per-purpose entropy; nothing is logged.
use std::path::{Path, PathBuf};

const ENTROPY_PREFIX: &str = "creator-agent-studio/1:";

#[cfg(windows)]
fn transform(data: &[u8], purpose: &str, protect: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let entropy_bytes = format!("{ENTROPY_PREFIX}{purpose}").into_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if protect {
            CryptProtectData(
                &input,
                windows::core::w!("Creator Agent studio secret"),
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| {
            if protect {
                "Windows could not protect the secret".to_string()
            } else {
                "Windows could not unlock a saved secret (another account or a damaged file)"
                    .to_string()
            }
        })?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
        Ok(bytes)
    }
}

#[cfg(not(windows))]
fn transform(_: &[u8], _: &str, _: bool) -> Result<Vec<u8>, String> {
    Err("OS-protected storage is implemented for Windows only".into())
}

pub struct Secrets {
    dir: PathBuf,
}

impl Secrets {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
        }
    }
    fn path(&self, name: &str) -> Result<PathBuf, String> {
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            return Err("Invalid secret name".into());
        }
        Ok(self.dir.join(format!("{name}.dpapi")))
    }
    pub fn save(&self, name: &str, value: &str) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|_| "Could not create the secrets folder")?;
        let sealed = transform(value.as_bytes(), name, true)?;
        let path = self.path(name)?;
        let tmp = path.with_extension("dpapi.tmp");
        std::fs::write(&tmp, sealed).map_err(|_| "Could not write a protected secret")?;
        std::fs::rename(&tmp, &path).map_err(|_| "Could not store a protected secret".into())
    }
    pub fn load(&self, name: &str) -> Result<Option<String>, String> {
        let path = self.path(name)?;
        let sealed = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not read a protected secret".into()),
        };
        let plain = transform(&sealed, name, false)?;
        String::from_utf8(plain)
            .map(Some)
            .map_err(|_| "A protected secret is damaged".into())
    }
    pub fn delete(&self, name: &str) -> Result<(), String> {
        match std::fs::remove_file(self.path(name)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Could not delete a protected secret".into()),
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn round_trips_and_binds_purpose_and_never_stores_plaintext() {
        let dir = std::env::temp_dir().join(format!(
            "creator-secret-{}",
            crate::studio::random_hex(8).unwrap()
        ));
        let s = Secrets::new(&dir);
        s.save("session", "token-value-123").unwrap();
        let raw = std::fs::read(dir.join("session.dpapi")).unwrap();
        assert!(!raw.windows(15).any(|w| w == b"token-value-123"));
        assert_eq!(
            s.load("session").unwrap().as_deref(),
            Some("token-value-123")
        );
        // Same ciphertext under another purpose's entropy does not open.
        std::fs::copy(dir.join("session.dpapi"), dir.join("database-url.dpapi")).unwrap();
        assert!(s.load("database-url").is_err());
        s.delete("session").unwrap();
        assert_eq!(s.load("session").unwrap(), None);
        assert!(s.save("../x", "y").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
