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
import { init as sentryInit } from '@sentry/electron/main';
import { join } from 'node:path';
import { URL } from 'node:url';

import {
  eventChannels,
  invokeChannels,
  type AuthSession,
  type TelegramPollResult,
  type TelegramStart,
} from '@shared/ipc';
import { clearSession, loadSession, saveSession } from './keychain';
import { loadPomodoro, savePomodoro } from './pomodoro_store';
import { checkForUpdates, quitAndInstall, startPeriodicCheck, wireUpdater } from './updater';

// Backend host. Hardcoded prod URL — bible §5: «Домены прода захардкожены»
// (см. hone/src/renderer/src/api/config.ts). Main can't import the renderer
// alias due to electron-vite's split bundles, so we duplicate the constant.
const API_BASE = 'https://druz9.online';

// Sentry: main-process handler. DSN приходит из env (HONE_SENTRY_DSN) в
// prod-билде через electron-builder config; пустая DSN → no-op, что
// позволяет разработчику запускать dev без внешних зависимостей.
const sentryDSN = process.env.HONE_SENTRY_DSN ?? '';
if (sentryDSN) {
  sentryInit({
    dsn: sentryDSN,
    release: `hone@${app.getVersion()}`,
    environment: process.env.NODE_ENV ?? 'production',
    // Sampling: 100% crashes main-process'а (их мало, каждый важен),
    // 10% renderer'а — ограничено инициализацией в renderer/index.tsx.
    tracesSampleRate: 0,
  });
}

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

  // Telegram code-flow IPC. Direct fetch to the backend — no /login web hop,
  // no druz9:// redirect dance. Replaces the historical LoginScreen flow that
  // depended on browser → custom-scheme handover (which Chrome blocks from
  // async contexts and which silently no-ops in dev when LaunchServices has
  // not registered the protocol).
  ipcMain.handle(invokeChannels.authTgStart, async (): Promise<TelegramStart> => {
    const res = await fetch(`${API_BASE}/api/v1/auth/telegram/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`telegram/start ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { code: string; deep_link: string; expires_at: string };
    return { code: body.code, deepLink: body.deep_link, expiresAt: body.expires_at };
  });

  ipcMain.handle(
    invokeChannels.authTgPoll,
    async (_e, code: string): Promise<TelegramPollResult> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/v1/auth/telegram/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      if (res.status === 202) return { kind: 'pending' };
      if (res.status === 410) return { kind: 'expired' };
      if (res.status === 429) {
        const retry = Number(res.headers.get('Retry-After') ?? '60');
        return { kind: 'rate_limited', retryAfter: Number.isFinite(retry) ? retry : 60 };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { kind: 'error', message: `poll ${res.status}: ${text}` };
      }
      const body = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        user?: { id?: string };
        is_new_user?: boolean;
      };
      const refresh = body.refresh_token ?? res.headers.get('X-Refresh-Token') ?? '';
      const session: AuthSession = {
        userId: body.user?.id ?? '',
        accessToken: body.access_token,
        refreshToken: refresh,
        expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : 0,
      };
      // Persist + broadcast so the renderer's session store hydrates without
      // the legacy druz9:// round-trip.
      await saveSession(session).catch(() => {
        // Keychain failure is non-fatal — session still flows to renderer.
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(eventChannels.authChanged, session);
      }
      return { kind: 'ok', session, isNewUser: Boolean(body.is_new_user) };
    },
  );

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

  ipcMain.handle(invokeChannels.updaterCheck, async () => {
    await checkForUpdates();
  });
  ipcMain.handle(invokeChannels.updaterInstall, async () => {
    quitAndInstall();
  });

  // ── Window ─────────────────────────────────────────────────────────────
  consumeColdStartURL();
  mainWindow = createMainWindow();

  // Updater: wire events to renderer + kick periodic check.
  wireUpdater(() => mainWindow);
  startPeriodicCheck();

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
