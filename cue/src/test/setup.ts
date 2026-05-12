// setup.ts — global test bootstrap for Cue.
//
// Cue's main-process тестируется без живого Electron: vi.mock('electron')
// ниже подменяет BrowserWindow на vitest spy с поверхностью, которой
// касается код-under-test. Каждый тест может перезаписать конкретный
// member через `vi.mocked(BrowserWindow)`.
//
// Зачем default mock'и здесь, а не per-file: window-manager и hardening
// импортируют electron transitively через chain'ы (settings/appearance,
// например). Без default-mock'а первый импорт rebuiлдил бы native binding'и.
//
// Что НЕ мокается:
//   • node:child_process — freeze-bridge тестит spawn-протокол, потому
//     spawn'аем настоящий /bin/cat и пишем команды через stdin.
//   • node:fs — masquerade-validation читает yaml-файлы реальные.

import { afterEach, vi } from 'vitest';

// ─── Electron API stub ───────────────────────────────────────────────────
// Минимальный shape: достаточно для window-manager / hardening / permissions.
// Каждый тест может перезаписать member'ы через vi.mocked(...).mockReturnValue.

// Default factory for a fake BrowserWindow instance. Exported so tests
// can override defaults if needed.
const browserWindowFactory = () => ({
  setContentProtection: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
  setIgnoreMouseEvents: vi.fn(),
  setOpacity: vi.fn(),
  setBounds: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 460, height: 92 })),
  getOpacity: vi.fn(() => 1),
  isVisible: vi.fn(() => true),
  isDestroyed: vi.fn(() => false),
  show: vi.fn(),
  hide: vi.fn(),
  showInactive: vi.fn(),
  focus: vi.fn(),
  close: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  once: vi.fn(),
  webContents: {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    getURL: vi.fn(() => 'file:///app.html'),
    isLoading: vi.fn(() => false),
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    session: {
      setPermissionRequestHandler: vi.fn(),
    },
  },
});

vi.mock('electron', () => {
  // BrowserWindow class — конструктор возвращает объект с spy-методами.
  // Тесты intercept'ят через mock.results[i].value.<method>.
  //
  // We use a regular function (not vi.fn) for the constructor itself, but
  // attach mock-tracking by hand via vi.fn() wrapping. Direct `vi.fn()`
  // with mockImplementation breaks under vi.restoreAllMocks() — restore
  // wipes the implementation and the factory starts returning undefined.
  const BrowserWindow = vi.fn(browserWindowFactory);

  // screen — used by window-manager for top-right positioning + bounds clamping.
  const screen = {
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      displayFrequency: 60,
    })),
    getDisplayMatching: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    })),
  };

  // shell — hardening only uses openExternal.
  const shell = {
    openExternal: vi.fn().mockResolvedValue(undefined),
  };

  // systemPreferences — permissions/macos.ts probes via these.
  const systemPreferences = {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    isTrustedAccessibilityClient: vi.fn(() => true),
    askForMediaAccess: vi.fn().mockResolvedValue(true),
  };

  // desktopCapturer — permissions/macos.ts uses it to trigger TCC prompt.
  const desktopCapturer = {
    getSources: vi.fn().mockResolvedValue([]),
  };

  return {
    BrowserWindow,
    screen,
    shell,
    systemPreferences,
    desktopCapturer,
    app: {
      getPath: vi.fn(() => '/tmp/cue-test'),
      getVersion: vi.fn(() => '0.1.0'),
      on: vi.fn(),
      whenReady: vi.fn().mockResolvedValue(undefined),
    },
  };
});

afterEach(() => {
  // Clear call history but KEEP implementations. `vi.restoreAllMocks()`
  // would wipe the BrowserWindow factory's mockImplementation, и
  // следующий тест получил бы `new BrowserWindow()` → undefined →
  // «Cannot read properties of undefined (reading 'webContents')» при
  // первой попытке hardenWindow.
  vi.clearAllMocks();
});
