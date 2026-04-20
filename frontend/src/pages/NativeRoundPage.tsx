import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Bar,
  Button,
  InsetGroove,
} from '../components/chrome'
import {
  useNativeScoreQuery,
  useProvenanceQuery,
} from '../lib/queries/native'
import { ProvenanceGraph, AiDonut } from '../components/native/ProvenanceGraph'

export default function NativeRoundPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { t } = useTranslation()
  const { data: score } = useNativeScoreQuery(sessionId)
  const { data: prov } = useProvenanceQuery(sessionId)

  // STUB: chat input is client-only — AI chat submit endpoint not yet in MSW
  const [aiInput, setAiInput] = useState('')

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20 }}>
        <PageHeader
          title={t('native.title')}
          subtitle={t('native.subtitle')}
          right={
            <Badge variant="ember">
              {score ? `${Math.round(score.ai_fraction * 100)}% AI` : '—'}
            </Badge>
          }
        />
        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 20,
            alignItems: 'flex-start',
          }}
        >
          {/* Provenance Graph */}
          <Panel>
            <PanelHead subtitle="PROVENANCE">{t('native.provenance')}</PanelHead>
            <div style={{ padding: 20 }}>
              {!prov ? (
                <div style={{ color: 'var(--text-dim)' }}>
                  {t('common.loading')}
                </div>
              ) : (
                <>
                  <ProvenanceGraph nodes={prov.nodes} />
                  <div
                    style={{
                      display: 'flex',
                      gap: 18,
                      marginTop: 14,
                      fontSize: 10,
                      letterSpacing: '0.15em',
                      color: 'var(--text-mid)',
                    }}
                  >
                    <LegendSwatch color="var(--gold)" label="HUMAN" />
                    <LegendSwatch color="var(--blood-lit)" label="AI" />
                    <LegendSwatch color="var(--tier-normal)" label="TEST" />
                    <LegendSwatch color="var(--ember-lit)" label="MERGE" />
                  </div>
                </>
              )}
            </div>
          </Panel>

          {/* AI Assistant + gates */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
          >
            <Panel>
              <PanelHead subtitle="ASSISTANT">{t('native.assistant')}</PanelHead>
              <div style={{ padding: 16 }}>
                <InsetGroove style={{ minHeight: 140 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-mid)',
                      marginBottom: 10,
                    }}
                  >
                    {/* STUB: AI chat history wire-up pending */}
                    Задай вопрос AI — но помни, что доля AI влияет на итоговый балл.
                  </div>
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="Спроси AI..."
                    style={{
                      width: '100%',
                      minHeight: 60,
                      padding: 8,
                      background: 'var(--bg-inset)',
                      border: '1px solid var(--gold-dim)',
                      color: 'var(--text-bright)',
                      fontFamily: 'var(--font-code)',
                      fontSize: 12,
                      resize: 'vertical',
                    }}
                  />
                </InsetGroove>
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <Button tone="primary" size="sm">
                    Спросить AI
                  </Button>
                  <Button tone="ghost" size="sm">
                    Отклонить подсказку
                  </Button>
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHead subtitle="SCORES">Балл</PanelHead>
              <div
                style={{
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {score ? (
                  <>
                    <ScoreRow
                      label={t('native.authorship')}
                      value={score.scores.authorship}
                    />
                    <ScoreRow
                      label={t('native.comprehension')}
                      value={score.scores.comprehension}
                    />
                    <ScoreRow
                      label={t('native.refactor_quality')}
                      value={score.scores.refactor_quality}
                    />
                    <ScoreRow
                      label={t('native.coverage')}
                      value={score.scores.coverage}
                    />
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 14,
                        borderTop: '1px solid var(--gold-faint)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-around',
                      }}
                    >
                      <AiDonut
                        value={score.ai_fraction}
                        size={96}
                        label={t('native.ai_fraction').toUpperCase()}
                      />
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          fontSize: 11,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <span style={{ color: 'var(--text-mid)' }}>
                            {t('native.human_fraction')}
                          </span>
                          <span className="mono" style={{ color: 'var(--gold)' }}>
                            {Math.round(score.human_fraction * 100)}%
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <span style={{ color: 'var(--text-mid)' }}>
                            {t('native.ai_fraction')}
                          </span>
                          <span className="mono" style={{ color: 'var(--blood-lit)' }}>
                            {Math.round(score.ai_fraction * 100)}%
                          </span>
                        </div>
                      </div>
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
              <PanelHead subtitle="GATES">{t('native.gates')}</PanelHead>
              <div
                style={{
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {(score?.gates ?? []).map((g) => (
                  <div
                    key={g.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Badge variant={g.passed ? 'normal' : 'boss'}>
                      {g.passed ? t('native.pass') : t('native.fail')}
                    </Badge>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-bright)' }}>
                        {g.key}
                      </div>
                      {g.note && (
                        <div
                          style={{ fontSize: 10, color: 'var(--text-mid)' }}
                        >
                          {g.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          background: color,
          transform: 'rotate(45deg)',
          display: 'inline-block',
        }}
      />
      <span>{label}</span>
    </span>
  )
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
        }}
      >
        <span style={{ color: 'var(--text-mid)' }}>{label}</span>
        <span className="mono" style={{ color: 'var(--gold-bright)' }}>
          {value}
        </span>
      </div>
      <Bar value={value} max={100} />
    </div>
  )
}
