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
    router_with_cache(pool, auth, _files, Default::default())
}

pub fn router_with_cache(
    pool: PgPool,
    auth: AuthSettings,
    _files: Option<saas_app::modules::files::FileService>,
    cache: saas_platform::cache::Cache,
) -> Router {
    let key_scopes = saas_app::modules::api_keys::core_scopes();
    let domain_routes = Router::new();
    // example:knowledge:routes:start
    let mut key_scopes = key_scopes;
    key_scopes.push(saas_app::modules::knowledge::api_key_scope());
    let domain_routes = domain_routes.merge(saas_app::modules::knowledge::router_with_cache(
        pool.clone(),
        auth.clone(),
        _files,
        Default::default(),
        cache.clone(),
    ));
    // example:knowledge:routes:end
    saas_app::compose_routes_with_options(
        pool,
        auth,
        domain_routes,
        openapi(),
        saas_app::CoreOptions {
            api_key_scopes: key_scopes,
            cache,
        },
    )
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
    let cache = saas_platform::cache::Cache::from_env()?;
    let key_scopes = saas_app::modules::api_keys::core_scopes();
    let routes = Router::new();
    // example:knowledge:configured-routes:start
    let mut key_scopes = key_scopes;
    key_scopes.push(saas_app::modules::knowledge::api_key_scope());
    let policy = saas_app::modules::knowledge::ExportPolicy::from_env()?;
    let routes = routes.merge(saas_app::modules::knowledge::router_with_cache(
        pool.clone(),
        auth.clone(),
        _files,
        policy,
        cache.clone(),
    ));
    // example:knowledge:configured-routes:end
    Ok(saas_app::compose_routes_with_options(
        pool,
        auth,
        routes,
        openapi(),
        saas_app::CoreOptions {
            api_key_scopes: key_scopes,
            cache,
        },
    ))
}
