#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withTestPostgres } from './lib/postgres.mjs';
import { resolveRoot, root } from './lib/process.mjs';

// The "implement your own business" exercise from the removal tutorial: on a
// copy whose example was removed, add the smallest possible business module
// through the same public interfaces the example used — an owned migration,
// a module with its table registration, route and OpenAPI registration at
// the composition points, and a public-behavior test — then compile and run
// it. This is the executable proof that the template survives example
// removal with a working extension path.
//
//   node scripts/example-new-business.mjs --root /tmp/template-copy

const { values } = parseArgs({
  options: { root: { type: 'string', default: root } },
});
const copy = resolveRoot(values.root);
const manifest = JSON.parse(
  readFileSync(join(copy, 'examples/knowledge-base/manifest.json'), 'utf8'),
);
if (manifest.status !== 'removed')
  throw new Error(
    'the notes exercise runs on a copy whose example was removed (status: removed)',
  );

const libPath = join(copy, 'apps/api/src/lib.rs');
const lib = readFileSync(libPath, 'utf8');
if (lib.includes('modules::notes'))
  throw new Error('this copy already carries the notes exercise');

// The migration takes the next free number so both removal paths work:
// kept history and a trimmed fresh-database copy alike.
const migrations = readdirSync(join(copy, 'migrations'));
const next =
  Math.max(
    ...migrations.map((name) => Number(/^(\d{4})_/.exec(name)?.[1] ?? 0)),
  ) + 1;
const migration = String(next).padStart(4, '0');

