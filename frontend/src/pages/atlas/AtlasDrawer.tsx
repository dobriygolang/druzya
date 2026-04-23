// AtlasDrawer — extracted from AtlasPage.tsx in WAVE-11.
//
// Right-side drawer with rich detail for a selected node: state badge,
// description, progress bar, decay/last-solved row, recommended kata,
// prereq/unlock graph neighbours. Behaviour identical to the inline
// version.

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Flame, X } from 'lucide-react'
import type { Atlas, AtlasNode, KataRef } from '../../lib/queries/profile'
import { humanizeDifficulty } from '../../lib/labels'
import { Button } from '../../components/Button'
import {
  STATE_LABEL,
  computePct,
  daysSince,
  nodeState,
  sectionLabel,
  stateBadgeClass,
} from './AtlasCanvasLegacy'

export function AtlasDrawer({
  atlas,
  node,
  onClose,
  onSelectNeighbour,
}: {
  atlas: Atlas
  node: AtlasNode
  onClose: () => void
  onSelectNeighbour: (k: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const state = nodeState(node)
  const days = daysSince(node.last_solved_at)
  const solved = node.solved_count ?? 0
  const total = node.total_count ?? 0
  const pct = computePct(node)
  const pctLabel = pct === null ? '—' : `${pct}%`
  const barWidth = pct ?? 0
  const recommended = node.recommended_kata ?? []

  const prereqs = atlas.edges
    .filter((e) => e.to === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.from))
    .filter((n): n is AtlasNode => Boolean(n))
  const unlocks = atlas.edges
    .filter((e) => e.from === node.key)
    .map((e) => atlas.nodes.find((n) => n.key === e.to))
    .filter((n): n is AtlasNode => Boolean(n))

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Закрыть"
      />
      <aside className="relative h-full w-full max-w-[440px] overflow-y-auto bg-surface-1 shadow-card">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-5 py-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase ${stateBadgeClass(state)}`}>
            {STATE_LABEL[state]}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <div>
            <h2 className="font-display text-[22px] font-bold leading-tight text-text-primary">
              {node.title}
            </h2>
            <span className="mt-0.5 block font-mono text-xs text-text-muted">
              {sectionLabel(node.section)} · {node.kind}
            </span>
          </div>

          {node.description && (
            <p className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary">
              {node.description}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Прогресс
              </span>
              <span className="font-mono text-xs text-text-secondary">
                {total > 0 ? `${solved} из ${total} задач` : pctLabel}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${
                  state === 'mastered'
                    ? 'bg-gradient-to-r from-success to-cyan'
                    : state === 'decaying'
                      ? 'bg-gradient-to-r from-warn to-danger'
                      : 'bg-gradient-to-r from-cyan to-accent'
                }`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>

          {(node.decaying || days !== null) && (
            <div
              className={`flex items-start gap-3 rounded-lg p-3 ${
                node.decaying ? 'bg-warn/10 border border-warn/30' : 'bg-surface-2'
              }`}
            >
              {node.decaying ? (
                <Flame className="h-4 w-4 shrink-0 text-warn" />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-text-muted" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-text-primary">
                  {node.decaying
                    ? `Ты не решал эту тему ${days ?? '?'} дней — знание тает`
                    : days === 0
                      ? 'Решал сегодня'
                      : `Последняя задача: ${days ?? '?'} дн. назад`}
                </span>
                {node.decaying && (
                  <span className="text-xs text-text-muted">
                    Реши хотя бы одну задачу, чтобы остановить decay.
                  </span>
                )}
              </div>
            </div>
          )}

          {recommended.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Рекомендованные ката
              </span>
              <ul className="flex flex-col gap-1.5">
                {recommended.slice(0, 5).map((k) => (
                  <KataItem key={k.id} k={k} />
                ))}
              </ul>
              <Link to={`/arena/kata/${encodeURIComponent(recommended[0].id)}`} className="block">
                <Button
                  size="md"
                  iconRight={<ArrowRight className="h-4 w-4" />}
                  className="w-full"
                >
                  Решить рекомендованное сейчас
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-lg bg-surface-2 p-3 text-xs text-text-muted">
              Каталог ката для этой темы ещё не размечен — попробуй открыть{' '}
              <Link to="/arena" className="text-accent hover:underline">
                Арену с фильтром по теме
              </Link>
              .
            </div>
          )}

          {(prereqs.length > 0 || unlocks.length > 0) && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {prereqs.length > 0 && (
                <RelatedGroup
                  title="Открывает доступ к этому"
                  nodes={prereqs}
                  onClick={onSelectNeighbour}
                />
              )}
              {unlocks.length > 0 && (
                <RelatedGroup
                  title="Этот узел открывает"
                  nodes={unlocks}
                  onClick={onSelectNeighbour}
                />
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function KataItem({ k }: { k: KataRef }) {
  const diffColor =
    k.difficulty === 'easy'
      ? 'text-success'
      : k.difficulty === 'medium'
        ? 'text-warn'
        : 'text-danger'
  return (
    <li>
      <Link
        to={`/arena/kata/${encodeURIComponent(k.id)}`}
        className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary transition-colors hover:border-accent"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{k.title}</span>
          <span className={`font-mono text-[10px] uppercase ${diffColor}`}>
            {humanizeDifficulty(k.difficulty)}
            {k.estimated_minutes ? ` · ~${k.estimated_minutes} мин` : ''}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
      </Link>
    </li>
  )
}

function RelatedGroup({
  title,
  nodes,
  onClick,
}: {
  title: string
  nodes: AtlasNode[]
  onClick: (k: string) => void
}) {
  return (
    <div>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {nodes.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={() => onClick(n.key)}
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary hover:border-accent"
          >
            {n.title}
          </button>
        ))}
      </div>
    </div>
  )
}
