// SysDesignCanvas — Phase D.2 sysdesign-canvas attempt surface.
//
// Layout (lg+): 3-column grid
//   [Task brief] · [Excalidraw canvas] · [Reqs + Context + Submit]
// Narrow viewports collapse to a single column.
//
// Lifecycle:
//   - Pre-submit (attempt.user_answer_md == null): editable canvas + textareas.
//   - Post-submit (judge has run, user_answer_md set): read-only — saved
//     image + saved non-funct + context + verdict panel.
//
// Single-user. NO Yjs collab. Theme overrides mirror WhiteboardSharePage.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useSubmitCanvasMutation,
  type PipelineAttempt,
} from '../../lib/queries/mockPipeline'
import { useCanvasDraft } from '../../lib/useCanvasDraft'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

const SysDesignCanvasInner = lazy(() => import('./_lazy/SysDesignCanvasInner'))

const MAX_CHARS = 4000
// ~5MB after base64 inflation. Backend hard-caps at 5MB decoded; this client
// guard avoids the round-trip for obviously-too-big diagrams.
const MAX_DATA_URL_BYTES = 7_000_000

const NON_FUNCT_PLACEHOLDER =
  '100 RPS на запись, p99 < 200ms на чтение, write-heavy,\n' +
  'eventually consistent reads OK, 3 региона, 99.9% uptime…'
const CONTEXT_PLACEHOLDER =
  'Cassandra потому что write-heavy + eventual consistency OK;\n' +
  'Redis cache для горячих ключей; ws для realtime feed;\n' +
  'CDN перед статикой…'

