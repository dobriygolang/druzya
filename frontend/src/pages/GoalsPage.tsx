// /goals — Phase 4.3 frontend.
//
// CRUD страница над user_goals. Coach уже видит active goals (через
// GoalsReader); эта страница нужна юзеру для (a) создания цели,
// (b) перевода в paused / done / abandoned, (c) удаления опечаток.
//
// Layout: Hero + create form + список секций (active / paused / archived).
// Минимальный inline create — без отдельной модалки чтобы оставить
// flow прямым.

import { useState, type FormEvent } from 'react'
import { Loader2, Pause, Play, Plus, Star, Trash2, X, Check } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  KIND_LABEL,
  STATUS_LABEL,
  goalSeverity,
  useCreateGoalMutation,
  useDeleteGoalMutation,
  useGoalsQuery,
  useSetGoalStatusMutation,
  type UserGoal,
  type UserGoalKind,
} from '../lib/queries/goals'

const SEV_STRIPE: Record<'critical' | 'warn' | 'cruise', string> = {
  critical: 'rgb(239 68 68)',
  warn: 'rgb(245 158 11)',
  cruise: 'transparent',
}

export default function GoalsPage() {
  const goalsQ = useGoalsQuery()
  const items = goalsQ.data ?? []

  const active = items.filter((g) => g.status === 'active')
  const paused = items.filter((g) => g.status === 'paused')
  const archive = items.filter((g) => g.status === 'done' || g.status === 'abandoned')

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <Hero count={items.length} />
        <CreateGoalForm />

        <Section title="Активные" hint="coach видит их в утреннем брифе" empty="Активных целей пока нет.">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </Section>

        {paused.length > 0 && (
          <Section title="На паузе" hint="не учитываются coach'ем; вернуть в active одной кнопкой">
            {paused.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </Section>
        )}

        {archive.length > 0 && (
          <Section title="Архив" hint="завершённые / отменённые">
            {archive.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </Section>
        )}
      </div>
    </AppShellV2>
  )
}

function Hero({ count }: { count: number }) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted">
        Goals
      </span>
      <h1 className="font-display text-3xl font-bold leading-tight text-text-primary lg:text-4xl">
        Цели
      </h1>
      <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
        Высокоуровневые цели (job target / skill / track). Coach использует их в narrative
        утреннего брифа и поднимает severity к deadline'у. {count > 0 ? `Сейчас всего: ${count}.` : 'Создай первую — coach сразу её увидит.'}
      </p>
    </header>
  )
}

function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string
  hint?: string
  empty?: string
  children: React.ReactNode
}) {
  const arr = Array.isArray(children) ? children : [children]
  const isEmpty = arr.filter(Boolean).length === 0
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>
        {hint && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {hint}
          </span>
        )}
      </div>
      {isEmpty && empty ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  )
}

