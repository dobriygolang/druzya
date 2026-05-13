// Main-process entry. Boots the app, registers IPC handlers, mounts the
// compact floating window. Renderer pages dispatch the rest.

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { eventChannels } from '@shared/ipc';

import { registerDeepLinks } from './auth/deeplink';
import { cleanupOldRecordings } from './cleanup/recordings';
import { maybeShowWhatsNew } from './whats-new';
import { createCopilotClient } from './api/client';
import { ensureScreenRecordingPrompted } from './capture/screenshot';
import { loadRuntimeConfig } from './config/bootstrap';
import { isOnboardingCompleted } from './onboarding/flag';
import {
  applyBindings,
  disposeHotkeys,
  hydrateOverrides,
  setHotkeyHandler,
} from './hotkeys/registry';
import { registerHandlers } from './ipc/handlers';
import { createStreamer } from './ipc/streaming';
import { initSentryMain } from './sentry';
import { destroyTray, ensureTray } from './tray';
import { wireAutoUpdate } from './updater';
import {
  broadcast,
  getWindow,
  moveFloatingWindowToEdge,
  preloadWindow,
  showWindow,
} from './windows/window-manager';

// Opt out of the ScreenCaptureKit picker path on macOS Sonoma+. Electron 33
// enables `ScreenCaptureKitPickerScreen` + `ScreenCaptureKitStreamPickerSonoma`
// by default on macOS 14+; both trigger the native "choose a window to share"
// prompt the first time `desktopCapturer.getSources()` runs in a session.
//
// Our UX (⌘⇧S area-overlay, ⌘⇧A full-screen) expects an instant capture — no
// modal. The new path surfaces a system dialog the user can't always see
// (our area-overlay and compact window can sit on top of it), so area captures
// appear to "do nothing": the user drags a rect, overlay closes, and the
// promise hangs until the invisible system prompt times out. Disabling these
// features forces Electron back onto the legacy ScreenCaptureKit-less
// CGDisplayCreateImage path, which never prompts once the user has granted
// Screen Recording permission in System Settings → Privacy.
//
// MUST be called BEFORE app.whenReady() — Chromium bakes the feature list
// into its command-line at early startup, and later mutations are ignored.
app.commandLine.appendSwitch(
  'disable-features',
  'ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma',
);

// Force the display name before anything else — Electron infers name
// from the parent process in dev (e.g. "claude" when launched from the
// Claude CLI), and that leaks into the macOS menu bar and About panel.
app.setName('Cue');
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Cue',
    applicationVersion: app.getVersion(),
  });
}

