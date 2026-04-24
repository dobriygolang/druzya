// IPC contract between main and renderer. Keep this file the single source
// of truth for channel names and payload shapes — both processes import it.
//
// Rule: renderer NEVER imports electron or node APIs directly. All system
// access goes through window.druz9.* (see preload/index.ts).

import type { DesktopConfig, Quota, HotkeyAction, HotkeyBinding } from './types';

/** Channels invoked from renderer → main (request/response). */
export const invokeChannels = {
  /** Start the Telegram code-flow; returns {code, deepLink, expiresAt}. */
  authLoginTelegramStart: 'auth:login-telegram-start',
  /** Blocking poll — resolves with SessionProfile on success. */
  authLoginTelegramAwait: 'auth:login-telegram-await',
  /** Abort the in-flight await so the user can restart. */
  authLoginTelegramCancel: 'auth:login-telegram-cancel',
  authLogout: 'auth:logout',
  authSession: 'auth:session',

  configGet: 'config:get',
  configRefresh: 'config:refresh',

  captureScreenshotArea: 'capture:screenshot-area',
  captureScreenshotFull: 'capture:screenshot-full',
  /** Area overlay → main: the user's selected rect. */
  captureAreaCommit: 'capture:area-commit',
  /** Area overlay → main: user cancelled (Esc / right-click). */
  captureAreaCancel: 'capture:area-cancel',

  analyzeStart: 'analyze:start',
  analyzeCancel: 'analyze:cancel',
  chatStart: 'chat:start',

  hotkeysList: 'hotkeys:list',
  hotkeysUpdate: 'hotkeys:update',
  hotkeysCaptureOnce: 'hotkeys:capture-once',

  windowsShow: 'windows:show',
  windowsHide: 'windows:hide',
  windowsToggleStealth: 'windows:toggle-stealth',
  windowsResize: 'windows:resize',

  permissionsCheck: 'permissions:check',
  permissionsRequest: 'permissions:request',
  permissionsOpenSettings: 'permissions:open-settings',

  historyList: 'history:list',
  historyGet: 'history:get',
  historyDelete: 'history:delete',

  providersList: 'providers:list',
  quotaGet: 'quota:get',
  rateMessage: 'messages:rate',

  masqueradeList: 'masquerade:list',
  masqueradeGet: 'masquerade:get',
  masqueradeApply: 'masquerade:apply',

  updaterStatus: 'updater:status',
  updaterCheck: 'updater:check',
  updaterInstall: 'updater:install',

  shellOpenExternal: 'shell:open-external',

  appQuit: 'app:quit',

  /** Renderer → main: ask to broadcast "open provider picker" to the
   *  expanded window. Main handles showing the expanded window too. */
  openProviderPicker: 'ui:open-provider-picker',

  cursorFreezeState: 'cursor:freeze-state',
  cursorFreezeToggle: 'cursor:freeze-toggle',

  sessionStart: 'session:start',
  sessionEnd: 'session:end',
  sessionCurrent: 'session:current',
  sessionList: 'session:list',
  sessionGetAnalysis: 'session:get-analysis',
  /** Expanded calls this on mount to pick up any userTurnStarted event
   *  that fired before its renderer had subscribed (race: compact kicks
   *  off analyze.start, main broadcasts, then compact asks main to
   *  open expanded — by the time expanded's useEffect runs, the event
   *  has already been dispatched and lost). */
  getLastUserTurn: 'ui:get-last-user-turn',
  /** Any renderer announces a model-picker change; main fans it out. */
  selectedModelChanged: 'ui:selected-model-changed',
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
  updateStatus: 'event:update-status',
  cursorFreezeChanged: 'event:cursor-freeze-changed',
  sessionChanged: 'event:session-changed',
  sessionAnalysisReady: 'event:session-analysis-ready',
  /** Compact → main → expanded: "open the provider picker on arrival".
   *  Emitted by the little "choose model" button in compact since the
   *  picker modal (440×520) doesn't fit inside the compact window. */
  openProviderPicker: 'event:open-provider-picker',
  /** Fired by main right after analyze.start succeeds, so every window
   *  (compact for its own feed, expanded for the chat) can draw the
   *  optimistic user bubble — including the screenshot preview — before
   *  the server sends its 'created' frame. Carries the full data URL so
   *  the expanded window, which is a different renderer process, can
   *  render the image without a round-trip through the main process. */
  userTurnStarted: 'event:user-turn-started',
  /** Model picked in one window → rebroadcast so the others sync their
   *  selected-model store. Each BrowserWindow has its own renderer
   *  process, so localStorage-backed zustand stores do not share state
   *  cross-window without an explicit bridge. */
  selectedModelChanged: 'event:selected-model-changed',
} as const;

export interface SelectedModelChangedEvent {
  modelId: string;
}