const files = new Map([
  [
    `migrations/${migration}_notes.sql`,
    [
      '-- The exercise business owns its schema and tables; it may reference',
      '-- Core stable identifiers such as saas_core.users(id).',
      'CREATE SCHEMA notes;',
      'CREATE TABLE notes.notes (',
      '    id uuid PRIMARY KEY,',
      '    owner_id uuid NOT NULL REFERENCES saas_core.users (id),',
      '    body text NOT NULL,',
      '    created_at timestamptz NOT NULL DEFAULT now()',
      ');',
      '',
    ].join('\n'),
  ],
  [
    'crates/app/src/modules/notes/module.json',
    `${JSON.stringify({ kind: 'business', tables: ['notes.notes'] }, null, 2)}\n`,
  ],
  [
    'crates/app/src/modules/notes/mod.rs',
    [
      'use crate::http::{ApiErrorResponse, BoundedJson, RequestId};',
      'use crate::modules::identity;',
      'use axum::{',
      '    Extension, Json, Router,',
      '    extract::State,',
      '    http::{HeaderMap, StatusCode},',
      '    response::{IntoResponse, Response},',
      '    routing::post,',
      '};',
      'use saas_platform::config::AuthSettings;',
      'use serde::{Deserialize, Serialize};',
      'use sqlx::PgPool;',
      'use utoipa::{OpenApi, ToSchema};',
      '',
      '#[derive(Clone)]',
      'struct Notes {',
      '    pool: PgPool,',
      '    auth: AuthSettings,',
      '}',
      '',
      '#[derive(Deserialize, ToSchema)]',
      '#[serde(deny_unknown_fields)]',
      'pub struct CreateNote {',
      '    body: String,',
      '}',
      '',
      '// Identifiers stay strings and cast at the SQL boundary ($1::uuid,',
      '// RETURNING id::text) — the workspace sqlx has no uuid codec feature.',
      '#[derive(Serialize, ToSchema, sqlx::FromRow)]',
      'pub struct Note {',
      '    id: String,',
      '    body: String,',
      '}',
      '',
      '#[utoipa::path(post, path = "/api/v1/notes", operation_id = "createNote", tag = "Notes", request_body = CreateNote, params(("x-csrf-token" = String, Header)), responses((status = 201, body = Note), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]',
      'async fn create_note(',
      '    State(state): State<Notes>,',
      '    Extension(id): Extension<RequestId>,',
      '    headers: HeaderMap,',
      '    BoundedJson(input): BoundedJson<CreateNote>,',
      ') -> Response {',
      '    let actor =',
      '        match identity::require_session(&state.pool, &state.auth, &headers, &id, true).await',
      '        {',
      '            Ok(session) => session.user,',
      '            Err(response) => return response,',
      '        };',
      '    let note = sqlx::query_as::<_, Note>(',
      '        "INSERT INTO notes.notes (id, owner_id, body) VALUES ($1::uuid, $2::uuid, $3) RETURNING id::text, body",',
      '    )',
      '    .bind(uuid::Uuid::now_v7().to_string())',
      '    .bind(&actor.id)',
      '    .bind(input.body)',
      '    .fetch_one(&state.pool)',
      '    .await',
      '    .expect("note insert");',
      '    (StatusCode::CREATED, Json(note)).into_response()',
      '}',
      '',
      '#[utoipa::path(get, path = "/api/v1/notes", operation_id = "listNotes", tag = "Notes", responses((status = 200, body = [Note]), (status = 401, body = ApiErrorResponse)))]',
      'async fn list_notes(',
      '    State(state): State<Notes>,',
      '    Extension(id): Extension<RequestId>,',
      '    headers: HeaderMap,',
      ') -> Response {',
      '    let actor =',
      '        match identity::require_session(&state.pool, &state.auth, &headers, &id, false).await',
      '        {',
      '            Ok(session) => session.user,',
      '            Err(response) => return response,',
      '        };',
      '    let notes = sqlx::query_as::<_, Note>(',
      '        "SELECT id::text, body FROM notes.notes WHERE owner_id = $1::uuid ORDER BY id",',
      '    )',
      '    .bind(&actor.id)',
      '    .fetch_all(&state.pool)',
      '    .await',
      '    .expect("note listing");',
      '    Json(notes).into_response()',
      '}',
      '',
      '#[derive(OpenApi)]',
      '#[openapi(paths(create_note, list_notes))]',
      'struct NotesApi;',
      '',
      'pub fn openapi() -> utoipa::openapi::OpenApi {',
      '    NotesApi::openapi()',
      '}',
      '',
      'pub fn router(pool: PgPool, auth: AuthSettings) -> Router {',
      '    Router::new()',
      '        .route("/api/v1/notes", post(create_note).get(list_notes))',
      '        .with_state(Notes { pool, auth })',
      '}',
      '',
    ].join('\n'),
  ],
  [
    'apps/api/tests/notes.rs',
    [
      'use axum::{',
      '    Router,',
      '    body::Body,',
      '    http::{Request, StatusCode},',
      '    response::Response,',
      '};',
      'use http_body_util::BodyExt;',
      'use serde_json::{Value, json};',
      'use sqlx::PgPool;',
      'use tower::ServiceExt;',
      '',
      'struct Browser {',
      '    cookie: String,',
      '    csrf: String,',
      '}',
      '',
      'async fn json_body(response: Response) -> Value {',
      '    serde_json::from_slice(',
      '        &response.into_body().collect().await.unwrap().to_bytes(),',
      '    )',
      '    .unwrap()',
      '}',
      '',
      'async fn register(app: &Router, email: &str) -> Browser {',
      '    let response = app',
      '        .clone()',
      '        .oneshot(',
      '            Request::post("/api/v1/auth/register")',
      '                .header("origin", "http://127.0.0.1:5173")',
      '                .header("content-type", "application/json")',
      '                .body(Body::from(',
      '                    json!({"email":email,"password":"a-long-test-password"}).to_string(),',
      '                ))',
      '                .unwrap(),',
      '        )',
      '        .await',
      '        .unwrap();',
      '    assert_eq!(response.status(), StatusCode::CREATED);',
      '    let cookie = response.headers()["set-cookie"]',
      '        .to_str()',
      '        .unwrap()',
      "        .split(';')",
      '        .next()',
      '        .unwrap()',
      '        .to_owned();',
      '    let csrf = json_body(response).await["csrf_token"]',
      '        .as_str()',
      '        .unwrap()',
      '        .into();',
      '    Browser { cookie, csrf }',
      '}',
      '',
      'async fn post_note(app: &Router, actor: &Browser, body: &str) -> Response {',
      '    app.clone()',
      '        .oneshot(',
      '            Request::post("/api/v1/notes")',
      '                .header("origin", "http://127.0.0.1:5173")',
      '                .header("cookie", &actor.cookie)',
      '                .header("x-csrf-token", &actor.csrf)',
      '                .header("content-type", "application/json")',
      '                .body(Body::from(json!({"body":body}).to_string()))',
      '                .unwrap(),',
      '        )',
      '        .await',
      '        .unwrap()',
      '}',
      '',
      'async fn get_notes(app: &Router, actor: &Browser) -> Response {',
      '    app.clone()',
      '        .oneshot(',
      '            Request::get("/api/v1/notes")',
      '                .header("cookie", &actor.cookie)',
      '                .body(Body::empty())',
      '                .unwrap(),',
      '        )',
      '        .await',
      '        .unwrap()',
      '}',
      '',
      '// The exercise contract: after the example is gone, a new business module',
      '// reaches production through the same public interfaces.',
      '#[sqlx::test(migrations = "../../migrations")]',
      'async fn a_new_business_module_serves_its_own_resource(pool: PgPool) {',
      '    let app = saas_api::router(pool, Default::default());',
      '    let actor = register(&app, "notes-owner@example.com").await;',
      '    let created = post_note(&app, &actor, "my first note").await;',
      '    assert_eq!(created.status(), StatusCode::CREATED);',
      '    let listed = json_body(get_notes(&app, &actor).await).await;',
      '    assert_eq!(listed[0]["body"], "my first note");',
      '}',
      '',
    ].join('\n'),
  ],
]);

