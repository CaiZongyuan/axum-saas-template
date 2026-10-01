import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { root } from './lib/process.mjs';

const copy = mkdtempSync(join(tmpdir(), 'dougong-module-'));
try {
  const archive = join(copy, '.source.tar');
  execFileSync('git', ['archive', '--output', archive, 'HEAD'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', copy]);
  const backendPaths = [
    'apps/api',
    'apps/worker',
    'crates',
    'migrations',
    'examples/tutorial-tickets',
    '.cargo',
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
  ];
  for (const path of backendPaths)
    rmSync(join(copy, path), { recursive: true, force: true });
  const files = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...backendPaths,
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  for (const file of new Set(files)) {
    const target = join(copy, file);
    if (existsSync(join(root, file))) {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, file), target);
    }
  }
  const module = join(copy, 'crates/app/src/modules/tickets');
  mkdirSync(module, { recursive: true });
  writeFileSync(
    join(module, 'mod.rs'),
    readFileSync(join(root, 'examples/tutorial-tickets/preview.rs')),
  );
  writeFileSync(
    join(module, 'module.json'),
    JSON.stringify({ kind: 'business', tables: [] }),
  );
  const declaration = join(copy, 'crates/app/src/modules/mod.rs');
  writeFileSync(
    declaration,
    readFileSync(declaration, 'utf8') + '\npub mod tickets;\n',
  );

  const entry = join(copy, 'apps/api/src/lib.rs');
  let source = readFileSync(entry, 'utf8');
  const additions = [
    [
      '    saas_app::compose_routes_with_options(',
      '    let domain_routes = domain_routes.merge(saas_app::modules::tickets::router());\n',
    ],
    [
      '    Ok(saas_app::compose_routes_with_options(',
      '    let routes = routes.merge(saas_app::modules::tickets::router());\n',
    ],
    [
      '    saas_app::modules::rate_limit::describe(document)',
      '    let mut document = document;\n    document.merge(saas_app::modules::tickets::openapi());\n',
    ],
  ];
  for (const [anchor, addition] of additions) {
    if (
      !source.includes(anchor) ||
      source.indexOf(anchor) !== source.lastIndexOf(anchor)
    )
      throw new Error(`Tutorial composition point changed: ${anchor.trim()}`);
    source = source.replace(anchor, addition + anchor);
  }
  writeFileSync(entry, source);
  writeFileSync(
    join(copy, 'apps/api/tests/tutorial_steps.rs'),
    `
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn the_documented_module_steps_work_in_both_application_entries() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused").unwrap();
    let auth = saas_platform::config::AuthSettings::default();
    for app in [saas_api::router(pool.clone(), auth.clone()),
                saas_api::configured_router(pool.clone(), auth.clone(), None).unwrap()] {
        let response = app.clone().oneshot(Request::get("/api/v1/tickets/preview")
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), 200);
        assert!(response.headers().contains_key("x-request-id"));
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json, serde_json::json!({"title":"First ticket","status":"open"}));
        let response = app.oneshot(Request::get("/api/openapi.json")
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let contract: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(contract["paths"]["/api/v1/tickets/preview"]["get"]["operationId"], "previewTicket");
    }
}
`,
  );
  // Verify teaching edits without inheriting an operator's application settings.
  const env = { ...process.env };
  for (const key of Object.keys(
    parseEnv(readFileSync(join(root, '.env.example'), 'utf8')),
  ))
    delete env[key];
  execFileSync(
    'cargo',
    ['test', '--locked', '-p', 'saas-api', '--test', 'tutorial_steps'],
    {
      cwd: copy,
      stdio: 'inherit',
      env: {
        ...env,
        CARGO_TARGET_DIR: join(root, 'target'),
        CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
      },
    },
  );
  console.log(
    'Documented module declaration, both Routers and OpenAPI verified in a temporary copy.',
  );
} finally {
  rmSync(copy, { recursive: true, force: true });
}
