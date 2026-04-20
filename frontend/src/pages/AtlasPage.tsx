import { useMemo, useState } from 'react'
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
import { SkillTree } from '../components/SkillTree'
import { useAtlasQuery, type AtlasNode } from '../lib/queries/profile'

const SECTION_COLOR: Record<string, string> = {
  algorithms: 'var(--sec-algo-accent)',
  sql: 'var(--sec-sql-accent)',
  go: 'var(--sec-go-accent)',
  system_design: 'var(--sec-sd-accent)',
  behavioral: 'var(--sec-beh-accent)',
}

export default function AtlasPage() {
  const { t } = useTranslation()
  const { data: atlas, isLoading } = useAtlasQuery()
  const [selected, setSelected] = useState<string | null>(null)

  const selectedNode: AtlasNode | undefined = useMemo(
    () => atlas?.nodes.find((n) => n.key === selected),
    [atlas, selected],
  )

  // Auto-select center node once data arrives, so the right panel isn't empty.
  const effectiveSelected =
    selected ?? atlas?.center_node ?? null
  const effectiveSelectedNode: AtlasNode | undefined =
    selectedNode ?? atlas?.nodes.find((n) => n.key === atlas?.center_node)

  const totals = useMemo(() => {
    const list = atlas?.nodes ?? []
    return {
      unlocked: list.filter((n) => n.unlocked).length,
      total: list.length,
      decaying: list.filter((n) => n.decaying).length,
    }
  }, [atlas])

  return (
    <AppShell>
      <PageHeader
        title={t('atlas.title')}

        right={
          <div
            style={{
              display: 'flex',
              gap: 10,
              fontFamily: 'var(--font-code)',
              fontSize: 11,
              letterSpacing: '0.2em',
              color: 'var(--text-mid)',
              textTransform: 'uppercase',
            }}
          >
            <span>
              <span style={{ color: 'var(--text-mid)' }}>Узлы&nbsp;</span>
              <span style={{ color: 'var(--gold-bright)' }}>
                {totals.unlocked} / {totals.total}
              </span>
            </span>
            {totals.decaying > 0 && (
              <span>
                <span style={{ color: 'var(--text-mid)' }}>Декей&nbsp;</span>
                <span style={{ color: 'var(--blood-lit)' }}>
                  {totals.decaying}
                </span>
              </span>
            )}
          </div>
        }
      />

      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="SKILL ATLAS">Древо навыков</PanelHead>
          <div style={{ padding: 12 }}>
            <SkillTree
              atlas={atlas}
              isLoading={isLoading}
              selected={effectiveSelected}
              onSelect={setSelected}
            />
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-code)',
                fontSize: 10,
                color: 'var(--text-dim)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              <span>⎇ ТАЩИ · ⌁ КОЛЕСО · ◉ КЛИК</span>
              <span>Path · ветви · краеугольные</span>
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel>
            <PanelHead subtitle="NODE">Узел</PanelHead>
            <div style={{ padding: 16 }}>
              {effectiveSelectedNode ? (
                <>
                  <div
                    className="heraldic"
                    style={{ color: 'var(--gold-bright)', fontSize: 14 }}
                  >
                    {effectiveSelectedNode.title}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color:
                        SECTION_COLOR[effectiveSelectedNode.section] ??
                        'var(--gold)',
                      letterSpacing: '0.2em',
                      marginTop: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t(
                      `sections.${effectiveSelectedNode.section}`,
                      effectiveSelectedNode.section,
                    )}
                    {' · '}
                    {effectiveSelectedNode.kind}
                  </div>
                  <InsetGroove style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12 }}>
                      {effectiveSelectedNode.description ||
                        /* STUB: node has no description in API */ '—'}
                    </div>
                  </InsetGroove>
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        color: 'var(--text-mid)',
                      }}
                    >
                      <span>прогресс</span>
                      <span>{effectiveSelectedNode.progress}%</span>
                    </div>
                    <Bar
                      value={effectiveSelectedNode.progress}
                      max={100}
                      tone="ember"
                    />
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    {effectiveSelectedNode.unlocked ? (
                      <Badge variant="normal">{t('atlas.unlocked')}</Badge>
                    ) : (
                      <Badge variant="dim">{t('atlas.locked')}</Badge>
                    )}
                    {effectiveSelectedNode.decaying && (
                      <Badge variant="blood">{t('atlas.decaying')}</Badge>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-dim)' }}>
                  Выбери узел на древе
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="LEGEND">{t('atlas.legend')}</PanelHead>
            <div
              style={{
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 11,
              }}
            >
              <LegendRow
                shape="hex"
                color="var(--gold-bright)"
                label="Асцендант — центр пути"
              />
              <LegendRow
                shape="hex"
                color="var(--gold)"
                label="Краеугольный (keystone)"
              />
              <LegendRow
                shape="circle"
                color="var(--ember-lit)"
                label="Обычный узел"
              />
              <LegendRow
                shape="circle"
                color="var(--blood-lit)"
                label={t('atlas.decaying')}
                pulse
              />
              <LegendRow
                shape="circle"
                color="var(--metal-lit)"
                label={t('atlas.locked')}
                dim
              />
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

function LegendRow({
  shape,
  color,
  label,
  dim,
  pulse,
}: {
  shape: 'circle' | 'hex'
  color: string
  label: string
  dim?: boolean
  pulse?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <svg width={18} height={18} viewBox="-10 -10 20 20">
        {shape === 'hex' ? (
          <polygon
            points="0,-8 7,-4 7,4 0,8 -7,4 -7,-4"
            fill="var(--bg-card)"
            stroke={color}
            strokeWidth={1.5}
            className={pulse ? 'atlas-decay' : undefined}
          />
        ) : (
          <circle
            r={6}
            fill="var(--bg-card)"
            stroke={color}
            strokeWidth={1.4}
            className={pulse ? 'atlas-decay' : undefined}
          />
        )}
      </svg>
      <span style={{ color: 'var(--text-bright)' }}>{label}</span>
    </div>
  )
}
