import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useGuildWarQuery,
  useJoinGuildMutation,
  useLeaveGuildMutation,
} from '../../lib/queries/guild'

export function WarPanel({ guildId }: { guildId: string | undefined }) {
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

export function ActionsPanel({ guildId, isMine }: { guildId: string; isMine: boolean }) {
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
              onSuccess: (res) => {
                if (res.status === 'disbanded') {
                  setFeedback('Ты был последним участником — гильдия распущена.')
                } else if (res.status === 'transferred') {
                  setFeedback('Ты вышел; права капитана переданы старейшему участнику.')
                } else {
                  setFeedback('Ты покинул гильдию.')
                }
              },
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
            Если ты капитан — права автоматически перейдут к старейшему участнику.
            Последний участник распускает гильдию при выходе.
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
