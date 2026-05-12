// All IPC invoke handlers live here. Channel names come from @shared/ipc
// so main and renderer share a single source of truth.

import { app, dialog, ipcMain, screen, shell } from 'electron';
import { z } from 'zod';

import {
  eventChannels,
  invokeChannels,
  type AnalyzeInput,
  type CaptureResult,
} from '@shared/ipc';

import { handleIn, handleInTuple, onIn } from './validated';
import {
  analyzeInputSchema,
  appearancePrefsPartialSchema,
  areaRectSchema,
  documentSearchSchema,
  documentUploadSchema,
  englishPolishTextSchema,
  hotkeyActionSchema,
  hotkeyBindingsSchema,
  hotkeyOverrideSchema,
  memorySyncSchema,
  masqueradeApplySchema,
  permissionKindSchema,
  pickerKindSchema,
  ratingSchema,
  resizeSchema,
  sessionKindSchema,
  shortIdSchema,
  toastShowSchema,
  urlSchema,
  windowNameSchema,
} from './schemas';

import { clearSession, loadSession } from '../auth/keychain';
import {
  createTelegramCodeClient,
  type TelegramCodeClient,
} from '../auth/telegram-code';
import { currentState as cursorState, toggle as cursorToggle } from '../cursor/freeze-js';
import { createPersonasClient, type PersonaDTO } from '../api/personas';
import { createSessionsClient } from '../api/sessions';
import { createIntelligenceClient } from '../api/intelligence';
import { createDocumentsClient } from '../api/documents';
import { createMemoryClient } from '../api/memory';
import { createAudioCapture, type AudioCaptureState } from '../capture/audio-mac';
import { createSuggestionClient } from '../api/suggestion';
import { createEnglishPolishClient } from '../api/english';
import { createTriggerPolicy } from '../coach/trigger-policy';
import { loadAppearance, saveAppearance, type AppearancePrefs } from '../settings/appearance';
import { createSessionManager, type SessionManager } from '../sessions/manager';
import { applyPreset, getCurrent, listPresets } from '../masquerade';
import { checkNow, getStatus, installNow } from '../updater';
import { captureArea, captureFullScreen } from '../capture/screenshot';
import { cursorBridge } from '../cursor/freeze-bridge';
import {
  applyBindings,
  fireAction,
  listBindings,
  listOverrides,
  setOverride,
} from '../hotkeys/registry';
import {
  checkPermissions,
  openPermissionPane,
  requestPermission,
} from '../permissions/macos';
import {
  broadcast,
  closeWindow,
  getStealth,
  getWindow,
  hideToast,
  hideWindow,
  resizeWindow,
  setStealth,
  showPicker,
  showToast,
  showWindow,
} from '../windows/window-manager';
import type { WindowOptions } from '../windows/window-manager';

import type { CopilotClient } from '../api/client';

/**
 * RegisterOptions bundles the handles that IPC handlers need. Keeping this
 * explicit avoids a module-level singleton and makes the wiring in
 * main/index.ts obvious.
 */
export interface RegisterOptions {
  client: CopilotClient;
  windowOptions: WindowOptions;
  /** Called when a streaming Analyze/Chat should begin. */
  startAnalyze: (input: AnalyzeInput, kind: 'analyze' | 'chat') => Promise<string>;
  /** Called to cancel an in-flight stream by id. */
  cancelAnalyze: (streamId: string) => void;
  /** Path to the `resources/` folder — needed for masquerade icon swap. */
  resourcesPath: string;
  /** Backend base URL — the telegram login code-flow needs it directly. */
  apiBaseURL: string;
  /** Called whenever a fresh DesktopConfig fetch succeeds, so main can
   *  update its fallback default-model id. Without this the streamer
   *  keeps using whatever value was set at boot even when the server
   *  rev has changed (e.g. migrating off a paid model onto a free one). */
  onConfigLoaded?: (defaultModelId: string) => void;
}

// Exported so main/index.ts can dispose the manager on app quit.
let sessionManager: SessionManager | null = null;
export function getSessionManager(): SessionManager | null {
  return sessionManager;
}

