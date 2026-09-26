use argon2::password_hash::rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

/// 256 unpredictable bits for opaque credentials; never put these values in telemetry.
pub(crate) fn secret() -> Result<String, ()> {
    let mut bytes = [0u8; 32];
    OsRng.try_fill_bytes(&mut bytes).map_err(|_| ())?;
    Ok(hex::encode(bytes))
}
pub(crate) fn secret_hash(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}
