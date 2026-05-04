// OfflineBanner — top-of-screen полоска. Показывается:
//   1. navigator offline → амбер «Offline · sync paused»
//   2. online но pending op'ы в outbox'е (т.е. недавно были offline, сейчас
//      drain'ятся) → синий «Syncing N pending changes»
//
// Когда оба false (online + outbox empty), баннер null.
import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { drainAll, listAll, listPending, subscribe } from '../offline/outbox';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [deadCount, setDeadCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  // Phase R3 cooldown — refs mirror state so the polling effect can
  // short-circuit reads without busting the effect's dep array. Without
  // these we'd either re-create the interval/subscription on every count
  // change (effect dep churn) or skip-condition would always read the
  // stale closure values from mount.
  const pendingCountRef = useRef(0);
  const deadCountRef = useRef(0);
  pendingCountRef.current = pendingCount;
  deadCountRef.current = deadCount;

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void Promise.all([listPending(), listAll()])
        .then(([pending, all]) => {
          if (cancelled) return;
          setPendingCount(pending.length);
          setDeadCount(all.filter((op) => op.dead).length);
        })
        .catch(() => {
          /* swallow — outbox IDB может быть недоступна на первом mount'е */
        });
    };
    refresh();
    const unsub = subscribe(() => {
      // subscribe fires при successful drain → bump lastSync
      setLastSyncAt(Date.now());
      refresh();
    });
    // Phase R3 cooldown — was a flat 5s IDB scan regardless of state. The
    // outbox is event-driven via subscribe() above, so when we're online
    // with nothing queued and no dead ops, the periodic re-scan is pure
    // heat — `subscribe` already wakes us up the moment anything enqueues.
    // We still tick during a drain so the count updates smoothly.
    const t = window.setInterval(() => {
      const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
      if (isOnline && pendingCountRef.current === 0 && deadCountRef.current === 0) return;
      refresh();
    }, 5000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(t);
    };
  }, []);

  // Phase 11b — manual retry для dead ops. Stuck-ops через 5 attempts
  // помечаются dead — без button они никогда не drain'ятся снова.
  async function manualRetry() {
    await drainAll();
  }

  // B/W rule: только `dead` (оператор должен дёрнуться) держит #FF3B30,
  // остальное — ink-ramp на чёрном. Severity передаётся текстом + opacity.
  if (!online) {
    return (
      <BannerStrip tone="muted">
        ● Offline · {pendingCount > 0 ? `${pendingCount} change(s) queued` : 'sharing & sync paused'}
      </BannerStrip>
    );
  }
  if (deadCount > 0) {
    return (
      <BannerStrip tone="danger" interactive>
        <span>⚠ {deadCount} change{deadCount === 1 ? '' : 's'} stuck</span>
        <button onClick={() => void manualRetry()} style={retryBtn}>retry</button>
      </BannerStrip>
    );
  }
  if (pendingCount > 0) {
    return (
      <BannerStrip tone="ink">
        ⟳ Syncing {pendingCount} change{pendingCount === 1 ? '' : 's'}…
      </BannerStrip>
    );
  }
  if (lastSyncAt !== null && Date.now() - lastSyncAt < 3000) {
    return (
      <BannerStrip tone="ink-dim">
        ✓ Synced
      </BannerStrip>
    );
  }
  return null;
}

const retryBtn: React.CSSProperties = {
  marginLeft: 10,
  padding: '2px 10px',
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.30)',
  color: '#FFFFFF',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'inherit',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

type BannerTone = 'muted' | 'ink' | 'ink-dim' | 'danger';

const TONE_BG: Record<BannerTone, string> = {
  muted: 'rgba(255,255,255,0.10)',
  ink: 'rgba(255,255,255,0.16)',
  'ink-dim': 'rgba(255,255,255,0.08)',
  danger: '#FF3B30',
};

function BannerStrip({
  tone,
  children,
  interactive = false,
}: {
  tone: BannerTone;
  children: React.ReactNode;
  interactive?: boolean;
}) {
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
        color: '#FFFFFF',
        background: TONE_BG[tone],
        backdropFilter: tone === 'danger' ? 'none' : 'blur(8px)',
        WebkitBackdropFilter: tone === 'danger' ? 'none' : 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        zIndex: 1000,
        pointerEvents: interactive ? 'auto' : 'none',
        animationDuration: '180ms',
      }}
    >
      {children}
    </div>
  );
}
