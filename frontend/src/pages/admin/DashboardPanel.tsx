import { useAdminDashboardQuery } from '../../lib/queries/admin'
import { useCompaniesQuery } from '../../lib/queries/mockAdmin'
import { ErrorBox, PanelSkeleton, StatCard, fmt, type Tab } from './shared'

export function DashboardPanel({ setTab }: { setTab?: (t: Tab) => void }) {
  const { data, isPending, error } = useAdminDashboardQuery()
  // First-run signal: zero mock companies = admin still hasn't seeded
  // a single interview pipeline. Show a 3-step welcome wizard instead
  // of just hard numbers, so the admin gets pointed to the entry path.
  const companies = useCompaniesQuery()
  const showWizard = companies.isSuccess && (companies.data?.length ?? 0) === 0

  if (isPending) {
    return <PanelSkeleton rows={4} />
  }
  if (error || !data) {
    return <ErrorBox message="Не удалось загрузить статистику" />
  }
  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      {showWizard && setTab && <WelcomeWizard onJump={setTab} />}
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

// WelcomeWizard — показывается только если нет ни одной mock-компании.
// Три кнопки сразу прыгают на нужную вкладку, чтобы первый заход admin
// не упёрся в «куда дальше?». Дисмиснуть нельзя — wizard сам исчезнет
// как только появится первая компания.
function WelcomeWizard({ onJump }: { onJump: (t: Tab) => void }) {
  const steps: Array<{
    n: string
    title: string
    body: string
    cta: string
    target: Tab
  }> = [
    {
      n: '1',
      title: 'Создай компанию',
      body: 'Каждая компания = свой набор этапов и стиль вопросов. Минимально нужен один pipeline.',
      cta: 'Открыть компании',
      target: 'mock_companies',
    },
    {
      n: '2',
      title: 'Засей задачи и вопросы',
      body: 'Алгоритмы / coding / sysdesign — задачи. HR / behavioral — вопросы. Можно загрузить bulk JSON.',
      cta: 'Открыть задачи',
      target: 'mock_tasks',
    },
    {
      n: '3',
      title: 'Настрой строгость AI',
      body: 'Профиль строгости управляет тем, насколько жёстко судья снижает score. Дефолт уже есть — можно открыть и подстроить под свой стиль.',
      cta: 'Открыть строгость',
      target: 'mock_strictness',
    },
  ]
  return (
    <section className="rounded-xl border border-text-primary/30 bg-text-primary/[0.04] p-5">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          first-run setup
        </span>
        <h2 className="mt-1 font-display text-lg font-bold text-text-primary">
          Mock-собесы ещё не настроены
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Пройди три шага — и юзеры смогут пройти первый mock-собес.
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <li
            key={s.n}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-text-primary/10 font-display text-sm font-bold text-text-primary">
              {s.n}
            </span>
            <span className="font-display text-sm font-bold text-text-primary">{s.title}</span>
            <span className="text-[12px] text-text-secondary">{s.body}</span>
            <button
              type="button"
              onClick={() => onJump(s.target)}
              className="mt-auto self-start rounded-md border border-border-strong bg-surface-2 px-3 py-1 font-mono text-[11px] text-text-primary hover:bg-surface-3"
            >
              {s.cta} →
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
