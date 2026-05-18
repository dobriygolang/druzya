// FocusActivityCard — 24-часовая активность юзера на cross-surface
// уровне. Закрывает gap: до этого web Coach не показывал что юзер делает
// в Hone (focus blitzes / pomodoros / vocab review / speaking attempts).
//
// Данные приходят из `intelligence.user-context.recent_activity` —
// агрегация которая уже скармливалась Hone DailyBriefPanel, но в web
// surface'е была невидима. Хук `useRecentActivity24hQuery` живёт в
// lib/queries/intelligence.ts.
//
// Пустой день → card не рендерится (anti-fallback: бессмысленно
// показывать ряд нулей).

import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'

import { useRecentActivity24hQuery } from '../lib/queries/intelligence'

export function FocusActivityCard() {
  const { t } = useTranslation('common')
  const { data, isLoading, isError } = useRecentActivity24hQuery()

  // Loading или error → silently hide. Card opt-in: показывается ТОЛЬКО
  // когда есть данные. Это не critical surface — Today имеет свои якорные
  // карточки (DailyBrief, Mock, Coach insight).
  if (isLoading || isError || !data) return null

  // Если все счётчики нули — день пустой, не шумим карточкой.
  const isEmpty =
    data.focusSessionsCount === 0 &&
    data.tasksDone === 0 &&
    data.mockAttempts === 0 &&
    data.notesCreated === 0 &&
    data.readingMinutes === 0 &&
    data.speakingAttempts === 0 &&
    data.vocabReviewed === 0
  if (isEmpty) return null

  // Метрики, которые имеют ненулевое значение — показываем. Порядок:
  // focus → tasks → mock → notes → reading → speaking → vocab.
  const metrics: Array<{ key: string; label: string; value: string }> = []

  if (data.focusSessionsCount > 0) {
    metrics.push({
      key: 'focus',
      label: t('focus_activity.focus'),
      value: `${data.focusSessionsCount} · ${data.focusMinutesTotal} ${t('focus_activity.min_short')}`,
    })
  }
  if (data.tasksDone > 0) {
    metrics.push({
      key: 'tasks',
      label: t('focus_activity.tasks'),
      value: String(data.tasksDone),
    })
  }
  if (data.mockAttempts > 0) {
    metrics.push({
      key: 'mock',
      label: t('focus_activity.mock'),
      value:
        data.lastMockResult > 0
          ? `${data.mockAttempts} · ${data.lastMockResult}%`
          : String(data.mockAttempts),
    })
  }
  if (data.notesCreated > 0) {
    metrics.push({
      key: 'notes',
      label: t('focus_activity.notes'),
      value: String(data.notesCreated),
    })
  }
  if (data.readingMinutes > 0) {
    metrics.push({
      key: 'reading',
      label: t('focus_activity.reading'),
      value: `${data.readingMinutes} ${t('focus_activity.min_short')}`,
    })
  }
  if (data.speakingAttempts > 0) {
    metrics.push({
      key: 'speaking',
      label: t('focus_activity.speaking'),
      value:
        data.speakingAvgScore > 0
          ? `${data.speakingAttempts} · ${Math.round(data.speakingAvgScore)}%`
          : String(data.speakingAttempts),
    })
  }
  if (data.vocabReviewed > 0) {
    metrics.push({
      key: 'vocab',
      label: t('focus_activity.vocab'),
      value: String(data.vocabReviewed),
    })
  }

  return (
    <section className="flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-text-secondary" aria-hidden />
        <h2 className="font-display text-base font-semibold text-text-primary">
          {t('focus_activity.title')}
        </h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('focus_activity.window')}
        </span>
      </header>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <li
            key={m.key}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2"
          >
            <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
              {m.label}
            </div>
            <div className="mt-1 font-display text-[15px] font-semibold text-text-primary">
              {m.value}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
