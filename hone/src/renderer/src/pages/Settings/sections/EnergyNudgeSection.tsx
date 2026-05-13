// EnergyNudgeSection — Phase K Wave 16 (soft energy-check nudge).
//
// Two controls:
//   1. Toggle «Спрашивать про энергию» — enables/disables the polling
//      scheduler в main процессе.
//   2. Interval selector (1..6 hours, default 3) — каждые N часов после
//      последнего log'а Hone шлёт тихую нотификацию.
//
// State stored on disk by main-process scheduler module
// (userData/energy_nudge.json). Same IPC-bridge pattern as DayShutdownSection.
// Quiet hours (00-08) — hardcoded в main, не настраиваются (MVP).
import { useEffect, useState } from 'react';

// IPC channel names — main-side mirror в energy_nudge.ts → ENERGY_NUDGE_IPC.
const IPC_GET = 'energy-nudge:get-settings';
const IPC_SET = 'energy-nudge:set-settings';

interface EnergyNudgeSettings {
  enabled: boolean;
  intervalHours: number;
}

interface EnergyNudgeBridge {
  get: () => Promise<EnergyNudgeSettings>;
  set: (s: EnergyNudgeSettings) => Promise<void>;
}

function getBridge(): EnergyNudgeBridge | null {
  const ipc = (window as unknown as {
    __honeIPC?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
  }).__honeIPC;
  if (!ipc) return null;
  return {
    get: () => ipc.invoke(IPC_GET) as Promise<EnergyNudgeSettings>,
    set: (s) => ipc.invoke(IPC_SET, s) as Promise<void>,
  };
}

const DEFAULT_INTERVAL = 3;
const INTERVAL_OPTIONS = [1, 2, 3, 4, 6] as const;

export function EnergyNudgeSection() {
  const bridge = getBridge();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [intervalHours, setIntervalHours] = useState<number>(DEFAULT_INTERVAL);
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
      setIntervalHours(
        INTERVAL_OPTIONS.includes(s.intervalHours as (typeof INTERVAL_OPTIONS)[number])
          ? s.intervalHours
          : DEFAULT_INTERVAL,
      );
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Persist on changes. React's batching де-facto debouncer'ит несколько
  // setState'ов в один setSettings; для toggle / select этого хватает.
  useEffect(() => {
    if (!bridge || !loaded) return;
    void bridge.set({ enabled, intervalHours });
  }, [bridge, loaded, enabled, intervalHours]);

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
        Hone тихо предложит логнуть энергию (1–5), если последний log
        старше выбранного интервала. Тишина в окне 00:00–08:00.
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
          ⓘ Доступно только в desktop-сборке Hone (требуется обновление preload).
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
        Спрашивать про энергию
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
        Каждые:
        <select
          value={intervalHours}
          onChange={(e) => setIntervalHours(Number(e.target.value))}
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
        >
          {INTERVAL_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h} {h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
