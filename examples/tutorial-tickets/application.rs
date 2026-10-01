use super::{Failure, Ticket, domain::Content};
use crate::modules::{
    audit, files, idempotency,
    organization::{self, MemberRole},
};
use sqlx::{PgConnection, PgPool};

const COLUMNS: &str =
    "id::text, created_by::text, title, description, status, version, created_at, updated_at";

pub(super) struct Change {
    pub content: Content,
    pub status: String,
    pub version: i64,
}

// region:authorization
pub(super) async fn authorized(
    connection: &mut PgConnection,
    actor_id: &str,
    ticket_id: &str,
    write: bool,
) -> Result<Ticket, Failure> {
    let role = organization::active_role_in(connection, actor_id)
        .await?
        .ok_or(Failure::Forbidden)?;
    let manager = matches!(role, MemberRole::Owner | MemberRole::Admin);
    let lock = if write { "FOR UPDATE" } else { "FOR SHARE" };
    sqlx::query_as(&format!("SELECT {COLUMNS} FROM support.tickets WHERE id = $1::uuid AND deleted_at IS NULL AND ($2 OR created_by = $3::uuid) {lock}"))
        .bind(ticket_id).bind(manager).bind(actor_id).fetch_optional(connection).await?.ok_or(Failure::NotFound)
}

// endregion:authorization
pub(super) async fn create(
    pool: &PgPool,
    actor_id: &str,
    content: Content,
    key: &str,
    request_id: &str,
) -> Result<Ticket, Failure> {
    let mut tx = pool.begin().await?;
    organization::active_role_in(&mut tx, actor_id)
        .await?
        .ok_or(Failure::Forbidden)?;
    // region:idempotent-create
    let fingerprint = idempotency::fingerprint(&(&content.title, &content.description))?;
    let attempt = idempotency::Attempt {
        actor_id,
        scope: "POST /api/v1/tickets",
        key,
        fingerprint: &fingerprint,
    };
    if let Some(saved) = idempotency::claim(&mut tx, &attempt).await? {
        let id = saved["ticket_id"].as_str().ok_or(Failure::Unavailable)?;
        let ticket = authorized(&mut tx, actor_id, id, false).await?;
        tx.commit().await?;
        return Ok(ticket);
    }
    // endregion:idempotent-create
    // region:create-transaction
    let ticket_id = uuid::Uuid::now_v7().to_string();
    let ticket = sqlx::query_as::<_, Ticket>(&format!("INSERT INTO support.tickets (id, created_by, title, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING {COLUMNS}"))
        .bind(&ticket_id).bind(actor_id).bind(content.title).bind(content.description).fetch_one(&mut *tx).await?;
    audit::append(
        &mut tx,
        audit::Event {
            actor_id,
            action: "tickets.create",
            resource_type: "tickets.ticket",
            resource_id: &ticket_id,
            source: audit::Source::Request(request_id),
            subject_user_id: None,
        },
    )
    .await?;
    idempotency::complete(
        &mut tx,
        &attempt,
        serde_json::json!({"ticket_id":ticket_id}),
    )
    .await?;
    tx.commit().await?;
    Ok(ticket)
    // endregion:create-transaction
}

pub(super) async fn read(
    pool: &PgPool,
    actor_id: &str,
    ticket_id: &str,
) -> Result<Ticket, Failure> {
    let mut tx = pool.begin().await?;
    let ticket = authorized(&mut tx, actor_id, ticket_id, false).await?;
    tx.commit().await?;
    Ok(ticket)
}

// region:version-update
pub(super) async fn update(
    pool: &PgPool,
    actor_id: &str,
    ticket_id: &str,
    change: Change,
    request_id: &str,
) -> Result<Ticket, Failure> {
    let mut tx = pool.begin().await?;
    authorized(&mut tx, actor_id, ticket_id, true).await?;
    let ticket = sqlx::query_as::<_, Ticket>(&format!("UPDATE support.tickets SET title = $1, description = $2, status = $3, version = version + 1, updated_at = now() WHERE id = $4::uuid AND version = $5 AND deleted_at IS NULL RETURNING {COLUMNS}"))
        .bind(change.content.title).bind(change.content.description).bind(change.status).bind(ticket_id).bind(change.version)
        .fetch_optional(&mut *tx).await?.ok_or(Failure::VersionConflict)?;
    audit::append(
        &mut tx,
        audit::Event {
            actor_id,
            action: "tickets.update",
            resource_type: "tickets.ticket",
            resource_id: ticket_id,
            source: audit::Source::Request(request_id),
            subject_user_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(ticket)
}

// endregion:version-update
pub(super) async fn list(
    pool: &PgPool,
    actor_id: &str,
    limit: u32,
) -> Result<Vec<Ticket>, Failure> {
    let mut tx = pool.begin().await?;
    let role = organization::active_role_in(&mut tx, actor_id)
        .await?
        .ok_or(Failure::Forbidden)?;
    let manager = matches!(role, MemberRole::Owner | MemberRole::Admin);
    let tickets = sqlx::query_as::<_, Ticket>(&format!("SELECT {COLUMNS} FROM support.tickets WHERE deleted_at IS NULL AND ($1 OR created_by = $2::uuid) ORDER BY id DESC LIMIT $3"))
        .bind(manager).bind(actor_id).bind(i64::from(limit)).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(tickets)
}

pub(super) async fn remove(
    pool: &PgPool,
    actor_id: &str,
    ticket_id: &str,
    request_id: &str,
) -> Result<(), Failure> {
    let mut tx = pool.begin().await?;
    authorized(&mut tx, actor_id, ticket_id, true).await?;
    let mut file_ids: Vec<String> = sqlx::query_scalar(
        "SELECT file_id::text FROM support.uploads WHERE ticket_id = $1::uuid ORDER BY file_id LIMIT 51",
    )
    .bind(ticket_id)
    .fetch_all(&mut *tx)
    .await?;
    let export_files: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT file_id::text FROM support.exports WHERE ticket_id = $1::uuid AND (snapshot IS NOT NULL OR file_id IS NOT NULL) ORDER BY id LIMIT 51 FOR UPDATE",
    )
    .bind(ticket_id)
    .fetch_all(&mut *tx)
    .await?;
    if file_ids.len() > 50 || export_files.len() > 50 {
        return Err(Failure::Unavailable);
    }
    file_ids.extend(export_files.into_iter().flatten());
    file_ids.sort_unstable();
    file_ids.dedup();
    for file_id in file_ids {
        files::mark_deleting(&mut tx, &file_id, request_id).await?;
    }
    sqlx::query("DELETE FROM support.uploads WHERE ticket_id = $1::uuid")
        .bind(ticket_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE support.exports SET snapshot = NULL, file_id = NULL, updated_at = now() WHERE ticket_id = $1::uuid AND (snapshot IS NOT NULL OR file_id IS NOT NULL)")
        .bind(ticket_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE support.tickets SET deleted_at = now(), version = version + 1, updated_at = now() WHERE id = $1::uuid")
        .bind(ticket_id).execute(&mut *tx).await?;
    audit::append(
        &mut tx,
        audit::Event {
            actor_id,
            action: "tickets.delete",
            resource_type: "tickets.ticket",
            resource_id: ticket_id,
            source: audit::Source::Request(request_id),
            subject_user_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
