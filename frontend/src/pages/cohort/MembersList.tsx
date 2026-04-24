import { Crown } from 'lucide-react'
import { Card } from '../../components/Card'
import { Avatar } from '../../components/Avatar'
import type { Cohort } from '../../lib/queries/cohort'
import { roleChip, roleLabel } from './helpers'

export function MembersList({ members }: { members: Cohort['members'] }) {
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
