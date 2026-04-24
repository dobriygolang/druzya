#!/usr/bin/env node
// Alt-build pipeline for masquerade targets.
//
// Problem: Activity Monitor reads the process name from the signed
// .app bundle's CFBundleName. That field is baked at build time —
// we cannot rename the running app from JavaScript. The only way to
// give the user "my Druz9 looks like Notes in Activity Monitor" is
// to ship a second bundle whose CFBundleName is literally "Notes".
//
// This script drives electron-builder multiple times, once per
// preset, writing a per-preset config that:
//   - sets appId + productName + CFBundleName to the alias
//   - swaps the icon.icns for that preset's icon
//   - writes the output to dist/masquerade/<preset>/
//
// Run with:
//   make desktop-build-masquerade
//
// The main `.dmg` (real Druz9 branding) is still built by the normal
// `make desktop-build` target — this script is purely for the disguise
// bundles, which a power-user installs alongside the real app and
// chooses at launch time.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const desktopDir = resolve(__dirname, '..');

/**
 * Keep this table in lock-step with the MasqueradePreset table in
 * src/main/masquerade.ts. Each entry describes the _bundle-time_
 * identity for that disguise — the runtime dock-icon swap handles
 * the in-memory UX independently.
 */
const presets = [
  {
    id: 'notes',
    productName: 'Notes',
    appId: 'app.druzya.copilot.notes',
    iconFile: 'notes.icns',
    fileAssociations: [],
  },
  {
    id: 'telegram',
    productName: 'Telegram',
    appId: 'app.druzya.copilot.telegram',
    iconFile: 'telegram.icns',
    fileAssociations: [],
  },
  {
    id: 'xcode',
    productName: 'Xcode',
    appId: 'app.druzya.copilot.xcode',
    iconFile: 'xcode.icns',
    fileAssociations: [],
  },
  {
    id: 'slack',
    productName: 'Slack',
    appId: 'app.druzya.copilot.slack',
    iconFile: 'slack.icns',
    fileAssociations: [],
  },
];

function usage() {
  console.error(
    'Usage: build-masquerade.mjs [--only <preset>] [--skip-build]\n' +
      '  --only       build only the named preset (notes|telegram|xcode|slack)\n' +
      '  --skip-build   write the per-preset configs but do not invoke electron-builder',
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { only: null, skipBuild: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only') {
      out.only = args[++i];
    } else if (a === '--skip-build') {
      out.skipBuild = true;
    } else if (a === '--help' || a === '-h') {
      usage();
    } else {
      console.error(`unknown arg: ${a}`);
      usage();
    }
  }
  return out;
}

function run() {
  const { only, skipBuild } = parseArgs();
  const filtered = only ? presets.filter((p) => p.id === only) : presets;
  if (only && filtered.length === 0) {
    console.error(`no preset named "${only}"`);
    process.exit(1);
  }

  for (const preset of filtered) {
    console.log(`\n=== masquerade build: ${preset.productName} ===`);
    const cfgPath = writePresetConfig(preset);
    if (skipBuild) {
      console.log(`  wrote config → ${cfgPath}`);
      continue;
    }
    const outDir = join(desktopDir, 'dist', 'masquerade', preset.id);
    mkdirSync(outDir, { recursive: true });
    const r = spawnSync(
      'npx',
      [
        'electron-builder',
        '--mac',
        '--config',
        cfgPath,
        '--config.directories.output',
        outDir,
      ],
      {
        cwd: desktopDir,
        stdio: 'inherit',
        env: { ...process.env },
      },
    );
    if (r.status !== 0) {
      console.error(`  electron-builder failed for ${preset.id}`);
      process.exit(r.status ?? 1);
    }
  }
  console.log('\nAll masquerade builds finished.');
  console.log('Outputs in desktop/dist/masquerade/<preset>/*.dmg');
  console.log(
    '\nReminder: install alongside the real Druz9 Copilot.app. In Activity Monitor\n' +
      'the alt bundle shows up under its new name (e.g. "Notes"). Launch whichever\n' +
      'bundle you want the observer to see; the underlying behaviour is identical.',
  );
}

function writePresetConfig(preset) {
  // Merge the base electron-builder.yml with per-preset overrides.
  const base = readBaseConfig();
  const cfg = {
    ...base,
    appId: preset.appId,
    productName: preset.productName,
    mac: {
      ...base.mac,
      icon: `resources/masquerade/${preset.iconFile}`,
      extendInfo: {
        ...(base.mac?.extendInfo ?? {}),
        CFBundleName: preset.productName,
        CFBundleDisplayName: preset.productName,
      },
    },
    // Disambiguate the output dmg filename so the four masquerade
    // bundles don't overwrite each other.
    artifactName: `${preset.productName} Copilot-\${version}-${preset.id}-\${arch}.\${ext}`,
  };

  const outPath = join(desktopDir, `.masquerade-${preset.id}.yml`);
  writeFileSync(outPath, yaml.dump(cfg));
  return outPath;
}

function readBaseConfig() {
  // Tiny YAML read without a full parser: the file is our own and we
  // control its shape. Using js-yaml keeps the script honest.
  const raw = readFileSync(join(desktopDir, 'electron-builder.yml'), 'utf-8');
  return yaml.load(raw);
}

// We intentionally defer the import so `js-yaml` is only required
// when this script runs — not at dev-install time, where the user
// might want the rest of the toolchain without pulling it.
import { readFileSync } from 'node:fs';

run();
