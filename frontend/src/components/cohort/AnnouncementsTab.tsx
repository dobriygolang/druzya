// AnnouncementsTab — feed of cohort announcements with composer (для
// owner/coach) + reaction emoji-bar.
//
// Backed by useCohortAnnouncementsQuery + Create/Delete/AddReaction/
// RemoveReaction mutations from queries/announcement.ts.
import { useState } from 'react'
import { Pin, Trash2 } from 'lucide-react'
import { Card } from '../Card'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import { cn } from '../../lib/cn'
import {
  useCohortAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useAddReactionMutation,
  useRemoveReactionMutation,
  ALLOWED_REACTIONS,
  type AllowedReaction,
  type CohortAnnouncement,
} from '../../lib/queries/announcement'

type Props = {
  cohortID: string
  selfID?: string
  canPost: boolean
  ownerID: string
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  return `${d} д назад`
}

export default function AnnouncementsTab({ cohortID, selfID, canPost, ownerID }: Props) {
  const list = useCohortAnnouncementsQuery(cohortID)
  const items = list.data ?? []

  return (
    <div className="flex flex-col gap-3">
      {canPost && <Composer cohortID={cohortID} />}

      {list.isLoading && <EmptyState variant="loading" skeletonLayout="single-card" />}
      {list.isError && (
        <EmptyState
          variant="error"
          title="Не удалось загрузить ленту"
          body="Возможно, ты ещё не в когорте — нужен member+, чтобы читать."
        />
      )}
      {!list.isLoading && !list.isError && items.length === 0 && (
        <EmptyState
          variant="no-data"
          title="Лента пока пуста"
          body={canPost ? 'Напиши первый пост — другие участники получат уведомление.' : 'Когда owner или coach что-то опубликуют, пост появится здесь.'}
        />
      )}

      {items.map((a) => (
        <AnnouncementCard
          key={a.id}
          announcement={a}
          selfID={selfID}
          cohortID={cohortID}
          canDelete={a.author_id === selfID || ownerID === selfID}
        />
      ))}
    </div>
  )
}

function Composer({ cohortID }: { cohortID: string }) {
  const create = useCreateAnnouncementMutation()
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!body.trim()) {
      setErrorMsg('Текст поста обязателен')
      return
    }
    create.mutate(
      { cohort_id: cohortID, body: body.trim(), pinned },
      {
        onSuccess: () => {
          setBody('')
          setPinned(false)
        },
        onError: (err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Не удалось опубликовать')
        },
      },
    )
  }

  return (
    <Card className="flex-col items-stretch gap-2 p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          placeholder="Что нового в когорте?"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary"
        />
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            <Pin className="h-3 w-3" /> Закрепить
          </label>
          <span className="ml-auto font-mono text-[10px] text-text-muted">
            {body.length}/2000
          </span>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Публикуем…' : 'Опубликовать'}
          </Button>
        </div>
        {errorMsg && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
            {errorMsg}
          </div>
        )}
      </form>
    </Card>
  )
}

function AnnouncementCard({
  announcement: a,
  selfID,
  cohortID,
  canDelete,
}: {
  announcement: CohortAnnouncement
  selfID?: string
  cohortID: string
  canDelete: boolean
}) {
  const add = useAddReactionMutation()
  const remove = useRemoveReactionMutation()
  const del = useDeleteAnnouncementMutation(cohortID)
  const [showAll, setShowAll] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const viewerReacted = new Set(a.viewer_reacted ?? [])
  const visibleReactions = showAll
    ? ALLOWED_REACTIONS
    : ALLOWED_REACTIONS.filter((e) => viewerReacted.has(e) || (a.reactions ?? []).some((r) => r.emoji === e))

  const onToggle = (emoji: AllowedReaction) => {
    if (viewerReacted.has(emoji)) {
      remove.mutate({ cohortID, announcementID: a.id, emoji })
    } else {
      add.mutate({ cohortID, announcementID: a.id, emoji })
    }
  }

  const author = a.author_username
    ? `@${a.author_username}`
    : a.author_display_name || a.author_id.slice(0, 8)

  return (
    <Card className={cn('flex-col items-stretch gap-2 p-4', a.pinned && 'border-warn/40 bg-warn/5')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {a.pinned && <Pin className="h-3.5 w-3.5 fill-warn text-warn" />}
          <span className="font-semibold text-text-primary">{author}</span>
          <span className="font-mono text-[11px] text-text-muted">{fmtAgo(a.created_at)}</span>
        </div>
        {canDelete && (
          confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => del.mutate(a.id, { onSuccess: () => setConfirmDelete(false) })}
                disabled={del.isPending}
                className="rounded-md border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/20"
              >
                {del.isPending ? 'Удаляем…' : 'Подтвердить'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
              >
                Назад
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-danger"
              aria-label="Удалить пост"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{a.body}</p>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {visibleReactions.map((emoji) => {
          const group = (a.reactions ?? []).find((r) => r.emoji === emoji)
          const reacted = viewerReacted.has(emoji)
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggle(emoji)}
              disabled={!selfID || add.isPending || remove.isPending}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                reacted
                  ? 'border-accent bg-accent/15 text-accent-hover'
                  : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong',
              )}
            >
              <span>{emoji}</span>
              {group && group.count > 0 && (
                <span className="font-mono text-[10px]">{group.count}</span>
              )}
            </button>
          )
        })}
        {!showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-secondary"
          >
            +
          </button>
        )}
      </div>
    </Card>
  )
}
