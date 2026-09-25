use axum::Router;
use saas_platform::config::AuthSettings;
use sqlx::PgPool;

pub fn router(pool: PgPool, auth: AuthSettings) -> Router {
    router_with_files(pool, auth, None)
}

pub fn router_with_files(
    pool: PgPool,
    auth: AuthSettings,
    _files: Option<saas_app::modules::files::FileService>,
) -> Router {
    let domain_routes = Router::new();
    // example:knowledge:routes:start
    let domain_routes = domain_routes.merge(saas_app::modules::knowledge::router_with_files(
        pool.clone(),
        auth.clone(),
        _files,
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

pub fn configured_router(
    pool: PgPool,
    auth: AuthSettings,
    _files: Option<saas_app::modules::files::FileService>,
) -> Result<Router, saas_platform::config::ConfigError> {
    let routes = Router::new();
    // example:knowledge:configured-routes:start
    let policy = saas_app::modules::knowledge::ExportPolicy::from_env()?;
    let routes = routes.merge(saas_app::modules::knowledge::router_with_policy(
        pool.clone(),
        auth.clone(),
        _files,
        policy,
    ));
    // example:knowledge:configured-routes:end
    Ok(saas_app::compose_routes(pool, auth, routes, openapi()))
}
