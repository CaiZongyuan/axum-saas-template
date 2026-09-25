mod crypto;

use crate::{
    http::{BoundedJson, RequestId, public_error},
    modules::{
        audit,
        organization::{self, MemberRole},
    },
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use saas_platform::config::AuthSettings;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use utoipa::ToSchema;

#[derive(Clone)]
struct Identity {
    pool: PgPool,
    settings: AuthSettings,
    password_slots: Arc<Semaphore>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    email: String,
    password: String,
    display_name: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Login {
    email: String,
    password: String,
}

#[derive(Serialize, ToSchema)]
pub struct CurrentUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub role: MemberRole,
}

#[derive(Serialize, ToSchema)]
pub struct CurrentSession {
    pub user: CurrentUser,
    pub csrf_token: String,
}

pub fn router(pool: PgPool, settings: AuthSettings) -> Router {
    Router::new()
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/session", get(current_session))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response
                    .headers_mut()
                    .insert("cache-control", HeaderValue::from_static("no-store"));
                response
            },
        ))
        .with_state(Identity {
            pool,
            settings,
            password_slots: Arc::new(Semaphore::new(4)),
        })
}

fn failure(id: &RequestId) -> Response {
    public_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "auth.unavailable",
        "Authentication is temporarily unavailable",
        id.clone(),
    )
}

fn unauthorized(id: RequestId) -> Response {
    public_error(
        StatusCode::UNAUTHORIZED,
        "auth.unauthorized",
        "Sign in to continue",
        id,
    )
}

fn origin_rejection(
    settings: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
) -> Option<Response> {
    if headers.get("origin").and_then(|value| value.to_str().ok()) == Some(&settings.origin) {
        None
    } else {
        Some(public_error(
            StatusCode::FORBIDDEN,
            "auth.origin",
            "Request origin is not trusted",
            id.clone(),
        ))
    }
}

#[utoipa::path(post, path = "/api/v1/auth/login", operation_id = "loginUser", tag = "Identity", request_body = Login, responses((status = 200, body = CurrentSession), (status = 400, body = crate::http::ApiErrorResponse), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 408, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn login(
    State(state): State<Identity>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    BoundedJson(input): BoundedJson<Login>,
) -> Response {
    if let Some(response) = origin_rejection(&state.settings, &headers, &id) {
        return response;
    }
    if input.email.len() > 254 || input.password.chars().count() > 128 {
        return public_error(
            StatusCode::BAD_REQUEST,
            "auth.invalid_input",
            "Credentials exceed the allowed length",
            id,
        );
    }
    let lookup = sqlx::query_as::<_, (String, String, Option<String>, String)>("SELECT u.id::text, u.email, u.display_name, c.password_hash FROM saas_core.users u JOIN saas_core.credentials c ON c.user_id = u.id WHERE u.normalized_email = $1")
        .bind(input.email.trim().to_lowercase()).fetch_optional(&state.pool);
    let record = match tokio::time::timeout(Duration::from_secs(3), lookup).await {
        Ok(Ok(record)) => record,
        _ => return failure(&id),
    };
    let hash = record.as_ref().map(|record| record.3.clone());
    let Ok(permit) = state.password_slots.clone().try_acquire_owned() else {
        return failure(&id);
    };
    let work = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        crypto::verify_password(input.password, hash)
    });
    let valid = match tokio::time::timeout(Duration::from_secs(5), work).await {
        Ok(Ok(valid)) => valid,
        _ => return failure(&id),
    };
    let invalid = || {
        public_error(
            StatusCode::UNAUTHORIZED,
            "auth.invalid_credentials",
            "Email or password is incorrect",
            id.clone(),
        )
    };
    if !valid {
        return invalid();
    }
    let Some((user_id, email, display_name, _)) = record else {
        return invalid();
    };
    let role = match tokio::time::timeout(
        Duration::from_secs(3),
        organization::active_role(&state.pool, &user_id),
    )
    .await
    {
        Ok(Ok(Some(role))) => role,
        Ok(Ok(None)) => return invalid(),
        _ => return failure(&id),
    };
    let user = CurrentUser {
        id: user_id,
        email,
        display_name,
        role,
    };
    match tokio::time::timeout(Duration::from_secs(2), issue_session(&state, user)).await {
        Ok(Ok((cookie, session))) => ([("set-cookie", cookie)], Json(session)).into_response(),
        _ => failure(&id),
    }
}

