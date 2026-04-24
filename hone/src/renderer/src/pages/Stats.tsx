// Stats — the Phase 5a vertical slice.
//
// This page is wired to the real backend over Connect-RPC. We ship three
// states the user actually sees:
//
//   loading   — first render while the fetch is in flight. Render the
//               widgets with zero-value props so the layout is stable
//               and the UI doesn't "snap" into place on resolve.
//   error     — typed messaging for the two expected error classes
//               (unauthenticated / unavailable). All other errors fall
//               into a generic "something broke" pane with the message.
//   success   — the one we care about most; data lands and the widgets
//               re-render with the real heatmap + streak + bars.
//
// The fetch runs once on mount. Periodic refresh isn't needed for stats
// — this page is rarely open for more than a few seconds, and streak
// numbers lag new focus sessions by a few minutes at most.
import { useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Card, Label } from '../components/stats/Card';
import { Heatmap } from '../components/stats/Heatmap';
import { Sparkline } from '../components/stats/Sparkline';
import { Bars } from '../components/stats/Bars';
import { getStats, type HoneStats } from '../api/hone';

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  data: HoneStats | null;
  error: string | null;
  errorCode: Code | null;
}

const INITIAL: FetchState = { status: 'loading', data: null, error: null, errorCode: null };

function formatHoursMinutes(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function StatsPage() {
  const [state, setState] = useState<FetchState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL);
    getStats()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ok', data, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setState({
          status: 'error',
          data: null,
          error: ce.rawMessage || ce.message,
          errorCode: ce.code,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;
  const lastSeven = data?.lastSevenDays ?? [];
  // Sparkline series = focused-seconds per day in the last seven days.
  // When empty, Sparkline falls back to a flat placeholder line.
  const sparkSeries = lastSeven.map((d) => d.seconds);

  const headline =
    state.status === 'ok'
      ? `You focused ${formatHoursMinutes(data?.totalFocusedSeconds ?? 0)} today.`
      : state.status === 'loading'
        ? 'Gathering the quiet numbers…'
        : errorHeadline(state.errorCode);

  return (
    <div
      className="fadein"
      style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 440px' }}
    >
      {/* LEFT: hero */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{ padding: '0 64px', maxWidth: 640 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 46,
              fontWeight: 400,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
            }}
          >
            Everything
            <br />
            stays calm.
          </h1>
          <p style={{ marginTop: 24, fontSize: 14, color: 'var(--ink-40)', maxWidth: 460, lineHeight: 1.6 }}>
            {headline}
          </p>
          {state.status === 'error' && state.error && (
            <p
              className="mono"
              style={{
                marginTop: 10,
                fontSize: 11,
                color: 'var(--ink-40)',
                letterSpacing: '.04em',
              }}
            >
              {state.error}
            </p>
          )}
        </div>
      </div>

      {/* RIGHT: widgets — always rendered. Loading / error render zero-
           value data so the layout stays stable. */}
      <aside
        style={{
          padding: '90px 32px 120px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
        }}
      >
        <Card>
          <Label>Focus Activity</Label>
          <Heatmap days={data?.heatmap ?? []} />
        </Card>
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
                fontSize: 68,
                fontWeight: 300,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: 'var(--ink)',
              }}
            >
              {data?.currentStreakDays ?? 0}
              <span style={{ fontSize: 22, color: 'var(--ink-40)' }}>d</span>
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
        <Card>
          <Label>Focused Time · last 7 days</Label>
          <Bars days={lastSeven} />
        </Card>
      </aside>
    </div>
  );
}

function errorHeadline(code: Code | null): string {
  switch (code) {
    case Code.Unauthenticated:
      return 'Sign in to see your focus stats.';
    case Code.Unavailable:
      return 'The backend is resting. Try again in a moment.';
    default:
      return 'Could not load your stats just now.';
  }
}
