import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Button,
  InsetGroove,
  Bar,
} from '../components/chrome'
import { useArenaMatchQuery } from '../lib/queries/arena'
import { useLeaderboardQuery, type SectionKey } from '../lib/queries/rating'

const ACTIVE_MATCH_ID = '11111111-1111-1111-1111-111111111111'

/**
 * Bible §3.4 + §3.2 — Arena is a hub of game modes, not a single match
 * viewer. We surface 6 modes (1v1, 2v2, AI-Mock, AI-Native, Solo, Tournament)
 * each as a card with status + CTA. Leaderboard sits on the right; the
 * currently-active match (if any) is a "Resume" strip on top.
 */

type ModeKey =
  | 'duel_1v1'
  | 'duel_2v2'
  | 'ai_mock'
  | 'ai_native'
  | 'solo'
  | 'tournament'

type ModeStatus = 'live' | 'beta' | 'soon'

type Mode = {
  key: ModeKey
  title: string
  tagline: string
  description: string
  href?: string
  /** Path to navigate to when CTA pressed; falls back to ACTIVE_MATCH_ID for live duel. */
  cta: string
  status: ModeStatus
  /** Stylistic tone — affects glow/border accent. */
  accent: string
  sigil: JSX.Element
}

const MODES: Mode[] = [
  {
    key: 'duel_1v1',
    title: 'Дуэль 1×1',
    tagline: 'Ranked duel · ELO',
    description:
      'Один задача, один противник, общий таймер. Победитель — тот, у кого первое решение пройдёт все тест-кейсы.',
    href: `/arena/match/${ACTIVE_MATCH_ID}`, // placeholder, falls back below
    cta: 'Найти противника',
    status: 'live',
    accent: 'var(--blood-lit)',
    sigil: (
      <>
        <path
          d="M20 4 L26 16 L20 28 L14 16 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
        />
        <path d="M14 16 L26 16" stroke="currentColor" strokeWidth="1.2" />
      </>
    ),
  },
  {
    key: 'duel_2v2',
    title: 'Кооп 2×2',
    tagline: 'Squad ladder · team-ELO',
    description:
      'Две пары игроков, разные секции, общий пул баллов. Зови напарника или матчмейкер подберёт.',
    cta: 'Скоро',
    status: 'soon',
    accent: 'var(--sec-sd-accent)',
    sigil: (
      <>
        <circle cx="14" cy="20" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <circle cx="26" cy="20" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </>
    ),
  },
  {
    key: 'ai_mock',
    title: 'AI-Mock интервью',
    tagline: 'Full mock · 5 sections',
    description:
      'AI ведёт полноценный mock-интервью: задаёт follow-ups, оценивает стресс, выставляет баллы по 4 шкалам.',
    cta: 'Начать сессию',
    href: '/mock/demo-session-1',
    status: 'beta',
    accent: 'var(--sec-algo-accent)',
    sigil: (
      <>
        <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path
          d="M14 18 Q20 14 26 18 Q26 22 20 22 L18 26"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="20" cy="29" r="1" fill="currentColor" />
      </>
    ),
  },
  {
    key: 'ai_native',
    title: 'AI-Native раунд',
    tagline: 'Pair-prog with AI · provenance',
    description:
      'Пишешь код вместе с AI, всё фиксируется в provenance graph. Финальный балл учитывает долю авторства.',
    cta: 'Открыть раунд',
    href: '/native/demo-round-1',
    status: 'beta',
    accent: 'var(--ember-lit)',
    sigil: (
      <>
        <path
          d="M20 4 L36 20 L20 36 L4 20 Z"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
        />
        <circle cx="20" cy="20" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="20" cy="20" r="2" fill="currentColor" />
      </>
    ),
  },
  {
    key: 'solo',
    title: 'Соло-задачи',
    tagline: 'By topic · grind mode',
    description:
      'Тренируешь конкретную тему: алгоритмы, SQL, Go-rumetal, system design. Без таймера, можно с подсказками.',
    cta: 'Открыть атлас',
    href: '/atlas',
    status: 'live',
    accent: 'var(--sec-sql-accent)',
    sigil: (
      <>
        <rect x="6" y="14" width="6" height="20" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <rect x="17" y="8" width="6" height="26" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <rect x="28" y="20" width="6" height="14" stroke="currentColor" strokeWidth="1.3" fill="none" />
      </>
    ),
  },
  {
    key: 'tournament',
    title: 'Турнир',
    tagline: 'Bracket · async',
    description:
      'Сезонный кубок: bracket из 16 игроков, дни на каждый матч, бонус-награды по итогам.',
    cta: 'Скоро',
    status: 'soon',
    accent: 'var(--rarity-divine)',
    sigil: (
      <>
        <path
          d="M10 4 L30 4 L30 14 Q30 22 20 24 Q10 22 10 14 Z"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
        />
        <rect x="14" y="24" width="12" height="2" fill="currentColor" />
        <rect x="12" y="30" width="16" height="3" fill="currentColor" opacity="0.7" />
        <line x1="6" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.2" />
        <line x1="30" y1="8" x2="34" y2="8" stroke="currentColor" strokeWidth="1.2" />
      </>
    ),
  },
]

const STATUS_BADGE: Record<ModeStatus, { label: string; tone: string }> = {
  live: { label: 'LIVE', tone: 'var(--tier-normal)' },
  beta: { label: 'BETA', tone: 'var(--ember-lit)' },
  soon: { label: 'SOON', tone: 'var(--text-mid)' },
}

