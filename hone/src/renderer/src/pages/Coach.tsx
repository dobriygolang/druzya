// Coach — Phase 5 read-only feed страницы past briefs.
//
// Layout: вертикальная лента карточек, newest first. Каждая карточка
// показывает дату, severity-stripe, headline, narrative и compact
// recommendations row. Открывается через palette → Coach (C).
//
// Read-only: ack happens на DailyBriefPanel в Today (live brief). Здесь
// только historical view, чтобы юзер видел свою дугу.

import { useCallback, useEffect, useState } from 'react';

import {
  listRecentBriefs,
  type CoachSeverity,
  type RecentBrief,
} from '../api/intelligence';

interface State {
  status: 'loading' | 'ok' | 'error';
  items: RecentBrief[];
  error: string | null;
}

const INITIAL: State = { status: 'loading', items: [], error: null };

const STRIPE: Record<CoachSeverity, string> = {
  critical: 'rgb(239, 68, 68)',
  warn: 'rgb(245, 158, 11)',
  nudge: 'rgb(59, 130, 246)',
  cruise: 'transparent',
};

const PILL_BG: Record<CoachSeverity, string> = {
  critical: 'rgba(239, 68, 68, 0.16)',
  warn: 'rgba(245, 158, 11, 0.16)',
  nudge: 'rgba(59, 130, 246, 0.16)',
  cruise: 'rgba(255,255,255,0.04)',
};

const PILL_FG: Record<CoachSeverity, string> = {
  critical: 'rgb(248, 113, 113)',
  warn: 'rgb(251, 191, 36)',
  nudge: 'rgb(96, 165, 250)',
  cruise: 'rgba(255,255,255,0.5)',
};

function formatDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function CoachPage() {
  const [state, setState] = useState<State>(INITIAL);
  const [days, setDays] = useState(30);

  const load = useCallback(async (n: number) => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const items = await listRecentBriefs(n);
      setState({ status: 'ok', items, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', items: [], error: msg });
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: '320ms',
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 720, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.24em',
              color: 'var(--ink-40)',
              marginBottom: 4,
            }}
          >
            COACH FEED · LAST {days}D
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--ink)',
            }}
          >
            Coach
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 13,
              color: 'var(--ink-60)',
            }}
          >
            Архив утренних брифов. Видимо как менялся фокус и каких
            recommendations было больше.
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            {[7, 14, 30, 60].map((n) => (
              <button
                key={n}
                type="button"
                className="mono"
                onClick={() => setDays(n)}
                style={{
                  background: days === n ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: days === n ? 'var(--ink)' : 'var(--ink-60)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {n}d
              </button>
            ))}
          </div>
        </header>

        {state.status === 'loading' && (
          <p style={{ color: 'var(--ink-40)', fontSize: 13 }}>Loading feed…</p>
        )}
        {state.status === 'error' && (
          <p style={{ color: 'var(--ink-60)', fontSize: 13 }}>
            Не удалось загрузить feed: {state.error}
          </p>
        )}
        {state.status === 'ok' && state.items.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-60)' }}>
              Ещё нет брифов за это окно
            </p>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 12,
                color: 'var(--ink-40)',
              }}
            >
              Открой Today — сегодняшний brief сам появится в шторке.
            </p>
          </div>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.items.map((b) => (
              <li key={b.briefId || (b.generatedAt?.toISOString() ?? '') + b.headline}>
                <BriefCard brief={b} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BriefCard({ brief }: { brief: RecentBrief }) {
  const stripe = STRIPE[brief.severity];
  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderTop:
          brief.severity === 'cruise'
            ? '1px solid rgba(255,255,255,0.06)'
            : `3px solid ${stripe}`,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            color: 'var(--ink-40)',
            textTransform: 'uppercase',
          }}
        >
          {formatDate(brief.generatedAt)}
        </span>
        {brief.severity !== 'cruise' && (
          <span
            className="mono"
            title={brief.severityReason || brief.severity}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: PILL_BG[brief.severity],
              color: PILL_FG[brief.severity],
              fontSize: 9,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              border: `1px solid ${PILL_FG[brief.severity]}33`,
            }}
          >
            {brief.severity}
          </span>
        )}
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1.35,
          color: 'var(--ink)',
        }}
      >
        {brief.headline || '—'}
      </h2>
      {brief.narrative && (
        <p
          style={{
            margin: '8px 0 12px',
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--ink-60)',
          }}
        >
          {brief.narrative}
        </p>
      )}
      {brief.recommendations.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {brief.recommendations.map((r, i) => (
            <li
              key={i}
              className="mono"
              style={{
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.4,
                color: 'var(--ink-80)',
              }}
              title={r.rationale}
            >
              <span style={{ opacity: 0.5, marginRight: 8 }}>{kindGlyph(r.kind)}</span>
              {r.title}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function kindGlyph(kind: string): string {
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
