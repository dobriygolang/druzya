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
              <ScoreGlyph value={report.overall_score} />
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

          {/* Follow-ups — questions the AI would ask if you advanced past
              this round. STUB: hardcoded until backend exposes follow_ups
              on MockReport. */}
          <Panel style={{ gridColumn: '1 / -1' }}>
            <PanelHead subtitle="FOLLOW-UPS">
              Уточняющие вопросы AI
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 10,
              }}
            >
              {[
                {
                  q: 'Как изменится сложность при k > n?',
                  hint: 'edge case · O-нотация',
                },
                {
                  q: 'Что выберешь — hash map или sort + two pointers?',
                  hint: 'trade-off · pattern',
                },
                {
                  q: 'Как протестируешь на пустом массиве?',
                  hint: 'edge case · TDD',
                },
                {
                  q: 'Расскажи как закэшировать промежуточные результаты',
                  hint: 'memo · perf',
                },
              ].map((f, i) => (
                <InsetGroove key={i}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <span
                      className="heraldic"
                      style={{
                        color: 'var(--ember-lit)',
                        fontSize: 11,
                        flexShrink: 0,
                        width: 18,
                      }}
                    >
                      Q{i + 1}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-bright)' }}>
                        {f.q}
                      </div>
                      <div
                        className="caps"
                        style={{
                          fontSize: 9,
                          color: 'var(--text-dim)',
                          marginTop: 4,
                        }}
                      >
                        {f.hint}
                      </div>
                    </div>
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

/**
 * Score wrapped in a hex-shield glyph frame.
 * Color tier picks itself: <60 crimson, <80 amber, ≥80 gold.
 */
function ScoreGlyph({ value }: { value: number }) {
  const tier =
    value >= 80
      ? { stroke: 'var(--gold-bright)', fill: 'var(--gold)' }
      : value >= 60
        ? { stroke: 'var(--ember-lit)', fill: 'var(--ember)' }
        : { stroke: 'var(--blood-lit)', fill: 'var(--blood)' }
  return (
    <div
      style={{
        position: 'relative',
        width: 130,
        height: 145,
        flexShrink: 0,
      }}
    >
      <svg width={130} height={145} viewBox="0 0 130 145">
        <defs>
          <radialGradient id="score-glyph-glow" cx="50%" cy="55%" r="55%">
            <stop offset="0%" stopColor={tier.fill} stopOpacity="0.55" />
            <stop offset="100%" stopColor={tier.fill} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="score-glyph-border" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tier.stroke} />
            <stop offset="100%" stopColor={tier.fill} />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width="130"
          height="145"
          fill="url(#score-glyph-glow)"
        />
        {/* Outer hex shield */}
        <polygon
          points="65,4 122,30 122,115 65,141 8,115 8,30"
          fill="var(--bg-stone)"
          stroke="url(#score-glyph-border)"
          strokeWidth="1.8"
        />
        {/* Inner hex */}
        <polygon
          points="65,16 110,38 110,107 65,129 20,107 20,38"
          fill="none"
          stroke={tier.stroke}
          strokeWidth="0.6"
          opacity="0.4"
        />
        {/* Top + bottom ornaments */}
        <line
          x1="55"
          y1="6"
          x2="75"
          y2="6"
          stroke={tier.stroke}
          strokeWidth="1.5"
        />
        <line
          x1="55"
          y1="139"
          x2="75"
          y2="139"
          stroke={tier.stroke}
          strokeWidth="1.5"
        />
        <text
          x="65"
          y="78"
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontSize="48"
          fontWeight="700"
          fill={tier.stroke}
          letterSpacing="0.05em"
          style={{ filter: `drop-shadow(0 0 6px ${tier.fill})` }}
        >
          {value}
        </text>
        <text
          x="65"
          y="100"
          textAnchor="middle"
          fontSize="9"
          fill="var(--text-mid)"
          letterSpacing="0.3em"
        >
          / 100
        </text>
      </svg>
    </div>
  )
}
