// All IPC invoke handlers live here. Channel names come from @shared/ipc
// so main and renderer share a single source of truth.

import { ipcMain, shell } from 'electron';

import {
  eventChannels,
  invokeChannels,
  type AnalyzeInput,
  type AreaRect,
  type ByokPresence,
  type ByokProvider,
  type ByokResult,
  type CaptureResult,
  type PermissionKind,
  type WindowName,
} from '@shared/ipc';
import type { HotkeyBinding } from '@shared/types';

import { clearSession, loadSession } from '../auth/keychain';
import {
  createTelegramCodeClient,
  type TelegramCodeClient,
} from '../auth/telegram-code';
import {
  deleteKey as byokDelete,
  listPresence,
  loadKey as byokLoad,
  saveKey as byokSave,
  validateKeyShape,
} from '../auth/byok-keychain';
import { AnthropicProvider } from '../api/providers/anthropic';
import { OpenAIProvider } from '../api/providers/openai';
import { transcribe } from '../api/providers/whisper';
import { currentState as cursorState, toggle as cursorToggle } from '../cursor/freeze-js';
import { createSessionsClient } from '../api/sessions';
import { createSessionManager, type SessionManager } from '../sessions/manager';
import { runByokAnalysis } from '../sessions/byok-analyzer';
import { listPresence as byokListPresence } from '../auth/byok-keychain';
import type { SessionKind } from '@shared/types';
import { applyPreset, getCurrent, listPresets, type MasqueradePreset } from '../masquerade';
import { checkNow, getStatus, installNow } from '../updater';
import { captureArea, captureFullScreen } from '../capture/screenshot';
import { applyBindings, listBindings } from '../hotkeys/registry';
import {
  checkPermissions,
  openPermissionPane,
  requestPermission,
} from '../permissions/macos';
import {
  broadcast,
  hideWindow,
  resizeWindow,
  setStealth,
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
}

// Exported so main/index.ts can dispose the manager on app quit.
let sessionManager: SessionManager | null = null;
export function getSessionManager(): SessionManager | null {
  return sessionManager;
}