function insertAfter(content, anchor, addition) {
  const index = content.indexOf(anchor);
  if (index < 0)
    throw new Error(
      `composition point not found; this copy does not match a fresh post-removal template:\n${anchor}`,
    );
  return content.replace(anchor, `${anchor}${addition}`);
}

function replaceOnce(content, from, to) {
  if (!content.includes(from))
    throw new Error(
      `composition point not found; this copy does not match a fresh post-removal template:\n${from}`,
    );
  return content.replace(from, to);
}

// Module declaration: a business module joins the same registry the
// example used. The declaration outlives removal because it is not part of
// any example marker block.
const modulesModPath = join(copy, 'crates/app/src/modules/mod.rs');
const modulesMod = readFileSync(modulesModPath, 'utf8');
writeFileSync(
  modulesModPath,
  insertAfter(modulesMod, 'pub mod organization;\n', 'pub mod notes;\n'),
);

let updatedLib = lib;
// Router registration at the post-removal composition points.
updatedLib = insertAfter(
  updatedLib,
  '    let key_scopes = saas_app::modules::api_keys::core_scopes();\n    let domain_routes = Router::new();\n',
  '    let domain_routes = domain_routes.merge(saas_app::modules::notes::router(pool.clone(), auth.clone()));\n',
);
updatedLib = insertAfter(
  updatedLib,
  '    let routes = Router::new();\n',
  '    let routes = routes.merge(saas_app::modules::notes::router(pool.clone(), auth.clone()));\n',
);
// OpenAPI registration.
updatedLib = replaceOnce(
  updatedLib,
  '    let document = saas_app::openapi();\n',
  '    let mut document = saas_app::openapi();\n    document.merge(saas_app::modules::notes::openapi());\n',
);

for (const [path, content] of files) {
  mkdirSync(join(copy, path, '..'), { recursive: true });
  writeFileSync(join(copy, path), content);
}
writeFileSync(libPath, updatedLib);

console.log(
  [
    'Notes exercise applied:',
    `- migration migrations/${migration}_notes.sql owns the notes schema`,
    '- module crates/app/src/modules/notes with its table registration',
    '- routes and OpenAPI registered in apps/api/src/lib.rs',
    '- behavior test apps/api/tests/notes.rs',
  ].join('\n'),
);

const run = (command, args, env = process.env) =>
  execFileSync(command, args, { cwd: copy, stdio: 'inherit', env });

// The behavior test uses #[sqlx::test], which provisions a database per test
// and needs a PostgreSQL to talk to — the same throwaway instance the
// template's own backend suite borrows from scripts/lib/postgres.mjs.
await withTestPostgres(({ url }) => {
  run('cargo', ['fmt', '--all']);
  run(
    'cargo',
    [
      'test',
      '--locked',
      '-p',
      'saas-api',
      '--test',
      'notes',
      '--',
      '--nocapture',
    ],
    { ...process.env, DATABASE_URL: url },
  );
  run('cargo', [
    'clippy',
    '--locked',
    '--workspace',
    '--all-targets',
    '--',
    '-D',
    'warnings',
  ]);
});
console.log(
  'The new business module serves its resource through the public interfaces.',
);
