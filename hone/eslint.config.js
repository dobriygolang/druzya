// Minimal ESLint flat config for Hone. The primary correctness gate is
// still `tsc --noEmit`; this config exists to enforce the
// `no-cyrillic-literals` rule introduced in Phase K Wave 16 (i18n
// unification). New user-facing strings must live in shared/i18n/{ru,en}.ts
// keyed by hone.*, not hardcoded in .tsx.
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
      // Generated TS stubs (proto-generated, lived in the frontend tree)
      '../frontend/src/api/generated/**',
      // Test files and the local-history fixture data may contain Cyrillic.
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
      // TS already handles undefined-identifier checks.
      'no-undef': 'off',
      // 'warn' during the sweep; flip to 'error' once shared/i18n covers
      // every Hone surface and tsc still passes.
      'd9-i18n/no-cyrillic-literals': 'warn',
    },
  },
];
