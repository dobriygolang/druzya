// StatsOverlay — Stats как floating widgets поверх HomePage, не отдельная
// страница. Heatmap-карточка въезжает слева, Streak + Bars — справа,
// staggered (80 ms между карточками) для плавного «расцветания».
//
// Закрывается тем же хоткеем S или Esc. Click-outside не закрывает —
// карточки могут перекрываться с timer'ом, юзер кликает мимо.
import { useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Card, Label } from './stats/Card';
import { Heatmap } from './stats/Heatmap';
import { Sparkline } from './stats/Sparkline';
import { Bars } from './stats/Bars';
import { getStats, type HoneStats } from '../api/hone';

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  data: HoneStats | null;
  errorCode: Code | null;
  errorMsg: string | null;
}

const INITIAL: FetchState = { status: 'loading', data: null, errorCode: null, errorMsg: null };

export function StatsOverlay({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<FetchState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ok', data, errorCode: null, errorMsg: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setState({
          status: 'error',
          data: null,
          errorCode: ce.code,
          errorMsg: ce.rawMessage || ce.message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;
  const lastSeven = data?.lastSevenDays ?? [];
  const sparkSeries = lastSeven.map((d) => d.seconds);

  return (
    <>
      {/* LEFT column: Activity heatmap */}
      <aside
        className="slide-from-left"
        style={{
          position: 'absolute',
          left: 32,
          top: 96,
          bottom: 130,
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          zIndex: 12,
          pointerEvents: 'auto',
          animationDelay: '0ms',
        }}
      >
        <Card>
          <Label>Focus Activity</Label>
          <Heatmap days={data?.heatmap ?? []} />
        </Card>
      </aside>

      {/* RIGHT column: Streak + Bars + close */}
      <aside
        style={{
          position: 'absolute',
          right: 32,
          top: 96,
          bottom: 130,
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          zIndex: 12,
          pointerEvents: 'auto',
        }}
      >
        <div className="slide-from-right" style={{ animationDelay: '80ms' }}>
          <Card>
            <Label>Current Streak</Label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                alignItems: 'center',
                gap: 18,
                marginTop: 8,
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 56,
                  fontWeight: 300,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  color: 'var(--ink)',
                }}
              >
                {data?.currentStreakDays ?? 0}
                <span style={{ fontSize: 18, color: 'var(--ink-40)' }}>d</span>
              </div>
              <div>
                <Sparkline points={sparkSeries} />
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', marginTop: 8 }}>
                  Longest:{' '}
                  <span style={{ color: 'var(--ink-90)' }}>{data?.longestStreakDays ?? 0}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="slide-from-right" style={{ animationDelay: '160ms' }}>
          <Card>
            <Label>Focused Time · last 7 days</Label>
            <Bars days={lastSeven} />
          </Card>
        </div>

        {state.status === 'error' && state.errorCode === Code.Unauthenticated && (
          <div
            className="mono slide-from-right"
            style={{
              animationDelay: '160ms',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--ink-40)',
            }}
          >
            SIGN IN TO SEE STATS
          </div>
        )}
      </aside>

      {/* close hint */}
      <button
        onClick={onClose}
        className="mono row slide-from-right focus-ring"
        style={{
          position: 'absolute',
          top: 86,
          right: 32 + 380 + 14,
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'var(--ink-40)',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          zIndex: 12,
          animationDelay: '240ms',
        }}
      >
        ESC · CLOSE
      </button>
    </>
  );
}
