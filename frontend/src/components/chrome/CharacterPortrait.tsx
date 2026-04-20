type Props = {
  size?: number
  level?: number
  aura?: boolean
  weapon?: boolean
  tier?: 'ascendant' | 'initiate'
  glow?: boolean
}

const GOLD = 'var(--gold)'
const GOLD_DIM = 'var(--gold-dim)'
const GOLD_BRIGHT = 'var(--gold-bright)'
const ARMOR_DARK = '#181c24'
const ARMOR_MID = '#2a2d38'
const CLOAK = '#2a1800'
const CLOAK_ACCENT = '#3a2810'
const SKIN = '#3a3428'

export function CharacterPortrait({
  size = 170,
  level = 24,
  aura = true,
  weapon = true,
  tier = 'ascendant',
  glow = true,
}: Props) {
  const w = size
  const h = Math.round(size * 1.35)

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        padding: glow ? 6 : 0,
      }}
    >
      {glow && (
        <>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse at 50% 60%, rgba(200,169,110,0.18), transparent 58%), radial-gradient(ellipse at 50% 95%, rgba(224,155,58,0.28), transparent 55%)',
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse at 50% 45%, rgba(194,34,34,0.14), transparent 55%)',
              animation: 'sigil-aura 3.2s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
      <svg
        width={w}
        height={h}
        viewBox="0 0 170 230"
        style={{ display: 'block', position: 'relative' }}
      >
        {aura && (
          <>
            <polygon
              points="85,15 150,55 150,175 85,215 20,175 20,55"
              fill="none"
              stroke={GOLD_DIM}
              strokeWidth="0.5"
              strokeDasharray="2 4"
              opacity="0.6"
            />
            <polygon
              points="85,25 140,62 140,168 85,205 30,168 30,62"
              fill="none"
              stroke={GOLD_DIM}
              strokeWidth="0.5"
              opacity="0.4"
            />
          </>
        )}
        {/* Cloak */}
        <polygon
          points="30,95 45,85 45,195 85,215 125,195 125,85 140,95 145,180 85,220 25,180"
          fill={CLOAK}
          stroke={GOLD_DIM}
          strokeWidth="1"
        />
        <polygon
          points="45,100 60,95 60,190 85,200 110,190 110,95 125,100 125,185 85,205 45,185"
          fill={CLOAK_ACCENT}
          opacity="0.6"
        />
        {/* Pauldrons */}
        <polygon
          points="35,90 58,80 62,110 40,120"
          fill={ARMOR_MID}
          stroke={GOLD}
          strokeWidth="1"
        />
        <polygon
          points="135,90 112,80 108,110 130,120"
          fill={ARMOR_MID}
          stroke={GOLD}
          strokeWidth="1"
        />
        <polygon
          points="38,88 48,74 54,88"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="0.7"
        />
        <polygon
          points="132,88 122,74 116,88"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="0.7"
        />
        {/* Chest */}
        <polygon
          points="58,95 112,95 118,150 108,175 62,175 52,150"
          fill={ARMOR_MID}
          stroke={GOLD_DIM}
          strokeWidth="1"
        />
        <polygon
          points="62,98 108,98 114,148 104,172 66,172 56,148"
          fill={ARMOR_DARK}
        />
        <polygon
          points="85,115 95,130 85,145 75,130"
          fill="none"
          stroke={GOLD}
          strokeWidth="1.2"
        />
        <polygon
          points="85,122 91,130 85,138 79,130"
          fill={GOLD}
          opacity="0.8"
        />
        <rect x="60" y="128" width="50" height="1" fill={GOLD_DIM} />
        <rect x="60" y="155" width="50" height="1" fill={GOLD_DIM} />
        {/* Belt */}
        <rect
          x="55"
          y="168"
          width="60"
          height="6"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="0.8"
        />
        <rect x="82" y="166" width="6" height="10" fill={GOLD} />
        {/* Arms */}
        <polygon
          points="40,120 52,118 58,160 48,175 38,165"
          fill={ARMOR_MID}
          stroke={GOLD_DIM}
        />
        <polygon
          points="130,120 118,118 112,160 122,175 132,165"
          fill={ARMOR_MID}
          stroke={GOLD_DIM}
        />
        <polygon
          points="38,165 48,175 50,195 38,195"
          fill={ARMOR_DARK}
          stroke={GOLD_DIM}
        />
        <polygon
          points="132,165 122,175 120,195 132,195"
          fill={ARMOR_DARK}
          stroke={GOLD_DIM}
        />
        {/* Neck */}
        <rect x="78" y="82" width="14" height="14" fill={SKIN} />
        <polygon
          points="72,88 98,88 100,96 70,96"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="0.7"
        />
        {/* Head */}
        <polygon
          points="70,35 100,35 108,60 108,82 62,82 62,60"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="1"
        />
        <polygon
          points="80,28 90,28 95,40 75,40"
          fill={ARMOR_MID}
          stroke={GOLD}
          strokeWidth="0.8"
        />
        {tier === 'ascendant' && (
          <polygon
            points="80,30 90,30 92,14 85,0 78,14"
            fill={CLOAK_ACCENT}
            stroke={GOLD_DIM}
            strokeWidth="0.7"
          />
        )}
        <rect x="72" y="54" width="26" height="4" fill="#000" />
        <rect x="82" y="58" width="6" height="14" fill="#000" />
        <polygon points="62,62 70,62 68,80 62,82" fill={ARMOR_MID} />
        <polygon points="108,62 100,62 102,80 108,82" fill={ARMOR_MID} />
        <polygon points="85,46 88,50 85,54 82,50" fill={GOLD} />
        {/* Weapon */}
        {weapon && (
          <>
            <rect
              x="18"
              y="60"
              width="4"
              height="70"
              fill={ARMOR_DARK}
              stroke={GOLD_DIM}
              strokeWidth="0.6"
            />
            <polygon points="14,58 26,58 26,64 14,64" fill={GOLD} />
            <polygon points="16,130 24,130 23,140 17,140" fill={GOLD} />
            <rect x="19" y="132" width="2" height="6" fill={ARMOR_DARK} />
          </>
        )}
        {/* Level badge */}
        <polygon
          points="85,198 105,215 85,228 65,215"
          fill={ARMOR_DARK}
          stroke={GOLD}
          strokeWidth="1.2"
        />
        <text
          x="85"
          y="220"
          textAnchor="middle"
          fill={GOLD_BRIGHT}
          fontFamily="Cinzel, serif"
          fontSize="11"
          fontWeight="700"
        >
          {level}
        </text>
      </svg>
    </div>
  )
}

