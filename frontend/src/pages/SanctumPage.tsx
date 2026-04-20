import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
import { useProfileQuery } from '../lib/queries/profile'
import {
  useDailyKataQuery,
  useStreakQuery,
  useCalendarQuery,
} from '../lib/queries/daily'
import { useRatingMeQuery } from '../lib/queries/rating'
import { useFeed } from '../lib/useFeed'

export default function SanctumPage() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const { data: kata } = useDailyKataQuery()
  const { data: streak } = useStreakQuery()
  const { data: calendar } = useCalendarQuery()
  const { data: rating } = useRatingMeQuery()
  const { events: feed, status: feedStatus } = useFeed()

  return (
    <AppShell>
      <PageHeader title={t('sanctum.title')} />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="DAILY QUESTS">{t('sanctum.quests')}</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {kata ? (
              <InsetGroove>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Badge
                    variant={kata.task.difficulty === 'easy' ? 'normal' : 'hard'}
                  >
                    {kata.task.difficulty}
                  </Badge>
                  <div style={{ flex: 1 }}>
                    <div
                      className="heraldic"
                      style={{ color: 'var(--gold-bright)', fontSize: 13 }}
                    >
                      {kata.task.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-mid)',
                        marginTop: 4,
                      }}
                    >
                      {kata.task.description}
                    </div>
                  </div>
                  <Link to="/daily" style={{ textDecoration: 'none' }}>
                    <Button tone="primary" size="sm">
                      {t('daily.kata')}
                    </Button>
                  </Link>
                </div>
              </InsetGroove>
            ) : (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.loading')}
              </div>
            )}

            {calendar?.today.map((todo, i) => (
              <InsetGroove key={i}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    opacity: todo.done ? 0.5 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      border: '1px solid var(--gold)',
                      background: todo.done ? 'var(--gold)' : 'transparent',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-bright)', fontSize: 12 }}>
                      {todo.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>
                      ~{todo.estimated_min} мин · {todo.kind}
                    </div>
                  </div>
                </div>
              </InsetGroove>
            ))}
          </div>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel>
            <PanelHead subtitle="HERO">Герой</PanelHead>
            <div style={{ padding: 16 }}>
              <div
                className="heraldic"
                style={{ color: 'var(--gold-bright)', fontSize: 15 }}
              >
                {profile?.display_name ?? '—'}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--gold)',
                  letterSpacing: '0.2em',
                  marginTop: 4,
                }}
              >
                {profile?.title?.toUpperCase() ?? ''}
              </div>
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: 'var(--text-mid)',
                    marginBottom: 4,
                  }}
                >
                  <span>XP</span>
                  <span>
                    {profile?.xp ?? 0} / {profile?.xp_to_next ?? 0}
                  </span>
                </div>
                <Bar value={profile?.xp ?? 0} max={profile?.xp_to_next ?? 1} />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Badge variant="gold">
                  GPS {profile?.global_power_score ?? '—'}
                </Badge>
                <Badge variant="ember">{profile?.ai_credits ?? 0} credits</Badge>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead subtitle="STREAK">{t('daily.streak')}</PanelHead>
            <div style={{ padding: 16 }}>
              <div
                className="heraldic"
                style={{
                  color: 'var(--blood-lit)',
                  fontSize: 28,
                  letterSpacing: '0.1em',
                }}
              >
                {streak?.current ?? 0}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-mid)',
                  marginTop: 4,
                }}
              >
                {t('daily.streak')} · рекорд {streak?.longest ?? 0}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(15, 1fr)',
                  gap: 2,
                  marginTop: 10,
                }}
              >
                {(streak?.history ?? []).slice(-30).map((d, i) => (
                  <span
                    key={i}
                    style={{
                      height: 8,
                      background:
                        d === true
                          ? 'var(--gold)'
                          : d === false
                            ? 'var(--bg-inset)'
                            : 'var(--gold-dim)',
                      opacity: d === null ? 0.35 : 1,
                    }}
                  />
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <Panel style={{ gridColumn: '1 / -1' }}>
          <PanelHead subtitle="LIVE FEED">
            {t('sanctum.feed')} ·{' '}
            <span
              className="mono"
              style={{
                color:
                  feedStatus === 'open'
                    ? 'var(--tier-normal)'
                    : feedStatus === 'connecting'
                      ? 'var(--ember-lit)'
                      : 'var(--blood-lit)',
              }}
            >
              {feedStatus}
            </span>
          </PanelHead>
          <div style={{ padding: 12, maxHeight: 180, overflow: 'auto' }}>
            {feed.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', padding: 8 }}>
                {t('common.empty')}
              </div>
            ) : (
              feed.map((e, i) => (
                <div
                  key={`${e.at}-${i}`}
                  style={{
                    padding: '6px 10px',
                    borderBottom:
                      i < feed.length - 1
                        ? '1px solid var(--gold-faint)'
                        : 'none',
                    fontSize: 12,
                    color: 'var(--text-bright)',
                  }}
                >
                  <span style={{ color: 'var(--text-mid)', marginRight: 10 }}>
                    {new Date(e.at).toLocaleTimeString('ru-RU')}
                  </span>
                  {e.text}
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel style={{ gridColumn: '1 / -1' }}>
          <PanelHead subtitle="MISSIONS">{t('sanctum.missions')}</PanelHead>
          <div style={{ padding: 20 }}>
            {calendar ? (
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
                    style={{ color: 'var(--gold-bright)', fontSize: 15 }}
                  >
                    {calendar.role}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    {calendar.company_id} · {calendar.interview_date}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10,
                      color: 'var(--text-mid)',
                      marginBottom: 4,
                    }}
                  >
                    <span>{t('daily.readiness')}</span>
                    <span>{calendar.readiness_pct}%</span>
                  </div>
                  <Bar value={calendar.readiness_pct} max={100} tone="ember" />
                </div>
                <Badge variant="blood">{calendar.days_left} дн</Badge>
              </div>
            ) : (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.empty')}
              </div>
            )}
            {rating && (
              <div style={{ marginTop: 20 }}>
                <div
                  className="caps"
                  style={{ color: 'var(--gold-dim)', marginBottom: 8 }}
                >
                  Power Score · история
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 3,
                    height: 50,
                  }}
                >
                  {rating.history.map((h, i) => {
                    const hMax = Math.max(
                      ...rating.history.map((x) => x.global_power_score),
                    )
                    const pct = (h.global_power_score / hMax) * 100
                    return (
                      <span
                        key={i}
                        title={`${h.week_start}: ${h.global_power_score}`}
                        style={{
                          flex: 1,
                          height: `${pct}%`,
                          background: 'var(--gold)',
                          opacity: 0.4 + i * 0.05,
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}
