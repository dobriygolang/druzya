// Character portrait — pure SVG geometry (rectangles + polygons).
// Scales via `size` prop; level+class tweak the armor/aura details.
function CharacterPortrait({ size = 170, level = 24, aura = true, weapon = true, tier = 'ascendant' }) {
  const w = size, h = size * 1.35;
  const goldDim = '#4a3c28';
  const gold = '#c8a96e';
  const goldBright = '#e8c87a';
  const armorDark = '#181c24';
  const armorMid = '#2a2d38';
  const cloak = '#2a1800';
  const cloakAccent = '#3a2810';
  const skin = '#3a3428';

  return (
    <svg width={w} height={h} viewBox="0 0 170 230" style={{ display: 'block' }}>
      {/* Aura — faint concentric hex */}
      {aura && (
        <>
          <polygon points="85,15 150,55 150,175 85,215 20,175 20,55"
            fill="none" stroke={goldDim} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.6" />
          <polygon points="85,25 140,62 140,168 85,205 30,168 30,62"
            fill="none" stroke={goldDim} strokeWidth="0.5" opacity="0.4" />
        </>
      )}

      {/* Cloak — back shape, polygonal */}
      <polygon points="30,95 45,85 45,195 85,215 125,195 125,85 140,95 145,180 85,220 25,180"
        fill={cloak} stroke={goldDim} strokeWidth="1" />
      <polygon points="45,100 60,95 60,190 85,200 110,190 110,95 125,100 125,185 85,205 45,185"
        fill={cloakAccent} opacity="0.6" />

      {/* Shoulders — pauldrons, big angular plates */}
      <polygon points="35,90 58,80 62,110 40,120" fill={armorMid} stroke={gold} strokeWidth="1" />
      <polygon points="135,90 112,80 108,110 130,120" fill={armorMid} stroke={gold} strokeWidth="1" />
      {/* spikes on pauldrons */}
      <polygon points="38,88 48,74 54,88" fill={armorDark} stroke={gold} strokeWidth="0.7" />
      <polygon points="132,88 122,74 116,88" fill={armorDark} stroke={gold} strokeWidth="0.7" />

      {/* Body — chest plate */}
      <polygon points="58,95 112,95 118,150 108,175 62,175 52,150" fill={armorMid} stroke={goldDim} strokeWidth="1" />
      {/* Chest plate highlights */}
      <polygon points="62,98 108,98 114,148 104,172 66,172 56,148" fill={armorDark} />
      {/* Center emblem — diamond */}
      <polygon points="85,115 95,130 85,145 75,130" fill="none" stroke={gold} strokeWidth="1.2" />
      <polygon points="85,122 91,130 85,138 79,130" fill={gold} opacity="0.8" />
      {/* Chest ribs — horizontal bands */}
      <rect x="60" y="128" width="50" height="1" fill={goldDim} />
      <rect x="60" y="155" width="50" height="1" fill={goldDim} />

      {/* Belt */}
      <rect x="55" y="168" width="60" height="6" fill={armorDark} stroke={gold} strokeWidth="0.8" />
      <rect x="82" y="166" width="6" height="10" fill={gold} />

      {/* Arms — angular */}
      <polygon points="40,120 52,118 58,160 48,175 38,165" fill={armorMid} stroke={goldDim} />
      <polygon points="130,120 118,118 112,160 122,175 132,165" fill={armorMid} stroke={goldDim} />
      {/* Forearms */}
      <polygon points="38,165 48,175 50,195 38,195" fill={armorDark} stroke={goldDim} />
      <polygon points="132,165 122,175 120,195 132,195" fill={armorDark} stroke={goldDim} />

      {/* Neck */}
      <rect x="78" y="82" width="14" height="14" fill={skin} />
      {/* Neck guard */}
      <polygon points="72,88 98,88 100,96 70,96" fill={armorDark} stroke={gold} strokeWidth="0.7" />

      {/* Head — helmet */}
      <polygon points="70,35 100,35 108,60 108,82 62,82 62,60" fill={armorDark} stroke={gold} strokeWidth="1" />
      {/* Helmet top ridge */}
      <polygon points="80,28 90,28 95,40 75,40" fill={armorMid} stroke={gold} strokeWidth="0.8" />
      {/* Plume */}
      {tier === 'ascendant' && (
        <polygon points="80,30 90,30 92,14 85,0 78,14" fill={cloakAccent} stroke={goldDim} strokeWidth="0.7" />
      )}
      {/* Visor — T slit */}
      <rect x="72" y="54" width="26" height="4" fill="#000" />
      <rect x="82" y="58" width="6" height="14" fill="#000" />
      {/* Helmet cheek guards */}
      <polygon points="62,62 70,62 68,80 62,82" fill={armorMid} />
      <polygon points="108,62 100,62 102,80 108,82" fill={armorMid} />
      {/* Gold rune mark on forehead */}
      <polygon points="85,46 88,50 85,54 82,50" fill={gold} />

      {/* Weapon — sword hilt peeking from behind shoulder */}
      {weapon && (
        <>
          <rect x="18" y="60" width="4" height="70" fill={armorDark} stroke={goldDim} strokeWidth="0.6" />
          <polygon points="14,58 26,58 26,64 14,64" fill={gold} />
          <polygon points="16,130 24,130 23,140 17,140" fill={gold} />
          <rect x="19" y="132" width="2" height="6" fill={armorDark} />
        </>
      )}

      {/* Level badge — diamond at bottom */}
      <polygon points="85,198 105,215 85,228 65,215" fill={armorDark} stroke={gold} strokeWidth="1.2" />
      <text x="85" y="220" textAnchor="middle" fill={goldBright} fontFamily="Cinzel, serif" fontSize="11" fontWeight="700">{level}</text>
    </svg>
  );
}

