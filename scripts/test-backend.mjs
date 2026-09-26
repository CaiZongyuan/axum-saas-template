import { withTestPostgres } from './lib/postgres.mjs';
import { withTestRustfs } from './lib/rustfs.mjs';
import { withTestRedis } from './lib/redis.mjs';
import { withTestMailpit } from './lib/mailpit.mjs';
import { run } from './lib/process.mjs';

await withTestPostgres(async ({ url }) => {
  await withTestRustfs(async ({ env }) => {
    await withTestRedis(async ({ env: redisEnv }) => {
      await withTestMailpit(async ({ env: mailEnv }) => {
        await withTestMailpit(async ({ env: chaosEnv }) => {
          run(
            'cargo',
            ['test', '--locked', '--workspace', ...process.argv.slice(2)],
            {
              ...process.env,
              ...env,
              ...redisEnv,
              ...mailEnv,
              MAIL_CHAOS_SMTP_PORT: chaosEnv.MAIL_SMTP_PORT,
              MAIL_CHAOS_HTTP_URL: chaosEnv.MAILPIT_HTTP_URL,
              DATABASE_URL: url,
              CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '4',
            },
          );
        });
      });
    });
  });
});
