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
import { useT } from '@d9-i18n'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useSubmitCanvasMutation,
  type PipelineAttempt,
} from '../../lib/queries/mockPipeline'
import { useCanvasDraft } from '../../lib/useCanvasDraft'
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

const SysDesignCanvasInner = lazy(() => import('./_lazy/SysDesignCanvasInner'))

const MAX_CHARS = 4000
// ~5MB after base64 inflation. Backend hard-caps at 5MB decoded; this client
// guard avoids the round-trip for obviously-too-big diagrams.
const MAX_DATA_URL_BYTES = 7_000_000

export function SysDesignCanvas({
  attempt,
  pipelineId,
}: {
  attempt: PipelineAttempt
  pipelineId: string
}) {
  const t = useT()
  const NON_FUNCT_PLACEHOLDER = t('mock.sysdesign.field.non_functional_ph')
  const CONTEXT_PLACEHOLDER = t('mock.sysdesign.field.context_ph')
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

  // applyingRemoteRef gates the onChange echo: when updateScene runs
  // off a peer broadcast Excalidraw fires onChange afterwards, which
  // would re-broadcast the (older) scene back and overwrite the peer's
  // in-progress drag with a stale 2×2 echo. The flag tells onChange
  // to skip pushDraft for that one tick.
  const applyingRemoteRef = useRef(false)

  // Live updates from the standalone tab — push the new scene + file
  // blobs into Excalidraw. updateScene only updates geometry; image
  // files (Excalidraw's library / paste-image) need a separate
  // addFiles call or they'd render as empty placeholders.
  useEffect(() => {
    if (!draft.remote) return
    const api = apiRef.current
    if (!api) return
    applyingRemoteRef.current = true
    api.updateScene({ elements: draft.remote.sceneJSON.elements as never })
    const files = draft.remote.sceneJSON.files
    if (files && typeof files === 'object') {
      const arr = Object.values(files) as BinaryFileData[]
      if (arr.length > 0) api.addFiles(arr)
    }
    window.setTimeout(() => {
      applyingRemoteRef.current = false
    }, 0)
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

  const briefTitle = (attempt.question_body ?? '').split('\n\n')[0] || t('mock.sysdesign.brief.default_title')
  const briefBody = (attempt.question_body ?? '').split('\n\n').slice(1).join('\n\n')

  const handleSubmit = async () => {
    setClientErr(null)
    const api = apiRef.current
    if (!api) {
      setClientErr(t('mock.sysdesign.err.canvas_not_ready'))
      return
    }
    try {
      const elements = api.getSceneElements()
      const files = api.getFiles()
      // Guard: a click in Excalidraw without a drag produces an element
      // with width=0/height=0 — invisible to the user but present in the
      // scene. Exporting such a scene yields a blank PNG that the vision
      // judge can't read, and the user sees an opaque failure message.
      // Refuse the submit early with a hint.
      const visible = elements.filter(
        (e) => !e.isDeleted && (e.width ?? 0) > 1 && (e.height ?? 0) > 1,
      )
      if (visible.length === 0) {
        setClientErr(t('mock.sysdesign.err.empty_canvas'))
        return
      }
      const { exportToBlob } = await import('@excalidraw/excalidraw')
      const blob = await exportToBlob({
        elements,
        files,
        mimeType: 'image/png',
        appState: { exportBackground: true, exportPadding: 20 },
      })
      const dataURL = await blobToDataURL(blob)
      if (dataURL.length > MAX_DATA_URL_BYTES) {
        setClientErr(t('mock.sysdesign.err.too_big'))
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
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {t('mock.sysdesign.brief_label')}
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
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
              {t('mock.sysdesign.functional_reqs')}
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
              {draft.serverDraftFailed ? (
                <span className="relative rounded-md border border-border-strong bg-surface-1 px-2 py-0.5 pl-3 text-text-primary">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
                    style={{ background: 'var(--red)' }}
                  />
                  {t('mock.sysdesign.autosave.disabled')}
                </span>
              ) : draft.quotaExceeded ? (
                <span className="relative rounded-md border border-border-strong bg-surface-1 px-2 py-0.5 pl-3 text-text-primary">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
                    style={{ background: 'var(--red)' }}
                  />
                  {t('mock.sysdesign.autosave.local_full')}
                </span>
              ) : (
                <span>{t('mock.sysdesign.autosave.normal')}</span>
              )}
              {draft.fullscreenAlive && (
                <span className="rounded-md border border-border-strong bg-surface-2 px-2 py-0.5 text-text-primary">
                  {t('mock.sysdesign.fullscreen_open')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.open(`/mock/canvas/${attempt.id}`, '_blank', 'noopener')}
              className="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-1 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary hover:bg-surface-2"
            >
              <ExternalLink className="h-3 w-3" />
              {t('mock.sysdesign.open_fullscreen')}
            </button>
          </div>
        )}
        {restoreBanner && !isSubmitted && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs">
            <span className="text-text-secondary">
              {t('mock.sysdesign.restored.prefix')}{' '}
              {restoreBanner.ageMin <= 0
                ? t('mock.sysdesign.restored.just_now')
                : restoreBanner.ageMin < 60
                  ? t('mock.sysdesign.restored.min_ago', { n: String(restoreBanner.ageMin) })
                  : t('mock.sysdesign.restored.h_ago', { n: String(Math.round(restoreBanner.ageMin / 60)) })}
            </span>
            <button
              type="button"
              onClick={() => setRestoreBanner(null)}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary"
            >
              {t('mock.sysdesign.restored.hide')}
            </button>
          </div>
        )}
        {!isSubmitted && draft.fullscreenAlive && (
          <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs text-text-secondary">
            {t('mock.sysdesign.fullscreen.hint_pre')}{' '}
            <span className="font-mono text-text-primary">{t('mock.sysdesign.fullscreen.hint_action')}</span>{' '}
            {t('mock.sysdesign.fullscreen.hint_post')}
          </div>
        )}
        {!isSubmitted ? (
          <div className="relative h-[400px] lg:h-[600px] overflow-hidden rounded-lg border border-border-strong bg-black">
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">{t('mock.sysdesign.loading_canvas')}</span>
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
                  if (applyingRemoteRef.current) return
                  pushDraft()
                }}
              />
            </Suspense>
          </div>
        ) : attempt.user_excalidraw_scene_json ? (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
              {t('mock.sysdesign.submitted_label')}
            </div>
            <div className="relative h-[400px] lg:h-[600px] overflow-hidden rounded-lg border border-border bg-black">
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm">{t('mock.sysdesign.loading_diagram')}</span>
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
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-2">
              {t('mock.sysdesign.submitted_label')}
            </div>
            <img
              src={attempt.user_excalidraw_image_url}
              alt="Submitted system design diagram"
              className="w-full h-auto rounded-md border border-border bg-black"
            />
          </Card>
        ) : (
          <Card variant="default" padding="md" className="text-sm text-text-secondary">
            {t('mock.sysdesign.diagram_missing')}
          </Card>
        )}
        <div className="font-mono text-[10px] text-text-secondary px-1">
          {t('mock.sysdesign.export_hint')}
        </div>
      </div>

      {/* ── Reqs + Context column ──────────────────────────── */}
      <div className="flex flex-col gap-3 min-w-0">
        {!isSubmitted ? (
          <>
            <CharField
              label={t('mock.sysdesign.field.non_functional')}
              value={nonFunctionalMD}
              onChange={(v) => {
                setNonFunctionalMD(v)
                pushDraft({ nfr: v })
              }}
              placeholder={NON_FUNCT_PLACEHOLDER}
              disabled={submit.isPending}
            />
            <CharField
              label={t('mock.sysdesign.field.context')}
              value={contextMD}
              onChange={(v) => {
                setContextMD(v)
                pushDraft({ ctx: v })
              }}
              placeholder={CONTEXT_PLACEHOLDER}
              disabled={submit.isPending}
            />
            {clientErr && (
              <div className="relative flex items-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 py-2 pl-4 text-sm text-text-primary">
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
                  style={{ background: 'var(--red)' }}
                />
                <AlertCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--red)' }} />
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
                {t('mock.sysdesign.submit_button')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {nonFunctionalMD || attempt.user_answer_md ? (
              <Card variant="default" padding="md" className="flex flex-col gap-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
                  {t('mock.sysdesign.field.non_functional_submitted')}
                </div>
                <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
                  {attempt.user_answer_md ?? '—'}
                </div>
              </Card>
            ) : null}
            {attempt.user_context_md ? (
              <Card variant="default" padding="md" className="flex flex-col gap-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
                  {t('mock.sysdesign.field.context_submitted')}
                </div>
                <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
                  {attempt.user_context_md}
                </div>
              </Card>
            ) : null}

            {isJudging && (
              <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                <span className="text-sm text-text-secondary">{t('mock.sysdesign.ai_judging')}</span>
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
      <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        placeholder={placeholder}
        className="w-full resize-y border-0 border-b border-solid bg-transparent p-3 font-mono text-xs whitespace-pre-wrap text-text-primary placeholder:text-text-secondary outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
        style={{ borderBottomColor: 'var(--hair-2)' }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
        }}
      />
      <div
        className="self-end font-mono text-[10px] tracking-[0.08em] text-text-secondary"
        style={overflow ? { color: 'var(--red)' } : undefined}
      >
        {value.length} / {MAX_CHARS}
      </div>
    </div>
  )
}

// ── verdict panel — kept local so SysDesignCanvas is self-contained.
// Mirrors VerdictPanel in MockPipelinePage but tightened to a column.
function CanvasVerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
  const t = useT()
  const v = attempt.ai_verdict
  const score = attempt.ai_score ?? 0
  const fail = v === 'fail'
  const borderline = v === 'borderline'
  const label =
    v === 'pass' ? t('mock.common.verdict.pass')
    : v === 'fail' ? t('mock.common.verdict.fail')
    : v === 'borderline' ? t('mock.common.verdict.borderline')
    : v
  const Icon = v === 'pass' ? CheckCircle2 : v === 'fail' ? XCircle : AlertCircle

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex items-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-text-primary">
        {(fail || borderline) && (
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
            style={{ background: 'var(--red)' }}
          />
        )}
        <Icon
          className="h-4 w-4"
          style={fail || borderline ? { color: 'var(--red)' } : undefined}
        />
        <span
          className="font-display text-sm font-bold uppercase tracking-[0.08em]"
          style={fail || borderline ? { color: 'var(--red)' } : undefined}
        >
          {label}
        </span>
        <span className="font-mono text-sm tabular-nums">· {score}/100</span>
      </div>
      {attempt.ai_feedback_md && (
        <Card variant="default" padding="md" className="font-sans">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            {t('mock.common.label.feedback')}
          </div>
          <div className="text-sm text-text-primary whitespace-pre-wrap">
            {attempt.ai_feedback_md}
          </div>
        </Card>
      )}
      {attempt.ai_missing_points.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            {t('mock.common.label.missing_points')}
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