function GoalCard({ goal }: { goal: UserGoal }) {
  const setStatus = useSetGoalStatusMutation()
  const del = useDeleteGoalMutation()
  const sev = goalSeverity(goal)
  const stripe = SEV_STRIPE[sev]

  const isActive = goal.status === 'active'
  const isDone = goal.status === 'done'

  const onPause = () => {
    void setStatus.mutate({ id: goal.id, status: 'paused' })
  }
  const onResume = () => {
    void setStatus.mutate({ id: goal.id, status: 'active' })
  }
  const onDone = () => {
    void setStatus.mutate({ id: goal.id, status: 'done' })
  }
  const onAbandon = () => {
    if (!window.confirm('Отказаться от цели?')) return
    void setStatus.mutate({ id: goal.id, status: 'abandoned' })
  }
  const onDelete = () => {
    if (!window.confirm('Удалить цель навсегда?')) return
    void del.mutate(goal.id)
  }

  const deadlineLabel = (() => {
    if (!goal.deadline) return 'без deadline'
    if (goal.days_to_deadline < 0) {
      return `${Math.abs(goal.days_to_deadline)} д. просрочено`
    }
    if (goal.days_to_deadline === 0) return 'сегодня'
    if (goal.days_to_deadline === 1) return 'завтра'
    return `через ${goal.days_to_deadline} д.`
  })()

  const isMutating = setStatus.isPending || del.isPending

  return (
    <li>
      <Card
        interactive={false}
        className="flex flex-col gap-3 p-4"
        style={{
          borderTop: sev === 'cruise' ? undefined : `3px solid ${stripe}`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {KIND_LABEL[goal.kind]}
              </span>
              <span
                className={[
                  'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                  goal.status === 'active'
                    ? 'border border-success/40 bg-success/10 text-success'
                    : goal.status === 'done'
                      ? 'border border-blue-500/40 bg-blue-500/10 text-blue-400'
                      : goal.status === 'paused'
                        ? 'border border-warn/40 bg-warn/10 text-warn'
                        : 'border border-border bg-surface-2 text-text-muted',
                ].join(' ')}
              >
                {STATUS_LABEL[goal.status]}
              </span>
              {sev !== 'cruise' && isActive && (
                <span
                  className={[
                    'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                    sev === 'critical'
                      ? 'border-danger/40 bg-danger/10 text-danger'
                      : 'border-warn/40 bg-warn/10 text-warn',
                  ].join(' ')}
                >
                  {sev}
                </span>
              )}
            </div>
            <h3 className="font-display text-base font-bold text-text-primary">{goal.title}</h3>
            <span className="font-mono text-[11px] text-text-muted">
              {deadlineLabel}
              {(goal.skill_keys ?? []).length > 0 && ` · skills=[${(goal.skill_keys ?? []).join(', ')}]`}
            </span>
            {goal.notes_md && (
              <p className="mt-1 max-w-2xl text-sm text-text-secondary whitespace-pre-line">
                {goal.notes_md}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {isActive && (
              <>
                <button
                  type="button"
                  onClick={onDone}
                  disabled={isMutating}
                  title="Цель достигнута"
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-success/40 hover:text-success"
                >
                  ✓ done
                </button>
                <button
                  type="button"
                  onClick={onPause}
                  disabled={isMutating}
                  title="Пауза"
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-warn/40 hover:text-warn"
                >
                  <Pause className="inline h-3 w-3" /> pause
                </button>
                <button
                  type="button"
                  onClick={onAbandon}
                  disabled={isMutating}
                  title="Отказаться"
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-danger/40 hover:text-danger"
                >
                  <X className="inline h-3 w-3" /> drop
                </button>
              </>
            )}
            {goal.status === 'paused' && (
              <button
                type="button"
                onClick={onResume}
                disabled={isMutating}
                title="Возобновить"
                className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-success/40 hover:text-success"
              >
                <Play className="inline h-3 w-3" /> resume
              </button>
            )}
            {(isDone || goal.status === 'abandoned') && (
              <button
                type="button"
                onClick={onResume}
                disabled={isMutating}
                title="Сделать активной снова"
                className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
              >
                reopen
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              disabled={isMutating}
              title="Удалить навсегда"
              className="rounded-md border border-transparent px-2 py-1 font-mono text-[10px] text-text-muted hover:border-danger/40 hover:text-danger"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </Card>
    </li>
  )
}

function CreateGoalForm() {
  const create = useCreateGoalMutation()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<UserGoalKind>('job_target')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [skills, setSkills] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('Заголовок обязателен')
      return
    }
    try {
      await create.mutateAsync({
        kind,
        title: title.trim(),
        notes_md: notes.trim() || undefined,
        deadline: deadline || undefined,
        skill_keys: skills
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      })
      setTitle('')
      setNotes('')
      setSkills('')
      setDeadline('')
      setOpen(false)
    } catch (err) {
      setError((err as Error).message ?? 'Не удалось создать цель')
    }
  }

  if (!open) {
    return (
      <Card className="flex-row items-center justify-between gap-3 p-3" interactive={false}>
        <span className="font-mono text-[11px] text-text-muted">
          Новая цель — job_target / skill / track.
        </span>
        <Button size="sm" onClick={() => setOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
          Добавить цель
        </Button>
      </Card>
    )
  }

  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Новая цель
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"
            aria-label="Закрыть форму"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Тип</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as UserGoalKind)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
          >
            <option value="job_target">Job target — собес/оффер</option>
            <option value="skill_target">Skill target — освоить тему</option>
            <option value="track_target">Track target — finish trek</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Заголовок *</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Yandex L4 backend"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
            autoFocus
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Deadline (опц.)</span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Skill keys (через запятую)</span>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="bfs, capacity-estimation"
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Заметки (опц.)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Зачем эта цель и как её замерить."
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
          />
        </label>

        {error && <p className="font-mono text-xs text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button
            type="submit"
            size="md"
            disabled={create.isPending}
            icon={create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
          >
            Создать
          </Button>
        </div>
      </form>
    </Card>
  )
}

// silence unused-icon import (Check is reserved for future "celebrate done" badge).
void Check