export function SysDesignCanvas({
  attempt,
  pipelineId,
}: {
  attempt: PipelineAttempt
  pipelineId: string
}) {
  const submit = useSubmitCanvasMutation(pipelineId)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [nonFunctionalMD, setNonFunctionalMD] = useState('')
  const [contextMD, setContextMD] = useState('')
  const [clientErr, setClientErr] = useState<string | null>(null)

  // Autosave + cross-tab sync. The hook seeds `restored` from
  // localStorage on mount (or the Redis fallback if localStorage is
  // empty); we apply it once below to the canvas + form.
  const { state: draft, update: updateDraft, notifySubmitted } = useCanvasDraft(
    attempt.id,
    'main',
  )
  const restoredAppliedRef = useRef(false)
  const [restoreBanner, setRestoreBanner] = useState<{ ageMin: number } | null>(null)
  useEffect(() => {
    if (restoredAppliedRef.current) return
    if (!draft.restored) return
    restoredAppliedRef.current = true
    if (draft.restored.nonFunctionalMD) setNonFunctionalMD(draft.restored.nonFunctionalMD)
    if (draft.restored.contextMD) setContextMD(draft.restored.contextMD)
    // Excalidraw scene is restored via initialData (see SysDesignCanvasInner).
    setRestoreBanner({ ageMin: Math.floor((Date.now() - draft.restored.updatedAt) / 60_000) })
  }, [draft.restored])

  // Live updates from the standalone tab — push the new scene into
  // Excalidraw without overwriting NFR/Context (those are typed here).
  useEffect(() => {
    if (!draft.remote) return
    const api = apiRef.current
    if (!api) return
    api.updateScene({ elements: draft.remote.sceneJSON.elements as never })
  }, [draft.remote])

  // Latest scene we've seen — captured from Excalidraw onChange so that
  // when the user types into NFR / Context textareas we can broadcast a
  // complete draft (scene + text) without round-tripping through API.
  const sceneRef = useRef<{ elements: unknown[]; files: Record<string, unknown> }>({
    elements: [],
    files: {},
  })

  // Compose a fresh updateDraft call from current React state + the
  // latest scene snapshot. Hook handles debounce + Redis fallback.
  const pushDraft = (override?: { nfr?: string; ctx?: string }) => {
    updateDraft({
      sceneJSON: { elements: sceneRef.current.elements, files: sceneRef.current.files },
      nonFunctionalMD: override?.nfr ?? nonFunctionalMD,
      contextMD: override?.ctx ?? contextMD,
    })
  }

  // Once user_answer_md is set, the orchestrator has accepted the canvas
  // and either is judging or has judged. Switch to read-only view.
  const isSubmitted = !!attempt.user_answer_md
  const isJudging = isSubmitted && attempt.ai_verdict === 'pending'
  const isJudged = isSubmitted && attempt.ai_verdict !== 'pending'

  const briefTitle = (attempt.question_body ?? '').split('\n\n')[0] || 'Задача'
  const briefBody = (attempt.question_body ?? '').split('\n\n').slice(1).join('\n\n')

  const handleSubmit = async () => {
    setClientErr(null)
    const api = apiRef.current
    if (!api) {
      setClientErr('Канвас ещё не загрузился, попробуй ещё раз.')
      return
    }
    try {
      const elements = api.getSceneElements()
      const files = api.getFiles()
      const { exportToBlob } = await import('@excalidraw/excalidraw')
      const blob = await exportToBlob({
        elements,
        files,
        mimeType: 'image/png',
        appState: { exportBackground: true, exportPadding: 20 },
      })
      const dataURL = await blobToDataURL(blob)
      if (dataURL.length > MAX_DATA_URL_BYTES) {
        setClientErr('Диаграмма слишком большая, упрости (≤5 МБ).')
        return
      }
      // Scene JSON is the persistent record — backend stores it, frontend
      // re-renders it in viewMode on review. The PNG is consumed once by
      // the vision judge and then discarded server-side.
      submit.mutate(
        {
          attemptId: attempt.id,
          imageDataURL: dataURL,
          sceneJSON: { elements, files },
          contextMD: contextMD.trim(),
          nonFunctionalMD: nonFunctionalMD.trim(),
        },
        {
          // On success: clear localStorage + Redis draft, broadcast
          // 'submitted' so the fullscreen tab (if open) auto-closes.
          onSuccess: () => notifySubmitted(),
        },
      )
    } catch (err) {
      setClientErr(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,30%)_1fr_minmax(280px,28%)] gap-4">
      {/* ── Brief column ────────────────────────────────────── */}
      <Card variant="default" padding="md" className="lg:sticky lg:top-4 lg:self-start flex flex-col gap-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          Задача
        </div>
        <h3 className="font-display text-base font-bold text-text-primary whitespace-pre-wrap">
          {briefTitle}
        </h3>
        {briefBody && (
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-primary">
            {briefBody}
          </div>
        )}
        {attempt.task_functional_requirements_md ? (
          <div className="mt-1 rounded-md border border-border bg-surface-1 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
              Функциональные требования
            </div>
            <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
              {attempt.task_functional_requirements_md}
            </div>
          </div>
        ) : null}
      </Card>

      {/* ── Canvas column ───────────────────────────────────── */}
      <div className="flex flex-col gap-2 min-w-0">
        {!isSubmitted && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-secondary">
              <span>автосейв · 24ч</span>
              {draft.quotaExceeded && (
                <span className="rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 text-warn">
                  локалка переполнена → пишем на сервер
                </span>
              )}
              {draft.fullscreenAlive && (
                <span className="rounded-md border border-success/50 bg-success/10 px-2 py-0.5 text-success">
                  доска открыта в новой вкладке
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.open(`/mock/canvas/${attempt.id}`, '_blank', 'noopener')}
              className="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-1 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-primary hover:bg-surface-2"
            >
              <ExternalLink className="h-3 w-3" />
              На весь экран
            </button>
          </div>
        )}
        {restoreBanner && !isSubmitted && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs">
            <span className="text-text-secondary">
              Восстановлено{' '}
              {restoreBanner.ageMin <= 0
                ? 'только что'
                : restoreBanner.ageMin < 60
                  ? `${restoreBanner.ageMin} мин назад`
                  : `${Math.round(restoreBanner.ageMin / 60)} ч назад`}
            </span>
            <button
              type="button"
              onClick={() => setRestoreBanner(null)}
              className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary"
            >
              скрыть
            </button>
          </div>
        )}
        {!isSubmitted && draft.fullscreenAlive && (
          <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs text-text-secondary">
            Закончил рисовать в новой вкладке? Жми{' '}
            <span className="font-mono text-text-primary">Submit</span> здесь —
            диаграмма подтянется автоматически.
          </div>
        )}
        {!isSubmitted ? (
          <div className="relative h-[400px] lg:h-[600px] overflow-hidden rounded-lg border border-border-strong bg-black">
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">Загрузка канваса…</span>
                </div>
              }
            >
              <SysDesignCanvasInner
                onAPI={(api) => {
                  apiRef.current = api
                }}
                initialData={
                  draft.restored
                    ? ({
                        elements: draft.restored.sceneJSON.elements ?? [],
                        files: draft.restored.sceneJSON.files ?? {},
                      } as never)
                    : null
                }
                onChange={(elements, _appState, files) => {
                  sceneRef.current = {
                    elements: elements as unknown[],
                    files: (files ?? {}) as Record<string, unknown>,
                  }
                  pushDraft()
                }}
              />
            </Suspense>
          </div>
        ) : attempt.user_excalidraw_scene_json ? (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
              Что сдал
            </div>
            <div className="relative h-[400px] lg:h-[600px] overflow-hidden rounded-lg border border-border bg-black">
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm">Загрузка диаграммы…</span>
                  </div>
                }
              >
                <SysDesignCanvasInner
                  viewModeEnabled
                  // Scene JSON shape is opaque to TypeScript here (we type it
                  // as unknown[] in the query layer to avoid pulling Excalidraw
                  // types into the data layer). Cast at the boundary —
                  // Excalidraw validates the payload at runtime.
                  initialData={
                    {
                      elements: attempt.user_excalidraw_scene_json.elements ?? [],
                      files: attempt.user_excalidraw_scene_json.files ?? {},
                    } as never
                  }
                />
              </Suspense>
            </div>
          </div>
        ) : attempt.user_excalidraw_image_url ? (
          // Legacy rows written before F-3 v2: we still have a data URL but
          // no scene blob — fall back to <img>. New rows always have scene.
          <Card variant="default" padding="sm" className="overflow-hidden">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">
              Что сдал
            </div>
            <img
              src={attempt.user_excalidraw_image_url}
              alt="Submitted system design diagram"
              className="w-full h-auto rounded-md border border-border bg-black"
            />
          </Card>
        ) : (
          <Card variant="default" padding="md" className="text-sm text-text-secondary">
            Диаграмма не сохранена.
          </Card>
        )}
        <div className="font-mono text-[10px] text-text-secondary px-1">
          PNG, dark theme · экспорт автоматически при отправке
        </div>
      </div>

      {/* ── Reqs + Context column ──────────────────────────── */}
      <div className="flex flex-col gap-3 min-w-0">
        {!isSubmitted ? (
          <>
            <CharField
              label="Нефункциональные требования"
              value={nonFunctionalMD}
              onChange={(v) => {
                setNonFunctionalMD(v)
                pushDraft({ nfr: v })
              }}
              placeholder={NON_FUNCT_PLACEHOLDER}
              disabled={submit.isPending}
            />
            <CharField
              label="Пояснения / контекст"
              value={contextMD}
              onChange={(v) => {
                setContextMD(v)
                pushDraft({ ctx: v })
              }}
              placeholder={CONTEXT_PLACEHOLDER}
              disabled={submit.isPending}
            />
            {clientErr && (
              <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{clientErr}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="primary"
                size="md"
                onClick={handleSubmit}
                disabled={submit.isPending}
                loading={submit.isPending}
              >
                Отправить решение
              </Button>
            </div>
          </>
        ) : (
          <>
            {nonFunctionalMD || attempt.user_answer_md ? (
              <Card variant="default" padding="md" className="flex flex-col gap-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                  Нефункциональные (что сдал)
                </div>
                <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
                  {attempt.user_answer_md ?? '—'}
                </div>
              </Card>
            ) : null}
            {attempt.user_context_md ? (
              <Card variant="default" padding="md" className="flex flex-col gap-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                  Контекст (что сдал)
                </div>
                <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
                  {attempt.user_context_md}
                </div>
              </Card>
            ) : null}

            {isJudging && (
              <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                <span className="text-sm text-text-secondary">AI оценивает диаграмму…</span>
              </div>
            )}

            {isJudged && <CanvasVerdictPanel attempt={attempt} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const v = fr.result
      if (typeof v === 'string') resolve(v)
      else reject(new Error('FileReader.readAsDataURL did not return a string'))
    }
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'))
    fr.readAsDataURL(blob)
  })
}

function CharField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled: boolean
}) {
  const overflow = value.length > MAX_CHARS
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-border-strong bg-surface-1 p-3 font-mono text-xs whitespace-pre-wrap text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary/40"
      />
      <div
        className={[
          'self-end font-mono text-[10px]',
          overflow ? 'text-danger' : 'text-text-secondary',
        ].join(' ')}
      >
        {value.length} / {MAX_CHARS}
      </div>
    </div>
  )
}

