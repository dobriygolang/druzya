// AtlasDrawer — extracted from AtlasPage.tsx in WAVE-11.
//
// Right-side drawer with rich detail for a selected node: state badge,
// description, progress bar, decay/last-solved row, recommended kata,
// prereq/unlock graph neighbours. Behaviour identical to the inline
// version.

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock, Flame, Target, X } from 'lucide-react'
import type { Atlas, AtlasNode, KataRef } from '../../lib/queries/profile'
import { useSetAtlasNodePrefMutation } from '../../lib/queries/profile'
import { humanizeDifficulty } from '../../lib/labels'
import { Button } from '../../components/Button'
import { AICoachPill } from '../../components/AICoachPill'
import { useActiveStudyModeQuery, type ActiveTrack } from '../../lib/queries/honeSettings'

// pickPersonaForNode — выбирает AI-coach персону. mode='go' выигрывает над
// section'ом (юзер явно сказал что в go-режиме). Иначе — по section'у узла.
// Display-name: role-only lowercase per memory/feedback_persona_names.md.
function pickPersonaForNode(
  node: AtlasNode,
  activeTrack: ActiveTrack,
): { slug: string; name: string } {
  if (activeTrack === 'go') {
    return { slug: 'go-coach', name: 'go coach' }
  }
  switch (node.section) {
    case 'algorithms':
      return { slug: 'algo-coach', name: 'algo coach' }
    case 'system_design':
      return { slug: 'sysdesign-guru', name: 'sysdesign coach' }
    case 'sql':
    case 'databases':
      return { slug: 'sql-mentor', name: 'sql coach' }
    case 'english_hr':
    case 'english':
      return { slug: 'english-coach', name: 'english coach' }
    default:
      return { slug: 'algo-coach', name: 'algo coach' }
  }
}
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

  const activeTrack = useActiveStudyModeQuery().data?.activeTrack ?? 'general'
  const setPref = useSetAtlasNodePrefMutation()
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[22px] font-bold leading-tight text-text-primary">
                {node.title}
              </h2>
              <span className="mt-0.5 block font-mono text-xs text-text-muted">
                {sectionLabel(node.section)} · {node.kind}
                {node.is_user_owned && (
                  <span
                    className="ml-2 inline-block rounded-sm border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted"
                    title="узел добавлен тобой через classify-flow"
                  >
                    your todo
                  </span>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setPref.mutate({ nodeKey: node.key, pinned: true, hidden: false })
                }
                disabled={setPref.isPending}
                title="закрепить узел в /atlas ribbon"
                className="rounded-sm border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                pin
              </button>
              <button
                type="button"
                onClick={() =>
                  setPref.mutate({ nodeKey: node.key, pinned: false, hidden: true })
                }
                disabled={setPref.isPending}
                title="скрыть узел из канваса (можно вернуть)"
                className="rounded-sm border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                hide
              </button>
            </div>
          </div>

          {node.description && (
            <p className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary">
              {node.description}
            </p>
          )}

          {/* Command-center: 3 действия с этим узлом. Главный CTA — взять
              mock с фокусом на этой теме (передаём node.id + section в
              query — MockCompanyPicker pre-select'ит matching section'ы и
              покажет banner). 2nd action — coach pill (открывается inline).
              3rd — Codex с фильтром по теме. */}
          {(() => {
            const persona = pickPersonaForNode(node, activeTrack)
            const ctx = `Студент изучает узел «${node.title}» (${sectionLabel(node.section)}). Прогресс: ${pctLabel}${total > 0 ? `, ${solved} из ${total} задач решено` : ''}. Состояние: ${STATE_LABEL[state]}.`
            const mockHref = `/mock?focus=${encodeURIComponent(node.key)}&section=${encodeURIComponent(node.section)}&title=${encodeURIComponent(node.title)}`
            const codexHref = `/codex?topic=${encodeURIComponent(node.section)}`
            return (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                <Link to={mockHref} className="block">
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Target className="h-4 w-4" />}
                    iconRight={<ArrowRight className="h-4 w-4" />}
                    className="w-full justify-between"
                  >
                    Mock с фокусом на эту тему
                  </Button>
                </Link>
                <div className="flex">
                  <AICoachPill
                    personaSlug={persona.slug}
                    coachName={persona.name}
                    contextNote={ctx}
                    label="Спросить coach’а"
                  />
                </div>
                <Link
                  to={codexHref}
                  className="inline-flex items-center gap-2 self-start rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary hover:text-text-primary"
                >
                  <BookOpen className="h-3.5 w-3.5" /> Что почитать
                </Link>
              </div>
            )
          })()}

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
                  // Phase-4: progress bar collapsed to monochrome — state
                  // is shown by saturation/explicit colors only where it
                  // genuinely conveys meaning (decaying = danger).
                  state === 'mastered'
                    ? 'bg-success'
                    : state === 'decaying'
                      ? 'bg-danger'
                      : 'bg-text-primary'
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

          {recommended.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Рекомендованные ката
              </span>
              <ul className="flex flex-col gap-1.5">
                {recommended.slice(0, 5).map((k) => (
                  <KataItem key={k.id} k={k} />
                ))}
              </ul>
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
        className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary transition-colors hover:border-border-strong"
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
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary hover:border-border-strong"
          >
            {n.title}
          </button>
        ))}
      </div>
    </div>
  )
}
