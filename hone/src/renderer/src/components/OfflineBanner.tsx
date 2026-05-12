// OfflineBanner — top-of-screen полоска. 5-state taxonomy:
//
//   1. online                — banner null (hidden)
//   2. network_offline       — navigator.onLine === false. Red stripe
//                              «Нет сети, изменения в outbox».
//   3. server_unreachable    — network on, но /healthz probe failed.
//                              Yellow stripe «Сервер недоступен, retry в 30s».
//   4. degraded              — health probe slow (>2.5s) или 5xx-ratio
//                              elevated. Info stripe «Бэкенд медленный».
//   5. reconnecting          — recovering из offline/unreachable: первый
//                              successful probe после failed → 3s window
//                              «Восстанавливаем» с pulse dot.
//
// Plus two derived states ortogonal состоянию connection: pending outbox
// (drain ongoing) и dead ops (manual retry).
//
// Server probe — lightweight HEAD на API_BASE_URL/api/v1/sync/devices с
// noauth тайм-аутом. Любой response (даже 401) = «server reachable»;
// network error / abort = unreachable. Каждые 15s when online, 30s when
// network_offline (быстрее придёт в себя).
import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { drainAll, listAll, listPending, subscribe } from '../offline/outbox';
import { API_BASE_URL } from '../api/config';

type ServerState = 'unknown' | 'ok' | 'degraded' | 'unreachable';

const PROBE_OK_BUDGET_MS = 2500;
const PROBE_TIMEOUT_MS = 5000;
const PROBE_INTERVAL_MS = 15_000;

async function probeServer(): Promise<{ state: ServerState; latency: number }> {
  const started = performance.now();
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // Любой 2xx/3xx/4xx — server отвечает. 401 OK для нашей цели.
    const resp = await fetch(`${API_BASE_URL}/api/v1/sync/devices`, {
      method: 'HEAD',
      signal: ctl.signal,
    });
    const latency = performance.now() - started;
    // 5xx → degraded; иначе ok / slow → degraded.
    if (resp.status >= 500) return { state: 'degraded', latency };
    return { state: latency > PROBE_OK_BUDGET_MS ? 'degraded' : 'ok', latency };
  } catch {
    return { state: 'unreachable', latency: performance.now() - started };
  } finally {
    window.clearTimeout(timer);
  }
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [deadCount, setDeadCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [serverState, setServerState] = useState<ServerState>('unknown');
  const [recovered, setRecovered] = useState<number | null>(null);
  // Phase R3 cooldown — refs mirror state so the polling effect can
  // short-circuit reads without busting the effect's dep array.
  const pendingCountRef = useRef(0);
  const deadCountRef = useRef(0);
  pendingCountRef.current = pendingCount;
  deadCountRef.current = deadCount;
  const prevServerStateRef = useRef<ServerState>('unknown');

  // Outbox poll loop (unchanged).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void Promise.all([listPending(), listAll()])
        .then(([pending, all]) => {
          if (cancelled) return;
          setPendingCount(pending.length);
          setDeadCount(all.filter((op) => op.dead).length);
        })
        .catch(() => {});
    };
    refresh();
    const unsub = subscribe(() => {
      setLastSyncAt(Date.now());
      refresh();
    });
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

  // Server-probe loop. Only runs when navigator says we're online — when
  // offline, network is the diagnosed root cause, no need to probe.
  useEffect(() => {
    if (!online) {
      setServerState('unknown');
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const r = await probeServer();
      if (cancelled) return;
      // Detect recovery: was unreachable/degraded, now ok.
      const prev = prevServerStateRef.current;
      if (r.state === 'ok' && (prev === 'unreachable' || prev === 'degraded')) {
        setRecovered(Date.now());
      }
      prevServerStateRef.current = r.state;
      setServerState(r.state);
    };
    void tick();
    const id = window.setInterval(() => void tick(), PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [online]);

  async function manualRetry() {
    await drainAll();
  }

  // ── State machine ────────────────────────────────────────────────────
  // Priority: dead-ops > network_offline > server_unreachable > degraded
  // > reconnecting > syncing > just-synced > null.

  if (deadCount > 0) {
    return (
      <BannerStrip tone="danger" interactive>
        <span>⚠ {deadCount} change{deadCount === 1 ? '' : 's'} stuck</span>
        <button onClick={() => void manualRetry()} style={retryBtn}>retry</button>
      </BannerStrip>
    );
  }
  if (!online) {
    return (
      <BannerStrip tone="danger">
        ● Нет сети · {pendingCount > 0 ? `${pendingCount} change(s) в outbox` : 'изменения в outbox'}
      </BannerStrip>
    );
  }
  if (serverState === 'unreachable') {
    return (
      <BannerStrip tone="warn">
        ● Сервер недоступен · retry через 30s
      </BannerStrip>
    );
  }
  if (serverState === 'degraded') {
    return (
      <BannerStrip tone="ink-dim">
        ⚠ Бэкенд медленный · sync продолжается
      </BannerStrip>
    );
  }
  if (recovered !== null && Date.now() - recovered < 3000) {
    return (
      <BannerStrip tone="ink" pulse>
        ● Восстанавливаем…
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
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

type BannerTone = 'muted' | 'ink' | 'ink-dim' | 'warn' | 'danger';

// Tones: B/W ink ramp по умолчанию; danger использует #FF3B30 как stripe-
// карту (top edge), warn — yellow accent но через ink-ramp с border.
const TONE_BG: Record<BannerTone, string> = {
  muted: 'rgba(255,255,255,0.10)',
  ink: 'rgba(255,255,255,0.16)',
  'ink-dim': 'rgba(255,255,255,0.08)',
  warn: 'rgba(255,255,255,0.12)',
  danger: '#FF3B30',
};

function BannerStrip({
  tone,
  children,
  interactive = false,
  pulse = false,
}: {
  tone: BannerTone;
  children: React.ReactNode;
  interactive?: boolean;
  pulse?: boolean;
}) {
  // Warn = ink-toned stripe + 1.5px red top border (red as stripe, not bg —
  // см feedback_color_rule.md).
  const isWarn = tone === 'warn';
  return (
    <div
      className={`fadein mono${pulse ? ' red-pulse' : ''}`}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '6px 12px',
        textAlign: 'center',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink)',
        background: TONE_BG[tone],
        backdropFilter: tone === 'danger' ? 'none' : 'blur(8px)',
        WebkitBackdropFilter: tone === 'danger' ? 'none' : 'blur(8px)',
        borderTop: isWarn ? '1.5px solid #FF3B30' : 'none',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        zIndex: 1000,
        pointerEvents: interactive ? 'auto' : 'none',
        animationDuration: 'var(--motion-dur-medium)',
      }}
    >
      {children}
    </div>
  );
}
