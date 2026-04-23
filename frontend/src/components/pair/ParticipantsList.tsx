// ParticipantsList — colored cursor avatars for the right-hand panel of
// PairRoomPage. Each participant gets a deterministic colour derived from
// their user_id (so the same user always paints the same colour for every
// observer). No fake "online" indicator — if the backend hasn't said so,
// we don't claim it.

import { Avatar } from '../Avatar'
import type { PairParticipant } from '../../lib/queries/pairEditor'

const PALETTE = ['#7C5CFF', '#EE5396', '#33B1FF', '#42BE65', '#FF8389', '#FFB454']

export function colorFor(userID: string): string {
  let h = 0
  for (let i = 0; i < userID.length; i++) h = (h * 31 + userID.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

type Props = {
  participants: PairParticipant[]
  ownerId: string
}

export function ParticipantsList({ participants, ownerId }: Props) {
  if (participants.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-1 p-3 text-[12px] text-text-muted">
        В комнате пока никого нет.
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {participants.map((p) => {
        const c = p.color ?? colorFor(p.user_id)
        const isOwner = p.user_id === ownerId
        const initials = (p.display_name ?? p.user_id.slice(0, 2)).slice(0, 2).toUpperCase()
        return (
          <li
            key={p.user_id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: c, boxShadow: `0 0 6px ${c}` }}
              aria-hidden
            />
            <Avatar size="sm" gradient="violet-cyan" initials={initials} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-text-primary">
                {p.display_name ?? p.user_id.slice(0, 8)}
              </div>
              <div className="font-mono text-[10px] text-text-muted">
                {isOwner ? 'owner' : p.role}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