export interface UserTurnStartedEvent {
  streamId: string;
  promptText: string;
  hasScreenshot: boolean;
  /** Full data URL (`data:image/png;base64,…`). Empty when no screenshot. */
  screenshotDataUrl: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Masquerade types
// ─────────────────────────────────────────────────────────────────────────

export type MasqueradePreset = 'druz9' | 'notes' | 'telegram' | 'xcode' | 'slack';

export interface MasqueradePresetInfo {
  id: MasqueradePreset;
  displayName: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-update types
// ─────────────────────────────────────────────────────────────────────────

export type CursorFreezeState = 'thawed' | 'frozen' | 'unavailable';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string; releaseNotes?: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────────
// Invoke payloads
// ─────────────────────────────────────────────────────────────────────────

export interface AuthSession {
  userId: string;
  username?: string;
  avatarURL?: string;
  expiresAt: string; // ISO-8601
}

export interface TelegramLoginStart {
  /** 8-char Crockford base32. Shown to the user so they can verify the bot. */
  code: string;
  /** https://t.me/<bot>?start=<code>. Already opened in the browser by main. */
  deepLink: string;
  /** ISO-8601 — after this the code is garbage-collected, start over. */
  expiresAt: string;
}

export interface TelegramLoginResult {
  userId: string;
  username: string;
  avatarURL: string;
  isNewUser: boolean;
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

export type WindowName =
  | 'compact'
  | 'expanded'
  | 'settings'
  | 'onboarding'
  | 'area-overlay'
  | 'history';

/** Rect selected by the user in the area-picker overlay. Absolute pixels
 *  on the primary display. Returned from `capture:start-area`. */
export interface AreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
    /** Kick off the code-flow and return the code + deep-link. */
    loginTelegramStart: () => Promise<TelegramLoginStart>;
    /** Poll for completion; resolves with the new user's profile. */
    loginTelegramAwait: () => Promise<TelegramLoginResult>;
    loginTelegramCancel: () => Promise<void>;
    logout: () => Promise<void>;
    session: () => Promise<AuthSession | null>;
  };
  config: {
    get: () => Promise<DesktopConfig>;
    refresh: () => Promise<DesktopConfig>;
  };
  capture: {
    /**
     * Opens a fullscreen crosshair overlay, lets the user drag a rect,
     * then returns the cropped screenshot. Resolves with null if the
     * user cancels (Esc / right-click).
     */
    screenshotArea: () => Promise<CaptureResult | null>;
    screenshotFull: () => Promise<CaptureResult>;
    /** Overlay window → main: commit the drawn rect. */
    commitArea: (rect: AreaRect) => void;
    /** Overlay window → main: cancel. */
    cancelArea: () => void;
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
    /** Animated resize of a floating window; width/height in CSS pixels. */
    resize: (name: WindowName, width: number, height: number) => Promise<void>;
  };
  permissions: {
    check: () => Promise<PermissionState>;
    request: (kind: PermissionKind) => Promise<void>;
    openSettings: (kind: PermissionKind) => Promise<void>;
  };
  history: {
    list: (
      cursor: string,
      limit: number,
    ) => Promise<{ conversations: import('./types').Conversation[]; nextCursor: string }>;
    get: (id: string) => Promise<{
      conversation: import('./types').Conversation;
      messages: import('./types').Message[];
    }>;
    delete: (id: string) => Promise<void>;
  };
  providers: { list: () => Promise<unknown[]> };
  quota: { get: () => Promise<Quota> };
  messages: { rate: (id: string, rating: -1 | 0 | 1) => Promise<void> };

  /**
   * Masquerade — swap the Dock icon and window titles at runtime. Process
   * renaming in Activity Monitor requires alternative build targets and
   * is not supported at runtime.
   */
  masquerade: {
    list: () => Promise<MasqueradePresetInfo[]>;
    get: () => Promise<MasqueradePreset>;
    apply: (preset: MasqueradePreset) => Promise<void>;
  };

  /**
   * Auto-update — queries the electron-updater feed declared in
   * DesktopConfig.UpdateFeedURL. No-op in dev builds.
   */
  updater: {
    status: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    install: () => Promise<void>;
  };

  /** Opens an external URL in the user's default browser. Main-side
   *  allow-list enforces http/https only. */
  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  app: {
    /** Quit the entire application. User-confirmed elsewhere. */
    quit: () => Promise<void>;
  };

  /** UI hand-offs between windows. */
  ui: {
    /** Ask the expanded window to open the model picker on arrival. */
    openProviderPicker: () => Promise<void>;
    /** Fetch the last user-turn snapshot from main — used by expanded on
     *  mount to paint a turn that was kicked off from compact before this
     *  window had a chance to subscribe to the broadcast. */
    getLastUserTurn: () => Promise<UserTurnStartedEvent | null>;
    /** Announce a model pick. Main rebroadcasts as selectedModelChanged
     *  so every window's selected-model store stays in sync. */
    announceModelChanged: (modelId: string) => Promise<void>;
  };

  /**
   * Virtual cursor — parks the system cursor at its current position
   * by warping it back every frame. Requires a native mouse-control
   * module (robotjs or @nut-tree-fork/libnut); if none is installed,
   * toggle() returns 'unavailable' and the UI surfaces a hint.
   */
  cursor: {
    state: () => Promise<CursorFreezeState>;
    toggle: () => Promise<CursorFreezeState>;
  };

  /**
   * Sessions (Phase 12) — explicit group-of-conversations for post-
   * analysis. BYOK users get an in-process analyzer; everyone else
   * gets a server-driven one with the report at `reportUrl`.
   */
  sessions: {
    start: (
      kind: import('./types').SessionKind,
    ) => Promise<import('./types').Session>;
    end: () => Promise<import('./types').Session | null>;
    current: () => Promise<import('./types').Session | null>;
    list: (
      cursor: string,
      limit: number,
      kind?: import('./types').SessionKind,
    ) => Promise<{ sessions: import('./types').Session[]; nextCursor: string }>;
    getAnalysis: (
      sessionId: string,
    ) => Promise<import('./types').SessionAnalysis>;
    /** Renderer → main: reply to sessionRequestLocalTranscript event
     *  with a Markdown dump of the in-memory turns. Fire-and-forget. */
    submitLocalTranscript: (markdown: string) => void;
  };

  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on: <T = unknown>(channel: string, handler: (payload: T) => void) => () => void;
}
