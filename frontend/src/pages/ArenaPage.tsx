import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Button,
  InsetGroove,
  Bar,
} from '../components/chrome'
import { useArenaMatchQuery } from '../lib/queries/arena'
import { useLeaderboardQuery, type SectionKey } from '../lib/queries/rating'

const MATCH_ID = '11111111-1111-1111-1111-111111111111'

export default function ArenaPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionKey>('algorithms')
  const [searching, setSearching] = useState(false)
  const { data: match } = useArenaMatchQuery(MATCH_ID)
  const { data: lb } = useLeaderboardQuery(section)

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20 }}>
        <PageHeader
          title={t('arena.title')}
          subtitle={t('arena.subtitle')}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {searching && <QueueRing />}
              <Button
                tone="blood"
                onClick={() => setSearching((v) => !v)}
              >
                {searching ? t('arena.cancel') : t('arena.find_match')}
              </Button>
            </div>
          }
        />
        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            alignItems: 'flex-start',
          }}
        >
          <Panel>
            <PanelHead subtitle="MATCH">Дуэль</PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {match ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div
                        className="heraldic"
                        style={{ color: 'var(--gold-bright)', fontSize: 14 }}
                      >
                        {match.task.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                        {t('arena.time_left')}:{' '}
                        <span className="mono" style={{ color: 'var(--gold)' }}>
                          {Math.round(match.task.time_limit_sec)}s
                        </span>
                      </div>
                    </div>
                    <Badge variant="hard">{match.task.difficulty}</Badge>
                  </div>
                  <InsetGroove>
                    <div style={{ fontSize: 12, color: 'var(--text-bright)' }}>
                      {match.task.description}
                    </div>
                  </InsetGroove>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    {match.participants.map((p, i) => (
                      <InsetGroove key={p.user_id}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <ShieldAvatar
                            seed={p.username}
                            tone={i === 0 ? 'ally' : 'enemy'}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                color:
                                  i === 0
                                    ? 'var(--gold-bright)'
                                    : 'var(--blood-lit)',
                                fontFamily: 'var(--font-display)',
                                letterSpacing: '0.15em',
                                fontSize: 11,
                              }}
                            >
                              {i === 0 ? t('arena.you') : t('arena.opponent')}
                            </div>
                            <div style={{ fontSize: 13, marginTop: 2 }}>
                              {p.username}
                            </div>
                            <div
                              className="mono"
                              style={{ fontSize: 10, color: 'var(--text-mid)' }}
                            >
                              ELO {p.elo_before}
                            </div>
                          </div>
                        </div>
                      </InsetGroove>
                    ))}
                  </div>
                  {/* STUB: Monaco dual-editor split — full implementation requires @monaco-editor/react wiring */}
                  <InsetGroove style={{ minHeight: 160 }}>
                    <div
                      className="caps"
                      style={{ color: 'var(--gold-dim)', marginBottom: 8 }}
                    >
                      Starter code · Go
                    </div>
                    <pre
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: 'var(--text-bright)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {match.task.starter_code.go ??
                        '// STUB: starter code unavailable'}
                    </pre>
                  </InsetGroove>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button tone="primary">{t('arena.submit')}</Button>
                    <Button tone="ghost">Forfeit</Button>
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-dim)' }}>
                  {t('common.loading')}
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="LEADERBOARD">Таблица лидеров</PanelHead>
            <div style={{ padding: 20 }}>
              <div
                className="tab-row"
                style={{ display: 'flex', gap: 0, marginBottom: 12 }}
              >
                {(
                  [
                    'algorithms',
                    'sql',
                    'go',
                    'system_design',
                    'behavioral',
                  ] as SectionKey[]
                ).map((s) => (
                  <button
                    key={s}
                    className={`tab ${section === s ? 'active' : ''}`}
                    onClick={() => setSection(s)}
                    style={{
                      padding: '6px 12px',
                      fontFamily: 'var(--font-display)',
                      fontSize: 10,
                      letterSpacing: '0.2em',
                      color:
                        section === s
                          ? 'var(--gold-bright)'
                          : 'var(--text-mid)',
                      background: 'transparent',
                    }}
                  >
                    {t(`sections.${s}`)}
                  </button>
                ))}
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {(lb?.entries ?? []).map((e) => {
                  const top = e.rank <= 3
                  const rankColor =
                    e.rank === 1
                      ? 'var(--gold-bright)'
                      : e.rank === 2
                        ? '#c0c0c0'
                        : e.rank === 3
                          ? '#cd7f32'
                          : 'var(--gold-dim)'
                  return (
                    <div
                      key={e.rank}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 10px',
                        background: top
                          ? `linear-gradient(90deg, color-mix(in srgb, ${rankColor} 15%, var(--bg-inset)) 0%, var(--bg-inset) 100%)`
                          : 'var(--bg-inset)',
                        border: `1px solid ${
                          top ? rankColor : 'var(--gold-faint)'
                        }`,
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          fontFamily: 'var(--font-display)',
                          color: rankColor,
                          fontSize: 13,
                        }}
                      >
                        {String(e.rank).padStart(2, '0')}
                      </span>
                      <ShieldAvatar seed={e.username} compact />
                      <span
                        style={{
                          flex: 1,
                          color: 'var(--text-bright)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {e.username}
                        {e.title && (
                          <span
                            style={{
                              color: 'var(--ember-lit)',
                              marginLeft: 8,
                              fontSize: 10,
                            }}
                          >
                            · {e.title}
                          </span>
                        )}
                      </span>
                      <span
                        className="mono"
                        style={{ color: 'var(--gold-bright)' }}
                      >
                        {e.elo}
                      </span>
                    </div>
                  )
                })}
              </div>
              {lb?.my_rank && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '8px 10px',
                    border: '1px solid var(--gold)',
                    background: 'rgba(200,169,110,0.05)',
                  }}
                >
                  <Bar value={100 - (lb.my_rank / 100) * 100} max={100} tone="ember" />
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      color: 'var(--text-mid)',
                    }}
                  >
                    Твоё место: #{lb.my_rank}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

