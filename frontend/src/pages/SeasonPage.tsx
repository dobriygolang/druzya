import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Bar,
  InsetGroove,
} from '../components/chrome'
import { useSeasonQuery } from '../lib/queries/season'

export default function SeasonPage() {
  const { t } = useTranslation()
  const { data: season } = useSeasonQuery()

  return (
    <AppShell>
      <PageHeader
        title={t('season.title')}
        subtitle={t('season.subtitle')}
        right={
          season && <Badge variant="blood">{season.title}</Badge>
        }
      />
      {!season ? (
        <div style={{ color: 'var(--text-dim)' }}>{t('common.loading')}</div>
      ) : (
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
            <PanelHead subtitle="TIER">{t('season.current_tier')}</PanelHead>
            <div style={{ padding: 20 }}>
              <div
                className="heraldic"
                style={{
                  color: 'var(--gold-bright)',
                  fontSize: 48,
                  letterSpacing: '0.1em',
                }}
              >
                T{season.current_tier}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-mid)',
                  marginTop: 4,
                }}
              >
                из {season.tier_max} · {season.current_sp} SP
              </div>
              <div style={{ marginTop: 12 }}>
                <Bar
                  value={season.current_tier}
                  max={season.tier_max}
                  tone="gold"
                  tall
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 8 }}
                >
                  {t('season.modifiers')}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {season.modifiers.map((m) => (
                    <InsetGroove key={m.key}>
                      <div
                        className="heraldic"
                        style={{ color: 'var(--blood-lit)', fontSize: 12 }}
                      >
                        {m.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-mid)',
                          marginTop: 2,
                        }}
                      >
                        {m.description}
                      </div>
                    </InsetGroove>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="REWARD TRACK">
              {t('season.reward_track')}
            </PanelHead>
            <div style={{ padding: 20 }}>
              <div
                style={{
                  position: 'relative',
                  paddingLeft: 16,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 21,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: 'var(--gold-dim)',
                  }}
                />
                {season.checkpoints.map((c) => (
                  <div
                    key={c.tier}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '10px 0',
                    }}
                  >
                    <div
                      style={{
                        width: c.big ? 22 : 14,
                        height: c.big ? 22 : 14,
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
                          ? '0 0 0 3px rgba(200,169,110,0.2)'
                          : 'none',
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        className="heraldic"
                        style={{
                          color: 'var(--gold-dim)',
                          fontSize: 10,
                          letterSpacing: '0.2em',
                        }}
                      >
                        TIER {c.tier}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: c.done
                            ? 'var(--gold-bright)'
                            : 'var(--text-bright)',
                        }}
                      >
                        {c.reward}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--text-mid)',
                          marginTop: 2,
                        }}
                      >
                        {c.reward_kind}
                      </div>
                    </div>
                    {c.current && <Badge variant="ember">текущий</Badge>}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
