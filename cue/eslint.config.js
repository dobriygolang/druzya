// ESLint flat config (v9). Mirrors hone/eslint.config.js. Phase K Wave 16
// introduced `d9-i18n/no-cyrillic-literals` as the post-sweep regression
// guard — new user-facing strings must live in shared/i18n/{ru,en}.ts
// under `cue.*`, not as inline Cyrillic literals in .tsx.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const noCyrillicLiterals = require('../tools/eslint-no-cyrillic-literals.cjs');

export default [
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      '../frontend/src/api/generated/**',
      '**/*.test.{ts,tsx}',
      'src/test/**',
      // Main-process Electron strings (tray menu, what's-new banner,
      // OS notifications) live outside the renderer Dict; tracked
      // separately with app.getLocale().
      'src/main/**',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'd9-i18n': {
        rules: {
          'no-cyrillic-literals': noCyrillicLiterals,
        },
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'd9-i18n/no-cyrillic-literals': 'error',
    },
  },
];