export function registerHandlers(opts: RegisterOptions): void {
  const { client, windowOptions, startAnalyze, cancelAnalyze, resourcesPath, apiBaseURL, onConfigLoaded } = opts;

  const telegramClient: TelegramCodeClient = createTelegramCodeClient(apiBaseURL);

  // Sessions manager lives for the app lifetime. Every session analysis
  // runs on the backend; no local analyzer path since BYOK was removed.
  const sessionsREST = createSessionsClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  // F10 (Phase D 2026-05-12) — Intelligence client for backend ingest.
  // Cue session.end → analysis ready → POST к /interview-sessions/ingest.
  const intelligenceREST = createIntelligenceClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  sessionManager = createSessionManager({ client: sessionsREST, intelligence: intelligenceREST });

  // Documents REST client. Shares the same auth/token path as sessions
  // — both talk to /api/v1/* with the user's Druz9 bearer.
  const documentsREST = createDocumentsClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });

  const memoryREST = createMemoryClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });

  // Personas catalogue — fetched once at startup from /api/v1/personas
  // (migration 00051 seeds the baseline set). Cached in memory; renderer
  // reads via the `personasList` IPC invoke. Fetch failure → empty cache,
  // picker falls back to showing only the default baseline persona.
  const personasREST = createPersonasClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  let personasCache: PersonaDTO[] = [];
  const refreshPersonas = async () => {
    try {
      personasCache = await personasREST.list();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[personas] cache refresh failed:', err);
    }
  };
  // Fire-and-forget at boot. The renderer's compact window typically
  // renders within ~200ms of main being ready; if the fetch hasn't
  // completed by then the picker shows the baseline persona only and
  // will pick up the full list on a subsequent IPC call.
  void refreshPersonas();

  // At most one in-flight login attempt. Starting a new one aborts the
  // previous awaitCompletion so the poll loop stops.
  let loginAbort: AbortController | null = null;
  let lastStartedCode: string | null = null;

  // ── Auth ──
  ipcMain.handle(invokeChannels.authSession, async () => {
    const s = await loadSession();
    if (!s) return null;
    return {
      userId: s.profile.userId,
      username: s.profile.username,
      avatarURL: s.profile.avatarURL,
      expiresAt: s.expiresAt,
    };
  });
  ipcMain.handle(invokeChannels.authLogout, async () => {
    loginAbort?.abort();
    loginAbort = null;
    await clearSession();
    broadcast(eventChannels.authChanged, { session: null });
  });
  ipcMain.handle(invokeChannels.authLoginTelegramStart, async () => {
    loginAbort?.abort();
    loginAbort = new AbortController();
    const started = await telegramClient.start();
    lastStartedCode = started.code;
    return {
      code: started.code,
      deepLink: started.deepLink,
      expiresAt: started.expiresAt,
    };
  });
  ipcMain.handle(invokeChannels.authLoginTelegramAwait, async () => {
    if (!loginAbort) throw new Error('no login in progress');
    // The renderer typically calls start() then immediately await(), so
    // we don't need the code — it's whatever the last start() returned.
    // Stash it inside the client in a production setup; for MVP we
    // accept only one concurrent login and reuse the same abort signal.
    const code = lastStartedCode;
    if (!code) throw new Error('no login in progress');
    try {
      const profile = await telegramClient.awaitCompletion(code, loginAbort.signal);
      // Notify all windows so they can react (e.g. close onboarding).
      broadcast(eventChannels.authChanged, {
        session: {
          userId: profile.userId,
          username: profile.username,
          avatarURL: profile.avatarURL,
          expiresAt: (await loadSession())?.expiresAt ?? '',
        },
      });
      return profile;
    } finally {
      loginAbort = null;
      lastStartedCode = null;
    }
  });
  ipcMain.handle(invokeChannels.authLoginTelegramCancel, async () => {
    loginAbort?.abort();
    loginAbort = null;
    lastStartedCode = null;
  });

  // ── Config ──
  ipcMain.handle(invokeChannels.configGet, async () => {
    const resp = await client.getDesktopConfig({ knownRev: 0n });
    if (resp.defaultModelId) onConfigLoaded?.(resp.defaultModelId);
    return resp;
  });
  ipcMain.handle(invokeChannels.configRefresh, async () => {
    const resp = await client.getDesktopConfig({ knownRev: 0n });
    if (resp.defaultModelId) onConfigLoaded?.(resp.defaultModelId);
    return resp;
  });

  // ── Capture ──
  ipcMain.handle(invokeChannels.captureScreenshotFull, async (): Promise<CaptureResult> => {
    return captureFullScreen();
  });

  // screenshotArea opens the area-picker overlay window, awaits the
  // user's rect, and returns a cropped capture. Resolves with null if
  // the user cancels. We use a single-shot handler pattern — only one
  // area capture can be in flight at a time.
  let pendingArea:
    | { resolve: (r: CaptureResult | null) => void; reject: (err: Error) => void }
    | null = null;
  // Watchdog timer — если юзер ни commit'нул ни cancel'нул в течение
  // 30 секунд, автоматически отпускаем cursor freeze и закрываем overlay.
  // Без этого ловили баг: overlay не появляется (race / focus issue) →
  // cursorBridge.freeze() заморозил курсор → юзер не может взаимодействовать
  // → пользователь reboot'ил ноут чтобы вернуть управление.
  let pendingAreaTimer: NodeJS.Timeout | null = null;
  const cancelPendingAreaSafely = () => {
    if (pendingAreaTimer) {
      clearTimeout(pendingAreaTimer);
      pendingAreaTimer = null;
    }
    closeWindow('area-overlay');
    cursorBridge.thaw();
    if (!pendingArea) return;
    const p = pendingArea;
    pendingArea = null;
    p.resolve(null);
  };

  ipcMain.handle(
    invokeChannels.captureScreenshotArea,
    async (): Promise<CaptureResult | null> => {
      if (pendingArea) {
        // Re-trigger while one is open → close + restart.
        cancelPendingAreaSafely();
      }
      // Pre-flight: проверяем Screen Recording permission ДО freeze'а
      // курсора. Если denied — fail сразу, не блокируем юзера.
      // Без этой проверки cursorBridge.freeze() морозил курсор, потом
      // captureArea fail'ила на permission'е, пользователь оставался с
      // замороженным курсором и не мог даже нажать «закрыть».
      try {
        const { ensureScreenRecordingPrompted } = await import('../capture/screenshot');
        await ensureScreenRecordingPrompted();
      } catch {
        /* probe — best-effort */
      }
      return new Promise<CaptureResult | null>((resolve, reject) => {
        pendingArea = { resolve, reject };
        // Snapshot ABSOLUTE cursor position before showing overlay —
        // одно это значение даёт renderer'у seed для virtual cursor'а
        // (после freeze() системный курсор не двигается, и renderer
        // должен интегрировать movementX/Y поверх seed'а).
        const seed = screen.getCursorScreenPoint();
        const overlay = showWindow('area-overlay', windowOptions);
        // Принудительно focus'им overlay — без этого macOS оставляет
        // фокус на источнике клика (Tray popup), и overlay не получает
        // pointer events. Юзер видит замороженный курсор «впустую».
        overlay.show();
        overlay.focus();
        overlay.moveTop();
        // Включаем freeze ПОСЛЕ показа overlay — иначе короткий
        // window между «открыли overlay» и «freeze» позволяет viewer'у
        // увидеть рывок реального курсора.
        // Helper sometimes lazy-spawns; call freeze unconditionally —
        // bridge no-op'ит если binary недоступен.
        cursorBridge.freeze();
        // Watchdog: 30s максимум. Если юзер не сделал ни commit, ни
        // cancel — авто-отпускаем (overlay не виден / app завис / etc).
        pendingAreaTimer = setTimeout(() => {
          cancelPendingAreaSafely();
        }, 30_000);
        // Seed renderer ASAP, но after webContents готов получать события.
        // did-finish-load — момент когда renderer point-listenerит наш push.
        const sendSeed = () => {
          overlay.webContents.send(eventChannels.areaInitialCursor, {
            x: seed.x,
            y: seed.y,
          });
        };
        if (overlay.webContents.isLoading()) {
          overlay.webContents.once('did-finish-load', sendSeed);
        } else {
          sendSeed();
        }
      });
    },
  );
  onIn(invokeChannels.captureAreaCommit, areaRectSchema, (rect) => {
    // Fully tear down the overlay window — reusing it leaves stale React
    // state (last drag coords / lingering event listeners) that corrupts
    // the next area capture.
    if (pendingAreaTimer) {
      clearTimeout(pendingAreaTimer);
      pendingAreaTimer = null;
    }
    closeWindow('area-overlay');
    cursorBridge.thaw();
    if (!pendingArea) return;
    const p = pendingArea;
    pendingArea = null;
    void captureArea(rect).then(p.resolve, (err) => p.reject(err as Error));
  });
  ipcMain.on(invokeChannels.captureAreaCancel, () => {
    cancelPendingAreaSafely();
  });

  // ── Analyze / Chat ──
  // Cached so a window that mounts AFTER the broadcast (common when
  // compact triggers a turn and then opens expanded for the first time)
  // can still pick it up via getLastUserTurn on mount.
  let lastUserTurn: {
    streamId: string;
    promptText: string;
    hasScreenshot: boolean;
    screenshotDataUrl: string;
  } | null = null;
  const announceTurnStart = (streamId: string, input: z.infer<typeof analyzeInputSchema>) => {
    const shot = input.attachments.find((a) => a.kind === 'screenshot');
    const ev = {
      streamId,
      promptText: input.promptText,
      hasScreenshot: !!shot,
      screenshotDataUrl: shot ? `data:${shot.mimeType};base64,${shot.dataBase64}` : '',
    };
    lastUserTurn = ev;
    broadcast(eventChannels.userTurnStarted, ev);
  };
  ipcMain.handle(invokeChannels.getLastUserTurn, async () => lastUserTurn);

  // Cross-window model-pick sync. One renderer writes → main fans out
  // to every window so their zustand stores converge without each having
  // to read localStorage on every render.
  handleIn(invokeChannels.activePersonaChanged, shortIdSchema, async (personaId) => {
    broadcast(eventChannels.activePersonaChanged, { personaId });
  });
  handleIn(invokeChannels.selectedModelChanged, shortIdSchema, async (modelId) => {
    broadcast(eventChannels.selectedModelChanged, { modelId });
  });
  handleIn(invokeChannels.analyzeStart, analyzeInputSchema, async (input) => {
    const streamId = await startAnalyze(input, 'analyze');
    announceTurnStart(streamId, input);
    return { streamId };
  });
  handleIn(invokeChannels.chatStart, analyzeInputSchema, async (input) => {
    const streamId = await startAnalyze(input, 'chat');
    announceTurnStart(streamId, input);
    return { streamId };
  });
  handleIn(invokeChannels.analyzeCancel, shortIdSchema, async (streamId) => {
    cancelAnalyze(streamId);
  });

  // ── Hotkeys ──
  ipcMain.handle(invokeChannels.hotkeysList, async () => listBindings());
  handleIn(invokeChannels.hotkeysUpdate, hotkeyBindingsSchema, async (bindings) => {
    applyBindings(bindings);
  });
  handleIn(invokeChannels.hotkeysTrigger, hotkeyActionSchema, async (action) => {
    fireAction(action);
  });
  ipcMain.handle(invokeChannels.hotkeysCaptureOnce, async () => {
    // MVP stub — settings UI builds accelerator strings locally and sends
    // them via hotkeysUpdate. Real implementation would intercept keys
    // until the next modifier+key release.
    return '';
  });
  // Persist a single override + re-register globalShortcut so the new
  // chord is live immediately. Empty accelerator = clear that override.
  handleIn(invokeChannels.hotkeysSetOverride, hotkeyOverrideSchema, async ({ action, accelerator }) => {
    const next = await setOverride(action, accelerator);
    // applyBindings reads the in-memory override map; pass the currently
    // registered bindings so the merge sees fresh accelerators applied
    // to the existing default set without forcing renderer to ship the
    // full DesktopConfig defaults back.
    applyBindings(listBindings());
    return next;
  });
  ipcMain.handle(invokeChannels.hotkeysListOverrides, async () => listOverrides());

  // ── Windows ──
  handleIn(invokeChannels.windowsShow, windowNameSchema, async (name) => {
    showWindow(name, windowOptions);
  });
  handleIn(invokeChannels.windowsHide, windowNameSchema, async (name) => {
    hideWindow(name);
  });
  handleIn(invokeChannels.windowsToggleStealth, z.boolean(), async (on) => {
    setStealth(on);
  });
  ipcMain.handle(invokeChannels.windowsGetStealth, () => getStealth());
  handleInTuple(
    invokeChannels.windowsResize,
    z.tuple([windowNameSchema, resizeSchema.shape.width, resizeSchema.shape.height]),
    async ([name, width, height]) => {
      resizeWindow(name, width, height);
    },
  );
  handleIn(invokeChannels.windowsShowPicker, pickerKindSchema, async (kind) => {
    showPicker(kind, windowOptions);
  });
  ipcMain.handle(invokeChannels.windowsHidePicker, async () => {
    hideWindow('picker');
  });
  handleInTuple(
    invokeChannels.toastShow,
    z.tuple([toastShowSchema.shape.msg, toastShowSchema.shape.kind]),
    async ([msg, kind]) => {
      showToast({ msg, kind }, windowOptions);
    },
  );
  ipcMain.handle(invokeChannels.toastDismiss, async () => {
    hideToast();
  });

  // ── Permissions ──
  ipcMain.handle(invokeChannels.permissionsCheck, async () => checkPermissions());
  handleIn(invokeChannels.permissionsRequest, permissionKindSchema, async (kind) => {
    await requestPermission(kind);
  });
  handleIn(invokeChannels.permissionsOpenSettings, permissionKindSchema, async (kind) => {
    await openPermissionPane(kind);
  });

  // ── History ──
  handleInTuple(
    invokeChannels.historyList,
    z.tuple([z.string().max(256), z.number().int().positive().max(500)]),
    async ([cursor, limit]) => {
      const resp = await client.listHistory({ cursor, limit });
      return {
        conversations: resp.conversations.map(mapConversationPB),
        nextCursor: resp.nextCursor,
      };
    },
  );
  handleIn(invokeChannels.historyGet, shortIdSchema, async (id) => {
    const resp = await client.getConversation({ id });
    return {
      conversation: mapConversationPB(resp.conversation),
      messages: (resp.messages ?? []).map(mapMessagePB),
    };
  });
  handleIn(invokeChannels.historyDelete, shortIdSchema, async (id) => {
    await client.deleteConversation({ id });
  });
  handleIn(invokeChannels.memorySync, memorySyncSchema, async ({ conversationId, memory }) => {
    await memoryREST.sync(conversationId, memory);
  });

  // ── Providers / quota ──
  ipcMain.handle(invokeChannels.providersList, async () => {
    const resp = await client.listProviders({});
    return resp.models;
  });
  ipcMain.handle(invokeChannels.quotaGet, async () => {
    const quota = await client.getQuota({});
    // Broadcast to all windows so any open paywall / settings reflects
    // the latest plan without a full re-render cycle. Also covers the
    // case where the user upgrades on Boosty then closes the paywall —
    // the renderer calls quota.get() on hide, we push the fresh result
    // to every other open window simultaneously.
    broadcast(eventChannels.quotaUpdated, quota);
    return quota;
  });

  // ── Rate ──
  handleInTuple(
    invokeChannels.rateMessage,
    z.tuple([shortIdSchema, ratingSchema]),
    async ([id, rating]) => {
      await client.rateMessage({ messageId: id, rating, comment: '' });
    },
  );

  // ── Appearance ──
  // Read-through JSON file (userData/appearance.json). On set, we
  // broadcast `appearanceChanged` so every live window can update its
  // CSS vars live — compact doesn't care today, but expanded re-reads
  // on the event and the user sees the slider's effect without waiting
  // for a re-render cycle.
  ipcMain.handle(invokeChannels.appearanceGet, async (): Promise<AppearancePrefs> => {
    return loadAppearance();
  });
  handleIn(
    invokeChannels.appearanceSet,
    appearancePrefsPartialSchema,
    async (prefs): Promise<AppearancePrefs> => {
      // Defensive clamping — the renderer's slider is 0-100 but nothing
      // stops a renderer bug from sending 500. Keep persisted value sane.
      const clamped: Partial<AppearancePrefs> = {};
      if (typeof prefs.expandedOpacity === 'number') {
        clamped.expandedOpacity = Math.max(0, Math.min(100, prefs.expandedOpacity));
      }
      if (prefs.expandedBounds) {
        clamped.expandedBounds = prefs.expandedBounds;
      }
      const saved = await saveAppearance(clamped);
      broadcast(eventChannels.appearanceChanged, saved);
      return saved;
    },
  );

  // ── Personas ──
  // On a cache miss (fetch hadn't completed yet at boot, or errored),
  // trigger a re-fetch. Still returns whatever is in cache right now —
  // UX-wise an empty list for a fraction of a second is preferable to
  // blocking the compact window on a slow network.
  ipcMain.handle(invokeChannels.personasList, async (): Promise<PersonaDTO[]> => {
    if (personasCache.length === 0) void refreshPersonas();
    return personasCache;
  });

  // ── Masquerade ──
  ipcMain.handle(invokeChannels.masqueradeList, async () => listPresets());
  ipcMain.handle(invokeChannels.masqueradeGet, async () => getCurrent());
  handleIn(invokeChannels.masqueradeApply, masqueradeApplySchema, async (preset) => {
    applyPreset(preset, resourcesPath);
  });

  // ── Auto-update ──
  ipcMain.handle(invokeChannels.updaterStatus, async () => getStatus());
  ipcMain.handle(invokeChannels.updaterCheck, async () => checkNow());
  ipcMain.handle(invokeChannels.updaterInstall, async () => installNow());

  // ── Shell ── (narrow surface: http/https only, rejects other schemes).
  handleIn(invokeChannels.shellOpenExternal, urlSchema, async (url) => {
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  // ── Notes ──
  handleIn(invokeChannels.notesShowInFolder, z.string(), async (filePath) => {
    shell.showItemInFolder(filePath);
  });
  handleIn(invokeChannels.notesOpenInHone, z.string(), async (filePath) => {
    // Hone registers the hone:// URL scheme. The path is base64-encoded so
    // special characters in macOS paths don't break the URL.
    const encoded = Buffer.from(filePath).toString('base64');
    await shell.openExternal(`druz9://notes/import?path=${encoded}`);
  });

  // notes:save-chat-to-hone — snapshot chat → CueSessionAnalysis-shaped
  // JSON → fire deeplink. Hone backend импортит row в hone_cue_sessions
  // (UNIQUE по file_path → повторный snapshot перезаписывает row но НЕ
  // body_md если юзер уже редактировал). Файл живёт в userData/notes
  // рядом с meeting-сессиями — единый bucket, одна точка ремонта.
  handleIn(
    invokeChannels.notesSaveChatToHone,
    z.object({
      title: z.string(),
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })),
    }),
    async (input) => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const dir = join(app.getPath('userData'), 'notes');
      await mkdir(dir, { recursive: true });

      const dateStr = new Date().toISOString().slice(0, 10);
      const ts = Date.now().toString(36);
      const filename = `chat_${dateStr}_${ts}.json`;
      const filePath = join(dir, filename);

      const titleFallback = input.title.trim() ||
        (input.messages.find((m) => m.role === 'user')?.content || 'Chat')
          .replace(/\s+/g, ' ').slice(0, 60);

      const md = input.messages
        .map((m) => {
          const heading = m.role === 'user' ? '### You' : '### Assistant';
          return `${heading}\n\n${m.content}`;
        })
        .join('\n\n---\n\n');

      // Envelope shape mirrors SessionAnalysis (см. @shared/types) чтобы
      // Hone-renderer'у не пришлось ветвиться. Большинство полей пусты —
      // chat не имеет structured action items / decisions.
      const envelope = {
        sessionId: `chat-${ts}`,
        title: titleFallback,
        tldr: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        keyTopics: [],
        actionItems: [],
        terminology: [],
        decisions: [],
        openQuestions: [],
        reportMarkdown: md,
        overallScore: 0,
        usage: null,
        // discriminator для будущего bucket'а — Hone может разделять
        // chat'ы и meeting'и в UI, если захочет.
        kind: 'chat',
      };
      await writeFile(filePath, JSON.stringify(envelope, null, 2), 'utf-8');

      const encoded = Buffer.from(filePath).toString('base64');
      await shell.openExternal(`druz9://notes/import?path=${encoded}`);
      return { filePath };
    },
  );

  // Export current chat → user-chosen .md file. Native save dialog
  // (Electron). Cancel → return null. Не зависит от Hone — само-
  // достаточный markdown для backup / share / vault.
  handleIn(
    invokeChannels.notesExportChatMarkdown,
    z.object({
      title: z.string(),
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })),
    }),
    async (input) => {
      const titleFallback = input.title.trim() ||
        (input.messages.find((m) => m.role === 'user')?.content || 'Chat')
          .replace(/\s+/g, ' ').slice(0, 60);

      // Sanitize title для filename: убираем path-illegal characters,
      // ограничиваем длину. Дата для уникальности.
      const safeName = titleFallback
        .replace(/[/\\:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 60);
      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultFilename = `${dateStr}_${safeName}.md`;

      const result = await dialog.showSaveDialog({
        title: 'Экспорт чата',
        defaultPath: defaultFilename,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return null;

      const header = `# ${titleFallback}\n\n_Exported from Cue · ${new Date().toLocaleString('ru-RU')}_\n\n---\n\n`;
      const body = input.messages
        .map((m) => {
          const heading = m.role === 'user' ? '## Вы' : '## Assistant';
          return `${heading}\n\n${m.content}`;
        })
        .join('\n\n---\n\n');

      const { writeFile } = await import('node:fs/promises');
      await writeFile(result.filePath, header + body, 'utf-8');
      return { filePath: result.filePath };
    },
  );

  // ── App lifecycle ──
  ipcMain.handle(invokeChannels.appVersion, () => app.getVersion());
  ipcMain.handle(invokeChannels.appQuit, async () => {
    // Give the analyzer subscriber a moment to drain; then quit.
    setTimeout(() => app.quit(), 50);
  });

  // ── UI hand-offs ──
  // Compact window is too small for the picker modal; compact asks
  // main to show expanded + tell it to pop the picker on arrival.
  ipcMain.handle(invokeChannels.openProviderPicker, async () => {
    showWindow('expanded', windowOptions);
    // Give the expanded renderer a moment to register its event
    // listener before we fire. Without this, the push can arrive
    // before React has subscribed.
    setTimeout(() => broadcast(eventChannels.openProviderPicker, null), 200);
  });

  // ── Cursor freeze ── (the "virtual cursor" UX)
  ipcMain.handle(invokeChannels.cursorFreezeState, async () => cursorState());
  ipcMain.handle(invokeChannels.cursorFreezeToggle, async () => {
    const next = await cursorToggle();
    broadcast(eventChannels.cursorFreezeChanged, next);
    return next;
  });

  // ── Sessions (Phase 12) ──
  handleIn(invokeChannels.sessionStart, sessionKindSchema, async (kind) => {
    if (!sessionManager) throw new Error('sessions disabled');
    return sessionManager.start(kind);
  });
  ipcMain.handle(invokeChannels.sessionEnd, async () => {
    if (!sessionManager) return null;
    return sessionManager.end();
  });
  ipcMain.handle(invokeChannels.sessionCurrent, async () => {
    if (!sessionManager) return null;
    return sessionManager.current();
  });
  handleInTuple(
    invokeChannels.sessionList,
    z.tuple([
      z.string().max(256),
      z.number().int().positive().max(500),
      sessionKindSchema.optional(),
    ]),
    async ([cursor, limit, kind]) => {
      if (!sessionManager) return { sessions: [], nextCursor: '' };
      return sessionManager.list(cursor, limit, kind);
    },
  );
  handleIn(invokeChannels.sessionGetAnalysis, shortIdSchema, async (sessionId) => {
    if (!sessionManager) throw new Error('sessions disabled');
    return sessionManager.getAnalysis(sessionId);
  });

  // ── Documents ──
  // The REST client raises on any non-2xx; we pass errors through so
  // the renderer can surface the server-side message (e.g. "file too
  // large") in a toast. No silent swallowing.
  handleInTuple(
    invokeChannels.documentsList,
    z.tuple([z.string().max(256), z.number().int().nonnegative().max(100)]),
    async ([cursor, limit]) => documentsREST.list(cursor, limit),
  );
  handleIn(invokeChannels.documentsGet, shortIdSchema, async (id) => documentsREST.get(id));
  handleIn(invokeChannels.documentsUpload, documentUploadSchema, async (input) =>
    documentsREST.upload({
      filename: input.filename,
      mime: input.mime,
      content: input.content,
      sourceUrl: input.sourceUrl,
    }),
  );
  handleIn(invokeChannels.documentsUploadFromURL, urlSchema, async (u) =>
    documentsREST.uploadFromURL(u),
  );
  handleIn(invokeChannels.documentsDelete, shortIdSchema, async (id) => {
    await documentsREST.delete(id);
  });
  handleIn(invokeChannels.documentsSearch, documentSearchSchema, async (req) =>
    documentsREST.search(req.docIds, req.query, req.topK),
  );
  handleInTuple(
    invokeChannels.documentsAttachToSession,
    z.tuple([shortIdSchema, shortIdSchema]),
    async ([sessionId, docId]) => {
      await documentsREST.attachToSession(sessionId, docId);
    },
  );
  handleInTuple(
    invokeChannels.documentsDetachFromSession,
    z.tuple([shortIdSchema, shortIdSchema]),
    async ([sessionId, docId]) => {
      await documentsREST.detachFromSession(sessionId, docId);
    },
  );
  handleIn(invokeChannels.documentsListAttached, shortIdSchema, async (sessionId) =>
    documentsREST.listAttachedToSession(sessionId),
  );

  // ── English polish (Wave 6.2) ──
  // Renderer passes the clipboard text; we proxy to /hone/writing/grade
  // (Wave 4.4 backend). Keeps the bearer token main-only.
  const englishREST = createEnglishPolishClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  handleIn(invokeChannels.englishPolishGrade, englishPolishTextSchema, async (text) =>
    englishREST.polish(text),
  );

  // ── Audio capture (macOS system audio via ScreenCaptureKit native) ──
  // The trigger policy hooks into the same transcript stream the
  // renderer subscribes to, so we wire it here before the audio
  // capture is constructed.
  const suggestionREST = createSuggestionClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  const coachPolicy = createTriggerPolicy(
    suggestionREST,
    (ev) => {
      switch (ev.kind) {
        case 'suggestion':
          broadcast(eventChannels.coachSuggestion, {
            id: ev.id,
            question: ev.question,
            text: ev.text,
            latencyMs: ev.latencyMs,
          });
          break;
        case 'status':
          broadcast(eventChannels.coachStatus, {
            enabled: ev.enabled,
            thinking: ev.thinking,
          });
          break;
        case 'error':
          broadcast(eventChannels.coachError, { message: ev.message });
          break;
      }
    },
    { persona: 'meeting' },
  );

  // Два независимых capture controller'а — один для system audio
  // (ScreenCaptureKit, кнопка «Слушать»), один для mic (AVAudioEngine,
  // кнопка «Микрофон»). Оба могут работать параллельно: каждый spawn'ит
  // свой Swift child process с независимым SFSpeechRecognizer.
  const captureCfg = {
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru' as const,
    isDev: false,
  };
  const makeEvents = (source: 'system' | 'mic') => ({
    onState: (state: AudioCaptureState) => {
      // eslint-disable-next-line no-console
      console.log(`[handlers:audio:${source}] state→${state}`);
      broadcast(eventChannels.audioCaptureStateChanged, { source, state });
    },
    onTranscript: (text: string, windowSec: number, isFinal: boolean) => {
      // Privacy: транскрипт длина — это metadata leak в crash logs / forensic.
      // Раньше был console.log — убран. Если нужен debug, вернуть с if (isDev).
      void text; void windowSec; void isFinal;
      broadcast(eventChannels.audioCaptureTranscript, { source, text, windowSec, isFinal });
      if (isFinal) {
        coachPolicy.onTranscript(text);
      }
    },
    onError: (message: string) => {
      // eslint-disable-next-line no-console
      console.warn(`[handlers:audio:${source}] error: ${message}`);
      broadcast(eventChannels.audioCaptureError, { source, message });
    },
  });
  const audioCaptureSystem = createAudioCapture(captureCfg, makeEvents('system'), 'system');
  const audioCaptureMic = createAudioCapture(captureCfg, makeEvents('mic'), 'mic');
  const captureBySource = (raw: unknown) =>
    raw === 'mic' ? audioCaptureMic : audioCaptureSystem;
  const restoreExpandedFocus = () => {
    // macOS TCC prompt при первом старте Swift binary стягивает focus у
    // expanded окна. Без явного return-focus expanded остаётся без mouse-
    // events и юзер не может попасть в input/кнопки.
    const expanded = getWindow('expanded');
    if (expanded) {
      try { expanded.setIgnoreMouseEvents(false); } catch { /* no-op */ }
      try { expanded.focus(); } catch { /* no-op */ }
    }
  };
  ipcMain.handle(invokeChannels.audioCaptureStart, async (_evt, source?: unknown) => {
    await captureBySource(source).start();
    restoreExpandedFocus();
  });
  ipcMain.handle(invokeChannels.audioCaptureStop, async (_evt, source?: unknown) => {
    await captureBySource(source).stop();
    restoreExpandedFocus();
  });
  ipcMain.handle(invokeChannels.audioCaptureState, async (_evt, source?: unknown) =>
    captureBySource(source).state(),
  );
  ipcMain.handle(invokeChannels.audioCaptureIsAvailable, async () =>
    audioCaptureSystem.isAvailable(),
  );

  // ── Coach (auto-suggest) ──
  handleIn(invokeChannels.coachSetAutoSuggest, z.boolean(), async (on) => {
    coachPolicy.setEnabled(on);
  });
  ipcMain.handle(invokeChannels.coachGetAutoSuggest, async () => coachPolicy.isEnabled());

}

// ─────────────────────────────────────────────────────────────────────────
// proto → renderer shape. The renderer types (@shared/types) are the
// source of truth on the client side; we adapt Connect responses to
// those shapes here so the IPC contract is always clean JSON — no
// BigInt, Date, or message-class instances crossing the bridge.
// ─────────────────────────────────────────────────────────────────────────

type AnyConv = {
  id?: string;
  title?: string;
  model?: string;
  messageCount?: number;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
};
type AnyMsg = {
  id?: string;
  conversationId?: string;
  role?: number;
  content?: string;
  hasScreenshot?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  rating?: number;
  createdAt?: { toDate?: () => Date };
};

function mapConversationPB(c: AnyConv | undefined) {
  return {
    id: String(c?.id ?? ''),
    title: String(c?.title ?? ''),
    model: String(c?.model ?? ''),
    messageCount: Number(c?.messageCount ?? 0),
    createdAt: c?.createdAt?.toDate?.()?.toISOString() ?? '',
    updatedAt: c?.updatedAt?.toDate?.()?.toISOString() ?? '',
  };
}

function mapMessagePB(m: AnyMsg) {
  // proto MessageRole enum: 0=unspecified, 1=system, 2=user, 3=assistant.
  const role = m.role === 1 ? 'system' : m.role === 2 ? 'user' : m.role === 3 ? 'assistant' : '';
  return {
    id: String(m.id ?? ''),
    conversationId: String(m.conversationId ?? ''),
    role: role as '' | 'system' | 'user' | 'assistant',
    content: String(m.content ?? ''),
    hasScreenshot: !!m.hasScreenshot,
    tokensIn: Number(m.tokensIn ?? 0),
    tokensOut: Number(m.tokensOut ?? 0),
    latencyMs: Number(m.latencyMs ?? 0),
    rating: (m.rating === -1 || m.rating === 0 || m.rating === 1 ? m.rating : 0) as -1 | 0 | 1,
    createdAt: m.createdAt?.toDate?.()?.toISOString() ?? '',
  };
}
