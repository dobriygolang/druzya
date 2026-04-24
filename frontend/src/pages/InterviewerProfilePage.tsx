// InterviewerProfilePage — public read-only card for an interviewer.
//
// Mounted at /interviewer/:userID. Backed by:
//   GET /api/v1/review/stats/{id}  (avg rating + count)
//   GET /api/v1/review?interviewer_id=...  (latest reviews, C→I only)
//
// The interviewer's username and avatar identity come from the click-
// through context (state passed via react-router state). When opened
// directly by URL we degrade to a minimal header with the user_id and a
// "Карточка пользователя" placeholder — the public profile lookup by id
// (vs by username) isn't yet exposed as a backend route, so we keep the
// surface honest rather than fake data.
import { useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Star } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { Avatar, type AvatarGradient } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'
import {
  useInterviewerStatsQuery,
  useReviewsByInterviewer,
} from '../lib/queries/review'

const GRADIENTS: AvatarGradient[] = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan']
function pickGradient(seed: string): AvatarGradient {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

type LocState = { username?: string }

export default function InterviewerProfilePage() {
  const { userID = '' } = useParams<{ userID: string }>()
  const loc = useLocation()
  const username = (loc.state as LocState | null)?.username
  const stats = useInterviewerStatsQuery(userID)
  const reviews = useReviewsByInterviewer(userID, 50)

  const initial = (username?.[0] ?? userID[0] ?? '?').toUpperCase()
  const handle = username ? `@${username}` : `id ${userID.slice(0, 8)}…`

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20">
        <Link to="/slots" className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> К каталогу слотов
        </Link>

        {/* Header card — avatar + identity + aggregate rating */}
        <Card className="flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <Avatar size="lg" gradient={pickGradient(userID)} initials={initial} />
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="font-display text-2xl font-bold text-text-primary">{handle}</h1>
            <p className="text-sm text-text-secondary">Mock-интервьюер druz9</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {stats.isLoading ? (
              <span className="font-mono text-[12px] text-text-muted">Загрузка…</span>
            ) : stats.data && stats.data.reviews_count > 0 ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-warn text-warn" />
                  <span className="font-mono text-[18px] font-bold text-warn">
                    {stats.data.avg_rating.toFixed(1)}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-text-muted">
                  {stats.data.reviews_count} отзывов
                </span>
              </>
            ) : (
              <span className="font-mono text-[11px] text-text-muted">Нет отзывов</span>
            )}
          </div>
        </Card>

        <h2 className="font-display text-base font-bold text-text-primary">Отзывы кандидатов</h2>

        {reviews.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}
        {reviews.isError && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить отзывы"
            body="Попробуй обновить страницу — если повторится, мы уже видим ошибку."
          />
        )}
        {!reviews.isLoading && !reviews.isError && (reviews.data?.length ?? 0) === 0 && (
          <EmptyState
            variant="no-data"
            title="Пока нет отзывов"
            body="Кандидаты оставят их после проведённых сессий."
          />
        )}

        <div className="flex flex-col gap-3">
          {(reviews.data ?? []).map((r) => (
            <Card key={r.id} className="flex-col items-start gap-2 p-4 sm:p-5">
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${i < r.rating ? 'fill-warn text-warn' : 'text-text-muted'}`}
                    />
                  ))}
                </div>
                <span className="font-mono text-[11px] text-text-muted">{fmtDate(r.created_at)}</span>
              </div>
              {r.feedback && (
                <p className="text-sm leading-relaxed text-text-secondary">{r.feedback}</p>
              )}
              {!r.feedback && (
                <p className="text-sm italic text-text-muted">
                  Кандидат поставил оценку без комментария.
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </AppShellV2>
  )
}
