import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '.agents/**',
      '.claude/**',
      '.scratch/**',
      'target/**',
      '**/node_modules/**',
      '**/dist/**',
      'apps/docs/.generated/**',
      'apps/docs/.vitepress/cache/**',
      'packages/sdk/src/generated/**',
      'packages/contracts/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.{ts,tsx,mts}'], rules: { 'no-undef': 'off' } },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
