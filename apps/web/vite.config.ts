import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readDevelopmentEnv } from '../../scripts/lib/development-env.mjs';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const local = readDevelopmentEnv(workspaceRoot, { ...env, ...process.env });
  const target = local.VITE_API_PROXY;
  return {
    envDir: workspaceRoot,
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: Number(local.WEB_PORT),
      strictPort: true,
      // Proxy the backend namespaces only, not the `/api` prefix: the SPA
      // owns sibling routes like /api-keys, and a prefix proxy turns a
      // refresh or deep link to them into the API's 404.
      proxy: {
        '/api/v1': { target },
        '/api/openapi.json': { target },
        '/health': { target },
      },
    },
  };
});
