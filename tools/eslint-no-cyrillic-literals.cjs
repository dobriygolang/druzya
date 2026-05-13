// Custom ESLint rule: flag hardcoded Cyrillic in user-facing strings.
//
// Intent: catch a developer adding <button>Привет</button> or
// const msg = 'Не удалось…' that should have been t('common.error.…').
// The rule visits JSX text nodes, string literals and template
// quasis; it reports anything that contains [А-Яа-я] outside the
// allowlisted file globs.
//
// We deliberately do NOT flag:
//   - comments (// or /* */) — those legitimately stay Russian
//   - import/export specifiers
//   - JSXAttribute name (only the value can be a string)
//
// Allowlist (file globs) is handled at the eslint.config.js level
// via `files` / `ignores` blocks; the rule itself is path-agnostic
// so the same rule file is reused by frontend / hone / cue configs.

'use strict';

const CYRILLIC = /[Ѐ-ӿ]/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded Cyrillic characters in user-facing strings (use t() / useT() instead).',
    },
    schema: [],
    messages: {
      cyrillicLiteral:
        'Hardcoded Cyrillic literal: {{snippet}}. Wrap in t(...) / useT() so the string lives in a translation file.',
    },
  },

  create(context) {
    function report(node, raw) {
      const snippet = String(raw).trim().slice(0, 40);
      context.report({
        node,
        messageId: 'cyrillicLiteral',
        data: { snippet },
      });
    }

    return {
      // JSX text: <span>Привет</span>
      JSXText(node) {
        if (CYRILLIC.test(node.value)) report(node, node.value);
      },
      // String literal in JSX attribute / function arg / variable init
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (!CYRILLIC.test(node.value)) return;
        // Skip import / export source strings (e.g. import x from './ru.ts')
        const parent = node.parent;
        if (
          parent &&
          (parent.type === 'ImportDeclaration' ||
            parent.type === 'ExportNamedDeclaration' ||
            parent.type === 'ExportAllDeclaration')
        ) {
          return;
        }
        report(node, node.value);
      },
      // Template literal quasis: `Привет ${name}` — flag each chunk
      TemplateElement(node) {
        if (CYRILLIC.test(node.value.cooked || node.value.raw || '')) {
          report(node, node.value.cooked || node.value.raw);
        }
      },
    };
  },
};
