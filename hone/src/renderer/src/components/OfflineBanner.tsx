// OfflineBanner — top-of-screen полоска. Показывается:
//   1. navigator offline → амбер «Offline · sync paused»
//   2. online но pending op'ы в outbox'е (т.е. недавно были offline, сейчас
//      drain'ятся) → синий «Syncing N pending changes»
//
// Когда оба false (online + outbox empty), баннер null.
import { useEffect, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { listPending, subscribe } from '../offline/outbox';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listPending()
        .then((ops) => {
          if (!cancelled) setPendingCount(ops.length);
        })
        .catch(() => {
          /* swallow — outbox IDB может быть недоступна на первом mount'е */
        });
    };
    refresh();
    const unsub = subscribe(refresh);
    // Также refresh'имся когда online flip'ится (drain мог отработать)
    const t = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(t);
    };
  }, []);

  if (!online) {
    return (
      <BannerStrip color="#ffaa55">
        ● Offline · {pendingCount > 0 ? `${pendingCount} change(s) queued` : 'sharing & sync paused'}
      </BannerStrip>
    );
  }
  if (pendingCount > 0) {
    return (
      <BannerStrip color="#7fa8d4">
        ⟳ Syncing {pendingCount} change{pendingCount === 1 ? '' : 's'}…
      </BannerStrip>
    );
  }
  return null;
}

function BannerStrip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div
      className="fadein mono"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '6px 12px',
        textAlign: 'center',
        fontSize: 10.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: '#0f0f10',
        background: color,
        borderBottom: '1px solid rgba(0,0,0,0.15)',
        zIndex: 1000,
        pointerEvents: 'none',
        animationDuration: '180ms',
      }}
    >
      {children}
    </div>
  );
}
