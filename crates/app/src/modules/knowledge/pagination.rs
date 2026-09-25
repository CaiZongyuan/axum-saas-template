use super::Failure;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Cursor {
    subject: String,
    scope: String,
    pub at: DateTime<Utc>,
    pub id: String,
}

impl Cursor {
    pub fn decode(token: &str, subject: &str) -> Result<Self, Failure> {
        if token.len() > 1024 {
            return Err(Failure::InvalidPage);
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(token)
            .map_err(|_| Failure::InvalidPage)?;
        let cursor: Self = serde_json::from_slice(&bytes).map_err(|_| Failure::InvalidPage)?;
        if cursor.subject != subject
            || cursor.scope != "personal-created-desc-v1"
            || uuid::Uuid::parse_str(&cursor.id).is_err()
        {
            return Err(Failure::InvalidPage);
        }
        Ok(cursor)
    }

    pub fn encode(subject: &str, at: DateTime<Utc>, id: &str) -> Result<String, Failure> {
        let cursor = Self {
            subject: subject.to_owned(),
            scope: "personal-created-desc-v1".into(),
            at,
            id: id.to_owned(),
        };
        Ok(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&cursor).map_err(|_| Failure::Unavailable)?))
    }
}
