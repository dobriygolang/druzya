// DailyBriefPanel — bottom-left coach card on Home.
//
// Renders a compact 360px×~180px panel that surfaces the morning brief:
//   - headline (top, 15px)
//   - narrative (middle, 13px ink-60)
//   - 3 recommendation chips (bottom, click → action)
//
// Cache: localStorage hone:daily-brief:cache:YYYY-MM-DD avoids re-fetching
// on every page change. Force-refresh button bypasses both caches (sends
// force=true; backend rate-limits 1/h, surfacing as 429).
//
// Phase 2.6 — Offline-first: navigator.onLine is consulted before each
// fetch. If offline and cache exists, we serve the cache without going
// to the network (no visible "errored" state for a known-offline case).
// On online recovery (window 'online' event) we silently refetch in the
// background to bring the cached brief up to date.
//
// Hidden during running focus session — coach must not distract.
import { useCallback, useEffect, useState } from 'react';

import {
  getDailyBrief,
  ackRecommendation,
  getMemoryStats,
  type CoachSeverity,
  type DailyBrief,
  type Recommendation,
} from '../api/intelligence';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

// Phase 4.4 — severity tokens. Stripe paints a 1.5px top border на panel,
// pill = compact badge in header. Cruise (default) hides pill чтобы не
// шуметь на спокойных днях.
//
// B/W + red rule: `critical` is the only severity allowed to wear --red;
// warn/nudge fall back на ink-ramp — ink-60 (warn) and ink-40 (nudge) —
// чтобы избегать chromatic tints (amber/blue) в Hone-палитре.
const SEVERITY_STRIPE: Record<CoachSeverity, string> = {
  critical: 'var(--red)',
  warn: 'var(--ink-60)',
  nudge: 'var(--ink-40)',
  cruise: 'transparent',
};
const SEVERITY_PILL_BG: Record<CoachSeverity, string> = {
  critical: 'var(--surface-2)',
  warn: 'var(--surface-2)',
  nudge: 'var(--surface-2)',
  cruise: 'var(--hair)',
};
const SEVERITY_PILL_FG: Record<CoachSeverity, string> = {
  critical: 'var(--red)',
  warn: 'var(--ink-90)',
  nudge: 'var(--ink-60)',
  cruise: 'var(--ink-60)',
};
const SEVERITY_PILL_BORDER: Record<CoachSeverity, string> = {
  critical: 'var(--red)',
  warn: 'var(--hair-2)',
  nudge: 'var(--hair-2)',
  cruise: 'var(--hair)',
};

