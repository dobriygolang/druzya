/// <reference types="vite/client" />

import type { HoneAPI } from '@shared/ipc';

// The preload script mounts the typed API at window.hone via contextBridge.
// Declaring it here keeps renderer code free of `any` casts without having
// to import the IPC types at every use site.
declare global {
  interface Window {
    hone: HoneAPI;
  }
}

export {};
