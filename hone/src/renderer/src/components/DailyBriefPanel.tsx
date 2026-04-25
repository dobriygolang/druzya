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
// Hidden during running focus session — coach must not distract.
import { useCallback, useEffect, useState } from 'react';

import { getDailyBrief, type DailyBrief, type Recommendation } from '../api/intelligence';

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

  // Trigger slide-in animation after a delay so canvas settles first.
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  const load = useCallback(async (force = false) => {
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

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

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
        background: 'rgba(20, 20, 22, 0.78)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 6px 28px rgba(0,0,0,0.35)',
        color: 'rgba(255,255,255,0.92)',
        fontFamily: 'ui-sans-serif, -apple-system, system-ui, sans-serif',
        zIndex: 4,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-24px)',
        transition: 'opacity 380ms ease, transform 380ms ease',
        pointerEvents: 'auto',
      }}
    >
      {/* Top row: headline + refresh */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>
          {loading && !brief
            ? <BreathingDots />
            : errored
            ? <span style={{ color: 'rgba(255,255,255,0.5)' }}>Coach is offline</span>
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
            color: 'rgba(255,255,255,0.55)',
            fontSize: 14,
            padding: 4,
            borderRadius: 6,
            display: 'inline-flex',
            transform: loading ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 600ms ease',
          }}
          title="Force refresh (limited 1/h)"
        >
          ↻
        </button>
      </div>

      {/* Narrative */}
      {brief?.narrative ? (
        <p
          style={{
            margin: '8px 0 12px',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.6)',
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
          <RecChip key={i} rec={r} onClick={() => onAct(r)} />
        )) ?? null}
      </div>
    </div>
  );
}

function RecChip({ rec, onClick }: { rec: Recommendation; onClick: () => void }) {
  const isAdvice = rec.kind === 'schedule';
  return (
    <button
      onClick={isAdvice ? undefined : onClick}
      title={rec.rationale}
      style={{
        textAlign: 'left',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        padding: '7px 10px',
        color: 'rgba(255,255,255,0.85)',
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
        color: 'rgba(255,255,255,0.5)',
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
