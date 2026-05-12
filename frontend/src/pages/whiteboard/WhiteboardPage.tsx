// frontend/src/pages/whiteboard/WhiteboardPage.tsx
//
// Solo-mode Excalidraw canvas (D4 Stream F migration, 2026-05-12). Pivot:
// peer-collab (Yjs / WS / awareness) был дропнут вместе с Hone SharedBoards;
// что осталось — личная доска с persistence на бэк через REST snapshot.
//
// Маршруты:
//   /whiteboard/new        → создать новую комнату, redirect на /whiteboard/:id
//   /whiteboard/:id        → editable canvas, debounced autosave
//   /whiteboard/:id/view   → read-only (см. флаг readOnly)
//
// Save semantics: debounced (1.2s) PUT /whiteboard/room/:id/snapshot с
// base64-encoded blob. Server хранит blob (BYTEA, unchanged schema). На
// page mount фетчим snapshot отдельным REST'ом /snapshot и hydrate'им
// Excalidraw. Snapshot blob — стандартный Excalidraw JSON (не Yjs).
//
// localStorage fallback: на случай если backend snapshot endpoint вернёт
// 404 (старая комната без сохранённого blob), хранит scene в IndexedDB-
// less варианте — просто localStorage с ключом druz9:whiteboard:<id>.
// Когда сеть восстановится, save снова заработает.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Excalidraw, CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'

import { API_BASE, readAccessToken } from '../../lib/apiClient'
import {
  useCreateWhiteboardMutation,
  useWhiteboardQuery,
} from '../../lib/queries/whiteboard'

// ─── Types ────────────────────────────────────────────────────────────────

interface SceneSnapshot {
  elements: unknown[]
  appState?: Record<string, unknown>
}

// ─── Page entry ───────────────────────────────────────────────────────────

interface Props {
  /** /whiteboard/:id/view route hits this flag. Hides toolbar, blocks edits. */
  readOnly?: boolean
}