export default function ArenaPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionKey>('algorithms')
  const { data: activeMatch } = useArenaMatchQuery(ACTIVE_MATCH_ID)
  const { data: lb } = useLeaderboardQuery(section)

  return (
    <AppShell>
      <PageHeader
        title={t('arena.title')}
        subtitle="Все режимы боёв"
      />

      {/* Active match strip — only shown if there's an in-progress duel. */}
      {activeMatch && (
        <Panel style={{ marginBottom: 20 }}>
          <div
            style={{
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--blood-lit)',
                boxShadow: '0 0 8px var(--blood-bright)',
                animation: 'sigil-aura 2s ease-in-out infinite',
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                className="caps"
                style={{
                  color: 'var(--blood-lit)',
                  fontSize: 9,
                  letterSpacing: '0.3em',
                }}
              >
                Активная дуэль
              </div>
              <div
                className="heraldic"
                style={{
                  color: 'var(--gold-bright)',
                  fontSize: 14,
                  marginTop: 2,
                }}
              >
                {activeMatch.task.title} ·{' '}
                <span
                  className="mono"
                  style={{ color: 'var(--text-mid)', fontSize: 11 }}
                >
                  {Math.round(activeMatch.task.time_limit_sec)}s left
                </span>
              </div>
            </div>
            <Link
              to={`/arena/match/${ACTIVE_MATCH_ID}`}
              style={{ textDecoration: 'none' }}
            >
              <Button tone="primary">Продолжить</Button>
            </Link>
          </div>
        </Panel>
      )}

      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        {/* Mode grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {MODES.map((m) => (
            <ModeCard key={m.key} mode={m} />
          ))}
        </div>

        {/* Leaderboard */}
        <Panel>
          <PanelHead>Таблица лидеров</PanelHead>
          <div style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 0,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              {(
                ['algorithms', 'sql', 'go', 'system_design', 'behavioral'] as SectionKey[]
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  style={{
                    padding: '6px 10px',
                    fontFamily: 'var(--font-display)',
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    color: section === s ? 'var(--gold-bright)' : 'var(--text-mid)',
                    background: 'transparent',
                    borderBottom:
                      section === s
                        ? '1px solid var(--gold)'
                        : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  {t(`sections.${s}`)}
                </button>
              ))}
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {(lb?.entries ?? []).slice(0, 10).map((e) => {
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
                        ? `linear-gradient(90deg, color-mix(in srgb, ${rankColor} 14%, var(--bg-inset)), var(--bg-inset))`
                        : 'var(--bg-inset)',
                      border: `1px solid ${
                        top ? rankColor : 'var(--gold-faint)'
                      }`,
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        fontFamily: 'var(--font-display)',
                        color: rankColor,
                        fontSize: 12,
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
                        fontSize: 12,
                      }}
                    >
                      {e.username}
                      {e.title && (
                        <span
                          style={{
                            color: 'var(--ember-lit)',
                            marginLeft: 8,
                            fontSize: 9,
                          }}
                        >
                          · {e.title}
                        </span>
                      )}
                    </span>
                    <span
                      className="mono"
                      style={{ color: 'var(--gold-bright)', fontSize: 12 }}
                    >
                      {e.elo}
                    </span>
                  </div>
                )
              })}
            </div>
            {lb?.my_rank && (
              <InsetGroove style={{ marginTop: 12 }}>
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
              </InsetGroove>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}

function ModeCard({ mode }: { mode: Mode }) {
  const { label, tone } = STATUS_BADGE[mode.status]
  const disabled = mode.status === 'soon'
  const inner = (
    <div
      className={disabled ? '' : 'tile-button'}
      style={{
        position: 'relative',
        padding: 16,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background:
          'linear-gradient(180deg, rgba(13,14,18,0.95), rgba(10,12,16,0.95))',
        border: `1px solid ${disabled ? 'var(--gold-faint)' : mode.accent}`,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow: disabled
          ? 'none'
          : `0 0 16px 0 color-mix(in srgb, ${mode.accent} 18%, transparent)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <svg
          width={36}
          height={36}
          viewBox="0 0 40 40"
          style={{
            color: mode.accent,
            filter: disabled
              ? 'none'
              : `drop-shadow(0 0 6px ${mode.accent})`,
          }}
          aria-hidden
        >
          {mode.sigil}
        </svg>
        <span
          style={{
            fontFamily: 'var(--font-code)',
            fontSize: 9,
            letterSpacing: '0.2em',
            color: tone,
            border: `1px solid ${tone}`,
            padding: '2px 6px',
          }}
        >
          {label}
        </span>
      </div>
      <div>
        <div
          className="heraldic"
          style={{
            color: 'var(--gold-bright)',
            fontSize: 15,
            letterSpacing: '0.1em',
          }}
        >
          {mode.title}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: mode.accent,
            letterSpacing: '0.15em',
            marginTop: 2,
            textTransform: 'uppercase',
          }}
        >
          {mode.tagline}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-mid)',
          lineHeight: 1.5,
          flex: 1,
        }}
      >
        {mode.description}
      </div>
      <div style={{ marginTop: 4 }}>
        <Button
          tone={disabled ? 'ghost' : mode.status === 'live' ? 'blood' : 'primary'}
          disabled={disabled}
          size="sm"
        >
          {mode.cta}
        </Button>
      </div>
    </div>
  )
  if (disabled || !mode.href) return inner
  return (
    <Link to={mode.href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  )
}

/* ---- avatar helper, reused from prior ArenaPage version ---- */

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function ShieldAvatar({
  seed,
  compact = false,
}: {
  seed: string
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
  const [stroke, fill] = PALETTE[h % PALETTE.length]
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
