use sqlx::PgConnection;

/// Appending through the caller's transaction keeps the audit and mutation atomic.
pub async fn append(
    connection: &mut PgConnection,
    actor_id: &str,
    action: &str,
    resource_id: &str,
    request_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO saas_core.audit_events (id, actor_id, action, resource_id, request_id) VALUES ($1::uuid, $2::uuid, $3, $4, $5)")
        .bind(uuid::Uuid::now_v7().to_string()).bind(actor_id).bind(action).bind(resource_id).bind(request_id)
        .execute(connection).await?;
    Ok(())
}
