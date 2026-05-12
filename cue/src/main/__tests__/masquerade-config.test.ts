// masquerade-config.test.ts — pins LSUIElement+stealth-friendly settings
// across every masquerade preset. Same intent as the existing
// `.github/workflows/cue-masquerade-validate.yml` runtime check, but
// fast (no electron-builder spawn) and catches the regression at PR time
// rather than at release time.
//
// What we guard:
//   • Each masquerade yml file extends base electron-builder.yml.
//   • LSUIElement: true present in extendInfo (без него .app surfaces
//     в Dock/Cmd-Tab — stealth gone).
//   • appId starts with app.druzya.copilot.alias.* (uniqueness — without
//     this macOS routes deeplinks to the wrong bundle).
//   • CFBundleURLTypes wiped to [] (only the real Cue bundle owns
//     druz9-cue:// scheme; alias bundles claiming it would mis-route).
//   • masqueradePreset metadata key set (used by afterPack hook).
//
// Files read from disk — they're the source of truth. This test catches
// the case where someone adds electron-builder.<preset>.yml and forgets
// to set LSUIElement.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const CUE_DIR = resolve(__dirname, '..', '..', '..');

interface MasqueradeYaml {
  extends?: string;
  productName?: string;
  appId?: string;
  mac?: {
    extendInfo?: {
      LSUIElement?: boolean;
      CFBundleName?: string;
      CFBundleDisplayName?: string;
      CFBundleURLTypes?: unknown[];
    };
  };
  extraMetadata?: {
    masqueradePreset?: string;
  };
  afterPack?: string;
}

function discoverPresets(): { preset: string; path: string }[] {
  const files = readdirSync(CUE_DIR);
  return files
    .filter(
      (f) =>
        f.startsWith('electron-builder.') &&
        f.endsWith('.yml') &&
        f !== 'electron-builder.yml',
    )
    .map((f) => ({
      preset: f.replace(/^electron-builder\.|\.yml$/g, ''),
      path: join(CUE_DIR, f),
    }));
}

const presets = discoverPresets();

describe('masquerade configs — discovery', () => {
  it('finds at least one masquerade preset', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it('base electron-builder.yml exists with LSUIElement: true', () => {
    const base = join(CUE_DIR, 'electron-builder.yml');
    expect(existsSync(base)).toBe(true);
    const cfg = yaml.load(readFileSync(base, 'utf-8')) as MasqueradeYaml;
    expect(cfg.mac?.extendInfo?.LSUIElement).toBe(true);
  });
});

describe.each(presets)('masquerade preset: $preset', ({ path, preset }) => {
  const cfg = yaml.load(readFileSync(path, 'utf-8')) as MasqueradeYaml;

  it('extends base electron-builder.yml', () => {
    expect(cfg.extends).toBe('electron-builder.yml');
  });

  it('keeps LSUIElement: true in mac.extendInfo (Dock/Cmd-Tab hiding)', () => {
    expect(cfg.mac?.extendInfo?.LSUIElement).toBe(true);
  });

  it('declares unique alias appId under app.druzya.copilot.alias.*', () => {
    expect(cfg.appId).toMatch(/^app\.druzya\.copilot\.alias\.[a-z]+$/);
  });

  it('overrides CFBundleName / CFBundleDisplayName to match productName', () => {
    expect(cfg.mac?.extendInfo?.CFBundleName).toBe(cfg.productName);
    expect(cfg.mac?.extendInfo?.CFBundleDisplayName).toBe(cfg.productName);
  });

  it('wipes CFBundleURLTypes (only real Cue owns druz9-cue:// scheme)', () => {
    expect(cfg.mac?.extendInfo?.CFBundleURLTypes).toEqual([]);
  });

  it('wires afterPack-masquerade hook (CFBundleExecutable rewrite)', () => {
    expect(cfg.afterPack).toBe('scripts/afterPack-masquerade.cjs');
  });

  it('declares matching masqueradePreset metadata key', () => {
    expect(cfg.extraMetadata?.masqueradePreset).toBe(preset);
  });
});
