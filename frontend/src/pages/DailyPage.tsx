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
      <PageHeader title={t('daily.title')} />
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
                  {/* Flame icon — bigger as streak grows */}
                  <svg
                    width={52}
                    height={64}
                    viewBox="0 0 52 64"
                    style={{
                      flexShrink: 0,
                      animation:
                        'streak-flame 1.8s ease-in-out infinite',
                      filter:
                        'drop-shadow(0 0 8px rgba(224,155,58,0.55))',
                    }}
                    aria-hidden
                  >
                    <defs>
                      <linearGradient id="flame-outer" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#c22222" />
                        <stop offset="60%" stopColor="#e09b3a" />
                        <stop offset="100%" stopColor="#f5c56b" />
                      </linearGradient>
                      <linearGradient id="flame-inner" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#e09b3a" />
                        <stop offset="100%" stopColor="#fff5c5" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M26 62 C6 62, 2 42, 14 28 C16 36, 22 36, 22 28 C22 16, 30 14, 30 4 C44 14, 50 26, 50 40 C50 54, 40 62, 26 62 Z"
                      fill="url(#flame-outer)"
                    />
                    <path
                      d="M26 58 C14 58, 12 46, 20 38 C22 42, 26 42, 26 36 C26 30, 32 28, 32 22 C40 30, 42 38, 42 44 C42 52, 36 58, 26 58 Z"
                      fill="url(#flame-inner)"
                    />
                  </svg>
                  <div
                    className="heraldic"
                    style={{
                      color: 'var(--blood-lit)',
                      fontSize: 54,
                      letterSpacing: '0.05em',
                      lineHeight: 1,
                      textShadow: '0 0 10px rgba(194,34,34,0.35)',
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
                            gap: 12,
                            opacity: t2.done ? 0.6 : 1,
                          }}
                        >
                          <WaxSeal done={t2.done} />
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                textDecoration: t2.done
                                  ? 'line-through'
                                  : 'none',
                                textDecorationColor:
                                  'var(--gold-dim)',
                              }}
                            >
                              {t2.title}
                            </div>
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

/**
 * Wax-seal stamp.
 * Unpressed: dim circular groove. Pressed (done): crimson wax with gold sigil,
 * stamp-down keyframe runs once on mount.
 */
function WaxSeal({ done }: { done: boolean }) {
  if (!done) {
    return (
      <span
        aria-label="todo"
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          border: '1px dashed var(--gold-dim)',
          background: 'var(--bg-inset)',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
    )
  }
  return (
    <span
      aria-label="done"
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        display: 'inline-block',
        animation: 'wax-stamp 260ms ease-out',
        transformOrigin: 'center',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <defs>
          <radialGradient id="wax-grad" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#e83838" />
            <stop offset="65%" stopColor="#8a1414" />
            <stop offset="100%" stopColor="#3a0909" />
          </radialGradient>
        </defs>
        {/* Scalloped wax disc — 8 lobes */}
        <path
          d="M10 0.8 L11.7 2.4 L13.9 2 L14.8 4 L17 4.5 L17 6.7 L18.9 8.1 L18.2 10.2 L19.2 12.2 L17.8 13.7 L17.6 16 L15.4 16.2 L14 18 L11.9 17.3 L10 18.9 L8.1 17.3 L6 18 L4.6 16.2 L2.4 16 L2.2 13.7 L0.8 12.2 L1.8 10.2 L1.1 8.1 L3 6.7 L3 4.5 L5.2 4 L6.1 2 L8.3 2.4 Z"
          fill="url(#wax-grad)"
          stroke="#e8c87a"
          strokeWidth="0.3"
        />
        {/* Gold sigil — 4-point star */}
        <path
          d="M10 4 L11 9 L16 10 L11 11 L10 16 L9 11 L4 10 L9 9 Z"
          fill="#e8c87a"
          opacity="0.92"
        />
      </svg>
    </span>
  )
}
