// Preload — runs in a privileged context with partial Node access and
// exposes a narrow, typed API to the renderer via contextBridge.
//
// Rule matches desktop/: every method here is a thin ipcRenderer wrapper,
// no business logic. Keeping this file small on purpose; Hone's MVP does
// not need the large capture/auth/masquerade surface the stealth app has.

import { contextBridge, ipcRenderer } from 'electron';

import { eventChannels, invokeChannels, type HoneAPI } from '@shared/ipc';

const api: HoneAPI = {
  app: {
    version: () => ipcRenderer.invoke(invokeChannels.appVersion) as Promise<string>,
  },
  auth: {
    session: () =>
      ipcRenderer.invoke(invokeChannels.authSession) as ReturnType<HoneAPI['auth']['session']>,
    logout: () => ipcRenderer.invoke(invokeChannels.authLogout) as Promise<void>,
  },
  on: (channel, listener) => {
    // The channel key in eventChannels is the logical name; the wire
    // string is the object value. The renderer never sees the wire
    // string, which keeps us free to rename without a breaking change
    // on consumers.
    const wire = eventChannels[channel];
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      // Payload shape is enforced by the EventPayload map on the typed
      // API side; we don't re-validate here. If the main process sends
      // something wrong the renderer will throw, which is the correct
      // development signal.
      listener(payload as never);
    };
    ipcRenderer.on(wire, handler);
    return () => ipcRenderer.off(wire, handler);
  },
};

contextBridge.exposeInMainWorld('hone', api);