// ── verdict panel — kept local so SysDesignCanvas is self-contained.
// Mirrors VerdictPanel in MockPipelinePage but tightened to a column.
function CanvasVerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
  const v = attempt.ai_verdict
  const score = attempt.ai_score ?? 0
  const cls =
    v === 'pass'
      ? 'border-success bg-success/10 text-success'
      : v === 'fail'
        ? 'border-danger bg-danger/10 text-danger'
        : v === 'borderline'
          ? 'border-warn bg-warn/10 text-warn'
          : 'border-border bg-surface-1 text-text-secondary'
  const label =
    v === 'pass' ? 'PASS' : v === 'fail' ? 'FAIL' : v === 'borderline' ? 'BORDERLINE' : v
  const Icon = v === 'pass' ? CheckCircle2 : v === 'fail' ? XCircle : AlertCircle

  return (
    <div className="flex flex-col gap-2">
      <div className={['flex items-center gap-2 rounded-lg border px-3 py-2', cls].join(' ')}>
        <Icon className="h-4 w-4" />
        <span className="font-display text-sm font-bold uppercase">{label}</span>
        <span className="font-mono text-sm">· {score}/100</span>
      </div>
      {attempt.ai_feedback_md && (
        <Card variant="default" padding="md" className="font-sans">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
            Feedback
          </div>
          <div className="text-sm text-text-primary whitespace-pre-wrap">
            {attempt.ai_feedback_md}
          </div>
        </Card>
      )}
      {attempt.ai_missing_points.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
            Что упустил
          </div>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-0.5">
            {attempt.ai_missing_points.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
