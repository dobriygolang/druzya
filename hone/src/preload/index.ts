// Preload — runs in a privileged context with partial Node access and
// exposes a narrow, typed API to the renderer via contextBridge.
//
// Rule: every method here is a thin ipcRenderer wrapper, no business
// logic. Phase 5b expanded the surface to include keychain-backed auth
// (persist + logout), pomodoro snapshots, and an external-shell hatch
// for the OAuth redirect flow.

import { contextBridge, ipcRenderer } from 'electron';

import {
  eventChannels,
  invokeChannels,
  type AuthSession,
  type HoneAPI,
  type PomodoroSnapshot,
  type TelegramPollResult,
  type TelegramStart,
} from '@shared/ipc';

const api: HoneAPI = {
  app: {
    version: () => ipcRenderer.invoke(invokeChannels.appVersion) as Promise<string>,
  },
  auth: {
    session: () =>
      ipcRenderer.invoke(invokeChannels.authSession) as Promise<AuthSession | null>,
    persist: (s: AuthSession) =>
      ipcRenderer.invoke(invokeChannels.authPersist, s) as Promise<void>,
    logout: () => ipcRenderer.invoke(invokeChannels.authLogout) as Promise<void>,
    tgStart: () =>
      ipcRenderer.invoke(invokeChannels.authTgStart) as Promise<TelegramStart>,
    tgPoll: (code: string) =>
      ipcRenderer.invoke(invokeChannels.authTgPoll, code) as Promise<TelegramPollResult>,
  },
  pomodoro: {
    load: () =>
      ipcRenderer.invoke(invokeChannels.pomodoroLoad) as Promise<PomodoroSnapshot | null>,
    save: (s: PomodoroSnapshot) =>
      ipcRenderer.invoke(invokeChannels.pomodoroSave, s) as Promise<void>,
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(invokeChannels.shellOpenExternal, url) as Promise<void>,
  },
  updater: {
    check: () => ipcRenderer.invoke(invokeChannels.updaterCheck) as Promise<void>,
    install: () => ipcRenderer.invoke(invokeChannels.updaterInstall) as Promise<void>,
  },
  on: (channel, listener) => {
    const wire = eventChannels[channel];
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      listener(payload as never);
    };
    ipcRenderer.on(wire, handler);
    return () => ipcRenderer.off(wire, handler);
  },
};

contextBridge.exposeInMainWorld('hone', api);