// Enforce single instance — required for the deep-link handler to route
// druz9:// callbacks into the already-running process.
//
// DEV CAVEAT: in `electron-vite dev` we run the raw Electron.app binary,
// which ships with bundleId `com.github.electron`. That lock is shared
// across *every* Electron app on the system — Claude Desktop, VS Code,
// Slack, Discord, etc. If any of them is running, `requestSingleInstanceLock`
// returns false and the dev run self-exits with code 0 silently. Skip
// the lock entirely in dev; production (packaged app) keeps the lock
// because it ships with a unique bundle id set in electron-builder.yml.
if (!process.env.ELECTRON_RENDERER_URL) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.error('[druz9 main] single-instance lock failed; another instance already running');
    app.quit();
    process.exit(0);
  }
} else {
  console.log('[druz9 main] dev mode — skipping single-instance lock');
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

  // ON CONFLICT to refresh last_seen_at. First install across all 3
  // surfaces issues a 7-day Pro trial; we silently log here, the
  // renderer can show the celebratory toast when it asks for tier-info.
  void import('./api/install-heartbeat').then(({ recordCueInstall }) => {
    void recordCueInstall(cfg, app.getVersion()).then((r) => {
      if (r.trialProGranted) {
        console.log('[cue] first-install trial Pro granted until', r.trialProUntil);
      }
    }).catch(() => {
      /* best-effort — retry next launch */
    });
  });

  // Spawn CursorHelper Swift binary (CGAssociateMouseAndMouseCursorPosition
  const { bootstrap: cursorBootstrap } = await import('./cursor/freeze-bridge');
  cursorBootstrap();

  ensureTray({ resourcesPath, windowOptions });

  // Register druz9:// protocol scheme + open-url / second-instance
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
    if (action === 'move_window_left') {
      moveFloatingWindowToEdge('left');
      return;
    }
    if (action === 'move_window_right') {
      moveFloatingWindowToEdge('right');
      return;
    }
    if (action === 'move_window_up') {
      moveFloatingWindowToEdge('up');
      return;
    }
    if (action === 'move_window_down') {
      moveFloatingWindowToEdge('down');
      return;
    }
    if (action === 'instant_assist') {
      const expanded = getWindow('expanded');
      const target = expanded && expanded.isVisible()
        ? expanded
        : showWindow('compact', windowOptions);
      target.webContents.send(eventChannels.hotkeyFired, { action });
      target.show();
      target.focus();
      return;
    }
    if (action === 'english_polish') {
      const win = showWindow('english-polish', windowOptions);
      win.webContents.send(eventChannels.hotkeyFired, { action });
      win.show();
      win.focus();
      return;
    }
    broadcast(eventChannels.hotkeyFired, { action });
  });

  // Hydrate the persisted hotkey override map BEFORE first applyBindings
  // so user rebindings survive restart. Errors swallowed — missing file
  // is the first-run path; corrupt file falls back to empty overrides
  // and the user can re-bind via Settings → Горячие клавиши.
  try {
    await hydrateOverrides();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hotkeys] hydrate overrides failed:', err);
  }

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
    { action: 'instant_assist', accelerator: 'CommandOrControl+Return' },
    { action: 'clear_conversation', accelerator: 'CommandOrControl+Shift+K' },
    { action: 'cursor_freeze_toggle', accelerator: 'CommandOrControl+Shift+Y' },
    // КРИТИЧНО: window-move shortcuts регистрируются как globalShortcut,
    // что значит OS перехватывает их СИСТЕМНО — даже когда юзер печатает
    // в input. Раньше было `Cmd+Left/Right` — конфликтовало с macOS
    // text-navigation («start/end of line»), юзер не мог двигать курсор
    // в editor'ах. Перенесли на `Cmd+Alt+Arrow` — это малоиспользуемая
    // комбинация: macOS не bind'ит её в text-edit'е (Alt+Arrow = word
    // jump, добавление Cmd ничего не меняет в стандартном поведении).
    { action: 'move_window_left', accelerator: 'CommandOrControl+Alt+Left' },
    { action: 'move_window_right', accelerator: 'CommandOrControl+Alt+Right' },
    { action: 'move_window_up', accelerator: 'CommandOrControl+Alt+Up' },
    { action: 'move_window_down', accelerator: 'CommandOrControl+Alt+Down' },
    { action: 'english_polish', accelerator: 'CommandOrControl+Shift+L' },
  ]);

  // First-run gate. If the onboarding flag is absent, open the
  // wizard window instead of compact + skip the auto-prompt. The
  // wizard owns the permission flow now: the user explicitly opts
  // into Screen Recording / Microphone / Accessibility *after* seeing
  // the pre-prompt screens (C1) + the invisible-stealth demo (C2).
  //
  // Why not trigger ensureScreenRecordingPrompted here anyway: the
  // entire reason for C1 is that calling the OS prompt with no context
  // → 30-50% denial rate → app dead. The pre-prompt cards explain why
  // each permission matters BEFORE the OS dialog appears, so the user
  // arrives at the system prompt already primed.
  //
  // On re-runs (user clicks "Re-run welcome flow" from Settings, then
  // restarts) the flag is wiped and we land here again — same path.
  const needsOnboarding = !isOnboardingCompleted();

  if (needsOnboarding) {
    // No auto-prompt; the wizard's PermissionsScreen will trigger TCC
    // dialogs only when the user clicks "Grant Permissions".
    showWindow('onboarding', windowOptions);
    // Preload picker anyway — it's cheap and the user will use compact
    // immediately after onboarding completes.
    preloadWindow('picker', windowOptions);
  } else {
    // Trigger macOS Screen Recording prompt BEFORE the compact window
    // appears. Compact is setContentProtection(true) + alwaysOnTop —
    // it can and does sit on top of the system permission dialog,
    // which is why users never see the prompt and the app never shows
    // up in Privacy → Screen Recording. (Returning user path only: a
    // first-time user goes through the wizard above instead.)
    //
    // We AWAIT here (rather than void + fire-and-forget) so the dialog
    // gets a bare desktop to render on. The bootstrap returns as soon
    // as macOS finishes its bookkeeping (~100ms on 'granted', blocks
    // until user clicks Allow/Deny on 'not-determined'). Worst case
    // ~200ms delay before compact appears on a happy-path boot — we
    // accept that trade-off for "first ⌘⇧A actually captures".
    await ensureScreenRecordingPrompted();

    showWindow('compact', windowOptions);
    preloadWindow('picker', windowOptions);
  }

  // Best-effort boot tasks — errors are logged, never crash the app.
  void cleanupOldRecordings();
  // Skip the "What's new" toast on a first-run boot where the
  // onboarding wizard is still on screen — stacking a toast over the
  // wizard's CTA confuses users and steals focus from the flow.
  if (!needsOnboarding) {
    void maybeShowWhatsNew(windowOptions);
  }

  // Re-bind deep-links to the actual compact window now that it exists.
  // First call (above, with null) registered the protocol scheme and
  // listeners; this second call swaps in the real BrowserWindow so
  // warm-app dispatch can forward URLs to the renderer.
  registerDeepLinks(getWindow('compact') ?? null);
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
  // Бинарный Swift helper тоже надо корректно потушить — он сам делает
  // thaw в atexit, но give it a clean SIGTERM чтобы не оставить cursor
  // detached если процесс убили.
  const { cursorBridge } = await import('./cursor/freeze-bridge');
  cursorBridge.shutdown();
});
