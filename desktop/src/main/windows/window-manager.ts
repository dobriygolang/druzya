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

import type { WindowName } from '@shared/ipc';

import { hardenWindow } from './hardening';

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
  hardenWindow(win);
  windows.set(name, win);

  win.on('closed', () => {
    windows.delete(name);
  });

  // Compact + expanded + history are stealth by default. Settings /
  // onboarding render system-level prompts, so we leave them visible
  // to the viewer.
  if (name === 'compact' || name === 'expanded' || name === 'history') {
    // setContentProtection on macOS uses NSWindowSharingNone: viewers of
    // a screen share see the desktop background where this window is.
    win.setContentProtection(true);
    // Sit above fullscreen apps (IDE, browser) without stealing focus.
    win.setAlwaysOnTop(true, 'floating', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // The area-overlay is also stealthed: the crosshair itself should not
  // appear on the viewer's screen. The OS-level cursor still does (that
  // is the Phase 6 virtual-cursor feature), but the selection UI is ours.
  if (name === 'area-overlay') {
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'screen-saver', 2);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const hashFor: Record<WindowName, string> = {
    compact: '#/compact',
    expanded: '#/expanded',
    settings: '#/settings',
    onboarding: '#/onboarding',
    'area-overlay': '#/area-overlay',
    history: '#/history',
  };
  const url = `${opts.rendererURL}${hashFor[name]}`;
  void win.loadURL(url);

  // Show the window once its first paint is ready. The `show: false`
  // default in buildWindow prevents the flash of un-styled background
  // that would otherwise be visible (transparent + frameless). Without
  // calling show() explicitly here, the window stays invisible forever.
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  // Safety net: if ready-to-show doesn't fire within 2s (happens on
  // renderer bundle errors), force-show the window so the user at
  // least sees the system frame / can open devtools.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 2000);

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

/**
 * Animated resize — keeps the compact window's top-right corner pinned
 * while height grows (when an attachment is staged) or shrinks back.
 * No-op on non-existent or destroyed windows.
 */
export function resizeWindow(name: WindowName, width: number, height: number): void {
  const w = windows.get(name);
  if (!w || w.isDestroyed()) return;
  const bounds = w.getBounds();
  // Pin the top-right corner so the window feels "anchored" as content
  // reflows downward. On windows that track an explicit corner (compact,
  // expanded, history) this matches the initial placement.
  const newX = bounds.x + (bounds.width - width);
  w.setBounds({ x: newX, y: bounds.y, width, height }, true);
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
    case 'history':
      return new BrowserWindow({
        ...base,
        width: 560,
        height: 720,
        frame: false,
        resizable: true,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        ...topRightPosition(560, 720, 140),
      });
    case 'area-overlay': {
      // Full primary-display overlay. We intentionally do NOT use
      // fullscreen: true — that would trigger macOS fullscreen space
      // transitions and flicker. A frameless, always-on-top window sized
      // to the workArea is faster and feels like a native overlay.
      const pa = screen.getPrimaryDisplay().bounds;
      return new BrowserWindow({
        ...base,
        x: pa.x,
        y: pa.y,
        width: pa.width,
        height: pa.height,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        focusable: true,
        // No rounded corners — full-bleed.
        roundedCorners: false,
      });
    }
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
