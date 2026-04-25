import { useAdminDashboardQuery } from '../../lib/queries/admin'
import { ErrorBox, PanelSkeleton, StatCard, fmt } from './shared'

export function DashboardPanel() {
  const { data, isPending, error } = useAdminDashboardQuery()
  if (isPending) {
    return <PanelSkeleton rows={4} />
  }
  if (error || !data) {
    return <ErrorBox message="Не удалось загрузить статистику" />
  }
  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Пользователи</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Всего" value={fmt(data.users_total)} />
          <StatCard label="Активных сегодня" value={fmt(data.users_active_today)} color="text-success" />
          <StatCard label="За неделю" value={fmt(data.users_active_week)} />
          <StatCard label="За месяц" value={fmt(data.users_active_month)} />
          <StatCard label="Забанено" value={fmt(data.users_banned)} color={data.users_banned > 0 ? 'text-danger' : 'text-text-muted'} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Активность</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Матчей сегодня" value={fmt(data.matches_today)} />
          <StatCard label="Матчей за неделю" value={fmt(data.matches_week)} />
          <StatCard label="Kata сегодня" value={fmt(data.katas_today)} />
          <StatCard label="Kata за неделю" value={fmt(data.katas_week)} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Сейчас идут</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Mock-сессий" value={fmt(data.active_mock_sessions)} color="text-text-secondary" />
          <StatCard label="Активных матчей" value={fmt(data.active_arena_matches)} color="text-text-secondary" />
          <StatCard label="Anti-cheat сигналов 24ч" value={fmt(data.anticheat_signals_24h)} color={data.anticheat_signals_24h > 0 ? 'text-warn' : 'text-text-muted'} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">Очередь модерации</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <StatCard
            label="Жалоб на рассмотрении"
            value={fmt(data.reports_pending)}
            color={data.reports_pending > 0 ? 'text-warn' : 'text-text-muted'}
          />
        </div>
      </section>
      <p className="mt-1 font-mono text-[10px] text-text-muted">
        Снимок от {new Date(data.generated_at).toLocaleString('ru-RU')}
      </p>
    </div>
  )
}
