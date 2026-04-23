// /guild — Wave 3 guild page.
//
// Three layout modes driven by the route + query state:
//
//   1. /guild and the user IS in a guild  → detail view of MY guild
//   2. /guild and the user is NOT in any  → public discovery (search + grid)
//   3. /guild/:guildId                    → public detail of THAT guild
//
// Reads:
//   - useMyGuildQuery()    /api/v1/guild/my   (returns null on 404)
//   - useGuildQuery(id)    /api/v1/guild/{id}
//   - useGuildWarQuery(id) /api/v1/guild/{id}/war
//   - useGuildListQuery()  /api/v1/guild/list?search=&tier=&page=
//
// Mutations (Wave 3):
//   - useJoinGuildMutation()    POST /api/v1/guild/{id}/join
//   - useLeaveGuildMutation()   POST /api/v1/guild/{id}/leave
//   - useCreateGuildMutation()  POST /api/v1/guild
//
// Loading/empty/error states mirror the bible defaults — skeleton sections,
// friendly empty copy, and a retry button on hard errors.

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  Crown,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import {
  useCreateGuildMutation,
  useGuildListQuery,
  useGuildQuery,
  useGuildWarQuery,
  useJoinGuildMutation,
  useLeaveGuildMutation,
  useMyGuildQuery,
  type Guild,
  type PublicGuild,
} from '../lib/queries/guild'

// ── helpers ───────────────────────────────────────────────────────────────

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'] as const
type Tier = (typeof TIERS)[number]

function tierFor(elo: number): string {
  if (elo >= 2200) return 'master'
  if (elo >= 1900) return 'diamond'
  if (elo >= 1600) return 'platinum'
  if (elo >= 1300) return 'gold'
  if (elo >= 1100) return 'silver'
  return 'bronze'
}

function tierLabel(t: string): string {
  switch (t) {
    case 'master':
      return 'Master'
    case 'diamond':
      return 'Diamond'
    case 'platinum':
      return 'Platinum'
    case 'gold':
      return 'Gold'
    case 'silver':
      return 'Silver'
    case 'bronze':
      return 'Bronze'
    default:
      return '—'
  }
}

function roleLabel(role: string): string {
  if (role === 'captain') return 'Лидер'
  if (role === 'officer') return 'Офицер'
  return 'Игрок'
}

function roleChip(role: string) {
  if (role === 'captain') return 'bg-warn/15 text-warn'
  if (role === 'officer') return 'bg-cyan/15 text-cyan'
  return 'bg-border-strong text-text-muted'
}

// ── shared sub-views ──────────────────────────────────────────────────────

