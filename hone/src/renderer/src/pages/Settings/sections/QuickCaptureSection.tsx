// QuickCaptureSection — Phase K Wave 15 (Quick Capture global hotkey).
//
// Renders a single toggle: «Включить глобальный захват (⌘⇧Space)». Reads /
// writes the flag via main-process IPC (it owns the on-disk file under
// userData/quick_capture.json, since main is what registers the hotkey
// before any renderer is loaded).
//
// We avoid persisting through localStorage here because the renderer
// is not guaranteed to be loaded when the shortcut needs to be active
// (cold-launch: app.whenReady → globalShortcut.register → main window
// follows). Disk-backed state is the single source of truth.
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    honeQuickCapture?: {
      save: (text: string) => Promise<{ ok: boolean; error?: string }>;
      dismiss: () => Promise<void>;
      getEnabled: () => Promise<boolean>;
      setEnabled: (enabled: boolean) => Promise<void>;
    };
  }
}

export function QuickCaptureSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.honeQuickCapture : undefined;
    if (!bridge) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    void bridge.getEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async () => {
    const bridge = typeof window !== 'undefined' ? window.honeQuickCapture : undefined;
    if (!bridge || enabled === null) return;
    const next = !enabled;
    setPending(true);
    try {
      await bridge.setEnabled(next);
      setEnabled(next);
    } finally {
      setPending(false);
    }
  };

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
        Глобальная горячая клавиша{' '}
        <span className="mono" style={{ color: 'var(--ink-90)' }}>
          ⌘⇧Space
        </span>{' '}
        в любом приложении — выскакивает строка ввода поверх всех окон. Мысль
        падает в папку «Inbox» как заметка с тегом{' '}
        <span className="mono" style={{ color: 'var(--ink-90)' }}>
          #inbox
        </span>
        .
      </p>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: enabled === null || pending ? 'default' : 'pointer',
          fontSize: 13,
          color: 'var(--ink-90)',
        }}
      >
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === null || pending}
          onChange={() => void handleToggle()}
          style={{ width: 16, height: 16, accentColor: '#ffffff' }}
        />
        Включить глобальный захват (⌘⇧Space)
      </label>
    </div>
  );
}
