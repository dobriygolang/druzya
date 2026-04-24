// Today — single-column plan page. Static mock data for MVP; wiring to
// the real `GenerateDailyPlan` RPC lands in Phase 5b once the auth flow
// is real enough to run against a live backend. The three rows you see
// are the exact shapes the synthesiser emits, so the real data drop-in
// is a one-liner once the hook exists.
import { Icon } from '../components/primitives/Icon';

interface TodayPageProps {
  onStartFocus: () => void;
}

const ITEMS = [
  { t: 'Binary Tree Level Order', s: 'Targets your weak spot — BFS on trees.' },
  { t: 'System Design mock · 18:00', s: 'With Артём К. Warm-up prepared.' },
  { t: 'PR druz9/backend#421', s: 'Two comments from @lead are waiting.' },
];

export function TodayPage({ onStartFocus }: TodayPageProps) {
  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 560, maxWidth: '90%', padding: '0 16px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)' }}
        >
          FRIDAY · APR 24
        </div>
        <h1
          style={{
            margin: '20px 0 0',
            fontSize: 44,
            fontWeight: 400,
            letterSpacing: '-0.03em',
            lineHeight: 1.08,
          }}
        >
          What will you hone today?
        </h1>

        <ul style={{ listStyle: 'none', margin: '64px 0 0', padding: 0 }}>
          {ITEMS.map((x, i) => (
            <li key={i} style={{ padding: '26px 0' }}>
              <div style={{ fontSize: 17, color: 'var(--ink)', letterSpacing: '-0.005em' }}>
                {x.t}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-40)', marginTop: 8 }}>{x.s}</div>
            </li>
          ))}
        </ul>

        <button
          onClick={onStartFocus}
          className="focus-ring"
          style={{
            marginTop: 56,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 20px',
            borderRadius: 999,
            background: '#fff',
            color: '#000',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Start focus <Icon name="arrow" size={12} />
        </button>
      </div>
    </div>
  );
}