function GuildBanner({ guild, rank }: { guild: Guild; rank?: number }) {
  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
      style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="grid h-24 w-24 place-items-center"
          style={{
            borderRadius: 18,
            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
          }}
        >
          <Shield className="h-12 w-12 text-text-primary" />
        </div>
        <div className="flex flex-col gap-1.5">
          {rank ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
              {tierLabel(tierFor(guild.guild_elo)).toUpperCase()} TIER · #{rank} GLOBAL
            </span>
          ) : null}
          <h1 className="font-display text-3xl font-extrabold leading-[1.05] text-text-primary sm:text-4xl lg:text-[36px]">
            {guild.name}
          </h1>
          <p className="text-sm text-text-secondary">
            {(guild.members?.length ?? 0)} участников · guild ELO {guild.guild_elo}
          </p>
          <div className="mt-2 flex gap-6">
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-text-primary">{guild.guild_elo}</span>
              <span className="text-[11px] text-text-muted">guild ELO</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-cyan">
                {guild.members?.length ?? 0}
              </span>
              <span className="text-[11px] text-text-muted">участников</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-warn">
                {guild.current_war_id ? '1' : '0'}
              </span>
              <span className="text-[11px] text-text-muted">активных войн</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MembersList({ members }: { members: Guild['members'] }) {
  if (!members || members.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Участники</h3>
        <p className="text-sm text-text-secondary">Пока никого нет.</p>
      </Card>
    )
  }
  return (
    <Card className="flex-1 flex-col p-0">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h3 className="font-display text-base font-bold text-text-primary">
          Участники ({members.length})
        </h3>
      </div>
      <div className="hidden grid-cols-[2fr_1fr_1fr_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid">
        <span>ИГРОК</span>
        <span>РОЛЬ</span>
        <span>СЕКЦИЯ</span>
        <span />
      </div>
      {members.map((m) => (
        <div
          key={m.user_id}
          className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:grid lg:grid-cols-[2fr_1fr_1fr_40px] lg:items-center lg:gap-4"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="md" gradient="violet-cyan" initials={m.username[0]?.toUpperCase()} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-text-primary">@{m.username}</span>
              <span className="truncate font-mono text-[11px] text-text-muted">
                {m.role === 'captain' ? <Crown className="inline h-3 w-3 text-warn" /> : null}
                {' '}
                с{' '}
                {m.joined_at
                  ? new Date(m.joined_at).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
            </div>
          </div>
          <div>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleChip(m.role)}`}
            >
              {roleLabel(m.role)}
            </span>
          </div>
          <span className="text-sm text-text-secondary">
            {m.assigned_section ? m.assigned_section : '—'}
          </span>
          <span />
        </div>
      ))}
    </Card>
  )
}

function WarPanel({ guildId }: { guildId: string | undefined }) {
  const { data: war, isLoading } = useGuildWarQuery(guildId)
  if (isLoading) {
    return (
      <Card className="flex-col gap-3 p-5">
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-2 w-full animate-pulse rounded-full bg-surface-3" />
      </Card>
    )
  }
  if (!war) {
    return (
      <Card className="flex-col gap-2 p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Война недели</h3>
        <p className="text-sm text-text-secondary">Активной войны нет.</p>
      </Card>
    )
  }
  const scoreA = war.lines?.reduce((acc, l) => acc + l.score_a, 0) ?? 0
  const scoreB = war.lines?.reduce((acc, l) => acc + l.score_b, 0) ?? 0
  const total = scoreA + scoreB
  const pctA = total > 0 ? Math.round((scoreA / total) * 100) : 50
  return (
    <Card
      className="flex-col gap-3 border-accent/40 bg-gradient-to-br from-surface-3 to-accent p-5 shadow-glow"
      interactive={false}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
          АКТИВНАЯ ВОЙНА
        </span>
        <span className="font-mono text-[11px] text-text-secondary">
          {war.week_start} → {war.week_end}
        </span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">
        {war.guild_a?.name ?? '—'} vs {war.guild_b?.name ?? '—'}
      </h3>
      <div className="flex items-center gap-3">
        <span className="font-display text-[22px] font-bold text-success">{scoreA}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full bg-success" style={{ width: `${pctA}%` }} />
          <div className="h-full bg-danger" style={{ width: `${100 - pctA}%` }} />
        </div>
        <span className="font-display text-[22px] font-bold text-danger">{scoreB}</span>
      </div>
    </Card>
  )
}

function ActionsPanel({ guildId, isMine }: { guildId: string; isMine: boolean }) {
  const join = useJoinGuildMutation()
  const leave = useLeaveGuildMutation()
  const [feedback, setFeedback] = useState<string | null>(null)

  if (isMine) {
    return (
      <Card className="flex-col gap-3 p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Действия</h3>
        <Button
          variant="ghost"
          icon={<LogOut className="h-3.5 w-3.5" />}
          loading={leave.isPending}
          onClick={() =>
            leave.mutate(guildId, {
              onSuccess: () => setFeedback('Ты покинул гильдию.'),
              onError: (err: unknown) =>
                setFeedback(err instanceof Error ? err.message : 'Не удалось выйти.'),
            })
          }
        >
          Выйти из гильдии
        </Button>
        {feedback ? (
          <p className="text-[12px] text-text-muted">{feedback}</p>
        ) : (
          <p className="text-[11px] text-text-muted">
            Капитан гильдии не может выйти — сначала передай руководство.
          </p>
        )}
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-2 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">Действия</h3>
      <Button
        loading={join.isPending}
        onClick={() =>
          join.mutate(guildId, {
            onSuccess: (res) =>
              setFeedback(
                res.status === 'pending'
                  ? 'Заявка отправлена капитану.'
                  : 'Готово — добро пожаловать!',
              ),
            onError: (err: unknown) =>
              setFeedback(err instanceof Error ? err.message : 'Не удалось вступить.'),
          })
        }
      >
        Вступить в гильдию
      </Button>
      {feedback ? <p className="text-[12px] text-text-muted">{feedback}</p> : null}
    </Card>
  )
}

// ── per-mode views ────────────────────────────────────────────────────────

function GuildDetail({ guild, isMine }: { guild: Guild; isMine: boolean }) {
  return (
    <>
      <GuildBanner guild={guild} />
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <WarPanel guildId={guild.id} />
          <ActionsPanel guildId={guild.id} isMine={isMine} />
        </div>
        <MembersList members={guild.members} />
      </div>
    </>
  )
}

// PublicGuildCard — single tile in the discovery grid.
function PublicGuildCard({
  guild,
  onJoin,
  joining,
  onOpen,
}: {
  guild: PublicGuild
  onJoin: () => void
  joining: boolean
  onOpen: () => void
}) {
  const seats = `${guild.members_count}/${guild.max_members}`
  const policyChip =
    guild.join_policy === 'open'
      ? 'bg-success/15 text-success'
      : guild.join_policy === 'invite'
        ? 'bg-warn/15 text-warn'
        : 'bg-danger/15 text-danger'
  const policyLabel =
    guild.join_policy === 'open' ? 'Открытая' : guild.join_policy === 'invite' ? 'По заявке' : 'Закрытая'
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
            {guild.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-warn">
              {tierLabel(guild.tier || tierFor(guild.guild_elo))}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${policyChip}`}>
              {policyLabel}
            </span>
          </div>
        </div>
      </div>
      {guild.description ? (
        <p className="line-clamp-2 text-[12px] leading-snug text-text-secondary">{guild.description}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Stat label="ELO" value={String(guild.guild_elo)} />
        <Stat label="Участники" value={seats} />
        <Stat label="Войны" value={String(guild.wars_won)} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onOpen} icon={<ArrowRight className="h-3.5 w-3.5" />}>
          Открыть
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={joining}
          disabled={guild.join_policy === 'closed' || guild.members_count >= guild.max_members}
          onClick={onJoin}
        >
          {guild.join_policy === 'invite' ? 'Запрос' : 'Вступить'}
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

function CreateGuildModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const create = useCreateGuildMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tier, setTier] = useState<Tier>('bronze')
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
      { name: name.trim(), description: description.trim(), tier, max_members: maxMembers, join_policy: policy },
      {
        onSuccess: () => {
          onClose()
          setName('')
          setDescription('')
        },
        onError: (err: unknown) =>
          setError(err instanceof Error ? err.message : 'Не удалось создать гильдию.'),
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
          <h2 className="font-display text-lg font-bold text-text-primary">Создать гильдию</h2>
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
            placeholder="Опционально — короткий девиз гильдии."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tier">
            <select
              className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent"
              value={tier}
              onChange={(e) => setTier(e.target.value as Tier)}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierLabel(t)}
                </option>
              ))}
            </select>
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
        </div>
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

