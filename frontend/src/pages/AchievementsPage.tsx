import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  InsetGroove,
} from '../components/chrome'
import { useProfileQuery } from '../lib/queries/profile'
import { useSeasonQuery } from '../lib/queries/season'

export default function AchievementsPage() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const { data: season } = useSeasonQuery()

  const earned = profile?.achievements ?? []
  const cosmetics = (season?.checkpoints ?? []).filter(
    (c) => c.reward_kind === 'avatar_frame' || c.reward_kind === 'cosmetic',
  )
  const titles = (season?.checkpoints ?? []).filter(
    (c) => c.reward_kind === 'title',
  )

  return (
    <AppShell>
      <PageHeader
        title={t('achievements.title')}
        subtitle={t('achievements.subtitle')}
      />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="EARNED">{t('achievements.earned')}</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {earned.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.empty')}
              </div>
            )}
            {earned.map((a) => (
              <InsetGroove key={a.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      background:
                        'radial-gradient(circle at 30% 30%, var(--gold), var(--gold-dim))',
                      transform: 'rotate(45deg)',
                      border: '1px solid var(--gold)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      className="heraldic"
                      style={{
                        color: 'var(--gold-bright)',
                        fontSize: 12,
                      }}
                    >
                      {a.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-mid)',
                        marginTop: 2,
                      }}
                    >
                      {a.description}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 9,
                        color: 'var(--text-dim)',
                        marginTop: 2,
                      }}
                    >
                      {a.earned_at.slice(0, 10)}
                    </div>
                  </div>
                </div>
              </InsetGroove>
            ))}
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel>
            <PanelHead subtitle="COSMETICS">
              {t('achievements.cosmetics')}
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <InsetGroove>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 4 }}
                >
                  {t('achievements.avatar_frame')}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--gold-bright)',
                  }}
                >
                  {profile?.avatar_frame ??
                    /* STUB: no frame equipped */ '—'}
                </div>
              </InsetGroove>
              {cosmetics.map((c) => (
                <InsetGroove key={c.tier}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        transform: 'rotate(45deg)',
                        background: c.done ? 'var(--gold)' : 'var(--bg-inset)',
                        border: '1px solid var(--gold-dim)',
                      }}
                    />
                    <div style={{ flex: 1, fontSize: 12 }}>{c.reward}</div>
                    <Badge variant="dim">T{c.tier}</Badge>
                    {c.done && <Badge variant="gold">owned</Badge>}
                  </div>
                </InsetGroove>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="TITLES">
              {t('achievements.title_label')}
            </PanelHead>
            <div
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <InsetGroove>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 4 }}
                >
                  Equipped
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--gold-bright)',
                  }}
                >
                  {profile?.title ?? '—'}
                </div>
              </InsetGroove>
              {titles.map((c) => (
                <InsetGroove key={c.tier}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: c.done
                          ? 'var(--gold-bright)'
                          : 'var(--text-mid)',
                      }}
                    >
                      {c.reward}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Badge variant="dim">T{c.tier}</Badge>
                      {c.done && <Badge variant="gold">owned</Badge>}
                    </div>
                  </div>
                </InsetGroove>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}
