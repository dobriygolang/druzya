// ESLint flat config (v9). Phase K Wave 16 introduced `d9-i18n/no-cyrillic-literals`
// as the runtime gate against hardcoded Cyrillic in user-facing strings —
// the TypeScript Dict in shared/i18n already catches typos in keys, but
// only ESLint catches the original sin of `<button>Привет</button>` that
// was never wrapped in `t()` at all. Rule is `'error'` post-sweep, so any
// new hardcoded literal in JSX / string / template literal fails CI.
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
      'src/renderer/src/quick-capture/**',
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
      'no-unused-vars': 'off',
      'd9-i18n/no-cyrillic-literals': 'error',
    },
  },
];
