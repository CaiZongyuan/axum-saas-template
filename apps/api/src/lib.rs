use axum::Router;
use saas_platform::config::AuthSettings;
use sqlx::PgPool;

pub fn router(pool: PgPool, auth: AuthSettings) -> Router {
    let domain_routes = Router::new();
    // example:knowledge:routes:start
    let domain_routes = domain_routes.merge(saas_app::modules::knowledge::router(
        pool.clone(),
        auth.clone(),
    ));
    // example:knowledge:routes:end
    saas_app::compose_routes(pool, auth, domain_routes, openapi())
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    let document = saas_app::openapi();
    // example:knowledge:openapi:start
    let mut document = document;
    document.merge(saas_app::modules::knowledge::openapi());
    // example:knowledge:openapi:end
    document
}
