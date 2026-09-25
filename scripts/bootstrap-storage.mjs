import { developmentEnv, run } from './lib/process.mjs';

run(
  'cargo',
  ['run', '--locked', '-p', 'saas-api', '--bin', 'bootstrap-storage'],
  developmentEnv(),
);
