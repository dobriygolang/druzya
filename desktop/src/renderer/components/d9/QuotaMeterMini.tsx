// QuotaMeterMini — 44px bar + tabular-numerics "used/cap". Sits in
// compact + expanded input footers. Hidden via Settings → Appearance.

interface Props {
  used: number;
  cap: number;
  width?: number;
}

export function QuotaMeterMini({ used, cap, width = 44 }: Props) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width,
          height: 3,
          borderRadius: 2,
          background: 'oklch(1 0 0 / 0.08)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--d9-accent-lo), var(--d9-accent-hi))',
            transition: 'width 240ms var(--d9-ease)',
          }}
        />
      </span>
      <span
        style={{
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 10,
          color: 'var(--d9-ink-mute)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {used}
        <span style={{ color: 'var(--d9-ink-ghost)' }}>/{cap}</span>
      </span>
    </span>
  );
}
