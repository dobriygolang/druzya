// window-manager.test.ts — pins the stealth boundary.
//
// Cue's setContentProtection(true) → NSWindowSharingNone is the product's
// moat: regress here на macOS update и customers видят AI-coach в Zoom
// без warning'а. Эти тесты не подменяют integration-проверки (см.
// native/stealth-verifier для real screen-capture), они стерегут the
// thing that's easy to break in code review:
//
//   1. STEALTHED_WINDOWS contract — добавил окно в createWindow без
//      добавления его в STEALTHED_WINDOWS, и setStealth(false) больше
//      не flippает его. Naked addition без test update = explicit signal.
//   2. setContentProtection вызвался при создании каждого stealth'ed
//      окна (компакт/expanded/history/picker/area-overlay/english-polish).
//   3. setContentProtection НЕ вызывался для onboarding / settings.
//   4. AlwaysOnTop + visibleOnAllWorkspaces применяется к floating-окнам
//      (без них stealth не помогает — окно прячется в IDE behind Zoom).
//   5. setStealth(false) → setContentProtection(false) на всех stealth'ed
//      окнах + opacity-toggle quirk (macOS не подхватывает sharingType
//      без re-render — см. window-manager.ts:583).
//
// Что не пытаемся тестировать: точные геометрии (тестируется визуально),
// blur-handlers (event'ы), restore-after-hide ghost-window fix (требует
// настоящего AppKit). Это OS-integration.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';

import type { WindowName } from '@shared/ipc';
import {
  STEALTHED_WINDOWS,
  NON_STEALTHED_WINDOWS,
  showWindow,
  setStealth,
  getStealth,
  closeWindow,
  type WindowOptions,
} from '../window-manager';

// Helper: pull the most-recently-constructed BrowserWindow instance from
// the mocked constructor. Each showWindow() call invokes `new BrowserWindow`
// inside createManagedWindow → buildWindow, so vi.mocked(BrowserWindow).mock
// holds them in order.
function lastWin() {
  const ctor = vi.mocked(BrowserWindow);
  const calls = ctor.mock.results;
  if (calls.length === 0) throw new Error('no BrowserWindow constructed yet');
  return calls[calls.length - 1].value as unknown as {
    setContentProtection: ReturnType<typeof vi.fn>;
    setAlwaysOnTop: ReturnType<typeof vi.fn>;
    setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
    setOpacity: ReturnType<typeof vi.fn>;
    getOpacity: ReturnType<typeof vi.fn>;
  };
}

const OPTS: WindowOptions = {
  preloadPath: '/tmp/preload.js',
  rendererURL: 'file:///app.html',
  isDev: false,
};

beforeEach(() => {
  // Tear down anything leftover from a previous test — STEALTHED_WINDOWS
  // is module-scoped Map, so re-opening 'compact' in a fresh test would
  // hit the early-return branch and never construct a new BrowserWindow.
  for (const name of [...STEALTHED_WINDOWS, ...NON_STEALTHED_WINDOWS] as WindowName[]) {
    try {
      closeWindow(name);
    } catch {
      /* nothing to close */
    }
  }
  vi.mocked(BrowserWindow).mockClear();
  // Reset stealth-toggle in case prior test flipped it.
  setStealth(true);
});

describe('STEALTHED_WINDOWS contract', () => {
  it('pins the stealth-eligible list', () => {
    // If you change this, you ALSO must:
    //   (a) audit createManagedWindow's per-name branches in window-manager.ts
    //   (b) re-run the smoke-stealth checklist (resources/smoke-stealth.md)
    //   (c) update native/stealth-verifier matrix
    expect([...STEALTHED_WINDOWS].sort()).toEqual([
      'area-overlay',
      'compact',
      'english-polish',
      'expanded',
      'history',
      'picker',
    ]);
  });

  it('non-stealthed list and stealthed list are disjoint', () => {
    for (const name of STEALTHED_WINDOWS) {
      expect(NON_STEALTHED_WINDOWS.has(name)).toBe(false);
    }
  });

  it('non-stealthed includes onboarding (runs before screen-share)', () => {
    expect(NON_STEALTHED_WINDOWS.has('onboarding')).toBe(true);
  });

  it('non-stealthed includes settings (system-level UI)', () => {
    expect(NON_STEALTHED_WINDOWS.has('settings')).toBe(true);
  });
});

