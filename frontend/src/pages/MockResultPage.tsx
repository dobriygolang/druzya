import { useParams } from 'react-router-dom'
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
import { useMockReportQuery } from '../lib/queries/mock'

export default function MockResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { t } = useTranslation()
  const { data: report } = useMockReportQuery(sessionId)

  return (
    <AppShell>
      <PageHeader
        title={t('mock_result.title')}
        subtitle={t('mock_result.subtitle')}
      />
      {!report ? (
        <div style={{ color: 'var(--text-dim)' }}>{t('common.loading')}</div>
      ) : (
        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            alignItems: 'flex-start',
          }}
        >
          <Panel style={{ gridColumn: '1 / -1' }}>
            <PanelHead subtitle="OVERALL">{t('mock_result.overall')}</PanelHead>
            <div
              style={{
                padding: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 24,
              }}
            >
              <div
                className="heraldic"
                style={{
                  fontSize: 64,
                  color: 'var(--gold-bright)',
                  letterSpacing: '0.1em',
                }}
              >
                {report.overall_score}
              </div>
              <div style={{ flex: 1 }}>
                <Bar value={report.overall_score} max={100} tone="gold" tall />
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: 'var(--text-mid)',
                  }}
                >
                  {report.stress_analysis}
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="SECTIONS">Разделы</PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {Object.entries(report.sections).map(([k, v]) => (
                <InsetGroove key={k}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}
                  >
                    <span
                      className="caps"
                      style={{ color: 'var(--gold)' }}
                    >
                      {k.replace(/_/g, ' ')}
                    </span>
                    <span
                      className="mono"
                      style={{ color: 'var(--gold-bright)' }}
                    >
                      {v.score}
                    </span>
                  </div>
                  <Bar value={v.score} max={100} />
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: 'var(--text-mid)',
                    }}
                  >
                    {v.comment}
                  </div>
                </InsetGroove>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="STRENGTHS & WEAKNESSES">
              Сильные / слабые
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
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
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                >
                  {report.strengths.map((s) => (
                    <Badge key={s} variant="normal">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <div
                  className="caps"
                  style={{ color: 'var(--blood-lit)', marginBottom: 6 }}
                >
                  {t('profile.weaknesses')}
                </div>
                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                >
                  {report.weaknesses.map((w) => (
                    <Badge key={w} variant="blood">
                      {w}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <div
                  className="caps"
                  style={{ color: 'var(--ember-lit)', marginBottom: 6 }}
                >
                  {t('profile.recommendations')}
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {report.recommendations.map((r, i) => (
                    <InsetGroove key={i}>
                      <div style={{ fontSize: 12 }}>{r.title}</div>
                    </InsetGroove>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
