// Main-process entry. Boots the app, registers IPC handlers, mounts the
// compact floating window. Renderer pages dispatch the rest.

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { eventChannels } from '@shared/ipc';

import { registerDeepLinks } from './auth/deeplink';
import { createCopilotClient } from './api/client';
import { loadRuntimeConfig } from './config/bootstrap';
import { applyBindings, disposeHotkeys, setHotkeyHandler } from './hotkeys/registry';
import { registerHandlers } from './ipc/handlers';
import { createStreamer } from './ipc/streaming';
import { initSentryMain } from './sentry';
import { destroyTray, ensureTray } from './tray';
import { wireAutoUpdate } from './updater';
import { broadcast, showWindow } from './windows/window-manager';

// Force the display name before anything else — Electron infers name
// from the parent process in dev (e.g. "claude" when launched from the
// Claude CLI), and that leaks into the macOS menu bar and About panel.
app.setName('Druz9 Copilot');
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Druz9 Copilot',
    applicationVersion: app.getVersion(),
  });
}

// Enforce single instance — required for the deep-link handler to route
// druz9:// callbacks into the already-running process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.whenReady().then(async () => {
  const cfg = loadRuntimeConfig();
  // Sentry FIRST so any bootstrap error gets captured. No-op when
  // DSN is empty.
  await initSentryMain(cfg, app.getVersion());
  const client = createCopilotClient(cfg);

  const preloadPath = join(__dirname, '../preload/index.js');
  const rendererURL =
    cfg.isDev && process.env.ELECTRON_RENDERER_URL
      ? process.env.ELECTRON_RENDERER_URL
      : `file://${join(__dirname, '../renderer/index.html')}`;
  const windowOptions = { preloadPath, rendererURL, isDev: cfg.isDev };

  // Default model is sourced from the DesktopConfig fetched on the
  // renderer-side handle but the streamer runs in main; we track it as
  // a mutable closure value updated whenever the renderer fetches config.
  // Fallback must be a model the free plan can actually run — sending
  // gpt-4o-mini to OpenRouter on an empty-credits account 402s.
  let currentDefaultModel = 'qwen/qwen3-coder:free';
  void client
    .getDesktopConfig({ knownRev: 0n })
    .then((c) => {
      if (c.defaultModelId) currentDefaultModel = c.defaultModelId;
      // Wire the auto-updater once we have a server-supplied feed URL.
      // No-op when the URL is empty or when running in dev.
      wireAutoUpdate(c.updateFeedUrl ?? '');
    })
    .catch(() => {
      /* keep the fallback — BYOK-only users can still operate */
    });

  const streamer = createStreamer({ client, defaultModel: () => currentDefaultModel });

  const resourcesPath = cfg.isDev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath, 'resources');

  registerHandlers({
    client,
    windowOptions,
    startAnalyze: (input, kind) => streamer.start(input, kind),
    cancelAnalyze: (id) => streamer.cancel(id),
    resourcesPath,
    apiBaseURL: cfg.apiBaseURL,
    onConfigLoaded: (id) => {
      currentDefaultModel = id;
    },
  });

  ensureTray({ resourcesPath, windowOptions });

  // Telegram login is pull-based (POST /auth/telegram/poll) — no deep
  // link callback needed. registerDeepLinks is a no-op shim today; kept
  // for future non-auth deep links (share URLs, etc.).
  registerDeepLinks(null);

  setHotkeyHandler(async (action) => {
    if (action === 'cursor_freeze_toggle') {
      // Handled entirely in main — no renderer UI needed to toggle.
      // Renderer gets a separate cursor-freeze-changed push so the
      // status bar / Tray indicator can update.
      const { toggle: cursorToggle } = await import('./cursor/freeze-js');
      const next = await cursorToggle();
      broadcast(eventChannels.cursorFreezeChanged, next);
      return;
    }
    broadcast(eventChannels.hotkeyFired, { action });
  });

  // Boot the compact window. Hotkey bindings are applied from the
  // DesktopConfig fetched by the renderer once the user logs in;
  // before that, we register the full local default set so screenshots
  // / voice / cursor-freeze work even without a session.
  applyBindings([
    { action: 'screenshot_area', accelerator: 'CommandOrControl+Shift+S' },
    { action: 'screenshot_full', accelerator: 'CommandOrControl+Shift+A' },
    { action: 'voice_input', accelerator: 'CommandOrControl+Shift+V' },
    { action: 'toggle_window', accelerator: 'CommandOrControl+Shift+D' },
    { action: 'quick_prompt', accelerator: 'CommandOrControl+Shift+Q' },
    { action: 'clear_conversation', accelerator: 'CommandOrControl+Shift+K' },
    { action: 'cursor_freeze_toggle', accelerator: 'CommandOrControl+Shift+Y' },
  ]);

  showWindow('compact', windowOptions);
});

app.on('window-all-closed', () => {
  // macOS convention is to keep the process alive; we follow that since
  // the user usually only hides windows, not quits the app.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const cfg = loadRuntimeConfig();
    const preloadPath = join(__dirname, '../preload/index.js');
    const rendererURL =
      cfg.isDev && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : `file://${join(__dirname, '../renderer/index.html')}`;
    showWindow('compact', { preloadPath, rendererURL, isDev: cfg.isDev });
  }
});

app.on('will-quit', async () => {
  disposeHotkeys();
  destroyTray();
  const { shutdown: cursorShutdown } = await import('./cursor/freeze-js');
  cursorShutdown();
});
