import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CharacterChip } from './CharacterPortrait'
import { useProfileQuery } from '../../lib/queries/profile'

// Bible §2.6: NEVER translate these five — plus Profile as sixth nav tab.
const NAV: Array<{ key: string; to: string; label: string }> = [
  { key: 'sanctum', to: '/sanctum', label: 'Sanctum' },
  { key: 'arena', to: '/arena', label: 'Arena' },
  { key: 'guild', to: '/guild', label: 'Guild' },
  { key: 'atlas', to: '/atlas', label: 'Atlas' },
  { key: 'codex', to: '/codex', label: 'Codex' },
  { key: 'profile', to: '/profile', label: 'Profile' },
]

export function Topbar() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const level = profile?.level ?? 24
  const xp = profile?.xp ?? 18420
  const xpMax = profile?.xp_to_next ?? 29700
  const pct = Math.min(100, (xp / Math.max(1, xpMax)) * 100)

  return (
    <header
      style={{
        height: 'var(--topbar-height)',
        background: 'linear-gradient(180deg, #141010, #0a0706)',
        borderBottom: '1px solid var(--gold-dim)',
        boxShadow:
          '0 2px 0 rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 20,
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      {/* Brand mark */}
      <NavLink
        to="/sanctum"
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <svg width="26" height="26" viewBox="0 0 22 22">
          <polygon
            points="11,1 20,6 20,16 11,21 2,16 2,6"
            fill="none"
            stroke="var(--gold)"
            strokeWidth="1.2"
          />
          <polygon
            points="11,6 15,8.5 15,13.5 11,16 7,13.5 7,8.5"
            fill="var(--gold)"
          />
        </svg>
        <span
          className="heraldic"
          style={{ color: 'var(--gold-bright)', fontSize: 16 }}
        >
          DRUZ9
        </span>
      </NavLink>

      <div style={{ width: 1, height: 22, background: 'var(--gold-dim)' }} />

      {/* Season pill */}
      <NavLink
        to="/season"
        title={t('topbar.season')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          background: 'linear-gradient(90deg, #3a0808, #1a0404)',
          border: '1px solid var(--blood-lit)',
          boxShadow: 'inset 0 0 8px rgba(232,56,56,0.2)',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            background: 'var(--blood-bright)',
            borderRadius: '50%',
            boxShadow: '0 0 8px var(--blood-bright)',
            animation: 'pulse 2s infinite',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            color: 'var(--gold-bright)',
            letterSpacing: '0.15em',
          }}
        >
          {t('topbar.season')}
        </span>
      </NavLink>

      <div style={{ width: 1, height: 22, background: 'var(--gold-dim)' }} />

      {/* Nav (English labels, bible §2.6 — do NOT translate) */}
      <nav style={{ display: 'flex', gap: 2 }}>
        {NAV.map((n) => (
          <NavLink
            key={n.key}
            to={n.to}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
            style={({ isActive }) => ({
              padding: '10px 12px',
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: isActive ? 'var(--gold-bright)' : 'var(--text-mid)',
              borderBottom: isActive
                ? '2px solid var(--gold)'
                : '2px solid transparent',
              background: isActive
                ? 'linear-gradient(180deg, transparent, rgba(200,169,110,0.08))'
                : 'transparent',
            })}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="grow" />

      {/* XP */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 9,
            color: 'var(--text-mid)',
            letterSpacing: '0.2em',
          }}
        >
          {t('topbar.xp')}
        </span>
        <div
          style={{
            position: 'relative',
            width: 180,
            height: 12,
            background: 'var(--bg-inset)',
            border: '1px solid var(--gold-faint)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${pct}%`,
              background:
                'linear-gradient(180deg, var(--gold-bright), var(--gold))',
              boxShadow: '0 0 8px rgba(200,169,110,0.35)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-code)',
              fontSize: 9,
              color: 'var(--bg-void)',
              fontWeight: 700,
              letterSpacing: '0.15em',
            }}
          >
            {xp.toLocaleString('ru-RU')}&nbsp;/&nbsp;
            {xpMax.toLocaleString('ru-RU')}
          </div>
        </div>
      </div>

      {/* Level */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 9,
            color: 'var(--text-mid)',
            letterSpacing: '0.2em',
          }}
        >
          {t('topbar.level')}
        </span>
        <span
          className="heraldic"
          style={{ color: 'var(--gold-bright)', fontSize: 14 }}
        >
          {level}
        </span>
      </div>

      {/* Hex avatar */}
      <NavLink to="/profile" className="hex-wrap">
        <div
          className="hex"
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CharacterChip size={30} />
        </div>
      </NavLink>
    </header>
  )
}
