// DayShutdownSection — Phase K Wave 15 (End-of-day shutdown ritual).
//
// Two controls:
//   1. Toggle «Включить вечерний ритуал» — enables/disables the local
//      notification timer in main process.
//   2. Time picker (HH:MM, local TZ) — when to fire the notification.
//
// State is stored on disk by the main-process scheduler module
// (userData/day_shutdown.json) for the same reason as Quick Capture:
// main owns the timer, so main owns the truth.
import { useEffect, useState } from 'react';

import { useT } from '@d9-i18n';

// IPC channel names hard-coded here to avoid polluting @shared/ipc with
// settings that only one section reads. Main-side mirror lives in
// day_shutdown_scheduler.ts → DAY_SHUTDOWN_IPC.
const IPC_GET = 'day-shutdown:get-settings';
const IPC_SET = 'day-shutdown:set-settings';

interface DayShutdownSettings {
  enabled: boolean;
  time: string; // HH:MM
}

// Renderer-side IPC bridge accessor (electron preload exposes `ipcRenderer`
// only when contextIsolation is disabled — which it isn't here). We use
// the proxy installed on window.hone above for the typed bridge, but for
// this narrow case we'd want a small dedicated proxy. Falling back to a
// tiny untyped invoke through Electron's contextBridge-exposed
// `electron.ipcRenderer` пuс... actually let's reuse the existing
// `window.hone.on` mechanism + a small fetch-style proxy.
//
// Simpler approach: we add the channels to invokeChannels (shared/ipc)
// later. For now keep settings inline through a fetch-style proxy that
// uses the underlying contextBridge call. We re-use the existing
// `window.hone` since both IPC names are namespaced.

// Lightweight typed wrapper around the Electron `invoke` channel exposed
// for these settings. Implementation note: we register handlers via
// `ipcMain.handle` on the main side, so the renderer needs access to
// `ipcRenderer.invoke`. Hone's contextBridge doesn't expose it generically,
// so we piggyback on the (sandbox-friendly) electron-only `__honeInvoke`
// fallback if available; otherwise null which short-circuits the section
// into a read-only «недоступно» state.

interface DayShutdownBridge {
  get: () => Promise<DayShutdownSettings>;
  set: (s: DayShutdownSettings) => Promise<void>;
}

function getBridge(): DayShutdownBridge | null {
  // ipcRenderer is not exposed by default — we route through
  // window.__honeIPC which the preload patches in alongside the other
  // bridges. If absent (older preload), the section turns into a
  // read-only informational block.
  const ipc = (window as unknown as {
    __honeIPC?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
  }).__honeIPC;
  if (!ipc) return null;
  return {
    get: () => ipc.invoke(IPC_GET) as Promise<DayShutdownSettings>,
    set: (s) => ipc.invoke(IPC_SET, s) as Promise<void>,
  };
}

const DEFAULT_TIME = '21:00';

export function DayShutdownSection() {
  const t = useT();
  const bridge = getBridge();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [time, setTime] = useState<string>(DEFAULT_TIME);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    if (!bridge) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void bridge.get().then((s) => {
      if (cancelled) return;
      setEnabled(s.enabled);
      setTime(s.time || DEFAULT_TIME);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Persist on changes (debounced through React's batching naturally).
  useEffect(() => {
    if (!bridge || !loaded) return;
    void bridge.set({ enabled, time });
  }, [bridge, loaded, enabled, time]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--ink-60)',
          maxWidth: 580,
        }}
      >
        {t('hone.day_shutdown.lead')}
      </p>
      {!bridge && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-40)',
            letterSpacing: '0.04em',
            padding: '6px 10px',
            border: '1px solid var(--ink-10)',
            borderRadius: 6,
          }}
        >
          {t('hone.day_shutdown.note_desktop_only')}
        </div>
      )}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
          color: 'var(--ink-90)',
          cursor: bridge ? 'pointer' : 'default',
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={!bridge}
          style={{ width: 16, height: 16, accentColor: '#ffffff' }}
        />
        {t('hone.day_shutdown.toggle_label')}
      </label>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
          color: 'var(--ink-90)',
          opacity: enabled && bridge ? 1 : 0.5,
        }}
      >
        {t('hone.day_shutdown.time_label')}
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          disabled={!enabled || !bridge}
          className="focus-ring"
          style={{
            padding: '6px 10px',
            fontSize: 13,
            background: 'transparent',
            border: '1px solid var(--ink-10)',
            borderRadius: 6,
            color: 'var(--ink-90)',
            fontFamily: 'inherit',
          }}
        />
      </label>
    </div>
  );
}