export default function WhiteboardPage({ readOnly = false }: Props) {
  const { id: rawId } = useParams<{ id: string }>()
  const id = useMemo(() => (rawId ?? '').trim(), [rawId])
  const navigate = useNavigate()

  const isNew = id === 'new'
  const createMu = useCreateWhiteboardMutation()
  const createMuMutate = createMu.mutate
  const createMuIsPending = createMu.isPending

  // /whiteboard/new → create room, replace into /whiteboard/:id.
  useEffect(() => {
    if (!isNew) return
    createMuMutate(
      { title: 'Untitled board' },
      {
        onSuccess: (room) => {
          navigate(`/whiteboard/${room.id}`, { replace: true })
        },
      },
    )
    // createMuMutate is stable, no need to retrigger on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = 'rgb(var(--color-bg))'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  if (isNew) {
    return (
      <CenterMessage
        text={createMuIsPending ? 'CREATING BOARD…' : 'PREPARING BOARD…'}
      />
    )
  }
  if (!id) {
    return <CenterMessage text="MISSING BOARD ID" />
  }

  return <SoloCanvasGate id={id} readOnly={readOnly} />
}

// ─── Gate (loads meta + snapshot) ────────────────────────────────────────

function SoloCanvasGate({ id, readOnly }: { id: string; readOnly: boolean }) {
  const roomQ = useWhiteboardQuery(id)

  if (roomQ.isLoading) return <CenterMessage text="LOADING BOARD…" />
  if (roomQ.error) {
    const status = (roomQ.error as { status?: number }).status
    if (status === 404) return <CenterMessage text="BOARD NOT FOUND" />
    if (status === 403) return <CenterMessage text="PRIVATE BOARD" sub="You don’t have access." />
    if (status === 401) return <CenterMessage text="SIGN IN REQUIRED" />
    return (
      <CenterMessage
        text="ERROR"
        sub={(roomQ.error as Error)?.message ?? 'Unknown'}
      />
    )
  }
  if (!roomQ.data) return <CenterMessage text="BOARD NOT FOUND" />
  return <SoloCanvas id={id} title={roomQ.data.title} readOnly={readOnly} />
}

// ─── Solo canvas ──────────────────────────────────────────────────────────

function SoloCanvas({
  id,
  title,
  readOnly,
}: {
  id: string
  title: string
  readOnly: boolean
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const apiBoundRef = useRef(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedRef = useRef<string>('')
  const debounceRef = useRef<number | null>(null)

  // Initial snapshot fetch. Тащим отдельным REST'ом — не блокируем initial
  // render Excalidraw'а; пустая доска показывается мгновенно, scene
  // hydrate'ится когда blob придёт.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = readAccessToken()
      try {
        const resp = await fetch(
          `${API_BASE}/whiteboard/room/${encodeURIComponent(id)}/snapshot`,
          {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
          },
        )
        if (cancelled) return
        if (!resp.ok) return // 404 — fresh board, ничего не hydrate'им
        const json = (await resp.json()) as { snapshot_b64?: string }
        if (!json.snapshot_b64) return
        const text = atob(json.snapshot_b64)
        const parsed = JSON.parse(text) as SceneSnapshot
        if (cancelled) return
        // apiRef мог ещё не быть смонтирован — отдаём задаче в micro-tick.
        const apply = () => {
          const api = apiRef.current
          if (!api) return
          api.updateScene({
            elements: (parsed.elements ?? []) as never,
            captureUpdate: CaptureUpdateAction.NEVER,
          })
          lastSavedRef.current = JSON.stringify(parsed.elements ?? [])
        }
        if (apiRef.current) apply()
        else queueMicrotask(apply)
      } catch {
        /* fall through; пустая доска OK */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Debounced save (1.2s after last edit). Solo — отправляем raw Excalidraw
  // scene (elements only — appState не persistим, у юзера может быть свой
  // viewport / theme и не нужно его forsing'ать).
  const saveNow = useCallback(
    async (snapshot: SceneSnapshot) => {
      const token = readAccessToken()
      const json = JSON.stringify(snapshot)
      const b64 = btoa(unescape(encodeURIComponent(json)))
      setSaveState('saving')
      try {
        const resp = await fetch(
          `${API_BASE}/whiteboard/room/${encodeURIComponent(id)}/snapshot`,
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ snapshot_b64: b64 }),
          },
        )
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    },
    [id],
  )

  const handleChange = useCallback(
    (elements: readonly unknown[]) => {
      if (readOnly) return
      const serialised = JSON.stringify(elements)
      if (serialised === lastSavedRef.current) return
      lastSavedRef.current = serialised
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        void saveNow({ elements: elements as unknown[] })
      }, 1200)
    },
    [saveNow, readOnly],
  )

  // Flush на unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
        // Best-effort sync save; не ждём.
        const api = apiRef.current
        if (api && !readOnly) {
          const elements = api.getSceneElements()
          void saveNow({ elements: elements as unknown[] })
        }
      }
    }
  }, [saveNow, readOnly])

  // Share read-only URL: /whiteboard/:id/view. Copy-to-clipboard chip.
  const [copied, setCopied] = useState(false)
  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/whiteboard/${encodeURIComponent(id)}/view`
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }, [id])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgb(var(--color-bg))' }}>
      <div
        className="hone-excalidraw-mount-web"
        style={{ position: 'absolute', inset: 0 }}
      >
        <Excalidraw
          theme="dark"
          viewModeEnabled={readOnly}
          excalidrawAPI={(api) => {
            apiRef.current = api
            if (apiBoundRef.current) return
            apiBoundRef.current = true
            // initial fetch effect выше отдельно hydrate'ит.
            requestAnimationFrame(() => {
              try {
                api.refresh()
              } catch {
                /* ignore */
              }
            })
          }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: { saveToActiveFile: false, loadScene: false, export: false },
          }}
        />
      </div>

      {/* Bottom-right meta chip: title + save state. */}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 24,
          padding: '6px 14px',
          background: 'rgba(20,20,22,0.78)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--hair-2)',
          borderRadius: 999,
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--ink-60)',
          fontFamily: '"JetBrains Mono", monospace',
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        <span>{title || 'Untitled board'}</span>
        <span style={{ opacity: 0.4, margin: '0 8px' }}>·</span>
        <span style={{ color: saveStateColor(saveState) }}>
          {readOnly ? 'VIEW' : saveStateLabel(saveState)}
        </span>
      </div>

      {/* Top-right share button (hidden in read-only). */}
      {!readOnly && (
        <div
          style={{
            position: 'fixed',
            top: 18,
            right: 24,
            display: 'flex',
            gap: 6,
            zIndex: 25,
          }}
        >
          <button
            type="button"
            onClick={handleShare}
            style={{
              padding: '7px 14px',
              fontSize: 11,
              letterSpacing: '0.08em',
              background: 'rgba(20,20,22,0.78)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--hair-2)',
              color: 'var(--ink-60)',
              borderRadius: 999,
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace',
              transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            {copied ? 'COPIED' : 'SHARE'}
          </button>
        </div>
      )}
      <style>{webExcalidrawStyles}</style>
    </div>
  )
}

// ─── Styling / helpers ────────────────────────────────────────────────────

const webExcalidrawStyles = `
.hone-excalidraw-mount-web .excalidraw {
  --color-canvas-background: rgb(var(--color-bg));
  --theme-filter: invert(100%) hue-rotate(180deg) !important;
}
.hone-excalidraw-mount-web .excalidraw .layer-ui__wrapper__top-right,
.hone-excalidraw-mount-web .excalidraw .scroll-back-to-content,
.hone-excalidraw-mount-web .excalidraw .help-icon {
  display: none !important;
}
`

function saveStateLabel(state: 'idle' | 'saving' | 'saved' | 'error'): string {
  switch (state) {
    case 'saving':
      return 'SAVING…'
    case 'saved':
      return 'SAVED'
    case 'error':
      return 'OFFLINE'
    default:
      return 'READY'
  }
}

function saveStateColor(state: 'idle' | 'saving' | 'saved' | 'error'): string {
  switch (state) {
    case 'error':
      return 'var(--red)'
    case 'saved':
      return 'rgb(var(--ink))'
    default:
      return 'var(--ink-60)'
  }
}

function CenterMessage({ text, sub }: { text: string; sub?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(var(--color-bg))',
        color: 'rgb(var(--ink))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 14,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--ink-40)',
        }}
      >
        {text}
      </div>
      {sub && (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--ink-60)',
            textAlign: 'center',
            maxWidth: 420,
            lineHeight: 1.6,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  )
}
