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

import { eventChannels, type PickerKind, type WindowName } from '@shared/ipc';

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

  // Compact window: restore last drag position ("follows your eyes"
  // feature — user drags compact to wherever they're looking and it
  // stays there across sessions). Width/height stay at the defaults
  // (compact is non-resizable) but x/y persist. Debounced save
  // mirrors the expanded pattern.
  if (name === 'compact') {
    void loadAppearance().then((prefs) => {
      if (prefs.compactBounds && !win.isDestroyed()) {
        const b = prefs.compactBounds;
        const display = screen.getDisplayMatching({
          x: b.x, y: b.y, width: 460, height: 92,
        });
        // Clamp to keep the window on-screen — a saved position from
        // a detached external monitor would orphan compact otherwise.
        // Use 20px inset so a fully-offscreen drag also stays reachable.
        const clamped = {
          x: Math.max(display.bounds.x + 20, Math.min(b.x, display.bounds.x + display.bounds.width - 100)),
          y: Math.max(display.bounds.y + 20, Math.min(b.y, display.bounds.y + display.bounds.height - 100)),
          width: 460,
          height: 92,
        };
        win.setBounds(clamped);
      }
    });
    let compactSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCompactSave = () => {
      if (compactSaveTimer) clearTimeout(compactSaveTimer);
      compactSaveTimer = setTimeout(() => {
        compactSaveTimer = null;
        if (win.isDestroyed()) return;
        // Only persist position (width/height are fixed for compact)
        // but we store the whole rect to reuse AppearancePrefs shape.
        void saveAppearance({ compactBounds: win.getBounds() });
      }, 400);
    };
    win.on('move', scheduleCompactSave);
  }

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

  if (name === 'picker') {
    // Picker rides above compact — same stealth treatment, one level
    // higher so it sits on top of the compact's floating layer.
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'floating', 2);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Auto-hide on blur so clicking anywhere outside dismisses the
    // dropdown — matches the expected popup menu UX. Compact keeps
    // focus of the parent input, so this fires when the user clicks
    // back on the compact chrome or any other app.
    win.on('blur', () => {
      if (!win.isDestroyed()) hideWindow('picker');
    });
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
    picker: '#/picker',
    toast: '#/toast',
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
  // Broadcast picker-close so the compact can drop the caret-open state
  // on whichever pill was active. No-op for other windows.
  if (name === 'picker') {
    // Remember which kind was closed + when — the blur-race guard in
    // showPicker reads this to swallow the immediate re-open that
    // happens when a user clicks the SAME pill that was anchoring the
    // now-closing picker.
    lastPickerHideKind = pickerKind;
    lastPickerHideAt = Date.now();
    pickerKind = null;
    broadcast(eventChannels.pickerStateChanged, { kind: null });
  }
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

/**
 * Show (or toggle-close) the floating picker window anchored below the
 * compact window. Each kind gets a different anchor x within compact:
 *   - 'model'   — under the model pill (left side of row 2, ~58px in)
 *   - 'persona' — under the persona chip (center-right, ~200px in)
 *
 * Clicking the same kind again closes the picker. Clicking a different
 * kind switches to it (by reloading the renderer URL with the new hash).
 */
export function showPicker(kind: PickerKind, opts: WindowOptions): void {
  const compact = windows.get('compact');
  if (!compact || compact.isDestroyed()) return;

  // Swallow rapid re-opens caused by the blur→click race. When the user
  // clicks the SAME pill that's currently anchoring an open picker, the
  // sequence on macOS is:
  //   (a) mousedown lands on compact → compact gains focus
  //   (b) picker window blurs → hideWindow('picker') runs (see blur
  //       handler in buildWindow), which clears pickerKind=null
  //   (c) compact's onClick fires → IPC showPicker(<same kind>)
  //       arrives here, but pickerKind is already null so the "toggle
  //       close" branch (kind match) never fires — we'd re-open.
  // Fix: if the very same kind was closed in the last 250ms, treat
  // the new call as the user's intended "click to close" and stay shut.
  const now = Date.now();
  if (
    lastPickerHideKind === kind &&
    now - lastPickerHideAt < 250
  ) {
    lastPickerHideKind = null;
    lastPickerHideAt = 0;
    return;
  }

  const cBounds = compact.getBounds();
  const PICKER_W = 320;
  const PICKER_H = 340;
  const GAP = 6;

  // Anchor offsets inside compact. Model pill lives in row 2 at ~58px
  // from left; persona chip at ~200px. Picker centers below the chip
  // and is clamped to stay fully on-screen.
  const anchorXFromLeft = kind === 'model' ? 58 : 210;
  let x = cBounds.x + anchorXFromLeft - PICKER_W / 2 + 40;
  let y = cBounds.y + cBounds.height + GAP;

  // Clamp to the display containing compact.
  const display = screen.getDisplayMatching(cBounds);
  x = Math.max(display.bounds.x + 4, Math.min(x, display.bounds.x + display.bounds.width - PICKER_W - 4));
  y = Math.max(display.bounds.y + 4, Math.min(y, display.bounds.y + display.bounds.height - PICKER_H - 4));

  const existing = windows.get('picker');
  // If picker is already open with this kind → toggle close.
  if (existing && !existing.isDestroyed() && existing.isVisible()) {
    const currentKind = pickerKind;
    if (currentKind === kind) {
      hideWindow('picker');
      return;
    }
    // Switching kind: reload URL with new hash + reposition.
    pickerKind = kind;
    existing.setBounds({ x, y, width: PICKER_W, height: PICKER_H });
    const url = `${opts.rendererURL}#/picker?kind=${kind}`;
    void existing.loadURL(url);
    existing.setIgnoreMouseEvents(false);
    existing.setOpacity(1);
    existing.show();
    broadcast(eventChannels.pickerStateChanged, { kind });
    return;
  }

  pickerKind = kind;
  const win = showWindow('picker', opts);
  win.setBounds({ x, y, width: PICKER_W, height: PICKER_H });
  // Override the default hash (set in hashFor) with the kind query
  // so PickerScreen knows which dropdown to render.
  const url = `${opts.rendererURL}#/picker?kind=${kind}`;
  void win.loadURL(url);
  broadcast(eventChannels.pickerStateChanged, { kind });
}