/** FNV-1a 32-bit. */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Hex shield avatar with deterministic palette. tone overrides palette. */
function ShieldAvatar({
  seed,
  tone,
  compact = false,
}: {
  seed: string
  tone?: 'ally' | 'enemy'
  compact?: boolean
}) {
  const PALETTE = [
    ['#6a9fd4', '#1a3a6a'],
    ['#e09b3a', '#3a1f08'],
    ['#7f77dd', '#1a1040'],
    ['#1d9e75', '#04180f'],
    ['#c8a96e', '#2a2318'],
    ['#b9a6ff', '#1a0f2a'],
  ]
  const h = hashStr(seed)
  let stroke: string
  let fill: string
  if (tone === 'ally') {
    stroke = 'var(--gold-bright)'
    fill = 'var(--gold-faint)'
  } else if (tone === 'enemy') {
    stroke = 'var(--blood-lit)'
    fill = 'var(--blood-deep)'
  } else {
    ;[stroke, fill] = PALETTE[h % PALETTE.length]
  }
  const size = compact ? 22 : 36
  const initial = seed.charAt(0).toUpperCase()
  return (
    <svg
      width={size}
      height={size * 1.13}
      viewBox="0 0 30 34"
      style={{ flexShrink: 0 }}
    >
      <polygon
        points="15,2 27,6 27,24 15,32 3,24 3,6"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.3"
      />
      <text
        x="15"
        y="21"
        textAnchor="middle"
        fill={stroke}
        fontFamily="var(--font-display)"
        fontSize={compact ? 11 : 14}
      >
        {initial}
      </text>
    </svg>
  )
}

/** Concentric pulse-ring shown when actively searching for an opponent. */
function QueueRing() {
  return (
    <span
      title="searching for opponent"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
      }}
    >
      {[0, 0.6, 1.2].map((delay) => (
        <span
          key={delay}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            border: '1px solid var(--blood-lit)',
            borderRadius: '50%',
            animation: `queue-ring 1.8s ease-out ${delay}s infinite`,
          }}
        />
      ))}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--blood-lit)',
          boxShadow: '0 0 6px var(--blood-bright)',
        }}
      />
    </span>
  )
}
