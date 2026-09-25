use super::{
    Document, DocumentPage, DocumentSummary, DocumentsQuery, Failure, domain::Content,
    pagination::Cursor,
};
use crate::modules::{
    audit, idempotency,
    identity::CurrentUser,
    organization::{self, MemberRole},
};
use sqlx::PgPool;

const COLUMNS: &str = "id::text, knowledge_base_id::text, title, markdown, version, created_by::text, updated_by::text, created_at, updated_at";

fn manager(role: MemberRole) -> bool {
    matches!(role, MemberRole::Owner | MemberRole::Admin)
}

pub(super) async fn create(
    pool: &PgPool,
    actor: &CurrentUser,
    content: Content,
    request_id: &str,
    key: &str,
) -> Result<Document, Failure> {
    let mut tx = pool.begin().await?;
    let role = organization::active_role_in(&mut tx, &actor.id)
        .await?
        .ok_or(Failure::Forbidden)?;
    let new_base = sqlx::query_scalar::<_, String>("INSERT INTO knowledge.knowledge_bases (id, name, personal_owner, created_by) VALUES ($1::uuid, '我的知识库', $2::uuid, $2::uuid) ON CONFLICT (personal_owner) DO NOTHING RETURNING id::text")
        .bind(uuid::Uuid::now_v7().to_string()).bind(&actor.id).fetch_optional(&mut *tx).await?;
    if let Some(base) = &new_base {
        sqlx::query("INSERT INTO knowledge.grants (knowledge_base_id, user_id, access) VALUES ($1::uuid, $2::uuid, 'editor')").bind(base).bind(&actor.id).execute(&mut *tx).await?;
        audit::append(
            &mut tx,
            &actor.id,
            "knowledge.base.create",
            base,
            request_id,
        )
        .await?;
        audit::append(
            &mut tx,
            &actor.id,
            "knowledge.grant.assign",
            base,
            request_id,
        )
        .await?;
    }
    let base: String = sqlx::query_scalar(
        "SELECT id::text FROM knowledge.knowledge_bases WHERE personal_owner = $1::uuid FOR SHARE",
    )
    .bind(&actor.id)
    .fetch_one(&mut *tx)
    .await?;
    let can_edit: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM knowledge.grants WHERE knowledge_base_id = $1::uuid AND user_id = $2::uuid AND access = 'editor')").bind(&base).bind(&actor.id).fetch_one(&mut *tx).await?;
    if !manager(role) && !can_edit {
        return Err(Failure::Forbidden);
    }
    let fingerprint = idempotency::fingerprint(&(&content.title, &content.markdown))?;
    let scope = format!("POST /api/v1/knowledge/documents:{base}");
    let attempt = idempotency::Attempt {
        actor_id: &actor.id,
        scope: &scope,
        key,
        fingerprint: &fingerprint,
    };
    if let Some(response) = idempotency::claim(&mut tx, &attempt).await? {
        let document = serde_json::from_value(response).map_err(|_| Failure::Unavailable)?;
        tx.commit().await?;
        return Ok(document);
    }
    let document = sqlx::query_as::<_, Document>(&format!("INSERT INTO knowledge.documents (id, knowledge_base_id, title, markdown, created_by, updated_by) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $5::uuid) RETURNING {COLUMNS}"))
        .bind(uuid::Uuid::now_v7().to_string()).bind(base).bind(content.title).bind(content.markdown).bind(&actor.id).fetch_one(&mut *tx).await?;
    audit::append(
        &mut tx,
        &actor.id,
        "knowledge.document.create",
        &document.id,
        request_id,
    )
    .await?;
    idempotency::complete(
        &mut tx,
        &attempt,
        serde_json::to_value(&document).map_err(|_| Failure::Unavailable)?,
    )
    .await?;
    tx.commit().await?;
    Ok(document)
}

pub(super) async fn read(
    pool: &PgPool,
    actor: &CurrentUser,
    id: uuid::Uuid,
) -> Result<Document, Failure> {
    let document = sqlx::query_as::<_, Document>(&format!("SELECT {COLUMNS} FROM knowledge.documents WHERE id = $1::uuid AND ($2 OR EXISTS (SELECT 1 FROM knowledge.grants g WHERE g.knowledge_base_id = documents.knowledge_base_id AND g.user_id = $3::uuid))"))
        .bind(id.to_string()).bind(manager(actor.role)).bind(&actor.id).fetch_optional(pool).await?;
    document.ok_or(Failure::NotFound)
}

pub(super) async fn list(
    pool: &PgPool,
    actor: &CurrentUser,
    query: DocumentsQuery,
) -> Result<DocumentPage, Failure> {
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Failure::InvalidPage);
    }
    let cursor = query
        .cursor
        .as_deref()
        .map(|token| Cursor::decode(token, &actor.id))
        .transpose()?;
    let mut data = sqlx::query_as::<_, DocumentSummary>("SELECT d.id::text, d.knowledge_base_id::text, d.title, d.version, d.created_at, d.updated_at FROM knowledge.documents d JOIN knowledge.knowledge_bases b ON b.id = d.knowledge_base_id WHERE b.personal_owner = $1::uuid AND ($2 OR EXISTS (SELECT 1 FROM knowledge.grants g WHERE g.knowledge_base_id = b.id AND g.user_id = $1::uuid)) AND ($3::timestamptz IS NULL OR (d.created_at, d.id) < ($3::timestamptz, $4::uuid)) ORDER BY d.created_at DESC, d.id DESC LIMIT $5")
        .bind(&actor.id).bind(manager(actor.role)).bind(cursor.as_ref().map(|cursor| cursor.at)).bind(cursor.as_ref().map(|cursor| cursor.id.as_str())).bind(i64::from(limit) + 1).fetch_all(pool).await?;
    let has_more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let next_cursor = if has_more {
        data.last()
            .map(|last| Cursor::encode(&actor.id, last.created_at, &last.id))
            .transpose()?
    } else {
        None
    };
    Ok(DocumentPage {
        data,
        next_cursor,
        has_more,
    })
}
