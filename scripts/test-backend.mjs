import { withTestPostgres } from './lib/postgres.mjs';
import { run } from './lib/process.mjs';

await withTestPostgres(async ({ url }) => {
  run('cargo', ['test', '--locked', '--workspace', ...process.argv.slice(2)], {
    ...process.env,
    DATABASE_URL: url,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
  });
});
