import { developmentEnv, run } from './lib/process.mjs';

// Launch the Electron shell against a running dev web entry (`just dev`).
// The shell loads the same-origin entry, so it follows the web port from the
// development environment unless SAAS_DESKTOP_ORIGIN says otherwise.
const env = developmentEnv();
run('pnpm', ['--filter', '@saas/desktop', 'start'], env);