export function CharacterChip({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ display: 'block' }}
    >
      <polygon
        points="20,2 36,10 36,30 20,38 4,30 4,10"
        fill="#12141a"
        stroke="var(--gold)"
        strokeWidth="1"
      />
      <polygon
        points="14,10 26,10 28,18 28,24 12,24 12,18"
        fill="#2a2d38"
      />
      <rect x="16" y="17" width="8" height="1.5" fill="#000" />
      <polygon
        points="14,28 26,28 24,34 16,34"
        fill="#2a2d38"
        stroke="var(--gold)"
        strokeWidth="0.6"
      />
    </svg>
  )
}

export function PowerFlask({
  color,
  fill = 0.7,
  label,
  charges,
}: {
  color: string
  fill: number
  label: string
  /** Optional consumable charge count; when set, rendered as a small badge
      to make flasks visually distinct from the raw attribute bars in the
      left sidebar. */
  charges?: number
}) {
  const liquidH = 70 * fill
  const clipId = `flask-${label.replace(/\s+/g, '')}`
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <div style={{ position: 'relative' }}>
        <svg width="38" height="80" viewBox="0 0 38 80">
          <rect
            x="14"
            y="2"
            width="10"
            height="8"
            fill="#12141a"
            stroke="var(--gold-dim)"
          />
          <rect x="12" y="0" width="14" height="4" fill="var(--gold-dim)" />
          <polygon
            points="8,12 30,12 36,20 36,70 25,78 13,78 2,70 2,20"
            fill="var(--bg-inset)"
            stroke="var(--gold-dim)"
            strokeWidth="1"
          />
          <defs>
            <clipPath id={clipId}>
              <polygon points="8,12 30,12 36,20 36,70 25,78 13,78 2,70 2,20" />
            </clipPath>
          </defs>
          <rect
            x="2"
            y={78 - liquidH}
            width="34"
            height={liquidH}
            fill={color}
            opacity="0.85"
            clipPath={`url(#${clipId})`}
          />
          <rect
            x="6"
            y="20"
            width="2"
            height="40"
            fill="#fff"
            opacity="0.08"
            clipPath={`url(#${clipId})`}
          />
        </svg>
        {typeof charges === 'number' && (
          <span
            style={{
              position: 'absolute',
              right: -4,
              top: 6,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              background: 'var(--bg-void)',
              border: `1px solid ${color}`,
              borderRadius: 7,
              fontFamily: 'var(--font-code)',
              fontSize: 9,
              color,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 4px rgba(0,0,0,0.6)',
            }}
            title={`${charges} charge${charges === 1 ? '' : 's'}`}
          >
            {charges}
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 8,
          letterSpacing: '0.15em',
          color: 'var(--text-mid)',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export function GuildEmblem({
  color = 'var(--gold)',
  glyph = '⚔',
  size = 48,
}: {
  color?: string
  glyph?: string
  size?: number
}) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 48 55">
      <polygon
        points="24,2 44,8 44,32 24,52 4,32 4,8"
        fill="#12141a"
        stroke={color}
        strokeWidth="1.2"
      />
      <polygon
        points="24,6 40,11 40,30 24,48 8,30 8,11"
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.5"
      />
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fill={color}
        fontSize="18"
        fontFamily="Cinzel, serif"
      >
        {glyph}
      </text>
    </svg>
  )
}
