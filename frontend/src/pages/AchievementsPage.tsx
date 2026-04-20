import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  InsetGroove,
} from '../components/chrome'
import { useProfileQuery } from '../lib/queries/profile'
import { useSeasonQuery } from '../lib/queries/season'

// Rarity ladder — matches tokens.css --rarity-* palette.
// STUB: backend doesn't expose rarity yet — derive from achievement key hash
// so each achievement has a consistent visual tier until the real field lands.
type Rarity = 'normal' | 'magic' | 'rare' | 'unique' | 'divine'
const RARITY_STROKE: Record<Rarity, string> = {
  normal: 'var(--rarity-normal)',
  magic: 'var(--rarity-magic)',
  rare: 'var(--rarity-rare)',
  unique: 'var(--rarity-unique)',
  divine: 'var(--rarity-divine)',
}
function achievementRarity(key: string): Rarity {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // Weight distribution: 40/30/15/10/5 — most are normal/magic, few divine.
  const roll = h % 100
  if (roll < 40) return 'normal'
  if (roll < 70) return 'magic'
  if (roll < 85) return 'rare'
  if (roll < 95) return 'unique'
  return 'divine'
}

// STUB: pool of locked achievements to show as a teaser — will come from
// GetLockedAchievements RPC once backend exposes it.
const LOCKED_TEASER: Array<{
  key: string
  title: string
  description: string
  progress: number
  goal: number
}> = [
  {
    key: 'ten_streak',
    title: '10-дневный стрик',
    description: 'Закрыть дейлик 10 дней подряд',
    progress: 7,
    goal: 10,
  },
  {
    key: 'season_boss',
    title: 'Убийца сезонного босса',
    description: 'Пройти финальное испытание сезона',
    progress: 0,
    goal: 1,
  },
  {
    key: 'hundred_tasks',
    title: 'Сотня побеждённых',
    description: 'Решить 100 задач с вердиктом ACCEPTED',
    progress: 42,
    goal: 100,
  },
  {
    key: 'guild_war_win',
    title: 'Триумфальная гильдейская',
    description: 'Выиграть гильдейскую войну',
    progress: 0,
    goal: 1,
  },
  {
    key: 'mock_perfect',
    title: 'Чистое прохождение',
    description: 'Получить 95+ в AI-моке без AI-подсказок',
    progress: 78,
    goal: 95,
  },
]