const CACHE_PREFIX = 'hone:daily-brief:cache:';

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${CACHE_PREFIX}${y}-${m}-${d}`;
}

function loadCache(): DailyBrief | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(todayKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyBrief & { generatedAt: string | null };
    return {
      ...parsed,
      generatedAt: parsed.generatedAt ? new Date(parsed.generatedAt) : null,
      // Legacy cache rows предшествующие Phase 4.4 не имели severity —
      // дефолтим в cruise чтобы не падал TS-narrowing на UI.
      severity: parsed.severity ?? 'cruise',
      severityReason: parsed.severityReason ?? '',
    };
  } catch {
    return null;
  }
}

function saveCache(brief: DailyBrief): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(todayKey(), JSON.stringify(brief));
  } catch {
    /* quota exceeded — silent */
  }
}

export interface DailyBriefPanelProps {
  /** When called with a recommendation, the parent acts on it. */
  onAct: (rec: Recommendation) => void;
}

export function DailyBriefPanel({ onAct }: DailyBriefPanelProps) {
  const [brief, setBrief] = useState<DailyBrief | null>(() => loadCache());
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Per-recommendation feedback state — индексы которые юзер уже ack'нул
  // (followed | dismissed). Локальное; перерисовка панели на refresh
  // сбрасывает (новый brief — новый набор индексов).
  const [acked, setAcked] = useState<Record<number, 'follow' | 'dismiss'>>({});
  // Memory stats trust indicator («COACH KNOWS [N] EVENTS»).
  const [memStats, setMemStats] = useState<number | null>(null);
  const online = useOnlineStatus();

  useEffect(() => {
    if (!online) return; // memory stats are advisory; skip when offline
    void getMemoryStats()
      .then((s) => setMemStats(s.total30d))
      .catch(() => setMemStats(0)); // нулевая статистика → «LEARNING…»
  }, [online]);

  // Trigger slide-in animation after a delay so canvas settles first.
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  const load = useCallback(async (force = false) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // No network — never paint an error state when we already have
      // cached evidence. Force is moot: server enforces 1/h, and the
      // request would 0-out anyway. Returning the cached brief silently
      // is correct: the OfflineBanner up top tells the user they're
      // offline, no need to repeat it inside the panel.
      return;
    }
    setLoading(true);
    setErrored(false);
    try {
      const fresh = await getDailyBrief(force);
      setBrief(fresh);
      saveCache(fresh);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // First fetch on mount when no cache.
  useEffect(() => {
    if (brief) return;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 2.6 — when online flips back on, silently refetch to refresh
  // the cached brief. No explicit "Refreshed!" toast: the panel just
  // updates in place when the new payload arrives.
  useEffect(() => {
    if (!online) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const refresh = useCallback(() => {
    setAcked({}); // новый brief → fresh feedback state
    void load(true);
  }, [load]);

  const handleAck = useCallback(
    async (index: number, followed: boolean) => {
      if (!brief?.briefId) return;
      setAcked((prev) => ({ ...prev, [index]: followed ? 'follow' : 'dismiss' }));
      try {
        await ackRecommendation(brief.briefId, index, followed);
      } catch {
        /* silent — UI уже отметил, fallback не нужен */
      }
    },
    [brief?.briefId],
  );

  const severity: CoachSeverity = brief?.severity ?? 'cruise';
  const stripeColor = SEVERITY_STRIPE[severity];

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 24,
        width: 360,
        minHeight: 140,
        padding: '14px 16px 12px',
        borderRadius: 14,
        background: 'var(--surface)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--hair)',
        borderTop:
          severity === 'cruise'
            ? '1px solid var(--hair)'
            : `1.5px solid ${stripeColor}`,
        boxShadow: '0 6px 28px var(--bg)',
        color: 'var(--ink-90)',
        fontFamily: 'ui-sans-serif, -apple-system, system-ui, sans-serif',
        zIndex: 4,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-24px)',
        transition: 'opacity var(--motion-dur-large) var(--motion-ease-standard), transform var(--motion-dur-large) var(--motion-ease-standard)',
        pointerEvents: 'auto',
      }}
    >
      {/* Trust indicator + severity pill (Phase 4.4) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div
          className="mono"
          style={{
            flex: 1,
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--ink-40)',
            textTransform: 'uppercase',
          }}
        >
          {memStats === null
            ? 'COACH'
            : memStats === 0
              ? 'COACH · LEARNING ABOUT YOU…'
              : `COACH · KNOWS ${memStats} EVENTS`}
        </div>
        {brief && severity !== 'cruise' && (
          <span
            className="mono"
            title={brief.severityReason || severity}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: SEVERITY_PILL_BG[severity],
              color: SEVERITY_PILL_FG[severity],
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: `1px solid ${SEVERITY_PILL_BORDER[severity]}`,
            }}
          >
            {severity}
          </span>
        )}
      </div>

      {/* Top row: headline + refresh */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>
          {loading && !brief
            ? <BreathingDots />
            : errored
            ? <span style={{ color: 'var(--ink-40)' }}>Coach is offline</span>
            : brief?.headline ?? '—'}
        </div>
        <button
          aria-label="Refresh brief"
          onClick={refresh}
          disabled={loading}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: loading ? 'default' : 'pointer',
            color: 'var(--ink-60)',
            fontSize: 14,
            padding: 4,
            borderRadius: 6,
            display: 'inline-flex',
            transform: loading ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--motion-dur-xlarge) var(--motion-ease-standard)',
          }}
          title="Force refresh (limited 1/h)"
        >
          ↻
        </button>
      </div>

      {/* CI1: explicit retry affordance when fetch failed (not just the
       * ambiguous «↻» icon — Sergey 2026-05-12). Hidden когда есть cached
       * brief — там headline уже что-то полезное показывает; кнопка только
       * для cold-start failure. */}
      {errored && !brief && !loading && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="data-loader-error-retry focus-ring motion-press"
            onClick={refresh}
            style={{ padding: 0 }}
          >
            retry
          </button>
        </div>
      )}

      {/* Narrative */}
      {brief?.narrative ? (
        <p
          style={{
            margin: '8px 0 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--ink-60)',
          }}
        >
          {brief.narrative}
        </p>
      ) : (
        <div style={{ height: 28 }} />
      )}

      {/* Recommendation chips */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {brief?.recommendations?.map((r, i) => (
          <RecChip
            key={i}
            rec={r}
            ack={acked[i]}
            onClick={() => {
              onAct(r);
              // Click на сам chip — implicit «follow» (юзер выполняет совет).
              if (!acked[i]) void handleAck(i, true);
            }}
            onFollow={() => void handleAck(i, true)}
            onDismiss={() => void handleAck(i, false)}
          />
        )) ?? null}
      </div>
    </div>
  );
}

function RecChip({
  rec,
  ack,
  onClick,
  onFollow,
  onDismiss,
}: {
  rec: Recommendation;
  ack?: 'follow' | 'dismiss';
  onClick: () => void;
  onFollow: () => void;
  onDismiss: () => void;
}) {
  const isAdvice = rec.kind === 'schedule';
  const dimmed = ack === 'dismiss';
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: ack === 'follow' ? 'var(--hair)' : 'var(--surface-2)',
        border: '1px solid var(--hair)',
        borderRadius: 8,
        opacity: dimmed ? 0.4 : 1,
        textDecoration: dimmed ? 'line-through' : 'none',
        transition: 'opacity var(--motion-dur-medium) var(--motion-ease-standard), background-color var(--motion-dur-medium) var(--motion-ease-standard)',
        overflow: 'hidden',
      }}
    >
      {ack === 'follow' && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 1.5,
            background: 'var(--red)',
          }}
        />
      )}
      <button
        onClick={isAdvice ? undefined : onClick}
        title={rec.rationale}
        style={{
          flex: 1,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '7px 10px',
          color: 'var(--ink-90)',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.35,
          cursor: isAdvice ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ opacity: 0.5, fontSize: 11, minWidth: 14 }}>{kindGlyph(rec.kind)}</span>
        <span style={{ flex: 1 }}>{rec.title}</span>
      </button>
      {!ack && (
        <div style={{ display: 'flex', gap: 1, paddingRight: 4 }}>
          <FeedbackBtn glyph="check" onClick={onFollow} title="Helpful — coach learns" />
          <FeedbackBtn glyph="x" onClick={onDismiss} title="Not for me — coach learns" />
        </div>
      )}
    </div>
  );
}

function FeedbackBtn({
  glyph,
  onClick,
  title,
}: {
  glyph: 'check' | 'x';
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="focus-ring"
      style={{
        width: 20,
        height: 20,
        display: 'grid',
        placeItems: 'center',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        opacity: 0.4,
        borderRadius: 4,
        transition: 'opacity var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
        color: 'var(--ink-90)',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
        e.currentTarget.style.background = 'var(--hair)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '0.4';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {glyph === 'check' ? (
          // Тот же check-stroke как в Icon primitive (M5 13l4 4L19 7).
          // strokeWidth 1.6 — между обычным Icon (1.4) и acк-action (2),
          // достаточно «солидно» чтобы читалось 11×11 px.
          <path d="M5 13l4 4L19 7" />
        ) : (
          <path d="M6 6l12 12M18 6L6 18" />
        )}
      </svg>
    </button>
  );
}

function kindGlyph(kind: Recommendation['kind']): string {
  switch (kind) {
    case 'tiny_task':
      return '▶';
    case 'review_note':
      return '✎';
    case 'unblock':
      return '◐';
    case 'schedule':
      return '◷';
    default:
      return '·';
  }
}

function BreathingDots() {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 4,
        color: 'var(--ink-40)',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 14,
      }}
    >
      <Dot delay={0} />
      <Dot delay={180} />
      <Dot delay={360} />
    </span>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: 'currentColor',
        animation: `briefDot 1.2s ease-in-out ${delay}ms infinite`,
      }}
    />
  );
}

// Inject keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('hone-brief-kf')) {
  const style = document.createElement('style');
  style.id = 'hone-brief-kf';
  style.textContent = `@keyframes briefDot { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`;
  document.head.appendChild(style);
}
