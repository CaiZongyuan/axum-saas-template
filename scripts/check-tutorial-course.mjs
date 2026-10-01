import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setupCourse } from './tutorial-course.mjs';
import { markdownTokens } from './lib/docs-content.mjs';
import { withTestPostgres } from './lib/postgres.mjs';
import { withTestRustfs } from './lib/rustfs.mjs';
import { root } from './lib/process.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'dougong-course-check-'));
const target = join(scratch, 'project');
const fixture = readFileSync(
  join(root, 'crates/app/tests/tutorial_course.rs'),
  'utf8',
);
const env = { ...process.env };
for (const key of Object.keys(
  parseEnv(readFileSync(join(root, '.env.example'), 'utf8')),
))
  delete env[key];
env.CARGO_TARGET_DIR =
  process.env.TUTORIAL_CARGO_TARGET_DIR ?? join(root, 'target/tutorial-course');
env.CARGO_BUILD_JOBS = process.env.CARGO_BUILD_JOBS ?? '4';

function cargo(args, services = {}) {
  execFileSync('cargo', ['test', '--locked', ...args], {
    cwd: target,
    stdio: 'inherit',
    env: { ...env, ...services },
  });
}

function writeRust(file, source) {
  const formatted = execFileSync(
    'rustfmt',
    ['--edition', '2024', '--config', 'skip_children=true', '--emit', 'stdout'],
    { input: source, encoding: 'utf8' },
  );
  writeFileSync(join(target, file), formatted);
}

function courseTests(stage) {
  const declaration =
    '#[path = "../../../examples/tutorial-tickets/mod.rs"]\nmod tickets;';
  if (!fixture.includes(declaration))
    throw new Error('Course fixture module declaration changed');
  let source = fixture.replace(declaration, 'use saas_app::modules::tickets;');
  const start = source.indexOf('async fn install_course(');
  const end = source.indexOf('// region:crud-test', start);
  if (start < 0 || end < 0)
    throw new Error('Course test installation boundaries changed');
  // Checkpoint migrations are already part of the real embedded ledger.
  source =
    source.slice(0, start) +
    'async fn install_course(_: &PgPool) {}\n\n' +
    source.slice(end);
  const boundary = {
    crud: 'async fn storage_application(',
    files: 'async fn export_request(',
  }[stage];
  if (boundary) {
    const end = source.indexOf(boundary);
    if (end < 0)
      throw new Error('Course stage test boundary changed: ' + stage);
    source = source.slice(0, end);
  }
  return source;
}

function entryTests(stage) {
  const path =
    stage === 'module' ? '/api/v1/tickets/preview' : '/api/v1/tickets';
  const operation = stage === 'module' ? 'previewTicket' : 'listTickets';
  const status = stage === 'module' ? 200 : 401;
  return `
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[sqlx::test(migrations = "../../migrations")]
async fn checkpoint_is_registered_in_both_api_entries(pool: sqlx::PgPool) {
    let auth = saas_platform::config::AuthSettings::default();
    for app in [saas_api::router(pool.clone(), auth.clone()),
                saas_api::configured_router(pool.clone(), auth.clone(), None).unwrap()] {
        let ready = app.clone().oneshot(Request::get("/health/ready").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(ready.status(), 200);
        let response = app.clone().oneshot(Request::get("${path}").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), ${status});
        assert!(response.headers().contains_key("x-request-id"));
        let response = app.oneshot(Request::get("/api/openapi.json").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let contract: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(contract["paths"]["${path}"]["get"]["operationId"], "${operation}");
    }
}
`;
}

function installGuideExamples() {
  const examples = ['13-export-notifications', '14-audit-history'].flatMap(
    (chapter, index) =>
      ['md', 'en.md'].map((locale, variant) => {
        const content = readFileSync(
          join(root, 'docs/tutorials', chapter + '.' + locale),
          'utf8',
        );
        const code = markdownTokens(content).filter(
          (token) => token.type === 'fence' && token.info === 'rust',
        );
        if (code.length !== 1)
          throw new Error(
            'Expected one complete Rust function in ' + chapter + '.' + locale,
          );
        return `pub mod example_${index}_${variant} {\n${code[0].content}\n}`;
      }),
  );
  writeRust('crates/app/src/documentation_examples.rs', examples.join('\n'));
  const library = join(target, 'crates/app/src/lib.rs');
  writeRust(
    'crates/app/src/lib.rs',
    readFileSync(library, 'utf8') + '\npub mod documentation_examples;\n',
  );
}

try {
  await withTestPostgres(async ({ url }) => {
    await withTestRustfs(async ({ env: storage }) => {
      const services = { DATABASE_URL: url, ...storage };
      for (const stage of ['module', 'crud', 'files', 'jobs']) {
        await setupCourse({ targetRoot: target, stage });
        if (stage === 'jobs') installGuideExamples();
        writeRust('apps/api/tests/course_entry.rs', entryTests(stage));
        cargo(['-p', 'saas-api', '--test', 'course_entry'], services);
        if (stage !== 'module') {
          writeRust('crates/app/tests/course_steps.rs', courseTests(stage));
          cargo(['-p', 'saas-app', '--test', 'course_steps'], services);
        }
        execFileSync('cargo', ['check', '--locked', '-p', 'saas-worker'], {
          cwd: target,
          stdio: 'inherit',
          env: { ...env, ...services },
        });
        execFileSync('cargo', ['fmt', '--all', '--', '--check'], {
          cwd: target,
          stdio: 'inherit',
          env,
        });
        console.log(
          `Course checkpoint ${stage}: migrations, API entries, HTTP and Worker verified.`,
        );
      }
    });
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
