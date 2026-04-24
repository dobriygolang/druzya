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
  /** Open the floating picker (persona or model) anchored to compact. */
  windowsShowPicker: 'windows:show-picker',
  windowsHidePicker: 'windows:hide-picker',
  /** Show a small floating toast window next to compact. Used for
   *  errors that don't fit in the compact's 460×92 footprint (e.g. the
   *  full Screen Recording permission path). */
  toastShow: 'toast:show',
  toastDismiss: 'toast:dismiss',

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

  appearanceGet: 'appearance:get',
  appearanceSet: 'appearance:set',

  personasList: 'personas:list',

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

  documentsList: 'documents:list',
  documentsGet: 'documents:get',
  documentsUpload: 'documents:upload',
  documentsDelete: 'documents:delete',
  documentsSearch: 'documents:search',
  documentsAttachToSession: 'documents:attach-to-session',
  documentsDetachFromSession: 'documents:detach-from-session',
  documentsListAttached: 'documents:list-attached',
  /** Expanded calls this on mount to pick up any userTurnStarted event
   *  that fired before its renderer had subscribed (race: compact kicks
   *  off analyze.start, main broadcasts, then compact asks main to
   *  open expanded — by the time expanded's useEffect runs, the event
   *  has already been dispatched and lost). */
  getLastUserTurn: 'ui:get-last-user-turn',
  /** Any renderer announces a model-picker change; main fans it out. */
  selectedModelChanged: 'ui:selected-model-changed',
  /** Renderer → main: announce persona pick, rebroadcast to all windows. */
  activePersonaChanged: 'ui:active-persona-changed',
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
  appearanceChanged: 'event:appearance-changed',
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
  /** Persona picked in one window (e.g. separate picker window) →
   *  rebroadcast so Compact/Expanded/etc mirror the selection. Same
   *  cross-renderer sync pattern as selectedModelChanged. */
  activePersonaChanged: 'event:active-persona-changed',
  /** Picker window opened / closed. Compact subscribes so the caret
   *  on the corresponding pill rotates up. Payload: PickerStateEvent. */
  pickerStateChanged: 'event:picker-state-changed',
} as const;

export interface PickerStateEvent {
  /** Which picker is open. null when no picker is visible. */
  kind: PickerKind | null;
}

export interface ActivePersonaChangedEvent {
  personaId: string;
}

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
// Appearance
// ─────────────────────────────────────────────────────────────────────────

/** User-tunable look-and-feel. Today: only the expanded chat's
 *  background opacity (0 = fully transparent / blurred, 100 = fully
 *  opaque). Expanded window bounds (user-resized) also persist but
 *  aren't surfaced in the UI — they restore automatically on next
 *  open. */
export interface AppearancePrefs {
  expandedOpacity: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Personas (server-driven catalogue of expert-mode presets)
// ─────────────────────────────────────────────────────────────────────────

/** Wire shape of one persona as served by /api/v1/personas. Matches
 *  the backend PersonaDTO (services/ai_native/ports/personas.go).
 *  Renderer picks this up via `window.druz9.personas.list()` which in
 *  turn reads the in-process cache populated by main at startup. */
export interface Persona {
  id: string;
  label: string;
  hint: string;
  icon_emoji: string;
  brand_gradient: string;
  suggested_task?: string;
  system_prompt: string;
  sort_order: number;
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
  | 'history'
  | 'picker'
  | 'toast';

/** Picker kind — which dropdown the compact opens in the floating picker
 *  window. Persona / Model each reuse their own dropdown component. */
export type PickerKind = 'persona' | 'model';

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
// Documents (RAG store)
// ─────────────────────────────────────────────────────────────────────────

/** Status of the async ingest pipeline. Mirrors backend documents.Status. */
export type DocumentStatus =
  | 'pending'
  | 'extracting'
  | 'embedding'
  | 'ready'
  | 'failed'
  | 'deleting';

export interface Document {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sourceUrl: string;
  status: DocumentStatus;
  errorMessage: string;
  chunkCount: number;
  tokenCount: number;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Payload for uploading a document. Content is the raw bytes — the
 *  renderer reads the File via `arrayBuffer()` and hands over a
 *  Uint8Array. The main process base64-encodes before hitting the REST
 *  API; we deliberately don't leak base64 across the IPC boundary (the
 *  8-bit binary crosses zero-copy as a transferable buffer). */
export interface DocumentUploadInput {
  filename: string;
  mime: string;
  content: Uint8Array;
  sourceUrl?: string;
}

export interface DocumentSearchHit {
  docId: string;
  chunkId: string;
  ord: number;
  score: number;
  content: string;
}

export interface DocumentListResult {
  documents: Document[];
  nextCursor: string;
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
    /** Open the picker as a separate floating window anchored under
     *  compact. Toggles: same kind → close; different kind → switch. */
    showPicker: (kind: PickerKind) => Promise<void>;
    hidePicker: () => Promise<void>;
  };
  toast: {
    /** Show a floating notification next to the compact window.
     *  `kind` tints the left accent bar (error/warn/info).
     *  Auto-dismisses after ~6s unless the user clicks it. */
    show: (msg: string, kind?: 'error' | 'warn' | 'info') => Promise<void>;
    dismiss: () => Promise<void>;
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
   * Personas — server-driven catalogue of expert-mode presets.
   * Main fetches once at startup from /api/v1/personas and caches;
   * renderer reads via this IPC method. Empty array on network
   * failure — compact picker handles it by showing only the default
   * baseline persona (always seeded server-side in migration 00051).
   */
  personas: {
    list: () => Promise<Persona[]>;
  };

  /**
   * Appearance — expanded-chat background opacity slider. The expanded
   * window is freely resizable; the last user-set bounds are persisted
   * automatically and not exposed in this API (restored on next open).
   */
  appearance: {
    get: () => Promise<AppearancePrefs>;
    set: (prefs: Partial<AppearancePrefs>) => Promise<AppearancePrefs>;
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
    /** Announce a persona pick. Main rebroadcasts as activePersonaChanged
     *  so Compact / Expanded / Picker mirror the selection. */
    announcePersonaChanged: (personaId: string) => Promise<void>;
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
   * analysis. Analyzer runs on the backend and the final report URL
   * lands at `reportUrl`.
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
  };

  /**
   * Documents — user-uploaded files (CV, JD, notes) that power the
   * RAG-context injection in copilot. Upload goes bytes-in-bytes-out;
   * the main process base64-encodes at the REST boundary so renderer
   * code never deals with encoding.
   *
   * Attach/detach is scoped to a session: once attached, every
   * subsequent turn in that session pulls the top-K relevant chunks
   * into the system prompt.
   */
  documents: {
    list: (cursor: string, limit: number) => Promise<DocumentListResult>;
    get: (id: string) => Promise<Document>;
    upload: (input: DocumentUploadInput) => Promise<Document>;
    delete: (id: string) => Promise<void>;
    search: (docIds: string[], query: string, topK?: number) => Promise<DocumentSearchHit[]>;
    attachToSession: (sessionId: string, docId: string) => Promise<void>;
    detachFromSession: (sessionId: string, docId: string) => Promise<void>;
    listAttachedToSession: (sessionId: string) => Promise<string[]>;
  };

  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on: <T = unknown>(channel: string, handler: (payload: T) => void) => () => void;
}
