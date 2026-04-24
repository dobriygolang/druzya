// Preload script — runs in a privileged context with access to Node,
// exposes a narrow typed API to the renderer via contextBridge.
//
// Rule: every method below is just a thin ipcRenderer.invoke or .on
// wrapper. No business logic here — anything domain-related lives in
// main/ or renderer/.

import { contextBridge, ipcRenderer } from 'electron';

import {
  eventChannels,
  invokeChannels,
  type AnalyzeInput,
  type AppearancePrefs,
  type AreaRect,
  type AuthSession,
  type CaptureResult,
  type Document,
  type DocumentListResult,
  type DocumentSearchHit,
  type DocumentUploadInput,
  type Druz9API,
  type MasqueradePreset,
  type MasqueradePresetInfo,
  type Persona,
  type TranscribeInput,
  type TranscribeResult,
  type AudioCaptureState,
  type CursorFreezeState,
  type PermissionKind,
  type PermissionState,
  type TelegramLoginResult,
  type TelegramLoginStart,
  type UpdateStatus,
  type PickerKind,
  type WindowName,
} from '@shared/ipc';
import type { HotkeyBinding, Quota, Session, SessionAnalysis, SessionKind } from '@shared/types';

const api: Druz9API = {
  auth: {
    loginTelegramStart: () =>
      ipcRenderer.invoke(invokeChannels.authLoginTelegramStart) as Promise<TelegramLoginStart>,
    loginTelegramAwait: () =>
      ipcRenderer.invoke(invokeChannels.authLoginTelegramAwait) as Promise<TelegramLoginResult>,
    loginTelegramCancel: () =>
      ipcRenderer.invoke(invokeChannels.authLoginTelegramCancel) as Promise<void>,
    logout: () => ipcRenderer.invoke(invokeChannels.authLogout) as Promise<void>,
    session: () => ipcRenderer.invoke(invokeChannels.authSession) as Promise<AuthSession | null>,
  },
  config: {
    // `ReturnType<Druz9API['config']['get']>` is itself `Promise<DesktopConfig>`,
    // so casting `ipcRenderer.invoke(...)` (already `Promise<any>`) directly
    // to it is sufficient — the double cast via `as unknown` chain earlier
    // confused TS into seeing `Promise<Promise<DesktopConfig>>`.
    get: () =>
      ipcRenderer.invoke(invokeChannels.configGet) as ReturnType<Druz9API['config']['get']>,
    refresh: () =>
      ipcRenderer.invoke(invokeChannels.configRefresh) as ReturnType<Druz9API['config']['refresh']>,
  },
  capture: {
    screenshotArea: () =>
      ipcRenderer.invoke(invokeChannels.captureScreenshotArea) as Promise<CaptureResult | null>,
    screenshotFull: () =>
      ipcRenderer.invoke(invokeChannels.captureScreenshotFull) as Promise<CaptureResult>,
    commitArea: (rect: AreaRect) => ipcRenderer.send(invokeChannels.captureAreaCommit, rect),
    cancelArea: () => ipcRenderer.send(invokeChannels.captureAreaCancel),
  },
  analyze: {
    start: (input: AnalyzeInput) =>
      ipcRenderer.invoke(invokeChannels.analyzeStart, input) as Promise<{ streamId: string }>,
    cancel: (streamId: string) =>
      ipcRenderer.invoke(invokeChannels.analyzeCancel, streamId) as Promise<void>,
    chat: (input: AnalyzeInput) =>
      ipcRenderer.invoke(invokeChannels.chatStart, input) as Promise<{ streamId: string }>,
  },
  hotkeys: {
    list: () => ipcRenderer.invoke(invokeChannels.hotkeysList) as Promise<HotkeyBinding[]>,
    update: (bindings: HotkeyBinding[]) =>
      ipcRenderer.invoke(invokeChannels.hotkeysUpdate, bindings) as Promise<void>,
    captureOnce: () => ipcRenderer.invoke(invokeChannels.hotkeysCaptureOnce) as Promise<string>,
  },
  windows: {
    show: (name: WindowName) => ipcRenderer.invoke(invokeChannels.windowsShow, name) as Promise<void>,
    hide: (name: WindowName) => ipcRenderer.invoke(invokeChannels.windowsHide, name) as Promise<void>,
    toggleStealth: (on: boolean) =>
      ipcRenderer.invoke(invokeChannels.windowsToggleStealth, on) as Promise<void>,
    resize: (name: WindowName, width: number, height: number) =>
      ipcRenderer.invoke(invokeChannels.windowsResize, name, width, height) as Promise<void>,
    showPicker: (kind: PickerKind) =>
      ipcRenderer.invoke(invokeChannels.windowsShowPicker, kind) as Promise<void>,
    hidePicker: () =>
      ipcRenderer.invoke(invokeChannels.windowsHidePicker) as Promise<void>,
  },
  toast: {
    show: (msg: string, kind?: 'error' | 'warn' | 'info') =>
      ipcRenderer.invoke(invokeChannels.toastShow, msg, kind ?? 'info') as Promise<void>,
    dismiss: () => ipcRenderer.invoke(invokeChannels.toastDismiss) as Promise<void>,
  },
  permissions: {
    check: () => ipcRenderer.invoke(invokeChannels.permissionsCheck) as Promise<PermissionState>,
    request: (kind: PermissionKind) =>
      ipcRenderer.invoke(invokeChannels.permissionsRequest, kind) as Promise<void>,
    openSettings: (kind: PermissionKind) =>
      ipcRenderer.invoke(invokeChannels.permissionsOpenSettings, kind) as Promise<void>,
  },
  history: {
    list: (cursor: string, limit: number) =>
      ipcRenderer.invoke(invokeChannels.historyList, cursor, limit) as ReturnType<
        Druz9API['history']['list']
      >,
    get: (id: string) =>
      ipcRenderer.invoke(invokeChannels.historyGet, id) as ReturnType<Druz9API['history']['get']>,
    delete: (id: string) => ipcRenderer.invoke(invokeChannels.historyDelete, id) as Promise<void>,
  },
  providers: {
    list: () => ipcRenderer.invoke(invokeChannels.providersList) as Promise<unknown[]>,
  },
  quota: {
    get: () => ipcRenderer.invoke(invokeChannels.quotaGet) as Promise<Quota>,
  },
  messages: {
    rate: (id, rating) =>
      ipcRenderer.invoke(invokeChannels.rateMessage, id, rating) as Promise<void>,
  },
  masquerade: {
    list: () =>
      ipcRenderer.invoke(invokeChannels.masqueradeList) as Promise<MasqueradePresetInfo[]>,
    get: () => ipcRenderer.invoke(invokeChannels.masqueradeGet) as Promise<MasqueradePreset>,
    apply: (preset: MasqueradePreset) =>
      ipcRenderer.invoke(invokeChannels.masqueradeApply, preset) as Promise<void>,
  },
  appearance: {
    get: () => ipcRenderer.invoke(invokeChannels.appearanceGet) as Promise<AppearancePrefs>,
    set: (prefs: Partial<AppearancePrefs>) =>
      ipcRenderer.invoke(invokeChannels.appearanceSet, prefs) as Promise<AppearancePrefs>,
  },
  personas: {
    list: () => ipcRenderer.invoke(invokeChannels.personasList) as Promise<Persona[]>,
  },
  updater: {
    status: () => ipcRenderer.invoke(invokeChannels.updaterStatus) as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke(invokeChannels.updaterCheck) as Promise<UpdateStatus>,
    install: () => ipcRenderer.invoke(invokeChannels.updaterInstall) as Promise<void>,
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(invokeChannels.shellOpenExternal, url) as Promise<void>,
  },
  app: {
    quit: () => ipcRenderer.invoke(invokeChannels.appQuit) as Promise<void>,
  },
  ui: {
    openProviderPicker: () =>
      ipcRenderer.invoke(invokeChannels.openProviderPicker) as Promise<void>,
    getLastUserTurn: () =>
      ipcRenderer.invoke(invokeChannels.getLastUserTurn) as Promise<
        import('@shared/ipc').UserTurnStartedEvent | null
      >,
    announceModelChanged: (modelId: string) =>
      ipcRenderer.invoke(invokeChannels.selectedModelChanged, modelId) as Promise<void>,
    announcePersonaChanged: (personaId: string) =>
      ipcRenderer.invoke(invokeChannels.activePersonaChanged, personaId) as Promise<void>,
  },
  cursor: {
    state: () =>
      ipcRenderer.invoke(invokeChannels.cursorFreezeState) as Promise<CursorFreezeState>,
    toggle: () =>
      ipcRenderer.invoke(invokeChannels.cursorFreezeToggle) as Promise<CursorFreezeState>,
  },
  sessions: {
    start: (kind: SessionKind) =>
      ipcRenderer.invoke(invokeChannels.sessionStart, kind) as Promise<Session>,
    end: () => ipcRenderer.invoke(invokeChannels.sessionEnd) as Promise<Session | null>,
    current: () =>
      ipcRenderer.invoke(invokeChannels.sessionCurrent) as Promise<Session | null>,
    list: (cursor: string, limit: number, kind?: SessionKind) =>
      ipcRenderer.invoke(invokeChannels.sessionList, cursor, limit, kind) as Promise<{
        sessions: Session[];
        nextCursor: string;
      }>,
    getAnalysis: (sessionId: string) =>
      ipcRenderer.invoke(invokeChannels.sessionGetAnalysis, sessionId) as Promise<SessionAnalysis>,
  },
  transcription: {
    transcribe: (input: TranscribeInput) =>
      ipcRenderer.invoke(invokeChannels.transcriptionTranscribe, input) as Promise<TranscribeResult>,
  },
  audioCapture: {
    start: () => ipcRenderer.invoke(invokeChannels.audioCaptureStart) as Promise<void>,
    stop: () => ipcRenderer.invoke(invokeChannels.audioCaptureStop) as Promise<void>,
    state: () => ipcRenderer.invoke(invokeChannels.audioCaptureState) as Promise<AudioCaptureState>,
    isAvailable: () => ipcRenderer.invoke(invokeChannels.audioCaptureIsAvailable) as Promise<boolean>,
  },
  documents: {
    list: (cursor: string, limit: number) =>
      ipcRenderer.invoke(invokeChannels.documentsList, cursor, limit) as Promise<DocumentListResult>,
    get: (id: string) =>
      ipcRenderer.invoke(invokeChannels.documentsGet, id) as Promise<Document>,
    upload: (input: DocumentUploadInput) =>
      ipcRenderer.invoke(invokeChannels.documentsUpload, input) as Promise<Document>,
    uploadFromURL: (url: string) =>
      ipcRenderer.invoke(invokeChannels.documentsUploadFromURL, url) as Promise<Document>,
    delete: (id: string) =>
      ipcRenderer.invoke(invokeChannels.documentsDelete, id) as Promise<void>,
    search: (docIds: string[], query: string, topK?: number) =>
      ipcRenderer.invoke(invokeChannels.documentsSearch, {
        docIds,
        query,
        topK,
      }) as Promise<DocumentSearchHit[]>,
    attachToSession: (sessionId: string, docId: string) =>
      ipcRenderer.invoke(invokeChannels.documentsAttachToSession, sessionId, docId) as Promise<void>,
    detachFromSession: (sessionId: string, docId: string) =>
      ipcRenderer.invoke(invokeChannels.documentsDetachFromSession, sessionId, docId) as Promise<void>,
    listAttachedToSession: (sessionId: string) =>
      ipcRenderer.invoke(invokeChannels.documentsListAttached, sessionId) as Promise<string[]>,
  },
  on: <T>(channel: string, handler: (payload: T) => void) => {
    // Whitelist so renderer can't subscribe to arbitrary channels.
    const allowed = Object.values(eventChannels) as string[];
    if (!allowed.includes(channel)) {
      throw new Error(`channel not allowed: ${channel}`);
    }
    const listener = (_evt: unknown, payload: T) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('druz9', api);
