//! At-rest encryption for sensitive record content (PII). AES-256-GCM (AEAD), pure Rust — no
//! OpenSSL/SQLCipher native build. Content columns are stored as hex(nonce(12) || ciphertext+tag).
//! The key lives in the OS keychain (see `load_or_create_key`); tests pass a fixed key.
//! ponytail: column-level AEAD covers the PII at rest without the SQLCipher/OpenSSL/nasm toolchain;
//! whole-DB SQLCipher is a future hardening (needs nasm in Windows CI + a workspace rusqlite-feature fix).
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};

/// Encrypt plaintext -> hex(nonce(12) || ciphertext+tag). Fresh random nonce per call.
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| "encrypt failed".to_string())?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ct);
    Ok(hex::encode(blob))
}

/// Decrypt hex(nonce || ciphertext) -> plaintext. Fails on a wrong key or any tampering (AEAD tag).
pub fn decrypt(key: &[u8; 32], blob_hex: &str) -> Result<String, String> {
    let blob = hex::decode(blob_hex).map_err(|e| e.to_string())?;
    if blob.len() < 12 {
        return Err("ciphertext too short".into());
    }
    let (nonce, ct) = blob.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "decrypt failed (wrong key or tampered)".to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

/// Load the per-device content key from the OS keychain, creating it on first run.
/// App-only (not called in tests) — the keychain isn't available in CI.
pub fn load_or_create_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new("org.pursuit.siteassure", "db-content-key")
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(hex_key) => hex::decode(hex_key)
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "stored key has the wrong length".to_string()),
        Err(_) => {
            let mut key = [0u8; 32];
            getrandom::getrandom(&mut key).map_err(|e| e.to_string())?;
            entry
                .set_password(&hex::encode(key))
                .map_err(|e| e.to_string())?;
            Ok(key)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: [u8; 32] = [7u8; 32];

    #[test]
    fn round_trip() {
        let blob = encrypt(&KEY, "foreman spoke this on the roof").unwrap();
        assert_ne!(blob, "foreman spoke this on the roof"); // stored form is not plaintext
        assert_eq!(decrypt(&KEY, &blob).unwrap(), "foreman spoke this on the roof");
    }

    #[test]
    fn wrong_key_fails() {
        let blob = encrypt(&KEY, "secret").unwrap();
        assert!(decrypt(&[9u8; 32], &blob).is_err());
    }

    #[test]
    fn tampered_blob_fails() {
        let mut blob = encrypt(&KEY, "secret").unwrap();
        let last = blob.pop().unwrap();
        blob.push(if last == 'a' { 'b' } else { 'a' });
        assert!(decrypt(&KEY, &blob).is_err());
    }
}
