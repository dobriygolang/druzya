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
} from '../components/chrome'
import { usePodcastCatalogQuery } from '../lib/queries/codex'

export default function CodexPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<string | 'all'>('all')
  const { data } = usePodcastCatalogQuery()

  const episodes =
    (data?.episodes ?? []).filter(
      (e) => section === 'all' || e.section === section,
    ) ?? []

  return (
    <AppShell>
      <PageHeader title={t('codex.title')} subtitle={t('codex.subtitle')} />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="SECTIONS">Разделы</PanelHead>
          <div
            style={{
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <button
              onClick={() => setSection('all')}
              className={`tab ${section === 'all' ? 'active' : ''}`}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                color:
                  section === 'all'
                    ? 'var(--gold-bright)'
                    : 'var(--text-mid)',
                background:
                  section === 'all'
                    ? 'rgba(200,169,110,0.06)'
                    : 'transparent',
                borderLeft:
                  section === 'all'
                    ? '2px solid var(--gold)'
                    : '2px solid transparent',
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: '0.15em',
              }}
            >
              Все · {data?.episodes.length ?? 0}
            </button>
            {(data?.sections ?? []).map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`tab ${section === s.key ? 'active' : ''}`}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  color:
                    section === s.key
                      ? 'var(--gold-bright)'
                      : 'var(--text-mid)',
                  background:
                    section === s.key
                      ? 'rgba(200,169,110,0.06)'
                      : 'transparent',
                  borderLeft:
                    section === s.key
                      ? '2px solid var(--gold)'
                      : '2px solid transparent',
                  fontFamily: 'var(--font-display)',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                }}
              >
                {s.title} · {s.count}
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead subtitle="PODCASTS">{t('codex.podcasts')}</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {episodes.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.empty')}
              </div>
            )}
            {episodes.map((ep) => (
              <InsetGroove key={ep.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      background:
                        'radial-gradient(circle at 30% 30%, var(--bg-panel), var(--bg-inset))',
                      border: '1px solid var(--gold-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--gold)',
                      fontSize: 24,
                    }}
                  >
                    ◉
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      className="heraldic"
                      style={{ color: 'var(--gold-bright)', fontSize: 13 }}
                    >
                      {ep.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-mid)',
                        marginTop: 2,
                      }}
                    >
                      {ep.description}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Badge variant="dim">
                        {ep.duration_min} мин
                      </Badge>
                      <Badge variant="ember">{ep.section}</Badge>
                      {ep.listened && <Badge variant="normal">listened</Badge>}
                    </div>
                  </div>
                  <Button
                    tone="primary"
                    size="sm"
                    onClick={() => {
                      // STUB: player wiring pending
                    }}
                  >
                    {t('codex.listen')}
                  </Button>
                </div>
              </InsetGroove>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}
