// MockReplayPage — post-debrief "разбор" of a single pipeline attempt.
//
// Route: /mock/replay/:attemptId
//
// Layout (B/W, responsive):
//   - Top: back-link + question body header.
//   - Body: two-column on desktop, stacked on mobile.
//     · Left:  your transcript with annotation highlights (missing /
//              incorrect / good markers in the gutter; the excerpt itself
//              gets a subtle outline + bottom border).
//     · Right: ideal answer rendered as plain markdown text.
//   - Below: aggregated "3 вещи на которых можно сосредоточиться" list,
//            derived from annotations.type === 'missing' | 'incorrect'.
//
// State machine:
//   - Cold cache (backend returned {status:'not_ready'}) → show "Сгенерировать
//     разбор" CTA. Click → POST /replay/generate, then re-render.
//   - Generated → show the split view + missing-points checklist.
//   - LLM unavailable (503) → show retry button with explanation.
//
// Why no Excalidraw / no charts: replay is text-only by design. Sysdesign
// attempts include the user's drawing on the debrief page already; replay
// focuses on verbal answer / written narration comparison.
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Sparkles } from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import {
  isMockReplay,
  useGenerateMockReplayMutation,
  useMockReplayQuery,
  type MockReplay,
  type MockReplayAnnotation,
} from '../../lib/queries/mockPipeline'

export default function MockReplayPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate = useNavigate()

  const replayQ = useMockReplayQuery(attemptId)
  const generateMut = useGenerateMockReplayMutation(attemptId)

  // The "not_ready" arm vs. ready replay arm.
  const readyReplay: MockReplay | null = useMemo(() => {
    const data = replayQ.data
    if (!data) return null
    return isMockReplay(data) ? data : null
  }, [replayQ.data])

  if (!attemptId) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="error" title="Нет attempt_id" />
        </div>
      </AppShellV2>
    )
  }

  if (replayQ.isLoading) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="loading" />
        </div>
      </AppShellV2>
    )
  }

  if (replayQ.isError) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title="Не удалось открыть разбор"
            body={replayQ.error?.message ?? 'unknown'}
            cta={{ label: 'Попробовать снова', onClick: () => replayQ.refetch() }}
          />
        </div>
      </AppShellV2>
    )
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Назад
          </button>
        </div>

        <header className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            druz9 mock · разбор попытки
          </div>
          <h1 className="font-display text-2xl font-bold text-text-primary sm:text-3xl">
            {readyReplay
              ? readyReplay.question_body || 'Разбор ответа'
              : 'Разбор не сгенерирован'}
          </h1>
        </header>

        {!readyReplay ? (
          <NotReadyPanel
            onGenerate={() => generateMut.mutate()}
            isGenerating={generateMut.isPending}
            error={generateMut.error?.message}
          />
        ) : (
          <>
            <SplitView replay={readyReplay} />
            <FocusList annotations={readyReplay.annotations} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => generateMut.mutate()}
                loading={generateMut.isPending}
                disabled={generateMut.isPending}
              >
                Пере-сгенерировать
              </Button>
              <Link
                to="/mock"
                className="text-xs text-text-secondary hover:text-text-primary"
              >
                К выбору компании
              </Link>
            </div>
          </>
        )}
      </div>
    </AppShellV2>
  )
}

// ─── NotReadyPanel ─────────────────────────────────────────────────────────

function NotReadyPanel({
  onGenerate,
  isGenerating,
  error,
}: {
  onGenerate: () => void
  isGenerating: boolean
  error: string | undefined
}) {
  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-text-primary" />
        <div>
          <div className="font-display text-base font-bold text-text-primary">
            Готов разобрать этот ответ
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            AI-интервьюер прочитает вопрос + твой ответ и подготовит «как
            могло бы быть лучше»: идеальный ответ + 3-5 точечных комментариев,
            где ты сбился. Занимает 10-30 секунд.
          </p>
        </div>
      </div>
      <Button
        variant="primary"
        size="md"
        onClick={onGenerate}
        loading={isGenerating}
        disabled={isGenerating}
        className="self-start"
      >
        {isGenerating ? 'Генерируем…' : 'Сгенерировать разбор'}
      </Button>
      {error && (
        <div role="alert" className="text-xs" style={{ color: '#FF3B30' }}>
          {error.includes('503') || error.toLowerCase().includes('unavailable')
            ? 'LLM-провайдеры сейчас не отвечают. Попробуй через минуту.'
            : error}
        </div>
      )}
    </Card>
  )
}

// ─── SplitView ─────────────────────────────────────────────────────────────

function SplitView({ replay }: { replay: MockReplay }) {
  // Slice annotations: which ones target *your* answer (ones with
  // non-empty your_excerpt) — they highlight in the left pane. Others
  // (your_excerpt === '') anchor on the ideal side instead.
  const annsForYour = replay.annotations.filter((a) => a.your_excerpt.trim().length > 0)
  const annsForIdeal = replay.annotations.filter((a) => a.ideal_excerpt.trim().length > 0)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      <Card variant="default" padding="lg" className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          <span>Твой ответ</span>
        </div>
        <AnnotatedText
          text={replay.your_answer_md || '(ты не ответил)'}
          annotations={annsForYour}
          mode="your"
        />
        {annsForYour.length > 0 && (
          <AnnotationList annotations={annsForYour} mode="your" />
        )}
      </Card>

      <Card variant="default" padding="lg" className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          <span>Как можно было лучше</span>
        </div>
        <AnnotatedText
          text={replay.ideal_answer_md}
          annotations={annsForIdeal}
          mode="ideal"
        />
      </Card>
    </div>
  )
}

