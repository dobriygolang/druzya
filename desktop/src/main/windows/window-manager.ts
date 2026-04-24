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

import { loadAppearance, saveAppearance } from '../settings/appearance';
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
    // Undo the click-through / opacity dimming we applied on hide (see
    // hideWindow). On macOS a transparent always-on-top window can leave
    // a ghost surface after hide() that still catches mouse events —
    // setIgnoreMouseEvents(true) at hide time prevents that; we flip it
    // back here when the user brings the window back.
    existing.setIgnoreMouseEvents(false);
    existing.setOpacity(1);
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

  // Expanded window: restore last-known bounds (from appearance.json)
  // + persist new bounds whenever the user finishes resizing/moving.
  // 'resize' / 'move' fire on every drag tick so we coalesce with a
  // short debounce — writing JSON 60 times during a single drag is
  // wasteful and can throw EAGAIN in edge cases.
  if (name === 'expanded') {
    void loadAppearance().then((prefs) => {
      if (prefs.expandedBounds && !win.isDestroyed()) {
        const b = prefs.expandedBounds;
        // Clamp to the current display bounds — a saved position that
        // points to a now-unplugged external monitor would leave the
        // window offscreen otherwise.
        const display = screen.getDisplayMatching(b);
        const clamped = {
          x: Math.max(display.bounds.x, Math.min(b.x, display.bounds.x + display.bounds.width - 100)),
          y: Math.max(display.bounds.y, Math.min(b.y, display.bounds.y + display.bounds.height - 100)),
          width: Math.max(360, Math.min(b.width, display.bounds.width)),
          height: Math.max(240, Math.min(b.height, display.bounds.height)),
        };
        win.setBounds(clamped);
      }
    });
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (win.isDestroyed()) return;
        void saveAppearance({ expandedBounds: win.getBounds() });
      }, 400);
    };
    win.on('resize', scheduleSave);
    win.on('move', scheduleSave);
  }

  // macOS Tahoe (26.x) regression: vibrancy set via the BrowserWindow
  // constructor sometimes fails to attach to the NSVisualEffectView
  // backing layer — the window ends up with transparent: true but no
  // blur, and CSS alpha alone looks like a "brightness fade" rather
  // than the frosted-glass effect. Re-applying vibrancy after the
  // first paint reliably wires it up. Also force 'active' state so
  // the blur doesn't dim when the window loses focus.
  if (process.platform === 'darwin' && name === 'expanded') {
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      try {
        win.setVibrancy('hud');
        win.setBackgroundColor('#00000000');
      } catch {
        /* setVibrancy may throw on non-macOS or very old macOS — ignore */
      }
    });
  }

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
  if (!w || w.isDestroyed()) return;
  // macOS leaves a "ghost" surface after hide() on transparent +
  // always-on-top + visibleOnAllWorkspaces windows: the pixels disappear
  // but the window still grabs mouse clicks, so apps underneath become
  // unclickable in that rectangle. Belt-and-suspenders:
  //   1. setIgnoreMouseEvents(true) — even if AppKit re-displays the
  //      surface, clicks fall through to whatever is behind.
  //   2. setOpacity(0) — collapses any residual render.
  //   3. hide() — removes from the window list.
  try {
    w.setIgnoreMouseEvents(true, { forward: false });
    w.setOpacity(0);
  } catch {
    /* setIgnoreMouseEvents/setOpacity are no-ops on some platforms */
  }
  w.hide();
}

/**
 * Fully tear down a window. Use this when the renderer's transient state
 * (drag coords, event listeners) would poison the next invocation if
 * reused — e.g. the area-overlay crosshair picker.
 */
export function closeWindow(name: WindowName): void {
  const w = windows.get(name);
  windows.delete(name);
  if (w && !w.isDestroyed()) w.close();
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
    case 'expanded': {
      // Restore last user-set bounds (width/height/position) when the
      // user has resized or moved the window previously. On fresh
      // installs we fall back to the default tall preset. Bounds are
      // persisted on the 'close' handler below.
      //
      // vibrancy: 'under-window' enables macOS native blur on whatever
      // sits under the window. Combined with transparent: true and a
      // semi-transparent background color on the React root, the user
      // gets the frosted-glass look of macOS system sheets without any
      // third-party compositing. No-op on Windows/Linux (falls through
      // to plain transparent window).
      return new BrowserWindow({
        ...base,
        width: 520,
        height: 680,
        frame: false,
        resizable: true,
        transparent: true,
        // 'hud' is the strongest desktop-blur material; 'under-window'
        // from macOS 10.14 produces near-zero visible blur on Tahoe
        // (26.x) — swapping material brought the effect back. We also
        // re-apply via setVibrancy() after 'ready-to-show' below as a
        // workaround for the constructor-time regression.
        vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
        // 'active' keeps the blur visible even when the window is not
        // focused. Default 'followsWindowActiveState' dims to a boring
        // solid color on blur, which defeats the point of vibrancy.
        visualEffectState: 'active',
        backgroundColor: '#00000000', // fully clear for vibrancy to show
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        // Ignored when loadedBounds overrides below — but still used as
        // fallback if preferences fail to load.
        ...topRightPosition(520, 680, 120),
      });
    }
    case 'settings':
      // Reverted transparent + vibrancy: on macOS Tahoe (26.x) the
      // combination `transparent: true` with the default window frame
      // breaks the title-bar NSView — the traffic-light buttons stop
      // receiving clicks and the title-bar drag region dies. Users
      // reported Settings becoming "frozen" (no close/move/minimize).
      // Settings stays opaque; the appearance slider still affects
      // the chat (expanded) window where transparency is the real
      // product value. If Electron fixes the frame-vs-transparent
      // regression on Tahoe, re-enable here.
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
