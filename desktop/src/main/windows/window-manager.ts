// Window manager: keeps one live BrowserWindow per semantic window name
// and applies the stealth treatment consistently.
//
// Stealth is the product's moat: setContentProtection(true) makes the
// window invisible to screen-capture SDKs (Zoom, Meet, Chrome's
// getDisplayMedia) on macOS via NSWindowSharingNone. Every window the
// user interacts with must be stealthed; permissions and onboarding
// screens intentionally are not, since they run only before the user
// starts sharing.

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import type { WindowName } from '@shared/ipc';

const windows = new Map<WindowName, BrowserWindow>();

export interface WindowOptions {
  preloadPath: string;
  rendererURL: string; // dev server URL or file://.../renderer/index.html
  isDev: boolean;
}

/**
 * Creates (or returns the existing) stealth window by name. Geometry and
 * chrome flags are tuned per-window; stealth content protection is applied
 * to every floating window.
 */
export function showWindow(name: WindowName, opts: WindowOptions): BrowserWindow {
  const existing = windows.get(name);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const win = buildWindow(name, opts);
  windows.set(name, win);

  win.on('closed', () => {
    windows.delete(name);
  });

  // Compact + expanded are stealth by default. Settings / onboarding
  // render system-level prompts, so we leave them visible to the viewer.
  if (name === 'compact' || name === 'expanded') {
    // setContentProtection on macOS uses NSWindowSharingNone: viewers of
    // a screen share see the desktop background where this window is.
    win.setContentProtection(true);
    // Sit above fullscreen apps (IDE, browser) without stealing focus.
    win.setAlwaysOnTop(true, 'floating', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const hashFor: Record<WindowName, string> = {
    compact: '#/compact',
    expanded: '#/expanded',
    settings: '#/settings',
    onboarding: '#/onboarding',
  };
  const url = opts.isDev
    ? `${opts.rendererURL}${hashFor[name]}`
    : `${opts.rendererURL}${hashFor[name]}`;
  void win.loadURL(url);

  return win;
}

export function hideWindow(name: WindowName): void {
  const w = windows.get(name);
  if (w && !w.isDestroyed()) w.hide();
}

export function getWindow(name: WindowName): BrowserWindow | undefined {
  const w = windows.get(name);
  return w && !w.isDestroyed() ? w : undefined;
}

export function broadcast(channel: string, payload: unknown): void {
  for (const w of windows.values()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Toggle stealth on all floating windows (used by settings tab). */
export function setStealth(on: boolean): void {
  for (const [name, w] of windows.entries()) {
    if (w.isDestroyed()) continue;
    if (name === 'compact' || name === 'expanded') {
      w.setContentProtection(on);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────

function buildWindow(name: WindowName, opts: WindowOptions): BrowserWindow {
  const base = {
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for keytar via preload
    },
    show: false,
  };

  switch (name) {
    case 'compact':
      return new BrowserWindow({
        ...base,
        width: 460,
        height: 92,
        frame: false,
        resizable: false,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        ...topRightPosition(460, 92),
      });
    case 'expanded':
      return new BrowserWindow({
        ...base,
        width: 520,
        height: 680,
        frame: false,
        resizable: true,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        ...topRightPosition(520, 680, 120),
      });
    case 'settings':
      return new BrowserWindow({
        ...base,
        width: 720,
        height: 720,
        title: 'Druz9 Copilot — Settings',
        resizable: true,
      });
    case 'onboarding':
      return new BrowserWindow({
        ...base,
        width: 760,
        height: 580,
        title: 'Druz9 Copilot',
        resizable: false,
        center: true,
      });
    default:
      throw new Error(`unknown window name: ${name satisfies never}`);
  }
}

/** Top-right corner of the primary display, inset by a few pixels. */
function topRightPosition(width: number, height: number, topOffset = 40) {
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: primary.x + primary.width - width - 20,
    y: primary.y + topOffset,
    width,
    height,
  };
}