function DiscoveryView() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<string>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const filters = useMemo(() => ({ search: search.trim(), tier, page: 1 }), [search, tier])
  const { data, isLoading, isError, refetch } = useGuildListQuery(filters)
  const join = useJoinGuildMutation()
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
            : 'Готово — ты в гильдии!',
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
              Гильдии
            </h1>
            <p className="text-sm text-text-secondary">
              Найди свою команду — вступи или создай новую гильдию.
            </p>
          </div>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
          Создать гильдию
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
            <p className="text-sm text-danger">Не удалось загрузить список гильдий.</p>
            <Button size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <Card className="flex-col gap-2 p-5">
            <Users className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">
              Ничего не нашлось. Попробуй другой фильтр или создай свою гильдию.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((g) => (
              <PublicGuildCard
                key={g.id}
                guild={g}
                joining={pendingId === g.id}
                onJoin={() => handleJoin(g.id)}
                onOpen={() => navigate(`/guild/${g.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateGuildModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function GuildPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const myGuildQuery = useMyGuildQuery()
  const explicitQuery = useGuildQuery(guildId)

  // The "active" guild — what we render in the detail layout — depends on
  // whether the URL pinned a specific guildId or not.
  const detailGuild = useMemo<Guild | null | undefined>(() => {
    if (guildId) return explicitQuery.data
    return myGuildQuery.data
  }, [guildId, explicitQuery.data, myGuildQuery.data])

  const isMine = !!myGuildQuery.data && detailGuild?.id === myGuildQuery.data.id
  const loading = guildId ? explicitQuery.isLoading : myGuildQuery.isLoading
  const errored = guildId ? explicitQuery.isError : myGuildQuery.isError

  if (loading) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-3 p-5">
            <div className="h-6 w-1/3 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-surface-3" />
          </Card>
        </div>
      </AppShellV2>
    )
  }

  if (errored) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger">Не удалось загрузить гильдию.</p>
            <Button
              size="sm"
              onClick={() => (guildId ? explicitQuery.refetch() : myGuildQuery.refetch())}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild/:guildId — explicit lookup that returned no row → friendly empty.
  if (guildId && !detailGuild) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-2 p-5">
            <Shield className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">Гильдия не найдена.</p>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild without an id and the user has no guild → discovery view (search,
  // grid of public guilds, join + create CTAs).
  if (!guildId && !detailGuild) {
    return (
      <AppShellV2>
        <DiscoveryView />
      </AppShellV2>
    )
  }

  // detail view (mine or public)
  return (
    <AppShellV2>
      <GuildDetail guild={detailGuild!} isMine={isMine} />
    </AppShellV2>
  )
}
