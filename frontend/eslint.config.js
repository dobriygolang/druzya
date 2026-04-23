// Flat config for ESLint v9+. Mirrors the previous .eslintrc.cjs rules.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/api/generated/**', 'public/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript itself handles undefined-identifier checks; the core
      // no-undef rule double-counts type-only refs like RequestInit/JSX.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Legacy plain JS sources (pre-TS migration) — same browser+ES env as the
  // TS block, plus the react-hooks plugin so its rule names resolve in `.js`
  // files that still use hooks (e.g. lib/voice/useVoiceSession.js). Without
  // this, `js.configs.recommended` runs `no-undef` against browser globals
  // (`window`, `document`, `fetch`, `URL`, `WebSocket`, …) and the lint
  // gate explodes on perfectly valid client-side code.
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    ignores: ['**/*.config.{js,mjs,cjs}', 'vite.config.*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'no-console': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Build/config scripts run in Node — give them the Node globals.
  {
    files: ['**/*.config.{ts,js,mjs,cjs}', 'vite.config.*'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