#[utoipa::path(post, path = "/api/v1/auth/register", operation_id = "registerUser", tag = "Identity", request_body = Registration, responses((status = 201, body = CurrentSession), (status = 400, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 408, body = crate::http::ApiErrorResponse), (status = 409, body = crate::http::ApiErrorResponse), (status = 413, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn register(
    State(state): State<Identity>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    BoundedJson(input): BoundedJson<Registration>,
) -> Response {
    if let Some(response) = origin_rejection(&state.settings, &headers, &id) {
        return response;
    }
    let email = input.email.trim().to_owned();
    let display_name = input
        .display_name
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty());
    if email.len() > 254
        || !email_address::EmailAddress::is_valid(&email)
        || !(12..=128).contains(&input.password.chars().count())
        || display_name
            .as_ref()
            .is_some_and(|name| name.chars().count() > 80)
    {
        return public_error(
            StatusCode::BAD_REQUEST,
            "auth.invalid_input",
            "Use a valid email, a 12–128 character password and a name up to 80 characters",
            id,
        );
    }
    let Ok(permit) = state.password_slots.clone().try_acquire_owned() else {
        return failure(&id);
    };
    let hashed = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        crypto::hash_password(input.password)
    });
    let hash = match tokio::time::timeout(Duration::from_secs(5), hashed).await {
        Ok(Ok(Ok(hash))) => hash,
        _ => return failure(&id),
    };
    create_account(&state, email, display_name, hash, &id).await
}

async fn create_account(
    state: &Identity,
    email: String,
    display_name: Option<String>,
    password_hash: String,
    id: &RequestId,
) -> Response {
    let user_id = uuid::Uuid::now_v7().to_string();
    let transaction = async {
        let mut tx = state.pool.begin().await?;
        sqlx::query("INSERT INTO saas_core.users (id, email, normalized_email, display_name) VALUES ($1::uuid, $2, $3, $4)")
            .bind(&user_id).bind(&email).bind(email.to_lowercase()).bind(&display_name).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO saas_core.credentials (user_id, password_hash) VALUES ($1::uuid, $2)",
        )
        .bind(&user_id)
        .bind(&password_hash)
        .execute(&mut *tx)
        .await?;
        let role = organization::enroll(&mut tx, &user_id).await?;
        audit::append(&mut tx, &user_id, "identity.register", &user_id, &id.0).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(role)
    };
    let result = match tokio::time::timeout(Duration::from_secs(3), transaction).await {
        Ok(result) => result,
        Err(_) => return failure(id),
    };
    let role = match result {
        Ok(role) => role,
        Err(error)
            if error.as_database_error().is_some_and(|error| {
                error.is_unique_violation()
                    && error.constraint() == Some("users_normalized_email_key")
            }) =>
        {
            return public_error(
                StatusCode::CONFLICT,
                "auth.email_exists",
                "An account already uses this email",
                id.clone(),
            );
        }
        Err(_) => return failure(id),
    };
    let user = CurrentUser {
        id: user_id,
        email,
        display_name,
        role,
    };
    match tokio::time::timeout(Duration::from_secs(2), issue_session(state, user)).await {
        Ok(Ok((cookie, session))) => {
            (StatusCode::CREATED, [("set-cookie", cookie)], Json(session)).into_response()
        }
        _ => public_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "auth.session_unavailable",
            "Account created; sign in later without registering again",
            id.clone(),
        ),
    }
}

fn cookie_name(settings: &AuthSettings) -> &'static str {
    if settings.secure_cookie {
        "__Host-saas_session"
    } else {
        "saas_session"
    }
}

