// All IPC invoke handlers live here. Channel names come from @shared/ipc
// so main and renderer share a single source of truth.

import { ipcMain } from 'electron';

import {
  invokeChannels,
  type AnalyzeInput,
  type CaptureResult,
  type PermissionKind,
  type WindowName,
} from '@shared/ipc';
import type { HotkeyBinding } from '@shared/types';

import { clearSession, loadSession } from '../auth/keychain';
import { captureArea, captureFullScreen } from '../capture/screenshot';
import { applyBindings, listBindings } from '../hotkeys/registry';
import {
  checkPermissions,
  openPermissionPane,
  requestPermission,
} from '../permissions/macos';
import { hideWindow, setStealth, showWindow } from '../windows/window-manager';
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
}

export function registerHandlers(opts: RegisterOptions): void {
  const { client, windowOptions, startAnalyze, cancelAnalyze } = opts;

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
  ipcMain.handle(
    invokeChannels.captureScreenshotArea,
    async (
      _evt,
      rect: { x: number; y: number; width: number; height: number },
    ): Promise<CaptureResult> => captureArea(rect),
  );

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
}