export function registerHandlers(opts: RegisterOptions): void {
  const { client, windowOptions, startAnalyze, cancelAnalyze, resourcesPath, apiBaseURL } = opts;

  const telegramClient: TelegramCodeClient = createTelegramCodeClient(apiBaseURL);

  // Sessions manager lives for the app lifetime. The BYOK hook reads
  // the live conversation-store transcript via IPC at analysis time
  // (registered below under session:request-byok-transcript).
  let pendingByokTranscript: string | null = null;
  // The REST client only needs apiBaseURL; the other RuntimeConfig
  // fields are irrelevant here, so we construct a minimal object.
  const sessionsREST = createSessionsClient({
    apiBaseURL,
    updateFeedURL: '',
    sentryDSN: '',
    environment: '',
    defaultLocale: 'ru',
    isDev: false,
  });
  sessionManager = createSessionManager({
    client: sessionsREST,
    isByokActive: async () => {
      const p = await byokListPresence();
      return p.openai || p.anthropic;
    },
    runLocalAnalysis: async (session) => {
      // Ask the renderer to serialize the session's local turns.
      // Renderer responds synchronously via the session:local-transcript
      // event it registered at startup. Timeout at 2s — if the renderer
      // didn't answer, fall back to an empty transcript (the analyzer
      // will produce a "too short" report).
      pendingByokTranscript = null;
      broadcast(eventChannels.sessionRequestLocalTranscript, { sessionId: session.id });
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && pendingByokTranscript === null) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const markdown = pendingByokTranscript ?? '';
      pendingByokTranscript = null;
      return runByokAnalysis(session, { markdown });
    },
  });
  ipcMain.on(invokeChannels.sessionSubmitLocalTranscript, (_evt, payload: { markdown: string }) => {
    pendingByokTranscript = payload?.markdown ?? '';
  });
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
    return resp;
  });
  ipcMain.handle(invokeChannels.configRefresh, async () => {
    const resp = await client.getDesktopConfig({ knownRev: 0n });
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
  ipcMain.handle(
    invokeChannels.captureScreenshotArea,
    async (): Promise<CaptureResult | null> => {
      if (pendingArea) {
        // Re-trigger while one is open → close + restart.
        pendingArea.resolve(null);
        pendingArea = null;
      }
      return new Promise<CaptureResult | null>((resolve, reject) => {
        pendingArea = { resolve, reject };
        showWindow('area-overlay', windowOptions);
      });
    },
  );
  ipcMain.on(invokeChannels.captureAreaCommit, async (_evt, rect: AreaRect) => {
    hideWindow('area-overlay');
    if (!pendingArea) return;
    const p = pendingArea;
    pendingArea = null;
    try {
      const shot = await captureArea(rect);
      p.resolve(shot);
    } catch (err) {
      p.reject(err as Error);
    }
  });
  ipcMain.on(invokeChannels.captureAreaCancel, () => {
    hideWindow('area-overlay');
    if (!pendingArea) return;
    const p = pendingArea;
    pendingArea = null;
    p.resolve(null);
  });

  // ── Analyze / Chat ──
  ipcMain.handle(invokeChannels.analyzeStart, async (_evt, input: AnalyzeInput) => {
    const streamId = await startAnalyze(input, 'analyze');
    return { streamId };
  });
  ipcMain.handle(invokeChannels.chatStart, async (_evt, input: AnalyzeInput) => {
    const streamId = await startAnalyze(input, 'chat');
    return { streamId };
  });
  ipcMain.handle(invokeChannels.analyzeCancel, async (_evt, streamId: string) => {
    cancelAnalyze(streamId);
  });

  // ── Hotkeys ──
  ipcMain.handle(invokeChannels.hotkeysList, async () => listBindings());
  ipcMain.handle(invokeChannels.hotkeysUpdate, async (_evt, bindings: HotkeyBinding[]) => {
    applyBindings(bindings);
  });
  ipcMain.handle(invokeChannels.hotkeysCaptureOnce, async () => {
    // MVP stub — settings UI builds accelerator strings locally and sends
    // them via hotkeysUpdate. Real implementation would intercept keys
    // until the next modifier+key release.
    return '';
  });

  // ── Windows ──
  ipcMain.handle(invokeChannels.windowsShow, async (_evt, name: WindowName) => {
    showWindow(name, windowOptions);
  });
  ipcMain.handle(invokeChannels.windowsHide, async (_evt, name: WindowName) => {
    hideWindow(name);
  });
  ipcMain.handle(invokeChannels.windowsToggleStealth, async (_evt, on: boolean) => {
    setStealth(on);
  });
  ipcMain.handle(
    invokeChannels.windowsResize,
    async (_evt, name: WindowName, width: number, height: number) => {
      resizeWindow(name, width, height);
    },
  );

  // ── Permissions ──
  ipcMain.handle(invokeChannels.permissionsCheck, async () => checkPermissions());
  ipcMain.handle(invokeChannels.permissionsRequest, async (_evt, kind: PermissionKind) => {
    await requestPermission(kind);
  });
  ipcMain.handle(invokeChannels.permissionsOpenSettings, async (_evt, kind: PermissionKind) => {
    await openPermissionPane(kind);
  });

  // ── History ──
  ipcMain.handle(invokeChannels.historyList, async (_evt, cursor: string, limit: number) => {
    const resp = await client.listHistory({ cursor, limit });
    return {
      conversations: resp.conversations.map(mapConversationPB),
      nextCursor: resp.nextCursor,
    };
  });
  ipcMain.handle(invokeChannels.historyGet, async (_evt, id: string) => {
    const resp = await client.getConversation({ id });
    return {
      conversation: mapConversationPB(resp.conversation),
      messages: (resp.messages ?? []).map(mapMessagePB),
    };
  });
  ipcMain.handle(invokeChannels.historyDelete, async (_evt, id: string) => {
    await client.deleteConversation({ id });
  });

  // ── Providers / quota ──
  ipcMain.handle(invokeChannels.providersList, async () => {
    const resp = await client.listProviders({});
    return resp.models;
  });
  ipcMain.handle(invokeChannels.quotaGet, async () => {
    return client.getQuota({});
  });

  // ── Rate ──
  ipcMain.handle(invokeChannels.rateMessage, async (_evt, id: string, rating: -1 | 0 | 1) => {
    await client.rateMessage({ messageId: id, rating, comment: '' });
  });

  // ── BYOK ──
  ipcMain.handle(invokeChannels.byokList, async (): Promise<ByokPresence> => listPresence());

  ipcMain.handle(
    invokeChannels.byokSave,
    async (_evt, provider: ByokProvider, key: string): Promise<ByokResult> => {
      const shapeErr = validateKeyShape(provider, key);
      if (shapeErr) return { ok: false, detail: shapeErr };
      // Test BEFORE persisting — refuse to save a key that does not work.
      try {
        const detail = await makeProvider(provider, key.trim()).test();
        await byokSave(provider, key);
        broadcast(eventChannels.byokChanged, await listPresence());
        return { ok: true, detail };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  );

  ipcMain.handle(invokeChannels.byokDelete, async (_evt, provider: ByokProvider) => {
    await byokDelete(provider);
    broadcast(eventChannels.byokChanged, await listPresence());
  });

  ipcMain.handle(
    invokeChannels.byokTest,
    async (_evt, provider: ByokProvider): Promise<ByokResult> => {
      const key = await byokLoad(provider);
      if (!key) return { ok: false, detail: 'no key configured' };
      try {
        const detail = await makeProvider(provider, key).test();
        return { ok: true, detail };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  );

  // ── Masquerade ──
  ipcMain.handle(invokeChannels.masqueradeList, async () => listPresets());
  ipcMain.handle(invokeChannels.masqueradeGet, async () => getCurrent());
  ipcMain.handle(invokeChannels.masqueradeApply, async (_evt, preset: MasqueradePreset) => {
    applyPreset(preset, resourcesPath);
  });

  // ── Auto-update ──
  ipcMain.handle(invokeChannels.updaterStatus, async () => getStatus());
  ipcMain.handle(invokeChannels.updaterCheck, async () => checkNow());
  ipcMain.handle(invokeChannels.updaterInstall, async () => installNow());

  // ── Shell ── (narrow surface: http/https only, rejects other schemes).
  ipcMain.handle(invokeChannels.shellOpenExternal, async (_evt, url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  // ── Cursor freeze ── (the "virtual cursor" UX)
  ipcMain.handle(invokeChannels.cursorFreezeState, async () => cursorState());
  ipcMain.handle(invokeChannels.cursorFreezeToggle, async () => {
    const next = await cursorToggle();
    broadcast(eventChannels.cursorFreezeChanged, next);
    return next;
  });

  // ── Sessions (Phase 12) ──
  ipcMain.handle(invokeChannels.sessionStart, async (_evt, kind: SessionKind) => {
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
  ipcMain.handle(
    invokeChannels.sessionList,
    async (_evt, cursor: string, limit: number, kind?: SessionKind) => {
      if (!sessionManager) return { sessions: [], nextCursor: '' };
      return sessionManager.list(cursor, limit, kind);
    },
  );
  ipcMain.handle(invokeChannels.sessionGetAnalysis, async (_evt, sessionId: string) => {
    if (!sessionManager) throw new Error('sessions disabled');
    return sessionManager.getAnalysis(sessionId);
  });

  // ── Voice (Whisper via BYOK OpenAI) ──
  ipcMain.handle(
    invokeChannels.voiceTranscribe,
    async (
      _evt,
      input: { audioBase64: string; mimeType: string; language?: string },
    ): Promise<{ ok: boolean; transcript?: string; error?: string }> => {
      const key = await byokLoad('openai');
      if (!key) {
        return {
          ok: false,
          error:
            'Для голосового ввода нужен OpenAI API-ключ. Добавь его в Настройки → AI провайдеры.',
        };
      }
      try {
        const audio = Uint8Array.from(Buffer.from(input.audioBase64, 'base64'));
        const transcript = await transcribe({
          apiKey: key,
          audio,
          mimeType: input.mimeType,
          language: input.language,
        });
        return { ok: true, transcript };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}

function makeProvider(family: ByokProvider, key: string) {
  return family === 'openai' ? new OpenAIProvider(key) : new AnthropicProvider(key);
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
