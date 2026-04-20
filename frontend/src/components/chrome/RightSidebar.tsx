import { useTranslation } from 'react-i18next'
import { Divider } from './Divider'
import { PowerFlask } from './CharacterPortrait'
import { useLeaderboardQuery } from '../../lib/queries/rating'
import { useSeasonQuery } from '../../lib/queries/season'

export function RightSidebar() {
  const { t } = useTranslation()
  const { data: lb } = useLeaderboardQuery('algorithms')
  const { data: season } = useSeasonQuery()

  const top5 = (lb?.entries ?? []).slice(0, 5)
  const myRank = lb?.my_rank ?? null
  const checkpoints = season?.checkpoints ?? []

  return (
    <aside
      style={{
        width: 'var(--sidebar-right)',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--gold-dim)',
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 20,
        overflow: 'auto',
      }}
    >
      {/* Flasks (bible flasks) */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>
          {t('right.flasks')}
        </Divider>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            justifyItems: 'center',
          }}
        >
          {/* Bible §3.1 — flasks mirror the four attribute axes:
              Reason/Intellect → Insight (blue)
              Force/Strength   → Resolve (crimson)
              Skill/Dexterity  → Ichor   (toxic green)
              Will             → Vigor   (gold)
              The fill levels here are placeholders — backend will expose
              `flask_charges` on Profile in a follow-up. */}
          <PowerFlask color="#6a9fd4" fill={0.85} label="INSIGHT" />
          <PowerFlask color="#c22222" fill={0.55} label="RESOLVE" />
          <PowerFlask color="#1d9e75" fill={0.92} label="ICHOR" />
          <PowerFlask color="#c8a96e" fill={0.3} label="VIGOR" />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            justifyItems: 'center',
            marginTop: 4,
            fontFamily: 'var(--font-code)',
            fontSize: 9,
            color: 'var(--text-dim)',
            letterSpacing: '0.1em',
          }}
        >
          <span>+12 INT</span>
          <span>+8 STR</span>
          <span>+15 DEX</span>
          <span>+5 WIL</span>
        </div>
      </div>

      {/* Leaderboard */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>
          {t('right.top5')}
        </Divider>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {top5.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--font-code)',
                fontSize: 10,
                color: 'var(--text-dim)',
              }}
            >
              {/* STUB: no data yet */}
              —
            </div>
          )}
          {top5.map((p) => (
            <div
              key={p.rank}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 8px',
                fontSize: 10,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  color: 'var(--gold-dim)',
                  width: 20,
                }}
              >
                {String(p.rank).padStart(2, '0')}
              </span>
              <span
                style={{
                  color: 'var(--text-mid)',
                  flex: 1,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '0.05em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.username}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-code)',
                  color: 'var(--text-mid)',
                  fontSize: 9,
                }}
              >
                {p.elo}
              </span>
            </div>
          ))}
          {myRank !== null && (
            <div
              style={{
                marginTop: 6,
                padding: '4px 8px',
                fontFamily: 'var(--font-code)',
                fontSize: 9,
                color: 'var(--gold)',
                letterSpacing: '0.1em',
              }}
            >
              {t('right.my_rank')} #{myRank}
            </div>
          )}
        </div>
      </div>

      {/* Season Track */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>
          {t('right.season_track')}
        </Divider>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 9,
            color: 'var(--text-mid)',
            letterSpacing: '0.15em',
            marginBottom: 8,
          }}
        >
          {season
            ? `TIER ${season.current_tier} / ${season.tier_max} · ${season.current_sp} SP`
            : /* STUB: fallback while loading */ 'TIER — / — · — SP'}
        </div>
        <div style={{ position: 'relative', paddingLeft: 8 }}>
          <div
            style={{
              position: 'absolute',
              left: 13,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--gold-dim)',
            }}
          />
          {checkpoints.slice(0, 6).map((c) => (
            <div
              key={c.tier}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: c.big ? 16 : 11,
                  height: c.big ? 16 : 11,
                  transform: 'rotate(45deg)',
                  flexShrink: 0,
                  background: c.done ? 'var(--gold)' : 'var(--bg-inset)',
                  border: `1px solid ${
                    c.current
                      ? 'var(--gold-bright)'
                      : c.done
                        ? 'var(--gold)'
                        : 'var(--gold-dim)'
                  }`,
                  boxShadow: c.current
                    ? '0 0 0 2px rgba(200,169,110,0.2)'
                    : 'none',
                  marginLeft: c.big ? -2 : 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 9,
                    color: 'var(--gold-dim)',
                    letterSpacing: '0.15em',
                  }}
                >
                  T{c.tier}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: c.done ? 'var(--gold-bright)' : 'var(--text-mid)',
                  }}
                >
                  {c.reward}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
