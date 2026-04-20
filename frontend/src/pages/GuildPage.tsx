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
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--gold-dim)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--gold-bright)',
                            fontFamily: 'var(--font-display)',
                          }}
                        >
                          {m.username.charAt(0).toUpperCase()}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12 }}>{m.username}</div>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--text-mid)',
                            }}
                          >
                            {m.role} · {m.assigned_section}
                          </div>
                        </div>
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
