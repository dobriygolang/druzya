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
  useDailyKataQuery,
  useStreakQuery,
  useCalendarQuery,
} from '../lib/queries/daily'

export default function DailyPage() {
  const { t } = useTranslation()
  const { data: kata } = useDailyKataQuery()
  const { data: streak } = useStreakQuery()
  const { data: calendar } = useCalendarQuery()

  return (
    <AppShell>
      <PageHeader title={t('daily.title')} subtitle={t('daily.subtitle')} />
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
          <PanelHead subtitle="KATA">{t('daily.kata')}</PanelHead>
          <div style={{ padding: 20 }}>
            {kata ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Badge
                    variant={kata.task.difficulty === 'easy' ? 'normal' : 'hard'}
                  >
                    {kata.task.difficulty}
                  </Badge>
                  <Badge variant="dim">{kata.task.section}</Badge>
                  {kata.is_cursed && <Badge variant="boss">cursed</Badge>}
                  {kata.is_weekly_boss && (
                    <Badge variant="boss">weekly boss</Badge>
                  )}
                </div>
                <div
                  className="heraldic"
                  style={{ color: 'var(--gold-bright)', fontSize: 16 }}
                >
                  {kata.task.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-bright)',
                    marginTop: 8,
                  }}
                >
                  {kata.task.description}
                </div>
                <InsetGroove style={{ marginTop: 12 }}>
                  {kata.task.example_cases.map((c, i) => (
                    <div
                      key={i}
                      className="mono"
                      style={{ fontSize: 12 }}
                    >
                      <span style={{ color: 'var(--text-mid)' }}>in: </span>
                      {c.input}
                      <br />
                      <span style={{ color: 'var(--gold-bright)' }}>out: </span>
                      {c.output}
                    </div>
                  ))}
                </InsetGroove>
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <Button
                    tone="primary"
                    disabled={kata.already_submitted}
                  >
                    {kata.already_submitted ? 'Уже сдано' : 'Решать'}
                  </Button>
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
          <PanelHead subtitle="STREAK">{t('daily.streak')}</PanelHead>
          <div style={{ padding: 20 }}>
            {streak ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 16,
                  }}
                >
                  <div
                    className="heraldic"
                    style={{
                      color: 'var(--blood-lit)',
                      fontSize: 54,
                      letterSpacing: '0.05em',
                      lineHeight: 1,
                    }}
                  >
                    {streak.current}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    дней подряд · рекорд {streak.longest}
                    <br />
                    freeze-токены: {streak.freeze_tokens}
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(15, 1fr)',
                    gap: 3,
                    marginTop: 14,
                  }}
                >
                  {streak.history.slice(-30).map((d, i) => (
                    <span
                      key={i}
                      title={
                        d === true
                          ? 'done'
                          : d === false
                            ? 'miss'
                            : 'frozen'
                      }
                      style={{
                        height: 14,
                        background:
                          d === true
                            ? 'var(--gold)'
                            : d === false
                              ? 'var(--bg-inset)'
                              : 'var(--ember-deep)',
                        border: '1px solid var(--gold-faint)',
                      }}
                    />
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

        <Panel style={{ gridColumn: '1 / -1' }}>
          <PanelHead subtitle="INTERVIEW CALENDAR">
            {t('daily.calendar')}
          </PanelHead>
          <div style={{ padding: 20 }}>
            {calendar ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div
                      className="heraldic"
                      style={{ color: 'var(--gold-bright)', fontSize: 16 }}
                    >
                      {calendar.role}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-mid)',
                        marginTop: 2,
                      }}
                    >
                      {calendar.company_id} · {calendar.interview_date}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: 'var(--text-mid)',
                      }}
                    >
                      <span>{t('daily.readiness')}</span>
                      <span>{calendar.readiness_pct}%</span>
                    </div>
                    <Bar
                      value={calendar.readiness_pct}
                      max={100}
                      tone="ember"
                      tall
                    />
                  </div>
                  <Badge variant="blood">{calendar.days_left} дн</Badge>
                </div>

                <div style={{ marginTop: 20 }}>
                  <div
                    className="caps"
                    style={{ color: 'var(--gold-dim)', marginBottom: 8 }}
                  >
                    На сегодня
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {calendar.today.map((t2, i) => (
                      <InsetGroove key={i}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            opacity: t2.done ? 0.5 : 1,
                          }}
                        >
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              border: '1px solid var(--gold)',
                              background: t2.done
                                ? 'var(--gold)'
                                : 'transparent',
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12 }}>{t2.title}</div>
                            <div
                              style={{
                                fontSize: 10,
                                color: 'var(--text-mid)',
                              }}
                            >
                              ~{t2.estimated_min} мин · {t2.kind}
                            </div>
                          </div>
                        </div>
                      </InsetGroove>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <div
                    className="caps"
                    style={{ color: 'var(--blood-lit)', marginBottom: 8 }}
                  >
                    Слабые зоны
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {calendar.weak_zones.map((z) => (
                      <Badge
                        key={z.atlas_node_key}
                        variant={z.priority === 'high' ? 'boss' : 'hard'}
                      >
                        {z.atlas_node_key}
                      </Badge>
                    ))}
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
      </div>
    </AppShell>
  )
}