describe('createManagedWindow — stealth application', () => {
  it.each(['compact', 'expanded', 'history'] as const)(
    'applies setContentProtection(true) to %s on create',
    (name) => {
      showWindow(name, OPTS);
      const w = lastWin();
      expect(w.setContentProtection).toHaveBeenCalledWith(true);
      // floating layer above fullscreen apps without stealing focus
      expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 1);
      expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true,
      });
    },
  );

  it('applies setContentProtection(true) to picker (one alwaysOnTop level higher)', () => {
    showWindow('picker', OPTS);
    const w = lastWin();
    expect(w.setContentProtection).toHaveBeenCalledWith(true);
    // picker rides above compact on floating layer 2 (see window-manager.ts:202)
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 2);
  });

  it('applies setContentProtection(true) to area-overlay (screen-saver layer)', () => {
    showWindow('area-overlay', OPTS);
    const w = lastWin();
    expect(w.setContentProtection).toHaveBeenCalledWith(true);
    // area overlay sits on screen-saver layer to top everything
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 2);
  });

  it('applies setContentProtection(true) to english-polish', () => {
    showWindow('english-polish', OPTS);
    const w = lastWin();
    expect(w.setContentProtection).toHaveBeenCalledWith(true);
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 1);
    expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
  });

  it('does NOT apply setContentProtection to onboarding', () => {
    // Onboarding runs before the user starts sharing — stealth would
    // make the wizard invisible during the C2 InvisibleDemoScreen pitch.
    showWindow('onboarding', OPTS);
    const w = lastWin();
    expect(w.setContentProtection).not.toHaveBeenCalled();
    expect(w.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('does NOT apply setContentProtection to settings', () => {
    showWindow('settings', OPTS);
    const w = lastWin();
    expect(w.setContentProtection).not.toHaveBeenCalled();
    expect(w.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});

describe('setStealth — runtime toggle', () => {
  it('persists state via getStealth()', () => {
    expect(getStealth()).toBe(true);
    setStealth(false);
    expect(getStealth()).toBe(false);
    setStealth(true);
    expect(getStealth()).toBe(true);
  });

  it('flips setContentProtection for every stealthed window', () => {
    // Spin up the full stealth roster.
    showWindow('compact', OPTS);
    showWindow('expanded', OPTS);
    showWindow('history', OPTS);
    const ctor = vi.mocked(BrowserWindow);
    const compactWin = ctor.mock.results[0].value as ReturnType<typeof lastWin>;
    const expandedWin = ctor.mock.results[1].value as ReturnType<typeof lastWin>;
    const historyWin = ctor.mock.results[2].value as ReturnType<typeof lastWin>;

    // Clear the initial setContentProtection(true) call from create.
    compactWin.setContentProtection.mockClear();
    expandedWin.setContentProtection.mockClear();
    historyWin.setContentProtection.mockClear();

    setStealth(false);
    expect(compactWin.setContentProtection).toHaveBeenCalledWith(false);
    expect(expandedWin.setContentProtection).toHaveBeenCalledWith(false);
    expect(historyWin.setContentProtection).toHaveBeenCalledWith(false);
  });

  it('does NOT flip setContentProtection on non-stealthed windows', () => {
    showWindow('settings', OPTS);
    const settingsWin = lastWin();
    settingsWin.setContentProtection.mockClear();
    setStealth(false);
    expect(settingsWin.setContentProtection).not.toHaveBeenCalled();
  });

  it('opacity micro-toggle on macOS sharingType-cache quirk', () => {
    // window-manager.ts:583 micro-toggles opacity after setContentProtection
    // so AppKit re-reads NSWindow.sharingType — without this Zoom keeps
    // showing the old (visible/invisible) state until app restart.
    showWindow('compact', OPTS);
    const w = lastWin();
    // The mock returns isVisible=true by default — that's the path that
    // triggers the opacity toggle.
    w.setOpacity.mockClear();
    setStealth(false);
    // Two setOpacity calls: prev - 0.01 then back to prev (or 1).
    expect(w.setOpacity.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
