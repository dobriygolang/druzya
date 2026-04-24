// Menu-bar (Tray) icon — persistent macOS status-bar entry.
//
// Clicking the icon opens a dropdown with the handful of actions that
// are meaningful outside the compact window: take a screenshot, start
// voice, open settings, quit. The compact window itself is still
// always-on-top, so the tray is a secondary affordance — think of it
// as "I hid the compact window and still want to trigger Druz9 from
// the menu bar".
//
// The tray is NOT stealthed. macOS status-bar items are rendered by
// the window server in a privileged layer; they show up in screen
// captures, but they show up regardless of whether they're our tray
// or Notes' tray, so it doesn't leak any Druz9-specific info. The
// masquerade layer (icon swap) makes the menu-bar icon match the
// chosen alias — a user who picked "Notes" gets Notes's tray icon.

import { Menu, Tray, app, nativeImage } from 'electron';
import { join } from 'node:path';

import type { WindowOptions } from '../windows/window-manager';
import { showWindow } from '../windows/window-manager';
import { fireAction } from '../hotkeys/registry';
import { getSessionManager } from '../ipc/handlers';

let tray: Tray | null = null;

export interface TrayDeps {
  resourcesPath: string;
  windowOptions: WindowOptions;
}

// sessionMenuItem — dynamic entry whose label depends on whether a
// session is live. We rebuild the menu on toggle so the label updates.
function sessionMenuItem(deps: TrayDeps): Electron.MenuItemConstructorOptions {
  const mgr = getSessionManager();
  const live = mgr?.current() ?? null;
  return {
    label: live ? 'Закончить сессию собеседования' : 'Начать сессию собеседования',
    click: async () => {
      const m = getSessionManager();
      if (!m) return;
      try {
        if (m.current()) {
          await m.end();
        } else {
          await m.start('interview');
        }
      } catch {
        // Errors surface in the renderer session store; tray stays silent.
      } finally {
        // Rebuild the menu so the label flips.
        refreshMenu(deps);
      }
    },
  };
}

export function ensureTray(deps: TrayDeps): void {
  if (tray) return;

  const icon = buildTrayIcon(deps.resourcesPath);
  tray = new Tray(icon);
  // Always set a short textual marker alongside the icon — when the
  // template PNG is missing (dev builds) the icon is empty, and even
  // when present the text makes the Cue tray instantly findable
  // among other menu-bar items. "Cue" (previously "D9") matches the
  // BrandMark "C" glyph.
  tray.setTitle(icon.isEmpty() ? 'Cue' : ' Cue');
  tray.setToolTip('Cue');

  // Clicking the icon shows the compact window AND opens the menu —
  // macOS convention. We only want the menu; compact is already
  // always-on-top so an extra focus grab would steal the user's typing.
  refreshMenu(deps);

  // Left-click on macOS shows the context menu by default when one is
  // attached via `setContextMenu`, so we don't need a custom handler.
}

export function updateTrayIcon(resourcesPath: string): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(buildTrayIcon(resourcesPath));
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * Build a template-image icon. Passing `setTemplateImage(true)` tells
 * macOS to invert the black pixels automatically for light/dark menu
 * bars — that's why the source PNG is monochrome. If the file is
 * missing (first-run dev build without assets), we fall back to an
 * empty image and the tray still works without an icon visible.
 */
function buildTrayIcon(resourcesPath: string): Electron.NativeImage {
  try {
    const path = join(resourcesPath, 'trayTemplate.png');
    const img = nativeImage.createFromPath(path);
    if (!img.isEmpty()) {
      img.setTemplateImage(true);
      return img;
    }
  } catch {
    /* fall through to empty image */
  }
  return nativeImage.createEmpty();
}

function refreshMenu(deps: TrayDeps): void {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Cue',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Скриншот области',
      accelerator: 'CommandOrControl+Shift+S',
      click: () => {
        // Route through the same handler a globalShortcut would trigger.
        // Previously we broadcast hotkeyFired directly to renderers, but
        // `cursor_freeze_toggle` is processed main-side (cursor module
        // lives there), so a broadcast-only path silently ignored it.
        // fireAction() invokes the handler registered in main/index.ts.
        fireAction('screenshot_area');
      },
    },
    {
      label: 'Голос',
      accelerator: 'CommandOrControl+Shift+V',
      click: () => {
        fireAction('voice_input');
      },
    },
    {
      label: 'Заморозить курсор',
      accelerator: 'CommandOrControl+Shift+Y',
      click: () => {
        fireAction('cursor_freeze_toggle');
      },
    },
    { type: 'separator' },
    sessionMenuItem(deps),
    { type: 'separator' },
    {
      label: 'Открыть окно',
      click: () => {
        showWindow('compact', deps.windowOptions);
      },
    },
    {
      label: 'История',
      click: () => {
        showWindow('history', deps.windowOptions);
      },
    },
    {
      label: 'Настройки…',
      click: () => {
        showWindow('settings', deps.windowOptions);
      },
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      accelerator: 'CommandOrControl+Q',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}
