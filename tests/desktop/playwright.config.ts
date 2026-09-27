import { defineConfig } from '@playwright/test';

// The Electron shell smoke runs against a stack started by
// scripts/desktop-smoke.mjs; it never starts its own web server.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  // Failure evidence stays console-local: no traces or screenshots that
  // could contain session or document content.
  reporter: [['list']],
  outputDir: '../../test-results/desktop',
});
