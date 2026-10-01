import { developmentEnv, run } from './lib/process.mjs';
import {
  developmentServices,
  startDevelopmentServices,
} from './lib/development-services.mjs';

const args = process.argv.slice(2);
const forceRecreate = args.includes('--force-recreate');
const [action = 'up', ...services] = args.filter(
  (arg) => arg !== '--force-recreate',
);
if (!['up', 'stop'].includes(action))
  throw new Error('Use services.mjs up|stop [service ...]');
const selected = services.length ? services : developmentServices;
if (selected.some((service) => !developmentServices.includes(service)))
  throw new Error('Unknown development service');
const env = developmentEnv();
if (action === 'up')
  await startDevelopmentServices(env, { services: selected, forceRecreate });
else run('docker', ['compose', 'stop', ...selected], env);
