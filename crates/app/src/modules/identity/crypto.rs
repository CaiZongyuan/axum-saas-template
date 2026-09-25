use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{
        SaltString,
        rand_core::{OsRng, RngCore},
    },
};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

pub fn hash_password(password: String) -> Result<String, ()> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ())
}

pub fn secret() -> Result<String, ()> {
    let mut bytes = [0u8; 32];
    OsRng.try_fill_bytes(&mut bytes).map_err(|_| ())?;
    Ok(hex::encode(bytes))
}

pub fn verify_password(password: String, stored: Option<String>) -> bool {
    if let Some(stored) = stored {
        PasswordHash::new(&stored).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
    } else {
        // Match the password-work cost even when the email does not exist.
        let salt = SaltString::encode_b64(b"saas-template-dummy").expect("fixed salt is valid");
        let _ = Argon2::default().hash_password(password.as_bytes(), &salt);
        false
    }
}

pub fn secret_hash(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}

pub fn csrf_token(secret: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(b"saas-session-csrf-v1");
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify_csrf(secret: &str, token: &str) -> bool {
    if token.len() != 64 {
        return false;
    }
    let Ok(bytes) = hex::decode(token) else {
        return false;
    };
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(b"saas-session-csrf-v1");
    mac.verify_slice(&bytes).is_ok()
}
