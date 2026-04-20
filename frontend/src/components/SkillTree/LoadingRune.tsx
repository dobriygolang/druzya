// Heraldic rune spinner — shown while atlas data is loading.
export function LoadingRune() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <svg
        width={80}
        height={80}
        viewBox="-40 -40 80 80"
        className="atlas-rune-spin"
      >
        <circle
          r={34}
          fill="none"
          stroke="var(--gold-dim)"
          strokeDasharray="6 6"
        />
        <polygon
          points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11"
          fill="none"
          stroke="var(--gold)"
          strokeWidth={1.2}
        />
        <polygon
          points="0,-12 10,-6 10,6 0,12 -10,6 -10,-6"
          fill="var(--bg-card)"
          stroke="var(--gold-bright)"
          strokeWidth={1}
        />
        <text
          y={4}
          textAnchor="middle"
          fill="var(--gold-bright)"
          fontSize={13}
          fontFamily="var(--font-heraldic)"
        >
          ✦
        </text>
      </svg>
    </div>
  )
}
