// All IPC invoke handlers live here. Channel names come from @shared/ipc
// so main and renderer share a single source of truth.

import { ipcMain } from 'electron';

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
  deleteKey as byokDelete,
  listPresence,
  loadKey as byokLoad,
  saveKey as byokSave,
  validateKeyShape,
} from '../auth/byok-keychain';
import { AnthropicProvider } from '../api/providers/anthropic';
import { OpenAIProvider } from '../api/providers/openai';
import { transcribe } from '../api/providers/whisper';
import { applyPreset, getCurrent, listPresets, type MasqueradePreset } from '../masquerade';
import { captureArea, captureFullScreen } from '../capture/screenshot';
import { applyBindings, listBindings } from '../hotkeys/registry';
import {
  checkPermissions,
  openPermissionPane,
  requestPermission,
} from '../permissions/macos';
import { broadcast, hideWindow, setStealth, showWindow } from '../windows/window-manager';
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
}

export function registerHandlers(opts: RegisterOptions): void {
  const { client, windowOptions, startAnalyze, cancelAnalyze, resourcesPath } = opts;

  // ── Auth ──
  ipcMain.handle(invokeChannels.authSession, async () => {
    const s = await loadSession();
    if (!s) return null;
    return { userId: s.userId, expiresAt: s.expiresAt };
  });
  ipcMain.handle(invokeChannels.authLogout, async () => {
    await clearSession();
  });
  ipcMain.handle(invokeChannels.authLoginTelegram, async () => {
    // Opens a browser to the Telegram widget; the deep-link handler in
    // auth/deeplink.ts stores the session and we re-read it here.
    // MVP stub: return current session; the real login is initiated by
    // the renderer via windows/onboarding.
    const s = await loadSession();
    if (!s) throw new Error('not logged in');
    return { userId: s.userId, expiresAt: s.expiresAt };
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
      conversations: resp.conversations,
      nextCursor: resp.nextCursor,
    };
  });
  ipcMain.handle(invokeChannels.historyGet, async (_evt, id: string) => {
    return client.getConversation({ id });
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
