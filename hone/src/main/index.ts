// Main-process entry for Hone.
//
// Owns: single BrowserWindow, druz9:// protocol handling, encrypted
// auth-session persistence, pomodoro snapshot persistence. Тонкий слой
// — все продуктовые решения остаются в renderer'е.
//
// Auth flow:
//   1. Renderer без accessToken показывает LoginScreen.
//   2. Click «Sign in» → открыть в браузере
//      `https://druz9.ru/login?desktop=druz9://auth`.
//   3. Web после успешного OAuth callback'а проверяет ?desktop=...
//      и редиректит туда с access_token + refresh_token + user_id.
//   4. macOS/Windows OS триггерит open-url / second-instance с
//      druz9://auth?token=...&refresh=...&user=...
//   5. routeDeepLink парсит, шлёт в renderer через authChanged event,
//      также сохраняет в keychain через safeStorage.
//
// Deep-link routes:
//   druz9://auth?token=...&refresh=...&user=...&exp=ms
//   druz9://focus/start?task=<plan-item-id>&title=<urlenc-title>
//   druz9://focus  (free-form focus, без plan-item)
//
// Любой URL не из этих — forward'им в renderer как generic event,
// renderer решает что делать (или ignore).

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { URL } from 'node:url';

import { eventChannels, invokeChannels, type AuthSession } from '@shared/ipc';
import { clearSession, loadSession, saveSession } from './keychain';
import { loadPomodoro, savePomodoro } from './pomodoro_store';

// druz9:// scheme registration.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('druz9', process.execPath, [process.argv[1]!]);
  }
} else {
  app.setAsDefaultProtocolClient('druz9');
}

// Single-instance lock: when the user clicks a druz9:// link from the
// browser while Hone is already running, the OS spawns a second process
// and then hands the URL to the first via the `second-instance` event.
// Without the lock the URL would simply open a new window and nothing
// would route.
//
// DEV CAVEAT: raw Electron.app shares the com.github.electron bundle id
// with every other dev Electron session — skip the lock under
// electron-vite.
if (!process.env.ELECTRON_RENDERER_URL) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }
}

app.setName('Hone');
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Hone',
    applicationVersion: app.getVersion(),
  });
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Route external links to the system browser so users don't get
  // stuck in an in-app webview.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// pendingDeepLink — URL пришёл до того как окно создалось / готово.
// Сохраняем и доставим после ready-to-show.
let pendingDeepLink: string | null = null;

function dispatchDeepLink(url: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingDeepLink = url;
    return;
  }

  // druz9://auth — extract tokens, persist, broadcast authChanged.
  if (url.startsWith('druz9://auth')) {
    const session = parseAuthURL(url);
    if (session) {
      void saveSession(session).catch(() => {
        // Не падаем: даже если keychain не доступен, рендереру всё
        // равно скажем «есть сессия» — она проживёт до перезапуска.
      });
      mainWindow.webContents.send(eventChannels.authChanged, session);
    }
  }

  // druz9://focus[/start][?task=...&title=...] — рендерер сам решит.
  // Generic forward для всех остальных.
  mainWindow.webContents.send(eventChannels.deepLink, { url });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function parseAuthURL(raw: string): AuthSession | null {
  try {
    const u = new URL(raw);
    const token = u.searchParams.get('token');
    const userId = u.searchParams.get('user');
    if (!token || !userId) return null;
    return {
      userId,
      accessToken: token,
      refreshToken: u.searchParams.get('refresh') ?? '',
      expiresAt: Number(u.searchParams.get('exp') ?? 0),
    };
  } catch {
    return null;
  }
}

app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('druz9://'));
  if (url) dispatchDeepLink(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// macOS: the OS delivers druz9:// links here when Hone is already running.
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchDeepLink(url);
});

// При cold-start с deep-link'ом argv содержит URL — обработаем после
// того как окно готово.
function consumeColdStartURL(): void {
  const url = process.argv.find((a) => a.startsWith('druz9://'));
  if (url) pendingDeepLink = url;
}

app.whenReady().then(() => {
  // ── IPC ────────────────────────────────────────────────────────────────
  ipcMain.handle(invokeChannels.appVersion, () => app.getVersion());

  ipcMain.handle(invokeChannels.authSession, async () => {
    return await loadSession();
  });

  ipcMain.handle(invokeChannels.authPersist, async (_e, session: AuthSession) => {
    await saveSession(session);
  });

  ipcMain.handle(invokeChannels.authLogout, async () => {
    await clearSession();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(eventChannels.authChanged, null);
    }
  });

  ipcMain.handle(invokeChannels.pomodoroLoad, async () => await loadPomodoro());
  ipcMain.handle(invokeChannels.pomodoroSave, async (_e, snap) => {
    await savePomodoro(snap);
  });

  ipcMain.handle(invokeChannels.shellOpenExternal, async (_e, url: string) => {
    // Whitelist схем: открываем только http(s) — иначе риск
    // исполнить локальный protocol handler из renderer'а.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  // ── Window ─────────────────────────────────────────────────────────────
  consumeColdStartURL();
  mainWindow = createMainWindow();

  // Доставка отложенного deep-link'а после первого render'а.
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingDeepLink) {
      const url = pendingDeepLink;
      pendingDeepLink = null;
      dispatchDeepLink(url);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
