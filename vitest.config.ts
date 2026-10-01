import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { availableParallelism } from 'node:os';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    maxWorkers: Math.min(4, availableParallelism()),
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/web/src/**/*.test.{ts,tsx}',
      'apps/desktop/src/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/frontend/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
