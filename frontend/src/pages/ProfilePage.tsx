import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Bar,
  InsetGroove,
  CharacterPortrait,
} from '../components/chrome'
import {
  useProfileQuery,
  useWeeklyReportQuery,
} from '../lib/queries/profile'
import { useRatingMeQuery } from '../lib/queries/rating'

export default function ProfilePage() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const { data: report } = useWeeklyReportQuery()
  const { data: rating } = useRatingMeQuery()

  return (
    <AppShell>
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="IDENTITY">Идентичность</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <CharacterPortrait size={180} level={profile?.level ?? 1} />
            <div
              className="heraldic"
              style={{ color: 'var(--gold-bright)', fontSize: 18 }}
            >
              {profile?.display_name ?? '—'}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                color: 'var(--gold)',
                letterSpacing: '0.25em',
              }}
            >
              {profile?.title?.toUpperCase() ?? ''}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge variant="gold">LVL {profile?.level ?? 1}</Badge>
              <Badge variant="ember">
                GPS {profile?.global_power_score ?? 0}
              </Badge>
              <Badge variant="dim">{profile?.career_stage ?? '—'}</Badge>
            </div>
            <InsetGroove style={{ width: '100%' }}>
              <div
                className="caps"
                style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
              >
                Subscription
              </div>
              <div style={{ fontSize: 12 }}>
                {profile?.subscription.plan ?? '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>
                до {profile?.subscription.current_period_end.slice(0, 10)}
              </div>
            </InsetGroove>
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel>
            <PanelHead subtitle="RATINGS">Рейтинг по разделам</PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {(rating?.ratings ?? []).map((r) => (
                <div key={r.section}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ color: 'var(--text-bright)' }}>
                      {t(`sections.${r.section}`)}
                    </span>
                    <span
                      className="mono"
                      style={{ color: 'var(--gold-bright)' }}
                    >
                      {r.elo}
                      {r.decaying && (
                        <span
                          style={{
                            color: 'var(--blood-lit)',
                            marginLeft: 6,
                          }}
                        >
                          decay
                        </span>
                      )}
                    </span>
                  </div>
                  <Bar value={r.percentile} max={100} />
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--text-mid)',
                      marginTop: 2,
                    }}
                  >
                    p{r.percentile} · {r.matches_count} матчей
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="WEEKLY REPORT">
              {t('profile.weekly_report')}
            </PanelHead>
            {report ? (
              <div style={{ padding: 20 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <MetricCell
                    label="tasks"
                    value={report.metrics.tasks_solved}
                  />
                  <MetricCell
                    label="wins"
                    value={report.metrics.matches_won}
                  />
                  <MetricCell
                    label="ΔELO"
                    value={report.metrics.rating_change}
                  />
                  <MetricCell label="XP" value={report.metrics.xp_earned} />
                  <MetricCell
                    label="min"
                    value={report.metrics.time_minutes}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div
                    className="caps"
                    style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
                  >
                    Heatmap (ежедневные активности)
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {report.heatmap.map((v, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: 28,
                          background: 'var(--bg-inset)',
                          border: '1px solid var(--gold-faint)',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'var(--gold)',
                            opacity: Math.min(1, v / 5),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 20,
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <div
                      className="caps"
                      style={{ color: 'var(--gold)', marginBottom: 6 }}
                    >
                      {t('profile.strengths')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      {report.strengths.map((s) => (
                        <InsetGroove key={s}>
                          <span style={{ fontSize: 12 }}>{s}</span>
                        </InsetGroove>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div
                      className="caps"
                      style={{
                        color: 'var(--blood-lit)',
                        marginBottom: 6,
                      }}
                    >
                      {t('profile.weaknesses')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      {report.weaknesses.map((w) => (
                        <InsetGroove key={w.atlas_node_key}>
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--blood-lit)',
                            }}
                          >
                            {w.atlas_node_key}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text-mid)',
                            }}
                          >
                            {w.reason}
                          </div>
                        </InsetGroove>
                      ))}
                    </div>
                  </div>
                </div>

                <InsetGroove>
                  <div
                    className="caps"
                    style={{ color: 'var(--ember-lit)', marginBottom: 6 }}
                  >
                    Stress Analysis
                  </div>
                  <div style={{ fontSize: 12 }}>{report.stress_analysis}</div>
                </InsetGroove>

                <div style={{ marginTop: 14 }}>
                  <div
                    className="caps"
                    style={{ color: 'var(--gold)', marginBottom: 6 }}
                  >
                    {t('profile.recommendations')}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {report.recommendations.map((r, i) => (
                      <InsetGroove key={i}>
                        <div style={{ fontSize: 12 }}>{r.title}</div>
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-dim)',
                          }}
                        >
                          action: {r.action.kind}
                        </div>
                      </InsetGroove>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: 20, color: 'var(--text-dim)' }}>
                {t('common.loading')}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <InsetGroove style={{ textAlign: 'center' }}>
      <div
        className="mono"
        style={{ fontSize: 20, color: 'var(--gold-bright)' }}
      >
        {value}
      </div>
      <div
        className="caps"
        style={{ color: 'var(--gold-dim)', marginTop: 2 }}
      >
        {label}
      </div>
    </InsetGroove>
  )
}
