// Masquerade — makes the app look like something else to reduce
// attention during screen-shares.
//
// What we can do at runtime (this module):
//   1. Swap the Dock icon (`app.dock?.setIcon`).
//   2. Override window titles — Settings / Onboarding become the chosen
//      alias (Compact / Expanded are frameless, title is moot).
//   3. Write the chosen alias to localStorage so preference survives
//      restart. (Main reads it on boot.)
//
// What we CANNOT do at runtime:
//   - Rename the process in Activity Monitor. macOS reads the process
//     name from the signed `.app` bundle; changing it requires a
//     different build target. Our ship pipeline will grow a
//     "masquerade builds" job that produces `Notes.app`, `Telegram.app`
//     etc. from the same sources. See docs/copilot-shipping.md §10.

import { app, nativeImage, BrowserWindow, Tray } from 'electron';
import { join } from 'node:path';

export type MasqueradePreset = 'druz9' | 'notes' | 'telegram' | 'xcode' | 'slack';

// Tray instance from main process — registered via registerTray() so
// applyPreset может swap'нуть menu-bar icon syncronously. Без этого
// masquerade Dock-only — а menu-bar остаётся «Cue» (palette leak).
let trayRef: Tray | null = null;
export function registerTray(t: Tray): void {
  trayRef = t;
}

interface Preset {
  id: MasqueradePreset;
  displayName: string;
  windowTitle: string;
  iconFile: string | null; // relative to /resources/masquerade/
}

const PRESETS: Record<MasqueradePreset, Preset> = {
  druz9:    { id: 'druz9',    displayName: 'Cue', windowTitle: 'Cue', iconFile: null },
  notes:    { id: 'notes',    displayName: 'Notes',         windowTitle: 'Notes',         iconFile: 'notes.png' },
  telegram: { id: 'telegram', displayName: 'Telegram',      windowTitle: 'Telegram',      iconFile: 'telegram.png' },
  xcode:    { id: 'xcode',    displayName: 'Xcode',         windowTitle: 'Xcode',         iconFile: 'xcode.png' },
  slack:    { id: 'slack',    displayName: 'Slack',         windowTitle: 'Slack',         iconFile: 'slack.png' },
};

let current: MasqueradePreset = 'druz9';

/** List available presets — exposed to the renderer for the Settings picker. */
export function listPresets(): Array<{ id: MasqueradePreset; displayName: string }> {
  return Object.values(PRESETS).map((p) => ({ id: p.id, displayName: p.displayName }));
}

export function getCurrent(): MasqueradePreset {
  return current;
}

/**
 * Apply a preset. Changes the Dock icon (macOS only) and window titles
 * on the open Settings / Onboarding windows. Is a no-op on platforms
 * that don't expose Dock controls (Windows, Linux).
 */
export function applyPreset(preset: MasqueradePreset, resourcesPath: string): void {
  const p = PRESETS[preset];
  if (!p) return;
  current = preset;

  // Icon swap — macOS only. iconFile === null means "default app icon".
  // Also propagates to tray (menu-bar icon) — без этого юзер видит «Notes»
  // в Dock но «Cue» в menu bar, что палево при screen-share.
  if (process.platform === 'darwin') {
    if (p.iconFile) {
      try {
        const img = nativeImage.createFromPath(join(resourcesPath, 'masquerade', p.iconFile));
        if (!img.isEmpty()) {
          app.dock?.setIcon(img);
          // Tray icon: template-mode SVG/PNG чтобы macOS auto-invert under
          // dark/light menu bar. Use the same file — masquerade pngs
          // ожидаются monochrome template-ready.
          if (trayRef && !trayRef.isDestroyed()) {
            try {
              img.setTemplateImage(true);
              trayRef.setImage(img);
              trayRef.setToolTip(p.displayName);
            } catch {
              /* silent fallback — tray keeps prior icon */
            }
          }
        }
      } catch {
        /* fall back to default icon silently */
      }
    } else {
      // Restore the default icon by passing an empty image — Electron
      // interprets that as "use bundle icon".
      app.dock?.setIcon(nativeImage.createEmpty());
      if (trayRef && !trayRef.isDestroyed()) {
        try {
          const fallback = nativeImage.createFromPath(join(resourcesPath, 'trayTemplate.png'));
          if (!fallback.isEmpty()) {
            fallback.setTemplateImage(true);
            trayRef.setImage(fallback);
            trayRef.setToolTip('Cue');
          }
        } catch {
          /* silent — tray keeps last image */
        }
      }
    }
  }

  // Window titles on visible windows.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.setTitle(p.windowTitle);
    } catch {
      /* frameless windows ignore this silently */
    }
  }
}
