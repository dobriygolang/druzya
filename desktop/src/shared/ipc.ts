// IPC contract between main and renderer. Keep this file the single source
// of truth for channel names and payload shapes — both processes import it.
//
// Rule: renderer NEVER imports electron or node APIs directly. All system
// access goes through window.druz9.* (see preload/index.ts).

import type { DesktopConfig, Quota, HotkeyAction, HotkeyBinding } from './types';

/** Channels invoked from renderer → main (request/response). */
export const invokeChannels = {
  authLoginTelegram: 'auth:login-telegram',
  authLogout: 'auth:logout',
  authSession: 'auth:session',

  configGet: 'config:get',
  configRefresh: 'config:refresh',

  captureScreenshotArea: 'capture:screenshot-area',
  captureScreenshotFull: 'capture:screenshot-full',

  analyzeStart: 'analyze:start',
  analyzeCancel: 'analyze:cancel',
  chatStart: 'chat:start',

  hotkeysList: 'hotkeys:list',
  hotkeysUpdate: 'hotkeys:update',
  hotkeysCaptureOnce: 'hotkeys:capture-once',

  windowsShow: 'windows:show',
  windowsHide: 'windows:hide',
  windowsToggleStealth: 'windows:toggle-stealth',

  permissionsCheck: 'permissions:check',
  permissionsRequest: 'permissions:request',
  permissionsOpenSettings: 'permissions:open-settings',

  historyList: 'history:list',
  historyGet: 'history:get',
  historyDelete: 'history:delete',

  providersList: 'providers:list',
  quotaGet: 'quota:get',
  rateMessage: 'messages:rate',
} as const;

/** Events pushed from main → renderer. */
export const eventChannels = {
  analyzeCreated: 'event:analyze-created',
  analyzeDelta: 'event:analyze-delta',
  analyzeDone: 'event:analyze-done',
  analyzeError: 'event:analyze-error',

  hotkeyFired: 'event:hotkey-fired',
  configUpdated: 'event:config-updated',
  quotaUpdated: 'event:quota-updated',
  authChanged: 'event:auth-changed',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Invoke payloads
// ─────────────────────────────────────────────────────────────────────────

export interface AuthSession {
  userId: string;
  expiresAt: string; // ISO-8601
}

export interface CaptureResult {
  /** PNG bytes, base64-encoded. The renderer forwards straight to analyzeStart. */
  dataBase64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}

export interface AnalyzeInput {
  /** Empty string means "start a new conversation". */
  conversationId: string;
  promptText: string;
  model: string; // empty → server default
  attachments: Array<{
    kind: 'screenshot' | 'voice_transcript';
    dataBase64: string;
    mimeType: string;
    width: number;
    height: number;
  }>;
  triggerAction: HotkeyAction;
  focusedAppHint: string;
}

export interface AnalyzeHandle {
  streamId: string;
}

export interface PermissionState {
  screenRecording: 'granted' | 'denied' | 'not-determined';
  accessibility: 'granted' | 'denied' | 'not-determined';
  microphone: 'granted' | 'denied' | 'not-determined';
}

export type PermissionKind = 'screen-recording' | 'accessibility' | 'microphone';

export type WindowName = 'compact' | 'expanded' | 'settings' | 'onboarding';

// ─────────────────────────────────────────────────────────────────────────
// Event payloads
// ─────────────────────────────────────────────────────────────────────────

export interface AnalyzeCreatedEvent {
  streamId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  model: string;
}

export interface AnalyzeDeltaEvent {
  streamId: string;
  text: string;
}

export interface AnalyzeDoneEvent {
  streamId: string;
  assistantMessageId: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  quota: Quota;
}

export interface AnalyzeErrorEvent {
  streamId: string;
  code: string;
  message: string;
  retryAfterSeconds: number;
}

export interface HotkeyFiredEvent {
  action: HotkeyAction;
}

export interface AuthChangedEvent {
  session: AuthSession | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Typed API surface exposed to renderer as `window.druz9`.
// The preload script wires ipcRenderer.invoke + ipcRenderer.on into these
// methods; the renderer code is fully typed against this interface.
// ─────────────────────────────────────────────────────────────────────────

export interface Druz9API {
  auth: {
    loginTelegram: () => Promise<AuthSession>;
    logout: () => Promise<void>;
    session: () => Promise<AuthSession | null>;
  };
  config: {
    get: () => Promise<DesktopConfig>;
    refresh: () => Promise<DesktopConfig>;
  };
  capture: {
    screenshotArea: () => Promise<CaptureResult>;
    screenshotFull: () => Promise<CaptureResult>;
  };
  analyze: {
    start: (input: AnalyzeInput) => Promise<AnalyzeHandle>;
    cancel: (streamId: string) => Promise<void>;
    chat: (input: AnalyzeInput) => Promise<AnalyzeHandle>;
  };
  hotkeys: {
    list: () => Promise<HotkeyBinding[]>;
    update: (bindings: HotkeyBinding[]) => Promise<void>;
    captureOnce: () => Promise<string>;
  };
  windows: {
    show: (name: WindowName) => Promise<void>;
    hide: (name: WindowName) => Promise<void>;
    toggleStealth: (on: boolean) => Promise<void>;
  };
  permissions: {
    check: () => Promise<PermissionState>;
    request: (kind: PermissionKind) => Promise<void>;
    openSettings: (kind: PermissionKind) => Promise<void>;
  };
  history: {
    list: (cursor: string, limit: number) => Promise<{ conversations: unknown[]; nextCursor: string }>;
    get: (id: string) => Promise<unknown>;
    delete: (id: string) => Promise<void>;
  };
  providers: { list: () => Promise<unknown[]> };
  quota: { get: () => Promise<Quota> };
  messages: { rate: (id: string, rating: -1 | 0 | 1) => Promise<void> };

  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on: <T = unknown>(channel: string, handler: (payload: T) => void) => () => void;
}
