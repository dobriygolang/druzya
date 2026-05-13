#!/usr/bin/env node
// check-i18n-parity.mjs — verify ru / en locale parity for both
// frontend (i18next JSON namespaces) and shared/i18n (flat Dict TS).
//
// Exits non-zero if either ru or en is missing keys present in the
// other. Helps prevent half-translated UI strings from shipping.

import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

async function checkFrontendNamespace(ns) {
  const ruPath = resolve(ROOT, `frontend/src/locales/ru/${ns}.json`);
  const enPath = resolve(ROOT, `frontend/src/locales/en/${ns}.json`);
  const [ru, en] = await Promise.all([
    readFile(ruPath, 'utf8').then(JSON.parse),
    readFile(enPath, 'utf8').then(JSON.parse),
  ]);
  const ruFlat = flatten(ru);
  const enFlat = flatten(en);
  const ruKeys = new Set(Object.keys(ruFlat));
  const enKeys = new Set(Object.keys(enFlat));
  const missingInEn = [...ruKeys].filter((k) => !enKeys.has(k));
  const missingInRu = [...enKeys].filter((k) => !ruKeys.has(k));
  return { ns, missingInEn, missingInRu };
}

async function checkFrontend() {
  const dir = resolve(ROOT, 'frontend/src/locales/en');
  const files = await readdir(dir);
  const namespaces = files.filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json'));
  const results = [];
  for (const ns of namespaces) {
    try {
      results.push(await checkFrontendNamespace(ns));
    } catch (err) {
      results.push({ ns, error: String(err && err.message ? err.message : err) });
    }
  }
  return results;
}

async function checkSharedDict() {
  const ruPath = resolve(ROOT, 'shared/i18n/ru.ts');
  const enPath = resolve(ROOT, 'shared/i18n/en.ts');
  const [ruSrc, enSrc] = await Promise.all([
    readFile(ruPath, 'utf8'),
    readFile(enPath, 'utf8'),
  ]);
  // Lightweight grep — match every `'key.path': '...'` line; we don't run
  // a TS parser to avoid a heavy dep just for parity check.
  const keyRe = /'([a-z0-9_.]+)':/g;
  const ruKeys = new Set();
  const enKeys = new Set();
  for (const m of ruSrc.matchAll(keyRe)) ruKeys.add(m[1]);
  for (const m of enSrc.matchAll(keyRe)) enKeys.add(m[1]);
  return {
    missingInEn: [...ruKeys].filter((k) => !enKeys.has(k)),
    missingInRu: [...enKeys].filter((k) => !ruKeys.has(k)),
  };
}

const fmt = (arr) => (arr.length ? `\n    ${arr.join('\n    ')}` : ' (none)');

async function main() {
  let failed = 0;
  console.log('— frontend i18next namespaces —');
  const fe = await checkFrontend();
  for (const r of fe) {
    if (r.error) {
      console.log(`  ${r.ns}: ERROR ${r.error}`);
      failed += 1;
      continue;
    }
    if (r.missingInEn.length === 0 && r.missingInRu.length === 0) {
      console.log(`  ${r.ns}: OK`);
    } else {
      failed += 1;
      console.log(`  ${r.ns}:`);
      console.log(`    missing in en:${fmt(r.missingInEn)}`);
      console.log(`    missing in ru:${fmt(r.missingInRu)}`);
    }
  }
  console.log('— shared/i18n flat Dict —');
  const sh = await checkSharedDict();
  if (sh.missingInEn.length === 0 && sh.missingInRu.length === 0) {
    console.log('  OK');
  } else {
    failed += 1;
    console.log(`  missing in en:${fmt(sh.missingInEn)}`);
    console.log(`  missing in ru:${fmt(sh.missingInRu)}`);
  }
  if (failed > 0) {
    console.log(`\nFAIL: ${failed} parity issue(s)`);
    process.exit(1);
  }
  console.log('\nOK: all locales in parity');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
