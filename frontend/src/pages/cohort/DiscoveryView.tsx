import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useCreateCohortMutation,
  useCohortListQuery,
  useJoinCohortMutation,
  type PublicCohort,
} from '../../lib/queries/cohort'
import { TIERS, tierFor, tierLabel } from './helpers'

// PublicCohortCard — single tile in the discovery grid.
function PublicCohortCard({
  cohort,
  onJoin,
  joining,
  onOpen,
}: {
  cohort: PublicCohort
  onJoin: () => void
  joining: boolean
  onOpen: () => void
}) {
  const seats = `${cohort.members_count}/${cohort.max_members}`
  const policyChip =
    cohort.join_policy === 'open'
      ? 'bg-success/15 text-success'
      : cohort.join_policy === 'invite'
        ? 'bg-warn/15 text-warn'
        : 'bg-danger/15 text-danger'
  const policyLabel =
    cohort.join_policy === 'open' ? 'Открытая' : cohort.join_policy === 'invite' ? 'По заявке' : 'Закрытая'
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-start gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center"
          style={{
            borderRadius: 12,
            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
          }}
        >
          <Shield className="h-6 w-6 text-text-primary" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            className="text-left font-display text-base font-bold text-text-primary hover:underline"
            onClick={onOpen}
          >
            {cohort.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-warn">
              {tierLabel(cohort.tier || tierFor(cohort.cohort_elo))}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${policyChip}`}>
              {policyLabel}
            </span>
          </div>
        </div>
      </div>
      {cohort.description ? (
        <p className="line-clamp-2 text-[12px] leading-snug text-text-secondary">{cohort.description}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Stat label="ELO" value={String(cohort.cohort_elo)} />
        <Stat label="Участники" value={seats} />
        <Stat label="Войны" value={String(cohort.wars_won)} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onOpen} icon={<ArrowRight className="h-3.5 w-3.5" />}>
          Открыть
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={joining}
          disabled={cohort.join_policy === 'closed' || cohort.members_count >= cohort.max_members}
          onClick={onJoin}
        >
          {cohort.join_policy === 'invite' ? 'Запрос' : 'Вступить'}
        </Button>
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-sm font-bold text-text-primary">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-muted">{label}</span>
    </div>
  )
}

function CreateCohortModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const create = useCreateCohortMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [maxMembers, setMaxMembers] = useState(25)
  const [policy, setPolicy] = useState<'open' | 'invite' | 'closed'>('open')
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const submit = () => {
    setError(null)
    if (name.trim().length < 3) {
      setError('Имя должно быть хотя бы из 3 символов.')
      return
    }
    create.mutate(
      // tier is intentionally NOT sent — backend forces bronze for every new
      // cohort; promotion happens automatically based on aggregate ELO.
      { name: name.trim(), description: description.trim(), max_members: maxMembers, join_policy: policy },
      {
        onSuccess: () => {
          onClose()
          setName('')
          setDescription('')
        },
        onError: (err: unknown) =>
          setError(err instanceof Error ? err.message : 'Не удалось создать когорту.'),
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-bg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary">Создать когорту</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <Field label="Название (3..32 символа)">
          <input
            type="text"
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder="The Crimson Recursion"
          />
        </Field>
        <Field label="Описание">
          <textarea
            className="min-h-[64px] w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={140}
            placeholder="Опционально — короткий девиз когорты."
          />
        </Field>
        <Field label="Лимит участников">
          <input
            type="number"
            min={1}
            max={200}
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent"
            value={maxMembers}
            onChange={(e) => setMaxMembers(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          />
        </Field>
        <p className="rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-muted">
          Когорта начинает с Bronze tier. Тир повышается автоматически — растите ELO своей команды.
        </p>
        <Field label="Политика входа">
          <select
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent"
            value={policy}
            onChange={(e) => setPolicy(e.target.value as 'open' | 'invite' | 'closed')}
          >
            <option value="open">Открытая — любой может вступить</option>
            <option value="invite">По заявке — модерация капитаном</option>
            <option value="closed">Закрытая — только по приглашению</option>
          </select>
        </Field>
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" size="sm" loading={create.isPending} onClick={submit}>
            Создать
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

export function DiscoveryView() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<string>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const filters = useMemo(() => ({ search: search.trim(), tier, page: 1 }), [search, tier])
  const { data, isLoading, isError, refetch } = useCohortListQuery(filters)
  const join = useJoinCohortMutation()
  const items = data?.items ?? []

  const handleJoin = (id: string) => {
    setPendingId(id)
    setFeedback(null)
    join.mutate(id, {
      onSuccess: (res) => {
        setPendingId(null)
        setFeedback(
          res.status === 'pending'
            ? 'Заявка отправлена капитану. Жди подтверждения.'
            : 'Готово — ты в когорты!',
        )
      },
      onError: (err: unknown) => {
        setPendingId(null)
        setFeedback(err instanceof Error ? err.message : 'Не удалось вступить.')
      },
    })
  }

  return (
    <>
      <div
        className="flex h-auto flex-col items-start justify-between gap-3 px-4 py-6 sm:px-8 lg:h-[180px] lg:flex-row lg:items-center lg:px-20 lg:py-0"
        style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
      >
        <div className="flex items-center gap-4">
          <Trophy className="h-10 w-10 text-warn" />
          <div className="flex flex-col">
            <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
              Когорты
            </h1>
            <p className="text-sm text-text-secondary">
              Найди свою команду — вступи или создай новую когорту.
            </p>
          </div>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
          Создать когорту
        </Button>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7">
        <Card className="flex-col gap-3 p-4 lg:flex-row lg:items-end" interactive={false}>
          <Field label="Поиск по названию">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                className="h-10 w-full rounded-md border border-border bg-surface-1 pl-9 pr-3 text-[13px] text-text-primary outline-none focus:border-accent"
                placeholder="Crimson…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Tier">
            <select
              className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent lg:w-[160px]"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            >
              <option value="">Все</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierLabel(t)}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        {feedback ? (
          <Card className="flex-col items-start gap-1 border-cyan/30 bg-cyan/5 p-3" interactive={false}>
            <p className="text-[12px] text-cyan">{feedback}</p>
          </Card>
        ) : null}

        {isLoading ? (
          <Card className="flex-col gap-3 p-5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
          </Card>
        ) : isError ? (
          <Card className="flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger">Не удалось загрузить список когорт.</p>
            <Button size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <Card className="flex-col gap-2 p-5">
            <Users className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">
              Ничего не нашлось. Попробуй другой фильтр или создай свою когорту.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((g) => (
              <PublicCohortCard
                key={g.id}
                cohort={g}
                joining={pendingId === g.id}
                onJoin={() => handleJoin(g.id)}
                onOpen={() => navigate(`/cohort/${g.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateCohortModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