export default function AchievementsPage() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const { data: season } = useSeasonQuery()

  const earned = profile?.achievements ?? []
  const cosmetics = (season?.checkpoints ?? []).filter(
    (c) => c.reward_kind === 'avatar_frame' || c.reward_kind === 'cosmetic',
  )
  const titles = (season?.checkpoints ?? []).filter(
    (c) => c.reward_kind === 'title',
  )

  return (
    <AppShell>
      <PageHeader
        title={t('achievements.title')}

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
          <PanelHead subtitle="EARNED">{t('achievements.earned')}</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {earned.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.empty')}
              </div>
            )}
            {earned.map((a) => {
              const rar = achievementRarity(a.key)
              const stroke = RARITY_STROKE[rar]
              return (
                <div
                  key={a.key}
                  className="ach-card"
                  style={{
                    position: 'relative',
                    padding: 12,
                    border: `1px solid ${stroke}`,
                    background:
                      'linear-gradient(180deg, rgba(10,12,16,0.8), rgba(20,16,15,0.9))',
                    boxShadow: `0 0 8px 0 color-mix(in srgb, ${stroke} 35%, transparent)`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <svg width={46} height={46} viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
                    {/* Glow */}
                    <defs>
                      <radialGradient id={`ach-g-${a.key}`} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={stroke} stopOpacity="0.85" />
                        <stop offset="100%" stopColor={stroke} stopOpacity="0.05" />
                      </radialGradient>
                    </defs>
                    <circle cx="23" cy="23" r="21" fill={`url(#ach-g-${a.key})`} opacity="0.45" />
                    {/* Rotated square (rarity frame) */}
                    <rect
                      x="10"
                      y="10"
                      width="26"
                      height="26"
                      transform="rotate(45 23 23)"
                      fill="var(--bg-void)"
                      stroke={stroke}
                      strokeWidth="1.5"
                    />
                    <rect
                      x="14"
                      y="14"
                      width="18"
                      height="18"
                      transform="rotate(45 23 23)"
                      fill={stroke}
                      opacity="0.85"
                    />
                    <text
                      x="23"
                      y="27"
                      textAnchor="middle"
                      fontSize="12"
                      fontFamily="var(--font-display)"
                      fill="var(--bg-void)"
                      fontWeight="700"
                    >
                      ✦
                    </text>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="heraldic"
                      style={{
                        color: stroke,
                        fontSize: 12,
                      }}
                    >
                      {a.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-mid)',
                        marginTop: 2,
                      }}
                    >
                      {a.description}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 4,
                      }}
                    >
                      <span
                        className="caps"
                        style={{ color: stroke, fontSize: 8 }}
                      >
                        {rar}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 9,
                          color: 'var(--text-dim)',
                        }}
                      >
                        {a.earned_at.slice(0, 10)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Locked panel — teaser under Earned */}
          <div
            style={{
              padding: '0 20px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              className="caps"
              style={{
                color: 'var(--text-mid)',
                letterSpacing: '0.25em',
                marginTop: 4,
              }}
            >
              Locked · прогресс
            </div>
            {LOCKED_TEASER.map((l) => {
              const pct = Math.min(100, (l.progress / l.goal) * 100)
              return (
                <InsetGroove key={l.key}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      opacity: 0.85,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        transform: 'rotate(45deg)',
                        border: '1px dashed var(--gold-dim)',
                        background: 'var(--bg-inset)',
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          transform: 'rotate(-45deg)',
                          color: 'var(--gold-dim)',
                          fontSize: 14,
                        }}
                      >
                        🔒
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="heraldic"
                        style={{
                          color: 'var(--text-mid)',
                          fontSize: 11,
                        }}
                      >
                        {l.title}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--text-dim)',
                          marginTop: 1,
                        }}
                      >
                        {l.description}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 5,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            background: 'var(--bg-inset)',
                            border: '1px solid var(--gold-faint)',
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background:
                                'linear-gradient(90deg, var(--ember-deep), var(--ember-lit))',
                            }}
                          />
                        </div>
                        <span
                          className="mono"
                          style={{
                            fontSize: 9,
                            color: 'var(--text-mid)',
                            minWidth: 40,
                            textAlign: 'right',
                          }}
                        >
                          {l.progress}/{l.goal}
                        </span>
                      </div>
                    </div>
                  </div>
                </InsetGroove>
              )
            })}
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel>
            <PanelHead subtitle="COSMETICS">
              {t('achievements.cosmetics')}
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <InsetGroove>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 4 }}
                >
                  {t('achievements.avatar_frame')}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--gold-bright)',
                  }}
                >
                  {profile?.avatar_frame ??
                    /* STUB: no frame equipped */ '—'}
                </div>
              </InsetGroove>
              {cosmetics.map((c) => (
                <InsetGroove key={c.tier}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        transform: 'rotate(45deg)',
                        background: c.done ? 'var(--gold)' : 'var(--bg-inset)',
                        border: '1px solid var(--gold-dim)',
                      }}
                    />
                    <div style={{ flex: 1, fontSize: 12 }}>{c.reward}</div>
                    <Badge variant="dim">T{c.tier}</Badge>
                    {c.done && <Badge variant="gold">owned</Badge>}
                  </div>
                </InsetGroove>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="TITLES">
              {t('achievements.title_label')}
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <InsetGroove>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 4 }}
                >
                  Equipped
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--gold-bright)',
                  }}
                >
                  {profile?.title ?? '—'}
                </div>
              </InsetGroove>
              {titles.map((c) => (
                <InsetGroove key={c.tier}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: c.done
                          ? 'var(--gold-bright)'
                          : 'var(--text-mid)',
                      }}
                    >
                      {c.reward}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Badge variant="dim">T{c.tier}</Badge>
                      {c.done && <Badge variant="gold">owned</Badge>}
                    </div>
                  </div>
                </InsetGroove>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}