// AnnotatedText splits `text` around each annotation's excerpt and wraps the
// match in a highlight element. We deliberately keep this as plain text +
// inline styling — no markdown parser — because the ideal-answer body is
// already free-form markdown and the LLM's `your_excerpt` slices are
// verbatim substrings.
function AnnotatedText({
  text,
  annotations,
  mode,
}: {
  text: string
  annotations: MockReplayAnnotation[]
  mode: 'your' | 'ideal'
}) {
  // Collect (start,end,type,comment) triples by finding case-insensitive
  // substring matches. Overlapping annotations: first match wins (LLM
  // typically doesn't return overlaps; defensive code below).
  type Hit = { start: number; end: number; ann: MockReplayAnnotation; idx: number }
  const hits: Hit[] = []
  annotations.forEach((ann, idx) => {
    const needle = mode === 'your' ? ann.your_excerpt : ann.ideal_excerpt
    const trimmed = needle.trim()
    if (!trimmed) return
    const lc = text.toLowerCase()
    const found = lc.indexOf(trimmed.toLowerCase())
    if (found < 0) return
    const end = found + trimmed.length
    if (hits.some((h) => !(end <= h.start || found >= h.end))) return // overlap → skip
    hits.push({ start: found, end, ann, idx })
  })
  hits.sort((a, b) => a.start - b.start)

  if (hits.length === 0) {
    return <pre className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-text-primary">{text}</pre>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  hits.forEach((h, i) => {
    if (h.start > cursor) {
      parts.push(<span key={`pre-${i}`}>{text.slice(cursor, h.start)}</span>)
    }
    const colorClass = annotationClass(h.ann.type)
    parts.push(
      <mark
        key={`hit-${i}-${h.idx}`}
        className={`rounded-sm px-1 ${colorClass}`}
        title={h.ann.comment}
      >
        {text.slice(h.start, h.end)}
        <sup className="ml-0.5 font-mono text-[10px]">[{h.idx + 1}]</sup>
      </mark>,
    )
    cursor = h.end
  })
  if (cursor < text.length) {
    parts.push(<span key="tail">{text.slice(cursor)}</span>)
  }
  return (
    <pre className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-text-primary">
      {parts}
    </pre>
  )
}

// annotationClass — B/W styling guarded by the project rule: red only as a
// stripe/dot, no fill. Here we use underline + dotted under-line for
// missing/incorrect/good differentiation.
function annotationClass(type: MockReplayAnnotation['type']): string {
  switch (type) {
    case 'good':
      return 'bg-surface-2 underline decoration-text-primary decoration-2 underline-offset-2'
    case 'incorrect':
      return 'bg-surface-2 underline decoration-dotted decoration-2 underline-offset-2'
    case 'missing':
    default:
      return 'bg-surface-2 underline decoration-double underline-offset-2'
  }
}

// ─── AnnotationList ────────────────────────────────────────────────────────

function AnnotationList({
  annotations,
  mode,
}: {
  annotations: MockReplayAnnotation[]
  mode: 'your' | 'ideal'
}) {
  return (
    <ol className="mt-1 list-none space-y-2 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
      <li className="text-text-muted">Комментарии</li>
      {annotations.map((a, i) => (
        <li
          key={i}
          className="flex flex-col gap-0.5 normal-case tracking-normal text-text-primary"
        >
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            <span>[{i + 1}]</span>
            <span>· {labelForType(a.type)}</span>
          </span>
          <span className="text-xs text-text-secondary">{a.comment}</span>
          {mode === 'your' && a.ideal_excerpt && (
            <span className="text-xs text-text-secondary">
              → как лучше: «{a.ideal_excerpt}»
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function labelForType(t: MockReplayAnnotation['type']): string {
  switch (t) {
    case 'good':
      return 'попадание'
    case 'incorrect':
      return 'неточно'
    case 'missing':
    default:
      return 'пропущено'
  }
}

// ─── FocusList ─────────────────────────────────────────────────────────────

function FocusList({ annotations }: { annotations: MockReplayAnnotation[] }) {
  // Top 3 things to focus on = first 3 non-"good" annotations. The LLM
  // returns them in narrative order which is usually substantive-first.
  const items = annotations.filter((a) => a.type !== 'good').slice(0, 3)
  if (items.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
        3 вещи на которых можно сосредоточиться
      </div>
      <Card variant="default" padding="lg" className="flex flex-col gap-2">
        {items.map((a, i) => {
          const Icon = a.type === 'incorrect' ? AlertTriangle : XCircle
          return (
            <div key={i} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
              <div className="flex flex-col gap-0.5">
                <div className="text-sm text-text-primary">
                  {a.comment || labelForType(a.type)}
                </div>
                {a.ideal_excerpt && (
                  <div className="text-xs text-text-secondary">
                    Что должно было прозвучать: «{a.ideal_excerpt}»
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          <CheckCircle2 className="h-3 w-3" />
          Возвращайся к этому списку перед следующей попыткой.
        </div>
      </Card>
    </section>
  )
}