// Smaller inline character icon used in headers
function CharacterChip({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }}>
      <polygon points="20,2 36,10 36,30 20,38 4,30 4,10" fill="#12141a" stroke="#c8a96e" strokeWidth="1" />
      <polygon points="14,10 26,10 28,18 28,24 12,24 12,18" fill="#2a2d38" />
      <rect x="16" y="17" width="8" height="1.5" fill="#000" />
      <polygon points="20,26 20,32" stroke="#c8a96e" strokeWidth="1.5" />
      <polygon points="14,28 26,28 24,34 16,34" fill="#2a2d38" stroke="#c8a96e" strokeWidth="0.6" />
    </svg>
  );
}

// Guild emblem — heraldic shield with glyph
function GuildEmblem({ color = '#c8a96e', glyph = '⚔', size = 48 }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 48 55">
      <polygon points="24,2 44,8 44,32 24,52 4,32 4,8" fill="#12141a" stroke={color} strokeWidth="1.2" />
      <polygon points="24,6 40,11 40,30 24,48 8,30 8,11" fill="none" stroke={color} strokeWidth="0.5" opacity="0.5" />
      <text x="24" y="32" textAnchor="middle" fill={color} fontSize="18" fontFamily="serif">{glyph}</text>
    </svg>
  );
}

// Power flask — liquid in a vessel
function PowerFlask({ color, fill = 0.7, label }) {
  const liquidH = 70 * fill;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width="38" height="80" viewBox="0 0 38 80">
        {/* neck */}
        <rect x="14" y="2" width="10" height="8" fill="#12141a" stroke="#4a3c28" />
        {/* cork */}
        <rect x="12" y="0" width="14" height="4" fill="#4a3c28" />
        {/* body — hexagonal flask */}
        <polygon points="8,12 30,12 36,20 36,70 25,78 13,78 2,70 2,20"
          fill="#0a0c10" stroke="#4a3c28" strokeWidth="1" />
        {/* liquid */}
        <clipPath id={`flask-${label}`}>
          <polygon points="8,12 30,12 36,20 36,70 25,78 13,78 2,70 2,20" />
        </clipPath>
        <rect x="2" y={78 - liquidH} width="34" height={liquidH}
          fill={color} opacity="0.85" clipPath={`url(#flask-${label})`} />
        {/* shine */}
        <rect x="6" y="20" width="2" height="40" fill="#fff" opacity="0.08" clipPath={`url(#flask-${label})`} />
      </svg>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.15em', color: 'var(--text-mid)' }}>{label}</span>
    </div>
  );
}

Object.assign(window, { CharacterPortrait, CharacterChip, GuildEmblem, PowerFlask });
