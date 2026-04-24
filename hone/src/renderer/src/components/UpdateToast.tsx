// UpdateToast — минимальный non-intrusive toast в углу.
//
// Отображается когда updaterStatus = { kind: 'downloaded' } — main
// скачал новую версию, ждёт quit+install. Клик по «Restart» вызывает
// window.hone.updater.install(), Electron закрывается и стартует с
// новой версией.
//
// 'checking' / 'available' — тихо, не отвлекаем. 'error' — тоже тихо
// (попробует ещё раз через 4 часа).
import { useEffect, useState } from 'react';

import type { EventPayload } from '../../../shared/ipc';

type Status = EventPayload['updaterStatus'];

export function UpdateToast() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;
    const off = bridge.on('updaterStatus', setStatus);
    return off;
  }, []);

  if (status.kind !== 'downloaded') return null;

  return (
    <div
      className="fadein"
      style={{
        position: 'fixed',
        bottom: 100,
        right: 24,
        zIndex: 90,
        padding: '12px 16px',
        borderRadius: 10,
        background: 'rgba(12,12,12,0.94)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(14px)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12.5,
        color: 'var(--ink)',
        boxShadow: '0 16px 40px -10px rgba(0,0,0,0.7)',
      }}
    >
      <span>
        Hone {status.version} is ready.
      </span>
      <button
        onClick={() => void window.hone.updater.install()}
        className="focus-ring mono"
        style={{
          padding: '5px 11px',
          fontSize: 10,
          letterSpacing: '.14em',
          color: '#000',
          background: '#fff',
          borderRadius: 6,
        }}
      >
        RESTART
      </button>
    </div>
  );
}