// Track the currently-mounted picker kind so toggle-close works.
let pickerKind: PickerKind | null = null;
// Track the last-closed picker kind + timestamp for the blur-race fix.
// See the guard at the top of showPicker().
let lastPickerHideKind: PickerKind | null = null;
let lastPickerHideAt = 0;

// ─────────────────────────────────────────────────────────────────────────
// Toast — ephemeral notification anchored beside compact.
// ─────────────────────────────────────────────────────────────────────────

let toastDismissTimer: ReturnType<typeof setTimeout> | null = null;

export interface ToastShowOpts {
  msg: string;
  kind: 'error' | 'warn' | 'info';
  /** Auto-dismiss after this many ms. 0 = stay until user closes. */
  ttlMs?: number;
}

/** Show or update the floating toast window next to compact. The
 *  message + kind travel to the renderer via hash-fragment params, so
 *  the toast renders instantly without an extra IPC round-trip. */
export function showToast(opts: ToastShowOpts, wopts: WindowOptions): void {
  const compact = windows.get('compact');
  const ttl = opts.ttlMs ?? 6000;

  // Position: below the compact window, aligned to its right edge, 6px gap.
  // Fall back to primary display top-right when compact isn't open.
  const TOAST_W = 360;
  const TOAST_H = 90;
  const GAP = 6;
  let x: number;
  let y: number;
  if (compact && !compact.isDestroyed()) {
    const cb = compact.getBounds();
    x = cb.x + cb.width - TOAST_W;
    y = cb.y + cb.height + GAP;
  } else {
    const d = screen.getPrimaryDisplay().bounds;
    x = d.x + d.width - TOAST_W - 16;
    y = d.y + 16;
  }
  // Clamp inside the display containing the anchor point.
  const display = screen.getDisplayMatching({ x, y, width: TOAST_W, height: TOAST_H });
  x = Math.max(display.bounds.x + 4, Math.min(x, display.bounds.x + display.bounds.width - TOAST_W - 4));
  y = Math.max(display.bounds.y + 4, Math.min(y, display.bounds.y + display.bounds.height - TOAST_H - 4));

  const existing = windows.get('toast');
  const params = new URLSearchParams({ msg: opts.msg, kind: opts.kind });
  const url = `${wopts.rendererURL}#/toast?${params.toString()}`;
  if (existing && !existing.isDestroyed()) {
    existing.setBounds({ x, y, width: TOAST_W, height: TOAST_H });
    void existing.loadURL(url);
    existing.showInactive();
  } else {
    const win = showWindow('toast', wopts);
    win.setBounds({ x, y, width: TOAST_W, height: TOAST_H });
    void win.loadURL(url);
  }

  // Restart the auto-dismiss timer. Multiple quick toasts → only the
  // last one's timer is active.
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  if (ttl > 0) {
    toastDismissTimer = setTimeout(() => {
      toastDismissTimer = null;
      hideWindow('toast');
    }, ttl);
  }
}

export function hideToast(): void {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  hideWindow('toast');
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
        frame: false,
        resizable: false,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        // width/height are emitted by topRightPosition() along with x/y
        // so the placement and size stay in lockstep.
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
      // No vibrancy — the feature was abandoned after macOS Tahoe
      // (26.x) shipped a regression that broke NSVisualEffectView
      // attach on windows with a custom frame. Instead we use plain
      // `transparent: true` and let the React root paint an RGBA
      // background: you get the crisp tinted-glass look without any
      // OS blur. See desktop/src/renderer/screens/expanded for the
      // CSS side of this story.
      return new BrowserWindow({
        ...base,
        frame: false,
        resizable: true,
        transparent: true,
        backgroundColor: '#00000000', // fully clear so RGBA content shows through
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        // Ignored when loadedBounds overrides below — but still used as
        // fallback if preferences fail to load. width/height come from
        // topRightPosition() along with x/y.
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
        title: 'Cue — Settings',
        resizable: true,
      });
    case 'onboarding':
      return new BrowserWindow({
        ...base,
        width: 760,
        height: 580,
        title: 'Cue',
        resizable: false,
        center: true,
      });
    case 'history':
      return new BrowserWindow({
        ...base,
        frame: false,
        resizable: true,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        skipTaskbar: true,
        // width/height come from topRightPosition().
        ...topRightPosition(560, 720, 140),
      });
    case 'picker': {
      // Floating glass panel anchored under the compact window. The
      // renderer paints its own background — window stays fully
      // transparent and frameless, no shadow (glass does it via CSS).
      return new BrowserWindow({
        ...base,
        width: 320,
        height: 360,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        roundedCorners: false, // dropdown corners handled in CSS
        focusable: true,
      });
    }
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
    case 'toast': {
      // Floating notification panel anchored under compact. Same
      // frameless-transparent treatment as the picker — renderer paints
      // its own glass. Always-on-top + focusable: false so clicking a
      // toast doesn't steal focus from whatever the user is typing into.
      return new BrowserWindow({
        ...base,
        width: 360,
        height: 90,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
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
