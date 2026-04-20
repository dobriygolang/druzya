import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Button,
  InsetGroove,
  GuildEmblem,
} from '../components/chrome'
import { useMyGuildQuery, useGuildWarQuery } from '../lib/queries/guild'

export default function GuildPage() {
  const { t } = useTranslation()
  const { data: guild } = useMyGuildQuery()
  const { data: war } = useGuildWarQuery(guild?.id)

  return (
    <AppShell>
      <PageHeader
        title={t('guild.title')}
        subtitle={t('guild.subtitle')}
        right={
          guild && (
            <Badge variant="gold">
              {t('guild.elo')} {guild.guild_elo}
            </Badge>
          )
        }
      />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="GUILD">Гильдия</PanelHead>
          <div style={{ padding: 20 }}>
            {guild ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    marginBottom: 18,
                  }}
                >
                  <GuildEmblem size={64} glyph="⚔" />
                  <div>
                    <div
                      className="heraldic"
                      style={{
                        color: 'var(--gold-bright)',
                        fontSize: 18,
                      }}
                    >
                      {guild.name}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--text-mid)',
                      }}
                    >
                      {guild.emblem}
                    </div>
                  </div>
                </div>

                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 8 }}
                >
                  {t('guild.members')} · {guild.members.length}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {guild.members.map((m) => (
                    <InsetGroove key={m.user_id}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <MemberAvatar username={m.username} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--text-bright)',
                            }}
                          >
                            {m.username}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--text-mid)',
                            }}
                          >
                            {m.role} · {m.assigned_section}
                          </div>
                        </div>
                        <ContributionSparkline userId={m.user_id} />
                      </div>
                    </InsetGroove>
                  ))}
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
          <PanelHead subtitle="GUILD WAR">{t('guild.war')}</PanelHead>
          {war ? (
            <div style={{ padding: 20 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <div>
                  <div
                    className="heraldic"
                    style={{ color: 'var(--gold-bright)', fontSize: 14 }}
                  >
                    {war.guild_a.name}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--text-mid)' }}
                  >
                    {war.guild_a.emblem}
                  </div>
                </div>
                <div
                  className="heraldic"
                  style={{
                    color: 'var(--blood-lit)',
                    fontSize: 22,
                    letterSpacing: '0.2em',
                  }}
                >
                  VS
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    className="heraldic"
                    style={{ color: 'var(--gold-bright)', fontSize: 14 }}
                  >
                    {war.guild_b.name}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--text-mid)' }}
                  >
                    {war.guild_b.emblem}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {war.lines.map((line) => {
                  const total = line.score_a + line.score_b || 1
                  return (
                    <div key={line.section}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          className="mono"
                          style={{ color: 'var(--gold-bright)' }}
                        >
                          {line.score_a}
                        </span>
                        <span
                          className="caps"
                          style={{ color: 'var(--gold-dim)' }}
                        >
                          {t(`sections.${line.section}`, line.section)}
                        </span>
                        <span
                          className="mono"
                          style={{ color: 'var(--blood-lit)' }}
                        >
                          {line.score_b}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          height: 10,
                          border: '1px solid #000',
                          background: 'var(--bg-inset)',
                        }}
                      >
                        <div
                          style={{
                            width: `${(line.score_a / total) * 100}%`,
                            background:
                              'linear-gradient(180deg, var(--gold-bright), var(--gold))',
                          }}
                        />
                        <div
                          style={{
                            flex: 1,
                            background:
                              'linear-gradient(180deg, var(--blood-bright), var(--blood))',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div
                style={{
                  marginTop: 16,
                  fontSize: 11,
                  color: 'var(--text-mid)',
                }}
              >
                Неделя: {war.week_start} — {war.week_end}
              </div>

              <div style={{ marginTop: 14 }}>
                <Button tone="blood">{t('guild.contribute')}</Button>
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, color: 'var(--text-dim)' }}>
              {t('common.loading')}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  )
}

/** FNV-1a 32-bit — stable per-username hash. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Hex-shield avatar with a color derived from username hash + initial. */
function MemberAvatar({ username }: { username: string }) {
  const PALETTE = [
    ['#6a9fd4', '#1a3a6a'],
    ['#e09b3a', '#3a1f08'],
    ['#c22222', '#3a0909'],
    ['#7f77dd', '#1a1040'],
    ['#1d9e75', '#04180f'],
    ['#c8a96e', '#2a2318'],
    ['#b9a6ff', '#1a0f2a'],
  ]
  const h = hash(username)
  const [stroke, fill] = PALETTE[h % PALETTE.length]
  const initial = username.charAt(0).toUpperCase()
  return (
    <svg width={30} height={34} viewBox="0 0 30 34" style={{ flexShrink: 0 }}>
      <polygon
        points="15,2 27,6 27,24 15,32 3,24 3,6"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.3"
      />
      <polygon
        points="15,5 24,9 24,23 15,29 6,23 6,9"
        fill="none"
        stroke={stroke}
        strokeWidth="0.4"
        opacity="0.4"
      />
      <text
        x="15"
        y="21"
        textAnchor="middle"
        fill={stroke}
        fontFamily="var(--font-display)"
        fontSize="13"
        letterSpacing="0.04em"
      >
        {initial}
      </text>
    </svg>
  )
}

/**
 * 7-day contribution sparkline.
 * Bars derived from hash(userId) — deterministic pseudo-data until the
 * backend exposes `GetGuildMemberContributions`.
 */
function ContributionSparkline({ userId }: { userId: string }) {
  const bars = 7
  const seed = hash(userId)
  // Deterministic PRNG — xorshift32.
  let s = seed || 0xdeadbeef
  const rand = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s >>>= 0
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
  const values = Array.from({ length: bars }, () => 0.25 + rand() * 0.75)
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
        flexShrink: 0,
      }}
      title={`contributions · last ${bars} days`}
    >
      <svg width={48} height={16} viewBox={`0 0 ${bars * 6} 16`}>
        {values.map((v, i) => (
          <rect
            key={i}
            x={i * 6 + 0.5}
            y={16 - v * 14}
            width="4.5"
            height={v * 14}
            fill="var(--gold)"
            opacity={0.35 + v * 0.65}
          />
        ))}
      </svg>
      <span
        className="mono"
        style={{
          fontSize: 9,
          color: 'var(--text-mid)',
          letterSpacing: '0.1em',
        }}
      >
        {Math.round(total * 100)}
      </span>
    </div>
  )
}
