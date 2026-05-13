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

import { Tray, nativeImage, screen } from 'electron';
import { join } from 'node:path';

import { registerTray as registerTrayForMasquerade } from '../masquerade';
import type { WindowOptions } from '../windows/window-manager';
import { getWindow, hideWindow, showWindow } from '../windows/window-manager';

let tray: Tray | null = null;

export interface TrayDeps {
  resourcesPath: string;
  windowOptions: WindowOptions;
}

export function ensureTray(deps: TrayDeps): void {
  if (tray) return;

  // Resilience: если иконка не нашлась (битый билд / руками удалена), не
  // падаем — fallback на встроенную (1×1 transparent NativeImage). Без
  // этого throw в buildTrayIcon ронял ensureTray ДО Tray() и юзер вообще
  // не видел приложение в menu bar (только background process).
  let icon: Electron.NativeImage;
  try {
    icon = buildTrayIcon(deps.resourcesPath);
  } catch (err) {
    console.warn('[tray] buildTrayIcon failed, using empty fallback:', err);
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  // Если icon — empty, у тебя будет «текстовый» tray; чтобы он был хоть
  // как-то виден — выставляем title literal'ом. Когда нормальная иконка
  // есть — title пустой (см. ниже).
  if (icon.isEmpty()) {
    tray.setTitle('Cue');
  } else {
    tray.setTitle('');
  }
  tray.setToolTip('Cue');

  tray.on('click', () => toggleTrayPopup(deps));
  tray.on('right-click', () => toggleTrayPopup(deps));

  registerTrayForMasquerade(tray);
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
 * bars — that's why the source PNG is monochrome.
 */
function buildTrayIcon(resourcesPath: string): Electron.NativeImage {
  const path = join(resourcesPath, 'trayTemplate.png');
  const img = nativeImage.createFromPath(path);
  if (img.isEmpty()) {
    throw new Error(`Tray icon is missing or invalid: ${path}`);
  }
  img.setTemplateImage(true);
  return img;
}

/**
 * Show the custom HTML tray popup anchored under the tray icon.
 */
function toggleTrayPopup(deps: TrayDeps): void {
  if (!tray || tray.isDestroyed()) return;
  const existing = getWindow('tray-popup');
  if (existing?.isVisible()) {
    hideWindow('tray-popup');
    return;
  }

  const popup = showWindow('tray-popup', deps.windowOptions);
  const iconBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: iconBounds.x, y: iconBounds.y });
  const [popupWidth] = popup.getSize();
  const centeredX = Math.round(iconBounds.x + iconBounds.width / 2 - popupWidth / 2);
  const minX = display.workArea.x + 8;
  const maxX = display.workArea.x + display.workArea.width - popupWidth - 8;
  const x = Math.min(Math.max(centeredX, minX), maxX);
  const y = Math.round(iconBounds.y + iconBounds.height + 6);
  popup.setPosition(x, y);
  popup.show();
  popup.focus();
}
