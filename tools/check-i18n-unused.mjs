#!/usr/bin/env node
// check-i18n-unused.mjs — flag locale keys defined in JSON / Dict TS
// that are not referenced anywhere in the source tree.
//
// Heuristic: grep for `t('key')`, `t("key")`, `useT()('key')`,
// `translate('key')`, `i18n.t('key')` and similar. Anything that
// resolves to a literal key string is considered "used".
//
// Dynamic key construction (`t(\`foo.${suffix}\`)`) is *not* tracked —
// such cases must be whitelisted by hand in IGNORE_PATTERNS below.

import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Keys that look unused but really are (dynamic refs, runtime kinds).
const IGNORE_PATTERNS = [
  /^onboarding\.goal_wizard\.kind\./, // looked up by GoalKind enum at runtime
  /^errors\.code\./, // looked up by HTTP status code
];

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

function isIgnored(key) {
  return IGNORE_PATTERNS.some((re) => re.test(key));
}

function refsInTree(searchDir, key) {
  // grep -RIn key — use 0 fallback when no match (grep exits 1).
  try {
    const out = execSync(
      `grep -RIn --include='*.ts' --include='*.tsx' --include='*.js' -F ${JSON.stringify(key)} ${searchDir}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.length > 0;
  } catch {
    return false;
  }
}

async function checkFrontendNamespace(ns) {
  const enPath = resolve(ROOT, `frontend/src/locales/en/${ns}.json`);
  const json = JSON.parse(await readFile(enPath, 'utf8'));
  const flat = flatten(json);
  const keys = Object.keys(flat);
  const orphans = [];
  for (const k of keys) {
    if (isIgnored(k)) continue;
    const full = `${ns}.${k}`;
    if (refsInTree(resolve(ROOT, 'frontend/src'), full) || refsInTree(resolve(ROOT, 'frontend/src'), k)) {
      continue;
    }
    orphans.push(full);
  }
  return { ns, orphans };
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
  const enPath = resolve(ROOT, 'shared/i18n/en.ts');
  const src = await readFile(enPath, 'utf8');
  const keyRe = /'([a-z0-9_.]+)':/g;
  const keys = [];
  for (const m of src.matchAll(keyRe)) keys.push(m[1]);
  const orphans = [];
  for (const k of keys) {
    if (isIgnored(k)) continue;
    // search across both Electron renderer trees + main process
    const inHone = refsInTree(resolve(ROOT, 'hone/src'), k);
    const inCue = refsInTree(resolve(ROOT, 'cue/src'), k);
    if (!inHone && !inCue) orphans.push(k);
  }
  return { orphans };
}

const fmt = (arr) => (arr.length ? `\n    ${arr.join('\n    ')}` : ' (none)');

async function main() {
  let totalOrphans = 0;
  console.log('— frontend i18next namespaces (orphan keys) —');
  for (const r of await checkFrontend()) {
    if (r.error) {
      console.log(`  ${r.ns}: ERROR ${r.error}`);
      continue;
    }
    if (r.orphans.length === 0) {
      console.log(`  ${r.ns}: clean`);
    } else {
      totalOrphans += r.orphans.length;
      console.log(`  ${r.ns}: ${r.orphans.length} orphan(s)${fmt(r.orphans)}`);
    }
  }
  console.log('— shared/i18n flat Dict (orphan keys) —');
  const sh = await checkSharedDict();
  if (sh.orphans.length === 0) {
    console.log('  clean');
  } else {
    totalOrphans += sh.orphans.length;
    console.log(`  ${sh.orphans.length} orphan(s)${fmt(sh.orphans)}`);
  }
  console.log(`\n${totalOrphans === 0 ? 'OK' : 'WARN'}: ${totalOrphans} orphan key(s)`);
  // Orphans are a warn, not a hard fail — sometimes keys are added
  // ahead of the consuming UI in the same PR.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
