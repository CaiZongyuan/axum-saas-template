import { withTestPostgres } from './lib/postgres.mjs';
import { withTestRustfs } from './lib/rustfs.mjs';
import { withTestRedis } from './lib/redis.mjs';
import { run } from './lib/process.mjs';

await withTestPostgres(async ({ url }) => {
  await withTestRustfs(async ({ env }) => {
    await withTestRedis(async ({ env: redisEnv }) => {
      run(
        'cargo',
        ['test', '--locked', '--workspace', ...process.argv.slice(2)],
        {
          ...process.env,
          ...env,
          ...redisEnv,
          DATABASE_URL: url,
          CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
        },
      );
    });
  });
});
