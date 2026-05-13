// Minimal ESLint flat config for Cue. Mirrors hone/eslint.config.js;
// see Phase K Wave 16 (i18n unification) — new user-facing strings live
// in shared/i18n/{ru,en}.ts under the cue.* prefix, not hardcoded.
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
    ],
  },
  js.configs.recommended,
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
      'd9-i18n/no-cyrillic-literals': 'warn',
    },
  },
];
