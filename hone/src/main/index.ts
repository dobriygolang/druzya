// Main-process entry for Hone. Creates a single main window, wires the
// minimal IPC surface, and that's it — no tray, no stealth trickery, no
// global hotkeys. Those belong to the stealth/copilot app (`desktop/`).
//
// The deep-link handler is registered so `druz9://focus/start?task=…`
// can hand off to the focus UI once we wire it. For v0 it's a no-op
// forwarder that broadcasts the URL to the renderer.

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';

import { eventChannels, invokeChannels } from '@shared/ipc';

// druz9:// scheme registration — shared with the wider ecosystem so
// both Hone and the stealth app can claim URL callbacks. macOS routes
// to the most-recently-registered handler; that's fine for MVP.
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
// DEV CAVEAT (mirrors desktop/): raw Electron.app shares the
// com.github.electron bundle id with every other dev Electron session
// on the machine, so the lock false-positives collide with VS Code /
// Claude Desktop / Slack dev builds. Skip the lock when we detect we're
// running under electron-vite.
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
    // Hone is a calm, non-competitive tool — no always-on-top, no
    // frameless, no content-protection tricks. Those are the stealth
    // app's moat; mixing them here would leak the "I'm hiding from
    // screen share" signal into a product that doesn't need it.
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
  // stuck in an in-app webview — druz9.ru and GitHub deep-links are
  // always more useful in their real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function routeDeepLink(url: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(eventChannels.deepLink, { url });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('druz9://'));
  if (url) routeDeepLink(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// macOS: the OS delivers druz9:// links here when Hone is already running.
app.on('open-url', (event, url) => {
  event.preventDefault();
  routeDeepLink(url);
});

app.whenReady().then(() => {
  // Minimal IPC surface — more handlers land here as we wire Connect-RPC
  // and keychain-backed auth. STUB: logout is a placeholder until the
  // shared/electron-core auth module exists.
  ipcMain.handle(invokeChannels.appVersion, () => app.getVersion());
  ipcMain.handle(invokeChannels.authSession, () => null);
  ipcMain.handle(invokeChannels.authLogout, () => undefined);

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