fn cookie_secret<'a>(headers: &'a HeaderMap, settings: &AuthSettings) -> Option<&'a str> {
    let name = cookie_name(settings);
    headers
        .get("cookie")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(';')
                .filter_map(|part| part.trim().split_once('='))
                .find_map(|(key, value)| (key == name).then_some(value))
        })
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[utoipa::path(post, path = "/api/v1/auth/logout", operation_id = "logoutUser", tag = "Identity", params(("x-csrf-token" = String, Header, description = "CSRF token from the current session")), responses((status = 204), (status = 401, body = crate::http::ApiErrorResponse), (status = 403, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn logout(
    State(state): State<Identity>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = origin_rejection(&state.settings, &headers, &id) {
        return response;
    }
    let Some(secret) = cookie_secret(&headers, &state.settings) else {
        return unauthorized(id);
    };
    let csrf = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !crypto::verify_csrf(secret, csrf) {
        return public_error(
            StatusCode::FORBIDDEN,
            "auth.csrf",
            "Refresh the session before trying again",
            id,
        );
    }
    let revoke = sqlx::query("UPDATE saas_core.sessions SET revoked = true WHERE secret_hash = $1")
        .bind(crypto::secret_hash(secret))
        .execute(&state.pool);
    if !matches!(
        tokio::time::timeout(Duration::from_secs(3), revoke).await,
        Ok(Ok(_))
    ) {
        return failure(&id);
    }
    let expired = format!(
        "{}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{}",
        cookie_name(&state.settings),
        if state.settings.secure_cookie {
            "; Secure"
        } else {
            ""
        }
    );
    (StatusCode::NO_CONTENT, [("set-cookie", expired)]).into_response()
}

async fn issue_session(
    state: &Identity,
    user: CurrentUser,
) -> Result<(String, CurrentSession), ()> {
    let secret = crypto::secret()?;
    sqlx::query("INSERT INTO saas_core.sessions (id, secret_hash, user_id, expires_at) VALUES ($1::uuid, $2, $3::uuid, now() + make_interval(secs => $4))")
        .bind(uuid::Uuid::now_v7().to_string()).bind(crypto::secret_hash(&secret)).bind(&user.id)
        .bind(f64::from(state.settings.absolute_secs)).execute(&state.pool).await.map_err(|_| ())?;
    let cookie = format!(
        "{}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{}",
        cookie_name(&state.settings),
        secret,
        state.settings.absolute_secs,
        if state.settings.secure_cookie {
            "; Secure"
        } else {
            ""
        }
    );
    Ok((
        cookie,
        CurrentSession {
            user,
            csrf_token: crypto::csrf_token(&secret),
        },
    ))
}

#[utoipa::path(get, path = "/api/v1/auth/session", operation_id = "getCurrentSession", tag = "Identity", responses((status = 200, body = CurrentSession), (status = 401, body = crate::http::ApiErrorResponse), (status = 503, body = crate::http::ApiErrorResponse)))]
async fn current_session(
    State(state): State<Identity>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
) -> Response {
    match require_session(&state.pool, &state.settings, &headers, &id, false).await {
        Ok(session) => Json(session).into_response(),
        Err(response) => response,
    }
}

/// Public HTTP authentication interface shared by Core and removable domains.
pub async fn require_session(
    pool: &PgPool,
    settings: &AuthSettings,
    headers: &HeaderMap,
    id: &RequestId,
    mutation: bool,
) -> Result<CurrentSession, Response> {
    if mutation && let Some(response) = origin_rejection(settings, headers, id) {
        return Err(response);
    }
    let Some(secret) = cookie_secret(headers, settings) else {
        return Err(unauthorized(id.clone()));
    };
    if mutation
        && !headers
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|token| crypto::verify_csrf(secret, token))
    {
        return Err(public_error(
            StatusCode::FORBIDDEN,
            "auth.csrf",
            "Refresh the session before trying again",
            id.clone(),
        ));
    }
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        let row = sqlx::query_as::<_, (String, String, Option<String>)>("WITH active_session AS (UPDATE saas_core.sessions SET last_seen_at = now() WHERE secret_hash = $1 AND NOT revoked AND expires_at > now() AND last_seen_at > now() - make_interval(secs => $2) RETURNING user_id) SELECT u.id::text, u.email, u.display_name FROM active_session s JOIN saas_core.users u ON u.id = s.user_id")
            .bind(crypto::secret_hash(secret)).bind(f64::from(settings.idle_secs)).fetch_optional(pool).await?;
        let Some((user_id, email, display_name)) = row else { return Ok(None); };
        let role = organization::active_role(pool, &user_id).await?;
        Ok::<_, sqlx::Error>(role.map(|role| CurrentSession { user: CurrentUser { id: user_id, email, display_name, role }, csrf_token: crypto::csrf_token(secret) }))
    }).await;
    match result {
        Ok(Ok(Some(session))) => Ok(session),
        Ok(Ok(None)) => Err(unauthorized(id.clone())),
        _ => Err(failure(id)),
    }
}
